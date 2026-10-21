// Orders (03 §10 ORD-01…12, §12 PAY-01, §37 ORD; 04 §1–§4, §10, §11, §21; api-contract §3.7, §4 OrdersQuery;
// 06 "Orders", §8.5, §10 "Commandes"). One source for the API (nestjs-zod DTOs), the web and the mobile app.
// Field names = contract names. Messages = i18n keys. Money = integer DZD.
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';
import {
  CallResultValues,
  CancelReasonValues,
  ConfirmationStatusValues,
  DeliveryStatusValues,
  FailureReasonValues,
  OrderSourceValues,
  OrderStatusValues,
  PaymentMethodValues,
  PaymentStatusValues,
  ShipmentProviderValues,
} from '../enums';
import { email, fullName, isPhoneDz, normalizePhoneDz } from '../validators';
import type { ChannelRefView } from './channels';
import type { ClientRefView } from './clients';
import type { ActionDescriptor } from './common';
import type { ShipmentView } from './delivery';

// --- enums & limits (spec values) -------------------------------------------------------------------------------------
export type OrderStatusName = (typeof OrderStatusValues)[number];
export type ConfirmationStatusName = (typeof ConfirmationStatusValues)[number];
export type PaymentStatusName = (typeof PaymentStatusValues)[number];
export type PaymentMethodName = (typeof PaymentMethodValues)[number];
export type DeliveryStatusName = (typeof DeliveryStatusValues)[number];
export type OrderSourceName = (typeof OrderSourceValues)[number];
export type CallResultName = (typeof CallResultValues)[number];
export type CancelReasonName = (typeof CancelReasonValues)[number];
export type FailureReasonName = (typeof FailureReasonValues)[number];

export const ORDER_ITEMS_MAX = 100;
export const ORDER_BULK_MAX_IDS = 500;
/** 04 §21: status-change dialog effective date back-datable ≤ 7 days. */
export const ORDER_BACKDATE_MAX_DAYS = 7;
/** 04 §5: identical items + phone within 10 min ⇒ the AI gets the existing order back. */
export const AI_ORDER_DUPLICATE_WINDOW_MIN = 10;
/** 04 §21: after the 3rd `no_answer` the UI proposes cancel or reminder. */
export const ORDER_NO_ANSWER_PROPOSAL_AT = 3;
export const ORDER_SORTS = ['orderedAt', 'total', 'status', 'clientName'] as const;
export const ORDER_TERMINAL_STATUSES: readonly OrderStatusName[] = ['cancelled', 'returned'];
/** Statuses whose order fields are read-only except notes (ORD-06). */
export const ORDER_READ_ONLY_STATUSES: readonly OrderStatusName[] = ['delivered', 'cancelled', 'returned'];

/**
 * 04 §1.2 status matrix (+ D14 self-delivery). `shipped → confirmed` is the "Confirmée (retour arrière)" of 04 §21,
 * allowed only while the parcel has not been picked up (`Shipment.status ∈ pending|sent`) — the server checks that.
 * `delivered → returned` is Admin+ (`orders.money`). Terminal: cancelled, returned.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatusName, readonly OrderStatusName[]> = {
  new: ['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
  confirmed: ['preparing', 'shipped', 'delivered', 'cancelled'],
  preparing: ['shipped', 'delivered', 'cancelled'],
  shipped: ['confirmed', 'delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
/** Allowed `to` of `POST /orders/bulk/status` (04 §21: delivered / returned are never bulk). */
export const ORDER_BULK_STATUS_TARGETS = ['confirmed', 'preparing', 'shipped', 'cancelled'] as const;
/** Statuses that need the delivery address (04 §1.6 "Confirm: + wilaya, commune, address (or stop-desk)"). */
export const ORDER_ADDRESS_REQUIRED_FOR: readonly OrderStatusName[] = ['confirmed', 'preparing', 'shipped'];
export const canTransition = (from: OrderStatusName, to: OrderStatusName) => ORDER_STATUS_TRANSITIONS[from].includes(to);

