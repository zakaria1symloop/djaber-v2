// ANA-03 / ANA-04 — reports hub and report template (06 "GDS operations" `GET /reports`, `GET /reports/:key`; D62):
// JSON page + KPIs + chart + totals; CSV immediate up to 5 000 rows else a job; XLSX always a job (kind `export`, kept
// 7 days); PDF = current page + totals with the shop logo. Same period rules as the analytics tabs (11 §7).
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  REPORT_CSV_IMMEDIATE_MAX_ROWS,
  REPORT_DEFINITIONS,
  REPORT_GROUPS,
  REPORT_KEYS,
  isReportKey,
  type ReportColumnDef,
  type ReportDataView,
  type ReportDefinition,
  type ReportFileView,
  type ReportFilterKey,
  type ReportJobResult,
  type ReportKey,
  type ReportQuery,
  type ReportRow,
  type ReportsHubView,
} from '@djaber/shared';
import { prisma, TenantContext } from '@djaber/db';
import { AppException, notFound, validationError } from '../../../core/errors/app.exception';
import { I18nService } from '../../../core/i18n/i18n.service';
import { can } from '../../../core/rbac/permission-matrix';
import { StorageService } from '../../../core/storage/storage.service';
import { TenantResolver } from '../../../core/tenancy/tenant.resolver';
import { DailyStatsService } from '../../analytics/daily-stats.service';
import { deltaPct, resolveRange, type DayRange } from '../../analytics/range';
import { ExportService, type ExportFormat, type ExportTable } from '../../jobs/export.service';
import { money } from '../gds-document.pdf';
import type { TableColumn } from '../../jobs/table-file';
import { REPORT_PRODUCERS, type ReportCtx } from './definitions';
import { ReportScheduleService } from './report-schedule.service';

const FILE_URL_TTL_S = 24 * 3600;
const FILE_LINK_TTL_S = 3600;
const FILTER_KEYS: ReportFilterKey[] = ['categoryId', 'productId', 'supplierId', 'clientId', 'days', 'q', 'source', 'channelId', 'groupBy'];
/** Export job filters: the period is stored resolved, so a retry exports the same days. */
export type ReportExportFilters = { key: ReportKey; from: string | null; to: string | null; sort?: string; filters: Partial<Record<ReportFilterKey, string | number>> };
type Lang = 'fr' | 'ar' | 'en';
export type ReportRun = { def: ReportDefinition; range: DayRange | null; rows: ReportRow[]; kpis: Record<string, number | null>; previousKpis: Record<string, number | null> | null; filters: Partial<Record<ReportFilterKey, string | number>>; sort: string };

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr');
};

@Injectable()
export class ReportService implements OnModuleInit {
  constructor(
    private readonly stats: DailyStatsService,
    private readonly exports: ExportService,
    private readonly storage: StorageService,
    private readonly i18n: I18nService,
    private readonly tenants: TenantResolver,
    private readonly schedules: ReportScheduleService,
  ) {}

  onModuleInit() {
    this.exports.registerSource('report', (f, ctx) => this.exportTable(f as unknown as ReportExportFilters, ctx.locale, ctx.format));
    this.schedules.bindRenderer((key, from, to, locale) => this.files(key, from, to, locale));
  }

  // --- hub --------------------------------------------------------------------------------------------------------------
  async hub(): Promise<ReportsHubView> {
    const t = TenantContext.get();
    const [user, schedules, feature] = await Promise.all([
      t.userId ? prisma.user.findUnique({ where: { id: t.userId }, select: { prefs: true } }) : null,
      prisma.reportSchedule.groupBy({ by: ['reportKey'], _count: { _all: true } }),
      this.tenants.hasFeature(t.workspaceId, 'scheduled_reports'),
    ]);
    const prefs = (user?.prefs ?? {}) as { reportFavorites?: unknown };
    const favorites = (Array.isArray(prefs.reportFavorites) ? prefs.reportFavorites : []).filter(isReportKey);
    const scheduled = new Set(schedules.map((s) => s.reportKey));
    const simple = t.stockMode !== 'advanced';
    const groups = REPORT_GROUPS.map((g) => ({
      key: g,
      reports: REPORT_KEYS.filter((k) => REPORT_DEFINITIONS[k].group === g).map((k) => {
        const d = REPORT_DEFINITIONS[k];
        return { key: k, group: g, simple: d.simple, visible: !simple || d.simple, favorite: favorites.includes(k), period: d.period, scheduled: scheduled.has(k) };
      }),
    }));
    return {
      groups,
      favorites,
      stockMode: simple ? 'simple' : 'advanced',
      visibleCount: groups.reduce((s, g) => s + g.reports.filter((r) => r.visible).length, 0),
      canSchedule: feature && can(t.role, 'reports.schedule'),
      csvImmediateMaxRows: REPORT_CSV_IMMEDIATE_MAX_ROWS,
    };
  }

