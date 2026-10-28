// Pure logic of the agents module: the wizard draft (03 §30 AGV-02), per-step validation and checklist, the diff
// between two drafts (dirty sections of AGT-04, merge by section after a 409), the business-hours model, the credit
// estimate of the summary rail, and the view models of a playground turn and of a tool call (AGT-07).
import { AGENT_CARD_TEMPLATE_MAX, AGENT_CLOSING_MAX, AGENT_DEFAULT_MAX_AMOUNT, AGENT_HANDOFF_KEYWORDS_MAX, AGENT_NAME_MAX, AGENT_POLICY_MAX, AGENT_RESPONSE_DELAY_MAX_S, CREDIT_COST } from '@djaber/shared';
import type {
  Agent,
  AgentLanguage,
  AgentPreset,
  AgentWizardFields,
  BusinessHours,
  CapabilityKey,
  HandoffRuleKind,
  OrderFieldKey,
  PlaygroundTurn,
  Personality,
  PolicyKey,
  ToolCall,
  TurnCard,
  UpdateAgentBody,
  WizardStepKey,
} from './contracts';
import { CAPABILITY_KEYS, HANDOFF_RULES, ORDER_FIELDS, POLICY_KEYS, WIZARD_STEPS } from './contracts';

/* ---------- limits (spec values) ---------- */
export const NAME_MAX = AGENT_NAME_MAX;
export const DESCRIPTION_MAX = 500;
/** one shop rule (delivery, payment, returns, hours): short and factual */
export const POLICY_MAX = AGENT_POLICY_MAX;
export const TEMPLATE_MAX = AGENT_CARD_TEMPLATE_MAX;
export const CLOSING_MAX = AGENT_CLOSING_MAX;
export const KEYWORDS_MAX = AGENT_HANDOFF_KEYWORDS_MAX;
export const KEYWORD_MAX_LENGTH = 60;
export const DELAY_MIN = 0;
export const DELAY_MAX = AGENT_RESPONSE_DELAY_MAX_S;
export const QTY_MAX = 1_000;

/* ---------- steps ---------- */
export const stepIndex = (slug: WizardStepKey): 1 | 2 | 3 | 4 | 5 => (WIZARD_STEPS.indexOf(slug) + 1) as 1 | 2 | 3 | 4 | 5;
export const isStepSlug = (s: string | null | undefined): s is WizardStepKey => !!s && (WIZARD_STEPS as readonly string[]).includes(s);
export const stepSlug = (n: number | null | undefined): WizardStepKey => WIZARD_STEPS[Math.min(WIZARD_STEPS.length, Math.max(1, Math.trunc(n ?? 1))) - 1]!;
const STEP_LIST: readonly WizardStepKey[] = WIZARD_STEPS;
export const nextStep = (slug: WizardStepKey): WizardStepKey | null => STEP_LIST[stepIndex(slug)] ?? null;
export const previousStep = (slug: WizardStepKey): WizardStepKey | null => STEP_LIST[stepIndex(slug) - 2] ?? null;
/** Where "Reprendre" of a draft card leads: the step after the last saved one. */
export const resumePath = (a: Pick<Agent, 'id' | 'wizardStep'>): string => `/agents/new/${stepSlug((a.wizardStep ?? 0) + 1)}?draft=${a.id}`;
/** Steps reachable from the stepper: every step up to the one after the last saved step (back is always allowed). */
export const stepState = (slug: WizardStepKey, current: WizardStepKey, savedStep: number): 'done' | 'active' | 'upcoming' =>
  slug === current ? 'active' : stepIndex(slug) <= savedStep ? 'done' : 'upcoming';
export const canOpenStep = (slug: WizardStepKey, savedStep: number, hasDraft: boolean): boolean => stepIndex(slug) === 1 || (hasDraft && stepIndex(slug) <= savedStep + 1);

/* ---------- draft ---------- */
export type AgentDraft = {
  /** null = "De zéro" */
  presetKey: string | null;
  name: string;
  description: string;
  responseDelaySec: number;
  productCardTemplate: string;
  closingInstructions: string;
  /** id of a freshly uploaded picture (avatarMode = upload); null = keep what the agent has */
  avatarUploadId: string | null;
  /** preview only, never sent */
  avatarUrl: string | null;
} & Omit<AgentWizardFields, 'faqCount' | 'displayName' | 'avatarUrl' | 'defaultLanguage'> & { displayName: string; defaultLanguage: AgentLanguage | null };

