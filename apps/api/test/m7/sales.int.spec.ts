// M7 — counter sales (GDS-07, 04 §3 / §20): client link, partial payment rule, stock out / back through SaleEffects,
// immutability, cancel ≤ 7 d with refund, "Encaisser le reste", delete only unpaid; AT-CLI-05 aggregates; AT-ORD-10 revenue.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { newOrder, orderBody, postOrder, status } from '../support/m5';
import { advancedShop, cashOfDoc, DAY, db, idem, movementsOf, postSale, product, sale, stockOf } from '../support/m7';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('sales (GDS-07)', () => {
  it('VNT-1001: stock out (`out` reason sale), locked income row, edited price snapshotted with the catalogue price, variant required, insufficient stock', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { name: 'Parfum Oud', price: 4500, costPrice: 2000, stock: 5 });
    const robe = await product(owner, { name: 'La Robe satin', stock: undefined, variants: [{ name: 'M / Noir', price: 4900, stock: 6 }] });
    const s = await sale(owner, { items: [{ productId: p.id, quantity: 2, unitPrice: 4200 }, { productId: robe.id, variantId: robe.variants[0].id, quantity: 1 }], discount: 915, paymentMethod: 'cash', amountPaid: 20000 });
    expect(s).toMatchObject({ number: 'VNT-1001', status: 'completed', subtotal: 13300, discount: 915, total: 12385, amountPaid: 12385, remaining: 0, paymentStatus: 'paid', client: null, seller: { id: owner.userId } });
    expect(s.items.find((i: any) => i.product.id === p.id)).toMatchObject({ unitPrice: 4200, catalogPrice: 4500, costPrice: 2000, total: 8400 });
    expect(s.items.find((i: any) => i.product.id === robe.id)).toMatchObject({ unitPrice: 4900, catalogPrice: null, variantName: 'M / Noir' });
    expect(await stockOf(p.id)).toBe(3);
    expect(await stockOf(robe.id, robe.variants[0].id)).toBe(5);
    expect((await movementsOf('sale', s.id)).map((m) => [m.type, m.reason, m.quantity])).toEqual(expect.arrayContaining([['out', 'sale', -2], ['out', 'sale', -1]]));
    expect(await cashOfDoc('sale', s.id)).toEqual([expect.objectContaining({ type: 'income', amount: 12385, category: 'sale', method: 'cash', isAutomatic: true })]);
    expect((await postSale(owner, { items: [{ productId: robe.id, quantity: 1 }], amountPaid: 4900 }).expect(422)).body.error.code).toBe('VARIANT_REQUIRED');
    const short = await postSale(owner, { items: [{ productId: p.id, quantity: 9 }], amountPaid: 40500 }).expect(422);
    expect(short.body.error).toMatchObject({ code: 'SALE_INSUFFICIENT_STOCK', params: { product: 'Parfum Oud', available: 3 }, fields: { 'items.0.quantity': 'validation.quantity' } });
    expect(await db.sale.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect((await owner.post('/sales', { items: [{ productId: p.id, quantity: 1 }] }).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
  });

  it('lines come back in the order they were entered (ids keep insertion order inside one millisecond)', async () => {
    const owner = await advancedShop(app);
    const ps = await Promise.all(['E', 'A', 'D', 'B', 'C', 'F'].map((n) => product(owner, { name: `Ligne ${n}`, stock: 5 })));
    const s = await sale(owner, { items: ps.map((p) => ({ productId: p.id, quantity: 1 })), paymentMethod: 'cash', amountPaid: 15000 });
    expect(s.items.map((i: any) => i.product.id)).toEqual(ps.map((p) => p.id));
    const fresh = (await owner.get(`/sales/${s.id}`).expect(200)).body.data;
    expect(fresh.items.map((i: any) => i.product.id)).toEqual(ps.map((p) => p.id));
  });

  it('AT-GDS-12 partial without client ⇒ SALE_PARTIAL_REQUIRES_CUSTOMER; with a client (found or created) ⇒ partial; "Encaisser le reste" ⇒ paid + cash row; edit ⇒ SALE_IMMUTABLE', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 5000, stock: 10 });
    const refused = await postSale(owner, { items: [{ productId: p.id, quantity: 2 }], amountPaid: 3000 }).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'SALE_PARTIAL_REQUIRES_CUSTOMER', fields: { clientId: 'validation.required' } });
    expect(await stockOf(p.id)).toBe(10);
    const s = await sale(owner, { client: { name: 'Amina Bouzid', phone: '0555 12 34 56' }, items: [{ productId: p.id, quantity: 2 }], amountPaid: 3000 });
    expect(s).toMatchObject({ total: 10000, amountPaid: 3000, remaining: 7000, paymentStatus: 'partial', client: { name: 'Amina Bouzid', phone: '0555123456' } });
    expect(s.actions[0]).toMatchObject({ key: 'collect', primary: true });
    const client = await db.client.findUniqueOrThrow({ where: { id: s.client.id } });
    expect(client).toMatchObject({ orderCount: 1, totalSpent: 10000, source: 'manual' });
    expect((await owner.post(`/sales/${s.id}/payments`, { amount: 8000, method: 'cash' }).set(idem()).expect(422)).body.error.fields).toEqual({ amount: 'validation.range' });
    const paid = await owner.post(`/sales/${s.id}/payments`, { amount: 7000, method: 'ccp' }).set(idem()).expect(200);
    expect(paid.body.data).toMatchObject({ amountPaid: 10000, remaining: 0, paymentStatus: 'paid' });
    expect(paid.body.data.payments.map((x: any) => [x.amount, x.method])).toEqual([
      [3000, 'cash'],
      [7000, 'ccp'],
    ]);
    expect((await cashOfDoc('sale', s.id)).map((r) => r.amount)).toEqual([3000, 7000]);
    const imm = await owner.patch(`/sales/${s.id}`, { items: [{ productId: p.id, quantity: 1 }] }).expect(422);
    expect(imm.body.error.code).toBe('SALE_IMMUTABLE');
    expect((await owner.patch(`/sales/${s.id}`, { notes: 'fidèle' }).expect(200)).body.data.notes).toBe('fidèle');
    expect((await owner.delete(`/sales/${s.id}`).expect(422)).body.error.code).toBe('SALE_DELETE_PAID');
    // the same phone is found, not duplicated
    const again = await sale(owner, { client: { name: 'Amina B.', phone: '0555123456' }, items: [{ productId: p.id, quantity: 1 }], amountPaid: 5000 });
    expect(again.client.id).toBe(s.client.id);
  });

  it('AT-GDS-12 finishing a draft with a new client typed in the sheet (PATCH `client { name, phone }`) ⇒ client found or created, partial accepted', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 5000, stock: 10 });
    const draft = await sale(owner, { items: [{ productId: p.id, quantity: 2 }], status: 'draft' });
    expect(draft.client).toBeNull();
    // without the client the partial validation is still refused
    const refused = await owner.patch(`/sales/${draft.id}`, { status: 'completed', amountPaid: 3000 }).expect(422);
    expect(refused.body.error.code).toBe('SALE_PARTIAL_REQUIRES_CUSTOMER');
    // clientId and client together are refused (one or the other)
    const both = await owner.patch(`/sales/${draft.id}`, { clientId: owner.userId, client: { name: 'Karim Saidi', phone: '0661 22 33 44' } }).expect(422);
    expect(both.body.error.fields).toMatchObject({ client: 'validation.invalid' });
    const done = await owner.patch(`/sales/${draft.id}`, { client: { name: 'Karim Saidi', phone: '0661 22 33 44' }, items: [{ productId: p.id, quantity: 2 }], status: 'completed', amountPaid: 3000 }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'completed', total: 10000, amountPaid: 3000, remaining: 7000, paymentStatus: 'partial', client: { name: 'Karim Saidi', phone: '0661223344' } });
    expect(await db.client.findUniqueOrThrow({ where: { id: done.body.data.client.id } })).toMatchObject({ orderCount: 1, totalSpent: 10000, source: 'manual' });
    expect(await stockOf(p.id)).toBe(8);
    // a completed sale no longer takes a client through PATCH (Lier à un client instead)
    expect((await owner.patch(`/sales/${draft.id}`, { client: { name: 'Autre', phone: '0770 11 22 33' } }).expect(422)).body.error.code).toBe('SALE_IMMUTABLE');
  });

  it('AT-GDS-12 cancel at day 8 ⇒ SALE_CANNOT_CANCEL_AFTER_7D; at day 2 with refund ⇒ stock restored + refund row; without refund ⇒ income rows removed', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 1000, stock: 10 });
    const old = await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 1000, soldAt: new Date(Date.now() - 8 * DAY).toISOString() });
    expect(old.actions.find((a: any) => a.key === 'cancel')).toEqual({ key: 'cancel', enabled: false, reasonCode: 'SALE_CANNOT_CANCEL_AFTER_7D' });
    expect((await owner.post(`/sales/${old.id}/cancel`, { reason: 'erreur' }).expect(422)).body.error.code).toBe('SALE_CANNOT_CANCEL_AFTER_7D');
    const recent = await sale(owner, { items: [{ productId: p.id, quantity: 3 }], amountPaid: 3000, soldAt: new Date(Date.now() - 2 * DAY).toISOString() });
    expect(await stockOf(p.id)).toBe(6);
    expect((await owner.post(`/sales/${recent.id}/cancel`, {}).expect(422)).body.error.fields).toEqual({ reason: 'validation.required' });
    const c = await owner.post(`/sales/${recent.id}/cancel`, { reason: 'Client a changé d’avis', restoreStock: true, refund: true }).expect(200);
    expect(c.body.data).toMatchObject({ status: 'cancelled', stockRestored: true, cancelReason: 'Client a changé d’avis', cancelledBy: { id: owner.userId } });
    expect(await stockOf(p.id)).toBe(9);
    expect((await movementsOf('sale', recent.id)).map((m) => [m.type, m.reason, m.quantity])).toEqual([
      ['out', 'sale', -3],
      ['return', 'sale_cancelled', 3],
    ]);
    const rows = await cashOfDoc('sale', recent.id);
    expect(rows.map((r) => [r.type, r.category, r.amount, r.isAutomatic])).toEqual([
      ['income', 'sale', 3000, true],
      ['expense', 'refund', 3000, true],
    ]);
    expect((await owner.post(`/sales/${recent.id}/cancel`, { reason: 'encore' }).expect(409)).body.error.code).toBe('CONFLICT');
    expect((await owner.post(`/sales/${recent.id}/payments`, { amount: 1, method: 'cash' }).set(idem()).expect(422)).body.error.code).toBe('SALE_IMMUTABLE');
    const noRefund = await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 1000 });
    await owner.post(`/sales/${noRefund.id}/cancel`, { reason: 'saisie en double', restoreStock: false, refund: false }).expect(200);
    expect(await cashOfDoc('sale', noRefund.id)).toHaveLength(0);
    expect(await stockOf(p.id)).toBe(8);
  });

  it('draft → validate (PATCH status=completed); delete an unpaid completed sale gives the stock back; link a client; receipt; list + stats; roles and tenancy', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 2000, stock: 10 });
    const draft = await sale(owner, { items: [{ productId: p.id, quantity: 2 }], status: 'draft' });
    expect(draft).toMatchObject({ status: 'draft', amountPaid: 0 });
    expect(draft.actions[0]).toMatchObject({ key: 'validate', primary: true });
    expect(await stockOf(p.id)).toBe(10);
    await owner.patch(`/sales/${draft.id}`, { items: [{ productId: p.id, quantity: 3 }] }).expect(200);
    const done = await owner.patch(`/sales/${draft.id}`, { status: 'completed', amountPaid: 6000 }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'completed', total: 6000, paymentStatus: 'paid' });
    expect(await stockOf(p.id)).toBe(7);

    const c = await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Yacine M.', phone: '0661987654', source: 'manual' } });
    const unpaid = await sale(owner, { clientId: c.id, items: [{ productId: p.id, quantity: 1 }], amountPaid: 0 });
    expect(unpaid.paymentStatus).toBe('unpaid');
    await owner.delete(`/sales/${unpaid.id}`).expect(204);
    expect(await stockOf(p.id)).toBe(7);
    expect((await db.client.findUniqueOrThrow({ where: { id: c.id } })).orderCount).toBe(0);
    const linked = await owner.post(`/sales/${draft.id}/client`, { clientId: c.id }).expect(200);
    expect(linked.body.data.client).toMatchObject({ id: c.id });
    expect((await db.client.findUniqueOrThrow({ where: { id: c.id } })).totalSpent).toBe(6000);
    const r = await owner.get(`/sales/${draft.id}/receipt?lang=fr`).expect(200);
    expect(r.body.data.fileName).toBe(`${done.body.data.number}.pdf`);

    expect((await owner.get(`/sales?clientId=${c.id}`).expect(200)).body.data.map((x: any) => x.id)).toEqual([draft.id]);
    expect((await owner.get(`/sales?q=${done.body.data.number}`).expect(200)).body.meta.total).toBe(1);
    const stats = (await owner.get('/sales/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ count: 1, revenue: 6000, averageBasket: 6000, partialCount: 0 });

    const op = await asOperator(app, owner.workspaceId);
    await op.get('/sales').expect(403);
    await postSale(op, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 2000 }).expect(403);
    const admin = await asAdmin(app, owner.workspaceId);
    await postSale(admin, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 2000 }).expect(201);
    const other = await asOwner(app);
    await other.get(`/sales/${draft.id}`).expect(404);
    await other.post(`/sales/${draft.id}/cancel`, { reason: 'pirate' }).expect(404);
    await other.post(`/sales/${draft.id}/client`, { clientId: c.id }).expect(404);
  });
});

