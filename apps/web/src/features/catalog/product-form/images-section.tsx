'use client';
// IMAGES · n / 10 of the product form — Figma "CAT-01 — Product form" + DLG GDS II "Images — erreurs inline".
// New product: the pictures stay in the browser until `POST /products` answered, then they are uploaded (see
// `uploadLocalImages`). Edit (tester log 26/10 UX-039): a new picture stays in the browser too (« À ENVOYER ») and is
// uploaded — and sent to moderation — by « Enregistrer »; « Annuler » drops it. Delete, primary and reorder of the saved
// pictures stay immediate (`products.form.images.savedNow`). A saved picture an approved product does not show yet is
// flagged « EN ATTENTE DE VALIDATION ». Errors sit under the tile concerned and never block the form.
import { PRODUCT_IMAGES_MAX } from '@djaber/shared';
import { cn, ImageTileGrid, SectionLabel, toast, type ImageGridLabels, type ImageTile } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT, type TFunction } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { catalogApi, catalogKeys, useCatalogRefresh } from '../api';
import type { Product, ProductImage } from '../contracts';
import { checkImageBatch, IMAGE_ACCEPT, imageHandover, readImageSize, smallSide, type ImageRejection, type LocalImage } from './images';

const FINAL_CODES: readonly string[] = ['IMAGE_TYPE_INVALID', 'IMAGE_TOO_LARGE', 'IMAGES_LIMIT'];
let seq = 0;
const localKey = () => `local-${Date.now().toString(36)}-${++seq}`;
const withCode = (t: TFunction, code: string) => `${t(`error.${code}`)} (${code})`;
const smallWarning = (t: TFunction, px: number | null | undefined) => (px ? t('error.IMAGE_SMALL', { px }) : undefined);

export const useImageGridLabels = (): ImageGridLabels => {
  const t = useT();
  return useMemo(
    () => ({
      add: t('products.form.images.add'),
      primary: t('products.form.images.primary'),
      drag: t('products.form.images.drag'),
      sending: t('products.form.images.sending'),
      makePrimary: t('products.form.images.makePrimary'),
      remove: t('products.form.images.remove'),
      retry: t('action.retry'),
      moveBefore: t('products.form.images.moveBefore'),
      moveAfter: t('products.form.images.moveAfter'),
      tile: (n: number) => t('products.form.images.tile', { n }),
    }),
    [t],
  );
};

const toLocal = (file: File, error: ImageRejection | null): LocalImage => ({ key: localKey(), file, url: URL.createObjectURL(file), error, rejected: !!error, smallPx: null, status: error ? 'error' : 'idle', progress: 0 });

const localTile = (t: TFunction, img: LocalImage, primary: boolean): ImageTile => ({
  id: img.key,
  url: img.url,
  alt: img.file.name,
  primary,
  status: img.status === 'uploading' ? 'uploading' : img.status === 'error' ? 'error' : 'ready',
  progress: img.progress,
  error: img.error ? (img.rejected || FINAL_CODES.includes(img.error) ? withCode(t, img.error) : img.error) : undefined,
  warning: smallWarning(t, img.smallPx),
  retryable: !img.rejected && !(img.error && FINAL_CODES.includes(img.error)),
});

