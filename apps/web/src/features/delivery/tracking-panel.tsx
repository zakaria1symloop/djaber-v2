'use client';
// Tracking side panel of /delivery (Figma "DLV-08 — Delivery — overview + tracking panel"): "#CMD-1037 · ZR-0092290",
// last sync + "Actualiser" (actualisation… / à jour / limite 1 / 5 min `TRACKING_SYNC_RATE_LIMITED` / `TRACKING_NOT_FOUND`
// / `COURIER_UNAVAILABLE`), timeline (source courier / Djaber member), the parcel actions, and the alternative panels
// Annulée / Livrée ✓ (COD encaissé) / Retournée (stock réintégré). Opened from a row (`?sheet=<shipmentId>`).
import { formatDate, formatMoney, formatPhoneDz, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Banner, Button, Ltr, Pill, SideSheet, Skeleton, StatusPill, toast, TrackingSyncBar, TrackingTimeline, type SheetNav, type SyncState, type TrackingStep } from '@djaber/ui';
import { useEffect, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { newestFirst, shortName } from '@/features/orders/logic';
import { useCountdown } from '@/lib/countdown';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { actionState } from '@/lib/actions';
import { SHIPMENT_ACTION } from './action-keys';
import { useShipment } from './api';
import type { Shipment } from './contracts';
import { algiersClock, shipmentTone, waitLabel } from './logic';
import { parcelOfShipment, type useParcelActions } from './use-parcel-actions';

const MAX_ATTEMPTS = 3;

export function TrackingPanel({ shipmentId, onClose, nav, parcels }: { shipmentId: string | null; onClose: () => void; nav?: SheetNav; parcels: ReturnType<typeof useParcelActions> }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useShipment(shipmentId);
  const s = q.data && q.data.id === shipmentId ? q.data : null;
  const [sync, setSync] = useState<{ state: SyncState; message?: string; until?: number; since?: number } | null>(null);
  useEffect(() => setSync(null), [shipmentId]);
  // the refresh is queued (202): "Actualisation…" until the courier answer lands (WS `shipment.updated`, polled too)
  useEffect(() => {
    if (sync?.state !== 'syncing' || !sync.since) return;
    if (s?.lastSyncedAt && Date.parse(s.lastSyncedAt) >= sync.since - 2_000) return setSync({ state: 'fresh', message: t('tracking.sync.fresh'), until: sync.until });
    const poll = setInterval(() => void q.refetch(), 2_000);
    const stop = setTimeout(() => setSync({ state: 'fresh', message: t('tracking.sync.requested'), until: sync.until }), 30_000);
    return () => (clearInterval(poll), clearTimeout(stop));
  }, [sync, s?.lastSyncedAt, q, t]);
  const until = sync?.until ?? (s?.syncAvailableAt ? Date.parse(s.syncAvailableAt) : null);
  const wait = useCountdown(until && until > Date.now() ? until : null);

  const refresh = async (x: Shipment) => {
    setSync({ state: 'syncing' });
    const r = await parcels.sync(parcelOfShipment(x));
    if (r.ok) setSync({ state: 'syncing', since: Date.now(), until: r.shipment?.syncAvailableAt ? Date.parse(r.shipment.syncAvailableAt) : Date.now() + 300_000 });
    else if (r.code === 'TRACKING_SYNC_RATE_LIMITED') setSync({ state: 'limited', until: Date.now() + (r.retryAfter ?? 300) * 1000 });
    else if (r.code === 'TRACKING_NOT_FOUND') setSync({ state: 'not_found', message: t('error.TRACKING_NOT_FOUND') });
    else if (r.code === 'COURIER_UNAVAILABLE') setSync({ state: 'unavailable', message: t('tracking.sync.unavailable') });
    else setSync({ state: 'unavailable', message: r.code && t.has(`error.${r.code}`) ? t(`error.${r.code}`, { message: '', retryAfter: '' }) : t('toast.noConnection') });
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('toast.copied'));
    } catch {
      toast({ tone: 'warning', message: url });
    }
  };

  const title = s ? [`#${s.orderNumber}`, s.trackingNumber].filter(Boolean).join(' · ') : t('common.loading');
  const syncAction = s ? actionState(s.actions, SHIPMENT_ACTION.sync, t) : null;
  const limited = wait > 0;
  const state: SyncState = sync?.state === 'syncing' ? 'syncing' : limited && sync?.state !== 'fresh' && sync?.state !== 'not_found' && sync?.state !== 'unavailable' ? 'limited' : (sync?.state ?? 'idle');
  const message =
    state === 'limited'
      ? t('error.TRACKING_SYNC_RATE_LIMITED', { retryAfter: waitLabel(wait) })
      : state === 'fresh'
        ? limited
          ? `${t('tracking.sync.fresh')} · ${t('tracking.sync.next', { wait: waitLabel(wait) })}`
          : t('tracking.sync.fresh')
        : sync?.message;

  const events: TrackingStep[] = s
    ? newestFirst(s.events, (e) => e.at).map((e, i) => {
        const source = e.source === 'manual' || e.source === 'system' ? [t('tracking.source.djaber'), e.actor ? shortName(e.actor) : null].filter(Boolean).join(' · ') : (s.courierAccount?.displayName ?? t(`couriers.provider.${s.provider}`));
        return {
          key: `${e.at}-${i}`,
          title: [e.mappedStatus ? t(`tracking.event.${e.mappedStatus}`) : e.rawStatus, e.description && e.description !== e.rawStatus ? e.description : null, e.location].filter(Boolean).join(' · '),
          meta: `${formatDate(e.at, locale).replace(/ \d{4}$/, '')} ${algiersClock(e.at)} · ${source}`.toUpperCase(),
          tone: i === 0 ? shipmentTone(e.mappedStatus) : undefined,
        };
      })
    : [];
  const phone = s?.client.phone ?? null;
  const menu = s ? parcels.menu({ orderId: s.orderId, parcel: parcelOfShipment(s), actions: s.actions, phone, error: s.error, portalUrl: s.portalUrl }, { inPanel: true }) : [];
  // the panel buttons of DLV-08: the first enabled items of the menu (primary first), the rest stays in "Actions ⌄"
  const buttons = menu.filter((a) => !a.disabledReason && !a.destructive && a.key !== SHIPMENT_ACTION.sync).slice(0, 5);

  return (
    <SideSheet
      open={!!shipmentId}
      onClose={onClose}
      title={title}
      subtitle={s ? [s.courierAccount?.displayName ?? t(`couriers.provider.${s.provider}`), t(`enum.Shipment.status.${s.status}`)].join(' · ') : undefined}
      nav={nav}
      width={460}
      closeLabel={t('action.close')}
      headerAction={s ? <ActionsMenu label={t('action.actions')} heading={title} actions={menu} /> : undefined}
    >
      <div className="flex flex-col gap-5" data-testid="tracking-panel" data-status={s?.status ?? 'loading'}>
        {q.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.isError || !s ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            {s.status === 'cancelled' ? (
              <Banner tone="info">{t('tracking.panel.cancelled', { date: s.events[0] ? formatDate(newestFirst(s.events, (e) => e.at)[0]!.at, locale) : '' })}</Banner>
            ) : s.status === 'delivered' ? (
              <div className="rounded-card border border-accent-money/40 px-3 py-2.5 text-[13px] text-accent-money" data-testid="panel-delivered">
                {t('tracking.panel.delivered', { amount: formatMoney(s.codAmount) })}
              </div>
            ) : s.status === 'returned' ? (
              <div className="rounded-card border border-accent-alert/40 px-3 py-2.5 text-[13px] text-accent-alert" data-testid="panel-returned">
                {s.returnPending ? t('tracking.panel.returnPending') : t('tracking.panel.returned')}
              </div>
            ) : s.status === 'stale' ? (
              <Banner tone="warning">{t('tracking.panel.stale')}</Banner>
            ) : null}

            {s.status === 'failed' && s.failureHandled ? (
              // UX-064: the order was delivered by hand / cancelled / returned meanwhile — the failure is settled
              <div className="flex flex-col gap-1 rounded-card border border-line-hairline p-3" data-testid="panel-handled">
                <Pill tone="neutral" className="!rounded-[4px] self-start">
                  {t(`parcel.handled.pill.${s.failureHandled}`)}
                </Pill>
                <p className="text-[13px] text-text-secondary">{t(`parcel.handled.${s.failureHandled}`)}</p>
                {s.error ? <p className="ts-label-micro !normal-case text-text-muted">{s.error.message ?? t(`error.${s.error.code}`, { message: '' })}</p> : null}
              </div>
            ) : s.status === 'failed' ? (
              <div className="flex flex-col gap-2 rounded-card border border-accent-alert/40 p-3" data-testid="panel-failed">
                <div className="flex flex-wrap items-center gap-2">
                  {s.failureReason ? (
                    <StatusPill enumKey="Shipment.failureReason" value={s.failureReason} className="!rounded-[4px]">
                      {t(`enum.Shipment.failureReason.${s.failureReason}`)}
                    </StatusPill>
                  ) : (
                    <Pill tone="danger" className="!rounded-[4px]">
                      {t('enum.Shipment.status.failed')}
                    </Pill>
                  )}
                  {s.deliveryAttempts > 0 ? <span className="ts-label-micro text-text-muted">{t('delivery.row.attempt', { n: s.deliveryAttempts, max: MAX_ATTEMPTS })}</span> : null}
                </div>
                {s.error ? <p className="text-[13px] text-accent-alert">{`${s.error.message ?? t(`error.${s.error.code}`, { message: '' })}`}</p> : null}
                {s.deliveryAttempts >= MAX_ATTEMPTS ? <p className="ts-label-micro !normal-case text-accent-starred">{t('tracking.panel.proposeReturn', { max: MAX_ATTEMPTS })}</p> : null}
              </div>
            ) : null}

            {s.trackingNumber && s.status !== 'cancelled' && s.provider !== 'manual' ? (
              <TrackingSyncBar
                lastSync={s.lastSyncedAt ? t('tracking.sync.last', { ago: relativeTime(s.lastSyncedAt, locale) }) : t('tracking.sync.never')}
                state={state}
                onRefresh={syncAction?.present ? () => void refresh(s) : undefined}
                refreshLabel={t('tracking.sync.refresh')}
                syncingLabel={t('tracking.sync.syncing')}
                message={message}
                disabledReason={syncAction && !syncAction.enabled ? syncAction.reason : limited ? t('tracking.sync.limit') : undefined}
              />
            ) : null}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="ts-label-micro self-center text-text-muted">{t('common.client')}</dt>
              <dd className="min-w-0 truncate">
                {s.client.name}
                {phone ? (
                  <>
                    {' · '}
                    <Ltr className="!inline">{formatPhoneDz(phone)}</Ltr>
                  </>
                ) : null}
              </dd>
              <dt className="ts-label-micro self-center text-text-muted">{t('common.address')}</dt>
              <dd className="min-w-0">{[s.address.wilayaName, s.address.communeText, s.address.isStopdesk ? (s.address.stopdeskName ?? t('common.stopdesk')) : s.address.address].filter(Boolean).join(' · ')}</dd>
              <dt className="ts-label-micro self-center text-text-muted">{t('tracking.panel.cod')}</dt>
              <dd>
                <Ltr className="!inline">{formatMoney(s.codAmount)}</Ltr>
              </dd>
              {/* recette 09/11 M-15: the public page (/s/<token>) was only printed on the slip — copied or opened from here */}
              {s.publicTrackingUrl && s.status !== 'cancelled' ? (
                <>
                  <dt className="ts-label-micro self-center text-text-muted">{t('tracking.panel.publicLink')}</dt>
                  <dd className="flex min-w-0 flex-wrap items-center gap-2" data-testid="panel-public-link">
                    <Ltr className="!inline min-w-0 truncate text-text-secondary">{s.publicTrackingUrl.replace(/^https?:\/\//, '')}</Ltr>
                    <Button size="sm" variant="ghost" onClick={() => void copyLink(s.publicTrackingUrl)} data-action="copy-tracking-link">
                      {t('action.copy')}
                    </Button>
                    <a href={s.publicTrackingUrl} target="_blank" rel="noreferrer" className="ts-label-meta text-accent-inbound underline underline-offset-2" data-action="open-tracking-link">
                      {t('tracking.panel.openLink')}
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>

            <section className="flex flex-col gap-3">
              <h3 className="ts-label-section text-text-muted">{t('orders.page.tracking')}</h3>
              <TrackingTimeline items={events} label={t('orders.page.tracking')} empty={t('tracking.panel.noEvents')} />
            </section>

            {buttons.length ? (
              <div className="flex flex-wrap gap-2" data-testid="panel-actions">
                {buttons.map((a) => (
                  <Button key={a.key} onClick={a.onSelect} data-action={a.key}>
                    {a.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </SideSheet>
  );
}
