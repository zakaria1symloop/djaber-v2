// Platform admin — ops & safety (M10, api-b): moderation queue + trust levels (ADM-10, D36/D52), abuse reports, platform
// blacklist and blocked words (ADM-11, D37), support tickets (ADM-12, D38), platform settings (ADM-13, D39/D58), jobs &
// health + incidents (ADM-14, D59). Sources: 06 §8.11 + §9, api-contract §3.13 + §4, 03-events-and-jobs §3.2, 04 §12–§15.
// One source for the API (nestjs-zod DTOs) and the web. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import {
  AppealDecisionValues,
  AppPlatformValues,
  IncidentSeverityValues,
  IncidentStatusValues,
  LegalDocKeyValues,
  LocaleValues,
  MetaPermissionStatusValues,
  ModerationDecisionValues,
  ModerationItemStatusValues,
  ModerationItemTypeValues,
  ModerationRuleKindValues,
  ProviderStatusValues,
  ReportDecisionValues,
  ReporterKindValues,
  ReportReasonValues,
  ReportStatusValues,
  ReportTypeValues,
  SeverityValues,
  StoreStatusValues,
  TicketCategoryValues,
  TicketChannelValues,
  TicketPriorityValues,
  TicketStatusValues,
  TrustLevelValues,
} from '../enums';
import type { ActionDescriptor } from './common';
import type { InboxUserRef } from './inbox';

const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const instant = z.string().datetime({ offset: true, message: 'validation.date' });
const pageSize = z.coerce.number().refine((n) => n === 25 || n === 50 || n === 100, 'validation.range').default(25);
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize };
const ids = z.array(id).min(1, 'validation.required').max(100, 'validation.length');
/** Admin writes touching a merchant need `reason ≥ 10 chars` (06 §9) — enforced by the service as 422 ADMIN_REASON_REQUIRED. */
const reason = z.string().trim().max(500, 'validation.length');
const note = z.string().trim().max(1000, 'validation.length');
/** Texts edited in every locale at once (api-contract §1.1 "admin resources that edit all locales"). */
export const OpsLocalizedTextSchema = z
  .object({ fr: z.string().trim().min(1, 'validation.required').max(2000, 'validation.length'), ar: z.string().trim().max(2000, 'validation.length').optional(), en: z.string().trim().max(2000, 'validation.length').optional() })
  .strict();
export type OpsLocalizedText = z.infer<typeof OpsLocalizedTextSchema>;
const period = z.enum(['today', '7d', '30d', 'month', 'last_month', '90d', 'year']).default('7d');

// =============================================================================================================================
// ADM-10 — moderation (D36, D52; 04 §12)
// =============================================================================================================================
/** 04 §12 pre-screen flag codes (+ `prescreen_unavailable` when the job failed, AT-MOD-10; `blocked_word` for agent prompts). */
export const MODERATION_AI_FLAGS = ['protected_brand', 'prohibited_category', 'misleading_price', 'logo_in_image', 'health_claim', 'counterfeit_wording', 'single_image', 'missing_warranty', 'blocked_word', 'prescreen_unavailable'] as const;
export type ModerationAiFlag = (typeof MODERATION_AI_FLAGS)[number];
/** 04 §12: auto-approval threshold; SLA target in business minutes; appeal window and appeal decision target. */
export const MODERATION_AUTO_APPROVE_SCORE = 0.9;
export const MODERATION_SLA_MINUTES = 120;
export const MODERATION_SAMPLE_PCT = 5;
/** Reject reason templates of the review panel (MOD-07) — `reasonTemplateKey` = `moderation.reason.<key>`. */
export const MODERATION_REASON_TEMPLATES = ['counterfeit', 'prohibited', 'inappropriate_image', 'misleading', 'missing_info', 'other'] as const;

/** `GET /admin/moderation/items` (api-contract §4 AdminModerationQuery + `type` for the "Agents IA (prompts)" tab). */
export const AdminModerationQuerySchema = z
  .object({
    ...paging,
    status: csv(z.enum(ModerationItemStatusValues)).optional(),
    priority: z.enum(['urgent']).optional(),
    type: csv(z.enum(ModerationItemTypeValues)).optional(),
    aiFlag: csv(z.string().max(40)).optional(),
    scoreMin: z.coerce.number().min(0, 'validation.range').max(1, 'validation.range').optional(),
    scoreMax: z.coerce.number().min(0, 'validation.range').max(1, 'validation.range').optional(),
    trustLevel: csv(z.enum(TrustLevelValues)).optional(),
    categoryId: id.optional(),
    workspaceId: id.optional(),
    /** minutes since `submittedAt` */
    waitingOver: z.coerce.number().int().min(0).max(100_000).optional(),
    assigneeId: z.union([z.literal('me'), z.literal('none'), id]).optional(),
    q: z.string().trim().min(2, 'validation.length').max(100).optional(),
    /** `urgency` (default: urgent first, then oldest SLA) · `submittedAt` · `-submittedAt` */
    sort: z.enum(['urgency', 'submittedAt', '-submittedAt']).default('urgency'),
  })
  .strict();
