// M3 — CHN-01…12: OAuth connect with a signed single-use state, per-page report, linked Instagram, plan limit,
// Instagram Business Login, token at rest, error 190 ⇒ needs_reconnect, pause / resume (swap) / disconnect, overview,
// history sync, token refresh, App Review status. Meta is the fake adapter everywhere (no network).
import request from 'supertest';
import { CryptoService } from '../../src/core/crypto/crypto.service';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { ChannelJobs } from '../../src/modules/channels/channel-jobs.service';
import { ChannelTokens } from '../../src/modules/channels/channel.util';
import { FakeMetaGateway } from '../../src/modules/meta/fake-meta.gateway';
import { MetaError } from '../../src/modules/meta/meta-errors';
import type { MetaPage } from '../../src/modules/meta/meta.gateway';
import { WorkspaceDeletionService } from '../../src/modules/workspace/workspace-deletion.service';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { testAgent } from '../support/m2';
import { callback, connect, connectedPage, db, fakeMeta, forbidNetwork, instagramChild, newSender, receive, reply, startConnect, work, wsOf } from '../support/m3';

let app: TestApp;
let meta: FakeMetaGateway;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  net = forbidNetwork();
  app = await createTestApp();
  meta = fakeMeta(app);
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled(); // nothing in these suites ever reached for the network
  net.restore();
  await app.close();
});

