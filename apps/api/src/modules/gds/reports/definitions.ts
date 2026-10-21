// GDS-10 — the 23 reports (00-build-order M8 Risks: one template + a per-report column map). Column / KPI / chart metadata
// lives in `@djaber/shared` (`REPORT_DEFINITIONS`); this file holds the query of each report. Figures reuse the analytics
// rollups (sales by period, P&L revenue) and `money-figures.ts` (P&L), so Revenue is the same number everywhere (AT-ORD-10).
import { type ReportFilterKey, type ReportKey, type ReportRow } from '@djaber/shared';
import { Prisma, prisma } from '@djaber/db';
import { algiersDay } from '../../../core/time/algiers';
import type { DailyStatsService } from '../../analytics/daily-stats.service';
import { sumDays } from '../../analytics/day-metrics';
import { eachDay, pct, round1, type DayRange } from '../../analytics/range';
import { profitAndLoss } from '../money-figures';
import { deadStock, stockLines } from './stock-queries';

export type ReportCtx = {
  workspaceId: string;
  /** null for snapshot reports */
  range: DayRange | null;
  filters: Partial<Record<ReportFilterKey, string | number>>;
  locale: 'fr' | 'ar' | 'en';
  walkIn: string;
  stats: DailyStatsService;
  now: Date;
};
export type ReportResult = { rows: ReportRow[]; kpis: Record<string, number | null> };
type Producer = (ctx: ReportCtx) => Promise<ReportResult>;

const n = (v: unknown) => Number(v ?? 0) || 0;
const day = (d: Date | null | undefined) => (d ? algiersDay(d) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const r = (ctx: ReportCtx) => {
  if (!ctx.range) throw new Error('report needs a range');
  return ctx.range;
};
const ws = (ctx: ReportCtx) => Prisma.sql`${ctx.workspaceId}::uuid`;
const str = (ctx: ReportCtx, k: ReportFilterKey) => (typeof ctx.filters[k] === 'string' ? (ctx.filters[k] as string) : undefined);
const like = (ctx: ReportCtx) => {
  const q = str(ctx, 'q');
  return q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
};
const sumOf = (rows: ReportRow[], key: string) => rows.reduce((s, row) => s + n(row[key]), 0);

type SoldLine = { pid: string; vid: string | null; product: string; variant: string | null; sku: string | null; cid: string | null; category: string | null; qty: number; revenue: number; cogs: number; docs: number };
/** Lines sold in the period: delivered orders (deliveredAt) + completed counter sales (soldAt) — the 04 §4 Revenue lines. */
async function soldLines(ctx: ReportCtx, f: { categoryId?: string; productId?: string; q?: string | null; source?: string; channelId?: string } = {}): Promise<SoldLine[]> {
  const { gte, lt } = r(ctx);
  // M11 filters (ANA-04): a channel only exists on orders, so `channelId` leaves the counter sales out
  const withOrders = f.source !== 'sales';
  const withSales = f.source !== 'orders' && !f.channelId;
  const channel = f.channelId ? Prisma.sql`AND o."channelId" = ${f.channelId}::uuid` : Prisma.empty;
  const cat = f.categoryId ? Prisma.sql`AND p."categoryId" = ${f.categoryId}::uuid` : Prisma.empty;
  const prod = f.productId ? Prisma.sql`AND p."id" = ${f.productId}::uuid` : Prisma.empty;
  const q = f.q ? Prisma.sql`AND (p."name" ILIKE ${f.q} OR p."sku" ILIKE ${f.q} OR v."sku" ILIKE ${f.q})` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ pid: string; vid: string | null; product: string; variant: string | null; sku: string | null; cid: string | null; category: string | null; qty: bigint; rev: bigint; cogs: bigint; docs: number }[]>`
    SELECT x.pid, x.vid, p."name" product, v."name" variant, coalesce(v."sku", p."sku") sku, p."categoryId" cid, c."name" category,
           sum(x.qty)::bigint qty, sum(x.rev)::bigint rev, sum(x.cogs)::bigint cogs, count(DISTINCT x.doc)::int docs
    FROM (
      SELECT i."productId" pid, i."variantId" vid, i."quantity" qty, i."total" rev, i."quantity" * coalesce(i."costPrice", 0) cogs, o."id" doc
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE ${withOrders ? Prisma.sql`true` : Prisma.sql`false`} AND o."workspaceId" = ${ws(ctx)} AND o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt} ${channel}
      UNION ALL
      SELECT i."productId", i."variantId", i."quantity", i."total", i."quantity" * coalesce(i."costPrice", 0), s."id"
      FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
      WHERE ${withSales ? Prisma.sql`true` : Prisma.sql`false`} AND s."workspaceId" = ${ws(ctx)} AND s."status" = 'completed' AND s."soldAt" >= ${gte} AND s."soldAt" < ${lt}
    ) x JOIN "Product" p ON p."id" = x.pid LEFT JOIN "ProductVariant" v ON v."id" = x.vid LEFT JOIN "Category" c ON c."id" = p."categoryId"
    WHERE true ${cat} ${prod} ${q}
    GROUP BY 1,2,3,4,5,6,7`;
  return rows.map((x) => ({ pid: x.pid, vid: x.vid, product: x.product, variant: x.variant, sku: x.sku, cid: x.cid, category: x.category, qty: n(x.qty), revenue: n(x.rev), cogs: n(x.cogs), docs: x.docs }));
}

type CashSource = { id: string; sourceType: string | null; sourceId: string | null; correctsTransactionId: string | null };
type CashDoc = { type: 'order' | 'sale' | 'purchase'; id: string; number: string };
/**
 * Document behind each cash row: its order / sale / purchase, through the payment entry of an automatic payment row, and
 * for a manual correction the document of the row it corrects (same rule as `GET /cash` `reference`).
 */
