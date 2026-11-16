// M11 — API-03 outbound webhooks (06 §4 / §8.10, api-contract §6, 03-events §1 / §3 / §6): endpoints CRUD, secret shown once,
// HMAC signature, 5 s timeout, retries 1 min…24 h (7 attempts), deliveries log, replay, auto-disable after 50 consecutive
// failures + `webhook.disabled`, re-enable, test ping, events produced by the business modules. Receivers are local servers.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { adjust, createProduct } from '../support/m2';
import { newOrder, seedFees, status } from '../support/m5';
import { db, localNetworkOnly, receiver, withKey, work, type Receiver } from '../support/m11';
import { isPrivateHttps, verifyWebhookSignature, webhookUrlAllowed } from '../../src/modules/integrations/webhook-signing';

let app: TestApp;
let net: ReturnType<typeof localNetworkOnly>;
const receivers: Receiver[] = [];
beforeAll(async () => {
  app = await createTestApp();
  net = localNetworkOnly();
});
afterAll(async () => {
  net.restore();
  await Promise.all(receivers.map((r) => r.close()));
  await app.close();
});
const rx = async () => {
  const r = await receiver();
  receivers.push(r);
  return r;
};
type Owner = Awaited<ReturnType<typeof asOwner>>;
const endpoint = async (owner: Owner, url: string, events: string[]) => (await owner.post('/webhooks', { url, events }).expect(201)).body.data as Record<string, any>;

describe('endpoints (API-03)', () => {
  it('create ⇒ secret once (whsec_), stored encrypted, hint; list with plan allowance; patch; rotate; delete; audit', async () => {
    const owner = await asOwner(app);
    const r = await rx();
    const e = await endpoint(owner, r.url, ['order.created', 'stock.low']);
    expect(e.secret).toMatch(/^whsec_[A-Za-z0-9_-]{30,}$/);
    expect(e).toMatchObject({ url: r.url, events: ['order.created', 'stock.low'], status: 'active', failureCount: 0, disableAfter: 50, secretHint: `whsec_…${e.secret.slice(-4)}` });
    const row = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } });
    expect(Buffer.from(row.secret).toString('utf8')).not.toContain(e.secret);
    const list = (await owner.get('/webhooks').expect(200)).body.data;
    expect(list).toMatchObject({ used: 1, limit: 5, featureEnabled: true, maxAttempts: 7, retryDelaysSeconds: [60, 300, 1800, 7200, 43200, 86400] });
    expect(list.endpoints[0]).not.toHaveProperty('secret');
    expect(list.events).toContain('product.updated');

    const patched = (await owner.patch(`/webhooks/${e.id}`, { events: ['customer.new'] }).expect(200)).body.data;
    expect(patched.events).toEqual(['customer.new']);
    const rotated = (await owner.post(`/webhooks/${e.id}/rotate-secret`, {}).expect(200)).body.data;
    expect(rotated.secret).not.toBe(e.secret);
    expect(rotated.secretRotatedAt).not.toBeNull();
    await owner.delete(`/webhooks/${e.id}`).expect(204);
    await owner.get(`/webhooks/${e.id}`).expect(404);
    const actions = (await db.auditLog.findMany({ where: { workspaceId: owner.workspaceId, entity: 'WebhookEndpoint' }, select: { action: true } })).map((a) => a.action).sort();
    expect(actions).toEqual(['webhook.create', 'webhook.delete', 'webhook.rotate_secret', 'webhook.update']);
  });

  it('422 (url, events), 403 Operator, cross-workspace 404, plan feature / limit, API key with webhooks:manage', async () => {
    const owner = await asOwner(app);
    expect((await owner.post('/webhooks', { url: 'not a url', events: ['order.created'] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await owner.post('/webhooks', { url: 'https://example.com/h', events: [] }).expect(422)).body.error.fields).toMatchObject({ events: 'validation.required' });
    expect((await owner.post('/webhooks', { url: 'ftp://example.com/h', events: ['order.created'] }).expect(422)).body.error.code).toBe('WEBHOOK_URL_INVALID');
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/webhooks').expect(403)).body.error.code).toBe('FORBIDDEN');
    const admin = await asAdmin(app, owner.workspaceId);
    const e = await endpoint(admin as never, 'https://hooks.example.com/a', ['order.created']);
    const other = await asOwner(app);
    await other.patch(`/webhooks/${e.id}`, { events: ['order.paid'] }).expect(404);
    await other.post(`/webhooks/${e.id}/test`, {}).expect(404);
    await other.get(`/webhooks/${e.id}/deliveries`).expect(404);
    const starter = await asOwner(app, 'starter');
    expect((await starter.post('/webhooks', { url: 'https://hooks.example.com/a', events: ['order.created'] }).expect(403)).body.error).toMatchObject({ code: 'PLAN_FEATURE_REQUIRED', params: { feature: 'webhooks' } });
    for (let i = 0; i < 3; i++) await endpoint(owner, `https://hooks.example.com/${i}`, ['order.created']);
    await endpoint(owner, 'https://hooks.example.com/5', ['order.created']);
    expect((await owner.post('/webhooks', { url: 'https://hooks.example.com/6', events: ['order.created'] }).expect(403)).body.error.code).toBe('PLAN_LIMIT');
    // API key with webhooks:manage reaches /webhooks only
    const key = (await owner.post('/api-keys', { name: 'Zapier', scopes: ['webhooks:manage'] }).expect(201)).body.data.key;
    expect((await withKey(app, key).get('/webhooks').expect(200)).body.data.used).toBe(5);
    expect((await withKey(app, key).get('/orders').expect(403)).body.error.code).toBe('API_SCOPE_FORBIDDEN');
  });

  it('URL rules: production = https + public host; development accepts http and local receivers', () => {
    expect(webhookUrlAllowed('https://erp.amel.dz/hooks', true)).toBe(true);
    expect(webhookUrlAllowed('http://erp.amel.dz/hooks', true)).toBe(false);
    expect(webhookUrlAllowed('https://127.0.0.1/hooks', true)).toBe(false);
    expect(webhookUrlAllowed('https://192.168.1.10/hooks', true)).toBe(false);
    expect(webhookUrlAllowed('https://user:pw@erp.amel.dz/', true)).toBe(false);
    expect(webhookUrlAllowed('http://127.0.0.1:9999/hook', false)).toBe(true);
    // full-test 15/11 SETTINGS-12: an https URL on a private host gets its own reason (WEBHOOK_URL_PRIVATE)
    expect([isPrivateHttps('https://169.254.169.254/x'), isPrivateHttps('https://localhost/x'), isPrivateHttps('http://10.0.0.1/x'), isPrivateHttps('https://erp.amel.dz/')]).toEqual([true, true, false, false]);
  });
});

