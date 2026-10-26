// ADM-02 workspaces (Figma ADM-02 list + detail sheet, DLG Platform admin): filters, detail, suspend / reactivate,
// change plan, extend trial, create for a client, schedule / cancel deletion, force-release a channel (AT-CHN-08).
// Reads run in the platform (bypass) tenant scope; writes on a workspace run in `TenantContext.runAs(workspaceId)`.
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  ActionDescriptor,
  AdminChangePlanInput,
  AdminChannelRowDto,
  AdminCreateWorkspaceInput,
  AdminCreditRowDto,
  AdminExtendInput,
  AdminPatchWorkspaceInput,
  AdminScheduleDeletionInput,
  AdminSuspendInput,
  AdminWorkspaceAgentDto,
  AdminWorkspaceChannelDto,
  AdminWorkspaceDetailDto,
  AdminWorkspaceMemberDto,
  AdminWorkspaceRowDto,
  AdminWorkspacesQuery,
} from '@djaber/shared';
import { Prisma, prisma, TenantContext, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { OutboxService } from '../../core/outbox/outbox.service';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { algiersDay } from '../../core/time/algiers';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { EmailTokenService } from '../auth/email-token.service';
import { CURRENT_STATUSES, addCycle, lockBilling, priceOf } from '../billing/billing.util';
import { LimitService } from '../billing/limit.service';
import { SubscriptionService } from '../billing/subscription.service';
import { ChannelService } from '../channels/channel.service';
import { CreditService } from '../credits/credit.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { ProvisioningService } from '../workspace/provisioning.service';
import { DAY, assertUuid, iso, freePlanName, pickLocal, requireReason, userSelect, type AdminActor } from './admin.util';

const ROW_SORTS = ['createdAt', 'name'] as const;
type CreditFig = { planNet: number; planLimit: number; planUsed: number; pack: number };

@Injectable()
export class AdminWorkspacesService {
  constructor(
    private readonly audit: AuditService,
    private readonly tenants: TenantResolver,
    private readonly outbox: OutboxService,
    private readonly queue: QueueOutbox,
    private readonly mail: MailOutbox,
    private readonly config: ConfigService,
    private readonly notifications: NotificationProducer,
    private readonly provisioning: ProvisioningService,
    private readonly subs: SubscriptionService,
    private readonly limits: LimitService,
    private readonly credits: CreditService,
    private readonly channels: ChannelService,
    private readonly emailTokens: EmailTokenService,
  ) {}

  // --- figures -------------------------------------------------------------------------------------------------------------
  /** Plan credits of the current period (latest plan credit period) + pack balance, per workspace. */
  async creditFigures(ids: string[] | null): Promise<Map<string, CreditFig>> {
    const filter = ids ? Prisma.sql`AND l."workspaceId" IN (${ids.length ? Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`)) : Prisma.sql`NULL`})` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ workspaceId: string; planNet: bigint | null; planLimit: bigint | null; planUsed: bigint | null; pack: bigint | null }[]>`
      WITH p AS (SELECT "workspaceId", max("periodStart") AS ps FROM "CreditLedger" l WHERE "bucket" = 'plan' AND "kind" = 'credit' ${filter} GROUP BY "workspaceId")
      SELECT l."workspaceId",
        sum(l."credits") FILTER (WHERE l."bucket" = 'plan' AND l."periodStart" = p.ps) AS "planNet",
        sum(l."credits") FILTER (WHERE l."bucket" = 'plan' AND l."periodStart" = p.ps AND l."kind" = 'credit') AS "planLimit",
        -sum(l."credits") FILTER (WHERE l."bucket" = 'plan' AND l."periodStart" = p.ps AND l."kind" = 'debit') AS "planUsed",
        sum(l."credits") FILTER (WHERE l."bucket" = 'pack') AS "pack"
      FROM "CreditLedger" l JOIN p ON p."workspaceId" = l."workspaceId" WHERE true ${filter}
      GROUP BY l."workspaceId"`;
    return new Map(rows.map((r) => [r.workspaceId, { planNet: Number(r.planNet ?? 0), planLimit: Number(r.planLimit ?? 0), planUsed: Number(r.planUsed ?? 0), pack: Number(r.pack ?? 0) }]));
  }

  private async idsMatchingCounts(q: AdminWorkspacesQuery): Promise<string[] | null> {
    const conds: Prisma.Sql[] = [];
    const between = (expr: Prisma.Sql, min?: number, max?: number) => {
      if (min !== undefined) conds.push(Prisma.sql`(${expr}) >= ${min}`);
      if (max !== undefined) conds.push(Prisma.sql`(${expr}) <= ${max}`);
    };
    between(Prisma.sql`SELECT count(*) FROM "Channel" c WHERE c."workspaceId" = w.id AND c."status" <> 'disconnected' AND c."parentChannelId" IS NULL`, q.minPages, q.maxPages);
    between(Prisma.sql`SELECT count(*) FROM "Product" p WHERE p."workspaceId" = w.id AND p."deletedAt" IS NULL`, q.minProducts, q.maxProducts);
    // assumption M10: "revenue" = merchant sales of the last 30 days (delivered orders total)
    between(Prisma.sql`SELECT coalesce(sum(o."total"), 0) FROM "Order" o WHERE o."workspaceId" = w.id AND o."status" = 'delivered' AND o."createdAt" >= now() - interval '30 days'`, q.minRevenue, q.maxRevenue);
    if (q.inactiveDays) {
      conds.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "Conversation" c WHERE c."workspaceId" = w.id AND c."lastMessageAt" >= now() - make_interval(days => ${q.inactiveDays}))`);
      conds.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."workspaceId" = w.id AND o."createdAt" >= now() - make_interval(days => ${q.inactiveDays}))`);
    }
    if (!conds.length) return null;
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT w.id FROM "Workspace" w WHERE w."deletedAt" IS NULL AND ${Prisma.join(conds, ' AND ')}`;
    return rows.map((r) => r.id);
  }

  // --- list ----------------------------------------------------------------------------------------------------------------
  async list(q: AdminWorkspacesQuery, actor: AdminActor): Promise<Page<AdminWorkspaceRowDto>> {
    const and: Prisma.WorkspaceWhereInput[] = [{ deletedAt: null }];
    if (q.status?.length) and.push({ status: { in: q.status as never } });
    if (q.trustLevel?.length) and.push({ trustLevel: { in: q.trustLevel as never } });
    if (q.wilayaId) and.push({ senderWilayaId: q.wilayaId });
    if (q.createdFrom) and.push({ createdAt: { gte: new Date(`${q.createdFrom}T00:00:00+01:00`) } });
    if (q.createdTo) and.push({ createdAt: { lt: new Date(new Date(`${q.createdTo}T00:00:00+01:00`).getTime() + DAY) } });
    if (q.planSlug?.length) and.push({ subscriptions: { some: { status: { in: [...CURRENT_STATUSES] }, plan: { slug: { in: q.planSlug } } } } });
    if (q.subscriptionStatus?.length) {
      const current = q.subscriptionStatus.filter((s) => s !== 'expired');
      const or: Prisma.WorkspaceWhereInput[] = [];
      if (current.length) or.push({ subscriptions: { some: { status: { in: current as never } } } });
      // expired = the paid / trial subscription ended (the workspace runs on the free plan)
      if (q.subscriptionStatus.includes('expired')) or.push({ subscriptions: { some: { status: 'expired' } }, NOT: { subscriptions: { some: { status: { in: ['trial', 'dunning'] }, } } } });
      and.push({ OR: or });
    }
    if (q.withPages) and.push({ channels: { some: { status: { not: 'disconnected' }, parentChannelId: null } } });
    if (q.withAgents) and.push({ agents: { some: { status: 'active', deletedAt: null } } });
    if (q.q) {
      const s = q.q.trim();
      and.push({ OR: [{ name: { contains: s, mode: 'insensitive' } }, { slug: { contains: s, mode: 'insensitive' } }, { owner: { email: { contains: s, mode: 'insensitive' } } }, { owner: { firstName: { contains: s, mode: 'insensitive' } } }, { owner: { lastName: { contains: s, mode: 'insensitive' } } }, { channels: { some: { externalId: { startsWith: s } } } }, ...(/^[0-9a-f-]{36}$/i.test(s) ? [{ id: s }] : [])] });
    }
    const ids = await this.idsMatchingCounts(q);
    if (ids) and.push({ id: { in: ids } });
    if (q.credits) {
      const figs = await this.creditFigures(null);
      const match = [...figs.entries()].filter(([, f]) => {
        const total = f.planNet + f.pack;
        if (q.credits === 'exhausted') return f.planLimit >= 0 && total <= 0;
        return f.planLimit > 0 && total < f.planLimit * 0.2;
      });
      and.push({ id: { in: match.map(([id]) => id) } });
    }
    const where: Prisma.WorkspaceWhereInput = { AND: and };
    const sort = q.sort && ROW_SORTS.includes(q.sort.replace(/^-/, '') as never) ? q.sort : '-createdAt';
    const orderBy = [{ [sort.replace(/^-/, '')]: sort.startsWith('-') ? 'desc' : 'asc' }, { id: 'desc' as const }];
    const [total, rows] = await Promise.all([prisma.workspace.count({ where }), prisma.workspace.findMany({ where, orderBy: orderBy as never, ...toSkipTake(q), select: { id: true } })]);
    const dtos = await this.rows(rows.map((r) => r.id), actor);
    return page(dtos, total, q);
  }

  /** Row DTOs in the given order (a handful of grouped queries). */
  async rows(ids: string[], actor: AdminActor): Promise<AdminWorkspaceRowDto[]> {
    if (!ids.length) return [];
    const since = new Date(Date.now() - 30 * DAY);
    const idSql = Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
    const [wss, owners, subs, lastSubs, chans, figs, orders, convs, activity] = await Promise.all([
      prisma.workspace.findMany({ where: { id: { in: ids } } }),
      prisma.user.findMany({ where: { ownedWorkspaceId: { in: ids } }, select: { ...userSelect, ownedWorkspaceId: true, emailVerifiedAt: true, totpEnabled: true } }),
      prisma.subscription.findMany({ where: { workspaceId: { in: ids }, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      prisma.subscription.findMany({ where: { workspaceId: { in: ids }, NOT: { plan: { slug: 'free' } } }, orderBy: { createdAt: 'desc' }, select: { workspaceId: true, status: true } }),
      prisma.channel.findMany({ where: { workspaceId: { in: ids }, status: { not: 'disconnected' }, parentChannelId: null }, select: { workspaceId: true, platform: true } }),
      this.creditFigures(ids),
      prisma.order.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.conversation.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, lastMessageAt: { gte: since } }, _count: { _all: true } }),
      prisma.$queryRaw<{ workspaceId: string; at: Date | null }[]>`
        SELECT w.id AS "workspaceId", greatest((SELECT max(c."lastMessageAt") FROM "Conversation" c WHERE c."workspaceId" = w.id), (SELECT max(o."createdAt") FROM "Order" o WHERE o."workspaceId" = w.id), (SELECT max(u."lastLoginAt") FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE m."workspaceId" = w.id)) AS at
        FROM "Workspace" w WHERE w.id IN (${idSql})`,
    ]);
    const free = await prisma.plan.findUnique({ where: { slug: 'free' } });
    const byId = new Map(wss.map((w) => [w.id, w]));
    const out: AdminWorkspaceRowDto[] = [];
    for (const id of ids) {
      const w = byId.get(id);
      if (!w) continue;
      const owner = owners.find((o) => o.ownedWorkspaceId === id);
      const sub = subs.find((s) => s.workspaceId === id);
      const plan = sub?.plan ?? free;
      const lastPaid = lastSubs.find((s) => s.workspaceId === id);
      const subscriptionStatus = (sub && sub.plan.slug !== 'free' ? sub.status : lastPaid && lastPaid.status !== 'cancelled' ? 'expired' : sub?.status ?? 'expired') as AdminWorkspaceRowDto['subscriptionStatus'];
      const f = figs.get(id) ?? { planNet: 0, planLimit: plan?.monthlyCredits ?? 0, planUsed: 0, pack: 0 };
      const unlimited = (plan?.monthlyCredits ?? 0) < 0;
      const myChans = chans.filter((c) => c.workspaceId === id);
      out.push({
        id,
        name: w.name,
        owner: owner ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, email: owner.email, avatarUrl: owner.avatarUrl, emailVerified: !!owner.emailVerifiedAt, totpEnabled: owner.totpEnabled } : { id: '', firstName: '', lastName: '', email: '', avatarUrl: null, emailVerified: false, totpEnabled: false },
        plan: { slug: plan?.slug ?? 'free', name: plan ? pickLocal(plan.name) : freePlanName() },
        subscriptionStatus,
        status: w.status,
        trustLevel: w.trustLevel,
        credits: { used: f.planUsed, limit: unlimited ? -1 : f.planLimit, exhausted: !unlimited && f.planNet + f.pack <= 0 },
        pages: { count: myChans.length, platforms: [...new Set(myChans.map((c) => c.platform))] },
        orders30d: orders.find((o) => o.workspaceId === id)?._count._all ?? 0,
        conversations30d: convs.find((c) => c.workspaceId === id)?._count._all ?? 0,
        createdAt: w.createdAt.toISOString(),
        lastActivityAt: iso(activity.find((a) => a.workspaceId === id)?.at ?? null),
        actions: this.actions(w, sub?.status ?? null, actor),
      });
    }
    return out;
  }

  private actions(w: { status: string }, subStatus: string | null, actor: AdminActor): ActionDescriptor[] {
    const r = actor.platformRole;
    const a = (key: string, perm: Parameters<typeof canPlatform>[1], extra: { enabled?: boolean; reasonCode?: string } = {}): ActionDescriptor => {
      const allowed = canPlatform(r, perm);
      const enabled = allowed && extra.enabled !== false;
      return { key, enabled, ...(enabled ? {} : { reasonCode: !allowed ? 'FORBIDDEN' : extra.reasonCode }) };
    };
    const deleting = w.status === 'deletion_scheduled';
    return [
      { key: 'open', enabled: true, primary: true },
      a('impersonate', 'admin.workspaces.impersonate'),
      a('change_plan', 'admin.workspaces.write', { enabled: !deleting, reasonCode: 'WORKSPACE_DELETION_SCHEDULED' }),
      a('add_credits', 'admin.workspaces.credits', { enabled: !deleting, reasonCode: 'WORKSPACE_DELETION_SCHEDULED' }),
      a('remove_credits', 'admin.billing.write', { enabled: !deleting, reasonCode: 'WORKSPACE_DELETION_SCHEDULED' }),
      a('extend_trial', 'admin.workspaces.write', { enabled: !deleting && (subStatus === 'trial' || subStatus === 'active' || subStatus === 'dunning'), reasonCode: deleting ? 'WORKSPACE_DELETION_SCHEDULED' : 'CONFLICT' }),
      w.status === 'suspended' ? a('reactivate', 'admin.workspaces.write') : a('suspend', 'admin.workspaces.write', { enabled: !deleting, reasonCode: 'WORKSPACE_DELETION_SCHEDULED' }),
      deleting ? a('cancel_deletion', 'admin.workspaces.write') : a('schedule_deletion', 'admin.workspaces.write'),
    ];
  }

  // --- detail & sub-resources ----------------------------------------------------------------------------------------------
  private async wsOr404(id: string) {
    assertUuid(id);
    const w = await prisma.workspace.findFirst({ where: { id, deletedAt: null } });
    if (!w) throw notFound();
    return w;
  }

  async detail(id: string, actor: AdminActor): Promise<AdminWorkspaceDetailDto> {
    const w = await this.wsOr404(id);
    const [row] = await this.rows([id], actor);
    const [sub, wilaya, channels, agents, sheets, couriers, apiKeys, webhooks, webhooksOff, products, purchases, sales, members, grant, packsBought, lastWeb, lastMobile] = await Promise.all([
      prisma.subscription.findFirst({ where: { workspaceId: id, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      w.senderWilayaId ? prisma.wilaya.findUnique({ where: { id: w.senderWilayaId } }) : null,
      prisma.channel.findMany({ where: { workspaceId: id, status: { not: 'disconnected' } }, select: { id: true, name: true, platform: true, status: true }, orderBy: { createdAt: 'asc' } }),
      prisma.agent.findMany({ where: { workspaceId: id, deletedAt: null }, select: { id: true, name: true, status: true }, orderBy: { createdAt: 'asc' } }),
      prisma.sheetsConnection.findUnique({ where: { workspaceId: id } }),
      prisma.courierAccount.findMany({ where: { workspaceId: id }, select: { provider: true, isActive: true, lastTestOk: true } }),
      prisma.apiKey.count({ where: { workspaceId: id, revokedAt: null } }),
      prisma.webhookEndpoint.count({ where: { workspaceId: id } }),
      prisma.webhookEndpoint.count({ where: { workspaceId: id, isActive: false } }),
      prisma.product.count({ where: { workspaceId: id, deletedAt: null } }),
      prisma.purchase.count({ where: { workspaceId: id } }),
      prisma.sale.count({ where: { workspaceId: id } }),
      prisma.membership.count({ where: { workspaceId: id } }),
      prisma.creditLedger.findFirst({ where: { workspaceId: id, action: 'grant', grantedById: { not: null } }, orderBy: { createdAt: 'desc' } }),
      prisma.creditPackPurchase.count({ where: { workspaceId: id, status: 'credited' } }),
      prisma.user.findFirst({ where: { memberships: { some: { workspaceId: id } }, lastSeenPlatform: 'web' }, orderBy: { lastLoginAt: 'desc' }, select: { lastLoginAt: true } }),
      prisma.deviceToken.findFirst({ where: { user: { memberships: { some: { workspaceId: id } } } }, orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
    ]);
    const lastPay = sub ? await prisma.billingPayment.findFirst({ where: { workspaceId: id, status: 'paid' }, orderBy: { paidAt: 'desc' } }) : null;
    const f = (await this.creditFigures([id])).get(id);
    const limit = row!.credits.limit;
    return {
      ...row!,
      slug: w.slug,
      wilaya: wilaya?.nameFr ?? null,
      stockMode: w.stockMode,
      suspendedAt: iso(w.suspendedAt),
      suspendReason: w.suspendReason,
      suspendNote: w.suspendNote,
      deletionScheduledAt: iso(w.deletionScheduledAt),
      assistedOnboarding: w.assistedOnboarding,
      subscription: sub ? { id: sub.id, planName: pickLocal(sub.plan.name), cycle: sub.billingCycle, appliedPrice: sub.appliedPrice, currentPeriodEnd: sub.currentPeriodEnd.toISOString(), trialEndsAt: iso(sub.trialEndsAt), dunningStage: sub.dunningStage, method: (lastPay?.raw as { manual?: { method?: string } } | null)?.manual?.method ?? (lastPay ? lastPay.provider : null) } : null,
      creditsDetail: { plan: Math.max(0, f?.planNet ?? 0), packs: Math.max(0, f?.pack ?? 0), packsBought, lastGrant: grant ? { credits: grant.credits, reason: grant.reason, at: grant.createdAt.toISOString() } : null },
      channels,
      agents,
      integrations: { sheets: !!sheets && sheets.status === 'active', couriers: couriers.map((c) => ({ provider: c.provider, ok: c.isActive && c.lastTestOk !== false })), apiKeys, webhooks, webhooksDisabled: webhooksOff },
      counts: { products, purchases, sales, members },
      kpis30d: { orders: row!.orders30d, conversations: row!.conversations30d, creditsUsedPct: limit > 0 ? Math.min(100, Math.round((row!.credits.used / limit) * 100)) : 0 },
      lastActivity: { web: iso(lastWeb?.lastLoginAt ?? null), mobile: iso(lastMobile?.lastSeenAt ?? null) },
    };
  }

  async members(id: string): Promise<AdminWorkspaceMemberDto[]> {
    await this.wsOr404(id);
    const rows = await prisma.membership.findMany({ where: { workspaceId: id }, include: { user: { select: { ...userSelect, totpEnabled: true, lastLoginAt: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ userId: m.userId, firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email, role: m.role, readOnly: m.readOnly, totpEnabled: m.user.totpEnabled, lastLoginAt: iso(m.user.lastLoginAt), joinedAt: m.createdAt.toISOString() }));
  }

  async channelsOf(id: string): Promise<AdminWorkspaceChannelDto[]> {
    await this.wsOr404(id);
    const rows = await prisma.channel.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => this.channelDto(c));
  }

  private channelDto(c: { id: string; name: string; platform: string; status: string; externalId: string; pausedReason: string | null; createdAt: Date; lastMessageAt?: Date | null }): AdminWorkspaceChannelDto {
    return { id: c.id, name: c.name, platform: c.platform, status: c.status, externalId: c.externalId.split('#')[0]!, pausedReason: c.pausedReason, connectedAt: c.createdAt.toISOString(), lastMessageAt: iso(c.lastMessageAt ?? null) };
  }

  async agentsOf(id: string): Promise<AdminWorkspaceAgentDto[]> {
    await this.wsOr404(id);
    const rows = await prisma.agent.findMany({ where: { workspaceId: id, deletedAt: null }, include: { preset: { select: { key: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({ id: a.id, name: a.name, status: a.status, presetKey: a.preset?.key ?? null, presetVersion: a.presetVersion, updatedAt: a.updatedAt.toISOString() }));
  }

  async creditsOf(id: string, q: { page: number; pageSize: number }): Promise<Page<AdminCreditRowDto>> {
    await this.wsOr404(id);
    const where: Prisma.CreditLedgerWhereInput = { workspaceId: id, kind: { in: ['credit', 'debit'] } };
    const [total, rows] = await Promise.all([prisma.creditLedger.count({ where }), prisma.creditLedger.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q), include: { grantedBy: { select: { firstName: true, lastName: true } } } })]);
    const balance = await TenantContext.runAs(id, async () => {
      const t = await this.tenants.forWorker(id);
      return TenantContext.run(t, () => this.credits.summary());
    });
    return { ...page(rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), action: r.action, kind: r.kind, bucket: r.bucket, credits: r.credits, balanceAfter: r.balanceAfter, reason: r.reason, grantedBy: r.grantedBy ? `${r.grantedBy.firstName} ${r.grantedBy.lastName}` : null })), total, q), meta: { balance } } as Page<AdminCreditRowDto>;
  }

  // --- writes --------------------------------------------------------------------------------------------------------------
  private async log(actor: AdminActor, workspaceId: string | null, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, reason: string | null) {
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity, entityId, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }

  private async afterChange(tx: Tx, workspaceId: string) {
    const row = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await this.outbox.ws(tx, `ws:${workspaceId}`, 'workspace.updated', { id: workspaceId, workspace: { status: row.status, trustLevel: row.trustLevel, stockMode: row.stockMode, locale: row.locale } }, `workspace.updated:admin:${workspaceId}:${Date.now()}`);
  }

  async create(input: AdminCreateWorkspaceInput, actor: AdminActor): Promise<AdminWorkspaceDetailDto> {
    const reason = requireReason(input.reason);
    const plan = input.planSlug ? await prisma.plan.findUnique({ where: { slug: input.planSlug } }) : null;
    if (input.planSlug && (!plan || plan.archivedAt)) throw new AppException('VALIDATION_ERROR', {}, { planSlug: 'validation.invalid' });
    const out = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      let user = await tx.user.findUnique({ where: { email: input.ownerEmail } });
      if (user?.ownedWorkspaceId) throw new AppException('CONFLICT', {}, { ownerEmail: 'validation.taken' });
      if (user && user.status !== 'active') throw new AppException('CONFLICT', {}, { ownerEmail: 'validation.invalid' });
      const created = !user;
      user ??= await tx.user.create({
        data: { email: input.ownerEmail, passwordHash: `!admin-created:${randomBytes(24).toString('hex')}`, firstName: input.ownerFirstName || input.ownerEmail.split('@')[0]!, lastName: input.ownerLastName ?? '', locale: 'fr' },
      });
      const ws = await this.provisioning.createWorkspace(tx, { ownerId: user.id, name: input.name, locale: user.locale });
      if (input.assistedOnboarding) await tx.workspace.update({ where: { id: ws.id }, data: { assistedOnboarding: true } });
      const sub = await tx.subscription.findFirstOrThrow({ where: { workspaceId: ws.id } });
      const trialEnd = input.trialMonths ? new Date(sub.currentPeriodStart.getTime() + input.trialMonths * 30 * DAY) : null;
      if (plan || trialEnd) {
        await tx.subscription.update({ where: { id: sub.id }, data: { ...(plan ? { planId: plan.id, planVersion: plan.version } : {}), ...(trialEnd ? { currentPeriodEnd: trialEnd, trialEndsAt: trialEnd } : {}) } });
      }
      if (input.initialCredits) {
        await tx.creditLedger.create({ data: { workspaceId: ws.id, periodStart: sub.currentPeriodStart, bucket: 'plan', action: 'grant', kind: 'credit', credits: input.initialCredits, balanceAfter: input.initialCredits + 300, reason, grantedById: actor.userId, idempotencyKey: `admin-create:${ws.id}` } });
      }
      if (input.sendInvite) {
        const token = await this.emailTokens.create(user.id, 'reset', undefined, tx);
        await this.mail.send({ to: user.email, template: 'auth/reset', locale: user.locale, secret: { url: `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/reset-password?token=${token}` }, key: `admin-invite:${ws.id}`, workspaceId: ws.id }, tx);
      }
      return { ws, created };
    });
    await this.log(actor, out.ws.id, 'workspace.create', 'Workspace', out.ws.id, null, { name: input.name, ownerEmail: input.ownerEmail, ownerCreated: out.created, planSlug: input.planSlug ?? 'pro', trialMonths: input.trialMonths ?? null, initialCredits: input.initialCredits ?? 0, assistedOnboarding: input.assistedOnboarding }, reason);
    return this.detail(out.ws.id, actor);
  }

  async patch(id: string, input: AdminPatchWorkspaceInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const w = await this.wsOr404(id);
    const data: Prisma.WorkspaceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.assistedOnboarding !== undefined) data.assistedOnboarding = input.assistedOnboarding;
    await prisma.$transaction(async (db) => {
      await db.workspace.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.afterChange(db as Tx, id);
    });
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'workspace.update', 'Workspace', id, { name: w.name, assistedOnboarding: w.assistedOnboarding }, input, reason);
    return this.detail(id, actor);
  }

  /** ADM-02 "Suspendre": `Workspace.status=suspended` (AI + webhooks stopped, mutations `403 WORKSPACE_SUSPENDED`), `workspace.suspended`. */
  async suspend(id: string, input: AdminSuspendInput, actor: AdminActor) {
    const note = requireReason(input.note, 'note');
    const w = await this.wsOr404(id);
    if (w.status !== 'active') throw new AppException('CONFLICT', {}, {}, { status: w.status });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.workspace.update({ where: { id }, data: { status: 'suspended', suspendedAt: new Date(), suspendReason: input.reason, suspendNote: note } });
      if (input.notifyOwner) {
        await TenantContext.runAs(id, () => this.notifications.emit(tx, { type: 'workspace_suspended', workspaceId: id, target: { owner: true }, key: `workspace_suspended:${id}:${Date.now()}`, data: { reason: input.reason } }));
      }
      await this.afterChange(tx, id);
    });
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'workspace.suspend', 'Workspace', id, { status: w.status }, { status: 'suspended', suspendReason: input.reason, notifyOwner: input.notifyOwner }, note);
    return this.detail(id, actor);
  }

  async reactivate(id: string, reasonIn: string, actor: AdminActor) {
    const reason = requireReason(reasonIn);
    const w = await this.wsOr404(id);
    if (w.status !== 'suspended') throw new AppException('CONFLICT', {}, {}, { status: w.status });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.workspace.update({ where: { id }, data: { status: 'active', suspendedAt: null, suspendReason: null, suspendNote: null } });
      await TenantContext.runAs(id, () => this.notifications.emit(tx, { type: 'workspace_reactivated', workspaceId: id, target: { owner: true }, key: `workspace_reactivated:${id}:${Date.now()}`, data: {} }));
      await this.afterChange(tx, id);
    });
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'workspace.reactivate', 'Workspace', id, { status: w.status, suspendReason: w.suspendReason }, { status: 'active' }, reason);
    return this.detail(id, actor);
  }

  /** ADM-02 "Changer de plan": `now` = switch at once (admin gesture, nothing charged) · `next_period` = booked for the renewal. */
  async changePlan(id: string, input: AdminChangePlanInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const w = await this.wsOr404(id);
    if (w.status === 'deletion_scheduled') throw new AppException('WORKSPACE_DELETION_SCHEDULED', { at: w.deletionScheduledAt!.toISOString() });
    const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan || plan.archivedAt) throw new AppException('PLAN_NOT_FOUND');
    const tenant = await this.tenants.forWorker(id);
    const before = await prisma.subscription.findFirst({ where: { workspaceId: id, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true } });
    await TenantContext.run({ ...tenant, userId: actor.userId }, () =>
      prisma.$transaction(
        async (db) => {
          const tx = db as Tx;
          await lockBilling(tx, id);
          const cur = await tx.subscription.findFirst({ where: { workspaceId: id, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true } });
          const now = new Date();
          const free = plan.priceMonthly === 0 && plan.priceYearly === 0;
          if (input.when === 'next_period' && cur && cur.billingCycle !== 'none') {
            await tx.subscription.update({ where: { id: cur.id }, data: { nextPlanId: plan.id, nextBillingCycle: input.cycle } });
            await this.subs.syncUpcoming(tx, (await tx.subscription.findUniqueOrThrow({ where: { id: cur.id } })));
          } else if (cur && cur.status === 'trial' && !free) {
            await tx.subscription.update({ where: { id: cur.id }, data: { planId: plan.id, planVersion: plan.version } });
          } else {
            if (cur) await tx.subscription.update({ where: { id: cur.id }, data: { status: 'cancelled', cancelledAt: now, cancelReason: 'admin_plan_change', nextPlanId: null, nextBillingCycle: null } });
            await tx.invoice.updateMany({ where: { workspaceId: id, status: 'upcoming' }, data: { status: 'void' } });
            const cycle = free ? 'none' : input.cycle;
            await tx.subscription.create({ data: { workspaceId: id, planId: plan.id, planVersion: plan.version, status: 'active', billingCycle: cycle, provider: free ? 'none' : 'manual', appliedPrice: priceOf(plan, cycle), currentPeriodStart: now, currentPeriodEnd: free ? new Date(now.getTime() + 365 * DAY) : addCycle(now, cycle) } });
            await this.limits.apply(tx, id, plan, `admin-plan:${id}:${now.getTime()}`);
            await this.credits.ensurePeriod(tx, id, plan.monthlyCredits, now);
          }
          await this.subs.emitWorkspace(tx, id);
        },
        { timeout: 30_000 },
      ),
    );
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'subscription.plan_change', 'Subscription', before?.id ?? null, { planSlug: before?.plan.slug ?? null, cycle: before?.billingCycle ?? null }, { planSlug: plan.slug, cycle: input.cycle, when: input.when }, reason);
    return this.detail(id, actor);
  }

  /** "Prolonger l'essai / la période": +3 / +7 / +30 days or until a date, on the current subscription. */
  async extend(id: string, input: AdminExtendInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    await this.wsOr404(id);
    const sub = await prisma.subscription.findFirst({ where: { workspaceId: id, status: { in: [...CURRENT_STATUSES] } }, include: { plan: true } });
    if (!sub || sub.plan.slug === 'free') throw new AppException('CONFLICT', {}, {}, { reason: 'NO_SUBSCRIPTION' });
    const base = sub.trialEndsAt ?? sub.currentPeriodEnd;
    const until = input.until ? new Date(`${input.until}T23:59:59+01:00`) : new Date(base.getTime() + input.days! * DAY);
    if (until <= base) throw new AppException('VALIDATION_ERROR', {}, { until: 'validation.range' });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: until, ...(sub.status === 'trial' ? { trialEndsAt: until } : {}) } });
      await TenantContext.runAs(id, () => this.subs.emitWorkspace(tx, id));
      // tester report 22/10 UX-020: the Owner is told (in-app + e-mail) that the trial now ends later
      if (sub.status === 'trial') {
        const day = algiersDay(until);
        await TenantContext.runAs(id, () => this.notifications.emit(tx, { type: 'subscription_trial_extended', workspaceId: id, target: { owner: true }, key: `subscription_trial_extended:${sub.id}:${until.getTime()}`, data: { until: until.toISOString(), date: `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` } }));
      }
    });
    await this.tenants.invalidate(id);
    await this.log(actor, id, sub.status === 'trial' ? 'subscription.trial_extend' : 'subscription.extend', 'Subscription', sub.id, { until: base.toISOString() }, { until: until.toISOString() }, reason);
    return this.detail(id, actor);
  }

  /** DEL-05: J+30, data export to the Owner (deletion e-mail), pages disconnected, subscription cancelled; cancellable until then. */
  async scheduleDeletion(id: string, input: AdminScheduleDeletionInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const w = await this.wsOr404(id);
    if (input.confirmName.trim().toLowerCase() !== w.name.trim().toLowerCase()) throw new AppException('VALIDATION_ERROR', {}, { confirmName: 'validation.invalid' });
    if (w.status === 'deletion_scheduled') throw new AppException('WORKSPACE_DELETION_SCHEDULED', { at: w.deletionScheduledAt!.toISOString() });
    const s = await prisma.platformSetting.findUnique({ where: { key: 'limits' } });
    const grace = (s?.value as { deletionGraceDays?: number } | null)?.deletionGraceDays;
    const at = new Date(Date.now() + (Number.isInteger(grace) && grace! > 0 ? grace! : 30) * DAY);
    const owner = await prisma.user.findFirst({ where: { ownedWorkspaceId: id } });
    await TenantContext.runAs(id, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.workspace.update({ where: { id }, data: { status: 'deletion_scheduled', deletionScheduledAt: at } });
        await tx.subscription.updateMany({ where: { workspaceId: id, status: { in: ['active', 'dunning'] }, billingCycle: { not: 'none' }, cancelAtPeriodEnd: false }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: 'workspace_deletion' } });
        await tx.invoice.updateMany({ where: { workspaceId: id, status: 'upcoming' }, data: { status: 'void' } });
        const connected = await tx.channel.findMany({ where: { workspaceId: id, status: { not: 'disconnected' } }, select: { id: true } });
        await tx.channel.updateMany({ where: { workspaceId: id, status: { not: 'disconnected' } }, data: { status: 'disconnected', pausedReason: null, webhookSubscribed: false } });
        await tx.agentChannel.deleteMany({ where: { channelId: { in: connected.map((c) => c.id) } } });
        for (const c of connected) await this.queue.add(tx, 'jobs', 'channel-unsubscribe', { channelId: c.id, workspaceId: id }, `chn-unsub:${c.id}:${at.getTime()}`, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
        if (owner) {
          await this.mail.send({ to: owner.email, template: 'workspace/deletion-scheduled', locale: owner.locale, params: { workspaceName: w.name, at: at.toISOString(), url: `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/settings/danger` }, key: `ws-deletion-scheduled:${id}:${at.getTime()}`, workspaceId: id }, tx);
        }
        await this.notifications.emit(tx, { type: 'workspace_deletion_scheduled', workspaceId: id, target: { owner: true }, key: `workspace_deletion_scheduled:${id}:${at.getTime()}`, data: { at: at.toISOString(), date: at.toISOString().slice(0, 10) } });
        await this.afterChange(tx, id);
      }),
    );
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'workspace.deletion_scheduled', 'Workspace', id, { status: w.status }, { status: 'deletion_scheduled', deletionScheduledAt: at.toISOString() }, reason);
    return this.detail(id, actor);
  }

  async cancelDeletion(id: string, reasonIn: string, actor: AdminActor) {
    const reason = requireReason(reasonIn);
    const w = await this.wsOr404(id);
    if (w.status !== 'deletion_scheduled') throw new AppException('CONFLICT', {}, {}, { status: w.status });
    await TenantContext.runAs(id, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.workspace.update({ where: { id }, data: { status: 'active', deletionScheduledAt: null } });
        await tx.subscription.updateMany({ where: { workspaceId: id, cancelReason: 'workspace_deletion', status: { in: ['active', 'dunning'] } }, data: { cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null } });
        await this.afterChange(tx, id);
      }),
    );
    await this.tenants.invalidate(id);
    await this.log(actor, id, 'workspace.deletion_cancelled', 'Workspace', id, { status: w.status, deletionScheduledAt: iso(w.deletionScheduledAt) }, { status: 'active' }, reason);
    return this.detail(id, actor);
  }

  // --- channels (force release, AT-CHN-08) ---------------------------------------------------------------------------------
  async channelsSearch(q: { page: number; pageSize: number; q?: string; workspaceId?: string }): Promise<Page<AdminChannelRowDto>> {
    const where: Prisma.ChannelWhereInput = {
      ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
      ...(q.q ? { OR: [{ externalId: { startsWith: q.q.trim() } }, { name: { contains: q.q.trim(), mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await Promise.all([prisma.channel.count({ where }), prisma.channel.findMany({ where, include: { workspace: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) })]);
    return page(rows.map((c) => ({ ...this.channelDto(c), workspace: c.workspace })), total, q);
  }

  /**
   * `POST /admin/channels/:id/release { reason, proofTicketId? }` (CHN-05, AT-CHN-08): the page id is freed for another
   * workspace — the holder's channel is disconnected (token wiped by the unsubscribe job) and keeps its history under a
   * retired id (`ChannelService.releaseExternalId`).
   */
  async releaseChannel(id: string, input: { reason: string; proofTicketId?: string }, actor: AdminActor): Promise<AdminChannelRowDto> {
    const reason = requireReason(input.reason);
    assertUuid(id);
    const c = await prisma.channel.findUnique({ where: { id }, include: { workspace: { select: { id: true, name: true } } } });
    if (!c) throw notFound();
    if (c.externalId.includes('#')) throw new AppException('CONFLICT', {}, {}, { reason: 'ALREADY_RELEASED' });
    const wasConnected = c.status !== 'disconnected';
    await TenantContext.runAs(c.workspaceId, () =>
      prisma.$transaction(async (db) => {
        const tx = db as Tx;
        const family = await tx.channel.findMany({ where: { OR: [{ id }, { parentChannelId: id }] } });
        for (const ch of family) {
          if (ch.status !== 'disconnected') {
            await tx.channel.update({ where: { id: ch.id }, data: { status: 'disconnected', pausedReason: null, webhookSubscribed: false } });
            await tx.agentChannel.deleteMany({ where: { channelId: ch.id } });
            await this.queue.add(tx, 'jobs', 'channel-unsubscribe', { channelId: ch.id, workspaceId: ch.workspaceId }, `chn-unsub:${ch.id}:release`, { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } });
          }
          if (!ch.externalId.includes('#')) await this.channels.releaseExternalId(tx, ch);
        }
        await this.outbox.ws(tx, `ws:${c.workspaceId}`, 'channel.updated', { id, channel: { id, status: 'disconnected' } }, `channel.updated:release:${id}`);
      }),
    );
    await this.log(actor, c.workspaceId, 'channel.force_release', 'Channel', id, { status: c.status, externalId: c.externalId }, { status: 'disconnected', released: true, wasConnected, proofTicketId: input.proofTicketId ?? null }, reason);
    const after = await prisma.channel.findUniqueOrThrow({ where: { id }, include: { workspace: { select: { id: true, name: true } } } });
    return { ...this.channelDto(after), externalId: c.externalId, workspace: after.workspace };
  }
}
