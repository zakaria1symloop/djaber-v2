// ADM-01 overview: platform KPIs, signups / activations / churn per day, alerts, top workspaces, AI cost per model,
// trials expiring. Daily figures come from `PlatformDailyStat` (the platform totals of `sched-daily-stats`, M8 carry-over)
// plus a live computation of today; nothing is incremented.
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AdminAlertDto, AdminOverviewDto, AdminPeriod } from '@djaber/shared';
import { Prisma, prisma, TenantContext } from '@djaber/db';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { CURRENT_STATUSES } from '../billing/billing.util';
import { DAY, freePlanName, pickLocal } from './admin.util';

export type PlatformMetrics = {
  signups: number;
  workspacesCreated: number;
  activations: number;
  churned: number;
  activeWorkspaces: number;
  suspended: number;
  mrr: number;
  creditsConsumed: number;
  aiCostUsd: number;
  conversations: number;
  aiReplies: number;
  byModel: { modelId: string; provider: string; model: string; capability: string; costUsd: number; runs: number; credits: number }[];
};
const PERIOD_DAYS: Record<AdminPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
/** `sched-daily-stats` recomputes yesterday and the 7 days before it (late rows), like the merchant rollup. */
const RECOMPUTE_DAYS = 8;

@Injectable()
export class AdminOverviewService implements OnModuleInit {
  constructor(private readonly registry: ProcessorRegistry) {}

  onModuleInit() {
    this.registry.extendCron('sched-daily-stats', 'platform-totals', () => this.rollupPlatform());
  }

  // --- rollup (worker) -----------------------------------------------------------------------------------------------------
  async rollupPlatform(now = new Date()): Promise<number> {
    return TenantContext.runSystem(async () => {
      const today = algiersDay(now);
      let n = 0;
      for (let i = 1; i <= RECOMPUTE_DAYS; i++) {
        const day = algiersDay(new Date(algiersDayStart(today).getTime() - i * DAY + 3600_000));
        const prev = await prisma.platformDailyStat.findUnique({ where: { day: new Date(`${day}T00:00:00Z`) } });
        const m = await this.metricsOf(day, i === 1 ? undefined : (prev?.metrics as PlatformMetrics | undefined));
        await prisma.platformDailyStat.upsert({ where: { day: new Date(`${day}T00:00:00Z`) }, create: { day: new Date(`${day}T00:00:00Z`), metrics: m as unknown as Prisma.InputJsonValue }, update: { metrics: m as unknown as Prisma.InputJsonValue, computedAt: new Date() } });
        n++;
      }
      return n;
    });
  }

