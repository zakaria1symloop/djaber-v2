'use client';
// LIVRAISON block of the order page (Figma "ORD-06 — Order page — new" delivery block variants, 12 §20): NON ENVOYÉE
// ("Envoyer au transporteur" follows the `send_courier` descriptor, greyed with its reason, e.g. "Disponible une fois la
// commande confirmée") · envoi… (parcel `pending`; queued while the courier is down) · envoyée + suivi (timeline,
// Actualiser, bordereau, annuler le colis) · échec + actions · échec réglé (UX-064: the order was delivered by hand /
// cancelled / returned meanwhile — no send button) · retournée. The parcel menu = `ShipmentView.actions`.
import { formatDate, formatMoney, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Button, DetailRows, FormAlert, Ltr, OrderBlock, Pill, StatusPill, TrackingTimeline, type TrackingStep } from '@djaber/ui';
import { Loader2 } from 'lucide-react';
import type { Order } from '@/features/orders/contracts';
import { ORDER_ACTION } from '@/features/orders/action-keys';
import { newestFirst, shortName } from '@/features/orders/logic';
import { DeliveryPill } from '@/features/orders/ui';
import { actionState } from '@/lib/actions';
import { useCountdown } from '@/lib/countdown';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { SHIPMENT_ACTION } from './action-keys';
import { algiersClock, deliveryBlockState, shipmentTone, waitLabel } from './logic';
import { parcelOfShipment, type useParcelActions } from './use-parcel-actions';

const MAX_ATTEMPTS = 3;

/** The parcel the block shows: the active one, else the latest. */
export const currentShipment = (o: Pick<Order, 'shipments'>) => newestFirst(o.shipments, (s) => s.createdAt).find((s) => s.status !== 'cancelled') ?? newestFirst(o.shipments, (s) => s.createdAt)[0] ?? null;

