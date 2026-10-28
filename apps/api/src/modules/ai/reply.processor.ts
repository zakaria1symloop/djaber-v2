// FL-01 steps 10–15 / 03-events §3.1 — `ai-reply / reply` (job id `ai:<conversationId>`, delayed by the batching window).
//   eligibility → AiRun (idempotent on the batch) → credit reservation → vision / transcripts → prompt → model loop with
//   tool replay → ONE transaction: run closed, reply + cards stored with their `meta-send` jobs (outbox), credits
//   settled, insight / handoff, conversation context.
// Idempotency: the run is closed first inside that transaction (`status = running` guard), so a job that runs twice —
// or a retry after a crash — never stores two replies and never debits twice. Nothing here talks to Meta: the reply
// leaves through the outbox → `meta-send` path like every other message.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CREDIT_COST } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Agent, type AiRun, type Channel, type Conversation, type Message, type Tx } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { acquireSemaphore, AI_REPLY_RETRY_MS, AI_REPLY_SLOT_TTL_MS, AI_REPLY_WORKSPACE_CAP, releaseSemaphore, throttleJob } from '../../core/queue/throttle';
import { RedisService } from '../../core/redis/redis.provider';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { WsEmitter } from '../../core/ws/ws.emitter';
import { ChannelTokens } from '../channels/channel.util';
import { CreditService } from '../credits/credit.service';
import { BatchingService, type AiReplyJob } from '../messaging/batching.service';
import { ConversationService } from '../messaging/conversation.service';
import { attachmentsOf, contextOf, type ConversationContext } from '../messaging/messaging.presenter';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { containsBlockedWord } from '../messaging/safety.service';
import { withinWindow } from '../messaging/window-rules';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { NotificationProducer } from '../notifications/notification.producer';
import { CrossSellService } from '../recommendations/cross-sell.service';
import { AI_ERROR_ALERT_FAILURES, AI_ERROR_ALERT_WINDOW_S, LAST_PRODUCTS_MAX, MEDIA_WAIT_MS, MEDIA_WAIT_STEP_MS, plannedCost, RUN_BUDGET_MS, UNCLEAR_STREAK_HANDOFF } from './ai.constants';
import { AiRunService, intentOf, type RunMeta, type TurnResult } from './ai-run.service';
import { CatalogueService } from './catalogue.service';
import { InsightService } from './insight.service';
import { detectLanguage, type AiLanguage } from './language';
import { PromptBuilder, type HistoryMessage } from './prompt/prompt-builder';
import { AiProviderError } from './provider/ai.gateway';
import { TurnContextService } from './turn-context.service';
import { VisionService, visionNoteText, type VisionNote } from './vision.service';

export type ReplyOutcome = 'sent' | 'noop' | 'empty' | 'exhausted' | 'failed' | 'aborted' | `skipped:${string}`;
type JobInfo = Pick<Job, 'attemptsMade' | 'opts'>;
type Batch = { messages: Message[]; text: string; plain: string; hasAudio: boolean; images: { messageId: string; index: number; storageKey: string | null; mime: string }[] };

/** A photo of the batch the `media` job has not stored yet (neither stored nor failed). */
const mediaPending = (b: Batch) => b.messages.some((m) => attachmentsOf(m).some((a) => a.type === 'image' && a.pending && !a.error));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CARD_NAMES = (m: Message) => ((m.payload as { cards?: { name: string }[] } | null)?.cards ?? []).map((c) => c.name).join(', ');

/** A4: non-empty values of this turn over the stored ones. */
export const mergeCustomer = (stored: ConversationContext['customer'], turn: ConversationContext['customer']): ConversationContext['customer'] => {
  const out = { ...(stored ?? {}) } as Record<string, string>;
  for (const [k, v] of Object.entries(turn ?? {})) if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 500);
  return Object.keys(out).length ? out : undefined;
};