  /**
   * Figures of one Africa/Algiers day. Point-in-time figures (active workspaces, suspended, MRR) are taken now for the
   * latest day; an older day keeps the value it was first computed with (`keep`).
   */
  async metricsOf(day: string, keep?: Pick<PlatformMetrics, 'activeWorkspaces' | 'suspended' | 'mrr'>): Promise<PlatformMetrics> {
    const gte = algiersDayStart(day);
    const lt = algiersDayEnd(day);
    const [signups, workspacesCreated, activations, churned, credits, convs, replies, runs] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte, lt }, platformRole: 'none' } }),
      prisma.workspace.count({ where: { createdAt: { gte, lt } } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT "workspaceId", min("createdAt") AS first FROM "Channel" GROUP BY "workspaceId") f WHERE f.first >= ${gte} AND f.first < ${lt}`,
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "Subscription" s JOIN "Plan" p ON p.id = s."planId"
        WHERE p.slug = 'free' AND s."createdAt" >= ${gte} AND s."createdAt" < ${lt}
          AND EXISTS (SELECT 1 FROM "Subscription" o JOIN "Plan" op ON op.id = o."planId" WHERE o."workspaceId" = s."workspaceId" AND op.slug <> 'free' AND o."createdAt" < s."createdAt")`,
      prisma.creditLedger.aggregate({ where: { kind: 'debit', createdAt: { gte, lt } }, _sum: { credits: true } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "conversationId") AS n FROM "Message" WHERE "direction" = 'in' AND "sentAt" >= ${gte} AND "sentAt" < ${lt}`,
      prisma.aiRun.count({ where: { kind: 'reply', status: { not: 'error' }, startedAt: { gte, lt } } }),
      prisma.$queryRaw<{ modelId: string; runs: bigint; input: bigint | null; output: bigint | null; credits: bigint | null }[]>`
        SELECT "modelId", count(*) AS runs, sum("inputTokens") AS input, sum("outputTokens") AS output, sum("creditsCharged") AS credits FROM "AiRun" WHERE "startedAt" >= ${gte} AND "startedAt" < ${lt} GROUP BY "modelId"`,
    ]);
    const models = runs.length ? await prisma.aiModel.findMany({ where: { id: { in: runs.map((r) => r.modelId) } }, include: { provider: true } }) : [];
    const byModel = runs.map((r) => {
      const m = models.find((x) => x.id === r.modelId);
      const cost = m ? (Number(r.input ?? 0) * Number(m.inputPricePerM) + Number(r.output ?? 0) * Number(m.outputPricePerM)) / 1_000_000 : 0;
      return { modelId: r.modelId, provider: m?.provider.displayName ?? '—', model: m?.modelId ?? '—', capability: m?.capabilities[0] ?? 'text', costUsd: Math.round(cost * 100) / 100, runs: Number(r.runs), credits: Number(r.credits ?? 0) };
    });
    const point = keep ?? (await this.pointInTime());
    return {
      signups,
      workspacesCreated,
      activations: Number(activations[0]?.n ?? 0),
      churned: Number(churned[0]?.n ?? 0),
      activeWorkspaces: point.activeWorkspaces,
      suspended: point.suspended,
      mrr: point.mrr,
      creditsConsumed: -(credits._sum.credits ?? 0),
      aiCostUsd: Math.round(byModel.reduce((n, m) => n + m.costUsd, 0) * 100) / 100,
      conversations: Number(convs[0]?.n ?? 0),
      aiReplies: replies,
      byModel,
    };
  }

  private async pointInTime() {
    const [activeWorkspaces, suspended, paid] = await Promise.all([
      prisma.workspace.count({ where: { deletedAt: null, status: 'active' } }),
      prisma.workspace.count({ where: { deletedAt: null, status: 'suspended' } }),
      prisma.subscription.findMany({ where: { status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' } }, select: { appliedPrice: true, billingCycle: true } }),
    ]);
    return { activeWorkspaces, suspended, mrr: paid.reduce((n, s) => n + (s.billingCycle === 'yearly' ? Math.round(s.appliedPrice / 12) : s.appliedPrice), 0) };
  }

  // --- read (HTTP) ---------------------------------------------------------------------------------------------------------
  async overview(period: AdminPeriod, now = new Date()): Promise<AdminOverviewDto> {
    const n = PERIOD_DAYS[period];
    const today = algiersDay(now);
    const days: string[] = [];
    for (let i = n - 1; i >= 0; i--) days.push(algiersDay(new Date(algiersDayStart(today).getTime() - i * DAY + 3600_000)));
    const from = days[0]!;
    const rows = await prisma.platformDailyStat.findMany({ where: { day: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${today}T00:00:00Z`) } } });
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.metrics as unknown as PlatformMetrics]));
    // days not rolled up yet (fresh install, worker down) are computed on the fly; today is always live
    for (const d of days) if (!byDay.has(d) || d === today) byDay.set(d, await this.metricsOf(d, d === today ? undefined : (byDay.get(d) ?? (await this.pointInTime()))));
    const series = days.map((d) => ({ day: d, signups: byDay.get(d)!.signups, activations: byDay.get(d)!.activations, churned: byDay.get(d)!.churned }));
    const ms = days.map((d) => byDay.get(d)!);
    const live = byDay.get(today)!;
    const prevRow = await prisma.platformDailyStat.findFirst({ where: { day: { lt: new Date(`${from}T00:00:00Z`) } }, orderBy: { day: 'desc' } });
    const prevMrr = (prevRow?.metrics as unknown as PlatformMetrics | undefined)?.mrr;
    const gte = algiersDayStart(from);
    const [cohortRow] = await prisma.$queryRaw<{ created: bigint; activated: bigint }[]>`
      SELECT count(*) AS created, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Channel" c WHERE c."workspaceId" = w.id)) AS activated
      FROM "Workspace" w WHERE w."createdAt" >= ${gte} AND w."deletedAt" IS NULL`;
    const [byPlan, top, trials, incidents] = await Promise.all([
      prisma.subscription.groupBy({ by: ['planId'], where: { status: { in: [...CURRENT_STATUSES] } }, _count: { _all: true } }),
      prisma.$queryRaw<{ workspaceId: string; credits: bigint }[]>`SELECT "workspaceId", -sum("credits") AS credits FROM "CreditLedger" WHERE "kind" = 'debit' AND "createdAt" >= ${gte} GROUP BY "workspaceId" ORDER BY credits DESC LIMIT 5`,
      prisma.subscription.findMany({ where: { status: 'trial', trialEndsAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } }, include: { workspace: { select: { id: true, name: true } } }, orderBy: { trialEndsAt: 'asc' }, take: 10 }),
      prisma.incident.findMany({ where: { OR: [{ resolvedAt: null }, { resolvedAt: { gte } }], startedAt: { lt: now } }, select: { startedAt: true, resolvedAt: true, severity: true, components: true } }),
    ]);
    const plans = await prisma.plan.findMany({ where: { id: { in: [...byPlan.map((b) => b.planId)] } } });
    const topWs = top.length ? await prisma.workspace.findMany({ where: { id: { in: top.map((t) => t.workspaceId) } }, select: { id: true, name: true, subscriptions: { where: { status: { in: [...CURRENT_STATUSES] } }, include: { plan: true }, take: 1 } } }) : [];
    const trialIds = trials.map((t) => t.workspaceId);
    const [tOrders, tPages, tConvs] = trialIds.length
      ? await Promise.all([
          prisma.order.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: trialIds } }, _count: { _all: true } }),
          prisma.channel.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: trialIds }, status: { not: 'disconnected' }, parentChannelId: null }, _count: { _all: true } }),
          prisma.conversation.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: trialIds } }, _count: { _all: true } }),
        ])
      : [[], [], []];
    const periodMin = n * 24 * 60;
    const incidentMinutes = Math.round(incidents.filter((i) => i.components.some((c) => /meta|webhook/i.test(c)) || i.components.length === 0).reduce((s, i) => s + ((i.resolvedAt ?? now).getTime() - Math.max(i.startedAt.getTime(), gte.getTime())) / 60_000, 0));
    const aiByModel = new Map<string, AdminOverviewDto['aiCostByModel'][number]>();
    for (const m of ms) for (const b of m.byModel ?? []) {
      const cur = aiByModel.get(b.modelId) ?? { provider: b.provider, model: b.model, capability: b.capability, costUsd: 0, units: 0, unit: b.capability === 'transcription' ? 'notes' : b.capability === 'vision' ? 'photos' : 'credits' };
      cur.costUsd = Math.round((cur.costUsd + b.costUsd) * 100) / 100;
      cur.units += cur.unit === 'credits' ? b.credits : b.runs;
      aiByModel.set(b.modelId, cur);
    }
    const consumed = ms.reduce((s, m) => s + m.creditsConsumed, 0);
    const aiCost = Math.round(ms.reduce((s, m) => s + m.aiCostUsd, 0) * 100) / 100;
    const pricing = await prisma.creditPricing.findFirst({ where: { effectiveAt: { lte: now } }, orderBy: { version: 'desc' } });
    const revenueDzd = consumed * Number(pricing?.creditPriceDzd ?? 0);
    const costDzd = aiCost * Number(pricing?.usdToDzd ?? 135);
    const peak = ms.reduce<{ day: string; count: number } | null>((p, m, i) => (!p || m.conversations > p.count ? { day: days[i]!, count: m.conversations } : p), null);
    return {
      period,
      from,
      to: today,
      kpis: {
        workspaces: { active: live.activeWorkspaces, newInPeriod: ms.reduce((s, m) => s + m.workspacesCreated, 0), suspended: live.suspended },
        mrr: {
          amount: live.mrr,
          deltaPct: prevMrr ? Math.round(((live.mrr - prevMrr) / prevMrr) * 100) : null,
          byPlan: plans.filter((p) => p.slug !== 'free').map((p) => ({ slug: p.slug, name: pickLocal(p.name), count: byPlan.find((b) => b.planId === p.id)?._count._all ?? 0 })),
          free: byPlan.find((b) => plans.find((p) => p.id === b.planId)?.slug === 'free')?._count._all ?? 0,
        },
        credits: { consumed, aiCostUsd: aiCost, marginPct: revenueDzd > 0 ? Math.round(((revenueDzd - costDzd) / revenueDzd) * 100) : null },
        conversations: { perDayAvg: Math.round(ms.reduce((s, m) => s + m.conversations, 0) / n), peak: peak && peak.count > 0 ? peak : null },
        webhooks: { availabilityPct: Math.round(Math.max(0, 100 - (incidentMinutes / periodMin) * 100) * 10) / 10, incidentMinutes, queueDelays: incidents.filter((i) => i.components.some((c) => /queue|file|job/i.test(c))).length },
      },
      series,
      cohort: { created: Number(cohortRow?.created ?? 0), activated: Number(cohortRow?.activated ?? 0) },
      topWorkspaces: top.map((t) => {
        const w = topWs.find((x) => x.id === t.workspaceId);
        const p = w?.subscriptions[0]?.plan;
        return { id: t.workspaceId, name: w?.name ?? '—', planSlug: p?.slug ?? 'free', planName: p ? pickLocal(p.name) : freePlanName(), credits: Number(t.credits) };
      }),
      aiCostByModel: [...aiByModel.values()].sort((a, b) => b.costUsd - a.costUsd),
      trialsExpiring: trials.map((t) => ({ id: t.workspace.id, name: t.workspace.name, trialEndsAt: t.trialEndsAt!.toISOString(), orders: tOrders.find((o) => o.workspaceId === t.workspaceId)?._count._all ?? 0, pagesConnected: tPages.find((o) => o.workspaceId === t.workspaceId)?._count._all ?? 0, conversations: tConvs.find((o) => o.workspaceId === t.workspaceId)?._count._all ?? 0 })),
    };
  }

  /** ADM-01 "Alertes plateforme" (12 §26): computed from the live tables, most severe first. */
  async alerts(now = new Date()): Promise<AdminAlertDto[]> {
    const out: AdminAlertDto[] = [];
    const [routes, igPending, slaItems, slaTickets, dunning] = await Promise.all([
      prisma.aiRoute.findMany({ where: { failoverActive: true }, include: { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } } }),
      prisma.channel.findMany({ where: { status: 'pending_review' }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.moderationItem.count({ where: { status: 'pending', slaDueAt: { lt: now } } }),
      prisma.supportTicket.count({ where: { slaDueAt: { lt: now }, status: 'open' } }),
      prisma.subscription.count({ where: { status: 'dunning', dunningStage: 'd_plus_3' } }),
    ]);
    for (const r of routes) {
      const since = await prisma.aiRun.groupBy({ by: ['status'], where: { modelId: r.primaryModelId, startedAt: { gte: new Date(now.getTime() - DAY) } }, _count: { _all: true } });
      const total = since.reduce((s, x) => s + x._count._all, 0);
      const err = since.find((x) => x.status === 'error')?._count._all ?? 0;
      out.push({ code: 'ai_error_rate', severity: 'critical', params: { provider: r.primaryModel.provider.displayName, rate: total ? Math.round((err / total) * 100) : 0, threshold: r.errorThresholdPct, fallback: r.fallbackModel?.provider.displayName ?? '—', capability: r.capability }, link: '/admin/ai', since: r.failoverSince?.toISOString() ?? null });
    }
    if (igPending.length) out.push({ code: 'ig_review_backlog', severity: 'warning', params: { count: igPending.length, oldestDays: Math.floor((now.getTime() - igPending[0]!.createdAt.getTime()) / DAY) }, link: '/admin/settings#meta', since: igPending[0]!.createdAt.toISOString() });
    const figs = await prisma.$queryRaw<{ n: bigint }[]>`
      WITH p AS (SELECT "workspaceId", max("periodStart") AS ps FROM "CreditLedger" WHERE "bucket" = 'plan' AND "kind" = 'credit' GROUP BY "workspaceId")
      SELECT count(*) AS n FROM (SELECT l."workspaceId", sum(l."credits") FILTER (WHERE l."bucket" = 'plan' AND l."periodStart" = p.ps) + coalesce(sum(l."credits") FILTER (WHERE l."bucket" = 'pack'), 0) AS total
        FROM "CreditLedger" l JOIN p ON p."workspaceId" = l."workspaceId" JOIN "Workspace" w ON w.id = l."workspaceId" WHERE w."deletedAt" IS NULL AND w."status" = 'active' GROUP BY l."workspaceId") t WHERE t.total <= 0`;
    const exhausted = Number(figs[0]?.n ?? 0);
    if (exhausted) out.push({ code: 'credits_exhausted', severity: 'warning', params: { count: exhausted }, link: '/admin/workspaces?credits=exhausted', since: null });
    if (slaItems) out.push({ code: 'moderation_sla', severity: 'critical', params: { count: slaItems }, link: '/admin/moderation?tab=urgent', since: null });
    if (slaTickets) out.push({ code: 'ticket_sla', severity: 'warning', params: { count: slaTickets }, link: '/admin/support?slaBreached=true', since: null });
    const failedCouriers = await prisma.courierAccount.groupBy({ by: ['provider'], where: { isActive: true, lastTestOk: false }, _count: { _all: true } });
    for (const c of failedCouriers) out.push({ code: 'courier_key_expired', severity: 'warning', params: { provider: c.provider, count: c._count._all }, link: '/admin/workspaces', since: null });
    if (dunning) out.push({ code: 'dunning_overdue', severity: 'warning', params: { count: dunning }, link: '/admin/subscriptions?status=dunning', since: null });
    const failedJobs = await prisma.job.count({ where: { status: 'failed', updatedAt: { gte: new Date(now.getTime() - DAY) } } });
    if (failedJobs >= 10) out.push({ code: 'queue_delay', severity: 'warning', params: { count: failedJobs }, link: '/admin/health', since: null });
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  }
}
