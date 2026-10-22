'use client';
// STOCK card of the product form — Figma "CAT-01 — Product form — edit with variants": "Suivre le stock" switch,
// opening stock (create) or read-only quantity + "Ajuster le stock" (edit), and the variants editor
// (VARIANTE · PRIX · STOCK · MIN · actions, "+ Ajouter une variante", "Générer des variantes"). On a new product the
// rows travel in `POST /products`; on a saved one each changed row is saved through the variant endpoints by
// "Enregistrer", its stock is read-only and moves through "Ajuster".
import { formatNumber, VARIANTS_MAX } from '@djaber/shared';
import { ActionsMenu, Button, cn, CodeInput, ConfirmDialog, Field, FormAlert, Input, Ltr, MoneyInput, NumberInput, Pill, SectionLabel, Switch, type MenuAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, type UseFieldArrayReturn, type UseFormReturn } from 'react-hook-form';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Product } from '../contracts';
import { totalVariantStock } from '../variants';
import { emptyVariantRow, VARIANT_NAME_MAX, type ProductFormValues, type VariantField, type VariantRow } from './model';

const GRID = 'grid grid-cols-[minmax(0,1fr)_4.25rem_3rem_2.5rem_2rem] items-center gap-2';
const num = (s: string) => (s === '' ? 0 : Number(s));
/** Colour of a variant quantity: 0 ⇒ alert, at or under its threshold ⇒ starred (frame "Noir · M  1"). */
export const variantStockTone = (stock: number, min: number): string | undefined => (stock <= 0 ? 'text-accent-alert' : stock <= min ? 'text-accent-starred' : undefined);

type Props = {
  form: UseFormReturn<ProductFormValues>;
  rows: UseFieldArrayReturn<ProductFormValues, 'variants', 'rhfId'>;
  values: ProductFormValues;
  mode: 'create' | 'edit';
  product: Product | null;
  advanced: boolean;
  locked: boolean;
  canAdjust: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (key: string, open?: boolean) => void;
  onAdjust: (variantId: string | null) => void;
  onGenerate: () => void;
};

