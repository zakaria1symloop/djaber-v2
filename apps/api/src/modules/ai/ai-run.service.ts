// 04-ai-pipeline §5 — idempotent runs.
//   start     one `AiRun` per (conversationId, batchKey): a retried job reuses the `running` run, a finished run is final
//   turn      the model loop (≤ 3 tool rounds + the answer). Every tool call is stored in `AiToolCall` BEFORE it runs
//             (`executedAt = null`), then its result; a retried job is re-prompted, asks for the same call and gets the
//             stored result back — the tool does not run twice (AT-AI-05)
//   finish    status, tokens, latency, model, cost, metrics (§13)
//   reaper    `sched-ai-run-reaper`: runs `running` for more than 5 min ⇒ `error('reaped')`, credits released
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { prisma, Prisma, TenantContext, type AiIntent, type AiRun, type AiRunKind, type AiRunStatus, type Tx } from '@djaber/db';
import { MetricsService } from '../../core/metrics/metrics.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { CreditService } from '../credits/credit.service';
import { GUARD_RETRY_MIN_MS, MAX_STEPS, RUN_REAP_AFTER_MS } from './ai.constants';
import type { BuiltPrompt } from './prompt/prompt-builder';
import { AI_GATEWAY, AiProviderError, type AiGateway, type AiMessage, type AiToolCallRequest, type AiToolDef, type AiUsage } from './provider/ai.gateway';
import { RoutingService, type RoutedModel } from './routing.service';
import { FORMAT_REMINDER, parseReplyOutput, salvageReply, type AiReplyOutput } from './structured-output';
import { canonicalTool, ToolRegistry, type ToolRunContext } from './tools/tool-registry';
import { allowedHandoffReasons, establishedReasons, fieldOnlyMessage, handoffRefusedInstruction, judgeHandoff, orderDetailsMessage, type HandoffRefusal } from './handoff-judge';
import { AUTO_FIX_RULES, checkReply, enforceReply, guardInstruction, quoteFacts, stripMarkdown, withToolResults, type GuardFacts, type GuardOutcome, type GuardViolation } from './reply-guard';
import { asksDelivery, blockedOrderText, deliveryAnswer, orderConfirmationText, pendingRecap, recapReply, withoutRecapClaims } from './tools/order-confirmation-text';
import { phonesIn } from './tools/order-confirmation';
import { matchWilaya } from './tools/tool-registry';
import { placeIndex, placeNamedIn, placeOnlyMessage, type PlaceIndex } from './tools/place-index';
import { contextOf } from '../messaging/messaging.presenter';
import { fillerMessage, noPhotoReply, noPhotoSaid, photoAsked, withoutPresenceTalk } from './reply-fixes';

/** journey retest R1-1: told to the model on a message that only gives an order field (handoff_to_human is not offered). */
export const FIELD_ONLY_NOTE =
  'THIS MESSAGE only gives an order field (a name, a phone number, a place, an address) or answers yes: record it and answer — ask the next missing field, or call create_order for the recap when every field is known. handoff_to_human is not available for this message.';
/**
 * journey retest R5-6 (17/11): told to the model when the customer has given no phone number in the conversation (and the client
 * record has none): create_order is not offered — it was still called as a probe (`create_order {}`, `{ clientName: "---",
 * clientPhone: "0500000000", wilayaId: 1 }`) to learn the missing fields.
 */
export const NO_PHONE_NOTE =
  'NO PHONE NUMBER YET: the customer has not given a phone number in this conversation, so create_order is not available in this turn. Answer the customer and ask the next missing order field (the phone once the product and the name are known) — never a recap.';
/**
 * journey retest R6-5 (17/11): told to the model when the customer's messages name no street address and no stop-desk yet (and
 * no recap was shown): create_order stays offered — an address without any of these words still goes through — but it was
 * called on « Sétif, El Eulma » with no address, as a probe (refused, VALIDATION address).
 */
export const NO_ADDRESS_NOTE =
  "NO ADDRESS YET: the customer's messages give no street address (rue, cité, bloc, building, landmark) and no stop-desk choice so far. Unless THIS message or KNOWN CUSTOMER gives it, do not call create_order: ask for the address in one short question (or offer the stop-desk).";
/**
 * journey retest R7-4 (17/11): told to the model when no wilaya (nor a commune of one) and no street address was given yet:
 * create_order is not offered — it was called on « Je voudrais le sac …, 1 seul. Karim Haddad 0770112233 » with `wilayaId 1`
 * (Adrar, never named), refused as `notGivenByCustomer`: without a wilaya the call can only be refused.
 */
export const NO_PLACE_NOTE =
  'NO WILAYA YET: the customer has not named their wilaya (nor a commune or an address) in this conversation, so create_order is not available in this turn. Answer the customer and ask the next missing order field (the wilaya once the product, the name and the phone are known) — never a recap, never a default wilaya.';
/**
 * journey retest R8-4 (17/11): told to the model on a message that only names the wilaya / commune while no street address was
 * given yet: create_order is not offered — F1b T2 « Sétif, El Eulma » ⇒ `create_order { items: [] }` without commune or address.
 */
export const NO_STREET_NOTE =
  'NO STREET ADDRESS YET: this message only names the wilaya / commune, and no street address (rue, cité, building, landmark) nor stop-desk was given, so create_order is not available in this turn. Ask for the street address in one short question, or offer the stop-desk — never a recap.';
/** journey retest R7-4: told to the model on a message that gives the order's details (handoff_to_human is not offered). */
export const ORDER_DETAILS_NOTE =
  "THIS MESSAGE gives the order's details (product, name, phone, place) and asks nothing of the team: take the order — ask the next missing field, or call create_order for the recap when every field is known. handoff_to_human is not available for this message.";
