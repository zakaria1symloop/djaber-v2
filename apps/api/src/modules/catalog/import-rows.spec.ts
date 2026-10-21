// CAT-06 / FL-12 — pure part of the catalogue import.
import { autoMap, buildPreview, missingRequired, normalizeHeader, parseInteger, type ImportContext } from './import-rows';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  existingSkus: new Map(),
  units: new Set(['pc', 'pièce', 'kg']),
  categories: new Set(['maison']),
  freeSlots: Number.POSITIVE_INFINITY,
  limit: -1,
  current: 0,
  ...over,
});
const preview = (headers: string[], rows: string[][], over: Partial<ImportContext> = {}, updateExisting = false) =>
  buildPreview({ fileName: 'f.csv', headers, rows, mapping: autoMap(headers), updateExisting, ctx: ctx(over) });

describe('headers (FR / EN / AR aliases as V1)', () => {
  // the example file of the import wizard (web `importTemplateCsv`): every column is recognised in the three languages
  it.each([
    ['fr', ['SKU', 'Nom', 'Description', 'Catégorie', 'Unité', 'Prix', 'Ancien prix', 'Coût', 'Stock', 'Seuil', 'Poids', 'Mots-clés', 'Actif']],
    ['en', ['SKU', 'Name', 'Description', 'Category', 'Unit', 'Price', 'Old price', 'Cost price', 'Stock', 'Min stock', 'Weight', 'Keywords', 'Active']],
    ['ar', ['الرمز', 'الاسم', 'الوصف', 'الفئة', 'الوحدة', 'السعر', 'السعر القديم', 'التكلفة', 'المخزون', 'الحد الادنى', 'الوزن', 'الكلمات المفتاحية', 'نشط']],
  ])('example file headers (%s) map every field', (_l, headers) => {
    const m = autoMap(headers as string[]);
    expect(Object.keys(m).filter((k) => m[k as keyof typeof m]).sort()).toEqual(['costPrice', 'category', 'description', 'isActive', 'keywords', 'minStock', 'name', 'oldPrice', 'price', 'sku', 'stock', 'unit', 'weightGrams'].sort());
  });

  it('normalises accents, case and punctuation', () => {
    expect(normalizeHeader(' Prix d’achat ')).toBe('prixdachat');
    expect(normalizeHeader('Quantité (stock)')).toBe('quantitestock');
    expect(normalizeHeader('الاسم')).toBe('الاسم');
  });

  it.each([
    [['Référence', 'Désignation', 'Prix', 'Qté'], { sku: 'Référence', name: 'Désignation', price: 'Prix', stock: 'Qté' }],
    [
      ['sku', 'name', 'selling price', 'cost price', 'quantity', 'category', 'unit'],
      { sku: 'sku', name: 'name', price: 'selling price', costPrice: 'cost price', stock: 'quantity', category: 'category', unit: 'unit' },
    ],
    [['الاسم', 'السعر', 'الكمية'], { name: 'الاسم', price: 'السعر', stock: 'الكمية' }],
    [
      ['Nom', 'Prix de vente', 'Prix d achat', 'Stock min', 'Poids', 'Mots clés', 'Actif'],
      { name: 'Nom', price: 'Prix de vente', costPrice: 'Prix d achat', minStock: 'Stock min', weightGrams: 'Poids', keywords: 'Mots clés', isActive: 'Actif' },
    ],
  ])('maps %j', (headers, expected) => {
    expect(autoMap(headers)).toEqual(expected);
  });

  it('name and price are the required columns', () => {
    expect(missingRequired(autoMap(['Référence', 'Qté']))).toEqual(['name', 'price']);
    expect(missingRequired(autoMap(['Nom', 'Qté']))).toEqual(['price']);
    expect(missingRequired(autoMap(['Nom', 'Prix']))).toEqual([]);
  });

  it('a header feeds one field only', () => {
    expect(autoMap(['Prix', 'Prix'])).toEqual({ price: 'Prix' });
  });
});

describe('amounts and quantities', () => {
  it.each([
    ['12500', 12500],
    ['12 500', 12500],
    ['12 500 DA', 12500],
    ['12.500', 12500],
    ['12,500.00', 12500],
    ['1500,00', 1500],
    ['2.0', 2],
    ['0', 0],
    ['-3', -3],
    ['1 200 د.ج', 1200],
  ])('%s → %s', (raw, expected) => {
    expect(parseInteger(raw)).toBe(expected);
  });
  it.each(['', 'gratuit', '12,5', '9.99', '1e3', '12 500 €'])('%s is not an integer amount', (raw) => {
    expect(parseInteger(raw)).toBeNull();
  });
});

