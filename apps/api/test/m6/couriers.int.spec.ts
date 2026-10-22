// M6 — courier accounts (DLV-03): per-provider required fields, encrypted credentials (never returned), connection
// test, default account, active toggle, delete guard; courier rates + "copy into my grid" (DLV-07).
import { rawPrisma } from '@djaber/db';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { forbidNetwork } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { seedFees } from '../support/m5';
import { addCourier, confirmedOrder, CREDS, db, drain, fakeCourier, send } from '../support/m6';

let app: TestApp;
let net: ReturnType<typeof forbidNetwork>;
beforeAll(async () => {
  app = await createTestApp();
  net = forbidNetwork();
});
afterAll(async () => {
  expect(net.spy).not.toHaveBeenCalled();
  net.restore();
  await closeOutbox();
  await app.close();
});
afterEach(() => fakeCourier(app).reset());

describe('courier accounts (DLV-03)', () => {
  it('providers catalogue: required fields per provider, capabilities, Djaber label for ZR and "Livraison propre"', async () => {
    const owner = await asOwner(app);
    const res = await owner.get('/delivery/couriers/providers').expect(200);
    const by = Object.fromEntries(res.body.data.map((p: any) => [p.provider, p]));
    expect(by.zrexpress.fields.map((f: any) => f.key)).toEqual(['token', 'key']);
    expect(by.ecotrack.fields.map((f: any) => f.key)).toEqual(['baseUrl', 'token']);
    expect(by.yalidine.fields.map((f: any) => f.key)).toEqual(['apiId', 'apiToken']);
    expect(by.zrexpress).toMatchObject({ labelSource: 'djaber', capabilities: { label: false, cancel: false, rates: true } });
    expect(by.ecotrack).toMatchObject({ labelSource: 'courier', capabilities: { label: true, cancel: true, retry: true } });
    expect(by.yalidine.capabilities).toMatchObject({ stopdesk: true, webhook: true });
    expect(by.manual).toMatchObject({ account: false, fields: [] });
  });

  it('create: per-provider required fields (422), credentials encrypted and never returned (masked hints), first account = default, 409 duplicate', async () => {
    const owner = await asOwner(app);
    const missing = await owner.post('/delivery/couriers', { provider: 'zrexpress', credentials: { token: 'abc' } }).expect(422);
    expect(missing.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { 'credentials.key': 'validation.required' } });
    const badUrl = await owner.post('/delivery/couriers', { provider: 'ecotrack', credentials: { baseUrl: 'http://evil.example.com', token: 'x' } }).expect(422);
    expect(badUrl.body.error.fields).toMatchObject({ 'credentials.baseUrl': 'validation.url_https' });
    await owner.post('/delivery/couriers', { provider: 'dhl', credentials: {} }).expect(422);

    const zr = await addCourier(owner, 'zrexpress');
    expect(zr).toMatchObject({ provider: 'zrexpress', displayName: 'ZR Express', isActive: true, isDefault: true, credentialsSet: true, credentialHints: { token: '••••3456', key: '••••cdef' }, lastTest: null, webhookUrl: null });
    expect(JSON.stringify(zr)).not.toContain(CREDS.zrexpress.token);
    const row = await rawPrisma.courierAccount.findUniqueOrThrow({ where: { id: zr.id } });
    expect(Buffer.from(row.credentials).toString('utf8')).not.toContain(CREDS.zrexpress.token);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).defaultCourierAccountId).toBe(zr.id);

    const yal = await addCourier(owner, 'yalidine', { displayName: 'Yalidine Alger' });
    expect(yal).toMatchObject({ isDefault: false, webhookSecretSet: true, webhookUrl: expect.stringContaining(`/api/v1/webhooks/couriers/${yal.id}`) });
    const dup = await owner.post('/delivery/couriers', { provider: 'zrexpress', credentials: CREDS.zrexpress }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const list = (await owner.get('/delivery/couriers').expect(200)).body.data;
    expect(list.map((a: any) => a.id)).toEqual([zr.id, yal.id]);
  });

  it('ZR Express new platform: API key + tenant id ⇒ platform `app` (label, cancel, stop-desks); a Procolis account can sit next to it; credentials stay on their platform', async () => {
    const owner = await asOwner(app);
    const catalogue = (await owner.get('/delivery/couriers/providers').expect(200)).body.data.find((p: any) => p.provider === 'zrexpress');
    expect(catalogue.platforms.map((p: any) => [p.key, p.fields.map((f: any) => f.key), p.labelSource])).toEqual([
      ['app', ['apiKey', 'tenantId'], 'courier'],
      ['procolis', ['token', 'key'], 'djaber'],
    ]);
    const half = await owner.post('/delivery/couriers', { provider: 'zrexpress', credentials: { apiKey: 'zr-app-key-123456' } }).expect(422);
    expect(half.body.error.fields).toMatchObject({ 'credentials.tenantId': 'validation.required' });

    const zrApp = (await owner.post('/delivery/couriers', { provider: 'zrexpress', credentials: { apiKey: 'zr-app-key-123456', tenantId: 'tenant-0001' } }).expect(201)).body.data;
    expect(zrApp).toMatchObject({ provider: 'zrexpress', platform: 'app', baseUrl: 'https://api.zrexpress.app', credentialHints: { apiKey: '••••3456' }, capabilities: { label: true, cancel: true, stopdesk: true, rates: true } });
    expect(JSON.stringify(zrApp)).not.toContain('zr-app-key-123456');
    expect((await owner.post(`/delivery/couriers/${zrApp.id}/test`).expect(200)).body.data).toMatchObject({ ok: true });
    const procolis = await addCourier(owner, 'zrexpress');
    expect(procolis).toMatchObject({ platform: 'procolis', baseUrl: '', capabilities: { label: false, cancel: false } });
    expect((await owner.post('/delivery/couriers', { provider: 'zrexpress', credentials: { apiKey: 'other-key-0000', tenantId: 'tenant-0002' } }).expect(409)).body.error.code).toBe('CONFLICT');
    // a ZR account keeps its platform: its parcels are tracked there
    expect((await owner.patch(`/delivery/couriers/${zrApp.id}`, { credentials: CREDS.zrexpress }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    await owner.patch(`/delivery/couriers/${zrApp.id}`, { credentials: { apiKey: 'zr-app-key-999999', tenantId: 'tenant-0001' } }).expect(200);
  });

  it('test connection: ok + latency / rejected (COURIER_CREDENTIALS_INVALID) / unreachable (COURIER_UNAVAILABLE), stored on the account', async () => {
    const owner = await asOwner(app);
    const zr = await addCourier(owner, 'zrexpress');
    const ok = await owner.post(`/delivery/couriers/${zr.id}/test`).expect(200);
    expect(ok.body.data).toMatchObject({ ok: true, latencyMs: 42, error: null, account: { lastTest: { ok: true, latencyMs: 42, error: null } } });
    await owner.patch(`/delivery/couriers/${zr.id}`, { credentials: { token: 'invalid-token', key: 'k-123456' } }).expect(200);
    const rejected = await owner.post(`/delivery/couriers/${zr.id}/test`).expect(200);
    expect(rejected.body.data).toMatchObject({ ok: false, error: 'COURIER_CREDENTIALS_INVALID' });
    await owner.patch(`/delivery/couriers/${zr.id}`, { credentials: { token: 'down-token', key: 'k-123456' } }).expect(200);
    expect((await owner.post(`/delivery/couriers/${zr.id}/test`).expect(200)).body.data).toMatchObject({ ok: false, error: 'COURIER_UNAVAILABLE' });
    // credentials of another provider shape are refused
    expect((await owner.patch(`/delivery/couriers/${zr.id}`, { credentials: { apiId: 'a', apiToken: 'b' } }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'courier.test' } })).toBe(3);
  });

  it('default + active toggle; delete blocked while parcels are in flight (COURIER_HAS_ACTIVE_SHIPMENTS {count}) then allowed', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const zr = await addCourier(owner, 'zrexpress');
    const eco = await addCourier(owner, 'ecotrack');
    await owner.patch(`/delivery/couriers/${eco.id}`, { isDefault: true }).expect(200);
    let list = (await owner.get('/delivery/couriers').expect(200)).body.data;
    expect(list.find((a: any) => a.id === eco.id).isDefault).toBe(true);
    expect(list.find((a: any) => a.id === zr.id).isDefault).toBe(false);
    // deactivating the default hands the default to the other active account
    await owner.patch(`/delivery/couriers/${eco.id}`, { isActive: false }).expect(200);
    list = (await owner.get('/delivery/couriers').expect(200)).body.data;
    expect(list.find((a: any) => a.id === zr.id).isDefault).toBe(true);
    expect((await owner.patch(`/delivery/couriers/${eco.id}`, { isDefault: true }).expect(422)).body.error.code).toBe('DELIVERY_NO_COURIER');

    const { order } = await confirmedOrder(owner);
    await send(owner, order, { courierAccountId: zr.id }).expect(202);
    await drain(app, owner.workspaceId);
    const blocked = await owner.delete(`/delivery/couriers/${zr.id}`).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'COURIER_HAS_ACTIVE_SHIPMENTS', params: { count: 1 } });
    expect((await owner.get(`/delivery/couriers/${zr.id}`).expect(200)).body.data.actions.find((a: any) => a.key === 'delete')).toMatchObject({ enabled: false, reasonCode: 'COURIER_HAS_ACTIVE_SHIPMENTS' });
    await owner.delete(`/delivery/couriers/${eco.id}`).expect(200);
    expect(await db.courierAccount.count({ where: { id: eco.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, action: { in: ['courier.create', 'courier.update', 'courier.delete'] } } })).toBeGreaterThanOrEqual(5);
  });

  it('roles: operator reads (send dialog) but cannot manage; cross-workspace 404', async () => {
    const owner = await asOwner(app);
    const zr = await addCourier(owner, 'zrexpress');
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/delivery/couriers').expect(200);
    await op.get('/delivery/couriers/providers').expect(200);
    await op.patch(`/delivery/couriers/${zr.id}`, { displayName: 'ZR' }).expect(403);
    await op.post(`/delivery/couriers/${zr.id}/test`).expect(403);
    await op.delete(`/delivery/couriers/${zr.id}`).expect(403);
    const admin = await asAdmin(app, owner.workspaceId);
    await admin.patch(`/delivery/couriers/${zr.id}`, { displayName: 'ZR Alger' }).expect(200);
    const other = await asOwner(app);
    await other.get(`/delivery/couriers/${zr.id}`).expect(404);
    await other.patch(`/delivery/couriers/${zr.id}`, { displayName: 'Autre nom' }).expect(404);
    await other.post(`/delivery/couriers/${zr.id}/test`).expect(404);
    await other.delete(`/delivery/couriers/${zr.id}`).expect(404);
    expect((await other.get('/delivery/couriers').expect(200)).body.data).toEqual([]);
  });
});

