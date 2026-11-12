// UX-060 (retest 12/11): reasons of greyed actions and buttons are finished sentences — every value filled (statuses in
// words, waits, dates), a refused transition is not offered, and no reason or tooltip can ever show a raw `{…}`.
import { describe, expect, it } from 'vitest';
import { actionState, reasonText, toMenuActions } from './actions';
import type { ActionDescriptor } from '@djaber/shared';
import { makeT, stripPlaceholders } from './format-message';

const FR = {
  'error.ORDER_INVALID_TRANSITION': 'Passage {from} → {to} impossible.',
  'error.TRACKING_SYNC_RATE_LIMITED': 'Actualisation possible dans {retryAfter} (1 / 5 min).',
  'error.PLAN_LIMIT': 'Limite du plan atteinte ({current}/{limit} {resource}).',
  'error.CASH_DAY_CLOSED': 'Journée du {date} clôturée.',
  'error.ORDER_NOTHING_TO_REFUND': 'Aucun paiement à rembourser.',
  'error.ORDER_PAYMENT_LOCKED': 'Paiement verrouillé (commande clôturée).',
  'error.PRODUCT_HAS_ORDERS': '{count, plural, one {Référencé par # commande} other {Référencé par # commandes}} : archivez-le.',
  'error.FORBIDDEN': 'Action non autorisée.',
  'actions.reason.unavailable': 'Action indisponible pour le moment.',
  'enum.Order.status.confirmed': 'CONFIRMÉE',
  'enum.Order.status.returned': 'RETOURNÉE',
  'enum.Shipment.status.sent': 'CRÉÉ',
};
const AR = {
  'error.ORDER_INVALID_TRANSITION': 'الانتقال {from} → {to} غير ممكن.',
  'error.TRACKING_SYNC_RATE_LIMITED': 'التحديث ممكن بعد {retryAfter} (مرة كل 5 د).',
  'enum.Order.status.confirmed': 'مؤكَّد',
  'enum.Order.status.returned': 'مُرتجَع',
};
const fr = makeT('fr', FR);
const ar = makeT('ar', AR);

describe('stripPlaceholders — the last guard (UX-060)', () => {
  it('drops every slot left unfilled and tidies the sentence', () => {
    expect(stripPlaceholders('Transition {from} → {to} not allowed.')).toBe('Transition not allowed.');
    expect(stripPlaceholders('Refresh possible in {retryAfter} (1 per 5 min).')).toBe('Refresh possible in (1 per 5 min).');
    expect(stripPlaceholders('Plan limit reached ({current}/{limit} {resource}).')).toBe('Plan limit reached.');
    expect(stripPlaceholders('{count, plural, one {# order} other {# orders}} linked')).toBe('linked');
    expect(stripPlaceholders('Already linked to « {agentName} ».')).toBe('Already linked to.');
  });
  it('leaves a sentence without slot untouched', () => {
    expect(stripPlaceholders('Payment locked (closed order).')).toBe('Payment locked (closed order).');
  });
});

describe('t() never renders a raw {…}', () => {
  it('a value the caller did not pass is dropped, the given ones are kept', () => {
    expect(fr('error.ORDER_INVALID_TRANSITION')).toBe('Passage impossible.');
    expect(fr('error.ORDER_INVALID_TRANSITION', { from: 'Nouvelle' })).toBe('Passage Nouvelle impossible.');
    expect(ar('error.TRACKING_SYNC_RATE_LIMITED')).not.toMatch(/[{}]/);
  });
  it('every catalogue sentence of this spec, formatted with no value at all, has no brace left', () => {
    for (const key of Object.keys(FR)) expect(fr(key)).not.toMatch(/[{}]/);
    for (const key of Object.keys(AR)) expect(ar(key)).not.toMatch(/[{}]/);
  });
});

