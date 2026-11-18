// Pure logic of the billing screens (02 §5, 03 BIL-01…07, FL-09, FL-28): plan prices per cycle, the action a plan card
// offers, the plan banner to show, the polling of the checkout return page, the invoice actions. No React here.

export type Cycle = 'monthly' | 'yearly';
export type PlanLike = { id: string; slug: string; priceMonthly: number; priceYearly: number; yearlyDiscountPct?: number };
export type SubscriptionLike = {
  plan: PlanLike;
  status: 'trial' | 'active' | 'dunning' | 'expired' | 'cancelled';
  billingCycle: 'monthly' | 'yearly' | 'none';
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  dunningStage: 'd_minus_7' | 'd0' | 'd_plus_3' | 'expired' | null;
  trialEndsAt: string | null;
  /** downgrade booked for the period end (SubscriptionDto.nextPlan) */
  nextPlan?: { id: string } | null;
};

export const isFreePlan = (p: Pick<PlanLike, 'priceMonthly' | 'priceYearly'>): boolean => p.priceMonthly <= 0 && p.priceYearly <= 0;
/** The cycle the page opens on: the subscription's own cycle, monthly otherwise. */
export const defaultCycle = (s: Pick<SubscriptionLike, 'billingCycle'> | null | undefined): Cycle => (s?.billingCycle === 'yearly' ? 'yearly' : 'monthly');
export const parseCycle = (v: string | null | undefined): Cycle | null => (v === 'monthly' || v === 'yearly' ? v : null);

/** Price of a plan for a cycle (integer DA): the yearly price is the full year. */
export const cyclePrice = (p: Pick<PlanLike, 'priceMonthly' | 'priceYearly'>, cycle: Cycle): number => (cycle === 'yearly' ? p.priceYearly : p.priceMonthly);
/** Figma shows the yearly plan as a monthly equivalent ("4 083 DA / MOIS · ANNUEL"), rounded to the DA. */
export const monthlyEquivalent = (p: Pick<PlanLike, 'priceMonthly' | 'priceYearly'>, cycle: Cycle): number => (cycle === 'yearly' ? Math.round(p.priceYearly / 12) : p.priceMonthly);
/** "−17 %" of the yearly price against 12 months (the server's `yearlyDiscountPct` wins when it is sent). */
export const yearlyDiscountPct = (p: PlanLike): number => {
  if (typeof p.yearlyDiscountPct === 'number' && p.yearlyDiscountPct > 0) return Math.round(p.yearlyDiscountPct);
  const full = p.priceMonthly * 12;
  return full > 0 && p.priceYearly < full ? Math.round(((full - p.priceYearly) * 100) / full) : 0;
};

/**
 * The yearly toggle's « −17 % »: the best yearly saving among the paid plans (0 ⇒ no figure). One label on Tarifs and on
 * Plan & facturation (journey 16/11 J01-11: « Annuel −17 % » vs « Annuel · −2 mois »).
 */
export const bestYearlyDiscount = (plans: readonly PlanLike[]): number => plans.reduce((best, p) => Math.max(best, p.priceMonthly > 0 ? yearlyDiscountPct(p) : 0), 0);

/** The subscription is a paid plan that renews (not the free plan, not a trial). */
export const isPaidSubscription = (s: SubscriptionLike): boolean => s.status !== 'trial' && !isFreePlan(s.plan) && s.billingCycle !== 'none';

/** Days before the period end from which "Renouveler" is offered (J−7, dunning R-J). */
export const RENEW_WINDOW_DAYS = 7;
export const daysLeft = (iso: string, now = Date.now()): number => Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000));
/** Renewal is a new checkout (no card on file): offered from J−7 and during dunning. */
export const canRenewNow = (s: SubscriptionLike, now = Date.now()): boolean => isPaidSubscription(s) && !s.cancelAtPeriodEnd && (s.dunningStage !== null || s.status === 'dunning' || daysLeft(s.currentPeriodEnd, now) <= RENEW_WINDOW_DAYS);
/** First day "Renouveler" opens (shown in its disabled reason). */
export const renewFrom = (s: Pick<SubscriptionLike, 'currentPeriodEnd'>): string => new Date(Date.parse(s.currentPeriodEnd) - RENEW_WINDOW_DAYS * 86_400_000).toISOString();