const page = (id: string, over: Partial<MetaPage> = {}): MetaPage => ({ id, name: `Page ${id.slice(-4)}`, accessToken: `fake-page-token.${id}`, tasks: ['MANAGE', 'MESSAGING'], pictureUrl: null, followersCount: 10, ...over });
const uid = () => `9${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 16);

describe('CHN-01 OAuth state', () => {
  it('AT-CHN-01 OAuth with tampered/expired state ⇒ OAUTH_STATE_INVALID; nothing stored', async () => {
    const owner = await asOwner(app);
    const s = await startConnect(owner);
    expect(s.url.pathname).toBe('/api/v1/channels/callback/facebook'); // fake adapter: the dialog is our own callback

    // tampered
    const tampered = await callback(app, 'facebook', { code: s.code, state: `${s.state.slice(0, -4)}AAAA` });
    expect(tampered).toMatchObject({ outcome: 'error', error: { code: 'OAUTH_STATE_INVALID' }, pages: [] });
    // a state issued for the other platform
    const ig = await startConnect(owner, 'instagram');
    expect((await callback(app, 'facebook', { code: s.code, state: ig.state })).error?.code).toBe('OAUTH_STATE_INVALID');
    // expired (older than 10 minutes): same value, clock moved
    const now = Date.now;
    Date.now = () => now() + 11 * 60_000;
    try {
      expect((await callback(app, 'facebook', { code: s.code, state: s.state })).error?.code).toBe('OAUTH_STATE_INVALID');
    } finally {
      Date.now = now;
    }
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(meta.callsOf('exchangeFacebookCode').filter((c) => c.args.code === s.code)).toHaveLength(0);

    // single use: a valid state works once, a replay is refused
    const fresh = await startConnect(owner);
    expect((await callback(app, 'facebook', { code: fresh.code, state: fresh.state })).outcome).toBe('ok');
    expect((await callback(app, 'facebook', { code: fresh.code, state: fresh.state })).error?.code).toBe('OAUTH_STATE_INVALID');
  });

  it('AT-CHN-12 OAuth refused ⇒ "connection cancelled", nothing stored; same page reconnected ⇒ token updated, no duplicate', async () => {
    const owner = await asOwner(app);
    const refused = await startConnect(owner);
    const report = await callback(app, 'facebook', { error: 'access_denied', error_reason: 'user_denied', state: refused.state });
    expect(report).toMatchObject({ outcome: 'error', error: { code: 'OAUTH_CANCELLED' } });
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);

    const first = await connect(owner, app);
    const channelId = first.pages[0]!.channelId!;
    const before = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
    await db.channel.update({ where: { id: channelId }, data: { status: 'needs_reconnect' } });

    // reconnect = same flow, started from the channel
    const start = await owner.post(`/channels/${channelId}/reconnect`).expect(200);
    const url = new URL(start.body.data.url);
    const again = await callback(app, 'facebook', { code: url.searchParams.get('code')!, state: url.searchParams.get('state')! });
    expect(again.pages[0]).toMatchObject({ channelId, status: 'connected', reconnected: true });
    const after = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
    expect(after.status).toBe('active');
    expect(Buffer.from(after.accessToken!).equals(Buffer.from(before.accessToken!))).toBe(false); // token replaced (fresh ciphertext)
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, platform: 'facebook' } })).toBe(2); // no duplicate
    const kinds = (await db.channelEvent.findMany({ where: { channelId }, orderBy: { at: 'asc' } })).map((e) => e.kind);
    expect(kinds).toEqual(['connected', 'reconnected']);
  });

  it('the callback page posts the report to the opener and falls back to the web return route', async () => {
    const owner = await asOwner(app);
    const s = await startConnect(owner);
    const res = await request(app.http()).get('/api/v1/channels/callback/facebook').query({ code: s.code, state: s.state }).set('Accept', 'text/html').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(res.text).toContain('"type":"djaber:connect"');
    expect(res.text).toContain('/channels/connect/return?connectReport=');
    const id = /connectReport=([0-9a-f-]{36})/.exec(res.text)![1]!;
    // the stored report is readable by the workspace that ran the flow, and by nobody else
    expect((await owner.get(`/channels/connect/reports/${id}`).expect(200)).body.data.pages.length).toBeGreaterThan(0);
    const other = await asOwner(app);
    await other.get(`/channels/connect/reports/${id}`).expect(404);
  });

  it('connect needs channels.manage, a verified e-mail and a live membership at callback time', async () => {
    const owner = await asOwner(app);
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/channels/connect/facebook').expect(403)).body.error.code).toBe('FORBIDDEN');
    const admin = await asAdmin(app, owner.workspaceId);
    const s = await startConnect(admin);
    // the member loses the workspace between the dialog and the callback
    await db.membership.deleteMany({ where: { workspaceId: owner.workspaceId, userId: admin.userId } });
    expect((await callback(app, 'facebook', { code: s.code, state: s.state })).error?.code).toBe('OAUTH_STATE_INVALID');
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });
});

describe('CHN-01/02/05/10 per-page report', () => {
  it('AT-CHN-02 callback with 3 pages (one without MESSAGING task, one connected elsewhere) ⇒ connected / skipped ×2 with codes; linked IG becomes child channel', async () => {
    const other = await asOwner(app);
    const taken = await connectedPage(other, app);
    const owner = await asOwner(app);
    const s = await startConnect(owner);
    const good = page(uid());
    const noMessaging = page(uid(), { tasks: ['ANALYZE'] });
    const noToken = page(uid(), { accessToken: null });
    meta.setPages(s.seed, [good, noMessaging, page(taken.externalId), noToken]);
    const igId = `17${uid()}`;
    meta.setLinkedInstagram(good.id, { id: igId, name: 'Boutique', username: 'boutique.dz', pictureUrl: null });

    const report = await callback(app, 'facebook', { code: s.code, state: s.state });
    expect(report.outcome).toBe('ok');
    expect(report.pages.map((p) => [p.platform, p.status, p.code])).toEqual([
      ['facebook', 'connected', null],
      ['instagram', 'connected', null],
      ['facebook', 'skipped', 'PAGE_MESSAGING_PERMISSION_MISSING'],
      ['facebook', 'skipped', 'PAGE_ALREADY_CONNECTED_ELSEWHERE'],
      ['facebook', 'skipped', 'PAGE_ACCESS_TOKEN_MISSING'],
    ]);
    const channels = await db.channel.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } });
    expect(channels.map((c) => [c.platform, c.externalId])).toEqual([['facebook', good.id], ['instagram', igId]]);
    // CHN-02: the linked account is a child channel that uses the page token
    const tokens = app.app.get(ChannelTokens);
    expect(channels[1]!.parentChannelId).toBe(channels[0]!.id);
    expect(tokens.open(channels[1]!.accessToken)).toBe(good.accessToken);
    // CHN-04: the token is stored encrypted, never in clear
    expect(Buffer.from(channels[0]!.accessToken!).toString('utf8')).not.toContain(good.accessToken!);
    expect(app.app.get(CryptoService).decrypt(Buffer.from(channels[0]!.accessToken!).toString('utf8'))).toBe(good.accessToken);
    // the page was subscribed through the port (a recorded no-op in the fake adapter)
    expect(meta.callsOf('subscribePage').filter((c) => c.args.externalId === good.id)).toHaveLength(1);
    // the other workspace still owns its page
    expect((await db.channel.findUniqueOrThrow({ where: { id: taken.id } })).workspaceId).toBe(other.workspaceId);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'channel.updated')).length).toBeGreaterThanOrEqual(2);
    // sensitive action audited
    expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'channel.connect' } }))).toBeTruthy();
  });

  it('AT-CHN-03 plan maxPages=1, 2 pages granted ⇒ second skipped PLAN_LIMIT', async () => {
    const owner = await asOwner(app, 'free');
    const report = await connect(owner, app); // default fake pages: two pages, the first with a linked Instagram account
    expect(report.pages.map((p) => [p.platform, p.status, p.code])).toEqual([
      ['facebook', 'connected', null],
      ['instagram', 'connected', null], // the linked account rides on its page: no slot
      ['facebook', 'skipped', 'PLAN_LIMIT'],
    ]);
    expect(report.planLimit).toEqual({ limit: 1, current: 1 });
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId, platform: 'facebook' } })).toBe(1);
    const list = await owner.get('/channels').expect(200);
    expect(list.body.meta.planLimit).toEqual({ limit: 1, current: 1 });
    expect((await owner.get('/workspace').expect(200)).body.data.usage?.pages ?? 1).toBe(1);
  });

  it('AT-CHN-08 page connected in A, connect in B ⇒ PAGE_ALREADY_CONNECTED_ELSEWHERE; once A released it ⇒ B can connect', async () => {
    const a = await asOwner(app);
    const pageA = await connectedPage(a, app);
    const b = await asOwner(app);
    const first = await startConnect(b);
    meta.setPages(first.seed, [page(pageA.externalId)]);
    const refused = await callback(app, 'facebook', { code: first.code, state: first.state });
    expect(refused.pages).toEqual([expect.objectContaining({ status: 'skipped', code: 'PAGE_ALREADY_CONNECTED_ELSEWHERE', channelId: null })]);
    expect(await db.channel.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    // client 25/11: someone else's shop is never named; a shop the same person belongs to is (« votre boutique … »)
    expect(refused.pages[0]?.otherWorkspaceName ?? null).toBeNull();
    await db.membership.create({ data: { workspaceId: a.workspaceId, userId: b.userId, role: 'admin' } });
    const again = await startConnect(b);
    meta.setPages(again.seed, [page(pageA.externalId)]);
    const named = await callback(app, 'facebook', { code: again.code, state: again.state });
    expect(named.pages[0]).toMatchObject({ code: 'PAGE_ALREADY_CONNECTED_ELSEWHERE', otherWorkspaceName: (await db.workspace.findUniqueOrThrow({ where: { id: a.workspaceId } })).name });
    await db.membership.deleteMany({ where: { workspaceId: a.workspaceId, userId: b.userId } });

    // A disconnects (the admin force-release of M10 ends in the same state): the page is free, A keeps its history
    await a.delete(`/channels/${pageA.id}`).expect(200);
    const second = await startConnect(b);
    meta.setPages(second.seed, [page(pageA.externalId)]);
    const ok = await callback(app, 'facebook', { code: second.code, state: second.state });
    expect(ok.pages[0]).toMatchObject({ status: 'connected', reconnected: false });
    const rowB = await db.channel.findUniqueOrThrow({ where: { id: ok.pages[0]!.channelId! } });
    expect([rowB.workspaceId, rowB.externalId]).toEqual([b.workspaceId, pageA.externalId]);
    const rowA = await db.channel.findUniqueOrThrow({ where: { id: pageA.id } });
    expect(rowA.status).toBe('disconnected');
    expect((await a.get(`/channels/${pageA.id}`).expect(200)).body.data.externalId).toBe(pageA.externalId); // shown without the retired suffix
  });

  it('a failed page subscription is a warning, retried by the scheduler until it succeeds', async () => {
    const owner = await asOwner(app);
    const s = await startConnect(owner);
    const p = page(uid());
    meta.setPages(s.seed, [p]);
    meta.failNext('subscribePage', new MetaError('unavailable', 'temporarily unavailable', 2, null, 500));
    const report = await callback(app, 'facebook', { code: s.code, state: s.state });
    expect(report.pages[0]).toMatchObject({ status: 'warning', code: 'PAGE_WEBHOOK_SUBSCRIBE_FAILED' });
    const id = report.pages[0]!.channelId!;
    expect((await owner.get(`/channels/${id}`).expect(200)).body.data.health.webhookSubscribed).toBe(false);
    expect(app.app.get(ProcessorRegistry).crons.map((c) => c.name)).toEqual(expect.arrayContaining(['sched-channel-webhook-retry', 'sched-token-refresh', 'sched-token-health', 'sched-meta-review-poll']));
    expect(await app.app.get(ChannelJobs).retrySubscriptions()).toBeGreaterThanOrEqual(1);
    expect((await owner.get(`/channels/${id}`).expect(200)).body.data.health.webhookSubscribed).toBe(true);
    expect((await db.channelEvent.findMany({ where: { channelId: id } })).map((e) => e.kind)).toContain('webhook_resubscribed');
  });
});

describe('CHN-03 Instagram Business Login', () => {
  it('AT-CHN-07 IG Business Login with pending approval ⇒ PAGE_INSTAGRAM_PENDING_APPROVAL state; after approval ⇒ channel active', async () => {
    const scope = 'instagram_business_manage_messages';
    await db.metaPermission.upsert({ where: { scope }, create: { scope, feature: 'instagram_messaging', status: 'in_review' }, update: { status: 'in_review' } });
    try {
      const owner = await asOwner(app);
      const review = await owner.get('/channels/app-review-status').expect(200);
      expect(review.body.data).toMatchObject({ instagramApproved: false, permissions: expect.arrayContaining([expect.objectContaining({ scope, status: 'in_review' })]) });

      const report = await connect(owner, app, 'instagram');
      expect(report.pages).toEqual([expect.objectContaining({ platform: 'instagram', status: 'pending_review', code: 'PAGE_INSTAGRAM_PENDING_APPROVAL' })]);
      const id = report.pages[0]!.channelId!;
      const row = await db.channel.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('pending_review');
      // long-lived token: expiry stored (CHN-04)
      expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 50 * 86400_000);
      expect((await owner.get(`/channels/${id}/approval-status`).expect(200)).body.data).toMatchObject({ pending: true, code: 'PAGE_INSTAGRAM_PENDING_APPROVAL' });

      // Meta approves the scope (the platform team updates the table) ⇒ the daily poll activates the channel
      expect(await app.app.get(ChannelJobs).applyApprovals()).toBe(0);
      await db.metaPermission.update({ where: { scope }, data: { status: 'approved' } });
      expect(await app.app.get(ChannelJobs).applyApprovals()).toBe(1);
      expect((await db.channel.findUniqueOrThrow({ where: { id } })).status).toBe('active');
      await work(app, [owner.workspaceId]);
      expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'channel_approved' } })).toBe(1);
      expect((await owner.get(`/channels/${id}/approval-status`).expect(200)).body.data.pending).toBe(false);
    } finally {
      await db.metaPermission.deleteMany({ where: { scope } });
    }
  });

  it('an account that does not answer yet reports PAGE_INSTAGRAM_PENDING_APPROVAL and stores nothing', async () => {
    const owner = await asOwner(app);
    const s = await startConnect(owner, 'instagram');
    meta.failNext('instagramProfile', new MetaError('permission', 'Application does not have permission', 10, null, 403));
    const report = await callback(app, 'instagram', { code: s.code, state: s.state });
    expect(report).toMatchObject({ outcome: 'error', error: { code: 'PAGE_INSTAGRAM_PENDING_APPROVAL' } });
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });
});

describe('CHN-04 / CHN-12 tokens', () => {
  it('AT-CHN-04 Graph returns 190 on send ⇒ channel needs_reconnect, notification, AI stops; reconnect restores', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const agent = await testAgent(owner.workspaceId);
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const sender = newSender();
    const { conversation } = await receive(app, channel, sender, { text: 'Salam' });

    meta.failNext('send', new MetaError('token', 'Error validating access token', 190, 460, 400));
    const sent = await reply(owner, conversation.id, { text: 'Bonjour' }).expect(201);
    await work(app, [owner.workspaceId]);
    expect(await db.message.findUniqueOrThrow({ where: { id: sent.body.data.id } })).toMatchObject({ deliveryStatus: 'failed', error: 'PAGE_TOKEN_EXPIRED' });
    const flagged = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(flagged.status).toBe('needs_reconnect');
    // the linked Instagram account uses the same token: it follows
    expect((await instagramChild(channel.id))!.status).toBe('needs_reconnect');
    const notes = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'channel_needs_reconnect' } });
    expect(notes.filter((n) => (n.data as { channelId: string }).channelId === channel.id)).toHaveLength(1);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'channel.updated')).some((e) => e.payload.channel.id === channel.id && e.payload.channel.status === 'needs_reconnect')).toBe(true);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'message.updated')).some((e) => e.payload.messageId === sent.body.data.id && e.payload.deliveryStatus === 'failed')).toBe(true);

    // the AI stops on that channel: an inbound message is not even stored while the page must be reconnected (FL-01 step 3)
    const before = await db.message.count({ where: { conversationId: conversation.id } });
    const { message } = await receive(app, channel, sender, { text: 'Vous êtes là ?' });
    expect(message).toBeNull();
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(before);
    // replying is refused with the reason; reading still works (FL-06 F-5, AT-INB-13 API side)
    const refused = await reply(owner, conversation.id, { text: 'encore' }).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'REPLY_CHANNEL_INACTIVE', details: { status: 'needs_reconnect' } });
    expect((await owner.get(`/conversations/${conversation.id}`).expect(200)).body.data.composer).toMatchObject({ canSend: false, reasonCode: 'REPLY_CHANNEL_INACTIVE', channelStatus: 'needs_reconnect' });
    await owner.get(`/conversations/${conversation.id}/messages`).expect(200);

    // reconnect restores the channel, history kept
    const start = await owner.post(`/channels/${channel.id}/reconnect`).expect(200);
    const url = new URL(start.body.data.url);
    await callback(app, 'facebook', { code: url.searchParams.get('code')!, state: url.searchParams.get('state')! });
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe('active');
    expect((await instagramChild(channel.id))!.status).toBe('active');
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(before);
    await reply(owner, conversation.id, { text: 'De retour' }).expect(201);
  });

  it('AT-CHN-05 IG token expiresAt in 9 d ⇒ refresh job refreshes; refresh fails ⇒ needs_reconnect', async () => {
    const jobs = app.app.get(ChannelJobs);
    const tokens = app.app.get(ChannelTokens);
    const owner = await asOwner(app);
    const report = await connect(owner, app, 'instagram');
    const id = report.pages[0]!.channelId!;
    const old = tokens.open((await db.channel.findUniqueOrThrow({ where: { id } })).accessToken)!;

    // 11 days left: not due
    await db.channel.update({ where: { id }, data: { tokenExpiresAt: new Date(Date.now() + 11 * 86400_000) } });
    await jobs.refreshInstagramTokens();
    expect(tokens.open((await db.channel.findUniqueOrThrow({ where: { id } })).accessToken)).toBe(old);
    // 9 days left: refreshed, expiry pushed to ~60 days
    await db.channel.update({ where: { id }, data: { tokenExpiresAt: new Date(Date.now() + 9 * 86400_000) } });
    await jobs.refreshInstagramTokens();
    const refreshed = await db.channel.findUniqueOrThrow({ where: { id } });
    expect(tokens.open(refreshed.accessToken)).toBe(`${old}.refreshed`);
    expect(refreshed.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86400_000);
    expect(refreshed.status).toBe('active');

    // refresh refused by Meta ⇒ CHN-04
    await db.channel.update({ where: { id }, data: { tokenExpiresAt: new Date(Date.now() + 2 * 86400_000) } });
    meta.invalidTokens.add(`${old}.refreshed`);
    await jobs.refreshInstagramTokens();
    expect((await db.channel.findUniqueOrThrow({ where: { id } })).status).toBe('needs_reconnect');
    await work(app, [owner.workspaceId]);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'channel_needs_reconnect' } })).toBe(1);

    // Facebook page tokens: weekly debug_token check
    const fb = await connectedPage(await asOwner(app), app);
    meta.invalidTokens.add(tokens.open(fb.accessToken)!);
    expect(await jobs.checkPageTokens()).toBeGreaterThanOrEqual(1);
    expect((await db.channel.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe('needs_reconnect');
  });
});

describe('CHN-06 pause / resume / disconnect', () => {
  it('AT-CHN-06 disconnect ⇒ Meta unsubscribe called, token cleared, agent link removed, history readable', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const agent = await testAgent(owner.workspaceId);
    await db.agentChannel.create({ data: { agentId: agent.id, channelId: channel.id } });
    const { conversation } = await receive(app, channel, newSender(), { text: 'Bonjour' });
    const before = meta.callsOf('unsubscribePage').length;

    const res = await owner.delete(`/channels/${channel.id}`).expect(200);
    expect(res.body.data).toEqual({ id: channel.id, status: 'disconnected' });
    // the handler itself did not call Meta: the unsubscribe is a queued job (CLAUDE.md rule 4)
    expect(meta.callsOf('unsubscribePage')).toHaveLength(before);
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).accessToken).not.toBeNull();
    expect(await work(app, [owner.workspaceId])).toEqual(expect.arrayContaining(['channel-unsubscribe']));

    expect(meta.callsOf('unsubscribePage').slice(before).map((c) => c.args.externalId)).toEqual([channel.externalId]);
    const row = await db.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(row).toMatchObject({ status: 'disconnected', accessToken: null, tokenExpiresAt: null });
    expect(await db.agentChannel.count({ where: { channelId: channel.id } })).toBe(0);
    // the linked Instagram account goes with its page
    expect(await instagramChild(channel.id)).toMatchObject({ status: 'disconnected', accessToken: null });
    // history readable
    expect((await owner.get(`/conversations/${conversation.id}/messages`).expect(200)).body.data).toHaveLength(1);
    expect((await owner.get(`/channels/${channel.id}/messages`).expect(200)).body.data).toHaveLength(1);
    expect((await owner.get('/channels?status=disconnected').expect(200)).body.data.map((c: { id: string }) => c.id)).toContain(channel.id);
    // running the job twice is harmless
    await app.app.get(ChannelJobs).unsubscribe(channel.id);
    expect(meta.callsOf('unsubscribePage').length).toBe(before + 1);
    expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'channel.disconnect', entityId: channel.id } }))).toBeTruthy();
  });

  it('pause / resume, and resume at the plan limit needs a swap', async () => {
    const owner = await asOwner(app, 'free'); // maxPages = 1
    const first = await connectedPage(owner, app);
    const paused = await owner.patch(`/channels/${first.id}`, { status: 'paused' }).expect(200);
    expect(paused.body.data).toMatchObject({ status: 'paused', pausedReason: 'manual' });
    // the freed slot lets a second page in
    const s = await startConnect(owner);
    const p2 = page(uid());
    meta.setPages(s.seed, [p2]);
    const second = (await callback(app, 'facebook', { code: s.code, state: s.state })).pages[0]!;
    expect(second.status).toBe('connected');

    // resuming the first one would exceed the plan
    const refused = await owner.patch(`/channels/${first.id}`, { status: 'active' }).expect(403);
    expect(refused.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'pages', limit: 1, current: 1 } });
    const detail = (await owner.get(`/channels/${first.id}`).expect(200)).body.data;
    expect(detail.actions.find((a: { key: string }) => a.key === 'resume')).toMatchObject({ enabled: false, reasonCode: 'PLAN_LIMIT' });
    // swap: the other page is paused by plan in the same transaction
    const swapped = await owner.patch(`/channels/${first.id}`, { status: 'active', swapWithChannelId: second.channelId }).expect(200);
    expect(swapped.body.data.status).toBe('active');
    expect(await db.channel.findUniqueOrThrow({ where: { id: second.channelId! } })).toMatchObject({ status: 'paused', pausedReason: 'plan' });
    expect((await owner.get('/channels?pausedBy=plan').expect(200)).body.data.map((c: { id: string }) => c.id)).toEqual([second.channelId]);

    // disable / enable (manual stop from the card)
    expect((await owner.post(`/channels/${first.id}/disable`).expect(200)).body.data.status).toBe('disabled');
    expect((await owner.post(`/channels/${first.id}/enable`, {}).expect(200)).body.data.status).toBe('active');
    // messages of a paused page are not taken in
    await owner.patch(`/channels/${first.id}`, { status: 'paused' }).expect(200);
    expect((await receive(app, first, newSender(), { text: 'en pause ?' }).catch(() => null))).toBeNull();
  });

  it('role matrix and cross-workspace 404 on every channel route', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const op = await asOperator(app, owner.workspaceId);
    const admin = await asAdmin(app, owner.workspaceId);
    const stranger = await asOwner(app);

    // every member reads
    for (const path of ['', '/summary', '/events', '/approval-status', '/messages']) {
      await op.get(`/channels/${channel.id}${path}`).expect(200);
      await stranger.get(`/channels/${channel.id}${path}`).expect(404);
    }
    await op.get('/channels').expect(200);
    await op.get('/channels/app-review-status').expect(200);
    await stranger.get(`/channels/${channel.id}/insights`).expect(404);
    expect((await stranger.get('/channels').expect(200)).body.data).toEqual([]);

    // only Admin+ manages
    const writes: [string, 'post' | 'patch' | 'delete', string, object?][] = [
      ['pause', 'patch', '', { status: 'paused' }],
      ['disable', 'post', '/disable'],
      ['enable', 'post', '/enable', {}],
      ['reconnect', 'post', '/reconnect'],
      ['sync-info', 'post', '/sync-info'],
      ['sync', 'post', '/sync', { days: 7 }],
      ['disconnect', 'delete', ''],
    ];
    for (const [, method, path, body] of writes) {
      expect((await op[method](`/channels/${channel.id}${path}`, body).expect(403)).body.error.code).toBe('FORBIDDEN');
      await stranger[method](`/channels/${channel.id}${path}`, body).expect(404);
    }
    expect((await admin.patch(`/channels/${channel.id}`, { status: 'paused' }).expect(200)).body.data.status).toBe('paused');
    expect((await admin.patch(`/channels/${channel.id}`, { status: 'active' }).expect(200)).body.data.status).toBe('active');
    // validation
    expect((await admin.patch(`/channels/${channel.id}`, { status: 'disconnected' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await admin.get('/channels/not-a-uuid').expect(404);
    // an operator sees the management actions greyed with the reason
    const view = (await op.get(`/channels/${channel.id}`).expect(200)).body.data;
    expect(view.actions.every((a: { enabled: boolean; reasonCode?: string }) => !a.enabled && a.reasonCode === 'FORBIDDEN')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('fake-page-token'); // the token never leaves the server
  });
});

describe('CHN-07 overview', () => {
  it('AT-CHN-09 page overview with insights error ⇒ INBOX_INSIGHTS_UNAVAILABLE; counts still shown', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const a = newSender();
    await receive(app, channel, a, { text: 'un' });
    await receive(app, channel, a, { text: 'deux' });
    await receive(app, channel, newSender(), { text: 'trois' });

    // nothing cached yet: the card state, and a refresh is queued (never a Meta call from the handler)
    const calls = meta.callsOf('insights').length;
    expect((await owner.get(`/channels/${channel.id}/insights`).expect(422)).body.error.code).toBe('INBOX_INSIGHTS_UNAVAILABLE');
    expect(meta.callsOf('insights')).toHaveLength(calls);
    // Meta fails ⇒ still unavailable, the job itself does not fail
    meta.failNext('insights', new MetaError('unknown', 'Unsupported get request', 100, 33, 400));
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/channels/${channel.id}/insights`).expect(422)).body.error.code).toBe('INBOX_INSIGHTS_UNAVAILABLE');
    // counts are served regardless
    const view = (await owner.get(`/channels/${channel.id}`).expect(200)).body.data;
    expect(view.counts).toMatchObject({ conversations: 2, active: 2, needsHuman: 0, unread: 2, messages7d: 3, inbound7d: 3 });
    const summary = (await owner.get(`/channels/${channel.id}/summary`).expect(200)).body.data;
    expect(summary.counts.conversations).toBe(2);
    expect(summary.children).toHaveLength(1);
    expect(summary.agent).toBeNull();

    // a successful info sync fills the cache; 1 / 10 min / channel
    await owner.post(`/channels/${channel.id}/sync-info`).expect(202);
    const limited = await owner.post(`/channels/${channel.id}/sync-info`).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    await work(app, [owner.workspaceId]);
    const insights = (await owner.get(`/channels/${channel.id}/insights`).expect(200)).body.data;
    expect(insights.metrics).toEqual(expect.arrayContaining([{ key: 'page_fans', value: 1234 }]));
    expect((await owner.get(`/channels/${channel.id}`).expect(200)).body.data).toMatchObject({ followersCount: 1234 });
    expect((await owner.get(`/channels/${channel.id}/events?kind=info_synced`).expect(200)).body.data).toHaveLength(1);
    // filters of the message history tab
    expect((await owner.get(`/channels/${channel.id}/messages?direction=out`).expect(200)).body.data).toHaveLength(0);
    expect((await owner.get(`/channels/${channel.id}/messages?direction=in&limit=2`).expect(200)).body.meta.hasMore).toBe(true);
  });
});

