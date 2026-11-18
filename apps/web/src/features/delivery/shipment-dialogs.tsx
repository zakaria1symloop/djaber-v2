'use client';
// Parcel dialogs (DLG "Orders & delivery" + DLG II, MECH Delivery row menu, DLV-08 failure actions; 04 §22, FL-25):
// Annuler le colis (before pickup; after ⇒ COURIER_CANCEL_NOT_ALLOWED; options back to Confirmée / cancel the order) ·
// Changer de transporteur (recomputes the courier cost only, D15) · Échec de livraison (FailureReason) · Relancer la
// livraison (attempt +1) · Marquer livrée manuellement (COD rule) · Marquer retournée (restock, return fee).
// Server errors render inline inside the open dialog; the content is preserved.
import { formatMoney } from '@djaber/shared';
import { Checkbox, Dialog, Field, FormAlert, Input, MoneyInput, RadioCards, toast } from '@djaber/ui';
import { useState } from 'react';
import { ClosedDayHint } from '@/components/closed-day-hint';
import { DialogFooter, RadioList, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { effectiveDateError, isoToLocalInput, localInputToIso } from '@/features/orders/logic';
import { ORDER_BACKDATE_MAX_DAYS } from '@/features/orders/contracts';
import { useT } from '@/lib/i18n';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { deliveryApi, useCouriers } from './api';
import { FAILURE_REASONS, type FailureReason, type Shipment } from './contracts';

/** What every parcel dialog needs: the parcel and its order (number, client, amounts). */
export type ParcelRef = {
  id: string;
  orderId: string;
  orderNumber: string;
  clientName: string;
  courierName: string | null;
  trackingNumber: string | null;
  courierAccountId: string | null;
  provider: string;
  codAmount: number;
  total: number;
  deliveryAttempts: number;
};
type Props = { parcel: ParcelRef; open: boolean; onClose: () => void; onDone: (s?: Shipment | null) => void | Promise<void> };

const context = (p: ParcelRef) => [`#${p.orderNumber}`, p.courierName, p.trackingNumber, p.clientName].filter(Boolean).join(' · ');

/* ---------- Annuler le colis ---------- */
export function CancelParcelDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const [then, setThen] = useState<'confirmed' | 'cancelled'>('confirmed');
  useOnOpen(open, () => setThen('confirmed'));
  const s = useDialogSubmit(() => deliveryApi.cancel(parcel.id, { then, ...(then === 'cancelled' ? { reason: 'other' as const } : {}) }));
  const submit = async () => {
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('parcel.cancel.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('parcel.cancel.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('parcel.cancel.submit')} closeLabel={t('action.keep')} danger />}
    >
      <div className="flex flex-col gap-3" data-testid="cancel-parcel-dialog">
        <p className="ts-label-micro !normal-case text-text-muted">{t('parcel.cancel.note')}</p>
        <RadioList<'confirmed' | 'cancelled'>
          label={t('parcel.cancel.title')}
          value={then}
          onChange={setThen}
          options={[
            { value: 'confirmed', label: t('parcel.cancel.backToConfirmed') },
            { value: 'cancelled', label: t('parcel.cancel.cancelOrder') },
          ]}
        />
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Changer de transporteur ---------- */
export function ChangeCourierDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const couriers = useCouriers(open);
  const others = (couriers.data ?? []).filter((c) => c.isActive && c.id !== parcel.courierAccountId);
  const [to, setTo] = useState<string>('');
  useOnOpen(open, () => setTo(''));
  const s = useDialogSubmit(() => deliveryApi.changeCourier(parcel.id, to));
  const submit = async () => {
    if (!to) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('parcel.changeCourier.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('parcel.changeCourier.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('parcel.changeCourier.submit')} disabled={!to} note={t('parcel.changeCourier.note')} />}
    >
      <div className="flex flex-col gap-3" data-testid="change-courier-dialog">
        {couriers.data && !others.length ? <FormAlert tone="info">{t('parcel.changeCourier.none')}</FormAlert> : null}
        {others.length ? <RadioCards label={t('common.courier')} columns={2} value={to} onChange={setTo} options={others.map((c) => ({ value: c.id, label: c.displayName, description: t(`couriers.provider.${c.provider}`) }))} /> : null}
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Échec de livraison ---------- */
export function MarkFailedDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setReason(null);
    setNote('');
    setTouched(false);
  });
  const s = useDialogSubmit(() => deliveryApi.markFailed(parcel.id, { reason: reason!, note: note.trim() || null }));
  const submit = async () => {
    setTouched(true);
    if (!reason) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('parcel.failed.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('parcel.failed.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('parcel.failed.submit')} note={t('parcel.failed.note')} />}
    >
      <div className="flex flex-col gap-3" data-testid="mark-failed-dialog">
        <Field label={t('orders.return.reason')} error={touched && !reason ? t('validation.required') : s.fieldError('reason')}>
          <RadioList<FailureReason> label={t('orders.return.reason')} value={reason} onChange={setReason} options={FAILURE_REASONS.map((r) => ({ value: r, label: t(`orders.return.reason.${r}`) }))} />
        </Field>
        <Field label={t('common.noteOptional')} htmlFor="mf-note">
          <Input id="mf-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Relancer la livraison (adapter retryDelivery, attempt +1) ---------- */
