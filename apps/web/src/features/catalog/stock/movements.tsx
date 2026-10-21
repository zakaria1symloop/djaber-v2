'use client';
// /movements — Figma "GDS-05 — Movements — list + filter panel" (12 §21 "Movements", 06 §10 "Mouvements").
// Immutable journal (advanced stock mode): nothing is edited or deleted, a correction is a new inverse movement.
// `GET /stock/movements`, `POST /stock/movements/:id/reverse`, `GET /stock/snapshot?date`, `GET /stock/movements/export`.
import type { ActionDescriptor } from '@djaber/shared';
import { formatDateTime, formatNumber } from '@djaber/shared';
import { ActionsMenu, ActiveFilters, Button, buttonClass, Card, cn, DataTable, EmptyState, KpiTile, KpiTileSkeleton, Ltr, SearchInput, TableViewMenu, toast, type Column } from '@djaber/ui';
import { ArrowLeftRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListFilteredEmpty, ListLoading, QueryError } from '@/components/global-states';
import { Link, useRouter } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useMovementStats } from '@/features/gds/api';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { catalogApi, useMovements } from '../api';
import type { StockMovement } from '../contracts';
import { ListPagination, MovementTypePill, useMovementReason } from '../ui';
import { actorName, formatSigned, quantityTone, referenceHref, referenceKind, signedQuantity, withoutYear } from './logic';
import { ReverseMovementDialog, SnapshotDialog } from './movement-dialogs';
import { MovementFilterPanel, MovementQuickFilters, MOVEMENTS_SPEC, useMovementFilters } from './movement-filters';

const IMMUTABLE: Pick<ActionDescriptor, 'enabled' | 'reasonCode'> = { enabled: false, reasonCode: 'GDS_MOVEMENT_IMMUTABLE' };

/** The server sends `open_product` and `reverse`; the read-only items and the two impossible ones are added here. */
const descriptorsOf = (m: StockMovement): ActionDescriptor[] => {
  const sent = (m.actions ?? []).filter((a) => a.key !== 'edit' && a.key !== 'delete');
  const has = (key: string) => sent.some((a) => a.key === key);
  return [
    ...(has('open_product') ? [] : [{ key: 'open_product', enabled: true, primary: true }]),
    ...sent,
    ...(has('snapshot') ? [] : [{ key: 'snapshot', enabled: true }]),
    { key: 'edit', ...IMMUTABLE },
    { key: 'delete', ...IMMUTABLE },
  ];
};

export function MovementsList() {
  const t = useT();
  const { workspace } = useSession();
  // simple mode keeps no journal screen: explain it instead of a 404
  if (workspace && workspace.stockMode !== 'advanced') {
    return (
      <AppPage wide title={t('movements.title')} permission="stock.read">
        <EmptyState icon={<ArrowLeftRight className="size-5" />} title={t('movements.simple.title')} description={t('movements.simple.description')} />
        <div className="flex justify-center">
          <Link href="/settings/stock-mode" className={buttonClass({ variant: 'primary' })} data-testid="movements-stock-mode">
            {t('movements.simple.cta')}
          </Link>
        </div>
      </AppPage>
    );
  }
  return <Journal />;
}

