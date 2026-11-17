// M1 — settings: quick replies, system messages (AT-SET-01), legal re-acceptance, cross-workspace harness (AT-AUTH-11),
// mail pipeline (outbox → queue `outbox` job `email-send` → mailbox).
import { DEFAULT_SYSTEM_MESSAGES } from '@djaber/db';
import { AuditService } from '../../src/core/audit/audit.service';
import { MailOutbox } from '../../src/core/mail/mail.outbox';
import { MailService } from '../../src/core/mail/mail.service';
import { renderMail } from '../../src/core/mail/templates';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { QueueService } from '../../src/core/queue/queue.service';
import { WsEmitter } from '../../src/core/ws/ws.emitter';
import { LegalService } from '../../src/modules/workspace/legal.service';
import { OutboxRelay } from '../../src/worker/outbox.relay';
import { anonymous, asAdmin, asLoneUser, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { api, db, eventually, mailsTo, register, uniqEmail } from '../support/m1';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('quick replies', () => {
  it('AT-SET-01 quick replies: 4 defaults, create, update, reorder (PATCH order { ids[] }), delete, audit', async () => {
    const owner = await register(app);
    const defaults = await owner.get('/workspace/quick-replies').expect(200);
    expect(defaults.body.data).toHaveLength(4);
    expect(defaults.body.data.map((r: any) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(defaults.body.data[0]).toMatchObject({ title: 'Salutation', shortcut: '/bonjour', locale: 'fr' });

    // journey J09-12: an unknown variable is refused (it would reach the customer raw)
    expect((await owner.post('/workspace/quick-replies', { title: 'Relance', body: 'Bonjour {prénom} {inconnu} {PRODUCT}' }).expect(422)).body.error.fields).toMatchObject({ body: 'validation.unknownVariable' });
    const created = await owner.post('/workspace/quick-replies', { title: 'Livraison Sétif', body: 'Bonjour {prénom}, livraison 500 DA', shortcut: '/livr' }).expect(201);
    expect(created.body.data).toMatchObject({ title: 'Livraison Sétif', shortcut: '/livr', sortOrder: 4, locale: 'fr', createdAt: expect.any(String) });
    expect(created.body.data.workspaceId).toBeUndefined();
    const id = created.body.data.id;

    expect((await owner.patch(`/workspace/quick-replies/${id}`, { shortcut: '' }).expect(200)).body.data.shortcut).toBeNull(); // empty input = no shortcut
    await owner.patch(`/workspace/quick-replies/${id}`, { shortcut: '/livr' }).expect(200);
    // full-test 15/11 SETTINGS-11: a shortcut is unique in the workspace (case-insensitive), inline under « Raccourci »
    const dup = await owner.post('/workspace/quick-replies', { title: 'Autre réponse', body: 'Texte', shortcut: '/livr' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'QUICK_REPLY_SHORTCUT_TAKEN', fields: { shortcut: 'validation.invalid' } });
    const updated = await owner.patch(`/workspace/quick-replies/${id}`, { body: 'Nouveau texte', shortcut: null }).expect(200);
    expect(updated.body.data).toMatchObject({ title: 'Livraison Sétif', body: 'Nouveau texte', shortcut: null });

    const list = await owner.get('/workspace/quick-replies').expect(200);
    expect(list.body.data).toHaveLength(5);
    const ids = list.body.data.map((r: any) => r.id).reverse();
    const reordered = await owner.patch('/workspace/quick-replies/order', { ids }).expect(200);
    expect(reordered.body.data.map((r: any) => r.id)).toEqual(ids);
    expect(reordered.body.data.map((r: any) => r.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect((await owner.get('/workspace/quick-replies').expect(200)).body.data.map((r: any) => r.id)).toEqual(ids);

    // the order must be the full list of the workspace's ids
    for (const bad of [ids.slice(1), [...ids.slice(1), ids[1]], [...ids, '018f0000-0000-7000-8000-000000000000'], []]) {
      const res = await owner.patch('/workspace/quick-replies/order', { ids: bad }).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields).toHaveProperty('ids');
    }

    await owner.delete(`/workspace/quick-replies/${id}`).expect(204);
    await owner.delete(`/workspace/quick-replies/${id}`).expect(404);
    expect((await owner.get('/workspace/quick-replies').expect(200)).body.data).toHaveLength(4);
    const audits = await eventually(async () => {
      const rows = await db.auditLog.findMany({ where: { workspaceId: owner.workspaceId, entity: 'QuickReply' } });
      return rows.length >= 5 ? rows : null;
    });
    expect(audits!.map((a) => a.action).sort()).toEqual(['quick_reply.create', 'quick_reply.delete', 'quick_reply.update', 'quick_reply.update', 'quick_reply.update']);
  });

  it('duplicate title ⇒ 409 QUICK_REPLY_TITLE_TAKEN (per locale); validation ⇒ 422 with fields', async () => {
    const owner = await asOwner(app);
    await owner.post('/workspace/quick-replies', { title: 'Horaires', body: 'x' }).expect(201);
    const dup = await owner.post('/workspace/quick-replies', { title: 'horaires', body: 'y' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'QUICK_REPLY_TITLE_TAKEN', fields: { title: 'validation.invalid' } });
    // the same title in another locale is allowed (unique per workspace + locale)
    const ar = await owner.post('/workspace/quick-replies', { title: 'Horaires', body: 'ي', locale: 'ar' }).expect(201);
    expect((await owner.patch(`/workspace/quick-replies/${ar.body.data.id}`, { locale: 'fr' }).expect(409)).body.error.code).toBe('QUICK_REPLY_TITLE_TAKEN');
    const other = await owner.post('/workspace/quick-replies', { title: 'Autre', body: 'x' }).expect(201);
    await owner.patch(`/workspace/quick-replies/${other.body.data.id}`, { title: 'Horaires' }).expect(409);
    await owner.patch(`/workspace/quick-replies/${other.body.data.id}`, { title: 'Autre' }).expect(200); // its own title

    const long = await owner.post('/workspace/quick-replies', { title: 'T', body: 'a'.repeat(1001) }).expect(422);
    expect(long.body.error.fields).toEqual({ body: 'validation.length' });
    const bad = await owner.post('/workspace/quick-replies', { title: '', body: '', shortcut: 'no-slash' }).expect(422);
    expect(bad.body.error.fields).toMatchObject({ title: 'validation.required', body: 'validation.required', shortcut: 'validation.invalid' });
    await owner.post('/workspace/quick-replies', { title: 'a'.repeat(81), body: 'x' }).expect(422);
    await owner.post('/workspace/quick-replies', { title: 'X', body: 'y', workspaceId: owner.workspaceId }).expect(422);
    await owner.patch('/workspace/quick-replies/not-a-uuid', { body: 'x' }).expect(404);
  });

  it('permissions: operator reads but cannot write; admin can write', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const row = await admin.post('/workspace/quick-replies', { title: 'Par admin', body: 'y' }).expect(201);
    await operator.get('/workspace/quick-replies').expect(200);
    for (const res of [
      await operator.post('/workspace/quick-replies', { title: 'X', body: 'y' }),
      await operator.patch(`/workspace/quick-replies/${row.body.data.id}`, { body: 'z' }),
      await operator.delete(`/workspace/quick-replies/${row.body.data.id}`),
      await operator.patch('/workspace/quick-replies/order', { ids: [row.body.data.id] }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    await anonymous(app).get('/workspace/quick-replies').expect(401);
  });

  it('AT-AUTH-11 ids of another workspace ⇒ 404 on PATCH / DELETE / reorder, and lists never mix workspaces', async () => {
    const owner = await asOwner(app);
    const other = await asOwner(app);
    const foreign = await other.post('/workspace/quick-replies', { title: 'Z', body: 'z' }).expect(201);
    const mine = await owner.post('/workspace/quick-replies', { title: 'A', body: 'a' }).expect(201);
    expect((await owner.patch(`/workspace/quick-replies/${foreign.body.data.id}`, { body: 'hack' }).expect(404)).body.error.code).toBe('NOT_FOUND');
    await owner.delete(`/workspace/quick-replies/${foreign.body.data.id}`).expect(404);
    await owner.patch('/workspace/quick-replies/order', { ids: [foreign.body.data.id] }).expect(422);
    expect((await owner.get('/workspace/quick-replies').expect(200)).body.data.map((r: any) => r.id)).toEqual([mine.body.data.id]);
    expect((await db.quickReply.findUniqueOrThrow({ where: { id: foreign.body.data.id } })).body).toBe('z');
  });
});

describe('system messages', () => {
  it('AT-SET-01 the 4 system messages are edited per locale via PUT; reset restores the 3 default locales of one key; handoff reminder 0 is stored', async () => {
    const owner = await register(app);
    const initial = await owner.get('/workspace/system-messages').expect(200);
    expect(initial.body.data).toEqual(DEFAULT_SYSTEM_MESSAGES);

    const put = await owner
      .put('/workspace/system-messages', { handoff: { fr: 'Un conseiller arrive.' }, welcome: { fr: '', ar: 'أهلًا بك في {shop}' }, out_of_stock: { en: 'Sorry, no more {product}.' } })
      .expect(200);
    expect(put.body.data.handoff).toEqual({ ...DEFAULT_SYSTEM_MESSAGES.handoff, fr: 'Un conseiller arrive.' });
    expect(put.body.data.welcome).toEqual({ fr: '', ar: 'أهلًا بك في {shop}', en: DEFAULT_SYSTEM_MESSAGES.welcome.en }); // empty welcome = not sent
    expect(put.body.data.out_of_stock.en).toBe('Sorry, no more {product}.');
    expect(put.body.data.out_of_hours).toEqual(DEFAULT_SYSTEM_MESSAGES.out_of_hours);
    // always exactly 4 keys × 3 locales, also in GET /workspace
    const ws = await owner.get('/workspace').expect(200);
    expect(ws.body.data.systemMessages).toEqual(put.body.data);
    // the full object can be sent back as-is
    expect((await owner.put('/workspace/system-messages', put.body.data).expect(200)).body.data).toEqual(put.body.data);
    // an empty text on another key falls back to its default
    expect((await owner.put('/workspace/system-messages', { handoff: { ar: '' } }).expect(200)).body.data.handoff.ar).toBe(DEFAULT_SYSTEM_MESSAGES.handoff.ar);

    // reset one key: its 3 locales return to the defaults, the other keys are untouched
    const reset = await owner.post('/workspace/system-messages/reset', { key: 'welcome' }).expect(200);
    expect(reset.body.data.welcome).toEqual(DEFAULT_SYSTEM_MESSAGES.welcome);
    expect(reset.body.data.handoff.fr).toBe('Un conseiller arrive.');
    expect((await owner.get('/workspace/system-messages').expect(200)).body.data).toEqual(reset.body.data);

    // validation
    expect((await owner.put('/workspace/system-messages', { handoff: { fr: 'a'.repeat(1001) } }).expect(422)).body.error.fields).toEqual({ 'handoff.fr': 'validation.length' });
    await owner.put('/workspace/system-messages', { unavailable: { fr: 'x' } }).expect(422);
    await owner.put('/workspace/system-messages', { handoff: { de: 'x' } }).expect(422);
    await owner.post('/workspace/system-messages/reset', { key: 'unavailable' }).expect(422);

    // handoff reminder: 0 disables the Owner reminder (read by `sched-handoff-unattended`, M3)
    expect((await owner.patch('/workspace', { handoffReminderMin: 0 }).expect(200)).body.data.handoffReminderMin).toBe(0);
  });

  it('permissions and tenancy: admin edits, operator only reads; each workspace keeps its own texts', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const other = await asOwner(app);
    await admin.put('/workspace/system-messages', { handoff: { fr: 'Texte A' } }).expect(200);
    expect((await operator.get('/workspace/system-messages').expect(200)).body.data.handoff.fr).toBe('Texte A');
    expect((await operator.put('/workspace/system-messages', { handoff: { fr: 'Hack' } }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.post('/workspace/system-messages/reset', { key: 'handoff' }).expect(403);
    expect((await other.get('/workspace/system-messages').expect(200)).body.data.handoff.fr).toBe(DEFAULT_SYSTEM_MESSAGES.handoff.fr);
    await anonymous(app).get('/workspace/system-messages').expect(401);
  });
});

describe('legal documents', () => {
  it('seed: the 4 legal documents exist (version 1, published in fr / ar / en) and nothing is pending', async () => {
    const docs = await db.legalDocument.findMany({ include: { cmsEntry: { include: { locales: true } } }, orderBy: { key: 'asc' } });
    expect(docs.map((d) => d.key).sort()).toEqual(['account_deletion', 'content_rules', 'privacy', 'terms']);
    for (const d of docs) {
      expect(d).toMatchObject({ version: 1, requiresReacceptance: false });
      expect(d.cmsEntry).toMatchObject({ type: 'legal', status: 'published', key: d.key });
      expect(d.cmsEntry.locales.map((l) => l.locale).sort()).toEqual(['ar', 'en', 'fr']);
    }
    const user = await asLoneUser(app);
    expect((await user.get('/legal/pending').expect(200)).body.data).toEqual([]);
    await anonymous(app).get('/legal/pending').expect(401);
  });

  it('a major version requires re-acceptance: 403 LEGAL_REACCEPT_REQUIRED until POST /legal/accept { key, version } → 204', async () => {
    const legal = app.app.get(LegalService);
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const v1 = await db.legalDocument.findMany({ where: { key: { in: ['terms', 'content_rules', 'account_deletion'] } } });
    const created = [];
    try {
      for (const d of v1) {
        created.push(await db.legalDocument.create({ data: { key: d.key, version: 2, isMajor: true, requiresReacceptance: true, cmsEntryId: d.cmsEntryId, publishedById: d.publishedById } }));
      }
      await legal.invalidate();

      // terms for everyone, content_rules for owners and admins only, account_deletion never prompts
      const pendingOwner = await owner.get('/legal/pending').expect(200);
      expect(pendingOwner.body.data.map((p: any) => p.key).sort()).toEqual(['content_rules', 'terms']);
      expect(pendingOwner.body.data[0]).toMatchObject({ version: 2, url: expect.stringMatching(/\/legal\/(terms|content_rules)$/) });
      expect((await operator.get('/legal/pending').expect(200)).body.data.map((p: any) => p.key)).toEqual(['terms']);

      // every protected call is refused, auth / legal / GET /me stay reachable
      const blocked = await owner.get('/workspace').expect(403);
      expect(blocked.body.error.code).toBe('LEGAL_REACCEPT_REQUIRED');
      expect(blocked.body.error.params.version).toBe(2);
      expect(['terms', 'content_rules']).toContain(blocked.body.error.params.document);
      await owner.post('/workspace/quick-replies', { title: 'X', body: 'y' }).expect(403);
      expect((await owner.get('/me').expect(200)).body.data.pendingLegal).toHaveLength(2);
      await owner.get('/me/sessions').expect(403);

      // validation and unknown version
      await owner.post('/legal/accept', { key: 'cookies', version: 2 }).expect(422);
      await owner.post('/legal/accept', { key: 'terms' }).expect(422);
      await owner.post('/legal/accept', { key: 'terms', version: 9 }).expect(404);

      const accepted = await owner.post('/legal/accept', { key: 'terms', version: 2 }).expect(204);
      expect(accepted.text).toBe('');
      expect((await owner.get('/workspace').expect(403)).body.error.params.document).toBe('content_rules'); // one left
      await owner.post('/legal/accept', { key: 'content_rules', version: 2 }).expect(204);
      await owner.post('/legal/accept', { key: 'content_rules', version: 2 }).expect(204); // idempotent
      await owner.get('/workspace').expect(200);
      expect((await owner.get('/legal/pending').expect(200)).body.data).toEqual([]);
      const row = await db.legalAcceptance.findFirstOrThrow({ where: { userId: owner.userId, version: 2, document: { key: 'terms' } } });
      expect(row).toMatchObject({ client: 'web' });
      expect(row.ip).toBeTruthy();

      // the operator only owes the terms; a mobile client is recorded as such
      await operator.get('/workspace').expect(403);
      await api(app).post('/api/v1/legal/accept').set(operator.headers).set('X-App-Platform', 'android').send({ key: 'terms', version: 2 }).expect(204);
      await operator.get('/workspace').expect(200);
      expect((await db.legalAcceptance.findFirstOrThrow({ where: { userId: operator.userId, version: 2 } })).client).toBe('android');

      // a new sign-up accepts the documents in force (version 2) and is not prompted
      const fresh = await register(app);
      expect(fresh.res.body.data.user.pendingLegal).toEqual([]);
      await fresh.get('/workspace').expect(200);
    } finally {
      await db.legalAcceptance.deleteMany({ where: { legalDocumentId: { in: created.map((c) => c.id) } } });
      await db.legalDocument.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
      await legal.invalidate();
    }
    await owner.get('/workspace').expect(200);
  });
});

describe('e-mail pipeline', () => {
  it('mail outbox row → relay → queue `outbox` job `email-send` (deterministic id) → handler → mailbox; no token at rest', async () => {
    const registry = app.app.get(ProcessorRegistry);
    const outbox = app.app.get(MailOutbox);
    const to = uniqEmail('pipeline');
    const key = `test-mail:${to}`;
    await outbox.send({ to, template: 'auth/reset', locale: 'en', secret: { url: 'https://app.test/reset-password?token=SECRET-TOKEN-VALUE' }, key });
    await outbox.send({ to, template: 'auth/reset', locale: 'en', secret: { url: 'https://app.test/reset-password?token=OTHER' }, key }); // same key ⇒ one row
    expect(await db.outbox.count({ where: { topic: 'mail', key } })).toBe(1);
    const row = await db.outbox.findFirstOrThrow({ where: { topic: 'mail', key } });
    expect(JSON.stringify(row.payload)).not.toContain('SECRET-TOKEN-VALUE');

    // the relay dispatches the "mail" topic to queue "outbox", job "email-send", with a deterministic job id.
    // QueueService.add is observed instead of executed: BullMQ needs Redis ≥ 5 and the suite must not depend on it.
    const add = jest.spyOn(app.app.get(QueueService), 'add').mockResolvedValue(undefined as never);
    let calls: (typeof add.mock.calls)[number][] = [];
    try {
      const relay = new OutboxRelay(registry, app.app.get(WsEmitter), app.app.get(AuditService));
      await eventually(async () => {
        await relay.tick();
        return (await db.outbox.findFirstOrThrow({ where: { id: row.id } })).processedAt;
      });
      calls = [...add.mock.calls];
    } finally {
      add.mockRestore();
    }
    const call = calls.find((c) => c[3] === 'mail:' + key);
    expect(call).toBeDefined();
    const [queueName, jobName, data, , opts] = call!;
    expect([queueName, jobName]).toEqual(['outbox', 'email-send']);
    expect(opts).toMatchObject({ attempts: 5 });
    expect(JSON.stringify(data)).not.toContain('SECRET-TOKEN-VALUE');
    expect((await db.outbox.findFirstOrThrow({ where: { id: row.id } })).processedAt).not.toBeNull();

    // the registered job handler renders and sends
    const handler = registry.handlers.get('outbox')!.get('email-send')!;
    await handler(data, {} as never);
    const mails = await app.app.get(MailService).localMailbox(to);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ template: 'auth/reset', locale: 'en', subject: 'Reset your password' });
    expect(mails[0]!.html).toContain('https://app.test/reset-password?token=SECRET-TOKEN-VALUE');
    await expect(handler({ to, template: 'nope/unknown', locale: 'fr', params: {} }, {} as never)).rejects.toThrow(/unknown mail template/);
  });

  it('templates are localized (fr / ar / en), RTL for Arabic, values escaped, dates in Africa/Algiers', async () => {
    const names = ['auth/verify', 'auth/verify-reminder', 'auth/reset', 'auth/email-change', 'auth/email-change-notice', 'auth/account-deletion-confirm', 'workspace/invitation', 'workspace/ownership-transferred', 'workspace/deletion-scheduled', 'workspace/deleted'] as const;
    const params = { firstName: 'Lina', newEmail: 'n@x.dz', inviterName: 'A <b>', workspaceName: 'Boutique & Co', role: 'operator', newOwnerName: 'N', oldOwnerName: 'O', at: '2026-10-11T13:05:00.000Z', scheduledAt: '2026-11-10T23:30:00.000Z', url: 'https://app.test/x?token=abc' };
    for (const name of names) {
      const subjects = new Set<string>();
      for (const locale of ['fr', 'ar', 'en']) {
        const m = renderMail(name, locale, params);
        subjects.add(m.subject);
        expect(m.html).toContain(`dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
        expect(m.html).not.toMatch(/\{[a-zA-Z]+\}/); // every placeholder is filled
        expect(m.html).not.toContain('<b>');
        expect(m.text.length).toBeGreaterThan(10);
      }
      expect(subjects.size).toBe(3);
    }
    expect(renderMail('workspace/invitation', 'fr', params).html).toContain('Opérateur');
    expect(renderMail('workspace/deletion-scheduled', 'fr', params).html).toContain('14:05'); // 13:05 UTC = 14:05 Africa/Algiers
    expect(renderMail('auth/account-deletion-confirm', 'en', params).text).toContain('11 Nov 2026');
    expect(renderMail('auth/verify', 'xx', params).subject).toBe('Vérifiez votre e-mail'); // unknown locale ⇒ fr
    expect(await mailsTo(app, uniqEmail('nobody'))).toEqual([]);
  });
});
