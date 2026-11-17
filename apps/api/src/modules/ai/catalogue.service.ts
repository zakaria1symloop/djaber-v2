// 04-ai-pipeline §3.5 / §16 — the catalogue an agent may talk about. One filter for the prompt, the tools, the cards and
// the vision candidates: products in the agent's scope that are active, not archived and approved by moderation (AI-14, D36).
import { Injectable } from '@nestjs/common';
import { prisma, Prisma, TenantContext, type Agent } from '@djaber/db';
import { approvedFields, approvedImages, approvedVariants } from '../catalog/approved-content';
import { reservedQuantities } from '../catalog/stock.service';
import { FULL_CATALOGUE_MAX, RETRIEVAL_TOP } from './ai.constants';

export type AgentScope = Pick<Agent, 'id' | 'sellAllProducts' | 'catalogScope' | 'scopeCategoryIds'>;
export type CatalogueVariant = { id: string; name: string; price: number; stock: number };
export type CatalogueProduct = {
  id: string;
  name: string;
  sku: string;
  price: number;
  oldPrice: number | null;
  /** null = service (no stock tracking) */
  stock: number | null;
  /** orders taken at zero stock (PV 22/10): STOCK 0 is not « out of stock » for this product */
  sellOutOfStock: boolean;
  description: string | null;
  hasVariants: boolean;
  variants: CatalogueVariant[];
  imageUrl: string | null;
  /** storage key of the primary image (vision pass 2 reads the file) */
  imageKey: string | null;
  category: string | null;
  also: { id: string; name: string; price: number; reason: string | null }[];
};
/** `awaitingReview` (journey 16/11 J04-1): the agent sells nothing yet, but this many of its products wait for Djaber's first review */
export type CatalogueSlice = { count: number; full: boolean; products: CatalogueProduct[]; awaitingReview?: number };

/** 04 §12 "Visibility while pending": a changed product keeps selling its last approved snapshot until the decision. */
const VISIBLE: Prisma.ProductWhereInput = {
  isActive: true,
  deletedAt: null,
  OR: [{ moderationStatus: { in: ['approved', 'not_required'] } }, { moderationStatus: 'pending', approvedSnapshot: { not: Prisma.AnyNull } }],
};
const include = {
  variants: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } },
  // every picture (in order): the first approved one is shown (approvedImages)
  images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  category: { select: { name: true } },
} as const satisfies Prisma.ProductInclude;
type Row = Prisma.ProductGetPayload<{ include: typeof include }>;
/** Edit distance of two strings, stopping above `max` (then `max + 1`). */
const distance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]!);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
};
/**
 * journey retest R7-4: the one candidate id this mistyped id is at most 2 characters away from (hyphens ignored), when every
 * other candidate is at least 6 away — never a guess between two close ids. Two real ids of a shop differ by far more.
 */