const GROUPED: HandoffRuleKind[] = ['human_request', 'refund', 'complaint'];
const ALL_RULES: HandoffRuleKind[] = ['human_request', 'refund', 'complaint', 'anger', '3_unclear', 'off_topic', 'over_limits', 'risky_client', 'keyword'];

export const defaultDraft = (): AgentDraft => ({
  presetKey: null,
  name: '',
  description: '',
  responseDelaySec: 2,
  productCardTemplate: '',
  closingInstructions: '',
  displayName: '',
  avatarUploadId: null,
  avatarUrl: null,
  avatarMode: 'page',
  languages: ['darija', 'arabizi', 'fr', 'ar'],
  defaultLanguage: 'darija',
  tone: 'warm',
  formality: 'follow_customer',
  emojiLevel: 'moderate',
  catalogScope: 'all',
  scopeCategoryIds: [],
  outOfStockBehavior: 'suggest_alternative',
  showMissingVariants: true,
  policies: {},
  capabilities: { replyText: true, imageRecognition: true, voiceTranscription: true, takeOrders: true, quoteDelivery: true, crossSell: false },
  orderFields: ORDER_FIELDS.map((f) => ({ key: f.key, locked: f.locked, required: f.locked || f.key === 'commune' || f.key === 'address' })),
  // PV 28/10: no quantity limit by default (empty = ∞); the amount keeps its 50 000 DA suggestion
  maxQtyPerOrder: null,
  maxAmountPerOrder: AGENT_DEFAULT_MAX_AMOUNT,
  riskyClientBehavior: 'take_and_flag',
  recapMode: 'always',
  handoffRules: ALL_RULES.map((kind) => ({ kind, enabled: kind !== 'risky_client' && kind !== 'keyword' })),
  handoffKeywords: [],
  businessHours: null,
});

/** Server fields over the defaults: unknown or missing values never break the form. */
const applyWizard = (d: AgentDraft, w: Partial<AgentWizardFields> | null | undefined): AgentDraft => {
  if (!w) return d;
  const caps = { ...d.capabilities };
  for (const k of CAPABILITY_KEYS) if (typeof w.capabilities?.[k] === 'boolean') caps[k] = w.capabilities[k];
  const fields = new Map((w.orderFields ?? []).map((f) => [f.key, f]));
  const rules = new Map((w.handoffRules ?? []).map((r) => [r.kind, r.enabled]));
  return {
    ...d,
    displayName: w.displayName ?? d.displayName,
    avatarUrl: w.avatarUrl ?? d.avatarUrl,
    avatarMode: w.avatarMode ?? d.avatarMode,
    languages: w.languages?.length ? [...w.languages] : w.languages ? [] : d.languages,
    defaultLanguage: w.defaultLanguage === undefined ? d.defaultLanguage : ((w.defaultLanguage as AgentLanguage | null) ?? null),
    tone: w.tone === undefined ? d.tone : w.tone,
    formality: w.formality === undefined ? d.formality : w.formality,
    emojiLevel: w.emojiLevel === undefined ? d.emojiLevel : w.emojiLevel,
    catalogScope: w.catalogScope ?? d.catalogScope,
    scopeCategoryIds: w.scopeCategoryIds ? [...w.scopeCategoryIds] : d.scopeCategoryIds,
    outOfStockBehavior: w.outOfStockBehavior ?? d.outOfStockBehavior,
    showMissingVariants: w.showMissingVariants ?? d.showMissingVariants,
    policies: w.policies ? { ...w.policies } : d.policies,
    capabilities: caps,
    orderFields: d.orderFields.map((f) => (f.locked ? f : { ...f, required: fields.get(f.key)?.required ?? f.required })),
    maxQtyPerOrder: w.maxQtyPerOrder === undefined ? d.maxQtyPerOrder : w.maxQtyPerOrder,
    maxAmountPerOrder: w.maxAmountPerOrder === undefined ? d.maxAmountPerOrder : w.maxAmountPerOrder,
    riskyClientBehavior: w.riskyClientBehavior ?? d.riskyClientBehavior,
    recapMode: w.recapMode ?? d.recapMode,
    // the server default switches every rule on; a keyword rule without any keyword does nothing: it is shown off
    handoffRules: d.handoffRules.map((r) => ({ kind: r.kind, enabled: r.kind === 'keyword' && !(w.handoffKeywords ?? d.handoffKeywords).length ? false : (rules.get(r.kind) ?? r.enabled) })),
    handoffKeywords: w.handoffKeywords ? [...w.handoffKeywords] : d.handoffKeywords,
    businessHours: w.businessHours === undefined ? d.businessHours : w.businessHours ? { ...w.businessHours, days: [...w.businessHours.days] } : null,
  };
};

