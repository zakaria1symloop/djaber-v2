// AGT-07 / 04-ai-pipeline §8 — the playground: a real turn of the agent on the real catalogue with the write tools in
// dry run. Nothing is sent to Meta, no conversation, order or stock is touched, no credit is charged.
//   POST /agents/:id/test           → job `ai-reply / playground-turn` (`pg:<sessionId>:<turn>`); the request waits for
//                                     its result (45 s) — the HTTP handler itself never calls an AI provider
//   8 scenarios (wizard step 5)     → job `jobs / agent-test-scenarios`, one `AgentTestRun` per `TestScenarioKey`
// Runs are `AiRun(kind = test | test_scenario, conversationId = null, batchKey = sessionId)` with their `AiToolCall`s.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PLAYGROUND_TURNS_PER_HOUR, type AgentTestScenarioDto, type PlaygroundCard, type PlaygroundTurnDto, type PlaygroundTurnInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Agent, type TestScenarioKey } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { bullConnection, QueueService } from '../../core/queue/queue.service';
import { RedisService } from '../../core/redis/redis.provider';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { JobService } from '../jobs/job.service';
import { GUARD_EARLIER_TOOL_CALLS, plannedCost, RUN_BUDGET_MS } from './ai.constants';
import { AiRunService, guardFlags, intentOf, type RunMeta } from './ai-run.service';
import { CatalogueService } from './catalogue.service';
import { detectLanguage, systemLocale, type AiLanguage } from './language';
import { PromptBuilder, type HistoryMessage } from './prompt/prompt-builder';
import { guardFactsOf } from './reply-guard';
import { SCENARIOS, type ScenarioCheck } from './prompt/scenarios';
import { AiProviderError } from './provider/ai.gateway';
import { TranscriptionService } from './transcription.service';
import { TurnContextService } from './turn-context.service';
import { VisionService, visionNoteText } from './vision.service';

export type PlaygroundJob = { workspaceId: string; agentId: string; userId: string | null; sessionId: string; turnId: string; messages: PlaygroundTurnInput['messages']; scenario?: TestScenarioKey; kind?: 'test' | 'test_scenario' };
type JobAnswer = { ok: true; turn: PlaygroundTurnDto } | { ok: false; code: 'AI_PROVIDER_ERROR' | 'NOT_FOUND' };
const SCENARIO_KEYS = Object.keys(SCENARIOS) as TestScenarioKey[];

