// Pure rules of the catalogue: low-stock crossing (CAT-09), margins (GDS-09 / EXP-02), moderation trigger and SLA (04 §12),
// stock state and margin helpers.
import { formatMoney } from '@djaber/shared';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { marginPct, productStockState, stockStateOf } from './catalog.util';
import { crossing } from './low-stock.evaluator';
import { computeMargins } from './margin.calculator';
import { moderationSlaDueAt, needsReview, unreviewedVariants } from './moderation-hook.service';
import { priceRangeOf } from './product.presenter';

describe('CAT-09 low-stock crossing (quantity ≤ minStock, alerts on the way down only)', () => {
  it.each([
    [10, 7, 4, null],
    [7, 4, 4, 'low'],
    [5, 3, 4, 'low'],
    [3, 2, 4, null], // already low: no second alert
    [3, 0, 4, 'out'],
    [1, -2, 0, 'out'],
    [0, -1, 0, null], // already out
    [5, 0, 0, 'out'],
    [5, 1, 0, null], // threshold 0: only "out" exists
    [2, 6, 4, null], // going up never alerts
    [4, 4, 4, null],
  ])('%i → %i with min %i ⇒ %s', (before, after, min, expected) => {
    expect(crossing(before, after, min)).toBe(expected);
  });
});

describe('stock state', () => {
  it('out at 0, low at or under the threshold', () => {
    expect([stockStateOf(0, 5), stockStateOf(-2, 0), stockStateOf(5, 5), stockStateOf(6, 5), stockStateOf(1, 0)]).toEqual(['out', 'out', 'low', 'ok', 'ok']);
  });
  it('a product is low when one active variant is at or under its own threshold; services are untracked', () => {
    const v = (stock: number, minStock: number, isActive = true) => ({ stock, minStock, isActive });
    expect(productStockState({ trackStock: false, stock: null, minStock: 0 })).toBe('untracked');
    expect(productStockState({ trackStock: true, stock: 10, minStock: 0, variants: [v(9, 2), v(1, 2)] })).toBe('low');
    expect(productStockState({ trackStock: true, stock: 9, minStock: 0, variants: [v(9, 2), v(1, 2, false)] })).toBe('ok');
    expect(productStockState({ trackStock: true, stock: 0, minStock: 0, variants: [v(0, 0)] })).toBe('out');
  });
});

describe('GDS-09 / EXP-02 margins', () => {
  it('margin % on the selling price, one decimal', () => {
    expect(marginPct(5000, 3000)).toBe(40);
    expect(marginPct(900, 1200)).toBe(-33.3);
    expect(marginPct(3000, 1000)).toBe(66.7);
    expect(marginPct(3000, null)).toBeNull();
  });
  it('true cost = weighted cost + per-unit expenses + fixed expenses / units sold in the period', () => {
    const expenses = [
      { amount: 200, isPerUnit: true },
      { amount: 50, isPerUnit: true },
      { amount: 1000, isPerUnit: false },
      { amount: 500, isPerUnit: false },
    ];
    expect(computeMargins({ price: 6000, weightedCost: 3000, expenses, unitsSold: 10 })).toEqual({ weightedCost: 3000, expensesPerUnit: 400, trueCost: 3400, marginDzd: 2600, marginPct: 43.3 });
    // nothing sold: the fixed amount weighs on one unit
    expect(computeMargins({ price: 6000, weightedCost: 3000, expenses, unitsSold: 0 })).toMatchObject({ expensesPerUnit: 1750, trueCost: 4750, marginPct: 20.8 });
    // integer DA, half up
    expect(computeMargins({ price: 1000, weightedCost: 0, expenses: [{ amount: 10, isPerUnit: false }], unitsSold: 4 }).expensesPerUnit).toBe(3);
    // no cost entered (simple mode): expenses are known, the margin is not
    expect(computeMargins({ price: 6000, weightedCost: null, expenses, unitsSold: 10 })).toEqual({ weightedCost: null, expensesPerUnit: 400, trueCost: null, marginDzd: null, marginPct: null });
  });
});

