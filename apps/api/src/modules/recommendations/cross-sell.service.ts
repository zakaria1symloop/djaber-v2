// REC-01…03 — cross-sell rules (`Recommendation`): manual rules (DLG GDS II "Règle de recommandation"), the "Analyse"
// job (V1 rule engine, free; stale rule-generated pairs removed — D18; manual rules always kept), stats, and the events:
// impressions when the AI shows a suggestion, conversions when the suggested product is ordered in the same conversation
// within 7 days, reversed when that order is cancelled or deleted. Counters are recomputed from the events, never incremented.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RECO_ATTRIBUTION_DAYS, RECO_MAX_PER_TURN, RECO_REGENERATE_COOLDOWN_S, RECOMMENDATION_SORTS, type CreateRecommendationInput, type RecommendationsJobResult, type RecommendationsQuery, type RecommendationStatsView, type RecommendationView, type UpdateRecommendationInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Job, type Tx } from '@djaber/db';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { RedisService } from '../../core/redis/redis.provider';
import { viewerLocale } from '../../core/i18n/viewer-locale';
import { algiersDay, algiersDayStart } from '../../core/time/algiers';
import { action, isUnique } from '../catalog/catalog.util';
import { thumbUrlOf } from '../catalog/product-image.util';
import { JobService } from '../jobs/job.service';
import { runCrossSellRules } from './cross-sell.engine';

export const CROSS_SELL_JOB = 'recommendations-generate';
const DAY_MS = 86_400_000;
const PRODUCT = { select: { id: true, name: true, sku: true, price: true, isActive: true, deletedAt: true, images: { where: { isPrimary: true }, take: 1, select: { url: true } } } } as const;
const INCLUDE = { product: PRODUCT, recommended: PRODUCT } satisfies Prisma.RecommendationInclude;
type Row = Prisma.RecommendationGetPayload<{ include: typeof INCLUDE }>;
const REASONS: Record<string, { fr: string; ar: string; en: string }> = {
  co_purchase: { fr: 'Achetés ensemble {n} fois', ar: 'اشتُريا معًا {n} مرات', en: 'Bought together {n} times' },
  same_category: { fr: 'Même catégorie, gamme supérieure', ar: 'نفس الفئة، فئة أعلى', en: 'Same category, higher range' },
  keywords: { fr: '{n} mots-clés en commun', ar: '{n} كلمات مفتاحية مشتركة', en: '{n} keywords in common' },
};

@Injectable()
export class CrossSellService implements OnModuleInit {
  constructor(
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', CROSS_SELL_JOB, (data: { jobId: string }) => this.process(data.jobId));
  }

  private reasonText(r: string | null) {
    if (!r) return null;
    const m = /^(co_purchase|same_category|keywords)(?::(\d+))?$/.exec(r);
    if (!m) return r;
    const l = viewerLocale();
    const lang = l === 'ar' || l === 'en' ? l : 'fr';
    return REASONS[m[1]!]![lang].replace('{n}', m[2] ?? '');
  }

  private ref(p: Row['product']) {
    return { id: p.id, name: p.name, sku: p.sku, price: p.price, primaryImageUrl: p.images[0] ? thumbUrlOf(p.images[0].url) : null, isActive: p.isActive, archived: !!p.deletedAt };
  }

  private view(r: Row): RecommendationView {
    return {
      id: r.id,
      product: this.ref(r.product),
      recommended: this.ref(r.recommended),
      type: r.type,
      score: r.score,
      reason: this.reasonText(r.reason),
      source: r.source,
      isActive: r.isActive,
      impressions: r.impressions,
      conversions: r.conversions,
      conversionRatePct: r.impressions ? Math.round((r.conversions * 1000) / r.impressions) / 10 : null,
      revenue: r.revenue,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      actions: [action('edit', 'catalog.write', { primary: true }), r.isActive ? action('deactivate', 'catalog.write') : action('activate', 'catalog.write'), action('delete', 'catalog.write')],
    };
  }

