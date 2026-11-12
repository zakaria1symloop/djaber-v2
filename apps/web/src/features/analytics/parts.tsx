'use client';
// Building blocks of the analytics tabs (Figma ANA-02 / ANA-02b: each tab = KPI tiles · 1 chart · 1 table, clickable
// to the filtered list): KPI tile from an `AnalyticsKpi`, the tab frame with its states (skeleton "tuiles + graphique
// + 5 lignes", error / range refused, offline, PÉRIODE VIDE with "Connecter une page", per-tab "Aucune donnée sur la
// période" + revenue definition), the series → bars adapter and a small data table.
import type { AnalyticsKpi, AnalyticsSeries } from '@djaber/shared';
import { AnaKpiSkeleton, AnaKpiTile, buttonClass, Card, ChartPanel, cn, DeltaBadge, EmptyState, ErrorState, ListSkeleton, Ltr, Table, Td, Th, Tr, type ChartBucket } from '@djaber/ui';
import { BarChart3, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { OfflineBanner, QueryError } from '@/components/global-states';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { isRangeError, usePeriod } from './api';
import { dayLabel, formatValue, INVERTED_KPIS, kpiDelta, type Unit } from './format';
import { DEFAULT_PRESET } from './period';

export function useFigure() {
  const t = useT();
  const locale = useLocaleCode();
  const units = { s: t('analytics.unit.s'), min: t('analytics.unit.min'), d: t('analytics.unit.d') };
  return (value: number | null | undefined, unit: Unit) => formatValue(value, unit, locale, units);
}

/** Tile of one KPI: `analytics.kpi.<tab>.<key>` is the unit label ("DA revenus"), meta/sub come from the tab. */
export function Kpi({ k, name, label, meta, sub, title, onClick }: { k: AnalyticsKpi | undefined; name: string; label: string; meta?: ReactNode; sub?: ReactNode; title?: string; onClick?: () => void }) {
  const fig = useFigure();
  const d = kpiDelta(k);
  return (
    <AnaKpiTile
      data-kpi={name}
      value={fig(k?.value ?? null, k?.unit ?? 'count')}
      unit={label}
      delta={d ? <DeltaBadge value={d.value} unit={d.unit} invert={INVERTED_KPIS.has(name)} /> : undefined}
      meta={meta}
      sub={sub}
      title={title}
      onClick={onClick}
    />
  );
}

/** Row of KPI tiles (5 per row at 1440, 2 on phones). */
export const KpiRow = ({ children, count = 5 }: { children: ReactNode; count?: number }) => (
  <section className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', count >= 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4')} data-testid="analytics-kpis">
    {children}
  </section>
);

/** Number from a KPI hint (`null` when absent). */
export const hintNum = (k: AnalyticsKpi | undefined, key: string): number | null => {
  const v = k?.hint?.[key];
  return typeof v === 'number' ? v : null;
};

/** Series → bars: one bucket per day, values in the order of `keys`; previous totals for the dashed line. */
export function toBuckets<K extends string>(series: AnalyticsSeries<K>, keys: K[], locale: string): { buckets: ChartBucket[]; previous: (number | null)[] | null } {
  const buckets = series.points.map((p) => ({ key: p.day, label: dayLabel(p.day, locale), values: keys.map((k) => p.values[k] ?? 0) }));
  const hasPrev = series.points.some((p) => p.previous);
  const previous = hasPrev ? series.points.map((p) => (p.previous ? keys.reduce((s, k) => s + ((p.previous as Record<K, number>)[k] ?? 0), 0) : null)) : null;
  return { buckets, previous };
}

/** Axis labels of a series (first and last day). */
export function axis(series: AnalyticsSeries, locale: string) {
  const pts = series.points;
  return { startLabel: pts[0] ? dayLabel(pts[0].day, locale) : undefined, endLabel: pts.length ? dayLabel(pts[pts.length - 1]!.day, locale) : undefined };
}

/** Skeleton of a tab: tiles + chart + 5 table rows. */
export function TabSkeleton({ tiles = 5 }: { tiles?: number }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="analytics-skeleton">
      <KpiRow count={tiles}>
        <AnaKpiSkeleton count={tiles} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[260px] animate-pulse rounded-card border border-line-edge bg-ink-surface" />
        <Card>
          <ListSkeleton rows={5} columns={4} label={t('common.loading')} />
        </Card>
      </div>
    </div>
  );
}

/** "Revenus = ventes comptoir (date de vente) + commandes livrées (date de livraison)" — 04 §4 named figures. */
export function RevenueDefinition({ className }: { className?: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center gap-1 ts-label-micro !normal-case text-text-muted', className)} title={t('analytics.revenueDefinition')} data-testid="revenue-definition">
      <Info className="size-3" aria-hidden />
      {t('analytics.revenueDefinitionShort')}
    </span>
  );
}

/**
 * Frame of one tab: picks the state. `data.empty` ⇒ PÉRIODE VIDE (the tiles still show "—" / zeros under the notice,
 * CTA "Connecter une page" when the workspace has no page yet).
 */
