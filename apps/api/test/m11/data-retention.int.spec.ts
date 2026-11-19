// MSG-08 / PUB-05 / DEL-03 / 07-non-functional §4 — the data-deletion and retention gaps found while drafting the legal
// texts (docs/content-drafts/README.md "Findings while drafting" 1–4):
//   1. a Meta deletion anonymises the customer card that has orders (name / phones / address gone, figures untouched)
//   2. the callback's app-scoped id is resolved to page-scoped ids by the job (fake `ids_for_pages`), nothing matched ⇒
//      honest `no_data` status; the e-mail path = `POST /admin/data-deletion-requests`
//   3. invoices / billing payments / pack purchases survive the workspace purge on a `purged` stub
//   4. the retention table is enforced by `sched-retention` (audit 24 m, closed reports / lifted blocks 2 y, payment
//      events 5 y, AI tool args 12 m, AI runs 24 m, jobs 90 d), batched and idempotent.
// Only the fake Meta adapter runs; a `fetch` guard fails the suite on any network call.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ConfigService } from '../../src/core/config/config.service';
import { ComplianceRetentionService } from '../../src/core/audit/retention.service';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { DataLifecycleService, ANONYMISED_CLIENT_NAME } from '../../src/modules/messaging/data-lifecycle.service';
import { MetaError } from '../../src/modules/meta/meta-errors';
import { buildSignedRequest } from '../../src/modules/meta/meta-signature';
import { WorkspaceDeletionService } from '../../src/modules/workspace/workspace-deletion.service';
import { WorkerRunner } from '../../src/worker/worker.runner';
import { asOwner, asPlatform } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { APP_SECRET, connectedPage, db, fakeMeta, forbidNetwork, newSender, receive, work } from '../support/m3';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  net = forbidNetwork();
  app = await createTestApp();
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await app.close();
});

const DAY = 86_400_000;
const callbackUrl = '/api/v1/webhooks/meta/data-deletion';
const callback = (userId: string) => request(app.http()).post(callbackUrl).type('form').send({ signed_request: buildSignedRequest(APP_SECRET, { user_id: userId }) }).expect(200);
const statusOf = async (code: string) => (await request(app.http()).get(`/api/v1/data-deletion/${code}`).expect(200)).body.data;
const asid = () => `1${String(Date.now()).slice(-9)}${randomUUID().replace(/\D/g, '').slice(0, 5)}`;
let seq = 0;
const orderFor = (workspaceId: string, clientId: string, conversationId: string | null, over: Record<string, unknown> = {}) =>
  db.order.create({
    data: {
      workspaceId,
      number: `CMD-DD-${++seq}-${randomUUID().slice(0, 4)}`,
      clientId,
      conversationId,
      source: 'ai',
      clientName: 'Sara Benali',
      clientPhone: '0661234567',
      clientPhone2: '0770123456',
      address: 'Cité 200 logements, bloc B',
      communeText: 'Bab Ezzouar',
      wilayaId: 16,
      notes: 'Appeler après 17 h',
      subtotal: 5000,
      deliveryFee: 400,
      total: 5400,
      amountPaid: 5400,
      paymentStatus: 'paid',
      status: 'delivered',
      deliveryStatus: 'delivered',
      ...over,
    },
  });

