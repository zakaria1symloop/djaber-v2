// M1 — members & invitations (FL-13, D30): invite, resend, revoke, preview, accept, role change, removal, plan limit.
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { anonymous, asAdmin, asLoneUser, asOperator, asOwner, createUser } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { api, db, eventually, login, mailsTo, PASSWORD, refreshCookie, register, setPassword, tokenOf, uniqEmail, withToken } from '../support/m1';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const DAY = 86_400_000;
const invite = async (owner: { post: (url: string, body?: object) => any }, role: 'admin' | 'operator' = 'operator', email = uniqEmail('invite')) => {
  const res = await owner.post('/workspace/invitations', { email, role }).expect(201);
  const [mail] = await mailsTo(app, email, 'workspace/invitation');
  return { email, id: res.body.data.id as string, token: tokenOf(mail), dto: res.body.data, mail: mail! };
};

describe('invitations', () => {
  it('AT-AUTH-09 owner invites an operator; the operator signs up with the link, joins without owning a workspace, and cannot delete an order', async () => {
    const owner = await register(app, { workspaceName: 'Boutique Oran' });
    const inv = await invite(owner, 'operator');
    expect(inv.dto).toMatchObject({ email: inv.email, role: 'operator', sentAt: expect.any(String), expiresAt: expect.any(String), resendAvailableAt: expect.any(String) });
    expect(Math.round((new Date(inv.dto.expiresAt).getTime() - Date.now()) / DAY)).toBe(7);
    expect(new Date(inv.dto.resendAvailableAt).getTime() - new Date(inv.dto.sentAt).getTime()).toBe(60_000);
    expect(String(inv.mail.params!.url)).toContain(`/invitations/${inv.token}`);
    expect(inv.mail.subject).toContain('Boutique Oran');
    // only the hash is stored
    expect(await db.invitation.count({ where: { tokenHash: inv.token } })).toBe(0);

    // public preview of the invitation page
    const preview = await anonymous(app).get(`/invitations/${inv.token}`).expect(200);
    expect(preview.body.data).toEqual({ workspaceName: 'Boutique Oran', workspaceLogoUrl: null, inviterName: 'Amine Benali', email: inv.email, role: 'operator', expiresAt: inv.dto.expiresAt });

    // sign-up with the invited e-mail: no workspace is created (D30), e-mail already verified, lands in the inviter's workspace
    const before = await db.workspace.count();
    const op = await register(app, { email: inv.email, invitationToken: inv.token });
    expect(await db.workspace.count()).toBe(before);
    expect(op.res.body.data.user).toMatchObject({ ownedWorkspaceId: null, emailVerifiedAt: expect.any(String) });
    expect(op.res.body.data.user.memberships).toEqual([expect.objectContaining({ workspaceId: owner.workspaceId, role: 'operator', readOnly: false })]);
    expect(op.res.body.data.user.workspace).toMatchObject({ id: owner.workspaceId, role: 'operator' });
    expect(await mailsTo(app, inv.email, 'auth/verify')).toHaveLength(0);

    // the operator works in the workspace but cannot delete an order (Admin+) nor manage members
    await op.get('/workspace').expect(200);
    // the real order delete route (M5; `orders.money` = Admin+): 403 for the operator, the owner reaches it (404: no such order)
    const missing = '00000000-0000-7000-8000-000000000000';
    expect((await op.delete(`/orders/${missing}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await owner.delete(`/orders/${missing}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await op.post('/workspace/invitations', { email: uniqEmail(), role: 'operator' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const members = await op.get('/workspace/members').expect(200);
    expect(members.body.data.map((m: any) => m.role)).toEqual(['owner', 'operator']);
    expect(members.body.data[1]).toMatchObject({ user: { email: inv.email, firstName: 'Amine' }, readOnly: false, joinedAt: expect.any(String) });
    expect(JSON.stringify(members.body.data)).not.toMatch(/passwordHash|totpSecret/);

    // the link works once
    expect((await anonymous(app).get(`/invitations/${inv.token}`).expect(410)).body.error.code).toBe('INVITATION_EXPIRED');
    expect((await owner.get('/workspace/invitations').expect(200)).body.data).toEqual([]);
    expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'invitation.create', entityId: inv.id } }))).toBeTruthy();
  });

  it('AT-AUTH-10 an invited-only user owns no workspace and can create one later, once', async () => {
    const owner = await asOwner(app);
    const inv = await invite(owner, 'admin');
    const user = await register(app, { email: inv.email, invitationToken: inv.token });
    expect(user.res.body.data.user.ownedWorkspaceId).toBeNull();
    const created = await withToken(app, user.token).post('/workspaces', { name: 'Mon propre espace' }).expect(201);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).ownedWorkspaceId).toBe(created.body.data.id);
    await withToken(app, user.token).post('/workspaces', { name: 'Encore un' }).expect(409);
    // still an admin of the inviter's workspace
    expect((await user.get('/workspace').expect(200)).body.data.id).toBe(owner.workspaceId);
    expect((await withToken(app, user.token).get('/me').expect(200)).body.data.memberships).toHaveLength(2);
  });

  it('accept as a logged-in user: right e-mail ⇒ membership; other e-mail ⇒ INVITATION_EMAIL_MISMATCH; expired ⇒ 410; unknown ⇒ 404', async () => {
    const owner = await asOwner(app);
    const existing = await createUser({ emailVerified: false });
    await setPassword(app, existing.id);
    const inv = await invite(owner, 'admin', existing.email);
    const session = await login(app, existing.email).expect(200);
    const invitee = withToken(app, session.body.data.accessToken);
    const stranger = await asLoneUser(app);

    // logged in with another e-mail
    const mismatch = await stranger.get(`/invitations/${inv.token}`).expect(403);
    expect(mismatch.body.error).toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH', params: { email: existing.email } });
    expect((await stranger.post(`/invitations/${inv.token}/accept`).expect(403)).body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
    await anonymous(app).post(`/invitations/${inv.token}/accept`).expect(401);
    expect((await invitee.post('/invitations/unknown-token-unknown-token/accept').expect(404)).body.error.code).toBe('NOT_FOUND');
    await anonymous(app).get('/invitations/unknown-token-unknown-token').expect(404);

    await invitee.get(`/invitations/${inv.token}`).expect(200);
    const ok = await invitee.post(`/invitations/${inv.token}/accept`).expect(200);
    expect(ok.body.data).toMatchObject({ workspaceId: owner.workspaceId, role: 'admin', readOnly: false });
    const user = await db.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(user.emailVerifiedAt).not.toBeNull(); // the link proves the mailbox
    expect(user.lastWorkspaceId).toBe(owner.workspaceId);
    expect((await invitee.get('/workspace').expect(200)).body.data.id).toBe(owner.workspaceId);
    expect((await invitee.post(`/invitations/${inv.token}/accept`).expect(410)).body.error.code).toBe('INVITATION_EXPIRED');
    expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'invitation.accept' } }))).toBeTruthy();

    // sign-up with an invitation for another address is refused
    const inv2 = await invite(owner, 'operator');
    const wrong = await api(app).post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: uniqEmail(), password: PASSWORD, invitationToken: inv2.token }).expect(403);
    expect(wrong.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');

    // after 7 days
    await db.invitation.update({ where: { id: inv2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anonymous(app).get(`/invitations/${inv2.token}`).expect(410)).body.error.code).toBe('INVITATION_EXPIRED');
    const late = await api(app).post('/api/v1/auth/register').send({ firstName: 'A', lastName: 'B', email: inv2.email, password: PASSWORD, invitationToken: inv2.token }).expect(410);
    expect(late.body.error.code).toBe('INVITATION_EXPIRED');
    expect(await db.user.count({ where: { email: inv2.email } })).toBe(0);
  });

  it('invite: validation, permission matrix, MEMBER_ALREADY_EXISTS, INVITATION_PENDING, re-invite after expiry', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);

    const bad = await owner.post('/workspace/invitations', { email: 'nope', role: 'owner' }).expect(422);
    expect(bad.body.error.fields).toMatchObject({ email: 'validation.email', role: 'validation.invalid' });
    await owner.post('/workspace/invitations', { email: uniqEmail(), role: 'operator', workspaceId: 'x' }).expect(422);
    // members.write = Owner only; members.read = everyone
    for (const actor of [admin, operator]) {
      expect((await actor.post('/workspace/invitations', { email: uniqEmail(), role: 'operator' }).expect(403)).body.error.code).toBe('FORBIDDEN');
      await actor.get('/workspace/members').expect(200);
      await actor.get('/workspace/invitations').expect(200);
    }
    await anonymous(app).get('/workspace/members').expect(401);

    const adminEmail = (await db.user.findUniqueOrThrow({ where: { id: admin.userId } })).email;
    expect((await owner.post('/workspace/invitations', { email: adminEmail.toUpperCase(), role: 'operator' }).expect(409)).body.error.code).toBe('MEMBER_ALREADY_EXISTS');
    const inv = await invite(owner);
    expect((await owner.post('/workspace/invitations', { email: inv.email, role: 'admin' }).expect(409)).body.error.code).toBe('INVITATION_PENDING');
    expect((await owner.get('/workspace/invitations').expect(200)).body.data.map((i: any) => i.email)).toEqual([inv.email]);
    // another workspace may invite the same address
    const other = await asOwner(app);
    await other.post('/workspace/invitations', { email: inv.email, role: 'admin' }).expect(201);
    // an expired invitation is replaced by a new one
    await db.invitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const again = await owner.post('/workspace/invitations', { email: inv.email, role: 'admin' }).expect(201);
    expect(again.body.data.id).not.toBe(inv.id);
    expect(await db.invitation.count({ where: { workspaceId: owner.workspaceId, email: inv.email } })).toBe(1);
  });

  it('resend: 60 s cooldown (429), new link replaces the old one; revoke; cross-workspace ids ⇒ 404', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const other = await asOwner(app);
    const inv = await invite(owner);

    const cool = await owner.post(`/workspace/invitations/${inv.id}/resend`).expect(429);
    expect(cool.body.error.code).toBe('RATE_LIMITED');
    expect(cool.body.error.params.retryAfter).toBeGreaterThan(0);
    expect(cool.body.error.params.retryAfter).toBeLessThanOrEqual(60);
    await admin.post(`/workspace/invitations/${inv.id}/resend`).expect(403);
    await admin.delete(`/workspace/invitations/${inv.id}`).expect(403);
    // AT-AUTH-11: ids of another workspace
    await other.post(`/workspace/invitations/${inv.id}/resend`).expect(404);
    await other.delete(`/workspace/invitations/${inv.id}`).expect(404);
    await owner.post('/workspace/invitations/not-a-uuid/resend').expect(400);

    await db.invitation.update({ where: { id: inv.id }, data: { lastSentAt: new Date(Date.now() - 61_000) } });
    const resent = await owner.post(`/workspace/invitations/${inv.id}/resend`).expect(200);
    expect(new Date(resent.body.data.sentAt).getTime()).toBeGreaterThan(new Date(inv.dto.sentAt).getTime());
    const mails = await mailsTo(app, inv.email, 'workspace/invitation');
    expect(mails).toHaveLength(2);
    const fresh = tokenOf(mails[0]);
    expect(fresh).not.toBe(inv.token);
    await anonymous(app).get(`/invitations/${inv.token}`).expect(404); // the old link no longer exists
    await anonymous(app).get(`/invitations/${fresh}`).expect(200);

    await owner.delete(`/workspace/invitations/${inv.id}`).expect(204);
    await owner.delete(`/workspace/invitations/${inv.id}`).expect(404);
    await anonymous(app).get(`/invitations/${fresh}`).expect(404);
    for (const action of ['invitation.resend', 'invitation.revoke']) {
      expect(await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action, entityId: inv.id } }))).toBeTruthy();
    }
  });

  it('plan maxMembers: invite beyond the limit ⇒ 403 PLAN_LIMIT; accepted while over the limit ⇒ read-only member', async () => {
    // free plan: 1 member
    const free = await asOwner(app, 'free');
    const limit = await free.post('/workspace/invitations', { email: uniqEmail(), role: 'operator' }).expect(403);
    expect(limit.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'members', limit: 1, current: 1 } });

    // starter: 3 members; pending invitations count
    const starter = await asOwner(app, 'starter');
    const first = await invite(starter);
    const second = await invite(starter);
    expect((await starter.post('/workspace/invitations', { email: uniqEmail(), role: 'operator' }).expect(403)).body.error.code).toBe('PLAN_LIMIT');

    // the plan is downgraded before the invitations are accepted ⇒ the new members join read-only (02 §5)
    await register(app, { email: first.email, invitationToken: first.token });
    const freePlan = await db.plan.findUniqueOrThrow({ where: { slug: 'free' } });
    await db.subscription.updateMany({ where: { workspaceId: starter.workspaceId }, data: { planId: freePlan.id } });
    await app.app.get(TenantResolver).invalidate(starter.workspaceId);
    const late = await register(app, { email: second.email, invitationToken: second.token });
    expect(late.res.body.data.user.memberships).toEqual([expect.objectContaining({ workspaceId: starter.workspaceId, readOnly: true })]);
    await late.get('/workspace').expect(200);
    expect((await late.post('/workspace/quick-replies', { title: 'X', body: 'y' }).expect(403)).body.error.code).toBe('FORBIDDEN'); // operator
    const list = await starter.get('/workspace/members?state=read_only').expect(200);
    expect(list.body.data.map((m: any) => m.user.email)).toEqual([second.email]);
    expect((await starter.get('/workspace/members?state=active').expect(200)).body.data).toHaveLength(2);
  });
});

