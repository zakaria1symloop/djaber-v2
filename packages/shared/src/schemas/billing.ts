// Billing, credits, packs, IAP, promo codes, order payment links (M9). 03 §17 BIL-*, §28 PCK/PRM, 02 §5–§6, 04 §14,
// 05-integrations §4–§5, api-contract §3.10, 06 "Billing & credits" + §8.9. Field names = contract names; messages = i18n keys.
// One source for the API (nestjs-zod DTOs) and the web / mobile clients.
import { z } from 'zod';
import { CreditActionValues, CreditBucketValues, InvoiceStatusValues } from '../enums';
import type { CreditsDto } from './agents';

// --- constants (spec values) -------------------------------------------------------------------------------------------------
export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycleName = (typeof BILLING_CYCLES)[number];
/** FL-28 / 05 §4.2: a Chargily checkout lives 15 min; the return page polls every 5 s, 12 times. */
export const CHECKOUT_EXPIRES_MIN = 15;
export const CHECKOUT_RETURN_POLL_S = 5;
export const CHECKOUT_RETURN_POLLS = 12;
/** PAY-02 / 04 §6: an order payment link is valid 15 min, one active per order. */
export const PAYMENT_LINK_MINUTES = 15;
/** D74: store invoices are booked net of the 30 % store commission. */
export const STORE_COMMISSION_PCT = 30;
/** PRM-03: support may grant at most 1 000 credits (`ADMIN_CREDIT_GRANT_LIMIT {max}`). */
export const ADMIN_SUPPORT_GRANT_MAX = 1000;
/** 06 §9: every admin write that touches a merchant carries a reason of ≥ 10 chars (`ADMIN_REASON_REQUIRED`). */
export const ADMIN_REASON_MIN = 10;
/** R-J: dunning calendar (days relative to `currentPeriodEnd`). */
export const DUNNING_DAYS = { expiring: -7, d0: 0, d_plus_3: 3, expired: 7 } as const;
/** PRM-01: referral codes `PARRAIN-<code>` credit 300 to both sides at the referee's first paid invoice. */
export const REFERRAL_PREFIX = 'PARRAIN-';
export const REFERRAL_CREDITS = 300;
export const PROMO_CODE_MAX = 40;

const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const money = z.number({ required_error: 'validation.required', invalid_type_error: 'validation.amount' }).int('validation.amount');
const promoCode = z
  .string({ invalid_type_error: 'validation.invalid' })
  .trim()
  .min(1, 'validation.required')
  .max(PROMO_CODE_MAX, 'validation.length')
  .transform((s) => s.toUpperCase());
const reason = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).trim().max(500, 'validation.length');

// --- merchant inputs ---------------------------------------------------------------------------------------------------------
/** `POST /billing/checkout` and `POST /billing/preview` (`billing.plan`, Owner; web only — `X-App-Platform: android|ios` ⇒ 403). */
export const CheckoutSchema = z.object({ planId: id, cycle: z.enum(BILLING_CYCLES, { errorMap: () => ({ message: 'validation.invalid' }) }), promoCode: promoCode.optional() }).strict();
export type CheckoutInput = z.infer<typeof CheckoutSchema>;
/** `POST /billing/cancel` — cancel (or downgrade to free) at period end (BIL-05). */
export const CancelSubscriptionSchema = z.object({ reason: reason.optional() }).strict();
export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionSchema>;
/** `PUT /billing/info` — workspace billing info printed on invoices (BIL-04). */
export const BillingInfoSchema = z
  .object({
    companyName: z.string().trim().max(160, 'validation.length').optional(),
    nif: z.string().trim().max(40, 'validation.length').optional(),
    address: z.string().trim().max(300, 'validation.length').optional(),
  })
  .strict();