@Injectable()
export class PlaygroundService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PlaygroundService.name);
  private events?: QueueEvents;
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
    private readonly tenants: TenantResolver,
    private readonly storage: StorageService,
    private readonly jobs: JobService,
    private readonly runs: AiRunService,
    private readonly context: TurnContextService,
    private readonly catalogue: CatalogueService,
    private readonly vision: VisionService,
    private readonly transcription: TranscriptionService,
  ) {}

  onModuleInit() {
    this.registry.register('ai-reply', 'playground-turn', (d: PlaygroundJob) => this.process(d), { concurrency: 4 });
    this.registry.register('jobs', 'agent-test-scenarios', (d: { jobId: string }) => this.runScenarios(d.jobId), { concurrency: 2 });
  }
  async onModuleDestroy() {
    await this.events?.close().catch(() => undefined);
  }

  /** 60 turns / h / workspace (or per shared link): `429 PLAYGROUND_RATE_LIMITED`. */
  async countTurn(subject: string) {
    const key = `rl:playground:${subject}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 3600);
    if (n > PLAYGROUND_TURNS_PER_HOUR) throw new AppException('PLAYGROUND_RATE_LIMITED');
  }

  /**
   * HTTP side: validates, counts the turn, hands it to the worker and waits for the answer.
   * (Integration tests have no worker process: the same job handler is then called in-process.)
   */
  async request(agentId: string, input: PlaygroundTurnInput, o: { rateSubject?: string; userId?: string | null } = {}): Promise<PlaygroundTurnDto> {
    const t = TenantContext.get();
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    await this.countTurn(o.rateSubject ?? t.workspaceId);
    const sessionId = input.sessionId ?? randomUUID();
    const data: PlaygroundJob = { workspaceId: t.workspaceId, agentId, userId: o.userId ?? t.userId ?? null, sessionId, turnId: randomUUID(), messages: input.messages, scenario: input.scenario, kind: 'test' };
    let answer: JobAnswer;
    if (this.config.isTest) answer = await this.process(data);
    else {
      this.events ??= new QueueEvents('ai-reply', { connection: bullConnection(this.config.get('REDIS_URL')) });
      const job = await this.queue.add('ai-reply', 'playground-turn', data as unknown as Record<string, unknown>, `pg:${sessionId}:${data.turnId}`, { attempts: 1, removeOnComplete: { age: 300 }, removeOnFail: { age: 3600 } });
      try {
        answer = (await job.waitUntilFinished(this.events, RUN_BUDGET_MS)) as JobAnswer;
      } catch (e) {
        this.log.warn({ agentId, err: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 'playground turn did not finish');
        throw new AppException('AI_PROVIDER_ERROR');
      }
    }
    if (!answer.ok) throw answer.code === 'NOT_FOUND' ? notFound() : new AppException('AI_PROVIDER_ERROR');
    return answer.turn;
  }

  /** `ai-reply / playground-turn`. */
  async process(d: PlaygroundJob): Promise<JobAnswer> {
    const tenant = await this.tenants.forWorker(d.workspaceId);
    return TenantContext.run({ ...tenant, userId: d.userId ?? undefined }, async () => {
      const agent = await prisma.agent.findFirst({ where: { id: d.agentId, deletedAt: null } });
      if (!agent) return { ok: false, code: 'NOT_FOUND' };
      try {
        return { ok: true, turn: await this.turn(agent, d) };
      } catch (e) {
        if (e instanceof AiProviderError || (e instanceof AppException && (e.code === 'AI_PROVIDER_ERROR' || e.code === 'AGENT_MODEL_UNAVAILABLE'))) return { ok: false, code: 'AI_PROVIDER_ERROR' };
        throw e;
      }
    });
  }

  private async upload(id: string, kind: 'image' | 'audio') {
    const u = await prisma.upload.findFirst({ where: { id, workspaceId: TenantContext.workspaceId() } });
    if (!u || !u.mime.startsWith(`${kind}/`)) return null;
    return this.storage.get(u.storageKey).then((f) => ({ body: f.body, mime: f.mime || u.mime }), () => null);
  }

  /** One dry-run turn. Throws `AI_PROVIDER_ERROR` when the provider (both models) or the output format failed. */
  async turn(agent: Agent, d: PlaygroundJob): Promise<PlaygroundTurnDto> {
    const scenario = d.scenario ? SCENARIOS[d.scenario] : null;
    const messages = [...d.messages];
    if (scenario && !messages.length) messages.push({ role: 'user', text: scenario.message });
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') throw new AppException('VALIDATION_ERROR', {}, { messages: 'validation.required' });

    const { run } = await this.runs.start({ workspaceId: agent.workspaceId, conversationId: null, agentId: agent.id, kind: d.kind ?? 'test', batchKey: d.sessionId, meta: { sessionId: d.sessionId, ...(d.scenario ? { scenario: d.scenario } : {}) } });
    try {
      // --- the customer turn: text, voice note (transcript), photo (2-pass vision) -----------------------------------------
      const lines: string[] = [];
      let said = last.text.trim();
      let hasAudio = false;
      let hasImage = false;
      if (scenario?.attachment === 'audio' && messages.length === 1) {
        hasAudio = true;
        lines.push(`[voice note transcript]: ${said}`);
      } else if (last.audioUploadId && agent.voiceTranscription) {
        const audio = await this.upload(last.audioUploadId, 'audio');
        if (audio) {
          const tr = await this.transcription.transcribe(audio.body, audio.mime);
          hasAudio = true;
          said = [said, tr.text.trim()].filter(Boolean).join('\n');
          if (last.text.trim()) lines.push(last.text.trim());
          lines.push(`[voice note transcript]: ${tr.text.trim()}`);
        } else if (said) lines.push(said);
      } else if (said) lines.push(said);
      const matched: string[] = [];
      if (agent.imageRecognition && (last.imageUploadId || (scenario?.attachment === 'image' && messages.length === 1))) {
        // the photo scenario shows the agent the first product photo of its own catalogue
        const image = last.imageUploadId ? await this.upload(last.imageUploadId, 'image') : await this.samplePhoto(agent);
        const r = await this.vision.analyse(agent, image);
        hasImage = true;
        if (r.note.kind === 'match') matched.push(r.note.productId);
        lines.push(`[image]\n${visionNoteText(r.note)}`);
      }
      const lang: AiLanguage = detectLanguage(said) ?? 'fr';
      const history: HistoryMessage[] = messages.slice(0, -1).map((m) => ({ author: m.role === 'user' ? 'customer' : 'ai', text: m.text }));
      const turnCtx = await this.context.load(agent, { text: said, lastProductIds: matched, lang });
      const prompt = PromptBuilder.build(turnCtx.prompt, history, lines.join('\n') || said, { contextTokens: turnCtx.model.contextTokens, maxTokens: turnCtx.maxTokens });
      // §4.3: the same reply guard as the live replies (the earlier turns of the session give their fees / totals)
      const earlier = await prisma.aiToolCall.findMany({ where: { executedAt: { not: null }, aiRun: { agentId: agent.id, batchKey: d.sessionId, id: { not: run.id } } }, orderBy: { executedAt: 'desc' }, take: GUARD_EARLIER_TOOL_CALLS, select: { result: true } });
      const guard = guardFactsOf(turnCtx.prompt, { customerText: said, answeredBefore: history.some((m) => m.author === 'ai'), freshStart: false, earlierToolResults: earlier.map((c) => c.result) });

      const result = await this.runs.turn({
        runId: run.id,
        prompt,
        // retest 12/11: the same handoff check as the live replies (handoff-judge)
        toolCtx: { workspaceId: agent.workspaceId, agent, conversationId: null, clientId: null, channelId: null, runId: run.id, dryRun: true, customerText: said },
        temperature: turnCtx.temperature,
        maxTokens: turnCtx.maxTokens,
        deadline: Date.now() + RUN_BUDGET_MS,
        guard,
      });
      if (!result.ok) {
        await this.runs.finish(run.id, { status: 'error', error: result.error, startedAt: run.startedAt, turn: result });
        throw new AppException('AI_PROVIDER_ERROR');
      }
      const out = result.output;
      const handoff = !!result.forcedHandoff || out.status === 'HANDOFF';
      const status = handoff ? 'HANDOFF' : out.status;
      const cards: PlaygroundCard[] = (await this.catalogue.byIds(agent, out.productCards)).map((p) => ({ productId: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, variantLabel: p.variants.length ? p.variants.map((v) => v.name).join(' · ') : null }));
      const texts = turnCtx.prompt.workspace.systemMessages;
      const locale = systemLocale(lang, turnCtx.prompt.locale);
      const text = (key: string) => (texts[key]?.[locale] ?? texts[key]?.fr ?? '').replace('{shop}', turnCtx.prompt.workspace.name);
      const systemMessages = [
        ...(history.length === 0 && text('welcome') ? [{ key: 'welcome', text: text('welcome') }] : []),
        ...(turnCtx.prompt.outOfHours && text('out_of_hours') ? [{ key: 'out_of_hours', text: text('out_of_hours') }] : []),
        ...(handoff && text('handoff') ? [{ key: 'handoff', text: text('handoff') }] : []),
      ];
      const dto: PlaygroundTurnDto = {
        turnId: run.id,
        sessionId: d.sessionId,
        reply: out.reply,
        status,
        statusDetail: result.forcedHandoff ?? out.statusDetail ?? null,
        intent: intentOf(out.intent),
        confidence: out.confidence,
        model: result.model.label,
        modelDetail: { id: result.model.modelId, temperature: turnCtx.temperature, maxTokens: turnCtx.maxTokens },
        tokens: { input: result.usage.inputTokens, output: result.usage.outputTokens },
        latencyMs: Date.now() - run.startedAt.getTime(),
        toolCalls: result.tools.map((t) => ({ name: t.name, args: t.args, result: t.result, simulated: t.simulated })),
        cards,
        creditsInProd: plannedCost({ hasAudio, hasImage }),
        language: out.language ?? lang,
        promptPreview: prompt.sections.map((s) => s.text),
        promptSections: prompt.sections.map((s) => ({ key: s.key, chars: s.text.length })),
        systemMessages,
      };
      const meta: RunMeta = { language: dto.language, cardsSent: cards.length, handoff, turn: { messages, reply: out.reply, status, statusDetail: dto.statusDetail, cards: cards.map((c) => c.productId), toolCalls: dto.toolCalls.map((t) => ({ name: t.name, args: t.args })) }, ...(result.guard ? { guard: result.guard } : {}) };
      await this.runs.finish(run.id, { status: status === 'OK' ? 'ok' : status === 'UNCLEAR' ? 'unclear' : status === 'UNKNOWN' ? 'unknown' : 'handoff', turn: result, intent: dto.intent, confidence: out.confidence, startedAt: run.startedAt, meta, flags: guardFlags(result.guard) });
      return dto;
    } catch (e) {
      // a provider failure outside the model loop (vision, transcription) or any crash: the run is closed as an error
      await this.runs.finish(run.id, { status: 'error', error: e instanceof AiProviderError ? e.kind : e instanceof AppException ? e.code : 'internal_error', startedAt: run.startedAt }).catch(() => undefined);
      throw e;
    }
  }

  private async samplePhoto(agent: Agent) {
    const img = await prisma.productImage.findFirst({ where: { isPrimary: true, product: this.catalogue.scopeWhere(agent) }, orderBy: { createdAt: 'asc' } });
    if (!img) return null;
    return this.storage.get(img.storageKey).then((f) => ({ body: f.body, mime: f.mime || 'image/webp' }), () => null);
  }

  // --- eval helpers (04-ai-pipeline §8) -------------------------------------------------------------------------------------
  /** "Signaler une mauvaise réponse (eval)": kept on the test run (`AiRun.meta.evalFlag`) — the fixture of a nightly eval. */
  async flag(agentId: string, turnId: string, note: string | undefined) {
    const run = await prisma.aiRun.findFirst({ where: { id: turnId, agentId, kind: { in: ['test', 'test_scenario'] } } });
    if (!run) throw notFound();
    const meta = { ...((run.meta as object | null) ?? {}), evalFlag: { note: note ?? null, by: TenantContext.get().userId ?? null, at: new Date().toISOString() } };
    await prisma.aiRun.update({ where: { id: run.id }, data: { meta: meta as Prisma.InputJsonValue } });
    return { turnId: run.id, flagged: true };
  }

  /** "Exporter la conversation (eval)": the turns of a playground session in the eval fixture shape. */
  async export(agentId: string, sessionId: string) {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true, name: true, currentVersion: true } });
    if (!agent) throw notFound();
    const runs = await prisma.aiRun.findMany({ where: { agentId, batchKey: sessionId, kind: { in: ['test', 'test_scenario'] } }, orderBy: { startedAt: 'asc' }, include: { toolCalls: true } });
    return {
      agent: { id: agent.id, name: agent.name, version: agent.currentVersion },
      sessionId,
      exportedAt: new Date().toISOString(),
      turns: runs.map((r) => {
        const m = (r.meta ?? {}) as RunMeta & { turn?: { messages?: unknown; reply?: string; status?: string; cards?: string[] } };
        return { turnId: r.id, at: r.startedAt.toISOString(), status: r.status, messages: m.turn?.messages ?? [], reply: m.turn?.reply ?? null, expect: { status: m.turn?.status ?? null, intent: r.intent, language: m.language ?? null, toolCalls: r.toolCalls.map((c) => c.name) }, flagged: m.evalFlag ?? null };
      }),
    };
  }

  // --- the 8 scenarios of the wizard's step 5 -----------------------------------------------------------------------------------
  async startScenarios(agentId: string) {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    const job = await this.jobs.create({ kind: 'agent_test_scenarios', name: 'agent-test-scenarios', payload: { agentId }, total: SCENARIO_KEYS.length });
    return { jobId: job.id };
  }

  /** Latest result of each scenario for the agent's current version (null = not run yet). */
  async scenarios(agentId: string): Promise<AgentTestScenarioDto[]> {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    const rows = await prisma.agentTestRun.findMany({ where: { agentId }, orderBy: { at: 'desc' }, take: 200 });
    return SCENARIO_KEYS.map((key) => {
      const r = rows.find((x) => x.scenarioKey === key);
      return { scenarioKey: key, status: r?.status ?? null, summary: r?.summary ?? null, at: r?.at.toISOString() ?? null, agentVersion: r?.agentVersion ?? null };
    });
  }

  static check(key: TestScenarioKey, turn: PlaygroundTurnDto, inScope: Set<string>): { pass: boolean; failed: ScenarioCheck[] } {
    const s = SCENARIOS[key];
    const replyLang = detectLanguage(turn.reply);
    const sameScript = s.language === 'ar' ? replyLang === 'ar' : replyLang !== 'ar';
    const created = turn.toolCalls.filter((t) => t.name === 'create_order' && (t.result as { ok?: boolean } | null)?.ok === true);
    const results: Record<ScenarioCheck, boolean> = {
      replied: turn.reply.trim().length > 0,
      language_respected: sameScript,
      no_invented_product: turn.cards.every((c) => inScope.has(c.productId)),
      handoff_on_complaint: !s.expect.handoff || turn.status === 'HANDOFF',
      order_created_simulated: created.every((t) => t.simulated),
      limits_respected: created.length === 0,
    };
    const failed = s.expect.checks.filter((c) => !results[c]);
    return { pass: failed.length === 0, failed };
  }

  async runScenarios(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const agentId = (job.payload as { agentId: string }).agentId;
      const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null } });
      if (!agent) throw notFound();
      const inScope = new Set((await prisma.product.findMany({ where: this.catalogue.scopeWhere(agent), select: { id: true } })).map((p) => p.id));
      const results: { scenarioKey: TestScenarioKey; status: 'pass' | 'fail' | 'error'; summary: string | null }[] = [];
      for (const [i, key] of SCENARIO_KEYS.entries()) {
        if (await this.jobs.isCancelled(jobId)) break;
        let status: 'pass' | 'fail' | 'error' = 'error';
        let summary: string | null = null;
        let aiRunId: string | null = null;
        try {
          const turn = await this.turn(agent, { workspaceId: agent.workspaceId, agentId, userId: job.createdById, sessionId: `scenario:${jobId}:${key}`, turnId: randomUUID(), messages: [], scenario: key, kind: 'test_scenario' });
          aiRunId = turn.turnId;
          const c = PlaygroundService.check(key, turn, inScope);
          status = c.pass ? 'pass' : 'fail';
          summary = c.pass ? turn.reply.slice(0, 200) : `failed: ${c.failed.join(', ')}`;
        } catch (e) {
          summary = e instanceof AppException ? e.code : 'INTERNAL';
        }
        await prisma.agentTestRun.create({ data: { workspaceId: agent.workspaceId, agentId, agentVersion: agent.currentVersion, scenarioKey: key, status, summary, aiRunId } });
        results.push({ scenarioKey: key, status, summary });
        await this.jobs.progress(jobId, ((i + 1) / SCENARIO_KEYS.length) * 100);
      }
      return { result: { agentId, results, passed: results.filter((r) => r.status === 'pass').length, total: SCENARIO_KEYS.length }, notify: false };
    });
  }
}
