// GDS-05 / 04 §20 — suppliers: CRUD, filters, detail sheet with purchases, balance (`totalSpent` excludes cancelled
// purchases — fix), soft delete blocked by purchases (`SUPPLIER_HAS_PURCHASES` → deactivate), supplier payment allocated
// to one purchase or to the oldest ones first (each part = PaymentEntry + locked cash row through PurchaseEffects).
import { Injectable } from '@nestjs/common';
import { SUPPLIER_SORTS, type CreateSupplierInput, type PurchasesQuery, type SupplierListItemView, type SupplierPaymentInput, type SuppliersQuery, type SupplierView, type UpdateSupplierInput } from '@djaber/shared';
import { prisma, Prisma, TenantContext, type Supplier, type Tx } from '@djaber/db';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { page, type Page } from '../../core/http/pagination';
import { action } from '../catalog/catalog.util';
import { iso, lockRow, rangeOf, sortOf } from './gds.util';
import { PURCHASE_INCLUDE, presentPurchaseListItem, PurchaseService } from './purchase.service';

type Agg = { supplierId: string; purchaseCount: number; totalSpent: number; balance: number; lastPurchaseAt: Date | null; count12m: number; total12m: number };
const YEAR_MS = 365 * 86_400_000;

@Injectable()
export class SupplierService {
  constructor(private readonly purchases: PurchaseService) {}

