// UX-064 (04 §22 "Order closed", FL-25 F-8): a failed send of an order delivered / cancelled / returned meanwhile is
// handled — the parcel menu no longer offers « Corriger et renvoyer » / « Changer de transporteur » (not offered, the
// UX-060 rule; ShipmentService refuses them with the readable DELIVERY_ORDER_<STATUS>), and `failureHandled` tells the screens.
import { failureHandledAs, isNotOffered, isOrderSendClosed, sendClosedCode } from '@djaber/shared';
import { TenantContext } from '@djaber/db';
import { shipmentActions } from './shipment.presenter';

const asOwner = <T>(fn: () => T) => TenantContext.run({ workspaceId: 'w1', userId: 'u1', role: 'owner', readOnly: false } as never, fn);
const sendFailure = { provider: 'zrexpress' as const, status: 'failed' as const, trackingNumber: null, lastError: 'COURIER_VALIDATION|cod|Montant supérieur à 150000 DA', deliveryAttempts: 0, courierAccount: null };
const byKey = (order: { status: string }, s = sendFailure) => new Map(asOwner(() => shipmentActions(s, order)).map((a) => [a.key, a]));

describe('UX-064 — send actions of a parcel whose order is closed', () => {
  it('confirmed order with a failed send: « Corriger et renvoyer » is the primary, « Changer de transporteur » is enabled', () => {
    const a = byKey({ status: 'confirmed' });
    expect(a.get('retry')).toEqual({ key: 'retry', enabled: true, primary: true });
    expect(a.get('change_courier')).toMatchObject({ enabled: true });
  });

  it.each([
    ['delivered', 'DELIVERY_ORDER_DELIVERED'],
    ['cancelled', 'DELIVERY_ORDER_CANCELLED'],
    ['returned', 'DELIVERY_ORDER_RETURNED'],
  ])('order %s: retry and change_courier are not offered (%s is a not-offered reason)', (status, code) => {
    const a = byKey({ status });
    expect(a.has('retry')).toBe(false);
    expect(a.has('change_courier')).toBe(false);
    expect(isNotOffered({ enabled: false, reasonCode: code })).toBe(true);
  });

  it('a queued parcel (courier unavailable) of a delivered order cannot be re-sent either', () => {
    const queued = { ...sendFailure, status: 'pending' as const, lastError: 'COURIER_UNAVAILABLE' };
    expect(byKey({ status: 'delivered' }, queued as never).has('retry')).toBe(false);
  });
});

describe('UX-064 — shared rule (one source for API and web)', () => {
  it('closed statuses = delivered, cancelled, returned', () => {
    expect(['new', 'confirmed', 'preparing', 'shipped'].map(isOrderSendClosed)).toEqual([false, false, false, false]);
    expect(['delivered', 'cancelled', 'returned'].map(isOrderSendClosed)).toEqual([true, true, true]);
    expect(sendClosedCode('preparing')).toBeNull();
    expect(sendClosedCode('delivered')).toBe('DELIVERY_ORDER_DELIVERED');
  });

  it('a failed parcel is handled once its order is closed (derived from the current statuses, e.g. #CMD-1008 delivered by hand)', () => {
    expect(failureHandledAs('failed', 'delivered')).toBe('delivered');
    expect(failureHandledAs('failed', 'cancelled')).toBe('cancelled');
    expect(failureHandledAs('failed', 'confirmed')).toBeNull();
    expect(failureHandledAs('failed', 'shipped')).toBeNull();
    expect(failureHandledAs('delivered', 'delivered')).toBeNull();
  });
});
