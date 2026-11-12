'use client';
// "3 · LIVRAISON" of the new order form (Figma ORD-02 "fee quote"; 04 §4, DLV-01/02): wilaya → communes, domicile /
// stop-desk, address (≥ 10 characters for home delivery), fee quoted from the grid by `GET /delivery/fees/quote`
// (grid / free from the threshold / not served) and the Admin+ override "Modifier (Admin)" (`orders.money`).
import { formatMoney } from '@djaber/shared';
import { Button, Field, FeeQuoteBar, Input, Ltr, MoneyInput, OrderFormCard, SegmentedControl } from '@djaber/ui';
import type { FeeQuote } from '@/features/delivery/contracts';
import { CommuneCombobox, StopdeskCombobox, WilayaCombobox } from '@/features/delivery/geo';
import { fieldError } from '@/lib/forms';
import type { TFunction } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { ADDRESS_MIN, type FormErrors, type OrderFormValues } from './model';

type Delivery = Pick<OrderFormValues, 'wilayaId' | 'communeId' | 'isStopdesk' | 'stopdeskId' | 'address' | 'feeOverride'>;

/** Mono line under the fee: "GRILLE SÉTIF · DOMICILE 400 DA → OFFERTE (SOUS-TOTAL ≥ 5 000 DA) · COÛT TRANSPORTEUR 450 DA". */
export function feeExplanation(t: TFunction, q: FeeQuote, wilayaName: string | null, override: number | null): string {
  const mode = t(q.isStopdesk ? 'orderForm.delivery.fee.stopdesk' : 'orderForm.delivery.fee.home');
  const parts: string[] = [];
  if (override !== null) parts.push(t('orderForm.delivery.fee.overridden', { base: formatMoney(q.base) }));
  else if (q.reason === 'free_threshold')
    parts.push(
      t('orderForm.delivery.fee.free', {
        wilaya: wilayaName ?? '',
        mode,
        base: formatMoney(q.base),
        threshold: formatMoney(q.freeFrom ?? 0),
      }),
    );
  else
    parts.push(
      t('orderForm.delivery.fee.grid', {
        wilaya: wilayaName ?? '',
        mode,
        base: formatMoney(q.base),
      }),
    );
  if (q.courierCost !== null) parts.push(t('orderForm.delivery.fee.courierCost', { cost: formatMoney(q.courierCost) }));
  return parts.join(' · ').toUpperCase();
}

