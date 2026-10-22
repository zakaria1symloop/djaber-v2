// ADM-10 pure rules of the screen (no business decision: the API decides, these only map the URL and format values).
import type { ActionDescriptor, ModerationItemDto, ModerationStatsDto } from '@djaber/shared';
import { MODERATION_AUTO_APPROVE_SCORE } from '@djaber/shared';
import type { ApiQuery, ListSpec } from '@/lib/list-state';

export const MOD_TABS = ['todo', 'urgent', 'appeals', 'sample', 'rejected', 'prompts'] as const;
export type ModTab = (typeof MOD_TABS)[number];

/** URL state: tab, search, filters with the API names (AdminModerationQuery), the reviewed item in `sheet`. */
export const MOD_SPEC: ListSpec = {
  filters: { aiFlag: 'list', scoreMin: 'text', scoreMax: 'text', trustLevel: 'list', categoryId: 'text', waitingOver: 'int' },
  sorts: ['urgency', 'submittedAt'],
  defaultSort: 'urgency',
  tabs: MOD_TABS.filter((t) => t !== 'todo'),
};

export const tabOf = (tab: string | null): ModTab => (tab && (MOD_TABS as readonly string[]).includes(tab) ? (tab as ModTab) : 'todo');

/** Query preset of a tab (contract-b ADM-10, merged over the URL filters). The appeals and sample tabs read their own endpoints. */
export function tabQuery(tab: ModTab): ApiQuery {
  switch (tab) {
    case 'urgent':
      return { status: ['pending'], priority: 'urgent' };
    case 'rejected':
      return { status: ['rejected', 'appeal_rejected'], sort: '-submittedAt' };
    case 'prompts':
      return { type: ['agent_prompt'] };
    case 'appeals':
      return { status: 'pending' };
    case 'sample':
      return {};
    default:
      return { status: ['pending'] };
  }
}

/** Tab counts from the KPIs (the sample tab carries no count in the frame). */
export function tabCount(tab: ModTab, s: ModerationStatsDto | undefined): number | null {
  if (!s) return null;
  switch (tab) {
    case 'todo':
      return s.pending;
    case 'urgent':
      return s.urgent;
    case 'appeals':
      return s.appealsPending;
    case 'rejected':
      return s.rejected7d;
    case 'prompts':
      return s.agentPrompts;
    default:
      return null;
  }
}

/** Score buckets of the "Score ⌄" filter (scoreMin / scoreMax, 0–1). */
export const SCORE_BUCKETS = [
  { key: 'low', min: '0', max: '0.3' },
  { key: 'mid', min: '0.3', max: '0.7' },
  { key: 'high', min: '0.7', max: '0.9' },
  { key: 'auto', min: '0.9', max: '1' },
] as const;
export const scoreBucketOf = (min: string, max: string) => SCORE_BUCKETS.find((b) => b.min === min && b.max === max)?.key ?? null;

/** "Attente ⌄" presets in minutes since submission. */
export const WAITING_PRESETS = [30, 60, 120, 240, 1440] as const;

/** `0,31` (fr / ar use the comma, en the dot); null ⇒ "—". */
export function formatScore(score: number | null, locale: string): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  const s = score.toFixed(2);
  return locale === 'en' ? s : s.replace('.', ',');
}
/** Every score under the auto-approval threshold is drawn red in the frame; at or over it, green. */
export const scoreTone = (score: number | null): 'danger' | 'success' | undefined => (score === null ? undefined : score >= MODERATION_AUTO_APPROVE_SCORE ? 'success' : 'danger');

/** "2 h 40" — waiting time in hours and minutes (Latin digits, no day unit: the SLA is counted in hours). */
export function formatWaiting(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** "38 min" under one hour, "1 h 05" above; null ⇒ "—". */
export function formatDelay(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—';
  return minutes < 60 ? `${Math.round(minutes)} min` : formatWaiting(minutes);
}

/** State of a decision for this row: the server descriptor when present, otherwise the role + status. */
export function decisionState(item: Pick<ModerationItemDto, 'status' | 'actions'>, key: string, canWrite: boolean): { enabled: boolean; reasonCode?: string } {
  const d: ActionDescriptor | undefined = item.actions?.find((a) => a.key === key || a.key === key.replace('-', '_'));
  if (!canWrite) return { enabled: false, reasonCode: 'FORBIDDEN' };
  if (d) return { enabled: d.enabled, reasonCode: d.enabled ? undefined : d.reasonCode };
  const open = item.status === 'pending' || item.status === 'changes_requested';
  return open ? { enabled: true } : { enabled: false, reasonCode: 'MODERATION_ITEM_ALREADY_DECIDED' };
}

/** Fields the moderator may mark as refused (names read by the merchant rejected view: `name`, `image:1`…). */
export function refusableFields(item: Pick<ModerationItemDto, 'product'>): string[] {
  if (!item.product) return [];
  const fields = ['name', 'description', 'price', 'category'];
  item.product.images.forEach((_, i) => fields.push(`image:${i + 1}`));
  return fields;
}
/**
 * Default refused fields = the fields the AI flagged (`aiFlags[].field`) and the flagged images. A flag on the images as a
 * whole (`field: 'images'`, e.g. `single_image`, `logo_in_image`) names no picture, so it pre-ticks none: only the image
 * carrying its own flag is pre-ticked.
 */
export function flaggedFields(item: Pick<ModerationItemDto, 'aiFlags' | 'product'>): string[] {
  const out = new Set<string>();
  // `variants` / `keywords` (PV1 keyword hits) are shown as evidence but are not refusable fields of the merchant view
  for (const f of item.aiFlags) if (f.field && !/^(images?|variants|keywords)$/i.test(f.field.trim())) out.add(normaliseField(f.field));
  item.product?.images.forEach((img, i) => {
    if (img.flag) out.add(`image:${i + 1}`);
  });
  return [...out];
}
/** `title` → `name`, `images.0` → `image:1` (same vocabulary as the merchant side). */
export function normaliseField(raw: string): string {
  const k = raw.trim().toLowerCase();
  const img = /^images?(?:[.:[\s#]+(\d+))?\]?$/.exec(k);
  if (img) {
    const n = img[1] === undefined ? 1 : Number(img[1]);
    return `image:${k.startsWith('images.') || k.includes('[') ? n + 1 : Math.max(1, n)}`;
  }
  if (k === 'title') return 'name';
  if (k === 'categoryid') return 'category';
  return k;
}

/** Price vs market reference: −87 % (integer, rounded half up); null when no reference. */
export function priceGapPct(price: number, reference: number | null): number | null {
  if (!reference || reference <= 0) return null;
  return Math.round(((price - reference) / reference) * 100);
}

export type ReviewDraft = { decision: string | null; message: string; fields: string[] };
/** Client-side check before a reject: a reason and a message are required (the API answers MODERATION_REASON_REQUIRED too). */
export function rejectReady(d: ReviewDraft): boolean {
  return !!d.decision && d.message.trim().length > 0;
}
