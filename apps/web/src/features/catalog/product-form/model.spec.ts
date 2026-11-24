// Product form model: form ↔ payload mappers against the shared strict schemas, keywords, dirty labels, rebase,
// server field paths, AI-fill merge (AT-CAT-01, AT-CAT-10).
import { CreateProductSchema, CreateVariantSchema, UpdateProductSchema, UpdateVariantSchema } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import type { Product } from '../contracts';
import {
  attributeHints,
  changedScalars,
  dirtyItems,
  dirtyLabels,
  emptyForm,
  emptyVariantRow,
  mergeAiFill,
  parseKeywords,
  productFormSchema,
  rebaseForm,
  rejectedFieldSet,
  serverFieldTarget,
  targetPath,
  toCreatePayload,
  toForm,
  toUpdatePayload,
  variantCreatePayload,
  variantUpdatePayload,
  type ProductFormValues,
} from './model';

const CAT = '018f0000-0000-7000-8000-00000000c001';
const UNIT = '018f0000-0000-7000-8000-00000000d001';
const product = (o: Partial<Product> = {}): Product =>
  ({
    id: '018f0000-0000-7000-8000-00000000a001',
    sku: 'RS',
    name: 'La Robe satin',
    category: { id: CAT, name: 'Vêtements', color: '#a78bfa' },
    unit: { id: UNIT, abbreviation: 'pce' },
    price: 4900,
    oldPrice: 5900,
    costPrice: 5200,
    marginPct: -6,
    trackStock: true,
    stock: 14,
    minStock: 2,
    stockState: 'ok',
    hasVariants: true,
    variantSummary: null,
    isActive: true,
    archived: false,
    primaryImageUrl: null,
    aiState: 'proposed',
    moderation: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    actions: [],
    description: 'Robe longue en satin',
    weightGrams: 350,
    keywords: ['robe', 'satin', 'فستان'],
    images: [],
    variants: [
      { id: 'v1', name: 'Noir · S', sku: null, attributes: { Couleur: 'Noir', Taille: 'S' }, price: 4900, costPrice: null, stock: 6, minStock: 2, isActive: true, stockState: 'ok' },
      { id: 'v2', name: 'Noir · M', sku: 'RS-NM', attributes: {}, price: 4900, costPrice: 3000, stock: 1, minStock: 2, isActive: true, stockState: 'low' },
    ],
    stockDetail: { total: 14, reserved: 0, availableForAi: 14, lastInventoryAt: null },
    pricing: { weightedCost: null, expensesPerUnit: 0, trueCost: null, marginDzd: null, marginPct: null, sales30d: { units: 0, revenue: 0 } },
    agents: [],
    mentions30d: { conversations: 0, orders: 0 },
    moderationDetail: null,
    contentVersion: 1,
    version: 7,
    ...o,
  }) as Product;
