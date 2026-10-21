// CAT-02 — product images: ≤ 10 per product (IMAGES_LIMIT), ≤ 5 MB, jpeg / png / webp / gif, warning below 600 px.
// The HTTP handler only validates and stores the original; the `media.reencode-image` job (worker) produces the
// normalised image + thumbnail and then schedules `media.caption-image` (00-build-order M2 "Risks").
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma, TenantContext, type Prisma, type ProductImage, type Tx } from '@djaber/db';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIN_PX, PRODUCT_IMAGES_MAX, type ProductImageView, type UpdateProductImageInput } from '@djaber/shared';
import { AppException, notFound, validationError } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { QueueOutbox } from '../../core/queue/queue.outbox';
import { StorageService } from '../../core/storage/storage.service';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import type { UploadedFile } from '../uploads/image-upload.service';
import { IMAGE_CAPTION_PROVIDER, type ImageCaptionProvider } from './ai.providers';
import type { Warning, WithWarnings } from './catalog.util';
import { ModerationHookService } from './moderation-hook.service';
import { folderOf, IMAGE_FILE, IMAGE_MAX_PX, isProcessed, THUMB_FILE, THUMB_PX } from './product-image.util';
import { toImageView } from './product.presenter';
import { StockService } from './stock.service';

const MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
type MediaJob = { productImageId: string; workspaceId: string };

@Injectable()
export class ProductImageService implements OnModuleInit {
  constructor(
    private readonly storage: StorageService,
    private readonly queue: QueueOutbox,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    private readonly moderation: ModerationHookService,
    private readonly stock: StockService,
    @Inject(IMAGE_CAPTION_PROVIDER) private readonly captions: ImageCaptionProvider,
  ) {}

  onModuleInit() {
    this.registry.register('media', 'reencode-image', (data: MediaJob) => this.reencode(data), { concurrency: 4 });
    this.registry.register('media', 'caption-image', (data: MediaJob) => this.caption(data), { concurrency: 2 });
  }

