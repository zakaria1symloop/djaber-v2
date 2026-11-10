// CAT-06 / FL-12 — catalogue import: upload (CSV / XLSX, ≤ 5 MB, ≤ 2 000 rows) → preview job with per-row errors →
// optional column mapping → commit job writing every valid row in ONE transaction (missing categories created, `in`
// movements, moderation items). A failure in the middle writes nothing.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, TenantContext, type Job, type Prisma, type Tx } from '@djaber/db';
import { IMPORT_FIELDS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, systemUnitText, type ImportField, type ImportMappingInput, type ImportPreviewResult, type ImportPreviewRow } from '@djaber/shared';
import { AppException, conflict, notFound, validationError } from '../../core/errors/app.exception';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { JobService } from '../jobs/job.service';
import { detectFormat, readTable, TableFileError, writeTable } from '../jobs/table-file';
import type { UploadedFile } from '../uploads/image-upload.service';
import { isUnique, skuTaken } from './catalog.util';
import { autoMap, buildPreview, missingRequired, type ImportMapping } from './import-rows';
import { ModerationHookService, needsReview } from './moderation-hook.service';
import { PlanLimitService } from './plan-limit.service';
import { SkuService } from './sku.service';
import { StockService } from './stock.service';

const PREVIEW = 'product-import-preview';
const COMMIT = 'product-import-commit';
type Payload = { name: string; storageKey: string; fileName: string; mime: string; mapping: ImportMapping | null; updateExisting: boolean; revision: number };
type Values = ImportPreviewRow['values'];

@Injectable()
export class ImportService implements OnModuleInit {
  constructor(
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly storage: StorageService,
    private readonly skus: SkuService,
    private readonly stock: StockService,
    private readonly limits: PlanLimitService,
    private readonly moderation: ModerationHookService,
    private readonly i18n: I18nService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', PREVIEW, (data: { jobId: string }) => this.preview(data.jobId), { concurrency: 2 });
    this.registry.register('jobs', COMMIT, (data: { jobId: string }) => this.commitJob(data.jobId));
  }

