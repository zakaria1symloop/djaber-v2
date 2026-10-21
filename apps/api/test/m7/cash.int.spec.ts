// M7 — cash register (GDS-08, CSH-01…04, 04 §20 D56): manual rows, locks of automatic rows, 24 h window, day closing with
// correction row, reopen (Admin+, audited), period selection ↔ table ↔ KPIs in sync (09 §4 regression), export; proof
// photos readable from the ledger and Reports › Caisse (tester report 2026-10-19 UX-001).
import request from 'supertest';
import sharp from 'sharp';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../src/core/time/algiers';
import { asAdmin, asOperator, asOwner } from '../support/actors';
import { createTestApp, type TestApp } from '../support/app';
import { eventually } from '../support/m1';
import { drain, jobOf } from '../support/m2';
import { cashOf, newOrder, status } from '../support/m5';
import { advancedShop, DAY, db, idem, product, sale } from '../support/m7';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const yesterday = () => algiersDay(new Date(Date.now() - DAY));
const at = (day: string, hour: number) => new Date(algiersDayStart(day).getTime() + hour * 3_600_000).toISOString();
const SIGNED = /\/api\/v1\/files\/.+\?exp=\d+&sig=/;
const entry = (over: Record<string, unknown> = {}) => ({ type: 'income', amount: 1000, category: 'deposit', method: 'cash', description: 'Apport ouverture', ...over });

describe('manual rows (CSH-03)', () => {
  it('create / edit / delete a manual row; automatic categories refused; AT-CSH-02 25 h ⇒ CASH_ENTRY_EDIT_WINDOW_EXPIRED; auto row ⇒ CAISSE_EDIT_AUTOMATIC / CAISSE_DELETE_AUTOMATIC; correction linked to the auto row', async () => {
    const owner = await advancedShop(app);
    expect((await owner.post('/cash', entry()).expect(400)).body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    const row = await owner.post('/cash', entry()).set(idem()).expect(201);
    expect(row.body.data).toMatchObject({ type: 'income', amount: 1000, category: 'deposit', isAutomatic: false, locked: false, lockReason: null, balanceAfter: 1000, createdBy: { id: owner.userId } });
    expect(row.body.data.actions.map((a: any) => a.key)).toEqual(['edit', 'delete', 'duplicate']);
    expect((await owner.post('/cash', entry({ category: 'sale' })).set(idem()).expect(422)).body.error.fields).toEqual({ category: 'validation.invalid' });
    expect((await owner.post('/cash', entry({ amount: 0 })).set(idem()).expect(422)).body.error.fields).toEqual({ amount: 'validation.price' });
    const edited = await owner.patch(`/cash/${row.body.data.id}`, { amount: 1500, description: 'Apport' }).expect(200);
    expect(edited.body.data).toMatchObject({ amount: 1500, description: 'Apport' });
    await db.cashTransaction.update({ where: { id: row.body.data.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await owner.patch(`/cash/${row.body.data.id}`, { amount: 10 }).expect(422)).body.error.code).toBe('CASH_ENTRY_EDIT_WINDOW_EXPIRED');
    expect((await owner.delete(`/cash/${row.body.data.id}`).expect(422)).body.error.code).toBe('CASH_ENTRY_EDIT_WINDOW_EXPIRED');

    const p = await product(owner, { price: 3000, stock: 5 });
    const s = await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 3000 });
    const auto = (await owner.get('/cash?source=auto').expect(200)).body.data[0];
    expect(auto).toMatchObject({ isAutomatic: true, locked: true, lockReason: 'CAISSE_EDIT_AUTOMATIC', category: 'sale', reference: { type: 'sale', id: s.id, label: s.number } });
    expect(auto.actions.map((a: any) => [a.key, a.reasonCode ?? null])).toEqual([
      ['open_reference', null],
      ['edit', 'CAISSE_EDIT_AUTOMATIC'],
      ['delete', 'CAISSE_DELETE_AUTOMATIC'],
      ['correct', null],
    ]);
    expect((await owner.patch(`/cash/${auto.id}`, { amount: 1 }).expect(403)).body.error.code).toBe('CAISSE_EDIT_AUTOMATIC');
    expect((await owner.delete(`/cash/${auto.id}`).expect(403)).body.error.code).toBe('CAISSE_DELETE_AUTOMATIC');
    const corr = await owner.post('/cash', entry({ type: 'expense', amount: 100, category: 'correction', correctsTransactionId: auto.id, description: 'Erreur de rendu' })).set(idem()).expect(201);
    // the correction opens the document of the row it corrects (tester report 2026-10-20: no « Ouvrir la référence »)
    expect(corr.body.data).toMatchObject({ category: 'correction', correctsTransactionId: auto.id, reference: { type: 'sale', id: s.id, label: s.number } });
    expect(corr.body.data.actions.map((a: any) => a.key)).toEqual(['open_reference', 'edit', 'delete', 'duplicate']);
    // a correction only points at an automatic row
    expect((await owner.post('/cash', entry({ category: 'correction', correctsTransactionId: corr.body.data.id })).set(idem()).expect(422)).body.error.fields).toEqual({ correctsTransactionId: 'validation.invalid' });
    const fresh = await owner.post('/cash', entry({ type: 'expense', amount: 200, category: 'utilities' })).set(idem()).expect(201);
    await owner.delete(`/cash/${fresh.body.data.id}`).expect(204);
    await owner.get(`/cash/${fresh.body.data.id}`).expect(404);
  });
});

