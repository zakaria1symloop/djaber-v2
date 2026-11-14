'use client';
// Blocks of the order page (Figma "ORD-06 — Order page — new"): CLIENTE (inline contact edit), ARTICLES (+ totals,
// quantity edit while editable), PAIEMENT, HISTORIQUE, APPELS, NOTES INTERNES (LIVRAISON: features/delivery/order-block).
import { formatDate, formatMoney, formatPhoneDz, type AppLocale } from '@djaber/shared';
import { Button, DetailRows, Field, FormAlert, IconButton, Input, Ltr, MonoChip, OrderBlock, OrderTimeline, PhoneInput, QtyStepper, StatusPill, Textarea, TotalsRows, Tooltip, type TimelineItem } from '@djaber/ui';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ProductThumb } from '@/features/catalog/ui';
import { Link } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { formatPhoneOnBlur, phonePreview, phonePreviewLine } from '@/lib/phone';
import { relativeTime } from '@/lib/time';
import { ORDER_ACTION } from '../action-keys';
import type { Order, OrderItem } from '../contracts';
import { actorKind, algiersTime, historyReason, historyValue, newestFirst, shortName } from '../logic';
import { CallResultPill, PaymentPill, RiskPill } from '../ui';

const linkClass = 'text-[13px] text-text-secondary hover:text-text-primary disabled:opacity-45';

/* ---------- CLIENTE ---------- */
export type ContactDraft = { clientName: string; clientPhone: string; clientPhone2: string };
export const contactOf = (o: Order): ContactDraft => ({ clientName: o.clientName, clientPhone: o.clientPhone, clientPhone2: o.clientPhone2 ?? '' });
export function contactErrors(d: ContactDraft): Partial<Record<keyof ContactDraft, string>> {
  const e: Partial<Record<keyof ContactDraft, string>> = {};
  if (d.clientName.trim().length < 2) e.clientName = 'validation.name';
  if (!phonePreview(d.clientPhone)?.valid) e.clientPhone = 'validation.phone';
  if (d.clientPhone2.trim() && !phonePreview(d.clientPhone2)?.valid) e.clientPhone2 = 'validation.phone';
  return e;
}

