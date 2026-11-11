// ANA-02 — `GET /analytics/overview` + the 8 tab endpoints (06 "Notifications, home, analytics", 12 §24, Figma ANA-02 /
// ANA-02b). Past days come from the nightly `DailyStat` rows, today (and missing days, and page-filtered requests) from
// the same `computeDays` run live (00-build-order M8 Risks). Money figures follow 04 §4 and are identical to the home
// tiles and to the reports (AT-ORD-10): Revenue = Σ completed sales (soldAt) + Σ delivered orders (deliveredAt).
import { Injectable } from '@nestjs/common';
import {
  DEAD_STOCK_DAYS,
  type AnalyticsAgentsView,
  type AnalyticsChannelsView,
  type AnalyticsConsumptionView,
  type AnalyticsConversationsView,
  type AnalyticsCourierRow,
  type AnalyticsDeliveryView,
  type AnalyticsKpi,
  type AnalyticsOrdersView,
  type AnalyticsOverviewView,
  type AnalyticsProductRow,
  type AnalyticsProductsView,
  type AnalyticsQuery,
  type AnalyticsRange,
  type AnalyticsResponsesView,
  type AnalyticsSeries,
  type AnalyticsTab,
  type AnalyticsUnit,
  type AnalyticsViewOf,
  type AnalyticsWilayaRow,
  type MoneyFigureName,
} from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { notFound } from '../../core/errors/app.exception';
import { algiersDay } from '../../core/time/algiers';
import { StockService } from '../catalog/stock.service';
import { CreditService } from '../credits/credit.service';
import { PROVIDER_NAMES } from '../delivery/adapters/courier-adapter';
import { deadStock } from '../gds/reports/stock-queries';
import { DailyStatsService } from './daily-stats.service';
import { percentile, sumDays, type DayMetrics } from './day-metrics';
import { addDays, deltaPct, eachDay, pct, resolveRange, round1, type DayRange } from './range';

const DAY = 86_400_000;
type Ctx = { hasChannels: boolean; range: DayRange; cur: DayMetrics; prev: DayMetrics | null; byDay: Map<string, DayMetrics>; prevByDay: Map<string, DayMetrics> | null; workspaceId: string; channelId: string | null; rangeView: AnalyticsRange; compare: boolean };

/** KPI with its comparison (counts / money: deltaPct; percentages: deltaPts). */
const kpi = (ctx: Ctx, unit: AnalyticsUnit, value: number | null, previous: number | null | undefined, extra: { figure?: MoneyFigureName; hint?: AnalyticsKpi['hint'] } = {}): AnalyticsKpi => {
  const out: AnalyticsKpi = { value, unit, ...extra };
  if (ctx.compare) {
    out.previous = previous ?? null;
    if (unit === 'pct') out.deltaPts = value === null || previous === null || previous === undefined ? null : round1(value - previous);
    else out.deltaPct = deltaPct(value, previous ?? null);
  }
  return out;
};
/** Snapshot KPI (state of now): never compared. */
const snap = (unit: AnalyticsUnit, value: number | null, extra: { figure?: MoneyFigureName; hint?: AnalyticsKpi['hint'] } = {}): AnalyticsKpi => ({ value, unit, ...extra });

