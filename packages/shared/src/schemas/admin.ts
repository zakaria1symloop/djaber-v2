// Platform admin core (M10, api-a): ADM-01 overview, ADM-02 workspaces, ADM-03 users, ADM-04 plans, ADM-05 subscriptions &
// invoices, ADM-06 AI providers / routing / pricing, ADM-07 agent presets, ADM-08 CMS, ADM-09 audit, ADM-15 packs & promo
// codes, ADM-16 platform team & deletion requests, ADM-17 viewers + read-only impersonation (Figma frame numbers).
// 03 §19, §28, §29, 06 "Platform admin" + §8.11, api-contract §3.13, D21-bis, D41, D57, D63. Field names = contract names.
// Every admin write that touches a merchant carries `reason` (≥ 10 chars ⇒ else 422 ADMIN_REASON_REQUIRED, `fields.reason`).
import { z } from 'zod';
import { WILAYA_COUNT } from '../geo';
import {
  AiCapabilityValues,
  AiProviderKeyValues,
  CmsLocaleStatusValues,
  CmsStatusValues,
  CmsTypeValues,
  DeletionStatusValues,
  InvoiceKindValues,
  InvoiceStatusValues,
  LocaleValues,
  PlatformRoleValues,
  PresetBadgeValues,
  PromoKindValues,
  PromoTargetValues,
  SubscriptionStatusValues,
  SuspendReasonValues,
  TrustLevelValues,
  UserStatusValues,
  WorkspaceStatusValues,
} from '../enums';
import type { ActionDescriptor } from './common';
import type { CreditPackDto, InvoiceDto, PlanPublicDto } from './billing';

// --- constants ---------------------------------------------------------------------------------------------------------------
/** D21-bis: a read-only impersonation session lasts 30 min. */
export const IMPERSONATION_MINUTES = 30;
/** PRL-02: platform members are invited with an `@djaber.ai` e-mail only (`ADMIN_EMAIL_DOMAIN_INVALID`). */
export const ADMIN_EMAIL_DOMAIN = 'djaber.ai';
/** ADM-03 "Renvoyer l'e-mail de vérification": cooldown 10 min. */
export const ADMIN_RESEND_VERIFICATION_COOLDOWN_MIN = 10;
/** Header of the merchant requests made under an impersonation session (with the session token as Bearer). */
export const IMPERSONATION_HEADER = 'X-Impersonation-Session';
export const ADMIN_PERIODS = ['7d', '30d', '90d'] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];
/** Preset prompt variables (ADM-07 "variables : {{shop_name}} {{catalog}} {{delivery_grid}} {{policies}} {{language}}"). */
export const PRESET_PROMPT_VARIABLES = ['shop_name', 'catalog', 'delivery_grid', 'policies', 'language'] as const;
/** Plan feature flags drawn on ADM-04 (`Plan.features`). */
export const PLAN_FEATURES = ['voice_notes', 'image_recognition', 'google_sheets', 'couriers', 'api_keys', 'webhooks', 'advanced_stock', 'scheduled_reports', 'instagram', 'priority_support'] as const;

// --- helpers -----------------------------------------------------------------------------------------------------------------
const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const bool = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const instant = z.string().datetime({ offset: true, message: 'validation.date' });
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().regex(/^-?[a-zA-Z]+$/, 'validation.invalid').optional(),
};
const q = z.string().trim().max(200, 'validation.length').optional();
const str = (max: number) => z.string({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).trim().max(max, 'validation.length');
const required = (max: number) => str(max).min(1, 'validation.required');
/** reason checked by the service (`ADMIN_REASON_REQUIRED` when < 10 chars): the schema only bounds it. */
const reason = str(500);
const int = (min: number, max: number) => z.number({ required_error: 'validation.required', invalid_type_error: 'validation.number' }).int('validation.number').min(min, 'validation.range').max(max, 'validation.range');
const localized = z.object({ fr: str(2000), ar: str(2000).optional(), en: str(2000).optional() }).strict();
export type LocalizedTextInput = z.infer<typeof localized>;
export type LocalizedText = { fr: string; ar: string; en: string };
export type AdminUserRef = { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null };

// =============================================================================================================================
// ADM-01 overview
// =============================================================================================================================
/** `GET /admin/analytics?period` (`admin.overview.read`). */
export const AdminPeriodQuerySchema = z.object({ period: z.enum(ADMIN_PERIODS).default('30d') }).strict();
export type AdminPeriodQuery = z.infer<typeof AdminPeriodQuerySchema>;
export type AdminOverviewDto = {
  period: AdminPeriod;
  from: string;
  to: string;
  kpis: {
    workspaces: { active: number; newInPeriod: number; suspended: number };
    mrr: { amount: number; deltaPct: number | null; byPlan: { slug: string; name: string; count: number }[]; free: number };
    credits: { consumed: number; aiCostUsd: number; marginPct: number | null };
    conversations: { perDayAvg: number; peak: { day: string; count: number } | null };
    webhooks: { availabilityPct: number | null; incidentMinutes: number; queueDelays: number };
  };
  /** one row per day of the period (Africa/Algiers) */
  series: { day: string; signups: number; activations: number; churned: number }[];
  topWorkspaces: { id: string; name: string; planSlug: string; planName: string; credits: number }[];
  aiCostByModel: { provider: string; model: string; capability: string; costUsd: number; units: number; unit: 'credits' | 'notes' | 'photos' }[];
  trialsExpiring: { id: string; name: string; trialEndsAt: string; orders: number; pagesConnected: number; conversations: number }[];
};
/** `GET /admin/alerts` — the ADM-01 "Alertes plateforme" list. `code` = i18n key suffix `admin.alert.<code>` (params interpolated). */
export type AdminAlertCode = 'ai_error_rate' | 'ig_review_backlog' | 'credits_exhausted' | 'queue_delay' | 'courier_key_expired' | 'moderation_sla' | 'ticket_sla' | 'dunning_overdue';
export type AdminAlertDto = { code: AdminAlertCode; severity: 'critical' | 'warning'; params: Record<string, string | number>; link: string; since: string | null };

// =============================================================================================================================
// ADM-02 workspaces
// =============================================================================================================================
/** `GET /admin/workspaces` (06 §10 "Admin › Espaces"). */
export const AdminWorkspacesQuerySchema = z
  .object({
    ...paging,
    planSlug: csv(z.string().max(60)).optional(),
    status: csv(z.enum(WorkspaceStatusValues)).optional(),
    subscriptionStatus: csv(z.enum(SubscriptionStatusValues)).optional(),
    credits: z.enum(['lt20', 'exhausted']).optional(),
    createdFrom: day.optional(),
    createdTo: day.optional(),
    wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT).optional(),
    withPages: bool.optional(),
    withAgents: bool.optional(),
    inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
    minPages: z.coerce.number().int().min(0).optional(),
    maxPages: z.coerce.number().int().min(0).optional(),
    minProducts: z.coerce.number().int().min(0).optional(),
    maxProducts: z.coerce.number().int().min(0).optional(),
    minRevenue: z.coerce.number().int().min(0).optional(),
    maxRevenue: z.coerce.number().int().min(0).optional(),
    trustLevel: csv(z.enum(TrustLevelValues)).optional(),
    q,
  })
  .strict();
