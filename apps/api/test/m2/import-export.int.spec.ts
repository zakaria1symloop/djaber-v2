// M2 — catalogue import (CAT-06, FL-12: preview → mapping → atomic commit), exports (job + signed file), jobs endpoints.
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { rawPrisma, TenantContext } from '@djaber/db';
import { AuditService } from '../../src/core/audit/audit.service';
import { ConfigService } from '../../src/core/config/config.service';
import { ProcessorRegistry } from '../../src/core/queue/processor.registry';
import { QueueService } from '../../src/core/queue/queue.service';
import { WsEmitter } from '../../src/core/ws/ws.emitter';
import { readXlsx, writeXlsx } from '../../src/modules/jobs/xlsx';
import { parseCsv } from '../../src/modules/jobs/table-file';
import { ModerationHookService } from '../../src/modules/catalog/moderation-hook.service';
import { OutboxRelay } from '../../src/worker/outbox.relay';
import { WorkerModule } from '../../src/worker/worker.module';
import { WorkerRunner } from '../../src/worker/worker.runner';
import { asAdmin, asOperator, asOwner, type Actor } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { adjust, createProduct, csv, db, drain, image, jobOf, key, upload, wsEvents } from '../support/m2';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => jest.restoreAllMocks());

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const csvFile = (rows: (string | number)[][], name = 'catalogue.csv') => ({ buffer: csv(rows), name, type: 'text/csv' });
const startImport = async (actor: Actor, file: { buffer: Buffer; name: string; type: string }) => {
  const res = await upload(actor, app, '/products/import', 'file', [file]).expect(202);
  return res.body.data.jobId as string;
};
const commit = (actor: Actor, jobId: string, idem = key()) => actor.post(`/products/import/${jobId}/commit`).set('Idempotency-Key', idem);
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