const revenueOf = (m: DayMetrics) => m.revenue.sales + m.revenue.orders;
/** 04 §4 Cash collected = Σ amountPaid of the orders placed in the period + of the completed counter sales (UX-052). */
const cashOf = (m: DayMetrics) => m.orders.cashCollected + (m.revenue.salesPaid ?? 0);
const median = (h: Parameters<typeof percentile>[0], counts: number[]) => percentile(h, counts, 0.5);
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
const usd = (micro: number) => Math.round(micro / 100) / 10_000;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly stats: DailyStatsService,
    private readonly credits: CreditService,
    private readonly stock: StockService,
  ) {}

  async tab<T extends AnalyticsTab>(tab: T, q: AnalyticsQuery): Promise<AnalyticsViewOf[T]> {
    const builders: { [K in AnalyticsTab]: (ctx: Ctx) => Promise<AnalyticsViewOf[K]> } = {
      overview: (c) => this.overview(c),
      conversations: (c) => this.conversations(c),
      responses: (c) => this.responses(c),
      consumption: (c) => this.consumption(c),
      agents: (c) => this.agents(c),
      channels: (c) => this.channels(c),
      products: (c) => this.products(c),
      orders: (c) => this.orders(c),
      delivery: (c) => this.delivery(c),
    };
    const ctx = await this.context(q);
    return builders[tab](ctx) as Promise<AnalyticsViewOf[T]>;
  }

  private async context(q: AnalyticsQuery): Promise<Ctx> {
    const workspaceId = TenantContext.workspaceId();
    const range = resolveRange(q);
    const channelId = q.channelId ?? null;
    if (channelId && !(await prisma.channel.findFirst({ where: { id: channelId }, select: { id: true } }))) throw notFound();
    const [cur, prev, channels] = await Promise.all([
      this.stats.days({ workspaceId, from: range.from, to: range.to, channelId }),
      range.previous ? this.stats.days({ workspaceId, from: range.previous.from, to: range.previous.to, channelId }) : Promise.resolve(null),
      prisma.channel.count({ where: { status: { not: 'disconnected' } } }),
    ]);
    const today = algiersDay();
    const rangeView: AnalyticsRange = {
      period: range.period,
      from: range.from,
      to: range.to,
      days: range.days,
      compare: range.compare,
      previous: range.previous ? { from: range.previous.from, to: range.previous.to } : null,
      timezone: 'Africa/Algiers',
      channelId,
      includesToday: range.from <= today && range.to >= today,
      source: { rollupDays: cur.rollupDays, liveDays: cur.liveDays },
    };
    return {
      hasChannels: channels > 0,
      range,
      cur: sumDays(cur.byDay.values()),
      prev: prev ? sumDays(prev.byDay.values()) : null,
      byDay: cur.byDay,
      prevByDay: prev?.byDay ?? null,
      workspaceId,
      channelId,
      rangeView,
      compare: range.compare === 'previous',
    };
  }

  private base(ctx: Ctx) {
    const m = ctx.cur;
    const empty = !m.orders.created && !m.conv.created && !m.revenue.salesCount && !m.msg.in && !m.orders.delivered && !m.ship.created;
    return { range: ctx.rangeView, generatedAt: new Date().toISOString(), empty, hasChannels: ctx.hasChannels };
  }

  /** One point per day; `previous` = same offset in the previous period. */
  private series<K extends string>(ctx: Ctx, keys: K[], pick: (m: DayMetrics, key: K) => number): AnalyticsSeries<K> {
    const days = eachDay(ctx.range.from, ctx.range.to);
    const zero = sumDays([]);
    return {
      keys,
      points: days.map((day, i) => {
        const m = ctx.byDay.get(day) ?? zero;
        const values = Object.fromEntries(keys.map((k) => [k, pick(m, k)])) as Record<K, number>;
        if (!ctx.prevByDay || !ctx.range.previous) return { day, values, previousDay: null, previous: null };
        const pd = addDays(ctx.range.previous.from, i);
        const pm = ctx.prevByDay.get(pd) ?? zero;
        return { day, values, previousDay: pd, previous: Object.fromEntries(keys.map((k) => [k, pick(pm, k)])) as Record<K, number> };
      }),
    };
  }

  // --- shared figures ---------------------------------------------------------------------------------------------------
  /** 04 §4 Pipeline = Σ Order.total, status ∈ new / confirmed / preparing / shipped (now) — same as the home tile. */
  private async pipeline(channelId: string | null) {
    const r = await prisma.order.aggregate({ where: { status: { in: ['new', 'confirmed', 'preparing', 'shipped'] }, ...(channelId ? { channelId } : {}) }, _sum: { total: true } });
    return r._sum.total ?? 0;
  }

  private async moneyKpis(ctx: Ctx) {
    const { cur, prev } = ctx;
    return {
      revenue: kpi(ctx, 'money', revenueOf(cur), prev ? revenueOf(prev) : null, { figure: 'revenue', hint: { salesCount: cur.revenue.salesCount, deliveredOrders: cur.orders.delivered, salesRevenue: cur.revenue.sales, ordersRevenue: cur.revenue.orders } }),
      netRevenue: kpi(ctx, 'money', revenueOf(cur) - cur.revenue.deliveryFees, prev ? revenueOf(prev) - prev.revenue.deliveryFees : null, { figure: 'net_revenue', hint: { deliveryFees: cur.revenue.deliveryFees } }),
      pipeline: snap('money', await this.pipeline(ctx.channelId), { figure: 'pipeline' }),
      // 04 §4 (UX-052, 10/11): amounts paid on the orders placed in the period + on the counter sales of the period
      cashCollected: kpi(ctx, 'money', cashOf(cur), prev ? cashOf(prev) : null, { figure: 'cash_collected', hint: { orders: cur.orders.cashCollected, sales: cur.revenue.salesPaid ?? 0 } }),
      aiRevenue: kpi(ctx, 'money', cur.revenue.ordersAi, prev?.revenue.ordersAi, { figure: 'ai_revenue' }),
    };
  }

  private async creditsHint(cur: DayMetrics) {
    const b = await this.credits.balance(TenantContext.workspaceId());
    const monthPct = b.unlimited || b.planLimit <= 0 ? null : Math.min(100, Math.round((b.planUsed * 100) / b.planLimit));
    return { balance: b, hint: { monthPct, remaining: b.unlimited ? null : Math.max(0, b.total), text: cur.credits.text, image: cur.credits.image, voice: cur.credits.voice } };
  }

  private async channelNames() {
    const rows = await prisma.channel.findMany({ select: { id: true, name: true, platform: true, status: true, followersCount: true, agentChannels: { take: 1, select: { agent: { select: { id: true, name: true } } } } } });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async wilayaRows(ctx: Ctx, limit?: number): Promise<AnalyticsWilayaRow[]> {
    const ids = Object.keys(ctx.cur.wilayas).map(Number).filter((n) => n > 0);
    if (!ids.length) return [];
    const names = new Map((await prisma.wilaya.findMany({ where: { id: { in: ids } } })).map((w) => [w.id, w]));
    const rows = ids.map((id) => {
      const w = ctx.cur.wilayas[String(id)]!;
      const p = ctx.prev?.wilayas[String(id)];
      const deliveredPct = pct(w.delivered, w.orders);
      const previousDeliveredPct = p ? pct(p.delivered, p.orders) : null;
      const n = names.get(id);
      return {
        wilayaId: id,
        code: n?.code ?? String(id).padStart(2, '0'),
        name: n?.nameFr ?? String(id),
        nameAr: n?.nameAr ?? String(id),
        orders: w.orders,
        delivered: w.delivered,
        returned: w.returned,
        deliveredPct,
        revenue: w.revenue,
        previousDeliveredPct,
        deltaPts: ctx.compare && deliveredPct !== null && previousDeliveredPct !== null ? round1(deliveredPct - previousDeliveredPct) : null,
      };
    });
    rows.sort((a, b) => b.orders - a.orders || b.delivered - a.delivered || a.wilayaId - b.wilayaId);
    return limit ? rows.slice(0, limit) : rows;
  }

  private async productRows(ctx: Ctx, limit: number): Promise<AnalyticsProductRow[]> {
    const entries = Object.entries(ctx.cur.products).filter(([, p]) => p.revenue > 0 || p.sold > 0 || p.requested > 0);
    entries.sort((a, b) => b[1].revenue - a[1].revenue || b[1].sold - a[1].sold || b[1].requested - a[1].requested);
    const top = entries.slice(0, limit);
    if (!top.length) return [];
    const names = new Map((await prisma.product.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return top.map(([id, p]) => {
      const prev = ctx.prev?.products[id];
      return {
        productId: id,
        name: names.get(id) ?? '—',
        requested: p.requested,
        sold: p.sold,
        revenue: p.revenue,
        previous: ctx.compare ? (prev?.revenue ?? 0) : null,
        deltaPct: ctx.compare ? deltaPct(p.revenue, prev?.revenue ?? 0) : null,
        isNew: ctx.compare ? !prev || prev.revenue === 0 : false,
      };
    });
  }

  // --- overview ---------------------------------------------------------------------------------------------------------
  private async overview(ctx: Ctx): Promise<AnalyticsOverviewView> {
    const { cur, prev } = ctx;
    const [money, credits, names, topProducts, topWilayas] = await Promise.all([this.moneyKpis(ctx), this.creditsHint(cur), this.channelNames(), this.productRows(ctx, 5), this.wilayaRows(ctx, 5)]);
    const series = this.series(ctx, ['revenue', 'orders'], (m, k) => (k === 'revenue' ? revenueOf(m) : m.orders.created));
    let bestDay: AnalyticsOverviewView['bestDay'] = null;
    for (const p of series.points) if (p.values.revenue > 0 && (!bestDay || p.values.revenue > bestDay.revenue)) bestDay = { day: p.day, revenue: p.values.revenue };
    const byChannel: AnalyticsOverviewView['byChannel'] = Object.entries(cur.channels)
      .filter(([, c]) => c.orders || c.conv)
      .map(([id, c]) => {
        const ch = names.get(id);
        const p = ctx.prev?.channels[id];
        return { channelId: id, name: ch?.name ?? null, platform: ch?.platform ?? null, agent: ch?.agentChannels[0]?.agent ?? null, orders: c.orders, conversations: c.conv, previous: ctx.compare ? (p?.orders ?? 0) : null, deltaPct: ctx.compare ? deltaPct(c.orders, p?.orders ?? 0) : null };
      })
      .sort((a, b) => b.orders - a.orders || b.conversations - a.conversations);
    const linked = (m: DayMetrics) => m.orders.created - Object.values(m.channels).reduce((s, c) => s + c.orders, 0);
    const manual = linked(cur);
    if (manual > 0 && !ctx.channelId) byChannel.push({ channelId: null, name: null, platform: null, agent: null, orders: manual, conversations: 0, previous: ctx.compare && prev ? linked(prev) : null, deltaPct: ctx.compare && prev ? deltaPct(manual, linked(prev)) : null });
    return {
      ...this.base(ctx),
      kpis: {
        revenue: money.revenue,
        orders: kpi(ctx, 'count', cur.orders.created, prev?.orders.created, { hint: { confirmedPct: pct(cur.orders.confirmed, cur.orders.created), aiOrders: cur.orders.ai } }),
        deliveryRate: kpi(ctx, 'pct', pct(cur.orders.delivered, cur.orders.shipped), prev ? pct(prev.orders.delivered, prev.orders.shipped) : null, { hint: { shipped: cur.orders.shipped, delivered: cur.orders.delivered, returned: cur.orders.returned } }),
        conversations: kpi(ctx, 'count', cur.conv.created, prev?.conv.created, { hint: { aiHandledPct: pct(cur.conv.created - cur.conv.handoffs, cur.conv.created), handoffs: cur.conv.handoffs } }),
        creditsUsed: kpi(ctx, 'credits', cur.credits.total, prev?.credits.total, { hint: credits.hint }),
        netRevenue: money.netRevenue,
        pipeline: money.pipeline,
        cashCollected: money.cashCollected,
        aiRevenue: money.aiRevenue,
      },
      series,
      bestDay,
      funnel: { conversations: cur.conv.created, purchaseIntent: cur.conv.purchaseIntent, ordersCreated: cur.orders.created, confirmed: cur.orders.confirmed, delivered: cur.orders.delivered },
      topProducts,
      topWilayas,
      byChannel,
    };
  }

  // --- conversations ----------------------------------------------------------------------------------------------------
  private async conversations(ctx: Ctx): Promise<AnalyticsConversationsView> {
    const { cur, prev } = ctx;
    const names = await this.channelNames();
    const langTotal = sum(cur.lang);
    const languages = Object.entries(cur.lang)
      .map(([language, count]) => ({ language, count, pct: pct(count, langTotal) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    const hours = cur.hours.length === 24 ? cur.hours : Array.from({ length: 24 }, (_, i) => cur.hours[i] ?? 0);
    let peakHours: AnalyticsConversationsView['peakHours'] = null;
    let best = 0;
    for (let h = 0; h < 24; h++) {
      const w = (hours[h] ?? 0) + (hours[(h + 1) % 24] ?? 0) + (hours[(h + 2) % 24] ?? 0);
      if (w > best) {
        best = w;
        peakHours = { from: h, to: (h + 3) % 24 };
      }
    }
    const aiPct = (m: DayMetrics | null) => (m ? pct(m.conv.created - m.conv.handoffs, m.conv.created) : null);
    return {
      ...this.base(ctx),
      kpis: {
        conversations: kpi(ctx, 'count', cur.conv.created, prev?.conv.created),
        aiHandledPct: kpi(ctx, 'pct', aiPct(cur), aiPct(prev), { hint: { handoffs: cur.conv.handoffs } }),
        messagesPerConversation: kpi(ctx, 'count', median('msgPerConv', cur.msgPerConv), prev ? median('msgPerConv', prev.msgPerConv) : null, { hint: { p95: percentile('msgPerConv', cur.msgPerConv, 0.95) } }),
        aiResponseTime: kpi(ctx, 'seconds', median('aiLatency', cur.aiLatency), prev ? median('aiLatency', prev.aiLatency) : null, { hint: { p95: percentile('aiLatency', cur.aiLatency, 0.95) } }),
        humanResponseTime: kpi(ctx, 'minutes', median('humanLatency', cur.humanLatency), prev ? median('humanLatency', prev.humanLatency) : null, { hint: { p95: percentile('humanLatency', cur.humanLatency, 0.95) } }),
      },
      languages,
      hours,
      peakHours,
      series: this.series(ctx, ['new', 'transferred'], (m, k) => (k === 'new' ? m.conv.created : m.conv.handoffs)),
      byChannel: Object.entries(cur.channels)
        .filter(([id, c]) => c.conv && names.has(id))
        .map(([id, c]) => {
          const ch = names.get(id)!;
          const p = ctx.prev?.channels[id];
          return { channelId: id, name: ch.name, platform: ch.platform, conversations: c.conv, aiPct: pct(c.conv - c.handoffs, c.conv), handoffs: c.handoffs, previous: ctx.compare ? (p?.conv ?? 0) : null, deltaPct: ctx.compare ? deltaPct(c.conv, p?.conv ?? 0) : null };
        })
        .sort((a, b) => b.conversations - a.conversations),
    };
  }

  // --- responses --------------------------------------------------------------------------------------------------------
  private async responses(ctx: Ctx): Promise<AnalyticsResponsesView> {
    const { cur, prev } = ctx;
    const credits = await this.creditsHint(cur);
    const reactions = cur.reactions.like + cur.reactions.dislike;
    const intentTotal = sum(cur.intents);
    return {
      ...this.base(ctx),
      kpis: {
        aiReplies: kpi(ctx, 'count', cur.msg.ai, prev?.msg.ai, { hint: { text: cur.credits.textN, image: cur.credits.imageN, voice: cur.credits.voiceN } }),
        creditsUsed: kpi(ctx, 'credits', cur.credits.total, prev?.credits.total, { hint: { monthPct: credits.hint.monthPct } }),
        creditsPerReply: kpi(ctx, 'ratio', cur.msg.ai ? round1(cur.credits.total / cur.msg.ai) : null, prev && prev.msg.ai ? round1(prev.credits.total / prev.msg.ai) : null),
        errorRate: kpi(ctx, 'pct', pct(cur.ai.error, cur.ai.runs), prev ? pct(prev.ai.error, prev.ai.runs) : null, { hint: { fallbacks: cur.ai.fallback } }),
        reactions: kpi(ctx, 'count', reactions, prev ? prev.reactions.like + prev.reactions.dislike : null, { hint: { likes: cur.reactions.like, dislikes: cur.reactions.dislike, score: reactions ? round1((cur.reactions.like / reactions) * 5) : null } }),
      },
      series: this.series(ctx, ['replies', 'errors', 'handoffs'], (m, k) => (k === 'replies' ? m.msg.ai : k === 'errors' ? m.ai.error : m.conv.handoffs)),
      byIntent: Object.entries(cur.intents)
        .map(([intent, runs]) => ({ intent, runs, pct: pct(runs, intentTotal) ?? 0 }))
        .sort((a, b) => b.runs - a.runs),
      byStatus: (['ok', 'unclear', 'unknown', 'handoff', 'error'] as const).map((status) => ({ status, runs: cur.ai[status] })),
    };
  }

  // --- consumption ------------------------------------------------------------------------------------------------------
  private async consumption(ctx: Ctx): Promise<AnalyticsConsumptionView> {
    const { cur, prev } = ctx;
    const [credits, week, models] = await Promise.all([
      this.creditsHint(cur),
      prisma.creditLedger.aggregate({ where: { kind: 'debit', createdAt: { gte: new Date(Date.now() - 7 * DAY) } }, _sum: { credits: true } }),
      Object.keys(cur.models).length
        ? TenantContext.runSystem(() => prisma.aiModel.findMany({ where: { id: { in: Object.keys(cur.models) } }, select: { id: true, displayName: true, provider: { select: { displayName: true } } } }))
        : Promise.resolve([]),
    ]);
    const b = credits.balance;
    const dailyBurn = Math.round((-(week._sum.credits ?? 0) / 7) * 10) / 10;
    const exhaustsOn = !b.unlimited && dailyBurn > 0 ? addDays(algiersDay(), Math.max(0, Math.floor(Math.max(0, b.total) / dailyBurn))) : null;
    const modelNames = new Map(models.map((m) => [m.id, m]));
    const type = (t: 'text' | 'image' | 'voice') => {
      const volume = cur.credits[`${t}N`];
      const cr = cur.credits[t];
      const p = prev ? prev.credits[t] : null;
      return { type: t, volume, credits: cr, unitCost: volume ? round1(cr / volume)! : 0, previous: ctx.compare ? p : null, deltaPct: ctx.compare ? deltaPct(cr, p) : null };
    };
    return {
      ...this.base(ctx),
      kpis: {
        creditsUsed: kpi(ctx, 'credits', cur.credits.total, prev?.credits.total, { hint: { monthPct: credits.hint.monthPct, remaining: credits.hint.remaining } }),
        costUsd: kpi(ctx, 'usd', usd(cur.ai.costMicro), prev ? usd(prev.ai.costMicro) : null),
        costPerReplyUsd: kpi(ctx, 'usd', cur.msg.ai ? usd(cur.ai.costMicro / cur.msg.ai) : null, prev && prev.msg.ai ? usd(prev.ai.costMicro / prev.msg.ai) : null),
        tokens: kpi(ctx, 'count', cur.ai.inputTokens + cur.ai.outputTokens, prev ? prev.ai.inputTokens + prev.ai.outputTokens : null, { hint: { input: cur.ai.inputTokens, output: cur.ai.outputTokens } }),
      },
      projection: { balance: b.unlimited ? null : Math.max(0, b.total), unlimited: b.unlimited, dailyBurn, exhaustsOn, packsPath: '/settings/credits' },
      series: this.series(ctx, ['text', 'image', 'voice'], (m, k) => m.credits[k]),
      byType: [type('text'), type('image'), type('voice'), { type: 'orders', volume: cur.orders.ai, credits: 0, unitCost: 0, previous: ctx.compare ? (prev?.orders.ai ?? null) : null, deltaPct: ctx.compare ? deltaPct(cur.orders.ai, prev?.orders.ai ?? null) : null }],
      byModel: Object.entries(cur.models)
        .map(([id, m]) => ({ modelId: id, name: modelNames.get(id)?.displayName ?? id, provider: modelNames.get(id)?.provider.displayName ?? '', runs: m.runs, inputTokens: m.inputTokens, outputTokens: m.outputTokens, costUsd: usd(m.costMicro) }))
        .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs),
    };
  }

  // --- agents -----------------------------------------------------------------------------------------------------------
  private async agents(ctx: Ctx): Promise<AnalyticsAgentsView> {
    const { cur, prev } = ctx;
    const [agents, pending, resolved] = await Promise.all([
      prisma.agent.findMany({ where: { OR: [{ deletedAt: null }, { id: { in: Object.keys(cur.agents) } }] }, select: { id: true, name: true, status: true, deletedAt: true } }),
      prisma.agentInsight.count({ where: { status: 'pending' } }),
      prisma.agentInsight.count({ where: { status: 'resolved', resolvedAt: { gte: ctx.range.gte, lt: ctx.range.lt } } }),
    ]);
    const autonomy = (a: { conv: number; handoffs: number } | undefined) => (a && a.conv ? pct(a.conv - a.handoffs, a.conv) : null);
    const avgAutonomy = (m: DayMetrics | null) => {
      if (!m) return null;
      const vals = Object.values(m.agents).map(autonomy).filter((v): v is number => v !== null);
      return vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    };
    const live = agents.filter((a) => !a.deletedAt);
    const rows = agents
      .filter((a) => !a.deletedAt || cur.agents[a.id])
      .map((a) => {
        const x = cur.agents[a.id];
        const p = ctx.prev?.agents[a.id];
        return { agentId: a.id, name: a.name, status: a.status, conversations: x?.conv ?? 0, autonomyPct: autonomy(x), orders: x?.orders ?? 0, aiRevenue: x?.revenue ?? 0, credits: x?.credits ?? 0, previous: ctx.compare ? (p?.conv ?? 0) : null, deltaPct: ctx.compare ? deltaPct(x?.conv ?? 0, p?.conv ?? 0) : null };
      })
      .sort((a, b) => b.conversations - a.conversations || a.name.localeCompare(b.name));
    const ids = rows.filter((r) => r.conversations > 0).map((r) => r.agentId);
    return {
      ...this.base(ctx),
      kpis: {
        activeAgents: snap('count', live.filter((a) => a.status === 'active').length, { hint: { paused: live.filter((a) => a.status === 'paused').length } }),
        autonomy: kpi(ctx, 'pct', avgAutonomy(cur), avgAutonomy(prev), { hint: Object.fromEntries(rows.filter((r) => r.autonomyPct !== null).map((r) => [r.name, r.autonomyPct])) }),
        ordersCreated: kpi(ctx, 'count', cur.orders.ai, prev?.orders.ai, { hint: { confirmedPct: pct(cur.orders.confirmedAi, cur.orders.ai) } }),
        insightsPending: snap('count', pending, { hint: { resolved } }),
      },
      series: this.series(ctx, ids, (m, id) => autonomy(m.agents[id]) ?? 0),
      agents: rows,
    };
  }

  // --- channels ---------------------------------------------------------------------------------------------------------
  private async channels(ctx: Ctx): Promise<AnalyticsChannelsView> {
    const { cur, prev } = ctx;
    const names = await this.channelNames();
    const all = [...names.values()].filter((c) => c.status !== 'disconnected');
    const conv = (m: DayMetrics | null, platform: string) => (m ? Object.entries(m.channels).reduce((s, [id, c]) => s + (names.get(id)?.platform === platform ? c.conv : 0), 0) : null);
    const handoffs = (m: DayMetrics, platform: string) => Object.entries(m.channels).reduce((s, [id, c]) => s + (names.get(id)?.platform === platform ? c.handoffs : 0), 0);
    const fb = conv(cur, 'facebook') ?? 0;
    const rows = Object.entries(cur.channels)
      .filter(([id]) => names.has(id))
      .map(([id, c]) => {
        const ch = names.get(id)!;
        const p = ctx.prev?.channels[id];
        return { channelId: id, name: ch.name, platform: ch.platform, inbound: c.in, outbound: c.out, conversations: c.conv, orders: c.orders, aiOrders: c.aiOrders, aiRevenue: c.aiRevenue, previous: ctx.compare ? (p?.in ?? 0) : null, deltaPct: ctx.compare ? deltaPct(c.in, p?.in ?? 0) : null };
      })
      .sort((a, b) => b.inbound - a.inbound || b.conversations - a.conversations);
    return {
      ...this.base(ctx),
      kpis: {
        activePages: snap('count', all.filter((c) => c.status === 'active').length, { hint: { pendingMeta: all.filter((c) => c.status === 'pending_review').length } }),
        followers: snap('count', all.filter((c) => c.platform === 'facebook').reduce((s, c) => s + (c.followersCount ?? 0), 0)),
        conversationsFacebook: kpi(ctx, 'count', fb, conv(prev, 'facebook'), { hint: { aiPct: pct(fb - handoffs(cur, 'facebook'), fb) } }),
        conversationsInstagram: kpi(ctx, 'count', conv(cur, 'instagram'), conv(prev, 'instagram')),
        inboundMessages: kpi(ctx, 'count', cur.msg.in, prev?.msg.in, { hint: { skippedWindow: cur.ai.skippedWindow } }),
      },
      series: this.series(ctx, rows.map((r) => r.channelId), (m, id) => m.channels[id]?.in ?? 0),
      channels: rows,
    };
  }

  // --- products ---------------------------------------------------------------------------------------------------------
  private async products(ctx: Ctx): Promise<AnalyticsProductsView> {
    const { cur, prev } = ctx;
    const t = TenantContext.get();
    const [active, overview, dead, products, insights] = await Promise.all([
      prisma.product.count({ where: { deletedAt: null, isActive: true } }),
      this.stock.overview(),
      deadStock(t.workspaceId, DEAD_STOCK_DAYS),
      this.productRows(ctx, 50),
      prisma.agentInsight.groupBy({ by: ['topicKey'], where: { type: 'unknown_topic', createdAt: { gte: ctx.range.gte, lt: ctx.range.lt }, topicKey: { not: null } }, _count: { _all: true }, orderBy: { _count: { topicKey: 'desc' } }, take: 10 }),
    ]);
    const sold = (m: DayMetrics) => Object.values(m.products).reduce((s, p) => s + p.sold, 0);
    const rev = (m: DayMetrics) => Object.values(m.products).reduce((s, p) => s + p.revenue, 0);
    const cogs = (m: DayMetrics) => Object.values(m.products).reduce((s, p) => s + p.cogs, 0);
    const margin = (m: DayMetrics | null) => (m && t.stockMode === 'advanced' ? pct(rev(m) - cogs(m), rev(m)) : null);
    const best = Object.entries(cur.products).sort((a, b) => b[1].revenue - a[1].revenue)[0];
    const bestName = best && best[1].revenue > 0 ? (products.find((p) => p.productId === best[0])?.name ?? null) : null;
    // categories: the 3 best by revenue + "other"
    const ids = Object.keys(cur.products);
    const cats = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, categoryId: true, category: { select: { name: true } } } }) : [];
    const catOf = new Map(cats.map((p) => [p.id, p.categoryId ?? 'none']));
    const catName = new Map(cats.map((p) => [p.categoryId ?? 'none', p.category?.name ?? null]));
    const catRevenue = new Map<string, number>();
    for (const [id, p] of Object.entries(cur.products)) catRevenue.set(catOf.get(id) ?? 'none', (catRevenue.get(catOf.get(id) ?? 'none') ?? 0) + p.revenue);
    const topCats = [...catRevenue.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    const keys = [...topCats, 'other'];
    return {
      ...this.base(ctx),
      kpis: {
        activeProducts: snap('count', active, { hint: { lowStock: overview.lowStockCount } }),
        unitsSold: kpi(ctx, 'count', sold(cur), prev ? sold(prev) : null, { hint: { distinct: Object.values(cur.products).filter((p) => p.sold > 0).length } }),
        topProduct: kpi(ctx, 'money', best && best[1].revenue > 0 ? best[1].revenue : null, best ? (prev?.products[best[0]]?.revenue ?? 0) : null, { hint: { productId: best && best[1].revenue > 0 ? best[0] : null, name: bestName } }),
        avgMarginPct: kpi(ctx, 'pct', margin(cur), margin(prev)),
        deadStock: snap('count', dead.length, { hint: { valueAtCost: dead.reduce((s, l) => s + l.valueAtCost, 0), days: DEAD_STOCK_DAYS } }),
      },
      series: this.series(ctx, keys, (m, key) =>
        Object.entries(m.products).reduce((s, [id, p]) => {
          const c = catOf.get(id) ?? 'none';
          return s + ((key === 'other' ? !topCats.includes(c) : c === key) ? p.revenue : 0);
        }, 0),
      ),
      categories: keys.map((key) => ({ key, categoryId: key === 'other' || key === 'none' ? null : key, name: key === 'other' ? null : (catName.get(key) ?? null) })),
      products,
      requestedAbsent: insights.map((i) => ({ topic: i.topicKey ?? '', count: i._count._all })),
    };
  }

  // --- orders -----------------------------------------------------------------------------------------------------------
  private async orders(ctx: Ctx): Promise<AnalyticsOrdersView> {
    const { cur, prev } = ctx;
    const [money, wilayas] = await Promise.all([this.moneyKpis(ctx), this.wilayaRows(ctx)]);
    const share = (o: Record<string, number>) => {
      const total = sum(o);
      return Object.entries(o)
        .map(([k, count]) => ({ k, count, pct: pct(count, total) ?? 0 }))
        .sort((a, b) => b.count - a.count);
    };
    const returnedPct = (m: DayMetrics | null) => (m ? pct(m.orders.returned, m.orders.delivered + m.orders.returned) : null);
    const sources = ['ai', 'manual', 'mobile', 'api', 'import'] as const;
    return {
      ...this.base(ctx),
      kpis: {
        orders: kpi(ctx, 'count', cur.orders.created, prev?.orders.created, { hint: { ai: cur.orders.ai, human: cur.orders.created - cur.orders.ai } }),
        confirmationRate: kpi(ctx, 'pct', pct(cur.orders.confirmed, cur.orders.created), prev ? pct(prev.orders.confirmed, prev.orders.created) : null, { hint: { callsPerOrder: cur.orders.created ? round1(cur.orders.calls / cur.orders.created) : null } }),
        delivered: kpi(ctx, 'count', cur.orders.delivered, prev?.orders.delivered, { hint: { deliveryRate: pct(cur.orders.delivered, cur.orders.shipped), codPct: pct(cur.orders.deliveredCod, cur.orders.delivered) } }),
        cancelledPct: kpi(ctx, 'pct', pct(cur.orders.cancelled, cur.orders.created), prev ? pct(prev.orders.cancelled, prev.orders.created) : null, { hint: { cancelled: cur.orders.cancelled, wrongNumberPct: pct(cur.cancelReasons.fake ?? 0, cur.orders.created) } }),
        returnedPct: kpi(ctx, 'pct', returnedPct(cur), returnedPct(prev), { hint: { returned: cur.orders.returned } }),
        abandoned: kpi(ctx, 'count', cur.conv.abandoned, prev?.conv.abandoned, { hint: { pct: pct(cur.conv.abandoned, cur.conv.purchaseIntent) } }),
        ...money,
      },
      series: this.series(ctx, [...sources], (m, k) => m.srcCreated[k] ?? 0),
      funnel: { created: cur.orders.created, confirmed: cur.orders.confirmed, shipped: cur.orders.shipped, delivered: cur.orders.delivered },
      bySource: sources.filter((s) => cur.srcCreated[s] || cur.srcDelivered[s]).map((source) => ({ source, orders: cur.srcCreated[source] ?? 0, delivered: cur.srcDelivered[source] ?? 0, revenue: cur.srcRevenue[source] ?? 0 })),
      wilayas,
      cancelReasons: share(cur.cancelReasons).map((r) => ({ reason: r.k, count: r.count, pct: r.pct })),
      paymentMix: share(cur.payment).map((r) => ({ method: r.k, count: r.count, pct: r.pct })),
      byStatus: Object.entries(cur.status)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // --- delivery ---------------------------------------------------------------------------------------------------------
  private async delivery(ctx: Ctx): Promise<AnalyticsDeliveryView> {
    const { cur, prev } = ctx;
    const accIds = Object.keys(cur.couriers)
      .map((k) => k.split(':')[1]!)
      .filter((id) => id !== 'none');
    const now = Date.now();
    const failedWhere = { status: 'failed' as const, ...(ctx.channelId ? { order: { channelId: ctx.channelId } } : {}) };
    const [accounts, openFailures, over48h] = await Promise.all([
      accIds.length ? prisma.courierAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, displayName: true } }) : Promise.resolve([]),
      prisma.shipment.count({ where: failedWhere }),
      prisma.shipment.count({ where: { ...failedWhere, updatedAt: { lt: new Date(now - 48 * 3600_000) } } }),
    ]);
    const accName = new Map(accounts.map((a) => [a.id, a.displayName]));
    const couriers: AnalyticsCourierRow[] = Object.entries(cur.couriers)
      .map(([key, c]) => {
        const [provider, acc] = key.split(':') as [string, string];
        const closed = c.delivered + c.returned;
        return {
          key,
          provider,
          courierAccountId: acc === 'none' ? null : acc,
          name: (acc !== 'none' ? accName.get(acc) : undefined) ?? PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] ?? provider,
          parcels: c.parcels,
          delivered: c.delivered,
          deliveredPct: pct(c.delivered, c.parcels || closed),
          returned: c.returned,
          returnedPct: pct(c.returned, c.parcels || closed),
          failed: c.failed,
          avgDays: c.daysCount ? round1(c.daysSum / c.daysCount) : null,
          codCollected: c.cod,
          courierFees: c.fees,
        };
      })
      .sort((a, b) => b.parcels - a.parcels || b.delivered - a.delivered);
    const avg = (m: DayMetrics | null) => (m && m.ship.daysCount ? round1(m.ship.daysSum / m.ship.daysCount) : null);
    return {
      ...this.base(ctx),
      kpis: {
        shipped: kpi(ctx, 'count', cur.ship.created, prev?.ship.created, { hint: Object.fromEntries(couriers.filter((c) => c.parcels).map((c) => [c.name, c.parcels])) }),
        avgDays: kpi(ctx, 'days', avg(cur), avg(prev), { hint: { p95: percentile('shipDays', cur.shipDays, 0.95) } }),
        firstAttemptPct: kpi(ctx, 'pct', pct(cur.ship.firstAttempt, cur.ship.delivered), prev ? pct(prev.ship.firstAttempt, prev.ship.delivered) : null, { hint: { secondAttemptPct: pct(cur.ship.secondAttempt, cur.ship.delivered) } }),
        openFailures: snap('count', openFailures, { hint: { over48h } }),
        courierFees: kpi(ctx, 'money', cur.ship.courierFees, prev?.ship.courierFees, { hint: { customerFees: cur.ship.customerFees } }),
      },
      series: this.series(ctx, couriers.map((c) => c.key), (m, key) => {
        const c = m.couriers[key];
        return c && c.daysCount ? (round1(c.daysSum / c.daysCount) ?? 0) : 0;
      }),
      couriers,
    };
  }
}