export type AdminWorkspacesQuery = z.infer<typeof AdminWorkspacesQuerySchema>;
export type AdminWorkspaceRowDto = {
  id: string;
  name: string;
  owner: AdminUserRef & { emailVerified: boolean; totpEnabled: boolean };
  plan: { slug: string; name: string };
  subscriptionStatus: 'trial' | 'active' | 'dunning' | 'expired' | 'cancelled';
  status: 'active' | 'suspended' | 'deletion_scheduled';
  trustLevel: 'new' | 'standard' | 'trusted' | 'watch';
  credits: { used: number; limit: number; exhausted: boolean };
  pages: { count: number; platforms: string[] };
  orders30d: number;
  conversations30d: number;
  createdAt: string;
  lastActivityAt: string | null;
  /** keys: open, impersonate, change_plan, add_credits, extend_trial, suspend, reactivate, schedule_deletion, cancel_deletion */
  actions: ActionDescriptor[];
};
/** `GET /admin/workspaces/:id` — the detail sheet "Résumé". */
export type AdminWorkspaceDetailDto = AdminWorkspaceRowDto & {
  slug: string;
  wilaya: string | null;
  stockMode: 'simple' | 'advanced';
  suspendedAt: string | null;
  suspendReason: string | null;
  suspendNote: string | null;
  deletionScheduledAt: string | null;
  assistedOnboarding: boolean;
  subscription: { id: string; planName: string; cycle: 'monthly' | 'yearly' | 'none'; appliedPrice: number; currentPeriodEnd: string; trialEndsAt: string | null; dunningStage: string | null; method: string | null } | null;
  creditsDetail: { plan: number; packs: number; packsBought: number; lastGrant: { credits: number; reason: string | null; at: string } | null };
  channels: { id: string; name: string; platform: string; status: string }[];
  agents: { id: string; name: string; status: string }[];
  integrations: { sheets: boolean; couriers: { provider: string; ok: boolean }[]; apiKeys: number; webhooks: number; webhooksDisabled: number };
  counts: { products: number; purchases: number; sales: number; members: number };
  kpis30d: { orders: number; conversations: number; creditsUsedPct: number };
  lastActivity: { web: string | null; mobile: string | null };
};
export type AdminWorkspaceMemberDto = { userId: string; firstName: string; lastName: string; email: string; role: 'owner' | 'admin' | 'operator'; readOnly: boolean; totpEnabled: boolean; lastLoginAt: string | null; joinedAt: string };
export type AdminWorkspaceChannelDto = { id: string; name: string; platform: string; status: string; externalId: string; pausedReason: string | null; connectedAt: string | null; lastMessageAt: string | null };
export type AdminWorkspaceAgentDto = { id: string; name: string; status: string; presetKey: string | null; presetVersion: number | null; updatedAt: string };
export type AdminCreditRowDto = { id: string; at: string; action: string; kind: string; bucket: string; credits: number; balanceAfter: number; reason: string | null; grantedBy: string | null };

/** `POST /admin/workspaces` [DLG "Créer un espace"] (`admin.workspaces.write`). Owner created (or reused when the e-mail exists) and invited. */
export const AdminCreateWorkspaceSchema = z
  .object({
    name: required(120),
    ownerEmail: z.string({ required_error: 'validation.required' }).trim().toLowerCase().email('validation.email'),
    ownerFirstName: str(80).optional(),
    ownerLastName: str(80).optional(),
    planSlug: str(60).optional(),
    trialMonths: int(0, 12).optional(),
    initialCredits: int(0, 1_000_000).optional(),
    sendInvite: z.boolean().default(true),
    assistedOnboarding: z.boolean().default(false),
    reason,
  })
  .strict();
export type AdminCreateWorkspaceInput = z.infer<typeof AdminCreateWorkspaceSchema>;
/** `PATCH /admin/workspaces/:id`. */
export const AdminPatchWorkspaceSchema = z.object({ name: required(120).optional(), assistedOnboarding: z.boolean().optional(), reason }).strict();
export type AdminPatchWorkspaceInput = z.infer<typeof AdminPatchWorkspaceSchema>;
/** `POST /admin/workspaces/:id/suspend` — `note` is the audited reason (≥ 10 chars). */
export const AdminSuspendSchema = z.object({ reason: z.enum(SuspendReasonValues, { errorMap: () => ({ message: 'validation.invalid' }) }), note: str(500), notifyOwner: z.boolean().default(true) }).strict();
export type AdminSuspendInput = z.infer<typeof AdminSuspendSchema>;
/** Body of every reason-only admin write (reactivate, cancel deletion, unmask, user actions, deletion requests…). */
export const AdminReasonSchema = z.object({ reason, ticketId: id.optional() }).strict();
export type AdminReasonInput = z.infer<typeof AdminReasonSchema>;
/** `POST /admin/workspaces/:id/plan` — `now` = immediate switch (prorata not charged: admin gesture), `next_period` = booked for the renewal. */
export const AdminChangePlanSchema = z.object({ planId: id, cycle: z.enum(['monthly', 'yearly']), when: z.enum(['now', 'next_period']), reason }).strict();
export type AdminChangePlanInput = z.infer<typeof AdminChangePlanSchema>;
/** `POST /admin/workspaces/:id/extend` — trial (or current period) extension: `days` 3 | 7 | 30, or `until` (date). */
export const AdminExtendSchema = z
  .object({ days: z.union([z.literal(3), z.literal(7), z.literal(30)]).optional(), until: day.optional(), reason })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.days === !v.until) ctx.addIssue({ code: 'custom', path: ['days'], message: 'validation.required' });
  });
