// M7 pure rules: AT-GDS-16 weighted-average cost, AT-ORD-11 P&L (COGS, never purchases twice), 04 §19 variance %,
// GDS payment status, purchase transitions (04 §20).
import { deriveGdsPaymentStatus, inventoryNeedsNote, inventoryVariancePct, PURCHASE_STATUS_TRANSITIONS, weightedAverageCost } from '@djaber/shared';
import { printable } from './gds-document.pdf';
import { cogsOf, profitAndLoss } from './money-figures';
import { mergeDuplicateLines, remainingOf } from './purchase.service';

describe('journeys 16/11 J07-1 / J07-5 purchase money', () => {
  it('a purchase cancelled after a partial receipt still owes its received units; before any receipt or as a draft it owes nothing', () => {
    expect(remainingOf({ status: 'cancelled', total: 3300, amountPaid: 2000, items: [{ receivedQty: 3 }, { receivedQty: 0 }] })).toBe(1300);
    expect(remainingOf({ status: 'cancelled', total: 13500, amountPaid: 0, items: [{ receivedQty: 0 }] })).toBe(0);
    expect(remainingOf({ status: 'draft', total: 500, amountPaid: 0 })).toBe(0);
    expect(remainingOf({ status: 'partial', total: 500, amountPaid: 600 })).toBe(0);
  });
  it('a duplicate merges the lines split by a receipt at another cost (latest cost)', () => {
    expect(mergeDuplicateLines([
      { productId: 'a', variantId: null, quantity: 3, unitCost: 4000 },
      { productId: 'b', variantId: 'v', quantity: 1, unitCost: 10 },
      { productId: 'a', variantId: null, quantity: 2, unitCost: 4200 },
      { productId: 'b', variantId: 'w', quantity: 1, unitCost: 20 },
    ])).toEqual([
      { productId: 'a', variantId: null, quantity: 5, unitCost: 4200 },
      { productId: 'b', variantId: 'v', quantity: 1, unitCost: 10 },
      { productId: 'b', variantId: 'w', quantity: 1, unitCost: 20 },
    ]);
  });
});

describe('AT-GDS-16 weighted-average cost (04 §20, R-M)', () => {
  it('stock 10 at 100, receive 5 at 160 ⇒ 120', () => {
    expect(weightedAverageCost(10, 100, 5, 160)).toBe(120);
  });
  it('rounds half up to the integer DA', () => {
    // (3 × 100 + 1 × 101) / 4 = 100.25 → 100 ; (1 × 100 + 1 × 101) / 2 = 100.5 → 101
    expect(weightedAverageCost(3, 100, 1, 101)).toBe(100);
    expect(weightedAverageCost(1, 100, 1, 101)).toBe(101);
  });
  it('a null (unknown) cost takes the receipt cost (J07-2); empty stock takes the unit cost; negative stock counts as 0', () => {
    expect(weightedAverageCost(4, null, 4, 200)).toBe(200);
    expect(weightedAverageCost(0, 999, 6, 150)).toBe(150);
    expect(weightedAverageCost(-3, 500, 2, 80)).toBe(80);
  });
});

describe('AT-ORD-11 P&L (04 §4)', () => {
  it('purchase paid 800 (cash expense) and COGS 600 ⇒ net uses COGS, not both', () => {
    const p = profitAndLoss({ salesRevenue: 1000, ordersRevenue: 2000, cogs: 600, manualExpenses: 0, productExpenses: 0, returnCosts: 0, purchasesPaid: 800 });
    expect(p).toEqual({ revenue: 3000, cogs: 600, grossMargin: 2400, expenses: 0, net: 2400, purchasesPaid: 800 });
  });
  it('expenses = manual cash expenses + product expenses + return costs', () => {
    expect(profitAndLoss({ salesRevenue: 5000, ordersRevenue: 0, cogs: 2000, manualExpenses: 300, productExpenses: 200, returnCosts: 400, purchasesPaid: 9000 }).net).toBe(2100);
  });
  it('COGS = Σ quantity × cost snapshot (no cost ⇒ 0)', () => {
    expect(cogsOf([{ quantity: 2, costPrice: 300 }, { quantity: 1, costPrice: null }])).toBe(600);
  });
});

describe('04 §19 inventory variance', () => {
  it('|difference| / max(expected, 1), whole percent (AT-INV-02 "3 → 1 (66 %)"); the note rule reads the exact ratio', () => {
    expect(inventoryVariancePct(21, 18)).toBe(14);
    expect(inventoryVariancePct(3, 1)).toBe(66);
    expect(inventoryNeedsNote(200, 179)).toBe(true); // 10.5 % shown 10 %, still above 10 %
    expect(inventoryNeedsNote(10, 9)).toBe(false);
    expect(inventoryVariancePct(0, 2)).toBe(200);
    expect(inventoryVariancePct(10, 10)).toBe(0);
  });
});

describe('GDS payment status (04 §1.4 applied to sales / purchases)', () => {
  it.each([
    [0, 1000, 'unpaid'],
    [400, 1000, 'partial'],
    [1000, 1000, 'paid'],
    [1500, 1000, 'paid'],
    [0, 0, 'paid'],
  ] as const)('paid %i of %i ⇒ %s', (paid, total, status) => {
    expect(deriveGdsPaymentStatus(paid, total)).toBe(status);
  });
});

describe('04 §20 purchase transitions', () => {
  it('draft → pending → partial → received; cancel from draft / pending / partial only', () => {
    expect(PURCHASE_STATUS_TRANSITIONS.draft).toContain('pending');
    expect(PURCHASE_STATUS_TRANSITIONS.pending).toEqual(['partial', 'received', 'cancelled']);
    expect(PURCHASE_STATUS_TRANSITIONS.partial).toEqual(['received', 'cancelled']);
    expect(PURCHASE_STATUS_TRANSITIONS.received).toEqual([]);
    expect(PURCHASE_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('full-test 15/11 SALES-CASH-20: PDF text without the signs the fonts cannot draw', () => {
  it('drops emoji / dingbats, keeps Latin, Arabic, digits and punctuation', () => {
    expect(printable('QA sales-cash note ✓ ملاحظة 😀')).toBe('QA sales-cash note ملاحظة');
    expect(printable('Robe kabyle 👍🏽 · 4 900 DA')).toBe('Robe kabyle · 4 900 DA');
    expect(printable('Vente #VNT-1013 (remboursement) — Erreur de saisie')).toBe('Vente #VNT-1013 (remboursement) — Erreur de saisie');
  });
});
