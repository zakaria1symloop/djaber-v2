// M6 contract ready
// Delivery: fee grid, quote, geo (M5) + couriers, shipments, tracking, labels, overview, rates, public tracking (M6)
// (03 §11 DLV-01…11; 04 §1.5, §22; 05 §7; api-contract §3.8, §3.14, §4 ShipmentsQuery; 06 "Delivery", §8.5, §10
// "Livraison & suivi", §12; 05-integrations §2). One source for the API (nestjs-zod DTOs), the web and the mobile app.
// Field names = contract names. Messages = i18n keys. Money = integer DZD. Courier credentials are never returned.
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';
import { CourierProviderValues, FailureReasonValues, OrderStatusValues, ShipmentProviderValues, ShipmentStatusValues } from '../enums';
import { isPhoneDz, normalizePhoneDz } from '../validators';
import type { ActionDescriptor } from './common';
import type { AddressView, OrderUserRef } from './orders';
import type { ClientRefView } from './clients';

export type ShipmentStatusName = (typeof ShipmentStatusValues)[number];
export type ShipmentProviderName = (typeof ShipmentProviderValues)[number];
export type CourierProviderName = (typeof CourierProviderValues)[number];
export type FailureReasonCode = (typeof FailureReasonValues)[number];
/** Shipment statuses that hold the order (partial unique index: one active parcel per order). */
export const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatusName[] = ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
/** Courier-side terminal statuses: tracking stops (05-integrations §2.6). `failed` is not terminal (re-attempts). */
export const SHIPMENT_TERMINAL_STATUSES: readonly ShipmentStatusName[] = ['delivered', 'returned', 'cancelled', 'stale'];
/** Statuses still polled by `sched-tracking-sync` (a failed attempt keeps being tracked: the courier re-attempts or returns). */
export const SHIPMENT_TRACKED_STATUSES: readonly ShipmentStatusName[] = ['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'failed'];
/** Forward order of a parcel; courier events never move a shipment backwards along it (05-integrations §2.6). */
export const SHIPMENT_PROGRESS: readonly ShipmentStatusName[] = ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
/** 04 §22: "Sans mouvement" = no event for > 5 d while the parcel is `sent | picked_up | in_transit`. */
export const SHIPMENT_STALE_AFTER_DAYS = 5;
/** DLV-04: no courier event for 30 d ⇒ `Shipment.status = stale`, polling stops. */
export const SHIPMENT_STALE_STATUS_AFTER_DAYS = 30;
export const SHIPMENT_NO_MOVEMENT_STATUSES: readonly ShipmentStatusName[] = ['sent', 'picked_up', 'in_transit'];
/** 04 §22: at the 3rd failed attempt the UI proposes the return. */
export const SHIPMENT_MAX_ATTEMPTS = 3;
/** 04 §22: manual "Actualiser" ≤ 1 per 5 min per shipment (`429 TRACKING_SYNC_RATE_LIMITED {retryAfter}`). */
export const TRACKING_SYNC_COOLDOWN_S = 300;
/** DLV-04 polling cadence. */
export const TRACKING_CADENCE = { earlyEveryHours: 2, earlyDays: 3, lateEveryHours: 12 } as const;
export const SHIPMENT_BULK_MAX_IDS = 500;

/**
 * 04 §1.5: `Order.deliveryStatus` written for a courier status. `picked_up` reads as `in_transit`; `cancelled` and
 * `stale` leave `deliveryStatus` unchanged (null here).
 */
export const DELIVERY_STATUS_OF_SHIPMENT: Record<ShipmentStatusName, 'pending' | 'sent' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed' | 'returned' | null> = {
  pending: 'pending',
  sent: 'sent',
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed: 'failed',
  returned: 'returned',
  cancelled: null,
  stale: null,
};

const MAX_MONEY = 1_000_000;
const money = z.number({ invalid_type_error: 'validation.price', required_error: 'validation.required' }).int('validation.price').min(0, 'validation.price').max(MAX_MONEY, 'validation.price');
const flag = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v), z.boolean());
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const ids = z.array(id, { required_error: 'validation.required' }).min(1, 'validation.required').max(SHIPMENT_BULK_MAX_IDS, 'validation.length');
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
const text = (max: number) => z.string().trim().max(max, 'validation.length');
const wilayaId = z.coerce.number({ required_error: 'validation.wilaya', invalid_type_error: 'validation.wilaya' }).int('validation.wilaya').min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya');
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const phone = z
  .string({ required_error: 'validation.required', invalid_type_error: 'validation.phone' })
  .transform(normalizePhoneDz)
  .refine(isPhoneDz, 'validation.phone');
const secret = (max = 300) => z.string({ required_error: 'validation.required', invalid_type_error: 'validation.required' }).trim().min(1, 'validation.required').max(max, 'validation.length');

// --- geo (DLV-09) -------------------------------------------------------------------------------------------------------
export type WilayaView = { id: number; code: string; nameFr: string; nameAr: string };
export type CommuneView = { id: number; wilayaId: number; nameFr: string; nameAr: string; postalCode: string | null };

