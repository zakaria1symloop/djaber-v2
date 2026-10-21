'use client';
// /products — Figma "CAT-08 — Products — list (advanced)", "CAT-08 — Products — bulk bar + row actions menu",
// "CAT-08 — Products — filter panel open", "CAT-01 — Product — quick edit sheet + relations",
// "MOD — Merchant side — product moderation states" (tabs, banners, VALIDATION DJABER pills).
// L6 list: search, filter panel, moderation tabs, sort, pagination 25/50/100, density, columns, selection + bulk bar,
// row `Actions ⌄` from the server descriptors, quick-edit sheet — all of it in the URL (`useListState`).
import { formatMoney, formatNumber } from '@djaber/shared';
import { ActionsMenu, Banner, Button, buttonClass, Card, cn, DataTable, Ltr, TableViewMenu, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { AdjustStockDialog } from '@/features/catalog/adjust-stock-dialog';
import { catalogApi, useCatalogRefresh, useCategories, useModerationSummary, useProducts, useStockOverview } from '@/features/catalog/api';
import type { ProductListItem } from '@/features/catalog/contracts';
import { productMenuActions } from '@/features/catalog/product-actions';
import { ArchiveProductDialog, CardPreviewDialog, DuplicateProductDialog, RestoreProductDialog } from '@/features/catalog/product-dialogs';
import { useProductStats } from '@/features/gds/api';
import { AddToAgentDialog, ProductsBulkBar, useProductsExport } from '@/features/catalog/products-list/bulk';
import { ProductsActiveFilters, ProductsFilterBar, ProductsFilterPanel, useCategoryOptions } from '@/features/catalog/products-list/filters';
import { QuickEditSheet } from '@/features/catalog/products-list/quick-edit-sheet';
import { PRODUCTS_LIST, productsQuery } from '@/features/catalog/products-list/spec';
import { AiPill, CategoryPill, ListPagination, ModerationPill, Money, Num, Pct, ProductStatePill, ProductThumb, StockPill, stockTone } from '@/features/catalog/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { compactAmount } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';

type RowDialog = { kind: 'archive' | 'duplicate' | 'restore' | 'card' | 'adjust' | 'agent'; product: ProductListItem } | null;

export default function ProductsPage() {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const { can, workspace } = useSession();
  const advanced = workspace?.stockMode === 'advanced';
  const canWrite = can('catalog.write');
  const list = useListState(PRODUCTS_LIST);
  const s = list.state;
  const query = useMemo(() => productsQuery(list.apiQuery(), s.tab), [list, s.tab]);
  const products = useProducts(query);
  const overview = useStockOverview(can('stock.read'));
  // the summary line follows the filters (M2 carry-over: `GET /products/stats`, same parameters as the list)
  const stats = useProductStats(productsQuery(list.filterQuery(), s.tab));
  const moderation = useModerationSummary();
  const categories = useCategories();
  const categoryOptions = useCategoryOptions(categories.data);
  const refresh = useCatalogRefresh();
  const exportProducts = useProductsExport();

  const [panel, setPanel] = useState(false);
  const [dialog, setDialog] = useState<RowDialog>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => products.data?.rows ?? [], [products.data]);
  const total = products.data?.total ?? 0;
  // a selection never outlives the page of rows it was made on
  const view = JSON.stringify(query);
  useEffect(() => setSelected(new Set()), [view]);

  const toggle = useMutation({
    mutationFn: async (row: ProductListItem) => {
      // the list row carries no version: read it, then write
      const fresh = await catalogApi.product(row.id);
      return catalogApi.updateProduct(row.id, { isActive: !fresh.isActive, version: fresh.version });
    },
  });
  const toggleActive = async (row: ProductListItem) => {
    try {
      const r = await toggle.mutateAsync(row);
      await refresh({ productId: row.id });
      toast(t(r.data.isActive ? 'products.toast.activated' : 'products.toast.deactivated', { name: row.name }));
    } catch (e) {
      toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
    }
  };

  const actionsOf = (row: ProductListItem) =>
    productMenuActions(
      row,
      {
        open: () => router.push(`/products/${row.id}`),
        quickEdit: () => list.openSheet(row.id),
        edit: () => router.push(`/products/${row.id}/edit`),
        adjustStock: () => setDialog({ kind: 'adjust', product: row }),
        variants: () => router.push(`/products/${row.id}/edit#variants`),
        movements: () => router.push(`/movements?productId=${row.id}`),
        orders: can('orders.read') ? () => router.push(`/orders?productId=${row.id}`) : undefined,
        duplicate: () => setDialog({ kind: 'duplicate', product: row }),
        cardPreview: () => setDialog({ kind: 'card', product: row }),
        addToAgent: can('agents.read') ? () => setDialog({ kind: 'agent', product: row }) : undefined,
        toggleActive: () => void toggleActive(row),
        archive: () => setDialog({ kind: 'archive', product: row }),
        restore: () => setDialog({ kind: 'restore', product: row }),
        remove: () => setDialog({ kind: 'archive', product: row }),
      },
      { t, advanced, canWrite },
    );
  const menu = (row: ProductListItem) => <ActionsMenu label={t('action.actions')} heading={`${row.name} · ${row.sku}`} actions={actionsOf(row)} />;

  const nameCell = (r: ProductListItem) => (
    <div className="flex min-w-0 items-center gap-3">
      <ProductThumb src={r.primaryImageUrl} name={r.name} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">{r.name}</span>
          {r.archived || !r.isActive ? <ProductStatePill product={r} /> : null}
        </div>
        {r.hasVariants || !r.trackStock ? <div className="truncate ts-label-meta text-text-muted">{r.trackStock ? (r.variantSummary ?? t('products.list.variants')) : t('products.list.serviceLine')}</div> : null}
      </div>
    </div>
  );
  const stockCell = (r: ProductListItem) => (
    <span className="inline-flex items-center gap-2">
      {r.stock === null ? <span className="text-text-muted">—</span> : <Num value={r.stock} className={cn('ts-numeral-m', stockTone(r.stockState))} />}
      <StockPill state={r.stockState} />
    </span>
  );
  const columns: Column<ProductListItem>[] = [
    { key: 'name', header: t('products.col.product'), sortKey: 'name', hideable: false, cell: nameCell, className: 'max-w-[320px]' },
    { key: 'sku', header: t('products.col.sku'), sortKey: 'sku', hideBelow: 'lg', cell: (r) => <Ltr className="whitespace-nowrap ts-label-meta text-text-secondary">{r.sku}</Ltr> },
    { key: 'category', header: t('products.col.category'), hideBelow: 'lg', cell: (r) => <CategoryPill category={r.category} /> },
    // a product with variants is sold at its variants' prices: their range, not the base price (tester report 2026-10-20)
    {
      key: 'price',
      header: t('common.price'),
      sortKey: 'price',
      cell: (r) =>
        r.priceRange && r.priceRange.min !== r.priceRange.max ? (
          <span className="whitespace-nowrap">
            <Money value={r.priceRange.min} className="ts-numeral-m" /> – <Money value={r.priceRange.max} className="ts-numeral-m" />
          </span>
        ) : (
          <Money value={r.priceRange?.min ?? r.price} className="ts-numeral-m" />
        ),
    },
    ...(advanced
      ? ([
          { key: 'cost', header: t('products.col.cost'), sortKey: 'cost', hideBelow: 'xl', cell: (r) => <Money value={r.costPrice} muted /> },
          { key: 'margin', header: t('products.col.margin'), hideBelow: 'xl', cell: (r) => <Pct value={r.marginPct} className="whitespace-nowrap" /> },
        ] satisfies Column<ProductListItem>[])
      : []),
    { key: 'stock', header: t('action.stock'), sortKey: 'stock', cell: stockCell },
    { key: 'unit', header: t('products.col.unit'), hideBelow: 'xl', cell: (r) => <span className="ts-label-meta text-text-muted">{r.unit?.abbreviation ?? '—'}</span> },
    { key: 'ai', header: t('products.col.ai'), hideBelow: 'xl', cell: (r) => <AiPill state={r.aiState} /> },
    {
      key: 'moderation',
      header: t('products.col.moderation'),
      hideBelow: 'xl',
      cell: (r) => (r.moderation && r.moderation.status !== 'not_required' ? <ModerationPill status={r.moderation.status} /> : <span className="text-text-muted">—</span>),
    },
  ];
  // IA and validation columns only matter while something is under review or excluded
  const reviewing = (moderation.data?.pending ?? 0) + (moderation.data?.rejected ?? 0) + (moderation.data?.appealed ?? 0) > 0 || s.tab === 'pending' || s.tab === 'rejected';
  // with them the unit column gives its place (1440 px keeps every other column readable)
  const hidden = reviewing ? [...s.hide, 'unit'] : [...s.hide, 'ai', 'moderation'];

  const sheetIndex = s.sheet ? rows.findIndex((r) => r.id === s.sheet) : -1;
  const o = overview.data;
  const st = stats.data;
  const summary = st
    ? [
        list.filtered ? t('products.list.results', { count: total }) : t('products.list.count', { count: st.total }),
        t('products.list.lowCount', { count: st.lowStock + st.outOfStock }),
        advanced && st.valueAtCost !== null ? t('products.list.valueAtCost', { amount: st.valueAtCost < 1_000_000 ? formatMoney(st.valueAtCost) : `${compactAmount(st.valueAtCost, locale)} ${t('common.currency')}` }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : list.filtered
    ? products.data
      ? t('products.list.results', { count: total })
      : undefined
    : o
      ? [
          t('products.list.count', { count: o.totalProducts }),
          t('products.list.lowCount', { count: o.lowStockCount + o.outOfStockCount }),
          advanced && o.valueAtCost !== null ? t('products.list.valueAtCost', { amount: o.valueAtCost < 1_000_000 ? formatMoney(o.valueAtCost) : `${compactAmount(o.valueAtCost, locale)} ${t('common.currency')}` }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : products.data
        ? t('products.list.count', { count: total })
        : undefined;
  const tabs: { key: string | null; label: string; count?: number }[] = [
    { key: null, label: t('products.tab.all') },
    { key: 'active', label: t('products.tab.active') },
    { key: 'pending', label: t('products.tab.pending'), count: moderation.data?.pending },
    { key: 'rejected', label: t('products.tab.rejected'), count: moderation.data ? moderation.data.rejected + moderation.data.appealed : undefined },
    { key: 'hidden', label: t('products.tab.hidden') },
  ];
  const empty = products.data && rows.length === 0;

  return (
    <AppPage
      wide
      eyebrow={t('nav.group.stock')}
      title={t('nav.products')}
      description={summary}
      permission="catalog.read"
      actions={
        <>
          {canWrite ? (
            <Link href="/products/import" className={buttonClass()}>
              {t('action.import')}
            </Link>
          ) : null}
          {canWrite ? <Button onClick={() => void exportProducts(() => catalogApi.exportProducts(productsQuery(list.filterQuery(), s.tab)))}>{t('action.export')}</Button> : null}
          {canWrite ? (
            <Link href="/products/new" className={buttonClass({ variant: 'primary' })}>
              {t('products.list.add')}
            </Link>
          ) : null}
        </>
      }
    >
      {moderation.data && moderation.data.rejected > 0 && s.tab !== 'rejected' ? (
        <Banner tone="danger" action={{ label: t('products.banner.rejected.action'), onClick: () => list.set({ tab: 'rejected' }) }}>
          {t('products.banner.rejected', { count: moderation.data.rejected })}
        </Banner>
      ) : null}
      {moderation.data && moderation.data.pending > 0 && s.tab !== 'pending' ? (
        <Banner tone="info" action={{ label: t('action.view'), onClick: () => list.set({ tab: 'pending' }) }}>
          {t('products.banner.pending', { count: moderation.data.pending })}
        </Banner>
      ) : null}

      <nav aria-label={t('products.tab.label')} className="flex gap-1 overflow-x-auto border-b border-line-hairline">
        {tabs.map((tab) => {
          const on = (s.tab ?? null) === tab.key;
          return (
            <button
              key={tab.key ?? 'all'}
              type="button"
              aria-current={on ? 'page' : undefined}
              data-tab={tab.key ?? 'all'}
              onClick={() => list.set({ tab: tab.key })}
              className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px]', on ? 'border-white text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}
            >
              {tab.label}
              {tab.count ? <Ltr className="ms-1.5 ts-label-meta text-text-muted">{formatNumber(tab.count)}</Ltr> : null}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <ProductsFilterBar list={list} categories={categoryOptions} lowStockCount={o ? o.lowStockCount + o.outOfStockCount : null} onOpenPanel={() => setPanel(true)} />
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
      <ProductsActiveFilters list={list} categories={categoryOptions} />

      {selected.size > 0 ? <ProductsBulkBar rows={rows} selected={selected} total={total} onSelectAllPage={() => setSelected(new Set(rows.map((r) => r.id)))} onClear={() => setSelected(new Set())} /> : null}

      {products.isPending ? (
        <Card>
          <ListLoading rows={5} columns={6} />
        </Card>
      ) : products.isError ? (
        <QueryError error={products.error} onRetry={() => products.refetch()} />
      ) : empty && !list.filtered ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="products-empty">
          <Package className="size-5 text-text-secondary" aria-hidden />
          <h2 className="ts-title">{t('products.empty.title')}</h2>
          <p className="ts-label-meta max-w-md text-text-muted">{t('products.empty.description')}</p>
          {canWrite ? (
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Link href="/products/import" className={buttonClass()}>
                {t('action.import')}
              </Link>
              <Link href="/products/new" className={buttonClass({ variant: 'primary' })}>
                {t('products.list.add')}
              </Link>
            </div>
          ) : null}
        </Card>
      ) : empty ? (
        <ListFilteredEmpty entity={t('products.entity')} filters={t('products.list.currentFilters')} onClear={list.clear} />
      ) : s.layout === 'grid' ? (
        <div className={cn('flex flex-col gap-3', products.isPlaceholderData && 'opacity-60')}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="products-grid">
            {rows.map((r) => (
              <li key={r.id} data-row={r.id}>
                <Card className="flex h-full flex-col gap-3 p-3">
                  <Link href={`/products/${r.id}`} className="flex items-center gap-3">
                    <ProductThumb src={r.primaryImageUrl} name={r.name} size={56} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{r.name}</div>
                      <Ltr className="ts-label-meta text-text-muted">{r.sku}</Ltr>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Money value={r.price} className="ts-numeral-m" />
                    <span className="flex-1" />
                    {stockCell(r)}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <CategoryPill category={r.category} />
                    {menu(r)}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Card>
            <ListPagination page={s.page} pageSize={s.pageSize} total={total} onChange={(p) => list.set(p)} />
          </Card>
        </div>
      ) : (
        <DataTable<ProductListItem>
          label={t('nav.products')}
          className={cn(products.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          selection={canWrite ? { selected, onChange: setSelected, allLabel: t('list.selectAll'), rowLabel: (r) => t('list.selectRow', { name: r.name }) } : undefined}
          density={list.density}
          hiddenColumns={hidden}
          activeRowKey={s.sheet}
          onRowClick={(r) => router.push(`/products/${r.id}`)}
          actionsLabel={t('action.actions')}
          rowActions={menu}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/products/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <ProductThumb src={r.primaryImageUrl} name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{r.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 ts-label-meta text-text-muted">
                    <Ltr>{r.sku}</Ltr>
                    <Money value={r.price} />
                    {r.stock !== null ? <Num value={r.stock} className={stockTone(r.stockState)} /> : null}
                    <StockPill state={r.stockState} />
                  </div>
                </div>
              </Link>
              {menu(r)}
            </div>
          )}
          footer={
            <ListPagination
              page={s.page}
              pageSize={s.pageSize}
              total={total}
              onChange={(p) => list.set(p)}
              note={t('products.list.sortNote', { field: t(`products.sort.${list.sort.key}`), dir: list.sort.dir === 'asc' ? '↑' : '↓' })}
            />
          }
        />
      )}

      <ProductsFilterPanel open={panel} onClose={() => setPanel(false)} list={list} categories={categoryOptions} total={products.data ? total : null} advanced={advanced} />
      <QuickEditSheet
        productId={s.sheet}
        onClose={() => list.openSheet(null)}
        onPrev={sheetIndex > 0 ? () => list.openSheet(rows[sheetIndex - 1]!.id) : undefined}
        onNext={sheetIndex >= 0 && sheetIndex < rows.length - 1 ? () => list.openSheet(rows[sheetIndex + 1]!.id) : undefined}
        position={sheetIndex >= 0 ? `${sheetIndex + 1} / ${rows.length}` : undefined}
      />
      <AdjustStockDialog open={dialog?.kind === 'adjust'} product={dialog?.kind === 'adjust' ? dialog.product : null} onClose={() => setDialog(null)} />
      <ArchiveProductDialog product={dialog?.kind === 'archive' ? dialog.product : null} onClose={() => setDialog(null)} />
      <DuplicateProductDialog product={dialog?.kind === 'duplicate' ? dialog.product : null} onClose={() => setDialog(null)} onDone={(copy) => router.push(`/products/${copy.id}/edit`)} />
      <RestoreProductDialog product={dialog?.kind === 'restore' ? dialog.product : null} onClose={() => setDialog(null)} />
      <CardPreviewDialog product={dialog?.kind === 'card' ? dialog.product : null} onClose={() => setDialog(null)} />
      <AddToAgentDialog product={dialog?.kind === 'agent' ? dialog.product : null} onClose={() => setDialog(null)} />
    </AppPage>
  );
}
