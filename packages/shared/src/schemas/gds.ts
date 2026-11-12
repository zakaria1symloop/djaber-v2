// GDS operations (03 §14 GDS-05…09, §31 INV, §32 EXP, §33 CSH; 04 §3, §4, §9, §10, §19, §20; api-contract §3.9, §4
// PurchasesQuery / SalesQuery / SuppliersQuery / CashQuery; 06 "GDS operations", §8.6, §10). One source for the API
// (nestjs-zod DTOs), the web and the mobile app. Field names = contract names. Messages = i18n keys. Money = integer DZD.
import { z } from 'zod';
import {
  CashCategoryValues,
  CashMethodValues,
  CashTypeValues,
  GdsPaymentStatusValues,
  InventoryScopeValues,
  InventoryStatusValues,
  PaymentMethodValues,
  PurchaseStatusValues,
  SaleStatusValues,
} from '../enums';
import { email, fullName, isPhoneDz, normalizePhoneDz } from '../validators';
import type { ClientRefView } from './clients';
import type { ActionDescriptor } from './common';
import type { OrderUserRef, PaymentEntryView } from './orders';

// --- enums & limits (spec values) -------------------------------------------------------------------------------------
export type PurchaseStatusName = (typeof PurchaseStatusValues)[number];
export type GdsPaymentStatusName = (typeof GdsPaymentStatusValues)[number];
export type SaleStatusName = (typeof SaleStatusValues)[number];
export type CashTypeName = (typeof CashTypeValues)[number];
export type CashCategoryName = (typeof CashCategoryValues)[number];
export type CashMethodName = (typeof CashMethodValues)[number];
/**
 * Retest 11/11 UX-055: the mode shown for a cash row — cash collected on a delivered order is « COD », as in the reports
 * (UX-052); the counter, purchases and the till keep « Espèces ». Also a value of the `method` filter of `GET /cash`.
 */
export type CashDisplayMethod = CashMethodName | 'cod';
export const CASH_DISPLAY_METHODS = ['cash', 'cod', 'ccp', 'card', 'transfer', 'other'] as const satisfies readonly CashDisplayMethod[];
export const cashDisplayMethod = (category: string, method: CashMethodName): CashDisplayMethod => (method === 'cash' && category === 'order' ? 'cod' : method);
export type InventoryScopeName = (typeof InventoryScopeValues)[number];
export type InventoryStatusName = (typeof InventoryStatusValues)[number];

export const GDS_ITEMS_MAX = 200;
/** 04 §20: a validated sale may be cancelled during 7 days (`SALE_CANNOT_CANCEL_AFTER_7D`). */
export const SALE_CANCEL_MAX_DAYS = 7;
/** 04 §20: a manual cash row is editable / deletable during 24 h (`CASH_ENTRY_EDIT_WINDOW_EXPIRED`). */
export const CASH_EDIT_WINDOW_HOURS = 24;
/** 04 §19: a variance above 10 % needs a note (`INVENTORY_VARIANCE_NOTE_REQUIRED`). */
export const INVENTORY_VARIANCE_NOTE_PCT = 10;
/**
 * 04 §20 / 03 CSH-03: categories a person may write by hand. `sale`, `order`, `purchase`, `refund` are automatic only
 * (written by the effects services); `correction` by hand = the correction of an automatic row (`correctsTransactionId`).
 */
export const CASH_MANUAL_CATEGORIES = ['deposit', 'withdrawal', 'rent', 'salary', 'utilities', 'marketing', 'shipping', 'other', 'correction'] as const;
export const CASH_AUTO_CATEGORIES = ['sale', 'order', 'purchase', 'refund'] as const;
/** 04 §20 purchase transitions (`pending` = "Commandé"); cancel from draft / pending / partial only. */
export const PURCHASE_STATUS_TRANSITIONS: Record<PurchaseStatusName, readonly PurchaseStatusName[]> = {
  draft: ['pending', 'partial', 'received', 'cancelled'],
  pending: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};
export const PURCHASE_SORTS = ['purchasedAt', 'expectedAt', 'total', 'number', 'createdAt'] as const;
export const SALE_SORTS = ['soldAt', 'total', 'number'] as const;
export const SUPPLIER_SORTS = ['name', 'balance', 'lastPurchaseAt', 'totalSpent', 'createdAt'] as const;
export const INVENTORY_SORTS = ['startedAt', 'number'] as const;
export const GDS_PERIODS = ['today', '7d', '30d', 'month', 'last_month', '90d', 'year', 'custom'] as const;

