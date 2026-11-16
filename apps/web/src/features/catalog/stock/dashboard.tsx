'use client';
// /stock — Figma "GDS-01 — Stock dashboard (advanced) + adjust dialog" (12 §21 "Stock dashboard").
// Simple mode: products / low stock / retail value + the low-stock list. Advanced: + value at cost, items in stock,
// recent movements. `GET /stock/overview` (tiles + recent movements), `GET /products/low-stock`.
import { formatDate, formatNumber } from '@djaber/shared';
import { Button, buttonClass, Card, cn, EmptyState, Ltr, Pill, SectionLabel, Skeleton } from '@djaber/ui';
import { Boxes } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { compactAmount } from '@/lib/money';
import { useSession } from '@/lib/session';
import { AdjustStockDialog, type AdjustTarget } from '../adjust-stock-dialog';
import { useLowStock, useStockOverview } from '../api';
import type { LowStockItem, StockMovement } from '../contracts';
import { MovementTypePill, Num, useMovementReason } from '../ui';
import { actorName, formatSigned, movementTimeLabel, quantityTone, referenceKind, signedQuantity, withoutYear } from './logic';

type Adjust = { product: AdjustTarget | null; variantId: string | null };

export function StockDashboard() {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const { workspace, can } = useSession();
  const router = useRouter();
  const advanced = workspace?.stockMode === 'advanced';
  const canAdjust = can('stock.adjust');
  const canWrite = can('catalog.write');
  const overview = useStockOverview();
  const low = useLowStock();
  const [adjust, setAdjust] = useState<Adjust | null>(null);

  const o = overview.data;
  const empty = !!o && (o.totalProducts ?? o.activeProducts + o.services) === 0;
  const lowRows = low.data ?? [];
  const canPurchase = advanced && can('gds.write');
  const restock = (r: LowStockItem) =>
    canPurchase
      ? router.push(`/purchases/new?productId=${r.productId}${r.variantId ? `&variantId=${r.variantId}` : ''}&quantity=${Math.max(1, r.minStock * 2 - r.stock)}`)
      : setAdjust({ product: { id: r.productId, name: r.name, trackStock: true, hasVariants: !!r.variantId, stock: r.variantId ? null : r.stock }, variantId: r.variantId });

  return (
    <AppPage
      wide
      eyebrow={t('nav.group.stock')}
      title={t('nav.stockDashboard')}
      description={t(advanced ? 'stock.dashboard.subtitle.advanced' : 'stock.dashboard.subtitle.simple')}
      permission={['catalog.read', 'stock.read']}
      actions={
        <>
          {advanced ? <Pill tone="success" className="rounded-[4px]">{t('stock.dashboard.modeAdvanced')}</Pill> : null}
          {advanced ? (
            <Link href="/movements" className={buttonClass()}>
              {t('nav.movements')}
            </Link>
          ) : null}
          <Button variant="primary" onClick={() => setAdjust({ product: null, variantId: null })} disabledReason={canAdjust ? undefined : t('toast.forbidden')}>
            {t('stock.dashboard.adjust')}
          </Button>
        </>
      }
    >
      {overview.isPending ? (
        <div role="status" aria-label={t('common.loading')} className={cn('grid gap-3 sm:grid-cols-2', advanced ? 'xl:grid-cols-5' : 'lg:grid-cols-3')}>
          {Array.from({ length: advanced ? 5 : 3 }).map((_, i) => (
            <Card key={i} className="flex flex-col gap-3 p-3">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-2.5 w-20" />
            </Card>
          ))}
        </div>
      ) : overview.isError ? (
        <QueryError error={overview.error} onRetry={() => overview.refetch()} />
      ) : empty ? (
        <EmptyState
          icon={<Boxes className="size-5" />}
          title={t('stock.dashboard.empty.title')}
          description={t('stock.dashboard.empty.description')}
          action={canWrite ? { label: t('stock.dashboard.empty.add'), href: `/${locale}/products/new` } : undefined}
          secondaryAction={canWrite ? { label: t('action.import'), href: `/${locale}/products/import` } : undefined}
        />
      ) : o ? (
        <>
          <div className={cn('grid gap-3 sm:grid-cols-2', advanced ? 'xl:grid-cols-5' : 'lg:grid-cols-3')} data-testid="stock-tiles">
            <Tile testId="tile-products" label={t('stock.dashboard.tile.products')} value={<Num value={o.activeProducts} />} hint={o.services ? t('stock.dashboard.tile.services', { count: o.services }) : undefined} />
            <Tile
              testId="tile-low"
              href="/products?lowStock=1"
              label={t('stock.dashboard.tile.low')}
              value={<Num value={o.lowStockCount ?? 0} />}
              tone={o.outOfStockCount ? 'alert' : o.lowStockCount ? 'starred' : undefined}
              hint={o.outOfStockCount ? t('stock.dashboard.tile.out', { count: o.outOfStockCount }) : undefined}
            />
            {advanced ? <AmountTile testId="tile-cost" label={t('stock.dashboard.tile.cost')} amount={o.valueAtCost} locale={locale} hint={t('stock.dashboard.tile.variants')} /> : null}
            <AmountTile testId="tile-retail" label={t('stock.dashboard.tile.retail')} amount={o.valueAtRetail} locale={locale} />
            {advanced ? <Tile testId="tile-items" label={t('stock.dashboard.tile.items')} value={<Num value={o.totalItems ?? 0} />} /> : null}
          </div>

          <div className={cn('grid items-start gap-5', advanced && 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}>
            {advanced ? (
              <section className="flex flex-col gap-2" aria-labelledby="recent-movements">
                <SectionLabel id="recent-movements">{t('stock.dashboard.recent')}</SectionLabel>
                {(o.recentMovements ?? []).length === 0 ? (
                  <EmptyState title={t('stock.dashboard.recent.empty')} />
                ) : (
                  <Card>
                    <ul className="divide-y divide-line-hairline" data-testid="recent-movements">
                      {(o.recentMovements ?? []).map((m) => (
                        <RecentMovement key={m.id} movement={m} locale={locale} />
                      ))}
                    </ul>
                  </Card>
                )}
              </section>
            ) : null}

            <section className="flex flex-col gap-2" aria-labelledby="low-stock">
              <SectionLabel id="low-stock">
                {t('stock.dashboard.low')}
                {low.data ? (
                  <>
                    {' · '}
                    <Ltr>{formatNumber(lowRows.length)}</Ltr>
                  </>
                ) : null}
              </SectionLabel>
              {low.isPending ? (
                <Card className="flex flex-col gap-3 p-4" role="status" aria-label={t('common.loading')}>
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </Card>
              ) : low.isError ? (
                <QueryError error={low.error} onRetry={() => low.refetch()} />
              ) : lowRows.length === 0 ? (
                <EmptyState title={t('stock.dashboard.low.empty')} />
              ) : (
                <ul className={cn('grid gap-2', !advanced && 'lg:grid-cols-2')} data-testid="low-stock">
                  {lowRows.map((r) => (
                    <li key={`${r.productId}:${r.variantId ?? ''}`} data-product={r.productId} data-variant={r.variantId ?? undefined}>
                      <Card className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/products/${r.productId}`} className="block truncate text-[14px] font-medium hover:underline">
                            {r.name}
                            {r.variantName ? ` · ${r.variantName}` : ''}
                          </Link>
                          <div className="ts-label-meta mt-0.5 text-text-muted">{t('stock.dashboard.threshold', { count: r.minStock })}</div>
                        </div>
                        <Num value={r.stock} className={cn('ts-numeral-l', r.stock <= 0 ? 'text-accent-alert' : 'text-accent-starred')} />
                        <Button variant="ghost" onClick={() => restock(r)} disabledReason={canPurchase || canAdjust ? undefined : t('toast.forbidden')}>
                          {t(advanced ? 'stock.dashboard.restock' : 'stock.dashboard.adjustRow')}
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
              {advanced && o.purchasing ? <PurchasingBlock p={o.purchasing} /> : null}
            </section>
          </div>
        </>
      ) : null}

      <AdjustStockDialog open={adjust !== null} onClose={() => setAdjust(null)} product={adjust?.product ?? null} variantId={adjust?.variantId ?? null} />
    </AppPage>
  );
}

function Tile({ label, value, unit, hint, tone, href, testId }: { label: string; value: ReactNode; unit?: string; hint?: string; tone?: 'alert' | 'starred'; href?: string; testId: string }) {
  const body = (
    <>
      <div className="ts-label-micro uppercase text-text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn('ts-numeral-l', tone === 'alert' && 'text-accent-alert', tone === 'starred' && 'text-accent-starred')}>{value}</span>
        {unit ? <span className="ts-label-micro text-text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="ts-label-meta mt-1.5 text-text-muted">{hint}</div> : null}
    </>
  );
  const cls = 'block rounded-card border border-line-edge bg-ink-surface p-3';
  return href ? (
    <Link href={href} data-testid={testId} className={cn(cls, 'transition-colors hover:border-line-lit')}>
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  );
}

/** `1,24 M DA` over one million, `184 000 DA` under. */
function AmountTile({ label, amount, locale, hint, testId }: { label: string; amount: number | null | undefined; locale: string; hint?: string; testId: string }) {
  const t = useT();
  if (amount === null || amount === undefined) return <Tile testId={testId} label={label} value="—" hint={hint} />;
  const text = compactAmount(amount, locale);
  const million = text.endsWith(' M');
  return <Tile testId={testId} label={label} value={<Ltr className="tabular-nums">{million ? text.slice(0, -2) : text}</Ltr>} unit={million ? t('stock.dashboard.unit.million') : t('common.currency')} hint={hint} />;
}

function RecentMovement({ movement: m, locale }: { movement: StockMovement; locale: 'fr' | 'ar' | 'en' }) {
  const t = useT();
  const reason = useMovementReason();
  const qty = signedQuantity(m);
  const tone = quantityTone(qty);
  const when = movementTimeLabel(m.createdAt);
  const kind = referenceKind(m.reference?.type);
  const reference = m.reversalOf ? t('movements.reversalOf', { date: formatDate(m.reversalOf.createdAt, locale) }) : !m.reference ? null : kind === 'number' ? `#${m.reference.label}` : kind === 'name' ? m.reference.label : null;
  // full-test 15/11 STOCK-14: a note that only repeats the reference (« CMD-1024 ») is not said twice
  const note = m.note && m.reference?.label && m.note.replace(/^#/, '').trim() === m.reference.label ? null : m.note;
  const line = [m.reason ? reason(m.reason) : null, reference, note, actorName(m.actor) ?? t('movements.system')].filter((x): x is string => !!x);
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-movement={m.id}>
      <span className="w-24 shrink-0">
        <MovementTypePill type={m.type} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/products/${m.product.id}`} className="block truncate text-[14px] font-medium hover:underline">
          {m.product.name}
          {m.variant ? ` · ${m.variant.name}` : ''}
        </Link>
        <div className="ts-label-meta mt-0.5 truncate text-text-muted">
          {/* each part isolated: in Arabic « #ACH-1011 » keeps its « # » and a name its full stop (STOCK-07) */}
          {line.map((part, i) => (
            <span key={i}>
              {i ? ' · ' : null}
              <bdi>{part}</bdi>
            </span>
          ))}
        </div>
      </div>
      <Ltr className={cn('ts-numeral-m tabular-nums', tone === 'in' && 'text-accent-money', tone === 'out' && 'text-accent-alert')}>{m.type === 'inventory' && qty === 0 ? `= ${formatNumber(m.after)}` : formatSigned(qty)}</Ltr>
      <span className="ts-label-meta w-14 shrink-0 text-end uppercase text-text-muted" title={formatDate(m.createdAt, locale)}>
        {when.kind === 'time' ? <Ltr>{when.value}</Ltr> : when.kind === 'yesterday' ? t('common.yesterday') : withoutYear(formatDate(m.createdAt, locale))}
      </span>
    </li>
  );
}

/** "ACHATS & FOURNISSEURS" (GDS-01 advanced, M2 carry-over): pending purchases, received this month, active suppliers. */
function PurchasingBlock({ p }: { p: NonNullable<import('../contracts').StockOverview['purchasing']> }) {
  const t = useT();
  const rows: { key: string; label: string; value: ReactNode; href: string }[] = [
    // full-test 15/11 STOCK-05: the count and the value of the same purchases (the list it opens); what is owed is its own row
    { key: 'pending', label: t('stock.dashboard.purchasing.pending'), value: <Ltr className="tabular-nums">{`${formatNumber(p.pendingReceipt)} · ${formatNumber(p.pendingValue)} DA`}</Ltr>, href: '/purchases?status=pending,partial' },
    { key: 'due', label: t('stock.dashboard.purchasing.due'), value: <Ltr className="tabular-nums">{`${formatNumber(p.dueToSuppliers)} DA`}</Ltr>, href: '/suppliers?hasBalance=1' },
    { key: 'received', label: t('stock.dashboard.purchasing.purchased'), value: <Ltr className="tabular-nums">{`${formatNumber(p.purchased30d)} DA`}</Ltr>, href: '/purchases?period=30d' },
    { key: 'suppliers', label: t('stock.dashboard.purchasing.suppliers'), value: <Ltr className="tabular-nums">{formatNumber(p.activeSuppliers)}</Ltr>, href: '/suppliers' },
  ];
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="purchasing-block">
      <SectionLabel>{t('stock.dashboard.purchasing.title')}</SectionLabel>
      <Card className="flex flex-col gap-2 px-4 py-3">
        {rows.map((r) => (
          <Link key={r.key} href={r.href} className="flex items-center justify-between gap-3 hover:text-text-primary" data-row={r.key}>
            <span className="ts-label-micro text-text-muted">{r.label}</span>
            <span className="text-[14px]">{r.value}</span>
          </Link>
        ))}
        {p.late ? <span className="ts-label-meta text-accent-alert">{t('stock.dashboard.purchasing.late', { count: p.late })}</span> : null}
        {p.restockSuggestions ? (
          <Link href="/recommendations?type=restock" className="ts-label-meta text-accent-inbound hover:underline">
            {t('stock.dashboard.purchasing.suggestions', { count: p.restockSuggestions })}
          </Link>
        ) : null}
      </Card>
    </div>
  );
}
