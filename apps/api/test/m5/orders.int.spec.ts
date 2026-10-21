// M5 — orders: numbering, creation, status machine with OrderEffects (stock / cash / aggregates), calls, callbacks,
// payments, address, delete, concurrency, bulk, export, print. AT ids from 13-acceptance-tests.md (API side).
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { createProduct, drain, jobOf } from '../support/m2';
import { forbidNetwork, wsOf } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { address, cashOf, db, idem, movementsOf, newOrder, orderBody, phone, postOrder, productStock, seedFees, status } from '../support/m5';

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
const reload = async (actor: Actor, id: string) => (await actor.get(`/orders/${id}`).expect(200)).body.data as Record<string, any>;

describe('creation (ORD-01 / ORD-02, 04 §3 "Order created")', () => {
  it('AT-ORD-16 first order CMD-1001, legacy ORD-… numbers kept, counter continues; orderedAt −2 d accepted, +2 d refused', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 20 });
    const first = await postOrder(owner, orderBody(p.id)).expect(201);
    expect(first.body.data.number).toBe('CMD-1001');
    // a migrated V1 order keeps its legacy number
    const client = await db.client.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    await db.order.create({ data: { workspaceId: owner.workspaceId, number: 'ORD-20260101-0042', clientId: client.id, source: 'manual', clientName: 'V1', clientPhone: client.phone!, subtotal: 1, total: 1 } });
    const second = await postOrder(owner, orderBody(p.id, { orderedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() })).expect(201);
    expect(second.body.data.number).toBe('CMD-1002');
    const future = await postOrder(owner, orderBody(p.id, { orderedAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })).expect(422);
    expect(future.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { orderedAt: 'validation.date' } });
  });

  it('decrements stock with an `out` movement, snapshots prices, recomputes the client, emits WS + webhook + Sheets rows', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 4500, stock: 5, costPrice: 3000 });
    const res = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 2 }] })).expect(201);
    const o = res.body.data;
    expect(o).toMatchObject({ status: 'new', source: { source: 'manual', user: { id: owner.userId } }, subtotal: 9000, deliveryFee: 400, total: 9400, paymentStatus: 'unpaid', confirmationStatus: 'pending', feeExplanation: 'GRILLE ALGER · DOMICILE 400' });
    expect(o.items[0]).toMatchObject({ productName: p.name, unitPrice: 4500, costPrice: 3000, quantity: 2, total: 9000 });
    expect(await productStock(p.id)).toBe(3);
    expect((await movementsOf(o.id)).map((m) => [m.type, m.reason, m.quantity])).toEqual([['out', 'order_created', -2]]);
    const client = await db.client.findUniqueOrThrow({ where: { id: o.client.id } });
    expect(client).toMatchObject({ orderCount: 1, totalSpent: 0, source: 'manual' });
    expect((await wsOf(`ws:${owner.workspaceId}`, 'order.created')).some((e) => e.payload.order.id === o.id)).toBe(true);
    expect(await db.outbox.count({ where: { topic: 'webhook', key: { startsWith: `order.created:${o.id}` } } })).toBe(1);
    expect(await db.outbox.count({ where: { topic: 'sheets', key: { startsWith: `sheets:${o.id}` } } })).toBe(1);
    expect(o.history).toEqual([expect.objectContaining({ field: 'status', from: null, to: 'new', actor: expect.objectContaining({ type: 'user' }) })]);
    expect(o.actions[0]).toMatchObject({ key: 'confirm', primary: true, enabled: true });
  });

  it('AT-CAT-02 a service product (trackStock=false) never decrements; AT-CAT-03 a variant product needs its variant', async () => {
    const owner = await shop();
    const service = await createProduct(owner, { name: 'Retouche', price: 800, trackStock: false, stock: null });
    const o = await postOrder(owner, orderBody(service.id, { items: [{ productId: service.id, quantity: 3 }] })).expect(201);
    expect(await productStock(service.id)).toBeNull();
    expect(await movementsOf(o.body.data.id)).toHaveLength(0);
    const robe = await createProduct(owner, { name: 'Robe kabyle', price: 5000, variants: [{ name: 'M', price: 5000, stock: 4 }, { name: 'L', price: 5200, stock: 2 }] });
    const missing = await postOrder(owner, orderBody(robe.id)).expect(422);
    expect(missing.body.error).toMatchObject({ code: 'VARIANT_REQUIRED', fields: { 'items.0.variantId': 'validation.required' } });
    const l = robe.variants.find((v: any) => v.name === 'L');
    const ok = await postOrder(owner, orderBody(robe.id, { items: [{ productId: robe.id, variantId: l.id, quantity: 2 }] })).expect(201);
    expect(ok.body.data.items[0]).toMatchObject({ variantName: 'L', unitPrice: 5200 });
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: l.id } })).stock).toBe(0);
    expect(await productStock(robe.id)).toBe(4); // product stock = Σ active variants
    // stock is a conditional decrement: ORDER_INSUFFICIENT_STOCK on the line, nothing written
    const short = await postOrder(owner, orderBody(robe.id, { items: [{ productId: robe.id, variantId: l.id, quantity: 1 }] })).expect(422);
    expect(short.body.error).toMatchObject({ code: 'ORDER_INSUFFICIENT_STOCK', params: { product: 'Robe kabyle · L', available: 0 } });
    expect(await db.order.count({ where: { workspaceId: owner.workspaceId } })).toBe(2);
  });

  it('AT-ORD-17 confirmed without address ⇒ ORDER_ADDRESS_REQUIRED; with address ⇒ created confirmed with its history row', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 5 });
    expect((await postOrder(owner, orderBody(p.id, { status: 'confirmed', delivery: null })).expect(422)).body.error.code).toBe('ORDER_ADDRESS_REQUIRED');
    const ok = await postOrder(owner, orderBody(p.id, { status: 'confirmed' })).expect(201);
    expect(ok.body.data).toMatchObject({ status: 'confirmed', confirmationStatus: 'confirmed', confirmedAt: expect.any(String) });
    expect(ok.body.data.history[0]).toMatchObject({ field: 'status', from: null, to: 'confirmed' });
  });

  it('AT-ORD-09 fee from the grid, free above the threshold, inactive wilaya ⇒ WILAYA_NOT_SERVED, override Admin+ only', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const p = await createProduct(owner, { price: 3000, stock: 50 });
    await owner.put('/delivery/fees/16', { homePrice: 400, stopdeskPrice: 250 }).expect(200);
    await owner.patch('/workspace', { freeDeliveryThreshold: 5000, version: (await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).version }).expect(200);
    const stopdesk = await postOrder(owner, orderBody(p.id, { delivery: address({ isStopdesk: true, address: null, stopdeskId: 'SD-1' }) })).expect(201);
    expect(stopdesk.body.data.deliveryFee).toBe(250);
    const free = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 2 }] })).expect(201);
    expect(free.body.data).toMatchObject({ subtotal: 6000, deliveryFee: 0, total: 6000, feeExplanation: 'GRILLE ALGER · DOMICILE 400 → OFFERTE' });
    await owner.put('/delivery/fees/19', { homePrice: 600, stopdeskPrice: 400, isActive: false }).expect(200);
    const off = await postOrder(owner, orderBody(p.id, { delivery: address({ wilayaId: 19, communeText: 'Sétif' }) })).expect(422);
    expect(off.body.error.code).toBe('WILAYA_NOT_SERVED');
    const override = await postOrder(owner, orderBody(p.id, { delivery: address({ deliveryFee: 150 }) })).expect(201);
    expect(override.body.data).toMatchObject({ deliveryFee: 150, total: 3150, feeExplanation: 'GRILLE ALGER · DOMICILE 400 → 150 (MODIFIÉ)' });
    expect((await postOrder(op, orderBody(p.id, { delivery: address({ deliveryFee: 150 }) })).expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('AT-DLV-10 a commune of another wilaya is refused (validation.commune)', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 5 });
    const oran = await db.commune.findFirstOrThrow({ where: { wilayaId: 31 } });
    const bad = await postOrder(owner, orderBody(p.id, { delivery: address({ communeId: oran.id, communeText: null }) })).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { 'delivery.communeId': 'validation.commune' } });
    const alger = await db.commune.findFirstOrThrow({ where: { wilayaId: 16 } });
    await postOrder(owner, orderBody(p.id, { delivery: address({ communeId: alger.id, communeText: null }) })).expect(201);
  });

  it('Idempotency-Key required; a replay returns the same order and writes nothing twice', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 5 });
    expect((await owner.post('/orders', orderBody(p.id)).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const key = idem();
    const body = orderBody(p.id);
    const a = await owner.post('/orders', body).set(key).expect(201);
    const b = await owner.post('/orders', body).set(key).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await db.order.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect(await productStock(p.id)).toBe(4);
    expect((await owner.post('/orders', { ...body, notes: 'autre' }).set(key).expect(422)).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('AT-ORD-23 source badges and `source` filter', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    const list = await owner.get('/orders?source=manual').expect(200);
    expect(list.body.data.map((o: any) => o.id)).toEqual([order.id]);
    expect((await owner.get('/orders?source=api').expect(200)).body.data).toEqual([]);
    expect((await owner.get('/orders/stats').expect(200)).body.data.sourceMix).toMatchObject({ manual: 1, ai: 0 });
  });

  it('a blocked customer needs the explicit confirmation of the warning (04 §13)', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 5 });
    const number = phone();
    await owner.post('/safety/blocks', { phone: number, reason: 'fraud' }).expect(201);
    const refused = await postOrder(owner, orderBody(p.id, { client: { name: 'Client bloqué', phone: number } })).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'CUSTOMER_BLOCKED' });
    await postOrder(owner, orderBody(p.id, { client: { name: 'Client bloqué', phone: number }, confirm: true })).expect(201);
  });

  it('tester report 2026-10-20: no order for a client without a phone — the order gives the phone and completes the « À compléter » client; a phone of another client is refused', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 1000, stock: 5 });
    const placeholder = await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Amina Benali', isPlaceholder: true, source: 'ai' } });
    const refused = await postOrder(owner, orderBody(p.id, { client: { id: placeholder.id } })).expect(422);
    expect(refused.body.error.fields).toEqual({ 'client.phone': 'validation.required' });
    const taken = phone();
    await postOrder(owner, orderBody(p.id, { client: { name: 'Autre client', phone: taken } })).expect(201);
    const conflict = await postOrder(owner, orderBody(p.id, { client: { id: placeholder.id, phone: taken } })).expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'CLIENT_PHONE_EXISTS', fields: { 'client.phone': 'validation.phone_taken' } });
    const number = phone();
    const ok = await postOrder(owner, orderBody(p.id, { client: { id: placeholder.id, phone: number } })).expect(201);
    expect(ok.body.data.client).toMatchObject({ id: placeholder.id, phone: number });
    expect(await db.client.findUniqueOrThrow({ where: { id: placeholder.id } })).toMatchObject({ phone: number, isPlaceholder: false, name: 'Amina Benali' });
  });
});

