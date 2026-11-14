import { describe, expect, it } from 'vitest';
import { parseListState } from '@/lib/list-state';
import { bulkRowState, courierErrorField, credentialErrors, daysLabel, daysSince, deliveryBlockState,isHttpsUrl, parcelSteps, parseWeight, shipmentTone, syncUntil, syncWait, waitLabel, withSyncWait } from './logic';
import { currentTab, DELIVERY_LIST, deliveryChips, panelFilterCount, shipmentsQuery, TAB_PRESETS } from './overview-spec';

const params = (q: string) => new URLSearchParams(q);

describe('UX-064 — LIVRAISON block of the order page', () => {
  const failedSend = { status: 'failed' as const, trackingNumber: null };
  it('confirmed order with a failed send: open failure, « Corriger et renvoyer » offered', () => {
    expect(deliveryBlockState('confirmed', { ...failedSend, failureHandled: null })).toEqual({ handled: null, openFailure: true, fixable: true, showSend: true });
  });
  it('order delivered by hand after the failed send (#CMD-1008): failure handled, no send / self-delivery buttons', () => {
    expect(deliveryBlockState('delivered', { ...failedSend, failureHandled: 'delivered' })).toEqual({ handled: 'delivered', openFailure: false, fixable: false, showSend: false });
  });
  it('cancelled / returned order: handled the same way', () => {
    expect(deliveryBlockState('cancelled', { ...failedSend, failureHandled: 'cancelled' }).handled).toBe('cancelled');
    expect(deliveryBlockState('returned', { ...failedSend, failureHandled: 'returned' }).showSend).toBe(false);
  });
  it('no parcel: the send buttons follow the order — shown while open, never on a delivered / cancelled / returned order', () => {
    expect(deliveryBlockState('confirmed', null).showSend).toBe(true);
    expect(deliveryBlockState('new', null).showSend).toBe(true);
    expect(deliveryBlockState('delivered', null).showSend).toBe(false);
    expect(deliveryBlockState('cancelled', null).showSend).toBe(false);
  });
  it('a courier failure (parcel created) is never « fixable » by a resend; a sent parcel hides the send buttons', () => {
    expect(deliveryBlockState('shipped', { status: 'failed', trackingNumber: 'ZR-1', failureHandled: null })).toEqual({ handled: null, openFailure: true, fixable: false, showSend: false });
    expect(deliveryBlockState('shipped', { status: 'sent', trackingNumber: 'ZR-1', failureHandled: null }).showSend).toBe(false);
  });
});

describe('public parcel steps', () => {
  it('in transit: the first two are done, the third is current', () => {
    expect(parcelSteps('in_transit').map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
  });
  it('pending: nothing done yet', () => {
    expect(parcelSteps('pending').every((s) => s.state === 'upcoming')).toBe(true);
  });
  it('delivered: every step done', () => {
    expect(parcelSteps('delivered').every((s) => s.state === 'done')).toBe(true);
  });
  it('failed / returned / cancelled end the bar with a failed step', () => {
    for (const st of ['failed', 'returned', 'cancelled'] as const) {
      const steps = parcelSteps(st);
      expect(steps.at(-1)).toEqual({ key: st, state: 'failed' });
      expect(steps).toHaveLength(5);
    }
  });
  it('tones follow the status', () => {
    expect(shipmentTone('delivered')).toBe('success');
    expect(shipmentTone('failed')).toBe('danger');
    expect(shipmentTone('in_transit')).toBe('info');
    expect(shipmentTone(null)).toBeUndefined();
  });
});

describe('tracking sync (1 / 5 min)', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  it('seconds left until the next manual sync', () => {
    expect(syncWait(null, now)).toBe(0);
    expect(syncWait('2026-10-12T10:04:00Z', now)).toBe(240);
    expect(syncWait('2026-10-12T09:00:00Z', now)).toBe(0);
  });
  it('wait label', () => {
    expect(waitLabel(240)).toBe('4 min');
    expect(waitLabel(61)).toBe('2 min');
    expect(waitLabel(45)).toBe('45 s');
  });
  it('days since the last event', () => {
    expect(daysSince('2026-10-05T09:00:00Z', now)).toBe(7);
    expect(daysSince(null, now)).toBeNull();
  });
});

