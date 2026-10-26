// M10 (api-a) — platform roles & 2FA gate (AT-PRL-01, AT-PRL-02), read-only impersonation (AT-IMP-01, AT-IMP-02),
// platform team & invitations (ADM-16).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { authenticator } from 'otplib';
import { rawPrisma as db } from '@djaber/db';
import { CryptoService } from '../../src/core/crypto/crypto.service';
import { PLATFORM_PERMISSIONS } from '../../src/core/rbac/permission-matrix';
import { asAdmin, asOwner, asPlatform, createUser } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const ROLES = ['super_admin', 'support', 'moderator', 'finance', 'read'] as const;
const REASON = 'Ticket #4821 : vérifier la synchro';
const audit = (action: string, entityId?: string) => db.auditLog.findFirst({ where: { action, ...(entityId ? { entityId } : {}) }, orderBy: { at: 'desc' } });

/**
 * One probe per platform key: a request that the guard lets through (200/201/202/204, 404, 409, 422 from the service) for an
 * allowed role and refuses with 403 FORBIDDEN otherwise. Probes target non-existing ids where a write would change data.
 */
const PROBES: Record<string, (ws: string) => { method: 'get' | 'post' | 'patch' | 'put' | 'delete'; url: string; body?: object }> = {
  'admin.overview.read': () => ({ method: 'get', url: '/admin/analytics?period=7d' }),
  'admin.workspaces.read': () => ({ method: 'get', url: '/admin/workspaces' }),
  'admin.users.read': () => ({ method: 'get', url: '/admin/users' }),
  'admin.billing.read': () => ({ method: 'get', url: '/admin/plans' }),
  'admin.ai.read': () => ({ method: 'get', url: '/admin/ai-routes' }),
  'admin.presets.read': () => ({ method: 'get', url: '/admin/agent-presets' }),
  'admin.cms.read': () => ({ method: 'get', url: '/admin/cms' }),
  'admin.audit.read': () => ({ method: 'get', url: '/admin/audit-logs' }),
  'admin.team.read': () => ({ method: 'get', url: '/admin/platform-members' }),
  'admin.deletion.read': () => ({ method: 'get', url: '/admin/deletion-requests' }),
  'admin.workspaces.write': () => ({ method: 'post', url: `/admin/workspaces/${randomUUID()}/reactivate`, body: { reason: REASON } }),
  'admin.workspaces.credits': () => ({ method: 'post', url: `/admin/workspaces/${randomUUID()}/credits`, body: { credits: 10, reason: REASON } }),
  'admin.workspaces.impersonate': () => ({ method: 'get', url: '/admin/impersonation/sessions' }),
  'admin.workspaces.unmask': () => ({ method: 'post', url: `/admin/conversations/${randomUUID()}/unmask`, body: { reason: REASON } }),
  'admin.users.write': () => ({ method: 'post', url: `/admin/users/${randomUUID()}/unblock`, body: { reason: REASON } }),
  'admin.billing.write': () => ({ method: 'patch', url: `/admin/promo-codes/${randomUUID()}`, body: { notes: 'x' } }),
  'admin.ai.write': () => ({ method: 'patch', url: `/admin/ai-models/${randomUUID()}`, body: { displayName: 'x' } }),
  'admin.presets.write': () => ({ method: 'patch', url: `/admin/agent-presets/${randomUUID()}`, body: { sortOrder: 1 } }),
  'admin.cms.write': () => ({ method: 'patch', url: `/admin/cms/${randomUUID()}`, body: { sortOrder: 1 } }),
  'admin.audit.export': () => ({ method: 'post', url: '/admin/audit-logs/export', body: { format: 'json', from: '2026-10-02', to: '2026-10-01' } }),
  'admin.team.write': () => ({ method: 'delete', url: `/admin/platform-members/invitations/${randomUUID()}` }),
  'admin.deletion.write': () => ({ method: 'post', url: `/admin/deletion-requests/${randomUUID()}/cancel`, body: { reason: REASON } }),
};

