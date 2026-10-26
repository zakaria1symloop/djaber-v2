// FL-13 — invitations: 7-day opaque token (SHA-256 stored), resend with a 60 s cooldown, revoke, public preview, accept.
// Plan limit: inviting beyond `maxMembers` ⇒ 403 PLAN_LIMIT; a member accepted while the workspace is over the limit
// (plan downgraded meanwhile) joins read-only (12-screen-states "limite du plan").
import { Injectable } from '@nestjs/common';
import { prisma, TenantContext, type Invitation, type Tx, type User } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { dbOf } from '../../core/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { OutboxService } from '../../core/outbox/outbox.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import type { ClientInfo } from '../auth/session.service';
import { NotificationProducer } from '../notifications/notification.producer';

const INVITE_TTL_MS = 7 * 86_400_000;
export const RESEND_COOLDOWN_S = 60;

export const toInvitationDto = (i: Invitation) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  sentAt: i.lastSentAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
  resendAvailableAt: new Date(i.lastSentAt.getTime() + RESEND_COOLDOWN_S * 1000).toISOString(),
});

@Injectable()
export class InvitationService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly mail: MailOutbox,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tenants: TenantResolver,
    private readonly notifications: NotificationProducer,
  ) {}

  private link(token: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}/invitations/${token}`;
  }

  private async sendMail(tx: Tx, inv: Invitation, token: string, inviter: User, workspace: { name: string; locale: string }) {
    const invitee = await tx.user.findUnique({ where: { email: inv.email } });
    await this.mail.send(
      {
        to: inv.email,
        template: 'workspace/invitation',
        locale: invitee?.locale ?? workspace.locale,
        params: {
          inviterName: `${inviter.firstName} ${inviter.lastName}`.trim(),
          workspaceName: workspace.name,
          role: inv.role,
          expiresAt: inv.expiresAt.toISOString(),
        },
        secret: { url: this.link(token) },
        key: `invitation:${inv.id}:${inv.lastSentAt.getTime()}`,
        workspaceId: inv.workspaceId,
      },
      tx,
    );
  }

  /** `GET /workspace/invitations` — pending invitations (expired ones stay listed so they can be resent or revoked). */
  async list() {
    const rows = await prisma.invitation.findMany({ where: { acceptedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(toInvitationDto);
  }

  /** `POST /workspace/invitations { email, role }` */
  async create(input: { email: string; role: 'admin' | 'operator' }, client: ClientInfo) {
    const t = TenantContext.get();
    const now = new Date();
    const token = this.crypto.randomToken(32);
    const inv = await prisma.$transaction(async (tx) => {
      const [existingMember, pending, members, workspace, inviter] = await Promise.all([
        tx.membership.findFirst({ where: { user: { email: input.email } } }),
        tx.invitation.findFirst({ where: { email: input.email, acceptedAt: null } }),
        tx.membership.count(),
        tx.workspace.findUniqueOrThrow({ where: { id: t.workspaceId } }),
        tx.user.findUniqueOrThrow({ where: { id: t.userId! } }),
      ]);
      if (existingMember) throw new AppException('MEMBER_ALREADY_EXISTS', {}, { email: 'validation.invalid' });
      if (pending && pending.expiresAt > now) throw new AppException('INVITATION_PENDING', {}, { email: 'validation.invalid' });
      if (pending) await tx.invitation.delete({ where: { id: pending.id } });
      const max = t.limits.maxMembers;
      if (max !== -1) {
        const open = await tx.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } });
        if (members + open >= max) throw new AppException('PLAN_LIMIT', { resource: 'members', limit: max, current: members + open });
      }
      const row = await tx.invitation.create({
        data: {
          workspaceId: t.workspaceId,
          email: input.email,
          role: input.role,
          tokenHash: this.crypto.sha256(token),
          invitedById: t.userId!,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          lastSentAt: now,
        },
      });
      await this.sendMail(tx, row, token, inviter, workspace);
      // 03-events §5.1 `member.invited`: in-app, Owner + Admins (the e-mail goes to the invitee)
      await this.notifications.emit(tx, {
        type: 'member_invited',
        workspaceId: t.workspaceId,
        target: { roles: ['owner', 'admin'] },
        key: `member_invited:${row.id}`,
        data: { invitationId: row.id, email: row.email, role: row.role },
      });
      return row;
    });
    await this.audit.write({
      workspaceId: t.workspaceId,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'invitation.create',
      entity: 'Invitation',
      entityId: inv.id,
      after: { email: inv.email, role: inv.role },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return toInvitationDto(inv);
  }

  private async pendingById(tx: Tx, id: string) {
    const inv = await tx.invitation.findFirst({ where: { id, acceptedAt: null } });
    if (!inv) throw notFound();
    return inv;
  }

  /** `POST /workspace/invitations/:id/resend` — new link (the previous one stops working), 60 s cooldown. */
  async resend(id: string, client: ClientInfo) {
    const t = TenantContext.get();
    const token = this.crypto.randomToken(32);
    const inv = await prisma.$transaction(async (tx) => {
      const current = await this.pendingById(tx, id);
      const waitMs = current.lastSentAt.getTime() + RESEND_COOLDOWN_S * 1000 - Date.now();
      if (waitMs > 0) throw new AppException('RATE_LIMITED', { retryAfter: Math.ceil(waitMs / 1000) });
      const now = new Date();
      const row = await tx.invitation.update({
        where: { id },
        data: { tokenHash: this.crypto.sha256(token), lastSentAt: now, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) },
      });
      const [workspace, inviter] = await Promise.all([
        tx.workspace.findUniqueOrThrow({ where: { id: t.workspaceId } }),
        tx.user.findUniqueOrThrow({ where: { id: t.userId! } }),
      ]);
      await this.sendMail(tx, row, token, inviter, workspace);
      return row;
    });
    await this.audit.write({
      workspaceId: t.workspaceId,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'invitation.resend',
      entity: 'Invitation',
      entityId: id,
      after: { email: inv.email },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return toInvitationDto(inv);
  }

  /** `DELETE /workspace/invitations/:id` */
  async revoke(id: string, client: ClientInfo) {
    const t = TenantContext.get();
    const inv = await prisma.$transaction(async (tx) => {
      const current = await this.pendingById(tx, id);
      await tx.invitation.delete({ where: { id } });
      return current;
    });
    await this.audit.write({
      workspaceId: t.workspaceId,
      actorType: 'user',
      actorId: t.userId,
      actorRole: t.role,
      action: 'invitation.revoke',
      entity: 'Invitation',
      entityId: id,
      before: { email: inv.email, role: inv.role },
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  /** Token → usable invitation (system context). Unknown ⇒ 404; accepted, revoked or past 7 days ⇒ 410 INVITATION_EXPIRED. */
  async byToken(token: string, tx?: Tx) {
    const inv = await TenantContext.runSystem(() =>
      dbOf(tx).invitation.findUnique({
        where: { tokenHash: this.crypto.sha256(token) },
        include: { workspace: true, invitedBy: true },
      }),
    );
    if (!inv || inv.workspace.deletedAt) throw notFound();
    if (inv.acceptedAt || inv.expiresAt <= new Date()) throw new AppException('INVITATION_EXPIRED');
    return inv;
  }

  /** `GET /invitations/:token` (public; a logged-in user with another e-mail ⇒ INVITATION_EMAIL_MISMATCH). */
  async preview(token: string, currentUserId?: string) {
    const inv = await this.byToken(token);
    if (currentUserId) {
      const user = await TenantContext.runSystem(() => prisma.user.findUnique({ where: { id: currentUserId } }));
      if (user && user.email !== inv.email) throw new AppException('INVITATION_EMAIL_MISMATCH', { email: inv.email });
    }
    // tester report 25/10: the invited e-mail may already have an account (it owns a shop) — the page then asks to sign in
    // and accept instead of offering a sign-up that ends in AUTH_EMAIL_TAKEN. Only the holder of the token learns it.
    const accountExists = !!(await TenantContext.runSystem(() => prisma.user.findFirst({ where: { email: inv.email, deletedAt: null }, select: { id: true } })));
    return {
      workspaceName: inv.workspace.name,
      workspaceLogoUrl: inv.workspace.logoUrl,
      inviterName: `${inv.invitedBy.firstName} ${inv.invitedBy.lastName}`.trim(),
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt.toISOString(),
      accountExists,
    };
  }

  /**
   * Creates the membership inside the caller's transaction (also used by sign-up through an invitation, D30).
   * The token proves the ownership of the mailbox, so the e-mail is marked verified.
   */
  async acceptInTx(tx: Tx, inv: Invitation, user: Pick<User, 'id' | 'email' | 'emailVerifiedAt'>) {
    if (user.email !== inv.email) throw new AppException('INVITATION_EMAIL_MISMATCH', { email: inv.email });
    const existing = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    if (existing) return { membership: existing, created: false };
    const ctx = await this.tenants.workspaceCtx(inv.workspaceId);
    const max = ctx?.limits.maxMembers ?? -1;
    const members = await tx.membership.count({ where: { workspaceId: inv.workspaceId } });
    const membership = await tx.membership.create({
      data: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role, readOnly: max !== -1 && members >= max },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { lastWorkspaceId: inv.workspaceId, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
    });
    await this.outbox.ws(tx, `ws:${inv.workspaceId}`, 'member.updated', {
      id: membership.id,
      membership: { userId: user.id, role: membership.role, readOnly: membership.readOnly },
    });
    // 03-events §5.1 `member.joined`: in-app, Owner + Admins
    const joined = await tx.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true } });
    await this.notifications.emit(tx, {
      type: 'member_joined',
      workspaceId: inv.workspaceId,
      target: { roles: ['owner', 'admin'], exceptUserId: user.id },
      key: `member_joined:${membership.id}`,
      data: { userId: user.id, role: membership.role, name: `${joined?.firstName ?? ''} ${joined?.lastName ?? ''}`.trim() || user.email },
    });
    return { membership, created: true };
  }

  /** `POST /invitations/:token/accept` (logged-in user). Already a member ⇒ no-op. */
  async accept(token: string, userId: string, client: ClientInfo) {
    const inv = await this.byToken(token);
    const result = await TenantContext.runSystem(() =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        return this.acceptInTx(tx, inv, user);
      }),
    );
    await this.tenants.invalidate(inv.workspaceId);
    if (result.created) {
      await this.audit.write({
        workspaceId: inv.workspaceId,
        actorType: 'user',
        actorId: userId,
        actorRole: result.membership.role,
        action: 'invitation.accept',
        entity: 'Invitation',
        entityId: inv.id,
        after: { role: result.membership.role, readOnly: result.membership.readOnly },
        ip: client.ip,
        userAgent: client.userAgent,
      });
    }
    return {
      workspaceId: inv.workspaceId,
      workspaceName: inv.workspace.name,
      role: result.membership.role,
      readOnly: result.membership.readOnly,
    };
  }
}
