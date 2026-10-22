import type { AnalysisItem } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { allSelected, analysisViewState, buildImport, deselectDuplicates, durationSeconds, importOutcome, initialEdits, invalidSelected, patchRow, planRoom, rowIssues, rowStatus, selectAll, selectedDuplicates, selectedKeys, summaryCounts } from './analysis-logic';

const item = (key: string, o: Partial<AnalysisItem> = {}): AnalysisItem => ({ key, postId: `p-${key}`, name: `Produit ${key}`, description: null, price: 1000, category: 'Vêtements', imageUrl: null, duplicateOf: null, ...o });
const ITEMS = [item('a'), item('b', { price: null }), item('c', { duplicateOf: 'Parfum Oud 50 ml', price: 4900 }), item('d', { price: 5200, category: null })];

describe('analysis view state (CHN-08)', () => {
  it('maps the server state and the permission error', () => {
    expect(analysisViewState(null)).toBe('idle');
    expect(analysisViewState({ state: 'none', items: [] })).toBe('idle');
    expect(analysisViewState({ state: 'running', items: [] })).toBe('running');
    expect(analysisViewState({ state: 'failed', items: [] })).toBe('failed');
    expect(analysisViewState({ state: 'done', items: [] })).toBe('empty');
    expect(analysisViewState({ state: 'done', items: ITEMS })).toBe('done');
    expect(analysisViewState({ state: 'permission_required', items: [] })).toBe('permission');
    expect(analysisViewState({ state: 'done', items: ITEMS }, 'PAGE_ANALYSIS_PERMISSION_REQUIRED')).toBe('permission');
  });
  it('computes the duration and the summary counts', () => {
    expect(durationSeconds('2026-10-11T10:00:00Z', '2026-10-11T10:00:48Z')).toBe(48);
    expect(durationSeconds(null, '2026-10-11T10:00:48Z')).toBeNull();
    expect(durationSeconds('2026-10-11T10:01:00Z', '2026-10-11T10:00:00Z')).toBeNull();
    expect(summaryCounts({ items: ITEMS, postsDone: 30 })).toEqual({ posts: 30, detected: 4, duplicates: 1 });
  });
});

describe('review grid', () => {
  it('selects by default the new products that have a price', () => {
    const e = initialEdits(ITEMS);
    expect(selectedKeys(ITEMS, e)).toEqual(['a', 'd']);
    expect(e.b).toMatchObject({ selected: false, price: '', quantity: '1' });
    expect(e.c).toMatchObject({ selected: false, price: '4900' });
    expect(e.d!.category).toBe('');
  });
  it('gives each row its pill', () => {
    const e = initialEdits(ITEMS);
    expect(rowStatus(ITEMS[0]!, e.a)).toBe('new');
    expect(rowStatus(ITEMS[1]!, e.b)).toBe('price_missing');
    expect(rowStatus(ITEMS[2]!, e.c)).toBe('exists');
    expect(rowStatus(ITEMS[1]!, { price: '900' })).toBe('new');
  });
  it('requires a name, a price > 0 and a quantity > 0', () => {
    expect(rowIssues({ selected: true, name: 'Robe', price: '6500', quantity: '10', category: '' })).toEqual({});
    expect(rowIssues({ selected: true, name: ' ', price: '0', quantity: '', category: '' })).toEqual({ name: 'validation.required', price: 'validation.price', quantity: 'validation.quantity' });
    expect(rowIssues({ selected: true, name: 'x'.repeat(256), price: '1', quantity: '0', category: '' })).toEqual({ name: 'validation.length', quantity: 'validation.quantity' });
  });
  it('counts invalid rows among the selected ones only', () => {
    let e = initialEdits(ITEMS);
    expect(invalidSelected(ITEMS, e)).toEqual([]);
    e = patchRow(e, 'b', { selected: true });
    expect(invalidSelected(ITEMS, e)).toEqual(['b']);
    e = patchRow(e, 'b', { price: '700' });
    expect(invalidSelected(ITEMS, e)).toEqual([]);
    expect(patchRow(e, 'zz', { selected: true })).toBe(e);
  });
  it('selects everything, then removes the duplicates', () => {
    let e = selectAll(ITEMS, initialEdits(ITEMS), new Set(), true);
    expect(allSelected(ITEMS, e)).toBe(true);
    expect(selectedDuplicates(ITEMS, e)).toBe(1);
    e = deselectDuplicates(ITEMS, e);
    expect(selectedKeys(ITEMS, e)).toEqual(['a', 'b', 'd']);
    expect(selectedDuplicates(ITEMS, e)).toBe(0);
    expect(selectedKeys(ITEMS, selectAll(ITEMS, e, new Set(), false))).toEqual([]);
  });
  it('leaves imported rows out of the selection', () => {
    const e = selectAll(ITEMS, initialEdits(ITEMS), new Set(), true);
    expect(selectedKeys(ITEMS, e, new Set(['a']))).toEqual(['b', 'c', 'd']);
    expect(allSelected([], e)).toBe(false);
  });
});

