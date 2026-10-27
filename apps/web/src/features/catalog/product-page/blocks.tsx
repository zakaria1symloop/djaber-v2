'use client';
// Blocks of the product page — Figma "CAT-09 — Product page — full (gallery, variants, stock, margins, agents,
// movements, archived)": Galerie, Mouvements récents, Prix & marge, Stock, Agents & canaux. Read-only, except the
// gallery "+ Ajouter" which uploads in place (reorder / primary / delete stay in the edit form); stock moves only
// through "Ajuster", expenses are edited under "Prix & marge" (M7).
import { useAgents } from '@/features/agents/api';
import { ExpensesEditor } from '@/features/gds/product-expenses';
import { formatDate, formatDateTime, formatNumber, PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIN_PX, PRODUCT_IMAGES_MAX } from '@djaber/shared';
import { cn, Dialog, ImageTileGrid, Ltr, Pill, Skeleton } from '@djaber/ui';
import { ImageOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useMovements } from '../api';
import type { Product, ProductImage } from '../contracts';
import { IMAGE_ACCEPT } from '../product-form/images';
import { useImageGridLabels, useProductImageEditor } from '../product-form/images-section';
import { Money, MovementTypePill, Num, Pct, useMovementReason } from '../ui';
import { stockSummary } from './logic';
import { Block, Note, Row, Rows } from './parts';

type Locale = 'fr' | 'ar' | 'en';
const RECENT_MOVEMENTS = 5;
const linkClass = 'text-[13px] text-text-secondary hover:text-text-primary';