describe('Meta data deletion — customer card with orders is anonymised (MSG-08, PUB-05)', () => {
  it('AT-MSG-07 / AT-MSG-10 callback app-scoped id → page-scoped ids (fake ids_for_pages) ⇒ conversations gone, card + orders anonymised, figures kept, TERMINÉ', async () => {
    const a = await asOwner(app);
    const b = await asOwner(app);
    const channelA = await connectedPage(a, app);
    const channelB = await connectedPage(b, app);
    const appScoped = asid();
    const psidA = newSender();
    const psidB = newSender();
    const other = newSender();
    const first = await receive(app, channelA, psidA, { text: 'Je confirme la robe' });
    const second = await receive(app, channelB, psidB, { text: 'Salam' });
    const untouched = await receive(app, channelA, other, { text: 'je reste' });
    const clientId = first.conversation.clientId!;
    await db.client.update({ where: { id: clientId }, data: { name: 'Sara Benali', phone: '0661234567', phone2: '0770123456', email: 'sara@example.dz', notes: 'cliente fidèle', tags: ['vip'], isPlaceholder: false } });
    await db.clientAddress.create({ data: { clientId, wilayaId: 16, address: 'Cité 200 logements', isDefault: true } });
    const order = await orderFor(a.workspaceId, clientId, first.conversation.id);
    const invoicesBefore = await db.invoice.findMany({ where: { workspaceId: a.workspaceId }, orderBy: { id: 'asc' } });
    // the person is known under another page-scoped id on each page; the signed_request only carries the app-scoped id
    fakeMeta(app).setIdsForPages(appScoped, [
      { pageId: channelA.externalId, psid: psidA },
      { pageId: channelB.externalId, psid: psidB },
      { pageId: '999999999999999', psid: newSender() }, // a page of the business that is not on Djaber
    ]);

    const code: string = (await callback(appScoped)).body.confirmation_code;
    expect(await statusOf(code)).toMatchObject({ status: 'pending', summary: null });
    // the HTTP handler never called Meta: the mapping is read by the job
    expect(fakeMeta(app).callsOf('idsForPages')).toHaveLength(0);
    expect(await work(app, [a.workspaceId, b.workspaceId])).toContain('meta-data-deletion');
    expect(fakeMeta(app).callsOf('idsForPages').map((c) => c.args)).toEqual([{ appScopedUserId: appScoped }]);

    expect(await db.conversation.count({ where: { id: { in: [first.conversation.id, second.conversation.id] } } })).toBe(0);
    expect(await db.clientIdentity.count({ where: { externalSenderId: { in: [psidA, psidB] } } })).toBe(0);
    expect(await db.message.count({ where: { conversationId: untouched.conversation.id } })).toBe(1);
    // the card with an order stays for the merchant's books, without any personal data, archived
    const card = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(card).toMatchObject({ name: ANONYMISED_CLIENT_NAME, phone: null, phone2: null, email: null, notes: null, tags: [] });
    expect(card.deletedAt).not.toBeNull();
    expect(await db.clientAddress.count({ where: { clientId } })).toBe(0);
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ clientName: ANONYMISED_CLIENT_NAME, clientPhone: '', clientPhone2: null, address: null, communeText: null, notes: null, conversationId: null });
    // accounting figures untouched
    expect(after).toMatchObject({ number: order.number, subtotal: 5000, deliveryFee: 400, total: 5400, amountPaid: 5400, paymentStatus: 'paid', status: 'delivered', wilayaId: 16 });
    expect(await db.invoice.findMany({ where: { workspaceId: a.workspaceId }, orderBy: { id: 'asc' } })).toEqual(invoicesBefore);
    // the placeholder card of the second shop (no orders) is gone
    expect(await db.client.count({ where: { id: second.conversation.clientId! } })).toBe(0);

    const done = await statusOf(code);
    expect(done).toMatchObject({ code, status: 'done', summary: { conversations: 2, clientsAnonymised: 1, clientsDeleted: 1, orders: 1, workspaces: 2 } });
    // a second run of the same job changes nothing
    const req = await db.dataDeletionRequest.findUniqueOrThrow({ where: { confirmationCode: code } });
    expect(await app.app.get(DataLifecycleService).runDeletion(req.id)).toBe(0);
    expect(req).toMatchObject({ source: 'callback', affectedWorkspaces: 2 });
    expect(req.result).toMatchObject({ resolution: 'ids_for_pages', senderIds: 4 });
  });
});

describe('Meta data deletion — nothing matched (MSG-08)', () => {
  it('AT-MSG-10 / AT-PUB-03 an app-scoped id Meta maps to no page we hold ⇒ status no_data (not TERMINÉ), summary null', async () => {
    const code: string = (await callback(asid())).body.confirmation_code;
    await work(app, []);
    const s = await statusOf(code);
    expect(s).toMatchObject({ code, status: 'no_data', summary: null });
    expect(s.completedAt).not.toBeNull();
  });

  it('AT-MSG-10 a transient Meta failure is retried; the last attempt goes on with the stored ids and says so', async () => {
    const appScoped = asid();
    const code: string = (await callback(appScoped)).body.confirmation_code;
    fakeMeta(app).failNext('idsForPages', new MetaError('unavailable', 'Service temporarily unavailable', 2));
    await work(app, [], { tolerate: ['meta-data-deletion'] });
    const req = await db.dataDeletionRequest.findUniqueOrThrow({ where: { confirmationCode: code } });
    expect(req.status).toBe('pending'); // BullMQ retries it
    fakeMeta(app).failNext('idsForPages', new MetaError('unavailable', 'Service temporarily unavailable', 2));
    await app.app.get(DataLifecycleService).runDeletion(req.id, 4); // last attempt
    const after = await db.dataDeletionRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('no_data');
    expect(after.result).toMatchObject({ resolution: 'failed' });
  });
});

