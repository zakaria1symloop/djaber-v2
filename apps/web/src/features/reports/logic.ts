// Pure helpers of the reports screens (unit-tested): "Exports récents" row of a job, row link of a report cell, value
// of a report cell by column type, columns shown for the stock mode, chart form of a report.
import { formatNumber, type ReportColumnDef, type ReportDefinition, type ReportJobResult, type ReportRow } from '@djaber/shared';
import type { ExportJobState } from '@djaber/ui';
import { dayLabel, decimal } from '@/features/analytics/format';
import type { JobDto } from '@/lib/jobs';
import { rangeArrow } from '@/lib/format-message';

const NBSP = String.fromCharCode(160);
type T = ((key: string, params?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

const isReportResult = (r: unknown): r is ReportJobResult => !!r && typeof r === 'object' && (r as { kind?: unknown }).kind === 'report';

/**
 * Days left before an export file expires (nearest day, at least 1 while not expired). J11-7 (d): rounded up, a few
 * seconds of difference between the browser clock and the server made « 8 j » next to « 7 j » for files of the same minute.
 */
export const daysLeft = (iso: string, now = Date.now()) => {
  const ms = Date.parse(iso) - now;
  return ms <= 0 ? 0 : Math.max(1, Math.round(ms / 86_400_000));
};
/** Result of a non-report export (Caisse, Ventes, Commandes…): its kind, rows and format (`ExportService.process`). */
type ExportResult = { kind: string; rows?: number; format?: string };
const isExportResult = (r: unknown): r is ExportResult => !!r && typeof r === 'object' && typeof (r as { kind?: unknown }).kind === 'string';

export function jobView(job: JobDto, t: T, locale: string, now = Date.now()): { title: string; meta: string | null; state: ExportJobState; pill: string } {
  const r = isReportResult(job.result) ? job.result : null;
  // J11-7 (d): the Caisse / Ventes exports were « Export · 16 nov. · — » — their kind names them, their result has the rows
  const other = !r && isExportResult(job.result) ? job.result : null;
  const created = dayLabel(new Date(job.createdAt).toISOString().slice(0, 10), locale);
  const kindKey = other ? `notification.value.exportKind.${other.kind}` : null;
  const title = r
    ? [t(`report.${r.reportKey}.title`), r.from && r.to ? `${dayLabel(r.from, locale)} ${rangeArrow(locale)} ${dayLabel(r.to, locale)}` : t('reports.jobs.snapshot', { date: created }), r.format.toUpperCase()].join(' · ')
    : kindKey && t.has(kindKey)
      ? [t(kindKey), created, ...(other?.format ? [other.format.toUpperCase()] : [])].join(' · ')
      : t('reports.jobs.generic', { date: created });
  const rows = r?.rows ?? other?.rows ?? job.total ?? null;
  const meta = rows !== null && rows !== undefined ? t('reports.jobs.rows', { count: rows }) : null;
  let state: ExportJobState;
  let pill: string;
  if (job.status === 'queued' || job.status === 'running') {
    state = 'running';
    pill = t('reports.jobs.running', { pct: Math.max(0, Math.min(100, Math.round(job.progress ?? 0))) });
  } else if (job.status === 'done' || job.status === 'partial') {
    if (job.expiresAt && Date.parse(job.expiresAt) <= now) {
      state = 'expired';
      pill = t('reports.jobs.expired');
    } else {
      state = 'ready';
      pill = job.expiresAt ? t('reports.jobs.ready', { days: daysLeft(job.expiresAt, now) }) : t('reports.jobs.readyShort');
    }
  } else if (job.status === 'failed') {
    state = 'failed';
    pill = t('reports.jobs.failed', { code: job.error?.code ?? 'REPORT_EXPORT_FAILED' });
  } else {
    state = 'cancelled';
    pill = t('reports.jobs.cancelledPill');
  }
  return { title, meta, state, pill };
}

/** Target of a report row (`_ref`), the column that carries the link is `link` on its definition. */
export function rowHref(row: ReportRow): string | null {
  const ref = row._ref;
  if (!ref) return null;
  switch (ref.type) {
    case 'product':
      return `/products/${ref.id}`;
    case 'order':
      return `/orders/${ref.id}`;
    case 'sale':
      return `/sales/${ref.id}`;
    case 'purchase':
      return `/purchases/${ref.id}`;
    case 'client':
      return `/clients/${ref.id}`;
    case 'supplier':
      return `/suppliers?sheet=${ref.id}`;
    case 'category':
      return `/products?categoryIds=${ref.id}`;
  }
}

/** Display of one cell by column type (money / int: `12 500`; pct `34,8 %`; days `12 j`; enum via its i18n key). */
export function cellText(col: ReportColumnDef, v: ReportRow[string] | undefined, t: T, locale: string): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (col.type) {
    case 'money':
    case 'int':
      // full-test STOCK-14 / J07-11: the true minus sign « −1 638 » (Journal de caisse, Écarts d'inventaire…)
      return typeof v === 'number' ? (v < 0 ? `−${formatNumber(-v)}` : formatNumber(v)) : String(v);
    case 'pct':
      return typeof v === 'number' ? `${decimal(v, locale)}${NBSP}%` : String(v);
    case 'days':
      return typeof v === 'number' ? t('reports.days', { count: Math.round(v) }) : String(v);
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dayLabel(v.slice(0, 10), locale, true) : String(v);
    case 'datetime': {
      if (typeof v !== 'string') return String(v);
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return v;
      const tag = locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR';
      return new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Algiers' }).format(d);
    }
    case 'enum': {
      const key = `${col.enumKey}.${v}`;
      return col.enumKey && t.has(key) ? t(key) : String(v);
    }
    default:
      return String(v);
  }
}

/** Columns of the stock mode: cost / margin columns (`advanced`) are hidden in simple mode (03 ONB-03). */
export const visibleColumns = (def: ReportDefinition, stockMode: 'simple' | 'advanced' | undefined) => def.columns.filter((c) => !c.advanced || stockMode !== 'simple');

/** Chart form: time series (x is a day) → bars over time; donut → donut; otherwise a ranking (top 10 bars). */
export function chartForm(def: ReportDefinition): 'time' | 'donut' | 'ranking' | null {
  if (!def.chart) return null;
  if (def.chart.type === 'donut') return 'donut';
  return def.chart.x === 'day' || def.chart.x === 'date' ? 'time' : 'ranking';
}

/** Header of a column: `report.col.<key>` + the currency for money columns ("REVENUS (DA)"). */
export const columnHeader = (col: ReportColumnDef, t: T) => `${t(`report.col.${col.key}`)}${col.type === 'money' ? ' (DA)' : ''}`;
