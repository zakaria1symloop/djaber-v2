import { describe, expect, it } from 'vitest';
import { parseListState, serializeListState } from '@/lib/list-state';
import type { BulkResponse, OrderListItem } from './contracts';
import { activeChips, ORDERS_LIST, ordersQuery, periodOf, tabCountsQuery } from './list/spec';
import {
  draftChanged,
  orderAnchor,
  actorKind,
  addressMissing,
  algiersInstant,
  callbackPresets,
  confirmationPillParams,
  confirmChecks,
  courierShort,
  deliveryPill,
  effectiveDateError,
  historyReason,
  historyValue,
  isoToLocalInput,
  isReadOnly,
  itemsSummary,
  localInputToIso,
  mergeRetry,
  paymentError,
  shortName,
  sourceDetail,
  sourceSplit,
  unansweredCalls,
} from './logic';
import { statusTargets } from './use-order-actions';

const params = (qs: string) => new URLSearchParams(qs);

describe('orders list spec (URL state)', () => {
  it('the tab is the status filter (AT-ORD-15)', () => {
    const s = parseListState(ORDERS_LIST, params('tab=new&q=amina&source=ai'));
    expect(s.tab).toBe('new');
    expect(ordersQuery({ q: 'amina', source: ['ai'] }, s.tab)).toEqual({ q: 'amina', source: ['ai'], status: ['new'] });
    expect(ordersQuery({}, 'bogus')).toEqual({});
  });
  it('unknown tab and sort fall back to the defaults', () => {
    const s = parseListState(ORDERS_LIST, params('tab=lost&sort=-hack'));
    expect(s.tab).toBeNull();
    expect(s.sort).toBe('-orderedAt');
  });
  it('round-trips every filter kind in a stable order', () => {
    const s = parseListState(ORDERS_LIST, params('wilayaId=19,16&minTotal=1000&maxTotal=20000&neverCalled=1&isStopdesk=true&from=2026-10-01&to=2026-10-07&assigneeId=me'));
    expect(serializeListState(ORDERS_LIST, s)).toEqual([
      ['wilayaId', '19,16'],
      ['assigneeId', 'me'],
      ['neverCalled', '1'],
      ['isStopdesk', 'true'],
      ['minTotal', '1000'],
      ['maxTotal', '20000'],
      ['from', '2026-10-01'],
      ['to', '2026-10-07'],
    ].sort((a, b) => Object.keys(ORDERS_LIST.filters).indexOf(a[0]!) - Object.keys(ORDERS_LIST.filters).indexOf(b[0]!)));
  });
  it('a custom range replaces the preset and isStopdesk only travels as true / false', () => {
    expect(ordersQuery({ period: '7d', from: '2026-10-01' }, null)).toEqual({ from: '2026-10-01' });
    expect(ordersQuery({ isStopdesk: 'maybe' }, null)).toEqual({});
  });
  it('tab counts drop the status only', () => {
    expect(tabCountsQuery({ status: ['new'], source: ['ai'] })).toEqual({ source: ['ai'] });
  });
  it('period of the screen', () => {
    expect(periodOf(parseListState(ORDERS_LIST, params('period=7d')))).toBe('7d');
    expect(periodOf(parseListState(ORDERS_LIST, params('from=2026-10-01')))).toBe('custom');
    expect(periodOf(parseListState(ORDERS_LIST, params('')))).toBeNull();
  });
  it('one chip per active value, removable', () => {
    const s = parseListState(ORDERS_LIST, params('q=x&confirmationStatus=no_answer,callback&minCalls=2&hasRemaining=1&paymentMethod=cash&period=7d'));
    const dict = new Proxy({}, { get: (_t, k) => String(k).toUpperCase() }) as Record<string, string>;
    const chips = activeChips(s, {
      search: (q) => `«${q}»`, confirmation: dict, minCalls: (n) => `≥ ${n}`, neverCalled: 'NEVER', payment: dict, method: dict, hasRemaining: 'RESTE', delivery: dict, provider: dict, source: dict,
      channel: (n) => n, channelName: (id) => id, agent: (n) => n, agentName: (id) => id, assignee: (n) => n, assigneeName: (id) => id, wilaya: (n) => n, wilayaName: (id) => id,
      stopdesk: { true: 'SD', false: 'HOME' }, total: (r) => r, period: dict, range: (a, b) => `${a}→${b}`, product: 'P', client: 'C', risk: dict, callbackDue: 'CB', ids: (n) => `${n}`,
    });
    expect(chips.map((c) => c.label)).toEqual(['«x»', 'NO_ANSWER', 'CALLBACK', '≥ 2', 'CASH', 'RESTE', '7D']);
    expect(chips.find((c) => c.key === 'period')?.clear).toEqual({ period: null });
  });
});