describe('status machine and effects (04 §1.2, §3)', () => {
  it('AT-ORD-02 confirmed → delivered by an operator (self-delivery): COD ⇒ paid, one locked income row = total "(COD)"; client aggregates', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner, { status: 'confirmed' });
    const res = await status(op, order, 'delivered').expect(200);
    expect(res.body.data).toMatchObject({ status: 'delivered', deliveryStatus: 'delivered', paymentStatus: 'paid', amountPaid: order.total, remaining: 0, deliveredAt: expect.any(String) });
    const cash = await cashOf(order.id);
    expect(cash.map((c) => [c.type, c.category, c.amount, c.isAutomatic, c.sourceType])).toEqual([['income', 'order', order.total, true, 'payment_entry']]);
    expect(cash[0]!.description).toContain('(COD)');
    expect(await db.client.findUniqueOrThrow({ where: { id: order.client.id } })).toMatchObject({ totalSpent: order.total, orderCount: 1 });
    // never applied twice; a second delivered is refused by the matrix
    expect((await status(op, res.body.data, 'delivered').expect(422)).body.error.code).toBe('ORDER_INVALID_TRANSITION');
    expect(await db.outbox.count({ where: { topic: 'webhook', key: { startsWith: `order.delivered:${order.id}` } } })).toBe(1);
  });

  it('AT-ORD-05 cancel after a partial payment ⇒ amountPaid 0, automatic rows removed, manual rows kept, stock restored', async () => {
    const owner = await shop();
    const { order, product } = await newOrder(owner);
    const paid = await owner.post(`/orders/${order.id}/payments`, { amount: 1000, method: 'ccp' }).set(idem()).expect(200);
    expect(paid.body.data).toMatchObject({ amountPaid: 1000, paymentStatus: 'partial' });
    const manual = await db.cashTransaction.create({ data: { workspaceId: owner.workspaceId, type: 'income', amount: 50, category: 'other', description: 'pourboire', isAutomatic: false } });
    expect(await productStock(product.id)).toBe(9);
    const res = await owner.post(`/orders/${order.id}/cancel`, { reason: 'changed_mind', note: 'a changé d’avis' }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', amountPaid: 0, paymentStatus: 'unpaid', cancelReason: 'changed_mind', cancelNote: 'a changé d’avis', payments: [] });
    expect(await cashOf(order.id)).toHaveLength(0);
    expect(await db.cashTransaction.findUnique({ where: { id: manual.id } })).not.toBeNull();
    expect(await productStock(product.id)).toBe(10);
    expect((await movementsOf(order.id)).map((m) => [m.type, m.reason, m.quantity])).toEqual([['out', 'order_created', -1], ['return', 'order_cancelled', 1]]);
    expect((await owner.post(`/orders/${order.id}/cancel`, { reason: 'other' }).expect(422)).body.error.code).toBe('ORDER_TERMINAL');
    expect((await owner.post(`/orders/${order.id}/payments`, { amount: 100 }).set(idem()).expect(422)).body.error.code).toBe('ORDER_PAYMENT_LOCKED');
  });

  it('AT-ORD-06 returned ⇒ stock back with the return, income rows removed, expense `shipping` = grid returnPrice (D27); client returnCount', async () => {
    const owner = await shop();
    const { order, product } = await newOrder(owner, { status: 'confirmed' });
    const shipped = await owner.post(`/orders/${order.id}/ship-manual`, { trackingNumber: 'LIV-1' }).expect(200);
    expect(shipped.body.data).toMatchObject({ status: 'shipped', deliveryStatus: 'sent', shipments: [expect.objectContaining({ provider: 'manual', status: 'sent', trackingNumber: 'LIV-1' })] });
    const delivered = await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);
    expect(delivered.body.data.paymentStatus).toBe('paid');
    expect(await productStock(product.id)).toBe(9);
    const returned = await owner.post(`/orders/${order.id}/return`, { reason: 'refused', restoreStock: true }).expect(200);
    expect(returned.body.data).toMatchObject({ status: 'returned', deliveryStatus: 'returned', amountPaid: 0, paymentStatus: 'refunded', returnFee: 200 });
    expect(await productStock(product.id)).toBe(10);
    const cash = await cashOf(order.id);
    expect(cash.map((c) => [c.type, c.category, c.amount])).toEqual([['expense', 'shipping', 200]]);
    expect(await db.client.findUniqueOrThrow({ where: { id: order.client.id } })).toMatchObject({ returnCount: 1, totalSpent: 0, uncollectedCount: 1 });
    expect((await movementsOf(order.id)).map((m) => [m.type, m.reason])).toEqual([['out', 'order_created'], ['return', 'order_returned']]);
  });

  it('AT-ORD-28 return with restock unchecked ⇒ one `adjustment_out` / loss line (quantity 0), no `return` movement', async () => {
    const owner = await shop();
    const { order, product } = await newOrder(owner, { status: 'confirmed' });
    await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(200);
    const r = await owner.post(`/orders/${order.id}/return`, { reason: 'damaged', restoreStock: false, returnFee: 350 }).expect(200);
    expect(r.body.data.returnFee).toBe(350);
    expect(await productStock(product.id)).toBe(9);
    expect((await movementsOf(order.id)).map((m) => [m.type, m.reason, m.quantity])).toEqual([['out', 'order_created', -1], ['adjustment_out', 'loss', 0]]);
  });

  it('delivered → returned is Admin+ (operator 403)', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner);
    await owner.post(`/orders/${order.id}/deliver`, {}).expect(200);
    expect((await op.post(`/orders/${order.id}/return`, { reason: 'refused', restoreStock: true }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await (await asAdmin(app, owner.workspaceId)).post(`/orders/${order.id}/return`, { reason: 'refused', restoreStock: true }).expect(200);
  });

  it('AT-ORD-26 "Confirmée (retour arrière)" from shipped before pickup; after a picked_up event refused; effective date back-dates deliveredAt', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner, { status: 'confirmed' });
    let o = (await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(200)).body.data;
    o = (await status(owner, o, 'confirmed').expect(200)).body.data;
    expect(o).toMatchObject({ status: 'confirmed', deliveryStatus: 'not_sent' });
    expect(o.shipments[0]).toMatchObject({ status: 'cancelled' });
    o = (await owner.post(`/orders/${order.id}/ship-manual`, {}).expect(200)).body.data;
    await db.shipment.updateMany({ where: { orderId: order.id, status: 'sent' }, data: { status: 'picked_up' } });
    expect((await status(owner, o, 'confirmed').expect(422)).body.error).toMatchObject({ code: 'ORDER_INVALID_TRANSITION', params: { from: 'shipped', to: 'confirmed' } });
    const effectiveAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    o = (await status(owner, await reload(owner, order.id), 'delivered', { effectiveAt }).expect(200)).body.data;
    expect(o.deliveredAt).toBe(effectiveAt);
    expect(o.history[0]).toMatchObject({ field: 'paymentStatus' });
    expect(o.history.find((h: any) => h.field === 'status' && h.to === 'delivered')).toMatchObject({ effectiveAt });
    const [cash] = await cashOf(order.id);
    expect(cash!.date.toISOString()).toBe(effectiveAt); // the day is open: the cash row is dated the effective day
    expect((await status(owner, o, 'returned', { effectiveAt: new Date(Date.now() - 9 * 86_400_000).toISOString() }).expect(422)).body.error.fields).toEqual({ effectiveAt: 'validation.date' });
  });

  it('AT-ORD-27 manual delivered with 8 000 of 8 300 + reason ⇒ partial, cash row 8 000; without reason ⇒ 422', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 7900, stock: 3 });
    const { order } = await newOrder(owner, {}, p);
    expect(order.total).toBe(8300);
    expect((await owner.post(`/orders/${order.id}/deliver`, { amountCollected: 8000 }).expect(422)).body.error.fields).toEqual({ reason: 'validation.required' });
    const r = await owner.post(`/orders/${order.id}/deliver`, { amountCollected: 8000, reason: 'remise livreur' }).expect(200);
    expect(r.body.data).toMatchObject({ status: 'delivered', amountPaid: 8000, paymentStatus: 'partial', remaining: 300 });
    expect((await cashOf(order.id)).map((c) => c.amount)).toEqual([8000]);
  });

  it('AT-ORD-07 delete: delivered ⇒ ORDER_DELETE_DELIVERED; shipped (manual parcel) ⇒ rollback then deleted; live courier parcel ⇒ DELIVERY_ORDER_ALREADY_SENT; audited', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const a = await newOrder(owner);
    await owner.post(`/orders/${a.order.id}/deliver`, {}).expect(200);
    expect((await owner.delete(`/orders/${a.order.id}`).expect(422)).body.error.code).toBe('ORDER_DELETE_DELIVERED');
    const b = await newOrder(owner, { status: 'confirmed', amountPaid: 500 });
    await owner.post(`/orders/${b.order.id}/ship-manual`, {}).expect(200);
    expect(await productStock(b.product.id)).toBe(9);
    expect((await op.delete(`/orders/${b.order.id}`).expect(403)).body.error.code).toBe('FORBIDDEN'); // AT-AUTH-09 on the real route
    expect((await owner.delete(`/orders/${b.order.id}?confirmNumber=CMD-9999`).expect(422)).body.error.fields).toEqual({ confirmNumber: 'validation.invalid' });
    await owner.delete(`/orders/${b.order.id}?confirmNumber=${b.order.number}`).expect(200);
    expect(await productStock(b.product.id)).toBe(10);
    expect(await cashOf(b.order.id)).toHaveLength(0);
    expect(await db.order.findUnique({ where: { id: b.order.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'order.delete', entityId: b.order.id } })).toBe(1);
    const c = await newOrder(owner, { status: 'confirmed' });
    await db.shipment.create({ data: { workspaceId: owner.workspaceId, orderId: c.order.id, provider: 'zrexpress', status: 'sent', publicTrackingToken: `t-${c.order.id}`, codAmount: c.order.total } });
    expect((await owner.delete(`/orders/${c.order.id}`).expect(409)).body.error.code).toBe('DELIVERY_ORDER_ALREADY_SENT');
    expect((await owner.post(`/orders/${c.order.id}/cancel`, { reason: 'other' }).expect(409)).body.error.code).toBe('DELIVERY_ORDER_ALREADY_SENT');
    expect((await owner.post(`/orders/${c.order.id}/address`, address()).expect(409)).body.error.code).toBe('COURIER_ADDRESS_LOCKED'); // AT-ORD-29
  });

  it('AT-ORD-08 two users change the status with the same version ⇒ one 409 CONFLICT, no double side effect', async () => {
    const owner = await shop();
    const admin = await asAdmin(app, owner.workspaceId);
    const { order, product } = await newOrder(owner);
    const [r1, r2] = await Promise.all([status(owner, order, 'cancelled', { reason: 'other' }), status(admin, order, 'cancelled', { reason: 'duplicate' })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const conflict = [r1, r2].find((r) => r.status === 409)!;
    expect(conflict.body.error).toMatchObject({ code: 'CONFLICT', details: { current: expect.objectContaining({ id: order.id, status: 'cancelled' }) } });
    expect(await productStock(product.id)).toBe(10);
    expect((await movementsOf(order.id)).filter((m) => m.type === 'return')).toHaveLength(1);
    // PATCH with a stale version
    const stale = await owner.patch(`/orders/${order.id}`, { notes: 'x', version: order.version }).expect(409);
    expect(stale.body.error.details.changedAt).toEqual(expect.any(String));
  });
});

