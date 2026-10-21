// M8 — Reports (GDS-10, D62, AT-RPT-01, AT-ORD-11 / AT-INV-02 on the report side): hub (23 reports, 5 groups, simple mode
// 9, favourites), report template data / filters / sort / range, CSV immediate ≤ 5 000 else job, XLSX always job, PDF,
// export jobs list / cancel / retry, monthly schedules (plan feature, e-mail with attachments), roles, tenancy; and the
// exports closed from earlier carry-overs (orders PDF, /delivery, /purchases, /sales).
import { REPORT_KEYS } from '@djaber/shared';
import { rawPrisma } from '@djaber/db';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { mailsTo } from '../support/m1';
import { jobOf } from '../support/m2';
import { work } from '../support/m3';
import { advancedShop, idem, product, purchase, receive, sale, supplier } from '../support/m7';
import { QueueService, jobId } from '../../src/core/queue/queue.service';
import { TenantResolver } from '../../src/core/tenancy/tenant.resolver';
import { ReportScheduleService, previousMonth } from '../../src/modules/gds/reports/report-schedule.service';
import { at, client, daysAgo, db, order, todayAlgiers } from '../support/m8';
import { addDays } from '../../src/modules/analytics/range';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const get = async (actor: { get: (u: string) => any }, url: string, code = 200) => (await actor.get(url).expect(code)).body;

describe('reports hub (ANA-03)', () => {
  it('23 reports in 5 groups; simple mode lists 9; favourites through PATCH /me/prefs; canSchedule follows the plan feature', async () => {
    const owner = await asOwner(app);
    const hub = (await get(owner, '/reports')).data;
    expect(hub.groups.map((g: any) => g.key)).toEqual(['sales', 'orders', 'stock', 'purchases_cash', 'clients']);
    expect(hub.groups.flatMap((g: any) => g.reports)).toHaveLength(23);
    expect(hub).toMatchObject({ stockMode: 'simple', visibleCount: 9, canSchedule: true, csvImmediateMaxRows: 5000 });
    expect(hub.groups.flatMap((g: any) => g.reports).filter((r: any) => r.visible).map((r: any) => r.key)).toEqual(['sales_by_period', 'sales_by_product', 'sales_by_category', 'top_products', 'discounts', 'return_ratio', 'stock_alerts', 'top_customers', 'inactive_customers']);
    await owner.patch('/me/prefs', { reportFavorites: ['cash_register', 'top_products'] }).expect(200);
    const fav = (await get(owner, '/reports')).data;
    expect(fav.favorites).toEqual(['cash_register', 'top_products']);
    expect(fav.groups.flatMap((g: any) => g.reports).find((r: any) => r.key === 'top_products').favorite).toBe(true);
    const adv = await advancedShop(app);
    expect((await get(adv, '/reports')).data).toMatchObject({ stockMode: 'advanced', visibleCount: 23 });
    const starter = await asOwner(app, 'starter');
    expect((await get(starter, '/reports')).data.canSchedule).toBe(false);
  });

  it('reports are Owner + Admin: an Operator gets 403 on every report route (AT-RPT-01)', async () => {
    const owner = await asOwner(app);
    const admin = await asAdmin(app, owner.workspaceId);
    const op = await asOperator(app, owner.workspaceId);
    await admin.get('/reports').expect(200);
    await admin.get('/reports/top_products').expect(200);
    await op.get('/reports').expect(403);
    await op.get('/reports/schedules').expect(403);
    await op.get('/reports/sales_by_period').expect(403);
    await op.get('/reports/sales_by_period?format=csv').expect(403);
    await op.post('/reports/sales_by_period/schedule', { email: 'a@b.dz', dayOfMonth: 1 }).expect(403);
    await op.delete('/reports/sales_by_period/schedule?email=a@b.dz').expect(403);
    await op.get('/jobs?kind=export').expect(403);
  });
});

