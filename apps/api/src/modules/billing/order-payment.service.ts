// PAY-02 / PAY-03 / FL-10 / 04 §6 / 05-integrations §4.3 — online payment of an order (P2) and recorded refunds.
//   POST /orders/:id/payment-link : one active link per order (a new one expires the previous), amount = what is left to
//     pay, valid 15 min, `paymentStatus=pending_link` while open. The Chargily checkout is created by the worker
//     (`payments/order-link-create`, 03-events §7: no gateway call from a request handler), then the link is posted in the
//     order's conversation (`customer.paymentLink`) unless `send=false`.
//   Webhook / reconcile: paid ⇒ payment entry (card, `chargily:<id>`) through OrderEffects (cash row), `payment.received`
//     + `customer.paymentReceived`; failed / expired ⇒ `payment.failed` + `customer.paymentFailed` (retry or COD); amount
//     mismatch ⇒ `mismatch`, not paid, admin alert.
//   POST /orders/:id/refunds : recorded refund (Chargily has no refund API): negative payment entry + locked `refund`
//     expense row, `paymentStatus=refunded`.
//   AI tool `create_payment_link` (worker): same link, created synchronously, returned to the model.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatMoney, PAYMENT_LINK_MINUTES, type OrderPaymentLinkDto } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type OrderPayment, type PaymentMethod, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { aiDateTime } from '../../core/time/algiers';
import { OrderEffects } from '../orders/order-effects.service';
import { isTerminal } from '../orders/order-rules';
import { OrderService } from '../orders/order.service';
import { PAYMENT_GATEWAY, PaymentProviderError, type CheckoutStatus, type PaymentGateway } from './gateway/payment-gateway';
import { PaymentService } from './payment.service';

type Raw = { send?: boolean; sentToCustomer?: boolean; createdBy?: string | null; source?: 'merchant' | 'ai'; failureReason?: string | null };

