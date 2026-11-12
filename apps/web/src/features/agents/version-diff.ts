// UX-059 (retest 12/11): the « Diff » of two agent versions in words — a field label instead of `PRODUCTCARDTEMPLATE`,
// values as the configuration screens name them (tone, languages, rules switched on…) instead of raw JSON.
import { formatMoney, formatNumber } from '@djaber/shared';
import type { TFunction } from '@/lib/i18n';

type T = Pick<TFunction, 'has'> & ((key: string, params?: Record<string, string | number>) => string);

/** Label of a snapshot field (`agents.field.<field>`), « Autre réglage » for a field this screen does not know. */
export const diffFieldLabel = (t: T, field: string): string => (t.has(`agents.field.${field}`) ? t(`agents.field.${field}`) : t('agents.field.other'));

/** i18n prefix of the values of the enum-like fields. */
const VALUE_KEYS: Record<string, string> = {
  tone: 'agents.tone',
  formality: 'agents.formality',
  emojiLevel: 'agents.emoji',
  defaultLanguage: 'agents.language',
  avatarMode: 'agents.identity.avatar',
  recapMode: 'agents.order.recap',
  riskyClientBehavior: 'agents.order.risky',
  catalogScope: 'agents.versions.value.catalogScope',
  outOfStockBehavior: 'agents.versions.value.outOfStock',
};
/** Lists of ids: shown as a count. */
const COUNTED = new Set(['productIds', 'scopeCategoryIds', 'channels', 'avatarUploadId']);
const LONG_TEXT = 160;

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
const clip = (s: string) => (s.length > LONG_TEXT ? `${s.slice(0, LONG_TEXT - 1)}…` : s);
const labelOf = (t: T, key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

/** A snapshot value as the merchant reads it; never JSON. */
export function diffValue(t: T, field: string, v: unknown): string {
  if (isEmpty(v)) return '—';
  if (typeof v === 'boolean') return t(v ? 'common.yes' : 'common.no');
  if (field === 'maxAmountPerOrder' && typeof v === 'number') return formatMoney(v);
  if (field === 'responseDelaySec' && typeof v === 'number') return `${formatNumber(v)} s`;
  if (typeof v === 'number') return formatNumber(v);
  if (COUNTED.has(field)) return Array.isArray(v) ? t('agents.versions.items', { count: v.length }) : t('agents.versions.modified');
  if (typeof v === 'string') {
    const prefix = VALUE_KEYS[field];
    if (prefix) return labelOf(t, `${prefix}.${v}`, t('agents.versions.modified'));
    return clip(v);
  }
  if (field === 'languages' && Array.isArray(v)) return v.map((l) => labelOf(t, `agents.language.${String(l)}`, String(l))).join(', ');
  // handoff rules: the rules switched on
  if (field === 'handoffRules' && Array.isArray(v)) {
    const on = v.filter((r) => r && typeof r === 'object' && (r as { enabled?: unknown }).enabled !== false).map((r) => String((r as { kind?: unknown }).kind ?? ''));
    return on.length ? on.map((k) => labelOf(t, `agents.handoff.rule.${k}`, t('agents.versions.modified'))).join(' · ') : '—';
  }
  // capabilities: the ones switched on
  if (field === 'capabilities' && typeof v === 'object' && !Array.isArray(v)) {
    const on = Object.entries(v as Record<string, unknown>).filter(([, x]) => x === true || (typeof x === 'object' && x !== null && (x as { enabled?: unknown }).enabled === true));
    return on.length ? on.map(([k]) => labelOf(t, `agents.capability.short.${k}`, t('agents.versions.modified'))).join(' · ') : '—';
  }
  // shop rules: their texts, each under its heading
  if (field === 'policies' && typeof v === 'object' && !Array.isArray(v)) {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => typeof x === 'string' && x.trim())
      .map(([k, x]) => `${labelOf(t, `agents.policies.${k}`, '')}${t.has(`agents.policies.${k}`) ? ' : ' : ''}${String(x).trim()}`);
    return parts.length ? clip(parts.join(' · ')) : '—';
  }
  // a list of words (keywords)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return clip(v.join(', '));
  return t('agents.versions.modified');
}
