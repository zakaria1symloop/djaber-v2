// UX-056 leftovers (UX/UI test log 12/11 remarks, 14/11): every greyed reason of the parcel « Actions » menu matches the
// parcel's state — a CRÉÉ parcel of a courier without API cancel no longer says « Colis déjà ramassé », a courier without
// API re-attempt says so, change-courier on a created parcel says « annulez-le d'abord », and an item the state does not
// allow is not offered (12 GLOBAL). Same rules as ShipmentService (`cancelRefusal`, `changeCourierRefusal`,
// `retryDeliveryRefusal`). The « Actualiser » wait travels with its seconds (list rows included).
import { TenantContext } from '@djaber/db';
import { cancelRefusal, changeCourierRefusal, isNotOfferedRefusal, retryDeliveryRefusal, shipmentActions } from './shipment.presenter';

const asOwner = <T>(fn: () => T) => TenantContext.run({ workspaceId: 'w1', userId: 'u1', role: 'owner', readOnly: false } as never, fn);
type P = Parameters<typeof shipmentActions>[0];
const parcel = (o: Partial<P> = {}): P => ({ provider: 'zrexpress', status: 'sent', trackingNumber: 'ZR-1', lastError: null, deliveryAttempts: 0, courierAccount: null, ...o });
const menu = (s: P, order = { status: 'shipped' }, o: { syncAvailableAt?: string | null; now?: number } = {}) => new Map(asOwner(() => shipmentActions(s, order, o)).map((a) => [a.key, a]));
const NO_CANCEL = { cancel: false, retry: false };
const CANCEL = { cancel: true, retry: false };
const RETRY = { cancel: true, retry: true };

describe('cancel — the reason says what blocks it in this state', () => {
  it('CRÉÉ at a courier whose API cannot cancel (ZR Procolis) ⇒ COURIER_CANCEL_UNSUPPORTED (cancel at the courier), not « déjà ramassé »', () => {
    expect(cancelRefusal(parcel(), NO_CANCEL)).toBe('COURIER_CANCEL_UNSUPPORTED');
    expect(menu(parcel()).get('cancel')).toEqual({ key: 'cancel', enabled: false, reasonCode: 'COURIER_CANCEL_UNSUPPORTED' });
  });
  it('CRÉÉ at a courier that can cancel, queued at Djaber, or manual ⇒ allowed', () => {
    expect(cancelRefusal(parcel({ provider: 'yalidine' }), CANCEL)).toBeNull();
    expect(cancelRefusal(parcel({ status: 'pending', trackingNumber: null }), NO_CANCEL)).toBeNull();
    expect(cancelRefusal(parcel({ provider: 'manual', trackingNumber: null }), NO_CANCEL)).toBeNull();
    expect(menu(parcel({ provider: 'yalidine' })).get('cancel')).toEqual({ key: 'cancel', enabled: true });
  });
  it.each(['picked_up', 'in_transit', 'out_for_delivery', 'stale'] as const)('%s ⇒ COURIER_CANCEL_NOT_ALLOWED (already picked up: « Retournée »)', (status) => {
    expect(cancelRefusal(parcel({ status }), CANCEL)).toBe('COURIER_CANCEL_NOT_ALLOWED');
  });
  it('a failed attempt after pickup is past pickup too; a failed SEND (never created) has nothing to cancel', () => {
    expect(cancelRefusal(parcel({ status: 'failed' }), CANCEL)).toBe('COURIER_CANCEL_NOT_ALLOWED');
    expect(isNotOfferedRefusal(cancelRefusal(parcel({ status: 'failed', trackingNumber: null }), CANCEL))).toBe(true);
  });
  it.each(['delivered', 'returned', 'cancelled'] as const)('%s ⇒ not offered', (status) => {
    expect(isNotOfferedRefusal(cancelRefusal(parcel({ status }), CANCEL))).toBe(true);
    expect(menu(parcel({ status }), { status: 'shipped' }).has('cancel')).toBe(false);
  });
});

