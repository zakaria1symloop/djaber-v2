// Agents & AI (03 §6–§7, api-contract §3.4 + §3.10, 06 "Agents & AI" + §8.7, 04-ai-pipeline).
// One source for the API (nestjs-zod DTOs) and the web. Field names = contract names. Messages = i18n keys.
import { z } from 'zod';
import {
  AgentStatusValues,
  AgentToneValues,
  CatalogScopeValues,
  CreditActionValues,
  CreditBucketValues,
  EmojiLevelValues,
  FormalityValues,
  InsightResolutionValues,
  InsightStatusValues,
  InsightTypeValues,
  OutOfStockBehaviorValues,
  PersonalityValues,
  RecapModeValues,
  RiskyClientBehaviorValues,
  TestScenarioKeyValues,
} from '../enums';
import type { ActionDescriptor } from './common';
import type { ChannelRefView } from './channels';

// --- limits (spec values: 03 AGT-02, AGV-02, 04-ai-pipeline) ---------------------------------------------------------------
export const AGENT_NAME_MAX = 100;
export const AGENT_INSTRUCTIONS_MAX = 10_000;
export const AGENT_HANDOFF_RULES_MAX = 5_000;
export const AGENT_CLOSING_MAX = 5_000;
export const AGENT_CARD_TEMPLATE_MAX = 5_000;
export const AGENT_POLICY_MAX = 500;
export const AGENT_FAQ_MAX_ENTRIES = 50;
export const AGENT_FAQ_MAX_CHARS = 20_000;
export const AGENT_RESPONSE_DELAY_MAX_S = 10;
export const AGENT_DEFAULT_MAX_AMOUNT = 50_000;
export const AGENT_HANDOFF_KEYWORDS_MAX = 30;
/** AGT-07: playground turns per hour per workspace (also per shared test link). */
export const PLAYGROUND_TURNS_PER_HOUR = 60;
export const PLAYGROUND_MAX_MESSAGES = 40;
export const AGENT_TEST_LINK_HOURS = 24;
/** 04-ai-pipeline §7: page analysis, agent generation, FAQ extraction, create-from-photo share 3 runs / day / workspace. */
export const ANALYSIS_RUNS_PER_DAY = 3;
/** 02 §6 / 04-ai-pipeline §7: credits per AI turn (highest applies). */
export const CREDIT_COST = { text: 1, voice: 3, image: 5, order: 0 } as const;
export const AGENT_LANGUAGES = ['darija', 'arabizi', 'fr', 'ar', 'kabyle', 'en'] as const;
export const ORDER_FIELD_KEYS = ['product', 'quantity', 'name', 'phone', 'wilaya', 'commune', 'address', 'phone2', 'note'] as const;
/** Fields the merchant cannot switch off (AGV-02 step 3 "verrouillé"). */
export const ORDER_FIELDS_LOCKED: readonly (typeof ORDER_FIELD_KEYS)[number][] = ['product', 'quantity', 'name', 'phone', 'wilaya'];
export const HANDOFF_RULE_KINDS = ['human_request', 'refund', 'complaint', 'anger', '3_unclear', 'off_topic', 'over_limits', 'risky_client', 'keyword'] as const;
export const AI_REPLY_STATUSES = ['OK', 'UNCLEAR', 'UNKNOWN', 'HANDOFF'] as const;
export const AI_REPLY_INTENTS = ['SALE', 'INFO', 'TRACKING', 'COMPLAINT', 'GREETING', 'OTHER'] as const;
export const AI_LANGUAGES = ['ar', 'arabizi', 'fr', 'en', 'mixed'] as const;
export const HANDOFF_REASONS = ['customer_request', 'refund', 'complaint', 'angry', 'unclear_streak', 'off_catalogue', 'order_limits', 'risky_client', 'keyword', 'other'] as const;

const id = z.string({ required_error: 'validation.required', invalid_type_error: 'validation.id' }).uuid('validation.id');
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item));
const flag = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const text = (max: number) => z.string({ invalid_type_error: 'validation.invalid' }).max(max, 'validation.length');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'validation.invalid');
const version = z.number({ required_error: 'validation.required', invalid_type_error: 'validation.invalid' }).int().min(1);
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