/** 04 §1.4: payment status derived from the amount paid (clamped 0..total). */
export const derivePaymentStatus = (amountPaid: number, total: number): 'unpaid' | 'partial' | 'paid' => {
  const paid = Math.max(0, Math.min(amountPaid, total));
  if (total <= 0) return 'paid';
  if (paid <= 0) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
};

// --- primitives -------------------------------------------------------------------------------------------------------
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const ids = z.array(id, { required_error: 'validation.required' }).min(1, 'validation.required').max(ORDER_BULK_MAX_IDS, 'validation.length');
const MAX_MONEY = 100_000_000;
const money = z.number({ invalid_type_error: 'validation.price', required_error: 'validation.required' }).int('validation.price').min(0, 'validation.price').max(MAX_MONEY, 'validation.price');
const positiveMoney = money.gt(0, 'validation.price');
const quantity = z.number({ invalid_type_error: 'validation.quantity', required_error: 'validation.required' }).int('validation.quantity').min(1, 'validation.quantity').max(100_000, 'validation.quantity');
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
const text = (max: number) => z.string().trim().max(max, 'validation.length');
const phone = z
  .string({ required_error: 'validation.required', invalid_type_error: 'validation.phone' })
  .transform(normalizePhoneDz)
  .refine(isPhoneDz, 'validation.phone');
const instant = z.string({ invalid_type_error: 'validation.date' }).datetime({ offset: true, message: 'validation.date' });
const wilayaId = z.coerce.number({ required_error: 'validation.wilaya' }).int('validation.wilaya').min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya');
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const int = z.coerce.number().int('validation.range').min(0, 'validation.range');

// --- inputs -----------------------------------------------------------------------------------------------------------
/**
 * An existing client, or a new one (found by normalised phone first — CLI-02). An existing client without a phone (a
 * conversation's « À compléter » record) needs `phone` to be ordered for: the order completes the client with it.
 */
export const OrderClientInputSchema = z.union([
  z.object({ id, phone: phone.optional() }).strict(),
  z.object({ name: fullName, phone, phone2: emptyToNull(phone), email: emptyToNull(email) }).strict(),
]);
export const OrderItemInputSchema = z
  .object({
    productId: id,
    /** required when the product has variants (422 VARIANT_REQUIRED) */
    variantId: emptyToNull(id),
    quantity,
    /** defaults to the catalogue price (snapshotted on the line) */
    unitPrice: money.optional(),
    discount: money.optional(),
  })
  .strict();
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;
/** Delivery block of the order form; `deliveryFee` = Admin+ override (`orders.money`), else quoted from the grid. */
export const OrderDeliveryInputSchema = z
  .object({
    wilayaId,
    communeId: z.coerce.number().int('validation.commune').positive('validation.commune').nullable().optional(),
    communeText: emptyToNull(z.string().trim().min(1, 'validation.commune').max(100, 'validation.commune')),
    isStopdesk: z.boolean({ required_error: 'validation.required' }),
    stopdeskId: emptyToNull(text(80)),
    address: emptyToNull(z.string().trim().max(500, 'validation.address')),
    deliveryFee: money.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.isStopdesk && v.address && v.address.length < 10) ctx.addIssue({ code: 'custom', path: ['address'], message: 'validation.address' });
  });
export type OrderDeliveryInput = z.infer<typeof OrderDeliveryInputSchema>;

