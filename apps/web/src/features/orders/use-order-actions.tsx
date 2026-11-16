'use client';
// Row / page `Actions ⌄` of an order (Figma "ORD-05 v2 — Orders — list", "ORD-05 — Orders — row actions menu"):
// items = the server descriptors in the Figma order, primary first, greyed with their code; navigation items are
// local. Dialogs are opened on the order id (the row has no history / calls, the dialog reads the full order).
import { toast, type MenuAction } from '@djaber/ui';
import { PaymentLinkDialog, RefundDialog } from './dialogs/payment-dialogs';
import { useCallback, useState, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { toMenuActions, type ActionHandler } from '@/lib/actions';
import { useT, type TFunction } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { canTransition } from '@djaber/shared';
import { ORDER_ACTION } from './action-keys';
import { ordersApi, useOrder, useOrdersRefresh } from './api';
import { ORDER_STATUSES, type Order, type OrderListItem, type OrderStatus } from './contracts';
import { AddressDialog } from './dialogs/address-dialog';
import { refusal } from './dialogs/common';
import { ConfirmOrderDialog } from './dialogs/confirm-dialog';
import { AssignDialog, CallbackDialog, CancelOrderDialog, ChangeStatusDialog, DeleteOrderDialog, DeliverDialog, PaymentDialog, ReturnDialog, ShipManualDialog } from './dialogs/order-dialogs';
import { withCourierSetup } from '@/features/delivery/logic';
import { SendToCourierDialog } from '@/features/delivery/send-dialog';
import type { ShipmentErrorView } from '@djaber/shared';

export type OrderDialogKind = 'confirm' | 'log_call' | 'callback' | 'cancel' | 'status' | 'deliver' | 'return' | 'delete' | 'payment' | 'assign' | 'address' | 'ship' | 'send' | 'payment_link' | 'refund';
type OrderLike = Pick<OrderListItem, 'id' | 'number' | 'status' | 'version' | 'actions' | 'conversationId' | 'client' | 'assignee'>;

/** Status targets of "Changer le statut" (04 §1.2), cancellation having its own dialog. */
export const statusTargets = (status: OrderStatus): OrderStatus[] => ORDER_STATUSES.filter((to) => to !== 'cancelled' && canTransition(status, to));

export type OrderMenuOptions = { onPage?: boolean; canManageCouriers?: boolean };
/** Menu items of one order: handlers in the Figma menu order (first = primary after sorting). */
export function orderMenuActions(o: OrderLike, run: (kind: OrderDialogKind | 'confirmDirect' | 'prepare', order: OrderLike) => void, nav: (href: string) => void, t: TFunction, opt: OrderMenuOptions & { canWrite: boolean }): MenuAction[] {
  const handlers: Record<string, ActionHandler> = {
    open: { label: t('action.open'), onSelect: () => nav(`/orders/${o.id}`), hint: t('orders.menu.hint.page'), local: true, hidden: opt.onPage },
    [ORDER_ACTION.call]: { label: t('action.callToConfirm').replace(/^✆\s*/, ''), onSelect: () => run('confirm', o) },
    [ORDER_ACTION.confirm]: { label: t('action.markConfirmed').replace(/^✓\s*/, ''), onSelect: () => run('confirmDirect', o) },
    [ORDER_ACTION.callback]: { label: t('action.scheduleReminder').replace(/^⏰\s*/, ''), onSelect: () => run('callback', o) },
    [ORDER_ACTION.prepare]: { label: t('action.prepare'), onSelect: () => run('prepare', o), hint: t('orders.menu.hint.prepare') },
    [ORDER_ACTION.sendToCourier]: { label: t('action.sendToCourier'), onSelect: () => run('send', o), hint: t('orders.menu.hint.dialog') },
    [ORDER_ACTION.shipManual]: { label: t('orders.menu.shipManual'), onSelect: () => run('ship', o), hint: t('orders.menu.hint.tracking') },
    [ORDER_ACTION.deliver]: { label: t('orders.menu.deliver'), onSelect: () => run('deliver', o), hint: t('orders.menu.hint.cod') },
    [ORDER_ACTION.changeStatus]: { label: t('dialog.changeStatus.title'), onSelect: () => run('status', o) },
    [ORDER_ACTION.return]: { label: t('action.markReturned'), onSelect: () => run('return', o) },
    [ORDER_ACTION.openConversation]: { label: t('action.openConversation').replace(/^💬\s*/, ''), onSelect: () => nav(`/inbox/${o.conversationId}`), hint: t('orders.menu.hint.inbox'), hidden: !o.conversationId },
    [ORDER_ACTION.edit]: { label: t('action.editOrder').replace(/^✎\s*/, ''), onSelect: () => nav(`/orders/${o.id}`), hidden: opt.onPage },
    [ORDER_ACTION.address]: { label: t('orders.menu.address'), onSelect: () => run('address', o), hint: t('orders.menu.hint.dialog') },
    [ORDER_ACTION.assign]: { label: t('action.assignTo'), onSelect: () => run('assign', o) },
    [ORDER_ACTION.logCall]: { label: t('orders.menu.logCall'), onSelect: () => run('log_call', o), hint: t('orders.menu.hint.dialog') },
    [ORDER_ACTION.recordPayment]: { label: t('action.recordPayment'), onSelect: () => run('payment', o), hint: t('orders.menu.hint.dialog') },
    [ORDER_ACTION.paymentLink]: { label: t('action.paymentLink'), onSelect: () => run('payment_link', o), hint: t('orders.menu.hint.dialog') },
    [ORDER_ACTION.refund]: { label: t('action.refund'), onSelect: () => run('refund', o), hint: t('orders.menu.hint.dialog') },
    print: { label: t('orders.menu.print'), onSelect: () => nav(`/orders/${o.id}/print`), hint: t('orders.menu.hint.pdf'), local: true, separated: true },
    client: { label: t('orders.menu.client', { count: o.client.orderCount }), onSelect: () => nav(`/clients?sheet=${o.client.id}`), hint: t('orders.menu.hint.clients'), local: true },
    [ORDER_ACTION.duplicate]: { label: t('orders.menu.duplicate'), onSelect: () => nav(`/orders/new?duplicate=${o.id}`), hint: t('orders.menu.hint.duplicate'), local: true, hidden: !opt.canWrite },
    [ORDER_ACTION.cancel]: { label: t('action.cancelOrder').replace(/^✕\s*/, ''), onSelect: () => run('cancel', o), destructive: true, separated: true },
    [ORDER_ACTION.delete]: { label: t('action.delete'), onSelect: () => run('delete', o), destructive: true },
  };
  return toMenuActions(withCourierSetup(o.actions, !!opt.canManageCouriers), handlers, t);
}

/**
 * Dialog host + quick actions of the order screens. `open(kind, order)` loads the full order (cache first) and shows
 * the dialog; `confirmDirect` / `prepare` post the status at once (Idempotency-Key, version of the row).
 */
export function useOrderActions(o: { onDeleted?: () => void; onChanged?: (orderId?: string) => unknown } = {}) {
  const t = useT();
  const router = useRouter();
  const { can } = useSession();
  const refresh = useOrdersRefresh();
  const [state, setState] = useState<{ kind: OrderDialogKind; id: string; after?: OrderDialogKind; error?: ShipmentErrorView | null } | null>(null);
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const q = useOrder(state?.id);
  const order = q.data && state && q.data.id === state.id ? q.data : null;

  const quickStatus = useCallback(
    async (row: OrderLike, to: OrderStatus) => {
      try {
        const r = await ordersApi.status(row.id, { to, version: row.version }, uuid());
        await refresh({ order: r });
        toast(to === 'confirmed' ? t('toast.order.confirmed', { number: row.number }) : t('orders.status.done', { number: row.number, status: t(`enum.Order.status.${to}`) }));
      } catch (e) {
        toast({ tone: 'danger', message: refusal(e, t) });
        void refresh({ orderId: row.id });
      }
    },
    [refresh, t],
  );

  const run = useCallback(
    (kind: OrderDialogKind | 'confirmDirect' | 'prepare', row: OrderLike, extra?: { error?: ShipmentErrorView | null }) => {
      if (kind === 'confirmDirect') return void quickStatus(row, 'confirmed');
      if (kind === 'prepare') return void quickStatus(row, 'preparing');
      if (kind === 'assign') return setAssignIds([row.id]);
      setState({ kind, id: row.id, error: extra?.error ?? null });
    },
    [quickStatus],
  );
  /** Dialogs opened from another screen (delivery overview, tracking panel) on an order id only. */
  const openOn = useCallback((kind: OrderDialogKind, orderId: string, extra?: { error?: ShipmentErrorView | null }) => setState({ kind, id: orderId, error: extra?.error ?? null }), []);
  const menu = useCallback((row: OrderLike, opt: OrderMenuOptions = {}) => orderMenuActions(row, run, (href) => router.push(href), t, { ...opt, canWrite: can('orders.write'), canManageCouriers: can('delivery.manage') }), [run, router, t, can]);

  const close = () => setState((s) => (s?.after ? { kind: s.after, id: s.id } : null));
  const done = async (next?: Order | null) => {
    if (next === null && state?.kind === 'delete') {
      await refresh();
      o.onDeleted?.();
      return;
    }
    await refresh(next ? { order: next } : { orderId: state?.id });
    // journey J08-5: a dialog opened from another screen (delivery list) refreshes that screen too
    await o.onChanged?.(next?.id ?? state?.id);
  };
  const is = (k: OrderDialogKind) => state?.kind === k && !!order;
  const base = order ? { order, onClose: close, onDone: done } : null;

  const element: ReactNode = (
    <>
      {base ? (
        <>
          <ConfirmOrderDialog
            {...base}
            open={is('confirm') || is('log_call')}
            mode={state?.kind === 'log_call' ? 'log' : 'confirm'}
            onAddress={() => setState({ kind: 'address', id: base.order.id, after: 'confirm' })}
            onPrepare={(fresh) => {
              setState(null);
              void quickStatus(fresh, 'preparing');
            }}
            onSendToCourier={() => setState({ kind: 'send', id: base.order.id })}
          />
          <CallbackDialog {...base} open={is('callback')} />
          <CancelOrderDialog {...base} open={is('cancel')} />
          <ChangeStatusDialog {...base} open={is('status')} targets={statusTargets(base.order.status)} onReload={() => void q.refetch()} />
          <DeliverDialog {...base} open={is('deliver')} />
          <ReturnDialog {...base} open={is('return')} />
          <DeleteOrderDialog {...base} open={is('delete')} />
          <PaymentDialog {...base} open={is('payment')} />
          <PaymentLinkDialog {...base} open={is('payment_link')} />
          <RefundDialog {...base} open={is('refund')} />
          <AddressDialog {...base} open={is('address')} />
          <ShipManualDialog {...base} open={is('ship')} />
          <SendToCourierDialog {...base} open={is('send')} initialError={state?.error} />
        </>
      ) : null}
      <AssignDialog
        open={!!assignIds}
        ids={assignIds ?? []}
        onClose={() => setAssignIds(null)}
        onDone={async () => {
          await refresh(assignIds?.length === 1 ? { orderId: assignIds[0] } : {});
        }}
      />
    </>
  );
  return { run, openOn, menu, element, loading: !!state && q.isPending, openAssign: setAssignIds };
}
