// ANA-01 / ANA-03 — `GET /dashboard/home`: greeting, "À traiter" queue (COLIS · STOCK · PAGE · INSIGHT · CONVERSATION ·
// RAPPEL · TÂCHE, sorted by urgency then age, max 8), KPI tiles with the 04 §4 named figures over 30 days (Africa/Algiers),
// quick actions, my pages, Get Started, credits and banners. Everything computed live from the rows.
import { Injectable } from '@nestjs/common';
import { HOME_QUEUE_KINDS, HOME_QUEUE_MAX, type HomeBannerKind, type HomeKpi, type HomeQueueItem, type HomeQueueKind, type HomeView } from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { can, type MerchantPermission } from '../../core/rbac/permission-matrix';
import { algiersClock, algiersDayEnd, algiersDay } from '../../core/time/algiers';
import { lastDays } from '../../core/time/period';
import { StockService } from '../catalog/stock.service';
import { channelRef } from '../channels/channel.service';
import { CreditService } from '../credits/credit.service';
import { contextOf } from '../messaging/messaging.presenter';
import { jobPath, jobRefs, parcelPath } from '../notifications/notification.catalog';
import { SafetyService } from '../messaging/safety.service';
import { OnboardingService } from '../workspace/settings.service';

type Range = { gte: Date; lt: Date };
const DAY = 86_400_000;
const kpi = (value: number, previous: number | null): HomeKpi => ({ value, previous, deltaPct: previous ? Math.round(((value - previous) * 1000) / previous) / 10 : null });

/** 04 §4 "Revenue" = Σ completed counter sales (soldAt) + Σ delivered orders (deliveredAt); `aiOnly` = "AI revenue". */
export const revenueIn = async (r: Range, aiOnly = false) => {
  const [orders, sales] = await Promise.all([
    prisma.order.aggregate({ where: { status: 'delivered', deliveredAt: { gte: r.gte, lt: r.lt }, ...(aiOnly ? { source: 'ai' } : {}) }, _sum: { total: true } }),
    aiOnly ? Promise.resolve({ _sum: { total: 0 } }) : prisma.sale.aggregate({ where: { status: 'completed', soldAt: { gte: r.gte, lt: r.lt } }, _sum: { total: true } }),
  ]);
  return (orders._sum.total ?? 0) + (sales._sum.total ?? 0);
};

@Injectable()
export class HomeService {
  constructor(
    private readonly stock: StockService,
    private readonly credits: CreditService,
    private readonly onboarding: OnboardingService,
    private readonly safety: SafetyService,
  ) {}

