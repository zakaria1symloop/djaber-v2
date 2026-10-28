// AUTH-02 / AUTH-04 — access JWT (15 min) + rotating opaque refresh token (7 d) grouped in families.
// Reuse of a rotated token revokes the whole family (`AUTH_REFRESH_REUSED`). A "session" = one family.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, TenantContext, type Tx, type User } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { TokenService } from '../../core/auth/token.service';
import { SessionDenylistService } from '../../core/auth/session-denylist.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { dbOf } from '../../core/db';
import { AppException } from '../../core/errors/app.exception';

export const REFRESH_COOKIE = 'djaber_rt';
const COOKIE_PATH = '/api/v1/auth';
/** Live tokens one session may hold at once through concurrent rotations (grace window of REFRESH_REUSE_GRACE_S). */
const REFRESH_PARALLEL_MAX = 10;

export type ClientInfo = { ip?: string | null; userAgent?: string | null };
export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number; familyId: string };

export const clientOf = (req: any): ClientInfo => ({
  ip: typeof req.ip === 'string' ? req.ip : null,
  userAgent: typeof req.headers?.['user-agent'] === 'string' ? String(req.headers['user-agent']).slice(0, 300) : null,
});

@Injectable()
export class SessionService {
  constructor(
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly denylist: SessionDenylistService,
  ) {}

  private get refreshTtlMs() {
    return this.config.get('REFRESH_TTL_DAYS') * 86_400_000;
  }

  /** Access token claims `{ sub, wid?, role?, pr, sid }` (00-build-order §0); `wid` = owned workspace, else last used. */
  private async signAccess(user: Pick<User, 'id' | 'platformRole' | 'ownedWorkspaceId' | 'lastWorkspaceId'>, familyId: string, db: Tx) {
    const wid = user.ownedWorkspaceId ?? user.lastWorkspaceId ?? undefined;
    let role: string | undefined;
    if (wid) {
      const m = await db.membership.findUnique({ where: { workspaceId_userId: { workspaceId: wid, userId: user.id } } });
      role = m?.role;
    }
    return this.tokens.signAccess({ sub: user.id, wid: role ? wid : undefined, role, pr: user.platformRole, sid: familyId });
  }