export function RetryDeliveryDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const [note, setNote] = useState('');
  useOnOpen(open, () => setNote(''));
  const s = useDialogSubmit(() => deliveryApi.retryDelivery(parcel.id, note.trim() || null));
  const submit = async () => {
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('parcel.retryDelivery.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('parcel.retryDelivery.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('parcel.retryDelivery.submit')} />}
    >
      <div className="flex flex-col gap-3" data-testid="retry-delivery-dialog">
        <p className="text-[13px] text-text-secondary">{t('parcel.retryDelivery.attempt', { attempt: parcel.deliveryAttempts + 1, max: 3 })}</p>
        <Field label={t('parcel.retryDelivery.message')} htmlFor="rd-note" hint={t('parcel.retryDelivery.hint')}>
          <Input id="rd-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Marquer livrée manuellement (COD rule) ---------- */
export function ParcelDeliveredDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setAmount(moneyDigits(parcel.codAmount));
    setReason('');
    setDay(isoToLocalInput(new Date()));
    setTouched(false);
  });
  const collected = digitsToInt(amount);
  const differs = collected !== null && collected !== parcel.codAmount;
  const deliveredAt = localInputToIso(day);
  const dateErr = effectiveDateError(deliveredAt, new Date(), ORDER_BACKDATE_MAX_DAYS);
  const s = useDialogSubmit(() => deliveryApi.markDelivered(parcel.id, { amountCollected: collected ?? parcel.codAmount, reason: differs ? reason.trim() : null, deliveredAt: deliveredAt ?? undefined }));
  const submit = async () => {
    setTouched(true);
    if (collected === null || (differs && !reason.trim()) || dateErr) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.deliver.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.markDelivered.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('orders.deliver.submit')} />}
    >
      <div className="flex flex-col gap-4" data-testid="parcel-deliver-dialog">
        <Field label={t('orders.deliver.amount')} htmlFor="pd-amount" hint={t('orders.deliver.amountHint')} error={touched && collected === null ? t('validation.required') : s.fieldError('amountCollected')}>
          <MoneyInput id="pd-amount" value={amount} onValueChange={setAmount} />
        </Field>
        <Field label={t('orders.deliver.reason')} htmlFor="pd-reason" error={touched && differs && !reason.trim() ? t('validation.required') : s.fieldError('reason')}>
          <Input id="pd-reason" value={reason} maxLength={500} disabled={!differs} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('orders.deliver.date')} htmlFor="pd-day" error={touched && dateErr ? t('orders.status.effectiveError', { days: ORDER_BACKDATE_MAX_DAYS }) : undefined}>
          <Input id="pd-day" type="datetime-local" value={day} max={isoToLocalInput(new Date())} onChange={(e) => setDay(e.target.value)} className="[color-scheme:dark]" />
        </Field>
        {/* journey J08-12 #1: « (payé : …) » had no value — what was already paid (total − COD) + what is cashed now */}
        <p className="rounded-card border border-line-edge px-3 py-2 ts-label-micro !normal-case text-text-muted">{t('orders.deliver.effects', { amount: formatMoney(collected ?? parcel.codAmount), paid: formatMoney(Math.max(0, parcel.total - parcel.codAmount) + (collected ?? parcel.codAmount)) })}</p>
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Marquer retournée ("retour reçu") ---------- */
export function ParcelReturnedDialog({ parcel, open, onClose, onDone }: Props) {
  const t = useT();
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [restock, setRestock] = useState(true);
  // journey J08r-3: only a courier bills a return (04 §5 D27) — a self-delivered parcel has no fee box and books nothing
  const byCourier = parcel.provider !== 'manual';
  const [fee, setFee] = useState(byCourier);
  const [note, setNote] = useState('');
  useOnOpen(open, () => {
    setReason(null);
    setRestock(true);
    setFee(byCourier);
    setNote('');
  });
  const s = useDialogSubmit(() => deliveryApi.markReturned(parcel.id, { ...(reason ? { reason } : {}), restoreStock: restock, ...(fee && byCourier ? {} : { returnFee: 0 }), note: note.trim() || null }));
  const submit = async () => {
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.return.done', { number: parcel.orderNumber }));
    await onDone(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.markReturned.title')}
      description={context(parcel)}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.markReturned')} note={t('orders.return.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="parcel-return-dialog">
        <RadioList<FailureReason> label={t('orders.return.reason')} value={reason} onChange={setReason} options={FAILURE_REASONS.map((r) => ({ value: r, label: t(`orders.return.reason.${r}`) }))} />
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5" />
          <span>
            {t('parcel.return.restock')}
            <span className="block ts-label-micro !normal-case text-text-muted">{t('orders.return.restockHint')}</span>
          </span>
        </label>
        {byCourier ? (
          <label className="flex items-start gap-2 text-[13px]">
            <Checkbox checked={fee} onChange={(e) => setFee(e.target.checked)} className="mt-0.5" />
            <span>
              {t('orders.return.feeGrid')}
              <span className="block ts-label-micro !normal-case text-text-muted">{t('orders.return.feeHint')}</span>
            </span>
          </label>
        ) : (
          <p className="text-[12px] text-text-secondary" data-testid="return-self-no-fee">
            {t('orders.return.selfNoFee')}
          </p>
        )}
        <Field label={t('common.noteOptional')} htmlFor="ret-note">
          <Input id="ret-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {s.error ? (
          <FormAlert>
            {s.error}
            <ClosedDayHint day={s.closedDay} />
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}
