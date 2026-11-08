// M2 — categories and units (CAT-04) with reassign-on-delete, and the bulk actions of the products list (06 §8.6).
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { createProduct, db, image, testAgent, upload } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
const GHOST = '018f0000-0000-7000-8000-000000000000';

describe('categories', () => {
  it('AT-CAT-06 delete a category in use ⇒ 409 CATEGORY_IN_USE {count} (reassign dialog); after reassign it is deleted', async () => {
    const owner = await asOwner(app);
    const shoes = (await owner.post('/categories', { name: 'Chaussures', color: '#FF5500', description: 'Rayon chaussures' }).expect(201)).body.data;
    expect(shoes).toMatchObject({ name: 'Chaussures', color: '#FF5500', description: 'Rayon chaussures', parentId: null, productCount: 0, children: [], imageUrl: null });
    expect(shoes.actions).toEqual([{ key: 'edit', enabled: true }, { key: 'delete', enabled: true }]);
    const bags = (await owner.post('/categories', { name: 'Sacs' }).expect(201)).body.data;
    const a = await createProduct(owner, { categoryId: shoes.id });
    const b = await createProduct(owner, { categoryId: shoes.id });
    const archived = await createProduct(owner, { categoryId: shoes.id });
    await owner.delete(`/products/${archived.id}`).expect(204);

    const blocked = await owner.delete(`/categories/${shoes.id}`).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'CATEGORY_IN_USE', params: { count: 2 } });
    expect(blocked.body.error.message).toContain('2');
    expect((await owner.delete(`/categories/${shoes.id}?reassignTo=${shoes.id}`).expect(422)).body.error.fields).toEqual({ reassignTo: 'validation.invalid' });
    expect((await owner.delete(`/categories/${shoes.id}?reassignTo=${GHOST}`).expect(422)).body.error.fields).toEqual({ reassignTo: 'validation.invalid' });
    expect((await owner.get('/categories').expect(200)).body.data.map((c: any) => [c.name, c.productCount])).toEqual([['Chaussures', 2], ['Sacs', 0]]);

    await owner.delete(`/categories/${shoes.id}?reassignTo=${bags.id}`).expect(204);
    expect((await owner.get('/categories').expect(200)).body.data.map((c: any) => [c.name, c.productCount])).toEqual([['Sacs', 2]]);
    for (const p of [a, b]) {
      const row = (await owner.get(`/products/${p.id}`).expect(200)).body.data;
      expect(row).toMatchObject({ category: { id: bags.id, name: 'Sacs' }, contentVersion: 2 }); // the category is a moderated field
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: archived.id } })).categoryId).toBeNull();
    await owner.delete(`/categories/${shoes.id}`).expect(404);
    // the name is free again (partial unique index on live rows)
    await owner.post('/categories', { name: 'Chaussures' }).expect(201);
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'category.delete', entityId: shoes.id } }));
    expect(audit).toMatchObject({ entity: 'Category' });
  });

  it('name unique per workspace (CATEGORY_ALREADY_EXISTS), 2 levels max (CATEGORY_DEPTH_EXCEEDED), parent delete moves sub-categories to root', async () => {
    const owner = await asOwner(app);
    const root = (await owner.post('/categories', { name: 'Mode' }).expect(201)).body.data;
    const dup = await owner.post('/categories', { name: 'mode' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'CATEGORY_ALREADY_EXISTS', fields: { name: 'validation.invalid' } });
    const child = (await owner.post('/categories', { name: 'Robes', parentId: root.id }).expect(201)).body.data;
    expect(child.parentId).toBe(root.id);
    const tooDeep = await owner.post('/categories', { name: 'Robes de soirée', parentId: child.id }).expect(422);
    expect(tooDeep.body.error).toMatchObject({ code: 'CATEGORY_DEPTH_EXCEEDED', fields: { parentId: 'validation.invalid' } });
    const other = (await owner.post('/categories', { name: 'Maison' }).expect(201)).body.data;
    // a category that has sub-categories cannot itself become a sub-category; nor its own parent
    expect((await owner.patch(`/categories/${root.id}`, { parentId: other.id }).expect(422)).body.error.code).toBe('CATEGORY_DEPTH_EXCEEDED');
    expect((await owner.patch(`/categories/${other.id}`, { parentId: other.id }).expect(422)).body.error.code).toBe('CATEGORY_DEPTH_EXCEEDED');
    expect((await owner.patch(`/categories/${other.id}`, { name: 'Mode' }).expect(409)).body.error.code).toBe('CATEGORY_ALREADY_EXISTS');
    expect((await owner.post('/categories', { name: 'X', parentId: GHOST }).expect(422)).body.error.fields).toEqual({ parentId: 'validation.invalid' });
    expect((await owner.post('/categories', { name: '' }).expect(422)).body.error.fields.name).toBe('validation.required');
    expect((await owner.post('/categories', { name: 'Y', color: 'rouge' }).expect(422)).body.error.fields.color).toBe('validation.invalid');

    const moved = await owner.patch(`/categories/${other.id}`, { name: 'Maison & déco', color: '#00AA88', parentId: root.id, description: '' }).expect(200);
    expect(moved.body.data).toMatchObject({ name: 'Maison & déco', color: '#00AA88', parentId: root.id, description: null });
    const tree = (await owner.get('/categories').expect(200)).body.data;
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c: any) => c.name)).toEqual(['Maison & déco', 'Robes']);

    // deleting a parent: blocked while it has sub-categories, unless they are moved to the root
    const blocked = await owner.delete(`/categories/${root.id}`).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'CATEGORY_IN_USE', params: { count: 2 }, details: { reason: 'HAS_SUBCATEGORIES', children: 2 } });
    await owner.delete(`/categories/${root.id}?moveChildrenToRoot=true`).expect(204);
    expect((await owner.get('/categories').expect(200)).body.data.map((c: any) => [c.name, c.parentId])).toEqual([['Maison & déco', null], ['Robes', null]]);
  });

  it('category picture: POST /uploads { kind: category_image } then imageUploadId; uploads of another kind or workspace are refused', async () => {
    const owner = await asOwner(app);
    const stranger = await asOwner(app);
    const picture = (await upload(owner, app, '/uploads', 'file', [{ buffer: await image(900, 600), name: 'rayon.jpg', type: 'image/jpeg' }], { kind: 'category_image' }).expect(201)).body.data;
    expect(picture).toMatchObject({ mime: 'image/webp', width: 512 });
    const c = (await owner.post('/categories', { name: 'Avec image', imageUploadId: picture.id }).expect(201)).body.data;
    expect(c.imageUrl).toBe(picture.url);
    expect((await owner.get('/categories').expect(200)).body.data[0].imageUrl).toBe(picture.url);
    expect((await owner.patch(`/categories/${c.id}`, { imageUploadId: null }).expect(200)).body.data.imageUrl).toBeNull();
    const logo = (await upload(owner, app, '/uploads', 'file', [{ buffer: await image(300, 300), name: 'logo.jpg', type: 'image/jpeg' }], { kind: 'logo' }).expect(201)).body.data;
    expect((await owner.patch(`/categories/${c.id}`, { imageUploadId: logo.id }).expect(422)).body.error.fields).toEqual({ imageUploadId: 'validation.invalid' });
    expect((await stranger.post('/categories', { name: 'Volée', imageUploadId: picture.id }).expect(422)).body.error.fields).toEqual({ imageUploadId: 'validation.invalid' });
    const operator = await asOperator(app, owner.workspaceId);
    expect((await upload(operator, app, '/uploads', 'file', [{ buffer: await image(300, 300), name: 'x.jpg', type: 'image/jpeg' }], { kind: 'category_image' }).expect(422)).body.error.fields).toEqual({ kind: 'validation.invalid' });
  });

  it('roles and tenancy: operator reads, Admin+ writes; other workspace ⇒ 404 and its names do not collide', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const c = (await admin.post('/categories', { name: 'Partagé' }).expect(201)).body.data;
    expect((await operator.get('/categories').expect(200)).body.data[0].actions).toEqual([{ key: 'edit', enabled: false, reasonCode: 'FORBIDDEN' }, { key: 'delete', enabled: false, reasonCode: 'FORBIDDEN' }]);
    expect((await operator.post('/categories', { name: 'Non' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.patch(`/categories/${c.id}`, { name: 'Non' }).expect(403);
    await operator.delete(`/categories/${c.id}`).expect(403);
    await stranger.post('/categories', { name: 'Partagé' }).expect(201);
    expect((await stranger.get('/categories').expect(200)).body.data).toHaveLength(1);
    await stranger.patch(`/categories/${c.id}`, { name: 'Pris' }).expect(404);
    await stranger.delete(`/categories/${c.id}`).expect(404);
    expect((await stranger.post('/categories', { name: 'Enfant', parentId: c.id }).expect(422)).body.error.fields).toEqual({ parentId: 'validation.invalid' });
    const mine = await createProduct(stranger);
    expect((await stranger.delete(`/categories/${(await stranger.get('/categories')).body.data[0].id}?reassignTo=${c.id}`).expect(204)).status).toBe(204); // unused: nothing to reassign
    expect((await stranger.post('/products/bulk/category', { ids: [mine.id], categoryId: c.id }).expect(422)).body.error.fields).toEqual({ categoryId: 'validation.invalid' });
  });
});

describe('units', () => {
  it('7 system units (read-only) + custom units; delete in use ⇒ UNIT_IN_USE {count} with reassign', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const list = (await owner.get('/units').expect(200)).body.data;
    expect(list).toHaveLength(7);
    expect(list.map((u: any) => u.abbreviation)).toEqual(['pc', 'kg', 'g', 'L', 'ml', 'm', 'bt']);
    const piece = list[0];
    expect(piece).toMatchObject({ name: 'Pièce', isSystem: true, productCount: 0 });
    expect(piece.actions).toEqual([{ key: 'edit', enabled: false, reasonCode: 'UNIT_SYSTEM_READONLY' }, { key: 'delete', enabled: false, reasonCode: 'UNIT_SYSTEM_READONLY' }]);
    expect((await owner.patch(`/units/${piece.id}`, { name: 'Unité' }).expect(403)).body.error.code).toBe('UNIT_SYSTEM_READONLY');
    expect((await owner.delete(`/units/${piece.id}`).expect(403)).body.error.code).toBe('UNIT_SYSTEM_READONLY');

    const box = (await owner.post('/units', { name: 'Boîte de 6', abbreviation: 'b6', containsQty: 6, baseUnitId: piece.id }).expect(201)).body.data;
    expect(box).toMatchObject({ name: 'Boîte de 6', abbreviation: 'b6', isSystem: false, containsQty: 6, baseUnitId: piece.id });
    expect(box.actions).toEqual([{ key: 'edit', enabled: true }, { key: 'delete', enabled: true }]);
    expect((await owner.post('/units', { name: 'boîte de 6', abbreviation: 'B6' }).expect(422)).body.error.fields).toEqual({ name: 'validation.invalid' });
    expect((await owner.post('/units', { name: 'Lot' }).expect(422)).body.error.fields.abbreviation).toBe('validation.required');
    expect((await owner.post('/units', { name: 'Lot', abbreviation: 'lot', baseUnitId: GHOST }).expect(422)).body.error.fields).toEqual({ baseUnitId: 'validation.invalid' });
    const pack = (await owner.post('/units', { name: 'Paquet', abbreviation: 'pq' }).expect(201)).body.data;
    expect((await owner.patch(`/units/${pack.id}`, { abbreviation: 'paq', containsQty: 12, baseUnitId: piece.id }).expect(200)).body.data).toMatchObject({ abbreviation: 'paq', containsQty: 12 });
    expect((await owner.get('/units').expect(200)).body.data).toHaveLength(9);
    // custom units are private to the workspace
    expect((await stranger.get('/units').expect(200)).body.data).toHaveLength(7);
    await stranger.patch(`/units/${box.id}`, { name: 'x' }).expect(404);
    await stranger.delete(`/units/${box.id}`).expect(404);
    expect((await stranger.post('/products', { name: 'P', price: 1, stock: 0, unitId: box.id }).expect(422)).body.error.fields).toEqual({ unitId: 'validation.invalid' });

    const p = await createProduct(owner, { unitId: box.id });
    expect(p.unit).toEqual({ id: box.id, abbreviation: 'b6' });
    await createProduct(owner, { unitId: piece.id }); // a system unit is usable by every workspace
    expect((await owner.get('/units').expect(200)).body.data.find((u: any) => u.id === box.id).productCount).toBe(1);
    const blocked = await owner.delete(`/units/${box.id}`).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'UNIT_IN_USE', params: { count: 1 } });
    expect((await owner.delete(`/units/${box.id}?reassignTo=${box.id}`).expect(422)).body.error.fields).toEqual({ reassignTo: 'validation.invalid' });
    await owner.delete(`/units/${box.id}?reassignTo=${pack.id}`).expect(204);
    expect((await owner.get(`/products/${p.id}`).expect(200)).body.data.unit).toEqual({ id: pack.id, abbreviation: 'paq' });
    expect(await db.moderationItem.count({ where: { productId: p.id } })).toBe(1); // the unit is not a moderated field
    await owner.delete(`/units/${box.id}`).expect(404);

    await operator.get('/units').expect(200);
    expect((await operator.post('/units', { name: 'Non', abbreviation: 'n' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    await operator.patch(`/units/${pack.id}`, { name: 'Non' }).expect(403);
    await operator.delete(`/units/${pack.id}`).expect(403);
  });
});

describe('bulk actions (06 §8.6)', () => {
  it('category / agent / min-stock / archive: per-item results, meta.ok / meta.failed; Admin+ only', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const foreign = await createProduct(stranger);
    const category = (await owner.post('/categories', { name: 'Promo' }).expect(201)).body.data;
    const a = await createProduct(owner, { stock: 4 });
    const b = await createProduct(owner, { stock: 9 });
    const gone = await createProduct(owner);
    await owner.delete(`/products/${gone.id}`).expect(204);
    const ids = [a.id, b.id, gone.id, foreign.id];

    const moved = await owner.post('/products/bulk/category', { ids, categoryId: category.id }).expect(200);
    expect(moved.body.meta).toMatchObject({ ok: 2, failed: 2 });
    expect(moved.body.data.results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: true },
      { id: gone.id, ok: false, error: expect.objectContaining({ code: 'NOT_FOUND', message: expect.any(String), ref: expect.any(String) }) },
      { id: foreign.id, ok: false, error: expect.objectContaining({ code: 'NOT_FOUND' }) },
    ]);
    expect((await owner.get(`/products?categoryIds=${category.id}`).expect(200)).body.meta.total).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: foreign.id } })).categoryId).toBeNull();
    expect(await db.moderationItem.count({ where: { productId: a.id } })).toBe(2);
    expect((await owner.post('/products/bulk/category', { ids: [a.id], categoryId: null }).expect(200)).body.meta).toMatchObject({ ok: 1, failed: 0 });
    expect((await owner.get(`/products/${a.id}`).expect(200)).body.data.category).toBeNull();

    const agent = await testAgent(owner.workspaceId);
    expect((await owner.post('/products/bulk/agent', { ids, agentId: agent.id }).expect(200)).body.meta).toMatchObject({ ok: 2, failed: 2 });
    expect((await owner.post('/products/bulk/agent', { ids: [a.id], agentId: agent.id }).expect(200)).body.meta.ok).toBe(1); // already linked: no duplicate
    expect(await db.agentProduct.count({ where: { agentId: agent.id } })).toBe(2);
    await owner.post('/products/bulk/agent', { ids: [a.id], agentId: (await testAgent(stranger.workspaceId)).id }).expect(404);

    expect((await owner.post('/products/bulk/min-stock', { ids: [a.id, b.id], minStock: 5 }).expect(200)).body.meta).toMatchObject({ ok: 2, failed: 0 });
    expect((await owner.get('/products?stockState=low').expect(200)).body.data.map((r: any) => r.id)).toEqual([a.id]);

    const archived = await owner.post('/products/bulk/archive', { ids: [a.id, foreign.id], releaseStock: true }).expect(200);
    expect(archived.body.meta).toMatchObject({ ok: 1, failed: 1 });
    expect(await db.product.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ stock: 0, deletedAt: expect.any(Date) });
    expect((await db.product.findUniqueOrThrow({ where: { id: foreign.id } })).deletedAt).toBeNull();

    for (const [path, body] of [
      ['category', { ids: [b.id], categoryId: category.id }],
      ['agent', { ids: [b.id], agentId: agent.id }],
      ['min-stock', { ids: [b.id], minStock: 1 }],
      ['archive', { ids: [b.id] }],
      ['price', { ids: [b.id], op: 'set', value: 10, unit: 'dzd' }],
      ['export', { ids: [b.id] }],
    ] as const) {
      expect((await operator.post(`/products/bulk/${path}`, body).expect(403)).body.error.code).toBe('FORBIDDEN');
    }
    expect((await owner.post('/products/bulk/archive', { ids: [] }).expect(422)).body.error.fields.ids).toBe('validation.required');
    expect((await owner.post('/products/bulk/archive', { ids: ['nope'] }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await owner.post('/products/bulk/archive', { ids: Array(501).fill(b.id) }).expect(422)).body.error.fields.ids).toBe('validation.length');
  });

  it('bulk price: increase / decrease / set, percent or DA, round up to tens, variants, preview, SELLING_BELOW_COST warning', async () => {
    const owner = await asOwner(app);
    const a = await createProduct(owner, { price: 1990, costPrice: 1500 });
    const b = await createProduct(owner, { price: 5000, costPrice: 4800 });
    const v = await createProduct(owner, { price: 3000, stock: undefined, variants: [{ name: 'S', price: 3000, costPrice: 2900 }, { name: 'L', price: 3400 }] });

    const preview = await owner.post('/products/bulk/price', { ids: [a.id, b.id, v.id], op: 'decrease', value: 5, unit: 'percent', roundUpTens: true, applyToVariants: true, preview: true }).expect(200);
    expect(preview.body.data.results.map((r: any) => [r.ok, r.data.price, r.data.newPrice, r.data.belowCost])).toEqual([[true, 1990, 1890, false], [true, 5000, 4750, true], [true, 3000, 2850, true]]);
    expect(preview.body.data.results[2].data.variants).toEqual([expect.objectContaining({ name: 'S', price: 3000, newPrice: 2850 }), expect.objectContaining({ name: 'L', price: 3400, newPrice: 3230 })]);
    expect(preview.body.meta).toMatchObject({ ok: 3, failed: 0, warnings: [{ code: 'SELLING_BELOW_COST', params: { count: 2 } }] });
    expect((await owner.get(`/products/${a.id}`).expect(200)).body.data).toMatchObject({ price: 1990, version: 1 }); // nothing written

    const applied = await owner.post('/products/bulk/price', { ids: [a.id, v.id], op: 'increase', value: 105, unit: 'dzd', applyToVariants: true }).expect(200);
    expect(applied.body.data.results.map((r: any) => r.data.newPrice)).toEqual([2095, 3105]);
    expect((await owner.get(`/products/${a.id}`).expect(200)).body.data).toMatchObject({ price: 2095, version: 2 });
    expect((await owner.get(`/products/${v.id}`).expect(200)).body.data.variants.map((x: any) => x.price)).toEqual([3105, 3505]);
    // without applyToVariants the variants keep their price
    await owner.post('/products/bulk/price', { ids: [v.id], op: 'set', value: 9000, unit: 'dzd' }).expect(200);
    expect((await owner.get(`/products/${v.id}`).expect(200)).body.data).toMatchObject({ price: 9000, contentVersion: 1 }); // +190 %: a price is never reviewed (PV 08/11)
    expect((await owner.get(`/products/${v.id}`).expect(200)).body.data.variants.map((x: any) => x.price)).toEqual([3105, 3505]);

    // a line that would fall to 0 or below is refused on its own, the others pass
    const mixed = await owner.post('/products/bulk/price', { ids: [a.id, b.id], op: 'decrease', value: 3000, unit: 'dzd' }).expect(200);
    expect(mixed.body.meta).toMatchObject({ ok: 1, failed: 1 });
    expect(mixed.body.data.results[0]).toMatchObject({ id: a.id, ok: false, error: { code: 'VALIDATION_ERROR', fields: { value: 'validation.price' } } });
    expect(mixed.body.data.results[1]).toMatchObject({ id: b.id, ok: true, data: { newPrice: 2000, belowCost: true } });
    expect((await owner.post('/products/bulk/price', { ids: [a.id], op: 'set', value: 10, unit: 'percent' }).expect(422)).body.error.fields.unit).toBe('validation.invalid');
    expect((await owner.post('/products/bulk/price', { ids: [a.id], op: 'double', value: 10, unit: 'dzd' }).expect(422)).body.error.fields.op).toBe('validation.invalid');
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'product.bulk_price' } }));
    expect(audit).not.toBeNull();
  });
});
