// CAT-06 / FL-12 — pure part of the catalogue import: header aliases (FR / EN / AR, as V1), cell parsing, row validation,
// preview. No database here: the service passes what the rows must be checked against.
import { CATALOG_MAX_MONEY, CATALOG_MAX_QTY, formatNumber, IMPORT_FIELDS, IMPORT_REQUIRED_FIELDS, VARIANTS_MAX, type ImportField, type ImportPreviewResult, type ImportPreviewRow } from '@djaber/shared';

/** Lowercase, accents dropped, letters and digits only: "Prix d’achat" → "prixdachat". Arabic letters are kept. */
export const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]/g, '');

/**
 * Aliases are compared in their normalised form. Every header of the products export (fr / ar / en, `PRODUCT_HEADERS`
 * of product.service) is one of them, so an exported file maps itself (client list L78).
 */
export const HEADER_ALIASES: Record<ImportField, string[]> = {
  sku: ['sku', 'reference', 'ref', 'codearticle', 'code', 'referenceproduit', 'الرمز', 'المرجع'],
  name: ['name', 'nom', 'produit', 'product', 'libelle', 'designation', 'nomduproduit', 'productname', 'الاسم', 'المنتج'],
  variant: ['variant', 'variante', 'declinaison', 'variantname', 'nomvariante', 'nomdelavariante', 'المتغيّر', 'المتغير'],
  variantSku: ['variantsku', 'skuvariante', 'skudelavariante', 'referencevariante', 'SKU المتغيّر', 'SKU المتغير', 'رمز المتغير'],
  description: ['description', 'desc', 'details', 'detail', 'الوصف'],
  category: ['category', 'categorie', 'famille', 'rayon', 'الفئة'],
  unit: ['unit', 'unite', 'unitemesure', 'uom', 'mesure', 'الوحدة'],
  price: ['price', 'sellingprice', 'prixdevente', 'prixvente', 'prix', 'vente', 'saleprice', 'السعر', 'سعرالبيع'],
  oldPrice: ['oldprice', 'ancienprix', 'prixbarre', 'compareatprice', 'السعرالقديم'],
  costPrice: ['costprice', 'prixdachat', 'prixachat', 'cout', 'coutunitaire', 'cost', 'achat', 'purchaseprice', 'التكلفة', 'سعرالشراء'],
  stock: ['stock', 'quantity', 'quantite', 'qte', 'qty', 'الكمية', 'المخزون'],
  minStock: ['minstock', 'stockmin', 'seuil', 'seuilalerte', 'seuildalerte', 'stockminimum', 'minquantity', 'alerte', 'threshold', 'alertthreshold', 'الحدالادنى', 'الحد الأدنى', 'حد التنبيه'],
  weightGrams: ['weightgrams', 'weight', 'weightg', 'poids', 'poidsg', 'poidsgrammes', 'الوزن', 'الوزن (غ)'],
  keywords: ['keywords', 'motscles', 'tags', 'etiquettes', 'الكلماتالمفتاحية'],
  trackStock: ['trackstock', 'suividustock', 'suivistock', 'stocksuivi', 'gererlestock', 'تتبع المخزون', 'تتبّع المخزون'],
  sellOutOfStock: ['selloutofstock', 'venteenrupture', 'accepterlescommandesenrupture', 'commandesenrupture', 'backorder', 'البيع عند نفاد المخزون'],
  isActive: ['isactive', 'active', 'actif', 'statut', 'status', 'نشط'],
};

export type ImportMapping = Partial<Record<ImportField, string | null>>;
/** The aliases in their normalised form (an Arabic alias with a hamza letter, `الفئة`, decomposes like the file header). */
const NORMALISED_ALIASES = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, HEADER_ALIASES[f].map(normalizeHeader)])) as Record<ImportField, string[]>;

/** Each target field takes the first header of the file whose normalised form is one of its aliases. */
export const autoMap = (headers: string[]): ImportMapping => {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const header = headers.find((h) => h && !used.has(h) && NORMALISED_ALIASES[field].includes(normalizeHeader(h)));
    if (header) {
      mapping[field] = header;
      used.add(header);
    }
  }
  return mapping;
};

