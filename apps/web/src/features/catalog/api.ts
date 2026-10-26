// Catalogue & stock calls (06 §2 "Catalogue (GDS)", §8.2, §8.6) + TanStack Query hooks and cache keys.
// Inputs are the shared zod types; reads are the shared read models (see ./contracts).
import type {
  BulkPriceInput,
  CreateCategoryInput,
  CreateProductInput,
  CreateUnitInput,
  CreateVariantInput,
  DuplicateProductInput,
  GenerateVariantsInput,
  ImportMappingInput,
  StockAdjustmentInput,
  UpdateCategoryInput,
  UpdateProductImageInput,
  UpdateProductInput,
  UpdateUnitInput,
  UpdateVariantInput,
} from '@djaber/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiRaw, type Meta } from '@/lib/api';
import type { JobRef } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { recordOrigin } from '@/lib/origin';
import { useWorkspaceId } from '@/lib/session';
import { uploadWithProgress } from '@/lib/upload';
import { useWsEvent } from '@/lib/ws';
import type {
  AiFillCurrent,
  AiFillResult,
  BulkItemResult,
  BulkResponse,
  CardPreview,
  Category,
  LowStockItem,
  ModerationSummary,
  Product,
  ProductImage,
  ProductListItem,
  ProductModeration,
  ProductRelations,
  SnapshotRow,
  StockMovement,
  StockOverview,
  Unit,
  Variant,
} from './contracts';

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; meta: Meta };
const page = async <T>(path: string, query: ApiQuery): Promise<Page<T>> => {
  const r = await apiRaw<T[]>(path, { query });
  return { rows: r.data, total: r.meta?.total ?? r.data.length, page: r.meta?.page ?? 1, pageSize: r.meta?.pageSize ?? 25, meta: r.meta ?? {} };
};
const bulk = async (path: string, body: unknown): Promise<BulkResponse> => {
  const r = await apiRaw<{ results: BulkItemResult[] }>(path, { method: 'POST', body });
  const results = r.data?.results ?? [];
  const m = r.meta as Meta & { ok?: number; failed?: number };
  return { results, ok: m?.ok ?? results.filter((x) => x.ok).length, failed: m?.failed ?? results.filter((x) => !x.ok).length, warnings: m?.warnings ?? [] };
};
/** A write whose `meta.warnings` matter (`SELLING_BELOW_COST`, `IMAGE_SMALL`). */
const withWarnings = async <T>(path: string, o: Parameters<typeof apiRaw>[1]) => {
  const r = await apiRaw<T>(path, o);
  return { data: r.data, warnings: r.meta?.warnings ?? [] };
};