  private async queue(now: Date, locale: string): Promise<HomeView['queue']> {
    const t = TenantContext.get();
    const index = await this.safety.index();
    const endOfToday = algiersDayEnd(algiersDay(now));
    const [conversations, failed, low, reconnect, insights, callbacks, jobs] = await Promise.all([
      prisma.conversation.findMany({ where: { status: 'needs_human', deletedAt: null }, include: { client: { select: { name: true, phone: true } }, agent: { select: { name: true } } }, orderBy: { lastMessageAt: 'asc' }, take: 50 }),
      prisma.shipment.findMany({ where: { status: 'failed' }, include: { order: { select: { id: true, number: true, clientName: true } } }, orderBy: { updatedAt: 'asc' }, take: 50 }),
      this.stock.lowStockLines(50),
      prisma.channel.findMany({ where: { status: 'needs_reconnect' }, select: { id: true, name: true, platform: true, updatedAt: true } }),
      prisma.agentInsight.findMany({ where: { status: 'pending' }, include: { agent: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 50 }),
      prisma.order.findMany({ where: { confirmationStatus: 'callback', callbackAt: { lte: endOfToday }, status: { in: ['new', 'confirmed', 'preparing'] } }, select: { id: true, number: true, clientName: true, callbackAt: true, assigneeId: true }, orderBy: { callbackAt: 'asc' }, take: 50 }),
      t.userId ? prisma.job.findMany({ where: { createdById: t.userId, status: 'failed', updatedAt: { gte: new Date(now.getTime() - DAY) } }, select: { id: true, kind: true, payload: true, updatedAt: true }, orderBy: { updatedAt: 'asc' }, take: 20 }) : [],
    ]);
    const items: HomeQueueItem[] = [];
    for (const c of conversations) {
      if (index.has(c, c.client?.phone)) continue; // 04 §13: blocked customers leave the queue and Home
      const ctx = contextOf(c) as { handoff?: { at?: string; reason?: string }; handoffReason?: string };
      items.push({ key: `conversation:${c.id}`, kind: 'conversation', urgency: 0, title: c.client?.name ?? '', subtitle: c.lastMessagePreview, since: ctx.handoff?.at ?? (c.lastMessageAt ?? c.updatedAt).toISOString(), path: `/inbox/${c.id}`, ref: { conversationId: c.id, ...(ctx.handoff?.reason || ctx.handoffReason ? { reason: String(ctx.handoff?.reason ?? ctx.handoffReason) } : {}) } });
    }
    for (const s of failed) items.push({ key: `parcel:${s.id}`, kind: 'parcel', urgency: 0, title: `${s.order.number} · ${s.order.clientName}`, subtitle: s.failureReason, since: s.updatedAt.toISOString(), path: parcelPath({ orderId: s.order.id, shipmentId: s.id }), ref: { shipmentId: s.id, orderId: s.order.id } });
    for (const l of low) items.push({ key: `stock:${l.productId}:${l.variantId ?? ''}`, kind: 'stock', urgency: l.state === 'out' ? 0 : 1, title: l.variantName ? `${l.name} · ${l.variantName}` : l.name, subtitle: `${l.stock} / ${l.minStock}`, since: now.toISOString(), path: '/products?lowStock=1', ref: { productId: l.productId, ...(l.variantId ? { variantId: l.variantId } : {}) } });
    for (const c of reconnect) items.push({ key: `page:${c.id}`, kind: 'page', urgency: 0, title: c.name, subtitle: c.platform, since: c.updatedAt.toISOString(), path: `/channels/${c.id}`, ref: { channelId: c.id } });
    for (const i of insights) items.push({ key: `insight:${i.id}`, kind: 'insight', urgency: i.type === 'error' ? 1 : 2, title: i.agent.name, subtitle: i.type, since: i.createdAt.toISOString(), path: `/agents/${i.agent.id}/insights`, ref: { insightId: i.id, agentId: i.agent.id, conversationId: i.conversationId } });
    for (const o of callbacks) items.push({ key: `callback:${o.id}`, kind: 'callback', urgency: o.callbackAt!.getTime() <= now.getTime() ? 0 : 2, title: `${o.number} · ${o.clientName}`, subtitle: o.callbackAt!.toISOString(), since: o.callbackAt!.toISOString(), path: `/orders/${o.id}#calls`, ref: { orderId: o.id } });
    for (const j of jobs) items.push({ key: `task:${j.id}`, kind: 'task', urgency: 1, title: j.kind, subtitle: null, since: j.updatedAt.toISOString(), path: jobPath({ jobId: j.id, kind: j.kind, ...jobRefs(j.payload) }), ref: { jobId: j.id } });
    items.sort((a, b) => a.urgency - b.urgency || a.since.localeCompare(b.since));
    const counts = Object.fromEntries(HOME_QUEUE_KINDS.map((k) => [k, 0])) as Record<HomeQueueKind, number>;
    for (const i of items) counts[i.kind]++;
    void locale;
    // 03 §37 ANA-01 (M8): items handled in the last 24 h stay greyed with "fait par …" in the free slots
    const open = items.slice(0, HOME_QUEUE_MAX);
    const room = HOME_QUEUE_MAX - open.length;
    const handled = room > 0 ? (await this.handled(now)).filter((h) => !items.some((i) => i.ref.orderId && i.ref.orderId === h.ref.orderId && i.kind === h.kind)).slice(0, room) : [];
    return { items: [...open, ...handled], total: items.length, counts };
  }

  /** Cards handled by a member during the last 24 h: insights resolved, callbacks done, failed parcels dealt with, handoffs answered. */
  private async handled(now: Date): Promise<HomeQueueItem[]> {
    const ws = TenantContext.workspaceId();
    const since = new Date(now.getTime() - DAY);
    const name = (u: { firstName: string | null; lastName: string | null } | null | undefined) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '');
    const by = (id: string | null | undefined, u: { firstName: string | null; lastName: string | null } | null | undefined) => (id ? { id, name: name(u) } : null);
    const [insights, history, convs] = await Promise.all([
      prisma.agentInsight.findMany({ where: { status: { in: ['resolved', 'dismissed'] }, resolvedAt: { gte: since } }, include: { agent: { select: { id: true, name: true } }, resolvedBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { resolvedAt: 'desc' }, take: HOME_QUEUE_MAX }),
      prisma.$queryRaw<{ orderId: string; number: string; clientName: string; field: string; actorId: string | null; at: Date; firstName: string | null; lastName: string | null }[]>`
        SELECT h."orderId", o."number", o."clientName", h."field", h."actorId", h."at", u."firstName", u."lastName"
        FROM "OrderStatusHistory" h JOIN "Order" o ON o."id" = h."orderId" LEFT JOIN "User" u ON u."id" = h."actorId"
        WHERE o."workspaceId" = ${ws}::uuid AND h."at" >= ${since} AND h."actorType" = 'user'
          AND ((h."field" = 'confirmationStatus' AND h."from" = 'callback') OR (h."field" = 'deliveryStatus' AND h."from" = 'failed'))
        ORDER BY h."at" DESC LIMIT ${HOME_QUEUE_MAX}`,
      prisma.$queryRaw<{ id: string; client: string | null; at: Date; uid: string | null; firstName: string | null; lastName: string | null }[]>`
        SELECT DISTINCT ON (c."id") c."id", cl."name" client, m."sentAt" at, u."id" uid, u."firstName", u."lastName"
        FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId" LEFT JOIN "Client" cl ON cl."id" = c."clientId" LEFT JOIN "User" u ON u."id" = m."authorUserId"
        WHERE m."workspaceId" = ${ws}::uuid AND m."author" = 'human' AND m."sentAt" >= ${since} AND c."status" <> 'needs_human' AND c."deletedAt" IS NULL
          AND EXISTS (SELECT 1 FROM "AiRun" r WHERE r."conversationId" = c."id" AND r."status" = 'handoff' AND r."startedAt" <= m."sentAt")
        ORDER BY c."id", m."sentAt" ASC LIMIT ${HOME_QUEUE_MAX}`,
    ]);
    const out: HomeQueueItem[] = [];
    for (const i of insights) out.push({ key: `insight:${i.id}:handled`, kind: 'insight', urgency: 2, title: i.agent.name, subtitle: i.type, since: i.createdAt.toISOString(), path: `/agents/${i.agent.id}/insights`, ref: { insightId: i.id, agentId: i.agent.id }, handled: { at: i.resolvedAt!.toISOString(), by: by(i.resolvedBy?.id, i.resolvedBy) } });
    for (const h of history) {
      const kind = h.field === 'confirmationStatus' ? 'callback' : 'parcel';
      out.push({ key: `${kind}:${h.orderId}:handled`, kind, urgency: 2, title: `${h.number} · ${h.clientName}`, subtitle: null, since: h.at.toISOString(), path: kind === 'callback' ? `/orders/${h.orderId}#calls` : `/orders/${h.orderId}#delivery`, ref: { orderId: h.orderId }, handled: { at: h.at.toISOString(), by: by(h.actorId, h) } });
    }
    for (const c of convs) out.push({ key: `conversation:${c.id}:handled`, kind: 'conversation', urgency: 2, title: c.client ?? '', subtitle: null, since: c.at.toISOString(), path: `/inbox/${c.id}`, ref: { conversationId: c.id }, handled: { at: c.at.toISOString(), by: by(c.uid, c) } });
    const seen = new Set<string>();
    return out
      .sort((a, b) => b.handled!.at.localeCompare(a.handled!.at))
      .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  }

  async home(locale = 'fr'): Promise<HomeView> {
    const t = TenantContext.get();
    const now = new Date();
    const { current, previous } = lastDays(30, now);
    const [user, ws, queue, channels, products, overview, rev, revPrev, aiRev, aiRevPrev, pipeline, cash, orders, ordersPrev, aiOrders, toConfirm, conversations, getStarted, balance, aiOrdersByChannel, subscription] = await Promise.all([
      t.userId ? prisma.user.findUnique({ where: { id: t.userId }, select: { firstName: true } }) : null,
      prisma.workspace.findUniqueOrThrow({ where: { id: t.workspaceId }, select: { name: true, onboardingStep: true } }),
      this.queue(now, locale),
      prisma.channel.findMany({ where: { status: { not: 'disconnected' } }, include: { agentChannels: { take: 1, include: { agent: { select: { id: true, name: true, status: true } } } } }, orderBy: { createdAt: 'asc' } }),
      prisma.product.count({ where: { deletedAt: null } }),
      this.stock.overview(),
      revenueIn(current),
      revenueIn(previous),
      revenueIn(current, true),
      revenueIn(previous, true),
      prisma.order.aggregate({ where: { status: { in: ['new', 'confirmed', 'preparing', 'shipped'] } }, _sum: { total: true } }),
      // 04 §4 Cash collected (UX-052): orders placed in the period + completed counter sales of the period
      Promise.all([
        prisma.order.aggregate({ where: { orderedAt: { gte: current.gte, lt: current.lt } }, _sum: { amountPaid: true } }),
        prisma.sale.aggregate({ where: { status: 'completed', soldAt: { gte: current.gte, lt: current.lt } }, _sum: { amountPaid: true } }),
      ]).then(([o, s]) => (o._sum.amountPaid ?? 0) + (s._sum.amountPaid ?? 0)),
      prisma.order.count({ where: { orderedAt: { gte: current.gte, lt: current.lt } } }),
      prisma.order.count({ where: { orderedAt: { gte: previous.gte, lt: previous.lt } } }),
      prisma.order.count({ where: { source: 'ai', orderedAt: { gte: current.gte, lt: current.lt } } }),
      prisma.order.count({ where: { status: 'new' } }),
      prisma.conversation.count({ where: { createdAt: { gte: current.gte, lt: current.lt }, deletedAt: null } }),
      this.onboarding.get(),
      this.credits.balance(t.workspaceId),
      prisma.order.groupBy({ by: ['channelId'], where: { source: 'ai', orderedAt: { gte: current.gte, lt: current.lt }, channelId: { not: null } }, _count: { _all: true } }),
      prisma.subscription.findFirst({ where: { status: { in: ['trial', 'active', 'dunning'] } }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { slug: true } } } }),
    ]);
    const counts = await prisma.conversation.groupBy({ by: ['channelId', 'status'], where: { deletedAt: null, status: 'needs_human' }, _count: { _all: true } });
    const unread = await prisma.conversation.groupBy({ by: ['channelId'], where: { deletedAt: null, unreadCount: { gt: 0 } }, _count: { _all: true } });
    const aiBy = new Map(aiOrdersByChannel.map((r) => [r.channelId, r._count._all]));
    // page card tiles CONV. (n actifs) and MSG 7J (n entr.) `[FIG ANA-01]`
    const convBy = await prisma.conversation.groupBy({ by: ['channelId', 'status'], where: { deletedAt: null }, _count: { _all: true } });
    const msgBy = await prisma.$queryRaw<{ channelId: string; total: bigint; inbound: bigint }[]>`
      SELECT c."channelId", count(*) AS total, count(*) FILTER (WHERE m."direction" = 'in') AS inbound
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE m."workspaceId" = ${t.workspaceId}::uuid AND c."deletedAt" IS NULL AND m."sentAt" >= ${new Date(now.getTime() - 7 * DAY)}
      GROUP BY c."channelId"`;
    const conversationsOf = (channelId: string) => {
      const rows = convBy.filter((r) => r.channelId === channelId);
      return {
        total: rows.reduce((n, r) => n + r._count._all, 0),
        active: rows.filter((r) => r.status === 'active' || r.status === 'needs_human').reduce((n, r) => n + r._count._all, 0),
      };
    };
    const messagesOf = (channelId: string) => {
      const row = msgBy.find((r) => r.channelId === channelId);
      return { total: Number(row?.total ?? 0), inbound: Number(row?.inbound ?? 0) };
    };
    const hour = algiersClock(now).hour;
    const allowed = (p: MerchantPermission) => can(t.role, p);
    const usedPct = balance.unlimited || !balance.planLimit ? 0 : Math.min(100, Math.round((balance.planUsed * 100) / balance.planLimit));
    const banners: HomeView['banners'] = [];
    const push = (kind: HomeBannerKind, params?: Record<string, string | number>) => banners.push(params ? { kind, params } : { kind });
    if (balance.exhausted) push('credits_exhausted');
    else if (usedPct >= 80) push('credits_80', { usedPct });
    const expired = await prisma.subscription.findFirst({ where: { status: 'expired', updatedAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { id: true } });
    if (expired && subscription?.plan.slug === 'free') push('plan_expired');
    else if (subscription && (subscription.status === 'trial' || subscription.status === 'dunning' || subscription.cancelAtPeriodEnd) && subscription.currentPeriodEnd.getTime() - now.getTime() < 7 * DAY) {
      push('plan_expiring', { days: Math.max(0, Math.ceil((subscription.currentPeriodEnd.getTime() - now.getTime()) / DAY)), at: subscription.currentPeriodEnd.toISOString() });
    }
    const needsReconnect = channels.filter((c) => c.status === 'needs_reconnect').length;
    if (needsReconnect) push('reconnect', { count: needsReconnect });
    if (channels.some((c) => c.status === 'pending_review')) push('pending_meta');
    if (ws.onboardingStep >= 1 && ws.onboardingStep < 6) push('resume_onboarding', { step: ws.onboardingStep, total: 6 });
    if (t.emailVerified === false) push('email_unverified');
    return {
      greeting: { firstName: user?.firstName ?? '', workspaceName: ws.name, partOfDay: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening' },
      queue,
      kpis: {
        channels: { active: channels.filter((c) => c.status === 'active').length, total: channels.length, needsReconnect },
        products: { total: products, lowStock: overview.lowStockCount, outOfStock: overview.outOfStockCount },
        revenue30d: kpi(rev, revPrev),
        aiRevenue30d: kpi(aiRev, aiRevPrev),
        pipeline: pipeline._sum.total ?? 0,
        cashCollected30d: cash,
        orders30d: kpi(orders, ordersPrev),
        aiOrders30d: aiOrders,
        ordersToConfirm: toConfirm,
        stockValue: { retail: overview.valueAtRetail, cost: overview.valueAtCost },
        conversations30d: conversations,
      },
      quickActions: [
        { key: 'new_order', enabled: allowed('orders.write'), ...(allowed('orders.write') ? {} : { reasonCode: 'FORBIDDEN' }) },
        { key: 'add_product', enabled: allowed('catalog.write'), ...(allowed('catalog.write') ? {} : { reasonCode: 'FORBIDDEN' }) },
        { key: 'connect_page', enabled: allowed('channels.manage'), ...(allowed('channels.manage') ? {} : { reasonCode: 'FORBIDDEN' }) },
        { key: 'create_agent', enabled: allowed('agents.manage'), ...(allowed('agents.manage') ? {} : { reasonCode: 'FORBIDDEN' }) },
        { key: 'open_inbox', enabled: allowed('inbox.read') },
        { key: 'import_products', enabled: allowed('catalog.write'), ...(allowed('catalog.write') ? {} : { reasonCode: 'FORBIDDEN' }) },
      ],
      pages: channels.map((c) => ({
        ...channelRef(c),
        pausedReason: c.pausedReason,
        agent: c.agentChannels[0]?.agent ?? null,
        needsHuman: counts.find((x) => x.channelId === c.id)?._count._all ?? 0,
        unread: unread.find((x) => x.channelId === c.id)?._count._all ?? 0,
        aiOrders30d: aiBy.get(c.id) ?? 0,
        connectedAt: c.createdAt.toISOString(),
        conversations: conversationsOf(c.id),
        messages7d: messagesOf(c.id),
      })),
      getStarted: getStarted,
      credits: { total: balance.unlimited ? -1 : balance.total, planUsed: balance.planUsed, planLimit: balance.planLimit, unlimited: balance.unlimited, exhausted: balance.exhausted, usedPct },
      banners,
      generatedAt: now.toISOString(),
    };
  }
}
