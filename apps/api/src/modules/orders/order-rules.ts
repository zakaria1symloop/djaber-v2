// 04 §1.2 (+ D14, §21) status machine, §1.3 call outcomes, §1.4 payment / COD, §3 side-effect plan — pure functions,
// no database. `OrderEffects` executes the plans; the unit tests (`order-rules.spec.ts`) cover every pair of the matrix.
import { canTransition, derivePaymentStatus, ORDER_ADDRESS_REQUIRED_FOR, ORDER_BACKDATE_MAX_DAYS, ORDER_TERMINAL_STATUSES, type CallResultName, type CancelReasonName, type OrderStatusName } from '@djaber/shared';
import type { ErrorCode } from '@djaber/shared';

export type Role = 'owner' | 'admin' | 'operator' | undefined;
export type Refusal = { code: ErrorCode; params?: Record<string, string | number>; fields?: Record<string, string> };
export type OrderState = {
  status: OrderStatusName;
  deliveryStatus: string;
  /** status of the active shipment (null when none) */
  shipmentStatus: string | null;
  /** an active shipment created at a courier (provider ≠ manual) */
  courierParcel: boolean;
  hasAddress: boolean;
};

const DAY = 86_400_000;
export const isTerminal = (s: OrderStatusName) => (ORDER_TERMINAL_STATUSES as readonly string[]).includes(s);
const ADMIN_UP: Role[] = ['owner', 'admin'];

/**
 * Can `actor` move the order to `to`? `null` = allowed. `system` = courier sync / AI (no role check).
 * Order of the checks: terminal → matrix → pickup guard → role → address.
 */
export const checkTransition = (o: OrderState, to: OrderStatusName, actor: { role: Role; system?: boolean }): Refusal | null => {
  if (isTerminal(o.status)) return { code: 'ORDER_TERMINAL' };
  if (o.status === to) return { code: 'ORDER_INVALID_TRANSITION', params: { from: o.status, to } };
  // cancelling with a live courier parcel: cancel the parcel first or mark returned (04 §9, 06 §8.5)
  if (to === 'cancelled' && o.courierParcel) return { code: 'DELIVERY_ORDER_ALREADY_SENT' };
  if (!canTransition(o.status, to)) return { code: 'ORDER_INVALID_TRANSITION', params: { from: o.status, to } };
  // 04 §21 "Confirmée (retour arrière)": only while the courier has not picked the parcel up
  if (o.status === 'shipped' && to === 'confirmed' && o.shipmentStatus && !['pending', 'sent'].includes(o.shipmentStatus)) {
    return { code: 'ORDER_INVALID_TRANSITION', params: { from: o.status, to } };
  }
  // `delivered → returned` is Admin+ (06 §9; courier sync may do it too)
  if (o.status === 'delivered' && to === 'returned' && !actor.system && !ADMIN_UP.includes(actor.role)) return { code: 'FORBIDDEN' };
  if ((ORDER_ADDRESS_REQUIRED_FOR as readonly string[]).includes(to) && !o.hasAddress) return { code: 'ORDER_ADDRESS_REQUIRED' };
  return null;
};

/** Targets offered in the "Changer le statut" dialog / row menu for this actor (feeds `actions`). */
export const allowedTargets = (o: OrderState, role: Role): OrderStatusName[] =>
  (['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'] as OrderStatusName[]).filter((to) => {
    const r = checkTransition({ ...o, hasAddress: true }, to, { role });
    return !r;
  });

/** `commit`: a `new` order leaves `new` — its reserved quantities become `out` movements (owner decision 2026-10-21). */
export type StockPlan = 'commit' | 'restore_cancel' | 'restore_return' | 'loss_trail' | null;
export type CashPlan = 'cod' | 'clear' | 'clear_and_return_fee' | null;
export type ShipmentPlan = 'create_manual' | 'mark_delivered' | 'mark_returned' | 'cancel_manual' | null;
export type TransitionPlan = {
  stock: StockPlan;
  cash: CashPlan;
  shipment: ShipmentPlan;
  deliveryStatus: string | null;
  confirmationStatus: 'confirmed' | null;
  stamps: ('confirmedAt' | 'shippedAt' | 'deliveredAt' | 'cancelledAt')[];
  clearCallback: boolean;
  /** `customer.<key>` transactional text (sent when the order has a conversation and `notifyCustomer !== false`) */
  customerText: 'orderConfirmed' | 'orderCancelled' | 'orderDelivered' | 'orderShipped' | null;
  /** outbound webhook events (api-contract §6, 03-events §6) besides `order.status_changed` */
  webhooks: string[];
  /** client aggregates / risk recomputed */
  aggregates: boolean;
};

/**
 * 04 §3 — what a status change does. A `new` order only reserves its stock: leaving `new` for a live status takes it
 * (`commit`); cancel / return give back what was taken
 * (`restoreStock=false` on a return writes the loss trail instead). Cash: COD on delivery, auto rows removed on
 * cancel, removed + return fee (D27) on return.
 */