describe('pills', () => {
  it('RAPPEL hh:mm today, with the day otherwise; SANS RÉPONSE n/3', () => {
    const now = new Date('2026-10-12T09:00:00Z');
    expect(confirmationPillParams({ confirmationStatus: 'callback', callAttempts: 1, callbackAt: '2026-10-12T15:00:00Z' }, now).params).toEqual({ time: '16:00' });
    expect(confirmationPillParams({ confirmationStatus: 'callback', callAttempts: 1, callbackAt: '2026-10-13T09:00:00Z' }, now).params).toEqual({ time: '13/10 10:00' });
    expect(confirmationPillParams({ confirmationStatus: 'no_answer', callAttempts: 2, callbackAt: null }, now)).toEqual({ key: 'enum.Order.confirmationStatus.no_answer', params: { attempts: 2 } });
    expect(confirmationPillParams({ confirmationStatus: 'wrong_number', callAttempts: 0, callbackAt: null }, now).key).toBe('enum.Order.confirmationStatus.wrong_number');
  });
  it('delivery pill: parcel status first (stale wins), courier suffix in transit, order delivery status otherwise', () => {
    expect(deliveryPill({ status: 'shipped', deliveryStatus: 'in_transit', shipment: { provider: 'zrexpress', trackingNumber: null, status: 'in_transit', stale: false } })).toMatchObject({ value: 'in_transit', provider: 'zrexpress', enumKey: 'Shipment.status' });
    expect(deliveryPill({ status: 'shipped', deliveryStatus: 'in_transit', shipment: { provider: 'zrexpress', trackingNumber: null, status: 'in_transit', stale: true } }).value).toBe('stale');
    expect(deliveryPill({ status: 'confirmed', deliveryStatus: 'pending', shipment: null })).toMatchObject({ labelKey: 'enum.Order.deliveryStatus.pending', provider: null });
    expect(courierShort('zrexpress')).toBe('ZR');
  });
  it('source detail per source (AT-ORD-23)', () => {
    const o = { member: shortName, platform: (p: string) => (p === 'facebook' ? 'FB' : 'IG'), date: () => '04 oct.' };
    expect(sourceDetail({ source: 'ai', agent: { id: 'a', name: 'Vendeur Pro', status: 'active' }, channel: { id: 'c', platform: 'facebook', name: 'B', avatarUrl: null, status: 'active' } } as never, o)).toBe('Vendeur Pro · FB');
    expect(sourceDetail({ source: 'manual', user: { id: 'u', firstName: 'Nadia', lastName: 'Ferhat', avatarUrl: null } }, o)).toBe('Nadia F.');
    expect(sourceDetail({ source: 'api', apiKeyName: 'ERP interne' }, o)).toBe('ERP interne');
    expect(sourceDetail({ source: 'import', importFileName: 'CSV', importedAt: '2026-10-04T10:00:00Z' }, o)).toBe('CSV · 04 oct.');
  });
  it('items summary', () => {
    expect(itemsSummary([{ name: 'Parfum Oud', variant: null, qty: 2 }], 3)).toEqual({ first: 'Parfum Oud ×2', more: 2 });
    expect(itemsSummary([], 0)).toEqual({ first: '', more: 0 });
  });
});