/** 04 §1.4 applied to GDS documents: 0 ⇒ unpaid (paid when total = 0), ≥ total ⇒ paid, else partial. */
export const deriveGdsPaymentStatus = (amountPaid: number, total: number): GdsPaymentStatusName => {
  const paid = Math.max(0, Math.min(amountPaid, total));
  if (total <= 0) return 'paid';
  if (paid <= 0) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
};
/** 04 §20 / AT-GDS-16: weighted-average cost at a receipt, integer DA half-up; a null cost counts as 0. */
export const weightedAverageCost = (stockBefore: number, costBefore: number | null, receivedQty: number, unitCost: number): number => {
  const stock = Math.max(stockBefore, 0);
  if (stock + receivedQty <= 0) return unitCost;
  return Math.floor((stock * (costBefore ?? 0) + receivedQty * unitCost) / (stock + receivedQty) + 0.5);
};
/** 04 §19: |difference| / max(expected, 1), in whole percent (truncated: AT-INV-02 "3 → 1 (66 %)"). */
export const inventoryVariancePct = (expected: number, counted: number): number => Math.floor((Math.abs(counted - expected) * 100) / Math.max(expected, 1));
/** 04 §19: a variance above 10 % (exact ratio, not the displayed percent) needs a note. */
export const inventoryNeedsNote = (expected: number, counted: number): boolean => Math.abs(counted - expected) * 100 > INVENTORY_VARIANCE_NOTE_PCT * Math.max(expected, 1);

// --- primitives -------------------------------------------------------------------------------------------------------
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const MAX_MONEY = 100_000_000;
const money = z.number({ invalid_type_error: 'validation.price', required_error: 'validation.required' }).int('validation.price').min(0, 'validation.price').max(MAX_MONEY, 'validation.price');
const positiveMoney = money.gt(0, 'validation.price');
const quantity = z.number({ invalid_type_error: 'validation.quantity', required_error: 'validation.required' }).int('validation.quantity').min(1, 'validation.quantity').max(100_000, 'validation.quantity');
const countQty = z.number({ invalid_type_error: 'validation.quantity', required_error: 'validation.required' }).int('validation.quantity').min(0, 'validation.quantity').max(1_000_000, 'validation.quantity');
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
const text = (max: number) => z.string().trim().max(max, 'validation.length');
const phone = z
  .string({ required_error: 'validation.required', invalid_type_error: 'validation.phone' })
  .transform(normalizePhoneDz)
  .refine(isPhoneDz, 'validation.phone');
const instant = z.string({ invalid_type_error: 'validation.date' }).datetime({ offset: true, message: 'validation.date' });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'validation.date');
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v), z.boolean());
const q = z.string().trim().max(120, 'validation.length').optional();
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .refine((n) => n === 25 || n === 50 || n === 100, 'validation.range')
    .default(25),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z]+$/)
    .optional(),
  view: id.optional(),
};

// =====================================================================================================================
// Suppliers (GDS-05 · FIG GDS-06, DLG GDS "Nouveau fournisseur", "Enregistrer un paiement fournisseur")
// =====================================================================================================================
const supplierFields = {
  name: z.string({ required_error: 'validation.required' }).trim().min(2, 'validation.name').max(120, 'validation.length'),
  email: emptyToNull(email),
  phone: emptyToNull(phone),
  address: emptyToNull(text(500)),
  notes: emptyToNull(text(2000)),
  /** free text of the terms ("Paiement à 30 j · remise 5 % > 100 000 DA") */
  terms: emptyToNull(text(500)),
  paymentTermsDays: z.number().int('validation.range').min(0, 'validation.range').max(365, 'validation.range').nullable().optional(),
  /** declared lead time; the sheet also shows the measured one (`leadDaysMeasured`) */
  avgLeadDays: z.number().int('validation.range').min(0, 'validation.range').max(365, 'validation.range').nullable().optional(),
  isActive: z.boolean().optional(),
};
export const CreateSupplierSchema = z.object(supplierFields).strict();
export const UpdateSupplierSchema = z.object(supplierFields).partial().strict();
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;

/**
 * `POST /suppliers/:id/payments` (Idempotency-Key optional) — 04 §20: allocated to `purchaseId`, else to the oldest
 * purchases with something due (purchasedAt asc). `amount` > what is due ⇒ 422 VALIDATION_ERROR `fields.amount`.
 * One PaymentEntry + one locked cash row (`category=purchase`, `sourceType=payment_entry`) per purchase touched.
 */
export const SupplierPaymentSchema = z
  .object({
    amount: positiveMoney,
    method: z.enum(PaymentMethodValues).default('cash'),
    /** a purchase of this supplier; omitted / null = oldest first */
    purchaseId: emptyToNull(id),
    reference: emptyToNull(text(120)),
    note: emptyToNull(text(500)),
    paidAt: instant.optional(),
  })
  .strict();
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentSchema>;