describe('POST /admin/data-deletion-requests — request received by e-mail (MSG-08, ADM-16)', () => {
  it('AT-MSG-11 permissions, validation, idempotent repeat, then the job anonymises the card found by phone; the target is not kept', async () => {
    const shop = await asOwner(app);
    const otherShop = await asOwner(app);
    const channel = await connectedPage(shop, app);
    const sender = newSender();
    const conv = await receive(app, channel, sender, { text: 'Je veux supprimer mes données' });
    const clientId = conv.conversation.clientId!;
    await db.client.update({ where: { id: clientId }, data: { name: 'Karim H', phone: '0555443322', isPlaceholder: false } });
    const order = await orderFor(shop.workspaceId, clientId, conv.conversation.id, { clientName: 'Karim H', clientPhone: '0555443322' });
    // same phone in another shop: outside the requested workspace, untouched
    const elsewhere = await db.client.create({ data: { workspaceId: otherShop.workspaceId, name: 'Karim H', phone: '0555443322' } });

    const support = await asPlatform(app, 'support');
    const body = { phone: '+213 555 44 33 22', workspaceId: shop.workspaceId, reason: 'Demande reçue par e-mail le 19/11 (ticket #812)' };
    for (const role of ['finance', 'moderator', 'read']) await (await asPlatform(app, role)).post('/admin/data-deletion-requests', body).expect(403);
    await shop.post('/admin/data-deletion-requests', body).expect(403);
    expect((await support.post('/admin/data-deletion-requests', { workspaceId: shop.workspaceId, reason: body.reason }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await support.post('/admin/data-deletion-requests', { ...body, phone: '12' }).expect(422)).body.error.fields).toEqual({ phone: 'validation.phone' });
    expect((await support.post('/admin/data-deletion-requests', { ...body, reason: 'court' }).expect(422)).body.error.code).toBe('ADMIN_REASON_REQUIRED');
    await support.post('/admin/data-deletion-requests', { ...body, workspaceId: randomUUID() }).expect(404);

    const created = (await support.post('/admin/data-deletion-requests', body).expect(201)).body.data;
    expect(created).toMatchObject({ source: 'admin', status: 'pending', target: '05•• •• •• 22', workspaceId: shop.workspaceId });
    expect(created.statusUrl).toMatch(new RegExp(`/meta/data-deletion/${created.code}$`));
    const again = (await support.post('/admin/data-deletion-requests', body).expect(201)).body.data;
    expect(again.id).toBe(created.id);
    expect(await db.outbox.count({ where: { topic: 'job', key: `datadel:${created.id}` } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'data_deletion.requested', entityId: created.id } })).toBe(1);

    await work(app, [shop.workspaceId, otherShop.workspaceId]);
    expect(await db.conversation.count({ where: { id: conv.conversation.id } })).toBe(0);
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ name: ANONYMISED_CLIENT_NAME, phone: null });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ clientName: ANONYMISED_CLIENT_NAME, clientPhone: '', total: 5400 });
    expect(await db.client.findUniqueOrThrow({ where: { id: elsewhere.id } })).toMatchObject({ name: 'Karim H', phone: '0555443322' });
    const row = await db.dataDeletionRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ status: 'done', targetPhone: null, requestedById: support.userId });
    expect(await statusOf(created.code)).toMatchObject({ status: 'done', summary: { conversations: 1, clientsAnonymised: 1, orders: 1, workspaces: 1 } });

    const list = (await (await asPlatform(app, 'read')).get('/admin/data-deletion-requests?source=admin').expect(200)).body;
    const listed = list.data.find((r: { id: string }) => r.id === created.id);
    expect(listed).toMatchObject({ status: 'done', target: null, summary: { clientsAnonymised: 1 } });
  });
});

