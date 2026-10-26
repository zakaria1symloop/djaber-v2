// M2 — stock: adjustments → movements (CAT-05), variants (CAT-03), services (CAT-11), low-stock alerts (CAT-09),
// the journal (GDS-02), reversal, the dashboard (GDS-01), the snapshot, expenses & margins (GDS-09).
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { algiersDay } from '../../src/core/time/algiers';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { adjust, createProduct, db, drain, testOrder, wsEvents } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('POST /stock/adjustments', () => {
  it('AT-CAT-09 product-level adjustment on a variant product ⇒ PRODUCT_HAS_VARIANTS; on a variant ⇒ movement with variant; set-exact computes the delta; reason required', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { sku: 'ADJ-V', stock: undefined, variants: [{ name: 'S', price: 2000, stock: 5 }, { name: 'M', price: 2000, stock: 3 }] });
    const [s, m] = p.variants;
    const refused = await adjust(owner, { productId: p.id, type: 'in', quantity: 2, reason: 'correction' }).expect(422);
    expect(refused.body.error.code).toBe('PRODUCT_HAS_VARIANTS');

    const added = await adjust(owner, { productId: p.id, variantId: s.id, type: 'in', quantity: 4, reason: 'correction', note: 'Réception' }).expect(201);
    expect(added.body.data).toMatchObject({ type: 'adjustment_in', quantity: 4, before: 5, after: 9, reason: 'correction', note: 'Réception', variant: { id: s.id, name: 'S' }, product: { id: p.id, hasVariants: true }, actor: { id: owner.userId }, reversed: false });
    const set = await adjust(owner, { productId: p.id, variantId: m.id, type: 'set', quantity: 1, reason: 'inventory' }).expect(201);
    expect(set.body.data).toMatchObject({ type: 'adjustment_out', quantity: -2, before: 3, after: 1, reason: 'inventory' });
    const up = await adjust(owner, { productId: p.id, variantId: m.id, type: 'set', quantity: 6, reason: 'inventory' }).expect(201);
    expect(up.body.data).toMatchObject({ type: 'adjustment_in', quantity: 5, before: 1, after: 6 });
    // product stock = Σ active variants, recomputed
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data).toMatchObject({ stock: 15, stockDetail: { total: 15 } });

    const noReason = await adjust(owner, { productId: p.id, variantId: s.id, type: 'in', quantity: 1 }).expect(422);
    expect(noReason.body.error.fields).toEqual({ reason: 'validation.required' });
    expect((await adjust(owner, { productId: p.id, variantId: s.id, type: 'in', quantity: 1, reason: 'order_created' }).expect(422)).body.error.fields.reason).toBe('validation.required');
    expect((await adjust(owner, { productId: p.id, variantId: s.id, type: 'in', quantity: 0, reason: 'other' }).expect(422)).body.error.code).toBe('STOCK_QUANTITY_ZERO');
    expect((await adjust(owner, { productId: p.id, variantId: s.id, type: 'set', quantity: 9, reason: 'other' }).expect(422)).body.error.code).toBe('STOCK_QUANTITY_ZERO');
    expect((await adjust(owner, { productId: p.id, variantId: s.id, type: 'in', quantity: -3, reason: 'other' }).expect(422)).body.error.fields.quantity).toBe('validation.quantity');
    const other = await createProduct(owner, { stock: undefined, variants: [{ name: 'X', price: 1 }] });
    expect((await adjust(owner, { productId: p.id, variantId: other.variants[0].id, type: 'in', quantity: 1, reason: 'other' }).expect(404)).body.error.code).toBe('VARIANT_NOT_FOUND');
    expect(await db.stockMovement.count({ where: { productId: p.id } })).toBe(5); // 2 opening + 3 adjustments
  });

  it('AT-CAT-03 variant product: stock = Σ active variants; variant below its min ⇒ low-stock alert; last variant removed ⇒ simple product again', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { sku: 'VAR-1', stock: 7 });
    // first variant: the product's own quantity is written off, stock now lives on the variants
    const red = (await owner.post(`/products/${p.id}/variants`, { name: 'Rouge', sku: 'VAR-1-R', price: 2600, stock: 4, minStock: 2, attributes: { couleur: 'rouge' } }).expect(201)).body.data;
    expect(red).toMatchObject({ name: 'Rouge', sku: 'VAR-1-R', stock: 4, minStock: 2, stockState: 'ok', isActive: true, attributes: { couleur: 'rouge' } });
    const blue = (await owner.post(`/products/${p.id}/variants`, { name: 'Bleu', price: 2600, stock: 6 }).expect(201)).body.data;
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data).toMatchObject({ hasVariants: true, stock: 10, variantSummary: 'Rouge · Bleu' });
    const journal = await db.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'asc' } });
    expect(journal.map((m) => [m.type, m.reason, m.quantity, m.variantId ? 'v' : 'p'])).toEqual([['in', 'initial', 7, 'p'], ['adjustment_out', 'other', -7, 'p'], ['in', 'initial', 4, 'v'], ['in', 'initial', 6, 'v']]);

    expect((await owner.post(`/products/${p.id}/variants`, { name: 'rouge', price: 100 }).expect(422)).body.error.fields).toEqual({ name: 'validation.invalid' });
    expect((await owner.post(`/products/${p.id}/variants`, { name: 'Vert', price: 0 }).expect(422)).body.error.fields.price).toBe('validation.price');
    expect((await owner.patch(`/products/${p.id}/variants/${red.id}`, { stock: 50 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR'); // stock only by adjustment

    // crossing the variant threshold raises the alert (CAT-09: per variant)
    await adjust(owner, { productId: p.id, variantId: red.id, type: 'out', quantity: 2, reason: 'breakage' }).expect(201);
    await drain(app, owner.workspaceId);
    const notes = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'stock_low' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.data).toMatchObject({ productId: p.id, variantId: red.id, stock: 2, minStock: 2 });
    const low = await owner.get('/products/low-stock').expect(200);
    expect(low.body.data).toEqual([expect.objectContaining({ productId: p.id, variantId: red.id, variantName: 'Rouge', sku: 'VAR-1-R', stock: 2, minStock: 2, state: 'low' })]);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.stockState).toBe('low');

    // an inactive variant no longer counts in the product stock
    const off = await owner.patch(`/products/${p.id}/variants/${blue.id}`, { isActive: false, price: 2700, minStock: 1 }).expect(200);
    expect(off.body.data).toMatchObject({ isActive: false, price: 2700, minStock: 1, stock: 6 });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.stock).toBe(2);
    await owner.patch(`/products/${p.id}/variants/${blue.id}`, { isActive: true }).expect(200);

    // generator: one variant per combination, existing names skipped, 100 max
    const generated = await owner.post(`/products/${p.id}/variants/generate`, { attributes: [{ name: 'Couleur', values: ['Rouge', 'Noir'] }, { name: 'Taille', values: ['S', 'M'] }], defaultPrice: 3000, defaultStock: 1 }).expect(201);
    expect(generated.body.data.map((v: any) => v.name)).toEqual(['Rouge / S', 'Rouge / M', 'Noir / S', 'Noir / M']);
    expect(generated.body.data[0]).toMatchObject({ price: 3000, stock: 1, attributes: { Couleur: 'Rouge', Taille: 'S' } });
    const tooMany = await owner.post(`/products/${p.id}/variants/generate`, { attributes: [{ name: 'A', values: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { name: 'B', values: Array.from({ length: 10 }, (_, i) => `b${i}`) }], defaultPrice: 1, defaultStock: 0 }).expect(422);
    expect(tooMany.body.error.code).toBe('VARIANT_LIMIT');
    expect((await owner.get(`/products/${p.id}/variants`).expect(200)).body.data).toHaveLength(6);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.stock).toBe(12);

    // soft delete: quantity leaves by a movement, parent recomputed, the name is free again
    await owner.delete(`/products/${p.id}/variants/${blue.id}`).expect(204);
    await owner.delete(`/products/${p.id}/variants/${blue.id}`).expect(404);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.stock).toBe(6);
    expect((await db.stockMovement.findFirstOrThrow({ where: { variantId: blue.id, refType: 'variant' } })).quantity).toBe(-6);
    await owner.post(`/products/${p.id}/variants`, { name: 'Bleu', price: 2600 }).expect(201);
    for (const v of (await owner.get(`/products/${p.id}/variants`).expect(200)).body.data) await owner.delete(`/products/${p.id}/variants/${v.id}`).expect(204);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data).toMatchObject({ hasVariants: false, stock: 0, variants: [] });
    await adjust(owner, { productId: p.id, type: 'in', quantity: 3, reason: 'initial' }).expect(201); // product-level again
  });

  it('AT-CAT-02 service (trackStock=false): stock null, excluded from the dashboard value; adjustment ⇒ PRODUCT_NOT_STOCK_TRACKED', async () => {
    const owner = await asOwner(app);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { stockMode: 'advanced' } });
    await app.app.get(TenantResolver).invalidate(owner.workspaceId); // the workspace context is cached 30 s
    const service = await createProduct(owner, { name: 'Retouche', price: 800, costPrice: 100, trackStock: false, stock: 50 });
    expect(service).toMatchObject({ stock: null, trackStock: false });
    const refused = await adjust(owner, { productId: service.id, type: 'in', quantity: 1, reason: 'correction' }).expect(422);
    expect(refused.body.error.code).toBe('PRODUCT_NOT_STOCK_TRACKED');
    expect((await owner.post(`/products/${service.id}/variants`, { name: 'Express', price: 1200 }).expect(422)).body.error.code).toBe('PRODUCT_NOT_STOCK_TRACKED');
    expect((await owner.post('/products/bulk/min-stock', { ids: [service.id], minStock: 3 }).expect(200)).body.data.results[0]).toMatchObject({ ok: false, error: { code: 'PRODUCT_NOT_STOCK_TRACKED' } });

    await createProduct(owner, { name: 'Tracked', price: 1000, costPrice: 600, stock: 10 });
    const overview = (await owner.get('/stock/overview').expect(200)).body.data;
    expect(overview).toMatchObject({ mode: 'advanced', totalProducts: 2, trackedProducts: 1, services: 1, totalItems: 10, valueAtCost: 6000, valueAtRetail: 10000, potentialMargin: 4000, lowStockCount: 0, outOfStockCount: 0 });
    expect((await owner.get('/products/low-stock').expect(200)).body.data).toEqual([]);
    expect((await owner.get(`/stock/snapshot?date=${algiersDay()}`).expect(200)).body.data.map((r: any) => r.name)).toEqual(['Tracked']);

    // tracked → service writes the quantity off and clears it; service → tracked starts at 0
    const tracked = await createProduct(owner, { name: 'Bascule', price: 500, stock: 4 });
    const off = await owner.patch(`/products/${tracked.id}`, { trackStock: false, version: 1 }).expect(200);
    expect(off.body.data).toMatchObject({ trackStock: false, stock: null, stockState: 'untracked' });
    expect((await db.stockMovement.findMany({ where: { productId: tracked.id }, orderBy: { createdAt: 'asc' } })).map((m) => m.quantity)).toEqual([4, -4]);
    expect((await owner.patch(`/products/${tracked.id}`, { trackStock: true, version: 2 }).expect(200)).body.data).toMatchObject({ trackStock: true, stock: 0 });
  });

  it('in / out / set on a simple product; insufficient ⇒ STOCK_INSUFFICIENT {available}; force lets Admin+ go negative', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { stock: 5 });
    const out = await adjust(owner, { productId: p.id, type: 'out', quantity: 2, reason: 'loss' }).expect(201);
    expect(out.body.data).toMatchObject({ type: 'adjustment_out', quantity: -2, before: 5, after: 3, variant: null, reference: null });
    const short = await adjust(owner, { productId: p.id, type: 'out', quantity: 4, reason: 'loss' }).expect(422);
    expect(short.body.error).toMatchObject({ code: 'STOCK_INSUFFICIENT', params: { available: 3 } });
    const forced = await adjust(owner, { productId: p.id, type: 'out', quantity: 4, reason: 'loss', force: true }).expect(201);
    expect(forced.body.data).toMatchObject({ before: 3, after: -1 });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data).toMatchObject({ stock: -1, stockState: 'out' });
    expect((await adjust(owner, { productId: '018f0000-0000-7000-8000-000000000000', type: 'in', quantity: 1, reason: 'other' }).expect(404)).body.error.code).toBe('NOT_FOUND');
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'stock.adjust', entityId: out.body.data.id } }));
    expect(audit).toMatchObject({ entity: 'StockMovement', actorId: owner.userId });
  });

  it('Idempotency-Key required; replay returns the stored movement once; roles (Admin+) and cross-workspace 404', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(owner, { stock: 5 });
    const body = { productId: p.id, type: 'in', quantity: 3, reason: 'correction' };

    expect((await owner.post('/stock/adjustments', body).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const first = await owner.post('/stock/adjustments', body).set('Idempotency-Key', 'adj-1').expect(201);
    const replay = await owner.post('/stock/adjustments', body).set('Idempotency-Key', 'adj-1').expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect((await owner.post('/stock/adjustments', { ...body, quantity: 9 }).set('Idempotency-Key', 'adj-1').expect(422)).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(8);

    await adjust(admin, body).expect(201);
    expect((await adjust(operator, body).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await adjust(stranger, body).expect(404)).body.error.code).toBe('NOT_FOUND');
    // the operator reads the journal and the dashboard
    expect((await operator.get('/stock/movements').expect(200)).body.meta.total).toBe(3);
    await operator.get('/stock/overview').expect(200);
    await operator.get(`/stock/movements/${first.body.data.id}`).expect(200);
    expect((await operator.post(`/stock/movements/${first.body.data.id}/reverse`, {}).expect(403)).body.error.code).toBe('FORBIDDEN');
    // …with the reverse entry greyed out
    expect((await operator.get(`/stock/movements/${first.body.data.id}`).expect(200)).body.data.actions).toEqual([{ key: 'open_product', enabled: true }, { key: 'reverse', enabled: false, reasonCode: 'FORBIDDEN' }]);
    await stranger.get(`/stock/movements/${first.body.data.id}`).expect(404);
    await stranger.post(`/stock/movements/${first.body.data.id}/reverse`, {}).expect(404);
    expect((await stranger.get('/stock/movements').expect(200)).body.data).toEqual([]);
  });
});