export type BillingInfoInput = z.infer<typeof BillingInfoSchema>;
/** `GET /billing/invoices?status&page`. */
export const InvoicesQuerySchema = z.object({ ...paging, status: csv(z.enum(InvoiceStatusValues)).optional() }).strict();
export type InvoicesQuery = z.infer<typeof InvoicesQuerySchema>;
/** `GET /billing/payments?page`. */
export const BillingPaymentsQuerySchema = z.object({ ...paging }).strict();
/** `POST /billing/promo/validate { code, planId? }` (`billing.write`). */
export const PromoValidateSchema = z.object({ code: promoCode, planId: id.optional() }).strict();
export type PromoValidateInput = z.infer<typeof PromoValidateSchema>;
/** `POST /billing/promo/redeem { code }` (`billing.write`) — `credits`, `trial_extension` and `PARRAIN-*` codes. */
export const PromoRedeemSchema = z.object({ code: promoCode }).strict();
/** `GET /billing/checkout/return?ref` — ref = the `ref` returned by the checkout (or the Chargily checkout id). */
export const CheckoutReturnQuerySchema = z.object({ ref: z.string().trim().min(1, 'validation.required').max(200, 'validation.length') }).strict();
/** `GET /credit-packs?platform` — `platform` ⇒ only packs with that store product id and `visibleMobile`. */
export const CreditPacksQuerySchema = z.object({ platform: z.enum(['google_play', 'app_store']).optional() }).strict();
/** `POST /credits/packs/checkout { packId }` (web, Chargily, Idempotency-Key required). */
export const PackCheckoutSchema = z.object({ packId: id }).strict();
/** `GET /credits/packs/purchases?page`. */
export const PackPurchasesQuerySchema = z.object({ ...paging }).strict();
/**
 * `POST /credits/packs/iap/validate` (D74, Idempotency-Key required, idempotent on `transactionId`).
 * `app_store`: `receipt` = the signed transaction (JWS) · `google_play`: `purchaseToken` required.
 */
export const IapValidateSchema = z
  .object({
    platform: z.enum(['google_play', 'app_store']),
    productId: z.string().trim().min(1, 'validation.required').max(200, 'validation.length'),
    transactionId: z.string().trim().min(1, 'validation.required').max(200, 'validation.length'),
    receipt: z.string().max(20_000, 'validation.length').optional(),
    purchaseToken: z.string().max(4_000, 'validation.length').optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.platform === 'google_play' && !v.purchaseToken) ctx.addIssue({ code: 'custom', path: ['purchaseToken'], message: 'validation.required' });
    if (v.platform === 'app_store' && !v.receipt) ctx.addIssue({ code: 'custom', path: ['receipt'], message: 'validation.required' });
  });
export type IapValidateInput = z.infer<typeof IapValidateSchema>;
/** `GET /credits/ledger/export?format&…LedgerQuery filters` → 202 `{ jobId }` (job `export`, kind `ledger`). */
export const LedgerExportQuerySchema = z
  .object({ format: z.enum(['csv', 'xlsx']).default('csv'), from: day.optional(), to: day.optional(), action: csv(z.enum(CreditActionValues)).optional(), agentId: id.optional(), bucket: z.enum(CreditBucketValues).optional() })
  .strict();
export type LedgerExportQuery = z.infer<typeof LedgerExportQuerySchema>;

// --- orders: online payment link & refunds (PAY-02 / PAY-03, P2) -------------------------------------------------------------
/** `POST /orders/:id/payment-link { send? }` (`orders.money`) — `send` (default true) posts the link in the order's conversation. */
export const CreatePaymentLinkSchema = z.object({ send: z.boolean().optional() }).strict();
export type CreatePaymentLinkInput = z.infer<typeof CreatePaymentLinkSchema>;
/** `POST /orders/:id/refunds { amount, reason, method? }` (`orders.money`) — recorded refund, no gateway call (05 §4.2). */
export const OrderRefundSchema = z
  .object({
    amount: money.gt(0, 'validation.range'),
    reason: z.string({ required_error: 'validation.required' }).trim().min(3, 'validation.length').max(500, 'validation.length'),
    method: z.enum(['cash', 'card', 'transfer', 'ccp', 'other']).optional(),
  })
  .strict();
export type OrderRefundInput = z.infer<typeof OrderRefundSchema>;

// --- platform admin (M9 endpoints; the admin UI is M10) -------------------------------------------------------------------------
/** `POST /admin/invoices/:id/mark-paid` (`admin.billing.write`: finance, super_admin) — ADM-04 / D71. */
export const AdminMarkPaidSchema = z
  .object({
    method: z.enum(['manual_transfer', 'manual_ccp', 'manual_cash']),
    amount: money.gt(0, 'validation.range'),
    reference: z.string({ required_error: 'validation.required' }).trim().min(1, 'validation.required').max(120, 'validation.length'),
    paidAt: z.string().datetime({ offset: true, message: 'validation.date' }).or(day),
    proofUploadId: id.optional(),
    reason: z.string({ required_error: 'validation.required' }).trim().max(500, 'validation.length'),
  })
  .strict();