function Frame({ count, rejected, children, footer }: { count: number; rejected?: boolean; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  return (
    <section data-section="images" data-rejected={rejected || undefined} className={cn('rounded-card border bg-ink-surface p-5', rejected ? 'border-accent-alert' : 'border-line-edge')}>
      <SectionLabel className="mb-4 flex flex-wrap items-center gap-2">
        <span>
          {t('products.form.images.title')} · <bdi dir="ltr" data-testid="image-count">{`${count} / ${PRODUCT_IMAGES_MAX}`}</bdi>
        </span>
        {rejected ? <span className="ts-label-micro text-accent-alert">{t('products.form.moderation.rejectedMark')}</span> : null}
      </SectionLabel>
      {children}
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-3">{footer}</div> : null}
    </section>
  );
}

/* ---------- /products/new: local pictures ---------- */
export function useLocalImages() {
  const [images, setImages] = useState<LocalImage[]>([]);
  const ref = useRef(images);
  ref.current = images;
  // previews are released when the page goes away
  useEffect(() => () => ref.current.forEach((i) => URL.revokeObjectURL(i.url)), []);
  const patch = useCallback((key: string, p: Partial<LocalImage>) => setImages((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i))), []);
  /** `already`: the pictures the product has on the server (edit), counted in the 10-picture limit */
  const add = useCallback(
    (files: File[], already = 0) => {
      const valid = already + ref.current.filter((i) => !i.rejected).length;
      const next = checkImageBatch(files, valid).map((c) => toLocal(c.file, c.error));
      setImages((list) => [...list, ...next]);
      for (const img of next) if (!img.rejected) void readImageSize(img.file).then((s) => s && patch(img.key, { smallPx: smallSide(s.width, s.height) }));
    },
    [patch],
  );
  const remove = useCallback((key: string) => {
    setImages((list) => {
      const hit = list.find((i) => i.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return list.filter((i) => i.key !== key);
    });
  }, []);
  const reorder = useCallback((keys: string[]) => setImages((list) => [...list].sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))), []);
  const makePrimary = useCallback((key: string) => setImages((list) => [...list.filter((i) => i.key === key), ...list.filter((i) => i.key !== key)]), []);
  return { images, add, remove, reorder, makePrimary, patch };
}
export type LocalImages = ReturnType<typeof useLocalImages>;

/**
 * Sends the pictures chosen before the first save, in their order (the first one becomes the primary image).
 * Returns the ones that failed, with their error, for the edit page.
 */
export async function uploadLocalImages(productId: string, images: readonly LocalImage[], patch: LocalImages['patch'], t: TFunction): Promise<LocalImage[]> {
  const failed: LocalImage[] = [];
  for (const img of images) {
    if (img.rejected) continue;
    patch(img.key, { status: 'uploading', progress: 0, error: null });
    try {
      await catalogApi.uploadImage(productId, img.file, { onProgress: (progress) => patch(img.key, { progress }) });
      patch(img.key, { status: 'idle', progress: 100 });
    } catch (e) {
      const error = e instanceof ApiError && FINAL_CODES.includes(e.code) ? e.code : errorMessage(e, t);
      patch(img.key, { status: 'error', error });
      failed.push({ ...img, status: 'error', error });
    }
  }
  return failed;
}

export function LocalImagesSection({ state, disabled, footer }: { state: LocalImages; disabled?: boolean; footer?: ReactNode }) {
  const t = useT();
  const labels = useImageGridLabels();
  const firstValid = state.images.find((i) => !i.rejected)?.key;
  const tiles = state.images.map((i) => localTile(t, i, i.key === firstValid));
  return (
    <Frame count={state.images.filter((i) => !i.rejected).length} footer={footer}>
      <ImageTileGrid
        tiles={tiles}
        max={PRODUCT_IMAGES_MAX}
        accept={IMAGE_ACCEPT}
        labels={labels}
        disabled={disabled}
        onAdd={state.add}
        onRemove={state.remove}
        onMakePrimary={state.makePrimary}
        onReorder={state.reorder}
        hint={t('products.form.images.hint')}
      />
    </Frame>
  );
}

/* ---------- /products/:id/edit and the quick-edit sheet: immediate operations ---------- */
type Note = { error?: string; warning?: string };

/**
 * Upload / retry / delete / primary / reorder of the pictures of a saved product, each one immediate (CAT-02). Shared
 * by the product form ("IMAGES · n / 10") and the "+" tile of the quick-edit sheet, so both pick, check (type, weight,
 * 10-image limit), upload with progress and show the errors under the tile the same way.
 */