export type AdminExtendInput = z.infer<typeof AdminExtendSchema>;
/** `POST /admin/workspaces/:id/schedule-deletion` — typed workspace name + reason (DEL-05). */
export const AdminScheduleDeletionSchema = z.object({ confirmName: required(120), reason }).strict();
export type AdminScheduleDeletionInput = z.infer<typeof AdminScheduleDeletionSchema>;
/** `POST /admin/channels/:id/release` (AT-CHN-08). */
export const AdminReleaseChannelSchema = z.object({ reason, proofTicketId: id.optional() }).strict();
export type AdminReleaseChannelInput = z.infer<typeof AdminReleaseChannelSchema>;
/** `GET /admin/channels?q` — find the workspace holding a page (search by page id / name) before a release. */
export const AdminChannelsQuerySchema = z.object({ ...paging, q, workspaceId: id.optional() }).strict();
export type AdminChannelRowDto = AdminWorkspaceChannelDto & { workspace: { id: string; name: string } };
/** `GET /admin/workspaces/:id/audit|credits` paging. */
export const AdminSubListQuerySchema = z.object({ ...paging }).strict();

// =============================================================================================================================
// ADM-03 users (+ ADM-17 user detail)
// =============================================================================================================================
export const AdminUsersQuerySchema = z
  .object({
    ...paging,
    platformRole: csv(z.enum(PlatformRoleValues)).optional(),
    status: csv(z.enum([...UserStatusValues, 'unverified'] as [string, ...string[]])).optional(),
    emailVerified: bool.optional(),
    totpEnabled: bool.optional(),
    lastLogin: z.enum(['7d', '30d', '90d', 'never', 'over90d']).optional(),
    workspaceId: id.optional(),
    q,
  })
  .strict();
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;
export type AdminUserRowDto = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  platformRole: 'none' | 'read' | 'support' | 'moderator' | 'finance' | 'super_admin';
  status: 'active' | 'blocked' | 'deletion_scheduled';
  workspaces: { id: string; name: string; role: 'owner' | 'admin' | 'operator' }[];
  lastLoginAt: string | null;
  lastSeenPlatform: 'android' | 'ios' | 'web' | null;
  createdAt: string;
  /** keys: open, resend_verification, reset_password, disable_2fa, revoke_sessions, promote, block, unblock, schedule_deletion */
  actions: ActionDescriptor[];
};
export type AdminUserDetailDto = AdminUserRowDto & {
  locale: 'fr' | 'ar' | 'en';
  blockedAt: string | null;
  blockReason: string | null;
  ownedWorkspaceId: string | null;
  sessions: { familyId: string; device: string | null; platform: string | null; ip: string | null; lastUsedAt: string; createdAt: string }[];
  devices: { platform: string; deviceName: string | null; appVersion: string | null; lastSeenAt: string }[];
  activity: { lastAction: { action: string; at: string } | null; tickets: number; reports: number };
  deletion: { id: string; status: string; scheduledAt: string | null; blockedReason: string | null } | null;
};
/** `PATCH /admin/users/:id`. */
export const AdminPatchUserSchema = z
  .object({ firstName: required(80).optional(), lastName: required(80).optional(), phone: str(30).nullable().optional(), locale: z.enum(LocaleValues).optional(), reason })
  .strict();
export type AdminPatchUserInput = z.infer<typeof AdminPatchUserSchema>;
/** `POST /admin/users/:id/platform-role` (`admin.team.write`) — the actor's TOTP code is required (`TWO_FA_CONFIRMATION_REQUIRED`). */
export const AdminPlatformRoleSchema = z.object({ platformRole: z.enum(PlatformRoleValues), totpCode: str(10).optional(), reason: reason.optional() }).strict();
export type AdminPlatformRoleInput = z.infer<typeof AdminPlatformRoleSchema>;

// =============================================================================================================================
// ADM-04 plans
// =============================================================================================================================
const planFields = {
  name: localized,
  description: localized.optional(),
  priceMonthly: int(0, 10_000_000),
  priceYearly: int(0, 100_000_000),
  trialDays: int(0, 365).optional(),
  maxPages: int(-1, 100_000),
  maxAgents: int(-1, 100_000),
  maxProducts: int(-1, 10_000_000),
  maxConversationsPerMonth: int(-1, 100_000_000),
  maxMembers: int(-1, 100_000),
  maxApiKeys: int(-1, 1_000).optional(),
  maxWebhooks: int(-1, 1_000).optional(),
  syncHistoryDays: int(0, 3650).optional(),
  monthlyCredits: int(0, 100_000_000),
  features: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  isVisible: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: int(0, 1000).optional(),
};
/** `POST /admin/plans` [DLG "Créer un plan"] — `PLAN_SLUG_TAKEN`; at least one limit > 0 (`fields.maxPages = validation.range`). */
export const AdminCreatePlanSchema = z
  .object({ slug: z.string({ required_error: 'validation.required' }).trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'validation.slug'), ...planFields, reason: reason.optional() })
  .strict();
export type AdminCreatePlanInput = z.infer<typeof AdminCreatePlanSchema>;
/** `PATCH /admin/plans/:id` — creates version n+1 (`dryRun: true` ⇒ only the impact preview, nothing saved). */
export const AdminUpdatePlanSchema = AdminCreatePlanSchema.omit({ slug: true }).partial().extend({ dryRun: z.boolean().optional() }).strict();
export type AdminUpdatePlanInput = z.infer<typeof AdminUpdatePlanSchema>;
/** `POST /admin/plans/:id/migrate` — subscribers move to `toPlanId` now or at their next period. */
export const AdminMigratePlanSchema = z.object({ toPlanId: id, when: z.enum(['now', 'next_period']), reason }).strict();
export type AdminMigratePlanInput = z.infer<typeof AdminMigratePlanSchema>;
export type PlanAdminDto = PlanPublicDto & {
  nameI18n: LocalizedText;
  descriptionI18n: LocalizedText;
  version: number;
  isActive: boolean;
  isVisible: boolean;
  archivedAt: string | null;
  subscribers: number;
  maxApiKeys: number;
  maxWebhooks: number;
  syncHistoryDays: number;
  features: string[];
  sortOrder: number;
  /** keys: edit, duplicate, archive, migrate, delete */
  actions: ActionDescriptor[];
};
export type PlanImpactDto = { subscribers: number; overLimit: { limit: string; count: number }[]; priceChangeAt: string | null; emailDueBy: string | null };
/** `PATCH /admin/plans/:id` → `{ plan, impact }` (or `{ plan: null, impact }` with `dryRun`). */
export type PlanUpdateResultDto = { plan: PlanAdminDto | null; impact: PlanImpactDto };
export type PlanVersionDto = { version: number; snapshot: Record<string, unknown>; changedBy: AdminUserRef | null; impactCount: number; createdAt: string };

