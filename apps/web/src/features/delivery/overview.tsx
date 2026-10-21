'use client';
// /delivery — Figma "DLV-08 — Delivery — overview + tracking panel", "MECH — Delivery filters + row menu + bulk send
// results", "DLV-05 — send to courier dialog". Tiles (`GET /delivery/overview` kpis), tabs Échecs / Sans mouvement /
// À envoyer / En transit / Retours / Toutes (= filter presets, counts from the overview), search + filter panel (model
// Shipment ⟷ Order), rows with the courier, the failure reason + attempt n/3 or the status, the last event, and the
// `Actions ⌄` of the server descriptors; selection bar (send to courier, labels, refresh tracking, self-delivery);
// tracking side panel `?sheet=<shipmentId>`; no-courier card (CTA + Livraison propre); all of it in the URL.
import { formatDate, formatNumber, formatPhoneDz, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  ActiveFilters,
  BulkBar,
  Button,
  buttonClass,
  Card,
  cn,
  ConfirmDialog,
  DataTable,
  FilterChips,
  FilterCheckList,
  FilterDateRange,
  FilterGroup,
  FilterPanel,
  KpiTile,
  KpiTileSkeleton,
  Ltr,
  OrderNumber,
  Pill,
  SearchInput,
  StatusPill,
  toast,
  type BulkAction,
  type Column,
  type FilterOption,
} from '@djaber/ui';
import { PackageCheck, SlidersHorizontal, Truck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { useOffline } from '@/features/orders/offline';
import { algiersTime } from '@/features/orders/logic';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState, reasonText } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { filterList, filterText, listQueryString, patchListState } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import type { ListController } from '@/lib/use-list-state';
import { useListState } from '@/lib/use-list-state';
import { uuid } from '@/lib/uuid';
import { refusal } from '@/features/orders/dialogs/common';
import { JobParamBanner } from '@/components/job-param-banner';
import { SHIPMENT_ACTION } from './action-keys';
import { deliveryApi, useCouriers, useDeliveryOverview, useDeliveryRefresh, useGeoWilayas, useShipments } from './api';
import { BulkSendDialog, BulkSendResults, type SendTarget } from './bulk-send';
import { COURIER_PROVIDERS, FAILURE_REASONS, type DeliveryRow } from './contracts';
import { wilayaLabel } from './geo';
import { PrintLabelsDialog } from './labels';
import { daysSince } from './logic';
import { currentTab, DELIVERY_LIST, DELIVERY_TAB_LIST, deliveryChips, LAST_ERRORS, LAST_EVENTS, panelFilterCount, SHIPMENT_FILTER_STATUSES, shipmentsQuery } from './overview-spec';
import { TrackingPanel } from './tracking-panel';
import { parcelOfRow, useParcelActions } from './use-parcel-actions';

const MAX_ATTEMPTS = 3;
/** Clears the search and the panel filters; the tab stays (it is the screen, not a filter). */
const clearPanel = (list: ListController) => list.set({ q: '', filters: Object.fromEntries(Object.keys(list.state.filters).map((k) => [k, null])) });

