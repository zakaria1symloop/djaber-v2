// ORD-03 / ORD-04 / ORD-07 / ORD-08 / PAY-01 + 04 §21 — everything that moves an order after creation: status changes
// (matrix + D14 self-delivery + "retour arrière"), cancel / manual deliver (COD) / return / manual ship, confirmation
// calls, callback reminders, delivery address, assignment, payments, notes, bulk status / assign, the AI cancellation,
// and `sched-order-reminders`. Every side effect goes through OrderEffects inside the row-locked transaction.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CancelReasonValues, FailureReasonValues, formatMoney, ORDER_BULK_STATUS_TARGETS, type CallLogInput, type CancelReasonName, type FailureReasonName, type OrderAddressInput, type OrderStatusName, type OrderView, type RecordPaymentInput } from '@djaber/shared';
import { prisma, TenantContext, type Order, type Prisma, type Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { runBulk, type BulkCtx } from '../../core/http/bulk';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import type { CancellableOrder, OrderToolContext, ToolResult } from '../ai/tools/order-tools';
import { withinWindow } from '../messaging/window-rules';
import { codPlan, callPlan, checkEffectiveAt, checkTransition, isTerminal, transitionPlan } from './order-rules';
import type { Actor } from './order-effects.service';
export type LockedOrder = Locked;
import { hasDeliveryAddress, stateOf } from './order.presenter';
import { OrderService, refuse, StaleVersion } from './order.service';

export type TransitionOptions = {
  actor: Actor;
  reason?: string | null;
  note?: string | null;
  effectiveAt?: Date | null;
  amountCollected?: number;
  restoreStock?: boolean;
  returnFee?: number;
  trackingNumber?: string | null;
  notifyCustomer?: boolean;
  /** courier sync / AI: no role check on `delivered → returned` */
  system?: boolean;
  /** notification `shipment.*` of a manual action (03-events §5.1 producers) */
  shipmentNotice?: boolean;
  /** the caller (delivery module) already wrote the parcel side: no manual parcel created / updated here */
  shipmentHandled?: boolean;
};
type Locked = Awaited<ReturnType<OrderService['lock']>>;
const DAY = 86_400_000;

@Injectable()
export class OrderWorkflowService implements OnModuleInit {
  constructor(
    private readonly orders: OrderService,
    private readonly i18n: I18nService,
    private readonly registry: ProcessorRegistry,
    private readonly queueOutbox: QueueOutbox,
  ) {}

  private get effects() {
    return this.orders.effects;
  }

  onModuleInit() {
    // 03-events §4 `sched-order-reminders` (every minute): callbacks due ⇒ `order.callback_due` to the assignee, else everyone
    this.registry.cron('sched-order-reminders', '* * * * *', () => this.remindDue());
  }

  private checkVersion(o: Pick<Order, 'id' | 'version'>, version: number | undefined) {
    if (version !== undefined && o.version !== version) throw new StaleVersion(o.id);
  }

  // --- the transition (04 §1.2 + §3) ------------------------------------------------------------------------------------
  /** Moves a row-locked order to `to` and runs the effects plan. Returns the updated row. */
  async transition(tx: Tx, o: Locked, to: OrderStatusName, opt: TransitionOptions): Promise<Order> {
    const role = TenantContext.get().role;
    const active = this.orders.activeShipment(o);
    const refusal = checkTransition(stateOf(o, active), to, { role, system: opt.system });
    if (refusal) throw refuse(refusal);
    const eff = checkEffectiveAt(opt.effectiveAt);
    if (eff) throw refuse(eff);
    const plan = transitionPlan(o.status, to, { restoreStock: opt.restoreStock, paymentStatus: o.paymentStatus, hasActiveShipment: !!active });
    const at = opt.effectiveAt ?? new Date();
    const data: Prisma.OrderUncheckedUpdateInput = { status: to, version: { increment: 1 } };
    for (const stamp of plan.stamps) if (stamp !== 'confirmedAt' || !o.confirmedAt) (data as Record<string, unknown>)[stamp] = stamp === 'deliveredAt' ? at : new Date();
    if (plan.confirmationStatus && o.confirmationStatus !== 'confirmed') data.confirmationStatus = plan.confirmationStatus;
    if (plan.deliveryStatus) data.deliveryStatus = plan.deliveryStatus as Order['deliveryStatus'];
    if (plan.clearCallback && o.callbackAt) data.callbackAt = null;
    if (to === 'cancelled') {
      data.cancelReason = (CancelReasonValues as readonly string[]).includes(opt.reason ?? '') ? (opt.reason as CancelReasonName) : 'other';
      data.cancelNote = opt.note ?? null;
    }
    const actorUserId = opt.actor.type === 'user' ? opt.actor.id : null;
    const lines = await this.orders.itemLines(tx, o.id);

    // shipment (D14 self-delivery: a manual parcel, `sent`)
    if (opt.shipmentHandled) {
      // courier parcels: ShipmentService / TrackingService own the Shipment rows and their events
    } else if (plan.shipment === 'create_manual') {
      await tx.shipment.create({ data: { workspaceId: o.workspaceId, orderId: o.id, provider: 'manual', status: 'sent', trackingNumber: opt.trackingNumber ?? null, publicTrackingToken: randomBytes(12).toString('base64url'), codAmount: Math.max(0, o.total - o.amountPaid) } });
    } else if (active && plan.shipment === 'mark_delivered') {
      await tx.shipment.update({ where: { id: active.id }, data: { status: 'delivered' } });
      await tx.shipmentEvent.create({ data: { shipmentId: active.id, rawStatus: 'delivered', mappedStatus: 'delivered', at, source: 'manual', actorId: actorUserId } });
    } else if (plan.shipment === 'mark_returned') {
      const reason = (FailureReasonValues as readonly string[]).includes(opt.reason ?? '') ? (opt.reason as FailureReasonName) : null;
      // the parcel keeps the reason (unclaimed parcels drive the auto-block rule); a self-delivered order gets a manual parcel record
      const target = active ?? o.shipments[0] ?? null;
      if (target) await tx.shipment.update({ where: { id: target.id }, data: { status: 'returned', failureReason: reason } });
      else await tx.shipment.create({ data: { workspaceId: o.workspaceId, orderId: o.id, provider: 'manual', status: 'returned', failureReason: reason, publicTrackingToken: randomBytes(12).toString('base64url'), codAmount: o.total } });
    } else if (active && plan.shipment === 'cancel_manual' && active.provider === 'manual') {
      await tx.shipment.update({ where: { id: active.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
    }

    // stock (04 §3: taken when a new order is confirmed, given back on cancel / return; a return without restock leaves a loss trail)
    if (plan.stock === 'commit') await this.effects.syncStock(tx, o, lines, 'order_cancelled', actorUserId);
    if (plan.stock === 'restore_cancel') await this.effects.syncStock(tx, o, [], 'order_cancelled', actorUserId);
    if (plan.stock === 'restore_return') await this.effects.syncStock(tx, o, [], 'order_returned', actorUserId);
    if (plan.stock === 'loss_trail') await this.effects.lossTrail(tx, o, lines, actorUserId);

    // money
    let paid: { amountPaid: number; paymentStatus: Order['paymentStatus'] } | null = null;
    if (plan.cash === 'cod') {
      const cod = codPlan(o, opt.amountCollected, opt.note ?? opt.reason);
      if ('code' in cod) throw refuse(cod);
      const label = cod.finalPaid === o.total ? `Commande #${o.number} livrée (COD)` : `Commande #${o.number} livrée (COD) — ${formatMoney(cod.finalPaid)} encaissés : ${opt.note ?? opt.reason ?? ''}`.trim();
      await this.effects.addPayment(tx, o, { amount: cod.entry, method: 'cash', paidAt: at, description: label, note: cod.finalPaid === o.total ? null : (opt.note ?? opt.reason ?? null) }, opt.actor);
      paid = await this.effects.recomputePaid(tx, o);
    } else if (plan.cash === 'clear') {
      await this.effects.clearPayments(tx, o.id);
      paid = { amountPaid: 0, paymentStatus: 'unpaid' };
    } else if (plan.cash === 'clear_and_return_fee') {
      const hadPaid = o.amountPaid > 0;
      await this.effects.clearPayments(tx, o.id);
      const fee = opt.returnFee ?? (await this.orders.fees.returnPrice(o.wilayaId, tx));
      await this.effects.addReturnExpense(tx, o, fee, at, opt.actor);
      data.returnFee = fee;
      paid = { amountPaid: 0, paymentStatus: hadPaid ? 'refunded' : 'unpaid' };
    }
    if (paid) Object.assign(data, paid);

    const updated = await tx.order.update({ where: { id: o.id }, data });
    await tx.orderStatusHistory.create({ data: { orderId: o.id, field: 'status', from: o.status, to, actorType: opt.actor.type, actorId: opt.actor.id, reason: [opt.reason, opt.note].filter(Boolean).join(' · ') || null, effectiveAt: opt.effectiveAt ?? null } });
    if (paid && paid.paymentStatus !== o.paymentStatus) await tx.orderStatusHistory.create({ data: { orderId: o.id, field: 'paymentStatus', from: o.paymentStatus, to: paid.paymentStatus, actorType: opt.actor.type, actorId: opt.actor.id } });
    if (plan.aggregates) await this.effects.recomputeClient(tx, o.clientId);

    // outbox
    const changed = ['status', ...(paid ? ['paymentStatus', 'amountPaid'] : []), ...(plan.deliveryStatus ? ['deliveryStatus'] : [])];
    await this.effects.emitUpdated(tx, updated, changed);
    await this.effects.webhook(tx, 'order.status_changed', o.id, { from: o.status, to, actorType: opt.actor.type, reason: opt.reason ?? null });
    for (const event of plan.webhooks) await this.effects.webhook(tx, event, o.id, event === 'order.delivered' ? { deliveredAt: at.toISOString() } : event === 'order.shipped' ? { shipment: { id: active?.id ?? null, provider: active?.provider ?? 'manual', trackingNumber: opt.trackingNumber ?? null } } : {});
    if (paid?.paymentStatus === 'paid' && o.paymentStatus !== 'paid') await this.effects.webhook(tx, 'order.paid', o.id, { amountPaid: paid.amountPaid, method: 'cash' }, ':paid');
    await this.effects.sheets(tx, updated);
    // 03-events §5.1 `order.status_changed`: to the assignee when someone else (member, AI, courier, API) moved it
    if (o.assigneeId && o.assigneeId !== opt.actor.id) {
      await this.effects.notify(tx, 'order_status_changed', { workspaceId: o.workspaceId, key: `order_status_changed:${o.id}:${updated.version}`, userIds: [o.assigneeId], data: { orderId: o.id, number: o.number, from: o.status, to, actorType: opt.actor.type } });
    }
    if (opt.shipmentNotice !== false && opt.actor.type === 'user') {
      const shipment = await tx.shipment.findFirst({ where: { orderId: o.id }, orderBy: { createdAt: 'desc' }, select: { id: true, trackingNumber: true, failureReason: true } });
      const base = { workspaceId: o.workspaceId, exceptUserId: actorUserId };
      if (to === 'shipped' && shipment) await this.effects.notify(tx, 'shipment_created', { ...base, key: `shipment_created:${shipment.id}`, data: { orderId: o.id, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber, number: o.number, tracking: shipment.trackingNumber ?? '—' } });
      if (to === 'delivered') await this.effects.notify(tx, 'shipment_delivered', { ...base, key: `shipment_delivered:${o.id}:${updated.version}`, data: { orderId: o.id, shipmentId: shipment?.id ?? null, number: o.number } });
      if (to === 'returned') await this.effects.notify(tx, 'shipment_returned', { ...base, key: `shipment_returned:${o.id}:${updated.version}`, data: { orderId: o.id, shipmentId: shipment?.id ?? null, failureReason: shipment?.failureReason ?? null, number: o.number } });
    }
    // customer transactional texts (03 §15 "Customer message"); a manual parcel without tracking number sends nothing
    if (plan.customerText && opt.notifyCustomer !== false) {
      if (plan.customerText === 'orderShipped') {
        if (opt.trackingNumber) await this.effects.customerText(tx, o, 'orderShipped', { number: o.number, tracking: opt.trackingNumber, courier: 'Livraison' });
      } else await this.effects.customerText(tx, o, plan.customerText, { number: o.number });
    }
    if (to === 'cancelled') await this.effects.threadEvent(tx, o, 'order_cancelled', { orderId: o.id, number: o.number, reason: data.cancelReason });
    if (to === 'cancelled') await this.effects.recoReverse(tx, o.id);
    // DLV-05 / D9 optional auto-send: a confirmed order goes to the default courier (job `courier.auto-send`, delivery module)
    if (to === 'confirmed' && o.status === 'new') {
      const ws = await tx.workspace.findUnique({ where: { id: o.workspaceId }, select: { autoSendToCourier: true } });
      if (ws?.autoSendToCourier) await this.queueOutbox.add(tx, 'courier', 'auto-send', { orderId: o.id, workspaceId: o.workspaceId, userId: actorUserId }, `autosend:${o.id}:${updated.version}`, { attempts: 1 });
    }
    return updated;
  }

  private async run(id: string, version: number | undefined, locale: string, fn: (tx: Tx, o: Locked) => Promise<unknown>): Promise<OrderView> {
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, id);
      this.checkVersion(o, version);
      await fn(tx, o);
    }, locale);
    return this.orders.get(id, locale);
  }

  // --- status endpoints ------------------------------------------------------------------------------------------------
  /** `POST /orders/:id/status` [FIG DLG Changer le statut] (Idempotency-Key required, `version` required). */
  changeStatus(id: string, input: { to: OrderStatusName; reason?: string | null; note?: string | null; effectiveAt?: string; amountCollected?: number; restoreStock?: boolean; returnFee?: number; trackingNumber?: string | null; notifyCustomer?: boolean; version: number }, locale: string) {
    return this.run(id, input.version, locale, (tx, o) =>
      this.transition(tx, o, input.to, { actor: this.orders.actor(), reason: input.reason, note: input.note, effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null, amountCollected: input.amountCollected, restoreStock: input.restoreStock, returnFee: input.returnFee, trackingNumber: input.trackingNumber, notifyCustomer: input.notifyCustomer }),
    );
  }

  /** `POST /orders/:id/cancel { reason, note?, notifyCustomer? }` (409 DELIVERY_ORDER_ALREADY_SENT with a live courier parcel). */
  cancel(id: string, input: { reason: CancelReasonName; note?: string | null; notifyCustomer?: boolean; version?: number }, locale: string) {
    return this.run(id, input.version, locale, (tx, o) => this.transition(tx, o, 'cancelled', { actor: this.orders.actor(), reason: input.reason, note: input.note, notifyCustomer: input.notifyCustomer }));
  }

  /** `POST /orders/:id/deliver { amountCollected?, reason?, deliveredAt? }` (COD rule; a different amount needs a reason). */
  deliver(id: string, input: { amountCollected?: number; reason?: string | null; deliveredAt?: string; notifyCustomer?: boolean; version?: number }, locale: string) {
    return this.run(id, input.version, locale, (tx, o) => this.transition(tx, o, 'delivered', { actor: this.orders.actor(), note: input.reason, amountCollected: input.amountCollected, effectiveAt: input.deliveredAt ? new Date(input.deliveredAt) : null, notifyCustomer: input.notifyCustomer }));
  }

  /** `POST /orders/:id/return { reason, restoreStock, returnFee?, note? }`. */
  returnOrder(id: string, input: { reason: FailureReasonName; restoreStock: boolean; returnFee?: number; note?: string | null; version?: number }, locale: string) {
    return this.run(id, input.version, locale, (tx, o) => this.transition(tx, o, 'returned', { actor: this.orders.actor(), reason: input.reason, note: input.note, restoreStock: input.restoreStock, returnFee: input.returnFee }));
  }

  /** `POST /orders/:id/ship-manual { trackingNumber? }` (D14 self-delivery). */
  shipManual(id: string, input: { trackingNumber?: string | null; version?: number }, locale: string) {
    return this.run(id, input.version, locale, (tx, o) => this.transition(tx, o, 'shipped', { actor: this.orders.actor(), trackingNumber: input.trackingNumber }));
  }

  // --- calls (04 §1.3, §21) -------------------------------------------------------------------------------------------
  /** `POST /orders/:id/calls` — returns the order and whether the call was only logged (`ORDER_CALL_ON_TERMINAL` warning). */
  async logCall(id: string, input: CallLogInput, locale: string): Promise<{ order: OrderView; warning: boolean }> {
    const actor = this.orders.actor();
    const userId = TenantContext.get().userId;
    if (!userId) throw new AppException('FORBIDDEN');
    let warning = false;
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, id);
      const plan = callPlan(o, input.result);
      // AT-ORD-04: "picked up" confirms a `new` order only with its delivery address (nothing is logged otherwise)
      if (plan.statusTo === 'confirmed' && !hasDeliveryAddress(o)) throw new AppException('ORDER_ADDRESS_REQUIRED');
      const callbackAt = input.callbackAt ? new Date(input.callbackAt) : null;
      if (input.result === 'callback' && (!callbackAt || callbackAt.getTime() <= Date.now())) throw new AppException('ORDER_CALLBACK_IN_PAST', {}, { callbackAt: 'validation.date' });
      await tx.orderCall.create({ data: { orderId: o.id, userId, result: input.result, callbackAt, notes: input.notes ?? null } });
      const attempts = await tx.orderCall.count({ where: { orderId: o.id } });
      warning = plan.warning;
      const data: Prisma.OrderUncheckedUpdateInput = { callAttempts: attempts, callbackAt: plan.callback === 'set' ? callbackAt : null, version: { increment: 1 } };
      if (plan.confirmationStatus && !plan.warning) data.confirmationStatus = plan.confirmationStatus;
      const updated = await tx.order.update({ where: { id: o.id }, data });
      if (plan.confirmationStatus && !plan.warning && plan.confirmationStatus !== o.confirmationStatus) {
        await tx.orderStatusHistory.create({ data: { orderId: o.id, field: 'confirmationStatus', from: o.confirmationStatus, to: plan.confirmationStatus, actorType: actor.type, actorId: actor.id, reason: input.notes ?? null } });
      }
      if (plan.statusTo) {
        const locked = await this.orders.lock(tx, o.id);
        await this.transition(tx, locked, plan.statusTo, { actor, reason: plan.cancelReason, note: input.notes ?? null, notifyCustomer: plan.statusTo === 'confirmed' });
      } else {
        await this.orders.effects.emitUpdated(tx, updated, ['confirmationStatus', 'callAttempts']);
      }
    }, locale);
    return { order: await this.orders.get(id, locale), warning };
  }

  async calls(id: string, locale: string) {
    return (await this.orders.get(id, locale)).calls;
  }

  // --- callback reminder (Figma « Programmer un rappel », 04 §21) ---------------------------------------------------------
  /** `POST /orders/:id/callback { at, note?, notifyCustomer? }` — `confirmationStatus=callback`, pill RAPPEL hh:mm. */
  async setCallback(id: string, input: { at: string; note?: string | null; notifyCustomer?: boolean }, locale: string) {
    const at = new Date(input.at);
    if (at.getTime() <= Date.now()) throw new AppException('ORDER_CALLBACK_IN_PAST', {}, { at: 'validation.date' });
    const actor = this.orders.actor();
    return this.run(id, undefined, locale, async (tx, o) => {
      if (isTerminal(o.status)) throw new AppException('ORDER_TERMINAL');
      if (!['new', 'confirmed', 'preparing'].includes(o.status)) throw new AppException('ORDER_INVALID_TRANSITION', { from: o.status, to: o.status });
      const updated = await tx.order.update({ where: { id }, data: { callbackAt: at, confirmationStatus: 'callback', version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId: id, field: 'callbackAt', from: o.callbackAt?.toISOString() ?? null, to: at.toISOString(), actorType: actor.type, actorId: actor.id, reason: input.note ?? null } });
      await this.effects.emitUpdated(tx, updated, ['callbackAt', 'confirmationStatus']);
      if (input.notifyCustomer) {
        const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
        await this.effects.customerText(tx, o, 'reminderScheduled', { time });
      }
    });
  }

  /** `DELETE /orders/:id/callback` — back to the state of the last call (no call ⇒ `pending`). */
  async clearCallback(id: string, locale: string) {
    const actor = this.orders.actor();
    return this.run(id, undefined, locale, async (tx, o) => {
      if (!o.callbackAt && o.confirmationStatus !== 'callback') return;
      const last = await tx.orderCall.findFirst({ where: { orderId: id, result: { not: 'callback' } }, orderBy: { calledAt: 'desc' } });
      const confirmationStatus = o.confirmationStatus !== 'callback' ? o.confirmationStatus : last ? (callPlan({ status: 'new', deliveryStatus: 'not_sent' }, last.result).confirmationStatus ?? 'pending') : 'pending';
      const updated = await tx.order.update({ where: { id }, data: { callbackAt: null, confirmationStatus, version: { increment: 1 } } });
      await tx.orderStatusHistory.create({ data: { orderId: id, field: 'callbackAt', from: o.callbackAt?.toISOString() ?? null, to: '', actorType: actor.type, actorId: actor.id } });
      await this.effects.emitUpdated(tx, updated, ['callbackAt', 'confirmationStatus']);
    });
  }

  /** `sched-order-reminders`: one `order.callback_due` per (order, callbackAt) — idempotency key `cb:<orderId>:<ISO>`. */
  async remindDue(now = new Date()) {
    const due = await TenantContext.runSystem(() =>
      prisma.order.findMany({ where: { confirmationStatus: 'callback', callbackAt: { lte: now, gte: new Date(now.getTime() - DAY) } }, select: { id: true, workspaceId: true, number: true, clientName: true, assigneeId: true, callbackAt: true } }),
    );
    for (const o of due) {
      await TenantContext.runAs(o.workspaceId, () =>
        prisma.$transaction((tx) =>
          this.effects.notify(tx as Tx, 'order_callback_due', {
            workspaceId: o.workspaceId,
            key: `cb:${o.id}:${o.callbackAt!.toISOString()}`,
            ...(o.assigneeId ? { userIds: [o.assigneeId] } : { roles: ['owner', 'admin', 'operator'] }),
            data: { orderId: o.id, callbackAt: o.callbackAt!.toISOString(), client: o.clientName, number: o.number },
          }),
        ),
      );
    }
    return due.length;
  }

  // --- address (04 §21 "Address edit") ----------------------------------------------------------------------------------
  /** `POST /orders/:id/address` — locked once a courier parcel exists; fee recomputed unless it was an Admin override. */
  async setAddress(id: string, input: OrderAddressInput, locale: string) {
    const actor = this.orders.actor();
    return this.run(id, undefined, locale, (tx, o) => this.applyAddress(tx, o, input, actor));
  }

  /**
   * The address change itself on a row-locked order (also used by the courier send dialog when the address was edited
   * there, DLV-05): commune checked against the wilaya, fee recomputed unless it was an Admin override.
   */
  async applyAddress(tx: Tx, o: Locked, input: Omit<OrderAddressInput, 'phone2'> & { phone2?: string | null }, actor: Actor) {
    const id = o.id;
    {
      if (isTerminal(o.status)) throw new AppException('ORDER_TERMINAL');
      const active = this.orders.activeShipment(o);
      if (active && active.provider !== 'manual') throw new AppException('COURIER_ADDRESS_LOCKED');
      const { commune } = await this.orders.geo.checkAddress(input, tx);
      const net = o.subtotal - o.discount;
      let deliveryFee = o.deliveryFee;
      const before = o.wilayaId ? await this.orders.fees.quote({ wilayaId: o.wilayaId, isStopdesk: o.isStopdesk, subtotal: net }, tx) : null;
      const overridden = !!before && before.wilayaServed && before.fee !== o.deliveryFee;
      if (!overridden) {
        const q = await this.orders.fees.quote({ wilayaId: input.wilayaId, isStopdesk: input.isStopdesk, subtotal: net }, tx);
        if (!q.wilayaServed || q.reason === 'stopdesk_unavailable') throw new AppException('WILAYA_NOT_SERVED', {}, { wilayaId: 'validation.wilaya' });
        deliveryFee = q.fee;
      }
      const total = o.subtotal - o.discount + o.tax + deliveryFee;
      if (o.amountPaid > total) throw new AppException('VALIDATION_ERROR', {}, { wilayaId: 'validation.range' });
      const paid = await this.effects.recomputePaid(tx, { id, total });
      const updated = await tx.order.update({
        where: { id },
        data: { wilayaId: input.wilayaId, communeId: commune?.id ?? null, communeText: commune ? null : (input.communeText ?? null), address: input.address ?? null, isStopdesk: input.isStopdesk, stopdeskId: input.stopdeskId ?? null, ...(input.phone2 !== undefined ? { clientPhone2: input.phone2 } : {}), deliveryFee, total, ...paid, version: { increment: 1 } },
      });
      if (active && active.provider === 'manual') await tx.shipment.update({ where: { id: active.id }, data: { codAmount: Math.max(0, total - paid.amountPaid) } });
      await tx.orderStatusHistory.create({ data: { orderId: id, field: 'address', from: o.wilayaId ? `${o.wilayaId}` : null, to: `${input.wilayaId}`, actorType: actor.type, actorId: actor.id } });
      await this.effects.emitUpdated(tx, updated, ['address', 'deliveryFee', 'total']);
      await this.effects.sheets(tx, updated);
      // 04 §21: the customer is told through the conversation when it is open and inside 24 h (thread event for the AI and the team)
      if (o.conversationId) {
        const conv = await tx.conversation.findFirst({ where: { id: o.conversationId, deletedAt: null }, select: { status: true, lastCustomerMessageAt: true } });
        if (conv && conv.status !== 'archived' && withinWindow(conv.lastCustomerMessageAt, new Date())) await this.effects.threadEvent(tx, o, 'order_address_updated', { orderId: id, number: o.number, wilayaId: input.wilayaId, deliveryFee, total });
      }
      return updated;
    }
  }

  // --- assignment ---------------------------------------------------------------------------------------------------------
  /** `POST /orders/:id/assign { assigneeId|null, notify? }` — `order.assigned` (in-app + push) when `notify`. */
  async assign(id: string, assigneeId: string | null, notify: boolean, locale: string, tx?: Tx) {
    const t = TenantContext.get();
    const actor = this.orders.actor();
    const work = async (db: Tx) => {
      const o = await this.orders.lock(db, id);
      if (assigneeId && !(await db.membership.findFirst({ where: { workspaceId: t.workspaceId, userId: assigneeId } }))) throw new AppException('VALIDATION_ERROR', {}, { assigneeId: 'validation.invalid' });
      if (o.assigneeId === assigneeId) return o;
      const updated = await db.order.update({ where: { id }, data: { assigneeId, version: { increment: 1 } } });
      await db.orderStatusHistory.create({ data: { orderId: id, field: 'assigneeId', from: o.assigneeId, to: assigneeId ?? '', actorType: actor.type, actorId: actor.id } });
      await this.effects.emitUpdated(db, updated, ['assigneeId']);
      if (notify && assigneeId && assigneeId !== t.userId) {
        await this.effects.notify(db, 'order_assigned', { workspaceId: o.workspaceId, key: `order_assigned:${id}:${updated.version}`, userIds: [assigneeId], data: { orderId: id, assignedById: t.userId ?? null, number: o.number } });
      }
      return updated;
    };
    if (tx) return work(tx);
    await this.orders.inTx(work, locale);
    return this.orders.get(id, locale);
  }

  // --- payments (PAY-01, 04 §1.4) -------------------------------------------------------------------------------------------
  /** `POST /orders/:id/payments` (Idempotency-Key required) — ≤ remaining; locked on terminal orders. */
  recordPayment(id: string, input: RecordPaymentInput, locale: string) {
    const actor = this.orders.actor();
    return this.run(id, undefined, locale, async (tx, o) => {
      if (isTerminal(o.status)) throw new AppException('ORDER_PAYMENT_LOCKED');
      if (input.amount > o.total - o.amountPaid) throw new AppException('VALIDATION_ERROR', {}, { amount: 'validation.range' });
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      if (paidAt.getTime() > Date.now() + DAY) throw new AppException('VALIDATION_ERROR', {}, { paidAt: 'validation.date' });
      await this.effects.addPayment(tx, o, { amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidAt, description: `Commande #${o.number} (paiement)` }, actor);
      const paid = await this.effects.recomputePaid(tx, o);
      const updated = await tx.order.update({ where: { id }, data: { ...paid, version: { increment: 1 } } });
      if (paid.paymentStatus !== o.paymentStatus) await tx.orderStatusHistory.create({ data: { orderId: id, field: 'paymentStatus', from: o.paymentStatus, to: paid.paymentStatus, actorType: actor.type, actorId: actor.id } });
      if (paid.paymentStatus === 'paid' && o.paymentStatus !== 'paid') await this.effects.webhook(tx, 'order.paid', id, { amountPaid: paid.amountPaid, method: input.method }, ':paid');
      await this.effects.recomputeClient(tx, o.clientId);
      await this.effects.emitUpdated(tx, updated, ['amountPaid', 'paymentStatus']);
      await this.effects.sheets(tx, updated);
    });
  }

  async payments(id: string, locale: string) {
    return (await this.orders.get(id, locale)).payments;
  }

  // --- notes ------------------------------------------------------------------------------------------------------------
  async addNote(id: string, body: string, locale: string) {
    const t = TenantContext.get();
    if (!t.userId) throw new AppException('FORBIDDEN');
    await this.orders.inTx(async (tx) => {
      const o = await this.orders.lock(tx, id);
      await tx.orderNote.create({ data: { orderId: id, authorId: t.userId!, body } });
      await this.effects.emitUpdated(tx, o, ['notes']);
    }, locale);
    return (await this.orders.get(id, locale)).orderNotes;
  }

  async notes(id: string, locale: string) {
    return (await this.orders.get(id, locale)).orderNotes;
  }

  // --- bulk (04 §21, LST-04: per-row results, never stops on the first error) ----------------------------------------------
  /** `POST /orders/bulk/status` — delivered / returned are never bulk (422 ORDER_INVALID_TRANSITION for the whole request). */
  async bulkStatus(input: { ids: string[]; to: OrderStatusName; reason?: string | null; note?: string | null; trackingNumber?: string | null }, ctx: BulkCtx) {
    if (!(ORDER_BULK_STATUS_TARGETS as readonly string[]).includes(input.to)) throw new AppException('ORDER_INVALID_TRANSITION', { from: '*', to: input.to });
    const actor = this.orders.actor();
    return runBulk(this.i18n, input.ids, ctx, async (id, tx) => {
      const o = await this.orders.lock(tx!, id);
      const updated = await this.transition(tx!, o, input.to, { actor, reason: input.to === 'cancelled' ? (input.reason ?? 'other') : input.reason, note: input.note, trackingNumber: input.trackingNumber ?? null });
      return { status: updated.status, version: updated.version };
    });
  }

  bulkAssign(input: { ids: string[]; assigneeId: string | null; notify?: boolean }, ctx: BulkCtx) {
    return runBulk(this.i18n, input.ids, ctx, async (id, tx) => {
      const o = (await this.assign(id, input.assigneeId, input.notify ?? false, ctx.locale, tx)) as Order;
      return { assigneeId: o.assigneeId };
    });
  }

  // --- the AI cancellation (ORDER_TOOLS, 04 §5 "AI cancel") ------------------------------------------------------------
  /** Only this client's `new / confirmed / preparing` orders with nothing sent (re-checked under the row lock). */
  async cancelFromAi(ctx: OrderToolContext, order: CancellableOrder, reason: string | null): Promise<ToolResult> {
    try {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const o = await this.orders.lock(tx, order.id);
        if (o.clientId !== ctx.clientId || !['new', 'confirmed', 'preparing'].includes(o.status) || o.deliveryStatus !== 'not_sent') throw new AppException('ORDER_INVALID_TRANSITION', { from: o.status, to: 'cancelled' });
        await this.transition(tx, o, 'cancelled', { actor: { type: 'ai', id: ctx.agentId }, reason: 'changed_mind', note: reason ? `IA : ${reason}` : 'IA : demande du client', system: true, notifyCustomer: false, shipmentNotice: false });
      });
    } catch (e) {
      if (e instanceof AppException && (e.code === 'ORDER_INVALID_TRANSITION' || e.code === 'ORDER_TERMINAL' || e.code === 'DELIVERY_ORDER_ALREADY_SENT' || e.code === 'NOT_FOUND')) return { ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } };
      throw e;
    }
    return { ok: true, cancelled: { number: order.number } };
  }
}
