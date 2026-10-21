// AT-ORD-01 (table-driven over every (from, to) pair of 04 §1.2 + D14 + §21), AT-ORD-02 COD plan, AT-ORD-03 / 18 / 25
// call outcomes, AT-ORD-22 payment rules, the 04 §3 effects plan of every allowed transition, totals and stock deltas.
import { derivePaymentStatus, ORDER_STATUS_TRANSITIONS, type OrderStatusName } from '@djaber/shared';
import { callPlan, checkEffectiveAt, checkOrderedAt, checkPaymentPatch, checkTransition, codPlan, orderTotals, stockDeltas, transitionPlan, type OrderState } from './order-rules';

const ALL: OrderStatusName[] = ['new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'];
/** 04 §1.2 as written in the spec (the matrix the code must match), + "Confirmée (retour arrière)" from shipped (04 §21). */
const SPEC: Record<OrderStatusName, OrderStatusName[]> = {
  new: ['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
  confirmed: ['preparing', 'shipped', 'delivered', 'cancelled'],
  preparing: ['shipped', 'delivered', 'cancelled'],
  shipped: ['confirmed', 'delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
const state = (status: OrderStatusName, over: Partial<OrderState> = {}): OrderState => ({ status, deliveryStatus: status === 'shipped' ? 'sent' : status === 'delivered' ? 'delivered' : 'not_sent', shipmentStatus: status === 'shipped' ? 'sent' : null, courierParcel: false, hasAddress: true, ...over });
const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe('AT-ORD-01 status matrix (04 §1.2 + D14)', () => {
  it('the shared matrix is the spec matrix', () => {
    expect(ORDER_STATUS_TRANSITIONS).toEqual(SPEC);
  });

  it.each(pairs)('%s → %s', (from, to) => {
    const r = checkTransition(state(from), to, { role: 'owner' });
    if (from === 'cancelled' || from === 'returned') expect(r).toEqual({ code: 'ORDER_TERMINAL' });
    else if (SPEC[from].includes(to)) expect(r).toBeNull();
    else expect(r).toEqual({ code: 'ORDER_INVALID_TRANSITION', params: { from, to } });
  });

  it('operator may run every allowed transition except delivered → returned (Admin+)', () => {
    for (const [from, to] of pairs.filter(([f, t]) => SPEC[f].includes(t))) {
      const r = checkTransition(state(from), to, { role: 'operator' });
      if (from === 'delivered' && to === 'returned') expect(r).toEqual({ code: 'FORBIDDEN' });
      else expect(r).toBeNull();
    }
    expect(checkTransition(state('delivered'), 'returned', { role: 'admin' })).toBeNull();
    expect(checkTransition(state('delivered'), 'returned', { role: 'operator', system: true })).toBeNull(); // courier sync
  });

  it('AT-ORD-17 / 04 §1.6: confirmed, preparing, shipped need the delivery address; delivered / cancelled do not', () => {
    const noAddress = state('new', { hasAddress: false });
    expect(checkTransition(noAddress, 'confirmed', { role: 'owner' })).toEqual({ code: 'ORDER_ADDRESS_REQUIRED' });
    expect(checkTransition(noAddress, 'preparing', { role: 'owner' })).toEqual({ code: 'ORDER_ADDRESS_REQUIRED' });
    expect(checkTransition(noAddress, 'shipped', { role: 'owner' })).toEqual({ code: 'ORDER_ADDRESS_REQUIRED' });
    expect(checkTransition(noAddress, 'delivered', { role: 'owner' })).toBeNull();
    expect(checkTransition(noAddress, 'cancelled', { role: 'owner' })).toBeNull();
  });

  it('AT-ORD-26 "Confirmée (retour arrière)" only before the courier picked the parcel up', () => {
    expect(checkTransition(state('shipped', { shipmentStatus: 'pending' }), 'confirmed', { role: 'owner' })).toBeNull();
    expect(checkTransition(state('shipped', { shipmentStatus: 'sent' }), 'confirmed', { role: 'owner' })).toBeNull();
    for (const s of ['picked_up', 'in_transit', 'out_for_delivery']) {
      expect(checkTransition(state('shipped', { shipmentStatus: s }), 'confirmed', { role: 'owner' })).toEqual({ code: 'ORDER_INVALID_TRANSITION', params: { from: 'shipped', to: 'confirmed' } });
    }
  });

  it('a live courier parcel blocks the cancellation (04 §9) — before the matrix check', () => {
    expect(checkTransition(state('confirmed', { courierParcel: true }), 'cancelled', { role: 'owner' })).toEqual({ code: 'DELIVERY_ORDER_ALREADY_SENT' });
    expect(checkTransition(state('shipped', { courierParcel: true }), 'cancelled', { role: 'owner' })).toEqual({ code: 'DELIVERY_ORDER_ALREADY_SENT' });
    expect(checkTransition(state('shipped'), 'cancelled', { role: 'owner' })).toEqual({ code: 'ORDER_INVALID_TRANSITION', params: { from: 'shipped', to: 'cancelled' } });
  });
});

describe('04 §3 effects plan of every allowed transition', () => {
  const allowed = pairs.filter(([f, t]) => SPEC[f].includes(t));
  it.each(allowed)('%s → %s', (from, to) => {
    const unpaid = transitionPlan(from, to, { paymentStatus: 'unpaid', hasActiveShipment: from === 'shipped' });
    // a new order only reserves: leaving `new` for a live status takes the stock (`commit`, owner decision 2026-10-21);
    // cancel / return give back what was taken
    expect(unpaid.stock).toBe(to === 'cancelled' ? 'restore_cancel' : to === 'returned' ? 'restore_return' : from === 'new' ? 'commit' : null);
    expect(unpaid.cash).toBe(to === 'delivered' ? 'cod' : to === 'cancelled' ? 'clear' : to === 'returned' ? 'clear_and_return_fee' : null);
    expect(unpaid.aggregates).toBe(['delivered', 'cancelled', 'returned'].includes(to));
    if (to === 'shipped') expect(unpaid.shipment).toBe(from === 'shipped' ? null : 'create_manual');
    if (to === 'delivered') expect(unpaid.deliveryStatus).toBe('delivered');
    if (to === 'returned') expect(unpaid.shipment).toBe('mark_returned');
    // COD is never applied twice
    if (to === 'delivered') expect(transitionPlan(from, to, { paymentStatus: 'paid', hasActiveShipment: false }).cash).toBeNull();
  });

  it('return without restock writes the loss trail instead of the return movement (AT-ORD-28)', () => {
    expect(transitionPlan('shipped', 'returned', { restoreStock: false, paymentStatus: 'unpaid', hasActiveShipment: true }).stock).toBe('loss_trail');
    expect(transitionPlan('shipped', 'returned', { restoreStock: true, paymentStatus: 'unpaid', hasActiveShipment: true }).stock).toBe('restore_return');
  });

  it('customer texts and webhooks', () => {
    expect(transitionPlan('new', 'confirmed', { paymentStatus: 'unpaid', hasActiveShipment: false }).customerText).toBe('orderConfirmed');
    expect(transitionPlan('new', 'cancelled', { paymentStatus: 'unpaid', hasActiveShipment: false })).toMatchObject({ customerText: 'orderCancelled', webhooks: ['order.cancelled'] });
    expect(transitionPlan('preparing', 'delivered', { paymentStatus: 'unpaid', hasActiveShipment: false })).toMatchObject({ customerText: 'orderDelivered', webhooks: ['order.delivered'] });
    expect(transitionPlan('shipped', 'confirmed', { paymentStatus: 'unpaid', hasActiveShipment: true })).toMatchObject({ shipment: 'cancel_manual', deliveryStatus: 'not_sent' });
  });
});

describe('AT-ORD-02 / AT-ORD-27 COD rule (04 §1.4, §21, §23)', () => {
  it('unpaid order delivered ⇒ one entry for the total', () => {
    expect(codPlan({ total: 8300, amountPaid: 0 }, undefined, null)).toEqual({ entry: 8300, finalPaid: 8300 });
  });
  it('partial before ⇒ the entry brings the paid amount up to the total', () => {
    expect(codPlan({ total: 1000, amountPaid: 300 }, undefined, null)).toEqual({ entry: 700, finalPaid: 1000 });
  });
  it('a different amount needs a reason; with it the order ends partial', () => {
    expect(codPlan({ total: 8300, amountPaid: 0 }, 8000, null)).toEqual({ code: 'VALIDATION_ERROR', fields: { reason: 'validation.required' } });
    expect(codPlan({ total: 8300, amountPaid: 0 }, 8000, 'remise du livreur')).toEqual({ entry: 8000, finalPaid: 8000 });
    expect(derivePaymentStatus(8000, 8300)).toBe('partial');
    expect(codPlan({ total: 8300, amountPaid: 0 }, 9000, 'x')).toEqual({ code: 'VALIDATION_ERROR', fields: { amountCollected: 'validation.range' } });
  });
});

describe('04 §1.3 / §21 call outcomes (AT-ORD-03, 18, 25)', () => {
  const open = { status: 'new' as const, deliveryStatus: 'not_sent' };
  it.each(['no_answer', 'busy', 'voicemail'] as const)('%s ⇒ confirmationStatus no_answer, status unchanged', (result) => {
    expect(callPlan(open, result)).toMatchObject({ confirmationStatus: 'no_answer', statusTo: null, warning: false, callback: 'clear' });
  });
  it('picked_up confirms a new order; on a confirmed one only the confirmation status moves', () => {
    expect(callPlan(open, 'picked_up')).toMatchObject({ confirmationStatus: 'confirmed', statusTo: 'confirmed' });
    expect(callPlan({ status: 'confirmed', deliveryStatus: 'not_sent' }, 'picked_up')).toMatchObject({ confirmationStatus: 'confirmed', statusTo: null });
  });
  it('rejected auto-cancels only a new / confirmed / preparing order not sent', () => {
    for (const status of ['new', 'confirmed', 'preparing'] as const) expect(callPlan({ status, deliveryStatus: 'not_sent' }, 'rejected')).toMatchObject({ statusTo: 'cancelled', cancelReason: 'changed_mind', confirmationStatus: 'rejected' });
    expect(callPlan({ status: 'shipped', deliveryStatus: 'sent' }, 'rejected')).toMatchObject({ statusTo: null, warning: true });
    expect(callPlan({ status: 'confirmed', deliveryStatus: 'pending' }, 'rejected')).toMatchObject({ statusTo: null, warning: true });
  });
  it('wrong_number ⇒ cancelled "faux numéro" (fake) and client risk high', () => {
    expect(callPlan(open, 'wrong_number')).toEqual({ confirmationStatus: 'wrong_number', statusTo: 'cancelled', cancelReason: 'fake', warning: false, riskHigh: true, callback: 'clear' });
  });
  it('a call on a terminal order is logged with a warning and changes nothing', () => {
    for (const status of ['cancelled', 'returned'] as const) expect(callPlan({ status, deliveryStatus: 'not_sent' }, 'picked_up')).toMatchObject({ statusTo: null, confirmationStatus: null, warning: true });
  });
  it('callback keeps callbackAt, any other result clears it', () => {
    expect(callPlan(open, 'callback')).toMatchObject({ confirmationStatus: 'callback', callback: 'set' });
    expect(callPlan(open, 'no_answer').callback).toBe('clear');
  });
});

describe('AT-ORD-22 payment status (04 §1.4)', () => {
  it('derived from the amount paid', () => {
    expect(derivePaymentStatus(0, 1000)).toBe('unpaid');
    expect(derivePaymentStatus(300, 1000)).toBe('partial');
    expect(derivePaymentStatus(1000, 1000)).toBe('paid');
    expect(derivePaymentStatus(1500, 1000)).toBe('paid');
    expect(derivePaymentStatus(0, 0)).toBe('paid');
  });
  it('paymentStatus without amountPaid is refused; both must agree', () => {
    expect(checkPaymentPatch({ paymentStatus: 'paid' }, 1000)).toEqual({ code: 'VALIDATION_ERROR', fields: { amountPaid: 'validation.required' } });
    expect(checkPaymentPatch({ paymentStatus: 'paid', amountPaid: 300 }, 1000)).toEqual({ code: 'VALIDATION_ERROR', fields: { paymentStatus: 'validation.invalid' } });
    expect(checkPaymentPatch({ paymentStatus: 'partial', amountPaid: 300 }, 1000)).toBeNull();
    expect(checkPaymentPatch({ amountPaid: 1200 }, 1000)).toEqual({ code: 'VALIDATION_ERROR', fields: { amountPaid: 'validation.range' } });
  });
});

describe('dates, totals, stock deltas', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  it('AT-ORD-16 orderedAt: back-dated accepted, more than +1 day refused', () => {
    expect(checkOrderedAt(new Date(now.getTime() - 2 * 86_400_000), now)).toBeNull();
    expect(checkOrderedAt(new Date(now.getTime() + 2 * 86_400_000), now)).toEqual({ code: 'VALIDATION_ERROR', fields: { orderedAt: 'validation.date' } });
  });
  it('effective date back-datable ≤ 7 days, never in the future', () => {
    expect(checkEffectiveAt(new Date(now.getTime() - 3 * 86_400_000), now)).toBeNull();
    expect(checkEffectiveAt(new Date(now.getTime() - 8 * 86_400_000), now)).not.toBeNull();
    expect(checkEffectiveAt(new Date(now.getTime() + 3600_000), now)).not.toBeNull();
  });
  it('04 §4 totals', () => {
    expect(orderTotals([{ unitPrice: 2500, quantity: 2, discount: 100 }, { unitPrice: 1000, quantity: 1 }], { discount: 400, tax: 0, deliveryFee: 600 })).toEqual({ lineTotals: [4900, 1000], subtotal: 5900, total: 6100 });
  });
  it('stock deltas: take on creation, give back to zero, untracked lines never move (AT-CAT-02)', () => {
    const lines = [
      { productId: 'p1', variantId: null, quantity: 2, trackStock: true },
      { productId: 'p2', variantId: 'v1', quantity: 1, trackStock: true },
      { productId: 'svc', variantId: null, quantity: 5, trackStock: false },
    ];
    expect(stockDeltas(lines, new Map())).toEqual([
      { productId: 'p1', variantId: null, delta: -2 },
      { productId: 'p2', variantId: 'v1', delta: -1 },
    ]);
    // recomputed from the net movements, never incremented: running it twice changes nothing
    const taken = new Map([['p1:', -2], ['p2:v1', -1]]);
    expect(stockDeltas(lines, taken)).toEqual([]);
    expect(stockDeltas([], taken)).toEqual([
      { productId: 'p1', variantId: null, delta: 2 },
      { productId: 'p2', variantId: 'v1', delta: 1 },
    ]);
    // an item edit 2 → 3 takes one more
    expect(stockDeltas([{ ...lines[0]!, quantity: 3 }, lines[1]!], taken)).toEqual([{ productId: 'p1', variantId: null, delta: -1 }]);
  });
});
