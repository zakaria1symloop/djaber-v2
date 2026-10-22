'use client';
// /orders — Figma "ORD-05 v2 — Orders — list (dense rows, source column, actions dropdown)", "ORD-05 v2 — … AR (RTL)",
// "ORD-05 — Orders — filter panel open", "ORD-05 — Orders — row actions menu + bulk results dialog",
// "GLOBAL — Offline — stale data (Orders)". L6 list: KPI strip following the filters (`GET /orders/stats`), status tabs
// = the status filter (with counts), search, quick filters, filter panel, sort, density, columns, pagination 25/50/100,
// selection + bulk bar with per-item results, row `Actions ⌄` from the server descriptors — all of it in the URL.
import { formatDate, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Button, buttonClass, Card, cn, DataTable, KpiTile, KpiTileSkeleton, Ltr, OrderNumber, TableViewMenu, type Column } from '@djaber/ui';
import { ShoppingBag } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination, Money } from '@/features/catalog/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { compactAmount } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useOrders, useOrderStats } from '../api';
import type { OrderListItem } from '../contracts';
import { algiersDay, algiersTime, itemsSummary, sourceSplit } from '../logic';
import { useOffline } from '../offline';
import { ClientCell, ConfirmationPill, DeliveryPill, OrderStatusPill, RiskPill, SourceCell } from '../ui';
import { useOrderActions } from '../use-order-actions';
import { ExportOrdersDialog, OrdersBulkBar } from './bulk';
import { OrdersActiveFilters, OrdersFilterBar, OrdersFilterPanel } from './filters';
import { ORDER_TABS, ORDERS_LIST, ordersQuery, tabCountsQuery } from './spec';

/** "10:58" today, "hier · 10:58" yesterday, "05 oct. · 10:58" before — always with the time (Africa/Algiers; PV 22/10). */
function useOrderedAt() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  return (iso: string) => {
    const now = new Date();
    const day = algiersDay(new Date(iso));
    const time = algiersTime(iso);
    if (day === algiersDay(now)) return time;
    if (day === algiersDay(new Date(now.getTime() - 86_400_000))) return `${t('common.yesterday').toLowerCase()} · ${time}`;
    const date = formatDate(iso, locale);
    // the year only when it is not the current one
    return `${day.slice(0, 4) === algiersDay(now).slice(0, 4) ? date.replace(/ \d{4}$/, '') : date} · ${time}`;
  };
}