export const draftFromAgent = (a: Agent): AgentDraft =>
  applyWizard(
    {
      ...defaultDraft(),
      presetKey: a.preset?.key ?? null,
      name: a.name,
      description: a.description ?? '',
      responseDelaySec: a.responseDelaySec,
      productCardTemplate: a.productCardTemplate ?? '',
      closingInstructions: a.closingInstructions ?? '',
      capabilities: { ...defaultDraft().capabilities, imageRecognition: a.imageRecognition, voiceTranscription: a.voiceTranscription },
    },
    a.wizard,
  );

/** Starting point of step 1: the preset fills its defaults; the name keeps what the merchant already typed. */
const TONE_OF: Record<Personality, AgentDraft['tone']> = { friendly: 'warm', professional: 'professional', casual: 'casual', technical: 'professional' };
export const draftFromPreset = (preset: AgentPreset | null, keep?: Pick<AgentDraft, 'name' | 'description' | 'displayName'>): AgentDraft => {
  const base = defaultDraft();
  const d: AgentDraft = preset
    ? {
        ...base,
        presetKey: preset.key,
        tone: TONE_OF[preset.personality] ?? base.tone,
        responseDelaySec: preset.responseDelaySec ?? base.responseDelaySec,
        capabilities: { ...base.capabilities, imageRecognition: preset.imageRecognition, voiceTranscription: preset.voiceTranscription, crossSell: preset.personality === 'technical' },
      }
    : base;
  return { ...d, name: keep?.name ?? '', description: keep?.description || (preset?.tagline ?? ''), displayName: keep?.displayName ?? '' };
};

/* ---------- sections (wizard steps 1–3 = sections of the Configuration tab) ---------- */
export const SECTIONS = ['identity', 'knowledge', 'behaviour'] as const;
export type SectionKey = (typeof SECTIONS)[number];
const SECTION_FIELDS: Record<SectionKey, (keyof AgentDraft)[]> = {
  identity: ['name', 'description', 'displayName', 'avatarMode', 'avatarUploadId', 'languages', 'defaultLanguage', 'tone', 'formality', 'emojiLevel'],
  knowledge: ['catalogScope', 'scopeCategoryIds', 'outOfStockBehavior', 'showMissingVariants', 'policies'],
  behaviour: ['capabilities', 'orderFields', 'maxQtyPerOrder', 'maxAmountPerOrder', 'riskyClientBehavior', 'recapMode', 'handoffRules', 'handoffKeywords', 'businessHours', 'responseDelaySec', 'productCardTemplate', 'closingInstructions'],
};
const TOP_LEVEL = new Set<keyof AgentDraft>(['name', 'description', 'responseDelaySec', 'productCardTemplate', 'closingInstructions']);

const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x === undefined ? null : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

export type FieldChange = { field: keyof AgentDraft; section: SectionKey; before: unknown; after: unknown };
/** Field-level diff between the saved agent and the edited draft. */
export const diffDraft = (base: AgentDraft, draft: AgentDraft): FieldChange[] => {
  const out: FieldChange[] = [];
  for (const section of SECTIONS) for (const field of SECTION_FIELDS[section]) if (!same(trimmed(base[field]), trimmed(draft[field]))) out.push({ field, section, before: base[field], after: draft[field] });
  return out;
};
export const dirtySections = (base: AgentDraft, draft: AgentDraft): SectionKey[] => SECTIONS.filter((s) => diffDraft(base, draft).some((c) => c.section === s));