describe('catalogue import', () => {
  it('AT-CAT-05 file with 3 bad rows ⇒ preview shows row errors; commit writes only valid rows in one transaction; mid-failure ⇒ nothing written; plan limit respected', async () => {
    const owner = await asOwner(app);
    await createProduct(owner, { sku: 'EXIST-1', name: 'Déjà là' });
    const file = csvFile([
      ['Référence', 'Nom', 'Prix de vente', "Prix d'achat", 'Quantité', 'Catégorie', 'Unité', 'Seuil', 'Mots-clés', 'Actif'],
      ['IMP-1', 'Tapis berbère', '12 500 DA', '8000', '4', 'Maison', 'pc', '1', 'tapis; laine', 'oui'],
      ['IMP-2', 'Théière', '3500', '', '10', 'Cuisine', 'Pièce', '', '', ''],
      ['IMP-3', '', '900', '', '1', '', '', '', '', ''], // bad: no name
      ['IMP-4', 'Plateau', 'gratuit', '', '1', '', '', '', '', ''], // bad: price
      ['IMP-1', 'Doublon', '100', '', '1', '', '', '', '', ''], // bad: SKU twice in the file
      ['EXIST-1', 'Conflit', '100', '', '1', '', '', '', '', ''], // bad: SKU already in the catalogue
      ['', 'Bougie parfumée', '1.200', '400', '0', 'maison', '', '', '', 'non'],
      ['IMP-8', 'Verre', '250', '', '-3', '', 'carton', '', '', ''], // bad: quantity and unknown unit
    ]);
    const jobId = await startImport(owner, file);
    expect(await jobOf(owner, jobId)).toMatchObject({ id: jobId, kind: 'import', name: 'product-import-preview', status: 'queued', progress: 0, result: null, error: null });
    expect(await drain(app, owner.workspaceId)).toEqual(['product-import-preview']);

    const preview = await jobOf(owner, jobId);
    expect(preview).toMatchObject({ status: 'done', progress: 100, total: 8, error: null, resultUrl: null });
    expect(preview.result).toMatchObject({
      stage: 'preview',
      fileName: 'catalogue.csv',
      missingColumns: [],
      mapping: { sku: 'Référence', name: 'Nom', price: 'Prix de vente', costPrice: "Prix d'achat", stock: 'Quantité', category: 'Catégorie', unit: 'Unité', minStock: 'Seuil', keywords: 'Mots-clés', isActive: 'Actif' },
      totals: { rows: 8, valid: 3, invalid: 5, create: 3, update: 0, overPlanLimit: 0, newCategories: 2 },
    });
    const rows = preview.result.rows;
    expect(rows.map((r: any) => [r.row, r.ok, r.action])).toEqual([[2, true, 'create'], [3, true, 'create'], [4, false, 'skip'], [5, false, 'skip'], [6, false, 'skip'], [7, false, 'skip'], [8, true, 'create'], [9, false, 'skip']]);
    expect(rows[0].values).toMatchObject({ sku: 'IMP-1', name: 'Tapis berbère', price: 12500, costPrice: 8000, stock: 4, category: 'Maison', unit: 'pc', minStock: 1, keywords: 'tapis, laine', isActive: true });
    expect(rows[2].errors).toEqual([{ field: 'name', code: 'validation.required' }]);
    expect(rows[3].errors).toEqual([{ field: 'price', code: 'validation.price_integer' }]); // 04 §1 « Import amounts » (not a whole number of DA)
    expect(rows[4].errors).toEqual([{ field: 'sku', code: 'IMPORT_DUPLICATE_SKU_IN_FILE', params: { row: 2 } }]);
    expect(rows[5].errors).toEqual([{ field: 'sku', code: 'PRODUCT_SKU_ALREADY_EXISTS' }]);
    expect(rows[6].values).toMatchObject({ sku: null, price: 1200, isActive: false });
    expect(rows[7].errors).toEqual([{ field: 'stock', code: 'validation.quantity' }, { field: 'unit', code: 'validation.invalid' }]);
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(1); // a preview writes nothing
    expect((await wsEvents(owner.workspaceId, 'job.updated')).map((e) => e.payload.job.status)).toEqual(['queued', 'running', 'done']);

    // --- mid-failure: a late step of the transaction fails ⇒ no product, no category, no movement
    expect((await owner.post(`/products/import/${jobId}/commit`).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const boom = jest.spyOn(app.app.get(ModerationHookService), 'submitMany').mockImplementation(async () => {
      throw new Error('disk full'); // after the categories, the products and the movements were inserted
    });
    await commit(owner, jobId).expect(202);
    await expect(drain(app, owner.workspaceId)).rejects.toThrow('disk full');
    boom.mockRestore();
    await db.outbox.updateMany({ where: { workspaceId: owner.workspaceId, topic: 'job', processedAt: null }, data: { processedAt: new Date() } });
    expect(await jobOf(owner, jobId)).toMatchObject({ status: 'failed', error: { code: 'INTERNAL' } });
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect(await db.category.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(await db.stockMovement.count({ where: { workspaceId: owner.workspaceId, reason: 'import' } })).toBe(0);

    // the preview is computed again (same mapping), then committed for real
    await owner.post('/products/import/mapping', { jobId, mapping: preview.result.mapping }).expect(202);
    await drain(app, owner.workspaceId);
    const idem = key();
    const accepted = await commit(owner, jobId, idem).expect(202);
    expect(accepted.body.data.jobId).toBe(jobId);
    expect((await commit(owner, jobId, idem).expect(202)).headers['idempotent-replayed']).toBe('true');
    expect(await drain(app, owner.workspaceId)).toEqual(expect.arrayContaining(['product-import-commit']));
    const done = await jobOf(owner, jobId);
    expect(done).toMatchObject({ status: 'partial', name: 'product-import-commit', result: { stage: 'committed', report: { created: 3, updated: 0, skipped: 5, categoriesCreated: 2 } } });
    // the skipped rows come back as a private file (signed URL)
    // recette 09/11 UX-044: named after the imported file, the reason in the importer's language, then the code
    expect(done.resultUrl).toMatch(/\/files\/private\/ws\/.+\/imports\/.+-erreurs\.csv\?exp=/);
    const report = parseCsv((await download(done.resultUrl).expect(200)).body.toString('utf8'));
    // retest 11/11 UX-054: the value as typed comes before the reason
    expect(report[0]).toEqual(['row', 'sku', 'name', 'column', 'value', 'error', 'code']);
    expect(report.slice(1).every((r) => !!r[5] && r[5] !== r[6] && !r[5].startsWith('validation.'))).toBe(true);
    expect(report[2]![5]).toBe('Prix invalide : nombre entier en DA');
    expect(report[2]![4]).toBe('gratuit');
    expect(report.slice(1).map((r) => [r[0], r[1], r[2], r[3], r[6]])).toEqual([
      ['4', 'IMP-3', '', 'Nom', 'validation.required'],
      ['5', 'IMP-4', 'Plateau', 'Prix de vente', 'validation.price_integer'],
      ['6', 'IMP-1', 'Doublon', 'Référence', 'IMPORT_DUPLICATE_SKU_IN_FILE'],
      ['7', 'EXIST-1', 'Conflit', 'Référence', 'PRODUCT_SKU_ALREADY_EXISTS'],
      ['9', 'IMP-8', 'Verre', 'Quantité', 'validation.quantity'],
      ['9', 'IMP-8', 'Verre', 'Unité', 'validation.invalid'],
    ]);

    const imported = await db.product.findMany({ where: { workspaceId: owner.workspaceId, sku: { not: 'EXIST-1' } }, orderBy: { name: 'asc' }, include: { category: true, unit: true } });
    expect(imported.map((p) => [p.name, p.sku.startsWith('PRD-') ? 'generated' : p.sku, p.price, p.costPrice, p.stock, p.minStock, p.category?.name, p.unit?.abbreviation ?? null, p.isActive, p.moderationStatus])).toEqual([
      ['Bougie parfumée', 'generated', 1200, 400, 0, 0, 'Maison', null, false, 'approved'],
      ['Tapis berbère', 'IMP-1', 12500, 8000, 4, 1, 'Maison', 'pc', true, 'approved'],
      ['Théière', 'IMP-2', 3500, null, 10, 0, 'Cuisine', 'pc', true, 'approved'],
    ]);
    expect(imported[1]!.keywords).toEqual(['tapis', 'laine']);
    expect((await db.category.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { name: 'asc' } })).map((c) => c.name)).toEqual(['Cuisine', 'Maison']); // "maison" reuses "Maison"
    const movements = await db.stockMovement.findMany({ where: { workspaceId: owner.workspaceId, reason: 'import' }, orderBy: { quantity: 'asc' } });
    expect(movements.map((m) => [m.type, m.quantity, m.quantityBefore, m.quantityAfter, m.refType, m.refId, m.actorId])).toEqual([['in', 4, 0, 4, 'import', jobId, owner.userId], ['in', 10, 0, 10, 'import', jobId, owner.userId]]);
    const items = await db.moderationItem.findMany({ where: { workspaceId: owner.workspaceId, source: 'import' } });
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status === 'auto_approved')).toBe(true);

    // committing again (new key, or the worker running the job twice) writes nothing more
    await commit(owner, jobId).expect(202);
    await drain(app, owner.workspaceId);
    await TenantContext.runSystem(() => app.app.get(ProcessorRegistry).handlers.get('jobs')!.get('product-import-commit')!({ jobId }, {} as never));
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(4);
    expect((await owner.post('/products/import/mapping', { jobId, mapping: preview.result.mapping }).expect(409)).body.error.code).toBe('CONFLICT');
    await drain(app, owner.workspaceId, ['notification']);
    expect((await db.notification.findMany({ where: { workspaceId: owner.workspaceId, userId: owner.userId } })).map((n) => n.type).sort()).toEqual(['job_failed', 'job_finished', 'product_approved']); // M10: auto-approved import rows ⇒ one grouped product.approved (03-events §5.1)
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'product.import_commit', entityId: jobId } }));
    expect(audit).not.toBeNull();

    // --- plan limit: the free plan has 50 slots; rows beyond are reported in the preview and never written
    const free = await asOwner(app, 'free');
    await db.product.createMany({ data: Array.from({ length: 48 }, (_, i) => ({ workspaceId: free.workspaceId, sku: `OLD-${i}`, name: `Old ${i}`, price: 100, stock: 1 })) });
    const limited = await startImport(free, csvFile([['nom', 'prix'], ['Un', '100'], ['Deux', '200'], ['Trois', '300'], ['Quatre', '400']]));
    await drain(app, free.workspaceId);
    const limitedPreview = await jobOf(free, limited);
    expect(limitedPreview.result.totals).toMatchObject({ rows: 4, valid: 2, invalid: 2, overPlanLimit: 2 });
    expect(limitedPreview.result.rows[2].errors).toEqual([{ field: null, code: 'PLAN_LIMIT', params: { resource: 'products', limit: 50, current: 48 } }]);
    // a product created between the preview and the commit: the whole commit is refused, nothing is written
    await createProduct(free, { sku: 'RACE' });
    await commit(free, limited).expect(202);
    await drain(app, free.workspaceId);
    expect(await jobOf(free, limited)).toMatchObject({ status: 'failed', error: { code: 'PLAN_LIMIT', params: { resource: 'products', limit: 50, current: 49 } } });
    expect(await db.product.count({ where: { workspaceId: free.workspaceId } })).toBe(49);
  });

  it('a 2 000-row XLSX file previews in < 5 s and commits atomically', async () => {
    const owner = await asOwner(app); // pro plan: unlimited products
    const sheet: (string | number)[][] = [['SKU', 'Name', 'Description', 'Category', 'Price', 'Cost', 'Stock', 'Min stock']];
    for (let i = 1; i <= 2000; i++) sheet.push([`XL-${i}`, `Produit importé ${i} & co <${i}>`, `Description du produit n° ${i}`, `Rayon ${i % 12}`, 1000 + i, 500 + (i % 300), i % 40, 2]);
    const file = { buffer: writeXlsx('Produits', sheet), name: 'gros-catalogue.xlsx', type: XLSX };
    expect(file.buffer.length).toBeLessThan(5 * 1024 * 1024);

    const started = Date.now();
    const jobId = await startImport(owner, file);
    await drain(app, owner.workspaceId);
    const preview = await jobOf(owner, jobId);
    const elapsed = Date.now() - started;
    expect(preview).toMatchObject({ status: 'done', total: 2000 });
    expect(preview.result.totals).toMatchObject({ rows: 2000, valid: 2000, invalid: 0, create: 2000, newCategories: 12 });
    expect(preview.result.rows[1999].values).toMatchObject({ sku: 'XL-2000', name: 'Produit importé 2000 & co <2000>', price: 3000 });
    expect(elapsed).toBeLessThan(5000);

    await commit(owner, jobId).expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, jobId)).toMatchObject({ status: 'done', result: { stage: 'committed', report: { created: 2000, updated: 0, skipped: 0, categoriesCreated: 12 } } });
    expect(await db.product.count({ where: { workspaceId: owner.workspaceId } })).toBe(2000);
    expect(await db.moderationItem.count({ where: { workspaceId: owner.workspaceId } })).toBe(2000);
    expect(await db.stockMovement.count({ where: { workspaceId: owner.workspaceId } })).toBe(1950); // rows with a quantity of 0 have no movement
    const sum = await db.product.aggregate({ where: { workspaceId: owner.workspaceId }, _sum: { stock: true } });
    const moved = await db.stockMovement.aggregate({ where: { workspaceId: owner.workspaceId }, _sum: { quantity: true } });
    expect(sum._sum.stock).toBe(moved._sum.quantity);
    expect((await owner.get('/products?q=XL-1999').expect(200)).body.data[0]).toMatchObject({ sku: 'XL-1999', stock: 39, moderation: { status: 'approved' }, category: { name: 'Rayon 7' } });

    // 2 001 rows ⇒ IMPORT_TOO_LARGE (job), a file over 5 MB ⇒ IMPORT_TOO_LARGE (upload)
    sheet.push(['XL-2001', 'Un de trop', '', '', 10, '', 0, 0]);
    const tooMany = await startImport(owner, { buffer: writeXlsx('Produits', sheet), name: 'trop.xlsx', type: XLSX });
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, tooMany)).toMatchObject({ status: 'failed', error: { code: 'IMPORT_TOO_LARGE', message: expect.stringMatching(/2\s000/u) } }); // « 2 000 » (rule 11)
    const heavy = await upload(owner, app, '/products/import', 'file', [{ buffer: Buffer.concat([Buffer.from('nom,prix\n'), Buffer.alloc(5 * 1024 * 1024 + 1, 'a')]), name: 'lourd.csv', type: 'text/csv' }]).expect(422);
    expect(heavy.body.error.code).toBe('IMPORT_TOO_LARGE');
  }, 120_000);

  it('column mapping: unknown headers ⇒ IMPORT_COLUMNS_MISSING with the headers kept; mapping re-runs the preview; updateExisting; saved mapping', async () => {
    const owner = await asOwner(app);
    const existing = await createProduct(owner, { sku: 'UP-1', name: 'Ancien nom', price: 1000, stock: 5 });
    const rows = [['code', 'intitulé', 'tarif', 'qté dispo'], ['UP-1', 'Nouveau nom', '1300', '9'], ['NEW-1', 'Tout neuf', '700', '3']];
    const jobId = await startImport(owner, csvFile(rows, 'export-erp.csv'));
    await drain(app, owner.workspaceId);
    const failed = await jobOf(owner, jobId);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'IMPORT_COLUMNS_MISSING', params: { columns: 'name, price' } } });
    expect(failed.error.message).toContain('name, price');
    expect(failed.result).toMatchObject({ stage: 'mapping', headers: ['code', 'intitulé', 'tarif', 'qté dispo'], mapping: { sku: 'code' }, missingColumns: ['name', 'price'], rows: [] });
    expect((await commit(owner, jobId).expect(409)).body.error.code).toBe('CONFLICT');

    const bad = await owner.post('/products/import/mapping', { jobId, mapping: { name: 'intitulé' } }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'IMPORT_COLUMNS_MISSING', params: { columns: 'price' }, fields: { 'mapping.price': 'validation.required' } });
    expect((await owner.post('/products/import/mapping', { jobId, mapping: { name: 'intitulé', price: 'colonne absente' } }).expect(422)).body.error.fields).toEqual({ 'mapping.price': 'validation.invalid' });
    expect((await owner.post('/products/import/mapping', { jobId, mapping: { name: 'intitulé', price: 'intitulé' } }).expect(422)).body.error.fields).toEqual({ mapping: 'validation.invalid' });
    expect((await owner.post('/products/import/mapping', { jobId, mapping: { nom: 'intitulé' } }).expect(422)).body.error.code).toBe('VALIDATION_ERROR');

    const mapping = { sku: 'code', name: 'intitulé', price: 'tarif', stock: 'qté dispo' };
    await owner.post('/products/import/mapping', { jobId, mapping, saveMapping: true }).expect(202);
    await drain(app, owner.workspaceId);
    const strict = await jobOf(owner, jobId);
    expect(strict).toMatchObject({ status: 'done', name: 'product-import-preview', error: null });
    expect(strict.result.totals).toMatchObject({ valid: 1, invalid: 1, create: 1, update: 0 });
    expect(strict.result.rows[0].errors).toEqual([{ field: 'sku', code: 'PRODUCT_SKU_ALREADY_EXISTS' }]);

    await owner.post('/products/import/mapping', { jobId, mapping, updateExisting: true }).expect(202);
    await drain(app, owner.workspaceId);
    const lenient = await jobOf(owner, jobId);
    expect(lenient.result).toMatchObject({ updateExisting: true, totals: { valid: 2, invalid: 0, create: 1, update: 1 } });
    expect(lenient.result.rows.map((r: any) => r.action)).toEqual(['update', 'create']);
    await commit(owner, jobId).expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, jobId)).toMatchObject({ status: 'done', result: { report: { created: 1, updated: 1, skipped: 0 } } });
    const updated = (await owner.get(`/products/${existing.id}`).expect(200)).body.data;
    expect(updated).toMatchObject({ name: 'Nouveau nom', price: 1300, stock: 9, version: 2, contentVersion: 2 }); // renamed ⇒ re-submitted
    const journal = await db.stockMovement.findMany({ where: { productId: existing.id }, orderBy: { createdAt: 'asc' } });
    expect(journal.map((m) => [m.type, m.reason, m.quantity, m.quantityBefore, m.quantityAfter])).toEqual([['in', 'initial', 5, 0, 5], ['adjustment_in', 'import', 4, 5, 9]]);

    // the saved mapping applies to the next file with the same headers: no mapping step
    const next = await startImport(owner, csvFile([rows[0]!, ['NEW-2', 'Encore un', '450', '1']], 'export-erp-2.csv'));
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, next)).toMatchObject({ status: 'done', result: { stage: 'preview', mapping, totals: { valid: 1 } } });
    // an empty file
    const empty = await startImport(owner, csvFile([['nom', 'prix']]));
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, empty)).toMatchObject({ status: 'failed', error: { code: 'IMPORT_COLUMNS_MISSING' } });
  });

  it('upload validation, roles and tenancy of the import endpoints', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const file = csvFile([['nom', 'prix'], ['Un', '100']]);
    expect((await upload(owner, app, '/products/import', 'file', []).expect(422)).body.error.fields).toEqual({ file: 'validation.required' });
    expect((await upload(owner, app, '/products/import', 'file', [{ buffer: Buffer.from('%PDF'), name: 'a.pdf', type: 'application/pdf' }]).expect(415)).body.error.code).toBe('UPLOAD_TYPE_INVALID');
    expect((await upload(owner, app, '/products/import', 'file', [{ buffer: Buffer.from('nom,prix'), name: 'faux.xlsx', type: XLSX }]).expect(415)).body.error.code).toBe('UPLOAD_TYPE_INVALID');
    expect((await upload(operator, app, '/products/import', 'file', [file]).expect(403)).body.error.code).toBe('FORBIDDEN');

    const jobId = await startImport(owner, file);
    await drain(app, owner.workspaceId);
    expect((await operator.post('/products/import/mapping', { jobId, mapping: { name: 'nom', price: 'prix' } }).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await commit(operator, jobId).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await commit(stranger, jobId).expect(404)).body.error.code).toBe('NOT_FOUND');
    await stranger.post('/products/import/mapping', { jobId, mapping: { name: 'nom', price: 'prix' } }).expect(404);
    await stranger.get(`/jobs/${jobId}`).expect(404);
    await operator.get(`/jobs/${jobId}`).expect(404); // an operator only sees the jobs they started
    expect((await (await asAdmin(app, owner.workspaceId)).get(`/jobs/${jobId}`).expect(200)).body.data.id).toBe(jobId);
    // an import job of another kind cannot be committed
    const exportJob = (await owner.get('/products/export').expect(202)).body.data.jobId;
    expect((await commit(owner, exportJob).expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('client list L77 / L78: the products export imports back as the same catalogue (variants, stock flags, negative stock), into a new shop and onto itself', async () => {
    const owner = await asOwner(app);
    const category = (await owner.post('/categories', { name: 'Robes' }).expect(201)).body.data;
    const robe = await createProduct(owner, {
      sku: 'ROBE',
      name: 'Robe kabyle',
      price: 4000,
      costPrice: 2000,
      minStock: 2,
      categoryId: category.id,
      sellOutOfStock: true,
      description: 'Brodée main',
      weightGrams: 800,
      keywords: ['robe', 'fête'],
      stock: undefined,
      variants: [
        { name: 'S', sku: 'ROBE-S', price: 4000, stock: 3, minStock: 1 },
        { name: 'M', price: 4200, costPrice: 2100, stock: 0, isActive: false },
      ],
    });
    const s = await db.productVariant.findFirstOrThrow({ where: { productId: robe.id, name: 'S' } });
    await adjust(owner, { productId: robe.id, variantId: s.id, type: 'out', quantity: 5, reason: 'correction', force: true }).expect(201); // backorders: 3 → -2
    await createProduct(owner, { sku: 'SRV', name: 'Retouche', price: 500, trackStock: false, stock: undefined });
    await createProduct(owner, { sku: 'THE', name: 'Thé vert', price: 800, oldPrice: 950, stock: 12, minStock: 4, isActive: false });

    const snapshot = async (workspaceId: string) =>
      (await db.product.findMany({ where: { workspaceId, deletedAt: null }, orderBy: { sku: 'asc' }, include: { category: true, variants: { where: { deletedAt: null }, orderBy: { name: 'asc' } } } })).map((p) => ({
        sku: p.sku,
        name: p.name,
        category: p.category?.name ?? null,
        price: p.price,
        oldPrice: p.oldPrice,
        costPrice: p.costPrice,
        stock: p.stock,
        minStock: p.minStock,
        trackStock: p.trackStock,
        sellOutOfStock: p.sellOutOfStock,
        hasVariants: p.hasVariants,
        isActive: p.isActive,
        description: p.description,
        weightGrams: p.weightGrams,
        keywords: p.keywords,
        variants: p.variants.map((v) => ({ name: v.name, sku: v.sku, price: v.price, costPrice: v.costPrice, stock: v.stock, minStock: v.minStock, isActive: v.isActive })),
      }));
    const before = await snapshot(owner.workspaceId);
    expect(before.find((p) => p.sku === 'ROBE')).toMatchObject({ stock: -2, hasVariants: true, sellOutOfStock: true });
    const exportFile = async (format: 'csv' | 'xlsx', locale: string) => {
      const jobId = (await owner.get(`/products/export?format=${format}`).set('Accept-Language', locale).expect(202)).body.data.jobId;
      await drain(app, owner.workspaceId);
      return (await download((await jobOf(owner, jobId)).resultUrl).expect(200)).body as Buffer;
    };

    // --- into a new shop (fr CSV): same products, variants, flags and quantities; no « SKU en double »
    const other = await asOwner(app);
    const jobId = await startImport(other, { buffer: await exportFile('csv', 'fr'), name: 'produits.csv', type: 'text/csv' });
    await drain(app, other.workspaceId);
    const preview = await jobOf(other, jobId);
    expect(preview).toMatchObject({ status: 'done', result: { stage: 'preview', totals: { rows: 5, valid: 5, invalid: 0, create: 3, update: 0, variants: 2 } } });
    expect(preview.result.mapping).toMatchObject({ sku: 'SKU', variant: 'Variante', variantSku: 'SKU variante', trackStock: 'Suivi du stock', sellOutOfStock: 'Vente en rupture', minStock: 'Seuil', description: 'Description', weightGrams: 'Poids (g)', keywords: 'Mots-clés' });
    await commit(other, jobId).expect(202);
    await drain(app, other.workspaceId);
    expect(await jobOf(other, jobId)).toMatchObject({ status: 'done', result: { report: { created: 3, updated: 0, skipped: 0, categoriesCreated: 1, variantsCreated: 2 } } });
    expect(await snapshot(other.workspaceId)).toEqual(before);
    const robeCopy = await db.product.findFirstOrThrow({ where: { workspaceId: other.workspaceId, sku: 'ROBE' } });
    expect((await db.stockMovement.findMany({ where: { productId: robeCopy.id }, orderBy: { createdAt: 'asc' } })).map((m) => [m.type, m.reason, m.refType, m.quantity])).toEqual([
      ['adjustment_out', 'import', 'import', -2], // variant S sold at zero stock: -2 as in the file
    ]);

    // --- onto itself (ar XLSX, « mettre à jour les produits existants »): every row updates, nothing changes
    const again = await startImport(owner, { buffer: await exportFile('xlsx', 'ar'), name: 'products.xlsx', type: XLSX });
    await drain(app, owner.workspaceId);
    const strict = await jobOf(owner, again);
    // without updateExisting the SKUs are taken — reported per product, not as duplicates of the file
    expect(strict.result.rows.flatMap((r: any) => r.errors.map((e: any) => e.code))).not.toContain('IMPORT_DUPLICATE_SKU_IN_FILE');
    await owner.post('/products/import/mapping', { jobId: again, mapping: strict.result.mapping, updateExisting: true }).expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, again)).toMatchObject({ status: 'done', result: { totals: { valid: 5, invalid: 0, create: 0, update: 3, variants: 2 } } });
    await commit(owner, again).expect(202);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, again)).toMatchObject({ status: 'done', result: { report: { created: 0, updated: 3, skipped: 0 } } });
    expect(await snapshot(owner.workspaceId)).toEqual(before);
  });
});

