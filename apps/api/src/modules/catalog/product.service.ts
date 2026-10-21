// CAT-01 / CAT-08 / CAT-10 / CAT-11 — products: one validation for create and update, list with the filters of 06 §10,
// detail payload of the product page, archive (soft, SKU freed) / restore (SKU re-checked) / hard delete, duplicate.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, TenantContext, type ModerationSource, type Prisma, type Tx } from '@djaber/db';
import { formatMoney, type CreateProductInput, type DuplicateProductInput, type ProductListItemView, type ProductView, type UpdateProductInput } from '@djaber/shared';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { page, toSkipTake, type Page } from '../../core/http/pagination';
import { originSessionId } from '../../core/tenancy/tenant.guard';
import { OutboxService } from '../../core/outbox/outbox.service';
import { StorageService } from '../../core/storage/storage.service';
import { algiersDay } from '../../core/time/algiers';
import { ExportService } from '../jobs/export.service';
import { isForeignKey, isUnique, skuTaken, type Warning, type WithWarnings } from './catalog.util';
import type { ProductsQuery } from './dto';
import { computeMargins, MARGIN_PERIOD_DAYS, MARGIN_SOLD_STATUSES } from './margin.calculator';
import { ModerationHookService, needsReview } from './moderation-hook.service';
import { PlanLimitService } from './plan-limit.service';
import { folderOf, IMAGE_FILE, isProcessed, THUMB_FILE, thumbUrlOf } from './product-image.util';
import { isProposed, LIST_INCLUDE, toImageView, toListItem, toVariantView, type ProductListRow } from './product.presenter';
import { findProductIds } from './product.query';
import { SkuService } from './sku.service';
import { StockService, reservedQuantities } from './stock.service';
import { VariantService } from './variant.service';

const DAY_MS = 24 * 3600 * 1000;
/** MOD-01: a restored product is re-submitted when its last validation is older than 90 days. */
const RESUBMIT_AFTER_MS = 90 * DAY_MS;
const SOLD_STATUSES = MARGIN_SOLD_STATUSES;

const belowCost = (price: number, cost: number | null | undefined): Warning[] =>
  cost !== null && cost !== undefined && price < cost ? [{ code: 'SELLING_BELOW_COST', field: 'price' }] : [];

@Injectable()
export class ProductService implements OnModuleInit {
  constructor(
    private readonly skus: SkuService,
    private readonly stock: StockService,
    private readonly variants: VariantService,
    private readonly moderation: ModerationHookService,
    private readonly limits: PlanLimitService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
    private readonly exports: ExportService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('products', (filters, ctx) => this.exportTable(filters as ProductsQuery, ctx.locale));
  }

  // --- reads ------------------------------------------------------------------------------------------------------------
  private async rows(ids: string[]): Promise<ProductListRow[]> {
    if (!ids.length) return [];
    const rows = await prisma.product.findMany({ where: { id: { in: ids } }, include: LIST_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is ProductListRow => !!r);
  }

  /** `GET /products` */
  async list(q: ProductsQuery): Promise<Page<ProductListItemView>> {
    const { ids, total } = await findProductIds(q, toSkipTake(q));
    return page(await this.withTrueMargins((await this.rows(ids)).map(toListItem)), total, q);
  }

  /** `GET /products/search?q` — what an order form or the AI may sell: active, live, validated products. */
  async search(q: string | undefined, limit = 20) {
    const where: Prisma.ProductWhereInput = { deletedAt: null, isActive: true, moderationStatus: { in: ['approved', 'not_required'] } };
    if (q && q.length >= 2) {
      const contains = { contains: q, mode: 'insensitive' as const };
      where.OR = [{ name: contains }, { sku: contains }, { keywords: { has: q.toLowerCase() } }, { variants: { some: { deletedAt: null, OR: [{ sku: contains }, { name: contains }] } } }];
    }
    const rows = await prisma.product.findMany({ where, include: LIST_INCLUDE, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: p.price,
      primaryImageUrl: p.images[0] ? thumbUrlOf(p.images[0].url) : null,
      hasVariants: p.hasVariants,
      trackStock: p.trackStock,
      stock: p.trackStock ? (p.stock ?? 0) : null,
    }));
  }

