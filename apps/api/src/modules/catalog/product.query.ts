// 06 §10 "Produits" — filters and sorts of `GET /products`, as one SQL statement returning the ids of the page
// (computed filters: margin, stock state incl. variants, trigram search). 07-non-functional: p95 < 500 ms at 10 k products.
import { prisma, Prisma, TenantContext } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { algiersDayEnd, algiersDayStart } from '../../core/time/algiers';
import { likePattern } from './catalog.util';
import { MARGIN_PERIOD_DAYS, MARGIN_SOLD_STATUSES } from './margin.calculator';
import type { ProductsQuery } from './dto';

const VARIANT_LOW = Prisma.sql`EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive" AND v."stock" <= v."minStock")`;
/** CAT-09 alert: tracked and (quantity ≤ minStock, or one active variant at or below its own threshold). */
const ALERT = Prisma.sql`(p."trackStock" AND (COALESCE(p."stock", 0) <= p."minStock" OR ${VARIANT_LOW}))`;
const OUT = Prisma.sql`(p."trackStock" AND COALESCE(p."stock", 0) <= 0)`;

const SORT_SQL: Record<string, Prisma.Sql> = {
  name: Prisma.sql`lower(p."name")`,
  sku: Prisma.sql`lower(p."sku")`,
  price: Prisma.sql`p."price"`,
  cost: Prisma.sql`p."costPrice"`,
  stock: Prisma.sql`p."stock"`,
  updatedAt: Prisma.sql`p."updatedAt"`,
};

const or = (parts: Prisma.Sql[]) => Prisma.sql`(${Prisma.join(parts, ' OR ')})`;