describe('low stock (CAT-09)', () => {
  it('tester notes 25/10: two variants of one product going low the same day ⇒ one alert each', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { name: 'Tee', sku: 'TEE-V', variants: [{ name: 'S', price: 1500, stock: 5, minStock: 2 }, { name: 'M', price: 1500, stock: 5, minStock: 2 }] });
    const [vs, vm] = (await owner.get(`/products/${p.id}/variants`).expect(200)).body.data;
    await adjust(owner, { productId: p.id, variantId: vs.id, type: 'out', quantity: 3, reason: 'breakage' }).expect(201);
    await adjust(owner, { productId: p.id, variantId: vm.id, type: 'out', quantity: 3, reason: 'breakage' }).expect(201);
    const keys = (await db.outbox.findMany({ where: { workspaceId: owner.workspaceId, topic: 'notification', key: { startsWith: 'stock_low:' } } })).map((r) => r.key).sort();
    expect(keys).toEqual([`stock_low:${p.id}:${vm.id}:${algiersDay()}`, `stock_low:${p.id}:${vs.id}:${algiersDay()}`].sort());
  });

  it('AT-CAT-08 low-stock crossing ⇒ one notification per day max; `stock.low` webhook once', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const p = await createProduct(owner, { name: 'Savon', sku: 'SAV-1', stock: 10, minStock: 4 });
    // M10: the grouped `product.approved` of the creation (auto-approved) is not part of the stock rows
    const lowRows = () => db.outbox.findMany({ where: { workspaceId: owner.workspaceId, topic: { in: ['notification', 'webhook'] }, NOT: [{ key: { startsWith: 'product_approved:' } }, { key: { startsWith: 'product.moderation_changed:' } }] }, orderBy: { createdAt: 'asc' } });

    await adjust(owner, { productId: p.id, type: 'out', quantity: 3, reason: 'breakage' }).expect(201); // 7: above the threshold
    expect(await lowRows()).toHaveLength(0);
    await adjust(owner, { productId: p.id, type: 'out', quantity: 3, reason: 'breakage' }).expect(201); // 4 = min ⇒ low
    const first = await lowRows();
    expect(first.map((r) => `${r.topic} ${r.key}`).sort()).toEqual([`notification stock_low:${p.id}:${algiersDay()}`, `webhook stock.low:${p.id}:${algiersDay()}`]);
    expect(first.find((r) => r.topic === 'webhook')!.payload).toMatchObject({ event: 'stock.low', data: { productId: p.id, sku: 'SAV-1', name: 'Savon', stock: 4, minStock: 4 } });
    expect((await wsEvents(owner.workspaceId, 'product.updated')).at(-1)!.payload.product).toMatchObject({ id: p.id, stock: 4, lowStock: true });

    // back above, then under again the same day: no second notification, no second webhook
    await adjust(owner, { productId: p.id, type: 'in', quantity: 5, reason: 'correction' }).expect(201);
    await adjust(owner, { productId: p.id, type: 'out', quantity: 6, reason: 'loss' }).expect(201); // 3
    expect(await lowRows()).toHaveLength(2);
    await drain(app, owner.workspaceId);
    await drain(app, owner.workspaceId);
    const notifications = await db.notification.findMany({ where: { workspaceId: owner.workspaceId, type: 'stock_low' } });
    expect(notifications.map((n) => n.userId).sort()).toEqual([owner.userId, admin.userId].sort()); // one row per member
    expect(notifications[0]!.data).toMatchObject({ productId: p.id, stock: 4, minStock: 4 });

    // reaching 0 is a different event: stock.out, once
    await adjust(owner, { productId: p.id, type: 'set', quantity: 0, reason: 'inventory' }).expect(201);
    await adjust(owner, { productId: p.id, type: 'in', quantity: 1, reason: 'correction' }).expect(201);
    await adjust(owner, { productId: p.id, type: 'out', quantity: 1, reason: 'loss' }).expect(201);
    expect((await lowRows()).map((r) => r.key).sort()).toEqual([`stock.low:${p.id}:${algiersDay()}`, `stock.out:${p.id}:${algiersDay()}`, `stock_low:${p.id}:${algiersDay()}`, `stock_out:${p.id}:${algiersDay()}`]);
    const list = await owner.get('/products?lowStock=1').expect(200);
    expect(list.body.data.map((r: any) => [r.id, r.stockState])).toEqual([[p.id, 'out']]);
    expect((await owner.get('/products/low-stock').expect(200)).body.data).toEqual([expect.objectContaining({ productId: p.id, variantId: null, stock: 0, state: 'out' })]);
    expect((await owner.get('/stock/overview').expect(200)).body.data).toMatchObject({ mode: 'simple', lowStockCount: 0, outOfStockCount: 1, valueAtCost: null });
  });
});