export function OrdersList() {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const { can } = useSession();
  const canWrite = can('orders.write');
  const list = useListState(ORDERS_LIST);
  const s = list.state;
  const query = useMemo(() => ordersQuery(list.apiQuery(), s.tab), [list, s.tab]);
  const filters = useMemo(() => ordersQuery(list.filterQuery(), s.tab), [list, s.tab]);
  const orders = useOrders(query);
  const stats = useOrderStats(filters);
  const tabStats = useOrderStats(tabCountsQuery(filters));
  const offline = useOffline();
  const actions = useOrderActions();
  const orderedAt = useOrderedAt();

  const [panel, setPanel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => orders.data?.rows ?? [], [orders.data]);
  const total = orders.data?.total ?? 0;
  // a selection never outlives the page of rows it was made on
  const view = JSON.stringify(query);
  useEffect(() => setSelected(new Set()), [view]);

  const menu = (row: OrderListItem) => (
    <ActionsMenu label={t('action.actions')} heading={[`#${row.number}`, t(`enum.Order.status.${row.status}`), t(`enum.Order.source.${row.source.source}`).replace(/^\S+\s/, '')].join(' · ')} actions={actions.menu(row)} />
  );

  const columns: Column<OrderListItem>[] = [
    {
      key: 'number',
      header: t('orders.col.number'),
      sortKey: 'orderedAt',
      hideable: false,
      cell: (r) => (
        <div className="whitespace-nowrap">
          <OrderNumber number={r.number} className="text-[14px] font-medium" />
          <div className="ts-label-micro text-text-muted">{orderedAt(r.orderedAt)}</div>
        </div>
      ),
    },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', hideable: false, className: 'max-w-[220px]', cell: (r) => <ClientCell client={r.client} onOpen={can('clients.read') ? () => router.push(`/clients?sheet=${r.client.id}`) : undefined} /> },
    { key: 'source', header: t('common.source'), hideBelow: 'lg', className: 'max-w-[160px]', cell: (r) => <SourceCell source={r.source} /> },
    {
      key: 'items',
      header: t('common.items'),
      hideBelow: 'xl',
      className: 'max-w-[200px]',
      cell: (r) => {
        const it = itemsSummary(r.items, r.itemCount);
        return (
          <div className="min-w-0">
            <div className="truncate text-[13px]">{it.first || '—'}</div>
            {it.more ? <div className="ts-label-micro text-text-muted">{t('common.itemsMore', { count: it.more })}</div> : null}
          </div>
        );
      },
    },
    {
      key: 'total',
      header: t('common.total'),
      sortKey: 'total',
      align: 'end',
      cell: (r) => (
        <div className="whitespace-nowrap">
          <Money value={r.total} className="ts-numeral-m" />
          {r.amountPaid > 0 && r.remaining > 0 ? <div className="ts-label-micro text-accent-starred">{t('orders.list.remaining', { amount: formatMoney(r.remaining) })}</div> : null}
        </div>
      ),
    },
    { key: 'status', header: t('common.status'), sortKey: 'status', cell: (r) => <OrderStatusPill status={r.status} /> },
    { key: 'confirmation', header: t('orders.col.confirmation'), cell: (r) => <ConfirmationPill row={r} /> },
    {
      key: 'delivery',
      header: t('orders.col.delivery'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <DeliveryPill row={r} />
          {r.wilaya ? (
            <span className="whitespace-nowrap ts-label-micro !normal-case text-text-secondary" data-wilaya={r.wilaya.id}>
              <Ltr>{String(r.wilaya.id).padStart(2, '0')}</Ltr> {r.wilaya.name}
              {r.isStopdesk ? ` · ${t('common.stopdesk')}` : ''}
            </span>
          ) : null}
        </div>
      ),
    },
    { key: 'risk', header: t('common.risk'), hideBelow: 'xl', cell: (r) => <RiskPill client={r.client} risk={r.riskLevel} /> },
  ];
  // inside a status tab the status column repeats the tab: it gives its place
  const hidden = s.tab ? [...s.hide, 'status'] : s.hide;

  const st = stats.data;
  const split = st ? sourceSplit(st) : null;
  const summary = st ? t('orders.list.summary', { count: formatNumber(st.total), ai: formatNumber(st.sourceMix.ai), toConfirm: formatNumber(st.toConfirm) }) : orders.data ? t('orders.list.count', { count: total }) : undefined;
  const counts = tabStats.data?.byStatus;
  const tabCount = (k: string | null) => (counts ? (k ? (counts as Record<string, number>)[k] : tabStats.data!.total) : undefined);
  const empty = orders.data && rows.length === 0;
  const neverAny = empty && !list.filtered;
  const since = orders.dataUpdatedAt ? `${formatDate(new Date(orders.dataUpdatedAt), locale as AppLocale)} ${algiersTime(new Date(orders.dataUpdatedAt))}` : '—';

  return (
    <AppPage
      wide
      title={t('nav.orders')}
      description={summary}
      permission="orders.read"
      actions={
        <>
          {can('orders.money') ? (
            <Button variant="ghost" onClick={() => setExporting(true)} disabledReason={offline ? t('banner.offline') : undefined}>
              {t('action.export')}
            </Button>
          ) : null}
          {can('orders.import') ? (
            <Link href="/orders/import" className={buttonClass({ variant: 'ghost' })}>
              {t('action.import')}
            </Link>
          ) : null}
          {canWrite ? (
            <Link href="/orders/new" className={buttonClass({ variant: 'primary' })} data-testid="new-order">
              {t('action.newOrder')}
            </Link>
          ) : null}
        </>
      }
    >
      {offline ? <OfflineBanner since={since} onRetry={() => void orders.refetch()} /> : null}

      <section aria-label={t('orders.kpi.label')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="orders-kpis">
        {st ? (
          <>
            <KpiTile value={formatNumber(st.toConfirm)} label={t('orders.kpi.toConfirm')} meta={t('orders.kpi.uncalled', { count: st.uncalledOver2h })} tone={st.uncalledOver2h ? 'warning' : undefined} data-kpi="toConfirm" />
            <KpiTile value={formatNumber(st.confirmedNotSent)} label={t('orders.kpi.toShip')} meta={t('orders.kpi.confirmedNotSent')} data-kpi="toShip" />
            <KpiTile value={formatNumber(st.inTransit)} label={t('orders.kpi.inTransit')} meta={t('orders.kpi.stale', { count: st.staleOver5d })} tone={st.staleOver5d ? 'warning' : undefined} data-kpi="inTransit" />
            <KpiTile value={`${st.deliveredPct30d} %`} label={t('orders.kpi.delivered')} meta={t('orders.kpi.returns', { count: st.returns })} data-kpi="delivered" />
            <KpiTile value={st.revenue30d < 1_000_000 ? formatNumber(st.revenue30d) : compactAmount(st.revenue30d, locale)} label={t('orders.kpi.revenue')} meta={split ? t('orders.kpi.split', { ai: split.aiPct, manual: split.manualPct }) : undefined} data-kpi="revenue" />
          </>
        ) : stats.isError ? null : (
          Array.from({ length: 5 }).map((_, i) => <KpiTileSkeleton key={i} />)
        )}
      </section>

      <nav aria-label={t('orders.tab.label')} className="flex gap-1.5 overflow-x-auto">
        {ORDER_TABS.map((k) => {
          const on = (s.tab ?? null) === k;
          const n = tabCount(k);
          return (
            <button
              key={k ?? 'all'}
              type="button"
              aria-current={on ? 'page' : undefined}
              data-tab={k ?? 'all'}
              onClick={() => list.set({ tab: k })}
              className={cn('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-card border px-3 text-[13px]', on ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary')}
            >
              {k ? t(`orders.tab.${k}`) : t('orders.tab.all')}
              {n !== undefined ? <Ltr className="tabular-nums">{formatNumber(n)}</Ltr> : null}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <OrdersFilterBar list={list} onOpenPanel={() => setPanel(true)} />
        </div>
        <TableViewMenu
          label={t('list.view')}
          density={list.density}
          onDensityChange={(d) => list.set({ density: d })}
          densityLabel={t('common.density')}
          densityOptions={{ comfortable: t('list.density.comfortable'), compact: t('list.density.compact') }}
          columns={columns.filter((c) => c.hideable !== false).map((c) => ({ key: c.key, label: c.header }))}
          hidden={s.hide}
          onHiddenChange={(hide) => list.set({ hide })}
          columnsLabel={t('common.columns')}
        />
      </div>
      <OrdersActiveFilters list={list} />

      {selected.size > 0 ? (
        <OrdersBulkBar rows={rows} selected={selected} total={total} offline={offline} onSelectAllPage={() => setSelected(new Set(rows.map((r) => r.id)))} onClear={() => setSelected(new Set())} onExport={() => setExporting(true)} />
      ) : null}

      {orders.isPending ? (
        <Card>
          <ListLoading rows={5} columns={7} />
        </Card>
      ) : orders.isError && !orders.data ? (
        <QueryError error={orders.error} onRetry={() => orders.refetch()} />
      ) : neverAny ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="orders-empty">
          <ShoppingBag className="size-5 text-text-secondary" aria-hidden />
          <h2 className="ts-title">{t('state.list.empty.orders.title')}</h2>
          <p className="ts-label-meta max-w-md text-text-muted">{t('state.list.empty.orders.description')}</p>
          {canWrite ? (
            <Link href="/orders/new" className={buttonClass({ variant: 'primary' })}>
              {t('action.newOrder')}
            </Link>
          ) : null}
        </Card>
      ) : empty ? (
        <ListFilteredEmpty entity={t('orders.entity')} filters={t('orders.list.currentFilters')} onClear={list.clear} />
      ) : (
        <DataTable<OrderListItem>
          label={t('nav.orders')}
          className={cn(orders.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          selection={canWrite ? { selected, onChange: setSelected, allLabel: t('list.selectAll'), rowLabel: (r) => t('list.selectRow', { name: `#${r.number}` }) } : undefined}
          density={list.density}
          hiddenColumns={hidden}
          onRowClick={(r) => router.push(`/orders/${r.id}`)}
          actionsLabel={t('action.actions')}
          rowActions={menu}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/orders/${r.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <OrderNumber number={r.number} className="text-[14px] font-medium" />
                  <span className="truncate text-[13px]">{r.client.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Money value={r.total} className="ts-label-meta" />
                  <OrderStatusPill status={r.status} />
                  <ConfirmationPill row={r} />
                </div>
              </Link>
              {menu(r)}
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total} onChange={(p) => list.set(p)} note={t('orders.list.sortNote', { field: t(`orders.sort.${list.sort.key}`), dir: list.sort.dir === 'asc' ? '↑' : '↓' })} />}
        />
      )}

      <OrdersFilterPanel open={panel} onClose={() => setPanel(false)} list={list} total={orders.data ? total : null} />
      <ExportOrdersDialog
        open={exporting}
        onClose={() => setExporting(false)}
        filters={filters}
        filterLabel={list.filtered ? t('orders.export.current') : t('orders.export.none')}
        selection={[...selected]}
        counts={{ filter: orders.data ? total : null, all: tabStats.data && !list.filtered ? tabStats.data.total : null }}
      />
      {actions.element}
    </AppPage>
  );
}