/** `POST /orders` (Idempotency-Key required). `status=confirmed` validates the confirm fields (ORDER_ADDRESS_REQUIRED). */
export const CreateOrderSchema = z
  .object({
    client: OrderClientInputSchema,
    items: z.array(OrderItemInputSchema, { required_error: 'validation.required' }).min(1, 'validation.required').max(ORDER_ITEMS_MAX, 'validation.length'),
    delivery: OrderDeliveryInputSchema.nullable().optional(),
    paymentMethod: z.enum(PaymentMethodValues).default('cash'),
    amountPaid: money.optional(),
    discount: money.optional(),
    notes: emptyToNull(text(2000)),
    status: z.enum(['new', 'confirmed']).default('new'),
    /** back-dating allowed; ≤ now + 1 day (04 §2 `validation.date`) */
    orderedAt: instant.optional(),
    conversationId: emptyToNull(id),
    assigneeId: emptyToNull(id),
    /** blocked customer: re-send with `confirm: true` after the warning (409 CUSTOMER_BLOCKED, 04 §13) */
    confirm: z.boolean().optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

/**
 * `PATCH /orders/:id { …, version }` (409 CONFLICT on a stale version, `details.current` = OrderView).
 * Items are editable while `status ∈ new|confirmed|preparing` and nothing was sent (stock re-synced by OrderEffects).
 * `paymentStatus` without `amountPaid` ⇒ 422 (04 §1.4 fix); `deliveryFee` / `discount` override = `orders.money`.
 */
export const UpdateOrderSchema = z
  .object({
    version: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).int().min(1),
    clientName: fullName.optional(),
    clientPhone: phone.optional(),
    clientPhone2: emptyToNull(phone),
    notes: emptyToNull(text(2000)),
    items: z.array(OrderItemInputSchema).min(1, 'validation.required').max(ORDER_ITEMS_MAX, 'validation.length').optional(),
    discount: money.optional(),
    tax: money.optional(),
    deliveryFee: money.optional(),
    paymentMethod: z.enum(PaymentMethodValues).optional(),
    amountPaid: money.optional(),
    paymentStatus: z.enum(PaymentStatusValues).optional(),
    orderedAt: instant.optional(),
  })
  .strict();
export type UpdateOrderInput = z.infer<typeof UpdateOrderSchema>;

/**
 * `POST /orders/:id/status` (Idempotency-Key required) `[FIG DLG Changer le statut]`.
 * `reason`: a `CancelReason` when `to=cancelled`, a `FailureReason` when `to=returned`; free text goes to `note`.
 * `effectiveAt` back-dates `deliveredAt` / the cash row ≤ 7 d; `amountCollected` (→ delivered, default total; a
 * different amount needs `note`); `restoreStock` (→ returned, default true); `returnFee` (→ returned, default grid).
 */
export const OrderStatusChangeSchema = z
  .object({
    to: z.enum(OrderStatusValues, { errorMap: () => ({ message: 'validation.invalid' }) }),
    reason: emptyToNull(text(120)),
    note: emptyToNull(text(500)),
    effectiveAt: instant.optional(),
    amountCollected: money.optional(),
    restoreStock: z.boolean().optional(),
    returnFee: money.optional(),
    trackingNumber: emptyToNull(text(80)),
    notifyCustomer: z.boolean().optional(),
    version: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).int().min(1),
  })
  .strict();
export type OrderStatusChangeInput = z.infer<typeof OrderStatusChangeSchema>;

/** `POST /orders/:id/cancel` `[FIG DLG Annuler la commande]` (409 DELIVERY_ORDER_ALREADY_SENT with an active parcel). */
export const CancelOrderSchema = z
  .object({ reason: z.enum(CancelReasonValues, { errorMap: () => ({ message: 'validation.required' }) }), note: emptyToNull(text(500)), notifyCustomer: z.boolean().optional(), version: z.number().int().min(1).optional() })
  .strict();
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
/** `POST /orders/:id/deliver` `[FIG DLG Marquer livrée manuellement]` — COD rule; `amountCollected ≠ total` needs `reason`. */
export const DeliverOrderSchema = z
  .object({ amountCollected: money.optional(), reason: emptyToNull(text(500)), deliveredAt: instant.optional(), notifyCustomer: z.boolean().optional(), version: z.number().int().min(1).optional() })
  .strict();
export type DeliverOrderInput = z.infer<typeof DeliverOrderSchema>;
/** `POST /orders/:id/return` `[FIG DLG Marquer retournée]` — restock checkbox default on (off ⇒ loss trail, no restock). */
export const ReturnOrderSchema = z
  .object({
    reason: z.enum(FailureReasonValues, { errorMap: () => ({ message: 'validation.required' }) }),
    restoreStock: z.boolean().default(true),
    returnFee: money.optional(),
    note: emptyToNull(text(500)),
    version: z.number().int().min(1).optional(),
  })
  .strict();
