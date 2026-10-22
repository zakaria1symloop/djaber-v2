// Read model of an agent (api-contract §3.4 `AgentDto`), the wizard columns (05 §15, D54), their defaults, the version
// snapshot and the server-side compilation of the style block into `customInstructions`.
import { HANDOFF_RULE_KINDS, ORDER_FIELD_KEYS, ORDER_FIELDS_LOCKED, type AgentCapabilities, type AgentHandoffRule, type AgentMetrics, type AgentOrderField, type AgentPolicies, type AgentWizardFields } from '@djaber/shared';
import type { Agent, Prisma } from '@djaber/db';

export const DEFAULT_CAPABILITIES: AgentCapabilities = { replyText: true, imageRecognition: true, voiceTranscription: true, takeOrders: true, quoteDelivery: true, crossSell: true };
export const DEFAULT_ORDER_FIELDS: AgentOrderField[] = ORDER_FIELD_KEYS.map((key) => ({ key, required: key !== 'phone2' && key !== 'note', locked: ORDER_FIELDS_LOCKED.includes(key) }));
export const DEFAULT_HANDOFF_RULES: AgentHandoffRule[] = HANDOFF_RULE_KINDS.map((kind) => ({ kind, enabled: true }));
export const EMPTY_METRICS: AgentMetrics = { conversations: 0, handledWithoutHuman: 0, orders: 0, confirmedPct: 0, delivered: 0, avgLatencyMs: 0, p95LatencyMs: 0, credits: 0, satisfaction: null };

const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback);
const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);

/** Locked fields are always required, every known field is present, in the canonical order. */
export const normalizeOrderFields = (input: { key: string; required: boolean }[] | undefined | null): AgentOrderField[] =>
  ORDER_FIELD_KEYS.map((key) => {
    const locked = ORDER_FIELDS_LOCKED.includes(key);
    const given = input?.find((f) => f.key === key);
    return { key, required: locked ? true : (given?.required ?? DEFAULT_ORDER_FIELDS.find((d) => d.key === key)!.required), locked };
  });
export const normalizeHandoffRules = (input: AgentHandoffRule[] | undefined | null): AgentHandoffRule[] => HANDOFF_RULE_KINDS.map((kind) => ({ kind, enabled: input?.find((r) => r.kind === kind)?.enabled ?? true }));

export const wizardOf = (a: Agent, o: { avatarUrl: string | null; faqCount: number }): AgentWizardFields => ({
  displayName: a.displayName,
  avatarMode: a.avatarMode === 'page' || a.avatarMode === 'upload' ? a.avatarMode : 'initials',
  avatarUrl: o.avatarUrl,
  languages: a.languages as AgentWizardFields['languages'],
  defaultLanguage: a.defaultLanguage,
  tone: a.tone,
  formality: a.formality,
  emojiLevel: a.emojiLevel,
  catalogScope: a.catalogScope,
  scopeCategoryIds: a.scopeCategoryIds,
  outOfStockBehavior: a.outOfStockBehavior,
  showMissingVariants: a.showMissingVariants,
  policies: obj<AgentPolicies>(a.policies, {}),
  faqCount: o.faqCount,
  capabilities: { ...DEFAULT_CAPABILITIES, ...obj<Partial<AgentCapabilities>>(a.capabilities, {}), imageRecognition: a.imageRecognition, voiceTranscription: a.voiceTranscription },
  orderFields: normalizeOrderFields(arr<AgentOrderField>(a.orderFields, [])),
  maxQtyPerOrder: a.maxQtyPerOrder,
  maxAmountPerOrder: a.maxAmountPerOrder,
  riskyClientBehavior: a.riskyClientBehavior ?? 'take_and_flag',
  recapMode: a.recapMode ?? 'always',
  handoffRules: normalizeHandoffRules(arr<AgentHandoffRule>(a.handoffRules, [])),
  handoffKeywords: a.handoffKeywords,
  businessHours: a.businessHours && typeof a.businessHours === 'object' ? (a.businessHours as unknown as AgentWizardFields['businessHours']) : null,
});

// --- compilation (AGT-02: "compiled server-side at every save") -----------------------------------------------------------------
// The prompt sections read the structured columns themselves (policies, order fields, limits, handoff rules, hours).
// What has no section of its own — languages, tone, formality, emojis — is compiled into a generated block kept at the
// top of `customInstructions`; the merchant's own text follows it and is the only part the API shows and edits.
const AUTO_START = '[STYLE — generated from the agent settings, do not edit]';
const AUTO_END = '[/STYLE]';
const TONE: Record<string, string> = { warm: 'warm and welcoming', professional: 'professional and precise', casual: 'casual and relaxed', premium: 'refined, premium-brand tone' };
const FORMALITY: Record<string, string> = { follow_customer: 'mirror the customer (tu / vous)', tu: 'informal "tu"', vous: 'formal "vous"' };
const EMOJI: Record<string, string> = { none: 'never use emojis', moderate: 'at most one emoji per message', many: 'emojis are welcome' };
const LANG: Record<string, string> = { darija: 'Algerian darija (Arabic script)', arabizi: 'darija in Latin script (arabizi)', fr: 'French', ar: 'Arabic', kabyle: 'Kabyle', en: 'English' };

