'use client';
// /orders/[id] — Figma "ORD-06 — Order page — new" + "ORD-07 — Confirm order dialog — outcome step" + the order dialogs
// of the DLG catalogues. Detail states: skeleton (same blocks), 404 / 403 (QueryError), read-only for delivered /
// cancelled / returned (notes stay editable), inline contact edit (leave guard, 409 → Recharger / Écraser, the draft
// is never rebased by a WS refresh), items quantity edit while the server allows `edit`.
import { formatDate, type AppLocale } from '@djaber/shared';
import { ActionsMenu, Banner, Button, buttonClass, Card, Pill, Skeleton, StatusPill, toast } from '@djaber/ui';
import { useEffect, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ConflictDialog, QueryError } from '@/components/global-states';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { conflictOf } from '@/lib/conflict';
import { useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useBack } from '@/lib/back';
import { ORDER_ACTION } from '../action-keys';
import { ordersApi, useOrder, useOrdersRefresh } from '../api';
import type { Order } from '../contracts';
import { refusal } from '../dialogs/common';
import { algiersTime, draftChanged, isReadOnly, orderAnchor, shortName, unansweredCalls } from '../logic';
import { OrderStatusPill } from '../ui';
import { useOrderActions } from '../use-order-actions';
import { OrderDeliveryBlock } from '@/features/delivery/order-block';
import { useParcelActions } from '@/features/delivery/use-parcel-actions';
import { CallsBlock, ClientBlock, contactOf, HistoryBlock, ItemsBlock, itemsOf, NotesBlock, PaymentBlock, type ContactDraft, type ItemsDraft } from './blocks';

function PageSkeleton() {
  const t = useT();
  const block = (h: string, key: string) => (
    <Card key={key} className="p-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className={`mt-3 ${h}`} />
    </Card>
  );
  return (
    <div role="status" aria-label={t('common.loading')} className="grid gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]" data-testid="order-skeleton">
      <div className="flex flex-col gap-5">{[block('h-20', 'client'), block('h-40', 'items'), block('h-28', 'delivery')]}</div>
      <div className="flex flex-col gap-5">{[block('h-40', 'history'), block('h-20', 'calls'), block('h-16', 'notes')]}</div>
    </div>
  );
}

