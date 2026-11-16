// M11 carry-overs — DLG "Imprimer les bordereaux" options (M6 row: "Un PDF par commande" = ZIP, "Inclure le récapitulatif
// interne" = first page) and the report filters drawn in Figma ANA-04 (M8 row: Source, Canal, Grouper par).
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { StorageService } from '../../src/core/storage/storage.service';
import { asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { jobOf } from '../support/m2';
import { forbidNetwork } from '../support/m3';
import { closeOutbox } from '../support/m4';
import { seedFees } from '../support/m5';
import { addCourier, confirmedOrder, db, drain, sendAndWork } from '../support/m6';
import { advancedShop, product, sale } from '../support/m7';
import { channel, order } from '../support/m8';

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

const fileOfJob = async (jobId: string) => {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const upload = await db.upload.findUniqueOrThrow({ where: { id: job.resultUploadId! } });
  const { body } = await app.app.get(StorageService).get(upload.storageKey);
  return { upload, body };
};

describe('labels job options (M6 row)', () => {
  it('includeRecap ⇒ the internal recap is the first page of the merged PDF', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    await addCourier(owner, 'zrexpress');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await sendAndWork(app, owner, (await confirmedOrder(owner)).order)).orderId);
    const op = await asOperator(app, owner.workspaceId);
    const res = await op.post('/shipments/labels', { orderIds: ids, includeRecap: true }).expect(202);
    await drain(app, owner.workspaceId);
    const job = await jobOf(op, res.body.data.jobId);
    expect(job).toMatchObject({ status: 'done', result: { count: 3, pages: 4, includeRecap: true, onePdfPerOrder: false, files: 1, fileName: 'bordereaux-3.pdf' } });
    const { upload, body } = await fileOfJob(res.body.data.jobId);
    expect(upload.mime).toBe('application/pdf');
    const pdf = await PDFDocument.load(body);
    expect(pdf.getPageCount()).toBe(4);
    // the recap is A4, the labels A6
    expect(Math.round(pdf.getPage(0).getWidth() / (72 / 25.4))).toBe(210);
    expect(Math.round(pdf.getPage(1).getWidth() / (72 / 25.4))).toBe(105);
  });

  it('onePdfPerOrder ⇒ a ZIP of one PDF per order named by the order number (+ recapitulatif.pdf); unsent orders still skipped', async () => {
    const owner = await asOwner(app);
    await seedFees(app, owner.workspaceId);
    await addCourier(owner, 'zrexpress');
    const sent: string[] = [];
    for (let i = 0; i < 2; i++) sent.push((await sendAndWork(app, owner, (await confirmedOrder(owner)).order)).orderId);
    const unsent = (await confirmedOrder(owner)).order.id;
    const res = await owner.post('/shipments/labels', { orderIds: [...sent, unsent], onePdfPerOrder: true, includeRecap: true, format: 'thermal' }).expect(202);
    await drain(app, owner.workspaceId);
    const job = await jobOf(owner, res.body.data.jobId);
    expect(job).toMatchObject({ status: 'partial', resultUrl: expect.any(String), result: { count: 2, pages: 3, onePdfPerOrder: true, includeRecap: true, files: 3, fileName: 'bordereaux-2.zip', format: 'thermal' } });
    expect(job.result.skipped).toEqual([expect.objectContaining({ id: unsent, code: 'SHIPMENT_NOT_CREATED' })]);
    const { upload, body } = await fileOfJob(res.body.data.jobId);
    expect(upload.mime).toBe('application/zip');
    expect(upload.storageKey).toMatch(/\.zip$/);
    const files = unzipSync(new Uint8Array(body));
    const numbers = await Promise.all(sent.map(async (id) => (await db.order.findUniqueOrThrow({ where: { id } })).number.replace(/^#/, '')));
    expect(Object.keys(files).sort()).toEqual(['recapitulatif.pdf', ...numbers.map((n) => `${n}.pdf`)].sort());
    for (const n of numbers) expect((await PDFDocument.load(files[`${n}.pdf`]!)).getPageCount()).toBe(1);
    // without the recap: only the order PDFs
    const plain = await owner.post('/shipments/labels', { orderIds: sent, onePdfPerOrder: true }).expect(202);
    await drain(app, owner.workspaceId);
    expect((await jobOf(owner, plain.body.data.jobId)).result).toMatchObject({ files: 2, pages: 2, includeRecap: false });
    await owner.post('/shipments/labels', { orderIds: sent, onePdfPerOrder: 'yes' }).expect(422);
  });
});

describe('report filters of ANA-04 (M8 row)', () => {
  it('sales by product: source (counter sales / delivered orders / both), channel (orders of one page), group by product', async () => {
    const owner = await advancedShop(app);
    const robe = await product(owner, { name: 'Robe', price: 3000, costPrice: 1000, stock: 20 });
    const sac = await product(owner, { name: 'Sac', price: 2000, costPrice: 500, stock: 20 });
    await sale(owner, { items: [{ productId: robe.id, quantity: 2 }], amountPaid: 6000 });
    const pageA = await channel(owner.workspaceId, owner.userId);
    const pageB = await channel(owner.workspaceId, owner.userId);
    const now = new Date();
    await order(owner.workspaceId, { total: 2000, status: 'delivered', orderedAt: now, deliveredAt: now, channelId: pageA.id, productId: sac.id, productName: 'Sac', quantity: 1 });
    await order(owner.workspaceId, { total: 6000, status: 'delivered', orderedAt: now, deliveredAt: now, channelId: pageB.id, productId: robe.id, productName: 'Robe', quantity: 2 });
    const rows = async (q: string) => ((await owner.get(`/reports/sales_by_product?period=30d${q}`).expect(200)).body.data.rows as any[]).map((r) => [r.product, r.quantity, r.grossSales]).sort();
    expect(await rows('')).toEqual([['Robe', 4, 12000], ['Sac', 1, 2000]]);
    expect(await rows('&source=sales')).toEqual([['Robe', 2, 6000]]);
    expect(await rows('&source=orders')).toEqual([['Robe', 2, 6000], ['Sac', 1, 2000]]);
    expect(await rows(`&channelId=${pageA.id}`)).toEqual([['Sac', 1, 2000]]);
    expect(await rows(`&channelId=${pageA.id}&source=sales`)).toEqual([]);
    expect((await owner.get(`/reports/sales_by_product?period=30d&channelId=${pageB.id}`).expect(200)).body.data.filters).toEqual({ channelId: pageB.id });
    // the definitions offer them where the data supports them, and refuse them elsewhere
    const def = (await owner.get('/reports/sales_by_product?period=30d').expect(200)).body.data.definition;
    expect(def.filters).toEqual(['categoryId', 'productId', 'source', 'channelId', 'groupBy', 'q']);
    expect((await owner.get('/reports/top_products?period=30d&source=orders').expect(200)).body.data.rows.map((r: any) => [r.product, r.quantity])).toEqual([['Robe', 2], ['Sac', 1]]);
    expect((await owner.get('/reports/sales_by_category?period=30d&source=sales').expect(200)).body.data.kpis.find((k: any) => k.key === 'grossSales').value).toBe(6000);
    expect((await owner.get('/reports/sales_by_period?period=30d&source=sales').expect(422)).body.error.fields).toEqual({ source: 'validation.invalid' });
    await owner.get('/reports/sales_by_product?period=30d&source=pos').expect(422);
    await owner.get('/reports/sales_by_product?period=30d&groupBy=week').expect(422);
    await owner.get('/reports/sales_by_product?period=30d&channelId=x').expect(422);
    // a page of another workspace selects nothing
    const other = await asOwner(app);
    const foreign = await channel(other.workspaceId, other.userId);
    expect(await rows(`&channelId=${foreign.id}`)).toEqual([]);
  });

  it('groupBy=product merges the variants of a product into one row', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { name: 'Robe kabyle', price: 4000, costPrice: 1000, variants: [{ name: 'M', price: 4000, stock: 5 }, { name: 'L', price: 4000, stock: 5 }] });
    const full = await db.product.findUniqueOrThrow({ where: { id: p.id }, include: { variants: { orderBy: { name: 'asc' } } } });
    const [l, m] = full.variants;
    await sale(owner, { items: [{ productId: p.id, variantId: m!.id, quantity: 1 }, { productId: p.id, variantId: l!.id, quantity: 2 }], amountPaid: 12000 });
    const byVariant = (await owner.get('/reports/sales_by_product?period=30d').expect(200)).body.data;
    expect(byVariant.rows.map((r: any) => [r.variant, r.quantity]).sort()).toEqual([['L', 2], ['M', 1]]);
    const byProduct = (await owner.get('/reports/sales_by_product?period=30d&groupBy=product').expect(200)).body.data;
    // full-test 15/11 ANALYTICS-01…03 (assumptions-log 2026-11-16): the product reports show `grossSales` (before discounts)
    expect(byProduct.rows).toEqual([expect.objectContaining({ product: 'Robe kabyle', variant: null, quantity: 3, grossSales: 12000, sharePct: 100, _ref: { type: 'product', id: p.id } })]);
    expect(byProduct.totals).toMatchObject({ quantity: 3, grossSales: 12000 });
  });
});