describe('platform roles (PRL-01, AT-PRL-01)', () => {
  it('AT-PRL-01 capability matrix: every role × every probed key ⇒ allowed (not 403) or 403 FORBIDDEN exactly per 01 §3.2', async () => {
    const actors = Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await asPlatform(app, r)] as const)));
    const mismatches: string[] = [];
    for (const [key, probe] of Object.entries(PROBES)) {
      for (const role of ROLES) {
        const p = probe('');
        const call = actors[role]![p.method](p.url, p.body);
        const res = await call;
        const allowed = (PLATFORM_PERMISSIONS[key as keyof typeof PLATFORM_PERMISSIONS] as readonly string[]).includes(role);
        const forbidden = res.status === 403 && res.body.error?.code === 'FORBIDDEN';
        if (allowed === forbidden) mismatches.push(`${role} ${key} ${p.method} ${p.url} → ${res.status} ${res.body.error?.code ?? ''}`);
      }
    }
    expect(mismatches).toEqual([]);
    // impersonation = super_admin + support only
    expect(PLATFORM_PERMISSIONS['admin.workspaces.impersonate']).toEqual(['super_admin', 'support']);
  });

  it('merchant users (Owner / Admin) get 403 FORBIDDEN on admin routes; anonymous 401', async () => {
    const owner = await asOwner(app);
    expect((await owner.get('/admin/workspaces').expect(403)).body.error.code).toBe('FORBIDDEN');
    const admin = await asAdmin(app, owner.workspaceId);
    expect((await admin.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { reason: 'fraud', note: REASON, notifyOwner: false }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await request(app.http()).get('/api/v1/admin/workspaces').expect(401);
    // platform users without membership ⇒ 404 on merchant routes (D21)
    const sa = await asPlatform(app);
    await sa.get('/products').set('X-Workspace-Id', owner.workspaceId).expect(404);
  });
});