export const catalogApi = {
  /* products */
  products: (q: ApiQuery) => page<ProductListItem>('/products', q),
  product: (id: string) => api<Product>(`/products/${id}`),
  createProduct: (b: CreateProductInput) => withWarnings<Product>('/products', { method: 'POST', body: b }),
  updateProduct: (id: string, b: UpdateProductInput) => withWarnings<Product>(`/products/${id}`, { method: 'PATCH', body: b }),
  /** `mode=archive` (default) keeps the history; `hard` only without order / sale line (`PRODUCT_HAS_ORDERS`). */
  deleteProduct: (id: string, o: { mode: 'archive' | 'hard'; releaseStock?: boolean }) => api<null>(`/products/${id}`, { method: 'DELETE', query: { mode: o.mode, releaseStock: o.releaseStock || undefined } }),
  /** `409 PRODUCT_SKU_ALREADY_EXISTS` when the SKU was reused meanwhile (CAT-10); `sku` = the replacement asked by the dialog. */
  restoreProduct: (id: string, b: { sku?: string } = {}) => api<Product>(`/products/${id}/restore`, { method: 'POST', body: b }),
  duplicateProduct: (id: string, b: DuplicateProductInput) => api<Product>(`/products/${id}/duplicate`, { method: 'POST', body: b }),
  relations: (id: string) => api<ProductRelations>(`/products/${id}/relations`),
  cardPreview: (id: string) => api<CardPreview>(`/products/${id}/card-preview`),
  lowStock: () => api<LowStockItem[]>('/products/low-stock'),

  /* bulk (per-item results, never all-or-nothing) */
  bulkPrice: (b: BulkPriceInput) => bulk('/products/bulk/price', b),
  bulkCategory: (b: { ids: string[]; categoryId: string | null }) => bulk('/products/bulk/category', b),
  bulkArchive: (b: { ids: string[]; releaseStock?: boolean }) => bulk('/products/bulk/archive', b),
  bulkAgent: (b: { ids: string[]; agentId: string }) => bulk('/products/bulk/agent', b),
  bulkMinStock: (b: { ids: string[]; minStock: number }) => bulk('/products/bulk/min-stock', b),
  // M6: POST /products/bulk/labels → 202 ("Étiquettes" of the bulk bar and of the product menu) is not served yet: the action is not offered
  bulkExport: (ids: string[]) => api<JobRef>('/products/bulk/export', { method: 'POST', body: { ids } }),
  /** export of the current filter → 202 job */
  exportProducts: (q: ApiQuery) => api<JobRef>('/products/export', { query: q }),

  /* images */
  uploadImage: (productId: string, file: File, o: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {}) => {
    const formData = new FormData();
    formData.set('file', file);
    return uploadWithProgress<ProductImage>(`/products/${productId}/images`, formData, o).then((r) => ({ data: r.data, warnings: r.meta?.warnings ?? [] }));
  },
  updateImage: (productId: string, imageId: string, b: UpdateProductImageInput) => api<ProductImage>(`/products/${productId}/images/${imageId}`, { method: 'PATCH', body: b }),
  deleteImage: (productId: string, imageId: string) => api<null>(`/products/${productId}/images/${imageId}`, { method: 'DELETE' }),
  reorderImages: (productId: string, ids: string[]) => api<ProductImage[]>(`/products/${productId}/images/order`, { method: 'PATCH', body: { ids } }),

  /* variants */
  variants: (productId: string) => api<Variant[]>(`/products/${productId}/variants`),
  createVariant: (productId: string, b: CreateVariantInput) => api<Variant>(`/products/${productId}/variants`, { method: 'POST', body: b }),
  updateVariant: (productId: string, variantId: string, b: UpdateVariantInput) => api<Variant>(`/products/${productId}/variants/${variantId}`, { method: 'PATCH', body: b }),
  deleteVariant: (productId: string, variantId: string) => api<null>(`/products/${productId}/variants/${variantId}`, { method: 'DELETE' }),
  generateVariants: (productId: string, b: GenerateVariantsInput) => api<Variant[]>(`/products/${productId}/variants/generate`, { method: 'POST', body: b }),

  /* create from photo (1–5 photos, 5 credits) */
  aiFill: (files: File[], current: AiFillCurrent, signal?: AbortSignal) => {
    const formData = new FormData();
    for (const f of files) formData.append('photos', f);
    // the current values: the server only proposes the fields that are still empty (AT-CAT-10)
    for (const [k, v] of Object.entries(current)) if (v) formData.set(k, v);
    return api<AiFillResult>('/products/ai-fill', { method: 'POST', formData, signal });
  },

  /* moderation, merchant side */
  moderationSummary: () => api<ModerationSummary>('/moderation/summary'),
  moderation: (id: string) => api<ProductModeration>(`/products/${id}/moderation`),
  resubmit: (id: string) => api<{ moderationItemId: string; status: string }>(`/products/${id}/resubmit`, { method: 'POST', body: {} }),
  /** tester report 25/10 UX-001: the save of the form sends what changed since the last review (pictures included) */
  submitChanges: (id: string) => api<{ submitted: boolean; moderationStatus: string }>(`/products/${id}/submit-changes`, { method: 'POST', body: {} }),
  appeal: (id: string, b: { message: string; attachmentUploadId?: string | null }) => api<unknown>(`/products/${id}/appeal`, { method: 'POST', body: b }),

  /* categories & units */
  categories: () => api<Category[]>('/categories'),
  createCategory: (b: CreateCategoryInput) => api<Category>('/categories', { method: 'POST', body: b }),
  updateCategory: (id: string, b: UpdateCategoryInput) => api<Category>(`/categories/${id}`, { method: 'PATCH', body: b }),
  deleteCategory: (id: string, o: { reassignTo?: string | null; moveChildrenToRoot?: boolean } = {}) =>
    api<null>(`/categories/${id}`, { method: 'DELETE', query: { reassignTo: o.reassignTo || undefined, moveChildrenToRoot: o.moveChildrenToRoot || undefined } }),
  units: () => api<Unit[]>('/units'),
  createUnit: (b: CreateUnitInput) => api<Unit>('/units', { method: 'POST', body: b }),
  updateUnit: (id: string, b: UpdateUnitInput) => api<Unit>(`/units/${id}`, { method: 'PATCH', body: b }),
  deleteUnit: (id: string, o: { reassignTo?: string | null } = {}) => api<null>(`/units/${id}`, { method: 'DELETE', query: { reassignTo: o.reassignTo || undefined } }),

  /* stock */
  overview: () => api<StockOverview>('/stock/overview'),
  /** Idempotency-Key required (api-contract §1.7): pass the key created when the dialog opened, reused on retry. */
  adjust: (b: StockAdjustmentInput, idempotencyKey: string) => withWarnings<StockMovement>('/stock/adjustments', { method: 'POST', body: b, idempotent: idempotencyKey }),
  movements: (q: ApiQuery) => page<StockMovement>('/stock/movements', q),
  movement: (id: string) => api<StockMovement>(`/stock/movements/${id}`),
  reverseMovement: (id: string, b: { note?: string | null }) => api<StockMovement>(`/stock/movements/${id}/reverse`, { method: 'POST', body: b }),
  exportMovements: (q: ApiQuery) => api<JobRef>('/stock/movements/export', { query: q }),
  /** `meta.totalValue` = value of the whole snapshot, `meta.date` = the day asked */
  snapshot: (q: ApiQuery) => apiRaw<SnapshotRow[]>('/stock/snapshot', { query: q }) as Promise<{ data: SnapshotRow[]; meta: Meta & { totalValue?: number; date?: string } }>,

  /* import (preview job → mapping → commit job) */
  importUpload: (file: File, o: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {}) => {
    const formData = new FormData();
    formData.set('file', file);
    return uploadWithProgress<JobRef>('/products/import', formData, o).then((r) => r.data);
  },
  importMapping: (b: ImportMappingInput) => api<JobRef | null>('/products/import/mapping', { method: 'POST', body: b }),
  importCommit: (jobId: string, idempotencyKey: string) => api<JobRef>(`/products/import/${jobId}/commit`, { method: 'POST', body: {}, idempotent: idempotencyKey }),
};

