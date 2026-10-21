// Clients (03 §9 CLI-01…05, §37 CLI; 04 §2, §13; api-contract §3.6; 06 "Clients", §8.3, §8.5, §10 "Clients").
// One source for the API (nestjs-zod DTOs) and the web. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';
import { ClientSourceValues } from '../enums';
import { email, fullName, normalizePhoneDz, isPhoneDz } from '../validators';
import type { ChannelRefView } from './channels';
import type { ActionDescriptor } from './common';
import type { ConversationListItemView } from './inbox';
import type { AddressView, OrderListItemView } from './orders';

// --- limits (spec values) ---------------------------------------------------------------------------------------------
export const CLIENT_TAGS_MAX = 20;
export const CLIENT_TAG_MAX_CHARS = 40;
export const CLIENT_BULK_MAX_IDS = 500;
export const CLIENT_SORTS = ['lastOrderAt', 'name', 'totalSpent', 'createdAt'] as const;
export const CLIENT_QUALITY_FILTERS = ['placeholder', 'no_phone', 'no_address', 'duplicates'] as const;
export const CLIENT_LAST_ORDER_FILTERS = ['lt30', '30_90', 'gt90', 'never'] as const;
/** Pills of the clients list `[FIG REF Component sheet]`: FIABLE · INCONNU · RISQUE · BLOQUÉ · PLACEHOLDER. */
export const CLIENT_PILLS = ['reliable', 'unknown', 'risk', 'blocked', 'placeholder'] as const;
export type ClientPill = (typeof CLIENT_PILLS)[number];

// --- primitives -------------------------------------------------------------------------------------------------------
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const ids = z.array(id, { required_error: 'validation.required' }).min(1, 'validation.required').max(CLIENT_BULK_MAX_IDS, 'validation.length');
/** `''` and blank strings (`'   '`) mean "no value" for an optional field (an email made of spaces is not an invalid email). */
const emptyToNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());
/** 04 §2: normalised DZ phone (`+213 555 12 34 56` ⇒ `0555123456`). */
export const clientPhone = z
  .string({ required_error: 'validation.required', invalid_type_error: 'validation.phone' })
  .transform(normalizePhoneDz)
  .refine(isPhoneDz, 'validation.phone');
const tag = z.string().trim().min(1, 'validation.required').max(CLIENT_TAG_MAX_CHARS, 'validation.length');
const tags = z.array(tag).max(CLIENT_TAGS_MAX, 'validation.length');
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const int = z.coerce.number().int('validation.range').min(0, 'validation.range');

/** An address of the client card (04 §2: commune belongs to the wilaya; address ≥ 10 chars for home delivery). */
export const ClientAddressSchema = z
  .object({
    wilayaId: z.coerce.number({ required_error: 'validation.wilaya' }).int('validation.wilaya').min(1, 'validation.wilaya').max(WILAYA_COUNT, 'validation.wilaya'),
    communeId: z.coerce.number().int('validation.commune').positive('validation.commune').nullable().optional(),
    communeText: emptyToNull(z.string().trim().max(100, 'validation.commune')),
    address: emptyToNull(z.string().trim().max(500, 'validation.address')),
    isStopdesk: z.boolean().optional(),
    stopdeskId: emptyToNull(z.string().trim().max(80, 'validation.length')),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.isStopdesk && v.address && v.address.length < 10) ctx.addIssue({ code: 'custom', path: ['address'], message: 'validation.address' });
  });
export type ClientAddressInput = z.infer<typeof ClientAddressSchema>;

// --- inputs -----------------------------------------------------------------------------------------------------------
/** `POST /clients` `[FIG DLG Nouveau client]` — phone unique per workspace (409 CLIENT_PHONE_EXISTS {clientName} + "use existing"). */
export const CreateClientSchema = z
  .object({
    name: fullName,
    phone: clientPhone,
    phone2: emptyToNull(clientPhone),
    email: emptyToNull(email),
    notes: emptyToNull(z.string().trim().max(2000, 'validation.length')),
    tags: tags.optional(),
    address: ClientAddressSchema.nullable().optional(),
  })
  .strict();
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

