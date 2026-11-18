// GDS operations calls (06 "GDS operations", §8.6; api-contract §3.9, §4; `.local/m7-notes/contract-ready.md`):
// suppliers, purchases, sales, cash register, inventory counts, stock recommendations, cross-sell rules, product
// expenses + the TanStack Query hooks, cache keys, the after-write refresh and the WS bridge (`cash.updated`,
// `inventory.updated`, `product.updated`).
import type { ProductExpenseView } from '@djaber/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiRaw, type Meta } from '@/lib/api';
import type { JobRef } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import type {
  CashDay,
  CashEntryInput,
  CashEntryPatch,
  CashPage,
  CashRow,
  CashStats,
  CloseCashInputT,
  CrossSellInput,
  CrossSellPatch,
  CrossSellRule,
  CrossSellStats,
  GdsPage,
  Inventory,
  InventoryLinesBody,
  InventoryRow,
  InventoryScope,
  InventoryScopePreview,
  InventoryStartInput,
  MovementStats,
  PaymentInput,
  ProductStats,
  Purchase,
  PurchaseInput,
  PurchasePatch,
  PurchaseRow,
  PurchaseStats,
  ReceiveInput,
  Sale,
  SaleInput,
  SalePatch,
  SaleRow,
  SaleStats,
  SignedFile,
  StockReco,
  StockRecoStats,
  Supplier,
  SupplierInput,
  SupplierPatch,
  SupplierPayment,
  SupplierRow,
} from './contracts';

/** `GET|POST /products/:id/expenses` read model (shared `ProductExpenseView`). */
export type ProductExpense = ProductExpenseView;
export type ProductExpenseInput = { category: ProductExpense['category']; description?: string | null; amount: number; isPerUnit: boolean; date?: string };

const page = async <T>(path: string, query: ApiQuery): Promise<GdsPage<T>> => {
  const r = await apiRaw<T[]>(path, { query });
  return { rows: r.data ?? [], total: r.meta?.total ?? r.data?.length ?? 0, meta: r.meta ?? {} };
};
/** `POST /purchases/:id/receive`: the purchase + the over-receipt warnings of `meta.warnings`. */
export type ReceiveResult = { purchase: Purchase; warnings: { code: string; params?: Record<string, unknown>; field?: string }[] };

