// M7 — inventory counts (INV-01…03, 04 §19, D55): scopes, one open count, blocking counter sales, counting by operators,
// validation by Admin+ with `inventory` movements computed on expected + movements since the start, notes > 10 %,
// lastInventoryAt, recommendation alert, cancel; movement / product KPIs and the stock-dashboard purchasing block.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { adjust } from '../support/m2';
import { newOrder, status } from '../support/m5';
import { advancedShop, db, idem, movementsOf, postSale, product, purchase, stockOf } from '../support/m7';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('inventory counts (INV-01…03)', () => {
  it('AT-INV-01 alerts scope ⇒ 14 lines with the expected snapshot; second start ⇒ INVENTORY_IN_PROGRESS; blocking count ⇒ SALE_BLOCKED_BY_INVENTORY; orders unaffected', async () => {
    const owner = await advancedShop(app, { fees: true });
    for (let i = 0; i < 12; i++) await product(owner, { name: `Alerte ${i}`, stock: 1, minStock: 3 });
    await product(owner, { name: 'Robe', stock: undefined, variants: [{ name: 'S', price: 3000, stock: 0, minStock: 2 }, { name: 'M', price: 3000, stock: 2, minStock: 2 }, { name: 'L', price: 3000, stock: 9, minStock: 2 }] });
    await product(owner, { name: 'OK', stock: 50, minStock: 3 });
    await product(owner, { name: 'Service', trackStock: false, stock: null });
    const preview = (await owner.get('/inventories/scope-preview?scope=alerts_only').expect(200)).body.data;
    expect(preview).toMatchObject({ scope: 'alerts_only', lines: 14, variants: 2, products: 13 });
    expect((await owner.get('/inventories/scope-preview?scope=all').expect(200)).body.data).toMatchObject({ lines: 16 });
    const started = await owner.post('/inventories', { scope: 'alerts_only', blockCounterSales: true }).expect(201);
    expect(started.body.data).toMatchObject({ number: 'INV-1', status: 'draft', scope: 'alerts_only', blockCounterSales: true, summary: { lines: 14, counted: 0 } });
    expect(started.body.data.lines).toHaveLength(14);
    expect(started.body.data.lines.find((l: any) => l.variantName === 'S')).toMatchObject({ expectedQty: 0, countedQty: null });
    const again = await owner.post('/inventories', { scope: 'all' }).expect(409);
    expect(again.body.error).toMatchObject({ code: 'INVENTORY_IN_PROGRESS', params: { number: 'INV-1' } });
    const p = await product(owner, { name: 'Vendable', stock: 10 });
    expect((await postSale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 2500 }).expect(409)).body.error.code).toBe('SALE_BLOCKED_BY_INVENTORY');
    await newOrder(owner, {}, p); // orders are never blocked
    // journeys 16/11 J07-7: the sales page knows about the block before a basket is scanned
    expect((await owner.get('/sales/stats').expect(200)).body.data.blockedByInventory).toEqual({ id: started.body.data.id, number: 'INV-1' });
    expect((await owner.post('/inventories', { scope: 'category' }).expect(422)).body.error.fields).toEqual({ categoryId: 'validation.required' });
    await owner.post(`/inventories/${started.body.data.id}/cancel`).expect(200);
    await postSale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 2500 }).expect(201);
    expect((await owner.get('/sales/stats').expect(200)).body.data.blockedByInventory).toBeNull();
    expect((await owner.get('/inventories?status=cancelled').expect(200)).body.data.map((c: any) => c.id)).toEqual([started.body.data.id]);
    expect(await db.stockMovement.count({ where: { workspaceId: owner.workspaceId, type: 'inventory' } })).toBe(0);
  });

  it('AT-INV-02 order during the count (−2) ⇒ expected adjusted; counted 18 vs 21 ⇒ `inventory −3`; 3 → 1 (67 %) without note ⇒ INVENTORY_VARIANCE_NOTE_REQUIRED; with note ⇒ validated, lastInventoryAt, recommendation alert', async () => {
    const owner = await advancedShop(app, { fees: true });
    const cat = await owner.post('/categories', { name: 'Gants' }).expect(201);
    const sub = await owner.post('/categories', { name: 'Gants cuir', parentId: cat.body.data.id }).expect(201);
    const a = await product(owner, { name: 'Gant A', stock: 23, costPrice: 100, categoryId: cat.body.data.id });
    const b = await product(owner, { name: 'Gant B', stock: 3, costPrice: 50, categoryId: sub.body.data.id });
    const other = await product(owner, { name: 'Hors périmètre', stock: 5 });
    const c = (await owner.post('/inventories', { scope: 'category', categoryId: cat.body.data.id }).expect(201)).body.data;
    expect(c.lines.map((l: any) => l.name).sort()).toEqual(['Gant A', 'Gant B']);
    // operators count (stock.count) but cannot validate (stock.adjust)
    const op = await asOperator(app, owner.workspaceId);
    const counting = await op.put(`/inventories/${c.id}/lines`, { lines: [{ productId: a.id, countedQty: 18 }, { productId: b.id, countedQty: 1 }] }).expect(200);
    expect(counting.body.data).toMatchObject({ status: 'counting', summary: { counted: 2 } });
    expect((await op.put(`/inventories/${c.id}/lines`, { lines: [{ productId: other.id, countedQty: 1 }] }).expect(422)).body.error.fields).toEqual({ 'lines.0.productId': 'validation.invalid' });
    await op.post(`/inventories/${c.id}/validate`, {}).set(idem()).expect(403);
    // an order delivered during the count takes 2 units of A: expected becomes 21
    const { order } = await newOrder(owner, { items: [{ productId: a.id, quantity: 2 }] }, a);
    await status(owner, order, 'delivered').expect(200);
    const view = (await owner.get(`/inventories/${c.id}`).expect(200)).body.data;
    expect(view.lines.find((l: any) => l.productId === a.id)).toMatchObject({ expectedQty: 23, currentExpectedQty: 21, countedQty: 18, difference: -3, differencePct: 14, noteRequired: true });
    const bIndex = view.lines.findIndex((l: any) => l.productId === b.id);
    const refused = await owner.post(`/inventories/${c.id}/validate`, {}).set(idem()).expect(422);
    expect(refused.body.error.code).toBe('INVENTORY_VARIANCE_NOTE_REQUIRED');
    expect(Object.keys(refused.body.error.fields).sort()).toEqual([`lines.${bIndex}.note`, `lines.${1 - bIndex}.note`].sort());
    await op.put(`/inventories/${c.id}/lines`, { lines: [{ productId: a.id, countedQty: 18, note: 'casse' }, { productId: b.id, countedQty: 1, note: 'vol suspecté' }] }).expect(200);
    const admin = await asAdmin(app, owner.workspaceId);
    const done = await admin.post(`/inventories/${c.id}/validate`, { note: 'inventaire mensuel' }).set(idem()).expect(200);
    expect(done.body.data).toMatchObject({ status: 'validated', validatedBy: { id: admin.userId }, summary: { discrepancies: 2, value: -(3 * 100 + 2 * 50) } });
    expect(await stockOf(a.id)).toBe(18);
    expect(await stockOf(b.id)).toBe(1);
    const moves = await movementsOf('inventory', c.id);
    expect(moves.map((m) => [m.productId === a.id ? 'A' : 'B', m.type, m.reason, m.quantity]).sort()).toEqual([
      ['A', 'inventory', 'inventory', -3],
      ['B', 'inventory', 'inventory', -2],
    ]);
    expect((await db.product.findUniqueOrThrow({ where: { id: a.id } })).lastInventoryAt).not.toBeNull();
    const recos = await db.stockRecommendation.findMany({ where: { workspaceId: owner.workspaceId, ruleKey: 'inventory_variance' } });
    expect(recos.map((r) => r.productId).sort()).toEqual([a.id, b.id].sort());
    const journal = await owner.get(`/stock/movements?type=inventory&refId=${c.id}`).expect(200);
    expect(journal.body.data[0].reference).toMatchObject({ type: 'inventory', id: c.id, label: c.number });
    expect((await owner.post(`/inventories/${c.id}/validate`, {}).set(idem()).expect(409)).body.error.code).toBe('CONFLICT');
    const sheet = await owner.get(`/inventories/${c.id}/sheet`).expect(200);
    expect(sheet.body.data.fileName).toBe(`${c.number}.pdf`);
    const outsider = await asOwner(app);
    expect((await outsider.get(`/inventories/${c.id}`).expect(404)).body.error.code).toBe('INVENTORY_NOT_FOUND');
    await outsider.put(`/inventories/${c.id}/lines`, { lines: [{ productId: a.id, countedQty: 1 }] }).expect(404);
  });
});

