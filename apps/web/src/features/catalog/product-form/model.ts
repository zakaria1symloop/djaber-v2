// Product form model (CAT-01, CAT-03, CAT-07): the form keeps strings, the payloads are the shared zod inputs.
// Pure functions only (unit tested): form schema, DTO ↔ form ↔ payload mappers, keywords, dirty labels, rebase on a
// fresh server version, server field paths, AI-fill merge.
import {
  productCost,
  productName,
  productPrice,
  productSku,
  stockQty,
  VARIANTS_MAX,
  type CreateProductInput,
  type CreateVariantInput,
  type UpdateProductInput,
  type UpdateVariantInput,
} from '@djaber/shared';
import { z } from 'zod';
import { digitsToInt, moneyDigits } from '@/lib/money';
import type { AiFillResult, Product, Variant } from '../contracts';

export const KEYWORDS_MAX = 30;
export const KEYWORD_MAX_LENGTH = 50;
export const DESCRIPTION_MAX = 5000;
export const VARIANT_NAME_MAX = 120;
export const WEIGHT_MAX = 1_000_000;

export type VariantRow = {
  /** stable client key (the server id once saved) */
  key: string;
  id: string | null;
  name: string;
  sku: string;
  price: string;
  costPrice: string;
  /** opening quantity of an unsaved row; the current quantity (read-only) of a saved one */
  stock: string;
  minStock: string;
  isActive: boolean;
  attributes: Record<string, string>;
};

export type ProductFormValues = {
  name: string;
  sku: string;
  keywords: string;
  description: string;
  price: string;
  oldPrice: string;
  costPrice: string;
  trackStock: boolean;
  /** orders accepted at zero stock (PV 22/10) */
  sellOutOfStock: boolean;
  stock: string;
  minStock: string;
  categoryId: string;
  unitId: string;
  weightGrams: string;
  isActive: boolean;
  variants: VariantRow[];
};

export const SCALAR_FIELDS = ['name', 'sku', 'keywords', 'description', 'price', 'oldPrice', 'costPrice', 'trackStock', 'sellOutOfStock', 'stock', 'minStock', 'categoryId', 'unitId', 'weightGrams', 'isActive'] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];
export const VARIANT_FIELDS = ['name', 'sku', 'price', 'costPrice', 'stock', 'minStock'] as const;
export type VariantField = (typeof VARIANT_FIELDS)[number];

let seq = 0;
export const newKey = () => `new-${Date.now().toString(36)}-${++seq}`;

/* ---------- keywords ---------- */
/** `"robe, satin،  soirée ; Robe"` → `['robe', 'satin', 'soirée']` (comma, Arabic comma, semicolon or line break; case-insensitive dedupe). */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,،;؛\n]/)) {
    const k = raw.replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}
export const formatKeywords = (keywords: readonly string[] | null | undefined): string => (keywords ?? []).join(', ');

/* ---------- DTO → form ---------- */
export const emptyVariantRow = (o: Partial<VariantRow> = {}): VariantRow => ({ key: newKey(), id: null, name: '', sku: '', price: '', costPrice: '', stock: '', minStock: '', isActive: true, attributes: {}, ...o });

export const emptyForm = (o: { service?: boolean } = {}): ProductFormValues => ({
  name: '',
  sku: '',
  keywords: '',
  description: '',
  price: '',
  oldPrice: '',
  costPrice: '',
  trackStock: !o.service,
  sellOutOfStock: false,
  stock: '',
  minStock: '',
  categoryId: '',
  unitId: '',
  weightGrams: '',
  isActive: true,
  variants: [],
});

export const variantToRow = (v: Variant): VariantRow => ({
  key: v.id,
  id: v.id,
  name: v.name,
  sku: v.sku ?? '',
  price: moneyDigits(v.price),
  costPrice: moneyDigits(v.costPrice),
  stock: String(v.stock),
  minStock: String(v.minStock ?? 0),
  isActive: v.isActive,
  attributes: v.attributes ?? {},
});