// --- fee grid (DLV-01 / DLV-02) ---------------------------------------------------------------------------------------
/** `PUT /delivery/fees/:wilayaId` — the row becomes `source=custom`. `freeAbove` null ⇒ `Workspace.freeDeliveryThreshold`. */
export const UpdateFeeRuleSchema = z
  .object({
    homePrice: money,
    stopdeskPrice: money,
    returnPrice: money.optional(),
    freeAbove: money.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateFeeRuleInput = z.infer<typeof UpdateFeeRuleSchema>;
/** `POST /delivery/fees/seed { overwrite }` — `false` = "Compléter les manquantes" (custom rows kept), `true` = "Tout réinitialiser". */
export const SeedFeesSchema = z.object({ overwrite: z.boolean().default(false) }).strict();
export type SeedFeesInput = z.infer<typeof SeedFeesSchema>;
/** `GET /delivery/fees/quote?wilayaId&stopdesk&subtotal`. */
export const FeeQuoteQuerySchema = z
  .object({
    wilayaId: z.coerce.number({ required_error: 'validation.wilaya' }).int('validation.wilaya').min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya'),
    stopdesk: flag.optional(),
    subtotal: z.coerce.number().int('validation.price').min(0, 'validation.price').optional(),
  })
  .strict();
export type FeeQuoteQuery = z.infer<typeof FeeQuoteQuerySchema>;
/** `GET /delivery/stopdesks?provider&communeId`. */
export const StopdesksQuerySchema = z
  .object({ provider: z.enum(['zrexpress', 'ecotrack', 'yalidine']).optional(), communeId: z.coerce.number().int().positive().optional(), wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT).optional() })
  .strict();

/** api-contract §3.8 `FeeRuleDto` (+ `freeAbove` of the schema). `courierCost` = cached rate of the default courier, else null. */
export type FeeRuleView = {
  wilayaId: number;
  code: string;
  nameFr: string;
  nameAr: string;
  homePrice: number;
  stopdeskPrice: number;
  returnPrice: number;
  freeAbove: number | null;
  isActive: boolean;
  source: 'default' | 'custom';
  courierCost: number | null;
  actions: ActionDescriptor[];
};
/** `GET /delivery/fees` → `{ data: FeeRuleView[], meta: FeeGridMeta }` (69 rows, wilaya order). */
export type FeeGridMeta = { freeDeliveryThreshold: number | null; custom: number; inactive: number; missing: number };
/**
 * api-contract §3.8 `FeeQuoteDto`. `reason` ∈ `grid` | `free_threshold` | `override` | `not_served` | `stopdesk_unavailable`;
 * `base` = the grid price before the free-delivery rule; `freeFrom` = the threshold that applied (or would apply).
 */
export type FeeQuoteView = { fee: number; base: number; free: boolean; reason: 'grid' | 'free_threshold' | 'override' | 'not_served' | 'stopdesk_unavailable'; courierCost: number | null; wilayaServed: boolean; stopdeskAvailable: boolean; freeFrom: number | null; wilayaId: number; isStopdesk: boolean };
export type StopdeskView = { id: string; provider: 'zrexpress' | 'ecotrack' | 'yalidine'; externalId: string; name: string; address: string | null; communeId: number };

// --- courier providers & accounts (DLV-03, DLV-10; 05-integrations §2) ----------------------------------------------------
/** Credential fields per provider (05-integrations §2.1 `CourierCredentials`). */
export const COURIER_CREDENTIAL_FIELDS = {
  zrexpress: ['token', 'key'],
  ecotrack: ['baseUrl', 'token'],
  yalidine: ['apiId', 'apiToken'],
} as const satisfies Record<CourierProviderName, readonly string[]>;
/** ZR Express new platform (api.zrexpress.app, 05-integrations §2.2b): API key + tenant id instead of Procolis token + key. */
export const ZR_APP_CREDENTIAL_FIELDS = ['apiKey', 'tenantId'] as const;
/** The two ZR Express platforms: `app` = api.zrexpress.app (account `baseUrl` = `ZR_APP_BASE_URL`), `procolis` = procolis.com (`baseUrl` ''). */
export type ZrPlatform = 'app' | 'procolis';
export const ZR_APP_BASE_URL = 'https://api.zrexpress.app';
export type CourierCredentialField = 'token' | 'key' | 'baseUrl' | 'apiId' | 'apiToken' | 'apiKey' | 'tenantId';
/** What a provider can do (adapter `capabilities`, api-contract `CourierAccountDto.capabilities`). */
export type CourierCapabilities = { parcel: boolean; tracking: boolean; label: boolean; rates: boolean; stopdesk: boolean; cancel: boolean; retry: boolean; webhook: boolean; batchTrack: boolean };
/**
 * `GET /delivery/couriers/providers` — the add dialog (provider → dynamic fields). `manual` = "Livraison propre"
 * (no account, no credentials: `POST /orders/:id/ship-manual`), listed with `account: false`.
 */
export type CourierProviderField = { key: CourierCredentialField; type: 'text' | 'secret' | 'url'; required: true; labelKey: string; placeholder: string | null };
export type CourierProviderView = {
  provider: ShipmentProviderName;
  name: string;
  account: boolean;
  fields: CourierProviderField[];
  capabilities: CourierCapabilities;
  portalUrl: string | null;
  /** courier label PDF offered by the provider (else the Djaber label is printed — ZR Express Procolis, manual) */
  labelSource: 'courier' | 'djaber';
  /** ZR Express only: the platform picked in the dialog (first = default: the new one); the fields above stay Procolis'. */
  platforms?: { key: ZrPlatform; name: string; fields: CourierProviderField[]; capabilities: CourierCapabilities; portalUrl: string | null; labelSource: 'courier' | 'djaber' }[];
};

/** https://<instance>.ecotrack.dz (05-integrations §2.3). */
export const ECOTRACK_URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ecotrack\.dz\/?$/i;
export const ZrCredentialsSchema = z.object({ token: secret(), key: secret() }).strict();
export const ZrAppCredentialsSchema = z.object({ apiKey: secret(), tenantId: secret(100) }).strict();
/** ZR Express: the new platform when `apiKey` / `tenantId` is sent, else Procolis (field errors of the platform meant). */
const ZrAnyCredentialsSchema = z.record(z.unknown(), { errorMap: () => ({ message: 'validation.required' }) }).transform((v, ctx) => {
  const r = ('apiKey' in v || 'tenantId' in v ? ZrAppCredentialsSchema : ZrCredentialsSchema).safeParse(v);
  if (r.success) return r.data;
  for (const issue of r.error.issues) ctx.addIssue(issue);
  return z.NEVER;
});
export const EcotrackCredentialsSchema = z
  .object({ baseUrl: z.string({ required_error: 'validation.required' }).trim().min(1, 'validation.required').max(200, 'validation.length').regex(ECOTRACK_URL_RE, 'validation.url_https').transform((u) => u.replace(/\/$/, '').toLowerCase()), token: secret() })
  .strict();
export const YalidineCredentialsSchema = z.object({ apiId: secret(100), apiToken: secret() }).strict();
const sender = z
  .object({
    name: emptyToNull(text(80)),
    phone: emptyToNull(phone),
    address: emptyToNull(text(300)),
    wilayaId: wilayaId.nullable().optional(),
  })
  .strict();
const accountCommon = {
  displayName: emptyToNull(z.string().trim().min(2, 'validation.length').max(60, 'validation.length')),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sender: sender.optional(),
  /** shared secret the courier sends with its webhooks (Yalidine `X-Yalidine-Secret`); generated when omitted */
  webhookSecret: emptyToNull(z.string().trim().min(16, 'validation.length').max(200, 'validation.length')),
};
/**
 * `POST /delivery/couriers` (`delivery.manage`, audited) — per-provider required fields (DLV-03 fix); credentials are
 * stored AES-256-GCM and never returned. `409 CONFLICT` when the same provider (+ EcoTrack instance / ZR platform) already exists.
 * The provider is not called here: the dialog calls `POST /delivery/couriers/:id/test` right after.
 */
export const CreateCourierAccountSchema = z.discriminatedUnion(
  'provider',
  [
    // new platform (apiKey + tenantId) or Procolis (token + key); the platform is stored as the account `baseUrl`
    z.object({ provider: z.literal('zrexpress'), credentials: ZrAnyCredentialsSchema, ...accountCommon }).strict(),
    z.object({ provider: z.literal('ecotrack'), credentials: EcotrackCredentialsSchema, ...accountCommon }).strict(),
    z.object({ provider: z.literal('yalidine'), credentials: YalidineCredentialsSchema, ...accountCommon }).strict(),
  ],
  { errorMap: () => ({ message: 'validation.required' }) },
);
export type CreateCourierAccountInput = z.infer<typeof CreateCourierAccountSchema>;
/**
 * `PATCH /delivery/couriers/:id` — every field optional; `credentials` replaces the stored ones only when sent (all
 * fields of the provider required then). `isActive=false` = "Désactiver" (the way out when delete is blocked).
 */
export const UpdateCourierAccountSchema = z
  .object({
    ...accountCommon,
    credentials: z.union([ZrCredentialsSchema, ZrAppCredentialsSchema, EcotrackCredentialsSchema, YalidineCredentialsSchema]).optional(),
  })
  .strict();
export type UpdateCourierAccountInput = z.infer<typeof UpdateCourierAccountSchema>;

/** Last connection test (stored on the account). `error` = `COURIER_CREDENTIALS_INVALID` | `COURIER_UNAVAILABLE`. */
export type CourierTestView = { at: string; ok: boolean; latencyMs: number | null; error: 'COURIER_CREDENTIALS_INVALID' | 'COURIER_UNAVAILABLE' | null };
/** `POST /delivery/couriers/:id/test` (provider called with a 10 s timeout — the one allowed synchronous courier call). */
export type CourierTestResultView = CourierTestView & { message: string | null; accountName: string | null; wilayasServed: number | null; account: CourierAccountView };
/** api-contract §3.8 `CourierAccountDto` (+ masked hints, webhook URL, actions). */
export type CourierAccountView = {
  id: string;
  provider: CourierProviderName;
  displayName: string;
  baseUrl: string;
  /** ZR Express platform of the account (`app` when `baseUrl` = `ZR_APP_BASE_URL`); null for the other providers */
  platform: ZrPlatform | null;
  isActive: boolean;
  isDefault: boolean;
  sender: { name: string | null; phone: string | null; address: string | null; wilayaId: number | null };
  capabilities: CourierCapabilities;
  lastTest: CourierTestView | null;
  stats: { sent: number; failed30d: number; activeShipments: number };
  credentialsSet: true;
  /** masked hints per credential field: `••••3f9a` (secrets) or the full instance URL (EcoTrack `baseUrl`) */
  credentialHints: Partial<Record<CourierCredentialField, string>>;
  /** URL to paste in the courier portal (couriers that push webhooks), else null */
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  createdAt: string;
  updatedAt: string;
  /** `edit`, `test`, `set_default`, `activate` / `deactivate`, `delete` (greyed `COURIER_HAS_ACTIVE_SHIPMENTS`) */
  actions: ActionDescriptor[];
};

// --- shipments: send (DLV-05, FL-08) ------------------------------------------------------------------------------------
/**
 * `POST /orders/:id/shipments` (Idempotency-Key required, `delivery.send`) → **202** `{ data: ShipmentView }` (status
 * `pending`, "sending…" until WS `shipment.updated`). Prefilled from the ORDER's address (never the sender default);
 * an address changed in the dialog is written to the order first (same rules as `POST /orders/:id/address`).
 * `courierAccountId` defaults to the workspace default courier. Refusals: `422 DELIVERY_ORDER_NOT_CONFIRMED`,
 * `409 DELIVERY_ORDER_ALREADY_SENT`, `422 DELIVERY_NO_COURIER`, `422 ORDER_ADDRESS_REQUIRED`, stop-desk id required when
 * `isStopdesk` and the provider has stop-desks (`422 VALIDATION_ERROR fields.stopdeskId`).
 */
export const CreateShipmentSchema = z
  .object({
    courierAccountId: emptyToNull(id),
    wilayaId,
    communeId: z.coerce.number().int('validation.commune').positive('validation.commune').nullable().optional(),
    communeText: emptyToNull(z.string().trim().min(1, 'validation.commune').max(100, 'validation.commune')),
    address: emptyToNull(z.string().trim().max(500, 'validation.address')),
    isStopdesk: z.boolean({ required_error: 'validation.required' }),
    stopdeskId: emptyToNull(text(80)),
    /** default = order total − already paid */
    codAmount: money.optional(),
    weightKg: z.number({ invalid_type_error: 'validation.range' }).min(0.1, 'validation.range').max(30, 'validation.range').optional(),
    contentSummary: emptyToNull(text(200)),
    note: emptyToNull(text(300)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.isStopdesk && (v.address ?? '').length < 10) ctx.addIssue({ code: 'custom', path: ['address'], message: 'validation.address' });
    if (!v.communeId && !v.communeText) ctx.addIssue({ code: 'custom', path: ['communeId'], message: 'validation.commune' });
  });
export type CreateShipmentInput = z.infer<typeof CreateShipmentSchema>;
/**
 * `POST /shipments/bulk { orderIds[], courierAccountId? }` (Idempotency-Key required) → **202** `{ data: { jobId } }`
 * (Job `kind=bulk_send`, name `bulk-send`). Each order is sent with its own address; `Job.result` = `BulkSendResult`.
 */
export const BulkSendSchema = z.object({ orderIds: ids, courierAccountId: emptyToNull(id), weightKg: z.number().min(0.1, 'validation.range').max(30, 'validation.range').optional() }).strict();
export type BulkSendInput = z.infer<typeof BulkSendSchema>;
/**
 * Per-order outcome (MECH Delivery bulk results dialog). `status` = shipment status after the first attempt: `sent`
 * (tracking known), `pending` (courier unavailable ⇒ queued retries), `failed` (validation). `error.code` ∈
 * `DELIVERY_ORDER_NOT_CONFIRMED | DELIVERY_ORDER_ALREADY_SENT | ORDER_ADDRESS_REQUIRED | COURIER_VALIDATION |
 * COURIER_CREDENTIALS_INVALID | COURIER_UNAVAILABLE | NOT_FOUND`.
 */
export type BulkSendRowResult = {
  id: string;
  ok: boolean;
  orderNumber: string | null;
  data?: { shipmentId: string; status: ShipmentStatusName; trackingNumber: string | null };
  error?: { code: string; message: string; params?: Record<string, string | number>; fields?: Record<string, string> };
};
export type BulkSendResult = { results: BulkSendRowResult[]; ok: number; failed: number; queued: number };

/** `POST /shipments/bulk/sync { ids[] }` → 202 `{ data: { jobId } }` (Job `kind=tracking_refresh`) · `POST /shipments/bulk/ship-manual { ids[] }` (order ids) → 200 bulk results. */
export const BulkShipmentIdsSchema = z.object({ ids }).strict();
export type BulkShipmentIdsInput = z.infer<typeof BulkShipmentIdsSchema>;

// --- shipments: actions (06 §8.5, 04 §22, FL-25) ---------------------------------------------------------------------------
/**
 * `POST /shipments/:id/cancel { then }` — allowed while `status ∈ pending|sent` and the provider supports cancel, else
 * `409 COURIER_CANCEL_NOT_ALLOWED`. `then` = what happens to the order: back to `confirmed` (default) or `cancelled`
 * (`reason` = CancelReason then). Courier parcels → 202 (the courier is called by the worker), manual → 200.
 */
export const CancelShipmentSchema = z
  .object({
    then: z.enum(['confirmed', 'cancelled']).default('confirmed'),
    reason: z.enum(['unreachable', 'changed_mind', 'fake', 'unavailable', 'duplicate', 'other']).optional(),
    note: emptyToNull(text(500)),
  })
  .strict();
export type CancelShipmentInput = z.infer<typeof CancelShipmentSchema>;
/** `POST /shipments/:id/mark-failed { reason, note? }` `[FIG DLG Échec de livraison]` (409 CONFLICT when delivered/returned/cancelled). */
export const MarkFailedSchema = z.object({ reason: z.enum(FailureReasonValues, { errorMap: () => ({ message: 'validation.required' }) }), note: emptyToNull(text(500)) }).strict();
export type MarkFailedInput = z.infer<typeof MarkFailedSchema>;
/** `POST /shipments/:id/mark-delivered` `[FIG DLG Marquer livrée manuellement]` — COD rule (same fields as `POST /orders/:id/deliver`). */
export const MarkDeliveredSchema = z
  .object({ amountCollected: z.number().int('validation.price').min(0, 'validation.price').optional(), reason: emptyToNull(text(500)), deliveredAt: z.string().datetime({ offset: true, message: 'validation.date' }).optional(), notifyCustomer: z.boolean().optional() })
  .strict();
export type MarkDeliveredInput = z.infer<typeof MarkDeliveredSchema>;
/**
 * `POST /shipments/:id/mark-returned` `[FIG DLG Marquer retournée]` — "return received": order `returned`, stock back
 * unless `restoreStock=false`, return fee (grid `returnPrice` default) as a shipping expense (D27).
 */
export const MarkReturnedSchema = z
  .object({ reason: z.enum(FailureReasonValues).optional(), restoreStock: z.boolean().default(true), returnFee: money.optional(), note: emptyToNull(text(500)) })
  .strict();
export type MarkReturnedInput = z.infer<typeof MarkReturnedSchema>;
/**
 * `POST /shipments/:id/change-courier { courierAccountId }` — failed send / unsent parcel: the old parcel is cancelled
 * (409 COURIER_CANCEL_NOT_ALLOWED once picked up) and a new one is sent; recomputes `courierCost` only, never the
 * customer fee (D15). → 202 `{ data: ShipmentView }` (the new parcel).
 */
export const ChangeCourierSchema = z.object({ courierAccountId: id }).strict();
export type ChangeCourierInput = z.infer<typeof ChangeCourierSchema>;
/** `POST /shipments/:id/retry-delivery { note? }` — adapter `retryDelivery` (attempt +1) → 202; unsupported after pickup ⇒ 409 COURIER_CANCEL_NOT_ALLOWED. */
export const RetryDeliverySchema = z.object({ note: emptyToNull(text(300)) }).strict();
export type RetryDeliveryInput = z.infer<typeof RetryDeliverySchema>;
// `POST /shipments/:id/sync` (no body) → 202 ShipmentView (429 TRACKING_SYNC_RATE_LIMITED {retryAfter} within 5 min);
// `POST /shipments/:id/retry` (no body) → 202 ShipmentView: re-sends a parcel whose creation failed.

// --- labels (DLV-06, 04 §22) ---------------------------------------------------------------------------------------------
/** Djaber label formats: A6 (105 × 148 mm, default), thermal 100 × 150 mm, A5 (148 × 210 mm). */
export const LABEL_FORMATS = ['a6', 'thermal', 'a5'] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];
/** `GET /shipments/:id/label?format&source` → `{ data: LabelFileView }`; a courier without labels (ZR) answers the Djaber label with the warning `LABEL_UNAVAILABLE` in `meta.warnings`. */
export const LabelQuerySchema = z.object({ format: z.enum(LABEL_FORMATS).default('a6'), source: z.enum(['auto', 'djaber']).default('auto'), lang: z.enum(['fr', 'ar', 'en']).optional() }).strict();
export type LabelQuery = z.infer<typeof LabelQuerySchema>;
export type LabelFileView = { url: string; fileName: string; size: number; source: 'courier' | 'djaber'; format: LabelFormat; expiresAt: string };
/**
 * `POST /shipments/labels { orderIds | shipmentIds, format, markPrinted }` → 202 `{ data: { jobId } }` (Job
 * `kind=labels`, name `labels-merge`): one merged PDF; orders without a created shipment are skipped with
 * `SHIPMENT_NOT_CREATED`; `markPrinted` sets `Order.labelPrintedAt` ("Marquer bordereau imprimé").
 */
