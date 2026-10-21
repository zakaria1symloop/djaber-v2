'use client';
// /reports/[key] — Figma "ANA-04 — Report — template (Ventes par produit) + large export banner" (12 §24): breadcrumb
// Rapports / group / report, ☆ Favori, "Planifier (e-mail mensuel)" (plan feature `scheduled_reports`, upgrade state
// otherwise), "Exporter ⌄" (CSV toutes les lignes: immédiat ≤ 5 000 lignes sinon tâche · XLSX mise en forme + totaux:
// tâche · PDF page courante + totaux · Copier le lien du rapport), filter chips as query string (Période, Catégorie,
// Fournisseur, Produit, Client, Jours, search), the > 5 000 rows banner, KPI tiles with the comparison, the chart, the
// table (sortable, clickable rows, TOTAL row over every row, pagination 25/50/100) and its [S] / [E] / [FE] states.
import { formatNumber, isReportKey, REPORT_CSV_IMMEDIATE_MAX_ROWS, REPORT_DEFINITIONS, REPORT_GROUP_BY, REPORT_SOURCES, type ReportColumnDef, type ReportDataView, type ReportKey, type ReportRow } from '@djaber/shared';
import {
  AnaKpiSkeleton,
  Banner,
  BarChart,
  Button,
  Card,
  ChartPanel,
  cn,
  DateRangeForm,
  DonutChart,
  EmptyState,
  FilterChips,
  FilteredEmptyState,
  FilterDropdown,
  FunnelBars,
  JobBanner,
  ListSkeleton,
  Ltr,
  Menu,
  MenuItem,
  MonoChip,
  SearchInput,
  Select,
  Table,
  Td,
  Th,
  toast,
  Tr,
  type ChartTone,
} from '@djaber/ui';
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, FileBarChart, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { OfflineBanner, Page404, QueryError } from '@/components/global-states';
import { usePeriod } from '@/features/analytics/api';
import { dayLabel } from '@/features/analytics/format';
import { Kpi } from '@/features/analytics/parts';
import { ANALYTICS_PRESETS, customRangeError, periodQuery, todayAlgiers, type PeriodState } from '@/features/analytics/period';
import { ListPagination } from '@/features/catalog/ui';
import { useCategories } from '@/features/catalog/api';
import { useChannels } from '@/features/channels/api';
import { useSuppliers } from '@/features/gds/api';
import { ProductPicker } from '@/features/gds/product-picker';
import { ClientPicker } from '@/features/gds/sale-dialogs';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useHere, withBack } from '@/lib/back';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, isJobRunning, jobFileName, trackJob, useJob } from '@/lib/jobs';
import { filterText, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { reportsApi, useReport, useReportsHub, type ReportApiQuery } from './api';
import { useToggleFavorite } from './hub';
import { cellText, chartForm, columnHeader, rowHref, visibleColumns } from './logic';
import { ScheduleDialog } from './schedule-dialog';

const TONES: ChartTone[] = ['money', 'orders', 'inbound', 'clients', 'starred'];
const DAYS = [30, 60, 90, 180, 365];

export function ReportPage({ reportKey }: { reportKey: string }) {
  const locale = useLocaleCode();
  if (!isReportKey(reportKey)) return <Page404 homeHref={`/${locale}/home`} />;
  return <ReportView reportKey={reportKey} />;
}

function ReportView({ reportKey }: { reportKey: ReportKey }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const here = useHere();
  const { workspace, can } = useSession();
  const offline = useOffline();
  const hub = useReportsHub(can('reports.read'));
  const toggleFavorite = useToggleFavorite();
  const { period, setPeriod } = usePeriod();
  const def0 = REPORT_DEFINITIONS[reportKey];
  const spec: ListSpec = useMemo(
    () => ({
      filters: { categoryId: 'text', productId: 'text', supplierId: 'text', clientId: 'text', days: 'int', source: 'text', channelId: 'text', groupBy: 'text' },
      sorts: def0.columns.filter((c) => c.sortable).map((c) => c.key),
      defaultSort: def0.defaultSort,
    }),
    [def0],
  );
  const list = useListState(spec);
  const s = list.state;
  const query: ReportApiQuery = useMemo(() => {
    const q: ReportApiQuery = { ...(def0.period === 'range' ? periodQuery(period) : {}), page: s.page, pageSize: s.pageSize };
    if (s.sort && s.sort !== def0.defaultSort) q.sort = s.sort;
    if (s.q.trim().length >= 2) q.q = s.q.trim();
    for (const [k, v] of Object.entries(s.filters)) q[k] = typeof v === 'number' ? v : String(v);
    return q;
  }, [period, s, def0]);
  const ready = def0.period === 'snapshot' || period.period !== 'custom' || (!!period.from && !!period.to);
  const rq = useReport(reportKey, query, ready);
  const view = rq.data?.view;
  const def = view?.definition ?? def0;
  const favorite = hub.data?.favorites.includes(reportKey) ?? false;
  const canSchedulePerm = can('reports.schedule');
  const planFeature = (workspace?.plan?.limits.features ?? []).includes('scheduled_reports');
  const [scheduling, setScheduling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const simple = workspace?.stockMode === 'simple';

  const runExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      const r = await reportsApi.export(reportKey, format, { ...query, lang: locale });
      if (r.kind === 'file') {
        downloadUrl(r.file.url, r.file.fileName);
        toast({ tone: 'success', message: t('reports.export.fileReady', { format: format.toUpperCase(), count: formatNumber(r.file.rows) }) });
      } else {
        setJobId(r.jobId);
        trackJob({
          jobId: r.jobId,
          download: true,
          started: t('reports.export.started', { format: format.toUpperCase() }),
          progress: (job) => t('toast.export.progress', { entity: t(`report.${reportKey}.title`), pct: job.progress, rows: formatNumber(job.total ?? 0) }),
          done: (job) => ({ message: t('toast.export.done', { file: `${t(`report.${reportKey}.title`)} · ${format.toUpperCase()}` }), action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined }),
          failed: (job, error) => (job?.error ? `${job.error.message} (${job.error.code})` : refusal(error, t)),
        });
      }
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setBusy(null);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast(t('reports.export.linkCopied'));
    } catch {
      toast({ tone: 'danger', message: t('reports.export.linkFailed') });
    }
  };

  const group = def?.group;
  const title = t(`report.${reportKey}.title`);
  const offlineReason = offline ? t('banner.offline') : undefined;
  return (
    <AppPage
      wide
      title={title}
      description={t(`report.${reportKey}.description`, { days: s.filters.days !== undefined ? Number(s.filters.days) : (def?.defaultDays ?? 60) })}
      permission="reports.read"
      breadcrumb={
        <nav aria-label={t('reports.breadcrumb')} className="flex flex-wrap items-center gap-1.5 ts-label-meta text-text-muted">
          <Link href="/reports" className="text-accent-inbound hover:underline">
            {t('nav.reports')}
          </Link>
          <span aria-hidden>/</span>
          {group ? <span>{t(`report.group.${group}`)}</span> : null}
          {group ? <span aria-hidden>/</span> : null}
          <span className="text-text-secondary">{title}</span>
        </nav>
      }
      actions={
        <>
          <Button variant="ghost" aria-pressed={favorite} onClick={() => hub.data && void toggleFavorite(hub.data, reportKey)} disabled={!hub.data} disabledReason={offlineReason} data-testid="report-favorite-toggle">
            <Star className={cn('size-4', favorite && 'text-accent-starred')} fill={favorite ? 'currentColor' : 'none'} aria-hidden />
            {t(favorite ? 'reports.favorite.on' : 'reports.favorite.label')}
          </Button>
          {canSchedulePerm ? (
            <Button variant="ghost" onClick={() => setScheduling(true)} disabledReason={offlineReason} data-testid="report-schedule">
              {t('reports.schedule.button')}
              {!planFeature ? <MonoChip tone="warning">{t('reports.schedule.planChip')}</MonoChip> : null}
            </Button>
          ) : null}
          <Menu
            trigger={
              <Button variant="primary" loading={busy !== null} disabled={!view} disabledReason={offline ? offlineReason : undefined} data-testid="report-export">
                {t('action.export')}
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            }
          >
            <ExportItem label={t('reports.export.csv')} hint={t('reports.export.csvHint', { max: formatNumber(REPORT_CSV_IMMEDIATE_MAX_ROWS) })} onSelect={() => void runExport('csv')} name="csv" />
            <ExportItem label={t('reports.export.xlsx')} hint={t('reports.export.xlsxHint')} onSelect={() => void runExport('xlsx')} name="xlsx" />
            <ExportItem label={t('reports.export.pdf')} hint={t('reports.export.pdfHint')} onSelect={() => void runExport('pdf')} name="pdf" />
            <ExportItem label={t('reports.export.link')} hint={t('reports.export.linkHint')} onSelect={() => void copyLink()} name="link" />
          </Menu>
        </>
      }
    >
      {offline ? <OfflineBanner since="—" onRetry={() => void rq.refetch()} /> : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="report-filters">
        {def?.period === 'snapshot' ? (
          <MonoChip className="!h-8 !px-3" title={t('reports.snapshotHelp')}>
            {t('report.snapshot', { date: dayLabel(todayAlgiers(), locale, true) })}
          </MonoChip>
        ) : (
          <PeriodChip period={period} onChange={setPeriod} />
        )}
        {def?.filters.includes('categoryId') ? <CategoryFilter value={filterText(s, 'categoryId')} onChange={(v) => list.setFilter('categoryId', v)} /> : null}
        {def?.filters.includes('supplierId') ? <SupplierFilter value={filterText(s, 'supplierId')} onChange={(v) => list.setFilter('supplierId', v)} /> : null}
        {/* M11 — ANA-04 "Source", "Canal", "Grouper par": rendered only when the definition lists them */}
        {def?.filters.includes('source') ? (
          <FilterDropdown label={t('carry.reports.filter.source', { value: t(`carry.reports.source.${filterText(s, 'source') || 'all'}`) })} count={filterText(s, 'source') && filterText(s, 'source') !== 'all' ? 1 : 0}>
            <FilterChips
              label={t('carry.reports.filter.sourceTitle')}
              options={REPORT_SOURCES.map((v) => ({ value: v, label: t(`carry.reports.source.${v}`) }))}
              value={[filterText(s, 'source') || 'all']}
              onChange={(v) => list.setFilter('source', v[0] && v[0] !== 'all' ? v[0] : null)}
            />
          </FilterDropdown>
        ) : null}
        {def?.filters.includes('channelId') ? <ChannelFilter value={filterText(s, 'channelId')} onChange={(v) => list.setFilter('channelId', v)} /> : null}
        {def?.filters.includes('groupBy') ? (
          <FilterDropdown label={t('carry.reports.filter.groupBy', { value: t(`carry.reports.groupBy.${filterText(s, 'groupBy') || 'variant'}`) })} count={filterText(s, 'groupBy') === 'product' ? 1 : 0}>
            <FilterChips
              label={t('carry.reports.filter.groupByTitle')}
              options={REPORT_GROUP_BY.map((v) => ({ value: v, label: t(`carry.reports.groupBy.${v}`) }))}
              value={[filterText(s, 'groupBy') || 'variant']}
              onChange={(v) => list.setFilter('groupBy', v[0] && v[0] !== 'variant' ? v[0] : null)}
            />
          </FilterDropdown>
        ) : null}
        {def?.filters.includes('productId') ? (
          <FilterDropdown label={t('reports.filter.product', { value: filterText(s, 'productId') ? t('reports.filter.one') : t('reports.filter.all') })} count={filterText(s, 'productId') ? 1 : 0}>
            <div className="flex flex-col gap-2">
              <ProductPicker id="report-product" onPick={(p) => list.setFilter('productId', p.id)} placeholder={t('reports.filter.productSearch')} />
              {filterText(s, 'productId') ? (
                <Button size="sm" variant="ghost" onClick={() => list.setFilter('productId', null)}>
                  {t('action.clearFilters')}
                </Button>
              ) : null}
            </div>
          </FilterDropdown>
        ) : null}
        {def?.filters.includes('clientId') ? (
          <FilterDropdown label={t('reports.filter.client', { value: filterText(s, 'clientId') ? t('reports.filter.one') : t('reports.filter.all') })} count={filterText(s, 'clientId') ? 1 : 0}>
            <div className="flex flex-col gap-2">
              <ClientPicker id="report-client" value={null} onPick={(c) => list.setFilter('clientId', c?.id ?? null)} />
              {filterText(s, 'clientId') ? (
                <Button size="sm" variant="ghost" onClick={() => list.setFilter('clientId', null)}>
                  {t('action.clearFilters')}
                </Button>
              ) : null}
            </div>
          </FilterDropdown>
        ) : null}
        {def?.filters.includes('days') ? (
          <FilterDropdown label={t('reports.filter.days', { count: s.filters.days !== undefined ? Number(s.filters.days) : (def.defaultDays ?? 60) })}>
            <FilterChips
              label={t('reports.filter.daysTitle')}
              options={DAYS.map((d) => ({ value: String(d), label: t('reports.days', { count: d }) }))}
              value={[String(s.filters.days ?? def.defaultDays ?? 60)]}
              onChange={(v) => list.setFilter('days', v[0] && Number(v[0]) !== def.defaultDays ? Number(v[0]) : null)}
            />
          </FilterDropdown>
        ) : null}
        {def?.filters.includes('q') ? <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('reports.searchRows')} clearLabel={t('list.clearSearch')} className="min-w-56 flex-1 sm:max-w-72" /> : null}
      </div>

      {!ready ? (
        <EmptyState icon={<FileBarChart className="size-5" />} title={t('analytics.range.REPORT_CUSTOM_RANGE_REQUIRED')} description={t('analytics.range.pickBoth')} />
      ) : rq.isError && !rq.data ? (
        rq.error instanceof ApiError && ['REPORT_RANGE_TOO_LONG', 'REPORT_CUSTOM_RANGE_REQUIRED', 'INVALID_DATE_RANGE'].includes(rq.error.code) ? (
          <EmptyState icon={<FileBarChart className="size-5" />} title={`${t(`analytics.range.${rq.error.code}`)} (${rq.error.code})`} description={rq.error.message} action={{ label: t('analytics.range.reset'), onClick: () => setPeriod({ ...period, period: '30d', from: '', to: '' }) }} />
        ) : (
          <QueryError error={rq.error} onRetry={() => void rq.refetch()} backHref="/reports" />
        )
      ) : rq.isPending || !view || !def ? (
        <ReportSkeleton />
      ) : (
        <div className={cn('flex flex-col gap-4', rq.isPlaceholderData && 'opacity-60')}>
          <ExportJobBanner jobId={jobId} onClose={() => setJobId(null)} />
          {view.totalRows > REPORT_CSV_IMMEDIATE_MAX_ROWS ? (
            <div data-testid="large-export-banner">
              <Banner tone="warning">{t('reports.largeBanner', { count: formatNumber(view.totalRows) })}</Banner>
            </div>
          ) : null}
          <ReportKpis view={view} simple={simple} />
          <ReportChart view={view} />
          <ReportTable
            view={view}
            simple={simple}
            sort={list.sort}
            onSort={list.setSort}
            total={rq.data?.total ?? view.totalRows}
            page={s.page}
            pageSize={s.pageSize}
            onPage={(p) => list.set(p)}
            filtered={list.filtered}
            onClear={() => list.clear()}
            onRow={(href) => router.push(withBack(href, here))}
          />
        </div>
      )}
      <ScheduleDialog open={scheduling} reportKey={reportKey} planFeature={planFeature} schedules={view?.schedules ?? []} onClose={() => setScheduling(false)} />
    </AppPage>
  );
}