/** `PATCH /clients/:id` (quick edit panel: name, phone, tags, risk, default address; LST-06). */
export const UpdateClientSchema = z
  .object({
    name: fullName,
    phone: clientPhone,
    phone2: emptyToNull(clientPhone),
    email: emptyToNull(email),
    notes: emptyToNull(z.string().trim().max(2000, 'validation.length')),
    tags,
    riskLevel: z.enum(['normal', 'high']),
    /** replaces the default address (null removes it) */
    defaultAddress: ClientAddressSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;

/** `POST /clients/:id/risk` `[FIG SAFE "Marquer risque"]` — sets `riskSetManually` (the nightly rule then leaves the client alone). */
export const ClientRiskSchema = z.object({ riskLevel: z.enum(['normal', 'high'], { errorMap: () => ({ message: 'validation.invalid' }) }) }).strict();
export type ClientRiskInput = z.infer<typeof ClientRiskSchema>;

/** `POST /clients/merge` — without `confirm: true` ⇒ 409 CUSTOMER_MERGE_IRREVERSIBLE with `details: { keep, merge }` (AT-CLI-06). */
export const MergeClientsSchema = z.object({ keepId: id, mergeId: id, confirm: z.boolean().optional() }).strict();
export type MergeClientsInput = z.infer<typeof MergeClientsSchema>;

/** `POST /clients/bulk/tags { ids[], add[], remove[] }` `[FIG DLG Tags]`. */
export const BulkClientTagsSchema = z.object({ ids, add: tags.default([]), remove: tags.default([]) }).strict();
export type BulkClientTagsInput = z.infer<typeof BulkClientTagsSchema>;
/** `POST /clients/bulk/export`. */
export const BulkClientIdsSchema = z.object({ ids }).strict();
/** `POST /clients/bulk/delete { ids[], archive? }` — rows with orders fail with CUSTOMER_HAS_ORDERS unless `archive: true`. */
export const BulkDeleteClientsSchema = z.object({ ids, archive: z.boolean().optional() }).strict();

/** `DELETE /clients/:id?archive=true` — a client with orders is archived only when asked (else 409 CUSTOMER_HAS_ORDERS {count}). */
export const DeleteClientQuerySchema = z.object({ archive: flag.optional() }).strict();

// --- list query (06 §10 "Clients") ------------------------------------------------------------------------------------
export const ClientsQuerySchema = z
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
    source: csv(z.enum(ClientSourceValues)).optional(),
    quality: csv(z.enum(CLIENT_QUALITY_FILTERS)).optional(),
    tags: csv(tag).optional(),
    riskLevel: z.enum(['normal', 'high']).optional(),
    channelId: csv(id).optional(),
    noConversation: flag.optional(),
    minOrders: int.optional(),
    maxOrders: int.optional(),
    neverOrdered: flag.optional(),
    returned: flag.optional(),
    minSpent: int.optional(),
    maxSpent: int.optional(),
    lastOrder: z.enum(CLIENT_LAST_ORDER_FILTERS).optional(),
    wilayaId: csv(z.coerce.number().int().min(1).max(WILAYA_COUNT)).optional(),
    createdFrom: day.optional(),
    createdTo: day.optional(),
    /** alias of createdFrom / createdTo (06 §2 `from&to`) */
    from: day.optional(),
    to: day.optional(),
    blocked: flag.optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type ClientsQuery = z.infer<typeof ClientsQuerySchema>;
/** `GET /clients/export` → 202: the list filters + format. */
export const ClientsExportQuerySchema = ClientsQuerySchema.extend({ format: z.enum(['csv', 'xlsx']).optional() });

/** M11 — `GET /clients/tags?q=` (tag suggestions of the filters and of the Tags dialog): the distinct tags of the workspace's clients. */
export const CLIENT_TAGS_SUGGESTIONS_MAX = 100;
export const ClientTagsQuerySchema = z.object({ q: z.string().trim().max(50, 'validation.length').optional() }).strict();
export type ClientTagsQuery = z.infer<typeof ClientTagsQuerySchema>;
/** One row of `GET /clients/tags` → `{ data: ClientTagCount[] }`: sorted by `count` desc, then `tag`; at most 100 rows. */
export type ClientTagCount = { tag: string; count: number };

// --- read models (api-contract §2 ClientRef, §3.6) ----------------------------------------------------------------------
export type ClientRefView = { id: string; name: string; phone: string | null; riskLevel: 'normal' | 'high'; isPlaceholder: boolean; blocked: boolean; orderCount: number };
export type ClientQuality = 'placeholder' | 'no_phone' | 'no_address' | 'duplicate';
export type ClientListItemView = ClientRefView & {
  phone2: string | null;
  source: (typeof ClientSourceValues)[number];
  totalSpent: number;
  lastOrderAt: string | null;
  tags: string[];
  channels: ChannelRefView[];
  quality: ClientQuality[];
  /** list pill: blocked > risk > placeholder > reliable (≥ 1 delivered, 0 return) > unknown (0 order) > null */
  pill: ClientPill | null;
  deliveredCount: number;
  returnCount: number;
  cancelCount: number;
  archived: boolean;
  createdAt: string;
  actions: ActionDescriptor[];
};
export type ClientAddressView = AddressView & { id: string; isDefault: boolean };
/** `spent` = `ordersSpent` (Σ delivered orders) + `salesSpent` (Σ completed counter sales, `sales` of them) — CLI-04. */
export type ClientMetricsView = { orders: number; delivered: number; spent: number; ordersSpent: number; sales: number; salesSpent: number; returns: number; returnPct: number; cancels: number; conversations: number; lastOrderAt: string | null };
/** Counter sale of a client (drafts left out), latest first. */
export type ClientSaleItemView = { id: string; number: string; soldAt: string; total: number; status: 'completed' | 'cancelled'; paymentStatus: 'unpaid' | 'partial' | 'paid' };
export type ClientView = ClientListItemView & {
  email: string | null;
  notes: string | null;
  riskSetManually: boolean;
  mergedIntoId: string | null;
  addresses: ClientAddressView[];
  metrics: ClientMetricsView;
  mergedFrom: { id: string; name: string; at: string }[];
  recentOrders: OrderListItemView[];
  recentSales: ClientSaleItemView[];
  conversations: ConversationListItemView[];
  block: { id: string; source: 'manual' | 'auto_rule' | 'platform'; reason: string | null; blockedAt: string; unblockable: boolean } | null;
};
/** 409 CUSTOMER_MERGE_IRREVERSIBLE `details` — what the merge dialog shows before the confirmation. */
export type ClientMergePreview = { keep: ClientRefView & { conversations: number }; merge: ClientRefView & { conversations: number } };