export function OrderDeliveryBlock({ order, onSend, onShip, parcels }: { order: Order; onSend: () => void; onShip: () => void; parcels: ReturnType<typeof useParcelActions> }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const send = actionState(order.actions, ORDER_ACTION.sendToCourier, t);
  const ship = actionState(order.actions, ORDER_ACTION.shipManual, t);
  const s = currentShipment(order);
  const margin = order.courierCost !== null ? order.total - order.courierCost : null;
  const active = s && s.status !== 'cancelled' ? s : null;
  const sending = active?.status === 'pending';
  const queued = sending && active?.lastError === 'COURIER_UNAVAILABLE';
  const parcel = active ? parcelOfShipment(active, order.total) : null;
  const subject = active ? { orderId: order.id, parcel, actions: active.actions, phone: order.clientPhone, error: active.error, portalUrl: active.portalUrl, syncAvailableAt: active.syncAvailableAt ?? null } : null;
  // UX-056 leftovers: « Actualiser » follows the live wait here too (re-render each second while it lasts)
  const until = subject ? parcels.syncUntil(subject) : null;
  useCountdown(until && until > Date.now() ? until : null);
  const live = subject ? parcels.liveActions(subject) : [];
  const menu = subject ? parcels.menu(subject) : [];
  const label = active ? actionState(live, SHIPMENT_ACTION.label, t) : null;
  const sync = active ? actionState(live, SHIPMENT_ACTION.sync, t) : null;
  const events: TrackingStep[] = active
    ? newestFirst(active.events, (e) => e.at).map((e, i) => ({
        key: `${e.at}-${i}`,
        title: [e.mappedStatus ? t(`tracking.event.${e.mappedStatus}`) : e.rawStatus, e.location].filter(Boolean).join(' · '),
        meta: `${formatDate(e.at, locale).replace(/ \d{4}$/, '')} ${algiersClock(e.at)} · ${e.source === 'manual' || e.source === 'system' ? [t('tracking.source.djaber'), e.actor ? shortName(e.actor) : null].filter(Boolean).join(' · ') : (active.courierAccount?.displayName ?? t(`couriers.provider.${active.provider}`))}`.toUpperCase(),
        tone: i === 0 ? shipmentTone(e.mappedStatus) : undefined,
      }))
    : [];
  const { handled, openFailure, fixable, showSend } = deliveryBlockState(order.status, active);

  return (
    <OrderBlock
      label={t('orders.page.deliveryBlock')}
      end={
        <div className="flex items-center gap-2">
          {handled ? (
            <Pill tone="neutral" className="!rounded-[4px]">
              {t(`parcel.handled.pill.${handled}`)}
            </Pill>
          ) : active ? (
            <StatusPill enumKey="Shipment.status" value={active.status} className="!rounded-[4px]">
              {t(`enum.Shipment.status.${active.status}`)}
            </StatusPill>
          ) : (
            <DeliveryPill row={order} />
          )}
          {menu.length ? <ActionsMenu label={t('action.actions')} heading={[`#${order.number}`, active?.trackingNumber].filter(Boolean).join(' · ')} actions={menu} /> : null}
        </div>
      }
      bodyClassName="flex flex-col gap-3 p-4"
      data-testid="delivery-block"
      data-parcel={active ? (queued ? 'queued' : handled ? 'handled' : active.status) : 'none'}
    >
      <DetailRows
        rows={[
          {
            key: 'courier',
            label: t('common.courier'),
            value: active ? (
              <span>
                {active.courierAccount?.displayName ?? t(`couriers.provider.${active.provider}`)}
                {active.trackingNumber ? (
                  <>
                    {' · '}
                    <span data-testid="tracking-number">
                      <Ltr className="!inline">{active.trackingNumber}</Ltr>
                    </span>
                  </>
                ) : null}
              </span>
            ) : (
              t('orders.page.noParcel')
            ),
          },
          { key: 'fee', label: t('orders.page.clientFee'), value: <span><Ltr className="!inline">{formatMoney(order.deliveryFee)}</Ltr>{order.feeExplanation ? <span className="text-text-muted"> ({order.feeExplanation})</span> : null}</span> },
          ...(order.courierCost !== null ? [{ key: 'cost', label: t('orders.page.courierCost'), value: <span><Ltr className="!inline">{formatMoney(order.courierCost)}</Ltr> · {t('orders.page.margin', { amount: formatMoney(margin ?? 0) })}</span> }] : []),
          ...(order.returnFee ? [{ key: 'returnFee', label: t('orders.page.returnFee'), value: <Ltr className="!inline">{formatMoney(order.returnFee)}</Ltr> }] : []),
          ...(active ? [{ key: 'cod', label: t('tracking.panel.cod'), value: <Ltr className="!inline">{formatMoney(active.codAmount)}</Ltr> }] : []),
        ]}
      />

      {sending ? (
        <p role="status" className="flex items-center gap-2 text-[13px] text-text-secondary" data-testid="parcel-sending">
          {queued ? null : <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {queued ? t('send.queued', { courier: active?.courierAccount?.displayName ?? '' }) : t('send.pending', { courier: active?.courierAccount?.displayName ?? '' })}
        </p>
      ) : null}

      {handled ? (
        <div className="flex flex-col gap-1 rounded-card border border-line-hairline p-3" data-testid="parcel-handled">
          <p className="text-[13px] text-text-secondary">{t(`parcel.handled.${handled}`)}</p>
          {active?.error ? <p className="ts-label-micro !normal-case text-text-muted">{active.error.message ?? t(`error.${active.error.code}`, { message: '' })}</p> : null}
        </div>
      ) : null}
      {openFailure && active ? (
        <div className="flex flex-col gap-1.5 rounded-card border border-accent-alert/40 p-3" data-testid="parcel-failed">
          <div className="flex flex-wrap items-center gap-2">
            {active.failureReason ? (
              <StatusPill enumKey="Shipment.failureReason" value={active.failureReason} className="!rounded-[4px]">
                {t(`enum.Shipment.failureReason.${active.failureReason}`)}
              </StatusPill>
            ) : (
              <Pill tone="danger" className="!rounded-[4px]">
                {fixable ? t('parcel.notCreated') : t('enum.Shipment.status.failed')}
              </Pill>
            )}
            {active.deliveryAttempts > 0 ? <span className="ts-label-micro text-text-muted">{t('delivery.row.attempt', { n: active.deliveryAttempts, max: MAX_ATTEMPTS })}</span> : null}
          </div>
          {active.error ? <p className="text-[13px] text-accent-alert">{`${active.error.message ?? t(`error.${active.error.code}`, { message: '' })}`}</p> : null}
          {fixable ? <p className="ts-label-micro !normal-case text-text-muted">{t('parcel.nothingCreated')}</p> : null}
          {active.deliveryAttempts >= MAX_ATTEMPTS ? <p className="ts-label-micro !normal-case text-accent-starred">{t('tracking.panel.proposeReturn', { max: MAX_ATTEMPTS })}</p> : null}
        </div>
      ) : null}
      {active?.status === 'returned' ? <FormAlert tone="warning">{active.returnPending ? t('tracking.panel.returnPending') : t('tracking.panel.returned')}</FormAlert> : null}
      {active?.status === 'delivered' ? <p className="text-[13px] text-accent-money">{t('tracking.panel.delivered', { amount: formatMoney(active.codAmount) })}</p> : null}

      {/* NON ENVOYÉE (or failed creation): send / self-delivery, greyed with the reason of the descriptor */}
      {showSend && (send.present || ship.present) ? (
        <div className="flex flex-col gap-2">
          {send.present ? (
            <Button className="w-full" variant={send.enabled ? 'primary' : 'secondary'} onClick={fixable && active ? () => parcels.orders.openOn('send', order.id, { error: active.error }) : onSend} disabled={!send.enabled} title={send.reason} data-testid="send-to-courier">
              {fixable ? t('parcel.menu.fixResend') : t('action.sendToCourier')}
            </Button>
          ) : null}
          {ship.present ? (
            <Button className="w-full" variant="ghost" onClick={onShip} disabled={!ship.enabled} title={ship.reason} data-testid="ship-manual">
              {t('parcel.menu.shipManual')}
            </Button>
          ) : null}
          {send.present && !send.enabled ? (
            <p className="ts-label-micro !normal-case text-text-muted" data-testid="send-reason">
              {send.reason ?? t('orders.page.sendHint')}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* sent: tracking line + quick buttons */}
      {active && active.trackingNumber && !['returned', 'cancelled'].includes(active.status) ? (
        <div className="flex flex-wrap items-center gap-2">
          {sync?.present && active.provider !== 'manual' ? (
            <Button size="sm" onClick={() => parcel && void parcels.syncWithToast(parcel)} loading={parcels.syncing === active.id} disabledReason={sync.enabled ? undefined : sync.reason} data-testid="order-sync">
              {t('tracking.sync.refresh')}
            </Button>
          ) : null}
          {label?.present ? (
            <Button size="sm" onClick={() => parcel && parcels.openDialog('label', parcel)} disabledReason={label.enabled ? undefined : label.reason} data-testid="order-label">
              {t('parcel.menu.label')}
            </Button>
          ) : null}
          <span className="ts-label-micro text-text-muted">
            {active.lastSyncedAt ? t('tracking.sync.last', { ago: relativeTime(active.lastSyncedAt, locale) }) : t('tracking.sync.never')}
            {active.syncAvailableAt && Date.parse(active.syncAvailableAt) > Date.now() ? ` · ${t('tracking.sync.next', { wait: waitLabel(Math.ceil((Date.parse(active.syncAvailableAt) - Date.now()) / 1000)) })}` : ''}
          </span>
        </div>
      ) : null}

      {events.length ? (
        <div className="-mx-4 border-t border-line-hairline px-4 pt-3">
          <TrackingTimeline items={events} label={t('orders.page.tracking')} />
        </div>
      ) : null}
    </OrderBlock>
  );
}