// UX-056 leftovers (UX/UI test log 12/11): the list « Actions » offered « Actualiser le suivi » during the 5-minute wait
describe('« Actualiser » in every parcel menu follows the live wait', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  const others = [{ key: 'label', enabled: true }, { key: 'cancel', enabled: false, reasonCode: 'COURIER_CANCEL_UNSUPPORTED' }];
  it('an enabled item is greyed with the seconds left while the wait lasts (a refresh done in this tab, a 429)', () => {
    expect(withSyncWait([{ key: 'sync', enabled: true, primary: true }, ...others], 54)).toEqual([{ key: 'sync', enabled: false, reasonCode: 'TRACKING_SYNC_RATE_LIMITED', reasonParams: { retryAfter: 54 } }, ...others]);
  });
  it('the countdown moves on; at 0 the item is offered again', () => {
    const limited = { key: 'sync', enabled: false, reasonCode: 'TRACKING_SYNC_RATE_LIMITED', reasonParams: { retryAfter: 240 } };
    expect(withSyncWait([limited], 12)[0]).toEqual({ ...limited, reasonParams: { retryAfter: 12 } });
    expect(withSyncWait([limited], 0)[0]).toEqual({ key: 'sync', enabled: true });
  });
  it('any other refusal of the server stays (permission, parcel not created)', () => {
    const forbidden = { key: 'sync', enabled: false, reasonCode: 'FORBIDDEN' };
    expect(withSyncWait([forbidden], 54)[0]).toBe(forbidden);
    expect(withSyncWait([forbidden], 0)[0]).toBe(forbidden);
  });
  it('end of the wait = the later of what the server said and what this tab learnt', () => {
    expect(syncUntil('2026-10-12T10:04:00Z', null)).toBe(Date.parse('2026-10-12T10:04:00Z'));
    expect(syncUntil(null, now + 60_000)).toBe(now + 60_000);
    expect(syncUntil('2026-10-12T10:04:00Z', now + 600_000)).toBe(now + 600_000);
    expect(syncUntil(null, null)).toBeNull();
    expect(syncUntil('nope', undefined)).toBeNull();
  });
});

describe('courier form', () => {
  const zr = [
    { name: 'token', secret: true },
    { name: 'key', secret: true },
  ];
  const eco = [
    { name: 'baseUrl', secret: false, url: true },
    { name: 'token', secret: true },
  ];
  it('every field is required on creation', () => {
    expect(credentialErrors(zr, {}, false)).toEqual({ token: 'validation.required', key: 'validation.required' });
    expect(credentialErrors(zr, { token: 'a', key: 'b' }, false)).toEqual({});
  });
  it('on edit, empty fields keep the stored credentials; a partial set is refused', () => {
    expect(credentialErrors(zr, {}, true)).toEqual({});
    expect(credentialErrors(zr, { token: 'new' }, true)).toEqual({ key: 'validation.required' });
  });
  it('EcoTrack instance must be an https URL', () => {
    expect(credentialErrors(eco, { baseUrl: 'http://x.ecotrack.dz', token: 't' }, false)).toEqual({ baseUrl: 'validation.url' });
    expect(credentialErrors(eco, { baseUrl: 'https://maystro.ecotrack.dz', token: 't' }, false)).toEqual({});
    expect(isHttpsUrl('nope')).toBe(false);
  });
});