/** Words of a street address or of a stop-desk choice (accents removed, lower case), in any language. */
const ADDRESS_HINT =
  /(?<![\p{L}])(?:rue|cite|bloc|blk|bt|bat|batiment|villa|logements?|lgts?|logts?|n°|quartier|qrt|hay|hai|residence|lotissement|lot|route|rte|avenue|av|boulevard|bd|impasse|allee|douar|village|cooperative|coop|immeuble|imm|appartement|appt|apt|etage|pres|cote|derriere|face|mairie|poste|mosquee|jami3|djama3|ecole|lycee|marche|souk|9rib|qrib|janb|street|st|road|building|near|apartment|flat|floor|stop|stopdesk|desk|bureau|agence|relais|zan9a|zenqa|derb|حي|شارع|نهج|عمارة|عماره|بلوك|فيلا|مسكن|سكن|طريق|قرب|قريب|جنب|مقابل|حذا|بجانب|المسجد|الجامع|البلدية|البريد|المدرسة|السوق|زنقة|درب|دوار|قرية|اقامة|إقامة|الطابق|ستوب|مكتب|وكالة)(?![\p{L}])/u;
/** journey retest R6-5: no street address / stop-desk word in the customer's messages, and no create_order answer before. */
export const noAddressYet = (ctx: Pick<ToolRunContext, 'customerHistory' | 'orderHistory'>): boolean =>
  ctx.customerHistory !== undefined && !(ctx.orderHistory ?? []).length && !ADDRESS_HINT.test(ctx.customerHistory.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase());
/** journey retest R7-2: the product ids of a search_products / get_product result. */
const productIdsOf = (result: unknown): string[] => {
  const r = result as { products?: { id?: unknown }[]; id?: unknown } | null;
  if (Array.isArray(r?.products)) return r.products.map((p) => p?.id).filter((id): id is string => typeof id === 'string');
  return typeof r?.id === 'string' ? [r.id] : [];
};
/** journey retest R8-1: tool answers that are a real failure of the platform (the only ones that may be told as a problem). */
const SYSTEM_FAILURES = new Set(['ORDERS_UNAVAILABLE', 'PAYMENT_LINK_UNAVAILABLE', 'UNKNOWN_TOOL']);
/** journey retest R8-1 / R8-2: create_order answers after which no recap is shown and nothing is ordered (a field to ask, a product to change). */
const REFUSED_ORDER = new Set(['VALIDATION', 'VARIANT_REQUIRED', 'PRODUCT_NOT_AVAILABLE', 'ORDER_INSUFFICIENT_STOCK', 'CONFIRMATION_REFUSED', 'WILAYA_NOT_SERVED', 'ORDER_NOT_REPLACEABLE']);
/**
 * journey retest R8-1 / R8-2: the last create_order of the turn was refused (no recap, no order) — with the first field it asked
 * for; null when it returned a recap, placed the order, or was not called.
 */
export const refusedOrder = (executed: Pick<ExecutedTool, 'name' | 'result'>[]): { field: string | null } | null => {
  const last = [...executed].reverse().find((t) => canonicalTool(t.name) === 'create_order');
  const r = last?.result as { ok?: unknown; error?: { code?: unknown; field?: unknown } } | null | undefined;
  if (!r || r.ok === true || !REFUSED_ORDER.has(String(r.error?.code ?? ''))) return null;
  return { field: r.error?.code === 'VALIDATION' && typeof r.error.field === 'string' ? r.error.field : null };
};
/** journey retest R1-1: the result given back for a call to a tool this step did not offer (it is not run). */
export const unavailableTool = (name: string, fieldOnly: boolean, noPhone = false, noPlace = false, noStreet = false) => ({
  ok: false,
  error: { code: 'TOOL_NOT_AVAILABLE', tool: name },
  instruction: `${name} cannot be used now${fieldOnly && canonicalTool(name) === 'handoff_to_human' ? ': the customer only gave an order field (or a yes) — record it, keep the conversation and ask the next missing field (or show the recap)' : canonicalTool(name) === 'create_order' && noPhone ? ': the customer has not given a phone number yet — ask for the next missing field (never a recap)' : canonicalTool(name) === 'create_order' && noPlace ? ': the customer has not named their wilaya yet — ask for it (never a default wilaya, never a recap)' : canonicalTool(name) === 'create_order' && noStreet ? ': the customer named only the wilaya / commune — ask for the street address (rue, cité, building, landmark) or offer the stop-desk (never a recap)' : canonicalTool(name) === 'create_order' ? ': it already answered in this turn — follow that answer (ask the missing field, or let the recap / confirmation go)' : canonicalTool(name) === 'cancel_order' ? ': the customer did not ask to cancel anything — take the order (ask the next missing field, or call create_order for the recap)' : ''}. Answer the customer now with the JSON object.`,
});
/**
 * journey retest R2-4: a `create_order` answer after which the tool is not offered again in the same turn — the recap was
 * returned, the order placed (or refused: blocked, already placed, not confirmed), or a field must be asked to the customer
 * (VALIDATION missing=true). The same call was sent 2–3 times in a turn (10.1 s), and probes followed each other.
 */
export const orderClosedBy = (name: string, result: unknown): boolean => {
  if (canonicalTool(name) !== 'create_order') return false;
  const r = result as { ok?: unknown; error?: { code?: unknown; missing?: unknown } } | null;
  if (r?.ok === true) return true;
  const code = r?.error?.code;
  return code === 'CONFIRMATION_REQUIRED' || code === 'ORDER_ALREADY_PLACED' || code === 'CONFIRMATION_REFUSED' || code === 'CUSTOMER_BLOCKED' || (code === 'VALIDATION' && r?.error?.missing === true);
};
/**
 * journey retest R3-3: the `handoff_to_human` definition with only the allowed reasons; without « Shop rules » the description
 * no longer mentions `other` (the model chose it on « je veux 1 hijab soie », « Nadia Kaci, 0661234568 ou 0770998877 »).
 */