export const gdsApi = {
  /* suppliers (GDS-05) */
  suppliers: (q: ApiQuery) => page<SupplierRow>('/suppliers', q),
  supplier: (id: string) => api<Supplier>(`/suppliers/${id}`),
  createSupplier: (b: SupplierInput) => api<Supplier>('/suppliers', { method: 'POST', body: b }),
  updateSupplier: (id: string, b: SupplierPatch) => api<Supplier>(`/suppliers/${id}`, { method: 'PATCH', body: b }),
  /** `409 SUPPLIER_HAS_PURCHASES {count}` ⇒ "Désactiver" */
  deleteSupplier: (id: string) => api<null>(`/suppliers/${id}`, { method: 'DELETE' }),
  setSupplierActive: (id: string, active: boolean) => api<Supplier>(`/suppliers/${id}/${active ? 'activate' : 'deactivate'}`, { method: 'POST', body: {} }),
  supplierPurchases: (id: string, q: ApiQuery) => page<PurchaseRow>(`/suppliers/${id}/purchases`, q),
  supplierPayment: (id: string, b: SupplierPayment, key: string) =>
    api<{ supplier: Supplier; allocations: { purchaseId: string; number: string; amount: number }[] }>(`/suppliers/${id}/payments`, { method: 'POST', body: b, idempotent: key }),

  /* purchases (GDS-06) */
  purchases: (q: ApiQuery) => page<PurchaseRow>('/purchases', q),
  purchaseStats: (q: ApiQuery) => api<PurchaseStats>('/purchases/stats', { query: q }),
  purchase: (id: string) => api<Purchase>(`/purchases/${id}`),
  createPurchase: (b: PurchaseInput, key: string) => api<Purchase>('/purchases', { method: 'POST', body: b, idempotent: key }),
  updatePurchase: (id: string, b: PurchasePatch) => api<Purchase>(`/purchases/${id}`, { method: 'PATCH', body: b }),
  deletePurchase: (id: string) => api<null>(`/purchases/${id}`, { method: 'DELETE' }),
  orderPurchase: (id: string) => api<Purchase>(`/purchases/${id}/order`, { method: 'POST', body: {} }),
  receivePurchase: async (id: string, b: ReceiveInput, key: string): Promise<ReceiveResult> => {
    const r = await apiRaw<Purchase>(`/purchases/${id}/receive`, { method: 'POST', body: b, idempotent: key });
    return { purchase: r.data, warnings: (r.meta?.warnings ?? []) as ReceiveResult['warnings'] };
  },
  cancelPurchase: (id: string, reason: string | null) => api<Purchase>(`/purchases/${id}/cancel`, { method: 'POST', body: { reason } }),
  purchasePayment: (id: string, b: PaymentInput, key: string) => api<Purchase>(`/purchases/${id}/payments`, { method: 'POST', body: b, idempotent: key }),
  duplicatePurchase: (id: string) => api<Purchase>(`/purchases/${id}/duplicate`, { method: 'POST', body: {} }),
  printPurchase: (id: string, lang: string) => api<SignedFile>(`/purchases/${id}/print`, { query: { lang } }),

  /* sales (GDS-07) */
  sales: (q: ApiQuery) => page<SaleRow>('/sales', q),
  saleStats: (q: ApiQuery) => api<SaleStats>('/sales/stats', { query: q }),
  sale: (id: string) => api<Sale>(`/sales/${id}`),
  createSale: (b: SaleInput, key: string) => api<Sale>('/sales', { method: 'POST', body: b, idempotent: key }),
  updateSale: (id: string, b: SalePatch) => api<Sale>(`/sales/${id}`, { method: 'PATCH', body: b }),
  deleteSale: (id: string) => api<null>(`/sales/${id}`, { method: 'DELETE' }),
  salePayment: (id: string, b: PaymentInput, key: string) => api<Sale>(`/sales/${id}/payments`, { method: 'POST', body: b, idempotent: key }),
  cancelSale: (id: string, b: { reason: string; restoreStock: boolean; refund: boolean }) => api<Sale>(`/sales/${id}/cancel`, { method: 'POST', body: b }),
  linkSaleClient: (id: string, clientId: string) => api<Sale>(`/sales/${id}/client`, { method: 'POST', body: { clientId } }),
  saleReceipt: (id: string, lang: string) => api<SignedFile>(`/sales/${id}/receipt`, { query: { lang } }),

  /* cash register (GDS-08, CSH) */
  cash: async (q: ApiQuery): Promise<CashPage> => {
    const r = await apiRaw<CashRow[]>('/cash', { query: q });
    const m = (r.meta ?? {}) as Meta & { openingBalance?: number; from?: string; to?: string };
    return { rows: r.data ?? [], total: m.total ?? r.data?.length ?? 0, meta: m, openingBalance: m.openingBalance ?? null, from: m.from ?? null, to: m.to ?? null };
  },
  cashStats: (q: ApiQuery) => api<CashStats>('/cash/stats', { query: q }),
  cashDays: (q: ApiQuery = {}) => api<CashDay[]>('/cash/days', { query: q }),
  createCash: (b: CashEntryInput, key: string) => api<CashRow>('/cash', { method: 'POST', body: b, idempotent: key }),
  updateCash: (id: string, b: CashEntryPatch) => api<CashRow>(`/cash/${id}`, { method: 'PATCH', body: b }),
  deleteCash: (id: string) => api<null>(`/cash/${id}`, { method: 'DELETE' }),
  closeCash: (b: CloseCashInputT, key: string) => api<CashDay>('/cash/close', { method: 'POST', body: b, idempotent: key }),
  reopenCash: (day: string, reason: string) => api<CashDay>(`/cash/days/${day}/reopen`, { method: 'POST', body: { reason } }),
  exportCash: (q: ApiQuery) => api<JobRef>('/cash/export', { query: q }),

  /* inventory counts (INV) */
  inventories: (q: ApiQuery) => page<InventoryRow>('/inventories', q),
  inventoryScope: (q: { scope: InventoryScope; categoryId?: string }) => api<InventoryScopePreview>('/inventories/scope-preview', { query: q }),
  inventory: (id: string) => api<Inventory>(`/inventories/${id}`),
  startInventory: (b: InventoryStartInput) => api<Inventory>('/inventories', { method: 'POST', body: b }),
  saveLines: (id: string, b: InventoryLinesBody) => api<Inventory>(`/inventories/${id}/lines`, { method: 'PUT', body: b }),
  validateInventory: (id: string, note: string | null, key: string) => api<Inventory>(`/inventories/${id}/validate`, { method: 'POST', body: { note }, idempotent: key }),
  cancelInventory: (id: string) => api<Inventory>(`/inventories/${id}/cancel`, { method: 'POST', body: {} }),
  inventorySheet: (id: string, lang: string) => api<SignedFile>(`/inventories/${id}/sheet`, { query: { lang } }),

  /* stock recommendations (GDS-10) */
  stockRecos: (q: ApiQuery) => api<StockReco[]>('/stock-recommendations', { query: q }),
  stockRecoStats: () => api<StockRecoStats>('/stock-recommendations/stats'),
  stockRecoHistory: (q: ApiQuery) => page<StockReco>('/stock-recommendations/history', q),
  generateStockRecos: () => api<JobRef>('/stock-recommendations/generate', { method: 'POST', body: {} }),
  applyStockReco: (id: string, b: { refType?: string | null; refId?: string | null } = {}) => api<StockReco>(`/stock-recommendations/${id}/apply`, { method: 'POST', body: b }),
  dismissStockReco: (id: string) => api<StockReco>(`/stock-recommendations/${id}/dismiss`, { method: 'POST', body: {} }),
  snoozeStockReco: (id: string, days = 7) => api<StockReco>(`/stock-recommendations/${id}/snooze`, { method: 'POST', body: { days } }),
  muteStockReco: (productId: string, type: string) => api<null>('/stock-recommendations/mute', { method: 'POST', body: { productId, type } }),

  /* cross-sell rules (REC-01…03) */
  crossSell: (q: ApiQuery) => page<CrossSellRule>('/recommendations', q),
  crossSellStats: () => api<CrossSellStats>('/recommendations/stats'),
  createCrossSell: (b: CrossSellInput) => api<CrossSellRule>('/recommendations', { method: 'POST', body: b }),
  updateCrossSell: (id: string, b: CrossSellPatch) => api<CrossSellRule>(`/recommendations/${id}`, { method: 'PATCH', body: b }),
  deleteCrossSell: (id: string) => api<null>(`/recommendations/${id}`, { method: 'DELETE' }),
  generateCrossSell: () => api<JobRef>('/recommendations/generate', { method: 'POST', body: {} }),

  /* KPIs (M2 carry-over) */
  movementStats: (q: ApiQuery) => api<MovementStats>('/stock/movements/stats', { query: q }),
  productStats: (q: ApiQuery) => api<ProductStats>('/products/stats', { query: q }),

  /* product expenses (GDS-09, EXP-01) */
  expenses: (productId: string) => api<ProductExpense[]>(`/products/${productId}/expenses`),
  createExpense: (productId: string, b: ProductExpenseInput) => api<ProductExpense>(`/products/${productId}/expenses`, { method: 'POST', body: b }),
  updateExpense: (productId: string, id: string, b: Partial<ProductExpenseInput>) => api<ProductExpense>(`/products/${productId}/expenses/${id}`, { method: 'PATCH', body: b }),
  deleteExpense: (productId: string, id: string) => api<null>(`/products/${productId}/expenses/${id}`, { method: 'DELETE' }),
};

