// 03 §3 CHN-04…07, CHN-10/11 — channels of the workspace: list / detail / counts, pause · resume (swap at the plan limit) ·
// disable · enable · disconnect, `needs_reconnect` on a Meta token error, App Review status. Nothing here calls Meta from
// an HTTP handler: Meta work is queued (CLAUDE.md rule 4) and done by channel-jobs.service.ts.
import { Inject, Injectable } from '@nestjs/common';
import type {
  ActionDescriptor,
  AppReviewStatusView,
  ChannelApprovalStatusView,
  ChannelCounts,
  ChannelEventsQuery,
  ChannelEventView,
  ChannelInsightsView,
  ChannelRefView,
  ChannelsQuery,
  ChannelSummaryView,
  ChannelView,
} from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Channel, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import type { CursorPage } from '../../core/http/pagination';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { RedisService } from '../../core/redis/redis.provider';
import { can } from '../../core/rbac/permission-matrix';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { META_GATEWAY, type MetaGateway } from '../meta/meta.gateway';
import { NotificationProducer } from '../notifications/notification.producer';
import { ChannelEvents, occupiesSlot, pageSlots } from './channel.util';

const withRefs = { connectedBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }, agentChannels: { include: { agent: { select: { id: true, name: true, status: true, catalogScope: true, sellAllProducts: true } } } } } as const;
type ChannelRow = Prisma.ChannelGetPayload<{ include: typeof withRefs }>;

const ZERO: ChannelCounts = { conversations: 0, active: 0, needsHuman: 0, unread: 0, messages7d: 0, inbound7d: 0, productsInScope: 0 };
const insightsKey = (id: string) => `chn:insights:${id}`;
const INSIGHTS_TTL_S = 3600;
/** Scope that gates Instagram messaging per kind of Instagram channel (CHN-03 / CHN-11). */
export const instagramScope = (viaPage: boolean) => (viaPage ? 'instagram_manage_messages' : 'instagram_business_manage_messages');

export const channelRef = (c: Pick<Channel, 'id' | 'platform' | 'name' | 'avatarUrl' | 'status'>): ChannelRefView => ({ id: c.id, platform: c.platform, name: c.name, avatarUrl: c.avatarUrl, status: c.status });