export const handoffDefWith = (def: AiToolDef, reasons: string[]): AiToolDef => {
  const p = def.parameters as { properties?: Record<string, unknown> };
  const description = reasons.includes('other') ? def.description : def.description.replace(/\s*\(reason = that rule id; reason=other only for a « Shop rules » item\)/, ' (reason = that rule id)');
  return { ...def, description, parameters: { ...def.parameters, properties: { ...p.properties, reason: { enum: reasons } } } };
};
/** journey retest R2-4: the result given back for a call identical to one already answered in this turn (not run again). */
export const repeatedCall = (result: unknown) => ({ ...(result && typeof result === 'object' && !Array.isArray(result) ? (result as object) : { result }), repeated: true, instruction: 'The same call was already answered in this turn (above): do not send it again — answer the customer now.' });

export type ExecutedTool = { callId: string; name: string; args: Record<string, unknown>; result: unknown; simulated: boolean; replayed: boolean };
export type TurnRequest = {
  runId: string;
  prompt: Pick<BuiltPrompt, 'system' | 'messages'> & { cachePrefix?: string };
  toolCtx: Omit<ToolRunContext, 'callId'>;
  temperature: number;
  maxTokens: number;
  /** epoch ms: the whole-run budget (45 s) */
  deadline: number;
  /** false: tool calls are executed but not persisted (never used by reply runs) */
  persist?: boolean;
  /** §4.3 reply guard: what the server knows this turn (this turn's tool results are added as they come) */
  guard?: GuardFacts;
};
type TurnBase = { tools: ExecutedTool[]; usage: AiUsage; model: RoutedModel | null; usedFallback: boolean };
export type TurnResult =
  | (TurnBase & { ok: true; output: AiReplyOutput; model: RoutedModel; forcedHandoff: string | null; repaired: boolean; salvaged?: boolean; /** retest 12/11: a handoff of the model was refused by the server this turn (handoff-judge) */ handoffRefused?: HandoffRefusal; /** §4.3: the reply guard found something (and what was done) */ guard?: GuardOutcome })
  | (TurnBase & { ok: false; kind: 'provider' | 'format'; error: string });
export type RunMeta = { language?: string; toolNames?: string[]; cardsSent?: number; handoff?: boolean; costUsd?: number; plannedCost?: number; vision?: Record<string, unknown>; sessionId?: string; turn?: unknown; evalFlag?: unknown; scenario?: string; /** §4.3 reply guard (rules, amounts / leak kinds, action — never message text) */ guard?: GuardOutcome };
/** §4.3: the run flags of a guard outcome (`guard_rewritten`: the corrective turn passed; `guard_enforced`: sentences dropped or the safe sentence sent). */
export const guardFlags = (g?: GuardOutcome): string[] => (!g ? [] : g.action === 'rewritten' ? ['guard_rewritten'] : g.action === 'kept' ? ['guard_kept'] : ['guard_enforced']);
/** §4.1 format retry: the earlier messages kept (the rest of the thread is left out). */
const FORMAT_RETRY_HISTORY = 8;
const slim = (v: GuardViolation[]) => v.map(({ rule, value, kind }) => ({ rule, ...(value !== undefined ? { value } : {}), ...(kind ? { kind } : {}) }));

/** Stable JSON (sorted keys) for the tool-call hash. */
export const canonicalJson = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
};
/**
 * Provider tool-call ids change when the model is re-prompted on a retry, so the persisted id is derived from the call
 * itself: `sha256(name + canonicalJson(args))` + its ordinal among identical calls of the run.
 */
export const toolCallId = (name: string, args: unknown, ordinal: number) => `${createHash('sha256').update(`${canonicalTool(name)}\n${canonicalJson(args)}`).digest('hex').slice(0, 32)}:${ordinal}`;
export const costUsd = (m: Pick<RoutedModel, 'inputPricePerM' | 'outputPricePerM'>, u: AiUsage) => Math.round(((u.inputTokens * m.inputPricePerM) / 1e6 + (u.outputTokens * m.outputPricePerM) / 1e6) * 1e6) / 1e6;
/**
 * `AiRun.error` of a provider failure: the §6 class, then the HTTP status and the provider's error type when known
 * (`provider_error:400 invalid_request_error`) — the bare class did not tell an overload from a refused request
 * (tester report 26/10). Never the provider's free text.
 */
export const providerErrorLabel = (e: AiProviderError) => [e.kind, [e.status, e.detail].filter(Boolean).join(' ')].filter(Boolean).join(':').slice(0, 120);
const INTENTS: Record<string, AiIntent> ={ SALE: 'sale', INFO: 'info', TRACKING: 'tracking', COMPLAINT: 'complaint', GREETING: 'greeting', OTHER: 'other' };
export const intentOf = (i: string): AiIntent => INTENTS[i] ?? 'other';

@Injectable()
export class AiRunService implements OnModuleInit {
  private readonly log = new Logger(AiRunService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly tools: ToolRegistry,
    private readonly credits: CreditService,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-ai-run-reaper', '* * * * *', () => this.reap());
  }

