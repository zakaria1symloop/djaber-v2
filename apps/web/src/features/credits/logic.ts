// Pure logic of the credits module (02 §6, 04-ai-pipeline §7): the level of the header pill and of the meter
// (80 % ⇒ amber, 100 % ⇒ red), the shell banner to show, the cached balance patched by a `credits.updated` event,
// and the display helpers of a ledger row.
import type { CreditsLevel } from '@djaber/ui';
import type { Credits, LedgerAction, LedgerRow, WsCreditsUpdated } from './contracts';

export const WARNING_PCT = 80;

/** Share of the plan credits consumed, 0–100 (0 when the plan has no credits). */
export const usedPct = (used: number, limit: number): number => (limit > 0 ? Math.max(0, Math.min(100, Math.floor((used * 100) / limit))) : 0);

/**
 * `exhausted` is the server truth (plan used up AND no pack left); without it the plan ratio decides.
 * A pack balance keeps the AI running after the plan credits: the level then stays "warning", not "exhausted".
 */
export const creditsLevel = (used: number, limit: number, exhausted?: boolean | null): CreditsLevel => {
  if (exhausted === true) return 'exhausted';
  if (limit <= 0) return 'ok';
  if (used >= limit) return exhausted === false ? 'warning' : 'exhausted';
  return used * 100 >= limit * WARNING_PCT ? 'warning' : 'ok';
};
export const levelOf = (c: Pick<Credits, 'plan' | 'exhausted'>): CreditsLevel => creditsLevel(c.plan.used, c.plan.limit, c.exhausted);

export type CreditsBannerId = 'negativeCredits' | 'credits100' | 'credits80';
/** One banner at most: a negative balance blocks the AI whatever the rest; then exhausted; then the 80 % warning. */
export const creditsBanner = (c: Pick<Credits, 'plan' | 'exhausted' | 'negative'> | null | undefined): CreditsBannerId | null => {
  if (!c) return null;
  if (c.negative) return 'negativeCredits';
  const level = levelOf(c);
  return level === 'exhausted' ? 'credits100' : level === 'warning' ? 'credits80' : null;
};
/** Date shown by the 80 % banner: the projected exhaustion when the server gives one, otherwise the end of the period. */
export const warningDate = (c: Pick<Credits, 'plan' | 'exhaustedEta'>): string => c.exhaustedEta ?? c.plan.periodEnd;

/** WS `credits.updated { planUsed, planLimit, packBalance, exhausted }` applied to the cached `GET /credits`. */
export const applyCreditsEvent = (old: Credits, e: WsCreditsUpdated): Credits => {
  const used = e.planUsed ?? old.plan.used;
  const limit = e.planLimit ?? old.plan.limit;
  const packs = e.packBalance ?? old.packs.remaining;
  const remaining = Math.max(0, limit - used);
  return {
    ...old,
    plan: { ...old.plan, used, limit, remaining },
    packs: { ...old.packs, remaining: packs },
    total: remaining + Math.max(0, packs),
    exhausted: e.exhausted ?? old.exhausted,
    negative: packs < 0 ? true : e.packBalance === undefined ? old.negative : false,
  };
};

/** Packs tile: the pack balance, or the (negative) total after a store refund — the API keeps `packs.remaining ≥ 0`. */
export const packsShown = (c: Pick<Credits, 'packs' | 'total' | 'negative'>): number => (c.negative && c.total < 0 ? c.total : c.packs.remaining);

/**
 * Recette 11/11 (Badro, M-31): bought pack credits left, shown after the plan figure of the top-bar pill
 * (« 2 000 / 2 000 + 5 000 ») — before, a pack only changed the pill's colour. Never negative (a debt is the banner's job).
 */
export const packLeft = (c: Pick<Credits, 'packs'> | null | undefined): number => Math.max(0, c?.packs.remaining ?? 0);
/** The plan of the month is used up while packs keep the AI running: the banner says so instead of « 80 % ». */
export const runningOnPacks = (c: Pick<Credits, 'plan' | 'packs' | 'exhausted'> | null | undefined): boolean => !!c && !c.exhausted && c.plan.limit > 0 && c.plan.used >= c.plan.limit && packLeft(c) > 0;

/* ---------- ledger rows ---------- */
/** "−5" / "+500" / "0" — a real minus sign; `format` groups the thousands. */
export const signedCredits = (n: number, format: (abs: number) => string): string => (n > 0 ? `+${format(n)}` : n < 0 ? `−${format(-n)}` : '0');
export const creditsTone = (n: number): 'success' | 'neutral' => (n > 0 ? 'success' : 'neutral');
/** Rows that only book a reservation (and its release): drawn muted, they do not change what was consumed. */
export const isBookkeeping = (r: Pick<LedgerRow, 'kind' | 'action'>): boolean => r.kind === 'reserved' || r.kind === 'release' || r.action === 'reserve' || r.action === 'release';
const KNOWN: ReadonlySet<string> = new Set<LedgerAction>(['text_reply', 'image_recognition', 'voice_transcription', 'reserve', 'release', 'renewal', 'pack_purchase', 'grant', 'store_refund', 'adjustment']);
/** i18n key of the action pill; a value this build does not know is shown as sent. */
export const actionLabelKey = (action: string): string | null => (KNOWN.has(action) ? `enum.CreditLedger.action.${action}` : null);

/** "0,98" (fr / ar) · "0.98" (en) — price of one credit in DA. */
export const pricePerCredit = (n: number | null | undefined, locale: string): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return locale === 'en' ? s : s.replace('.', ',');
};
/** Whole credits per day, at least 1 when something is consumed. */
export const burnRate = (perDay: number): number => (perDay > 0 ? Math.max(1, Math.round(perDay)) : 0);

/* ---------- ledger filters (URL ⇄ API) ---------- */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A period typed backwards is put in order instead of answering an empty list. */
export const orderedRange = (from: string, to: string): { from: string; to: string } => (DAY.test(from) && DAY.test(to) && from > to ? { from: to, to: from } : { from, to });