describe('report template (ANA-04)', () => {
  it('every one of the 23 reports renders (rows, totals, kpis, definition) on an empty and on a filled workspace', async () => {
    const owner = await advancedShop(app);
    for (const key of REPORT_KEYS) {
      const body = await get(owner, `/reports/${key}?period=30d`);
      expect(body.data).toMatchObject({ key, definition: { key }, totalRows: expect.any(Number), csvMode: 'immediate' });
      expect(Array.isArray(body.data.rows)).toBe(true);
      expect(body.meta).toMatchObject({ page: 1, pageSize: 25, total: body.data.totalRows });
    }
    const p = await product(owner, { name: 'Sac cuir', price: 3000, costPrice: 1200, stock: 4, minStock: 5 });
    await sale(owner, { items: [{ productId: p.id, quantity: 2 }], amountPaid: 6000, discount: 500 });
    for (const key of REPORT_KEYS) await owner.get(`/reports/${key}?period=30d`).expect(200);
    const byProduct = (await get(owner, '/reports/sales_by_product?period=30d')).data;
    expect(byProduct.rows[0]).toMatchObject({ product: 'Sac cuir', quantity: 2, revenue: 6000, cogs: 2400, margin: 3600, marginPct: 60, sharePct: 100, _ref: { type: 'product', id: p.id } });
    expect(byProduct.totals).toMatchObject({ quantity: 2, revenue: 6000, cogs: 2400 });
    expect(byProduct.chart.points[0]).toMatchObject({ x: 'Sac cuir', values: { revenue: 6000 } });
    const alerts = (await get(owner, '/reports/stock_alerts')).data;
    expect(alerts.range).toBeNull();
    expect(alerts.rows[0]).toMatchObject({ product: 'Sac cuir', stock: 2, minStock: 5, state: 'low', reorderQty: 8 });
    const disc = (await get(owner, '/reports/discounts?period=30d')).data;
    expect(disc.kpis.find((k: any) => k.key === 'discount').value).toBe(500);
  });

  it('UX-003 (tester report 2026-10-19): Top clients splits the revenue between delivered orders and counter sales', async () => {
    const owner = await advancedShop(app);
    const c = await client(owner.workspaceId, { name: 'Lina Haddad' });
    await order(owner.workspaceId, { total: 4000, status: 'delivered', orderedAt: at(daysAgo(3)), deliveredAt: at(daysAgo(2)), clientId: c.id });
    const p = await product(owner, { price: 3000, stock: 5 });
    await sale(owner, { clientId: c.id, items: [{ productId: p.id, quantity: 1 }], amountPaid: 3000 });
    const top = (await get(owner, '/reports/top_customers?period=30d')).data;
    expect(top.rows[0]).toMatchObject({ client: 'Lina Haddad', orders: 1, sales: 1, ordersRevenue: 4000, salesRevenue: 3000, revenue: 7000, _ref: { type: 'client', id: c.id } });
    expect(top.totals).toMatchObject({ ordersRevenue: 4000, salesRevenue: 3000, revenue: 7000 });
  });

  it('AT-ORD-11 on the P&L report: purchases paid 800 are listed, COGS 600 is subtracted, never both', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 2000, costPrice: 300, stock: 0 });
    const s = await supplier(owner);
    const pu = await purchase(owner, { supplierId: s.id, status: 'pending', items: [{ productId: p.id, quantity: 4, unitCost: 200 }], amountPaid: 800 });
    await receive(owner, pu.id, { items: [{ id: pu.items[0].id, receivedQty: 4 }] }).expect(200);
    await db.product.update({ where: { id: p.id }, data: { costPrice: 300 } });
    await sale(owner, { items: [{ productId: p.id, quantity: 2 }], amountPaid: 4000 });
    const pl = (await get(owner, '/reports/profit_loss?period=30d')).data;
    const line = (k: string) => pl.rows.find((r: any) => r.line === k).amount;
    expect(line('revenue')).toBe(4000);
    expect(line('cogs')).toBe(600);
    expect(line('purchasesPaid')).toBe(800);
    expect(line('net')).toBe(3400);
    expect(pl.rows.map((r: any) => r.line)).toEqual(['salesRevenue', 'ordersRevenue', 'revenue', 'cogs', 'grossMargin', 'manualExpenses', 'productExpenses', 'returnCosts', 'expenses', 'net', 'purchasesPaid']);
  });

  it('AT-INV-02 (report side): "Écarts d’inventaire" lists the inventory movement with its #INV reference', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { name: 'Tunique', stock: 21 });
    const inv = (await owner.post('/inventories', { scope: 'all' }).expect(201)).body.data;
    await owner.put(`/inventories/${inv.id}/lines`, { lines: [{ productId: p.id, countedQty: 18, note: 'casse' }] }).expect(200);
    await owner.post(`/inventories/${inv.id}/validate`, { note: 'inventaire mensuel' }).set(idem()).expect(200);
    const r = (await get(owner, '/reports/inventory_variances?period=7d')).data;
    expect(r.rows[0]).toMatchObject({ product: 'Tunique', type: 'inventory', reason: 'inventory', quantity: -3, before: 21, after: 18, reference: `#${inv.number}` });
    expect(r.kpis.find((k: any) => k.key === 'unitsOut').value).toBe(3);
  });

  it('filters, sort, pagination, comparison; unsupported filter ⇒ 422; bad sort ⇒ 400; unknown report ⇒ 404; range errors', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    for (const [n, days] of [
      ['Alpha', 200],
      ['Beta', 100],
      ['Gamma', 10],
    ] as const)
      await client(ws, { name: n, orderCount: 1, totalSpent: 1000, lastOrderAt: new Date(Date.now() - days * 86_400_000) });
    const inactive = (await get(owner, '/reports/inactive_customers')).data;
    expect(inactive.filters).toEqual({ days: 90 });
    expect(inactive.rows.map((r: any) => r.client)).toEqual(['Alpha', 'Beta']);
    expect((await get(owner, '/reports/inactive_customers?days=150')).data.rows.map((r: any) => r.client)).toEqual(['Alpha']);
    expect((await get(owner, '/reports/inactive_customers?sort=client&q=a')).data.rows.map((r: any) => r.client)).toEqual(['Alpha', 'Beta']);
    expect((await get(owner, '/reports/inactive_customers?sort=-client')).data.rows.map((r: any) => r.client)).toEqual(['Beta', 'Alpha']);
    const err = (await get(owner, '/reports/inactive_customers?supplierId=00000000-0000-0000-0000-000000000000', 422)).error;
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', fields: { supplierId: 'validation.invalid' } });
    expect((await get(owner, '/reports/inactive_customers?sort=phone', 400)).error.code).toBe('BAD_REQUEST');
    expect((await get(owner, '/reports/nope', 404)).error.code).toBe('NOT_FOUND');
    const to = todayAlgiers();
    expect((await get(owner, `/reports/sales_by_period?from=${addDays(to, -732)}&to=${to}`, 422)).error.code).toBe('REPORT_RANGE_TOO_LONG');
    expect((await get(owner, '/reports/sales_by_period?period=custom', 422)).error.code).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    const page = await get(owner, `/reports/sales_by_period?from=${addDays(to, -59)}&to=${to}&pageSize=25&page=3`);
    expect(page.data.rows).toHaveLength(10);
    expect(page.meta).toMatchObject({ page: 3, total: 60 });
    expect(page.data.range).toMatchObject({ days: 60, previous: { to: addDays(to, -60) } });
    await order(ws, { total: 1500, status: 'delivered', orderedAt: at(daysAgo(40)), deliveredAt: at(daysAgo(40)) });
    const cmp = (await get(owner, '/reports/sales_by_period?period=30d')).data.kpis.find((k: any) => k.key === 'revenue');
    expect(cmp).toMatchObject({ value: 0, previous: 1500, deltaPct: -100, figure: 'revenue' });
    // tenancy: another workspace sees none of these clients
    const other = await asOwner(app);
    expect((await get(other, '/reports/inactive_customers')).data.totalRows).toBe(0);
  });
});

