// ADM-06 AI providers (sealed keys, never returned), models, routes per capability (primary + fallback, forced failover)
// and the credit pricing calculator + versions (D63). The provider "Tester" button is one tiny generation through the
// AI gateway (fake driver: deterministic outcomes from the key text — see contract-a).
import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCreateAiModelInput,
  AdminCreatePricingVersionInput,
  AdminPatchAiProviderInput,
  AdminPutAiRouteInput,
  AdminUpdateAiModelInput,
  AiModelAdminDto,
  AiModelDeleteDto,
  AiPricingDto,
  AiPricingSimulateInput,
  AiPricingSimulationDto,
  AiProviderAdminDto,
  AiProviderTestDto,
  AiProviderTestReason,
  AiRouteDto,
  CreditPricingDto,
} from '@djaber/shared';
import { Prisma, prisma, type AiCapability, type AiModel, type AiProvider, type AiProviderKey } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { AI_GATEWAY, AiProviderError, type AiGateway } from '../ai/provider/ai.gateway';
import { RoutingService } from '../ai/routing.service';
import { AdminBillingCatalogService } from './billing-admin.service';
import { DAY, assertUuid, iso, userSelect, type AdminActor } from './admin.util';

const ENV_KEYS: Record<AiProviderKey, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_AI_API_KEY', groq: 'GROQ_API_KEY' };
const CAPS: AiCapability[] = ['text', 'vision', 'transcription', 'embeddings'];
/** Calculator reference volumes: a voice note ≈ 1 min of transcription (USD per minute ≈ inputPricePerM / 1000), an image ≈ 1 000 input tokens on top of a message. */
const IMAGE_EXTRA_TOKENS = 1000;
type ModelWithProvider = AiModel & { provider: AiProvider };

/** A configured model id the provider lists, as is or as the alias of a dated snapshot (`claude-haiku-4-5` ⇒ `claude-haiku-4-5-20251001`). */
export const knownModel = (listed: Set<string>, id: string) => listed.has(id) || [...listed].some((l) => l.startsWith(`${id}-`) && /^\d{8}$|^\d{4}-\d{2}-\d{2}$|^latest$/.test(l.slice(id.length + 1)));

/** Why a provider test failed, for the dialog (UX-013): timeout / network / 404 endpoint / 429 / 5xx / another HTTP status. */
export const testFailure = (e: AiProviderError): { reason: AiProviderTestReason; status?: number } => {
  if (e.kind === 'timeout') return { reason: 'timeout' };
  const s = e.status;
  if (!s) return { reason: 'network' };
  if (s === 404) return { reason: 'endpoint', status: s };
  if (s === 429) return { reason: 'rate_limited', status: s };
  if (s >= 500) return { reason: 'provider_down', status: s };
  return { reason: 'http_error', status: s };
};