/* ---------- Galerie ---------- */
export function GalleryBlock({ product, canEdit }: { product: Pick<Product, 'id' | 'name' | 'images'>; canEdit: boolean }) {
  const t = useT();
  const [large, setLarge] = useState<ProductImage | null>(null);
  const images = product.images ?? [];
  // "+ Ajouter" picks and uploads right here (same checks, progress and inline errors as the product form); the upload is
  // the save: the picture goes to moderation at once and is flagged until approved (tester log 26/10 UX-039)
  const editor = useProductImageEditor(product);
  const imageLabels = useImageGridLabels();
  const input = useRef<HTMLInputElement>(null);
  const uploads = editor.tiles.filter((tile) => editor.isLocal(tile.id));
  const full = images.length >= PRODUCT_IMAGES_MAX;
  const fullReason = full ? `${t('error.IMAGES_LIMIT')} (IMAGES_LIMIT)` : undefined;
  return (
    <Block
      title={t('products.page.gallery.title', { max: PRODUCT_IMAGES_MAX })}
      testId="block-gallery"
      action={
        canEdit ? (
          <>
            <button type="button" className={cn(linkClass, 'disabled:cursor-not-allowed disabled:opacity-50')} disabled={full} title={fullReason} aria-describedby={full ? 'gallery-full' : undefined} onClick={() => input.current?.click()} data-testid="gallery-add">
              {t('products.page.gallery.add')}
            </button>
            {full ? (
              <span id="gallery-full" className="sr-only">
                {fullReason}
              </span>
            ) : null}
            <input
              ref={input}
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              data-upload="product-image"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) editor.add(files);
              }}
            />
          </>
        ) : null
      }
    >
      {images.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-[13px] text-text-muted">
          <ImageOff className="size-4" aria-hidden />
          {t('products.page.gallery.empty')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2.5">
          {images.map((img, i) => {
            const sending = img.processed === false;
            return (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => setLarge(img)}
                  aria-label={t('products.page.gallery.open', { n: i + 1 })}
                  data-primary={img.isPrimary || undefined}
                  data-sending={sending || undefined}
                  className={cn(
                    'relative block size-[108px] overflow-hidden rounded-[8px] border bg-ink-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound',
                    img.isPrimary ? 'border-signal-live' : 'border-line-hairline hover:border-line-lit',
                  )}
                >
                  <img src={img.thumbUrl || img.url} alt={img.altText ?? ''} loading="lazy" className={cn('size-full object-cover', sending && 'opacity-40')} />
                  {sending ? (
                    <span className="absolute inset-0 flex items-center justify-center ts-label-meta uppercase text-text-secondary">{t('products.page.gallery.sending')}</span>
                  ) : null}
                  {img.awaitingReview ? (
                    <span className="absolute inset-x-1 top-1 truncate rounded-[3px] bg-accent-starred px-1 text-center ts-label-micro text-black" title={t('products.form.images.awaitingReview')} data-awaiting-review>
                      {t('products.form.images.awaitingReview')}
                    </span>
                  ) : null}
                  {img.isPrimary ? (
                    <span className="absolute bottom-1.5 start-1.5 rounded-[4px] border border-signal-live/50 bg-ink-base/80 px-1.5 py-0.5 ts-label-micro uppercase text-signal-live">
                      {t('products.page.gallery.primary')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {uploads.length ? <ImageTileGrid tiles={uploads} max={PRODUCT_IMAGES_MAX} accept={IMAGE_ACCEPT} labels={imageLabels} onRemove={editor.remove} onRetry={editor.retry} size={108} /> : null}
      <Note>
        <bdi>{t('products.page.gallery.hint', { size: Math.round(PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)), max: PRODUCT_IMAGES_MAX, px: PRODUCT_IMAGE_MIN_PX })}</bdi>
        {canEdit ? <span className="block">{t('products.page.gallery.sentToReview')}</span> : null}
      </Note>
      <Dialog open={!!large} onOpenChange={(o) => !o && setLarge(null)} title={product.name} description={large?.altText ?? large?.aiCaption ?? undefined} closeLabel={t('action.close')} size="lg">
        {large ? <img src={large.url} alt={large.altText ?? product.name} className="max-h-[70vh] w-full rounded-[8px] object-contain" data-testid="gallery-large" /> : null}
      </Dialog>
    </Block>
  );
}

/* ---------- Mouvements récents (advanced) ---------- */
export function MovementsBlock({ productId }: { productId: string }) {
  const t = useT();
  const locale = useLocaleCode() as Locale;
  const reason = useMovementReason();
  const q = useMovements({ productId, pageSize: 25 });
  const rows = (q.data?.rows ?? []).slice(0, RECENT_MOVEMENTS);
  const th = 'ts-label-micro whitespace-nowrap border-b border-line-hairline px-3 py-2 text-start uppercase text-text-muted';
  return (
    <Block
      title={t('products.page.movements.title')}
      testId="block-movements"
      action={
        <Link href={`/movements?productId=${productId}`} className="ts-label-meta uppercase text-accent-inbound hover:underline">
          {t('products.page.movements.all')}
        </Link>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="py-3 text-[13px] text-text-muted">{t('products.page.movements.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-[8px] border border-line-edge">
          <table className="w-full border-collapse text-[13px]" aria-label={t('products.page.movements.title')}>
            <thead>
              <tr>
                <th scope="col" className={th}>{t('common.date')}</th>
                <th scope="col" className={th}>{t('products.page.movements.type')}</th>
                <th scope="col" className={th}>{t('products.page.movements.qty')}</th>
                <th scope="col" className={th}>{t('products.page.movements.beforeAfter')}</th>
                <th scope="col" className={th}>{t('products.page.movements.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const incoming = m.after >= m.before;
                return (
                  <tr key={m.id} className="border-b border-line-hairline last:border-b-0" data-movement={m.id}>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <bdi className="tabular-nums">{formatDateTime(m.createdAt, locale)}</bdi>
                    </td>
                    <td className="px-3 py-2.5">
                      <MovementTypePill type={m.type} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Num value={incoming ? Math.abs(m.quantity) : -Math.abs(m.quantity)} signed />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Ltr className="tabular-nums">{`${formatNumber(m.before)} → ${formatNumber(m.after)}`}</Ltr>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {m.reference?.label ? <Ltr>{m.reference.label}</Ltr> : null}
                      {m.reference?.label && m.reason ? ' · ' : ''}
                      {m.reason || !m.reference?.label ? reason(m.reason) : null}
                      {m.variant ? ` · ${m.variant.name}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

/* ---------- Prix & marge ---------- */
export function PricingBlock({ product, advanced, canEdit = false }: { product: Pick<Product, 'id' | 'price' | 'oldPrice' | 'pricing'> & Partial<Pick<Product, 'priceRange'>>; advanced: boolean; /** expenses editor (catalog.write, live product) */ canEdit?: boolean }) {
  const t = useT();
  const p = product.pricing;
  // PV 26/10 P4: a product with variants is sold at its variants' prices — those, and the margin of each variant
  const range = product.priceRange ?? null;
  const perVariant = p?.variants?.length ? p.variants : null;
  const units = (n: number) => <Ltr className="tabular-nums">{t('products.page.units', { count: formatNumber(n) })}</Ltr>;
  return (
    <Block title={t(advanced ? 'products.page.pricing.title' : 'products.page.pricing.titleSimple')} testId="block-pricing">
      <Rows>
        <Row label={t('products.page.pricing.price')} testId="pricing-price">
          {range ? (
            <>
              <Money value={range.min} />
              {range.max !== range.min ? (
                <>
                  {' – '}
                  <Money value={range.max} />
                </>
              ) : null}
            </>
          ) : (
            <Money value={product.price} />
          )}
          {!range && product.oldPrice ? (
            <>
              {' '}
              <Money value={product.oldPrice} className="text-text-muted line-through" />
            </>
          ) : null}
        </Row>
        {advanced ? (
          <>
            <Row label={t('products.page.pricing.weightedCost')} testId="pricing-cost">
              <Money value={p?.weightedCost} />
            </Row>
            <Row label={t('products.page.pricing.expenses')}>
              <Money value={p?.expensesPerUnit ?? 0} />
            </Row>
            <Row label={t('products.page.pricing.margin')} testId="pricing-margin">
              {p?.marginDzd === null || p?.marginDzd === undefined ? (
                <span className="text-text-muted">—</span>
              ) : (
                <>
                  <Money value={p.marginDzd} className={p.marginDzd < 0 ? 'text-accent-alert' : 'text-accent-money'} /> · <Pct value={p.marginPct} />
                </>
              )}
            </Row>
            {perVariant ? (
              <Row label={t('products.page.pricing.byVariant')} testId="pricing-variants">
                <ul className="flex flex-col gap-0.5">
                  {perVariant.map((v) => (
                    <li key={v.id} data-variant={v.id}>
                      <bdi>{v.name}</bdi> · <Money value={v.price} /> ·{' '}
                      {v.marginDzd === null ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <>
                          <Money value={v.marginDzd} className={v.marginDzd < 0 ? 'text-accent-alert' : 'text-accent-money'} /> · <Pct value={v.marginPct} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <span className="mt-1 block ts-label-meta text-text-muted">{t('products.page.pricing.variantsNote')}</span>
              </Row>
            ) : null}
            <Row label={t('products.page.pricing.sales30d')}>
              {units(p?.sales30d?.units ?? 0)} · <Money value={p?.sales30d?.revenue ?? 0} />
            </Row>
          </>
        ) : null}
      </Rows>
      {advanced ? <ExpensesEditor productId={product.id} price={product.price} pricing={product.pricing} canEdit={canEdit} /> : null}
    </Block>
  );
}

/* ---------- Stock ---------- */
export function StockBlock({ product, advanced }: { product: Product; advanced: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as Locale;
  const s = stockSummary(product);
  const d = product.stockDetail;
  const units = (n: number) => <Ltr className="tabular-nums">{t('products.page.units', { count: formatNumber(n) })}</Ltr>;
  return (
    <Block title={t('products.page.stock.title')} testId="block-stock">
      <Rows>
        <Row label={t('products.page.stock.tracking')} testId="stock-tracking">
          {t(s.tracked ? 'products.page.stock.tracked' : 'products.page.stock.service')}
        </Row>
        {s.tracked ? (
          <>
            <Row label={t('common.total')} testId="stock-total">
              <span className={cn(product.stockState === 'out' && 'text-accent-alert')}>{units(s.total)}</span>
              {s.variants > 0 ? ` (${t('products.page.variantsCount', { count: s.variants })})` : ''}
              {s.alerts > 0 ? (
                <>
                  {' · '}
                  <span className="text-accent-starred">{t('products.page.stock.alerts', { count: s.alerts })}</span>
                </>
              ) : null}
              {product.stockState === 'out' ? (
                <>
                  {' '}
                  <Pill tone="danger" className="rounded-[4px]">
                    {t('products.stock.out')}
                  </Pill>
                </>
              ) : null}
            </Row>
            <Row label={t('products.page.stock.reserved')} testId="stock-reserved">
              {units(d?.reserved ?? 0)} <span className="text-text-secondary">{t('products.page.stock.reservedHint')}</span>
            </Row>
            <Row label={t('products.page.stock.availableForAi')} testId="stock-available">
              {units(d?.availableForAi ?? Math.max(0, s.total - (d?.reserved ?? 0)))}
            </Row>
            {advanced ? (
              <Row label={t('products.page.stock.lastInventory')} testId="stock-last-inventory">
                {d?.lastInventoryAt ? (
                  <>
                    <bdi>{formatDate(d.lastInventoryAt, locale)}</bdi>
                    <LastInventoryGap productId={product.id} />
                  </>
                ) : (
                  <span className="text-text-muted">{t('products.page.stock.noInventory')}</span>
                )}
              </Row>
            ) : null}
          </>
        ) : null}
      </Rows>
    </Block>
  );
}

/* ---------- Agents & canaux ---------- */
export function AgentsBlock({ product, onAdd }: { product: Pick<Product, 'agents' | 'mentions30d' | 'aiState'> & { id?: string }; /** "Ajouter à un agent" (catalog.write, live product) */ onAdd?: () => void }) {
  const t = useT();
  const productId = product.id;
  const { can } = useSession();
  const linked = can('agents.read');
  // "Agents qui le vendent" (M11): `GET /agents?productId=` also counts the agents selling the whole catalogue or the
  // product's category; the product's own `agents` (explicit links only) is the fallback for members without agents.read
  const selling = useAgents(productId ? { productId } : {}, linked && !!productId);
  const agents = linked && selling.data ? selling.data.rows.map((a) => ({ id: a.id, name: a.name, status: a.status })) : (product.agents ?? []);
  const m = product.mentions30d;
  return (
    <Block
      title={t('products.page.agents.title')}
      testId="block-agents"
      action={
        onAdd ? (
          <button type="button" onClick={onAdd} className="ts-label-meta uppercase text-accent-inbound hover:underline" data-testid="add-to-agent-open">
            {t('action.addToAgent')}
          </button>
        ) : null
      }
    >
      <Rows>
        <Row label={t('products.page.agents.proposedBy')} testId="agents-list">
          {agents.length ? (
            // "Agents qui le vendent": each one opens its page
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              {agents.map((a, i) => (
                <span key={a.id}>
                  {linked ? (
                    <Link href={`/agents/${a.id}`} className="hover:underline" data-agent={a.id}>
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                  {i < agents.length - 1 ? <span aria-hidden> ·</span> : null}
                </span>
              ))}
              {/* M11: the agents list filtered on this product (`GET /agents?productId=`) */}
              {linked && productId ? (
                <Link href={`/agents?productId=${productId}`} className="ts-label-meta uppercase text-accent-inbound hover:underline" data-testid="agents-of-product">
                  {t('carry.products.agents.viewList')}
                </Link>
              ) : null}
            </span>
          ) : (
            <span className="text-text-muted">{t(product.aiState === 'excluded' ? 'products.page.agents.excluded' : 'products.page.agents.none')}</span>
          )}
        </Row>
        <Row label={t('products.page.agents.mentions')}>
          {t('products.page.agents.conversations', { count: m?.conversations ?? 0 })} · {t('products.page.agents.orders', { count: m?.orders ?? 0 })}
        </Row>
      </Rows>
    </Block>
  );
}

/** INV-03 "DERNIER INVENTAIRE · date · écart": the INVENTAIRE movements of the last count of this product (variants summed), linked to the count. */
function LastInventoryGap({ productId }: { productId: string }) {
  const t = useT();
  const q = useMovements({ productId, type: ['inventory'], pageSize: 25, page: 1, sort: '-createdAt' });
  const rows = q.data?.rows ?? [];
  const last = rows[0]?.reference;
  if (!last) return null;
  const gap = rows.filter((m) => m.reference?.id === last.id).reduce((s, m) => s + (m.after - m.before), 0);
  return (
    <>
      {' · '}
      <Link href={`/inventory/${last.id}`} className={cn('hover:underline', gap < 0 ? 'text-accent-alert' : gap > 0 ? 'text-accent-money' : '')}>
        <Ltr className="tabular-nums">{t('products.page.stock.inventoryGap', { gap: `${gap > 0 ? '+' : gap < 0 ? '−' : ''}${Math.abs(gap)}` })}</Ltr>
      </Link>
    </>
  );
}