export const toForm = (p: Product): ProductFormValues => ({
  name: p.name,
  sku: p.sku,
  keywords: formatKeywords(p.keywords),
  description: p.description ?? '',
  price: moneyDigits(p.price),
  oldPrice: moneyDigits(p.oldPrice),
  costPrice: moneyDigits(p.costPrice),
  trackStock: p.trackStock,
  sellOutOfStock: p.sellOutOfStock ?? false,
  stock: p.stock === null || p.stock === undefined ? '' : String(p.stock),
  minStock: String(p.minStock ?? 0),
  categoryId: p.category?.id ?? '',
  unitId: p.unit?.id ?? '',
  weightGrams: p.weightGrams === null || p.weightGrams === undefined ? '' : String(p.weightGrams),
  isActive: p.isActive,
  variants: (p.variants ?? []).map(variantToRow),
});

/* ---------- form schema: strings checked with the shared primitives (messages = `validation.*` keys) ---------- */
type Check = { safeParse: (v: unknown) => { success: true } | { success: false; error: { issues: { message: string }[] } } };
const firstIssue = (schema: Check, value: unknown): string | null => {
  const r = schema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? 'validation.invalid');
};
/** A digits-only field checked as the integer the payload will carry; `''` passes unless `required`. */
const digits = (schema: Check, required = false) =>
  z.string().superRefine((s, ctx) => {
    if (s === '' && !required) return;
    const message = firstIssue(schema, s === '' ? undefined : Number(s));
    if (message) ctx.addIssue({ code: 'custom', message });
  });
const text = (schema: Check, optional = false) =>
  z.string().superRefine((s, ctx) => {
    if (optional && s.trim() === '') return;
    const message = firstIssue(schema, s);
    if (message) ctx.addIssue({ code: 'custom', message });
  });
const weight = z.number().int('validation.range').min(0, 'validation.range').max(WEIGHT_MAX, 'validation.range');

const variantRowSchema = z.object({
  key: z.string(),
  id: z.string().nullable(),
  name: text(z.string().trim().min(1, 'validation.required').max(VARIANT_NAME_MAX, 'validation.length')),
  sku: text(productSku, true),
  price: digits(productPrice, true),
  costPrice: digits(productCost),
  stock: digits(stockQty),
  minStock: digits(stockQty),
  isActive: z.boolean(),
  attributes: z.record(z.string()),
});

/** `create`: the SKU may stay empty (server generates `PRD-XXXXXX`) and a tracked product without variants needs its opening stock. */
export const productFormSchema = (mode: 'create' | 'edit') =>
  z
    .object({
      name: text(productName),
      sku: text(productSku, mode === 'create'),
      keywords: z.string().superRefine((s, ctx) => {
        const list = parseKeywords(s);
        if (list.length > KEYWORDS_MAX || list.some((k) => k.length > KEYWORD_MAX_LENGTH)) ctx.addIssue({ code: 'custom', message: 'validation.length' });
      }),
      description: z.string().refine((s) => s.trim().length <= DESCRIPTION_MAX, 'validation.length'),
      price: digits(productPrice, true),
      oldPrice: digits(productPrice),
      costPrice: digits(productCost),
      trackStock: z.boolean(),
      sellOutOfStock: z.boolean(),
      stock: digits(stockQty),
      minStock: digits(stockQty),
      categoryId: z.string(),
      unitId: z.string(),
      weightGrams: digits(weight),
      isActive: z.boolean(),
      variants: z.array(variantRowSchema).max(VARIANTS_MAX, 'validation.length'),
    })
    .superRefine((v, ctx) => {
      if (mode === 'create' && v.trackStock && v.variants.length === 0 && v.stock === '') ctx.addIssue({ code: 'custom', path: ['stock'], message: 'validation.required' });
      const names = new Set<string>();
      v.variants.forEach((row, i) => {
        const k = row.name.trim().toLowerCase();
        if (k && names.has(k)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'name'], message: 'validation.invalid' });
        names.add(k);
      });
    });

/* ---------- form → payloads ---------- */
const int = (s: string): number | null => digitsToInt(s);

