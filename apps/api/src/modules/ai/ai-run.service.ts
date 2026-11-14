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
import { AI_GATEWAY, AiProviderError, type AiGateway, type AiMessage, type AiToolCallRequest, type AiUsage } from './provider/ai.gateway';
import { RoutingService, type RoutedModel } from './routing.service';
import { FORMAT_REMINDER, parseReplyOutput, salvageReply, type AiReplyOutput } from './structured-output';
import { canonicalTool, ToolRegistry, type ToolRunContext } from './tools/tool-registry';
import { handoffRefusedInstruction, judgeHandoff, type HandoffRefusal } from './handoff-judge';
import { checkReply, enforceReply, guardInstruction, withToolResults, type GuardFacts, type GuardOutcome, type GuardViolation } from './reply-guard';

export type ExecutedTool = { callId: string; name: string; args: Record<string, unknown>; result: unknown; simulated: boolean; replayed: boolean };
export type TurnRequest = {
  runId: string;
  prompt: Pick<BuiltPrompt, 'system' | 'messages'>;
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
    const defs = await this.tools.defsFor(req.toolCtx.workspaceId);
    let model = null as RoutedModel | null;
    let usedFallback = false;
    let repaired = false;
    let firstAnswer = '';
    let forcedHandoff: string | null = null;
    let toolRounds = 0;
    let handoffAsked = false;
    let handoffRefused: HandoffRefusal | undefined;
    // §4.3 reply guard: the answer that broke a rule (its status, cards and fields are kept), and what it broke
    let guardFirst = null as { output: AiReplyOutput; extra: { salvaged?: boolean }; violations: GuardViolation[] } | null;
    const ok = (output: AiReplyOutput, extra: { salvaged?: boolean; guard?: GuardOutcome } = {}): TurnResult => ({ ok: true, output, tools: executed, usage, model: model!, usedFallback, forcedHandoff, repaired, ...(handoffRefused ? { handoffRefused } : {}), ...extra });
    const factsNow = () => withToolResults(req.guard!, executed.map((t) => t.result));
    /** The guard's last word: offending sentences dropped / greeting stripped / the safe sentence (never a handoff). */
    const enforce = (base: AiReplyOutput, text: string, violations: GuardViolation[], first: GuardViolation[], retried: boolean, extra: { salvaged?: boolean }): TurnResult => {
      const e = enforceReply(text, violations, factsNow(), { hasCards: base.productCards.length > 0 });
      return ok({ ...base, reply: e.reply }, { ...extra, guard: { violations: slim(first), retried, remaining: slim(violations), action: e.action } });
    };
    /** The corrective turn could not run (provider failure, time): the first answer is enforced rather than lost. */
    const guardFallback = () => (guardFirst ? enforce(guardFirst.output, guardFirst.output.reply, guardFirst.violations, guardFirst.violations, true, guardFirst.extra) : null);
    /** Checks an answer about to be returned: clean ⇒ returned; broken ⇒ one corrective turn when there is room, else enforced. */
    const guarded = (output: AiReplyOutput, extra: { salvaged?: boolean }, canRetry: boolean): TurnResult | 'retry' => {
      if (!req.guard || !output.reply.trim()) return ok(output, extra);
      const violations = checkReply(output.reply, factsNow());
      if (!violations.length) return ok(output, extra);
      if (canRetry && req.deadline - Date.now() > GUARD_RETRY_MIN_MS) {
        guardFirst = { output, extra, violations };
        return 'retry';
      }
      return enforce(output, output.reply, violations, violations, false, extra);
    };
    for (let step = 0; step < MAX_STEPS + 1; step++) {
      const left = req.deadline - Date.now();
      if (left <= 0) return guardFallback() ?? { ok: false, kind: 'provider', error: 'timeout', tools: executed, usage, model, usedFallback };
      // the corrective turn of the guard is offered no tool: an order or a cancellation is never done twice
      const offerTools = toolRounds < MAX_STEPS - 1 && !forcedHandoff && !guardFirst;
      let res;
      try {
        res = await this.routing.call(
          'text',
          (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose: 'reply', system: req.prompt.system, messages, tools: offerTools ? defs : undefined, temperature: req.temperature, maxTokens: req.maxTokens, timeoutMs: Math.max(1000, Math.min(timeoutMs, left)) }),
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

      if (res.value.toolCalls.length && offerTools) {
        toolRounds++;
        const calls = res.value.toolCalls;
        messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: calls });
        for (const call of calls) {
          const hash = toolCallId(call.name, call.args, 0);
          const ordinal = seen.get(hash) ?? 0;
          seen.set(hash, ordinal + 1);
          const done = await this.toolCall(req, call, ordinal);
          executed.push(done);
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
        const again = checkReply(rewritten, factsNow());
        if (!again.length) return ok({ ...first, reply: rewritten }, { ...extra, guard: { violations: slim(violations), retried: true, remaining: [], action: 'rewritten' } });
        return enforce(first, rewritten, again, violations, true, extra);
      }
      const retryOrDone = (r: TurnResult | 'retry'): TurnResult | null => {
        if (r !== 'retry') return r;
        messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: guardInstruction(guardFirst!.violations, factsNow()) });
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
      // §4.1: one retry with the format reminder. It leaves the earlier conversation out (tester report 22/10: in a long
      // thread the model copies the plain-text style of its past replies and stays malformed after the reminder): with the
      // batch, this turn's tool results and its own answer only, it just puts that answer in the JSON object.
      repaired = true;
      messages.splice(0, req.prompt.messages.length - 1);
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
