// Catalogue & stock inputs (03 §8 CAT-01…11, §14 GDS-01…04/09, 04 §2, api-contract §3.5, 06 §8.6).
// One source for the API (nestjs-zod DTOs) and the web forms. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import type { ActionDescriptor } from './common';

// --- limits (spec values) ---------------------------------------------------------------------------------------------
export const PRODUCT_IMAGES_MAX = 10; // CAT-02, IMAGES_LIMIT
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MIN_PX = 600; // warning IMAGE_SMALL below
export const VARIANTS_MAX = 100; // VARIANT_LIMIT
export const IMPORT_MAX_ROWS = 2000; // CAT-06, IMPORT_TOO_LARGE
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const BULK_MAX_IDS = 500;
export const AI_FILL_MAX_PHOTOS = 5;
const MAX_MONEY = 100_000_000;
const MAX_QTY = 10_000_000;

// --- primitives ---------------------------------------------------------------------------------------------------------
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
/** Required text: a missing key and an empty input give the same `validation.required`. */
const text = (max: number) => z.string({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).trim().min(1, 'validation.required').max(max, 'validation.length');
const int = (key: string) => z.number({ invalid_type_error: key, required_error: 'validation.required' }).int(key);
/** 04 §2: selling price = integer DA > 0. */
export const productPrice = int('validation.price').gt(0, 'validation.price').max(MAX_MONEY, 'validation.price');
/** 04 §2: cost price = integer DA ≥ 0, optional. */
export const productCost = int('validation.price').min(0, 'validation.price').max(MAX_MONEY, 'validation.price');
export const stockQty = int('validation.quantity').min(0, 'validation.quantity').max(MAX_QTY, 'validation.quantity');
export const productName = text(255);
export const productSku = text(255);
/** Forms send '' for "no value": '' and null both clear the field. */
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
const keywords = z.array(z.string().trim().min(1, 'validation.required').max(50, 'validation.length')).max(30, 'validation.length');
const attributes = z.record(z.string().trim().min(1).max(50), z.string().trim().min(1, 'validation.required').max(80, 'validation.length'));

// --- variants (CAT-03) --------------------------------------------------------------------------------------------------
const variantFields = {
  name: text(120),
  sku: emptyToNull(productSku),
  attributes: attributes.optional(),
  price: productPrice,
  costPrice: productCost.nullable().optional(),
  minStock: stockQty.optional(),
  isActive: z.boolean().optional(),
};
/** `POST /products/:id/variants` and the `variants[]` of `POST /products`. `stock` = opening quantity (movement `in`, reason `initial`). */
export const CreateVariantSchema = z.object({ ...variantFields, stock: stockQty.optional() }).strict();
/** `PATCH /products/:id/variants/:vid` — stock only moves through `POST /stock/adjustments`. */
export const UpdateVariantSchema = z.object(variantFields).partial().strict();
/** `POST /products/:id/variants/generate` [FIG DLG Générer des variantes]. */
export const GenerateVariantsSchema = z
  .object({
    attributes: z
      .array(
        z
          .object({
            name: text(50),
            values: z.array(text(80), { required_error: 'validation.required' }).min(1, 'validation.required').max(50, 'validation.length'),
          })
          .strict(),
      )
      .min(1, 'validation.required')
      .max(3, 'validation.length'),
    defaultPrice: productPrice,
    defaultStock: stockQty,
  })
  .strict();
export type CreateVariantInput = z.infer<typeof CreateVariantSchema>;
export type UpdateVariantInput = z.infer<typeof UpdateVariantSchema>;
export type GenerateVariantsInput = z.infer<typeof GenerateVariantsSchema>;

// --- products (CAT-01) --------------------------------------------------------------------------------------------------
const productFields = {
  /** omitted or '' on create ⇒ the server generates `PRD-XXXXXX` */
  sku: emptyToNull(productSku),
  name: productName,
  description: emptyToNull(z.string().trim().max(5000, 'validation.length')),
  categoryId: emptyToNull(id),
  unitId: emptyToNull(id),
  /** false = service / digital product (CAT-11): no quantity, excluded from every stock metric */
  trackStock: z.boolean().optional(),
  /** accept orders at zero stock (backorder, PV 22/10): the stock may go below 0 for orders; ignored for services */
  sellOutOfStock: z.boolean().optional(),
  price: productPrice,
  oldPrice: productPrice.nullable().optional(),
  costPrice: productCost.nullable().optional(),
  minStock: stockQty.optional(),
  weightGrams: int('validation.range').min(0, 'validation.range').max(1_000_000, 'validation.range').nullable().optional(),
  keywords: keywords.optional(),
  isActive: z.boolean().optional(),
};
/**
 * `POST /products`. `stock` is the opening quantity: required for a tracked product without variants (CAT-01),
 * ignored for services and for variant products (their stock is the sum of the active variants).
 */
export const CreateProductSchema = z
  .object({
    ...productFields,
    stock: stockQty.nullable().optional(),
    variants: z.array(CreateVariantSchema).max(VARIANTS_MAX, 'validation.length').optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const tracked = v.trackStock !== false;
    const withVariants = (v.variants?.length ?? 0) > 0;
    if (tracked && !withVariants && (v.stock === undefined || v.stock === null)) {
      ctx.addIssue({ code: 'custom', path: ['stock'], message: 'validation.required' });
    }
    if (!tracked && withVariants) ctx.addIssue({ code: 'custom', path: ['variants'], message: 'validation.invalid' });
    const names = new Set<string>();
    v.variants?.forEach((x, i) => {
      const k = x.name.toLowerCase();
      if (names.has(k)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'name'], message: 'validation.invalid' });
      names.add(k);
    });
  });
