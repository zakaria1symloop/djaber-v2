'use client';
// /services — Figma "CAT-11 / GDS-06b — Services list · New purchase form · Purchase & sale detail" (first view only:
// the purchase / sale parts belong to M7). L6 list of `GET /products?type=service` (Product.trackStock = false):
// no stock column, no stock action, sold at the counter and by the AI as an order line.
import { ActionsMenu, buttonClass, DataTable, Ltr, SearchInput, TableViewMenu, type Column } from '@djaber/ui';
import { useMemo } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { Link, useRouter } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import type { ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useProducts } from '../api';
import type { ProductListItem } from '../contracts';
import { useProductActions } from '../product-page/use-product-actions';
import { AiPill, aiExclusion, CategoryPill, ListPagination, Money, ProductStatePill, ProductThumb } from '../ui';

const SPEC: ListSpec = { filters: {}, sorts: ['name', 'price'], defaultSort: 'name' };
const NEW_SERVICE = '/products/new?type=service';

export function ServicesList() {
  const t = useT();
  const router = useRouter();
  const { can } = useSession();
  const canWrite = can('catalog.write');
  const list = useListState(SPEC);
  const q = useProducts(list.apiQuery({ type: ['service'] }));
  const actions = useProductActions();
  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const open = (row: ProductListItem) => router.push(`/products/${row.id}`);

  const name = (row: ProductListItem) => (
    <span className="flex min-w-0 items-center gap-3">
      <ProductThumb src={row.primaryImageUrl} name="" size={36} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{row.name}</span>
          {row.isActive && !row.archived ? null : <ProductStatePill product={row} />}
        </span>
        <span className="block ts-label-meta text-text-muted">
          <Ltr>{row.sku}</Ltr>
        </span>
      </span>
    </span>
  );
  const columns = useMemo<Column<ProductListItem>[]>(
    () => [
      { key: 'name', header: t('services.column.service'), sortKey: 'name', hideable: false, cell: name },
      { key: 'price', header: t('common.price'), sortKey: 'price', cell: (row) => <Money value={row.price} /> },
      { key: 'category', header: t('services.column.category'), hideBelow: 'lg', cell: (row) => <CategoryPill category={row.category} /> },
      { key: 'ai', header: t('services.column.ai'), cell: (row) => <AiPill state={row.aiState} reason={aiExclusion(row)} /> },
    ],
    [t],
  );
  const menu = (row: ProductListItem) => <ActionsMenu label={t('action.actions')} actions={actions.menu(row)} heading={`${row.name} · ${row.sku}`} />;
  const newButton = canWrite ? (
    <Link href={NEW_SERVICE} className={buttonClass({ variant: 'primary' })} data-testid="new-service">
      {t('services.add')}
    </Link>
  ) : null;

  return (
    <AppPage
      wide
      permission="catalog.read"
      eyebrow={t('nav.group.stock')}
      title={t('nav.services')}
      description={q.data ? t('services.summary', { count: total }) : t('services.subtitle')}
      actions={newButton}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={list.state.q} onChange={(v) => list.set({ q: v })} placeholder={t('services.search')} label={t('action.search')} clearLabel={t('action.clearFilters')} className="min-w-56 flex-1 md:max-w-sm" />
        <span className="flex-1" />
        <TableViewMenu
          label={t('services.view')}
          density={list.density}
          onDensityChange={(d) => list.set({ density: d })}
          densityLabel={t('common.density')}
          densityOptions={{ comfortable: t('services.density.comfortable'), compact: t('services.density.compact') }}
        />
      </div>

      {q.isPending ? (
        <div className="rounded-card border border-line-edge bg-ink-surface">
          <ListLoading rows={6} columns={4} />
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 && list.filtered ? (
        <ListFilteredEmpty entity={t('services.entity')} filters={list.state.q.trim() ? `« ${list.state.q.trim()} »` : '—'} onClear={list.clear} />
      ) : rows.length === 0 ? (
        <ListEmpty title={t('services.empty.title')} description={t('services.empty.description')} action={canWrite ? { label: t('services.add'), onClick: () => router.push(NEW_SERVICE) } : undefined} />
      ) : (
        <DataTable
          label={t('nav.services')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('services.sortBy', { column: header })}
          density={list.density}
          rowActions={menu}
          actionsLabel={t('action.actions')}
          onRowClick={open}
          card={(row) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/products/${row.id}`} className="min-w-0 flex-1">
                {name(row)}
              </Link>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Money value={row.price} className="font-medium" />
                <AiPill state={row.aiState} reason={aiExclusion(row)} />
              </span>
              {menu(row)}
            </div>
          )}
          footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={total} onChange={(patch) => list.set(patch)} />}
        />
      )}
      {actions.dialogs}
    </AppPage>
  );
}
