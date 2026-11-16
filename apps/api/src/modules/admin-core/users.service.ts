// ADM-03 users (+ ADM-17 user sheet), ADM-16 platform team (roles, invitations, force 2FA) and account deletion requests
// (DEL-02/04: queue, cancel, resolve, process now; admin-scheduled user deletion `source=admin`).
import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import {
  ADMIN_EMAIL_DOMAIN,
  ADMIN_RESEND_VERIFICATION_COOLDOWN_MIN,
  type ActionDescriptor,
  type AdminInviteMemberInput,
  type AdminPatchUserInput,
  type AdminPlatformRoleInput,
  type AdminUserDetailDto,
  type AdminUserRowDto,
  type AdminUsersQuery,
  type DeletionRequestAdminDto,
  type PlatformTeamDto,
} from '@djaber/shared';
import { Prisma, prisma, TenantContext, type AccountDeletionRequest, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { canPlatform } from '../../core/rbac/permission-matrix';
import { RedisService } from '../../core/redis/redis.provider';
import { TenantResolver, twoFaExempt, twoFaPaused } from '../../core/tenancy/tenant.resolver';
import { AccountDeletionService } from '../auth/account-deletion.service';
import { AuthService } from '../auth/auth.service';
import { EmailTokenService } from '../auth/email-token.service';
import { ReauthService } from '../auth/reauth.service';
import { SessionService } from '../auth/session.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { DAY, STATE_REFUSED, assertUuid, iso, offered, requireReason, userRef, userSelect, type AdminActor } from './admin.util';

const OPEN_DELETION = ['pending_confirmation', 'grace', 'blocked'] as const;
type Blocked = 'ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly mail: MailOutbox,
    private readonly redis: RedisService,
    private readonly tenants: TenantResolver,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly reauth: ReauthService,
    private readonly emailTokens: EmailTokenService,
    private readonly auth: AuthService,
    private readonly deletions: AccountDeletionService,
  ) {}

  private web(path: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}${path}`;
  }
  private async log(actor: AdminActor, action: string, entity: string, entityId: string | null, before: unknown, after: unknown, reason: string | null, workspaceId: string | null = null) {
    await this.audit.write({ workspaceId, actorType: 'admin', actorId: actor.userId, actorRole: actor.platformRole, action, entity, entityId, before, after, reason, ip: actor.ip, userAgent: actor.userAgent });
  }
  private async userOr404(id: string) {
    assertUuid(id);
    const u = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!u) throw notFound();
    return u;
  }

  // --- list / detail -------------------------------------------------------------------------------------------------------
  async list(q: AdminUsersQuery, actor: AdminActor): Promise<Page<AdminUserRowDto>> {
    const and: Prisma.UserWhereInput[] = [{ deletedAt: null }];
    if (q.platformRole?.length) and.push({ platformRole: { in: q.platformRole as never } });
    if (q.status?.length) {
      const st = q.status.filter((s) => s !== 'unverified');
      const or: Prisma.UserWhereInput[] = [];
      if (st.length) or.push({ status: { in: st as never } });
      if (q.status.includes('unverified')) or.push({ emailVerifiedAt: null });
      and.push({ OR: or });
    }
    if (q.emailVerified !== undefined) and.push({ emailVerifiedAt: q.emailVerified ? { not: null } : null });
    if (q.totpEnabled !== undefined) and.push({ totpEnabled: q.totpEnabled });
    if (q.workspaceId) and.push({ memberships: { some: { workspaceId: q.workspaceId } } });
    if (q.lastLogin) {
      const d = (n: number) => new Date(Date.now() - n * DAY);
      if (q.lastLogin === 'never') and.push({ lastLoginAt: null });
      else if (q.lastLogin === 'over90d') and.push({ lastLoginAt: { lt: d(90) } });
      else and.push({ lastLoginAt: { gte: d(Number.parseInt(q.lastLogin, 10)) } });
    }
    if (q.q) {
      const s = q.q.trim();
      and.push({ OR: [{ email: { contains: s, mode: 'insensitive' } }, { firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s.replace(/\s+/g, '') } }] });
    }
    const where: Prisma.UserWhereInput = { AND: and };
    const sortKey = q.sort?.replace(/^-/, '');
    const orderBy = [{ [sortKey === 'lastLoginAt' || sortKey === 'email' ? sortKey : 'createdAt']: q.sort && !q.sort.startsWith('-') ? 'asc' : 'desc' }, { id: 'desc' as const }];
    const [total, rows] = await Promise.all([prisma.user.count({ where }), prisma.user.findMany({ where, orderBy: orderBy as never, ...toSkipTake(q), include: { memberships: { include: { workspace: { select: { id: true, name: true } } } } } })]);
    return page(rows.map((u) => this.row(u, actor)), total, q);
  }

  private row(u: Prisma.UserGetPayload<{ include: { memberships: { include: { workspace: { select: { id: true; name: true } } } } } }>, actor: AdminActor): AdminUserRowDto {
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      emailVerified: !!u.emailVerifiedAt,
      totpEnabled: u.totpEnabled,
      platformRole: u.platformRole,
      status: u.status,
      workspaces: u.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
      lastLoginAt: iso(u.lastLoginAt),
      lastSeenPlatform: u.lastSeenPlatform,
      createdAt: u.createdAt.toISOString(),
      actions: this.actions(u, actor),
    };
  }

  private actions(u: { id: string; emailVerifiedAt: Date | null; totpEnabled: boolean; status: string; platformRole: string; ownedWorkspaceId: string | null }, actor: AdminActor): ActionDescriptor[] {
    const w = canPlatform(actor.platformRole, 'admin.users.write');
    const team = canPlatform(actor.platformRole, 'admin.team.write');
    const d = (key: string, ok: boolean, perm: boolean, reasonCode?: string): ActionDescriptor => (perm && ok ? { key, enabled: true } : { key, enabled: false, reasonCode: !perm ? 'FORBIDDEN' : reasonCode });
    return offered([
      { key: 'open', enabled: true, primary: true },
      d('resend_verification', !u.emailVerifiedAt, w, STATE_REFUSED),
      d('reset_password', u.status === 'active', w, 'AUTH_USER_BLOCKED'),
      d('disable_2fa', u.totpEnabled && u.platformRole === 'none', w, !u.totpEnabled ? STATE_REFUSED : 'TWO_FA_REQUIRED_FOR_ROLE'),
      d('revoke_sessions', true, w),
      d('promote', u.id !== actor.userId, team, 'ADMIN_CANNOT_DEMOTE_SELF'),
      u.status === 'blocked' ? d('unblock', true, w) : d('block', u.id !== actor.userId, w, 'ADMIN_CANNOT_DEMOTE_SELF'),
      d('schedule_deletion', u.status !== 'deletion_scheduled' && !u.ownedWorkspaceId, w, u.ownedWorkspaceId ? 'ACCOUNT_OWNS_WORKSPACE' : 'ACCOUNT_DELETION_PENDING'),
    ]);
  }

  async detail(id: string, actor: AdminActor): Promise<AdminUserDetailDto> {
    await this.userOr404(id);
    const u = await prisma.user.findUniqueOrThrow({ where: { id }, include: { memberships: { include: { workspace: { select: { id: true, name: true } } } } } });
    const [tokens, devices, lastAction, tickets, reports, deletion] = await Promise.all([
      prisma.refreshToken.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.deviceToken.findMany({ where: { userId: id }, orderBy: { lastSeenAt: 'desc' } }),
      prisma.auditLog.findFirst({ where: { actorId: id }, orderBy: { at: 'desc' }, select: { action: true, at: true } }),
      prisma.supportTicket.count({ where: { userId: id } }),
      prisma.report.count({ where: { reporterUserId: id } }),
      prisma.accountDeletionRequest.findFirst({ where: { userId: id }, orderBy: { requestedAt: 'desc' } }),
    ]);
    const families = new Map<string, (typeof tokens)[number][]>();
    for (const t of tokens) families.set(t.familyId, [...(families.get(t.familyId) ?? []), t]);
    const device = (ua: string | null) => (ua ? (/iPhone|iOS/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Web') : null);
    return {
      ...this.row(u, actor),
      locale: u.locale,
      blockedAt: iso(u.blockedAt),
      blockReason: u.blockReason,
      ownedWorkspaceId: u.ownedWorkspaceId,
      sessions: [...families.entries()].map(([familyId, rows]) => ({ familyId, device: device(rows[0]!.userAgent), platform: rows[0]!.userAgent && /Djaber/i.test(rows[0]!.userAgent) ? 'mobile' : 'web', ip: rows[0]!.ip ? rows[0]!.ip.replace(/\.\d+\.\d+$/, '.x.x') : null, lastUsedAt: rows[0]!.createdAt.toISOString(), createdAt: rows[rows.length - 1]!.createdAt.toISOString() })),
      devices: devices.map((d) => ({ platform: d.platform, deviceName: d.deviceName, appVersion: d.appVersion, lastSeenAt: d.lastSeenAt.toISOString() })),
      activity: { lastAction: lastAction ? { action: lastAction.action, at: lastAction.at.toISOString() } : null, tickets, reports },
      deletion: deletion ? { id: deletion.id, status: deletion.status, scheduledAt: iso(deletion.scheduledAt), blockedReason: deletion.blockedReason } : null,
    };
  }

  // --- writes --------------------------------------------------------------------------------------------------------------
  async patch(id: string, input: AdminPatchUserInput, actor: AdminActor) {
    const reason = requireReason(input.reason);
    const u = await this.userOr404(id);
    const data: Prisma.UserUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.locale !== undefined) data.locale = input.locale;
    await prisma.user.update({ where: { id }, data });
    await this.log(actor, 'user.update', 'User', id, { firstName: u.firstName, lastName: u.lastName, phone: u.phone, locale: u.locale }, data, reason);
    return this.detail(id, actor);
  }

  async action(id: string, kind: 'resend-verification' | 'reset-password' | 'disable-2fa' | 'revoke-sessions' | 'block' | 'unblock', reasonIn: string, actor: AdminActor, ticketId?: string) {
    const reason = requireReason(reasonIn);
    const u = await this.userOr404(id);
    let after: Record<string, unknown> = {};
    switch (kind) {
      case 'resend-verification': {
        if (u.emailVerifiedAt) throw new AppException('CONFLICT', {}, {}, { reason: 'ALREADY_VERIFIED' });
        const ok = await this.redis.client.set(`cooldown:admin-verify:${id}`, '1', 'EX', ADMIN_RESEND_VERIFICATION_COOLDOWN_MIN * 60, 'NX');
        if (!ok) throw new AppException('RATE_LIMITED', { retryAfter: ADMIN_RESEND_VERIFICATION_COOLDOWN_MIN * 60 });
        await this.auth.sendVerification(u, 'auth/verify', `admin-verify:${id}:${Date.now()}`);
        break;
      }
      case 'reset-password': {
        if (u.status === 'blocked') throw new AppException('AUTH_USER_BLOCKED');
        await prisma.$transaction(async (db) => {
          const tx = db as Tx;
          const token = await this.emailTokens.create(id, 'reset', undefined, tx);
          await this.mail.send({ to: u.email, template: 'auth/reset', locale: u.locale, secret: { url: this.web(`/reset-password?token=${token}`) }, key: `admin-reset:${id}:${Date.now()}` }, tx);
        });
        break;
      }
      case 'disable-2fa':
        if (u.platformRole !== 'none') throw new AppException('TWO_FA_REQUIRED_FOR_ROLE');
        if (!u.totpEnabled) throw new AppException('CONFLICT', {}, {}, { reason: 'TWO_FA_OFF' });
        await this.twoFactor.disable(id);
        after = { totpEnabled: false, ticketId: ticketId ?? null };
        break;
      case 'revoke-sessions':
        after = { revoked: await TenantContext.runSystem(() => this.sessions.revokeAll(id)) };
        break;
      case 'block':
        if (id === actor.userId) throw new AppException('ADMIN_CANNOT_DEMOTE_SELF');
        if (u.status === 'blocked') throw new AppException('CONFLICT', {}, {}, { status: u.status });
        await prisma.user.update({ where: { id }, data: { status: 'blocked', blockedAt: new Date(), blockReason: reason } });
        await TenantContext.runSystem(() => this.sessions.revokeAll(id));
        after = { status: 'blocked' };
        break;
      case 'unblock':
        if (u.status !== 'blocked') throw new AppException('CONFLICT', {}, {}, { status: u.status });
        await prisma.user.update({ where: { id }, data: { status: 'active', blockedAt: null, blockReason: null } });
        after = { status: 'active' };
        break;
    }
    const action = { 'resend-verification': 'user.resend_verification', 'reset-password': 'user.reset_password', 'disable-2fa': 'user.2fa_disable', 'revoke-sessions': 'user.revoke_sessions', block: 'user.block', unblock: 'user.unblock' }[kind];
    await this.log(actor, action, 'User', id, { status: u.status, totpEnabled: u.totpEnabled }, after, reason);
    return this.detail(id, actor);
  }

  /** `POST /admin/users/:id/platform-role { platformRole, totpCode }` (PRL-02): actor's TOTP required; never on oneself. */
  async setPlatformRole(id: string, input: AdminPlatformRoleInput, actor: AdminActor) {
    const target = await this.userOr404(id);
    if (id === actor.userId) throw new AppException('ADMIN_CANNOT_DEMOTE_SELF');
    const me = await TenantContext.runSystem(() => prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }));
    if (!me.totpEnabled || !input.totpCode) throw new AppException('TWO_FA_CONFIRMATION_REQUIRED', {}, { totpCode: 'validation.required' });
    this.reauth.assertTotpIfEnabled(me, input.totpCode);
    if (input.platformRole !== 'none' && !target.email.toLowerCase().endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) throw new AppException('ADMIN_EMAIL_DOMAIN_INVALID');
    await prisma.user.update({ where: { id }, data: { platformRole: input.platformRole } });
    // the access token carries `pr`: force a fresh login so the new role applies at once
    await TenantContext.runSystem(() => this.sessions.revokeAll(id));
    await this.log(actor, 'user.platform_role_change', 'User', id, { platformRole: target.platformRole }, { platformRole: input.platformRole, twoFactor: true }, input.reason?.trim() || null);
    return this.detail(id, actor);
  }

  // --- platform team (ADM-16) ----------------------------------------------------------------------------------------------
  async team(actor: AdminActor): Promise<PlatformTeamDto> {
    const [users, invites] = await Promise.all([
      prisma.user.findMany({ where: { platformRole: { not: 'none' }, deletedAt: null }, orderBy: [{ platformRole: 'desc' }, { createdAt: 'asc' }] }),
      prisma.platformInvitation.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, include: { invitedBy: { select: userSelect } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const last = users.length ? await prisma.$queryRaw<{ actorId: string; action: string; at: Date }[]>`SELECT DISTINCT ON ("actorId") "actorId", "action", "at" FROM "AuditLog" WHERE "actorId" IN (${Prisma.join(users.map((u) => Prisma.sql`${u.id}::uuid`))}) ORDER BY "actorId", "at" DESC` : [];
    const team = canPlatform(actor.platformRole, 'admin.team.write');
    // full-test 15/11 ADMIN-12 (PRL-02 / D41): « accès bloqué » only when the 2FA rule is enforced for that member — not
    // during the owner's dated pause `PLATFORM_2FA_OFF_UNTIL` (then the day it applies from is given) nor for a test exemption
    const paused = twoFaPaused();
    const until = paused ? this.config.get('PLATFORM_2FA_OFF_UNTIL') : '';
    const requiredFrom = until ? new Date(Date.parse(`${until}T12:00:00Z`) + DAY).toISOString().slice(0, 10) : null;
    return {
      members: users.map((u) => {
        const l = last.find((r) => r.actorId === u.id);
        return {
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          platformRole: u.platformRole,
          totpEnabled: u.totpEnabled,
          accessBlocked: u.status !== 'active' || (!u.totpEnabled && !twoFaExempt(u.email)),
          twoFaRequiredFrom: !u.totpEnabled && paused ? requiredFrom : null,
          lastAction: l ? { action: l.action, at: l.at.toISOString() } : null,
          lastLoginAt: iso(u.lastLoginAt),
          actions: [
            { key: 'edit', enabled: team && u.id !== actor.userId, ...(team && u.id !== actor.userId ? {} : { reasonCode: team ? 'ADMIN_CANNOT_DEMOTE_SELF' : 'FORBIDDEN' }) },
            { key: 'force_2fa', enabled: team && u.id !== actor.userId, ...(team && u.id !== actor.userId ? {} : { reasonCode: team ? 'ADMIN_CANNOT_DEMOTE_SELF' : 'FORBIDDEN' }) },
          ],
        };
      }),
      invitations: invites.map((i) => ({ id: i.id, email: i.email, platformRole: i.platformRole, invitedBy: userRef(i.invitedBy), expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString(), acceptedAt: iso(i.acceptedAt) })),
    };
  }

  /**
   * `POST /admin/platform-members/invitations` (PRL-02): `@djaber.ai` only. An existing account gets the role at once; a new
   * one is created with the role and receives a "choose your password" link. 2FA is enabled at first login (access blocked until then).
   */
  async invite(input: AdminInviteMemberInput, actor: AdminActor) {
    if (!input.email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) throw new AppException('ADMIN_EMAIL_DOMAIN_INVALID', {}, { email: 'validation.email' });
    if (input.platformRole === 'none') throw new AppException('VALIDATION_ERROR', {}, { platformRole: 'validation.invalid' });
    const raw = randomBytes(32).toString('hex');
    const inv = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      let user = await tx.user.findUnique({ where: { email: input.email } });
      if (user?.platformRole && user.platformRole !== 'none') throw new AppException('CONFLICT', {}, { email: 'validation.taken' });
      user = user
        ? await tx.user.update({ where: { id: user.id }, data: { platformRole: input.platformRole } })
        : await tx.user.create({ data: { email: input.email, passwordHash: `!platform-invite:${randomBytes(24).toString('hex')}`, firstName: input.email.split('@')[0]!, lastName: '', platformRole: input.platformRole, emailVerifiedAt: new Date() } });
      const row = await tx.platformInvitation.create({ data: { email: input.email, platformRole: input.platformRole, tokenHash: createHash('sha256').update(raw).digest('hex'), invitedById: actor.userId, expiresAt: new Date(Date.now() + 7 * DAY), ...(user.lastLoginAt ? { acceptedAt: new Date() } : {}) } });
      const token = await this.emailTokens.create(user.id, 'reset', undefined, tx);
      await this.mail.send({ to: user.email, template: 'auth/reset', locale: user.locale, secret: { url: this.web(`/reset-password?token=${token}`) }, key: `platform-invite:${row.id}` }, tx);
      return row;
    });
    await this.log(actor, 'platform_member.invite', 'PlatformInvitation', inv.id, null, { email: input.email, platformRole: input.platformRole }, null);
    return { id: inv.id, email: inv.email, platformRole: inv.platformRole, invitedBy: null, expiresAt: inv.expiresAt.toISOString(), createdAt: inv.createdAt.toISOString(), acceptedAt: iso(inv.acceptedAt) };
  }

  async revokeInvitation(id: string, actor: AdminActor) {
    assertUuid(id);
    const inv = await prisma.platformInvitation.findUnique({ where: { id } });
    if (!inv) throw notFound();
    if (inv.acceptedAt) throw new AppException('CONFLICT', {}, {}, { reason: 'ACCEPTED' });
    await prisma.$transaction(async (db) => {
      await db.platformInvitation.delete({ where: { id } });
      // the account created by the invitation loses the role (never logged in)
      await db.user.updateMany({ where: { email: inv.email, lastLoginAt: null, platformRole: inv.platformRole }, data: { platformRole: 'none' } });
    });
    await this.log(actor, 'platform_member.invitation_revoke', 'PlatformInvitation', id, { email: inv.email, platformRole: inv.platformRole }, null, null);
  }

  /** "Forcer la 2FA": the member's 2FA is reset (secret wiped, sessions revoked) — access blocked until re-enrolled. */
  async force2fa(userId: string, actor: AdminActor, reason: string) {
    const u = await this.userOr404(userId);
    if (u.platformRole === 'none') throw notFound();
    if (userId === actor.userId) throw new AppException('ADMIN_CANNOT_DEMOTE_SELF');
    await this.twoFactor.disable(userId);
    await TenantContext.runSystem(() => this.sessions.revokeAll(userId));
    await this.log(actor, 'platform_member.force_2fa', 'User', userId, { totpEnabled: u.totpEnabled }, { totpEnabled: false }, reason);
    return this.team(actor);
  }

  // --- account deletion requests (ADM-16, DEL-02/04) -----------------------------------------------------------------------
  private async blockedReasons(userId: string): Promise<Blocked[]> {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const out: Blocked[] = [];
    if (u.ownedWorkspaceId) {
      const ws = await prisma.workspace.findUnique({ where: { id: u.ownedWorkspaceId } });
      if (ws && !ws.deletedAt && ws.status !== 'deletion_scheduled') out.push('ACCOUNT_OWNS_WORKSPACE');
      if (ws) {
        const debt = await prisma.invoice.count({ where: { workspaceId: ws.id, status: 'unpaid' } });
        if (debt) out.push('WORKSPACE_HAS_DEBT');
      }
    }
    return out;
  }

  private async toDeletionDtos(rows: AccountDeletionRequest[], actor: AdminActor): Promise<DeletionRequestAdminDto[]> {
    if (!rows.length) return [];
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { ...userSelect, ownedWorkspaceId: true, memberships: { include: { workspace: { select: { id: true, name: true, status: true } } } } } });
    const can = canPlatform(actor.platformRole, 'admin.deletion.write');
    const out: DeletionRequestAdminDto[] = [];
    for (const r of rows) {
      const u = users.find((x) => x.id === r.userId)!;
      const open = (OPEN_DELETION as readonly string[]).includes(r.status);
      const reasons = r.status === 'blocked' ? await this.blockedReasons(r.userId) : [];
      const a = (key: string, ok: boolean): ActionDescriptor => (can && ok ? { key, enabled: true } : { key, enabled: false, reasonCode: can ? STATE_REFUSED : 'FORBIDDEN' });
      out.push({
        id: r.id,
        source: r.source,
        status: r.status,
        requestedAt: r.requestedAt.toISOString(),
        confirmedAt: iso(r.confirmedAt),
        scheduledAt: iso(r.scheduledAt),
        cancelledAt: iso(r.cancelledAt),
        processedAt: iso(r.processedAt),
        user: userRef(u)!,
        workspaces: u.memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role, status: m.workspace.status })),
        blockedReason: (r.blockedReason as Blocked | null) ?? null,
        blockedReasons: reasons.length ? reasons : r.blockedReason ? [r.blockedReason as Blocked] : [],
        exportSentAt: r.status === 'grace' || r.status === 'anonymised' ? iso(r.confirmedAt) : null,
        membershipsRemoved: r.status === 'grace' || r.status === 'anonymised',
        actions: offered([{ key: 'view', enabled: true, primary: true }, a('cancel', open), a('resolve', r.status === 'blocked'), a('process_now', r.status === 'grace')]),
      });
    }
    return out;
  }

  async deletionRequests(q: { page: number; pageSize: number; status?: string[]; q?: string }, actor: AdminActor) {
    const where: Prisma.AccountDeletionRequestWhereInput = {
      ...(q.status?.length ? { status: { in: q.status as never } } : {}),
      ...(q.q ? { user: { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }] } } : {}),
    };
    const [total, rows, toProcess, blocked] = await Promise.all([
      prisma.accountDeletionRequest.count({ where }),
      prisma.accountDeletionRequest.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
      prisma.accountDeletionRequest.count({ where: { status: { in: ['pending_confirmation', 'grace', 'blocked'] } } }),
      prisma.accountDeletionRequest.count({ where: { status: 'blocked' } }),
    ]);
    return { ...page(await this.toDeletionDtos(rows, actor), total, q), meta: { counts: { toProcess, blocked } } };
  }

  async deletionRequest(id: string, actor: AdminActor) {
    assertUuid(id);
    const r = await prisma.accountDeletionRequest.findUnique({ where: { id } });
    if (!r) throw notFound();
    return (await this.toDeletionDtos([r], actor))[0]!;
  }

  /** Grace entry (04 §16): account deactivated, memberships (non-owner) removed, sessions / devices revoked, e-mail. */
  private async enterGrace(tx: Tx, req: { id?: string; userId: string; source: 'admin' | 'app' | 'public_page' }, actor: AdminActor) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: req.userId } });
    const s = await tx.platformSetting.findUnique({ where: { key: 'limits' } });
    const days = (s?.value as { deletionGraceDays?: number } | null)?.deletionGraceDays ?? 30;
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + days * DAY);
    const memberships = await tx.membership.findMany({ where: { userId: user.id, role: { not: 'owner' } } });
    for (const m of memberships) {
      await tx.conversation.updateMany({ where: { workspaceId: m.workspaceId, assigneeId: user.id }, data: { assigneeId: null } });
      await tx.order.updateMany({ where: { workspaceId: m.workspaceId, assigneeId: user.id }, data: { assigneeId: null } });
    }
    await tx.membership.deleteMany({ where: { userId: user.id, role: { not: 'owner' } } });
    await tx.deviceToken.deleteMany({ where: { userId: user.id } });
    await this.sessions.revokeAll(user.id, {}, tx);
    await tx.user.update({ where: { id: user.id }, data: { status: 'deletion_scheduled' } });
    const data = { status: 'grace' as const, blockedReason: null, confirmedAt: now, scheduledAt, processedById: actor.userId };
    const row = req.id ? await tx.accountDeletionRequest.update({ where: { id: req.id }, data }) : await tx.accountDeletionRequest.create({ data: { userId: user.id, source: req.source, ...data } });
    await this.mail.send({ to: user.email, template: 'auth/account-deletion-confirm', locale: user.locale, params: { scheduledAt: scheduledAt.toISOString(), url: this.web('/login') }, key: `account-deletion:${row.id}:${now.getTime()}` }, tx);
    return { row, workspaces: memberships.map((m) => m.workspaceId) };
  }

  /** `DELETE /admin/users/:id { reason }` — admin-scheduled deletion (`source=admin`), same guards as the user flow. */
  async scheduleUserDeletion(id: string, reasonIn: string, actor: AdminActor) {
    const reason = requireReason(reasonIn);
    const u = await this.userOr404(id);
    if (id === actor.userId) throw new AppException('ADMIN_CANNOT_DEMOTE_SELF');
    const open = await prisma.accountDeletionRequest.findFirst({ where: { userId: id, status: { in: [...OPEN_DELETION] } } });
    if (open?.status === 'grace') throw new AppException('ACCOUNT_DELETION_PENDING', { scheduledAt: open.scheduledAt?.toISOString() ?? '' });
    const reasons = await this.blockedReasons(id);
    if (reasons.length) {
      const data = { status: 'blocked' as const, blockedReason: reasons[0]! };
      if (open) await prisma.accountDeletionRequest.update({ where: { id: open.id }, data });
      else await prisma.accountDeletionRequest.create({ data: { userId: id, source: 'admin', ...data } });
      await this.log(actor, 'account.deletion_blocked', 'User', id, null, { blockedReasons: reasons }, reason);
      throw new AppException(reasons[0]!);
    }
    const out = await prisma.$transaction((db) => this.enterGrace(db as Tx, { id: open?.id, userId: id, source: 'admin' }, actor));
    for (const w of out.workspaces) await this.tenants.invalidate(w);
    await this.log(actor, 'account.deletion_scheduled', 'User', id, { status: u.status }, { status: 'deletion_scheduled', scheduledAt: iso(out.row.scheduledAt) }, reason);
    return this.detail(id, actor);
  }

  async deletionAction(id: string, kind: 'cancel' | 'resolve' | 'process-now', reasonIn: string, actor: AdminActor) {
    const reason = requireReason(reasonIn);
    assertUuid(id);
    const r = await prisma.accountDeletionRequest.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (kind === 'cancel') {
      if (!(OPEN_DELETION as readonly string[]).includes(r.status)) throw new AppException('CONFLICT', {}, {}, { status: r.status });
      await prisma.$transaction(async (db) => {
        await db.accountDeletionRequest.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), processedById: actor.userId } });
        await db.user.updateMany({ where: { id: r.userId, status: 'deletion_scheduled' }, data: { status: 'active' } });
      });
    } else if (kind === 'resolve') {
      if (r.status !== 'blocked') throw new AppException('CONFLICT', {}, {}, { status: r.status });
      const reasons = await this.blockedReasons(r.userId);
      if (reasons.length) {
        // AT-DEL-03: stays BLOQUÉE until the cause is gone (ownership transferred / workspace deleted, invoice paid)
        await prisma.accountDeletionRequest.update({ where: { id }, data: { blockedReason: reasons[0]! } });
      } else {
        const out = await prisma.$transaction((db) => this.enterGrace(db as Tx, { id, userId: r.userId, source: r.source }, actor));
        for (const w of out.workspaces) await this.tenants.invalidate(w);
      }
    } else {
      if (r.status !== 'grace') throw new AppException('CONFLICT', {}, {}, { status: r.status });
      await prisma.accountDeletionRequest.update({ where: { id }, data: { scheduledAt: new Date(), processedById: actor.userId } });
      await this.deletions.anonymiseDue(new Date());
    }
    const after = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id } });
    await this.log(actor, `account.deletion_${kind.replace('-', '_')}`, 'AccountDeletionRequest', id, { status: r.status, blockedReason: r.blockedReason }, { status: after.status, blockedReason: after.blockedReason }, reason);
    return (await this.toDeletionDtos([after], actor))[0]!;
  }
}