// =============================================================================================================================
// ADM-05 subscriptions, invoices, manual payments
// =============================================================================================================================
export const AdminSubscriptionsQuerySchema = z
  .object({
    ...paging,
    planSlug: csv(z.string().max(60)).optional(),
    status: csv(z.enum(SubscriptionStatusValues)).optional(),
    cycle: csv(z.enum(['monthly', 'yearly', 'none'])).optional(),
    method: csv(z.string().max(30)).optional(),
    renewal: z.enum(['lt7d', 'overdue']).optional(),
    q,
  })
  .strict();
export type AdminSubscriptionsQuery = z.infer<typeof AdminSubscriptionsQuerySchema>;
export type AdminSubscriptionRowDto = {
  id: string;
  workspace: { id: string; name: string };
  plan: { id: string; slug: string; name: string };
  status: 'trial' | 'active' | 'dunning' | 'expired' | 'cancelled';
  dunningStage: 'd_minus_7' | 'd0' | 'd_plus_3' | 'expired' | null;
  cycle: 'monthly' | 'yearly' | 'none';
  provider: 'none' | 'chargily' | 'manual';
  appliedPrice: number;
  discountPct: number | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** last payment method + masked card suffix when known (`CIB ••42`) */
  lastPayment: { method: string | null; label: string | null; at: string | null } | null;
  unpaidInvoice: { id: string; number: string; amount: number; remaining: number; dueAt: string | null } | null;
  /** keys: invoices, mark_paid, resend_dunning, extend, change_plan, discount, cancel, cancel_now */
  actions: ActionDescriptor[];
};
/** KPIs over the tabs (`meta.kpis` of `GET /admin/subscriptions`). */
export type AdminSubscriptionKpis = { mrr: number; mrrDeltaPct: number | null; renewals7d: { count: number; amount: number }; dunning: { count: number; expiringTomorrow: number }; trialConversionPct: number | null; trialsConverted: number; manualToConfirm: number; counts: { subscriptions: number; invoices: number; manualPayments: number; packPurchases: number } };
/** `POST /admin/subscriptions` [DLG create subscription] — `SUBSCRIPTION_ALREADY_ACTIVE` when a paid trial/active/dunning one exists. */
export const AdminCreateSubscriptionSchema = z
  .object({ workspaceId: id, planId: id, cycle: z.enum(['monthly', 'yearly']), startsAt: day.or(instant), appliedPrice: int(0, 100_000_000).optional(), provider: z.enum(['manual', 'none']).default('manual'), reason })
  .strict();
export type AdminCreateSubscriptionInput = z.infer<typeof AdminCreateSubscriptionSchema>;
/** `PATCH /admin/subscriptions/:id` — extend the period (`extendDays` 3 | 7) or change the applied price. */
export const AdminPatchSubscriptionSchema = z
  .object({ extendDays: z.union([z.literal(3), z.literal(7), z.literal(30)]).optional(), appliedPrice: int(0, 100_000_000).optional(), cycle: z.enum(['monthly', 'yearly']).optional(), reason })
  .strict();
export type AdminPatchSubscriptionInput = z.infer<typeof AdminPatchSubscriptionSchema>;
/** `POST /admin/subscriptions/:id/discount` — % or DA for 1–12 periods (creates a workspace-targeted promo redemption). */
export const AdminDiscountSchema = z
  .object({ kind: z.enum(['percent', 'fixed']), value: int(1, 10_000_000), periods: int(1, 12), promoCode: str(40).optional(), reason })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'percent' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.range' });
  });
export type AdminDiscountInput = z.infer<typeof AdminDiscountSchema>;
export const AdminInvoicesQuerySchema = z
  .object({ ...paging, status: csv(z.enum(InvoiceStatusValues)).optional(), kind: csv(z.enum(InvoiceKindValues)).optional(), from: day.optional(), to: day.optional(), workspaceId: id.optional(), q })
  .strict();
export type AdminInvoicesQuery = z.infer<typeof AdminInvoicesQuerySchema>;
export type AdminInvoiceRowDto = InvoiceDto & { workspace: { id: string; name: string }; actions: ActionDescriptor[] };
/** `GET /admin/invoices/export?from&to&format` → 202 `{ jobId }` (poll `GET /admin/jobs/:id`). */
export const AdminInvoicesExportQuerySchema = z.object({ from: day, to: day, format: z.enum(['csv', 'xlsx']).default('csv') }).strict();
/** `GET /admin/payments` — tab "Paiements manuels" (default `provider=manual`). */
export const AdminPaymentsQuerySchema = z.object({ ...paging, provider: csv(z.enum(['chargily', 'manual', 'google_play', 'app_store'])).optional(), status: csv(z.enum(['pending', 'paid', 'failed', 'expired', 'refunded'])).optional(), from: day.optional(), to: day.optional(), q }).strict();
export type AdminPaymentRowDto = { id: string; workspace: { id: string; name: string }; invoice: { id: string; number: string } | null; amount: number; status: string; provider: string; method: string | null; reference: string | null; proofUrl: string | null; recordedBy: AdminUserRef | null; paidAt: string | null; createdAt: string };

// =============================================================================================================================
// ADM-15 credit packs, promo codes, pricing versions
// =============================================================================================================================
const packFields = {
  name: localized,
  credits: int(1, 10_000_000),
  priceWebDzd: int(0, 100_000_000),
  googleProductId: str(120).nullable().optional(),
  appleProductId: str(120).nullable().optional(),
  storeTier: str(40).nullable().optional(),
  storePriceLabel: str(40).nullable().optional(),
  isActive: z.boolean().optional(),
  visibleWeb: z.boolean().optional(),
  visibleMobile: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: int(0, 1000).optional(),
};
/** `POST /admin/credit-packs` (`admin.billing.write`). */
export const AdminCreatePackSchema = z.object({ slug: z.string({ required_error: 'validation.required' }).trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'validation.slug'), ...packFields, reason: reason.optional() }).strict();
export type AdminCreatePackInput = z.infer<typeof AdminCreatePackSchema>;
/** `PATCH /admin/credit-packs/:id`. */
export const AdminUpdatePackSchema = AdminCreatePackSchema.omit({ slug: true }).partial().strict();
export type AdminUpdatePackInput = z.infer<typeof AdminUpdatePackSchema>;
/** `purchases` = every purchase row ever (any status: they keep the pack); `actions` = `edit`, `delete` (greyed `CREDIT_PACK_HAS_PURCHASES` once bought — deactivate instead, UX-010). */
export type CreditPackAdminDto = CreditPackDto & { nameI18n: LocalizedText; storeTier: string | null; isActive: boolean; visibleWeb: boolean; visibleMobile: boolean; sales30d: number; sortOrder: number; purchases: number; actions: ActionDescriptor[] };
/** `GET /admin/credit-packs` meta.kpis */
export type AdminPacksKpis = { packsSold30d: { total: number; web: number; mobile: number }; netDzd30d: number; activeCodes: number; codesExpiringThisWeek: number; creditsGranted30d: number; buyingWorkspacesPct: number };
export const AdminPackPurchasesQuerySchema = z.object({ ...paging, channel: csv(z.enum(['web', 'google_play', 'app_store'])).optional(), status: csv(z.enum(['pending', 'validated', 'credited', 'refunded', 'failed', 'invalid'])).optional(), from: day.optional(), to: day.optional(), q }).strict();
export type AdminPackPurchaseRowDto = { id: string; workspace: { id: string; name: string }; pack: { id: string; slug: string; name: string; credits: number }; channel: string; status: string; amount: number; storeTransactionId: string | null; createdAt: string; creditedAt: string | null; refundedAt: string | null };