// --- wizard fields (05 §15, D54) ------------------------------------------------------------------------------------------
export const AgentPoliciesSchema = z
  .object({ delivery: text(AGENT_POLICY_MAX).optional(), payment: text(AGENT_POLICY_MAX).optional(), returns: text(AGENT_POLICY_MAX).optional(), hours: text(AGENT_POLICY_MAX).optional() })
  .strict();
export const AgentCapabilitiesSchema = z
  .object({ replyText: z.boolean(), imageRecognition: z.boolean(), voiceTranscription: z.boolean(), takeOrders: z.boolean(), quoteDelivery: z.boolean(), crossSell: z.boolean() })
  .strict();
export const AgentOrderFieldSchema = z.object({ key: z.enum(ORDER_FIELD_KEYS), required: z.boolean(), locked: z.boolean().optional() }).strict();
export const AgentHandoffRuleSchema = z.object({ kind: z.enum(HANDOFF_RULE_KINDS), enabled: z.boolean() }).strict();
export const AgentBusinessHoursSchema = z.object({ from: hhmm, to: hhmm, days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict();

const wizardShape = {
  displayName: text(AGENT_NAME_MAX).nullable(),
  avatarMode: z.enum(['page', 'upload', 'initials']),
  avatarUploadId: id.nullable(),
  languages: z.array(z.enum(AGENT_LANGUAGES)).max(AGENT_LANGUAGES.length),
  defaultLanguage: z.enum(AGENT_LANGUAGES).nullable(),
  tone: z.enum(AgentToneValues).nullable(),
  formality: z.enum(FormalityValues).nullable(),
  emojiLevel: z.enum(EmojiLevelValues).nullable(),
  catalogScope: z.enum(CatalogScopeValues),
  scopeCategoryIds: z.array(id).max(200),
  outOfStockBehavior: z.enum(OutOfStockBehaviorValues),
  showMissingVariants: z.boolean(),
  policies: AgentPoliciesSchema,
  capabilities: AgentCapabilitiesSchema,
  orderFields: z.array(AgentOrderFieldSchema).max(ORDER_FIELD_KEYS.length),
  maxQtyPerOrder: z.number().int().min(1).max(1000).nullable(),
  maxAmountPerOrder: z.number().int().min(1).max(100_000_000).nullable(),
  riskyClientBehavior: z.enum(RiskyClientBehaviorValues),
  recapMode: z.enum(RecapModeValues),
  handoffRules: z.array(AgentHandoffRuleSchema).max(HANDOFF_RULE_KINDS.length),
  handoffKeywords: z.array(z.string().trim().min(1).max(60)).max(AGENT_HANDOFF_KEYWORDS_MAX),
  businessHours: AgentBusinessHoursSchema.nullable(),
};
export const AgentWizardInputSchema = z.object(wizardShape).partial().strict();
export type AgentWizardInput = z.infer<typeof AgentWizardInputSchema>;

const agentCore = {
  name: z.string({ required_error: 'validation.required' }).trim().min(1, 'validation.required').max(AGENT_NAME_MAX, 'validation.length'),
  description: text(500).nullable(),
  personality: z.enum(PersonalityValues),
  customInstructions: text(AGENT_INSTRUCTIONS_MAX),
  productCardTemplate: text(AGENT_CARD_TEMPLATE_MAX).nullable(),
  closingInstructions: text(AGENT_CLOSING_MAX).nullable(),
  humanHandoffRules: text(AGENT_HANDOFF_RULES_MAX).nullable(),
  responseDelaySec: z.number().int().min(0).max(AGENT_RESPONSE_DELAY_MAX_S),
  sellAllProducts: z.boolean(),
  imageRecognition: z.boolean(),
  voiceTranscription: z.boolean(),
};

/** `POST /agents { presetKey | fromScratch, ...step1 }` → a draft (drafts never count toward `maxAgents`). */
export const CreateAgentSchema = z
  .object({
    presetKey: z.string().trim().min(1).max(60).optional(),
    fromScratch: z.boolean().optional(),
    name: agentCore.name.optional(),
    description: agentCore.description.optional(),
    wizard: AgentWizardInputSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.presetKey !== !!v.fromScratch, { message: 'validation.required', path: ['presetKey'] });
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

/** `PATCH /agents/:id` — a wizard step or a Configuration-tab save; `version` = optimistic lock (409 CONFLICT, merge by section). */
export const UpdateAgentSchema = z
  .object({
    ...Object.fromEntries(Object.entries(agentCore).map(([k, v]) => [k, v.optional()])),
    wizard: AgentWizardInputSchema.optional(),
    channelIds: z.array(id).max(50).optional(),
    /** move a channel that already belongs to another agent (AGT-05); without it ⇒ 409 AGENT_PAGE_ALREADY_ASSIGNED */
    move: z.boolean().optional(),
    productIds: z.array(id).max(5000).optional(),
    step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    note: text(200).optional(),
    version,
  })
  .strict() as unknown as z.ZodType<UpdateAgentInput>;
export type UpdateAgentInput = Partial<{
  name: string;
  description: string | null;
  personality: 'professional' | 'friendly' | 'casual' | 'technical';
  customInstructions: string;
  productCardTemplate: string | null;
  closingInstructions: string | null;
  humanHandoffRules: string | null;
  responseDelaySec: number;
  sellAllProducts: boolean;
  imageRecognition: boolean;
  voiceTranscription: boolean;
  wizard: AgentWizardInput;
  channelIds: string[];
  move: boolean;
  productIds: string[];
  step: 1 | 2 | 3 | 4 | 5;
  note: string;
}> & { version: number };

/** `GET /agents` (06 §10 "Agents"). */
export const AgentsQuerySchema = z
  .object({
    status: csv(z.enum(AgentStatusValues)).optional(),
    channelId: csv(id).optional(),
    modelId: csv(id).optional(),
    capabilities: csv(z.enum(['voice', 'image', 'orders'])).optional(),
    presetKey: csv(z.string().max(60)).optional(),
    activeDays: z.coerce.number().refine((v) => v === 7 || v === 30, 'validation.invalid').optional(),
    defaultLanguage: z.string().max(20).optional(),
    hasPendingInsights: flag.optional(),
    /** M11: agents whose catalogue scope includes this product ("Agents qui le vendent" on the product page) */
    productId: id.optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.enum(['lastActiveAt', '-lastActiveAt', 'name', '-name']).optional(),
    // the agents list is small (plan max 5): it is returned whole; page params of the shared list hook are accepted and ignored
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type AgentsQuery = z.infer<typeof AgentsQuerySchema>;

/** `POST /agents/:id/activate { at? }` — `at` schedules the activation. */
export const ActivateAgentSchema = z.object({ at: z.string().datetime({ offset: true, message: 'validation.date' }).optional() }).strict();
/** `POST /agents/:id/pause` — `confirm` acknowledges 409 AGENT_PAUSED_WITH_OPEN_THREADS. */
/** `POST /agents/:id/pause { confirm?, sendOutOfHours? }` — AGV-07 / AT-AGV-08: `sendOutOfHours` sends the workspace `out_of_hours` system message once to every open thread moved to « À traiter » (M11). */
export const PauseAgentSchema = z.object({ confirm: z.boolean().optional(), sendOutOfHours: z.boolean().default(false) }).strict();
export const AgentBulkSchema = z.object({ ids: z.array(id).min(1).max(100), confirm: z.boolean().optional() }).strict();
export const AgentMetricsQuerySchema = z.object({ from: day.optional(), to: day.optional() }).strict();
export const ApplyPresetUpdateSchema = z.object({ presetVersion: z.number().int().min(1) }).strict();
export const AgentVersionDiffQuerySchema = z.object({ against: z.coerce.number().int().min(1).optional() }).strict();

// --- FAQ ----------------------------------------------------------------------------------------------------------------
export const AgentFaqInputSchema = z
  .object({ question: z.string().trim().min(1, 'validation.required').max(300, 'validation.length'), answer: z.string().trim().min(1, 'validation.required').max(2000, 'validation.length'), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).optional() })
  .strict();
export type AgentFaqInput = z.infer<typeof AgentFaqInputSchema>;
export const AgentFaqUpdateSchema = AgentFaqInputSchema.partial();
export const FaqExtractSchema = z.object({ channelId: id }).strict();

// --- channels ↔ agents ------------------------------------------------------------------------------------------------------
/** `PUT /channels/:id/agent { agentId | null, move? }` (AGT-05 move dialog). */
export const SetChannelAgentSchema = z.object({ agentId: id.nullable(), move: z.boolean().optional() }).strict();
export type SetChannelAgentInput = z.infer<typeof SetChannelAgentSchema>;
/** `PUT /channels/:id/icebreaker { text }` — empty string clears it. */
export const IcebreakerSchema = z.object({ text: text(300) }).strict();

// --- insights (AGT-08) ----------------------------------------------------------------------------------------------------
export const InsightsQuerySchema = z
  .object({ ...paging, agentId: id.optional(), status: z.enum(InsightStatusValues).optional(), type: csv(z.enum(InsightTypeValues)).optional(), channelId: id.optional(), conversationId: id.optional(), from: day.optional(), to: day.optional(), groupByTopic: flag.optional() })
  .strict();
export type InsightsQuery = z.infer<typeof InsightsQuerySchema>;
/** `POST /agent-insights/:id/resolve` — the only insight-resolution endpoint [FIG DLG "Résoudre l'insight"]. */
export const ResolveInsightSchema = z
  .object({ action: z.enum(InsightResolutionValues), instruction: z.string().trim().min(1).max(500).optional(), question: z.string().trim().min(1).max(300).optional(), answer: z.string().trim().min(1).max(2000).optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === 'instruction' && !v.instruction) ctx.addIssue({ code: 'custom', message: 'validation.required', path: ['instruction'] });
    if (v.action === 'faq' && !v.question) ctx.addIssue({ code: 'custom', message: 'validation.required', path: ['question'] });
    if (v.action === 'faq' && !v.answer) ctx.addIssue({ code: 'custom', message: 'validation.required', path: ['answer'] });
  });
export type ResolveInsightInput = z.infer<typeof ResolveInsightSchema>;
export const BulkDismissInsightsSchema = z.object({ ids: z.array(id).min(1).max(200) }).strict();

// --- playground (AGT-07) -----------------------------------------------------------------------------------------------------
export const PlaygroundMessageSchema = z
  .object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000, 'validation.length').default(''), imageUploadId: id.optional(), audioUploadId: id.optional() })
  .strict();
