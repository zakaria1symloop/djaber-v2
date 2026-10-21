// GDS operations logic (GDS-06…09, INV-02, EXP-01, 09 §4): purchase / sale totals, receive summary, inventory variance
// rule (> 10 % ⇒ note), expense margin preview, cash selection (pills ↔ table ↔ KPIs use the same parameters).
import { describe, expect, it } from 'vitest';
import { orderImportPhase } from '@/features/orders/import/order-import';
import { cashDateIso, cashSelection, cashSelectionQuery, closingGap, daysList, defaultReceiveQty, int, inventoryTotals, lineVariants, marginPreview, periodDays, priceEdited, purchaseTotals, receiveSummary, saleClientBody, saleSheetSnapshot, saleTotals, selectionDay, unitsLabel, variance } from './logic';

describe('money input', () => {
  it('reads digits only, never NaN', () => {
    expect(int('12 500')).toBe(12500);
    expect(int('')).toBe(0);
    expect(int(null)).toBe(0);
    expect(int(4.9)).toBe(4);
  });
});

describe('new purchase totals (GDS-06b)', () => {
  it('sums tracked lines + tax + shipping, remaining = total − paid', () => {
    const t = purchaseTotals(
      [
        { quantity: 24, unitCost: '1 500', trackStock: true },
        { quantity: 12, unitCost: '900', trackStock: true },
        { quantity: 3, unitCost: '800', trackStock: false },
      ],
      { tax: '0', shipping: '1 200', paid: '12 000' },
    );
    expect(t.subtotal).toBe(46800);
    expect(t.total).toBe(48000);
    expect(t.remaining).toBe(36000);
    expect(t.overpaid).toBe(false);
  });
  it('flags a payment above the total', () => {
    expect(purchaseTotals([{ quantity: 1, unitCost: '100', trackStock: true }], { tax: '', shipping: '', paid: '150' }).overpaid).toBe(true);
  });
});

describe('new sale totals (GDS-08)', () => {
  const lines = [
    { quantity: 1, unitPrice: '4 900', catalogPrice: 4900 },
    { quantity: 1, unitPrice: '5 000', catalogPrice: 5000 },
    { quantity: 2, unitPrice: '4 200', catalogPrice: 4500 },
  ];
  it('Figma example: 18 300 − 5 % = 17 385, 10 000 received ⇒ partial, 7 385 due', () => {
    const t = saleTotals(lines, { discount: '5', discountMode: 'percent', received: '10 000' });
    expect(t.subtotal).toBe(18300);
    expect(t.discount).toBe(915);
    expect(t.total).toBe(17385);
    expect(t.remaining).toBe(7385);
    expect(t.partial).toBe(true);
    expect(t.change).toBe(0);
  });
  it('gives the change back when more is received', () => {
    const t = saleTotals(lines, { discount: '', discountMode: 'amount', received: '20 000' });
    expect(t.paid).toBe(18300);
    expect(t.change).toBe(1700);
    expect(t.partial).toBe(false);
  });
  it('caps a discount at the subtotal and a percent at 100', () => {
    expect(saleTotals(lines, { discount: '99 999', discountMode: 'amount', received: '0' }).total).toBe(0);
    expect(saleTotals(lines, { discount: '250', discountMode: 'percent', received: '0' }).total).toBe(0);
  });
  it('marks an edited price ("PRIX MODIFIÉ 4 500 → 4 200")', () => {
    expect(priceEdited(lines[2]!)).toBe(true);
    expect(priceEdited(lines[0]!)).toBe(false);
  });
});

describe('receive dialog (GDS-07)', () => {
  it('Figma example: 4 left of 12, an added line of 6, over-receipt detected', () => {
    const s = receiveSummary([
      { ordered: 12, alreadyReceived: 8, now: 4 },
      { ordered: 0, alreadyReceived: 0, now: 6, added: true },
    ]);
    expect(s.units).toBe(10);
    expect(s.movements).toBe(2);
    expect(s.remainingBefore).toBe(4);
    expect(s.orderedTotal).toBe(12);
    expect(s.over).toHaveLength(0);
    expect(receiveSummary([{ ordered: 12, alreadyReceived: 0, now: 14 }]).over).toHaveLength(1);
  });
  it('proposes what is still due on each line', () => {
    expect(defaultReceiveQty(12, 8)).toBe(4);
    expect(defaultReceiveQty(12, 14)).toBe(0);
    expect(unitsLabel({ ordered: 12, received: 8 })).toBe('8/12');
  });
});

