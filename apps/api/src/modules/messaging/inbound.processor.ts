// FL-01 steps 2–9 (without the AI) — worker side of the Meta intake.
//   meta-inbound / process-event   raw `InboundEvent` → channel → conversation + client → Message → WS / notification →
//                                  attachment downloads → (AI hook: batching window, unsupported-media text)
//   media / fetch-attachment       copies an inbound attachment from Meta's CDN into our storage
// Both are safe to run twice: `InboundEvent.processedAt`, `Message (conversationId, externalId)` unique, attachment `pending`.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import { prisma, Prisma, TenantContext, type Channel, type Conversation, type Tx } from '@djaber/db';
import { ConfigService } from '../../core/config/config.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { ChannelService } from '../channels/channel.service';
import { ChannelTokens } from '../channels/channel.util';
import { MetaError } from '../meta/meta-errors';
import { META_GATEWAY, type MetaGateway, type MetaProfile } from '../meta/meta.gateway';
import { NotificationProducer } from '../notifications/notification.producer';
import { CREDIT_COST } from '@djaber/shared';
import { CreditService } from '../credits/credit.service';
import { BatchingService } from './batching.service';
import { ConversationResolver } from './conversation-resolver';
import { ConversationService } from './conversation.service';
import { parseInbound, previewOf, type ParsedInbound, type ParsedMessage, type StoredInbound } from './inbound-parser';
import { attachmentsOf, contextOf, detectLanguage, messageInclude, type ConversationContext, type StoredAttachment } from './messaging.presenter';
import { OutboundSendService } from './outbound-send.service';
import { containsBlockedWord, SafetyService } from './safety.service';

type Postback = Extract<ParsedInbound, { kind: 'postback' }>;
type Stored = { conversation: Conversation; messageId: string; duplicate: boolean; blocked: boolean; created: boolean };
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
const MEDIA_ATTEMPTS = 3;
const TEN_MIN = 600_000;
/** 04-ai-pipeline §9: the reply job waits at most 30 s for the transcript of a voice note. */
const VOICE_WAIT_S = 30;

