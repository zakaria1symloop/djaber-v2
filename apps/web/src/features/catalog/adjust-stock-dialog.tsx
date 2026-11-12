'use client';
// "Ajuster le stock" — Figma "GDS-01 — Stock dashboard (advanced) + adjust dialog" and DLG GDS II "Ajuster le stock — cas":
// variant required on a variant product (PRODUCT_HAS_VARIANTS), Entrée / Sortie / Définir, reason required, note,
// result preview, STOCK_INSUFFICIENT inline with "Forcer (stock négatif)", zero quantity disabled (STOCK_QUANTITY_ZERO).
// `POST /stock/adjustments` with an Idempotency-Key created when the dialog opens and reused on retry.
import { formatNumber, STOCK_ADJUSTMENT_REASONS, type StockAdjustmentInput } from '@djaber/shared';
import { Button, Checkbox, Combobox, Dialog, Field, FormAlert, Input, NumberInput, RadioCards, Select, Skeleton, toast, type ComboOption } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useCan, useWorkspaceId } from '@/lib/session';
import { catalogApi, useCatalogRefresh, useProduct } from './api';
import type { ProductListItem, Variant } from './contracts';
import { uuid } from '@/lib/uuid';

export type AdjustTarget = Pick<ProductListItem, 'id' | 'name' | 'trackStock' | 'hasVariants' | 'stock'> & { variants?: Variant[] };
type Kind = StockAdjustmentInput['type'];

/** Quantity after the adjustment (`set` = exact value). */
export const adjustedStock = (current: number, type: Kind, quantity: number): number => (type === 'in' ? current + quantity : type === 'out' ? current - quantity : quantity);