export const SuppliersQuerySchema = z
  .object({
    ...paging,
    hasBalance: flag.optional(),
    /** a purchase made inside the period */
    lastPurchase: z.enum(GDS_PERIODS).optional(),
    isActive: flag.optional(),
    q,
  })
  .strict();
export type SuppliersQuery = z.infer<typeof SuppliersQuerySchema>;

export type SupplierRefView = { id: string; name: string };
export type SupplierListItemView = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  /** purchases not cancelled (draft excluded) */
  purchaseCount: number;
  /** "ACHATS (12 M)" column: count · total of the purchases of the last 12 months (cancelled excluded) */
  purchases12m: { count: number; total: number };
  /** GDS-05 fix: Σ total of the purchases, cancelled and drafts excluded */
  totalSpent: number;
  /** "SOLDE DÛ": Σ (total − amountPaid) of pending / partial / received purchases */
  balance: number;
  lastPurchaseAt: string | null;
  createdAt: string;
  actions: ActionDescriptor[];
};
export type SupplierView = SupplierListItemView & {
  address: string | null;
  notes: string | null;
  terms: string | null;
  paymentTermsDays: number | null;
  avgLeadDays: number | null;
  /** measured: average days between purchasedAt and receivedAt of the received purchases (null without any) */
  leadDaysMeasured: number | null;
  /** distinct products bought from this supplier ("Voir les produits (14)") */
  productCount: number;
  recentPurchases: PurchaseListItemView[];
  updatedAt: string;
};

// =====================================================================================================================
// Purchases (GDS-06 · FIG GDS-07, CAT-11 / GDS-06b, DLG GDS II "Achats — verrous")
// =====================================================================================================================
export const PurchaseItemInputSchema = z
  .object({
    productId: id,
    /** required when the product has variants (422 VARIANT_REQUIRED); untracked products ⇒ 422 PURCHASE_UNTRACKED_PRODUCT */
    variantId: emptyToNull(id),
    quantity,
    unitCost: money,
  })
  .strict();
export type PurchaseItemInput = z.infer<typeof PurchaseItemInputSchema>;
const purchaseItems = z.array(PurchaseItemInputSchema, { required_error: 'validation.required' }).min(1, 'validation.required').max(GDS_ITEMS_MAX, 'validation.length');

/**
 * `POST /purchases` (Idempotency-Key required). `status=pending` = created already "Commandé". `amountPaid` > 0 records
 * a first payment (PaymentEntry + locked cash expense). `purchasedAt` ≤ now + 1 day (04 §2).
 */
export const CreatePurchaseSchema = z
  .object({
    supplierId: emptyToNull(id),
    items: purchaseItems,
    tax: money.optional(),
    shippingCost: money.optional(),
    paymentMethod: z.enum(PaymentMethodValues).nullable().optional(),
    amountPaid: money.optional(),
    supplierInvoiceRef: emptyToNull(text(120)),
    notes: emptyToNull(text(2000)),
    purchasedAt: instant.optional(),
    expectedAt: emptyToNull(instant),
    status: z.enum(['draft', 'pending']).default('draft'),
  })
  .strict();
export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>;

/**
 * `PATCH /purchases/:id` — items / supplier / tax / shipping only while `draft|pending` (else 409 CONFLICT
 * `details.reason=PURCHASE_LOCKED`); notes, expectedAt, supplierInvoiceRef while not cancelled
 * (cancelled ⇒ 422 PURCHASE_CANCELLED_PAYMENT_LOCKED).
 */
export const UpdatePurchaseSchema = z
  .object({
    supplierId: emptyToNull(id),
    items: purchaseItems.optional(),
    tax: money.optional(),
    shippingCost: money.optional(),
    paymentMethod: z.enum(PaymentMethodValues).nullable().optional(),
    supplierInvoiceRef: emptyToNull(text(120)),
    notes: emptyToNull(text(2000)),
    purchasedAt: instant.optional(),
    expectedAt: emptyToNull(instant),
  })
  .strict();
export type UpdatePurchaseInput = z.infer<typeof UpdatePurchaseSchema>;

/**
 * `POST /purchases/:id/receive` (Idempotency-Key required) `[FIG GDS-07 "Réceptionner #ACH-…"]`.
 * `items[].receivedQty` = units received NOW for that line (0 = nothing for it); `unitCost` overrides the line cost.
 * `newItems` = lines added in the dialog ("ligne ajoutée", ordered 0). Over-receipt accepted: the line quantity is raised,
 * `meta.warnings` gets `PURCHASE_OVER_RECEIVE {ordered, received}`. Stock `in` movements + weighted-average cost.
 */