const promoFields = {
  kind: z.enum(PromoKindValues),
  value: int(1, 10_000_000),
  periods: int(1, 12).nullable().optional(),
  planSlugs: z.array(z.string().trim().max(60)).max(20).default([]),
  target: z.enum(PromoTargetValues).default('all'),
  targetWorkspaceId: id.nullable().optional(),
  maxUses: int(1, 10_000_000).nullable().optional(),
  perWorkspaceLimit: int(1, 100).default(1),
  validFrom: day.or(instant).nullable().optional(),
  validTo: day.or(instant).nullable().optional(),
  notes: str(500).nullable().optional(),
};
/** `POST /admin/promo-codes` — code unique (`409 CONFLICT { field: code }`), `target=workspace` ⇒ `targetWorkspaceId` required. */
export const AdminCreatePromoSchema = z
  .object({ code: z.string({ required_error: 'validation.required' }).trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, 'validation.code'), ...promoFields })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'percent_discount' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.range' });
    if (v.target === 'workspace' && !v.targetWorkspaceId) ctx.addIssue({ code: 'custom', path: ['targetWorkspaceId'], message: 'validation.required' });
  });
export type AdminCreatePromoInput = z.infer<typeof AdminCreatePromoSchema>;
/** `PATCH /admin/promo-codes/:id` — validity, max uses, notes, active flag (kind / value are fixed once used). */
export const AdminUpdatePromoSchema = z
  .object({ maxUses: promoFields.maxUses, validFrom: promoFields.validFrom, validTo: promoFields.validTo, notes: promoFields.notes, planSlugs: z.array(z.string().trim().max(60)).max(20).optional(), isActive: z.boolean().optional(), value: int(1, 10_000_000).optional(), periods: promoFields.periods })
  .strict();
export type AdminUpdatePromoInput = z.infer<typeof AdminUpdatePromoSchema>;
export const AdminPromoQuerySchema = z.object({ ...paging, state: csv(z.enum(['active', 'used', 'expired', 'inactive'])).optional(), kind: csv(z.enum(PromoKindValues)).optional(), q }).strict();
export type PromoCodeDto = {
  id: string;
  code: string;
  kind: 'percent_discount' | 'fixed_discount' | 'credits' | 'trial_extension';
  value: number;
  periods: number | null;
  planSlugs: string[];
  target: 'new_workspaces' | 'existing' | 'all' | 'workspace';
  targetWorkspaceId: string | null;
  targetWorkspace: { id: string; name: string } | null;
  maxUses: number | null;
  perWorkspaceLimit: number;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  uses: number;
  createdBy: AdminUserRef | string;
  notes: string | null;
  state: 'active' | 'used' | 'expired' | 'inactive';
  createdAt: string;
};
export type PromoRedemptionRowDto = { id: string; workspace: { id: string; name: string }; user: AdminUserRef; redeemedAt: string };
export type CreditPricingDto = { id: string; version: number; usdToDzd: number; creditPriceDzd: number; costs: { text: number; image: number; voice: number; order: number }; avgTokensPerMessage: number | null; targetMarginPct: number | null; effectiveAt: string; createdBy: AdminUserRef | null; announcementCmsEntryId: string | null; createdAt: string; current: boolean };

// =============================================================================================================================
// ADM-06 AI providers, models, routes, pricing
// =============================================================================================================================
/** `PATCH /admin/ai-providers/:key` — `apiKey` is sealed (AES-256-GCM) and never returned; `apiKey: null` removes it. */
export const AdminPatchAiProviderSchema = z.object({ apiKey: z.string().trim().min(8, 'validation.length').max(400, 'validation.length').nullable().optional(), isActive: z.boolean().optional(), isPrimary: z.boolean().optional(), reason: reason.optional() }).strict();
export type AdminPatchAiProviderInput = z.infer<typeof AdminPatchAiProviderSchema>;
/** `POST /admin/ai-providers/:key/test { apiKey? }` — tests the given key (dialog, before saving) or the stored one. */
export const AdminTestAiProviderSchema = z.object({ apiKey: z.string().trim().min(8, 'validation.length').max(400, 'validation.length').optional() }).strict();
export type AiProviderAdminDto = {
  key: 'openai' | 'anthropic' | 'google' | 'groq';
  displayName: string;
  isActive: boolean;
  isPrimary: boolean;
  /** "ACTIF · PRINCIPAL" / "ACTIF · SECOURS" / "DÉSACTIVÉ" */
  state: 'primary' | 'fallback' | 'active' | 'disabled';
  /** masked key (`sk-…9f2a`), null when none; the key itself is never returned */
  keyHint: string | null;
  keySource: 'stored' | 'env' | null;
  keyAddedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  models: { id: string; modelId: string; displayName: string; capabilities: string[] }[];
  health: { runs24h: number; errors24h: number; errorRatePct: number | null; thresholdPct: number; failoverActive: boolean };
};
/** `POST /admin/ai-providers/:key/test` → 200 `{ ok: true, latencyMs }`; failures are errors: 401 AI_PROVIDER_KEY_REJECTED {provider} · 503 AI_PROVIDER_UNREACHABLE {provider} · 422 AI_PROVIDER_NO_KEY. */
export type AiProviderTestDto = { ok: true; latencyMs: number; model: string | null };
const modelFields = {
  providerKey: z.enum(AiProviderKeyValues),
  modelId: required(120),
  displayName: required(120),
  capabilities: z.array(z.enum(AiCapabilityValues)).min(1, 'validation.required'),
  supportsTools: z.boolean().optional(),
  inputPricePerM: z.number({ invalid_type_error: 'validation.number' }).min(0, 'validation.range').max(10_000, 'validation.range'),
  outputPricePerM: z.number({ invalid_type_error: 'validation.number' }).min(0, 'validation.range').max(10_000, 'validation.range'),
  contextTokens: int(1, 10_000_000).nullable().optional(),
  timeoutSec: int(1, 120).optional(),
  failoverThresholdPct: int(1, 100).optional(),
  isActive: z.boolean().optional(),
};
/** `POST /admin/ai-models` [DLG "Modèle"]. */
export const AdminCreateAiModelSchema = z.object({ ...modelFields, reason: reason.optional() }).strict();
export type AdminCreateAiModelInput = z.infer<typeof AdminCreateAiModelSchema>;
export const AdminUpdateAiModelSchema = AdminCreateAiModelSchema.omit({ providerKey: true, modelId: true }).partial().strict();
export type AdminUpdateAiModelInput = z.infer<typeof AdminUpdateAiModelSchema>;
export type AiModelAdminDto = { id: string; provider: string; providerKey: string; modelId: string; displayName: string; capabilities: string[]; supportsTools: boolean; inputPricePerM: number; outputPricePerM: number; contextTokens: number | null; timeoutSec: number; failoverThresholdPct: number; isActive: boolean; usedBy: string[] };
/** `PUT /admin/ai-routes/:capability` — `failoverActive: true` forces the fallback ("bascule"), `false` clears it. */
export const AdminPutAiRouteSchema = z
  .object({ primaryModelId: id, fallbackModelId: id.nullable().optional(), creditCost: int(0, 1000), timeoutSec: int(1, 120).optional(), errorThresholdPct: int(1, 100).optional(), failoverActive: z.boolean().optional(), reason: reason.optional() })
  .strict();