/* ---------- cache keys: every key starts with the workspace id ---------- */
export const gdsKeys = {
  suppliers: (ws: string, q?: ApiQuery) => (q ? ([ws, 'suppliers', 'list', q] as const) : ([ws, 'suppliers'] as const)),
  supplier: (ws: string, id: string) => [ws, 'suppliers', 'one', id] as const,
  purchases: (ws: string, q?: ApiQuery) => (q ? ([ws, 'purchases', 'list', q] as const) : ([ws, 'purchases'] as const)),
  purchaseStats: (ws: string, q: ApiQuery) => [ws, 'purchases', 'stats', q] as const,
  purchase: (ws: string, id: string) => [ws, 'purchases', 'one', id] as const,
  sales: (ws: string, q?: ApiQuery) => (q ? ([ws, 'sales', 'list', q] as const) : ([ws, 'sales'] as const)),
  saleStats: (ws: string, q: ApiQuery) => [ws, 'sales', 'stats', q] as const,
  sale: (ws: string, id: string) => [ws, 'sales', 'one', id] as const,
  cash: (ws: string, q?: ApiQuery) => (q ? ([ws, 'cash', 'list', q] as const) : ([ws, 'cash'] as const)),
  cashStats: (ws: string, q: ApiQuery) => [ws, 'cash', 'stats', q] as const,
  cashDays: (ws: string) => [ws, 'cash', 'days'] as const,
  inventories: (ws: string, q?: ApiQuery) => (q ? ([ws, 'inventories', 'list', q] as const) : ([ws, 'inventories'] as const)),
  inventory: (ws: string, id: string) => [ws, 'inventories', 'one', id] as const,
  inventoryScope: (ws: string, scope: string, categoryId: string) => [ws, 'inventories', 'scope', scope, categoryId] as const,
  stockRecos: (ws: string, q?: ApiQuery) => (q ? ([ws, 'stock-recos', 'list', q] as const) : ([ws, 'stock-recos'] as const)),
  stockRecoStats: (ws: string) => [ws, 'stock-recos', 'stats'] as const,
  stockRecoHistory: (ws: string, q: ApiQuery) => [ws, 'stock-recos', 'history', q] as const,
  crossSell: (ws: string, q?: ApiQuery) => (q ? ([ws, 'cross-sell', 'list', q] as const) : ([ws, 'cross-sell'] as const)),
  crossSellStats: (ws: string) => [ws, 'cross-sell', 'stats'] as const,
  movementStats: (ws: string, q: ApiQuery) => [ws, 'stock', 'movements-stats', q] as const,
  productStats: (ws: string, q: ApiQuery) => [ws, 'products', 'stats', q] as const,
  expenses: (ws: string, productId: string) => [ws, 'product', productId, 'expenses'] as const,
};

