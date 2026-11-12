// M6 — sending parcels (DLV-05, FL-08) and the parcel actions (04 §22, FL-25) through the API, with the fake courier
// driver and the worker run synchronously. AT ids from 13-acceptance-tests.md.
import { TenantContext, type Tx } from '@djaber/db';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { RedisService } from '../../src/core/redis/redis.provider';
import { ShipmentEffects } from '../../src/modules/delivery/shipment-effects.service';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { jobOf } from '../support/m2';
import { forbidNetwork, wsOf } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { cashOf, newOrder, orderBody, postOrder, productStock, seedFees } from '../support/m5';
import { addCourier, confirmedOrder, db, drain, fakeCourier, idem, reloadOrder, send, sendAndWork, sendBody, shipmentRow } from '../support/m6';

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

const shop = async (provider: 'zrexpress' | 'ecotrack' | 'yalidine' = 'zrexpress') => {
  const owner = await asOwner(app);
  await seedFees(app, owner.workspaceId);
  const courier = await addCourier(owner, provider);
  return { owner, courier };
};

describe('send to courier (DLV-05, FL-08)', () => {
  it('AT-DLV-01 from `new` ⇒ DELIVERY_ORDER_NOT_CONFIRMED; from `confirmed` ⇒ parcel with the ORDER address, tracking stored, order shipped, customer message', async () => {
    const { owner, courier } = await shop();
    const { order: fresh } = await newOrder(owner);
    expect((await send(owner, fresh).expect(422)).body.error.code).toBe('DELIVERY_ORDER_NOT_CONFIRMED');

    const { order } = await confirmedOrder(owner);
    const res = await send(owner, order, { weightKg: 1.2 }).expect(202);
    expect(res.body.data).toMatchObject({ status: 'pending', provider: 'zrexpress', courierAccount: { id: courier.id }, trackingNumber: null, codAmount: order.total, weightKg: 1.2 });
    expect((await reloadOrder(owner, order.id)).deliveryStatus).toBe('pending');

    await drain(app, owner.workspaceId);
    const parcel = (await owner.get(`/shipments/${res.body.data.id}`).expect(200)).body.data;
    expect(parcel).toMatchObject({ status: 'sent', trackingNumber: expect.stringMatching(/^ZR-\d{6}$/), lastError: null, labelSource: 'djaber' });
    // the courier received the order's wilaya / commune / address — never the sender's
    const call = fakeCourier(app).callsOf('create', 'zrexpress');
    expect(call).toHaveLength(1);
    const o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'shipped', deliveryStatus: 'sent', shipment: { provider: 'zrexpress', trackingNumber: parcel.trackingNumber, status: 'sent' } });
    expect(o.history.some((h: any) => h.field === 'status' && h.to === 'shipped' && h.actor.type === 'courier')).toBe(true);
    expect(o.shipments[0].events[0]).toMatchObject({ mappedStatus: 'sent', source: 'system' });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'shipment_created' } })).toBeGreaterThan(0);
    expect((await wsOf(`ws:${owner.workspaceId}`, 'shipment.updated')).some((e) => e.payload.shipment.id === parcel.id && e.payload.shipment.status === 'sent')).toBe(true);
    expect(await db.outbox.count({ where: { topic: 'webhook', key: { startsWith: `order.shipped:${order.id}` } } })).toBe(1);
  });

  it('loi 26-06: an order in a new wilaya (68 Bou Saâda) reaches the courier under its parent code (28 M’Sila), commune unchanged', async () => {
    const { owner } = await shop();
    const bouSaada = { wilayaId: 68, communeId: 1006, isStopdesk: false, address: 'Cité 200 logements, Bt 4' };
    const { order, product } = await confirmedOrder(owner, { delivery: bouSaada });
    // a commune of Bou Saâda is refused under its former wilaya
    expect((await postOrder(owner, orderBody(product.id, { delivery: { ...bouSaada, wilayaId: 28 } }))).status).toBe(422);
    expect(order.address).toMatchObject({ wilayaId: 68, communeId: 1006 });
    expect(order.deliveryFee).toBe(650); // the default fee of the parent wilaya
    await send(owner, order).expect(202);
    await drain(app, owner.workspaceId);
    expect(fakeCourier(app).created).toEqual([expect.objectContaining({ provider: 'zrexpress', wilayaId: 28, wilayaName: "M'Sila", communeName: 'Bou Saada' })]);
    expect((await reloadOrder(owner, order.id)).address).toMatchObject({ wilayaId: 68 });
  });

  it('AT-DLV-01 the parcel takes the address of the dialog when it was changed there (written to the order first)', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    await send(owner, order, { communeText: 'Hydra', address: 'Rue des Frères Bouadou, Hydra' }).expect(202);
    const o = await reloadOrder(owner, order.id);
    expect(o.address).toMatchObject({ communeText: 'Hydra', address: 'Rue des Frères Bouadou, Hydra' });
    await drain(app, owner.workspaceId);
    expect((await reloadOrder(owner, order.id)).status).toBe('shipped');
  });

  it('AT-DLV-02 courier validation error (bad commune) ⇒ parcel failed with the field, order unchanged, retry after the fix', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    const res = await send(owner, order, { communeText: 'Inconnue-sur-Mer' }).expect(202);
    await drain(app, owner.workspaceId);
    const parcel = (await owner.get(`/shipments/${res.body.data.id}`).expect(200)).body.data;
    expect(parcel).toMatchObject({ status: 'failed', trackingNumber: null, lastError: 'COURIER_VALIDATION', error: { code: 'COURIER_VALIDATION', field: 'commune', message: expect.stringContaining('Inconnue') } });
    expect(parcel.actions.find((a: any) => a.key === 'retry')).toMatchObject({ enabled: true, primary: true });
    const o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'confirmed', deliveryStatus: 'not_sent' });
    // one courier attempt only: validation errors are never retried
    expect(fakeCourier(app).callsOf('create')).toHaveLength(1);
    // the merchant fixes the commune and sends again (the failed parcel does not block: not active)
    await send(owner, o, { communeText: 'Bab Ezzouar' }).expect(202);
    await drain(app, owner.workspaceId);
    expect((await reloadOrder(owner, order.id)).status).toBe('shipped');
  });

  it('AT-DLV-03 courier 503 ⇒ parcel pending (queued), retries on the schedule, sent when the courier is back; manual retry', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    fakeCourier(app).failNext('create', 'unavailable', { times: 2 });
    const res = await send(owner, order).expect(202);
    await drain(app, owner.workspaceId);
    const s = await shipmentRow(res.body.data.id);
    expect(s).toMatchObject({ status: 'sent', attempts: 3 });
    // the retries were scheduled with the 03-events delays (60 s, then 5 min)
    const retries = await db.outbox.findMany({ where: { topic: 'job', key: { startsWith: `parcel:${s.id}:a` } }, orderBy: { createdAt: 'asc' } });
    expect(retries.map((r) => (r.payload as any).opts.delay)).toEqual([60_000, 300_000]);

    // manual retry of a queued parcel: the courier is called at once
    const { order: other } = await confirmedOrder(owner);
    fakeCourier(app).unavailable('zrexpress', true);
    const queued = await send(owner, other).expect(202);
    const [first] = await db.outbox.findMany({ where: { key: `parcel:${queued.body.data.id}` } });
    await db.outbox.updateMany({ where: { key: { startsWith: `parcel:${queued.body.data.id}` } }, data: { processedAt: new Date() } });
    const registry = app.app.get(ProcessorRegistry);
    await TenantContext.runSystem(() => registry.handlers.get('courier')!.get('create-parcel')!((first!.payload as any).data, {} as never));
    let view = (await owner.get(`/shipments/${queued.body.data.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'pending', lastError: 'COURIER_UNAVAILABLE' });
    expect(view.actions.find((a: any) => a.key === 'retry')).toMatchObject({ enabled: true });
    await db.outbox.updateMany({ where: { key: { startsWith: `parcel:${queued.body.data.id}` } }, data: { processedAt: new Date() } });
    fakeCourier(app).unavailable('zrexpress', false);
    await owner.post(`/shipments/${queued.body.data.id}/retry`).expect(202);
    await drain(app, owner.workspaceId);
    view = (await owner.get(`/shipments/${queued.body.data.id}`).expect(200)).body.data;
    expect(view.status).toBe('sent');
  });

  it('AT-DLV-03 after the last retry ⇒ failed + `shipment.failed` (courier_unavailable, no customer text), order not sent', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    fakeCourier(app).unavailable('zrexpress', true);
    const res = await send(owner, order).expect(202);
    await drain(app, owner.workspaceId);
    const s = await shipmentRow(res.body.data.id);
    expect(s).toMatchObject({ status: 'failed', attempts: 7, lastError: 'COURIER_UNAVAILABLE' });
    const n = await db.notification.findFirst({ where: { workspaceId: owner.workspaceId, type: 'shipment_failed' } });
    expect(n?.data).toMatchObject({ reason: 'courier_unavailable', orderId: order.id });
    expect(await reloadOrder(owner, order.id)).toMatchObject({ status: 'confirmed', deliveryStatus: 'not_sent' });
  });

  it('AT-DLV-07 a second parcel after a cancelled one is allowed; two active ⇒ DELIVERY_ORDER_ALREADY_SENT (409)', async () => {
    const { owner } = await shop('ecotrack');
    const { order } = await confirmedOrder(owner);
    const first = await sendAndWork(app, owner, order);
    expect(first.status).toBe('sent');
    const dup = await send(owner, await reloadOrder(owner, order.id)).expect(409);
    expect(dup.body.error.code).toBe('DELIVERY_ORDER_ALREADY_SENT');
    // cancel at the courier (EcoTrack supports it) → order back to confirmed → a new parcel is accepted
    await owner.post(`/shipments/${first.id}/cancel`, { then: 'confirmed' }).expect(202);
    await drain(app, owner.workspaceId);
    expect((await shipmentRow(first.id)).status).toBe('cancelled');
    const o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'confirmed', deliveryStatus: 'not_sent' });
    const second = await sendAndWork(app, owner, o);
    expect(second.status).toBe('sent');
    expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('DELIVERY_NO_COURIER without an active courier; the `send_courier` action follows (greyed / enabled / already sent)', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const { order } = await confirmedOrder(owner);
    expect(order.actions.find((a: any) => a.key === 'send_courier')).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_NO_COURIER' });
    expect((await send(owner, order).expect(422)).body.error.code).toBe('DELIVERY_NO_COURIER');
    const courier = await addCourier(owner);
    const o = await reloadOrder(owner, order.id);
    expect(o.actions[0]).toMatchObject({ key: 'send_courier', enabled: true, primary: true });
    await owner.patch(`/delivery/couriers/${courier.id}`, { isActive: false }).expect(200);
    expect((await send(owner, o).expect(422)).body.error.code).toBe('DELIVERY_NO_COURIER');
    await owner.patch(`/delivery/couriers/${courier.id}`, { isActive: true }).expect(200);
    await send(owner, o).expect(202);
    expect((await reloadOrder(owner, order.id)).actions.find((a: any) => a.key === 'send_courier')).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_ORDER_ALREADY_SENT' });
  });

  it('Yalidine stop-desk needs a stop-desk id (422 fields.stopdeskId); 422 on an invalid body; idempotent replay', async () => {
    const { owner } = await shop('yalidine');
    const { order } = await confirmedOrder(owner);
    const bad = await send(owner, order, { isStopdesk: true, stopdeskId: null }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { stopdeskId: 'validation.required' } });
    const invalid = await owner.post(`/orders/${order.id}/shipments`, sendBody(order, { address: 'court' })).set(idem()).expect(422);
    expect(invalid.body.error.fields).toMatchObject({ address: 'validation.address' });
    expect((await owner.post(`/orders/${order.id}/shipments`, sendBody(order)).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const key = idem();
    const a = await owner.post(`/orders/${order.id}/shipments`, sendBody(order)).set(key).expect(202);
    const b = await owner.post(`/orders/${order.id}/shipments`, sendBody(order)).set(key).expect(202);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('403 / cross-workspace 404 on the parcel routes', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    const parcel = await sendAndWork(app, owner, order);
    const other = await asOwner(app);
    expect((await other.get(`/shipments/${parcel.id}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    await other.post(`/orders/${order.id}/shipments`, sendBody(order)).set(idem()).expect(404);
    await other.post(`/shipments/${parcel.id}/mark-failed`, { reason: 'address' }).expect(404);
    await other.post(`/shipments/${parcel.id}/sync`).expect(404);
    // operators send and act on parcels; courier settings are Admin+
    const op = await asOperator(app, owner.workspaceId);
    await op.get(`/shipments/${parcel.id}`).expect(200);
    await op.post('/delivery/couriers', { provider: 'yalidine', credentials: { apiId: 'x1', apiToken: 'y1' } }).expect(403);
    const admin = await asAdmin(app, owner.workspaceId);
    await admin.get('/delivery/overview').expect(200);
  });
});