export type AdminPutAiRouteInput = z.infer<typeof AdminPutAiRouteSchema>;
export type AiRouteDto = { capability: 'text' | 'vision' | 'transcription' | 'embeddings'; primary: { modelId: string; label: string; provider: string }; fallback: { modelId: string; label: string; provider: string } | null; realCostUsdPer1k: number; credits: number; marginPct: number | null; state: 'ok' | 'failover' | 'degraded'; failoverSince: string | null; timeoutSec: number; errorThresholdPct: number };
/** `GET /admin/ai-pricing` — the current grid, the routes and the computed figures of the calculator. */
export type AiPricingDto = { current: CreditPricingDto | null; routes: AiRouteDto[]; simulation: AiPricingSimulationDto };
/** `POST /admin/ai-pricing/simulate` — calculator (nothing saved). */
export const AiPricingSimulateSchema = z
  .object({
    usdToDzd: z.number({ invalid_type_error: 'validation.number' }).positive('validation.range').max(10_000, 'validation.range'),
    creditPriceDzd: z.number({ invalid_type_error: 'validation.number' }).positive('validation.range').max(10_000, 'validation.range'),
    avgTokensPerMessage: int(1, 1_000_000),
    targetMarginPct: int(0, 99),
    costs: z.object({ text: int(0, 100), image: int(0, 100), voice: int(0, 100), order: int(0, 100) }).strict().optional(),
  })
  .strict();
export type AiPricingSimulateInput = z.infer<typeof AiPricingSimulateSchema>;
export type AiPricingSimulationDto = {
  input: AiPricingSimulateInput & { costs: { text: number; image: number; voice: number; order: number } };
  /** implied price of a credit from the Pro plan (price / monthly credits), for the hint under the price field */
  impliedCreditPriceDzd: number | null;
  rows: { capability: 'text' | 'vision' | 'transcription'; credits: number; revenueDzd: number; realCostDzd: number; marginPct: number; belowTarget: boolean; recommendedCredits: number; unit: 'message' | 'image' | 'note' }[];
  /** price of a credit that keeps the target margin on the text route */
  creditPriceForTargetDzd: number;
};
/** `POST /admin/ai-pricing/versions` — new `CreditPricing` version (applies at each workspace's next credit period, D63). */
export const AdminCreatePricingVersionSchema = AiPricingSimulateSchema.extend({
  costs: z.object({ text: int(0, 100), image: int(0, 100), voice: int(0, 100), order: int(0, 100) }).strict(),
  effectiveAt: day.or(instant).optional(),
  announcementCmsEntryId: id.optional(),
  reason,
}).strict();
export type AdminCreatePricingVersionInput = z.infer<typeof AdminCreatePricingVersionSchema>;

// =============================================================================================================================
// ADM-07 agent presets
// =============================================================================================================================
const presetLocale = z.object({ name: str(80).optional(), tagline: str(200).optional(), systemPrompt: str(20_000).optional() }).strict();
/** `POST /admin/agent-presets` [DLG "Nouveau préréglage"] — creates the preset + draft v1. */
export const AdminCreatePresetSchema = z
  .object({ key: z.string({ required_error: 'validation.required' }).trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'validation.slug'), name: localized, tagline: localized.optional(), badge: z.enum(PresetBadgeValues).nullable().optional(), sectors: z.array(str(40)).max(20).optional(), sortOrder: int(0, 1000).optional(), copyFromPresetId: id.optional() })
  .strict();
export type AdminCreatePresetInput = z.infer<typeof AdminCreatePresetSchema>;
/** `PATCH /admin/agent-presets/:id` — catalogue fields (name / tagline shown in the onboarding, badge, order). */
export const AdminPatchPresetSchema = z
  .object({ name: localized.optional(), tagline: localized.optional(), description: localized.optional(), badge: z.enum(PresetBadgeValues).nullable().optional(), sectors: z.array(str(40)).max(20).optional(), sortOrder: int(0, 1000).optional() })
  .strict();
export type AdminPatchPresetInput = z.infer<typeof AdminPatchPresetSchema>;
/** `POST /admin/agent-presets/:id/versions` — new draft copied from the latest version (409 CONFLICT when a draft exists). */
export const AdminCreatePresetVersionSchema = z.object({ changelog: str(500).optional() }).strict();
/** `PATCH /admin/agent-presets/:id/versions/:v` — drafts only (`409 PRESET_PUBLISHED_IMMUTABLE`). */
export const AdminPatchPresetVersionSchema = z
  .object({
    locales: z.object({ fr: presetLocale.optional(), ar: presetLocale.optional(), en: presetLocale.optional() }).strict().optional(),
    config: z
      .object({
        tone: z.enum(['friendly', 'professional', 'direct', 'expert']).optional(),
        temperature: z.number().min(0).max(1.5).optional(),
        maxTokens: int(50, 4000).optional(),
        maxReplyChars: int(50, 4000).optional(),
        imageRecognition: z.boolean().optional(),
        voiceNotes: z.boolean().optional(),
        replyDelaySec: int(0, 60).optional(),
        capabilities: z.array(z.enum(['text', 'image', 'voice', 'orders', 'handoff'])).optional(),
        handoffRules: z.array(str(120)).max(20).optional(),
      })
      .strict()
      .optional(),
    changelog: str(500).optional(),
  })
  .strict();