const filled = (o: Partial<ProductFormValues> = {}): ProductFormValues => ({ ...emptyForm(), name: ' Parfum Oud ', price: '4500', stock: '12', ...o });
const issues = (mode: 'create' | 'edit', v: ProductFormValues) => {
  const r = productFormSchema(mode).safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('parseKeywords', () => {
  it('splits on commas (Latin and Arabic), semicolons and line breaks, trims and dedupes', () => {
    expect(parseKeywords('robe, satin،  soirée ; Robe\nفستان,,')).toEqual(['robe', 'satin', 'soirée', 'فستان']);
    expect(parseKeywords('  ')).toEqual([]);
  });
});

describe('form schema (shared primitives, validation.* keys)', () => {
  it('AT-CAT-01 refuses a selling price of 0 with validation.price and an empty one as required', () => {
    expect(issues('create', filled({ price: '0' }))).toEqual({ price: 'validation.price' });
    expect(issues('create', filled({ price: '' }))).toEqual({ price: 'validation.required' });
  });
  it('create: empty SKU allowed, opening stock required for a tracked product without variants', () => {
    expect(issues('create', filled())).toEqual({});
    expect(issues('create', filled({ stock: '' }))).toEqual({ stock: 'validation.required' });
    expect(issues('create', filled({ stock: '', trackStock: false }))).toEqual({});
    expect(issues('create', filled({ stock: '', variants: [emptyVariantRow({ name: 'S', price: '100' })] }))).toEqual({});
  });
  it('edit: SKU required, stock never required', () => {
    expect(issues('edit', filled({ sku: ' ', stock: '' }))).toEqual({ sku: 'validation.required' });
  });
  // UX-089 (Houssem live 24/11, client list L75): a product at −15 (orders taken at zero stock) could not be saved — « Validation : 1 erreur —
  // stock initial » on a field that is read-only on edit
  it('edit: a stock below zero is never an error (read-only: it only moves through adjustments); create still refuses it', () => {
    expect(issues('edit', filled({ sku: 'A-1', stock: '-15', sellOutOfStock: false }))).toEqual({});
    expect(issues('edit', filled({ sku: 'A-1', stock: '', variants: [emptyVariantRow({ id: 'v1', name: 'S', price: '100', stock: '-3' })] }))).toEqual({});
    expect(Object.keys(issues('edit', filled({ sku: 'A-1', stock: '', variants: [emptyVariantRow({ name: 'S', price: '100', stock: '-3' })] })))).toEqual(['variants.0.stock']);
    expect(Object.keys(issues('create', filled({ stock: '-15' })))).toEqual(['stock']);
  });
  it('limits: name 255, description 5000, keywords 30 × 50, weight range', () => {
    expect(issues('create', filled({ name: 'x'.repeat(256) }))).toEqual({ name: 'validation.length' });
    expect(issues('create', filled({ description: 'x'.repeat(5001) }))).toEqual({ description: 'validation.length' });
    expect(issues('create', filled({ keywords: 'k'.repeat(51) }))).toEqual({ keywords: 'validation.length' });
    expect(issues('create', filled({ keywords: Array.from({ length: 31 }, (_, i) => `k${i}`).join(',') }))).toEqual({ keywords: 'validation.keywords_count' });
    expect(issues('create', filled({ weightGrams: '1000001' }))).toEqual({ weightGrams: 'validation.range' });
  });
  it('old price above the selling price (full-test 15/11 PRODUCTS-09)', () => {
    expect(issues('create', filled({ price: '4600', oldPrice: '3000' }))).toEqual({ oldPrice: 'validation.old_price' });
    expect(issues('create', filled({ price: '4600', oldPrice: '4600' }))).toEqual({ oldPrice: 'validation.old_price' });
    expect(issues('create', filled({ price: '4600', oldPrice: '5500' }))).toEqual({});
  });
  it('variant rows: name and price required, duplicate names flagged on the second row', () => {
    const rows = [emptyVariantRow({ name: 'Noir', price: '100' }), emptyVariantRow({ name: ' noir ', price: '100' }), emptyVariantRow({ name: '', price: '0' })];
    expect(issues('create', filled({ variants: rows }))).toEqual({ 'variants.1.name': 'validation.invalid', 'variants.2.name': 'validation.required', 'variants.2.price': 'validation.price' });
  });
});

describe('toCreatePayload', () => {
  it('builds a body the strict shared schema accepts, with nothing extra', () => {
    const body = toCreatePayload(filled({ sku: '', keywords: 'oud, musc', description: ' Bois ', categoryId: CAT, unitId: UNIT, oldPrice: '5000', costPrice: '2400', minStock: '3', weightGrams: '350' }), { advanced: true });
    expect(body).toEqual({ name: 'Parfum Oud', price: 4500, trackStock: true, isActive: true, description: 'Bois', categoryId: CAT, unitId: UNIT, oldPrice: 5000, costPrice: 2400, weightGrams: 350, keywords: ['oud', 'musc'], stock: 12, minStock: 3 });
    expect(CreateProductSchema.safeParse(body).success).toBe(true);
  });
  it('simple mode never sends a cost; a service sends neither stock nor variants', () => {
    const body = toCreatePayload(filled({ costPrice: '2400', trackStock: false, stock: '5', minStock: '1' }), { advanced: false });
    expect(body).toEqual({ name: 'Parfum Oud', price: 4500, trackStock: false, isActive: true });
    expect(CreateProductSchema.safeParse(body).success).toBe(true);
  });
  it('variant product: rows travel, product stock does not', () => {
    const rows = [emptyVariantRow({ name: ' Noir · S ', price: '4900', stock: '6', minStock: '2', sku: ' RS-NS ', attributes: { Couleur: 'Noir' } }), emptyVariantRow({ name: 'Noir · M', price: '4900', costPrice: '3000', isActive: false })];
    const body = toCreatePayload(filled({ stock: '', variants: rows }), { advanced: true });
    expect(body.stock).toBeUndefined();
    expect(body.variants).toEqual([
      { name: 'Noir · S', price: 4900, sku: 'RS-NS', attributes: { Couleur: 'Noir' }, stock: 6, minStock: 2 },
      { name: 'Noir · M', price: 4900, costPrice: 3000, isActive: false },
    ]);
    expect(CreateProductSchema.safeParse(body).success).toBe(true);
    for (const v of body.variants!) expect(CreateVariantSchema.safeParse(v).success).toBe(true);
  });
  it('journey J02r-1: a product sold by variant needs no base price; it takes the lowest variant price and no old price', () => {
    const rows = [emptyVariantRow({ name: 'S', price: '1600' }), emptyVariantRow({ name: 'M', price: '1500' })];
    expect(issues('create', filled({ price: '', oldPrice: '900', stock: '', variants: rows }))).toEqual({});
    const body = toCreatePayload(filled({ price: '', oldPrice: '900', stock: '', variants: rows }), { advanced: true });
    expect(body).toMatchObject({ price: 1500 });
    expect(body.oldPrice).toBeUndefined();
    expect(CreateProductSchema.safeParse(body).success).toBe(true);
  });
});

describe('toForm / toUpdatePayload', () => {
  it('maps the DTO to strings', () => {
    const f = toForm(product());
    expect(f).toMatchObject({ name: 'La Robe satin', sku: 'RS', keywords: 'robe, satin, فستان', price: '4900', oldPrice: '5900', costPrice: '5200', stock: '14', minStock: '2', categoryId: CAT, unitId: UNIT, weightGrams: '350', trackStock: true, isActive: true });
    expect(f.variants.map((v) => [v.id, v.name, v.sku, v.price, v.costPrice, v.stock])).toEqual([
      ['v1', 'Noir · S', '', '4900', '', '6'],
      ['v2', 'Noir · M', 'RS-NM', '4900', '3000', '1'],
    ]);
    expect(toForm(product({ category: null, unit: null, description: null, weightGrams: null, oldPrice: null, costPrice: null, stock: null, trackStock: false }))).toMatchObject({ categoryId: '', unitId: '', description: '', weightGrams: '', oldPrice: '', costPrice: '', stock: '' });
  });
  it('sends only the changed fields with the version; cleared optionals become null', () => {
    const base = toForm(product());
    expect(toUpdatePayload(base, base, 7, { advanced: true })).toEqual({ version: 7 });
    const next = { ...base, costPrice: '5000', oldPrice: '', description: '  ', categoryId: '', keywords: 'robe, satin', weightGrams: '', isActive: false, stock: '999' };
    const body = toUpdatePayload(base, next, 7, { advanced: true });
    expect(body).toEqual({ version: 7, costPrice: 5000, oldPrice: null, description: null, categoryId: null, keywords: ['robe', 'satin'], weightGrams: null, isActive: false });
    expect(UpdateProductSchema.safeParse(body).success).toBe(true);
    expect(toUpdatePayload(base, { ...base, costPrice: '1' }, 7, { advanced: false })).toEqual({ version: 7 });
    expect(changedScalars(base, { ...base, keywords: 'robe,satin , فستان', name: 'La Robe satin ' })).toEqual([]);
  });
  it('variant payloads satisfy the strict variant schemas', () => {
    const [a, b] = toForm(product()).variants as [ReturnType<typeof emptyVariantRow>, ReturnType<typeof emptyVariantRow>];
    expect(variantUpdatePayload(a, a, { advanced: true })).toEqual({});
    const body = variantUpdatePayload(b, { ...b, price: '5100', sku: '', costPrice: '', minStock: '4', isActive: false, stock: '50' }, { advanced: true });
    expect(body).toEqual({ price: 5100, sku: null, costPrice: null, minStock: 4, isActive: false });
    expect(UpdateVariantSchema.safeParse(body).success).toBe(true);
    const created = variantCreatePayload(emptyVariantRow({ name: 'Rouge · M', price: '4900', costPrice: '100' }), { advanced: false });
    expect(created).toEqual({ name: 'Rouge · M', price: 4900 });
    expect(CreateVariantSchema.safeParse(created).success).toBe(true);
  });
});

describe('dirty fields', () => {
  const label = { field: (f: string) => `f:${f}`, variant: (n: string) => `v:${n}` };
  it('lists the changed fields then the changed / new variants (frame: "prix de revient, variante Noir · M")', () => {
    const base = toForm(product());
    const next = { ...base, costPrice: '5000', variants: [base.variants[0]!, { ...base.variants[1]!, minStock: '5' }, emptyVariantRow({ name: 'Rouge · M' })] };
    const items = dirtyItems(base, next, 'edit');
    expect(dirtyLabels(items, label)).toEqual(['f:costPrice', 'v:Noir · M', 'v:Rouge · M']);
    expect(dirtyItems(base, { ...base, stock: '99', variants: base.variants.map((v) => ({ ...v, stock: '99' })) }, 'edit')).toEqual([]);
    expect(dirtyItems(base, base, 'edit')).toEqual([]);
  });
  it('create: the opening stock counts, long lists are cut', () => {
    const base = emptyForm();
    expect(dirtyItems(base, { ...base, stock: '3' }, 'create')).toEqual([{ kind: 'field', field: 'stock' }]);
    const many = dirtyItems(base, { ...base, name: 'a', sku: 'b', price: '1', oldPrice: '2', costPrice: '3', stock: '4' }, 'create');
    expect(dirtyLabels(many, label, 4)).toEqual(['f:name', 'f:sku', 'f:price', 'f:oldPrice', '…']);
  });
});

describe('rebaseForm (fresh server version under an open form)', () => {
  it('untouched fields follow the server, edited ones stay; server stock always wins', () => {
    const old = toForm(product());
    const mine = { ...old, name: 'Robe satin longue', variants: [{ ...old.variants[0]!, price: '5000' }, old.variants[1]!, emptyVariantRow({ name: 'Rouge · M', price: '4900' })] };
    const server = toForm(
      product({
        price: 5200,
        name: 'Renommé ailleurs',
        stock: 20,
        variants: [
          { id: 'v1', name: 'Noir · S', sku: null, attributes: {}, price: 4900, costPrice: null, stock: 9, minStock: 3, isActive: true, stockState: 'ok' },
          { id: 'v3', name: 'Bleu · L', sku: null, attributes: {}, price: 4900, costPrice: null, stock: 0, minStock: 0, isActive: true, stockState: 'out' },
        ],
      }),
    );
    const out = rebaseForm(old, server, mine);
    expect(out.name).toBe('Robe satin longue');
    expect(out.price).toBe('5200');
    expect(out.stock).toBe('20');
    expect(out.variants.map((v) => [v.id, v.name, v.price, v.stock, v.minStock])).toEqual([
      ['v1', 'Noir · S', '5000', '9', '3'],
      ['v3', 'Bleu · L', '4900', '0', '0'],
      [null, 'Rouge · M', '4900', '', ''],
    ]);
    // the result is exactly the edits when compared with the new baseline
    expect(dirtyItems(server, out, 'edit').map((i) => (i.kind === 'field' ? i.field : i.name))).toEqual(['name', 'Noir · S', 'Rouge · M']);
  });
  it('a row created by this form (id set after the call) is not a duplicate nor dirty', () => {
    const old = toForm(product());
    const mine = { ...old, variants: [...old.variants, { ...emptyVariantRow({ name: 'Rouge · M', price: '4900' }), id: 'v9' }] };
    const server = toForm(product({ variants: [...product().variants, { id: 'v9', name: 'Rouge · M', sku: 'AUTO-1', attributes: {}, price: 4900, costPrice: null, stock: 0, minStock: 0, isActive: true, stockState: 'out' }] }));
    const out = rebaseForm(old, server, mine);
    expect(out.variants).toHaveLength(3);
    expect(out.variants[2]).toMatchObject({ id: 'v9', sku: 'AUTO-1', key: 'v9' });
    // the saved row is part of the new baseline: nothing is left "unsaved" after the save
    expect(dirtyItems(server, out, 'edit')).toEqual([]);
  });
  it('after a save that created variants and changed a field, the form is clean against the fresh server version', () => {
    const old = toForm(product());
    const mine = { ...old, price: '5100', variants: [...old.variants, { ...emptyVariantRow({ name: 'Rouge · M', price: '4900' }), id: 'v9' }, { ...emptyVariantRow({ name: 'Vert · L', price: '4900' }), id: 'v10' }] };
    const server = toForm(
      product({
        price: 5100,
        variants: [
          ...product().variants,
          { id: 'v9', name: 'Rouge · M', sku: null, attributes: {}, price: 4900, costPrice: null, stock: 0, minStock: 0, isActive: true, stockState: 'out' },
          { id: 'v10', name: 'Vert · L', sku: null, attributes: {}, price: 4900, costPrice: null, stock: 0, minStock: 0, isActive: true, stockState: 'out' },
        ],
      }),
    );
    expect(dirtyItems(server, rebaseForm(old, server, mine), 'edit')).toEqual([]);
  });
  it('a row whose creation failed stays unsaved after the rebase', () => {
    const old = toForm(product());
    const failed = emptyVariantRow({ name: 'Rouge · M', price: '4900' });
    const mine = { ...old, variants: [...old.variants, failed] };
    const out = rebaseForm(old, old, mine);
    expect(dirtyItems(old, out, 'edit')).toEqual([{ kind: 'variant', key: failed.key, name: 'Rouge · M' }]);
  });
});

describe('server field paths', () => {
  it('maps product fields and variant rows, ignores the rest', () => {
    expect(serverFieldTarget('sku')).toEqual({ kind: 'field', field: 'sku' });
    expect(serverFieldTarget('variants.2.sku', 3)).toEqual({ kind: 'variant', index: 2, field: 'sku' });
    expect(targetPath(serverFieldTarget('variants[1].name', 3)!)).toBe('variants.1.name');
    expect(serverFieldTarget('variants.3.sku', 3)).toBeNull();
    expect(serverFieldTarget('variants.0.attributes', 3)).toBeNull();
    expect(serverFieldTarget('file')).toBeNull();
    expect(serverFieldTarget('version')).toBeNull();
  });
});

describe('AI fill (AT-CAT-10)', () => {
  const known = { categoryIds: [CAT], unitIds: [UNIT] };
  it('fills only the empty fields and never the price', () => {
    const v = filled({ name: 'Mon nom', description: '', price: '', categoryId: '', unitId: UNIT });
    const result = { name: 'Robe en satin', description: ' Robe longue ', categoryId: CAT, unitId: 'other', attributes: null, filled: [], price: 4900 } as never;
    const { patch, filled: done } = mergeAiFill(v, result, known);
    expect(patch).toEqual({ description: 'Robe longue', categoryId: CAT });
    expect(done).toEqual(['description', 'categoryId']);
    expect(Object.keys(patch)).not.toContain('price');
  });
  it('ignores unknown ids, nulls and an empty answer', () => {
    expect(mergeAiFill(emptyForm(), { name: null, description: null, categoryId: 'nope', unitId: null, attributes: null, filled: [] }, known)).toEqual({ patch: {}, filled: [] });
    expect(mergeAiFill(emptyForm(), null, known).filled).toEqual([]);
    expect(mergeAiFill(emptyForm(), { name: 'x'.repeat(300) }, known).patch.name).toHaveLength(255);
  });
  it('turns suggested attributes into generator lines', () => {
    expect(attributeHints({ Taille: ['S', 'M'], Couleur: 'Noir', Vide: [] })).toEqual(['Taille : S, M', 'Couleur : Noir']);
    expect(attributeHints(null)).toEqual([]);
  });
});

describe('moderation rejected fields', () => {
  it('normalises the names used by the decision', () => {
    expect([...rejectedFieldSet(['title', 'Image 1', 'description', 'price', 'categoryId', 'unknown'])]).toEqual(['name', 'images', 'description', 'price', 'categoryId']);
    expect(rejectedFieldSet(null).size).toBe(0);
  });
});
