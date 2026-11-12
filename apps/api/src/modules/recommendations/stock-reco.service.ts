// GDS-10 — stock recommendations: generation job (`Job kind=recommendations`, rate limit 1 / 10 min, nightly 03:00),
// reconciliation (a card that no longer fires expires — D18), cards list / stats / history, apply / dismiss / snooze,
// per-product mute, and the INV-02 inventory-variance alert. Texts are stored in fr / ar / en and served localized.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RECO_REGENERATE_COOLDOWN_S, RECO_SNOOZE_DAYS, STOCK_RECO_SIMPLE_TYPES, StockRecoTypeValues, type ApplyStockRecoInput, type MuteStockRecoInput, type RecommendationsJobResult, type StockRecoHistoryQuery, type StockRecommendationView, type StockRecosQuery, type StockRecoStatsView, type StockRecoTypeName } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Job, type StockRecommendation, type Tx } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page } from '../../core/http/pagination';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { RedisService } from '../../core/redis/redis.provider';
import { viewerLocale } from '../../core/i18n/viewer-locale';
import { algiersDayStart, algiersDay } from '../../core/time/algiers';
import { action } from '../catalog/catalog.util';
import { thumbUrlOf } from '../catalog/product-image.util';
import { JobService } from '../jobs/job.service';
import { actionLabel, inventoryVarianceCandidate, recoKey, RULE_LABELS, runStockRules, type AgentTopicFacts, type EngineInput, type ProductFacts, type RecoCandidate, type StockLineFacts, type SupplierFacts } from './stock-reco.engine';

export const STOCK_RECO_JOB = 'stock-recommendations-generate';
const DAY_MS = 86_400_000;
type Lang = 'fr' | 'ar' | 'en';
type Localized = { fr?: string; ar?: string; en?: string };
const pick = (v: Prisma.JsonValue, lang: Lang) => {
  const o = (v ?? {}) as Localized;
  return o[lang] ?? o.fr ?? '';
};
const RECO_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, price: true, hasVariants: true, trackStock: true, images: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
  variant: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  agent: { select: { id: true, name: true, status: true } },
} satisfies Prisma.StockRecommendationInclude;
type RecoRow = Prisma.StockRecommendationGetPayload<{ include: typeof RECO_INCLUDE }>;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

@Injectable()
export class StockRecoService implements OnModuleInit {
  constructor(
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', STOCK_RECO_JOB, (data: { jobId: string }) => this.process(data.jobId));
  }

  /** the cards are read in the viewer's language (an Arabic page of an English shop shows the Arabic sentences) */
  private lang(): Lang {
    const l = viewerLocale();
    return l === 'ar' || l === 'en' ? l : 'fr';
  }

  // --- presenting ---------------------------------------------------------------------------------------------------------
  private view(r: RecoRow, lang: Lang): StockRecommendationView {
    const action_ = (r.suggestedAction ?? {}) as { kind?: string; params?: Record<string, unknown> };
    const suggested = { kind: (action_.kind ?? 'open_product') as StockRecommendationView['suggestedAction']['kind'], params: action_.params ?? {} };
    const active = r.status === 'active' || r.status === 'snoozed';
    const rule = r.ruleKey as keyof typeof RULE_LABELS;
    return {
      id: r.id,
      type: r.type,
      priority: r.priority,
      status: r.status,
      title: pick(r.title, lang),
      body: pick(r.body, lang),
      rule: r.ruleKey,
      ruleLabel: RULE_LABELS[rule]?.[lang] ?? r.ruleKey,
      suggestedAction: { ...suggested, label: actionLabel({ suggestedAction: suggested }, lang) },
      product: r.product
        ? { id: r.product.id, name: r.product.name, sku: r.product.sku, price: r.product.price, primaryImageUrl: r.product.images[0] ? thumbUrlOf(r.product.images[0].url) : null, hasVariants: r.product.hasVariants, trackStock: r.product.trackStock, variant: r.variant }
        : null,
      supplier: r.supplier,
      agent: r.agent,
      estimatedValue: r.estimatedValue,
      generatedAt: r.generatedAt.toISOString(),
      snoozedUntil: r.snoozedUntil ? r.snoozedUntil.toISOString() : null,
      appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
      applied: r.appliedAt ? { refType: r.appliedRefType ?? 'manual', refId: r.appliedRefId } : null,
      dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
      actions: active
        ? [
            action('apply', 'catalog.write', { primary: true }),
            action('dismiss', 'catalog.write'),
            action('snooze', 'catalog.write'),
            ...(r.productId ? [action('open_product', 'catalog.read'), action('open_sales', 'catalog.read'), action('set_threshold', 'catalog.write'), action('mute', 'catalog.write')] : []),
          ]
        : [...(r.productId ? [action('open_product', 'catalog.read')] : [])],
    };
  }