export const missingRequired = (mapping: ImportMapping): ImportField[] => IMPORT_REQUIRED_FIELDS.filter((f) => !mapping[f]);

/** "12 500", "12500 DA", "12 500,00", "12,500.00" → 12500. Null when the cell is not an integer amount. */
export const parseInteger = (raw: string): number | null => {
  let s = raw.replace(/[\s  ]/g, '').replace(/(da|dzd|dinars?|د\.?ج)$/i, '');
  if (s === '') return null;
  s = s.replace(/[.,]0{1,2}$/, ''); // ",00" / ".0" written by spreadsheets
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, ''); // thousands separators
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

const TRUE = new Set(['1', 'true', 'oui', 'yes', 'y', 'o', 'actif', 'active', 'x', 'نعم']);
const FALSE = new Set(['0', 'false', 'non', 'no', 'n', 'inactif', 'inactive', 'لا']);
/** "oui" / "non" (fr, ar, en): true / false; '' → undefined (the default applies); anything else → null (invalid). */
export const parseFlag = (raw: string): boolean | null | undefined => {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  return TRUE.has(s) ? true : FALSE.has(s) ? false : null;
};

/** A product of the catalogue a row may update (`updateExisting`), keyed by its SKU. */
export type ExistingProduct = { trackStock: boolean; sellOutOfStock: boolean; hasVariants: boolean; /** lower-cased live variant name → its SKU */ variants: Map<string, string | null> };

export type ImportContext = {
  /** live SKUs of the workspace → what holds them */
  existingSkus: Map<string, 'product' | 'variant'>;
  /** lower-cased names and abbreviations of the units the workspace may use */
  units: Set<string>;
  /** lower-cased names of the live categories */
  categories: Set<string>;
  /** product slots left on the plan (Infinity = unlimited) and the figures for the row message */
  freeSlots: number;
  limit: number;
  current: number;
  /** live products by SKU, with their variants (variant rows of an update are checked against them) */
  products?: Map<string, ExistingProduct>;
};

type Values = ImportPreviewRow['values'];
type RowError = ImportPreviewRow['errors'][number];

const MAX = { sku: 255, name: 255, variant: 120, description: 5000, category: 80 };
/** The bounds of the product form (`CreateProductSchema`): a row the form would refuse is refused here (journey J02-2). */
const BOUND = { money: CATALOG_MAX_MONEY, qty: CATALOG_MAX_QTY, weightGrams: 1_000_000 };
/** What a variant row brings (the other cells repeat its product and are read on the product line). */
const VARIANT_ROW_FIELDS = new Set<ImportField | null>(['variant', 'variantSku', 'price', 'costPrice', 'stock', 'minStock', 'isActive']);