export const productWhere = (q: Partial<ProductsQuery>): Prisma.Sql => {
  const ws = TenantContext.workspaceId();
  const and: Prisma.Sql[] = [Prisma.sql`p."workspaceId" = ${ws}::uuid`];

  // status: archived rows only on request (CAT-10)
  const status = new Set<string>(q.status ?? []);
  if (q.active === true) status.add('active');
  if (q.active === false) status.add('inactive');
  if (!status.size) and.push(Prisma.sql`p."deletedAt" IS NULL`);
  else {
    const parts: Prisma.Sql[] = [];
    if (status.has('active')) parts.push(Prisma.sql`(p."deletedAt" IS NULL AND p."isActive")`);
    if (status.has('inactive')) parts.push(Prisma.sql`(p."deletedAt" IS NULL AND NOT p."isActive")`);
    if (status.has('archived')) parts.push(Prisma.sql`p."deletedAt" IS NOT NULL`);
    and.push(or(parts));
  }

  if (q.ids?.length) and.push(Prisma.sql`p."id" = ANY(${q.ids}::uuid[])`);
  if (q.categoryIds?.length) {
    // a parent category also selects the products of its sub-categories
    and.push(Prisma.sql`p."categoryId" IN (SELECT c."id" FROM "Category" c WHERE c."workspaceId" = ${ws}::uuid AND (c."id" = ANY(${q.categoryIds}::uuid[]) OR c."parentId" = ANY(${q.categoryIds}::uuid[])))`);
  }
  if (q.type?.length) {
    const parts: Prisma.Sql[] = [];
    if (q.type.includes('stock')) parts.push(Prisma.sql`p."trackStock"`);
    if (q.type.includes('service')) parts.push(Prisma.sql`NOT p."trackStock"`);
    if (q.type.includes('variants')) parts.push(Prisma.sql`p."hasVariants"`);
    if (q.type.includes('no_variants')) parts.push(Prisma.sql`NOT p."hasVariants"`);
    and.push(or(parts));
  }
  const states = new Set<string>(q.stockState ?? []);
  if (states.size) {
    const parts: Prisma.Sql[] = [];
    if (states.has('low')) parts.push(Prisma.sql`(${ALERT} AND NOT ${OUT})`);
    if (states.has('out')) parts.push(OUT);
    if (states.has('in_stock')) parts.push(Prisma.sql`(p."trackStock" AND COALESCE(p."stock", 0) > 0)`);
    and.push(or(parts));
  }
  if (q.lowStock) and.push(ALERT);

  if (q.minQty !== undefined) and.push(Prisma.sql`p."stock" >= ${q.minQty}`);
  if (q.maxQty !== undefined) and.push(Prisma.sql`p."stock" <= ${q.maxQty}`);
  if (q.minPrice !== undefined) and.push(Prisma.sql`p."price" >= ${q.minPrice}`);
  if (q.maxPrice !== undefined) and.push(Prisma.sql`p."price" <= ${q.maxPrice}`);
  if (q.minCost !== undefined) and.push(Prisma.sql`p."costPrice" >= ${q.minCost}`);
  if (q.maxCost !== undefined) and.push(Prisma.sql`p."costPrice" <= ${q.maxCost}`);
  // the margin of the list and of the product page: true cost = cost + per-unit expenses + the 30-day fixed expenses
  // shared over the units sold in 30 days (margin.calculator, EXP-02)
  const since = new Date(Date.now() - MARGIN_PERIOD_DAYS * 86_400_000);
  const perUnit = Prisma.sql`COALESCE((SELECT sum(e."amount") FROM "ProductExpense" e WHERE e."productId" = p."id" AND e."isPerUnit"), 0)`;
  const fixed = Prisma.sql`COALESCE((SELECT sum(e."amount") FROM "ProductExpense" e WHERE e."productId" = p."id" AND NOT e."isPerUnit" AND e."date" >= ${since}), 0)`;
  const sold = Prisma.sql`((SELECT COALESCE(sum(i."quantity"), 0) FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" WHERE i."productId" = p."id" AND o."status"::text = ANY(${[...MARGIN_SOLD_STATUSES]}::text[]) AND o."orderedAt" >= ${since})
    + (SELECT COALESCE(sum(i."quantity"), 0) FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId" WHERE i."productId" = p."id" AND s."status" = 'completed' AND s."soldAt" >= ${since}))`;
  const margin = Prisma.sql`((p."price" - (p."costPrice" + ${perUnit} + round(${fixed}::numeric / GREATEST(${sold}, 1)))) * 100.0 / NULLIF(p."price", 0))`;
  if (q.minMargin !== undefined) and.push(Prisma.sql`(p."costPrice" IS NOT NULL AND ${margin} >= ${q.minMargin})`);
  if (q.maxMargin !== undefined) and.push(Prisma.sql`(p."costPrice" IS NOT NULL AND ${margin} <= ${q.maxMargin})`);

  if (q.agentId?.length) and.push(Prisma.sql`EXISTS (SELECT 1 FROM "AgentProduct" ap WHERE ap."productId" = p."id" AND ap."agentId" = ANY(${q.agentId}::uuid[]))`);
  if (q.noAgent) and.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "AgentProduct" ap WHERE ap."productId" = p."id")`);
  // same set as the supplier sheet's `productCount` (purchases of any status but cancelled)
  if (q.supplierId) and.push(Prisma.sql`EXISTS (SELECT 1 FROM "PurchaseItem" pi JOIN "Purchase" pu ON pu."id" = pi."purchaseId" WHERE pi."productId" = p."id" AND pu."workspaceId" = ${ws}::uuid AND pu."supplierId" = ${q.supplierId}::uuid AND pu."status" <> 'cancelled')`);
  if (q.moderationStatus?.length) and.push(Prisma.sql`p."moderationStatus"::text = ANY(${q.moderationStatus}::text[])`);

  if (q.createdFrom) and.push(Prisma.sql`p."createdAt" >= ${algiersDayStart(q.createdFrom)}`);
  if (q.createdTo) and.push(Prisma.sql`p."createdAt" < ${algiersDayEnd(q.createdTo)}`);
  if (q.updatedFrom) and.push(Prisma.sql`p."updatedAt" >= ${algiersDayStart(q.updatedFrom)}`);
  if (q.updatedTo) and.push(Prisma.sql`p."updatedAt" < ${algiersDayEnd(q.updatedTo)}`);

  // search (accent-insensitive via f_unaccent, migration m2_unaccent_search): substring on name / SKU / keywords, plus trigram word similarity on the name for typos (min 2 chars)
  if (q.q && q.q.length >= 2) {
    const pattern = likePattern(q.q);
    and.push(
      Prisma.sql`(f_unaccent(p."name") ILIKE f_unaccent(${pattern}) OR p."sku" ILIKE ${pattern} OR f_unaccent(array_to_string(p."keywords", ' ')) ILIKE f_unaccent(${pattern}) OR f_unaccent(${q.q}::text) <% f_unaccent(p."name"))`,
    );
  }
  return Prisma.join(and, ' AND ');
};

/** Sort whitelist of 06 §10: name | sku | price | cost | stock | updatedAt (unknown field ⇒ 400 BAD_REQUEST). */
export const productOrder = (sort: string | undefined): Prisma.Sql => {
  const s = sort ?? '-updatedAt';
  const field = s.replace(/^-/, '');
  const column = SORT_SQL[field];
  if (!column) throw new AppException('BAD_REQUEST');
  const dir = s.startsWith('-') ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  // ties broken by id (08-coder-playbook §6 "Sort"); products without the value come last
  return Prisma.sql`${column} ${dir} NULLS LAST, p."id" DESC`;
};

export const findProductIds = async (q: ProductsQuery, paging?: { skip: number; take: number }): Promise<{ ids: string[]; total: number }> => {
  const where = productWhere(q);
  const order = productOrder(q.sort);
  const limit = paging ? Prisma.sql`LIMIT ${paging.take} OFFSET ${paging.skip}` : Prisma.sql`LIMIT 50000`;
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT p."id" FROM "Product" p WHERE ${where} ORDER BY ${order} ${limit}`,
    paging ? prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Product" p WHERE ${where}` : Promise.resolve([]),
  ]);
  return { ids: rows.map((r) => r.id), total: paging ? (count[0]?.n ?? 0) : rows.length };
};

