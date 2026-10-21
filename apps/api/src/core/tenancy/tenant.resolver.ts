// 01-nest-module-map §3.1 — resolves the TenantInfo of a request / job.
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, NO_LIMITS, type TenantInfo, type TenantLimits, type MembershipRole } from '@djaber/db';
import { AppException } from '../errors/app.exception';
import { RedisService } from '../redis/redis.provider';
import { loadConfig } from '../config/config.service';
import type { AuthUser } from '../auth/decorators';

type WorkspaceCtx = {
  workspaceId: string;
  status: 'active' | 'suspended' | 'deletion_scheduled';
  deletionScheduledAt: string | null;
  locale: 'fr' | 'ar' | 'en';
  stockMode: 'simple' | 'advanced';
  limits: TenantLimits;
  planSlug: string;
  subscriptionStatus: string;
  /** `Plan.features` of the plan that applies (M8: `scheduled_reports`, …) */
  features?: string[];
};

const CURRENT = ['trial', 'active', 'dunning'] as const;
const SUSPENDED_ALLOWED = [/^\/api\/v1\/workspace$/, /^\/api\/v1\/billing\//, /^\/api\/v1\/credits$/, /^\/api\/v1\/me(\/|$)/, /^\/api\/v1\/help\//, /^\/api\/v1\/support\//];

/** D41 testing exemption (`PLATFORM_2FA_EXEMPT_EMAILS`); never in production. */
export const twoFaExempt = (email: string): boolean => {
  const cfg = loadConfig();
  if (cfg.NODE_ENV === 'production') return false;
  return cfg.PLATFORM_2FA_EXEMPT_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
};

@Injectable()
export class TenantResolver {
  constructor(private readonly redis: RedisService) {}

  static ctxKey = (workspaceId: string) => `ws:${workspaceId}:ctx`;

  /** Call after any membership / subscription / workspace status / plan change. */
  async invalidate(workspaceId: string) {
    await this.redis.client.del(TenantResolver.ctxKey(workspaceId));
  }

  /** Workspace-level context (status, plan limits). Cached 30 s. */
  async workspaceCtx(workspaceId: string): Promise<WorkspaceCtx | null> {
    const cached = await this.redis.getJson<WorkspaceCtx>(TenantResolver.ctxKey(workspaceId));
    if (cached) return cached;
    const ctx = await TenantContext.runSystem(async () => {
      const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
      if (!ws) return null;
      const sub = await prisma.subscription.findFirst({
        where: { workspaceId, status: { in: [...CURRENT] } },
        include: { plan: true },
      });
      // Expired / no subscription ⇒ free-plan limits (02 §5): nothing is deleted, extras are paused by plan.
      const plan = sub?.plan ?? (await prisma.plan.findUnique({ where: { slug: 'free' } }));
      const limits: TenantLimits = plan
        ? {
            maxPages: plan.maxPages,
            maxAgents: plan.maxAgents,
            maxProducts: plan.maxProducts,
            maxConversationsPerMonth: plan.maxConversationsPerMonth,
            maxMembers: plan.maxMembers,
            monthlyCredits: plan.monthlyCredits,
          }
        : NO_LIMITS;
      const out: WorkspaceCtx = {
        workspaceId: ws.id,
        status: ws.status,
        deletionScheduledAt: ws.deletionScheduledAt ? ws.deletionScheduledAt.toISOString() : null,
        locale: ws.locale,
        stockMode: ws.stockMode,
        limits,
        planSlug: plan?.slug ?? 'free',
        subscriptionStatus: sub?.status ?? 'expired',
        features: plan?.features ?? [],
      };
      return out;
    });
    if (ctx) await this.redis.setJson(TenantResolver.ctxKey(workspaceId), ctx, 30);
    return ctx;
  }

  /** Features of the plan that applies to the workspace (02 §5: expired ⇒ free plan). */
  async features(workspaceId: string): Promise<string[]> {
    let ctx = await this.workspaceCtx(workspaceId);
    if (ctx && !ctx.features) {
      // context cached by an older build without `features`
      await this.invalidate(workspaceId);
      ctx = await this.workspaceCtx(workspaceId);
    }
    return ctx?.features ?? [];
  }

  async hasFeature(workspaceId: string, feature: string): Promise<boolean> {
    return (await this.features(workspaceId)).includes(feature);
  }

  private toInfo(ctx: WorkspaceCtx, extra: Partial<TenantInfo>): TenantInfo {
    return {
      workspaceId: ctx.workspaceId,
      readOnly: false,
      locale: ctx.locale,
      stockMode: ctx.stockMode,
      suspended: ctx.status === 'suspended',
      deletionScheduledAt: ctx.deletionScheduledAt ? new Date(ctx.deletionScheduledAt) : null,
      limits: ctx.limits,
      ...extra,
    };
  }

  /**
   * Merchant request: `X-Workspace-Id` header, else the owned workspace, else `User.lastWorkspaceId`,
   * else `400 WORKSPACE_REQUIRED`. Header without membership ⇒ null (caller answers 404).
   */
  async forUser(user: AuthUser, headerWorkspaceId: unknown): Promise<TenantInfo | null> {
    return TenantContext.runSystem(async () => {
      const u = await prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
      if (!u || u.status !== 'active') throw new AppException('UNAUTHORIZED');
      let workspaceId = typeof headerWorkspaceId === 'string' && headerWorkspaceId ? headerWorkspaceId : undefined;
      if (workspaceId && !/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
      const fromHeader = !!workspaceId;
      workspaceId ??= u.ownedWorkspaceId ?? u.lastWorkspaceId ?? undefined;
      if (!workspaceId) throw new AppException('WORKSPACE_REQUIRED');
      const membership = await prisma.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: u.id } },
      });
      if (!membership) return null;
      const ctx = await this.workspaceCtx(workspaceId);
      if (!ctx) return null;
      // workspace switcher: remember the last workspace used with an explicit header (api-contract §1.3)
      if (fromHeader && u.lastWorkspaceId !== workspaceId) {
        await prisma.user.update({ where: { id: u.id }, data: { lastWorkspaceId: workspaceId } });
      }
      return this.toInfo(ctx, {
        userId: u.id,
        role: membership.role as MembershipRole,
        readOnly: membership.readOnly,
        hiddenSections: membership.role === 'owner' ? [] : membership.hiddenSections,
        platformRole: u.platformRole === 'none' ? undefined : u.platformRole,
        emailVerified: !!u.emailVerifiedAt,
      });
    });
  }

  /** `@Authenticated()` and `@Platform()` routes: no workspace, tenant models need an explicit `TenantContext.runAs`. */
  async forAccount(user: AuthUser): Promise<TenantInfo> {
    return TenantContext.runSystem(async () => {
      const u = await prisma.user.findFirst({ where: { id: user.id, deletedAt: null } });
      if (!u || u.status === 'blocked') throw new AppException('UNAUTHORIZED');
      return {
        workspaceId: '',
        userId: u.id,
        readOnly: false,
        platformRole: u.platformRole === 'none' ? undefined : u.platformRole,
        locale: u.locale,
        stockMode: 'simple' as const,
        suspended: false,
        limits: NO_LIMITS,
        emailVerified: !!u.emailVerifiedAt,
        totpEnabled: u.totpEnabled,
        twoFaExempt: twoFaExempt(u.email),
        bypass: true,
      };
    });
  }

  /**
   * D21-bis read-only impersonation (01 §3.1): `X-Impersonation-Session` + the session token. Valid only while the session is
   * open (`endedAt IS NULL AND expiresAt > now`), for its admin, whose role is still `super_admin|support`; otherwise
   * `401 ADMIN_IMPERSONATION_EXPIRED`. The synthetic membership is `admin` + `readOnly`; every request increments
   * `actionsCount` and is audited `impersonation.action` (the caller rejects non-GET requests afterwards).
   */
  async forImpersonation(
    user: AuthUser,
    sessionId: string,
    claims: { imp?: string } | undefined,
    req: { method: string; path: string; ip?: string | null; userAgent?: string | null },
  ): Promise<TenantInfo> {
    return TenantContext.runSystem(async () => {
      if (!/^[0-9a-f-]{36}$/i.test(sessionId) || (claims?.imp && claims.imp !== sessionId)) throw new AppException('ADMIN_IMPERSONATION_EXPIRED');
      const [session, u] = await Promise.all([
        prisma.impersonationSession.findUnique({ where: { id: sessionId } }),
        prisma.user.findFirst({ where: { id: user.id, deletedAt: null } }),
      ]);
      if (!session || !u || session.adminUserId !== u.id || session.endedAt || session.expiresAt <= new Date()) throw new AppException('ADMIN_IMPERSONATION_EXPIRED');
      if (u.status !== 'active' || !['super_admin', 'support'].includes(u.platformRole)) throw new AppException('ADMIN_IMPERSONATION_EXPIRED');
      const ctx = await this.workspaceCtx(session.workspaceId);
      if (!ctx) throw new AppException('ADMIN_IMPERSONATION_EXPIRED');
      await prisma.impersonationSession.update({ where: { id: session.id }, data: { actionsCount: { increment: 1 } } });
      await prisma.auditLog.create({
        data: {
          workspaceId: session.workspaceId,
          actorType: 'admin',
          actorId: u.id,
          actorRole: u.platformRole,
          action: 'impersonation.action',
          entity: 'ImpersonationSession',
          entityId: session.id,
          after: { method: req.method, path: req.path.slice(0, 300), allowed: req.method === 'GET' || req.method === 'HEAD' },
          impersonationSessionId: session.id,
          ip: req.ip ?? null,
          userAgent: req.userAgent?.slice(0, 300) ?? null,
        },
      });
      return {
        ...this.toInfo(ctx, { userId: u.id, role: 'admin' as MembershipRole, readOnly: true, platformRole: u.platformRole, emailVerified: true }),
        suspended: false,
        impersonation: { sessionId: session.id, adminId: u.id },
      };
    });
  }

  async forApiKey(apiKey: { id: string; workspaceId: string }): Promise<TenantInfo | null> {
    const ctx = await this.workspaceCtx(apiKey.workspaceId);
    return ctx ? this.toInfo(ctx, { apiKeyId: apiKey.id }) : null;
  }

  /** Worker jobs: `TenantContext.run(await tenants.forWorker(workspaceId), …)`. */
  async forWorker(workspaceId: string): Promise<TenantInfo> {
    const ctx = await this.workspaceCtx(workspaceId);
    if (!ctx) throw new Error(`Workspace ${workspaceId} not found`);
    return this.toInfo(ctx, {});
  }

  isSuspendedAllowed(path: string) {
    return SUSPENDED_ALLOWED.some((re) => re.test(path));
  }
}
