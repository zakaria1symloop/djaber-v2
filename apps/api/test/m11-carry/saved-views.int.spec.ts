// LST-03 / D42 / D47 — saved views (`/me/saved-views`, 06 §8.1) and the `?view=<id>` expansion of the lists (06 §1).
// AT-LST-03 (I part), AT-ERR-10 (SAVED_VIEW_NAME_TAKEN 409 inline · SAVED_VIEW_SHARED_READONLY 403). Full-test ORDERS-22.
import { randomUUID } from 'node:crypto';
import { asAdmin, asOperator, asOwner, asLoneUser, asMember } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { createProduct, db, testOrder } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const body = (over: Record<string, unknown> = {}) => ({
  page: 'orders',
  name: 'À envoyer Sétif',
  filters: { tab: 'confirmed', wilayaId: '19', source: 'ai,manual' },
  sort: '-total',
  columns: ['number', 'client', 'total', 'status'],
  density: 'compact',
  ...over,
});

describe('saved views — CRUD (AT-LST-03)', () => {
  it('create, list, rename, set default (one per page), delete; filters stored without paging / presentation keys', async () => {
    const owner = await asOwner(app);
    const created = await owner.post('/me/saved-views', body({ filters: { tab: 'confirmed', wilayaId: '19', page: '3', pageSize: '50', sheet: 'x', view: randomUUID() } })).expect(201);
    expect(created.body.data).toMatchObject({
      page: 'orders',
      name: 'À envoyer Sétif',
      filters: { tab: 'confirmed', wilayaId: '19' },
      sort: '-total',
      columns: ['number', 'client', 'total', 'status'],
      density: 'compact',
      isDefault: false,
      isShared: false,
      sharedBy: null,
      readOnly: false,
      sharedWith: 0,
    });
    expect(created.body.data.filters).not.toHaveProperty('page');
    expect(created.body.data.workspaceId).toBeUndefined();
    const id = created.body.data.id as string;

    const second = await owner.post('/me/saved-views', body({ name: 'Retours à vérifier', filters: { tab: 'returned' }, isDefault: true })).expect(201);
    expect(second.body.data.isDefault).toBe(true);
    await owner.post('/me/saved-views', body({ page: 'products', name: 'Retours à vérifier', filters: {} })).expect(201); // same name, other page

    // list per page, in creation order
    const list = await owner.get('/me/saved-views?page=orders').expect(200);
    expect(list.body.data.map((v: any) => v.name)).toEqual(['À envoyer Sétif', 'Retours à vérifier']);
    expect((await owner.get('/me/saved-views').expect(200)).body.data).toHaveLength(3);

    // set default moves the DÉFAUT pill (partial unique index: one default per user and page)
    expect((await owner.patch(`/me/saved-views/${id}`, { isDefault: true }).expect(200)).body.data.isDefault).toBe(true);
    const after = (await owner.get('/me/saved-views?page=orders').expect(200)).body.data;
    expect(after.filter((v: any) => v.isDefault).map((v: any) => v.id)).toEqual([id]);

    // rename + replace the filters
    const renamed = await owner.patch(`/me/saved-views/${id}`, { name: 'Sétif confirmées', filters: { tab: 'confirmed' }, sort: null, density: null }).expect(200);
    expect(renamed.body.data).toMatchObject({ name: 'Sétif confirmées', filters: { tab: 'confirmed' }, sort: null, density: null, isDefault: true });

    await owner.delete(`/me/saved-views/${id}`).expect(204);
    await owner.delete(`/me/saved-views/${id}`).expect(404);
    expect((await owner.get('/me/saved-views?page=orders').expect(200)).body.data.map((v: any) => v.name)).toEqual(['Retours à vérifier']);
    const audits = await eventually(async () => {
      const rows = await db.auditLog.findMany({ where: { workspaceId: owner.workspaceId, entity: 'SavedView' } });
      return rows.length ? rows : null;
    });
    expect(audits!.map((a) => a.action)).toEqual(['saved_view.delete']);
  });

  it('409 SAVED_VIEW_NAME_TAKEN per (user, page), case-insensitive, inline on « name »; 422 validation', async () => {
    const owner = await asOwner(app);
    const a = await owner.post('/me/saved-views', body()).expect(201);
    const dup = await owner.post('/me/saved-views', body({ name: '  à ENVOYER sétif ' })).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'SAVED_VIEW_NAME_TAKEN', fields: { name: 'validation.invalid' } });
    const b = await owner.post('/me/saved-views', body({ name: 'Autre' })).expect(201);
    expect((await owner.patch(`/me/saved-views/${b.body.data.id}`, { name: 'À envoyer Sétif' }).expect(409)).body.error.code).toBe('SAVED_VIEW_NAME_TAKEN');
    await owner.patch(`/me/saved-views/${a.body.data.id}`, { name: 'À envoyer Sétif' }).expect(200); // its own name

    // another member may use the same name (unique per user)
    const admin = await asAdmin(app, owner.workspaceId);
    await admin.post('/me/saved-views', body()).expect(201);

    for (const bad of [
      body({ name: '' }),
      body({ name: 'x'.repeat(61) }),
      body({ page: 'reports' }),
      body({ density: 'huge' }),
      body({ sort: 'total desc' }),
      body({ filters: { 'bad key': '1' } }),
      body({ filters: { status: { nested: true } } }),
      { ...body(), workspaceId: randomUUID() },
    ]) {
      const res = await owner.post('/me/saved-views', bad).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await owner.post('/me/saved-views', body({ name: '' })).expect(422)).body.error.fields).toHaveProperty('name');
    await owner.get('/me/saved-views?page=reports').expect(422);
    await owner.patch(`/me/saved-views/${a.body.data.id}`, { page: 'products' }).expect(422);
  });

  it('Idempotency-Key: a replayed POST returns the same view once (Idempotent-Replayed), another body ⇒ 422', async () => {
    const owner = await asOwner(app);
    const key = randomUUID();
    const first = await owner.post('/me/saved-views', body()).set('Idempotency-Key', key).expect(201);
    const replay = await owner.post('/me/saved-views', body()).set('Idempotency-Key', key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await db.savedView.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect((await owner.post('/me/saved-views', body({ name: 'Autre' })).set('Idempotency-Key', key).expect(422)).body.error.code).toBe('IDEMPOTENCY_MISMATCH');
  });
});

