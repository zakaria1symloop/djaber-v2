// M7 — carry-over M5: order import (03 §37 ORD, D69, `orders.import`): preview job with per-row errors, mapping dialog,
// commit job (Idempotency-Key, committed once), orders `source=import`, client found or created by phone; nightly
// recommendations scheduling is deterministic (one job per workspace and night).
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { csv, drain, jobOf, upload } from '../support/m2';
import request from 'supertest';
import { orderBody, seedFees } from '../support/m5';
import { db, idem, product } from '../support/m7';
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { RecommendationsScheduler } from '../../src/modules/recommendations/recommendations.module';
import { algiersDay } from '../../src/core/time/algiers';
import { emptyDay } from '../../src/modules/analytics/day-metrics';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const file = (rows: (string | number)[][]) => [{ buffer: csv(rows), name: 'commandes.csv', type: 'text/csv' }];
/** Body of a file behind a signed URL, fetched through the API like a browser would. */
const download = (url: string) =>
  request(app.http())
    .get(new URL(url).pathname + new URL(url).search)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

describe('order import (carry-over M5, D69)', () => {
  it('PV 08/11 « fichier plateforme conforme »: a file exported by Commandes › Exporter (XLSX in French and Arabic, ZR Express CSV) is imported back, variants without their own SKU included', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const robe = await product(owner, { name: 'Robe satin', sku: 'ROB-1', price: 4500, stock: 50 });
    const kab = await product(owner, { name: 'Kabyle brodée', sku: 'KAB', price: 5000, stock: undefined, variants: [{ name: 'M', price: 5000, stock: 40 }, { name: 'L', price: 5200, stock: 40 }] });
    const m = kab.variants.find((v: { name: string }) => v.name === 'M');
    const placed = (await owner.post('/orders', orderBody(robe.id, { items: [{ productId: robe.id, quantity: 2 }, { productId: kab.id, variantId: m.id, quantity: 1 }] })).set(idem()).expect(201)).body.data;
    // L80: the « Date » cell of the export (to the minute) is read back as the order date; the ZR Express layout has none
    const minute = new Date(Math.floor(Date.parse(placed.orderedAt) / 60_000) * 60_000).toISOString();
    const exported = async (query: string, locale = 'fr') => {
      const jobId = (await owner.get(`/orders/export?${query}`).set('Accept-Language', locale).expect(202)).body.data.jobId;
      await drain(app, owner.workspaceId, ['job']);
      const job = await jobOf(owner, jobId);
      expect(job.status).toBe('done');
      return { buffer: (await download(job.resultUrl).expect(200)).body as Buffer, name: job.result.fileName as string, type: job.result.fileName.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    };
    const reimport = async (f: { buffer: Buffer; name: string; type: string }) => {
      const jobId = (await upload(owner, app, '/orders/import', 'file', [f]).expect(202)).body.data.jobId;
      await drain(app, owner.workspaceId, ['job']);
      return jobOf(owner, jobId);
    };
    const lines = (p: any) => p.result.rows[0].values.items.map((i: any) => [i.productId, i.variantId, i.quantity]);
    const want = [[robe.id, null, 2], [kab.id, m.id, 1]];
    for (const [query, locale] of [['scope=all', 'fr'], ['scope=all&format=csv&courierFormat=zrexpress', 'fr']] as const) {
      const preview = await reimport(await exported(query, locale));
      expect([query, preview.status, preview.result.stage, preview.result.totals]).toEqual([query, 'done', 'preview', expect.objectContaining({ rows: 1, valid: 1, invalid: 0 })]);
      expect(lines(preview)).toEqual(want);
      expect([query, preview.result.rows[0].values.orderedAt]).toEqual([query, query.includes('zrexpress') ? null : minute]);
    }
    // the workspace is switched to Arabic: wilayas and communes are exported in Arabic
    await db.workspace.update({ where: { id: owner.workspaceId }, data: { locale: 'ar' } });
    await db.user.update({ where: { id: owner.userId }, data: { locale: 'ar' } });
    await app.app.get(TenantResolver).invalidate(owner.workspaceId);
    const arabic = await reimport(await exported('scope=all', 'ar'));
    expect(arabic.result.totals).toMatchObject({ rows: 1, valid: 1 });
    expect(lines(arabic)).toEqual(want);
    expect(arabic.result.rows[0].values.orderedAt).toBe(minute);
    expect(arabic.result.rows[0].values.wilayaId).toBe(16);
  });

  it('preview with row errors → commit job ⇒ orders source=import, client found or created, stock held; second commit writes nothing; SOURCE badge = file name', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const robe = await product(owner, { name: 'Robe', sku: 'ROBE-01', price: 4500, stock: 3 });
    await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Amine Benali', phone: '0555123456', source: 'manual' } });
    const res = await upload(owner, app, '/orders/import', 'file', file([
      ['Nom', 'Téléphone', 'Wilaya', 'Commune', 'Adresse', 'Articles', 'Note'],
      ['Amine Benali', '0555 12 34 56', '16', 'Bab Ezzouar', 'Cité 200 logements Bt 4', 'ROBE-01×2', 'appeler le soir'],
      ['Sara Kaci', '0770112233', 'Alger', '', 'Rue Didouche Mourad 12', 'ROBE-01×1', ''],
      ['X', '123', '99', '', 'court', 'NOPE×1', ''],
      ['Nadia F.', '0661223344', '16', '', 'Rue Larbi Ben Mhidi 3', 'ROBE-01×1', ''],
    ])).expect(202);
    const jobId = res.body.data.jobId;
    await drain(app, owner.workspaceId, ['job']);
    const preview = await jobOf(owner, jobId);
    expect(preview).toMatchObject({ status: 'done', name: 'order-import-preview', result: { stage: 'preview', totals: { rows: 4, valid: 2, invalid: 2, newClients: 1, units: 3 } } });
    const rows = preview.result.rows;
    expect(rows[0]).toMatchObject({ row: 2, ok: true, client: 'existing', values: { wilayaId: 16, phone: '0555123456' } });
    expect(rows[2].errors.map((e: any) => [e.field, e.code])).toEqual([
      ['clientName', 'VALIDATION_ERROR'],
      ['phone', 'VALIDATION_ERROR'],
      ['wilaya', 'VALIDATION_ERROR'],
      ['address', 'VALIDATION_ERROR'],
      ['items', 'NOT_FOUND'],
    ]);
    // the stock (3) is used by the rows above: the 4th row would need a 4th unit
    expect(rows[3].errors).toEqual([{ field: 'items', code: 'ORDER_INSUFFICIENT_STOCK', params: { product: 'Robe', available: 0 } }]);

    expect((await owner.post(`/orders/import/${jobId}/commit`).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    await owner.post(`/orders/import/${jobId}/commit`).set(idem()).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    const committed = await jobOf(owner, jobId);
    expect(committed).toMatchObject({ status: 'partial', name: 'order-import-commit', result: { stage: 'committed', report: { created: 2, skipped: 2, failed: [] } } });
    const orders = await db.order.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { number: 'asc' } });
    expect(orders.map((o) => [o.source, o.status, o.importJobId, o.clientPhone])).toEqual([
      ['import', 'new', jobId, '0555123456'],
      ['import', 'new', jobId, '0770112233'],
    ]);
    expect(orders[0]!.notes).toBe('appeler le soir');
    // imported orders are `new`: their 3 units are held (no movement) until they are confirmed (owner decision 2026-10-21)
    expect((await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock).toBe(3);
    expect((await owner.get(`/products/${robe.id}`).expect(200)).body.data.stockDetail.reserved).toBe(3);
    expect(await db.client.count({ where: { workspaceId: owner.workspaceId } })).toBe(2);
    const view = (await owner.get(`/orders/${orders[0]!.id}`).expect(200)).body.data;
    expect(view.source).toMatchObject({ source: 'import', importFileName: 'commandes.csv' });
    // committing again changes nothing
    await owner.post(`/orders/import/${jobId}/commit`).set(idem()).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    expect(await db.order.count({ where: { workspaceId: owner.workspaceId } })).toBe(2);
  });

  it('L80 (client list 22/11): the order date comes from the file (Algiers wall time, stored UTC); empty ⇒ import time; unreadable / future ⇒ row error; reports read the imported date', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    await product(owner, { name: 'Robe', sku: 'ROBE-D', price: 4500, stock: 10 });
    const now = Date.now();
    const old = algiersDay(new Date(now - 15 * 86_400_000));
    const [y, m, d] = old.split('-');
    const tomorrow = algiersDay(new Date(now + 86_400_000)).split('-').reverse().join('/');
    // the nightly rollup already wrote the old day (empty): the imported order must not stay invisible in the reports
    await db.dailyStat.create({ data: { workspaceId: owner.workspaceId, day: new Date(`${old}T00:00:00Z`), metrics: emptyDay() as object } });
    const res = await upload(owner, app, '/orders/import', 'file', file([
      ['Date', 'Nom', 'Téléphone', 'Wilaya', 'Adresse', 'Articles'],
      [`${d}/${m}/${y} 14:30`, 'Amine Benali', '0555123401', '16', 'Cité 200 logements Bt 4', 'ROBE-D×1'],
      ['', 'Sara Kaci', '0770112202', '16', 'Rue Didouche Mourad 12', 'ROBE-D×1'],
      ['31/02/2026', 'Nadia Fares', '0661223303', '16', 'Rue Larbi Ben Mhidi 3', 'ROBE-D×1'],
      [tomorrow, 'Karim Ziani', '0661223304', '16', 'Rue Larbi Ben Mhidi 4', 'ROBE-D×1'],
    ])).expect(202);
    const jobId = res.body.data.jobId;
    await drain(app, owner.workspaceId, ['job']);
    const preview = await jobOf(owner, jobId);
    expect(preview.result).toMatchObject({ stage: 'preview', mapping: { orderedAt: 'Date' }, totals: { rows: 4, valid: 2, invalid: 2 } });
    expect(preview.result.rows.map((r: any) => [r.values.orderedAt, r.errors.map((e: any) => [e.field, e.code, e.params?.reason])])).toEqual([
      [`${old}T13:30:00.000Z`, []],
      [null, []],
      [null, [['orderedAt', 'VALIDATION_ERROR', 'format']]],
      [expect.any(String), [['orderedAt', 'VALIDATION_ERROR', 'future']]],
    ]);
    const before = Date.now();
    await owner.post(`/orders/import/${jobId}/commit`).set(idem()).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    const orders = await db.order.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { number: 'asc' } });
    expect(orders.map((o) => o.clientPhone)).toEqual(['0555123401', '0770112202']);
    expect(orders[0]!.orderedAt.toISOString()).toBe(`${old}T13:30:00.000Z`);
    // the record's own creation stamp stays the import time (audit); the empty date row is dated at the import
    expect(orders[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(orders[1]!.orderedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const view = (await owner.get(`/orders/${orders[0]!.id}`).expect(200)).body.data;
    expect(view.orderedAt).toBe(`${old}T13:30:00.000Z`);
    // orders list « date » filter, analytics of that day (the stale rollup row was dropped) and « today » all read orderedAt
    const listed = (await owner.get(`/orders?from=${old}&to=${old}`).expect(200)).body.data;
    expect(listed.map((o: any) => o.id)).toEqual([orders[0]!.id]);
    expect(await db.dailyStat.count({ where: { workspaceId: owner.workspaceId, day: new Date(`${old}T00:00:00Z`) } })).toBe(0);
    const day = (await owner.get(`/analytics/orders?from=${old}&to=${old}`).expect(200)).body.data;
    expect(day.kpis.orders.value).toBe(1);
    const today = algiersDay();
    expect((await owner.get(`/orders?from=${today}&to=${today}`).expect(200)).body.data.map((o: any) => o.id)).toEqual([orders[1]!.id]);
  });

  it('L81 (client list 22/11): an imported order is cancelled through the normal cancel endpoint — reservation released, order cancelled', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    const robe = await product(owner, { name: 'Robe', sku: 'ROBE-C', price: 4500, stock: 5 });
    const res = await upload(owner, app, '/orders/import', 'file', file([
      ['Nom', 'Téléphone', 'Wilaya', 'Commune', 'Adresse', 'Articles'],
      ['Amine Benali', '0555123411', '16', 'Bab Ezzouar', 'Cité 200 logements Bt 4', 'ROBE-C×2'],
      ['Sara Kaci', '0770112212', '16', 'Hydra', 'Rue Didouche Mourad 12', 'ROBE-C×1'],
    ])).expect(202);
    const jobId = res.body.data.jobId;
    await drain(app, owner.workspaceId, ['job']);
    await owner.post(`/orders/import/${jobId}/commit`).set(idem()).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    const [first, second] = await db.order.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { number: 'asc' } });
    expect((await owner.get(`/products/${robe.id}`).expect(200)).body.data.stockDetail.reserved).toBe(3);
    // the order page offers « Annuler » enabled
    const page = (await owner.get(`/orders/${first!.id}`).expect(200)).body.data;
    expect(page.source.source).toBe('import');
    expect(page.actions.find((a: any) => a.key === 'cancel')).toMatchObject({ enabled: true });
    // the web dialog body: reason + version (notifyCustomer omitted, no conversation)
    const cancelled = (await owner.post(`/orders/${first!.id}/cancel`, { reason: 'changed_mind', note: null, version: page.version }).expect(200)).body.data;
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'changed_mind' });
    expect((await owner.get(`/products/${robe.id}`).expect(200)).body.data.stockDetail.reserved).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock).toBe(5);
    // a confirmed imported order gives its taken stock back on cancel
    const s = (await owner.get(`/orders/${second!.id}`).expect(200)).body.data;
    await owner.post(`/orders/${second!.id}/status`, { to: 'confirmed', version: s.version }).set(idem()).expect(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock).toBe(4);
    const s2 = (await owner.get(`/orders/${second!.id}`).expect(200)).body.data;
    await owner.post(`/orders/${second!.id}/cancel`, { reason: 'other', version: s2.version }).expect(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: robe.id } })).stock).toBe(5);
    expect((await owner.get(`/products/${robe.id}`).expect(200)).body.data.stockDetail.reserved).toBe(0);
  });

  it('missing columns ⇒ failed with IMPORT_COLUMNS_MISSING and stage mapping; mapping dialog ⇒ preview again; roles (Admin+ only) and tenancy', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    await product(owner, { sku: 'TUN-1', price: 2000, stock: 5 });
    const res = await upload(owner, app, '/orders/import', 'file', file([
      ['Client', 'Mobile', 'Wil', 'Adresse complète', 'Panier'],
      ['Yacine Merabet', '0550998877', '31', 'Boulevard Front de mer 10', 'TUN-1x2'],
    ])).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    const failed = await jobOf(owner, res.body.data.jobId);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'IMPORT_COLUMNS_MISSING' }, result: { stage: 'mapping', missingColumns: ['wilaya', 'address', 'items'] } });
    expect((await owner.post('/orders/import/mapping', { jobId: res.body.data.jobId, mapping: { clientName: 'Client', phone: 'Mobile' } }).expect(422)).body.error.code).toBe('IMPORT_COLUMNS_MISSING');
    await owner.post('/orders/import/mapping', { jobId: res.body.data.jobId, mapping: { clientName: 'Client', phone: 'Mobile', wilaya: 'Wil', address: 'Adresse complète', items: 'Panier' } }).expect(202);
    await drain(app, owner.workspaceId, ['job']);
    expect(await jobOf(owner, res.body.data.jobId)).toMatchObject({ status: 'done', result: { stage: 'preview', totals: { valid: 1 } } });
    const admin = await asAdmin(app, owner.workspaceId);
    await upload(admin, app, '/orders/import', 'file', file([['clientName'], ['x']])).expect(202);
    const op = await asOperator(app, owner.workspaceId);
    expect((await upload(op, app, '/orders/import', 'file', file([['a'], ['b']])).expect(403)).body.error.code).toBe('FORBIDDEN');
    await op.post(`/orders/import/${res.body.data.jobId}/commit`).set(idem()).expect(403);
    const other = await asOwner(app);
    await other.post(`/orders/import/${res.body.data.jobId}/commit`).set(idem()).expect(404);
    expect((await owner.post('/orders/import').expect(422)).body.error.fields).toEqual({ file: 'validation.required' });
  });
});

