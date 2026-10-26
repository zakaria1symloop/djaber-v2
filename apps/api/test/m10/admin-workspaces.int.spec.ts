// M10 (api-a) — ADM-02 workspaces (list filters, detail + tabs, suspend / reactivate, change plan, extend, create for a client,
// schedule / cancel deletion, force-release channel AT-CHN-08, AT-DEL-05) and ADM-03 users + ADM-16 deletion requests (AT-DEL-03).
import { randomUUID } from 'node:crypto';
import { rawPrisma as db } from '@djaber/db';
import { asOperator, asOwner, asPlatform, createUser } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { callback, connectedPage, startConnect, fakeMeta, forbidNetwork } from '../support/m3';
import { mailsTo as mailsOf } from '../support/m1';
import { drainAll } from '../support/m10-ops';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  net.restore();
  await app.close();
});

const REASON = 'Demande vérifiée par ticket #4821';
const mailsTo = (to: string) => mailsOf(app, to);
const lastAudit = (action: string, entityId: string) => db.auditLog.findFirst({ where: { action, entityId }, orderBy: { at: 'desc' } });

describe('ADM-02 workspaces list & detail', () => {
  it('list with filters (status, plan, q, credits, withPages) + row actions per role; detail tabs; 404; read roles allowed', async () => {
    const a = await asOwner(app, 'pro');
    const b = await asOwner(app, 'starter');
    const sa = await asPlatform(app);
    const wsB = await db.workspace.findUniqueOrThrow({ where: { id: b.workspaceId } });
    const list = (await sa.get(`/admin/workspaces?q=${encodeURIComponent(wsB.name)}`).expect(200)).body;
    expect(list.meta.total).toBe(1);
    const row = list.data[0];
    expect(row).toMatchObject({ id: b.workspaceId, plan: { slug: 'starter' }, subscriptionStatus: 'active', status: 'active', pages: { count: 0 } });
    expect(row.owner.email).toContain('@');
    expect(row.actions.map((x: any) => x.key)).toEqual(['open', 'impersonate', 'change_plan', 'add_credits', 'remove_credits', 'extend_trial', 'suspend', 'schedule_deletion']);
    expect((await sa.get(`/admin/workspaces?planSlug=starter&pageSize=100`).expect(200)).body.data.map((w: any) => w.id)).toContain(b.workspaceId);
    expect((await sa.get(`/admin/workspaces?planSlug=starter&pageSize=100`).expect(200)).body.data.map((w: any) => w.id)).not.toContain(a.workspaceId);
    expect((await sa.get(`/admin/workspaces?withPages=true&pageSize=100`).expect(200)).body.data.map((w: any) => w.id)).not.toContain(b.workspaceId);
    expect((await sa.get('/admin/workspaces?credits=exhausted&pageSize=100').expect(200)).body.data.every((w: any) => w.credits.exhausted)).toBe(true);
    await sa.get('/admin/workspaces?status=nope').expect(422);
    await sa.get('/admin/workspaces?pageSize=1000').expect(422);
    // read role: same list, write actions greyed with FORBIDDEN
    const read = await asPlatform(app, 'read');
    const rRow = (await read.get(`/admin/workspaces?q=${encodeURIComponent(wsB.name)}`).expect(200)).body.data[0];
    expect(rRow.actions.find((x: any) => x.key === 'suspend')).toEqual({ key: 'suspend', enabled: false, reasonCode: 'FORBIDDEN' });
    expect(rRow.actions.find((x: any) => x.key === 'open')).toMatchObject({ enabled: true });
    const detail = (await read.get(`/admin/workspaces/${b.workspaceId}`).expect(200)).body.data;
    expect(detail).toMatchObject({ id: b.workspaceId, slug: wsB.slug, subscription: { cycle: 'monthly' }, counts: { members: 1 } });
    expect((await read.get(`/admin/workspaces/${b.workspaceId}/members`).expect(200)).body.data[0]).toMatchObject({ role: 'owner' });
    expect((await read.get(`/admin/workspaces/${b.workspaceId}/subscription`).expect(200)).body.data).toMatchObject({ plan: { slug: 'starter' }, status: 'active' });
    expect(Array.isArray((await read.get(`/admin/workspaces/${b.workspaceId}/channels`).expect(200)).body.data)).toBe(true);
    expect(Array.isArray((await read.get(`/admin/workspaces/${b.workspaceId}/agents`).expect(200)).body.data)).toBe(true);
    const credits = (await read.get(`/admin/workspaces/${b.workspaceId}/credits`).expect(200)).body;
    expect(credits.meta.balance).toBeTruthy();
    expect((await read.get(`/admin/workspaces/${b.workspaceId}/audit`).expect(200)).body.meta.total).toBeGreaterThanOrEqual(0);
    await read.get(`/admin/workspaces/${randomUUID()}`).expect(404);
    await read.get('/admin/workspaces/not-a-uuid').expect(404);
  });

  it('suspend ⇒ status suspended, every merchant mutation 403 WORKSPACE_SUSPENDED, workspace.suspended to the Owner, audit with reason; reactivate; 422 / 403 / 409', async () => {
    const owner = await asOwner(app);
    const sa = await asPlatform(app);
    await sa.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'fraud', note: 'court', notifyOwner: true }).expect(422);
    await sa.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'nope', note: REASON }).expect(422);
    expect((await (await asPlatform(app, 'support')).post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'fraud', note: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const d = (await sa.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'fraud', note: REASON, notifyOwner: true }).expect(200)).body.data;
    expect(d).toMatchObject({ status: 'suspended', suspendReason: 'fraud', suspendNote: REASON });
    expect(d.actions.find((x: any) => x.key === 'reactivate')).toMatchObject({ enabled: true });
    expect((await lastAudit('workspace.suspend', owner.workspaceId))!.reason).toBe(REASON);
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'workspace_suspended' } })).toBe(1);
    expect((await owner.post('/products', { name: 'P', sku: `S-${randomUUID().slice(0, 6)}`, price: 100 }).expect(403)).body.error.code).toBe('WORKSPACE_SUSPENDED');
    await owner.get('/workspace').expect(200);
    expect((await sa.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'fraud', note: REASON }).expect(409)).body.error.code).toBe('CONFLICT');
    await sa.post(`/admin/workspaces/${owner.workspaceId}/reactivate`, { reason: 'x' }).expect(422);
    expect((await sa.post(`/admin/workspaces/${owner.workspaceId}/reactivate`, { reason: REASON }).expect(200)).body.data.status).toBe('active');
    await drainAll(app, ['notification']);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'workspace_reactivated' } })).toBe(1);
    expect((await owner.post('/products', { name: 'P', sku: `S-${randomUUID().slice(0, 6)}`, price: 100 })).status).not.toBe(403);
    await sa.post(`/admin/workspaces/${randomUUID()}/reactivate`, { reason: REASON }).expect(404);
  });

  it('change plan now / next period, extend trial, patch; audit rows with reason', async () => {
    const owner = await asOwner(app, 'starter');
    const sa = await asPlatform(app);
    const pro = await db.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    await sa.post(`/admin/workspaces/${owner.workspaceId}/plan`, { planId: pro.id, cycle: 'monthly', when: 'now' }).expect(422);
    await sa.post(`/admin/workspaces/${owner.workspaceId}/plan`, { planId: randomUUID(), cycle: 'monthly', when: 'now', reason: REASON }).expect(404);
    const d = (await sa.post(`/admin/workspaces/${owner.workspaceId}/plan`, { planId: pro.id, cycle: 'monthly', when: 'now', reason: REASON }).expect(200)).body.data;
    expect(d.plan.slug).toBe('pro');
    expect((await lastAudit('subscription.plan_change', d.subscription ? (await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'cancelled' } })).id : ''))!.reason).toBe(REASON);
    const starter = await db.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
    await sa.post(`/admin/workspaces/${owner.workspaceId}/plan`, { planId: starter.id, cycle: 'monthly', when: 'next_period', reason: REASON }).expect(200);
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' } });
    expect(sub.nextPlanId).toBe(starter.id);
    const end = sub.currentPeriodEnd.getTime();
    await sa.post(`/admin/workspaces/${owner.workspaceId}/extend`, { reason: REASON }).expect(422);
    await sa.post(`/admin/workspaces/${owner.workspaceId}/extend`, { days: 7, reason: REASON }).expect(200);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).currentPeriodEnd.getTime()).toBe(end + 7 * 86_400_000);
    const p = (await sa.patch(`/admin/workspaces/${owner.workspaceId}`, { name: 'Renamed shop', reason: REASON }).expect(200)).body.data;
    expect(p.name).toBe('Renamed shop');
    expect((await lastAudit('workspace.update', owner.workspaceId))!.reason).toBe(REASON);
  });

  it('tester report 22/10 UX-020: extending a trial tells the Owner (notification subscription.trial_extended, in-app + e-mail)', async () => {
    const owner = await asOwner(app);
    const sa = await asPlatform(app);
    const trialEnd = new Date(Date.now() + 5 * 86_400_000);
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'trial', trialEndsAt: trialEnd, currentPeriodEnd: trialEnd } });
    await sa.post(`/admin/workspaces/${owner.workspaceId}/extend`, { days: 7, reason: REASON }).expect(200);
    const until = new Date(trialEnd.getTime() + 7 * 86_400_000);
    const row = await db.outbox.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, topic: 'notification', key: `subscription_trial_extended:${sub.id}:${until.getTime()}` } });
    const day = new Date(until.getTime() + 3_600_000).toISOString().slice(0, 10);
    expect(JSON.stringify(row.payload)).toContain(`${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`);
  });

  it('create a workspace for a client (owner created + invite link, plan, trial months, initial credits); duplicate owner ⇒ 409; idempotent replay', async () => {
    const sa = await asPlatform(app);
    const email = `client-${randomUUID().slice(0, 6)}@shop.dz`;
    const body = { name: 'Boutique Client', ownerEmail: email, ownerFirstName: 'Amel', planSlug: 'starter', trialMonths: 2, initialCredits: 500, sendInvite: true, assistedOnboarding: true, reason: REASON };
    await sa.post('/admin/workspaces', { ...body, reason: 'short' }).expect(422);
    await sa.post('/admin/workspaces', { ...body, ownerEmail: 'bad' }).expect(422);
    const key = randomUUID();
    const res = await sa.post('/admin/workspaces', body).set('Idempotency-Key', key).expect(201);
    const d = res.body.data;
    expect(d).toMatchObject({ name: 'Boutique Client', plan: { slug: 'starter' }, subscriptionStatus: 'trial', assistedOnboarding: true });
    expect(d.owner.email).toBe(email);
    const sub = await db.subscription.findFirstOrThrow({ where: { workspaceId: d.id } });
    expect(Math.round((sub.trialEndsAt!.getTime() - sub.currentPeriodStart.getTime()) / 86_400_000)).toBe(60);
    expect(await db.creditLedger.count({ where: { workspaceId: d.id, action: 'grant', credits: 500 } })).toBe(1);
    expect((await mailsTo(email)).length).toBeGreaterThanOrEqual(1);
    expect((await lastAudit('workspace.create', d.id))!.reason).toBe(REASON);
    const replay = await sa.post('/admin/workspaces', body).set('Idempotency-Key', key).expect(201);
    expect(replay.body.data.id).toBe(d.id);
    expect((await sa.post('/admin/workspaces', { ...body, name: 'Autre' }).expect(409)).body.error.code).toBe('CONFLICT');
  });

  it('AT-DEL-05 schedule deletion ⇒ channels disconnected, subscription cancelled, Owner e-mail, mutations WORKSPACE_DELETION_SCHEDULED; cancel ⇒ active, channels stay disconnected', async () => {
    const owner = await asOwner(app);
    fakeMeta(app);
    const ch = await connectedPage(owner, app);
    const sa = await asPlatform(app);
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    await sa.post(`/admin/workspaces/${owner.workspaceId}/schedule-deletion`, { confirmName: 'wrong', reason: REASON }).expect(422);
    const d = (await sa.post(`/admin/workspaces/${owner.workspaceId}/schedule-deletion`, { confirmName: ws.name, reason: REASON }).expect(200)).body.data;
    expect(d.status).toBe('deletion_scheduled');
    expect(Math.round((new Date(d.deletionScheduledAt).getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect((await db.channel.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe('disconnected');
    expect((await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' } })).cancelAtPeriodEnd).toBe(true);
    const ownerUser = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect((await mailsTo(ownerUser.email)).some((m: any) => m.template === 'workspace/deletion-scheduled')).toBe(true);
    expect((await owner.post('/products', { name: 'P', sku: `D-${randomUUID().slice(0, 6)}`, price: 1 }).expect(409)).body.error.code).toBe('WORKSPACE_DELETION_SCHEDULED');
    expect((await sa.post(`/admin/workspaces/${owner.workspaceId}/schedule-deletion`, { confirmName: ws.name, reason: REASON }).expect(409)).body.error.code).toBe('WORKSPACE_DELETION_SCHEDULED');
    expect((await lastAudit('workspace.deletion_scheduled', owner.workspaceId))!.reason).toBe(REASON);
    const c = (await sa.delete(`/admin/workspaces/${owner.workspaceId}/schedule-deletion`).send({ reason: REASON }).expect(200)).body.data;
    expect(c.status).toBe('active');
    expect((await db.channel.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe('disconnected');
    expect((await db.subscription.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, status: 'active' } })).cancelAtPeriodEnd).toBe(false);
  });
});

describe('AT-CHN-08 force-release a channel', () => {
  it('page connected in A, connect in B ⇒ PAGE_ALREADY_CONNECTED_ELSEWHERE; super admin release (reason, audited) ⇒ B can connect', async () => {
    const meta = fakeMeta(app);
    const a = await asOwner(app);
    const pageA = await connectedPage(a, app);
    const b = await asOwner(app);
    const page = { id: pageA.externalId, name: 'Page partagée', accessToken: `fake-page-token.${pageA.externalId}`, tasks: ['MANAGE', 'MESSAGING'], pictureUrl: null, followersCount: 10 };
    let s = await startConnect(b);
    meta.setPages(s.seed, [page]);
    expect((await callback(app, 'facebook', { code: s.code, state: s.state })).pages.map((p) => p.code)).toEqual(['PAGE_ALREADY_CONNECTED_ELSEWHERE']);

    const sa = await asPlatform(app);
    const found = (await sa.get(`/admin/channels?q=${pageA.externalId}`).expect(200)).body.data;
    expect(found[0]).toMatchObject({ id: pageA.id, workspace: { id: a.workspaceId } });
    await sa.post(`/admin/channels/${pageA.id}/release`, { reason: 'court' }).expect(422);
    expect((await (await asPlatform(app, 'support')).post(`/admin/channels/${pageA.id}/release`, { reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await (await asOperator(app, a.workspaceId)).post(`/admin/channels/${pageA.id}/release`, { reason: REASON }).expect(403);
    await sa.post(`/admin/channels/${randomUUID()}/release`, { reason: REASON }).expect(404);
    const released = (await sa.post(`/admin/channels/${pageA.id}/release`, { reason: REASON }).expect(200)).body.data;
    expect(released).toMatchObject({ id: pageA.id, status: 'disconnected' });
    const rowA = await db.channel.findUniqueOrThrow({ where: { id: pageA.id } });
    expect(rowA.externalId).toBe(`${pageA.externalId}#${pageA.id}`);
    expect(rowA.workspaceId).toBe(a.workspaceId); // history kept in A
    expect((await lastAudit('channel.force_release', pageA.id))!.reason).toBe(REASON);
    expect((await sa.post(`/admin/channels/${pageA.id}/release`, { reason: REASON }).expect(409)).body.error.code).toBe('CONFLICT');

    s = await startConnect(b);
    meta.setPages(s.seed, [page]);
    const report = await callback(app, 'facebook', { code: s.code, state: s.state });
    expect(report.pages.filter((p) => p.platform === 'facebook').map((p) => [p.status, p.code])).toEqual([['connected', null]]);
    expect(await db.channel.count({ where: { workspaceId: b.workspaceId, externalId: pageA.externalId } })).toBe(1);
  });
});

describe('ADM-03 users & ADM-16 deletion requests', () => {
  it('users list filters, detail, actions (block / unblock / revoke / reset / resend cooldown / disable-2fa rules), patch; 403 for support', async () => {
    const sa = await asPlatform(app);
    const owner = await asOwner(app);
    const u = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
    const list = (await sa.get(`/admin/users?q=${encodeURIComponent(u.email)}`).expect(200)).body;
    expect(list.data[0]).toMatchObject({ id: u.id, platformRole: 'none', status: 'active', workspaces: [{ id: owner.workspaceId, role: 'owner' }] });
    expect((await sa.get('/admin/users?platformRole=super_admin&pageSize=100').expect(200)).body.data.every((x: any) => x.platformRole === 'super_admin')).toBe(true);
    await sa.get('/admin/users?status=weird').expect(422);
    const detail = (await sa.get(`/admin/users/${u.id}`).expect(200)).body.data;
    expect(detail).toMatchObject({ id: u.id, locale: 'fr', deletion: null, activity: { tickets: 0 } });
    expect((await (await asPlatform(app, 'support')).post(`/admin/users/${u.id}/block`, { reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await sa.post(`/admin/users/${u.id}/block`, { reason: 'x' }).expect(422);
    expect((await sa.post(`/admin/users/${u.id}/block`, { reason: REASON }).expect(200)).body.data.status).toBe('blocked');
    expect((await lastAudit('user.block', u.id))!.reason).toBe(REASON);
    expect((await owner.get('/workspace').expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await sa.post(`/admin/users/${u.id}/block`, { reason: REASON }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await sa.post(`/admin/users/${u.id}/reset-password`, { reason: REASON }).expect(403)).body.error.code).toBe('AUTH_USER_BLOCKED');
    expect((await sa.post(`/admin/users/${u.id}/unblock`, { reason: REASON }).expect(200)).body.data.status).toBe('active');
    await sa.post(`/admin/users/${u.id}/reset-password`, { reason: REASON }).expect(200);
    expect((await mailsTo(u.email)).some((m: any) => m.template === 'auth/reset')).toBe(true);
    await sa.post(`/admin/users/${u.id}/revoke-sessions`, { reason: REASON }).expect(200);
    expect((await sa.post(`/admin/users/${u.id}/resend-verification`, { reason: REASON }).expect(409)).body.error.code).toBe('CONFLICT');
    const unverified = await createUser({ emailVerified: false });
    await sa.post(`/admin/users/${unverified.id}/resend-verification`, { reason: REASON }).expect(200);
    expect((await sa.post(`/admin/users/${unverified.id}/resend-verification`, { reason: REASON }).expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect((await sa.post(`/admin/users/${u.id}/disable-2fa`, { reason: REASON }).expect(409)).body.error.code).toBe('CONFLICT');
    const member = await asPlatform(app, 'read');
    expect((await sa.post(`/admin/users/${member.userId}/disable-2fa`, { reason: REASON }).expect(403)).body.error.code).toBe('TWO_FA_REQUIRED_FOR_ROLE');
    await sa.post(`/admin/users/${u.id}/explode`, { reason: REASON }).expect(404);
    expect((await sa.patch(`/admin/users/${u.id}`, { firstName: 'Zakaria', reason: REASON }).expect(200)).body.data.firstName).toBe('Zakaria');
    await sa.get(`/admin/users/${randomUUID()}`).expect(404);
  });

  it('AT-DEL-03 admin deletion of an owner ⇒ BLOQUÉE (ACCOUNT_OWNS_WORKSPACE); "Résoudre" keeps it blocked while the cause stays (debt); cancel; non-owner ⇒ grace, memberships removed', async () => {
    const sa = await asPlatform(app);
    const owner = await asOwner(app);
    expect((await sa.delete(`/admin/users/${owner.userId}`).send({ reason: REASON }).expect(422)).body.error.code).toBe('ACCOUNT_OWNS_WORKSPACE');
    const req = await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: owner.userId } });
    expect(req).toMatchObject({ status: 'blocked', blockedReason: 'ACCOUNT_OWNS_WORKSPACE', source: 'admin' });
    // the workspace enters its own deletion grace but has an unpaid invoice ⇒ WORKSPACE_HAS_DEBT
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { status: 'deletion_scheduled', deletionScheduledAt: new Date(Date.now() + 30 * 86_400_000) } });
    const inv = await db.invoice.create({ data: { workspaceId: owner.workspaceId, number: `T-${randomUUID().slice(0, 8)}`, kind: 'manual', status: 'unpaid', amount: 1900, lines: [] } });
    const list = (await sa.get('/admin/deletion-requests?status=blocked&pageSize=100').expect(200)).body;
    expect(list.meta.counts.blocked).toBeGreaterThanOrEqual(1);
    const row = list.data.find((r: any) => r.id === req.id);
    expect(row.blockedReasons).toEqual(['WORKSPACE_HAS_DEBT']);
    expect(row.actions.find((a: any) => a.key === 'resolve')).toMatchObject({ enabled: true });
    const resolved = (await sa.post(`/admin/deletion-requests/${req.id}/resolve`, { reason: REASON }).expect(200)).body.data;
    expect(resolved).toMatchObject({ status: 'blocked', blockedReason: 'WORKSPACE_HAS_DEBT' });
    await db.invoice.update({ where: { id: inv.id }, data: { status: 'paid', paidAt: new Date() } });
    const graced = (await sa.post(`/admin/deletion-requests/${req.id}/resolve`, { reason: REASON }).expect(200)).body.data;
    expect(graced.status).toBe('grace');
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe('deletion_scheduled');
    expect((await lastAudit('account.deletion_resolve', req.id))!.reason).toBe(REASON);
    const cancelled = (await sa.post(`/admin/deletion-requests/${req.id}/cancel`, { reason: REASON }).expect(200)).body.data;
    expect(cancelled.status).toBe('cancelled');
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).status).toBe('active');
    await sa.post(`/admin/deletion-requests/${req.id}/cancel`, { reason: REASON }).expect(409);
    await sa.post(`/admin/deletion-requests/${req.id}/explode`, { reason: REASON }).expect(404);
    expect((await (await asPlatform(app, 'finance')).post(`/admin/deletion-requests/${req.id}/cancel`, { reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');

    // an operator member (not owner) ⇒ grace at once, memberships removed; process-now ⇒ anonymised
    const op = await asOperator(app, owner.workspaceId);
    await (await asPlatform(app, 'support')).delete(`/admin/users/${op.userId}`).send({ reason: REASON }).expect(403);
    const d = (await sa.delete(`/admin/users/${op.userId}`).send({ reason: REASON }).expect(200)).body.data;
    expect(d.deletion.status).toBe('grace');
    expect(await db.membership.count({ where: { userId: op.userId } })).toBe(0);
    expect((await sa.delete(`/admin/users/${op.userId}`).send({ reason: REASON }).expect(409)).body.error.code).toBe('ACCOUNT_DELETION_PENDING');
    const r2 = await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: op.userId, status: 'grace' } });
    const done = (await (await asPlatform(app, 'support')).post(`/admin/deletion-requests/${r2.id}/process-now`, { reason: REASON }).expect(200)).body.data;
    expect(done.status).toBe('anonymised');
    expect((await db.user.findUniqueOrThrow({ where: { id: op.userId } })).firstName).toBe('Membre supprimé');
  });
});