export type AdminMarkPaidInput = z.infer<typeof AdminMarkPaidSchema>;
/** `POST /admin/workspaces/:id/credits { credits, reason, type? }` (`admin.workspaces.credits`; support ≤ 1 000). */
export const AdminGrantCreditsSchema = z
  .object({
    credits: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.quantity' }).int('validation.quantity').min(1, 'validation.range').max(1_000_000, 'validation.range'),
    reason: z.string({ required_error: 'validation.required' }).trim().max(500, 'validation.length'),
    type: z.enum(['commercial', 'incident', 'manual_purchase']).optional(),
  })
  .strict();
export type AdminGrantCreditsInput = z.infer<typeof AdminGrantCreditsSchema>;
/**
 * `POST /admin/workspaces/:id/credits/remove { credits, reason }` (`admin.billing.write`: finance + super_admin; tester report
 * 22/10 UX-019): takes back plan credits granted by mistake — `CreditLedger(bucket=plan, action=adjustment, kind=debit)`, at most
 * the plan credits left (`fields.credits = validation.range`, `details.max`), audited `credits.remove`. Packs are never touched.
 */
export const AdminRemoveCreditsSchema = z
  .object({
    credits: z.number({ required_error: 'validation.required', invalid_type_error: 'validation.quantity' }).int('validation.quantity').min(1, 'validation.range').max(1_000_000, 'validation.range'),
    reason: z.string({ required_error: 'validation.required' }).trim().max(500, 'validation.length'),
  })
  .strict();
export type AdminRemoveCreditsInput = z.infer<typeof AdminRemoveCreditsSchema>;

// --- dev / test simulation (fake drivers only, never in production) -------------------------------------------------------------
/** `POST /dev-payments/:ref { outcome }` — the fake Chargily checkout page. */
export const DevPaymentOutcomeSchema = z.object({ outcome: z.enum(['paid', 'failed', 'expired', 'pending']) }).strict();
export type DevPaymentOutcome = z.infer<typeof DevPaymentOutcomeSchema>['outcome'];
/** `POST /dev/billing/clock { days }` — moves the current subscription's dates back by `days` and runs the daily jobs. */
export const DevBillingClockSchema = z.object({ days: z.number().int().min(1).max(400), run: z.boolean().optional() }).strict();
/** `POST /dev/billing/store-refund { transactionId? }` — delivers a fake store refund notification (latest credited IAP purchase when omitted). */
export const DevStoreRefundSchema = z.object({ transactionId: z.string().trim().min(1).max(200).optional() }).strict();
/** `POST /dev/billing/subscription { action, stage? }` — jumps the current subscription to a lifecycle state (fake driver, non-production). */
export const DevSubscriptionSchema = z
  .object({ action: z.enum(['expire', 'expiring', 'dunning', 'trial_end', 'renew']), stage: z.enum(['d_minus_7', 'd0', 'd_plus_3']).optional(), planSlug: z.string().max(40).optional() })
  .strict();
/** `POST /dev/billing/pack { packId?, platform? }` — credits a pack through the fake store (returns the transaction id for a later refund). */
export const DevPackSchema = z.object({ packId: id.optional(), platform: z.enum(['google_play', 'app_store']).optional() }).strict();

