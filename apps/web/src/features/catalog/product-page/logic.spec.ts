import { describe, expect, it } from 'vitest';
import type { Product } from '../contracts';
import { appealExpired, moderationView, qtyText, rejectedField, stockSummary, timelineTone, variantPatch } from './logic';

const detail = (o: Partial<NonNullable<Product['moderationDetail']>> = {}): NonNullable<Product['moderationDetail']> => ({
  status: 'rejected',
  submittedAt: '2026-10-05T09:12:00.000Z',
  decidedAt: '2026-10-05T10:30:00.000Z',
  decision: 'counterfeit',
  merchantMessage: 'Marque protégée.',
  rejectedFields: ['name', 'images.0'],
  rules: ['2.1'],
  history: [],
  appeal: { status: 'available', deadlineAt: '2026-10-12T10:30:00.000Z', decision: null },
  ...o,
});
const NOW = Date.parse('2026-10-06T00:00:00.000Z');

describe('moderationView', () => {
  it('falls back to the pill when the detail is absent', () => {
    expect(moderationView({ moderation: { status: 'pending' }, moderationDetail: null }).kind).toBe('pending');
    expect(moderationView({ moderation: { status: 'not_required' }, moderationDetail: null }).kind).toBe('none');
    expect(moderationView({ moderation: null, moderationDetail: null }).kind).toBe('none');
  });
  it('rejected with an open window can be appealed', () => {
    const v = moderationView({ moderation: { status: 'rejected' }, moderationDetail: detail() }, { now: NOW });
    expect(v).toMatchObject({ kind: 'rejected', canAppeal: true, decision: 'counterfeit', rejectedFields: ['name', 'images.0'] });
    expect(appealExpired(v, NOW)).toBe(false);
  });
  it('no second appeal: used ⇒ appealed, sent ⇒ appealed at once', () => {
    expect(moderationView({ moderation: { status: 'rejected' }, moderationDetail: detail({ appeal: { status: 'used', deadlineAt: null, decision: null } }) }, { now: NOW })).toMatchObject({ kind: 'appealed', canAppeal: false });
    expect(moderationView({ moderation: { status: 'rejected' }, moderationDetail: detail() }, { now: NOW, appealSent: true })).toMatchObject({ kind: 'appealed', canAppeal: false });
    expect(moderationView({ moderation: { status: 'appealed' }, moderationDetail: detail({ status: 'appealed' }) }, { now: NOW }).canAppeal).toBe(false);
  });
  it('expired window: no appeal, expired state', () => {
    const late = Date.parse('2026-10-13T00:00:00.000Z');
    const v = moderationView({ moderation: { status: 'rejected' }, moderationDetail: detail() }, { now: late });
    expect(v.canAppeal).toBe(false);
    expect(appealExpired(v, late)).toBe(true);
    expect(appealExpired(moderationView({ moderation: { status: 'rejected' }, moderationDetail: detail({ appeal: { status: 'expired', deadlineAt: null, decision: null } }) }), NOW)).toBe(true);
  });
  it('approved keeps the decision date', () => {
    expect(moderationView({ moderation: { status: 'approved' }, moderationDetail: detail({ status: 'approved', decision: null }) })).toMatchObject({ kind: 'approved', decidedAt: '2026-10-05T10:30:00.000Z' });
  });
});

describe('rejectedField', () => {
  it('maps the moderated fields', () => {
    expect(rejectedField('name')).toMatchObject({ field: 'title', index: null });
    expect(rejectedField('description').field).toBe('description');
    expect(rejectedField('price').field).toBe('price');
    expect(rejectedField('categoryId').field).toBe('category');
    expect(rejectedField('images.0')).toMatchObject({ field: 'image', index: 1 });
    expect(rejectedField('image:2')).toMatchObject({ field: 'image', index: 2 });
    expect(rejectedField('images')).toMatchObject({ field: 'image', index: null });
    expect(rejectedField('keywords')).toMatchObject({ field: null, raw: 'keywords' });
  });
});

describe('timelineTone', () => {
  it('colours by status', () => {
    expect(timelineTone('rejected')).toBe('danger');
    expect(timelineTone('auto_approved')).toBe('success');
    expect(timelineTone('appealed')).toBe('violet');
    expect(timelineTone('pending')).toBe('neutral');
  });
});

const variant = (name: string, stock: number, minStock: number, isActive = true) => ({
  id: name,
  name,
  sku: null,
  attributes: {},
  price: 100,
  costPrice: null,
  stock,
  minStock,
  isActive,
  stockState: (stock <= 0 ? 'out' : stock <= minStock ? 'low' : 'ok') as 'ok' | 'low' | 'out',
});
const DETAIL = { total: null, reserved: 0, availableForAi: 0, lastInventoryAt: null };

describe('stockSummary', () => {
  it('variant product: total, active variants, variants in alert', () => {
    const s = stockSummary({ trackStock: true, hasVariants: true, stock: 16, stockState: 'low', variants: [variant('50', 4, 5), variant('100', 12, 5), variant('set', 0, 2), variant('old', 0, 2, false)], stockDetail: { ...DETAIL, total: 16 } });
    expect(s).toEqual({ tracked: true, total: 16, variants: 3, alerts: 2 });
  });
  it('simple product and service', () => {
    expect(stockSummary({ trackStock: true, hasVariants: false, stock: 2, stockState: 'low', variants: [], stockDetail: DETAIL })).toEqual({ tracked: true, total: 2, variants: 0, alerts: 1 });
    expect(stockSummary({ trackStock: true, hasVariants: false, stock: 20, stockState: 'ok', variants: [], stockDetail: DETAIL }).alerts).toBe(0);
    expect(stockSummary({ trackStock: false, hasVariants: false, stock: null, stockState: 'untracked', variants: [], stockDetail: DETAIL })).toEqual({ tracked: false, total: 0, variants: 0, alerts: 0 });
  });
});

describe('variantPatch', () => {
  const current = { price: 2900, costPrice: 1500, minStock: 5 };
  it('sends only what changed', () => {
    expect(variantPatch(current, { price: '2900', costPrice: '1500', minStock: '5' }, true)).toEqual({ patch: {}, errors: {} });
    expect(variantPatch(current, { price: '3100', costPrice: '', minStock: '8' }, true)).toEqual({ patch: { price: 3100, costPrice: null, minStock: 8 }, errors: {} });
  });
  it('never touches the cost in simple mode', () => {
    expect(variantPatch(current, { price: '2900', costPrice: '', minStock: '5' }, false).patch).toEqual({});
  });
  it('price and threshold are required', () => {
    expect(variantPatch(current, { price: '', costPrice: '1500', minStock: '' }, true).errors).toEqual({ price: 'validation.price', minStock: 'validation.quantity' });
    expect(variantPatch(current, { price: '0', costPrice: '1500', minStock: '0' }, true)).toEqual({ patch: { minStock: 0 }, errors: { price: 'validation.price' } });
  });
});

describe('UX-050 quantities in the product unit', () => {
  const generic = (count: string) => `${count} u`;
  it('uses the unit abbreviation, the generic « u » only without a unit', () => {
    expect(qtyText('10', { abbreviation: 'pc' }, generic)).toBe('10 pc');
    expect(qtyText('10', { abbreviation: 'قطعة' }, generic)).toBe('10 قطعة');
    expect(qtyText('10', null, generic)).toBe('10 u');
    expect(qtyText('3', { abbreviation: '  ' }, generic)).toBe('3 u');
  });
});