describe('04 §12 moderation trigger', () => {
  const base = { name: 'Montre', description: 'Acier', categoryId: 'c1', price: 4000 };
  it.each([
    [{ ...base, name: 'Montre homme' }, true],
    [{ ...base, description: null }, true],
    [{ ...base, categoryId: null }, true],
    [{ ...base, price: 2000 }, true], // −50 %
    [{ ...base, price: 6000 }, true], // +50 %
    [{ ...base, price: 1800 }, true], // −55 % (AT-MOD-02)
    [{ ...base, price: 2001 }, false],
    [{ ...base, price: 5999 }, false],
    [{ ...base }, false],
  ])('%j ⇒ %s', (after, expected) => {
    expect(needsReview(base, after)).toBe(expected);
  });
  it('an empty description and no description are the same content', () => {
    expect(needsReview({ ...base, description: null }, { ...base, description: '' })).toBe(false);
  });
});

describe('UX-034 variants of an approved product not reviewed yet (never auto-approved)', () => {
  const snap = (variants?: { id: string; name: string; price: number }[]) => ({ title: 'Gourde', description: null, price: 2000, categoryId: null, images: [], ...(variants ? { variants } : {}) });
  const approved = snap([{ id: 'v1', name: 'Rouge', price: 2000 }]);
  it('new, renamed, repriced ±50 % or shown again ⇒ listed; same, ±49 % or removed ⇒ nothing', () => {
    expect(unreviewedVariants(approved, snap([{ id: 'v1', name: 'Rouge', price: 2000 }, { id: 'v2', name: 'Bleu', price: 2000 }]))).toEqual(['Bleu']);
    expect(unreviewedVariants(approved, snap([{ id: 'v1', name: 'Rouge foncé', price: 2000 }]))).toEqual(['Rouge foncé']);
    expect(unreviewedVariants(approved, snap([{ id: 'v1', name: 'Rouge', price: 3000 }]))).toEqual(['Rouge']);
    expect(unreviewedVariants(approved, snap([{ id: 'v1', name: 'Rouge', price: 2900 }]))).toEqual([]);
    expect(unreviewedVariants(approved, snap([]))).toEqual([]);
  });
  it('a product never approved has no reference; an approved snapshot without variants counts them all as new', () => {
    expect(unreviewedVariants(null, snap([{ id: 'v1', name: 'Rouge', price: 2000 }]))).toEqual([]);
    expect(unreviewedVariants(snap(), snap([{ id: 'v1', name: 'Rouge', price: 2000 }]))).toEqual(['Rouge']);
  });
});

describe('AT-MOD-08 SLA: 2 business hours, Sun–Thu 09:00–18:00 Africa/Algiers (UTC+1)', () => {
  // 2026-10-11 is a Sunday
  it.each([
    ['2026-10-11T08:00:00Z', '2026-10-11T10:00:00.000Z'], // Sunday 09:00 → 11:00
    ['2026-10-11T16:30:00Z', '2026-10-12T09:30:00.000Z'], // Sunday 17:30 → Monday 10:30
    ['2026-10-11T05:00:00Z', '2026-10-11T10:00:00.000Z'], // before opening → 11:00
    ['2026-10-11T19:00:00Z', '2026-10-12T10:00:00.000Z'], // after closing → next day 11:00
    ['2026-10-15T16:00:00Z', '2026-10-18T09:00:00.000Z'], // Thursday 17:00 → Sunday 10:00 (Friday and Saturday off)
    ['2026-10-16T10:00:00Z', '2026-10-18T10:00:00.000Z'], // Friday → Sunday 11:00
  ])('%s → %s', (from, due) => {
    expect(moderationSlaDueAt(new Date(from)).toISOString()).toBe(due);
  });
});

describe('products with variants are sold at their variants\' prices (tester report 2026-10-20)', () => {
  it('list price range of the active variants; none without variants', () => {
    expect(priceRangeOf({ hasVariants: true, variants: [{ price: 4500, isActive: true }, { price: 5200, isActive: true }, { price: 9000, isActive: false }] })).toEqual({ min: 4500, max: 5200 });
    expect(priceRangeOf({ hasVariants: false, variants: [] })).toBeNull();
    expect(priceRangeOf({ hasVariants: true, variants: [{ price: 4500, isActive: false }] })).toBeNull();
  });
  it('a product card shows the variants and their price range', () => {
    const parts = OutboundSendService.partsOf({ text: null, attachments: null, type: 'product_cards', payload: { cards: [{ productId: 'p', name: 'Robe', price: 4500, priceMax: 5200, variants: 'S · M · L', imageUrl: null }] } } as never);
    expect(parts).toEqual([{ kind: 'text', text: `Robe\nS · M · L\n${formatMoney(4500)} – ${formatMoney(5200)}` }]);
  });
});