/** `negativeStock`: the product accepts orders at zero stock (L78), so its stock may be below 0. */
const parseRow = (cell: (f: ImportField) => string, mapped: (f: ImportField) => boolean, negativeStock: boolean): { values: Values; errors: RowError[] } => {
  const values: Values = {};
  const errors: RowError[] = [];
  const err = (field: ImportField, code: string, params?: Record<string, string | number>) => errors.push({ field, code, ...(params ? { params } : {}) });

  const name = cell('name');
  if (!name) err('name', 'validation.required');
  else if (name.length > MAX.name) err('name', 'validation.length');
  values.name = name;

  // retest 11/11 UX-054: a value that is not a number stays as typed (« abc »), so the merchant sees what to correct
  const rawPrice = cell('price');
  const price = parseInteger(rawPrice);
  // full-test 15/11 PRODUCTS-11: « 1999.5 » is a price, just not a whole number of DA — say so
  if (price === null && rawPrice) err('price', 'validation.price_integer');
  else if (price === null || price <= 0) err('price', 'validation.price');
  else if (price > BOUND.money) err('price', 'validation.price_max');
  values.price = price ?? (rawPrice || null);

  if (mapped('sku')) {
    const sku = cell('sku');
    if (sku.length > MAX.sku) err('sku', 'validation.length');
    values.sku = sku || null;
  }
  if (mapped('variant')) {
    const v = cell('variant');
    if (v.length > MAX.variant) err('variant', 'validation.length');
    values.variant = v || null;
  }
  if (mapped('variantSku')) {
    const s = cell('variantSku');
    if (s.length > MAX.sku) err('variantSku', 'validation.length');
    values.variantSku = s || null;
  }
  if (mapped('description')) {
    const d = cell('description');
    if (d.length > MAX.description) err('description', 'validation.length');
    values.description = d || null;
  }
  if (mapped('category')) {
    const c = cell('category');
    if (c.length > MAX.category) err('category', 'validation.length');
    values.category = c || null;
  }
  if (mapped('unit')) values.unit = cell('unit') || null;
  for (const f of ['oldPrice', 'costPrice'] as const) {
    if (!mapped(f)) continue;
    const raw = cell(f);
    if (!raw) {
      values[f] = null;
      continue;
    }
    const n = parseInteger(raw);
    if (n === null) err(f, 'validation.price_integer');
    else if (n < (f === 'oldPrice' ? 1 : 0)) err(f, 'validation.price');
    else if (n > BOUND.money) err(f, 'validation.price_max');
    // 04 §12 (PRODUCTS-09): the struck-through price is above the selling price
    else if (f === 'oldPrice' && typeof price === 'number' && price > 0 && n <= price) err(f, 'validation.old_price');
    values[f] = n ?? raw;
  }
  for (const f of ['stock', 'minStock', 'weightGrams'] as const) {
    if (!mapped(f)) continue;
    const raw = cell(f);
    if (!raw) {
      values[f] = f === 'weightGrams' ? null : 0;
      continue;
    }
    const n = parseInteger(raw);
    // the weight message names its bounds (« Valeur hors limites (0–1 000 000) »)
    const weightRange = { min: 0, max: formatNumber(BOUND.weightGrams) };
    // client list L78: the stock of a product sold at zero stock may be below 0 (orders taken without stock)
    const min = f === 'stock' && negativeStock ? -BOUND.qty : 0;
    if (n === null || n < min) err(f, f === 'weightGrams' ? 'validation.range' : 'validation.quantity', f === 'weightGrams' ? weightRange : undefined);
    else if (n > (f === 'weightGrams' ? BOUND.weightGrams : BOUND.qty)) err(f, f === 'weightGrams' ? 'validation.range' : 'validation.quantity_max', f === 'weightGrams' ? weightRange : undefined);
    values[f] = n ?? raw;
  }
  if (mapped('keywords')) {
    values.keywords = cell('keywords')
      .split(/[,;|]/)
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((k) => k.slice(0, 50))
      .join(', ');
  }
  // client list L77: the stock flags of the product form; an empty cell keeps the form default (tracked, no backorder)
  for (const f of ['trackStock', 'sellOutOfStock'] as const) {
    if (!mapped(f)) continue;
    const flag = parseFlag(cell(f));
    if (flag === null) err(f, 'validation.invalid');
    else values[f] = flag ?? f === 'trackStock';
  }
  if (mapped('isActive')) {
    const flag = parseFlag(cell('isActive'));
    if (flag === null) err('isActive', 'validation.invalid');
    else values.isActive = flag ?? true;
  }
  return { values, errors };
};

/**
 * Client list L78 (Boutique de Lalla 22/11): when a « Variante » column is mapped, the rows of one product SKU are one
 * product — the first row is the product, the rows naming a variant are its variants (a first row naming a variant is
 * the product and its first variant: exports made before 23/11/2026). A variant row without SKU belongs to the product
 * just above it when it repeats its name. A product and its variants are imported together or not at all.
 */
