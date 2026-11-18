'use client';
// /clients — Figma "CLI-03 — Clients — list with detail sheet", "CLI-03 — Clients — filter panel + row menu (model:
// Client)", DLG II (Nouveau client, Supprimer le client, Tags) and DLG (Fusionner les clients).
// L6 list: search (phone fragments normalised), quick filters, filter panel, sort, pagination 25/50/100, density,
// columns, selection + bulk bar, row `Actions ⌄`, detail side sheet `?sheet=<id>` — all of it in the URL (`useListState`).
import { formatMoney, formatNumber } from '@djaber/shared';
import { ActionsMenu, Button, Card, cn, DataTable, Ltr, TableViewMenu, TagChips, type Column } from '@djaber/ui';
import { Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SavedViews } from '@/features/saved-views/saved-views';
import { AppPage } from '@/components/app-page';
import { ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { JobParamBanner } from '@/components/job-param-banner';
import { ListPagination } from '@/features/catalog/ui';
import { clientsApi, useClients, useClientsExport, useClientTags } from '@/features/clients/api';
import { ClientsBulkBar } from '@/features/clients/bulk';
import { ClientSheet } from '@/features/clients/client-sheet';
import type { ClientListItem } from '@/features/clients/contracts';
import { ClientsActiveFilters, ClientsFilterBar, ClientsFilterPanel } from '@/features/clients/filters';
import { CLIENTS_LIST, clientsQuery, tagOptions } from '@/features/clients/spec';
import { ClientAvatar, ClientPillView, ClientSourcePill, Phone, ShortDate } from '@/features/clients/ui';
import { useClientActions } from '@/features/clients/use-client-actions';
import { useT } from '@/lib/i18n';
import { filterList } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';

export default function ClientsPage() {
  const t = useT();
  const { can } = useSession();
  const list = useListState(CLIENTS_LIST);
  const s = list.state;
  const query = useMemo(() => clientsQuery(list.apiQuery()), [list]);
  const clients = useClients(query);
  const exportClients = useClientsExport();
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => clients.data?.rows ?? [], [clients.data]);
  const total = clients.data?.total ?? 0;
  const view = JSON.stringify(query);
  useEffect(() => setSelected(new Set()), [view]);
  const workspaceTags = useClientTags();
  const tags = useMemo(() => tagOptions(rows, filterList(s, 'tags'), (workspaceTags.data ?? []).slice(0, 30).map((w) => w.tag)), [rows, s, workspaceTags.data]);
  const actions = useClientActions({ openSheet: (id) => list.openSheet(id), afterDelete: (id) => (s.sheet === id ? list.openSheet(null) : undefined), knownTags: tags });
  const canSelect = can('clients.write') || can('clients.delete');

  const menu = (r: ClientListItem) => <ActionsMenu label={t('action.actions')} heading={`${r.name}${r.isPlaceholder ? ` · ${t('clients.menu.incomplete')}` : ''}`} actions={actions.menu(r)} />;
  const columns: Column<ClientListItem>[] = [
    {
      key: 'name',
      header: t('common.client'),
      sortKey: 'name',
      hideable: false,
      className: 'max-w-[260px]',
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <ClientAvatar name={r.name} />
          <span className={cn('truncate text-[14px] font-medium', r.isPlaceholder && 'text-text-secondary')}>{r.name}</span>
        </span>
      ),
    },
    { key: 'phone', header: t('common.phone'), cell: (r) => <Phone value={r.phone} /> },
    { key: 'source', header: t('common.source'), hideBelow: 'lg', cell: (r) => <ClientSourcePill source={r.source} /> },
    { key: 'orders', header: t('clients.col.orders'), align: 'end', cell: (r) => <Ltr className="ts-numeral-m tabular-nums">{formatNumber(r.orderCount)}</Ltr> },
    { key: 'spent', header: t('clients.col.spent'), sortKey: 'totalSpent', align: 'end', cell: (r) => <Ltr className="whitespace-nowrap tabular-nums text-text-secondary">{formatMoney(r.totalSpent)}</Ltr> },
    { key: 'last', header: t('clients.col.last'), sortKey: 'lastOrderAt', cell: (r) => <ShortDate iso={r.lastOrderAt} /> },
    {
      key: 'tags',
      header: t('clients.col.tags'),
      hideBelow: 'lg',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <TagChips tags={r.tags} max={2} />
          {/* full-test CLIENTS-16: the same pills as the phone cards and the sheet (FIABLE / INCONNU included) */}
          {r.pill ? <ClientPillView client={r} /> : null}
        </span>
      ),
    },
    { key: 'created', header: t('clients.col.created'), sortKey: 'createdAt', hideBelow: 'xl', cell: (r) => <ShortDate iso={r.createdAt} /> },
  ];
  const hidden = s.hide;
  const sheetIndex = s.sheet ? rows.findIndex((r) => r.id === s.sheet) : -1;
  const empty = clients.data && rows.length === 0;
  const aiCount = clients.data?.meta && typeof (clients.data.meta as { aiThisMonth?: number }).aiThisMonth === 'number' ? (clients.data.meta as { aiThisMonth: number }).aiThisMonth : null;
  const summary = clients.data ? (list.filtered ? t('clients.list.results', { count: total }) : [t('clients.list.count', { count: total }), aiCount !== null ? t('clients.list.aiThisMonth', { count: aiCount }) : null].filter(Boolean).join(' · ')) : undefined;

  return (
    <AppPage
      wide
      title={t('nav.clients')}
      description={summary}
      permission="clients.read"
      actions={
        <>
          {can('clients.delete') ? <Button onClick={() => void exportClients(() => clientsApi.export(clientsQuery(list.filterQuery())))}>{t('action.export')}</Button> : null}
          {can('clients.write') ? (
            <Button variant="primary" onClick={actions.openNew} data-testid="new-client">
              {t('clients.list.add')}
            </Button>
          ) : null}
        </>
      }
    >
      <JobParamBanner />
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <ClientsFilterBar list={list} tags={tags} onOpenPanel={() => setPanel(true)} />
        </div>
        <SavedViews page="clients" list={list} spec={CLIENTS_LIST} columnKeys={columns.map((c) => c.key)} />
        <TableViewMenu
          label={t('list.view')}
          density={list.density}
          onDensityChange={(d) => list.set({ density: d })}
          densityLabel={t('common.density')}
          densityOptions={{ comfortable: t('list.density.comfortable'), compact: t('list.density.compact') }}
          columns={columns.filter((c) => c.hideable !== false).map((c) => ({ key: c.key, label: c.header }))}
          hidden={hidden}
          onHiddenChange={(hide) => list.set({ hide })}
          columnsLabel={t('common.columns')}
        />
      </div>
      <ClientsActiveFilters list={list} />

      {selected.size > 0 ? <ClientsBulkBar rows={rows} selected={selected} total={total} knownTags={tags} onSelectAllPage={() => setSelected(new Set(rows.map((r) => r.id)))} onClear={() => setSelected(new Set())} /> : null}

      {clients.isPending ? (
        <Card>
          <ListLoading rows={5} columns={6} />
        </Card>
      ) : clients.isError ? (
        <QueryError error={clients.error} onRetry={() => clients.refetch()} />
      ) : empty && !list.filtered ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="clients-empty">
          <Users className="size-5 text-text-secondary" aria-hidden />
          <h2 className="ts-title">{t('clients.empty.title')}</h2>
          <p className="ts-label-meta max-w-md text-text-muted">{t('clients.empty.description')}</p>
          {can('clients.write') ? (
            <Button variant="primary" onClick={actions.openNew}>
              {t('clients.list.add')}
            </Button>
          ) : null}
        </Card>
      ) : empty ? (
        <ListFilteredEmpty entity={t('clients.entity')} filters={list.state.q} onClear={list.clear} />
      ) : (
        <DataTable<ClientListItem>
          label={t('nav.clients')}
          className={cn(clients.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          selection={canSelect ? { selected, onChange: setSelected, allLabel: t('list.selectAll'), rowLabel: (r) => t('list.selectRow', { name: r.name }) } : undefined}
          density={list.density}
          hiddenColumns={hidden}
          activeRowKey={s.sheet}
          onRowClick={(r) => list.openSheet(r.id)}
          actionsLabel={t('action.actions')}
          rowActions={menu}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <button type="button" onClick={() => list.openSheet(r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                <ClientAvatar name={r.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-x-2 ts-label-meta text-text-muted">
                    <Phone value={r.phone} />
                    <span>{t('clients.list.ordersShort', { count: r.orderCount })}</span>
                    <ClientPillView client={r} />
                  </span>
                </span>
              </button>
              {menu(r)}
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total} onChange={(p) => list.set(p)} />}
        />
      )}

      <ClientsFilterPanel open={panel} onClose={() => setPanel(false)} list={list} tags={tags} total={clients.data ? total : null} />
      <ClientSheet
        clientId={s.sheet}
        onClose={() => list.openSheet(null)}
        onPrev={sheetIndex > 0 ? () => list.openSheet(rows[sheetIndex - 1]!.id) : undefined}
        onNext={sheetIndex >= 0 && sheetIndex < rows.length - 1 ? () => list.openSheet(rows[sheetIndex + 1]!.id) : undefined}
        position={sheetIndex >= 0 ? `${sheetIndex + 1} / ${rows.length}` : undefined}
        menu={(c) => actions.menu(c, { sheet: true })}
        onEdit={actions.edit}
        canEdit={can('clients.write')}
        canOrder={can('orders.write')}
      />
      {actions.dialogs}
    </AppPage>
  );
}