describe('delivery (03-events §6)', () => {
  it('order.created ⇒ signed POST (t, v1 HMAC of "t.body"), headers, payload { id, event, createdAt, workspaceId, data }; one delivery per subscribed endpoint; outbox replay ⇒ no duplicate', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const r = await rx();
    const unsubscribed = await rx();
    const e = await endpoint(owner, r.url, ['order.created', 'order.status_changed']);
    await endpoint(owner, unsubscribed.url, ['stock.out']);
    const { order } = await newOrder(owner);
    await work(app, [owner.workspaceId]);
    expect(unsubscribed.hits).toHaveLength(0);
    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0]!;
    const body = JSON.parse(hit.body);
    expect(body).toMatchObject({ event: 'order.created', workspaceId: owner.workspaceId, data: { id: order.id, number: order.number, source: 'manual' } });
    expect(body.id).toMatch(/^evt_/);
    expect(hit.headers['x-djaber-event']).toBe('order.created');
    expect(hit.headers['user-agent']).toBe('Djaber-Webhooks/1');
    expect(hit.headers['content-type']).toContain('application/json');
    expect(verifyWebhookSignature(e.secret, hit.body, String(hit.headers['x-djaber-signature']))).toBe(true);
    expect(verifyWebhookSignature('whsec_wrong', hit.body, String(hit.headers['x-djaber-signature']))).toBe(false);
    expect(verifyWebhookSignature(e.secret, hit.body, String(hit.headers['x-djaber-signature']), Math.floor(Date.now() / 1000) + 400)).toBe(false);

    const deliveries = (await owner.get(`/webhooks/${e.id}/deliveries`).expect(200)).body;
    expect(deliveries.meta).toMatchObject({ total: 1, page: 1 });
    expect(deliveries.data[0]).toMatchObject({ id: hit.headers['x-djaber-delivery'], event: 'order.created', status: 'success', attempt: 1, maxAttempts: 7, responseCode: 200, summary: `#${order.number}` });

    // the relay processing the same outbox row twice creates no second delivery
    const row = await db.outbox.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, topic: 'webhook', key: { startsWith: 'order.created:' } } });
    await db.outbox.update({ where: { id: row.id }, data: { processedAt: null } });
    await work(app, [owner.workspaceId]);
    expect(r.hits).toHaveLength(1);

    // a status change is delivered as order.status_changed
    await status(owner, order, 'confirmed').expect(200);
    await work(app, [owner.workspaceId]);
    expect(JSON.parse(r.hits[1]!.body)).toMatchObject({ event: 'order.status_changed', data: { from: 'new', to: 'confirmed', order: { id: order.id } } });
  });

  it('every business event reaches a subscribed endpoint: stock.low / stock.out, product.updated, customer.new, order.cancelled', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const r = await rx();
    await endpoint(owner, r.url, ['stock.low', 'stock.out', 'product.updated', 'customer.new', 'order.cancelled']);
    const p = await createProduct(owner, { name: 'Parfum Oud', price: 5000, stock: 10, minStock: 5 });
    await adjust(owner, { productId: p.id, type: 'set', quantity: 3, reason: 'inventory' }).expect(201);
    const fresh = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
    await owner.patch(`/products/${p.id}`, { version: fresh.version, price: 5500 }).expect(200);
    const { order } = await newOrder(owner);
    await status(owner, order, 'cancelled', { reason: 'changed_mind' }).expect(200);
    await work(app, [owner.workspaceId]);
    const events = r.hits.map((h) => JSON.parse(h.body)).map((b) => b.event);
    expect(events).toEqual(expect.arrayContaining(['stock.low', 'product.updated', 'customer.new', 'order.cancelled']));
    const updated = r.hits.map((h) => JSON.parse(h.body)).find((b) => b.event === 'product.updated');
    expect(updated.data).toMatchObject({ productId: p.id, changed: ['price'] });
  });

  it('failure ⇒ retry scheduled 1 min later (attempt 2/7, nextAttemptAt); 7 attempts then exhausted; timeout after 5 s counts as a failure', async () => {
    const owner = await asOwner(app);
    const r = await rx();
    r.status = 502;
    const e = await endpoint(owner, r.url, ['customer.new']);
    await owner.post('/clients', { name: 'Amel', phone: '0555123456' }).expect(201);
    await work(app, [owner.workspaceId], { rounds: 2 });
    // first attempt made, retry scheduled
    const d1 = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: e.id } });
    expect(d1).toMatchObject({ status: 'pending', attempt: 2, responseCode: 502 });
    expect(d1.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(55_000);
    const retryRow = await db.outbox.findFirstOrThrow({ where: { topic: 'job', key: `wh:${d1.id}:2` } });
    expect((retryRow.payload as any).opts.delay).toBe(60_000);
    const view = (await owner.get(`/webhooks/deliveries/${d1.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'pending', attempt: 2, maxAttempts: 7, actions: [{ key: 'replay', enabled: false }] });
    // the queue runs the remaining attempts (their delays are BullMQ's)
    await work(app, [owner.workspaceId]);
    expect(r.hits).toHaveLength(7);
    const d = await db.webhookDelivery.findUniqueOrThrow({ where: { id: d1.id } });
    expect(d).toMatchObject({ status: 'exhausted', attempt: 7, nextAttemptAt: null });
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } })).failureCount).toBe(7);
    const delays = (await db.outbox.findMany({ where: { topic: 'job', key: { startsWith: `wh:${d1.id}:` } }, orderBy: { createdAt: 'asc' } })).map((x) => (x.payload as any).opts.delay ?? 0);
    expect(delays).toEqual([0, 60_000, 300_000, 1_800_000, 7_200_000, 43_200_000, 86_400_000]);

    // a success resets the consecutive failure counter
    r.status = 200;
    await owner.post(`/webhooks/deliveries/${d1.id}/replay`, {}).expect(202);
    await work(app, [owner.workspaceId]);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } })).failureCount).toBe(0);

    // a receiver slower than 5 s is a failure (timeout)
    r.delayMs = 5_500;
    const ping = (await owner.post(`/webhooks/${e.id}/test`, {}).expect(202)).body.data;
    await work(app, [owner.workspaceId]);
    const timedOut = await db.webhookDelivery.findUniqueOrThrow({ where: { id: ping.id } });
    expect(timedOut).toMatchObject({ status: 'exhausted', responseCode: null });
    expect(timedOut.error).toMatch(/timeout/);
    r.delayMs = 0;
  }, 60_000);

  it('AT-API-02 endpoint failing 50× ⇒ disabled + webhook.disabled notification + audit; no more deliveries; re-enable resets; replay works', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const r = await rx();
    r.status = 503;
    const e = await endpoint(owner, r.url, ['customer.new']);
    for (let i = 0; i < 50; i++) {
      await owner.post(`/webhooks/${e.id}/test`, {}).expect(202);
      await work(app, [owner.workspaceId]);
    }
    const disabled = (await owner.get(`/webhooks/${e.id}`).expect(200)).body.data;
    expect(disabled).toMatchObject({ status: 'disabled', isActive: false, failureCount: 50, disabledReason: 'WEBHOOK_ENDPOINT_DISABLED', lastFailure: { responseCode: 503 } });
    expect(disabled.actions.find((a: any) => a.key === 'enable')).toMatchObject({ enabled: true });
    expect(disabled.actions.find((a: any) => a.key === 'test')).toMatchObject({ enabled: false, reasonCode: 'WEBHOOK_ENDPOINT_DISABLED' });
    const notes = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'webhook_disabled' } });
    expect(notes.map((n) => n.userId).sort()).toEqual([owner.userId, admin.userId].sort());
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'webhook.auto_disabled' } })).toBe(1);

    // disabled: events are no longer delivered, test / replay refused with the catalogue code
    await owner.post('/clients', { name: 'Yacine', phone: '0555123457' }).expect(201);
    await work(app, [owner.workspaceId]);
    expect(r.hits).toHaveLength(50);
    expect((await owner.post(`/webhooks/${e.id}/test`, {}).expect(422)).body.error.code).toBe('WEBHOOK_ENDPOINT_DISABLED');
    const failed = (await owner.get(`/webhooks/${e.id}/deliveries?status=exhausted&pageSize=25`).expect(200)).body;
    expect(failed.meta.total).toBe(50);
    expect((await owner.post(`/webhooks/deliveries/${failed.data[0].id}/replay`, {}).expect(422)).body.error.code).toBe('WEBHOOK_ENDPOINT_DISABLED');

    // fixed receiver + re-enable ⇒ counter reset; replay = new delivery, same payload
    r.status = 200;
    const enabled = (await owner.post(`/webhooks/${e.id}/enable`, {}).expect(200)).body.data;
    expect(enabled).toMatchObject({ status: 'active', failureCount: 0, disabledAt: null });
    expect((await owner.post(`/webhooks/${e.id}/enable`, {}).expect(409)).body.error.code).toBe('CONFLICT');
    const replay = (await owner.post(`/webhooks/deliveries/${failed.data[0].id}/replay`, {}).expect(202)).body.data;
    expect(replay).toMatchObject({ replayOfId: failed.data[0].id, status: 'pending', event: 'ping' });
    await work(app, [owner.workspaceId]);
    expect((await owner.get(`/webhooks/deliveries/${replay.id}`).expect(200)).body.data).toMatchObject({ status: 'success', responseCode: 200 });
    expect(JSON.parse(r.hits[r.hits.length - 1]!.body)).toEqual(failed.data[0].payload);
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: { in: ['webhook.enable', 'webhook.replay'] } } })).toBe(2);
  }, 120_000);

  it('development safety: a non-local URL is never called (recorded failed, no retry, not counted); suspended workspace ⇒ no delivery', async () => {
    const owner = await asOwner(app);
    const e = await endpoint(owner, 'https://hooks.zapier.com/hooks/catch/1/abc', ['customer.new']);
    await owner.post('/clients', { name: 'Sara', phone: '0555123458' }).expect(201);
    await work(app, [owner.workspaceId]);
    expect(net.spy.mock.calls.some(([u]) => String(u).includes('zapier'))).toBe(false);
    const d = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: e.id } });
    expect(d).toMatchObject({ status: 'failed', error: 'blocked: WEBHOOKS_ALLOW_LIVE=false' });
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: e.id } })).failureCount).toBe(0);

    const r = await rx();
    await endpoint(owner, r.url, ['customer.new']);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { status: 'suspended' } });
    await db.outbox.create({ data: { workspaceId: owner.workspaceId, topic: 'webhook', key: `customer.new:manual-${Date.now()}`, payload: { event: 'customer.new', data: { client: { id: 'x' } } } } });
    await work(app, [owner.workspaceId]);
    expect(r.hits).toHaveLength(0);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { status: 'active' } });
  });
});