export type ReturnOrderInput = z.infer<typeof ReturnOrderSchema>;
/** `POST /orders/:id/ship-manual` — self-delivery: Shipment `provider=manual`, `status=sent` (D14). */
export const ShipManualSchema = z.object({ trackingNumber: emptyToNull(text(80)), version: z.number().int().min(1).optional() }).strict();
export type ShipManualInput = z.infer<typeof ShipManualSchema>;

/** `POST /orders/:id/calls` `[FIG ORD-07 / DLG Résultat de l'appel]` — `callbackAt` required (future) when `result=callback`. */
export const CallLogSchema = z
  .object({ result: z.enum(CallResultValues, { errorMap: () => ({ message: 'validation.required' }) }), callbackAt: instant.optional(), notes: emptyToNull(text(1000)) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.result === 'callback' && !v.callbackAt) ctx.addIssue({ code: 'custom', path: ['callbackAt'], message: 'validation.required' });
  });
export type CallLogInput = z.infer<typeof CallLogSchema>;
/** `POST /orders/:id/callback { at, note?, notifyCustomer? }` `[FIG DLG Programmer un rappel]` (422 ORDER_CALLBACK_IN_PAST). */
export const OrderCallbackSchema = z.object({ at: instant, note: emptyToNull(text(500)), notifyCustomer: z.boolean().optional() }).strict();
export type OrderCallbackInput = z.infer<typeof OrderCallbackSchema>;
/** `POST /orders/:id/address` `[FIG DLG Modifier l'adresse]` (409 COURIER_ADDRESS_LOCKED once a courier parcel exists). */
export const OrderAddressSchema = z
  .object({
    wilayaId,
    communeId: z.coerce.number().int('validation.commune').positive('validation.commune').nullable().optional(),
    communeText: emptyToNull(z.string().trim().min(1, 'validation.commune').max(100, 'validation.commune')),
    isStopdesk: z.boolean({ required_error: 'validation.required' }),
    stopdeskId: emptyToNull(text(80)),
    address: emptyToNull(z.string().trim().max(500, 'validation.address')),
    phone2: emptyToNull(phone),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.isStopdesk && (v.address ?? '').length < 10) ctx.addIssue({ code: 'custom', path: ['address'], message: 'validation.address' });
    if (!v.communeId && !v.communeText) ctx.addIssue({ code: 'custom', path: ['communeId'], message: 'validation.commune' });
  });
export type OrderAddressInput = z.infer<typeof OrderAddressSchema>;
/** `POST /orders/:id/assign { assigneeId|null, notify? }` `[FIG DLG Assigner]`. */
export const OrderAssignSchema = z.object({ assigneeId: id.nullable(), notify: z.boolean().optional() }).strict();
export type OrderAssignInput = z.infer<typeof OrderAssignSchema>;
/** `POST /orders/:id/payments` (Idempotency-Key required) `[FIG DLG Enregistrer un paiement]` — ≤ remaining. */
export const RecordPaymentSchema = z
  .object({ amount: positiveMoney, method: z.enum(PaymentMethodValues).default('cash'), reference: emptyToNull(text(120)), note: emptyToNull(text(500)), paidAt: instant.optional() })
  .strict();
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;
export const OrderNoteSchema = z.object({ body: z.string({ required_error: 'validation.required' }).trim().min(1, 'validation.required').max(2000, 'validation.length') }).strict();
export type OrderNoteInput = z.infer<typeof OrderNoteSchema>;
/** `DELETE /orders/:id` — the typed order number must match exactly (04 §21; mismatch ⇒ 422 VALIDATION_ERROR). */
export const DeleteOrderQuerySchema = z.object({ confirmNumber: z.string().trim().max(40).optional() }).strict();

/** `POST /orders/bulk/status` (Idempotency-Key required) — per-row results; delivered / returned ⇒ 422 ORDER_INVALID_TRANSITION. */
export const BulkOrderStatusSchema = z
  .object({
    ids,
    to: z.enum(OrderStatusValues, { errorMap: () => ({ message: 'validation.invalid' }) }),
    reason: emptyToNull(text(120)),
    note: emptyToNull(text(500)),
    trackingNumber: emptyToNull(text(80)),
  })
  .strict();
