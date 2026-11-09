// AUTH-07 / DEL-01…03 / 04 §16 / FL-22 — account deletion: in-app request (password + 2FA) and public page (e-mail link
// 24 h, M11), shared guards, 30-day grace, cancel, data export (job `data_export`), anonymisation at the date.
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AccountDeletionPublicDto } from '@djaber/shared';
import { prisma, TenantContext, type AccountDeletionRequest, type Tx, type User } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { MailOutbox } from '../../core/mail/mail.outbox';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { DataExportService } from './data-export.service';
import { ReauthService } from './reauth.service';
import { SessionService, type ClientInfo } from './session.service';
import { AdminNotifier } from '../notifications/admin-notifier.service';

const DAY = 86_400_000;
/** FL-22 1b: the public confirmation link is valid 24 h and single use. */
const LINK_TTL_MS = DAY;
type BlockedReason = 'ACCOUNT_OWNS_WORKSPACE' | 'WORKSPACE_HAS_DEBT';
const OPEN = ['pending_confirmation', 'grace', 'blocked'] as const;

export const toDeletionDto = (r: AccountDeletionRequest, exportUrl: string | null = null) => ({
  id: r.id,
  status: r.status,
  requestedAt: r.requestedAt.toISOString(),
  scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
  blockedReason: (r.blockedReason as BlockedReason | null) ?? null,
  exportUrl,
});

export const maskEmail = (email: string) => {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};

@Injectable()
export class AccountDeletionService {
  private readonly log = new Logger(AccountDeletionService.name);
  constructor(
    private readonly reauth: ReauthService,
    private readonly sessions: SessionService,
    private readonly mail: MailOutbox,
    private readonly audit: AuditService,
    private readonly tenants: TenantResolver,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly admins: AdminNotifier,
    private readonly exports: DataExportService,
  ) {}

  private web(path: string) {
    return `${this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '')}${path}`;
  }

  /** `GET /me/deletion-request` — the open request (grace / blocked), `null` when there is none. */
  async current(userId: string) {
    const row = await TenantContext.runSystem(() => prisma.accountDeletionRequest.findFirst({ where: { userId, status: { in: [...OPEN] } } }));
    if (!row) return null;
    const exp = row.exportJobId ? await this.exports.view(row.exportJobId) : null;
    return toDeletionDto(row, exp?.url ?? null);
  }

  /**
   * `POST /me/deletion-request { password, totpCode? }` → 202.
   * Guards (04 §16): owner of a live workspace ⇒ ACCOUNT_OWNS_WORKSPACE; unpaid invoice on an owned workspace ⇒
   * WORKSPACE_HAS_DEBT; a request already in grace ⇒ ACCOUNT_DELETION_PENDING. A guard hit is recorded as a
   * `blocked` request (admin queue "BLOQUÉE") and answered with the error.
   */
  async request(userId: string, input: { password: string; totpCode?: string | null }, client: ClientInfo) {
    const user = await this.reauth.assertPassword(userId, input.password, 'AUTH_CURRENT_PASSWORD_INCORRECT');
    this.reauth.assertTotpIfEnabled(user, input.totpCode);
    const row = await this.schedule(user, 'app', client);
    return toDeletionDto(row);
  }

