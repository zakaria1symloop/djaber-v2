// M7 — suppliers (GDS-05) and purchases (GDS-06, 04 §20 D64): CRUD, balance, supplier payment allocation, receipts with
// over-receipt and weighted-average cost, cancel / delete locks, payments (locked cash rows), roles, tenancy, idempotency.
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { advancedShop, cashOfDoc, costOf, db, idem, movementsOf, postPurchase, product, purchase, receive, stockOf, supplier } from '../support/m7';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('suppliers (GDS-05)', () => {
  it('CRUD + list filters; 422 on a bad e-mail; operator 403; other workspace 404', async () => {
    const owner = await advancedShop(app);
    const s = await supplier(owner, { name: 'Belkacem Import', email: 'contact@belkacem.dz', terms: 'Paiement à 30 j', paymentTermsDays: 30, avgLeadDays: 6 });
    expect(s).toMatchObject({ name: 'Belkacem Import', isActive: true, balance: 0, purchaseCount: 0, terms: 'Paiement à 30 j', avgLeadDays: 6, leadDaysMeasured: null });
    expect(s.actions.map((a: any) => a.key)).toEqual(['open', 'edit', 'new_purchase', 'record_payment', 'deactivate', 'delete']);
    expect((await owner.post('/suppliers', { name: 'X', email: 'nope' }).expect(422)).body.error.fields).toMatchObject({ name: 'validation.name', email: expect.any(String) });
    await owner.patch(`/suppliers/${s.id}`, { notes: 'Livre le jeudi' }).expect(200);
    const list = await owner.get('/suppliers?q=belk').expect(200);
    expect(list.body.data.map((x: any) => x.id)).toEqual([s.id]);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });
    const op = await asOperator(app, owner.workspaceId);
    expect((await op.get('/suppliers').expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await op.post('/suppliers', { name: 'Op' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const other = await asOwner(app);
    await other.get(`/suppliers/${s.id}`).expect(404);
    await other.patch(`/suppliers/${s.id}`, { name: 'Pirate' }).expect(404);
    const admin = await asAdmin(app, owner.workspaceId);
    await admin.get(`/suppliers/${s.id}`).expect(200);
  });

  it('UX-003 (tester report 2026-10-20): one supplier per phone and per e-mail (case-insensitive) — create and edit, concurrent submissions too; same name allowed; other workspace / deleted supplier ignored', async () => {
    const owner = await advancedShop(app);
    const pedro = await supplier(owner, { name: 'Pedro', phone: '0550112233', email: 'Pedro1@Example.com' });
    const samePhone = await owner.post('/suppliers', { name: 'Pedro Bis', phone: '0550112233' }).expect(409);
    expect(samePhone.body.error).toMatchObject({ code: 'SUPPLIER_ALREADY_EXISTS', params: { name: 'Pedro' }, fields: { phone: 'validation.supplier_taken' }, details: { supplierId: pedro.id } });
    const sameEmail = await owner.post('/suppliers', { name: 'Autre', phone: '0660445566', email: 'pedro1@example.com' }).expect(409);
    expect(sameEmail.body.error).toMatchObject({ code: 'SUPPLIER_ALREADY_EXISTS', fields: { email: 'validation.supplier_taken' } });
    // the same name with other contacts is a legitimate second supplier
    const pedro2 = await supplier(owner, { name: 'Pedro', phone: '0660445566', email: 'pedro2@example.com' });
    expect((await owner.patch(`/suppliers/${pedro2.id}`, { phone: '0550112233' }).expect(409)).body.error.code).toBe('SUPPLIER_ALREADY_EXISTS');
    await owner.patch(`/suppliers/${pedro.id}`, { phone: '0550112233', notes: 'inchangé' }).expect(200); // its own phone
    // two simultaneous creations with one phone: exactly one passes
    const race = await Promise.all([owner.post('/suppliers', { name: 'Course A', phone: '0770778899' }), owner.post('/suppliers', { name: 'Course B', phone: '0770778899' })]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    // another workspace may have the same supplier
    await supplier(await advancedShop(app), { name: 'Pedro', phone: '0550112233' });
  });

  it('AT-GDS-13 delete with purchases ⇒ SUPPLIER_HAS_PURCHASES ⇒ deactivate; payment allocated to the oldest purchase, locked cash row, amountPaid updated', async () => {
    const owner = await advancedShop(app);
    const s = await supplier(owner, { name: 'Textile Sétif' });
    const p = await product(owner, { costPrice: 100, stock: 0 });
    const first = await purchase(owner, { supplierId: s.id, items: [{ productId: p.id, quantity: 10, unitCost: 100 }], status: 'pending', purchasedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const second = await purchase(owner, { supplierId: s.id, items: [{ productId: p.id, quantity: 5, unitCost: 100 }], status: 'pending' });
    const del = await owner.delete(`/suppliers/${s.id}`).expect(409);
    expect(del.body.error).toMatchObject({ code: 'SUPPLIER_HAS_PURCHASES', params: { count: 2 } });
    const off = await owner.post(`/suppliers/${s.id}/deactivate`).expect(200);
    expect(off.body.data).toMatchObject({ isActive: false, balance: 1500 });
    expect((await owner.get('/suppliers?isActive=false').expect(200)).body.data.map((x: any) => x.id)).toContain(s.id);

    // more than what is due ⇒ 422 on the amount
    expect((await owner.post(`/suppliers/${s.id}/payments`, { amount: 2000, method: 'cash' }).expect(422)).body.error.fields).toEqual({ amount: 'validation.range' });
    const pay = await owner.post(`/suppliers/${s.id}/payments`, { amount: 1200, method: 'ccp', reference: 'VIR-1' }).expect(200);
    expect(pay.body.data.allocations).toEqual([
      { purchaseId: first.id, number: first.number, amount: 1000 },
      { purchaseId: second.id, number: second.number, amount: 200 },
    ]);
    expect(pay.body.data.supplier.balance).toBe(300);
    const a = (await owner.get(`/purchases/${first.id}`).expect(200)).body.data;
    expect(a).toMatchObject({ amountPaid: 1000, paymentStatus: 'paid', remaining: 0 });
    expect(a.payments).toEqual([expect.objectContaining({ amount: 1000, method: 'ccp', reference: 'VIR-1' })]);
    const rows = await cashOfDoc('purchase', first.id);
    expect(rows).toEqual([expect.objectContaining({ type: 'expense', amount: 1000, category: 'purchase', method: 'ccp', isAutomatic: true, sourceType: 'payment_entry' })]);
    // to one purchase explicitly
    await owner.post(`/suppliers/${s.id}/payments`, { amount: 300, method: 'cash', purchaseId: second.id }).expect(200);
    expect((await owner.get(`/suppliers/${s.id}`).expect(200)).body.data).toMatchObject({ balance: 0, purchaseCount: 2, totalSpent: 1500 });
  });
});

describe('purchases (GDS-06, 04 §20)', () => {
  it('create ACH-1001 (draft) → "Commander" ⇒ pending; totals; untracked product ⇒ PURCHASE_UNTRACKED_PRODUCT; variant required; Idempotency-Key required and replayed', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner);
    const service = await product(owner, { name: 'Retouche', trackStock: false, stock: null });
    const robe = await product(owner, { name: 'Robe', stock: undefined, variants: [{ name: 'M', price: 3000, stock: 2 }] });
    expect((await owner.post('/purchases', { items: [{ productId: p.id, quantity: 1, unitCost: 10 }] }).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const key = idem();
    const body = { items: [{ productId: p.id, quantity: 12, unitCost: 1500 }], tax: 500, shippingCost: 1000, expectedAt: new Date(Date.now() + 86_400_000).toISOString() };
    const created = await owner.post('/purchases', body).set(key).expect(201);
    expect(created.body.data).toMatchObject({ number: 'ACH-1001', status: 'draft', subtotal: 18000, tax: 500, shippingCost: 1000, total: 19500, paymentStatus: 'unpaid', remaining: 0, late: false });
    expect(created.body.data.actions[0]).toMatchObject({ key: 'order', primary: true, enabled: true });
    const replay = await owner.post('/purchases', body).set(key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await db.purchase.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    const untracked = await postPurchase(owner, { items: [{ productId: service.id, quantity: 1, unitCost: 10 }] }).expect(422);
    expect(untracked.body.error).toMatchObject({ code: 'PURCHASE_UNTRACKED_PRODUCT', params: { product: 'Retouche' }, fields: { 'items.0.productId': 'validation.invalid' } });
    expect((await postPurchase(owner, { items: [{ productId: robe.id, quantity: 1, unitCost: 10 }] }).expect(422)).body.error.code).toBe('VARIANT_REQUIRED');
    expect((await postPurchase(owner, { items: [] }).expect(422)).body.error.fields).toEqual({ items: 'validation.required' });
    const ordered = await owner.post(`/purchases/${created.body.data.id}/order`).expect(200);
    expect(ordered.body.data.status).toBe('pending');
    expect((await owner.post(`/purchases/${created.body.data.id}/order`).expect(409)).body.error.code).toBe('CONFLICT');
  });

  it('AT-GDS-11 receive 14 of 12 ⇒ 200 ⚠ PURCHASE_OVER_RECEIVE, line raised to 14, weighted-average cost; partial then received; received purchase cannot be cancelled', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { costPrice: 100, stock: 10 });
    const robe = await product(owner, { name: 'Robe', stock: undefined, variants: [{ name: 'M', price: 3000, costPrice: 1000, stock: 2 }] });
    const v = robe.variants[0];
    const ach = await purchase(owner, { items: [{ productId: p.id, quantity: 12, unitCost: 160 }, { productId: robe.id, variantId: v.id, quantity: 4, unitCost: 1600 }], status: 'pending' });
    // line order follows the ids (uuid v7 of one statement): find the lines by product
    const l1 = ach.items.find((i: any) => i.product.id === p.id);
    const l2 = ach.items.find((i: any) => i.product.id === robe.id);
    // partial: 5 of the first line at 160 ⇒ AT-GDS-16 (10 × 100 + 5 × 160) / 15 = 120
    const part = await receive(owner, ach.id, { items: [{ id: l1.id, receivedQty: 5 }] }).expect(200);
    expect(part.body.data).toMatchObject({ status: 'partial', units: { ordered: 16, received: 5 }, receivedAt: null });
    expect(await stockOf(p.id)).toBe(15);
    expect(await costOf(p.id)).toBe(120);
    expect((await movementsOf('purchase', ach.id)).map((m) => [m.type, m.reason, m.quantity, m.quantityBefore, m.quantityAfter])).toEqual([['in', 'purchase', 5, 10, 15]]);
    // over-receipt: 9 more (14 of 12) + the variant line completely
    const over = await receive(owner, ach.id, { items: [{ id: l1.id, receivedQty: 9 }, { id: l2.id, receivedQty: 4 }], supplierInvoiceRef: 'F-2026-118' }).expect(200);
    expect(over.body.meta.warnings).toEqual([{ code: 'PURCHASE_OVER_RECEIVE', params: { ordered: 12, received: 14 }, field: 'items.0.receivedQty' }]);
    expect(over.body.data).toMatchObject({ status: 'received', supplierInvoiceRef: 'F-2026-118', receivedAt: expect.any(String), subtotal: 14 * 160 + 4 * 1600, total: 14 * 160 + 4 * 1600 });
    expect(over.body.data.items.find((i: any) => i.id === l1.id)).toMatchObject({ quantity: 14, receivedQty: 14, remainingQty: 0 });
    // (15 × 120 + 9 × 160) / 24 = 135 ; variant (2 × 1000 + 4 × 1600) / 6 = 1400
    expect(await costOf(p.id)).toBe(135);
    expect(await costOf(robe.id, v.id)).toBe(1400);
    expect(await stockOf(robe.id, v.id)).toBe(6);
    expect((await owner.post(`/purchases/${ach.id}/cancel`, {}).expect(409)).body.error.code).toBe('PURCHASE_ALREADY_RECEIVED');
    expect((await receive(owner, ach.id, { items: [{ id: l1.id, receivedQty: 1 }] }).expect(409)).body.error.code).toBe('PURCHASE_ALREADY_RECEIVED');
    expect((await owner.delete(`/purchases/${ach.id}`).expect(422)).body.error.code).toBe('PURCHASE_DELETE_NOT_PENDING');
    const menu = (await owner.get(`/purchases/${ach.id}`).expect(200)).body.data.actions;
    expect(menu.find((a: any) => a.key === 'cancel')).toEqual({ key: 'cancel', enabled: false, reasonCode: 'PURCHASE_ALREADY_RECEIVED' });
    // a line added in the dialog ("ligne ajoutée", ordered 0)
    const ach2 = await purchase(owner, { items: [{ productId: p.id, quantity: 1, unitCost: 135 }], status: 'pending' });
    const added = await receive(owner, ach2.id, { items: [{ id: ach2.items[0].id, receivedQty: 1 }], newItems: [{ productId: robe.id, variantId: v.id, receivedQty: 2, unitCost: 1400 }] }).expect(200);
    expect(added.body.data.items).toHaveLength(2);
    expect(added.body.meta.warnings).toEqual([{ code: 'PURCHASE_OVER_RECEIVE', params: { ordered: 0, received: 2 }, field: 'newItems.0.receivedQty' }]);
    // nothing received ⇒ 422
    const ach3 = await purchase(owner, { items: [{ productId: p.id, quantity: 1, unitCost: 1 }], status: 'pending' });
    expect((await receive(owner, ach3.id, { items: [{ id: ach3.items[0].id, receivedQty: 0 }] }).expect(422)).body.error.fields).toEqual({ items: 'validation.required' });
    expect((await owner.post(`/purchases/${ach3.id}/receive`, { items: [] }).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
  });

  it('AT-GDS-11 partial purchase cancelled ⇒ received units stay, unpaid rest no longer due; nothing received ⇒ payments and cash rows removed; delete only draft/pending unpaid', async () => {
    const owner = await advancedShop(app);
    const s = await supplier(owner);
    const p = await product(owner, { costPrice: 100, stock: 0 });
    const ach = await purchase(owner, { supplierId: s.id, items: [{ productId: p.id, quantity: 10, unitCost: 100 }], status: 'pending', amountPaid: 300, paymentMethod: 'cash' });
    expect(ach).toMatchObject({ amountPaid: 300, paymentStatus: 'partial', remaining: 700 });
    await receive(owner, ach.id, { items: [{ id: ach.items[0].id, receivedQty: 4 }] }).expect(200);
    const cancelled = await owner.post(`/purchases/${ach.id}/cancel`, { reason: 'rupture fournisseur' }).expect(200);
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', cancelReason: 'rupture fournisseur', amountPaid: 300, remaining: 0 });
    expect(await stockOf(p.id)).toBe(4);
    expect(await cashOfDoc('purchase', ach.id)).toHaveLength(1);
    expect((await owner.get(`/suppliers/${s.id}`).expect(200)).body.data).toMatchObject({ balance: 0, totalSpent: 0 });
    const locked = await owner.post(`/purchases/${ach.id}/payments`, { amount: 100, method: 'cash' }).set(idem()).expect(422);
    expect(locked.body.error.code).toBe('PURCHASE_CANCELLED_PAYMENT_LOCKED');

    const paidPending = await purchase(owner, { items: [{ productId: p.id, quantity: 2, unitCost: 100 }], status: 'pending', amountPaid: 200, paymentMethod: 'cash' });
    expect((await owner.delete(`/purchases/${paidPending.id}`).expect(422)).body.error.code).toBe('PURCHASE_DELETE_NOT_PENDING');
    await owner.post(`/purchases/${paidPending.id}/cancel`).expect(200);
    expect(await cashOfDoc('purchase', paidPending.id)).toHaveLength(0);
    expect((await owner.get(`/purchases/${paidPending.id}`).expect(200)).body.data).toMatchObject({ amountPaid: 0, paymentStatus: 'unpaid' });
    const draft = await purchase(owner, { items: [{ productId: p.id, quantity: 2, unitCost: 100 }] });
    await owner.delete(`/purchases/${draft.id}`).expect(204);
    await owner.get(`/purchases/${draft.id}`).expect(404);
  });

  it('payments (≤ remaining, Idempotency-Key), PATCH locks, duplicate, print, list filters + stats, roles and tenancy', async () => {
    const owner = await advancedShop(app);
    const s = await supplier(owner, { name: 'Cuir Médéa' });
    const p = await product(owner, { costPrice: 100, stock: 0 });
    const late = await purchase(owner, { supplierId: s.id, items: [{ productId: p.id, quantity: 3, unitCost: 1000 }], status: 'pending', expectedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(late.late).toBe(true);
    expect((await owner.post(`/purchases/${late.id}/payments`, { amount: 5000, method: 'cash' }).set(idem()).expect(422)).body.error.fields).toEqual({ amount: 'validation.range' });
    const k = idem();
    await owner.post(`/purchases/${late.id}/payments`, { amount: 1000, method: 'cash' }).set(k).expect(200);
    await owner.post(`/purchases/${late.id}/payments`, { amount: 1000, method: 'cash' }).set(k).expect(200);
    expect((await owner.get(`/purchases/${late.id}`).expect(200)).body.data).toMatchObject({ amountPaid: 1000, paymentStatus: 'partial' });
    expect((await owner.patch(`/purchases/${late.id}`, { notes: 'relancer', items: [{ productId: p.id, quantity: 4, unitCost: 1000 }] }).expect(200)).body.data).toMatchObject({ total: 4000, notes: 'relancer' });
    await receive(owner, late.id, { items: [{ id: (await db.purchaseItem.findFirstOrThrow({ where: { purchaseId: late.id } })).id, receivedQty: 1 }] }).expect(200);
    const lockedPatch = await owner.patch(`/purchases/${late.id}`, { tax: 10 }).expect(409);
    expect(lockedPatch.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'PURCHASE_LOCKED' } });
    await owner.patch(`/purchases/${late.id}`, { supplierInvoiceRef: 'F-1' }).expect(200);
    const copy = await owner.post(`/purchases/${late.id}/duplicate`).expect(201);
    expect(copy.body.data).toMatchObject({ status: 'draft', supplier: { id: s.id }, total: 4000, amountPaid: 0 });
    const print = await owner.get(`/purchases/${late.id}/print?lang=ar`).expect(200);
    expect(print.body.data).toMatchObject({ url: expect.any(String), fileName: `${late.number}.pdf` });
    expect(print.body.data.size).toBeGreaterThan(1000);

    const list = await owner.get(`/purchases?late=true&supplierId=${s.id}`).expect(200);
    expect(list.body.data.map((x: any) => x.id)).toEqual([late.id]);
    expect((await owner.get('/purchases?status=draft').expect(200)).body.data.map((x: any) => x.id)).toEqual([copy.body.data.id]);
    expect((await owner.get(`/purchases?q=${late.number}`).expect(200)).body.meta.total).toBe(1);
    await owner.get('/purchases?sort=-nope').expect(400);
    const stats = (await owner.get('/purchases/stats').expect(200)).body.data;
    expect(stats).toMatchObject({ pendingReceipt: 1, late: 1, dueToSuppliers: 3000, suppliersWithBalance: 1, drafts: 1, purchased: 4000 });

    const admin = await asAdmin(app, owner.workspaceId);
    await admin.get(`/purchases/${late.id}`).expect(200);
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/purchases').expect(403);
    await op.post(`/purchases/${late.id}/payments`, { amount: 1, method: 'cash' }).set(idem()).expect(403);
    const other = await asOwner(app);
    await other.get(`/purchases/${late.id}`).expect(404);
    await other.post(`/purchases/${late.id}/cancel`, {}).expect(404);
    await other.post(`/purchases/${late.id}/payments`, { amount: 1, method: 'cash' }).set(idem()).expect(404);
    // another workspace's product on a line is refused
    expect((await postPurchase(other, { items: [{ productId: p.id, quantity: 1, unitCost: 1 }] }).expect(422)).body.error.fields).toEqual({ 'items.0.productId': 'validation.invalid' });
  });

  it('movement references: the journal labels purchase movements ACH-…', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { stock: 0 });
    const ach = await purchase(owner, { items: [{ productId: p.id, quantity: 2, unitCost: 500 }], status: 'pending' });
    await receive(owner, ach.id, { items: [{ id: ach.items[0].id, receivedQty: 2 }] }).expect(200);
    const mv = await owner.get(`/stock/movements?refType=purchase&refId=${ach.id}`).expect(200);
    expect(mv.body.data[0]).toMatchObject({ type: 'in', reason: 'purchase', reference: { type: 'purchase', id: ach.id, label: ach.number } });
    expect(mv.body.data[0].actions.find((a: any) => a.key === 'reverse')).toMatchObject({ enabled: false, reasonCode: 'GDS_MOVEMENT_IMMUTABLE' });
  });
});