/**
 * Instructions of a preset version for a locale (tester report 2026-10-21 UX-008): a blank translation is a missing one —
 * the French prompt (then any filled one) is used, not an empty text that left the agent with its tone line only.
 */
export const presetInstructions = (locales: Record<string, { systemPrompt?: string } | undefined>, locale: string): string => {
  const filled = (l: string) => locales[l]?.systemPrompt?.trim() || '';
  return filled(locale) || filled('fr') || filled('en') || filled('ar');
};

export const merchantInstructions = (stored: string): string => {
  const start = stored.indexOf(AUTO_START);
  const end = stored.indexOf(AUTO_END);
  if (start < 0 || end < start) return stored;
  return (stored.slice(0, start) + stored.slice(end + AUTO_END.length)).replace(/^\s+/, '');
};
export const compileInstructions = (a: Pick<Agent, 'languages' | 'defaultLanguage' | 'tone' | 'formality' | 'emojiLevel'>, merchantText: string): string => {
  const lines: string[] = [];
  if (a.languages.length) lines.push(`- Languages the shop answers in: ${a.languages.map((l) => LANG[l] ?? l).join(', ')}${a.defaultLanguage ? `; when the customer language is unclear use ${LANG[a.defaultLanguage] ?? a.defaultLanguage}` : ''}. The LANGUAGE rule below still decides the language of each reply.`);
  if (a.tone) lines.push(`- Tone: ${TONE[a.tone] ?? a.tone}.`);
  if (a.formality) lines.push(`- Form of address: ${FORMALITY[a.formality] ?? a.formality}.`);
  if (a.emojiLevel) lines.push(`- Emojis: ${EMOJI[a.emojiLevel] ?? a.emojiLevel}.`);
  const own = merchantInstructions(merchantText).trim();
  return lines.length ? `${AUTO_START}\n${lines.join('\n')}\n${AUTO_END}${own ? `\n${own}` : ''}` : own;
};

// --- version snapshot (AGT-03) -----------------------------------------------------------------------------------------------------
export const SNAPSHOT_FIELDS = [
  'name', 'description', 'personality', 'productCardTemplate', 'closingInstructions', 'humanHandoffRules', 'responseDelaySec', 'sellAllProducts', 'imageRecognition', 'voiceTranscription',
  'displayName', 'avatarMode', 'avatarUploadId', 'languages', 'defaultLanguage', 'tone', 'formality', 'emojiLevel', 'catalogScope', 'scopeCategoryIds', 'outOfStockBehavior', 'showMissingVariants',
  'policies', 'capabilities', 'orderFields', 'maxQtyPerOrder', 'maxAmountPerOrder', 'riskyClientBehavior', 'recapMode', 'handoffRules', 'handoffKeywords', 'businessHours',
] as const satisfies readonly (keyof Agent)[];
export type AgentSnapshot = Record<string, unknown> & { customInstructions: string; productIds: string[] };

export const snapshotOf = (a: Agent, productIds: string[]): AgentSnapshot => ({
  ...Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, a[k] ?? null])),
  customInstructions: merchantInstructions(a.customInstructions),
  temperature: Number(a.temperature),
  maxTokens: a.maxTokens,
  presetVersion: a.presetVersion,
  productIds: [...productIds].sort(),
});
export const snapshotToData = (s: AgentSnapshot): Prisma.AgentUncheckedUpdateInput => {
  const data: Record<string, unknown> = {};
  for (const k of SNAPSHOT_FIELDS) if (k in s) data[k] = s[k] === null && (k === 'policies' || k === 'capabilities' || k === 'orderFields' || k === 'handoffRules' || k === 'businessHours') ? undefined : s[k];
  return data as Prisma.AgentUncheckedUpdateInput;
};
export const diffSnapshots = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
    .sort()
    .map((field) => ({ field, before: b[field] ?? null, after: a[field] ?? null }));

// --- server-side texts ----------------------------------------------------------------------------------------------------------------
/** i18n key of a server-rendered agents text (`packages/shared/src/i18n/messages/api-agents.*.json`, resolved by `I18nService`). */
export const agentTextKey = (key: string) => `agent.api.${key}`;