describe('workspace purge keeps the billing rows 10 years (DEL-03, 07-non-functional §4)', () => {
  it('AT-DEL-06 invoices, payments and pack purchases survive on a `purged` stub (same id, no members, hidden); twice is harmless', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    await db.workspace.update({ where: { id: ws }, data: { billingInfo: { legalName: 'SARL Yasmine', nif: '000016001234567' } } });
    const inv = await db.invoice.create({ data: { workspaceId: ws, number: `T-${randomUUID().slice(0, 8)}`, kind: 'manual', status: 'paid', amount: 1900, lines: [{ label: 'Pro', amount: 1900 }], billingInfo: { legalName: 'SARL Yasmine' }, paidAt: new Date() } });
    const pay = await db.billingPayment.create({ data: { workspaceId: ws, invoiceId: inv.id, amount: 1900, status: 'paid', provider: 'manual', providerCheckoutId: `chk-${randomUUID()}`, paidAt: new Date() } });
    const pack = await db.creditPack.findFirstOrThrow();
    const purchase = await db.creditPackPurchase.create({ data: { workspaceId: ws, creditPackId: pack.id, channel: 'web', status: 'credited', amount: 500, purchasedById: owner.userId } });
    await owner.post('/workspace/quick-replies', { title: 'Bonjour', body: 'Salam' }).expect(201);
    await db.workspace.update({ where: { id: ws }, data: { status: 'deletion_scheduled', deletionScheduledAt: new Date(Date.now() - 1000) } });

    const runner = new WorkerRunner(app.app.get(ConfigService), app.app.get(ProcessorRegistry));
    expect(await runner.runCron('sched-workspace-purge')).toBeGreaterThanOrEqual(1);
    const stub = await db.workspace.findUniqueOrThrow({ where: { id: ws } });
    expect(stub).toMatchObject({ status: 'purged', slug: `purged-${ws}`, billingInfo: { legalName: 'SARL Yasmine', nif: '000016001234567' } });
    expect(stub.deletedAt).not.toBeNull();
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ workspaceId: ws, number: inv.number, amount: 1900, status: 'paid', lines: inv.lines, billingInfo: inv.billingInfo });
    expect(await db.billingPayment.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ workspaceId: ws, invoiceId: inv.id, amount: 1900, status: 'paid' });
    expect(await db.creditPackPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).toMatchObject({ workspaceId: ws, amount: 500 });
    // everything else went with the workspace; no holder row left behind
    expect(await db.membership.count({ where: { workspaceId: ws } })).toBe(0);
    expect(await db.quickReply.count({ where: { workspaceId: ws } })).toBe(0);
    expect(await db.subscription.count({ where: { workspaceId: ws } })).toBe(0);
    expect(await db.workspace.count({ where: { slug: { startsWith: 'purge-hold-' } } })).toBe(0);
    // the stub is not a workspace any more: no tenant, not in the admin list
    await owner.get('/workspace').expect(404);
    const admin = await asPlatform(app, 'super_admin');
    expect((await admin.get(`/admin/workspaces?q=${encodeURIComponent(stub.name)}`).expect(200)).body.data).toEqual([]);
    // the admin invoice list still finds the invoice (10 years)
    expect(await db.invoice.count({ where: { id: inv.id, workspaceId: ws } })).toBe(1);

    await runner.runCron('sched-workspace-purge');
    expect(await db.workspace.findUniqueOrThrow({ where: { id: ws } })).toMatchObject({ status: 'purged' });
    expect(await db.invoice.count({ where: { workspaceId: ws } })).toBe(1);
  });

  it('AT-DEL-06 a workspace without any billing row is deleted outright (no stub)', async () => {
    const owner = await asOwner(app);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { status: 'deletion_scheduled', deletionScheduledAt: new Date(Date.now() - 1000) } });
    expect(await app.app.get(WorkspaceDeletionService).purgeDue()).toBeGreaterThanOrEqual(1);
    expect(await db.workspace.count({ where: { id: owner.workspaceId } })).toBe(0);
  });
});

