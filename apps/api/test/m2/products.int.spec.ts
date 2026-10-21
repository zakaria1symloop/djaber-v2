// M2 — products: CRUD with one validation (CAT-01), SKU uniqueness across products and variants, services (CAT-11),
// list filters and sorts (CAT-08), archive / restore / hard delete (CAT-10), duplicate, plan limit, moderation hooks (D36).
import { formatMoney } from '@djaber/shared';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { adjust, createProduct, db, productBody, testAgent, testOrder, wsEvents } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('POST /products', () => {
  it('AT-CAT-01 selling 0 ⇒ validation.price; selling < cost ⇒ saved with warning; SKU equal to a variant SKU ⇒ 409', async () => {
    const owner = await asOwner(app);
    const zero = await owner.post('/products', productBody({ price: 0 })).expect(422);
    expect(zero.body.error).toMatchObject({ code: 'VALIDATION_ERROR', fields: { price: 'validation.price' } });
    expect((await owner.post('/products', productBody({ price: 12.5 })).expect(422)).body.error.fields.price).toBe('validation.price');

    const cheap = await owner.post('/products', productBody({ price: 900, costPrice: 1200 })).expect(201);
    expect(cheap.body.data).toMatchObject({ price: 900, costPrice: 1200, marginPct: -33.3 });
    expect(cheap.body.meta.warnings).toEqual([{ code: 'SELLING_BELOW_COST', field: 'price' }]);

    const withVariants = await createProduct(owner, { sku: 'TSHIRT', stock: undefined, variants: [{ name: 'S', sku: 'TSHIRT-S', price: 2500, stock: 3 }, { name: 'M', sku: 'TSHIRT-M', price: 2500 }] });
    expect(withVariants.hasVariants).toBe(true);
    const clash = await owner.post('/products', productBody({ sku: 'TSHIRT-S' })).expect(409);
    expect(clash.body.error).toMatchObject({ code: 'PRODUCT_SKU_ALREADY_EXISTS', fields: { sku: 'validation.sku_taken' } });
    // …and the other way round: a variant may not take a product SKU, nor the SKU of another variant
    const other = await createProduct(owner, { sku: 'MUG' });
    expect((await owner.post(`/products/${other.id}/variants`, { name: 'Bleu', sku: 'TSHIRT', price: 900 }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    expect((await owner.post(`/products/${other.id}/variants`, { name: 'Bleu', sku: 'TSHIRT-M', price: 900 }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    const inPayload = await owner.post('/products', productBody({ sku: 'CAP', stock: undefined, variants: [{ name: 'A', sku: 'CAP', price: 100 }] })).expect(409);
    expect(inPayload.body.error.fields).toEqual({ 'variants.0.sku': 'validation.sku_taken' });
    // the same SKU is free in another workspace
    await (await asOwner(app)).post('/products', productBody({ sku: 'TSHIRT-S' })).expect(201);
  });

  it('creates a tracked product: generated SKU, opening stock as an `in` movement, moderation item auto-approved, WS + audit', async () => {
    const owner = await asOwner(app);
    const res = await owner.post('/products', { name: '  Montre classique ', price: 12500, stock: 8, minStock: 2, keywords: ['montre', 'cadeau'] }).expect(201);
    const p = res.body.data;
    expect(p).toMatchObject({
      name: 'Montre classique',
      price: 12500,
      stock: 8,
      minStock: 2,
      stockState: 'ok',
      trackStock: true,
      hasVariants: false,
      isActive: true,
      archived: false,
      aiState: 'proposed',
      moderation: { status: 'approved' },
      keywords: ['montre', 'cadeau'],
      images: [],
      variants: [],
      version: 1,
      contentVersion: 1,
      stockDetail: { total: 8, reserved: 0, availableForAi: 8, lastInventoryAt: null },
      pricing: { weightedCost: null, trueCost: null, marginPct: null, sales30d: { units: 0, revenue: 0 } },
    });
    expect(p.sku).toMatch(/^PRD-[0-9A-Z]{8}$/);
    expect(p.workspaceId).toBeUndefined();
    expect(p.actions.map((a: any) => a.key)).toEqual(['open', 'edit', 'duplicate', 'adjust_stock', 'deactivate', 'archive', 'delete']);
    expect(p.actions.every((a: any) => a.enabled)).toBe(true);

    const movements = await db.stockMovement.findMany({ where: { productId: p.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'in', reason: 'initial', quantity: 8, quantityBefore: 0, quantityAfter: 8, actorId: owner.userId });
    const item = await db.moderationItem.findFirstOrThrow({ where: { productId: p.id } });
    expect(item).toMatchObject({ type: 'product', status: 'auto_approved', contentVersion: 1, source: 'create', workspaceId: owner.workspaceId });
    expect((item.snapshot as any).title).toBe('Montre classique');
    expect((await wsEvents(owner.workspaceId, 'product.updated')).at(-1)!.payload.product).toMatchObject({ id: p.id, stock: 8, lowStock: false, moderationStatus: 'approved' });
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'product.create', entityId: p.id } }));
    expect(audit).toMatchObject({ entity: 'Product', actorId: owner.userId });
  });

  it('422: stock required for a tracked product without variants; unknown category / unit; unknown fields; a service cannot have variants', async () => {
    const owner = await asOwner(app);
    expect((await owner.post('/products', { name: 'Sans stock', price: 100 }).expect(422)).body.error.fields).toEqual({ stock: 'validation.required' });
    expect((await owner.post('/products', productBody({ name: '' })).expect(422)).body.error.fields.name).toBe('validation.required');
    expect((await owner.post('/products', productBody({ name: 'x'.repeat(256) })).expect(422)).body.error.fields.name).toBe('validation.length');
    expect((await owner.post('/products', productBody({ stock: -1 })).expect(422)).body.error.fields.stock).toBe('validation.quantity');
    expect((await owner.post('/products', productBody({ workspaceId: owner.workspaceId })).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    const ghost = '018f0000-0000-7000-8000-000000000000';
    expect((await owner.post('/products', productBody({ categoryId: ghost })).expect(422)).body.error.fields).toEqual({ categoryId: 'validation.invalid' });
    expect((await owner.post('/products', productBody({ unitId: ghost })).expect(422)).body.error.fields).toEqual({ unitId: 'validation.invalid' });
    const service = await owner.post('/products', { name: 'Gravure', price: 500, trackStock: false, variants: [{ name: 'A', price: 1 }] }).expect(422);
    expect(service.body.error.fields).toHaveProperty('variants');
    // a category of another workspace is not a valid reference
    const foreign = (await (await asOwner(app)).post('/categories', { name: 'Ailleurs' }).expect(201)).body.data.id;
    expect((await owner.post('/products', productBody({ categoryId: foreign })).expect(422)).body.error.fields).toEqual({ categoryId: 'validation.invalid' });
  });

  it('roles: owner and admin write, operator reads only (403); other workspace ⇒ 404; idempotent replay', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(admin, { sku: 'ROLE-1' });

    expect((await operator.post('/products', productBody()).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await operator.patch(`/products/${p.id}`, { name: 'x', version: 1 }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.delete(`/products/${p.id}`).expect(403);
    await operator.post(`/products/${p.id}/restore`).expect(403);
    await operator.post(`/products/${p.id}/duplicate`, { name: 'Copie' }).expect(403);
    const seen = await operator.get(`/products/${p.id}`).expect(200);
    // the operator sees the menu with the write entries greyed out
    expect(seen.body.data.actions.find((a: any) => a.key === 'edit')).toEqual({ key: 'edit', enabled: false, reasonCode: 'FORBIDDEN' });
    expect(seen.body.data.actions.find((a: any) => a.key === 'open')).toMatchObject({ enabled: true });
    expect((await operator.get('/products').expect(200)).body.data).toHaveLength(1);

    for (const call of [
      () => stranger.get(`/products/${p.id}`),
      () => stranger.patch(`/products/${p.id}`, { name: 'x', version: 1 }),
      () => stranger.delete(`/products/${p.id}`),
      () => stranger.post(`/products/${p.id}/restore`),
      () => stranger.post(`/products/${p.id}/duplicate`, { name: 'Copie' }),
      () => stranger.get(`/products/${p.id}/relations`),
      () => stranger.get(`/products/${p.id}/card-preview`),
      () => stranger.get(`/products/${p.id}/margins`),
      () => stranger.get(`/products/${p.id}/moderation`),
      () => stranger.get(`/products/${p.id}/variants`),
    ]) {
      const r = await call();
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
    expect((await stranger.get('/products').expect(200)).body.data).toHaveLength(0);
    expect((await stranger.get(`/products/${p.id}`).set('X-Workspace-Id', owner.workspaceId).expect(404)).body.error.code).toBe('NOT_FOUND');

    const body = productBody({ sku: 'IDEM-1' });
    const first = await owner.post('/products', body).set('Idempotency-Key', 'create-idem-1').expect(201);
    const replay = await owner.post('/products', body).set('Idempotency-Key', 'create-idem-1').expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId, sku: 'IDEM-1' } })).toBe(1);
    expect((await owner.post('/products', { ...body, name: 'autre' }).set('Idempotency-Key', 'create-idem-1').expect(422)).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('plan limit: free plan = 50 products ⇒ 403 PLAN_LIMIT { resource, limit, current }; archiving frees a slot', async () => {
    const owner = await asOwner(app, 'free');
    await db.product.createMany({ data: Array.from({ length: 49 }, (_, i) => ({ workspaceId: owner.workspaceId, sku: `F-${i}`, name: `Free ${i}`, price: 100, stock: 1 })) });
    const last = await createProduct(owner, { sku: 'F-49' });
    const over = await owner.post('/products', productBody()).expect(403);
    expect(over.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'products', limit: 50, current: 50 } });
    expect((await owner.post(`/products/${last.id}/duplicate`, { name: 'Copie' }).expect(403)).body.error.code).toBe('PLAN_LIMIT');
    await owner.delete(`/products/${last.id}`).expect(204);
    const fits = await createProduct(owner, { sku: 'F-50' });
    // restoring the archived one would exceed the plan again
    expect((await owner.post(`/products/${last.id}/restore`).expect(403)).body.error.code).toBe('PLAN_LIMIT');
    expect(fits.sku).toBe('F-50');
  });
});

describe('PATCH /products/:id', () => {
  it('same validation as create, version bump, 409 CONFLICT with details.current on a stale version', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { sku: 'EDIT-1', price: 4000 });
    expect((await owner.patch(`/products/${p.id}`, { name: 'Sans version' }).expect(422)).body.error.fields.version).toBeDefined();
    expect((await owner.patch(`/products/${p.id}`, { price: 0, version: 1 }).expect(422)).body.error.fields.price).toBe('validation.price');
    expect((await owner.patch(`/products/${p.id}`, { stock: 3, version: 1 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR'); // stock only moves by adjustment

    const updated = await owner.patch(`/products/${p.id}`, { name: 'Nouveau nom', costPrice: 5000, minStock: 4, keywords: ['a'], version: 1 }).expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Nouveau nom', costPrice: 5000, minStock: 4, version: 2, marginPct: -25 });
    expect(updated.body.meta.warnings).toEqual([{ code: 'SELLING_BELOW_COST', field: 'price' }]);

    const stale = await owner.patch(`/products/${p.id}`, { name: 'Trop tard', version: 1 }).expect(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.error.details).toMatchObject({ changedAt: expect.any(String), current: { id: p.id, name: 'Nouveau nom', version: 2 } });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.name).toBe('Nouveau nom');

    // SKU change re-checks the workspace-wide rule
    await createProduct(owner, { sku: 'EDIT-2' });
    expect((await owner.patch(`/products/${p.id}`, { sku: 'EDIT-2', version: 2 }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    expect((await owner.patch(`/products/${p.id}`, { sku: 'EDIT-1B', version: 2 }).expect(200)).body.data).toMatchObject({ sku: 'EDIT-1B', version: 3 });
    const audits = await eventually(async () => {
      const rows = await db.auditLog.findMany({ where: { workspaceId: owner.workspaceId, action: 'product.update', entityId: p.id } });
      return rows.length >= 2 ? rows : null;
    });
    expect(audits).toHaveLength(2);
  });

  it('AT-MOD-02 moderation hook: stock / minStock / variants edits create no item; name, category or price ±50 % do', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { price: 4000, stock: 5 });
    const items = () => db.moderationItem.count({ where: { productId: p.id } });
    expect(await items()).toBe(1);

    await owner.patch(`/products/${p.id}`, { minStock: 3, keywords: ['x'], weightGrams: 200, isActive: false, version: 1 }).expect(200);
    await adjust(owner, { productId: p.id, type: 'in', quantity: 2, reason: 'correction' }).expect(201);
    await owner.patch(`/products/${p.id}`, { price: 3500, version: 2 }).expect(200); // −12.5 %
    expect(await items()).toBe(1);

    const cut = await owner.patch(`/products/${p.id}`, { price: 1800, version: 3 }).expect(200); // −48.6 % from 3 500: still under 50 %
    expect(await items()).toBe(1);
    const half = await owner.patch(`/products/${p.id}`, { price: 900, version: cut.body.data.version }).expect(200); // −50 %
    expect(await items()).toBe(2);
    expect(half.body.data).toMatchObject({ contentVersion: 2, moderation: { status: 'approved' } });
    await owner.patch(`/products/${p.id}`, { name: 'Autre titre', version: half.body.data.version }).expect(200);
    expect(await items()).toBe(3);
    const last = await db.moderationItem.findFirstOrThrow({ where: { productId: p.id }, orderBy: { contentVersion: 'desc' } });
    expect(last).toMatchObject({ contentVersion: 3, source: 'update', status: 'auto_approved' });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).approvedSnapshot).toMatchObject({ title: 'Autre titre', price: 900 });

    const detail = await owner.get(`/products/${p.id}/moderation`).expect(200);
    expect(detail.body.data).toMatchObject({ status: 'approved', contentVersion: 3, item: { decision: null }, appeal: { status: 'available' } });
    expect(detail.body.data.history).toHaveLength(6);
    expect((await owner.get('/moderation/summary').expect(200)).body.data).toEqual({ pending: 0, rejected: 0, appealed: 0, trustLevel: 'standard' });
  });

  it('moderation, merchant side: resubmit only when rejected; appeal once, within 7 days', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const p = await createProduct(owner);
    expect((await owner.post(`/products/${p.id}/resubmit`).expect(409)).body.error.code).toBe('MODERATION_NOT_REJECTED');
    expect((await owner.post(`/products/${p.id}/appeal`, { message: 'Facture jointe' }).expect(409)).body.error.code).toBe('MODERATION_NOT_REJECTED');
    await operator.post(`/products/${p.id}/appeal`, { message: 'x' }).expect(403);

    // a moderator rejection (admin queue = M10) is simulated on the rows
    const reject = async (productId: string, decidedAt: Date) => {
      const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
      await db.moderationItem.update({ where: { id: row.moderationItemId! }, data: { status: 'rejected', decision: 'counterfeit', merchantMessage: 'Marque protégée', rejectedFields: ['name'], decidedAt } });
      await db.product.update({ where: { id: productId }, data: { moderationStatus: 'rejected' } });
    };
    await reject(p.id, new Date());
    const row = (await owner.get('/products?moderationStatus=rejected').expect(200)).body.data;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ id: p.id, aiState: 'excluded', moderation: { status: 'rejected', reason: 'counterfeit' } });
    expect((await owner.get('/moderation/summary').expect(200)).body.data).toMatchObject({ rejected: 1 });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.moderationDetail).toMatchObject({ status: 'rejected', decision: 'counterfeit', merchantMessage: 'Marque protégée', rejectedFields: ['name'], appeal: { status: 'available' } });

    expect((await owner.post(`/products/${p.id}/appeal`, { message: 'x'.repeat(501) }).expect(422)).body.error.fields.message).toBe('validation.length');
    const appeal = await owner.post(`/products/${p.id}/appeal`, { message: 'Nous sommes revendeur agréé.' }).expect(201);
    expect(appeal.body.data).toMatchObject({ status: 'appealed', deadlineAt: expect.any(String) });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data).toMatchObject({ moderation: { status: 'appealed' }, aiState: 'excluded', moderationDetail: { appeal: { status: 'used' } } });
    expect((await owner.post(`/products/${p.id}/appeal`, { message: 'encore' }).expect(409)).body.error.code).toBe('MODERATION_APPEAL_ALREADY_USED');

    const late = await createProduct(owner);
    await reject(late.id, new Date(Date.now() - 8 * 24 * 3600 * 1000));
    expect((await owner.post(`/products/${late.id}/appeal`, { message: 'trop tard' }).expect(410)).body.error.code).toBe('MODERATION_APPEAL_WINDOW_EXPIRED');
    const again = await owner.post(`/products/${late.id}/resubmit`).expect(202);
    expect(again.body.data.status).toBe('approved');
    expect((await owner.get(`/products/${late.id}`).expect(200)).body.data).toMatchObject({ moderation: { status: 'approved' }, contentVersion: 2 });
  });
});

