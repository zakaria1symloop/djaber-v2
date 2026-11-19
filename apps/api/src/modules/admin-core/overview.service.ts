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
import { routeHealth } from './ai-route-health';
import { CONSUMPTION_ACTIONS } from '../credits/consumption';

export type PlatformMetrics = {
  signups: number;
  workspacesCreated: number;
  activations: number;
  churned: number;
  activeWorkspaces: number;
  suspended: number;
  mrr: number;
  creditsConsumed: number;
  /** AI cost of every run of the day (the « Coût IA par fournisseur / modèle » table) */
  aiCostUsd: number;
  /** journey J13v-2: AI cost of the charged runs only (`creditsCharged > 0`) — the basis of the margin */
  chargedCostUsd: number;
  conversations: number;
  aiReplies: number;
  byModel: { modelId: string; provider: string; model: string; capability: string; costUsd: number; chargedCostUsd: number; runs: number; credits: number }[];
  /** definition version of the stored figures (`METRICS_VERSION`); an older row is recomputed before it is read */
  v?: number;
};
const PERIOD_DAYS: Record<AdminPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };
/** `sched-daily-stats` recomputes yesterday and the 7 days before it (late rows), like the merchant rollup. */
const RECOMPUTE_DAYS = 8;
/**
 * Version of the stored daily figures. 2 (journey J13v-2 / J13r-5 retest): consumption = AI actions only (an admin removal
 * is an adjustment), plus the cost of the charged runs. A stored row of an older version is recomputed (its flow figures;
 * the point-in-time ones — active workspaces, suspended, MRR — are kept) and stored again: idempotent, no data migration.
 */
