// Pure logic of the public site (03 §36 PUB-01…06, 12 §27, route map §3.1): Markdown sections of the CMS bodies
// (feature blocks, FAQ), the vN-1 → vN diff of a legal page, the pricing cards (cycle prices, feature lines), the help
// centre query, the account-deletion page view. No React here.
import { HELP_CATEGORIES, type HelpCategory } from '@djaber/shared';
import { monthlyEquivalent, yearlyDiscountPct, type Cycle } from '@/features/billing/logic';
import type { Params } from '@/lib/format-message';

/* ---------- CMS Markdown ---------- */
export type MdSection = { title: string; body: string };

/** `## Title\n\nbody` blocks of a CMS body (features: 6 blocks, pricing FAQ: 5 questions). Text before the first `## ` is the intro. */
export function markdownSections(body: string | null | undefined): { intro: string; sections: MdSection[] } {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  const intro: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  for (const l of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m) sections.push({ title: m[1]!, lines: [] });
    else if (sections.length) sections[sections.length - 1]!.lines.push(l);
    else intro.push(l);
  }
  return { intro: intro.join('\n').trim(), sections: sections.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() })) };
}

/* ---------- version diff (PUB-03 "vN → vN+1 : diff") ---------- */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

const paragraphs = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|\n(?=#{1,6} )/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Paragraph-level LCS diff of two Markdown bodies (removed paragraphs before the added ones at each change). */
export function paragraphDiff(prev: string | null | undefined, next: string | null | undefined): DiffLine[] {
  const a = paragraphs(prev);
  const b = paragraphs(next);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: 'del', text: a[i++]! });
    else out.push({ kind: 'add', text: b[j++]! });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

export const diffHasChanges = (d: readonly DiffLine[]) => d.some((l) => l.kind !== 'same');

/* ---------- legal / CMS page keys (route map §3.1 `/legal/[key]`) ---------- */
/** The legal documents (`LegalDocKey`) + the CMS legal pages linked from the footer, in footer order. */
/** Header links of the public site (PUB-01): Fonctionnalités · Tarifs · Aide · Statut. */
export const PUBLIC_NAV = [
  { key: 'public.nav.features', href: '/features' },
  { key: 'public.nav.pricing', href: '/pricing' },
  { key: 'public.nav.help', href: '/help-center' },
  { key: 'public.nav.status', href: '/status' },
] as const;
export const LEGAL_FOOTER_KEYS = ['terms', 'privacy', 'cookies', 'content_rules', 'data-deletion'] as const;
/** CMS keys are slugs (same rule as the API's `CMS_SLUG_INVALID`) — anything else is a 404 without an API call. */
export const isCmsKey = (k: string) => k.length <= 80 && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(k);
/** Types a public `/legal/:key` page renders (PUB-03: `CmsEntry(type legal|help|page)`). */
export const PUBLIC_CMS_TYPES = ['legal', 'help', 'page'] as const;

/* ---------- pricing (PUB-02) ---------- */
export type PublicPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  yearlyDiscountPct?: number;
  trialDays: number;
  isFeatured: boolean;
  limits: { maxPages: number; maxAgents: number; maxProducts: number; maxConversationsPerMonth: number; maxMembers: number; monthlyCredits: number; features: string[] };
};
export type PublicPack = { id: string; priceWebDzd: number; credits: number };

/** "−17 %" of the yearly toggle: the best yearly saving among the paid plans (0 ⇒ no label). */
export const bestYearlyDiscount = (plans: readonly PublicPlan[]): number => plans.reduce((best, p) => Math.max(best, p.priceMonthly > 0 ? yearlyDiscountPct(p) : 0), 0);

export const isFree = (p: Pick<PublicPlan, 'priceMonthly' | 'priceYearly'>) => p.priceMonthly <= 0 && p.priceYearly <= 0;
/** Big numeral of a card: monthly price, or the monthly equivalent of the yearly price. */
export const cardPrice = (p: PublicPlan, cycle: Cycle) => (isFree(p) ? 0 : monthlyEquivalent(p, cycle));
/** Cheapest web credit pack ("packs à partir de 450 DA"); null when the list is empty. */
export const cheapestPack = (packs: readonly PublicPack[]): number | null => (packs.length ? Math.min(...packs.map((p) => p.priceWebDzd)) : null);

/** Feature groups of a public plan card, in the Figma order; a group shows the plan's features of that group joined by " · ". */
const FEATURE_GROUPS: readonly (readonly string[])[] = [
  ['voice_notes', 'image_recognition'],
  ['google_sheets', 'couriers'],
  ['advanced_stock', 'scheduled_reports'],
  ['api_keys', 'webhooks', 'priority_support'],
];