export function StockSection({ form, rows, values, mode, product, advanced, locked, canAdjust, expanded, onToggle, onAdjust, onGenerate }: Props) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const errors = form.formState.errors;
  const variants = values.variants;
  const hasVariants = variants.length > 0;
  const tracked = values.trackStock;
  const [toDelete, setToDelete] = useState<{ row: VariantRow; index: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useMutation({ mutationFn: (variantId: string) => catalogApi.deleteVariant(product!.id, variantId) });

  const total = totalVariantStock(variants.map((r) => ({ stock: num(r.stock), isActive: r.isActive })));
  const atLimit = variants.length >= VARIANTS_MAX;
  const limitReason = atLimit ? `${t('error.VARIANT_LIMIT')} (VARIANT_LIMIT)` : undefined;
  const addRow = () => {
    const row = emptyVariantRow({ price: values.price, costPrice: advanced ? values.costPrice : '' });
    rows.append(row, { shouldFocus: false });
    onToggle(row.key, true);
  };
  const confirmDelete = async () => {
    if (!toDelete?.row.id || !product) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(toDelete.row.id);
      setToDelete(null);
      await refresh({ productId: product.id });
    } catch (e) {
      setDeleteError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };

  const savedTracked = mode === 'edit' && !!product?.trackStock;
  return (
    <section data-section="stock" className="rounded-card border border-line-edge bg-ink-surface p-5">
      <SectionLabel className="mb-4">{t('products.form.stock.title')}</SectionLabel>
      <div className="flex items-start gap-3">
        <span title={hasVariants ? t('products.form.stock.trackLocked') : undefined} className="mt-0.5 shrink-0">
          <Controller control={form.control} name="trackStock" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label={t('products.form.stock.track')} disabled={locked || hasVariants} />} />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-medium">{t('products.form.stock.track')}</div>
          <p className="ts-label-meta mt-0.5 text-text-muted">{hasVariants ? t('products.form.stock.trackLocked') : t('products.form.stock.trackHint')}</p>
        </div>
      </div>
      {errors.trackStock ? <FormAlert className="mt-3">{fieldError(t, errors.trackStock.message)}</FormAlert> : null}
      {/* PV 22/10: orders accepted at zero stock, product by product */}
      {tracked ? (
        <div className="mt-4 flex items-start gap-3" data-testid="sell-out-of-stock">
          <span className="mt-0.5 shrink-0">
            <Controller control={form.control} name="sellOutOfStock" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label={t('products.form.stock.sellOutOfStock')} disabled={locked} />} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-medium">{t('products.form.stock.sellOutOfStock')}</div>
            <p className="ts-label-meta mt-0.5 text-text-muted">{t('products.form.stock.sellOutOfStockHint')}</p>
          </div>
        </div>
      ) : null}

      {tracked && !hasVariants ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {mode === 'create' ? (
            <Field label={t('products.form.stock.initial')} htmlFor="stock" required error={fieldError(t, errors.stock?.message)}>
              <Controller
                control={form.control}
                name="stock"
                render={({ field }) => <NumberInput id="stock" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={8} disabled={locked} aria-invalid={!!errors.stock} />}
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="ts-label-meta uppercase text-text-secondary">{t('products.form.stock.current')}</span>
              <div className="flex h-10 items-center gap-2">
                <Ltr className={cn('text-[18px] font-semibold tabular-nums', savedTracked ? variantStockTone(num(values.stock), num(values.minStock)) : 'text-text-muted')} >
                  <span data-testid="product-stock">{savedTracked ? formatNumber(num(values.stock)) : '—'}</span>
                </Ltr>
              </div>
            </div>
          )}
          <Field label={t('products.form.stock.min')} htmlFor="minStock" error={fieldError(t, errors.minStock?.message)}>
            <Controller
              control={form.control}
              name="minStock"
              render={({ field }) => <NumberInput id="minStock" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={8} disabled={locked} aria-invalid={!!errors.minStock} />}
            />
          </Field>
          {mode === 'edit' ? (
            <p className="col-span-2 ts-label-meta text-text-muted">
              {savedTracked ? t('products.form.stock.readOnly') : t('products.form.stock.afterSave')}{' '}
              {savedTracked && canAdjust && !locked ? (
                <button type="button" className="text-accent-inbound hover:underline" onClick={() => onAdjust(null)} data-testid="stock-adjust-link">
                  {t('action.adjustStock')}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {tracked && hasVariants ? (
        <>
          <p className="mt-4 text-[13px] text-text-secondary">{t('products.form.variants.notice')}</p>
          <div className="mt-2 flex items-baseline gap-2 ts-label-meta uppercase text-text-muted">
            {t(mode === 'create' ? 'products.form.variants.totalInitial' : 'products.form.variants.total')}
            <Ltr className="text-[14px] font-semibold text-text-primary tabular-nums">
              <span data-testid="variants-total">{formatNumber(total)}</span>
            </Ltr>
          </div>
          <div className="mt-3 rounded-card border border-line-edge" data-testid="variants-table">
            <div aria-hidden className={cn(GRID, 'border-b border-line-hairline px-2.5 py-2 ts-label-micro text-text-muted')}>
              <span>{t('products.form.variants.col.name')}</span>
              <span>{t('common.price')}</span>
              <span>{t('products.form.variants.col.stock')}</span>
              <span>{t('products.form.variants.col.min')}</span>
              <span />
            </div>
            <ul aria-label={t('products.form.variants.title')}>
            {rows.fields.map((f, i) => {
              const row = variants[i];
              if (!row) return null;
              const rowErrors = errors.variants?.[i];
              const firstError = (['name', 'sku', 'price', 'costPrice', 'stock', 'minStock'] as VariantField[]).map((k) => rowErrors?.[k]?.message).find(Boolean);
              const open = expanded.has(row.key);
              const saved = !!row.id;
              const actions: MenuAction[] = [
                { key: 'edit', label: open ? t('products.form.variants.collapse') : t('action.edit'), onSelect: () => onToggle(row.key), primary: true },
                ...(mode === 'edit' && saved ? [{ key: 'adjust_stock', label: t('action.adjustStock'), onSelect: () => onAdjust(row.id), disabledReason: canAdjust ? undefined : t('toast.forbidden') } satisfies MenuAction] : []),
                { key: row.isActive ? 'deactivate' : 'activate', label: row.isActive ? t('action.disable') : t('action.enable'), onSelect: () => form.setValue(`variants.${i}.isActive`, !row.isActive, { shouldDirty: true }) },
                {
                  key: 'delete',
                  label: t('action.delete'),
                  destructive: true,
                  separated: true,
                  onSelect: () => {
                    if (!saved) return rows.remove(i);
                    setDeleteError(null);
                    setToDelete({ row, index: i });
                  },
                },
              ];
              const stock = num(row.stock);
              const id = (k: string) => `variant-${i}-${k}`;
              return (
                <li key={f.rhfId} data-variant={row.name || row.key} data-new={saved ? undefined : true} className={cn('border-b border-line-hairline last:border-b-0', !row.isActive && 'opacity-60')}>
                  <div className={cn(GRID, 'px-2.5 py-2.5 text-[13px]')}>
                    <button type="button" className="min-w-0 text-start" onClick={() => onToggle(row.key)} aria-expanded={open} data-testid="variant-toggle">
                      <span className="block truncate font-medium" dir="auto">
                        {row.name || t('products.form.variants.unnamed')}
                      </span>
                      {row.sku || !row.isActive ? (
                        <span className="flex items-center gap-1.5 ts-label-micro text-text-muted">
                          {row.sku ? <Ltr className="truncate">{row.sku}</Ltr> : null}
                          {!row.isActive ? <span>{t('products.form.variants.inactive')}</span> : null}
                        </span>
                      ) : null}
                    </button>
                    <span>{row.price === '' ? <span className="text-text-muted">—</span> : <Ltr className="tabular-nums">{formatNumber(num(row.price))}</Ltr>}</span>
                    <span>
                      <Ltr className={cn('font-semibold tabular-nums', variantStockTone(stock, num(row.minStock)))}>
                        <span data-testid="variant-stock">{formatNumber(stock)}</span>
                      </Ltr>
                    </span>
                    <span>
                      <Ltr className="tabular-nums text-text-muted">{formatNumber(num(row.minStock))}</Ltr>
                    </span>
                    <span>{locked ? null : <ActionsMenu iconOnly label={t('products.form.variants.rowActions', { name: row.name || t('products.form.variants.unnamed') })} actions={actions} variant="ghost" heading={row.name || undefined} />}</span>
                  </div>
                  {firstError && !open ? (
                    <p role="alert" className="px-2.5 pb-2 text-[12px] text-accent-alert">
                      {fieldError(t, firstError, { max: VARIANT_NAME_MAX })}
                    </p>
                  ) : null}
                  {open ? (
                    <div className="grid grid-cols-2 gap-3 border-t border-line-hairline bg-ink-raised/40 px-2.5 py-3" data-testid="variant-editor">
                      <Field label={t('common.name')} htmlFor={id('name')} required error={fieldError(t, rowErrors?.name?.message === 'validation.invalid' ? 'products.form.variants.duplicateName' : rowErrors?.name?.message, { max: VARIANT_NAME_MAX })}>
                        <Input id={id('name')} dir="auto" maxLength={VARIANT_NAME_MAX} disabled={locked} aria-invalid={!!rowErrors?.name} {...form.register(`variants.${i}.name`)} />
                      </Field>
                      <Field label={t('products.form.sku')} htmlFor={id('sku')} error={fieldError(t, rowErrors?.sku?.message, { max: 255 })}>
                        <CodeInput id={id('sku')} maxLength={255} disabled={locked} aria-invalid={!!rowErrors?.sku} {...form.register(`variants.${i}.sku`)} />
                      </Field>
                      <Field label={t('common.price')} htmlFor={id('price')} required error={fieldError(t, rowErrors?.price?.message)}>
                        <Controller
                          control={form.control}
                          name={`variants.${i}.price`}
                          render={({ field }) => <MoneyInput id={id('price')} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!rowErrors?.price} />}
                        />
                      </Field>
                      {advanced ? (
                        <Field label={t('products.form.variants.cost')} htmlFor={id('cost')} error={fieldError(t, rowErrors?.costPrice?.message)}>
                          <Controller
                            control={form.control}
                            name={`variants.${i}.costPrice`}
                            render={({ field }) => <MoneyInput id={id('cost')} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!rowErrors?.costPrice} />}
                          />
                        </Field>
                      ) : null}
                      {saved ? null : (
                        <Field label={t('products.form.stock.initial')} htmlFor={id('stock')} error={fieldError(t, rowErrors?.stock?.message)}>
                          <Controller
                            control={form.control}
                            name={`variants.${i}.stock`}
                            render={({ field }) => <NumberInput id={id('stock')} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={8} disabled={locked} aria-invalid={!!rowErrors?.stock} />}
                          />
                        </Field>
                      )}
                      <Field label={t('products.form.stock.min')} htmlFor={id('min')} error={fieldError(t, rowErrors?.minStock?.message)}>
                        <Controller
                          control={form.control}
                          name={`variants.${i}.minStock`}
                          render={({ field }) => <NumberInput id={id('min')} ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={8} disabled={locked} aria-invalid={!!rowErrors?.minStock} />}
                        />
                      </Field>
                      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
                        {saved ? <span className="ts-label-meta text-text-muted">{t('products.form.variants.stockReadOnly')}</span> : <Pill className="rounded-[4px]">{t('products.form.variants.new')}</Pill>}
                        <Button size="sm" variant="ghost" onClick={() => onToggle(row.key, false)}>
                          {t('products.form.variants.collapse')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
            </ul>
          </div>
          {errors.variants?.root?.message || errors.variants?.message ? <FormAlert className="mt-3">{fieldError(t, errors.variants?.root?.message ?? errors.variants?.message, { max: VARIANTS_MAX })}</FormAlert> : null}
        </>
      ) : null}

      {tracked && !locked ? (
        <div className="mt-3 flex flex-col gap-2">
          <Button className="w-full" onClick={addRow} disabledReason={limitReason} data-testid="variant-add">
            {t('products.form.variants.add')}
          </Button>
          <Button className="w-full" variant="ghost" onClick={onGenerate} disabledReason={limitReason} data-testid="variant-generate">
            {t('dialog.generateVariants.title')}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}
        title={t('dialog.delete.title', { name: toDelete?.row.name ?? '' })}
        description={t('products.form.variants.deleteHint')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void confirmDelete()}
        destructive
        loading={remove.isPending}
        closeLabel={t('action.close')}
      >
        {deleteError ? <FormAlert>{deleteError}</FormAlert> : null}
      </ConfirmDialog>
    </section>
  );
}