export type AdminPatchPresetVersionInput = z.infer<typeof AdminPatchPresetVersionSchema>;
export type PresetCheckDto = { key: 'locales' | 'variables' | 'test' | 'diff' | 'agents'; ok: boolean; params: Record<string, string | number> };
export type AgentPresetVersionDto = {
  version: number;
  status: 'draft' | 'published' | 'archived';
  locales: Record<'fr' | 'ar' | 'en', { name: string; tagline: string; systemPrompt: string }>;
  /** locales whose systemPrompt is empty ("EN ⚠ manquant") */
  missingLocales: ('fr' | 'ar' | 'en')[];
  config: Record<string, unknown>;
  changelog: string | null;
  testResults: { at: string; checks: PresetCheckDto[] } | null;
  publishedAt: string | null;
  publishedBy: AdminUserRef | null;
  createdAt: string;
  updatedAt: string;
};
export type AgentPresetAdminDto = {
  id: string;
  key: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  badge: 'recommended' | 'popular' | 'beta' | null;
  sectors: string[];
  status: 'draft' | 'published' | 'archived';
  currentVersion: number;
  draftVersion: number | null;
  sortOrder: number;
  archivedAt: string | null;
  agents: number;
  /** keys: edit, duplicate, preview, archive, restore, delete */
  actions: ActionDescriptor[];
  /** detail only */
  versions?: AgentPresetVersionDto[];
};

// =============================================================================================================================
// ADM-08 CMS
// =============================================================================================================================
export const AdminCmsQuerySchema = z
  .object({ ...paging, type: csv(z.enum(CmsTypeValues)).optional(), status: csv(z.enum(CmsStatusValues)).optional(), missingLocale: z.enum(LocaleValues).optional(), target: str(40).optional(), updatedById: id.optional(), q })
  .strict();
export type AdminCmsQuery = z.infer<typeof AdminCmsQuerySchema>;
const cmsLocaleInput = z.object({ title: str(300), body: str(100_000), fallbackToFr: z.boolean().optional() }).strict();
/** `POST /admin/cms` [DLG "Nouvelle entrée"] — key = slug (`CMS_SLUG_INVALID` / `CMS_SLUG_TAKEN`). */
export const AdminCreateCmsSchema = z
  .object({
    key: z.string({ required_error: 'validation.required' }).trim(),
    type: z.enum(CmsTypeValues),
    category: str(60).nullable().optional(),
    target: z.record(z.unknown()).optional(),
    channels: z.array(z.enum(['banner', 'in_app', 'email', 'push', 'web'])).max(5).optional(),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
    link: str(500).nullable().optional(),
    sortOrder: int(0, 10_000).optional(),
    locales: z.object({ fr: cmsLocaleInput.optional(), ar: cmsLocaleInput.optional(), en: cmsLocaleInput.optional() }).strict().optional(),
  })
  .strict();
export type AdminCreateCmsInput = z.infer<typeof AdminCreateCmsSchema>;
/** `PATCH /admin/cms/:id`. */
export const AdminPatchCmsSchema = AdminCreateCmsSchema.omit({ key: true, type: true, locales: true }).partial().strict();
export type AdminPatchCmsInput = z.infer<typeof AdminPatchCmsSchema>;
/** `PUT /admin/cms/:id/locales/:locale`. */
export const AdminPutCmsLocaleSchema = cmsLocaleInput;
export type AdminPutCmsLocaleInput = z.infer<typeof AdminPutCmsLocaleSchema>;
/** `POST /admin/cms/:id/publish { fallbackToFr? }` — `422 CMS_LOCALE_MISSING {locales}` unless every locale has content or `fallbackToFr`. */
export const AdminPublishCmsSchema = z.object({ fallbackToFr: z.boolean().optional() }).strict();
/** `POST /admin/cms/:id/schedule { startsAt, endsAt?, fallbackToFr? }` — status `scheduled`, published by `sched-cms-publish` at `startsAt`. */
export const AdminScheduleCmsSchema = z.object({ startsAt: instant, endsAt: instant.nullable().optional(), fallbackToFr: z.boolean().optional() }).strict();
/** `POST /admin/cms/:id/translate { to? }` → 202 `{ jobId }` (AI translation from FR, worker job `cms-translate`; locales written as drafts). */
export const AdminTranslateCmsSchema = z.object({ to: z.array(z.enum(['ar', 'en'])).min(1).default(['ar', 'en']) }).strict();
export type CmsEntryAdminDto = {
  id: string;
  key: string;
  type: 'announcement' | 'legal' | 'help' | 'email' | 'plan_text' | 'system_message_default' | 'page';
  category: string | null;
  target: Record<string, unknown>;
  channels: string[];
  startsAt: string | null;
  endsAt: string | null;
  link: string | null;
  sortOrder: number;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  currentVersion: number;
  locales: { locale: 'fr' | 'ar' | 'en'; title: string; body: string; status: (typeof CmsLocaleStatusValues)[number]; fallbackToFr: boolean; updatedBy: AdminUserRef | null; updatedAt: string | null }[];
  versions: { version: number; publishedAt: string; publishedBy: AdminUserRef | null }[];
  createdBy: AdminUserRef | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: AdminUserRef | null;
  /** keys: edit, publish, schedule, unpublish, translate, preview, versions */
  actions: ActionDescriptor[];
};
/** `GET /admin/cms` meta.counts: per type count (tabs). */
export type AdminCmsCounts = Record<CmsEntryAdminDto['type'], number>;
export type CmsVersionDto = { version: number; snapshot: Record<string, unknown>; createdBy: AdminUserRef | null; at: string };
/** `GET /admin/cms/:id/preview-link` → signed URL valid 24 h. */
export type CmsPreviewLinkDto = { url: string; expiresAt: string };