export const buildPreview = (input: {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: ImportMapping;
  updateExisting: boolean;
  ctx: ImportContext;
}): ImportPreviewResult => {
  const { headers, mapping, ctx } = input;
  const index = new Map<ImportField, number>();
  for (const f of IMPORT_FIELDS) {
    const h = mapping[f];
    const i = h ? headers.indexOf(h) : -1;
    if (i >= 0) index.set(f, i);
  }
  const mapped = (f: ImportField) => index.has(f);
  const cellOf = (cells: string[]) => (f: ImportField) => (index.has(f) ? (cells[index.get(f)!] ?? '').trim() : '');
  const grouping = mapped('variant');
  const n = input.rows.length;
  const line = (i: number) => i + 2; // line number in the file: the header is line 1

  // --- pass 1: which row is a product, which is a variant of which product
  const head: number[] = new Array(n);
  const duplicateOf: (number | undefined)[] = new Array(n);
  const headBySku = new Map<string, number>();
  let previousHead = -1;
  for (let i = 0; i < n; i++) {
    const cell = cellOf(input.rows[i]!);
    const sku = cell('sku');
    const variant = grouping ? cell('variant') : '';
    const known = sku ? headBySku.get(sku) : undefined;
    const sameAsAbove = !sku && variant && previousHead >= 0 && !cellOf(input.rows[previousHead]!)('sku') && cellOf(input.rows[previousHead]!)('name').toLowerCase() === cell('name').toLowerCase();
    if (known !== undefined && variant) head[i] = known;
    else if (sameAsAbove) head[i] = previousHead;
    else {
      head[i] = i;
      if (known !== undefined) duplicateOf[i] = known;
      else if (sku) headBySku.set(sku, i);
    }
    previousHead = head[i]!;
  }

  // the product of each product row: created, updated (updateExisting) and its stock flags
  const existing = (i: number) => {
    const sku = cellOf(input.rows[i]!)('sku');
    return sku && duplicateOf[i] === undefined && input.updateExisting && ctx.existingSkus.get(sku) === 'product' ? (ctx.products?.get(sku) ?? null) : undefined;
  };
  const flagsOf = new Map<number, { updating: boolean; tracked: boolean; trackedInvalid: boolean; negativeStock: boolean; target: ExistingProduct | null | undefined }>();
  const flags = (h: number) => {
    let f = flagsOf.get(h);
    if (!f) {
      const cell = cellOf(input.rows[h]!);
      const target = existing(h);
      const track = mapped('trackStock') ? parseFlag(cell('trackStock')) : undefined;
      const sell = mapped('sellOutOfStock') ? parseFlag(cell('sellOutOfStock')) : undefined;
      const tracked = track === undefined || track === null ? (target?.trackStock ?? true) : track;
      const selling = sell === undefined || sell === null ? (mapped('sellOutOfStock') ? false : (target?.sellOutOfStock ?? false)) : sell;
      f = { updating: target !== undefined, tracked, trackedInvalid: track === false && !!target?.hasVariants, negativeStock: tracked && selling, target };
      flagsOf.set(h, f);
    }
    return f;
  };

  // variant SKUs of the catalogue → `<product SKU>\n<variant name>` (an update may keep a variant's own SKU)
  const variantOwner = new Map<string, string>();
  for (const [sku, p] of ctx.products ?? []) for (const [name, vSku] of p.variants) if (vSku) variantOwner.set(vSku, `${sku}\n${name}`);

  // --- pass 2: each row on its own, then against the file and the catalogue
  const firstRowOfSku = new Map<string, number>();
  const newCategories = new Set<string>();
  const groupNames = new Map<number, Map<string, number>>(); // product row → lower-cased variant name → its line
  const groupNew = new Map<number, number>(); // product row → variants it adds
  const parsed = input.rows.map((cells, i) => {
    const h = head[i]!;
    const f = flags(h);
    const cell = cellOf(cells);
    const { values, errors: all } = parseRow(cell, mapped, f.negativeStock);
    const isProduct = h === i;
    const variant = grouping && typeof values.variant === 'string' ? values.variant : null;
    // the cells of a variant row that describe the product are read on the product line
    const errors = isProduct ? all : all.filter((e) => VARIANT_ROW_FIELDS.has(e.field));
    let action: ImportPreviewRow['action'] = f.updating ? 'update' : 'create';

    if (isProduct) {
      const sku = typeof values.sku === 'string' ? values.sku : null;
      if (sku) {
        const first = firstRowOfSku.get(sku);
        if (first !== undefined) errors.push({ field: 'sku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: first } });
        else firstRowOfSku.set(sku, line(i));
        const holder = ctx.existingSkus.get(sku);
        if (holder === 'product' && input.updateExisting) action = 'update';
        else if (holder) errors.push({ field: 'sku', code: 'PRODUCT_SKU_ALREADY_EXISTS' });
      }
      if (typeof values.unit === 'string' && values.unit && !ctx.units.has(values.unit.toLowerCase())) errors.push({ field: 'unit', code: 'validation.invalid' });
      // tracked → service is refused for a product with variants (CAT-11, as the product form)
      if (f.trackedInvalid) errors.push({ field: 'trackStock', code: 'validation.invalid' });
    }
    if (variant) {
      const productSku = cellOf(input.rows[h]!)('sku');
      const vSku = typeof values.variantSku === 'string' ? values.variantSku : null;
      if (vSku) {
        const first = firstRowOfSku.get(vSku);
        if (first !== undefined) errors.push({ field: 'variantSku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: first } });
        else firstRowOfSku.set(vSku, line(i));
        const ownVariant = f.updating && variantOwner.get(vSku) === `${productSku}\n${variant.toLowerCase()}`;
        if (ctx.existingSkus.has(vSku) && !ownVariant) errors.push({ field: 'variantSku', code: 'PRODUCT_SKU_ALREADY_EXISTS' });
      }
      const names = groupNames.get(h) ?? new Map<string, number>();
      groupNames.set(h, names);
      if (names.has(variant.toLowerCase())) errors.push({ field: 'variant', code: 'validation.taken' });
      else {
        names.set(variant.toLowerCase(), line(i));
        if (!f.target?.variants.has(variant.toLowerCase())) groupNew.set(h, (groupNew.get(h) ?? 0) + 1);
        if ((f.target?.variants.size ?? 0) + (groupNew.get(h) ?? 0) > VARIANTS_MAX) errors.push({ field: 'variant', code: 'VARIANT_LIMIT' });
      }
      // variants keep quantities: a service (stock not tracked) has none (CAT-11)
      if (!f.tracked) errors.push({ field: 'trackStock', code: 'PRODUCT_NOT_STOCK_TRACKED' });
    }
    return { i, values, errors, action, isProduct, variant };
  });

  // --- plan limit (02 §5): one slot per new product, in file order; a product whose group has an error takes none
  const groupBad = new Map<number, number>(); // product row → first line in error in its group
  for (const r of parsed) if (r.errors.length && !groupBad.has(head[r.i]!)) groupBad.set(head[r.i]!, line(r.i));
  let slots = ctx.freeSlots;
  let overPlanLimit = 0;
  for (const r of parsed) {
    if (!r.isProduct || r.action !== 'create' || groupBad.has(r.i)) continue;
    if (slots <= 0) {
      r.errors.push({ field: null, code: 'PLAN_LIMIT', params: { resource: 'products', limit: ctx.limit, current: ctx.current } });
      groupBad.set(r.i, line(r.i));
      overPlanLimit++;
    } else slots--;
  }

  const totals: ImportPreviewResult['totals'] = { rows: n, valid: 0, invalid: 0, create: 0, update: 0, overPlanLimit, newCategories: 0, ...(grouping ? { variants: 0 } : {}) };
  const rows: ImportPreviewRow[] = parsed.map((r) => {
    const h = head[r.i]!;
    // a product and its variants are written together: the other rows of a group in error are left out with it
    const bad = groupBad.get(h);
    if (bad !== undefined && !r.errors.length) r.errors.push({ field: null, code: 'validation.import_group', params: { row: bad } });
    const ok = r.errors.length === 0;
    if (ok) {
      totals.valid++;
      if (r.isProduct) {
        totals[r.action === 'update' ? 'update' : 'create']++;
        if (typeof r.values.category === 'string' && r.values.category && !ctx.categories.has(r.values.category.toLowerCase())) newCategories.add(r.values.category.toLowerCase());
      }
      if (r.variant && totals.variants !== undefined) totals.variants++;
    } else totals.invalid++;
    return { row: line(r.i), ok, action: ok ? r.action : 'skip', values: r.values, errors: r.errors, ...(r.variant ? { variantOf: line(h) } : {}) };
  });
  totals.newCategories = newCategories.size;
  return { stage: 'preview', fileName: input.fileName, headers, mapping, missingColumns: [], updateExisting: input.updateExisting, totals, rows };
};
