'use client';
// "Envoyer #CMD-1040 au transporteur" — Figma "DLV-05 — Delivery — send to courier dialog (validation error)" (DLV-05,
// FL-08). Prefilled from the ORDER (never the sender default), every field editable: courier radios with the courier
// cost + average delay (default courier first), wilaya / commune, À domicile / Stop-desk, stop-desk point (required
// for a stop-desk with a courier that has points), address, COD, weight, content. States: editing · creating (202) ·
// sending… (parcel `pending` until WS `shipment.updated`) · sent (tracking) · queued (`COURIER_UNAVAILABLE`, retries)
// · courier refusal mapped to its field + banner "rien n'a été créé chez le transporteur" (AT-DLV-02) · no courier.
import { formatMoney, formatPhoneDz } from '@djaber/shared';
import { Button, buttonClass, Dialog, Field, FormAlert, Input, Ltr, MoneyInput, RadioCards, SegmentedControl, Skeleton, toast } from '@djaber/ui';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DialogFooter, useOnOpen } from '@/features/orders/dialogs/common';
import type { Order } from '@/features/orders/contracts';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { deliveryApi, deliveryKeys, useCourierProviders, useCouriers, useDeliveryOverview, useDeliveryRefresh, useShipment } from './api';
import { CourierDialog } from './couriers';
import type { ShipmentErrorView } from '@djaber/shared';
import type { CourierAccount, Shipment } from './contracts';
import { CommuneCombobox, StopdeskCombobox, WilayaCombobox } from './geo';
import { courierErrorField, daysLabel, parseWeight } from './logic';

type Draft = { courierId: string | null; wilayaId: number | null; communeId: number | null; communeText: string | null; isStopdesk: boolean; stopdeskId: string | null; address: string; cod: string; weight: string; content: string };
type FieldKey = 'courier' | 'wilaya' | 'commune' | 'stopdesk' | 'address' | 'cod' | 'weight' | 'content' | 'phone';

/** "Robe satin ×1, Foulard soie ×2" */
export const contentOf = (o: Pick<Order, 'items'>): string =>
  o.items
    .map((i) => `${i.productName}${i.variantName ? ` (${i.variantName})` : ''} ×${i.quantity}`)
    .join(', ')
    .slice(0, 200);

const draftOf = (o: Order, couriers: CourierAccount[]): Draft => {
  const a = o.address;
  const active = couriers.filter((c) => c.isActive);
  return {
    courierId: (active.find((c) => c.isDefault) ?? active[0])?.id ?? null,
    wilayaId: a?.wilayaId ?? null,
    communeId: a?.communeId ?? null,
    communeText: a?.communeText ?? null,
    isStopdesk: a?.isStopdesk ?? false,
    stopdeskId: a?.stopdeskId ?? null,
    address: a?.address ?? '',
    cod: moneyDigits(o.remaining),
    weight: '',
    content: contentOf(o),
  };
};