@Injectable()
export class InboundProcessor implements OnModuleInit {
  private readonly log = new Logger(InboundProcessor.name);
  constructor(
    private readonly registry: ProcessorRegistry,
    private readonly config: ConfigService,
    private readonly tenants: TenantResolver,
    private readonly outbox: OutboxService,
    private readonly queue: QueueOutbox,
    private readonly storage: StorageService,
    private readonly tokens: ChannelTokens,
    private readonly channels: ChannelService,
    private readonly notifications: NotificationProducer,
    private readonly resolver: ConversationResolver,
    private readonly safety: SafetyService,
    private readonly outbound: OutboundSendService,
    private readonly conversations: ConversationService,
    private readonly batching: BatchingService,
    private readonly credits: CreditService,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  onModuleInit() {
    this.registry.register('meta-inbound', 'process-event', (d: { inboundEventId: string }) => this.process(d.inboundEventId), { concurrency: 16 });
    this.registry.register('media', 'fetch-attachment', (d: { workspaceId: string; messageId: string; index: number }, job: Job) => this.fetchAttachment(d, job), { concurrency: 8 });
  }

  // --- meta-inbound / process-event -------------------------------------------------------------------------------------
  /** Returns a short outcome label (kept in `InboundEvent.error` when the event was not turned into a message). */
  async process(inboundEventId: string): Promise<string> {
    const ev = await TenantContext.runSystem(() => prisma.inboundEvent.findUnique({ where: { id: inboundEventId } }));
    if (!ev || ev.processedAt) return 'noop';
    let outcome: string;
    try {
      outcome = await this.handle(parseInbound(ev.payload as unknown as StoredInbound));
    } catch (e) {
      // kept on the row for the DLQ view; the queue retries (5 attempts, 03 §3)
      await TenantContext.runSystem(() => prisma.inboundEvent.update({ where: { id: ev.id }, data: { error: e instanceof Error ? e.message.slice(0, 500) : 'error' } })).catch(() => undefined);
      throw e;
    }
    await TenantContext.runSystem(() => prisma.inboundEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error: outcome === 'stored' || outcome === 'ok' ? null : outcome } }));
    return outcome;
  }

  private async handle(p: ParsedInbound): Promise<string> {
    if (p.kind === 'ignored') return `ignored:${p.reason}`;
    // FL-01 step 3: the workspace is resolved from the page / account id (system context), then every write is tenant-scoped
    const channel = await TenantContext.runSystem(() => prisma.channel.findUnique({ where: { platform_externalId: { platform: p.platform, externalId: p.channelExternalId } } }));
    if (!channel) return 'channel_not_found';
    if (channel.status !== 'active') return `channel_${channel.status}`;
    const ctx = await this.tenants.workspaceCtx(channel.workspaceId);
    if (!ctx || ctx.status !== 'active') return `workspace_${ctx?.status ?? 'missing'}`;
    const tenant = await this.tenants.forWorker(channel.workspaceId);
    return TenantContext.run(tenant, async () => {
      switch (p.kind) {
        case 'message':
        case 'postback': {
          const stored = await this.storeInbound(channel, p);
          if (stored.duplicate) return 'duplicate';
          await this.afterInbound(channel, stored, p.kind === 'message' && p.unsupportedOnly);
          return 'stored';
        }
        case 'echo':
          return this.storeEcho(channel, p);
        case 'reaction':
          return this.react(channel, p.customerId, p.mid, p.reaction);
        case 'delivery':
          return this.delivered(channel, p.customerId, p.mids);
        default:
          return `ignored:${p.kind}`; // read receipts, unsent messages: nothing to store
      }
    });
  }

  private async profile(channel: Channel, senderId: string): Promise<MetaProfile | null> {
    const auth = this.tokens.auth(channel);
    if (!auth) return null;
    try {
      return await this.meta.userProfile(auth, senderId);
    } catch (e) {
      // FL-01 step 4: the profile is a nicety — a failure gives the placeholder name
      if (e instanceof MetaError && e.needsReconnect) await this.channels.markNeedsReconnect(channel.id, `profile:${e.code ?? e.kind}`);
      return null;
    }
  }

  private async blockedWords(workspaceId: string): Promise<string[]> {
    const [ws, platform] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { blockedWords: true } }),
      prisma.blockedWord.findMany({ where: { OR: [{ workspaceId: null }, { workspaceId }] }, select: { word: true } }),
    ]);
    return [...(ws?.blockedWords ?? []), ...platform.map((w) => w.word)];
  }

  /** FL-01 steps 4–5: conversation + client, the inbound Message, unread bump, WS, notification, attachment jobs. */
  private async storeInbound(channel: Channel, p: ParsedMessage | Postback): Promise<Stored> {
    const known = await prisma.clientIdentity.findUnique({ where: { channelId_externalSenderId: { channelId: channel.id, externalSenderId: p.customerId } }, select: { id: true } });
    const profile = known ? null : await this.profile(channel, p.customerId);
    const words = await this.blockedWords(channel.workspaceId);
    const msg = p.kind === 'postback' ? null : p;
    const post = p.kind === 'postback' ? p : null;
    const text = msg ? msg.text : (post!.title ?? post!.data);
    const attachments: StoredAttachment[] = msg
      ? msg.attachments.map((a) => ({
          type: a.type,
          url: a.url ?? '',
          mime: a.mime,
          size: 0,
          ...(a.name ? { name: a.name } : {}),
          ...(a.lat !== undefined ? { lat: a.lat, lng: a.lng } : {}),
          // locations are links, not files; everything else is copied to our storage by the media job
          ...(a.type !== 'location' && a.url ? { pending: true, sourceUrl: a.url } : {}),
        }))
      : [];

    return prisma.$transaction(async (db): Promise<Stored> => {
      const tx = db as Tx;
      const { conversation: conv, created } = await this.resolver.resolve(tx, channel, p.customerId, profile, p.at);
      // MSG-03: a redelivered event is dropped silently
      const dup = await tx.message.findFirst({ where: { conversationId: conv.id, externalId: p.mid }, select: { id: true } });
      if (dup) return { conversation: conv, messageId: dup.id, duplicate: true, blocked: false, created: false };

      const message = await tx.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: conv.id,
          externalId: p.mid,
          direction: 'in',
          type: msg ? msg.type : 'postback',
          author: 'customer',
          text,
          attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
          payload: ((msg ? msg.payload : { postback: post!.data ?? '' }) ?? undefined) as Prisma.InputJsonValue | undefined,
          containsBlockedWord: containsBlockedWord(text, words),
          sentAt: p.at,
          deliveryStatus: 'sent',
        },
        include: messageInclude,
      });
      const prev = contextOf(conv);
      const context: ConversationContext = { ...prev, lastDirection: 'in', lastLanguage: detectLanguage(msg ? msg.text : null, prev.lastLanguage) };
      // INB-05: a new customer message reopens a resolved / archived thread (and brings back a deleted one)
      const reopened = conv.status === 'resolved' || conv.status === 'archived' || conv.deletedAt !== null;
      const newer = !conv.lastMessageAt || p.at >= conv.lastMessageAt;
      const updated = await tx.conversation.update({
        where: { id: conv.id },
        data: {
          unreadCount: { increment: 1 },
          lastCustomerMessageAt: !conv.lastCustomerMessageAt || p.at > conv.lastCustomerMessageAt ? p.at : conv.lastCustomerMessageAt,
          ...(newer ? { lastMessageAt: p.at, lastMessagePreview: previewOf(message) } : {}),
          firstInboundAt: conv.firstInboundAt ?? p.at,
          ...(reopened ? { status: conv.status === 'needs_human' ? 'needs_human' : 'active', deletedAt: null, version: { increment: 1 } } : {}),
          context: context as Prisma.InputJsonValue,
        },
        include: { client: { select: { name: true, phone: true } } },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastSeenAt: new Date() } });
      const blocked = (await this.safety.index(tx)).has(updated, updated.client?.phone);

      for (let index = 0; index < attachments.length; index++) {
        if (!attachments[index]!.pending) continue;
        await this.queue.add(tx, 'media', 'fetch-attachment', { workspaceId: channel.workspaceId, messageId: message.id, index }, `media:${message.id}:${index}`, { attempts: MEDIA_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 } });
      }
      await this.outbound.emitCreated(tx, message, updated, blocked);
      if (reopened) await this.conversations.emitUpdated(tx, updated, blocked);
      // FL-01 F-1: a customer writes while a human handles the thread — once per 10 minutes per conversation, never for a blocked customer
      if (!blocked && (updated.status === 'needs_human' || updated.aiPaused)) {
        await this.notifications.emit(tx, {
          type: 'conversation_needs_human_message',
          workspaceId: channel.workspaceId,
          ...(updated.assigneeId ? { userIds: [updated.assigneeId] } : {}),
          key: `conversation_needs_human_message:${conv.id}:${Math.floor(p.at.getTime() / TEN_MIN)}`,
          data: { conversationId: conv.id, client: updated.client?.name ?? '', preview: previewOf(message) },
        });
      }
      return { conversation: updated, messageId: message.id, duplicate: false, blocked, created };
    });
  }

  /**
   * FL-01 steps 6–11: is this thread one the AI answers? (channel active — checked above —, an active agent linked, not
   * handed off, not paused, customer not blocked.) Then the abuse guard (D33), the attachment gates of the agent
   * (voice / image toggles, MSG-09), the credit and conversation-quota gates (F-4) and the batching window whose
   * `ai-reply / reply` job the AI pipeline consumes.
   */
  private async afterInbound(channel: Channel, s: Stored, unsupportedOnly: boolean) {
    let conv = s.conversation;
    // A3: a thread handed off only because the AI failed is retried by the AI with this new customer message
    if (!s.blocked && conv.status === 'needs_human' && (await this.conversations.resumeAfterAiError(conv.id))) conv = { ...conv, status: 'active', aiPaused: false };
    if (s.blocked || conv.status === 'needs_human' || conv.aiPaused) return;
    const link = await prisma.agentChannel.findUnique({ where: { channelId: channel.id }, include: { agent: { select: { id: true, status: true, deletedAt: true, responseDelaySec: true, imageRecognition: true, voiceTranscription: true } } } });
    if (!link || link.agent.status !== 'active' || link.agent.deletedAt) return;
    const agent = link.agent;
    const guard = await this.batching.count(conv.id);
    if (guard.flood) {
      await this.conversations.handoff(conv.id, 'abuse_guard');
      return;
    }
    const message = await prisma.message.findFirst({ where: { id: s.messageId }, select: { text: true, attachments: true } });
    const attachments = message ? attachmentsOf(message) : [];
    const hasText = !!message?.text?.trim();
    const hasAudio = attachments.some((a) => a.type === 'audio');
    const hasImage = attachments.some((a) => a.type === 'image');
    // step 7 — attachment gates: fixed platform text once per conversation per 24 h, no credits
    const unsupported = unsupportedOnly || (hasAudio && !agent.voiceTranscription) || (hasImage && !agent.imageRecognition && !hasText && !hasAudio);
    if (unsupported) {
      await this.outbound.sendSystemText(conv.id, 'unsupportedMedia', {}, { oncePer24h: true });
      return;
    }
    // step 8 — credit gate (per-turn cost = the highest of text 1 / voice 3 / image 5) and monthly conversation quota
    if (this.batching.enabled) {
      const cost = Math.max(CREDIT_COST.text, hasAudio ? CREDIT_COST.voice : 0, hasImage && agent.imageRecognition ? CREDIT_COST.image : 0);
      const balance = await this.credits.balance(channel.workspaceId);
      if (!balance.unlimited && balance.total < cost) {
        await this.conversations.aiUnavailable(conv.id, 'credits', { used: balance.planUsed, limit: balance.planLimit });
        return;
      }
      const quota = await this.credits.quota(channel.workspaceId);
      if (quota.exceeded) {
        await this.conversations.aiUnavailable(conv.id, 'quota', { used: quota.used, limit: quota.limit, period: quota.periodStart.toISOString().slice(0, 10) });
        return;
      }
      if (quota.limit > 0 && quota.used / quota.limit >= 0.8) {
        await prisma.$transaction((db) => this.notifications.emit(db as Tx, { type: 'quota_80', workspaceId: channel.workspaceId, target: { roles: ['owner', 'admin'] }, key: `quota_80:${channel.workspaceId}:${quota.periodStart.toISOString().slice(0, 10)}`, data: { used: quota.used, limit: quota.limit } }));
      }
    }
    // a voice note is answered once its transcript exists: the reply job is parked (≤ 30 s) and released by `media / transcribe`
    const scheduled = await this.batching.schedule({ workspaceId: channel.workspaceId, conversationId: conv.id, messageId: s.messageId, delaySec: hasAudio ? VOICE_WAIT_S : agent.responseDelaySec, burst: guard.burst });
    if (scheduled) {
      const auth = this.tokens.auth(channel);
      // typing indicator at the start of the window (best effort)
      if (auth) await this.meta.senderAction(auth, conv.externalSenderId, 'typing_on').catch(() => undefined);
    }
  }

  /**
   * Echo of a message sent by the page. Ours (known message id, our app id, or a just-stored outbound with the same
   * text) ⇒ nothing. Anything else is a manual reply typed in the Page inbox / Instagram app: stored as a human message
   * and, per the workspace setting, the AI is paused on that thread (D19).
   */
  private async storeEcho(channel: Channel, p: ParsedMessage): Promise<string> {
    const ownApps = [this.config.get('META_APP_ID'), this.config.get('INSTAGRAM_APP_ID')].filter(Boolean);
    if (p.appId && ownApps.includes(p.appId)) return 'ignored:own_echo';
    const ws = await prisma.workspace.findUnique({ where: { id: channel.workspaceId }, select: { autoPauseOnManualReply: true } });
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const { conversation: conv } = await this.resolver.resolve(tx, channel, p.customerId, null, p.at);
      if (await tx.message.findFirst({ where: { conversationId: conv.id, externalId: p.mid }, select: { id: true } })) return 'ignored:own_echo';
      // Instagram echoes carry no app id: an outbound of ours stored in the last 2 minutes with the same text is that echo
      const recent = await tx.message.findFirst({
        where: {
          conversationId: conv.id,
          direction: 'out',
          type: { not: 'system' },
          createdAt: { gte: new Date(Date.now() - 120_000) },
          // sent by this application (a member, the AI or a system text) — not a previously stored echo
          OR: [{ author: { in: ['ai', 'system'] } }, { authorUserId: { not: null } }],
          ...(p.text ? { text: p.text } : {}),
        },
        select: { id: true },
      });
      if (recent) return 'ignored:own_echo';
      const attachments: StoredAttachment[] = p.attachments.map((a) => ({ type: a.type, url: a.url ?? '', mime: a.mime, size: 0, ...(a.type !== 'location' && a.url ? { pending: true, sourceUrl: a.url } : {}) }));
      const message = await tx.message.create({
        data: {
          workspaceId: channel.workspaceId,
          conversationId: conv.id,
          externalId: p.mid,
          direction: 'out',
          type: p.type,
          author: 'human',
          text: p.text,
          attachments: attachments.length ? (attachments as unknown as Prisma.InputJsonValue) : undefined,
          payload: { ...(p.payload ?? {}), external: true } as Prisma.InputJsonValue,
          sentAt: p.at,
          deliveryStatus: 'sent',
        },
        include: messageInclude,
      });
      const pause = ws?.autoPauseOnManualReply !== false && !conv.aiPaused;
      const newer = !conv.lastMessageAt || p.at >= conv.lastMessageAt;
      const updated = await tx.conversation.update({
        where: { id: conv.id },
        data: {
          ...(newer ? { lastMessageAt: p.at, lastMessagePreview: previewOf(message) } : {}),
          ...(pause ? { aiPaused: true, version: { increment: 1 } } : {}),
          context: { ...contextOf(conv), lastDirection: 'out', ...(pause ? { aiPausedById: null } : {}) } as Prisma.InputJsonValue,
        },
      });
      for (let index = 0; index < attachments.length; index++) {
        if (attachments[index]!.pending) await this.queue.add(tx, 'media', 'fetch-attachment', { workspaceId: channel.workspaceId, messageId: message.id, index }, `media:${message.id}:${index}`, { attempts: MEDIA_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 } });
      }
      await this.outbound.emitCreated(tx, message, updated);
      if (pause) await this.conversations.emitUpdated(tx, updated);
      return 'stored';
    });
  }

  private async react(channel: Channel, customerId: string, mid: string, reaction: 'like' | 'dislike' | null): Promise<string> {
    const m = await prisma.message.findFirst({ where: { externalId: mid, conversation: { channelId: channel.id, externalSenderId: customerId } } });
    if (!m) return 'ignored:reaction_target_unknown';
    if (m.customerReaction === reaction) return 'ok';
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.message.update({ where: { id: m.id }, data: { customerReaction: reaction } });
      await this.outbox.ws(tx, `ws:${channel.workspaceId}`, 'message.updated', { id: m.id, conversationId: m.conversationId, messageId: m.id, deliveryStatus: m.deliveryStatus, customerReaction: reaction });
    });
    return 'ok';
  }

  private async delivered(channel: Channel, customerId: string, mids: string[]): Promise<string> {
    if (!mids.length) return 'ignored:delivery';
    await prisma.message.updateMany({ where: { externalId: { in: mids }, deliveryStatus: 'pending', conversation: { channelId: channel.id, externalSenderId: customerId } }, data: { deliveryStatus: 'sent' } });
    return 'ok';
  }

  // --- media / fetch-attachment -----------------------------------------------------------------------------------------
  async fetchAttachment(d: { workspaceId: string; messageId: string; index: number }, job?: Pick<Job, 'attemptsMade' | 'opts'>): Promise<'stored' | 'failed' | 'noop'> {
    return TenantContext.runAs(d.workspaceId, async () => {
      const m = await prisma.message.findFirst({ where: { id: d.messageId } });
      const att = m ? attachmentsOf(m)[d.index] : undefined;
      if (!m || !att || !att.pending || !att.sourceUrl) return 'noop';
      let patch: Partial<StoredAttachment>;
      let outcome: 'stored' | 'failed' = 'stored';
      try {
        const file = await this.meta.download(att.sourceUrl);
        let dims: { width?: number; height?: number } = {};
        if (file.mime.startsWith('image/')) {
          const meta = await sharp(file.body).metadata().catch(() => null);
          if (meta?.width && meta.height) dims = { width: meta.width, height: meta.height };
        }
        const key = `ws/${d.workspaceId}/inbox/${m.conversationId}/${m.id}-${d.index}.${EXT[file.mime] ?? 'bin'}`;
        const stored = await this.storage.put(key, file.body, file.mime);
        patch = { url: stored.url, mime: file.mime, size: file.body.length, ...dims, pending: false, storageKey: key };
      } catch (e) {
        const attempt = (job?.attemptsMade ?? 0) + 1;
        const retry = !(e instanceof MetaError) || e.retryable;
        if (retry && attempt < (job?.opts?.attempts ?? MEDIA_ATTEMPTS)) throw e;
        // final failure: the original Meta URL is kept and the thread shows "média indisponible"
        this.log.warn({ messageId: m.id, index: d.index, kind: e instanceof MetaError ? e.kind : 'error' }, 'attachment download failed');
        patch = { pending: false, error: 'unavailable' };
        outcome = 'failed';
      }
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        // two attachments of one message are written by two jobs: lock the row, re-read, patch one entry
        await tx.$queryRaw`SELECT "id" FROM "Message" WHERE "id" = ${m.id}::uuid FOR UPDATE`;
        const fresh = await tx.message.findFirst({ where: { id: m.id } });
        if (!fresh) return;
        const list = attachmentsOf(fresh);
        if (!list[d.index]?.pending) return;
        list[d.index] = { ...list[d.index]!, ...patch };
        await tx.message.update({ where: { id: m.id }, data: { attachments: list as unknown as Prisma.InputJsonValue } });
        await this.outbox.ws(tx, `ws:${d.workspaceId}`, 'message.updated', {
          id: m.id,
          conversationId: m.conversationId,
          messageId: m.id,
          deliveryStatus: fresh.deliveryStatus,
          attachments: list.map(({ sourceUrl: _s, storageKey: _k, ...a }) => a),
        }, `message.updated:${m.id}:att${d.index}`);
        // AI-07: a customer voice note is transcribed once its file is here (a failed download ends in F-5 there)
        if (fresh.direction === 'in' && list[d.index]!.type === 'audio' && this.batching.enabled) {
          await this.queue.add(tx, 'media', 'transcribe', { workspaceId: d.workspaceId, messageId: m.id }, `stt:${m.id}`, { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } });
        }
      });
      return outcome;
    });
  }
}
