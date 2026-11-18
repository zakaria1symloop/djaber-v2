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
import { conversationLanguage, languageSwitched, systemLocale, turnLanguage, type AiLanguage } from './language';
import { PromptBuilder, type HistoryMessage } from './prompt/prompt-builder';
import { latestRecap, nextChosen, orderHistoryOf, placedThisTurn, type ChosenItem } from './tools/order-confirmation';
import { canonicalTool } from './tools/tool-registry';
import { guardFactsOf } from './reply-guard';
import { handoffSystemLineShown } from './reply-fixes';
import { productCards } from '../messaging/product-card';
import { SCENARIO_QUANTITY, SCENARIOS, type ScenarioCheck } from './prompt/scenarios';
import { AiProviderError } from './provider/ai.gateway';
import { TranscriptionService } from './transcription.service';
import { TurnContextService } from './turn-context.service';
import { VisionService, visionNoteText } from './vision.service';

export type PlaygroundJob = { workspaceId: string; agentId: string; userId: string | null; sessionId: string; turnId: string; messages: PlaygroundTurnInput['messages']; scenario?: TestScenarioKey; kind?: 'test' | 'test_scenario' };
type JobAnswer = { ok: true; turn: PlaygroundTurnDto } | { ok: false; code: 'AI_PROVIDER_ERROR' | 'NOT_FOUND' };
/**
 * journey retest R1-1: index of the first customer message the AI has not answered yet — the messages after the last
 * assistant message (a failed turn leaves its message in the thread with no answer after it). The last message is the
 * current one.
 */
export const unansweredFrom = (messages: readonly { role: string }[]): number => {
  let i = messages.length - 1;
  while (i > 0 && messages[i - 1]!.role === 'user') i--;
  return Math.max(0, i);
};
const SCENARIO_KEYS = Object.keys(SCENARIOS) as TestScenarioKey[];
/** journey retest R10-1: how long the answer of a turn can be asked again with its `turnKey` (the job's own lifetime after it completed). */
export const REPLAY_TTL_S = 300;
/**
 * journey retest R10-1: the `Server-Timing` header of a playground / shared-link answer — `queue` = from the job's add to its
 * answer, `total` = the whole request in the API, `replay` when the page asked again with the same key.
 */