export function TabFrame<T extends { empty: boolean; hasChannels: boolean }>({ q, tiles = 5, children }: { q: { data?: T; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown; isPlaceholderData?: boolean; dataUpdatedAt?: number }; tiles?: number; children: (data: T) => ReactNode }) {
  const t = useT();
  const { period, setPeriod } = usePeriod();
  const offline = useOffline();
  const locale = useLocaleCode();
  const incomplete = period.period === 'custom' && (!period.from || !period.to);
  if (incomplete) {
    return <EmptyState icon={<BarChart3 className="size-5" />} title={t('analytics.range.REPORT_CUSTOM_RANGE_REQUIRED')} description={t('analytics.range.pickBoth')} action={{ label: t('analytics.range.reset'), onClick: () => setPeriod({ ...period, period: DEFAULT_PRESET, from: '', to: '' }) }} />;
  }
  if (q.isError && !q.data) {
    if (isRangeError(q.error)) {
      const e = q.error as ApiError;
      return <ErrorState title={t(`analytics.range.${e.code}`)} description={e.message} action={{ label: t('analytics.range.reset'), onClick: () => setPeriod({ ...period, period: DEFAULT_PRESET, from: '', to: '' }) }} />;
    }
    return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  }
  if (q.isPending || !q.data) return <TabSkeleton tiles={tiles} />;
  const since = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleString(locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale) : '—';
  return (
    <div className={cn('flex flex-col gap-4', q.isPlaceholderData && 'opacity-60')}>
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      {q.data.empty ? <EmptyPeriod hasChannels={q.data.hasChannels} /> : null}
      {children(q.data)}
    </div>
  );
}

/** PÉRIODE VIDE: "Aucune donnée sur la période" + revenue definition; "Connecter une page" when there is none yet. */
export function EmptyPeriod({ hasChannels }: { hasChannels: boolean }) {
  const t = useT();
  const { can } = useSession();
  const noPage = !hasChannels;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-edge bg-ink-surface px-4 py-3" data-testid="analytics-empty">
      <BarChart3 className="size-4 text-text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[14px]">{t('analytics.empty.title')}</div>
        <div className="ts-label-meta text-text-muted">{t(noPage ? 'analytics.empty.noPage' : 'analytics.empty.description')}</div>
      </div>
      <RevenueDefinition />
      {noPage && can('channels.manage') ? (
        <Link href="/channels" className={buttonClass({ variant: 'primary', size: 'sm' })} data-testid="analytics-connect">
          {t('analytics.empty.connect')}
        </Link>
      ) : null}
    </div>
  );
}

/* ---------- table of a tab (clickable rows → filtered list) ---------- */
export type TabColumn<R> = { key: string; header: string; align?: 'end'; cell: (r: R) => ReactNode };
export function TabTable<R>({ title, columns, rows, rowKey, href, empty, end, className, testId }: { title: string; columns: TabColumn<R>[]; rows: R[]; rowKey: (r: R) => string; href?: (r: R) => string | null; empty?: string; end?: ReactNode; className?: string; testId?: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <ChartPanel title={title} end={end} className={className} bodyClassName="!px-0 !pb-1" data-testid={testId}>
      {rows.length ? (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key} className={c.align === 'end' ? 'text-end' : undefined}>
                  {c.header}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const to = href?.(r) ?? null;
              return (
                <Tr
                  key={rowKey(r)}
                  data-row={rowKey(r)}
                  className={to ? 'cursor-pointer' : undefined}
                  onClick={to ? () => router.push(to) : undefined}
                  tabIndex={to ? 0 : undefined}
                  onKeyDown={to ? (e) => e.key === 'Enter' && router.push(to) : undefined}
                >
                  {columns.map((c) => (
                    <Td key={c.key} className={cn(c.align === 'end' && 'text-end tabular-nums')}>
                      {c.cell(r)}
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <p className="px-4 py-8 text-center ts-label-meta text-text-muted">{empty ?? t('analytics.empty.title')}</p>
      )}
    </ChartPanel>
  );
}

/** `<Ltr>` number cell. */
export const Num = ({ children }: { children: ReactNode }) => <Ltr className="whitespace-nowrap tabular-nums">{children}</Ltr>;

/** Delta cell of a table row (% or pts). */
export function DeltaCell({ pct, pts, invert, isNew }: { pct?: number | null; pts?: number | null; invert?: boolean; isNew?: boolean }) {
  const t = useT();
  if (isNew) return <span className="ts-label-micro text-text-muted">{t('analytics.new')}</span>;
  if (pts !== undefined && pts !== null) return <DeltaBadge value={pts} unit="pts" invert={invert} />;
  if (pct !== undefined && pct !== null) return <DeltaBadge value={pct} invert={invert} />;
  return <span className="text-text-muted">—</span>;
}

/** Two-column layout chart | table (stacks below 1024). */
export const ChartAndTable = ({ children }: { children: ReactNode }) => <div className="grid items-start gap-4 lg:grid-cols-2">{children}</div>;

/** Small inline note of a tab (Figma grey caption next to the tab title). */
export const TabNote = ({ children }: { children: ReactNode }) => <p className="ts-label-micro !normal-case text-text-muted" data-testid="tab-note">{children}</p>;