describe('CHN-09 history sync', () => {
  it('AT-CHN-11 sync imports ≤ 25 conversations × 25 messages; existing messages skipped; token error ⇒ PAGE_SYNC_TOKEN_EXPIRED', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const now = Date.now();
    // Meta would return more than asked: 30 threads of 30 messages
    meta.setHistory(
      channel.externalId,
      Array.from({ length: 30 }, (_, t) => ({
        id: `t_${t}`,
        updatedAt: new Date(now - t * 60_000).toISOString(),
        participantId: `77${String(t).padStart(10, '0')}${channel.externalId.slice(-4)}`,
        participantName: `Client ${t}`,
        messages: Array.from({ length: 30 }, (_, m) => ({ id: `h_${channel.externalId}_${t}_${m}`, fromId: m % 2 ? channel.externalId : `77${String(t).padStart(10, '0')}${channel.externalId.slice(-4)}`, text: `message ${m}`, createdAt: new Date(now - t * 60_000 - m * 1000).toISOString(), attachments: [] })),
      })),
    );
    const res = await owner.post(`/channels/${channel.id}/sync`, { days: 7 }).expect(202);
    const jobId: string = res.body.data.jobId;
    // a second click while it runs returns the same job
    expect((await owner.post(`/channels/${channel.id}/sync`, { days: 7 }).expect(202)).body.data.jobId).toBe(jobId);
    await work(app, [owner.workspaceId]);
    const job = (await owner.get(`/jobs/${jobId}`).expect(200)).body.data;
    expect(job).toMatchObject({ status: 'done', kind: 'sync_history', result: { conversations: 25, messagesImported: 625, messagesSkipped: 0 } });
    expect(await db.conversation.count({ where: { channelId: channel.id } })).toBe(25);
    expect(await db.message.count({ where: { workspaceId: owner.workspaceId } })).toBe(625);
    // page-side messages are labelled as a person, never the AI; nothing is unread, nothing was sent
    const sample = await db.message.findMany({ where: { workspaceId: owner.workspaceId, direction: 'out' }, take: 5 });
    expect(sample.every((m) => m.author === 'human' && m.aiRunId === null && m.deliveryStatus === 'sent')).toBe(true);
    expect(await db.conversation.count({ where: { channelId: channel.id, unreadCount: { gt: 0 } } })).toBe(0);
    expect(meta.callsOf('send').filter((c) => c.args.externalId === channel.externalId)).toHaveLength(0);
    expect((await owner.get(`/channels/${channel.id}/events?kind=history_synced`).expect(200)).body.data).toHaveLength(1);
    expect((await owner.get(`/channels/${channel.id}/summary`).expect(200)).body.data.lastHistorySyncJobId).toBe(jobId);

    // second run: everything already known is skipped
    const again = (await owner.post(`/channels/${channel.id}/sync`, { days: 7 }).expect(202)).body.data.jobId;
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/jobs/${again}`).expect(200)).body.data.result).toEqual({ conversations: 25, messagesImported: 0, messagesSkipped: 625 });
    expect(await db.message.count({ where: { workspaceId: owner.workspaceId } })).toBe(625);

    // token error
    meta.failNext('conversations', new MetaError('token', 'Error validating access token', 190, 463, 400));
    const failing = (await owner.post(`/channels/${channel.id}/sync`, { days: 30 }).expect(202)).body.data.jobId;
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/jobs/${failing}`).expect(200)).body.data).toMatchObject({ status: 'failed', error: { code: 'PAGE_SYNC_TOKEN_EXPIRED' } });
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe('needs_reconnect');
    expect((await owner.post(`/channels/${channel.id}/sync`, { days: 7 }).expect(401)).body.error.code).toBe('PAGE_SYNC_TOKEN_EXPIRED');
    expect((await owner.post(`/channels/${channel.id}/sync`, { days: 5 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('carry-over M1: workspace deletion unsubscribes the pages through the Meta port', () => {
  it('scheduling the deletion disconnects every page and queues the unsubscribe; the purge is a safety net', async () => {
    const owner = await asOwner(app);
    const channel = await connectedPage(owner, app);
    const ig = await instagramChild(channel.id);
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    const { CryptoService: Crypto } = await import('../../src/core/crypto/crypto.service');
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await app.app.get(Crypto).hashPassword('Motdepasse-2026') } });
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    const before = meta.callsOf('unsubscribePage').length;
    await owner.delete('/workspace').send({ password: 'Motdepasse-2026', confirmName: ws.name }).expect(200);
    expect((await db.channel.findMany({ where: { workspaceId: owner.workspaceId } })).every((c) => c.status === 'disconnected')).toBe(true);
    await work(app, [owner.workspaceId]);
    // one call per page; the linked Instagram account has no subscription of its own
    const pages = (await db.channel.findMany({ where: { workspaceId: owner.workspaceId, platform: 'facebook' } })).map((c) => c.externalId).sort();
    expect(pages).toHaveLength(2);
    expect(meta.callsOf('unsubscribePage').slice(before).map((c) => String(c.args.externalId)).sort()).toEqual(pages);
    expect(ig).not.toBeNull();
    expect((await db.channel.findMany({ where: { workspaceId: owner.workspaceId } })).every((c) => c.accessToken === null)).toBe(true);

    // a page that still holds a token at purge time (lost job) is unsubscribed then
    const tokens = app.app.get(ChannelTokens);
    await db.channel.update({ where: { id: channel.id }, data: { accessToken: tokens.seal('fake-page-token.left-over') } });
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { deletionScheduledAt: new Date(Date.now() - 1000) } });
    const mid = meta.callsOf('unsubscribePage').length;
    expect(await app.app.get(WorkspaceDeletionService).purgeDue()).toBeGreaterThanOrEqual(1);
    expect(meta.callsOf('unsubscribePage').slice(mid).map((c) => c.args.externalId)).toEqual([channel.externalId]);
    expect(await db.channel.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });
});