export function ClientBlock({
  order,
  editable,
  draft,
  onDraft,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  saving,
  error,
  onAddress,
}: {
  order: Order;
  editable: boolean;
  draft: ContactDraft;
  onDraft: (d: ContactDraft) => void;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  onAddress: () => void;
}) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const errors = touched ? contactErrors(draft) : {};
  const address = actionState(order.actions, ORDER_ACTION.address, t);
  const a = order.address;
  const save = () => {
    setTouched(true);
    if (Object.keys(contactErrors(draft)).length) return;
    onSave();
  };
  return (
    <OrderBlock
      label={t('orders.page.client')}
      end={
        editable && !editing ? (
          <button type="button" className={linkClass} onClick={onEdit} data-testid="edit-contact">
            {t('orders.page.editContact')}
          </button>
        ) : null
      }
      bodyClassName="grid gap-5 p-4 md:grid-cols-3"
      data-testid="client-block"
    >
      {editing ? (
        <div className="flex flex-col gap-3 md:col-span-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t('common.name')} htmlFor="ct-name" error={errors.clientName && t(errors.clientName)}>
              <Input id="ct-name" value={draft.clientName} maxLength={120} disabled={saving} onChange={(e) => onDraft({ ...draft, clientName: e.target.value })} aria-invalid={!!errors.clientName || undefined} />
            </Field>
            <Field label={t('common.phone')} htmlFor="ct-phone" error={errors.clientPhone && t(errors.clientPhone)}>
              <PhoneInput id="ct-phone" value={draft.clientPhone} format={formatPhoneOnBlur} disabled={saving} onChange={(e) => onDraft({ ...draft, clientPhone: e.target.value })} preview={phonePreviewLine(t, draft.clientPhone)} aria-invalid={!!errors.clientPhone || undefined} />
            </Field>
            <Field label={t('common.phone2')} htmlFor="ct-phone2" error={errors.clientPhone2 && t(errors.clientPhone2)}>
              <PhoneInput id="ct-phone2" value={draft.clientPhone2} format={formatPhoneOnBlur} disabled={saving} onChange={(e) => onDraft({ ...draft, clientPhone2: e.target.value })} preview={phonePreviewLine(t, draft.clientPhone2)} />
            </Field>
          </div>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancelEdit} disabled={saving}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={save} loading={saving} data-testid="save-contact">
              {t('action.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="text-[15px] font-medium">{order.clientName}</div>
          <a href={`tel:${order.clientPhone}`} className="block text-[14px] hover:underline">
            <Ltr>{formatPhoneDz(order.clientPhone)}</Ltr>
          </a>
          {order.clientPhone2 ? <Ltr className="ts-label-meta text-text-muted">{formatPhoneDz(order.clientPhone2)}</Ltr> : null}
          <div className="mt-1 ts-label-micro text-text-muted">{t('orders.page.clientMeta', { count: order.client.orderCount })}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <RiskPill client={order.client} risk={order.riskLevel} />
            <Link href={`/clients?sheet=${order.client.id}`} className="ts-label-micro text-accent-inbound hover:underline">
              {t('orders.page.clientSheet')}
            </Link>
          </div>
        </div>
      )}
      {!editing ? (
        <>
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="ts-label-micro text-text-muted">{t('orders.page.delivery')}</span>
              {address.present ? (
                <Tooltip content={address.reason ?? t('action.editAddress')}>
                  <button type="button" className="ts-label-micro text-accent-inbound hover:underline disabled:opacity-45 disabled:no-underline" disabled={!address.enabled} onClick={onAddress} data-testid="edit-address">
                    {t('action.edit')}
                  </button>
                </Tooltip>
              ) : null}
            </div>
            {a ? (
              <>
                <div className="mt-1 text-[13px]">
                  {a.wilayaName} (<Ltr>{String(a.wilayaId).padStart(2, '0')}</Ltr>){a.communeText ? ` · ${a.communeText}` : ''}
                </div>
                <div className="text-[13px] text-text-secondary">{a.isStopdesk ? (a.stopdeskName ?? '—') : (a.address ?? '—')}</div>
                <MonoChip className="mt-1.5">{a.isStopdesk ? t('common.stopdesk') : t('orders.page.home')}</MonoChip>
              </>
            ) : (
              <p className="mt-1 text-[13px] text-accent-starred">{t('orders.confirm.noAddress')}</p>
            )}
          </div>
          <div className="min-w-0">
            <span className="ts-label-micro text-text-muted">{t('orders.page.conversation')}</span>
            {order.conversationId ? (
              <>
                <Link href={`/inbox/${order.conversationId}`} className="mt-1 flex items-center gap-1 text-[13px] text-accent-inbound hover:underline" data-testid="open-conversation">
                  <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden />
                  {t('orders.page.openInbox')}
                </Link>
                {order.channel ? <div className="ts-label-micro text-text-muted">{order.channel.name}</div> : null}
              </>
            ) : (
              <p className="mt-1 text-[13px] text-text-muted">{t('orders.page.noConversation')}</p>
            )}
            {order.assignee ? <div className="mt-2 ts-label-micro text-text-muted">{t('orders.page.assignee', { name: shortName(order.assignee) })}</div> : null}
          </div>
        </>
      ) : null}
    </OrderBlock>
  );
}

/* ---------- ARTICLES ---------- */
export type ItemsDraft = { id: string; productId: string; variantId: string | null; quantity: number; unitPrice: number }[];
export const itemsOf = (o: Order): ItemsDraft => o.items.map((i) => ({ id: i.id, productId: i.product.id, variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice }));