describe('inventory variance (INV-02, 04 §19)', () => {
  it('a note is required above 10 %', () => {
    expect(variance(21, 18)).toMatchObject({ difference: -3, pct: 14, noteRequired: true });
    expect(variance(3, 1)).toMatchObject({ difference: -2, pct: 66, noteRequired: true });
    // exactly 10 % is not above the threshold
    expect(variance(10, 9)).toMatchObject({ pct: 10, noteRequired: false });
    expect(variance(100, 95)).toMatchObject({ difference: -5, noteRequired: false });
    expect(variance(12, 12)).toMatchObject({ difference: 0, noteRequired: false });
    expect(variance(5, null)).toMatchObject({ counted: false, noteRequired: false });
  });
  it('totals: counted lines, gaps, value at cost, progress', () => {
    const t = inventoryTotals([
      { expected: 21, counted: 18, cost: 2000 },
      { expected: 12, counted: 13, cost: 1500 },
      { expected: 3, counted: null, cost: 900 },
      { expected: 6, counted: 6, cost: 100 },
    ]);
    expect(t).toEqual({ counted: 3, discrepancies: 2, value: -4500, flagged: 1, progressPct: 75 });
  });
});

describe('expense margin preview (EXP-01/02)', () => {
  it('per unit: 4 500 price, cost 2 400 ⇒ 46,7 % → 44,0 % with 120 DA packaging', () => {
    const p = marginPreview({ price: 4500, weightedCost: 2400, expensesPerUnit: 0, unitsSold: 30, amount: 120, isPerUnit: true });
    expect(p.before).toBe(46.7);
    expect(p.after).toBe(44);
    expect(p.trueCostAfter).toBe(2520);
  });
  it('fixed: spread over the units sold of the period (1 when nothing sold)', () => {
    expect(marginPreview({ price: 1000, weightedCost: 500, expensesPerUnit: 0, unitsSold: 10, amount: 1000, isPerUnit: false }).trueCostAfter).toBe(600);
    expect(marginPreview({ price: 1000, weightedCost: 500, expensesPerUnit: 0, unitsSold: 0, amount: 100, isPerUnit: false }).trueCostAfter).toBe(600);
  });
  it('no cost price ⇒ no margin', () => {
    expect(marginPreview({ price: 1000, weightedCost: null, expensesPerUnit: 0, unitsSold: 0, amount: 100, isPerUnit: true }).before).toBeNull();
  });
});