describe('movements journal (GDS-02), reverse, snapshot', () => {
  it('filters (product, variant, type, reason, actor, dates, quantity, category, search), sort, paging; reverse = inverse movement', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const category = (await owner.post('/categories', { name: 'Hygiène' }).expect(201)).body.data.id;
    const a = await createProduct(owner, { name: 'Gel douche', sku: 'GEL', stock: 20, categoryId: category });
    const b = await createProduct(owner, { name: 'Brosse', sku: 'BRO', stock: undefined, variants: [{ name: 'Souple', price: 300, stock: 8 }] });
    const out = (await adjust(admin, { productId: a.id, type: 'out', quantity: 5, reason: 'breakage', note: 'Carton écrasé' }).expect(201)).body.data;
    await adjust(owner, { productId: b.id, variantId: b.variants[0].id, type: 'in', quantity: 2, reason: 'correction' }).expect(201);
    const total = async (qs: string) => (await owner.get(`/stock/movements?${qs}`).expect(200)).body.meta.total;

    const all = await owner.get('/stock/movements').expect(200);
    expect(all.body.meta).toMatchObject({ page: 1, pageSize: 25, total: 4 });
    expect(all.body.data[0]).toMatchObject({ type: 'adjustment_in', quantity: 2, variant: { name: 'Souple' }, product: { sku: 'BRO' } }); // newest first
    expect(await total(`productId=${a.id}`)).toBe(2);
    expect(await total(`variantId=${b.variants[0].id}`)).toBe(2);
    expect(await total('type=in')).toBe(2);
    expect(await total('type=adjustment_out,adjustment_in')).toBe(2);
    expect(await total('reason=breakage')).toBe(1);
    expect(await total('refType=manual')).toBe(4);
    expect(await total(`createdById=${admin.userId}`)).toBe(1);
    expect(await total('createdById=system')).toBe(0);
    expect(await total(`from=${algiersDay()}&to=${algiersDay()}`)).toBe(4);
    expect(await total(`to=${algiersDay(new Date(Date.now() - 86400_000))}`)).toBe(0);
    expect(await total('minQty=5')).toBe(3);
    expect(await total('maxQty=5')).toBe(2);
    expect(await total(`categoryId=${category}`)).toBe(2);
    expect(await total('q=carton')).toBe(1);
    expect(await total('q=souple')).toBe(2);
    expect(await total('q=gel')).toBe(2);
    expect((await owner.get('/stock/movements?sort=createdAt').expect(200)).body.data[0]).toMatchObject({ type: 'in', quantity: 20 });
    expect((await owner.get('/stock/movements?sort=quantity').expect(400)).body.error.code).toBe('BAD_REQUEST');
    expect((await owner.get('/stock/movements?type=nope').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await owner.get('/stock/movements?limit=2').expect(200)).body.data).toHaveLength(2);

    // contre-passer: the journal is append-only, the correction is a new movement
    const reversed = await owner.post(`/stock/movements/${out.id}/reverse`, { note: 'Erreur de saisie' }).expect(201);
    expect(reversed.body.data).toMatchObject({ type: 'adjustment_in', quantity: 5, before: 15, after: 20, reason: 'correction', note: 'Erreur de saisie', reference: { type: 'manual', id: out.id } });
    const original = (await owner.get(`/stock/movements/${out.id}`).expect(200)).body.data;
    expect(original).toMatchObject({ reversed: true, quantity: -5 });
    expect(original.actions.find((x: any) => x.key === 'reverse')).toEqual({ key: 'reverse', enabled: false, reasonCode: 'GDS_MOVEMENT_IMMUTABLE' });
    expect((await owner.post(`/stock/movements/${out.id}/reverse`).expect(403)).body.error.code).toBe('GDS_MOVEMENT_IMMUTABLE'); // once (a body is optional)
    expect((await owner.post(`/stock/movements/${reversed.body.data.id}/reverse`, {}).expect(403)).body.error.code).toBe('GDS_MOVEMENT_IMMUTABLE'); // a reversal is final
    expect((await db.product.findUniqueOrThrow({ where: { id: a.id } })).stock).toBe(20);
    // a reversal that would make the stock negative is refused
    const small = await createProduct(owner, { stock: 0 });
    const plus = (await adjust(owner, { productId: small.id, type: 'in', quantity: 3, reason: 'correction' }).expect(201)).body.data;
    await adjust(owner, { productId: small.id, type: 'out', quantity: 3, reason: 'loss' }).expect(201);
    expect((await owner.post(`/stock/movements/${plus.id}/reverse`, {}).expect(422)).body.error.code).toBe('STOCK_INSUFFICIENT');
  });

  it('snapshot: stock as of the end of a day, replayed from the movements; before the workspace existed ⇒ INVALID_DATE_RANGE', async () => {
    const owner = await asOwner(app);
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { createdAt: new Date(Date.now() - 10 * 86400_000) } });
    const p = await createProduct(owner, { name: 'Bougie', sku: 'BOU', price: 900, costPrice: 400, stock: 12 });
    const v = await createProduct(owner, { name: 'Vase', sku: 'VAS', costPrice: 1000, stock: undefined, variants: [{ name: 'Grand', sku: 'VAS-G', price: 5000, costPrice: 1500, stock: 2 }] });
    await adjust(owner, { productId: p.id, type: 'out', quantity: 2, reason: 'loss' }).expect(201);
    // age the rows: created 3 days ago, the loss happened yesterday; one more movement today
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
    await db.product.updateMany({ where: { workspaceId: owner.workspaceId }, data: { createdAt: daysAgo(3) } });
    await db.productVariant.updateMany({ where: { workspaceId: owner.workspaceId }, data: { createdAt: daysAgo(3) } });
    await db.stockMovement.updateMany({ where: { workspaceId: owner.workspaceId, reason: 'initial' }, data: { createdAt: daysAgo(3) } });
    await db.stockMovement.updateMany({ where: { workspaceId: owner.workspaceId, reason: 'loss' }, data: { createdAt: daysAgo(1) } });
    await adjust(owner, { productId: p.id, type: 'in', quantity: 30, reason: 'correction' }).expect(201);

    const today = await owner.get(`/stock/snapshot?date=${algiersDay()}`).expect(200);
    expect(today.body.data).toEqual([
      { productId: p.id, variantId: null, name: 'Bougie', sku: 'BOU', quantityAtDate: 40, costPriceAtDate: 400, valueAtDate: 16000 },
      { productId: v.id, variantId: v.variants[0].id, name: 'Vase — Grand', sku: 'VAS-G', quantityAtDate: 2, costPriceAtDate: 1500, valueAtDate: 3000 },
    ]);
    expect(today.body.meta).toMatchObject({ total: 2, totalValue: 19000, date: algiersDay(), page: 1 });
    const yesterday = await owner.get(`/stock/snapshot?date=${algiersDay(daysAgo(1))}`).expect(200);
    expect(yesterday.body.data.map((r: any) => r.quantityAtDate)).toEqual([10, 2]);
    const before = await owner.get(`/stock/snapshot?date=${algiersDay(daysAgo(2))}&q=bou`).expect(200);
    expect(before.body.data).toEqual([expect.objectContaining({ name: 'Bougie', quantityAtDate: 12, valueAtDate: 4800 })]);
    expect((await owner.get(`/stock/snapshot?date=${algiersDay(daysAgo(5))}`).expect(200)).body.data).toEqual([]); // nothing existed yet
    expect((await owner.get(`/stock/snapshot?date=${algiersDay(daysAgo(30))}`).expect(422)).body.error.code).toBe('INVALID_DATE_RANGE');
    expect((await owner.get('/stock/snapshot').expect(422)).body.error.fields.date).toBe('validation.required');
    expect((await owner.get('/stock/snapshot?date=2026-13-45').expect(422)).body.error.fields.date).toBe('validation.date');
  });
});