describe('change courier', () => {
  it('failed send, queued parcel, manual parcel ⇒ allowed', () => {
    expect(changeCourierRefusal(parcel({ status: 'failed', trackingNumber: null }), NO_CANCEL)).toBeNull();
    expect(changeCourierRefusal(parcel({ status: 'pending', trackingNumber: null }), NO_CANCEL)).toBeNull();
    expect(changeCourierRefusal(parcel({ provider: 'manual' }), NO_CANCEL)).toBeNull();
  });
  it('created at a courier ⇒ cancel it first (SHIPMENT_CANCEL_FIRST), or at the courier when its API cannot (COURIER_CANCEL_UNSUPPORTED)', () => {
    expect(changeCourierRefusal(parcel({ provider: 'yalidine' }), CANCEL)).toBe('SHIPMENT_CANCEL_FIRST');
    expect(changeCourierRefusal(parcel(), NO_CANCEL)).toBe('COURIER_CANCEL_UNSUPPORTED');
    expect(menu(parcel({ provider: 'yalidine' })).get('change_courier')).toMatchObject({ enabled: false, reasonCode: 'SHIPMENT_CANCEL_FIRST' });
  });
  it('after pickup ⇒ COURIER_CANCEL_NOT_ALLOWED; delivered / returned / cancelled ⇒ not offered', () => {
    expect(changeCourierRefusal(parcel({ status: 'in_transit' }), CANCEL)).toBe('COURIER_CANCEL_NOT_ALLOWED');
    expect(menu(parcel({ status: 'cancelled' }), { status: 'confirmed' }).has('change_courier')).toBe(false);
  });
});

describe('retry delivery', () => {
  it('a failed attempt at a courier without API re-attempt ⇒ COURIER_RETRY_UNSUPPORTED (not a « cancel » reason)', () => {
    expect(retryDeliveryRefusal(parcel({ status: 'failed' }), NO_CANCEL)).toBe('COURIER_RETRY_UNSUPPORTED');
    expect(menu(parcel({ status: 'failed', deliveryAttempts: 1 })).get('retry_delivery')).toEqual({ key: 'retry_delivery', enabled: false, reasonCode: 'COURIER_RETRY_UNSUPPORTED' });
  });
  it('with support ⇒ allowed (primary below 3 attempts); not failed ⇒ not offered', () => {
    expect(retryDeliveryRefusal(parcel({ provider: 'ecotrack', status: 'failed' }), RETRY)).toBeNull();
    expect(menu(parcel({ provider: 'ecotrack', status: 'failed', deliveryAttempts: 1 })).get('retry_delivery')).toEqual({ key: 'retry_delivery', enabled: true, primary: true });
    expect(isNotOfferedRefusal(retryDeliveryRefusal(parcel(), RETRY))).toBe(true);
  });
});

describe('« Actualiser » and « Bordereau »', () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  it('during the 5-minute wait ⇒ TRACKING_SYNC_RATE_LIMITED with the seconds left (same descriptor on the list rows)', () => {
    expect(menu(parcel(), undefined, { syncAvailableAt: '2026-11-14T10:04:00Z', now }).get('sync')).toEqual({ key: 'sync', enabled: false, reasonCode: 'TRACKING_SYNC_RATE_LIMITED', reasonParams: { retryAfter: 240 } });
    expect(menu(parcel(), undefined, { syncAvailableAt: '2026-11-14T09:59:00Z', now }).get('sync')).toEqual({ key: 'sync', enabled: true });
  });
  it('a manual parcel or a finished one has nothing to refresh ⇒ not offered (was « Suivi introuvable » / « Commande clôturée »)', () => {
    expect(menu(parcel({ provider: 'manual' })).has('sync')).toBe(false);
    for (const status of ['delivered', 'returned', 'cancelled'] as const) expect(menu(parcel({ status }), { status: 'delivered' }).has('sync')).toBe(false);
  });
  it('a parcel not created yet ⇒ SHIPMENT_NOT_CREATED; a cancelled parcel has no slip to print ⇒ not offered', () => {
    expect(menu(parcel({ status: 'pending', trackingNumber: null })).get('sync')).toMatchObject({ enabled: false, reasonCode: 'SHIPMENT_NOT_CREATED' });
    expect(menu(parcel({ status: 'pending', trackingNumber: null })).get('label')).toMatchObject({ enabled: false, reasonCode: 'SHIPMENT_NOT_CREATED' });
    expect(menu(parcel({ status: 'cancelled' }), { status: 'confirmed' }).has('label')).toBe(false);
  });
  it('a manual parcel sent without tracking prints Djaber’s slip (as label.service does)', () => {
    expect(menu(parcel({ provider: 'manual', trackingNumber: null })).get('label')).toEqual({ key: 'label', enabled: true });
  });
});