export function OrderPage({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const q = useOrder(id);
  const refresh = useOrdersRefresh();
  const actions = useOrderActions({ onDeleted: () => router.push('/orders') });
  const parcels = useParcelActions();
  const [contact, setContact] = useState<ContactDraft | null>(null);
  const [items, setItems] = useState<ItemsDraft | null>(null);
  const [saving, setSaving] = useState<'contact' | 'items' | null>(null);
  const [error, setError] = useState<{ part: 'contact' | 'items'; message: string } | null>(null);
  const [conflict, setConflict] = useState<{ part: 'contact' | 'items'; c: NonNullable<ReturnType<typeof conflictOf<Order>>> } | null>(null);
  // opening an edit is not a change: the guard arms once the draft differs from the order
  const dirty = draftChanged(contact, q.data ? contactOf(q.data) : null) || draftChanged(items, q.data ? itemsOf(q.data) : null);
  const { guard } = useLeaveGuard(dirty, q.data ? `#${q.data.number}` : '');
  // `/orders/:id#delivery|#payment|#calls` (notifications, Home queue): the block is brought into view once loaded
  const loaded = !!q.data;
  const back = useBack({ href: '/orders', label: t('nav.orders') });
  useEffect(() => {
    if (!loaded) return;
    const anchor = orderAnchor(window.location.hash);
    if (anchor) window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }));
  }, [loaded]);

  if (q.isPending) {
    return (
      <AppPage permission="orders.read" back={back} title={t('common.loading')}>
        <PageSkeleton />
      </AppPage>
    );
  }
  if (q.isError || !q.data) {
    return (
      <AppPage permission="orders.read" back={back} title={t('nav.orders')}>
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}${back.href}`} />
      </AppPage>
    );
  }
  const order = q.data;
  const ro = isReadOnly(order.status);
  const canWrite = can('orders.write');
  const call = actionState(order.actions, ORDER_ACTION.call, t);
  const cancel = actionState(order.actions, ORDER_ACTION.cancel, t);
  const edit = actionState(order.actions, ORDER_ACTION.edit, t);
  const editItems = edit.present && edit.enabled && !ro && order.shipments.length === 0;
  const misses = unansweredCalls(order);
  const creator = order.source.source === 'ai' ? t('orders.history.ai', { name: order.agent?.name ?? order.source.agent?.name ?? '' }) : shortName(order.createdBy ?? order.source.user ?? null) || t('orders.history.system');

  const save = async (part: 'contact' | 'items', version: number) => {
    setSaving(part);
    setError(null);
    try {
      const body =
        part === 'contact'
          ? { version, clientName: contact!.clientName.trim(), clientPhone: contact!.clientPhone.trim(), clientPhone2: contact!.clientPhone2.trim() || null }
          : { version, items: items!.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice })) };
      const next = await ordersApi.update(order.id, body);
      await refresh({ order: next });
      if (part === 'contact') setContact(null);
      else setItems(null);
      toast(t('toast.saved'));
    } catch (e) {
      const c = conflictOf<Order>(e);
      if (c) setConflict({ part, c });
      else setError({ part, message: refusal(e, t) });
    } finally {
      setSaving(null);
    }
  };

  const subtitle = (
    <span>
      {t('orders.page.created', { date: formatDate(order.orderedAt, locale), time: algiersTime(order.orderedAt), by: creator })}
      {misses ? ` · ${t('orders.page.misses', { count: misses })}` : ''}
      {order.callbackAt && order.confirmationStatus === 'callback' ? ` · ${t('orders.page.callback', { time: algiersTime(order.callbackAt) })}` : ''}
    </span>
  );

  return (
    <AppPage
      permission="orders.read"
      back={back}
      title={`#${order.number}`}
      description={subtitle}
      badges={
        <>
          <OrderStatusPill status={order.status} />
          <StatusPill enumKey="Order.source" value={order.source.source} className="!rounded-[4px]">
            {t('orders.page.sourcePill', { source: t(`enum.Order.source.${order.source.source}`).replace(/^\S+\s/, '') })}
          </StatusPill>
          {order.channel ? (
            <Pill className="!rounded-[4px]">
              {t(`enum.Channel.platform.${order.channel.platform}`)} · {order.channel.name}
            </Pill>
          ) : null}
        </>
      }
      actions={
        <>
          <Link href={`/orders/${order.id}/print`} className={buttonClass()} data-testid="print-order">
            {t('action.print')}
          </Link>
          {cancel.present ? (
            <Button className="!border-accent-alert/60 !text-accent-alert hover:!border-accent-alert" onClick={() => actions.run('cancel', order)} disabledReason={cancel.enabled ? undefined : cancel.reason} data-testid="cancel-order">
              {t('action.cancel')}
            </Button>
          ) : null}
          {call.present ? (
            <Button variant="primary" onClick={() => actions.run('confirm', order)} disabledReason={call.enabled ? undefined : call.reason} data-testid="call-confirm">
              {t('orders.page.callConfirm')}
            </Button>
          ) : null}
          <ActionsMenu label={t('action.actions')} size="md" heading={`#${order.number} · ${t(`enum.Order.status.${order.status}`)}`} actions={actions.menu(order, { onPage: true })} />
        </>
      }
    >
      {ro ? <Banner tone="info">{t(`orders.page.readOnly.${order.status}`, { date: order.deliveredAt || order.cancelledAt ? formatDate((order.deliveredAt ?? order.cancelledAt)!, locale) : '' })}</Banner> : null}
      {order.status === 'cancelled' && order.cancelReason ? (
        <p className="-mt-2 ts-label-meta text-text-muted">
          {t('orders.page.cancelReason', { reason: t(`enum.Order.cancelReason.${order.cancelReason}`) })}
          {order.cancelNote ? ` · ${order.cancelNote}` : ''}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <ClientBlock
            order={order}
            editable={!ro && canWrite && (edit.present ? edit.enabled : true)}
            editing={!!contact}
            draft={contact ?? contactOf(order)}
            onDraft={setContact}
            onEdit={() => setContact(contactOf(order))}
            onCancelEdit={() => (setContact(null), setError(null))}
            onSave={() => void save('contact', order.version)}
            saving={saving === 'contact'}
            error={error?.part === 'contact' ? error.message : null}
            onAddress={() => actions.run('address', order)}
          />
          <ItemsBlock
            order={order}
            canEdit={editItems}
            editReason={!ro && edit.present && !edit.enabled ? edit.reason : order.shipments.length && !ro ? t('error.COURIER_ADDRESS_LOCKED') : undefined}
            editing={!!items}
            draft={items ?? itemsOf(order)}
            onDraft={setItems}
            onEdit={() => setItems(itemsOf(order))}
            onCancel={() => (setItems(null), setError(null))}
            onSave={() => void save('items', order.version)}
            saving={saving === 'items'}
            error={error?.part === 'items' ? error.message : null}
          />
          <div className="grid gap-5 md:grid-cols-2">
            <div id="delivery" className="flex min-w-0 scroll-mt-6 flex-col [&>*]:flex-1">
              <OrderDeliveryBlock order={order} onSend={() => actions.run('send', order)} onShip={() => actions.run('ship', order)} parcels={parcels} />
            </div>
            <div id="payment" className="flex min-w-0 scroll-mt-6 flex-col [&>*]:flex-1">
              <PaymentBlock order={order} onRecord={() => actions.run('payment', order)} onLink={() => actions.run('payment_link', order)} onRefund={() => actions.run('refund', order)} />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <HistoryBlock order={order} />
          <div id="calls" className="min-w-0 scroll-mt-6">
            <CallsBlock order={order} onLog={actionState(order.actions, ORDER_ACTION.logCall, t).enabled || actionState(order.actions, ORDER_ACTION.call, t).enabled ? () => actions.run('log_call', order) : undefined} />
          </div>
          <NotesBlock
            order={order}
            canWrite={canWrite}
            onAdd={async (body) => {
              try {
                await ordersApi.addNote(order.id, body);
                await refresh({ orderId: order.id });
                return true;
              } catch (e) {
                toast({ tone: 'danger', message: refusal(e, t) });
                return false;
              }
            }}
          />
          {order.sheetsSynced ? <p className="ts-label-micro text-text-muted">{t('orders.page.sheetsSynced')}</p> : null}
        </div>
      </div>

      {actions.element}
      {parcels.element}
      {guard}
      <ConflictDialog
        open={!!conflict}
        name={conflict?.c.changedBy || t('orders.conflict.someone')}
        ago={conflict?.c.changedAt ? relativeTime(conflict.c.changedAt, locale).replace(/^il y a /, '') : '—'}
        onReload={() => {
          // the draft stays in the form; only the base (version, other fields) is read again
          setConflict(null);
          void q.refetch();
        }}
        onOverwrite={conflict?.c.current ? () => (setConflict(null), void save(conflict.part, conflict.c.current!.version)) : undefined}
        onClose={() => setConflict(null)}
      />
    </AppPage>
  );
}
