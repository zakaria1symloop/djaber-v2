'use client';
// /admin/reports — Figma "ADM-11 — Platform admin — abuse reports & blocked words" (03 SAFE-06…09, 12 §26 Reports):
// header links "Mots bloqués" (?panel=words) and "Règles automatiques" (?panel=rules: rules, platform blacklist,
// monthly compliance export), 5 KPI tiles, tabs À traiter / Clients signalés / Marchands signalés / Contenu IA signalé /
// Traités, filters in the URL (search, Type, Gravité, Origine, Période), the table (Quand, Type · origine, Objet, Motif,
// Gravité, Assigné, 👁 / ⋯) and the treatment panel of the report in `?sheet=` (first row by default).
import { formatNumber, ReporterKindValues, ReportTypeValues, SeverityValues, type AppLocale, type ReportAdminDto, type ReportStatsDto } from '@djaber/shared';
import { ActionsMenu, ActiveFilters, Button, Card, cn, DataTable, Dialog, FilterChips, FilterDropdown, IconButton, ListSkeleton, OpsKpiStrip, OpsKpiTile, Pill, PillTabs, SearchInput, Skeleton, toast, type Column, type MenuAction } from '@djaber/ui';
import { Eye } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ListEmpty, ListFilteredEmpty, OfflineBanner } from '@/components/global-states';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { usePlatform } from '@/features/admin/platform';
import { ListPagination } from '@/features/catalog/ui';
import { useOffline } from '@/features/orders/offline';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { filterList, filterText } from '@/lib/list-state';
import { relativeTime } from '@/lib/time';
import { useListState } from '@/lib/use-list-state';
import { safetyApi, useMerchantBlocks, useReports, useReportStats, useSafetyEvents, useSafetyRefresh } from './api';
import { PERIODS, REPORT_TABS, reportsApiQuery, REPORTS_SPEC, reportTabCount, reportTabOf } from './logic';
import { AutoRulesSheet, BlockedWordsSheet } from './sheets';
import { reporterName, TreatmentPanel } from './treatment-panel';

