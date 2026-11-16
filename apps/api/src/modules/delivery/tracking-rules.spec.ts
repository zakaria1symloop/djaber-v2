// DLV-04 / 04 §1.5 / §22 rules of the tracking sync (pure).
import { encodeShipmentError, isNoMovement, isReturnPending, parseShipmentError, courierFieldErrors } from './shipment.presenter';
import { attemptsAfter, CREATE_MAX_ATTEMPTS, CREATE_RETRY_DELAYS_MS, decideStatus, isStaleAt, nextSyncAt, orderDeliveryStatusAfter } from './tracking-rules';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('decideStatus — courier events never move a parcel backwards (05-integrations §2.6)', () => {
  it('forward along pending → sent → picked_up → in_transit → out_for_delivery → delivered', () => {
    expect(decideStatus('sent', 'picked_up')).toEqual({ change: true, reason: 'forward' });
    expect(decideStatus('sent', 'delivered')).toEqual({ change: true, reason: 'forward' });
    expect(decideStatus('in_transit', 'sent')).toEqual({ change: false, reason: 'backwards' });
    expect(decideStatus('out_for_delivery', 'picked_up')).toEqual({ change: false, reason: 'backwards' });
  });
  it('failed / returned / cancelled from any non-terminal state; a failed parcel may go out again (re-attempt)', () => {
    expect(decideStatus('in_transit', 'failed').change).toBe(true);
    expect(decideStatus('sent', 'returned').change).toBe(true);
    expect(decideStatus('picked_up', 'cancelled').change).toBe(true);
    expect(decideStatus('failed', 'out_for_delivery')).toEqual({ change: true, reason: 're_attempt' });
    expect(decideStatus('failed', 'delivered').change).toBe(true);
  });
  it('unknown / same / terminal: unchanged; delivered only gives way to returned (AT-DLV-06)', () => {
    expect(decideStatus('sent', null)).toEqual({ change: false, reason: 'unknown' });
    expect(decideStatus('sent', 'stale').change).toBe(false);
    expect(decideStatus('in_transit', 'in_transit')).toEqual({ change: false, reason: 'same' });
    expect(decideStatus('returned', 'delivered')).toEqual({ change: false, reason: 'terminal' });
    expect(decideStatus('cancelled', 'sent').change).toBe(false);
    expect(decideStatus('stale', 'delivered').change).toBe(false);
    expect(decideStatus('delivered', 'returned')).toEqual({ change: true, reason: 'return' });
    expect(decideStatus('delivered', 'failed').change).toBe(false);
  });
});

describe('attempts (04 §22 "attempt n/3")', () => {
  it('an attempt starts when the parcel goes out; a failure without "out for delivery" counts one', () => {
    expect(attemptsAfter('in_transit', 'out_for_delivery', 0)).toBe(1);
    expect(attemptsAfter('out_for_delivery', 'failed', 1)).toBe(1);
    expect(attemptsAfter('failed', 'out_for_delivery', 1)).toBe(2);
    expect(attemptsAfter('in_transit', 'failed', 0)).toBe(1);
    expect(attemptsAfter('out_for_delivery', 'delivered', 2)).toBe(2);
  });
  it('journey J08-6: a delivery without « out for delivery » is an attempt (delivered after a failure = 2nd attempt)', () => {
    expect(attemptsAfter('sent', 'delivered', 0)).toBe(1);
    expect(attemptsAfter('failed', 'delivered', 1)).toBe(2);
    expect(attemptsAfter('in_transit', 'delivered', 0)).toBe(1);
    expect(attemptsAfter('delivered', 'delivered', 1)).toBe(1);
  });
});

describe('cadence & stale (DLV-04)', () => {
  it('every 2 h during the first 3 days, then every 12 h; stale after 30 d without event', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(nextSyncAt(new Date(now.getTime() - 2 * DAY), now).getTime() - now.getTime()).toBe(2 * HOUR);
    expect(nextSyncAt(new Date(now.getTime() - 3 * DAY - 1), now).getTime() - now.getTime()).toBe(12 * HOUR);
    expect(isStaleAt(new Date(now.getTime() - 31 * DAY), now)).toBe(true);
    expect(isStaleAt(new Date(now.getTime() - 29 * DAY), now)).toBe(false);
  });
  it('"Sans mouvement" = > 5 d without event while sent / picked up / in transit (04 §22)', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    const old = new Date(now - 6 * DAY);
    expect(isNoMovement({ status: 'in_transit', lastEventAt: old, createdAt: old }, now)).toBe(true);
    expect(isNoMovement({ status: 'out_for_delivery', lastEventAt: old, createdAt: old }, now)).toBe(false);
    expect(isNoMovement({ status: 'sent', lastEventAt: new Date(now - 4 * DAY), createdAt: old }, now)).toBe(false);
    expect(isNoMovement({ status: 'sent', lastEventAt: null, createdAt: old }, now)).toBe(true);
  });
  it('create-parcel retries: 60 s, 5 min, 30 min, 2 h, 2 h, 2 h (FL-08 F-3) — 7 attempts in all', () => {
    expect(CREATE_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000]);
    expect(CREATE_MAX_ATTEMPTS).toBe(7);
  });
});

describe('order deliveryStatus follows the parcel (04 §1.5)', () => {
  it('picked_up reads in_transit; never backwards; failed / returned always; cancelled / stale unchanged', () => {
    expect(orderDeliveryStatusAfter('sent', 'picked_up')).toBe('in_transit');
    expect(orderDeliveryStatusAfter('out_for_delivery', 'in_transit')).toBeNull();
    expect(orderDeliveryStatusAfter('out_for_delivery', 'failed')).toBe('failed');
    expect(orderDeliveryStatusAfter('failed', 'out_for_delivery')).toBe('out_for_delivery');
    expect(orderDeliveryStatusAfter('delivered', 'returned')).toBe('returned');
    expect(orderDeliveryStatusAfter('in_transit', 'cancelled')).toBeNull();
    expect(orderDeliveryStatusAfter('in_transit', 'stale')).toBeNull();
    expect(orderDeliveryStatusAfter('returned', 'delivered')).toBeNull();
  });
  it('return pending until the merchant confirms reception', () => {
    expect(isReturnPending({ status: 'returned' }, 'shipped')).toBe(true);
    expect(isReturnPending({ status: 'returned' }, 'returned')).toBe(false);
    expect(isReturnPending({ status: 'delivered' }, 'delivered')).toBe(false);
  });
});

describe('courier error encoding (AT-DLV-02)', () => {
  it('code|field|message round trip and dialog field mapping', () => {
    const raw = encodeShipmentError('COURIER_VALIDATION', 'commune', 'Commune | inconnue');
    expect(parseShipmentError(raw)).toEqual({ code: 'COURIER_VALIDATION', field: 'commune', message: 'Commune / inconnue' });
    expect(parseShipmentError(encodeShipmentError('COURIER_UNAVAILABLE'))).toEqual({ code: 'COURIER_UNAVAILABLE', field: null, message: null });
    expect(parseShipmentError(null)).toBeNull();
    expect(courierFieldErrors('commune')).toEqual({ communeId: 'validation.commune' });
    expect(courierFieldErrors('phone')).toEqual({ clientPhone: 'validation.phone' });
    expect(courierFieldErrors('other')).toBeNull();
  });
});