  /** Guards + grace (shared by the in-app request and the public confirmation). Throws the guard error after recording it. */
  private async schedule(user: User, source: 'app' | 'public_page', client: ClientInfo, o: { exportData?: boolean; cancelTokenHash?: string } = {}): Promise<AccountDeletionRequest> {
    const outcome = await TenantContext.runSystem(async () => {
      const open = await prisma.accountDeletionRequest.findFirst({ where: { userId: user.id, status: { in: [...OPEN] } } });
      if (open?.status === 'grace') {
        return { error: new AppException('ACCOUNT_DELETION_PENDING', { scheduledAt: open.scheduledAt?.toISOString() ?? '' }) };
      }

      let blocked: { reason: BlockedReason; error: AppException } | null = null;
      if (user.ownedWorkspaceId) {
        const ws = await prisma.workspace.findUnique({ where: { id: user.ownedWorkspaceId } });
        // a workspace already in its own 30-day deletion grace no longer blocks (FL-14 comes first)
        if (ws && !ws.deletedAt && ws.status !== 'deletion_scheduled') {
          blocked = { reason: 'ACCOUNT_OWNS_WORKSPACE', error: new AppException('ACCOUNT_OWNS_WORKSPACE') };
        } else if (ws) {
          const debt = await prisma.invoice.aggregate({ where: { workspaceId: ws.id, status: 'unpaid' }, _sum: { amount: true } });
          if (debt._sum.amount) blocked = { reason: 'WORKSPACE_HAS_DEBT', error: new AppException('WORKSPACE_HAS_DEBT', { amount: debt._sum.amount }) };
        }
      }
      if (blocked) {
        const data = { status: 'blocked' as const, blockedReason: blocked.reason, ip: client.ip ?? null, tokenHash: null };
        if (open) await prisma.accountDeletionRequest.update({ where: { id: open.id }, data });
        else await prisma.accountDeletionRequest.create({ data: { userId: user.id, source, ...data } });
        return { error: blocked.error };
      }

      const now = new Date();
      const settings = await prisma.platformSetting.findUnique({ where: { key: 'limits' } });
      const days = (settings?.value as { deletionGraceDays?: number } | null)?.deletionGraceDays ?? 30;
      const scheduledAt = new Date(now.getTime() + days * DAY);
      const memberships = await prisma.membership.findMany({ where: { userId: user.id, role: { not: 'owner' } } });
      const row = await prisma.$transaction(async (tx) => {
        const data = { status: 'grace' as const, source, blockedReason: null, confirmedAt: now, scheduledAt, ip: client.ip ?? null, tokenHash: o.cancelTokenHash ?? null };
        const req = open
          ? await tx.accountDeletionRequest.update({ where: { id: open.id }, data })
          : await tx.accountDeletionRequest.create({ data: { userId: user.id, ...data } });
        await tx.user.update({ where: { id: user.id }, data: { status: 'deletion_scheduled' } });
        // owner request 09/11: the Djaber team is told
        await this.admins.notify(tx as Tx, { kind: 'account_deletion', key: `account_deletion:${user.id}:${scheduledAt.toISOString().slice(0, 10)}`, params: { email: user.email, date: scheduledAt.toISOString().slice(0, 10) }, ids: { userId: user.id } });
        // memberships removed (assignments cleared, authored content kept); sessions and device tokens revoked
        for (const m of memberships) {
          await tx.conversation.updateMany({ where: { workspaceId: m.workspaceId, assigneeId: user.id }, data: { assigneeId: null } });
          await tx.order.updateMany({ where: { workspaceId: m.workspaceId, assigneeId: user.id }, data: { assigneeId: null } });
        }
        await tx.membership.deleteMany({ where: { userId: user.id, role: { not: 'owner' } } });
        await tx.deviceToken.deleteMany({ where: { userId: user.id } });
        await this.sessions.revokeAll(user.id, {}, tx);
        await this.mail.send(
          {
            to: user.email,
            template: 'auth/account-deletion-confirm',
            locale: user.locale,
            params: { scheduledAt: scheduledAt.toISOString(), url: this.web('/login') },
            key: `account-deletion:${req.id}:${now.getTime()}`,
          },
          tx,
        );
        return req;
      });
      for (const m of memberships) await this.tenants.invalidate(m.workspaceId);
      return { row };
    });
    if ('error' in outcome && outcome.error) throw outcome.error;
    let row = outcome.row!;
    // FL-22 step 3: "Exporter mes données" (JSON + CSV, 7 days); the in-app flow offers it from the dialog instead
    if (o.exportData) {
      const job = await this.exports.start(user.id);
      row = await TenantContext.runSystem(() => prisma.accountDeletionRequest.update({ where: { id: row.id }, data: { exportJobId: job.jobId } }));
    }
    await this.audit.write({ actorType: 'user', actorId: user.id, action: 'account.deletion_requested', entity: 'User', entityId: user.id, after: { scheduledAt: row.scheduledAt?.toISOString(), source }, ip: client.ip, userAgent: client.userAgent });
    return row;
  }