  /**
   * `created` — a new run; `replay` — the `running` run of an earlier attempt (its tool calls are replayed);
   * `done` — this batch was already answered (or failed for good): the caller does nothing.
   */
  async start(p: { workspaceId: string; conversationId: string | null; agentId: string | null; kind: AiRunKind; batchKey: string | null; attempt?: number; meta?: RunMeta }): Promise<{ run: AiRun; state: 'created' | 'replay' | 'done' }> {
    const find = () => (p.conversationId && p.batchKey ? prisma.aiRun.findFirst({ where: { conversationId: p.conversationId, batchKey: p.batchKey } }) : Promise.resolve(null));
    const reuse = async (existing: AiRun) => {
      if (existing.status !== 'running') return { run: existing, state: 'done' as const };
      const run = await prisma.aiRun.update({ where: { id: existing.id }, data: { attempt: Math.max(existing.attempt + 1, p.attempt ?? 1) } });
      return { run, state: 'replay' as const };
    };
    const existing = await find();
    if (existing) return reuse(existing);
    const route = await this.routing.route(p.kind === 'vision' || p.kind === 'caption' || p.kind === 'page_analysis' ? 'vision' : 'text');
    const model = route.failoverActive && route.fallback ? route.fallback : route.primary;
    try {
      const run = await prisma.aiRun.create({
        data: { workspaceId: p.workspaceId, agentId: p.agentId, conversationId: p.conversationId, kind: p.kind, modelId: model.id, providerId: model.providerId, batchKey: p.batchKey, attempt: p.attempt ?? 1, meta: (p.meta ?? undefined) as Prisma.InputJsonValue | undefined },
      });
      return { run, state: 'created' };
    } catch (e) {
      // two workers on the same batch: the unique (conversationId, batchKey) keeps one run
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const other = await find();
        if (other) return reuse(other);
      }
      throw e;
    }
  }

  /** Executes one tool call of a run, or returns its stored result (replay). */
  private async toolCall(req: TurnRequest, call: AiToolCallRequest, ordinal: number, before: readonly ExecutedTool[] = []): Promise<ExecutedTool> {
    const callId = toolCallId(call.name, call.args, ordinal);
    // journey retest R4-1: a server handoff reason (order_limits…) is accepted only after a tool of this turn reported it
    const established = establishedReasons(before.map((t) => t.result));
    const ctx: ToolRunContext = { ...req.toolCtx, callId, ...(established.length ? { established } : {}) };
    const simulated = (r: unknown) => req.toolCtx.dryRun && !!(r as { simulated?: unknown } | null)?.simulated;
    if (req.persist === false) {
      const result = await this.tools.execute(call.name, call.args, ctx);
      return { callId, name: call.name, args: call.args, result, simulated: simulated(result), replayed: false };
    }
    const stored = await prisma.aiToolCall.findUnique({ where: { aiRunId_callId: { aiRunId: req.runId, callId } } });
    if (stored?.executedAt) return { callId, name: stored.name, args: call.args, result: stored.result, simulated: simulated(stored.result), replayed: true };
    // persisted BEFORE execution: a crash between the two is visible, and the tool's own idempotency key is `runId:callId`
    if (!stored) await prisma.aiToolCall.create({ data: { aiRunId: req.runId, callId, name: call.name, args: call.args as Prisma.InputJsonValue } });
    const result = await this.tools.execute(call.name, call.args, ctx);
    await prisma.aiToolCall.update({ where: { aiRunId_callId: { aiRunId: req.runId, callId } }, data: { result: result as Prisma.InputJsonValue, executedAt: new Date() } });
    return { callId, name: call.name, args: call.args, result, simulated: simulated(result), replayed: false };
  }

  /**
   * The model loop of one turn. Provider failures are retried once on the route's other model inside `RoutingService`;
   * what comes back here as `ok: false` is final for this attempt (`provider`: both models failed or the 45 s budget is
   * spent; `format`: the output stayed malformed after the format reminder).
   */
  async turn(req: TurnRequest): Promise<TurnResult> {
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    const messages: AiMessage[] = [...req.prompt.messages];
    // full-test 15/11 AI-CHAT-07: no handoff tool on a message that is only an order field (refused every time, 5–10 s each)
    const fieldOnly = fieldOnlyMessage(req.toolCtx.customerText, !!req.toolCtx.ordering);
    // journey retest R7-4: nor on a message that gives the order's details with a phone and asks nothing of the team (N5 T2
    // `handoff_to_human { off_catalogue, evidence « none » }` next to the recap) — `status = HANDOFF` stays judged
    const orderDetails = !fieldOnly && orderDetailsMessage(req.toolCtx.customerText, (t) => phonesIn(t).size > 0);
    const noHandoff = fieldOnly || orderDetails;
    // journey retest R3-3: the handoff tool carries only the reasons this agent's rules allow now (no `other` without shop rules)
    // journey retest R6-5: and `keyword` only when one of the agent's keywords is in the customer's message
    const reasons = allowedHandoffReasons(req.toolCtx.agent, req.toolCtx.unclearStreak ?? 0, req.toolCtx.customerText);
    // journey retest R5-6: no create_order while the customer has given no phone number (every such call is refused) — the
    // probes `create_order {}` / placeholder values came on such turns; a complete order message carries its phone and keeps it
    const noPhone = !(await this.phoneGiven(req.toolCtx));
    // journey retest R6-5: with a phone create_order stays offered, but with no street address / stop-desk word in the
    // customer's messages (and no recap yet) the model is told to ask for the address rather than call it (F1b: « Sétif, El
    // Eulma » ⇒ `create_order` without an address, refused)
    const noAddress = !noPhone && noAddressYet(req.toolCtx);
    // journey retest R7-4: and with no wilaya either (none named, no commune of one, none known of the customer) it is not
    // offered at all — such a call can only be refused (F1b T1 `wilayaId 1`)
    // the wilaya / commune lists, read once for the turn (unreadable ⇒ null: nothing is withheld on their account)
    const places = noAddress && req.toolCtx.customerHistory !== undefined ? await placeIndex().catch(() => null) : null;
    const noPlace = noAddress && !(await this.placeKnown(req.toolCtx, places));
    // journey retest R8-4 (17/11): nor on a message that only names the place (« Sétif, El Eulma ») while no street address was
    // given — F1b T2 `create_order { items: [], no commune, no address }`, refused; the street (or the stop-desk) is asked
    const noStreet = noAddress && !noPlace && this.placeOnly(req.toolCtx.customerText, places);
    // journey retest R8-4: no cancel_order on a message that gives the order's details and asks no cancellation (N5 T2
    // `cancel_order {}` next to the recap, NO_OPEN_ORDER)
    const noCancel = orderDetails;
    const defs = (await this.tools.defsFor(req.toolCtx.workspaceId)).filter((d) => !(d.name === 'handoff_to_human' && (noHandoff || !reasons.length)) && !(d.name === 'create_order' && (noPhone || noPlace || noStreet)) && !(d.name === 'cancel_order' && noCancel)).map((d) => (d.name === 'handoff_to_human' ? handoffDefWith(d, reasons) : d));
    // journey retest R1-1: the model still called the withheld tool (the prompt describes it) and the SDK refused the whole
    // step — 5 of 59 turns of a shop with handoff rules ended in 503. The note says it is not available for this message
    // (after the cached start of the system prompt, so the cache is kept).
    // journey retest R5-6: and, without a phone, that create_order is not available (same place: the cache prefix is kept)
    const executed: ExecutedTool[] = [];
    const seen = new Map<string, number>();
    const answered = new Map<string, unknown>();
    const system = [req.prompt.system, ...(fieldOnly ? [FIELD_ONLY_NOTE] : []), ...(orderDetails ? [ORDER_DETAILS_NOTE] : []), ...(noPhone ? [NO_PHONE_NOTE] : []), ...(noPlace ? [NO_PLACE_NOTE] : noStreet ? [NO_STREET_NOTE] : noAddress ? [NO_ADDRESS_NOTE] : [])].join('\n\n');
    // journey retest R7-5: run once, when the answer to a delivery question comes without any quote_delivery of the turn
    let serverQuoted = false;
    let model = null as RoutedModel | null;
    let usedFallback = false;
    let repaired = false;
    let firstAnswer = '';
    let forcedHandoff: string | null = null;
    let toolRounds = 0;
    let handoffAsked = false;
    let handoffRefused: HandoffRefusal | undefined;
    // journey retest R2-4: create_order is withdrawn for the rest of the turn once it answered for good (orderClosedBy), and a
    // call identical to one already answered this turn gets that answer back without running again
    let orderClosed = false;
    // §4.3 reply guard: the answer that broke a rule (its status, cards and fields are kept), and what it broke
    let guardFirst = null as { output: AiReplyOutput; extra: { salvaged?: boolean }; violations: GuardViolation[] } | null;
    // full-test 15/11 proposal 4: once create_order placed an order this turn, the customer gets the server's confirmation
    // (number, items, total, delay, payment) in their language — never the model's own wording of it (it « corrected »
    // itself, said the details were invented or that nothing was ordered: AI-CHAT-02)
    const confirmationNow = () => orderConfirmationText(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })), req.guard?.lang ?? 'fr');
    // journey retest R1-6 / R1-7: a recap create_order returned this turn is sent as the server wrote it (catalogue names,
    // delivery mode, name, phone, address) — the model's own recap was cut short or translated the product names
    const recapNow = () => pendingRecap(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })));
    const confirmed = (output: AiReplyOutput): AiReplyOutput => {
      const text = confirmationNow();
      if (text) return { ...output, reply: text };
      // journey retest R2-6: Messenger shows « **Djellaba homme** » as typed — the reply goes out as plain text
      const plain = { ...output, reply: stripMarkdown(output.reply) };
      const calls = executed.map((t) => ({ name: canonicalTool(t.name), result: t.result }));
      // journey retest R4-8: a blocked customer's order gets the server's sentence, in line with the shop's handoff text
      const blockedText = blockedOrderText(calls, req.guard?.lang ?? 'fr');
      if (blockedText) return { ...plain, reply: blockedText };
      // a handoff answer is not a recap to confirm — journey retest R4-1: and it never claims one (« récapitulée ci-dessus »)
      if (output.status === 'HANDOFF' || forcedHandoff) return { ...plain, reply: withoutRecapClaims(plain.reply) };
      const recap = recapNow();
      if (!recap) {
        // journey retest R7-3: « ? » / « ... » gets the pending question, not « Oui, je suis là ! » / « Vous êtes toujours là ? »
        const text = fillerMessage(req.toolCtx.customerText) ? withoutPresenceTalk(plain.reply) : plain.reply;
        return { ...plain, reply: withPhotoAnswer(output, text) };
      }
      const r = recapReply(plain.reply, recap, req.guard?.lang ?? 'fr', req.toolCtx.customerText);
      // journey retest R5-5: « twasslou l Constantine ? » is answered in words when no sentence of the model goes before the recap
      const answer = r.kept === 'server' ? deliveryAnswer(calls, req.toolCtx.customerText ?? '', req.guard?.lang ?? 'fr') : null;
      return { ...plain, reply: withPhotoAnswer(output, answer ? `${answer}\n\n${r.text}` : r.text) };
    };
    /**
     * journey retest R7-2: a photo request answered with no photo sent and no word about it, while every product of the answer
     * (its cards, else this turn's search / get_product results) is known to have none — the server says so first (N9: the
     * guard's rewrite of a `moroccan_darija` draft had dropped « ma 3andnach tsawer »).
     */
    const withPhotoAnswer = (output: AiReplyOutput, text: string): string => {
      if (!req.guard || !photoAsked(req.toolCtx.customerText ?? '') || noPhotoSaid(text)) return text;
      const f = factsNow(output);
      if (f.photoSent !== false) return text;
      const shown = [...new Set([...(output.productCards ?? []), ...(output.productPhotos ?? [])])];
      const found = executed.flatMap((t) => (['search_products', 'get_product'].includes(canonicalTool(t.name)) ? productIdsOf(t.result) : []));
      const concerned = shown.length ? shown : [...new Set(found)];
      if (!concerned.length || !concerned.every((id) => (f.noPhoto ?? []).includes(id))) return text;
      return noPhotoReply(text, concerned.length, req.guard.lang);
    };
    const ok = (output: AiReplyOutput, extra: { salvaged?: boolean; guard?: GuardOutcome } = {}): TurnResult => ({ ok: true, output: confirmed(output), tools: executed, usage, model: model!, usedFallback, forcedHandoff, repaired, ...(handoffRefused ? { handoffRefused } : {}), ...extra });
    // journey 16/11 J03-2: this turn's quote_delivery answers — the reply must give the fee (not checked on a handoff answer)
    const factsNow = (answer?: Pick<AiReplyOutput, 'status' | 'customer'> & Partial<Pick<AiReplyOutput, 'productCards' | 'productPhotos'>>) => {
      const f = withToolResults(req.guard!, executed.map((t) => t.result));
      const quotes = answer?.status === 'HANDOFF' || forcedHandoff ? [] : quoteFacts(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })));
      // journey retest R2-3: the fields the answer reports as given — the guard checks the reply does not deny them
      const c = answer?.customer;
      const fields = c ? { ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.wilaya ? { wilaya: c.wilaya } : {}), ...(c.commune ? { commune: c.commune } : {}), ...(c.address ? { address: c.address } : {}) } : undefined;
      // journey retest R6-2: whether this answer sends a photo — a card or a gallery of a product not known to have none
      const sent = answer ? [...(answer.productCards ?? []), ...(answer.productPhotos ?? []), ...(f.galleries ?? [])] : null;
      const photoSent = sent ? sent.some((id) => !(f.noPhoto ?? []).includes(id)) : undefined;
      // journey retest R8-1 / R8-2: a tool that really failed; a create_order refused this turn (no recap shown) and the field it asked
      const refusal = refusedOrder(executed);
      const systemFailure = executed.some((t) => SYSTEM_FAILURES.has(String((t.result as { error?: { code?: unknown } } | null)?.error?.code ?? '')));
      return { ...f, ...(quotes.length ? { quotes } : {}), ...(fields ? { customerFields: fields } : {}), ...(photoSent !== undefined ? { photoSent } : {}), ...(systemFailure ? { systemFailure } : {}), ...(refusal ? { orderRefused: true, ...(refusal.field ? { missingField: refusal.field } : {}) } : {}) };
    };
    /** The guard's last word: offending sentences dropped / greeting stripped / the safe sentence (never a handoff). */
    const enforce = (base: AiReplyOutput, text: string, violations: GuardViolation[], first: GuardViolation[], retried: boolean, extra: { salvaged?: boolean }): TurnResult => {
      const e = enforceReply(text, violations, factsNow(base), { hasCards: base.productCards.length > 0 });
      return ok({ ...base, reply: e.reply }, { ...extra, guard: { violations: slim(first), retried, remaining: slim(violations), action: e.action } });
    };
    /** The corrective turn could not run (provider failure, time): the first answer is enforced rather than lost. */
    const guardFallback = () => (guardFirst ? enforce(guardFirst.output, guardFirst.output.reply, guardFirst.violations, guardFirst.violations, true, guardFirst.extra) : null);
    /** Checks an answer about to be returned: clean ⇒ returned; broken ⇒ one corrective turn when there is room, else enforced. */
    const guarded = (output: AiReplyOutput, extra: { salvaged?: boolean }, canRetry: boolean): TurnResult | 'retry' => {
      // the server's order confirmation replaces the text: nothing of the model's to check
      if (!req.guard || !output.reply.trim() || confirmationNow()) return ok(output, extra);
      // journey retest R1-6: a pending recap — the server's text is always sent (R4-3: never the model's recap); the
      // model's sentence kept before it is checked, and dropped (no corrective turn) when it breaks a rule
      const recap = output.status !== 'HANDOFF' && !forcedHandoff ? recapNow() : null;
      if (recap) {
        const r = recapReply(output.reply, recap, req.guard.lang, req.toolCtx.customerText);
        const own = r.kept === 'server' ? '' : output.reply;
        if (!own || !checkReply(own, factsNow(output)).length) return ok(output, extra);
        return ok({ ...output, reply: '' }, extra);
      }
      const violations = checkReply(output.reply, factsNow(output));
      if (!violations.length) return ok(output, extra);
      // a slip the server fixes itself (a Latin letter inside an Arabic word) costs no model turn
      if (canRetry && violations.some((v) => !AUTO_FIX_RULES.includes(v.rule)) && req.deadline - Date.now() > GUARD_RETRY_MIN_MS) {
        guardFirst = { output, extra, violations };
        return 'retry';
      }
      return enforce(output, output.reply, violations, violations, false, extra);
    };
    for (let step = 0; step < MAX_STEPS + 1; step++) {
      const left = req.deadline - Date.now();
      if (left <= 0) return guardFallback() ?? { ok: false, kind: 'provider', error: 'timeout', tools: executed, usage, model, usedFallback };
      // the corrective turn of the guard is offered no tool: an order or a cancellation is never done twice
      // full-test 15/11 AI-CHAT-02: nor the format retry — it only re-writes the answer (it cancelled the order it had just created)
      // full-test 15/11 proposal 13: a message that is only an order field gets 2 tool rounds at most (10–21 s turns)
      const offerTools = toolRounds < (fieldOnly ? 2 : MAX_STEPS - 1) && !forcedHandoff && !guardFirst && !repaired;
      const stepDefs = orderClosed ? defs.filter((d) => d.name !== 'create_order') : defs;
      let res;
      try {
        res = await this.routing.call(
          'text',
          (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose: 'reply', system, ...(req.prompt.cachePrefix ? { systemCachePrefix: req.prompt.cachePrefix } : {}), messages, tools: offerTools ? stepDefs : undefined, temperature: req.temperature, maxTokens: req.maxTokens, timeoutMs: Math.max(1000, Math.min(timeoutMs, left)) }),
          { only: (m) => m.supportsTools, prefer: model?.id },
        );
      } catch (e) {
        if (e instanceof AiProviderError) return guardFallback() ?? { ok: false, kind: 'provider', error: providerErrorLabel(e), tools: executed, usage, model, usedFallback };
        throw e;
      }
      model = res.model;
      usedFallback ||= res.usedFallback;
      usage.inputTokens += res.value.usage.inputTokens;
      usage.outputTokens += res.value.usage.outputTokens;

      // journey retest R1-1: a call to a tool this step did not offer is never run — the model is told and answers
      const offered = new Set(stepDefs.map((d) => d.name));
      const stray = offerTools ? [...(res.value.rejectedToolCalls ?? []), ...res.value.toolCalls.filter((c) => !offered.has(canonicalTool(c.name)))] : [];
      if (stray.length) {
        toolRounds++;
        const runnable = res.value.toolCalls.filter((c) => offered.has(canonicalTool(c.name)));
        if (runnable.length) messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: runnable });
        else messages.push({ role: 'assistant', content: [res.value.text, ...stray.map((c) => `[tool call ${c.name} ${JSON.stringify(c.args ?? {})}]`)].filter(Boolean).join('\n') });
        for (const call of runnable) {
          const hash = toolCallId(call.name, call.args, 0);
          if (answered.has(hash)) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(answered.get(hash)) });
            continue;
          }
          const ordinal = seen.get(hash) ?? 0;
          seen.set(hash, ordinal + 1);
          const done = await this.toolCall(req, call, ordinal, executed);
          executed.push(done);
          answered.set(hash, done.result);
          orderClosed ||= orderClosedBy(call.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
        }
        messages.push({ role: 'user', content: stray.map((c) => `[tool result ${c.name}] ${JSON.stringify(unavailableTool(c.name, noHandoff, noPhone, noPlace, noStreet))}`).join('\n') });
        continue;
      }
      if (res.value.toolCalls.length && offerTools) {
        toolRounds++;
        const calls = res.value.toolCalls;
        messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: calls });
        for (const call of calls) {
          const hash = toolCallId(call.name, call.args, 0);
          if (answered.has(hash)) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(answered.get(hash)) });
            continue;
          }
          const ordinal = seen.get(hash) ?? 0;
          seen.set(hash, ordinal + 1);
          const done = await this.toolCall(req, call, ordinal, executed);
          executed.push(done);
          answered.set(hash, done.result);
          orderClosed ||= orderClosedBy(call.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
        }
        continue;
      }
      const parsed = parseReplyOutput(res.value.text);
      if (guardFirst) {
        // the corrective answer: only its text is taken — status, cards, handoff and every other field stay the first answer's
        const { output: first, extra, violations } = guardFirst;
        const rewritten = (parsed.ok ? parsed.value.reply : (salvageReply(res.value.text)?.reply ?? '')).trim();
        if (!rewritten) return enforce(first, first.reply, violations, violations, true, extra);
        const again = checkReply(rewritten, factsNow(first));
        if (!again.length) return ok({ ...first, reply: rewritten }, { ...extra, guard: { violations: slim(violations), retried: true, remaining: [], action: 'rewritten' } });
        return enforce(first, rewritten, again, violations, true, extra);
      }
      const retryOrDone = (r: TurnResult | 'retry'): TurnResult | null => {
        if (r !== 'retry') return r;
        messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: guardInstruction(guardFirst!.violations, factsNow(guardFirst!.output)) });
        return null;
      };
      if (parsed.ok) {
        // journey retest R7-5 (17/11): « Vous livrez à Blida ? » answered from the delivery policy text alone (« Oui, on livre à
        // Blida … en 2 à 5 jours ») — the server runs quote_delivery for the wilaya the question names, so the guard's fee_missing
        // rule applies to this answer (one corrective turn, then the fee sentence) as when the model called it
        if (!serverQuoted && parsed.value.status !== 'HANDOFF' && !forcedHandoff && !recapNow() && !confirmationNow()) {
          serverQuoted = true;
          await this.deliveryQuote(req, executed, seen, answered);
        }
        // retest 12/11: `status = HANDOFF` is checked like the tool (handoff-judge) — the customer's words of this turn must
        // ask for it. Refused ⇒ the model is told why and answers (once); insisting with a reply ⇒ that reply is sent and the
        // conversation stays with the AI; insisting with nothing to send ⇒ the handoff goes through (silence would be worse)
        const out = parsed.value;
        const ctx = req.toolCtx;
        const verdict = out.status === 'HANDOFF' && !forcedHandoff && ctx.customerText !== undefined ? judgeHandoff({ reason: out.statusDetail, evidence: out.evidence, customerText: ctx.customerText, shopRules: ctx.agent.humanHandoffRules, keywords: ctx.agent.handoffKeywords, unclearStreak: ctx.unclearStreak, established: establishedReasons(executed.map((t) => t.result)) }) : null;
        if (verdict && !verdict.ok) {
          handoffRefused = verdict.why;
          if (!handoffAsked && step < MAX_STEPS) {
            handoffAsked = true;
            messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: handoffRefusedInstruction(verdict.why) });
            continue;
          }
          if (out.reply.trim()) {
            const { statusDetail: _dropped, evidence: _evidence, ...kept } = out;
            const done = retryOrDone(guarded({ ...kept, status: 'OK' }, {}, step < MAX_STEPS));
            if (done) return done;
            continue;
          }
        }
        // §4.3: the text is checked before it leaves (one corrective turn when there is a step left)
        const done = retryOrDone(guarded(out, {}, step < MAX_STEPS));
        if (done) return done;
        continue;
      }
      if (repaired) {
        // tester report 26/10: the first answer, when it is a plain message to the customer, is sent rather than the
        // conversation handed to the team in silence (F-6 only when there is nothing to send)
        const salvaged = salvageReply(firstAnswer) ?? salvageReply(res.value.text);
        // §4.3: no corrective turn after a format retry — the guard's last word applies at once
        if (salvaged) return guarded(salvaged, { salvaged: true }, false) as TurnResult;
        return { ok: false, kind: 'format', error: `malformed_output:${parsed.reason}`, tools: executed, usage, model, usedFallback };
      }
      firstAnswer = res.value.text;
      // §4.1: one retry with the format reminder. It leaves the older conversation out (tester report 22/10: in a long
      // thread the model copies the plain-text style of its past replies and stays malformed after the reminder) but keeps
      // the last FORMAT_RETRY_HISTORY messages: without any of them (full-test 15/11 AI-CHAT-02) the model saw this turn's
      // tool calls full of a name / phone / address it had never read, concluded it had invented them and said so.
      repaired = true;
      messages.splice(0, Math.max(0, req.prompt.messages.length - 1 - FORMAT_RETRY_HISTORY));
      messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: FORMAT_REMINDER });
    }
    return { ok: false, kind: 'format', error: 'malformed_output:steps', tools: executed, usage, model, usedFallback };
  }

  /**
   * journey retest R7-4: the customer has named a wilaya (or a commune of one, « wilaya 16 ») in their messages, or one is known
   * of them — the conversation's recorded details, their client record or an earlier order. Unsure (no messages, a read error) ⇒ true.
   */
  private async placeKnown(ctx: TurnRequest['toolCtx'], places: PlaceIndex | null): Promise<boolean> {
    if (ctx.customerHistory === undefined || !places) return true;
    try {
      if (placeNamedIn(places, ctx.customerHistory)) return true;
      const conv = ctx.conversationId ? await prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { context: true } }) : null;
      if (conv && contextOf(conv).customer?.wilaya) return true;
      if (!ctx.clientId) return false;
      const [address, order] = await Promise.all([prisma.clientAddress.findFirst({ where: { clientId: ctx.clientId }, select: { id: true } }), prisma.order.findFirst({ where: { clientId: ctx.clientId }, select: { id: true } })]);
      return !!address || !!order;
    } catch {
      return true;
    }
  }

  /** journey retest R8-4: the customer's message only names a wilaya / commune (the lists cannot be read ⇒ false: nothing withheld). */
  private placeOnly(text: string | undefined, places: PlaceIndex | null): boolean {
    return !!places && !!text?.trim() && placeOnlyMessage(places, text);
  }

  /**
   * journey retest R7-5 (17/11): the answer to a delivery question naming a wilaya (« Bonsoir, vous livrez à Blida ? ») comes
   * with no quote_delivery of this turn ⇒ the server runs it for that wilaya (stored like any tool call of the run). A turn that
   * already called quote_delivery, or a message naming no wilaya, runs nothing.
   */
  private async deliveryQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>): Promise<void> {
    const text = req.toolCtx.customerText ?? '';
    if (!req.guard || !asksDelivery(text) || executed.some((t) => canonicalTool(t.name) === 'quote_delivery')) return;
    let wilaya: { id: number } | null = null;
    try {
      wilaya = matchWilaya((await placeIndex()).wilayas, text);
    } catch {
      return;
    }
    if (!wilaya) return;
    const call: AiToolCallRequest = { id: 'server-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id } };
    const hash = toolCallId(call.name, call.args, 0);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);
    const done = await this.toolCall(req, call, ordinal, executed);
    executed.push(done);
    answered.set(hash, done.result);
  }

  /**
   * journey retest R5-6: the customer has given a phone number — in one of their messages, or on their client record (a
   * returning customer, KNOWN CUSTOMER). Without the conversation's messages (`customerHistory`) nothing is withheld.
   */
  private async phoneGiven(ctx: TurnRequest['toolCtx']): Promise<boolean> {
    if (ctx.customerHistory === undefined || phonesIn(ctx.customerHistory).size) return true;
    if (!ctx.clientId) return false;
    const client = await prisma.client.findUnique({ where: { id: ctx.clientId }, select: { phone: true, phone2: true } });
    return !!(client?.phone || client?.phone2);
  }

  /** Closes a run (inside the caller's transaction when given). Only a `running` run is closed: returns false otherwise. */
  async finish(
    runId: string,
    p: { status: Exclude<AiRunStatus, 'running'>; turn?: Pick<TurnBase, 'usage' | 'model' | 'usedFallback' | 'tools'>; intent?: AiIntent | null; confidence?: number | null; error?: string | null; startedAt: Date; flags?: string[]; meta?: RunMeta },
    tx?: Tx,
  ): Promise<boolean> {
    const db = tx ?? prisma;
    const usage = p.turn?.usage ?? { inputTokens: 0, outputTokens: 0 };
    const model = p.turn?.model ?? null;
    const current = await db.aiRun.findUnique({ where: { id: runId }, select: { meta: true } });
    const meta: RunMeta = { ...((current?.meta as RunMeta | null) ?? {}), ...(p.meta ?? {}), ...(p.turn ? { toolNames: p.turn.tools.map((t) => canonicalTool(t.name)) } : {}), ...(model ? { costUsd: costUsd(model, usage) } : {}) };
    const r = await db.aiRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: p.status,
        ...(model ? { modelId: model.id, providerId: model.providerId } : {}),
        usedFallback: p.turn?.usedFallback ?? false,
        intent: p.intent ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Math.max(0, Date.now() - p.startedAt.getTime()),
        confidence: p.confidence ?? null,
        toolCallCount: p.turn?.tools.length ?? 0,
        error: p.error ?? null,
        finishedAt: new Date(),
        ...(p.flags?.length ? { flags: { push: p.flags } } : {}),
        meta: meta as Prisma.InputJsonValue,
      },
    });
    if (r.count === 1) this.metrics?.aiRun(p.status, Math.max(0, Date.now() - p.startedAt.getTime()), model?.provider ?? null);
    return r.count === 1;
  }

  /** `sched-ai-run-reaper` (every minute). A reaped run is not resumed: the next customer message starts a new batch. */
  async reap(now = new Date()): Promise<number> {
    const stale = await TenantContext.runSystem(() => prisma.aiRun.findMany({ where: { status: 'running', startedAt: { lt: new Date(now.getTime() - RUN_REAP_AFTER_MS) } }, select: { id: true, workspaceId: true }, take: 200 }));
    let n = 0;
    for (const run of stale) {
      // the workspace's own plan limits: releasing reads the balance of its credit period
      const tenant = await this.tenants.forWorker(run.workspaceId).catch(() => null);
      if (!tenant) continue;
      await TenantContext.run(tenant, async () => {
        const r = await prisma.aiRun.updateMany({ where: { id: run.id, status: 'running' }, data: { status: 'error', error: 'reaped', finishedAt: now, flags: { push: 'reaped' } } });
        if (!r.count) return;
        await this.credits.release(run);
        n++;
      });
    }
    if (n) this.log.warn({ reaped: n }, 'ai runs reaped');
    return n;
  }
}
