'use client';
// Order dialogs of the catalogues "DLG — Orders & delivery" and "DLG — Orders, delivery & clients II":
// Programmer un rappel · Annuler la commande · Changer le statut · Marquer livrée manuellement · Marquer retournée ·
// Supprimer la commande (typed number) · Enregistrer un paiement · Assigner (one or many) · Marquer expédiée (manuel).
// "Envoyer au transporteur" (DLV-05) lives in `features/delivery/send-dialog.tsx`. Server errors render inline in the open dialog; the content is preserved.
import { formatMoney } from '@djaber/shared';
import { Checkbox, CodeInput, Dialog, Field, FormAlert, Input, MoneyInput, Pill, Select, Textarea, toast } from '@djaber/ui';
import { useState } from 'react';
import { ConflictDialog } from '@/components/global-states';
import { useMembers } from '@/features/workspace/api';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { useSession } from '@/lib/session';
import { deliveryApi } from '@/features/delivery/api';
import { ordersApi } from '../api';
import { CANCEL_REASONS, FAILURE_REASONS, ORDER_BACKDATE_MAX_DAYS, PAYMENT_METHODS, type BulkResponse, type CancelReason, type FailureReason, type Order, type OrderStatus, type PaymentMethod } from '../contracts';
import { algiersTime, effectiveDateError, isoToLocalInput, localInputToIso, paymentError } from '../logic';
import { DialogFooter, orderContext, RadioList, useDialogSubmit, useOnOpen, type DialogBaseProps } from './common';
import { CallbackPicker } from './outcome';

type Props = DialogBaseProps & { open: boolean };

/** Conflict (409) of a versioned write: Recharger re-reads the order (the dialog stays open, its fields kept). */
function VersionConflict({ s, onReload, onOverwrite }: { s: ReturnType<typeof useDialogSubmit<unknown>>; onReload: () => void; onOverwrite?: (version: number) => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const c = s.conflict;
  return (
    <ConflictDialog
      open={!!c}
      name={c?.changedBy || t('orders.conflict.someone')}
      ago={c?.changedAt ? relativeTime(c.changedAt, locale) : '—'}
      onReload={() => {
        s.clearConflict();
        onReload();
      }}
      onOverwrite={onOverwrite && c?.current ? () => (s.clearConflict(), onOverwrite(c.current!.version)) : undefined}
      onClose={s.clearConflict}
    />
  );
}

/* ---------- Programmer un rappel ---------- */
export function CallbackDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [at, setAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setAt(null);
    setNote('');
    setNotify(false);
    setTouched(false);
  });
  const s = useDialogSubmit(() => ordersApi.setCallback(order.id, { at: at!, note: note.trim() || undefined, notifyCustomer: notify || undefined }));
  const clear = useDialogSubmit(() => ordersApi.clearCallback(order.id));
  const past = !!at && Date.parse(at) <= Date.now();
  const invalid = touched && (!at || past);
  const submit = async () => {
    setTouched(true);
    if (!at || past) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.callback.saved'));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.reminder.title')}
      description={`#${order.number} · ${order.clientName} · ${t(`enum.Order.confirmationStatus.${order.confirmationStatus}`, { attempts: order.callAttempts, time: '' })}`}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          {order.callbackAt ? (
            <button
              type="button"
              className="me-auto ts-label-meta text-accent-alert hover:underline"
              onClick={async () => {
                const r = await clear.submit();
                if (r === undefined) return;
                toast(t('orders.callback.cleared'));
                await onDone();
                onClose();
              }}
            >
              {t('orders.callback.clear')}
            </button>
          ) : null}
          <DialogFooter onClose={onClose} busy={s.busy || clear.busy} onSubmit={() => void submit()} label={t('orders.callback.submit')} note={t('orders.callback.noteAt', { time: at && !past ? algiersTime(at) : '…' })} />
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="callback-dialog">
        <Field label={t('orders.callback.when')} error={invalid ? t(past ? 'error.ORDER_CALLBACK_IN_PAST' : 'validation.required') : undefined}>
          <CallbackPicker value={at} onChange={setAt} invalid={invalid} />
        </Field>
        <Field label={t('common.note')} htmlFor="cb-note">
          <Input id="cb-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('orders.callback.notePlaceholder')} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!order.conversationId} />
          <span>
            {t('orders.callback.notify')}
            {!order.conversationId ? <span className="block ts-label-meta text-text-muted">{t('gaps.orders.notify.noConversation')}</span> : null}
          </span>
        </label>
        {s.error || clear.error ? <FormAlert>{s.error ?? clear.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Annuler la commande ---------- */
export function CancelOrderDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setReason(order.confirmationStatus === 'wrong_number' ? 'fake' : null);
    setNote('');
    setNotify(false);
    setTouched(false);
  });
  const s = useDialogSubmit(() => ordersApi.cancel(order.id, { reason: reason!, note: note.trim() || null, notifyCustomer: notify || undefined, version: order.version }));
  const submit = async () => {
    setTouched(true);
    if (!reason) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.cancel.done', { number: order.number }));
    await onDone(r);
    onClose();
  };
  const hints: Partial<Record<CancelReason, string>> = { unreachable: t('orders.cancel.reason.unreachable.hint', { count: order.callAttempts }), fake: t('orders.cancel.reason.fake.hint') };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.cancelOrder.title', { number: order.number })}
      description={orderContext(t, order)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.cancelOrder').replace(/^✕\s*/, '')} danger closeLabel={t('action.keep')} note={t('orders.cancel.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="cancel-dialog">
        <Pill tone="danger" className="w-fit !rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        <Field label={t('common.reasonRequired')} error={touched && !reason ? t('validation.required') : s.fieldError('reason')}>
          <RadioList<CancelReason> label={t('common.reasonRequired')} value={reason} onChange={setReason} options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`enum.Order.cancelReason.${r}`), description: hints[r] }))} />
        </Field>
        <Field label={t('common.noteOptional')} htmlFor="cancel-note" error={s.fieldError('note')}>
          <Input id="cancel-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!order.conversationId} />
          <span>
            {t('orders.cancel.notify')}
            {!order.conversationId ? <span className="block ts-label-meta text-text-muted">{t('gaps.orders.notify.noConversation')}</span> : null}
          </span>
        </label>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Changer le statut (targets of 04 §1.2, effective date ≤ 7 d) + "Échec de livraison" (parcel, 12 §20) ---------- */