export type AdminModerationQuery = z.infer<typeof AdminModerationQuerySchema>;

/** `POST /admin/moderation/items/:id/{approve|reject|request-changes}` — reject: decision + merchantMessage (MODERATION_REASON_REQUIRED). */
export const ModerationDecisionSchema = z
  .object({
    decision: z.enum(ModerationDecisionValues).optional(),
    reasonTemplateKey: z.string().trim().max(60, 'validation.length').optional(),
    merchantMessage: z.string().trim().max(2000, 'validation.length').optional(),
    rejectedFields: z.array(z.string().trim().max(40)).max(20, 'validation.length').optional(),
  })
  .strict();
export type ModerationDecisionInput = z.infer<typeof ModerationDecisionSchema>;
/** `POST /admin/moderation/items/bulk/{approve|reject|assign}` → per-item results (reject: decision + reasonTemplateKey + merchantMessage; assign: assigneeId; else 422). */
export const ModerationBulkSchema = z
  .object({
    ids,
    decision: z.enum(ModerationDecisionValues).optional(),
    reasonTemplateKey: z.string().trim().max(60, 'validation.length').optional(),
    merchantMessage: z.string().trim().max(2000, 'validation.length').optional(),
    assigneeId: id.nullable().optional(),
  })
  .strict();
