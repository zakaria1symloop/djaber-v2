// M2 pure logic: list state ↔ URL codec, server actions → menu items, DZD parsing, variant matrix, products list spec.
import { describe, expect, it } from 'vitest';
import { adjustedStock } from '@/features/catalog/adjust-stock-dialog';
import { productMenuActions } from '@/features/catalog/product-actions';
import { activeChips, algiersDay, matchPreset, presetRange, productsQuery, PRODUCTS_LIST, tabQuery, type ChipLabels } from '@/features/catalog/products-list/spec';
import { comboCount, exceedsVariantLimit, formatAttributeLine, normalizeAttributes, parseAttributeLine, splitExisting, totalVariantStock, variantMatrix } from '@/features/catalog/variants';
import { actionState, offlineMenu, reasonText, toMenuActions } from './actions';
import type { TFunction } from './i18n';
import {
  clearListFilters,
  countActiveFilters,
  filterBool,
  filterList,
  filterText,
  filtersApiQuery,
  formatSort,
  hasActiveFilters,
  listApiQuery,
  listQueryString,
  parseListState,
  parseSort,
  patchListState,
  serializeListState,
  type ListSpec,
} from './list-state';
import { compactAmount, digitsToInt, marginPct, moneyDigits, parseMoney } from './money';

const SPEC: ListSpec = {
  filters: { categoryIds: 'list', status: 'list', lowStock: 'bool', minPrice: 'int', maxPrice: 'int', createdFrom: 'date', createdTo: 'date', productId: 'text' },
  sorts: ['name', 'price', 'updatedAt'],
  defaultSort: 'name',
  tabs: ['active', 'pending'],
  layouts: ['grid'],
};
const parse = (qs: string) => parseListState(SPEC, new URLSearchParams(qs));