export function SendToCourierDialog({
  order,
  open,
  onClose,
  onDone,
  initialError,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onDone: (order?: Order | null) => void | Promise<void>;
  /** "Corriger et renvoyer": the courier refusal of the failed parcel, shown on its field when the dialog opens */
  initialError?: ShipmentErrorView | null;
}) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const refresh = useDeliveryRefresh();
  const couriers = useCouriers(open);
  const qc = useQueryClient();
  const { can } = useSession();
  const [addCourier, setAddCourier] = useState(false);
  const providers = useCourierProviders(open && !!couriers.data && !couriers.data.some((c) => c.isActive));
  const overview = useDeliveryOverview(open);
  const active = useMemo(() => (couriers.data ?? []).filter((c) => c.isActive), [couriers.data]);
  const [d, setD] = useState<Draft | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [fields, setFields] = useState<Partial<Record<FieldKey, string>>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const key = useRef(uuid());

  useOnOpen(open, () => {
    setD(null);
    setTouched(false);
    const e = initialError ?? null;
    const msg = e ? (e.message ?? t(`error.${e.code}`, { message: '' })) : '';
    setBanner(e ? { tone: 'danger', text: e.code === 'COURIER_VALIDATION' ? t('send.courierRefused', { message: msg }) : msg } : null);
    const f = e ? courierErrorField(e.field) : null;
    setFields(e && f ? { [f]: msg } : {});
    setPendingId(null);
    key.current = uuid();
  });
  // the draft is built once the couriers are known (default courier preselected)
  useEffect(() => {
    if (open && !d && couriers.data) setD(draftOf(order, couriers.data));
  }, [open, d, couriers.data, order]);

  const courier = active.find((c) => c.id === d?.courierId) ?? null;
  const rates = useQueries({
    queries: active.map((c) => {
      const q = { courierAccountId: c.id, ...(d?.wilayaId ? { wilayaId: d.wilayaId } : {}), stopdesk: !!d?.isStopdesk };
      return { queryKey: deliveryKeys.rates(ws, q), queryFn: () => deliveryApi.rates(q), enabled: open && !!d?.wilayaId && c.capabilities.rates, staleTime: 3_600_000, retry: false, refetchInterval: (q: { state: { data?: { refreshing: boolean } } }) => (q.state.data?.refreshing ? 3_000 : false) };
    }),
  });
  const costOf = (c: CourierAccount, i: number): string | null => {
    const r = rates[i]?.data?.rates.find((x) => x.wilayaId === d?.wilayaId);
    const price = r ? (d?.isStopdesk ? r.stopdeskPrice : r.homePrice) ?? r.price : null;
    return price === null || price === undefined ? null : t('send.courierCost', { amount: formatMoney(price) });
  };
  const delayOf = (c: CourierAccount): string | null => daysLabel(overview.data?.kpis.byCourier.find((b) => b.courierAccountId === c.id)?.avgDays ?? null, t('common.daysShort'), locale);

  // sending…: the parcel is read until the worker answered (WS `shipment.updated` refreshes it; polling as fallback)
  const sending = useShipment(pendingId);
  const parcel: Shipment | undefined = sending.data;
  useEffect(() => {
    if (!pendingId || !parcel || parcel.id !== pendingId) return;
    if (parcel.status === 'pending' && !parcel.lastError) return;
    if (parcel.status === 'failed' || (parcel.status === 'pending' && parcel.lastError)) {
      const err = parcel.error;
      const code = err?.code ?? parcel.lastError ?? 'COURIER_UNAVAILABLE';
      if (code === 'COURIER_UNAVAILABLE' && parcel.status === 'pending') return; // queued: shown below, retries running
      const f = courierErrorField(err?.field);
      setBanner({ tone: 'danger', text: t('send.courierRefused', { message: err?.message ?? t(`error.${code}`, { message: '' }) }) });
      if (f) setFields({ [f]: `${err?.message ?? t(`error.${code}`, { message: '' })}` });
      setPendingId(null);
      void refresh({ orderId: order.id });
      return;
    }
    // sent (or beyond): done
    toast(parcel.trackingNumber ? t('send.done', { number: order.number, tracking: parcel.trackingNumber }) : t('orders.send.done', { number: order.number }));
    setPendingId(null);
    void refresh({ shipment: parcel });
    void onDone();
    onClose();
  }, [parcel, pendingId, order, refresh, onClose, onDone, t]);
  const queued = !!parcel && parcel.id === pendingId && parcel.status === 'pending' && parcel.lastError === 'COURIER_UNAVAILABLE';
  // polling while the parcel is pending (the WS event may be missed)
  useEffect(() => {
    if (!pendingId) return;
    const h = setInterval(() => void sending.refetch(), 2_000);
    return () => clearInterval(h);
  }, [pendingId, sending]);

  const set = (patch: Partial<Draft>) => setD((x) => (x ? { ...x, ...patch } : x));
  const needsPoint = !!d?.isStopdesk && !!courier?.capabilities.stopdesk;
  const weight = d ? parseWeight(d.weight) : undefined;
  const cod = d ? digitsToInt(d.cod) : null;
  const local: Partial<Record<FieldKey, string>> = {};
  if (d) {
    if (!d.courierId) local.courier = t('validation.required');
    if (!d.wilayaId) local.wilaya = t('validation.wilaya');
    if (!d.communeId && !d.communeText) local.commune = t('validation.commune');
    if (needsPoint && !d.stopdeskId) local.stopdesk = t('send.stopdeskRequired', { courier: courier?.displayName ?? '' });
    if (!d.isStopdesk && d.address.trim().length < 10) local.address = t('validation.address');
    if (cod === null) local.cod = t('validation.price');
    if (weight !== undefined && (Number.isNaN(weight) || weight < 0.1 || weight > 30)) local.weight = t('send.weightRange');
  }
  const shown = (k: FieldKey) => (touched ? (local[k] ?? fields[k]) : fields[k]);

  const submit = async () => {
    if (!d) return;
    setTouched(true);
    setBanner(null);
    setFields({});
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const s = await deliveryApi.send(
        order.id,
        {
          courierAccountId: d.courierId,
          wilayaId: d.wilayaId!,
          communeId: d.communeId,
          communeText: d.communeId ? null : d.communeText,
          address: d.isStopdesk ? null : d.address.trim(),
          isStopdesk: d.isStopdesk,
          stopdeskId: d.isStopdesk ? d.stopdeskId : null,
          codAmount: cod!,
          ...(weight !== undefined ? { weightKg: weight } : {}),
          contentSummary: d.content.trim() || null,
        },
        key.current,
      );
      key.current = uuid();
      setPendingId(s.id);
      void refresh({ shipment: s });
    } catch (e) {
      if (e instanceof ApiError) {
        const map: Partial<Record<FieldKey, string>> = {};
        for (const [name, msg] of Object.entries(e.body.fields ?? {})) {
          const f = courierErrorField(name);
          if (f) map[f] = t.has(msg) ? t(msg, { max: '', min: '' }) : msg;
        }
        const f = courierErrorField((e.body.params as Record<string, unknown>)?.field ?? (e.body.details as { field?: string } | null)?.field);
        if (e.code === 'COURIER_VALIDATION') {
          setBanner({ tone: 'danger', text: t('send.courierRefused', { message: String(e.body.params?.message ?? e.message) }) });
          if (f) map[f] = e.message;
        } else if (e.code === 'COURIER_UNAVAILABLE') {
          setBanner({ tone: 'warning', text: errorMessage(e, t) });
        } else if (!Object.keys(map).length) setBanner({ tone: 'danger', text: errorMessage(e, t) });
        setFields(map);
      } else setBanner({ tone: 'danger', text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };

  const noCourier = couriers.data && active.length === 0;
  const working = busy || (!!pendingId && !queued);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('send.title', { number: order.number })}
      description={t('send.subtitle')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        queued ? (
          <Button variant="primary" onClick={onClose} data-testid="send-close">
            {t('action.close')}
          </Button>
        ) : noCourier ? (
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
        ) : (
          <DialogFooter onClose={onClose} busy={working} onSubmit={() => void submit()} label={working ? t('send.sending') : t('send.submit')} disabled={!d} />
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="send-dialog" data-state={queued ? 'queued' : pendingId ? 'sending' : banner ? 'error' : 'editing'}>
        {couriers.isPending || (!d && !noCourier) ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : noCourier ? (
          <div className="flex flex-col gap-3" data-testid="send-no-courier">
            <FormAlert tone="info">{t('error.DELIVERY_NO_COURIER')}</FormAlert>
            <p className="text-[13px] text-text-secondary">{t('delivery.noCourier.description')}</p>
            {/* configured right here (nested dialog): the shipment being prepared is not left behind */}
            {can('delivery.manage') ? (
              <Button variant="primary" className="self-start" onClick={() => setAddCourier(true)} data-testid="send-add-courier">
                {t('delivery.noCourier.cta')}
              </Button>
            ) : (
              <Link href="/delivery/couriers" className={buttonClass({ variant: 'primary', className: 'self-start' })}>
                {t('delivery.noCourier.cta')}
              </Link>
            )}
            <CourierDialog
              open={addCourier}
              account={null}
              provider="zrexpress"
              providers={providers.data ?? []}
              existing={couriers.data ?? []}
              onClose={() => setAddCourier(false)}
              onSaved={() => {
                setAddCourier(false);
                void Promise.all([qc.invalidateQueries({ queryKey: deliveryKeys.couriers(ws) }), qc.invalidateQueries({ queryKey: deliveryKeys.overview(ws) })]);
              }}
            />
          </div>
        ) : d ? (
          <>
            <p className="text-[13px] text-text-secondary">
              {order.clientName} · <Ltr className="!inline">{formatPhoneDz(order.clientPhone)}</Ltr>
              {order.clientPhone2 ? (
                <>
                  {' · '}
                  <Ltr className="!inline">{formatPhoneDz(order.clientPhone2)}</Ltr>
                </>
              ) : null}
            </p>
            <Field label={t('common.courier')} error={shown('courier')}>
              <RadioCards
                label={t('common.courier')}
                columns={2}
                value={d.courierId ?? ''}
                onChange={(v) => set({ courierId: v, stopdeskId: null })}
                options={active.map((c, i) => ({
                  value: c.id,
                  label: c.isDefault ? `${c.displayName} · ${t('couriers.default').toUpperCase()}` : c.displayName,
                  description: [costOf(c, i), delayOf(c)].filter(Boolean).join(' · ') || t(`couriers.provider.${c.provider}`),
                }))}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('common.wilaya')} htmlFor="send-wilaya" error={shown('wilaya')}>
                <WilayaCombobox id="send-wilaya" value={d.wilayaId} invalid={!!shown('wilaya')} disabled={working} onChange={(id) => set({ wilayaId: id, communeId: null, communeText: null, stopdeskId: null })} />
              </Field>
              <Field label={t('common.commune')} htmlFor="send-commune" error={shown('commune')} hint={!d.communeId && d.communeText ? t('send.communeText', { commune: d.communeText }) : undefined}>
                <CommuneCombobox id="send-commune" wilayaId={d.wilayaId} value={d.communeId} invalid={!!shown('commune')} disabled={working} onChange={(id, c) => set({ communeId: id, communeText: c?.nameFr ?? null, stopdeskId: null })} />
              </Field>
            </div>
            <SegmentedControl
              label={t('orderForm.delivery.mode')}
              value={d.isStopdesk ? 'stopdesk' : 'home'}
              disabled={working}
              onChange={(v) => set({ isStopdesk: v === 'stopdesk', stopdeskId: null })}
              options={[
                { value: 'home', label: t('orderForm.delivery.home') },
                { value: 'stopdesk', label: t('common.stopdesk') },
              ]}
            />
            {d.isStopdesk ? (
              <Field label={t('send.stopdesk', { courier: courier?.displayName ?? '', commune: d.communeText ?? '' })} htmlFor="send-stopdesk" error={shown('stopdesk')} hint={needsPoint ? undefined : t('send.stopdeskOptional')}>
                <StopdeskCombobox id="send-stopdesk" communeId={d.communeId} provider={courier?.provider} value={d.stopdeskId} invalid={!!shown('stopdesk')} disabled={working} onChange={(id) => set({ stopdeskId: id })} />
              </Field>
            ) : (
              <Field label={t('common.address')} htmlFor="send-address" error={shown('address')}>
                <Input id="send-address" dir="auto" maxLength={500} value={d.address} disabled={working} aria-invalid={!!shown('address') || undefined} onChange={(e) => set({ address: e.target.value })} />
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('send.cod')} htmlFor="send-cod" error={shown('cod')} hint={t('send.codHint', { amount: formatMoney(order.remaining) })}>
                <MoneyInput id="send-cod" value={d.cod} disabled={working} onValueChange={(v) => set({ cod: v })} />
              </Field>
              <Field label={t('send.weight')} htmlFor="send-weight" error={shown('weight')}>
                <Input id="send-weight" inputMode="decimal" dir="ltr" placeholder="0,8" value={d.weight} disabled={working} onChange={(e) => set({ weight: e.target.value })} />
              </Field>
            </div>
            <Field label={t('send.content')} htmlFor="send-content" error={shown('content')}>
              <Input id="send-content" dir="auto" maxLength={200} value={d.content} disabled={working} onChange={(e) => set({ content: e.target.value })} />
            </Field>
            {pendingId && !queued ? (
              <FormAlert tone="info" className="!border-s-accent-inbound">
                <span data-testid="send-pending">{t('send.pending', { courier: courier?.displayName ?? '' })}</span>
              </FormAlert>
            ) : null}
            {queued ? (
              <FormAlert tone="warning">
                <span data-testid="send-queued">{t('send.queued', { courier: courier?.displayName ?? '' })}</span>
              </FormAlert>
            ) : null}
            {banner ? (
              <FormAlert tone={banner.tone}>
                <span data-testid="send-error">{banner.text}</span>
              </FormAlert>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
