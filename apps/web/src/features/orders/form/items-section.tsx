'use client';
// "2 · ARTICLES" of the new order form (Figma ORD-02 "variant"): product search (name, SKU, keyword), one line per
// product / variant with price, quantity, stock hint ("(stock 1)", "⚠ Dernière unité de cette variante") — the stock is
// checked again by the server at save (`ORDER_INSUFFICIENT_STOCK` on the line), the variant is required (VARIANT_REQUIRED).
import { formatMoney, formatNumber } from '@djaber/shared';
import { cn, Ltr, MoneyInput, OrderFormCard, OrderLineRow, PickerSearch, QtyStepper, Select } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { catalogKeys } from '@/features/catalog/api';
import type { Product, ProductListItem } from '@/features/catalog/contracts';
import { fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { orderFormApi, useProductSearch } from './api';
import { lineStock, lineStockWarning, lineTotal, type FormErrors, type FormLine } from './model';

/** A catalogue product → a new order line (variants loaded by the caller when the product has some). */
export const lineFromProduct = (
  p: Pick<ProductListItem, 'id' | 'name' | 'sku' | 'price' | 'primaryImageUrl' | 'hasVariants' | 'trackStock' | 'stock'> & { sellOutOfStock?: boolean },
  variants: Product['variants'] = [],
): FormLine => {
  const active = variants.filter((v) => v.isActive);
  const only = p.hasVariants && active.length === 1 ? active[0]! : null;
  return {
    key: uuid(),
    productId: p.id,
    productName: p.name,
    sku: p.sku,
    imageUrl: p.primaryImageUrl,
    hasVariants: p.hasVariants,
    trackStock: p.trackStock,
    sellOutOfStock: p.sellOutOfStock ?? false,
    stock: p.hasVariants ? null : p.stock,
    variants: active.map((v) => ({
      id: v.id,
      name: v.name,
      price: v.price,
      stock: v.stock,
      isActive: v.isActive,
    })),
    variantId: only?.id ?? null,
    unitPrice: String(only?.price ?? p.price),
    quantity: 1,
  };
};

export function ItemsSection({ lines, onChange, errors, locked }: { lines: FormLine[]; onChange: (next: FormLine[]) => void; errors: FormErrors; locked: boolean }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const open = (focused || q.trim().length > 0) && !locked;
  const results = useProductSearch(q, open);
  const rows = (results.data?.rows ?? []).filter((p) => !p.archived);

  const add = async (p: ProductListItem) => {
    setQ('');
    setFocused(false);
    // the same simple product again adds one unit to its line
    const same = !p.hasVariants ? lines.findIndex((l) => l.productId === p.id) : -1;
    if (same >= 0) return onChange(lines.map((l, i) => (i === same ? { ...l, quantity: l.quantity + 1 } : l)));
    if (!p.hasVariants) return onChange([...lines, lineFromProduct(p)]);
    setAdding(true);
    try {
      const full = await qc.fetchQuery({
        queryKey: catalogKeys.product(ws, p.id),
        queryFn: () => orderFormApi.product(p.id),
        staleTime: 10_000,
      });
      onChange([...lines, lineFromProduct(p, full.variants)]);
    } catch {
      onChange([...lines, lineFromProduct(p)]);
    } finally {
      setAdding(false);
    }
  };
  const patch = (i: number, next: Partial<FormLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...next } : l)));
  const err = (k: keyof FormErrors) => {
    const e = errors[k];
    return e ? fieldError(t, e.key, e.params as Record<string, string | number>) : undefined;
  };

  const stockHint = (l: FormLine) => {
    const s = lineStock(l);
    if (!l.trackStock) return t('orderForm.items.service');
    if (s === null) return null;
    return t('orderForm.items.stock', { count: formatNumber(s) });
  };
  const warning = (l: FormLine) => {
    const w = lineStockWarning(l);
    if (w === 'insufficient') return t('error.STOCK_INSUFFICIENT', { available: formatNumber(lineStock(l) ?? 0) });
    if (w === 'backorder') return t('orderForm.items.backorder', { available: formatNumber(Math.max(0, lineStock(l) ?? 0)) });
    if (w === 'last_unit') return t(l.hasVariants ? 'orderForm.items.lastUnitVariant' : 'orderForm.items.lastUnit');
    return null;
  };

  return (
    <OrderFormCard index={2} title={t('orderForm.items.title')} badge={t('orderForm.items.badge')} data-section="items">
      <div className="flex flex-col gap-2" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}>
        <div onFocus={() => setFocused(true)}>
          <PickerSearch
            id="product-search"
            value={q}
            onChange={setQ}
            placeholder={t('orderForm.items.search')}
            label={t('orderForm.items.search')}
            active={open}
            disabled={locked}
            invalid={!!errors.lines}
            onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setFocused(false))}
          />
        </div>
        {open ? (
          <ul
            aria-label={t('orderForm.items.results')}
            className="max-h-72 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge bg-ink-surface"
            data-testid="product-results"
          >
            {results.isPending ? <li className="px-3 py-2.5 text-[13px] text-text-muted">{t('common.loading')}</li> : null}
            {!results.isPending && rows.length === 0 ? <li className="px-3 py-2.5 text-[13px] text-text-muted">{t('orderForm.items.noResults')}</li> : null}
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void add(p)} disabled={adding} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-ink-raised disabled:opacity-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{p.name}</span>
                    <span className="block truncate ts-label-micro text-text-muted">
                      <Ltr>{p.sku}</Ltr>
                      {p.hasVariants
                        ? ` · ${p.variantSummary ?? t('orderForm.items.withVariants')}`
                        : p.trackStock && p.stock !== null
                          ? ` · ${t('orderForm.items.stock', { count: formatNumber(p.stock) })}`
                          : ''}
                    </span>
                  </span>
                  <Ltr className="shrink-0 text-[13px] tabular-nums">{formatMoney(p.price)}</Ltr>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {errors.lines ? (
          <p role="alert" className="text-[12px] text-accent-alert">
            {err('lines')}
          </p>
        ) : null}
      </div>

      {lines.length ? (
        <ul aria-label={t('orderForm.items.lines')} className="divide-y divide-line-hairline rounded-card border border-line-edge" data-testid="order-lines">
          {lines.map((l, i) => {
            const w = lineStockWarning(l);
            return (
              <OrderLineRow
                key={l.key}
                data-line={l.productId}
                data-variant={l.variantId ?? ''}
                name={l.productName}
                imageUrl={l.imageUrl}
                removeLabel={t('orderForm.items.remove', { name: l.productName })}
                onRemove={locked ? undefined : () => onChange(lines.filter((_, j) => j !== i))}
                detail={
                  <>
                    {l.hasVariants ? (
                      <Select
                        id={`line-${i}-variant`}
                        aria-label={t('orderForm.items.variant', { name: l.productName })}
                        aria-invalid={!!errors[`lines.${i}.variantId`]}
                        disabled={locked}
                        value={l.variantId ?? ''}
                        onChange={(e) => {
                          const v = l.variants.find((x) => x.id === e.target.value) ?? null;
                          patch(i, {
                            variantId: v?.id ?? null,
                            unitPrice: v ? String(v.price) : l.unitPrice,
                          });
                        }}
                        className="!h-7 w-auto min-w-36 !font-sans text-[12px] !normal-case !tracking-normal"
                      >
                        <option value="">{t('orderForm.items.pickVariant')}</option>
                        {l.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {l.trackStock ? ` (${t('orderForm.items.stock', { count: formatNumber(v.stock) })})` : ''}
                          </option>
                        ))}
                      </Select>
                    ) : l.sku ? (
                      <Ltr>{l.sku}</Ltr>
                    ) : null}
                    {!l.hasVariants && l.trackStock ? (
                      <span>
                        ({t('orderForm.items.noVariant')}, {stockHint(l)})
                      </span>
                    ) : null}
                    {!l.trackStock ? <span>({stockHint(l)})</span> : null}
                  </>
                }
                warning={warning(l)}
                warningTone={w === 'insufficient' ? 'danger' : 'warning'}
                error={err(`lines.${i}.variantId`) ?? err(`lines.${i}.quantity`) ?? err(`lines.${i}.unitPrice`) ?? null}
                price={
                  <MoneyInput
                    id={`line-${i}-price`}
                    aria-label={t('orderForm.items.price', { name: l.productName })}
                    value={l.unitPrice}
                    onValueChange={(v) => patch(i, { unitPrice: v })}
                    disabled={locked}
                    aria-invalid={!!errors[`lines.${i}.unitPrice`]}
                    className="!h-8 text-[13px]"
                  />
                }
                quantity={
                  <QtyStepper
                    value={l.quantity}
                    min={1}
                    onChange={(n) => patch(i, { quantity: n })}
                    disabled={locked}
                    tone={w === 'insufficient' ? 'danger' : w === 'last_unit' ? 'warning' : undefined}
                    labels={{
                      decrease: t('orderForm.items.decrease'),
                      increase: t('orderForm.items.increase'),
                      value: t('orderForm.items.quantity', { name: l.productName }),
                    }}
                  />
                }
                total={<Ltr className={cn(w === 'insufficient' && 'text-accent-alert')}>{formatMoney(lineTotal(l))}</Ltr>}
              />
            );
          })}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-line-edge px-3 py-4 text-center ts-label-meta text-text-muted" data-testid="no-lines">
          {t('orderForm.items.empty')}
        </p>
      )}
    </OrderFormCard>
  );
}