export type ModerationBulkInput = z.infer<typeof ModerationBulkSchema>;
export const AssignSchema = z.object({ assigneeId: id.nullable() }).strict();
export type AssignInput = z.infer<typeof AssignSchema>;
export const AdminAppealsQuerySchema = z.object({ ...paging, status: z.enum(['pending', 'decided']).optional() }).strict();
/** `POST /admin/moderation/appeals/:id/decide` — reviewer ≠ the moderator who rejected (403 FORBIDDEN otherwise). */
export const AppealDecideSchema = z.object({ decision: z.enum(AppealDecisionValues), note: z.string().trim().min(1, 'validation.required').max(1000, 'validation.length') }).strict();
export type AppealDecideInput = z.infer<typeof AppealDecideSchema>;
export const ModerationRuleSchema = z
  .object({
    key: z.string().trim().min(2, 'validation.length').max(80, 'validation.length').regex(/^[a-z0-9_.-]+$/, 'validation.invalid'),
    kind: z.enum(ModerationRuleKindValues),
    value: z.string().trim().min(1, 'validation.required').max(200, 'validation.length'),
    locale: z.enum(LocaleValues).nullable().optional(),
    categoryId: id.nullable().optional(),
    referencePrice: z.number().int().min(0, 'validation.range').nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type ModerationRuleInput = z.infer<typeof ModerationRuleSchema>;
export const ModerationRulePatchSchema = ModerationRuleSchema.omit({ key: true }).partial().strict();
export const ModerationRulesQuerySchema = z.object({ kind: csv(z.enum(ModerationRuleKindValues)).optional() }).strict();
export const ModerationStatsQuerySchema = z.object({ period }).strict();
/** `POST /admin/workspaces/:id/trust-level` (`admin.moderation.write`): standard→trusted, watch→standard (04 §12 R-L); reason ≥ 10. */
export const TrustLevelChangeSchema = z.object({ trustLevel: z.enum(TrustLevelValues), reason }).strict();
export type TrustLevelChangeInput = z.infer<typeof TrustLevelChangeSchema>;

export type ModerationAiFlagView = { code: string; field?: string; message: string };
/** api-contract §3.13 `ModerationItemDto` (+ `type`, `agent`, `category`, `snapshot`, `actions`). */
export type ModerationItemDto = {
  id: string;
  type: (typeof ModerationItemTypeValues)[number];
  workspace: { id: string; name: string; trustLevel: string; plan: string; priorRejections: number; approvedProducts: number };
  product: {
    id: string;
    name: string;
    price: number;
    marketReference: number | null;
    category: string | null;
    variants: number;
    images: { url: string; flag: string | null }[];
    description: string | null;
  } | null;
  agent: { id: string; name: string; excerpt: string } | null;
  category: { id: string; name: string } | null;
  aiScore: number | null;
  aiFlags: ModerationAiFlagView[];
  priority: 'normal' | 'urgent';
  waitingMinutes: number;
  slaDueAt: string;
  slaBreached: boolean;
  status: (typeof ModerationItemStatusValues)[number];
  assignee: InboxUserRef | null;
  reviewer: InboxUserRef | null;
  decision: string | null;
  reasonTemplateKey: string | null;
  merchantMessage: string | null;
  rejectedFields: string[];
  submittedAt: string;
  decidedAt: string | null;
  source: string;
  sampled: boolean;
  appeal: { id: string; message: string; attachmentUrl: string | null; attachmentMime: string | null; submittedAt: string; deadlineAt: string; decision: string | null; decidedAt: string | null } | null;
  actions: ActionDescriptor[];
};
/** `GET /admin/moderation/items/:id` = the row + the snapshot and the merchant history of the product. */
export type ModerationItemDetailDto = ModerationItemDto & {
  snapshot: Record<string, unknown>;
  approvedSnapshot: Record<string, unknown> | null;
  history: { id: string; status: string; decision: string | null; submittedAt: string; decidedAt: string | null; reviewer: InboxUserRef | null }[];
};
export type ModerationAppealDto = {
  id: string;
  item: { id: string; type: string; productId: string | null; productName: string | null; decision: string | null; merchantMessage: string | null; reviewer: InboxUserRef | null; decidedAt: string | null };
  workspace: { id: string; name: string };
  message: string;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  submittedBy: InboxUserRef;
  submittedAt: string;
  deadlineAt: string;
  overdue: boolean;
  reviewer: InboxUserRef | null;
  decision: (typeof AppealDecisionValues)[number] | null;
  decisionNote: string | null;
  decidedAt: string | null;
  actions: ActionDescriptor[];
};
export type ModerationRuleDto = { id: string; key: string; kind: (typeof ModerationRuleKindValues)[number]; value: string; locale: string | null; categoryId: string | null; referencePrice: number | null; isActive: boolean; createdBy: InboxUserRef; createdAt: string; updatedAt: string };
/** ADM-10 KPI tiles (MOD-06) + tab counts. */
export type ModerationStatsDto = {
  pending: number;
  overSla: number;
  urgent: number;
  appealsPending: number;
  autoApproved7d: number;
  rejected7d: number;
  rejectedByReason: { decision: string; count: number }[];
  rejectionRatePct: number;
  medianDelayMinutes: number | null;
  agentPrompts: number;
  /** workspaces with ≥ 5 counterfeit rejections in 90 d (ADM-01 "Suspension proposée") */
  suspensionProposed: { id: string; name: string; counterfeit90d: number }[];
};
export type BulkItemResult = { id: string; ok: boolean; error?: { code: string; message: string } };

// =============================================================================================================================
// ADM-11 — abuse reports, platform blacklist, blocked words (D37; 04 §13)
// =============================================================================================================================
export const AdminReportsQuerySchema = z
  .object({
    ...paging,
    type: csv(z.enum(ReportTypeValues)).optional(),
    severity: csv(z.enum(SeverityValues)).optional(),
    status: csv(z.enum(ReportStatusValues)).optional(),
    reporterKind: csv(z.enum(ReporterKindValues)).optional(),
    workspaceId: id.optional(),
    assigneeId: z.union([z.literal('me'), z.literal('none'), id]).optional(),
    from: day.optional(),
    to: day.optional(),
    q: z.string().trim().min(2, 'validation.length').max(100).optional(),
  })
  .strict();
export type AdminReportsQuery = z.infer<typeof AdminReportsQuerySchema>;
/** `POST /admin/reports/:id/decide` — `note` is the audited reason (≥ 10 chars, ADMIN_REASON_REQUIRED). */
export const ReportDecideSchema = z.object({ decision: z.enum(ReportDecisionValues), note: reason, notifyReporter: z.boolean().default(true) }).strict();
export type ReportDecideInput = z.infer<typeof ReportDecideSchema>;
export const BlacklistQuerySchema = z.object({ ...paging, q: z.string().trim().min(2, 'validation.length').max(40).optional(), active: flag.optional() }).strict();
export const BlacklistCreateSchema = z.object({ phone: z.string().trim().min(6, 'validation.phone').max(30, 'validation.phone'), reason, reportId: id.optional() }).strict();
export type BlacklistCreateInput = z.infer<typeof BlacklistCreateSchema>;
export const BlacklistRevokeSchema = z.object({ reason }).strict();
export const PLATFORM_BLOCKED_WORDS_MAX = 1000;
/** `GET|PUT /admin/blocked-words` — the platform list (`BlockedWord.workspaceId = null`). */
export const AdminBlockedWordsSchema = z
  .object({ words: z.array(z.object({ word: z.string().trim().min(1, 'validation.required').max(60, 'validation.length'), locale: z.enum(LocaleValues).nullable().optional() }).strict()).max(PLATFORM_BLOCKED_WORDS_MAX, 'validation.length'), reason: reason.optional() })
  .strict();
export type AdminBlockedWordsInput = z.infer<typeof AdminBlockedWordsSchema>;
export const SafetyExportQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'validation.date') }).strict();