export function variantCreatePayload(row: VariantRow, o: { advanced: boolean; withStock?: boolean }): CreateVariantInput {
  const out: CreateVariantInput = { name: row.name.trim(), price: int(row.price) ?? 0 };
  if (row.sku.trim()) out.sku = row.sku.trim();
  if (Object.keys(row.attributes).length) out.attributes = row.attributes;
  if (o.advanced && row.costPrice !== '') out.costPrice = int(row.costPrice);
  if (o.withStock !== false && row.stock !== '') out.stock = int(row.stock) ?? 0;
  if (row.minStock !== '') out.minStock = int(row.minStock) ?? 0;
  if (!row.isActive) out.isActive = false;
  return out;
}

/** Only the fields that differ from the saved row; `{}` when nothing changed. Stock never travels here (adjustments only). */
export function variantUpdatePayload(base: VariantRow, row: VariantRow, o: { advanced: boolean }): UpdateVariantInput {
  const out: UpdateVariantInput = {};
  if (row.name.trim() !== base.name.trim()) out.name = row.name.trim();
  if (row.sku.trim() !== base.sku.trim()) out.sku = row.sku.trim() || null;
  if (row.price !== base.price) out.price = int(row.price) ?? 0;
  if (o.advanced && row.costPrice !== base.costPrice) out.costPrice = int(row.costPrice);
  if (row.minStock !== base.minStock) out.minStock = int(row.minStock) ?? 0;
  if (row.isActive !== base.isActive) out.isActive = row.isActive;
  return out;
}

/** `POST /products` body (`CreateProductSchema`, strict). The cost travels in advanced mode only. */
export function toCreatePayload(v: ProductFormValues, o: { advanced: boolean }): CreateProductInput {
  const withVariants = v.trackStock && v.variants.length > 0;
  const out: CreateProductInput = { name: v.name.trim(), price: int(v.price) ?? 0, trackStock: v.trackStock, isActive: v.isActive };
  if (v.trackStock && v.sellOutOfStock) out.sellOutOfStock = true;
  if (v.sku.trim()) out.sku = v.sku.trim();
  if (v.description.trim()) out.description = v.description.trim();
  if (v.categoryId) out.categoryId = v.categoryId;
  if (v.unitId) out.unitId = v.unitId;
  if (v.oldPrice !== '') out.oldPrice = int(v.oldPrice);
  if (o.advanced && v.costPrice !== '') out.costPrice = int(v.costPrice);
  if (v.weightGrams !== '') out.weightGrams = int(v.weightGrams);
  const keywords = parseKeywords(v.keywords);
  if (keywords.length) out.keywords = keywords;
  if (withVariants) out.variants = v.variants.map((row) => variantCreatePayload(row, o));
  else if (v.trackStock) {
    out.stock = int(v.stock) ?? 0;
    if (v.minStock !== '') out.minStock = int(v.minStock) ?? 0;
  }
  return out;
}

/** Product fields that differ from the loaded version (variants are saved through their own endpoints). */
export function changedScalars(base: ProductFormValues, v: ProductFormValues): ScalarField[] {
  return SCALAR_FIELDS.filter((k) => {
    if (k === 'stock') return false; // read-only on edit
    if (k === 'keywords') return parseKeywords(base.keywords).join('\n') !== parseKeywords(v.keywords).join('\n');
    const a = base[k];
    const b = v[k];
    return typeof a === 'string' && typeof b === 'string' ? a.trim() !== b.trim() : a !== b;
  });
}

/** `PATCH /products/:id` body (`UpdateProductSchema`, strict): changed fields + `version`. Cleared optional fields are sent as null. */
export function toUpdatePayload(base: ProductFormValues, v: ProductFormValues, version: number, o: { advanced: boolean }): UpdateProductInput {
  const out: UpdateProductInput = { version };
  for (const k of changedScalars(base, v)) {
    switch (k) {
      case 'name':
        out.name = v.name.trim();
        break;
      case 'sku':
        out.sku = v.sku.trim();
        break;
      case 'keywords':
        out.keywords = parseKeywords(v.keywords);
        break;
      case 'description':
        out.description = v.description.trim() || null;
        break;
      case 'price':
        out.price = int(v.price) ?? 0;
        break;
      case 'oldPrice':
        out.oldPrice = int(v.oldPrice);
        break;
      case 'costPrice':
        if (o.advanced) out.costPrice = int(v.costPrice);
        break;
      case 'trackStock':
        out.trackStock = v.trackStock;
        break;
      case 'sellOutOfStock':
        out.sellOutOfStock = v.sellOutOfStock;
        break;
      case 'minStock':
        out.minStock = int(v.minStock) ?? 0;
        break;
      case 'categoryId':
        out.categoryId = v.categoryId || null;
        break;
      case 'unitId':
        out.unitId = v.unitId || null;
        break;
      case 'weightGrams':
        out.weightGrams = int(v.weightGrams);
        break;
      case 'isActive':
        out.isActive = v.isActive;
        break;
    }
  }
  return out;
}

