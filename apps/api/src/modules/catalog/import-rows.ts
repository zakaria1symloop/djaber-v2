// CAT-06 / FL-12 — pure part of the catalogue import: header aliases (FR / EN / AR, as V1), cell parsing, row validation,
// preview. No database here: the service passes what the rows must be checked against.
import { IMPORT_FIELDS, IMPORT_REQUIRED_FIELDS, type ImportField, type ImportPreviewResult, type ImportPreviewRow } from '@djaber/shared';

/** Lowercase, accents dropped, letters and digits only: "Prix d’achat" → "prixdachat". Arabic letters are kept. */
export const normalizeHeader = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]/g, '');

export const HEADER_ALIASES: Record<ImportField, string[]> = {
  sku: ['sku', 'reference', 'ref', 'codearticle', 'code', 'referenceproduit', 'الرمز', 'المرجع'],
  name: ['name', 'nom', 'produit', 'product', 'libelle', 'designation', 'nomduproduit', 'productname', 'الاسم', 'المنتج'],
  description: ['description', 'desc', 'details', 'detail', 'الوصف'],
  category: ['category', 'categorie', 'famille', 'rayon', 'الفئة'],
  unit: ['unit', 'unite', 'unitemesure', 'uom', 'mesure', 'الوحدة'],
  price: ['price', 'sellingprice', 'prixdevente', 'prixvente', 'prix', 'vente', 'saleprice', 'السعر', 'سعرالبيع'],
  oldPrice: ['oldprice', 'ancienprix', 'prixbarre', 'compareatprice', 'السعرالقديم'],
  costPrice: ['costprice', 'prixdachat', 'prixachat', 'cout', 'coutunitaire', 'cost', 'achat', 'purchaseprice', 'التكلفة', 'سعرالشراء'],
  stock: ['stock', 'quantity', 'quantite', 'qte', 'qty', 'الكمية', 'المخزون'],
  minStock: ['minstock', 'stockmin', 'seuil', 'seuilalerte', 'stockminimum', 'minquantity', 'alerte', 'الحدالادنى'],
  weightGrams: ['weightgrams', 'weight', 'poids', 'poidsg', 'poidsgrammes', 'الوزن'],
  keywords: ['keywords', 'motscles', 'tags', 'etiquettes', 'الكلماتالمفتاحية'],
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
  let s = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/(da|dzd|dinars?|د\.?ج)$/i, '');
  if (s === '') return null;
  s = s.replace(/[.,]0{1,2}$/, ''); // ",00" / ".0" written by spreadsheets
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, ''); // thousands separators
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

const TRUE = new Set(['1', 'true', 'oui', 'yes', 'y', 'o', 'actif', 'active', 'x', 'نعم']);
const FALSE = new Set(['0', 'false', 'non', 'no', 'n', 'inactif', 'inactive', 'لا']);

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
};

type Values = ImportPreviewRow['values'];
type RowError = ImportPreviewRow['errors'][number];

const MAX = { sku: 255, name: 255, description: 5000, category: 80 };

const parseRow = (cell: (f: ImportField) => string, mapped: (f: ImportField) => boolean): { values: Values; errors: RowError[] } => {
  const values: Values = {};
  const errors: RowError[] = [];
  const err = (field: ImportField, code: string) => errors.push({ field, code });

  const name = cell('name');
  if (!name) err('name', 'validation.required');
  else if (name.length > MAX.name) err('name', 'validation.length');
  values.name = name;

  const price = parseInteger(cell('price'));
  if (price === null || price <= 0) err('price', 'validation.price');
  values.price = price;

  if (mapped('sku')) {
    const sku = cell('sku');
    if (sku.length > MAX.sku) err('sku', 'validation.length');
    values.sku = sku || null;
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
    if (n === null || n < (f === 'oldPrice' ? 1 : 0)) err(f, 'validation.price');
    values[f] = n;
  }
  for (const f of ['stock', 'minStock', 'weightGrams'] as const) {
    if (!mapped(f)) continue;
    const raw = cell(f);
    if (!raw) {
      values[f] = f === 'weightGrams' ? null : 0;
      continue;
    }
    const n = parseInteger(raw);
    if (n === null || n < 0) err(f, f === 'weightGrams' ? 'validation.range' : 'validation.quantity');
    values[f] = n;
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
  if (mapped('isActive')) {
    const raw = cell('isActive').toLowerCase();
    if (!raw || TRUE.has(raw)) values.isActive = true;
    else if (FALSE.has(raw)) values.isActive = false;
    else err('isActive', 'validation.invalid');
  }
  return { values, errors };
};

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
  const firstRowOfSku = new Map<string, number>();
  const newCategories = new Set<string>();
  let slots = ctx.freeSlots;
  const totals = { rows: input.rows.length, valid: 0, invalid: 0, create: 0, update: 0, overPlanLimit: 0, newCategories: 0 };

  const rows: ImportPreviewRow[] = input.rows.map((cells, i) => {
    const row = i + 2; // line number in the file: the header is line 1
    const { values, errors } = parseRow(
      (f) => (index.has(f) ? (cells[index.get(f)!] ?? '').trim() : ''),
      (f) => index.has(f),
    );
    let action: ImportPreviewRow['action'] = 'create';

    const sku = typeof values.sku === 'string' ? values.sku : null;
    if (sku) {
      const first = firstRowOfSku.get(sku);
      if (first !== undefined) errors.push({ field: 'sku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: first } });
      else firstRowOfSku.set(sku, row);
      const holder = ctx.existingSkus.get(sku);
      if (holder === 'product' && input.updateExisting) action = 'update';
      else if (holder) errors.push({ field: 'sku', code: 'PRODUCT_SKU_ALREADY_EXISTS' });
    }
    if (typeof values.unit === 'string' && values.unit && !ctx.units.has(values.unit.toLowerCase())) errors.push({ field: 'unit', code: 'validation.invalid' });

    if (!errors.length && action === 'create') {
      // 02 §5: rows beyond the plan are reported in the preview, in file order
      if (slots <= 0) {
        errors.push({ field: null, code: 'PLAN_LIMIT', params: { resource: 'products', limit: ctx.limit, current: ctx.current } });
        totals.overPlanLimit++;
      } else slots--;
    }
    const ok = errors.length === 0;
    if (ok) {
      totals.valid++;
      totals[action === 'update' ? 'update' : 'create']++;
      if (typeof values.category === 'string' && values.category && !ctx.categories.has(values.category.toLowerCase())) newCategories.add(values.category.toLowerCase());
    } else {
      totals.invalid++;
      action = 'skip';
    }
    return { row, ok, action, values, errors };
  });
  totals.newCategories = newCategories.size;
  return { stage: 'preview', fileName: input.fileName, headers, mapping, missingColumns: [], updateExisting: input.updateExisting, totals, rows };
};
