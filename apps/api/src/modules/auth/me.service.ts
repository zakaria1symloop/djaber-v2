// AUTH-06 — profile: GET/PATCH /me, preferences, password change, e-mail change with confirmation, sessions.
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type User } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { FlagsService } from '../../core/flags/flags.service';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { LegalService } from '../workspace/legal.service';
import { WorkspaceService } from '../workspace/workspace.service';
import type { PrefsInput, UpdateMe } from './dto';
import { EmailTokenService } from './email-token.service';
import { ReauthService } from './reauth.service';
import { SessionService, type ClientInfo } from './session.service';

const DEFAULT_PREFS = { listDensity: 'comfortable', soundOnMessage: true, dismissedAnnouncementIds: [] as string[], reportFavorites: [] as string[] };
export type UserPrefs = typeof DEFAULT_PREFS;

export const prefsOf = (raw: unknown): UserPrefs => {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<UserPrefs>;
  return {
    listDensity: p.listDensity === 'compact' ? 'compact' : 'comfortable',
    soundOnMessage: typeof p.soundOnMessage === 'boolean' ? p.soundOnMessage : DEFAULT_PREFS.soundOnMessage,
    dismissedAnnouncementIds: Array.isArray(p.dismissedAnnouncementIds) ? p.dismissedAnnouncementIds.map(String) : [],
    reportFavorites: Array.isArray(p.reportFavorites) ? p.reportFavorites.map(String) : [],
  };
};