export const PlaygroundTurnSchema = z
  .object({ sessionId: z.string().trim().min(1).max(80).optional(), messages: z.array(PlaygroundMessageSchema).max(PLAYGROUND_MAX_MESSAGES).default([]), scenario: z.enum(TestScenarioKeyValues).optional() })
  .strict()
  .refine((v) => !!v.scenario || (v.messages.length > 0 && v.messages[v.messages.length - 1]!.role === 'user'), { message: 'validation.required', path: ['messages'] });
export type PlaygroundTurnInput = z.infer<typeof PlaygroundTurnSchema>;
export const PlaygroundFlagSchema = z.object({ turnId: id, note: z.string().trim().max(500).optional() }).strict();
export const PlaygroundExportQuerySchema = z.object({ sessionId: z.string().trim().min(1).max(80) }).strict();
export const TestLinkSchema = z.object({ expiresInHours: z.number().int().min(1).max(AGENT_TEST_LINK_HOURS).default(AGENT_TEST_LINK_HOURS) }).strict();
/** Public shared playground: `POST /agent-test/:token/messages`. */
export const SharedTestMessageSchema = z
  .object({ text: z.string().trim().min(1, 'validation.required').max(2000, 'validation.length'), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }).strict()).max(PLAYGROUND_MAX_MESSAGES).optional() })
  .strict();