function ExportItem({ label, hint, onSelect, name }: { label: string; hint: string; onSelect: () => void; name: string }) {
  return (
    <MenuItem onSelect={onSelect} data-export={name} className="flex-col !items-start !gap-0.5">
      <span>{label}</span>
      <span className="ts-label-micro !normal-case text-text-muted">{hint}</span>
    </MenuItem>
  );
}

/** "Période : 30 j ⌄" — presets, custom range (11 §7 checks) and comparison. */
function PeriodChip({ period, onChange }: { period: PeriodState; onChange: (p: PeriodState) => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  const [error, setError] = useState<string | null>(null);
  const label = period.period === 'custom' && period.from && period.to ? `${dayLabel(period.from, locale)} → ${dayLabel(period.to, locale)}` : t(`analytics.period.${period.period === 'custom' ? 'custom' : period.period}`);
  return (
    <FilterDropdown label={t('common.period', { label })}>
      <div className="flex flex-col gap-3" data-testid="report-period">
        <FilterChips label={t('gds.period.label')} options={ANALYTICS_PRESETS.map((p) => ({ value: p, label: t(`analytics.period.${p}`) }))} value={period.period === 'custom' ? [] : [period.period]} onChange={(v) => v[0] && onChange({ ...period, period: v[0] as PeriodState['period'], from: '', to: '' })} />
        <div className="border-t border-line-hairline pt-3">
          <div className="mb-2 ts-label-micro text-text-muted">{t('analytics.period.custom')}</div>
          <DateRangeForm
            from={draft.from}
            to={draft.to}
            max={todayAlgiers()}
            onChange={(d) => {
              setDraft(d);
              setError(null);
            }}
            onApply={() => {
              const code = customRangeError(draft.from, draft.to);
              if (code) return setError(`${t(`analytics.range.${code}`)} (${code})`);
              onChange({ ...period, period: 'custom', from: draft.from, to: draft.to });
            }}
            error={error}
            hint={!draft.from ? t('analytics.range.pickStart') : !draft.to ? t('analytics.range.pickEnd') : null}
            labels={{ from: t('common.from'), to: t('common.to'), apply: t('action.apply') }}
          />
        </div>
        <FilterChips
          label={t('analytics.compare.title')}
          options={[
            { value: 'previous', label: t('analytics.compare.previous') },
            { value: 'none', label: t('analytics.compare.none') },
          ]}
          value={[period.compare ? 'previous' : 'none']}
          onChange={(v) => v[0] && onChange({ ...period, compare: v[0] === 'previous' })}
        />
      </div>
    </FilterDropdown>
  );
}

function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string | null) => void }) {
  const t = useT();
  const cats = useCategories();
  const name = cats.data?.find((c) => c.id === value)?.name;
  return (
    <FilterDropdown label={t('reports.filter.category', { value: value ? (name ?? '…') : t('reports.filter.allF') })} count={value ? 1 : 0}>
      <Select aria-label={t('reports.filter.categoryTitle')} value={value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('reports.filter.allF')}</option>
        {(cats.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </FilterDropdown>
  );
}

function SupplierFilter({ value, onChange }: { value: string; onChange: (v: string | null) => void }) {
  const t = useT();
  const sup = useSuppliers({ pageSize: 100, sort: 'name' });
  const rows = sup.data?.rows ?? [];
  const name = rows.find((r) => r.id === value)?.name;
  return (
    <FilterDropdown label={t('reports.filter.supplier', { value: value ? (name ?? '…') : t('reports.filter.all') })} count={value ? 1 : 0}>
      <Select aria-label={t('reports.filter.supplierTitle')} value={value} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('reports.filter.all')}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </FilterDropdown>
  );
}

/** "Canal : tous ⌄" — delivered orders of one connected page (counter sales have no channel). */
function ChannelFilter({ value, onChange }: { value: string; onChange: (v: string | null) => void }) {
  const t = useT();
  const { can } = useSession();
  const channels = useChannels(can('channels.read'));
  const rows = channels.data?.rows ?? [];
  const name = rows.find((r) => r.id === value)?.name;
  return (
    <FilterDropdown label={t('carry.reports.filter.channel', { value: value ? (name ?? '…') : t('reports.filter.all') })} count={value ? 1 : 0}>
      <Select aria-label={t('carry.reports.filter.channelTitle')} value={value} onChange={(e) => onChange(e.target.value || null)} data-testid="report-channel">
        <option value="">{t('reports.filter.all')}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </FilterDropdown>
  );
}

function ReportSkeleton() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="report-skeleton">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <AnaKpiSkeleton count={4} />
      </div>
      <Card>
        <ListSkeleton rows={5} columns={5} label={t('common.loading')} />
      </Card>
    </div>
  );
}