@Injectable()
export class ReplyProcessor implements OnModuleInit {
  private readonly log = new Logger(ReplyProcessor.name);
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly tokens: ChannelTokens,
    private readonly runs: AiRunService,
    private readonly credits: CreditService,
    private readonly context: TurnContextService,
    private readonly catalogue: CatalogueService,
    private readonly vision: VisionService,
    private readonly insights: InsightService,
    private readonly batching: BatchingService,
    private readonly conversations: ConversationService,
    private readonly outbound: OutboundSendService,
    private readonly notifications: NotificationProducer,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
    private readonly crossSell: CrossSellService,
    private readonly ws: WsEmitter,
  ) {}

  onModuleInit() {
    this.registry.register('ai-reply', 'reply', (d: AiReplyJob, job: Job) => this.process(d, job), { concurrency: 8 });
  }

  async process(d: AiReplyJob, job?: JobInfo): Promise<ReplyOutcome> {
    const ws = await this.tenants.workspaceCtx(d.workspaceId);
    if (!ws || ws.status !== 'active') return 'skipped:workspace';
    const tenant = await this.tenants.forWorker(d.workspaceId);
    // 03-events §3: at most 2 `ai-reply` runs per workspace at a time (Redis semaphore; a capped job is re-delayed 2 s
    // without consuming an attempt; a holder that crashed stops counting after its TTL)
    const slotKey = `ai-reply:${d.workspaceId}`;
    const member = String((job as { id?: string } | undefined)?.id ?? `ai:${d.conversationId}`);
    await throttleJob(job, async () => ({ ok: await acquireSemaphore(this.redis.client, slotKey, member, AI_REPLY_WORKSPACE_CAP, AI_REPLY_SLOT_TTL_MS), retryInMs: AI_REPLY_RETRY_MS }), 120_000);
    try {
      return await TenantContext.run(tenant, () => this.run(d, job));
    } finally {
      await releaseSemaphore(this.redis.client, slotKey, member);
    }
  }

  // --- batch ------------------------------------------------------------------------------------------------------------------
  private async batch(conv: Conversation, batchKey: string, agent: Agent, until?: Date): Promise<Batch | null> {
    const first = await prisma.message.findFirst({ where: { id: batchKey, conversationId: conv.id } });
    if (!first) return null;
    const messages = await prisma.message.findMany({ where: { conversationId: conv.id, direction: 'in', author: 'customer', createdAt: { gte: first.createdAt, ...(until ? { lte: until } : {}) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const lines: string[] = [];
    const plain: string[] = [];
    const images: Batch['images'] = [];
    let hasAudio = false;
    for (const m of messages) {
      if (m.text?.trim()) {
        lines.push(m.text.trim());
        plain.push(m.text.trim());
      }
      attachmentsOf(m).forEach((a, index) => {
        if (a.type === 'audio' && m.transcript?.trim()) {
          hasAudio = true;
          lines.push(`[voice note transcript]: ${m.transcript.trim()}`);
          plain.push(m.transcript.trim());
        }
        // FL-01 step 7: with image recognition off the images are dropped and the text is answered alone
        if (a.type === 'image' && agent.imageRecognition) images.push({ messageId: m.id, index, storageKey: a.pending || a.error ? null : (a.storageKey ?? null), mime: a.mime || 'image/jpeg' });
      });
    }
    return { messages, text: lines.join('\n'), plain: plain.join('\n'), hasAudio, images };
  }

  private async history(conv: Conversation, before: Date): Promise<HistoryMessage[]> {
    const rows = await prisma.message.findMany({ where: { conversationId: conv.id, createdAt: { lt: before }, type: { not: 'system' }, author: { in: ['customer', 'ai', 'human'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, include: { authorUser: { select: { firstName: true } } } });
    return rows.reverse().map((m) => ({
      author: m.author as HistoryMessage['author'],
      humanName: m.authorUser?.firstName ?? null,
      text: [m.text?.trim() ?? '', m.transcript ? `[voice note transcript]: ${m.transcript}` : '', ...attachmentsOf(m).filter((a) => a.type === 'image').map(() => '[image]'), m.type === 'product_cards' ? `[product cards: ${CARD_NAMES(m)}]` : ''].filter(Boolean).join('\n'),
    }));
  }

  // --- the job -----------------------------------------------------------------------------------------------------------------
  private async run(d: AiReplyJob, job?: JobInfo): Promise<ReplyOutcome> {
    const conv = await prisma.conversation.findFirst({ where: { id: d.conversationId, deletedAt: null }, include: { channel: true } });
    if (!conv) return 'skipped:conversation';
    // the batch is closed: the next customer message opens a new one
    await this.batching.close(conv.id);
    if (conv.status === 'needs_human' || conv.aiPaused) return 'skipped:human';
    if (conv.channel.status !== 'active') return 'skipped:channel';
    const link = await prisma.agentChannel.findUnique({ where: { channelId: conv.channelId }, include: { agent: true } });
    const agent = link?.agent;
    if (!agent || agent.status !== 'active' || agent.deletedAt) return 'skipped:agent';

    const already = await prisma.aiRun.findFirst({ where: { conversationId: conv.id, batchKey: d.batchKey } });
    if (already && already.status !== 'running') return 'noop';
    let batch = await this.batch(conv, d.batchKey, agent, already?.startedAt);
    if (!batch) return 'skipped:batch';
    // PV 28/10 (« l'agent IA ne reconnaît pas les photos envoyées depuis Messenger »): the reply used to start while the
    // photo was still being downloaded from Meta and answered without it (IMAGE RESULT: unavailable); it now waits for it
    for (const until = Date.now() + MEDIA_WAIT_MS; batch && agent.imageRecognition && mediaPending(batch) && Date.now() < until; ) {
      await sleep(MEDIA_WAIT_STEP_MS);
      batch = await this.batch(conv, d.batchKey, agent, already?.startedAt);
    }
    if (!batch) return 'skipped:batch';
    if (!batch.text.trim() && !batch.images.length) return 'empty';

    // 04-ai-pipeline §12: the AI never sends outside the 24 h window (and never with a tag)
    if (!withinWindow(conv.lastCustomerMessageAt, new Date())) {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        if (await this.conversations.handoff(conv.id, 'outside_window', { silent: true, tx })) await this.insights.create(tx, { agent, conversationId: conv.id, messageId: batch.messages[0]?.id, type: 'handoff', customerMessage: batch.plain || '[image]', detail: 'outside_window' });
      });
      return 'skipped:window';
    }

    const attempt = (job?.attemptsMade ?? 0) + 1;
    const cost = plannedCost({ hasAudio: batch.hasAudio, hasImage: batch.images.length > 0 });
    const { run, state } = await this.runs.start({ workspaceId: conv.workspaceId, conversationId: conv.id, agentId: agent.id, kind: 'reply', batchKey: d.batchKey, attempt, meta: { plannedCost: cost } });
    if (state === 'done') return 'noop';
    const ref = { id: run.id, workspaceId: conv.workspaceId, agentId: agent.id, conversationId: conv.id, channelId: conv.channelId };

    // FL-01 step 10: reserve the planned credits (F-4 when the balance went to 0 since the inbound gate)
    if (!(await this.credits.reserve(ref, cost))) {
      await this.runs.finish(run.id, { status: 'error', error: 'INSUFFICIENT_CREDITS', startedAt: run.startedAt });
      const b = await this.credits.balance(conv.workspaceId);
      await this.conversations.aiUnavailable(conv.id, 'credits', { used: b.planUsed, limit: b.planLimit });
      return 'exhausted';
    }

    // M11: "IA répond…" in the inbox — ephemeral, so emitted directly (Redis emitter) rather than through the outbox
    this.aiTyping(conv.workspaceId, conv.id, true);
    try {
      return await this.answer(conv, agent, run, ref, batch, { attempt, max: job?.opts?.attempts ?? 1 });
    } catch (e) {
      // an unexpected error on the last attempt must not leave a reservation behind (the reaper would release it 5 min later)
      if (attempt >= (job?.opts?.attempts ?? 1)) {
        await this.fail(conv, agent, run, null, 'internal_error', batch).catch((err) => this.log.error({ runId: run.id, err: String(err) }, 'could not close a failed run'));
      }
      throw e;
    } finally {
      this.aiTyping(conv.workspaceId, conv.id, false);
    }
  }

  /** WS `conversation.typing { conversationId, ai: true, active }` around the AI reply (03-events §2, M11). */
  private aiTyping(workspaceId: string, conversationId: string, active: boolean) {
    try {
      this.ws.emit(`ws:${workspaceId}`, 'conversation.typing', { conversationId, ai: true, active, at: new Date().toISOString() });
    } catch (err) {
      this.log.warn({ conversationId, err: String(err) }, 'ai typing event not emitted');
    }
  }

  private async typing(channel: Channel, recipientId: string) {
    const auth = this.tokens.auth(channel);
    // AI-12: typing indicator before generation (best effort)
    if (auth) await this.meta.senderAction(auth, recipientId, 'typing_on').catch(() => undefined);
  }

  private async answer(
    conv: Conversation & { channel: Channel },
    agent: Agent,
    run: AiRun,
    ref: { id: string; workspaceId: string; agentId: string; conversationId: string; channelId: string },
    batch: Batch,
    attempts: { attempt: number; max: number },
  ): Promise<ReplyOutcome> {
    const deadline = Date.now() + RUN_BUDGET_MS;
    const ctx = contextOf(conv);
    const lang: AiLanguage = detectLanguage(batch.plain, ctx.lastLanguage as AiLanguage | undefined) ?? 'fr';
    await this.typing(conv.channel, conv.externalSenderId);

    // --- vision (AI-06): notes are kept on the run so a retry does not pay the provider twice ---------------------------------
    const stored = ((run.meta as RunMeta | null)?.vision ?? {}) as Record<string, VisionNote>;
    const notes: Record<string, VisionNote> = { ...stored };
    let visionMatched = Object.values(stored).some((n) => n.kind === 'match' || n.kind === 'unsure');
    let providerFailure: string | null = null;
    for (const img of batch.images) {
      const key = `${img.messageId}:${img.index}`;
      if (notes[key]) continue;
      try {
        const file = img.storageKey ? await this.storage.get(img.storageKey).catch(() => null) : null;
        const r = await this.vision.analyse(agent, file ? { body: file.body, mime: file.mime || img.mime } : null);
        notes[key] = r.note;
        visionMatched ||= r.matched;
      } catch (e) {
        // no vision model on the platform: the photo is simply not analysed
        if (e instanceof AppException && e.code === 'AGENT_MODEL_UNAVAILABLE') {
          notes[key] = { kind: 'unavailable' };
          continue;
        }
        if (!(e instanceof AiProviderError)) throw e;
        providerFailure = e.kind;
        break;
      }
    }
    if (providerFailure) return this.providerFailed(conv, agent, run, null, providerFailure, batch, attempts);
    if (Object.keys(notes).length !== Object.keys(stored).length) await prisma.aiRun.update({ where: { id: run.id }, data: { meta: { ...((run.meta as object | null) ?? {}), vision: notes } as Prisma.InputJsonValue } });
    // §7: image ⇒ 5 credits once pass 2 succeeded (even if the send fails later); audio ⇒ 3 once transcribed
    if (visionMatched) await this.credits.settle(ref, 'image_recognition', { amount: CREDIT_COST.image });
    else if (batch.hasAudio) await this.credits.settle(ref, 'voice_transcription', { amount: CREDIT_COST.voice });

    // --- prompt ----------------------------------------------------------------------------------------------------------------
    const noteLines = batch.images.map((img) => `[image]\n${visionNoteText(notes[`${img.messageId}:${img.index}`] ?? { kind: 'unavailable' })}`);
    const batchText = [batch.text, ...noteLines].filter(Boolean).join('\n');
    const matchedIds = Object.values(notes).flatMap((n) => (n.kind === 'match' ? [n.productId] : []));
    const turnCtx = await this.context.load(agent, { text: batch.plain, lastProductIds: [...matchedIds, ...(ctx.lastProductIds ?? [])], lang, unclearStreak: ctx.unclearStreak ?? 0, clientId: conv.clientId, customer: ctx.customer });
    const history = await this.history(conv, batch.messages[0]!.createdAt);
    const prompt = PromptBuilder.build(turnCtx.prompt, history, batchText, { contextTokens: turnCtx.model.contextTokens, maxTokens: turnCtx.maxTokens });

    // --- model loop ------------------------------------------------------------------------------------------------------------
    const turn = await this.runs.turn({
      runId: run.id,
      prompt,
      toolCtx: { workspaceId: conv.workspaceId, agent, conversationId: conv.id, clientId: conv.clientId, channelId: conv.channelId, runId: run.id, dryRun: false },
      temperature: turnCtx.temperature,
      maxTokens: turnCtx.maxTokens,
      deadline,
    });
    if (!turn.ok) {
      if (turn.kind === 'provider') return this.providerFailed(conv, agent, run, turn, turn.error, batch, attempts);
      // malformed twice ⇒ F-6 at once (a third attempt would not fix the model)
      await this.fail(conv, agent, run, turn, turn.error, batch);
      return 'failed';
    }
    return this.finalize(conv, agent, run, ref, batch, turn, { lang, outOfHours: turnCtx.prompt.outOfHours, matchedIds });
  }

  /** F-6 with retries left ⇒ the job is retried (the run and its reservation stay); last attempt ⇒ final failure. */
  private async providerFailed(conv: Conversation, agent: Agent, run: AiRun, turn: TurnResult | null, error: string, batch: Batch, attempts: { attempt: number; max: number }): Promise<ReplyOutcome> {
    if (attempts.attempt < attempts.max) throw new Error(`ai provider unavailable (${error}), attempt ${attempts.attempt}/${attempts.max}`);
    await this.fail(conv, agent, run, turn, error, batch);
    return 'failed';
  }

  /** FL-01 F-6: no customer message, credits released, insight `error`, conversation to the queue, Owner alerted on repeated failures. */
  private async fail(conv: Conversation, agent: Agent, run: AiRun, turn: TurnResult | null, error: string, batch: Batch) {
    const closed = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (!(await this.runs.finish(run.id, { status: 'error', error, startedAt: run.startedAt, turn: turn ?? undefined }, tx))) return false;
      await this.credits.release(run, tx);
      await this.conversations.handoff(conv.id, 'ai_error', { silent: true, tx, context: { aiUnavailable: 'error' } });
      await this.insights.create(tx, { agent, conversationId: conv.id, messageId: batch.messages[batch.messages.length - 1]?.id, aiRunId: run.id, type: 'error', customerMessage: batch.plain || '[image]', detail: error });
      return true;
    });
    if (!closed) return;
    const key = `ai:fail:${conv.workspaceId}`;
    const failures = await this.redis.client.incr(key);
    if (failures === 1) await this.redis.client.expire(key, AI_ERROR_ALERT_WINDOW_S);
    if (failures >= AI_ERROR_ALERT_FAILURES) {
      const provider = turn?.model?.provider ?? 'ai';
      await prisma.$transaction((db) => this.notifications.emit(db as Tx, { type: 'ai_error', workspaceId: conv.workspaceId, target: { owner: true }, key: `ai_error:${conv.workspaceId}:${Math.floor(Date.now() / (AI_ERROR_ALERT_WINDOW_S * 1000))}`, data: { provider, failures } }));
    }
  }

  private async blockedWord(workspaceId: string, text: string): Promise<{ word: string; platform: boolean } | null> {
    if (!text.trim()) return null;
    const [ws, rows] = await Promise.all([prisma.workspace.findUnique({ where: { id: workspaceId }, select: { blockedWords: true } }), TenantContext.runSystem(() => prisma.blockedWord.findMany({ where: { OR: [{ workspaceId: null }, { workspaceId }] }, select: { word: true, workspaceId: true } }))]);
    const platform = rows.find((r) => r.workspaceId === null && containsBlockedWord(text, [r.word]));
    if (platform) return { word: platform.word, platform: true };
    const own = [...(ws?.blockedWords ?? []), ...rows.filter((r) => r.workspaceId).map((r) => r.word)].find((w) => containsBlockedWord(text, [w]));
    return own ? { word: own, platform: false } : null;
  }

  private async finalize(
    conv: Conversation,
    agent: Agent,
    run: AiRun,
    ref: { id: string; workspaceId: string; agentId: string; conversationId: string; channelId: string },
    batch: Batch,
    turn: Extract<TurnResult, { ok: true }>,
    o: { lang: AiLanguage; outOfHours: boolean; matchedIds: string[] },
  ): Promise<ReplyOutcome> {
    const out = turn.output;
    const blocked = await this.blockedWord(conv.workspaceId, out.reply);
    // AI-14: cards only for products the agent may sell right now
    const cards = blocked ? [] : (await this.catalogue.byIds(agent, out.productCards)).map((p) => p.id);
    const toolProducts = turn.tools.flatMap((t) => ((t.result as { products?: { id: string }[] } | null)?.products ?? []).map((p) => p.id).slice(0, 3));
    const last = batch.messages[batch.messages.length - 1]!;
    const streak = (contextOf(conv).unclearStreak ?? 0) + (out.status === 'UNCLEAR' ? 1 : 0);
    let status: 'ok' | 'unclear' | 'unknown' | 'handoff' = out.status === 'OK' ? 'ok' : out.status === 'UNCLEAR' ? 'unclear' : out.status === 'UNKNOWN' ? 'unknown' : 'handoff';
    let reason = out.status === 'HANDOFF' ? (out.statusDetail?.trim() || 'other') : null;
    if (turn.forcedHandoff) {
      status = 'handoff';
      reason = turn.forcedHandoff;
    } else if (status === 'unclear' && streak >= UNCLEAR_STREAK_HANDOFF) {
      status = 'handoff';
      reason = 'unclear_streak';
    }
    if (blocked) {
      status = 'handoff';
      reason = 'blocked_word';
    }
    const replyText = blocked ? '' : out.reply.trim();

    return prisma.$transaction(async (db): Promise<ReplyOutcome> => {
      const tx = db as Tx;
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conv.id}::uuid FOR UPDATE`;
      const fresh = await tx.conversation.findFirstOrThrow({ where: { id: conv.id } });
      // a member took the thread while the model was thinking: nothing is sent, nothing is charged
      if (fresh.status === 'needs_human' || fresh.aiPaused || fresh.deletedAt) {
        if (await this.runs.finish(run.id, { status: 'error', error: 'aborted', startedAt: run.startedAt, turn }, tx)) await this.credits.release(run, tx);
        return 'aborted';
      }
      // the run is closed first: a second execution of the same batch stops here and stores nothing
      const closed = await this.runs.finish(
        run.id,
        { status, turn, intent: intentOf(out.intent), confidence: out.confidence, startedAt: run.startedAt, flags: [...(blocked ? ['blocked_word'] : []), ...(turn.salvaged ? ['format_salvaged'] : [])], meta: { language: out.language ?? o.lang, cardsSent: cards.length, handoff: status === 'handoff' || status === 'unknown' } },
        tx,
      );
      if (!closed) return 'noop';

      // §5 welcome: before the first AI reply of a conversation nobody answered yet (empty workspace text ⇒ skipped)
      const answeredBefore = await tx.message.count({ where: { conversationId: conv.id, author: { in: ['ai', 'human'] } } });
      if (!answeredBefore && !blocked) await this.outbound.sendSystemText(conv.id, 'welcome', {}, { tx, oncePer24h: true });
      // §3.2 out of hours: standalone workspace text before the reply, once per conversation per 24 h
      if (o.outOfHours && !blocked) await this.outbound.sendSystemText(conv.id, 'out_of_hours', {}, { tx, oncePer24h: true });

      let replyId: string | null = null;
      if (replyText) replyId = (await this.outbound.store(tx, conv.id, { author: 'ai', kind: 'ai', text: replyText, aiRunId: run.id })).message.id;
      // §16: the text first, then ≤ 5 cards as their own message
      if (replyText && cards.length) await this.outbound.sendCards(conv.id, cards, { tx, aiRunId: run.id, author: 'ai', kind: 'ai' });
      // REC-03: the cross-sell suggestions of a sent reply count as impressions (≤ 3, active rules only)
      if (replyId && out.recommendations?.length) await this.crossSell.impressions(tx, conv.id, out.recommendations);

      const latest = await tx.conversation.findFirstOrThrow({ where: { id: conv.id } });
      const context: ConversationContext = {
        ...contextOf(latest),
        lastLanguage: o.lang,
        lastProductIds: [...new Set([...cards, ...o.matchedIds, ...toolProducts, ...(contextOf(latest).lastProductIds ?? [])])].slice(0, LAST_PRODUCTS_MAX),
        unclearStreak: out.status === 'UNCLEAR' ? streak : 0,
        aiUnavailable: null,
        // A4: what the customer gave is kept, a later turn only adds or corrects (an empty value never erases)
        customer: mergeCustomer(contextOf(latest).customer, out.customer),
      };
      await tx.conversation.update({ where: { id: conv.id }, data: { lastAiIntent: intentOf(out.intent), agentId: agent.id, context: context as Prisma.InputJsonValue } });
      await tx.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } });

      // §10 handoff & insights
      const customerMessage = batch.plain || '[image]';
      if (status === 'unclear') await this.insights.create(tx, { agent, conversationId: conv.id, messageId: last.id, aiRunId: run.id, type: 'unclear', customerMessage, aiResponse: replyText, detail: out.statusDetail ?? null });
      if (status === 'unknown' || status === 'handoff') {
        // UNKNOWN: the reply is sent and the thread only goes to the queue; HANDOFF: the workspace `handoff` text follows
        await this.conversations.handoff(conv.id, status === 'unknown' ? (out.statusDetail?.trim() || 'unknown') : reason!, { tx, silent: status === 'unknown' });
        await this.insights.create(tx, {
          agent,
          conversationId: conv.id,
          messageId: last.id,
          aiRunId: run.id,
          type: blocked ? 'error' : status === 'unknown' ? 'unknown_topic' : 'handoff',
          customerMessage,
          aiResponse: blocked ? null : replyText,
          detail: blocked ? `blocked_word:${blocked.word}` : status === 'unknown' ? (out.statusDetail ?? null) : reason,
          ...(status === 'handoff' && !blocked ? { topicKey: `handoff:${reason}` } : {}),
        });
      }
      for (const t of turn.tools) {
        const r = t.result as { suggestInsight?: boolean; topicKey?: string } | null;
        if (r?.suggestInsight) await this.insights.create(tx, { agent, conversationId: conv.id, messageId: last.id, aiRunId: run.id, type: 'unknown_topic', customerMessage: String(t.args.question ?? customerMessage), detail: 'faq_candidate', topicKey: r.topicKey ?? null });
      }
      // D37: a platform-listed word in an AI message is reported for moderation
      if (blocked?.platform) {
        await TenantContext.runSystem(() => tx.report.create({ data: { workspaceId: conv.workspaceId, type: 'ai_message', reporterKind: 'system', conversationId: conv.id, aiRunId: run.id, reason: 'inappropriate_content', details: `blocked_word:${blocked.word}`, severity: 'high' } }));
      }

      // §7: a text turn is charged when its reply is queued for sending; a reply that was not sent is not charged
      if (replyId) await this.credits.settle(ref, 'text_reply', { tx, amount: CREDIT_COST.text });
      else await this.credits.release(run, tx);
      return replyId ? 'sent' : 'noop';
    });
  }
}