export type ReportAdminDto = {
  id: string;
  type: (typeof ReportTypeValues)[number];
  reporterKind: (typeof ReporterKindValues)[number];
  reporter: InboxUserRef | null;
  reporterEmail: string | null;
  workspace: { id: string; name: string } | null;
  target: { kind: string; id: string; label: string; meta?: Record<string, string> };
  reason: (typeof ReportReasonValues)[number];
  details: string | null;
  /** masked extract (10 messages, customer phone `05•• •• •• 56`) */
  excerpt: { author: string; text: string; at: string; reported?: boolean }[];
  severity: (typeof SeverityValues)[number];
  status: (typeof ReportStatusValues)[number];
  assignee: InboxUserRef | null;
  decision: (typeof ReportDecisionValues)[number] | null;
  decisionNote: string | null;
  blockRequested: boolean;
  slaDueAt: string;
  slaBreached: boolean;
  createdAt: string;
  resolvedAt: string | null;
  signals: string[];
  actions: ActionDescriptor[];
};
export type ReportStatsDto = { open: number; over24h: number; handled30d: number; merchantBlocks7d: number; merchantsReported30d: number; blockedWords: number; autoFiltered7d: number; tabs: { todo: number; customers: number; merchants: number; aiContent: number; done: number } };
/**
 * `GET /admin/reports/blocks` — the merchant blocks behind the « clients bloqués par les marchands · 7 j » tile (UX-014):
 * manual + auto-rule blocks of the last 7 days still in force, newest first (100 max). Phone masked (admin viewer).
 */
export type MerchantBlockRowDto = { id: string; workspace: { id: string; name: string }; client: { id: string; name: string } | null; phone: string | null; reason: string | null; source: 'manual' | 'auto_rule'; blockedBy: InboxUserRef | null; blockedAt: string };
export type BlacklistRowDto = { id: string; phone: string; reason: string; reportId: string | null; workspaceCount: number; createdBy: InboxUserRef; createdAt: string; revokedBy: InboxUserRef | null; revokedAt: string | null };
export type PlatformBlockedWordDto = { id: string; word: string; locale: string | null; createdAt: string };
export type SafetyAutoRuleDto = { key: 'phone_blocked_by_workspaces' | 'merchant_reported_by_customers' | 'ai_messages_reported'; threshold: number; windowDays: number; outcome: string; hits30d: number; lastRunAt: string | null };

// =============================================================================================================================
// ADM-12 — support tickets (D38; 03 §25 HELP-05)
// =============================================================================================================================
export const AdminTicketsQuerySchema = z
  .object({
    ...paging,
    status: csv(z.enum(TicketStatusValues)).optional(),
    category: csv(z.enum(TicketCategoryValues)).optional(),
    priority: csv(z.enum(TicketPriorityValues)).optional(),
    channel: csv(z.enum(TicketChannelValues)).optional(),
    planSlug: csv(z.string().max(40)).optional(),
    assigneeId: z.union([z.literal('me'), z.literal('none'), id]).optional(),
    slaBreached: flag.optional(),
    workspaceId: id.optional(),
    q: z.string().trim().min(2, 'validation.length').max(100).optional(),
  })
  .strict();
export type AdminTicketsQuery = z.infer<typeof AdminTicketsQuerySchema>;
export const AdminCreateTicketSchema = z
  .object({
    workspaceId: id,
    userId: id,
    subject: z.string().trim().min(3, 'validation.length').max(200, 'validation.length'),
    category: z.enum(TicketCategoryValues),
    priority: z.enum(TicketPriorityValues).default('normal'),
    channel: z.enum(['email', 'chat']),
    message: z.string().trim().min(1, 'validation.required').max(5000, 'validation.length').optional(),
  })
  .strict();