  // --- rules (REC-01) -----------------------------------------------------------------------------------------------------
  async list(q: RecommendationsQuery): Promise<Page<RecommendationView>> {
    const s = q.sort ?? '-score';
    const field = s.replace(/^-/, '');
    if (!(RECOMMENDATION_SORTS as readonly string[]).includes(field)) throw new AppException('BAD_REQUEST');
    const dir = s.startsWith('-') ? 'desc' : 'asc';
    const and: Prisma.RecommendationWhereInput[] = [];
    if (q.productId) and.push({ OR: [{ productId: q.productId }, { recommendedId: q.productId }] });
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.source?.length) and.push({ source: { in: q.source } });
    if (q.isActive !== undefined) and.push({ isActive: q.isActive });
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ product: { name: contains } }, { recommended: { name: contains } }] });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      prisma.recommendation.findMany({ where, include: INCLUDE, orderBy: [{ [field]: dir }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.recommendation.count({ where }),
    ]);
    return page(rows.map((r) => this.view(r)), total, q);
  }

  private async get(id: string) {
    const r = await prisma.recommendation.findFirst({ where: { id }, include: INCLUDE });
    if (!r) throw notFound();
    return this.view(r);
  }

  async create(input: CreateRecommendationInput): Promise<RecommendationView> {
    const products = await prisma.product.findMany({ where: { id: { in: [input.productId, input.recommendedId] }, deletedAt: null }, select: { id: true } });
    if (!products.some((p) => p.id === input.productId)) throw validationError({ productId: 'validation.invalid' });
    if (!products.some((p) => p.id === input.recommendedId)) throw validationError({ recommendedId: 'validation.invalid' });
    try {
      const r = await prisma.recommendation.create({ data: { workspaceId: TenantContext.workspaceId(), productId: input.productId, recommendedId: input.recommendedId, type: input.type, score: input.score, reason: input.reason ?? null, isActive: input.isActive, source: 'manual' } as Prisma.RecommendationUncheckedCreateInput });
      return this.get(r.id);
    } catch (e) {
      if (isUnique(e)) throw conflict({ reason: 'RECOMMENDATION_EXISTS' });
      throw e;
    }
  }

  /** A rule-generated pair edited by a person becomes `manual` (the next run keeps it). */
  async update(id: string, input: UpdateRecommendationInput): Promise<RecommendationView> {
    await this.get(id);
    try {
      await prisma.recommendation.update({ where: { id }, data: { ...input, source: 'manual' } });
    } catch (e) {
      if (isUnique(e)) throw conflict({ reason: 'RECOMMENDATION_EXISTS' });
      throw e;
    }
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    await prisma.recommendation.delete({ where: { id } });
  }

  async stats(): Promise<RecommendationStatsView> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [all, events, job] = await Promise.all([
      prisma.recommendation.findMany({ select: { isActive: true, source: true } }),
      prisma.recommendationEvent.findMany({ where: { at: { gte: since }, recommendation: { workspaceId: TenantContext.workspaceId() } }, select: { kind: true, orderId: true, recommendation: { select: { recommendedId: true } } } }),
      prisma.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'recommendations', payload: { path: ['name'], equals: CROSS_SELL_JOB } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const impressions = events.filter((e) => e.kind === 'impression').length;
    const conv = events.filter((e) => e.kind === 'conversion' && e.orderId);
    const revenue = conv.length ? await this.revenueOf(conv.map((c) => ({ orderId: c.orderId!, productId: c.recommendation.recommendedId }))) : 0;
    const result = job?.result as RecommendationsJobResult | null | undefined;
    return {
      rules: all.length,
      active: all.filter((r) => r.isActive).length,
      manual: all.filter((r) => r.source === 'manual').length,
      generated: all.filter((r) => r.source === 'rules').length,
      impressions30d: impressions,
      conversions30d: conv.length,
      conversionRatePct30d: impressions ? Math.round((conv.length * 1000) / impressions) / 10 : null,
      revenue30d: revenue,
      lastRun: { jobId: job?.id ?? null, at: job ? job.updatedAt.toISOString() : null, status: job?.status ?? null, created: result?.created ?? null, removed: result?.removed ?? null },
    };
  }

  // --- generation (REC-02, D18) -------------------------------------------------------------------------------------------
  async requestGenerate() {
    const key = `reco:xsell:${TenantContext.workspaceId()}`;
    const ok = await this.redis.client.set(key, '1', 'EX', RECO_REGENERATE_COOLDOWN_S, 'NX');
    if (!ok) {
      const ttl = await this.redis.client.ttl(key);
      throw new AppException('RECO_RATE_LIMITED', { retryAfter: ttl > 0 ? ttl : RECO_REGENERATE_COOLDOWN_S });
    }
    const job = await this.jobs.create({ kind: 'recommendations', name: CROSS_SELL_JOB, payload: {} });
    return { jobId: job.id };
  }

  async scheduleNightly(tx: Tx) {
    const today = algiersDayStart(algiersDay());
    const existing = await tx.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'recommendations', createdAt: { gte: today }, payload: { path: ['name'], equals: CROSS_SELL_JOB } } });
    if (existing) return existing.id;
    return (await this.jobs.create({ kind: 'recommendations', name: CROSS_SELL_JOB, payload: { nightly: true } }, tx)).id;
  }

  async process(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const ws = TenantContext.workspaceId();
      const since = new Date(Date.now() - 180 * DAY_MS);
      // AI-14 / MOD: only products the AI may show (live, active, not held by moderation)
      const products = await prisma.product.findMany({ where: { deletedAt: null, isActive: true, moderationStatus: { in: ['not_required', 'approved'] } }, select: { id: true, name: true, price: true, categoryId: true, keywords: true } });
      const co = await prisma.$queryRaw<{ a: string; b: string; count: number }[]>`
        SELECT x."productId" AS a, y."productId" AS b, count(DISTINCT x."orderId")::int AS count
        FROM "OrderItem" x JOIN "OrderItem" y ON y."orderId" = x."orderId" AND x."productId" < y."productId"
        JOIN "Order" o ON o."id" = x."orderId"
        WHERE o."workspaceId" = ${ws}::uuid AND o."status" NOT IN ('cancelled') AND o."orderedAt" >= ${since}
        GROUP BY x."productId", y."productId"`;
      const pairs = runCrossSellRules(products, co);
      const result = await prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          const existing = await tx.recommendation.findMany({ select: { id: true, productId: true, recommendedId: true, type: true, source: true } });
          const key = (p: { productId: string; recommendedId: string; type: string }) => `${p.productId}|${p.recommendedId}|${p.type}`;
          const byKey = new Map(existing.map((e) => [key(e), e]));
          const manualPairs = new Set(existing.filter((e) => e.source === 'manual').map((e) => `${e.productId}|${e.recommendedId}`));
          const wanted = new Set<string>();
          let created = 0;
          let updated = 0;
          for (const p of pairs) {
            // a manual rule on the pair wins over the engine (05 §Recommendation)
            if (manualPairs.has(`${p.productId}|${p.recommendedId}`)) continue;
            wanted.add(key(p));
            const e = byKey.get(key(p));
            if (e) {
              if (e.source === 'rules') {
                await tx.recommendation.update({ where: { id: e.id }, data: { score: p.score, reason: p.reason, isActive: true } });
                updated++;
              }
            } else {
              await tx.recommendation.create({ data: { workspaceId: ws, productId: p.productId, recommendedId: p.recommendedId, type: p.type, score: p.score, reason: p.reason, source: 'rules' } as Prisma.RecommendationUncheckedCreateInput });
              created++;
            }
          }
          // D18: rule-generated pairs that no longer fire are removed (with their events); manual rules are never touched
          const stale = existing.filter((e) => e.source === 'rules' && !wanted.has(key(e))).map((e) => e.id);
          if (stale.length) await tx.recommendation.deleteMany({ where: { id: { in: stale } } });
          return { created, updated, removed: stale.length };
        },
        { timeout: 60_000 },
      );
      const out: RecommendationsJobResult = { kind: 'cross_sell', productsAnalyzed: products.length, ...result };
      return { result: out, notify: !(job.payload as { nightly?: boolean } | null)?.nightly };
    });
  }

  // --- events (REC-03) ----------------------------------------------------------------------------------------------------
  /** Σ order line totals of the recommended products of converted orders. */
  private async revenueOf(conv: { orderId: string; productId: string }[], db: Tx | typeof prisma = prisma) {
    if (!conv.length) return 0;
    const items = await db.orderItem.findMany({ where: { orderId: { in: [...new Set(conv.map((c) => c.orderId))] } }, select: { orderId: true, productId: true, total: true } });
    const wanted = new Set(conv.map((c) => `${c.orderId}|${c.productId}`));
    return items.filter((i) => wanted.has(`${i.orderId}|${i.productId}`)).reduce((s, i) => s + i.total, 0);
  }

  /** Recomputes impressions / conversions / revenue of the given rules from their events. */
  async recompute(tx: Tx, ids: string[]) {
    for (const id of [...new Set(ids)]) {
      const r = await tx.recommendation.findUnique({ where: { id }, select: { recommendedId: true } });
      if (!r) continue;
      const [impressions, conversions] = await Promise.all([
        tx.recommendationEvent.count({ where: { recommendationId: id, kind: 'impression' } }),
        tx.recommendationEvent.findMany({ where: { recommendationId: id, kind: 'conversion', orderId: { not: null } }, select: { orderId: true } }),
      ]);
      const revenue = await this.revenueOf(conversions.map((c) => ({ orderId: c.orderId!, productId: r.recommendedId })), tx);
      await tx.recommendation.update({ where: { id }, data: { impressions, conversions: conversions.length, revenue } });
    }
  }

  /** The AI showed `recommendations[]` in a reply (structured output, ≤ 3 per turn). Unknown / inactive pairs are ignored. */
  async impressions(tx: Tx, conversationId: string, shown: { sourceId: string; recommendedId: string }[]) {
    const pairs = shown.slice(0, RECO_MAX_PER_TURN).filter((p) => /^[0-9a-f-]{36}$/i.test(p.sourceId) && /^[0-9a-f-]{36}$/i.test(p.recommendedId));
    if (!pairs.length) return 0;
    const rules = await tx.recommendation.findMany({ where: { isActive: true, OR: pairs.map((p) => ({ productId: p.sourceId, recommendedId: p.recommendedId })) }, select: { id: true } });
    for (const r of rules) await tx.recommendationEvent.create({ data: { recommendationId: r.id, conversationId, kind: 'impression' } });
    await this.recompute(tx, rules.map((r) => r.id));
    return rules.length;
  }

  /** REC-03: an order of the conversation converts the rules whose recommended product it contains, shown ≤ 7 days before. */
  async conversions(tx: Tx, order: { id: string; conversationId: string | null; orderedAt: Date }) {
    if (!order.conversationId) return 0;
    const items = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { productId: true } });
    if (!items.length) return 0;
    const shown = await tx.recommendationEvent.findMany({
      where: { conversationId: order.conversationId, kind: 'impression', at: { gte: new Date(order.orderedAt.getTime() - RECO_ATTRIBUTION_DAYS * DAY_MS), lte: new Date(Math.max(order.orderedAt.getTime(), Date.now())) }, recommendation: { recommendedId: { in: items.map((i) => i.productId) } } },
      select: { recommendationId: true },
    });
    const ids = [...new Set(shown.map((s) => s.recommendationId))];
    for (const id of ids) {
      const already = await tx.recommendationEvent.count({ where: { recommendationId: id, orderId: order.id, kind: 'conversion' } });
      if (!already) await tx.recommendationEvent.create({ data: { recommendationId: id, conversationId: order.conversationId, kind: 'conversion', orderId: order.id } });
    }
    await this.recompute(tx, ids);
    return ids.length;
  }

  /** REC-03 fix: a cancelled (or deleted) order no longer counts as a conversion. */
  async reverseConversions(tx: Tx, orderId: string) {
    const events = await tx.recommendationEvent.findMany({ where: { orderId, kind: 'conversion' }, select: { id: true, recommendationId: true } });
    if (!events.length) return 0;
    await tx.recommendationEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
    await this.recompute(tx, events.map((e) => e.recommendationId));
    return events.length;
  }
}