  // --- HTTP side ------------------------------------------------------------------------------------------------------------
  /** `POST /products/import` (multipart `file`) → 202 { jobId } of the preview job. */
  async start(file: UploadedFile | undefined) {
    if (!file?.buffer?.length) throw validationError({ file: 'validation.required' });
    if (file.size > IMPORT_MAX_BYTES) throw new AppException('IMPORT_TOO_LARGE', {}, { file: 'validation.invalid' });
    const fileName = file.originalname ?? 'import';
    const format = detectFormat(fileName, file.mimetype, file.buffer);
    if (!format) throw new AppException('UPLOAD_TYPE_INVALID', {}, { file: 'validation.invalid' });
    const t = TenantContext.get();
    const storageKey = `private/ws/${t.workspaceId}/imports/${randomUUID()}.${format}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    const payload: Omit<Payload, 'name'> = { storageKey, fileName: fileName.slice(0, 255), mime: file.mimetype, mapping: null, updateExisting: false, revision: 0 };
    const job = await this.jobs.create({ kind: 'import', name: PREVIEW, payload });
    return { jobId: job.id };
  }

  private async importJob(jobId: string): Promise<{ job: Job; payload: Payload; result: ImportPreviewResult | null }> {
    const job = await this.jobs.byIdOrNotFound(jobId);
    const payload = (job.payload ?? {}) as Payload;
    if (job.kind !== 'import' || !payload.storageKey || (payload.name !== PREVIEW && payload.name !== COMMIT)) throw notFound();
    return { job, payload, result: (job.result as ImportPreviewResult | null) ?? null };
  }

  /** `POST /products/import/mapping { jobId, mapping, updateExisting?, saveMapping? }` → 202: the preview is computed again. */
  async mapping(input: ImportMappingInput) {
    const { job, payload, result } = await this.importJob(input.jobId);
    if (job.status === 'queued' || job.status === 'running' || !result || result.stage === 'committed') throw conflict({ reason: 'IMPORT_NOT_MAPPABLE', status: job.status });
    const mapping: ImportMapping = {};
    for (const f of IMPORT_FIELDS) {
      const header = input.mapping[f];
      if (!header) continue;
      if (!result.headers.includes(header)) throw validationError({ [`mapping.${f}`]: 'validation.invalid' });
      mapping[f] = header;
    }
    const used = Object.values(mapping);
    if (new Set(used).size !== used.length) throw validationError({ mapping: 'validation.invalid' });
    const missing = missingRequired(mapping);
    if (missing.length) throw new AppException('IMPORT_COLUMNS_MISSING', { columns: missing.join(', ') }, Object.fromEntries(missing.map((f) => [`mapping.${f}`, 'validation.required'])));

    const t = TenantContext.get();
    const revision = (payload.revision ?? 0) + 1;
    const next: Payload = { ...payload, name: PREVIEW, mapping, updateExisting: input.updateExisting ?? false, revision };
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.job.updateMany({
        where: { id: job.id, workspaceId: t.workspaceId, status: { in: ['done', 'failed'] } },
        data: { status: 'queued', progress: 0, error: null, payload: next as unknown as Prisma.InputJsonValue },
      });
      if (!r.count) throw conflict({ reason: 'IMPORT_NOT_MAPPABLE' });
      await this.jobs.schedule(tx, { ...job, status: 'queued', progress: 0 }, PREVIEW, `:map${revision}`);
      if (input.saveMapping && t.userId) {
        // remembered per user: the next file with the same headers is mapped the same way
        const user = await tx.user.findUnique({ where: { id: t.userId }, select: { prefs: true } });
        await tx.user.update({ where: { id: t.userId }, data: { prefs: { ...((user?.prefs as object) ?? {}), productImportMapping: mapping } as Prisma.InputJsonValue } });
      }
    });
    return { jobId: job.id };
  }

  /** `POST /products/import/:jobId/commit` (Idempotency-Key required) → 202. Committing twice writes once. */
  async commit(jobId: string) {
    const { job, payload, result } = await this.importJob(jobId);
    if (result?.stage === 'committed') return { jobId: job.id };
    if (job.status !== 'done' || !result || result.stage !== 'preview') throw conflict({ reason: 'IMPORT_NOT_READY', status: job.status });
    if (!result.totals.valid) throw validationError({ rows: 'validation.required' });
    const t = TenantContext.get();
    await prisma.$transaction(async (db) => {
      const tx = db as Tx;
      const r = await tx.job.updateMany({ where: { id: job.id, workspaceId: t.workspaceId, status: 'done' }, data: { status: 'queued', progress: 0, payload: { ...(job.payload as object), name: COMMIT } as Prisma.InputJsonValue } });
      if (!r.count) return; // a concurrent commit already took it
      // one commit per preview revision: a preview computed again after a failed commit may be committed again
      await this.jobs.schedule(tx, { ...job, status: 'queued', progress: 0 }, COMMIT, `:commit${payload.revision ?? 0}`);
    });
    return { jobId: job.id };
  }

  // --- worker: preview ------------------------------------------------------------------------------------------------------
  private async context(tx: Tx) {
    const t = TenantContext.get();
    const [products, variants, units, categories, slots] = await Promise.all([
      tx.product.findMany({ where: { deletedAt: null }, select: { sku: true } }),
      tx.productVariant.findMany({ where: { deletedAt: null, sku: { not: null } }, select: { sku: true } }),
      tx.unit.findMany({ where: { OR: [{ workspaceId: null }, { workspaceId: t.workspaceId }] }, select: { id: true, name: true, abbreviation: true, isSystem: true } }),
      tx.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      this.limits.productSlots(tx),
    ]);
    const existingSkus = new Map<string, 'product' | 'variant'>();
    for (const v of variants) existingSkus.set(v.sku!, 'variant');
    for (const p of products) existingSkus.set(p.sku, 'product');
    const unitIds = new Map<string, string>();
    for (const u of units) {
      unitIds.set(u.abbreviation.toLowerCase(), u.id);
      unitIds.set(u.name.toLowerCase(), u.id);
      // a file exported in Arabic or English names the system units in that language (PV 08/11)
      for (const l of ['fr', 'ar', 'en'] as const) {
        const shown = u.isSystem ? systemUnitText(u.abbreviation, l) : null;
        if (shown) for (const w of [shown.name, shown.abbreviation]) if (!unitIds.has(w.toLowerCase())) unitIds.set(w.toLowerCase(), u.id);
      }
    }
    return { existingSkus, unitIds, categoryIds: new Map(categories.map((c) => [c.name.toLowerCase(), c.id])), slots };
  }

  /** Job `jobs/product-import-preview`. */
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
      if (table.rows.length > IMPORT_MAX_ROWS) throw new AppException('IMPORT_TOO_LARGE');
      const headers = table.headers.filter(Boolean);

      let mapping = payload.mapping;
      if (!mapping) {
        mapping = autoMap(table.headers);
        // the mapping this user saved last time applies to the headers this file also has
        const user = job.createdById ? await prisma.user.findUnique({ where: { id: job.createdById }, select: { prefs: true } }) : null;
        const saved = ((user?.prefs ?? {}) as { productImportMapping?: ImportMapping }).productImportMapping ?? {};
        for (const f of IMPORT_FIELDS) {
          const h = saved[f];
          if (h && table.headers.includes(h) && !Object.entries(mapping).some(([k, v]) => k !== f && v === h)) mapping[f] = h;
        }
      }
      const missing = missingRequired(mapping);
      if (missing.length || !table.rows.length) {
        // kept on the failed job so the wizard can open the column-mapping dialog instead of asking for a new file
        const result: ImportPreviewResult = {
          stage: 'mapping',
          fileName: payload.fileName,
          headers,
          mapping,
          missingColumns: missing,
          updateExisting: payload.updateExisting,
          totals: { rows: table.rows.length, valid: 0, invalid: 0, create: 0, update: 0, overPlanLimit: 0, newCategories: 0 },
          rows: [],
        };
        await prisma.job.updateMany({ where: { id: job.id }, data: { result: result as unknown as Prisma.InputJsonValue } });
        throw new AppException('IMPORT_COLUMNS_MISSING', { columns: (missing.length ? missing : ['name', 'price']).join(', ') });
      }
      const ctx = await prisma.$transaction((db) => this.context(db as Tx));
      const result = buildPreview({
        fileName: payload.fileName,
        headers,
        rows: table.rows,
        mapping,
        updateExisting: payload.updateExisting,
        ctx: {
          existingSkus: ctx.existingSkus,
          units: new Set(ctx.unitIds.keys()),
          categories: new Set(ctx.categoryIds.keys()),
          freeSlots: ctx.slots.free,
          limit: ctx.slots.limit,
          current: ctx.slots.current,
        },
      });
      await prisma.job.updateMany({ where: { id: job.id }, data: { total: table.rows.length } });
      return { result, notify: false };
    });
  }

  // --- worker: commit -------------------------------------------------------------------------------------------------------
  /** Job `jobs/product-import-commit` — safe to run twice: a committed preview is left alone. */
  async commitJob(jobId: string) {
    await this.jobs.run(jobId, async (job) => {
      const preview = job.result as unknown as ImportPreviewResult | null;
      if (!preview || preview.stage === 'committed') return { notify: false };
      if (preview.stage !== 'preview') throw new AppException('CONFLICT');
      const valid = preview.rows.filter((r) => r.ok);
      const mapped = (f: ImportField) => !!preview.mapping[f];
      let report;
      try {
        report = await prisma.$transaction((db) => this.write(db as Tx, job.id, valid, mapped), { timeout: 120_000, maxWait: 20_000 });
      } catch (e) {
        // a SKU or a category name taken between the checks and the insert: nothing was written
        if (isUnique(e, 'sku')) throw skuTaken();
        if (isUnique(e)) throw new AppException('CONFLICT');
        throw e;
      }
      const result: ImportPreviewResult = { ...preview, stage: 'committed', report: { ...report, skipped: preview.rows.length - valid.length } };
      // the rows left out are handed back as a file ("télécharger le rapport d'erreurs"): fix them and import again
      const resultUploadId = result.report!.skipped ? await this.errorReport(job, preview) : undefined;
      return { result, resultUploadId, status: result.report!.skipped ? ('partial' as const) : ('done' as const) };
    });
  }

  /**
   * CSV of the skipped rows: file line, SKU, name, field in error, the reason in the importer's language and its code (one
   * line per error). Stored under `private/`, named after the imported file (recette 09/11 UX-044: the column held only
   * « validation.price » and the file was « <job id>-errors.csv »).
   */
  private async errorReport(job: Job, preview: ImportPreviewResult): Promise<string | undefined> {
    const t = TenantContext.get();
    if (!job.createdById) return undefined;
    const user = await prisma.user.findUnique({ where: { id: job.createdById }, select: { locale: true } });
    const locale = user?.locale ?? t.locale ?? 'fr';
    const reason = (code: string, params?: Record<string, string | number>) => {
      const key = code.startsWith('validation.') ? code : `error.${code}`;
      const text = this.i18n.t(locale, key, { min: '', max: '', row: '', count: '', ...(params ?? {}) }).replace(/\s+/g, ' ').trim();
      return text && text !== key && text !== code ? text : code;
    };
    type Line = { row: number; sku: string; name: string; field: string; reason: string; code: string };
    const lines: Line[] = preview.rows
      .filter((r) => !r.ok)
      .flatMap((r) => r.errors.map((e) => ({ row: r.row, sku: String(r.values.sku ?? ''), name: String(r.values.name ?? ''), field: e.field ? (preview.mapping[e.field] ?? e.field) : '', reason: reason(e.code, e.params), code: e.code })));
    const file = writeTable<Line>(
      'csv',
      'Erreurs',
      [
        { header: 'row', value: (l) => l.row },
        { header: 'sku', value: (l) => l.sku },
        { header: 'name', value: (l) => l.name },
        { header: 'column', value: (l) => l.field },
        { header: 'error', value: (l) => l.reason },
        { header: 'code', value: (l) => l.code },
      ],
      lines,
    );
    const base = (preview.fileName || 'import').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'import';
    const key = `private/ws/${t.workspaceId}/imports/${job.id}/${base}-${this.i18n.t(locale, 'import.errors.suffix')}.csv`;
    await this.storage.put(key, file.body, file.mime);
    const upload = await prisma.upload.create({ data: { workspaceId: t.workspaceId, storageKey: key, url: key, mime: file.mime, size: file.body.length, kind: 'report', createdById: job.createdById } });
    return upload.id;
  }

  private async write(tx: Tx, jobId: string, rows: ImportPreviewRow[], mapped: (f: ImportField) => boolean) {
    const t = TenantContext.get();
    const ctx = await this.context(tx);
    const str = (v: Values[ImportField]) => (typeof v === 'string' && v ? v : null);
    const num = (v: Values[ImportField]) => (typeof v === 'number' ? v : null);

    // the catalogue may have changed since the preview: decide again what each row does, under the plan and SKU locks
    const creates: ImportPreviewRow[] = [];
    const updates: ImportPreviewRow[] = [];
    for (const r of rows) {
      const sku = str(r.values.sku);
      const holder = sku ? ctx.existingSkus.get(sku) : undefined;
      if (r.action === 'update' && holder === 'product') updates.push(r);
      else if (holder) throw skuTaken();
      else creates.push(r);
    }
    if (creates.length > ctx.slots.free) throw new AppException('PLAN_LIMIT', { resource: 'products', limit: ctx.slots.limit, current: ctx.slots.current });
    const skus = creates.map((r) => str(r.values.sku) ?? this.skus.generate());
    if ((await this.skus.taken(tx, skus)).size) throw skuTaken();

    // missing categories are created (FL-12)
    const wanted = new Map<string, string>();
    for (const r of rows) {
      const name = str(r.values.category);
      if (name && !ctx.categoryIds.has(name.toLowerCase()) && !wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
    }
    if (wanted.size) {
      const created = await tx.category.createManyAndReturn({ data: [...wanted.values()].map((name) => ({ name })) as Prisma.CategoryCreateManyInput[], select: { id: true, name: true } });
      for (const c of created) ctx.categoryIds.set(c.name.toLowerCase(), c.id);
    }
    const categoryId = (v: Values) => (str(v.category) ? (ctx.categoryIds.get(str(v.category)!.toLowerCase()) ?? null) : null);
    const unitId = (v: Values) => (str(v.unit) ? (ctx.unitIds.get(str(v.unit)!.toLowerCase()) ?? null) : null);
    const keywords = (v: Values) => (str(v.keywords) ? str(v.keywords)!.split(', ') : []);

    // --- new products: one INSERT, opening stock set-based, one moderation item each
    const created = creates.length
      ? await tx.product.createManyAndReturn({
          data: creates.map((r, i) => ({
            sku: skus[i]!,
            name: String(r.values.name),
            description: str(r.values.description),
            categoryId: categoryId(r.values),
            unitId: unitId(r.values),
            trackStock: true,
            price: num(r.values.price)!,
            oldPrice: num(r.values.oldPrice),
            costPrice: num(r.values.costPrice),
            stock: 0,
            minStock: num(r.values.minStock) ?? 0,
            weightGrams: num(r.values.weightGrams),
            keywords: keywords(r.values),
            isActive: r.values.isActive !== false,
            createdById: t.userId ?? null,
          })) as Prisma.ProductCreateManyInput[],
          select: { id: true, sku: true },
        })
      : [];
    const idBySku = new Map(created.map((p) => [p.sku, p.id]));
    await this.stock.openingStock(
      tx,
      creates.map((r, i) => ({ productId: idBySku.get(skus[i]!)!, quantity: num(r.values.stock) ?? 0 })),
      { reason: 'import', refType: 'import', refId: jobId },
    );
    await this.moderation.submitMany(tx, created.map((p) => p.id), 'import');

    // --- existing products (updateExisting): only the mapped columns change; stock moves through a movement
    const review: string[] = [];
    for (const r of updates) {
      const before = await tx.product.findFirst({ where: { sku: str(r.values.sku)!, deletedAt: null } });
      if (!before) throw notFound();
      const data: Prisma.ProductUncheckedUpdateInput = { name: String(r.values.name), price: num(r.values.price)!, version: { increment: 1 } };
      if (mapped('description')) data.description = str(r.values.description);
      if (mapped('category')) data.categoryId = categoryId(r.values);
      if (mapped('unit')) data.unitId = unitId(r.values);
      if (mapped('oldPrice')) data.oldPrice = num(r.values.oldPrice);
      if (mapped('costPrice')) data.costPrice = num(r.values.costPrice);
      if (mapped('minStock')) data.minStock = num(r.values.minStock) ?? 0;
      if (mapped('weightGrams')) data.weightGrams = num(r.values.weightGrams);
      if (mapped('keywords')) data.keywords = keywords(r.values);
      if (mapped('isActive')) data.isActive = r.values.isActive !== false;
      await tx.product.update({ where: { id: before.id }, data });
      if (mapped('stock') && before.trackStock && !before.hasVariants && num(r.values.stock) !== null) {
        await this.stock.move(tx, { productId: before.id, change: { setTo: num(r.values.stock)! }, reason: 'import', refType: 'import', refId: jobId, silent: true });
      }
      const after = {
        name: String(r.values.name),
        description: mapped('description') ? str(r.values.description) : before.description,
        categoryId: mapped('category') ? categoryId(r.values) : before.categoryId,
        price: num(r.values.price)!,
      };
      if (needsReview(before, after)) review.push(before.id);
    }
    await this.moderation.resubmitMany(tx, review, 'import');
    // recette 09/11 UX-044: the result screen says how many products of THIS import wait for validation (the banner
    // showed the shop's total only, which read as if the import had created 6 products to review)
    const touched = [...created.map((p) => p.id), ...review];
    const pendingReview = touched.length ? await tx.product.count({ where: { id: { in: touched }, moderationStatus: 'pending' } }) : 0;
    return { created: created.length, updated: updates.length, skipped: 0, categoriesCreated: wanted.size, pendingReview };
  }
}