export type PlanCta =
  /** the free plan while on the free plan, or the plan of a scheduled change */
  | { kind: 'current' }
  /** free card while on a paid plan: cancel at period end */
  | { kind: 'cancel' }
  /** current paid plan inside the renewal window */
  | { kind: 'renew' }
  /** current paid plan before the window: disabled with the date */
  | { kind: 'renew_later'; from: string }
  /** current paid plan with a cancel / downgrade scheduled: undo */
  | { kind: 'resume' }
  /** any other paid plan: immediate upgrade (higher price) or change at period end (lower) */
  | { kind: 'change'; direction: 'upgrade' | 'downgrade' | 'subscribe' };

/**
 * What a plan card offers (BIL-01, 02 §5): upgrade = immediate; downgrade / cancel = at period end; the trial plan is
 * "subscribed" like any paid plan; the free card is the cancel entry while a paid plan runs.
 */
export function planCta(plan: PlanLike, sub: SubscriptionLike | null | undefined, cycle: Cycle, now = Date.now()): PlanCta {
  const free = isFreePlan(plan);
  if (!sub) return free ? { kind: 'current' } : { kind: 'change', direction: 'subscribe' };
  const onFree = isFreePlan(sub.plan) || sub.status === 'expired';
  const current = sub.plan.id === plan.id && sub.status !== 'expired';
  if (free) return onFree || sub.status === 'trial' ? { kind: 'current' } : sub.cancelAtPeriodEnd ? { kind: 'current' } : { kind: 'cancel' };
  if (sub.status === 'trial' || onFree) return { kind: 'change', direction: 'subscribe' };
  if (current && (sub.billingCycle === cycle || sub.billingCycle === 'none')) {
    if (sub.cancelAtPeriodEnd || sub.nextPlan) return { kind: 'resume' };
    return canRenewNow(sub, now) ? { kind: 'renew' } : { kind: 'renew_later', from: renewFrom(sub) };
  }
  const here = cyclePrice(plan, cycle);
  const mine = cyclePrice(sub.plan, sub.billingCycle === 'yearly' ? 'yearly' : 'monthly');
  // same plan, other cycle: monthly → yearly is a bigger commitment (upgrade), yearly → monthly waits for the period end
  if (current) return { kind: 'change', direction: cycle === 'yearly' ? 'upgrade' : 'downgrade' };
  const perMonth = (n: number, c: Cycle) => (c === 'yearly' ? n / 12 : n);
  return { kind: 'change', direction: perMonth(here, cycle) >= perMonth(mine, sub.billingCycle === 'yearly' ? 'yearly' : 'monthly') ? 'upgrade' : 'downgrade' };
}

/**
 * Journey J12r-1: what a `?change=<slug>` deep link (public Tarifs « Choisir ce plan », e-mails) does — the same as the card:
 * `dialog` = the change-plan dialog (upgrade / downgrade / subscribe / renew), `cancel` = the cancel dialog (free card on a
 * paid plan), `refuse` = nothing to open (the card is greyed: current plan, free plan during a trial, renewal not open yet,
 * a scheduled change to undo on the card) — the page says the card's reason instead of a payment dialog for 0 DA.
 */
export const deepLinkAction = (cta: PlanCta): 'dialog' | 'cancel' | 'refuse' => (cta.kind === 'change' || cta.kind === 'renew' ? 'dialog' : cta.kind === 'cancel' ? 'cancel' : 'refuse');

/* ---------- plan banners (shell + billing page) ---------- */
export type PlanBannerId = 'planExpired' | 'dunning' | 'planExpiring';
export type PlanState = {
  status: SubscriptionLike['status'];
  periodEnd: string;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  dunningStage?: SubscriptionLike['dunningStage'];
  expired?: { at: string; planName: string } | null;
  free?: boolean;
};
/** Days before the end from which "Votre plan expire dans n jours" is shown (J−7, `subscription.expiring`). */
export const EXPIRING_DAYS = 7;
/**
 * One plan banner at most: expired (free limits applied) > dunning (unpaid invoice) > expiring (trial or paid plan
 * ending in ≤ 7 days, not when the owner chose to cancel — the page says it instead).
 */