/** `PATCH /products/:id` — same rules as create (CAT-01), `version` required (api-contract §1.8); stock moves only by adjustment. */
export const UpdateProductSchema = z
  .object(productFields)
  .partial()
  .extend({ version: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).int().min(1) })
  .strict();
/** `POST /products/:id/duplicate` [FIG DLG Dupliquer le produit]. */
export const DuplicateProductSchema = z
  .object({ name: productName, copyImages: z.boolean().optional(), copyVariants: z.boolean().optional(), copyCost: z.boolean().optional() })
  .strict();
/** `POST /products/:id/restore` — `sku` = the replacement typed in the "SKU déjà utilisé" dialog when the old one was reused. */
export const RestoreProductSchema = z.object({ sku: emptyToNull(productSku) }).strict();
export type RestoreProductInput = z.infer<typeof RestoreProductSchema>;
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
export type DuplicateProductInput = z.infer<typeof DuplicateProductSchema>;

// --- images (CAT-02) ----------------------------------------------------------------------------------------------------
export const UpdateProductImageSchema = z
  .object({ isPrimary: z.literal(true).optional(), altText: emptyToNull(z.string().trim().max(255, 'validation.length')) })
  .strict();
export const ReorderProductImagesSchema = z.object({ ids: z.array(id).min(1, 'validation.required').max(PRODUCT_IMAGES_MAX) }).strict();
export type UpdateProductImageInput = z.infer<typeof UpdateProductImageSchema>;

// --- categories & units (CAT-04) ----------------------------------------------------------------------------------------
const categoryFields = {
  name: text(80),
  description: emptyToNull(z.string().trim().max(500, 'validation.length')),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'validation.invalid')
    .optional(),
  /** 2 levels max: the parent must be a root category (CATEGORY_DEPTH_EXCEEDED) */
  parentId: emptyToNull(id),
  imageUploadId: emptyToNull(id),
};
export const CreateCategorySchema = z.object(categoryFields).strict();
export const UpdateCategorySchema = z.object(categoryFields).partial().strict();
const unitFields = {
  name: text(50),
  abbreviation: text(10),
  /** "Boîte de 6 = 6 × Pièce": `containsQty` × `baseUnitId` */
  containsQty: int('validation.quantity').min(1, 'validation.quantity').max(MAX_QTY, 'validation.quantity').nullable().optional(),
  baseUnitId: emptyToNull(id),
};
export const CreateUnitSchema = z.object(unitFields).strict();
export const UpdateUnitSchema = z.object(unitFields).partial().strict();
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type CreateUnitInput = z.infer<typeof CreateUnitSchema>;
export type UpdateUnitInput = z.infer<typeof UpdateUnitSchema>;