export const LabelsJobSchema = z
  .object({
    orderIds: z.array(id).max(SHIPMENT_BULK_MAX_IDS, 'validation.length').optional(),
    shipmentIds: z.array(id).max(SHIPMENT_BULK_MAX_IDS, 'validation.length').optional(),
    format: z.enum(LABEL_FORMATS).default('a6'),
    markPrinted: z.boolean().default(false),
    lang: z.enum(['fr', 'ar', 'en']).optional(),
    /** M11 (DLG "Imprimer les bordereaux"): `true` ⇒ one PDF per order in a ZIP instead of one merged PDF */
    onePdfPerOrder: z.boolean().default(false),
    /** M11: first page = internal recap (order number, client, wilaya, courier, tracking, COD amount) */
    includeRecap: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.orderIds?.length && !v.shipmentIds?.length) ctx.addIssue({ code: 'custom', path: ['orderIds'], message: 'validation.required' });
  });
export type LabelsJobInput = z.infer<typeof LabelsJobSchema>;
/** `Job.result` of `labels-merge`. */
/**
 * `Job.result` of `labels-merge`. M11: with `onePdfPerOrder` the file is a ZIP (`fileName` ends in `.zip`, `files` = PDFs
 * inside: one per order + `recapitulatif.pdf` when `includeRecap`); `pages` counts every page, the recap included.
 */
