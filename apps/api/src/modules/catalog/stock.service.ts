// 04 §3 — the only place where a quantity changes (CLAUDE.md rule 5): every change writes a `StockMovement` with
// before / after, the parent of a variant is recomputed (Σ active variants, never incremented) and low-stock is evaluated.
// CAT-05 / GDS-02 / GDS-03: manual adjustments, the movement journal, reversal, the stock dashboard and the snapshot.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma, Prisma, TenantContext, type MovementReason, type MovementRefType, type MovementType, type StockMovement, type Tx } from '@djaber/db';
import { MovementTypeValues, type MovementStatsView, type StockAdjustmentInput, type StockMovementView, type StockPurchasingView } from '@djaber/shared';
import { can } from '../../core/rbac/permission-matrix';
import { AppException, notFound } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { originSessionId } from '../../core/tenancy/tenant.guard';
import { OutboxService } from '../../core/outbox/outbox.service';
import { algiersDay, algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { ExportService } from '../jobs/export.service';
import { action, likePattern, stockStateOf } from './catalog.util';
import type { MovementsQuery, SnapshotQuery } from './dto';
import { LowStockEvaluator } from './low-stock.evaluator';
import { thumbUrlOf } from './product-image.util';

export type MoveInput = {
  productId: string;
  variantId?: string | null;
  /** relative change, or the exact quantity wanted */
  change: { delta: number } | { setTo: number };
  /** defaults to `adjustment_in` / `adjustment_out` by the sign of the change */
  type?: MovementType;
  reason: MovementReason;
  note?: string | null;
  refType?: MovementRefType | null;
  refId?: string | null;
  actorId?: string | null;
  /** Admin+ `force`: the quantity may go below zero */
  allowNegative?: boolean;
  /** throw STOCK_QUANTITY_ZERO instead of silently doing nothing when the quantity does not change */
  requireChange?: boolean;
  /** bulk writers (import) emit their own events */
  silent?: boolean;
  /** the refusal of a decrement below zero (order lines: ORDER_INSUFFICIENT_STOCK, 11 §6 usage rule) */
  insufficient?: (available: number, product: { name: string }) => AppException;
};
export type MoveResult = { movement: StockMovement | null; before: number; after: number; productStock: number };

type ProductLock = { id: string; name: string; sku: string; trackStock: boolean; sellOutOfStock: boolean; hasVariants: boolean; stock: number | null; minStock: number; isActive: boolean; moderationStatus: string };
type VariantLock = { id: string; name: string; sku: string | null; stock: number; minStock: number };

const MOVEMENT_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, price: true, hasVariants: true, trackStock: true, images: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
  variant: { select: { id: true, name: true } },
  actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
  reverses: { select: { id: true } },
} satisfies Prisma.StockMovementInclude;
type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

/** Movements a person may counter-pass: the manual ones. The others belong to their document (order, sale, purchase, count). */
const REVERSIBLE_REF: (MovementRefType | null)[] = [null, 'manual', 'import'];
const SORTS = ['createdAt'] as const;

/**
 * Units held by orders still `new` (owner decision 2026-10-21, tester report 2026-10-20): an unconfirmed order reserves
 * its quantities without a movement, its `out` movement is written when it is confirmed. Orders created before that
 * rule already moved their stock: what they moved is subtracted, so nothing is counted twice. Key `productId:variantId`.
 */
export async function reservedQuantities(db: Tx | typeof prisma, productIds: string[], exceptOrderIds: string[] = []): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const ws = TenantContext.workspaceId();
  const except = exceptOrderIds.length ? Prisma.sql`AND NOT (o."id" = ANY(${exceptOrderIds}::uuid[]))` : Prisma.empty;
  const rows = await (db as typeof prisma).$queryRaw<{ productId: string; variantId: string | null; reserved: number }[]>`
    SELECT x."productId", x."variantId", sum(GREATEST(x.qty + COALESCE(m.moved, 0), 0))::int AS reserved
    FROM (
      SELECT i."orderId", i."productId", i."variantId", sum(i."quantity")::int AS qty
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE o."workspaceId" = ${ws}::uuid AND o."status" = 'new' AND i."productId" = ANY(${productIds}::uuid[]) ${except}
      GROUP BY 1, 2, 3
    ) x
    LEFT JOIN (
      SELECT "refId" AS "orderId", "productId", "variantId", sum("quantity")::int AS moved
      FROM "StockMovement" WHERE "refType" = 'order' AND "productId" = ANY(${productIds}::uuid[])
      GROUP BY 1, 2, 3
    ) m ON m."orderId" = x."orderId" AND m."productId" = x."productId" AND m."variantId" IS NOT DISTINCT FROM x."variantId"
    GROUP BY 1, 2`;
  return new Map(rows.filter((r) => r.reserved > 0).map((r) => [`${r.productId}:${r.variantId ?? ''}`, r.reserved]));
}