describe('calls, callback, address, assignment, payments (04 §1.3, §1.4, §21)', () => {
  it('AT-ORD-03 call "rejected" on new ⇒ cancelled + stock restored + cash removed; on shipped ⇒ logged, unchanged, warning', async () => {
    const owner = await shop();
    const { order, product } = await newOrder(owner, { amountPaid: 300 });
    const r = await owner.post(`/orders/${order.id}/calls`, { result: 'rejected', notes: 'ne veut plus' }).expect(200);
    expect(r.body.data).toMatchObject({ status: 'cancelled', confirmationStatus: 'rejected', callAttempts: 1, amountPaid: 0 });
    expect(await productStock(product.id)).toBe(10);
    expect(await cashOf(order.id)).toHaveLength(0);
    const s = await newOrder(owner, { status: 'confirmed' });
    await owner.post(`/orders/${s.order.id}/ship-manual`, {}).expect(200);
    const w = await owner.post(`/orders/${s.order.id}/calls`, { result: 'rejected' }).expect(200);
    expect(w.body.meta.warnings).toEqual([expect.objectContaining({ code: 'ORDER_CALL_ON_TERMINAL' })]);
    expect(w.body.data).toMatchObject({ status: 'shipped', callAttempts: 1 });
  });

  it('AT-ORD-04 call "picked_up" without address ⇒ ORDER_ADDRESS_REQUIRED (nothing logged); with address ⇒ confirmed', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner, { delivery: null });
    expect((await owner.post(`/orders/${order.id}/calls`, { result: 'picked_up' }).expect(422)).body.error.code).toBe('ORDER_ADDRESS_REQUIRED');
    expect(await db.orderCall.count({ where: { orderId: order.id } })).toBe(0);
    await owner.post(`/orders/${order.id}/address`, address()).expect(200);
    const ok = await owner.post(`/orders/${order.id}/calls`, { result: 'picked_up' }).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'confirmed', confirmationStatus: 'confirmed', callAttempts: 1 });
  });

  it('AT-ORD-18 no_answer / busy / voicemail ⇒ no_answer, attempts +1, status unchanged', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    for (const [i, result] of (['no_answer', 'busy', 'voicemail'] as const).entries()) {
      const r = await owner.post(`/orders/${order.id}/calls`, { result }).expect(200);
      expect(r.body.data).toMatchObject({ status: 'new', confirmationStatus: 'no_answer', callAttempts: i + 1 });
    }
    expect((await owner.get(`/orders/${order.id}/calls`).expect(200)).body.data).toHaveLength(3);
    expect((await owner.get('/orders?confirmationStatus=no_answer&minCalls=3').expect(200)).body.data.map((o: any) => o.id)).toEqual([order.id]);
  });

  it('AT-ORD-25 wrong_number on new ⇒ cancelled "faux numéro" (fake), client risk high', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    const r = await owner.post(`/orders/${order.id}/calls`, { result: 'wrong_number' }).expect(200);
    expect(r.body.data).toMatchObject({ status: 'cancelled', confirmationStatus: 'wrong_number', cancelReason: 'fake' });
    expect((await db.client.findUniqueOrThrow({ where: { id: order.client.id } })).riskLevel).toBe('high');
  });

  it('AT-ORD-24 callback: past ⇒ ORDER_CALLBACK_IN_PAST; set ⇒ RAPPEL + `order.callback_due` to the assignee when due (once); a logged call clears it', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner, { assigneeId: op.userId });
    expect((await owner.post(`/orders/${order.id}/callback`, { at: new Date(Date.now() - 60_000).toISOString() }).expect(422)).body.error.code).toBe('ORDER_CALLBACK_IN_PAST');
    const at = new Date(Date.now() + 3600_000).toISOString();
    const set = await owner.post(`/orders/${order.id}/callback`, { at, note: 'après 16 h' }).expect(200);
    expect(set.body.data).toMatchObject({ confirmationStatus: 'callback', callbackAt: at });
    expect(set.body.data.actions.find((a: any) => a.key === 'callback')).toMatchObject({ enabled: true, shortcut: 'R' });
    // time passes: the scheduler emits once per (order, callbackAt)
    await db.order.update({ where: { id: order.id }, data: { callbackAt: new Date(Date.now() - 1000) } });
    const { OrderWorkflowService } = await import('../../src/modules/orders/order-workflow.service');
    const workflow = app.app.get(OrderWorkflowService);
    // the scheduler scans every workspace (other suites may leave due callbacks): this order is notified once whatever the runs
    expect(await workflow.remindDue()).toBeGreaterThanOrEqual(1);
    await workflow.remindDue();
    await drain(app, owner.workspaceId);
    const due = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'order_callback_due' } });
    expect(due.map((n) => n.userId)).toEqual([op.userId]);
    expect((await owner.get('/orders?callbackDue=true').expect(200)).body.data.map((o: any) => o.id)).toEqual([order.id]);
    const called = await owner.post(`/orders/${order.id}/calls`, { result: 'no_answer' }).expect(200);
    expect(called.body.data).toMatchObject({ callbackAt: null, confirmationStatus: 'no_answer' });
    // DELETE clears an explicit reminder
    await owner.post(`/orders/${order.id}/callback`, { at }).expect(200);
    expect((await owner.delete(`/orders/${order.id}/callback`).expect(200)).body.data).toMatchObject({ callbackAt: null, confirmationStatus: 'no_answer' });
  });

  it('AT-ORD-22 payment 300 of 1000 ⇒ partial; paymentStatus without amountPaid ⇒ 422; above the remaining ⇒ 422', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { price: 600, stock: 5 });
    const { order } = await newOrder(owner, {}, p);
    expect(order.total).toBe(1000);
    const bad = await owner.patch(`/orders/${order.id}`, { paymentStatus: 'paid', version: order.version }).expect(422);
    expect(bad.body.error.fields).toEqual({ amountPaid: 'validation.required' });
    const r = await owner.patch(`/orders/${order.id}`, { amountPaid: 300, version: order.version }).expect(200);
    expect(r.body.data).toMatchObject({ amountPaid: 300, paymentStatus: 'partial', remaining: 700 });
    expect((await owner.post(`/orders/${order.id}/payments`, { amount: 800 }).set(idem()).expect(422)).body.error.fields).toEqual({ amount: 'validation.range' });
    const full = await owner.post(`/orders/${order.id}/payments`, { amount: 700, method: 'transfer', reference: 'VIR-1' }).set(idem()).expect(200);
    expect(full.body.data).toMatchObject({ amountPaid: 1000, paymentStatus: 'paid' });
    expect(full.body.data.payments.map((x: any) => [x.amount, x.method])).toEqual([[700, 'transfer'], [300, 'cash']]);
    expect(await db.outbox.count({ where: { topic: 'webhook', key: { endsWith: ':paid' }, payload: { path: ['data', 'order', 'id'], equals: order.id } } })).toBe(1);
  });

  it('AT-ORD-29 address edit before any courier parcel ⇒ fee recomputed (Admin override kept)', async () => {
    const owner = await shop();
    const { order } = await newOrder(owner);
    expect(order.deliveryFee).toBe(400);
    const oran = await owner.post(`/orders/${order.id}/address`, address({ wilayaId: 31, communeText: 'Bir El Djir', phone2: '0661234567' })).expect(200);
    expect(oran.body.data).toMatchObject({ deliveryFee: 600, total: order.subtotal + 600, clientPhone2: '0661234567', address: expect.objectContaining({ wilayaId: 31, wilayaName: 'Oran' }) });
    const fixed = await owner.patch(`/orders/${order.id}`, { deliveryFee: 100, version: oran.body.data.version }).expect(200);
    const moved = await owner.post(`/orders/${order.id}/address`, address({ wilayaId: 16 })).expect(200);
    expect(moved.body.data.deliveryFee).toBe(100); // the override survives the address change
    expect(fixed.body.data.deliveryFee).toBe(100);
    expect((await owner.post(`/orders/${order.id}/address`, address({ address: 'court' })).expect(422)).body.error.fields).toEqual({ address: 'validation.address' });
  });

  it('assign ⇒ `order.assigned` to the assignee when notify; non-member ⇒ 422', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner);
    const r = await owner.post(`/orders/${order.id}/assign`, { assigneeId: op.userId, notify: true }).expect(200);
    expect(r.body.data.assignee).toMatchObject({ id: op.userId });
    await drain(app, owner.workspaceId);
    expect(await db.notification.count({ where: { userId: op.userId, type: 'order_assigned' } })).toBe(1);
    expect((await owner.get('/orders?assigneeId=none').expect(200)).body.data).toEqual([]);
    expect((await op.get('/orders?assigneeId=me').expect(200)).body.data.map((o: any) => o.id)).toEqual([order.id]);
    const stranger = await asOwner(app);
    expect((await owner.post(`/orders/${order.id}/assign`, { assigneeId: stranger.userId }).expect(422)).body.error.fields).toEqual({ assigneeId: 'validation.invalid' });
    // the assignee hears about changes made by someone else
    await owner.post(`/orders/${order.id}/cancel`, { reason: 'other' }).expect(200);
    await drain(app, owner.workspaceId);
    expect(await db.notification.count({ where: { userId: op.userId, type: 'order_status_changed' } })).toBe(1);
  });

  it('notes and item edits (stock re-synced)', async () => {
    const owner = await shop();
    const { order, product } = await newOrder(owner);
    await owner.post(`/orders/${order.id}/notes`, { body: 'client préfère le matin' }).expect(201);
    const edited = await owner.patch(`/orders/${order.id}`, { items: [{ productId: product.id, quantity: 3 }], version: order.version }).expect(200);
    expect(edited.body.data).toMatchObject({ subtotal: 13500, total: 13900 });
    expect(await productStock(product.id)).toBe(7);
    expect((await owner.get(`/orders/${order.id}/notes`).expect(200)).body.data[0]).toMatchObject({ body: 'client préfère le matin' });
  });
});