export type BulkOrderStatusInput = z.infer<typeof BulkOrderStatusSchema>;
export const BulkOrderAssignSchema = z.object({ ids, assigneeId: id.nullable(), notify: z.boolean().optional() }).strict();
export type BulkOrderAssignInput = z.infer<typeof BulkOrderAssignSchema>;
/** `POST /orders/bulk/print` → 202 job (A5 slips, one PDF) `[FIG DLV-06 / ORD-09]`. */
export const BulkOrderPrintSchema = z
  .object({ ids, withPrices: z.boolean().default(true), twoPerPage: z.boolean().default(false), lang: z.enum(['fr', 'ar', 'en']).optional() })
  .strict();
export type BulkOrderPrintInput = z.infer<typeof BulkOrderPrintSchema>;
/** `GET /orders/:id/print?withPrices&twoPerPage&lang` → `{ url }` (signed, `private/`). */
export const OrderPrintQuerySchema = z
  .object({ withPrices: flag.default(true), twoPerPage: flag.default(false), lang: z.enum(['fr', 'ar', 'en']).optional() })
  .strict();
export type OrderPrintQuery = z.infer<typeof OrderPrintQuerySchema>;

// --- list query (api-contract §4 OrdersQuery) ---------------------------------------------------------------------------
export const ORDER_PERIODS = ['today', '7d', '30d', 'month', 'last_month', '90d', 'year', 'custom'] as const;
const ordersFilters = {
  status: csv(z.enum(OrderStatusValues)).optional(),
  confirmationStatus: csv(z.enum(ConfirmationStatusValues)).optional(),
  minCalls: int.optional(),
  neverCalled: flag.optional(),
  paymentStatus: csv(z.enum(PaymentStatusValues)).optional(),
  paymentMethod: csv(z.enum(PaymentMethodValues)).optional(),
  hasRemaining: flag.optional(),
  deliveryStatus: csv(z.enum(DeliveryStatusValues)).optional(),
  shipmentProvider: csv(z.enum(ShipmentProviderValues)).optional(),
  source: csv(z.enum(OrderSourceValues)).optional(),
  channelId: csv(id).optional(),
  agentId: csv(id).optional(),
  /** a member id, `me` or `none` */
  assigneeId: z.union([id, z.literal('me'), z.literal('none')]).optional(),
  wilayaId: csv(z.coerce.number().int().min(1).max(WILAYA_COUNT)).optional(),
  isStopdesk: flag.optional(),
  minTotal: int.optional(),
  maxTotal: int.optional(),
  period: z.enum(ORDER_PERIODS).optional(),
  from: day.optional(),
  to: day.optional(),
  productId: id.optional(),
  riskLevel: z.enum(['normal', 'high']).optional(),
  clientId: id.optional(),
  callbackDue: flag.optional(),
  /** ids of a selection (`?ids=` deep links, export `scope=selection`) */
  ids: csv(id).optional(),
  q: z.string().trim().max(120).optional(),
};
export const OrdersQuerySchema = z
  .object({
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
    ...ordersFilters,
  })
  .strict();
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;
/** `GET /orders/stats` — same filters as the list (KPIs follow the filters). */
export const OrderStatsQuerySchema = z.object({ view: id.optional(), ...ordersFilters }).strict();
export type OrderStatsQuery = z.infer<typeof OrderStatsQuerySchema>;
/**
 * `GET /orders/export?…filters&format&columns&includeItems&courierFormat` → 202 job `[FIG DLG Exporter les commandes]`.
 * `scope=selection` uses `ids`; `scope=all` ignores the filters.
 */
export const OrdersExportQuerySchema = z
  .object({
    ...ordersFilters,
    sort: z
      .string()
      .regex(/^-?[a-zA-Z]+$/)
      .optional(),
    scope: z.enum(['selection', 'filter', 'all']).default('filter'),
    /** `pdf` (M8): A4 landscape table of the standard columns, produced by the export job like the others */
    format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
    columns: z.enum(['standard', 'all']).default('standard'),
    includeItems: flag.optional(),
    courierFormat: z.enum(['zrexpress']).optional(),
  })
  .strict();