  // --- running a report ---------------------------------------------------------------------------------------------------
  definition(key: string): ReportDefinition {
    if (!isReportKey(key)) throw notFound();
    return REPORT_DEFINITIONS[key];
  }

  private filtersOf(def: ReportDefinition, q: Partial<ReportQuery>) {
    const bad: Record<string, string> = {};
    const filters: Partial<Record<ReportFilterKey, string | number>> = {};
    for (const k of FILTER_KEYS) {
      const v = q[k];
      if (v === undefined || v === '') continue;
      if (!def.filters.includes(k)) bad[k] = 'validation.invalid';
      else filters[k] = v;
    }
    if (Object.keys(bad).length) throw validationError(bad);
    if (def.filters.includes('days') && filters.days === undefined && def.defaultDays) filters.days = def.defaultDays;
    return filters;
  }

  private sortOf(def: ReportDefinition, sort?: string) {
    const s = sort ?? def.defaultSort;
    const col = s.replace(/^-/, '');
    if (s !== def.defaultSort && !def.columns.some((c) => c.key === col && c.sortable !== false)) throw new AppException('BAD_REQUEST', {}, { sort: 'validation.invalid' });
    return s;
  }

  private ctxOf(key: ReportKey, range: DayRange | null, filters: ReportRun['filters'], locale: Lang): ReportCtx {
    return { workspaceId: TenantContext.workspaceId(), range, filters, locale, walkIn: this.i18n.t(locale, 'report.walkIn'), stats: this.stats, now: new Date() };
  }

