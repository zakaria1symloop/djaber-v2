'use client';
// `Actions ⌄` of one product with its dialogs, shared by the product page (CAT-09) and the services list (CAT-11).
// The menu itself is the lead's `productMenuActions` (server descriptors + navigation items); this hook supplies the
// handlers: duplicate, archive / delete, restore, adjust stock, Messenger card, hide / show, export of this product.
import { ConfirmDialog, FormAlert, toast, type MenuAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { useSession } from '@/lib/session';
import { AdjustStockDialog } from '../adjust-stock-dialog';
import { catalogApi, useCatalogRefresh } from '../api';
import type { Product, ProductListItem } from '../contracts';
import { ProductLabelsDialog } from '../product-labels-dialog';
import { productMenuActions } from '../product-actions';
import { AddToAgentDialog } from '../products-list/bulk';
import { ArchiveProductDialog, CardPreviewDialog, DuplicateProductDialog, RestoreProductDialog } from '../product-dialogs';

type Target = ProductListItem | Product;
type Open =
  | { kind: 'archive' | 'duplicate' | 'restore' | 'preview' | 'hardDelete' | 'agent' | 'labels'; product: Target }
  | { kind: 'adjust'; product: Target; variantId?: string | null };

export function useProductActions(o: {
  /** the page already shows the product: no "Ouvrir" item */
  hideOpen?: boolean;
  onArchived?: (product: Target, mode: 'archive' | 'hard') => void;
  onDuplicated?: (copy: Product) => void;
} = {}) {
  const t = useT();
  const router = useRouter();
  const refresh = useCatalogRefresh();
  const { can, workspace } = useSession();
  const [open, setOpen] = useState<Open | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const close = () => setOpen(null);
  const of = (kind: Open['kind']) => (open?.kind === kind ? open.product : null);

  const toggleActive = async (p: Target) => {
    try {
      // list rows carry no `version` (api-contract §1.8): read it first
      const version = 'version' in p ? p.version : (await catalogApi.product(p.id)).version;
      await catalogApi.updateProduct(p.id, { isActive: !p.isActive, version });
      await refresh({ productId: p.id });
      toast(t(p.isActive ? 'products.page.toast.hidden' : 'products.page.toast.shown', { name: p.name }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
      void refresh({ productId: p.id });
    }
  };

  const exportOne = async (p: Target) => {
    try {
      const { jobId } = await catalogApi.bulkExport([p.id]);
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (job) => t('toast.export.progress', { entity: t('products.page.export.entity'), pct: job.progress, rows: job.total ?? 1 }),
        done: (job) => ({
          message: t('toast.export.done', { file: p.sku }),
          action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined,
        }),
        failed: (job, error) => job?.error?.message || errorMessage(error, t),
      });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const hardDelete = useMutation({ mutationFn: (id: string) => catalogApi.deleteProduct(id, { mode: 'hard' }) });
  const confirmHardDelete = async () => {
    const p = of('hardDelete');
    if (!p) return;
    setDeleteError(null);
    try {
      await hardDelete.mutateAsync(p.id);
      await refresh();
      toast(t('products.delete.deleted', { name: p.name }));
      close();
      o.onArchived?.(p, 'hard');
    } catch (e) {
      setDeleteError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };

  const adjust = (product: Target, variantId?: string | null) => setOpen({ kind: 'adjust', product, variantId });
  const preview = (product: Target) => setOpen({ kind: 'preview', product });
  const restore = (product: Target) => setOpen({ kind: 'restore', product });

  const menu = (p: Target): MenuAction[] =>
    productMenuActions(
      p,
      {
        open: o.hideOpen ? undefined : () => router.push(`/products/${p.id}`),
        edit: () => router.push(`/products/${p.id}/edit`),
        // a service has no stock: no stock item at all (CAT-11)
        adjustStock: p.trackStock ? () => adjust(p) : undefined,
        movements: can('stock.read') ? () => router.push(`/movements?productId=${p.id}`) : undefined,
        orders: can('orders.read') ? () => router.push(`/orders?productId=${p.id}`) : undefined,
        duplicate: () => setOpen({ kind: 'duplicate', product: p }),
        cardPreview: () => preview(p),
        // a service is sold by agents like any product; an archived one is not offered (hidden by the menu)
        addToAgent: can('agents.read') ? () => setOpen({ kind: 'agent', product: p }) : undefined,
        toggleActive: () => void toggleActive(p),
        exportOne: () => void exportOne(p),
        labels: can('catalog.write') ? () => setOpen({ kind: 'labels', product: p }) : undefined,
        archive: () => setOpen({ kind: 'archive', product: p }),
        restore: () => restore(p),
        // an archived product can only be deleted for good; a live one chooses in the archive / delete dialog
        remove: () => (setDeleteError(null), setOpen({ kind: p.archived ? 'hardDelete' : 'archive', product: p })),
      },
      { t, advanced: workspace?.stockMode === 'advanced', canWrite: can('catalog.write') },
    );

  const hard = of('hardDelete');
  const dialogs: ReactNode = (
    <>
      <ArchiveProductDialog product={of('archive')} onClose={close} onDone={(mode) => open && o.onArchived?.(open.product, mode)} />
      <DuplicateProductDialog product={of('duplicate')} onClose={close} onDone={o.onDuplicated} />
      <RestoreProductDialog product={of('restore')} onClose={close} />
      <CardPreviewDialog product={of('preview')} onClose={close} />
      <AddToAgentDialog product={of('agent')} onClose={close} />
      <ProductLabelsDialog open={!!of('labels')} ids={of('labels') ? [of('labels')!.id] : []} onClose={close} />
      <AdjustStockDialog open={open?.kind === 'adjust'} onClose={close} product={of('adjust')} variantId={open?.kind === 'adjust' ? open.variantId : null} />
      <ConfirmDialog
        open={!!hard}
        onOpenChange={(v) => !v && !hardDelete.isPending && close()}
        title={t('dialog.deleteProduct.title', { name: hard?.name ?? '' })}
        description={t('products.page.delete.archived')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void confirmHardDelete()}
        destructive
        loading={hardDelete.isPending}
        closeLabel={t('action.close')}
      >
        {deleteError ? <FormAlert>{deleteError}</FormAlert> : null}
      </ConfirmDialog>
    </>
  );

  return { menu, dialogs, adjust, preview, restore, addToAgent: (product: Target) => setOpen({ kind: 'agent', product }) };
}
