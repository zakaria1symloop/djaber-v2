// 04 §3 / §20 / GDS-08 — the money half of SaleEffects and PurchaseEffects: one PaymentEntry per recorded payment and
// its locked automatic cash row (`isAutomatic=true`, `sourceType=payment_entry`), the refund row of a cancelled sale,
// and the `amountPaid` recomputed from the entries (never incremented). Only the effects services call these functions
// (CLAUDE.md rule 5); they always run inside the caller's transaction.
import { TenantContext, type CashCategory, type CashMethod, type PaymentMethod, type Tx } from '@djaber/db';
import { deriveGdsPaymentStatus, textIn } from '@djaber/shared';
import type { OutboxService } from '../../core/outbox/outbox.service';
import { AppException } from '../../core/errors/app.exception';
import { algiersDay, algiersDayStart } from '../../core/time/algiers';

const CASH_METHOD: Record<PaymentMethod, CashMethod> = { cash: 'cash', card: 'card', transfer: 'transfer', ccp: 'ccp', other: 'other' };
export const cashMethodOf = (m: PaymentMethod): CashMethod => CASH_METHOD[m];

const closedDay = async (tx: Tx, day: string) => !!(await tx.cashClosing.findFirst({ where: { day: new Date(`${day}T00:00:00Z`), reopenedAt: null }, select: { id: true } }));
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10);

/**
 * 04 §20 locked day: an automatic row is dated on its effective date only while that day is open, else today (the cash
 * moved today). When today is closed too (journeys 16/11 J06-1: a sale or « Encaisser le reste » after « Clôturer la
 * journée » landed in the closed day), a user action is refused with `409 CASH_DAY_CLOSED {date}` (reopen the day first)
 * and a system event (courier, payment webhook, AI) is booked at the start of the next open day — never in a closed day.
 */
export async function cashDate(tx: Tx, at: Date, onClosed: 'refuse' | 'next' = 'refuse'): Promise<Date> {
  const today = algiersDay();
  const day = algiersDay(at);
  if (day !== today && !(await closedDay(tx, day))) return at;
  if (!(await closedDay(tx, today))) return day === today ? at : new Date();
  if (onClosed === 'refuse') throw new AppException('CASH_DAY_CLOSED', { date: today });
  let next = nextDay(today);
  while (await closedDay(tx, next)) next = nextDay(next);
  return algiersDayStart(next);
}

/** 04 §20: an automatic row of a closed day is never deleted (a cancel without refund of a sale paid on a closed day). */
async function assertRowsOpen(tx: Tx, cashIds: string[]) {
  if (!cashIds.length) return;
  const rows = await tx.cashTransaction.findMany({ where: { id: { in: cashIds } }, select: { date: true } });
  for (const day of new Set(rows.map((r) => algiersDay(r.date)))) if (await closedDay(tx, day)) throw new AppException('CASH_DAY_CLOSED', { date: day });
}

/** The member recorded on a payment entry (`createdById` is required): the acting user, else the workspace owner. */
export async function payerOf(tx: Tx): Promise<string> {
  const userId = TenantContext.get().userId;
  if (userId) return userId;
  const owner = await tx.membership.findFirst({ where: { workspaceId: TenantContext.workspaceId(), role: 'owner' }, select: { userId: true } });
  return owner!.userId;
}

export type PaymentRowInput = {
  sourceType: 'sale' | 'purchase';
  sourceId: string;
  /** document number shown as the cash row reference (`VNT-1001`, `ACH-1001`) */
  number: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  paidAt?: Date;
  description: string;
};

/**
 * One PaymentEntry + its locked cash row: a sale payment is an income `sale`, a purchase payment an expense `purchase`
 * (cash actually moved — GDS-08). Returns the entry.
 */
export async function writePayment(tx: Tx, outbox: OutboxService, p: PaymentRowInput) {
  if (p.amount <= 0) return null;
  const workspaceId = TenantContext.workspaceId();
  const paidAt = p.paidAt ?? new Date();
  const createdById = await payerOf(tx);
  const sale = p.sourceType === 'sale';
  const category: CashCategory = sale ? 'sale' : 'purchase';
  const cash = await tx.cashTransaction.create({
    data: { workspaceId, type: sale ? 'income' : 'expense', amount: p.amount, category, method: CASH_METHOD[p.method], reference: p.number, description: p.description, date: await cashDate(tx, paidAt), isAutomatic: true, sourceType: 'payment_entry', createdById },
  });
  const entry = await tx.paymentEntry.create({ data: { workspaceId, sourceType: p.sourceType, sourceId: p.sourceId, amount: p.amount, method: p.method, reference: p.reference ?? null, note: p.note ?? null, paidAt, createdById, cashTransactionId: cash.id } });
  await tx.cashTransaction.update({ where: { id: cash.id }, data: { sourceId: entry.id } });
  await emitCash(tx, outbox, cash.date, cash.id);
  return entry;
}