export const ReceivePurchaseSchema = z
  .object({
    items: z
      .array(z.object({ id, receivedQty: countQty, unitCost: money.optional() }).strict())
      .max(GDS_ITEMS_MAX, 'validation.length')
      .default([]),
    newItems: z
      .array(z.object({ productId: id, variantId: emptyToNull(id), receivedQty: quantity, unitCost: money }).strict())
      .max(GDS_ITEMS_MAX, 'validation.length')
      .optional(),
    receivedAt: instant.optional(),
    supplierInvoiceRef: emptyToNull(text(120)),
    paymentNow: z.object({ amount: positiveMoney, method: z.enum(PaymentMethodValues).default('cash') }).strict().nullable().optional(),
  })
  .strict();
export type ReceivePurchaseInput = z.infer<typeof ReceivePurchaseSchema>;

/** `POST /purchases/:id/cancel` — 409 PURCHASE_ALREADY_RECEIVED once fully received (04 §20). */
export const CancelPurchaseSchema = z.object({ reason: emptyToNull(text(500)) }).strict();
export type CancelPurchaseInput = z.infer<typeof CancelPurchaseSchema>;
/** `POST /purchases/:id/payments` (Idempotency-Key required) — ≤ remaining; cancelled ⇒ 422 PURCHASE_CANCELLED_PAYMENT_LOCKED. */
export const GdsPaymentSchema = z
  .object({ amount: positiveMoney, method: z.enum(PaymentMethodValues).default('cash'), reference: emptyToNull(text(120)), note: emptyToNull(text(500)), paidAt: instant.optional() })
  .strict();
export type GdsPaymentInput = z.infer<typeof GdsPaymentSchema>;

export const PurchasesQuerySchema = z
  .object({
    ...paging,
    status: csv(z.enum(PurchaseStatusValues)).optional(),
    supplierId: csv(id).optional(),
    paymentStatus: csv(z.enum(GdsPaymentStatusValues)).optional(),
    /** expectedAt < now ∧ status ∈ pending|partial */
    late: flag.optional(),
    productId: id.optional(),
    period: z.enum(GDS_PERIODS).optional(),
    from: day.optional(),
    to: day.optional(),
    q,
  })
  .strict();
export type PurchasesQuery = z.infer<typeof PurchasesQuerySchema>;
/** `GET /purchases/stats` — same filters as the list. */
export const PurchaseStatsQuerySchema = PurchasesQuerySchema.omit({ page: true, pageSize: true, sort: true });
/** `GET /purchases/export` (M8, Figma GDS-07 "Exporter"): the list filters + `format` → 202 `{ jobId }`. */
export const PurchasesExportQuerySchema = PurchasesQuerySchema.omit({ page: true, pageSize: true }).extend({ format: z.enum(['csv', 'xlsx']).default('csv') }).strict();
export type PurchasesExportQuery = z.infer<typeof PurchasesExportQuerySchema>;

export type GdsProductRef = { id: string; name: string; sku: string; price: number; primaryImageUrl: string | null; hasVariants: boolean; trackStock: boolean };
export type PurchaseItemView = {
  id: string;
  product: GdsProductRef;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  receivedQty: number;
  /** quantity − receivedQty (≥ 0) */
  remainingQty: number;
  unitCost: number;
  total: number;
};
export type PurchaseListItemView = {
  id: string;
  number: string;
  supplier: SupplierRefView | null;
  status: PurchaseStatusName;
  itemCount: number;
  /** Σ quantity / Σ receivedQty ("PARTIEL 8/12") */
  units: { ordered: number; received: number };
  total: number;
  amountPaid: number;
  remaining: number;
  paymentStatus: GdsPaymentStatusName;
  purchasedAt: string;
  expectedAt: string | null;
  receivedAt: string | null;
  late: boolean;
  actions: ActionDescriptor[];
};
export type PurchaseView = PurchaseListItemView & {
  supplierInvoiceRef: string | null;
  items: PurchaseItemView[];
  subtotal: number;
  tax: number;
  shippingCost: number;
  paymentMethod: (typeof PaymentMethodValues)[number] | null;
  payments: PaymentEntryView[];
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: OrderUserRef | null;
  createdAt: string;
  updatedAt: string;
};
/** `[FIG GDS-07 KPIs]` — follow the filters except `late` / `pendingReceipt` / `drafts` (workspace-wide counters). */
export type PurchaseStatsView = {
  /** pending | partial */
  pendingReceipt: number;
  late: number;
  /** Σ remaining of pending / partial / received purchases · suppliers concerned */
  dueToSuppliers: number;
  suppliersWithBalance: number;
  /** Σ total of the purchases of the period (default 30 d), cancelled excluded; delta vs the previous period */
  purchased: number;
  purchasedPrevious: number;
  purchasedDeltaPct: number | null;
  drafts: number;
  count: number;
};