export type AdminCreateTicketInput = z.infer<typeof AdminCreateTicketSchema>;
export const AdminTicketMessageSchema = z
  .object({
    body: z.string().trim().min(1, 'validation.required').max(5000, 'validation.length'),
    isInternal: z.boolean().default(false),
    cannedReplyKey: z.string().trim().max(60).optional(),
    attachments: z.array(id).max(5, 'validation.length').default([]),
    /** "Envoyer & attendre le client" ⇒ status `pending_customer` after the message */
    waitCustomer: z.boolean().optional(),
  })
  .strict();
export type AdminTicketMessageInput = z.infer<typeof AdminTicketMessageSchema>;
export const TicketNoteSchema = z.object({ note: note.optional() }).strict();
export const TicketEscalateSchema = z.object({ note: z.string().trim().min(1, 'validation.required').max(1000, 'validation.length') }).strict();
export const TicketLinkIncidentSchema = z.object({ incidentId: id.nullable() }).strict();
export const CannedReplySchema = z
  .object({
    key: z.string().trim().regex(/^\/[a-z0-9-]{2,40}$/, 'validation.invalid'),
    title: z.string().trim().min(1, 'validation.required').max(120, 'validation.length'),
    body: OpsLocalizedTextSchema,
    category: z.enum(TicketCategoryValues).nullable().optional(),
  })
  .strict();
export type CannedReplyInput = z.infer<typeof CannedReplySchema>;
export const CannedReplyPatchSchema = CannedReplySchema.omit({ key: true }).partial().strict();
export const SupportStatsQuerySchema = z.object({ period }).strict();

export type TicketMessageView = { id: string; authorKind: 'user' | 'support' | 'system'; author: InboxUserRef | null; body: string; attachments: { name: string; url: string; size: number }[]; at: string; isInternal?: boolean; cannedReplyKey?: string | null };
export type AdminTicketDto = {
  id: string;
  number: string;
  subject: string;
  category: (typeof TicketCategoryValues)[number];
  priority: (typeof TicketPriorityValues)[number];
  channel: (typeof TicketChannelValues)[number];
  status: (typeof TicketStatusValues)[number];
  createdAt: string;
  lastMessageAt: string;
  awaitingMe: boolean;
  slaDueAt: string;
  slaHours: number;
  slaRemainingMin: number;
  slaBreached: boolean;
  satisfaction: number | null;
  satisfactionNote: string | null;
  messages: TicketMessageView[];
  context: Record<string, string>;
  workspace: { id: string; name: string; plan: string; status: string } | null;
  user: InboxUserRef & { email: string; role: string | null; platform: string };
  assignee: InboxUserRef | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  escalationNote: string | null;
  incident: { id: string; title: string } | null;
  previousTickets: { count: number; avgSatisfaction: number | null };
  internalNotes: boolean;
  actions: ActionDescriptor[];
};
export type SupportStatsDto = { open: number; overSla: number; medianFirstResponseMin: number | null; solvedFirstExchangePct: number; satisfactionAvg: number | null; topCategories: { category: string; count: number }[]; tabs: { open: number; mine: number; pendingCustomer: number; resolved: number; all: number } };
export type CannedReplyDto = { id: string; key: string; title: string; body: OpsLocalizedText; category: string | null; createdBy: InboxUserRef; updatedAt: string };

// =============================================================================================================================
// ADM-13 — platform settings (D39, D58; 04 §15)
// =============================================================================================================================
/** Keys editable with `PUT /admin/settings/:key { value, reason }` (others have their dedicated endpoint). */
export const PLATFORM_LIMITS_DEFAULTS = { apiRatePerMin: 600, webhookRetries: 6, trialDays: 14, trialCredits: 300, deletionGraceDays: 30, impersonationMinutes: 30, maxDevices: 20 } as const;
export const PlatformLimitsSchema = z
  .object({
    apiRatePerMin: z.number().int().min(10, 'validation.range').max(100_000, 'validation.range'),
    webhookRetries: z.number().int().min(1, 'validation.range').max(20, 'validation.range'),
    trialDays: z.number().int().min(0, 'validation.range').max(365, 'validation.range'),
    trialCredits: z.number().int().min(0, 'validation.range').max(1_000_000, 'validation.range'),
    deletionGraceDays: z.number().int().min(1, 'validation.range').max(365, 'validation.range'),
    impersonationMinutes: z.number().int().min(5, 'validation.range').max(240, 'validation.range'),
    maxDevices: z.number().int().min(1, 'validation.range').max(100, 'validation.range'),
  })
  .strict();