// =============================================================================================================================
// ADM-09 audit log
// =============================================================================================================================
export const AdminAuditQuerySchema = z
  .object({
    ...paging,
    actorId: id.optional(),
    action: csv(z.string().max(80)).optional(),
    entity: csv(z.string().max(60)).optional(),
    workspaceId: id.optional(),
    impersonationSessionId: id.optional(),
    from: day.optional(),
    to: day.optional(),
    period: z.enum(['24h', '7d', '30d', '90d']).optional(),
    impersonation: z.enum(['only', 'exclude']).optional(),
    q,
  })
  .strict();
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;
export type AuditLogDto = {
  id: string;
  at: string;
  actor: { type: string; id: string | null; name: string; role: string | null };
  action: string;
  target: { entity: string; id: string | null; label: string; workspace?: { id: string; name: string } };
  reason: string | null;
  context: { ip: string | null; userAgent: string | null; impersonationSessionId: string | null; twoFactor: boolean };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
/** `POST /admin/audit-logs/export` (`admin.audit.export`) → 202 `{ jobId }`; the CSV starts with `# sha256=<hex of the rest>`; the export is itself audited (`audit.export`). */
export const AdminAuditExportSchema = z
  .object({ format: z.enum(['csv_signed', 'json']).default('csv_signed'), from: day, to: day, workspaceId: id.optional(), actorId: id.optional(), action: z.array(z.string().max(80)).max(20).optional(), impersonation: z.enum(['only', 'exclude']).optional() })
  .strict();
export type AdminAuditExportInput = z.infer<typeof AdminAuditExportSchema>;
/** `GET /admin/jobs/:id` — admin export jobs (audit, invoices, CMS translation) of the caller. */
export type AdminJobDto = { id: string; kind: string; status: 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled'; progress: number; result: Record<string, unknown> | null; resultUrl: string | null; error: { code: string } | null; createdAt: string; finishedAt: string | null; expiresAt: string | null };

// =============================================================================================================================
// ADM-16 platform team & account deletion requests
// =============================================================================================================================
/** `POST /admin/platform-members/invitations` — `@djaber.ai` only (`ADMIN_EMAIL_DOMAIN_INVALID`); role ≠ none. */
export const AdminInviteMemberSchema = z.object({ email: z.string({ required_error: 'validation.required' }).trim().toLowerCase().email('validation.email'), platformRole: z.enum(PlatformRoleValues) }).strict();
export type AdminInviteMemberInput = z.infer<typeof AdminInviteMemberSchema>;
export type PlatformMemberDto = { userId: string; firstName: string; lastName: string; email: string; platformRole: string; totpEnabled: boolean; accessBlocked: boolean; lastAction: { action: string; at: string } | null; lastLoginAt: string | null; actions: ActionDescriptor[] };
export type PlatformInvitationDto = { id: string; email: string; platformRole: string; invitedBy: AdminUserRef | null; expiresAt: string; createdAt: string; acceptedAt: string | null };
export type PlatformTeamDto = { members: PlatformMemberDto[]; invitations: PlatformInvitationDto[] };
export const AdminDeletionRequestsQuerySchema = z.object({ ...paging, status: csv(z.enum(DeletionStatusValues)).optional(), q }).strict();
export type DeletionRequestAdminDto = {
  id: string;
  source: 'app' | 'public_page' | 'admin';
  status: 'pending_confirmation' | 'grace' | 'blocked' | 'anonymised' | 'cancelled';
  requestedAt: string;
  confirmedAt: string | null;
  scheduledAt: string | null;
  cancelledAt: string | null;
  processedAt: string | null;
  user: AdminUserRef;
  workspaces: { id: string; name: string; role: 'owner' | 'admin' | 'operator'; status: string }[];
  blockedReason: 'ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT' | null;
  /** both causes when both apply ("ACCOUNT_OWNS_WORKSPACE + WORKSPACE_HAS_DEBT") */
  blockedReasons: ('ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT')[];
  exportSentAt: string | null;
  membershipsRemoved: boolean;
  /** keys: view, cancel, resolve, process_now */
  actions: ActionDescriptor[];
};
/** `GET /admin/deletion-requests` meta.counts */
export type AdminDeletionCounts = { toProcess: number; blocked: number };

// =============================================================================================================================
// ADM-17 viewers + impersonation
// =============================================================================================================================
export const AdminViewerConversationsQuerySchema = z.object({ ...paging, workspaceId: id, q }).strict();
/** `GET /admin/conversations/:id?reason=` — every open is audited `viewer.open` with the reason (≥ 10 chars). */
export const AdminViewerOpenQuerySchema = z.object({ reason: str(500), reportId: id.optional() }).strict();
export type AdminViewerConversationRowDto = { id: string; workspace: { id: string; name: string }; channel: { id: string; name: string; platform: string }; customer: { name: string; phone: string | null }; status: string; lastMessageAt: string | null; lastMessagePreview: string | null };
export type AdminViewerMessageDto = { id: string; at: string; direction: 'in' | 'out'; author: 'customer' | 'ai' | 'human' | 'system'; authorLabel: string; type: string; text: string | null; attachments: { type: string; url: string | null }[] };
export type AdminViewerConversationDto = AdminViewerConversationRowDto & { agent: { id: string; name: string } | null; masked: boolean; messages: AdminViewerMessageDto[] };
export const AdminViewerProductsQuerySchema = z.object({ ...paging, workspaceId: id, moderationStatus: csv(z.string().max(30)).optional(), q }).strict();
export type AdminViewerProductRowDto = { id: string; name: string; sku: string | null; price: number; stock: number; status: string; moderationStatus: string; aiStatus: 'proposed' | 'excluded' | 'stale' | null; imageUrl: string | null; workspace: { id: string; name: string } };
export type AdminViewerProductDto = AdminViewerProductRowDto & { description: string | null; category: string | null; images: { url: string; flag: string | null }[]; variants: { id: string; name: string; sku: string | null; price: number | null; stock: number }[]; moderationHistory: { at: string; status: string; decision: string | null; note: string | null }[] };

/** `POST /admin/impersonation/sessions` (`admin.workspaces.impersonate`: super_admin, support). No `mode` field exists (read-only only). */
export const AdminImpersonateSchema = z.object({ workspaceId: id, reason, ticketId: id.optional() }).strict();
export type AdminImpersonateInput = z.infer<typeof AdminImpersonateSchema>;
export type ImpersonationStartDto = { sessionId: string; token: string; expiresAt: string; workspace: { id: string; name: string } };
export const AdminImpersonationQuerySchema = z.object({ ...paging, adminUserId: id.optional(), workspaceId: id.optional(), from: day.optional(), to: day.optional(), active: bool.optional() }).strict();
export type ImpersonationSessionDto = { id: string; admin: AdminUserRef; workspace: { id: string; name: string }; reason: string; ticketId: string | null; startedAt: string; expiresAt: string; endedAt: string | null; actionsCount: number; active: boolean };