  private async liveProduct(tx: Tx, productId: string) {
    const p = await tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, name: true } });
    if (!p) throw notFound();
    return p;
  }

  private list(tx: Tx, productId: string) {
    return tx.productImage.findMany({ where: { productId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  /** `POST /products/:id/images` (multipart `file`). */
  async upload(productId: string, file: UploadedFile | undefined): Promise<WithWarnings<ProductImageView>> {
    // the product first: another workspace's id answers 404 whatever the file is (`ProductImage` is not a tenant model)
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!product) throw notFound();
    if (!file?.buffer?.length) throw validationError({ file: 'validation.required' });
    const ext = MIMES[file.mimetype];
    if (!ext) throw new AppException('IMAGE_TYPE_INVALID', {}, { file: 'validation.invalid' });
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw new AppException('IMAGE_TOO_LARGE', {}, { file: 'validation.invalid' });
    let width: number;
    let height: number;
    try {
      // header only: the declared mime type is not trusted, the decoded format decides
      const meta = await sharp(file.buffer, { failOn: 'error' }).metadata();
      if (!meta.format || !FORMATS.has(meta.format) || !meta.width || !meta.height) throw new Error('unsupported');
      const rotated = (meta.orientation ?? 1) >= 5;
      width = rotated ? meta.height : meta.width;
      height = rotated ? meta.width : meta.height;
    } catch {
      throw new AppException('IMAGE_TYPE_INVALID', {}, { file: 'validation.invalid' });
    }
    const ws = TenantContext.workspaceId();
    if ((await prisma.productImage.count({ where: { productId } })) >= PRODUCT_IMAGES_MAX) throw new AppException('IMAGES_LIMIT', {}, { file: 'validation.invalid' });

    const key = `ws/${ws}/product/${randomUUID()}/original.${ext}`;
    const stored = await this.storage.put(key, file.buffer, file.mimetype);
    let row: ProductImage;
    try {
      row = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        await this.liveProduct(tx, productId);
        // serialise concurrent uploads of the same product: the 10-image limit is checked under the product row lock
        await tx.$executeRaw`SELECT 1 FROM "Product" WHERE "id" = ${productId}::uuid AND "workspaceId" = ${ws}::uuid FOR UPDATE`;
        const existing = await this.list(tx, productId);
        if (existing.length >= PRODUCT_IMAGES_MAX) throw new AppException('IMAGES_LIMIT', {}, { file: 'validation.invalid' });
        const created = await tx.productImage.create({
          data: {
            productId,
            storageKey: stored.key,
            url: stored.url,
            width,
            height,
            sortOrder: existing.length ? Math.max(...existing.map((i) => i.sortOrder)) + 1 : 0,
            isPrimary: !existing.some((i) => i.isPrimary),
          },
        });
        await this.queue.add(tx, 'media', 'reencode-image', { productImageId: created.id, workspaceId: ws }, `img:${created.id}`, { attempts: 3, backoff: { type: 'fixed', delay: 5000 } });
        // 04 §12: images are a moderated field
        await this.moderation.submit(tx, productId, 'update');
        await this.stock.emitProductUpdated(tx, productId);
        return created;
      });
    } catch (e) {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw e;
    }
    const warnings: Warning[] = Math.min(width, height) < PRODUCT_IMAGE_MIN_PX ? [{ code: 'IMAGE_SMALL', params: { px: Math.min(width, height) }, field: 'file' }] : [];
    return { data: toImageView(row), warnings };
  }

  /** `PATCH /products/:id/images/order { ids[] }` — the full ordered list of the product's image ids. */
  async reorder(productId: string, ids: string[]): Promise<ProductImageView[]> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.liveProduct(tx, productId);
      const existing = await this.list(tx, productId);
      const unique = new Set(ids);
      if (unique.size !== ids.length || existing.length !== ids.length || !existing.every((i) => unique.has(i.id))) throw validationError({ ids: 'validation.invalid' });
      for (const [index, id] of ids.entries()) await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
      await this.stock.emitProductUpdated(tx, productId);
      return (await this.list(tx, productId)).map(toImageView);
    });
  }

  /** `PATCH /products/:id/images/:imgId { isPrimary?: true, altText? }` */
  async update(productId: string, imageId: string, input: UpdateProductImageInput): Promise<ProductImageView> {
    return prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.liveProduct(tx, productId);
      const img = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!img) throw notFound();
      if (input.isPrimary && !img.isPrimary) await tx.productImage.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
      const data: Prisma.ProductImageUpdateInput = {};
      if (input.isPrimary) data.isPrimary = true;
      if (input.altText !== undefined) data.altText = input.altText ?? null;
      const row = await tx.productImage.update({ where: { id: imageId }, data });
      await this.stock.emitProductUpdated(tx, productId);
      return toImageView(row);
    });
  }

  /** `DELETE /products/:id/images/:imgId` — deleting the primary image promotes the next one (AT-CAT-04). */
  async remove(productId: string, imageId: string): Promise<void> {
    const key = await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      await this.liveProduct(tx, productId);
      const img = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!img) throw notFound();
      await tx.productImage.delete({ where: { id: imageId } });
      if (img.isPrimary) {
        const next = (await this.list(tx, productId))[0];
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      // 04 §12: removing a picture adds nothing to review (tester report 2026-10-20) — an approved product stays approved
      // and its live snapshot loses the picture; a pending / refused one is (re)submitted with its remaining pictures
      const p = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { moderationStatus: true, approvedSnapshot: true } });
      if (p.moderationStatus === 'approved') {
        const snap = p.approvedSnapshot as { images?: unknown } | null;
        if (snap && Array.isArray(snap.images)) {
          const folder = `${folderOf(img.storageKey)}/`;
          const images = snap.images.filter((u) => typeof u === 'string' && u !== img.url && !u.includes(folder));
          await tx.product.update({ where: { id: productId }, data: { approvedSnapshot: { ...snap, images } as Prisma.InputJsonValue } });
        }
      } else await this.moderation.submit(tx, productId, 'update');
      await this.stock.emitProductUpdated(tx, productId);
      return img.storageKey;
    });
    const keys = isProcessed(key) ? [key, `${folderOf(key)}/${THUMB_FILE}`] : [key];
    await Promise.all(keys.map((k) => this.storage.delete(k).catch(() => undefined)));
  }

  // --- worker jobs (queue `media`) -------------------------------------------------------------------------------------------
  /** `ProductImage` has no `workspaceId` column: the workspace is checked through its product. */
  private image(data: MediaJob) {
    return prisma.productImage.findFirst({ where: { id: data.productImageId, product: { workspaceId: data.workspaceId } }, include: { product: { select: { id: true, name: true } } } });
  }

  /** `media.reencode-image` — idempotent: an image already normalised is left alone. */
  async reencode(data: MediaJob): Promise<void> {
    const tenant = await this.tenants.forWorker(data.workspaceId);
    await TenantContext.run(tenant, async () => {
      const img = await this.image(data);
      if (!img || isProcessed(img.storageKey)) return;
      const original = await this.storage.get(img.storageKey);
      const base = sharp(original.body, { failOn: 'error' }).rotate();
      const main = await base.clone().resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
      const thumb = await base.clone().resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const folder = folderOf(img.storageKey);
      const stored = await this.storage.put(`${folder}/${IMAGE_FILE}`, main.data, 'image/webp');
      await this.storage.put(`${folder}/${THUMB_FILE}`, thumb, 'image/webp');
      const done = await prisma.$transaction(async (db) => {
        const tx = db as Tx;
        // conditional on the original key: a concurrent run or a deleted image changes nothing
        const r = await tx.productImage.updateMany({ where: { id: img.id, storageKey: img.storageKey }, data: { storageKey: stored.key, url: stored.url, width: main.info.width, height: main.info.height } });
        if (!r.count) return false;
        await this.queue.add(tx, 'media', 'caption-image', { productImageId: img.id, workspaceId: data.workspaceId }, `cap:${img.id}`, { attempts: 2, backoff: { type: 'fixed', delay: 30_000 } });
        await this.stock.emitProductUpdated(tx, img.product.id);
        return true;
      });
      if (done) await this.storage.delete(img.storageKey).catch(() => undefined);
    });
  }

  /** `media.caption-image` — stores the caption of the AI port (CAT-02; null when no vision model answered). Safe to run twice. */
  async caption(data: MediaJob): Promise<void> {
    const tenant = await this.tenants.forWorker(data.workspaceId);
    await TenantContext.run(tenant, async () => {
      const img = await this.image(data);
      if (!img || img.aiCaption) return;
      const file = await this.storage.get(img.storageKey);
      const caption = await this.captions.caption({ image: file.body, mime: file.mime, productName: img.product.name, locale: tenant.locale });
      await prisma.productImage.updateMany({ where: { id: img.id }, data: { aiCaption: caption ? caption.slice(0, 1000) : null } });
    });
  }
}
