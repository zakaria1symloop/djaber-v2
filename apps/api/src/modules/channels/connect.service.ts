// FL-05 / CHN-01…05, CHN-10 — connect Facebook pages (+ linked Instagram) and Instagram Business Login.
// `start` builds the dialog URL with an authenticated, single-use `state` (workspace + user + nonce, 10 min);
// `callback` verifies it, exchanges the code through the Meta port and returns a per-page report. The callback is one of
// the documented places where an HTTP handler talks to Meta (03-events-and-jobs §7: OAuth code exchange, 10 s timeouts).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OAUTH_STATE_TTL_S, type ConnectReport, type ConnectReportCode, type ConnectReportPage, type ConnectUrlView } from '@djaber/shared';
import { prisma, TenantContext, type Channel, type ChannelPlatform, type MembershipRole, type Tx } from '@djaber/db';
import { AuditService } from '../../core/audit/audit.service';
import { ConfigService } from '../../core/config/config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException, notFound } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';
import { RedisService } from '../../core/redis/redis.provider';
import { can } from '../../core/rbac/permission-matrix';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { MetaError } from '../meta/meta-errors';
import { FACEBOOK_SCOPES, INSTAGRAM_SCOPES, META_GATEWAY, type MetaGateway, type MetaInstagramAccount, type MetaPage } from '../meta/meta.gateway';
import { ChannelService } from './channel.service';
import { ChannelEvents, ChannelTokens, pageSlots } from './channel.util';

type State = { w: string; u: string; p: ChannelPlatform; n: string; e: number; r?: string };
type CallbackQuery = { code?: string; state?: string; error?: string; error_reason?: string; error_description?: string };
type Upserted = { channel: Channel; reconnected: boolean } | { skipped: ConnectReportCode; otherWorkspaceName?: string | null };

const nonceKey = (n: string) => `oauth:nonce:${n}`;
const reportKey = (id: string) => `connect:report:${id}`;
const REPORT_TTL_S = 600;

@Injectable()
export class ConnectService {
  private readonly log = new Logger(ConnectService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly tenants: TenantResolver,
    private readonly i18n: I18nService,
    private readonly audit: AuditService,
    private readonly tokens: ChannelTokens,
    private readonly events: ChannelEvents,
    private readonly channels: ChannelService,
    @Inject(META_GATEWAY) private readonly meta: MetaGateway,
  ) {}

  /** Facebook Login permissions: META_FACEBOOK_SCOPES (the ones enabled in the Meta app) or the full list of 05 §1. */
  private facebookScopes(): string[] {
    const custom = this.config.get('META_FACEBOOK_SCOPES');
    return custom ? custom.split(',').map((x) => x.trim()).filter(Boolean) : [...FACEBOOK_SCOPES];
  }

  redirectUri(platform: ChannelPlatform) {
    return `${this.config.get('PUBLIC_API_URL').replace(/\/$/, '')}${this.config.get('META_OAUTH_CALLBACK_PATH').replace('{platform}', platform)}`;
  }

  // --- start ------------------------------------------------------------------------------------------------------------
  /** `GET /channels/connect/:platform` and `POST /channels/:id/reconnect` → the URL the popup opens. */
  async start(platform: ChannelPlatform, reconnectChannelId?: string): Promise<ConnectUrlView> {
    const t = TenantContext.get();
    if (reconnectChannelId) {
      const c = await prisma.channel.findFirst({ where: { id: reconnectChannelId } });
      if (!c) throw notFound();
    }
    const state: State = { w: t.workspaceId, u: t.userId!, p: platform, n: randomUUID(), e: Date.now() + OAUTH_STATE_TTL_S * 1000, ...(reconnectChannelId ? { r: reconnectChannelId } : {}) };
    await this.redis.client.set(nonceKey(state.n), '1', 'EX', OAUTH_STATE_TTL_S);
    const args = { state: this.crypto.encryptJson(state), redirectUri: this.redirectUri(platform), hint: t.workspaceId.replace(/-/g, '').slice(-12) };
    const url = platform === 'facebook' ? this.meta.facebookDialogUrl({ ...args, scopes: this.facebookScopes() }) : this.meta.instagramDialogUrl({ ...args, scopes: [...INSTAGRAM_SCOPES] });
    return { url, expiresAt: new Date(state.e).toISOString() };
  }