export const nearestId = (id: string, candidates: string[]): string | null => {
  const key = id.toLowerCase().replace(/-/g, '');
  const scored = candidates.map((c) => ({ c, d: distance(key, c.toLowerCase().replace(/-/g, ''), 8) })).sort((x, y) => x.d - y.d);
  const [best, next] = scored;
  if (!best || best.d === 0 || best.d > 2) return null;
  return !next || next.d >= 6 ? best.c : null;
};
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class CatalogueService {
  scopeWhere(agent: AgentScope): Prisma.ProductWhereInput {
    if (!agent.sellAllProducts) return { ...VISIBLE, agentProducts: { some: { agentId: agent.id } } };
    if (agent.catalogScope === 'categories') return { ...VISIBLE, categoryId: { in: agent.scopeCategoryIds } };
    return VISIBLE;
  }

  count(agent: AgentScope) {
    return prisma.product.count({ where: this.scopeWhere(agent) });
  }

  /** journey 16/11 J04-1: the agent's active products that wait for their first moderation decision (never shown yet). */
  awaitingReview(agent: AgentScope) {
    const scope: Prisma.ProductWhereInput = !agent.sellAllProducts ? { agentProducts: { some: { agentId: agent.id } } } : agent.catalogScope === 'categories' ? { categoryId: { in: agent.scopeCategoryIds } } : {};
    return prisma.product.count({ where: { ...scope, isActive: true, deletedAt: null, moderationStatus: 'pending', approvedSnapshot: { equals: Prisma.AnyNull } } });
  }

  private async present(rows: Row[], withAlso: boolean, agent?: AgentScope): Promise<CatalogueProduct[]> {
    const also = new Map<string, CatalogueProduct['also']>();
    if (withAlso && rows.length) {
      const recos = await prisma.recommendation.findMany({
        where: { productId: { in: rows.map((r) => r.id) }, isActive: true, recommended: agent ? this.scopeWhere(agent) : VISIBLE },
        orderBy: { score: 'desc' },
        include: { recommended: { select: { id: true, name: true, description: true, price: true, moderationStatus: true, approvedSnapshot: true } } },
      });
      for (const r of recos) {
        const list = also.get(r.productId) ?? [];
        // the approved name and price while a change of the recommended product waits for moderation (UX-038)
        const shown = approvedFields(r.recommended);
        if (list.length < 2) list.push({ id: r.recommended.id, name: shown.name, price: shown.price, reason: r.reason });
        also.set(r.productId, list);
      }
    }
    // what the AI may sell: the stock less what the unconfirmed orders hold (owner decision 2026-10-21)
    const held = await reservedQuantities(prisma, rows.filter((r) => r.trackStock).map((r) => r.id));
    const free = (productId: string, variantId: string | null, stock: number) => Math.max(0, stock - (held.get(`${productId}:${variantId ?? ''}`) ?? 0));
    return rows.map((p) => {
      const image = approvedImages(p, p.images)[0];
      const variants = approvedVariants(p, p.variants);
      return {
        id: p.id,
        ...approvedFields(p),
        sku: p.sku,
        oldPrice: p.oldPrice,
        stock: !p.trackStock ? null : p.hasVariants ? variants.reduce((n, v) => n + free(p.id, v.id, v.stock), 0) : free(p.id, null, p.stock ?? 0),
        sellOutOfStock: p.trackStock && p.sellOutOfStock,
        hasVariants: p.hasVariants,
        variants: p.hasVariants ? variants.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: p.trackStock ? free(p.id, v.id, v.stock) : v.stock })) : [],
        imageUrl: image?.url ?? null,
        imageKey: image?.storageKey ?? null,
        category: p.category?.name ?? null,
        also: also.get(p.id) ?? [],
      };
    });
  }

  /** In-scope products by id, in the order asked; anything out of scope / archived / inactive is silently absent. */
  async byIds(agent: AgentScope, ids: string[], withAlso = false): Promise<CatalogueProduct[]> {
    const valid = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return [];
    const rows = await prisma.product.findMany({ where: { AND: [this.scopeWhere(agent), { id: { in: valid } }] }, include });
    const by = new Map((await this.present(rows, withAlso, agent)).map((p) => [p.id, p]));
    return valid.map((id) => by.get(id)).filter((p): p is CatalogueProduct => !!p);
  }

  /**
   * journey retest R7-4 (17/11): ids the model mistyped (« 01a1e51f-737c-… » for « 01a1e51f-4737-… », « …-9ef5-… » for
   * « …-9fb5-… ») ⇒ the in-scope product each one is one or two characters away from (`nearestId`). Only ids that are not
   * products of the scope are looked at; the server recap then names the product to the customer before anything is ordered.
   */
  async correctIds(agent: AgentScope, ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const wrong = [...new Set(ids)].filter((id) => typeof id === 'string' && /^[0-9a-f-]{28,40}$/i.test(id.trim()));
    if (!wrong.length) return out;
    const rows = await prisma.product.findMany({ where: this.scopeWhere(agent), select: { id: true }, take: 5000 });
    const all = rows.map((r) => r.id);
    // journey retest R8-3: an id that is a product of the shop (archived, out of the agent's scope…) is never moved to a neighbour
    const exact = new Set((await prisma.product.findMany({ where: { id: { in: wrong.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } }, select: { id: true } })).map((r) => r.id));
    for (const id of wrong) {
      if (all.includes(id) || exact.has(id)) continue;
      const near = nearestId(id, all);
      if (near) out.set(id, near);
    }
    return out;
  }

  /** journey retest R8-3: the ids among these that are variants of the shop (any product): never read as a mistyped id. */
  async knownVariantIds(ids: string[]): Promise<Set<string>> {
    const valid = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return new Set();
    return new Set((await prisma.productVariant.findMany({ where: { id: { in: valid } }, select: { id: true } })).map((r) => r.id));
  }

  /**
   * journey retest R8-4 (17/11): the in-scope product of each of these variant ids — an invented product id sent with the exact
   * id of its variant (« 01a1e51f-4180-7000-8000-000000000000 » + the Basket's « 42 ») stands for that product.
   */
  async variantOwners(agent: AgentScope, variantIds: string[]): Promise<Map<string, string>> {
    const valid = [...new Set(variantIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (!valid.length) return new Map();
    const rows = await prisma.productVariant.findMany({ where: { id: { in: valid }, deletedAt: null, product: this.scopeWhere(agent) }, select: { id: true, productId: true } });
    return new Map(rows.map((r) => [r.id, r.productId]));
  }

  /**
   * PV 28/10 (« l'agent IA ne reconnaît pas les photos ») — vision candidates beyond the text search: in-scope products
   * with an approved picture, most recently updated first (a shop of ≤ `limit` such products is compared in full).
   */
  async withImages(agent: AgentScope, limit: number, exclude: string[] = []): Promise<CatalogueProduct[]> {
    if (limit <= 0) return [];
    const rows = await prisma.product.findMany({ where: { AND: [this.scopeWhere(agent), { images: { some: {} } }, ...(exclude.length ? [{ id: { notIn: exclude } }] : [])] }, include, orderBy: { updatedAt: 'desc' }, take: limit * 2 });
    return (await this.present(rows, false, agent)).filter((p) => p.imageKey).slice(0, limit);
  }

  /**
   * Free-text search inside the scope (accent-insensitive substring on name / SKU / keywords / description words, plus
   * trigram word similarity on the name for typos), best match first. `maxWords`: words of the query used (default 8).
   */
  async search(agent: AgentScope, query: string, limit = 10, o: { maxWords?: number } = {}): Promise<CatalogueProduct[]> {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const words = [...new Set(q.split(/\s+/).filter((w) => w.length >= 2))].slice(0, o.maxWords ?? 8);
    if (!words.length) return [];
    const scope: Prisma.Sql[] = [Prisma.sql`p."isActive" = true`, Prisma.sql`p."deletedAt" IS NULL`, Prisma.sql`(p."moderationStatus" IN ('approved','not_required') OR (p."moderationStatus" = 'pending' AND p."approvedSnapshot" IS NOT NULL))`];
    if (!agent.sellAllProducts) scope.push(Prisma.sql`EXISTS (SELECT 1 FROM "AgentProduct" ap WHERE ap."productId" = p."id" AND ap."agentId" = ${agent.id}::uuid)`);
    else if (agent.catalogScope === 'categories') scope.push(agent.scopeCategoryIds.length ? Prisma.sql`p."categoryId" IN (${Prisma.join(agent.scopeCategoryIds.map((c) => Prisma.sql`${c}::uuid`))})` : Prisma.sql`false`);
    const hay = Prisma.sql`f_unaccent(p."name" || ' ' || coalesce(p."sku", '') || ' ' || array_to_string(p."keywords", ' ') || ' ' || coalesce(c."name", ''))`;
    const score = Prisma.join(
      [
        Prisma.sql`(CASE WHEN f_unaccent(p."name") ILIKE f_unaccent(${like(q)}) THEN 4 ELSE 0 END)`,
        Prisma.sql`word_similarity(f_unaccent(${q}::text), f_unaccent(p."name")) * 3`,
        ...words.map((w) => Prisma.sql`(CASE WHEN ${hay} ILIKE f_unaccent(${like(w)}) THEN 1 ELSE 0 END)`),
        ...words.map((w) => Prisma.sql`(CASE WHEN f_unaccent(coalesce(p."description", '')) ILIKE f_unaccent(${like(w)}) THEN 0.3 ELSE 0 END)`),
      ],
      ' + ',
    );
    const rows = await prisma.$queryRaw<{ id: string; score: number }[]>`
      SELECT p."id", (${score})::float AS score
      FROM "Product" p LEFT JOIN "Category" c ON c."id" = p."categoryId"
      WHERE p."workspaceId" = ${TenantContext.workspaceId()}::uuid AND ${Prisma.join(scope, ' AND ')}
      ORDER BY score DESC, p."updatedAt" DESC
      LIMIT ${Math.max(limit * 3, 30)}`;
    const ids = rows.filter((r) => r.score >= 0.9).slice(0, limit).map((r) => r.id);
    return this.byIds(agent, ids);
  }

  /** §3.5: ≤ 60 products ⇒ the whole scope; above ⇒ the last-mentioned products + the best matches of the batch text. */
  async slice(agent: AgentScope, o: { text: string; lastProductIds: string[] }): Promise<CatalogueSlice> {
    const count = await this.count(agent);
    // journey 16/11 J04-1: a new shop's products wait for Djaber (04 §12, manual review by default): the prompt says so
    if (count === 0) {
      const awaitingReview = await this.awaitingReview(agent);
      return { count, full: true, products: [], ...(awaitingReview ? { awaitingReview } : {}) };
    }
    if (count <= FULL_CATALOGUE_MAX) {
      const rows = await prisma.product.findMany({ where: this.scopeWhere(agent), include, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      return { count, full: true, products: await this.present(rows, true, agent) };
    }
    const last = await this.byIds(agent, o.lastProductIds, true);
    const found = o.text.trim() ? await this.search(agent, o.text, RETRIEVAL_TOP) : [];
    const seen = new Set(last.map((p) => p.id));
    return { count, full: false, products: [...last, ...found.filter((p) => !seen.has(p.id))] };
  }
}