export type LabelsJobResult = { kind: 'labels'; count: number; pages: number; format: LabelFormat; fileName: string; size: number; skipped: { id: string; orderNumber: string | null; code: 'SHIPMENT_NOT_CREATED' | 'NOT_FOUND' }[]; courierLabels: number; djaberLabels: number; onePdfPerOrder?: boolean; includeRecap?: boolean; files?: number };
/** `POST /products/bulk/labels { ids[], copies?, withPrice? }` → 202 `{ data: { jobId } }` (A4 sheet, 3 × 8 labels: name, variant, SKU, price, QR of the SKU). */
export const ProductLabelsSchema = z
  .object({ ids: z.array(id).min(1, 'validation.required').max(SHIPMENT_BULK_MAX_IDS, 'validation.length'), copies: z.number().int().min(1, 'validation.range').max(50, 'validation.range').default(1), withPrice: z.boolean().default(true), includeVariants: z.boolean().default(true) })
  .strict();
export type ProductLabelsInput = z.infer<typeof ProductLabelsSchema>;
export type ProductLabelsJobResult = { kind: 'product_labels'; count: number; pages: number; fileName: string; size: number };

// --- shipments read model (api-contract §3.8 ShipmentDto) ----------------------------------------------------------------
export type ShipmentEventView = { at: string; rawStatus: string; mappedStatus: ShipmentStatusName | null; description: string | null; location: string | null; source: string; actor: OrderUserRef | null };
/** Code of the last courier error + the field it maps to (COURIER_VALIDATION → `commune`, `phone`, `address`, `wilaya`, `weight`, `cod`, `other`). */
export type ShipmentErrorView = { code: string; field: string | null; message: string | null };
export type ShipmentView = {
  id: string;
  orderId: string;
  orderNumber: string;
  client: ClientRefView;
  provider: ShipmentProviderName;
  courierAccount: { id: string; displayName: string } | null;
  status: ShipmentStatusName;
  trackingNumber: string | null;
  labelUrl: string | null;
  publicTrackingUrl: string;
  codAmount: number;
  weightKg: number | null;
  contentSummary: string | null;
  address: AddressView;
  courierCost: number | null;
  failureReason: FailureReasonCode | null;
  deliveryAttempts: number;
  /** error code of the last send / sync (`COURIER_VALIDATION`, `COURIER_UNAVAILABLE`, `COURIER_CREDENTIALS_INVALID`, `TRACKING_NOT_FOUND`, `COURIER_CANCEL_NOT_ALLOWED`) */
  lastError: string | null;
  error: ShipmentErrorView | null;
  lastSyncedAt: string | null;
  /** when "Actualiser" is available again (null = now) */
  syncAvailableAt: string | null;
  /** courier portal link of the parcel when the provider has one */
  portalUrl: string | null;
  /** last courier event (or creation) — drives "Sans mouvement" */
  lastEventAt: string | null;
  /** "Sans mouvement": no event for > 5 d while `sent | picked_up | in_transit` */
  noMovement: boolean;
  /** the courier reports a return in progress; the order turns `returned` when the merchant confirms reception */
  returnPending: boolean;
  /** courier label available (else the Djaber label is printed) */
  labelSource: 'courier' | 'djaber';
  events: ShipmentEventView[];
  createdAt: string;
  /**
   * Menu order: `sync`, `label`, `retry` (failed send), `retry_delivery`, `change_courier`, `cancel`, `mark_failed`,
   * `mark_delivered`, `mark_returned`, `open_order`, `call_client` — greyed with their code.
   */
  actions: ActionDescriptor[];
};
/** WS `shipment.updated` (03-events §2). */
export type ShipmentUpdatedEvent = {
  shipment: { id: string; orderId: string; status: ShipmentStatusName; trackingNumber: string | null; failureReason: FailureReasonCode | null; lastSyncedAt: string | null; labelUrl: string | null; lastError: string | null };
  event?: ShipmentEventView;
};

