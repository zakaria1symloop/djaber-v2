// 06 §8.6 — bulk actions of the products list: every id is processed on its own (one transaction per item) and
// reported in `data.results[]` (api-contract §1.4: `{ id, ok, error?, data? }`), `meta.ok` / `meta.failed`.
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, computeBulkPrice, type BulkPriceInput, type ErrorCode } from '@djaber/shared';
import { prisma, type Tx } from '@djaber/db';
import { AppException, notFound } from '../../core/errors/app.exception';
import type { BulkResult } from '../../core/http/pagination';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Warning } from './catalog.util';
import { ModerationHookService, needsReview } from './moderation-hook.service';
import { ProductService } from './product.service';
import { StockService } from './stock.service';

export type BulkItemResult = BulkResult;
export type BulkCtx = { locale: string; ref: string };

@Injectable()
export class BulkService {
  constructor(
    private readonly i18n: I18nService,
    private readonly products: ProductService,
    private readonly stock: StockService,
    private readonly moderation: ModerationHookService,
  ) {}

  private failure(id: string, e: unknown, ctx: BulkCtx): BulkItemResult {
    const app = e instanceof AppException ? e : null;
    const code: ErrorCode = app && app.code in ERROR_CODES ? app.code : 'INTERNAL';
    const params = app?.params ?? {};
    return {
      id,
      ok: false,
      error: { code, message: this.i18n.t(ctx.locale, `error.${code}`, { ...params, ref: ctx.ref }), params, ...(app && Object.keys(app.fields).length ? { fields: app.fields } : {}), ref: ctx.ref },
    };
  }

  private async each(ids: string[], ctx: BulkCtx, fn: (tx: Tx, id: string) => Promise<unknown>): Promise<{ results: BulkItemResult[] }> {
    const results: BulkItemResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const data = await prisma.$transaction((db) => fn(db as Tx, id));
        results.push({ id, ok: true, ...(data !== undefined ? { data } : {}) });
      } catch (e) {
        if (!(e instanceof AppException)) throw e;
        results.push(this.failure(id, e, ctx));
      }
    }
    return { results };
  }

  private async live(tx: Tx, id: string) {
    const p = await tx.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound();
    return p;
  }

  /** `POST /products/bulk/category { ids[], categoryId }` (null = no category). */
  async category(ids: string[], categoryId: string | null, ctx: BulkCtx) {
    if (categoryId) {
      const c = await prisma.category.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } });
      if (!c) throw new AppException('VALIDATION_ERROR', {}, { categoryId: 'validation.invalid' });
    }
    return this.each(ids, ctx, async (tx, id) => {
      const p = await this.live(tx, id);
      if (p.categoryId === categoryId) return;
      await tx.product.update({ where: { id }, data: { categoryId, version: { increment: 1 } } });
      await this.moderation.submit(tx, id, 'update'); // moderated field (04 §12)
      await this.stock.emitProductUpdated(tx, id);
    });
  }

  /** `POST /products/bulk/agent { ids[], agentId }` — adds the products to the agent's selection. */
  async agent(ids: string[], agentId: string, ctx: BulkCtx) {
    const agent = await prisma.agent.findFirst({ where: { id: agentId, deletedAt: null }, select: { id: true } });
    if (!agent) throw notFound();
    return this.each(ids, ctx, async (tx, id) => {
      await this.live(tx, id);
      await tx.agentProduct.upsert({ where: { agentId_productId: { agentId, productId: id } }, create: { agentId, productId: id }, update: {} });
    });
  }

  /**
   * `POST /products/bulk/min-stock { ids[], minStock }` — a product with variants keeps its threshold per variant
   * (CAT-09 `ProductVariant.minStock`), so every live variant gets it too (full-test 15/11 PRODUCTS-04).
   */
  async minStock(ids: string[], minStock: number, ctx: BulkCtx) {
    return this.each(ids, ctx, async (tx, id) => {
      const p = await this.live(tx, id);
      if (!p.trackStock) throw new AppException('PRODUCT_NOT_STOCK_TRACKED');
      await tx.product.update({ where: { id }, data: { minStock, version: { increment: 1 } } });
      if (p.hasVariants) await tx.productVariant.updateMany({ where: { productId: id, deletedAt: null }, data: { minStock } });
      await this.stock.emitProductUpdated(tx, id);
    });
  }

  /** `POST /products/bulk/archive { ids[], releaseStock? }` */
  async archive(ids: string[], releaseStock: boolean, ctx: BulkCtx) {
    return this.each(ids, ctx, async (tx, id) => {
      await this.products.archiveTx(tx, id, releaseStock);
    });
  }

  /**
   * `POST /products/bulk/price` — increase / decrease by a percentage or an amount, or set a price; `roundUpTens`,
   * `applyToVariants`; `preview: true` computes without writing. Lines falling under their cost are flagged with the
   * non-blocking warning SELLING_BELOW_COST (EXP-04).
   */
  async price(input: BulkPriceInput, ctx: BulkCtx): Promise<{ results: BulkItemResult[]; warnings: Warning[] }> {
    let below = 0;
    const out = await this.each(input.ids, ctx, async (tx, id) => {
      const p = await this.live(tx, id);
      const newPrice = computeBulkPrice(p.price, input);
      if (newPrice <= 0) throw new AppException('VALIDATION_ERROR', {}, { value: 'validation.price' });
      const variants = input.applyToVariants && p.hasVariants ? await tx.productVariant.findMany({ where: { productId: id, deletedAt: null }, orderBy: { createdAt: 'asc' } }) : [];
      const variantPrices = variants.map((v) => ({ id: v.id, name: v.name, price: v.price, newPrice: computeBulkPrice(v.price, input), cost: v.costPrice ?? p.costPrice }));
      if (variantPrices.some((v) => v.newPrice <= 0)) throw new AppException('VALIDATION_ERROR', {}, { value: 'validation.price' });
      const belowCost = (p.costPrice !== null && newPrice < p.costPrice) || variantPrices.some((v) => v.cost !== null && v.newPrice < v.cost);
      if (belowCost) below++;
      const data = { price: p.price, newPrice, belowCost, variants: variantPrices.map(({ cost: _cost, ...v }) => v) };
      if (input.preview) return data;
      if (newPrice !== p.price) {
        // Houssem live 24/11 (client list L78): « Recette Sac en cuir » at 4 000 DA with an old price of 3 500 DA — the bulk price change kept
        // the crossed-out price below the new price; the exported file then failed its own import (« the old price must be higher »)
        await tx.product.update({ where: { id }, data: { price: newPrice, ...(p.oldPrice !== null && p.oldPrice <= newPrice ? { oldPrice: null } : {}), version: { increment: 1 } } });
        if (needsReview(p, { ...p, price: newPrice })) await this.moderation.submit(tx, id, 'update');
      }
      for (const v of variantPrices) if (v.newPrice !== v.price) await tx.productVariant.update({ where: { id: v.id }, data: { price: v.newPrice } });
      await this.stock.emitProductUpdated(tx, id);
      return data;
    });
    return { ...out, warnings: below ? [{ code: 'SELLING_BELOW_COST', params: { count: below } }] : [] };
  }
}