describe('list state ↔ URL', () => {
  it('reads defaults from an empty query string', () => {
    expect(parse('')).toEqual({ q: '', filters: {}, sort: 'name', page: 1, pageSize: 25, density: null, tab: null, sheet: null, layout: null, hide: [] });
  });

  it('reads every kind of filter and ignores unknown or malformed values', () => {
    const s = parse('q=robe&categoryIds=a,b,,a&status=active&lowStock=1&minPrice=1000&maxPrice=abc&createdFrom=2026-10-01&createdTo=01/10/2026&sort=-price&page=3&pageSize=50&density=compact&tab=pending&sheet=p1&layout=grid&hide=cost,margin&foo=bar');
    expect(s.q).toBe('robe');
    expect(s.filters).toEqual({ categoryIds: ['a', 'b'], status: ['active'], lowStock: true, minPrice: 1000, createdFrom: '2026-10-01' });
    expect(s).toMatchObject({ sort: '-price', page: 3, pageSize: 50, density: 'compact', tab: 'pending', sheet: 'p1', layout: 'grid', hide: ['cost', 'margin'] });
  });

  it('falls back on a sort outside the whitelist, a bad page size, an unknown tab', () => {
    const s = parse('sort=-secret&pageSize=20&page=0&tab=nope&density=huge&layout=cards&lowStock=0');
    expect(s).toMatchObject({ sort: 'name', pageSize: 25, page: 1, tab: null, density: null, layout: null });
    expect(s.filters).toEqual({});
  });

  it('writes a clean URL: defaults omitted, stable order, round trip', () => {
    const qs = 'tab=pending&q=robe&categoryIds=a%2Cb&lowStock=1&minPrice=1000&sort=-price&page=3&pageSize=50&density=compact&layout=grid&hide=cost&sheet=p1';
    const s = parse(qs);
    expect(new URLSearchParams(serializeListState(SPEC, s)).toString()).toBe(qs);
    expect(serializeListState(SPEC, parse(''))).toEqual([]);
    expect(parse(listQueryString(SPEC, s))).toEqual(s);
  });

  it('keeps the parameters of the page that are not list state', () => {
    const s = patchListState(parse('q=x'), { q: 'robe' });
    expect(listQueryString(SPEC, s, new URLSearchParams('appeal=1&q=x').entries())).toBe('appeal=1&q=robe');
  });

  it('goes back to page 1 on a filter, search, sort, tab or page-size change — not on sheet, density or columns', () => {
    const s = parse('page=4');
    expect(patchListState(s, { filters: { lowStock: true } }).page).toBe(1);
    expect(patchListState(s, { q: 'a' }).page).toBe(1);
    expect(patchListState(s, { sort: '-price' }).page).toBe(1);
    expect(patchListState(s, { tab: 'active' }).page).toBe(1);
    expect(patchListState(s, { pageSize: 100 }).page).toBe(1);
    expect(patchListState(s, { sheet: 'p1' }).page).toBe(4);
    expect(patchListState(s, { density: 'compact' }).page).toBe(4);
    expect(patchListState(s, { hide: ['cost'] }).page).toBe(4);
    expect(patchListState(s, { page: 2, pageSize: 50 }).page).toBe(2);
  });

  it('removes a filter set to an empty value', () => {
    const s = parse('categoryIds=a&lowStock=1&minPrice=5');
    expect(patchListState(s, { filters: { categoryIds: [], lowStock: false, minPrice: null } }).filters).toEqual({});
    expect(patchListState(s, { filters: { minPrice: 0 } }).filters.minPrice).toBe(0);
  });

  it('clears filters, search and tab but keeps the view settings', () => {
    const s = clearListFilters(parse('q=a&tab=active&lowStock=1&sort=-price&density=compact&pageSize=50&page=3'));
    expect(s).toMatchObject({ q: '', filters: {}, tab: null, page: 1, sort: '-price', density: 'compact', pageSize: 50 });
  });

  it('builds the API query: search needs 2 characters, lists stay arrays', () => {
    expect(listApiQuery(parse('q=r&categoryIds=a,b&page=2'))).toEqual({ categoryIds: ['a', 'b'], sort: 'name', page: 2, pageSize: 25 });
    expect(listApiQuery(parse('q=ro'), { type: ['service'] })).toEqual({ type: ['service'], q: 'ro', sort: 'name', page: 1, pageSize: 25 });
    expect(filtersApiQuery(parse('q=robe&lowStock=1&sort=-price&page=3'))).toEqual({ q: 'robe', lowStock: true });
  });

  it('counts filter groups: a min/max or from/to pair is one filter, the search is none', () => {
    expect(countActiveFilters(parse('q=robe'))).toBe(0);
    expect(countActiveFilters(parse('minPrice=1&maxPrice=9&createdFrom=2026-10-01&createdTo=2026-10-05&categoryIds=a,b&lowStock=1'))).toBe(4);
    expect(hasActiveFilters(parse('q=robe'))).toBe(true);
    expect(hasActiveFilters(parse('tab=active'))).toBe(true);
    expect(hasActiveFilters(parse('sort=-price&page=2'))).toBe(false);
  });

  it('typed readers and sort helpers', () => {
    const s = parse('categoryIds=a&minPrice=10&lowStock=1&productId=p9');
    expect(filterList(s, 'categoryIds')).toEqual(['a']);
    expect(filterList(s, 'status')).toEqual([]);
    expect(filterText(s, 'minPrice')).toBe('10');
    expect(filterText(s, 'productId')).toBe('p9');
    expect(filterBool(s, 'lowStock')).toBe(true);
    expect(parseSort('-price')).toEqual({ key: 'price', dir: 'desc' });
    expect(formatSort({ key: 'name', dir: 'asc' })).toBe('name');
    expect(formatSort(parseSort('-updatedAt'))).toBe('-updatedAt');
  });
});

const MESSAGES: Record<string, string> = {
  'error.FORBIDDEN': 'Action non autorisée.',
  'error.PRODUCT_NOT_STOCK_TRACKED': "Ce produit n'a pas de stock (service).",
  'error.PRODUCT_HAS_ORDERS': 'Référencé par {count} commandes/ventes : archivez-le.',
};
const t = Object.assign((key: string, params?: Record<string, unknown>) => (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '')), { has: (key: string) => key in MESSAGES }) as unknown as TFunction;