/** Grey sub-line of "Objet": "14 messages · 3 commandes jamais récupérées" from `target.meta` counts (contract-b). */
const targetLine = (t: TFunction, r: ReportAdminDto) =>
  [
    r.target.meta?.messages ? t('adminSafety.meta.messages', { count: Number(r.target.meta.messages) }) : null,
    r.target.meta?.uncollectedOrders && Number(r.target.meta.uncollectedOrders) > 0 ? t('adminSafety.meta.uncollected', { count: Number(r.target.meta.uncollectedOrders) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

export function ReportsPage() {
  const t = useT();
  const { can } = usePlatform();
  const canWrite = can('admin.safety.write');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const panel = params.get('panel');
  const setPanel = (v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set('panel', v);
    else p.delete('panel');
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  useSafetyEvents();
  return (
    <AdminPage
      title={t('adminSafety.title')}
      description={t('adminSafety.subtitle')}
      permission="admin.safety.read"
      actions={
        <>
          <Button variant="ghost" onClick={() => setPanel('words')} data-testid="safety-link-words">
            {t('adminSafety.header.words')}
          </Button>
          <Button variant="ghost" onClick={() => setPanel('rules')} data-testid="safety-link-rules">
            {t('adminSafety.header.rules')}
          </Button>
        </>
      }
    >
      <Reports canWrite={canWrite} />
      <BlockedWordsSheet open={panel === 'words'} onClose={() => setPanel(null)} canWrite={canWrite} />
      <AutoRulesSheet open={panel === 'rules'} onClose={() => setPanel(null)} canWrite={canWrite} />
    </AdminPage>
  );
}

function Kpis({ stats, t, onBlocks }: { stats: ReportStatsDto | undefined; t: TFunction; onBlocks: () => void }) {
  if (!stats) {
    return (
      <OpsKpiStrip label={t('adminSafety.kpi.label')}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </OpsKpiStrip>
    );
  }
  return (
    <OpsKpiStrip label={t('adminSafety.kpi.label')}>
      <OpsKpiTile data-kpi="open" context={t('adminSafety.kpi.openContext', { count: stats.over24h })} value={formatNumber(stats.open)} unit={t('adminSafety.kpi.open')} tone={stats.over24h ? 'danger' : undefined} />
      <OpsKpiTile data-kpi="handled" value={formatNumber(stats.handled30d)} unit={t('adminSafety.kpi.handled')} />
      {/* merchant blocks, not reports (UX-014): the tile opens the blocks it counts */}
      <OpsKpiTile
        data-kpi="blocks"
        role="button"
        tabIndex={0}
        aria-label={t('adminSafety.kpi.blocksOpen')}
        onClick={onBlocks}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onBlocks())}
        className="cursor-pointer hover:border-line-lit focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
        context={t('adminSafety.kpi.blocksContext')}
        value={formatNumber(stats.merchantBlocks7d)}
        unit={t('adminSafety.kpi.blocks')}
      />
      <OpsKpiTile data-kpi="merchants" context={t('adminSafety.kpi.merchantsContext')} value={formatNumber(stats.merchantsReported30d)} unit={t('adminSafety.kpi.merchants')} />
      <OpsKpiTile data-kpi="words" context={t('adminSafety.kpi.wordsContext', { count: stats.blockedWords })} value={formatNumber(stats.autoFiltered7d)} unit={t('adminSafety.kpi.words')} />
    </OpsKpiStrip>
  );
}

/** « Clients bloqués par les marchands · 7 j »: the blocks still in force, per workspace (UX-014). */
function MerchantBlocksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useMerchantBlocks(open);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('adminSafety.blocks.title')} description={t('adminSafety.blocks.description')} closeLabel={t('action.close')} size="lg">
      {q.isPending ? (
        <ListSkeleton rows={4} columns={4} label={t('common.loading')} />
      ) : q.isError ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="ts-label-meta text-text-muted">{t('adminSafety.blocks.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-hairline" data-testid="merchant-blocks">
          {q.data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-medium">{b.workspace.name}</span>
              <span className="text-text-secondary">{b.client?.name ?? <span dir="ltr">{b.phone ?? '—'}</span>}</span>
              <Pill>{b.reason ? t(`safety.blockReason.${b.reason}`) : t('safety.reason.none')}</Pill>
              <span className="ts-label-micro text-text-muted">{t(`adminSafety.blocks.source.${b.source}`)}</span>
              <span className="ts-label-micro text-text-muted">{relativeTime(b.blockedAt, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function Reports({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const [blocksOpen, setBlocksOpen] = useState(false);
  const locale = useLocaleCode() as AppLocale;
  const { userId } = usePlatform();
  const list = useListState(REPORTS_SPEC);
  const s = list.state;
  const tab = reportTabOf(s.tab);
  const stats = useReportStats();
  const offline = useOffline();
  const refresh = useSafetyRefresh();
  const query = useMemo(() => reportsApiQuery(list.apiQuery(), tab), [list, tab]);
  const q = useReports(query);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? null;
  const activeId = s.sheet ?? rows[0]?.id ?? null;
  const activeRow = rows.find((r) => r.id === activeId);

  const assignMe = async (r: ReportAdminDto) => {
    try {
      await safetyApi.assign(r.id, { assigneeId: userId });
      toast({ tone: 'success', message: t('adminSafety.toast.assigned') });
      void refresh();
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const menu = (r: ReportAdminDto): MenuAction[] => [
    { key: 'open', label: t('adminSafety.action.open'), onSelect: () => list.openSheet(r.id), primary: true },
    ...(canWrite && r.status !== 'actioned' && r.status !== 'dismissed'
      ? [
          r.assignee?.id === userId
            ? { key: 'unassign', label: t('adminSafety.action.unassign'), onSelect: () => void safetyApi.assign(r.id, { assigneeId: null }).then(refresh, (e) => toast({ tone: 'danger', message: errorMessage(e, t) })) }
            : { key: 'assign', label: t('adminSafety.action.assignMe'), onSelect: () => void assignMe(r) },
        ]
      : []),
  ];

  const types = filterList(s, 'type');
  const severities = filterList(s, 'severity');
  const kinds = filterList(s, 'reporterKind');
  const period = filterText(s, 'period');
  const chips = [
    ...(types.length ? [{ key: 'type', label: `${t('adminSafety.filter.type')} : ${types.map((v) => t(`adminSafety.type.${v}`)).join(', ')}`, onRemove: () => list.setFilter('type', null) }] : []),
    ...(severities.length ? [{ key: 'severity', label: `${t('adminSafety.filter.severity')} : ${severities.map((v) => t(`adminSafety.severity.${v}`)).join(', ')}`, onRemove: () => list.setFilter('severity', null) }] : []),
    ...(kinds.length ? [{ key: 'reporterKind', label: `${t('adminSafety.filter.origin')} : ${kinds.map((v) => t(`adminSafety.origin.${v}`)).join(', ')}`, onRemove: () => list.setFilter('reporterKind', null) }] : []),
    ...(period ? [{ key: 'period', label: `${t('adminSafety.filter.period')} : ${t(`adminSafety.period.${period}`)}`, onRemove: () => list.setFilter('period', null) }] : []),
  ];
  const typeLocked = tab === 'customers' || tab === 'merchants' || tab === 'ai';

  const columns: Column<ReportAdminDto>[] = [
    { key: 'when', header: t('adminSafety.col.when'), cell: (r) => <span className="whitespace-nowrap">{relativeTime(r.createdAt, locale)}</span> },
    {
      key: 'type',
      header: t('adminSafety.col.type'),
      cell: (r) => (
        <div className="min-w-0">
          <div>{t(`adminSafety.type.${r.type}`)}</div>
          <div className="truncate ts-label-micro text-text-muted">{[t('adminSafety.by', { name: reporterName(t, r) }), r.workspace?.name, r.target.meta?.channel ? t(`adminSafety.channel.${r.target.meta.channel}`) : null].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      key: 'target',
      header: t('adminSafety.col.target'),
      cell: (r) => (
        <div className="min-w-0 max-w-64">
          <div className="truncate">{r.target.label}</div>
          {targetLine(t, r) ? <div className="truncate ts-label-micro text-text-muted">{targetLine(t, r)}</div> : null}
        </div>
      ),
    },
    {
      key: 'reason',
      header: t('adminSafety.col.reason'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="max-w-64">
          <div className="line-clamp-2">{t(`adminSafety.reason.${r.reason}`)}</div>
          {r.details ? <div className="line-clamp-1 ts-label-micro text-text-muted">{r.details}</div> : null}
        </div>
      ),
    },
    { key: 'severity', header: t('adminSafety.col.severity'), cell: (r) => <Pill tone={SEVERITY_TONE[r.severity]}>{t(`adminSafety.severity.${r.severity}`)}</Pill> },
    { key: 'assignee', header: t('adminSafety.col.assignee'), hideBelow: 'xl', cell: (r) => (r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName.slice(0, 1)}.`.trim() : <span className="text-text-muted">—</span>) },
  ];
  const since = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString(locale === 'ar' ? 'ar-u-nu-latn' : locale) : '—';

  return (
    <>
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      <Kpis stats={stats.data} t={t} onBlocks={() => setBlocksOpen(true)} />
      <MerchantBlocksDialog open={blocksOpen} onClose={() => setBlocksOpen(false)} />
      <PillTabs label={t('adminSafety.tab.label')} value={tab} onChange={(k) => list.set({ tab: k === 'todo' ? null : k, sheet: null })} tabs={REPORT_TABS.map((k) => ({ key: k, label: t(`adminSafety.tab.${k}`), count: k === 'todo' ? reportTabCount(k, stats.data) : null }))} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('adminSafety.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-72" />
        {typeLocked ? null : (
          <FilterDropdown label={t('adminSafety.filter.type')} count={types.length}>
            <FilterChips label={t('adminSafety.filter.type')} multiple options={ReportTypeValues.map((v) => ({ value: v, label: t(`adminSafety.type.${v}`) }))} value={types} onChange={(v) => list.setFilter('type', v)} />
          </FilterDropdown>
        )}
        <FilterDropdown label={t('adminSafety.filter.severity')} count={severities.length}>
          <FilterChips label={t('adminSafety.filter.severity')} multiple options={SeverityValues.map((v) => ({ value: v, label: t(`adminSafety.severity.${v}`) }))} value={severities} onChange={(v) => list.setFilter('severity', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('adminSafety.filter.origin')} count={kinds.length}>
          <FilterChips label={t('adminSafety.filter.origin')} multiple options={ReporterKindValues.map((v) => ({ value: v, label: t(`adminSafety.origin.${v}`) }))} value={kinds} onChange={(v) => list.setFilter('reporterKind', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('adminSafety.filter.period')} count={period ? 1 : 0}>
          <FilterChips label={t('adminSafety.filter.period')} options={PERIODS.map((p) => ({ value: p, label: t(`adminSafety.period.${p}`) }))} value={period ? [period] : []} onChange={(v) => list.setFilter('period', v[0] ?? null)} />
        </FilterDropdown>
        {total !== null ? <span className="ms-auto ts-label-meta text-text-muted">{t('adminSafety.count', { count: total })}</span> : null}
      </div>
      <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? () => list.set({ q: '', filters: { type: null, severity: null, reporterKind: null, period: null } }) : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />

      {q.isPending ? (
        <Card>
          <ListSkeleton rows={4} columns={7} label={t('common.loading')} />
        </Card>
      ) : q.isError && !q.data ? (
        <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        s.q.trim() || chips.length ? (
          <ListFilteredEmpty entity={t('adminSafety.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={() => list.set({ q: '', filters: { type: null, severity: null, reporterKind: null, period: null } })} />
        ) : (
          <ListEmpty title={t(`adminSafety.empty.${tab}.title`)} description={t(`adminSafety.empty.${tab}.description`)} />
        )
      ) : (
        <DataTable<ReportAdminDto>
          label={t('adminSafety.title')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          density={list.density}
          activeRowKey={activeId}
          onRowClick={(r) => list.openSheet(r.id)}
          actionsLabel={t('action.actions')}
          rowActions={(r) => (
            <div className="flex items-center justify-end gap-1.5">
              <IconButton size="sm" label={t('adminSafety.action.open')} onClick={(e) => (e.stopPropagation(), list.openSheet(r.id))} data-testid="report-open">
                <Eye className="size-4" aria-hidden />
              </IconButton>
              <ActionsMenu iconOnly label={t('action.actions')} heading={r.target.label} actions={menu(r)} />
            </div>
          )}
          card={(r) => (
            <button type="button" className="flex w-full flex-col items-start gap-1 px-3 py-3 text-start" onClick={() => list.openSheet(r.id)}>
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px]">{r.target.label}</span>
                <Pill tone={SEVERITY_TONE[r.severity]}>{t(`adminSafety.severity.${r.severity}`)}</Pill>
              </div>
              <span className="ts-label-micro text-text-muted">{`${t(`adminSafety.type.${r.type}`)} · ${relativeTime(r.createdAt, locale)}`}</span>
            </button>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total ?? rows.length} onChange={(p) => list.set(p)} />}
        />
      )}
      {activeId ? <TreatmentPanel id={activeId} fallback={activeRow} canWrite={canWrite} /> : null}
    </>
  );
}
