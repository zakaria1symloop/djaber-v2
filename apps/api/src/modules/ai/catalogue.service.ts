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
export type CatalogueSlice = { count: number; full: boolean; products: CatalogueProduct[] };

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
   * Free-text search inside the scope (accent-insensitive substring on name / SKU / keywords / description words, plus
   * trigram word similarity on the name for typos), best match first.
   */
  async search(agent: AgentScope, query: string, limit = 10): Promise<CatalogueProduct[]> {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const words = [...new Set(q.split(/\s+/).filter((w) => w.length >= 2))].slice(0, 8);
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
