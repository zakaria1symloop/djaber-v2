// 05-integrations §4.3 / BIL-02 / FL-28 — every Chargily checkout of the platform (plans, invoices, credit packs; order
// links have their own rows, order-payment.service.ts) is a `BillingPayment(status=pending, providerCheckoutId)` whose
// `raw.intent` says what to activate. Activation runs once: `UPDATE … WHERE status='pending'` (05 §4.3 / "Don't activate a
// subscription twice for one checkout"), whichever comes first — the webhook, the return-page poll (one `verify` per poll,
// 03-events §7 exception) or `sched-payment-reconcile`. The amount must equal the expected one (else held for review,
// `PAYMENT_AMOUNT_MISMATCH` + admin alert). Webhooks: raw-body signature, `InboundEvent` dedup on the event id, job
// `payments/payment-webhook` (`pay:<eventId>`), 200 at once.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHECKOUT_EXPIRES_MIN, formatMoney, type BillingPaymentDto, type CheckoutReturnDto } from '@djaber/shared';
import { AdminNotifier } from '../notifications/admin-notifier.service';
import { prisma, Prisma, rawPrisma, TenantContext, type BillingPayment, type PaymentMethodBilling, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { PAYMENT_GATEWAY, PaymentProviderError, type CheckoutStatus, type PaymentGateway } from './gateway/payment-gateway';
import { DAY_MS } from './billing.util';

export type PaymentIntent =
  | { kind: 'subscription'; mode: 'upgrade' | 'new_period' | 'renewal'; planId: string; cycle: 'monthly' | 'yearly'; amount: number; amountBeforePromo: number; prorataDays: number | null; promoId: string | null; userId: string | null }
  | { kind: 'invoice'; invoiceId: string; userId: string | null }
  | { kind: 'pack'; purchaseId: string; userId: string | null };
type Raw = { intent?: PaymentIntent; flagged?: { reason: string; amount: number; at: string } | null; events?: unknown[]; failureReason?: string | null };
export type PaidInfo = { paymentId: string; amount: number; method: PaymentMethodBilling | null; provider: 'chargily' | 'manual'; reference: string | null; paidAt: Date };
/** Activators registered by the subscription / pack services: run inside the activation transaction, tenant set. */
export type Activator = (tx: Tx, intent: PaymentIntent, paid: PaidInfo) => Promise<{ invoiceId: string | null }>;
export type OrderCheckoutHandler = (checkoutId: string, v: { status: CheckoutStatus; amount: number; method: 'cib' | 'edahabia' | null; raw: unknown }, source: 'webhook' | 'reconcile') => Promise<boolean>;

const MIN_AMOUNT = 50; // Chargily refuses checkouts below 50 DA

@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly log = new Logger(PaymentService.name);
  private readonly activators = new Map<PaymentIntent['kind'], Activator>();
  private readonly failers = new Map<PaymentIntent['kind'], (tx: Tx, intent: PaymentIntent) => Promise<void>>();
  private orderHandler: OrderCheckoutHandler | null = null;

  constructor(
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
    private readonly config: ConfigService,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly audit: AuditService,
    private readonly admins: AdminNotifier,
  ) {}

  onModuleInit() {
    this.registry.register('payments', 'payment-webhook', (data: { inboundEventId: string }) => this.processWebhook(data.inboundEventId), { concurrency: 4 });
    // 05-integrations §4.2 `sched-payment-reconcile`: pending checkouts younger than 24 h are verified, older ones expire
    this.registry.cron('sched-payment-reconcile', '*/10 * * * *', () => this.reconcile());
  }

  register(kind: PaymentIntent['kind'], fn: Activator, onFail?: (tx: Tx, intent: PaymentIntent) => Promise<void>) {
    this.activators.set(kind, fn);
    if (onFail) this.failers.set(kind, onFail);
  }
  onOrderCheckout(fn: OrderCheckoutHandler) {
    this.orderHandler = fn;
  }

  static get minAmount() {
    return MIN_AMOUNT;
  }

  private web(path: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}${path}`;
  }

  /** Creates the Chargily checkout and its pending `BillingPayment` (the return URL carries our ref). */
  async start(o: { amount: number; description: string; intent: PaymentIntent; invoiceId?: string | null; locale: 'fr' | 'ar' | 'en'; subscriptionId?: string | null }): Promise<{ checkoutUrl: string; ref: string }> {
    const workspaceId = TenantContext.workspaceId();
    if (o.amount < MIN_AMOUNT) throw new AppException('VALIDATION_ERROR', { min: MIN_AMOUNT }, { amount: 'validation.range' });
    const ref = randomUUID();
    const returnUrl = this.web(`/${o.locale}/settings/billing/return?ref=${ref}`);
    let created;
    try {
      created = await this.gateway.createCheckout({ amount: o.amount, currency: 'DZD', orderRef: ref, description: o.description, returnUrl, failUrl: returnUrl, metadata: { workspaceId, kind: o.intent.kind, targetId: o.intent.kind === 'invoice' ? o.intent.invoiceId : o.intent.kind === 'pack' ? o.intent.purchaseId : o.intent.planId }, expiresInMin: CHECKOUT_EXPIRES_MIN, locale: o.locale });
    } catch (e) {
      if (e instanceof PaymentProviderError) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'Chargily' });
      throw e;
    }
    await prisma.billingPayment.create({
      data: { id: ref, workspaceId, invoiceId: o.invoiceId ?? null, subscriptionId: o.subscriptionId ?? null, amount: o.amount, status: 'pending', provider: 'chargily', providerCheckoutId: created.checkoutId, raw: { intent: o.intent } as unknown as Prisma.InputJsonValue },
    });
    return { checkoutUrl: created.url, ref };
  }

  /**
   * Runs an activation without any gateway (manual payment by finance, waived amounts, dev "renew"): a paid
   * `BillingPayment(provider=manual)` + the activator, in the caller's transaction.
   */
  async activateManually(tx: Tx, o: { intent: PaymentIntent; amount: number; method: PaymentMethodBilling | null; reference: string | null; invoiceId?: string | null; recordedById?: string | null; proofUploadId?: string | null; paidAt?: Date }) {
    const id = randomUUID();
    const paidAt = o.paidAt ?? new Date();
    await tx.billingPayment.create({ data: { id, workspaceId: TenantContext.workspaceId(), invoiceId: o.invoiceId ?? null, amount: o.amount, status: 'paid', provider: 'manual', providerCheckoutId: `manual:${id}`, reference: o.reference, recordedById: o.recordedById ?? null, proofUploadId: o.proofUploadId ?? null, paidAt, raw: { intent: o.intent } as unknown as Prisma.InputJsonValue } });
    const fn = this.activators.get(o.intent.kind);
    const r = fn ? await fn(tx, o.intent, { paymentId: id, amount: o.amount, method: o.method, provider: 'manual', reference: o.reference, paidAt }) : { invoiceId: null };
    if (r.invoiceId) await tx.billingPayment.update({ where: { id }, data: { invoiceId: r.invoiceId } });
    return { paymentId: id, invoiceId: r.invoiceId };
  }

  // --- the one activation path ----------------------------------------------------------------------------------------------
  /**
   * Applies a gateway verdict to its BillingPayment. Returns true when the checkout belongs to a BillingPayment.
   * Idempotent: only a `pending` row moves (a replayed webhook / poll is a no-op).
   */
  async applyVerdict(checkoutId: string, v: { status: CheckoutStatus; amount: number; method: 'cib' | 'edahabia' | null; raw: unknown; failureReason?: string }, source: 'webhook' | 'return' | 'reconcile'): Promise<boolean> {
    const row = await TenantContext.runSystem(() => prisma.billingPayment.findUnique({ where: { providerCheckoutId: checkoutId } }));
    if (!row) return false;
    if (row.status !== 'pending' || v.status === 'pending') return true;
    const tenant = await this.tenants.forWorker(row.workspaceId).catch(() => null);
    if (!tenant) return true;
    const raw = (row.raw ?? {}) as Raw;
    if (v.status === 'paid' && v.amount !== row.amount) {
      // 05 §4.3: amount mismatch ⇒ not activated, held for review, admin alert (once)
      if (!raw.flagged) {
        await TenantContext.runSystem(() => prisma.billingPayment.update({ where: { id: row.id }, data: { raw: { ...raw, flagged: { reason: 'PAYMENT_AMOUNT_MISMATCH', amount: v.amount, at: new Date().toISOString() } } as unknown as Prisma.InputJsonValue } }));
        this.log.error({ paymentId: row.id, expected: row.amount, received: v.amount, source }, 'PAYMENT_AMOUNT_MISMATCH: checkout paid with another amount, not activated');
        await this.audit.write({ workspaceId: row.workspaceId, actorType: 'system', action: 'payment.amount_mismatch', entity: 'BillingPayment', entityId: row.id, after: { expected: row.amount, received: v.amount, source } });
        const shop = await TenantContext.runSystem(() => prisma.workspace.findUnique({ where: { id: row.workspaceId }, select: { name: true } }));
        await this.admins.notify(prisma, { kind: 'payment_mismatch', key: `payment_mismatch:${row.id}`, params: { workspace: shop?.name ?? '—', expected: formatMoney(row.amount), received: formatMoney(v.amount) }, ids: { workspaceId: row.workspaceId } });
      }
      return true;
    }
    await TenantContext.run(tenant, () =>
      prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          const status = v.status === 'paid' ? 'paid' : v.status === 'expired' ? 'expired' : 'failed';
          const moved = await tx.billingPayment.updateMany({ where: { id: row.id, status: 'pending' }, data: { status, paidAt: status === 'paid' ? new Date() : null, reference: checkoutId, raw: { ...raw, failureReason: v.failureReason ?? null, events: [...(raw.events ?? []), { source, status: v.status, at: new Date().toISOString() }] } as unknown as Prisma.InputJsonValue } });
          if (!moved.count || !raw.intent) return;
          // owner request 09/11: the Djaber team is told of every payment (a checkout left to expire is not news)
          const shop = await tx.workspace.findUnique({ where: { id: row.workspaceId }, select: { name: true } });
          const told = { workspace: shop?.name ?? '—', amount: formatMoney(row.amount), what: raw.intent.kind };
          if (status !== 'paid') {
            await this.failers.get(raw.intent.kind)?.(tx, raw.intent);
            if (status === 'failed') await this.admins.notify(tx, { kind: 'payment_failed', key: `payment_failed:${row.id}`, params: told, ids: { workspaceId: row.workspaceId } });
            return;
          }
          await this.admins.notify(tx, { kind: 'payment_received', key: `payment_received:${row.id}`, params: told, ids: { workspaceId: row.workspaceId } });
          const fn = this.activators.get(raw.intent.kind);
          if (!fn) throw new Error(`no activator for ${raw.intent.kind}`);
          const r = await fn(tx, raw.intent, { paymentId: row.id, amount: row.amount, method: v.method, provider: 'chargily', reference: checkoutId, paidAt: new Date() });
          if (r.invoiceId) await tx.billingPayment.update({ where: { id: row.id }, data: { invoiceId: r.invoiceId } });
        },
        { timeout: 30_000 },
      ),
    );
    await this.tenants.invalidate(row.workspaceId);
    return true;
  }

  // --- webhook ---------------------------------------------------------------------------------------------------------------
  /** `POST /webhooks/chargily`: signature on the raw body (null ⇒ 401), event stored + job queued atomically, no gateway call. */
  async ingestWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined): Promise<{ received: number }> {
    const ev = this.gateway.parseWebhook(headers, rawBody ?? Buffer.alloc(0));
    if (!ev) {
      this.log.warn('chargily webhook refused: invalid signature');
      throw new AppException('WEBHOOK_SIGNATURE_INVALID');
    }
    const externalId = `chargily:${ev.eventId}`;
    const payload = { checkoutId: ev.checkoutId, status: ev.status, amount: ev.amount, method: ev.method, metadata: ev.metadata, failureReason: ev.failureReason ?? null, body: ev.raw };
    const workspaceId = ev.metadata.workspaceId && /^[0-9a-f-]{36}$/i.test(ev.metadata.workspaceId) ? ev.metadata.workspaceId : null;
    const opts = JSON.stringify({ attempts: 5, backoff: { type: 'fixed', delay: 30_000 } });
    const n = await rawPrisma.$executeRaw`
      WITH ev AS (
        INSERT INTO "InboundEvent" ("id","provider","externalId","payload","receivedAt")
        VALUES (uuid_generate_v7(), 'chargily'::"InboundProvider", ${externalId}, ${JSON.stringify(payload)}::jsonb, now())
        ON CONFLICT ("externalId") DO NOTHING
        RETURNING "id","externalId"
      )
      INSERT INTO "Outbox" ("id","workspaceId","topic","key","payload","attempts","createdAt")
      SELECT uuid_generate_v7(), ${workspaceId}::uuid, 'job', 'pay:' || ev."externalId",
             jsonb_build_object('queue', 'payments', 'name', 'payment-webhook', 'data', jsonb_build_object('inboundEventId', ev."id"), 'opts', ${opts}::jsonb),
             0, now()
      FROM ev
      ON CONFLICT ("topic","key") DO NOTHING`;
    return { received: n };
  }

  /** `payments.payment-webhook`: applies the event (billing first, then order links). */
  async processWebhook(inboundEventId: string) {
    const ev = await TenantContext.runSystem(() => prisma.inboundEvent.findUnique({ where: { id: inboundEventId } }));
    if (!ev || ev.processedAt) return;
    const p = ev.payload as { checkoutId: string; status: CheckoutStatus; amount: number; method: 'cib' | 'edahabia' | null; failureReason?: string | null; body: unknown };
    let handled = await this.applyVerdict(p.checkoutId, { status: p.status, amount: p.amount, method: p.method, raw: p.body, ...(p.failureReason ? { failureReason: p.failureReason } : {}) }, 'webhook');
    if (!handled && this.orderHandler) handled = await this.orderHandler(p.checkoutId, { status: p.status, amount: p.amount, method: p.method, raw: p.body }, 'webhook');
    await TenantContext.runSystem(() => prisma.inboundEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error: handled ? null : 'unknown_checkout' } }));
  }

  // --- return page -----------------------------------------------------------------------------------------------------------
  private async row(ref: string): Promise<BillingPayment> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(ref);
    const r = await prisma.billingPayment.findFirst({ where: isUuid ? { OR: [{ id: ref }, { providerCheckoutId: ref }] } : { providerCheckoutId: ref } });
    if (!r || r.provider !== 'chargily') throw notFound();
    return r;
  }

  /** `GET /billing/checkout/return?ref` — one `verify` per poll while pending (FL-28), never trusts the browser. */
  async returnStatus(ref: string, describe: (p: BillingPayment) => Promise<Omit<CheckoutReturnDto, 'status' | 'failureReason'>>): Promise<CheckoutReturnDto> {
    let r = await this.row(ref);
    if (r.status === 'pending' && !((r.raw ?? {}) as Raw).flagged) {
      try {
        const v = await this.gateway.verify(r.providerCheckoutId);
        if (v.status !== 'pending') {
          await this.applyVerdict(r.providerCheckoutId, v, 'return');
          r = await this.row(r.id);
        }
      } catch (e) {
        if (!(e instanceof PaymentProviderError)) throw e;
        // the gateway is unreachable: the page keeps polling, the webhook / reconcile job will settle it
      }
    }
    const raw = (r.raw ?? {}) as Raw;
    const open = Date.now() - r.createdAt.getTime() < CHECKOUT_EXPIRES_MIN * 60_000;
    const status: CheckoutReturnDto['status'] = r.status === 'paid' ? 'success' : r.status === 'failed' ? 'failed' : r.status === 'expired' ? 'expired' : raw.flagged || !open ? 'pending' : 'verifying';
    return { status, ...(await describe(r)), failureReason: r.status === 'failed' ? (raw.failureReason ?? 'PAYMENT_FAILED') : null };
  }

  intentOf(p: Pick<BillingPayment, 'raw'>): PaymentIntent | null {
    return ((p.raw ?? {}) as Raw).intent ?? null;
  }

  /** `GET /billing/payments`. */
  async list(q: { page: number; pageSize: number }): Promise<Page<BillingPaymentDto>> {
    const [rows, total] = await Promise.all([prisma.billingPayment.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { invoice: { select: { method: true } } }, ...toSkipTake(q) }), prisma.billingPayment.count()]);
    return page(
      rows.map((r) => {
        const intent = this.intentOf(r);
        return { id: r.id, amount: r.amount, status: r.status, provider: r.provider, method: r.invoice?.method ?? null, reference: r.reference, invoiceId: r.invoiceId, kind: r.provider === 'manual' && !intent ? 'manual' : (intent?.kind ?? 'manual'), createdAt: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null };
      }),
      total,
      q,
    );
  }

  // --- sched-payment-reconcile ------------------------------------------------------------------------------------------------
  /** Pending checkouts: younger than 24 h ⇒ verified; older ⇒ expired. Order links are reconciled by their own service. */
  async reconcile(now = new Date()) {
    const rows = await TenantContext.runSystem(() => prisma.billingPayment.findMany({ where: { status: 'pending', provider: 'chargily', createdAt: { lt: new Date(now.getTime() - 60_000) } }, take: 500, orderBy: { createdAt: 'asc' } }));
    let n = 0;
    for (const r of rows) {
      if (((r.raw ?? {}) as Raw).flagged) continue;
      if (now.getTime() - r.createdAt.getTime() > DAY_MS) {
        await this.applyVerdict(r.providerCheckoutId, { status: 'expired', amount: r.amount, method: null, raw: { reason: 'reconcile_24h' } }, 'reconcile');
        n++;
        continue;
      }
      try {
        const v = await this.gateway.verify(r.providerCheckoutId);
        if (v.status !== 'pending') {
          await this.applyVerdict(r.providerCheckoutId, v, 'reconcile');
          n++;
        }
      } catch (e) {
        if (!(e instanceof PaymentProviderError)) throw e;
      }
    }
    return n;
  }
}
