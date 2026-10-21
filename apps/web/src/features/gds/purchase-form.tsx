'use client';
// /purchases/new and /purchases/[id]/edit — Figma "CAT-11 / GDS-06b — … New purchase form" (12 §21 "New purchase"):
// FOURNISSEUR * (+ Nouveau fournisseur), DATE PRÉVUE, N° FACTURE; lines PRODUIT · VARIANTE / QTÉ / COÛT U. / TOTAL
// (an untracked product line is refused: `PURCHASE_UNTRACKED_PRODUCT`; a product with variants needs one:
// `VARIANT_REQUIRED`); TAXE, LIVRAISON, PAYÉ, MODE; "Total · reste dû"; Brouillon (`draft`) / Commander (`pending`);
// status legend. Prefill from `?supplierId`, the stock "Réapprovisionner" (`?productId&variantId&quantity&unitCost`).
// Server field errors land on their line; content is kept; leave guard while dirty.
import { formatMoney, formatNumber } from '@djaber/shared';
import { Button, Card, CodeInput, Field, FormAlert, Input, Ltr, MoneyInput, QtyStepper, Select, Skeleton, Textarea, toast } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { catalogApi } from '@/features/catalog/api';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useLeaveGuard } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { moneyDigits } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { gdsApi, useGdsRefresh, usePurchase, useSupplier, useSuppliers } from './api';
import { PAYMENT_METHODS, type CashMethod, type Purchase } from './contracts';
import { int, lineVariants, purchaseTotals } from './logic';
import { ProductPicker, toPicked, useProductVariants, type PickedProduct } from './product-picker';
import { SupplierDialog, supplierLabel } from './suppliers';
import { AdvancedOnly } from './ui';

type Line = { key: string; productId: string; name: string; sku: string; trackStock: boolean; hasVariants: boolean; variants: PickedProduct['variants']; variantId: string | null; quantity: number; unitCost: string };
type Form = { supplierId: string; expectedAt: string; invoice: string; tax: string; shipping: string; paid: string; method: CashMethod; notes: string; lines: Line[] };
const empty = (): Form => ({ supplierId: '', expectedAt: '', invoice: '', tax: '', shipping: '', paid: '', method: 'cash', notes: '', lines: [] });

const lineOf = (p: PickedProduct, o: { variantId?: string | null; quantity?: number; unitCost?: number | null } = {}): Line => {
  const v = o.variantId ? p.variants.find((x) => x.id === o.variantId) : p.variants.length === 1 ? p.variants[0] : undefined;
  return {
    key: uuid(),
    productId: p.id,
    name: p.name,
    sku: p.sku,
    trackStock: p.trackStock,
    hasVariants: p.hasVariants,
    variants: p.variants,
    variantId: v?.id ?? null,
    quantity: o.quantity ?? 1,
    unitCost: moneyDigits(o.unitCost ?? v?.costPrice ?? p.costPrice ?? 0),
  };
};
const fromPurchase = (p: Purchase): Form => ({
  supplierId: p.supplier?.id ?? '',
  expectedAt: p.expectedAt?.slice(0, 10) ?? '',
  invoice: p.supplierInvoiceRef ?? '',
  tax: moneyDigits(p.tax),
  shipping: moneyDigits(p.shippingCost),
  paid: '',
  method: p.paymentMethod ?? 'cash',
  notes: p.notes ?? '',
  lines: p.items.map((i) => ({
    key: i.id,
    productId: i.product.id,
    name: i.productName,
    sku: i.product.sku,
    trackStock: i.product.trackStock,
    hasVariants: i.product.hasVariants,
    variants: i.variantId ? [{ id: i.variantId, name: i.variantName ?? '', sku: null, price: 0, costPrice: null, stock: 0 }] : [],
    variantId: i.variantId,
    quantity: i.quantity,
    unitCost: moneyDigits(i.unitCost),
  })),
});

export function PurchaseFormPage({ purchaseId }: { purchaseId?: string }) {
  const t = useT();
  return (
    <AdvancedOnly title={t('purchases.form.title')}>
      <PurchaseFormLoader purchaseId={purchaseId} />
    </AdvancedOnly>
  );
}

function PurchaseFormLoader({ purchaseId }: { purchaseId?: string }) {
  const t = useT();
  const q = usePurchase(purchaseId);
  if (!purchaseId) return <PurchaseForm />;
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} backHref="/purchases" />;
  if (q.data.status !== 'draft' && q.data.status !== 'pending')
    return (
      <AppPage title={t('purchases.form.editTitle', { number: q.data.number })} back={{ href: `/purchases/${q.data.id}`, label: `#${q.data.number}` }} permission="gds.write">
        <FormAlert tone="warning">{t('purchases.form.locked')}</FormAlert>
      </AppPage>
    );
  return <PurchaseForm purchase={q.data} />;
}