export function DeliveryOverviewPage() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const list = useListState(DELIVERY_LIST);
  const s = list.state;
  // `?job=<id>`: the "envoi groupé terminé" notification (Job bulk_send) opens its per-order results here
  const params = useSearchParams();
  const bulkJob = params.get('job');
  const withoutJob = (next = s) => {
    const qs = listQueryString(DELIVERY_LIST, next, [...params.entries()].filter(([key]) => key !== 'job'));
    router.replace(qs ? `/delivery?${qs}` : '/delivery', { scroll: false });
  };
  // `?order=<orderId>` (notification / home "colis en échec", 03-events §shipment_failed): the list is narrowed to that
  // order (`ids`, order ids) and its parcel's tracking panel opens once the row is loaded
  const orderLink = params.get('order');
  const pendingOrder = useRef<string | null>(null);
  useEffect(() => {
    if (!orderLink) return;
    pendingOrder.current = orderLink;
    const qs = listQueryString(DELIVERY_LIST, patchListState(s, { filters: { ids: [orderLink] } }), [...params.entries()].filter(([key]) => key !== 'order'));
    router.replace(`/delivery?${qs}`, { scroll: false });
  }, [orderLink]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab = currentTab(s);
  const query = useMemo(() => shipmentsQuery(list.apiQuery(), tab), [list, tab]);
  const rowsQ = useShipments(query);
  const overview = useDeliveryOverview();
  const couriers = useCouriers();
  const offline = useOffline();
  const refresh = useDeliveryRefresh();
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'send' | 'labels' | null>(null);
  const parcels = useParcelActions({ onTrack: (id) => list.openSheet(id) });
  const rows = useMemo(() => rowsQ.data?.rows ?? [], [rowsQ.data]);
  const total = rowsQ.data?.total ?? 0;
  const view = JSON.stringify(query);
  useEffect(() => setSelected(new Set()), [view]);
  useEffect(() => {
    const id = pendingOrder.current;
    if (!id || !rowsQ.data) return;
    pendingOrder.current = null;
    const hit = rows.find((r) => r.orderId === id);
    if (hit?.shipment && !s.sheet) list.openSheet(hit.shipment.id);
  }, [rowsQ.data, rows, s.sheet, list]);
  const [confirmManual, setConfirmManual] = useState(false);

  const k = overview.data?.kpis;
  const tabs = overview.data?.tabs;
  const noCourier = overview.data ? overview.data.couriers.active === 0 : couriers.data ? couriers.data.filter((c) => c.isActive).length === 0 : false;
  const canSend = can('delivery.send');

  const lastEvent = (r: DeliveryRow) => {
    const sh = r.shipment;
    if (!sh) return { title: t('delivery.row.notSent'), meta: r.confirmedAt ? t('delivery.row.confirmedAt', { ago: relativeTime(r.confirmedAt, locale) }) : '' };
    const at = sh.lastEventAt ?? sh.createdAt;
    const days = daysSince(at);
    const when = days !== null && days >= 2 ? `${formatDate(at, locale).replace(/ \d{4}$/, '')} · ${t('delivery.row.days', { count: days })}` : `${relativeTime(at, locale)} · ${algiersTime(at)}`;
    return { title: t(`tracking.event.${sh.status}`), meta: [when, sh.courierAccount ? t('delivery.row.byCourier') : t('tracking.source.djaber')].join(' · ') };
  };
  const subject = (r: DeliveryRow) => ({ orderId: r.orderId, parcel: parcelOfRow(r), actions: r.actions, phone: r.client.phone, error: r.shipment?.error ?? null });
  const menu = (r: DeliveryRow) => <ActionsMenu label={t('action.actions')} heading={[`#${r.orderNumber}`, r.shipment ? t(`enum.Shipment.status.${r.shipment.status}`) : t('delivery.row.notSentPill'), r.wilaya?.name].filter(Boolean).join(' · ')} actions={parcels.menu(subject(r))} />;

  const columns: Column<DeliveryRow>[] = [
    {
      key: 'number',
      header: t('delivery.col.number'),
      sortKey: 'orderNumber',
      hideable: false,
      cell: (r) => (
        <div className="min-w-0 whitespace-nowrap">
          <OrderNumber number={r.orderNumber} className="text-[14px] font-medium" />
          <div className="ts-label-micro truncate text-text-muted">{[r.client.name, r.wilaya?.name].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      key: 'client',
      header: t('common.client'),
      hideBelow: 'lg',
      cell: (r) => (
        <div className="whitespace-nowrap">
          {r.client.phone ? <Ltr className="text-[14px]">{formatPhoneDz(r.client.phone)}</Ltr> : <span className="text-text-muted">—</span>}
          <div className="ts-label-micro text-text-muted">{r.shipment && r.shipment.deliveryAttempts > 0 ? t('delivery.row.attempt', { n: r.shipment.deliveryAttempts, max: MAX_ATTEMPTS }) : r.isStopdesk ? t('common.stopdesk') : t('common.home')}</div>
        </div>
      ),
    },
    {
      key: 'courier',
      header: t('common.courier'),
      cell: (r) =>
        r.shipment ? (
          <div className="whitespace-nowrap">
            <div className="text-[14px]">{r.shipment.courierAccount?.displayName ?? t(`couriers.provider.${r.shipment.provider}`)}</div>
            <Ltr className="ts-label-micro text-text-muted">{r.shipment.trackingNumber ?? '—'}</Ltr>
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: 'reason',
      header: tab === 'failed' ? t('delivery.col.reason') : t('common.status'),
      cell: (r) => {
        const sh = r.shipment;
        if (!sh)
          return (
            <StatusPill enumKey="Order.deliveryStatus" value="not_sent" className="!rounded-[4px]">
              {t('delivery.row.notSentPill')}
            </StatusPill>
          );
        if (sh.status === 'failed') {
          const code = sh.error?.code ?? (sh.failureReason ? null : sh.lastError);
          return (
            <div className="flex flex-col items-start gap-1">
              {sh.failureReason ? (
                <StatusPill enumKey="Shipment.failureReason" value={sh.failureReason} className="!rounded-[4px]">
                  {t(`enum.Shipment.failureReason.${sh.failureReason}`)}
                </StatusPill>
              ) : (
                <Pill tone="danger" className="!rounded-[4px]">
                  {t('enum.Shipment.status.failed')}
                </Pill>
              )}
              {code ? <span className="ts-label-micro !normal-case text-accent-alert">{sh.error?.message ? `${sh.error.message} (${code})` : reasonText(t, code)}</span> : null}
            </div>
          );
        }
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusPill enumKey="Shipment.status" value={sh.status} className="!rounded-[4px]">
              {t(`enum.Shipment.status.${sh.status}`)}
            </StatusPill>
            {sh.noMovement ? <span className="ts-label-micro text-accent-starred">{t('delivery.row.noMovement')}</span> : null}
          </div>
        );
      },
    },
    {
      key: 'event',
      header: t('delivery.col.lastEvent'),
      sortKey: 'lastSyncedAt',
      hideBelow: 'lg',
      className: 'max-w-[260px]',
      cell: (r) => {
        const e = lastEvent(r);
        return (
          <div className="min-w-0">
            <div className="truncate text-[14px]">{e.title}</div>
            <div className="ts-label-micro truncate text-text-muted">{e.meta}</div>
          </div>
        );
      },
    },
  ];

  const empty = rowsQ.data && rows.length === 0;
  const panelFiltered = panelFilterCount(s) > 0;
  const since = rowsQ.dataUpdatedAt ? `${formatDate(new Date(rowsQ.dataUpdatedAt), locale)} ${algiersTime(new Date(rowsQ.dataUpdatedAt))}` : '—';
  const tabCount = (key: (typeof DELIVERY_TAB_LIST)[number]) => tabs?.[key];

  // selection → bulk actions (only valid ones; per-row reasons come from the descriptors)
  const chosen = rows.filter((r) => selected.has(r.id));
  const sendTargets: SendTarget[] = chosen.map((r) => {
    const a = actionState(r.actions, SHIPMENT_ACTION.send, t);
    return { id: r.orderId, number: r.orderNumber, label: `#${r.orderNumber} · ${r.client.name}`, blocked: a.present && a.enabled ? null : (a.reason ?? (r.shipment ? `${t('error.DELIVERY_ORDER_ALREADY_SENT')} (DELIVERY_ORDER_ALREADY_SENT)` : t('error.FORBIDDEN'))) };
  });
  const syncIds = chosen.filter((r) => r.shipment && actionState(r.actions, SHIPMENT_ACTION.sync, t).enabled).map((r) => r.shipment!.id);
  const forbidden = !canSend ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  const manualIds = chosen.filter((r) => actionState(r.actions, SHIPMENT_ACTION.shipManual, t).enabled).map((r) => r.orderId);
  const bulkActions: BulkAction[] = [
    { key: 'send', label: t('action.sendToCourier'), onSelect: () => setDialog('send'), disabledReason: forbidden ?? (sendTargets.every((x) => x.blocked) ? t('delivery.bulk.noneSendable') : undefined) },
    { key: 'labels', label: t('action.labels'), onSelect: () => setDialog('labels'), disabledReason: forbidden },
    {
      key: 'sync',
      label: t('delivery.bulk.sync'),
      disabledReason: forbidden ?? (syncIds.length ? undefined : t('delivery.bulk.noneTracked')),
      onSelect: async () => {
        try {
          const { jobId } = await deliveryApi.syncBulk(syncIds);
          trackJob({
            jobId,
            started: t('delivery.bulk.syncStarted', { count: syncIds.length }),
            progress: (j) => t('delivery.bulk.syncProgress', { pct: j.progress }),
            done: () => ({ message: t('delivery.bulk.syncDone') }),
            failed: (j, e) => (j?.error ? `${j.error.message} (${j.error.code})` : refusal(e, t)),
          });
          setSelected(new Set());
          void refresh();
        } catch (e) {
          toast({ tone: 'danger', message: refusal(e, t) });
        }
      },
    },
    {
      key: 'export',
      label: t('delivery.bulk.export'),
      disabledReason: offline ? t('banner.offline') : undefined,
      onSelect: async () => {
        try {
          const { page: _p, pageSize: _ps, sort: _s, ...filters } = query;
          const { jobId } = await deliveryApi.exportShipments({ ...filters, ids: chosen.map((x) => x.id), format: 'csv' });
          trackJob({
            jobId,
            download: true,
            started: t('toast.jobStarted'),
            progress: (j) => t('toast.export.progress', { entity: t('delivery.export.entity'), pct: j.progress, rows: formatNumber(j.total ?? 0) }),
            done: (j) => ({ message: t('toast.export.done', { file: t('delivery.export.file') }), action: j.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(j.resultUrl!, jobFileName(j)) } : undefined }),
            failed: (j, e) => (j?.error ? `${j.error.message} (${j.error.code})` : refusal(e, t)),
          });
        } catch (e) {
          toast({ tone: 'danger', message: refusal(e, t) });
        }
      },
    },
    {
      key: 'manual',
      label: t('delivery.bulk.shipManual'),
      // only the orders whose row offers "Livraison propre" (ship_manual descriptor), after a confirmation
      disabledReason: forbidden ?? (manualIds.length ? undefined : t('delivery.bulk.noneManual')),
      onSelect: () => setConfirmManual(true),
    },
  ];
  const shipManual = async () => {
    try {
      const r = await deliveryApi.shipManualBulk(manualIds, uuid());
      await refresh();
      toast(r.failed ? { tone: 'warning', message: t('delivery.bulk.manualPartial', { ok: r.ok, failed: r.failed }) } : t('delivery.bulk.manualDone', { count: r.ok }));
      setSelected(new Set());
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      setConfirmManual(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {offline ? <OfflineBanner since={since} onRetry={() => void rowsQ.refetch()} /> : null}
      <JobParamBanner />

      <section aria-label={t('delivery.kpi.label')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="delivery-kpis">
        {k ? (
          <>
            <KpiTile value={formatNumber(k.toSend)} label={t('delivery.kpi.toSend')} meta={t('delivery.kpi.toSendMeta')} data-kpi="toSend" />
            <KpiTile value={formatNumber(k.pendingPickup)} label={t('delivery.kpi.created')} meta={t('delivery.kpi.pendingPickup')} data-kpi="pendingPickup" />
            <KpiTile value={formatNumber(k.inTransit)} label={t('delivery.kpi.inTransit')} meta={t('delivery.kpi.stale', { count: k.staleOver5d })} tone={k.staleOver5d ? 'warning' : undefined} data-kpi="inTransit" />
            <KpiTile value={formatNumber(k.failedToday)} label={t('delivery.kpi.failed')} meta={t('delivery.kpi.failedMeta')} tone={k.failedToday ? 'danger' : undefined} data-kpi="failed" />
            <KpiTile value={formatNumber(k.delivered30d)} label={t('delivery.kpi.delivered')} meta={`${k.deliveredPct30d} %`} data-kpi="delivered" />
            <KpiTile value={formatNumber(k.returned30d)} label={t('delivery.kpi.returned')} meta={`${k.returnedPct30d} %`} data-kpi="returned" />
          </>
        ) : overview.isError ? null : (
          Array.from({ length: 6 }).map((_, i) => <KpiTileSkeleton key={i} />)
        )}
      </section>

      {noCourier ? (
        <Card className="flex flex-col gap-3 p-5 md:flex-row md:items-center" data-testid="delivery-no-courier">
          <Truck className="size-5 shrink-0 text-text-secondary" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="ts-title">{t('delivery.noCourier.title')}</h2>
            <p className="ts-label-meta mt-1 text-text-muted">{t('delivery.noCourier.description')}</p>
          </div>
          {can('delivery.manage') ? (
            <Link href="/delivery/couriers?add=1" className={buttonClass({ variant: 'primary' })} data-testid="no-courier-cta">
              {t('delivery.noCourier.cta')}
            </Link>
          ) : null}
          <Link href="/delivery?tab=to_send" className={buttonClass({ variant: 'ghost' })} title={t('delivery.noCourier.manualHint')}>
            {t('delivery.noCourier.manual')}
          </Link>
        </Card>
      ) : null}

      <nav aria-label={t('delivery.tab.label')} className="flex gap-1.5 overflow-x-auto">
        {DELIVERY_TAB_LIST.map((key) => {
          const on = tab === key;
          const n = key === 'all' ? undefined : tabCount(key);
          return (
            <button
              key={key}
              type="button"
              aria-current={on ? 'page' : undefined}
              data-tab={key}
              onClick={() => list.set({ tab: key === 'failed' ? null : key })}
              className={cn('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-card border px-3 text-[13px]', on ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary')}
            >
              {t(`delivery.tab.${key}`)}
              {n !== undefined ? <Ltr className="tabular-nums">{formatNumber(n)}</Ltr> : null}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(q) => list.set({ q })} label={t('action.search')} placeholder={t('delivery.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-96" />
        <Button onClick={() => setPanel(true)} data-testid="open-filters">
          <SlidersHorizontal className="size-4" aria-hidden />
          {panelFiltered ? t('action.filtersCount', { count: panelFilterCount(s) }) : t('action.filters')}
        </Button>
      </div>
      <DeliveryActiveFilters list={list} />

      {selected.size > 0 ? (
        <BulkBar
          label={t('orders.bulk.label')}
          summary={t('orders.bulk.selected', { count: selected.size })}
          actions={bulkActions}
          note={t('delivery.bulk.note')}
          selectAll={rows.every((r) => selected.has(r.id)) ? undefined : { label: t('action.selectAll', { count: rows.length }), onSelect: () => setSelected(new Set(rows.map((r) => r.id))) }}
          deselectLabel={t('action.deselect')}
          onDeselect={() => setSelected(new Set())}
        />
      ) : null}

      {rowsQ.isPending ? (
        <Card>
          <ListLoading rows={5} columns={5} />
        </Card>
      ) : rowsQ.isError && !rowsQ.data ? (
        <QueryError error={rowsQ.error} onRetry={() => rowsQ.refetch()} />
      ) : empty && panelFiltered ? (
        <ListFilteredEmpty entity={t('delivery.entity')} filters={t('delivery.currentFilters')} onClear={() => clearPanel(list)} />
      ) : empty ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="delivery-empty" data-tab={tab}>
          <PackageCheck className="size-5 text-text-secondary" aria-hidden />
          <h2 className="ts-title">{t(`delivery.empty.${tab}.title`)}</h2>
          <p className="ts-label-meta max-w-md text-text-muted">{t(`delivery.empty.${tab}.description`)}</p>
          {tab !== 'to_send' && tab !== 'all' && (tabs?.to_send ?? 0) > 0 ? (
            <Button onClick={() => list.set({ tab: 'to_send' })}>{t('delivery.empty.toSendCta', { count: tabs?.to_send ?? 0 })}</Button>
          ) : null}
        </Card>
      ) : (
        <DataTable<DeliveryRow>
          label={t('nav.delivery')}
          className={cn(rowsQ.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          selection={canSend ? { selected, onChange: setSelected, allLabel: t('list.selectAll'), rowLabel: (r) => t('list.selectRow', { name: `#${r.orderNumber}` }) } : undefined}
          density={list.density}
          onRowClick={(r) => (r.shipment ? list.openSheet(r.shipment.id) : router.push(`/orders/${r.orderId}`))}
          actionsLabel={t('action.actions')}
          rowActions={menu}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => (r.shipment ? list.openSheet(r.shipment.id) : router.push(`/orders/${r.orderId}`))}>
                <div className="flex items-center gap-2">
                  <OrderNumber number={r.orderNumber} className="text-[14px] font-medium" />
                  <span className="truncate text-[13px]">{r.client.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {r.shipment ? (
                    <StatusPill enumKey="Shipment.status" value={r.shipment.status} className="!rounded-[4px]">
                      {t(`enum.Shipment.status.${r.shipment.status}`)}
                    </StatusPill>
                  ) : (
                    <StatusPill enumKey="Order.deliveryStatus" value="not_sent" className="!rounded-[4px]">
                      {t('delivery.row.notSentPill')}
                    </StatusPill>
                  )}
                  <span className="ts-label-micro text-text-muted">{lastEvent(r).title}</span>
                </div>
              </button>
              {menu(r)}
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total} onChange={(p) => list.set(p)} note={t('delivery.sortNote')} />}
        />
      )}

      <DeliveryFilterPanel open={panel} onClose={() => setPanel(false)} list={list} total={rowsQ.data ? total : null} />
      <TrackingPanel
        shipmentId={s.sheet}
        onClose={() => list.openSheet(null)}
        parcels={parcels}
        nav={(() => {
          const ids = rows.filter((r) => r.shipment).map((r) => r.shipment!.id);
          const i = s.sheet ? ids.indexOf(s.sheet) : -1;
          if (i < 0) return undefined;
          return {
            onPrev: i > 0 ? () => list.openSheet(ids[i - 1]!) : undefined,
            onNext: i < ids.length - 1 ? () => list.openSheet(ids[i + 1]!) : undefined,
            position: `${i + 1} / ${ids.length}`,
            prevLabel: t('clients.sheet.prev'),
            nextLabel: t('clients.sheet.next'),
          };
        })()}
      />
      <BulkSendDialog open={dialog === 'send'} orders={sendTargets} onClose={() => setDialog(null)} onFinished={() => setSelected(new Set())} />
      <ConfirmDialog
        open={confirmManual}
        onOpenChange={setConfirmManual}
        title={t('delivery.bulk.manualConfirm.title', { count: manualIds.length })}
        description={[t('delivery.bulk.manualConfirm.description'), chosen.length > manualIds.length ? t('delivery.bulk.manualConfirm.skipped', { count: chosen.length - manualIds.length }) : null].filter(Boolean).join(' ')}
        confirmLabel={t('delivery.bulk.shipManual')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        onConfirm={() => void shipManual()}
      />
      <BulkSendResults
        jobId={bulkJob}
        open={!!bulkJob}
        title={t('send.bulk.resultTitle')}
        names={{}}
        courierName={null}
        // the failed orders are listed in "À envoyer" (filtered on them) to be sent again
        onRetry={(ids) => withoutJob(patchListState(s, { tab: 'to_send', filters: { ids } }))}
        onClose={() => withoutJob()}
      />
      <PrintLabelsDialog open={dialog === 'labels'} orders={chosen.map((r) => ({ id: r.orderId, label: `#${r.orderNumber} · ${r.client.name}`, sent: !!r.shipment?.trackingNumber && r.shipment.status !== 'cancelled' }))} onClose={() => setDialog(null)} />
      {parcels.element}
    </div>
  );
}

/* ---------- chips under the bar ---------- */
function DeliveryActiveFilters({ list }: { list: ListController }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const s = list.state;
  const w = useGeoWilayas();
  const couriers = useCouriers(filterList(s, 'courierAccountId').length > 0);
  const dict = (values: readonly string[], key: (v: string) => string) => Object.fromEntries(values.map((v) => [v, key(v)]));
  const day = (d: string) => (d ? formatDate(`${d}T12:00:00Z`, locale) : '…');
  const chips = deliveryChips(s, {
    search: (q) => t('orders.chip.search', { q }),
    status: dict(SHIPMENT_FILTER_STATUSES, (v) => t(`delivery.filter.status.${v}`)),
    provider: dict([...COURIER_PROVIDERS, 'manual'], (v) => t(`couriers.provider.${v}`)),
    courier: (id) => couriers.data?.find((c) => c.id === id)?.displayName ?? '…',
    deliveryType: { home: t('common.home'), stopdesk: t('common.stopdesk') },
    wilaya: (names) => t('orders.chip.wilaya', { names }),
    wilayaName: (id) => {
      const x = w.data?.find((y) => String(y.id) === id);
      return x ? wilayaLabel(x, locale) : id;
    },
    orderStatus: dict(['confirmed', 'preparing', 'shipped', 'delivered', 'returned', 'cancelled'], (v) => t(`enum.Order.status.${v}`)),
    lastEvent: dict(LAST_EVENTS, (v) => t(`delivery.filter.lastEvent.${v}`)),
    failureReason: dict(FAILURE_REASONS, (v) => t(`enum.Shipment.failureReason.${v}`)),
    lastError: (code) => t(`delivery.lastError.${code}`),
    range: (from, to) => t('orders.chip.range', { from: day(from), to: day(to) }),
    ids: (n) => t('orders.chip.ids', { count: n }),
  });
  return (
    <ActiveFilters
      label={t('list.activeFilters')}
      items={chips.map((c) => ({
        key: c.key,
        label: c.label,
        onRemove: () => {
          if (c.clear === 'q') return list.set({ q: '' });
          const [name, value] = c.key.split(':');
          if (value && name) return list.setFilter(name, filterList(list.state, name).filter((v) => v !== value));
          list.setFilters(c.clear);
        },
      }))}
      clearLabel={t('action.clearAll')}
      onClear={chips.length > 1 ? () => clearPanel(list) : undefined}
      removeLabel={(label) => t('list.removeFilter', { label })}
    />
  );
}

/* ---------- panel (MECH "Livraison & suivi — filtres (modèle Shipment ⟷ Order)") ---------- */
function DeliveryFilterPanel({ open, onClose, list, total }: { open: boolean; onClose: () => void; list: ListController; total: number | null }) {
  const t = useT();
  const locale = useLocaleCode();
  const s = list.state;
  const w = useGeoWilayas();
  const couriers = useCouriers(open);
  const opts = (values: readonly string[], key: (v: string) => string): FilterOption[] => values.map((v) => ({ value: v, label: key(v) }));
  const wilayas: FilterOption[] = (w.data ?? []).map((x) => ({ value: String(x.id), label: wilayaLabel(x, locale) }));
  const count = panelFilterCount(s);
  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('action.filters')}
      summary={total === null ? t('orders.filter.summaryLoading', { count }) : t('orders.filter.summary', { count, results: formatNumber(total) })}
      resetLabel={t('products.filter.reset')}
      onReset={() => clearPanel(list)}
      applyLabel={total === null ? t('action.apply') : t('orders.filter.show', { count: total })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('delivery.filter.status')} source="Shipment.status · null = non envoyée">
        <FilterChips label={t('delivery.filter.status')} multiple options={opts(SHIPMENT_FILTER_STATUSES, (v) => t(`delivery.filter.status.${v}`))} value={filterList(s, 'shipmentStatus')} onChange={(v) => list.setFilter('shipmentStatus', v)} />
      </FilterGroup>
      <FilterGroup label={t('common.courier')} source="Shipment.provider · courierAccountId">
        <FilterChips label={t('common.courier')} multiple options={opts([...COURIER_PROVIDERS, 'manual'], (v) => t(`couriers.provider.${v}`))} value={filterList(s, 'provider')} onChange={(v) => list.setFilter('provider', v)} />
        {couriers.data && couriers.data.length > 1 ? <FilterCheckList options={couriers.data.map((c) => ({ value: c.id, label: c.displayName }))} value={filterList(s, 'courierAccountId')} onChange={(v) => list.setFilter('courierAccountId', v)} /> : null}
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.mode')} source="Order.deliveryType (home · stopdesk)">
        <FilterChips
          label={t('delivery.filter.mode')}
          options={[
            { value: 'home', label: t('common.home') },
            { value: 'stopdesk', label: t('common.stopdesk') },
          ]}
          value={filterText(s, 'deliveryType') ? [filterText(s, 'deliveryType')] : []}
          onChange={(v) => list.setFilter('deliveryType', v[0] ?? null)}
        />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.wilaya')} source="Order.wilayaId → Wilaya">
        <FilterCheckList options={wilayas} value={filterList(s, 'wilayaId')} onChange={(v) => list.setFilter('wilayaId', v)} searchPlaceholder={t('orders.filter.wilayaSearch')} emptyLabel={t('geo.empty')} maxHeight={160} />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.orderStatus')} source="Order.status">
        <FilterChips label={t('delivery.filter.orderStatus')} multiple options={opts(['confirmed', 'preparing', 'shipped', 'delivered', 'returned'], (v) => t(`enum.Order.status.${v}`))} value={filterList(s, 'orderStatus')} onChange={(v) => list.setFilter('orderStatus', v)} />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.lastEvent')} source="ShipmentEvent.createdAt">
        <FilterChips label={t('delivery.filter.lastEvent')} options={opts(LAST_EVENTS, (v) => t(`delivery.filter.lastEvent.${v}`))} value={filterText(s, 'lastEvent') ? [filterText(s, 'lastEvent')] : []} onChange={(v) => list.setFilter('lastEvent', v[0] ?? null)} />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.failureReason')} source="Shipment.failureReason">
        <FilterChips label={t('delivery.filter.failureReason')} multiple options={opts(FAILURE_REASONS, (v) => t(`enum.Shipment.failureReason.${v}`))} value={filterList(s, 'failureReason')} onChange={(v) => list.setFilter('failureReason', v)} />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.lastError')} source="Shipment.lastError">
        <FilterCheckList options={LAST_ERRORS.map((c) => ({ value: c, label: t(`delivery.lastError.${c}`) }))} value={filterList(s, 'lastError')} onChange={(v) => list.setFilter('lastError', v)} />
      </FilterGroup>
      <FilterGroup label={t('delivery.filter.period')} source="Shipment.createdAt · Order.confirmedAt">
        <FilterDateRange from={filterText(s, 'from')} to={filterText(s, 'to')} onChange={(r) => list.setFilters({ from: r.from || null, to: r.to || null })} labels={{ from: t('common.from'), to: t('common.to'), presets: t('common.date') }} />
      </FilterGroup>
    </FilterPanel>
  );
}