describe('order page rules', () => {
  const base = { address: { wilayaId: 19, wilayaName: 'Sétif', communeId: 1, communeText: 'El Eulma', address: 'Cité 500 logements', isStopdesk: false, stopdeskId: null }, clientPhone: '0555123456' };
  it('address required to confirm (AT-ORD-04 / AT-ORD-17)', () => {
    expect(addressMissing(base)).toBe(false);
    expect(addressMissing({ address: null })).toBe(true);
    expect(addressMissing({ address: { ...base.address, address: 'court' } })).toBe(true);
    expect(addressMissing({ address: { ...base.address, address: null, isStopdesk: true } })).toBe(false);
    expect(addressMissing({ address: { ...base.address, communeId: null, communeText: null } })).toBe(true);
    expect(confirmChecks(base)).toEqual({ address: true, wilaya: true, phone: true });
  });
  it('read-only statuses (AT-ORD-19)', () => {
    expect(isReadOnly('delivered')).toBe(true);
    expect(isReadOnly('returned')).toBe(true);
    expect(isReadOnly('confirmed')).toBe(false);
  });
  it('status targets follow 04 §1.2 without cancel (own dialog)', () => {
    expect(statusTargets('new')).toEqual(['confirmed', 'preparing', 'shipped', 'delivered']);
    expect(statusTargets('shipped')).toEqual(['confirmed', 'delivered', 'returned']);
    expect(statusTargets('delivered')).toEqual(['returned']);
    expect(statusTargets('cancelled')).toEqual([]);
  });
  it('unanswered calls count no_answer / busy / voicemail', () => {
    const c = (result: string) => ({ result }) as never;
    expect(unansweredCalls({ calls: [c('no_answer'), c('busy'), c('picked_up'), c('voicemail')] })).toBe(3);
  });
  it('history values read through the enum catalogue', () => {
    const has = (k: string) => k === 'enum.Order.status.confirmed' || k === 'enum.Shipment.status.in_transit';
    expect(historyValue('status', 'confirmed', has)).toEqual({ key: 'enum.Order.status.confirmed', raw: null });
    expect(historyValue('deliveryStatus', 'in_transit', has)).toEqual({ key: 'enum.Shipment.status.in_transit', raw: null });
    expect(historyValue('clientName', 'Amina', has)).toEqual({ key: null, raw: 'Amina' });
    expect(historyValue('status', null, has)).toEqual({ key: null, raw: null });
    expect(actorKind({ actor: { type: 'ai', name: 'x' } } as never)).toBe('ai');
    expect(actorKind({ actor: { type: 'system', name: 'x' } } as never)).toBe('system');
    expect(actorKind({ actor: { type: 'user', name: 'x' } } as never)).toBe('user');
  });
  it('UX-059: history reasons in words, never a code', () => {
    const L: Record<string, string> = { 'enum.Order.cancelReason.changed_mind': 'Le client a changé d’avis', 'delivery.lastError.COURIER_VALIDATION': 'Refusée par le transporteur (données)', 'orders.history.reason.parcel_cancelled': 'colis annulé' };
    const t = Object.assign((k: string) => L[k] ?? k, { has: (k: string) => k in L });
    expect(historyReason('changed_mind', t)).toBe('Le client a changé d’avis');
    expect(historyReason('changed_mind · rappelle demain', t)).toBe('Le client a changé d’avis · rappelle demain');
    expect(historyReason('COURIER_VALIDATION', t)).toBe('Refusée par le transporteur (données)');
    expect(historyReason('parcel_cancelled', t)).toBe('colis annulé');
    expect(historyReason('SOME_CODE', t)).toBe('');
    expect(historyReason('some_unknown_code', t)).toBe('');
    expect(historyReason('ZR Express', t)).toBe('ZR Express');
    expect(historyReason(null, t)).toBe('');
  });
  it('payment amount: integer > 0 and ≤ remaining (AT-ORD-22)', () => {
    expect(paymentError(null, 1000)).toBe('validation.required');
    expect(paymentError(0, 1000)).toBe('validation.price');
    expect(paymentError(1200, 1000)).toBe('orders.payment.overRemaining');
    expect(paymentError(300, 1000)).toBeNull();
  });
  it('effective date: not in the future, ≤ 7 days back (AT-ORD-26)', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(effectiveDateError(null, now)).toBeNull();
    expect(effectiveDateError('2026-10-09T10:00:00Z', now)).toBeNull();
    expect(effectiveDateError('2026-10-01T10:00:00Z', now)).toBe('validation.date');
    expect(effectiveDateError('2026-10-13T10:00:00Z', now)).toBe('validation.date');
  });
});

