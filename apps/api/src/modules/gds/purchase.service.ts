// GDS-06 / 04 §20 (D64, R-M) — purchases `ACH-…`: draft → pending ("Commandé") → partial → received, cancel from
// draft / pending / partial, receipts with over-receipt accepted and the weighted-average cost, payments (locked cash
// rows), delete while draft / pending and unpaid, duplicate, print. Stock and cash only through PurchaseEffects.
import { Injectable } from '@nestjs/common';
import { deriveGdsPaymentStatus, PURCHASE_SORTS, storedText, type CancelPurchaseInput, type CreatePurchaseInput, type GdsPaymentInput, type PurchaseListItemView, type PurchasesQuery, type PurchaseStatsView, type PurchaseView, type ReceivePurchaseInput, type UpdatePurchaseInput } from '@djaber/shared';
import { prisma, TenantContext, type Prisma, type Purchase, type Tx } from '@djaber/db';
import { CounterService } from '../../core/counter/counter.service';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { lastDays } from '../../core/time/period';
import { action } from '../catalog/catalog.util';
import type { Warning } from '../catalog/catalog.util';
import { dateLabel, GDS_LABELS, money } from './gds-document.pdf';
import { resolveGdsLines } from './gds-lines';
import { GdsPrintService } from './gds-print.service';
import { checkBusinessDate, dateWhere, deltaPct, iso, lockRow, paymentsOf, PRODUCT_REF_SELECT, productRef, rangeOf, sortOf, USER_SELECT, userRef } from './gds.util';
import { PurchaseEffects } from './purchase-effects.service';

export const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  items: { orderBy: { id: 'asc' }, include: { product: { select: PRODUCT_REF_SELECT } } },
  createdBy: { select: USER_SELECT },
} satisfies Prisma.PurchaseInclude;
type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof PURCHASE_INCLUDE }>;
const OPEN_RECEIPT = ['pending', 'partial'] as const;

export const isLate = (p: Pick<Purchase, 'status' | 'expectedAt'>, now = Date.now()) => !!p.expectedAt && p.expectedAt.getTime() < now && (OPEN_RECEIPT as readonly string[]).includes(p.status);
export const remainingOf = (p: Pick<Purchase, 'status' | 'total' | 'amountPaid'>) => (p.status === 'cancelled' || p.status === 'draft' ? 0 : Math.max(0, p.total - p.amountPaid));

/** Row menu of a purchase (contract-ready.md "Purchases"). */
export const purchaseActions = (p: Pick<Purchase, 'status' | 'total' | 'amountPaid'>) => {
  const paid = p.amountPaid > 0;
  const remaining = Math.max(0, p.total - p.amountPaid);
  const del = (enabled: boolean) => action('delete', 'gds.write', { reasonCode: enabled ? undefined : 'PURCHASE_DELETE_NOT_PENDING' });
  switch (p.status) {
    case 'draft':
      return [action('order', 'gds.write', { primary: true }), action('receive', 'gds.write'), action('edit', 'gds.write'), action('record_payment', 'gds.write'), action('duplicate', 'gds.write'), action('print', 'gds.read'), action('cancel', 'gds.write'), del(!paid)];
    case 'pending':
      return [action('receive', 'gds.write', { primary: true }), action('edit', 'gds.write'), action('record_payment', 'gds.write'), action('duplicate', 'gds.write'), action('print', 'gds.read'), action('cancel', 'gds.write'), del(!paid)];
    case 'partial':
      return [action('receive', 'gds.write', { primary: true }), action('record_payment', 'gds.write'), action('duplicate', 'gds.write'), action('print', 'gds.read'), action('cancel', 'gds.write'), del(false)];
    case 'received':
      return [...(remaining > 0 ? [action('record_payment', 'gds.write', { primary: true })] : []), action('duplicate', 'gds.write'), action('print', 'gds.read'), action('cancel', 'gds.write', { reasonCode: 'PURCHASE_ALREADY_RECEIVED' }), del(false)];
    default:
      return [action('duplicate', 'gds.write'), action('print', 'gds.read'), action('record_payment', 'gds.write', { reasonCode: 'PURCHASE_CANCELLED_PAYMENT_LOCKED' })];
  }
};

