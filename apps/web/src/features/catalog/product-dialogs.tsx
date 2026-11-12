'use client';
// Product dialogs shared by the list, the quick-edit sheet and the product page — Figma "DLG — GDS (stock) — dialogs
// catalogue" (Supprimer / archiver, Dupliquer le produit) and "DLG — GDS (stock) II" (Limite du plan atteinte,
// Restaurer). Server errors are shown inside the open dialog; its content is preserved.
import { DuplicateProductSchema, formatNumber, type ActionDescriptor } from '@djaber/shared';
import { Button, buttonClass, Checkbox, CodeInput, Dialog, Field, FormAlert, Input, Pill, RadioCards, Skeleton, toast } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { catalogApi, useCatalogRefresh } from './api';
import type { Product, ProductListItem } from './contracts';
import { ProductThumb } from './ui';


/* ---------- PLAN_LIMIT {resource, limit, current} ---------- */
export type PlanLimitInfo = { resource: string; current: number | null; limit: number | null };
/** Params of a `403 PLAN_LIMIT` answer, null for any other error. */
export const planLimitOf = (e: unknown): PlanLimitInfo | null => {
  if (!(e instanceof ApiError) || (e.code !== 'PLAN_LIMIT' && e.code !== 'PLAN_LIMIT_GRANDFATHERED')) return null;
  const p = e.body.params ?? {};
  const n = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return { resource: String(p.resource ?? 'products'), current: n(p.current), limit: n(p.limit) };
};

/** "Limite du plan atteinte" — Archiver des produits / Comparer les plans. */
export function PlanLimitDialog({ info, onClose }: { info: PlanLimitInfo | null; onClose: () => void }) {
  const t = useT();
  const { workspace } = useSession();
  const plan = workspace?.plan;
  const current = info?.current ?? plan?.usage.products ?? 0;
  const limit = info?.limit ?? plan?.limits.maxProducts ?? 0;
  return (
    <Dialog
      open={!!info}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.planLimit.title')}
      description={t('products.planLimit.context', { plan: plan?.name ?? '—', current: formatNumber(current), limit: formatNumber(limit) })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Link href="/products?status=active" onClick={onClose} className={buttonClass({ variant: 'ghost' })}>
            {t('products.planLimit.archive')}
          </Link>
          <Link href="/settings/billing" onClick={onClose} className={buttonClass({ variant: 'primary' })}>
            {t('action.comparePlans')}
          </Link>
        </>
      }
    >
      <p className="text-[13px] text-text-secondary">{t('products.planLimit.body')}</p>
    </Dialog>
  );
}