// =====================================================================================================================
// Sales (GDS-07 · FIG GDS-08, DLG GDS "Annuler la vente", "Encaisser le reste", DLG GDS II "Ventes — verrous")
// =====================================================================================================================
export const SaleItemInputSchema = z
  .object({
    productId: id,
    /** required when the product has variants (422 VARIANT_REQUIRED) */
    variantId: emptyToNull(id),
    quantity,
    /** defaults to the catalogue price; an edited price is snapshotted next to the catalogue price (margin report) */
    unitPrice: money.optional(),
    discount: money.optional(),
  })
  .strict();
export type SaleItemInput = z.infer<typeof SaleItemInputSchema>;
const saleItems = z.array(SaleItemInputSchema, { required_error: 'validation.required' }).min(1, 'validation.required').max(GDS_ITEMS_MAX, 'validation.length');

/**
 * `POST /sales` (Idempotency-Key required). Client optional: `clientId`, or `client { name, phone }` found by phone or
 * created ("nouveau client créé si introuvable"). `amountPaid` < total needs a client (422 SALE_PARTIAL_REQUIRES_CUSTOMER);
 * `amountPaid` > total is clamped (the change is given back: "RENDU"). `status=draft` = "Brouillon" (no stock, no cash).
 * 409 SALE_BLOCKED_BY_INVENTORY while a blocking count is open; 422 SALE_INSUFFICIENT_STOCK {product, available}.
 */
export const CreateSaleSchema = z
  .object({
    clientId: emptyToNull(id),
    client: z.object({ name: fullName, phone }).strict().nullable().optional(),
    items: saleItems,
    discount: money.optional(),
    tax: money.optional(),
    paymentMethod: z.enum(PaymentMethodValues).default('cash'),
    amountPaid: money.default(0),
    notes: emptyToNull(text(2000)),
    soldAt: instant.optional(),
    status: z.enum(['draft', 'completed']).default('completed'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.clientId && v.client) ctx.addIssue({ code: 'custom', path: ['client'], message: 'validation.invalid' });
  });
export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;

/**
 * `PATCH /sales/:id` — a draft is fully editable (items, discount, tax, client — `clientId` or a new `client { name, phone }` —, payment) and `status=completed`
 * validates it; on a completed sale only `notes` and `paymentMethod` change (items / discount / tax ⇒ 422 SALE_IMMUTABLE:
 * cancel + redo). Cancelled ⇒ 422 SALE_IMMUTABLE.
 */
export const UpdateSaleSchema = z
  .object({
    clientId: emptyToNull(id),
    /** draft only: a new client typed in the sheet (found by phone or created), like `POST /sales` */
    client: z.object({ name: fullName, phone }).strict().nullable().optional(),
    items: saleItems.optional(),
    discount: money.optional(),
    tax: money.optional(),
    paymentMethod: z.enum(PaymentMethodValues).optional(),
    amountPaid: money.optional(),
    notes: emptyToNull(text(2000)),
    soldAt: instant.optional(),
    status: z.literal('completed').optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.clientId && v.client) ctx.addIssue({ code: 'custom', path: ['client'], message: 'validation.invalid' });
  });
export type UpdateSaleInput = z.infer<typeof UpdateSaleSchema>;
/** `POST /sales/:id/payments` (Idempotency-Key required) `[FIG DLG Encaisser le reste]` — ≤ remaining. */
export const SalePaymentSchema = GdsPaymentSchema;
export type SalePaymentInput = GdsPaymentInput;
/**
 * `POST /sales/:id/cancel { reason, restoreStock, refund }` `[FIG DLG Annuler la vente]` — ≤ 7 d after `soldAt`
 * (422 SALE_CANNOT_CANCEL_AFTER_7D). `refund=true` with money taken ⇒ the payment rows stay and one `refund` expense row
 * (locked) gives the money back; `refund=false` ⇒ the automatic income rows are removed (04 §3 "removed").
 */
export const CancelSaleSchema = z
  .object({
    reason: z.string({ required_error: 'validation.required' }).trim().min(2, 'validation.required').max(500, 'validation.length'),
    restoreStock: z.boolean().default(true),
    refund: z.boolean().default(true),
  })
  .strict();
export type CancelSaleInput = z.infer<typeof CancelSaleSchema>;
/** `POST /sales/:id/client { clientId }` — "Lier à un client" (aggregates of both clients recomputed). */
export const SaleClientSchema = z.object({ clientId: id }).strict();
export type SaleClientInput = z.infer<typeof SaleClientSchema>;