/**
 * Card lines (Figma "PUB — Pricing page"): credits / month · "pages · agents · members" · products · channels ·
 * then the feature groups the plan has. `t` returns the localized text of a key (keys `billing.plan.feature.*`,
 * `public.pricing.feature.*`).
 */
export function planLines(p: PublicPlan, t: (key: string, params?: Params) => string, n: (v: number) => string): string[] {
  const l = p.limits;
  const line = (v: number, key: string) => (v < 0 ? t(`billing.plan.feature.${key}.unlimited`) : t(`billing.plan.feature.${key}`, { count: v, value: n(v) }));
  const f = new Set(l.features);
  const out = [line(l.monthlyCredits, 'credits'), [line(l.maxPages, 'pages'), line(l.maxAgents, 'agents'), line(l.maxMembers, 'members')].join(' · '), line(l.maxProducts, 'products')];
  out.push(t(f.has('instagram') ? 'public.pricing.feature.channels.both' : 'public.pricing.feature.channels.messenger'));
  for (const g of FEATURE_GROUPS) {
    const have = g.filter((x) => f.has(x));
    if (have.length) out.push(have.map((x) => t(`public.pricing.feature.${x}`)).join(' · '));
  }
  return out;
}

/** `/signup` link of a card CTA (the plan and cycle travel with the visitor; the trial starts on sign-up, D60). */
export const signupHref = (p: Pick<PublicPlan, 'slug'>, cycle: Cycle) => `/signup?plan=${encodeURIComponent(p.slug)}&cycle=${cycle}`;
export const parseCycleParam = (v: string | string[] | undefined): Cycle => (v === 'yearly' ? 'yearly' : 'monthly');

/**
 * Plan picked on the pricing page, read back on `/signup?plan=&cycle=`. Every sign-up starts with the 14-day Pro trial
 * (D60), so the choice is only remembered and offered later (Plan & facturation `?change=<slug>&cycle=`); the free plan
 * and unknown slugs carry nothing.
 */
export type PlanIntent = { plan: string; cycle: Cycle };
export function planIntentOf(plan: string | null | undefined, cycle: string | null | undefined): PlanIntent | null {
  const slug = (plan ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(slug) || slug === 'free') return null;
  return { plan: slug, cycle: parseCycleParam(cycle ?? undefined) };
}
export const planIntentHref = (i: PlanIntent) => `/settings/billing?change=${encodeURIComponent(i.plan)}&cycle=${i.cycle}`;

/* ---------- public contact (visitors have no access to /help/contact, which needs a session) ---------- */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@djaber.ai';
export const supportMailto = (subject?: string, email: string = SUPPORT_EMAIL) => `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

/* ---------- help centre (PUB-04) ---------- */
export type HelpQuery = { q: string; category: HelpCategory | null };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
export function parseHelpQuery(sp: Record<string, string | string[] | undefined>): HelpQuery {
  const q = first(sp.q).trim().slice(0, 100);
  const c = first(sp.category);
  return { q, category: (HELP_CATEGORIES as readonly string[]).includes(c) ? (c as HelpCategory) : null };
}
/** The API searches from 2 characters (`validation.length` below). */
export const searchable = (q: string) => q.trim().length >= 2;
export const helpHref = (q: Partial<HelpQuery>) => {
  const p = new URLSearchParams();
  if (q.q) p.set('q', q.q);
  if (q.category) p.set('category', q.category);
  const s = p.toString();
  return s ? `/help-center?${s}` : '/help-center';
};

/* ---------- account deletion (PUB-06, FL-22) ---------- */
export type DeletionView = 'confirm' | 'grace' | 'blocked' | 'cancelled' | 'expired' | 'done';
export function deletionView(status: 'pending_confirmation' | 'grace' | 'blocked' | 'cancelled' | 'anonymised'): DeletionView {
  switch (status) {
    case 'pending_confirmation':
      return 'confirm';
    case 'grace':
      return 'grace';
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'done';
  }
}
/** Error codes of `POST /account-deletion/confirm/:token` that turn the page into its "blocked" state. */
export const BLOCKING_CODES = ['ACCOUNT_OWNS_WORKSPACE', 'WORKSPACE_HAS_DEBT', 'ACCOUNT_DELETION_PENDING'] as const;
export const isBlockingCode = (c: string): c is (typeof BLOCKING_CODES)[number] => (BLOCKING_CODES as readonly string[]).includes(c);
/** Tokens are base64url strings (anything else is an expired link without an API call). */
export const isDeletionToken = (t: string | null | undefined): t is string => !!t && /^[A-Za-z0-9_-]{20,100}$/.test(t);
/** Export polling: every 3 s while the job runs, stopped once it is done / failed. */
export const exportPollMs = (s: string | null | undefined): number | false => (s === 'queued' || s === 'running' ? 3000 : false);