const nullable = (s: string) => (s.trim() ? s.trim() : null);
/** Body of `PATCH /agents/:id` for the given sections (the server compiles the prompt fields at every save). */
export const sectionsPatch = (draft: AgentDraft, sections: readonly SectionKey[]): Omit<UpdateAgentBody, 'version'> => {
  const body: Omit<UpdateAgentBody, 'version'> = {};
  const wizard: Record<string, unknown> = {};
  for (const section of sections) {
    for (const field of SECTION_FIELDS[section]) {
      if (field === 'name') body.name = draft.name.trim();
      else if (field === 'description') body.description = nullable(draft.description);
      else if (field === 'responseDelaySec') body.responseDelaySec = draft.responseDelaySec;
      else if (field === 'productCardTemplate') body.productCardTemplate = nullable(draft.productCardTemplate);
      else if (field === 'closingInstructions') body.closingInstructions = nullable(draft.closingInstructions);
      else if (field === 'displayName') wizard.displayName = nullable(draft.displayName);
      else if (field === 'avatarUploadId') {
        if (draft.avatarMode === 'upload' && draft.avatarUploadId) wizard.avatarUploadId = draft.avatarUploadId;
      }
      else if (field === 'capabilities') {
        wizard.capabilities = draft.capabilities;
        body.imageRecognition = draft.capabilities.imageRecognition;
        body.voiceTranscription = draft.capabilities.voiceTranscription;
      } else if (field === 'orderFields') wizard.orderFields = draft.orderFields.map((f) => ({ key: f.key, required: f.locked ? true : f.required }));
      else if (field === 'policies') wizard.policies = Object.fromEntries(POLICY_KEYS.map((k) => [k, draft.policies[k]?.trim() ?? '']).filter(([, v]) => v));
      else if (!TOP_LEVEL.has(field)) wizard[field] = draft[field];
    }
  }
  if (Object.keys(wizard).length) body.wizard = wizard as UpdateAgentBody['wizard'];
  return body;
};

/**
 * 409 on the Configuration tab, "Recharger": the sections this tab edited keep their values, the others take the
 * fresh ones (merge by section, api-contract §1.8).
 */
export const mergeBySection = (mine: AgentDraft, base: AgentDraft, theirs: AgentDraft): AgentDraft => {
  const dirty = new Set(dirtySections(base, mine));
  const out: Record<string, unknown> = { ...theirs };
  for (const section of SECTIONS) if (dirty.has(section)) for (const field of SECTION_FIELDS[section]) out[field] = mine[field];
  return out as AgentDraft;
};