export const SalesQuerySchema = z
  .object({
    ...paging,
    paymentStatus: csv(z.enum(GdsPaymentStatusValues)).optional(),
    status: csv(z.enum(SaleStatusValues)).optional(),
    createdById: csv(id).optional(),
    clientId: id.optional(),
    productId: id.optional(),
    /** remaining > 0 (partial / unpaid completed sales) */
    hasRemaining: flag.optional(),
    period: z.enum(GDS_PERIODS).optional(),
    from: day.optional(),
    to: day.optional(),
    q,
  })
  .strict();
export type SalesQuery = z.infer<typeof SalesQuerySchema>;
export const SaleStatsQuerySchema = SalesQuerySchema.omit({ page: true, pageSize: true, sort: true });
/** `GET /sales/export` (M8, Figma GDS-08 "Exporter"): the list filters + `format` → 202 `{ jobId }`. */
export const SalesExportQuerySchema = SalesQuerySchema.omit({ page: true, pageSize: true }).extend({ format: z.enum(['csv', 'xlsx']).default('csv') }).strict();
export type SalesExportQuery = z.infer<typeof SalesExportQuerySchema>;

export type SaleItemView = {
  id: string;
  product: GdsProductRef;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  /** catalogue price at the time of the sale when the price was edited on the line ("PRIX MODIFIÉ 4 500 → 4 200") */
  catalogPrice: number | null;
  costPrice: number | null;
  discount: number;
  total: number;
};
export type SaleListItemView = {
  id: string;
  number: string;
  client: ClientRefView | null;
  /** walk-in name / phone when no client is linked ("Passage") */
  customerName: string | null;
  status: SaleStatusName;
  items: { name: string; variant: string | null; qty: number }[];
  itemCount: number;
  total: number;
  amountPaid: number;
  remaining: number;
  paymentStatus: GdsPaymentStatusName;
  paymentMethod: (typeof PaymentMethodValues)[number];
  seller: OrderUserRef | null;
  soldAt: string;
  actions: ActionDescriptor[];
};
export type SaleView = Omit<SaleListItemView, 'items'> & {
  customerPhone: string | null;
  items: SaleItemView[];
  subtotal: number;
  discount: number;
  tax: number;
  payments: PaymentEntryView[];
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: OrderUserRef | null;
  stockRestored: boolean | null;
  /** last day `POST /sales/:id/cancel` is accepted (soldAt + 7 d) */
  cancellableUntil: string;
  createdAt: string;
  updatedAt: string;
};
/** `[FIG GDS-08 KPIs]` — completed sales of the period (default 30 d) following the filters. */
export type SaleStatsView = {
  count: number;
  /** Σ total (04 §4 Revenue, sales part) */
  revenue: number;
  /** completed sales with a remaining amount · Σ remaining */
  partialCount: number;
  remaining: number;
  averageBasket: number;
  averageBasketPrevious: number;
  averageBasketDeltaPct: number | null;
};

// =====================================================================================================================
// Cash register (GDS-08, CSH-01…04 · FIG GDS-09, DLG GDS "Mouvement de caisse manuel", DLG GDS II "Caisse — verrous")
// =====================================================================================================================
/**
 * `POST /cash` (Idempotency-Key required) — manual row. `category` ∈ CASH_MANUAL_CATEGORIES (an automatic category ⇒
 * 422 VALIDATION_ERROR `fields.category`); `correctsTransactionId` (an automatic row) only with `category=correction`.
 * `date` defaults to now; a closed day ⇒ 409 CASH_DAY_CLOSED {date}.
 */
export const CreateCashEntrySchema = z
  .object({
    type: z.enum(CashTypeValues, { errorMap: () => ({ message: 'validation.required' }) }),
    amount: positiveMoney,
    category: z.enum(CashCategoryValues, { errorMap: () => ({ message: 'validation.required' }) }),
    method: z.enum(CashMethodValues).default('cash'),
    description: emptyToNull(text(500)),
    reference: emptyToNull(text(120)),
    date: instant.optional(),
    proofUploadId: emptyToNull(id),
    correctsTransactionId: emptyToNull(id),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!(CASH_MANUAL_CATEGORIES as readonly string[]).includes(v.category)) ctx.addIssue({ code: 'custom', path: ['category'], message: 'validation.invalid' });
    if (v.correctsTransactionId && v.category !== 'correction') ctx.addIssue({ code: 'custom', path: ['correctsTransactionId'], message: 'validation.invalid' });
  });
export type CreateCashEntryInput = z.infer<typeof CreateCashEntrySchema>;
/** `PATCH /cash/:id` — manual rows only (403 CAISSE_EDIT_AUTOMATIC), ≤ 24 h (422 CASH_ENTRY_EDIT_WINDOW_EXPIRED), day open (409 CASH_DAY_CLOSED). */
export const UpdateCashEntrySchema = z
  .object({
    type: z.enum(CashTypeValues).optional(),
    amount: positiveMoney.optional(),
    category: z.enum(CASH_MANUAL_CATEGORIES).optional(),
    method: z.enum(CashMethodValues).optional(),
    description: emptyToNull(text(500)),
    reference: emptyToNull(text(120)),
    date: instant.optional(),
    proofUploadId: emptyToNull(id),
  })
  .strict();