describe('cash selection — pills, table and KPIs share the same parameters (09 §4)', () => {
  const today = '2026-10-05';
  it('defaults to today', () => {
    const s = cashSelection({}, today);
    expect(s).toEqual({ kind: 'day', day: today });
    expect(cashSelectionQuery(s)).toEqual({ day: today });
    expect(selectionDay(s)).toBe(today);
  });
  it('a period pill or a custom range replaces the day', () => {
    expect(cashSelectionQuery(cashSelection({ day: '2026-10-01', period: '7d' }, today))).toEqual({ period: '7d' });
    expect(cashSelectionQuery(cashSelection({ day: '2026-10-01', from: '2026-09-01', to: '2026-09-30' }, today))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(selectionDay(cashSelection({ period: '30d' }, today))).toBeNull();
    expect(selectionDay(cashSelection({ from: '2026-10-02', to: '2026-10-02' }, today))).toBe('2026-10-02');
  });
  it('ignores a malformed day and an unknown period', () => {
    expect(cashSelection({ day: 'yesterday', period: 'ever' }, today)).toEqual({ kind: 'day', day: today });
  });
  it('period presets end today (Africa/Algiers days)', () => {
    expect(periodDays('7d', today)).toEqual({ from: '2026-09-29', to: today });
    expect(periodDays('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodDays('year', today)).toEqual({ from: '2026-01-01', to: today });
  });
  it('closing gap (counted − theoretical) and the unclosed days line', () => {
    expect(closingGap(76350, '76 000')).toBe(-350);
    expect(closingGap(76350, '')).toBeNull();
    expect(daysList(['2026-10-02', '2026-10-03', '2026-10-04'], () => 'oct.')).toBe('02, 03, 04 oct.');
    expect(daysList(['2026-09-30', '2026-10-01'], (d) => (d.slice(5, 7) === '09' ? 'sept.' : 'oct.'))).toBe('30 sept., 01 oct.');
  });
});

describe('order import phases (M5 carry-over, CAT-06 wizard)', () => {
  const result = (stage: 'mapping' | 'preview' | 'committed', missing: string[] = []) => ({ stage, missingColumns: missing }) as never;
  it('upload → analysing → mapping / preview → importing → done', () => {
    expect(orderImportPhase(null, undefined, false)).toBe('upload');
    expect(orderImportPhase('j', undefined, false)).toBe('loading');
    expect(orderImportPhase('j', { status: 'running', result: null }, false)).toBe('analysing');
    expect(orderImportPhase('j', { status: 'done', result: result('mapping') }, false)).toBe('mapping');
    expect(orderImportPhase('j', { status: 'done', result: result('preview', ['phone']) }, false)).toBe('mapping');
    expect(orderImportPhase('j', { status: 'done', result: result('preview') }, false)).toBe('preview');
    expect(orderImportPhase('j', { status: 'running', result: result('preview') }, true)).toBe('importing');
    expect(orderImportPhase('j', { status: 'partial', result: result('committed') }, true)).toBe('done');
    expect(orderImportPhase('j', { status: 'failed', result: null }, true)).toBe('importFailed');
    expect(orderImportPhase('j', { status: 'failed', result: null }, false)).toBe('analysisFailed');
  });
});

describe('new sale sheet: client body, leave guard snapshot, variants of an edited line', () => {
  it('sends the typed new client on create AND on a draft update (SALE_PARTIAL_REQUIRES_CUSTOMER otherwise)', () => {
    expect(saleClientBody({ id: 'c1' }, { open: true, name: 'X', phone: '0555' })).toEqual({ clientId: 'c1', client: null });
    expect(saleClientBody(null, { open: true, name: '  Amina  ', phone: ' 0555 12 34 56 ' })).toEqual({ clientId: null, client: { name: 'Amina', phone: '0555 12 34 56' } });
    expect(saleClientBody(null, { open: false, name: 'Amina', phone: '0555123456' })).toEqual({ clientId: null, client: null });
    expect(saleClientBody(null, { open: true, name: '  ', phone: '0555123456' })).toEqual({ clientId: null, client: null });
  });
  it('the snapshot changes with the cart, the client, the payment; formatting alone does not', () => {
    const base = { lines: [] as { productId: string; variantId: string | null; quantity: number; unitPrice: string }[], discount: '', discountMode: 'amount' as const, clientId: null, newClient: { open: false, name: '', phone: '' }, method: 'cash', received: null };
    const empty = saleSheetSnapshot(base);
    expect(saleSheetSnapshot({ ...base, lines: [{ productId: 'p', variantId: null, quantity: 1, unitPrice: '4500' }] })).not.toBe(empty);
    expect(saleSheetSnapshot({ ...base, clientId: 'c1' })).not.toBe(empty);
    expect(saleSheetSnapshot({ ...base, method: 'ccp' })).not.toBe(empty);
    expect(saleSheetSnapshot({ ...base, newClient: { open: true, name: 'A', phone: '' } })).not.toBe(empty);
    // a closed "new client" form with leftovers is not a change; "4 500" and "4500" are the same price
    expect(saleSheetSnapshot({ ...base, newClient: { open: false, name: 'A', phone: '' } })).toBe(empty);
    const one = { ...base, lines: [{ productId: 'p', variantId: null, quantity: 1, unitPrice: '4 500' }] };
    expect(saleSheetSnapshot(one)).toBe(saleSheetSnapshot({ ...base, lines: [{ productId: 'p', variantId: null, quantity: 1, unitPrice: '4500' }] }));
  });
  it('an edited line offers the loaded variants and keeps its saved one when it is no longer listed', () => {
    const saved = [{ id: 'v-old', name: 'M' }];
    expect(lineVariants(saved, undefined)).toEqual(saved);
    expect(lineVariants(saved, [{ id: 'v-old', name: 'M (fresh)' }, { id: 'v2', name: 'L' }])).toEqual([{ id: 'v-old', name: 'M (fresh)' }, { id: 'v2', name: 'L' }]);
    expect(lineVariants(saved, [{ id: 'v2', name: 'L' }])).toEqual([{ id: 'v2', name: 'L' }, { id: 'v-old', name: 'M' }]);
  });
});

describe('cash row date (tester report 2026-10-20: the time of an edited row)', () => {
  it('day + time of the dialog are Africa/Algiers wall-clock (UTC+1)', () => {
    expect(cashDateIso('2026-10-19', '09:45')).toBe('2026-10-19T08:45:00.000Z');
    expect(cashDateIso('2026-10-20', '00:30')).toBe('2026-10-19T23:30:00.000Z');
  });
  it('an empty or partial time means noon', () => {
    expect(cashDateIso('2026-10-19', '')).toBe('2026-10-19T11:00:00.000Z');
    expect(cashDateIso('2026-10-19', '9:5')).toBe('2026-10-19T11:00:00.000Z');
  });
});