  private async rowOrNotFound(id: string) {
    const row = await prisma.product.findFirst({ where: { id }, include: LIST_INCLUDE });
    if (!row) throw notFound();
    return row;
  }

  /** Units and revenue of the last `days` days: orders not cancelled / returned + completed counter sales. */
  async salesStats(productId: string, days = MARGIN_PERIOD_DAYS) {
    const since = new Date(Date.now() - days * DAY_MS);
    const [orders, sales] = await Promise.all([
      prisma.orderItem.aggregate({ where: { productId, order: { status: { in: [...SOLD_STATUSES] }, orderedAt: { gte: since } } }, _sum: { quantity: true, total: true } }),
      prisma.saleItem.aggregate({ where: { productId, sale: { status: 'completed', soldAt: { gte: since } } }, _sum: { quantity: true, total: true } }),
    ]);
    return { units: (orders._sum.quantity ?? 0) + (sales._sum.quantity ?? 0), revenue: (orders._sum.total ?? 0) + (sales._sum.total ?? 0) };
  }

  /**
   * The list shows the same margin as the product page — expenses included (tester report 2026-10-20: adding an expense
   * left the list margin unchanged). Per-unit expenses and the 30-day fixed share are read for the whole page at once.
   */
  private async withTrueMargins(items: ProductListItemView[]): Promise<ProductListItemView[]> {
    const ids = items.filter((i) => i.costPrice !== null).map((i) => i.id);
    if (!ids.length) return items;
    const since = new Date(Date.now() - MARGIN_PERIOD_DAYS * DAY_MS);
    const expenses = await prisma.productExpense.findMany({ where: { productId: { in: ids }, OR: [{ isPerUnit: true }, { date: { gte: since } }] }, select: { productId: true, amount: true, isPerUnit: true } });
    if (!expenses.length) return items;
    const withFixed = [...new Set(expenses.filter((e) => !e.isPerUnit).map((e) => e.productId))];
    const [orders, sales] = withFixed.length
      ? await Promise.all([
          prisma.orderItem.groupBy({ by: ['productId'], where: { productId: { in: withFixed }, order: { status: { in: [...SOLD_STATUSES] }, orderedAt: { gte: since } } }, _sum: { quantity: true } }),
          prisma.saleItem.groupBy({ by: ['productId'], where: { productId: { in: withFixed }, sale: { status: 'completed', soldAt: { gte: since } } }, _sum: { quantity: true } }),
        ])
      : [[], []];
    const units = new Map<string, number>();
    for (const g of [...orders, ...sales]) units.set(g.productId, (units.get(g.productId) ?? 0) + (g._sum.quantity ?? 0));
    return items.map((i) => {
      const own = expenses.filter((e) => e.productId === i.id);
      if (!own.length) return i;
      return { ...i, marginPct: computeMargins({ price: i.price, weightedCost: i.costPrice, expenses: own, unitsSold: units.get(i.id) ?? 0 }).marginPct };
    });
  }

  /** `GET /products/:id/margins` and the "Prix & marge" block of the product page (GDS-09, EXP-02). */
  async margins(productId: string, product?: { price: number; costPrice: number | null }) {
    const p = product ?? (await this.rowOrNotFound(productId));
    const since = new Date(Date.now() - MARGIN_PERIOD_DAYS * DAY_MS);
    const [expenses, sales30d] = await Promise.all([
      prisma.productExpense.findMany({ where: { productId, OR: [{ isPerUnit: true }, { date: { gte: since } }] }, select: { amount: true, isPerUnit: true } }),
      this.salesStats(productId),
    ]);
    return { ...computeMargins({ price: p.price, weightedCost: p.costPrice, expenses, unitsSold: sales30d.units }), sales30d };
  }

