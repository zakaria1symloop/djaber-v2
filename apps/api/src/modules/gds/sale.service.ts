// GDS-07 / 04 §20 — counter sales `VNT-…`: client link (fix), variant required, partial payment only with a client,
// immutable after validation (cancel + redo), cancel ≤ 7 d with restock and refund, "Encaisser le reste", delete only
// unpaid, ticket PDF. Blocked by an open blocking inventory count (04 §19). Effects only through SaleEffects.
import { Injectable } from '@nestjs/common';
import { deriveGdsPaymentStatus, SALE_CANCEL_MAX_DAYS, SALE_SORTS, storedText, type CancelSaleInput, type CreateSaleInput, type SaleClientInput, type SaleListItemView, type SalePaymentInput, type SalesQuery, type SaleStatsView, type SaleView, type UpdateSaleInput } from '@djaber/shared';
import { prisma, TenantContext, type Prisma, type Sale, type Tx } from '@djaber/db';
import { CounterService } from '../../core/counter/counter.service';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { lastDays } from '../../core/time/period';
import { action } from '../catalog/catalog.util';
import { ClientService } from '../clients/client.service';
import { clientRefOf } from '../orders/order.presenter';
import { dateLabel, GDS_LABELS, money } from './gds-document.pdf';
import { resolveGdsLines } from './gds-lines';
import { GdsPrintService } from './gds-print.service';
import { checkBusinessDate, dateWhere, deltaPct, iso, lockRow, paymentsOf, PRODUCT_REF_SELECT, productRef, rangeOf, sortOf, USER_SELECT, userRef } from './gds.util';
import { SaleEffects } from './sale-effects.service';

const DAY_MS = 86_400_000;
const CLIENT_SELECT = { id: true, name: true, phone: true, riskLevel: true, isPlaceholder: true, orderCount: true } as const;
export const SALE_INCLUDE = {
  client: { select: CLIENT_SELECT },
  items: { orderBy: { id: 'asc' }, include: { product: { select: PRODUCT_REF_SELECT } } },
  createdBy: { select: USER_SELECT },
  cancelledBy: { select: USER_SELECT },
} satisfies Prisma.SaleInclude;
type SaleRow = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

export const cancellableUntil = (s: Pick<Sale, 'soldAt'>) => new Date(s.soldAt.getTime() + SALE_CANCEL_MAX_DAYS * DAY_MS);
const remainingOf = (s: Pick<Sale, 'status' | 'total' | 'amountPaid'>) => (s.status === 'completed' ? Math.max(0, s.total - s.amountPaid) : 0);

/** Row menu of a sale (contract-ready.md "Sales"). */
export const saleActions = (s: Pick<Sale, 'status' | 'total' | 'amountPaid' | 'soldAt' | 'clientId'>) => {
  if (s.status === 'draft') return [action('validate', 'gds.write', { primary: true }), action('edit', 'gds.write'), action('delete', 'gds.write')];
  if (s.status === 'cancelled') return [action('open', 'gds.read', { primary: true }), action('receipt', 'gds.read')];
  const remaining = remainingOf(s);
  return [
    ...(remaining > 0 ? [action('collect', 'gds.write', { primary: true })] : []),
    action('open', 'gds.read', { primary: remaining === 0 }),
    action('receipt', 'gds.read'),
    ...(!s.clientId ? [action('link_client', 'gds.write')] : []),
    action('edit', 'gds.write'),
    action('cancel', 'gds.write', { reasonCode: Date.now() > cancellableUntil(s).getTime() ? 'SALE_CANNOT_CANCEL_AFTER_7D' : undefined }),
    action('delete', 'gds.write', { reasonCode: s.amountPaid > 0 ? 'SALE_DELETE_PAID' : undefined }),
  ];
};

type LineIn = { productId: string; variantId?: string | null; quantity: number; unitPrice?: number; discount?: number };
type PricedLine = Awaited<ReturnType<typeof resolveGdsLines>>[number] & { unitPrice: number; discount: number; total: number };

@Injectable()
export class SaleService {
  constructor(
    private readonly effects: SaleEffects,
    private readonly counter: CounterService,
    private readonly clients: ClientService,
    private readonly printer: GdsPrintService,
  ) {}

