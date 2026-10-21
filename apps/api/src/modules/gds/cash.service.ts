// GDS-08 / CSH-01…04 / 04 §20 (D56) — cash register: one journal of income / expense rows (`CashTransaction`).
// Automatic rows (written only by OrderEffects / SaleEffects / PurchaseEffects and by the day closing) are locked
// (403 CAISSE_EDIT_AUTOMATIC / CAISSE_DELETE_AUTOMATIC); manual rows are editable ≤ 24 h while their day is open.
// The list, its running balances and the KPIs read the same filters and the same period (09 §4 regression: period
// pills ↔ table in sync, `to` = end of day). Day closing: theoretical cash vs counted, correction row, day locked;
// reopen (Admin+, audited) reverses the correction with a new correction row.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CASH_EDIT_WINDOW_HOURS, type CashDaysQuery, type CashDayView, type CashQuery, type CashStatsQuery, type CashStatsView, type CashTransactionView, type CloseCashInput, type CreateCashEntryInput, type ReopenCashInput, type UpdateCashEntryInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type CashClosing, type CashTransaction, type Tx } from '@djaber/db';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { OutboxService } from '../../core/outbox/outbox.service';
import { StorageService } from '../../core/storage/storage.service';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { action } from '../catalog/catalog.util';
import { ExportService } from '../jobs/export.service';
import { emitCash } from './cash-rows';
import { checkBusinessDate, lockRow, rangeOf, USER_SELECT, userRef } from './gds.util';