  /** Snoozed cards whose date passed come back as active (on read). */
  private async wake() {
    await prisma.stockRecommendation.updateMany({ where: { status: 'snoozed', snoozedUntil: { lte: new Date() } }, data: { status: 'active', snoozedUntil: null } });
  }

  private async simpleMode() {
    return TenantContext.get().stockMode !== 'advanced';
  }

  async list(q: StockRecosQuery): Promise<StockRecommendationView[]> {
    await this.wake();
    const and: Prisma.StockRecommendationWhereInput[] = [{ status: q.status ?? 'active' }];
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (await this.simpleMode()) and.push({ type: { in: [...STOCK_RECO_SIMPLE_TYPES] } });
    if (q.priority?.length) and.push({ priority: { in: q.priority } });
    if (q.productId) and.push({ productId: q.productId });
    if (q.categoryId) and.push({ product: { OR: [{ categoryId: q.categoryId }, { category: { parentId: q.categoryId } }] } });
    const rows = await prisma.stockRecommendation.findMany({ where: { AND: and }, include: RECO_INCLUDE, orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }], take: 500 });
    rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0));
    const lang = this.lang();
    return rows.map((r) => this.view(r, lang));
  }

  async history(q: StockRecoHistoryQuery) {
    const where: Prisma.StockRecommendationWhereInput = { status: { in: q.status?.length ? q.status : ['applied', 'dismissed', 'expired'] }, ...(q.type?.length ? { type: { in: q.type } } : {}) };
    const [rows, total] = await Promise.all([
      prisma.stockRecommendation.findMany({ where, include: RECO_INCLUDE, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.stockRecommendation.count({ where }),
    ]);
    const lang = this.lang();
    return page(rows.map((r) => this.view(r, lang)), total, q);
  }

  private cooldownKey() {
    return `reco:stock:${TenantContext.workspaceId()}`;
  }

  async stats(): Promise<StockRecoStatsView> {
    await this.wake();
    const simple = await this.simpleMode();
    const types = simple ? [...STOCK_RECO_SIMPLE_TYPES] : [...StockRecoTypeValues];
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [active, closed, job, ttl] = await Promise.all([
      prisma.stockRecommendation.findMany({ where: { status: 'active', type: { in: types } }, select: { type: true, priority: true, estimatedValue: true } }),
      prisma.stockRecommendation.groupBy({ by: ['status'], where: { status: { in: ['applied', 'dismissed', 'expired'] }, generatedAt: { gte: since } }, _count: { _all: true } }),
      prisma.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'recommendations', payload: { path: ['name'], equals: STOCK_RECO_JOB } }, orderBy: { createdAt: 'desc' } }),
      this.redis.client.ttl(this.cooldownKey()),
    ]);
    const byType = Object.fromEntries(StockRecoTypeValues.map((t) => [t, active.filter((a) => a.type === t).length])) as Record<StockRecoTypeName, number>;
    const count = (s: string) => closed.find((c) => c.status === s)?._count._all ?? 0;
    const applied = count('applied');
    const dismissed = count('dismissed');
    const expired = count('expired');
    const decided = applied + dismissed + expired;
    const restock = active.filter((a) => a.type === 'restock' || a.type === 'stockout_imminent');
    const result = job?.result as RecommendationsJobResult | null | undefined;
    return {
      active: active.length,
      highPriority: active.filter((a) => a.priority === 'high').length,
      byType,
      restock: { count: restock.length, estimatedValue: restock.reduce((s, a) => s + (a.estimatedValue ?? 0), 0) },
      promote: { count: byType.promote },
      last30d: { applied, dismissed, expired, applicationRatePct: decided ? Math.round((applied * 1000) / decided) / 10 : null },
      lastRun: { jobId: job?.id ?? null, at: job ? job.updatedAt.toISOString() : null, status: job?.status ?? null, productsAnalyzed: result?.productsAnalyzed ?? null },
      regenerateAvailableIn: ttl > 0 ? ttl : 0,
    };
  }

  // --- generation ---------------------------------------------------------------------------------------------------------
  /** `POST /stock-recommendations/generate` → 202 { jobId }; 429 RECO_RATE_LIMITED {retryAfter} within 10 min. */
  async requestGenerate() {
    const ok = await this.redis.client.set(this.cooldownKey(), '1', 'EX', RECO_REGENERATE_COOLDOWN_S, 'NX');
    if (!ok) {
      const ttl = await this.redis.client.ttl(this.cooldownKey());
      throw new AppException('RECO_RATE_LIMITED', { retryAfter: ttl > 0 ? ttl : RECO_REGENERATE_COOLDOWN_S });
    }
    const job = await this.jobs.create({ kind: 'recommendations', name: STOCK_RECO_JOB, payload: {} });
    return { jobId: job.id };
  }

  /** Nightly: one job per workspace and night (a second run the same night finds the first job and does nothing). */
  async scheduleNightly(tx: Tx) {
    const today = algiersDayStart(algiersDay());
    const existing = await tx.job.findFirst({ where: { workspaceId: TenantContext.workspaceId(), kind: 'recommendations', createdAt: { gte: today }, payload: { path: ['name'], equals: STOCK_RECO_JOB } } });
    if (existing) return existing.id;
    return (await this.jobs.create({ kind: 'recommendations', name: STOCK_RECO_JOB, payload: { nightly: true } }, tx)).id;
  }

  async process(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const input = await this.facts();
      const candidates = runStockRules(input);
      const counts = await prisma.$transaction((db) => this.reconcile(db as Tx, candidates, job.id), { timeout: 60_000 });
      const result: RecommendationsJobResult = { kind: 'stock', productsAnalyzed: input.products.length, ...counts };
      return { result, notify: !(job.payload as { nightly?: boolean } | null)?.nightly };
    });
  }

  /** Every figure the rules read, for the current workspace. */
  async facts(now = new Date()): Promise<EngineInput> {
    const ws = TenantContext.workspaceId();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since90 = new Date(now.getTime() - 90 * DAY_MS);
    const [workspace, products, sold, lastSold, lastPurchase, suppliers, topics] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: ws }, select: { targetMarginPct: true } }),
      prisma.product.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, name: true, price: true, costPrice: true, hasVariants: true, trackStock: true, stock: true, minStock: true, createdAt: true, variants: { where: { deletedAt: null, isActive: true }, select: { id: true, name: true, stock: true, minStock: true, costPrice: true } } },
      }),
      prisma.$queryRaw<{ productId: string; variantId: string | null; u30: number; u7: number }[]>`
        SELECT "productId", "variantId", sum(q)::int AS u30, sum(CASE WHEN at >= ${since7} THEN q ELSE 0 END)::int AS u7 FROM (
          SELECT i."productId", i."variantId", i."quantity" AS q, o."orderedAt" AS at FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
          WHERE o."workspaceId" = ${ws}::uuid AND o."status" NOT IN ('cancelled', 'returned') AND o."orderedAt" >= ${since30}
          UNION ALL
          SELECT i."productId", i."variantId", i."quantity", s."soldAt" FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
          WHERE s."workspaceId" = ${ws}::uuid AND s."status" = 'completed' AND s."soldAt" >= ${since30}
        ) x GROUP BY "productId", "variantId"`,
      prisma.$queryRaw<{ productId: string; at: Date }[]>`
        SELECT "productId", max(at) AS at FROM (
          SELECT i."productId", o."orderedAt" AS at FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" WHERE o."workspaceId" = ${ws}::uuid AND o."status" NOT IN ('cancelled', 'returned')
          UNION ALL
          SELECT i."productId", s."soldAt" FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId" WHERE s."workspaceId" = ${ws}::uuid AND s."status" = 'completed'
        ) x GROUP BY "productId"`,
      prisma.$queryRaw<{ productId: string; supplierId: string | null; number: string }[]>`
        SELECT DISTINCT ON (i."productId") i."productId", p."supplierId", p."number" FROM "PurchaseItem" i JOIN "Purchase" p ON p."id" = i."purchaseId"
        WHERE p."workspaceId" = ${ws}::uuid AND p."status" NOT IN ('cancelled', 'draft') ORDER BY i."productId", p."purchasedAt" DESC`,
      prisma.supplier.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, avgLeadDays: true, purchases: { where: { status: { notIn: ['cancelled', 'draft'] }, purchasedAt: { gte: since90 } }, select: { status: true, purchasedAt: true, expectedAt: true, receivedAt: true } } },
      }),
      prisma.agentInsight.groupBy({ by: ['agentId', 'topicKey'], where: { type: 'unknown_topic', createdAt: { gte: since7 }, topicKey: { not: null } }, _count: { _all: true } }),
    ]);
    const soldBy = new Map(sold.map((s) => [`${s.productId}|${s.variantId ?? ''}`, s]));
    const lastSoldBy = new Map(lastSold.map((r) => [r.productId, r.at]));
    const lastPurchaseBy = new Map(lastPurchase.map((r) => [r.productId, r]));
    const supplierFacts = new Map(
      suppliers.map((s) => {
        const received = s.purchases.filter((p) => p.receivedAt);
        const measured = received.length ? Math.round(received.reduce((n, p) => n + (p.receivedAt!.getTime() - p.purchasedAt.getTime()) / DAY_MS, 0) / received.length) : null;
        return [s.id, { id: s.id, name: s.name, leadDays: s.avgLeadDays ?? measured }];
      }),
    );

    const lines: StockLineFacts[] = [];
    for (const p of products.filter((x) => x.trackStock)) {
      const lp = lastPurchaseBy.get(p.id);
      const supplier = lp?.supplierId ? (supplierFacts.get(lp.supplierId) ?? null) : null;
      const holders = p.hasVariants ? p.variants.map((v) => ({ variantId: v.id, variantName: v.name, stock: v.stock, minStock: v.minStock, costPrice: v.costPrice ?? p.costPrice })) : [{ variantId: null, variantName: null, stock: p.stock ?? 0, minStock: p.minStock, costPrice: p.costPrice }];
      for (const h of holders) {
        const s = soldBy.get(`${p.id}|${h.variantId ?? ''}`);
        lines.push({ productId: p.id, name: p.name, ...h, units30d: s?.u30 ?? 0, units7d: s?.u7 ?? 0, supplier });
      }
    }
    const productFacts: ProductFacts[] = products.map((p) => ({
      productId: p.id,
      name: p.name,
      price: p.price,
      costPrice: p.costPrice,
      hasVariants: p.hasVariants,
      trackStock: p.trackStock,
      stock: p.hasVariants ? p.variants.reduce((n, v) => n + v.stock, 0) : (p.stock ?? 0),
      lastSoldAt: lastSoldBy.get(p.id) ?? null,
      createdAt: p.createdAt,
      lastPurchaseNumber: lastPurchaseBy.get(p.id)?.number ?? null,
    }));
    const supplierLate: SupplierFacts[] = suppliers.map((s) => {
      const withDate = s.purchases.filter((p) => p.expectedAt);
      const delays = withDate.map((p) => ((p.receivedAt ?? (p.status === 'received' ? p.expectedAt! : now)).getTime() - p.expectedAt!.getTime()) / DAY_MS);
      const due = withDate.filter((p) => p.receivedAt || p.expectedAt!.getTime() < now.getTime());
      const lateDelays = delays.filter((d) => d > 0.5);
      return { supplierId: s.id, name: s.name, deliveries: due.length, late: lateDelays.length, avgDelayDays: lateDelays.length ? Math.round(lateDelays.reduce((a, b) => a + b, 0) / lateDelays.length) : 0 };
    });
    const agentIds = [...new Set(topics.map((t) => t.agentId))];
    const agents = agentIds.length ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [];
    const agentName = new Map(agents.map((a) => [a.id, a.name]));
    const topicFacts: AgentTopicFacts[] = topics
      .filter((t) => agentName.has(t.agentId))
      .map((t) => ({ agentId: t.agentId, agentName: agentName.get(t.agentId)!, topic: (t.topicKey ?? '').replace(/^[a-z_]+:/, ''), count: t._count._all }));
    return { lines, products: productFacts, suppliers: supplierLate, topics: topicFacts, targetMarginPct: workspace.targetMarginPct, now };
  }

  /**
   * D18: cards still firing are refreshed (a snoozed card stays snoozed), cards that no longer fire expire, new ones are
   * created unless muted for that product + type, or applied / dismissed in the last 7 days.
   */
  async reconcile(tx: Tx, candidates: RecoCandidate[], jobId: string | null) {
    const ws = TenantContext.workspaceId();
    const open = await tx.stockRecommendation.findMany({ where: { status: { in: ['active', 'snoozed'] }, ruleKey: { not: 'inventory_variance' } } });
    const recent = await tx.stockRecommendation.findMany({ where: { status: { in: ['applied', 'dismissed'] }, OR: [{ appliedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }, { dismissedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }] }, select: { ruleKey: true, productId: true, variantId: true, supplierId: true, agentId: true } });
    const mutes = await tx.stockRecommendationMute.findMany({ select: { productId: true, type: true } });
    const muted = new Set(mutes.map((m) => `${m.productId}|${m.type}`));
    const openBy = new Map(open.map((r) => [recoKey(r as never), r]));
    const recentKeys = new Set(recent.map((r) => recoKey(r as never)));
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const c of candidates) {
      const key = recoKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      if (c.productId && muted.has(`${c.productId}|${c.type}`)) continue;
      const data = { type: c.type, priority: c.priority, title: c.title, body: c.body, suggestedAction: c.suggestedAction as Prisma.InputJsonValue, estimatedValue: c.estimatedValue, generatedAt: new Date(), jobId };
      const existing = openBy.get(key);
      if (existing) {
        await tx.stockRecommendation.update({ where: { id: existing.id }, data });
        updated++;
      } else if (!recentKeys.has(key)) {
        await tx.stockRecommendation.create({ data: { workspaceId: ws, ruleKey: c.ruleKey, productId: c.productId, variantId: c.variantId, supplierId: c.supplierId, agentId: c.agentId, ...data } as Prisma.StockRecommendationUncheckedCreateInput });
        created++;
      }
    }
    const stale = open.filter((r) => !seen.has(recoKey(r as never))).map((r) => r.id);
    if (stale.length) await tx.stockRecommendation.updateMany({ where: { id: { in: stale } }, data: { status: 'expired', snoozedUntil: null } });
    return { created, updated, removed: 0, expired: stale.length };
  }

  /** INV-02: a validated count raises one card per line whose variance exceeds 10 % (inside the validation transaction). */
  async raiseInventoryVariance(tx: Tx, lines: Parameters<typeof inventoryVarianceCandidate>[0][]) {
    for (const l of lines) {
      const c = inventoryVarianceCandidate(l);
      const muted = await tx.stockRecommendationMute.findFirst({ where: { productId: l.productId, type: c.type } });
      if (muted) continue;
      await tx.stockRecommendation.updateMany({ where: { ruleKey: c.ruleKey, productId: c.productId, variantId: c.variantId, status: { in: ['active', 'snoozed'] } }, data: { status: 'expired' } });
      await tx.stockRecommendation.create({
        data: { workspaceId: TenantContext.workspaceId(), ruleKey: c.ruleKey, type: c.type, priority: c.priority, productId: c.productId, variantId: c.variantId, title: c.title, body: c.body, suggestedAction: c.suggestedAction as Prisma.InputJsonValue, estimatedValue: null } as Prisma.StockRecommendationUncheckedCreateInput,
      });
    }
  }

  // --- decisions ----------------------------------------------------------------------------------------------------------
  private async open(id: string): Promise<StockRecommendation> {
    const r = await prisma.stockRecommendation.findFirst({ where: { id } });
    if (!r) throw notFound();
    return r;
  }

  private async one(id: string) {
    const r = await prisma.stockRecommendation.findFirstOrThrow({ where: { id }, include: RECO_INCLUDE });
    return this.view(r, this.lang());
  }

  async apply(id: string, input: ApplyStockRecoInput) {
    const r = await this.open(id);
    if (r.status !== 'active' && r.status !== 'snoozed') throw new AppException('CONFLICT', {}, {}, { reason: 'RECO_CLOSED', status: r.status });
    await prisma.stockRecommendation.update({ where: { id }, data: { status: 'applied', appliedAt: new Date(), appliedRefType: input.refType ?? null, appliedRefId: input.refId ?? null, snoozedUntil: null } });
    return this.one(id);
  }

  async dismiss(id: string) {
    const r = await this.open(id);
    if (r.status !== 'active' && r.status !== 'snoozed') throw new AppException('CONFLICT', {}, {}, { reason: 'RECO_CLOSED', status: r.status });
    await prisma.stockRecommendation.update({ where: { id }, data: { status: 'dismissed', dismissedAt: new Date(), dismissedById: TenantContext.get().userId ?? null, snoozedUntil: null } });
    return this.one(id);
  }

  async snooze(id: string, days = RECO_SNOOZE_DAYS) {
    const r = await this.open(id);
    if (r.status !== 'active' && r.status !== 'snoozed') throw new AppException('CONFLICT', {}, {}, { reason: 'RECO_CLOSED', status: r.status });
    await prisma.stockRecommendation.update({ where: { id }, data: { status: 'snoozed', snoozedUntil: new Date(Date.now() + days * DAY_MS) } });
    return this.one(id);
  }

  /** "Désactiver cette règle pour ce produit": open cards of that product + type are dismissed. */
  async mute(input: MuteStockRecoInput) {
    const p = await prisma.product.findFirst({ where: { id: input.productId }, select: { id: true } });
    if (!p) throw notFound();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.stockRecommendationMute.upsert({ where: { workspaceId_productId_type: { workspaceId: TenantContext.workspaceId(), productId: input.productId, type: input.type } }, create: { workspaceId: TenantContext.workspaceId(), productId: input.productId, type: input.type }, update: {} });
      await tx.stockRecommendation.updateMany({ where: { productId: input.productId, type: input.type, status: { in: ['active', 'snoozed'] } }, data: { status: 'dismissed', dismissedAt: new Date(), dismissedById: TenantContext.get().userId ?? null } });
    });
  }

  async unmute(input: MuteStockRecoInput) {
    await prisma.stockRecommendationMute.deleteMany({ where: { productId: input.productId, type: input.type } });
  }

  /** "Réapprovisionner" counter of the stock dashboard. */
  restockSuggestions() {
    return prisma.stockRecommendation.count({ where: { status: 'active', type: { in: ['restock', 'stockout_imminent'] } } });
  }
}
