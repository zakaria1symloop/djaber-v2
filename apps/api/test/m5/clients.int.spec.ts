// M5 — clients (CLI-01…05, 03 §37 CLI) and the fee grid (DLV-01/02/09). AT ids from 13-acceptance-tests.md.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { drain, jobOf } from '../support/m2';
import { forbidNetwork } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { db, idem, newOrder, phone, seedFees } from '../support/m5';

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

const shop = async () => {
  const owner = await asOwner(app);
  await seedFees(app, owner.workspaceId);
  return owner;
};

describe('clients', () => {
  it('AT-CLI-02 "+213 555 12 34 56" when 0555123456 exists ⇒ 409 CLIENT_PHONE_EXISTS with the owner ("use existing")', async () => {
    const owner = await shop();
    const first = await owner.post('/clients', { name: 'Yacine Haddad', phone: '0555123456' }).expect(201);
    expect(first.body.data).toMatchObject({ phone: '0555123456', source: 'manual', pill: 'unknown', quality: ['no_address'] });
    const dup = await owner.post('/clients', { name: 'Autre', phone: '+213 555 12 34 56' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'CLIENT_PHONE_EXISTS', params: { clientName: 'Yacine Haddad' }, fields: { phone: 'validation.phone_taken' }, details: { clientId: first.body.data.id } });
    expect((await owner.post('/clients', { name: 'X', phone: '12345' }).expect(422)).body.error.fields).toMatchObject({ phone: 'validation.phone', name: 'validation.name' });
    // the quick edit refuses a phone taken by someone else
    const other = await owner.post('/clients', { name: 'Sara Belkacem', phone: phone() }).expect(201);
    expect((await owner.patch(`/clients/${other.body.data.id}`, { phone: '0555 12 34 56' }).expect(409)).body.error.code).toBe('CLIENT_PHONE_EXISTS');
  });

  it('CLI-01 email: stored trimmed + lower-cased, blank means none, malformed ⇒ 422 validation.email (the rule the web form shows inline)', async () => {
    const owner = await shop();
    const a = await owner.post('/clients', { name: 'Amina Belkacem', phone: phone(), email: '  Amina.B@Boutique.DZ ' }).expect(201);
    expect(a.body.data.email).toBe('amina.b@boutique.dz');
    const b = await owner.post('/clients', { name: 'Nadia Ferhat', phone: phone(), email: '   ', phone2: ' ' }).expect(201);
    expect(b.body.data).toMatchObject({ email: null, phone2: null });
    expect((await owner.post('/clients', { name: 'Karim Ziani', phone: phone(), email: 'karim@boutique' }).expect(422)).body.error.fields).toMatchObject({ email: 'validation.email' });
  });

  it('AT-CLI-03 / AT-CLI-06 delete with orders ⇒ CUSTOMER_HAS_ORDERS, archive ⇒ soft; orders keep the name; the list hides the client', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner, { client: { name: 'Karim Ziani', phone: phone() } });
    const id = order.client.id;
    expect((await op.delete(`/clients/${id}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await owner.delete(`/clients/${id}`).expect(409)).body.error).toMatchObject({ code: 'CUSTOMER_HAS_ORDERS', params: { count: 1 } });
    await owner.delete(`/clients/${id}?archive=true`).expect(200);
    expect((await owner.get(`/orders/${order.id}`).expect(200)).body.data).toMatchObject({ clientName: 'Karim Ziani', client: { id } });
    expect((await owner.get('/clients').expect(200)).body.data.map((c: any) => c.id)).not.toContain(id);
    expect((await owner.get(`/clients/${id}`).expect(200)).body.data).toMatchObject({ archived: true });
    expect(await db.auditLog.count({ where: { action: 'client.delete', entityId: id } })).toBe(1);
    // without orders: soft delete straight away
    const lone = await owner.post('/clients', { name: 'Sans commande', phone: phone() }).expect(201);
    await owner.delete(`/clients/${lone.body.data.id}`).expect(200);
    expect((await db.client.findUniqueOrThrow({ where: { id: lone.body.data.id } })).deletedAt).not.toBeNull();
  });

  it('AT-CLI-04 list paginated, filters (source, tags, dates, ranges) and search by phone fragment', async () => {
    const owner = await shop();
    const n = phone();
    const a = await owner.post('/clients', { name: 'Lina Mansouri', phone: n, tags: ['vip', 'oran'] }).expect(201);
    await owner.post('/clients', { name: 'Omar Saadi', phone: phone(), tags: ['gros'] }).expect(201);
    const { order } = await newOrder(owner, { client: { name: 'Riad Khelifa', phone: phone() } });
    await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);
    const all = await owner.get('/clients?pageSize=25').expect(200);
    expect(all.body.meta).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect((await owner.get(`/clients?q=${n.slice(4, 8)}`).expect(200)).body.data.map((c: any) => c.id)).toEqual([a.body.data.id]);
    expect((await owner.get('/clients?tags=vip').expect(200)).body.data.map((c: any) => c.name)).toEqual(['Lina Mansouri']);
    expect((await owner.get('/clients?minOrders=1&minSpent=1000').expect(200)).body.data.map((c: any) => c.name)).toEqual(['Riad Khelifa']);
    expect((await owner.get('/clients?neverOrdered=true&sort=name').expect(200)).body.data.map((c: any) => c.name)).toEqual(['Lina Mansouri', 'Omar Saadi']);
    expect((await owner.get('/clients?source=manual&createdFrom=2020-01-01').expect(200)).body.meta.total).toBe(3);
    expect((await owner.get('/clients?wilayaId=16').expect(200)).body.data.map((c: any) => c.name)).toEqual(['Riad Khelifa']);
    expect((await owner.get('/clients?lastOrder=lt30').expect(200)).body.meta.total).toBe(1);
    const riad = (await owner.get('/clients?q=Riad').expect(200)).body.data[0];
    expect(riad).toMatchObject({ pill: 'reliable', deliveredCount: 1, orderCount: 1 });
    expect((await owner.get('/clients?sort=-bogus').expect(400)).body.error.code).toBe('BAD_REQUEST');
  });

  it('AT-CLI-05 aggregates recomputed: delivering and a counter sale raise orderCount / totalSpent / lastOrderAt; cancelling recomputes', async () => {
    const owner = await shop();
    const number = phone();
    const { order, product } = await newOrder(owner, { client: { name: 'Hana Ait', phone: number } });
    const id = order.client.id;
    await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);
    await db.sale.create({ data: { workspaceId: owner.workspaceId, number: 'VNT-T-1', clientId: id, status: 'completed', subtotal: 1000, total: 1000, amountPaid: 1000, paymentStatus: 'paid', paymentMethod: 'cash', soldAt: new Date(), createdById: owner.userId } as never });
    const second = await newOrder(owner, { client: { id } }, product);
    let c = await db.client.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ orderCount: 3, totalSpent: order.total + 1000 });
    await owner.post(`/orders/${second.order.id}/cancel`, { reason: 'other' }).expect(200);
    c = await db.client.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ orderCount: 2, cancelCount: 1, totalSpent: order.total + 1000 });
    const view = (await owner.get(`/clients/${id}`).expect(200)).body.data;
    // UX-003 (tester report 2026-10-19): « DA dépensés » = delivered orders + counter sales, both shown in the sheet
    expect(view.metrics).toMatchObject({ orders: 2, delivered: 1, cancels: 1, spent: order.total + 1000, ordersSpent: order.total, sales: 1, salesSpent: 1000 });
    expect(view.recentOrders.map((o: any) => o.id)).toEqual([second.order.id, order.id]);
    expect(view.recentSales).toEqual([expect.objectContaining({ number: 'VNT-T-1', total: 1000, status: 'completed', paymentStatus: 'paid' })]);
    expect(view.actions[0]).toMatchObject({ key: 'open', primary: true });
  });

  it('AT-ORD-14 a phone with 3 cancelled orders in 30 d ⇒ the next order is created `riskLevel=high`; manual flag survives the nightly recompute', async () => {
    const owner = await shop();
    const number = phone();
    let clientId = '';
    for (let i = 0; i < 3; i++) {
      const { order } = await newOrder(owner, { client: { name: 'Fares Rahmani', phone: number } });
      clientId = order.client.id;
      await owner.post(`/orders/${order.id}/cancel`, { reason: 'changed_mind' }).expect(200);
    }
    expect((await db.client.findUniqueOrThrow({ where: { id: clientId } })).riskLevel).toBe('high');
    const { order } = await newOrder(owner, { client: { name: 'Fares Rahmani', phone: number } });
    expect(order).toMatchObject({ riskLevel: 'high', client: { riskLevel: 'high' } });
    expect((await owner.get('/orders?riskLevel=high').expect(200)).body.data.map((o: any) => o.id)).toEqual([order.id]);
    // "Marquer risque" by hand on a clean client is kept by the nightly job
    const clean = await owner.post('/clients', { name: 'Imane Tazi', phone: phone() }).expect(201);
    await owner.post(`/clients/${clean.body.data.id}/risk`, { riskLevel: 'high' }).expect(200);
    const { ClientAggregatesService } = await import('../../src/modules/clients/client-aggregates.service');
    await app.app.get(ClientAggregatesService).recomputeAll();
    expect((await db.client.findUniqueOrThrow({ where: { id: clean.body.data.id } })).riskLevel).toBe('high');
  });

  it('AT-CLI-06 merge without confirm ⇒ 409 with the preview; with confirm the kept client gains orders, the merged one is soft-deleted; bulk tags on 5 clients', async () => {
    const owner = await shop();
    const admin = await asAdmin(app, owner.workspaceId);
    const op = await asOperator(app, owner.workspaceId);
    const keep = await newOrder(owner, { client: { name: 'Mehdi Larbi', phone: phone() } });
    const merge = await newOrder(owner, { client: { name: 'Mehdi L.', phone: phone() } });
    const body = { keepId: keep.order.client.id, mergeId: merge.order.client.id };
    expect((await op.post('/clients/merge', body).expect(403)).body.error.code).toBe('FORBIDDEN');
    const preview = await admin.post('/clients/merge', body).expect(409);
    expect(preview.body.error).toMatchObject({ code: 'CUSTOMER_MERGE_IRREVERSIBLE', details: { keep: { id: body.keepId, orderCount: 1 }, merge: { id: body.mergeId, orderCount: 1 } } });
    const merged = await admin.post('/clients/merge', { ...body, confirm: true }).expect(200);
    expect(merged.body.data).toMatchObject({ id: body.keepId, orderCount: 2, mergedFrom: [expect.objectContaining({ id: body.mergeId })] });
    expect(merged.body.data.phone2).toBe(merge.order.client.phone);
    expect(await db.client.findUniqueOrThrow({ where: { id: body.mergeId } })).toMatchObject({ mergedIntoId: body.keepId, deletedAt: expect.any(Date) });
    expect((await db.order.findUniqueOrThrow({ where: { id: merge.order.id } })).clientId).toBe(body.keepId);
    expect(await db.auditLog.count({ where: { action: 'client.merge', entityId: body.keepId } })).toBe(1);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await owner.post('/clients', { name: `Client ${'ABCDE'[i]}`, phone: phone(), tags: ['ancien'] }).expect(201)).body.data.id);
    const tags = await op.post('/clients/bulk/tags', { ids, add: ['promo'], remove: ['ancien'] }).expect(200);
    expect(tags.body.meta).toMatchObject({ ok: 5, failed: 0 });
    expect((await db.client.findMany({ where: { id: { in: ids } } })).every((c) => c.tags.join() === 'promo')).toBe(true);
  });

  it('04 §13 auto-block rule (OFF by default): N unclaimed parcels ⇒ CustomerBlock(source=auto_rule) + `customer.auto_blocked` to Owner / Admins', async () => {
    const owner = await shop();
    const number = phone();
    const returnUncollected = async () => {
      const { order } = await newOrder(owner, { client: { name: 'Bilal Mokrani', phone: number }, status: 'confirmed' });
      await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(200);
      await owner.post(`/orders/${order.id}/return`, { reason: 'unreachable', restoreStock: true }).expect(200);
      return order.client.id as string;
    };
    const clientId = await returnUncollected();
    expect(await db.customerBlock.count({ where: { clientId } })).toBe(0); // rule off
    await owner.put('/safety/rules', { riskAfterReturns: 5, autoBlockEnabled: true, autoBlockAfterUncollected: 2, handoffOnRisk: true }).expect(200);
    await returnUncollected();
    const block = await db.customerBlock.findFirstOrThrow({ where: { clientId } });
    expect(block).toMatchObject({ source: 'auto_rule', reason: 'uncollected', phone: number, unblockedAt: null });
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({ uncollectedCount: 2 });
    await drain(app, owner.workspaceId);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'customer_auto_blocked', userId: owner.userId } })).toBe(1);
    expect((await owner.get(`/clients/${clientId}`).expect(200)).body.data).toMatchObject({ blocked: true, pill: 'blocked', block: { source: 'auto_rule', unblockable: true } });
  });

  it('export (Admin+) ⇒ job ⇒ XLSX; bulk export of a selection', async () => {
    const owner = await shop();
    await owner.post('/clients', { name: 'Export Un', phone: phone() }).expect(201);
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/clients/export').expect(403)).body.error.code).toBe('FORBIDDEN');
    const r = await owner.get('/clients/export?format=csv').expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, r.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'clients', rows: 1, format: 'csv' } });
  });
});

describe('fee grid (DLV-01 / DLV-02 / DLV-09)', () => {
  it('AT-DLV-09 seed creates 69 rows from the default table; fill missing keeps custom rows; reset all overwrites; row reset', async () => {
    const owner = await asOwner(app);
    const op = await asOperator(app, owner.workspaceId);
    const empty = await owner.get('/delivery/fees').expect(200);
    expect(empty.body.data).toHaveLength(69);
    expect(empty.body.meta).toMatchObject({ missing: 69, custom: 0 });
    // loi 26-06: a new wilaya starts with the default fee of its parent (66 Messaad ← 17 Djelfa)
    expect(empty.body.data[65]).toMatchObject({ wilayaId: 66, code: '66', nameFr: 'Messaad', homePrice: 700, stopdeskPrice: 450, returnPrice: 300 });
    expect(empty.body.data[15]).toMatchObject({ wilayaId: 16, homePrice: 400, stopdeskPrice: 250, returnPrice: 200, isActive: false });
    expect((await op.post('/delivery/fees/seed', { overwrite: false }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const seeded = await owner.post('/delivery/fees/seed', { overwrite: false }).expect(200);
    expect(seeded.body.meta).toMatchObject({ written: 69, missing: 0 });
    await owner.put('/delivery/fees/16', { homePrice: 350, stopdeskPrice: 200, freeAbove: 8000 }).expect(200);
    await db.deliveryFeeRule.deleteMany({ where: { workspaceId: owner.workspaceId, wilayaId: 58 } });
    const filled = await owner.post('/delivery/fees/seed', { overwrite: false }).expect(200);
    expect(filled.body.meta).toMatchObject({ written: 1, custom: 1 });
    expect(filled.body.data[15]).toMatchObject({ homePrice: 350, source: 'custom', freeAbove: 8000 });
    const reset = await owner.post('/delivery/fees/seed', { overwrite: true }).expect(200);
    expect(reset.body.data[15]).toMatchObject({ homePrice: 400, source: 'default', freeAbove: null });
    expect((await owner.delete('/delivery/fees/16').expect(422)).body.error.code).toBe('FEE_RULE_NOT_FOUND');
    await owner.put('/delivery/fees/16', { homePrice: 500, stopdeskPrice: 300 }).expect(200);
    expect((await owner.delete('/delivery/fees/16').expect(200)).body.data).toMatchObject({ homePrice: 400, source: 'default' });
    expect(await db.auditLog.count({ where: { workspaceId: owner.workspaceId, entity: 'DeliveryFeeRule' } })).toBeGreaterThanOrEqual(4);
    // read + quote for every member
    expect((await op.get('/delivery/fees/quote?wilayaId=16&subtotal=1000').expect(200)).body.data).toMatchObject({ fee: 400, reason: 'grid', wilayaServed: true });
    expect((await op.get('/delivery/fees/quote?wilayaId=16&stopdesk=1').expect(200)).body.data).toMatchObject({ fee: 250, isStopdesk: true });
    expect((await op.get('/delivery/fees/quote?wilayaId=69').expect(200)).body.data).toMatchObject({ fee: 900, wilayaServed: true });
    expect((await op.get('/delivery/fees/quote?wilayaId=70').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await op.get('/delivery/fees/quote?wilayaId=99').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('a new workspace from sign-up gets its 69 rows (provisioning)', async () => {
    const { register } = await import('../support/m1');
    const user = await register(app);
    expect(await db.deliveryFeeRule.count({ where: { workspaceId: user.workspaceId } })).toBe(69);
    expect(idem()).toBeTruthy();
  });
});