// --- read models (api-contract §3.10) -------------------------------------------------------------------------------------------
export type PlanLimitsView = { maxPages: number; maxAgents: number; maxProducts: number; maxConversationsPerMonth: number; maxMembers: number; maxApiKeys: number; maxWebhooks: number; monthlyCredits: number; features: string[] }; // -1 = unlimited
export type PlanUsageView = { pages: number; agents: number; products: number; conversationsThisMonth: number; members: number; creditsUsed: number };
/** `GET /plans` (public) — `current` only when called with a workspace. */
export type PlanPublicDto = {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  yearlyDiscountPct: number;
  trialDays: number;
  limits: PlanLimitsView;
  isFeatured: boolean;
  current?: boolean;
};
export type PausedResourceView = { type: 'channel' | 'agent' | 'member'; id: string; name: string };
export type SubscriptionStatusName = 'trial' | 'active' | 'dunning' | 'expired' | 'cancelled';
export type DunningStageName = 'd_minus_7' | 'd0' | 'd_plus_3' | 'expired';
/** `GET /billing/subscription`. */
export type SubscriptionDto = {
  id: string;
  plan: PlanPublicDto;
  status: SubscriptionStatusName;
  billingCycle: 'monthly' | 'yearly' | 'none';
  provider: 'none' | 'chargily' | 'manual';
  appliedPrice: number;
  discountPct: number | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  dunningStage: DunningStageName | null;
  trialEndsAt: string | null;
  usage: PlanUsageView;
  pausedResources: PausedResourceView[];
  /** downgrade booked for the renewal (lower paid plan / cycle), null otherwise */
  nextPlan: { id: string; slug: string; name: string; cycle: 'monthly' | 'yearly'; at: string } | null;
  /** unpaid invoice of the workspace (dunning banner, "Payer maintenant"), null otherwise */
  unpaidInvoice: { id: string; number: string; amount: number; remaining: number; dueAt: string | null } | null;
  /** previous paid subscription expired (02 §5 banner "Plan expiré") */
  expiredFrom: { planSlug: string; planName: string; at: string } | null;
  /** web-only actions (D73); `reasonCode` explains a greyed item */
  actions: { key: 'change_plan' | 'cancel' | 'pay_invoice' | 'buy_pack'; enabled: boolean; reasonCode?: string }[];
};
/** `POST /billing/preview` (and `preview` inside the checkout answer) — the "Changer de plan" dialog (AT-DLG-65). */
export type CheckoutPreviewDto = {
  /** `upgrade` = paid now, same period (prorata) · `new_period` = paid now, new period starts today · `renewal` = same plan + cycle, extends the period · `downgrade` = booked for the period end, nothing paid now */
  mode: 'upgrade' | 'new_period' | 'renewal' | 'downgrade';
  targetPlan: { id: string; slug: string; name: string; cycle: 'monthly' | 'yearly' };
  amountNow: number;
  /** days of the current period covered by the prorata line (upgrade / cycle change), null without prorata */
  prorataDays: number | null;
  /** price before the promo, for the struck-through line */
  amountBeforePromo: number;
  nextAmount: number;
  nextAt: string;
  effectiveAt: string;
  creditsNow: number;
  pausedResources: { type: 'channel' | 'agent' | 'member'; name: string }[];
  promo: { code: string; kind: 'percent_discount' | 'fixed_discount' | 'credits' | 'trial_extension'; value: number; periods: number | null } | null;
};
/** `POST /billing/checkout` → `{ checkoutUrl, ref, prorata, preview }`; downgrades answer `{ checkoutUrl: null, … }` (booked, nothing to pay). */
export type CheckoutResultDto = { checkoutUrl: string | null; ref: string | null; prorata: number | null; preview: CheckoutPreviewDto };
/** `GET /billing/checkout/return?ref` — FL-28 states. `verifying` = checkout still open at the gateway, `pending` = past its window without confirmation (or held for review). */
export type CheckoutReturnDto = {
  status: 'verifying' | 'success' | 'pending' | 'failed' | 'expired';
  kind: 'subscription' | 'pack' | 'invoice';
  invoiceId: string | null;
  invoiceNumber: string | null;
  planUntil: string | null;
  planName: string | null;
  credits: number | null;
  failureReason: string | null;
};
export type InvoiceKindName = 'subscription' | 'credit_pack' | 'manual';
export type InvoiceStatusName = 'upcoming' | 'unpaid' | 'paid' | 'void' | 'refunded';
export type PaymentMethodBillingName = 'cib' | 'edahabia' | 'manual_transfer' | 'manual_ccp' | 'manual_cash' | 'google_play' | 'app_store';
/** `GET /billing/invoices`. `POST /billing/invoices/:id/pay` → `{ checkoutUrl, ref }`. */
export type InvoiceDto = {
  id: string;
  number: string;
  kind: InvoiceKindName;
  date: string;
  label: string;
  amount: number;
  status: InvoiceStatusName;
  method: PaymentMethodBillingName | null;
  paidAt: string | null;
  pdfUrl: string | null;
  dueAt: string | null;
  remaining: number;
  dunningStage: DunningStageName | null;
  lines: { label: string; amount: number; quantity?: number }[];
};
export type PayInvoiceResultDto = { checkoutUrl: string; ref: string };
/** `GET /billing/payments`. */
export type BillingPaymentDto = { id: string; amount: number; status: 'pending' | 'paid' | 'failed' | 'expired' | 'refunded'; provider: 'chargily' | 'manual' | 'google_play' | 'app_store'; method: PaymentMethodBillingName | null; reference: string | null; invoiceId: string | null; kind: 'subscription' | 'pack' | 'invoice' | 'manual'; createdAt: string; paidAt: string | null };
export type BillingInfoDto = { companyName: string | null; nif: string | null; address: string | null };
/** `POST /billing/promo/validate` → `PromoCheckDto`; `POST /billing/promo/redeem` → `PromoRedeemDto`. */
export type PromoCheckDto = { code: string; kind: 'percent_discount' | 'fixed_discount' | 'credits' | 'trial_extension'; value: number; periods: number | null; planSlugs: string[]; referral: boolean };
export type PromoRedeemDto = PromoCheckDto & { creditsAdded: number; trialEndsAt: string | null; balance: CreditsDto };
/** `GET /credit-packs` (public; `?platform=` for the mobile store list). */
export type CreditPackDto = { id: string; slug: string; name: string; credits: number; priceWebDzd: number; googleProductId: string | null; appleProductId: string | null; storePriceLabel: string | null; isFeatured: boolean; pricePerCreditDzd: number };
/** `POST /credits/packs/checkout` → `{ checkoutUrl, ref }` (same return page as plans, FL-28). */
export type PackCheckoutResultDto = { checkoutUrl: string; ref: string; purchaseId: string };
/** `GET /credits/packs/purchases`. */
export type PackPurchaseDto = { id: string; pack: { id: string; slug: string; name: string; credits: number }; channel: 'web' | 'google_play' | 'app_store'; status: 'pending' | 'validated' | 'credited' | 'refunded' | 'failed' | 'invalid'; amount: number; createdAt: string; creditedAt: string | null; refundedAt: string | null; invoiceId: string | null };
/** `POST /credits/packs/iap/validate` → `IapValidateResult`. Errors: 404 IAP_PRODUCT_UNKNOWN · 422 IAP_RECEIPT_INVALID · 409 IAP_RECEIPT_ALREADY_USED (success for the app) · 503 IAP_STORE_UNAVAILABLE. */
export type IapValidateResult = { status: 'credited' | 'already_credited' | 'invalid' | 'pending'; creditsAdded: number; purchaseId: string; balance: CreditsDto };
/** Order payment link (`POST /orders/:id/payment-link` → 201, `GET /orders/:id/payment-link`). The checkout is created by the worker (03-events §7): `creating` until the URL exists. */
export type OrderPaymentLinkDto = { id: string; orderId: string; amount: number; status: 'creating' | 'pending' | 'paid' | 'failed' | 'expired' | 'refunded' | 'mismatch'; url: string | null; expiresAt: string | null; paidAt: string | null; sentToCustomer: boolean; createdAt: string };
/** `POST /orders/:id/refunds` → the order detail (`OrderDetailView`) with `paymentStatus='refunded'`. */
export type OrderRefundResultDto = { refundId: string; amount: number; paymentStatus: 'refunded' };
/** `POST /admin/invoices/:id/mark-paid` → `AdminMarkPaidResultDto` (+ `meta.warnings` INVOICE_PARTIAL_PAYMENT {remaining} when partial). */
export type AdminMarkPaidResultDto = { invoice: InvoiceDto; paymentId: string; remaining: number; reactivated: boolean };
/** `POST /admin/workspaces/:id/credits` → the workspace credit summary. */
export type AdminGrantCreditsResultDto = { ledgerEntryId: string; balance: CreditsDto };