  /** Per supplier: purchases (draft and cancelled excluded), balance due, last purchase, last 12 months. */
  private async aggregates(ids?: string[]): Promise<Map<string, Agg>> {
    const ws = TenantContext.workspaceId();
    const since = new Date(Date.now() - YEAR_MS);
    const filter = ids ? Prisma.sql`AND "supplierId" = ANY(${ids}::uuid[])` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ supplierId: string; purchaseCount: number; totalSpent: number; balance: number; lastPurchaseAt: Date | null; count12m: number; total12m: number }[]>`
      SELECT "supplierId",
             count(*)::int AS "purchaseCount",
             COALESCE(sum("total"), 0)::int AS "totalSpent",
             COALESCE(sum(GREATEST("total" - "amountPaid", 0)), 0)::int AS "balance",
             max("purchasedAt") AS "lastPurchaseAt",
             (count(*) FILTER (WHERE "purchasedAt" >= ${since}))::int AS "count12m",
             COALESCE(sum("total") FILTER (WHERE "purchasedAt" >= ${since}), 0)::int AS "total12m"
      FROM "Purchase"
      WHERE "workspaceId" = ${ws}::uuid AND "supplierId" IS NOT NULL AND "status" NOT IN ('cancelled', 'draft') ${filter}
      GROUP BY "supplierId"`;
    return new Map(rows.map((r) => [r.supplierId, r]));
  }

  private actions(s: Pick<Supplier, 'isActive'>, purchaseCount: number) {
    return [
      action('open', 'gds.read', { primary: true }),
      action('edit', 'gds.write'),
      action('new_purchase', 'gds.write'),
      action('record_payment', 'gds.write'),
      s.isActive ? action('deactivate', 'gds.write') : action('activate', 'gds.write'),
      action('delete', 'gds.write', { reasonCode: purchaseCount > 0 ? 'SUPPLIER_HAS_PURCHASES' : undefined }),
    ];
  }

  private present(s: Supplier, a: Agg | undefined, allPurchases: number): SupplierListItemView {
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      isActive: s.isActive,
      purchaseCount: a?.purchaseCount ?? 0,
      purchases12m: { count: a?.count12m ?? 0, total: a?.total12m ?? 0 },
      totalSpent: a?.totalSpent ?? 0,
      balance: a?.balance ?? 0,
      lastPurchaseAt: iso(a?.lastPurchaseAt ?? null),
      createdAt: s.createdAt.toISOString(),
      actions: this.actions(s, allPurchases),
    };
  }

  async list(q: SuppliersQuery): Promise<Page<SupplierListItemView>> {
    const where: Prisma.SupplierWhereInput = { deletedAt: null };
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      where.OR = [{ name: contains }, { phone: { contains: q.q.replace(/\s/g, '') } }, { email: contains }];
    }
    const rows = await prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    const agg = await this.aggregates(rows.map((r) => r.id));
    const counts = await this.purchaseCounts(rows.map((r) => r.id));
    let items = rows.map((s) => this.present(s, agg.get(s.id), counts.get(s.id) ?? 0));
    if (q.hasBalance !== undefined) items = items.filter((i) => (i.balance > 0) === q.hasBalance);
    if (q.lastPurchase) {
      const r = rangeOf({ period: q.lastPurchase });
      items = items.filter((i) => i.lastPurchaseAt && (!r.gte || new Date(i.lastPurchaseAt) >= r.gte) && (!r.lt || new Date(i.lastPurchaseAt) < r.lt));
    }
    // aggregates are computed figures: the sort runs on the presented rows (a workspace has tens of suppliers, not thousands)
    const { field, dir } = sortOf(q.sort, SUPPLIER_SORTS, 'name');
    const key = (i: SupplierListItemView): string | number => (field === 'name' ? i.name.toLowerCase() : field === 'createdAt' ? i.createdAt : field === 'lastPurchaseAt' ? (i.lastPurchaseAt ?? '') : i[field]);
    items.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id);
      return dir === 'asc' ? c : -c;
    });
    const start = (q.page - 1) * q.pageSize;
    return page(items.slice(start, start + q.pageSize), items.length, q);
  }

  /** Every purchase of the supplier (drafts and cancelled included): what blocks a hard delete. */
  private async purchaseCounts(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await prisma.purchase.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.supplierId!, r._count._all]));
  }

  private async row(id: string) {
    const s = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw notFound();
    return s;
  }

  async get(id: string): Promise<SupplierView> {
    const s = await this.row(id);
    const [agg, counts, recent, received, products] = await Promise.all([
      this.aggregates([id]),
      this.purchaseCounts([id]),
      prisma.purchase.findMany({ where: { supplierId: id }, include: PURCHASE_INCLUDE, orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }], take: 5 }),
      prisma.purchase.findMany({ where: { supplierId: id, status: 'received', receivedAt: { not: null } }, select: { purchasedAt: true, receivedAt: true } }),
      prisma.purchaseItem.findMany({ where: { purchase: { supplierId: id, status: { not: 'cancelled' } } }, distinct: ['productId'], select: { productId: true } }),
    ]);
    const lead = received.length ? Math.round(received.reduce((n, p) => n + (p.receivedAt!.getTime() - p.purchasedAt.getTime()) / 86_400_000, 0) / received.length) : null;
    return {
      ...this.present(s, agg.get(id), counts.get(id) ?? 0),
      address: s.address,
      notes: s.notes,
      terms: s.terms,
      paymentTermsDays: s.paymentTermsDays,
      avgLeadDays: s.avgLeadDays,
      leadDaysMeasured: lead,
      productCount: products.length,
      recentPurchases: recent.map(presentPurchaseListItem),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /**
   * One supplier per phone and per e-mail (case-insensitive) among the live suppliers of the workspace — tester report
   * 2026-10-20 UX-003: the same supplier could be created several times and the purchases split between the copies.
   * The workspace's supplier writes are serialised so two simultaneous submissions cannot both pass the check.
   */
  private async assertUnique(tx: Tx, v: { phone?: string | null; email?: string | null }, exceptId?: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier:${TenantContext.workspaceId()}`}))`;
    const others = { deletedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
    const byPhone = v.phone ? await tx.supplier.findFirst({ where: { ...others, phone: v.phone }, select: { id: true, name: true } }) : null;
    if (byPhone) throw new AppException('SUPPLIER_ALREADY_EXISTS', { name: byPhone.name }, { phone: 'validation.supplier_taken' }, { supplierId: byPhone.id });
    const byEmail = v.email ? await tx.supplier.findFirst({ where: { ...others, email: { equals: v.email, mode: 'insensitive' } }, select: { id: true, name: true } }) : null;
    if (byEmail) throw new AppException('SUPPLIER_ALREADY_EXISTS', { name: byEmail.name }, { email: 'validation.supplier_taken' }, { supplierId: byEmail.id });
  }

  async create(input: CreateSupplierInput): Promise<SupplierView> {
    const id = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.assertUnique(tx, input);
      const s = await tx.supplier.create({
        data: {
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          avgLeadDays: input.avgLeadDays ?? null,
          isActive: input.isActive ?? true,
        } as Prisma.SupplierUncheckedCreateInput,
      });
      return s.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateSupplierInput): Promise<SupplierView> {
    await this.row(id);
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (input.phone || input.email) await this.assertUnique(tx, { phone: input.phone, email: input.email }, id);
      await tx.supplier.update({ where: { id }, data: input as Prisma.SupplierUpdateInput });
    });
    return this.get(id);
  }

  async setActive(id: string, isActive: boolean): Promise<SupplierView> {
    await this.row(id);
    await prisma.supplier.update({ where: { id }, data: { isActive } });
    return this.get(id);
  }

  /** `DELETE /suppliers/:id` — soft; refused while purchases exist (409 SUPPLIER_HAS_PURCHASES {count}). */
  async remove(id: string) {
    await this.row(id);
    const count = await prisma.purchase.count({ where: { supplierId: id } });
    if (count > 0) throw new AppException('SUPPLIER_HAS_PURCHASES', { count });
    await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async purchasesOf(id: string, q: PurchasesQuery) {
    await this.row(id);
    return this.purchases.list({ ...q, supplierId: [id] });
  }

  /**
   * `POST /suppliers/:id/payments` — 04 §20: to `purchaseId`, else spread over the purchases with something due, oldest
   * first. One payment entry (and its locked cash row) per purchase touched. More than what is due ⇒ 422 `fields.amount`.
   */
  async pay(id: string, input: SupplierPaymentInput) {
    await this.row(id);
    const allocations = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      if (!(await lockRow(tx, 'Supplier', id))) throw notFound();
      const due = await tx.purchase.findMany({
        where: { supplierId: id, status: { in: ['pending', 'partial', 'received'] }, ...(input.purchaseId ? { id: input.purchaseId } : {}) },
        orderBy: [{ purchasedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, number: true, total: true, amountPaid: true, status: true },
      });
      if (input.purchaseId && !due.length) {
        const other = await tx.purchase.findFirst({ where: { id: input.purchaseId, supplierId: id }, select: { status: true } });
        if (other?.status === 'cancelled') throw new AppException('PURCHASE_CANCELLED_PAYMENT_LOCKED');
        if (!other) throw validationError({ purchaseId: 'validation.invalid' });
      }
      const owing = due.filter((p) => p.total > p.amountPaid);
      const available = owing.reduce((s, p) => s + p.total - p.amountPaid, 0);
      if (input.amount > available) throw validationError({ amount: 'validation.range' });
      let left = input.amount;
      const parts: { purchaseId: string; number: string; amount: number }[] = [];
      for (const p of owing) {
        if (left <= 0) break;
        const amount = Math.min(left, p.total - p.amountPaid);
        await this.purchases.payInTx(tx, p.id, { amount, method: input.method, reference: input.reference, note: input.note, paidAt: input.paidAt, description: `Paiement fournisseur — Achat #${p.number}` });
        parts.push({ purchaseId: p.id, number: p.number, amount });
        left -= amount;
      }
      return parts;
    });
    return { supplier: await this.get(id), allocations };
  }
}