type StatusTarget = OrderStatus | 'delivery_failed';
export function ChangeStatusDialog({ order, open, onClose, onDone, targets, onReload }: Props & { targets: OrderStatus[]; onReload: () => void }) {
  const t = useT();
  // "Échec de livraison": `POST /shipments/:id/mark-failed` on the active parcel when its descriptor allows it
  const parcel = order.shipments.find((x) => x.actions.some((a) => a.key === 'mark_failed' && a.enabled)) ?? null;
  const all: StatusTarget[] = parcel ? [...targets, 'delivery_failed'] : targets;
  const [to, setTo] = useState<StatusTarget | null>(null);
  const [when, setWhen] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<FailureReason | null>(null);
  const [restock, setRestock] = useState(true);
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setTo(all[0] ?? null);
    setWhen('');
    setAmount(moneyDigits(order.total));
    setReason('');
    setFailure(null);
    setRestock(true);
    setTouched(false);
  });
  const effectiveAt = localInputToIso(when);
  const dateErr = effectiveDateError(effectiveAt, new Date(), ORDER_BACKDATE_MAX_DAYS);
  const collected = digitsToInt(amount);
  // full-test 15/11 ORDERS-05: the cash taken at delivery, default = what is still due (a deposit is already paid)
  const needsReason = to === 'delivered' && collected !== null && collected !== order.remaining;
  const s = useDialogSubmit<unknown>((key) =>
    to === 'delivery_failed'
      ? deliveryApi.markFailed(parcel!.id, { reason: failure!, note: reason.trim() || null })
      : ordersApi.status(
          order.id,
          {
            to: to as OrderStatus,
            effectiveAt: effectiveAt ?? undefined,
            amountCollected: to === 'delivered' ? (collected ?? order.remaining) : undefined,
            note: needsReason || (to === 'returned' && reason.trim()) ? reason.trim() : undefined,
            restoreStock: to === 'returned' ? restock : undefined,
            version: order.version,
          },
          key,
        ),
  );
  const submit = async () => {
    setTouched(true);
    if (!to || dateErr || (needsReason && !reason.trim()) || (to === 'delivery_failed' && !failure)) return;
    const r = await s.submit();
    if (r === undefined) return;
    if (to === 'delivery_failed') {
      toast(t('parcel.failed.done', { number: order.number }));
      await onDone();
    } else {
      toast(t('orders.status.done', { number: order.number, status: t(`enum.Order.status.${to}`) }));
      await onDone(r as Order);
    }
    onClose();
  };
  const describe = (s: OrderStatus): string => (t.has(`orders.status.target.${order.status}.${s}`) ? t(`orders.status.target.${order.status}.${s}`) : t(`orders.status.target.${s}`));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.changeStatus.title')}
      description={`#${order.number} · ${t(`enum.Order.status.${order.status}`)} → ?`}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.apply')} disabled={!all.length} note={t('orders.status.rule')} />}
    >
      <div className="flex flex-col gap-4" data-testid="status-dialog">
        {all.length ? (
          <RadioList<StatusTarget>
            label={t('dialog.changeStatus.title')}
            value={to}
            onChange={setTo}
            options={all.map((v) =>
              v === 'delivery_failed'
                ? { value: v, label: t('parcel.failed.title'), description: t('parcel.failed.note') }
                : { value: v, label: order.status === 'shipped' && v === 'confirmed' ? t('orders.status.backToConfirmed') : t(`orders.status.label.${v}`), description: describe(v) },
            )}
          />
        ) : (
          <FormAlert tone="info">{t('orders.status.none')}</FormAlert>
        )}
        {to === 'delivery_failed' ? (
          <Field label={t('orders.return.reason')} error={touched && !failure ? t('validation.required') : s.fieldError('reason')}>
            <RadioList<FailureReason> label={t('orders.return.reason')} value={failure} onChange={setFailure} options={FAILURE_REASONS.map((r) => ({ value: r, label: t(`orders.return.reason.${r}`) }))} />
          </Field>
        ) : null}
        {to === 'delivered' ? (
          <Field label={t('orders.deliver.amount')} htmlFor="st-amount" hint={t('orders.deliver.amountHint')}>
            <MoneyInput id="st-amount" value={amount} onValueChange={setAmount} />
          </Field>
        ) : null}
        {to === 'returned' ? (
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            {t('orders.return.restock', { count: order.itemCount })}
          </label>
        ) : null}
        {needsReason || to === 'returned' || to === 'delivery_failed' ? (
          <Field label={needsReason ? t('orders.deliver.reason') : t('common.noteOptional')} htmlFor="st-reason" error={touched && needsReason && !reason.trim() ? t('validation.required') : s.fieldError('note')}>
            <Input id="st-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
        {to === 'delivery_failed' ? null : (
          <Field label={t('orders.status.effectiveAt')} htmlFor="st-when" hint={t('orders.status.effectiveHint', { days: ORDER_BACKDATE_MAX_DAYS })} error={touched && dateErr ? t('orders.status.effectiveError', { days: ORDER_BACKDATE_MAX_DAYS }) : s.fieldError('effectiveAt')}>
            <Input id="st-when" type="datetime-local" value={when} max={isoToLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} className="[color-scheme:dark]" placeholder={t('common.today')} />
          </Field>
        )}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
      <VersionConflict s={s} onReload={onReload} />
    </Dialog>
  );
}