export type PlatformLimits = z.infer<typeof PlatformLimitsSchema>;
/** PFS-04 "public URL for account deletion and DPO e-mail configured here". */
export const LegalContactsSchema = z.object({ accountDeletionUrl: z.string().trim().url('validation.url').max(2048).startsWith('https://', 'validation.url'), dpoEmail: z.string().trim().email('validation.email').max(254) }).strict();
/** Sensitive categories of 04 §12 (keywords matched against the category name, case/diacritic-insensitive). */
export const SensitiveCategoriesSchema = z.object({ keywords: z.array(z.string().trim().min(2).max(60)).max(200) }).strict();
/** PV 22/10 PV2 — `manualReviewAll`: no auto-approval, every product waits for an admin decision before it is sold. */
export const ModerationPolicySchema = z.object({ manualReviewAll: z.boolean() }).strict();
export type ModerationPolicy = z.infer<typeof ModerationPolicySchema>;
export const SETTING_KEYS = ['limits', 'legal_contacts', 'sensitive_categories', 'moderation_policy'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export const SETTING_SCHEMAS: Record<SettingKey, z.ZodTypeAny> = {
  limits: PlatformLimitsSchema,
  legal_contacts: LegalContactsSchema,
  sensitive_categories: SensitiveCategoriesSchema,
  moderation_policy: ModerationPolicySchema,
};
export const SettingUpdateSchema = z.object({ value: z.unknown(), reason: reason.optional() }).strict();
export type SettingUpdateInput = z.infer<typeof SettingUpdateSchema>;

const semver = z.string().trim().regex(/^\d+(\.\d+){1,3}$/, 'validation.invalid');
/** `PUT /admin/app-versions/:platform` — `totpCode` required when `minVersion` rises (TWO_FA_CONFIRMATION_REQUIRED). */
export const AppVersionUpdateSchema = z
  .object({
    minVersion: semver,
    recommendedVersion: semver,
    latestVersion: semver,
    latestBuild: z.number().int().min(0).nullable().optional(),
    storeStatus: z.enum(StoreStatusValues).optional(),
    rolloutPct: z.number().int().min(0, 'validation.range').max(100, 'validation.range').nullable().optional(),
    storeUrl: z.string().trim().url('validation.url').max(2048).startsWith('https://', 'validation.url'),
    updateMessage: OpsLocalizedTextSchema,
    totpCode: z.string().trim().regex(/^\d{6}$/, 'validation.code').optional(),
    reason: reason.optional(),
  })
  .strict();
export type AppVersionUpdateInput = z.infer<typeof AppVersionUpdateSchema>;
export const FLAG_KEY = z.string().trim().min(2, 'validation.length').max(60, 'validation.length').regex(/^[a-z0-9_]+$/, 'validation.invalid');
const flagTargeting = z.object({ planSlugs: z.array(z.string().max(40)).max(20).optional(), workspaceIds: z.array(id).max(500).optional(), abTest: z.boolean().optional() }).strict();
export const FeatureFlagCreateSchema = z
  .object({
    key: FLAG_KEY,
    description: z.string().trim().max(500, 'validation.length').nullable().optional(),
    webPct: z.number().int().min(0, 'validation.range').max(100, 'validation.range').default(0),
    mobilePct: z.number().int().min(0, 'validation.range').max(100, 'validation.range').default(0),
    targeting: flagTargeting.default({}),
    isActive: z.boolean().default(true),
    reason: reason.optional(),
  })
  .strict();
export type FeatureFlagCreateInput = z.infer<typeof FeatureFlagCreateSchema>;
export const FeatureFlagPatchSchema = FeatureFlagCreateSchema.omit({ key: true }).partial().strict();
export const FeatureFlagEvaluateQuerySchema = z.object({ workspaceId: id, platform: z.enum(['web', 'mobile']).default('web') }).strict();
/** `GET /feature-flags?platform=mobile` (merchant, 06 §11). */
export const FeatureFlagsQuerySchema = z.object({ platform: z.enum(['web', 'mobile']).default('web') }).strict();
/** `POST /admin/legal-documents/:key/publish` — isMajor ⇒ re-acceptance + `legal.reacceptance_required`. */
export const LegalPublishSchema = z.object({ version: z.number().int().min(1, 'validation.range'), isMajor: z.boolean(), cmsEntryId: id, reason: reason.optional() }).strict();
export type LegalPublishInput = z.infer<typeof LegalPublishSchema>;
export const MetaPermissionPatchSchema = z
  .object({ status: z.enum(MetaPermissionStatusValues), submittedAt: instant.nullable().optional(), decidedAt: instant.nullable().optional(), notes: z.string().trim().max(1000).nullable().optional(), feature: z.string().trim().max(120).optional() })
  .strict();
export type MetaPermissionPatchInput = z.infer<typeof MetaPermissionPatchSchema>;
export const MetaAppSchema = z.object({ appId: z.string().trim().regex(/^\d{5,30}$/, 'validation.invalid'), appSecret: z.string().trim().min(8, 'validation.length').max(200).optional() }).strict();
export const PROVIDER_KEYS = ['chargily', 'email', 'sms', 'push', 'courier_zr', 'courier_ecotrack', 'courier_yalidine', 'google_oauth'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
export const ProviderUpdateSchema = z.object({ config: z.record(z.union([z.string().max(2048), z.number(), z.boolean(), z.null()])).default({}), secret: z.string().min(1).max(4096).optional(), reason: reason.optional() }).strict();
export type ProviderUpdateInput = z.infer<typeof ProviderUpdateSchema>;
export const MaintenanceSchema = z
  .object({ enabled: z.boolean(), scheduledFrom: instant.nullable().optional(), scheduledTo: instant.nullable().optional(), scope: z.enum(['all', 'web', 'mobile']).default('all'), text: OpsLocalizedTextSchema.nullable().optional(), reason: reason.optional() })
  .strict();
export type MaintenanceInput = z.infer<typeof MaintenanceSchema>;
export const IncidentBannerSchema = z.object({ visible: z.boolean(), text: OpsLocalizedTextSchema.nullable().optional() }).strict();
export type IncidentBannerInput = z.infer<typeof IncidentBannerSchema>;

export type PlatformSettingDto = { key: string; value: unknown; version: number; updatedBy: InboxUserRef | null; updatedAt: string };
export type PlatformSettingVersionDto = { version: number; value: unknown; changedBy: InboxUserRef | null; reason: string | null; at: string };
export type MaintenanceDto = { enabled: boolean; active: boolean; scheduledFrom: string | null; scheduledTo: string | null; scope: 'all' | 'web' | 'mobile'; text: OpsLocalizedText | null };
export type IncidentBannerDto = { visible: boolean; text: OpsLocalizedText | null };
/** `GET /admin/settings` — every section of ADM-13 in one call. */
export type AdminSettingsDto = {
  settings: PlatformSettingDto[];
  maintenance: MaintenanceDto;
  incidentBanner: IncidentBannerDto;
  appVersions: AppVersionDto[];
  flags: FeatureFlagDto[];
  metaPermissions: MetaPermissionDto[];
  providers: PlatformProviderDto[];
  legal: LegalDocumentDto[];
};
export type AppVersionDto = {
  platform: (typeof AppPlatformValues)[number];
  latestVersion: string;
  latestBuild: number | null;
  minVersion: string;
  recommendedVersion: string;
  storeStatus: (typeof StoreStatusValues)[number];
  rolloutPct: number | null;
  storeUrl: string;
  updateMessage: OpsLocalizedText;
  forceUpdateAt: string | null;
  devicesBelowMin: { count: number; pct: number };
  updatedAt: string;
};
export type FeatureFlagDto = { key: string; description: string | null; webPct: number; mobilePct: number; targeting: { planSlugs?: string[]; workspaceIds?: string[]; abTest?: boolean }; isActive: boolean; overrides: number; updatedBy: InboxUserRef | null; updatedAt: string };
export type FeatureFlagEvaluationDto = { key: string; workspaceId: string; platform: 'web' | 'mobile'; enabled: boolean; reason: 'inactive' | 'override' | 'workspace_list' | 'plan_mismatch' | 'bucket' | 'unknown_flag'; bucket: number; pct: number };
export type LegalDocumentDto = { id: string; key: (typeof LegalDocKeyValues)[number]; version: number; isMajor: boolean; requiresReacceptance: boolean; cmsEntryId: string; publishedAt: string; publishedBy: InboxUserRef | null; acceptance: { accepted: number; required: number; pct: number } };
export type LegalAcceptanceStatsDto = { key: string; version: number; accepted: number; required: number; pct: number; byClient: { client: string; count: number }[] };
export type MetaPermissionDto = { id: string; scope: string; status: (typeof MetaPermissionStatusValues)[number]; feature: string; submittedAt: string | null; decidedAt: string | null; daysInReview: number | null; notes: string | null; updatedAt: string };
export type MetaAppDto = { appId: string | null; secretSet: boolean; webhookUrl: string; verifyTokenSet: boolean; ackRate24hPct: number | null; mode: 'live' | 'development'; pendingInstagramChannels: number };
export type PlatformProviderDto = { key: ProviderKey; kind: string; config: Record<string, unknown>; secretSet: boolean; status: (typeof ProviderStatusValues)[number]; lastCheckedAt: string | null; lastError: string | null; quota: Record<string, unknown> | null; expiresAt: string | null; warnings: string[]; updatedAt: string };
/** `POST /admin/providers/:key/test` — testing / ok (latency) / rejected / unreachable (AT-PFS-07). */
export type ProviderTestResultDto = { key: ProviderKey; state: 'ok' | 'rejected' | 'unreachable'; latencyMs: number; status: (typeof ProviderStatusValues)[number]; error: string | null; checkedAt: string };

// =============================================================================================================================
// ADM-14 — jobs & health, incidents (D59; 03-events §3.2)
// =============================================================================================================================
export const QueueFailedQuerySchema = z.object({ ...paging }).strict();
export const QueueRunNowSchema = z.object({ cron: z.string().trim().max(80).optional() }).strict();
export const FailedJobQuerySchema = z.object({ queue: z.string().max(40).optional() }).strict();
export const IncidentCreateSchema = z
  .object({
    title: OpsLocalizedTextSchema,
    severity: z.enum(IncidentSeverityValues).default('minor'),
    status: z.enum(IncidentStatusValues).default('open'),
    components: z.array(z.string().trim().max(40)).max(20).default([]),
    body: OpsLocalizedTextSchema.optional(),
    affectedWorkspaces: z.number().int().min(0).nullable().optional(),
    /** also show the incident banner (PFS-03) with the title */
    banner: z.boolean().default(false),
  })
  .strict();
export type IncidentCreateInput = z.infer<typeof IncidentCreateSchema>;
export const IncidentPatchSchema = z
  .object({ title: OpsLocalizedTextSchema.optional(), severity: z.enum(IncidentSeverityValues).optional(), components: z.array(z.string().trim().max(40)).max(20).optional(), affectedWorkspaces: z.number().int().min(0).nullable().optional() })
  .strict();
export const IncidentUpdateSchema = z.object({ status: z.enum(IncidentStatusValues), body: OpsLocalizedTextSchema }).strict();
export type IncidentUpdateInput = z.infer<typeof IncidentUpdateSchema>;
export const IncidentResolveSchema = z.object({ postMortem: z.string().trim().max(10_000, 'validation.length').optional(), body: OpsLocalizedTextSchema.optional() }).strict();
export const IncidentsQuerySchema = z.object({ ...paging, status: csv(z.enum(IncidentStatusValues)).optional() }).strict();
/** Components of the public status page (OPS-06) — `Incident.components[]` takes these keys or queue names. */
export const STATUS_COMPONENTS = ['messenger_instagram', 'ai_agent', 'web_app', 'mobile_api', 'google_sheets', 'couriers', 'payment', 'notifications'] as const;
export type StatusComponentKey = (typeof STATUS_COMPONENTS)[number];

export type QueueHealthDto = { name: string; waiting: number; active: number; failed: number; delayed: number; completedLastHour: number; p95Ms: number; state: 'ok' | 'warning' | 'incident' | 'paused'; note: string | null; pausable: boolean };
/** api-contract §3.13 `HealthDto` + 03-events §3.2 fields + `schedulers` ("Lancer maintenant"). */
export type HealthDto = {
  queues: QueueHealthDto[];
  metaWebhooks: { received24h: number; byType: { messages: number; postbacks: number; reads: number; other: number }; invalidSignatures: number; ackOver5s: number; p95Ms: number; ackP95Ms: number; ackUnder1sPct: number | null; medianToReplyMs: number | null; dedupedCount: number };
  ai: { errorRate24hPct: number; failoverActive: boolean; provider: string; thresholdPct: number };
  duplicates7d: number;
  incidents: { id: string; title: string; status: string; severity: string; startedAt: string }[];
  workers: { host: string; lastHeartbeatAt: string }[];
  schedulers: { name: string; pattern: string; nextRunAt: string | null }[];
  updatedAt: string;
};
export type FailedJobDto = { id: string; queue: string; name: string; data: unknown; failedReason: string | null; stacktrace: string[]; attemptsMade: number; timestamp: string; finishedOn: string | null; replays: number };
export type IncidentDto = {
  id: string;
  title: OpsLocalizedText;
  status: (typeof IncidentStatusValues)[number];
  severity: (typeof IncidentSeverityValues)[number];
  components: string[];
  startedAt: string;
  identifiedAt: string | null;
  resolvedAt: string | null;
  durationMinutes: number | null;
  affectedWorkspaces: number | null;
  bannerVisible: boolean;
  postMortem: string | null;
  createdBy: InboxUserRef;
  updates: { id: string; status: string; body: OpsLocalizedText; author: InboxUserRef; at: string }[];
  tickets: number;
};
