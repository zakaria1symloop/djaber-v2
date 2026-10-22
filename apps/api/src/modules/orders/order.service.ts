// ORD-01 / ORD-02 / ORD-05 / ORD-06 / ORD-08 / ORD-10 — orders: numbering (`CMD-1001…`, legacy kept), manual / API /
// AI creation with the shared validation and the CLI-02 client rule, list + KPIs + export, order page, PATCH with
// optimistic `version`, delete with rollback, duplicate. Status changes, calls, payments… live in OrderWorkflowService.
// Side effects (stock, cash, aggregates, outbox) only through OrderEffects (04 §3).
import { formatSlipAmount } from './print/order-slip.pdf';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AI_ORDER_DUPLICATE_WINDOW_MIN, ORDER_READ_ONLY_STATUSES, formatMoney, type CreateOrderInput, type OrderDraft, type OrderListItemView, type OrderView, type OrdersExportQuery, type OrdersQuery, type UpdateOrderInput } from '@djaber/shared';
import { prisma, TenantContext, type Order, type Prisma, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CounterService } from '../../core/counter/counter.service';
import { AppException, conflict, forbidden, notFound } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { can } from '../../core/rbac/permission-matrix';
import { algiersDay, algiersTime } from '../../core/time/algiers';
import type { CreateOrderRequest, OrderToolContext, ToolResult } from '../ai/tools/order-tools';
import { fold } from '../ai/tools/wilaya-aliases';
import { ClientService } from '../clients/client.service';
import { feeExplanation, FeeService, quoteFee } from '../delivery/fee.service';
import { GeoService } from '../delivery/geo.service';
import { ExportService } from '../jobs/export.service';
import { contextOf, type ConversationContext } from '../messaging/messaging.presenter';
import { SafetyService } from '../messaging/safety.service';
import { OrderEffects, type Actor } from './order-effects.service';
import { checkOrderedAt, checkPaymentPatch, isTerminal, orderTotals, type Refusal, type StockLine } from './order-rules';
import { ACTIVE_SHIPMENT, hasDeliveryAddress, ORDER_DETAIL_INCLUDE, ORDER_LIST_INCLUDE, presentOrder, presentOrderListItem, type PresentCtx } from './order.presenter';
import { orderOrderBy, orderStats, orderWhere, type OrderFilters } from './order.query';

const MIN = 60_000;
export const refuse = (r: Refusal) => new AppException(r.code, r.params ?? {}, r.fields ?? {});
/** Thrown inside a transaction when the row moved on; turned into 409 CONFLICT with `details.current` outside it. */
export class StaleVersion extends Error {
  constructor(readonly orderId: string) {
    super('stale order version');
  }
}
type LockedOrder = Prisma.OrderGetPayload<{ include: { items: true; shipments: true } }>;
type Line = { productId: string; variantId: string | null; productName: string; variantName: string | null; sku: string | null; unitPrice: number; costPrice: number | null; quantity: number; discount: number; trackStock: boolean };

@Injectable()
export class OrderService implements OnModuleInit {
  constructor(
    readonly effects: OrderEffects,
    private readonly counter: CounterService,
    readonly fees: FeeService,
    readonly geo: GeoService,
    readonly clients: ClientService,
    readonly safety: SafetyService,
    private readonly exports: ExportService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('orders', (filters, ctx) => this.exportTable(filters as OrdersExportQuery, ctx.locale));
  }

  // --- context helpers ------------------------------------------------------------------------------------------------
  actor(): Actor {
    const t = TenantContext.get();
    return t.apiKeyId ? { type: 'api', id: null } : { type: 'user', id: t.userId ?? null };
  }

  async presentCtx(locale: string): Promise<PresentCtx> {
    const [index, couriers, ws] = await Promise.all([this.safety.index(), prisma.courierAccount.count({ where: { isActive: true } }), prisma.workspace.findUnique({ where: { id: TenantContext.workspaceId() }, select: { onlinePaymentEnabled: true } })]);
    return {
      onlinePayment: !!ws?.onlinePaymentEnabled,
      locale: locale === 'ar' || locale === 'en' ? locale : 'fr',
      blocked: (clientId, phone) => index.has({ clientId, channelId: '', externalSenderId: '' }, phone),
      hasCourier: couriers > 0,
      publicWebUrl: this.config.get('PUBLIC_WEB_URL'),
    };
  }

