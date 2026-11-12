'use client';
// "Modifier l'adresse de livraison" (DLG — Orders & delivery): wilaya / commune pickers fed by `/geo/*`, domicile vs
// stop-desk (agency list of the commune), address (≥ 10 chars at home), phone 2, the recomputed client fee line
// (`GET /delivery/fees/quote`). Locked once a courier parcel exists (409 COURIER_ADDRESS_LOCKED, shown inline).
import { formatMoney } from '@djaber/shared';
import { Dialog, Field, FormAlert, Input, PhoneInput, RadioCards, toast } from '@djaber/ui';
import { useState } from 'react';
import { useFeeQuote } from '@/features/delivery/api';
import { CommuneCombobox, StopdeskCombobox, WilayaCombobox } from '@/features/delivery/geo';
import { useT } from '@/lib/i18n';
import { formatPhoneOnBlur, phonePreview, phonePreviewLine } from '@/lib/phone';
import { ordersApi } from '../api';
import { DialogFooter, orderContext, useDialogSubmit, useOnOpen, type DialogBaseProps } from './common';

type Draft = { wilayaId: number | null; communeId: number | null; isStopdesk: boolean; stopdeskId: string | null; address: string; phone2: string };

export function addressDraftErrors(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (!d.wilayaId) e.wilayaId = 'validation.wilaya';
  if (!d.communeId) e.communeId = 'validation.commune';
  if (!d.isStopdesk && d.address.trim().length < 10) e.address = 'validation.address';
  if (d.phone2.trim() && !phonePreview(d.phone2)?.valid) e.phone2 = 'validation.phone';
  return e;
}

export function AddressDialog({ order, open, onClose, onDone }: DialogBaseProps & { open: boolean }) {
  const t = useT();
  const [d, setD] = useState<Draft>({ wilayaId: null, communeId: null, isStopdesk: false, stopdeskId: null, address: '', phone2: '' });
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    const a = order.address;
    setD({ wilayaId: a?.wilayaId ?? null, communeId: a?.communeId ?? null, isStopdesk: a?.isStopdesk ?? false, stopdeskId: a?.stopdeskId ?? null, address: a?.address ?? '', phone2: order.clientPhone2 ?? '' });
    setTouched(false);
  });
  const quote = useFeeQuote({ wilayaId: open ? d.wilayaId : null, stopdesk: d.isStopdesk, subtotal: order.subtotal });
  const errors = touched ? addressDraftErrors(d) : {};
  const s = useDialogSubmit(() =>
    ordersApi.address(order.id, {
      wilayaId: d.wilayaId!,
      communeId: d.communeId,
      isStopdesk: d.isStopdesk,
      stopdeskId: d.isStopdesk ? d.stopdeskId : null,
      address: d.address.trim() || null,
      phone2: d.phone2.trim() || null,
    }),
  );
  const submit = async () => {
    setTouched(true);
    if (Object.keys(addressDraftErrors(d)).length) return;
    const r = await s.submit();
    if (r === undefined) return;
    toast(t('orders.address.saved'));
    await onDone(r);
    onClose();
  };
  const err = (k: keyof Draft) => (errors[k] ? t(errors[k]!) : s.fieldError(k));
  const q = quote.data;
  const feeLine = !d.wilayaId
    ? null
    : !q
      ? t('common.loading')
      : !q.wilayaServed
        ? t('error.WILAYA_NOT_SERVED')
        : t('orders.address.fee', { fee: formatMoney(q.fee), total: formatMoney(order.subtotal - order.discount + q.fee) });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('dialog.editAddress.title')}
      description={`${orderContext(t, order)} · ${t('orders.address.lockNote')}`}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="address-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`${t('common.wilaya')} *`} htmlFor="ad-wilaya" error={err('wilayaId')}>
            <WilayaCombobox id="ad-wilaya" value={d.wilayaId} onChange={(wilayaId) => setD((x) => ({ ...x, wilayaId, communeId: wilayaId === x.wilayaId ? x.communeId : null, stopdeskId: null }))} invalid={!!err('wilayaId')} />
          </Field>
          <Field label={`${t('common.commune')} *`} htmlFor="ad-commune" error={err('communeId')}>
            <CommuneCombobox id="ad-commune" wilayaId={d.wilayaId} value={d.communeId} onChange={(communeId) => setD((x) => ({ ...x, communeId, stopdeskId: null }))} invalid={!!err('communeId')} />
          </Field>
        </div>
        <RadioCards<'home' | 'stopdesk'>
          label={t('orders.address.mode')}
          columns={2}
          value={d.isStopdesk ? 'stopdesk' : 'home'}
          onChange={(v) => setD((x) => ({ ...x, isStopdesk: v === 'stopdesk' }))}
          options={[
            { value: 'home', label: q && !q.isStopdesk ? `${t('common.home')} · ${formatMoney(q.base)}` : t('common.home'), description: t('orders.address.homeHint') },
            { value: 'stopdesk', label: t('common.stopdesk'), description: t('orders.address.stopdeskHint') },
          ]}
        />
        {d.isStopdesk ? (
          <Field label={t('geo.stopdesk.placeholder')} htmlFor="ad-stopdesk">
            <StopdeskCombobox id="ad-stopdesk" communeId={d.communeId} value={d.stopdeskId} onChange={(stopdeskId) => setD((x) => ({ ...x, stopdeskId }))} />
          </Field>
        ) : null}
        <Field label={d.isStopdesk ? t('common.address') : `${t('common.address')} *`} htmlFor="ad-address" hint={d.isStopdesk ? undefined : t('orders.address.addressHint')} error={err('address')}>
          <Input id="ad-address" value={d.address} maxLength={500} onChange={(e) => setD((x) => ({ ...x, address: e.target.value }))} aria-invalid={!!err('address') || undefined} />
        </Field>
        <Field label={t('common.phone2')} htmlFor="ad-phone2" error={err('phone2')}>
          <PhoneInput id="ad-phone2" value={d.phone2} format={formatPhoneOnBlur} onChange={(e) => setD((x) => ({ ...x, phone2: e.target.value }))} preview={phonePreviewLine(t, d.phone2)} />
        </Field>
        {feeLine ? <p className="rounded-card border border-line-edge px-3 py-2 ts-label-micro !normal-case text-text-muted" data-testid="address-fee">{feeLine}</p> : null}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
