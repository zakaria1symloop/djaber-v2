// MSG-06 / MSG-07 / FL-01 F-7 — everything that leaves towards a customer. A message is stored `pending` inside the
// caller's transaction together with its `meta-send` job (outbox → queue `outbox`, job id `send:<messageId>`); the job
// talks to Meta, then the message becomes `sent` or `failed`. Messages the 24 h window forbids are stored
// `skipped_window` and never sent. The job is safe to run twice (status check + per-part bookkeeping).
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { formatMessage, formatMoney, getMessages, isAppLocale, PRODUCT_CARDS_MAX, type AppLocale, type MessageCardView } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Conversation, type MessageType, type Tx } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { MetricsService } from '../../core/metrics/metrics.service';
import { META_SEND_PER_CHANNEL_RPS, takeSlot, throttleJob } from '../../core/queue/throttle';
import { RedisService } from '../../core/redis/redis.provider';
import { approvedFields, approvedImages, approvedVariants } from '../catalog/approved-content';
import { ChannelService } from '../channels/channel.service';
import { ChannelTokens } from '../channels/channel.util';
import { ConfigService } from '../../core/config/config.service';
import { MetaError, metaErrorCode } from '../meta/meta-errors';
import { META_GATEWAY, type MetaGateway, type MetaOutgoing } from '../meta/meta.gateway';
import { previewOf } from './inbound-parser';
import { attachmentsOf, contextOf, conversationHead, messageInclude, presentMessage, type ConversationContext, type MessageRow, type StoredAttachment } from './messaging.presenter';
import { decideWindow, type SendKind, type WindowDecision } from './window-rules';

export type OutboundDraft = {
  author: 'human' | 'ai' | 'system';
  kind: SendKind;
  type?: MessageType;
  text?: string | null;
  attachments?: StoredAttachment[];
  payload?: Record<string, unknown> | null;
  authorUserId?: string | null;
  aiRunId?: string | null;
};
export type StoreOptions = {
  /** extra changes of the conversation written with the message (assignee, AI pause, version, …) */
  patch?: Prisma.ConversationUncheckedUpdateInput;
  blocked?: boolean;
  now?: Date;
};
export type SendJob = { workspaceId: string; channelId: string; conversationId: string; messageId: string; kind: SendKind; messagingType: 'RESPONSE' | 'MESSAGE_TAG'; tag?: 'HUMAN_AGENT' | 'POST_PURCHASE_UPDATE'; runId?: string | null };

const SEND_ATTEMPTS = 5;
/** FL-01 F-7: "any other error ⇒ retry 3×". */
const UNKNOWN_ERROR_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
const WORKSPACE_KEYS = new Set(['handoff', 'out_of_hours', 'welcome']);