export const transitionPlan = (from: OrderStatusName, to: OrderStatusName, o: { restoreStock?: boolean; paymentStatus: string; hasActiveShipment: boolean }): TransitionPlan => {
  const plan: TransitionPlan = { stock: null, cash: null, shipment: null, deliveryStatus: null, confirmationStatus: null, stamps: [], clearCallback: false, customerText: null, webhooks: [], aggregates: false };
  switch (to) {
    case 'confirmed':
      plan.stamps.push('confirmedAt');
      plan.confirmationStatus = 'confirmed';
      plan.clearCallback = true;
      if (from === 'new') plan.customerText = 'orderConfirmed';
      // "Confirmée (retour arrière)": the manual parcel is withdrawn, the order is not sent any more
      if (from === 'shipped') {
        plan.shipment = 'cancel_manual';
        plan.deliveryStatus = 'not_sent';
      }
      break;
    case 'preparing':
      plan.stamps.push('confirmedAt');
      plan.confirmationStatus = from === 'new' ? 'confirmed' : null;
      plan.clearCallback = true;
      break;
    case 'shipped':
      plan.stamps.push('confirmedAt', 'shippedAt');
      plan.clearCallback = true;
      plan.deliveryStatus = 'sent';
      if (!o.hasActiveShipment) plan.shipment = 'create_manual';
      plan.customerText = 'orderShipped';
      plan.webhooks.push('order.shipped');
      break;
    case 'delivered':
      plan.stamps.push('deliveredAt');
      plan.clearCallback = true;
      plan.deliveryStatus = 'delivered';
      plan.shipment = o.hasActiveShipment ? 'mark_delivered' : null;
      plan.cash = o.paymentStatus === 'paid' ? null : 'cod';
      plan.customerText = 'orderDelivered';
      plan.webhooks.push('order.delivered');
      plan.aggregates = true;
      break;
    case 'cancelled':
      plan.stamps.push('cancelledAt');
      plan.clearCallback = true;
      plan.stock = 'restore_cancel';
      plan.cash = 'clear';
      plan.customerText = 'orderCancelled';
      plan.webhooks.push('order.cancelled');
      plan.aggregates = true;
      break;
    case 'returned':
      plan.deliveryStatus = 'returned';
      plan.shipment = 'mark_returned';
      plan.stock = o.restoreStock === false ? 'loss_trail' : 'restore_return';
      plan.cash = 'clear_and_return_fee';
      plan.webhooks.push('order.returned');
      plan.aggregates = true;
      break;
    default:
      break;
  }
  // a new order confirmed (or prepared / shipped / delivered straight away) takes its reserved stock now
  if (from === 'new' && (to === 'confirmed' || to === 'preparing' || to === 'shipped' || to === 'delivered')) plan.stock = 'commit';
  return plan;
};

/** 04 §21: the effective date of a status change may be back-dated by ≤ 7 days, never in the future (+ 5 min clock skew). */
export const checkEffectiveAt = (effectiveAt: Date | null | undefined, now: Date = new Date()): Refusal | null => {
  if (!effectiveAt) return null;
  if (effectiveAt.getTime() > now.getTime() + 5 * 60_000 || now.getTime() - effectiveAt.getTime() > ORDER_BACKDATE_MAX_DAYS * DAY) {
    return { code: 'VALIDATION_ERROR', fields: { effectiveAt: 'validation.date' } };
  }
  return null;
};

/**
 * 04 §1.4 / §21 / §23 COD rule. `amountCollected` = what the courier / the merchant cashed in total (default = total);
 * the new payment entry brings `amountPaid` up to it; a different amount needs a reason.
 */
export const codPlan = (o: { total: number; amountPaid: number }, amountCollected: number | undefined, reason: string | null | undefined): { entry: number; finalPaid: number } | Refusal => {
  const collected = amountCollected ?? o.total;
  if (collected > o.total) return { code: 'VALIDATION_ERROR', fields: { amountCollected: 'validation.range' } };
  if (collected !== o.total && !(reason ?? '').trim()) return { code: 'VALIDATION_ERROR', fields: { reason: 'validation.required' } };
  const finalPaid = Math.max(collected, o.amountPaid);
  return { entry: finalPaid - o.amountPaid, finalPaid };
};

export type CallPlan = {
  confirmationStatus: 'confirmed' | 'no_answer' | 'rejected' | 'wrong_number' | 'callback' | null;
  /** status change caused by the call */
  statusTo: 'confirmed' | 'cancelled' | null;
  cancelReason: CancelReasonName | null;
  /** logged, order unchanged (`ORDER_CALL_ON_TERMINAL` warning) */
  warning: boolean;
  riskHigh: boolean;
  /** `callbackAt` kept (result `callback`) or cleared (any other logged call — 04 §21) */
  callback: 'set' | 'clear';
};