describe('list, bulk, export, print', () => {
  it('AT-ORD-12 / AT-ORD-30 bulk confirm of 3 with one missing address ⇒ 2 ok + ORDER_ADDRESS_REQUIRED; bulk delivered ⇒ 422', async () => {
    const owner = await shop();
    const a = await newOrder(owner);
    const b = await newOrder(owner);
    const c = await newOrder(owner, { delivery: null });
    const r = await owner.post('/orders/bulk/status', { ids: [a.order.id, b.order.id, c.order.id], to: 'confirmed' }).set(idem()).expect(200);
    expect(r.body.meta).toMatchObject({ ok: 2, failed: 1 });
    expect(r.body.data.results.find((x: any) => x.id === c.order.id)).toMatchObject({ ok: false, error: { code: 'ORDER_ADDRESS_REQUIRED' } });
    const d = await owner.post('/orders/bulk/status', { ids: [a.order.id], to: 'delivered' }).set(idem()).expect(422);
    expect(d.body.error).toMatchObject({ code: 'ORDER_INVALID_TRANSITION', params: { to: 'delivered' } });
    expect((await owner.post('/orders/bulk/status', { ids: [a.order.id], to: 'returned' }).set(idem()).expect(422)).body.error.code).toBe('ORDER_INVALID_TRANSITION');
    const cancel = await owner.post('/orders/bulk/status', { ids: [a.order.id, b.order.id], to: 'cancelled', reason: 'duplicate' }).set(idem()).expect(200);
    expect(cancel.body.meta).toMatchObject({ ok: 2, failed: 0 });
    expect(await db.order.count({ where: { id: { in: [a.order.id, b.order.id] }, cancelReason: 'duplicate' } })).toBe(2);
    const op = await asOperator(app, owner.workspaceId);
    const assigned = await owner.post('/orders/bulk/assign', { ids: [c.order.id], assigneeId: op.userId }).set(idem()).expect(200);
    expect(assigned.body.meta.ok).toBe(1);
  });

  it('AT-ORD-15 (API) filters, tab counts that ignore the status filter, KPIs that follow the filters, search by phone / product', async () => {
    const owner = await shop();
    const p = await createProduct(owner, { name: 'Sac cuir', price: 2000, stock: 20 });
    const number = phone();
    const a = await newOrder(owner, { client: { name: 'Nadia F', phone: number } }, p);
    await newOrder(owner, { status: 'confirmed' }, p);
    const stats = await owner.get('/orders/stats?status=new').expect(200);
    expect(stats.body.data).toMatchObject({ total: 1, toConfirm: 1, byStatus: { new: 1, confirmed: 1 }, pipeline: 2400 }); // KPIs follow the filters, the tab counts ignore the status one
    expect((await owner.get(`/orders?q=${number.slice(2, 8)}`).expect(200)).body.data.map((o: any) => o.id)).toEqual([a.order.id]);
    expect((await owner.get('/orders?q=cuir').expect(200)).body.meta.total).toBe(2);
    expect((await owner.get(`/orders?productId=${p.id}&status=confirmed`).expect(200)).body.meta.total).toBe(1);
    expect((await owner.get('/orders?period=today&wilayaId=16&sort=-total').expect(200)).body.meta.total).toBe(2);
    expect((await owner.get('/orders?sort=-unknown').expect(400)).body.error.code).toBe('BAD_REQUEST');
  });

  it('AT-ORD-13 export ⇒ job ⇒ XLSX with the locale columns (Admin+); operator 403', async () => {
    const owner = await shop();
    await newOrder(owner);
    await newOrder(owner);
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/orders/export').expect(403)).body.error.code).toBe('FORBIDDEN');
    const res = await owner.get('/orders/export?format=xlsx&columns=all&includeItems=true').set('Accept-Language', 'ar').expect(202);
    await drain(app, owner.workspaceId);
    const job = await (await import('../support/m2')).jobOf(owner, res.body.data.jobId);
    expect(job).toMatchObject({ status: 'done', result: { kind: 'orders', rows: 2, format: 'xlsx' }, resultUrl: expect.any(String) });
  });

  it('A5 slip: GET /orders/:id/print → signed PDF; bulk print → job → one PDF', async () => {
    const owner = await shop();
    const a = await newOrder(owner);
    const b = await newOrder(owner);
    const one = await owner.get(`/orders/${a.order.id}/print?withPrices=false&lang=ar`).expect(200);
    expect(one.body.data).toMatchObject({ url: expect.stringContaining('/api/v1/files/private/'), fileName: `${a.order.number}.pdf` });
    const file = await owner.get(one.body.data.url.replace(/^.*\/api\/v1/, '')).expect(200);
    expect(Buffer.from(file.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const bulk = await owner.post('/orders/bulk/print', { ids: [a.order.id, b.order.id], twoPerPage: true }).set(idem()).expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, bulk.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'order_slips', count: 2 }, resultUrl: expect.any(String) });
  });
});