describe('exports (D62, AT-RPT-01)', () => {
  it('CSV ≤ 5 000 rows ⇒ immediate file; PDF ⇒ immediate (page + totals); XLSX ⇒ job kind export with its label, listed in "Exports récents", expires at 7 d; cancel / retry rules', async () => {
    const owner = await asOwner(app);
    const csv = (await get(owner, '/reports/sales_by_period?period=7d&format=csv')).data;
    expect(csv).toMatchObject({ format: 'csv', rows: 7, fileName: expect.stringMatching(/^sales-by-period-.*\.csv$/) });
    expect(csv.url).toContain('/files/private/');
    const pdf = (await get(owner, '/reports/sales_by_period?period=7d&format=pdf')).data;
    expect(pdf).toMatchObject({ format: 'pdf', rows: 7 });
    const xlsx = await owner.get('/reports/sales_by_period?period=7d&format=xlsx').expect(202);
    const id = xlsx.body.data.jobId;
    const queued = await jobOf(owner, id);
    expect(queued).toMatchObject({ kind: 'export', status: 'queued', result: { kind: 'report', reportKey: 'sales_by_period', format: 'xlsx', from: addDays(todayAlgiers(), -6), to: todayAlgiers() } });
    await work(app, [owner.workspaceId]);
    const done = await jobOf(owner, id);
    expect(done).toMatchObject({ status: 'done', result: { reportKey: 'sales_by_period', rows: 7, format: 'xlsx' } });
    expect(done.resultUrl).toBeTruthy();
    expect(new Date(done.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const list = await get(owner, '/jobs?kind=export');
    expect(list.data.map((j: any) => j.id)).toContain(id);
    expect((await owner.post(`/jobs/${id}/cancel`).expect(409)).body.error.code).toBe('JOB_NOT_CANCELLABLE');
    // a queued export can be cancelled; a failed one is retried as a new job with the same label
    const second = (await owner.get('/reports/top_products?period=7d&format=xlsx').expect(202)).body.data.jobId;
    expect((await owner.post(`/jobs/${second}/cancel`).expect(200)).body.data.status).toBe('cancelled');
    const third = (await owner.get('/reports/top_products?period=7d&format=xlsx').expect(202)).body.data.jobId;
    await rawPrisma.job.update({ where: { id: third }, data: { status: 'failed', error: JSON.stringify({ code: 'REPORT_EXPORT_FAILED' }) } });
    expect((await jobOf(owner, third)).error.code).toBe('REPORT_EXPORT_FAILED');
    const retried = (await owner.post(`/jobs/${third}/retry`).expect(202)).body.data.jobId;
    expect((await jobOf(owner, retried)).result).toMatchObject({ kind: 'report', reportKey: 'top_products' });
  });

  it('5 001 rows ⇒ CSV becomes a job (large export); the job file holds every row', async () => {
    const owner = await asOwner(app);
    const ws = owner.workspaceId;
    const user = owner.userId;
    await rawPrisma.$executeRaw`
      INSERT INTO "PaymentEntry" ("workspaceId", "sourceType", "sourceId", "amount", "method", "paidAt", "createdById")
      SELECT ${ws}::uuid, 'order', uuid_generate_v7(), 100, 'cash', now() - (g || ' minutes')::interval, ${user}::uuid FROM generate_series(1, 5001) g`;
    const data = (await get(owner, '/reports/payments?period=7d')).data;
    expect(data).toMatchObject({ totalRows: 5001, csvMode: 'job' });
    const r = await owner.get('/reports/payments?period=7d&format=csv').expect(202);
    await work(app, [ws]);
    const job = await jobOf(owner, r.body.data.jobId);
    expect(job).toMatchObject({ status: 'done', result: { reportKey: 'payments', rows: 5001, format: 'csv' } });
  });

  it('carry-over exports: orders PDF, /delivery CSV, /purchases and /sales (202 + job), roles', async () => {
    const owner = await advancedShop(app);
    await order(owner.workspaceId, { total: 2500, orderedAt: new Date() });
    const o = await owner.get('/orders/export?format=pdf').expect(202);
    const d = await owner.get('/delivery/export?format=csv').expect(202);
    const pu = await owner.get('/purchases/export?format=xlsx').expect(202);
    const sa = await owner.get('/sales/export').expect(202);
    await work(app, [owner.workspaceId]);
    expect(await jobOf(owner, o.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'orders', format: 'pdf', rows: 1 } });
    expect(await jobOf(owner, d.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'shipments', format: 'csv' } });
    expect(await jobOf(owner, pu.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'purchases', format: 'xlsx' } });
    expect(await jobOf(owner, sa.body.data.jobId)).toMatchObject({ status: 'done', result: { kind: 'sales', format: 'csv' } });
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/purchases/export').expect(403);
    await op.get('/sales/export').expect(403);
    await op.get('/delivery/export').expect(202);
    expect((await get(owner, '/delivery/export?foo=1', 422)).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('monthly schedules (D62 / D69, plan feature scheduled_reports)', () => {
  it('POST creates (201) then updates the same e-mail (200, idempotent row); list; DELETE 204 then 404; without the feature ⇒ 403 PLAN_FEATURE_REQUIRED', async () => {
    const owner = await asOwner(app);
    const created = await owner.post('/reports/cash_register/schedule', { email: 'Compta@Boutique.dz', dayOfMonth: 5 }).expect(201);
    expect(created.body.data).toMatchObject({ reportKey: 'cash_register', email: 'compta@boutique.dz', dayOfMonth: 5, createdBy: { id: owner.userId } });
    expect(created.body.data.nextRunOn).toMatch(/-05$/);
    const again = await owner.post('/reports/cash_register/schedule', { email: 'compta@boutique.dz', dayOfMonth: 12 }).expect(200);
    expect(again.body.data).toMatchObject({ id: created.body.data.id, dayOfMonth: 12 });
    expect(await db.reportSchedule.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect((await get(owner, '/reports/schedules')).data).toHaveLength(1);
    expect((await get(owner, '/reports/cash_register')).data.schedules).toHaveLength(1);
    expect((await get(owner, '/reports')).data.groups.flatMap((g: any) => g.reports).find((r: any) => r.key === 'cash_register').scheduled).toBe(true);
    const bad = await owner.post('/reports/cash_register/schedule', { email: 'nope', dayOfMonth: 31 }).expect(422);
    expect(bad.body.error.fields).toMatchObject({ email: expect.any(String), dayOfMonth: 'validation.range' });
    await owner.post('/reports/unknown/schedule', { email: 'a@b.dz', dayOfMonth: 1 }).expect(404);
    const other = await asOwner(app);
    expect((await get(other, '/reports/schedules')).data).toHaveLength(0);
    await other.delete('/reports/cash_register/schedule?email=compta@boutique.dz').expect(404);
    await owner.delete('/reports/cash_register/schedule').send({ email: 'compta@boutique.dz' }).expect(204);
    await owner.delete('/reports/cash_register/schedule?email=compta@boutique.dz').expect(404);
    const starter = await asOwner(app, 'starter');
    const refused = await starter.post('/reports/cash_register/schedule', { email: 'a@b.dz', dayOfMonth: 1 }).expect(403);
    expect(refused.body.error).toMatchObject({ code: 'PLAN_FEATURE_REQUIRED', params: { feature: 'scheduled_reports' } });
  });

  it('sched-report-schedules enqueues the schedules of the day; the job e-mails last month (PDF + XLSX attached); without the feature nothing is sent', async () => {
    const owner = await asOwner(app);
    const today = todayAlgiers();
    const day = Math.min(28, Number(today.slice(8)));
    const s = (await owner.post('/reports/sales_by_period/schedule', { email: `rapports-${Date.now()}@boutique.dz`, dayOfMonth: day }).expect(201)).body.data;
    const svc = app.app.get(ReportScheduleService);
    const now = new Date(at(`${today.slice(0, 8)}${String(day).padStart(2, '0')}`, 8));
    const due = await svc.scheduleDue(now);
    const { month, from, to } = previousMonth(`${today.slice(0, 8)}${String(day).padStart(2, '0')}`);
    expect(due.month).toBe(month);
    const queued = await app.app.get(QueueService).queue('jobs').getJob(jobId(`report-schedule:${s.id}:${month}`));
    expect(queued?.name).toBe('report-schedule-send');
    await queued?.remove().catch(() => undefined);
    expect(await svc.send(s.id, month)).toMatchObject({ sent: true, attach: true });
    const mails = await mailsTo(app, s.email, 'reports/scheduled');
    expect(mails).toHaveLength(1);
    const mail = mails[0] as any;
    expect(mail.subject).toContain('Ventes par période');
    expect(mail.attachments.map((a: any) => a.fileName)).toEqual([`sales-by-period-${from}_${to}.pdf`, `sales-by-period-${from}_${to}.xlsx`]);
    expect(mail.params.url).toContain(`/reports/sales_by_period?from=${from}&to=${to}`);
    // a rerun of the same month sends nothing new (outbox key)
    await svc.send(s.id, month);
    expect(await mailsTo(app, s.email, 'reports/scheduled')).toHaveLength(1);
    // plan downgraded ⇒ skipped silently, the schedule is kept
    const starter = await rawPrisma.plan.findUniqueOrThrow({ where: { slug: 'starter' } });
    await rawPrisma.subscription.updateMany({ where: { workspaceId: owner.workspaceId }, data: { planId: starter.id } });
    await app.app.get(TenantResolver).invalidate(owner.workspaceId);
    expect(await svc.send(s.id, '2020-01')).toMatchObject({ sent: false, reason: 'feature' });
    expect(await db.reportSchedule.count({ where: { id: s.id } })).toBe(1);
  });
});
