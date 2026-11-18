// LST-03 saved views ↔ list URL state (AT-LST-03 web part: filters + tab + sort + columns + density round-trip).
import { describe, expect, it } from 'vitest';
import { parseListState, patchListState, type ListSpec } from '@/lib/list-state';
import { ORDERS_LIST } from '@/features/orders/list/spec';
import { copyName, filterParams, isCurrentView, isPristine, patchFor, stateFromView, viewFromState } from './logic';

const params = (qs: string) => new URLSearchParams(qs);
const COLUMNS = ['number', 'client', 'source', 'items', 'total', 'status', 'confirmation', 'delivery', 'risk'];

describe('saved views — list state', () => {
  it('stores the filter part of the URL (q, tab, filters), the sort, the visible columns and the density', () => {
    const s = parseListState(ORDERS_LIST, params('tab=confirmed&wilayaId=19,16&source=ai&q=amina&sort=-total&page=3&pageSize=50&hide=risk,source&density=compact&sheet=x'));
    expect(viewFromState(ORDERS_LIST, s, { columnKeys: COLUMNS })).toEqual({
      filters: { tab: 'confirmed', q: 'amina', wilayaId: '19,16', source: 'ai' },
      sort: '-total',
      columns: ['number', 'client', 'items', 'total', 'status', 'confirmation', 'delivery'],
      density: 'compact',
    });
    // the default sort and the user density are not stored
    expect(viewFromState(ORDERS_LIST, parseListState(ORDERS_LIST, params('source=ai')))).toEqual({ filters: { source: 'ai' }, sort: null, columns: [], density: null });
  });

  it('a view opens with its filters (replacing the current ones), page 1, its sort, columns and density', () => {
    const current = parseListState(ORDERS_LIST, params('paymentStatus=unpaid&page=4&pageSize=100&sheet=abc'));
    const next = stateFromView(ORDERS_LIST, { filters: { tab: 'confirmed', wilayaId: '19', neverCalled: true }, sort: '-total', columns: ['number', 'client', 'total'], density: 'compact' }, { columnKeys: COLUMNS, current });
    expect(next).toMatchObject({ tab: 'confirmed', filters: { wilayaId: ['19'], neverCalled: true }, sort: '-total', page: 1, pageSize: 100, sheet: null, density: 'compact' });
    expect(next.hide).toEqual(['source', 'items', 'status', 'confirmation', 'delivery', 'risk']);
    // the useListState patch clears the filters the view does not have
    const patched = patchListState(current, patchFor(current, next));
    expect(patched.filters).toEqual({ wilayaId: ['19'], neverCalled: true });
    expect(patched.page).toBe(1);
    // no columns stored ⇒ every column shown; no density ⇒ the current one
    expect(stateFromView(ORDERS_LIST, { filters: {}, sort: null, columns: [], density: null }, { columnKeys: COLUMNS, current: { ...current, density: 'comfortable' } })).toMatchObject({ hide: [], density: 'comfortable', sort: '-orderedAt' });
  });

  it('round trip: saving then opening a view gives the same list', () => {
    const s = parseListState(ORDERS_LIST, params('tab=new&minTotal=1000&maxTotal=20000&period=30d&sort=total'));
    const v = viewFromState(ORDERS_LIST, s, { columnKeys: COLUMNS });
    const back = stateFromView(ORDERS_LIST, v, { columnKeys: COLUMNS });
    expect(filterParams(ORDERS_LIST, back)).toEqual(filterParams(ORDERS_LIST, s));
    expect(back.sort).toBe('total');
    expect(isCurrentView(ORDERS_LIST, s, v)).toBe(true);
  });

  it('the current view = same filters and sort; any other filter or sort is not that view', () => {
    const view = { filters: { tab: 'confirmed', wilayaId: '19' }, sort: null };
    expect(isCurrentView(ORDERS_LIST, parseListState(ORDERS_LIST, params('tab=confirmed&wilayaId=19&density=compact&page=2')), view)).toBe(true);
    expect(isCurrentView(ORDERS_LIST, parseListState(ORDERS_LIST, params('tab=confirmed&wilayaId=19,16')), view)).toBe(false);
    expect(isCurrentView(ORDERS_LIST, parseListState(ORDERS_LIST, params('tab=confirmed&wilayaId=19&sort=total')), view)).toBe(false);
    expect(isCurrentView(ORDERS_LIST, parseListState(ORDERS_LIST, params('wilayaId=19')), view)).toBe(false);
  });

  it('a clean URL (only presentation params) may open the default view', () => {
    const spec: ListSpec = { filters: { status: 'list' }, sorts: ['name'], defaultSort: 'name' };
    expect(isPristine(spec, params(''))).toBe(true);
    expect(isPristine(spec, params('density=compact&pageSize=50&hide=x'))).toBe(true);
    expect(isPristine(spec, params('status=active'))).toBe(false);
    expect(isPristine(spec, params('q=robe'))).toBe(false);
    expect(isPristine(spec, params('tab=pending'))).toBe(false);
  });

  it('duplicate names: « (copie) », then « (copie 2) », within 60 characters', () => {
    const label = (n: number) => (n === 1 ? 'copie' : `copie ${n}`);
    expect(copyName('À envoyer Sétif', ['À envoyer Sétif'], label)).toBe('À envoyer Sétif (copie)');
    expect(copyName('À envoyer Sétif', ['À envoyer Sétif', 'à envoyer sétif (COPIE)'], label)).toBe('À envoyer Sétif (copie 2)');
    expect(copyName('x'.repeat(60), [], label)).toHaveLength(60);
  });
});