@Injectable()
export class AiAdminService {
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async log(actor: AdminActor, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, reason: string | null) {
    await this.audit.write({ actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity, entityId, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }

  private keyOf(p: AiProvider): { key: string | null; source: 'stored' | 'env' | null } {
    if (p.apiKey?.length) {
      try {
        return { key: this.crypto.decrypt(Buffer.from(p.apiKey).toString('utf8')), source: 'stored' };
      } catch {
        return { key: null, source: null };
      }
    }
    const env = this.config.get(ENV_KEYS[p.key] as never) as string | undefined;
    return env ? { key: env, source: 'env' } : { key: null, source: null };
  }
  private hint(key: string | null) {
    if (!key) return null;
    const prefix = key.startsWith('sk-ant-') ? 'sk-ant-' : key.startsWith('sk-') ? 'sk-' : key.slice(0, 3);
    return `${prefix}…${key.slice(-4)}`;
  }

  // --- providers -----------------------------------------------------------------------------------------------------------
  async providers(): Promise<AiProviderAdminDto[]> {
    const [rows, routes, runs] = await Promise.all([
      prisma.aiProvider.findMany({ include: { models: { where: { isActive: true }, orderBy: { displayName: 'asc' } } }, orderBy: [{ isPrimary: 'desc' }, { key: 'asc' }] }),
      prisma.aiRoute.findMany({ include: { primaryModel: true, fallbackModel: true } }),
      prisma.aiRun.groupBy({ by: ['providerId', 'status'], where: { startedAt: { gte: new Date(Date.now() - DAY) } }, _count: { _all: true } }),
    ]);
    return rows.map((p) => {
      const { key, source } = this.keyOf(p);
      const mine = runs.filter((r) => r.providerId === p.id);
      const total = mine.reduce((n, r) => n + r._count._all, 0);
      const errors = mine.filter((r) => r.status === 'error').reduce((n, r) => n + r._count._all, 0);
      const primaryRoutes = routes.filter((r) => r.primaryModel.providerId === p.id);
      const threshold = primaryRoutes.length ? Math.min(...primaryRoutes.map((r) => r.errorThresholdPct)) : 2;
      const isFallback = routes.some((r) => r.fallbackModel?.providerId === p.id) && !primaryRoutes.length;
      return {
        key: p.key,
        displayName: p.displayName,
        isActive: p.isActive,
        isPrimary: p.isPrimary,
        state: !p.isActive ? 'disabled' : p.isPrimary ? 'primary' : isFallback ? 'fallback' : 'active',
        keyHint: this.hint(key),
        keySource: source,
        keyAddedAt: iso(p.keyAddedAt),
        lastTestedAt: iso(p.lastTestedAt),
        lastTestOk: p.lastTestOk,
        models: p.models.map((m) => ({ id: m.id, modelId: m.modelId, displayName: m.displayName, capabilities: m.capabilities })),
        health: { runs24h: total, errors24h: errors, errorRatePct: total ? Math.round((errors / total) * 1000) / 10 : null, thresholdPct: threshold, failoverActive: primaryRoutes.some((r) => r.failoverActive) },
      };
    });
  }

  private async providerOr404(key: string) {
    if (!['openai', 'anthropic', 'google', 'groq'].includes(key)) throw notFound();
    const p = await prisma.aiProvider.findUnique({ where: { key: key as AiProviderKey } });
    if (!p) throw notFound();
    return p;
  }

  /** `PATCH /admin/ai-providers/:key` — the key is sealed with `RoutingService.sealKey` (AES-256-GCM); never logged or returned. */
  async patchProvider(key: string, input: AdminPatchAiProviderInput, actor: AdminActor) {
    const p = await this.providerOr404(key);
    const data: Prisma.AiProviderUpdateInput = {};
    if (input.apiKey !== undefined) {
      data.apiKey = input.apiKey === null ? null : this.routing.sealKey(input.apiKey);
      data.keyAddedAt = input.apiKey === null ? null : new Date();
      data.lastTestedAt = null;
      data.lastTestOk = null;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
    await prisma.$transaction(async (db) => {
      if (input.isPrimary) await db.aiProvider.updateMany({ where: { id: { not: p.id } }, data: { isPrimary: false } });
      await db.aiProvider.update({ where: { id: p.id }, data });
    });
    // secrets hashed in the trail (07 §6): only "key replaced" + its hint
    await this.log(actor, input.apiKey !== undefined ? 'ai_provider.key_update' : 'ai_provider.update', 'AiProvider', p.id, { isActive: p.isActive, isPrimary: p.isPrimary, keyHint: this.hint(this.keyOf(p).key) }, { isActive: input.isActive ?? p.isActive, isPrimary: input.isPrimary ?? p.isPrimary, keyHint: input.apiKey === undefined ? undefined : this.hint(input.apiKey) }, input.reason?.trim() || null);
    return (await this.providers()).find((x) => x.key === p.key)!;
  }

  /** `POST /admin/ai-providers/:key/test { apiKey? }` — admin-triggered connectivity check (03-events §7 exception list: provider tests). */
  async testProvider(key: string, apiKey: string | undefined, actor: AdminActor): Promise<AiProviderTestDto> {
    const p = await this.providerOr404(key);
    const k = apiKey ?? this.keyOf(p).key;
    if (!k) throw new AppException('AI_PROVIDER_NO_KEY');
    const model = await prisma.aiModel.findFirst({ where: { providerId: p.id, isActive: true }, orderBy: { isDefault: 'desc' } });
    const started = Date.now();
    let error: AppException | null = null;
    let missingModels: string[] = [];
    try {
      if (this.gateway.driver !== 'live') {
        // fake driver: deterministic outcomes for the dialog states (TEST… / OK / REJETÉE / INJOIGNABLE)
        if (/reject/i.test(k)) throw new AiProviderError('provider_rejected', p.key, 'rejected', 401);
        if (/unreachable/i.test(k)) throw new AiProviderError('provider_error', p.key, 'unreachable', 503);
        if (/timeout/i.test(k)) throw new AiProviderError('timeout', p.key, 'timeout');
      } else if (this.gateway.checkKey) {
        // the key lists the models: no model id involved (a retired / misspelled model made a good key « injoignable », UX-013)
        const listed = new Set((await this.gateway.checkKey(p.key, k, 10_000)).models);
        if (listed.size) missingModels = (await prisma.aiModel.findMany({ where: { providerId: p.id, isActive: true }, select: { modelId: true } })).map((m) => m.modelId).filter((id) => !knownModel(listed, id));
      } else if (model && !model.capabilities.includes('transcription')) {
        await this.gateway.generate({ model: { provider: p.key, modelId: model.modelId, apiKey: k }, purpose: 'reply', system: 'ping', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1, timeoutMs: 10_000 });
      }
    } catch (e) {
      if (!(e instanceof AiProviderError)) throw e;
      error = e.kind === 'provider_rejected' ? new AppException('AI_PROVIDER_KEY_REJECTED', { provider: p.displayName }) : e.kind === 'no_key' ? new AppException('AI_PROVIDER_NO_KEY') : new AppException('AI_PROVIDER_UNREACHABLE', { provider: p.displayName }, {}, testFailure(e));
    }
    const latencyMs = Math.max(1, Date.now() - started);
    if (!apiKey) await prisma.aiProvider.update({ where: { id: p.id }, data: { lastTestedAt: new Date(), lastTestOk: !error } });
    await this.log(actor, 'ai_provider.test', 'AiProvider', p.id, null, { ok: !error, code: error?.code ?? null, reason: (error?.details as { reason?: string } | undefined)?.reason ?? null, latencyMs, candidateKey: !!apiKey, missingModels }, null);
    if (error) throw error;
    return { ok: true, latencyMs, model: model?.modelId ?? null, missingModels };
  }

  // --- models --------------------------------------------------------------------------------------------------------------
  private modelDto(m: ModelWithProvider, routes: { capability: string; primaryModelId: string; fallbackModelId: string | null }[]): AiModelAdminDto {
    return {
      id: m.id,
      provider: m.provider.displayName,
      providerKey: m.provider.key,
      modelId: m.modelId,
      displayName: m.displayName,
      capabilities: m.capabilities,
      supportsTools: m.supportsTools,
      inputPricePerM: Number(m.inputPricePerM),
      outputPricePerM: Number(m.outputPricePerM),
      contextTokens: m.contextTokens,
      timeoutSec: m.timeoutSec,
      failoverThresholdPct: m.failoverThresholdPct,
      isActive: m.isActive,
      usedBy: routes.filter((r) => r.primaryModelId === m.id || r.fallbackModelId === m.id).map((r) => `${r.capability}:${r.primaryModelId === m.id ? 'primary' : 'fallback'}`),
    };
  }

  async models(): Promise<AiModelAdminDto[]> {
    const [rows, routes] = await Promise.all([prisma.aiModel.findMany({ include: { provider: true }, orderBy: [{ providerId: 'asc' }, { displayName: 'asc' }] }), prisma.aiRoute.findMany()]);
    return rows.map((m) => this.modelDto(m, routes));
  }

  async createModel(input: AdminCreateAiModelInput, actor: AdminActor) {
    const p = await this.providerOr404(input.providerKey);
    if (await prisma.aiModel.findUnique({ where: { providerId_modelId: { providerId: p.id, modelId: input.modelId } } })) throw new AppException('CONFLICT', {}, { modelId: 'validation.taken' });
    const { providerKey: _p, reason, ...data } = input;
    const m = await prisma.aiModel.create({ data: { ...data, providerId: p.id }, include: { provider: true } });
    await this.log(actor, 'ai_model.create', 'AiModel', m.id, null, data, reason?.trim() || null);
    return this.modelDto(m, []);
  }

  async updateModel(id: string, input: AdminUpdateAiModelInput, actor: AdminActor) {
    assertUuid(id);
    const m = await prisma.aiModel.findUnique({ where: { id }, include: { provider: true } });
    if (!m) throw notFound();
    const { reason, ...data } = input;
    const row = await prisma.aiModel.update({ where: { id }, data, include: { provider: true } });
    for (const r of await prisma.aiRoute.findMany({ where: { OR: [{ primaryModelId: id }, { fallbackModelId: id }] } })) await this.routing.resetBreaker(r.primaryModelId);
    await this.log(actor, 'ai_model.update', 'AiModel', id, Object.fromEntries(Object.keys(data).map((k) => [k, (m as Record<string, unknown>)[k]])), data, reason?.trim() || null);
    return this.modelDto(row, await prisma.aiRoute.findMany());
  }

  /**
   * `DELETE /admin/ai-models/:id` (UX-032): refused while a route uses it (`409 AI_MODEL_IN_ROUTE {count}`); a model that
   * already served (AI runs or agents point to it: the history keeps it) is switched off instead; otherwise deleted.
   */
  async deleteModel(id: string, actor: AdminActor): Promise<AiModelDeleteDto> {
    assertUuid(id);
    const m = await prisma.aiModel.findUnique({ where: { id } });
    if (!m) throw notFound();
    const routes = await prisma.aiRoute.count({ where: { OR: [{ primaryModelId: id }, { fallbackModelId: id }] } });
    if (routes) throw new AppException('AI_MODEL_IN_ROUTE', { count: routes });
    let outcome: 'deleted' | 'deactivated' = 'deleted';
    try {
      await prisma.aiModel.delete({ where: { id } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2003' || e.code === 'P2014'))) throw e;
      outcome = 'deactivated';
      await prisma.aiModel.update({ where: { id }, data: { isActive: false } });
    }
    await this.log(actor, 'ai_model.delete', 'AiModel', id, { modelId: m.modelId }, { deleted: outcome === 'deleted', deactivated: outcome === 'deactivated' }, null);
    return { outcome };
  }

  // --- routes --------------------------------------------------------------------------------------------------------------
  private async currentPricing() {
    return prisma.creditPricing.findFirst({ where: { effectiveAt: { lte: new Date() } }, orderBy: { version: 'desc' } });
  }

  /** USD cost of one unit of the capability on a model (message / image / voice minute / embedding of 1 k tokens). */
  private unitCostUsd(m: AiModel, capability: AiCapability, avgTokens: number) {
    const inP = Number(m.inputPricePerM);
    const outP = Number(m.outputPricePerM);
    if (capability === 'transcription') return inP / 1000; // price stored per 1 000 minutes for speech models (seed convention)
    if (capability === 'embeddings') return (1000 * inP) / 1_000_000;
    const tokens = capability === 'vision' ? avgTokens + IMAGE_EXTRA_TOKENS : avgTokens;
    return (tokens * 0.85 * inP + tokens * 0.15 * outP) / 1_000_000;
  }

  private routeDto(r: Prisma.AiRouteGetPayload<{ include: { primaryModel: { include: { provider: true } }; fallbackModel: { include: { provider: true } } } }>, pricing: { usdToDzd: number; creditPriceDzd: number; avgTokens: number }, open: boolean): AiRouteDto {
    const cost = this.unitCostUsd(r.primaryModel, r.capability, pricing.avgTokens);
    const revenueDzd = r.creditCost * pricing.creditPriceDzd;
    const costDzd = cost * pricing.usdToDzd;
    return {
      capability: r.capability,
      primary: { modelId: r.primaryModel.id, label: r.primaryModel.displayName, provider: r.primaryModel.provider.displayName },
      fallback: r.fallbackModel ? { modelId: r.fallbackModel.id, label: r.fallbackModel.displayName, provider: r.fallbackModel.provider.displayName } : null,
      realCostUsdPer1k: Math.round(cost * 100000) / 100000,
      credits: r.creditCost,
      marginPct: revenueDzd > 0 ? Math.round(((revenueDzd - costDzd) / revenueDzd) * 100) : null,
      state: r.failoverActive ? 'failover' : open || !r.primaryModel.isActive ? 'degraded' : 'ok',
      failoverSince: iso(r.failoverSince),
      timeoutSec: r.timeoutSec,
      errorThresholdPct: r.errorThresholdPct,
    };
  }
  private readonly routeInclude = { primaryModel: { include: { provider: true } }, fallbackModel: { include: { provider: true } } } as const;

  async routes(): Promise<AiRouteDto[]> {
    const [rows, pr] = await Promise.all([prisma.aiRoute.findMany({ include: this.routeInclude }), this.currentPricing()]);
    const pricing = { usdToDzd: Number(pr?.usdToDzd ?? 135), creditPriceDzd: Number(pr?.creditPriceDzd ?? 0.9), avgTokens: pr?.avgTokensPerMessage ?? 1800 };
    const out: AiRouteDto[] = [];
    for (const r of rows.sort((a, b) => CAPS.indexOf(a.capability) - CAPS.indexOf(b.capability))) out.push(this.routeDto(r, pricing, await this.routing.isOpen(r.primaryModelId)));
    return out;
  }

  async route(capability: string) {
    if (!CAPS.includes(capability as AiCapability)) throw notFound();
    const r = (await this.routes()).find((x) => x.capability === capability);
    if (!r) throw notFound();
    return r;
  }

  /** `PUT /admin/ai-routes/:capability` — primary + fallback, credit cost, timeout, threshold; `failoverActive` forces / clears the "bascule". */
  async putRoute(capability: string, input: AdminPutAiRouteInput, actor: AdminActor) {
    if (!CAPS.includes(capability as AiCapability)) throw notFound();
    const cap = capability as AiCapability;
    const ids = [input.primaryModelId, ...(input.fallbackModelId ? [input.fallbackModelId] : [])];
    const models = await prisma.aiModel.findMany({ where: { id: { in: ids } } });
    const primary = models.find((m) => m.id === input.primaryModelId);
    if (!primary || !primary.capabilities.includes(cap)) throw new AppException('VALIDATION_ERROR', {}, { primaryModelId: 'validation.invalid' });
    if (input.fallbackModelId) {
      const fb = models.find((m) => m.id === input.fallbackModelId);
      if (!fb || !fb.capabilities.includes(cap) || fb.id === primary.id) throw new AppException('VALIDATION_ERROR', {}, { fallbackModelId: 'validation.invalid' });
    }
    if (input.failoverActive && !input.fallbackModelId) throw new AppException('VALIDATION_ERROR', {}, { failoverActive: 'validation.invalid' });
    const before = await prisma.aiRoute.findUnique({ where: { capability: cap } });
    const failover = input.failoverActive ?? (before?.failoverActive && !!input.fallbackModelId ? true : false);
    const data = {
      primaryModelId: input.primaryModelId,
      fallbackModelId: input.fallbackModelId ?? null,
      creditCost: input.creditCost,
      timeoutSec: input.timeoutSec ?? before?.timeoutSec ?? 20,
      errorThresholdPct: input.errorThresholdPct ?? before?.errorThresholdPct ?? 2,
      failoverActive: failover,
      failoverSince: failover ? (before?.failoverActive ? before.failoverSince : new Date()) : null,
      updatedById: actor.userId,
    };
    await prisma.aiRoute.upsert({ where: { capability: cap }, create: { capability: cap, ...data }, update: data });
    if (input.failoverActive === false) await this.routing.resetBreaker(input.primaryModelId);
    await this.log(actor, 'ai_route.update', 'AiRoute', cap, before ? { primaryModelId: before.primaryModelId, fallbackModelId: before.fallbackModelId, creditCost: before.creditCost, failoverActive: before.failoverActive } : null, { ...data, updatedById: undefined, failoverSince: iso(data.failoverSince) }, input.reason?.trim() || null);
    return this.route(cap);
  }

  // --- pricing -------------------------------------------------------------------------------------------------------------
  async simulate(input: AiPricingSimulateInput): Promise<AiPricingSimulationDto> {
    const pr = await this.currentPricing();
    const stored = (pr?.costs ?? {}) as Record<string, number>;
    const costs = input.costs ?? { text: stored.text ?? 1, image: stored.image ?? 5, voice: stored.voice ?? 3, order: stored.order ?? 0 };
    const routes = await prisma.aiRoute.findMany({ include: this.routeInclude });
    const pro = await prisma.plan.findUnique({ where: { slug: 'pro' } });
    const rows: AiPricingSimulationDto['rows'] = [];
    const caps: [AiCapability, 'text' | 'image' | 'voice', 'message' | 'image' | 'note'][] = [['text', 'text', 'message'], ['vision', 'image', 'image'], ['transcription', 'voice', 'note']];
    let textCostDzd = 0;
    for (const [cap, key, unit] of caps) {
      const r = routes.find((x) => x.capability === cap);
      const costUsd = r ? this.unitCostUsd(r.primaryModel, cap, input.avgTokensPerMessage) : 0;
      const realCostDzd = Math.round(costUsd * input.usdToDzd * 100) / 100;
      if (cap === 'text') textCostDzd = realCostDzd;
      const credits = costs[key];
      const revenueDzd = Math.round(credits * input.creditPriceDzd * 100) / 100;
      const marginPct = revenueDzd > 0 ? Math.round(((revenueDzd - realCostDzd) / revenueDzd) * 100) : -100;
      const recommendedCredits = Math.max(1, Math.ceil(realCostDzd / (input.creditPriceDzd * (1 - input.targetMarginPct / 100))));
      rows.push({ capability: cap as 'text' | 'vision' | 'transcription', credits, revenueDzd, realCostDzd, marginPct, belowTarget: marginPct < input.targetMarginPct, recommendedCredits, unit });
    }
    return {
      input: { ...input, costs },
      impliedCreditPriceDzd: pro && pro.monthlyCredits > 0 ? Math.round((pro.priceMonthly / pro.monthlyCredits) * 100) / 100 : null,
      rows,
      creditPriceForTargetDzd: Math.round((textCostDzd / Math.max(1, costs.text) / (1 - input.targetMarginPct / 100)) * 100) / 100,
    };
  }

  async pricing(): Promise<AiPricingDto> {
    const pr = await prisma.creditPricing.findFirst({ where: { effectiveAt: { lte: new Date() } }, orderBy: { version: 'desc' }, include: { createdBy: { select: userSelect } } });
    const current: CreditPricingDto | null = pr ? AdminBillingCatalogService.pricingDto(pr, true) : null;
    const simulation = await this.simulate({ usdToDzd: current?.usdToDzd ?? 135, creditPriceDzd: current?.creditPriceDzd ?? 0.9, avgTokensPerMessage: current?.avgTokensPerMessage ?? 1800, targetMarginPct: current?.targetMarginPct ?? 60, costs: current?.costs });
    return { current, routes: await this.routes(), simulation };
  }

  /** `POST /admin/ai-pricing/versions` — applies at each workspace's next credit period (D63); the route credit costs follow the grid then. */
  async createPricingVersion(input: AdminCreatePricingVersionInput, actor: AdminActor): Promise<CreditPricingDto> {
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10) throw new AppException('ADMIN_REASON_REQUIRED', {}, { reason: 'validation.length' });
    const last = await prisma.creditPricing.findFirst({ orderBy: { version: 'desc' } });
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt.length === 10 ? `${input.effectiveAt}T00:00:00+01:00` : input.effectiveAt) : new Date();
    if (input.announcementCmsEntryId && !(await prisma.cmsEntry.findUnique({ where: { id: input.announcementCmsEntryId } }))) throw new AppException('VALIDATION_ERROR', {}, { announcementCmsEntryId: 'validation.id' });
    const row = await prisma.creditPricing.create({
      data: { version: (last?.version ?? 0) + 1, usdToDzd: input.usdToDzd, creditPriceDzd: input.creditPriceDzd, costs: input.costs, avgTokensPerMessage: input.avgTokensPerMessage, targetMarginPct: input.targetMarginPct, effectiveAt, createdById: actor.userId, announcementCmsEntryId: input.announcementCmsEntryId ?? null },
      include: { createdBy: { select: userSelect } },
    });
    await this.log(actor, 'pricing.version', 'CreditPricing', row.id, last ? { version: last.version, creditPriceDzd: Number(last.creditPriceDzd), costs: last.costs } : null, { version: row.version, creditPriceDzd: input.creditPriceDzd, costs: input.costs, effectiveAt: effectiveAt.toISOString() }, reason);
    return AdminBillingCatalogService.pricingDto(row, effectiveAt <= new Date());
  }
}