/* ---------- Marquer livrée manuellement ---------- */
export function DeliverDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setAmount(moneyDigits(order.remaining));
    setReason('');
    setDay(isoToLocalInput(new Date()));
    setTouched(false);
  });
  const collected = digitsToInt(amount);
  const differs = collected !== null && collected !== order.remaining;
  const deliveredAt = localInputToIso(day);
  const dateErr = effectiveDateError(deliveredAt, new Date(), ORDER_BACKDATE_MAX_DAYS);
  const s = useDialogSubmit(() => ordersApi.deliver(order.id, { amountCollected: collected ?? order.remaining, reason: differs ? reason.trim() : null, deliveredAt: deliveredAt ?? undefined, version: order.version }));
  const submit = async () => {
    setTouched(true);
    if (collected === null || (differs && !reason.trim()) || dateErr) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.deliver.done', { number: order.number }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.markDelivered.title')}
      description={t('orders.deliver.context', { number: order.number })}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('orders.deliver.submit')} />}
    >
      <div className="flex flex-col gap-4" data-testid="deliver-dialog">
        <Field label={t('orders.deliver.amount')} htmlFor="dl-amount" hint={t('orders.deliver.amountHint')} error={touched && collected === null ? t('validation.required') : s.fieldError('amountCollected')}>
          <MoneyInput id="dl-amount" value={amount} onValueChange={setAmount} />
        </Field>
        <Field label={t('orders.deliver.reason')} htmlFor="dl-reason" error={touched && differs && !reason.trim() ? t('validation.required') : s.fieldError('reason')}>
          <Input id="dl-reason" value={reason} maxLength={500} disabled={!differs} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('orders.deliver.date')} htmlFor="dl-day" error={touched && dateErr ? t('orders.status.effectiveError', { days: ORDER_BACKDATE_MAX_DAYS }) : undefined}>
          <Input id="dl-day" type="datetime-local" value={day} max={isoToLocalInput(new Date())} onChange={(e) => setDay(e.target.value)} className="[color-scheme:dark]" />
        </Field>
        <p className="rounded-card border border-line-edge px-3 py-2 ts-label-micro !normal-case text-text-muted">{t('orders.deliver.effects', { amount: formatMoney(collected ?? order.remaining), paid: formatMoney(order.total - order.remaining + (collected ?? order.remaining)) })}</p>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Marquer retournée ---------- */
