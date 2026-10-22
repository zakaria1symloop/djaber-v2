// Top-bar search (tester report 2026-10-20 improvement): the menu pages matched by name, accents and case ignored.
import { describe, expect, it } from 'vitest';
import { matchPages } from './global-search';

const label = (k: string) => ({ 'nav.cash': 'Caisse', 'nav.orders': 'Commandes', 'nav.clients': 'Clients', 'nav.categories': 'Catégories' })[k] ?? k;
const items = [{ key: 'nav.cash', href: '/cash' }, { key: 'nav.orders', href: '/orders' }, { key: 'nav.clients', href: '/clients' }, { key: 'nav.categories', href: '/categories' }];

describe('global search — pages', () => {
  it('matches the page names, accents and case ignored, 2 letters at least', () => {
    expect(matchPages(items, label, 'caiss').map((i) => i.href)).toEqual(['/cash']);
    expect(matchPages(items, label, 'CATEGO').map((i) => i.href)).toEqual(['/categories']);
    expect(matchPages(items, label, 'c').map((i) => i.href)).toEqual([]);
    expect(matchPages(items, label, 'ses').map((i) => i.href)).toEqual([]);
  });
});
