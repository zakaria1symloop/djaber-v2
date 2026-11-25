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
import { CARD_POSTBACK } from '../messaging/product-card';
import { containsBlockedWord } from '../messaging/safety.service';
import { withinWindow } from '../messaging/window-rules';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { AdminNotifier } from '../notifications/admin-notifier.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { CrossSellService } from '../recommendations/cross-sell.service';
import { AI_ERROR_ALERT_FAILURES, AI_ERROR_ALERT_WINDOW_S, GUARD_EARLIER_TOOL_CALLS, LAST_PRODUCTS_MAX, MEDIA_WAIT_MS, MEDIA_WAIT_STEP_MS, NEW_VISIT_AFTER_MS, NEW_VISIT_NOTE, plannedCost, RESUMED_NOTE, RUN_BUDGET_MS, UNCLEAR_STREAK_HANDOFF } from './ai.constants';
import { AiRunService, guardFlags, intentOf, type RunMeta, type TurnResult } from './ai-run.service';
import { CatalogueService } from './catalogue.service';
import { InsightService } from './insight.service';
import { systemLang, turnLanguage, type AiLanguage } from './language';
import { PromptBuilder, type HistoryMessage } from './prompt/prompt-builder';
import { FIELD_QUESTIONS, guardFactsOf, SAFE_SENTENCES } from './reply-guard';
import { handoffSystemLineShown } from './reply-fixes';
import { AiProviderError } from './provider/ai.gateway';
import { canonicalTool } from './tools/tool-registry';
import { latestRecap, nextChosen, orderHistoryOf, placedThisTurn } from './tools/order-confirmation';
import { orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import { TurnContextService } from './turn-context.service';
import { VisionService, visionNoteText, type VisionNote } from './vision.service';

export type ReplyOutcome = 'sent' | 'noop' | 'empty' | 'exhausted' | 'failed' | 'aborted' | `skipped:${string}`;
type JobInfo = Pick<Job, 'attemptsMade' | 'opts'>;
type Batch = { messages: Message[]; text: string; plain: string; hasAudio: boolean; images: { messageId: string; index: number; storageKey: string | null; mime: string }[] };

/** PV 09/11: the products whose « Plus de photos » the customer tapped in this batch (their gallery is sent). */
const photosTapped = (b: Pick<Batch, 'messages'>): string[] =>
  b.messages.flatMap((m) => {
    const hit = CARD_POSTBACK.exec((m.payload as { postback?: string } | null)?.postback ?? '');
    return hit && hit[1]!.toUpperCase() === 'PHOTOS' ? [hit[2]!] : [];
  });
/** A photo of the batch the `media` job has not stored yet (neither stored nor failed). */
const mediaPending = (b: Batch) => b.messages.some((m) => attachmentsOf(m).some((a) => a.type === 'image' && a.pending && !a.error));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CARD_NAMES = (m: Message) => ((m.payload as { cards?: { name: string }[] } | null)?.cards ?? []).map((c) => c.name).join(', ');

/**
 * Houssem live 25/11 UX-098 (voice note « بغيت نكوموندي واحد satin dress روج »: `create_order {}` refused for its missing fields, then an
 * empty reply — the customer got no answer). What is sent instead of silence: the question for the first order field the refused
 * create_order lacked and the conversation does not know yet, else « which product, and your wilaya? ».
 */
export const silentTurnText = (tools: readonly { name: string; result: unknown }[], known: ConversationContext['customer'], lang: string): string => {
  const loc = (['fr', 'en', 'ar', 'arabizi'] as const).find((l) => l === lang) ?? 'fr';
  const have: Record<string, string | undefined> = { clientName: known?.name, clientPhone: known?.phone, wilayaId: known?.wilaya, communeName: known?.commune, address: known?.address };
  for (const t of [...tools].reverse()) {
    if (t.name !== 'create_order') continue;
    const fields = (t.result as { error?: { fields?: unknown } } | null)?.error?.fields;
    if (!Array.isArray(fields)) continue;
    const next = ['clientName', 'clientPhone', 'wilayaId', 'communeName', 'address'].find((f) => fields.includes(f) && !have[f]?.trim());
    if (next) return FIELD_QUESTIONS[next]![loc];
    break;
  }
  return SAFE_SENTENCES.which[loc];
};

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
    private readonly admins: AdminNotifier,
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

  /**
   * The earlier messages (oldest first); a customer message after a long pause carries the NEW_VISIT note, the first one
   * after the team gave the thread back (`context.resumedAt`, retest 12/11) the RESUMED note — `resumed`: the batch itself
   * is the first customer message after it.
   * R23 (22/11, Boutique de Lalla 20/11): the shop's answers written after the batch's first message are history too — « السلام عليكم »
   * then « كيف يمكنني » 7 s later: the second batch began before the first reply was saved, the run did not see it and greeted again
   * (and the repeat_greeting check thought it was the first reply).
   */
  private async history(conv: Conversation, before: Date): Promise<{ messages: HistoryMessage[]; newVisit: boolean; resumed: boolean }> {
    const rows = (await prisma.message.findMany({ where: { conversationId: conv.id, type: { not: 'system' }, OR: [{ createdAt: { lt: before }, author: { in: ['customer', 'ai', 'human'] } }, { createdAt: { gte: before }, author: { in: ['ai', 'human'] } }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, include: { authorUser: { select: { firstName: true } } } })).reverse();
    const gap = (i: number) => i > 0 && rows[i]!.createdAt.getTime() - rows[i - 1]!.createdAt.getTime() > NEW_VISIT_AFTER_MS;
    const stamp = contextOf(conv).resumedAt;
    const resumedAt = stamp ? new Date(stamp).getTime() : null;
    const backAt = resumedAt === null ? -1 : rows.findIndex((m) => m.author === 'customer' && m.createdAt.getTime() >= resumedAt);
    const messages = rows.map((m, i) => {
      const text = [m.text?.trim() ?? '', m.transcript ? `[voice note transcript]: ${m.transcript}` : '', ...attachmentsOf(m).filter((a) => a.type === 'image').map(() => '[image]'), m.type === 'product_cards' ? `[product cards: ${CARD_NAMES(m)}]` : ''].filter(Boolean).join('\n');
      const note = m.author !== 'customer' || !text ? null : i === backAt ? RESUMED_NOTE : gap(i) ? NEW_VISIT_NOTE : null;
      return { author: m.author as HistoryMessage['author'], humanName: m.authorUser?.firstName ?? null, text: note ? `${note}\n${text}` : text };
    });
    const last = rows[rows.length - 1];
    return { messages, newVisit: !!last && before.getTime() - last.createdAt.getTime() > NEW_VISIT_AFTER_MS, resumed: resumedAt !== null && resumedAt <= before.getTime() && backAt < 0 };
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
    // journey 16/11 J05-8: a turn with no clue (phone number, name) keeps the conversation's language, Arabic script included
    // journey 16/11 J04-2: the first message with no clue takes the shop's language (agent default, else workspace), not English
    const lang: AiLanguage = turnLanguage(batch.plain, ctx.lastLanguage as AiLanguage | undefined, { agentDefault: agent.defaultLanguage, workspaceLocale: TenantContext.get().locale });
    // client list L4 / L27 (25/11): the « typing » call to Meta was awaited before anything else (a network round trip per reply); it
    // is best effort and already sent when the message arrived — it now runs beside the turn
    void this.typing(conv.channel, conv.externalSenderId);
    // where the time of a reply goes, in ms since the run started (AiRun.meta.timing): `start` = when this stage began (job pick-up,
    // batch, credits), then the end of each stage; the model time itself is in `steps[].ms`
    const t0 = run.startedAt.getTime();
    const timing: Record<string, number> = { start: Date.now() - t0 };
    const mark = (stage: string) => void (timing[stage] = Date.now() - t0);

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

    mark('vision');
    // --- prompt ----------------------------------------------------------------------------------------------------------------
    const noteLines = batch.images.map((img) => `[image]\n${visionNoteText(notes[`${img.messageId}:${img.index}`] ?? { kind: 'unavailable' })}`);
    const batchText = [batch.text, ...noteLines].filter(Boolean).join('\n');
    const matchedIds = Object.values(notes).flatMap((n) => (n.kind === 'match' ? [n.productId] : []));
    const turnCtx = await this.context.load(agent, { text: batch.plain, lastProductIds: [...matchedIds, ...(ctx.lastProductIds ?? [])], lang, unclearStreak: ctx.unclearStreak ?? 0, clientId: conv.clientId, customer: ctx.customer, chosen: ctx.chosen ?? null });
    const history = await this.history(conv, batch.messages[0]!.createdAt);
    const lead = history.resumed ? RESUMED_NOTE : history.newVisit ? NEW_VISIT_NOTE : null;
    const prompt = PromptBuilder.build(turnCtx.prompt, history.messages, lead ? `${lead}\n${batchText}` : batchText, { contextTokens: turnCtx.model.contextTokens, maxTokens: turnCtx.maxTokens });
    // §4.3 reply guard: the facts of this turn — the prompt's catalogue and shop texts, the fees / totals the tools gave in the
    // earlier turns of the conversation, whether the AI already answered this visit (the NEW_VISIT / RESUMED notes of the history)
    const earlier = await prisma.aiToolCall.findMany({ where: { executedAt: { not: null }, aiRun: { conversationId: conv.id, id: { not: run.id } } }, orderBy: { executedAt: 'desc' }, take: GUARD_EARLIER_TOOL_CALLS, select: { result: true, name: true, args: true, executedAt: true } });
    const guard = guardFactsOf(turnCtx.prompt, { customerText: batch.plain, answeredBefore: history.messages.some((m) => m.author === 'ai' || m.author === 'human'), freshStart: history.newVisit || history.resumed, earlierToolResults: earlier.map((c) => c.result), earlierToolCalls: earlier.map((c) => ({ name: c.name, args: c.args, result: c.result, at: c.executedAt })), galleries: photosTapped(batch) });

    // full-test 15/11 AI-CHAT-01: create_order needs a recap of an earlier turn and a phone the customer typed
    const [orderHistory, customerRows] = await Promise.all([
      orderHistoryOf({ conversationId: conv.id, id: { not: run.id } }),
      prisma.message.findMany({ where: { conversationId: conv.id, author: 'customer' }, orderBy: { createdAt: 'desc' }, take: 200, select: { text: true, transcript: true } }),
    ]);
    // oldest first, as in the playground (journey retest R4-6: a later message choosing one of two phones counts after them)
    // journey re-run J04r-1 (18/11): a message's text and its voice transcript are two lines too — no number runs from one into the other
    const customerHistory = [...customerRows].reverse().map((m) => [m.text ?? '', m.transcript ?? ''].filter((x) => x.trim()).join('\n')).join('\n');

    mark('prompt');
    // --- model loop ------------------------------------------------------------------------------------------------------------
    const turn = await this.runs.turn({
      runId: run.id,
      prompt,
      // retest 12/11: a handoff is checked against the customer's words of this batch (handoff-judge)
      toolCtx: { workspaceId: conv.workspaceId, agent, conversationId: conv.id, clientId: conv.clientId, channelId: conv.channelId, runId: run.id, dryRun: false, customerText: batch.plain, unclearStreak: ctx.unclearStreak ?? 0, orderHistory, customerHistory, ordering: !!ctx.chosen?.length || !!latestRecap(orderHistory), takenIds: [...(ctx.chosen ?? []).map((c) => c.productId), ...matchedIds, ...(ctx.lastProductIds ?? [])] },
      temperature: turnCtx.temperature,
      maxTokens: turnCtx.maxTokens,
      deadline,
      guard,
    });
    if (!turn.ok) {
      if (turn.kind === 'provider') return this.providerFailed(conv, agent, run, turn, turn.error, batch, attempts);
      // malformed twice ⇒ F-6 at once (a third attempt would not fix the model)
      await this.fail(conv, agent, run, turn, turn.error, batch);
      return 'failed';
    }
    mark('turn');
    return this.finalize(conv, agent, run, ref, batch, turn, { lang, outOfHours: turnCtx.prompt.outOfHours, matchedIds, timing });
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
    o: { lang: AiLanguage; outOfHours: boolean; matchedIds: string[]; timing?: Record<string, number> },
  ): Promise<ReplyOutcome> {
    const out = turn.output;
    const blocked = await this.blockedWord(conv.workspaceId, out.reply);
    // AI-14: cards only for products the agent may sell right now
    const cardsAsked = blocked ? [] : (await this.catalogue.byIds(agent, out.productCards)).map((p) => p.id);
    // PV 09/11 « l'agent répond avec seulement l'image principale »: every picture of a product (a gallery) when the customer
    // tapped « Plus de photos » on a card or asked for more photos (`productPhotos`) — products the agent may sell only
    const askedPhotos = photosTapped(batch);
    const galleries = blocked ? [] : (await this.catalogue.byIds(agent, [...new Set([...askedPhotos, ...(out.productPhotos ?? [])])])).map((p) => p.id).slice(0, 2);
    // Houssem L28 (23/11): a product sent as its gallery is not sent again as a single card (its first photo went out twice)
    const cards = cardsAsked.filter((id) => !galleries.includes(id));
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
    // Houssem live 23/11 (H-07 13:14 / 13:16): the customer wrote again before answering a recap; create_order held the order
    // (CONFIRMATION_REQUIRED) and the model's reply came out empty — nothing was sent and the customer re-typed twice. A turn never
    // ends in silence while a recap waits: the recap goes again, with its request to answer « oui »
    const silentRecap = !blocked && !out.reply.trim() && !cards.length && out.status !== 'HANDOFF' && !turn.forcedHandoff
      ? pendingRecap(turn.tools.map((t) => (t.name === 'create_order' && t.result && typeof t.result === 'object' ? { name: t.name, result: { ...(t.result as object), recapToShow: true } } : { name: t.name, result: t.result })))
      : null;
    if (silentRecap) this.log.warn({ runId: run.id }, 'empty reply while a recap waits: the recap is sent again');
    // UX-098: nor in any other case — a turn that would send nothing asks the next order field (or what the customer wants)
    const silent = !silentRecap && !blocked && !out.reply.trim() && !cards.length && out.status !== 'HANDOFF' && !turn.forcedHandoff;
    if (silent) this.log.warn({ runId: run.id }, 'empty reply: the next question is sent instead');
    const replyText = blocked ? '' : silentRecap ? orderRecapText(silentRecap, o.lang) : silent ? silentTurnText(turn.tools.map((t) => ({ name: canonicalTool(t.name), result: t.result })), mergeCustomer(contextOf(conv).customer, out.customer), o.lang) : out.reply.trim();

    return prisma.$transaction(async (db): Promise<ReplyOutcome> => {
      const tx = db as Tx;
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${conv.id}::uuid FOR UPDATE`;
      const fresh = await tx.conversation.findFirstOrThrow({ where: { id: conv.id } });
      // a member took the thread while the model was thinking: nothing is sent, nothing is charged
      if (fresh.status === 'needs_human' || fresh.aiPaused || fresh.deletedAt) {
        if (await this.runs.finish(run.id, { status: 'error', error: 'aborted', startedAt: run.startedAt, turn }, tx)) await this.credits.release(run, tx);
        return 'aborted';
      }
      // recette 09/11 (Badro: « asking for a human gives a useless double msg »): the model's « je vous passe un conseiller »
      // and the shop's handoff text both went out — journey retest R15-2 (18/11): a request for a person now gets the server's short
      // sentence instead of the model's (ai-run `confirmed`), never an empty text
      // journey retest R2-5: an arabizi turn gets the Arabic system texts in a darija shop, the French ones otherwise
      const sysLang = systemLang(o.lang, agent.defaultLanguage, TenantContext.get().locale);
      // journey retest R15-2: the shop's handoff text is not sent out of hours (it promises a quick answer: the AI's sentence says the
      // team answers at the opening), nor in Arabic script to an arabizi customer (the AI's arabizi sentence says what the team does)
      // (a turn with no AI text — a blocked word — or handed off by the processor — the 3rd unclear message — still gets the shop's
      // text: the AI's sentence of the hand-off is written by ai-run only for its own hand-offs)
      const handoffTextShown = handoffSystemLineShown(o.lang, o.outOfHours, sysLang);
      // the run is closed first: a second execution of the same batch stops here and stores nothing
      const closed = await this.runs.finish(
        run.id,
        { status, turn, intent: intentOf(out.intent), confidence: out.confidence, startedAt: run.startedAt, flags: [...(blocked ? ['blocked_word'] : []), ...(turn.salvaged ? ['format_salvaged'] : []), ...(turn.handoffRefused ? ['handoff_refused'] : []), ...guardFlags(turn.guard)], meta: { language: out.language ?? o.lang, cardsSent: cards.length, handoff: status === 'handoff', ...(turn.guard ? { guard: turn.guard } : {}), ...(o.timing ? { timing: { ...o.timing, finalize: Date.now() - run.startedAt.getTime() } } : {}) } },
        tx,
      );
      if (!closed) return 'noop';

      // §5 welcome: before the first AI reply of a conversation nobody answered yet (empty workspace text ⇒ skipped)
      const answeredBefore = await tx.message.count({ where: { conversationId: conv.id, author: { in: ['ai', 'human'] } } });
      // journey 16/11 J04-2: in the language of the turn (a first « Bonsoir » got the workspace text, the reply another language)
      if (!answeredBefore && !blocked) await this.outbound.sendSystemText(conv.id, 'welcome', {}, { tx, oncePer24h: true, lang: sysLang });
      // §3.2 out of hours: standalone workspace text before the reply, once per conversation per 24 h
      if (o.outOfHours && !blocked) await this.outbound.sendSystemText(conv.id, 'out_of_hours', {}, { tx, oncePer24h: true, lang: sysLang });

      let replyId: string | null = null;
      if (replyText) replyId = (await this.outbound.store(tx, conv.id, { author: 'ai', kind: 'ai', text: replyText, aiRunId: run.id })).message.id;
      // §16: the text first, then ≤ 5 cards as their own message
      if (replyText && cards.length) await this.outbound.sendCards(conv.id, cards, { tx, aiRunId: run.id, author: 'ai', kind: 'ai' });
      for (const id of galleries) await this.outbound.sendCards(conv.id, [id], { tx, aiRunId: run.id, author: 'ai', kind: 'ai', gallery: true });
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
        // full-test 15/11 AI-CHAT-05: the chosen product(s) stay until an order is placed (CURRENT ORDER)
        chosen: nextChosen(contextOf(latest).chosen, out.cart, placedThisTurn(turn.tools.map((t) => ({ name: canonicalTool(t.name), result: t.result })))),
      };
      await tx.conversation.update({ where: { id: conv.id }, data: { lastAiIntent: intentOf(out.intent), agentId: agent.id, context: context as Prisma.InputJsonValue } });
      await tx.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } });

      // §10 handoff & insights
      const customerMessage = batch.plain || '[image]';
      if (status === 'unclear') await this.insights.create(tx, { agent, conversationId: conv.id, messageId: last.id, aiRunId: run.id, type: 'unclear', customerMessage, aiResponse: replyText, detail: out.statusDetail ?? null });
      if (status === 'unknown' || status === 'handoff') {
        // HANDOFF: the thread goes to the team and the workspace `handoff` text follows. UNKNOWN: the reply is sent and the
        // question is recorded for the shop (insight `unknown_topic`), the AI keeps the conversation — PV 08/11 (« l'agent
        // IA fait des confusions »): a question missing from the FAQ used to hand the whole thread over silently, so the
        // AI stopped answering that customer after one or two messages
        if (status === 'handoff') await this.conversations.handoff(conv.id, reason!, { tx, silent: !handoffTextShown && !!replyText && (out.status === 'HANDOFF' || !!turn.forcedHandoff) });
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
        const rep = await TenantContext.runSystem(() => tx.report.create({ data: { workspaceId: conv.workspaceId, type: 'ai_message', reporterKind: 'system', conversationId: conv.id, aiRunId: run.id, reason: 'inappropriate_content', details: `blocked_word:${blocked.word}`, severity: 'high' } }));
        const shop = await tx.workspace.findUnique({ where: { id: conv.workspaceId }, select: { name: true } });
        await this.admins.notify(tx, { kind: 'report_opened', key: `report_opened:${rep.id}`, params: { reason: 'inappropriate_content', from: shop?.name ?? '—' }, ids: { workspaceId: conv.workspaceId, reportId: rep.id } });
      }

      // §7: a text turn is charged when its reply is queued for sending; a reply that was not sent is not charged
      if (replyId) await this.credits.settle(ref, 'text_reply', { tx, amount: CREDIT_COST.text });
      else await this.credits.release(run, tx);
      return replyId ? 'sent' : 'noop';
    });
  }
}