describe('saved views — sharing, roles, tenancy', () => {
  it('Admin+ shares; others see it read-only (403 SAVED_VIEW_SHARED_READONLY on edit / delete / share), may duplicate; delete removes it for everyone', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const operator = await asOperator(app, owner.workspaceId);
    const view = (await admin.post('/me/saved-views', body()).expect(201)).body.data;

    // not shared yet: invisible to the others
    expect((await operator.get('/me/saved-views?page=orders').expect(200)).body.data).toEqual([]);
    await operator.patch(`/me/saved-views/${view.id}`, { name: 'x' }).expect(404);

    // 403 per role on share: Operator refused, Admin / Owner allowed
    expect((await operator.post(`/me/saved-views/${view.id}/share`, {}).expect(403)).body.error.code).toBe('FORBIDDEN');
    const shared = await admin.post(`/me/saved-views/${view.id}/share`, {}).expect(200);
    expect(shared.body.data).toMatchObject({ isShared: true, readOnly: false, sharedWith: 2, sharedBy: { id: admin.userId } });

    for (const other of [operator, owner]) {
      const seen = (await other.get('/me/saved-views?page=orders').expect(200)).body.data;
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ id: view.id, isShared: true, readOnly: true, isDefault: false, sharedBy: { id: admin.userId } });
      expect((await other.patch(`/me/saved-views/${view.id}`, { name: 'Mine' }).expect(403)).body.error.code).toBe('SAVED_VIEW_SHARED_READONLY');
      expect((await other.delete(`/me/saved-views/${view.id}`).expect(403)).body.error.code).toBe('SAVED_VIEW_SHARED_READONLY');
    }
    expect((await owner.post(`/me/saved-views/${view.id}/share`, { isShared: false }).expect(403)).body.error.code).toBe('SAVED_VIEW_SHARED_READONLY');
    // « Dupliquer » = a new own view with the same content
    const copy = await operator.post('/me/saved-views', { page: 'orders', name: `${view.name} (copie)`, filters: view.filters, sort: view.sort, columns: view.columns, density: view.density }).expect(201);
    expect(copy.body.data).toMatchObject({ readOnly: false, isShared: false, filters: view.filters });

    // stop sharing, share again, then delete: gone for everyone
    expect((await admin.post(`/me/saved-views/${view.id}/share`, { isShared: false }).expect(200)).body.data).toMatchObject({ isShared: false, sharedBy: null, sharedWith: 0 });
    expect((await operator.get('/me/saved-views?page=orders').expect(200)).body.data.map((v: any) => v.id)).toEqual([copy.body.data.id]);
    await admin.post(`/me/saved-views/${view.id}/share`, { isShared: true }).expect(200);
    await admin.delete(`/me/saved-views/${view.id}`).expect(204);
    expect((await owner.get('/me/saved-views?page=orders').expect(200)).body.data).toEqual([]);
    const audits = await eventually(async () => {
      const rows = await db.auditLog.findMany({ where: { workspaceId: owner.workspaceId, entity: 'SavedView' }, orderBy: { at: 'asc' } });
      return rows.length >= 4 ? rows : null;
    });
    expect(audits!.map((a) => a.action)).toEqual(['saved_view.share', 'saved_view.share', 'saved_view.share', 'saved_view.delete']);
  });

  it('every role keeps its own views; read-only member reads only; no workspace ⇒ refused', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const own = await operator.post('/me/saved-views', body()).expect(201);
    await operator.patch(`/me/saved-views/${own.body.data.id}`, { isDefault: true }).expect(200);
    await operator.delete(`/me/saved-views/${own.body.data.id}`).expect(204);

    const readOnly = await asMember(app, owner.workspaceId, 'operator', { readOnly: true });
    await readOnly.get('/me/saved-views').expect(200);
    expect((await readOnly.post('/me/saved-views', body()).expect(403)).body.error.code).toBe('READ_ONLY_MEMBER');

    const lone = await asLoneUser(app);
    expect([400, 403, 404]).toContain((await lone.get('/me/saved-views')).status);
  });

  it('cross-workspace: another workspace’s view (even shared) is 404 for read, edit, share, delete and ?view=', async () => {
    const a = await asOwner(app);
    const b = await asOwner(app);
    const view = (await a.post('/me/saved-views', body()).expect(201)).body.data;
    await a.post(`/me/saved-views/${view.id}/share`, {}).expect(200);
    expect((await b.get('/me/saved-views').expect(200)).body.data).toEqual([]);
    await b.patch(`/me/saved-views/${view.id}`, { name: 'x' }).expect(404);
    await b.delete(`/me/saved-views/${view.id}`).expect(404);
    await b.post(`/me/saved-views/${view.id}/share`, {}).expect(404);
    await b.get(`/orders?view=${view.id}`).expect(404);
    expect(await db.savedView.count({ where: { id: view.id } })).toBe(1);
  });
});

