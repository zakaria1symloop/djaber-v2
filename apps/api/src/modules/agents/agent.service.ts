// 03 §6 AGT-01…09 — agents: list, presets, the 5-step wizard on a draft (each save ⇒ compiled instructions + a new
// `AgentVersion`), activation (plan limit counted on active + paused agents, never on drafts), pause / resume,
// duplicate, delete, versions with restore, readiness checklist, metrics. The model is never chosen by the merchant
// (R-H): `Agent.modelId` follows the platform routing at every save.
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AGENT_INSTRUCTIONS_MAX,
  type ActionDescriptor,
  type AgentDto,
  type AgentMetrics,
  type AgentMetricsDto,
  type AgentPresetDto,
  type AgentReadinessDto,
  type AgentsQuery,
  type AgentVersionDetailDto,
  type AgentVersionDiffDto,
  type AgentVersionDto,
  type AgentWizardInput,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Agent, type AgentVersionSource, type Personality, type Tx } from '@djaber/db';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import type { BulkResult } from '../../core/http/pagination';
import { I18nService } from '../../core/i18n/i18n.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { ModerationHookService } from '../catalog/moderation-hook.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { CatalogueService } from '../ai/catalogue.service';
import { InsightService } from '../ai/insight.service';
import { RoutingService } from '../ai/routing.service';
import { channelRef } from '../channels/channel.service';
import { ChannelEvents } from '../channels/channel.util';
import { CreditService } from '../credits/credit.service';
import { ConversationService } from '../messaging/conversation.service';
import { contextOf } from '../messaging/messaging.presenter';
import { OutboundSendService } from '../messaging/outbound-send.service';
import { SafetyService } from '../messaging/safety.service';
import { NotificationProducer } from '../notifications/notification.producer';
import {
  agentTextKey,
  compileInstructions,
  DEFAULT_CAPABILITIES,
  DEFAULT_HANDOFF_RULES,
  DEFAULT_ORDER_FIELDS,
  diffSnapshots,
  EMPTY_METRICS,
  merchantInstructions,
  normalizeHandoffRules,
  normalizeOrderFields,
  presetInstructions,
  snapshotOf,
  snapshotToData,
  wizardOf,
  type AgentSnapshot,
} from './agent.presenter';

const include = {
  model: { include: { provider: true } },
  preset: true,
  avatar: { select: { url: true } },
  channels: { include: { channel: true }, orderBy: { createdAt: 'asc' } },
  _count: { select: { products: true, faqs: true } },
} as const satisfies Prisma.AgentInclude;
type Row = Prisma.AgentGetPayload<{ include: typeof include }>;
type PresetConfig = { tone?: string; temperature?: number; maxTokens?: number; imageRecognition?: boolean; voiceNotes?: boolean; replyDelaySec?: number };
type PresetLocales = Record<string, { name?: string; tagline?: string; systemPrompt?: string }>;
const DAY = 86_400_000;
const PERSONALITIES: Personality[] = ['professional', 'friendly', 'casual', 'technical'];
const userRef = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;