  /** `DELETE /me/deletion-request` — cancel during the grace period; memberships are not restored (04 §16). */
  async cancel(userId: string, client: ClientInfo) {
    const row = await TenantContext.runSystem(async () => {
      const open = await prisma.accountDeletionRequest.findFirst({ where: { userId, status: { in: [...OPEN] } } });
      if (!open) throw notFound();
      return this.cancelRow(open);
    });
    await this.audit.write({ actorType: 'user', actorId: userId, action: 'account.deletion_cancelled', entity: 'User', entityId: userId, ip: client.ip, userAgent: client.userAgent });
    return toDeletionDto(row);
  }

  private cancelRow(open: AccountDeletionRequest) {
    return TenantContext.runSystem(() =>
      prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: open.userId }, data: { status: 'active' } });
        return tx.accountDeletionRequest.update({ where: { id: open.id }, data: { status: 'cancelled', cancelledAt: new Date(), tokenHash: null } });
      }),
    );
  }

  // --- public page (PUB-06, FL-22 1b) -------------------------------------------------------------------------------------------
  /**
   * `POST /account-deletion/request { email }` — always the same answer (no account enumeration); a known, active account
   * without a running grace gets a single-use confirmation link (24 h). The rate limit (3 / h / IP) is on the route.
   */
  async publicRequest(email: string, locale: string | undefined, client: ClientInfo): Promise<{ sent: true }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.crypto.sha256(token);
    await TenantContext.runSystem(async () => {
      const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
      if (!user || user.status === 'blocked') return;
      const open = await prisma.accountDeletionRequest.findFirst({ where: { userId: user.id, status: { in: [...OPEN] } } });
      if (open?.status === 'grace') return;
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const req = open
          ? await tx.accountDeletionRequest.update({ where: { id: open.id }, data: { status: 'pending_confirmation', source: 'public_page', tokenHash, requestedAt: now, blockedReason: null, ip: client.ip ?? null } })
          : await tx.accountDeletionRequest.create({ data: { userId: user.id, source: 'public_page', status: 'pending_confirmation', tokenHash, requestedAt: now, ip: client.ip ?? null } });
        await this.mail.send(
          { to: user.email, template: 'auth/account-deletion-request', locale: locale ?? user.locale, secret: { url: this.web(`/account/deletion?token=${token}`) }, key: `account-deletion-request:${req.id}:${now.getTime()}` },
          tx,
        );
      });
      await this.audit.write({ actorType: 'user', actorId: user.id, action: 'account.deletion_link_sent', entity: 'User', entityId: user.id, ip: client.ip, userAgent: client.userAgent });
    });
    return { sent: true };
  }

  /** Request of a confirmation link (pending, < 24 h) or of a cancel token (grace, before `scheduledAt`); 410 otherwise. */
  private async byToken(token: string): Promise<{ row: AccountDeletionRequest; user: User }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    const found = await TenantContext.runSystem(async () => {
      const row = await prisma.accountDeletionRequest.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
      const user = row ? await prisma.user.findUnique({ where: { id: row.userId } }) : null;
      return row && user ? { row, user } : null;
    });
    if (!found) throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    const { row } = found;
    const now = Date.now();
    if (row.status === 'pending_confirmation' && now - row.requestedAt.getTime() > LINK_TTL_MS) throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    if (row.status === 'grace' && row.scheduledAt && row.scheduledAt.getTime() <= now) throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    if (!['pending_confirmation', 'grace', 'blocked'].includes(row.status)) throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    return found;
  }

  private async publicDto(row: AccountDeletionRequest, user: User, cancelToken: string | null): Promise<AccountDeletionPublicDto> {
    const owned = user.ownedWorkspaceId ? await TenantContext.runSystem(() => prisma.workspace.findMany({ where: { id: user.ownedWorkspaceId!, deletedAt: null }, select: { name: true, status: true } })) : [];
    return {
      status: row.status,
      emailMasked: maskEmail(user.email),
      requestedAt: row.requestedAt.toISOString(),
      linkExpiresAt: row.status === 'pending_confirmation' ? new Date(row.requestedAt.getTime() + LINK_TTL_MS).toISOString() : null,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      blockedReason: (row.blockedReason as BlockedReason | null) ?? null,
      ownedWorkspaces: owned.map((w) => ({ name: w.name, status: w.status })),
      cancelToken,
      export: row.exportJobId ? await this.exports.view(row.exportJobId) : null,
    };
  }

  /** `GET /account-deletion/confirm/:token` — state of the link (or, after confirmation, of the request). */
  async publicState(token: string): Promise<AccountDeletionPublicDto> {
    const { row, user } = await this.byToken(token);
    return this.publicDto(row, user, row.status === 'grace' ? token : null);
  }

  /** `POST /account-deletion/confirm/:token { exportData? }` — guards then 30-day grace; returns a cancel token (valid until the date). */
  async publicConfirm(token: string, input: { exportData: boolean }, client: ClientInfo): Promise<AccountDeletionPublicDto> {
    const { row, user } = await this.byToken(token);
    if (row.status === 'grace') return this.publicDto(row, user, token); // replayed confirmation: same answer
    if (row.status !== 'pending_confirmation') throw new AppException('ACCOUNT_DELETION_TOKEN_EXPIRED');
    const cancelToken = randomBytes(32).toString('base64url');
    const scheduled = await this.schedule(user, 'public_page', client, { exportData: input.exportData, cancelTokenHash: this.crypto.sha256(cancelToken) });
    return this.publicDto(scheduled, user, cancelToken);
  }

  /** `POST /account-deletion/cancel/:token` — the cancel token of the confirmation (or the pending link itself). */
  async publicCancel(token: string, client: ClientInfo): Promise<AccountDeletionPublicDto> {
    const { row, user } = await this.byToken(token);
    const cancelled = await this.cancelRow(row);
    await this.audit.write({ actorType: 'user', actorId: user.id, action: 'account.deletion_cancelled', entity: 'User', entityId: user.id, after: { source: 'public_page' }, ip: client.ip, userAgent: client.userAgent });
    return this.publicDto(cancelled, { ...user, status: 'active' }, null);
  }

  /**
   * Part of `sched-workspace-purge`: requests past their grace ⇒ irreversible anonymisation (04 §16).
   * Safe to run twice: an anonymised request no longer matches.
   */
  async anonymiseDue(now = new Date()): Promise<number> {
    return TenantContext.runSystem(async () => {
      const due = await prisma.accountDeletionRequest.findMany({ where: { status: 'grace', scheduledAt: { lte: now } } });
      let done = 0;
      for (const req of due) {
        try {
          await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: req.userId } });
            // an account that still owns a workspace is not anonymised: the request goes back to "blocked"
            if (user?.ownedWorkspaceId) {
              await tx.accountDeletionRequest.update({ where: { id: req.id }, data: { status: 'blocked', blockedReason: 'ACCOUNT_OWNS_WORKSPACE' } });
              return;
            }
            await tx.membership.deleteMany({ where: { userId: req.userId } });
            await tx.refreshToken.deleteMany({ where: { userId: req.userId } });
            await tx.deviceToken.deleteMany({ where: { userId: req.userId } });
            await tx.emailToken.deleteMany({ where: { userId: req.userId } });
            await tx.user.update({
              where: { id: req.userId },
              data: {
                firstName: 'Membre supprimé',
                lastName: '',
                email: `deleted+${req.userId}@anon.djaber.ai`,
                phone: null,
                avatarUrl: null,
                totpEnabled: false,
                totpSecret: null,
                recoveryCodes: [],
                passwordHash: this.crypto.sha256(randomUUID()), // not an argon2 hash: no password can match
                prefs: {},
                deletedAt: now,
              },
            });
            await tx.accountDeletionRequest.update({ where: { id: req.id }, data: { status: 'anonymised', processedAt: now, tokenHash: null } });
            done++;
          });
        } catch (e) {
          this.log.error({ requestId: req.id, err: String(e) }, 'account anonymisation failed');
        }
      }
      return done;
    });
  }
}