/** Removes the document's payment entries and their automatic cash rows (manual rows are never touched). */
export async function clearPayments(tx: Tx, outbox: OutboxService, sourceType: 'sale' | 'purchase', sourceId: string) {
  const entries = await tx.paymentEntry.findMany({ where: { sourceType, sourceId }, select: { id: true, cashTransactionId: true } });
  if (!entries.length) return 0;
  const cashIds = entries.map((e) => e.cashTransactionId).filter((x): x is string => !!x);
  await assertRowsOpen(tx, cashIds);
  await tx.paymentEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  if (cashIds.length) await tx.cashTransaction.deleteMany({ where: { id: { in: cashIds }, isAutomatic: true } });
  await outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'cash.updated', { day: algiersDay() }, `cash.updated:clear:${sourceType}:${sourceId}:${Date.now()}`);
  return entries.length;
}

/**
 * « Modifier le paiement » of a validated sale (journey J06r-1): the mode picked is the mode of the money taken, so the
 * payment entries recorded with the sale's mode (`from`) and their locked cash rows are rewritten to `to` — amounts and
 * dates unchanged (the theoretical cash, the Paiements report and the ticket follow). A row of a closed day is never
 * rewritten: `409 CASH_DAY_CLOSED {date}` (reopen the day first). Entries taken with another mode (« Encaisser le reste »
 * in CCP) keep theirs. Returns the number of entries rewritten.
 */
export async function rewritePaymentMethod(tx: Tx, outbox: OutboxService, sourceType: 'sale' | 'purchase', sourceId: string, from: PaymentMethod, to: PaymentMethod) {
  if (from === to) return 0;
  const entries = await tx.paymentEntry.findMany({ where: { sourceType, sourceId, method: from }, select: { id: true, cashTransactionId: true } });
  if (!entries.length) return 0;
  const cashIds = entries.map((e) => e.cashTransactionId).filter((x): x is string => !!x);
  await assertRowsOpen(tx, cashIds);
  await tx.paymentEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { method: to } });
  if (cashIds.length) await tx.cashTransaction.updateMany({ where: { id: { in: cashIds }, isAutomatic: true }, data: { method: CASH_METHOD[to] } });
  await outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'cash.updated', { day: algiersDay() }, `cash.updated:method:${sourceType}:${sourceId}:${Date.now()}`);
  return entries.length;
}

/** Locked `refund` expense row of a cancelled sale whose money is given back (04 §20 "refund row if money was taken"). */
export async function writeRefund(tx: Tx, outbox: OutboxService, p: { sourceId: string; number: string; amount: number; method: PaymentMethod; description: string }) {
  if (p.amount <= 0) return null;
  const cash = await tx.cashTransaction.create({
    data: { workspaceId: TenantContext.workspaceId(), type: 'expense', amount: p.amount, category: 'refund', method: CASH_METHOD[p.method], reference: p.number, description: p.description, date: await cashDate(tx, new Date()), isAutomatic: true, sourceType: 'sale', sourceId: p.sourceId, createdById: TenantContext.get().userId ?? null },
  });
  await emitCash(tx, outbox, cash.date, cash.id);
  return cash;
}

/** `amountPaid` = Σ entries (clamped 0..total); status derived (04 §1.4 applied to GDS documents). */
export async function recomputePaid(tx: Tx, sourceType: 'sale' | 'purchase', sourceId: string, total: number) {
  const sum = await tx.paymentEntry.aggregate({ where: { sourceType, sourceId }, _sum: { amount: true } });
  const amountPaid = Math.max(0, Math.min(sum._sum.amount ?? 0, total));
  return { amountPaid, paymentStatus: deriveGdsPaymentStatus(amountPaid, total) };
}

export function emitCash(tx: Tx, outbox: OutboxService, date: Date, key: string) {
  return outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'cash.updated', { day: algiersDay(date) }, `cash.updated:${key}:${Date.now()}`);
}

/** The reference of a closing / reopening row read by people (« Clôture du 16/11/2026 »), not the raw key (J06-10a). */
export const closingReference = (day: string, locale: string) => textIn('cash.ref.closing', locale, { day: `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` }) ?? day;