export function DeliverySection({
  value,
  onChange,
  errors,
  locked,
  required,
  quote,
  quoting,
  quoteError,
  wilayaName,
  canOverride,
  prefilled,
}: {
  value: Delivery;
  onChange: (patch: Partial<Delivery>) => void;
  errors: FormErrors;
  locked: boolean;
  /** status "Confirmée": wilaya, commune and address are required (ORDER_ADDRESS_REQUIRED) */
  required: boolean;
  quote: FeeQuote | null;
  quoting: boolean;
  quoteError: string | null;
  wilayaName: string | null;
  /** `orders.money` (Admin+) */
  canOverride: boolean;
  /** the address comes from the client's default address */
  prefilled: boolean;
}) {
  const t = useT();
  const err = (k: 'wilayaId' | 'communeId' | 'address' | 'feeOverride') =>
    errors[k]
      ? fieldError(t, errors[k]!.key, {
          min: ADDRESS_MIN,
          ...(errors[k]!.params as Record<string, string | number>),
        })
      : undefined;
  const overriding = value.feeOverride !== '';
  const override = overriding ? Number(value.feeOverride) : null;
  const notServed = !!quote && !quote.wilayaServed;
  const stopdeskOff = !!quote && quote.reason === 'stopdesk_unavailable' && !overriding;
  const fee = override ?? quote?.fee ?? null;

  const title = !value.wilayaId
    ? t('orderForm.delivery.fee.pickWilaya')
    : notServed
      ? t('orderForm.delivery.fee.notServed')
      : stopdeskOff
        ? t('orderForm.delivery.fee.stopdeskOff')
        : fee === null
          ? t('common.loading')
          : quote?.free && !overriding
            ? t('orderForm.delivery.fee.titleFree', { amount: formatMoney(0) })
            : t('orderForm.delivery.fee.title', { amount: formatMoney(fee) });

  return (
    <OrderFormCard index={3} title={t('orderForm.delivery.title')} badge={t('orderForm.delivery.badge')} data-section="delivery">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.wilaya')} htmlFor="wilayaId" required={required} error={err('wilayaId')}>
          <WilayaCombobox id="wilayaId" value={value.wilayaId} disabled={locked} invalid={!!errors.wilayaId} onChange={(id) => onChange({ wilayaId: id, communeId: null, stopdeskId: null })} />
        </Field>
        <Field label={t('common.commune')} htmlFor="communeId" required={required} error={err('communeId')} hint={t('orderForm.delivery.communeHint')}>
          <CommuneCombobox
            id="communeId"
            wilayaId={value.wilayaId}
            value={value.communeId}
            disabled={locked}
            invalid={!!errors.communeId}
            onChange={(id) => onChange({ communeId: id, stopdeskId: null })}
          />
        </Field>
      </div>

      <SegmentedControl
        label={t('orderForm.delivery.mode')}
        value={value.isStopdesk ? 'stopdesk' : 'home'}
        disabled={locked}
        onChange={(v) => onChange({ isStopdesk: v === 'stopdesk' })}
        options={[
          { value: 'home', label: t('orderForm.delivery.home') },
          { value: 'stopdesk', label: t('common.stopdesk') },
        ]}
      />

      {value.isStopdesk ? (
        <Field label={t('orderForm.delivery.stopdesk')} htmlFor="stopdeskId" hint={t('orderForm.delivery.stopdeskHint')}>
          <StopdeskCombobox id="stopdeskId" communeId={value.communeId} value={value.stopdeskId} disabled={locked} onChange={(id) => onChange({ stopdeskId: id })} />
        </Field>
      ) : null}

      <Field
        label={t('common.address')}
        htmlFor="address"
        required={required && !value.isStopdesk}
        error={err('address')}
        hint={prefilled ? t('orderForm.delivery.addressPrefilled', { min: ADDRESS_MIN }) : t('orderForm.delivery.addressHint', { min: ADDRESS_MIN })}
      >
        <Input
          id="address"
          dir="auto"
          maxLength={500}
          disabled={locked}
          aria-invalid={!!errors.address}
          value={value.address}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder={t('orderForm.delivery.addressPlaceholder')}
        />
      </Field>

      <FeeQuoteBar
        tone={notServed || stopdeskOff ? 'danger' : !value.wilayaId ? 'muted' : undefined}
        title={<span data-testid="fee-title">{title}</span>}
        explanation={
          quoteError ? (
            <span className="text-accent-alert">{quoteError}</span>
          ) : notServed ? (
            t('error.WILAYA_NOT_SERVED')
          ) : quote && value.wilayaId && !quoting ? (
            <Ltr className="!inline">{feeExplanation(t, quote, wilayaName, override)}</Ltr>
          ) : undefined
        }
        action={
          canOverride && value.wilayaId && !locked && !notServed ? (
            overriding ? (
              <Button size="sm" variant="ghost" onClick={() => onChange({ feeOverride: '' })} data-testid="fee-reset">
                {t('orderForm.delivery.fee.backToGrid')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onChange({ feeOverride: String(quote?.fee ?? 0) })} data-testid="fee-override">
                {t('orderForm.delivery.fee.override')}
              </Button>
            )
          ) : undefined
        }
      >
        {overriding ? (
          <Field label={t('orderForm.delivery.fee.overrideLabel')} htmlFor="feeOverride" error={err('feeOverride')} hint={t('orderForm.delivery.fee.overrideHint')}>
            <MoneyInput id="feeOverride" value={value.feeOverride} onValueChange={(v) => onChange({ feeOverride: v === '' ? '0' : v })} disabled={locked} className="max-w-48" />
          </Field>
        ) : null}
      </FeeQuoteBar>
    </OrderFormCard>
  );
}