  async run(key: ReportKey, q: Partial<ReportQuery>, locale: Lang, opts: { withPrevious?: boolean } = {}): Promise<ReportRun> {
    const def = this.definition(key);
    const filters = this.filtersOf(def, q);
    const sort = this.sortOf(def, q.sort);
    const range = def.period === 'range' ? resolveRange({ period: q.period, from: q.from, to: q.to, compare: q.compare }) : null;
    const produce = REPORT_PRODUCERS[key];
    const [res, prev] = await Promise.all([
      produce(this.ctxOf(key, range, filters, locale)),
      opts.withPrevious && range?.previous ? produce(this.ctxOf(key, { ...range, from: range.previous.from, to: range.previous.to, gte: range.previous.gte, lt: range.previous.lt, previous: null }, filters, locale)) : Promise.resolve(null),
    ]);
    const rows = [...res.rows];
    if (key !== 'profit_loss') {
      const col = sort.replace(/^-/, '');
      const dir = sort.startsWith('-') ? -1 : 1;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const an = av === null || av === undefined;
        const bn = bv === null || bv === undefined;
        if (an || bn) return an === bn ? 0 : an ? 1 : -1; // empty cells last in both directions
        return cmp(av, bv) * dir;
      });
    }
    return { def, range, rows, kpis: res.kpis, previousKpis: prev?.kpis ?? null, filters, sort };
  }

  private totals(def: ReportDefinition, rows: ReportRow[]) {
    const out: Record<string, number | null> = {};
    for (const c of def.columns) if (c.sum) out[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return out;
  }

  private label(locale: Lang, c: ReportColumnDef | undefined, v: unknown): string {
    if (v === null || v === undefined) return '';
    if (c?.type === 'enum' && c.enumKey) return this.i18n.t(locale, `${c.enumKey}.${String(v)}`);
    return String(v);
  }

  private chart(run: ReportRun, locale: Lang): ReportDataView['chart'] {
    const ch = run.def.chart;
    if (!ch) return null;
    const xCol = run.def.columns.find((c) => c.key === ch.x);
    const isTime = xCol?.type === 'date' || xCol?.type === 'datetime';
    if (isTime) {
      const by = new Map<string, Record<string, number>>();
      for (const r of run.rows) {
        const x = String(r[ch.x] ?? '').slice(0, 10);
        if (!x) continue;
        const v = by.get(x) ?? Object.fromEntries(ch.y.map((y) => [y, 0]));
        for (const y of ch.y) v[y] = (v[y] ?? 0) + (Number(r[y]) || 0);
        by.set(x, v);
      }
      return { type: ch.type, points: [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([x, values]) => ({ x, label: x, values })) };
    }
    if (run.def.key === 'profit_loss') return { type: ch.type, points: run.rows.map((r) => ({ x: String(r[ch.x]), label: this.label(locale, xCol, r[ch.x]), values: Object.fromEntries(ch.y.map((y) => [y, Number(r[y]) || 0])) })) };
    // categorical: the 10 biggest by the first measure, grouped by label (donut: + "others")
    const by = new Map<string, Record<string, number>>();
    for (const r of run.rows) {
      const x = r[ch.x] === null || r[ch.x] === undefined ? '—' : String(r[ch.x]);
      const v = by.get(x) ?? Object.fromEntries(ch.y.map((y) => [y, 0]));
      for (const y of ch.y) v[y] = (v[y] ?? 0) + (Number(r[y]) || 0);
      by.set(x, v);
    }
    const sorted = [...by.entries()].sort((a, b) => (b[1][ch.y[0]!] ?? 0) - (a[1][ch.y[0]!] ?? 0));
    return { type: ch.type, points: sorted.slice(0, 10).map(([x, values]) => ({ x, label: this.label(locale, xCol, x === '—' ? null : x) || '—', values })) };
  }

  /** `GET /reports/:key?format=json` */
  async data(key: string, q: ReportQuery, locale: Lang): Promise<{ data: ReportDataView; page: number; pageSize: number; total: number }> {
    const run = await this.run(key as ReportKey, q, locale, { withPrevious: q.compare !== 'none' });
    const t = TenantContext.get();
    const start = (q.page - 1) * q.pageSize;
    const schedules = can(t.role, 'reports.schedule') ? await this.schedules.list(run.def.key) : [];
    const view: ReportDataView = {
      key: run.def.key,
      definition: run.def,
      range: run.range ? { period: run.range.period, from: run.range.from, to: run.range.to, days: run.range.days, previous: run.range.previous ? { from: run.range.previous.from, to: run.range.previous.to } : null } : null,
      filters: run.filters,
      kpis: run.def.kpis.map((k) => {
        const value = run.kpis[k.key] ?? null;
        return {
          key: k.key,
          value,
          unit: k.unit,
          ...(k.figure ? { figure: k.figure } : {}),
          ...(run.previousKpis ? { previous: run.previousKpis[k.key] ?? null, deltaPct: deltaPct(value, run.previousKpis[k.key] ?? null) } : {}),
        };
      }),
      chart: this.chart(run, locale),
      rows: this.signFiles(run.def, run.rows.slice(start, start + q.pageSize)),
      totals: this.totals(run.def, run.rows),
      totalRows: run.rows.length,
      csvMode: run.rows.length <= REPORT_CSV_IMMEDIATE_MAX_ROWS ? 'immediate' : 'job',
      schedules,
      generatedAt: new Date().toISOString(),
    };
    return { data: view, page: q.page, pageSize: q.pageSize, total: run.rows.length };
  }

  /** `file` cells hold a storage key: the page gets a signed link (1 h), never the key. */
  private signFiles(def: ReportDefinition, rows: ReportRow[]): ReportRow[] {
    const files = def.columns.filter((c) => c.type === 'file').map((c) => c.key);
    if (!files.length) return rows;
    return rows.map((r) => ({ ...r, ...Object.fromEntries(files.map((k) => [k, typeof r[k] === 'string' ? this.storage.signedUrl(r[k] as string, FILE_LINK_TTL_S) : null])) }));
  }

  // --- files --------------------------------------------------------------------------------------------------------------
  /** Columns of the exported files: the stock mode's columns, without the attached-file links. */
  private columnsFor(def: ReportDefinition) {
    const advanced = TenantContext.get().stockMode === 'advanced';
    return def.columns.filter((c) => (advanced || !c.advanced) && c.type !== 'file');
  }

  private table(run: ReportRun, rows: ReportRow[], locale: Lang): ExportTable<ReportRow> {
    const title = this.i18n.t(locale, `report.${run.def.key}.title`, { days: Number(run.filters.days ?? run.def.defaultDays ?? 0) });
    const cols = this.columnsFor(run.def);
    const columns: TableColumn<ReportRow>[] = cols.map((c) => ({
      header: this.i18n.t(locale, `report.col.${c.key}`),
      value: (r: ReportRow) => {
        const v = r[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === 'enum') return this.label(locale, c, v);
        if (typeof v === 'object') return null;
        return v;
      },
      kind: c.type === 'money' ? 'money' : c.type === 'int' || c.type === 'pct' || c.type === 'days' ? 'number' : 'text',
      width: c.type === 'text' ? 3 : c.type === 'datetime' ? 2.4 : 2,
    }));
    const totals = this.totals(run.def, run.rows);
    const period = run.range ? `${run.range.from} → ${run.range.to}` : this.i18n.t(locale, 'report.snapshot', { date: new Date().toISOString().slice(0, 10) });
    return {
      sheetName: title.slice(0, 31),
      fileName: `${run.def.key.replace(/_/g, '-')}-${run.range ? `${run.range.from}_${run.range.to}` : new Date().toISOString().slice(0, 10)}`,
      columns,
      rows,
      pdf: {
        title,
        subtitle: '',
        meta: [{ label: this.i18n.t(locale, 'report.period'), value: period }],
        totals: cols
          .filter((c) => c.sum)
          .map((c) => ({ label: this.i18n.t(locale, `report.col.${c.key}`), value: c.type === 'money' ? money(totals[c.key] ?? 0) : String(totals[c.key] ?? 0) })),
      },
    };
  }

  private async store(file: { body: Buffer; mime: string; ext: string }, fileName: string, rows: number, format: 'csv' | 'pdf'): Promise<ReportFileView> {
    const key = `private/ws/${TenantContext.workspaceId()}/reports/${fileName}-${Date.now()}.${file.ext}`;
    await this.storage.put(key, file.body, file.mime);
    return { url: this.storage.signedUrl(key, FILE_URL_TTL_S), fileName: `${fileName}.${file.ext}`, size: file.body.length, expiresAt: new Date(Date.now() + FILE_URL_TTL_S * 1000).toISOString(), rows, format };
  }

  /** `format=csv|xlsx|pdf`: `{ file }` (200) or `{ jobId }` (202). */
  async export(key: string, q: ReportQuery, locale: Lang): Promise<{ file: ReportFileView } | { jobId: string }> {
    const def = this.definition(key);
    const format = q.format as 'csv' | 'xlsx' | 'pdf';
    const run = await this.run(def.key, q, locale);
    if (format === 'pdf') {
      const start = (q.page - 1) * q.pageSize;
      const table = this.table(run, run.rows.slice(start, start + q.pageSize), locale);
      return { file: await this.store(await this.exports.render(table, 'pdf', locale), table.fileName, table.rows.length, 'pdf') };
    }
    if (format === 'csv' && run.rows.length <= REPORT_CSV_IMMEDIATE_MAX_ROWS) {
      const table = this.table(run, run.rows, locale);
      return { file: await this.store(await this.exports.render(table, 'csv', locale), table.fileName, table.rows.length, 'csv') };
    }
    const filters: ReportExportFilters = { key: def.key, from: run.range?.from ?? null, to: run.range?.to ?? null, sort: run.sort, filters: run.filters };
    const label: ReportJobResult = { kind: 'report', reportKey: def.key, from: filters.from, to: filters.to, format };
    return this.exports.request('report', filters as unknown as Record<string, unknown>, format, label as unknown as Record<string, unknown>);
  }

  /** Export job source (worker): the whole report as a table. */
  private async exportTable(f: ReportExportFilters, locale: Lang, _format: ExportFormat): Promise<ExportTable> {
    const run = await this.run(f.key, { ...(f.from && f.to ? { from: f.from, to: f.to } : {}), sort: f.sort, ...(f.filters as Partial<ReportQuery>) }, locale);
    return this.table(run, run.rows, locale);
  }

  /** Monthly e-mail files (PDF + XLSX of the whole report) for `sched-report-schedules`. */
  async files(key: ReportKey, from: string, to: string, locale: Lang) {
    const run = await this.run(key, { from, to }, locale);
    const table = this.table(run, run.rows, locale);
    const [pdf, xlsx] = await Promise.all([this.exports.render({ ...table, rows: table.rows.slice(0, 2000) }, 'pdf', locale), this.exports.render(table, 'xlsx', locale)]);
    return { title: table.pdf!.title, fileName: table.fileName, rows: run.rows.length, files: [pdf, xlsx] };
  }
}