describe('preview', () => {
  const headers = ['sku', 'nom', 'prix', 'cout', 'stock', 'categorie', 'unite', 'actif'];

  it('valid rows carry parsed values; line numbers are those of the file', () => {
    const r = preview(headers, [
      ['A-1', 'Tapis', '12 500', '8000', '4', 'Maison', 'pc', 'oui'],
      ['', 'Vase', '900', '', '', 'Déco', '', 'non'],
    ]);
    expect(r.totals).toEqual({ rows: 2, valid: 2, invalid: 0, create: 2, update: 0, overPlanLimit: 0, newCategories: 1 });
    expect(r.rows[0]).toEqual({
      row: 2,
      ok: true,
      action: 'create',
      errors: [],
      values: { sku: 'A-1', name: 'Tapis', price: 12500, costPrice: 8000, stock: 4, category: 'Maison', unit: 'pc', isActive: true },
    });
    expect(r.rows[1]!.values).toEqual({ sku: null, name: 'Vase', price: 900, costPrice: null, stock: 0, category: 'Déco', unit: null, isActive: false });
  });

  it('row errors: required, price, quantity, unknown unit, bad flag', () => {
    const r = preview(headers, [['', '', '0', '-1', '1,5', '', 'carton', 'peut-être']]);
    expect(r.rows[0]).toMatchObject({ ok: false, action: 'skip' });
    expect(r.rows[0]!.errors).toEqual([
      { field: 'name', code: 'validation.required' },
      { field: 'price', code: 'validation.price' },
      { field: 'costPrice', code: 'validation.price' },
      { field: 'stock', code: 'validation.quantity' },
      { field: 'isActive', code: 'validation.invalid' },
      { field: 'unit', code: 'validation.invalid' },
    ]);
    expect(r.totals).toMatchObject({ valid: 0, invalid: 1 });
  });

  it('duplicate SKU in the file points at the first row; a SKU of the catalogue is an error unless updateExisting', () => {
    const rows = [
      ['A', 'Un', '10', '', '', '', '', ''],
      ['A', 'Deux', '10', '', '', '', '', ''],
      ['B', 'Trois', '10', '', '', '', '', ''],
      ['V', 'Quatre', '10', '', '', '', '', ''],
    ];
    const existing = new Map<string, 'product' | 'variant'>([
      ['B', 'product'],
      ['V', 'variant'],
    ]);
    const strict = preview(headers, rows, { existingSkus: existing });
    expect(strict.rows.map((x) => x.errors.map((e) => e.code))).toEqual([[], ['IMPORT_DUPLICATE_SKU_IN_FILE'], ['PRODUCT_SKU_ALREADY_EXISTS'], ['PRODUCT_SKU_ALREADY_EXISTS']]);
    expect(strict.rows[1]!.errors[0]).toEqual({ field: 'sku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: 2 } });
    const lenient = preview(headers, rows, { existingSkus: existing }, true);
    expect(lenient.rows.map((x) => x.action)).toEqual(['create', 'skip', 'update', 'skip']); // a variant SKU is never updated by a product row
    expect(lenient.totals).toMatchObject({ valid: 2, create: 1, update: 1, invalid: 2 });
  });

  it('plan limit: rows beyond the free slots are refused in file order; updates and invalid rows use no slot', () => {
    const rows = [
      ['', 'Un', '10', '', '', '', '', ''],
      ['', '', '10', '', '', '', '', ''],
      ['E', 'Existant', '10', '', '', '', '', ''],
      ['', 'Deux', '10', '', '', '', '', ''],
      ['', 'Trois', '10', '', '', '', '', ''],
    ];
    const r = preview(headers, rows, { freeSlots: 2, limit: 50, current: 48, existingSkus: new Map([['E', 'product']]) }, true);
    expect(r.rows.map((x) => x.action)).toEqual(['create', 'skip', 'update', 'create', 'skip']);
    expect(r.rows[4]!.errors).toEqual([{ field: null, code: 'PLAN_LIMIT', params: { resource: 'products', limit: 50, current: 48 } }]);
    expect(r.totals).toMatchObject({ valid: 3, invalid: 2, create: 2, update: 1, overPlanLimit: 1 });
  });

  it('only mapped columns appear in the values; keywords are split', () => {
    const r = preview(['nom', 'prix', 'tags'], [['Tapis', '100', 'laine; berbère | salon,']]);
    expect(r.rows[0]!.values).toEqual({ name: 'Tapis', price: 100, keywords: 'laine, berbère, salon' });
  });
});