const notFoundNoRetry = (n: number, e: unknown) => n < 2 && !(e as { status?: number })?.status;

/* ---------- hooks ---------- */
export const useSuppliers = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.suppliers(ws, q), queryFn: () => gdsApi.suppliers(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useSupplier = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.supplier(ws, id ?? ''), queryFn: () => gdsApi.supplier(id!), enabled: !!ws && !!id, retry: notFoundNoRetry });
};
export const usePurchases = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.purchases(ws, q), queryFn: () => gdsApi.purchases(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const usePurchaseStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.purchaseStats(ws, q), queryFn: () => gdsApi.purchaseStats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const usePurchase = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.purchase(ws, id ?? ''), queryFn: () => gdsApi.purchase(id!), enabled: !!ws && !!id, retry: notFoundNoRetry });
};
export const useSales = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.sales(ws, q), queryFn: () => gdsApi.sales(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useSaleStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.saleStats(ws, q), queryFn: () => gdsApi.saleStats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useSale = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.sale(ws, id ?? ''), queryFn: () => gdsApi.sale(id!), enabled: !!ws && !!id, retry: notFoundNoRetry });
};
export const useCash = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.cash(ws, q), queryFn: () => gdsApi.cash(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useCashStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.cashStats(ws, q), queryFn: () => gdsApi.cashStats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useCashDays = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.cashDays(ws), queryFn: () => gdsApi.cashDays(), enabled: !!ws && enabled });
};
export const useInventories = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.inventories(ws, q), queryFn: () => gdsApi.inventories(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useInventory = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  // journeys 16/11 J07-6: the « théorique » follows the movements made during the count — the page reloads it every time it
  // is opened (a stock adjustment elsewhere does not invalidate this query), like its validate dialog does
  return useQuery({ queryKey: gdsKeys.inventory(ws, id ?? ''), queryFn: () => gdsApi.inventory(id!), enabled: !!ws && !!id, retry: notFoundNoRetry, refetchOnMount: 'always' });
};
export const useInventoryScope = (scope: InventoryScope, categoryId: string | null, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: gdsKeys.inventoryScope(ws, scope, categoryId ?? ''),
    queryFn: () => gdsApi.inventoryScope({ scope, ...(categoryId ? { categoryId } : {}) }),
    enabled: !!ws && enabled && (scope !== 'category' || !!categoryId),
    staleTime: 30_000,
  });
};
export const useStockRecos = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.stockRecos(ws, q), queryFn: () => gdsApi.stockRecos(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useStockRecoStats = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.stockRecoStats(ws), queryFn: gdsApi.stockRecoStats, enabled: !!ws && enabled });
};
export const useStockRecoHistory = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.stockRecoHistory(ws, q), queryFn: () => gdsApi.stockRecoHistory(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useCrossSell = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.crossSell(ws, q), queryFn: () => gdsApi.crossSell(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useCrossSellStats = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.crossSellStats(ws), queryFn: gdsApi.crossSellStats, enabled: !!ws && enabled });
};
export const useMovementStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.movementStats(ws, q), queryFn: () => gdsApi.movementStats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useProductStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.productStats(ws, q), queryFn: () => gdsApi.productStats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useProductExpenses = (productId: string | null | undefined, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: gdsKeys.expenses(ws, productId ?? ''), queryFn: () => gdsApi.expenses(productId!), enabled: !!ws && !!productId && enabled });
};