// --- delivery list & overview (DLV-08, MECH Delivery, 06 §10 "Livraison & suivi") ----------------------------------------
export const SHIPMENT_SORTS = ['lastSyncedAt', 'createdAt', 'orderNumber'] as const;
export const SHIPMENT_LAST_EVENT = ['lt24h', '2_5d', 'gt5d_stale'] as const;
const shipmentsFilters = {
  /** `not_sent` = order confirmed / preparing without an active parcel ("À envoyer"), then the ShipmentStatus enum */
  shipmentStatus: csv(z.enum(['not_sent', ...ShipmentStatusValues])).optional(),
  provider: csv(z.enum(ShipmentProviderValues)).optional(),
  courierAccountId: csv(id).optional(),
  deliveryType: z.enum(['home', 'stopdesk']).optional(),
  wilayaId: csv(z.coerce.number().int().min(1).max(WILAYA_COUNT)).optional(),
  communeId: csv(z.coerce.number().int().positive()).optional(),
  orderStatus: csv(z.enum(OrderStatusValues)).optional(),
  lastEvent: z.enum(SHIPMENT_LAST_EVENT).optional(),
  failureReason: csv(z.enum(FailureReasonValues)).optional(),
  lastError: csv(z.enum(['COURIER_CREDENTIALS_INVALID', 'COURIER_VALIDATION', 'COURIER_UNAVAILABLE', 'TRACKING_NOT_FOUND'])).optional(),
  /** shipment `createdAt` (order `confirmedAt` for unsent rows), Africa/Algiers days, `to` inclusive */
  from: day.optional(),
  to: day.optional(),
  /** order ids (deep links `?ids=`) */
  ids: csv(id).optional(),
  /** order number, tracking number, client name / phone */
  q: z.string().trim().max(120).optional(),
};
/** api-contract §4 `ShipmentsQuery` (+ `courierAccountId`, `ids`). `GET /shipments` — one row per order (joined with its latest parcel). */
export const ShipmentsQuerySchema = z
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
    ...shipmentsFilters,
  })
  .strict();