// --- generate from page (AGT-03) / page analysis (CHN-08) -----------------------------------------------------------------------
export const GenerateAgentSchema = z.object({ channelId: id, days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional() }).strict();
/** `POST /agents/generate/:jobId/apply { agentId?, confirm? }` — no `agentId` ⇒ a new agent; with it ⇒ update after confirmation. */
/**
 * `POST /agents/generate/:jobId/apply { agentId?, confirm?, override? }` — no `agentId` ⇒ a new agent; with it ⇒ update after
 * confirmation. M11: `override` = the review edited by the merchant before applying (instructions text, FAQ rows kept / edited,
 * policies); absent fields keep the proposal of `Job.result`.
 */
export const ApplyGenerationSchema = z
  .object({
    agentId: id.optional(),
    confirm: z.boolean().optional(),
    override: z
      .object({
        instructions: z.string().max(10_000, 'validation.length').optional(),
        faq: z.array(z.object({ q: z.string().trim().min(1, 'validation.required').max(500, 'validation.length'), a: z.string().trim().min(1, 'validation.required').max(2000, 'validation.length') }).strict()).max(100).optional(),
        policies: z.record(z.string().max(500, 'validation.length')).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const AnalysisImportItemSchema = z
  .object({
    name: z.string().trim().min(1, 'validation.required').max(255, 'validation.length'),
    description: z.string().max(5000, 'validation.length').nullable().optional(),
    price: z.number({ invalid_type_error: 'validation.price', required_error: 'validation.price' }).int('validation.price').gt(0, 'validation.price'),
    quantity: z.number({ invalid_type_error: 'validation.quantity', required_error: 'validation.quantity' }).int('validation.quantity').gt(0, 'validation.quantity'),
    category: z.string().trim().max(120).nullable().optional(),
    imageUrl: z.string().max(2000).nullable().optional(),
    /** the post it comes from: an imported post is never imported twice (A1) */
    postId: z.string().max(80).nullable().optional(),
    /** a service / digital offer: created without stock (A2) */
    isService: z.boolean().optional(),
  })
  .strict();
export const AnalysisImportSchema = z.object({ items: z.array(AnalysisImportItemSchema).min(1, 'validation.required').max(100, 'validation.length') }).strict();
export type AnalysisImportInput = z.infer<typeof AnalysisImportSchema>;

// --- credits (02 §6, api-contract §3.10) ----------------------------------------------------------------------------------------
export const LedgerQuerySchema = z
  .object({ ...paging, from: day.optional(), to: day.optional(), action: csv(z.enum(CreditActionValues)).optional(), agentId: id.optional(), bucket: z.enum(CreditBucketValues).optional() })
  .strict();
export type LedgerQuery = z.infer<typeof LedgerQuerySchema>;
export const CreditsCalculatorQuerySchema = z
  .object({ conversations: z.coerce.number().int().min(0).max(1_000_000), photoPct: z.coerce.number().min(0).max(100).default(0), voicePct: z.coerce.number().min(0).max(100).default(0), msgsPerConv: z.coerce.number().min(1).max(200).default(6) })
  .strict();

// --- read models (api-contract §3.4, §3.10) -------------------------------------------------------------------------------------
export type AgentStatusName = 'draft' | 'active' | 'paused';
export type AgentRefView = { id: string; name: string; status: AgentStatusName };
export type AgentUserRef = { id: string; firstName: string; lastName: string; avatarUrl: string | null };
export type AiIntentName = 'sale' | 'info' | 'tracking' | 'complaint' | 'greeting' | 'other';
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];
export type AgentOrderField = { key: (typeof ORDER_FIELD_KEYS)[number]; required: boolean; locked: boolean };
export type AgentHandoffRule = { kind: (typeof HANDOFF_RULE_KINDS)[number]; enabled: boolean };
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
export type AgentPolicies = z.infer<typeof AgentPoliciesSchema>;
export type AgentBusinessHours = z.infer<typeof AgentBusinessHoursSchema>;
export type AgentWizardFields = {
  displayName: string | null;
  avatarMode: 'page' | 'upload' | 'initials';
  avatarUrl: string | null;
  languages: AgentLanguage[];
  defaultLanguage: string | null;
  tone: 'warm' | 'professional' | 'casual' | 'premium' | null;
  formality: 'follow_customer' | 'tu' | 'vous' | null;
  emojiLevel: 'none' | 'moderate' | 'many' | null;
  catalogScope: 'all' | 'categories';
  scopeCategoryIds: string[];
  outOfStockBehavior: 'say_unavailable' | 'suggest_alternative';
  showMissingVariants: boolean;
  policies: AgentPolicies;
  faqCount: number;
  capabilities: AgentCapabilities;
  orderFields: AgentOrderField[];
  maxQtyPerOrder: number | null;
  maxAmountPerOrder: number | null;
  riskyClientBehavior: 'take_and_flag' | 'handoff';
  recapMode: 'always' | 'when_unsure';
  handoffRules: AgentHandoffRule[];
  handoffKeywords: string[];
  businessHours: AgentBusinessHours | null;
};
export type AgentModelBadge = { id: string; label: string; provider: string };
export type AgentMetrics = {
  conversations: number;
  handledWithoutHuman: number;
  orders: number;
  confirmedPct: number;
  delivered: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  credits: number;
  satisfaction: { score: number; votes: number } | null;
};
/** `GET /agents/:id/metrics?from&to` (AGT-09): the 30-day block plus the period's message / handoff counts. */
export type AgentMetricsDto = AgentMetrics & { from: string; to: string; aiMessages: number; handoffs: number; resolutionRate: number; lastActiveAt: string | null };
export type AgentDto = {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatusName;
  pausedReason: 'manual' | 'plan' | null;
  isActive: boolean;
  personality: 'professional' | 'friendly' | 'casual' | 'technical';
  customInstructions: string;
  productCardTemplate: string | null;
  closingInstructions: string | null;
  humanHandoffRules: string | null;
  model: AgentModelBadge;
  temperature: number;
  maxTokens: number;
  responseDelaySec: number;
  sellAllProducts: boolean;
  productCount: number;
  productIds?: string[];
  imageRecognition: boolean;
  voiceTranscription: boolean;
  channels: ChannelRefView[];
  preset: { key: string; name: string; version: number; updateAvailable: number | null } | null;
  currentVersion: number;
  lastActiveAt: string | null;
  scheduledActivateAt: string | null;
  wizardStep: number | null;
  wizard: AgentWizardFields | null;
  metrics30d: AgentMetrics;
  pendingInsights: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  actions: ActionDescriptor[];
};
export type AgentPresetDto = {
  key: string;
  name: string;
  tagline: string | null;
  description: string | null;
  badge: 'recommended' | 'popular' | 'beta' | null;
  version: number;
  personality: 'professional' | 'friendly' | 'casual' | 'technical';
  temperature: number;
  maxTokens: number;
  imageRecognition: boolean;
  voiceTranscription: boolean;
  responseDelaySec: number;
  instructions: string;
};
export type AgentVersionDto = { version: number; createdAt: string; createdBy: AgentUserRef; note: string | null; source: string; isCurrent: boolean; restoredFromVersion?: number | null };
export type AgentVersionDetailDto = AgentVersionDto & { snapshot: Record<string, unknown> };
export type AgentVersionDiffDto = { version: number; against: number; changes: { field: string; before: unknown; after: unknown }[] };
export type AgentReadinessCheck = { key: string; ok: boolean; label: string; count?: number; link?: string; blocking?: boolean };
export type AgentReadinessDto = { ready: boolean; checks: AgentReadinessCheck[] };
export type AgentFaqDto = { id: string; question: string; answer: string; source: 'manual' | 'page_extraction' | 'ai_suggested' | 'file_import'; askedCount: number | null; sortOrder: number; isActive: boolean; createdAt: string };
export type PlaygroundCard = { productId: string; name: string; price: number; imageUrl: string | null; variantLabel?: string | null };
export type PlaygroundToolCall = { name: string; args: unknown; result: unknown; simulated: boolean };
export type PlaygroundTurnDto = {
  turnId: string;
  sessionId: string;
  reply: string;
  status: (typeof AI_REPLY_STATUSES)[number];
  statusDetail: string | null;
  intent: AiIntentName;
  confidence: number;
  model: string;
  modelDetail: { id: string; temperature: number; maxTokens: number };
  tokens: { input: number; output: number };
  latencyMs: number;
  toolCalls: PlaygroundToolCall[];
  cards: PlaygroundCard[];
  creditsInProd: number;
  language: string;
  promptPreview: string[];
  promptSections: { key: string; chars: number }[];
  /** system texts the customer would also receive in production (welcome, out-of-hours, handoff) */
  systemMessages: { key: string; text: string }[];
};
export type AgentTestScenarioDto = { scenarioKey: (typeof TestScenarioKeyValues)[number]; status: 'pass' | 'fail' | 'error' | null; summary: string | null; at: string | null; agentVersion: number | null };
export type AgentTestLinkDto = { url: string; expiresAt: string };
export type SharedTestInfoDto = { agentName: string; avatarUrl: string | null; expiresAt: string };
export type SharedTestReplyDto = { reply: string; cards: PlaygroundCard[] };
export type AgentInsightDto = {
  id: string;
  agent: AgentRefView;
  type: 'unclear' | 'unknown_topic' | 'handoff' | 'error';
  customerMessage: string;
  aiResponse: string | null;
  detail: string | null;
  conversationId: string;
  messageId: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  resolution: 'instruction' | 'faq' | 'product' | 'ignored_30d' | null;
  topicKey: string | null;
  occurrences: number;
  channel: ChannelRefView | null;
  createdAt: string;
};
export type AiRunDto = {
  id: string;
  kind: string;
  status: string;
  intent: AiIntentName | null;
  model: string;
  provider: string;
  usedFallback: boolean;
  tokens: { input: number; output: number };
  latencyMs: number | null;
  confidence: number | null;
  credits: number;
  toolCalls: { name: string; args: unknown; result: unknown }[];
  error: string | null;
  startedAt: string;
};
export type AiRouteBadgeDto = { capability: 'text' | 'vision' | 'transcription' | 'embeddings'; model: AgentModelBadge; failover: boolean };
/** `Job.result` of `agent-generation` (04-ai-pipeline §14). */
export type AgentGenerationResult = {
  channelId: string;
  conversations: number;
  messages: number;
  summary: string;
  languages: { code: string; pct: number }[];
  topQuestions: { question: string; count: number }[];
  tone: string;
  proposedInstructions: string;
  proposedFaq: { q: string; a: string }[];
  proposedPolicies: AgentPolicies;
  linkedAgent: AgentRefView | null;
};
/** One row of the CHN-08 review grid (`Job.result.items[]` of `page-analysis`). */
/** `isService`: a service or a digital offer (no stock); `duplicateOf`: the catalogue product it already is (same post imported before, or the same / a very close name) */
export type AnalysisItem = { key: string; postId: string; name: string; description: string | null; price: number | null; category: string | null; imageUrl: string | null; duplicateOf: string | null; isService?: boolean };
export type AnalysisDto = {
  state: 'none' | 'permission_required' | 'running' | 'done' | 'failed';
  jobId: string | null;
  progress: number;
  postsTotal: number;
  postsDone: number;
  items: AnalysisItem[];
  startedAt: string | null;
  finishedAt: string | null;
  runsLeftToday: number;
  error: string | null;
};
export type AnalysisImportResult = { created: { key: string; productId: string; sku: string }[]; failed: { index: number; code: string; message: string }[] };

export type CreditsDto = {
  plan: { used: number; limit: number; remaining: number; periodStart: string; periodEnd: string };
  packs: { remaining: number };
  total: number;
  reserved: number;
  negative: boolean;
  exhausted: boolean;
  burnRatePerDay: number;
  exhaustedEta: string | null;
  pricePerCreditDzd: number;
  packPricePerCreditDzd: number | null;
};
export type CreditLedgerRowDto = { id: string; at: string; action: (typeof CreditActionValues)[number]; kind: 'reserved' | 'debit' | 'release' | 'credit'; bucket: 'plan' | 'pack'; credits: number; balanceAfter: number; detail: string; agent: AgentRefView | null; conversationId: string | null; aiRunId: string | null };
export type CreditsCalculatorDto = {
  conversations: number;
  textTurns: number;
  imageTurns: number;
  voiceTurns: number;
  credits: number;
  estimatedCostDzd: number;
  /** AT-BIL-07 "estimates per plan" and PCK-05 suggestion (smallest plan that covers the estimate, else the largest + packs) */
  plans?: import('./billing').CreditsCalculatorPlanRow[];
  suggestion?: import('./billing').CreditsCalculatorSuggestion | null;
};

// --- WebSocket payloads (03-events-and-jobs §2) ---------------------------------------------------------------------------------
/** `agent.updated` (room `ws:<workspaceId>`). */
export type AgentUpdatedEvent = { id: string; agent: { id: string; status: AgentStatusName; pausedReason: 'manual' | 'plan' | null; pendingInsights: number; version: number; deleted?: boolean } };
/** `agent.version_created` (api-contract §5). */
export type AgentVersionCreatedEvent = { agentId: string; version: number };
/** `credits.updated` (room `ws:<workspaceId>`): the header pill reads it. */
export type CreditsUpdatedEvent = { planUsed: number; planLimit: number; packBalance: number; exhausted: boolean };