/* ---------- dirty state ---------- */
const rowDirty = (base: VariantRow | undefined, row: VariantRow, mode: 'create' | 'edit'): boolean => {
  if (!base) return true;
  return VARIANT_FIELDS.some((f) => (f === 'stock' && mode === 'edit' ? false : base[f].trim() !== row[f].trim())) || base.isActive !== row.isActive;
};

export type DirtyItem = { kind: 'field'; field: ScalarField } | { kind: 'variant'; key: string; name: string };

/** What differs from the baseline, in form order: product fields, then the variant rows that changed or are new. */
export function dirtyItems(base: ProductFormValues, v: ProductFormValues, mode: 'create' | 'edit'): DirtyItem[] {
  const out: DirtyItem[] = [];
  for (const k of SCALAR_FIELDS) {
    if (k === 'stock' && mode === 'edit') continue;
    const a = base[k];
    const b = v[k];
    const same = k === 'keywords' ? parseKeywords(base.keywords).join('\n') === parseKeywords(v.keywords).join('\n') : typeof a === 'string' && typeof b === 'string' ? a.trim() === b.trim() : a === b;
    if (!same) out.push({ kind: 'field', field: k });
  }
  const byKey = new Map(base.variants.map((r) => [r.key, r]));
  for (const row of v.variants) if (rowDirty(byKey.get(row.key), row, mode)) out.push({ kind: 'variant', key: row.key, name: row.name.trim() });
  // rows removed from an unsaved product
  if (mode === 'create') for (const r of base.variants) if (!v.variants.some((x) => x.key === r.key)) out.push({ kind: 'variant', key: r.key, name: r.name });
  return out;
}

/** "prix de revient, variante Noir · M" — the list shown in the sticky footer. */
export function dirtyLabels(items: readonly DirtyItem[], label: { field: (f: ScalarField) => string; variant: (name: string) => string }, max = 4): string[] {
  const all = items.map((i) => (i.kind === 'field' ? label.field(i.field) : label.variant(i.name)));
  return all.length > max ? [...all.slice(0, max), '…'] : all;
}

/**
 * A fresh server version arrived while the form is open: untouched fields take the server value, edited ones keep the
 * draft. Saved variant rows are matched by id (server stock always wins: it is read-only here), rows deleted on the
 * server disappear, unsaved rows stay at the end.
 */
export function rebaseForm(oldBase: ProductFormValues, newBase: ProductFormValues, v: ProductFormValues): ProductFormValues {
  const out = { ...v } as ProductFormValues;
  const copy = <K extends ScalarField>(k: K) => {
    if (k === 'stock' || v[k] === oldBase[k]) out[k] = newBase[k];
  };
  SCALAR_FIELDS.forEach(copy);
  const oldById = new Map(oldBase.variants.filter((r) => r.id).map((r) => [r.id!, r]));
  const mineById = new Map(v.variants.filter((r) => r.id).map((r) => [r.id!, r]));
  const rows: VariantRow[] = newBase.variants.map((n) => {
    const mine = n.id ? mineById.get(n.id) : undefined;
    const old = n.id ? oldById.get(n.id) : undefined;
    if (!mine) return n;
    // created by this form a moment ago: the server row (key = id) replaces the local one. Keeping the local `new-…`
    // key made the row unknown to the new baseline, so the form stayed "unsaved" after a successful save.
    if (!old) return n;
    const merged: VariantRow = { ...n, key: mine.key };
    for (const f of VARIANT_FIELDS) if (f !== 'stock' && mine[f] !== old[f]) merged[f] = mine[f];
    if (mine.isActive !== old.isActive) merged.isActive = mine.isActive;
    return merged;
  });
  out.variants = [...rows, ...v.variants.filter((r) => !r.id)];
  return out;
}

