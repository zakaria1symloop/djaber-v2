// M11 — public site API (03 §36 PUB-02…06, 06 §12, api-contract §3.14): CMS pages with locale fallback / unpublished 404 /
// admin preview / version history, Meta data-deletion status, public account deletion (FL-22 1b, DEL-01/02), the account data
// export (`GET /me/data-export`), published API docs (API-04). AT-PUB-02 / AT-PUB-03 / AT-PUB-04 (API side).
import { randomUUID } from 'node:crypto';
import { createUser, asMember, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { mailsTo, tokenOf } from '../support/m1';
import { forbidNetwork } from '../support/m3';
import { db, pub, withKey, work } from '../support/m11';
import { TokenService } from '../../src/core/auth/token.service';

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

const admin = async () => (await db.user.findFirstOrThrow({ where: { platformRole: 'super_admin' } })).id;
const cmsEntry = async (o: { key: string; type?: 'legal' | 'page' | 'help'; status?: 'published' | 'draft'; locales?: Partial<Record<'fr' | 'ar' | 'en', string>>; versions?: number }) => {
  const by = await admin();
  return db.cmsEntry.create({
    data: {
      key: o.key,
      type: o.type ?? 'legal',
      status: o.status ?? 'published',
      currentVersion: o.versions ?? 1,
      createdById: by,
      locales: { create: Object.entries(o.locales ?? { fr: 'Texte FR' }).map(([locale, body]) => ({ locale: locale as 'fr', title: `Titre ${locale}`, body: body!, status: 'published' as const, updatedById: by })) },
      versions: { create: Array.from({ length: o.versions ?? 1 }, (_, i) => ({ version: i + 1, snapshot: { locales: [{ locale: 'fr', title: 'Titre fr', body: `Version ${i + 1}` }] }, createdById: by })) },
    },
  });
};

describe('CMS pages (PUB-03 / PUB-04)', () => {
  it('AT-PUB-02 ?lang=ar without AR ⇒ FR content + fallback flag; unpublished ⇒ 404; admin signed preview works; version history with the previous body', async () => {
    const key = `cgu-${randomUUID().slice(0, 6)}`;
    const e = await cmsEntry({ key, locales: { fr: 'Version 4 du texte', en: 'Version 4 text' }, versions: 4 });
    const ar = (await pub(app).get(`/api/v1/cms/${key}?lang=ar`).expect(200)).body.data;
    expect(ar).toMatchObject({ key, type: 'legal', locale: 'fr', requestedLocale: 'ar', fallback: true, body: 'Version 4 du texte', version: 4, previousBody: 'Version 3', preview: false });
    expect(ar.versions.map((v: any) => v.version)).toEqual([4, 3, 2, 1]);
    expect((await pub(app).get(`/api/v1/cms/${key}`).set('Accept-Language', 'en').expect(200)).body.data).toMatchObject({ locale: 'en', fallback: false, body: 'Version 4 text' });
    expect((await pub(app).get(`/api/v1/legal/${key}?lang=en`).expect(200)).body.data.locale).toBe('en');

    await db.cmsEntry.update({ where: { id: e.id }, data: { status: 'draft' } });
    expect((await pub(app).get(`/api/v1/cms/${key}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    const token = await app.app.get(TokenService).signPurpose('cms_preview', { entryId: e.id, key }, 24 * 3600);
    expect((await pub(app).get(`/api/v1/cms/preview/${encodeURIComponent(token)}`).expect(200)).body.data).toMatchObject({ key, preview: true });
    expect((await pub(app).get(`/api/v1/cms/${key}?preview=${encodeURIComponent(token)}`).expect(200)).body.data.preview).toBe(true);
    await pub(app).get(`/api/v1/cms/preview/forged-token`).expect(404);
    await pub(app).get(`/api/v1/cms/other-key?preview=${encodeURIComponent(token)}`).expect(404);
    await pub(app).get('/api/v1/cms/unknown-page-xyz').expect(404);
    // a page entry is not a legal document
    const page = `page-${randomUUID().slice(0, 6)}`;
    await cmsEntry({ key: page, type: 'page' });
    await pub(app).get(`/api/v1/legal/${page}`).expect(404);
  });

  it('seeded public pages: landing, features (6 blocks), pricing FAQ (5 questions), cookies, data-deletion, legal docs; list by type', async () => {
    for (const key of ['landing', 'features', 'pricing-faq', 'cookies', 'data-deletion', 'terms', 'privacy', 'account_deletion', 'content_rules']) {
      const d = (await pub(app).get(`/api/v1/cms/${key}?lang=ar`).expect(200)).body.data;
      expect([key, d.locale, d.fallback]).toEqual([key, 'ar', false]);
    }
    const features = (await pub(app).get('/api/v1/cms/features').expect(200)).body.data;
    expect(features.body.match(/^## /gm)).toHaveLength(6);
    expect((await pub(app).get('/api/v1/cms/pricing-faq').expect(200)).body.data.body.match(/^## /gm)).toHaveLength(5);
    const pages = (await pub(app).get('/api/v1/cms?type=page&lang=en').expect(200)).body.data;
    expect(pages.map((p: any) => p.key)).toEqual(expect.arrayContaining(['landing', 'features', 'pricing-faq']));
    expect((await pub(app).get('/api/v1/cms?type=email').expect(200)).body.data).toEqual([]);
  });
});

describe('Meta data-deletion status (PUB-05)', () => {
  it('AT-PUB-03 unknown code ⇒ not_found; pending ⇒ requestedAt; done ⇒ completedAt', async () => {
    const code = `DD${randomUUID().slice(0, 8)}`;
    expect((await pub(app).get(`/api/v1/data-deletion/${code}`).expect(200)).body.data).toEqual({ code, status: 'not_found', requestedAt: null, completedAt: null });
    await db.dataDeletionRequest.create({ data: { confirmationCode: code, externalUserId: `psid-${code}` } });
    expect((await pub(app).get(`/api/v1/data-deletion/${code}`).expect(200)).body.data).toMatchObject({ code, status: 'pending', requestedAt: expect.any(String), completedAt: null });
    await db.dataDeletionRequest.update({ where: { confirmationCode: code }, data: { status: 'done', completedAt: new Date() } });
    expect((await pub(app).get(`/api/v1/data-deletion/${code}`).expect(200)).body.data).toMatchObject({ status: 'done', completedAt: expect.any(String) });
  });
});

describe('public account deletion (PUB-06, FL-22 1b)', () => {
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const ask = (email: string, from: string) => pub(app).post('/api/v1/account-deletion/request').set('X-Forwarded-For', from).send({ email, consent: true });

  it('AT-PUB-04 unknown e-mail ⇒ same answer; 4th request / h / IP ⇒ RATE_LIMITED; known e-mail ⇒ 24 h single-use link; expired link ⇒ ACCOUNT_DELETION_TOKEN_EXPIRED', async () => {
    const from = ip();
    const user = await createUser();
    const unknown = await ask(`nobody-${randomUUID().slice(0, 6)}@test.local`, from).expect(200);
    const known = await ask(user.email, from).expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(known.body.data).toEqual({ sent: true });
    expect((await pub(app).post('/api/v1/account-deletion/request').set('X-Forwarded-For', from).send({ email: user.email }).expect(422)).body.error.fields).toMatchObject({ consent: 'validation.required' });
    expect((await ask(user.email, from).expect(429)).body.error.code).toBe('RATE_LIMITED');

    const mail = (await mailsTo(app, user.email, 'auth/account-deletion-request'))[0];
    const token = tokenOf(mail);
    const state = (await pub(app).get(`/api/v1/account-deletion/confirm/${token}`).expect(200)).body.data;
    expect(state).toMatchObject({ status: 'pending_confirmation', emailMasked: `${user.email[0]}***@test.local`, cancelToken: null, ownedWorkspaces: [] });
    expect(new Date(state.linkExpiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    await db.accountDeletionRequest.updateMany({ where: { userId: user.id }, data: { requestedAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await pub(app).post(`/api/v1/account-deletion/confirm/${token}`).send({}).expect(410)).body.error.code).toBe('ACCOUNT_DELETION_TOKEN_EXPIRED');
    expect((await pub(app).get('/api/v1/account-deletion/confirm/not-a-real-token-at-all-000').expect(410)).body.error.code).toBe('ACCOUNT_DELETION_TOKEN_EXPIRED');
  });

  it('confirm ⇒ grace 30 d, memberships removed, sessions revoked, confirmation e-mail, export job, cancel token (single-use link); cancel ⇒ cancelled + active', async () => {
    const owner = await asOwner(app);
    const member = await asMember(app, owner.workspaceId, 'operator');
    const email = (await db.user.findUniqueOrThrow({ where: { id: member.userId } })).email;
    await ask(email, ip()).expect(200);
    const token = tokenOf((await mailsTo(app, email, 'auth/account-deletion-request'))[0]);
    const done = (await pub(app).post(`/api/v1/account-deletion/confirm/${token}`).send({ exportData: true }).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'grace', cancelToken: expect.any(String), export: { status: 'queued' } });
    expect(new Date(done.scheduledAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(await db.membership.count({ where: { userId: member.userId } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).status).toBe('deletion_scheduled');
    expect(await mailsTo(app, email, 'auth/account-deletion-confirm')).toHaveLength(1);
    // the confirmation link is single use; the cancel token follows the request
    await pub(app).get(`/api/v1/account-deletion/confirm/${token}`).expect(410);
    await work(app, [], { names: ['account-data-export'] });
    const after = (await pub(app).get(`/api/v1/account-deletion/confirm/${done.cancelToken}`).expect(200)).body.data;
    expect(after.export).toMatchObject({ status: 'done', url: expect.stringContaining('.zip?exp=') });
    expect(await db.auditLog.count({ where: { actorId: member.userId, action: 'account.deletion_requested' } })).toBe(1);

    const cancelled = (await pub(app).post(`/api/v1/account-deletion/cancel/${done.cancelToken}`).send({}).expect(200)).body.data;
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelToken: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).status).toBe('active');
    await pub(app).post(`/api/v1/account-deletion/cancel/${done.cancelToken}`).send({}).expect(410);
  });

  it('owner of a live workspace ⇒ ACCOUNT_OWNS_WORKSPACE, request recorded BLOQUÉE with the owned workspace listed; a second request during grace ⇒ no new link', async () => {
    const owner = await asOwner(app);
    const email = (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).email;
    await ask(email, ip()).expect(200);
    const token = tokenOf((await mailsTo(app, email, 'auth/account-deletion-request'))[0]);
    expect((await pub(app).get(`/api/v1/account-deletion/confirm/${token}`).expect(200)).body.data.ownedWorkspaces).toHaveLength(1);
    expect((await pub(app).post(`/api/v1/account-deletion/confirm/${token}`).send({}).expect(422)).body.error.code).toBe('ACCOUNT_OWNS_WORKSPACE');
    expect(await db.accountDeletionRequest.findFirstOrThrow({ where: { userId: owner.userId } })).toMatchObject({ status: 'blocked', blockedReason: 'ACCOUNT_OWNS_WORKSPACE', source: 'public_page' });

    const user = await createUser();
    await ask(user.email, ip()).expect(200);
    const t2 = tokenOf((await mailsTo(app, user.email, 'auth/account-deletion-request'))[0]);
    await pub(app).post(`/api/v1/account-deletion/confirm/${t2}`).send({}).expect(200);
    await ask(user.email, ip()).expect(200);
    expect(await mailsTo(app, user.email, 'auth/account-deletion-request')).toHaveLength(1);
  });
});

describe('account data export (DEL-01, GET /me/data-export)', () => {
  it('202 { jobId } (reused within the hour) ⇒ ZIP link valid 7 days; another user ⇒ 404; API keys refused', async () => {
    const owner = await asOwner(app);
    const { jobId } = (await owner.get('/me/data-export').expect(202)).body.data;
    expect((await owner.get('/me/data-export').expect(202)).body.data.jobId).toBe(jobId);
    expect((await owner.get(`/me/data-export/${jobId}`).expect(200)).body.data).toMatchObject({ jobId, status: 'queued', url: null });
    await work(app, [], { names: ['account-data-export'] });
    const done = (await owner.get(`/me/data-export/${jobId}`).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'done', url: expect.any(String) });
    expect(new Date(done.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.result).toMatchObject({ files: expect.arrayContaining(['account.json', 'memberships.csv']) });
    const other = await asOwner(app);
    await other.get(`/me/data-export/${jobId}`).expect(404);
    const key = (await owner.post('/api-keys', { name: 'ERP', scopes: ['orders:read'] }).expect(201)).body.data.key;
    expect((await withKey(app, key).get('/me/data-export').expect(403)).body.error.code).toBe('API_SCOPE_FORBIDDEN');
  });
});

describe('API docs (API-04)', () => {
  it('/api/docs serves Swagger UI; openapi.json generated from the zod DTOs; Postman collection', async () => {
    const ui = await pub(app).get('/api/docs').expect(200);
    // tester notes 25/10: the CSP allows the whole swagger-ui-dist folder (a path without « / » matched one exact file)
    expect(ui.headers['content-security-policy']).toContain("script-src 'self' https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/ ");
    expect(ui.text).toContain('swagger-ui');
    const doc = (await pub(app).get('/api/docs/openapi.json').expect(200)).body;
    expect(doc.openapi).toBe('3.0.3');
    const create = doc.paths['/api-keys'].post;
    expect(create.requestBody.content['application/json'].schema.properties).toHaveProperty('scopes');
    expect(create.description).toContain('integrations.manage');
    expect(doc.paths['/orders'].post.description).toContain('orders:write');
    expect(doc.paths['/orders'].post.parameters.find((p: any) => p.name === 'Idempotency-Key')).toMatchObject({ required: true });
    expect(doc.paths['/webhooks/{id}/deliveries'].get.parameters.map((p: any) => p.name)).toEqual(expect.arrayContaining(['id', 'status', 'page']));
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/dev'))).toBe(false);
    const postman = (await pub(app).get('/api/docs/postman.json').expect(200)).body;
    expect(postman.info.schema).toContain('v2.1.0');
    expect(postman.item.find((f: any) => f.name === 'orders').item.length).toBeGreaterThan(5);
  });
});