export type UpdateCashEntryInput = z.infer<typeof UpdateCashEntrySchema>;
/** `POST /cash/close` (Idempotency-Key required) — `note` required when counted ≠ theoretical (422 VALIDATION_ERROR `fields.note`). */
export const CloseCashSchema = z.object({ day, countedBalance: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.price' }).int('validation.price').min(-MAX_MONEY).max(MAX_MONEY), note: emptyToNull(text(500)) }).strict();
export type CloseCashInput = z.infer<typeof CloseCashSchema>;
/** `POST /cash/days/:day/reopen { reason }` — Admin+ (`gds.write`), audited. */
export const ReopenCashSchema = z.object({ reason: z.string({ required_error: 'validation.required' }).trim().min(3, 'validation.required').max(500, 'validation.length') }).strict();
export type ReopenCashInput = z.infer<typeof ReopenCashSchema>;

const cashFilters = {
  /** one day (default today when neither `day` nor `from`/`to`/`period` is given) */
  day: day.optional(),
  direction: z.enum(CashTypeValues).optional(),
  category: csv(z.enum(CashCategoryValues)).optional(),
  method: csv(z.enum(CASH_DISPLAY_METHODS)).optional(),
  createdById: csv(id).optional(),
  /** auto = automatic rows (`sourceType` set), manual = rows typed by a person */
  source: z.enum(['auto', 'manual']).optional(),
  period: z.enum(GDS_PERIODS).optional(),
  from: day.optional(),
  to: day.optional(),
  q,
};
/** `GET /cash` — the period pills (`day`, `period`, `from`/`to`) and the KPIs of `GET /cash/stats` read the same filters (09 §4). */
export const CashQuerySchema = z
  .object({ page: paging.page, pageSize: z.coerce.number().int().refine((n) => [25, 50, 100, 200].includes(n), 'validation.range').default(100), sort: paging.sort, ...cashFilters })
  .strict();
export type CashQuery = z.infer<typeof CashQuerySchema>;
export const CashStatsQuerySchema = z.object(cashFilters).strict();
export type CashStatsQuery = z.infer<typeof CashStatsQuerySchema>;
export const CashDaysQuerySchema = z.object({ from: day.optional(), to: day.optional(), status: z.enum(['open', 'closed']).optional() }).strict();
export type CashDaysQuery = z.infer<typeof CashDaysQuerySchema>;

export type CashLockReason = 'CAISSE_EDIT_AUTOMATIC' | 'CASH_DAY_CLOSED';
export type CashTransactionView = {
  id: string;
  type: CashTypeName;
  /** always positive; the sign is `type` */
  amount: number;
  category: CashCategoryName;
  method: CashMethodName;
  description: string | null;
  /** the source document (order / sale / purchase) or the closing; click opens it */
  reference: { type: 'order' | 'sale' | 'purchase' | 'closing' | 'cash'; id: string; label: string } | null;
  date: string;
  isAutomatic: boolean;
  locked: boolean;
  lockReason: CashLockReason | null;
  /** running balance after this row, every row of the workspace before it included (all methods) */
  balanceAfter: number;
  createdBy: OrderUserRef | null;
  proofUrl: string | null;
  correctsTransactionId: string | null;
  createdAt: string;
  actions: ActionDescriptor[];
};
/**
 * `GET /cash/stats` — `[FIG GDS-09 KPIs]`: opening = Σ every row before the first day of the selection; current =
 * opening + Σ rows of the selection (the table's last balance); income / expense of the selection with their counts;
 * `unclosedDays` = days with rows and no closing (before today), oldest first.
 */
export type CashStatsView = {
  from: string;
  to: string;
  openingBalance: number;
  income: number;
  expense: number;
  net: number;
  currentBalance: number;
  counts: { rows: number; sales: number; cod: number; purchases: number; fees: number };
  unclosedDays: string[];
  /** single-day selection: that day's closing state */
  day: { day: string; closed: boolean; theoreticalCash: number } | null;
};
/** api-contract §3.9 `CashClosingDto` — `GET /cash/days` (one row per day with rows or a closing, newest first). */
export type CashDayView = {
  day: string;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
  /** cash method only (04 §20 theoretical balance) */
  theoreticalCash: number;
  closed: boolean;
  closing: {
    id: string;
    theoreticalBalance: number;
    countedBalance: number;
    difference: number;
    note: string | null;
    closedBy: OrderUserRef | null;
    closedAt: string;
    reopenedBy: OrderUserRef | null;
    reopenedAt: string | null;
  } | null;
  actions: ActionDescriptor[];
};

// =====================================================================================================================
// Inventory counts (INV-01…03, 04 §19 · FIG DLG GDS "Lancer un inventaire", "Valider l'inventaire")
// =====================================================================================================================
/** `POST /inventories` — 409 INVENTORY_IN_PROGRESS {number} when a draft / counting count is open. */
export const StartInventorySchema = z
  .object({
    scope: z.enum(InventoryScopeValues, { errorMap: () => ({ message: 'validation.required' }) }),
    categoryId: emptyToNull(id),
    blockCounterSales: z.boolean().default(false),
    note: emptyToNull(text(1000)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === 'category' && !v.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'validation.required' });
  });
export type StartInventoryInput = z.infer<typeof StartInventorySchema>;
/** `PUT /inventories/:id/lines` (`stock.count`, Operators included) — counted quantities; `countedQty: null` clears a line. */
export const InventoryLinesSchema = z
  .object({
    lines: z
      .array(z.object({ productId: id, variantId: emptyToNull(id), countedQty: countQty.nullable(), note: emptyToNull(text(500)) }).strict())
      .min(1, 'validation.required')
      .max(5000, 'validation.length'),
  })
  .strict();
export type InventoryLinesInput = z.infer<typeof InventoryLinesSchema>;
/** `POST /inventories/:id/validate` (Idempotency-Key required) — Admin+. Lines never counted are left out (no movement). */
export const ValidateInventorySchema = z.object({ note: emptyToNull(text(1000)) }).strict();
export type ValidateInventoryInput = z.infer<typeof ValidateInventorySchema>;
export const InventoriesQuerySchema = z
  .object({ ...paging, status: csv(z.enum(InventoryStatusValues)).optional() })
  .strict();
export type InventoriesQuery = z.infer<typeof InventoriesQuerySchema>;
/** Scope sizes of the start dialog: "Tout le stock (n produits · m variantes)". */
export const InventoryScopePreviewQuerySchema = z.object({ scope: z.enum(InventoryScopeValues).default('all'), categoryId: id.optional() }).strict();

export type InventoryLineView = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  /** snapshot at start */
  expectedQty: number;
  /** expected + Σ movements since the start (what validation compares with) */
  currentExpectedQty: number;
  countedQty: number | null;
  difference: number;
  differencePct: number;
  /** variance > 10 % ⇒ a note is required at validation */
  noteRequired: boolean;
  note: string | null;
  costPrice: number | null;
  movementId: string | null;
};
export type InventoryListItemView = {
  id: string;
  number: string;
  scope: InventoryScopeName;
  categoryId: string | null;
  categoryName: string | null;
  status: InventoryStatusName;
  blockCounterSales: boolean;
  summary: { lines: number; counted: number; discrepancies: number; value: number };
  startedBy: OrderUserRef | null;
  startedAt: string;
  validatedBy: OrderUserRef | null;
  validatedAt: string | null;
  actions: ActionDescriptor[];
};
export type InventoryView = InventoryListItemView & { note: string | null; lines: InventoryLineView[] };
export type InventoryScopePreviewView = { scope: InventoryScopeName; categoryId: string | null; products: number; variants: number; lines: number };