const HOUR_MS = 3_600_000;
const FEE_CATEGORIES = ['rent', 'salary', 'utilities', 'marketing', 'shipping', 'other'] as const;
const CASH_INCLUDE = { createdBy: { select: USER_SELECT }, proof: { select: { storageKey: true, url: true } } } satisfies Prisma.CashTransactionInclude;
type CashRow = Prisma.CashTransactionGetPayload<{ include: typeof CASH_INCLUDE }>;
const signed = (r: Pick<CashTransaction, 'type' | 'amount'>) => (r.type === 'income' ? r.amount : -r.amount);
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOfDate = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class CashService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
    private readonly exports: ExportService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('cash', (filters, ctx) => this.exportTable(filters as CashStatsQuery, ctx.locale));
  }

  // --- periods & balances -------------------------------------------------------------------------------------------------
  /** The selection of a cash query: one day (default today) or a period / custom range, as `[gte, lt)` + local days. */
  private selection(q: { day?: string; period?: string; from?: string; to?: string }) {
    if (q.period || q.from || q.to) {
      const r = rangeOf(q);
      return { gte: r.gte, lt: r.lt, from: r.gte ? algiersDay(r.gte) : null, to: r.lt ? algiersDay(new Date(r.lt.getTime() - 1)) : algiersDay() };
    }
    const day = q.day ?? algiersDay();
    return { gte: algiersDayStart(day), lt: algiersDayEnd(day), from: day, to: day };
  }

  /** Σ signed amounts of every row dated before `at` (CSH-01 "opening balance = sum of every row before"). */
  private async balanceBefore(at: Date | null, o: { cashOnly?: boolean } = {}): Promise<number> {
    if (!at) return 0;
    const ws = TenantContext.workspaceId();
    const method = o.cashOnly ? Prisma.sql`AND "method" = 'cash'` : Prisma.empty;
    const [r] = await prisma.$queryRaw<{ s: number }[]>`
      SELECT COALESCE(sum(CASE WHEN "type" = 'income' THEN "amount" ELSE -"amount" END), 0)::float8 AS s
      FROM "CashTransaction" WHERE "workspaceId" = ${ws}::uuid AND "date" < ${at} ${method}`;
    return Math.round(r?.s ?? 0);
  }

  private filterWhere(q: Partial<CashStatsQuery>): Prisma.CashTransactionWhereInput[] {
    const and: Prisma.CashTransactionWhereInput[] = [];
    if (q.direction) and.push({ type: q.direction });
    if (q.category?.length) and.push({ category: { in: q.category } });
    if (q.method?.length) and.push({ method: { in: q.method } });
    if (q.createdById?.length) and.push({ createdById: { in: q.createdById } });
    if (q.source === 'auto') and.push({ isAutomatic: true });
    if (q.source === 'manual') and.push({ isAutomatic: false });
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ description: contains }, { reference: contains }] });
    }
    return and;
  }

  private rangeWhere(sel: { gte: Date | null; lt: Date | null }): Prisma.CashTransactionWhereInput {
    return sel.gte || sel.lt ? { date: { ...(sel.gte ? { gte: sel.gte } : {}), ...(sel.lt ? { lt: sel.lt } : {}) } } : {};
  }

  /** Open closings of the given local days (a reopened closing no longer locks its day). */
  private async closedDays(days: string[]): Promise<Set<string>> {
    if (!days.length) return new Set();
    const rows = await prisma.cashClosing.findMany({ where: { day: { in: [...new Set(days)].map(dayDate) }, reopenedAt: null }, select: { day: true } });
    return new Set(rows.map((r) => dayOfDate(r.day)));
  }

  private async isClosed(db: Tx | typeof prisma, at: Date) {
    const c = await db.cashClosing.findFirst({ where: { day: dayDate(algiersDay(at)), reopenedAt: null }, select: { id: true } });
    return !!c;
  }

  // --- presenting ---------------------------------------------------------------------------------------------------------
  private async references(rows: CashRow[]) {
    // a manual correction opens what the corrected automatic row opens (its sale / purchase / order), not the row itself
    const correctedIds = [...new Set(rows.filter((r) => r.correctsTransactionId && r.sourceType !== 'closing').map((r) => r.correctsTransactionId!))];
    const corrected = correctedIds.length ? await prisma.cashTransaction.findMany({ where: { id: { in: correctedIds } }, select: { id: true, sourceType: true, sourceId: true, reference: true, date: true } }) : [];
    const byCorrected = new Map(corrected.map((c) => [c.id, c]));
    const all = [...rows, ...corrected];
    const entryIds = all.filter((r) => r.sourceType === 'payment_entry' && r.sourceId).map((r) => r.sourceId!);
    const entries = entryIds.length ? await prisma.paymentEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, sourceType: true, sourceId: true } }) : [];
    const byEntry = new Map(entries.map((e) => [e.id, e]));
    const docs = (type: 'order' | 'sale' | 'purchase') => [
      ...new Set([
        ...entries.filter((e) => e.sourceType === type).map((e) => e.sourceId),
        ...all.filter((r) => r.sourceType === type && r.sourceId).map((r) => r.sourceId!),
      ]),
    ];
    const [orders, sales, purchases] = await Promise.all([
      docs('order').length ? prisma.order.findMany({ where: { id: { in: docs('order') } }, select: { id: true, number: true } }) : [],
      docs('sale').length ? prisma.sale.findMany({ where: { id: { in: docs('sale') } }, select: { id: true, number: true } }) : [],
      docs('purchase').length ? prisma.purchase.findMany({ where: { id: { in: docs('purchase') } }, select: { id: true, number: true } }) : [],
    ]);
    const numbers = new Map([...orders, ...sales, ...purchases].map((d) => [d.id, d.number]));
    type Source = Pick<CashRow, 'sourceType' | 'sourceId' | 'reference' | 'date'>;
    const own = (r: Source): CashTransactionView['reference'] => {
      if (r.sourceType === 'payment_entry' && r.sourceId) {
        const e = byEntry.get(r.sourceId);
        return e ? { type: e.sourceType, id: e.sourceId, label: numbers.get(e.sourceId) ?? r.reference ?? '' } : null;
      }
      if ((r.sourceType === 'order' || r.sourceType === 'sale' || r.sourceType === 'purchase') && r.sourceId) return { type: r.sourceType, id: r.sourceId, label: numbers.get(r.sourceId) ?? r.reference ?? '' };
      if (r.sourceType === 'closing' && r.sourceId) return { type: 'closing', id: r.sourceId, label: algiersDay(r.date) };
      return null;
    };
    return (r: CashRow): CashTransactionView['reference'] => {
      const mine = own(r);
      if (mine || !r.correctsTransactionId) return mine;
      const c = byCorrected.get(r.correctsTransactionId);
      return (c && own(c)) ?? { type: 'cash', id: r.correctsTransactionId, label: c?.reference ?? r.reference ?? '' };
    };
  }

  private rowActions(r: CashRow, closed: boolean) {
    const proof = r.proofUploadId ? [action('view_proof', 'gds.read')] : [];
    if (r.isAutomatic) {
      return [
        ...(r.sourceType && r.sourceType !== 'closing' ? [action('open_reference', 'gds.read', { primary: true })] : []),
        ...proof,
        action('edit', 'gds.write', { reasonCode: 'CAISSE_EDIT_AUTOMATIC' }),
        action('delete', 'gds.write', { reasonCode: 'CAISSE_DELETE_AUTOMATIC' }),
        action('correct', 'gds.write'),
      ];
    }
    const expired = Date.now() - r.createdAt.getTime() > CASH_EDIT_WINDOW_HOURS * HOUR_MS;
    const reasonCode = closed ? 'CASH_DAY_CLOSED' : expired ? 'CASH_ENTRY_EDIT_WINDOW_EXPIRED' : undefined;
    return [
      ...(r.correctsTransactionId ? [action('open_reference', 'gds.read')] : []),
      ...proof,
      action('edit', 'gds.write', { reasonCode, primary: !reasonCode }),
      action('delete', 'gds.write', { reasonCode }),
      action('duplicate', 'gds.write'),
    ];
  }

  private async views(rows: CashRow[], balances?: Map<string, number>): Promise<CashTransactionView[]> {
    const [ref, closed] = await Promise.all([this.references(rows), this.closedDays(rows.map((r) => algiersDay(r.date)))]);
    return rows.map((r) => {
      const isClosed = closed.has(algiersDay(r.date));
      return {
        id: r.id,
        type: r.type,
        amount: r.amount,
        category: r.category,
        method: r.method,
        description: r.description,
        reference: ref(r),
        date: r.date.toISOString(),
        isAutomatic: r.isAutomatic,
        locked: r.isAutomatic || isClosed,
        lockReason: r.isAutomatic ? 'CAISSE_EDIT_AUTOMATIC' : isClosed ? 'CASH_DAY_CLOSED' : null,
        balanceAfter: balances?.get(r.id) ?? 0,
        createdBy: userRef(r.createdBy),
        proofUrl: r.proof ? this.storage.signedUrl(r.proof.storageKey, 3600) : null,
        correctsTransactionId: r.correctsTransactionId,
        createdAt: r.createdAt.toISOString(),
        actions: this.rowActions(r, isClosed),
      };
    });
  }

  /** Running balance after each row of the selection, every row of the workspace counted (opening + Σ in order). */
  private async runningBalances(sel: { gte: Date | null; lt: Date | null }, opening: number): Promise<Map<string, number>> {
    const ws = TenantContext.workspaceId();
    const gte = sel.gte ? Prisma.sql`AND "date" >= ${sel.gte}` : Prisma.empty;
    const lt = sel.lt ? Prisma.sql`AND "date" < ${sel.lt}` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ id: string; running: number }[]>`
      SELECT "id", (sum(CASE WHEN "type" = 'income' THEN "amount" ELSE -"amount" END) OVER (ORDER BY "date", "createdAt", "id"))::float8 AS running
      FROM "CashTransaction" WHERE "workspaceId" = ${ws}::uuid ${gte} ${lt}`;
    return new Map(rows.map((r) => [r.id, opening + Math.round(r.running)]));
  }

  // --- reading ------------------------------------------------------------------------------------------------------------
  /** `GET /cash` — rows of the selection with their running balance; `meta.openingBalance` = the stats' opening. */
  async list(q: CashQuery): Promise<Page<CashTransactionView> & { meta: Record<string, unknown> }> {
    const sel = this.selection(q);
    const where: Prisma.CashTransactionWhereInput = { AND: [this.rangeWhere(sel), ...this.filterWhere(q)] };
    const sort = q.sort ?? '-date';
    if (sort !== 'date' && sort !== '-date') throw new AppException('BAD_REQUEST');
    const dir: 'asc' | 'desc' = sort === 'date' ? 'asc' : 'desc';
    const opening = await this.balanceBefore(sel.gte);
    const [rows, total, balances] = await Promise.all([
      prisma.cashTransaction.findMany({ where, include: CASH_INCLUDE, orderBy: [{ date: dir }, { createdAt: dir }, { id: dir }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.cashTransaction.count({ where }),
      this.runningBalances(sel, opening),
    ]);
    return { ...page(await this.views(rows, balances), total, q), meta: { openingBalance: opening, from: sel.from, to: sel.to } };
  }

  /** Days (before today) with rows and no open closing, oldest first ("02, 03, 04 oct. → à clôturer"). */
  private async unclosedDays(limit = 31): Promise<string[]> {
    const ws = TenantContext.workspaceId();
    const today = algiersDay();
    const rows = await prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char(("t"."date" + interval '1 hour'), 'YYYY-MM-DD') AS day
      FROM "CashTransaction" t
      WHERE t."workspaceId" = ${ws}::uuid AND t."date" < ${algiersDayStart(today)}
        AND NOT EXISTS (SELECT 1 FROM "CashClosing" c WHERE c."workspaceId" = t."workspaceId" AND c."reopenedAt" IS NULL AND c."day" = (t."date" + interval '1 hour')::date)
      ORDER BY day DESC LIMIT ${limit}`;
    return rows.map((r) => r.day).reverse();
  }

  /**
   * 04 §20: theoretical cash of a day = counted balance of the previous closing (0 if none) + Σ cash-method rows since
   * that closing's day, up to the end of `day` (an earlier day left open is included instead of being lost).
   */
  async theoreticalCash(db: Tx | typeof prisma, day: string): Promise<number> {
    const ws = TenantContext.workspaceId();
    const prev = await db.cashClosing.findFirst({ where: { day: { lt: dayDate(day) }, reopenedAt: null }, orderBy: { day: 'desc' } });
    const from = prev ? algiersDayEnd(dayOfDate(prev.day)) : null;
    const lower = from ? Prisma.sql`AND "date" >= ${from}` : Prisma.empty;
    const [r] = await (db as typeof prisma).$queryRaw<{ s: number }[]>`
      SELECT COALESCE(sum(CASE WHEN "type" = 'income' THEN "amount" ELSE -"amount" END), 0)::float8 AS s
      FROM "CashTransaction" WHERE "workspaceId" = ${ws}::uuid AND "method" = 'cash' AND "date" < ${algiersDayEnd(day)} ${lower}`;
    return (prev?.countedBalance ?? 0) + Math.round(r?.s ?? 0);
  }

  /** `GET /cash/stats` — the KPIs of the same selection and filters as `GET /cash`. */
  async stats(q: CashStatsQuery): Promise<CashStatsView> {
    const sel = this.selection(q);
    const filtered: Prisma.CashTransactionWhereInput = { AND: [this.rangeWhere(sel), ...this.filterWhere(q)] };
    const [opening, rows, allRows, unclosed] = await Promise.all([
      this.balanceBefore(sel.gte),
      prisma.cashTransaction.findMany({ where: filtered, select: { type: true, amount: true, category: true } }),
      prisma.cashTransaction.findMany({ where: this.rangeWhere(sel), select: { type: true, amount: true } }),
      this.unclosedDays(),
    ]);
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const single = sel.from && sel.from === sel.to ? sel.from : null;
    return {
      from: sel.from ?? '',
      to: sel.to ?? '',
      openingBalance: opening,
      income,
      expense,
      net: income - expense,
      currentBalance: opening + allRows.reduce((s, r) => s + signed(r), 0),
      counts: {
        rows: rows.length,
        sales: rows.filter((r) => r.category === 'sale' && r.type === 'income').length,
        cod: rows.filter((r) => r.category === 'order' && r.type === 'income').length,
        purchases: rows.filter((r) => r.category === 'purchase').length,
        fees: rows.filter((r) => r.type === 'expense' && (FEE_CATEGORIES as readonly string[]).includes(r.category)).length,
      },
      unclosedDays: unclosed,
      day: single ? { day: single, closed: (await this.closedDays([single])).has(single), theoreticalCash: await this.theoreticalCash(prisma, single) } : null,
    };
  }

  private closingView(c: CashClosing & { closedBy: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null; reopenedBy: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null }) {
    return {
      id: c.id,
      theoreticalBalance: c.theoreticalBalance,
      countedBalance: c.countedBalance,
      difference: c.difference,
      note: c.note,
      closedBy: userRef(c.closedBy),
      closedAt: c.closedAt.toISOString(),
      reopenedBy: userRef(c.reopenedBy),
      reopenedAt: c.reopenedAt ? c.reopenedAt.toISOString() : null,
    };
  }

  /** One `CashDayView` (api-contract `CashClosingDto`). */
  async day(day: string): Promise<CashDayView> {
    const [opening, rows, closing, theoretical] = await Promise.all([
      this.balanceBefore(algiersDayStart(day)),
      prisma.cashTransaction.findMany({ where: { date: { gte: algiersDayStart(day), lt: algiersDayEnd(day) } }, select: { type: true, amount: true } }),
      prisma.cashClosing.findFirst({ where: { day: dayDate(day) }, include: { closedBy: { select: USER_SELECT }, reopenedBy: { select: USER_SELECT } } }),
      this.theoreticalCash(prisma, day),
    ]);
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const closed = !!closing && !closing.reopenedAt;
    return {
      day,
      openingBalance: opening,
      income,
      expense,
      closingBalance: opening + income - expense,
      theoreticalCash: theoretical,
      closed,
      closing: closing ? this.closingView(closing) : null,
      actions: closed ? [action('reopen', 'gds.write', { primary: true })] : [action('close', 'gds.write', { primary: true, reasonCode: day > algiersDay() ? 'VALIDATION_ERROR' : undefined })],
    };
  }

  /** `GET /cash/days` — days with rows or a closing in the range (default: the last 31 days), newest first. */
  async days(q: CashDaysQuery): Promise<CashDayView[]> {
    const ws = TenantContext.workspaceId();
    const to = q.to ?? algiersDay();
    const from = q.from ?? algiersDay(new Date(algiersDayStart(to).getTime() - 30 * 86_400_000));
    const rows = await prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char(("date" + interval '1 hour'), 'YYYY-MM-DD') AS day FROM "CashTransaction"
      WHERE "workspaceId" = ${ws}::uuid AND "date" >= ${algiersDayStart(from)} AND "date" < ${algiersDayEnd(to)}`;
    const closings = await prisma.cashClosing.findMany({ where: { day: { gte: dayDate(from), lte: dayDate(to) } }, select: { day: true } });
    const all = [...new Set([...rows.map((r) => r.day), ...closings.map((c) => dayOfDate(c.day)), ...(to === algiersDay() ? [to] : [])])].sort().reverse();
    const out: CashDayView[] = [];
    for (const d of all) out.push(await this.day(d));
    return q.status ? out.filter((d) => (q.status === 'closed' ? d.closed : !d.closed)) : out;
  }

  async get(id: string): Promise<CashTransactionView> {
    const r = await prisma.cashTransaction.findFirst({ where: { id }, include: CASH_INCLUDE });
    if (!r) throw notFound();
    const sel = { gte: algiersDayStart(algiersDay(r.date)), lt: algiersDayEnd(algiersDay(r.date)) };
    const balances = await this.runningBalances(sel, await this.balanceBefore(sel.gte));
    return (await this.views([r], balances))[0]!;
  }

  // --- manual rows --------------------------------------------------------------------------------------------------------
  private async checkProof(tx: Tx, uploadId: string | null | undefined) {
    if (!uploadId) return;
    const u = await tx.upload.findFirst({ where: { id: uploadId, workspaceId: TenantContext.workspaceId() }, select: { id: true } });
    if (!u) throw validationError({ proofUploadId: 'validation.invalid' });
  }

  /** `POST /cash` (Idempotency-Key required). */
  async create(input: CreateCashEntryInput): Promise<CashTransactionView> {
    const date = checkBusinessDate(input.date, 'date') ?? new Date();
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (await this.isClosed(tx, date)) throw new AppException('CASH_DAY_CLOSED', { date: algiersDay(date) });
      await this.checkProof(tx, input.proofUploadId);
      if (input.correctsTransactionId) {
        const target = await tx.cashTransaction.findFirst({ where: { id: input.correctsTransactionId }, select: { isAutomatic: true } });
        if (!target || !target.isAutomatic) throw validationError({ correctsTransactionId: 'validation.invalid' });
      }
      const row = await tx.cashTransaction.create({
        data: {
          workspaceId: TenantContext.workspaceId(),
          type: input.type,
          amount: input.amount,
          category: input.category,
          method: input.method,
          description: input.description ?? null,
          reference: input.reference ?? null,
          date,
          isAutomatic: false,
          createdById: TenantContext.get().userId ?? null,
          proofUploadId: input.proofUploadId ?? null,
          correctsTransactionId: input.correctsTransactionId ?? null,
        },
      });
      await emitCash(tx, this.outbox, row.date, row.id);
      return row.id;
    });
    return this.get(id);
  }

  /** Locks shared by edit and delete (AT-CSH-02 order: automatic, closed day, 24 h window). */
  private async editable(tx: Tx, id: string, automaticCode: 'CAISSE_EDIT_AUTOMATIC' | 'CAISSE_DELETE_AUTOMATIC') {
    if (!(await lockRow(tx, 'CashTransaction', id))) throw notFound();
    const r = await tx.cashTransaction.findUniqueOrThrow({ where: { id } });
    if (r.isAutomatic) throw new AppException(automaticCode);
    if (await this.isClosed(tx, r.date)) throw new AppException('CASH_DAY_CLOSED', { date: algiersDay(r.date) });
    if (Date.now() - r.createdAt.getTime() > CASH_EDIT_WINDOW_HOURS * HOUR_MS) throw new AppException('CASH_ENTRY_EDIT_WINDOW_EXPIRED');
    return r;
  }

  /** `PATCH /cash/:id` — manual rows only. */
  async update(id: string, input: UpdateCashEntryInput): Promise<CashTransactionView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await this.editable(tx, id, 'CAISSE_EDIT_AUTOMATIC');
      const date = checkBusinessDate(input.date, 'date');
      if (date && (await this.isClosed(tx, date))) throw new AppException('CASH_DAY_CLOSED', { date: algiersDay(date) });
      await this.checkProof(tx, input.proofUploadId);
      if (input.category && input.category !== 'correction' && r.correctsTransactionId) throw validationError({ category: 'validation.invalid' });
      const row = await tx.cashTransaction.update({
        where: { id },
        data: {
          ...(input.type ? { type: input.type } : {}),
          ...(input.amount ? { amount: input.amount } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.method ? { method: input.method } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.reference !== undefined ? { reference: input.reference } : {}),
          ...(input.proofUploadId !== undefined ? { proofUploadId: input.proofUploadId } : {}),
          ...(date ? { date } : {}),
        },
      });
      await emitCash(tx, this.outbox, r.date, `${row.id}:u`);
      if (date && algiersDay(date) !== algiersDay(r.date)) await emitCash(tx, this.outbox, date, `${row.id}:m`);
    });
    return this.get(id);
  }

  /** `DELETE /cash/:id` — simple confirmation; the balances are computed, nothing to recompute. */
  async remove(id: string) {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await this.editable(tx, id, 'CAISSE_DELETE_AUTOMATIC');
      await tx.cashTransaction.delete({ where: { id } });
      await emitCash(tx, this.outbox, r.date, `${id}:d`);
    });
  }

  // --- day closing (D56) --------------------------------------------------------------------------------------------------
  /** `POST /cash/close` (Idempotency-Key required). */
  async close(input: CloseCashInput): Promise<CashDayView> {
    if (input.day > algiersDay()) throw validationError({ day: 'validation.date' });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const ws = TenantContext.workspaceId();
      // one closing per day: the workspace row serialises concurrent closings
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${ws}::uuid FOR UPDATE`;
      const existing = await tx.cashClosing.findFirst({ where: { day: dayDate(input.day) } });
      if (existing && !existing.reopenedAt) throw new AppException('CASH_DAY_CLOSED', { date: input.day });
      const theoretical = await this.theoreticalCash(tx, input.day);
      const difference = input.countedBalance - theoretical;
      if (difference !== 0 && !input.note) throw validationError({ note: 'validation.required' });
      const userId = TenantContext.get().userId!;
      const data = { theoreticalBalance: theoretical, countedBalance: input.countedBalance, difference, note: input.note ?? null, closedById: userId, closedAt: new Date(), reopenedById: null, reopenedAt: null };
      const closing = existing ? await tx.cashClosing.update({ where: { id: existing.id }, data }) : await tx.cashClosing.create({ data: { workspaceId: ws, day: dayDate(input.day), ...data } });
      if (difference !== 0) {
        const at = input.day === algiersDay() ? new Date() : new Date(algiersDayEnd(input.day).getTime() - 1000);
        await tx.cashTransaction.create({
          data: { workspaceId: ws, type: difference > 0 ? 'income' : 'expense', amount: Math.abs(difference), category: 'correction', method: 'cash', reference: `CLOTURE-${input.day}`, description: input.note ?? null, date: at, isAutomatic: true, sourceType: 'closing', sourceId: closing.id, closingId: closing.id, createdById: userId },
        });
      }
      await emitCash(tx, this.outbox, algiersDayStart(input.day), `close:${closing.id}`);
    });
    return this.day(input.day);
  }

  /** `POST /cash/days/:day/reopen { reason }` — Admin+, audited; the correction row is reversed by a new correction row. */
  async reopen(day: string, input: ReopenCashInput): Promise<CashDayView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${TenantContext.workspaceId()}::uuid FOR UPDATE`;
      const closing = await tx.cashClosing.findFirst({ where: { day: dayDate(day) } });
      if (!closing) throw notFound();
      if (closing.reopenedAt) throw conflict({ reason: 'CASH_DAY_OPEN', day });
      const userId = TenantContext.get().userId!;
      await tx.cashClosing.update({ where: { id: closing.id }, data: { reopenedById: userId, reopenedAt: new Date() } });
      // the correction of this closing still standing (not reversed yet) is reversed, never deleted
      const corrections = await tx.cashTransaction.findMany({ where: { sourceType: 'closing', sourceId: closing.id, correctsTransactionId: null } });
      for (const c of corrections) {
        const reversed = await tx.cashTransaction.count({ where: { correctsTransactionId: c.id } });
        if (reversed) continue;
        await tx.cashTransaction.create({
          data: { workspaceId: c.workspaceId, type: c.type === 'income' ? 'expense' : 'income', amount: c.amount, category: 'correction', method: c.method, reference: c.reference, description: `Réouverture : ${input.reason}`, date: c.date, isAutomatic: true, sourceType: 'closing', sourceId: closing.id, correctsTransactionId: c.id, createdById: userId },
        });
      }
      await emitCash(tx, this.outbox, algiersDayStart(day), `reopen:${closing.id}`);
    });
    return this.day(day);
  }

  // --- export -------------------------------------------------------------------------------------------------------------
  private async exportTable(q: CashStatsQuery, locale: 'fr' | 'ar' | 'en') {
    const sel = this.selection(q);
    const rows = await prisma.cashTransaction.findMany({ where: { AND: [this.rangeWhere(sel), ...this.filterWhere(q)] }, include: CASH_INCLUDE, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 50_000 });
    const views = await this.views(rows, await this.runningBalances(sel, await this.balanceBefore(sel.gte)));
    const h = CASH_HEADERS[locale] ?? CASH_HEADERS.fr;
    type R = CashTransactionView;
    return {
      sheetName: h.sheet,
      fileName: `caisse-${sel.from ?? 'debut'}-${sel.to}`,
      rows: views,
      columns: [
        { header: h.date, value: (r: R) => r.date },
        { header: h.description, value: (r: R) => r.description ?? '' },
        { header: h.reference, value: (r: R) => r.reference?.label ?? '' },
        { header: h.category, value: (r: R) => r.category },
        { header: h.method, value: (r: R) => r.method },
        { header: h.amount, value: (r: R) => (r.type === 'income' ? r.amount : -r.amount) },
        { header: h.balance, value: (r: R) => r.balanceAfter },
        { header: h.auto, value: (r: R) => (r.isAutomatic ? 'AUTO' : '') },
        { header: h.by, value: (r: R) => (r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : '') },
      ],
    };
  }
}

const CASH_HEADERS = {
  fr: { sheet: 'Caisse', date: 'Date', description: 'Libellé', reference: 'Référence', category: 'Type', method: 'Mode', amount: 'Montant', balance: 'Solde', auto: 'Auto', by: 'Par' },
  en: { sheet: 'Cash', date: 'Date', description: 'Label', reference: 'Reference', category: 'Type', method: 'Method', amount: 'Amount', balance: 'Balance', auto: 'Auto', by: 'By' },
  ar: { sheet: 'الصندوق', date: 'التاريخ', description: 'البيان', reference: 'المرجع', category: 'النوع', method: 'الطريقة', amount: 'المبلغ', balance: 'الرصيد', auto: 'تلقائي', by: 'بواسطة' },
} as const;
