// SET (03 §20) — workspace profile & settings, plan summary with real usage counts, creation for invited-only users (D30).
import { Injectable } from '@nestjs/common';
import { DEFAULT_SYSTEM_MESSAGES, prisma, TenantContext, type Plan, type Subscription, type Workspace } from '@djaber/db';
import { completeSafetyRules, type AppLocale } from '@djaber/shared';
import { AuditService } from '../../core/audit/audit.service';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';
import { OutboxService } from '../../core/outbox/outbox.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { ImageUploadService, type UploadedFile } from '../uploads/image-upload.service';
import type { UpdateWorkspace } from './dto';
import { LegalService } from './legal.service';
import { ProvisioningService } from './provisioning.service';

const CURRENT = ['trial', 'active', 'dunning'] as const;

/** Start of the current calendar month in Africa/Algiers (UTC+1, no DST), as a UTC instant. */
export const algiersMonthStart = (now = new Date()) => {
  const local = new Date(now.getTime() + 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 3600_000);
};

type SubWithPlan = (Subscription & { plan: Plan }) | null;

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly i18n: I18nService,
    private readonly tenants: TenantResolver,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly provisioning: ProvisioningService,
    private readonly legal: LegalService,
    private readonly images: ImageUploadService,
  ) {}

  private async row(): Promise<Workspace> {
    const ws = await prisma.workspace.findFirst({ where: { id: TenantContext.workspaceId(), deletedAt: null } });
    if (!ws) throw notFound();
    return ws;
  }

  /** Current subscription and the plan that applies (free plan once expired, 02 §5). Needs a tenant or system context. */
  private async planOf(workspaceId: string): Promise<{ sub: SubWithPlan; plan: Plan; last: Subscription | null }> {
    const sub = await prisma.subscription.findFirst({
      where: { workspaceId, status: { in: [...CURRENT] } },
      include: { plan: true },
    });
    if (sub) return { sub, plan: sub.plan, last: sub };
    const [free, last] = await Promise.all([
      prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } }),
      prisma.subscription.findFirst({ where: { workspaceId }, orderBy: { currentPeriodEnd: 'desc' } }),
    ]);
    return { sub: null, plan: free, last };
  }

  private limitsOf(plan: Plan) {
    return {
      maxPages: plan.maxPages,
      maxAgents: plan.maxAgents,
      maxProducts: plan.maxProducts,
      maxConversationsPerMonth: plan.maxConversationsPerMonth,
      maxMembers: plan.maxMembers,
      maxApiKeys: plan.maxApiKeys,
      maxWebhooks: plan.maxWebhooks,
      monthlyCredits: plan.monthlyCredits,
      features: plan.features,
    };
  }

  /** PlanUsage from real rows (never a stored counter). Must run in the workspace's tenant context. */
  private async usage(periodStart: Date) {
    const [pages, agents, products, conversationsThisMonth, members, debits] = await Promise.all([
      // CHN-10: a page holds a slot while it is live; a linked Instagram account rides on its page, paused pages hold none
      prisma.channel.count({ where: { parentChannelId: null, status: { in: ['active', 'pending_review', 'needs_reconnect'] } } }),
      prisma.agent.count({ where: { status: { in: ['active', 'paused'] }, deletedAt: null, OR: [{ pausedReason: null }, { pausedReason: { not: 'plan' } }] } }),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { createdAt: { gte: algiersMonthStart() } } }),
      prisma.membership.count(),
      prisma.creditLedger.aggregate({ where: { kind: 'debit', createdAt: { gte: periodStart } }, _sum: { credits: true } }),
    ]);
    return { pages, agents, products, conversationsThisMonth, members, creditsUsed: Math.abs(debits._sum.credits ?? 0) };
  }

  private async planBlock(workspaceId: string, locale: string) {
    const { sub, plan, last } = await this.planOf(workspaceId);
    const periodStart = sub?.currentPeriodStart ?? algiersMonthStart();
    // M9: shell banners for every member (Operators cannot read GET /billing/subscription)
    const isFreeRow = !!sub && sub.provider === 'none' && sub.billingCycle === 'none' && sub.status === 'active';
    const [expired, channels, agents, members] = await Promise.all([
      isFreeRow ? prisma.subscription.findFirst({ where: { workspaceId, status: 'expired' }, orderBy: { updatedAt: 'desc' }, include: { plan: true } }) : Promise.resolve(null),
      prisma.channel.count({ where: { parentChannelId: null, status: 'paused', pausedReason: 'plan' } }),
      prisma.agent.count({ where: { deletedAt: null, status: 'paused', pausedReason: 'plan' } }),
      prisma.membership.count({ where: { readOnly: true } }),
    ]);
    return {
      slug: plan.slug,
      name: this.i18n.pick(plan.name, locale),
      limits: this.limitsOf(plan),
      usage: await this.usage(periodStart),
      periodEnd: (sub?.currentPeriodEnd ?? last?.currentPeriodEnd ?? new Date()).toISOString(),
      status: sub?.status ?? 'expired',
      trialEndsAt: sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      dunningStage: sub?.dunningStage ?? null,
      expired: expired && expired.plan.slug !== 'free' ? { at: expired.updatedAt.toISOString(), planName: this.i18n.pick(expired.plan.name, locale) } : null,
      paused: { channels, agents, members },
    };
  }

  private async toDto(ws: Workspace, locale: string) {
    const stored = (ws.systemMessages ?? {}) as Record<string, Record<string, string>>;
    const systemMessages = Object.fromEntries(
      Object.entries(DEFAULT_SYSTEM_MESSAGES).map(([k, d]) => [k, { ...d, ...(stored[k] ?? {}) }]),
    );
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      logoUrl: ws.logoUrl,
      phone: ws.phone,
      address: ws.address,
      senderWilayaId: ws.senderWilayaId,
      locale: ws.locale,
      timezone: ws.timezone,
      stockMode: ws.stockMode,
      onboardingStep: ws.onboardingStep,
      freeDeliveryThreshold: ws.freeDeliveryThreshold,
      autoPauseOnManualReply: ws.autoPauseOnManualReply,
      handoffReminderMin: ws.handoffReminderMin,
      onlinePaymentEnabled: ws.onlinePaymentEnabled,
      autoSendToCourier: ws.autoSendToCourier,
      defaultCourierAccountId: ws.defaultCourierAccountId,
      targetMarginPct: ws.targetMarginPct,
      systemMessages,
      status: ws.status,
      suspendReason: ws.suspendReason,
      deletionScheduledAt: ws.deletionScheduledAt ? ws.deletionScheduledAt.toISOString() : null,
      trustLevel: ws.trustLevel,
      safetyRules: completeSafetyRules(ws.safetyRules),
      blockedWords: ws.blockedWords,
      billingInfo: ws.billingInfo ?? null,
      plan: await this.planBlock(ws.id, locale),
      version: ws.version,
    };
  }

  /** `GET /workspace` */
  async get(locale: string) {
    return this.toDto(await this.row(), locale);
  }

  /**
   * Current-workspace block of `GET /me` (role, readOnly, plan, limits, stock mode, onboarding step):
   * everything the web shell needs without a second round trip.
   */
  async summaryFor(userId: string, workspaceId: string, locale: string) {
    return TenantContext.runAs(workspaceId, async () => {
      const membership = await prisma.membership.findFirst({ where: { userId } });
      if (!membership) return null;
      const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
      if (!ws) return null;
      const plan = await this.planBlock(workspaceId, locale);
      return {
        id: ws.id,
        name: ws.name,
        logoUrl: ws.logoUrl,
        role: membership.role,
        readOnly: membership.readOnly,
        status: ws.status,
        suspendReason: ws.suspendReason,
        deletionScheduledAt: ws.deletionScheduledAt ? ws.deletionScheduledAt.toISOString() : null,
        locale: ws.locale,
        timezone: ws.timezone,
        stockMode: ws.stockMode,
        onboardingStep: ws.onboardingStep,
        plan,
      };
    });
  }

  /** `PATCH /workspace` */
  async update(input: UpdateWorkspace, locale: string, client: { ip?: string | null; userAgent?: string | null }) {
    const t = TenantContext.get();
    const before = await this.row();
    const { version, logoUploadId, ...fields } = input;
    const data: Record<string, unknown> = { ...fields };

    // journey J08-11: « Envoi automatique » needs a courier to send to (04 §22 D9: the default courier)
    if (fields.autoSendToCourier === true && !before.autoSendToCourier && !(await prisma.courierAccount.count({ where: { isActive: true } }))) throw new AppException('DELIVERY_NO_COURIER');
    if (fields.senderWilayaId) {
      const wilaya = await prisma.wilaya.findUnique({ where: { id: fields.senderWilayaId } });
      if (!wilaya) throw validationError({ senderWilayaId: 'validation.wilaya' });
    }
    if (logoUploadId !== undefined) {
      if (logoUploadId === null) data.logoUrl = null;
      else {
        const upload = await prisma.upload.findFirst({ where: { id: logoUploadId, kind: 'logo', createdById: t.userId } });
        if (!upload) throw validationError({ logoUploadId: 'validation.invalid' });
        data.logoUrl = upload.url;
      }
    }

    const changed = Object.keys(data).filter((k) => (before as Record<string, unknown>)[k] !== data[k]);
    if (version !== undefined && version !== before.version) {
      throw conflict({ changedBy: null, changedAt: before.updatedAt.toISOString(), current: await this.toDto(before, locale) });
    }
    if (!changed.length) return this.toDto(before, locale);

    const after = await prisma.$transaction(async (tx) => {
      const r = await tx.workspace.updateMany({
        where: { id: before.id, version: before.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!r.count) return null;
      const row = await tx.workspace.findUniqueOrThrow({ where: { id: before.id } });
      await this.outbox.ws(tx, `ws:${row.id}`, 'workspace.updated', {
        id: row.id,
        workspace: { status: row.status, stockMode: row.stockMode, locale: row.locale },
      });
      return row;
    });
    if (!after) {
      const current = await this.row();
      throw conflict({ changedBy: null, changedAt: current.updatedAt.toISOString(), current: await this.toDto(current, locale) });
    }
    await this.tenants.invalidate(after.id);
    const pickChanged = (o: Workspace) => Object.fromEntries(changed.map((k) => [k, (o as Record<string, unknown>)[k]]));
    await this.audit.write({
      workspaceId: after.id,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'workspace.update',
      entity: 'Workspace',
      entityId: after.id,
      before: pickChanged(before),
      after: pickChanged(after),
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return this.toDto(after, locale);
  }

  /** `POST /workspace/logo` */
  async setLogo(file: UploadedFile | undefined, locale: string, client: { ip?: string | null; userAgent?: string | null }) {
    const t = TenantContext.get();
    const upload = await this.images.store(file, 'logo', t.userId!, t.workspaceId);
    return this.update({ logoUploadId: upload.id }, locale, client);
  }

  /** `POST /workspaces` — only for a user who owns no workspace yet (D30): same trial as sign-up (D60). */
  async createForUser(userId: string, input: { name: string; senderWilayaId?: number | null; stockMode?: 'simple' | 'advanced'; locale?: AppLocale }, locale: string) {
    const ws = await TenantContext.runSystem(async () => {
      const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
      if (!user || user.status !== 'active') throw new AppException('UNAUTHORIZED');
      if (user.ownedWorkspaceId) throw new AppException('CONFLICT', {}, {}, { reason: 'ALREADY_OWNS_WORKSPACE', workspaceId: user.ownedWorkspaceId });
      if (input.senderWilayaId) {
        const wilaya = await prisma.wilaya.findUnique({ where: { id: input.senderWilayaId } });
        if (!wilaya) throw validationError({ senderWilayaId: 'validation.wilaya' });
      }
      return prisma.$transaction(async (tx) => {
        const created = await this.provisioning.createWorkspace(tx, {
          ownerId: userId,
          name: input.name,
          locale: input.locale ?? user.locale,
          stockMode: input.stockMode,
          senderWilayaId: input.senderWilayaId,
        });
        // an owner accepts the content rules too (04 §15)
        await this.legal.acceptCurrent(tx, userId, ['content_rules'], null, 'web');
        return created;
      });
    });
    await this.audit.write({ workspaceId: ws.id, actorType: 'user', actorId: userId, actorRole: 'owner', action: 'workspace.create', entity: 'Workspace', entityId: ws.id, after: { name: ws.name } });
    return TenantContext.runAs(ws.id, () => this.toDto(ws, locale));
  }
}