  /** Row-locks the order (`SELECT … FOR UPDATE`) and returns it with its items and shipments. 404 across workspaces. */
  async lock(tx: Tx, id: string): Promise<LockedOrder> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" = ${id}::uuid AND "workspaceId" = ${TenantContext.workspaceId()}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, shipments: { orderBy: { createdAt: 'desc' } } } });
  }

  activeShipment(o: { shipments: { provider: string; status: string; id: string }[] }) {
    return o.shipments.find((s) => (ACTIVE_SHIPMENT as readonly string[]).includes(s.status)) ?? null;
  }

  /** 409 CONFLICT `{ changedBy, changedAt, current }` (api-contract §1.8, merge-by-section dialog). */
  async conflictOf(id: string, locale = 'fr') {
    const [current, last] = await Promise.all([this.get(id, locale), prisma.orderStatusHistory.findFirst({ where: { orderId: id }, orderBy: { at: 'desc' } })]);
    let changedBy: string | null = null;
    if (last?.actorType === 'user' && last.actorId) {
      const u = await prisma.user.findUnique({ where: { id: last.actorId }, select: { firstName: true, lastName: true } });
      changedBy = u ? `${u.firstName} ${u.lastName}`.trim() : null;
    }
    return conflict({ changedBy, changedAt: current.updatedAt, current });
  }

  /** Runs `fn` in a transaction; a StaleVersion becomes the 409 CONFLICT with the current order. */
  async inTx<T>(fn: (tx: Tx) => Promise<T>, locale = 'fr'): Promise<T> {
    try {
      return await prisma.$transaction((db) => fn(db as Tx), { timeout: 20_000 });
    } catch (e) {
      if (e instanceof StaleVersion) throw await this.conflictOf(e.orderId, locale);
      throw e;
    }
  }

  // --- reads ------------------------------------------------------------------------------------------------------------
  async list(q: OrdersQuery, locale: string): Promise<Page<OrderListItemView>> {
    const { page: p, pageSize, sort, view: _view, ...filters } = q;
    const where = orderWhere(filters);
    const [rows, total, ctx] = await Promise.all([
      prisma.order.findMany({ where, include: ORDER_LIST_INCLUDE, orderBy: orderOrderBy(sort), skip: (p - 1) * pageSize, take: pageSize }),
      prisma.order.count({ where }),
      this.presentCtx(locale),
    ]);
    return page(rows.map((o) => presentOrderListItem(o, ctx)), total, q);
  }

  stats(q: OrderFilters) {
    return orderStats(q);
  }

  async get(id: string, locale = 'fr'): Promise<OrderView> {
    const o = await prisma.order.findFirst({ where: { id }, include: ORDER_DETAIL_INCLUDE });
    if (!o) throw notFound();
    const userIds = [...new Set(o.history.filter((h) => h.actorType === 'user' && h.actorId).map((h) => h.actorId!))];
    const agentIds = [...new Set(o.history.filter((h) => h.actorType === 'ai' && h.actorId).map((h) => h.actorId!))];
    const [payments, users, agents, ctx, rule, ws] = await Promise.all([
      prisma.paymentEntry.findMany({ where: { sourceType: 'order', sourceId: id }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], include: { createdBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } }),
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
      agentIds.length ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [],
      this.presentCtx(locale),
      o.wilayaId ? prisma.deliveryFeeRule.findFirst({ where: { wilayaId: o.wilayaId } }) : null,
      prisma.workspace.findUniqueOrThrow({ where: { id: o.workspaceId }, select: { freeDeliveryThreshold: true } }),
    ]);
    const actorNames = new Map<string, string>([...users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()] as [string, string]), ...agents.map((a) => [a.id, a.name] as [string, string])]);
    let explanation = '';
    if (o.wilayaId) {
      const grid = quoteFee(rule, { wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, subtotal: o.subtotal, threshold: ws.freeDeliveryThreshold });
      const q = grid.fee === o.deliveryFee || !grid.wilayaServed ? grid : quoteFee(rule, { wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, subtotal: o.subtotal, threshold: ws.freeDeliveryThreshold, override: o.deliveryFee });
      explanation = feeExplanation(q, o.wilaya?.nameFr ?? null);
    }
    return presentOrder(o, { payments, actorNames, feeExplanation: explanation }, ctx);
  }

  async history(id: string, locale: string) {
    return (await this.get(id, locale)).history;
  }

  // --- lines & money ----------------------------------------------------------------------------------------------------
  /** Catalogue lines with snapshots (04 §4 "prices snapshotted on lines"); 422 VARIANT_REQUIRED on a variant product without variant. */
  async resolveLines(tx: Tx, items: CreateOrderInput['items']): Promise<Line[]> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { variants: { where: { deletedAt: null } } } });
    const by = new Map(products.map((p) => [p.id, p]));
    return items.map((i, n) => {
      const p = by.get(i.productId);
      if (!p) throw new AppException('VALIDATION_ERROR', {}, { [`items.${n}.productId`]: 'validation.invalid' });
      if (p.hasVariants && !i.variantId) throw new AppException('VARIANT_REQUIRED', {}, { [`items.${n}.variantId`]: 'validation.required' });
      const v = i.variantId ? p.variants.find((x) => x.id === i.variantId) : null;
      if (i.variantId && !v) throw new AppException('VARIANT_NOT_FOUND', {}, { [`items.${n}.variantId`]: 'validation.invalid' });
      return {
        productId: p.id,
        variantId: v?.id ?? null,
        productName: p.name,
        variantName: v?.name ?? null,
        sku: v?.sku ?? p.sku,
        unitPrice: i.unitPrice ?? v?.price ?? p.price,
        costPrice: v?.costPrice ?? p.costPrice ?? null,
        quantity: i.quantity,
        discount: i.discount ?? 0,
        trackStock: p.trackStock,
      };
    });
  }

  stockLines(lines: { productId: string; variantId: string | null; quantity: number; trackStock: boolean }[]): StockLine[] {
    return lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, trackStock: l.trackStock }));
  }

  async itemLines(tx: Tx, orderId: string): Promise<StockLine[]> {
    const items = await tx.orderItem.findMany({ where: { orderId }, include: { product: { select: { trackStock: true } } } });
    return items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, trackStock: i.product.trackStock }));
  }

  // --- create (manual / mobile / API) -----------------------------------------------------------------------------------
  /** `POST /orders` (Idempotency-Key required). */
  async create(input: CreateOrderInput, locale: string, source: 'manual' | 'mobile' | 'api' | 'import' = 'manual', o: { importJobId?: string } = {}): Promise<OrderView> {
    const t = TenantContext.get();
    const actor = this.actor();
    const orderedAt = input.orderedAt ? new Date(input.orderedAt) : new Date();
    const r = checkOrderedAt(orderedAt);
    if (r) throw refuse(r);
    const money = can(t.role, 'orders.money') || !!t.apiKeyId;
    // 04 §4: fee / discount overrides are Admin+ (`orders.money`)
    if (!money && (input.delivery?.deliveryFee !== undefined || (input.discount ?? 0) > 0 || input.items.some((i) => (i.discount ?? 0) > 0))) throw forbidden();
    if (input.status === 'confirmed' && !input.delivery) throw new AppException('ORDER_ADDRESS_REQUIRED');

    const id = await this.inTx(async (tx) => {
      const conversation = input.conversationId ? await tx.conversation.findFirst({ where: { id: input.conversationId, deletedAt: null } }) : null;
      if (input.conversationId && !conversation) throw new AppException('VALIDATION_ERROR', {}, { conversationId: 'validation.invalid' });
      if (input.assigneeId && !(await tx.membership.findFirst({ where: { workspaceId: t.workspaceId, userId: input.assigneeId } }))) throw new AppException('VALIDATION_ERROR', {}, { assigneeId: 'validation.invalid' });
      const { client, created } = await this.clients.resolveForOrder(tx, input.client, { source: source === 'api' ? 'api' : source === 'import' ? 'import' : 'manual', conversationClientId: conversation?.clientId });
      // 04 §13: a blocked customer needs the explicit confirmation of the warning
      const index = await this.safety.index(tx);
      if (!input.confirm && (index.has({ clientId: client.id, channelId: conversation?.channelId ?? '', externalSenderId: conversation?.externalSenderId ?? '' }, client.phone))) {
        throw new AppException('CUSTOMER_BLOCKED', { clientName: client.name });
      }
      const lines = await this.resolveLines(tx, input.items);
      const d = input.delivery ?? null;
      if (d) await this.geo.checkAddress(d, tx, 'delivery.communeId');
      const { subtotal } = orderTotals(lines, { deliveryFee: 0 });
      let deliveryFee = 0;
      if (d) {
        const q = await this.fees.quote({ wilayaId: d.wilayaId, isStopdesk: d.isStopdesk, subtotal: subtotal - (input.discount ?? 0), override: d.deliveryFee ?? null }, tx);
        if (!q.wilayaServed || q.reason === 'stopdesk_unavailable') throw new AppException('WILAYA_NOT_SERVED', {}, { 'delivery.wilayaId': 'validation.wilaya' });
        deliveryFee = q.fee;
      }
      const totals = orderTotals(lines, { discount: input.discount ?? 0, deliveryFee });
      if (totals.total < 0) throw new AppException('VALIDATION_ERROR', {}, { discount: 'validation.range' });
      if ((input.amountPaid ?? 0) > totals.total) throw new AppException('VALIDATION_ERROR', {}, { amountPaid: 'validation.range' });
      const address = { wilayaId: d?.wilayaId ?? null, communeId: d?.communeId ?? null, communeText: d?.communeText ?? null, address: d?.address ?? null, isStopdesk: d?.isStopdesk ?? false, stopdeskId: d?.stopdeskId ?? null };
      if (input.status === 'confirmed' && !hasDeliveryAddress(address)) throw new AppException('ORDER_ADDRESS_REQUIRED');
      const phone = 'id' in input.client ? (client.phone ?? '') : input.client.phone;
      const number = await this.counter.next(tx, 'order');
      const order = await tx.order.create({
        data: {
          workspaceId: t.workspaceId,
          number,
          clientId: client.id,
          conversationId: conversation?.id ?? null,
          channelId: conversation?.channelId ?? null,
          source,
          importJobId: o.importJobId ?? null,
          createdById: source === 'api' ? null : (t.userId ?? null),
          apiKeyId: t.apiKeyId ?? null,
          assigneeId: input.assigneeId ?? null,
          status: input.status,
          confirmationStatus: input.status === 'confirmed' ? 'confirmed' : 'pending',
          confirmedAt: input.status === 'confirmed' ? new Date() : null,
          paymentMethod: input.paymentMethod,
          clientName: 'id' in input.client ? client.name : input.client.name,
          clientPhone: phone,
          clientPhone2: 'id' in input.client ? client.phone2 : (input.client.phone2 ?? null),
          ...address,
          subtotal: totals.subtotal,
          discount: input.discount ?? 0,
          deliveryFee,
          total: totals.total,
          riskLevel: client.riskLevel,
          notes: input.notes ?? null,
          orderedAt,
          items: { create: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, sku: l.sku, unitPrice: l.unitPrice, costPrice: l.costPrice, quantity: l.quantity, discount: l.discount, total: totals.lineTotals[i]! })) },
        },
      });
      await this.afterCreate(tx, order, lines, actor, { amountPaid: input.amountPaid ?? 0, clientCreated: created });
      return order.id;
    }, locale);
    return this.get(id, locale);
  }

  /** Effects common to every creation path (04 §3 "Order created"). */
  private async afterCreate(tx: Tx, order: Order, lines: StockLine[], actor: Actor, o: { amountPaid: number; clientCreated: boolean; releasing?: string[] }) {
    await this.effects.holdStock(tx, order, lines, actor.type === 'user' ? actor.id : null, o.releasing ?? []);
    let current = order;
    if (o.amountPaid > 0) {
      await this.effects.addPayment(tx, order, { amount: o.amountPaid, method: order.paymentMethod, description: `Commande #${order.number} (acompte)` }, actor);
      const paid = await this.effects.recomputePaid(tx, order);
      current = await tx.order.update({ where: { id: order.id }, data: paid });
    }
    await tx.orderStatusHistory.create({ data: { orderId: order.id, field: 'status', from: null, to: order.status, actorType: actor.type, actorId: actor.id } });
    await this.effects.recomputeClient(tx, order.clientId);
    await this.effects.recoConversions(tx, order);
    await this.effects.emitCreated(tx, current);
    await this.effects.webhook(tx, 'order.created', order.id);
    if (current.paymentStatus === 'paid') await this.effects.webhook(tx, 'order.paid', order.id, { amountPaid: current.amountPaid, method: current.paymentMethod }, ':paid');
    await this.effects.sheets(tx, current);
    await this.effects.threadEvent(tx, order, 'order_created', { orderId: order.id, number: order.number, total: order.total });
  }

  // --- create by the AI (ORDER_TOOLS port, 04-ai-pipeline §4.2 create_order) ---------------------------------------------
  /**
   * FL-02 step 7 in one transaction: blocked / risky guards, wrong-number confirmation, duplicate guard (same phone + same
   * items within 10 min ⇒ the existing order), CLI-02 client merge, `CMD-n`, conditional stock decrement (failure rolls
   * everything back), cart closed, `order.ai_created`. Idempotent on `runId:callId` (api-contract §1.7). 0 credits.
   */
  async createFromAi(ctx: OrderToolContext, req: CreateOrderRequest): Promise<ToolResult> {
    const key = `ai:${ctx.runId}:${ctx.callId}`;
    const stored = await prisma.idempotencyKey.findFirst({ where: { key } });
    if (stored) return stored.responseBody as ToolResult;
    const agent = await prisma.agent.findFirst({ where: { id: ctx.agentId }, select: { id: true, name: true, riskyClientBehavior: true } });
    const conversation = ctx.conversationId ? await prisma.conversation.findFirst({ where: { id: ctx.conversationId }, include: { channel: { select: { name: true } } } }) : null;
    const owner = await prisma.client.findFirst({ where: { phone: req.clientPhone, deletedAt: null } });
    const convClient = conversation?.clientId ? await prisma.client.findFirst({ where: { id: conversation.clientId } }) : null;
    const index = await this.safety.index();
    const blocked = index.phones.has(req.clientPhone) || (owner && index.clientIds.has(owner.id)) || (conversation && index.has(conversation, convClient?.phone));
    // 04 §13: the AI says the shop cannot take the order and hands off — never "you are blocked"
    if (blocked) return { ok: false, error: { code: 'CUSTOMER_BLOCKED' }, hint: 'handoff' };
    // 04 §21: after a "faux numéro" the AI confirms the number with the customer before ordering again
    if (owner && !req.phoneConfirmed && (await prisma.order.count({ where: { clientId: owner.id, cancelReason: 'fake' } })) > 0) {
      return { ok: false, error: { code: 'PHONE_CONFIRMATION_REQUIRED', phone: req.clientPhone, message: 'read the phone number back to the customer, ask them to confirm it, then call create_order again with phoneConfirmed=true' } };
    }
    const risky = (owner ?? convClient)?.riskLevel === 'high';
    if (risky && agent?.riskyClientBehavior === 'handoff') return { ok: false, hint: 'risky_client' };
    // FL-02 F-4 duplicate guard
    const signature = (items: { productId: string; variantId: string | null; quantity: number }[]) => items.map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`).sort().join('|');
    const recent = await prisma.order.findMany({ where: { clientPhone: req.clientPhone, status: { not: 'cancelled' }, orderedAt: { gte: new Date(Date.now() - AI_ORDER_DUPLICATE_WINDOW_MIN * MIN) } }, include: { items: true }, orderBy: { orderedAt: 'desc' } });
    const duplicate = recent.find((o) => signature(o.items) === signature(req.items));
    if (duplicate) return this.toolResult(duplicate, duplicate.items, duplicate.number);

    try {
      const result = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const { client, created } = await this.clients.resolveForOrder(tx, { name: req.clientName, phone: req.clientPhone, phone2: req.secondPhone }, { source: 'ai', conversationClientId: conversation?.clientId });
        if (conversation && conversation.clientId !== client.id) await tx.conversation.update({ where: { id: conversation.id }, data: { clientId: client.id, version: { increment: 1 } } });
        const communes = req.communeName ? await tx.commune.findMany({ where: { wilayaId: req.wilayaId }, select: { id: true, nameFr: true, nameAr: true } }) : [];
        const wanted = fold(req.communeName ?? '');
        const commune = wanted ? communes.find((c) => fold(c.nameFr) === wanted || fold(c.nameAr) === wanted) : undefined;
        const lines = await this.resolveLines(tx, req.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice })));
        const totals = orderTotals(lines, { deliveryFee: req.deliveryFee });
        const number = await this.counter.next(tx, 'order');
        const order = await tx.order.create({
          data: {
            workspaceId: ctx.workspaceId,
            number,
            clientId: client.id,
            conversationId: conversation?.id ?? null,
            channelId: ctx.channelId ?? conversation?.channelId ?? null,
            source: 'ai',
            agentId: ctx.agentId,
            status: 'new',
            paymentMethod: 'cash',
            clientName: req.clientName,
            clientPhone: req.clientPhone,
            clientPhone2: req.secondPhone,
            wilayaId: req.wilayaId,
            communeId: commune?.id ?? null,
            communeText: commune ? null : req.communeName,
            address: req.address,
            isStopdesk: req.isStopdesk,
            stopdeskId: req.stopdeskId,
            subtotal: totals.subtotal,
            deliveryFee: req.deliveryFee,
            total: totals.total,
            riskLevel: client.riskLevel,
            notes: req.notes,
            items: { create: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, sku: l.sku, unitPrice: l.unitPrice, costPrice: l.costPrice, quantity: l.quantity, discount: 0, total: totals.lineTotals[i]! })) },
          },
          include: { items: true },
        });
        await this.afterCreate(tx, order, lines, { type: 'ai', id: ctx.agentId, name: agent?.name }, { amountPaid: 0, clientCreated: created, releasing: req.replaces ? [req.replaces.id] : [] });
        // 04 §1.1: the cart of the conversation is closed with the order id (abandon rate = recap shown, no order)
        if (conversation) {
          const fresh = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
          const c = contextOf(fresh) as ConversationContext & { cart?: { recapShownAt?: string } };
          await tx.conversation.update({ where: { id: conversation.id }, data: { context: { ...c, cart: { items: [], recapShownAt: c.cart?.recapShownAt, orderId: order.id, updatedAt: new Date().toISOString() } } as Prisma.InputJsonValue } });
        }
        await this.effects.notify(tx, 'order_ai_created', {
          workspaceId: ctx.workspaceId,
          key: `order_ai_created:${order.id}`,
          data: { orderId: order.id, number: order.number, total: formatMoney(order.total), amount: order.total, agent: agent?.name ?? '', client: order.clientName, channel: conversation?.channel?.name ?? '', ...(order.riskLevel === 'high' ? { risk: true } : {}) },
        });
        const out = this.toolResult(order, order.items, null);
        await tx.idempotencyKey.create({ data: { workspaceId: ctx.workspaceId, key, actorKey: 'ai', requestHash: `${ctx.runId}:${ctx.callId}`, responseCode: 200, responseBody: out as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
        return out;
      });
      return result;
    } catch (e) {
      // F-1: the whole order is rolled back; the model offers the available quantity or another product
      if (e instanceof AppException && e.code === 'ORDER_INSUFFICIENT_STOCK') {
        const d = (e.details ?? {}) as { productId?: string; available?: number };
        return { ok: false, error: { code: 'ORDER_INSUFFICIENT_STOCK', productId: d.productId, available: d.available ?? e.params.available } };
      }
      if (e instanceof AppException && (e.code === 'VARIANT_REQUIRED' || e.code === 'VARIANT_NOT_FOUND' || e.code === 'VALIDATION_ERROR')) return { ok: false, error: { code: e.code, fields: e.fields } };
      throw e;
    }
  }

  private toolResult(o: Pick<Order, 'id' | 'number' | 'subtotal' | 'deliveryFee' | 'total'>, items: { productName: string; variantName: string | null; quantity: number; unitPrice: number }[], duplicateOf: string | null): ToolResult {
    return { ok: true, orderId: o.id, number: o.number, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, items: items.map((i) => ({ name: i.productName, variant: i.variantName, quantity: i.quantity, unitPrice: i.unitPrice })), duplicateOf, paymentOptions: ['cod'] };
  }

  // --- PATCH ------------------------------------------------------------------------------------------------------------
  /** `PATCH /orders/:id { …, version }` — contact, notes, items (stock re-synced), money fields (04 §1.4 rules). */
  async update(id: string, input: UpdateOrderInput, locale: string): Promise<OrderView> {
    const t = TenantContext.get();
    const actor = this.actor();
    const money = can(t.role, 'orders.money') || !!t.apiKeyId;
    if (!money && (input.deliveryFee !== undefined || input.discount !== undefined || input.tax !== undefined || input.items?.some((i) => (i.discount ?? 0) > 0))) throw forbidden();
    if (input.orderedAt) {
      const r = checkOrderedAt(new Date(input.orderedAt));
      if (r) throw refuse(r);
    }
    await this.inTx(async (tx) => {
      const o = await this.lock(tx, id);
      if (o.version !== input.version) throw new StaleVersion(id);
      const readOnly = (ORDER_READ_ONLY_STATUSES as readonly string[]).includes(o.status);
      const touchesMoney = input.amountPaid !== undefined || input.paymentStatus !== undefined || input.paymentMethod !== undefined;
      const onlyNotes = Object.keys(input).every((k) => k === 'version' || k === 'notes');
      if (readOnly && !onlyNotes) throw new AppException(touchesMoney && isTerminal(o.status) ? 'ORDER_PAYMENT_LOCKED' : 'ORDER_TERMINAL');
      const changed: string[] = [];
      const data: Prisma.OrderUncheckedUpdateInput = {};
      for (const k of ['clientName', 'clientPhone', 'clientPhone2', 'notes', 'paymentMethod'] as const) {
        if (input[k] !== undefined && input[k] !== o[k]) {
          (data as Record<string, unknown>)[k] = input[k];
          changed.push(k);
        }
      }
      if (input.orderedAt) {
        data.orderedAt = new Date(input.orderedAt);
        changed.push('orderedAt');
      }
      let subtotal = o.subtotal;
      let lines: Line[] | null = null;
      if (input.items) {
        if (!['new', 'confirmed', 'preparing'].includes(o.status) || o.deliveryStatus !== 'not_sent') throw new AppException('ORDER_INVALID_TRANSITION', { from: o.status, to: o.status });
        lines = await this.resolveLines(tx, input.items);
        subtotal = orderTotals(lines, { deliveryFee: 0 }).subtotal;
        changed.push('items');
      }
      const discount = input.discount ?? o.discount;
      const tax = input.tax ?? o.tax;
      let deliveryFee = input.deliveryFee ?? o.deliveryFee;
      if (input.deliveryFee === undefined && (lines || input.discount !== undefined) && o.wilayaId) {
        // fee recomputed for the new subtotal unless it was an Admin override (fee ≠ what the grid gave)
        const before = await this.fees.quote({ wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, subtotal: o.subtotal - o.discount }, tx);
        if (before.fee === o.deliveryFee) deliveryFee = (await this.fees.quote({ wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, subtotal: subtotal - discount }, tx)).fee;
      }
      if (input.deliveryFee !== undefined) changed.push('deliveryFee');
      if (input.discount !== undefined) changed.push('discount');
      const total = subtotal - discount + tax + deliveryFee;
      if (total < 0) throw new AppException('VALIDATION_ERROR', {}, { discount: 'validation.range' });
      const payment = checkPaymentPatch({ amountPaid: input.amountPaid, paymentStatus: input.paymentStatus }, total);
      if (payment) throw refuse(payment);
      Object.assign(data, { subtotal, discount, tax, deliveryFee, total });
      if (lines) {
        const totals = orderTotals(lines, { discount, tax, deliveryFee });
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({ data: lines.map((l, i) => ({ orderId: id, productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, sku: l.sku, unitPrice: l.unitPrice, costPrice: l.costPrice, quantity: l.quantity, discount: l.discount, total: totals.lineTotals[i]! })) });
        await this.effects.holdStock(tx, o, this.stockLines(lines), actor.id);
      }
      // 04 §3 "amount paid changed": the order's automatic rows are replaced by one row for the new amount
      if (input.amountPaid !== undefined && input.amountPaid !== o.amountPaid) {
        await this.effects.clearPayments(tx, id);
        await this.effects.addPayment(tx, o, { amount: input.amountPaid, method: input.paymentMethod ?? o.paymentMethod, description: `Commande #${o.number} (paiement)` }, actor);
        changed.push('amountPaid');
      }
      const paid = await this.effects.recomputePaid(tx, { id, total });
      if (paid.amountPaid > total) throw new AppException('VALIDATION_ERROR', {}, { amountPaid: 'validation.range' });
      const updated = await tx.order.update({ where: { id }, data: { ...data, ...paid, version: { increment: 1 } } });
      for (const field of changed) await tx.orderStatusHistory.create({ data: { orderId: id, field, from: field === 'items' ? null : String((o as Record<string, unknown>)[field] ?? ''), to: field === 'items' ? `${lines!.length}` : String((updated as Record<string, unknown>)[field] ?? ''), actorType: actor.type, actorId: actor.id } });
      if (paid.paymentStatus !== o.paymentStatus) {
        await tx.orderStatusHistory.create({ data: { orderId: id, field: 'paymentStatus', from: o.paymentStatus, to: paid.paymentStatus, actorType: actor.type, actorId: actor.id } });
        if (paid.paymentStatus === 'paid') await this.effects.webhook(tx, 'order.paid', id, { amountPaid: paid.amountPaid, method: updated.paymentMethod }, ':paid');
      }
      if (lines || input.amountPaid !== undefined) await this.effects.recomputeClient(tx, o.clientId);
      await this.effects.emitUpdated(tx, updated, changed);
      await this.effects.sheets(tx, updated);
    }, locale);
    return this.get(id, locale);
  }

  // --- delete (ORD-08, 04 §9 / §21) -------------------------------------------------------------------------------------
  /** `DELETE /orders/:id` — not delivered, no live courier parcel; rollback first (stock, automatic cash rows only). */
  async remove(id: string, confirmNumber?: string) {
    const actor = this.actor();
    const t = TenantContext.get();
    const snapshot = await this.inTx(async (tx) => {
      const o = await this.lock(tx, id);
      if (confirmNumber !== undefined && confirmNumber !== o.number) throw new AppException('VALIDATION_ERROR', {}, { confirmNumber: 'validation.invalid' });
      if (o.status === 'delivered') throw new AppException('ORDER_DELETE_DELIVERED');
      const active = this.activeShipment(o);
      if (active && active.provider !== 'manual') throw new AppException('DELIVERY_ORDER_ALREADY_SENT');
      // a returned order already settled its stock (restocked or written off as a loss)
      if (o.status !== 'returned') await this.effects.syncStock(tx, o, [], 'order_cancelled', actor.id);
      await this.effects.removeOrderCash(tx, id);
      await this.effects.recoReverse(tx, id);
      await tx.order.delete({ where: { id } });
      await this.effects.recomputeClient(tx, o.clientId);
      await this.effects.emitDeleted(tx, o);
      return { number: o.number, status: o.status, total: o.total, clientId: o.clientId };
    });
    await this.audit.write({ workspaceId: t.workspaceId, actorType: actor.type === 'api' ? 'api_key' : 'user', actorId: t.userId ?? null, actorRole: t.role ?? null, action: 'order.delete', entity: 'Order', entityId: id, before: snapshot });
    return { id, deleted: true };
  }

  /** `POST /orders/:id/duplicate` → a draft of `POST /orders` (nothing written). */
  async duplicate(id: string): Promise<OrderDraft> {
    const o = await prisma.order.findFirst({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
    if (!o) throw notFound();
    return {
      client: { id: o.clientId },
      items: o.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice, ...(i.discount ? { discount: i.discount } : {}) })),
      delivery: o.wilayaId ? { wilayaId: o.wilayaId, communeId: o.communeId, communeText: o.communeText, isStopdesk: o.isStopdesk, stopdeskId: o.stopdeskId, address: o.address } : null,
      paymentMethod: o.paymentMethod,
      discount: o.discount || undefined,
      notes: o.notes,
      status: 'new',
      conversationId: o.conversationId,
    };
  }

  // --- export (ORD-09, 06 §7 columns) ----------------------------------------------------------------------------------
  private async exportTable(q: OrdersExportQuery, locale: 'fr' | 'ar' | 'en') {
    const { scope, format: _f, columns, includeItems, courierFormat, sort, ...filters } = q;
    const where = scope === 'all' ? {} : orderWhere(filters);
    const rows = await prisma.order.findMany({ where, orderBy: orderOrderBy(sort), take: 100_000, include: { items: { orderBy: { id: 'asc' } }, wilaya: true, commune: true, channel: { select: { name: true } }, shipments: { where: { status: { in: [...ACTIVE_SHIPMENT] } }, take: 1, orderBy: { createdAt: 'desc' } } } });
    const h = EXPORT_HEADERS[locale] ?? EXPORT_HEADERS.fr;
    type R = (typeof rows)[number] & { line?: (typeof rows)[number]['items'][number] };
    const flat: R[] = includeItems ? rows.flatMap((o) => o.items.map((line) => ({ ...o, line }))) : rows;
    const wilaya = (r: R) => (r.wilaya ? (locale === 'ar' ? r.wilaya.nameAr : r.wilaya.nameFr) : '');
    const commune = (r: R) => r.communeText ?? (r.commune ? (locale === 'ar' ? r.commune.nameAr : r.commune.nameFr) : '');
    if (courierFormat === 'zrexpress') {
      // ZR Express bulk-import layout (one parcel per row, COD = remaining)
      return {
        sheetName: 'ZR Express',
        fileName: `zr-express-${algiersDay()}`,
        rows,
        columns: [
          { header: 'Client', value: (r: R) => r.clientName },
          { header: 'Tel 1', value: (r: R) => r.clientPhone },
          { header: 'Tel 2', value: (r: R) => r.clientPhone2 ?? '' },
          { header: 'Wilaya', value: (r: R) => r.wilaya?.code ?? '' },
          { header: 'Commune', value: (r: R) => commune(r) },
          { header: 'Adresse', value: (r: R) => r.address ?? '' },
          { header: 'Produit', value: (r: R) => r.items.map((i) => `${i.productName}${i.variantName ? ` ${i.variantName}` : ''} x${i.quantity}`).join(', ') },
          { header: 'Total', value: (r: R) => r.total - r.amountPaid },
          { header: 'Stop desk', value: (r: R) => (r.isStopdesk ? 1 : 0) },
          { header: 'Référence', value: (r: R) => r.number },
        ],
      };
    }
    const standard = [
      { header: h.number, value: (r: R) => r.number },
      { header: h.date, value: (r: R) => algiersDay(r.orderedAt) },
      // creation time (PV 22/10: « la date et l'heure de chaque commande »)
      { header: h.time, value: (r: R) => algiersTime(r.orderedAt) },
      { header: h.channel, value: (r: R) => r.channel?.name ?? '' },
      { header: h.source, value: (r: R) => r.source },
      { header: h.client, value: (r: R) => r.clientName },
      { header: h.phone, value: (r: R) => r.clientPhone },
      { header: h.wilaya, value: wilaya },
      { header: h.commune, value: commune },
      { header: h.address, value: (r: R) => (r.isStopdesk ? `${h.stopdesk} ${r.stopdeskId ?? ''}`.trim() : (r.address ?? '')) },
      { header: h.items, value: (r: R) => (r.line ? `${r.line.productName}${r.line.variantName ? ` · ${r.line.variantName}` : ''} × ${r.line.quantity} × ${r.line.unitPrice}` : r.items.map((i) => `${i.productName}${i.variantName ? ` · ${i.variantName}` : ''} × ${i.quantity} × ${i.unitPrice}`).join(' ; ')) },
      { header: h.subtotal, value: (r: R) => r.subtotal },
      { header: h.discount, value: (r: R) => r.discount },
      { header: h.deliveryFee, value: (r: R) => r.deliveryFee },
      { header: h.total, value: (r: R) => r.total },
      { header: h.paid, value: (r: R) => r.amountPaid },
      { header: h.remaining, value: (r: R) => Math.max(0, r.total - r.amountPaid) },
      { header: h.paymentMethod, value: (r: R) => r.paymentMethod },
      { header: h.status, value: (r: R) => r.status },
      { header: h.confirmation, value: (r: R) => r.confirmationStatus },
      { header: h.delivery, value: (r: R) => r.deliveryStatus },
      { header: h.courier, value: (r: R) => r.shipments[0]?.provider ?? '' },
      { header: h.tracking, value: (r: R) => r.shipments[0]?.trackingNumber ?? '' },
    ];
    if (q.format === 'pdf') {
      // M8 (06 §7 "Orders XLSX/PDF"): A4 landscape — the columns that fit a printed page, totals at the bottom
      const pick: string[] = [h.number, h.date, h.client, h.phone, h.wilaya, h.items, h.total, h.remaining, h.status, h.delivery];
      const money = new Set<string>([h.total, h.remaining]);
      const cols = standard.filter((c) => pick.includes(c.header)).map((c) => ({ ...c, kind: money.has(c.header) ? ('money' as const) : ('text' as const), width: c.header === h.items ? 6 : c.header === h.client ? 3 : 2 }));
      const totalOf = (f: (o: (typeof rows)[number]) => number) => rows.reduce((sum, o) => sum + f(o), 0);
      return {
        sheetName: h.sheet,
        fileName: `commandes-${algiersDay()}`,
        rows: flat,
        columns: cols,
        pdf: { title: h.sheet, subtitle: `· ${rows.length}`, landscape: true, totals: [{ label: h.total, value: formatSlipAmount(totalOf((o) => o.total)), bold: true }, { label: h.remaining, value: formatSlipAmount(totalOf((o) => Math.max(0, o.total - o.amountPaid))) }] },
      };
    }
    const extra =
      columns === 'all'
        ? [
            { header: h.phone2, value: (r: R) => r.clientPhone2 ?? '' },
            { header: h.payment, value: (r: R) => r.paymentStatus },
            { header: h.calls, value: (r: R) => r.callAttempts },
            { header: h.risk, value: (r: R) => r.riskLevel },
            { header: h.notes, value: (r: R) => r.notes ?? '' },
            { header: h.cancelReason, value: (r: R) => r.cancelReason ?? '' },
          ]
        : [];
    return { sheetName: h.sheet, fileName: `commandes-${algiersDay()}`, rows: flat, columns: [...standard, ...extra] };
  }
}