export function useProductImageEditor(product: Pick<Product, 'id' | 'name' | 'images'>) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useCatalogRefresh();
  const productId = product.id;
  const key = catalogKeys.product(ws, productId);
  const images = useMemo(() => product.images ?? [], [product.images]);
  const [pending, setPending] = useState<LocalImage[]>(() => imageHandover.take(productId));
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  // "ENVOI…" lasts until the re-encode job is done: WS `product.updated` refetches, this poll is the safety net
  const processing = images.some((i) => i.processed === false);
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(() => void qc.invalidateQueries({ queryKey: key }), 3000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is stable for a product
  }, [processing, qc, ws, productId]);

  const patch = (k: string, p: Partial<LocalImage>) => setPending((list) => list.map((i) => (i.key === k ? { ...i, ...p } : i)));
  const note = (id: string, n: Note) => setNotes((all) => ({ ...all, [id]: { ...all[id], ...n } }));
  const setImages = (fn: (list: ProductImage[]) => ProductImage[]) => qc.setQueryData<Product>(key, (old) => (old ? { ...old, images: fn(old.images ?? []) } : old));

  const upload = async (img: LocalImage) => {
    patch(img.key, { status: 'uploading', progress: 0, error: null });
    const size = await readImageSize(img.file);
    const clientSmall = size ? smallSide(size.width, size.height) : null;
    try {
      const r = await catalogApi.uploadImage(productId, img.file, { onProgress: (progress) => patch(img.key, { progress }) });
      const small = r.warnings.find((w) => w.code === 'IMAGE_SMALL');
      const px = Number(small?.params?.px) || clientSmall;
      if (px) note(r.data.id, { warning: smallWarning(t, px) });
      setImages((list) => (list.some((i) => i.id === r.data.id) ? list : [...list, r.data]));
      setPending((list) => list.filter((i) => i.key !== img.key));
      URL.revokeObjectURL(img.url);
      void refresh({ productId });
    } catch (e) {
      patch(img.key, { status: 'error', error: e instanceof ApiError && FINAL_CODES.includes(e.code) ? e.code : errorMessage(e, t) });
    }
  };

  const add = (files: File[]) => {
    const taken = images.length + pendingRef.current.filter((i) => !i.rejected && !(i.error && FINAL_CODES.includes(i.error))).length;
    const next = checkImageBatch(files, taken).map((c) => toLocal(c.file, c.error));
    setPending((list) => [...list, ...next]);
    for (const img of next) if (!img.rejected) void upload(img);
  };

  const isLocal = (id: string) => pendingRef.current.some((i) => i.key === id);
  const run = async (id: string, job: () => Promise<unknown>) => {
    note(id, { error: undefined });
    try {
      await job();
      await refresh({ productId });
    } catch (e) {
      note(id, { error: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
    }
  };
  const remove = (id: string) => {
    if (isLocal(id)) {
      const hit = pendingRef.current.find((i) => i.key === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return setPending((list) => list.filter((i) => i.key !== id));
    }
    // deleting the primary image: the server promotes the next one, the refetch shows it
    void run(id, async () => {
      await catalogApi.deleteImage(productId, id);
      setImages((list) => list.filter((i) => i.id !== id));
    });
  };
  const makePrimary = (id: string) => {
    if (isLocal(id)) return;
    void run(id, async () => {
      await catalogApi.updateImage(productId, id, { isPrimary: true });
      setImages((list) => list.map((i) => ({ ...i, isPrimary: i.id === id })));
    });
  };
  const reorder = async (ids: string[]) => {
    const order = ids.filter((id) => images.some((i) => i.id === id));
    if (order.length !== images.length || order.every((id, i) => images[i]!.id === id)) return;
    const before = images;
    setImages((list) => [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)));
    try {
      await catalogApi.reorderImages(productId, order);
      void refresh({ productId });
    } catch (e) {
      setImages(() => before);
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const retry = (id: string) => {
    const hit = pendingRef.current.find((i) => i.key === id);
    if (hit) void upload(hit);
  };

  const tiles: ImageTile[] = [
    ...images.map((i) => ({
      id: i.id,
      url: i.thumbUrl || i.url,
      alt: i.altText ?? i.aiCaption ?? product.name,
      primary: i.isPrimary,
      status: i.processed === false ? ('processing' as const) : ('ready' as const),
      error: notes[i.id]?.error,
      warning: notes[i.id]?.warning ?? smallWarning(t, i.width && i.height ? smallSide(i.width, i.height) : null),
      flag: i.moderationFlag ? t('products.form.moderation.imageFlag', { flag: i.moderationFlag.toUpperCase() }) : i.awaitingReview ? t('products.form.images.awaitingReview') : undefined,
      flagTone: !i.moderationFlag && i.awaitingReview ? ('pending' as const) : undefined,
    })),
    ...pending.map((i) => localTile(t, i, false)),
  ];
  return { tiles, count: images.length, add, remove, makePrimary, reorder: (ids: string[]) => void reorder(ids), retry, isLocal };
}

/** `staged`: the new pictures of this edit, kept in the browser until « Enregistrer » (UX-039). */
export function ProductImagesSection({ product, staged, disabled, rejected, footer }: { product: Product; staged: LocalImages; disabled?: boolean; rejected?: boolean; footer?: ReactNode }) {
  const t = useT();
  const labels = useImageGridLabels();
  const editor = useProductImageEditor(product);
  const stagedKeys = new Set(staged.images.map((i) => i.key));
  const tiles = [...editor.tiles, ...staged.images.map((i) => ({ ...localTile(t, i, false), ...(i.status === 'idle' && !i.error ? { flag: t('products.form.images.staged'), flagTone: 'pending' as const } : {}) }))];
  const count = editor.count + staged.images.filter((i) => !i.rejected).length;
  return (
    <Frame count={count} rejected={rejected} footer={footer}>
      <ImageTileGrid
        tiles={tiles}
        max={PRODUCT_IMAGES_MAX}
        accept={IMAGE_ACCEPT}
        labels={labels}
        disabled={disabled}
        onAdd={disabled ? undefined : (files) => staged.add(files, editor.tiles.filter((tile) => !tile.error || tile.retryable !== false).length)}
        onRemove={(id) => (stagedKeys.has(id) ? staged.remove(id) : editor.remove(id))}
        onMakePrimary={(id) => (stagedKeys.has(id) ? undefined : editor.makePrimary(id))}
        onReorder={(ids) => editor.reorder(ids.filter((id) => !stagedKeys.has(id)))}
        onRetry={editor.retry}
        hint={`${t('products.form.images.hint')} · ${t('products.form.images.savedNow')}`}
      />
    </Frame>
  );
}

/**
 * "IMAGES · n / 10" of the quick-edit sheet (Figma "CAT-01 — Product — quick edit sheet"): the "+" tile opens the file
 * picker right there and uploads through `useProductImageEditor` (same checks, progress and inline errors as the
 * product form). Saved pictures are only shown here (primary, reorder and delete stay on the product form); a failed
 * upload can be retried or dismissed.
 */
export function QuickImagesStrip({ product, disabled }: { product: Product; disabled?: boolean }) {
  const labels = useImageGridLabels();
  const editor = useProductImageEditor(product);
  const tiles = editor.tiles.map((tile) => (editor.isLocal(tile.id) ? tile : { ...tile, removable: false }));
  return <ImageTileGrid tiles={tiles} max={PRODUCT_IMAGES_MAX} accept={IMAGE_ACCEPT} labels={labels} disabled={disabled} onAdd={disabled ? undefined : editor.add} onRemove={editor.remove} onRetry={editor.retry} size={56} />;
}