  /** Opens a new session (family) for the user. */
  async issue(user: User, client: ClientInfo, tx?: Tx): Promise<IssuedTokens> {
    return TenantContext.runSystem(async () => {
      const db = dbOf(tx);
      const familyId = randomUUID();
      const refreshToken = this.crypto.randomToken(32);
      await db.refreshToken.create({
        data: {
          userId: user.id,
          familyId,
          tokenHash: this.crypto.sha256(refreshToken),
          expiresAt: new Date(Date.now() + this.refreshTtlMs),
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      const access = await this.signAccess(user, familyId, db);
      return { accessToken: access.token, refreshToken, expiresIn: this.config.get('JWT_ACCESS_TTL_S'), familyId };
    });
  }

  /** Rotation: the presented token is revoked and replaced inside one transaction. */
  async rotate(rawToken: string, client: ClientInfo): Promise<{ user: User; tokens: IssuedTokens }> {
    const tokenHash = this.crypto.sha256(rawToken);
    const outcome = await TenantContext.runSystem(() =>
      prisma.$transaction(async (tx) => {
        const row = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
        if (!row) return { kind: 'unknown' as const };
        // atomic claim: only one request can rotate a given token
        const claimed = row.revokedAt
          ? 0
          : (await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } })).count;
        // PV 28/10 « fermeture de session »: two tabs opened together (each one refreshes at start) or a refresh whose
        // response was lost present the same cookie twice — that is not a theft. A token rotated less than
        // REFRESH_REUSE_GRACE_S ago, whose session is still alive, gets a new token of the same family; any other reuse
        // revokes the whole family as before (AT-AUTH-05).
        if (!claimed && !(await this.concurrentRotation(tx, row))) {
          await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
          return { kind: 'reused' as const, userId: row.userId, familyId: row.familyId };
        }
        if (row.expiresAt <= new Date()) return { kind: 'unknown' as const };
        const user = row.user;
        if (user.deletedAt || user.status === 'blocked') {
          await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
          return { kind: 'blocked' as const };
        }
        const refreshToken = this.crypto.randomToken(32);
        await tx.refreshToken.create({
          data: {
            userId: user.id,
            familyId: row.familyId,
            tokenHash: this.crypto.sha256(refreshToken),
            expiresAt: new Date(Date.now() + this.refreshTtlMs),
            ip: client.ip ?? null,
            userAgent: client.userAgent ?? null,
          },
        });
        const access = await this.signAccess(user, row.familyId, tx);
        const tokens: IssuedTokens = {
          accessToken: access.token,
          refreshToken,
          expiresIn: this.config.get('JWT_ACCESS_TTL_S'),
          familyId: row.familyId,
        };
        return { kind: 'ok' as const, user, tokens };
      }),
    );
    if (outcome.kind === 'reused') {
      await this.audit.write({
        actorType: 'system',
        action: 'auth.sessions_revoked',
        entity: 'User',
        entityId: outcome.userId,
        after: { familyId: outcome.familyId, cause: 'refresh_reuse' },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new AppException('AUTH_REFRESH_REUSED');
    }
    if (outcome.kind === 'blocked') throw new AppException('AUTH_USER_BLOCKED');
    if (outcome.kind !== 'ok') throw new AppException('UNAUTHORIZED');
    return { user: outcome.user, tokens: outcome.tokens };
  }

  /**
   * A rotated token presented again within the grace window while its family still has a live token (a logout or a
   * revocation leaves none). Capped so that a leaked cookie cannot open sessions without end inside the window.
   */
  private async concurrentRotation(tx: Tx, row: { familyId: string; revokedAt: Date | null }): Promise<boolean> {
    const graceMs = this.config.get('REFRESH_REUSE_GRACE_S') * 1000;
    // revokedAt null: another request claimed it between our read and our update (it committed before our update ran)
    if (!graceMs || (row.revokedAt && Date.now() - row.revokedAt.getTime() > graceMs)) return false;
    const alive = await tx.refreshToken.count({ where: { familyId: row.familyId, revokedAt: null, expiresAt: { gt: new Date() } } });
    return alive > 0 && alive < REFRESH_PARALLEL_MAX;
  }

  /** Family of a raw refresh token (logout with the cookie / body token only). */
  async familyOf(rawToken: string): Promise<{ userId: string; familyId: string } | null> {
    const row = await TenantContext.runSystem(() =>
      prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.sha256(rawToken) }, select: { userId: true, familyId: true } }),
    );
    return row;
  }

  async revokeFamily(userId: string, familyId: string, tx?: Tx): Promise<number> {
    const r = await TenantContext.runSystem(() =>
      dbOf(tx).refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    await this.denylist.deny([familyId]);
    return r.count;
  }

  /** "Log out all devices", password change / reset, member removal, account deletion, admin revoke / block. */
  async revokeAll(userId: string, opts: { exceptFamilyId?: string } = {}, tx?: Tx): Promise<number> {
    const where = { userId, revokedAt: null, ...(opts.exceptFamilyId ? { familyId: { not: opts.exceptFamilyId } } : {}) };
    const r = await TenantContext.runSystem(async () => {
      const open = await dbOf(tx).refreshToken.findMany({ where, select: { familyId: true }, distinct: ['familyId'] });
      const out = await dbOf(tx).refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
      // the open sessions' access tokens stop now, not at their expiry (AuthGuard + SessionDenylistService)
      await this.denylist.deny(open.map((o) => o.familyId));
      return out;
    });
    return r.count;
  }

  /** Active sessions (one row per family): `id` = family id, stable across rotations. */
  async list(userId: string, currentFamilyId?: string) {
    const rows = await TenantContext.runSystem(() =>
      prisma.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const firstSeen = await TenantContext.runSystem(() =>
      prisma.refreshToken.groupBy({
        by: ['familyId'],
        where: { userId, familyId: { in: rows.map((r) => r.familyId) } },
        _min: { createdAt: true },
      }),
    );
    const started = new Map(firstSeen.map((f) => [f.familyId, f._min.createdAt]));
    const seen = new Set<string>();
    return rows
      .filter((r) => (seen.has(r.familyId) ? false : (seen.add(r.familyId), true)))
      .map((r) => ({
        id: r.familyId,
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: (started.get(r.familyId) ?? r.createdAt).toISOString(),
        lastUsedAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        current: r.familyId === currentFamilyId,
      }));
  }

  // --- refresh cookie (web): HttpOnly; Secure (prod only); SameSite=Lax; Path=/api/v1/auth -------------------------
  // REFRESH_COOKIE_CROSS_SITE=true when the web and the API are on two different sites (e.g. djaber.vercel.app +
  // the VPS host): SameSite=None; Secure; Partitioned (CHIPS), else the browser drops the cookie and a reload logs out.
  private cookieOptions() {
    const cross = this.config.get('REFRESH_COOKIE_CROSS_SITE');
    return { httpOnly: true, secure: cross || this.config.isProd, sameSite: cross ? ('none' as const) : ('lax' as const), ...(cross ? { partitioned: true } : {}), path: COOKIE_PATH };
  }
  setCookie(res: any, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions(), maxAge: this.refreshTtlMs });
  }
  clearCookie(res: any) {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }
  readCookie(req: any): string | undefined {
    const v = req.cookies?.[REFRESH_COOKIE];
    return typeof v === 'string' && v ? v : undefined;
  }
}