export type OrdersExportQuery = z.infer<typeof OrdersExportQuerySchema>;

// --- order import (03 §37 ORD "Import orders", D69, `orders.import`) ----------------------------------------------------
/** CSV columns of 06 "Orders" `POST /orders/import`; `items` = "SKU×qty;SKU×qty" (also `x`, `*`). */
export const ORDER_IMPORT_FIELDS = ['clientName', 'phone', 'wilaya', 'commune', 'address', 'items', 'note'] as const;
export type OrderImportField = (typeof ORDER_IMPORT_FIELDS)[number];
export const ORDER_IMPORT_REQUIRED_FIELDS: readonly OrderImportField[] = ['clientName', 'phone', 'wilaya', 'address', 'items'];
export const ORDER_IMPORT_MAX_ROWS = 1000;
/** `POST /orders/import/mapping { jobId, mapping }` → 202 (the preview is computed again with this column mapping). */
export const OrderImportMappingSchema = z
  .object({
    jobId: id,
    mapping: z.record(z.enum(ORDER_IMPORT_FIELDS), z.string().trim().max(120).nullable()),
  })
  .strict();
export type OrderImportMappingInput = z.infer<typeof OrderImportMappingSchema>;
export type OrderImportRowError = { field: OrderImportField | null; code: string; params?: Record<string, string | number> };
export type OrderImportPreviewRow = {
  row: number;
  ok: boolean;
  values: { clientName: string | null; phone: string | null; wilayaId: number | null; wilaya: string | null; commune: string | null; communeId: number | null; address: string | null; note: string | null; items: { sku: string; quantity: number; productId: string | null; variantId: string | null; name: string | null; unitPrice: number | null }[] };
  /** subtotal of the lines at catalogue prices + the grid fee (informative) */
  total: number | null;
  /** an existing client with this phone (found) or a new one (created) */
  client: 'existing' | 'new' | null;
  errors: OrderImportRowError[];
};
export type OrderImportPreviewResult = {
  stage: 'mapping' | 'preview' | 'committed';
  fileName: string;
  headers: string[];
  mapping: Partial<Record<OrderImportField, string | null>>;
  missingColumns: OrderImportField[];
  totals: { rows: number; valid: number; invalid: number; newClients: number; units: number };
  rows: OrderImportPreviewRow[];
  /** commit: one order per valid row (`source=import`, `status=new`); a row refused at commit (stock moved meanwhile) is listed */
  report?: { created: number; skipped: number; failed: { row: number; code: string; params?: Record<string, string | number> }[]; orderIds: string[] };
};