export const METRICS_VERSION = 2;
/** The longest overview period: stored rows older than this are never read. */
const MAX_PERIOD_DAYS = 90;

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
        await this.store(day, m);
        n++;
      }
      // older rows still holding a previous definition (J13v-2): recomputed once, then left alone
      const stale = await this.staleDays(algiersDay(new Date(algiersDayStart(today).getTime() - MAX_PERIOD_DAYS * DAY + 3600_000)), today);
      for (const r of stale) {
        await this.store(r.day, await this.metricsOf(r.day, r.metrics));
        n++;
      }
      return n;
    });
  }

  private store(day: string, m: PlatformMetrics) {
    const at = new Date(`${day}T00:00:00Z`);
    return prisma.platformDailyStat.upsert({ where: { day: at }, create: { day: at, metrics: m as unknown as Prisma.InputJsonValue }, update: { metrics: m as unknown as Prisma.InputJsonValue, computedAt: new Date() } });
  }

  /** Stored days in [from, to) whose figures were computed with an older definition (`v` < METRICS_VERSION). */
  private async staleDays(from: string, to: string): Promise<{ day: string; metrics: PlatformMetrics }[]> {
    const rows = await prisma.platformDailyStat.findMany({ where: { day: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) } } });
    return rows
      .map((r) => ({ day: r.day.toISOString().slice(0, 10), metrics: r.metrics as unknown as PlatformMetrics }))
      .filter((r) => (r.metrics?.v ?? 1) < METRICS_VERSION);
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
      // journey J13r-5: AI consumption only — an admin removal is an adjustment, not « consommé »
      prisma.creditLedger.aggregate({ where: { kind: 'debit', action: { in: CONSUMPTION_ACTIONS }, createdAt: { gte, lt } }, _sum: { credits: true } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "conversationId") AS n FROM "Message" WHERE "direction" = 'in' AND "sentAt" >= ${gte} AND "sentAt" < ${lt}`,
      prisma.aiRun.count({ where: { kind: 'reply', status: { not: 'error' }, startedAt: { gte, lt } } }),
      // journey J13v-2: the tokens of the charged runs apart — the margin compares their cost with the credits they charged
      prisma.$queryRaw<{ modelId: string; runs: bigint; input: bigint | null; output: bigint | null; cinput: bigint | null; coutput: bigint | null; credits: bigint | null }[]>`
        SELECT "modelId", count(*) AS runs, sum("inputTokens") AS input, sum("outputTokens") AS output,
          sum("inputTokens") FILTER (WHERE "creditsCharged" > 0) AS cinput, sum("outputTokens") FILTER (WHERE "creditsCharged" > 0) AS coutput,
          sum("creditsCharged") AS credits FROM "AiRun" WHERE "startedAt" >= ${gte} AND "startedAt" < ${lt} GROUP BY "modelId"`,
    ]);
    const models = runs.length ? await prisma.aiModel.findMany({ where: { id: { in: runs.map((r) => r.modelId) } }, include: { provider: true } }) : [];
    const usd = (m: (typeof models)[number] | undefined, input: bigint | null, output: bigint | null) =>
      m ? Math.round(((Number(input ?? 0) * Number(m.inputPricePerM) + Number(output ?? 0) * Number(m.outputPricePerM)) / 1_000_000) * 100) / 100 : 0;
    const byModel = runs.map((r) => {
      const m = models.find((x) => x.id === r.modelId);
      return { modelId: r.modelId, provider: m?.provider.displayName ?? '—', model: m?.modelId ?? '—', capability: m?.capabilities[0] ?? 'text', costUsd: usd(m, r.input, r.output), chargedCostUsd: usd(m, r.cinput, r.coutput), runs: Number(r.runs), credits: Number(r.credits ?? 0) };
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
      chargedCostUsd: Math.round(byModel.reduce((n, m) => n + m.chargedCostUsd, 0) * 100) / 100,
      conversations: Number(convs[0]?.n ?? 0),
      aiReplies: replies,
      byModel,
      v: METRICS_VERSION,
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
    // journey J13v-2 (J13r-5 retest): a stored day of an older definition (admin removals counted as consumption, no
    // charged-run cost) is recomputed and stored again before it is read — the worker does the same for the last 90 days
    for (const d of days) {
      const m = byDay.get(d)!;
      if (d === today || (m.v ?? 1) >= METRICS_VERSION) continue;
      const fresh = await this.metricsOf(d, m);
      await this.store(d, fresh);
      byDay.set(d, fresh);
    }
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
      prisma.$queryRaw<{ workspaceId: string; credits: bigint }[]>`SELECT "workspaceId", -sum("credits") AS credits FROM "CreditLedger" WHERE "kind" = 'debit' AND "action" IN ('text_reply', 'image_recognition', 'voice_transcription') AND "createdAt" >= ${gte} GROUP BY "workspaceId" ORDER BY credits DESC LIMIT 5`,
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
    const allCost = Math.round(ms.reduce((s, m) => s + m.aiCostUsd, 0) * 100) / 100;
    // journey J13v-2: the margin compares what the charged credits bring in with what the charged runs cost — the
    // uncharged runs (playground tests, analyses, generation) are shown apart, never in the margin
    const aiCost = Math.round(ms.reduce((s, m) => s + (m.chargedCostUsd ?? m.aiCostUsd), 0) * 100) / 100;
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
        credits: { consumed, aiCostUsd: aiCost, unchargedCostUsd: Math.max(0, Math.round((allCost - aiCost) * 100) / 100), marginPct: revenueDzd > 0 ? Math.round(((revenueDzd - costDzd) / revenueDzd) * 100) : null },
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
      prisma.aiRoute.findMany({ include: { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } } }),
      prisma.channel.findMany({ where: { status: 'pending_review' }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.moderationItem.count({ where: { status: 'pending', slaDueAt: { lt: now } } }),
      prisma.supportTicket.count({ where: { slaDueAt: { lt: now }, status: 'open' } }),
      prisma.subscription.count({ where: { status: 'dunning', dunningStage: 'd_plus_3' } }),
    ]);
    for (const r of routes.filter((x) => x.failoverActive)) {
      const since = await prisma.aiRun.groupBy({ by: ['status'], where: { modelId: r.primaryModelId, startedAt: { gte: new Date(now.getTime() - DAY) } }, _count: { _all: true } });
      const total = since.reduce((s, x) => s + x._count._all, 0);
      const err = since.find((x) => x.status === 'error')?._count._all ?? 0;
      out.push({ code: 'ai_error_rate', severity: 'critical', params: { provider: r.primaryModel.provider.displayName, rate: total ? Math.round((err / total) * 100) : 0, threshold: r.errorThresholdPct, fallback: r.fallbackModel?.provider.displayName ?? '—', capability: r.capability }, link: '/admin/ai', since: r.failoverSince?.toISOString() ?? null });
    }
    // ADMIN-01 retest (journeys 16/11 J13): a route left without a usable model, or whose primary / fallback is switched off,
    // is an alert too (the overview showed none while voice notes had no active provider)
    for (const r of routes) {
      if (r.failoverActive) continue;
      const h = routeHealth(r);
      if (!h.issue) continue;
      out.push({ code: 'ai_route_degraded', severity: h.issue === 'no_model' ? 'critical' : 'warning', params: { capability: r.capability, issue: h.issue, provider: r.primaryModel.provider.displayName, fallback: r.fallbackModel?.provider.displayName ?? '—' }, link: '/admin/ai', since: null });
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
