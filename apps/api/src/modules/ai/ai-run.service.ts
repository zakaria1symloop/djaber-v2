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
import { allowedHandoffReasons, fieldOnlyMessage, handoffRefusedInstruction, judgeHandoff, type HandoffRefusal } from './handoff-judge';
import { AUTO_FIX_RULES, checkReply, enforceReply, guardInstruction, quoteFacts, stripMarkdown, withToolResults, type GuardFacts, type GuardOutcome, type GuardViolation } from './reply-guard';
import { orderConfirmationText, pendingRecap, recapReply } from './tools/order-confirmation-text';

/** journey retest R1-1: told to the model on a message that only gives an order field (handoff_to_human is not offered). */
export const FIELD_ONLY_NOTE =
  'THIS MESSAGE only gives an order field (a name, a phone number, a place, an address) or answers yes: record it and answer — ask the next missing field, or call create_order for the recap when every field is known. handoff_to_human is not available for this message.';
/** journey retest R1-1: the result given back for a call to a tool this step did not offer (it is not run). */
export const unavailableTool = (name: string, fieldOnly: boolean) => ({
  ok: false,
  error: { code: 'TOOL_NOT_AVAILABLE', tool: name },
  instruction: `${name} cannot be used now${fieldOnly && canonicalTool(name) === 'handoff_to_human' ? ': the customer only gave an order field (or a yes) — record it, keep the conversation and ask the next missing field (or show the recap)' : canonicalTool(name) === 'create_order' ? ': it already answered in this turn — follow that answer (ask the missing field, or let the recap / confirmation go)' : ''}. Answer the customer now with the JSON object.`,
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
  private async toolCall(req: TurnRequest, call: AiToolCallRequest, ordinal: number): Promise<ExecutedTool> {
    const callId = toolCallId(call.name, call.args, ordinal);
    const ctx: ToolRunContext = { ...req.toolCtx, callId };
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
    const executed: ExecutedTool[] = [];
    const seen = new Map<string, number>();
    const messages: AiMessage[] = [...req.prompt.messages];
    // full-test 15/11 AI-CHAT-07: no handoff tool on a message that is only an order field (refused every time, 5–10 s each)
    const fieldOnly = fieldOnlyMessage(req.toolCtx.customerText, !!req.toolCtx.ordering);
    // journey retest R3-3: the handoff tool carries only the reasons this agent's rules allow now (no `other` without shop rules)
    const reasons = allowedHandoffReasons(req.toolCtx.agent, req.toolCtx.unclearStreak ?? 0);
    const defs = (await this.tools.defsFor(req.toolCtx.workspaceId)).filter((d) => !(d.name === 'handoff_to_human' && (fieldOnly || !reasons.length))).map((d) => (d.name === 'handoff_to_human' ? handoffDefWith(d, reasons) : d));
    // journey retest R1-1: the model still called the withheld tool (the prompt describes it) and the SDK refused the whole
    // step — 5 of 59 turns of a shop with handoff rules ended in 503. The note says it is not available for this message
    // (after the cached start of the system prompt, so the cache is kept).
    const system = fieldOnly ? `${req.prompt.system}\n\n${FIELD_ONLY_NOTE}` : req.prompt.system;
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
    const answered = new Map<string, unknown>();
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
      const recap = recapNow();
      // a handoff answer (blocked customer…) is not a recap to confirm
      if (!recap || output.status === 'HANDOFF' || forcedHandoff) return plain;
      return { ...plain, reply: recapReply(plain.reply, recap, req.guard?.lang ?? 'fr').text };
    };
    const ok = (output: AiReplyOutput, extra: { salvaged?: boolean; guard?: GuardOutcome } = {}): TurnResult => ({ ok: true, output: confirmed(output), tools: executed, usage, model: model!, usedFallback, forcedHandoff, repaired, ...(handoffRefused ? { handoffRefused } : {}), ...extra });
    // journey 16/11 J03-2: this turn's quote_delivery answers — the reply must give the fee (not checked on a handoff answer)
    const factsNow = (answer?: Pick<AiReplyOutput, 'status' | 'customer'>) => {
      const f = withToolResults(req.guard!, executed.map((t) => t.result));
      const quotes = answer?.status === 'HANDOFF' || forcedHandoff ? [] : quoteFacts(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })));
      // journey retest R2-3: the fields the answer reports as given — the guard checks the reply does not deny them
      const c = answer?.customer;
      const fields = c ? { ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.wilaya ? { wilaya: c.wilaya } : {}), ...(c.commune ? { commune: c.commune } : {}), ...(c.address ? { address: c.address } : {}) } : undefined;
      return { ...f, ...(quotes.length ? { quotes } : {}), ...(fields ? { customerFields: fields } : {}) };
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
      // journey retest R1-6: a pending recap — the server's text is sent unless the model's reply shows it whole; the
      // model's sentence kept before it is checked, and dropped (no corrective turn) when it breaks a rule
      const recap = output.status !== 'HANDOFF' && !forcedHandoff ? recapNow() : null;
      if (recap) {
        const r = recapReply(output.reply, recap, req.guard.lang);
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
          const done = await this.toolCall(req, call, ordinal);
          executed.push(done);
          answered.set(hash, done.result);
          orderClosed ||= orderClosedBy(call.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
        }
        messages.push({ role: 'user', content: stray.map((c) => `[tool result ${c.name}] ${JSON.stringify(unavailableTool(c.name, fieldOnly))}`).join('\n') });
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
          const done = await this.toolCall(req, call, ordinal);
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
        // retest 12/11: `status = HANDOFF` is checked like the tool (handoff-judge) — the customer's words of this turn must
        // ask for it. Refused ⇒ the model is told why and answers (once); insisting with a reply ⇒ that reply is sent and the
        // conversation stays with the AI; insisting with nothing to send ⇒ the handoff goes through (silence would be worse)
        const out = parsed.value;
        const ctx = req.toolCtx;
        const verdict = out.status === 'HANDOFF' && !forcedHandoff && ctx.customerText !== undefined ? judgeHandoff({ reason: out.statusDetail, evidence: out.evidence, customerText: ctx.customerText, shopRules: ctx.agent.humanHandoffRules, keywords: ctx.agent.handoffKeywords, unclearStreak: ctx.unclearStreak }) : null;
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
