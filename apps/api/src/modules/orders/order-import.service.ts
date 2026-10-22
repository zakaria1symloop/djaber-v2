// 03 §37 ORD "Import orders" (P2, D69, `orders.import`) — the CAT-06 wizard applied to orders: upload CSV / XLSX →
// preview job with per-row errors (mapping dialog when required columns are missing) → commit job: one order per valid
// row (`source=import`, `status=new`, `importJobId`), client found or created by phone, stock checked per row by the
// normal order creation (a row refused at commit is reported, the others are kept). Committing twice writes once.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ORDER_IMPORT_FIELDS, ORDER_IMPORT_MAX_ROWS, IMPORT_MAX_BYTES, type OrderImportMappingInput, type OrderImportPreviewResult, type OrderImportPreviewRow } from '@djaber/shared';
import { prisma, TenantContext, type Job, type Prisma, type Tx } from '@djaber/db';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { fold } from '../ai/tools/wilaya-aliases';
import { JobService } from '../jobs/job.service';
import { detectFormat, readTable, TableFileError } from '../jobs/table-file';
import type { UploadedFile } from '../uploads/image-upload.service';
import { autoMapOrders, buildOrderRow, missingOrderColumns, type ImportCatalog, type OrderImportMapping } from './order-import-rows';
import { OrderService } from './order.service';

const PREVIEW = 'order-import-preview';
const COMMIT = 'order-import-commit';
type Payload = { name: string; storageKey: string; fileName: string; mime: string; mapping: OrderImportMapping | null; revision: number };

@Injectable()
export class OrderImportService implements OnModuleInit {
  constructor(
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly storage: StorageService,
    private readonly orders: OrderService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', PREVIEW, (data: { jobId: string }) => this.preview(data.jobId), { concurrency: 2 });
    this.registry.register('jobs', COMMIT, (data: { jobId: string }) => this.commitJob(data.jobId));
  }

