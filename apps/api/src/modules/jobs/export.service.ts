// 03-events-and-jobs §3 `jobs/export` — one generic export job: a registered source turns the stored filters into a table,
// the file is written under `private/` (signed URL, 24 h) and linked to the `Job` row (kept 7 days, D62).
// Formats: CSV / XLSX (06 §7) and, since M8, PDF (A4 table with header, totals and the shop logo — reports, orders).
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma, TenantContext, type Job } from '@djaber/db';
import { AppException } from '../../core/errors/app.exception';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { StorageService } from '../../core/storage/storage.service';
import { money, renderGdsDocument } from '../gds/gds-document.pdf';
import { JobService } from './job.service';
import { exportDateTime } from './export-cells';
import { writeTable, type TableColumn, type TableFormat } from './table-file';
import { isDateCell } from './xlsx';
import { logoBytes } from '../uploads/logo-bytes';

export type ExportTable<T = any> = {
  sheetName: string;
  fileName: string;
  columns: TableColumn<T>[];
  rows: T[];
  /** PDF only: title, meta lines and totals of the printed table */
  pdf?: { title: string; subtitle?: string; meta?: { label: string; value: string }[]; totals?: { label: string; value: string; bold?: boolean }[]; landscape?: boolean };
};
/** Runs in the tenant scope of the job's workspace, as the user who asked for the export. */
export type ExportSource = (filters: Record<string, unknown>, ctx: { locale: 'fr' | 'ar' | 'en'; jobId: string; format: ExportFormat }) => Promise<ExportTable>;
export type ExportKind = 'products' | 'movements' | 'orders' | 'clients' | 'cash' | 'report' | 'audit' | 'ledger' | 'conversation-eval' | 'shipments' | 'purchases' | 'sales';
export type ExportFormat = TableFormat | 'pdf';
export type ExportFile = { body: Buffer; mime: string; ext: ExportFormat };

const EXPORT_TTL_MS = 7 * 24 * 3600 * 1000;

/** Cell text of the PDF table: money columns `12 500 DA`, other numbers with thin grouping. */
const pdfCell = (v: unknown, kind?: TableColumn<unknown>['kind']) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return kind === 'money' ? money(v) : v.toLocaleString('fr-FR').replace(/\s/g, ' ');
  if (isDateCell(v)) return v.text;
  if (v instanceof Date) return exportDateTime(v)?.text ?? '';
  return String(v);
};

@Injectable()
export class ExportService implements OnModuleInit {
  private readonly sources = new Map<string, ExportSource>();
  constructor(
    private readonly jobs: JobService,
    private readonly registry: ProcessorRegistry,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.registry.register('jobs', 'export', (data: { jobId: string }) => this.process(data.jobId), { concurrency: 2 });
  }

  /** Feature modules declare what they can export (`products`, `movements`, later `orders`, `clients`, reports…). */
  registerSource(kind: ExportKind, source: ExportSource) {
    this.sources.set(kind, source);
  }

  /** `202 { jobId }` — the file is produced by the worker. `label` = initial `Job.result` (kept on retry). */
  async request(kind: ExportKind, filters: Record<string, unknown>, format: ExportFormat = 'xlsx', label?: Record<string, unknown>) {
    const t = TenantContext.get();
    const job = await this.jobs.create({
      kind: 'export',
      name: 'export',
      payload: { kind, filters, format, locale: t.locale, ...(label ? { label } : {}) },
      expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      ...(label ? { result: label } : {}),
    });
    return { jobId: job.id };
  }

  /** Renders a table into a file (also used for immediate CSV / PDF answers and the scheduled report e-mails). */
  async render(table: ExportTable, format: ExportFormat, locale: 'fr' | 'ar' | 'en'): Promise<ExportFile> {
    if (format !== 'pdf') return writeTable(format, table.sheetName, table.columns, table.rows);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { name: true, logoUrl: true } });
    const body = await renderGdsDocument({
      lang: locale,
      shopName: ws.name,
      title: table.pdf?.title ?? table.sheetName,
      number: table.pdf?.subtitle ?? '',
      meta: table.pdf?.meta ?? [],
      columns: table.columns.map((c) => ({ header: c.header, width: c.width ?? (c.kind === 'text' ? 3 : 2), align: c.kind && c.kind !== 'text' ? 'right' : undefined })),
      rows: table.rows.map((row) => table.columns.map((c) => pdfCell(c.value(row), c.kind))),
      totals: table.pdf?.totals ?? [],
      landscape: table.pdf?.landscape ?? table.columns.length > 7,
      logo: await this.logo(ws.logoUrl),
    });
    return { body, mime: 'application/pdf', ext: 'pdf' };
  }

  /** The shop logo bytes for PDF headers (null when absent or not stored by us). */
  private logo(url: string | null): Promise<Buffer | null> {
    // a WebP / GIF logo is converted to PNG (pdfkit draws PNG / JPEG only)
    return logoBytes(this.storage, url);
  }

  /** Job handler. A second run of a finished job is a no-op (JobService.run). */
  async process(jobId: string) {
    await this.jobs.run(jobId, async (job: Job) => {
      const p = (job.payload ?? {}) as { kind?: string; filters?: Record<string, unknown>; format?: ExportFormat; locale?: 'fr' | 'ar' | 'en'; label?: Record<string, unknown> };
      const source = p.kind ? this.sources.get(p.kind) : undefined;
      if (!source) throw new AppException('REPORT_EXPORT_FAILED');
      const t = TenantContext.get();
      const format: ExportFormat = p.format === 'csv' || p.format === 'pdf' ? p.format : 'xlsx';
      const locale = p.locale ?? t.locale;
      const table = await source(p.filters ?? {}, { locale, jobId, format });
      if (await this.jobs.isCancelled(jobId)) return;
      const file = await this.render(table, format, locale);
      const key = `private/ws/${t.workspaceId}/exports/${jobId}.${file.ext}`;
      await this.storage.put(key, file.body, file.mime);
      const upload = await prisma.upload.create({
        data: { workspaceId: t.workspaceId, storageKey: key, url: key, mime: file.mime, size: file.body.length, kind: 'export', createdById: job.createdById! },
      });
      return { resultUploadId: upload.id, result: { ...(p.label ?? {}), kind: p.kind, rows: table.rows.length, format: file.ext, fileName: `${table.fileName}.${file.ext}`, size: file.body.length } };
    });
  }
}