describe('courier rates (DLV-07)', () => {
  it('rates come from the worker (cache 1 h): refreshing first, then 69 rows (59–69 at the parent rate); copy into the grid with a dry-run diff', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const zr = await addCourier(owner, 'zrexpress');
    const first = await owner.get(`/delivery/rates?courierAccountId=${zr.id}`).expect(200);
    expect(first.body.data).toMatchObject({ supported: true, refreshing: true, rates: [] });
    expect(fakeCourier(app).callsOf('rates')).toHaveLength(0); // no courier call from the HTTP handler
    await drain(app, owner.workspaceId);
    const rates = (await owner.get(`/delivery/rates?courierAccountId=${zr.id}`).expect(200)).body.data;
    expect(rates).toMatchObject({ refreshing: false, stale: false });
    expect(rates.rates).toHaveLength(69);
    // the courier prices 58 codes: 65 Aïn Oussera and 66 Messaad take the rate of 17 Djelfa
    const rateOf = (w: number) => rates.rates.find((r: any) => r.wilayaId === w);
    expect(rateOf(65)).toMatchObject({ homePrice: rateOf(17).homePrice, stopdeskPrice: rateOf(17).stopdeskPrice });
    expect(rateOf(66)).toMatchObject({ homePrice: rateOf(17).homePrice });
    expect(rates.rates.find((r: any) => r.wilayaId === 16)).toMatchObject({ homePrice: 700, stopdeskPrice: 550, price: 700 });
    const one = (await owner.get(`/delivery/rates?courierAccountId=${zr.id}&wilayaId=16&stopdesk=true`).expect(200)).body.data;
    expect(one.rates).toEqual([expect.objectContaining({ wilayaId: 16, price: 550 })]);

    const dry = (await owner.post('/delivery/fees/copy-from-courier', { courierAccountId: zr.id, wilayaIds: [16, 31], dryRun: true }).expect(200)).body.data;
    expect(dry).toMatchObject({ dryRun: true, written: 0, missing: [] });
    expect(dry.rows.find((r: any) => r.wilayaId === 16)).toMatchObject({ after: { homePrice: 700, stopdeskPrice: 550 }, changed: true });
    const done = (await owner.post('/delivery/fees/copy-from-courier', { courierAccountId: zr.id, wilayaIds: [16, 31] }).expect(200)).body.data;
    expect(done.written).toBe(2);
    const grid = (await owner.get('/delivery/fees').expect(200)).body.data;
    expect(grid.find((r: any) => r.wilayaId === 16)).toMatchObject({ homePrice: 700, stopdeskPrice: 550, source: 'custom', courierCost: 700 });
    // EcoTrack has no rates endpoint
    const eco = await addCourier(owner, 'ecotrack');
    expect((await owner.get(`/delivery/rates?courierAccountId=${eco.id}`).expect(200)).body.data).toMatchObject({ supported: false, refreshing: false, rates: [] });
    // operators read rates but cannot copy them
    const op = await asOperator(app, owner.workspaceId);
    await op.get(`/delivery/rates?courierAccountId=${zr.id}`).expect(200);
    await op.post('/delivery/fees/copy-from-courier', { courierAccountId: zr.id }).expect(403);
    const other = await asOwner(app);
    await other.get(`/delivery/rates?courierAccountId=${zr.id}`).expect(404);
  });
});