describe('members', () => {
  it('list filters: role, state, q', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    await asOperator(app, owner.workspaceId);
    await db.user.update({ where: { id: admin.userId }, data: { firstName: 'Yasmine', lastName: 'Kaci' } });
    expect((await owner.get('/workspace/members').expect(200)).body.data.map((m: any) => m.role)).toEqual(['owner', 'admin', 'operator']);
    expect((await owner.get('/workspace/members?role=admin,operator').expect(200)).body.data).toHaveLength(2);
    expect((await owner.get('/workspace/members?q=yasm').expect(200)).body.data.map((m: any) => m.user.firstName)).toEqual(['Yasmine']);
    expect((await owner.get('/workspace/members?state=invited').expect(200)).body.data).toEqual([]);
    await owner.get('/workspace/members?role=boss').expect(422);
  });

  it('AT-AUTH-10 removing or demoting the Owner is blocked (OWNER_IMMUTABLE); role change rules, permissions, cross-workspace 404', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const other = await asOwner(app);
    const rows = await db.membership.findMany({ where: { workspaceId: owner.workspaceId } });
    const idOf = (userId: string) => rows.find((r) => r.userId === userId)!.id;

    // the Owner is immutable, whoever asks
    expect((await owner.patch(`/workspace/members/${idOf(owner.userId)}`, { role: 'admin' }).expect(422)).body.error.code).toBe('OWNER_IMMUTABLE');
    expect((await owner.delete(`/workspace/members/${idOf(owner.userId)}`).expect(422)).body.error.code).toBe('OWNER_IMMUTABLE');
    // nobody becomes Owner through a role change (only the ownership transfer does that)
    expect((await owner.patch(`/workspace/members/${idOf(admin.userId)}`, { role: 'owner' }).expect(422)).body.error.code).toBe('OWNER_IMMUTABLE');
    expect(await db.membership.count({ where: { workspaceId: owner.workspaceId, role: 'owner' } })).toBe(1);

    // validation + permissions (members.write = Owner)
    expect((await owner.patch(`/workspace/members/${idOf(operator.userId)}`, { role: 'boss' }).expect(422)).body.error.fields).toEqual({ role: 'validation.invalid' });
    for (const actor of [admin, operator]) {
      await actor.patch(`/workspace/members/${idOf(operator.userId)}`, { role: 'admin' }).expect(403);
      await actor.delete(`/workspace/members/${idOf(operator.userId)}`).expect(403);
    }
    // AT-AUTH-11
    await other.patch(`/workspace/members/${idOf(operator.userId)}`, { role: 'admin' }).expect(404);
    await other.delete(`/workspace/members/${idOf(operator.userId)}`).expect(404);
    await owner.patch('/workspace/members/not-a-uuid', { role: 'admin' }).expect(400);

    // promote the operator: effective immediately (tenant cache invalidated)
    await operator.patch('/workspace', { name: 'Avant' }).expect(403);
    const promoted = await owner.patch(`/workspace/members/${idOf(operator.userId)}`, { role: 'admin' }).expect(200);
    expect(promoted.body.data).toMatchObject({ id: idOf(operator.userId), role: 'admin' });
    await operator.patch('/workspace', { name: 'Après' }).expect(200);
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'member.role_change' } }));
    expect(audit).toMatchObject({ actorId: owner.userId, before: { role: 'operator' }, after: { role: 'admin', userId: operator.userId } });
  });

  it('owner decision 2026-10-21 (tester report): the Owner hides sections from a member — every key of them refused at once, menu data in /me, audited; the Owner is immutable', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const rows = await db.membership.findMany({ where: { workspaceId: owner.workspaceId } });
    const idOf = (userId: string) => rows.find((r) => r.userId === userId)!.id;
    await operator.get('/orders').expect(200);
    await operator.get('/clients').expect(200);
    const hidden = await owner.patch(`/workspace/members/${idOf(operator.userId)}`, { hiddenSections: ['orders', 'orders', 'clients'] }).expect(200);
    expect(hidden.body.data).toMatchObject({ role: 'operator', hiddenSections: ['clients', 'orders'] });
    // refused at once (tenant cache dropped), read and write alike; other sections and the account keep working
    expect((await operator.get('/orders').expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.get('/clients').expect(403);
    await operator.get('/products').expect(200);
    await operator.get('/workspace/members').expect(200);
    const me = (await operator.get('/me').expect(200)).body.data;
    expect(me.memberships.find((m: any) => m.workspaceId === owner.workspaceId)).toMatchObject({ hiddenSections: ['clients', 'orders'] });
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'member.sections_change' } }));
    expect(audit).toMatchObject({ actorId: owner.userId, before: { hiddenSections: [] }, after: { hiddenSections: ['clients', 'orders'], userId: operator.userId } });
    // shown again
    await owner.patch(`/workspace/members/${idOf(operator.userId)}`, { hiddenSections: ['clients'] }).expect(200);
    await operator.get('/orders').expect(200);
    // rules: unknown section 422, empty body 422, the Owner immutable, only the Owner writes
    expect((await owner.patch(`/workspace/members/${idOf(operator.userId)}`, { hiddenSections: ['members'] }).expect(422)).body.error.fields).toMatchObject({ 'hiddenSections.0': 'validation.invalid' });
    await owner.patch(`/workspace/members/${idOf(operator.userId)}`, {}).expect(422);
    expect((await owner.patch(`/workspace/members/${idOf(owner.userId)}`, { hiddenSections: ['orders'] }).expect(422)).body.error.code).toBe('OWNER_IMMUTABLE');
    await admin.patch(`/workspace/members/${idOf(operator.userId)}`, { hiddenSections: [] }).expect(403);
    expect((await owner.get('/workspace/members').expect(200)).body.data.find((m: any) => m.id === idOf(operator.userId)).hiddenSections).toEqual(['clients']);
  });

  it('remove a member: membership gone, sessions revoked, access lost, audited', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    await setPassword(app, admin.userId);
    const email = (await db.user.findUniqueOrThrow({ where: { id: admin.userId } })).email;
    const session = await login(app, email).expect(200);
    const membership = await db.membership.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, userId: admin.userId } });

    await owner.delete(`/workspace/members/${membership.id}`).expect(204);
    expect(await db.membership.count({ where: { id: membership.id } })).toBe(0);
    expect((await admin.get('/workspace').expect(404)).body.error.code).toBe('NOT_FOUND');
    await api(app).post('/api/v1/auth/refresh').set('Cookie', `djaber_rt=${refreshCookie(session)}`).send({}).expect(401);
    await owner.delete(`/workspace/members/${membership.id}`).expect(404);
    expect((await owner.get('/workspace/members').expect(200)).body.data).toHaveLength(1);
    // the account itself is intact
    await login(app, email).expect(200);
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'member.remove', entityId: membership.id } }));
    expect(audit).toMatchObject({ actorId: owner.userId, before: { userId: admin.userId, role: 'admin' } });
  });
});