// --- stock (CAT-05, GDS-02/03) ------------------------------------------------------------------------------------------
export const STOCK_ADJUSTMENT_TYPES = ['in', 'out', 'set'] as const;
/** Reasons a person may pick in the adjust dialog (subset of `MovementReason`). */
export const STOCK_ADJUSTMENT_REASONS = ['breakage', 'loss', 'initial', 'inventory', 'correction', 'other'] as const;
/** `POST /stock/adjustments` (Idempotency-Key required). `set` = exact quantity, the server computes the delta. */
export const StockAdjustmentSchema = z
  .object({
    productId: id,
    variantId: emptyToNull(id),
    type: z.enum(STOCK_ADJUSTMENT_TYPES, { errorMap: () => ({ message: 'validation.invalid' }) }),
    quantity: stockQty,
    reason: z.enum(STOCK_ADJUSTMENT_REASONS, { errorMap: () => ({ message: 'validation.required' }) }),
    note: emptyToNull(z.string().trim().max(255, 'validation.length')),
    /** Admin+: lets `out` go below zero */
    force: z.boolean().optional(),
  })
  .strict();
export const ReverseMovementSchema = z.object({ note: emptyToNull(z.string().trim().max(255, 'validation.length')) }).strict();
export type StockAdjustmentInput = z.infer<typeof StockAdjustmentSchema>;

// --- bulk actions (06 §8.6) ---------------------------------------------------------------------------------------------
const ids = z.array(id, { required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).min(1, 'validation.required').max(BULK_MAX_IDS, 'validation.length');
export const BulkIdsSchema = z.object({ ids }).strict();
export const BulkCategorySchema = z.object({ ids, categoryId: id.nullable() }).strict();
export const BulkAgentSchema = z.object({ ids, agentId: id }).strict();
export const BulkMinStockSchema = z.object({ ids, minStock: stockQty }).strict();
export const BulkArchiveSchema = z.object({ ids, releaseStock: z.boolean().optional() }).strict();
export const BulkPriceSchema = z
  .object({
    ids,
    op: z.enum(['increase', 'decrease', 'set'], { errorMap: () => ({ message: 'validation.invalid' }) }),
    value: int('validation.price').min(0, 'validation.price').max(MAX_MONEY, 'validation.price'),
    unit: z.enum(['percent', 'dzd'], { errorMap: () => ({ message: 'validation.invalid' }) }),
    roundUpTens: z.boolean().optional(),
    applyToVariants: z.boolean().optional(),
    /** true ⇒ nothing is written; the per-item results carry the computed prices */
    preview: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.op === 'set' && v.unit !== 'dzd') ctx.addIssue({ code: 'custom', path: ['unit'], message: 'validation.invalid' });
    if (v.unit === 'percent' && v.value > 1000) ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.range' });
  });
export type BulkPriceInput = z.infer<typeof BulkPriceSchema>;

/** New price of one line of `POST /products/bulk/price` (integer DA; `roundUpTens` rounds up to the next 10 DA). */
export const computeBulkPrice = (current: number, o: Pick<BulkPriceInput, 'op' | 'value' | 'unit' | 'roundUpTens'>): number => {
  let next: number;
  if (o.op === 'set') next = o.value;
  else {
    // half-up on integer arithmetic: floor((2·a·b + 100) / 200)
    const delta = o.unit === 'percent' ? Math.floor((2 * current * o.value + 100) / 200) : o.value;
    next = o.op === 'increase' ? current + delta : current - delta;
  }
  return o.roundUpTens ? Math.ceil(next / 10) * 10 : next;
};