describe('expenses & margins (GDS-09)', () => {
  it('CRUD of product expenses; true cost = weighted cost + per-unit + fixed / units sold; margin % on the price', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(owner, { name: 'Parfum', price: 6000, costPrice: 3000, stock: 30 });
    expect((await owner.get(`/products/${p.id}/margins`).expect(200)).body.data).toMatchObject({ weightedCost: 3000, expensesPerUnit: 0, trueCost: 3000, marginDzd: 3000, marginPct: 50 });

    const packaging = await owner.post(`/products/${p.id}/expenses`, { category: 'packaging', amount: 200, isPerUnit: true, description: 'Coffret' }).expect(201);
    expect(packaging.body.data).toMatchObject({ category: 'packaging', amount: 200, isPerUnit: true, description: 'Coffret', productId: p.id });
    const ads = await owner.post(`/products/${p.id}/expenses`, { category: 'marketing', amount: 4000, isPerUnit: false, date: algiersDay(new Date(Date.now() - 60 * 86400_000)) }).expect(201);
    await owner.post(`/products/${p.id}/expenses`, { category: 'marketing', amount: 1000, isPerUnit: false }).expect(201);
    expect((await owner.get(`/products/${p.id}/expenses`).expect(200)).body.data).toHaveLength(3);
    // nothing sold yet: the fixed expense of the period weighs on one unit; the one dated 60 days ago is outside the 30-day period
    expect((await owner.get(`/products/${p.id}/margins`).expect(200)).body.data).toMatchObject({ expensesPerUnit: 1200, trueCost: 4200, marginDzd: 1800, marginPct: 30 });
    await testOrder(owner.workspaceId, p, { quantity: 10, unitPrice: 6000, status: 'delivered' });
    await testOrder(owner.workspaceId, p, { quantity: 4, unitPrice: 6000, status: 'cancelled' });
    const margins = (await owner.get(`/products/${p.id}/margins`).expect(200)).body.data;
    expect(margins).toMatchObject({ expensesPerUnit: 300, trueCost: 3300, marginDzd: 2700, marginPct: 45, sales30d: { units: 10, revenue: 60000 } });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.pricing).toEqual(margins);
    // tester report 2026-10-20: the list shows (and filters on) the same margin as the product page, expenses included
    const listed = (await owner.get(`/products?ids=${p.id}`).expect(200)).body.data[0];
    expect(listed.marginPct).toBe(45);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.marginPct).toBe(45);
    expect((await owner.get(`/products?ids=${p.id}&minMargin=46`).expect(200)).body.data).toHaveLength(0);
    expect((await owner.get(`/products?ids=${p.id}&minMargin=44&maxMargin=46`).expect(200)).body.data).toHaveLength(1);

    expect((await owner.patch(`/products/${p.id}/expenses/${ads.body.data.id}`, { amount: 500, date: algiersDay() }).expect(200)).body.data).toMatchObject({ amount: 500 });
    expect((await owner.get(`/products/${p.id}/margins`).expect(200)).body.data.expensesPerUnit).toBe(350);
    await owner.delete(`/products/${p.id}/expenses/${packaging.body.data.id}`).expect(204);
    await owner.delete(`/products/${p.id}/expenses/${packaging.body.data.id}`).expect(404);

    expect((await owner.post(`/products/${p.id}/expenses`, { category: 'bribe', amount: 1, isPerUnit: true }).expect(422)).body.error.fields.category).toBe('validation.required');
    expect((await owner.post(`/products/${p.id}/expenses`, { category: 'other', amount: 0, isPerUnit: true }).expect(422)).body.error.fields.amount).toBe('validation.price');
    expect((await owner.post(`/products/${p.id}/expenses`, { category: 'other', amount: 5 }).expect(422)).body.error.fields.isPerUnit).toBe('validation.required');
    expect((await owner.post(`/products/${p.id}/expenses`, { category: 'other', amount: 5, isPerUnit: true, date: '2999-01-01' }).expect(422)).body.error.fields.date).toBe('validation.date');
    await operator.get(`/products/${p.id}/expenses`).expect(200);
    expect((await operator.post(`/products/${p.id}/expenses`, { category: 'other', amount: 5, isPerUnit: true }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.delete(`/products/${p.id}/expenses/${ads.body.data.id}`).expect(403);
    await stranger.get(`/products/${p.id}/expenses`).expect(404);
    await stranger.post(`/products/${p.id}/expenses`, { category: 'other', amount: 5, isPerUnit: true }).expect(404);
    await stranger.patch(`/products/${p.id}/expenses/${ads.body.data.id}`, { amount: 1 }).expect(404);
    await stranger.delete(`/products/${p.id}/expenses/${ads.body.data.id}`).expect(404);
  });
});
