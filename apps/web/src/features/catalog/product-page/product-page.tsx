'use client';
// /products/[id] — Figma "CAT-09 — Product page — full (gallery, variants, stock, margins, agents, movements,
// archived)" + "MOD — Product — rejected view + appeal dialog (merchant)" + DLG GDS II "Restaurer".
// Read page: edits happen in the form (`/products/:id/edit`), except the inline variant fields and the stock dialog.
import { formatDate } from '@djaber/shared';
import { ActionsMenu, Banner, Button, buttonClass, Card, Ltr, Skeleton, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { usePathname, useRouter as useNextRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { catalogApi, useCatalogRefresh, useProduct } from '../api';
import type { Product } from '../contracts';
import { AiPill, aiExclusion, ModerationPill, ProductStatePill } from '../ui';
import { AgentsBlock, DetailsBlock, GalleryBlock, MovementsBlock, PricingBlock, StockBlock } from './blocks';
import { moderationView } from './logic';
import { AppealDialog, RejectedBanner, ValidationBlock } from './moderation';
import { useProductActions } from './use-product-actions';
import { VariantsBlock } from './variants-block';

type Locale = 'fr' | 'ar' | 'en';

function Crumbs({ product }: { product: Pick<Product, 'name' | 'category'> | null }) {
  const t = useT();
  return (
    <nav aria-label={t('products.page.breadcrumb')} className="flex flex-wrap items-center gap-1.5 ts-label-meta text-text-muted">
      <Link href="/products" className="text-accent-inbound hover:underline">
        {t('nav.products')}
      </Link>
      {product?.category ? (
        <>
          <span aria-hidden>/</span>
          <Link href={`/products?categoryIds=${product.category.id}`} className="hover:text-text-primary">
            {product.category.name}
          </Link>
        </>
      ) : null}
      {product ? (
        <>
          <span aria-hidden>/</span>
          <span aria-current="page" className="text-text-secondary">
            {product.name}
          </span>
        </>
      ) : null}
    </nav>
  );
}

/** Same blocks as the loaded page (never a full-page spinner). */
function PageSkeleton({ advanced }: { advanced: boolean }) {
  const t = useT();
  const block = (h: string, key: string) => (
    <Card key={key} className="p-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className={`mt-3 ${h}`} />
    </Card>
  );
  return (
    <div role="status" aria-label={t('common.loading')} className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" data-testid="product-skeleton">
      <div className="flex flex-col gap-4">{[block('h-28', 'gallery'), ...(advanced ? [block('h-32', 'variants'), block('h-32', 'movements')] : [])]}</div>
      <div className="flex flex-col gap-4">{[block('h-24', 'pricing'), block('h-28', 'stock'), block('h-16', 'agents'), block('h-16', 'moderation')]}</div>
    </div>
  );
}

export function ProductPage({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as Locale;
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, workspace } = useSession();
  const refresh = useCatalogRefresh();
  const q = useProduct(id);
  const advanced = workspace?.stockMode === 'advanced';
  const canWrite = can('catalog.write');
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealSent, setAppealSent] = useState(false);
  const actions = useProductActions({
    hideOpen: true,
    onArchived: () => router.push('/products'),
    onDuplicated: (copy) => router.push(`/products/${copy.id}/edit`),
  });
  const resubmit = useMutation({ mutationFn: () => catalogApi.resubmit(id) });

  const product = q.data;
  const view = product ? moderationView(product, { appealSent }) : null;
  const wantsAppeal = params.get('appeal') === '1';
  const mayAppeal = !!view?.canAppeal && canWrite && !product?.archived;
  // `?appeal=1` (link of the product form and of the rejected banner of the list) opens the dialog directly
  useEffect(() => {
    if (wantsAppeal && mayAppeal) setAppealOpen(true);
  }, [wantsAppeal, mayAppeal]);
  const closeAppeal = () => {
    setAppealOpen(false);
    if (wantsAppeal) {
      const next = new URLSearchParams(params.toString());
      next.delete('appeal');
      nextRouter.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }
  };

  if (q.isPending) {
    return (
      <AppPage permission="catalog.read" breadcrumb={<Crumbs product={null} />} title={t('common.loading')}>
        <PageSkeleton advanced={advanced} />
      </AppPage>
    );
  }
  if (q.isError || !product || !view) {
    return (
      <AppPage permission="catalog.read" breadcrumb={<Crumbs product={null} />} title={t('nav.products')}>
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}/products`} />
      </AppPage>
    );
  }

  const live = !product.archived;
  const adjust = actionState(product.actions, 'adjust_stock', t);
  const canAdjust = live && product.trackStock && can('stock.adjust');
  const restore = actionState(product.actions, 'restore', t);
  const variantCount = product.hasVariants ? (product.variants ?? []).length : 0;
  const archivedAt = (product as Product & { archivedAt?: string | null }).archivedAt ?? product.updatedAt;

  const onResubmit = async () => {
    try {
      await resubmit.mutateAsync();
      await refresh({ productId: id });
      toast(t('products.moderation.resubmitted'));
    } catch (e) {
      // MODERATION_NOT_REJECTED: the status changed meanwhile
      toast({ tone: 'danger', message: errorMessage(e, t) });
      void refresh({ productId: id });
    }
  };

  return (
    <AppPage
      permission="catalog.read"
      breadcrumb={<Crumbs product={product} />}
      title={product.name}
      badges={
        <span className="flex flex-wrap items-center gap-1.5" data-testid="product-pills">
          <ProductStatePill product={product} />
          <ModerationPill status={view.kind === 'none' ? null : view.kind} long />
          {live ? <AiPill state={product.aiState} long reason={aiExclusion(product)} /> : null}
        </span>
      }
      description={
        <span data-testid="product-sub">
          {t('products.page.variants.sku')} <Ltr>{product.sku}</Ltr>
          {product.category ? ` · ${product.category.name}` : ''}
          {variantCount ? ` · ${t('products.page.variantsCount', { count: variantCount })}` : ''}
          {!product.trackStock ? ` · ${t('enum.Product.state.service')}` : ''}
          {` · ${t('products.page.sub.created', { date: formatDate(product.createdAt, locale) })}`}
          {` · ${t('products.page.sub.updated', { date: formatDate(product.updatedAt, locale) })}`}
        </span>
      }
      actions={
        <>
          {live ? (
            <Button variant="ghost" onClick={() => actions.preview(product)}>
              {t('products.cardPreview.title')}
            </Button>
          ) : null}
          {canAdjust ? (
            <Button onClick={() => actions.adjust(product)} disabledReason={adjust.present && !adjust.enabled ? adjust.reason : undefined} data-testid="adjust-stock">
              {t('action.adjustStock')}
            </Button>
          ) : null}
          {live && canWrite ? (
            <Link href={`/products/${product.id}/edit`} className={buttonClass({ variant: 'primary' })} data-testid="edit-product">
              {t('action.edit')}
            </Link>
          ) : null}
          <ActionsMenu label={t('action.actions')} size="md" actions={actions.menu(product)} heading={`${product.name} · ${product.sku}`} />
        </>
      }
    >
      {product.archived ? (
        <Banner
          tone="neutral"
          action={canWrite && restore.present ? { label: t('action.restore'), onClick: () => actions.restore(product), disabled: !restore.enabled } : undefined}
        >
          <span data-testid="archived-banner">{t('products.page.archived', { date: formatDate(archivedAt, locale) })}</span>
        </Banner>
      ) : null}
      {view.kind === 'rejected' && live ? <RejectedBanner product={product} view={view} canWrite={canWrite} onAppeal={() => setAppealOpen(true)} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" data-mode={advanced ? 'advanced' : 'simple'} data-testid="product-blocks">
        <div className="flex min-w-0 flex-col gap-4">
          <GalleryBlock product={product} canEdit={live && canWrite} />
          {advanced && product.hasVariants ? (
            <VariantsBlock product={product} advanced={advanced} canWrite={live && canWrite} onAdjust={canAdjust ? (variantId) => actions.adjust(product, variantId) : undefined} />
          ) : null}
          {advanced && product.trackStock && can('stock.read') ? <MovementsBlock productId={product.id} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DetailsBlock product={product} />
          <PricingBlock product={product} advanced={advanced} canEdit={live && canWrite} />
          <StockBlock product={product} advanced={advanced} />
          <AgentsBlock product={product} onAdd={live && canWrite && can('agents.read') ? () => actions.addToAgent(product) : undefined} />
          <ValidationBlock product={product} view={view} canWrite={canWrite} onAppeal={() => setAppealOpen(true)} onResubmit={() => void onResubmit()} resubmitting={resubmit.isPending} />
        </div>
      </div>

      {actions.dialogs}
      <AppealDialog product={product} open={appealOpen} onClose={closeAppeal} onSent={() => setAppealSent(true)} />
    </AppPage>
  );
}
