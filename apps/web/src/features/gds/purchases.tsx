'use client';
// /purchases — Figma "GDS-07 — Purchases — list + receive dialog" (03 GDS-06, 12 §12 / §21). KPIs following the
// filters (`GET /purchases/stats`), search + Statut / Fournisseur / Paiement / Période chips (URL), status and payment
// pills, "PRÉVU LE" with ✓ / (retard), the cancel reason, `Actions ⌄` from the server descriptors (receive, pay,
// duplicate, print, cancel, delete) and the receive dialog.
import { formatDate, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import { ActionsMenu, ActiveFilters, Button, buttonClass, Card, cn, DataTable, FilterCheckList, FilterChips, FilterDropdown, FilterToggle, KpiTile, Ltr, SearchInput, type Column } from '@djaber/ui';
import { useMemo } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterBool, filterList, filterText, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { usePurchases, usePurchaseStats, useSuppliers } from './api';
import { supplierLabel } from './suppliers';
import { GDS_PAYMENT_STATUSES, PURCHASE_STATUSES, type PurchaseRow } from './contracts';
import { usePurchaseActions } from './purchase-dialogs';
import { ListExportMenu } from './export-menu';
import { AdvancedOnly, KpiSkeleton, PaymentPill, PeriodDropdown, PurchaseStatusPill, useDayLabel } from './ui';

export const PURCHASES_SPEC: ListSpec = {
  filters: { status: 'list', supplierId: 'list', paymentStatus: 'list', late: 'bool', productId: 'text', period: 'text', from: 'date', to: 'date' },
  sorts: ['purchasedAt', 'expectedAt', 'total', 'number', 'createdAt'],
  defaultSort: '-purchasedAt',
};

export function PurchasesPage() {
  const t = useT();
  return (
    <AdvancedOnly title={t('nav.purchases')}>
      <PurchasesList />
    </AdvancedOnly>
  );
}

function PurchasesList() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const list = useListState(PURCHASES_SPEC);
  const s = list.state;
  const q = usePurchases(list.apiQuery());
  const stats = usePurchaseStats(list.filterQuery());
  const suppliers = useSuppliers({ pageSize: 100, sort: 'name' });
  const offline = useOffline();
  const actions = usePurchaseActions();
  const day = useDayLabel();
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? null;
  const k = stats.data;
  const canWrite = can('gds.write');

  const statuses = filterList(s, 'status');
  const supplierIds = filterList(s, 'supplierId');
  const payments = filterList(s, 'paymentStatus');
  const supplierName = (id: string) => suppliers.data?.rows.find((x) => x.id === id)?.name ?? '…';
  const chips = [
    ...(statuses.length ? [{ key: 'status', label: `${t('common.status')} : ${statuses.map((v) => t(`enum.Purchase.status.${v}`)).join(', ')}`, onRemove: () => list.setFilter('status', null) }] : []),
    ...(supplierIds.length ? [{ key: 'supplierId', label: `${t('purchases.filter.supplier')} : ${supplierIds.map(supplierName).join(', ')}`, onRemove: () => list.setFilter('supplierId', null) }] : []),
    ...(payments.length ? [{ key: 'paymentStatus', label: `${t('purchases.filter.payment')} : ${payments.map((v) => t(`enum.Purchase.paymentStatus.${v}`)).join(', ')}`, onRemove: () => list.setFilter('paymentStatus', null) }] : []),
    ...(filterBool(s, 'late') ? [{ key: 'late', label: t('purchases.filter.late'), onRemove: () => list.setFilter('late', null) }] : []),
    ...(filterText(s, 'productId') ? [{ key: 'productId', label: t('purchases.filter.product'), onRemove: () => list.setFilter('productId', null) }] : []),
  ];

  const expected = (r: PurchaseRow) => {
    if (!r.expectedAt) return <span className="text-text-muted">—</span>;
    const d = day(r.expectedAt.slice(0, 10));
    if (r.status === 'received') return <span>{`${r.receivedAt ? day(r.receivedAt.slice(0, 10)) : d} ✓`}</span>;
    if (r.late) return <span className="text-accent-alert">{`${d} ${t('purchases.late')}`}</span>;
    return <span>{d}</span>;
  };
  const columns: Column<PurchaseRow>[] = [
    { key: 'number', header: t('purchases.col.number'), sortKey: 'number', hideable: false, cell: (r) => <Ltr className="whitespace-nowrap font-medium">{`#${r.number}`}</Ltr> },
    { key: 'supplier', header: t('purchases.col.supplier'), cell: (r) => r.supplier?.name ?? <span className="text-text-muted">—</span> },
    { key: 'items', header: t('purchases.col.items'), hideBelow: 'lg', cell: (r) => <Ltr className="whitespace-nowrap tabular-nums">{`${formatNumber(r.itemCount)} · ${t('gds.units', { count: r.units.ordered })}`}</Ltr> },
    { key: 'total', header: t('purchases.col.total'), sortKey: 'total', align: 'end', cell: (r) => <Ltr className="whitespace-nowrap tabular-nums">{formatMoney(r.total)}</Ltr> },
    { key: 'paid', header: t('purchases.col.paid'), align: 'end', hideBelow: 'lg', cell: (r) => (r.status === 'draft' && r.amountPaid === 0 ? <span className="text-text-muted">—</span> : <Ltr className="whitespace-nowrap tabular-nums">{formatMoney(r.amountPaid)}</Ltr>) },
    {
      key: 'status',
      header: t('common.status'),
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <PurchaseStatusPill status={r.status} units={r.units} />
          {r.status !== 'cancelled' && r.status !== 'draft' && r.paymentStatus !== 'paid' ? <PaymentPill status={r.paymentStatus} /> : null}
        </div>
      ),
    },
    { key: 'expected', header: t('purchases.col.expected'), sortKey: 'expectedAt', hideBelow: 'xl', cell: expected },
  ];

  const since = q.dataUpdatedAt ? formatDate(new Date(q.dataUpdatedAt), locale) : '—';
  return (
    <AppPage
      wide
      title={t('nav.purchases')}
      description={t('purchases.subtitle')}
      permission="gds.read"
      actions={
        <>
          <ListExportMenu path="/purchases/export" filters={list.filterQuery()} entity={t('purchases.export.entity')} file={t('purchases.export.file')} disabledReason={offline ? t('banner.offline') : undefined} />
          {canWrite ? (
            offline ? (
              <Button variant="primary" disabled disabledReason={t('banner.offline')} data-testid="purchase-new">
                {t('purchases.new')}
              </Button>
            ) : (
              <Link href="/purchases/new" className={buttonClass({ variant: 'primary' })} data-testid="purchase-new">
                {t('purchases.new')}
              </Link>
            )
          ) : null}
        </>
      }
    >
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('purchases.kpi.label')} data-testid="purchase-kpis">
        {k ? (
          <>
            <button type="button" className="text-start" onClick={() => list.setFilter('late', !filterBool(s, 'late'))} aria-pressed={filterBool(s, 'late')}>
              <KpiTile value={formatNumber(k.pendingReceipt)} label={t('purchases.kpi.pending')} meta={t('purchases.kpi.late', { count: k.late })} tone={k.late ? 'warning' : undefined} data-kpi="pending" />
            </button>
            <KpiTile value={formatNumber(k.dueToSuppliers)} label={t('purchases.kpi.due')} meta={t('purchases.kpi.suppliers', { count: k.suppliersWithBalance })} data-kpi="due" />
            <KpiTile
              value={formatNumber(k.purchased)}
              label={t('purchases.kpi.purchased')}
              meta={k.purchasedDeltaPct === null ? t('purchases.kpi.noPrevious') : t('purchases.kpi.delta', { pct: `${k.purchasedDeltaPct > 0 ? '+' : ''}${k.purchasedDeltaPct}` })}
              data-kpi="purchased"
            />
            <button type="button" className="text-start" onClick={() => list.setFilter('status', statuses.length === 1 && statuses[0] === 'draft' ? null : ['draft'])}>
              <KpiTile value={formatNumber(k.drafts)} label={t('purchases.kpi.drafts')} meta={t('purchases.kpi.draftsMeta')} data-kpi="drafts" />
            </button>
          </>
        ) : stats.isError ? null : (
          <KpiSkeleton />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('purchases.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-80" />
        <FilterDropdown label={t('purchases.filter.status')} count={statuses.length}>
          <FilterChips label={t('purchases.filter.status')} multiple options={PURCHASE_STATUSES.map((v) => ({ value: v, label: t(`enum.Purchase.status.${v}`) }))} value={statuses} onChange={(v) => list.setFilter('status', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('purchases.filter.supplier')} count={supplierIds.length}>
          <FilterCheckList options={(suppliers.data?.rows ?? []).map((x) => ({ value: x.id, label: supplierLabel(x) }))} value={supplierIds} onChange={(v) => list.setFilter('supplierId', v)} searchPlaceholder={t('purchases.filter.supplierSearch')} emptyLabel={t('suppliers.empty.title')} />
        </FilterDropdown>
        <FilterDropdown label={t('purchases.filter.payment')} count={payments.length}>
          <FilterChips label={t('purchases.filter.payment')} multiple options={GDS_PAYMENT_STATUSES.map((v) => ({ value: v, label: t(`enum.Purchase.paymentStatus.${v}`) }))} value={payments} onChange={(v) => list.setFilter('paymentStatus', v)} />
        </FilterDropdown>
        <PeriodDropdown list={list} />
        <FilterToggle pressed={filterBool(s, 'late')} onPressedChange={(v) => list.setFilter('late', v)} tone="warning">
          {t('purchases.filter.late')}
        </FilterToggle>
        {total !== null ? (
          <span className="ms-auto ts-label-meta text-text-muted" data-testid="purchases-count">
            {t('purchases.count', { count: total })}
          </span>
        ) : null}
      </div>
      <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? list.clear : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />

      {q.isPending ? (
        <Card>
          <ListLoading rows={5} columns={7} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        list.filtered ? (
          <ListFilteredEmpty entity={t('purchases.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={list.clear} />
        ) : (
          <ListEmpty title={t('purchases.empty.title')} description={t('purchases.empty.description')} action={canWrite && !offline ? { label: t('purchases.new'), onClick: () => router.push('/purchases/new') } : undefined} />
        )
      ) : (
        <DataTable<PurchaseRow>
          label={t('nav.purchases')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          onRowClick={(r) => router.push(`/purchases/${r.id}`)}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={`#${r.number} · ${t(`enum.Purchase.status.${r.status}`)}`} actions={actions.menu(r)} />}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/purchases/${r.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Ltr className="text-[14px] font-medium">{`#${r.number}`}</Ltr>
                  <span className="truncate text-[13px]">{r.supplier?.name ?? '—'}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <PurchaseStatusPill status={r.status} units={r.units} />
                  <Ltr className="ts-label-micro text-text-muted">{formatMoney(r.total)}</Ltr>
                </div>
              </Link>
              <ActionsMenu label={t('action.actions')} actions={actions.menu(r)} />
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total ?? rows.length} onChange={(p) => list.set(p)} note={t('purchases.menuNote')} />}
        />
      )}
      {actions.element}
    </AppPage>
  );
}