/* ---------- cache keys: every key starts with the workspace id ---------- */
export const catalogKeys = {
  products: (ws: string, q?: ApiQuery) => (q ? ([ws, 'products', 'list', q] as const) : ([ws, 'products'] as const)),
  lowStock: (ws: string) => [ws, 'products', 'low-stock'] as const,
  product: (ws: string, id: string) => [ws, 'product', id] as const,
  relations: (ws: string, id: string) => [ws, 'product', id, 'relations'] as const,
  moderation: (ws: string, id: string) => [ws, 'product', id, 'moderation'] as const,
  moderationSummary: (ws: string) => [ws, 'moderation-summary'] as const,
  categories: (ws: string) => [ws, 'categories'] as const,
  units: (ws: string) => [ws, 'units'] as const,
  overview: (ws: string) => [ws, 'stock', 'overview'] as const,
  movements: (ws: string, q?: ApiQuery) => (q ? ([ws, 'stock', 'movements', q] as const) : ([ws, 'stock', 'movements'] as const)),
};

/* ---------- hooks ---------- */
export const useProducts = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  // the previous page stays on screen while the next one loads (no skeleton flash on filter changes)
  return useQuery({ queryKey: catalogKeys.products(ws, q), queryFn: () => catalogApi.products(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useProduct = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.product(ws, id ?? ''), queryFn: () => catalogApi.product(id!), enabled: !!ws && !!id });
};
export const useProductRelations = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.relations(ws, id ?? ''), queryFn: () => catalogApi.relations(id!), enabled: !!ws && !!id });
};
export const useLowStock = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.lowStock(ws), queryFn: catalogApi.lowStock, enabled: !!ws && enabled });
};
export const useModerationSummary = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.moderationSummary(ws), queryFn: catalogApi.moderationSummary, enabled: !!ws && enabled, staleTime: 60_000 });
};
export const useCategories = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.categories(ws), queryFn: catalogApi.categories, enabled: !!ws && enabled, staleTime: 60_000 });
};
export const useUnits = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.units(ws), queryFn: catalogApi.units, enabled: !!ws && enabled, staleTime: 60_000 });
};
export const useStockOverview = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.overview(ws), queryFn: catalogApi.overview, enabled: !!ws && enabled });
};
export const useMovements = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: catalogKeys.movements(ws, q), queryFn: () => catalogApi.movements(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};