export type ShipmentsQuery = z.infer<typeof ShipmentsQuerySchema>;
/** `GET /delivery/export` (M8, MECH "Exporter CSV"): the list filters + `format` → 202 `{ jobId }` (kind `export`). */
export const ShipmentsExportQuerySchema = ShipmentsQuerySchema.omit({ page: true, pageSize: true }).extend({ format: z.enum(['csv', 'xlsx']).default('csv') }).strict();
export type ShipmentsExportQuery = z.infer<typeof ShipmentsExportQuerySchema>;
/** `/delivery` tabs (Figma: Échecs · Sans mouvement · À envoyer · En transit · Retours · Toutes) = list filters (never a separate param). */
export const DELIVERY_TABS = {
  failed: { shipmentStatus: ['failed'] },
  no_movement: { lastEvent: 'gt5d_stale' },
  to_send: { shipmentStatus: ['not_sent'] },
  in_transit: { shipmentStatus: ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery'] },
  returns: { shipmentStatus: ['returned'] },
  all: {},
} as const satisfies Record<string, Partial<Pick<ShipmentsQuery, 'shipmentStatus' | 'lastEvent'>>>;
export type DeliveryTab = keyof typeof DELIVERY_TABS;

/** One row of `GET /shipments` (an order, with its latest parcel or none). Row menu = `actions` (order + parcel items). */
export type DeliveryRowView = {
  /** = orderId */
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: (typeof OrderStatusValues)[number];
  orderVersion: number;
  client: ClientRefView;
  total: number;
  remaining: number;
  wilaya: { id: number; name: string } | null;
  communeName: string | null;
  isStopdesk: boolean;
  confirmedAt: string | null;
  labelPrintedAt: string | null;
  shipment: {
    id: string;
    provider: ShipmentProviderName;
    courierAccount: { id: string; displayName: string } | null;
    status: ShipmentStatusName;
    trackingNumber: string | null;
    failureReason: FailureReasonCode | null;
    deliveryAttempts: number;
    lastError: string | null;
    error: ShipmentErrorView | null;
    codAmount: number;
    courierCost: number | null;
    lastEventAt: string | null;
    lastSyncedAt: string | null;
    noMovement: boolean;
    returnPending: boolean;
    createdAt: string;
  } | null;
  /** `send_courier`, `ship_manual`, `open_order`, `call_client` + the parcel actions of `ShipmentView.actions` */
  actions: ActionDescriptor[];
};
/**
 * `GET /delivery/overview` (the only overview endpoint) — api-contract `DeliveryOverviewDto` as `kpis`, + tab counts,
 * the first failures / "Sans mouvement" rows, and the courier set-up state (no courier ⇒ CTA + Livraison propre).
 */
export type DeliveryOverviewView = {
  kpis: {
    toSend: number;
    pendingPickup: number;
    inTransit: number;
    staleOver5d: number;
    failedToday: number;
    delivered30d: number;
    deliveredPct30d: number;
    returned30d: number;
    returnedPct30d: number;
    avgDays: number | null;
    byCourier: { provider: ShipmentProviderName; courierAccountId: string | null; displayName: string; sent: number; delivered: number; failed: number; returned: number; avgDays: number | null; codCollected: number }[];
  };
  tabs: Record<DeliveryTab, number>;
  failures: DeliveryRowView[];
  stale: DeliveryRowView[];
  couriers: { active: number; defaultId: string | null };
};

// --- rates (DLV-07, 05-integrations §2.7) ----------------------------------------------------------------------------------
/** `GET /delivery/rates?courierAccountId&wilayaId?&stopdesk?` — cache of 1 h; a missing / stale cache is refreshed by the worker (`refreshing: true`, refetch after a few seconds). */
export const RatesQuerySchema = z.object({ courierAccountId: id, wilayaId: wilayaId.optional(), stopdesk: flag.optional() }).strict();
export type RatesQuery = z.infer<typeof RatesQuerySchema>;
export type CourierRateView = { wilayaId: number; homePrice: number | null; stopdeskPrice: number | null; price: number | null; fetchedAt: string };
export type CourierRatesView = { courierAccountId: string; provider: CourierProviderName; rates: CourierRateView[]; fetchedAt: string | null; stale: boolean; refreshing: boolean; supported: boolean };
/** `POST /delivery/fees/copy-from-courier { courierAccountId, wilayaIds?, dryRun? }` ("copier les tarifs du transporteur dans ma grille", diff preview with `dryRun`). */
export const CopyFeesFromCourierSchema = z.object({ courierAccountId: id, wilayaIds: z.array(z.number().int().min(1).max(WILAYA_COUNT)).max(WILAYA_COUNT).optional(), dryRun: z.boolean().default(false) }).strict();
export type CopyFeesFromCourierInput = z.infer<typeof CopyFeesFromCourierSchema>;
export type CopyFeesDiffView = { rows: { wilayaId: number; nameFr: string; before: { homePrice: number; stopdeskPrice: number }; after: { homePrice: number; stopdeskPrice: number }; changed: boolean }[]; missing: number[]; written: number; dryRun: boolean; refreshing: boolean };

// --- public tracking (06 §12, `/s/[code]`) -------------------------------------------------------------------------------
/**
 * `GET /track/:publicToken` (public) — api-contract `TrackingPublicDto`: mapped status timeline only, no customer data
 * (04 §22). `label` = localized status pill text; `404 NOT_FOUND` for an unknown token.
 */
export type TrackingPublicView = {
  orderNumber: string;
  shopName: string;
  status: ShipmentStatusName;
  statusLabel: string;
  events: { at: string; status: ShipmentStatusName; label: string; location: string | null }[];
  courier: string;
  trackingNumber: string | null;
  wilayaName: string | null;
  isStopdesk: boolean;
  updatedAt: string;
  reportUrl: string;
};
/**
 * `POST /track/:publicToken/report { reason, details?, email?, captchaToken? }` (public "Signaler ce vendeur"; 3 / h / IP ⇒
 * 429 ABUSE_REPORT_RATE_LIMITED) → `{ data: { id, status } }`. M11: `captchaToken` is required when `GET /captcha/config`
 * answers a provider other than `none` (`422 VALIDATION_ERROR`, `fields.captchaToken = validation.captcha`).
 */
export const PublicTrackingReportSchema = z
  .object({ reason: z.enum(['harassment', 'fraud', 'spam', 'inappropriate_content', 'other'], { errorMap: () => ({ message: 'validation.required' }) }), details: emptyToNull(text(1000)), email: emptyToNull(z.string().trim().email('validation.email').max(200)), captchaToken: z.string().trim().max(4096).optional() })
  .strict();
export type PublicTrackingReportInput = z.infer<typeof PublicTrackingReportSchema>;