/**
 * `GET /products/stats` (M2 carry-over, "KPIs follow the filters"): counts and stock value of the rows the list would
 * return. Variant products count their active variants (value at the variant cost, else the product cost).
 */
export const productStats = async (q: Partial<ProductsQuery>, advanced: boolean) => {
  const where = productWhere(q);
  const qty = Prisma.sql`CASE WHEN p."hasVariants" THEN COALESCE((SELECT sum(GREATEST(v."stock", 0)) FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive"), 0) ELSE GREATEST(COALESCE(p."stock", 0), 0) END`;
  const cost = Prisma.sql`CASE WHEN p."hasVariants" THEN COALESCE((SELECT sum(GREATEST(v."stock", 0)::bigint * COALESCE(v."costPrice", p."costPrice", 0)) FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive"), 0) ELSE GREATEST(COALESCE(p."stock", 0), 0)::bigint * COALESCE(p."costPrice", 0) END`;
  const retail = Prisma.sql`CASE WHEN p."hasVariants" THEN COALESCE((SELECT sum(GREATEST(v."stock", 0)::bigint * v."price") FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive"), 0) ELSE GREATEST(COALESCE(p."stock", 0), 0)::bigint * p."price" END`;
  const [r] = await prisma.$queryRaw<{ total: number; active: number; inactive: number; archived: number; services: number; low: number; out: number; items: number; cost: number; retail: number }[]>`
    SELECT count(*)::int AS total,
      (count(*) FILTER (WHERE p."deletedAt" IS NULL AND p."isActive"))::int AS active,
      (count(*) FILTER (WHERE p."deletedAt" IS NULL AND NOT p."isActive"))::int AS inactive,
      (count(*) FILTER (WHERE p."deletedAt" IS NOT NULL))::int AS archived,
      (count(*) FILTER (WHERE NOT p."trackStock"))::int AS services,
      (count(*) FILTER (WHERE ${ALERT} AND NOT ${OUT}))::int AS low,
      (count(*) FILTER (WHERE ${OUT}))::int AS out,
      COALESCE(sum(${qty}) FILTER (WHERE p."trackStock"), 0)::int AS items,
      COALESCE(sum(${cost}) FILTER (WHERE p."trackStock"), 0)::float8 AS cost,
      COALESCE(sum(${retail}) FILTER (WHERE p."trackStock"), 0)::float8 AS retail
    FROM "Product" p WHERE ${where}`;
  return {
    total: r?.total ?? 0,
    active: r?.active ?? 0,
    inactive: r?.inactive ?? 0,
    archived: r?.archived ?? 0,
    services: r?.services ?? 0,
    lowStock: r?.low ?? 0,
    outOfStock: r?.out ?? 0,
    totalItems: r?.items ?? 0,
    // simple mode has no cost price (ONB-03)
    valueAtCost: advanced ? Math.round(r?.cost ?? 0) : null,
    valueAtRetail: Math.round(r?.retail ?? 0),
  };
};