  /** Reconnect opens the flow of the channel's own kind (a linked Instagram account reconnects through its page). */
  async reconnect(channelId: string): Promise<ConnectUrlView> {
    const c = await prisma.channel.findFirst({ where: { id: channelId } });
    if (!c) throw notFound();
    return this.start(c.platform === 'instagram' && c.parentChannelId === null ? 'instagram' : 'facebook', c.id);
  }

  // --- callback ---------------------------------------------------------------------------------------------------------
  private async readState(raw: unknown, platform: ChannelPlatform): Promise<State | null> {
    if (typeof raw !== 'string' || !raw) return null;
    let s: State;
    try {
      s = this.crypto.decryptJson<State>(raw);
    } catch {
      return null; // tampered or foreign value
    }
    if (!s || s.p !== platform || typeof s.e !== 'number' || s.e < Date.now() || !s.n || !s.w || !s.u) return null;
    // single use: the nonce exists only until the first callback
    const used = await this.redis.client.del(nonceKey(s.n));
    return used === 1 ? s : null;
  }

  private errorReport(platform: ChannelPlatform, code: string, locale: string, planLimit = { limit: 0, current: 0 }): ConnectReport {
    return { id: randomUUID(), platform, outcome: 'error', error: { code, message: this.i18n.t(locale, `error.${code}`) }, pages: [], planLimit };
  }

  /**
   * `GET /channels/callback/:platform` (public: the browser arrives without a bearer; the workspace and the acting user
   * come from the verified state). Never throws for a business outcome: the report says what happened.
   */
  async callback(platform: ChannelPlatform, q: CallbackQuery, locale: string): Promise<ConnectReport> {
    const state = await this.readState(q.state, platform);
    if (!state) return this.errorReport(platform, 'OAUTH_STATE_INVALID', locale);
    const report = await this.run(platform, state, q, locale).catch((e) => {
      if (e instanceof AppException) return this.errorReport(platform, e.code, locale);
      if (e instanceof MetaError) {
        this.log.warn({ kind: e.kind, code: e.code, subcode: e.subcode }, 'meta oauth exchange failed');
        return this.errorReport(platform, 'META_UNAVAILABLE', locale);
      }
      throw e;
    });
    await this.redis.setJson(reportKey(report.id), { report, workspaceId: state.w }, REPORT_TTL_S);
    return report;
  }

  /** `GET /channels/connect/reports/:id` — the report of a finished flow (kept 10 min), for a same-tab return. */
  async report(id: string): Promise<ConnectReport> {
    const stored = await this.redis.getJson<{ report: ConnectReport; workspaceId: string }>(reportKey(id));
    if (!stored || stored.workspaceId !== TenantContext.workspaceId()) throw notFound();
    return stored.report;
  }

