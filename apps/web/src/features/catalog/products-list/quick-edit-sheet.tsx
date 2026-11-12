'use client';
// Quick-edit side sheet of a product — Figma "CAT-01 — Product — quick edit sheet + relations". Opened over the list
// (`?sheet=<id>`), saved on blur (prices) or immediately (active switch); stock steppers write a traced adjustment
// (`POST /stock/adjustments`, type `set`, with the chosen reason); the "+" image tile picks and uploads in place
// (`useProductImageEditor`, same flow as the product form); ‹ › walk the rows of the list; related tabs show
// the last orders / movements / agents / recommendations (`GET /products/:id/relations`).
import { formatDate, formatNumber, PRODUCT_IMAGES_MAX, productCost, productPrice, STOCK_ADJUSTMENT_REASONS, type AppLocale, type StockAdjustmentInput } from '@djaber/shared';
import { buttonClass, cn, Field, Ltr, MoneyInput, Pill, QtyStepper, Select, SheetSection, SideSheet, Skeleton, StatusPill, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { digitsToInt, marginPct, moneyDigits } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';
import { catalogApi, catalogKeys, useCatalogRefresh, useProduct, useProductRelations } from '../api';
import { GenerateVariantsDialog } from '../generate-variants-dialog';
import { QuickImagesStrip } from '../product-form/images-section';
import type { Product } from '../contracts';
import { MovementTypePill, Num, ProductThumb, StockPill, useMovementReason } from '../ui';
import { uuid } from '@/lib/uuid';

type Status = { tone: 'ok' | 'error' | 'busy'; text: string } | null;
type PriceField = 'price' | 'oldPrice' | 'costPrice';
const STEP_DELAY_MS = 700;

export function QuickEditSheet({ productId, onClose, onPrev, onNext, position }: { productId: string | null; onClose: () => void; onPrev?: () => void; onNext?: () => void; position?: string }) {
  const t = useT();
  const q = useProduct(productId);
  const p = q.data;
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => setStatus(null), [productId]);
  return (
    <SideSheet
      open={!!productId}
      onClose={onClose}
      title={p?.name ?? t('common.loading')}
      subtitle={
        p
          ? [`SKU ${p.sku}`, p.category?.name, p.hasVariants ? t('products.variantsCount', { count: p.variants.length }) : null, t(`enum.Product.state.${p.archived ? 'archived' : p.isActive ? 'active' : 'hidden'}`)].filter(Boolean).join(' · ')
          : undefined
      }
      media={p ? <ProductThumb src={p.primaryImageUrl} name={p.name} size={44} /> : <Skeleton className="size-11" />}
      headerAction={
        productId ? (
          <Link href={`/products/${productId}`} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            {t('products.quick.full')}
          </Link>
        ) : null
      }
      nav={{ onPrev, onNext, position, prevLabel: t('products.quick.previous'), nextLabel: t('products.quick.next') }}
      status={status ? <span className={cn(status.tone === 'error' ? 'text-accent-alert' : status.tone === 'ok' ? 'text-accent-money' : undefined)} data-testid="quick-status">{`● ${status.text}`}</span> : null}
      footer={
        productId ? (
          <Link href={`/products/${productId}`} className={buttonClass({ variant: 'primary', size: 'sm' })}>
            {t('products.quick.open')}
          </Link>
        ) : null
      }
      width={460}
      closeLabel={t('action.close')}
    >
      {q.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body key={q.data.id} product={q.data} setStatus={setStatus} />
      )}
    </SideSheet>
  );
}