export const serverTiming = (r: { replayed: boolean; timing: { waitMs: number; totalMs: number } }): string =>
  [`queue;dur=${Math.round(r.timing.waitMs)}`, `total;dur=${Math.round(r.timing.totalMs)}`, ...(r.replayed ? ['replay'] : [])].join(', ');

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

  /**
   * 60 turns / h / workspace — the shared test links count in the same budget (full-test 15/11 AI-CHAT-10: each link had
   * its own 60 / h). Over the limit: `429 PLAYGROUND_RATE_LIMITED { retryAfter }` = the seconds left in the hour
   * (AI-CHAT-11: the page counted down 1:00 and failed again). Returns the turns used this hour, this one included.
   */
  async countTurn(subject: string): Promise<number> {
    const key = `rl:playground:${subject}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 3600);
    if (n > PLAYGROUND_TURNS_PER_HOUR) {
      const ttl = await this.redis.client.ttl(key);
      if (ttl < 0) await this.redis.client.expire(key, 3600);
      throw new AppException('PLAYGROUND_RATE_LIMITED', { retryAfter: ttl > 0 ? ttl : 3600 });
    }
    return n;
  }
  /**
   * journey re-run J03r AI-CHAT-11 / J04r-6 (18/11): the workspace's test turns of this hour before any turn of the dialog — the header said
   * « 0 tour cette heure » on every opening (57 / 60 used) and the merchant learnt the limit from a 429. `retryAfter`: the seconds left in
   * the hour once the limit is reached (null below it).
   */
  async usage(agentId: string): Promise<{ used: number; limit: number; retryAfter: number | null }> {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    const key = `rl:playground:${TenantContext.workspaceId()}`;
    const used = Math.min(PLAYGROUND_TURNS_PER_HOUR, Math.max(0, Number(await this.redis.client.get(key)) || 0));
    const ttl = used >= PLAYGROUND_TURNS_PER_HOUR ? await this.redis.client.ttl(key) : -1;
    return { used, limit: PLAYGROUND_TURNS_PER_HOUR, retryAfter: used >= PLAYGROUND_TURNS_PER_HOUR ? (ttl > 0 ? ttl : 3600) : null };
  }
  /** journey retest R1-1: a turn the AI did not answer (provider failure, no answer in time) is given back to the hour's budget. */
  async uncountTurn(subject: string): Promise<number> {
    const key = `rl:playground:${subject}`;
    const n = await this.redis.client.decr(key);
    if (n < 0) await this.redis.client.set(key, '0', 'KEEPTTL');
    return Math.max(0, n);
  }

  /**
   * HTTP side: validates, counts the turn, hands it to the worker and waits for the answer.
   * (Integration tests have no worker process: the same job handler is then called in-process.)
   */
  async request(agentId: string, input: PlaygroundTurnInput, o: { rateSubject?: string; userId?: string | null } = {}): Promise<PlaygroundTurnDto> {
    return (await this.requestTurn(agentId, input, o)).turn;
  }

  /**
   * `request`, with what the controller adds to the response: whether the turn was a replay of the same `turnKey` (journey
   * retest R10-1) and the server's timing (`Server-Timing`).
   *
   * Journey retest R10-1 (17/11): three answers reached the page 65–213 s after the worker had finished them — the job's
   * `completed` event and nginx's log of the full response are within the same second as the end of the AI run, so the time
   * was lost between the server and the browser, on that one connection (the page's other requests went through meanwhile).
   * The page now sends the same request again on a new connection when no answer came (`turnKey`, web `resendWhileStalled`):
   * the same key joins the same job (`pg:<workspace>:<session>:<turnKey>`) — the turn is neither run nor counted twice.
   */
  async requestTurn(agentId: string, input: PlaygroundTurnInput, o: { rateSubject?: string; userId?: string | null } = {}): Promise<{ turn: PlaygroundTurnDto; replayed: boolean; timing: { waitMs: number; totalMs: number } }> {
    const started = Date.now();
    const t = TenantContext.get();
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    const subject = o.rateSubject ?? t.workspaceId;
    const sessionId = input.sessionId ?? randomUUID();
    const turnId = input.turnKey ?? randomUUID();
    // the workspace and the agent are part of the job id: a key is never shared across shops or agents
    const jobKey = `pg:${t.workspaceId}:${agentId}:${sessionId}:${turnId}`;
    // journey retest R10-1: the first request of a key counts the turn; the same key again (the page re-asking) does not
    const marker = `pgturn:${jobKey}`;
    const replayed = !!input.turnKey && !(await this.redis.client.set(marker, '1', 'EX', REPLAY_TTL_S, 'NX'));
    const used = replayed
      ? await this.turnsUsed(subject)
      : await this.countTurn(subject).catch(async (e) => {
          // over the hour's limit: nothing runs, the key is free again
          if (input.turnKey) await this.redis.client.del(marker).catch(() => undefined);
          throw e;
        });
    const data: PlaygroundJob = { workspaceId: t.workspaceId, agentId, userId: o.userId ?? t.userId ?? null, sessionId, turnId, messages: input.messages, scenario: input.scenario, kind: 'test' };
    let answer: JobAnswer;
    // journey retest R1-1: « the failed turn still counts in the 60 / h » — a turn without an answer is not counted (once: only
    // by the request that counted it)
    const failed = async <E>(e: E): Promise<E> => {
      if (!replayed) await this.uncountTurn(subject).catch(() => undefined);
      return e;
    };
    const queuedAt = Date.now();
    if (this.config.isTest) answer = await this.inProcess(jobKey, data).catch(async (e) => Promise.reject(await failed(e)));
    else {
      this.events ??= new QueueEvents('ai-reply', { connection: bullConnection(this.config.get('REDIS_URL')) });
      // a second add with the same id is a no-op while the job exists: a replay waits for (or reads) the same job's answer
      const job = await this.queue.add('ai-reply', 'playground-turn', data as unknown as Record<string, unknown>, jobKey, { attempts: 1, removeOnComplete: { age: REPLAY_TTL_S }, removeOnFail: { age: 3600 } });
      try {
        answer = (await job.waitUntilFinished(this.events, RUN_BUDGET_MS)) as JobAnswer;
      } catch (e) {
        this.log.warn({ agentId, job: turnId.slice(0, 8), replayed, waitMs: Date.now() - queuedAt, err: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 'playground turn did not finish');
        throw await failed(new AppException('AI_PROVIDER_ERROR'));
      }
    }
    if (!answer.ok) throw await failed(answer.code === 'NOT_FOUND' ? notFound() : new AppException('AI_PROVIDER_ERROR'));
    const timing = { waitMs: Date.now() - queuedAt, totalMs: Date.now() - started };
    // journey retest R10-1: the server's side of every turn (no message text, no customer data) — a slow answer in the page with a
    // short `totalMs` here was lost on the way to the browser
    this.log.log({ agentId, job: turnId.slice(0, 8), replayed, runMs: answer.turn.latencyMs, ...timing }, 'playground turn answered');
    return { turn: { ...answer.turn, hourlyUsed: used }, replayed, timing };
  }

  /** The turns of the hour already counted for this subject (a replay shows the same count). */
  private async turnsUsed(subject: string): Promise<number> {
    return Math.max(0, Number(await this.redis.client.get(`rl:playground:${subject}`)) || 0);
  }

  /** Integration tests (no worker process): the job handler in-process, one run per key as with the queue's job id. */
  private readonly running = new Map<string, Promise<JobAnswer>>();
  private inProcess(key: string, data: PlaygroundJob): Promise<JobAnswer> {
    const known = this.running.get(key);
    if (known) return known;
    const p = this.process(data);
    this.running.set(key, p);
    p.catch(() => undefined).finally(() => setTimeout(() => this.running.delete(key), REPLAY_TTL_S * 1000).unref?.());
    return p;
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
    // full-test 15/11 AGENTS-03: a scenario chip after the first message adds its message to the thread (it sent an empty one)
    if (scenario && (!messages.length || messages[messages.length - 1]!.role !== 'user')) messages.push({ role: 'user', text: scenario.message });
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
      // journey retest R1-1: the customer messages the AI did not answer (a failed turn kept in the thread) are answered
      // with this one, as one batch like on Messenger — a « oui » sent in a failed turn still confirms the recap
      const start = unansweredFrom(messages);
      const pending = messages.slice(start, -1).map((m) => m.text.trim()).filter(Boolean);
      if (pending.length) {
        lines.unshift(...pending);
        said = [...pending, said].filter(Boolean).join('\n');
      }
      // full-test 15/11 AI-CHAT-04: the previous language of the conversation, as on Messenger (a bare « Tamanrasset ? » gave English)
      // journey 16/11 J05-8: each earlier turn read with the one before it — a bare « Nadia Ferhat » read alone gave English, so
      // the phone number sent after it was answered in English in the middle of a French conversation
      // journey 16/11 J04-2: a first message with no clue (« Bonsoir » had none) takes the shop's language, not English
      const shop = { agentDefault: agent.defaultLanguage, workspaceLocale: TenantContext.get().locale };
      const previous = conversationLanguage(messages.slice(0, start).filter((m) => m.role === 'user').map((m) => m.text), shop);
      const lang: AiLanguage = turnLanguage(said, previous, shop);
      const history: HistoryMessage[] = messages.slice(0, start).map((m) => ({ author: m.role === 'user' ? 'customer' : 'ai', text: m.text }));
      // full-test 15/11 AI-CHAT-05: what the customer chose in the earlier turns of the session (CURRENT ORDER), as on Messenger
      // journey retest R1-1: a failed turn has no `chosen` — it no longer erases the product chosen before it
      const previousRun = await prisma.aiRun.findFirst({ where: { agentId: agent.id, batchKey: d.sessionId, id: { not: run.id }, status: { notIn: ['running', 'error'] } }, orderBy: { startedAt: 'desc' }, select: { meta: true } });
      const chosen = ((previousRun?.meta as { chosen?: ChosenItem[] | null } | null)?.chosen ?? null) as ChosenItem[] | null;
      // journey 16/11 J03-13: as live (reply.processor `oncePer24h`), the out-of-hours text once per session per 24 h
      const oohBefore = (previousRun?.meta as { outOfHoursAt?: string } | null)?.outOfHoursAt ?? null;
      const turnCtx = await this.context.load(agent, { text: said, lastProductIds: matched, lang, chosen });
      const prompt = PromptBuilder.build(turnCtx.prompt, history, lines.join('\n') || said, { contextTokens: turnCtx.model.contextTokens, maxTokens: turnCtx.maxTokens });
      // §4.3: the same reply guard as the live replies (the earlier turns of the session give their fees / totals)
      const earlier = await prisma.aiToolCall.findMany({ where: { executedAt: { not: null }, aiRun: { agentId: agent.id, batchKey: d.sessionId, id: { not: run.id } } }, orderBy: { executedAt: 'desc' }, take: GUARD_EARLIER_TOOL_CALLS, select: { result: true, name: true, args: true, executedAt: true } });
      const guard = guardFactsOf(turnCtx.prompt, { customerText: said, answeredBefore: history.some((m) => m.author === 'ai'), freshStart: false, earlierToolResults: earlier.map((c) => c.result), earlierToolCalls: earlier.map((c) => ({ name: c.name, args: c.args, result: c.result, at: c.executedAt })) });

      const orderHistory = await orderHistoryOf({ agentId: agent.id, batchKey: d.sessionId, id: { not: run.id } });
      const result = await this.runs.turn({
        runId: run.id,
        prompt,
        // retest 12/11: the same handoff check as the live replies (handoff-judge)
        // journey retest R1-5: an order is being taken once a product is chosen or a recap was shown
        toolCtx: { workspaceId: agent.workspaceId, agent, conversationId: null, clientId: null, channelId: null, runId: run.id, dryRun: true, customerText: said, orderHistory, customerHistory: [...messages.filter((m) => m.role === 'user').map((m) => m.text), said].join('\n'), ordering: !!chosen?.length || !!latestRecap(orderHistory) },
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
      // journey 16/11 J03-11 (« CARTE RÉELLE »): the card the customer gets on Messenger (messaging `productCards`: price range,
      // promotion price, approved content), for the products of the agent's scope
      const scoped = (await this.catalogue.byIds(agent, out.productCards)).map((p) => p.id);
      const cards: PlaygroundCard[] = (await productCards(prisma, scoped, { ai: true })).map((c) => ({ productId: c.productId, name: c.name, price: c.price, ...(c.priceMax ? { priceMax: c.priceMax } : {}), ...(c.oldPrice ? { oldPrice: c.oldPrice } : {}), imageUrl: c.imageUrl, variantLabel: c.variants ?? null }));
      const texts = turnCtx.prompt.workspace.systemMessages;
      const locale = systemLocale(lang, turnCtx.prompt.locale, agent.defaultLanguage);
      const text = (key: string) => (texts[key]?.[locale] ?? texts[key]?.fr ?? '').replace('{shop}', turnCtx.prompt.workspace.name);
      const oohNow = turnCtx.prompt.outOfHours && !!text('out_of_hours') && (!oohBefore || Date.now() - Date.parse(oohBefore) >= 24 * 3_600_000);
      const systemMessages = [
        ...(history.length === 0 && text('welcome') ? [{ key: 'welcome', text: text('welcome') }] : []),
        ...(oohNow ? [{ key: 'out_of_hours', text: text('out_of_hours') }] : []),
        // journey retest R15-2 (18/11): not out of hours (it promises a quick answer next to « Notre équipe est absente … »), nor in Arabic
        // script for an arabizi customer — the AI's sentence says what the team does then
        ...(handoff && text('handoff') && handoffSystemLineShown(lang, turnCtx.prompt.outOfHours, locale) ? [{ key: 'handoff', text: text('handoff') }] : []),
      ];
      // full-test 15/11 AI-CHAT-12: a customer who only asked for a human (or wrote a handoff keyword) gets no « je transmets » of the
      // model next to the shop's handoff text — journey retest R15-2 (18/11): the server's short sentence for the request (ai-run), never
      // an empty text
      const reply = out.reply;
      const dto: PlaygroundTurnDto = {
        turnId: run.id,
        sessionId: d.sessionId,
        // full-test 15/11 AGENTS-01 / -03: the scenario's own message, so the thread shows (and resends) what was sent
        ...(scenario && messages.length && messages[messages.length - 1]!.text === scenario.message ? { customerText: scenario.message } : {}),
        reply,
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
        // journey retest R10-4 (17/11): the turn's language as the server decided it (it chose the recap's language) — the model's own
        // tag read `arabizi` for « 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » (N18b T3) while the recap was Arabic
        language: lang,
        promptPreview: prompt.sections.map((s) => s.text),
        promptSections: prompt.sections.map((s) => ({ key: s.key, chars: s.text.length })),
        systemMessages,
      };
      const meta: RunMeta & { chosen?: ChosenItem[] | null; outOfHoursAt?: string } = { ...(oohNow ? { outOfHoursAt: new Date().toISOString() } : oohBefore ? { outOfHoursAt: oohBefore } : {}), language: dto.language, cardsSent: cards.length, handoff, chosen: nextChosen(chosen, out.cart, placedThisTurn(result.tools.map((t) => ({ name: canonicalTool(t.name), result: t.result })))), turn: { messages, reply, status, statusDetail: dto.statusDetail, cards: cards.map((c) => c.productId), toolCalls: dto.toolCalls.map((t) => ({ name: t.name, args: t.args })) }, ...(result.guard ? { guard: result.guard } : {}) };
      await this.runs.finish(run.id, { status: status === 'OK' ? 'ok' : status === 'UNCLEAR' ? 'unclear' : status === 'UNKNOWN' ? 'unknown' : 'handoff', turn: result, intent: dto.intent, confidence: out.confidence, startedAt: run.startedAt, meta, flags: guardFlags(result.guard) });
      return dto;
    } catch (e) {
      // a provider failure outside the model loop (vision, transcription) or any crash: the run is closed as an error
      await this.runs.finish(run.id, { status: 'error', error: e instanceof AiProviderError ? e.kind : e instanceof AppException ? e.code : 'internal_error', startedAt: run.startedAt }).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Primary photos of the agent's catalogue. `ProductImage` has no `workspaceId` (not a tenant model): the tenant extension
   * never scopes it, and the nested `product` filter is not scoped either — the workspace is written here (rule 1; with an
   * « all products » agent the bare scope matched the photos of every shop: the photo scenario ran on another shop's photo).
   */
  private photoWhere(agent: Agent): Prisma.ProductImageWhereInput {
    return { isPrimary: true, product: { ...this.catalogue.scopeWhere(agent), workspaceId: TenantContext.workspaceId() } };
  }

  /** Why the photo scenario cannot be run for this agent (null = it can): photos off, or no product photo in its scope. */
  private async photoUntested(agent: Agent): Promise<'image_off' | 'no_photo' | null> {
    if (!agent.imageRecognition) return 'image_off';
    return (await prisma.productImage.count({ where: this.photoWhere(agent) })) ? null : 'no_photo';
  }

  private async samplePhoto(agent: Agent) {
    const img = await prisma.productImage.findFirst({ where: this.photoWhere(agent), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
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
    const runs = await prisma.aiRun.findMany({ where: { agentId, batchKey: sessionId, kind: { in: ['test', 'test_scenario'] } }, orderBy: { startedAt: 'asc' }, include: { toolCalls: { orderBy: { id: 'asc' } } } });
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

  static check(key: TestScenarioKey, turn: PlaygroundTurnDto, inScope: Set<string>, limits: { maxQty?: number | null } = {}): { pass: boolean; failed: ScenarioCheck[] } {
    const s = SCENARIOS[key];
    // full-test 15/11 AI-CHAT-06 / proposal 12: the reply's language must be the customer's — the reply guard's own check
    // (`language_switch`: arabizi answered in French fails; a reply too short to tell, or mixed, passes)
    const sameScript = !languageSwitched(s.language, turn.reply);
    const created = turn.toolCalls.filter((t) => t.name === 'create_order' && (t.result as { ok?: boolean } | null)?.ok === true);
    const results: Record<ScenarioCheck, boolean> = {
      // full-test 15/11 AGENTS-02: a hand-off answers with the shop's hand-off message (the AI's own text is empty)
      replied: turn.reply.trim().length > 0 || turn.status === 'HANDOFF',
      language_respected: sameScript,
      no_invented_product: turn.cards.every((c) => inScope.has(c.productId)),
      handoff_on_complaint: !s.expect.handoff || turn.status === 'HANDOFF',
      order_created_simulated: created.every((t) => t.simulated),
      // journey re-run J03r-2 (18/11): no order AND, when the scenario's quantity is above the agent's « Quantité max par commande », the
      // turn handed to the team for the limit (04-ai-pipeline rule 32) — « Ensuite, je vérifierai si on peut vous fournir 500 pièces »
      // passed on « no order created », which a first message with no name / phone can never fail
      limits_respected: created.length === 0 && (!SCENARIO_QUANTITY[key] || limits.maxQty === null || limits.maxQty === undefined || SCENARIO_QUANTITY[key]! <= limits.maxQty || (turn.status === 'HANDOFF' && turn.statusDetail === 'order_limits')),
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
        // journey 16/11 J03-8: the photo scenario with no product photo in the agent's scope (or photos switched off) sent
        // no image and passed on any answer (« Je n'arrive pas à voir la photo ») — it is now « not tested » (⚠), no AI turn
        const untested = SCENARIOS[key].attachment === 'image' ? await this.photoUntested(agent) : null;
        if (untested) summary = `not_tested:${untested}`;
        else
          try {
            const turn = await this.turn(agent, { workspaceId: agent.workspaceId, agentId, userId: job.createdById, sessionId: `scenario:${jobId}:${key}`, turnId: randomUUID(), messages: [], scenario: key, kind: 'test_scenario' });
            aiRunId = turn.turnId;
            const c = PlaygroundService.check(key, turn, inScope, { maxQty: agent.maxQtyPerOrder });
            status = c.pass ? 'pass' : 'fail';
            // full-test 15/11 AGENTS-02: codes the wizard translates (« failed:replied » was printed as is)
            summary = c.pass ? (turn.reply.trim() ? turn.reply.slice(0, 200) : turn.status === 'HANDOFF' ? 'handoff' : null) : `failed:${c.failed.join(',')}`;
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