  private async run(platform: ChannelPlatform, state: State, q: CallbackQuery, locale: string): Promise<ConnectReport> {
    if (q.error || !q.code) return this.errorReport(platform, 'OAUTH_CANCELLED', locale);
    // the acting member must still be allowed to manage channels (the state is 10 minutes old at most)
    const [user, membership, ctx] = await TenantContext.runSystem(() =>
      Promise.all([
        prisma.user.findFirst({ where: { id: state.u, deletedAt: null, status: 'active' } }),
        prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: state.w, userId: state.u } } }),
        this.tenants.workspaceCtx(state.w),
      ]),
    );
    if (!user || !membership || !ctx) throw new AppException('OAUTH_STATE_INVALID');
    if (!can(membership.role as MembershipRole, 'channels.manage')) throw new AppException('FORBIDDEN');
    if (membership.readOnly) throw new AppException('READ_ONLY_MEMBER');
    if (!user.emailVerifiedAt) throw new AppException('AUTH_EMAIL_UNVERIFIED');
    if (ctx.status === 'suspended') throw new AppException('WORKSPACE_SUSPENDED');
    if (ctx.status === 'deletion_scheduled') throw new AppException('WORKSPACE_DELETION_SCHEDULED', { at: ctx.deletionScheduledAt ?? '' });

    const tenant = { ...(await this.tenants.forWorker(state.w)), userId: user.id, role: membership.role as MembershipRole, emailVerified: true };
    return TenantContext.run(tenant, async () => {
      const pages = platform === 'facebook' ? await this.connectFacebook(q.code!, user.id) : await this.connectInstagram(q.code!, user.id);
      const limit = tenant.limits.maxPages;
      const current = await prisma.channel.count({ where: { parentChannelId: null, status: { in: ['active', 'pending_review', 'needs_reconnect'] } } });
      const report: ConnectReport = { id: randomUUID(), platform, outcome: 'ok', error: null, pages, planLimit: { limit, current } };
      await this.audit.write({
        workspaceId: state.w,
        actorType: 'user',
        actorId: user.id,
        actorRole: membership.role,
        action: 'channel.connect',
        entity: 'Channel',
        after: { platform, pages: pages.map((p) => ({ externalId: p.externalId, status: p.status, code: p.code })) },
      });
      return report;
    });
  }

  // --- Facebook pages (+ linked Instagram) --------------------------------------------------------------------------------
  private async connectFacebook(code: string, userId: string): Promise<ConnectReportPage[]> {
    const user = await this.meta.exchangeFacebookCode(code, this.redirectUri('facebook'));
    const pages = await this.meta.listPages(user.accessToken);
    // client 25/11 (« seule la première page est ajoutée »): how many pages Meta listed, and how many more the grant gave back
    const recovered = pages.filter((p) => p.via === 'grant');
    this.log.log({ listed: pages.length - recovered.length, recovered: recovered.length, recoveredWithoutToken: recovered.filter((p) => !p.accessToken).length }, 'facebook pages of the connection');
    const out: ConnectReportPage[] = [];
    for (const page of pages) {
      const row = (status: ConnectReportPage['status'], codeOf: ConnectReportCode | null, channel?: Channel, reconnected = false, otherWorkspaceName?: string | null): ConnectReportPage => ({
        externalId: page.id,
        name: page.name,
        platform: 'facebook',
        avatarUrl: page.pictureUrl,
        status,
        code: codeOf,
        channelId: channel?.id ?? null,
        reconnected,
        ...(otherWorkspaceName ? { otherWorkspaceName } : {}),
      });
      if (!page.accessToken) {
        out.push(row('skipped', 'PAGE_ACCESS_TOKEN_MISSING'));
        continue;
      }
      if (!page.tasks.includes('MESSAGING')) {
        out.push(row('skipped', 'PAGE_MESSAGING_PERMISSION_MISSING'));
        continue;
      }
      const res = await this.upsert({ platform: 'facebook', externalId: page.id, name: page.name, avatarUrl: page.pictureUrl, followersCount: page.followersCount, token: page.accessToken, tokenExpiresAt: null, scopes: this.facebookScopes(), parentChannelId: null, userId });
      if ('skipped' in res) {
        out.push(row('skipped', res.skipped, undefined, false, res.otherWorkspaceName));
        continue;
      }
      const subscribed = await this.subscribe(res.channel);
      out.push(subscribed ? row('connected', null, res.channel, res.reconnected) : row('warning', 'PAGE_WEBHOOK_SUBSCRIBE_FAILED', res.channel, res.reconnected));
      const ig = await this.linkedInstagram(page);
      if (ig) out.push(await this.connectLinkedInstagram(res.channel, ig, page.accessToken, userId));
    }
    return out;
  }

  private async linkedInstagram(page: MetaPage): Promise<MetaInstagramAccount | null> {
    try {
      return await this.meta.linkedInstagram(page.id, page.accessToken!);
    } catch (e) {
      // the page is connected; its Instagram account can be linked by reconnecting later
      this.log.warn({ kind: e instanceof MetaError ? e.kind : 'error' }, 'linked instagram lookup failed');
      return null;
    }
  }

  /** CHN-02: the linked account becomes a child channel that uses the page token. It does not take a page slot. */
  private async connectLinkedInstagram(parent: Channel, ig: MetaInstagramAccount, pageToken: string, userId: string): Promise<ConnectReportPage> {
    const name = ig.username ? `@${ig.username}` : (ig.name ?? parent.name);
    const base = { externalId: ig.id, name, platform: 'instagram' as const, avatarUrl: ig.pictureUrl };
    const res = await this.upsert({ platform: 'instagram', externalId: ig.id, name, avatarUrl: ig.pictureUrl, followersCount: ig.followersCount ?? null, token: pageToken, tokenExpiresAt: null, scopes: ['instagram_basic', 'instagram_manage_messages'], parentChannelId: parent.id, userId });
    if ('skipped' in res) return { ...base, status: 'skipped', code: res.skipped, channelId: null, reconnected: false, ...(res.otherWorkspaceName ? { otherWorkspaceName: res.otherWorkspaceName } : {}) };
    const pending = res.channel.status === 'pending_review';
    return { ...base, status: pending ? 'pending_review' : 'connected', code: pending ? 'PAGE_INSTAGRAM_PENDING_APPROVAL' : null, channelId: res.channel.id, reconnected: res.reconnected };
  }

  // --- Instagram Business Login (CHN-03) -----------------------------------------------------------------------------------
  private async connectInstagram(code: string, userId: string): Promise<ConnectReportPage[]> {
    const token = await this.meta.exchangeInstagramCode(code, this.redirectUri('instagram'));
    let profile: MetaInstagramAccount;
    try {
      profile = await this.meta.instagramProfile(token.accessToken);
    } catch (e) {
      if (e instanceof MetaError && (e.kind === 'network' || e.kind === 'unavailable' || e.kind === 'rate_limit')) throw e;
      // the account answers nothing until Meta approves the app for it
      throw new AppException('PAGE_INSTAGRAM_PENDING_APPROVAL');
    }
    const name = profile.username ? `@${profile.username}` : (profile.name ?? 'Instagram');
    const base = { externalId: profile.id, name, platform: 'instagram' as const, avatarUrl: profile.pictureUrl };
    const res = await this.upsert({
      platform: 'instagram',
      externalId: profile.id,
      name,
      avatarUrl: profile.pictureUrl,
      followersCount: profile.followersCount ?? null,
      token: token.accessToken,
      tokenExpiresAt: token.expiresInSec ? new Date(Date.now() + token.expiresInSec * 1000) : null,
      scopes: [...INSTAGRAM_SCOPES],
      parentChannelId: null,
      userId,
    });
    if ('skipped' in res) return [{ ...base, status: 'skipped', code: res.skipped, channelId: null, reconnected: false, ...(res.otherWorkspaceName ? { otherWorkspaceName: res.otherWorkspaceName } : {}) }];
    const subscribed = await this.subscribe(res.channel);
    const pending = res.channel.status === 'pending_review';
    return [
      {
        ...base,
        status: pending ? 'pending_review' : subscribed ? 'connected' : 'warning',
        code: pending ? 'PAGE_INSTAGRAM_PENDING_APPROVAL' : subscribed ? null : 'PAGE_WEBHOOK_SUBSCRIBE_FAILED',
        channelId: res.channel.id,
        reconnected: res.reconnected,
      },
    ];
  }

  // --- shared -----------------------------------------------------------------------------------------------------------
  /**
   * One page / account: refused when it lives in another workspace (CHN-05) or when no page slot is left (CHN-10);
   * otherwise created, or updated in place when this workspace already had it (no duplicate, history kept — FL-05 F-6).
   */
  private async upsert(p: {
    platform: ChannelPlatform;
    externalId: string;
    name: string;
    avatarUrl: string | null;
    followersCount: number | null;
    token: string;
    tokenExpiresAt: Date | null;
    scopes: string[];
    parentChannelId: string | null;
    userId: string;
  }): Promise<Upserted> {
    const workspaceId = TenantContext.workspaceId();
    // a page belongs to one workspace globally: look across workspaces
    const elsewhere = await TenantContext.runSystem(() => prisma.channel.findUnique({ where: { platform_externalId: { platform: p.platform, externalId: p.externalId } } }));
    if (elsewhere && elsewhere.workspaceId !== workspaceId) {
      if (elsewhere.status !== 'disconnected') {
        // client 25/11: she owns both shops and read « connectée à un autre espace » without knowing which one — the shop is named
        // when the person connecting is a member of it too (someone else's shop is never named)
        const own = await TenantContext.runSystem(() => prisma.membership.findFirst({ where: { workspaceId: elsewhere.workspaceId, userId: p.userId }, select: { workspace: { select: { name: true } } } }));
        return { skipped: 'PAGE_ALREADY_CONNECTED_ELSEWHERE', otherWorkspaceName: own?.workspace.name ?? null };
      }
      // disconnected over there: the page is free again; that workspace keeps its history under a retired id
      await TenantContext.runSystem(() => this.channels.releaseExternalId(prisma, elsewhere));
    }
    const pendingReview = p.platform === 'instagram' && !(await this.channels.instagramApproved(p.parentChannelId !== null));
    return prisma.$transaction(async (db): Promise<Upserted> => {
      const tx = db as Tx;
      const own = await tx.channel.findFirst({ where: { platform: p.platform, externalId: p.externalId } });
      const heldSlot = !!own && own.parentChannelId === null && ['active', 'pending_review', 'needs_reconnect'].includes(own.status);
      const keepsPause = !!own && own.status === 'paused' && (own.pausedReason === 'plan' || own.pausedReason === 'moderation');
      if (p.parentChannelId === null && !heldSlot && !keepsPause) {
        const slots = await pageSlots(tx);
        if (slots.free < 1) return { skipped: slots.limit >= 0 && slots.current > slots.limit ? 'PLAN_LIMIT_GRANDFATHERED' : 'PLAN_LIMIT' };
      }
      const data = {
        name: p.name,
        avatarUrl: p.avatarUrl,
        followersCount: p.followersCount,
        accessToken: this.tokens.seal(p.token),
        tokenExpiresAt: p.tokenExpiresAt,
        grantedScopes: p.scopes,
        parentChannelId: p.parentChannelId,
        webhookSubscribed: true,
        lastTokenCheckAt: new Date(),
        ...(keepsPause ? {} : { status: pendingReview ? ('pending_review' as const) : ('active' as const), pausedReason: null }),
      };
      const channel = own
        ? await tx.channel.update({ where: { id: own.id }, data })
        : await tx.channel.create({ data: { ...data, workspaceId, platform: p.platform, externalId: p.externalId, connectedById: p.userId } });
      await this.events.changed(tx, channel, { kind: own ? 'reconnected' : 'connected', actorType: 'user', actorId: p.userId });
      return { channel, reconnected: !!own };
    });
  }

  /** `subscribed_apps`; a failure is a warning, retried by `sched-channel-webhook-retry` (CHN-01). */
  private async subscribe(channel: Channel): Promise<boolean> {
    const auth = this.tokens.auth(channel);
    try {
      if (!auth) throw new Error('no token');
      await this.meta.subscribePage(auth);
      return true;
    } catch (e) {
      this.log.warn({ channelId: channel.id, kind: e instanceof MetaError ? e.kind : 'error' }, 'page subscription failed');
      await prisma.channel.update({ where: { id: channel.id }, data: { webhookSubscribed: false } });
      return false;
    }
  }
}