@Injectable()
export class StockService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly lowStock: LowStockEvaluator,
    private readonly exports: ExportService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('movements', (filters, ctx) => this.exportTable(filters as MovementsQuery, ctx.locale));
  }

  // --- the stock writer ---------------------------------------------------------------------------------------------------
  /** Row-locks the product (and the variant), applies the change, writes the movement. Must run inside a transaction. */
  async move(tx: Tx, input: MoveInput): Promise<MoveResult> {
    const ws = TenantContext.workspaceId();
    const [product] = await tx.$queryRaw<ProductLock[]>`
      SELECT "id","name","sku","trackStock","sellOutOfStock","hasVariants","stock","minStock","isActive","moderationStatus"::text AS "moderationStatus"
      FROM "Product" WHERE "id" = ${input.productId}::uuid AND "workspaceId" = ${ws}::uuid FOR UPDATE`;
    if (!product) throw notFound();
    if (!product.trackStock) throw new AppException('PRODUCT_NOT_STOCK_TRACKED');
    if (product.hasVariants && !input.variantId) throw new AppException('PRODUCT_HAS_VARIANTS');

    let variant: VariantLock | undefined;
    if (input.variantId) {
      [variant] = await tx.$queryRaw<VariantLock[]>`
        SELECT "id","name","sku","stock","minStock" FROM "ProductVariant"
        WHERE "id" = ${input.variantId}::uuid AND "productId" = ${product.id}::uuid AND "workspaceId" = ${ws}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      if (!variant) throw new AppException('VARIANT_NOT_FOUND');
    }

    const before = variant ? variant.stock : (product.stock ?? 0);
    const after = 'setTo' in input.change ? input.change.setTo : before + input.change.delta;
    const delta = after - before;
    if (delta === 0) {
      if (input.requireChange) throw new AppException('STOCK_QUANTITY_ZERO', {}, { quantity: 'validation.quantity' });
      return { movement: null, before, after, productStock: product.stock ?? 0 };
    }
    // a product sold at zero stock (PV 22/10) goes below 0 for an order (backorder); every other movement keeps the rule
    const backorder = product.sellOutOfStock && input.refType === 'order';
    if (after < 0 && !input.allowNegative && !backorder) throw input.insufficient?.(before, { name: variant ? `${product.name} · ${variant.name}` : product.name }) ?? new AppException('STOCK_INSUFFICIENT', { available: before }, { quantity: 'validation.quantity' });

    let productStock = after;
    if (variant) {
      await tx.productVariant.update({ where: { id: variant.id }, data: { stock: after } });
      productStock = await this.recomputeProductStock(tx, product.id);
    } else {
      await tx.product.update({ where: { id: product.id }, data: { stock: after } });
    }
    const movement = await tx.stockMovement.create({
      data: {
        productId: product.id,
        variantId: variant?.id ?? null,
        type: input.type ?? (delta > 0 ? 'adjustment_in' : 'adjustment_out'),
        quantity: delta,
        quantityBefore: before,
        quantityAfter: after,
        reason: input.reason,
        note: input.note ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        actorId: input.actorId === undefined ? (TenantContext.get().userId ?? null) : input.actorId,
        // wall clock, not the transaction start (`now()`): several movements of one transaction keep their order in the journal
        createdAt: new Date(),
      } as Prisma.StockMovementUncheckedCreateInput,
    });
    if (!input.silent) {
      await this.lowStock.evaluate(tx, { product, variant, before, after });
      await this.emitProductUpdated(tx, product.id);
    }
    return { movement, before, after, productStock };
  }

  /** Units held by unconfirmed orders (see `reservedQuantities`). */
  reservedQty(db: Tx | typeof prisma, productIds: string[], exceptOrderIds: string[] = []) {
    return reservedQuantities(db, productIds, exceptOrderIds);
  }

  /**
   * Checks that an order still `new` can hold `lines` (quantity ≤ stock − what the other unconfirmed orders hold), the
   * product / variant rows locked in a stable order so two orders cannot take the same last unit. Nothing is written.
   */
  async reserve(tx: Tx, orderId: string, lines: { productId: string; variantId: string | null; quantity: number }[], insufficient: (available: number, p: { name: string; productId: string; variantId: string | null }) => Error, releasing: string[] = []) {
    const want = new Map<string, { productId: string; variantId: string | null; qty: number }>();
    for (const l of lines) {
      const k = `${l.productId}:${l.variantId ?? ''}`;
      const cur = want.get(k);
      want.set(k, { productId: l.productId, variantId: l.variantId, qty: (cur?.qty ?? 0) + l.quantity });
    }
    if (!want.size) return;
    const ws = TenantContext.workspaceId();
    const keys = [...want.values()].sort((a, b) => a.productId.localeCompare(b.productId) || (a.variantId ?? '').localeCompare(b.variantId ?? ''));
    // what this order already moved (an order of before the rule): only the rest needs to be available
    const moved = await tx.stockMovement.groupBy({ by: ['productId', 'variantId'], where: { refType: 'order', refId: orderId }, _sum: { quantity: true } });
    const own = new Map(moved.map((m) => [`${m.productId}:${m.variantId ?? ''}`, -(m._sum.quantity ?? 0)]));
    // `releasing`: an order this one replaces (A9) — its units are given back when the new order is in
    const held = await this.reservedQty(tx, [...new Set(keys.map((k) => k.productId))], [orderId, ...releasing]);
    for (const k of keys) {
      const [product] = await tx.$queryRaw<ProductLock[]>`
        SELECT "id","name","sku","trackStock","sellOutOfStock","hasVariants","stock","minStock","isActive","moderationStatus"::text AS "moderationStatus"
        FROM "Product" WHERE "id" = ${k.productId}::uuid AND "workspaceId" = ${ws}::uuid FOR UPDATE`;
      // not tracked, or sold at zero stock (PV 22/10): nothing to hold
      if (!product || !product.trackStock || product.sellOutOfStock) continue;
      let stock = product.stock ?? 0;
      let name = product.name;
      if (k.variantId) {
        const [variant] = await tx.$queryRaw<VariantLock[]>`SELECT "id","name","sku","stock","minStock" FROM "ProductVariant" WHERE "id" = ${k.variantId}::uuid AND "productId" = ${product.id}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
        if (!variant) throw new AppException('VARIANT_NOT_FOUND');
        stock = variant.stock;
        name = `${product.name} · ${variant.name}`;
      }
      const key = `${k.productId}:${k.variantId ?? ''}`;
      const need = k.qty - (own.get(key) ?? 0);
      const available = stock - (held.get(key) ?? 0);
      if (need > 0 && need > available) throw insufficient(Math.max(0, available), { name, productId: k.productId, variantId: k.variantId });
    }
  }

  /**
   * A journal line that does not change the quantity (04 §21: a return without restock leaves a `loss` trail of the
   * units that will not come back). quantity = 0, before = after = the current quantity.
   */
  async trail(tx: Tx, input: { productId: string; variantId?: string | null; type: MovementType; reason: MovementReason; note: string; refType: MovementRefType; refId: string; actorId?: string | null }) {
    const product = await tx.product.findFirst({ where: { id: input.productId }, select: { id: true, stock: true, trackStock: true } });
    if (!product || !product.trackStock) return null;
    const variant = input.variantId ? await tx.productVariant.findFirst({ where: { id: input.variantId }, select: { stock: true } }) : null;
    const current = variant ? variant.stock : (product.stock ?? 0);
    return tx.stockMovement.create({
      data: {
        productId: product.id,
        variantId: input.variantId ?? null,
        type: input.type,
        quantity: 0,
        quantityBefore: current,
        quantityAfter: current,
        reason: input.reason,
        note: input.note,
        refType: input.refType,
        refId: input.refId,
        actorId: input.actorId === undefined ? (TenantContext.get().userId ?? null) : input.actorId,
        createdAt: new Date(),
      } as Prisma.StockMovementUncheckedCreateInput,
    });
  }

  /**
   * Opening quantities of products that hold their own stock, set-based (import commit: up to 2 000 rows in two
   * statements): the quantity is added and one `in` movement per product is written with before / after.
   */
  async openingStock(tx: Tx, lines: { productId: string; quantity: number }[], ref: { reason: MovementReason; refType: MovementRefType; refId?: string | null }) {
    const rows = lines.filter((l) => l.quantity > 0);
    if (!rows.length) return 0;
    const t = TenantContext.get();
    const ids = rows.map((r) => r.productId);
    const qty = rows.map((r) => r.quantity);
    return tx.$executeRaw`
      WITH upd AS (
        UPDATE "Product" p SET "stock" = COALESCE(p."stock", 0) + x.qty
        FROM unnest(${ids}::uuid[], ${qty}::int[]) AS x(id, qty)
        WHERE p."id" = x.id AND p."workspaceId" = ${t.workspaceId}::uuid AND p."trackStock" AND NOT p."hasVariants"
        RETURNING p."id" AS id, p."stock" AS after, x.qty AS qty
      )
      INSERT INTO "StockMovement" ("id","workspaceId","productId","type","quantity","quantityBefore","quantityAfter","reason","refType","refId","actorId","createdAt")
      SELECT uuid_generate_v7(), ${t.workspaceId}::uuid, upd.id, 'in'::"MovementType", upd.qty, upd.after - upd.qty, upd.after,
             ${ref.reason}::"MovementReason", ${ref.refType}::"MovementRefType", ${ref.refId ?? null}::uuid, ${t.userId ?? null}::uuid, now()
      FROM upd`;
  }

  /** CAT-03: product stock = Σ stock of its active, live variants (recomputed, never incremented). */
  async recomputeProductStock(tx: Tx, productId: string): Promise<number> {
    const sum = await tx.productVariant.aggregate({ where: { productId, deletedAt: null, isActive: true }, _sum: { stock: true } });
    const stock = sum._sum.stock ?? 0;
    await tx.product.update({ where: { id: productId }, data: { stock } });
    return stock;
  }

  /** WS `product.updated { product: { id, stock, isActive, moderationStatus, lowStock } }` (03-events §2). */
  async emitProductUpdated(tx: Tx, productId: string) {
    const p = await tx.product.findFirst({
      where: { id: productId },
      select: { id: true, stock: true, minStock: true, trackStock: true, isActive: true, moderationStatus: true, deletedAt: true, variants: { where: { deletedAt: null, isActive: true }, select: { stock: true, minStock: true } } },
    });
    if (!p) return;
    const lowStock = p.trackStock && ((p.stock ?? 0) <= p.minStock || p.variants.some((v) => v.stock <= v.minStock));
    await this.outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'product.updated', {
      id: p.id,
      product: { id: p.id, stock: p.stock, isActive: p.isActive, moderationStatus: p.moderationStatus, lowStock, archived: !!p.deletedAt },
      // M11: the tab that made the change recognises its own write (web conflict detection, M2 carry-over)
      originSessionId: originSessionId(),
    });
  }

  // --- POST /stock/adjustments (CAT-05) -----------------------------------------------------------------------------------
  async adjust(input: StockAdjustmentInput): Promise<StockMovementView> {
    if (input.type !== 'set' && input.quantity === 0) throw new AppException('STOCK_QUANTITY_ZERO', {}, { quantity: 'validation.quantity' });
    const movementId = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const live = await tx.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true } });
      if (!live) throw notFound();
      const r = await this.move(tx, {
        productId: input.productId,
        variantId: input.variantId ?? null,
        change: input.type === 'set' ? { setTo: input.quantity } : { delta: input.type === 'in' ? input.quantity : -input.quantity },
        reason: input.reason,
        note: input.note ?? null,
        refType: 'manual',
        allowNegative: input.force === true,
        requireChange: true,
      });
      return r.movement!.id;
    });
    return this.getMovement(movementId);
  }

  // --- movements journal (GDS-02) -------------------------------------------------------------------------------------------
  private where(q: MovementsQuery): Prisma.StockMovementWhereInput {
    const and: Prisma.StockMovementWhereInput[] = [];
    if (q.productId) and.push({ productId: q.productId });
    if (q.variantId) and.push({ variantId: q.variantId });
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.reason?.length) and.push({ reason: { in: q.reason } });
    if (q.refType?.length) and.push({ refType: { in: q.refType } });
    if (q.refId) and.push({ refId: q.refId });
    if (q.createdById) and.push({ actorId: q.createdById === 'system' ? null : q.createdById });
    if (q.from) and.push({ createdAt: { gte: algiersDayStart(q.from) } });
    if (q.to) and.push({ createdAt: { lt: algiersDayEnd(q.to) } });
    // quantities are signed: the range applies to the absolute value
    if (q.minQty !== undefined) and.push({ OR: [{ quantity: { gte: q.minQty } }, { quantity: { lte: -q.minQty } }] });
    if (q.maxQty !== undefined) and.push({ quantity: { gte: -q.maxQty, lte: q.maxQty } });
    if (q.categoryId) and.push({ product: { categoryId: q.categoryId } });
    if (q.q && q.q.length >= 2) {
      const contains = { contains: q.q, mode: 'insensitive' as const };
      and.push({ OR: [{ product: { name: contains } }, { product: { sku: contains } }, { variant: { name: contains } }, { note: contains }] });
    }
    return { AND: and };
  }

  private async referenceLabels(rows: { refType: MovementRefType | null; refId: string | null }[]) {
    const ids = (type: MovementRefType) => [...new Set(rows.filter((r) => r.refType === type && r.refId).map((r) => r.refId!))];
    const labels = new Map<string, string>();
    const [orders, sales, purchases, variants, inventories] = await Promise.all([
      ids('order').length ? prisma.order.findMany({ where: { id: { in: ids('order') } }, select: { id: true, number: true } }) : [],
      ids('sale').length ? prisma.sale.findMany({ where: { id: { in: ids('sale') } }, select: { id: true, number: true } }) : [],
      ids('purchase').length ? prisma.purchase.findMany({ where: { id: { in: ids('purchase') } }, select: { id: true, number: true } }) : [],
      ids('variant').length ? prisma.productVariant.findMany({ where: { id: { in: ids('variant') } }, select: { id: true, name: true } }) : [],
      ids('inventory').length ? prisma.inventoryCount.findMany({ where: { id: { in: ids('inventory') } }, select: { id: true, number: true } }) : [],
    ]);
    for (const r of [...orders, ...sales, ...purchases, ...inventories]) labels.set(r.id, r.number);
    for (const v of variants) labels.set(v.id, v.name);
    return labels;
  }

  private view(m: MovementRow, labels: Map<string, string>): StockMovementView {
    const isReversal = !!m.reverses;
    const reversible = !isReversal && !m.reversedByMovementId && REVERSIBLE_REF.includes(m.refType);
    return {
      id: m.id,
      product: {
        id: m.product.id,
        name: m.product.name,
        sku: m.product.sku,
        price: m.product.price,
        primaryImageUrl: m.product.images[0] ? thumbUrlOf(m.product.images[0].url) : null,
        hasVariants: m.product.hasVariants,
        trackStock: m.product.trackStock,
      },
      variant: m.variant,
      type: m.type,
      quantity: m.quantity,
      before: m.quantityBefore,
      after: m.quantityAfter,
      reason: m.reason,
      note: m.note,
      reference: m.refType && m.refId ? { type: m.refType, id: m.refId, label: labels.get(m.refId) ?? m.refId.slice(0, 8) } : null,
      actor: m.actor,
      reversed: !!m.reversedByMovementId,
      createdAt: m.createdAt.toISOString(),
      actions: [action('open_product', 'catalog.read'), action('reverse', 'stock.adjust', { reasonCode: reversible ? undefined : 'GDS_MOVEMENT_IMMUTABLE' })],
    };
  }

  private async views(rows: MovementRow[]) {
    const labels = await this.referenceLabels(rows);
    return rows.map((r) => this.view(r, labels));
  }

  async listMovements(q: MovementsQuery): Promise<Page<StockMovementView>> {
    const field = (q.sort ?? '-createdAt').replace(/^-/, '');
    if (!(SORTS as readonly string[]).includes(field)) throw new AppException('BAD_REQUEST');
    const dir = (q.sort ?? '-createdAt').startsWith('-') ? 'desc' : 'asc';
    const where = this.where(q);
    const paging = q.limit ? { skip: 0, take: q.limit } : toSkipTake(q);
    const [rows, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, include: MOVEMENT_INCLUDE, orderBy: [{ createdAt: dir }, { id: dir }], ...paging }),
      prisma.stockMovement.count({ where }),
    ]);
    return page(await this.views(rows), total, q.limit ? { page: 1, pageSize: q.limit } : q);
  }

  /** `GET /stock/movements/stats` — counts and units per type of the filtered journal (quantities are signed). */
  async movementStats(q: MovementsQuery): Promise<MovementStatsView> {
    const where = this.where(q);
    const rows = await prisma.stockMovement.groupBy({ by: ['type'], where, _count: { _all: true }, _sum: { quantity: true } });
    const byType = Object.fromEntries(MovementTypeValues.map((t) => [t, { count: 0, units: 0 }])) as MovementStatsView['byType'];
    let unitsIn = 0;
    let unitsOut = 0;
    for (const r of rows) {
      const units = r._sum.quantity ?? 0;
      byType[r.type] = { count: r._count._all, units: Math.abs(units) };
    }
    // in / out split on the sign of each movement (an inventory or a reversal can go both ways)
    const signed = await prisma.stockMovement.groupBy({ by: ['type'], where: { AND: [where, { quantity: { gt: 0 } }] }, _sum: { quantity: true } });
    for (const r of signed) unitsIn += r._sum.quantity ?? 0;
    const neg = await prisma.stockMovement.groupBy({ by: ['type'], where: { AND: [where, { quantity: { lt: 0 } }] }, _sum: { quantity: true } });
    for (const r of neg) unitsOut += Math.abs(r._sum.quantity ?? 0);
    let netValue: number | null = null;
    if (TenantContext.get().stockMode === 'advanced') {
      const ws = TenantContext.workspaceId();
      const ids = (await prisma.stockMovement.findMany({ where, select: { id: true }, take: 100_000 })).map((m) => m.id);
      if (ids.length) {
        const [v] = await prisma.$queryRaw<{ v: number }[]>`
          SELECT COALESCE(sum(m."quantity"::bigint * COALESCE(pv."costPrice", p."costPrice", 0)), 0)::float8 AS v
          FROM "StockMovement" m JOIN "Product" p ON p."id" = m."productId" LEFT JOIN "ProductVariant" pv ON pv."id" = m."variantId"
          WHERE m."workspaceId" = ${ws}::uuid AND m."id" = ANY(${ids}::uuid[])`;
        netValue = Math.round(v?.v ?? 0);
      } else netValue = 0;
    }
    return { count: rows.reduce((n, r) => n + r._count._all, 0), unitsIn, unitsOut, net: unitsIn - unitsOut, byType, netValue };
  }

  async getMovement(id: string): Promise<StockMovementView> {
    const row = await prisma.stockMovement.findFirst({ where: { id }, include: MOVEMENT_INCLUDE });
    if (!row) throw notFound();
    return (await this.views([row]))[0]!;
  }

  /** `POST /stock/movements/:id/reverse` — the journal is append-only: a new inverse movement with reason `correction`. */
  async reverse(id: string, note?: string | null): Promise<StockMovementView> {
    const inverseId = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const m = await tx.stockMovement.findFirst({ where: { id }, include: { reverses: { select: { id: true } }, product: { select: { deletedAt: true } } } });
      if (!m) throw notFound();
      if (m.reverses || m.reversedByMovementId || !REVERSIBLE_REF.includes(m.refType) || m.product.deletedAt) throw new AppException('GDS_MOVEMENT_IMMUTABLE');
      const r = await this.move(tx, {
        productId: m.productId,
        variantId: m.variantId,
        change: { delta: -m.quantity },
        reason: 'correction',
        note: note ?? null,
        refType: 'manual',
        refId: m.id,
        requireChange: true,
      });
      // conditional update: two concurrent reversals of the same movement cannot both succeed
      const claimed = await tx.stockMovement.updateMany({ where: { id: m.id, reversedByMovementId: null }, data: { reversedByMovementId: r.movement!.id } });
      if (!claimed.count) throw new AppException('GDS_MOVEMENT_IMMUTABLE');
      return r.movement!.id;
    });
    return this.getMovement(inverseId);
  }

  private async exportTable(q: MovementsQuery, locale: 'fr' | 'ar' | 'en') {
    const rows = await this.views(await prisma.stockMovement.findMany({ where: this.where(q), include: MOVEMENT_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50_000 }));
    const h = MOVEMENT_HEADERS[locale] ?? MOVEMENT_HEADERS.fr;
    type R = StockMovementView;
    return {
      sheetName: h.sheet,
      fileName: `mouvements-${algiersDay()}`,
      rows,
      columns: [
        { header: h.date, value: (r: R) => r.createdAt },
        { header: h.product, value: (r: R) => r.product.name },
        { header: 'SKU', value: (r: R) => r.product.sku },
        { header: h.variant, value: (r: R) => r.variant?.name ?? '' },
        { header: h.type, value: (r: R) => r.type },
        { header: h.quantity, value: (r: R) => r.quantity },
        { header: h.before, value: (r: R) => r.before },
        { header: h.after, value: (r: R) => r.after },
        { header: h.reason, value: (r: R) => r.reason ?? '' },
        { header: h.note, value: (r: R) => r.note ?? '' },
        { header: h.reference, value: (r: R) => r.reference?.label ?? '' },
        { header: h.actor, value: (r: R) => (r.actor ? `${r.actor.firstName} ${r.actor.lastName}`.trim() : '') },
      ],
    };
  }

  // --- GET /stock/overview (GDS-01) -----------------------------------------------------------------------------------------
  async overview() {
    const t = TenantContext.get();
    const ws = t.workspaceId;
    const [totals] = await prisma.$queryRaw<
      { total: number; active: number; tracked: number; services: number; low: number; out: number; items: number; cost: number; retail: number }[]
    >`
      WITH lines AS (
        -- one line per stock holder: a tracked product without variants, or an active variant of a tracked product
        SELECT p."id" AS pid, COALESCE(p."stock", 0) AS qty, p."minStock" AS min, COALESCE(p."costPrice", 0) AS cost, p."price" AS price
        FROM "Product" p
        WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND NOT p."hasVariants"
        UNION ALL
        SELECT p."id", v."stock", v."minStock", COALESCE(v."costPrice", p."costPrice", 0), v."price"
        FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
        WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND p."hasVariants" AND v."deletedAt" IS NULL AND v."isActive"
      ), alerts AS (
        SELECT pid, bool_or(qty <= 0) AS any_out, bool_and(qty <= 0) AS all_out, bool_or(qty > 0 AND qty <= min) AS any_low FROM lines GROUP BY pid
      )
      SELECT
        (SELECT count(*) FROM "Product" WHERE "workspaceId" = ${ws}::uuid AND "deletedAt" IS NULL)::int AS total,
        (SELECT count(*) FROM "Product" WHERE "workspaceId" = ${ws}::uuid AND "deletedAt" IS NULL AND "isActive")::int AS active,
        (SELECT count(*) FROM "Product" WHERE "workspaceId" = ${ws}::uuid AND "deletedAt" IS NULL AND "trackStock")::int AS tracked,
        (SELECT count(*) FROM "Product" WHERE "workspaceId" = ${ws}::uuid AND "deletedAt" IS NULL AND NOT "trackStock")::int AS services,
        (SELECT count(*) FROM alerts WHERE NOT all_out AND (any_low OR any_out))::int AS low,
        (SELECT count(*) FROM alerts WHERE all_out)::int AS out,
        COALESCE((SELECT sum(GREATEST(qty, 0)) FROM lines), 0)::int AS items,
        COALESCE((SELECT sum(GREATEST(qty, 0)::bigint * cost) FROM lines), 0)::float8 AS cost,
        COALESCE((SELECT sum(GREATEST(qty, 0)::bigint * price) FROM lines), 0)::float8 AS retail`;
    const x = totals!;
    const advanced = t.stockMode === 'advanced';
    const recent = await this.listMovements({ page: 1, pageSize: 25, limit: 10 } as MovementsQuery);
    return {
      mode: t.stockMode,
      totalProducts: x.total,
      activeProducts: x.active,
      trackedProducts: x.tracked,
      services: x.services,
      lowStockCount: x.low,
      outOfStockCount: x.out,
      totalItems: x.items,
      // simple mode has no cost price (ONB-03): the value at cost is an advanced figure
      valueAtCost: advanced ? Math.round(x.cost) : null,
      valueAtRetail: Math.round(x.retail),
      potentialMargin: advanced ? Math.round(x.retail - x.cost) : null,
      recentMovements: recent.data,
      purchasing: advanced && can(t.role, 'gds.read') ? await this.purchasing() : null,
    };
  }

  /** Block "ACHATS & FOURNISSEURS" of the stock dashboard (M2 carry-over, advanced mode, `gds.read`). */
  private async purchasing(): Promise<StockPurchasingView> {
    const now = new Date();
    const [open, late, due, suppliers, bought, restock] = await Promise.all([
      prisma.purchase.count({ where: { status: { in: ['pending', 'partial'] } } }),
      prisma.purchase.count({ where: { status: { in: ['pending', 'partial'] }, expectedAt: { lt: now } } }),
      prisma.purchase.findMany({ where: { status: { in: ['pending', 'partial', 'received'] } }, select: { total: true, amountPaid: true } }),
      prisma.supplier.count({ where: { deletedAt: null, isActive: true } }),
      prisma.purchase.aggregate({ where: { status: { notIn: ['cancelled', 'draft'] }, purchasedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, _sum: { total: true } }),
      prisma.stockRecommendation.count({ where: { status: 'active', type: { in: ['restock', 'stockout_imminent'] } } }),
    ]);
    return {
      pendingReceipt: open,
      late,
      dueToSuppliers: due.reduce((s, p) => s + Math.max(0, p.total - p.amountPaid), 0),
      activeSuppliers: suppliers,
      purchased30d: bought._sum.total ?? 0,
      restockSuggestions: restock,
    };
  }

  /** `GET /products/low-stock` — alert lines (products and variants at or below their threshold), worst first. */
  async lowStockLines(limit = 200) {
    const ws = TenantContext.workspaceId();
    const rows = await prisma.$queryRaw<{ productId: string; variantId: string | null; name: string; variantName: string | null; sku: string | null; stock: number; minStock: number; imageUrl: string | null }[]>`
      SELECT * FROM (
        SELECT p."id" AS "productId", NULL::uuid AS "variantId", p."name", NULL::text AS "variantName", p."sku", COALESCE(p."stock", 0) AS "stock", p."minStock",
               (SELECT i."url" FROM "ProductImage" i WHERE i."productId" = p."id" AND i."isPrimary" LIMIT 1) AS "imageUrl"
        FROM "Product" p
        WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND NOT p."hasVariants" AND COALESCE(p."stock", 0) <= p."minStock"
        UNION ALL
        SELECT p."id", v."id", p."name", v."name", COALESCE(v."sku", p."sku"), v."stock", v."minStock",
               (SELECT i."url" FROM "ProductImage" i WHERE i."productId" = p."id" AND i."isPrimary" LIMIT 1)
        FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
        WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND p."hasVariants" AND v."deletedAt" IS NULL AND v."isActive" AND v."stock" <= v."minStock"
      ) AS a ORDER BY a."stock" ASC, a."name" ASC LIMIT ${limit}`;
    return rows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      name: r.name,
      variantName: r.variantName,
      sku: r.sku,
      stock: r.stock,
      minStock: r.minStock,
      state: stockStateOf(r.stock, r.minStock),
      primaryImageUrl: r.imageUrl ? thumbUrlOf(r.imageUrl) : null,
    }));
  }

  // --- GET /stock/snapshot?date (06 §8.6) -----------------------------------------------------------------------------------
  /** Stock as of the end of `date` (Africa/Algiers) = current quantity − movements written after that instant. */
  async snapshot(q: SnapshotQuery) {
    const ws = TenantContext.workspaceId();
    const workspace = await prisma.workspace.findUnique({ where: { id: ws }, select: { createdAt: true } });
    if (!workspace || q.date < algiersDay(workspace.createdAt)) throw new AppException('INVALID_DATE_RANGE', {}, { date: 'validation.date' });
    const end = algiersDayEnd(q.date);
    const category = q.categoryId ? Prisma.sql`AND p."categoryId" = ${q.categoryId}::uuid` : Prisma.empty;
    const pattern = q.q && q.q.length >= 2 ? likePattern(q.q) : null;
    const search = pattern ? Prisma.sql`AND (f_unaccent(p."name") ILIKE f_unaccent(${pattern}) OR p."sku" ILIKE ${pattern})` : Prisma.empty;
    const lines = Prisma.sql`
      SELECT p."id" AS "productId", NULL::uuid AS "variantId", p."name" AS "name", p."sku" AS "sku", p."createdAt" AS "createdAt",
             COALESCE(p."stock", 0) - COALESCE((SELECT sum(m."quantity") FROM "StockMovement" m WHERE m."productId" = p."id" AND m."variantId" IS NULL AND m."createdAt" >= ${end}), 0) AS qty,
             COALESCE(p."costPrice", 0) AS cost
      FROM "Product" p
      WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND NOT p."hasVariants" AND p."createdAt" < ${end} ${category} ${search}
      UNION ALL
      SELECT p."id", v."id", p."name" || ' — ' || v."name", COALESCE(v."sku", p."sku"), v."createdAt",
             v."stock" - COALESCE((SELECT sum(m."quantity") FROM "StockMovement" m WHERE m."variantId" = v."id" AND m."createdAt" >= ${end}), 0),
             COALESCE(v."costPrice", p."costPrice", 0)
      FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId"
      WHERE p."workspaceId" = ${ws}::uuid AND p."deletedAt" IS NULL AND p."trackStock" AND p."hasVariants" AND v."deletedAt" IS NULL AND v."createdAt" < ${end} ${category} ${search}`;
    const { skip, take } = toSkipTake(q);
    const [rows, [agg]] = await Promise.all([
      prisma.$queryRaw<{ productId: string; variantId: string | null; name: string; sku: string | null; qty: number | bigint; cost: number }[]>`
        SELECT * FROM (${lines}) AS s ORDER BY s."name" ASC, s."createdAt" ASC LIMIT ${take} OFFSET ${skip}`,
      prisma.$queryRaw<{ total: number; value: number }[]>`SELECT count(*)::int AS total, COALESCE(sum(GREATEST(s.qty, 0)::bigint * s.cost), 0)::float8 AS value FROM (${lines}) AS s`,
    ]);
    const data = rows.map((r) => {
      const quantityAtDate = Number(r.qty);
      return { productId: r.productId, variantId: r.variantId, name: r.name, sku: r.sku, quantityAtDate, costPriceAtDate: r.cost, valueAtDate: Math.max(quantityAtDate, 0) * r.cost };
    });
    return { ...page(data, agg?.total ?? 0, q), meta: { totalValue: Math.round(agg?.value ?? 0), date: q.date } };
  }
}

const MOVEMENT_HEADERS = {
  fr: { sheet: 'Mouvements', date: 'Date', product: 'Produit', variant: 'Variante', type: 'Type', quantity: 'Quantité', before: 'Avant', after: 'Après', reason: 'Motif', note: 'Note', reference: 'Référence', actor: 'Par' },
  en: { sheet: 'Movements', date: 'Date', product: 'Product', variant: 'Variant', type: 'Type', quantity: 'Quantity', before: 'Before', after: 'After', reason: 'Reason', note: 'Note', reference: 'Reference', actor: 'By' },
  ar: { sheet: 'الحركات', date: 'التاريخ', product: 'المنتج', variant: 'المتغيّر', type: 'النوع', quantity: 'الكمية', before: 'قبل', after: 'بعد', reason: 'السبب', note: 'ملاحظة', reference: 'المرجع', actor: 'بواسطة' },
} as const;