describe('day closing (CSH-01/02, 04 §20)', () => {
  it('AT-CSH-01 close: theoretical 76 350 vs counted 76 000 ⇒ correction −350 (auto, locked), note required, day locked; auto row of an order delivered with effective date that day ⇒ dated today; reopen: operator 403, admin with reason ⇒ reversal + audit', async () => {
    const owner = await advancedShop(app, { fees: true });
    const day = yesterday();
    // the day's cash: 52 000 deposit (cash), 24 350 cash income, 5 000 card income (not in the theoretical cash)
    await db.cashTransaction.createMany({
      data: [
        { workspaceId: owner.workspaceId, type: 'income', amount: 52000, category: 'deposit', method: 'cash', date: new Date(at(day, 8)), createdById: owner.userId },
        { workspaceId: owner.workspaceId, type: 'income', amount: 24350, category: 'other', method: 'cash', date: new Date(at(day, 10)), createdById: owner.userId },
        { workspaceId: owner.workspaceId, type: 'income', amount: 5000, category: 'other', method: 'card', date: new Date(at(day, 11)), createdById: owner.userId },
      ],
    });
    const before = (await owner.get(`/cash/stats?day=${day}`).expect(200)).body.data;
    expect(before.day).toEqual({ day, closed: false, theoreticalCash: 76350 });
    expect(before.unclosedDays).toEqual([day]);
    const noNote = await owner.post('/cash/close', { day, countedBalance: 76000 }).set(idem()).expect(422);
    expect(noNote.body.error.fields).toEqual({ note: 'validation.required' });
    const closed = await owner.post('/cash/close', { day, countedBalance: 76000, note: 'Monnaie rendue en trop' }).set(idem()).expect(200);
    expect(closed.body.data).toMatchObject({ day, closed: true, closing: { theoreticalBalance: 76350, countedBalance: 76000, difference: -350, note: 'Monnaie rendue en trop', closedBy: { id: owner.userId } } });
    expect(closed.body.data.actions).toEqual([{ key: 'reopen', enabled: true, primary: true }]);
    const correction = await db.cashTransaction.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, sourceType: 'closing' } });
    expect(correction).toMatchObject({ type: 'expense', amount: 350, category: 'correction', isAutomatic: true, method: 'cash' });
    expect(algiersDay(correction.date)).toBe(day);
    expect((await owner.post('/cash/close', { day, countedBalance: 76000, note: 'x' }).set(idem()).expect(409)).body.error).toMatchObject({ code: 'CASH_DAY_CLOSED', params: { date: day } });
    expect((await owner.get(`/cash/stats`).expect(200)).body.data.unclosedDays).toEqual([]);
    // the day is locked for manual rows
    const late = await owner.post('/cash', entry({ date: at(day, 15) })).set(idem()).expect(409);
    expect(late.body.error).toMatchObject({ code: 'CASH_DAY_CLOSED', params: { date: day } });
    const rows = (await owner.get(`/cash?day=${day}`).expect(200)).body.data;
    expect(rows.every((r: any) => r.locked)).toBe(true);
    expect(rows.find((r: any) => !r.isAutomatic).lockReason).toBe('CASH_DAY_CLOSED');
    // an order delivered with an effective date on the closed day: its COD row is dated today (the cash moved today)
    const { order } = await newOrder(owner);
    await status(owner, order, 'delivered', { effectiveAt: at(day, 12) }).expect(200);
    const cod = (await cashOf(order.id)).find((r) => r.category === 'order')!;
    expect(algiersDay(cod.date)).toBe(algiersDay());

    const op = await asOperator(app, owner.workspaceId);
    expect((await op.post(`/cash/days/${day}/reopen`, { reason: 'erreur de comptage' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const admin = await asAdmin(app, owner.workspaceId);
    expect((await admin.post(`/cash/days/${day}/reopen`, {}).expect(422)).body.error.fields).toEqual({ reason: 'validation.required' });
    const reopened = await admin.post(`/cash/days/${day}/reopen`, { reason: 'erreur de comptage' }).expect(200);
    expect(reopened.body.data).toMatchObject({ closed: false, closing: { reopenedBy: { id: admin.userId }, reopenedAt: expect.any(String) } });
    const reversal = await db.cashTransaction.findFirstOrThrow({ where: { correctsTransactionId: correction.id } });
    expect(reversal).toMatchObject({ type: 'income', amount: 350, category: 'correction', isAutomatic: true });
    const audit = await eventually(() => db.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'cash.reopen' } }));
    expect(audit).toMatchObject({ actorId: admin.userId, reason: 'erreur de comptage' });
    // open again: a manual row is accepted on that day, closing again works (same CashClosing row)
    await owner.post('/cash', entry({ date: at(day, 15), amount: 100 })).set(idem()).expect(201);
    const again = await owner.post('/cash/close', { day, countedBalance: 76450 }).set(idem()).expect(200);
    expect(again.body.data.closing).toMatchObject({ theoreticalBalance: 76450, difference: 0, reopenedAt: null });
    expect(await db.cashClosing.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect((await owner.post('/cash/close', { day: algiersDay(new Date(Date.now() + 2 * DAY)), countedBalance: 0 }).set(idem()).expect(422)).body.error.fields).toEqual({ day: 'validation.date' });
    const days = (await owner.get('/cash/days').expect(200)).body.data;
    expect(days.find((d: any) => d.day === day)).toMatchObject({ closed: true, theoreticalCash: 76450 });
  });

  it('next day theoretical = counted balance of the previous closing + the day cash rows', async () => {
    const owner = await advancedShop(app);
    const d1 = algiersDay(new Date(Date.now() - 2 * DAY));
    const d2 = yesterday();
    await db.cashTransaction.create({ data: { workspaceId: owner.workspaceId, type: 'income', amount: 1000, category: 'deposit', method: 'cash', date: new Date(at(d1, 9)), createdById: owner.userId } });
    await owner.post('/cash/close', { day: d1, countedBalance: 900, note: 'manque 100' }).set(idem()).expect(200);
    await db.cashTransaction.create({ data: { workspaceId: owner.workspaceId, type: 'expense', amount: 300, category: 'rent', method: 'cash', date: new Date(at(d2, 9)), createdById: owner.userId } });
    expect((await owner.get(`/cash/stats?day=${d2}`).expect(200)).body.data.day.theoreticalCash).toBe(600);
  });
});