describe('time (Africa/Algiers, AT-DAT-01)', () => {
  it('callback presets: in 1 h, 16:00 while far enough, tomorrow 10:00', () => {
    const morning = callbackPresets(new Date('2026-10-12T08:00:00Z'));
    expect(morning.map((p) => p.key)).toEqual(['in1h', 'today16', 'tomorrow10']);
    expect(morning[1]!.at.toISOString()).toBe('2026-10-12T15:00:00.000Z');
    expect(morning[2]!.at.toISOString()).toBe('2026-10-13T09:00:00.000Z');
    expect(callbackPresets(new Date('2026-10-12T14:45:00Z')).map((p) => p.key)).toEqual(['in1h', 'tomorrow10']);
  });
  it('datetime-local values are Algiers wall-clock time', () => {
    expect(localInputToIso('2026-10-12T16:00')).toBe('2026-10-12T15:00:00.000Z');
    expect(isoToLocalInput('2026-10-12T15:00:00Z')).toBe('2026-10-12T16:00');
    expect(localInputToIso('')).toBeNull();
    expect(algiersInstant('2026-12-31', '23:30').toISOString()).toBe('2026-12-31T22:30:00.000Z');
  });
});

describe('KPIs and bulk', () => {
  it('source split rounds the AI share', () => {
    expect(sourceSplit({ sourceMix: { ai: 142, manual: 40, mobile: 2, api: 1, import: 1 } })).toEqual({ aiPct: 76, manualPct: 24 });
    expect(sourceSplit({ sourceMix: { ai: 0, manual: 0, mobile: 0, api: 0, import: 0 } })).toEqual({ aiPct: 0, manualPct: 0 });
  });
  it('a retry keeps the rows that were OK (AT-ORD-12 / AT-ORD-30)', () => {
    const first: BulkResponse = { results: [{ id: 'a', ok: true }, { id: 'b', ok: false, error: { code: 'ORDER_ADDRESS_REQUIRED', message: '' } }, { id: 'c', ok: false, error: { code: 'X', message: '' } }], ok: 1, failed: 2 };
    const retry: BulkResponse = { results: [{ id: 'b', ok: true }, { id: 'c', ok: false, error: { code: 'X', message: '' } }], ok: 1, failed: 1 };
    expect(mergeRetry(first, retry)).toMatchObject({ ok: 2, failed: 1 });
  });
  it('row shape stays assignable to the shared list item', () => {
    const r: Pick<OrderListItem, 'confirmationStatus'> = { confirmationStatus: 'callback' };
    expect(r.confirmationStatus).toBe('callback');
  });
});

describe('order page: inline edits and anchors', () => {
  it('draftChanged: opening an edit is not a change, a typed difference is', () => {
    const base = { clientName: 'Amina', clientPhone: '0550123456', clientPhone2: '' };
    expect(draftChanged(null, base)).toBe(false);
    expect(draftChanged({ ...base }, base)).toBe(false);
    expect(draftChanged({ ...base, clientName: 'Amina B.' }, base)).toBe(true);
    expect(draftChanged([{ id: 'i1', quantity: 1 }], [{ id: 'i1', quantity: 1 }])).toBe(false);
    expect(draftChanged([{ id: 'i1', quantity: 2 }], [{ id: 'i1', quantity: 1 }])).toBe(true);
    // no order loaded: an open draft counts
    expect(draftChanged(base, null)).toBe(true);
  });
  it('orderAnchor accepts the blocks linked by notifications and the Home queue only', () => {
    expect(orderAnchor('#delivery')).toBe('delivery');
    expect(orderAnchor('#payment')).toBe('payment');
    expect(orderAnchor('calls')).toBe('calls');
    expect(orderAnchor('#items')).toBeNull();
    expect(orderAnchor('')).toBeNull();
  });
});