export function ItemsBlock({
  order,
  canEdit,
  editReason,
  editing,
  draft,
  onDraft,
  onEdit,
  onCancel,
  onSave,
  saving,
  error,
}: {
  order: Order;
  canEdit: boolean;
  editReason?: string;
  editing: boolean;
  draft: ItemsDraft;
  onDraft: (d: ItemsDraft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const t = useT();
  const byId = new Map(order.items.map((i) => [i.id, i]));
  const lines: (OrderItem & { qty: number })[] = editing ? draft.map((d) => ({ ...byId.get(d.id)!, qty: d.quantity })).filter((l) => l.id) : order.items.map((i) => ({ ...i, qty: i.quantity }));
  const subtotal = editing ? lines.reduce((s, l) => s + l.unitPrice * l.qty - l.discount, 0) : order.subtotal;
  const fee = order.deliveryFee;
  const total = editing ? subtotal - order.discount + order.tax + fee : order.total;
  const a = order.address;
  const feeLabel = [t('common.deliveryFee').toUpperCase(), a ? a.wilayaName.toUpperCase() : null, a ? (a.isStopdesk ? t('common.stopdesk').toUpperCase() : t('common.home').toUpperCase()) : null].filter(Boolean).join(' · ');
  return (
    <OrderBlock
      label={t('common.items')}
      end={
        canEdit || editReason ? (
          editing ? null : (
            <Tooltip content={editReason ?? t('action.edit')}>
              <button type="button" className={linkClass} disabled={!canEdit} onClick={onEdit} data-testid="edit-items">
                {t('action.edit')}
              </button>
            </Tooltip>
          )
        ) : null
      }
      data-testid="items-block"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label={t('common.items')}>
          <thead>
            <tr className="border-b border-line-hairline">
              <th className="ts-label-micro px-4 py-2.5 text-start text-text-muted">{t('orders.page.product')}</th>
              <th className="ts-label-micro px-3 py-2.5 text-end text-text-muted">{t('common.price')}</th>
              <th className="ts-label-micro px-3 py-2.5 text-center text-text-muted">{t('orders.page.qty')}</th>
              <th className="ts-label-micro px-4 py-2.5 text-end text-text-muted">{t('common.total')}</th>
              {editing ? <th className="w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line-hairline" data-item={l.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ProductThumb src={l.product.primaryImageUrl} name={l.productName} size={36} />
                    <div className="min-w-0">
                      <Link href={`/products/${l.product.id}`} className="block truncate font-medium hover:underline">
                        {l.productName}
                      </Link>
                      <div className="ts-label-micro truncate text-text-muted">
                        {[l.variantName, l.sku ? t('orders.page.sku', { sku: l.sku }) : null].filter(Boolean).join(' · ')}
                      </div>
                      {l.stockWarning ? <div className="ts-label-micro text-accent-starred">⚠ {t(`orders.page.stock.${l.stockWarning}`)}</div> : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-end">
                  <Ltr className="tabular-nums">{formatMoney(l.unitPrice)}</Ltr>
                </td>
                <td className="px-3 py-3 text-center">
                  {editing ? (
                    <QtyStepper value={l.qty} min={1} onChange={(q) => onDraft(draft.map((d) => (d.id === l.id ? { ...d, quantity: q } : d)))} labels={{ decrease: t('orders.page.qtyMinus'), increase: t('orders.page.qtyPlus'), value: t('orders.page.qty') }} disabled={saving} />
                  ) : (
                    <Ltr className="tabular-nums">{l.qty}</Ltr>
                  )}
                </td>
                <td className="px-4 py-3 text-end font-medium">
                  <Ltr className="tabular-nums">{formatMoney(l.unitPrice * l.qty - l.discount)}</Ltr>
                </td>
                {editing ? (
                  <td className="pe-3">
                    <IconButton size="sm" variant="ghost" label={t('orders.page.removeLine', { name: l.productName })} disabled={saving || draft.length <= 1} onClick={() => onDraft(draft.filter((d) => d.id !== l.id))}>
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <TotalsRows
          rows={[
            { key: 'subtotal', label: t('common.subtotal').toUpperCase(), value: <Ltr>{formatMoney(subtotal)}</Ltr> },
            { key: 'delivery', label: feeLabel, value: <Ltr>{formatMoney(fee)}</Ltr> },
            ...(order.feeExplanation ? [{ key: 'feeNote', label: '', value: <span className="ts-label-micro !normal-case text-text-muted">{order.feeExplanation}</span> }] : []),
            { key: 'discount', label: t('common.discount').toUpperCase(), value: <Ltr>{`− ${formatMoney(order.discount)}`}</Ltr> },
            ...(order.tax ? [{ key: 'tax', label: t('orders.page.tax'), value: <Ltr>{formatMoney(order.tax)}</Ltr> }] : []),
            { key: 'total', label: t('common.total'), value: <Ltr>{formatMoney(total)}</Ltr>, strong: true },
            { key: 'paid', label: t('orders.page.paidRemaining'), value: <Ltr>{`${formatMoney(order.amountPaid)} · ${formatMoney(Math.max(0, total - order.amountPaid))}`}</Ltr> },
          ]}
        />
        {editing ? (
          <>
            {error ? <FormAlert>{error}</FormAlert> : null}
            <p className="ts-label-micro !normal-case text-text-muted">{t('orders.page.itemsNote')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel} disabled={saving}>
                {t('action.cancel')}
              </Button>
              <Button variant="primary" onClick={onSave} loading={saving} data-testid="save-items">
                {t('action.save')}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </OrderBlock>
  );
}

/* LIVRAISON: `features/delivery/order-block.tsx` (M6 parcel states, tracking, labels). */

/* ---------- PAIEMENT ---------- */
export function PaymentBlock({ order, onRecord, onLink, onRefund }: { order: Order; onRecord: () => void; onLink: () => void; onRefund: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const record = actionState(order.actions, ORDER_ACTION.recordPayment, t);
  const link = actionState(order.actions, ORDER_ACTION.paymentLink, t);
  const refund = actionState(order.actions, ORDER_ACTION.refund, t);
  const pl = order.paymentLink;
  return (
    <OrderBlock label={t('orders.page.payment')} end={<PaymentPill status={order.paymentStatus} />} bodyClassName="flex flex-col gap-3 p-4" data-testid="payment-block">
      <DetailRows
        rows={[
          { key: 'mode', label: t('orders.page.mode'), value: t(`orders.payment.methodLong.${order.paymentMethod}`) },
          { key: 'paid', label: t('orders.page.amountPaid'), value: <Ltr>{formatMoney(order.amountPaid)}</Ltr> },
          { key: 'remaining', label: t('common.remaining').toUpperCase(), value: <Ltr>{formatMoney(order.remaining)}</Ltr>, tone: order.remaining > 0 ? 'warning' : undefined },
        ]}
      />
      {record.present || link.present ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {record.present ? (
            <Button onClick={onRecord} disabled={!record.enabled} title={record.reason} data-testid="record-payment">
              {t('action.recordPayment')}
            </Button>
          ) : null}
          {link.present ? (
            <Button onClick={onLink} disabled={!link.enabled} title={link.reason} data-testid="open-payment-link">
              {t('action.paymentLink')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {pl && pl.status !== 'creating' ? (
        <button type="button" onClick={onLink} className="flex items-center justify-between gap-2 rounded-card border border-line-hairline px-3 py-2 text-start text-[13px] hover:border-line-edge" data-testid="payment-link-summary" data-status={pl.status}>
          <span className="text-text-secondary">{t('action.paymentLink')}</span>
          <span className="inline-flex items-center gap-2">
            <Ltr className="tabular-nums">{formatMoney(pl.amount)}</Ltr>
            <StatusPill enumKey="PaymentLink.status" value={pl.status === 'refunded' ? 'cancelled' : pl.status} className="!rounded-[4px]">
              {t(`orders.paymentLink.status.${pl.status}`)}
            </StatusPill>
          </span>
        </button>
      ) : null}
      {refund.present ? (
        <Button variant="ghost" size="sm" className="self-start text-accent-alert" onClick={onRefund} disabled={!refund.enabled} title={refund.reason} data-testid="open-refund">
          {t('action.refund')}
        </Button>
      ) : null}
      {record.present && !record.enabled && record.reason ? <p className="ts-label-micro !normal-case text-text-muted">{record.reason}</p> : null}
      <p className="ts-label-micro !normal-case text-text-muted">{t('orders.page.codNote')}</p>
      {order.payments.length ? (
        <ul className="divide-y divide-line-hairline border-t border-line-hairline" aria-label={t('orders.page.payments')}>
          {newestFirst(order.payments, (p) => p.paidAt).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span>
                {t(`orders.payment.method.${p.method}`)}
                {p.reference ? <span className="text-text-muted"> · {p.reference}</span> : null}
                <span className="block ts-label-micro text-text-muted">
                  {formatDate(p.paidAt, locale)} · {shortName(p.createdBy)}
                </span>
              </span>
              <Ltr className="font-medium tabular-nums">{formatMoney(p.amount)}</Ltr>
            </li>
          ))}
        </ul>
      ) : null}
    </OrderBlock>
  );
}

/* ---------- HISTORIQUE ---------- */
export function HistoryBlock({ order }: { order: Order }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const value = (field: string, v: string | null) => {
    const r = historyValue(field, v, t.has);
    return r.key ? t(r.key, { attempts: order.callAttempts, time: order.callbackAt ? algiersTime(order.callbackAt) : '' }) : (r.raw ?? '—');
  };
  const items: TimelineItem[] = newestFirst(order.history, (h) => h.at).map((h, i) => {
    const kind = actorKind(h);
    // an AI line without a named agent reads « IA » once (not « IA (IA) »); the server names it in the viewer's language
    const name = kind === 'ai' ? (h.actor.name && h.actor.name !== t('actor.label.ai') ? t('orders.history.ai', { name: h.actor.name }) : t('actor.label.ai')) : kind === 'system' ? t('orders.history.system') : h.actor.name;
    const fieldKey = `orders.history.field.${h.field}`;
    const text = h.field === 'created' ? t('orders.history.created') : `${t.has(fieldKey) ? t(fieldKey) : h.field} : ${h.from ? `${value(h.field, h.from)} → ` : ''}${value(h.field, h.to)}`;
    return {
      key: `${h.at}-${i}`,
      time: algiersTime(h.at),
      title: name,
      text: [text, historyReason(h.reason, t)].filter(Boolean).join(' · '),
      meta: h.effectiveAt && h.effectiveAt !== h.at ? t('orders.history.effective', { date: formatDate(h.effectiveAt, locale) }) : formatDate(h.at, locale),
      tone: kind === 'ai' ? 'success' : kind === 'system' ? 'neutral' : 'info',
    };
  });
  return (
    <OrderBlock label={t('orders.page.history')} data-testid="history-block">
      <OrderTimeline items={items} label={t('orders.page.history')} empty={t('orders.history.empty')} />
    </OrderBlock>
  );
}

/* ---------- APPELS ---------- */
export function CallsBlock({ order, onLog }: { order: Order; onLog?: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const calls = newestFirst(order.calls, (c) => c.calledAt);
  return (
    <OrderBlock
      label={t('orders.page.calls', { count: calls.length })}
      end={
        onLog ? (
          <button type="button" className={linkClass} onClick={onLog} data-testid="log-call">
            {t('orders.menu.logCall')}
          </button>
        ) : null
      }
      bodyClassName="divide-y divide-line-hairline"
      data-testid="calls-block"
    >
      {calls.length === 0 ? <p className="px-4 py-4 ts-label-meta text-text-muted">{t('orders.page.noCalls')}</p> : null}
      {calls.map((c) => (
        <div key={c.id} className="px-4 py-3" data-call={c.result}>
          <div className="flex flex-wrap items-center gap-2">
            <CallResultPill result={c.result} />
            <span className="ts-label-micro text-text-muted">
              {shortName(c.user)} · <Ltr>{algiersTime(c.calledAt)}</Ltr> · {formatDate(c.calledAt, locale)}
            </span>
          </div>
          {c.callbackAt ? <div className="mt-1 ts-label-micro text-accent-inbound">{t('orders.page.callbackAt', { time: algiersTime(c.callbackAt), date: formatDate(c.callbackAt, locale) })}</div> : null}
          {c.notes ? <p className="mt-1 text-[13px]">{c.notes}</p> : null}
        </div>
      ))}
    </OrderBlock>
  );
}

/* ---------- NOTES INTERNES ---------- */
export function NotesBlock({ order, onAdd, canWrite }: { order: Order; onAdd: (body: string) => Promise<boolean>; canWrite: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = newestFirst(order.orderNotes, (n) => n.createdAt);
  return (
    <OrderBlock
      label={t('orders.page.notes')}
      end={
        canWrite && !open ? (
          <button type="button" className={linkClass} onClick={() => setOpen(true)} data-testid="add-note">
            {t('action.add')}
          </button>
        ) : null
      }
      bodyClassName="divide-y divide-line-hairline"
      data-testid="notes-block"
    >
      {open ? (
        <div className="flex flex-col gap-2 p-3">
          <Textarea aria-label={t('orders.page.notes')} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder={t('orders.page.notePlaceholder')} className="min-h-16" autoFocus />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => (setOpen(false), setBody(''))} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!body.trim()}
              onClick={async () => {
                setBusy(true);
                const ok = await onAdd(body.trim());
                setBusy(false);
                if (ok) {
                  setBody('');
                  setOpen(false);
                }
              }}
              data-testid="save-note"
            >
              {t('action.add')}
            </Button>
          </div>
        </div>
      ) : null}
      {notes.length === 0 && !open ? <p className="px-4 py-4 ts-label-meta text-text-muted">{t('orders.page.noNotes')}</p> : null}
      {notes.map((n) => (
        <div key={n.id} className="px-4 py-3">
          <p className="text-[13px]">{n.body}</p>
          <div className="mt-1 ts-label-micro text-text-muted">
            {shortName(n.author)} · {relativeTime(n.createdAt, locale)}
          </div>
        </div>
      ))}
    </OrderBlock>
  );
}