  /** `GET /products/:id` — the full product page payload (archived products included: banner + Restaurer). */
  async get(id: string): Promise<ProductView> {
    const row = await this.rowOrNotFound(id);
    const since = new Date(Date.now() - MARGIN_PERIOD_DAYS * DAY_MS);
    const [images, variants, links, reserved, pricing, orders30d, moderationDetail] = await Promise.all([
      prisma.productImage.findMany({ where: { productId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.productVariant.findMany({ where: { productId: id, deletedAt: row.deletedAt }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.agentProduct.findMany({ where: { productId: id, agent: { deletedAt: null } }, select: { agent: { select: { id: true, name: true, status: true } } } }),
      // held by the orders not confirmed yet (no movement until they are — owner decision 2026-10-21)
      reservedQuantities(prisma, [id]),
      this.margins(id, row),
      prisma.order.findMany({ where: { orderedAt: { gte: since }, items: { some: { productId: id } } }, select: { id: true, conversationId: true } }),
      this.moderation.detail(id),
    ]);
    const base = toListItem({ ...row, variants });
    const total = base.stock;
    const reservedQty = [...reserved.values()].reduce((n, q) => n + q, 0);
    return {
      ...base,
      marginPct: pricing.marginPct,
      primaryImageUrl: base.primaryImageUrl,
      description: row.description,
      weightGrams: row.weightGrams,
      keywords: row.keywords,
      images: images.map(toImageView),
      variants: variants.map(toVariantView),
      stockDetail: {
        total,
        reserved: reservedQty,
        availableForAi: total === null || !isProposed(row) ? 0 : Math.max(0, total - reservedQty),
        lastInventoryAt: row.lastInventoryAt ? row.lastInventoryAt.toISOString() : null,
      },
      pricing,
      agents: links.map((l) => l.agent),
      mentions30d: { conversations: new Set(orders30d.map((o) => o.conversationId).filter(Boolean)).size, orders: orders30d.length },
      moderationDetail,
      contentVersion: row.contentVersion,
      version: row.version,
    };
  }

  // --- writes -----------------------------------------------------------------------------------------------------------
  private async assertRefs(tx: Tx, categoryId: string | null | undefined, unitId: string | null | undefined) {
    if (categoryId) {
      const c = await tx.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } });
      if (!c) throw validationError({ categoryId: 'validation.invalid' });
    }
    if (unitId) {
      const ws = TenantContext.workspaceId();
      const u = await tx.unit.findFirst({ where: { id: unitId, OR: [{ workspaceId: null }, { workspaceId: ws }] }, select: { id: true } });
      if (!u) throw validationError({ unitId: 'validation.invalid' });
    }
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await prisma.$transaction((db) => fn(db as Tx), { timeout: 20_000 });
    } catch (e) {
      // the partial unique indexes are the last line of defence behind SkuService.assertFree
      if (isUnique(e, 'sku')) throw skuTaken();
      throw e;
    }
  }

  /** `POST /products` (also used by "Dupliquer" and by tests of the import path through `source`). */
  async create(input: CreateProductInput, source: ModerationSource = 'create'): Promise<WithWarnings<ProductView>> {
    const tracked = input.trackStock !== false;
    const variants = input.variants ?? [];
    const id = await this.write(async (tx) => {
      await this.limits.assertProductSlots(tx);
      await this.assertRefs(tx, input.categoryId, input.unitId);
      const sku = input.sku || this.skus.generate();
      await this.skus.assertFree(tx, [sku]);
      const product = await tx.product.create({
        data: {
          sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId ?? null,
          unitId: input.unitId ?? null,
          trackStock: tracked,
          price: input.price,
          oldPrice: input.oldPrice ?? null,
          costPrice: input.costPrice ?? null,
          stock: tracked ? 0 : null,
          minStock: input.minStock ?? 0,
          weightGrams: input.weightGrams ?? null,
          keywords: input.keywords ?? [],
          isActive: input.isActive ?? true,
          createdById: TenantContext.get().userId ?? null,
        } as Prisma.ProductUncheckedCreateInput,
      });
      if (variants.length) await this.variants.addMany(tx, product, variants, (i, f) => `variants.${i}.${f}`);
      else if (tracked && (input.stock ?? 0) > 0) {
        await this.stock.move(tx, { productId: product.id, change: { delta: input.stock! }, type: 'in', reason: 'initial', refType: 'manual', silent: true });
      }
      await this.moderation.submit(tx, product.id, source);
      await this.stock.emitProductUpdated(tx, product.id);
      return product.id;
    });
    return { data: await this.get(id), warnings: belowCost(input.price, input.costPrice) };
  }

  /** `PATCH /products/:id` — optimistic concurrency on `version` (api-contract §1.8). */
  async update(id: string, input: UpdateProductInput): Promise<WithWarnings<ProductView>> {
    const { version, ...fields } = input;
    const before = await this.rowOrNotFound(id);
    const stale = async () => conflict({ changedBy: null, changedAt: (await this.rowOrNotFound(id)).updatedAt.toISOString(), current: await this.get(id) });
    if (before.deletedAt) throw conflict({ reason: 'PRODUCT_ARCHIVED', current: await this.get(id) });
    if (version !== before.version) throw await stale();
    if (fields.sku === null) throw validationError({ sku: 'validation.required' });

    const ok = await this.write(async (tx) => {
      await this.assertRefs(tx, fields.categoryId, fields.unitId);
      if (fields.sku !== undefined && fields.sku !== before.sku) await this.skus.assertFree(tx, [fields.sku], { productId: id });
      const data: Prisma.ProductUncheckedUpdateManyInput = { ...fields, sku: fields.sku ?? undefined };
      if (fields.trackStock !== undefined && fields.trackStock !== before.trackStock) {
        if (!fields.trackStock) {
          // tracked → service (CAT-11): variants keep quantities, so a variant product cannot become a service
          if (before.hasVariants) throw validationError({ trackStock: 'validation.invalid' });
          if ((before.stock ?? 0) !== 0) {
            await this.stock.move(tx, { productId: id, change: { setTo: 0 }, reason: 'correction', refType: 'manual', allowNegative: true, silent: true });
          }
          data.stock = null;
        } else data.stock = 0;
      }
      const r = await tx.product.updateMany({ where: { id, version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
      if (!r.count) return false;
      const after = { name: fields.name ?? before.name, description: fields.description === undefined ? before.description : fields.description, categoryId: fields.categoryId === undefined ? before.categoryId : fields.categoryId, price: fields.price ?? before.price };
      // 04 §12: stock, variants, minStock, keywords, weight, unit, isActive never trigger a review
      if (needsReview(before, after)) await this.moderation.submit(tx, id, 'update');
      await this.stock.emitProductUpdated(tx, id);
      // outbound webhook `product.updated` (api-contract §6, 03-events §6: `{ productId, sku, changed:[…] }`)
      const changed = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
      await this.outbox.enqueue(tx, { topic: 'webhook', key: `product.updated:${id}:${before.version + 1}`, workspaceId: before.workspaceId, payload: { event: 'product.updated', workspaceId: before.workspaceId, data: { productId: id, sku: fields.sku ?? before.sku, name: fields.name ?? before.name, changed } } });
      return true;
    });
    if (!ok) throw await stale();
    const data = await this.get(id);
    return { data, warnings: belowCost(data.price, data.costPrice) };
  }

  /**
   * Archive inside a transaction (CAT-10): soft delete, SKU freed (the partial indexes ignore the row and its variants),
   * removed from agents and recommendations; order / sale lines keep their snapshot. `releaseStock` writes the remaining
   * quantity off with a movement (reason `archive`).
   */
  async archiveTx(tx: Tx, id: string, releaseStock: boolean): Promise<boolean> {
    const p = await tx.product.findFirst({ where: { id }, include: { variants: { where: { deletedAt: null } } } });
    if (!p) throw notFound();
    if (p.deletedAt) return false;
    if (releaseStock && p.trackStock) {
      if (p.hasVariants) {
        for (const v of p.variants) {
          if (v.stock !== 0) await this.stock.move(tx, { productId: id, variantId: v.id, change: { setTo: 0 }, reason: 'archive', refType: 'manual', allowNegative: true, silent: true });
        }
      } else if ((p.stock ?? 0) !== 0) {
        await this.stock.move(tx, { productId: id, change: { setTo: 0 }, reason: 'archive', refType: 'manual', allowNegative: true, silent: true });
      }
    }
    const now = new Date();
    // same timestamp on the product and on the variants it had: restore brings exactly these back
    await tx.productVariant.updateMany({ where: { productId: id, deletedAt: null }, data: { deletedAt: now } });
    await tx.product.update({ where: { id }, data: { deletedAt: now, version: { increment: 1 } } });
    await tx.agentProduct.deleteMany({ where: { productId: id } });
    await tx.recommendation.updateMany({ where: { OR: [{ productId: id }, { recommendedId: id }] }, data: { isActive: false } });
    await this.stock.emitProductUpdated(tx, id);
    return true;
  }

  /** `DELETE /products/:id?mode=archive|hard&releaseStock` */
  async remove(id: string, o: { mode?: 'archive' | 'hard'; releaseStock?: boolean } = {}): Promise<void> {
    if (o.mode !== 'hard') {
      await this.write((tx) => this.archiveTx(tx, id, o.releaseStock === true));
      return;
    }
    const row = await prisma.product.findFirst({ where: { id }, include: { images: { select: { storageKey: true } }, _count: { select: { orderItems: true, saleItems: true, purchaseItems: true } } } });
    if (!row) throw notFound();
    const count = row._count.orderItems + row._count.saleItems + row._count.purchaseItems;
    // hard delete only for a product no order / sale / purchase line refers to: otherwise archive it
    if (count > 0) throw new AppException('PRODUCT_HAS_ORDERS', { count });
    try {
      await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await tx.product.delete({ where: { id } });
        await this.outbox.ws(tx, `ws:${TenantContext.workspaceId()}`, 'product.updated', { id, product: { id, deleted: true }, originSessionId: originSessionId() });
      });
    } catch (e) {
      if (isForeignKey(e)) throw new AppException('PRODUCT_HAS_ORDERS', { count: 1 });
      throw e;
    }
    await Promise.all(row.images.map((i) => this.deleteImageFiles(i.storageKey)));
  }

  async deleteImageFiles(storageKey: string) {
    const keys = isProcessed(storageKey) ? [storageKey, `${folderOf(storageKey)}/${THUMB_FILE}`] : [storageKey];
    await Promise.all(keys.map((k) => this.storage.delete(k).catch(() => undefined)));
  }

  /** `POST /products/:id/restore { sku? }` — the SKU may have been reused meanwhile: 409 PRODUCT_SKU_ALREADY_EXISTS (CAT-10). */
  async restore(id: string, newSku?: string): Promise<ProductView> {
    await this.write(async (tx) => {
      const p = await tx.product.findFirst({ where: { id }, include: { moderationItems: { orderBy: { submittedAt: 'desc' }, take: 1, select: { submittedAt: true } } } });
      if (!p) throw notFound();
      if (!p.deletedAt) return;
      await this.limits.assertProductSlots(tx);
      const variants = await tx.productVariant.findMany({ where: { productId: id, deletedAt: p.deletedAt }, select: { id: true, sku: true } });
      // `newSku`: the replacement chosen in the conflict dialog when the old SKU was reused meanwhile
      const sku = newSku ?? p.sku;
      await this.skus.assertFree(tx, [sku, ...variants.map((v) => v.sku)], { productId: id, variantIds: variants.map((v) => v.id) });
      await tx.productVariant.updateMany({ where: { id: { in: variants.map((v) => v.id) } }, data: { deletedAt: null } });
      await tx.product.update({ where: { id }, data: { deletedAt: null, sku, version: { increment: 1 } } });
      if (p.hasVariants) await this.stock.recomputeProductStock(tx, id);
      const last = p.moderationItems[0]?.submittedAt;
      if (!last || Date.now() - last.getTime() > RESUBMIT_AFTER_MS) await this.moderation.submit(tx, id, 'restore');
      await this.stock.emitProductUpdated(tx, id);
    });
    return this.get(id);
  }

  /** `POST /products/:id/duplicate { name, copyImages, copyVariants, copyCost }` — a new product with no stock and a new SKU. */
  async duplicate(id: string, input: DuplicateProductInput): Promise<WithWarnings<ProductView>> {
    const src = await prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    if (!src) throw notFound();
    const ws = TenantContext.workspaceId();
    // files are copied first (storage is not transactional); rows are written in the transaction below
    const images: Prisma.ProductImageUncheckedCreateInput[] = [];
    if (input.copyImages) {
      for (const img of src.images.filter((i) => isProcessed(i.storageKey))) {
        const folder = `ws/${ws}/product/${randomUUID()}`;
        try {
          const main = await this.storage.get(img.storageKey);
          const thumb = await this.storage.get(`${folderOf(img.storageKey)}/${THUMB_FILE}`);
          const stored = await this.storage.put(`${folder}/${IMAGE_FILE}`, main.body, 'image/webp');
          await this.storage.put(`${folder}/${THUMB_FILE}`, thumb.body, 'image/webp');
          images.push({ productId: '', storageKey: stored.key, url: stored.url, width: img.width, height: img.height, sortOrder: img.sortOrder, isPrimary: img.isPrimary, aiCaption: img.aiCaption, altText: img.altText });
        } catch {
          // a missing file is not a reason to refuse the copy of the product
        }
      }
      if (images.length && !images.some((i) => i.isPrimary)) images[0]!.isPrimary = true;
    }
    const withVariants = input.copyVariants === true && src.variants.length > 0;
    const newId = await this.write(async (tx) => {
      await this.limits.assertProductSlots(tx);
      const sku = this.skus.generate();
      await this.skus.assertFree(tx, [sku]);
      const product = await tx.product.create({
        data: {
          sku,
          name: input.name,
          description: src.description,
          categoryId: src.categoryId,
          unitId: src.unitId,
          trackStock: src.trackStock,
          price: src.price,
          oldPrice: src.oldPrice,
          costPrice: input.copyCost ? src.costPrice : null,
          stock: src.trackStock ? 0 : null,
          minStock: src.minStock,
          weightGrams: src.weightGrams,
          keywords: src.keywords,
          isActive: src.isActive,
          createdById: TenantContext.get().userId ?? null,
        } as Prisma.ProductUncheckedCreateInput,
      });
      if (withVariants) {
        await this.variants.addMany(
          tx,
          product,
          src.variants.map((v) => ({ name: v.name, attributes: (v.attributes ?? {}) as Record<string, string>, price: v.price, costPrice: input.copyCost ? v.costPrice : null, minStock: v.minStock, isActive: v.isActive })),
        );
      }
      if (images.length) await tx.productImage.createMany({ data: images.map((i) => ({ ...i, productId: product.id })) });
      await this.moderation.submit(tx, product.id, 'duplicate');
      await this.stock.emitProductUpdated(tx, product.id);
      return product.id;
    });
    const data = await this.get(newId);
    return { data, warnings: belowCost(data.price, data.costPrice) };
  }

  /** `GET /products/:id/relations` — counts + last rows for the quick-edit sheet tabs [FIG CAT-01 quick edit]. */
  async relations(id: string) {
    await this.rowOrNotFound(id);
    const [orderCount, orderItems, movementCount, movements, agents, recoCount, recos] = await Promise.all([
      prisma.order.count({ where: { items: { some: { productId: id } } } }),
      prisma.orderItem.findMany({ where: { productId: id }, orderBy: { order: { orderedAt: 'desc' } }, take: 5, select: { quantity: true, total: true, variantName: true, order: { select: { id: true, number: true, status: true, orderedAt: true } } } }),
      prisma.stockMovement.count({ where: { productId: id } }),
      this.stock.listMovements({ page: 1, pageSize: 25, limit: 5, productId: id } as never),
      prisma.agentProduct.findMany({ where: { productId: id, agent: { deletedAt: null } }, select: { agent: { select: { id: true, name: true, status: true } } } }),
      prisma.recommendation.count({ where: { OR: [{ productId: id }, { recommendedId: id }] } }),
      prisma.recommendation.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, type: true, isActive: true, recommended: { select: { id: true, name: true } } } }),
    ]);
    return {
      orders: { count: orderCount, last: orderItems.map((i) => ({ id: i.order.id, number: i.order.number, status: i.order.status, orderedAt: i.order.orderedAt.toISOString(), quantity: i.quantity, total: i.total, variantName: i.variantName })) },
      movements: { count: movementCount, last: movements.data },
      agents: { count: agents.length, last: agents.map((a) => a.agent) },
      recommendations: { count: recoCount, last: recos },
    };
  }

  /** `GET /products/:id/card-preview` — the generic-template card a customer receives on Messenger (data, not HTML). */
  async cardPreview(id: string, locale: string) {
    const p = await this.rowOrNotFound(id);
    const out = p.trackStock && (p.stock ?? 0) <= 0;
    const labels: Record<string, { order: string; out: string }> = {
      fr: { order: 'Commander', out: 'Rupture de stock' },
      ar: { order: 'اطلب الآن', out: 'غير متوفر' },
      en: { order: 'Order', out: 'Out of stock' },
    };
    const l = labels[locale] ?? labels.fr!;
    const full = await prisma.productImage.findFirst({ where: { productId: id, isPrimary: true }, select: { url: true } });
    return {
      title: p.name.slice(0, 80),
      subtitle: [formatMoney(p.price), p.oldPrice ? `(${formatMoney(p.oldPrice)})` : null, out ? l.out : null].filter(Boolean).join(' · ').slice(0, 80),
      imageUrl: full?.url ?? null,
      price: p.price,
      oldPrice: p.oldPrice,
      variants: p.hasVariants ? p.variants.filter((v) => v.isActive).map((v) => v.name) : [],
      buttons: [{ type: 'postback' as const, title: l.order, payload: `ORDER:${p.id}`, disabled: out }],
      visibleToCustomers: isProposed(p),
    };
  }

  // --- export (06 §7 "Products") ------------------------------------------------------------------------------------------
  private async exportTable(q: ProductsQuery, locale: 'fr' | 'ar' | 'en') {
    const { ids } = await findProductIds({ ...q, page: 1, pageSize: 25 } as ProductsQuery);
    const rows: ProductListItemView[] = [];
    for (let i = 0; i < ids.length; i += 500) rows.push(...(await this.rows(ids.slice(i, i + 500))).map(toListItem));
    const counts = new Map((await prisma.productVariant.groupBy({ by: ['productId'], where: { deletedAt: null }, _count: { _all: true } })).map((g) => [g.productId, g._count._all]));
    const h = PRODUCT_HEADERS[locale] ?? PRODUCT_HEADERS.fr;
    type R = ProductListItemView;
    return {
      sheetName: h.sheet,
      fileName: `produits-${algiersDay()}`,
      rows,
      columns: [
        { header: 'SKU', value: (r: R) => r.sku },
        { header: h.name, value: (r: R) => r.name },
        { header: h.category, value: (r: R) => r.category?.name ?? '' },
        { header: h.unit, value: (r: R) => r.unit?.abbreviation ?? '' },
        { header: h.price, value: (r: R) => r.price },
        { header: h.oldPrice, value: (r: R) => r.oldPrice },
        { header: h.cost, value: (r: R) => r.costPrice },
        { header: h.stock, value: (r: R) => r.stock },
        { header: h.min, value: (r: R) => r.minStock },
        { header: h.variants, value: (r: R) => counts.get(r.id) ?? 0 },
        { header: h.active, value: (r: R) => (r.isActive ? h.yes : h.no) },
      ],
    };
  }
}

const PRODUCT_HEADERS = {
  fr: { sheet: 'Produits', name: 'Nom', category: 'Catégorie', unit: 'Unité', price: 'Prix', oldPrice: 'Ancien prix', cost: 'Coût', stock: 'Stock', min: 'Seuil', variants: 'Variantes', active: 'Actif', yes: 'Oui', no: 'Non' },
  en: { sheet: 'Products', name: 'Name', category: 'Category', unit: 'Unit', price: 'Price', oldPrice: 'Old price', cost: 'Cost', stock: 'Stock', min: 'Threshold', variants: 'Variants', active: 'Active', yes: 'Yes', no: 'No' },
  ar: { sheet: 'المنتجات', name: 'الاسم', category: 'الفئة', unit: 'الوحدة', price: 'السعر', oldPrice: 'السعر القديم', cost: 'التكلفة', stock: 'المخزون', min: 'الحد الأدنى', variants: 'المتغيّرات', active: 'نشط', yes: 'نعم', no: 'لا' },
} as const;