  // --- reading ------------------------------------------------------------------------------------------------------------
  private async blockedClients(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await prisma.customerBlock.findMany({ where: { clientId: { in: ids }, unblockedAt: null }, select: { clientId: true } });
    return new Set(rows.map((r) => r.clientId!).filter(Boolean));
  }

  private listItem(s: SaleRow, blocked: Set<string>): SaleListItemView {
    return {
      id: s.id,
      number: s.number,
      client: s.client ? clientRefOf(s.client, blocked.has(s.client.id)) : null,
      customerName: s.client ? null : s.customerName,
      status: s.status,
      items: s.items.map((i) => ({ name: i.productName, variant: i.variantName, qty: i.quantity })),
      itemCount: s.items.length,
      total: s.total,
      amountPaid: s.amountPaid,
      remaining: remainingOf(s),
      paymentStatus: s.paymentStatus,
      paymentMethod: s.paymentMethod,
      seller: userRef(s.createdBy),
      soldAt: s.soldAt.toISOString(),
      actions: saleActions(s),
    };
  }

  where(q: Partial<SalesQuery>): Prisma.SaleWhereInput {
    const and: Prisma.SaleWhereInput[] = [];
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.paymentStatus?.length) and.push({ paymentStatus: { in: q.paymentStatus } });
    if (q.createdById?.length) and.push({ createdById: { in: q.createdById } });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.productId) and.push({ items: { some: { productId: q.productId } } });
    if (q.hasRemaining === true) and.push({ status: 'completed', paymentStatus: { in: ['unpaid', 'partial'] } });
    const dates = dateWhere(q);
    if (dates) and.push({ soldAt: dates });
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ number: contains }, { customerName: contains }, { client: { name: contains } }, { client: { phone: { contains: q.q.replace(/\s/g, '') } } }, { items: { some: { productName: contains } } }] });
    }
    return { AND: and };
  }

  async list(q: SalesQuery): Promise<Page<SaleListItemView>> {
    const { field, dir } = sortOf(q.sort, SALE_SORTS, '-soldAt');
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      prisma.sale.findMany({ where, include: SALE_INCLUDE, orderBy: [{ [field]: dir }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.sale.count({ where }),
    ]);
    const blocked = await this.blockedClients(rows.map((r) => r.clientId).filter((x): x is string => !!x));
    return page(rows.map((r) => this.listItem(r, blocked)), total, q);
  }

  /** `[FIG GDS-08 KPIs]` — completed sales of the period (30 d by default) following the other filters. */
  async stats(q: Partial<SalesQuery>): Promise<SaleStatsView> {
    const base = this.where({ ...q, period: undefined, from: undefined, to: undefined, status: undefined });
    const range = q.period || q.from || q.to ? rangeOf(q) : lastDays(30).current;
    const now = new Date();
    const span = (range.lt ?? now).getTime() - (range.gte ?? new Date(0)).getTime();
    const window = (gte: Date | null, lt: Date | null): Prisma.SaleWhereInput => ({ AND: [base, { status: 'completed' }, { soldAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } }] });
    const [cur, prev, partial] = await Promise.all([
      prisma.sale.aggregate({ where: window(range.gte, range.lt), _sum: { total: true }, _count: { _all: true } }),
      range.gte ? prisma.sale.aggregate({ where: window(new Date(range.gte.getTime() - span), range.gte), _sum: { total: true }, _count: { _all: true } }) : null,
      prisma.sale.findMany({ where: { AND: [window(range.gte, range.lt), { paymentStatus: { in: ['unpaid', 'partial'] } }] }, select: { total: true, amountPaid: true } }),
    ]);
    const count = cur._count._all;
    const revenue = cur._sum.total ?? 0;
    const avg = count ? Math.round(revenue / count) : 0;
    const prevCount = prev?._count._all ?? 0;
    const prevAvg = prevCount ? Math.round((prev?._sum.total ?? 0) / prevCount) : 0;
    return {
      count,
      revenue,
      partialCount: partial.length,
      remaining: partial.reduce((s, p) => s + Math.max(0, p.total - p.amountPaid), 0),
      averageBasket: avg,
      averageBasketPrevious: prevAvg,
      averageBasketDeltaPct: deltaPct(avg, prevAvg),
    };
  }

  private async row(id: string, db: Tx | typeof prisma = prisma): Promise<SaleRow> {
    const s = await db.sale.findFirst({ where: { id }, include: SALE_INCLUDE });
    if (!s) throw notFound();
    return s;
  }

  async get(id: string): Promise<SaleView> {
    const s = await this.row(id);
    const [payments, blocked] = await Promise.all([paymentsOf('sale', [id]), this.blockedClients(s.clientId ? [s.clientId] : [])]);
    const { items: _items, ...head } = this.listItem(s, blocked);
    return {
      ...head,
      customerPhone: s.client ? null : s.customerPhone,
      items: s.items.map((i) => ({
        id: i.id,
        product: productRef(i.product),
        variantId: i.variantId,
        productName: i.productName,
        variantName: i.variantName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        catalogPrice: i.catalogPrice !== null && i.catalogPrice !== i.unitPrice ? i.catalogPrice : null,
        costPrice: i.costPrice,
        discount: i.discount,
        total: i.total,
      })),
      subtotal: s.subtotal,
      discount: s.discount,
      tax: s.tax,
      payments: payments.get(id) ?? [],
      notes: s.notes,
      cancelReason: s.cancelReason,
      cancelledAt: iso(s.cancelledAt),
      cancelledBy: userRef(s.cancelledBy),
      stockRestored: s.stockRestored,
      cancellableUntil: cancellableUntil(s).toISOString(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  // --- writing ------------------------------------------------------------------------------------------------------------
  private async lock(tx: Tx, id: string) {
    if (!(await lockRow(tx, 'Sale', id))) throw notFound();
    return tx.sale.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { id: 'asc' }, include: { product: { select: { trackStock: true } } } } } });
  }

  /** 04 §19: `blockCounterSales` on an open count ⇒ 409 SALE_BLOCKED_BY_INVENTORY (orders and the AI are never blocked). */
  private async assertNotBlocked(tx: Tx) {
    const count = await tx.inventoryCount.findFirst({ where: { status: { in: ['draft', 'counting'] }, blockCounterSales: true }, select: { id: true } });
    if (count) throw new AppException('SALE_BLOCKED_BY_INVENTORY');
  }

  private async price(tx: Tx, items: LineIn[]): Promise<PricedLine[]> {
    const lines = await resolveGdsLines(tx, items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })));
    return lines.map((l, n) => {
      const unitPrice = items[n]!.unitPrice ?? l.price;
      const discount = items[n]!.discount ?? 0;
      if (discount > unitPrice * l.quantity) throw validationError({ [`items.${n}.discount`]: 'validation.range' });
      return { ...l, unitPrice, discount, total: unitPrice * l.quantity - discount };
    });
  }

  /** 04 §4: `sale.total = subtotal − discount + tax`. */
  private totals(lines: PricedLine[], discount: number, tax: number) {
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    if (discount > subtotal) throw validationError({ discount: 'validation.range' });
    return { subtotal, total: subtotal - discount + tax };
  }

  private async client(tx: Tx, input: { clientId?: string | null; client?: { name: string; phone: string } | null }) {
    if (input.clientId) {
      const c = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null }, select: { id: true } });
      if (!c) throw validationError({ clientId: 'validation.invalid' });
      return c.id;
    }
    if (input.client) return (await this.clients.resolveForOrder(tx, input.client, { source: 'manual' })).client.id;
    return null;
  }

  /** Validation of a sale (creation as completed, or a draft validated): stock out, first payment, aggregates. */
  private async complete(tx: Tx, sale: Sale, lines: PricedLine[], amountPaid: number) {
    await this.assertNotBlocked(tx);
    // 04 §20: a partial payment needs an identified client (the rest is collected later from the list)
    if (amountPaid < sale.total && !sale.clientId) throw new AppException('SALE_PARTIAL_REQUIRES_CUSTOMER', {}, { clientId: 'validation.required' });
    await this.effects.syncStock(tx, sale, lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, trackStock: l.trackStock })));
    const paid = Math.min(amountPaid, sale.total);
    if (paid > 0) await this.effects.addPayment(tx, sale, { amount: paid, method: sale.paymentMethod, paidAt: sale.soldAt, description: storedText(paid < sale.total ? 'stored.cash.saleDeposit' : 'stored.cash.sale', { number: sale.number }) });
    await tx.sale.update({ where: { id: sale.id }, data: { status: 'completed', ...(await this.effects.recomputePaid(tx, sale)) } });
    await this.effects.recomputeClient(tx, sale.clientId);
  }

  /** `POST /sales` (Idempotency-Key required). */
  async create(input: CreateSaleInput): Promise<SaleView> {
    const soldAt = checkBusinessDate(input.soldAt, 'soldAt') ?? new Date();
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertNotBlocked(tx);
      const clientId = await this.client(tx, input);
      const lines = await this.price(tx, input.items);
      const t = this.totals(lines, input.discount ?? 0, input.tax ?? 0);
      const number = await this.counter.next(tx, 'sale');
      const sale = await tx.sale.create({
        data: {
          workspaceId: TenantContext.workspaceId(),
          number,
          clientId,
          customerName: input.client?.name ?? null,
          customerPhone: input.client?.phone ?? null,
          status: 'draft',
          subtotal: t.subtotal,
          discount: input.discount ?? 0,
          tax: input.tax ?? 0,
          total: t.total,
          paymentMethod: input.paymentMethod,
          paymentStatus: deriveGdsPaymentStatus(0, t.total),
          notes: input.notes ?? null,
          createdById: TenantContext.get().userId!,
          soldAt,
          items: { create: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, quantity: l.quantity, unitPrice: l.unitPrice, catalogPrice: l.price, costPrice: l.costPrice, discount: l.discount, total: l.total })) },
        },
      });
      if (input.status === 'completed') await this.complete(tx, sale, lines, input.amountPaid);
      return sale.id;
    });
    return this.get(id);
  }

  /** `PATCH /sales/:id` — draft: everything (+ `status=completed`); completed: notes / paymentMethod; else SALE_IMMUTABLE. */
  async update(id: string, input: UpdateSaleInput): Promise<SaleView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const s = await this.lock(tx, id);
      if (s.status === 'cancelled') throw new AppException('SALE_IMMUTABLE');
      if (s.status === 'completed') {
        const locked = input.items !== undefined || input.discount !== undefined || input.tax !== undefined || input.clientId !== undefined || !!input.client || input.amountPaid !== undefined || input.soldAt !== undefined;
        if (locked) throw new AppException('SALE_IMMUTABLE');
        await tx.sale.update({ where: { id }, data: { ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}) } });
        return;
      }
      const soldAt = checkBusinessDate(input.soldAt, 'soldAt');
      // a new client typed while finishing a draft is found by phone or created, as on `POST /sales`
      const clientId = input.client ? await this.client(tx, { client: input.client }) : input.clientId !== undefined ? await this.client(tx, { clientId: input.clientId }) : s.clientId;
      const items: LineIn[] = input.items ?? s.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount }));
      const lines = await this.price(tx, items);
      const discount = input.discount ?? s.discount;
      const tax = input.tax ?? s.tax;
      const t = this.totals(lines, discount, tax);
      if (input.items) {
        await tx.saleItem.deleteMany({ where: { saleId: id } });
        await tx.saleItem.createMany({ data: lines.map((l) => ({ saleId: id, productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, quantity: l.quantity, unitPrice: l.unitPrice, catalogPrice: l.price, costPrice: l.costPrice, discount: l.discount, total: l.total })) });
      }
      const updated = await tx.sale.update({
        where: { id },
        data: {
          clientId,
          ...(input.client ? { customerName: input.client.name, customerPhone: input.client.phone } : {}),
          subtotal: t.subtotal,
          discount,
          tax,
          total: t.total,
          paymentStatus: deriveGdsPaymentStatus(0, t.total),
          ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(soldAt ? { soldAt } : {}),
        },
      });
      if (input.status === 'completed') await this.complete(tx, updated, lines, input.amountPaid ?? 0);
    });
    return this.get(id);
  }

  /** `DELETE /sales/:id` — only when no money was taken (04 §9, 422 SALE_DELETE_PAID); the stock taken is given back. */
  async remove(id: string) {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const s = await this.lock(tx, id);
      const entries = await tx.paymentEntry.count({ where: { sourceType: 'sale', sourceId: id } });
      if (s.amountPaid > 0 || entries > 0) throw new AppException('SALE_DELETE_PAID');
      if (s.status === 'completed') await this.effects.syncStock(tx, s, []);
      await tx.sale.delete({ where: { id } });
      await this.effects.recomputeClient(tx, s.clientId);
    });
  }

  /** `POST /sales/:id/payments` (Idempotency-Key required) — "Encaisser le reste": ≤ remaining. */
  async pay(id: string, input: SalePaymentInput): Promise<SaleView> {
    const paidAt = checkBusinessDate(input.paidAt, 'paidAt');
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const s = await this.lock(tx, id);
      if (s.status === 'cancelled') throw new AppException('SALE_IMMUTABLE');
      if (s.status === 'draft') throw conflict({ reason: 'SALE_DRAFT', status: s.status });
      if (input.amount > s.total - s.amountPaid) throw validationError({ amount: 'validation.range' });
      await this.effects.addPayment(tx, s, { amount: input.amount, method: input.method, reference: input.reference, note: input.note, paidAt, description: storedText('stored.cash.saleBalance', { number: s.number }) });
      await tx.sale.update({ where: { id }, data: await this.effects.recomputePaid(tx, s) });
    });
    return this.get(id);
  }

  /** `POST /sales/:id/cancel { reason, restoreStock, refund }` — ≤ 7 d after the sale (04 §20). */
  async cancel(id: string, input: CancelSaleInput): Promise<SaleView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const s = await this.lock(tx, id);
      if (s.status !== 'completed') throw conflict({ reason: 'SALE_NOT_COMPLETED', status: s.status });
      if (Date.now() > cancellableUntil(s).getTime()) throw new AppException('SALE_CANNOT_CANCEL_AFTER_7D');
      if (input.restoreStock) await this.effects.syncStock(tx, s, []);
      if (s.amountPaid > 0) {
        if (input.refund) await this.effects.refund(tx, s, input.reason);
        else await this.effects.clearPayments(tx, id);
      }
      const paid = input.refund ? {} : await this.effects.recomputePaid(tx, s);
      await tx.sale.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: TenantContext.get().userId ?? null, cancelReason: input.reason, stockRestored: input.restoreStock, ...paid } });
      await this.effects.recomputeClient(tx, s.clientId);
    });
    return this.get(id);
  }

  /** `POST /sales/:id/client { clientId }` — "Lier à un client" (both clients' aggregates recomputed). */
  async linkClient(id: string, input: SaleClientInput): Promise<SaleView> {
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const s = await this.lock(tx, id);
      if (s.status === 'cancelled') throw new AppException('SALE_IMMUTABLE');
      const clientId = await this.client(tx, { clientId: input.clientId });
      await tx.sale.update({ where: { id }, data: { clientId } });
      await this.effects.recomputeClient(tx, s.clientId);
      await this.effects.recomputeClient(tx, clientId);
    });
    return this.get(id);
  }

  /** `GET /sales/:id/receipt` → signed PDF ticket. */
  async receipt(id: string, lang?: string) {
    const l = this.printer.lang(lang);
    const t = GDS_LABELS[l];
    const s = await this.get(id);
    return this.printer.print(
      {
        lang: l,
        shopName: await this.printer.shopName(),
        title: t.sale!,
        number: s.number,
        meta: [
          { label: t.date!, value: dateLabel(s.soldAt) },
          { label: t.client!, value: s.client?.name ?? s.customerName ?? t.walkIn! },
          ...(s.seller ? [{ label: t.seller!, value: `${s.seller.firstName} ${s.seller.lastName}`.trim() }] : []),
        ],
        columns: [
          { header: t.product!, width: 5 },
          { header: t.qty!, width: 1.2, align: 'right' },
          { header: t.unitPrice!, width: 2, align: 'right' },
          { header: t.total!, width: 2, align: 'right' },
        ],
        rows: s.items.map((i) => [i.variantName ? `${i.productName} · ${i.variantName}` : i.productName, String(i.quantity), money(i.unitPrice), money(i.total)]),
        totals: [
          { label: t.subtotal!, value: money(s.subtotal) },
          ...(s.discount ? [{ label: t.discount!, value: `-${money(s.discount)}` }] : []),
          ...(s.tax ? [{ label: t.tax!, value: money(s.tax) }] : []),
          { label: t.total!, value: money(s.total), bold: true },
          { label: t.paid!, value: money(s.amountPaid) },
          ...(s.remaining ? [{ label: t.remaining!, value: money(s.remaining) }] : []),
        ],
        note: s.notes,
      },
      s.number,
    );
  }
}
