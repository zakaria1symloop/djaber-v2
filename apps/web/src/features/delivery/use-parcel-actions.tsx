'use client';
// Row / panel `Actions ⌄` of a delivery row or a parcel (Figma "MECH — Delivery filters + row menu + bulk send results",
// "DLV-08 — … tracking panel"): items = the server descriptors (`DeliveryRowView.actions`, `ShipmentView.actions`) in
// the MECH menu order, primary first, greyed with their code. Parcel dialogs are hosted here; the order dialogs
// (send DLV-05, self-delivery, address) come from `useOrderActions` and read the full order.
import { formatPhoneDz, type ShipmentErrorView } from '@djaber/shared';
import { toast, type MenuAction } from '@djaber/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { refusal } from '@/features/orders/dialogs/common';
import { useOrderActions } from '@/features/orders/use-order-actions';
import { useRouter } from '@/i18n/navigation';
import { toMenuActions, type ActionHandler } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { SHIPMENT_ACTION } from './action-keys';
import { deliveryApi, useDeliveryRefresh } from './api';
import type { DeliveryRow, Shipment } from './contracts';
import { LabelViewer } from './labels';
import { waitLabel } from './logic';
import { CancelParcelDialog, ChangeCourierDialog, MarkFailedDialog, ParcelDeliveredDialog, ParcelReturnedDialog, RetryDeliveryDialog, type ParcelRef } from './shipment-dialogs';

type ParcelDialog = 'cancel' | 'change_courier' | 'mark_failed' | 'retry_delivery' | 'deliver' | 'return' | 'label';

/** The parcel part of a delivery row (null when the order has no parcel yet). */
export function parcelOfRow(r: DeliveryRow): ParcelRef | null {
  const s = r.shipment;
  if (!s) return null;
  return {
    id: s.id,
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    clientName: r.client.name,
    courierName: s.courierAccount?.displayName ?? null,
    trackingNumber: s.trackingNumber,
    courierAccountId: s.courierAccount?.id ?? null,
    provider: s.provider,
    codAmount: s.codAmount,
    total: r.total,
    deliveryAttempts: s.deliveryAttempts,
  };
}
export function parcelOfShipment(s: Shipment, total?: number): ParcelRef {
  return {
    id: s.id,
    orderId: s.orderId,
    orderNumber: s.orderNumber,
    clientName: s.client.name,
    courierName: s.courierAccount?.displayName ?? null,
    trackingNumber: s.trackingNumber,
    courierAccountId: s.courierAccount?.id ?? null,
    provider: s.provider,
    codAmount: s.codAmount,
    total: total ?? s.codAmount,
    deliveryAttempts: s.deliveryAttempts,
  };
}

/** Subject of a menu: an order id, its parcel (if any), the descriptors, the phone to call and the courier error. */
export type ParcelSubject = { orderId: string; parcel: ParcelRef | null; actions: DeliveryRow['actions']; phone?: string | null; error?: ShipmentErrorView | null; portalUrl?: string | null };