export function AdjustStockDialog({
  open,
  onClose,
  product,
  variantId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** null ⇒ the dialog starts with a product picker ("Ajuster un stock" on the dashboard / movements) */
  product: AdjustTarget | null;
  /** preselected variant */
  variantId?: string | null;
  onDone?: () => void;
}) {
  const t = useT();
  const ws = useWorkspaceId();
  const canForce = useCan('stock.adjust');
  const refresh = useCatalogRefresh();
  const [picked, setPicked] = useState<AdjustTarget | null>(null);
  const [search, setSearch] = useState('');
  const [variant, setVariant] = useState('');
  const [type, setType] = useState<Kind>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [force, setForce] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setSearch('');
    setVariant(variantId ?? '');
    setType('in');
    setQuantity('');
    setReason('');
    setNote('');
    setForce(false);
    setError(null);
    setTouched(false);
    setKey(uuid());
  }, [open, variantId, product?.id]);

  const target = product ?? picked;
  // the variants (and the fresh quantity) come from the product itself
  const detail = useProduct(open && target ? target.id : null);
  const variants = useMemo(() => (detail.data?.variants ?? target?.variants ?? []).filter((v) => v.isActive), [detail.data, target]);
  const hasVariants = detail.data?.hasVariants ?? target?.hasVariants ?? false;
  const selected = variants.find((v) => v.id === variant) ?? null;
  const current = hasVariants ? (selected?.stock ?? null) : (detail.data?.stock ?? target?.stock ?? 0);
  const targetName = target ? (selected ? `${target.name} · ${selected.name}` : target.name) : '';

  const candidates = useQuery({
    queryKey: [ws, 'products', 'picker', search],
    queryFn: () => catalogApi.products({ q: search.trim().length >= 2 ? search.trim() : '', type: ['stock'], status: ['active'], pageSize: 25, page: 1, sort: 'name' }),
    enabled: open && !product && !!ws,
  });
  const options: ComboOption[] = (candidates.data?.rows ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.sku }));

  const qty = quantity === '' ? null : Number(quantity);
  const after = current !== null && qty !== null ? adjustedStock(current, type, qty) : null;
  const zero = qty !== null && (type === 'set' ? current !== null && qty === current : qty === 0);
  const insufficient = type === 'out' && after !== null && after < 0;
  const missingVariant = hasVariants && !selected;
  const invalid = !target || missingVariant || qty === null || zero || !reason || (insufficient && !force);

  const save = useMutation({
    mutationFn: () =>
      catalogApi.adjust(
        { productId: target!.id, variantId: hasVariants ? variant : null, type, quantity: qty!, reason: reason as StockAdjustmentInput['reason'], note: note.trim() || null, ...(force ? { force: true } : {}) },
        key,
      ),
  });
  const submit = async () => {
    setTouched(true);
    if (invalid || !target) return;
    setError(null);
    try {
      await save.mutateAsync();
      await refresh({ productId: target.id });
      toast(t('stock.adjust.done', { name: targetName }));
      onDone?.();
      onClose();
    } catch (e) {
      // the same key replays the stored answer; a refused request needs a new key for the corrected attempt
      setKey(uuid());
      setError({ message: errorMessage(e, t), code: e instanceof ApiError ? e.code : null });
      if (e instanceof ApiError && e.code === 'STOCK_INSUFFICIENT') void detail.refetch();
    }
  };

  const busy = save.isPending;
  const service = !!target && (detail.data?.trackStock ?? target.trackStock) === false;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.adjustStock.title')}
      description={target ? `${target.name.toUpperCase()}${hasVariants ? ` · ${t('stock.adjust.variantProduct')}` : ''}` : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={service} disabledReason={zero ? t('error.STOCK_QUANTITY_ZERO') : undefined}>
            {t('stock.adjust.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!product ? (
          <Field label={t('stock.adjust.product')} htmlFor="adj-product" required error={touched && !target ? t('validation.required') : undefined}>
            <Combobox
              id="adj-product"
              value={picked?.id ?? null}
              onChange={(id) => {
                const row = candidates.data?.rows.find((p) => p.id === id) ?? null;
                setPicked(row);
                setVariant('');
              }}
              options={picked && !options.some((o) => o.value === picked.id) ? [{ value: picked.id, label: picked.name }, ...options] : options}
              onSearch={setSearch}
              loading={candidates.isFetching}
              placeholder={t('stock.adjust.productPlaceholder')}
              searchPlaceholder={t('stock.adjust.productSearch')}
              emptyLabel={t('state.list.filteredEmpty.title')}
              disabled={busy}
              invalid={touched && !target}
            />
          </Field>
        ) : null}

        {service ? <FormAlert tone="warning">{t('error.PRODUCT_NOT_STOCK_TRACKED')}</FormAlert> : null}

        {target && hasVariants ? (
          detail.isPending && !variants.length ? (
            <Skeleton className="h-10" />
          ) : (
            <Field label={t('stock.adjust.variant')} htmlFor="adj-variant" required hint={t('stock.adjust.variantHint')} error={(touched && missingVariant) || error?.code === 'PRODUCT_HAS_VARIANTS' || error?.code === 'VARIANT_REQUIRED' ? t('error.PRODUCT_HAS_VARIANTS') : undefined}>
              <Select id="adj-variant" value={variant} disabled={busy} aria-invalid={touched && missingVariant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">{t('stock.adjust.variantPlaceholder')}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t('stock.adjust.variantOption', { name: v.name, stock: formatNumber(v.stock) })}
                  </option>
                ))}
              </Select>
            </Field>
          )
        ) : null}

        <RadioCards<Kind>
          label={t('stock.adjust.type')}
          value={type}
          onChange={(v) => {
            setType(v);
            setForce(false);
          }}
          options={[
            { value: 'in', label: t('stock.adjust.in'), description: t('stock.adjust.inHint') },
            { value: 'out', label: t('stock.adjust.out'), description: t('stock.adjust.outHint') },
            { value: 'set', label: t('stock.adjust.set'), description: t('stock.adjust.setHint') },
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.quantity')} htmlFor="adj-qty" required error={touched && qty === null ? t('validation.quantity') : zero ? t('error.STOCK_QUANTITY_ZERO') : undefined}>
            <NumberInput id="adj-qty" value={quantity} onValueChange={setQuantity} disabled={busy || service} maxDigits={7} aria-invalid={(touched && qty === null) || zero} />
          </Field>
          <Field label={t('common.reason')} htmlFor="adj-reason" required error={touched && !reason ? t('validation.required') : undefined}>
            <Select id="adj-reason" value={reason} disabled={busy || service} aria-invalid={touched && !reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('stock.adjust.reasonPlaceholder')}</option>
              {STOCK_ADJUSTMENT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`enum.StockMovement.reason.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('common.note')} htmlFor="adj-note">
          <Input id="adj-note" value={note} maxLength={255} disabled={busy || service} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {insufficient && current !== null ? (
          <FormAlert>
            {t('stock.adjust.insufficient', { name: selected?.name ?? target?.name ?? '', count: current })}
            {canForce ? (
              <label className="mt-2 flex cursor-pointer items-center gap-2 normal-case text-text-primary">
                <Checkbox checked={force} disabled={busy} onChange={(e) => setForce(e.target.checked)} />
                {t('stock.adjust.force')}
              </label>
            ) : null}
          </FormAlert>
        ) : null}
        {error && !(error.code === 'PRODUCT_HAS_VARIANTS' || error.code === 'VARIANT_REQUIRED') ? <FormAlert>{error.message}</FormAlert> : null}

        {target && current !== null && after !== null && !zero ? (
          <p className="ts-label-meta text-text-muted" data-testid="adjust-preview">
            {t(insufficient && !force ? 'stock.adjust.previewBlocked' : 'stock.adjust.preview', {
              name: selected?.name ?? target.name,
              from: formatNumber(current),
              to: `${after < 0 ? '−' : ''}${formatNumber(Math.abs(after))}`,
              type: t(`stock.adjust.movement.${type === 'in' || (type === 'set' && after > current) ? 'in' : 'out'}`),
            })}
          </p>
        ) : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('stock.adjust.submit')}
        </button>
      </form>
    </Dialog>
  );
}