// --- import (CAT-06, FL-12) ---------------------------------------------------------------------------------------------
/** Target fields of the column-mapping dialog; `name` and `price` are required. */
export const IMPORT_FIELDS = ['sku', 'name', 'description', 'category', 'unit', 'price', 'oldPrice', 'costPrice', 'stock', 'minStock', 'weightGrams', 'keywords', 'isActive'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_REQUIRED_FIELDS: readonly ImportField[] = ['name', 'price'];
/** `POST /products/import/mapping` — `mapping[field]` = header of the file column (null / absent = not imported). */
export const ImportMappingSchema = z
  .object({
    jobId: id,
    mapping: z.record(z.enum(IMPORT_FIELDS), z.string().trim().min(1).max(255).nullable()),
    /** rows whose SKU already exists update the product instead of being reported as an error */
    updateExisting: z.boolean().optional(),
    saveMapping: z.boolean().optional(),
  })
  .strict();
export type ImportMappingInput = z.infer<typeof ImportMappingSchema>;

// --- expenses & margins (GDS-09, EXP-01/02) -------------------------------------------------------------------------------
export const EXPENSE_CATEGORIES = ['marketing', 'shipping', 'packaging', 'customs', 'storage', 'other'] as const;
const expenseFields = {
  category: z.enum(EXPENSE_CATEGORIES, { errorMap: () => ({ message: 'validation.required' }) }),
  description: emptyToNull(z.string().trim().max(1000, 'validation.length')),
  amount: productPrice,
  /** true = per unit sold; false = fixed amount spread over the units sold in the period */
  isPerUnit: z.boolean({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'validation.date')
    .optional(),
};
export const CreateProductExpenseSchema = z.object(expenseFields).strict();
export const UpdateProductExpenseSchema = z.object(expenseFields).partial().strict();
export type CreateProductExpenseInput = z.infer<typeof CreateProductExpenseSchema>;
/** `GET|POST /products/:id/expenses`, `PATCH /products/:id/expenses/:eid` (GDS-09, EXP-01). */
export type ProductExpenseView = { id: string; productId: string; category: (typeof EXPENSE_CATEGORIES)[number]; description: string | null; amount: number; isPerUnit: boolean; date: string; createdAt: string; actions: ActionDescriptor[] };
/** `GET /products/:id/margins` (EXP-02): true cost = weighted cost + expenses per unit; margin % on the price. */
export type ProductMarginsView = { weightedCost: number | null; expensesPerUnit: number; trueCost: number | null; marginDzd: number | null; marginPct: number | null; sales30d: { units: number; revenue: number } };

// --- moderation, merchant side (06 §8.2) ----------------------------------------------------------------------------------
export const ProductAppealSchema = z
  .object({ message: text(500), attachmentUploadId: emptyToNull(id) })
  .strict();

// --- list query values (06 §10 "Produits", "Mouvements") --------------------------------------------------------------------
export const PRODUCT_SORTS = ['name', 'sku', 'price', 'cost', 'stock', 'updatedAt'] as const;
export const PRODUCT_STATUS_FILTERS = ['active', 'inactive', 'archived'] as const;
export const PRODUCT_TYPE_FILTERS = ['stock', 'service', 'variants', 'no_variants'] as const;
export const PRODUCT_STOCK_STATE_FILTERS = ['low', 'out', 'in_stock'] as const;

// --- read models (api-contract §3.5) ----------------------------------------------------------------------------------------
export type StockState = 'ok' | 'low' | 'out' | 'untracked';
export type ProductModerationPill = { status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'appealed'; etaLabel?: string; reason?: string };
export type CategoryRefView = { id: string; name: string; color: string };
export type UnitRefView = { id: string; abbreviation: string };
export type ProductListItemView = {
  id: string;
  sku: string;
  name: string;
  category: CategoryRefView | null;
  unit: UnitRefView | null;
  price: number;
  oldPrice: number | null;
  costPrice: number | null;
  /** products with variants: the lowest margin of the active variants, each on its own price and cost (PV 26/10 P4) */
  marginPct: number | null;
  /** products with variants: lowest and highest margin % of the active variants (null when no cost is known) */
  marginRange: { min: number; max: number } | null;
  trackStock: boolean;
  /** orders accepted at zero stock (PV 22/10) */
  sellOutOfStock: boolean;
  stock: number | null;
  minStock: number;
  stockState: StockState;
  hasVariants: boolean;
  variantSummary: string | null;
  /** products with variants: lowest and highest price of the active variants (the base price is not sold on its own) */
  priceRange: { min: number; max: number } | null;
  isActive: boolean;
  archived: boolean;
  primaryImageUrl: string | null;
  aiState: 'proposed' | 'excluded';
  moderation: ProductModerationPill | null;
  createdAt: string;
  updatedAt: string;
  actions: ActionDescriptor[];
};
export type VariantView = {
  id: string;
  name: string;
  sku: string | null;
  attributes: Record<string, string>;
  price: number;
  costPrice: number | null;
  stock: number;
  minStock: number;
  isActive: boolean;
  stockState: 'ok' | 'low' | 'out';
};
export type ProductImageView = {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  isPrimary: boolean;
  altText: string | null;
  aiCaption: string | null;
  moderationFlag: string | null;
  /** false while the `media.reencode-image` job has not produced the normalised file yet ("ENVOI…") */
  processed: boolean;
  /** product detail: a picture added to an approved product and not approved yet — « EN ATTENTE DE VALIDATION » (UX-039) */
  awaitingReview?: boolean;
};
export type ModerationDetailView = {
  status: string;
  submittedAt: string;
  decidedAt: string | null;
  decision: string | null;
  merchantMessage: string | null;
  rejectedFields: string[];
  rules: string[];
  history: { at: string; status: string; actor: 'system' | 'moderator' | 'merchant'; note: string | null }[];
  appeal: { status: 'available' | 'used' | 'expired'; deadlineAt: string | null; decision: string | null };
};
export type ProductView = ProductListItemView & {
  description: string | null;
  weightGrams: number | null;
  keywords: string[];
  images: ProductImageView[];
  variants: VariantView[];
  stock: number | null;
  stockDetail: { total: number | null; reserved: number; availableForAi: number; lastInventoryAt: string | null };
  pricing: {
    weightedCost: number | null;
    expensesPerUnit: number;
    trueCost: number | null;
    marginDzd: number | null;
    marginPct: number | null;
    sales30d: { units: number; revenue: number };
    /** PV 26/10 P4: products with variants — the margin of each active variant on its own price (cost: the variant's, else the product's) */
    variants?: { id: string; name: string; price: number; weightedCost: number | null; trueCost: number | null; marginDzd: number | null; marginPct: number | null }[];
  };
  agents: { id: string; name: string }[];
  mentions30d: { conversations: number; orders: number };
  moderationDetail: ModerationDetailView | null;
  contentVersion: number;
  version: number;
};
export type CategoryView = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  parentId: string | null;
  imageUrl: string | null;
  productCount: number;
  children: CategoryView[];
  createdAt: string;
  updatedAt: string;
  actions: ActionDescriptor[];
};
export type UnitView = {
  id: string;
  name: string;
  abbreviation: string;
  isSystem: boolean;
  containsQty: number | null;
  baseUnitId: string | null;
  productCount: number;
  actions: ActionDescriptor[];
};
export type StockMovementView = {
  id: string;
  product: { id: string; name: string; sku: string; price: number; primaryImageUrl: string | null; hasVariants: boolean; trackStock: boolean };
  variant: { id: string; name: string } | null;
  type: 'in' | 'out' | 'adjustment_in' | 'adjustment_out' | 'inventory' | 'return';
  quantity: number;
  before: number;
  after: number;
  reason: string | null;
  note: string | null;
  reference: { type: string; id: string; label: string } | null;
  actor: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  reversed: boolean;
  createdAt: string;
  actions: ActionDescriptor[];
};
export type ImportPreviewRow = {
  row: number;
  ok: boolean;
  action: 'create' | 'update' | 'skip';
  values: Partial<Record<ImportField, string | number | boolean | null>>;
  errors: { field: ImportField | null; code: string; params?: Record<string, string | number> }[];
};
export type ImportPreviewResult = {
  stage: 'mapping' | 'preview' | 'committed';
  fileName: string;
  headers: string[];
  mapping: Partial<Record<ImportField, string | null>>;
  missingColumns: ImportField[];
  updateExisting: boolean;
  totals: { rows: number; valid: number; invalid: number; create: number; update: number; overPlanLimit: number; newCategories: number };
  rows: ImportPreviewRow[];
  report?: { created: number; updated: number; skipped: number; categoriesCreated: number };
};