describe('GET /products', () => {
  it('AT-CAT-11 filters (category multi, ranges, low stock, active) and sorts return the right sets; ?lowStock=1 deep link', async () => {
    const owner = await asOwner(app);
    const cat = async (name: string, parentId?: string) => (await owner.post('/categories', { name, parentId }).expect(201)).body.data.id as string;
    const shoes = await cat('Chaussures');
    const sneakers = await cat('Baskets', shoes);
    const bags = await cat('Sacs');
    const A = await createProduct(owner, { name: 'Alpha basket', sku: 'A-1', price: 5000, costPrice: 3000, stock: 20, minStock: 5, categoryId: sneakers, keywords: ['sport'] });
    const B = await createProduct(owner, { name: 'Bravo sac', sku: 'B-1', price: 9000, costPrice: 8100, stock: 2, minStock: 5, categoryId: bags });
    const C = await createProduct(owner, { name: 'Charlie botte', sku: 'C-1', price: 12000, stock: 0, categoryId: shoes, isActive: false });
    const D = await createProduct(owner, { name: 'Delta service', sku: 'D-1', price: 1500, trackStock: false });
    const E = await createProduct(owner, { name: 'Echo tee', sku: 'E-1', price: 2500, costPrice: 1000, stock: undefined, minStock: 0, variants: [{ name: 'S', price: 2500, stock: 6, minStock: 2 }, { name: 'M', price: 2500, stock: 1, minStock: 2 }] });
    const F = await createProduct(owner, { name: 'Foxtrot archivé', sku: 'F-1', price: 700, stock: 4 });
    await owner.delete(`/products/${F.id}`).expect(204);
    const names = async (qs: string) => (await owner.get(`/products?${qs}`).expect(200)).body.data.map((r: any) => r.name.split(' ')[0]);

    const all = await owner.get('/products?sort=name').expect(200);
    expect(all.body.data.map((r: any) => r.name.split(' ')[0])).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect(all.body.meta).toMatchObject({ page: 1, pageSize: 25, total: 5 });
    const row = (id: string) => all.body.data.find((r: any) => r.id === id);
    expect(row(A.id)).toMatchObject({ stockState: 'ok', marginPct: 40, category: { name: 'Baskets' }, variantSummary: null, archived: false });
    expect(row(B.id)).toMatchObject({ stockState: 'low', marginPct: 10 });
    expect(row(C.id)).toMatchObject({ stockState: 'out', isActive: false, aiState: 'excluded' });
    expect(row(D.id)).toMatchObject({ stockState: 'untracked', stock: null, trackStock: false });
    expect(row(E.id)).toMatchObject({ stockState: 'low', stock: 7, hasVariants: true, variantSummary: 'S · M' }); // one variant under its own threshold

    // category (multi; a parent selects its sub-categories)
    expect(await names(`categoryIds=${bags}&sort=name`)).toEqual(['Bravo']);
    expect(await names(`categoryIds=${shoes}&status=active,inactive&sort=name`)).toEqual(['Alpha', 'Charlie']);
    expect(await names(`categoryIds=${sneakers},${bags}&sort=name`)).toEqual(['Alpha', 'Bravo']);
    // status / active / archived
    expect(await names('status=inactive')).toEqual(['Charlie']);
    expect(await names('active=1&sort=name')).toEqual(['Alpha', 'Bravo', 'Delta', 'Echo']);
    expect(await names('status=archived')).toEqual(['Foxtrot']);
    expect(await names('status=active,archived&sort=-name')).toEqual(['Foxtrot', 'Echo', 'Delta', 'Bravo', 'Alpha']);
    // type
    expect(await names('type=service')).toEqual(['Delta']);
    expect(await names('type=variants')).toEqual(['Echo']);
    expect(await names('type=stock&sort=name')).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo']);
    expect(await names('type=no_variants&sort=name')).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    // stock state + the deep link of the low-stock notification
    expect(await names('stockState=low&sort=name')).toEqual(['Bravo', 'Echo']);
    expect(await names('stockState=out')).toEqual(['Charlie']);
    expect(await names('stockState=in_stock&sort=name')).toEqual(['Alpha', 'Bravo', 'Echo']);
    expect(await names('lowStock=1&sort=name')).toEqual(['Bravo', 'Charlie', 'Echo']);
    expect(await names('lowStock=1&active=1&sort=name')).toEqual(['Bravo', 'Echo']);
    // ranges
    expect(await names('minPrice=5000&maxPrice=9000&sort=price')).toEqual(['Alpha', 'Bravo']);
    expect(await names('minCost=2000&sort=name')).toEqual(['Alpha', 'Bravo']);
    expect(await names('maxCost=1000')).toEqual(['Echo']);
    expect(await names('minQty=5&sort=name')).toEqual(['Alpha', 'Echo']);
    expect(await names('maxQty=2&sort=name')).toEqual(['Bravo', 'Charlie']);
    expect(await names('minMargin=30&sort=name')).toEqual(['Alpha', 'Echo']);
    expect(await names('maxMargin=15')).toEqual(['Bravo']);
    // search: name, SKU, keywords, typo tolerance, min 2 chars
    expect(await names('q=bravo')).toEqual(['Bravo']);
    expect(await names('q=c-1')).toEqual(['Charlie']);
    expect(await names('q=sport')).toEqual(['Alpha']);
    expect(await names('q=charli')).toEqual(['Charlie']);
    expect(await names('q=100%25')).toEqual([]);
    expect((await owner.get('/products?q=a').expect(200)).body.meta.total).toBe(5);
    // sorts (whitelist) and paging
    expect(await names('sort=-price')).toEqual(['Charlie', 'Bravo', 'Alpha', 'Echo', 'Delta']);
    expect(await names('sort=sku')).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect((await names('sort=cost')).slice(0, 3)).toEqual(['Echo', 'Alpha', 'Bravo']); // products without a cost come last
    expect(await names('sort=-stock')).toEqual(['Alpha', 'Echo', 'Bravo', 'Charlie', 'Delta']);
    expect((await names('sort=-updatedAt'))[0]).toBe('Echo');
    expect((await owner.get('/products?sort=createdBy').expect(400)).body.error.code).toBe('BAD_REQUEST');
    expect((await owner.get('/products?pageSize=10').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    const second = await owner.get('/products?sort=name&pageSize=25&page=2').expect(200);
    expect(second.body).toMatchObject({ data: [], meta: { page: 2, total: 5 } });
    // archived rows expose restore instead of edit
    const archived = (await owner.get('/products?status=archived').expect(200)).body.data[0];
    expect(archived.actions.map((a: any) => a.key)).toEqual(['open', 'restore', 'delete']);
    expect(archived).toMatchObject({ archived: true, aiState: 'excluded' });
    // sellable search (pickers / AI tool): active, live, validated
    const search = await owner.get('/products/search?q=al').expect(200);
    expect(search.body.data).toEqual([{ id: A.id, name: 'Alpha basket', sku: 'A-1', price: 5000, primaryImageUrl: null, hasVariants: false, trackStock: true, stock: 20 }]);
    expect((await owner.get('/products/search').expect(200)).body.data.map((r: any) => r.sku)).toEqual(['A-1', 'B-1', 'D-1', 'E-1']);
  });

  it('AT-CAT-12 services list shows only trackStock=false products', async () => {
    const owner = await asOwner(app);
    await createProduct(owner, { name: 'Tapis' });
    const service = await createProduct(owner, { name: 'Installation à domicile', trackStock: false, stock: undefined, price: 3000 });
    expect(service).toMatchObject({ trackStock: false, stock: null, stockState: 'untracked', stockDetail: { total: null } });
    const list = await owner.get('/products?type=service').expect(200);
    expect(list.body.data.map((r: any) => r.name)).toEqual(['Installation à domicile']);
    expect(list.body.data[0].actions.find((a: any) => a.key === 'adjust_stock')).toEqual({ key: 'adjust_stock', enabled: false, reasonCode: 'PRODUCT_NOT_STOCK_TRACKED' });
    expect(await db.stockMovement.count({ where: { productId: service.id } })).toBe(0);
  });
});

describe('variants endpoints', () => {
  it('roles (Admin+ writes, operator reads), cross-workspace 404, 422, VARIANT_NOT_FOUND, archived product read-only', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(owner, { sku: 'VR-1', stock: 0 });
    const v = (await admin.post(`/products/${p.id}/variants`, { name: 'Unique', price: 1500, costPrice: 2000 }).expect(201)).body.data;
    const body = { name: 'Autre', price: 100 };

    expect((await operator.get(`/products/${p.id}/variants`).expect(200)).body.data.map((x: any) => x.id)).toEqual([v.id]);
    for (const call of [
      () => operator.post(`/products/${p.id}/variants`, body),
      () => operator.post(`/products/${p.id}/variants/generate`, { attributes: [{ name: 'T', values: ['S'] }], defaultPrice: 1, defaultStock: 0 }),
      () => operator.patch(`/products/${p.id}/variants/${v.id}`, { price: 1 }),
      () => operator.delete(`/products/${p.id}/variants/${v.id}`),
      () => operator.post(`/products/${p.id}/resubmit`),
    ]) {
      expect((await call()).body.error.code).toBe('FORBIDDEN');
    }
    for (const call of [
      () => stranger.post(`/products/${p.id}/variants`, body),
      () => stranger.post(`/products/${p.id}/variants/generate`, { attributes: [{ name: 'T', values: ['S'] }], defaultPrice: 1, defaultStock: 0 }),
      () => stranger.patch(`/products/${p.id}/variants/${v.id}`, { price: 1 }),
      () => stranger.delete(`/products/${p.id}/variants/${v.id}`),
      () => stranger.post(`/products/${p.id}/resubmit`),
      () => stranger.post(`/products/${p.id}/appeal`, { message: 'x' }),
    ]) {
      const r = await call();
      expect([r.status, r.body.error.code]).toEqual([404, 'NOT_FOUND']);
    }
    // a variant id of another product (even of the same workspace) is not found
    const other = await createProduct(owner, { stock: undefined, variants: [{ name: 'X', price: 10 }] });
    expect((await owner.patch(`/products/${p.id}/variants/${other.variants[0].id}`, { price: 5 }).expect(404)).body.error.code).toBe('VARIANT_NOT_FOUND');
    expect((await owner.delete(`/products/${p.id}/variants/${other.variants[0].id}`).expect(404)).body.error.code).toBe('VARIANT_NOT_FOUND');
    expect((await owner.patch(`/products/${p.id}/variants/${v.id}`, { price: -1 }).expect(422)).body.error.fields.price).toBe('validation.price');
    expect((await owner.patch(`/products/${p.id}/variants/${v.id}`, { sku: 'VR-1' }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    const renamed = await owner.patch(`/products/${p.id}/variants/${v.id}`, { name: 'Renommée', sku: 'VR-1-A', attributes: { taille: 'M' } }).expect(200);
    expect(renamed.body.data).toMatchObject({ name: 'Renommée', sku: 'VR-1-A', attributes: { taille: 'M' }, costPrice: 2000 });
    expect((await owner.patch(`/products/${p.id}/variants/${v.id}`, { sku: '' }).expect(200)).body.data.sku).toBeNull();

    await owner.delete(`/products/${p.id}`).expect(204);
    expect((await owner.post(`/products/${p.id}/variants`, body).expect(404)).body.error.code).toBe('NOT_FOUND');
    await owner.patch(`/products/${p.id}/variants/${v.id}`, { price: 1 }).expect(404);
    expect((await owner.get(`/products/${p.id}/variants`).expect(200)).body.data).toHaveLength(1); // still readable
  });

  it('free plan over its limit (after a downgrade): no new variant either', async () => {
    const owner = await asOwner(app, 'free');
    const p = await createProduct(owner);
    await db.product.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ workspaceId: owner.workspaceId, sku: `OVER-${i}`, name: `Over ${i}`, price: 100, stock: 1 })) });
    const res = await owner.post(`/products/${p.id}/variants`, { name: 'S', price: 100 }).expect(403);
    expect(res.body.error).toMatchObject({ code: 'PLAN_LIMIT', params: { resource: 'products', limit: 50, current: 51 } });
  });
});