@Injectable()
export class AgentService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly i18n: I18nService,
    private readonly routing: RoutingService,
    private readonly catalogue: CatalogueService,
    private readonly insights: InsightService,
    private readonly credits: CreditService,
    private readonly channelEvents: ChannelEvents,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly notifications: NotificationProducer,
    private readonly moderation: ModerationHookService,
    private readonly conversations: ConversationService,
    private readonly outbound: OutboundSendService,
    private readonly safety: SafetyService,
  ) {}

  onModuleInit() {
    // `POST /agents/:id/activate { at }`: scheduled activations (same checks as an immediate one)
    this.registry.cron('sched-agent-activation', '* * * * *', () => this.activateScheduled());
    // 03-events §4 (D53): a newer published preset version is announced once per agent and version
    this.registry.cron('sched-preset-updates', '0 6 * * *', () => this.announcePresetUpdates());
  }

  // --- presets (AGT-02) ----------------------------------------------------------------------------------------------------
  private presetView(p: { key: string; name: unknown; tagline: unknown; description: unknown; badge: AgentPresetDto['badge']; currentVersion: number }, v: { version: number; config: unknown; locales: unknown }, locale: string): AgentPresetDto {
    const config = (v.config ?? {}) as PresetConfig;
    const locales = (v.locales ?? {}) as PresetLocales;
    return {
      key: p.key,
      name: this.i18n.pick(p.name, locale),
      tagline: p.tagline ? this.i18n.pick(p.tagline, locale) : null,
      description: p.description ? this.i18n.pick(p.description, locale) : null,
      badge: p.badge,
      version: v.version,
      personality: PERSONALITIES.includes(config.tone as Personality) ? (config.tone as Personality) : 'friendly',
      temperature: config.temperature ?? 0.6,
      maxTokens: config.maxTokens ?? 1200,
      imageRecognition: config.imageRecognition !== false,
      voiceTranscription: config.voiceNotes !== false,
      responseDelaySec: config.replyDelaySec ?? 3,
      instructions: presetInstructions(locales, locale),
    };
  }

  async presets(locale: string): Promise<AgentPresetDto[]> {
    const rows = await prisma.agentPreset.findMany({ where: { status: 'published', archivedAt: null }, orderBy: { sortOrder: 'asc' }, include: { versions: { where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1 } } });
    return rows.filter((p) => p.versions[0]).map((p) => this.presetView(p, p.versions[0]!, locale));
  }

  // --- reads ---------------------------------------------------------------------------------------------------------------
  private async rowOrNotFound(id: string, db: Tx | typeof prisma = prisma): Promise<Row> {
    const row = await db.agent.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw notFound();
    return row;
  }

  /** AGT-09 figures of several agents over a period, in a handful of grouped queries. */
  private async metricsOf(agentIds: string[], from: Date, to: Date): Promise<Map<string, AgentMetrics & { aiMessages: number; handoffs: number }>> {
    const out = new Map<string, AgentMetrics & { aiMessages: number; handoffs: number }>();
    if (!agentIds.length) return out;
    const ids = Prisma.join(agentIds.map((id) => Prisma.sql`${id}::uuid`));
    const workspaceId = TenantContext.workspaceId();
    const [runs, human, orders, reactions, messages] = await Promise.all([
      prisma.$queryRaw<{ agentId: string; conversations: bigint; avg: number | null; p95: number | null; credits: bigint | null; handoffs: bigint }[]>`
        SELECT "agentId", count(DISTINCT "conversationId") AS conversations, avg("latencyMs")::float AS avg, percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS p95,
               sum("creditsCharged") AS credits, count(*) FILTER (WHERE "status" IN ('handoff','unknown')) AS handoffs
        FROM "AiRun" WHERE "workspaceId" = ${workspaceId}::uuid AND "kind" = 'reply' AND "agentId" IN (${ids}) AND "startedAt" >= ${from} AND "startedAt" < ${to} GROUP BY "agentId"`,
      prisma.$queryRaw<{ agentId: string; n: bigint }[]>`
        SELECT r."agentId", count(DISTINCT r."conversationId") AS n
        FROM "AiRun" r JOIN "Conversation" c ON c."id" = r."conversationId"
        WHERE r."workspaceId" = ${workspaceId}::uuid AND r."kind" = 'reply' AND r."agentId" IN (${ids}) AND r."startedAt" >= ${from} AND r."startedAt" < ${to}
          AND c."status" <> 'needs_human'
          AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c."id" AND m."author" = 'human' AND m."createdAt" >= ${from})
        GROUP BY r."agentId"`,
      prisma.order.groupBy({ by: ['agentId', 'status'], where: { agentId: { in: agentIds }, source: 'ai', orderedAt: { gte: from, lt: to } }, _count: { _all: true } }),
      prisma.$queryRaw<{ agentId: string; likes: bigint; votes: bigint }[]>`
        SELECT r."agentId", count(*) FILTER (WHERE m."customerReaction" = 'like') AS likes, count(*) AS votes
        FROM "Message" m JOIN "AiRun" r ON r."id" = m."aiRunId"
        WHERE m."workspaceId" = ${workspaceId}::uuid AND r."agentId" IN (${ids}) AND m."customerReaction" IS NOT NULL AND m."createdAt" >= ${from} AND m."createdAt" < ${to} GROUP BY r."agentId"`,
      prisma.$queryRaw<{ agentId: string; n: bigint }[]>`
        SELECT r."agentId", count(*) AS n FROM "Message" m JOIN "AiRun" r ON r."id" = m."aiRunId"
        WHERE m."workspaceId" = ${workspaceId}::uuid AND m."author" = 'ai' AND r."agentId" IN (${ids}) AND m."createdAt" >= ${from} AND m."createdAt" < ${to} GROUP BY r."agentId"`,
    ]);
    for (const id of agentIds) {
      const r = runs.find((x) => x.agentId === id);
      const mine = orders.filter((o) => o.agentId === id);
      const total = mine.reduce((n, o) => n + o._count._all, 0);
      const confirmed = mine.filter((o) => !['new', 'cancelled'].includes(o.status)).reduce((n, o) => n + o._count._all, 0);
      const react = reactions.find((x) => x.agentId === id);
      out.set(id, {
        conversations: Number(r?.conversations ?? 0),
        handledWithoutHuman: Number(human.find((x) => x.agentId === id)?.n ?? 0),
        orders: total,
        confirmedPct: total ? Math.round((confirmed / total) * 100) : 0,
        delivered: mine.filter((o) => o.status === 'delivered').reduce((n, o) => n + o._count._all, 0),
        avgLatencyMs: Math.round(r?.avg ?? 0),
        p95LatencyMs: Math.round(r?.p95 ?? 0),
        credits: Number(r?.credits ?? 0),
        satisfaction: react && Number(react.votes) > 0 ? { score: Math.round((Number(react.likes) / Number(react.votes)) * 100) / 100, votes: Number(react.votes) } : null,
        aiMessages: Number(messages.find((x) => x.agentId === id)?.n ?? 0),
        handoffs: Number(r?.handoffs ?? 0),
      });
    }
    return out;
  }

  private actions(a: Row, canManage: boolean, slotFree: boolean): ActionDescriptor[] {
    const act = (key: string, enabled: boolean, reasonCode?: string, primary?: boolean): ActionDescriptor => ({ key, enabled: enabled && (canManage || key === 'test' || key === 'view'), ...(enabled || !reasonCode ? {} : { reasonCode }), ...(!canManage && key !== 'test' && key !== 'view' ? { reasonCode: 'FORBIDDEN' } : {}), ...(primary ? { primary } : {}) });
    return [
      act('edit', true, undefined, a.status !== 'draft'),
      act('activate', a.status === 'draft' && a.channels.length > 0, a.status !== 'draft' ? 'CONFLICT' : 'AGENT_NO_CHANNEL', a.status === 'draft'),
      act('pause', a.status === 'active', 'CONFLICT'),
      // an agent paused by the plan only comes back while a slot is free (assertSlot answers PLAN_LIMIT otherwise)
      act('resume', a.status === 'paused' && (a.pausedReason !== 'plan' || slotFree), a.status !== 'paused' ? 'CONFLICT' : 'PLAN_LIMIT'),
      act('test', true),
      act('duplicate', true),
      act('delete', true),
    ];
  }

  private async present(rows: Row[], locale: string, o: { productIds?: boolean } = {}): Promise<AgentDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const t = TenantContext.get();
    const [metrics, pending, presetVersions, products] = await Promise.all([
      this.metricsOf(ids, new Date(Date.now() - 30 * DAY), new Date()),
      prisma.agentInsight.groupBy({ by: ['agentId'], where: { agentId: { in: ids }, status: 'pending' }, _count: { _all: true } }),
      prisma.agentPreset.findMany({ where: { id: { in: rows.map((r) => r.presetId).filter((x): x is string => !!x) } }, select: { id: true, currentVersion: true } }),
      o.productIds ? prisma.agentProduct.findMany({ where: { agentId: { in: ids } }, select: { agentId: true, productId: true } }) : Promise.resolve([]),
    ]);
    const activeProducts = rows.some((r) => r.sellAllProducts) ? await Promise.all(rows.map((r) => (r.sellAllProducts ? this.catalogue.count(r) : Promise.resolve(r._count.products)))) : rows.map((r) => r._count.products);
    const canManage = t.role === 'owner' || t.role === 'admin';
    const slotFree = !rows.some((r) => r.status === 'paused' && r.pausedReason === 'plan') || t.limits.maxAgents < 0 || (await this.slotHolders()) < t.limits.maxAgents;
    return rows.map((a, i) => {
      const current = presetVersions.find((p) => p.id === a.presetId)?.currentVersion ?? null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        pausedReason: a.pausedReason === 'moderation' ? 'manual' : a.pausedReason,
        isActive: a.status === 'active',
        personality: a.personality,
        customInstructions: merchantInstructions(a.customInstructions),
        productCardTemplate: a.productCardTemplate,
        closingInstructions: a.closingInstructions,
        humanHandoffRules: a.humanHandoffRules,
        model: { id: a.model.id, label: a.model.displayName, provider: a.model.provider.displayName },
        temperature: Number(a.temperature),
        maxTokens: a.maxTokens,
        responseDelaySec: a.responseDelaySec,
        sellAllProducts: a.sellAllProducts,
        productCount: activeProducts[i] ?? 0,
        ...(o.productIds ? { productIds: products.filter((p) => p.agentId === a.id).map((p) => p.productId) } : {}),
        imageRecognition: a.imageRecognition,
        voiceTranscription: a.voiceTranscription,
        channels: a.channels.map((c) => channelRef(c.channel)),
        preset: a.preset ? { key: a.preset.key, name: this.i18n.pick(a.preset.name, locale), version: a.presetVersion ?? 0, updateAvailable: current !== null && a.presetVersion !== null && current > a.presetVersion ? current : null } : null,
        currentVersion: a.currentVersion,
        lastActiveAt: a.lastActiveAt?.toISOString() ?? null,
        scheduledActivateAt: a.scheduledActivateAt?.toISOString() ?? null,
        wizardStep: a.wizardStep,
        wizard: wizardOf(a, { avatarUrl: a.avatar?.url ?? null, faqCount: a._count.faqs }),
        metrics30d: (({ aiMessages: _m, handoffs: _h, ...m }) => m)(metrics.get(a.id) ?? { ...EMPTY_METRICS, aiMessages: 0, handoffs: 0 }),
        pendingInsights: pending.find((p) => p.agentId === a.id)?._count._all ?? 0,
        version: a.version,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        actions: this.actions(a, canManage, slotFree),
      };
    });
  }

  async list(q: AgentsQuery, locale: string): Promise<AgentDto[]> {
    const and: Prisma.AgentWhereInput[] = [{ deletedAt: null }];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.channelId?.length) and.push({ channels: { some: { channelId: { in: q.channelId } } } });
    if (q.modelId?.length) and.push({ modelId: { in: q.modelId } });
    if (q.capabilities?.includes('voice')) and.push({ voiceTranscription: true });
    if (q.capabilities?.includes('image')) and.push({ imageRecognition: true });
    if (q.presetKey?.length) and.push({ preset: { key: { in: q.presetKey } } });
    if (q.activeDays) and.push({ lastActiveAt: { gte: new Date(Date.now() - q.activeDays * DAY) } });
    if (q.defaultLanguage) and.push({ defaultLanguage: q.defaultLanguage });
    if (q.hasPendingInsights !== undefined) and.push({ insights: q.hasPendingInsights ? { some: { status: 'pending' } } : { none: { status: 'pending' } } });
    if (q.q) and.push({ OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }] });
    if (q.productId) {
      // "Agents qui le vendent": the catalogue scope of `CatalogueService.scopeWhere` read the other way round. A product of
      // another workspace (or an unknown id) is a 404, like every cross-workspace reference.
      const p = await prisma.product.findFirst({ where: { id: q.productId }, select: { id: true, categoryId: true } });
      if (!p) throw notFound();
      and.push({
        OR: [
          { sellAllProducts: false, products: { some: { productId: p.id } } },
          { sellAllProducts: true, catalogScope: 'all' },
          ...(p.categoryId ? [{ sellAllProducts: true, catalogScope: 'categories' as const, scopeCategoryIds: { has: p.categoryId } }] : []),
        ],
      });
    }
    const sort = q.sort ?? '-lastActiveAt';
    const dir = sort.startsWith('-') ? 'desc' : 'asc';
    const orderBy: Prisma.AgentOrderByWithRelationInput[] = sort.endsWith('name') ? [{ name: dir }, { id: 'asc' }] : [{ lastActiveAt: { sort: dir, nulls: 'last' } }, { createdAt: 'desc' }];
    const rows = await prisma.agent.findMany({ where: { AND: and }, include, orderBy });
    return this.present(rows, locale);
  }

  async get(id: string, locale: string): Promise<AgentDto> {
    return (await this.present([await this.rowOrNotFound(id)], locale, { productIds: true }))[0]!;
  }

  // --- versions (AGT-03) ------------------------------------------------------------------------------------------------------
  private async emit(tx: Tx, a: Pick<Agent, 'id' | 'workspaceId' | 'status' | 'pausedReason' | 'version'>, o: { deleted?: boolean } = {}) {
    await this.insights.emitAgent(tx, a, o);
  }

  /** Snapshot of the agent as a new version (every save, activation, restore, insight, preset update). */
  async recordVersion(tx: Tx, agentId: string, source: AgentVersionSource, o: { note?: string | null; restoredFromVersion?: number | null; userId?: string | null } = {}): Promise<number> {
    const a = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    const products = await tx.agentProduct.findMany({ where: { agentId }, select: { productId: true } });
    const version = a.currentVersion + 1;
    const createdById = o.userId ?? TenantContext.get().userId ?? (await tx.membership.findFirst({ where: { workspaceId: a.workspaceId, role: 'owner' }, select: { userId: true } }))?.userId;
    if (!createdById) return a.currentVersion;
    await tx.agentVersion.create({ data: { workspaceId: a.workspaceId, agentId, version, snapshot: snapshotOf(a, products.map((p) => p.productId)) as Prisma.InputJsonValue, note: o.note ?? null, createdById, source, restoredFromVersion: o.restoredFromVersion ?? null } });
    await tx.agent.update({ where: { id: agentId }, data: { currentVersion: version } });
    await this.outbox.ws(tx, `ws:${a.workspaceId}`, 'agent.version_created', { id: agentId, agentId, version }, `agent.version_created:${agentId}:${version}`);
    return version;
  }

  async versions(id: string): Promise<AgentVersionDto[]> {
    const a = await this.rowOrNotFound(id);
    const rows = await prisma.agentVersion.findMany({ where: { agentId: id }, orderBy: { version: 'desc' }, include: { createdBy: userRef } });
    return rows.map((v) => ({ version: v.version, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, note: v.note, source: v.source, isCurrent: v.version === a.currentVersion, restoredFromVersion: v.restoredFromVersion }));
  }

  private async versionRow(id: string, version: number) {
    await this.rowOrNotFound(id);
    const v = await prisma.agentVersion.findUnique({ where: { agentId_version: { agentId: id, version } }, include: { createdBy: userRef } });
    if (!v) throw new AppException('AGENT_VERSION_NOT_FOUND');
    return v;
  }

  async version(id: string, version: number): Promise<AgentVersionDetailDto> {
    const a = await this.rowOrNotFound(id);
    const v = await this.versionRow(id, version);
    return { version: v.version, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, note: v.note, source: v.source, isCurrent: v.version === a.currentVersion, restoredFromVersion: v.restoredFromVersion, snapshot: v.snapshot as Record<string, unknown> };
  }

  async versionDiff(id: string, version: number, against?: number): Promise<AgentVersionDiffDto> {
    const a = await this.rowOrNotFound(id);
    const other = against ?? a.currentVersion;
    const [v, b] = await Promise.all([this.versionRow(id, version), this.versionRow(id, other)]);
    return { version, against: other, changes: diffSnapshots(v.snapshot as Record<string, unknown>, b.snapshot as Record<string, unknown>) };
  }

  /** `POST /agents/:id/versions/:v/restore` — the snapshot becomes the configuration again, as a new version. */
  async restore(id: string, version: number, locale: string): Promise<AgentDto> {
    const v = await this.versionRow(id, version);
    const snapshot = v.snapshot as AgentSnapshot;
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const data = snapshotToData(snapshot);
      const merged = { ...(await tx.agent.findUniqueOrThrow({ where: { id } })), ...(data as object) } as Agent;
      const updated = await tx.agent.update({ where: { id }, data: { ...data, customInstructions: compileInstructions(merged, snapshot.customInstructions ?? ''), modelId: await this.routing.agentModelId(), version: { increment: 1 } } });
      if (Array.isArray(snapshot.productIds)) await this.setProducts(tx, id, snapshot.productIds);
      await this.recordVersion(tx, id, 'restore', { restoredFromVersion: version, note: null });
      await this.emit(tx, updated);
    });
    return this.get(id, locale);
  }

  // --- writes -----------------------------------------------------------------------------------------------------------------
  private async setProducts(tx: Tx, agentId: string, productIds: string[]) {
    const valid = await tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null }, select: { id: true } });
    await tx.agentProduct.deleteMany({ where: { agentId, productId: { notIn: valid.map((p) => p.id) } } });
    await tx.agentProduct.createMany({ data: valid.map((p) => ({ agentId, productId: p.id })), skipDuplicates: true });
  }

  /** One channel → at most one agent (AGT-05). A channel of another agent needs `move`, else 409 with that agent's name. */
  async setChannels(tx: Tx, agent: Pick<Agent, 'id'>, channelIds: string[], move: boolean) {
    const wanted = [...new Set(channelIds)];
    const channels = await tx.channel.findMany({ where: { id: { in: wanted }, status: { not: 'disconnected' } } });
    if (channels.length !== wanted.length) throw validationError({ channelIds: 'validation.id' });
    const links = await tx.agentChannel.findMany({ where: { channelId: { in: wanted } }, include: { agent: { select: { id: true, name: true } } } });
    const foreign = links.filter((l) => l.agentId !== agent.id);
    if (foreign.length && !move) throw new AppException('AGENT_PAGE_ALREADY_ASSIGNED', { agentName: foreign[0]!.agent.name }, {}, { channels: foreign.map((l) => ({ channelId: l.channelId, agent: l.agent })) });
    const before = await tx.agentChannel.findMany({ where: { agentId: agent.id }, select: { channelId: true } });
    await tx.agentChannel.deleteMany({ where: { OR: [{ agentId: agent.id, channelId: { notIn: wanted } }, { channelId: { in: foreign.map((l) => l.channelId) } }] } });
    await tx.agentChannel.createMany({ data: wanted.map((channelId) => ({ agentId: agent.id, channelId })), skipDuplicates: true });
    const touched = new Set([...wanted, ...before.map((b) => b.channelId)]);
    for (const c of await tx.channel.findMany({ where: { id: { in: [...touched] } } })) await this.channelEvents.changed(tx, c);
  }

  private wizardData(w: AgentWizardInput, current?: Agent): Prisma.AgentUncheckedUpdateInput {
    const data: Prisma.AgentUncheckedUpdateInput = {};
    const scalar = ['displayName', 'avatarMode', 'avatarUploadId', 'languages', 'defaultLanguage', 'tone', 'formality', 'emojiLevel', 'catalogScope', 'scopeCategoryIds', 'outOfStockBehavior', 'showMissingVariants', 'maxQtyPerOrder', 'maxAmountPerOrder', 'riskyClientBehavior', 'recapMode', 'handoffKeywords'] as const;
    for (const k of scalar) if (w[k] !== undefined) (data as Record<string, unknown>)[k] = w[k];
    if (w.policies !== undefined) data.policies = w.policies as Prisma.InputJsonValue;
    if (w.orderFields !== undefined) data.orderFields = normalizeOrderFields(w.orderFields) as unknown as Prisma.InputJsonValue;
    if (w.handoffRules !== undefined) data.handoffRules = normalizeHandoffRules(w.handoffRules) as unknown as Prisma.InputJsonValue;
    if (w.businessHours !== undefined) data.businessHours = w.businessHours === null ? Prisma.DbNull : (w.businessHours as Prisma.InputJsonValue);
    if (w.capabilities !== undefined) {
      data.capabilities = w.capabilities as Prisma.InputJsonValue;
      // the two toggles of AGT-06 are columns: the capability switches and the columns always agree
      data.imageRecognition = w.capabilities.imageRecognition;
      data.voiceTranscription = w.capabilities.voiceTranscription;
    }
    if (w.defaultLanguage && (w.languages ?? current?.languages ?? []).length && !(w.languages ?? current?.languages ?? []).includes(w.defaultLanguage)) throw validationError({ 'wizard.defaultLanguage': 'validation.invalid' });
    return data;
  }

  private async assertRefs(tx: Tx, w: AgentWizardInput | undefined) {
    if (w?.scopeCategoryIds?.length) {
      const n = await tx.category.count({ where: { id: { in: w.scopeCategoryIds }, deletedAt: null } });
      if (n !== new Set(w.scopeCategoryIds).size) throw validationError({ 'wizard.scopeCategoryIds': 'validation.id' });
    }
    if (w?.avatarUploadId) {
      const u = await tx.upload.findFirst({ where: { id: w.avatarUploadId, workspaceId: TenantContext.workspaceId() }, select: { id: true } });
      if (!u) throw validationError({ 'wizard.avatarUploadId': 'validation.id' });
    }
  }

  /** `POST /agents` — a draft from one of the presets or from scratch. Drafts never count toward `maxAgents` (D67). */
  async create(input: CreateAgentInput, locale: string): Promise<AgentDto> {
    const t = TenantContext.get();
    const modelId = await this.routing.agentModelId();
    let preset: (AgentPresetDto & { id: string }) | null = null;
    if (input.presetKey) {
      const p = await prisma.agentPreset.findFirst({ where: { key: input.presetKey }, include: { versions: { where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1 } } });
      if (!p || !p.versions[0]) throw notFound();
      if (p.status === 'archived' || p.archivedAt) throw new AppException('PRESET_ARCHIVED');
      preset = { ...this.presetView(p, p.versions[0], locale), id: p.id };
    }
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertRefs(tx, input.wizard);
      const wizard = this.wizardData(input.wizard ?? {});
      const style = { languages: input.wizard?.languages ?? [], defaultLanguage: input.wizard?.defaultLanguage ?? null, tone: input.wizard?.tone ?? null, formality: input.wizard?.formality ?? null, emojiLevel: input.wizard?.emojiLevel ?? null };
      const imageRecognition = input.wizard?.capabilities?.imageRecognition ?? preset?.imageRecognition ?? true;
      const voiceTranscription = input.wizard?.capabilities?.voiceTranscription ?? preset?.voiceTranscription ?? true;
      const agent = await tx.agent.create({
        data: {
          workspaceId: t.workspaceId,
          name: input.name ?? preset?.name ?? this.i18n.t(locale, agentTextKey('defaultName')),
          description: input.description ?? null,
          personality: preset?.personality ?? 'friendly',
          temperature: preset?.temperature ?? 0.6,
          maxTokens: preset?.maxTokens ?? 1200,
          responseDelaySec: preset?.responseDelaySec ?? 3,
          presetId: preset?.id ?? null,
          presetVersion: preset?.version ?? null,
          modelId,
          status: 'draft',
          isActive: false,
          wizardStep: 1,
          orderFields: DEFAULT_ORDER_FIELDS as unknown as Prisma.InputJsonValue,
          handoffRules: DEFAULT_HANDOFF_RULES as unknown as Prisma.InputJsonValue,
          riskyClientBehavior: 'take_and_flag',
          recapMode: 'always',
          avatarMode: 'initials',
          ...(wizard as object),
          capabilities: { ...DEFAULT_CAPABILITIES, ...(input.wizard?.capabilities ?? {}), imageRecognition, voiceTranscription } as Prisma.InputJsonValue,
          imageRecognition,
          voiceTranscription,
          customInstructions: compileInstructions(style, preset?.instructions ?? ''),
        },
      });
      await this.recordVersion(tx, agent.id, 'wizard', { note: preset ? `preset:${preset.key}` : null });
      await this.emit(tx, agent);
      return agent.id;
    });
    return this.get(id, locale);
  }

  /**
   * `PATCH /agents/:id` — a wizard step or a Configuration save. Optimistic lock on `version`
   * (409 CONFLICT { changedBy, changedAt, current } so the form can merge by section).
   */
  async update(id: string, input: UpdateAgentInput, locale: string): Promise<AgentDto> {
    const { version, wizard, channelIds, productIds, step, note, move, customInstructions, ...fields } = input;
    const before = await this.rowOrNotFound(id);
    const stale = async () => {
      const last = await prisma.agentVersion.findFirst({ where: { agentId: id }, orderBy: { version: 'desc' }, include: { createdBy: userRef } });
      return conflict({ changedBy: last?.createdBy ?? null, changedAt: (await this.rowOrNotFound(id)).updatedAt.toISOString(), current: await this.get(id, locale) });
    };
    if (version !== before.version) throw await stale();
    if (customInstructions !== undefined && customInstructions.length > AGENT_INSTRUCTIONS_MAX) throw validationError({ customInstructions: 'validation.length' });
    const modelId = await this.routing.agentModelId();
    const ok = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertRefs(tx, wizard);
      const data: Prisma.AgentUncheckedUpdateInput = { ...fields, ...this.wizardData(wizard ?? {}, before) };
      // the columns are the truth for the two toggles when they are sent on their own (AGT-06)
      if (!wizard?.capabilities && (fields.imageRecognition !== undefined || fields.voiceTranscription !== undefined)) {
        data.capabilities = { ...DEFAULT_CAPABILITIES, ...((before.capabilities as object | null) ?? {}), imageRecognition: fields.imageRecognition ?? before.imageRecognition, voiceTranscription: fields.voiceTranscription ?? before.voiceTranscription } as Prisma.InputJsonValue;
      }
      const merged = { ...before, ...(data as object) } as Agent;
      data.customInstructions = compileInstructions(merged, customInstructions ?? merchantInstructions(before.customInstructions));
      if (step && before.status === 'draft') data.wizardStep = Math.max(before.wizardStep ?? 1, step);
      const r = await tx.agent.updateMany({ where: { id, version, deletedAt: null }, data: { ...(data as Prisma.AgentUncheckedUpdateManyInput), modelId, version: { increment: 1 } } });
      if (!r.count) return false;
      if (channelIds) await this.setChannels(tx, before, channelIds, move === true);
      if (productIds) await this.setProducts(tx, id, productIds);
      await this.recordVersion(tx, id, before.status === 'draft' ? 'wizard' : 'manual', { note: note ?? null });
      const saved = await tx.agent.findUniqueOrThrow({ where: { id } });
      await this.moderation.submitAgentPrompt(tx, id, saved.customInstructions); // MOD-08 (M10)
      await this.emit(tx, saved);
      return true;
    });
    if (!ok) throw await stale();
    return this.get(id, locale);
  }

  /** Agents holding a plan slot (same filter as `assertSlot`, without the lock). */
  private slotHolders() {
    return prisma.agent.count({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] } });
  }

  /** D67 / 04 §18: the plan limit counts agents `active` or `paused`; `-1` = unlimited. */
  private async assertSlot(tx: Tx, agentId: string) {
    const t = TenantContext.get();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${t.workspaceId} || ':agents-limit', 0))`;
    const limit = t.limits.maxAgents;
    if (limit < 0) return;
    // agents paused by the plan (02 §5 expiry / downgrade) do not hold a slot: they come back with LimitService.apply
    const current = await tx.agent.count({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, id: { not: agentId }, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] } });
    if (current >= limit) throw new AppException('PLAN_LIMIT', { resource: 'agents', limit, current });
  }

  /** `POST /agents/:id/activate { at? }`. */
  async activate(id: string, at: string | undefined, locale: string): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    if (a.status === 'active') return this.get(id, locale);
    const missing: string[] = [];
    if (!a.name.trim()) missing.push('name');
    if (missing.length) throw new AppException('AGENT_DRAFT_INCOMPLETE', { 'missing[]': missing.join(', ') }, {}, { missing });
    if (!a.channels.length) throw new AppException('AGENT_NO_CHANNEL');
    const when = at ? new Date(at) : null;
    const modelId = await this.routing.agentModelId();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertSlot(tx, id);
      if (when && when.getTime() > Date.now() + 30_000) {
        await tx.agent.update({ where: { id }, data: { scheduledActivateAt: when, version: { increment: 1 } } });
        await this.emit(tx, await tx.agent.findUniqueOrThrow({ where: { id } }));
        return;
      }
      const updated = await tx.agent.update({ where: { id }, data: { status: 'active', isActive: true, pausedReason: null, scheduledActivateAt: null, wizardStep: null, modelId, version: { increment: 1 } } });
      await this.recordVersion(tx, id, 'wizard', { note: 'activation' });
      await this.emit(tx, updated);
      for (const c of a.channels) await this.channelEvents.changed(tx, c.channel);
    });
    return this.get(id, locale);
  }

  /**
   * `DELETE /agents/:id/activate` — cancels a scheduled activation ("Annuler la programmation", AGT-02 step 5): the
   * draft stays a draft. Idempotent (no schedule ⇒ unchanged); an agent that is no longer a draft ⇒ `409 CONFLICT`.
   */
  async unschedule(id: string, locale: string): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    if (a.status !== 'draft') throw new AppException('CONFLICT');
    if (!a.scheduledActivateAt) return this.get(id, locale);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const updated = await tx.agent.update({ where: { id }, data: { scheduledActivateAt: null, version: { increment: 1 } } });
      await this.emit(tx, updated);
    });
    return this.get(id, locale);
  }

  /** `sched-agent-activation`: drafts whose scheduled time has come. A refusal (plan limit, no channel) clears the schedule. */
  async activateScheduled(now = new Date()): Promise<number> {
    const due = await TenantContext.runSystem(() => prisma.agent.findMany({ where: { status: 'draft', deletedAt: null, scheduledActivateAt: { lte: now } }, select: { id: true, workspaceId: true } }));
    let n = 0;
    for (const a of due) {
      // the plan limits of the workspace apply exactly as for an immediate activation
      const tenant = await this.tenants.forWorker(a.workspaceId).catch(() => null);
      if (!tenant) continue;
      await TenantContext.run({ ...tenant, emailVerified: true }, async () => {
        try {
          await this.activate(a.id, undefined, tenant.locale);
          n++;
        } catch (e) {
          if (!(e instanceof AppException)) throw e;
          await prisma.agent.update({ where: { id: a.id }, data: { scheduledActivateAt: null } });
        }
      });
    }
    return n;
  }

  /** `sched-preset-updates`: one `agent.preset_update_available` per (agent, preset version); applied with `POST /agents/:id/apply-preset-update`. */
  async announcePresetUpdates(): Promise<number> {
    return TenantContext.runSystem(async () => {
      const agents = await prisma.agent.findMany({ where: { deletedAt: null, status: { in: ['active', 'paused'] }, presetId: { not: null }, presetVersion: { not: null } }, select: { id: true, name: true, workspaceId: true, presetVersion: true, preset: { select: { currentVersion: true, status: true, archivedAt: true } } } });
      let n = 0;
      for (const a of agents) {
        if (!a.preset || a.preset.archivedAt || a.preset.status !== 'published' || a.preset.currentVersion <= (a.presetVersion ?? 0)) continue;
        await prisma.$transaction((db) => this.notifications.emit(db as Tx, { type: 'agent_preset_update_available', workspaceId: a.workspaceId, target: { roles: ['owner', 'admin'] }, key: `agent_preset_update_available:${a.id}:${a.preset!.currentVersion}`, data: { agentId: a.id, agent: a.name, presetVersion: a.preset!.currentVersion } }));
        n++;
      }
      return n;
    });
  }

  /** Conversations the agent is answering right now (customer wrote in the last 24 h, AI not paused). */
  private openThreadsWhere(channelIds: string[], now = new Date()): Prisma.ConversationWhereInput {
    return { channelId: { in: channelIds }, status: 'active', aiPaused: false, deletedAt: null, lastCustomerMessageAt: { gte: new Date(now.getTime() - DAY) } };
  }
  private openThreads(channelIds: string[]) {
    return prisma.conversation.count({ where: this.openThreadsWhere(channelIds) });
  }

  /**
   * `POST /agents/:id/pause { confirm?, sendOutOfHours? }` — 409 AGENT_PAUSED_WITH_OPEN_THREADS { count } until `confirm`.
   * 04 §18 / AGV-07 / AT-AGV-08: on confirm the conversations awaiting a reply go to « À traiter » (`needs_human`, AI
   * paused, reason `manual`); with `sendOutOfHours` each of them (blocked customers excepted) receives the workspace
   * `out_of_hours` system message once, through the outbound path (outbox `meta-send`), in the same transaction.
   */
  async pause(id: string, confirm: boolean, locale: string, o: { sendOutOfHours?: boolean } = {}): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    if (a.status === 'paused') return this.get(id, locale);
    if (a.status !== 'active') throw conflict({ reason: 'AGENT_NOT_ACTIVE' });
    const channelIds = a.channels.map((c) => c.channelId);
    const open = await this.openThreads(channelIds);
    if (open > 0 && !confirm) throw new AppException('AGENT_PAUSED_WITH_OPEN_THREADS', { count: open });
    const index = o.sendOutOfHours && open > 0 ? await this.safety.index() : null;
    const userId = TenantContext.get().userId ?? null;
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const updated = await tx.agent.update({ where: { id }, data: { status: 'paused', isActive: false, pausedReason: 'manual', version: { increment: 1 } } });
      await this.emit(tx, updated);
      if (!open) return;
      const threads = await tx.conversation.findMany({ where: this.openThreadsWhere(channelIds), include: { client: { select: { phone: true } } } });
      for (const c of threads) {
        const handoffAt = new Date().toISOString();
        const moved = await tx.conversation.update({
          where: { id: c.id },
          data: { status: 'needs_human', aiPaused: true, version: { increment: 1 }, context: { ...contextOf(c), handoffAt, handoffReason: 'manual', handoffRemindedAt: null, aiPausedById: userId } as Prisma.InputJsonValue },
        });
        await this.conversations.emitUpdated(tx, moved);
        // once per thread (and never twice in 24 h if the AI already sent it outside the business hours)
        if (index && !index.has(c, c.client?.phone)) await this.outbound.sendSystemText(c.id, 'out_of_hours', {}, { tx, kind: 'system', oncePer24h: true });
      }
    });
    return this.get(id, locale);
  }

  async resume(id: string, locale: string): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    if (a.status === 'active') return this.get(id, locale);
    if (a.status !== 'paused') throw conflict({ reason: 'AGENT_NOT_PAUSED' });
    const modelId = await this.routing.agentModelId();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      // an agent paused by the plan gives its slot back to the count: it must fit again
      if (a.pausedReason === 'plan') await this.assertSlot(tx, id);
      const updated = await tx.agent.update({ where: { id }, data: { status: 'active', isActive: true, pausedReason: null, modelId, version: { increment: 1 } } });
      await this.emit(tx, updated);
    });
    return this.get(id, locale);
  }

  /** `POST /agents/:id/duplicate` — a draft copy: same configuration, FAQ and product selection, no channel. */
  async duplicate(id: string, locale: string): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    const copyId = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const src = await tx.agent.findUniqueOrThrow({ where: { id } });
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, lastActiveAt: _l, scheduledActivateAt: _s, currentVersion: _cv, version: _v, policies, capabilities, orderFields, handoffRules, businessHours, ...rest } = src;
      const json = (v: Prisma.JsonValue | null) => (v === null ? undefined : (v as Prisma.InputJsonValue));
      const copy = await tx.agent.create({
        data: { ...rest, name: `${a.name} ${this.i18n.t(locale, agentTextKey('copySuffix'))}`.slice(0, 100), status: 'draft', isActive: false, pausedReason: null, wizardStep: 1, policies: json(policies), capabilities: json(capabilities), orderFields: json(orderFields), handoffRules: json(handoffRules), businessHours: json(businessHours) },
      });
      const [faqs, products] = await Promise.all([tx.agentFaq.findMany({ where: { agentId: id, source: { not: 'ai_suggested' } } }), tx.agentProduct.findMany({ where: { agentId: id } })]);
      if (faqs.length) await tx.agentFaq.createMany({ data: faqs.map((f) => ({ workspaceId: f.workspaceId, agentId: copy.id, question: f.question, answer: f.answer, source: f.source, sortOrder: f.sortOrder, isActive: f.isActive })) });
      if (products.length) await tx.agentProduct.createMany({ data: products.map((p) => ({ agentId: copy.id, productId: p.productId })) });
      await this.recordVersion(tx, copy.id, 'manual', { note: `duplicate:${id}` });
      await this.emit(tx, copy);
      return copy.id;
    });
    return this.get(copyId, locale);
  }

  /**
   * `DELETE /agents/:id` (AGT-04): soft delete; its channels are unlinked, pending insights are closed as `dismissed`,
   * open `needs_human` conversations stay where they are.
   */
  async remove(id: string, tx0?: Tx): Promise<void> {
    const run = async (tx: Tx) => {
      const a = await tx.agent.findFirst({ where: { id, deletedAt: null }, include: { channels: { include: { channel: true } } } });
      if (!a) throw notFound();
      await tx.agentChannel.deleteMany({ where: { agentId: id } });
      await tx.agentInsight.updateMany({ where: { agentId: id, status: 'pending' }, data: { status: 'dismissed', resolvedAt: new Date(), resolvedById: TenantContext.get().userId ?? null } });
      await tx.agentProduct.deleteMany({ where: { agentId: id } });
      const updated = await tx.agent.update({ where: { id }, data: { deletedAt: new Date(), status: 'paused', isActive: false, scheduledActivateAt: null, version: { increment: 1 } } });
      await this.emit(tx, updated, { deleted: true });
      for (const c of a.channels) await this.channelEvents.changed(tx, c.channel);
    };
    return tx0 ? run(tx0) : prisma.$transaction((db) => run(db as Tx));
  }

  /** `POST /agents/bulk/{pause|resume|delete}` — per-item results, same rules as the single endpoints. */
  async bulk(action: 'pause' | 'resume' | 'delete', ids: string[], confirm: boolean, ctx: { locale: string; ref: string }): Promise<{ results: BulkResult[] }> {
    const results: BulkResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        if (action === 'pause') await this.pause(id, confirm, ctx.locale);
        else if (action === 'resume') await this.resume(id, ctx.locale);
        else {
          const a = await this.rowOrNotFound(id);
          // the bulk delete never unlinks pages silently
          if (a.channels.length) throw new AppException('AGENT_HAS_CHANNELS', { count: a.channels.length });
          await this.remove(id);
        }
        results.push({ id, ok: true });
      } catch (e) {
        if (!(e instanceof AppException)) throw e;
        results.push({ id, ok: false, error: { code: e.code, message: this.i18n.t(ctx.locale, `error.${e.code}`, e.params), params: e.params, ref: ctx.ref } });
      }
    }
    return { results };
  }

  /**
   * `POST /agents/:id/apply-preset-update { presetVersion }` (D53): preset parameters refreshed, the merchant's instructions
   * kept — empty ones take the preset's (agents created while a non-French preset text was blank, UX-008).
   */
  async applyPresetUpdate(id: string, presetVersion: number, locale: string): Promise<AgentDto> {
    const a = await this.rowOrNotFound(id);
    if (!a.presetId) throw conflict({ reason: 'NO_PRESET' });
    const v = await prisma.agentPresetVersion.findFirst({ where: { presetId: a.presetId, version: presetVersion, status: 'published' }, include: { preset: true } });
    if (!v) throw notFound();
    if (v.preset.archivedAt) throw new AppException('PRESET_ARCHIVED');
    const p = this.presetView(v.preset, v, locale);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const own = merchantInstructions(a.customInstructions).trim();
      const updated = await tx.agent.update({ where: { id }, data: { personality: p.personality, temperature: p.temperature, maxTokens: p.maxTokens, presetVersion, ...(own || !p.instructions ? {} : { customInstructions: compileInstructions(a, p.instructions) }), modelId: await this.routing.agentModelId(), version: { increment: 1 } } });
      await this.recordVersion(tx, id, 'preset_update', { note: `preset v${presetVersion}` });
      await this.emit(tx, updated);
    });
    return this.get(id, locale);
  }

  /** `GET /agents/:id/export` — the configuration as JSON (no secret, no id of another workspace's data). */
  async export(id: string, locale: string) {
    const dto = await this.get(id, locale);
    const faqs = await prisma.agentFaq.findMany({ where: { agentId: id, source: { not: 'ai_suggested' } }, orderBy: { sortOrder: 'asc' }, select: { question: true, answer: true, source: true, isActive: true } });
    const { metrics30d: _m, actions: _a, pendingInsights: _p, ...config } = dto;
    return { exportedAt: new Date().toISOString(), agent: config, faqs };
  }

  // --- readiness (AGT-02 step 5) -------------------------------------------------------------------------------------------------
  async readiness(id: string, locale: string): Promise<AgentReadinessDto> {
    const a = await this.rowOrNotFound(id);
    const t = TenantContext.get();
    const scope = this.catalogue.scopeWhere(a);
    const [products, withoutPhoto, fees, pendingModeration, balance, user] = await Promise.all([
      prisma.product.count({ where: scope }),
      prisma.product.count({ where: { AND: [scope, { images: { none: {} } }] } }),
      prisma.deliveryFeeRule.count({ where: { isActive: true } }),
      prisma.product.count({ where: { deletedAt: null, isActive: true, moderationStatus: 'pending', ...(a.sellAllProducts ? {} : { agentProducts: { some: { agentId: id } } }) } }),
      this.credits.balance(t.workspaceId),
      t.userId ? prisma.user.findUnique({ where: { id: t.userId }, select: { emailVerifiedAt: true } }) : null,
    ]);
    const policies = (a.policies ?? {}) as Record<string, string>;
    const label = (key: string) => this.i18n.t(locale, agentTextKey(`readiness.${key}`));
    const checks: AgentReadinessDto['checks'] = [
      { key: 'catalog', ok: products > 0, label: label('catalog'), count: products, link: '/products', blocking: false },
      { key: 'productsWithoutPhoto', ok: withoutPhoto === 0, label: label('productsWithoutPhoto'), count: withoutPhoto, link: '/products', blocking: false },
      { key: 'feeGrid', ok: fees > 0, label: label('feeGrid'), count: fees, link: '/delivery/fees', blocking: false },
      { key: 'policies', ok: ['delivery', 'payment', 'returns'].every((k) => (policies[k] ?? '').trim().length > 0), label: label('policies'), blocking: false },
      { key: 'channels', ok: a.channels.length > 0, label: label('channels'), count: a.channels.length, link: '/channels', blocking: true },
      { key: 'emailVerified', ok: !!user?.emailVerifiedAt, label: label('emailVerified'), link: '/settings/security', blocking: true },
      { key: 'credits', ok: !balance.exhausted, label: label('credits'), count: balance.unlimited ? -1 : balance.total, link: '/settings/credits', blocking: false },
      { key: 'pendingModeration', ok: pendingModeration === 0, label: label('pendingModeration'), count: pendingModeration, link: '/products?moderationStatus=pending', blocking: false },
    ];
    return { ready: checks.filter((c) => c.blocking).every((c) => c.ok), checks };
  }

  // --- metrics (AGT-09) ------------------------------------------------------------------------------------------------------------
  async metrics(id: string, q: { from?: string; to?: string }): Promise<AgentMetricsDto> {
    const a = await this.rowOrNotFound(id);
    const to = q.to ? algiersDayEnd(q.to) : new Date();
    const from = q.from ? algiersDayStart(q.from) : new Date(to.getTime() - 30 * DAY);
    if (from >= to) throw validationError({ from: 'validation.date' });
    const m = (await this.metricsOf([id], from, to)).get(id)!;
    return { ...m, from: from.toISOString(), to: to.toISOString(), resolutionRate: m.conversations ? Math.round((m.handledWithoutHuman / m.conversations) * 100) : 0, lastActiveAt: a.lastActiveAt?.toISOString() ?? null };
  }
}