@Injectable()
export class ChannelService {
  constructor(
    private readonly events: ChannelEvents,
    private readonly queue: QueueOutbox,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationProducer,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  // --- reading ----------------------------------------------------------------------------------------------------------
  private async counts(channels: Pick<ChannelRow, 'id' | 'agentChannels'>[]): Promise<Map<string, ChannelCounts>> {
    const ids = channels.map((c) => c.id);
    const out = new Map<string, ChannelCounts>(ids.map((id) => [id, { ...ZERO }]));
    if (!ids.length) return out;
    const workspaceId = TenantContext.workspaceId();
    const [byStatus, unread, msgs] = await Promise.all([
      prisma.conversation.groupBy({ by: ['channelId', 'status'], where: { channelId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      prisma.conversation.groupBy({ by: ['channelId'], where: { channelId: { in: ids }, deletedAt: null, unreadCount: { gt: 0 } }, _count: { _all: true } }),
      prisma.$queryRaw<{ channelId: string; total: bigint; inbound: bigint }[]>`
        SELECT c."channelId", count(*) AS total, count(*) FILTER (WHERE m."direction" = 'in') AS inbound
        FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
        WHERE c."workspaceId" = ${workspaceId}::uuid AND c."channelId" = ANY(${ids}::uuid[]) AND c."deletedAt" IS NULL
          AND m."sentAt" >= (now() AT TIME ZONE 'UTC') - interval '7 days'
        GROUP BY c."channelId"`,
    ]);
    for (const r of byStatus) {
      const c = out.get(r.channelId)!;
      c.conversations += r._count._all;
      if (r.status === 'active') c.active += r._count._all;
      if (r.status === 'needs_human') c.needsHuman += r._count._all;
    }
    for (const r of unread) out.get(r.channelId)!.unread = r._count._all;
    for (const r of msgs) {
      const c = out.get(r.channelId);
      if (c) Object.assign(c, { messages7d: Number(r.total), inbound7d: Number(r.inbound) });
    }
    // products the linked agent may sell (CHN-07): the whole active catalogue or its explicit list
    const agents = new Map<string, { id: string; all: boolean }>();
    for (const ch of channels) {
      const a = ch.agentChannels[0]?.agent;
      if (a) agents.set(ch.id, { id: a.id, all: a.sellAllProducts });
    }
    if (agents.size) {
      const activeProducts = await prisma.product.count({ where: { deletedAt: null, isActive: true } });
      const listed = await prisma.agentProduct.groupBy({ by: ['agentId'], where: { agentId: { in: [...new Set([...agents.values()].map((a) => a.id))] } }, _count: { _all: true } });
      const listedBy = new Map(listed.map((l) => [l.agentId, l._count._all]));
      for (const [channelId, a] of agents) out.get(channelId)!.productsInScope = a.all ? activeProducts : (listedBy.get(a.id) ?? 0);
    }
    return out;
  }

  private async permissions(): Promise<Map<string, string>> {
    const rows = await prisma.metaPermission.findMany();
    return new Map(rows.map((r) => [r.scope, r.status]));
  }

  private actions(c: Channel, slotsFree: boolean): ActionDescriptor[] {
    const t = TenantContext.get();
    const manage = can(t.role, 'channels.manage') && !t.readOnly;
    const deny = manage ? undefined : 'FORBIDDEN';
    const a = (key: string, allowed: boolean, reasonCode?: string, primary?: boolean): ActionDescriptor => ({
      key,
      enabled: manage && allowed,
      ...(deny ? { reasonCode: deny } : !allowed && reasonCode ? { reasonCode } : {}),
      ...(primary ? { primary } : {}),
    });
    const live = c.status !== 'disconnected';
    const resumable = c.status === 'paused' || c.status === 'disabled';
    return [
      a('reconnect', true, undefined, c.status === 'needs_reconnect' || c.status === 'disconnected'),
      a('pause', c.status === 'active', 'REPLY_CHANNEL_INACTIVE'),
      a('resume', resumable && (slotsFree || c.parentChannelId !== null), resumable ? 'PLAN_LIMIT' : 'CONFLICT'),
      // full-test 15/11 CHANNELS-INBOX-10 / -04: the reasons are true for the page — a page a member disconnected is not
      // « déconnectée par Meta », and an already disconnected page is not « modifié entre-temps »
      a('syncInfo', live && c.accessToken !== null, live ? 'PAGE_TOKEN_EXPIRED' : 'CHANNEL_DISCONNECTED'),
      a('syncHistory', c.status === 'active', 'REPLY_CHANNEL_INACTIVE'),
      a('disconnect', live, 'CHANNEL_ALREADY_DISCONNECTED'),
    ];
  }

  private view(c: ChannelRow, counts: ChannelCounts, perms: Map<string, string>, slotsFree: boolean): ChannelView {
    const agent = c.agentChannels[0]?.agent ?? null;
    const permissions: Record<string, 'granted' | 'pending' | 'missing'> = {};
    for (const scope of c.grantedScopes) permissions[scope] = perms.has(scope) && perms.get(scope) !== 'approved' ? 'pending' : 'granted';
    if (c.platform === 'instagram') {
      const scope = instagramScope(c.parentChannelId !== null);
      permissions[scope] = c.status === 'pending_review' ? 'pending' : (permissions[scope] ?? 'granted');
    }
    return {
      id: c.id,
      platform: c.platform,
      externalId: c.externalId.split('#')[0]!,
      name: c.name,
      avatarUrl: c.avatarUrl,
      followersCount: c.followersCount,
      status: c.status,
      pausedReason: c.pausedReason,
      parentChannelId: c.parentChannelId,
      agent: agent ? { id: agent.id, name: agent.name, status: agent.status } : null,
      icebreaker: c.icebreaker,
      counts,
      health: {
        webhookSubscribed: c.webhookSubscribed && c.status !== 'disconnected',
        tokenValid: c.accessToken !== null && c.status !== 'needs_reconnect' && c.status !== 'disconnected',
        tokenCheckedAt: c.lastTokenCheckAt?.toISOString() ?? null,
        tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
        permissions,
        lastInboundAt: c.lastSeenAt?.toISOString() ?? null,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      },
      connectedAt: c.createdAt.toISOString(),
      connectedBy: c.connectedBy,
      actions: this.actions(c, slotsFree),
    };
  }

  private async usage() {
    const limit = TenantContext.get().limits.maxPages;
    const current = await prisma.channel.count({ where: { parentChannelId: null, status: { in: ['active', 'pending_review', 'needs_reconnect'] } } });
    return { limit, current };
  }

  async list(q: ChannelsQuery): Promise<{ data: ChannelView[]; page: 1; pageSize: number; total: number; meta: { planLimit: { limit: number; current: number } } }> {
    const where: Prisma.ChannelWhereInput = {};
    if (q.platform) where.platform = q.platform;
    // disconnected pages stay listed (history is kept, CHN-06) unless a status filter says otherwise
    if (q.status?.length) where.status = { in: q.status };
    if (q.agentId) where.agentChannels = { some: { agentId: q.agentId } };
    if (q.noAgent) where.agentChannels = { none: {} };
    if (q.pausedBy) Object.assign(where, { status: 'paused', pausedReason: q.pausedBy });
    if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { externalId: { startsWith: q.q } }];
    const sort = q.sort ?? '-createdAt';
    const field = sort.replace(/^-/, '') as 'name' | 'lastSeenAt' | 'createdAt';
    const rows = await prisma.channel.findMany({ where, include: withRefs, orderBy: [{ [field]: sort.startsWith('-') ? 'desc' : 'asc' }, { id: 'asc' }] });
    const [counts, perms, planLimit] = await Promise.all([this.counts(rows), this.permissions(), this.usage()]);
    const slotsFree = planLimit.limit === -1 || planLimit.current < planLimit.limit;
    return { data: rows.map((c) => this.view(c, counts.get(c.id) ?? ZERO, perms, slotsFree)), page: 1, pageSize: Math.max(rows.length, 1), total: rows.length, meta: { planLimit } };
  }

  async row(id: string): Promise<ChannelRow> {
    const c = await prisma.channel.findFirst({ where: { id }, include: withRefs });
    if (!c) throw notFound();
    return c;
  }

  async get(id: string): Promise<ChannelView> {
    const c = await this.row(id);
    const [counts, perms, planLimit] = await Promise.all([this.counts([c]), this.permissions(), this.usage()]);
    return this.view(c, counts.get(c.id) ?? ZERO, perms, planLimit.limit === -1 || planLimit.current < planLimit.limit);
  }

  async summary(id: string): Promise<ChannelSummaryView> {
    const view = await this.get(id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [children, lastJob, aiOrders30d, resolution] = await Promise.all([
      prisma.channel.findMany({ where: { parentChannelId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'sync_history', payload: { path: ['channelId'], equals: id } }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
      prisma.order.count({ where: { channelId: id, source: 'ai', orderedAt: { gte: since } } }),
      // CHN-07 "Résolution IA" (M8, same definition as Analytics › Conversations "traitées par l'IA"): conversations of the
      // page in 30 d without an AI handoff ÷ conversations
      prisma.$queryRaw<{ total: number; handed: number }[]>`
        SELECT count(*)::int total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AiRun" r WHERE r."conversationId" = c."id" AND r."status" = 'handoff' AND r."kind" = 'reply'))::int handed
        FROM "Conversation" c WHERE c."workspaceId" = ${TenantContext.workspaceId()}::uuid AND c."channelId" = ${id}::uuid AND c."deletedAt" IS NULL AND c."createdAt" >= ${since}`,
    ]);
    const r = resolution[0];
    return {
      counts: view.counts,
      agent: view.agent ? { ...view.agent, productsInScope: view.counts.productsInScope } : null,
      health: view.health,
      children: children.map(channelRef),
      lastHistorySyncJobId: lastJob?.id ?? null,
      aiOrders30d,
      aiResolutionPct30d: r && r.total ? Math.round(((r.total - r.handed) * 1000) / r.total) / 10 : null,
    };
  }

  async eventsOf(id: string, q: ChannelEventsQuery): Promise<CursorPage<ChannelEventView>> {
    await this.row(id);
    const and: Prisma.ChannelEventWhereInput[] = [{ channelId: id }];
    if (q.kind?.length) and.push({ kind: { in: q.kind } });
    if (q.from) and.push({ at: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ at: { lt: algiersDayEnd(q.to) } });
    if (q.cursor) and.push({ id: { lt: q.cursor } });
    // ids are UUID v7: ordering by id = ordering by creation time
    const rows = await prisma.channelEvent.findMany({ where: { AND: and }, orderBy: { id: 'desc' }, take: q.limit + 1, include: { actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } });
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((e) => ({ id: e.id, kind: e.kind, description: e.description, actorType: e.actorType, actor: e.actor, at: e.at.toISOString() })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  /** CHN-07: cached Meta insights (filled at connect and by `channel-sync-info`); nothing cached ⇒ 422 + a refresh is queued. */
  async insights(id: string): Promise<ChannelInsightsView> {
    const c = await this.row(id);
    const cached = await this.redis.getJson<ChannelInsightsView | { unavailable: true }>(insightsKey(id));
    if (cached && 'metrics' in cached) return cached;
    if (!cached && c.status === 'active' && c.accessToken) {
      const hour = Math.floor(Date.now() / 3600_000);
      await prisma.$transaction((tx) => this.queue.add(tx as Tx, 'jobs', 'channel-sync-info', { channelId: id, workspaceId: c.workspaceId, insightsOnly: true }, `chn-insights:${id}:${hour}`, { attempts: 1 }));
    }
    throw new AppException('INBOX_INSIGHTS_UNAVAILABLE');
  }
  async storeInsights(id: string, value: ChannelInsightsView | null) {
    await this.redis.setJson(insightsKey(id), value ?? { unavailable: true }, value ? INSIGHTS_TTL_S : 600);
  }

  async appReviewStatus(): Promise<AppReviewStatusView> {
    const rows = await prisma.metaPermission.findMany({ orderBy: { scope: 'asc' } });
    const status = new Map(rows.map((r) => [r.scope, r.status]));
    // a scope without a row has not been restricted by the platform team: it is treated as approved (assumptions-log M3)
    const ok = (scope: string) => !status.has(scope) || status.get(scope) === 'approved';
    return {
      approved: ['pages_messaging', 'pages_manage_metadata', 'pages_show_list'].every(ok),
      instagramApproved: ok('instagram_manage_messages') && ok('instagram_business_manage_messages'),
      humanAgentApproved: ok('human_agent'),
      permissions: rows.map((r) => ({ scope: r.scope, feature: r.feature, status: r.status, submittedAt: r.submittedAt?.toISOString() ?? null, decidedAt: r.decidedAt?.toISOString() ?? null })),
    };
  }
  /** Is Instagram messaging approved for this kind of channel? (`pending_review` otherwise, CHN-03). */
  async instagramApproved(viaPage: boolean): Promise<boolean> {
    const row = await prisma.metaPermission.findUnique({ where: { scope: instagramScope(viaPage) } });
    return !row || row.status === 'approved';
  }
  async approvalStatus(id: string): Promise<ChannelApprovalStatusView> {
    const c = await this.row(id);
    const pending = c.status === 'pending_review';
    return { channelId: c.id, status: c.status, pending, code: pending ? 'PAGE_INSTAGRAM_PENDING_APPROVAL' : null };
  }

  // --- mutations --------------------------------------------------------------------------------------------------------
  private actor() {
    const t = TenantContext.get();
    return { actorId: t.userId ?? null, actorType: 'user' as const };
  }

  /** Manual pause (`PATCH { status: paused }`): status `paused`, reason `manual`. Linked Instagram accounts follow their page. */
  async pause(id: string): Promise<ChannelView> {
    const c = await this.row(id);
    if (c.status !== 'active' && c.status !== 'pending_review') throw new AppException('CONFLICT', {}, {}, { status: c.status });
    await prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({ where: { id }, data: { status: 'paused', pausedReason: 'manual' } });
      await this.events.changed(tx, updated, { kind: 'disabled', description: 'paused', ...this.actor() });
    });
    return this.get(id);
  }

  /** `POST /channels/:id/disable`: status `disabled` (00-build-order §0: manual stop from the card). */
  async disable(id: string): Promise<ChannelView> {
    const c = await this.row(id);
    if (c.status === 'disconnected' || c.status === 'disabled') throw new AppException('CONFLICT', {}, {}, { status: c.status });
    await prisma.$transaction(async (tx) => {
      const updated = await tx.channel.update({ where: { id }, data: { status: 'disabled', pausedReason: null } });
      await this.events.changed(tx, updated, { kind: 'disabled', ...this.actor() });
    });
    return this.get(id);
  }

  /**
   * Resume / enable (CHN-10): a page that does not hold a slot needs a free one. At the limit the request is refused with
   * `403 PLAN_LIMIT { resource: pages, limit, current }` unless `swapWithChannelId` names a page to pause in exchange
   * [FIG DLG "Réactiver et échanger"].
   */
  async resume(id: string, swapWithChannelId?: string): Promise<ChannelView> {
    const c = await this.row(id);
    if (c.status !== 'paused' && c.status !== 'disabled') throw new AppException('CONFLICT', {}, {}, { status: c.status });
    if (c.status === 'paused' && c.pausedReason === 'moderation') throw new AppException('FORBIDDEN');
    if (!c.accessToken) throw new AppException('REPLY_CHANNEL_INACTIVE', {}, {}, { status: 'disconnected' });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (c.parentChannelId === null) {
        const slots = await pageSlots(tx);
        if (slots.free < 1) {
          const other = swapWithChannelId && swapWithChannelId !== id ? await tx.channel.findFirst({ where: { id: swapWithChannelId } }) : null;
          if (!other || !occupiesSlot(other)) throw new AppException('PLAN_LIMIT', { resource: 'pages', limit: slots.limit, current: slots.current });
          const paused = await tx.channel.update({ where: { id: other.id }, data: { status: 'paused', pausedReason: 'plan' } });
          await this.events.changed(tx, paused, { kind: 'disabled', description: 'swapped', ...this.actor() });
        }
      }
      const pending = c.platform === 'instagram' && !(await this.instagramApproved(c.parentChannelId !== null));
      const updated = await tx.channel.update({ where: { id }, data: { status: pending ? 'pending_review' : 'active', pausedReason: null } });
      await this.events.changed(tx, updated, { kind: 'enabled', ...this.actor() });
    });
    return this.get(id);
  }

  /**
   * CHN-06 disconnect: status `disconnected`, agent link removed, history kept. The Meta unsubscribe and the token wipe
   * are done by the `channel-unsubscribe` job (it needs the token for the call). Linked Instagram accounts go with their page.
   */
  async disconnect(id: string): Promise<{ id: string; status: 'disconnected' }> {
    const c = await this.row(id);
    if (c.status === 'disconnected') return { id, status: 'disconnected' };
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const targets = [c, ...(await tx.channel.findMany({ where: { parentChannelId: id, status: { not: 'disconnected' } } }))];
      for (const ch of targets) {
        const updated = await tx.channel.update({ where: { id: ch.id }, data: { status: 'disconnected', pausedReason: null, webhookSubscribed: false } });
        await tx.agentChannel.deleteMany({ where: { channelId: ch.id } });
        await this.events.changed(tx, updated, { kind: 'disconnected', ...this.actor() });
        await this.queue.add(tx, 'jobs', 'channel-unsubscribe', { channelId: ch.id, workspaceId: ch.workspaceId }, `chn-unsub:${ch.id}:${updated.updatedAt.getTime()}`, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
      }
    });
    const t = TenantContext.get();
    await this.audit.write({ workspaceId: c.workspaceId, actorType: 'user', actorId: t.userId, actorRole: t.role, action: 'channel.disconnect', entity: 'Channel', entityId: id, before: { status: c.status }, after: { status: 'disconnected' } });
    return { id, status: 'disconnected' };
  }

  /** `POST /channels/:id/sync-info` — queued (1 / 10 min / channel is enforced by the controller's limiter). */
  async requestInfoSync(id: string) {
    const c = await this.row(id);
    if (c.status === 'disconnected' || !c.accessToken) throw new AppException('REPLY_CHANNEL_INACTIVE', {}, {}, { status: c.status });
    await prisma.$transaction((tx) => this.queue.add(tx as Tx, 'jobs', 'channel-sync-info', { channelId: id, workspaceId: c.workspaceId }, `chn-info:${id}:${Date.now()}`, { attempts: 1 }));
    return this.get(id);
  }

  /**
   * CHN-04: any Graph token / permission error ⇒ `needs_reconnect` + notification (24 h per channel) — the AI stops on
   * that channel because only `active` channels are answered. System context (called by jobs and schedulers).
   */
  async markNeedsReconnect(channelId: string, reason: string) {
    return TenantContext.runSystem(() =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const hit = await tx.channel.findUnique({ where: { id: channelId } });
        if (!hit || hit.status === 'disconnected' || hit.status === 'needs_reconnect') return false;
        // a page and its linked Instagram account share one token: the page and every account linked to it are flagged,
        // and the team is told once, about the page
        const root = hit.parentChannelId ? ((await tx.channel.findUnique({ where: { id: hit.parentChannelId } })) ?? hit) : hit;
        const targets = [root, ...(await tx.channel.findMany({ where: { parentChannelId: root.id } }))].filter((ch) => ch.status !== 'disconnected' && ch.status !== 'needs_reconnect');
        for (const ch of targets) {
          const updated = await tx.channel.update({ where: { id: ch.id }, data: { status: 'needs_reconnect', pausedReason: null, lastTokenCheckAt: new Date() } });
          await this.events.changed(tx, updated, { kind: 'token_checked', description: `invalid:${reason}`, actorType: 'system' });
        }
        await this.notifications.emit(tx, {
          type: 'channel_needs_reconnect',
          workspaceId: root.workspaceId,
          target: { roles: ['owner', 'admin'] },
          key: `channel_needs_reconnect:${root.id}:${new Date().toISOString().slice(0, 10)}`,
          data: { channelId: root.id, page: root.name },
        });
        return true;
      }),
    );
  }

  /** Used by the admin force-release of M10 and by a connect from another workspace after a disconnect here (CHN-05). */
  async releaseExternalId(tx: Tx | typeof prisma, c: Pick<Channel, 'id' | 'externalId'>) {
    await tx.channel.update({ where: { id: c.id }, data: { externalId: `${c.externalId.split('#')[0]}#${c.id}` } });
  }

  get driver() {
    return this.meta.driver;
  }
}
