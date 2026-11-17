'use client';
// Product search of the GDS forms ("Scanner / chercher un produit, SKU, code-barres…"): new purchase, receive dialog
// (added line), new sale, recommendation rule. Same search as the order form (`GET /products?q`); a product with
// variants is read in full so that the caller gets its variants (variant required on purchases and sales).
import { formatNumber } from '@djaber/shared';
import { Ltr, PickerSearch, useComboboxList } from '@djaber/ui';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { catalogKeys } from '@/features/catalog/api';
import type { Product, ProductListItem } from '@/features/catalog/contracts';
import { orderFormApi, useProductSearch } from '@/features/orders/form/api';
import { useT } from '@/lib/i18n';
import { priceText } from '@/lib/money';
import { useWorkspaceId } from '@/lib/session';

export type PickedVariant = { id: string; name: string; sku: string | null; price: number; costPrice: number | null; stock: number };
export type PickedProduct = {
  id: string;
  name: string;
  sku: string;
  price: number;
  costPrice: number | null;
  imageUrl: string | null;
  hasVariants: boolean;
  trackStock: boolean;
  stock: number | null;
  variants: PickedVariant[];
};

const pickedVariants = (variants: Product['variants']): PickedVariant[] => variants.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: v.price, costPrice: v.costPrice, stock: v.stock }));
export const toPicked = (p: Pick<ProductListItem, 'id' | 'name' | 'sku' | 'price' | 'costPrice' | 'primaryImageUrl' | 'hasVariants' | 'trackStock' | 'stock'>, variants: Product['variants'] = []): PickedProduct => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  price: p.price,
  costPrice: p.costPrice,
  imageUrl: p.primaryImageUrl,
  hasVariants: p.hasVariants,
  trackStock: p.trackStock,
  stock: p.hasVariants ? null : p.stock,
  variants: pickedVariants(variants),
});

/**
 * Active variants of the products of the lines being edited (a saved purchase / draft sale only carries the variant it
 * was saved with): `productId → variants`, read with the same cache entry as the picker.
 */
export function useProductVariants(productIds: readonly string[]): Record<string, PickedVariant[] | undefined> {
  const ws = useWorkspaceId();
  const ids = [...new Set(productIds)];
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: catalogKeys.product(ws, id), queryFn: () => orderFormApi.product(id), enabled: !!ws, staleTime: 10_000 })),
  });
  const out: Record<string, PickedVariant[] | undefined> = {};
  ids.forEach((id, i) => {
    const p = results[i]?.data;
    out[id] = p ? pickedVariants(p.variants) : undefined;
  });
  return out;
}

export function ProductPicker({
  onPick,
  placeholder,
  disabled,
  invalid,
  id = 'gds-product-search',
  /** a product never purchasable / sellable here is listed greyed with its reason */
  refuse,
}: {
  onPick: (p: PickedProduct) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  refuse?: (p: ProductListItem) => string | null;
}) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  // journey J14-2: closed after a pick / Esc while the focus stays in the field (typing, ↓ or a click open it again)
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = (focused || q.trim().length > 0) && !dismissed && !disabled;
  const results = useProductSearch(q, open);
  const rows = (results.data?.rows ?? []).filter((p) => !p.archived);
  const list = useComboboxList({
    count: rows.length,
    open,
    onSelect: (i) => void pick(rows[i]!),
    onOpen: () => setDismissed(false),
    onClose: () => (setQ(''), setDismissed(true)),
    isDisabled: (i) => busy || !!refuse?.(rows[i]!),
  });

  async function pick(p: ProductListItem) {
    setQ('');
    // the focus stays in the search (the next product), the list closes (journeys J14-2 / J14-3)
    setDismissed(true);
    if (!p.hasVariants) return onPick(toPicked(p));
    setBusy(true);
    try {
      const full = await qc.fetchQuery({ queryKey: catalogKeys.product(ws, p.id), queryFn: () => orderFormApi.product(p.id), staleTime: 10_000 });
      onPick(toPicked(p, full.variants));
    } catch {
      onPick(toPicked(p));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && (setFocused(false), setDismissed(false))}>
      <div onFocus={() => setFocused(true)}>
        <PickerSearch
          id={id}
          value={q}
          onChange={(v) => (setQ(v), setDismissed(false))}
          onClick={() => setDismissed(false)}
          placeholder={placeholder ?? t('gds.picker.placeholder')}
          label={placeholder ?? t('gds.picker.placeholder')}
          active={open}
          disabled={disabled}
          invalid={invalid}
          combobox={list.comboboxProps}
          onKeyDown={list.onKeyDown}
        />
      </div>
      {open ? (
        <ul id={list.listId} role="listbox" aria-label={t('orderForm.items.results')} className="max-h-72 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge bg-ink-surface" data-testid="gds-product-results">
          {results.isPending ? <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2.5 text-[13px] text-text-muted">{t('common.loading')}</li> : null}
          {!results.isPending && rows.length === 0 ? <li role="option" aria-disabled="true" aria-selected={false} className="px-3 py-2.5 text-[13px] text-text-muted">{t('orderForm.items.noResults')}</li> : null}
          {rows.map((p, i) => {
            const reason = refuse?.(p) ?? null;
            return (
              <li key={p.id} role="none">
                <button type="button" {...list.optionProps(i)} onClick={() => void pick(p)} disabled={busy || !!reason} aria-disabled={busy || !!reason || undefined} title={reason ?? undefined} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-ink-raised aria-selected:bg-ink-raised disabled:opacity-50" data-product={p.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium [text-align:match-parent]" dir="auto">{p.name}</span>
                    <span className="block truncate ts-label-micro text-text-muted">
                      <Ltr>{p.sku}</Ltr>
                      {p.hasVariants ? ` · ${p.variantSummary ?? t('orderForm.items.withVariants')}` : p.trackStock && p.stock !== null ? ` · ${t('orderForm.items.stock', { count: formatNumber(p.stock) })}` : ` · ${t('orderForm.items.service')}`}
                      {reason ? ` · ${reason}` : ''}
                    </span>
                  </span>
                  {/* journey J02-3: the variants' range, never the unsold base price */}
                  <Ltr className="shrink-0 text-[13px] tabular-nums">{priceText(p)}</Ltr>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
