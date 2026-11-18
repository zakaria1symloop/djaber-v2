// Journeys 18/11 J10r / J11r: URL filters the API refuses (J10r-2), one role refusal sentence (J10r-3), the date-range
// arrow of the Arabic pages (J11r-6 b).
import { describe, expect, it } from 'vitest';
import { rangeLabel } from '@/features/analytics/format';
import { forbiddenReason, reasonText, setMerchantViewerRole } from './actions';
import { makeT, rangeArrow } from './format-message';
import { parseListState, rejectedUrlFilters, type ListSpec } from './list-state';

const SPEC: ListSpec = { filters: { action: 'list', from: 'date', to: 'date', bucket: 'text' }, sorts: ['createdAt', 'amount'], defaultSort: '-createdAt' };
const params = (qs: string) => new URLSearchParams(qs);

describe('J10r-2: a URL filter the API refuses is dropped', () => {
  it('names the URL filters of the failed request only', () => {
    const s = parseListState(SPEC, params('action=pack&bucket=plan&sort=amount'));
    const key = JSON.stringify(['ws', 'credits', 'ledger', { page: 1, action: ['pack'], bucket: 'plan', sort: 'amount' }]);
    expect(rejectedUrlFilters(SPEC, s, ['action.0'], key)).toEqual(['action']);
    expect(rejectedUrlFilters(SPEC, s, ['action', 'bucket'], key)).toEqual(['action', 'bucket']);
    expect(rejectedUrlFilters(SPEC, s, ['sort'], key)).toEqual(['sort']);
  });
  it('never drops a filter for another request or another field', () => {
    const s = parseListState(SPEC, params('action=pack'));
    expect(rejectedUrlFilters(SPEC, s, ['action'], JSON.stringify(['ws', 'agents', { page: 1 }]))).toEqual([]);
    expect(rejectedUrlFilters(SPEC, s, ['email'], JSON.stringify(['ws', 'credits', { action: ['pack'] }]))).toEqual([]);
    // a filter absent from the URL is not « refused from the URL »
    expect(rejectedUrlFilters(SPEC, s, ['bucket'], JSON.stringify(['ws', 'credits', { bucket: 'x' }]))).toEqual([]);
    // the default sort is never « dropped »
    expect(rejectedUrlFilters(SPEC, parseListState(SPEC, params('')), ['sort'], JSON.stringify([{ sort: '-createdAt' }]))).toEqual([]);
  });
});

describe('J10r-3: one refusal sentence that says who can', () => {
  const t = makeT('fr', {
    'error.FORBIDDEN': "Vous n'avez pas la permission.",
    'actions.reason.ownerAndAdmins': 'Réservé au propriétaire et aux admins de l’espace.',
    'actions.reason.ownerOnly': 'Réservé au propriétaire de l’espace.',
  });
  it('from the reader role; the generic text outside the merchant shell', () => {
    setMerchantViewerRole('operator');
    expect(forbiddenReason(t)).toBe('Réservé au propriétaire et aux admins de l’espace.');
    expect(reasonText(t, 'FORBIDDEN')).toBe('Réservé au propriétaire et aux admins de l’espace.');
    expect(reasonText(t, undefined)).toBe('Réservé au propriétaire et aux admins de l’espace.');
    setMerchantViewerRole('admin');
    expect(reasonText(t, 'FORBIDDEN')).toBe('Réservé au propriétaire de l’espace.');
    setMerchantViewerRole(null);
    expect(reasonText(t, 'FORBIDDEN')).toBe("Vous n'avez pas la permission.");
  });
});

describe('J11r-6 (b): the range arrow points the way the page reads', () => {
  it('« ← » in Arabic, « → » in French and English', () => {
    expect(rangeArrow('ar')).toBe('←');
    expect(rangeArrow('fr')).toBe('→');
    expect(rangeLabel('2026-01-01', '2026-11-18', 'ar', { currentYear: '2026' })).toContain(' ← ');
    expect(rangeLabel('2026-01-01', '2026-11-18', 'en', { currentYear: '2026' })).toContain(' → ');
  });
});