export function useParcelActions(o: { onTrack?: (shipmentId: string) => void } = {}) {
  const t = useT();
  const router = useRouter();
  const refresh = useDeliveryRefresh();
  const orders = useOrderActions();
  const [dialog, setDialog] = useState<{ kind: ParcelDialog; parcel: ParcelRef } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  /** "Actualiser le suivi": 1 / 5 min / parcel (`429 TRACKING_SYNC_RATE_LIMITED {retryAfter}`). */
  const sync = useCallback(
    async (p: ParcelRef): Promise<{ ok: boolean; code?: string; retryAfter?: number; shipment?: Shipment }> => {
      setSyncing(p.id);
      try {
        const s = await deliveryApi.sync(p.id);
        await refresh({ shipment: s });
        return { ok: true, shipment: s };
      } catch (e) {
        if (e instanceof ApiError) {
          const retryAfter = Number(e.body.params.retryAfter) || undefined;
          return { ok: false, code: e.code, retryAfter };
        }
        return { ok: false, code: 'NETWORK' };
      } finally {
        setSyncing(null);
      }
    },
    [refresh],
  );
  const syncWithToast = useCallback(
    async (p: ParcelRef) => {
      const r = await sync(p);
      if (r.ok) toast(t('tracking.sync.done', { number: p.orderNumber }));
      else if (r.code === 'TRACKING_SYNC_RATE_LIMITED') toast({ tone: 'warning', message: t('error.TRACKING_SYNC_RATE_LIMITED', { retryAfter: waitLabel(r.retryAfter ?? 300) }) });
      else toast({ tone: 'danger', message: r.code && t.has(`error.${r.code}`) ? t(`error.${r.code}`, { message: '', retryAfter: '' }) : t('toast.noConnection') });
    },
    [sync, t],
  );
  const retrySend = useCallback(
    async (p: ParcelRef) => {
      try {
        const s = await deliveryApi.retry(p.id);
        await refresh({ shipment: s });
        toast(t('parcel.retry.done', { number: p.orderNumber }));
      } catch (e) {
        toast({ tone: 'danger', message: refusal(e, t) });
      }
    },
    [refresh, t],
  );

  const menu = useCallback(
    (s: ParcelSubject, opt: { inPanel?: boolean } = {}): MenuAction[] => {
      const p = s.parcel;
      const open = (kind: ParcelDialog) => p && setDialog({ kind, parcel: p });
      const handlers: Record<string, ActionHandler> = {
        track: { label: t('parcel.menu.track'), onSelect: () => p && o.onTrack?.(p.id), hint: t('parcel.menu.hint.track'), local: true, hidden: !p || opt.inPanel || !o.onTrack },
        [SHIPMENT_ACTION.send]: { label: t('action.sendToCourier'), onSelect: () => orders.openOn('send', s.orderId), hint: t('parcel.menu.hint.dlv05') },
        // "Corriger et renvoyer": DLV-05 with the courier error first
        [SHIPMENT_ACTION.retry]: { label: t('parcel.menu.fixResend'), onSelect: () => (s.error && s.error.code !== 'COURIER_UNAVAILABLE' ? orders.openOn('send', s.orderId, { error: s.error }) : p && void retrySend(p)), hint: t('parcel.menu.hint.dlv05') },
        [SHIPMENT_ACTION.retryDelivery]: { label: t('parcel.menu.retryDelivery'), onSelect: () => open('retry_delivery'), hint: t('parcel.menu.hint.retryDelivery') },
        [SHIPMENT_ACTION.sync]: { label: t('parcel.menu.sync'), onSelect: () => p && void syncWithToast(p), hint: t('parcel.menu.hint.sync') },
        [SHIPMENT_ACTION.label]: { label: t('parcel.menu.label'), onSelect: () => open('label'), hint: t('parcel.menu.hint.label') },
        [SHIPMENT_ACTION.shipManual]: { label: t('parcel.menu.shipManual'), onSelect: () => orders.openOn('ship', s.orderId), hint: t('parcel.menu.hint.manual') },
        [SHIPMENT_ACTION.editAddress]: { label: t('orders.menu.address'), onSelect: () => orders.openOn('address', s.orderId), hint: t('parcel.menu.hint.address') },
        [SHIPMENT_ACTION.changeCourier]: { label: t('parcel.menu.changeCourier'), onSelect: () => open('change_courier'), hint: t('parcel.menu.hint.changeCourier') },
        [SHIPMENT_ACTION.markFailed]: { label: t('parcel.menu.markFailed'), onSelect: () => open('mark_failed') },
        [SHIPMENT_ACTION.markDelivered]: { label: t('dialog.markDelivered.title'), onSelect: () => open('deliver'), hint: t('orders.menu.hint.cod') },
        [SHIPMENT_ACTION.markReturned]: { label: t('action.markReturned'), onSelect: () => open('return'), hint: t('parcel.menu.hint.return') },
        [SHIPMENT_ACTION.callClient]: { label: s.phone ? t('parcel.menu.call', { phone: formatPhoneDz(s.phone) }) : t('parcel.menu.callClient'), onSelect: () => s.phone && window.open(`tel:${s.phone}`, '_self'), hidden: !s.phone },
        portal: { label: t('parcel.menu.portal'), onSelect: () => s.portalUrl && window.open(s.portalUrl, '_blank', 'noopener'), local: true, hidden: !s.portalUrl, hint: '↗' },
        [SHIPMENT_ACTION.openOrder]: { label: t('parcel.menu.openOrder'), onSelect: () => router.push(`/orders/${s.orderId}`), hint: t('parcel.menu.hint.order'), separated: true },
        [SHIPMENT_ACTION.cancel]: { label: t('parcel.menu.cancel'), onSelect: () => open('cancel'), destructive: true, separated: true, hint: t('parcel.menu.hint.cancel') },
      };
      return toMenuActions(s.actions, handlers, t);
    },
    [orders, o, t, router, retrySend, syncWithToast],
  );

  const close = () => setDialog(null);
  const done = async (s?: Shipment | null) => {
    await refresh(s ? { shipment: s } : { orderId: dialog?.parcel.orderId });
  };
  const base = dialog ? { parcel: dialog.parcel, onClose: close, onDone: done } : null;
  const element: ReactNode = (
    <>
      {orders.element}
      {base ? (
        <>
          <CancelParcelDialog {...base} open={dialog?.kind === 'cancel'} />
          <ChangeCourierDialog {...base} open={dialog?.kind === 'change_courier'} />
          <MarkFailedDialog {...base} open={dialog?.kind === 'mark_failed'} />
          <RetryDeliveryDialog {...base} open={dialog?.kind === 'retry_delivery'} />
          <ParcelDeliveredDialog {...base} open={dialog?.kind === 'deliver'} />
          <ParcelReturnedDialog {...base} open={dialog?.kind === 'return'} />
        </>
      ) : null}
      <LabelViewer
        open={dialog?.kind === 'label'}
        shipmentId={dialog?.kind === 'label' ? dialog.parcel.id : null}
        manual={dialog?.parcel.provider === 'manual'}
        title={dialog ? [`#${dialog.parcel.orderNumber}`, dialog.parcel.courierName, dialog.parcel.trackingNumber].filter(Boolean).join(' · ') : ''}
        onClose={close}
      />
    </>
  );
  return { menu, element, sync, syncWithToast, syncing, openDialog: (kind: ParcelDialog, parcel: ParcelRef) => setDialog({ kind, parcel }), orders };
}
