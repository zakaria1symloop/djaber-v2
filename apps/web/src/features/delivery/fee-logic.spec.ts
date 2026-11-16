import { describe, expect, it } from 'vitest';
import type { FeeRule } from './contracts';
import { canReset, filterRows, freeRule, isChange, rowBody, seedCount, thresholdOnToggle } from './fee-logic';

const row = (over: Partial<FeeRule> = {}): FeeRule => ({
  wilayaId: 19,
  code: '19',
  nameFr: 'Sétif',
  nameAr: 'سطيف',
  homePrice: 400,
  stopdeskPrice: 250,
  returnPrice: 200,
  freeAbove: null,
  isActive: true,
  source: 'default',
  courierCost: null,
  actions: [],
  ...over,
});

describe('fee grid diff', () => {
  it('sends the full row with the edited value', () => {
    expect(rowBody(row(), { homePrice: 450 })).toEqual({ homePrice: 450, stopdeskPrice: 250, returnPrice: 200, isActive: true });
  });
  it('toggling active keeps the prices', () => {
    expect(rowBody(row({ homePrice: 1500 }), { isActive: false })).toEqual({ homePrice: 1500, stopdeskPrice: 250, returnPrice: 200, isActive: false });
  });
  it('keeps a per-wilaya threshold and clears it explicitly', () => {
    expect(rowBody(row({ freeAbove: 10_000 }), { homePrice: 300 }).freeAbove).toBe(10_000);
    expect(rowBody(row({ freeAbove: 10_000 }), { freeAbove: null }).freeAbove).toBeNull();
    expect('freeAbove' in rowBody(row(), { homePrice: 300 })).toBe(false);
  });
  it('detects real changes only', () => {
    expect(isChange(row(), 'homePrice', 400)).toBe(false);
    expect(isChange(row(), 'homePrice', 401)).toBe(true);
    expect(isChange(row(), 'homePrice', -1)).toBe(false);
    expect(isChange(row(), 'homePrice', 1.5)).toBe(false);
  });
  it('offers reset on custom rows only', () => {
    expect(canReset(row())).toBe(false);
    expect(canReset(row({ source: 'custom' }))).toBe(true);
  });
});

describe('wilaya search', () => {
  const rows = [row(), row({ wilayaId: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر' }), row({ wilayaId: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة' })];
  it('matches code, accent-insensitive French name and Arabic name', () => {
    expect(filterRows(rows, 'setif').map((r) => r.code)).toEqual(['19']);
    expect(filterRows(rows, '09').map((r) => r.code)).toEqual(['09']);
    expect(filterRows(rows, '9').map((r) => r.code)).toEqual(['09']);
    expect(filterRows(rows, 'الجزائر').map((r) => r.code)).toEqual(['16']);
    expect(filterRows(rows, '  ')).toHaveLength(3);
  });
});

describe('free-delivery rule', () => {
  it('maps the workspace threshold', () => {
    expect(freeRule(null)).toEqual({ enabled: false, amount: null });
    expect(freeRule(5000)).toEqual({ enabled: true, amount: 5000 });
  });
  it('switching on reuses the last value or 5 000, off sends null', () => {
    expect(thresholdOnToggle(true, null)).toBeUndefined();
    expect(thresholdOnToggle(true, 8000)).toBe(8000);
    expect(thresholdOnToggle(false, 8000)).toBeNull();
  });
});

describe('seed outcome', () => {
  it('uses written when given, else the difference', () => {
    expect(seedCount({ missing: 12, custom: 3 }, { missing: 0, custom: 3, written: 12 }, false)).toBe(12);
    expect(seedCount({ missing: 12, custom: 3 }, { missing: 0, custom: 3 }, false)).toBe(12);
    expect(seedCount({ missing: 2, custom: 3 }, { missing: 0, custom: 0 }, true)).toBe(5);
  });
});