async function cashDocuments(txs: CashSource[]): Promise<(t: CashSource) => CashDoc | null> {
  const correctedIds = [...new Set(txs.filter((t) => t.correctsTransactionId && t.sourceType !== 'closing').map((t) => t.correctsTransactionId!))];
  const corrected = correctedIds.length ? await prisma.cashTransaction.findMany({ where: { id: { in: correctedIds } }, select: { id: true, sourceType: true, sourceId: true, correctsTransactionId: true } }) : [];
  const byId = new Map(corrected.map((c) => [c.id, c]));
  const all = [...txs, ...corrected];
  const entryIds = all.filter((t) => t.sourceType === 'payment_entry' && t.sourceId).map((t) => t.sourceId!);
  const entries = entryIds.length ? await prisma.paymentEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, sourceType: true, sourceId: true } }) : [];
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const target = (t: CashSource): { type: CashDoc['type']; id: string } | null => {
    if (t.sourceType === 'payment_entry' && t.sourceId) {
      const e = byEntry.get(t.sourceId);
      return e && (e.sourceType === 'order' || e.sourceType === 'sale' || e.sourceType === 'purchase') ? { type: e.sourceType, id: e.sourceId } : null;
    }
    return (t.sourceType === 'order' || t.sourceType === 'sale' || t.sourceType === 'purchase') && t.sourceId ? { type: t.sourceType, id: t.sourceId } : null;
  };
  const targets = all.map(target).filter((x): x is NonNullable<typeof x> => !!x);
  const ids = (type: CashDoc['type']) => [...new Set(targets.filter((x) => x.type === type).map((x) => x.id))];
  const [orders, sales, purchases] = await Promise.all([
    ids('order').length ? prisma.order.findMany({ where: { id: { in: ids('order') } }, select: { id: true, number: true } }) : [],
    ids('sale').length ? prisma.sale.findMany({ where: { id: { in: ids('sale') } }, select: { id: true, number: true } }) : [],
    ids('purchase').length ? prisma.purchase.findMany({ where: { id: { in: ids('purchase') } }, select: { id: true, number: true } }) : [],
  ]);
  const numbers = new Map([...orders, ...sales, ...purchases].map((d) => [d.id, d.number]));
  return (t) => {
    const own = target(t);
    const c = own ? null : t.correctsTransactionId ? byId.get(t.correctsTransactionId) : undefined;
    const x = own ?? (c ? target(c) : null);
    return x && numbers.has(x.id) ? { ...x, number: numbers.get(x.id)! } : null;
  };
}

/** `source` / `channelId` of the report filters (M11, ANA-04). */
const sourceFilters = (ctx: ReportCtx) => ({ source: str(ctx, 'source'), channelId: str(ctx, 'channelId') });

/** `groupBy=product`: the variants of a product merged into one line (no variant, the product SKU). */
function byProduct(lines: SoldLine[]): SoldLine[] {
  const by = new Map<string, SoldLine>();
  for (const l of lines) {
    const e = by.get(l.pid);
    if (!e) by.set(l.pid, { ...l, vid: null, variant: null, sku: l.vid ? null : l.sku });
    else {
      e.qty += l.qty;
      e.revenue += l.revenue;
      e.cogs += l.cogs;
      e.docs += l.docs;
      if (!l.vid) e.sku = l.sku;
    }
  }
  return [...by.values()];
}

/** Revenue days of the analytics rollups (identical figures to the analytics tabs and the home tiles). */
async function revenueDays(ctx: ReportCtx) {
  const range = r(ctx);
  const res = await ctx.stats.days({ workspaceId: ctx.workspaceId, from: range.from, to: range.to, keys: ['revenue', 'orders'] }, ctx.now);
  return res.byDay;
}

/** Cash rows of the P&L / expenses: manual expenses, automatic return costs (D27), purchases paid. */
async function cashFigures(ctx: ReportCtx) {
  const { gte, lt } = r(ctx);
  const [row] = await prisma.$queryRaw<{ manual: bigint; returns: bigint; purchases: bigint }[]>`
    SELECT coalesce(sum("amount") FILTER (WHERE "isAutomatic" = false AND "category" IN ('rent','salary','utilities','marketing','shipping','other')), 0)::bigint manual,
           coalesce(sum("amount") FILTER (WHERE "isAutomatic" = true AND "category" = 'shipping' AND "sourceType" = 'order'), 0)::bigint returns,
           coalesce(sum("amount") FILTER (WHERE "category" = 'purchase'), 0)::bigint purchases
    FROM "CashTransaction" WHERE "workspaceId" = ${ws(ctx)} AND "type" = 'expense' AND "date" >= ${gte} AND "date" < ${lt}`;
  return { manual: n(row?.manual), returns: n(row?.returns), purchases: n(row?.purchases) };
}