function Body({ product, setStatus }: { product: Product; setStatus: (s: Status) => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useCatalogRefresh();
  const { can, workspace } = useSession();
  const advanced = workspace?.stockMode === 'advanced';
  const editable = can('catalog.write') && !product.archived;
  const forbidden = editable ? undefined : product.archived ? t('products.quick.archived') : t('toast.forbidden');

  /* prices: saved when the field loses focus */
  const [values, setValues] = useState<Record<PriceField, string>>({ price: moneyDigits(product.price), oldPrice: moneyDigits(product.oldPrice), costPrice: moneyDigits(product.costPrice) });
  const [errors, setErrors] = useState<Partial<Record<PriceField | 'isActive', string>>>({});
  const version = useRef(product.version);
  version.current = product.version;
  const patch = useMutation({ mutationFn: (b: Parameters<typeof catalogApi.updateProduct>[1]) => catalogApi.updateProduct(product.id, b) });
  const write = (next: Product) => {
    qc.setQueryData(catalogKeys.product(ws, product.id), next);
    void refresh();
  };
  const fail = (field: PriceField | 'isActive', e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT') {
      // someone else saved meanwhile: take the fresh product, the user retypes the value
      void qc.invalidateQueries({ queryKey: catalogKeys.product(ws, product.id) });
      setStatus({ tone: 'error', text: t('products.quick.conflict') });
      return;
    }
    const key = e instanceof ApiError ? e.body.fields?.[field] : undefined;
    const message = key && t.has(key) ? t(key, { min: '', max: '' }) : errorMessage(e, t);
    setErrors((prev) => ({ ...prev, [field]: message }));
    setStatus({ tone: 'error', text: message });
  };
  const savePrice = async (field: PriceField) => {
    const value = digitsToInt(values[field]);
    const current = product[field];
    if (value === current) return;
    const schema = field === 'costPrice' ? productCost.nullable() : field === 'oldPrice' ? productPrice.nullable() : productPrice;
    const parsed = schema.safeParse(value);
    if (!parsed.success) return setErrors((prev) => ({ ...prev, [field]: t('validation.price') }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setStatus({ tone: 'busy', text: t('common.saving') });
    try {
      const r = await patch.mutateAsync({ [field]: value, version: version.current });
      write(r.data);
      const below = r.warnings.some((w) => w.code === 'SELLING_BELOW_COST');
      setStatus({ tone: 'ok', text: `${t(`products.quick.saved.${field}`)}${below ? ` · ${t('products.quick.belowCost')}` : ''}` });
    } catch (e) {
      fail(field, e);
    }
  };
  const toggleActive = async (isActive: boolean) => {
    setStatus({ tone: 'busy', text: t('common.saving') });
    try {
      const r = await patch.mutateAsync({ isActive, version: version.current });
      write(r.data);
      setStatus({ tone: 'ok', text: t(isActive ? 'products.quick.saved.active' : 'products.quick.saved.inactive') });
    } catch (e) {
      fail('isActive', e);
    }
  };
  const margin = advanced ? marginPct(digitsToInt(values.price), digitsToInt(values.costPrice)) : null;

  const priceField = (field: PriceField, label: string) => (
    <Field label={label} htmlFor={`quick-${field}`} error={errors[field]}>
      <MoneyInput
        id={`quick-${field}`}
        value={values[field]}
        onValueChange={(v) => setValues((prev) => ({ ...prev, [field]: v }))}
        onBlur={() => void savePrice(field)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        disabled={!editable}
        title={forbidden}
        aria-invalid={!!errors[field]}
        className="!h-9 text-[13px]"
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <SheetSection label={t('products.quick.section')} note={t('products.quick.sectionNote')}>
        <div className={cn('grid gap-3', advanced ? 'grid-cols-3' : 'grid-cols-2')}>
          {priceField('price', t('products.quick.price'))}
          {priceField('oldPrice', t('products.quick.oldPrice'))}
          {advanced ? priceField('costPrice', t('products.quick.cost')) : null}
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={product.isActive} onCheckedChange={(v) => void toggleActive(v)} label={t('products.quick.active')} disabled={!editable || patch.isPending} />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {product.isActive ? (product.agents.length ? t('products.quick.activeBy', { agents: product.agents.map((a) => a.name).join(', ') }) : t('products.quick.active')) : t('products.quick.inactive')}
          </span>
          {margin !== null ? (
            <Pill tone={margin < 0 ? 'danger' : 'success'} className="!rounded-[4px]">
              <span>{t('products.quick.margin')}</span> <Ltr>{`${margin} %`}</Ltr>
            </Pill>
          ) : null}
        </div>
        {errors.isActive ? <p className="text-[12px] text-accent-alert">{errors.isActive}</p> : null}
      </SheetSection>

      <StockSection product={product} setStatus={setStatus} />

      <SheetSection label={t('products.quick.images', { count: product.images.length, max: PRODUCT_IMAGES_MAX })}>
        <div data-testid="quick-images">
          <QuickImagesStrip product={product} disabled={!editable} />
        </div>
      </SheetSection>

      <Relations productId={product.id} />
    </div>
  );
}

/* ---------- stock per variant: a stepper change becomes one traced adjustment ---------- */
function StockSection({ product, setStatus }: { product: Product; setStatus: (s: Status) => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const { can } = useSession();
  const [reason, setReason] = useState<StockAdjustmentInput['reason']>('inventory');
  const [generate, setGenerate] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  useEffect(() => {
    const all = timers.current;
    return () => Object.values(all).forEach((id) => window.clearTimeout(id));
  }, []);
  const adjust = useMutation({ mutationFn: (b: StockAdjustmentInput) => catalogApi.adjust(b, uuid()) });

  if (!product.trackStock) {
    return (
      <SheetSection label={t('products.quick.stock')}>
        <p className="text-[13px] text-text-secondary">{t('products.quick.service')}</p>
      </SheetSection>
    );
  }
  const reasonOff = product.archived ? t('products.quick.archived') : can('stock.adjust') ? undefined : t('toast.forbidden');
  const lines = product.hasVariants
    ? product.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, variantId: v.id as string | null, name: v.name, price: v.price, stock: v.stock, state: v.stockState }))
    : [{ id: 'product', variantId: null, name: t('products.quick.stockLine'), price: product.price, stock: product.stock ?? 0, state: product.stockState === 'untracked' ? ('ok' as const) : product.stockState }];

  const commit = async (line: (typeof lines)[number], quantity: number) => {
    delete timers.current[line.id];
    if (quantity === line.stock) return setPending(({ [line.id]: _drop, ...rest }) => rest);
    setStatus({ tone: 'busy', text: t('common.saving') });
    try {
      await adjust.mutateAsync({ productId: product.id, variantId: line.variantId, type: 'set', quantity, reason: reasonRef.current, note: null });
      await refresh({ productId: product.id });
      setStatus({ tone: 'ok', text: t('products.quick.saved.stock', { name: line.variantId ? line.name : product.name }) });
    } catch (e) {
      setStatus({ tone: 'error', text: errorMessage(e, t) });
    } finally {
      setPending(({ [line.id]: _drop, ...rest }) => rest);
    }
  };
  const change = (line: (typeof lines)[number], next: number) => {
    setPending((prev) => ({ ...prev, [line.id]: next }));
    window.clearTimeout(timers.current[line.id]);
    // several clicks become one movement
    timers.current[line.id] = window.setTimeout(() => void commit(line, next), STEP_DELAY_MS);
  };

  return (
    <SheetSection label={product.hasVariants ? t('products.quick.stockByVariant') : t('products.quick.stock')} note={t('products.quick.stockNote')}>
      <ul className="divide-y divide-line-hairline rounded-card border border-line-edge" data-testid="quick-stock">
        {lines.map((line) => {
          const value = pending[line.id] ?? line.stock;
          return (
            <li key={line.id} className="flex items-center gap-3 px-3 py-2" data-line={line.name}>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{line.name}</span>
              {product.hasVariants ? <Num value={line.price} className="rounded-[6px] border border-line-hairline px-2 py-1 text-[12px] text-text-secondary" /> : null}
              <QtyStepper
                value={value}
                onChange={(n) => change(line, n)}
                disabledReason={reasonOff}
                tone={value <= 0 ? 'danger' : line.state === 'low' ? 'warning' : undefined}
                labels={{ decrease: t('products.quick.decrease', { name: line.name }), increase: t('products.quick.increase', { name: line.name }), value: t('products.quick.stockOf', { name: line.name }) }}
              />
              <span className="w-16 text-end">
                <StockPill state={line.state} />
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {product.hasVariants && can('catalog.write') && !product.archived ? (
          // in place: the variant generator of the product page (server-side creation), not a jump to the edit form
          <button type="button" onClick={() => setGenerate(true)} className="text-[13px] text-text-secondary hover:text-text-primary" data-testid="quick-add-variant">
            {t('products.quick.addVariant')}
          </button>
        ) : null}
        <label className="ms-auto flex items-center gap-2 whitespace-nowrap text-[13px] text-text-secondary">
          {t('products.quick.reason')}
          <Select aria-label={t('products.quick.reason')} value={reason} disabled={!!reasonOff} onChange={(e) => setReason(e.target.value as StockAdjustmentInput['reason'])} className="!h-8 !w-36 text-[13px]">
            {STOCK_ADJUSTMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`enum.StockMovement.reason.${r}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <GenerateVariantsDialog open={generate} onClose={() => setGenerate(false)} productId={product.id} productName={product.name} existing={product.variants} defaultPrice={product.price} />
    </SheetSection>
  );
}

/* ---------- LIÉ À CE PRODUIT ---------- */
function Relations({ productId }: { productId: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { workspace, can } = useSession();
  const advanced = workspace?.stockMode === 'advanced';
  const q = useProductRelations(productId);
  const reasonLabel = useMovementReason();
  const [tab, setTab] = useState('orders');
  if (q.isPending) return <Skeleton className="h-32" />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const empty = <p className="px-3 py-4 text-[13px] text-text-muted">{t('products.quick.related.empty')}</p>;
  const tabs: [string, string, number][] = [
    ['orders', t('products.quick.related.orders'), r.orders?.count ?? 0],
    ['movements', t('products.quick.related.movements'), r.movements?.count ?? 0],
    ['agents', t('products.quick.related.agents'), r.agents?.count ?? 0],
    ['recommendations', t('products.quick.related.recommendations'), r.recommendations?.count ?? 0],
  ];
  const box = 'divide-y divide-line-hairline rounded-card border border-line-edge';
  return (
    <SheetSection label={t('products.quick.related')}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="border-b-0">
          {tabs.map(([key, label, count]) => (
            <TabsTrigger key={key} value={key} className="rounded-[6px] border border-transparent !px-2.5 !py-1 ts-label-meta data-[state=active]:border-line-lit">
              {label} · <Ltr>{formatNumber(count)}</Ltr>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="orders" className="mt-3">
          {r.orders?.last?.length ? (
            <ul className={box}>
              {r.orders.last.map((o, i) => (
                <li key={`${o.id}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">
                      <Link href={`/orders/${o.id}`} className="hover:underline">
                        <Ltr>{`#${o.number}`}</Ltr>
                      </Link>
                    </div>
                    <div className="ts-label-meta uppercase text-text-muted">
                      {o.variantName ? `${o.variantName} ` : ''}
                      <Ltr>{`×${o.quantity}`}</Ltr> · {formatDate(o.orderedAt, locale)}
                    </div>
                  </div>
                  <StatusPill enumKey="Order.status" value={o.status} className="!rounded-[4px]">
                    {t.has(`enum.Order.status.${o.status}`) ? t(`enum.Order.status.${o.status}`) : o.status}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
          {(r.orders?.count ?? 0) > 0 && can('orders.read') ? (
            <Link href={`/orders?productId=${productId}`} className="mt-2 inline-block text-[13px] text-accent-inbound hover:underline" data-testid="product-orders-link">
              {t('products.quick.related.allOrders', { count: r.orders?.count ?? 0 })}
            </Link>
          ) : null}
        </TabsContent>
        <TabsContent value="movements" className="mt-3">
          {r.movements?.last?.length ? (
            <>
              <ul className={box}>
                {r.movements.last.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <MovementTypePill type={m.type} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{m.variant?.name ?? reasonLabel(m.reason)}</div>
                      <div className="ts-label-meta uppercase text-text-muted">
                        {m.variant ? `${reasonLabel(m.reason)} · ` : ''}
                        {formatDate(m.createdAt, locale)}
                      </div>
                    </div>
                    <Num value={m.quantity} signed className={m.quantity < 0 ? 'text-accent-alert' : 'text-accent-money'} />
                  </li>
                ))}
              </ul>
              {advanced ? (
                <Link href={`/movements?productId=${productId}`} className="mt-2 inline-block text-[13px] text-accent-inbound hover:underline">
                  {t('products.quick.related.allMovements', { count: r.movements.count })}
                </Link>
              ) : null}
            </>
          ) : (
            empty
          )}
        </TabsContent>
        <TabsContent value="agents" className="mt-3">
          {r.agents?.last?.length ? (
            <ul className={box}>
              {r.agents.last.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-[14px]">
                  <Link href={`/agents/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline" data-agent={a.id}>
                    {a.name}
                  </Link>
                  <span className="ts-label-meta uppercase text-text-muted">{t.has(`enum.Agent.status.${a.status}`) ? t(`enum.Agent.status.${a.status}`) : a.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
        </TabsContent>
        <TabsContent value="recommendations" className="mt-3">
          {r.recommendations?.last?.length ? (
            <ul className={box}>
              {r.recommendations.last.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{x.recommended?.name ?? '—'}</span>
                  <span className="ts-label-meta uppercase text-text-muted">{t.has(`enum.Recommendation.type.${x.type}`) ? t(`enum.Recommendation.type.${x.type}`) : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
        </TabsContent>
      </Tabs>
    </SheetSection>
  );
}