@Injectable()
export class MeService {
  constructor(
    private readonly legal: LegalService,
    private readonly workspaces: WorkspaceService,
    private readonly flags: FlagsService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly reauth: ReauthService,
    private readonly emailTokens: EmailTokenService,
    private readonly mail: MailOutbox,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * MeDto (api-contract §3.1) + the current-workspace summary and the feature flags the web shell needs.
   * Current workspace = valid `X-Workspace-Id`, else the owned workspace, else the last used one, else the first membership.
   */
  async me(userId: string, headerWorkspaceId?: unknown, locale?: string) {
    return TenantContext.runSystem(async () => {
      const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
      if (!user) throw new AppException('UNAUTHORIZED');
      const [memberships, deletion, pendingLegal] = await Promise.all([
        prisma.membership.findMany({
          where: { userId, workspace: { deletedAt: null } },
          include: { workspace: { select: { id: true, name: true, logoUrl: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.accountDeletionRequest.findFirst({ where: { userId, status: 'grace' } }),
        this.legal.pendingFor(userId),
      ]);
      const ids = memberships.map((m) => m.workspaceId);
      const wanted = typeof headerWorkspaceId === 'string' ? headerWorkspaceId : undefined;
      const currentId =
        [wanted, user.ownedWorkspaceId ?? undefined, user.lastWorkspaceId ?? undefined].find((id) => !!id && ids.includes(id)) ?? ids[0] ?? null;
      const l = locale ?? user.locale;
      const workspace = currentId ? await this.workspaces.summaryFor(userId, currentId, l) : null;
      return {
        ...this.profile(user),
        memberships: memberships.map((m) => ({
          workspaceId: m.workspaceId,
          name: m.workspace.name,
          logoUrl: m.workspace.logoUrl,
          role: m.role,
          readOnly: m.readOnly,
          hiddenSections: m.role === 'owner' ? [] : m.hiddenSections,
        })),
        pendingLegal,
        deletionScheduledAt: deletion?.scheduledAt ? deletion.scheduledAt.toISOString() : null,
        workspace,
        flags: currentId ? await this.flags.allFor(currentId, 'web') : {},
      };
    });
  }

  /** Never exposes `passwordHash`, the TOTP secret or the recovery codes. */
  private profile(user: User) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      locale: user.locale,
      avatarUrl: user.avatarUrl,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      totpEnabled: user.totpEnabled,
      platformRole: user.platformRole,
      status: user.status,
      ownedWorkspaceId: user.ownedWorkspaceId,
      prefs: prefsOf(user.prefs),
    };
  }

  async update(userId: string, input: UpdateMe, headerWorkspaceId?: unknown) {
    const { avatarUploadId, ...fields } = input;
    const data: Record<string, unknown> = { ...fields };
    await TenantContext.runSystem(async () => {
      if (avatarUploadId !== undefined) {
        if (avatarUploadId === null) data.avatarUrl = null;
        else {
          const upload = await prisma.upload.findFirst({ where: { id: avatarUploadId, kind: 'avatar', createdById: userId } });
          if (!upload) throw validationError({ avatarUploadId: 'validation.invalid' });
          data.avatarUrl = upload.url;
        }
      }
      if (Object.keys(data).length) await prisma.user.update({ where: { id: userId }, data });
    });
    return this.me(userId, headerWorkspaceId, input.locale);
  }

  async setAvatar(userId: string, url: string) {
    await TenantContext.runSystem(() => prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } }));
  }

  async getPrefs(userId: string) {
    const user = await this.reauth.user(userId);
    return prefsOf(user.prefs);
  }

  async patchPrefs(userId: string, input: PrefsInput) {
    const next = { ...(await this.getPrefs(userId)), ...input };
    await TenantContext.runSystem(() => prisma.user.update({ where: { id: userId }, data: { prefs: next } }));
    return next;
  }

  /** `PATCH /me/password` — the current session stays, every other session is revoked (AUTH-04). */
  async changePassword(userId: string, currentPassword: string, newPassword: string, currentFamilyId: string | undefined, client: ClientInfo) {
    await this.reauth.assertPassword(userId, currentPassword, 'AUTH_CURRENT_PASSWORD_INCORRECT', 'currentPassword');
    const passwordHash = await this.crypto.hashPassword(newPassword);
    await TenantContext.runSystem(() => prisma.user.update({ where: { id: userId }, data: { passwordHash } }));
    const revoked = await this.sessions.revokeAll(userId, { exceptFamilyId: currentFamilyId });
    await this.audit.write({ actorType: 'user', actorId: userId, action: 'auth.password_change', entity: 'User', entityId: userId, after: { sessionsRevoked: revoked }, ip: client.ip, userAgent: client.userAgent });
    return { sessionsRevoked: revoked };
  }

  /** `POST /me/email-change { email, password }` — link (24 h) to the new address, notice to the current one. */
  async requestEmailChange(userId: string, newEmail: string, password: string, client: ClientInfo) {
    const user = await this.reauth.assertPassword(userId, password, 'AUTH_CURRENT_PASSWORD_INCORRECT');
    if (newEmail === user.email) throw validationError({ email: 'validation.invalid' });
    await TenantContext.runSystem(async () => {
      if (await prisma.user.findUnique({ where: { email: newEmail } })) throw new AppException('AUTH_EMAIL_TAKEN');
      await prisma.$transaction(async (tx) => {
        const token = await this.emailTokens.create(userId, 'change_email', { newEmail }, tx);
        const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
        const stamp = Date.now();
        await this.mail.send(
          { to: newEmail, template: 'auth/email-change', locale: user.locale, params: { newEmail }, secret: { url: `${web}/verify-email?token=${token}` }, key: `email-change:${userId}:${stamp}` },
          tx,
        );
        await this.mail.send({ to: user.email, template: 'auth/email-change-notice', locale: user.locale, params: { newEmail }, key: `email-change-notice:${userId}:${stamp}` }, tx);
      });
    });
    await this.audit.write({ actorType: 'user', actorId: userId, action: 'auth.email_change_requested', entity: 'User', entityId: userId, ip: client.ip, userAgent: client.userAgent });
    return { pendingEmail: newEmail };
  }

  listSessions(userId: string, currentFamilyId?: string) {
    return this.sessions.list(userId, currentFamilyId);
  }

  async revokeSession(userId: string, sessionId: string, client: ClientInfo) {
    const n = await this.sessions.revokeFamily(userId, sessionId);
    if (!n) throw notFound();
    await this.audit.write({ actorType: 'user', actorId: userId, action: 'auth.session_revoke', entity: 'User', entityId: userId, after: { sessionId }, ip: client.ip, userAgent: client.userAgent });
  }
}