describe('?view=<id> on the lists (06 §1)', () => {
  it('expands the stored filters (tab → status) and sort; explicit params override; wrong list or unknown id ⇒ 404', async () => {
    const owner = await asOwner(app);
    const product = await createProduct(owner, { name: 'Robe satin', price: 4900 });
    const confirmed = await testOrder(owner.workspaceId, product, { status: 'confirmed', unitPrice: 1000 });
    const confirmedBig = await testOrder(owner.workspaceId, product, { status: 'confirmed', unitPrice: 9000 });
    const fresh = await testOrder(owner.workspaceId, product, { status: 'new' });
    const view = (await owner.post('/me/saved-views', { page: 'orders', name: 'Confirmées', filters: { tab: 'confirmed' }, sort: '-total' }).expect(201)).body.data;

    const viaView = await owner.get(`/orders?view=${view.id}`).expect(200);
    expect(viaView.body.data.map((o: any) => o.id)).toEqual([confirmedBig.id, confirmed.id]); // status=confirmed, sort -total
    const stats = await owner.get(`/orders/stats?view=${view.id}`).expect(200);
    expect(stats.body.data.total).toBe(2);

    // explicit params win over the stored ones
    const explicit = await owner.get(`/orders?view=${view.id}&status=new`).expect(200);
    expect(explicit.body.data.map((o: any) => o.id)).toEqual([fresh.id]);
    expect((await owner.get(`/orders?view=${view.id}&sort=total`).expect(200)).body.data.map((o: any) => o.id)).toEqual([confirmed.id, confirmedBig.id]);

    // a products view on the orders list, or an unknown id ⇒ 404
    const products = (await owner.post('/me/saved-views', { page: 'products', name: 'Actifs', filters: { tab: 'active' } }).expect(201)).body.data;
    await owner.get(`/orders?view=${products.id}`).expect(404);
    await owner.get(`/orders?view=${randomUUID()}`).expect(404);
    const productList = await owner.get(`/products?view=${products.id}`).expect(200);
    expect(productList.body.data.map((p: any) => p.id)).toContain(product.id);

    // a member sees a shared view's result; a private view of another member ⇒ 404
    const operator = await asOperator(app, owner.workspaceId);
    await operator.get(`/orders?view=${view.id}`).expect(404);
    await owner.post(`/me/saved-views/${view.id}/share`, {}).expect(200);
    expect((await operator.get(`/orders?view=${view.id}`).expect(200)).body.data).toHaveLength(2);
  });
});