describe('send dialog helpers', () => {
  it('maps courier / validation fields onto the dialog fields', () => {
    expect(courierErrorField('commune')).toBe('commune');
    expect(courierErrorField('communeId')).toBe('commune');
    expect(courierErrorField('stopdeskId')).toBe('stopdesk');
    expect(courierErrorField('weightKg')).toBe('weight');
    expect(courierErrorField('other')).toBeNull();
    expect(courierErrorField(undefined)).toBeNull();
  });
  it('weight accepts a comma or a dot', () => {
    expect(parseWeight('0,8')).toBe(0.8);
    expect(parseWeight('1.25')).toBe(1.25);
    expect(parseWeight('')).toBeUndefined();
    expect(Number.isNaN(parseWeight('abc') as number)).toBe(true);
  });
  it('average delay label', () => {
    expect(daysLabel(3.84, 'j', 'fr')).toBe('3,8 j');
    expect(daysLabel(4.9, 'd', 'en')).toBe('4.9 d');
    expect(daysLabel(null, 'j', 'fr')).toBeNull();
  });
  it('bulk send result rows', () => {
    expect(bulkRowState({ ok: true, data: { shipmentId: 's', status: 'sent', trackingNumber: 'ZR-1' } })).toBe('ok');
    expect(bulkRowState({ ok: true, data: { shipmentId: 's', status: 'pending', trackingNumber: null } })).toBe('queued');
    expect(bulkRowState({ ok: false, error: { code: 'DELIVERY_ORDER_ALREADY_SENT', message: '' } })).toBe('ignored');
    expect(bulkRowState({ ok: false, error: { code: 'COURIER_UNAVAILABLE', message: '' } })).toBe('queued');
    expect(bulkRowState({ ok: false, error: { code: 'COURIER_VALIDATION', message: '' } })).toBe('failed');
  });
});

describe('/delivery URL state', () => {
  it('no tab = Échecs; unknown tab = Échecs', () => {
    expect(currentTab(parseListState(DELIVERY_LIST, params('')))).toBe('failed');
    expect(currentTab(parseListState(DELIVERY_LIST, params('tab=to_send')))).toBe('to_send');
    expect(currentTab(parseListState(DELIVERY_LIST, params('tab=nope')))).toBe('failed');
  });
  it('the tab preset is merged into the panel filters (same keys of the shared DELIVERY_TABS)', () => {
    expect(shipmentsQuery({ q: 'amina', provider: ['zrexpress'] }, 'no_movement')).toEqual({ q: 'amina', provider: ['zrexpress'], lastEvent: 'gt5d_stale' });
    expect(shipmentsQuery({ shipmentStatus: ['delivered'] }, 'failed')).toEqual({ shipmentStatus: ['failed'] });
    expect(shipmentsQuery({ shipmentStatus: ['delivered'] }, 'all')).toEqual({ shipmentStatus: ['delivered'] });
    expect(TAB_PRESETS.to_send).toEqual({ shipmentStatus: ['not_sent'] });
  });
  it('drops malformed enum filters', () => {
    expect(shipmentsQuery({ deliveryType: 'boat', lastEvent: 'soon' }, 'all')).toEqual({});
  });
  it('chips: one per value, the tab is never a chip', () => {
    const s = parseListState(DELIVERY_LIST, params('tab=in_transit&q=0555&provider=zrexpress,ecotrack&failureReason=address&deliveryType=stopdesk&from=2026-10-01'));
    const chips = deliveryChips(s, {
      search: (q) => `« ${q} »`,
      status: {},
      provider: { zrexpress: 'ZR', ecotrack: 'ECO' },
      courier: () => '',
      deliveryType: { home: 'Domicile', stopdesk: 'Stop-desk' },
      wilaya: (n) => n,
      wilayaName: (id) => id,
      orderStatus: {},
      lastEvent: {},
      failureReason: { address: 'ADRESSE' },
      lastError: (c) => c,
      range: (f, t) => `${f}→${t}`,
      ids: (n) => `${n}`,
    });
    expect(chips.map((c) => c.label)).toEqual(['« 0555 »', 'ZR', 'ECO', 'Stop-desk', 'ADRESSE', '2026-10-01→']);
    expect(panelFilterCount(s)).toBe(5);
  });
});
