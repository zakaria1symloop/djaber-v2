'use client';
// /cash — Figma "GDS-09 — Cash register — ledger with locked automatic rows" (03 GDS-08, CSH-01…04, 12 §21 "Cash
// register"). The selection (`day` default today · period pill · custom range) drives the table AND the KPIs
// (`GET /cash` + `GET /cash/stats` with the same parameters — 09 §4 regression "period pills ↔ table in sync").
// Filters Sens / Type / Mode / Par / source in the URL; AUTO 🔒 rows open their reference and are locked
// (`CAISSE_EDIT_AUTOMATIC` / `CAISSE_DELETE_AUTOMATIC`), MANUEL rows ⋯ Modifier ≤ 24 h · Supprimer · Dupliquer;
// "Clôturer la journée" (theoretical vs counted) locks the day (`CASH_DAY_CLOSED`), "Rouvrir" (Admin+); export job.
import { formatDateTime, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  ActiveFilters,
  Banner,
  Button,
  Card,
  cn,
  ConfirmDialog,
  DataTable,
  FilterChips,
  FilterDateRange,
  FilterDropdown,
  KpiTile,
  Ltr,
  SearchInput,
  SignedAmount,
  SourceBadge,
  toast,
  type Column,
} from '@djaber/ui';
import { Paperclip } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { algiersDay, addDays, withoutYear } from '@/features/catalog/stock/logic';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { useMembers } from '@/features/workspace/api';
import { useRouter } from '@/i18n/navigation';
import { actionState, toMenuActions } from '@/lib/actions';
import { useHere, withBack } from '@/lib/back';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { filterList, filterText, type ApiQuery, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { gdsApi, useCash, useCashDays, useCashStats, useGdsRefresh } from './api';
import { CashCategoryPill, AdvancedOnly, KpiSkeleton, shortName, useDayLabel } from './ui';
import { CloseDayDialog, ManualEntryDialog, ReopenDayDialog, type ManualMode } from './cash-dialogs';
import { CASH_CATEGORIES, PAYMENT_METHODS, type CashRow, type GdsPeriodKey } from './contracts';
import { cashSelection, cashSelectionQuery, daysList, selectionDay } from './logic';

export const CASH_SPEC: ListSpec = {
  filters: { day: 'date', period: 'text', from: 'date', to: 'date', direction: 'text', category: 'list', method: 'list', createdById: 'list', source: 'text' },
  sorts: ['date'],
  defaultSort: '-date',
};
const CASH_PERIODS = ['7d', '30d', 'month', 'last_month'] as const satisfies readonly GdsPeriodKey[];

export function CashPage() {
  const t = useT();
  return (
    <AdvancedOnly title={t('nav.cash')}>
      <CashLedger />
    </AdvancedOnly>
  );
}

function CashLedger() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const list = useListState(CASH_SPEC);
  const here = useHere();
  const s = list.state;
  const offline = useOffline();
  const refresh = useGdsRefresh();
  const day = useDayLabel();
  const today = algiersDay();
  const sel = cashSelection({ day: filterText(s, 'day'), period: filterText(s, 'period'), from: filterText(s, 'from'), to: filterText(s, 'to') }, today);
  const selQuery = cashSelectionQuery(sel);
  // the same parameters for the table and the KPIs: only paging / sorting differ
  const shared = { ...selQuery, ...pick(list.filterQuery(), ['direction', 'category', 'method', 'createdById', 'source', 'q']) };
  const q = useCash({ ...shared, sort: s.sort, page: s.page, pageSize: s.pageSize });
  const stats = useCashStats(shared);
  const days = useCashDays();
  const members = useMembers(can('members.read'));
  const canWrite = can('gds.write');
  const [manual, setManual] = useState<ManualMode | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [reopen, setReopen] = useState<string | null>(null);
  const [del, setDel] = useState<CashRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? null;
  const k = stats.data;
  const oneDay = selectionDay(sel);
  const dayRow = oneDay ? days.data?.find((d) => d.day === oneDay) : undefined;
  const closed = k?.day?.closed ?? dayRow?.closed ?? false;
  const closeAction = dayRow ? actionState(dayRow.actions, 'close', t) : { present: !!oneDay, enabled: !!oneDay && oneDay < today ? true : !!oneDay, reason: undefined };
  const reopenAction = dayRow ? actionState(dayRow.actions, 'reopen', t) : { present: false, enabled: false };
  const multiDay = !oneDay;

  const memberOptions = [{ value: 'system', label: t('cash.system') }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email }))];
  const direction = filterText(s, 'direction');
  const categories = filterList(s, 'category');
  const methods = filterList(s, 'method');
  const by = filterList(s, 'createdById');
  const source = filterText(s, 'source');
  const selLabel = sel.kind === 'day' ? (sel.day === today ? t('gds.period.today') : day(sel.day)) : sel.kind === 'period' ? t(`gds.period.${sel.period}`) : `${day(sel.from)} → ${day(sel.to)}`;
  const chips = [
    ...(direction ? [{ key: 'direction', label: `${t('cash.filter.direction')} : ${t(`cash.direction.${direction}`)}`, onRemove: () => list.setFilter('direction', null) }] : []),
    ...(categories.length ? [{ key: 'category', label: `${t('cash.col.type')} : ${categories.map((c) => t(`enum.Cash.category.${c}`)).join(', ')}`, onRemove: () => list.setFilter('category', null) }] : []),
    ...(methods.length ? [{ key: 'method', label: `${t('cash.col.method')} : ${methods.map((m) => t(`orders.payment.method.${m}`)).join(', ')}`, onRemove: () => list.setFilter('method', null) }] : []),
    ...(by.length ? [{ key: 'createdById', label: `${t('cash.col.by')} : ${by.map((v) => memberOptions.find((m) => m.value === v)?.label ?? '…').join(', ')}`, onRemove: () => list.setFilter('createdById', null) }] : []),
    ...(source ? [{ key: 'source', label: `${t('cash.col.source')} : ${t(`cash.source.${source}`)}`, onRemove: () => list.setFilter('source', null) }] : []),
  ];
  const panelFiltered = chips.length > 0 || s.q.trim().length > 0;
  const clearPanel = () => list.set({ q: '', filters: { direction: null, category: null, method: null, createdById: null, source: null } });

  // closing gap / reopening rows open their day; a correction opens the document of the row it corrects (its
  // reference), else finds that row (same label). The document page's "Retour" comes back here, filters kept.
  const openReference = (r: CashRow) => {
    const ref = r.reference;
    if (!ref) return;
    if (ref.type === 'order') router.push(withBack(`/orders/${ref.id}`, here));
    else if (ref.type === 'sale') router.push(withBack(`/sales/${ref.id}`, here));
    else if (ref.type === 'purchase') router.push(withBack(`/purchases/${ref.id}`, here));
    else if (ref.type === 'closing') list.set({ q: '', filters: { day: ref.label, period: null, from: null, to: null } });
    else if (ref.type === 'cash' && ref.label) list.set({ q: ref.label });
  };
  // the receipt photo of a row ("Justificatif" of the manual / correction dialog), in a new tab
  const openProof = (r: CashRow) => {
    if (r.proofUrl) window.open(r.proofUrl, '_blank', 'noopener');
  };
  const menu = (r: CashRow) =>
    toMenuActions(
      r.actions,
      {
        open_reference: { label: t('cash.action.openReference'), hint: r.reference?.type === 'closing' || r.reference?.type === 'cash' ? undefined : t('gds.hint.page'), onSelect: () => openReference(r), hidden: !r.reference || (r.reference.type === 'cash' && !r.reference.label) },
        view_proof: { label: t('cash.action.viewProof'), hint: t('cash.proof.newTab'), onSelect: () => openProof(r), hidden: !r.proofUrl },
        edit: { label: t('action.edit'), hint: t('gds.hint.dialog'), onSelect: () => setManual({ kind: 'edit', row: r }) },
        duplicate: { label: t('action.duplicate'), onSelect: () => setManual({ kind: 'duplicate', row: r }) },
        correct: { label: t('cash.action.correct'), hint: t('gds.hint.dialog'), onSelect: () => setManual({ kind: 'correct', row: r }) },
        delete: { label: t('action.delete'), separated: true, destructive: true, onSelect: () => setDel(r) },
      },
      t,
    );

  const exportCash = async () => {
    setExporting(true);
    try {
      const { jobId } = await gdsApi.exportCash({ ...shared, format: 'xlsx' });
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (job) => t('toast.export.progress', { entity: t('cash.export.entity'), pct: job.progress, rows: formatNumber(job.total ?? 0) }),
        done: (job) => ({ message: t('toast.export.done', { file: t('cash.export.file') }), action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined }),
        failed: (job, error) => (job?.error?.message ? `${job.error.message} (${job.error.code})` : errorMessage(error, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<CashRow>[] = [
    {
      key: 'time',
      header: multiDay ? t('common.date') : t('cash.col.time'),
      sortKey: 'date',
      hideable: false,
      className: 'whitespace-nowrap',
      cell: (r) => <Ltr className="tabular-nums">{multiDay ? withoutYear(formatDateTime(r.date, locale)) : formatDateTime(r.date, locale).slice(-5)}</Ltr>,
    },
    {
      key: 'label',
      header: t('cash.col.label'),
      className: 'max-w-[320px]',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate" title={r.description ?? undefined}>
            {r.description ?? r.reference?.label ?? '—'}
          </span>
          {r.proofUrl ? (
            <button type="button" className="shrink-0 text-text-muted hover:text-text-primary" onClick={(e) => {
                e.stopPropagation();
                openProof(r);
              }} aria-label={t('cash.action.viewProof')} title={t('cash.action.viewProof')} data-testid="cash-proof">
              <Paperclip className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </span>
      ),
    },
    { key: 'type', header: t('cash.col.type'), cell: (r) => <CashCategoryPill category={r.category} /> },
    { key: 'method', header: t('cash.col.method'), hideBelow: 'lg', cell: (r) => t(`orders.payment.method.${r.method}`) },
    { key: 'amount', header: t('cash.col.amount'), align: 'end', cell: (r) => <SignedAmount value={r.type === 'income' ? r.amount : -r.amount} formatted={formatNumber(r.amount)} /> },
    { key: 'balance', header: t('cash.col.balance'), align: 'end', hideBelow: 'lg', cell: (r) => <Ltr className="tabular-nums text-text-secondary">{formatNumber(r.balanceAfter)}</Ltr> },
    { key: 'by', header: t('cash.col.by'), hideBelow: 'xl', cell: (r) => shortName(r.createdBy) ?? <span className="text-text-secondary">{t('cash.system')}</span> },
    {
      key: 'source',
      header: t('cash.col.source'),
      cell: (r) => <SourceBadge automatic={r.isAutomatic} autoLabel={t('cash.source.auto')} manualLabel={t('cash.source.manual')} reason={r.lockReason ? `${t(`error.${r.lockReason}`, { date: day(algiersDay(r.date)) })} (${r.lockReason})` : undefined} />,
    },
  ];

  const since = q.dataUpdatedAt ? withoutYear(formatDateTime(new Date(q.dataUpdatedAt).toISOString(), locale)) : '—';
  const writeBlocked = !canWrite ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  const closeTheoretical = k?.day?.theoreticalCash ?? dayRow?.theoreticalCash ?? 0;
  return (
    <AppPage
      wide
      title={t('nav.cash')}
      description={t('cash.subtitle')}
      permission="gds.read"
      actions={
        <>
          <Button variant="ghost" onClick={() => void exportCash()} loading={exporting} disabledReason={total === 0 ? t('cash.export.none') : undefined}>
            {t('action.export')}
          </Button>
          <Button
            onClick={() => oneDay && setClosing(oneDay)}
            disabledReason={writeBlocked ?? (!oneDay ? t('cash.close.pickDay') : closed ? `${t('error.CASH_DAY_CLOSED', { date: day(oneDay) })} (CASH_DAY_CLOSED)` : closeAction.present && !closeAction.enabled ? closeAction.reason : undefined)}
            data-testid="cash-close"
          >
            {t('cash.close.action')}
          </Button>
          <Button variant="primary" onClick={() => setManual({ kind: 'new' })} disabledReason={writeBlocked} data-testid="cash-new">
            {t('cash.manual.new')}
          </Button>
        </>
      }
    >
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('cash.kpi.label')} data-testid="cash-kpis">
        {k ? (
          <>
            <KpiTile value={formatNumber(k.currentBalance)} label={t('cash.kpi.current')} meta={t('cash.kpi.opening', { day: day(k.from), amount: formatMoney(k.openingBalance) })} data-kpi="current" />
            <KpiTile value={`+${formatNumber(k.income)}`} label={sel.kind === 'day' && sel.day === today ? t('cash.kpi.incomeToday') : t('cash.kpi.income')} meta={t('cash.kpi.incomeMeta', { sales: k.counts.sales, cod: k.counts.cod })} data-kpi="income" />
            <KpiTile value={`−${formatNumber(k.expense)}`} label={t('cash.kpi.expense')} meta={t('cash.kpi.expenseMeta', { purchases: k.counts.purchases, fees: k.counts.fees })} data-kpi="expense" />
            <button type="button" className="text-start" disabled={!k.unclosedDays.length} onClick={() => k.unclosedDays[0] && list.set({ filters: { day: k.unclosedDays[0], period: null, from: null, to: null } })}>
              <KpiTile
                value={formatNumber(k.unclosedDays.length)}
                label={t('cash.kpi.unclosed')}
                meta={k.unclosedDays.length ? t('cash.kpi.unclosedMeta', { days: daysList(k.unclosedDays, (d) => day(d).split(' ').slice(1).join(' ')) }) : t('cash.kpi.allClosed')}
                tone={k.unclosedDays.length ? 'warning' : undefined}
                data-kpi="unclosed"
              />
            </button>
          </>
        ) : stats.isError ? null : (
          <KpiSkeleton />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('cash.search')} clearLabel={t('list.clearSearch')} className="min-w-56 flex-1 sm:max-w-72" />
        <FilterDropdown label={direction ? `${t('cash.filter.direction')} : ${t(`cash.direction.${direction}`)}` : t('cash.filter.directionAll')}>
          <FilterChips
            label={t('cash.filter.direction')}
            allLabel={t('common.allM')}
            options={[
              { value: 'income', label: t('cash.direction.income') },
              { value: 'expense', label: t('cash.direction.expense') },
            ]}
            value={direction ? [direction] : []}
            onChange={(v) => list.setFilter('direction', v[0] ?? null)}
          />
        </FilterDropdown>
        <FilterDropdown label={t('cash.col.type')} count={categories.length + (source ? 1 : 0)}>
          <div className="flex flex-col gap-3">
            <FilterChips label={t('cash.col.type')} multiple options={CASH_CATEGORIES.map((c) => ({ value: c, label: t(`enum.Cash.category.${c}`) }))} value={categories} onChange={(v) => list.setFilter('category', v)} />
            <FilterChips
              label={t('cash.col.source')}
              allLabel={t('common.allM')}
              options={[
                { value: 'auto', label: t('cash.source.autoLong') },
                { value: 'manual', label: t('cash.source.manual') },
              ]}
              value={source ? [source] : []}
              onChange={(v) => list.setFilter('source', v[0] ?? null)}
            />
          </div>
        </FilterDropdown>
        <FilterDropdown label={t('cash.col.method')} count={methods.length}>
          <FilterChips label={t('cash.col.method')} multiple options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`orders.payment.method.${m}`) }))} value={methods} onChange={(v) => list.setFilter('method', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('cash.col.by')} count={by.length}>
          <FilterChips label={t('cash.col.by')} multiple options={memberOptions} value={by} onChange={(v) => list.setFilter('createdById', v)} />
        </FilterDropdown>
        <FilterDropdown label={sel.kind === 'day' ? t('cash.filter.day', { day: selLabel }) : t('common.period', { label: selLabel })} align="end">
          <div className="flex flex-col gap-3" data-testid="cash-period">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('gds.period.label')}>
              {[
                { key: 'today', label: t('gds.period.today'), on: sel.kind === 'day' && sel.day === today, set: { day: null, period: null, from: null, to: null } },
                { key: 'yesterday', label: t('common.yesterday'), on: sel.kind === 'day' && sel.day === addDays(today, -1), set: { day: addDays(today, -1), period: null, from: null, to: null } },
                ...CASH_PERIODS.map((p) => ({ key: p, label: t(`gds.period.${p}`), on: sel.kind === 'period' && sel.period === p, set: { day: null, period: p, from: null, to: null } })),
              ].map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={o.on} data-period={o.key} onClick={() => list.setFilters(o.set)} className={cn('h-7 rounded-[6px] border px-2.5 text-[12px]', o.on ? 'border-white bg-white text-black' : 'border-line-edge text-text-secondary hover:text-text-primary')}>
                  {o.label}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-[12px] text-text-muted">
              {t('cash.filter.oneDay')}
              <input type="date" value={sel.kind === 'day' ? sel.day : ''} max={today} onChange={(e) => list.setFilters({ day: e.target.value || null, period: null, from: null, to: null })} className="h-9 rounded-[6px] border border-line-edge bg-ink-surface px-2 text-[13px] text-text-primary [color-scheme:dark]" aria-label={t('cash.filter.oneDay')} />
            </label>
            <FilterDateRange from={sel.kind === 'range' ? sel.from : ''} to={sel.kind === 'range' ? sel.to : ''} onChange={(r) => list.setFilters({ from: r.from || null, to: r.to || null, day: null, period: null })} labels={{ from: t('common.from'), to: t('common.to'), presets: t('gds.period.custom') }} />
          </div>
        </FilterDropdown>
        {total !== null ? (
          <span className="ms-auto ts-label-meta text-text-muted" data-testid="cash-count">
            {t('cash.count', { count: total, period: selLabel })}
          </span>
        ) : null}
      </div>
      <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? clearPanel : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />

      {oneDay && closed ? (
        <Banner
          tone="success"
          action={reopenAction.present ? { label: t('cash.reopen.action'), onClick: () => setReopen(oneDay), disabled: !reopenAction.enabled || offline } : undefined}
        >
          <span data-testid="cash-day-closed">
            {dayRow?.closing
              ? t('cash.closedBanner', { day: day(oneDay), name: shortName(dayRow.closing.closedBy) ?? '—', gap: `${dayRow.closing.difference > 0 ? '+' : dayRow.closing.difference < 0 ? '−' : ''}${formatMoney(Math.abs(dayRow.closing.difference))}` })
              : t('cash.closedBannerShort', { day: day(oneDay) })}
          </span>
        </Banner>
      ) : null}

      {q.isPending ? (
        <Card>
          <ListLoading rows={6} columns={8} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        panelFiltered ? (
          <ListFilteredEmpty entity={t('cash.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={clearPanel} />
        ) : (
          <ListEmpty title={t('cash.empty.title', { period: selLabel })} description={t('cash.empty.description')} action={canWrite && !offline && !closed ? { label: t('cash.manual.new'), onClick: () => setManual({ kind: 'new' }) } : undefined} />
        )
      ) : (
        <DataTable<CashRow>
          label={t('nav.cash')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          onRowClick={(r) => (r.isAutomatic ? openReference(r) : actionState(r.actions, 'edit', t).enabled ? setManual({ kind: 'edit', row: r }) : undefined)}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={`${r.description ?? r.reference?.label ?? ''}`} actions={menu(r)} iconOnly />}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{r.description ?? r.reference?.label ?? '—'}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <CashCategoryPill category={r.category} />
                  <SourceBadge automatic={r.isAutomatic} autoLabel={t('cash.source.auto')} manualLabel={t('cash.source.manual')} />
                </div>
              </div>
              <SignedAmount value={r.type === 'income' ? r.amount : -r.amount} formatted={formatNumber(r.amount)} />
              <ActionsMenu label={t('action.actions')} actions={menu(r)} iconOnly />
            </div>
          )}
          footer={
            <ListPagination
              page={s.page}
              pageSize={s.pageSize}
              total={total ?? rows.length}
              onChange={(p) => list.set(p)}
              note={q.data?.openingBalance !== null && q.data?.openingBalance !== undefined ? t('cash.openingFooter', { amount: formatMoney(q.data.openingBalance) }) : undefined}
            />
          }
        />
      )}
      <p className="ts-label-micro !normal-case text-text-muted">{t('cash.footnote')}</p>

      <ManualEntryDialog mode={manual} onClose={() => setManual(null)} defaultDay={oneDay ?? today} />
      <CloseDayDialog day={closing} theoretical={closeTheoretical} onClose={() => setClosing(null)} />
      <ReopenDayDialog day={reopen} onClose={() => setReopen(null)} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={t('cash.delete.title')}
        description={del ? t('cash.delete.description', { label: del.description ?? '', amount: formatMoney(del.amount) }) : undefined}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        destructive
        closeLabel={t('action.close')}
        onConfirm={() =>
          void (async () => {
            if (!del) return;
            try {
              await gdsApi.deleteCash(del.id);
              await refresh();
              toast(t('cash.deleted'));
            } catch (e) {
              toast({ tone: 'danger', message: refusal(e, t) });
            } finally {
              setDel(null);
            }
          })()
        }
      />
    </AppPage>
  );
}

function pick(o: ApiQuery, keys: readonly string[]): ApiQuery {
  return Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
}