describe('AT-CLI-05 / AT-ORD-10 aggregates and revenue', () => {
  it('AT-CLI-05 delivering an order and recording a sale update orderCount / totalSpent / lastOrderAt; cancelling recomputes', async () => {
    const owner = await advancedShop(app, { fees: true });
    const p = await product(owner, { price: 2000, stock: 20 });
    const { order } = await newOrder(owner, { client: { name: 'Sara Kaci', phone: '0770112233' }, items: [{ productId: p.id, quantity: 1 }] }, p);
    await status(owner, order, 'delivered').expect(200);
    const clientId = order.client.id;
    let c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(c).toMatchObject({ orderCount: 1, totalSpent: order.total });
    const s = await sale(owner, { clientId, items: [{ productId: p.id, quantity: 1 }], amountPaid: 2000 });
    c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(c).toMatchObject({ orderCount: 2, totalSpent: order.total + 2000 });
    expect(c.lastOrderAt!.toISOString()).toBe(s.soldAt);
    await owner.post(`/sales/${s.id}/cancel`, { reason: 'retour', refund: true }).expect(200);
    c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(c).toMatchObject({ orderCount: 1, totalSpent: order.total });
  });

  it('AT-ORD-10 sale 1000 + delivered order 2000 + pending order 500 ⇒ Revenue 3000, Pipeline 500, AI revenue only AI orders (home)', async () => {
    const owner = await advancedShop(app, { fees: true });
    const p = await product(owner, { price: 1000, stock: 50 });
    await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 1000 });
    const delivered = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 2, unitPrice: 800 }] })).expect(201);
    await owner.patch(`/orders/${delivered.body.data.id}`, { version: delivered.body.data.version, deliveryFee: 400 }).expect(200);
    const d = (await owner.get(`/orders/${delivered.body.data.id}`).expect(200)).body.data;
    expect(d.total).toBe(2000);
    await status(owner, d, 'delivered').expect(200);
    const pending = await postOrder(owner, orderBody(p.id, { items: [{ productId: p.id, quantity: 1, unitPrice: 100 }] })).expect(201);
    expect(pending.body.data.total).toBe(500);
    const home = (await owner.get('/dashboard/home').expect(200)).body.data;
    expect(home.kpis.revenue30d.value).toBe(3000);
    expect(home.kpis.revenueSources30d).toEqual({ deliveredOrders: 1, sales: 1 }); // UX-063: the pending order is not in the amount
    expect(home.kpis.pipeline).toBe(500);
    expect(home.kpis.aiRevenue30d.value).toBe(0);
    expect((await owner.get('/sales/stats').expect(200)).body.data.revenue).toBe(1000);
  });
});