export const presentPurchaseListItem = (p: PurchaseRow): PurchaseListItemView => ({
  id: p.id,
  number: p.number,
  supplier: p.supplier,
  status: p.status,
  itemCount: p.items.length,
  units: { ordered: p.items.reduce((s, i) => s + i.quantity, 0), received: p.items.reduce((s, i) => s + i.receivedQty, 0) },
  total: p.total,
  amountPaid: p.amountPaid,
  remaining: remainingOf(p),
  paymentStatus: p.paymentStatus,
  purchasedAt: p.purchasedAt.toISOString(),
  expectedAt: iso(p.expectedAt),
  receivedAt: iso(p.receivedAt),
  late: isLate(p),
  actions: purchaseActions(p),
});

/** 04 §4: `purchase.total = Σ(unitCost × qty) + tax + shipping`. */
const totalsOf = (lines: { quantity: number; unitCost: number }[], tax: number, shipping: number) => {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  return { subtotal, total: subtotal + tax + shipping };
};

@Injectable()
export class PurchaseService {
  constructor(
    private readonly effects: PurchaseEffects,
    private readonly counter: CounterService,
    private readonly printer: GdsPrintService,
  ) {}

  // --- reading ------------------------------------------------------------------------------------------------------------
  where(q: Partial<PurchasesQuery>): Prisma.PurchaseWhereInput {
    const and: Prisma.PurchaseWhereInput[] = [];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.supplierId?.length) and.push({ supplierId: { in: q.supplierId } });
    if (q.paymentStatus?.length) and.push({ paymentStatus: { in: q.paymentStatus } });
    if (q.late === true) and.push({ status: { in: [...OPEN_RECEIPT] }, expectedAt: { lt: new Date() } });
    if (q.late === false) and.push({ NOT: { status: { in: [...OPEN_RECEIPT] }, expectedAt: { lt: new Date() } } });
    if (q.productId) and.push({ items: { some: { productId: q.productId } } });
    const dates = dateWhere(q);
    if (dates) and.push({ purchasedAt: dates });
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ number: contains }, { supplierInvoiceRef: contains }, { supplier: { name: contains } }, { items: { some: { productName: contains } } }] });
    }
    return { AND: and };
  }

  async list(q: PurchasesQuery): Promise<Page<PurchaseListItemView>> {
    const { field, dir } = sortOf(q.sort, PURCHASE_SORTS, '-purchasedAt');
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      prisma.purchase.findMany({ where, include: PURCHASE_INCLUDE, orderBy: [{ [field]: dir }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.purchase.count({ where }),
    ]);
    return page(rows.map(presentPurchaseListItem), total, q);
  }

  async stats(q: Partial<PurchasesQuery>): Promise<PurchaseStatsView> {
    const now = new Date();
    const base = { ...q, period: undefined, from: undefined, to: undefined };
    const range = q.period || q.from || q.to ? rangeOf(q) : lastDays(30).current;
    const span = (range.lt ?? now).getTime() - (range.gte ?? new Date(0)).getTime();
    const prevRange = range.gte ? { gte: new Date(range.gte.getTime() - span), lt: range.gte } : null;
    const counted: Prisma.PurchaseWhereInput = { status: { notIn: ['cancelled', 'draft'] } };
    const [pendingReceipt, late, due, drafts, cur, prev, count] = await Promise.all([
      prisma.purchase.count({ where: { status: { in: [...OPEN_RECEIPT] } } }),
      prisma.purchase.count({ where: { status: { in: [...OPEN_RECEIPT] }, expectedAt: { lt: now } } }),
      prisma.purchase.findMany({ where: { status: { in: ['pending', 'partial', 'received'] } }, select: { supplierId: true, total: true, amountPaid: true } }),
      prisma.purchase.count({ where: { status: 'draft' } }),
      prisma.purchase.aggregate({ where: { AND: [this.where(base), counted, { purchasedAt: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) } }] }, _sum: { total: true } }),
      prevRange ? prisma.purchase.aggregate({ where: { AND: [this.where(base), counted, { purchasedAt: prevRange }] }, _sum: { total: true } }) : null,
      prisma.purchase.count({ where: this.where(q) }),
    ]);
    const owing = due.filter((d) => d.total > d.amountPaid);
    const purchased = cur._sum.total ?? 0;
    const purchasedPrevious = prev?._sum.total ?? 0;
    return {
      pendingReceipt,
      late,
      dueToSuppliers: owing.reduce((s, d) => s + d.total - d.amountPaid, 0),
      suppliersWithBalance: new Set(owing.map((d) => d.supplierId ?? 'none')).size,
      purchased,
      purchasedPrevious,
      purchasedDeltaPct: deltaPct(purchased, purchasedPrevious),
      drafts,
      count,
    };
  }

  private async row(id: string, db: Tx | typeof prisma = prisma): Promise<PurchaseRow> {
    const p = await db.purchase.findFirst({ where: { id }, include: PURCHASE_INCLUDE });
    if (!p) throw notFound();
    return p;
  }

  async get(id: string): Promise<PurchaseView> {
    const p = await this.row(id);
    const payments = (await paymentsOf('purchase', [p.id])).get(p.id) ?? [];
    return {
      ...presentPurchaseListItem(p),
      supplierInvoiceRef: p.supplierInvoiceRef,
      items: p.items.map((i) => ({
        id: i.id,
        product: productRef(i.product),
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        quantity: i.quantity,
        receivedQty: i.receivedQty,
        remainingQty: Math.max(0, i.quantity - i.receivedQty),
        unitCost: i.unitCost,
        total: i.total,
      })),
      subtotal: p.subtotal,
      tax: p.tax,
      shippingCost: p.shippingCost,
      paymentMethod: p.paymentMethod,
      payments,
      notes: p.notes,
      cancelReason: p.cancelReason,
      cancelledAt: iso(p.cancelledAt),
      createdBy: userRef(p.createdBy),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  // --- writing ------------------------------------------------------------------------------------------------------------
  private async lock(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'Purchase', id))) throw notFound();
    return tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
  }

  private async checkSupplier(tx: Tx, supplierId: string | null | undefined) {
    if (!supplierId) return;
    const s = await tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } });
    if (!s) throw validationError({ supplierId: 'validation.invalid' });
  }

  private async writeTotals(tx: Tx, id: string) {
    const p = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const t = totalsOf(p.items, p.tax, p.shippingCost);
    const paid = await this.effects.recomputePaid(tx, { id, total: t.total });
    return tx.purchase.update({ where: { id }, data: { subtotal: t.subtotal, total: t.total, ...paid } });
  }

  /** `POST /purchases` (Idempotency-Key required). */
  async create(input: CreatePurchaseInput): Promise<PurchaseView> {
    const purchasedAt = checkBusinessDate(input.purchasedAt, 'purchasedAt') ?? new Date();
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.checkSupplier(tx, input.supplierId);
      const lines = await resolveGdsLines(tx, input.items, { purchase: true });
      const tax = input.tax ?? 0;
      const shippingCost = input.shippingCost ?? 0;
      const t = totalsOf(input.items, tax, shippingCost);
      if ((input.amountPaid ?? 0) > t.total) throw validationError({ amountPaid: 'validation.range' });
      const number = await this.counter.next(tx, 'purchase');
      const p = await tx.purchase.create({
        data: {
          workspaceId: TenantContext.workspaceId(),
          number,
          supplierId: input.supplierId ?? null,
          status: input.status,
          supplierInvoiceRef: input.supplierInvoiceRef ?? null,
          subtotal: t.subtotal,
          tax,
          shippingCost,
          total: t.total,
          paymentMethod: input.paymentMethod ?? null,
          paymentStatus: deriveGdsPaymentStatus(0, t.total),
          notes: input.notes ?? null,
          createdById: TenantContext.get().userId!,
          purchasedAt,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          items: { create: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, quantity: l.quantity, unitCost: input.items[i]!.unitCost, total: l.quantity * input.items[i]!.unitCost })) },
        },
      });
      if ((input.amountPaid ?? 0) > 0) {
        await this.effects.addPayment(tx, p, { amount: input.amountPaid!, method: input.paymentMethod ?? 'cash', description: storedText('stored.cash.purchasePayment', { number: p.number }) });
        await this.writeTotals(tx, p.id);
      }
      return p.id;
    });
    return this.get(id);
  }

  /** `PATCH /purchases/:id`. */
  async update(id: string, input: UpdatePurchaseInput): Promise<PurchaseView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      if (p.status === 'cancelled') throw conflict({ reason: 'PURCHASE_CANCELLED', status: p.status });
      const structural = input.items !== undefined || input.supplierId !== undefined || input.tax !== undefined || input.shippingCost !== undefined;
      if (structural && p.status !== 'draft' && p.status !== 'pending') throw conflict({ reason: 'PURCHASE_LOCKED', status: p.status });
      if (input.supplierId !== undefined) await this.checkSupplier(tx, input.supplierId);
      const purchasedAt = checkBusinessDate(input.purchasedAt, 'purchasedAt');
      const data: Prisma.PurchaseUncheckedUpdateInput = {};
      if (input.supplierId !== undefined) data.supplierId = input.supplierId;
      if (input.tax !== undefined) data.tax = input.tax;
      if (input.shippingCost !== undefined) data.shippingCost = input.shippingCost;
      if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod;
      if (input.supplierInvoiceRef !== undefined) data.supplierInvoiceRef = input.supplierInvoiceRef;
      if (input.notes !== undefined) data.notes = input.notes;
      if (purchasedAt) data.purchasedAt = purchasedAt;
      if (input.expectedAt !== undefined) data.expectedAt = input.expectedAt ? new Date(input.expectedAt) : null;
      if (input.items) {
        const lines = await resolveGdsLines(tx, input.items, { purchase: true });
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchaseItem.createMany({ data: lines.map((l, i) => ({ purchaseId: id, productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, quantity: l.quantity, unitCost: input.items![i]!.unitCost, total: l.quantity * input.items![i]!.unitCost })) });
      }
      await tx.purchase.update({ where: { id }, data });
      const after = await this.writeTotals(tx, id);
      if (after.total < p.amountPaid) throw validationError({ items: 'validation.range' });
    });
    return this.get(id);
  }

  /** `DELETE /purchases/:id` — only while draft / pending and unpaid (04 §9). */
  async remove(id: string) {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      const entries = await tx.paymentEntry.count({ where: { sourceType: 'purchase', sourceId: id } });
      if ((p.status !== 'draft' && p.status !== 'pending') || p.amountPaid > 0 || entries > 0) throw new AppException('PURCHASE_DELETE_NOT_PENDING');
      await tx.purchase.delete({ where: { id } });
    });
  }

  /** `POST /purchases/:id/order` — "Commander": draft → pending. */
  async order(id: string): Promise<PurchaseView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      if (p.status !== 'draft') throw conflict({ reason: 'PURCHASE_NOT_DRAFT', status: p.status });
      await tx.purchase.update({ where: { id }, data: { status: 'pending' } });
    });
    return this.get(id);
  }

  /** `POST /purchases/:id/receive` (Idempotency-Key required). */
  async receive(id: string, input: ReceivePurchaseInput): Promise<{ data: PurchaseView; warnings: Warning[] }> {
    const warnings: Warning[] = [];
    const receivedAt = checkBusinessDate(input.receivedAt, 'receivedAt') ?? new Date();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      if (p.status === 'received') throw new AppException('PURCHASE_ALREADY_RECEIVED');
      if (p.status === 'cancelled') throw conflict({ reason: 'PURCHASE_CANCELLED', status: p.status });
      const total = input.items.reduce((s, i) => s + i.receivedQty, 0) + (input.newItems ?? []).reduce((s, i) => s + i.receivedQty, 0);
      if (total <= 0) throw validationError({ items: 'validation.required' });
      // the same line twice in one receipt is one mistake: refuse it
      if (new Set(input.items.map((i) => i.id)).size !== input.items.length) throw validationError({ items: 'validation.invalid' });
      for (const [n, it] of input.items.entries()) {
        const line = p.items.find((l) => l.id === it.id);
        if (!line) throw validationError({ [`items.${n}.id`]: 'validation.invalid' });
        const unitCost = it.unitCost ?? line.unitCost;
        await this.effects.receive(tx, p, { productId: line.productId, variantId: line.variantId, unitCost }, it.receivedQty);
        const received = line.receivedQty + it.receivedQty;
        const quantity = Math.max(line.quantity, received);
        if (received > line.quantity) warnings.push({ code: 'PURCHASE_OVER_RECEIVE', params: { ordered: line.quantity, received }, field: `items.${n}.receivedQty` });
        await tx.purchaseItem.update({ where: { id: line.id }, data: { receivedQty: received, quantity, unitCost, total: quantity * unitCost } });
      }
      if (input.newItems?.length) {
        const lines = await resolveGdsLines(tx, input.newItems.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.receivedQty })), { purchase: true, field: 'newItems' });
        for (const [n, l] of lines.entries()) {
          const it = input.newItems[n]!;
          await this.effects.receive(tx, p, { productId: l.productId, variantId: l.variantId, unitCost: it.unitCost }, it.receivedQty);
          // a line added at the receipt was ordered 0: the over-receipt warning tells the merchant the order was completed
          warnings.push({ code: 'PURCHASE_OVER_RECEIVE', params: { ordered: 0, received: it.receivedQty }, field: `newItems.${n}.receivedQty` });
          await tx.purchaseItem.create({ data: { purchaseId: id, productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, quantity: it.receivedQty, receivedQty: it.receivedQty, unitCost: it.unitCost, total: it.receivedQty * it.unitCost } });
        }
      }
      const items = await tx.purchaseItem.findMany({ where: { purchaseId: id } });
      const complete = items.every((i) => i.receivedQty >= i.quantity);
      await tx.purchase.update({
        where: { id },
        data: { status: complete ? 'received' : 'partial', receivedAt: complete ? receivedAt : null, ...(input.supplierInvoiceRef !== undefined ? { supplierInvoiceRef: input.supplierInvoiceRef } : {}) },
      });
      const after = await this.writeTotals(tx, id);
      if (input.paymentNow) {
        if (input.paymentNow.amount > after.total - after.amountPaid) throw validationError({ 'paymentNow.amount': 'validation.range' });
        await this.effects.addPayment(tx, after, { amount: input.paymentNow.amount, method: input.paymentNow.method, paidAt: receivedAt, description: storedText('stored.cash.purchaseOnReceipt', { number: after.number }) });
        await this.writeTotals(tx, id);
      }
    });
    return { data: await this.get(id), warnings };
  }

  /**
   * `POST /purchases/:id/cancel` (04 §20): received ⇒ 409 PURCHASE_ALREADY_RECEIVED. Nothing received ⇒ the payments and
   * their automatic rows are removed (04 §3). Partial ⇒ the received units stay in stock, the payments stay, the unpaid
   * rest is no longer due (a cancelled purchase is out of the supplier balance).
   */
  async cancel(id: string, input: CancelPurchaseInput): Promise<PurchaseView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      if (p.status === 'received') throw new AppException('PURCHASE_ALREADY_RECEIVED');
      if (p.status === 'cancelled') throw conflict({ reason: 'PURCHASE_CANCELLED', status: p.status });
      const receivedAny = p.items.some((i) => i.receivedQty > 0);
      if (!receivedAny) await this.effects.clearPayments(tx, id);
      await tx.purchase.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason ?? null } });
      await this.writeTotals(tx, id);
    });
    return this.get(id);
  }

  /** `POST /purchases/:id/payments` (Idempotency-Key required) — ≤ remaining. */
  async pay(id: string, input: GdsPaymentInput): Promise<PurchaseView> {
    const paidAt = checkBusinessDate(input.paidAt, 'paidAt');
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const p = await this.lock(tx, id);
      if (p.status === 'cancelled') throw new AppException('PURCHASE_CANCELLED_PAYMENT_LOCKED');
      if (input.amount > p.total - p.amountPaid) throw validationError({ amount: 'validation.range' });
      await this.effects.addPayment(tx, p, { amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidAt, description: storedText('stored.cash.purchaseSupplierPayment', { number: p.number }) });
      await this.writeTotals(tx, id);
    });
    return this.get(id);
  }

  /** Used by the supplier payment dialog (allocation already decided by SupplierService). */
  async payInTx(tx: Tx, id: string, input: GdsPaymentInput & { description: string }) {
    const p = await this.lock(tx, id);
    if (p.status === 'cancelled') throw new AppException('PURCHASE_CANCELLED_PAYMENT_LOCKED');
    if (input.amount > p.total - p.amountPaid) throw validationError({ amount: 'validation.range' });
    await this.effects.addPayment(tx, p, { amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidAt: input.paidAt ? new Date(input.paidAt) : undefined, description: input.description });
    return this.writeTotals(tx, id);
  }

  /** `POST /purchases/:id/duplicate` — a new draft with the same supplier, lines (ordered quantities and costs), tax, shipping. */
  async duplicate(id: string): Promise<PurchaseView> {
    const src = await this.row(id);
    const items = src.items.filter((i) => i.product.trackStock).map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitCost: i.unitCost }));
    if (!items.length) throw validationError({ items: 'validation.required' });
    return this.create({ supplierId: src.supplierId, items, tax: src.tax, shippingCost: src.shippingCost, paymentMethod: src.paymentMethod, notes: src.notes, status: 'draft' });
  }

  /** `GET /purchases/:id/print` → signed PDF link. */
  async print(id: string, lang?: string) {
    const l = this.printer.lang(lang);
    const t = GDS_LABELS[l];
    const p = await this.get(id);
    return this.printer.print(
      {
        lang: l,
        shopName: await this.printer.shopName(),
        title: t.purchase!,
        number: p.number,
        meta: [
          { label: t.supplier!, value: p.supplier?.name ?? '—' },
          { label: t.date!, value: dateLabel(p.purchasedAt) },
          ...(p.expectedAt ? [{ label: t.expected!, value: dateLabel(p.expectedAt) }] : []),
          ...(p.supplierInvoiceRef ? [{ label: t.invoice!, value: p.supplierInvoiceRef }] : []),
        ],
        columns: [
          { header: t.product!, width: 5 },
          { header: t.qty!, width: 1.2, align: 'right' },
          { header: t.received!, width: 1.2, align: 'right' },
          { header: t.unitCost!, width: 2, align: 'right' },
          { header: t.total!, width: 2, align: 'right' },
        ],
        rows: p.items.map((i) => [i.variantName ? `${i.productName} · ${i.variantName}` : i.productName, String(i.quantity), String(i.receivedQty), money(i.unitCost), money(i.total)]),
        totals: [
          { label: t.subtotal!, value: money(p.subtotal) },
          ...(p.tax ? [{ label: t.tax!, value: money(p.tax) }] : []),
          ...(p.shippingCost ? [{ label: t.shipping!, value: money(p.shippingCost) }] : []),
          { label: t.total!, value: money(p.total), bold: true },
          { label: t.paid!, value: money(p.amountPaid) },
          { label: t.remaining!, value: money(Math.max(0, p.total - p.amountPaid)) },
        ],
        note: p.notes,
      },
      p.number,
    );
  }
}
