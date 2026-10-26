// CAT-03 — variants: name unique per product, optional SKU (workspace-wide rule), attributes, price, cost, stock, min.
// Product stock = Σ active variants; a variant's quantity only moves through StockService (movements at variant level).
import { Injectable } from '@nestjs/common';
import { prisma, type Prisma, type Product, type ProductVariant, type Tx } from '@djaber/db';
import { VARIANTS_MAX, type CreateVariantInput, type GenerateVariantsInput, type UpdateVariantInput, type VariantView } from '@djaber/shared';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { isUnique, skuTaken } from './catalog.util';
import { ModerationHookService } from './moderation-hook.service';
import { PlanLimitService } from './plan-limit.service';
import { toVariantView } from './product.presenter';
import { SkuService } from './sku.service';
import { StockService } from './stock.service';

const nameTaken = (field = 'name') => validationError({ [field]: 'validation.invalid' });

@Injectable()
export class VariantService {
  constructor(
    private readonly skus: SkuService,
    private readonly stock: StockService,
    private readonly limits: PlanLimitService,
    private readonly moderation: ModerationHookService,
  ) {}

  private async liveProduct(tx: Tx, productId: string): Promise<Product> {
    const p = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!p) throw notFound();
    return p;
  }

  async list(productId: string): Promise<VariantView[]> {
    const p = await prisma.product.findFirst({ where: { id: productId }, select: { deletedAt: true } });
    if (!p) throw notFound();
    // an archived product keeps the variants it had at archive time (same timestamp)
    const rows = await prisma.productVariant.findMany({ where: { productId, deletedAt: p.deletedAt }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(toVariantView);
  }

  /**
   * Adds variants to a product inside the caller's transaction. The first variant turns the product into a variant
   * product: its own quantity is written off by a movement (`refType = variant`) because stock now lives on the variants.
   */
  async addMany(tx: Tx, product: Product, inputs: CreateVariantInput[], field: (i: number, f: string) => string = (_i, f) => f): Promise<ProductVariant[]> {
    if (!inputs.length) return [];
    if (!product.trackStock) throw new AppException('PRODUCT_NOT_STOCK_TRACKED');
    const existing = await tx.productVariant.findMany({ where: { productId: product.id, deletedAt: null }, select: { name: true } });
    if (existing.length + inputs.length > VARIANTS_MAX) throw new AppException('VARIANT_LIMIT');

    const names = new Set(existing.map((v) => v.name.toLowerCase()));
    const seenSkus = new Set<string>([product.sku]);
    inputs.forEach((v, i) => {
      if (names.has(v.name.toLowerCase())) throw nameTaken(field(i, 'name'));
      names.add(v.name.toLowerCase());
      if (v.sku) {
        if (seenSkus.has(v.sku)) throw skuTaken(field(i, 'sku'));
        seenSkus.add(v.sku);
      }
    });
    const taken = await this.skus.taken(tx, inputs.map((v) => v.sku));
    if (taken.size) throw skuTaken(field(inputs.findIndex((v) => v.sku && taken.has(v.sku)), 'sku'));

    if (!product.hasVariants) {
      if ((product.stock ?? 0) !== 0) {
        await this.stock.move(tx, { productId: product.id, change: { setTo: 0 }, reason: 'other', refType: 'variant', note: 'variants', silent: true });
      }
      await tx.product.update({ where: { id: product.id }, data: { hasVariants: true, stock: 0 } });
    }
    const created: ProductVariant[] = [];
    for (const v of inputs) {
      const row = await tx.productVariant.create({
        data: {
          productId: product.id,
          name: v.name,
          sku: v.sku ?? null,
          attributes: (v.attributes ?? {}) as Prisma.InputJsonValue,
          price: v.price,
          costPrice: v.costPrice ?? null,
          stock: 0,
          minStock: v.minStock ?? 0,
          isActive: v.isActive ?? true,
        } as Prisma.ProductVariantUncheckedCreateInput,
      });
      if ((v.stock ?? 0) > 0) {
        await this.stock.move(tx, { productId: product.id, variantId: row.id, change: { delta: v.stock! }, type: 'in', reason: 'initial', refType: 'manual', silent: true });
      }
      created.push(row);
    }
    await this.stock.recomputeProductStock(tx, product.id);
    return tx.productVariant.findMany({ where: { id: { in: created.map((c) => c.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await prisma.$transaction((db) => fn(db as Tx));
    } catch (e) {
      if (isUnique(e, 'sku')) throw skuTaken();
      if (isUnique(e, 'name')) throw nameTaken();
      throw e;
    }
  }

  /** `POST /products/:id/variants` */
  async create(productId: string, input: CreateVariantInput): Promise<VariantView> {
    return this.write(async (tx) => {
      const product = await this.liveProduct(tx, productId);
      // 02 §5: a workspace above its product limit (after a downgrade) cannot grow its catalogue with variants either
      await this.limits.assertProductSlots(tx, 0);
      const [row] = await this.addMany(tx, product, [input]);
      // tester report 25/10 UX-003 / UX-007: a new variant is customer-visible content — the product goes to moderation
      await this.moderation.submitIfChanged(tx, productId, 'update', { force: true });
      await this.stock.emitProductUpdated(tx, productId);
      return toVariantView(row!);
    });
  }

  /** `POST /products/:id/variants/generate` — one variant per combination of the attribute values. */
  async generate(productId: string, input: GenerateVariantsInput): Promise<VariantView[]> {
    let combos: Record<string, string>[] = [{}];
    for (const a of input.attributes) {
      const values = [...new Set(a.values)];
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [a.name]: v })));
      if (combos.length > VARIANTS_MAX) throw new AppException('VARIANT_LIMIT');
    }
    return this.write(async (tx) => {
      const product = await this.liveProduct(tx, productId);
      await this.limits.assertProductSlots(tx, 0);
      const existing = new Set((await tx.productVariant.findMany({ where: { productId, deletedAt: null }, select: { name: true } })).map((v) => v.name.toLowerCase()));
      const inputs = combos
        .map((attributes) => ({ name: Object.values(attributes).join(' / '), attributes, price: input.defaultPrice, stock: input.defaultStock }))
        .filter((v) => !existing.has(v.name.toLowerCase()));
      const rows = await this.addMany(tx, product, inputs);
      if (rows.length) await this.moderation.submitIfChanged(tx, productId, 'update', { force: true });
      await this.stock.emitProductUpdated(tx, productId);
      return rows.map(toVariantView);
    });
  }

  /** `PATCH /products/:id/variants/:vid` */
  async update(productId: string, variantId: string, input: UpdateVariantInput): Promise<VariantView> {
    return this.write(async (tx) => {
      await this.liveProduct(tx, productId);
      const current = await tx.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
      if (!current) throw new AppException('VARIANT_NOT_FOUND');
      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
        const clash = await tx.productVariant.count({ where: { productId, deletedAt: null, name: { equals: input.name, mode: 'insensitive' }, NOT: { id: variantId } } });
        if (clash) throw nameTaken();
      }
      if (input.sku !== undefined && input.sku !== current.sku) await this.skus.assertFree(tx, [input.sku], { variantIds: [variantId] });
      const row = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          name: input.name,
          sku: input.sku === undefined ? undefined : (input.sku ?? null),
          attributes: input.attributes === undefined ? undefined : (input.attributes as Prisma.InputJsonValue),
          price: input.price,
          costPrice: input.costPrice === undefined ? undefined : (input.costPrice ?? null),
          minStock: input.minStock,
          isActive: input.isActive,
        },
      });
      if (input.isActive !== undefined && input.isActive !== current.isActive) await this.stock.recomputeProductStock(tx, productId);
      // tester report 25/10 UX-003: a renamed variant, a price ±50 % or a variant shown again is reviewed; stock, SKU, cost never
      const renamed = input.name !== undefined && input.name !== current.name;
      const repriced = input.price !== undefined && current.price > 0 && Math.abs(input.price - current.price) * 2 >= current.price;
      const shown = input.isActive === true && !current.isActive;
      if (renamed || repriced || shown) await this.moderation.submitIfChanged(tx, productId, 'update', { force: renamed || repriced });
      await this.stock.emitProductUpdated(tx, productId);
      return toVariantView(row);
    });
  }

  /**
   * `DELETE /products/:id/variants/:vid` — soft (04 §9): order / sale lines keep their snapshot. The remaining quantity
   * leaves by a movement, the parent is recomputed, and the last variant turns the product back into a simple one.
   */
  async remove(productId: string, variantId: string): Promise<void> {
    await this.write(async (tx) => {
      await this.liveProduct(tx, productId);
      const current = await tx.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
      if (!current) throw new AppException('VARIANT_NOT_FOUND');
      if (current.stock !== 0) {
        await this.stock.move(tx, { productId, variantId, change: { setTo: 0 }, reason: 'other', refType: 'variant', refId: variantId, allowNegative: true, silent: true });
      }
      // `@@unique([productId, name])` also covers soft-deleted rows: the name is released for a future variant
      await tx.productVariant.update({ where: { id: variantId }, data: { deletedAt: new Date(), isActive: false, name: `${current.name} ⌫${variantId.slice(-8)}`.slice(0, 190) } });
      const left = await tx.productVariant.count({ where: { productId, deletedAt: null } });
      if (left === 0) await tx.product.update({ where: { id: productId }, data: { hasVariants: false, stock: 0 } });
      else await this.stock.recomputeProductStock(tx, productId);
      await this.stock.emitProductUpdated(tx, productId);
    });
  }
}