/* ---------- server `fields` paths ---------- */
export type FieldTarget = { kind: 'field'; field: ScalarField } | { kind: 'variant'; index: number; field: VariantField };

/** `sku` → the SKU input · `variants.2.sku` → the SKU of the third variant row · anything unknown → null (form-level alert). */
export function serverFieldTarget(path: string, variantCount = Number.POSITIVE_INFINITY): FieldTarget | null {
  const m = /^variants[.[](\d+)\]?\.(\w+)$/.exec(path);
  if (m) {
    const index = Number(m[1]);
    const field = m[2] as VariantField;
    return index < variantCount && (VARIANT_FIELDS as readonly string[]).includes(field) ? { kind: 'variant', index, field } : null;
  }
  return (SCALAR_FIELDS as readonly string[]).includes(path) ? { kind: 'field', field: path as ScalarField } : null;
}
export const targetPath = (t: FieldTarget): string => (t.kind === 'field' ? t.field : `variants.${t.index}.${t.field}`);

/* ---------- "Créer depuis une photo" (CAT-07, AT-CAT-10) ---------- */
export type AiFillField = 'name' | 'description' | 'categoryId' | 'unitId';
export type AiFillPatch = Partial<Pick<ProductFormValues, AiFillField>>;

/**
 * The suggestion fills ONLY the fields that are still empty — never a price, whatever the answer carries.
 * A category / unit id unknown to the workspace lists is ignored.
 */
export function mergeAiFill(v: ProductFormValues, r: Partial<AiFillResult> | null | undefined, known: { categoryIds: readonly string[]; unitIds: readonly string[] }): { patch: AiFillPatch; filled: AiFillField[] } {
  const patch: AiFillPatch = {};
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  if (!v.name.trim() && str(r?.name)) patch.name = str(r?.name).slice(0, 255);
  if (!v.description.trim() && str(r?.description)) patch.description = str(r?.description).slice(0, DESCRIPTION_MAX);
  if (!v.categoryId && str(r?.categoryId) && known.categoryIds.includes(str(r?.categoryId))) patch.categoryId = str(r?.categoryId);
  if (!v.unitId && str(r?.unitId) && known.unitIds.includes(str(r?.unitId))) patch.unitId = str(r?.unitId);
  return { patch, filled: Object.keys(patch) as AiFillField[] };
}

/** `{ Taille: ['S','M'], Couleur: 'Noir' }` → `['Taille : S, M', 'Couleur : Noir']` (hint to generate variants). */
export function attributeHints(attributes: AiFillResult['attributes'] | null | undefined): string[] {
  return Object.entries(attributes ?? {})
    .map(([name, values]) => ({ name: name.trim(), values: (Array.isArray(values) ? values : [values]).map((x) => String(x ?? '').trim()).filter(Boolean) }))
    .filter((a) => a.name && a.values.length)
    .map((a) => `${a.name} : ${a.values.join(', ')}`);
}

/* ---------- moderation: rejected fields of the decision → form fields ---------- */
export type RejectedField = 'name' | 'description' | 'price' | 'categoryId' | 'images' | 'variants' | 'keywords';
const REJECTED_ALIAS: Record<string, RejectedField> = { name: 'name', title: 'name', titre: 'name', description: 'description', price: 'price', prix: 'price', category: 'categoryId', categoryid: 'categoryId', image: 'images', images: 'images', variant: 'variants', variants: 'variants', keyword: 'keywords', keywords: 'keywords' };
export const rejectedFieldSet = (fields: readonly string[] | null | undefined): Set<RejectedField> => {
  const out = new Set<RejectedField>();
  for (const f of fields ?? []) {
    const hit = REJECTED_ALIAS[String(f).toLowerCase().replace(/[\s_\-\d.[\]]/g, '')];
    if (hit) out.add(hit);
  }
  return out;
};