describe('09 §4 regression: period selection ↔ table ↔ KPIs', () => {
  it('opening = Σ rows before the period, the last running balance = currentBalance, `to` is inclusive (end of day), filters follow', async () => {
    const owner = await advancedShop(app);
    const d0 = algiersDay(new Date(Date.now() - 3 * DAY));
    const d1 = algiersDay(new Date(Date.now() - 2 * DAY));
    const d2 = yesterday();
    const mk = (day: string, hour: number, type: 'income' | 'expense', amount: number, category: string, method = 'cash') =>
      db.cashTransaction.create({ data: { workspaceId: owner.workspaceId, type, amount, category: category as never, method: method as never, date: new Date(at(day, hour)), createdById: owner.userId } });
    await mk(d0, 9, 'income', 10000, 'deposit');
    await mk(d1, 9, 'income', 2000, 'other');
    await mk(d1, 18, 'expense', 500, 'rent');
    await mk(d2, 23.9, 'income', 700, 'other', 'ccp'); // 23:54 local: inside `to` (end of day inclusive)
    const q = `from=${d1}&to=${d2}`;
    const list = (await owner.get(`/cash?${q}&sort=date`).expect(200)).body;
    const stats = (await owner.get(`/cash/stats?${q}`).expect(200)).body.data;
    expect(list.meta).toMatchObject({ openingBalance: 10000, from: d1, to: d2, total: 3 });
    expect(list.data.map((r: any) => r.balanceAfter)).toEqual([12000, 11500, 12200]);
    expect(stats).toMatchObject({ from: d1, to: d2, openingBalance: 10000, income: 2700, expense: 500, net: 2200, currentBalance: 12200 });
    expect(list.data.at(-1).balanceAfter).toBe(stats.currentBalance);
    // a filter narrows the rows and the KPIs together; balances stay those of the whole journal
    const ccp = (await owner.get(`/cash?${q}&method=ccp`).expect(200)).body;
    const ccpStats = (await owner.get(`/cash/stats?${q}&method=ccp`).expect(200)).body.data;
    expect(ccp.data).toHaveLength(1);
    expect(ccpStats).toMatchObject({ income: 700, expense: 0, currentBalance: 12200 });
    // one day (default today when nothing is given)
    const one = (await owner.get(`/cash/stats?day=${d1}`).expect(200)).body.data;
    expect(one).toMatchObject({ from: d1, to: d1, openingBalance: 10000, income: 2000, expense: 500, currentBalance: 11500 });
    expect((await owner.get('/cash').expect(200)).body.meta).toMatchObject({ from: algiersDay(), to: algiersDay(), total: 0 });
    expect(algiersDayEnd(d2).getTime()).toBeGreaterThan(new Date(at(d2, 23.9)).getTime());
    await owner.get('/cash?sort=amount').expect(400);
  });

  it('UX-001: the proof photo of a correction is readable (signed link, any driver), offered as « Voir le justificatif » and in Reports › Caisse with the sale it corrects', async () => {
    const owner = await advancedShop(app);
    const p = await product(owner, { price: 3000, stock: 5 });
    const s = await sale(owner, { items: [{ productId: p.id, quantity: 1 }], amountPaid: 3000 });
    const auto = (await owner.get('/cash?source=auto').expect(200)).body.data[0];
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 120, b: 60 } } }).png().toBuffer();
    const up = await request(app.http()).post('/api/v1/uploads').set(owner.headers).field('kind', 'cash_proof').attach('file', png, { filename: 'recu.png', contentType: 'image/png' }).expect(201);
    const corr = (await owner.post('/cash', entry({ type: 'expense', amount: 100, category: 'correction', correctsTransactionId: auto.id, description: 'Erreur de rendu', proofUploadId: up.body.data.id })).set(idem()).expect(201)).body.data;
    expect(corr.proofUrl).toMatch(SIGNED);
    expect(corr.actions.map((a: any) => a.key)).toEqual(['open_reference', 'view_proof', 'edit', 'delete', 'duplicate']);
    const path = new URL(corr.proofUrl).pathname + new URL(corr.proofUrl).search;
    const img = await request(app.http()).get(path).expect(200);
    expect(img.headers['content-type']).toMatch(/^image\//);
    expect(img.headers['content-disposition']).toBeUndefined();
    const dl = await request(app.http()).get(`${path}&dl=${encodeURIComponent('reçu VNT.webp')}`).expect(200);
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="re_u VNT.webp"; filename*=UTF-8''${encodeURIComponent('reçu VNT.webp')}`);
    const report = (await owner.get(`/reports/cash_register?period=7d`).expect(200)).body.data;
    const rows = report.rows.filter((r: any) => r._ref?.id === s.id);
    expect(rows.map((r: any) => [r.category, r.reference, typeof r.proof])).toEqual([
      ['sale', s.number, 'object'],
      ['correction', s.number, 'string'],
    ]);
    expect(rows[1].proof).toMatch(SIGNED);
    expect(report.definition.columns.at(-1)).toMatchObject({ key: 'proof', type: 'file' });
  });

  it('export job (CSV), roles and tenancy', async () => {
    const owner = await advancedShop(app);
    const row = await owner.post('/cash', entry()).set(idem()).expect(201);
    const job = await owner.get('/cash/export?format=csv').expect(202);
    await drain(app, owner.workspaceId, ['job']);
    const done = await jobOf(owner, job.body.data.jobId);
    expect(done).toMatchObject({ status: 'done', result: { kind: 'cash', rows: 1, format: 'csv' } });
    // the private file: saved as an attachment with `dl`, refused with a tampered or expired signature
    const link = new URL(done.resultUrl);
    const file = await request(app.http()).get(`${link.pathname}${link.search}&dl=caisse.csv`).expect(200);
    expect(file.headers['content-disposition']).toBe(`attachment; filename="caisse.csv"; filename*=UTF-8''caisse.csv`);
    await request(app.http()).get(`${link.pathname}${link.search.replace(/sig=[^&]+/, 'sig=nope')}`).expect(404);
    await request(app.http()).get(`${link.pathname}${link.search.replace(/exp=\d+/, 'exp=1')}`).expect(404);
    const op = await asOperator(app, owner.workspaceId);
    await op.get('/cash').expect(403);
    await op.post('/cash', entry()).set(idem()).expect(403);
    const other = await asOwner(app);
    await other.get(`/cash/${row.body.data.id}`).expect(404);
    await other.patch(`/cash/${row.body.data.id}`, { amount: 1 }).expect(404);
    await other.delete(`/cash/${row.body.data.id}`).expect(404);
  });
});