export function planBanner(p: PlanState | null | undefined, now = Date.now()): PlanBannerId | null {
  if (!p) return null;
  if (p.expired || p.status === 'expired') return 'planExpired';
  if (p.status === 'dunning' || (p.dunningStage && p.dunningStage !== 'd_minus_7' && p.dunningStage !== 'expired')) return 'dunning';
  if (p.free) return null;
  if (p.cancelAtPeriodEnd && p.status !== 'trial') return null;
  // the server marks J−7 of a paid plan with `dunningStage = d_minus_7`; a trial (or a plan without the stage yet) uses its end date
  if (p.dunningStage === 'd_minus_7') return 'planExpiring';
  const end = p.status === 'trial' ? (p.trialEndsAt ?? p.periodEnd) : p.periodEnd;
  if (end && Date.parse(end) > now && daysLeft(end, now) <= EXPIRING_DAYS) return 'planExpiring';
  return null;
}

/* ---------- checkout return page (FL-28: 5 s × 12) ---------- */
export const POLL_INTERVAL_MS = 5_000;
export const POLL_MAX = 12;
export type ReturnStatus = 'verifying' | 'success' | 'pending' | 'failed' | 'expired';
export type ReturnView = 'verifying' | 'success' | 'pending' | 'failed' | 'expired' | 'unknown';
/**
 * The state shown after `attempts` answers: the server's terminal states win; "verifying" (or "pending" before the
 * last attempt) keeps polling; after 12 attempts without an answer the page says EN ATTENTE (the webhook completes it).
 */
export function returnView(status: ReturnStatus | null | undefined, attempts: number, notFound = false): ReturnView {
  if (notFound) return 'unknown';
  if (status === 'success' || status === 'failed' || status === 'expired' || status === 'pending') return status;
  if (attempts >= POLL_MAX) return 'pending';
  return 'verifying';
}
/** Poll delay of the return page: 5 s while verifying; EN ATTENTE keeps a slow poll so a late webhook still flips it to SUCCÈS. */
export const PENDING_POLL_MS = 15_000;
export const pollDelay = (view: ReturnView): number | false => (view === 'verifying' ? POLL_INTERVAL_MS : view === 'pending' ? PENDING_POLL_MS : false);

/* ---------- invoices ---------- */
export type InvoiceLike = { status: 'upcoming' | 'unpaid' | 'paid' | 'void' | 'refunded'; remaining: number; pdfUrl: string | null };
/** "Payer maintenant" on unpaid invoices with something left to pay. */
export const canPayInvoice = (i: InvoiceLike): boolean => i.status === 'unpaid' && i.remaining > 0;
export const INVOICE_STATUSES = ['upcoming', 'unpaid', 'paid', 'void', 'refunded'] as const;
/** Pill suffix "PAYÉE · CIB" / "PAYÉE · MANUEL". */
export const methodGroup = (m: string | null | undefined): 'cib' | 'edahabia' | 'manual' | 'store' | null => {
  if (!m) return null;
  if (m === 'cib' || m === 'edahabia') return m;
  if (m.startsWith('manual')) return 'manual';
  if (m === 'google_play' || m === 'app_store') return 'store';
  return null;
};

/* ---------- calculator inputs (PCK-05) ---------- */
export type CalculatorInput = { conversations: number; photoPct: number; voicePct: number; msgsPerConv: number };
export const CALCULATOR_DEFAULT: CalculatorInput = { conversations: 1_200, photoPct: 15, voicePct: 8, msgsPerConv: 4 };
const clampInt = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : min);
/** Inputs kept in range before they reach the API: percentages 0–100, at least one message per conversation. */
export const normalizeCalculator = (i: CalculatorInput): CalculatorInput => ({
  conversations: clampInt(i.conversations, 0, 1_000_000),
  photoPct: clampInt(i.photoPct, 0, 100),
  voicePct: clampInt(i.voicePct, 0, 100),
  msgsPerConv: clampInt(i.msgsPerConv, 1, 200),
});
/**
 * Local estimate while the server answer is loading — the formula of `GET /credits/calculator` (AT-PCK-04):
 * `conversations × msgsPerConv × 1 + conversations × photoPct × 5 + conversations × voicePct × 3`
 * (1 200 × 4, 15 %, 8 % ⇒ 4 800 + 180 × 5 + 96 × 3 = 5 988).
 */
export function estimateCredits(i: CalculatorInput): { textTurns: number; imageTurns: number; voiceTurns: number; credits: number } {
  const n = normalizeCalculator(i);
  const textTurns = n.conversations * n.msgsPerConv;
  const imageTurns = Math.round((n.conversations * n.photoPct) / 100);
  const voiceTurns = Math.round((n.conversations * n.voicePct) / 100);
  return { textTurns, imageTurns, voiceTurns, credits: textTurns + imageTurns * 5 + voiceTurns * 3 };
}