describe('reasonText fills the values it is given', () => {
  it('statuses in words (sentence case), in the screen language', () => {
    expect(reasonText(fr, 'ORDER_INVALID_TRANSITION', { from: 'confirmed', to: 'returned' })).toBe('Passage Confirmée → Retournée impossible.');
    expect(reasonText(ar, 'ORDER_INVALID_TRANSITION', { from: 'confirmed', to: 'returned' })).toBe('الانتقال مؤكَّد → مُرتجَع غير ممكن.');
    expect(reasonText(fr, 'ORDER_INVALID_TRANSITION', { from: 'sent', to: 'sent' }, { statusEnum: 'enum.Shipment.status' })).toBe('Passage Créé → Créé impossible.');
  });
  it('a wait in seconds reads « 54 s » / « 4 min »; the screen value (live countdown) wins', () => {
    expect(reasonText(fr, 'TRACKING_SYNC_RATE_LIMITED', { retryAfter: 54 })).toBe('Actualisation possible dans 54 s (1 / 5 min).');
    expect(reasonText(fr, 'TRACKING_SYNC_RATE_LIMITED', { retryAfter: 240 })).toBe('Actualisation possible dans 4 min (1 / 5 min).');
    expect(reasonText(fr, 'TRACKING_SYNC_RATE_LIMITED', { retryAfter: 240 }, { params: { retryAfter: 12 } })).toBe('Actualisation possible dans 12 s (1 / 5 min).');
  });
  it('dates and plural counts', () => {
    expect(reasonText(fr, 'CASH_DAY_CLOSED', { date: '2026-11-11' })).toMatch(/^Journée du 11 nov\.? 2026 clôturée\.$/);
    expect(reasonText(fr, 'PRODUCT_HAS_ORDERS', { count: 3 })).toBe('Référencé par 3 commandes : archivez-le.');
  });
  it('a reason given no value is still a sentence (no `{…}`)', () => {
    for (const code of ['ORDER_INVALID_TRANSITION', 'TRACKING_SYNC_RATE_LIMITED', 'PLAN_LIMIT', 'CASH_DAY_CLOSED', 'PRODUCT_HAS_ORDERS']) expect(reasonText(fr, code)).not.toMatch(/[{}]/);
  });
  it('an unknown code is never shown; no code ⇒ FORBIDDEN', () => {
    expect(reasonText(fr, 'SOME_NEW_CODE')).toBe('Action indisponible pour le moment.');
    expect(reasonText(fr, undefined)).toBe('Action non autorisée.');
  });
});

describe('a transition the state machine refuses is not offered', () => {
  const noop = () => {};
  const descriptors: ActionDescriptor[] = [
    { key: 'confirm', enabled: false, reasonCode: 'ORDER_INVALID_TRANSITION', reasonParams: { from: 'confirmed', to: 'confirmed' } },
    { key: 'return', enabled: false, reasonCode: 'ORDER_INVALID_TRANSITION' },
    { key: 'refund', enabled: false, reasonCode: 'ORDER_NOTHING_TO_REFUND' },
    { key: 'sync', enabled: false, reasonCode: 'TRACKING_SYNC_RATE_LIMITED', reasonParams: { retryAfter: 54 } },
  ];
  it('menus leave it out; other greyed items keep a filled reason', () => {
    const menu = toMenuActions(descriptors, { confirm: { label: 'Confirmer', onSelect: noop }, return: { label: 'Retour', onSelect: noop }, refund: { label: 'Rembourser', onSelect: noop }, sync: { label: 'Actualiser', onSelect: noop } }, fr);
    expect(menu.map((a) => a.key)).toEqual(['refund', 'sync']);
    expect(menu.map((a) => a.disabledReason)).toEqual(['Aucun paiement à rembourser.', 'Actualisation possible dans 54 s (1 / 5 min).']);
  });
  it('buttons outside the menu: absent', () => {
    expect(actionState(descriptors, 'return', fr)).toEqual({ present: false, enabled: false });
    expect(actionState(descriptors, 'sync', fr, { params: { retryAfter: 9 } })).toEqual({ present: true, enabled: false, reason: 'Actualisation possible dans 9 s (1 / 5 min).' });
  });
});