@Injectable()
export class OrderPaymentService implements OnModuleInit {
  private readonly log = new Logger(OrderPaymentService.name);
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
    private readonly effects: OrderEffects,
    private readonly registry: ProcessorRegistry,
    private readonly queue: QueueOutbox,
    private readonly tenants: TenantResolver,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.registry.register('payments', 'order-link-create', (data: { paymentId: string; workspaceId: string }) => this.createCheckout(data.paymentId, data.workspaceId), { concurrency: 4 });
    this.payments.onOrderCheckout((checkoutId, v, source) => this.onCheckout(checkoutId, v, source));
    this.registry.extendCron('sched-payment-reconcile', 'order-links', () => this.reconcile());
  }

  toDto(p: OrderPayment): OrderPaymentLinkDto {
    const raw = (p.raw ?? {}) as Raw;
    return { id: p.id, orderId: p.orderId, amount: p.amount, status: p.status === 'pending' && !p.checkoutUrl ? 'creating' : p.status, url: p.checkoutUrl, expiresAt: p.expiresAt?.toISOString() ?? null, paidAt: p.paidAt?.toISOString() ?? null, sentToCustomer: !!raw.sentToCustomer, createdAt: p.createdAt.toISOString() };
  }

  private async assertEnabled(workspaceId: string) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { onlinePaymentEnabled: true } });
    if (!ws?.onlinePaymentEnabled) throw new AppException('FEATURE_DISABLED', { feature: 'online_payment' });
  }

  /** Opens a link inside `tx` (previous pending link expired, order `pending_link`). */
  private async open(tx: Tx, orderId: string, raw: Raw) {
    const o = await this.orders.lock(tx, orderId);
    const remaining = o.total - o.amountPaid;
    if (isTerminal(o.status) || remaining <= 0 || o.paymentStatus === 'refunded') throw new AppException('ORDER_PAYMENT_LOCKED');
    await tx.orderPayment.updateMany({ where: { orderId, status: 'pending' }, data: { status: 'expired' } });
    const p = await tx.orderPayment.create({ data: { workspaceId: o.workspaceId, orderId, provider: 'chargily', amount: remaining, status: 'pending', raw: raw as Prisma.InputJsonValue } });
    const updated = await tx.order.update({ where: { id: orderId }, data: { paymentStatus: 'pending_link', version: { increment: 1 } } });
    if (o.paymentStatus !== 'pending_link') await tx.orderStatusHistory.create({ data: { orderId, field: 'paymentStatus', from: o.paymentStatus, to: 'pending_link', actorType: raw.source === 'ai' ? 'ai' : 'user', actorId: raw.createdBy ?? null } });
    await this.effects.emitUpdated(tx, updated, ['paymentLink', 'paymentStatus']);
    return { order: o, payment: p };
  }

  /** `POST /orders/:id/payment-link { send? }` → 201 `OrderPaymentLinkDto` (`creating`). */
  async create(orderId: string, send = true): Promise<OrderPaymentLinkDto> {
    const t = TenantContext.get();
    if (!(await prisma.order.findFirst({ where: { id: orderId }, select: { id: true } }))) throw notFound();
    await this.assertEnabled(t.workspaceId);
    const p = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const { payment } = await this.open(tx, orderId, { send, createdBy: t.userId ?? null, source: 'merchant' });
      await this.queue.add(tx, 'payments', 'order-link-create', { paymentId: payment.id, workspaceId: t.workspaceId }, `olink:${payment.id}`, { attempts: 3, backoff: { type: 'fixed', delay: 10_000 } });
      return payment;
    });
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action: 'order.payment_link', entity: 'Order', entityId: orderId, after: { paymentId: p.id, amount: p.amount } });
    return this.toDto(p);
  }

  /** `GET /orders/:id/payment-link` — the latest link of the order (null when none). */
  async latest(orderId: string): Promise<OrderPaymentLinkDto | null> {
    const order = await prisma.order.findFirst({ where: { id: orderId }, select: { id: true } });
    if (!order) throw notFound();
    const p = await prisma.orderPayment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
    return p ? this.toDto(p) : null;
  }

  private async checkout(p: OrderPayment, number: string, locale: 'fr' | 'ar' | 'en') {
    const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    return this.gateway.createCheckout({ amount: p.amount, currency: 'DZD', orderRef: p.id, description: `Commande #${number}`, returnUrl: `${web}/`, failUrl: `${web}/`, metadata: { workspaceId: p.workspaceId, kind: 'order', targetId: p.orderId }, expiresInMin: PAYMENT_LINK_MINUTES, locale });
  }

  /** `payments/order-link-create`: the Chargily checkout of a `creating` link, then the customer message. */
  async createCheckout(paymentId: string, workspaceId: string) {
    const tenant = await this.tenants.forWorker(workspaceId);
    await TenantContext.run(tenant, async () => {
      const p = await prisma.orderPayment.findFirst({ where: { id: paymentId } });
      if (!p || p.status !== 'pending' || p.checkoutUrl) return;
      const order = await prisma.order.findFirstOrThrow({ where: { id: p.orderId } });
      let created;
      try {
        created = await this.checkout(p, order.number, tenant.locale);
      } catch (e) {
        if (e instanceof PaymentProviderError && e.kind === 'unavailable') throw e; // retried (3 / 10 s)
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          await tx.orderPayment.update({ where: { id: p.id }, data: { status: 'failed', raw: { ...((p.raw ?? {}) as Raw), failureReason: e instanceof Error ? e.message : 'error' } as Prisma.InputJsonValue } });
          await this.settleOrder(tx, p.orderId, ['paymentLink']);
        });
        return;
      }
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const raw = (p.raw ?? {}) as Raw;
        const moved = await tx.orderPayment.updateMany({ where: { id: p.id, status: 'pending', checkoutUrl: null }, data: { checkoutUrl: created.url, providerRef: created.checkoutId, expiresAt: created.expiresAt } });
        if (!moved.count) return;
        let sent = false;
        if (raw.send !== false) sent = !!(await this.effects.customerText(tx, order, 'paymentLink', { number: order.number, total: formatMoney(p.amount).replace(/\s?DA$/, ''), url: created.url, minutes: PAYMENT_LINK_MINUTES }));
        if (sent) await tx.orderPayment.update({ where: { id: p.id }, data: { raw: { ...raw, sentToCustomer: true } as Prisma.InputJsonValue } });
        const o = await tx.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
        await this.effects.emitUpdated(tx, o, ['paymentLink']);
      });
    });
  }

  /** Order back to its derived payment status (after a failed / expired link). */
  private async settleOrder(tx: Tx, orderId: string, changed: string[]) {
    const o = await this.orders.lock(tx, orderId);
    const open = await tx.orderPayment.count({ where: { orderId, status: 'pending' } });
    const paid = await this.effects.recomputePaid(tx, o);
    const status = open ? 'pending_link' : o.paymentStatus === 'refunded' ? 'refunded' : paid.paymentStatus;
    const updated = await tx.order.update({ where: { id: orderId }, data: { amountPaid: paid.amountPaid, paymentStatus: status, version: { increment: 1 } } });
    if (status !== o.paymentStatus) await tx.orderStatusHistory.create({ data: { orderId, field: 'paymentStatus', from: o.paymentStatus, to: status, actorType: 'system', actorId: null } });
    await this.effects.emitUpdated(tx, updated, [...changed, 'paymentStatus']);
    return updated;
  }

  /** Gateway verdict for an order link (webhook / reconcile). Returns false when the checkout is not an order link. */
  async onCheckout(checkoutId: string, v: { status: CheckoutStatus; amount: number; method: 'cib' | 'edahabia' | null; raw: unknown }, source: 'webhook' | 'reconcile'): Promise<boolean> {
    const p = await TenantContext.runSystem(() => prisma.orderPayment.findUnique({ where: { providerRef: checkoutId } }));
    if (!p) return false;
    if (p.status !== 'pending' || v.status === 'pending') return true;
    const tenant = await this.tenants.forWorker(p.workspaceId);
    await TenantContext.run(tenant, () =>
      prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          if (v.status === 'paid' && v.amount !== p.amount) {
            const moved = await tx.orderPayment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'mismatch', raw: { ...((p.raw ?? {}) as object), received: v.amount, source } as Prisma.InputJsonValue } });
            if (moved.count) {
              this.log.error({ orderPaymentId: p.id, expected: p.amount, received: v.amount }, 'PAYMENT_AMOUNT_MISMATCH on an order link: not marked paid');
              await this.settleOrder(tx, p.orderId, ['paymentLink']);
            }
            return;
          }
          const status = v.status === 'paid' ? 'paid' : v.status === 'expired' ? 'expired' : 'failed';
          const moved = await tx.orderPayment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status, paidAt: status === 'paid' ? new Date() : null } });
          if (!moved.count) return;
          const order = await this.orders.lock(tx, p.orderId);
          if (status === 'paid') {
            await this.effects.addPayment(tx, order, { amount: p.amount, method: 'card', reference: `chargily:${checkoutId}`, note: v.method ? `Chargily ${v.method === 'cib' ? 'CIB' : 'Edahabia'}` : 'Chargily', description: `Commande #${order.number} (paiement en ligne)` }, { type: 'system', id: null });
            const updated = await this.settleOrder(tx, p.orderId, ['paymentLink', 'amountPaid']);
            if (updated.paymentStatus === 'paid') await this.effects.webhook(tx, 'order.paid', p.orderId, { amountPaid: updated.amountPaid, method: 'card' }, ':paid');
            await this.effects.recomputeClient(tx, order.clientId);
            await this.effects.notify(tx, 'payment_received', { workspaceId: p.workspaceId, key: `payment_received:${p.id}`, roles: ['owner', 'admin'], data: { orderId: p.orderId, paymentId: p.id, amount: p.amount, number: order.number } });
            await this.effects.customerText(tx, order, 'paymentReceived', { number: order.number });
          } else {
            await this.settleOrder(tx, p.orderId, ['paymentLink']);
            await this.effects.notify(tx, 'payment_failed', { workspaceId: p.workspaceId, key: `payment_failed:${p.id}`, roles: ['owner', 'admin'], data: { orderId: p.orderId, paymentId: p.id, reason: status, number: order.number } });
            await this.effects.webhookData(tx, 'payment.failed', p.id, p.workspaceId, { orderId: p.orderId, paymentId: p.id, reason: status });
            await this.effects.customerText(tx, order, 'paymentFailed', { number: order.number });
          }
        },
        { timeout: 20_000 },
      ),
    );
    return true;
  }

  /** Links past their 15 min: verified once, then expired (part of `sched-payment-reconcile`). */
  async reconcile(now = new Date()) {
    const rows = await TenantContext.runSystem(() => prisma.orderPayment.findMany({ where: { status: 'pending', providerRef: { not: null }, expiresAt: { lt: now } }, take: 200 }));
    let n = 0;
    for (const p of rows) {
      let status: CheckoutStatus = 'expired';
      let amount = p.amount;
      let method: 'cib' | 'edahabia' | null = null;
      try {
        const v = await this.gateway.verify(p.providerRef!);
        if (v.status !== 'pending') ({ status, amount, method } = v);
      } catch (e) {
        if (!(e instanceof PaymentProviderError)) throw e;
        continue;
      }
      await this.onCheckout(p.providerRef!, { status, amount, method, raw: null }, 'reconcile');
      n++;
    }
    return n;
  }

  /** `POST /orders/:id/refunds { amount, reason, method? }` → the order detail. */
  async refund(orderId: string, input: { amount: number; reason: string; method?: PaymentMethod }, locale: string) {
    const t = TenantContext.get();
    const actor = this.orders.actor();
    let refundId = '';
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (o.amountPaid <= 0 || o.paymentStatus === 'refunded') throw new AppException('ORDER_PAYMENT_LOCKED');
      if (input.amount > o.amountPaid) throw new AppException('VALIDATION_ERROR', { max: o.amountPaid }, { amount: 'validation.range' });
      const entry = await this.effects.addPayment(tx, o, { amount: -input.amount, method: input.method ?? o.paymentMethod, reference: 'refund', note: input.reason, description: `Commande #${o.number} (remboursement)` }, actor);
      refundId = entry?.id ?? '';
      const paid = await this.effects.recomputePaid(tx, o);
      const updated = await tx.order.update({ where: { id: orderId }, data: { amountPaid: paid.amountPaid, paymentStatus: 'refunded', version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId, field: 'paymentStatus', from: o.paymentStatus, to: 'refunded', actorType: actor.type, actorId: actor.id } });
      const link = await tx.orderPayment.findFirst({ where: { orderId, status: 'paid' }, orderBy: { paidAt: 'desc' } });
      if (link) await tx.orderPayment.update({ where: { id: link.id }, data: { status: 'refunded', refundedAt: new Date(), refundReason: input.reason } });
      await this.effects.recomputeClient(tx, o.clientId);
      await this.effects.emitUpdated(tx, updated, ['amountPaid', 'paymentStatus']);
      await this.effects.sheets(tx, updated);
    }, locale);
    await this.audit.write({ workspaceId: t.workspaceId, actorType: 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action: 'order.refund', entity: 'Order', entityId: orderId, after: { amount: input.amount, reason: input.reason, refundId } });
    return this.orders.get(orderId, locale);
  }

  // --- AI tool `create_payment_link` (04-ai-pipeline §4.2) -------------------------------------------------------------------
  /** Offered when the workspace switched online payment on (and the `online_payment` flag allows it). */
  async enabledFor(workspaceId: string) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { onlinePaymentEnabled: true } });
    return !!ws?.onlinePaymentEnabled;
  }

  /** The tool: this customer's order only; an open link is reused; created synchronously (we are in the worker). */
  async forAi(ctx: { workspaceId: string; clientId: string | null; dryRun: boolean }, orderRef: string): Promise<Record<string, unknown>> {
    if (!(await this.enabledFor(ctx.workspaceId))) return { ok: false, error: { code: 'ONLINE_PAYMENT_DISABLED' }, paymentOptions: ['cod'] };
    if (!ctx.clientId) return { ok: false, error: { code: 'ORDER_NOT_FOUND' } };
    const isId = /^[0-9a-f-]{36}$/i.test(orderRef);
    const order = await prisma.order.findFirst({ where: { clientId: ctx.clientId, ...(isId ? { id: orderRef } : { number: { equals: orderRef, mode: 'insensitive' } }) } });
    if (!order) return { ok: false, error: { code: 'ORDER_NOT_FOUND' } };
    if (ctx.dryRun) return { ok: true, simulated: true, url: 'https://pay.chargily.net/test/checkout/simulated', amount: order.total - order.amountPaid, minutes: PAYMENT_LINK_MINUTES };
    const open = await prisma.orderPayment.findFirst({ where: { orderId: order.id, status: 'pending', checkoutUrl: { not: null }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (open) return { ok: true, orderNumber: order.number, url: open.checkoutUrl, amount: open.amount, expiresAt: aiDateTime(open.expiresAt!), minutes: PAYMENT_LINK_MINUTES };
    let p: OrderPayment;
    try {
      p = await prisma.$transaction(async (db) => (await this.open(db as Tx, order.id, { send: false, source: 'ai', createdBy: null })).payment);
    } catch (e) {
      if (e instanceof AppException && e.code === 'ORDER_PAYMENT_LOCKED') return { ok: false, error: { code: 'ORDER_PAYMENT_LOCKED' }, orderNumber: order.number };
      throw e;
    }
    try {
      // the payment page is the customer's: shop language, not the member's screen language (07 §4 Language source)
      const created = await this.checkout(p, order.number, TenantContext.get().locale);
      await prisma.orderPayment.update({ where: { id: p.id }, data: { checkoutUrl: created.url, providerRef: created.checkoutId, expiresAt: created.expiresAt } });
      await prisma.$transaction(async (db) => {
        const o = await (db as Tx).order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
        await this.effects.emitUpdated(db as Tx, o, ['paymentLink']);
      });
      return { ok: true, orderNumber: order.number, url: created.url, amount: p.amount, expiresAt: aiDateTime(created.expiresAt), minutes: PAYMENT_LINK_MINUTES };
    } catch (e) {
      await prisma.$transaction(async (db) => {
        await (db as Tx).orderPayment.update({ where: { id: p.id }, data: { status: 'failed' } });
        await this.settleOrder(db as Tx, order.id, ['paymentLink']);
      });
      return { ok: false, error: { code: 'PAYMENT_LINK_UNAVAILABLE' }, paymentOptions: ['cod'], detail: e instanceof Error ? e.message : 'error' };
    }
  }
}