export function ReturnDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [restock, setRestock] = useState(true);
  // the courier return fee is ticked only when a courier carried the parcel — never for self-delivery (full-test ORDERS-11)
  const byCourier = !!order.shipments[0] && order.shipments[0].provider !== 'manual';
  const [fee, setFee] = useState(byCourier);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setReason(null);
    setRestock(true);
    setFee(byCourier);
    setNote('');
    setTouched(false);
  });
  const s = useDialogSubmit(() => ordersApi.returnOrder(order.id, { reason: reason!, restoreStock: restock, returnFee: fee ? undefined : 0, note: note.trim() || null, version: order.version }));
  const submit = async () => {
    setTouched(true);
    if (!reason) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.return.done', { number: order.number }));
    await onDone(r);
    onClose();
  };
  const courier = order.shipments[0]?.provider;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.markReturned.title')}
      description={[`#${order.number}`, order.clientName, courier ? t(`enum.Courier.${courier}`) : null].filter(Boolean).join(' · ')}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.markReturned')} note={t('orders.return.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="return-dialog">
        <Field label={t('orders.return.reason')} error={touched && !reason ? t('validation.required') : s.fieldError('reason')}>
          <RadioList<FailureReason> label={t('orders.return.reason')} value={reason} onChange={setReason} options={FAILURE_REASONS.map((r) => ({ value: r, label: t(`orders.return.reason.${r}`) }))} />
        </Field>
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5" />
          <span>
            {t('orders.return.restock', { count: order.itemCount })}
            <span className="block ts-label-micro !normal-case text-text-muted">{t('orders.return.restockHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox checked={fee} onChange={(e) => setFee(e.target.checked)} className="mt-0.5" />
          <span>
            {order.returnFee !== null ? t('orders.return.fee', { amount: formatMoney(order.returnFee) }) : t('orders.return.feeGrid')}
            <span className="block ts-label-micro !normal-case text-text-muted">{t('orders.return.feeHint')}</span>
          </span>
        </label>
        {order.amountPaid > 0 ? (
          <FormAlert tone="info">{t('orders.return.paymentsCleared', { amount: formatMoney(order.amountPaid) })}</FormAlert>
        ) : null}
        <Field label={t('common.noteOptional')} htmlFor="rt-note">
          <Input id="rt-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Supprimer la commande (typed number, exact) ---------- */
export function DeleteOrderDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [typed, setTyped] = useState('');
  useOnOpen(open, () => setTyped(''));
  const expected = order.number.replace(/^#/, '');
  // the number as displayed (« #CMD-1020 ») is accepted too (full-test ORDERS-12)
  const entered = typed.trim().replace(/^#\s*/, '');
  const s = useDialogSubmit(() => ordersApi.remove(order.id, entered));
  const submit = async () => {
    if (entered !== expected) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.delete.done', { number: order.number }));
    await onDone(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.deleteOrder.title', { number: expected })}
      description={t('orders.delete.context')}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.delete')} danger disabled={entered !== expected} />}
    >
      <div className="flex flex-col gap-3" data-testid="delete-dialog">
        <Pill tone="danger" className="w-fit !rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        <Field label={t('common.typeToConfirm')} htmlFor="del-typed" hint={t('orders.delete.typeHint', { number: expected })}>
          <CodeInput id="del-typed" value={typed} placeholder={expected} onChange={(e) => setTyped(e.target.value)} />
        </Field>
        <p className="ts-label-micro !normal-case text-text-muted">{t('orders.delete.note')}</p>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Enregistrer un paiement ---------- */
export function PaymentDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setAmount(moneyDigits(order.remaining));
    setMethod(order.paymentMethod ?? 'cash');
    setReference('');
    setNote('');
    setTouched(false);
  });
  const value = digitsToInt(amount);
  const err = paymentError(value, order.remaining);
  const s = useDialogSubmit((key) => ordersApi.recordPayment(order.id, { amount: value!, method, reference: reference.trim() || null, note: note.trim() || null }, key));
  const submit = async () => {
    setTouched(true);
    if (err) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.payment.done', { amount: formatMoney(value!) }));
    await onDone();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.recordPayment.title')}
      description={t('orders.payment.context', { number: order.number, total: formatMoney(order.total), paid: formatMoney(order.amountPaid) })}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="payment-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('orders.payment.amount')} htmlFor="pay-amount" error={touched && err ? t(err, { amount: formatMoney(order.remaining), max: '', min: '' }) : s.fieldError('amount')}>
            <MoneyInput id="pay-amount" value={amount} onValueChange={setAmount} aria-invalid={(touched && !!err) || undefined} />
          </Field>
          <Field label={t('orders.payment.method')} htmlFor="pay-method">
            <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`orders.payment.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="ts-label-micro !normal-case text-text-muted">{t('orders.payment.hint')}</p>
        <Field label={t('orders.payment.reference')} htmlFor="pay-ref">
          <CodeInput id="pay-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('common.note')} htmlFor="pay-note">
          <Textarea id="pay-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="min-h-14" />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Assigner (one order or a selection) ---------- */
export function AssignDialog({ open, ids, current, onClose, onDone }: { open: boolean; ids: string[]; current?: string | null; onClose: () => void; onDone: (r?: BulkResponse) => void | Promise<void> }) {
  const t = useT();
  const { me } = useSession();
  const members = useMembers(open);
  const [who, setWho] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  useOnOpen(open, () => {
    setWho(current === undefined ? null : (current ?? 'none'));
    setNotify(true);
  });
  const single = ids.length === 1;
  const s = useDialogSubmit(async (key) => {
    const assigneeId = who === 'none' ? null : who;
    if (single) {
      await ordersApi.assign(ids[0]!, { assigneeId, notify: notify && !!assigneeId });
      return { bulk: undefined };
    }
    return { bulk: await ordersApi.bulkAssign({ ids, assigneeId, notify: notify && !!assigneeId }, key) };
  });
  const submit = async () => {
    if (!who) return;
    const r = await s.submit();
    if (r === undefined) return;
    if (single) toast(t('orders.assign.done'));
    await onDone(r.bulk);
    onClose();
  };
  const role = (r: string) => t(`enum.Membership.role.${r}`).toLowerCase();
  const options = [
    ...(members.data ?? []).map((m) => ({
      value: m.user.id,
      label: `${m.user.firstName} ${m.user.lastName}${m.user.id === me?.id ? ` (${t('action.assignMe')})` : ''}`,
      description: role(m.role),
    })),
    { value: 'none', label: t('action.unassign') },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.assign.title')}
      description={single ? undefined : t('orders.bulk.selected', { count: ids.length })}
      closeLabel={t('action.close')}
      size="sm"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={single ? t('action.assign') : t('action.assignCount', { count: ids.length })} disabled={!who} />}
    >
      <div className="flex flex-col gap-3" data-testid="assign-dialog">
        {members.isPending ? <p className="ts-label-meta text-text-muted">{t('common.loading')}</p> : <RadioList label={t('dialog.assign.title')} value={who} onChange={setWho} options={options} />}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={who === 'none'} />
          {t('orders.assign.notify')}
        </label>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Marquer expédiée (manuel): self-delivery, optional tracking number ---------- */
export function ShipManualDialog({ order, open, onClose, onDone }: Props) {
  const t = useT();
  const [tracking, setTracking] = useState('');
  useOnOpen(open, () => setTracking(''));
  const s = useDialogSubmit(() => ordersApi.shipManual(order.id, { trackingNumber: tracking.trim() || null, version: order.version }));
  const submit = async () => {
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.ship.done', { number: order.number }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('orders.ship.title')}
      description={orderContext(t, order)}
      closeLabel={t('action.close')}
      size="sm"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.markShipped')} />}
    >
      <div className="flex flex-col gap-3" data-testid="ship-dialog">
        <Field label={t('orders.ship.tracking')} htmlFor="ship-tracking" hint={t('orders.ship.hint')}>
          <CodeInput id="ship-tracking" value={tracking} maxLength={80} onChange={(e) => setTracking(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