// --- read models (api-contract §2, §3.7) --------------------------------------------------------------------------------
export type OrderUserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
export type OrderAgentRef = { id: string; name: string; status: 'draft' | 'active' | 'paused' };
/** api-contract §2 `Address`. */
export type AddressView = { wilayaId: number; wilayaName: string; communeId: number | null; communeText: string | null; address: string | null; isStopdesk: boolean; stopdeskId: string | null; stopdeskName?: string | null };
/** SOURCE column `[FIG ORD-05 v2]`: ✦ agent · channel / ✎ member / ▣ member / { } key / ⤒ file date. */
export type SourceBadge = { source: OrderSourceName; agent?: OrderAgentRef; channel?: ChannelRefView; user?: OrderUserRef; apiKeyName?: string; importFileName?: string; importedAt?: string };
export type OrderListItemView = {
  id: string;
  number: string;
  orderedAt: string;
  client: ClientRefView;
  source: SourceBadge;
  assignee: OrderUserRef | null;
  items: { name: string; variant: string | null; qty: number }[];
  itemCount: number;
  total: number;
  amountPaid: number;
  remaining: number;
  status: OrderStatusName;
  confirmationStatus: ConfirmationStatusName;
  callAttempts: number;
  callbackAt: string | null;
  paymentStatus: PaymentStatusName;
  paymentMethod: PaymentMethodName;
  deliveryStatus: DeliveryStatusName;
  shipment: { provider: string; trackingNumber: string | null; status: ShipmentView['status']; stale: boolean } | null;
  wilaya: { id: number; name: string } | null;
  isStopdesk: boolean;
  riskLevel: 'normal' | 'high';
  channel: ChannelRefView | null;
  conversationId: string | null;
  labelPrintedAt: string | null;
  version: number;
  actions: ActionDescriptor[];
};
export type OrderItemView = {
  id: string;
  product: { id: string; name: string; sku: string; price: number; primaryImageUrl: string | null; hasVariants: boolean; trackStock: boolean };
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  unitPrice: number;
  costPrice: number | null;
  quantity: number;
  discount: number;
  total: number;
  /** `last_unit` when this line takes the last unit, `insufficient` when the current stock no longer covers it */
  stockWarning: 'last_unit' | 'insufficient' | null;
};
export type PaymentEntryView = { id: string; amount: number; method: PaymentMethodName; reference: string | null; note: string | null; paidAt: string; createdBy: OrderUserRef | null };
export type OrderCallView = { id: string; user: OrderUserRef; result: CallResultName; callbackAt: string | null; notes: string | null; calledAt: string };
export type OrderHistoryView = { id: string; at: string; effectiveAt: string | null; actor: { type: string; id: string | null; name: string }; field: string; from: string | null; to: string; reason: string | null };
export type OrderNoteView = { id: string; author: OrderUserRef; body: string; createdAt: string };
export type OrderView = Omit<OrderListItemView, 'items'> & {
  clientName: string;
  clientPhone: string;
  clientPhone2: string | null;
  address: AddressView | null;
  items: OrderItemView[];
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee: number;
  courierCost: number | null;
  returnFee: number | null;
  /** "GRILLE SÉTIF · DOMICILE 400 → OFFERTE" — built from FeeQuoteView.reason */
  feeExplanation: string;
  notes: string | null;
  cancelReason: CancelReasonName | null;
  cancelNote: string | null;
  payments: PaymentEntryView[];
  paymentLink: { id: string; url: string | null; status: 'creating' | 'pending' | 'paid' | 'failed' | 'expired' | 'refunded' | 'mismatch'; expiresAt: string | null; amount: number } | null;
  calls: OrderCallView[];
  history: OrderHistoryView[];
  shipments: ShipmentView[];
  orderNotes: OrderNoteView[];
  sheetsSynced: boolean;
  agent: OrderAgentRef | null;
  createdBy: OrderUserRef | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
/** `[FIG ORD-05 v2 KPIs]` — follows the list filters. Revenue = 04 §4 named figures. */
export type OrderStatsView = {
  total: number;
  toConfirm: number;
  noAnswer: number;
  uncalledOver2h: number;
  confirmedNotSent: number;
  inTransit: number;
  staleOver5d: number;
  delivered30d: number;
  deliveredPct30d: number;
  returns: number;
  revenue30d: number;
  pipeline: number;
  callbacksDue: number;
  byStatus: Record<OrderStatusName, number>;
  sourceMix: Record<OrderSourceName, number>;
};
/** WS `order.created` / `order.updated` payload (03-events §2 OrderSummary). */
export type OrderSummary = {
  id: string;
  number: string;
  status: OrderStatusName;
  confirmationStatus: ConfirmationStatusName;
  paymentStatus: PaymentStatusName;
  deliveryStatus: DeliveryStatusName;
  source: OrderSourceName;
  clientName: string;
  clientPhone: string;
  total: number;
  amountPaid: number;
  wilayaId: number | null;
  riskLevel: 'normal' | 'high';
  assigneeId: string | null;
  callbackAt: string | null;
  orderedAt: string;
  version: number;
};
export type OrderCreatedEvent = { order: OrderSummary };
export type OrderUpdatedEvent = { order: OrderSummary; changed: string[] };
export type OrderDeletedEvent = { id: string };
/** `POST /orders/:id/duplicate` → a draft `CreateOrderInput` (nothing written). */
export type OrderDraft = CreateOrderInput;
