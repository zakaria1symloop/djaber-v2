// Pure helpers of the product page (CAT-09, MOD merchant side): moderation view state, stock summary line,
// refused-field labels, timeline tones. Unit tested (logic.spec.ts).
import type { Tone } from '@djaber/ui';
import type { ModerationDetail, Product } from '../contracts';

export type ModerationKind = 'none' | 'approved' | 'pending' | 'rejected' | 'appealed';
export type ModerationView = {
  kind: ModerationKind;
  submittedAt: string | null;
  decidedAt: string | null;
  /** `ModerationDecision` value (counterfeit, misleading…) */
  decision: string | null;
  message: string | null;
  rules: string[];
  rejectedFields: string[];
  history: ModerationDetail['history'];
  appeal: ModerationDetail['appeal'] | null;
  /** the one-shot appeal can still be sent */
  canAppeal: boolean;
};

const KINDS: Record<string, ModerationKind> = { approved: 'approved', pending: 'pending', rejected: 'rejected', appealed: 'appealed' };

/**
 * State of the "Validation Djaber" block from the product DTO: `moderationDetail` when present, the pill otherwise.
 * `appealSent` covers the moment between a successful appeal and the refreshed product.
 */
export function moderationView(p: Pick<Product, 'moderation' | 'moderationDetail'>, o: { appealSent?: boolean; now?: number } = {}): ModerationView {
  const d = p.moderationDetail ?? null;
  let kind = KINDS[d?.status ?? p.moderation?.status ?? ''] ?? 'none';
  if (kind === 'rejected' && (o.appealSent || d?.appeal?.status === 'used')) kind = 'appealed';
  const deadline = d?.appeal?.deadlineAt ? Date.parse(d.appeal.deadlineAt) : null;
  const open = d?.appeal ? d.appeal.status === 'available' && (deadline === null || Number.isNaN(deadline) || deadline > (o.now ?? Date.now())) : true;
  return {
    kind,
    submittedAt: d?.submittedAt ?? null,
    decidedAt: d?.decidedAt ?? null,
    decision: d?.decision ?? p.moderation?.reason ?? null,
    message: d?.merchantMessage ?? null,
    rules: d?.rules ?? [],
    rejectedFields: d?.rejectedFields ?? [],
    history: d?.history ?? [],
    appeal: d?.appeal ?? null,
    canAppeal: kind === 'rejected' && open,
  };
}

/** True when the appeal window of a rejected product is over (410 MODERATION_APPEAL_WINDOW_EXPIRED shown as a state). */
export const appealExpired = (v: ModerationView, now = Date.now()): boolean =>
  v.kind === 'rejected' && !!v.appeal && (v.appeal.status === 'expired' || (v.appeal.status === 'available' && !!v.appeal.deadlineAt && Date.parse(v.appeal.deadlineAt) <= now));

export type RejectedField = { field: 'title' | 'description' | 'price' | 'category' | 'image' | null; index: number | null; raw: string };
/** `name` → title, `images.0` / `image:1` → image n° (1-based), unknown names are kept verbatim. */
export function rejectedField(raw: string): RejectedField {
  const key = raw.trim().toLowerCase();
  const image = /^images?(?:[.:[\s#]+(\d+))?\]?$/.exec(key);
  if (image) {
    const n = image[1] === undefined ? null : Number(image[1]);
    // `images.0` is an index, `image:1` a position
    return { field: 'image', index: n === null ? null : key.startsWith('images.') || key.includes('[') ? n + 1 : Math.max(1, n), raw };
  }
  if (key === 'name' || key === 'title') return { field: 'title', index: null, raw };
  if (key === 'description') return { field: 'description', index: null, raw };
  if (key === 'price' || key === 'oldprice') return { field: 'price', index: null, raw };
  if (key === 'category' || key === 'categoryid') return { field: 'category', index: null, raw };
  return { field: null, index: null, raw };
}

/**
 * UX-059 (retest 12/11): the rules of a refusal in words (`auto_banned_word` → « mot interdit dans la fiche »). A rule
 * reference typed by a moderator (« 2.1 ») stays as written; a code nobody can name is left out.
 */
export function moderationRuleLabels(rules: readonly string[], t: { (key: string): string; has: (key: string) => boolean }): string[] {
  return rules
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const key = [`products.moderation.rule.${r}`, `products.moderation.decision.${r}`].find((k) => t.has(k));
      if (key) return t(key);
      return /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(r) ? null : r;
    })
    .filter((x): x is string => !!x);
}

/** Dot colour of a validation timeline entry. */
export const timelineTone = (status: string): Tone =>
  status === 'approved' || status === 'auto_approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'appealed' ? 'violet' : status === 'changes_requested' ? 'warning' : 'neutral';

export type StockSummary = { tracked: boolean; total: number; variants: number; alerts: number };
/** "16 u (3 variantes) · 4 en alerte": total units, active variants, variants (or the product itself) at or under their threshold. */
export function stockSummary(p: Pick<Product, 'trackStock' | 'hasVariants' | 'stock' | 'stockState' | 'variants' | 'stockDetail'>): StockSummary {
  if (!p.trackStock) return { tracked: false, total: 0, variants: 0, alerts: 0 };
  const active = p.hasVariants ? (p.variants ?? []).filter((v) => v.isActive) : [];
  const total = p.stockDetail?.total ?? p.stock ?? active.reduce((sum, v) => sum + v.stock, 0);
  const alerts = p.hasVariants ? active.filter((v) => v.stockState !== 'ok').length : p.stockState === 'low' || p.stockState === 'out' ? 1 : 0;
  return { tracked: true, total, variants: active.length, alerts };
}

type VariantDraft = { price: string; costPrice: string; minStock: string };
type VariantValues = { price: number; costPrice: number | null; minStock: number };
/** Changed fields of an inline variant edit (digits → numbers); `''` clears the cost, and is invalid for price / threshold. */
export function variantPatch(current: VariantValues, draft: VariantDraft, withCost: boolean): { patch: Partial<VariantValues>; errors: Partial<Record<keyof VariantValues, string>> } {
  const patch: Partial<VariantValues> = {};
  const errors: Partial<Record<keyof VariantValues, string>> = {};
  const price = draft.price === '' ? null : Number(draft.price);
  if (price === null || price <= 0) errors.price = 'validation.price';
  else if (price !== current.price) patch.price = price;
  const min = draft.minStock === '' ? null : Number(draft.minStock);
  if (min === null) errors.minStock = 'validation.quantity';
  else if (min !== current.minStock) patch.minStock = min;
  if (withCost) {
    const cost = draft.costPrice === '' ? null : Number(draft.costPrice);
    if (cost !== current.costPrice) patch.costPrice = cost;
  }
  return { patch, errors };
}

/**
 * UX-050 (10/11): a quantity in the product's own unit, in the app language (« 10 pc », « 10 قطعة », « 2 kg »); the
 * generic « u » (`generic`) only for a product without a unit.
 */
export const qtyText = (count: string, unit: { abbreviation: string } | null | undefined, generic: (count: string) => string): string =>
  unit?.abbreviation?.trim() ? `${count} ${unit.abbreviation.trim()}` : generic(count);