/** Running export started from this page: EN COURS n % → PRÊT (Télécharger) / ÉCHEC. */
function ExportJobBanner({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const t = useT();
  const job = useJob(jobId);
  if (!jobId || !job.data) return null;
  const j = job.data;
  if (isJobRunning(j)) {
    return (
      <JobBanner state="running" pill={t('reports.jobs.running', { pct: j.progress })} progress={j.progress}>
        <span data-testid="export-running">{t('reports.export.running')}</span>
      </JobBanner>
    );
  }
  if (j.status === 'done' || j.status === 'partial') {
    return (
      <JobBanner
        state="done"
        pill={t('reports.jobs.readyShort')}
        action={
          <div className="flex gap-2">
            {j.resultUrl ? (
              <Button size="sm" onClick={() => downloadUrl(j.resultUrl!, jobFileName(j))}>
                {t('action.download')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('action.close')}
            </Button>
          </div>
        }
      >
        {t('reports.export.done')}
      </JobBanner>
    );
  }
  return (
    <JobBanner state="failed" pill={t('reports.jobs.failedShort')} action={<Button size="sm" variant="ghost" onClick={onClose}>{t('action.close')}</Button>}>
      {j.error ? `${j.error.message} (${j.error.code})` : t('error.REPORT_EXPORT_FAILED', { ref: '—' })}
    </JobBanner>
  );
}

function ReportKpis({ view, simple }: { view: ReportDataView; simple: boolean }) {
  const t = useT();
  const defs = new Map(view.definition.kpis.map((k) => [k.key, k]));
  const kpis = view.kpis.filter((k) => !(simple && defs.get(k.key)?.advanced));
  if (!kpis.length) return null;
  return (
    <section className={cn('grid grid-cols-2 gap-3', kpis.length >= 5 ? 'xl:grid-cols-5' : kpis.length === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4')} data-testid="report-kpis">
      {kpis.map((k) => (
        <Kpi
          key={k.key}
          name={k.key}
          k={{ value: k.value, unit: k.unit, previous: k.previous, deltaPct: k.deltaPct }}
          label={`${k.unit === 'money' ? 'DA ' : ''}${t(`report.kpi.${k.key}`)}`.toLowerCase()}
          title={k.figure ? t(`analytics.figureHelp.${k.figure}`) : undefined}
        />
      ))}
    </section>
  );
}

function ReportChart({ view }: { view: ReportDataView }) {
  const t = useT();
  const locale = useLocaleCode();
  const form = chartForm(view.definition);
  const c = view.chart;
  if (!form || !c || !c.points.length || !view.definition.chart) return null;
  const ys = view.definition.chart.y;
  const title = t('reports.chart', { measure: ys.map((y) => t(`report.col.${y}`)).join(' / ') });
  const isMoney = (y: string) => view.definition.columns.find((col) => col.key === y)?.type === 'money';
  const fmt = (n: number) => (isMoney(ys[0]!) ? `${formatNumber(n)} DA` : formatNumber(n));
  if (form === 'time') {
    const series = ys.map((y, i) => ({ key: y, label: t(`report.col.${y}`), tone: TONES[i % TONES.length]! }));
    const buckets = c.points.map((p) => ({ key: p.x, label: /^\d{4}-\d{2}-\d{2}$/.test(p.x) ? dayLabel(p.x, locale) : p.label, values: ys.map((y) => p.values[y] ?? 0) }));
    return (
      <ChartPanel title={title} data-testid="report-chart">
        <BarChart label={title} buckets={buckets} series={series} format={fmt} empty={t('analytics.empty.title')} height={180} startLabel={buckets[0]?.label} endLabel={buckets[buckets.length - 1]?.label} />
      </ChartPanel>
    );
  }
  if (form === 'donut') {
    const y = ys[0]!;
    const col = view.definition.columns.find((x) => x.key === view.definition.chart!.x);
    return (
      <ChartPanel title={title} data-testid="report-chart">
        <DonutChart label={title} format={fmt} empty={t('analytics.empty.title')} slices={c.points.slice(0, 6).map((p, i) => ({ key: p.x, label: col?.enumKey && t.has(`${col.enumKey}.${p.x}`) ? t(`${col.enumKey}.${p.x}`) : p.label, value: p.values[y] ?? 0, tone: TONES[i % TONES.length]! }))} />
      </ChartPanel>
    );
  }
  const y = ys[0]!;
  const top = c.points.slice(0, 10);
  return (
    <ChartPanel title={title} data-testid="report-chart">
      <FunnelBars rows={top.map((p, i) => ({ key: `${p.x}-${i}`, label: view.definition.chart!.x === 'line' && t.has(`report.line.${p.x}`) ? t(`report.line.${p.x}`) : p.label, value: Math.max(0, p.values[y] ?? 0), formatted: fmt(p.values[y] ?? 0), tone: TONES[0]! }))} />
    </ChartPanel>
  );
}

function ReportTable({
  view,
  simple,
  sort,
  onSort,
  total,
  page,
  pageSize,
  onPage,
  filtered,
  onClear,
  onRow,
}: {
  view: ReportDataView;
  simple: boolean;
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  total: number;
  page: number;
  pageSize: 25 | 50 | 100;
  onPage: (p: { page?: number; pageSize?: 25 | 50 | 100 }) => void;
  filtered: boolean;
  onClear: () => void;
  onRow: (href: string) => void;
}) {
  const t = useT();
  const locale = useLocaleCode();
  const cols = visibleColumns(view.definition, simple ? 'simple' : 'advanced');
  if (!view.rows.length) {
    return filtered ? (
      <FilteredEmptyState title={t('state.list.filteredEmpty.title')} description={t('reports.filteredEmptyRows')} action={{ label: t('action.clearFilters'), onClick: onClear }} />
    ) : (
      <EmptyState icon={<FileBarChart className="size-5" />} title={t('analytics.empty.title')} description={t('reports.emptyDescription')} />
    );
  }
  const numeric = (c: ReportColumnDef) => c.type === 'money' || c.type === 'int' || c.type === 'pct' || c.type === 'days';
  const hasTotals = cols.some((c) => c.sum);
  const firstText = cols.findIndex((c) => !numeric(c));
  const cell = (c: ReportColumnDef, r: ReportRow) => {
    // attached file (cash proof): a signed link opened in a new tab, without opening the row's document
    if (c.type === 'file') {
      const url = r[c.key];
      return typeof url === 'string' ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline hover:text-text-primary" onClick={(e) => e.stopPropagation()} data-testid="report-file">
          {t('report.file.view')}
        </a>
      ) : (
        '—'
      );
    }
    const text = cellText(c, r[c.key], t, locale);
    if (c.type === 'date' || c.type === 'datetime') return <span className="whitespace-nowrap">{text}</span>;
    return numeric(c) || c.key === 'sku' || c.key === 'phone' || c.key === 'number' || c.key === 'reference' ? <Ltr className="whitespace-nowrap tabular-nums">{text}</Ltr> : text;
  };
  return (
    <Card className="overflow-hidden" data-testid="report-table">
      <Table aria-label={t(`report.${view.key}.title`)}>
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort.key === c.key;
              return (
                <Th key={c.key} className={numeric(c) ? 'text-end' : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable ? (
                    <button type="button" className={cn('inline-flex items-center gap-1 uppercase hover:text-text-primary', active && 'text-text-primary')} onClick={() => onSort({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : active ? 'desc' : numeric(c) ? 'desc' : 'asc' })} aria-label={t('list.sortBy', { column: columnHeader(c, t) })}>
                      {columnHeader(c, t)}
                      {active ? sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-50" aria-hidden />}
                    </button>
                  ) : (
                    columnHeader(c, t)
                  )}
                </Th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => {
            const href = rowHref(r);
            return (
              <Tr key={`${r._ref?.id ?? ''}-${i}`} data-row={i} className={href ? 'cursor-pointer' : undefined} onClick={href ? () => onRow(href) : undefined} tabIndex={href ? 0 : undefined} onKeyDown={href ? (e) => e.key === 'Enter' && onRow(href) : undefined}>
                {cols.map((c) => (
                  <Td key={c.key} className={cn(numeric(c) && 'text-end')}>
                    {cell(c, r)}
                  </Td>
                ))}
              </Tr>
            );
          })}
        </tbody>
        {hasTotals ? (
          <tfoot>
            <tr className="bg-ink-raised font-medium" data-testid="report-totals">
              {cols.map((c, i) => (
                <Td key={c.key} className={cn('!border-b-0', numeric(c) && 'text-end')}>
                  {i === Math.max(0, firstText) ? t('reports.totalRow', { count: formatNumber(view.totalRows) }) : c.sum ? <Ltr className="whitespace-nowrap tabular-nums">{cellText(c, view.totals[c.key] ?? null, t, locale)}</Ltr> : null}
                </Td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </Table>
      <div className="border-t border-line-hairline">
        <ListPagination page={page} pageSize={pageSize} total={total} onChange={onPage} note={t('reports.rowNote')} />
      </div>
    </Card>
  );
}