function PurchaseForm({ purchase }: { purchase?: Purchase }) {
  const t = useT();
  const ws = useWorkspaceId();
  const router = useRouter();
  const params = useSearchParams();
  const refresh = useGdsRefresh();
  const offline = useOffline();
  const { can } = useSession();
  const suppliers = useSuppliers({ pageSize: 100, sort: 'name', isActive: true });
  const [f, setF] = useState<Form>(() => (purchase ? fromPurchase(purchase) : { ...empty(), supplierId: params.get('supplierId') ?? '' }));
  // a preset supplier (`?supplierId`, "Nouvel achat chez ce fournisseur") missing from the active list is read and kept as an option
  const presetId = !purchase ? params.get('supplierId') : null;
  const preset = useSupplier(presetId && suppliers.data && !suppliers.data.rows.some((x) => x.id === presetId) ? presetId : null);
  // a saved line only carries its variant: the product's other variants are read to offer them again
  useEffect(() => {
    if (preset.data && !preset.data.isActive) setF((x) => (x.supplierId === preset.data.id ? { ...x, supplierId: '' } : x));
  }, [preset.data]);
  const loadedVariants = useProductVariants(f.lines.filter((l) => l.hasVariants).map((l) => l.productId));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'pending' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [newSupplier, setNewSupplier] = useState(false);
  const [dirty, setDirty] = useState(false);
  const key = useRef(uuid());
  const { guard } = useLeaveGuard(dirty && busy === null, purchase ? `#${purchase.number}` : t('purchases.form.title'));

  // "Réapprovisionner" / recommendation prefill: one line of the product (variant, quantity, cost)
  const prefillId = !purchase ? params.get('productId') : null;
  const prefill = useQuery({ queryKey: [ws, 'product', prefillId ?? '', 'prefill'], queryFn: () => catalogApi.product(prefillId!), enabled: !!ws && !!prefillId });
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefill.data || prefilled.current) return;
    prefilled.current = true;
    const p = prefill.data;
    setF((x) => ({
      ...x,
      supplierId: x.supplierId || params.get('supplierId') || '',
      lines: [...x.lines, lineOf(toPicked(p, p.variants), { variantId: params.get('variantId'), quantity: Number(params.get('quantity')) || 1, unitCost: params.get('unitCost') ? Number(params.get('unitCost')) : null })],
    }));
  }, [prefill.data, params]);

  const set = (patch: Partial<Form>) => {
    setDirty(true);
    setF((x) => ({ ...x, ...patch }));
  };
  const patchLine = (i: number, patch: Partial<Line>) => set({ lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const totals = purchaseTotals(f.lines, { tax: f.tax, shipping: f.shipping, paid: f.paid });

  // client checks (the server checks again): supplier, at least one line, tracked products, variants, quantities
  const errs: Record<string, string> = {};
  if (!f.supplierId) errs.supplierId = t('validation.required');
  if (!f.lines.length) errs.items = t('purchases.form.noLines');
  f.lines.forEach((l, i) => {
    if (!l.trackStock) errs[`items.${i}.productId`] = `${t('error.PURCHASE_UNTRACKED_PRODUCT', { product: l.name })} (PURCHASE_UNTRACKED_PRODUCT)`;
    else if (l.hasVariants && !l.variantId) errs[`items.${i}.variantId`] = `${t('error.VARIANT_REQUIRED')} (VARIANT_REQUIRED)`;
  });
  if (totals.overpaid) errs.amountPaid = t('purchases.form.overpaid');
  const shown = (k: string) => (touched ? errs[k] : undefined) ?? (fields[k] ? (t.has(fields[k]!) ? t(fields[k]!, { max: '', min: '' }) : fields[k]) : undefined);

  const save = async (status: 'draft' | 'pending') => {
    setTouched(true);
    setError(null);
    setFields({});
    if (Object.keys(errs).length) {
      setError(t('state.form.validationSummary', { count: Object.keys(errs).length, list: Object.values(errs).slice(0, 3).join(' · ') }));
      return;
    }
    setBusy(status);
    const items = f.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitCost: int(l.unitCost) }));
    const common = {
      supplierId: f.supplierId || null,
      items,
      tax: int(f.tax),
      shippingCost: int(f.shipping),
      paymentMethod: f.method,
      supplierInvoiceRef: f.invoice.trim() || null,
      notes: f.notes.trim() || null,
      expectedAt: f.expectedAt ? new Date(`${f.expectedAt}T12:00:00Z`).toISOString() : null,
    };
    try {
      let saved: Purchase;
      if (purchase) {
        saved = await gdsApi.updatePurchase(purchase.id, common);
        if (status === 'pending' && saved.status === 'draft') saved = await gdsApi.orderPurchase(saved.id);
      } else {
        saved = await gdsApi.createPurchase({ ...common, status, amountPaid: totals.paid || undefined }, key.current);
        key.current = uuid();
        // opened from a restock recommendation: the card turns APPLIQUÉE, linked to this purchase, once it is ordered (a
        // draft orders nothing yet — the card stays)
        const reco = params.get('reco');
        if (reco && saved.status !== 'draft') await gdsApi.applyStockReco(reco, { refType: 'purchase', refId: saved.id }).catch(() => undefined);
      }
      setDirty(false);
      await refresh();
      toast(t(status === 'pending' ? 'purchases.form.ordered' : 'purchases.form.saved', { number: saved.number }));
      router.push(`/purchases/${saved.id}`);
    } catch (e) {
      setError(refusal(e, t));
      if (e instanceof ApiError) setFields(e.body.fields ?? {});
    } finally {
      setBusy(null);
    }
  };

  const supplierOptions = suppliers.data?.rows ?? [];
  const blocked = !can('gds.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  return (
    <AppPage
      title={purchase ? t('purchases.form.editTitle', { number: purchase.number }) : t('purchases.form.title')}
      description={t('purchases.form.subtitle')}
      back={{ href: purchase ? `/purchases/${purchase.id}` : '/purchases', label: purchase ? `#${purchase.number}` : t('nav.purchases') }}
      permission="gds.write"
    >
      <Card className="flex flex-col gap-5 p-5" data-testid="purchase-form">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('purchases.col.supplier')} htmlFor="pf-supplier" required error={shown('supplierId')} hint={preset.data && !preset.data.isActive && !f.supplierId ? `${preset.data.name} · ${t('suppliers.inactivePurchaseReason')}` : undefined}>
            <div className="flex gap-2">
              <Select id="pf-supplier" value={f.supplierId} onChange={(e) => (e.target.value === '__new' ? setNewSupplier(true) : set({ supplierId: e.target.value }))} aria-invalid={!!shown('supplierId') || undefined}>
                <option value="">{t('purchases.form.pickSupplier')}</option>
                {/* name + phone + e-mail: suppliers of the same name are told apart (tester report 2026-10-20 UX-003) */}
                {supplierOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {supplierLabel(s)}
                  </option>
                ))}
                {purchase?.supplier && !supplierOptions.some((s) => s.id === purchase.supplier!.id) ? <option value={purchase.supplier.id}>{purchase.supplier.name}</option> : null}
                {preset.data?.isActive && !supplierOptions.some((s) => s.id === preset.data.id) ? <option value={preset.data.id}>{preset.data.name}</option> : null}
                <option value="__new">{t('suppliers.new')}</option>
              </Select>
            </div>
          </Field>
          <Field label={t('purchases.col.expected')} htmlFor="pf-expected" error={shown('expectedAt')}>
            <Input id="pf-expected" type="date" value={f.expectedAt} onChange={(e) => set({ expectedAt: e.target.value })} className="[color-scheme:dark]" />
          </Field>
          <Field label={t('purchases.form.invoice')} htmlFor="pf-invoice" error={shown('supplierInvoiceRef')}>
            <CodeInput id="pf-invoice" value={f.invoice} maxLength={120} onChange={(e) => set({ invoice: e.target.value })} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <ProductPicker
            id="purchase-product"
            onPick={(p) => set({ lines: [...f.lines, lineOf(p)] })}
            placeholder={t('purchases.form.search')}
            invalid={!!shown('items')}
            refuse={(p) => (p.trackStock ? null : t('error.PURCHASE_UNTRACKED_PRODUCT', { product: p.name }))}
          />
          {shown('items') ? (
            <p role="alert" className="text-[12px] text-accent-alert">
              {shown('items')}
            </p>
          ) : null}
          {f.lines.length ? (
            <div className="overflow-x-auto rounded-card border border-line-edge">
              <table className="w-full text-[13px]" data-testid="purchase-lines">
                <thead>
                  <tr className="ts-label-micro text-text-muted">
                    <th className="px-3 py-2 text-start font-normal">{t('purchases.col.productVariant')}</th>
                    <th className="px-3 py-2 text-start font-normal">{t('purchases.col.qty')}</th>
                    <th className="px-3 py-2 text-start font-normal">{t('purchases.col.unitCost')}</th>
                    <th className="px-3 py-2 text-end font-normal">{t('purchases.col.total')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-hairline">
                  {f.lines.map((l, i) => {
                    const variants = lineVariants(l.variants, loadedVariants[l.productId]);
                    const lineErr = shown(`items.${i}.productId`) ?? shown(`items.${i}.variantId`) ?? shown(`items.${i}.quantity`) ?? shown(`items.${i}.unitCost`);
                    return (
                      <tr key={l.key} data-line={l.productId} data-invalid={lineErr ? true : undefined}>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-1.5">
                            {l.name}
                            {!l.trackStock ? <AlertTriangle className="size-3.5 text-accent-starred" aria-label={t('enum.Product.state.service')} /> : null}
                          </div>
                          {l.hasVariants ? (
                            <Select aria-label={t('orderForm.items.variant', { name: l.name })} value={l.variantId ?? ''} onChange={(e) => { const v = variants.find((x) => x.id === e.target.value); patchLine(i, { variantId: e.target.value || null, unitCost: v && v.costPrice !== null ? moneyDigits(v.costPrice) : l.unitCost }); }} className="mt-1 !h-7 w-auto min-w-36 text-[12px]" aria-invalid={!!shown(`items.${i}.variantId`) || undefined}>
                              <option value="">{t('orderForm.items.pickVariant')}</option>
                              {variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Ltr className="ts-label-micro text-text-muted">{l.sku}</Ltr>
                          )}
                          {lineErr ? (
                            <p role="alert" className="mt-1 text-[12px] text-accent-alert">
                              {lineErr}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <QtyStepper value={l.quantity} onChange={(q) => patchLine(i, { quantity: q })} min={1} max={100000} labels={{ decrease: t('gds.qty.decrease'), increase: t('gds.qty.increase'), value: t('purchases.col.qty') }} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <MoneyInput aria-label={t('purchases.receive.costFor', { name: l.name })} value={l.unitCost} onValueChange={(v) => patchLine(i, { unitCost: v })} className="!h-9 w-32" />
                        </td>
                        <td className="px-3 py-2 text-end align-top">
                          <Ltr className="tabular-nums">{l.trackStock ? formatMoney(l.quantity * int(l.unitCost)) : '—'}</Ltr>
                        </td>
                        <td className="px-1 align-top">
                          <button type="button" aria-label={t('orderForm.items.remove', { name: l.name })} onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })} className="mt-2 p-1 text-text-muted hover:text-text-primary">
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ts-label-meta text-text-muted">{t('purchases.form.empty')}</p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('purchases.form.tax')} htmlFor="pf-tax" error={shown('tax')}>
            <MoneyInput id="pf-tax" value={f.tax} onValueChange={(v) => set({ tax: v })} />
          </Field>
          <Field label={t('purchases.form.shipping')} htmlFor="pf-shipping" error={shown('shippingCost')}>
            <MoneyInput id="pf-shipping" value={f.shipping} onValueChange={(v) => set({ shipping: v })} />
          </Field>
          <Field label={t('purchases.form.paid')} htmlFor="pf-paid" error={purchase ? undefined : shown('amountPaid')} hint={purchase ? t('purchases.form.paidHint') : undefined}>
            <MoneyInput id="pf-paid" value={f.paid} onValueChange={(v) => set({ paid: v })} disabled={!!purchase} />
          </Field>
          <Field label={t('gds.method')} htmlFor="pf-method">
            <Select id="pf-method" value={f.method} onChange={(e) => set({ method: e.target.value as CashMethod })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`orders.payment.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('common.noteOptional')} htmlFor="pf-notes">
          <Textarea id="pf-notes" value={f.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} className="min-h-14" />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-line-hairline pt-4">
          <p className="ts-label-meta text-text-muted" data-testid="purchase-totals">
            <Ltr>{t('purchases.form.totals', { total: formatMoney(totals.total), remaining: formatMoney(totals.remaining), units: formatNumber(f.lines.reduce((s, l) => s + l.quantity, 0)) })}</Ltr>
          </p>
          <div className="ms-auto flex gap-2">
            <Button variant="ghost" onClick={() => void save('draft')} loading={busy === 'draft'} disabled={busy !== null} disabledReason={blocked} data-testid="purchase-save-draft">
              {t('purchases.form.draft')}
            </Button>
            <Button variant="primary" onClick={() => void save('pending')} loading={busy === 'pending'} disabled={busy !== null} disabledReason={blocked} data-testid="purchase-save-order">
              {t('purchases.action.order')}
            </Button>
          </div>
        </div>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <p className="ts-label-micro !normal-case text-text-muted">{t('purchases.form.legend')}</p>
      </Card>
      <SupplierDialog
        open={newSupplier}
        supplier={null}
        onClose={() => setNewSupplier(false)}
        onCreated={(s) => {
          void suppliers.refetch();
          set({ supplierId: s.id });
        }}
      />
      {guard}
    </AppPage>
  );
}