describe('sched-nightly-recommendations (03-events §4)', () => {
  it('one cross-sell job and one stock job per workspace with a delivered order in 90 d; running twice the same night schedules nothing new', async () => {
    const owner = await asOwner(app);
    const p = await product(owner, { stock: 5 });
    const client = await db.client.create({ data: { workspaceId: owner.workspaceId, name: 'Client Nuit', phone: '0699887766', source: 'manual' } });
    await db.order.create({ data: { workspaceId: owner.workspaceId, number: 'CMD-9001', clientId: client.id, source: 'manual', status: 'delivered', deliveredAt: new Date(), clientName: 'Client Nuit', clientPhone: '0699887766', subtotal: 2500, total: 2500, items: { create: [{ productId: p.id, productName: p.name, unitPrice: 2500, quantity: 1, total: 2500 }] } } });
    const scheduler = app.app.get(RecommendationsScheduler);
    await scheduler.nightly();
    await scheduler.nightly();
    const jobs = await db.job.findMany({ where: { workspaceId: owner.workspaceId, kind: 'recommendations' } });
    expect(jobs.map((j) => (j.payload as { name: string }).name).sort()).toEqual(['recommendations-generate', 'stock-recommendations-generate']);
    await drain(app, owner.workspaceId, ['job']);
    expect((await db.job.findMany({ where: { workspaceId: owner.workspaceId, kind: 'recommendations' } })).every((j) => j.status === 'done')).toBe(true);
    // nightly jobs notify nobody
    expect(await db.notification.count({ where: { workspaceId: owner.workspaceId, type: 'job_finished' } })).toBe(0);
  });
});