describe('server actions → menu', () => {
  const noop = () => {};
  const descriptors = [
    { key: 'edit', enabled: true },
    { key: 'open', enabled: true, primary: true, shortcut: 'Enter' },
    { key: 'adjust_stock', enabled: false, reasonCode: 'PRODUCT_NOT_STOCK_TRACKED' },
    { key: 'delete', enabled: false, reasonCode: 'PRODUCT_HAS_ORDERS' },
    { key: 'unknown_future_action', enabled: true },
  ];

  it('keeps the screen order, puts the primary first, skips keys without a handler or a descriptor', () => {
    const menu = toMenuActions(descriptors, { edit: { label: 'Modifier', onSelect: noop }, open: { label: 'Ouvrir', onSelect: noop }, archive: { label: 'Archiver', onSelect: noop } }, t);
    expect(menu.map((a) => a.key)).toEqual(['open', 'edit']);
    expect(menu[0]).toMatchObject({ primary: true, hint: 'Enter' });
  });

  it('greys a disabled action with its reason (never the code — retest 11/11 UX-056), and never runs it', () => {
    const menu = toMenuActions(descriptors, { adjust_stock: { label: 'Ajuster', onSelect: noop, hint: 'DIALOGUE' }, delete: { label: 'Supprimer', onSelect: noop, destructive: true } }, t);
    expect(menu[0]).toMatchObject({ key: 'adjust_stock', hint: 'DIALOGUE', disabledReason: "Ce produit n'a pas de stock (service)." });
    expect(menu[0]!.onSelect).toBeUndefined();
    expect(menu[1]).toMatchObject({ destructive: true, disabledReason: 'Référencé par commandes/ventes : archivez-le.' });
  });

  it('adds local navigation items without a descriptor and drops hidden ones', () => {
    const menu = toMenuActions([{ key: 'open', enabled: true }], { open: { label: 'Ouvrir', onSelect: noop }, movements: { label: 'Mouvements', onSelect: noop, local: true }, quick: { label: 'Rapide', onSelect: noop, local: true, hidden: true } }, t);
    expect(menu.map((a) => a.key)).toEqual(['open', 'movements']);
    expect(menu[1]!.onSelect).toBe(noop);
  });

  it('reason text falls back to the code, and to FORBIDDEN without a code', () => {
    expect(reasonText(t, 'SOME_NEW_CODE')).toBe('SOME_NEW_CODE');
    expect(reasonText(t, undefined)).toBe('Action non autorisée.');
  });

  it('action state for header buttons', () => {
    expect(actionState(descriptors, 'edit', t)).toEqual({ present: true, enabled: true, reason: undefined });
    expect(actionState(descriptors, 'adjust_stock', t)).toMatchObject({ present: true, enabled: false });
    expect(actionState(descriptors, 'archive', t)).toEqual({ present: false, enabled: false });
  });

  it('product menu: service has no movements item, archived keeps open / restore / delete only', () => {
    const base = { hasVariants: false, trackStock: true, archived: false };
    const all = { open: noop, quickEdit: noop, edit: noop, adjustStock: noop, variants: noop, movements: noop, duplicate: noop, cardPreview: noop, toggleActive: noop, archive: noop, restore: noop, remove: noop };
    const live = [{ key: 'open', enabled: true, primary: true }, { key: 'edit', enabled: true }, { key: 'duplicate', enabled: true }, { key: 'adjust_stock', enabled: true }, { key: 'deactivate', enabled: true }, { key: 'archive', enabled: true }, { key: 'delete', enabled: true }];
    const keys = (p: Parameters<typeof productMenuActions>[0], advanced = true, canWrite = true) => productMenuActions(p, all, { t, advanced, canWrite }).map((a) => a.key);
    expect(keys({ ...base, actions: live })).toEqual(['open', 'quick_edit', 'edit', 'adjust_stock', 'movements', 'duplicate', 'card_preview', 'deactivate', 'archive', 'delete']);
    expect(keys({ ...base, hasVariants: true, actions: live })).toContain('variants');
    expect(keys({ ...base, trackStock: false, actions: live })).not.toContain('movements');
    expect(keys({ ...base, actions: live }, false)).not.toContain('movements');
    expect(keys({ ...base, actions: live }, true, false)).not.toContain('quick_edit');
    expect(keys({ ...base, archived: true, actions: [{ key: 'open', enabled: true, primary: true }, { key: 'restore', enabled: true }, { key: 'delete', enabled: false, reasonCode: 'PRODUCT_HAS_ORDERS' }] })).toEqual(['open', 'movements', 'restore', 'delete']);
  });
});