describe('archive, restore, hard delete, duplicate', () => {
  it('AT-CAT-13 restore an archived product whose SKU was reused ⇒ PRODUCT_SKU_ALREADY_EXISTS', async () => {
    const owner = await asOwner(app);
    const first = await createProduct(owner, { sku: 'REUSE', stock: undefined, variants: [{ name: 'Rouge', sku: 'REUSE-R', price: 100, stock: 2 }] });
    await owner.delete(`/products/${first.id}`).expect(204);
    await owner.delete(`/products/${first.id}`).expect(204); // archiving twice is a no-op
    const archived = (await owner.get(`/products/${first.id}`).expect(200)).body.data;
    expect(archived).toMatchObject({ archived: true, stock: 2 });
    expect(archived.variants.map((v: any) => v.name)).toEqual(['Rouge']); // kept for the read-only page
    expect((await owner.patch(`/products/${first.id}`, { name: 'x', version: archived.version }).expect(409)).body.error.details.reason).toBe('PRODUCT_ARCHIVED');

    // both SKUs are free again
    const second = await createProduct(owner, { sku: 'REUSE' });
    const third = await createProduct(owner, { sku: 'REUSE-R' });
    const blocked = await owner.post(`/products/${first.id}/restore`).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'PRODUCT_SKU_ALREADY_EXISTS', fields: { sku: 'validation.sku_taken' } });
    // the dialog offers another SKU for the product: the variant SKU is still taken
    expect((await owner.post(`/products/${first.id}/restore`, { sku: 'REUSE' }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    expect((await owner.post(`/products/${first.id}/restore`, { sku: 'REUSE-2' }).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
    await owner.delete(`/products/${second.id}`).expect(204);
    expect((await owner.post(`/products/${first.id}/restore`).expect(409)).body.error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS'); // the variant SKU is still taken
    await owner.delete(`/products/${third.id}?mode=hard`).expect(204);
    const restored = await owner.post(`/products/${first.id}/restore`).expect(200);
    expect(restored.body.data).toMatchObject({ archived: false, sku: 'REUSE', stock: 2, hasVariants: true });
    expect(restored.body.data.variants).toHaveLength(1);
    expect((await owner.post(`/products/${first.id}/restore`).expect(200)).body.data.archived).toBe(false);
    // restore with a replacement SKU
    const fourth = await createProduct(owner, { sku: 'SWAP' });
    await owner.delete(`/products/${fourth.id}`).expect(204);
    await createProduct(owner, { sku: 'SWAP' });
    expect((await owner.post(`/products/${fourth.id}/restore`, { sku: 'SWAP-BIS' }).expect(200)).body.data).toMatchObject({ sku: 'SWAP-BIS', archived: false });
    expect((await owner.post(`/products/${fourth.id}/restore`, { price: 1 }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AT-CAT-07 archive a product used by an agent ⇒ out of the agent selection and of recommendations; history intact', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { sku: 'ARCH-1', stock: 6 });
    const other = await createProduct(owner, { sku: 'ARCH-2' });
    const agent = await testAgent(owner.workspaceId);
    expect((await owner.post('/products/bulk/agent', { ids: [p.id, other.id], agentId: agent.id }).expect(200)).body.meta).toMatchObject({ ok: 2, failed: 0 });
    await db.recommendation.create({ data: { workspaceId: owner.workspaceId, productId: other.id, recommendedId: p.id, type: 'cross_sell' } });
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.agents).toEqual([{ id: agent.id, name: 'Vendeur', status: 'active' }]);
    expect((await owner.get(`/products?agentId=${agent.id}`).expect(200)).body.meta.total).toBe(2);
    expect((await owner.get('/products?noAgent=1').expect(200)).body.meta.total).toBe(0);

    await owner.delete(`/products/${p.id}?mode=archive&releaseStock=1`).expect(204);
    expect(await db.agentProduct.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.agentProduct.count({ where: { productId: other.id } })).toBe(1);
    expect((await db.recommendation.findFirstOrThrow({ where: { recommendedId: p.id } })).isActive).toBe(false);
    expect((await owner.get('/products/search').expect(200)).body.data.map((r: any) => r.sku)).toEqual(['ARCH-2']);
    // releaseStock wrote the quantity off; the journal and the row are intact
    const row = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ stock: 0, sku: 'ARCH-1' });
    expect(row.deletedAt).not.toBeNull();
    const movements = await db.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'asc' } });
    expect(movements.map((m) => [m.type, m.reason, m.quantity])).toEqual([['in', 'initial', 6], ['adjustment_out', 'archive', -6]]);
    expect((await wsEvents(owner.workspaceId, 'product.updated')).at(-1)!.payload.product).toMatchObject({ id: p.id, archived: true });
    const relations = await owner.get(`/products/${p.id}/relations`).expect(200);
    expect(relations.body.data).toMatchObject({ orders: { count: 0, last: [] }, movements: { count: 2 }, agents: { count: 0 }, recommendations: { count: 1 } });
    // stock of an archived product cannot be adjusted
    expect((await adjust(owner, { productId: p.id, type: 'in', quantity: 1, reason: 'correction' }).expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('hard delete only without order / sale lines (PRODUCT_HAS_ORDERS); duplicate copies what the dialog asks for', async () => {
    const owner = await asOwner(app);
    const p = await createProduct(owner, { sku: 'DUP-1', price: 3000, costPrice: 1000, stock: undefined, description: 'Texte', variants: [{ name: 'Noir', sku: 'DUP-1-N', price: 3100, costPrice: 1100, stock: 4 }] });
    const copy = await owner.post(`/products/${p.id}/duplicate`, { name: 'Copie simple' }).expect(201);
    expect(copy.body.data).toMatchObject({ name: 'Copie simple', description: 'Texte', price: 3000, costPrice: null, stock: 0, hasVariants: false, variants: [] });
    expect(copy.body.data.sku).not.toBe('DUP-1');
    const full = await owner.post(`/products/${p.id}/duplicate`, { name: 'Copie complète', copyVariants: true, copyCost: true }).expect(201);
    expect(full.body.data).toMatchObject({ costPrice: 1000, hasVariants: true, stock: 0 });
    expect(full.body.data.variants).toEqual([expect.objectContaining({ name: 'Noir', sku: null, price: 3100, costPrice: 1100, stock: 0 })]);
    expect((await db.moderationItem.findFirstOrThrow({ where: { productId: full.body.data.id } })).source).toBe('duplicate');
    expect((await owner.post(`/products/${p.id}/duplicate`, {}).expect(422)).body.error.fields.name).toBe('validation.required');

    // an order line pins the product: archive stays possible, hard delete does not
    await testOrder(owner.workspaceId, p, { quantity: 2, unitPrice: 3100, number: 'CMD-TEST-1' });
    const pinned = await owner.delete(`/products/${p.id}?mode=hard`).expect(409);
    expect(pinned.body.error).toMatchObject({ code: 'PRODUCT_HAS_ORDERS', params: { count: 1 } });
    const detail = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
    expect(detail.actions.find((a: any) => a.key === 'delete')).toEqual({ key: 'delete', enabled: false, reasonCode: 'PRODUCT_HAS_ORDERS' });
    // « RÉSERVÉ » = units held by unconfirmed (`new`) orders; this confirmed order holds nothing (owner decision 2026-10-21)
    expect(detail).toMatchObject({ stockDetail: { total: 4, reserved: 0, availableForAi: 4 }, pricing: { sales30d: { units: 2, revenue: 6200 } }, mentions30d: { orders: 1 } });
    expect((await owner.get(`/products/${p.id}/relations`).expect(200)).body.data.orders).toMatchObject({ count: 1, last: [{ number: 'CMD-TEST-1', quantity: 2 }] });
    await owner.delete(`/products/${p.id}`).expect(204);
    expect(await db.orderItem.count({ where: { productId: p.id } })).toBe(1);

    await owner.delete(`/products/${copy.body.data.id}?mode=hard`).expect(204);
    expect(await db.product.count({ where: { id: copy.body.data.id } })).toBe(0);
    await owner.get(`/products/${copy.body.data.id}`).expect(404);
    expect((await owner.delete(`/products/${p.id}?mode=purge`).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('card preview and the onboarding checklist read real products', async () => {
    const owner = await asOwner(app);
    expect((await owner.get('/workspace/onboarding').expect(200)).body.data.checklist.product).toBe(false);
    const p = await createProduct(owner, { name: 'Lampe', price: 12500, oldPrice: 15000, stock: 0 });
    expect((await owner.get('/workspace/onboarding').expect(200)).body.data.checklist.product).toBe(true);
    const card = await owner.get(`/products/${p.id}/card-preview`).expect(200);
    expect(card.body.data).toMatchObject({ title: 'Lampe', price: 12500, oldPrice: 15000, imageUrl: null, visibleToCustomers: true, buttons: [{ title: 'Commander', disabled: true }] });
    expect(card.body.data.subtitle).toBe(`${formatMoney(12500)} · (${formatMoney(15000)}) · Rupture de stock`);
    expect((await owner.get(`/products/${p.id}/card-preview`).set('Accept-Language', 'ar').expect(200)).body.data.buttons[0].title).toBe('اطلب الآن');
    expect((await owner.get('/workspace').expect(200)).body.data.plan.usage.products).toBe(1);
  });
});