@Injectable()
export class OutboundSendService implements OnModuleInit {
  private readonly log = new Logger(OutboundSendService.name);
  constructor(
    private readonly outbox: OutboxService,
    private readonly queue: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly redis: RedisService,
    private readonly tokens: ChannelTokens,
    private readonly channels: ChannelService,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** The Meta app may use the HUMAN_AGENT tag (approved in App Review) — `META_HUMAN_AGENT_TAG`. */
  get humanAgentTag(): boolean {
    return this.config.get('META_HUMAN_AGENT_TAG') === true;
  }

  onModuleInit() {
    this.registry.register('outbox', 'meta-send', (data: SendJob, job: Job) => this.process(data, job), { concurrency: 16 });
  }

  // --- storing ----------------------------------------------------------------------------------------------------------
  /**
   * Stores an outbound message and (unless the window forbids it) queues its send, inside `tx`.
   * A human reply outside the window on Instagram, or beyond the HUMAN_AGENT period, is refused: `422 REPLY_OUTSIDE_WINDOW`.
   */
  async store(tx: Tx, conversationId: string, draft: OutboundDraft, o: StoreOptions = {}): Promise<{ message: MessageRow; conversation: Conversation; decision: WindowDecision }> {
    const now = o.now ?? new Date();
    const conv = await tx.conversation.findFirst({ where: { id: conversationId }, include: { channel: true } });
    if (!conv) throw notFound();
    const decision = decideWindow({ platform: conv.channel.platform, kind: draft.kind, lastCustomerMessageAt: conv.lastCustomerMessageAt, now, humanAgent: this.humanAgentTag });
    if (decision.action === 'reject') throw new AppException(decision.code);
    const attachments = draft.attachments ?? [];
    const type: MessageType = draft.type ?? (attachments[0] ? (attachments[0].type as MessageType) : 'text');
    const payload = { ...(draft.payload ?? {}), ...(decision.action === 'send' && decision.tag ? { tag: decision.tag } : {}) };
    const message = await tx.message.create({
      data: {
        workspaceId: conv.workspaceId,
        conversationId: conv.id,
        direction: 'out',
        type,
        author: draft.author,
        authorUserId: draft.authorUserId ?? null,
        text: draft.text ?? null,
        attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
        payload: Object.keys(payload).length ? (payload as Prisma.InputJsonValue) : undefined,
        sentAt: now,
        deliveryStatus: decision.action === 'skip' ? 'skipped_window' : 'pending',
        aiRunId: draft.aiRunId ?? null,
      },
      include: messageInclude,
    });
    const context: ConversationContext = { ...contextOf(conv), lastDirection: 'out', ...((o.patch?.context as ConversationContext | undefined) ?? {}) };
    const conversation = await tx.conversation.update({
      where: { id: conv.id },
      data: { ...(o.patch ?? {}), lastMessageAt: now, lastMessagePreview: previewOf(message), context: context as Prisma.InputJsonValue },
    });
    if (decision.action === 'send') {
      const data: SendJob = { workspaceId: conv.workspaceId, channelId: conv.channelId, conversationId: conv.id, messageId: message.id, kind: draft.kind, messagingType: decision.messagingType, tag: decision.tag, runId: draft.aiRunId ?? null };
      await this.queue.add(tx, 'outbox', 'meta-send', data, `send:${message.id}`, { attempts: SEND_ATTEMPTS, backoff: { type: 'exponential', delay: 15_000 } });
    }
    await this.emitCreated(tx, message, conversation, o.blocked ?? false);
    return { message, conversation, decision };
  }

  async emitCreated(tx: Tx, message: MessageRow, conversation: Conversation, blocked = false) {
    await this.outbox.ws(tx, `ws:${conversation.workspaceId}`, 'message.created', { id: message.id, conversationId: conversation.id, message: presentMessage(message), conversation: conversationHead(conversation, blocked) }, `message.created:${message.id}`);
  }
  private async emitUpdated(tx: Tx, m: { id: string; workspaceId: string; conversationId: string; deliveryStatus: string; error: string | null }) {
    await this.outbox.ws(tx, `ws:${m.workspaceId}`, 'message.updated', { id: m.id, conversationId: m.conversationId, messageId: m.id, deliveryStatus: m.deliveryStatus, error: m.error }, `message.updated:${m.id}:${m.deliveryStatus}`);
  }

  /** A thread event that is never sent to the customer (`type = system`): send failures, handoff notes, order events. */
  async addThreadEvent(tx: Tx, conversation: Pick<Conversation, 'id' | 'workspaceId'>, kind: string, params: Record<string, unknown> = {}) {
    const message = await tx.message.create({
      data: { workspaceId: conversation.workspaceId, conversationId: conversation.id, direction: 'out', type: 'system', author: 'system', payload: { system: { kind, params } } as Prisma.InputJsonValue, deliveryStatus: 'sent' },
      include: messageInclude,
    });
    const conv = await tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    await this.emitCreated(tx, message, conv);
    return message;
  }

  // --- customer-facing system texts (04 §5, 11 §9) ------------------------------------------------------------------------
  /** Locale of a customer text: the customer's last language, else the workspace locale. */
  private localeOf(conv: Pick<Conversation, 'context'>, workspaceLocale: string): AppLocale {
    const l = contextOf(conv).lastLanguage;
    return isAppLocale(l) ? l : isAppLocale(workspaceLocale) ? workspaceLocale : 'fr';
  }

  /**
   * Sends `customer.<key>`: the workspace-editable texts (`handoff`, `out_of_hours`, `welcome`) come from
   * `Workspace.systemMessages`, the fixed platform texts and the transactional templates from the message catalogue.
   * `oncePer24h`: at most once per conversation per 24 h (returns null when throttled, empty or unknown).
   */
  async sendSystemText(
    conversationId: string,
    key: string,
    params: Record<string, string | number> = {},
    o: { kind?: SendKind; oncePer24h?: boolean; tx?: Tx; author?: 'system' | 'human'; authorUserId?: string | null; patch?: Prisma.ConversationUncheckedUpdateInput } = {},
  ): Promise<MessageRow | null> {
    const run = async (tx: Tx) => {
      const conv = await tx.conversation.findFirst({ where: { id: conversationId } });
      if (!conv) throw notFound();
      const ctx = contextOf(conv);
      const last = ctx.lastSystemTextAt?.[key];
      const now = new Date();
      if (o.oncePer24h && last && now.getTime() - Date.parse(last) < DAY_MS) return null;
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: conv.workspaceId }, select: { name: true, locale: true, systemMessages: true } });
      const locale = this.localeOf(conv, ws.locale);
      let template: string | undefined;
      if (WORKSPACE_KEYS.has(key)) {
        const custom = (ws.systemMessages as Record<string, Record<string, string>> | null)?.[key];
        // an empty workspace text means "do not send" (welcome); a missing one falls back to the default
        if (custom && typeof custom[locale] === 'string') template = custom[locale];
        else if (custom && typeof custom.fr === 'string') template = custom.fr;
      }
      template ??= getMessages(locale)[`customer.${key}`];
      if (!template || !template.trim()) return null;
      const text = formatMessage(template, { shop: ws.name, ...params });
      const patch: Prisma.ConversationUncheckedUpdateInput = { ...(o.patch ?? {}), context: { ...((o.patch?.context as object | undefined) ?? {}), lastSystemTextAt: { ...(ctx.lastSystemTextAt ?? {}), [key]: now.toISOString() } } as Prisma.InputJsonValue };
      const { message } = await this.store(tx, conversationId, { author: o.author ?? 'system', kind: o.kind ?? 'system', text, payload: { templateKey: key }, authorUserId: o.authorUserId ?? null }, { patch, now });
      return message;
    };
    return o.tx ? run(o.tx) : prisma.$transaction((tx) => run(tx as Tx));
  }

  /** MSG-07: product cards (image + "name / price DA"), at most 5 per reply; unknown or inactive products are skipped. */
  async sendCards(conversationId: string, productIds: string[], o: { author?: 'ai' | 'human' | 'system'; kind?: SendKind; aiRunId?: string | null; authorUserId?: string | null; tx?: Tx } = {}): Promise<MessageRow | null> {
    const run = async (tx: Tx) => {
      const wanted = [...new Set(productIds)];
      const rows = await tx.product.findMany({
        where: { id: { in: wanted }, deletedAt: null, isActive: true },
        select: { id: true, name: true, description: true, price: true, hasVariants: true, moderationStatus: true, approvedSnapshot: true, variants: { where: { deletedAt: null, isActive: true }, select: { id: true, name: true, price: true }, orderBy: { createdAt: 'asc' } } },
      });
      const images = await tx.productImage.findMany({ where: { productId: { in: rows.map((p) => p.id) } }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { productId: true, url: true } });
      // an AI card shows only what moderation approved (tester report 25/10 UX-006); a member sends the product as it is
      const ai = (o.author ?? 'ai') === 'ai';
      const imageBy = new Map(rows.map((p) => [p.id, (ai ? approvedImages(p, images.filter((i) => i.productId === p.id)) : images.filter((i) => i.productId === p.id))[0]?.url ?? null]));
      const products = rows.map((p) => (ai ? { ...p, ...approvedFields(p), variants: approvedVariants(p, p.variants) } : p));
      const byId = new Map(products.map((p) => [p.id, p]));
      const cards: MessageCardView[] = wanted
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .slice(0, PRODUCT_CARDS_MAX)
        .map((p): MessageCardView => {
          // a product with variants shows its variants and their price range, never the base price (tester report 2026-10-20)
          if (!p.hasVariants || !p.variants.length) return { productId: p.id, name: p.name, price: p.price, imageUrl: imageBy.get(p.id) ?? null };
          const prices = p.variants.map((v) => v.price);
          const [min, max] = [Math.min(...prices), Math.max(...prices)];
          return { productId: p.id, name: p.name, price: min, ...(max !== min ? { priceMax: max } : {}), variants: p.variants.map((v) => v.name).slice(0, 8).join(' · '), imageUrl: imageBy.get(p.id) ?? null };
        });
      if (!cards.length) return null;
      const { message } = await this.store(tx, conversationId, { author: o.author ?? 'ai', kind: o.kind ?? 'ai', type: 'product_cards', payload: { cards }, aiRunId: o.aiRunId ?? null, authorUserId: o.authorUserId ?? null });
      return message;
    };
    return o.tx ? run(o.tx) : prisma.$transaction((tx) => run(tx as Tx));
  }

  // --- sending (worker) -------------------------------------------------------------------------------------------------
  /** The Meta calls one stored message turns into, in order: attachments, text, then one image + caption per card. */
  static partsOf(m: Pick<MessageRow, 'text' | 'attachments' | 'payload' | 'type'>): MetaOutgoing[] {
    const parts: MetaOutgoing[] = [];
    for (const a of attachmentsOf(m)) {
      if (!a.url) continue;
      const type = a.type === 'image' || a.type === 'audio' || a.type === 'video' ? a.type : 'file';
      parts.push({ kind: 'attachment', type, url: a.url });
    }
    if (m.text) parts.push({ kind: 'text', text: m.text });
    const cards = ((m.payload as { cards?: MessageCardView[] } | null)?.cards ?? []).slice(0, PRODUCT_CARDS_MAX);
    for (const c of cards) {
      if (c.imageUrl) parts.push({ kind: 'attachment', type: 'image', url: c.imageUrl });
      parts.push({ kind: 'text', text: `${c.name}\n${c.variants ? `${c.variants}\n` : ''}${formatMoney(c.price)}${c.priceMax && c.priceMax !== c.price ? ` – ${formatMoney(c.priceMax)}` : ''}` });
    }
    return parts;
  }

  /** `outbox / meta-send`. */
  async process(data: SendJob, job?: Pick<Job, 'attemptsMade' | 'opts'>): Promise<'sent' | 'failed' | 'noop'> {
    return TenantContext.runAs(data.workspaceId, async () => {
      const m = await prisma.message.findFirst({ where: { id: data.messageId }, include: { ...messageInclude, conversation: { include: { channel: true } } } });
      if (!m || m.deliveryStatus !== 'pending') return 'noop'; // already sent / failed: a second run does nothing
      const conv = m.conversation;
      const channel = conv.channel;
      const auth = channel.status === 'active' ? this.tokens.auth(channel) : null;
      if (!auth) return this.fail(m, conv, data, channel.status === 'needs_reconnect' ? 'PAGE_TOKEN_EXPIRED' : 'REPLY_CHANNEL_INACTIVE');

      const parts = OutboundSendService.partsOf(m);
      const doneKey = `send:${m.id}:parts`;
      let done = Number((await this.redis.client.get(doneKey)) ?? 0);
      let firstMid = (await this.redis.client.get(`${doneKey}:mid`)) ?? null;
      try {
        for (let i = done; i < parts.length; i++) {
          // 03-events §3: 10 sends / s per channel (Redis window shared by the workers); a throttled job is re-delayed
          await throttleJob(job, () => takeSlot(this.redis.client, `meta-send:${data.channelId}`, META_SEND_PER_CHANNEL_RPS));
          const res = await this.meta.send(auth, { recipientId: conv.externalSenderId, message: parts[i]!, messagingType: data.messagingType, tag: data.tag });
          done = i + 1;
          firstMid ??= res.messageId || null;
          // a retry after a partial success resumes after the parts Meta already accepted
          await this.redis.client.set(doneKey, String(done), 'EX', 86_400);
          if (firstMid) await this.redis.client.set(`${doneKey}:mid`, firstMid, 'EX', 86_400);
        }
      } catch (e) {
        if (!(e instanceof MetaError)) throw e;
        const attempt = (job?.attemptsMade ?? 0) + 1;
        const max = Math.min(job?.opts?.attempts ?? SEND_ATTEMPTS, e.kind === 'unknown' ? UNKNOWN_ERROR_ATTEMPTS : SEND_ATTEMPTS);
        if (e.retryable && attempt < max) throw e; // BullMQ backoff (15 s × 2ⁿ)
        this.log.warn({ messageId: m.id, kind: e.kind, code: e.code, subcode: e.subcode, http: e.httpStatus, meta: e.message.slice(0, 300), attempt }, 'meta send failed');
        return this.fail(m, conv, data, metaErrorCode(e), e);
      }
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const r = await tx.message.updateMany({ where: { id: m.id, deliveryStatus: 'pending' }, data: { deliveryStatus: 'sent', error: null, sentAt: new Date() } });
        if (!r.count) return;
        await this.emitUpdated(tx, { ...m, deliveryStatus: 'sent', error: null });
      });
      // the Meta message id makes the echo of this send recognisable; a clash means the echo was stored first
      if (firstMid) await prisma.message.update({ where: { id: m.id }, data: { externalId: firstMid } }).catch(() => undefined);
      await this.redis.client.del(doneKey, `${doneKey}:mid`);
      return 'sent';
    });
  }

  /** Final failure of a send (05 §1.4 table): the message is `failed`; the channel / conversation follow the error class. */
  private async fail(m: MessageRow, conv: Conversation, data: SendJob, code: string, e?: MetaError): Promise<'failed'> {
    this.metrics?.metaSendFailures.inc({ code: e?.code !== undefined && e?.code !== null ? String(e.code) : code });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      // `error` keeps the catalogue code; Meta's own answer (code / subcode / text) is kept beside it (`_` keys stay out of the DTO) so a failure the
      // catalogue does not name (PROVIDER_UNAVAILABLE) can still be explained (tester account 26/10)
      const sendError = e ? { kind: e.kind, code: e.code, subcode: e.subcode, http: e.httpStatus, message: e.message.slice(0, 300), at: new Date().toISOString() } : undefined;
      const payload = sendError ? ({ ...((m.payload as Record<string, unknown> | null) ?? {}), _sendError: sendError } as Prisma.InputJsonValue) : undefined;
      const r = await tx.message.updateMany({ where: { id: m.id, deliveryStatus: 'pending' }, data: { deliveryStatus: 'failed', error: code, ...(payload ? { payload } : {}) } });
      if (!r.count) return;
      await this.emitUpdated(tx, { ...m, deliveryStatus: 'failed', error: code });
      if (e?.kind === 'window' && data.kind !== 'human') {
        // FL-01 F-7: the AI never retries with a tag — a human must take over
        const ctx = contextOf(conv);
        const updated = await tx.conversation.update({
          where: { id: conv.id },
          data: { status: 'needs_human', aiPaused: true, version: { increment: 1 }, context: { ...ctx, handoffReason: 'outside_window', handoffAt: ctx.handoffAt ?? new Date().toISOString() } as Prisma.InputJsonValue },
        });
        await this.addThreadEvent(tx, conv, 'send_failed_outside_window', { messageId: m.id });
        await this.outbox.ws(tx, `ws:${conv.workspaceId}`, 'conversation.updated', { id: conv.id, conversation: conversationHead(updated) });
      } else if (e?.kind === 'user_unavailable') {
        await this.addThreadEvent(tx, conv, 'send_failed_user_unavailable', { messageId: m.id });
      }
    });
    await this.redis.client.del(`send:${m.id}:parts`, `send:${m.id}:parts:mid`);
    if (e?.needsReconnect) await this.channels.markNeedsReconnect(data.channelId, `send:${e.code ?? e.kind}`);
    return 'failed';
  }
}
