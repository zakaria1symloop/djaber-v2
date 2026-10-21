// 04 §3 — the ONE writer of an order's side effects (CLAUDE.md rule 5, 01-nest-module-map §4.5): stock movements
// (through StockService, the only stock writer), automatic cash rows + payment entries, client aggregates (recomputed)
// and every outbox row (WS, notifications, customer texts, outbound webhooks, Sheets). Always inside the caller's
// transaction; controllers and the other order services never touch stock or cash.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { derivePaymentStatus, formatMoney } from '@djaber/shared';
import { TenantContext, type CashMethod, type MovementReason, type NotificationType, type Order, type PaymentMethod, type Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { algiersDay } from '../../core/time/algiers';
import { StockService } from '../catalog/stock.service';
import { ClientAggregatesService } from '../clients/client-aggregates.service';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { CrossSellService } from '../recommendations/cross-sell.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { orderPublic, orderSummary } from './order.presenter';
import { stockDeltas, stockKey, type StockLine } from './order-rules';

export type Actor = { type: 'user' | 'ai' | 'system' | 'api' | 'courier'; id: string | null; name?: string };
const CASH_METHOD: Record<PaymentMethod, CashMethod> = { cash: 'cash', card: 'card', transfer: 'transfer', ccp: 'ccp', other: 'other' };

@Injectable()
export class OrderEffects implements OnModuleInit {
  private readonly log = new Logger(OrderEffects.name);
  constructor(
    private readonly stock: StockService,
    private readonly aggregates: ClientAggregatesService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationProducer,
    private readonly outbound: OutboundSendService,
    private readonly registry: ProcessorRegistry,
    private readonly crossSell: CrossSellService,
  ) {}

  onModuleInit() {
    // the Google Sheets consumer is `SheetsSyncService` (integrations module, M11); this no-op only covers a process built
    // without that module (rows are then acknowledged without a write)
    if (!this.registry.outbox.has('sheets')) this.registry.onOutbox('sheets', async () => undefined);
  }

  // --- stock (04 §3: reserved while new, taken when confirmed, given back on cancel / return / delete) ---------------------
  /** Net quantity this order took per product / variant (Σ of its movements, ≤ 0). */
  async netMovements(tx: Tx, orderId: string): Promise<Map<string, number>> {
    const rows = await tx.stockMovement.groupBy({ by: ['productId', 'variantId'], where: { refType: 'order', refId: orderId }, _sum: { quantity: true } });
    return new Map(rows.map((r) => [stockKey(r.productId, r.variantId), r._sum.quantity ?? 0]));
  }

  /**
   * Brings the order's stock to `lines` (creation / item edit) or to nothing (`[]`: cancel, delete, return with restock).
   * Decrements are conditional: `422 ORDER_INSUFFICIENT_STOCK {product, available}` rolls the whole order back.
   */
  async syncStock(tx: Tx, order: Pick<Order, 'id' | 'number'>, lines: StockLine[], give: Extract<MovementReason, 'order_cancelled' | 'order_returned'>, actorId?: string | null) {
    const deltas = stockDeltas(lines, await this.netMovements(tx, order.id));
    // takes first in a stable order (product id) so two orders never lock the same rows in opposite orders
    deltas.sort((a, b) => a.productId.localeCompare(b.productId) || (a.variantId ?? '').localeCompare(b.variantId ?? ''));
    for (const d of deltas) {
      await this.stock.move(tx, {
        productId: d.productId,
        variantId: d.variantId,
        change: { delta: d.delta },
        type: d.delta < 0 ? 'out' : 'return',
        reason: d.delta < 0 ? 'order_created' : give,
        note: order.number,
        refType: 'order',
        refId: order.id,
        actorId,
        insufficient: (available, p) => new AppException('ORDER_INSUFFICIENT_STOCK', { product: p.name, available }, {}, { productId: d.productId, variantId: d.variantId, available }),
      });
    }
  }

  /**
   * Stock of an order being created or edited (owner decision 2026-10-21): still `new` ⇒ the quantities are only
   * reserved (checked against stock − the other unconfirmed orders, no movement); confirmed and later ⇒ moved now.
   * The movements of a `new` order are written by `syncStock` when it is confirmed (transition plan `commit`).
   */
  async holdStock(tx: Tx, order: Pick<Order, 'id' | 'number' | 'status'>, lines: StockLine[], actorId?: string | null) {
    if (order.status !== 'new') return this.syncStock(tx, order, lines, 'order_cancelled', actorId);
    await this.stock.reserve(
      tx,
      order.id,
      lines.filter((l) => l.trackStock),
      (available, p) => new AppException('ORDER_INSUFFICIENT_STOCK', { product: p.name, available }, {}, { productId: p.productId, variantId: p.variantId, available }),
    );
  }

  /** Return without restock (04 §21): no `return` movement, one `adjustment_out` / `loss` line per tracked item for the audit trail. */
  async lossTrail(tx: Tx, order: Pick<Order, 'id' | 'number'>, lines: StockLine[], actorId?: string | null) {
    for (const l of lines.filter((x) => x.trackStock)) {
      await this.stock.trail(tx, { productId: l.productId, variantId: l.variantId, type: 'adjustment_out', reason: 'loss', note: `${order.number} · ${l.quantity} non remis en stock`, refType: 'order', refId: order.id, actorId });
    }
  }

  // --- money (04 §1.4, §3, §21; PaymentEntry rows → locked automatic cash rows) --------------------------------------------
  /** The day of a cash row: the effective date only if that day is still open, else today (04 §20 / §21). */
  async cashDate(tx: Tx, at: Date): Promise<Date> {
    const day = algiersDay(at);
    if (day === algiersDay()) return at;
    const closed = await tx.cashClosing.findFirst({ where: { day: new Date(`${day}T00:00:00Z`), reopenedAt: null }, select: { id: true } });
    return closed ? new Date() : at;
  }

  /** The member recorded on a payment entry (`createdById` is required): the actor, else the workspace owner. */
  private async payer(tx: Tx, actor: Actor): Promise<string> {
    if (actor.type === 'user' && actor.id) return actor.id;
    const owner = await tx.membership.findFirst({ where: { workspaceId: TenantContext.workspaceId(), role: 'owner' }, select: { userId: true } });
    return owner!.userId;
  }

  /** One payment entry + its automatic income row (`category=order`, `sourceType=payment_entry`). */
  async addPayment(tx: Tx, order: Pick<Order, 'id' | 'number'>, p: { amount: number; method: PaymentMethod; reference?: string | null; note?: string | null; paidAt?: Date; description: string }, actor: Actor) {
    if (p.amount === 0) return null;
    const workspaceId = TenantContext.workspaceId();
    const paidAt = p.paidAt ?? new Date();
    const createdById = await this.payer(tx, actor);
    const cash = await tx.cashTransaction.create({
      data: { workspaceId, type: p.amount > 0 ? 'income' : 'expense', amount: Math.abs(p.amount), category: p.amount > 0 ? 'order' : 'refund', method: CASH_METHOD[p.method], reference: order.number, description: p.description, date: await this.cashDate(tx, paidAt), isAutomatic: true, sourceType: 'payment_entry', createdById },
    });
    const entry = await tx.paymentEntry.create({ data: { workspaceId, sourceType: 'order', sourceId: order.id, amount: p.amount, method: p.method, reference: p.reference ?? null, note: p.note ?? null, paidAt, createdById, cashTransactionId: cash.id } });
    await tx.cashTransaction.update({ where: { id: cash.id }, data: { sourceId: entry.id } });
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'cash.updated', { day: algiersDay(cash.date) }, `cash.updated:${cash.id}`);
    return entry;
  }

  /** Removes the order's payment entries and their automatic cash rows (cancel, return, delete — manual rows are never touched). */
  async clearPayments(tx: Tx, orderId: string) {
    const entries = await tx.paymentEntry.findMany({ where: { sourceType: 'order', sourceId: orderId }, select: { id: true, cashTransactionId: true } });
    if (!entries.length) return 0;
    const cashIds = entries.map((e) => e.cashTransactionId).filter((x): x is string => !!x);
    await tx.paymentEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
    if (cashIds.length) await tx.cashTransaction.deleteMany({ where: { id: { in: cashIds }, isAutomatic: true } });
    await this.outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'cash.updated', { day: algiersDay() }, `cash.updated:clear:${orderId}:${Date.now()}`);
    return entries.length;
  }

  /** Every automatic row of the order: payments and the return fee (delete). */
  async removeOrderCash(tx: Tx, orderId: string) {
    await this.clearPayments(tx, orderId);
    await tx.cashTransaction.deleteMany({ where: { sourceType: 'order', sourceId: orderId, isAutomatic: true } });
  }

  /** D27 / 04 §3: the courier return fee is an expense `shipping` of the merchant (dated the day the parcel came back). */
  async addReturnExpense(tx: Tx, order: Pick<Order, 'id' | 'number'>, fee: number, at: Date, actor: Actor) {
    if (fee <= 0) return null;
    return tx.cashTransaction.create({
      data: { workspaceId: TenantContext.workspaceId(), type: 'expense', amount: fee, category: 'shipping', method: 'cash', reference: order.number, description: `Commande #${order.number} retournée (frais de retour)`, date: await this.cashDate(tx, at), isAutomatic: true, sourceType: 'order', sourceId: order.id, createdById: actor.type === 'user' ? actor.id : null },
    });
  }

  /** `amountPaid` = Σ payment entries (clamped 0..total, recomputed — never incremented); `paymentStatus` derived (04 §1.4). */
  async recomputePaid(tx: Tx, order: Pick<Order, 'id' | 'total'>): Promise<{ amountPaid: number; paymentStatus: 'unpaid' | 'partial' | 'paid' }> {
    const sum = await tx.paymentEntry.aggregate({ where: { sourceType: 'order', sourceId: order.id }, _sum: { amount: true } });
    const amountPaid = Math.max(0, Math.min(sum._sum.amount ?? 0, order.total));
    return { amountPaid, paymentStatus: derivePaymentStatus(amountPaid, order.total) };
  }

  // --- cross-sell attribution (REC-03) ----------------------------------------------------------------------------------
  /** An order of a conversation converts the cross-sell suggestions the AI showed there in the last 7 days. */
  recoConversions(tx: Tx, order: Pick<Order, 'id' | 'conversationId' | 'orderedAt'>) {
    return this.crossSell.conversions(tx, order);
  }
  /** REC-03 fix: cancelled / deleted orders no longer count as conversions. */
  recoReverse(tx: Tx, orderId: string) {
    return this.crossSell.reverseConversions(tx, orderId);
  }

  // --- aggregates ---------------------------------------------------------------------------------------------------------
  recomputeClient(tx: Tx, clientId: string) {
    return this.aggregates.recompute(tx, clientId);
  }

  // --- outbox ----------------------------------------------------------------------------------------------------------------
  async emitCreated(tx: Tx, order: Order) {
    await this.outbox.ws(tx, `ws:${order.workspaceId}`, 'order.created', { id: order.id, order: orderSummary(order) }, `order.created:${order.id}`);
  }
  async emitUpdated(tx: Tx, order: Order, changed: string[]) {
    await this.outbox.ws(tx, `ws:${order.workspaceId}`, 'order.updated', { id: order.id, order: orderSummary(order), changed }, `order.updated:${order.id}:${order.version}:${changed.join(',')}`);
  }
  async emitDeleted(tx: Tx, order: Pick<Order, 'id' | 'workspaceId'>) {
    await this.outbox.ws(tx, `ws:${order.workspaceId}`, 'order.deleted', { id: order.id }, `order.deleted:${order.id}`);
  }

  /** Outbound webhook row with a free payload (`payment.failed { orderId, paymentId, reason }`, 03-events §6). */
  async webhookData(tx: Tx, event: string, key: string, workspaceId: string, data: Record<string, unknown>) {
    await this.outbox.enqueue(tx, { topic: 'webhook', key: `${event}:${key}`, workspaceId, payload: { event, workspaceId, data } });
  }

  /** Outbound webhook row (api-contract §6 / 03-events §6); delivered by the integrations module (`WebhookDispatchService`). */
  async webhook(tx: Tx, event: string, orderId: string, extra: Record<string, unknown> = {}, keySuffix = '') {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, commune: { select: { nameFr: true } } } });
    const data = event === 'order.created' ? orderPublic(o) : { order: orderPublic(o), ...extra };
    await this.outbox.enqueue(tx, { topic: 'webhook', key: `${event}:${o.id}:${o.version}${keySuffix}`, workspaceId: o.workspaceId, payload: { event, workspaceId: o.workspaceId, data } });
  }

  /** Google Sheets row of the order (03-events §1 `sheets` → `sheets-upsert`, job id `sheets:<orderId>`); consumer `SheetsSyncService`. */
  async sheets(tx: Tx, order: Pick<Order, 'id' | 'workspaceId' | 'version'>) {
    await this.outbox.enqueue(tx, { topic: 'sheets', key: `sheets:${order.id}:${order.version}`, workspaceId: order.workspaceId, payload: { orderId: order.id, jobId: `sheets:${order.id}` } });
  }

  async notify(tx: Tx, type: NotificationType, o: { workspaceId: string; key: string; data: Record<string, unknown>; userIds?: string[]; roles?: ('owner' | 'admin' | 'operator')[]; exceptUserId?: string | null }) {
    if (o.userIds && !o.userIds.length) return;
    await this.notifications.emit(tx, { type, workspaceId: o.workspaceId, key: o.key, data: o.data, ...(o.userIds ? { userIds: o.userIds.filter((id) => id !== o.exceptUserId) } : { target: { ...(o.roles ? { roles: o.roles } : {}), exceptUserId: o.exceptUserId ?? null } }) });
  }

  /**
   * Customer transactional text (`customer.<key>`, 11 §9 / 03 §15 "Customer message") on the order's conversation, through
   * the outbox `meta-send` path with the MSG-06 rules (FB outside 24 h: `POST_PURCHASE_UPDATE`; IG outside 24 h: skipped).
   */
  async customerText(tx: Tx, order: Pick<Order, 'conversationId'>, key: string, params: Record<string, string | number>) {
    if (!order.conversationId) return null;
    const conv = await tx.conversation.findFirst({ where: { id: order.conversationId, deletedAt: null }, select: { id: true } });
    if (!conv) return null;
    return this.outbound.sendSystemText(conv.id, key, params, { tx, kind: 'transactional' });
  }

  /** A thread event on the order's conversation (never sent): order created / cancelled / address updated … */
  async threadEvent(tx: Tx, order: Pick<Order, 'conversationId' | 'workspaceId'>, kind: string, params: Record<string, unknown>) {
    if (!order.conversationId) return null;
    const conv = await tx.conversation.findFirst({ where: { id: order.conversationId, deletedAt: null }, select: { id: true, workspaceId: true } });
    if (!conv) return null;
    return this.outbound.addThreadEvent(tx, conv, kind, params);
  }

  money(n: number) {
    return formatMoney(n);
  }
}