function Journal() {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const router = useRouter();
  const { can, workspace } = useSession();
  const canAdjust = can('stock.adjust');
  const list = useListState(MOVEMENTS_SPEC);
  const movements = useMovements(list.apiQuery(), !!workspace);
  // KPI tiles follow the filters (M2 carry-over: `GET /stock/movements/stats`, same parameters as the list)
  const stats = useMovementStats(list.filterQuery(), !!workspace);
  const rows = useMemo(() => movements.data?.rows ?? [], [movements.data]);
  const total = movements.data?.total ?? null;
  const reasonLabel = useMovementReason();
  const [panel, setPanel] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [reverse, setReverse] = useState<StockMovement | null>(null);
  const [snapshot, setSnapshot] = useState<StockMovement | null>(null);
  const [exporting, setExporting] = useState(false);

  const selectedProduct = typeof list.state.filters.productId === 'string' ? list.state.filters.productId : '';
  const f = useMovementFilters(list, rows.find((m) => m.product.id === selectedProduct)?.product.name);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { jobId } = await catalogApi.exportMovements(list.filterQuery({ format: 'csv' }));
      const entity = t('movements.export.entity');
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (job) => t('toast.export.progress', { entity, pct: job.progress, rows: formatNumber(job.total ?? 0) }),
        done: (job) => ({
          message: t('toast.export.done', { file: t('movements.export.file') }),
          action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined,
        }),
        failed: (job, error) => (job?.error?.message ? `${job.error.message} (${job.error.code})` : errorMessage(error, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setExporting(false);
    }
  };

  const openProduct = (m: StockMovement) => router.push(`/products/${m.product.id}`);
  const actionsOf = (m: StockMovement) =>
    toMenuActions(
      descriptorsOf(m),
      {
        open_product: { label: t('movements.action.openProduct'), hint: t('movements.action.hint.page'), onSelect: () => openProduct(m) },
        reverse: { label: t('movements.action.reverse'), hint: t('movements.action.hint.dialog'), onSelect: () => setReverse(m), hidden: !canAdjust },
        snapshot: { label: t('movements.action.snapshot'), hint: t('movements.action.hint.dialog'), onSelect: () => setSnapshot(m) },
        edit: { label: t('action.edit'), onSelect: () => undefined, separated: true },
        delete: { label: t('action.delete'), onSelect: () => undefined, destructive: true },
      },
      t,
    );

  const columns: Column<StockMovement>[] = [
    {
      key: 'date',
      header: t('common.date'),
      sortKey: 'createdAt',
      hideable: false,
      className: 'whitespace-nowrap',
      cell: (m) => (
<span title={formatDateTime(m.createdAt, locale)}>{withoutYear(formatDateTime(m.createdAt, locale))}</span>
      ),
    },
    {
      key: 'product',
      header: t('movements.col.product'),
      hideable: false,
      cell: (m) => (
        <span className="font-medium" data-testid="movement-product">
          {m.product.name}
          {m.variant ? <span className="font-normal text-text-secondary"> · {m.variant.name}</span> : null}
        </span>
      ),
    },
    { key: 'type', header: t('movements.col.type'), cell: (m) => <MovementTypePill type={m.type} /> },
    { key: 'qty', header: t('movements.col.qty'), align: 'end', cell: (m) => <Quantity movement={m} /> },
    {
      key: 'beforeAfter',
      header: t('movements.col.beforeAfter'),
      align: 'end',
      hideBelow: 'lg',
      className: 'whitespace-nowrap',
      cell: (m) => <Ltr className="tabular-nums text-text-secondary">{`${formatSigned(m.before).replace('+', '')} → ${formatSigned(m.after).replace('+', '')}`}</Ltr>,
    },
    { key: 'reason', header: t('common.reason'), cell: (m) => reasonLabel(m.reason) },
    { key: 'reference', header: t('movements.col.reference'), hideBelow: 'lg', cell: (m) => <Reference movement={m} /> },
    { key: 'by', header: t('movements.col.by'), hideBelow: 'xl', cell: (m) => actorName(m.actor) ?? <span className="text-text-secondary">{t('movements.system')}</span> },
  ];

  const sortNote = t('movements.sortNote', { dir: list.sort.dir === 'desc' ? '↓' : '↑' });
  return (
    <AppPage
      wide
      title={t('movements.title')}
      description={t('movements.subtitle')}
      permission="stock.read"
      actions={
        <>
          <Button variant="ghost" onClick={exportCsv} loading={exporting} disabledReason={total === 0 ? t('movements.export.none') : undefined}>
            {t('movements.export')}
          </Button>
          <Button variant="primary" onClick={() => setAdjust(true)} disabledReason={canAdjust ? undefined : t('toast.forbidden')}>
            {t('movements.adjust')}
          </Button>
        </>
      }
    >
      <MovementKpis stats={stats.data} period={f.periodLabel} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={list.state.q} onChange={(q) => list.set({ q })} placeholder={t('movements.search.placeholder')} label={t('action.search')} clearLabel={t('movements.search.clear')} className="basis-64" />
        <MovementQuickFilters list={list} f={f} />
        <Button onClick={() => setPanel(true)} className={cn(list.activeCount > 0 && 'border-line-lit')} data-testid="open-filters">
          {list.activeCount > 0 ? t('action.filtersCount', { count: list.activeCount }) : t('action.filters')}
        </Button>
        <TableViewMenu
          label={t('movements.view.label')}
          density={list.density}
          onDensityChange={(density) => list.set({ density })}
          densityLabel={t('common.density')}
          densityOptions={{ comfortable: t('movements.view.comfortable'), compact: t('movements.view.compact') }}
          columns={columns.filter((c) => c.hideable !== false).map((c) => ({ key: c.key, label: c.header }))}
          hidden={list.state.hide}
          onHiddenChange={(hide) => list.set({ hide })}
          columnsLabel={t('common.columns')}
        />
      </div>

      {total !== null ? (
        <p className="ts-label-meta uppercase text-text-muted" aria-live="polite" data-testid="movements-count">
          {t('movements.count', { count: total })} · {sortNote}
        </p>
      ) : null}
      <ActiveFilters items={f.chips} clearLabel={t('movements.chips.clear')} onClear={list.filtered ? list.clear : undefined} removeLabel={(label) => t('movements.chips.remove', { label })} label={t('movements.chips.label')} />

      {movements.isPending ? (
        <Card>
          <ListLoading rows={8} columns={6} />
        </Card>
      ) : movements.isError ? (
        <QueryError error={movements.error} onRetry={() => movements.refetch()} />
      ) : rows.length === 0 ? (
        list.filtered ? (
          <ListFilteredEmpty entity={t('movements.entity')} filters={[list.state.q.trim(), ...f.chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={list.clear} />
        ) : (
          <ListEmpty title={t('movements.empty.title')} description={t('movements.empty.description')} action={canAdjust ? { label: t('movements.adjust'), onClick: () => setAdjust(true) } : undefined} />
        )
      ) : (
        <DataTable
          label={t('movements.title')}
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('movements.sortBy', { column: header })}
          density={list.density}
          hiddenColumns={list.state.hide}
          onRowClick={openProduct}
          actionsLabel={t('action.actions')}
          rowActions={(m) => <ActionsMenu label={t('action.actions')} heading={m.variant ? `${m.product.name} · ${m.variant.name}` : m.product.name} actions={actionsOf(m)} />}
          card={(m) => (
            <div className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/products/${m.product.id}`} className="min-w-0 text-[14px] font-medium">
                  {m.product.name}
                  {m.variant ? <span className="font-normal text-text-secondary"> · {m.variant.name}</span> : null}
                </Link>
                <Quantity movement={m} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <MovementTypePill type={m.type} />
                <span className="ts-label-meta text-text-muted">
                  {withoutYear(formatDateTime(m.createdAt, locale))} · {reasonLabel(m.reason)} · {actorName(m.actor) ?? t('movements.system')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="ts-label-meta text-text-muted">
                  <Ltr className="tabular-nums">{`${formatSigned(m.before).replace('+', '')} → ${formatSigned(m.after).replace('+', '')}`}</Ltr>
                  {m.reference ? ' · ' : ''}
                  <Reference movement={m} />
                </span>
                <ActionsMenu label={t('action.actions')} actions={actionsOf(m)} />
              </div>
            </div>
          )}
          footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={total ?? rows.length} onChange={(patch) => list.set(patch)} note={sortNote} />}
        />
      )}

      <MovementFilterPanel open={panel} onClose={() => setPanel(false)} list={list} f={f} total={total} />
      <AdjustStockDialog open={adjust} onClose={() => setAdjust(false)} product={null} />
      <ReverseMovementDialog movement={reverse} onClose={() => setReverse(null)} />
      <SnapshotDialog movement={snapshot} onClose={() => setSnapshot(null)} />
    </AppPage>
  );
}

function Quantity({ movement: m }: { movement: StockMovement }) {
  const qty = signedQuantity(m);
  const tone = quantityTone(qty);
  return (
    <span data-testid="movement-qty">
      <Ltr className={cn('font-semibold tabular-nums', tone === 'in' && 'text-accent-money', tone === 'out' && 'text-accent-alert')}>{`${qty > 0 ? '+' : qty < 0 ? '−' : ''}${formatNumber(Math.abs(qty))}`}</Ltr>
    </span>
  );
}

/** `#CMD-1042` · a variant name (link to its product) · the type label alone for manual / import references. */
function Reference({ movement: m }: { movement: StockMovement }) {
  const t = useT();
  if (!m.reference) return <span className="text-text-muted">—</span>;
  const kind = referenceKind(m.reference.type);
  const typeKey = `movements.refType.${m.reference.type}`;
  const label = kind === 'number' ? `#${m.reference.label}` : kind === 'name' ? m.reference.label : t.has(typeKey) ? t(typeKey) : m.reference.type;
  const href = referenceHref(m);
  if (!href) return kind === 'number' ? <Ltr>{label}</Ltr> : <span>{label}</span>;
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:underline">
      {label}
      <ArrowUpRight className="size-3 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** GDS-05 tiles: entrées, sorties, ajustements (inventaires · corrections), net of the selection. */
function MovementKpis({ stats, period }: { stats: ReturnType<typeof useMovementStats>['data']; period: string | null }) {
  const t = useT();
  const when = period ?? t('movements.kpi.allTime');
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('movements.kpi.label')} data-testid="movement-kpis">
      {stats ? (
        <>
          <KpiTile value={'+' + formatNumber(stats.unitsIn)} label={t('movements.kpi.in', { period: when })} meta={t('movements.kpi.inMeta')} data-kpi="in" />
          <KpiTile value={'−' + formatNumber(stats.unitsOut)} label={t('movements.kpi.out', { period: when })} meta={t('movements.kpi.outMeta')} data-kpi="out" />
          <KpiTile
            value={formatNumber(stats.byType.adjustment_in.count + stats.byType.adjustment_out.count)}
            label={t('movements.kpi.adjustments')}
            meta={t('movements.kpi.adjustmentsMeta', { inventories: stats.byType.inventory.count, returns: stats.byType.return.count })}
            data-kpi="adjustments"
          />
          <KpiTile value={(stats.net > 0 ? '+' : stats.net < 0 ? '−' : '') + formatNumber(Math.abs(stats.net))} label={t('movements.kpi.net')} meta={stats.netValue === null ? t('movements.kpi.count', { count: stats.count }) : t('movements.kpi.netValue', { amount: formatNumber(stats.netValue) })} data-kpi="net" />
        </>
      ) : (
        Array.from({ length: 4 }).map((_, i) => <KpiTileSkeleton key={i} />)
      )}
    </section>
  );
}
