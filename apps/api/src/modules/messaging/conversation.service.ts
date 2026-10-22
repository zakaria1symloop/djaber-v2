// 03 §5 INB-01…09 / FL-03 / FL-06 — the inbox: list with tabs and server counts, thread, composer, pause / resume AI,
// resolve / reopen / archive, assign, notes, read / unread, soft delete, bulk actions, handoff and its reminder.
// Every state change emits its WebSocket event through the outbox inside the same transaction.
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CONVERSATION_RESTORE_DAYS,
  formatMessage,
  getMessages,
  isAppLocale,
  REPLY_MAX_CHARS,
  type ActionDescriptor,
  type ComposerState,
  type ConversationCounts,
  type ConversationListItemView,
  type ConversationNoteView,
  type ConversationView,
  type InboxBulkAction,
  type InboxQuery,
  type MessagesQuery,
  type MessageView,
  type SendMessageInput,
  type TemplateKey,
  type UpdateConversationInput,
} from '@djaber/shared';
import { prisma, Prisma, TenantContext, type BlockReason, type Conversation, type ConversationStatus, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import type { BulkResult, CursorPage } from '../../core/http/pagination';
import { I18nService } from '../../core/i18n/i18n.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { can } from '../../core/rbac/permission-matrix';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { NotificationProducer } from '../notifications/notification.producer';
import { contextOf, conversationHead, conversationInclude, messageInclude, presentConversation, presentMessage, userRef, type ConversationContext, type ConversationRow, type StoredAttachment } from './messaging.presenter';
import { OutboundSendService } from './outbound-send.service';
import { BlockIndex, SafetyService } from './safety.service';
import { decideWindow, withinWindow } from './window-rules';

type Changes = { status?: ConversationStatus; aiPaused?: boolean; assigneeId?: string | null };
export type BulkCtx = { locale: string; ref: string };

const HOUR = 3600_000;
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const dec = <T>(cursor: string | undefined): T | null => {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

/** A3: how long a thread handed off by an AI failure waits before the next customer message gives it back to the AI. */
export const AI_ERROR_RETRY_AFTER_MS = 2 * 60_000;

@Injectable()
export class ConversationService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly registry: ProcessorRegistry,
    private readonly notifications: NotificationProducer,
    private readonly outbound: OutboundSendService,
    private readonly safety: SafetyService,
  ) {}

  onModuleInit() {
    // 03-events-and-jobs §4 — FL-03 F-1
    this.registry.cron('sched-handoff-unattended', '*/5 * * * *', () => this.remindUnattended());
  }

  // --- list & counts (INB-01) -------------------------------------------------------------------------------------------
  private channelFilter(q: { channelId?: string; channelIds?: string[] }): Prisma.ConversationWhereInput | null {
    const ids = [...new Set([...(q.channelIds ?? []), ...(q.channelId ? [q.channelId] : [])])];
    return ids.length ? { channelId: { in: ids } } : null;
  }

  private filters(q: InboxQuery, index: BlockIndex, now: Date): Prisma.ConversationWhereInput[] {
    const t = TenantContext.get();
    const and: Prisma.ConversationWhereInput[] = [{ deletedAt: null }];
    const channel = this.channelFilter(q);
    if (channel) and.push(channel);
    // blocked customers live in their own tab (04 §13)
    const blockedWhere = index.where();
    if (q.blocked) and.push(blockedWhere ?? { id: { in: [] } });
    else if (blockedWhere) and.push({ NOT: blockedWhere });
    if (q.status) and.push({ status: q.status });
    if (q.ai === 'active') and.push({ aiPaused: false, agentId: { not: null }, status: { not: 'needs_human' } });
    if (q.ai === 'paused') and.push({ OR: [{ aiPaused: true }, { status: 'needs_human' }] });
    if (q.ai === 'no_agent') and.push({ agentId: null });
    // conversations of the agent: answered by it (`Conversation.agentId`, set at its first reply) or not answered yet on a
    // page it is linked to (agent page "Conversations" link, M11)
    if (q.agentId?.length) and.push({ OR: [{ agentId: { in: q.agentId } }, { agentId: null, channel: { agentChannels: { some: { agentId: { in: q.agentId } } } } }] });
    if (q.unread !== undefined) and.push({ unreadCount: q.unread ? { gt: 0 } : 0 });
    if (q.assigneeId === 'me') and.push({ assigneeId: t.userId ?? null });
    else if (q.assigneeId === 'none') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.order === 'with') and.push({ orders: { some: {} } });
    if (q.order === 'without') and.push({ orders: { none: {} } });
    if (q.order === 'cart') and.push({ context: { path: ['cart', 'items'], gt: 0 } });
    if (q.order === 'abandoned') and.push({ context: { path: ['cart', 'items'], gt: 0 }, orders: { none: {} }, lastCustomerMessageAt: { lt: new Date(now.getTime() - 24 * HOUR) } });
    if (q.intent?.length) and.push({ lastAiIntent: { in: q.intent } });
    if (q.client?.length) {
      const or: Prisma.ConversationWhereInput[] = [];
      if (q.client.includes('risk')) or.push({ client: { riskLevel: 'high' } });
      if (q.client.includes('placeholder')) or.push({ client: { isPlaceholder: true } });
      if (q.client.includes('vip')) or.push({ client: { tags: { has: 'vip' } } });
      and.push({ OR: or });
    }
    if (q.language?.length) and.push({ OR: q.language.map((l) => ({ context: { path: ['lastLanguage'], equals: l } })) });
    if (q.lastMessage === 'lt24h') and.push({ lastCustomerMessageAt: { gte: new Date(now.getTime() - 24 * HOUR) } });
    if (q.lastMessage === 'gt24h') and.push({ OR: [{ lastCustomerMessageAt: null }, { lastCustomerMessageAt: { lt: new Date(now.getTime() - 24 * HOUR) } }] });
    if (q.lastMessage === '7d') and.push({ lastMessageAt: { gte: new Date(now.getTime() - 7 * 24 * HOUR) } });
    if (q.from) and.push({ lastMessageAt: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ lastMessageAt: { lt: algiersDayEnd(q.to) } });
    if (q.q) {
      const digits = q.q.replace(/[\s.+-]/g, '');
      const or: Prisma.ConversationWhereInput[] = [
        { client: { name: { contains: q.q, mode: 'insensitive' } } },
        { lastMessagePreview: { contains: q.q, mode: 'insensitive' } },
        { messages: { some: { text: { contains: q.q, mode: 'insensitive' } } } },
      ];
      if (/^\d{3,}$/.test(digits)) or.push({ client: { phone: { contains: digits } } }, { client: { phone2: { contains: digits } } });
      and.push({ OR: or });
    }
    return and;
  }

  async list(q: InboxQuery): Promise<CursorPage<ConversationListItemView>> {
    const now = new Date();
    const index = await this.safety.index();
    const and = this.filters(q, index, now);
    let orderBy: Prisma.ConversationOrderByWithRelationInput[] = [{ lastMessageAt: 'desc' }, { id: 'desc' }];
    let skip = 0;
    if (q.sort === 'lastMessageAt') {
      const c = dec<[string, string]>(q.cursor);
      if (c) and.push({ OR: [{ lastMessageAt: { lt: new Date(c[0]) } }, { lastMessageAt: new Date(c[0]), id: { lt: c[1] } }] });
    } else if (q.sort === 'oldestWaiting') {
      // customers waiting the longest for an answer first
      // a handed-over thread waits for a human even when the AI's handoff text is the last message (queue page)
      and.push(q.status === 'needs_human' ? { lastCustomerMessageAt: { not: null } } : { lastCustomerMessageAt: { not: null }, context: { path: ['lastDirection'], equals: 'in' } });
      orderBy = [{ lastCustomerMessageAt: 'asc' }, { id: 'asc' }];
      const c = dec<[string, string]>(q.cursor);
      if (c) and.push({ OR: [{ lastCustomerMessageAt: { gt: new Date(c[0]) } }, { lastCustomerMessageAt: new Date(c[0]), id: { gt: c[1] } }] });
    } else {
      orderBy = [{ unreadCount: 'desc' }, { lastMessageAt: 'desc' }, { id: 'desc' }];
      skip = Math.max(0, Number(dec<{ o: number }>(q.cursor)?.o ?? 0));
    }
    const rows = await prisma.conversation.findMany({ where: { AND: and }, include: conversationInclude, orderBy, take: q.limit + 1, skip });
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    let nextCursor: string | null = null;
    if (rows.length > q.limit && last) {
      nextCursor = q.sort === 'lastMessageAt' ? enc([(last.lastMessageAt ?? last.createdAt).toISOString(), last.id]) : q.sort === 'oldestWaiting' ? enc([last.lastCustomerMessageAt!.toISOString(), last.id]) : enc({ o: skip + q.limit });
    }
    return { data: pageRows.map((c) => presentConversation(c, index.has(c, c.client?.phone), now)), nextCursor };
  }

  /** INB-01: tab counts computed by the server (they follow the channel switcher only). */
  async counts(q: { channelId?: string; channelIds?: string[] }): Promise<ConversationCounts> {
    const index = await this.safety.index();
    const base: Prisma.ConversationWhereInput[] = [{ deletedAt: null }];
    const channel = this.channelFilter(q);
    if (channel) base.push(channel);
    const blockedWhere = index.where();
    const visible = blockedWhere ? [...base, { NOT: blockedWhere }] : base;
    const [byStatus, unread, blocked] = await Promise.all([
      prisma.conversation.groupBy({ by: ['status'], where: { AND: visible }, _count: { _all: true } }),
      prisma.conversation.count({ where: { AND: [...visible, { unreadCount: { gt: 0 } }] } }),
      blockedWhere ? prisma.conversation.count({ where: { AND: [...base, blockedWhere] } }) : 0,
    ]);
    const n = (s: ConversationStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return { all: byStatus.reduce((sum, r) => sum + r._count._all, 0), active: n('active'), needs_human: n('needs_human'), resolved: n('resolved'), archived: n('archived'), unread, blocked };
  }

  // --- detail -----------------------------------------------------------------------------------------------------------
  private async row(id: string, db: Tx | typeof prisma = prisma, includeDeleted = false): Promise<ConversationRow> {
    const c = await db.conversation.findFirst({ where: { id, ...(includeDeleted ? {} : { deletedAt: null }) }, include: conversationInclude });
    if (!c) throw notFound();
    return c;
  }

  composer(c: ConversationRow, now = new Date(), blocked = false): ComposerState {
    const t = TenantContext.get();
    const decision = decideWindow({ platform: c.channel.platform, kind: 'human', lastCustomerMessageAt: c.lastCustomerMessageAt, now });
    const within24h = withinWindow(c.lastCustomerMessageAt, now);
    // 04 §13: a blocked customer is not written to (unblock first, Admin+)
    const reasonCode = t.readOnly ? 'READ_ONLY_MEMBER' : c.channel.status !== 'active' ? 'REPLY_CHANNEL_INACTIVE' : blocked ? 'CUSTOMER_BLOCKED' : decision.action === 'reject' ? 'REPLY_OUTSIDE_WINDOW' : null;
    return {
      canSend: reasonCode === null,
      reasonCode,
      channelStatus: c.channel.status,
      within24h,
      humanAgentTag: decision.action === 'send' && decision.tag === 'HUMAN_AGENT',
      windowEndsAt: c.lastCustomerMessageAt ? new Date(c.lastCustomerMessageAt.getTime() + 24 * HOUR).toISOString() : null,
    };
  }

  private actions(c: ConversationRow, blocked: boolean, unblockable: boolean): ActionDescriptor[] {
    const t = TenantContext.get();
    const write = !t.readOnly;
    const a = (key: string, enabled: boolean, reasonCode?: string): ActionDescriptor => ({ key, enabled: write && enabled, ...(!write ? { reasonCode: 'READ_ONLY_MEMBER' } : !enabled && reasonCode ? { reasonCode } : {}) });
    const admin = can(t.role, 'inbox.delete');
    const hasAgent = c.channel.agentChannels.length > 0 || !!c.agentId;
    return [
      a('resolve', c.status !== 'resolved'),
      a('reopen', c.status === 'resolved' || c.status === 'archived'),
      a('archive', c.status !== 'archived'),
      // no agent on the page (and none answered this conversation): there is no AI to pause or resume
      a('pauseAi', !c.aiPaused && hasAgent, hasAgent ? undefined : 'CONVERSATION_NO_AGENT'),
      a('resumeAi', (c.aiPaused || c.status === 'needs_human') && hasAgent, hasAgent ? undefined : 'CONVERSATION_NO_AGENT'),
      a('assign', true),
      a('markUnread', c.unreadCount === 0),
      a('block', !blocked),
      a('unblock', blocked && can(t.role, 'safety.manage') && unblockable, blocked && !unblockable ? 'CUSTOMER_BLOCKED_BY_PLATFORM' : 'FORBIDDEN'),
      a('report', true),
      a('delete', admin, 'FORBIDDEN'),
    ];
  }

  async view(c: ConversationRow, index?: BlockIndex): Promise<ConversationView> {
    const now = new Date();
    index ??= await this.safety.index();
    const block = index.blockOf(c, c.client?.phone);
    const ctx = contextOf(c);
    const [notesCount, orders, identity, address, pausedBy, blockedBy, mergedInto] = await Promise.all([
      prisma.conversationNote.count({ where: { conversationId: c.id } }),
      c.clientId ? prisma.order.findMany({ where: { clientId: c.clientId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, number: true, status: true, total: true, orderedAt: true, createdAt: true } }) : [],
      prisma.clientIdentity.findUnique({ where: { channelId_externalSenderId: { channelId: c.channelId, externalSenderId: c.externalSenderId } } }),
      c.clientId ? prisma.clientAddress.findFirst({ where: { clientId: c.clientId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }) : null,
      c.aiPaused && ctx.aiPausedById ? prisma.user.findUnique({ where: { id: ctx.aiPausedById }, ...userRef }) : null,
      block?.blockedById ? prisma.user.findUnique({ where: { id: block.blockedById }, ...userRef }) : null,
      c.client?.mergedIntoId ? prisma.client.findFirst({ where: { id: c.client.mergedIntoId }, select: { id: true, name: true } }) : null,
    ]);
    const item = presentConversation(c, !!block, now);
    return {
      ...item,
      firstInboundAt: c.firstInboundAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      deletedAt: c.deletedAt?.toISOString() ?? null,
      notesCount,
      aiPausedBy: pausedBy,
      // set by the AI pipeline (FL-01 F-4 / F-6), cleared when a member resumes the AI or the AI answers again
      creditsExhausted: c.status === 'needs_human' && (ctx.aiUnavailable === 'credits' || ctx.aiUnavailable === 'quota'),
      aiUnavailable: c.status === 'needs_human' && ctx.aiUnavailable === 'error',
      blockedAt: block?.blockedAt.toISOString() ?? null,
      blockedBy,
      blockSource: block?.source ?? null,
      mergedInto,
      composer: this.composer(c, now, !!block),
      clientPanel: {
        client: c.client
          ? {
              ...item.client,
              tags: c.client.tags,
              notes: c.client.notes,
              totalSpent: c.client.totalSpent,
              lastOrderAt: c.client.lastOrderAt?.toISOString() ?? null,
              mergedIntoId: c.client.mergedIntoId,
              defaultAddress: address ? { wilayaId: address.wilayaId, communeText: address.communeText, address: address.address } : null,
            }
          : null,
        identity: { displayName: identity?.displayName ?? ctx.displayName ?? null, avatarUrl: identity?.avatarUrl ?? ctx.avatarUrl ?? null, externalSenderId: c.externalSenderId },
        orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, orderedAt: (o.orderedAt ?? o.createdAt).toISOString() })),
        block: block ? { id: block.id, reason: block.reason, source: block.source, blockedAt: block.blockedAt.toISOString(), unblockable: block.source !== 'platform' } : null,
      },
      actions: this.actions(c, !!block, block ? block.source !== 'platform' : true),
    };
  }

  async get(id: string): Promise<ConversationView> {
    return this.view(await this.row(id));
  }

  // --- state changes ----------------------------------------------------------------------------------------------------
  /** Applies status / AI pause / assignee changes with their side effects. Returns the row and whether anything changed. */
  private async apply(tx: Tx, c: Conversation, ch: Changes): Promise<{ conversation: Conversation; changed: boolean }> {
    const t = TenantContext.get();
    const ctx: ConversationContext = { ...contextOf(c) };
    const data: Prisma.ConversationUncheckedUpdateInput = {};
    let status = c.status;
    let aiPaused = c.aiPaused;

    if (ch.status !== undefined && ch.status !== c.status) status = ch.status;
    if (ch.aiPaused !== undefined) aiPaused = ch.aiPaused;
    // FL-03 step 5: "Resume AI" on a handed-off conversation puts it back to active
    if (ch.aiPaused === false && c.status === 'needs_human' && ch.status === undefined) status = 'active';
    // flagging for a human always pauses the AI (04 §5)
    if (status === 'needs_human' && c.status !== 'needs_human') aiPaused = true;

    if (status !== c.status) {
      data.status = status;
      if (status === 'needs_human') Object.assign(ctx, { handoffAt: new Date().toISOString(), handoffReason: ctx.handoffReason ?? 'manual', handoffRemindedAt: null });
      else Object.assign(ctx, { handoffAt: null, handoffReason: null, handoffRemindedAt: null, handoffMessageSentAt: null, aiUnavailable: null });
    }
    if (aiPaused !== c.aiPaused) {
      data.aiPaused = aiPaused;
      ctx.aiPausedById = aiPaused ? (t.userId ?? null) : null;
    }
    let assigned: string | null | undefined;
    if (ch.assigneeId !== undefined && ch.assigneeId !== c.assigneeId) {
      if (ch.assigneeId) {
        const member = await tx.membership.findFirst({ where: { userId: ch.assigneeId } });
        if (!member) throw validationError({ assigneeId: 'validation.invalid' });
      }
      data.assigneeId = ch.assigneeId;
      assigned = ch.assigneeId;
    }
    if (!Object.keys(data).length) return { conversation: c, changed: false };
    const conversation = await tx.conversation.update({ where: { id: c.id }, data: { ...data, context: ctx as Prisma.InputJsonValue, version: { increment: 1 } } });
    await this.emitUpdated(tx, conversation);
    if (assigned && assigned !== t.userId) {
      const client = c.clientId ? await tx.client.findFirst({ where: { id: c.clientId }, select: { name: true } }) : null;
      await this.notifications.emit(tx, {
        type: 'conversation_assigned',
        workspaceId: c.workspaceId,
        userIds: [assigned],
        key: `conversation_assigned:${c.id}:${assigned}:${conversation.version}`,
        data: { conversationId: c.id, assignedById: t.userId ?? null, client: client?.name ?? '' },
      });
    }
    return { conversation, changed: true };
  }

  async emitUpdated(tx: Tx, c: Conversation, blocked?: boolean) {
    await this.outbox.ws(tx, `ws:${c.workspaceId}`, 'conversation.updated', { id: c.id, conversation: conversationHead(c, blocked ?? false) }, `conversation.updated:${c.id}:${c.version}:${Date.now()}`);
  }

  /** `PATCH /conversations/:id` — optimistic concurrency: a stale `version` answers 409 with the current resource (FL-06 F-3). */
  async update(id: string, dto: UpdateConversationInput): Promise<ConversationView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      // row lock: two operators changing the same thread are serialised, the second one sees the new version
      await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const c = await tx.conversation.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw notFound();
      if (c.version !== dto.version) throw conflict({ changedBy: null, changedAt: c.updatedAt.toISOString(), current: await this.view(await this.row(id, tx)) });
      await this.apply(tx, c, { status: dto.status, aiPaused: dto.aiPaused, assigneeId: dto.assigneeId });
    });
    return this.get(id);
  }

  /** `POST /conversations/:id/read` — unread 0, pushed to the other clients (FL-06 step 2). */
  async markRead(id: string, unread = false) {
    const c = await this.row(id);
    const next = unread ? Math.max(1, c.unreadCount) : 0;
    if (next !== c.unreadCount) {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const updated = await tx.conversation.update({ where: { id }, data: { unreadCount: next } });
        await this.emitUpdated(tx, updated);
      });
    }
    return { id, unreadCount: next };
  }

  /** INB-09 soft delete (Admin+): hidden for everyone, data kept. */
  async remove(id: string) {
    const c = await this.row(id);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.conversation.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.outbox.ws(tx, `ws:${c.workspaceId}`, 'conversation.deleted', { id });
    });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: c.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'conversation.delete', entity: 'Conversation', entityId: id });
    return { id };
  }

  /** `POST /conversations/:id/restore` (Admin+, ≤ 30 days after the soft delete). */
  async restore(id: string): Promise<ConversationView> {
    const c = await this.row(id, prisma, true);
    if (!c.deletedAt) return this.view(c);
    if (Date.now() - c.deletedAt.getTime() > CONVERSATION_RESTORE_DAYS * 24 * HOUR) throw notFound();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const updated = await tx.conversation.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
      await this.emitUpdated(tx, updated);
    });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: c.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'conversation.restore', entity: 'Conversation', entityId: id });
    return this.get(id);
  }

  // --- bulk (06 §8.8) ---------------------------------------------------------------------------------------------------
  async bulk(action: InboxBulkAction, ids: string[], o: { assigneeId?: string | null; reason?: BlockReason; note?: string }, ctx: BulkCtx): Promise<{ results: BulkResult[] }> {
    const results: BulkResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'block') {
          await this.safety.blockConversation(id, { reason: o.reason ?? 'other', note: o.note });
        } else {
          await prisma.$transaction(async (db) => {
            const tx = db as Tx;
            const c = await tx.conversation.findFirst({ where: { id, deletedAt: null } });
            if (!c) throw notFound();
            const changes: Changes = action === 'resolve' ? { status: 'resolved' } : action === 'archive' ? { status: 'archived' } : action === 'assign' ? { assigneeId: o.assigneeId ?? null } : { aiPaused: false };
            await this.apply(tx, c, changes);
          });
        }
        results.push({ id, ok: true });
      } catch (e) {
        if (!(e instanceof AppException)) throw e;
        results.push({ id, ok: false, error: { code: e.code, message: this.i18n.t(ctx.locale, `error.${e.code}`, e.params), params: e.params, ...(Object.keys(e.fields).length ? { fields: e.fields } : {}), ref: ctx.ref } });
      }
    }
    return { results };
  }

  // --- thread (INB-02) --------------------------------------------------------------------------------------------------
  async messages(id: string, q: MessagesQuery): Promise<CursorPage<MessageView>> {
    const c = await this.row(id);
    const and: Prisma.MessageWhereInput[] = [{ conversationId: id }];
    const cur = dec<[string, string]>(q.cursor);
    if (cur) and.push({ OR: [{ sentAt: { lt: new Date(cur[0]) } }, { sentAt: new Date(cur[0]), id: { lt: cur[1] } }] });
    // newest first; the client prepends older pages while scrolling up
    const rows = await prisma.message.findMany({ where: { AND: and }, include: messageInclude, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    return { data: pageRows.map((m) => presentMessage(m, c.agent)), nextCursor: rows.length > q.limit && last ? enc([last.sentAt.toISOString(), last.id]) : null };
  }

  /** `GET /channels/:id/messages?direction&from&to` (CHN-07 message history of a page). */
  async channelMessages(channelId: string, q: { direction?: 'in' | 'out'; from?: string; to?: string; cursor?: string; limit: number }): Promise<CursorPage<MessageView>> {
    const channel = await prisma.channel.findFirst({ where: { id: channelId } });
    if (!channel) throw notFound();
    const and: Prisma.MessageWhereInput[] = [{ conversation: { channelId, deletedAt: null } }, { type: { not: 'system' } }];
    if (q.direction) and.push({ direction: q.direction });
    if (q.from) and.push({ sentAt: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ sentAt: { lt: algiersDayEnd(q.to) } });
    const cur = dec<[string, string]>(q.cursor);
    if (cur) and.push({ OR: [{ sentAt: { lt: new Date(cur[0]) } }, { sentAt: new Date(cur[0]), id: { lt: cur[1] } }] });
    const rows = await prisma.message.findMany({ where: { AND: and }, include: messageInclude, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    return { data: pageRows.map((m) => presentMessage(m)), nextCursor: rows.length > q.limit && last ? enc([last.sentAt.toISOString(), last.id]) : null };
  }

  // --- composer (INB-03, INB-04, FL-06 step 3) ----------------------------------------------------------------------------
  private async templateText(c: ConversationRow, key: TemplateKey): Promise<string> {
    const order = await prisma.order.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, include: { shipments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    // placeholders come from the conversation's last order (06 §8.8)
    if (!order) throw validationError({ templateKey: 'validation.invalid' });
    const shipment = order.shipments[0];
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: c.workspaceId }, select: { locale: true } });
    const lang = contextOf(c).lastLanguage;
    const locale = isAppLocale(lang) ? lang : ws.locale;
    const time = order.callbackAt ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hour12: false }).format(order.callbackAt) : '';
    if (key === 'reminderScheduled' && !time) throw validationError({ templateKey: 'validation.invalid' });
    const params = { number: order.number.replace(/^#/, ''), tracking: shipment?.trackingNumber ?? '', courier: shipment?.provider ?? '', reason: shipment?.failureReason ?? '', time };
    return formatMessage(getMessages(locale)[`customer.${key}`] ?? '', params);
  }

  /** `POST /conversations/:id/messages` — stored `pending`, sent by the `meta-send` job; the reply pauses the AI (D19). */
  async send(id: string, dto: SendMessageInput): Promise<MessageView> {
    const t = TenantContext.get();
    const c = await this.row(id);
    if (c.channel.status !== 'active') throw new AppException('REPLY_CHANNEL_INACTIVE', {}, {}, { status: c.channel.status });
    if ((await this.safety.index()).has(c, c.client?.phone)) throw new AppException('CUSTOMER_BLOCKED', { clientName: c.client?.name ?? '' });

    let text = dto.text?.trim() || null;
    const payload: Record<string, unknown> = {};
    if (dto.quickReplyId) {
      const qr = await prisma.quickReply.findFirst({ where: { id: dto.quickReplyId } });
      if (!qr) throw validationError({ quickReplyId: 'validation.invalid' });
      text = qr.body;
    }
    if (dto.templateKey) {
      text = await this.templateText(c, dto.templateKey);
      payload.templateKey = dto.templateKey;
    }
    if (text && text.length > REPLY_MAX_CHARS) throw new AppException('REPLY_TOO_LONG', {}, { text: 'validation.length' });
    const attachments: StoredAttachment[] = [];
    if (dto.uploadId) {
      const upload = await prisma.upload.findFirst({ where: { id: dto.uploadId, workspaceId: t.workspaceId, kind: 'reply' } });
      if (!upload) throw validationError({ uploadId: 'validation.invalid' });
      attachments.push({ type: 'image', url: upload.url, mime: upload.mime, size: upload.size, storageKey: upload.storageKey });
    }
    if (!text && !attachments.length) throw validationError({ text: 'validation.required' });

    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: t.workspaceId }, select: { autoPauseOnManualReply: true } });
    const message = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const fresh = await tx.conversation.findFirst({ where: { id, deletedAt: null } });
      if (!fresh) throw notFound();
      const ctx: ConversationContext = {};
      const patch: Prisma.ConversationUncheckedUpdateInput = { unreadCount: 0 };
      let changed = false;
      // INB-06: the first human reply assigns the conversation to its author
      if (!fresh.assigneeId && t.userId) {
        patch.assigneeId = t.userId;
        changed = true;
      }
      if (ws.autoPauseOnManualReply) {
        if (!fresh.aiPaused) {
          patch.aiPaused = true;
          ctx.aiPausedById = t.userId ?? null;
          changed = true;
        }
      } else if (fresh.status === 'needs_human') {
        // 04 §5 "Handoff": with the auto-pause off, a human reply resumes the AI
        Object.assign(patch, { status: 'active', aiPaused: false });
        Object.assign(ctx, { handoffAt: null, handoffReason: null, handoffRemindedAt: null, handoffMessageSentAt: null, aiPausedById: null });
        changed = true;
      }
      if (changed) patch.version = { increment: 1 };
      patch.context = ctx as Prisma.InputJsonValue;
      const out = await this.outbound.store(tx, id, { author: 'human', kind: 'human', text, attachments, payload, authorUserId: t.userId ?? null }, { patch });
      if (changed || fresh.unreadCount > 0) await this.emitUpdated(tx, out.conversation);
      return out.message;
    });
    return presentMessage(message, c.agent);
  }

  // --- notes (INB-06) ---------------------------------------------------------------------------------------------------
  async notes(id: string): Promise<ConversationNoteView[]> {
    await this.row(id);
    const rows = await prisma.conversationNote.findMany({ where: { conversationId: id }, include: { author: userRef }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map((n) => ({ id: n.id, body: n.body, author: n.author, createdAt: n.createdAt.toISOString() }));
  }

  /** Internal note: stored for the team, never sent to the customer. */
  async addNote(id: string, body: string): Promise<ConversationNoteView> {
    const t = TenantContext.get();
    const c = await this.row(id);
    const n = await prisma.conversationNote.create({ data: { workspaceId: c.workspaceId, conversationId: id, authorId: t.userId!, body }, include: { author: userRef } });
    return { id: n.id, body: n.body, author: n.author, createdAt: n.createdAt.toISOString() };
  }

  /**
   * A3 (tester report 2026-10-20: the bot "stopped answering" in the middle of a conversation): a thread handed to the team
   * only because the AI failed (provider down / malformed answers, `handoffReason = ai_error`) goes back to the AI with the
   * next customer message — once the failure is `AI_ERROR_RETRY_AFTER_MS` old and as long as nobody of the team has
   * written since. Returns true when the AI may answer again.
   */
  async resumeAfterAiError(conversationId: string, now = new Date()): Promise<boolean> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const c = await tx.conversation.findFirst({ where: { id: conversationId, deletedAt: null } });
      if (!c || c.status !== 'needs_human') return false;
      const ctx = contextOf(c);
      const at = ctx.handoffAt ? new Date(ctx.handoffAt) : null;
      if (ctx.handoffReason !== 'ai_error' || !at || now.getTime() - at.getTime() < AI_ERROR_RETRY_AFTER_MS) return false;
      if (await tx.message.count({ where: { conversationId: c.id, author: 'human', createdAt: { gt: at } } })) return false;
      const context: ConversationContext = { ...ctx, handoffAt: null, handoffReason: null, handoffRemindedAt: null, aiPausedById: null, aiUnavailable: null };
      const updated = await tx.conversation.update({ where: { id: c.id }, data: { status: 'active', aiPaused: false, version: { increment: 1 }, context: context as Prisma.InputJsonValue } });
      await this.emitUpdated(tx, updated);
      return true;
    });
  }

  // --- handoff (FL-03) ----------------------------------------------------------------------------------------------------
  /**
   * Hands a conversation to the team: `needs_human`, AI paused, the workspace `handoff` text once per episode, members
   * notified. Called by the abuse guard (D33) now and by the AI pipeline from M4. No-op when already handed off.
   */
  async handoff(conversationId: string, reason: string, o: { silent?: boolean; tx?: Tx; context?: Partial<ConversationContext> } = {}): Promise<boolean> {
    const run = async (tx: Tx) => {
      const c = await tx.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, include: { client: true } });
      if (!c || c.status === 'needs_human') return false;
      const ctx: ConversationContext = { ...contextOf(c), ...(o.context ?? {}), handoffAt: new Date().toISOString(), handoffReason: reason, handoffRemindedAt: null, aiPausedById: null };
      const updated = await tx.conversation.update({ where: { id: c.id }, data: { status: 'needs_human', aiPaused: true, version: { increment: 1 }, context: ctx as Prisma.InputJsonValue } });
      // 04-ai-pipeline §10: one handoff message per episode — never twice in 24 h for the same conversation
      if (!o.silent) await this.outbound.sendSystemText(c.id, 'handoff', {}, { tx, kind: 'system', oncePer24h: true });
      await this.emitUpdated(tx, updated);
      await this.notifications.emit(tx, {
        type: 'conversation_handoff',
        workspaceId: c.workspaceId,
        ...(c.assigneeId ? { userIds: [c.assigneeId] } : {}),
        key: `conversation_handoff:${c.id}:${ctx.handoffAt}`,
        data: { conversationId: c.id, reason, client: c.client?.name ?? '' },
      });
      // outbound webhook `conversation.escalated` (03-events §6): produced now, delivered by the integrations module (M11)
      await this.outbox.enqueue(tx, { topic: 'webhook', key: `conversation.escalated:${c.id}:${ctx.handoffAt}`, workspaceId: c.workspaceId, payload: { event: 'conversation.escalated', data: { conversationId: c.id, channelId: c.channelId, clientId: c.clientId, reason } } });
      return true;
    };
    return o.tx ? run(o.tx) : prisma.$transaction((db) => run(db as Tx));
  }

  /** `sched-handoff-unattended`: nobody answered a handed-off conversation for `handoffReminderMin` ⇒ the Owner is told once. */
  /**
   * FL-01 F-4 — credits or the monthly conversation quota ran out: the fixed platform text `unavailable` once per
   * conversation per 24 h, the thread goes to the queue (`needs_human`, no handoff text) and the Owner is told
   * (`credits.exhausted` once a day, `quota.100` once per period).
   */
  async aiUnavailable(conversationId: string, cause: 'credits' | 'quota', usage: { used: number; limit: number; period?: string }): Promise<void> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const c = await tx.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, select: { id: true, workspaceId: true, status: true } });
      if (!c || c.status === 'needs_human') return;
      await this.outbound.sendSystemText(c.id, 'unavailable', {}, { tx, oncePer24h: true });
      await this.handoff(c.id, cause === 'credits' ? 'credits_exhausted' : 'quota_exceeded', { silent: true, tx, context: { aiUnavailable: cause } });
      const day = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
      if (cause === 'credits') await this.notifications.emit(tx, { type: 'credits_exhausted', workspaceId: c.workspaceId, target: { owner: true }, key: `credits_exhausted:${c.workspaceId}:${day}`, data: { used: usage.used, limit: usage.limit } });
      else await this.notifications.emit(tx, { type: 'quota_100', workspaceId: c.workspaceId, target: { roles: ['owner', 'admin'] }, key: `quota_100:${c.workspaceId}:${usage.period ?? day.slice(0, 7)}`, data: { used: usage.used, limit: usage.limit } });
    });
  }

  async remindUnattended(now = new Date()): Promise<number> {
    return TenantContext.runSystem(async () => {
      const due = await prisma.$queryRaw<{ id: string; workspaceId: string; handoffAt: string; minutes: number; client: string | null }[]>`
        SELECT c."id", c."workspaceId", c."context"->>'handoffAt' AS "handoffAt", w."handoffReminderMin" AS minutes, cl."name" AS client
        FROM "Conversation" c
        JOIN "Workspace" w ON w."id" = c."workspaceId"
        LEFT JOIN "Client" cl ON cl."id" = c."clientId"
        WHERE c."status" = 'needs_human' AND c."deletedAt" IS NULL AND w."status" = 'active' AND w."handoffReminderMin" > 0
          AND c."context"->>'handoffAt' IS NOT NULL AND c."context"->>'handoffRemindedAt' IS NULL
          AND (c."context"->>'handoffAt')::timestamptz < ${now}::timestamptz - make_interval(mins => w."handoffReminderMin")
          AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c."id" AND m."author" = 'human' AND m."sentAt" > ((c."context"->>'handoffAt')::timestamptz AT TIME ZONE 'UTC'))
        LIMIT 500`;
      let sent = 0;
      for (const row of due) {
        await TenantContext.runAs(row.workspaceId, () =>
          prisma.$transaction(async (db) => {
            const tx = db as Tx;
            const c = await tx.conversation.findFirst({ where: { id: row.id } });
            if (!c || (await this.safety.index(tx)).has(c)) return; // blocked customers raise no notification (04 §13)
            await tx.conversation.update({ where: { id: c.id }, data: { context: { ...contextOf(c), handoffRemindedAt: now.toISOString() } as Prisma.InputJsonValue } });
            await this.notifications.emit(tx, {
              type: 'conversation_handoff_unattended',
              workspaceId: row.workspaceId,
              target: { owner: true },
              key: `conversation_handoff_unattended:${row.id}:${row.handoffAt}`,
              data: { conversationId: row.id, handoffAt: row.handoffAt, minutes: row.minutes, client: row.client ?? '' },
            });
            sent++;
          }),
        );
      }
      return sent;
    });
  }
}