// =====================================================================================================================
// Movements & products KPIs (M2 carry-over: `/stock/movements/stats`, `/products/stats`)
// =====================================================================================================================
/** `GET /stock/movements/stats` — same filters as `GET /stock/movements`. Quantities are units (absolute). */
export type MovementStatsView = {
  count: number;
  unitsIn: number;
  unitsOut: number;
  net: number;
  byType: Record<'in' | 'out' | 'adjustment_in' | 'adjustment_out' | 'inventory' | 'return', { count: number; units: number }>;
  /** cost value of the net change (Σ quantity × current cost, null in simple mode) */
  netValue: number | null;
};
/** `GET /products/stats` — same filters as `GET /products`. */
export type ProductStatsView = {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  services: number;
  lowStock: number;
  outOfStock: number;
  totalItems: number;
  valueAtCost: number | null;
  valueAtRetail: number;
};

// =====================================================================================================================
// Stock dashboard block "ACHATS & FOURNISSEURS" (M2 carry-over) — `GET /stock/overview` adds `purchasing`
// =====================================================================================================================
export type StockPurchasingView = {
  pendingReceipt: number;
  late: number;
  dueToSuppliers: number;
  activeSuppliers: number;
  purchased30d: number;
  /** "Réapprovisionner": active restock / stockout recommendations (each carries `suggestedAction.params` for `/purchases/new`) */
  restockSuggestions: number;
};