describe('exports and jobs', () => {
  it('GET /products/export → 202 job → XLSX under private/ with a signed URL; CSV and bulk export; filters applied', async () => {
    const owner = await asOwner(app);
    const category = (await owner.post('/categories', { name: 'Thés' }).expect(201)).body.data;
    const a = await createProduct(owner, { name: 'Thé vert', sku: 'TEA-1', price: 800, oldPrice: 950, costPrice: 300, stock: 12, minStock: 2, categoryId: category.id });
    const b = await createProduct(owner, { name: '=Formule', sku: 'TEA-2', price: 500, stock: undefined, variants: [{ name: '100 g', price: 500 }, { name: '250 g', price: 1100 }], isActive: false });
    await createProduct(owner, { name: 'Service', price: 100, trackStock: false });

    const accepted = await owner.get('/products/export?type=stock&sort=name').expect(202);
    const jobId = accepted.body.data.jobId;
    expect(await jobOf(owner, jobId)).toMatchObject({ kind: 'export', name: 'export', status: 'queued', resultUrl: null, expiresAt: expect.any(String) });
    expect(await drain(app, owner.workspaceId)).toEqual(['export']);
    const job = await jobOf(owner, jobId);
    expect(job).toMatchObject({ status: 'done', progress: 100, result: { kind: 'products', rows: 4, format: 'xlsx' } });
    expect(job.result.fileName).toMatch(/^produits-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(job.resultUrl).toMatch(/\/api\/v1\/files\/private\/ws\/.+\/exports\/.+\.xlsx\?exp=\d+&sig=/);
    const upload = await db.upload.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, kind: 'export' } });
    expect(upload.storageKey.startsWith(`private/ws/${owner.workspaceId}/exports/`)).toBe(true);
    const sheet = readXlsx((await download(job.resultUrl).expect(200)).body);
    expect(sheet.map((r) => r.slice(0, 14))).toEqual([
      // PV 08/11: one line per variant, at its own price. Client list L77 / L78: the product line comes first (its own
      // price and flags, no stock — the sum of its variants), then the stock flags; the file imports back as is
      ['SKU', 'Nom', 'Variante', 'SKU variante', 'Catégorie', 'Unité', 'Prix', 'Ancien prix', 'Coût', 'Stock', 'Seuil', 'Suivi du stock', 'Vente en rupture', 'Actif'],
      ['TEA-2', "'=Formule", '', '', '', '', '500', '', '', '', '0', 'Oui', 'Non', 'Non'], // formula injection neutralised
      ['TEA-2', "'=Formule", '100 g', expect.any(String), '', '', '500', '', '', '0', '0', '', '', 'Oui'],
      ['TEA-2', "'=Formule", '250 g', expect.any(String), '', '', '1100', '', '', '0', '0', '', '', 'Oui'],
      ['TEA-1', 'Thé vert', '', '', 'Thés', '', '800', '950', '300', '12', '2', 'Oui', 'Non', 'Oui'],
    ]);
    expect(sheet[0]!.slice(14)).toEqual(['Description', 'Poids (g)', 'Mots-clés']);
    // the file is private: no signature, a wrong one or another key ⇒ 404
    const path = new URL(job.resultUrl).pathname;
    await request(app.http()).get(path).expect(404);
    await request(app.http()).get(`${path}?exp=${Math.floor(Date.now() / 1000) + 600}&sig=forged`).expect(404);
    expect((await wsEvents(owner.workspaceId, 'job.updated')).filter((e) => e.payload.job.id === jobId).map((e) => e.payload.job.status)).toEqual(['queued', 'running', 'done']);
    await drain(app, owner.workspaceId, ['notification']);
    expect(await db.notification.findFirst({ where: { workspaceId: owner.workspaceId, type: 'job_finished', userId: owner.userId } })).toMatchObject({ data: expect.objectContaining({ jobId, kind: 'export' }) });

    // CSV, in English
    const csvJob = (await owner.get('/products/export?format=csv&q=vert').set('Accept-Language', 'en').expect(202)).body.data.jobId;
    await drain(app, owner.workspaceId);
    const csvResult = await jobOf(owner, csvJob);
    const text = (await download(csvResult.resultUrl).expect(200)).body.toString('utf8');
    // the language of the member who asked for it (weak-points audit 12/11, 07 §4 « Language source »), not the shop's (fr)
    expect(parseCsv(text)).toEqual([
      ['SKU', 'Name', 'Variant', 'Variant SKU', 'Category', 'Unit', 'Price', 'Old price', 'Cost', 'Stock', 'Threshold', 'Track stock', 'Sell out of stock', 'Active', 'Description', 'Weight (g)', 'Keywords'],
      ['TEA-1', 'Thé vert', '', '', 'Thés', '', '800', '950', '300', '12', '2', 'Yes', 'No', 'Yes', '', '', ''],
    ]);

    // selection export, archived rows included
    await owner.delete(`/products/${a.id}`).expect(204);
    const bulk = (await owner.post('/products/bulk/export', { ids: [a.id, b.id] }).expect(202)).body.data.jobId;
    await drain(app, owner.workspaceId);
    expect((await jobOf(owner, bulk)).result).toMatchObject({ rows: 4 }); // TEA-1 + TEA-2 and its two variants
    expect((await owner.get('/products/export?sort=nope').expect(400)).body.error.code).toBe('BAD_REQUEST');
    expect((await owner.get('/products/export?format=pdf').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('worker pipeline with the real queue: outbox relay → BullMQ `jobs` / `media` → registered handlers', async () => {
    // rows left by the other tests of this file are not part of this scenario
    await db.outbox.updateMany({ where: { processedAt: null }, data: { processedAt: new Date() } });
    const owner = await asOwner(app);
    const p = await createProduct(owner, { name: 'Pipeline', sku: 'PIPE-1' });
    const registry = app.app.get(ProcessorRegistry);
    const relay = new OutboxRelay(registry, app.app.get(WsEmitter), app.app.get(AuditService));
    const runner = new WorkerRunner(app.app.get(ConfigService), registry);
    await runner.start({ crons: false });
    try {
      const jobId = (await owner.get('/products/export?format=csv').expect(202)).body.data.jobId;
      const picture = (await upload(owner, app, `/products/${p.id}/images`, 'file', [{ buffer: await image(800, 800), name: 'p.jpg', type: 'image/jpeg' }]).expect(201)).body.data;
      const done = await eventually(async () => {
        await relay.tick();
        const job = await jobOf(owner, jobId);
        const img = await db.productImage.findUniqueOrThrow({ where: { id: picture.id } });
        return job.status === 'done' && img.storageKey.endsWith('/image.webp') ? job : null;
      }, 20_000);
      expect(done).toMatchObject({ status: 'done', result: { kind: 'products', rows: 1, format: 'csv' } });
      expect(parseCsv((await download(done!.resultUrl).expect(200)).body.toString('utf8'))[1]![0]).toBe('PIPE-1');
      // deterministic BullMQ job ids (03 §3): `job:<jobId>`, `img:<productImageId>` (":" is not allowed by BullMQ)
      const queues = app.app.get(QueueService);
      expect(await queues.queue('jobs').getJob(`job_${jobId}`)).toMatchObject({ name: 'export', data: { jobId, workspaceId: owner.workspaceId } });
      expect(await queues.queue('media').getJob(`img_${picture.id}`)).toMatchObject({ name: 'reencode-image', opts: expect.objectContaining({ attempts: 3 }) });
    } finally {
      await runner.onModuleDestroy();
    }
  }, 60_000);

  it('worker process: the same feature modules register the M2 processors and outbox topics', async () => {
    const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    try {
      const registry = worker.get(ProcessorRegistry);
      // later milestones add their own job names to the same queues (M3: channel / history / data-deletion jobs, attachment downloads)
      expect([...registry.handlers.get('jobs')!.keys()]).toEqual(expect.arrayContaining(['export', 'product-import-commit', 'product-import-preview']));
      expect([...registry.handlers.get('media')!.keys()]).toEqual(expect.arrayContaining(['caption-image', 'reencode-image']));
      expect([...registry.outbox.keys()].sort()).toEqual(['audit', 'job', 'mail', 'notification', 'sheets', 'webhook', 'ws']); // `sheets`: M5 (consumer in M11)
    } finally {
      await worker.close();
    }
  });

  it('GET /stock/movements/export (stock.read, operator allowed); jobs list / cancel / retry and their roles', async () => {
    const owner = await asOwner(app);
    const operator = await asOperator(app, owner.workspaceId);
    const stranger = await asOwner(app);
    const p = await createProduct(owner, { name: 'Miel', sku: 'MIEL', stock: 10 });
    await adjust(owner, { productId: p.id, type: 'out', quantity: 4, reason: 'breakage', note: 'Pot cassé' }).expect(201);

    const jobId = (await operator.get(`/stock/movements/export?productId=${p.id}&type=adjustment_out`).expect(202)).body.data.jobId;
    expect((await operator.get('/products/export').expect(403)).body.error.code).toBe('FORBIDDEN');
    await drain(app, owner.workspaceId);
    const job = await jobOf(operator, jobId); // their own job
    expect(job).toMatchObject({ status: 'done', result: { kind: 'movements', rows: 1 } });
    const sheet = readXlsx((await download(job.resultUrl).expect(200)).body);
    expect(sheet[0]).toEqual(['Date', 'Produit', 'SKU', 'Variante', 'Type', 'Quantité', 'Avant', 'Après', 'Motif', 'Note', 'Référence', 'Par']);
    expect(Number(sheet[1]![0])).toBeGreaterThan(46000); // UX-058: a real date cell (Excel serial), not ISO text
    expect(sheet[1]!.slice(1)).toEqual(['Miel', 'MIEL', '', 'AJUST. −', '-4', '10', '6', 'Casse', 'Pot cassé', '', 'Test User']); // UX-058: screen labels

    // list: Admin+ (reports.read); filters kind / status; other workspaces never listed
    expect((await operator.get('/jobs').expect(403)).body.error.code).toBe('FORBIDDEN');
    const list = await owner.get('/jobs?kind=export&status=done').expect(200);
    expect(list.body.data.map((j: any) => j.id)).toEqual([jobId]);
    expect(list.body.meta).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect((await owner.get('/jobs?kind=import').expect(200)).body.data).toEqual([]);
    expect((await owner.get('/jobs?kind=nope').expect(422)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await stranger.get('/jobs').expect(200)).body.data).toEqual([]);
    await stranger.get(`/jobs/${jobId}`).expect(404);
    await stranger.post(`/jobs/${jobId}/cancel`).expect(404);

    // cancel: queued | running only; a cancelled job is skipped by the worker
    expect((await owner.post(`/jobs/${jobId}/cancel`).expect(409)).body.error.code).toBe('JOB_NOT_CANCELLABLE');
    expect((await owner.post(`/jobs/${jobId}/retry`).expect(409)).body.error.code).toBe('JOB_NOT_CANCELLABLE');
    const pending = (await owner.get('/stock/movements/export').expect(202)).body.data.jobId;
    expect((await owner.post(`/jobs/${pending}/cancel`).expect(200)).body.data.status).toBe('cancelled');
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, pending)).toMatchObject({ status: 'cancelled', resultUrl: null, result: null });

    // retry: a failed job is re-run as a new job with the same payload
    await rawPrisma.job.update({ where: { id: pending }, data: { status: 'failed', error: JSON.stringify({ code: 'REPORT_EXPORT_FAILED' }) } });
    expect((await jobOf(owner, pending)).error).toMatchObject({ code: 'REPORT_EXPORT_FAILED', message: expect.any(String) });
    const retried = (await owner.post(`/jobs/${pending}/retry`).expect(202)).body.data.jobId;
    expect(retried).not.toBe(pending);
    await drain(app, owner.workspaceId);
    expect(await jobOf(owner, retried)).toMatchObject({ status: 'done', kind: 'export', result: { kind: 'movements', rows: 2 } });
    // an expired export no longer hands out a link
    await rawPrisma.job.update({ where: { id: retried }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await jobOf(owner, retried)).resultUrl).toBeNull();
  });
});