describe('M2 carry-overs: movement KPIs, product KPIs, purchasing block', () => {
  it('GET /stock/movements/stats and /products/stats follow the filters; /stock/overview carries the purchasing block for Admin+', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { name: 'Tunique', stock: 10, costPrice: 100, price: 300 });
    const q = await product(owner, { name: 'Basket', stock: 1, minStock: 2, costPrice: 50, price: 200 });
    await adjust(owner, { productId: p.id, type: 'out', quantity: 4, reason: 'breakage' }).expect(201);
    await adjust(owner, { productId: p.id, type: 'in', quantity: 1, reason: 'correction' }).expect(201);
    const all = (await owner.get(`/stock/movements/stats?productId=${p.id}`).expect(200)).body.data;
    // the opening stock (10) is a movement too
    expect(all).toMatchObject({ count: 3, unitsIn: 11, unitsOut: 4, net: 7, netValue: 700 });
    expect(all.byType.adjustment_out).toEqual({ count: 1, units: 4 });
    expect((await owner.get(`/stock/movements/stats?productId=${p.id}&type=adjustment_in`).expect(200)).body.data).toMatchObject({ count: 1, unitsIn: 1, unitsOut: 0 });
    const ps = (await owner.get('/products/stats').expect(200)).body.data;
    expect(ps).toMatchObject({ total: 2, active: 2, lowStock: 1, outOfStock: 0, totalItems: 8, valueAtCost: 7 * 100 + 50, valueAtRetail: 7 * 300 + 200 });
    expect((await owner.get('/products/stats?stockState=low').expect(200)).body.data).toMatchObject({ total: 1, lowStock: 1 });
    await purchase(owner, { items: [{ productId: q.id, quantity: 10, unitCost: 50 }], status: 'pending', expectedAt: new Date(Date.now() - 86_400_000).toISOString() });
    const overview = (await owner.get('/stock/overview').expect(200)).body.data;
    expect(overview.purchasing).toMatchObject({ pendingReceipt: 1, late: 1, dueToSuppliers: 500, purchased30d: 500 });
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/stock/overview').expect(200)).body.data.purchasing).toBeNull();
    expect((await op.get('/products/stats').expect(200)).body.data.total).toBe(2);
    expect(q).toBeTruthy();
  });
});