/* ---------- business hours ---------- */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minutesOf = (hhmm: string): number => (HHMM.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : Number.NaN);
/** `null` when valid; otherwise the i18n key of the problem. */
export const validateSchedule = (s: BusinessHours | null): string | null => {
  if (!s) return null;
  if (!s.days.length) return 'agents.validation.hoursDays';
  if (s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'agents.validation.hoursDays';
  const from = minutesOf(s.from);
  const to = minutesOf(s.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return 'agents.validation.hoursFormat';
  if (from >= to) return 'agents.validation.hoursOrder';
  return null;
};
/** Is the instant (minutes of the day + weekday, in the shop time zone) inside the business hours? No hours = always. */
export const withinHours = (s: BusinessHours | null, weekday: number, minutes: number): boolean => !s || (s.days.includes(weekday) && minutes >= minutesOf(s.from) && minutes < minutesOf(s.to));
/** "9h–20h" (fr) / "09:00–20:00" */
export const hoursLabel = (s: BusinessHours): string => `${s.from}–${s.to}`;

/* ---------- validation ---------- */
export type Issue = { field: string; key: string; params?: Record<string, string | number> };
const tooLong = (field: string, value: string, max: number): Issue[] => (value.trim().length > max ? [{ field, key: 'agents.validation.tooLong', params: { max } }] : []);

export const validateIdentity = (d: AgentDraft): Issue[] => {
  const out: Issue[] = [];
  if (!d.name.trim()) out.push({ field: 'name', key: 'agents.validation.nameRequired' });
  out.push(...tooLong('name', d.name, NAME_MAX), ...tooLong('displayName', d.displayName, NAME_MAX), ...tooLong('description', d.description, DESCRIPTION_MAX));
  if (!d.languages.length) out.push({ field: 'languages', key: 'agents.validation.languageRequired' });
  else if (d.defaultLanguage && !d.languages.includes(d.defaultLanguage)) out.push({ field: 'defaultLanguage', key: 'agents.validation.defaultLanguage' });
  return out;
};
export const validateKnowledge = (d: AgentDraft): Issue[] => {
  const out: Issue[] = [];
  if (d.catalogScope === 'categories' && !d.scopeCategoryIds.length) out.push({ field: 'scopeCategoryIds', key: 'agents.validation.categoryRequired' });
  for (const k of POLICY_KEYS) out.push(...tooLong(`policies.${k}`, d.policies[k] ?? '', POLICY_MAX));
  return out;
};
export const validateBehaviour = (d: AgentDraft): Issue[] => {
  const out: Issue[] = [];
  if (d.maxQtyPerOrder !== null && (!Number.isInteger(d.maxQtyPerOrder) || d.maxQtyPerOrder < 1 || d.maxQtyPerOrder > QTY_MAX)) out.push({ field: 'maxQtyPerOrder', key: 'agents.validation.qtyMin', params: { max: QTY_MAX } });
  if (d.maxAmountPerOrder !== null && (!Number.isInteger(d.maxAmountPerOrder) || d.maxAmountPerOrder < 1)) out.push({ field: 'maxAmountPerOrder', key: 'agents.validation.amountMin' });
  if (ruleOn(d, 'keyword') && !d.handoffKeywords.length) out.push({ field: 'handoffKeywords', key: 'agents.validation.keywordRequired' });
  if (d.handoffKeywords.length > KEYWORDS_MAX) out.push({ field: 'handoffKeywords', key: 'agents.validation.keywordsMax', params: { max: KEYWORDS_MAX } });
  const hours = validateSchedule(d.businessHours);
  if (hours) out.push({ field: 'businessHours', key: hours });
  if (!Number.isInteger(d.responseDelaySec) || d.responseDelaySec < DELAY_MIN || d.responseDelaySec > DELAY_MAX) out.push({ field: 'responseDelaySec', key: 'agents.validation.delay', params: { min: DELAY_MIN, max: DELAY_MAX } });
  out.push(...tooLong('productCardTemplate', d.productCardTemplate, TEMPLATE_MAX), ...tooLong('closingInstructions', d.closingInstructions, CLOSING_MAX));
  return out;
};
export const validateSection = (section: SectionKey, d: AgentDraft): Issue[] => (section === 'identity' ? validateIdentity(d) : section === 'knowledge' ? validateKnowledge(d) : validateBehaviour(d));
/** Steps 4 and 5 have no draft field: channels are linked one by one, activation is checked by the server. */
export const validateStep = (step: WizardStepKey, d: AgentDraft): Issue[] => (step === 'identity' || step === 'knowledge' || step === 'behaviour' ? validateSection(step, d) : []);
export const issueMap = (issues: Issue[]): Record<string, Issue> => Object.fromEntries([...issues].reverse().map((i) => [i.field, i]));

/* ---------- handoff rules: the first checkbox of the frame groups three kinds ---------- */
export const ruleOn = (d: Pick<AgentDraft, 'handoffRules'>, kind: HandoffRuleKind): boolean => d.handoffRules.find((r) => r.kind === kind)?.enabled ?? false;
export const setRule = (d: AgentDraft, kind: HandoffRuleKind, enabled: boolean): AgentDraft['handoffRules'] => {
  const kinds = kind === 'human_request' ? GROUPED : [kind];
  return d.handoffRules.map((r) => (kinds.includes(r.kind) ? { ...r, enabled } : r));
};
/** Rules as drawn (7 rows): the grouped one counts once. */
export const enabledRuleCount = (d: Pick<AgentDraft, 'handoffRules'>): number => HANDOFF_RULES.filter((k) => ruleOn(d, k)).length;
export const setOrderField = (d: AgentDraft, key: OrderFieldKey, required: boolean): AgentDraft['orderFields'] => d.orderFields.map((f) => (f.key === key && !f.locked ? { ...f, required } : f));

/* ---------- checklist & summary of the right rail ---------- */
export const policyCount = (d: Pick<AgentDraft, 'policies'>): number => POLICY_KEYS.filter((k: PolicyKey) => (d.policies[k] ?? '').trim()).length;
export const enabledCapabilities = (d: Pick<AgentDraft, 'capabilities'>): CapabilityKey[] => CAPABILITY_KEYS.filter((k) => d.capabilities[k]);
export type StepChecklist = { step: WizardStepKey; done: boolean; issues: number };
/** One line per step: is it filled without error? (channels: at least one page linked.) */
export const wizardChecklist = (d: AgentDraft, o: { savedStep: number; channelCount: number }): StepChecklist[] =>
  WIZARD_STEPS.map((step) => {
    const issues = validateStep(step, d).length;
    const n = stepIndex(step);
    const done = step === 'channels' ? o.channelCount > 0 : step === 'activate' ? false : issues === 0 && o.savedStep >= n;
    return { step, done, issues };
  });

/**
 * Credit estimate of the rail (AGT-02): 1 credit per text reply, a photo (5) or a voice note (3) in about one
 * conversation out of twenty when the capability is on ⇒ "≈ 1,4 crédit / conversation".
 */
export const PHOTO_COST = CREDIT_COST.image;
export const VOICE_COST = CREDIT_COST.voice;
const MEDIA_SHARE = 0.05;
export const creditsPerConversation = (d: Pick<AgentDraft, 'capabilities'>): number =>
  Math.round((1 + (d.capabilities.imageRecognition ? PHOTO_COST * MEDIA_SHARE : 0) + (d.capabilities.voiceTranscription ? VOICE_COST * MEDIA_SHARE : 0)) * 100) / 100;
/** Rounded to the nearest hundred above 1 000 ("≈ 1 700 crédits / mois"). */
export const monthlyCreditEstimate = (d: Pick<AgentDraft, 'capabilities'>, conversationsPerMonth: number): number => {
  const raw = creditsPerConversation(d) * Math.max(0, conversationsPerMonth);
  return raw >= 1_000 ? Math.round(raw / 100) * 100 : Math.round(raw);
};

/* ---------- live preview (step 1) ---------- */
const EMOJI = /[\p{Extended_Pictographic}️]/gu;
/** The sample reply of the default language with the emoji level applied. */
export const previewReply = (sample: string, emojiLevel: AgentDraft['emojiLevel']): string => {
  if (emojiLevel === 'none') return sample.replace(EMOJI, '').replace(/ {2,}/g, ' ').trim();
  if (emojiLevel === 'many') return `${sample} 🙏✨`;
  return sample;
};
export const previewLanguage = (d: Pick<AgentDraft, 'languages' | 'defaultLanguage'>): AgentLanguage => (d.defaultLanguage && d.languages.includes(d.defaultLanguage) ? d.defaultLanguage : (d.languages[0] ?? 'fr'));

/* ---------- AGENT_DRAFT_INCOMPLETE {missing[]} ---------- */
/** Readiness rows that block the activation (✕): their labels name what to fix in the disabled reason of "Activer". */
export const blockingChecks = <C extends { ok: boolean; blocking?: boolean }>(checks: readonly C[] | undefined): C[] => (checks ?? []).filter((c) => !!c.blocking && !c.ok);

/** `datetime-local` value of a date in the browser's time zone (`min` of "Activer à une date"): `2031-01-15T10:30`. */
export const localDateTimeInput = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const missingKeys = (params: Record<string, unknown> | undefined, details: unknown): string[] => {
  const raw = (details as { missing?: unknown } | null)?.missing ?? params?.missing;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

/* ---------- playground view models ---------- */
const compact = (v: unknown, depth = 0): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return depth === 0 ? v : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => compact(x, depth + 1)).join(', ')}]`;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return '{}';
  return `{ ${entries.map(([k, x]) => `${k}: ${compact(x, depth + 1)}`).join(', ')} }`;
};
export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export type ToolCallView = { name: string; simulated: boolean; failed: boolean; args: string; result: string };
/** `{ query: "robe satin" }` / `→ { count: 3, … }` as drawn in AGT-07; a write tool in dry-run is flagged simulated. */
export const toolCallView = (c: ToolCall): ToolCallView => {
  const r = c.result as { ok?: boolean; error?: unknown; simulated?: boolean } | null;
  const failed = !!r && typeof r === 'object' && (r.ok === false || (r.error !== undefined && r.error !== null));
  return { name: c.name, simulated: c.simulated === true || (!!r && typeof r === 'object' && r.simulated === true), failed, args: clip(compact(c.args ?? {}, 1), 400), result: clip(compact(c.result), 600) };
};

export type TurnView = {
  reply: string;
  status: PlaygroundTurn['status'];
  intent: string;
  confidence: number;
  model: string;
  tokens: { input: number; output: number };
  latencyMs: number;
  tools: ToolCallView[];
  simulatedTools: number;
  cards: { id: string; name: string; price: number; imageUrl: string | null; variants: string | null }[];
  creditsInProd: number;
  language: string;
  prompt: string[];
  systemMessages: { key: string; text: string }[];
  turnId: string | null;
};
const cardView = (c: TurnCard, i: number) => ({ id: c.productId ?? String(i), name: c.name, price: c.price, imageUrl: c.imageUrl ?? null, variants: c.variantLabel ?? null });
/** One shape for the screen whatever the spelling of the server (api-contract §3.4 `PlaygroundTurnDto` / 04 §8). */
export const turnView = (t: PlaygroundTurn): TurnView => {
  const tools = (t.toolCalls ?? []).map(toolCallView);
  return {
    reply: t.reply ?? '',
    status: t.status,
    intent: String(t.intent ?? 'other').toUpperCase(),
    confidence: typeof t.confidence === 'number' ? t.confidence : 0,
    model: t.model ?? '',
    tokens: { input: t.tokens?.input ?? 0, output: t.tokens?.output ?? 0 },
    latencyMs: t.latencyMs ?? 0,
    tools,
    simulatedTools: tools.filter((x) => x.simulated).length,
    cards: (t.cards ?? []).map(cardView),
    creditsInProd: t.creditsInProd ?? 0,
    language: t.language ?? '',
    prompt: t.promptPreview?.length ? t.promptPreview : (t.promptSections ?? []).map((s) => `${s.key} · ${s.chars}`),
    systemMessages: t.systemMessages ?? [],
    turnId: t.turnId ?? null,
  };
};
/** "0,97" (fr / ar) · "0.97" (en) */
export const confidenceLabel = (c: number, locale: string): string => {
  const s = (Math.round(c * 100) / 100).toFixed(2);
  return locale === 'en' ? s : s.replace('.', ',');
};
/** "2,3 s" */
export const secondsLabel = (ms: number | null | undefined, locale: string): string => {
  if (ms === null || ms === undefined) return '—';
  const s = (Math.round(ms / 100) / 10).toFixed(1);
  return `${locale === 'en' ? s : s.replace('.', ',')} s`;
};
export const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'info' => {
  const s = status.toUpperCase();
  return s === 'OK' ? 'success' : s === 'HANDOFF' ? 'warning' : s === 'UNCLEAR' || s === 'UNKNOWN' ? 'info' : 'danger';
};

/* ---------- list helpers ---------- */
export type AgentCardState = 'active' | 'paused' | 'paused_plan' | 'draft';
export const cardState = (a: Pick<Agent, 'status' | 'pausedReason'>): AgentCardState => (a.status === 'paused' ? (a.pausedReason === 'plan' ? 'paused_plan' : 'paused') : a.status);
/** `maxAgents` counts active + paused agents; drafts never count (AGT-01). */
export const limitReached = (planLimit: { limit: number; current: number } | null | undefined): boolean => !!planLimit && planLimit.limit >= 0 && planLimit.current >= planLimit.limit;
export const countedAgents = (rows: Pick<Agent, 'status'>[]): number => rows.filter((a) => a.status !== 'draft').length;
/** "87 %" of conversations handled without a human. */
export const handledPct = (m: { conversations: number; handledWithoutHuman: number }): number | null => (m.conversations > 0 ? Math.round((m.handledWithoutHuman * 100) / m.conversations) : null);
export const creditsPerConv = (m: { conversations: number; credits: number }): number | null => (m.conversations > 0 ? Math.round((m.credits * 10) / m.conversations) / 10 : null);