const EXPORT_HEADERS = {
  fr: { sheet: 'Commandes', number: 'N°', date: 'Date', time: 'Heure', channel: 'Canal', source: 'Source', client: 'Client', phone: 'Téléphone', phone2: 'Téléphone 2', wilaya: 'Wilaya', commune: 'Commune', address: 'Adresse / point relais', stopdesk: 'Point relais', items: 'Articles (nom × qté × prix)', subtotal: 'Sous-total', discount: 'Remise', deliveryFee: 'Livraison', total: 'Total', paid: 'Payé', remaining: 'Reste', paymentMethod: 'Mode de paiement', status: 'Statut', confirmation: 'Confirmation', delivery: 'Livraison (statut)', courier: 'Transporteur', tracking: 'Suivi', payment: 'Paiement', calls: 'Appels', risk: 'Risque', notes: 'Notes', cancelReason: "Motif d'annulation" },
  en: { sheet: 'Orders', number: 'No.', date: 'Date', time: 'Time', channel: 'Channel', source: 'Source', client: 'Client', phone: 'Phone', phone2: 'Phone 2', wilaya: 'Wilaya', commune: 'Commune', address: 'Address / stop-desk', stopdesk: 'Stop-desk', items: 'Items (name × qty × price)', subtotal: 'Subtotal', discount: 'Discount', deliveryFee: 'Delivery fee', total: 'Total', paid: 'Paid', remaining: 'Remaining', paymentMethod: 'Payment method', status: 'Status', confirmation: 'Confirmation', delivery: 'Delivery status', courier: 'Courier', tracking: 'Tracking', payment: 'Payment', calls: 'Calls', risk: 'Risk', notes: 'Notes', cancelReason: 'Cancel reason' },
  ar: { sheet: 'الطلبات', number: 'الرقم', date: 'التاريخ', time: 'الوقت', channel: 'القناة', source: 'المصدر', client: 'العميل', phone: 'الهاتف', phone2: 'الهاتف 2', wilaya: 'الولاية', commune: 'البلدية', address: 'العنوان / نقطة الاستلام', stopdesk: 'نقطة الاستلام', items: 'المنتجات (الاسم × الكمية × السعر)', subtotal: 'المجموع الفرعي', discount: 'الخصم', deliveryFee: 'التوصيل', total: 'المجموع', paid: 'المدفوع', remaining: 'المتبقي', paymentMethod: 'طريقة الدفع', status: 'الحالة', confirmation: 'التأكيد', delivery: 'حالة التوصيل', courier: 'الناقل', tracking: 'التتبع', payment: 'الدفع', calls: 'المكالمات', risk: 'الخطر', notes: 'ملاحظات', cancelReason: 'سبب الإلغاء' },
} as const;