/**
 * After a GDS write: the GDS lists and their KPIs, the cash register (automatic rows), the stock (movements, dashboard,
 * products) and the clients (sale aggregates) are read again. `area` narrows nothing: every effect crosses screens.
 */
export function useGdsRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        ['suppliers', 'purchases', 'sales', 'cash', 'inventories', 'stock-recos', 'cross-sell', 'stock', 'products', 'product', 'clients', 'client', 'dashboard'].map((k) =>
          qc.invalidateQueries({ queryKey: [ws, k] }),
        ),
      ),
    [ws, qc],
  );
}

/**
 * WS bridge (api-contract §5): `cash.updated { day }` (every cash write, sales / purchases / orders included),
 * `inventory.updated { id, progress }`, `product.updated` (stock) — the open screens are refreshed.
 */
export function useGdsEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  useWsEvent<{ day?: string }>('cash.updated', () => {
    void qc.invalidateQueries({ queryKey: gdsKeys.cash(ws) });
    void qc.invalidateQueries({ queryKey: gdsKeys.sales(ws) });
    void qc.invalidateQueries({ queryKey: gdsKeys.purchases(ws) });
    // revenue / cash tiles of the Home (J02r-3 / J07r-3 family)
    void qc.invalidateQueries({ queryKey: [ws, 'dashboard'] });
  });
  useWsEvent<{ id?: string }>('inventory.updated', (p) => {
    void qc.invalidateQueries({ queryKey: gdsKeys.inventories(ws) });
    if (p?.id) void qc.invalidateQueries({ queryKey: gdsKeys.inventory(ws, p.id) });
  });
}