describe('roles and tenancy (AT-AUTH-11 for the M5 routes)', () => {
  it('every order / client / delivery route answers 404 for an id of another workspace', async () => {
    const owner = await shop();
    const other = await shop();
    const { order } = await newOrder(other);
    const client = order.client.id;
    const id = order.id;
    const calls: [string, string, object?][] = [
      ['get', `/orders/${id}`],
      ['patch', `/orders/${id}`, { notes: 'x', version: 1 }],
      ['delete', `/orders/${id}`],
      ['post', `/orders/${id}/status`, { to: 'confirmed', version: 1 }],
      ['post', `/orders/${id}/cancel`, { reason: 'other' }],
      ['post', `/orders/${id}/deliver`, {}],
      ['post', `/orders/${id}/return`, { reason: 'refused', restoreStock: true }],
      ['post', `/orders/${id}/ship-manual`, {}],
      ['get', `/orders/${id}/calls`],
      ['post', `/orders/${id}/calls`, { result: 'no_answer' }],
      ['post', `/orders/${id}/callback`, { at: new Date(Date.now() + 3600_000).toISOString() }],
      ['delete', `/orders/${id}/callback`],
      ['post', `/orders/${id}/address`, address()],
      ['post', `/orders/${id}/assign`, { assigneeId: null }],
      ['get', `/orders/${id}/payments`],
      ['post', `/orders/${id}/payments`, { amount: 100 }],
      ['get', `/orders/${id}/notes`],
      ['post', `/orders/${id}/notes`, { body: 'x' }],
      ['get', `/orders/${id}/history`],
      ['get', `/orders/${id}/shipments`],
      ['get', `/orders/${id}/print`],
      ['post', `/orders/${id}/duplicate`],
      ['get', `/clients/${client}`],
      ['patch', `/clients/${client}`, { name: 'Autre nom' }],
      ['delete', `/clients/${client}`],
      ['post', `/clients/${client}/risk`, { riskLevel: 'high' }],
      ['get', `/clients/${client}/orders`],
      ['get', `/clients/${client}/conversations`],
      ['get', `/clients/${client}/metrics`],
    ];
    for (const [method, url, body] of calls) {
      const req = (owner as any)[method](url, body).set(idem());
      const res = await req;
      expect([url, res.status, res.body.error?.code]).toEqual([url, 404, 'NOT_FOUND']);
    }
    // bulk endpoints report the foreign id as not found, never touch it
    const bulk = await owner.post('/orders/bulk/status', { ids: [id], to: 'cancelled' }).set(idem()).expect(200);
    expect(bulk.body.data.results[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe('new');
  });

  it('permission matrix: operator reads and writes orders, cannot delete / export / override; reads are 403-free for every role', async () => {
    const owner = await shop();
    const op = await asOperator(app, owner.workspaceId);
    const { order } = await newOrder(owner);
    await op.get('/orders').expect(200);
    await op.get(`/orders/${order.id}`).expect(200);
    await op.post(`/orders/${order.id}/calls`, { result: 'busy' }).expect(200);
    await op.post(`/orders/${order.id}/payments`, { amount: 100 }).set(idem()).expect(200);
    expect((await op.delete(`/orders/${order.id}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await op.patch(`/orders/${order.id}`, { discount: 100, version: (await reload(op, order.id)).version }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const view = await reload(op, order.id);
    expect(view.actions.find((a: any) => a.key === 'delete')).toMatchObject({ enabled: false, reasonCode: 'FORBIDDEN' });
    expect(view.actions.find((a: any) => a.key === 'send_courier')).toMatchObject({ enabled: false, reasonCode: 'DELIVERY_ORDER_NOT_CONFIRMED' });
  });
});