describe('money', () => {
  it('parses integer DZD amounts typed in any usual form', () => {
    expect(parseMoney('12500')).toBe(12500);
    expect(parseMoney('12 500 DA')).toBe(12500);
    expect(parseMoney('12 500 DA')).toBe(12500);
    expect(parseMoney('١٢٥٠٠')).toBe(12500);
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
  it('rejects decimals, signs and text', () => {
    for (const bad of ['12,5', '12.50', '-100', '+5', 'abc', '1e3', '12 500 €']) expect(parseMoney(bad)).toBeNaN();
  });
  it('digits helpers', () => {
    expect(moneyDigits(4900)).toBe('4900');
    expect(moneyDigits(null)).toBe('');
    expect(digitsToInt('')).toBeNull();
    expect(digitsToInt('0')).toBe(0);
  });
  it('margin on the selling price, half-up, negative when selling below cost', () => {
    expect(marginPct(4900, 2600)).toBe(47);
    expect(marginPct(4900, 5200)).toBe(-6);
    expect(marginPct(1000, 995)).toBe(1);
    expect(marginPct(0, 10)).toBeNull();
    expect(marginPct(100, null)).toBeNull();
  });
  it('compact amounts for KPI tiles', () => {
    expect(compactAmount(1_240_000, 'fr')).toBe('1,24 M');
    expect(compactAmount(2_310_000, 'en')).toBe('2.31 M');
    expect(compactAmount(2_500_000, 'ar')).toBe('2,5 M');
    expect(compactAmount(999_999, 'fr').replace(/\s/g, ' ')).toBe('999 999');
  });
});

describe('variant matrix', () => {
  it('parses "Taille : S, M, L" with duplicates, Arabic commas and stray spaces', () => {
    expect(parseAttributeLine(' Taille :  S, M ,L,  m ')).toEqual({ name: 'Taille', values: ['S', 'M', 'L'] });
    expect(parseAttributeLine('اللون : أسود، أحمر')).toEqual({ name: 'اللون', values: ['أسود', 'أحمر'] });
    expect(parseAttributeLine('')).toBeNull();
    expect(parseAttributeLine('Taille')).toBeNull();
    expect(parseAttributeLine('Taille : ')).toBeNull();
    expect(parseAttributeLine(': S, M')).toBeNull();
    expect(formatAttributeLine({ name: 'Taille', values: ['S', 'M'] })).toBe('Taille : S, M');
  });

  it('merges attributes with the same name', () => {
    expect(normalizeAttributes([{ name: 'Taille', values: ['S'] }, null, { name: 'taille', values: ['s', 'M'] }])).toEqual([{ name: 'Taille', values: ['S', 'M'] }]);
  });

  it('builds the cartesian product, first attribute slowest', () => {
    const attrs = [
      { name: 'Couleur', values: ['Noir', 'Rouge'] },
      { name: 'Taille', values: ['S', 'M'] },
    ];
    expect(comboCount(attrs)).toBe(4);
    expect(variantMatrix(attrs).map((c) => c.name)).toEqual(['Noir · S', 'Noir · M', 'Rouge · S', 'Rouge · M']);
    expect(variantMatrix(attrs)[3]!.attributes).toEqual({ Couleur: 'Rouge', Taille: 'M' });
    expect(variantMatrix([])).toEqual([]);
    expect(comboCount([])).toBe(0);
  });

  it('never builds more than the limit + 1 combinations', () => {
    const big = [1, 2, 3].map((n) => ({ name: `A${n}`, values: Array.from({ length: 20 }, (_, i) => `v${i}`) }));
    expect(comboCount(big)).toBe(8000);
    expect(variantMatrix(big).length).toBeLessThanOrEqual(101);
  });

  it('keeps the existing combinations (by attributes or by name) and reports the limit', () => {
    const combos = variantMatrix([
      { name: 'Taille', values: ['S', 'M', 'L'] },
      { name: 'Couleur', values: ['Noir'] },
    ]);
    const { kept, created } = splitExisting(combos, [
      { name: 'M / Noir', attributes: { taille: 'm', couleur: 'noir' } },
      { name: 'l · noir', attributes: {} },
    ]);
    expect(kept.map((c) => c.name)).toEqual(['M · Noir', 'L · Noir']);
    expect(created.map((c) => c.name)).toEqual(['S · Noir']);
    expect(exceedsVariantLimit(98, 2)).toBe(false);
    expect(exceedsVariantLimit(98, 3)).toBe(true);
  });

  it('product stock = sum of the active variants', () => {
    expect(totalVariantStock([{ stock: 6 }, { stock: 1, isActive: true }, { stock: 50, isActive: false }])).toBe(7);
  });
});

describe('stock adjustment preview', () => {
  it('in / out / set', () => {
    expect(adjustedStock(1, 'in', 3)).toBe(4);
    expect(adjustedStock(1, 'out', 3)).toBe(-2);
    expect(adjustedStock(14, 'set', 9)).toBe(9);
  });
});

describe('products list', () => {
  it('tabs are filter presets; explicit filters win', () => {
    expect(tabQuery(null)).toEqual({});
    expect(tabQuery('active')).toEqual({ status: ['active'] });
    expect(tabQuery('hidden')).toEqual({ status: ['inactive'] });
    expect(tabQuery('pending')).toEqual({ moderationStatus: ['pending'] });
    expect(tabQuery('rejected')).toEqual({ moderationStatus: ['rejected', 'appealed'] });
    expect(productsQuery({ status: ['archived'], page: 1 }, 'active')).toEqual({ status: ['archived'], page: 1 });
  });

  it('the low-stock deep link preselects the filter (AT-CAT-11)', () => {
    const s = parseListState(PRODUCTS_LIST, new URLSearchParams('lowStock=1'));
    expect(filterBool(s, 'lowStock')).toBe(true);
    expect(listApiQuery(s)).toMatchObject({ lowStock: true });
    expect(countActiveFilters(s)).toBe(1);
  });

  it('date presets are Africa/Algiers days', () => {
    // 23:30 UTC on 10 Oct is already 11 Oct in Algiers (UTC+1)
    const now = new Date('2026-10-10T23:30:00Z');
    expect(algiersDay(now)).toBe('2026-10-11');
    expect(presetRange('7d', now)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(presetRange('30d', now)).toEqual({ from: '2026-09-12', to: '2026-10-11' });
    expect(presetRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-11' });
    expect(matchPreset('2026-10-05', '2026-10-11', now)).toBe('7d');
    expect(matchPreset('2026-10-02', '2026-10-11', now)).toBe('custom');
    expect(matchPreset('', '', now)).toBeNull();
  });

  it('one chip per active filter group', () => {
    const labels: ChipLabels = {
      category: (n) => `Catégorie : ${n}`,
      categoryName: (id) => ({ c1: 'Vêtements', c2: 'Accessoires' })[id] ?? '…',
      status: { active: 'Actifs' },
      type: { service: 'Services' },
      stockState: { out: 'Rupture' },
      lowStock: 'Stock faible',
      noAgent: 'Aucun agent',
      agent: (n) => `Agent : ${n}`,
      agentName: (id) => ({ a1: 'Vendeur Pro' })[id] ?? '…',
      moderation: { pending: 'En attente' },
      qty: (r) => `Quantité ${r}`,
      price: (r) => `Prix ${r}`,
      cost: (r) => `Coût ${r}`,
      margin: (r) => `Marge ${r}`,
      created: (r) => `Créé ${r}`,
      updated: (r) => `Modifié ${r}`,
      search: (q) => `Recherche : ${q}`,
      date: (d) => d,
    };
    const s = parseListState(PRODUCTS_LIST, new URLSearchParams('q=robe&categoryIds=c1,c2&status=active&lowStock=1&minPrice=1000&maxPrice=20000&minMargin=10&moderationStatus=pending&createdFrom=2026-10-01'));
    const chips = activeChips(s, labels);
    expect(chips.map((c) => c.label.replace(/\s/g, ' '))).toEqual([
      'Recherche : robe',
      'Catégorie : Vêtements, Accessoires',
      'Actifs',
      'Stock faible',
      'Prix 1 000 DA – 20 000 DA',
      'Marge ≥ 10 %',
      'En attente',
      'Créé 2026-10-01 → …',
    ]);
    expect(chips.find((c) => c.key === 'minPrice')!.clear).toEqual({ minPrice: null, maxPrice: null });
    expect(chips[0]!.clear).toBe('q');
  });
});

describe('offline menus (banner "Hors ligne")', () => {
  const items = [
    { key: 'open', label: 'Ouvrir', onSelect: () => undefined },
    { key: 'cancel', label: 'Annuler', onSelect: () => undefined },
    { key: 'delete', label: 'Supprimer', disabledReason: 'Payée (SALE_DELETE_PAID)' },
  ];
  it('greys every write item with the offline reason, keeps reads and the existing reasons', () => {
    const out = offlineMenu(items, 'Hors ligne', ['open']);
    expect(out[0]).toBe(items[0]);
    expect(typeof out[0]!.onSelect).toBe('function');
    expect(out[1]).toMatchObject({ key: 'cancel', onSelect: undefined, disabledReason: 'Hors ligne' });
    expect(out[2]).toMatchObject({ key: 'delete', disabledReason: 'Payée (SALE_DELETE_PAID)' });
  });
  it('online: the menu is unchanged', () => {
    expect(offlineMenu(items, undefined, ['open'])).toBe(items);
  });
});
