'use client';
// "Générer des variantes" — Figma "DLG — GDS (stock) — dialogs catalogue": up to 3 attributes ("Taille : S, M, L"),
// default price and stock, preview "n variantes seront créées … les n existantes sont conservées", max 100 (VARIANT_LIMIT).
// With a `productId` the server creates them (`POST /products/:id/variants/generate`); without one (new product, not
// saved yet) the combinations are handed back to the form.
import { GenerateVariantsSchema, VARIANTS_MAX } from '@djaber/shared';
import { Button, Dialog, Field, FormAlert, Input, MoneyInput, NumberInput, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { catalogApi, useCatalogRefresh } from './api';
import type { Variant } from './contracts';
import { comboCount, exceedsVariantLimit, normalizeAttributes, parseAttributeLine, splitExisting, variantMatrix, type VariantCombo } from './variants';

export type GeneratedVariants = { combos: VariantCombo[]; price: number; stock: number };

export function GenerateVariantsDialog({
  open,
  onClose,
  productId,
  productName,
  existing,
  defaultPrice,
  onGenerated,
  onLocal,
}: {
  open: boolean;
  onClose: () => void;
  /** saved product ⇒ server-side generation */
  productId?: string | null;
  productName: string;
  existing: readonly Pick<Variant, 'name' | 'attributes'>[];
  defaultPrice?: number | null;
  /** server mode: the full variant list after generation */
  onGenerated?: (variants: Variant[]) => void;
  /** local mode (unsaved product): the new combinations only */
  onLocal?: (result: GeneratedVariants) => void;
}) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [lines, setLines] = useState<string[]>(['', '']);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLines(['', '']);
    setPrice(moneyDigits(defaultPrice ?? null));
    setStock('0');
    setTouched(false);
    setError(null);
  }, [open, defaultPrice]);

  const attributes = useMemo(() => normalizeAttributes(lines.map(parseAttributeLine)), [lines]);
  const total = comboCount(attributes);
  const { kept, created } = useMemo(() => splitExisting(variantMatrix(attributes), existing), [attributes, existing]);
  const overLimit = total > VARIANTS_MAX || exceedsVariantLimit(existing.length, created.length);
  const badLine = (i: number) => lines[i]!.trim() !== '' && !parseAttributeLine(lines[i]!);
  const priceValue = digitsToInt(price);
  const stockValue = digitsToInt(stock);
  const invalid = attributes.length === 0 || lines.some((_, i) => badLine(i)) || !priceValue || stockValue === null || overLimit || created.length === 0;

  const generate = useMutation({ mutationFn: () => catalogApi.generateVariants(productId!, GenerateVariantsSchema.parse({ attributes, defaultPrice: priceValue, defaultStock: stockValue })) });
  const submit = async () => {
    setTouched(true);
    if (invalid || !priceValue || stockValue === null) return;
    setError(null);
    if (!productId) {
      onLocal?.({ combos: created, price: priceValue, stock: stockValue });
      return onClose();
    }
    try {
      const variants = await generate.mutateAsync();
      await refresh({ productId });
      toast(t('products.variants.generate.done', { count: created.length }));
      onGenerated?.(variants);
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  const busy = generate.isPending;
  const sample = created.length > 1 ? `${created[0]!.name} … ${created[created.length - 1]!.name}` : (created[0]?.name ?? '');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.generateVariants.title')}
      description={productName}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabledReason={overLimit ? t('error.VARIANT_LIMIT') : undefined}>
            {t('products.variants.generate.submit', { count: created.length })}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {lines.map((line, i) => (
          <Field
            key={i}
            label={t('products.variants.generate.attribute', { n: i + 1 })}
            htmlFor={`gen-attr-${i}`}
            hint={i === 0 ? t('products.variants.generate.attributeHint') : undefined}
            error={badLine(i) ? t('products.variants.generate.attributeInvalid') : touched && i === 0 && attributes.length === 0 ? t('validation.required') : undefined}
          >
            <Input
              id={`gen-attr-${i}`}
              value={line}
              disabled={busy}
              placeholder={t(i === 0 ? 'products.variants.generate.placeholder1' : 'products.variants.generate.placeholder2')}
              aria-invalid={badLine(i)}
              onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </Field>
        ))}
        {lines.length < 3 ? (
          <button type="button" className="w-fit text-[13px] text-accent-inbound hover:underline" disabled={busy} onClick={() => setLines((prev) => [...prev, ''])}>
            {t('products.variants.generate.addAttribute')}
          </button>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('products.variants.generate.defaultPrice')} htmlFor="gen-price" required error={touched && !priceValue ? t('validation.price') : undefined}>
            <MoneyInput id="gen-price" value={price} onValueChange={setPrice} disabled={busy} aria-invalid={touched && !priceValue} />
          </Field>
          <Field label={t('products.variants.generate.defaultStock')} htmlFor="gen-stock" error={touched && stockValue === null ? t('validation.quantity') : undefined}>
            <NumberInput id="gen-stock" value={stock} onValueChange={setStock} disabled={busy} maxDigits={7} aria-invalid={touched && stockValue === null} />
          </Field>
        </div>
        {overLimit ? (
          <FormAlert>{t('error.VARIANT_LIMIT')}</FormAlert>
        ) : total > 0 ? (
          <p className="rounded-card border border-line-edge bg-ink-raised px-3 py-2.5 ts-label-meta text-text-secondary" data-testid="generate-preview">
            {t('products.variants.generate.preview', { count: created.length, sample })}
            {kept.length ? ` ${t('products.variants.generate.kept', { count: kept.length, names: kept.slice(0, 3).map((k) => k.name).join(', ') })}` : ''} {t('products.variants.generate.max', { max: VARIANTS_MAX })}
          </p>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t('action.generate')}
        </button>
      </form>
    </Dialog>
  );
}