describe('import', () => {
  it('sends the selected valid rows with the edited values', () => {
    let e = initialEdits(ITEMS);
    e = patchRow(e, 'a', { name: '  Robe longue  ', price: '6500', quantity: '10' });
    e = patchRow(e, 'b', { selected: true });
    const { keys, body } = buildImport(ITEMS, e);
    expect(keys).toEqual(['a', 'd']);
    // the post id goes along: a post imported once is never imported again (tester report 2026-10-20 A1)
    expect(body.items[0]).toEqual({ name: 'Robe longue', description: null, price: 6500, quantity: 10, category: 'Vêtements', imageUrl: null, postId: 'p-a' });
    expect(body.items[1]!.category).toBeNull();
    expect(buildImport(ITEMS, e, new Set(['a'])).keys).toEqual(['d']);
  });
  it('a service / digital offer has no quantity to check and is sent as a service (A2)', () => {
    const items = [item('s', { isService: true, price: 800 })];
    const e = initialEdits(items);
    expect(e.s).toMatchObject({ selected: true, isService: true });
    expect(buildImport(items, patchRow(e, 's', { quantity: '' })).body.items[0]).toMatchObject({ quantity: 1, isService: true, postId: 'p-s' });
  });
  it('maps the per-item result back onto the rows', () => {
    const out = importOutcome(['a', 'b', 'd'], {
      created: [
        { key: 'a', productId: 'P1', sku: 'FB-1' },
        { key: 'd', productId: 'P2', sku: 'FB-2' },
      ],
      failed: [{ index: 1, code: 'PLAN_LIMIT', message: 'Limite' }],
    });
    expect(out.created).toEqual({ a: { productId: 'P1', sku: 'FB-1' }, d: { productId: 'P2', sku: 'FB-2' } });
    expect(out.failed).toEqual({ b: { code: 'PLAN_LIMIT', message: 'Limite' } });
  });
  it('falls back to the order sent when the server keys are not ours', () => {
    const out = importOutcome(['a', 'b', 'd'], {
      created: [
        { key: '0', productId: 'P1', sku: 'FB-1' },
        { key: '2', productId: 'P2', sku: 'FB-2' },
      ],
      failed: [{ index: 1, code: 'VALIDATION', message: '' }],
    });
    expect(Object.keys(out.created)).toEqual(['a', 'd']);
  });
  it('checks the room left on the plan', () => {
    expect(planRoom(128, 1000, 7)).toEqual({ current: 128, adding: 7, limit: 1000, ok: true });
    expect(planRoom(998, 1000, 7)!.ok).toBe(false);
    expect(planRoom(10, -1, 7)).toBeNull();
    expect(planRoom(undefined, 100, 1)).toBeNull();
  });
});