/* ---------- Supprimer / archiver ---------- */
type ArchiveTarget = Pick<ProductListItem, 'id' | 'name' | 'stock' | 'trackStock'> & { actions?: ActionDescriptor[] };
export function ArchiveProductDialog({ product, onClose, onDone }: { product: ArchiveTarget | null; onClose: () => void; onDone?: (mode: 'archive' | 'hard') => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [mode, setMode] = useState<'archive' | 'hard'>('archive');
  const [release, setRelease] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    setMode('archive');
    setRelease(false);
    setError(null);
    setBlocked(null);
  }, [product?.id]);
  const remove = useMutation({ mutationFn: () => catalogApi.deleteProduct(product!.id, { mode, releaseStock: mode === 'archive' && release }) });
  const hard = actionState(product?.actions, 'delete', t);
  const hardReason = blocked ?? (hard.present && !hard.enabled ? hard.reason : undefined);
  const stock = product?.trackStock ? (product.stock ?? 0) : 0;

  const submit = async () => {
    if (!product) return;
    setError(null);
    try {
      await remove.mutateAsync();
      await refresh({ productId: product.id });
      toast(t(mode === 'hard' ? 'products.delete.deleted' : 'products.delete.archived', { name: product.name }));
      onDone?.(mode);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PRODUCT_HAS_ORDERS') {
        // hard delete refused: the archive option stays available
        setBlocked(errorMessage(e, t));
        setMode('archive');
      } else setError(errorMessage(e, t));
    }
  };
  const busy = remove.isPending;
  return (
    <Dialog
      open={!!product}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.deleteProduct.title', { name: product?.name ?? '' })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant={mode === 'hard' ? 'danger' : 'primary'} onClick={submit} loading={busy} data-testid="archive-submit">
            {mode === 'hard' ? t('action.delete') : t('action.archive')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Pill tone="danger" className="w-fit rounded-[4px]">
          {t('common.destructive')}
        </Pill>
        <RadioCards<'archive' | 'hard'>
          label={t('products.delete.mode')}
          columns={1}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'archive', label: t('action.archive'), description: t('products.delete.archiveHint') },
            { value: 'hard', label: t('products.delete.hard'), description: t('products.delete.hardHint'), disabledReason: hardReason },
          ]}
        />
        {mode === 'archive' && stock > 0 ? (
          <>
            <p className="ts-label-meta text-text-muted">{t('products.delete.stockNote', { count: stock })}</p>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox checked={release} disabled={busy} onChange={(e) => setRelease(e.target.checked)} />
              {t('products.delete.releaseStock', { count: stock })}
            </label>
          </>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Dupliquer le produit ---------- */
export function DuplicateProductDialog({ product, onClose, onDone }: { product: Pick<ProductListItem, 'id' | 'name' | 'hasVariants'> | null; onClose: () => void; onDone?: (copy: Product) => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const { workspace } = useSession();
  const advanced = workspace?.stockMode === 'advanced';
  const [name, setName] = useState('');
  const [copyImages, setCopyImages] = useState(true);
  const [copyVariants, setCopyVariants] = useState(true);
  const [copyCost, setCopyCost] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [limit, setLimit] = useState<PlanLimitInfo | null>(null);
  useEffect(() => {
    if (!product) return;
    setName(t('products.duplicate.copyName', { name: product.name }).slice(0, 255));
    setCopyImages(true);
    setCopyVariants(true);
    setCopyCost(true);
    setError(null);
    setNameError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded when another product is opened
  }, [product?.id]);
  const duplicate = useMutation({ mutationFn: (b: Parameters<typeof catalogApi.duplicateProduct>[1]) => catalogApi.duplicateProduct(product!.id, b) });
  const submit = async () => {
    if (!product) return;
    setError(null);
    setNameError(null);
    const parsed = DuplicateProductSchema.safeParse({ name, copyImages, copyVariants: product.hasVariants ? copyVariants : false, copyCost: advanced ? copyCost : false });
    if (!parsed.success) return setNameError(t(parsed.error.issues[0]?.message ?? 'validation.required', { max: 255, min: 1 }));
    try {
      const copy = await duplicate.mutateAsync(parsed.data);
      await refresh();
      toast(t('products.duplicate.done', { name: copy.name }));
      onDone?.(copy);
      onClose();
    } catch (e) {
      const plan = planLimitOf(e);
      if (plan) return setLimit(plan);
      if (e instanceof ApiError && e.body.fields?.name) return setNameError(t.has(e.body.fields.name) ? t(e.body.fields.name, { max: 255, min: 1 }) : e.body.fields.name);
      setError(errorMessage(e, t));
    }
  };
  const busy = duplicate.isPending;
  const check = (checked: boolean, set: (v: boolean) => void, label: string) => (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
      <Checkbox checked={checked} disabled={busy} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
  return (
    <>
      <Dialog
        open={!!product && !limit}
        onOpenChange={(o) => !o && !busy && onClose()}
        title={t('dialog.duplicateProduct.title')}
        description={product?.name}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <span className="me-auto max-w-40 ts-label-meta text-text-muted">{t('products.duplicate.moderationNote')}</span>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} loading={busy}>
              {t('action.duplicate')}
            </Button>
          </>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t('common.name')} htmlFor="dup-name" required error={nameError ?? undefined}>
            <Input id="dup-name" value={name} maxLength={255} disabled={busy} aria-invalid={!!nameError} onChange={(e) => setName(e.target.value)} />
          </Field>
          {check(copyImages, setCopyImages, t('products.duplicate.copyImages'))}
          {product?.hasVariants ? check(copyVariants, setCopyVariants, t('products.duplicate.copyVariants')) : null}
          {advanced ? check(copyCost, setCopyCost, t('products.duplicate.copyCost')) : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
        </form>
      </Dialog>
      <PlanLimitDialog
        info={limit}
        onClose={() => {
          setLimit(null);
          onClose();
        }}
      />
    </>
  );
}

/* ---------- Restaurer (SKU reused ⇒ new SKU) ---------- */
export function RestoreProductDialog({ product, onClose, onDone }: { product: Pick<ProductListItem, 'id' | 'name' | 'sku'> | null; onClose: () => void; onDone?: (restored: Product) => void }) {
  const t = useT();
  const refresh = useCatalogRefresh();
  const [conflict, setConflict] = useState(false);
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<PlanLimitInfo | null>(null);
  useEffect(() => {
    setConflict(false);
    setSku(product ? `${product.sku}-R` : '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded when another product is opened
  }, [product?.id]);
  const restore = useMutation({ mutationFn: () => catalogApi.restoreProduct(product!.id, conflict ? { sku: sku.trim() } : {}) });
  const submit = async () => {
    if (!product) return;
    setError(null);
    if (conflict && !sku.trim()) return setError(t('validation.required'));
    try {
      const restored = await restore.mutateAsync();
      await refresh({ productId: product.id });
      toast(t('products.restore.done', { name: product.name }));
      onDone?.(restored);
      onClose();
    } catch (e) {
      const plan = planLimitOf(e);
      if (plan) return setLimit(plan);
      if (e instanceof ApiError && e.code === 'PRODUCT_SKU_ALREADY_EXISTS') {
        // first refusal: ask for a new SKU; a refusal of the new SKU is shown under the field
        if (conflict) setError(errorMessage(e, t));
        setConflict(true);
        return;
      }
      setError(errorMessage(e, t));
    }
  };
  const busy = restore.isPending;
  return (
    <>
      <Dialog
        open={!!product && !limit}
        onOpenChange={(o) => !o && !busy && onClose()}
        title={t('dialog.restoreProduct.title', { name: product?.name ?? '' })}
        description={product ? t('products.restore.context', { sku: product.sku }) : undefined}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} loading={busy} data-testid="restore-submit">
              {t('action.restore')}
            </Button>
          </>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {conflict ? (
            <>
              <FormAlert tone="warning">{t('products.restore.skuTaken', { sku: product?.sku ?? '' })}</FormAlert>
              <Field label={t('products.restore.newSku')} htmlFor="restore-sku" required error={error ?? undefined}>
                <CodeInput id="restore-sku" value={sku} maxLength={255} disabled={busy} aria-invalid={!!error} onChange={(e) => setSku(e.target.value)} />
              </Field>
            </>
          ) : error ? (
            <FormAlert>{error}</FormAlert>
          ) : null}
          <p className="ts-label-meta text-text-muted">{t('products.restore.note')}</p>
        </form>
      </Dialog>
      <PlanLimitDialog
        info={limit}
        onClose={() => {
          setLimit(null);
          onClose();
        }}
      />
    </>
  );
}

/* ---------- Voir sur Messenger (carte) ---------- */
export function CardPreviewDialog({ product, onClose }: { product: Pick<ProductListItem, 'id' | 'name'> | null; onClose: () => void }) {
  const t = useT();
  const ws = useWorkspaceId();
  const q = useQuery({ queryKey: [ws, 'product', product?.id ?? '', 'card-preview'], queryFn: () => catalogApi.cardPreview(product!.id), enabled: !!ws && !!product });
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()} title={t('products.cardPreview.title')} description={product?.name} closeLabel={t('action.close')} size="sm">
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="mx-auto w-64 overflow-hidden rounded-[14px] border border-line-edge bg-ink-raised" data-testid="card-preview">
          {q.data.imageUrl ? <img src={q.data.imageUrl} alt={q.data.title} className="aspect-[1.91/1] w-full object-cover" /> : <div className="flex aspect-[1.91/1] items-center justify-center"><ProductThumb src={null} name={q.data.title} size={48} /></div>}
          <div className="px-3 py-2.5">
            <div className="truncate text-[14px] font-medium">{q.data.title}</div>
            {q.data.subtitle ? <div className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">{q.data.subtitle}</div> : null}
          </div>
          {(q.data.buttons ?? []).map((b, i) => (
            <div key={i} className="border-t border-line-hairline px-3 py-2 text-center text-[13px] text-accent-inbound">
              {b.title}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 ts-label-meta text-text-muted">{t('products.cardPreview.note')}</p>
    </Dialog>
  );
}
