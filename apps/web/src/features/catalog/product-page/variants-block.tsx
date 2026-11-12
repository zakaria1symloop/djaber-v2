'use client';
// "Variantes" block of the product page — Figma "CAT-09 — Product page — full": click on a row = inline edit of
// price / cost / threshold (`PATCH /products/:id/variants/:vid`, saved on blur or Enter, Esc cancels, errors under
// the row); stock only through "Ajuster" (traceability); "Générer des variantes" in server mode.
import { Button, cn, Ltr, NumberInput, Pill, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { moneyDigits } from '@/lib/money';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Product, Variant } from '../contracts';
import { GenerateVariantsDialog } from '../generate-variants-dialog';
import { Money, Num, StockPill } from '../ui';
import { variantPatch } from './logic';
import { Block, Note } from './parts';

type Field = 'price' | 'costPrice' | 'minStock';
const FIELDS: readonly Field[] = ['price', 'costPrice', 'minStock'];
const draftOf = (v: Variant) => ({ price: moneyDigits(v.price), costPrice: moneyDigits(v.costPrice), minStock: String(v.minStock) });

function VariantRow({ productId, variant: v, advanced, editable, onAdjust, columns }: { productId: string; variant: Variant; advanced: boolean; editable: boolean; onAdjust?: () => void; columns: number }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(v));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const save = useMutation({ mutationFn: (patch: Parameters<typeof catalogApi.updateVariant>[2]) => catalogApi.updateVariant(productId, v.id, patch) });

  useEffect(() => {
    if (!editing) setDraft(draftOf(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seeded when the saved values change
  }, [v.price, v.costPrice, v.minStock, editing]);
  useEffect(() => {
    if (editing) first.current?.focus();
  }, [editing]);

  const commit = async (): Promise<boolean> => {
    const { patch, errors: invalid } = variantPatch(v, draft, advanced);
    setFormError(null);
    if (Object.keys(invalid).length) {
      setErrors(Object.fromEntries(Object.entries(invalid).map(([k, key]) => [k, t(key)])));
      return false;
    }
    setErrors({});
    if (Object.keys(patch).length === 0) return true;
    try {
      await save.mutateAsync(patch);
      await refresh({ productId });
      toast(t('toast.saved'));
      return true;
    } catch (e) {
      const fields = e instanceof ApiError ? e.body.fields : {};
      const mapped = Object.fromEntries(FIELDS.filter((f) => fields[f]).map((f) => [f, t.has(fields[f]!) ? t(fields[f]!, { max: '', min: '' }) : fields[f]!]));
      setErrors(mapped);
      if (Object.keys(mapped).length === 0) setFormError(errorMessage(e, t));
      return false;
    }
  };
  const leave = async () => {
    if (save.isPending) return;
    if (await commit()) setEditing(false);
  };
  const cancel = () => {
    setDraft(draftOf(v));
    setErrors({});
    setFormError(null);
    setEditing(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void leave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  const input = (field: Field, label: string, money: boolean, ref?: React.Ref<HTMLInputElement>) => {
    return (
      <div className="w-20">
        <NumberInput
          ref={ref}
          aria-label={`${label} — ${v.name}`}
          aria-invalid={!!errors[field]}
          value={draft[field]}
          onValueChange={(digits) => setDraft((d) => ({ ...d, [field]: digits }))}
          readOnly={save.isPending}
          maxDigits={money ? 9 : 7}
          className="h-8 text-[13px]"
          data-field={field}
        />
      </div>
    );
  };
  const messages = [...FIELDS.map((f) => errors[f]), formError].filter(Boolean);
  const cell = 'px-3 py-2.5 align-middle';

  return (
    <>
      <tr
        data-variant={v.id}
        data-editing={editing || undefined}
        aria-busy={save.isPending || undefined}
        onClick={editable && !editing ? () => setEditing(true) : undefined}
        onBlur={editing ? (e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && void leave() : undefined}
        onKeyDown={editing ? onKeyDown : undefined}
        className={cn('border-b border-line-hairline last:border-b-0', editable && !editing && 'cursor-pointer hover:bg-ink-raised/60', editing && 'bg-ink-raised/60')}
      >
        <td className={cell}>
          {editable && !editing ? (
            <button type="button" className="text-start hover:underline" aria-label={t('products.page.variants.edit', { name: v.name })} onClick={(e) => (e.stopPropagation(), setEditing(true))}>
              {v.name}
            </button>
          ) : (
            v.name
          )}
          {v.isActive ? null : (
            <Pill className="ms-2 rounded-[4px]">{t('enum.Product.state.hidden')}</Pill>
          )}
        </td>
        <td className={cn(cell, 'whitespace-nowrap text-text-secondary')}>{v.sku ? <Ltr>{v.sku}</Ltr> : '—'}</td>
        <td className={cell}>{editing ? input('price', t('common.price'), true, first) : <Money value={v.price} />}</td>
        {advanced ? <td className={cell}>{editing ? input('costPrice', t('products.page.variants.cost'), true) : <Money value={v.costPrice} muted />}</td> : null}
        <td className={cell}>
          <span className="inline-flex items-center gap-1.5">
            <Num value={v.stock} className={cn(v.stockState === 'out' && 'text-accent-alert')} />
            {v.stockState === 'low' ? <AlertTriangle className="size-3.5 text-accent-starred" role="img" aria-label={t('enum.Product.stock.low')} /> : null}
            {v.stockState === 'out' ? <StockPill state="out" /> : null}
          </span>
        </td>
        <td className={cell}>{editing ? input('minStock', t('products.page.variants.threshold'), false) : <Num value={v.minStock} />}</td>
        {onAdjust ? (
          <td className={cn(cell, 'text-end')}>
            <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), onAdjust())} aria-label={t('products.page.variants.adjustOf', { name: v.name })}>
              {t('products.page.variants.adjust')}
            </Button>
          </td>
        ) : null}
      </tr>
      {messages.length ? (
        <tr className="border-b border-line-hairline last:border-b-0">
          <td colSpan={columns} className="px-3 pb-2">
            <p role="alert" className="text-[12px] text-accent-alert" data-testid="variant-error">
              {messages.join(' · ')}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function VariantsBlock({ product, advanced, canWrite, onAdjust }: { product: Product; advanced: boolean; canWrite: boolean; onAdjust?: (variantId: string) => void }) {
  const t = useT();
  const [generate, setGenerate] = useState(false);
  const variants = product.variants ?? [];
  const columns = 5 + (advanced ? 1 : 0) + (onAdjust ? 1 : 0);
  const th = 'ts-label-micro whitespace-nowrap border-b border-line-hairline px-3 py-2 text-start uppercase text-text-muted';
  return (
    <Block
      title={t('products.page.variants.title')}
      testId="block-variants"
      action={
        canWrite ? (
          <button type="button" className="text-[13px] text-text-secondary hover:text-text-primary" onClick={() => setGenerate(true)}>
            {t('dialog.generateVariants.title')}
          </button>
        ) : null
      }
    >
      <div className="overflow-x-auto rounded-[8px] border border-line-edge">
        <table className="w-full border-collapse text-[13px]" aria-label={t('products.page.variants.title')}>
          <thead>
            <tr>
              <th scope="col" className={th}>{t('products.page.variants.variant')}</th>
              <th scope="col" className={th}>{t('products.page.variants.sku')}</th>
              <th scope="col" className={th}>{t('common.price')}</th>
              {advanced ? <th scope="col" className={th}>{t('products.page.variants.cost')}</th> : null}
              <th scope="col" className={th}>{t('products.page.variants.stock')}</th>
              <th scope="col" className={th}>{t('products.page.variants.threshold')}</th>
              {onAdjust ? (
                <th scope="col" className={th}>
                  <span className="sr-only">{t('action.actions')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <VariantRow key={v.id} productId={product.id} variant={v} advanced={advanced} editable={canWrite} columns={columns} onAdjust={onAdjust ? () => onAdjust(v.id) : undefined} />
            ))}
          </tbody>
        </table>
      </div>
      <Note>{t(canWrite ? 'products.page.variants.hint' : 'products.page.variants.hintReadOnly')}</Note>
      <GenerateVariantsDialog open={generate} onClose={() => setGenerate(false)} productId={product.id} productName={product.name} existing={variants} defaultPrice={product.price} />
    </Block>
  );
}
