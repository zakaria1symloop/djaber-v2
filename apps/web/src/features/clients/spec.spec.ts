import { describe, expect, it } from 'vitest';
import { listApiQuery, parseListState, patchListState, serializeListState } from '@/lib/list-state';
import { activeChips, clientPill, clientsQuery, CLIENTS_LIST, firstName, orderChipsPatch, orderChipsValue, tagOptions, type ChipLabels } from './spec';

const params = (qs: string) => new URLSearchParams(qs);
const labels: ChipLabels = {
  search: (q) => `q:${q}`,
  source: { ai: 'IA', manual: 'MANUEL' },
  quality: { placeholder: 'incomplète' },
  tags: (n) => `tags:${n}`,
  risk: 'risque',
  channel: (n) => `canal:${n}`,
  channelName: (id) => `#${id}`,
  noConversation: 'sans conv',
  orders: (r) => `cmd ${r}`,
  neverOrdered: 'jamais',
  unconfirmed: 'à relancer',
  returned: 'retournés',
  spent: (r) => `dépensé ${r}`,
  lastOrder: { lt30: '< 30 j' },
  wilaya: (n) => `wilaya:${n}`,
  wilayaName: (id) => `W${id}`,
  created: (r) => `créé ${r}`,
  blocked: 'bloqué',
  date: (d) => d,
  money: (n) => `${n} DA`,
  number: (n) => String(n),
};

describe('clients list URL codec', () => {
  it('parses filters, defaults to last order desc and round-trips', () => {
    const s = parseListState(CLIENTS_LIST, params('source=ai,manual&minOrders=2&riskLevel=high&lastOrder=lt30&wilayaId=16,19&createdFrom=2026-10-01&sort=name&bogus=1'));
    expect(s.filters).toEqual({ source: ['ai', 'manual'], minOrders: 2, riskLevel: 'high', lastOrder: 'lt30', wilayaId: ['16', '19'], createdFrom: '2026-10-01' });
    expect(s.sort).toBe('name');
    expect(parseListState(CLIENTS_LIST, params('sort=phone')).sort).toBe('-lastOrderAt');
    expect(new URLSearchParams(serializeListState(CLIENTS_LIST, s)).toString()).toBe('source=ai%2Cmanual&riskLevel=high&minOrders=2&lastOrder=lt30&wilayaId=16%2C19&createdFrom=2026-10-01&sort=name');
  });
  it('sends phone fragments normalised and names as typed', () => {
    const phone = parseListState(CLIENTS_LIST, params('q=%2B213 555 12'));
    expect(clientsQuery(listApiQuery(phone)).q).toBe('055512');
    const name = parseListState(CLIENTS_LIST, params('q=Amina'));
    expect(clientsQuery(listApiQuery(name)).q).toBe('Amina');
  });
});

describe('active chips', () => {
  it('one chip per group, ranges merged', () => {
    const s = parseListState(CLIENTS_LIST, params('q=ami&source=ai&minSpent=1000&maxSpent=5000&neverOrdered=1&channelId=c1&tags=vip,fidèle&createdFrom=2026-10-01'));
    expect(activeChips(s, labels).map((c) => c.label)).toEqual(['q:ami', 'IA', 'tags:vip, fidèle', 'canal:#c1', 'jamais', 'dépensé 1000 DA – 5000 DA', 'créé 2026-10-01 → …']);
  });
});

describe('« À relancer » (PV 22/10)', () => {
  it('is a URL filter sent to the API and shown as a chip', () => {
    const st = parseListState(CLIENTS_LIST, params('unconfirmed=1'));
    expect(st.filters).toEqual({ unconfirmed: true });
    expect(clientsQuery(listApiQuery(st))).toMatchObject({ unconfirmed: true });
    expect(activeChips(st, labels).map((c) => c.label)).toContain('à relancer');
  });
});

describe('order chips of the panel', () => {
  it('≥ 2 commandes sets minOrders and excludes "jamais"', () => {
    const s = parseListState(CLIENTS_LIST, params('neverOrdered=1'));
    const prev = orderChipsValue(s);
    expect(prev).toEqual(['neverOrdered']);
    const patch = orderChipsPatch(['neverOrdered', 'atLeast2'], prev);
    expect(patch).toMatchObject({ neverOrdered: null, minOrders: 2, maxOrders: null });
    const next = patchListState(s, { filters: patch });
    expect(orderChipsValue(next)).toEqual(['atLeast2']);
  });
  it('toggling "retournés" keeps a typed order range', () => {
    const s = parseListState(CLIENTS_LIST, params('minOrders=5'));
    const patch = orderChipsPatch(['returned'], orderChipsValue(s));
    expect('minOrders' in patch).toBe(false);
    expect(patch.returned).toBe(true);
  });
});

describe('client pill', () => {
  const base = { blocked: false, riskLevel: 'normal' as const, isPlaceholder: false, orderCount: 0 };
  it('server pill wins, else blocked > risk > placeholder > reliable > unknown', () => {
    expect(clientPill({ ...base, pill: 'risk' })).toBe('risk');
    expect(clientPill({ ...base, blocked: true, riskLevel: 'high' })).toBe('blocked');
    expect(clientPill({ ...base, riskLevel: 'high', isPlaceholder: true })).toBe('risk');
    expect(clientPill({ ...base, isPlaceholder: true })).toBe('placeholder');
    expect(clientPill({ ...base, orderCount: 3, deliveredCount: 2, returnCount: 0 })).toBe('reliable');
    expect(clientPill({ ...base })).toBe('unknown');
    expect(clientPill({ ...base, orderCount: 2, deliveredCount: 1, returnCount: 1 })).toBeNull();
  });
});

describe('helpers', () => {
  it('first name of the CTA', () => {
    expect(firstName('Amina Belkacem')).toBe('Amina');
    expect(firstName('  Sara ')).toBe('Sara');
  });
  it('tag options: selected + seen, case-insensitive unique, sorted', () => {
    expect(tagOptions([{ tags: ['VIP', 'fidèle'] }, { tags: ['vip', 'Grossiste'] }], ['Nouveau'])).toEqual(['fidèle', 'Grossiste', 'Nouveau', 'VIP']);
  });
});
