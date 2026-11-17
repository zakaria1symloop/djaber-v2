// Stock lines shared by the stock reports (valuation, alerts, dead stock, aging) and the analytics Produits tab.
// GDS-10 fixes: untracked products are excluded; variants are reported on their own line (stock alerts incl. variants).
import { Prisma, prisma } from '@djaber/db';

export type StockLine = {
  productId: string;
  variantId: string | null;
  product: string;
  variant: string | null;
  sku: string | null;
  categoryId: string | null;
  category: string | null;
  stock: number;
  minStock: number;
  /** null = unknown (journeys 16/11 J11-3: never counted as 0 DA — the value at cost leaves the line out) */
  costPrice: number | null;
  price: number;
  createdAt: Date;
};

/** Tracked, live products without variants + active variants of tracked products (archived ones excluded). */
export async function stockLines(workspaceId: string, f: { categoryId?: string; productId?: string } = {}): Promise<StockLine[]> {
  const cat = f.categoryId ? Prisma.sql`AND p."categoryId" = ${f.categoryId}::uuid` : Prisma.empty;
  const prod = f.productId ? Prisma.sql`AND p."id" = ${f.productId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ pid: string; vid: string | null; product: string; variant: string | null; sku: string | null; cid: string | null; category: string | null; stock: number; min: number; cost: number | null; price: number; created: Date }[]>`
    SELECT p."id" pid, NULL::uuid vid, p."name" product, NULL::text variant, p."sku" sku, p."categoryId" cid, c."name" category,
           coalesce(p."stock", 0) stock, p."minStock" min, p."costPrice" cost, p."price" price, p."createdAt" created
    FROM "Product" p LEFT JOIN "Category" c ON c."id" = p."categoryId"
    WHERE p."workspaceId" = ${workspaceId}::uuid AND p."deletedAt" IS NULL AND p."trackStock" = true AND p."hasVariants" = false ${cat} ${prod}
    UNION ALL
    SELECT p."id", v."id", p."name", v."name", coalesce(v."sku", p."sku"), p."categoryId", c."name",
           v."stock", v."minStock", coalesce(v."costPrice", p."costPrice"), v."price", v."createdAt"
    FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId" LEFT JOIN "Category" c ON c."id" = p."categoryId"
    WHERE v."workspaceId" = ${workspaceId}::uuid AND v."deletedAt" IS NULL AND v."isActive" = true AND p."deletedAt" IS NULL AND p."trackStock" = true AND p."hasVariants" = true ${cat} ${prod}`;
  return rows.map((r) => ({
    productId: r.pid,
    variantId: r.vid,
    product: r.product,
    variant: r.variant,
    sku: r.sku,
    categoryId: r.cid,
    category: r.category,
    stock: Number(r.stock),
    minStock: Number(r.min),
    costPrice: r.cost === null || r.cost === undefined ? null : Number(r.cost),
    price: Number(r.price),
    createdAt: r.created,
  }));
}

const lineKey = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;

/** Last sale of every product / variant: orders not cancelled (orderedAt) and completed counter sales (soldAt). */
export async function lastSales(workspaceId: string): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<{ pid: string; vid: string | null; at: Date }[]>`
    SELECT pid, vid, max(at) at FROM (
      SELECT i."productId" pid, i."variantId" vid, o."orderedAt" at FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE o."workspaceId" = ${workspaceId}::uuid AND o."status" <> 'cancelled'
      UNION ALL
      SELECT i."productId", i."variantId", s."soldAt" FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
      WHERE s."workspaceId" = ${workspaceId}::uuid AND s."status" = 'completed'
    ) x GROUP BY 1,2`;
  const out = new Map<string, Date>();
  for (const r of rows) {
    out.set(lineKey(r.pid, r.vid), r.at);
    // a product line also counts the sales of its variants
    const pk = lineKey(r.pid, null);
    const prev = out.get(pk);
    if (!prev || prev < r.at) out.set(pk, r.at);
  }
  return out;
}

/** `valueAtCost` null when the cost price is unknown (J11-3) */
export type DeadStockLine = StockLine & { lastSoldAt: Date | null; daysSinceSale: number; valueAtCost: number | null };

/** Lines with stock and no sale for `days` days (a never-sold line counts from its creation). */
export async function deadStock(workspaceId: string, days: number, f: { categoryId?: string } = {}, now: Date = new Date()): Promise<DeadStockLine[]> {
  const [lines, sold] = await Promise.all([stockLines(workspaceId, f), lastSales(workspaceId)]);
  const out: DeadStockLine[] = [];
  for (const l of lines) {
    if (l.stock <= 0) continue;
    const last = sold.get(lineKey(l.productId, l.variantId)) ?? null;
    const since = Math.floor((now.getTime() - (last ?? l.createdAt).getTime()) / 86_400_000);
    if (since < days) continue;
    out.push({ ...l, lastSoldAt: last, daysSinceSale: since, valueAtCost: l.costPrice === null ? null : l.stock * l.costPrice });
  }
  return out;
}