describe('platform team & 2FA (PRL-02, AT-PRL-02)', () => {
  it('AT-PRL-02 invite @gmail ⇒ ADMIN_EMAIL_DOMAIN_INVALID; member without 2FA ⇒ TWO_FA_REQUIRED_FOR_ROLE everywhere; role change without code ⇒ TWO_FA_CONFIRMATION_REQUIRED; self ⇒ ADMIN_CANNOT_DEMOTE_SELF', async () => {
    const sa = await asPlatform(app);
    expect((await sa.post('/admin/platform-members/invitations', { email: 'x@gmail.com', platformRole: 'support' }).expect(422)).body.error.code).toBe('ADMIN_EMAIL_DOMAIN_INVALID');
    await sa.post('/admin/platform-members/invitations', { email: 'nope', platformRole: 'support' }).expect(422);
    const email = `new-${randomUUID().slice(0, 6)}@djaber.ai`;
    const inv = (await sa.post('/admin/platform-members/invitations', { email, platformRole: 'support' }).expect(201)).body.data;
    expect(inv).toMatchObject({ email, platformRole: 'support', acceptedAt: null });
    expect(await audit('platform_member.invite', inv.id)).toBeTruthy();
    const invited = await db.user.findUniqueOrThrow({ where: { email } });
    expect(invited.platformRole).toBe('support');
    // duplicate invite of a member ⇒ 409
    expect((await sa.post('/admin/platform-members/invitations', { email, platformRole: 'read' }).expect(409)).body.error.code).toBe('CONFLICT');
    // the team lists the member with 2FA off ⇒ access blocked
    const team = (await sa.get('/admin/platform-members').expect(200)).body.data;
    expect(team.members.find((m: any) => m.email === email)).toMatchObject({ totpEnabled: false, accessBlocked: true });
    expect(team.invitations.find((i: any) => i.email === email)).toBeTruthy();

    // a platform member without 2FA ⇒ every admin route TWO_FA_REQUIRED_FOR_ROLE (reads and writes)
    const no2fa = await asPlatform(app, 'support', { totpEnabled: false });
    for (const url of ['/admin/workspaces', '/admin/analytics', '/admin/impersonation/sessions']) {
      expect((await no2fa.get(url).expect(403)).body.error.code).toBe('TWO_FA_REQUIRED_FOR_ROLE');
    }

    // role change needs the actor's TOTP code
    const secret = authenticator.generateSecret();
    const crypto = app.app.get(CryptoService);
    const actorUser = await createUser({ platformRole: 'super_admin', totpEnabled: true, email: `sa-${randomUUID().slice(0, 6)}@djaber.ai` });
    await db.user.update({ where: { id: actorUser.id }, data: { totpSecret: new Uint8Array(Buffer.from(crypto.encrypt(secret), 'utf8')) } });
    const { TokenService } = await import('../../src/core/auth/token.service');
    const { token } = await app.app.get(TokenService).signAccess({ sub: actorUser.id, pr: 'super_admin' });
    const as = (m: 'post', url: string, body: object) => request(app.http())[m](`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body);
    expect((await as('post', `/admin/users/${invited.id}/platform-role`, { platformRole: 'moderator' }).expect(403)).body.error.code).toBe('TWO_FA_CONFIRMATION_REQUIRED');
    expect((await as('post', `/admin/users/${invited.id}/platform-role`, { platformRole: 'moderator', totpCode: '000000' }).expect(403)).body.error.code).toBe('TWO_FA_CONFIRMATION_REQUIRED');
    const ok = await as('post', `/admin/users/${invited.id}/platform-role`, { platformRole: 'moderator', totpCode: authenticator.generate(secret) }).expect(200);
    expect(ok.body.data.platformRole).toBe('moderator');
    const row = await audit('user.platform_role_change', invited.id);
    expect(row).toMatchObject({ actorType: 'admin', actorId: actorUser.id });
    expect(row!.before).toEqual({ platformRole: 'support' });
    // self ⇒ ADMIN_CANNOT_DEMOTE_SELF
    expect((await as('post', `/admin/users/${actorUser.id}/platform-role`, { platformRole: 'read', totpCode: authenticator.generate(secret) }).expect(422)).body.error.code).toBe('ADMIN_CANNOT_DEMOTE_SELF');
    // a non-@djaber.ai account cannot receive a role
    const merchant = await createUser();
    expect((await as('post', `/admin/users/${merchant.id}/platform-role`, { platformRole: 'read', totpCode: authenticator.generate(secret) }).expect(422)).body.error.code).toBe('ADMIN_EMAIL_DOMAIN_INVALID');
    // support cannot manage roles
    const support = await asPlatform(app, 'support');
    expect((await support.post(`/admin/users/${invited.id}/platform-role`, { platformRole: 'read', totpCode: '123456' }).expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('force-2fa resets the member 2FA (access blocked) and revoking an invitation removes the role; 404 on unknown ids', async () => {
    const sa = await asPlatform(app);
    const fin = await asPlatform(app, 'finance');
    const team = (await sa.post(`/admin/platform-members/${fin.userId}/force-2fa`, {}).expect(200)).body.data;
    expect(team.members.find((m: any) => m.userId === fin.userId)).toMatchObject({ totpEnabled: false, accessBlocked: true });
    expect((await fin.get('/admin/workspaces').expect(403)).body.error.code).toBe('TWO_FA_REQUIRED_FOR_ROLE');
    expect(await audit('platform_member.force_2fa', fin.userId)).toBeTruthy();
    await sa.post(`/admin/platform-members/${randomUUID()}/force-2fa`, {}).expect(404);
    const email = `rev-${randomUUID().slice(0, 6)}@djaber.ai`;
    const inv = (await sa.post('/admin/platform-members/invitations', { email, platformRole: 'read' }).expect(201)).body.data;
    await sa.delete(`/admin/platform-members/invitations/${inv.id}`).expect(204);
    expect((await db.user.findUniqueOrThrow({ where: { email } })).platformRole).toBe('none');
    await sa.delete(`/admin/platform-members/invitations/${inv.id}`).expect(404);
  });
});

describe('read-only impersonation (D21-bis, AT-IMP-01, AT-IMP-02)', () => {
  it('tester report 22/10 UX-023: the session and its token last the « impersonationMinutes » of the platform settings', async () => {
    const owner = await asOwner(app);
    const sa = await asPlatform(app);
    const before = await db.platformSetting.findUnique({ where: { key: 'limits' } });
    try {
      const value = { apiRatePerMin: 600, webhookRetries: 6, trialDays: 14, trialCredits: 300, deletionGraceDays: 30, impersonationMinutes: 5, maxDevices: 20 };
      await sa.put('/admin/settings/limits', { value, reason: REASON }).expect(200);
      const started = (await sa.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: REASON }).expect(201)).body.data;
      const session = await db.impersonationSession.findUniqueOrThrow({ where: { id: started.sessionId } });
      expect(session.expiresAt.getTime() - session.startedAt.getTime()).toBe(5 * 60_000);
      const payload = JSON.parse(Buffer.from(String(started.token).split('.')[1]!, 'base64url').toString('utf8'));
      expect(payload.exp - payload.iat).toBe(5 * 60);
    } finally {
      if (before) await db.platformSetting.update({ where: { key: 'limits' }, data: { value: before.value as object } });
      else await db.platformSetting.deleteMany({ where: { key: 'limits' } });
    }
  });

  it('AT-IMP-01 reason rules, roles, session token, GET audited + counted, expiry ⇒ 401, stop ⇒ endedAt + impersonation.stop, no e-mail', async () => {
    const owner = await asOwner(app);
    const sa = await asPlatform(app);
    expect((await sa.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await sa.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: '123456789' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    for (const r of ['moderator', 'finance', 'read']) {
      expect((await (await asPlatform(app, r)).post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: REASON }).expect(403)).body.error.code).toBe('FORBIDDEN');
    }
    // read-only only: a `mode` field is rejected by the DTO whitelist
    expect((await sa.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: REASON, mode: 'write' }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await sa.post('/admin/impersonation/sessions', { workspaceId: randomUUID(), reason: REASON }).expect(404);

    const support = await asPlatform(app, 'support');
    const started = (await support.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: REASON }).expect(201)).body.data;
    expect(started.workspace.id).toBe(owner.workspaceId);
    const session = await db.impersonationSession.findUniqueOrThrow({ where: { id: started.sessionId } });
    expect(session.expiresAt.getTime() - session.startedAt.getTime()).toBe(30 * 60_000);
    expect(new Date(started.expiresAt).getTime()).toBe(session.expiresAt.getTime());
    expect(Object.keys(session)).not.toContain('mode');
    expect(await audit('impersonation.start', session.id)).toMatchObject({ reason: REASON, impersonationSessionId: session.id, workspaceId: owner.workspaceId });

    const imp = (m: 'get' | 'post' | 'patch' | 'delete' | 'put', url: string, body?: object) => {
      const r = request(app.http())[m](`/api/v1${url}`).set('Authorization', `Bearer ${started.token}`).set('X-Impersonation-Session', started.sessionId);
      return body ? r.send(body) : r;
    };
    const products = await imp('get', '/products').expect(200);
    expect(Array.isArray(products.body.data)).toBe(true);
    await imp('get', '/workspace').expect(200);
    expect((await db.impersonationSession.findUniqueOrThrow({ where: { id: session.id } })).actionsCount).toBe(2);
    const actions = await db.auditLog.findMany({ where: { action: 'impersonation.action', impersonationSessionId: session.id } });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ actorType: 'admin', actorId: support.userId, workspaceId: owner.workspaceId });

    // listed (super_admin sees every session; filters)
    const list = (await sa.get(`/admin/impersonation/sessions?workspaceId=${owner.workspaceId}&active=true`).expect(200)).body;
    expect(list.data.map((s: any) => s.id)).toContain(session.id);
    expect(list.data.find((s: any) => s.id === session.id)).toMatchObject({ active: true, actionsCount: 2, reason: REASON });

    // expiry ⇒ 401 ADMIN_IMPERSONATION_EXPIRED
    await db.impersonationSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await imp('get', '/products').expect(401)).body.error.code).toBe('ADMIN_IMPERSONATION_EXPIRED');
    await db.impersonationSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + 10 * 60_000) } });

    // stop ⇒ endedAt, audit with duration; further requests ⇒ expired
    const stopped = (await support.delete(`/admin/impersonation/sessions/${session.id}`).expect(200)).body.data;
    expect(stopped.endedAt).not.toBeNull();
    expect((await audit('impersonation.stop', session.id))!.after).toMatchObject({ actionsCount: 2 });
    expect((await imp('get', '/products').expect(401)).body.error.code).toBe('ADMIN_IMPERSONATION_EXPIRED');
    // another admin's session ⇒ 404 for support
    await (await asPlatform(app, 'support')).delete(`/admin/impersonation/sessions/${session.id}`).expect(404);
    // no e-mail to the Owner
    expect(await db.outbox.count({ where: { topic: 'mail', key: { contains: session.id } } })).toBe(0);
  });

  it('AT-IMP-02 every non-GET merchant route under the session ⇒ 403 ADMIN_IMPERSONATION_FORBIDDEN_ACTION, nothing changed, action audited', async () => {
    const owner = await asOwner(app);
    const sa = await asPlatform(app);
    const started = (await sa.post('/admin/impersonation/sessions', { workspaceId: owner.workspaceId, reason: REASON }).expect(201)).body.data;
    const imp = (m: 'post' | 'patch' | 'put' | 'delete', url: string, body: object = {}) =>
      request(app.http())[m](`/api/v1${url}`).set('Authorization', `Bearer ${started.token}`).set('X-Impersonation-Session', started.sessionId).set('Idempotency-Key', randomUUID()).send(body);
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    const routes: [('post' | 'patch' | 'put' | 'delete'), string, object][] = [
      ['post', '/products', { name: 'X', sku: 'X-1', price: 100 }],
      ['patch', `/products/${randomUUID()}`, { price: 1, version: 1 }],
      ['post', `/orders/${randomUUID()}/status`, { to: 'confirmed' }],
      ['post', `/conversations/${randomUUID()}/messages`, { text: 'hi' }],
      ['post', '/billing/checkout', { planId: randomUUID(), cycle: 'monthly' }],
      ['delete', '/workspace', { password: 'x', confirmName: ws.name }],
      ['patch', `/workspace/members/${randomUUID()}`, { role: 'admin' }],
      ['post', '/stock/adjustments', { productId: randomUUID(), delta: 1, reason: 'correction' }],
      ['post', `/workspaces/${owner.workspaceId}/transfer-ownership`, { newOwnerUserId: randomUUID(), password: 'x' }],
      ['patch', '/workspace', { name: 'Hacked', version: ws.version }],
      ['put', '/workspace/system-messages', {}],
    ];
    for (const [m, url, body] of routes) {
      const res = await imp(m, url, body);
      expect([url, res.status, res.body.error?.code]).toEqual([url, 403, 'ADMIN_IMPERSONATION_FORBIDDEN_ACTION']);
    }
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).name).toBe(ws.name);
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    const audited = await db.auditLog.findMany({ where: { action: 'impersonation.action', impersonationSessionId: started.sessionId } });
    expect(audited).toHaveLength(routes.length);
    expect(audited.every((a) => (a.after as { allowed: boolean }).allowed === false)).toBe(true);
    // the same token without the header is still treated as the impersonation session
    const res = await request(app.http()).patch('/api/v1/workspace').set('Authorization', `Bearer ${started.token}`).send({ name: 'Hacked', version: ws.version });
    expect(res.body.error.code).toBe('ADMIN_IMPERSONATION_FORBIDDEN_ACTION');
  });
});