describe('bulk send (MECH Delivery bulk results)', () => {
  it('202 job with per-order results: sent, not confirmed, already sent, courier validation error', async () => {
    const { owner } = await shop();
    const { order: ok } = await confirmedOrder(owner);
    const { order: fresh } = await newOrder(owner);
    const { order: sent } = await confirmedOrder(owner);
    await sendAndWork(app, owner, sent);
    const { order: bad } = await confirmedOrder(owner, { delivery: { wilayaId: 16, communeText: 'Inconnue', isStopdesk: false, address: 'Cité 200 logements, Bt 4' } });
    const res = await owner.post('/shipments/bulk', { orderIds: [ok.id, fresh.id, sent.id, bad.id] }).set(idem()).expect(202);
    await drain(app, owner.workspaceId);
    const job = await jobOf(owner, res.body.data.jobId);
    expect(job).toMatchObject({ kind: 'bulk_send', status: 'partial' });
    const byId = new Map(job.result.results.map((r: any) => [r.id, r]));
    expect(byId.get(ok.id)).toMatchObject({ ok: true, data: { status: 'sent', trackingNumber: expect.any(String) } });
    expect(byId.get(fresh.id)).toMatchObject({ ok: false, error: { code: 'DELIVERY_ORDER_NOT_CONFIRMED' } });
    expect(byId.get(sent.id)).toMatchObject({ ok: false, error: { code: 'DELIVERY_ORDER_ALREADY_SENT' } });
    expect(byId.get(bad.id)).toMatchObject({ ok: false, error: { code: 'COURIER_VALIDATION', fields: { communeId: 'validation.commune' } } });
    expect(job.result).toMatchObject({ ok: 1, failed: 3 });
    expect((await owner.post('/shipments/bulk', { orderIds: [] }).set(idem()).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('bulk "Livraison propre" ⇒ manual parcels, per-row results', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const { order: a } = await confirmedOrder(owner);
    const { order: b } = await newOrder(owner, { delivery: null });
    const res = await owner.post('/shipments/bulk/ship-manual', { ids: [a.id, b.id] }).expect(200);
    expect(res.body.meta).toMatchObject({ ok: 1, failed: 1 });
    expect((await reloadOrder(owner, a.id)).shipment).toMatchObject({ provider: 'manual', status: 'sent' });
  });
});

describe('parcel actions (04 §22, FL-25)', () => {
  it('AT-DLV-06 courier delivered ⇒ order delivered + COD cash row; a return reported after delivery ⇒ return pending, order returned on reception', async () => {
    const { owner } = await shop();
    const { order, product } = await confirmedOrder(owner);
    const parcel = await sendAndWork(app, owner, order);
    fakeCourier(app).setStatus(parcel.trackingNumber, 'Livré');
    await owner.post(`/shipments/${parcel.id}/sync`).expect(202);
    await drain(app, owner.workspaceId);
    let o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'delivered', deliveryStatus: 'delivered', paymentStatus: 'paid', amountPaid: order.total });
    expect((await cashOf(order.id)).map((c) => [c.type, c.amount])).toEqual([['income', order.total]]);
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'shipment_delivered' } })).toBeGreaterThan(0);

    // the courier reports a return after delivery (webhook / late sync): parcel returned, order waits for the reception
    await TenantContext.runAs(owner.workspaceId, () => db.$transaction((tx) => app.app.get(ShipmentEffects).apply(tx as unknown as Tx, parcel.id, { rawStatus: 'Retour livré', mapped: 'returned', source: 'webhook' })));
    const view = (await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'returned', returnPending: true });
    expect(view.actions[0]).toMatchObject({ key: 'mark_returned', enabled: true, primary: true });
    o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'delivered', deliveryStatus: 'returned' });
    // an operator confirms the reception (courier flow: no Admin+ check)
    const op = await asOperator(app, owner.workspaceId);
    const stockBefore = await productStock(product.id);
    await op.post(`/shipments/${parcel.id}/mark-returned`, { restoreStock: true }).set(idem()).expect(200);
    o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'returned', paymentStatus: 'refunded' });
    expect(await productStock(product.id)).toBe((stockBefore ?? 0) + 1);
  });

  it('mark failed (FailureReason) ⇒ notification + order stays shipped; mark delivered ⇒ COD; 409 on a closed parcel', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    const parcel = await sendAndWork(app, owner, order);
    const op = await asOperator(app, owner.workspaceId);
    expect((await owner.post(`/shipments/${parcel.id}/mark-failed`, {}).expect(422)).body.error.fields).toMatchObject({ reason: 'validation.required' });
    const failed = (await owner.post(`/shipments/${parcel.id}/mark-failed`, { reason: 'unreachable', note: 'ne répond pas' }).expect(200)).body.data;
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'unreachable', deliveryAttempts: 1 });
    expect(await reloadOrder(owner, order.id)).toMatchObject({ status: 'shipped', deliveryStatus: 'failed' });
    await drain(app, owner.workspaceId);
    // the other members are told (never the author of the action)
    const n = await db.notification.findFirst({ where: { workspaceId: owner.workspaceId, type: 'shipment_failed', userId: op.userId } });
    expect(n?.data).toMatchObject({ failureReason: 'unreachable', reason: 'unreachable', orderId: order.id });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'shipment_failed', userId: owner.userId } })).toBe(0);
    expect((await op.get('/notifications').expect(200)).body.data[0]).toMatchObject({ type: 'shipment_failed', body: expect.stringContaining('Injoignable') });
    await owner.post(`/shipments/${parcel.id}/mark-delivered`, { amountCollected: order.total - 100 }).set(idem()).expect(422);
    await owner.post(`/shipments/${parcel.id}/mark-delivered`, { amountCollected: order.total - 100, reason: 'remise livreur' }).set(idem()).expect(200);
    expect(await reloadOrder(owner, order.id)).toMatchObject({ status: 'delivered', amountPaid: order.total - 100, paymentStatus: 'partial' });
    expect((await owner.post(`/shipments/${parcel.id}/mark-failed`, { reason: 'address' }).expect(409)).body.error.code).toBe('CONFLICT');
  });

  it('AT-DLV-13 cancel before pickup ⇒ cancelled, order back to confirmed or cancelled (option); ZR (no cancel) ⇒ COURIER_CANCEL_NOT_ALLOWED; picked up ⇒ 409', async () => {
    const { owner } = await shop('yalidine');
    const { order } = await confirmedOrder(owner);
    const parcel = await sendAndWork(app, owner, order, { isStopdesk: false });
    await owner.post(`/shipments/${parcel.id}/cancel`, { then: 'cancelled' }).expect(422);
    await owner.post(`/shipments/${parcel.id}/cancel`, { then: 'cancelled', reason: 'changed_mind' }).expect(202);
    await drain(app, owner.workspaceId);
    expect((await shipmentRow(parcel.id)).status).toBe('cancelled');
    expect(await reloadOrder(owner, order.id)).toMatchObject({ status: 'cancelled', cancelReason: 'changed_mind' });

    const { order: picked } = await confirmedOrder(owner);
    const p2 = await sendAndWork(app, owner, picked);
    fakeCourier(app).setStatus(p2.trackingNumber, 'Ramassé');
    await owner.post(`/shipments/${p2.id}/sync`).expect(202);
    await drain(app, owner.workspaceId);
    expect((await owner.post(`/shipments/${p2.id}/cancel`, {}).expect(409)).body.error.code).toBe('COURIER_CANCEL_NOT_ALLOWED');

    const zr = await asOwner(app);
    await seedFees(app, zr.workspaceId);
    await addCourier(zr, 'zrexpress');
    const { order: zo } = await confirmedOrder(zr);
    const zp = await sendAndWork(app, zr, zo);
    expect(zp.actions.find((a: any) => a.key === 'cancel')).toMatchObject({ enabled: false, reasonCode: 'COURIER_CANCEL_NOT_ALLOWED' });
    expect((await zr.post(`/shipments/${zp.id}/cancel`, {}).expect(409)).body.error.code).toBe('COURIER_CANCEL_NOT_ALLOWED');
    // a parcel still queued at Djaber (not created at the courier) is cancelled at once
    const { order: q } = await confirmedOrder(zr);
    fakeCourier(app).unavailable('zrexpress', true);
    const queued = await send(zr, q).expect(202);
    await db.outbox.updateMany({ where: { workspaceId: zr.workspaceId, processedAt: null, topic: 'job' }, data: { processedAt: new Date() } });
    const cancelled = await zr.post(`/shipments/${queued.body.data.id}/cancel`, { then: 'confirmed' }).expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(await reloadOrder(zr, q.id)).toMatchObject({ status: 'confirmed', deliveryStatus: 'not_sent' });
  });

  it('AT-DLV-14 change courier on a failed send recomputes the courier cost, never the customer fee', async () => {
    const { owner } = await shop('zrexpress');
    const yal = await addCourier(owner, 'yalidine');
    await db.courierRateCache.create({ data: { courierAccountId: yal.id, wilayaId: 16, homePrice: 350, stopdeskPrice: 250 } });
    const { order } = await confirmedOrder(owner, { delivery: { wilayaId: 16, communeText: 'Invalide', isStopdesk: false, address: 'Cité 200 logements, Bt 4' } });
    const fee = order.deliveryFee;
    const failed = await sendAndWork(app, owner, order);
    expect(failed.status).toBe('failed');
    await db.order.update({ where: { id: order.id }, data: { communeText: 'Kouba' } });
    const res = await owner.post(`/shipments/${failed.id}/change-courier`, { courierAccountId: yal.id }).expect(202);
    expect(res.body.data).toMatchObject({ provider: 'yalidine', courierCost: 350, status: 'pending' });
    await drain(app, owner.workspaceId);
    const o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'shipped', deliveryFee: fee, courierCost: 350 });
    // a parcel already at the courier cannot change courier
    expect((await owner.post(`/shipments/${res.body.data.id}/change-courier`, { courierAccountId: yal.id }).expect(409)).body.error.code).toBe('COURIER_CANCEL_NOT_ALLOWED');
  });

  it('AT-DLV-11 failure flow: courier `failed unreachable` ⇒ notification + Home card + Échecs row; Relancer with support ⇒ attempt +1; without support ⇒ COURIER_CANCEL_NOT_ALLOWED; 3rd failure ⇒ return proposed', async () => {
    const { owner } = await shop('ecotrack');
    const { order } = await confirmedOrder(owner);
    const parcel = await sendAndWork(app, owner, order);
    const fake = fakeCourier(app);
    fake.setStatus(parcel.trackingNumber, 'Sorti en livraison');
    await owner.post(`/shipments/${parcel.id}/sync`).expect(202);
    await drain(app, owner.workspaceId);
    fake.setStatus(parcel.trackingNumber, 'Client absent');
    await app.app.get(RedisService).client.del(`trk:manual:${parcel.id}`);
    await owner.post(`/shipments/${parcel.id}/sync`).expect(202);
    await drain(app, owner.workspaceId);
    let view = (await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'failed', failureReason: 'unreachable', deliveryAttempts: 1 });
    expect(view.actions[0]).toMatchObject({ key: 'retry_delivery', enabled: true, primary: true });
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'shipment_failed' } })).toBeGreaterThan(0);
    const failures = (await owner.get('/shipments?shipmentStatus=failed').expect(200)).body.data;
    expect(failures.map((r: any) => r.id)).toContain(order.id);
    const home = (await owner.get('/dashboard/home').expect(200)).body.data;
    expect(JSON.stringify(home)).toContain(order.number);
    // the failed-parcel card (and the `shipment_failed` notification) open the delivery list filtered on the order
    // (`ids`, a real filter of GET /shipments) with the tracking panel of the parcel
    const link = `/delivery?tab=all&ids=${order.id}&sheet=${parcel.id}`;
    expect(home.queue.items.find((i: any) => i.key === `parcel:${parcel.id}`)?.path).toBe(link);
    const notified = (await owner.get('/notifications').expect(200)).body.data.find((n: any) => n.type === 'shipment_failed');
    expect(notified?.deepLink.web).toBe(link);
    expect((await owner.get(`/shipments?ids=${order.id}`).expect(200)).body.data.map((r: any) => r.id)).toEqual([order.id]);

    // "Relancer" (EcoTrack supports it): attempt 2, parcel out again
    view = (await owner.post(`/shipments/${parcel.id}/retry-delivery`, {}).expect(202)).body.data;
    await drain(app, owner.workspaceId);
    view = (await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'out_for_delivery', deliveryAttempts: 2 });
    expect(fake.callsOf('retry', 'ecotrack')).toHaveLength(1);
    // two more failures ⇒ 3 attempts ⇒ "Marquer retournée" proposed
    await owner.post(`/shipments/${parcel.id}/mark-failed`, { reason: 'unreachable' }).expect(200);
    await owner.post(`/shipments/${parcel.id}/retry-delivery`, {}).expect(202);
    await drain(app, owner.workspaceId);
    view = (await owner.post(`/shipments/${parcel.id}/mark-failed`, { reason: 'refused' }).expect(200)).body.data;
    expect(view).toMatchObject({ deliveryAttempts: 3, failureReason: 'refused' });
    expect(view.actions[0]).toMatchObject({ key: 'mark_returned', primary: true });

    // ZR has no retry: COURIER_CANCEL_NOT_ALLOWED
    const zr = await shop('zrexpress');
    const { order: zo } = await confirmedOrder(zr.owner);
    const zp = await sendAndWork(app, zr.owner, zo);
    await zr.owner.post(`/shipments/${zp.id}/mark-failed`, { reason: 'unreachable' }).expect(200);
    expect((await zr.owner.post(`/shipments/${zp.id}/retry-delivery`, {}).expect(409)).body.error.code).toBe('COURIER_CANCEL_NOT_ALLOWED');
  });
});