/** Credit calculator suggestion (PCK-05, AT-PCK-04) — part of `CreditsCalculatorDto`. */
export type CreditsCalculatorPlanRow = { planId: string; slug: string; name: string; monthlyCredits: number; priceMonthly: number; coversPct: number; missingCredits: number };
export type CreditsCalculatorSuggestion = { planId: string; planSlug: string; planName: string; packs: { packId: string; slug: string; name: string; credits: number; quantity: number; priceWebDzd: number }[]; totalMonthlyDzd: number };

/** `workspace.updated` WS payload (03-events §2) after a subscription change. */
export type WorkspaceSubscriptionEvent = { workspace: { status: 'active' | 'suspended' | 'deletion_scheduled'; subscription: { planSlug: string; status: SubscriptionStatusName; dunningStage: DunningStageName | null; currentPeriodEnd: string } } };

/** 02 §5 proration — pure, shared by the API preview and unit tests (AT-DLG-65 "prorata line equals the formula"). */
export const prorata = (o: { price: number; currentPrice: number; periodStart: Date; periodEnd: Date; now: Date }) => {
  const DAY = 86_400_000;
  const total = Math.max(1, Math.round((o.periodEnd.getTime() - o.periodStart.getTime()) / DAY));
  const remaining = Math.min(total, Math.max(0, Math.ceil((o.periodEnd.getTime() - o.now.getTime()) / DAY)));
  return { totalDays: total, remainingDays: remaining, amount: Math.max(0, Math.round(((o.price - o.currentPrice) * remaining) / total)), unused: Math.round((o.currentPrice * remaining) / total) };
};
