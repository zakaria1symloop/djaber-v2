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

  it('full-test 15/11 PRODUCTS-11 / -09: a decimal price is « not a whole number », an old price at or under the price is refused', () => {
    const r = preview(headers, [['A', 'Tapis', '1999.5', '', '', '', '', '']]);
    expect(r.rows[0]!.errors).toEqual([{ field: 'price', code: 'validation.price_integer' }]);
    const old = preview(['Nom', 'Prix', 'Ancien prix'], [['Robe', '4600', '3000'], ['Jupe', '4600', '5500']]);
    expect(old.rows[0]!.errors).toEqual([{ field: 'oldPrice', code: 'validation.old_price' }]);
    expect(old.rows[1]!.errors).toEqual([]);
  });

  it('journey J02-2: a price, cost, old price or stock above the form maximum is refused with the bound', () => {
    const r = preview(['Nom', 'Prix', 'Ancien prix', 'Prix d achat', 'Stock', 'Poids'], [
      ['Lustre', '1000000000', '', '', '1', ''],
      ['Lustre 2', '100000000', '200000000', '100000001', '10000001', '1000001'],
      ['Lustre 3', '100 000 000', '', '', '10000000', '1000000'],
    ]);
    expect(r.rows[0]!.errors).toEqual([{ field: 'price', code: 'validation.price_max' }]);
    expect(r.rows[1]!.errors).toEqual([
      { field: 'oldPrice', code: 'validation.price_max' },
      { field: 'costPrice', code: 'validation.price_max' },
      { field: 'stock', code: 'validation.quantity_max' },
      { field: 'weightGrams', code: 'validation.range', params: { min: 0, max: expect.stringMatching(/^1\s000\s000$/) } },
    ]);
    expect(r.rows[2]!.errors).toEqual([]);
    expect(r.totals).toMatchObject({ valid: 1, invalid: 2 });
  });

  it('retest 11/11 UX-054: a value that is not a number is kept as typed for the error screen and file', () => {
    const r = preview(headers, [['A', 'Tapis', 'abc', '12x', '-3', '', '', '']]);
    expect(r.rows[0]!.values).toMatchObject({ price: 'abc', costPrice: '12x', stock: -3 });
    expect(r.rows[0]!.errors.map((e) => e.field)).toEqual(['price', 'costPrice', 'stock']);
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

describe('client list L77 / L78: products export → import round trip', () => {
  // the headers of the products export (product.service PRODUCT_HEADERS), in their column order
  const fr = ['SKU', 'Nom', 'Variante', 'SKU variante', 'Catégorie', 'Unité', 'Prix', 'Ancien prix', 'Coût', 'Stock', 'Seuil', 'Suivi du stock', 'Vente en rupture', 'Actif', 'Description', 'Poids (g)', 'Mots-clés'];
  const en = ['SKU', 'Name', 'Variant', 'Variant SKU', 'Category', 'Unit', 'Price', 'Old price', 'Cost', 'Stock', 'Threshold', 'Track stock', 'Sell out of stock', 'Active', 'Description', 'Weight (g)', 'Keywords'];
  const ar = ['SKU', 'الاسم', 'المتغيّر', 'SKU المتغيّر', 'الفئة', 'الوحدة', 'السعر', 'السعر القديم', 'التكلفة', 'المخزون', 'الحد الأدنى', 'تتبع المخزون', 'البيع عند نفاد المخزون', 'نشط', 'الوصف', 'الوزن (غ)', 'الكلمات المفتاحية'];
  const every = ['sku', 'name', 'variant', 'variantSku', 'category', 'unit', 'price', 'oldPrice', 'costPrice', 'stock', 'minStock', 'trackStock', 'sellOutOfStock', 'isActive', 'description', 'weightGrams', 'keywords'];
  it.each([
    ['fr', fr],
    ['en', en],
    ['ar', ar],
  ])('the export headers (%s) map every field, column by column', (_l, headers) => {
    const m = autoMap(headers);
    expect(headers.map((h) => Object.entries(m).find(([, v]) => v === h)?.[0])).toEqual(every);
  });

  const row = (o: Partial<Record<string, string>>) => fr.map((h) => o[h] ?? '');
  const robe = [
    row({ SKU: 'ROBE', Nom: 'Robe', Catégorie: 'Robes', Prix: '4000', Coût: '2000', Seuil: '2', 'Suivi du stock': 'Oui', 'Vente en rupture': 'Oui', Actif: 'Oui', Description: 'Brodée', 'Poids (g)': '800', 'Mots-clés': 'robe, fête' }),
    row({ SKU: 'ROBE', Nom: 'Robe', Variante: 'S', 'SKU variante': 'ROBE-S', Prix: '4000', Stock: '-2', Seuil: '1', Actif: 'Oui' }),
    row({ SKU: 'ROBE', Nom: 'Robe', Variante: 'M', 'SKU variante': 'ROBE-M', Prix: '4200', Stock: '5', Actif: 'Non' }),
  ];
  const service = row({ SKU: 'SRV', Nom: 'Retouche', Prix: '500', 'Suivi du stock': 'Non', 'Vente en rupture': 'Non', Actif: 'Oui' });

  it('rows of one SKU are a product and its variants, not duplicates; a negative stock passes when sold at zero stock', () => {
    const r = preview(fr, [...robe, service]);
    expect(r.rows.map((x) => [x.row, x.ok, x.action, x.variantOf ?? null, x.errors])).toEqual([
      [2, true, 'create', null, []],
      [3, true, 'create', 2, []],
      [4, true, 'create', 2, []],
      [5, true, 'create', null, []],
    ]);
    expect(r.totals).toEqual({ rows: 4, valid: 4, invalid: 0, create: 2, update: 0, overPlanLimit: 0, newCategories: 1, variants: 2 });
    expect(r.rows[0]!.values).toMatchObject({ sku: 'ROBE', variant: null, price: 4000, costPrice: 2000, minStock: 2, trackStock: true, sellOutOfStock: true, isActive: true, description: 'Brodée', weightGrams: 800, keywords: 'robe, fête' });
    expect(r.rows[1]!.values).toMatchObject({ variant: 'S', variantSku: 'ROBE-S', price: 4000, stock: -2, minStock: 1 });
    expect(r.rows[2]!.values).toMatchObject({ variant: 'M', variantSku: 'ROBE-M', price: 4200, stock: 5, isActive: false });
    expect(r.rows[3]!.values).toMatchObject({ trackStock: false, sellOutOfStock: false });
  });

  it('a negative stock is refused without « Vente en rupture »; the product is left out with its row in error', () => {
    const r = preview(fr, robe.map((cells, i) => (i === 0 ? cells.map((c, j) => (fr[j] === 'Vente en rupture' ? 'Non' : c)) : cells)));
    expect(r.rows[1]!.errors).toEqual([{ field: 'stock', code: 'validation.quantity' }]);
    expect(r.rows[0]!.errors).toEqual([{ field: null, code: 'validation.import_group', params: { row: 3 } }]);
    expect(r.rows[2]!.errors).toEqual([{ field: null, code: 'validation.import_group', params: { row: 3 } }]);
    expect(r.totals).toMatchObject({ valid: 0, invalid: 3, create: 0, variants: 0 });
    // a product without variants, sold at zero stock
    const single = preview(['Nom', 'Prix', 'Stock', 'Vente en rupture'], [['Tapis', '100', '-4', 'oui'], ['Vase', '100', '-4', '']]);
    expect(single.rows.map((x) => x.errors.map((e) => e.code))).toEqual([[], ['validation.quantity']]);
    expect(single.rows[0]!.values).toMatchObject({ stock: -4, sellOutOfStock: true });
  });

  it('a variant row only answers for its own cells: the product cells it repeats are read on the product line', () => {
    const r = preview(fr, [robe[0]!, row({ SKU: 'ROBE', Nom: '', Variante: 'S', Prix: '4000', Unité: 'carton', 'Ancien prix': '10' })]);
    expect(r.rows[1]).toMatchObject({ ok: true, variantOf: 2, errors: [] });
  });

  it('exports before 23/11 (one line per variant, no product line): the first line is the product and its first variant', () => {
    const old = ['SKU', 'Nom', 'Variante', 'SKU variante', 'Prix', 'Stock', 'Actif'];
    const r = preview(old, [
      ['TEA', 'Thé', '100 g', 'TEA-100', '500', '3', 'Oui'],
      ['TEA', 'Thé', '250 g', 'TEA-250', '1100', '0', 'Oui'],
      ['TEA', 'Thé', '', '', '1100', '0', 'Oui'], // a product line repeated: a real duplicate
    ]);
    expect(r.rows.map((x) => [x.variantOf ?? null, x.errors.map((e) => e.code)])).toEqual([
      [2, []],
      [2, []],
      [null, ['IMPORT_DUPLICATE_SKU_IN_FILE']],
    ]);
    expect(r.totals).toMatchObject({ valid: 2, create: 1, variants: 2 });
  });

  it('variant checks: name twice, SKU twice or taken, a service with variants; a variant without SKU joins its product name', () => {
    const r = preview(
      fr,
      [
        row({ SKU: 'A', Nom: 'Sac', Prix: '100' }),
        row({ SKU: 'A', Nom: 'Sac', Variante: 'Rouge', 'SKU variante': 'A-R', Prix: '100' }),
        row({ SKU: 'A', Nom: 'Sac', Variante: 'rouge', Prix: '100' }),
        row({ SKU: 'A', Nom: 'Sac', Variante: 'Bleu', 'SKU variante': 'A-R', Prix: '100' }),
        row({ SKU: 'A', Nom: 'Sac', Variante: 'Vert', 'SKU variante': 'TAKEN', Prix: '100' }),
        row({ SKU: 'S', Nom: 'Cours', Prix: '100', 'Suivi du stock': 'non' }),
        row({ SKU: 'S', Nom: 'Cours', Variante: 'Matin', Prix: '100' }),
        row({ Nom: 'Pull', Prix: '100' }),
        row({ Nom: 'pull', Variante: 'L', Prix: '100', Stock: '2' }),
      ],
      { existingSkus: new Map([['TAKEN', 'variant']]) },
    );
    expect(r.rows.map((x) => x.errors.filter((e) => e.code !== 'validation.import_group').map((e) => `${e.field}:${e.code}`))).toEqual([
      [],
      [],
      ['variant:validation.taken'],
      ['variantSku:IMPORT_DUPLICATE_SKU_IN_FILE'],
      ['variantSku:PRODUCT_SKU_ALREADY_EXISTS'],
      [],
      ['trackStock:PRODUCT_NOT_STOCK_TRACKED'],
      [],
      [],
    ]);
    expect(r.rows[3]!.errors[0]!.params).toEqual({ row: 3 });
    expect(r.rows.map((x) => x.ok)).toEqual([false, false, false, false, false, false, false, true, true]);
    expect(r.rows[8]!.variantOf).toBe(9);
  });

  it('updateExisting: variants are matched by name (their own SKU is kept); a variant product cannot become a service', () => {
    const products = new Map([['ROBE', { trackStock: true, sellOutOfStock: false, hasVariants: true, variants: new Map<string, string | null>([['s', 'ROBE-S']]) }]]);
    const existingSkus = new Map<string, 'product' | 'variant'>([
      ['ROBE', 'product'],
      ['ROBE-S', 'variant'],
    ]);
    const r = preview(fr, robe, { existingSkus, products }, true);
    expect(r.rows.map((x) => [x.action, x.errors])).toEqual([
      ['update', []],
      ['update', []],
      ['update', []],
    ]);
    expect(r.totals).toMatchObject({ update: 1, create: 0, variants: 2 });
    // without updateExisting the product SKU and the variant SKU are taken
    expect(preview(fr, robe, { existingSkus, products }).rows.map((x) => x.errors.map((e) => e.code))).toEqual([['PRODUCT_SKU_ALREADY_EXISTS'], ['PRODUCT_SKU_ALREADY_EXISTS'], ['validation.import_group']]);
    const off = preview(fr, [robe[0]!.map((c, j) => (fr[j] === 'Suivi du stock' ? 'Non' : c))], { existingSkus, products }, true);
    expect(off.rows[0]!.errors).toEqual([{ field: 'trackStock', code: 'validation.invalid' }]);
  });

  it('plan limit: one slot per product, its variants take none', () => {
    const r = preview(fr, [...robe, service], { freeSlots: 1, limit: 10, current: 9 });
    expect(r.rows.map((x) => x.ok)).toEqual([true, true, true, false]);
    expect(r.totals).toMatchObject({ create: 1, variants: 2, overPlanLimit: 1 });
  });

  it('a file without the new columns keeps the old behaviour', () => {
    const r = preview(['SKU', 'Nom', 'Prix', 'Stock'], [['A', 'Un', '10', '-1'], ['A', 'Deux', '10', '1']]);
    expect(r.rows.map((x) => x.errors.map((e) => e.code))).toEqual([['validation.quantity'], ['IMPORT_DUPLICATE_SKU_IN_FILE']]);
    expect(r.totals).not.toHaveProperty('variants');
  });
});