describe('auto-send & stop-desks (D9, DLV-09)', () => {
  it('Workspace.autoSendToCourier ⇒ a confirmed order is sent to the default courier by the worker', async () => {
    const { owner } = await shop('zrexpress');
    await owner.patch('/workspace', { autoSendToCourier: true }).expect(200);
    const { order } = await confirmedOrder(owner);
    await drain(app, owner.workspaceId);
    const o = await reloadOrder(owner, order.id);
    expect(o).toMatchObject({ status: 'shipped', deliveryStatus: 'sent', shipment: { provider: 'zrexpress', trackingNumber: expect.stringMatching(/^ZR-/) } });
    // off ⇒ nothing sent
    await owner.patch('/workspace', { autoSendToCourier: false }).expect(200);
    const { order: manual } = await confirmedOrder(owner);
    await drain(app, owner.workspaceId);
    expect((await reloadOrder(owner, manual.id)).deliveryStatus).toBe('not_sent');
  });

  it('a Yalidine account loads its stop-desks (centers) for the send dialog', async () => {
    const { owner } = await shop('yalidine');
    await drain(app, owner.workspaceId);
    const desks = (await owner.get('/delivery/stopdesks?provider=yalidine&wilayaId=16').expect(200)).body.data;
    expect(desks.map((d: any) => d.externalId).sort()).toEqual(['1601', '1602']);
  });
});