/** Invalidation after a catalogue write: lists, KPIs, low stock, dashboard, movements — and one product when given. */
export function useCatalogRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    (o: { productId?: string; taxonomies?: boolean } = {}) => {
      const jobs = [qc.invalidateQueries({ queryKey: catalogKeys.products(ws) }), qc.invalidateQueries({ queryKey: [ws, 'stock'] })];
      if (o.productId) jobs.push(qc.invalidateQueries({ queryKey: catalogKeys.product(ws, o.productId) }));
      if (o.taxonomies) jobs.push(qc.invalidateQueries({ queryKey: catalogKeys.categories(ws) }), qc.invalidateQueries({ queryKey: catalogKeys.units(ws) }));
      return Promise.all(jobs);
    },
    [ws, qc],
  );
}

/**
 * WS `product.updated { product: { id, stock, isActive, moderationStatus, lowStock } }` (03-events §2): the cached
 * product and the cached list rows are patched in place; KPIs, low stock and the dashboard are refetched.
 * Mounted once in the shell.
 */
export function useCatalogEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  useWsEvent<{ product?: { id: string; stock?: number | null; isActive?: boolean; moderationStatus?: string; lowStock?: boolean }; originSessionId?: string | null }>('product.updated', (p) => {
    const u = p?.product;
    if (!u?.id) return;
    // M11: who caused it (JWT `sid` of the request) — the product form tells its own writes from someone else's
    recordOrigin(u.id, p?.originSessionId);
    const patchRow = <T extends ProductListItem>(row: T): T => {
      if (row.id !== u.id) return row;
      const next = { ...row };
      if (typeof u.isActive === 'boolean') next.isActive = u.isActive;
      if (u.moderationStatus && next.moderation) next.moderation = { ...next.moderation, status: u.moderationStatus as NonNullable<ProductListItem['moderation']>['status'] };
      if (u.stock !== undefined && !row.hasVariants) next.stock = u.stock;
      return next;
    };
    qc.setQueriesData<Page<ProductListItem>>({ queryKey: [ws, 'products', 'list'] }, (old) => (old ? { ...old, rows: old.rows.map(patchRow) } : old));
    qc.setQueryData<Product>(catalogKeys.product(ws, u.id), (old) => (old ? patchRow(old) : old));
    // derived values (stock state, variant stocks, images being re-encoded, KPIs) come from the server
    void qc.invalidateQueries({ queryKey: catalogKeys.product(ws, u.id) });
    void qc.invalidateQueries({ queryKey: catalogKeys.lowStock(ws) });
    void qc.invalidateQueries({ queryKey: [ws, 'stock'] });
    // stock state pills, margins and variant summaries are derived by the server: the visible lists are refetched
    void qc.invalidateQueries({ queryKey: [ws, 'products', 'list'] });
  });
  useWsEvent<{ productId?: string }>('moderation.updated', (p) => {
    if (p?.productId) void qc.invalidateQueries({ queryKey: catalogKeys.product(ws, p.productId) });
    void qc.invalidateQueries({ queryKey: catalogKeys.products(ws) });
    void qc.invalidateQueries({ queryKey: catalogKeys.moderationSummary(ws) });
  });
}