  // --- HTTP side ------------------------------------------------------------------------------------------------------------
  /** `POST /orders/import` (multipart `file`) → 202 { jobId } of the preview job. */
  async start(file: UploadedFile | undefined) {
    if (!file?.buffer?.length) throw validationError({ file: 'validation.required' });
    if (file.size > IMPORT_MAX_BYTES) throw new AppException('IMPORT_TOO_LARGE', {}, { file: 'validation.invalid' });
    const fileName = file.originalname ?? 'import';
    const format = detectFormat(fileName, file.mimetype, file.buffer);
    if (!format) throw new AppException('UPLOAD_TYPE_INVALID', {}, { file: 'validation.invalid' });
    const storageKey = `private/ws/${TenantContext.workspaceId()}/imports/${randomUUID()}.${format}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    const job = await this.jobs.create({ kind: 'import', name: PREVIEW, payload: { storageKey, fileName: fileName.slice(0, 255), mime: file.mimetype, mapping: null, revision: 0 } });
    return { jobId: job.id };
  }

  private async importJob(jobId: string) {
    const job = await this.jobs.byIdOrNotFound(jobId);
    const payload = (job.payload ?? {}) as Payload;
    if (job.kind !== 'import' || !payload.storageKey || (payload.name !== PREVIEW && payload.name !== COMMIT)) throw notFound();
    return { job, payload, result: (job.result as OrderImportPreviewResult | null) ?? null };
  }

  /** `POST /orders/import/mapping { jobId, mapping }` → 202 (preview again with this mapping). */
  async mapping(input: OrderImportMappingInput) {
    const { job, payload, result } = await this.importJob(input.jobId);
    if (job.status === 'queued' || job.status === 'running' || !result || result.stage === 'committed') throw conflict({ reason: 'IMPORT_NOT_MAPPABLE', status: job.status });
    const mapping: OrderImportMapping = {};
    for (const f of ORDER_IMPORT_FIELDS) {
      const h = input.mapping[f];
      if (!h) continue;
      if (!result.headers.includes(h)) throw validationError({ [`mapping.${f}`]: 'validation.invalid' });
      mapping[f] = h;
    }
    const used = Object.values(mapping);
    if (new Set(used).size !== used.length) throw validationError({ mapping: 'validation.invalid' });
    const missing = missingOrderColumns(mapping);
    if (missing.length) throw new AppException('IMPORT_COLUMNS_MISSING', { columns: missing.join(', ') }, Object.fromEntries(missing.map((f) => [`mapping.${f}`, 'validation.required'])));
    const revision = (payload.revision ?? 0) + 1;
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.job.updateMany({ where: { id: job.id, status: { in: ['done', 'failed'] } }, data: { status: 'queued', progress: 0, error: null, payload: { ...payload, name: PREVIEW, mapping, revision } as unknown as Prisma.InputJsonValue } });
      if (!r.count) throw conflict({ reason: 'IMPORT_NOT_MAPPABLE' });
      await this.jobs.schedule(tx, { ...job, status: 'queued', progress: 0 }, PREVIEW, `:map${revision}`);
    });
    return { jobId: job.id };
  }

  /** `POST /orders/import/:jobId/commit` (Idempotency-Key required) → 202. */
  async commit(jobId: string) {
    const { job, payload, result } = await this.importJob(jobId);
    if (result?.stage === 'committed') return { jobId: job.id };
    if (job.status !== 'done' || !result || result.stage !== 'preview') throw conflict({ reason: 'IMPORT_NOT_READY', status: job.status });
    if (!result.totals.valid) throw validationError({ rows: 'validation.required' });
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.job.updateMany({ where: { id: job.id, status: 'done' }, data: { status: 'queued', progress: 0, payload: { ...(job.payload as object), name: COMMIT } as Prisma.InputJsonValue } });
      if (!r.count) return;
      await this.jobs.schedule(tx, { ...job, status: 'queued', progress: 0 }, COMMIT, `:commit${payload.revision ?? 0}`);
    });
    return { jobId: job.id };
  }

  // --- worker: preview ------------------------------------------------------------------------------------------------------
  private async catalog(): Promise<ImportCatalog> {
    const [products, variants, wilayas, rules, communes, clients] = await Promise.all([
      prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, sku: true, name: true, hasVariants: true, trackStock: true, sellOutOfStock: true, stock: true, price: true } }),
      prisma.productVariant.findMany({ where: { deletedAt: null, isActive: true, sku: { not: null }, product: { deletedAt: null } }, select: { id: true, sku: true, name: true, stock: true, price: true, product: { select: { id: true, name: true, trackStock: true, sellOutOfStock: true } } } }),
      prisma.wilaya.findMany({ select: { id: true, nameFr: true } }),
      prisma.deliveryFeeRule.findMany({ select: { wilayaId: true, isActive: true, homePrice: true } }),
      prisma.commune.findMany({ select: { id: true, wilayaId: true, nameFr: true } }),
      prisma.client.findMany({ where: { deletedAt: null, phone: { not: null } }, select: { phone: true } }),
    ]);
    const rule = new Map(rules.map((r) => [r.wilayaId, r]));
    const skus: ImportCatalog['skus'] = new Map();
    for (const p of products) skus.set(p.sku, { productId: p.id, variantId: null, name: p.name, hasVariants: p.hasVariants, trackStock: p.trackStock, available: p.trackStock && !p.hasVariants && !p.sellOutOfStock ? (p.stock ?? 0) : null, price: p.price });
    for (const v of variants) skus.set(v.sku!, { productId: v.product.id, variantId: v.id, name: `${v.product.name} · ${v.name}`, hasVariants: true, trackStock: v.product.trackStock, available: v.product.trackStock && !v.product.sellOutOfStock ? v.stock : null, price: v.price });
    const byWilaya: ImportCatalog['communes'] = new Map();
    for (const c of communes) {
      const m = byWilaya.get(c.wilayaId) ?? new Map<string, number>();
      m.set(fold(c.nameFr), c.id);
      byWilaya.set(c.wilayaId, m);
    }
    return {
      skus,
      wilayas: new Map(wilayas.map((w) => [w.id, { id: w.id, nameFr: w.nameFr, served: rule.get(w.id)?.isActive ?? true, homePrice: rule.get(w.id)?.homePrice ?? 0 }])),
      communes: byWilaya,
      existingPhones: new Set(clients.map((c) => c.phone!)),
    };
  }

  /** Job `jobs/order-import-preview`. */
  async preview(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const payload = job.payload as unknown as Payload;
      const file = await this.storage.get(payload.storageKey);
      let table;
      try {
        table = readTable(file.body, payload.fileName, payload.mime);
      } catch (e) {
        if (e instanceof TableFileError) throw new AppException('UPLOAD_TYPE_INVALID');
        throw e;
      }
      if (table.rows.length > ORDER_IMPORT_MAX_ROWS) throw new AppException('IMPORT_TOO_LARGE');
      const headers = table.headers.filter(Boolean);
      const mapping = payload.mapping ?? autoMapOrders(headers);
      const missing = missingOrderColumns(mapping);
      if (missing.length || !table.rows.length) {
        const result: OrderImportPreviewResult = { stage: 'mapping', fileName: payload.fileName, headers, mapping, missingColumns: missing, totals: { rows: table.rows.length, valid: 0, invalid: 0, newClients: 0, units: 0 }, rows: [] };
        await prisma.job.updateMany({ where: { id: job.id }, data: { result: result as unknown as Prisma.InputJsonValue } });
        throw new AppException('IMPORT_COLUMNS_MISSING', { columns: (missing.length ? missing : ['clientName', 'phone', 'wilaya', 'address', 'items']).join(', ') });
      }
      const cat = await this.catalog();
      const taken = new Map<string, number>();
      const rows: OrderImportPreviewRow[] = table.rows.map((r, i) => buildOrderRow(i + 2, Object.fromEntries(table.headers.map((h, c) => [h, r[c] ?? ''])), mapping, cat, taken));
      const valid = rows.filter((r) => r.ok);
      const result: OrderImportPreviewResult = {
        stage: 'preview',
        fileName: payload.fileName,
        headers,
        mapping,
        missingColumns: [],
        totals: { rows: rows.length, valid: valid.length, invalid: rows.length - valid.length, newClients: new Set(valid.filter((r) => r.client === 'new').map((r) => r.values.phone)).size, units: valid.reduce((n, r) => n + r.values.items.reduce((m, i) => m + i.quantity, 0), 0) },
        rows,
      };
      await prisma.job.updateMany({ where: { id: job.id }, data: { total: rows.length } });
      return { result, notify: false };
    });
  }

  // --- worker: commit -------------------------------------------------------------------------------------------------------
  /** Job `jobs/order-import-commit` — rows in file order; a re-run skips the rows whose order already exists. */
  async commitJob(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const preview = job.result as unknown as OrderImportPreviewResult | null;
      if (!preview || preview.stage === 'committed') return { notify: false };
      if (preview.stage !== 'preview') throw new AppException('CONFLICT');
      const signature = (phone: string, items: { productId: string | null; variantId: string | null; quantity: number }[]) => `${phone}|${items.map((i) => `${i.productId}:${i.variantId ?? ''}:${i.quantity}`).sort().join(',')}`;
      const done = await prisma.order.findMany({ where: { importJobId: job.id }, select: { id: true, clientPhone: true, items: { select: { productId: true, variantId: true, quantity: true } } } });
      const existing = new Map<string, string[]>();
      for (const o of done) existing.set(signature(o.clientPhone, o.items), [...(existing.get(signature(o.clientPhone, o.items)) ?? []), o.id]);
      const failed: { row: number; code: string; params?: Record<string, string | number> }[] = [];
      const orderIds: string[] = [];
      const valid = preview.rows.filter((r) => r.ok);
      const locale = TenantContext.get().locale;
      for (const [n, r] of valid.entries()) {
        const v = r.values;
        const sig = signature(v.phone!, v.items);
        const again = existing.get(sig);
        if (again?.length) {
          orderIds.push(again.shift()!);
          continue;
        }
        try {
          const order = await this.orders.create(
            {
              client: { name: v.clientName!, phone: v.phone! },
              items: v.items.map((i) => ({ productId: i.productId!, variantId: i.variantId, quantity: i.quantity })),
              delivery: { wilayaId: v.wilayaId!, communeId: v.communeId, communeText: v.communeId ? null : v.commune, isStopdesk: false, address: v.address },
              paymentMethod: 'cash',
              status: 'new',
              notes: v.note,
            },
            locale,
            'import',
            { importJobId: job.id },
          );
          orderIds.push(order.id);
        } catch (e) {
          if (!(e instanceof AppException)) throw e;
          failed.push({ row: r.row, code: e.code, ...(Object.keys(e.params).length ? { params: e.params } : {}) });
        }
        if (n % 20 === 19) await this.jobs.progress(job.id, ((n + 1) * 100) / valid.length);
      }
      const result: OrderImportPreviewResult = { ...preview, stage: 'committed', report: { created: orderIds.length, skipped: preview.rows.length - valid.length, failed, orderIds } };
      return { result, status: failed.length || result.report!.skipped ? ('partial' as const) : ('done' as const) };
    });
  }
}