describe('sched-retention — retention table (07-non-functional §4, 04 §9, 04 §13)', () => {
  it('AT-RET-01 purges audit > 24 m, closed reports / lifted blocks / revoked blacklist > 2 y, payment events > 5 y, AI args > 12 m, AI runs > 24 m, jobs > 90 d; idempotent', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const tag = randomUUID().slice(0, 8);
    const oldAudit = await db.auditLog.create({ data: { actorType: 'system', action: `test.old.${tag}`, entity: 'Test', at: ago(25 * 31) } });
    const recentAudit = await db.auditLog.create({ data: { actorType: 'system', action: `test.recent.${tag}`, entity: 'Test', at: ago(23 * 30) } });
    const report = (status: 'open' | 'dismissed', days: number) => db.report.create({ data: { workspaceId: ws, type: 'customer', reporterKind: 'system', reason: 'spam', status, createdAt: ago(days), resolvedAt: status === 'open' ? null : ago(days) } });
    const oldClosed = await report('dismissed', 800);
    const oldOpen = await report('open', 800);
    const recentClosed = await report('dismissed', 100);
    const liftedOld = await db.customerBlock.create({ data: { workspaceId: ws, phone: `0661${tag.replace(/\D/g, '0').slice(0, 6)}`, reportId: oldClosed.id, blockedAt: ago(900), unblockedAt: ago(800) } });
    const activeOld = await db.customerBlock.create({ data: { workspaceId: ws, phone: '0770999888', blockedAt: ago(900) } });
    const event = (provider: 'chargily' | 'meta', days: number) => db.inboundEvent.create({ data: { provider, externalId: `ev-${randomUUID()}`, payload: {}, receivedAt: ago(days) } });
    const payOld = await event('chargily', 6 * 365);
    const payRecent = await event('chargily', 365);
    const metaOld = await event('meta', 8);
    const job = (days: number, status: 'done' | 'running') => db.job.create({ data: { workspaceId: ws, kind: 'import', status, updatedAt: ago(days), createdAt: ago(days) } });
    const jobOld = await job(100, 'done');
    const jobRunning = await job(100, 'running');
    const jobRecent = await job(10, 'done');
    const model = await db.aiModel.findFirstOrThrow();
    const run = (days: number) => db.aiRun.create({ data: { workspaceId: ws, kind: 'reply', modelId: model.id, providerId: model.providerId, status: 'ok', startedAt: ago(days) } });
    const runOld = await run(25 * 31);
    const runMid = await run(400);
    const runRecent = await run(30);
    const tool = (aiRunId: string) => db.aiToolCall.create({ data: { aiRunId, callId: randomUUID(), name: 'create_order', args: { phone: '0661234567', name: 'Sara' }, result: { ok: true } } });
    await tool(runOld.id);
    const midCall = await tool(runMid.id);
    const recentCall = await tool(runRecent.id);

    const runner = new WorkerRunner(app.app.get(ConfigService), app.app.get(ProcessorRegistry));
    await runner.runCron('sched-retention');

    expect(await db.auditLog.count({ where: { id: oldAudit.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { id: recentAudit.id } })).toBe(1);
    expect(await db.report.count({ where: { id: oldClosed.id } })).toBe(0);
    expect(await db.report.count({ where: { id: { in: [oldOpen.id, recentClosed.id] } } })).toBe(2);
    expect(await db.customerBlock.count({ where: { id: liftedOld.id } })).toBe(0);
    expect(await db.customerBlock.count({ where: { id: activeOld.id } })).toBe(1);
    expect(await db.inboundEvent.count({ where: { id: { in: [payOld.id, metaOld.id] } } })).toBe(0);
    expect(await db.inboundEvent.count({ where: { id: payRecent.id } })).toBe(1); // payment events: 5 years, not 7 days
    expect(await db.job.count({ where: { id: jobOld.id } })).toBe(0);
    expect(await db.job.count({ where: { id: { in: [jobRunning.id, jobRecent.id] } } })).toBe(2);
    expect(await db.aiRun.count({ where: { id: runOld.id } })).toBe(0);
    expect(await db.aiToolCall.findUniqueOrThrow({ where: { id: midCall.id } })).toMatchObject({ args: { redacted: true }, result: { redacted: true } });
    expect(await db.aiToolCall.findUniqueOrThrow({ where: { id: recentCall.id } })).toMatchObject({ args: { phone: '0661234567', name: 'Sara' } });

    // a second run finds nothing more to do
    expect(await app.app.get(ComplianceRetentionService).purge()).toEqual({ auditLogs: 0, reports: 0, blocks: 0, blacklist: 0, aiToolCallsRedacted: 0, aiRuns: 0, jobs: 0 });
    expect(await app.app.get(DataLifecycleService).purge()).toMatchObject({ paymentEvents: 0 });
  });
});