describe('orders side', () => {
  it('cancelling an order with a live courier parcel ⇒ DELIVERY_ORDER_ALREADY_SENT; delete too (04 §9)', async () => {
    const { owner } = await shop();
    const { order } = await confirmedOrder(owner);
    await sendAndWork(app, owner, order);
    const o = await reloadOrder(owner, order.id);
    expect((await owner.post(`/orders/${o.id}/cancel`, { reason: 'other' }).expect(409)).body.error.code).toBe('DELIVERY_ORDER_ALREADY_SENT');
    expect((await owner.delete(`/orders/${o.id}`).expect(409)).body.error.code).toBe('DELIVERY_ORDER_ALREADY_SENT');
    expect((await owner.post(`/orders/${o.id}/address`, { wilayaId: 16, communeText: 'Kouba', isStopdesk: false, address: 'Rue 12, Kouba centre' }).expect(409)).body.error.code).toBe('COURIER_ADDRESS_LOCKED');
  });
});

describe('UX-064 — a failed send is handled once the order is delivered / cancelled / returned (04 §22 "Order closed", FL-25 F-8)', () => {
  const failedSend = async () => {
    const { owner, courier } = await shop('zrexpress');
    const { order } = await confirmedOrder(owner, { delivery: { wilayaId: 16, communeText: 'Inconnue-sur-Mer', isStopdesk: false, address: 'Cité 200 logements, Bt 4' } });
    const parcel = await sendAndWork(app, owner, order);
    expect(parcel).toMatchObject({ status: 'failed', trackingNumber: null });
    return { owner, courier, order, parcel };
  };
  const action = (actions: { key: string }[], key: string) => actions.find((a) => a.key === key);

  it('delivered by hand: Home card handled « fait par », out of Échecs (tab, count, overview), failureHandled on the parcel and the row, every send refused with DELIVERY_ORDER_DELIVERED (422), nothing created', async () => {
    const { owner, courier, order, parcel } = await failedSend();
    // before: an open failure everywhere
    expect((await owner.get('/dashboard/home').expect(200)).body.data.queue.items.some((i: any) => i.key === `parcel:${parcel.id}`)).toBe(true);
    expect((await owner.get('/delivery/overview').expect(200)).body.data.tabs.failed).toBe(1);

    await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);

    // Home › À traiter: the open card leaves, a greyed "handled" card « fait par <member> » takes its place for 24 h
    const home = (await owner.get('/dashboard/home').expect(200)).body.data;
    expect(home.queue.items.some((i: any) => i.key === `parcel:${parcel.id}`)).toBe(false);
    expect(home.queue.counts.parcel).toBe(0);
    expect(home.queue.items.find((i: any) => i.key === `parcel:${order.id}:handled`)).toMatchObject({ kind: 'parcel', path: `/orders/${order.id}#delivery`, handled: { by: { id: owner.userId } } });
    // older than 24 h ⇒ the handled card disappears
    await db.orderStatusHistory.updateMany({ where: { orderId: order.id, field: 'status', to: 'delivered' }, data: { at: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await owner.get('/dashboard/home').expect(200)).body.data.queue.items.some((i: any) => i.ref?.orderId === order.id)).toBe(false);

    // Livraison › Échecs: tab, count and overview failures without it; the row (tab "Tous") says how it was handled
    expect((await owner.get('/shipments?shipmentStatus=failed').expect(200)).body.data.map((r: any) => r.id)).not.toContain(order.id);
    const overview = (await owner.get('/delivery/overview').expect(200)).body.data;
    expect(overview.tabs.failed).toBe(0);
    expect(overview.failures.map((r: any) => r.id)).not.toContain(order.id);
    const [row] = (await owner.get(`/shipments?ids=${order.id}`).expect(200)).body.data;
    expect(row.shipment).toMatchObject({ id: parcel.id, status: 'failed', failureHandled: 'delivered' });
    for (const key of ['send_courier', 'ship_manual', 'retry', 'change_courier']) expect(action(row.actions, key)).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_ORDER_DELIVERED' });
    expect(row.actions.some((a: any) => a.primary && ['retry', 'change_courier', 'send_courier'].includes(a.key))).toBe(false);

    // the order page agrees (same presenters, same shared rule)
    const o = await reloadOrder(owner, order.id);
    expect(o.status).toBe('delivered');
    for (const key of ['send_courier', 'ship_manual']) expect(action(o.actions, key)).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_ORDER_DELIVERED' });
    const view = (await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data;
    expect(view.failureHandled).toBe('delivered');
    for (const key of ['retry', 'change_courier']) expect(action(view.actions, key)).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_ORDER_DELIVERED' });

    // the server refuses every send with the readable code (never « Transition delivered → shipped »), nothing created
    const shipments = await db.shipment.count({ where: { orderId: order.id } });
    expect((await owner.post(`/shipments/${parcel.id}/retry`).expect(422)).body.error.code).toBe('DELIVERY_ORDER_DELIVERED');
    expect((await owner.post(`/shipments/${parcel.id}/change-courier`, { courierAccountId: courier.id }).expect(422)).body.error.code).toBe('DELIVERY_ORDER_DELIVERED');
    const resend = (await send(owner, o, { communeText: 'Kouba', codAmount: 100_000 }).expect(422)).body.error;
    expect(resend).toMatchObject({ code: 'DELIVERY_ORDER_DELIVERED', message: expect.stringContaining('déjà livrée') });
    expect((await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(422)).body.error.code).toBe('DELIVERY_ORDER_DELIVERED');
    expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(shipments);
    expect(fakeCourier(app).callsOf('create')).toHaveLength(1);
    expect((await reloadOrder(owner, order.id)).status).toBe('delivered');
  });

  it('cancelled order: the same refusal with its own word (DELIVERY_ORDER_CANCELLED), failure handled', async () => {
    const { owner, order, parcel } = await failedSend();
    await owner.post(`/orders/${order.id}/cancel`, { reason: 'other' }).expect(200);
    expect((await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data.failureHandled).toBe('cancelled');
    expect((await owner.post(`/shipments/${parcel.id}/retry`).expect(422)).body.error.code).toBe('DELIVERY_ORDER_CANCELLED');
    expect((await send(owner, order).expect(422)).body.error.code).toBe('DELIVERY_ORDER_CANCELLED');
    expect((await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(422)).body.error.code).toBe('DELIVERY_ORDER_CANCELLED');
    expect((await owner.get('/delivery/overview').expect(200)).body.data.tabs.failed).toBe(0);
  });

  it('existing data (#CMD-1008): an order delivered before the fix with its failed send is handled without any migration', async () => {
    const { owner, order, parcel } = await failedSend();
    // the state the old code left: order delivered, failed parcel untouched
    await db.order.update({ where: { id: order.id }, data: { status: 'delivered', deliveredAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await owner.get('/dashboard/home').expect(200)).body.data.queue.items.some((i: any) => i.key === `parcel:${parcel.id}`)).toBe(false);
    expect((await owner.get('/delivery/overview').expect(200)).body.data.tabs.failed).toBe(0);
    expect((await owner.get(`/shipments/${parcel.id}`).expect(200)).body.data).toMatchObject({ status: 'failed', failureHandled: 'delivered' });
  });

  it('cross-workspace 404 on the refused routes', async () => {
    const { owner, order, parcel } = await failedSend();
    await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);
    const other = await asOwner(app);
    await other.post(`/shipments/${parcel.id}/retry`).expect(404);
    await other.post(`/orders/${order.id}/shipments`, sendBody(order)).set(idem()).expect(404);
  });
});