/**
 * 04 §1.3 + §21 call outcomes. `rejected` / `wrong_number` auto-cancel only when `status ∈ new|confirmed|preparing`
 * and nothing was sent; `picked_up` confirms a `new` order; any call on a terminal (or non-cancellable) order is logged
 * with a warning and changes nothing.
 */
export const callPlan = (o: { status: OrderStatusName; deliveryStatus: string }, result: CallResultName): CallPlan => {
  const base: CallPlan = { confirmationStatus: null, statusTo: null, cancelReason: null, warning: false, riskHigh: false, callback: result === 'callback' ? 'set' : 'clear' };
  const cancellable = ['new', 'confirmed', 'preparing'].includes(o.status) && o.deliveryStatus === 'not_sent';
  if (isTerminal(o.status)) return { ...base, warning: true, callback: 'clear' };
  switch (result) {
    case 'picked_up':
      return { ...base, confirmationStatus: 'confirmed', statusTo: o.status === 'new' ? 'confirmed' : null };
    case 'no_answer':
    case 'busy':
    case 'voicemail':
      return { ...base, confirmationStatus: 'no_answer' };
    case 'rejected':
      return cancellable ? { ...base, confirmationStatus: 'rejected', statusTo: 'cancelled', cancelReason: 'changed_mind' } : { ...base, warning: true };
    case 'wrong_number':
      return cancellable ? { ...base, confirmationStatus: 'wrong_number', statusTo: 'cancelled', cancelReason: 'fake', riskHigh: true } : { ...base, warning: true, riskHigh: true };
    case 'callback':
      return { ...base, confirmationStatus: 'callback' };
    default:
      return base;
  }
};

/** 04 §4: `lineTotal = unitPrice × qty − lineDiscount`, `subtotal = Σ`, `total = subtotal − discount + tax + deliveryFee`. */
export const orderTotals = (lines: { unitPrice: number; quantity: number; discount?: number }[], o: { discount?: number; tax?: number; deliveryFee: number }) => {
  const totals = lines.map((l) => l.unitPrice * l.quantity - (l.discount ?? 0));
  const subtotal = totals.reduce((n, t) => n + t, 0);
  const total = subtotal - (o.discount ?? 0) + (o.tax ?? 0) + o.deliveryFee;
  return { lineTotals: totals, subtotal, total };
};

/** 04 §1.4: `paymentStatus` sent without `amountPaid` is refused (V1 let them disagree — fix); with both they must agree. */
export const checkPaymentPatch = (p: { amountPaid?: number; paymentStatus?: string }, total: number): Refusal | null => {
  if (p.paymentStatus !== undefined && p.amountPaid === undefined) return { code: 'VALIDATION_ERROR', fields: { amountPaid: 'validation.required' } };
  if (p.amountPaid !== undefined && p.amountPaid > total) return { code: 'VALIDATION_ERROR', fields: { amountPaid: 'validation.range' } };
  if (p.paymentStatus !== undefined && p.amountPaid !== undefined && p.paymentStatus !== derivePaymentStatus(p.amountPaid, total)) {
    return { code: 'VALIDATION_ERROR', fields: { paymentStatus: 'validation.invalid' } };
  }
  return null;
};

/** 04 §2: business dates ≤ now + 1 day. */
export const checkOrderedAt = (orderedAt: Date | null | undefined, now: Date = new Date()): Refusal | null =>
  orderedAt && orderedAt.getTime() > now.getTime() + DAY ? { code: 'VALIDATION_ERROR', fields: { orderedAt: 'validation.date' } } : null;

/** Lines whose stock moves: tracked products only, at variant level for variant products (04 §3). */
export type StockLine = { productId: string; variantId: string | null; quantity: number; trackStock: boolean };
export const stockKey = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;
/**
 * Moves needed to bring the order's net stock movements (`current`, per product/variant, ≤ 0) to the target given by
 * the lines (−qty per tracked line; 0 for cancel / delete). Positive = give back, negative = take.
 */
export const stockDeltas = (target: StockLine[], current: Map<string, number>): { productId: string; variantId: string | null; delta: number }[] => {
  const want = new Map<string, { productId: string; variantId: string | null; qty: number }>();
  for (const l of target) {
    if (!l.trackStock) continue;
    const k = stockKey(l.productId, l.variantId);
    const w = want.get(k) ?? { productId: l.productId, variantId: l.variantId, qty: 0 };
    w.qty += l.quantity;
    want.set(k, w);
  }
  const keys = new Set([...want.keys(), ...current.keys()]);
  const out: { productId: string; variantId: string | null; delta: number }[] = [];
  for (const k of keys) {
    const w = want.get(k);
    const [productId, variantId] = k.split(':') as [string, string];
    const delta = -(w?.qty ?? 0) - (current.get(k) ?? 0);
    if (delta !== 0) out.push({ productId: w?.productId ?? productId, variantId: w ? w.variantId : variantId || null, delta });
  }
  return out;
};