type ProductExpenseRow = { id: string; date: Date; category: string; description: string | null; pid: string; product: string; amount: number; isPerUnit: boolean; units: number };
/** Product expenses (GDS-09) dated in the period; a per-unit expense counts amount × units sold in the period. */
async function productExpenses(ctx: ReportCtx): Promise<ProductExpenseRow[]> {
  const { gte, lt } = r(ctx);
  const rows = await prisma.productExpense.findMany({ where: { date: { gte, lt } }, include: { product: { select: { name: true } } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
  if (!rows.length) return [];
  const perUnit = [...new Set(rows.filter((e) => e.isPerUnit).map((e) => e.productId))];
  const units = new Map<string, number>();
  if (perUnit.length) for (const l of await soldLines(ctx)) if (perUnit.includes(l.pid)) units.set(l.pid, (units.get(l.pid) ?? 0) + l.qty);
  return rows.map((e) => ({ id: e.id, date: e.date, category: e.category, description: e.description, pid: e.productId, product: e.product.name, amount: e.isPerUnit ? e.amount * (units.get(e.productId) ?? 0) : e.amount, isPerUnit: e.isPerUnit, units: units.get(e.productId) ?? 0 }));
}

const productRef = (pid: string) => ({ type: 'product' as const, id: pid });

export const REPORT_PRODUCERS: Record<ReportKey, Producer> = {
  async sales_by_period(ctx) {
    const range = r(ctx);
    const byDay = await revenueDays(ctx);
    const zero = sumDays([]);
    const rows: ReportRow[] = eachDay(range.from, range.to).map((d) => {
      const m = byDay.get(d) ?? zero;
      const revenue = m.revenue.sales + m.revenue.orders;
      return { day: d, salesCount: m.revenue.salesCount, salesRevenue: m.revenue.sales, deliveredOrders: m.orders.delivered, ordersRevenue: m.revenue.orders, revenue, deliveryFees: m.revenue.deliveryFees, netRevenue: revenue - m.revenue.deliveryFees, discount: m.revenue.salesDiscount + m.revenue.ordersDiscount, _ref: null };
    });
    const revenue = sumOf(rows, 'revenue');
    const docs = sumOf(rows, 'salesCount') + sumOf(rows, 'deliveredOrders');
    return { rows, kpis: { revenue, netRevenue: sumOf(rows, 'netRevenue'), salesCount: sumOf(rows, 'salesCount'), deliveredOrders: sumOf(rows, 'deliveredOrders'), avgBasket: docs ? Math.round(revenue / docs) : null } };
  },

  async sales_by_product(ctx) {
    const sold = await soldLines(ctx, { categoryId: str(ctx, 'categoryId'), productId: str(ctx, 'productId'), q: like(ctx), ...sourceFilters(ctx) });
    const lines = str(ctx, 'groupBy') === 'product' ? byProduct(sold) : sold;
    const total = lines.reduce((s, l) => s + l.revenue, 0);
    const cogs = lines.reduce((s, l) => s + l.cogs, 0);
    const rows: ReportRow[] = lines.map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, category: l.category, quantity: l.qty, revenue: l.revenue, cogs: l.cogs, margin: l.revenue - l.cogs, marginPct: pct(l.revenue - l.cogs, l.revenue), sharePct: pct(l.revenue, total), _ref: productRef(l.pid) }));
    return { rows, kpis: { revenue: total, quantity: lines.reduce((s, l) => s + l.qty, 0), products: new Set(lines.map((l) => l.pid)).size, marginPct: pct(total - cogs, total) } };
  },

  async sales_by_category(ctx) {
    const lines = await soldLines(ctx, sourceFilters(ctx));
    const by = new Map<string, { cid: string | null; name: string | null; qty: number; revenue: number; cogs: number }>();
    for (const l of lines) {
      const k = l.cid ?? 'none';
      const e = by.get(k) ?? { cid: l.cid, name: l.category, qty: 0, revenue: 0, cogs: 0 };
      e.qty += l.qty;
      e.revenue += l.revenue;
      e.cogs += l.cogs;
      by.set(k, e);
    }
    const total = lines.reduce((s, l) => s + l.revenue, 0);
    const rows: ReportRow[] = [...by.values()].map((e) => ({ category: e.name, quantity: e.qty, revenue: e.revenue, cogs: e.cogs, margin: e.revenue - e.cogs, sharePct: pct(e.revenue, total), _ref: e.cid ? { type: 'category', id: e.cid } : null }));
    return { rows, kpis: { revenue: total, quantity: lines.reduce((s, l) => s + l.qty, 0), categories: by.size } };
  },

  async top_products(ctx) {
    const lines = await soldLines(ctx, { categoryId: str(ctx, 'categoryId'), q: like(ctx), ...sourceFilters(ctx) });
    const by = new Map<string, { pid: string; product: string; sku: string | null; category: string | null; qty: number; revenue: number; docs: number }>();
    for (const l of lines) {
      const e = by.get(l.pid) ?? { pid: l.pid, product: l.product, sku: l.vid ? null : l.sku, category: l.category, qty: 0, revenue: 0, docs: 0 };
      e.qty += l.qty;
      e.revenue += l.revenue;
      e.docs += l.docs;
      by.set(l.pid, e);
    }
    const sorted = [...by.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    const rows: ReportRow[] = sorted.map((e, i) => ({ rank: i + 1, product: e.product, sku: e.sku, category: e.category, quantity: e.qty, orders: e.docs, revenue: e.revenue, _ref: productRef(e.pid) }));
    return { rows, kpis: { quantity: sumOf(rows, 'quantity'), revenue: sumOf(rows, 'revenue'), products: rows.length } };
  },

  async profit_loss(ctx) {
    const [byDay, lines, cash, pex] = await Promise.all([revenueDays(ctx), soldLines(ctx), cashFigures(ctx), productExpenses(ctx)]);
    const m = sumDays(byDay.values());
    // 04 §4 / AT-ORD-11: COGS of what was sold; purchases paid are shown for information and never subtracted again
    const p = profitAndLoss({
      salesRevenue: m.revenue.sales,
      ordersRevenue: m.revenue.orders,
      cogs: lines.reduce((s, l) => s + l.cogs, 0),
      manualExpenses: cash.manual,
      productExpenses: pex.reduce((s, e) => s + e.amount, 0),
      returnCosts: cash.returns,
      purchasesPaid: cash.purchases,
    });
    const values: Record<string, number> = { salesRevenue: m.revenue.sales, ordersRevenue: m.revenue.orders, revenue: p.revenue, cogs: p.cogs, grossMargin: p.grossMargin, manualExpenses: cash.manual, productExpenses: pex.reduce((s, e) => s + e.amount, 0), returnCosts: cash.returns, expenses: p.expenses, net: p.net, purchasesPaid: p.purchasesPaid };
    const rows: ReportRow[] = Object.entries(values).map(([line, amount]) => ({ line, amount, _ref: null }));
    return { rows, kpis: { revenue: p.revenue, cogs: p.cogs, grossMargin: p.grossMargin, expenses: p.expenses, net: p.net, purchasesPaid: p.purchasesPaid } };
  },

  async discounts(ctx) {
    const { gte, lt } = r(ctx);
    const client = str(ctx, 'clientId');
    const q = str(ctx, 'q');
    const [orders, sales] = await Promise.all([
      prisma.order.findMany({ where: { discount: { gt: 0 }, status: { not: 'cancelled' }, orderedAt: { gte, lt }, ...(client ? { clientId: client } : {}), ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { clientName: { contains: q, mode: 'insensitive' } }] } : {}) }, select: { id: true, number: true, orderedAt: true, clientId: true, clientName: true, subtotal: true, discount: true, total: true } }),
      prisma.sale.findMany({ where: { discount: { gt: 0 }, status: 'completed', soldAt: { gte, lt }, ...(client ? { clientId: client } : {}), ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { customerName: { contains: q, mode: 'insensitive' } }] } : {}) }, select: { id: true, number: true, soldAt: true, clientId: true, customerName: true, client: { select: { name: true } }, subtotal: true, discount: true, total: true } }),
    ]);
    const rows: ReportRow[] = [
      ...orders.map((o) => ({ date: day(o.orderedAt), number: o.number, documentType: 'order', client: o.clientName, subtotal: o.subtotal, discount: o.discount, discountPct: pct(o.discount, o.subtotal), total: o.total, _ref: { type: 'order' as const, id: o.id } })),
      ...sales.map((s) => ({ date: day(s.soldAt), number: s.number, documentType: 'sale', client: s.client?.name ?? s.customerName ?? ctx.walkIn, subtotal: s.subtotal, discount: s.discount, discountPct: pct(s.discount, s.subtotal), total: s.total, _ref: { type: 'sale' as const, id: s.id } })),
    ];
    const subtotal = sumOf(rows, 'subtotal');
    return { rows, kpis: { discount: sumOf(rows, 'discount'), documents: rows.length, avgDiscountPct: pct(sumOf(rows, 'discount'), subtotal) } };
  },

  async tax_summary(ctx) {
    const range = r(ctx);
    const [byDay, purchases] = await Promise.all([
      revenueDays(ctx),
      prisma.$queryRaw<{ d: string; tax: bigint }[]>`
        SELECT to_char("purchasedAt" + interval '1 hour', 'YYYY-MM-DD') d, coalesce(sum("tax"), 0)::bigint tax FROM "Purchase"
        WHERE "workspaceId" = ${ws(ctx)} AND "status" NOT IN ('draft', 'cancelled') AND "purchasedAt" >= ${range.gte} AND "purchasedAt" < ${range.lt} GROUP BY 1`,
    ]);
    const pTax = new Map(purchases.map((p) => [p.d, n(p.tax)]));
    const zero = sumDays([]);
    const rows: ReportRow[] = eachDay(range.from, range.to).map((d) => {
      const m = byDay.get(d) ?? zero;
      const collected = m.revenue.salesTax + m.revenue.ordersTax;
      const paid = pTax.get(d) ?? 0;
      return { day: d, salesTax: m.revenue.salesTax, ordersTax: m.revenue.ordersTax, collectedTax: collected, purchasesTax: paid, balance: collected - paid, _ref: null };
    });
    return { rows, kpis: { collectedTax: sumOf(rows, 'collectedTax'), purchasesTax: sumOf(rows, 'purchasesTax'), balance: sumOf(rows, 'balance') } };
  },

  async return_ratio(ctx) {
    const { gte, lt } = r(ctx);
    const cat = str(ctx, 'categoryId') ? Prisma.sql`AND p."categoryId" = ${str(ctx, 'categoryId')}::uuid` : Prisma.empty;
    const q = like(ctx) ? Prisma.sql`AND (p."name" ILIKE ${like(ctx)} OR p."sku" ILIKE ${like(ctx)})` : Prisma.empty;
    const [lines, orders, cash] = await Promise.all([
      prisma.$queryRaw<{ pid: string; vid: string | null; product: string; variant: string | null; sku: string | null; delivered: bigint; returned: bigint }[]>`
        SELECT x.pid, x.vid, p."name" product, v."name" variant, coalesce(v."sku", p."sku") sku, sum(x.delivered)::bigint delivered, sum(x.returned)::bigint returned
        FROM (
          SELECT i."productId" pid, i."variantId" vid, i."quantity" delivered, 0 returned FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
          WHERE o."workspaceId" = ${ws(ctx)} AND o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt}
          UNION ALL
          SELECT i."productId", i."variantId", 0, i."quantity" FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
          WHERE o."workspaceId" = ${ws(ctx)} AND o."status" = 'returned'
            AND EXISTS (SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" AND h."field" = 'status' AND h."to" = 'returned' AND COALESCE(h."effectiveAt", h."at") >= ${gte} AND COALESCE(h."effectiveAt", h."at") < ${lt})
        ) x JOIN "Product" p ON p."id" = x.pid LEFT JOIN "ProductVariant" v ON v."id" = x.vid
        WHERE true ${cat} ${q}
        GROUP BY 1,2,3,4,5`,
      prisma.$queryRaw<{ delivered: number; returned: number }[]>`
        SELECT count(*) FILTER (WHERE o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt})::int delivered,
               count(*) FILTER (WHERE o."status" = 'returned' AND EXISTS (SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o."id" AND h."field" = 'status' AND h."to" = 'returned' AND COALESCE(h."effectiveAt", h."at") >= ${gte} AND COALESCE(h."effectiveAt", h."at") < ${lt}))::int returned
        FROM "Order" o WHERE o."workspaceId" = ${ws(ctx)} AND o."status" IN ('delivered', 'returned')`,
      cashFigures(ctx),
    ]);
    const rows: ReportRow[] = lines.map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, delivered: n(l.delivered), returned: n(l.returned), returnRate: pct(n(l.returned), n(l.delivered) + n(l.returned)), _ref: productRef(l.pid) }));
    const o = orders[0] ?? { delivered: 0, returned: 0 };
    return { rows, kpis: { returnedOrders: o.returned, returnRate: pct(o.returned, o.delivered + o.returned), returnCosts: cash.returns } };
  },

  async payments(ctx) {
    const { gte, lt } = r(ctx);
    const entries = await prisma.paymentEntry.findMany({ where: { paidAt: { gte, lt } }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] });
    const ids = (t: string) => entries.filter((e) => e.sourceType === t).map((e) => e.sourceId);
    const [orders, sales, purchases] = await Promise.all([
      prisma.order.findMany({ where: { id: { in: ids('order') } }, select: { id: true, number: true, clientName: true } }),
      prisma.sale.findMany({ where: { id: { in: ids('sale') } }, select: { id: true, number: true, customerName: true, client: { select: { name: true } } } }),
      prisma.purchase.findMany({ where: { id: { in: ids('purchase') } }, select: { id: true, number: true, supplier: { select: { name: true } } } }),
    ]);
    const doc = new Map<string, { number: string; party: string | null }>([
      ...orders.map((o) => [o.id, { number: o.number, party: o.clientName }] as const),
      ...sales.map((s) => [s.id, { number: s.number, party: s.client?.name ?? s.customerName ?? ctx.walkIn }] as const),
      ...purchases.map((p) => [p.id, { number: p.number, party: p.supplier?.name ?? null }] as const),
    ]);
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = entries
      .map((e) => {
        const d = doc.get(e.sourceId);
        return { date: iso(e.paidAt), documentType: e.sourceType, number: d?.number ?? null, party: d?.party ?? null, method: e.method, direction: e.sourceType === 'purchase' ? 'out' : 'in', amount: e.amount, reference: e.reference, _ref: { type: e.sourceType as 'order' | 'sale' | 'purchase', id: e.sourceId } };
      })
      .filter((row) => !q || [row.number, row.party, row.reference].some((v) => v?.toLowerCase().includes(q)));
    const received = rows.filter((x) => x.direction === 'in').reduce((s, x) => s + n(x.amount), 0);
    const paid = rows.filter((x) => x.direction === 'out').reduce((s, x) => s + n(x.amount), 0);
    return { rows, kpis: { received, paid, count: rows.length } };
  },

  async inventory_valuation(ctx) {
    const lines = await stockLines(ctx.workspaceId, { categoryId: str(ctx, 'categoryId') });
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = lines
      .filter((l) => !q || [l.product, l.variant, l.sku].some((v) => v?.toLowerCase().includes(q)))
      .map((l) => {
        const stock = Math.max(0, l.stock);
        return { product: l.product, variant: l.variant, sku: l.sku, category: l.category, stock, costPrice: l.costPrice, valueAtCost: stock * l.costPrice, price: l.price, valueAtRetail: stock * l.price, _ref: productRef(l.productId) };
      });
    return { rows, kpis: { valueAtCost: sumOf(rows, 'valueAtCost'), valueAtRetail: sumOf(rows, 'valueAtRetail'), units: sumOf(rows, 'stock'), lines: rows.length } };
  },

  async stock_alerts(ctx) {
    const lines = await stockLines(ctx.workspaceId, { categoryId: str(ctx, 'categoryId') });
    const q = str(ctx, 'q')?.toLowerCase();
    // CAT-09 / AT-GDS-16: an alert fires when quantity ≤ minimum (variants on their own line — GDS-10 fix)
    const rows: ReportRow[] = lines
      .filter((l) => l.stock <= l.minStock && (!q || [l.product, l.variant, l.sku].some((v) => v?.toLowerCase().includes(q))))
      .map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, category: l.category, stock: l.stock, minStock: l.minStock, state: l.stock <= 0 ? 'out' : 'low', reorderQty: Math.max(2 * l.minStock - l.stock, l.stock <= 0 ? 1 : 0), _ref: productRef(l.productId) }));
    return { rows, kpis: { outCount: rows.filter((x) => x.state === 'out').length, lowCount: rows.filter((x) => x.state === 'low').length } };
  },

  async dead_stock(ctx) {
    const days = n(ctx.filters.days) || 60;
    const lines = await deadStock(ctx.workspaceId, days, { categoryId: str(ctx, 'categoryId') }, ctx.now);
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = lines
      .filter((l) => !q || [l.product, l.variant, l.sku].some((v) => v?.toLowerCase().includes(q)))
      .map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, stock: l.stock, valueAtCost: l.valueAtCost, lastSoldAt: day(l.lastSoldAt), daysSinceSale: l.daysSinceSale, _ref: productRef(l.productId) }));
    return { rows, kpis: { items: rows.length, valueAtCost: sumOf(rows, 'valueAtCost') } };
  },

  async stock_aging(ctx) {
    const range = r(ctx);
    const [lines, sold, receipts] = await Promise.all([
      stockLines(ctx.workspaceId, { categoryId: str(ctx, 'categoryId') }),
      soldLines(ctx),
      prisma.$queryRaw<{ pid: string; vid: string | null; at: Date }[]>`
        SELECT "productId" pid, "variantId" vid, max("createdAt") at FROM "StockMovement"
        WHERE "workspaceId" = ${ws(ctx)} AND "type" = 'in' AND "reason" = 'purchase' GROUP BY 1,2`,
    ]);
    const key = (p: string, v: string | null) => `${p}:${v ?? ''}`;
    const soldBy = new Map(sold.map((l) => [key(l.pid, l.vid), l.qty]));
    const recBy = new Map(receipts.map((x) => [key(x.pid, x.vid), x.at]));
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = lines
      .filter((l) => !q || [l.product, l.variant, l.sku].some((v) => v?.toLowerCase().includes(q)))
      .map((l) => {
        const qty = soldBy.get(key(l.productId, l.variantId)) ?? 0;
        const perDay = qty / range.days;
        const last = recBy.get(key(l.productId, l.variantId)) ?? null;
        return {
          product: l.product,
          variant: l.variant,
          sku: l.sku,
          stock: l.stock,
          soldQty: qty,
          avgDailySales: round1(perDay),
          coverDays: perDay > 0 ? Math.floor(Math.max(0, l.stock) / perDay) : null,
          lastReceivedAt: day(last),
          ageDays: Math.floor((ctx.now.getTime() - (last ?? l.createdAt).getTime()) / 86_400_000),
          _ref: productRef(l.productId),
        };
      });
    const covers = rows.map((x) => x.coverDays).filter((v): v is number => typeof v === 'number');
    return { rows, kpis: { items: rows.length, avgCoverDays: covers.length ? Math.round(covers.reduce((s, v) => s + v, 0) / covers.length) : null } };
  },

  async inventory_variances(ctx) {
    const { gte, lt } = r(ctx);
    const cat = str(ctx, 'categoryId');
    const prod = str(ctx, 'productId');
    const moves = await prisma.stockMovement.findMany({
      where: { type: { in: ['inventory', 'adjustment_in', 'adjustment_out'] }, createdAt: { gte, lt }, ...(prod ? { productId: prod } : {}), ...(cat ? { product: { categoryId: cat } } : {}) },
      include: { product: { select: { name: true, costPrice: true } }, variant: { select: { name: true, costPrice: true } }, actor: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const invIds = [...new Set(moves.filter((m) => m.refType === 'inventory' && m.refId).map((m) => m.refId!))];
    const counts = invIds.length ? await prisma.inventoryCount.findMany({ where: { id: { in: invIds } }, select: { id: true, number: true } }) : [];
    const invNo = new Map(counts.map((c) => [c.id, c.number]));
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = moves
      .map((m) => {
        const cost = m.variant?.costPrice ?? m.product.costPrice ?? 0;
        return {
          date: iso(m.createdAt),
          product: m.product.name,
          variant: m.variant?.name ?? null,
          type: m.type,
          reason: m.reason,
          quantity: m.quantity,
          before: m.quantityBefore,
          after: m.quantityAfter,
          valueAtCost: m.quantity * cost,
          reference: m.refType === 'inventory' && m.refId ? `#${invNo.get(m.refId) ?? ''}` : (m.note ?? null),
          actor: m.actor ? `${m.actor.firstName} ${m.actor.lastName}`.trim() : null,
          _ref: productRef(m.productId),
        };
      })
      .filter((row) => !q || [row.product, row.variant, row.reference].some((v) => v?.toLowerCase().includes(q)));
    return { rows, kpis: { movements: rows.length, unitsIn: rows.filter((x) => n(x.quantity) > 0).reduce((s, x) => s + n(x.quantity), 0), unitsOut: -rows.filter((x) => n(x.quantity) < 0).reduce((s, x) => s + n(x.quantity), 0), valueAtCost: sumOf(rows, 'valueAtCost') } };
  },

  async purchases_by_supplier(ctx) {
    const { gte, lt } = r(ctx);
    const sup = str(ctx, 'supplierId');
    const q = like(ctx);
    const rows0 = await prisma.$queryRaw<{ sid: string | null; name: string | null; c: number; total: bigint; paid: bigint; last: Date }[]>`
      SELECT p."supplierId" sid, s."name" name, count(*)::int c, sum(p."total")::bigint total, sum(p."amountPaid")::bigint paid, max(p."purchasedAt") last
      FROM "Purchase" p LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      WHERE p."workspaceId" = ${ws(ctx)} AND p."status" NOT IN ('draft', 'cancelled') AND p."purchasedAt" >= ${gte} AND p."purchasedAt" < ${lt}
        ${sup ? Prisma.sql`AND p."supplierId" = ${sup}::uuid` : Prisma.empty} ${q ? Prisma.sql`AND s."name" ILIKE ${q}` : Prisma.empty}
      GROUP BY 1,2`;
    const rows: ReportRow[] = rows0.map((x) => ({ supplier: x.name, purchases: x.c, total: n(x.total), paid: n(x.paid), remaining: n(x.total) - n(x.paid), lastPurchaseAt: day(x.last), _ref: x.sid ? { type: 'supplier', id: x.sid } : null }));
    return { rows, kpis: { total: sumOf(rows, 'total'), paid: sumOf(rows, 'paid'), remaining: sumOf(rows, 'remaining'), suppliers: rows.filter((x) => x._ref).length } };
  },

  async purchases_by_period(ctx) {
    const { gte, lt } = r(ctx);
    const sup = str(ctx, 'supplierId');
    const q = str(ctx, 'q');
    const list = await prisma.purchase.findMany({
      where: { status: { notIn: ['draft', 'cancelled'] }, purchasedAt: { gte, lt }, ...(sup ? { supplierId: sup } : {}), ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }] } : {}) },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ purchasedAt: 'asc' }, { id: 'asc' }],
    });
    const rows: ReportRow[] = list.map((p) => ({ date: day(p.purchasedAt), number: p.number, supplier: p.supplier?.name ?? null, status: p.status, total: p.total, paid: p.amountPaid, remaining: p.total - p.amountPaid, _ref: { type: 'purchase', id: p.id } }));
    return { rows, kpis: { total: sumOf(rows, 'total'), paid: sumOf(rows, 'paid'), remaining: sumOf(rows, 'remaining'), purchases: rows.length } };
  },

  async product_purchases(ctx) {
    const { gte, lt } = r(ctx);
    const sup = str(ctx, 'supplierId');
    const cat = str(ctx, 'categoryId');
    const prod = str(ctx, 'productId');
    const q = like(ctx);
    const rows0 = await prisma.$queryRaw<{ pid: string; vid: string | null; product: string; variant: string | null; sku: string | null; qty: bigint; rec: bigint; total: bigint; c: number }[]>`
      SELECT i."productId" pid, i."variantId" vid, pr."name" product, v."name" variant, coalesce(v."sku", pr."sku") sku,
             sum(i."quantity")::bigint qty, sum(i."receivedQty")::bigint rec, sum(i."total")::bigint total, count(DISTINCT p."id")::int c
      FROM "PurchaseItem" i JOIN "Purchase" p ON p."id" = i."purchaseId" JOIN "Product" pr ON pr."id" = i."productId" LEFT JOIN "ProductVariant" v ON v."id" = i."variantId"
      WHERE p."workspaceId" = ${ws(ctx)} AND p."status" NOT IN ('draft', 'cancelled') AND p."purchasedAt" >= ${gte} AND p."purchasedAt" < ${lt}
        ${sup ? Prisma.sql`AND p."supplierId" = ${sup}::uuid` : Prisma.empty} ${cat ? Prisma.sql`AND pr."categoryId" = ${cat}::uuid` : Prisma.empty}
        ${prod ? Prisma.sql`AND pr."id" = ${prod}::uuid` : Prisma.empty} ${q ? Prisma.sql`AND (pr."name" ILIKE ${q} OR pr."sku" ILIKE ${q})` : Prisma.empty}
      GROUP BY 1,2,3,4,5`;
    const rows: ReportRow[] = rows0.map((x) => ({ product: x.product, variant: x.variant, sku: x.sku, qtyOrdered: n(x.qty), qtyReceived: n(x.rec), total: n(x.total), avgUnitCost: n(x.qty) ? Math.round(n(x.total) / n(x.qty)) : null, purchases: x.c, _ref: productRef(x.pid) }));
    return { rows, kpis: { total: sumOf(rows, 'total'), units: sumOf(rows, 'qtyOrdered'), products: new Set(rows0.map((x) => x.pid)).size } };
  },

  async top_suppliers(ctx) {
    const { gte, lt } = r(ctx);
    const rows0 = await prisma.$queryRaw<{ sid: string; name: string; c: number; total: bigint; lead: number | null }[]>`
      SELECT p."supplierId" sid, s."name" name, count(*)::int c, sum(p."total")::bigint total,
             avg(EXTRACT(EPOCH FROM (p."receivedAt" - p."purchasedAt")) / 86400.0) FILTER (WHERE p."receivedAt" IS NOT NULL)::float8 lead
      FROM "Purchase" p JOIN "Supplier" s ON s."id" = p."supplierId"
      WHERE p."workspaceId" = ${ws(ctx)} AND p."status" NOT IN ('draft', 'cancelled') AND p."purchasedAt" >= ${gte} AND p."purchasedAt" < ${lt}
      GROUP BY 1,2`;
    const total = rows0.reduce((s, x) => s + n(x.total), 0);
    const rows: ReportRow[] = rows0
      .sort((a, b) => n(b.total) - n(a.total))
      .map((x, i) => ({ rank: i + 1, supplier: x.name, purchases: x.c, total: n(x.total), sharePct: pct(n(x.total), total), avgLeadDays: round1(x.lead), _ref: { type: 'supplier', id: x.sid } }));
    return { rows, kpis: { total, suppliers: rows.length } };
  },

  async cash_register(ctx) {
    const { gte, lt } = r(ctx);
    const [before, txs] = await Promise.all([
      prisma.$queryRaw<{ b: bigint }[]>`SELECT coalesce(sum(CASE WHEN "type" = 'income' THEN "amount" ELSE -"amount" END), 0)::bigint b FROM "CashTransaction" WHERE "workspaceId" = ${ws(ctx)} AND "date" < ${gte}`,
      prisma.cashTransaction.findMany({ where: { date: { gte, lt } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], include: { proof: { select: { storageKey: true } } } }),
    ]);
    const docOf = await cashDocuments(txs);
    const opening = n(before[0]?.b);
    let balance = opening;
    const q = str(ctx, 'q')?.toLowerCase();
    // `proof` carries the storage key; the report service turns it into a signed link (file column)
    const all: ReportRow[] = txs.map((t) => {
      balance += t.type === 'income' ? t.amount : -t.amount;
      const doc = docOf(t);
      return { date: iso(t.date), description: t.description, reference: doc?.number ?? t.reference, category: t.category, method: t.method, income: t.type === 'income' ? t.amount : 0, expense: t.type === 'expense' ? t.amount : 0, balance, proof: t.proof?.storageKey ?? null, _ref: doc ? { type: doc.type, id: doc.id } : null };
    });
    const rows = q ? all.filter((x) => [x.description, x.reference].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))) : all;
    const income = sumOf(all, 'income');
    const expense = sumOf(all, 'expense');
    return { rows, kpis: { openingBalance: opening, income, expense, closingBalance: opening + income - expense } };
  },

  async cash_flow(ctx) {
    const range = r(ctx);
    const [before, days] = await Promise.all([
      prisma.$queryRaw<{ b: bigint }[]>`SELECT coalesce(sum(CASE WHEN "type" = 'income' THEN "amount" ELSE -"amount" END), 0)::bigint b FROM "CashTransaction" WHERE "workspaceId" = ${ws(ctx)} AND "date" < ${range.gte}`,
      prisma.$queryRaw<{ d: string; inc: bigint; exp: bigint }[]>`
        SELECT to_char("date" + interval '1 hour', 'YYYY-MM-DD') d, coalesce(sum("amount") FILTER (WHERE "type" = 'income'), 0)::bigint inc, coalesce(sum("amount") FILTER (WHERE "type" = 'expense'), 0)::bigint exp
        FROM "CashTransaction" WHERE "workspaceId" = ${ws(ctx)} AND "date" >= ${range.gte} AND "date" < ${range.lt} GROUP BY 1`,
    ]);
    const by = new Map(days.map((x) => [x.d, x]));
    const opening = n(before[0]?.b);
    let balance = opening;
    const rows: ReportRow[] = eachDay(range.from, range.to).map((d) => {
      const x = by.get(d);
      const income = n(x?.inc);
      const expense = n(x?.exp);
      balance += income - expense;
      return { day: d, income, expense, net: income - expense, balance, _ref: null };
    });
    const income = sumOf(rows, 'income');
    const expense = sumOf(rows, 'expense');
    return { rows, kpis: { openingBalance: opening, income, expense, net: income - expense, closingBalance: opening + income - expense } };
  },

  async expenses(ctx) {
    const { gte, lt } = r(ctx);
    const prod = str(ctx, 'productId');
    const [cash, pex] = await Promise.all([
      prod
        ? Promise.resolve([])
        : prisma.cashTransaction.findMany({
            where: { type: 'expense', date: { gte, lt }, OR: [{ isAutomatic: false, category: { in: ['rent', 'salary', 'utilities', 'marketing', 'shipping', 'other'] } }, { isAutomatic: true, category: 'shipping', sourceType: 'order' }] },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
          }),
      productExpenses(ctx),
    ]);
    const q = str(ctx, 'q')?.toLowerCase();
    const rows: ReportRow[] = [
      ...cash.map((t) => ({ date: day(t.date), kind: t.isAutomatic ? 'return' : 'cash', category: t.category, description: t.description, product: null, amount: t.amount, _ref: t.isAutomatic && t.sourceId ? { type: 'order' as const, id: t.sourceId } : null })),
      ...pex.filter((e) => !prod || e.pid === prod).map((e) => ({ date: day(e.date), kind: 'product', category: e.category, description: e.isPerUnit ? `${e.description ?? ''} (${e.units} ×)`.trim() : e.description, product: e.product, amount: e.amount, _ref: productRef(e.pid) })),
    ].filter((x) => !q || [x.description, x.product, x.category].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
    const by = (k: string) => rows.filter((x) => x.kind === k).reduce((s, x) => s + n(x.amount), 0);
    return { rows, kpis: { total: sumOf(rows, 'amount'), manual: by('cash'), product: by('product'), returns: by('return') } };
  },

  async top_customers(ctx) {
    const { gte, lt } = r(ctx);
    const q = like(ctx);
    const rows0 = await prisma.$queryRaw<{ cid: string; name: string; phone: string | null; last: Date | null; orders: number; sales: number; rev: bigint }[]>`
      SELECT c."id" cid, c."name" name, c."phone" phone, c."lastOrderAt" last, sum(x.orders)::int orders, sum(x.sales)::int sales, sum(x.rev)::bigint rev
      FROM (
        SELECT o."clientId" cid, 1 orders, 0 sales, o."total" rev FROM "Order" o
        WHERE o."workspaceId" = ${ws(ctx)} AND o."status" = 'delivered' AND o."deliveredAt" >= ${gte} AND o."deliveredAt" < ${lt}
        UNION ALL
        SELECT s."clientId", 0, 1, s."total" FROM "Sale" s
        WHERE s."workspaceId" = ${ws(ctx)} AND s."status" = 'completed' AND s."clientId" IS NOT NULL AND s."soldAt" >= ${gte} AND s."soldAt" < ${lt}
      ) x JOIN "Client" c ON c."id" = x.cid
      WHERE true ${q ? Prisma.sql`AND (c."name" ILIKE ${q} OR c."phone" ILIKE ${q})` : Prisma.empty}
      GROUP BY 1,2,3,4`;
    const rows: ReportRow[] = rows0
      .sort((a, b) => n(b.rev) - n(a.rev))
      .map((x, i) => ({ rank: i + 1, client: x.name, phone: x.phone, orders: x.orders, sales: x.sales, revenue: n(x.rev), lastOrderAt: day(x.last), _ref: { type: 'client', id: x.cid } }));
    return { rows, kpis: { clients: rows.length, revenue: sumOf(rows, 'revenue') } };
  },

  async inactive_customers(ctx) {
    const days = n(ctx.filters.days) || 90;
    const before = new Date(ctx.now.getTime() - days * 86_400_000);
    const q = str(ctx, 'q');
    const list = await prisma.client.findMany({
      where: { deletedAt: null, mergedIntoId: null, orderCount: { gt: 0 }, lastOrderAt: { lt: before }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}) },
      select: { id: true, name: true, phone: true, orderCount: true, totalSpent: true, lastOrderAt: true },
    });
    const rows: ReportRow[] = list.map((c) => ({ client: c.name, phone: c.phone, orders: c.orderCount, totalSpent: c.totalSpent, lastOrderAt: day(c.lastOrderAt), daysInactive: Math.floor((ctx.now.getTime() - c.lastOrderAt!.getTime()) / 86_400_000), _ref: { type: 'client', id: c.id } }));
    return { rows, kpis: { clients: rows.length, totalSpent: sumOf(rows, 'totalSpent') } };
  },
};
