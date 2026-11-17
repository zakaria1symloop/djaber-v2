// Calls of the new order form (route map `/orders/new`): client search / card, order create (Idempotency-Key required,
// api-contract §1.7), duplicate prefill. Product search reuses the catalogue client. Cache keys follow the orders,
// clients and dashboard prefixes so that a created order refreshes every list that shows it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { catalogApi } from '@/features/catalog/api';
import type { Client, ClientListItem } from '@/features/clients/contracts';
import type { CreateOrderInput, Order, OrderDraft } from '@/features/orders/contracts';
import { api, apiRaw } from '@/lib/api';
import { searchTerm } from '@/lib/phone';
import { useWorkspaceId } from '@/lib/session';

export const orderFormApi = {
  /** `GET /clients?q=` — a phone fragment is sent normalised ("0555 12" → "055512"); min 2 characters (§1.6). */
  searchClients: async (q: string) =>
    (
      await apiRaw<ClientListItem[]>('/clients', {
        query: { q: searchTerm(q), pageSize: 25, sort: '-lastOrderAt' },
      })
    ).data,
  /** journey J09-10: the archived card holding this exact phone (the order restores it), else null */
  archivedOwner: async (phone: string) =>
    (
      await apiRaw<ClientListItem[]>('/clients', {
        query: { q: searchTerm(phone), archived: 1, pageSize: 25 },
      })
    ).data,
  client: (id: string) => api<Client>(`/clients/${id}`),
  searchProducts: (q: string) => catalogApi.products({ q: q.trim(), pageSize: 25, status: ['active'] }),
  product: (id: string) => catalogApi.product(id),
  /** `POST /orders` — the key is created per submit attempt and reused when the same attempt is retried. */
  create: (body: CreateOrderInput, idempotencyKey: string) => api<Order>('/orders', { method: 'POST', body, idempotent: idempotencyKey }),
  /** `POST /orders/:id/duplicate` → a draft payload (nothing is written). */
  duplicate: (id: string) => api<OrderDraft>(`/orders/${id}/duplicate`, { method: 'POST', body: {} }),
};

export const orderFormKeys = {
  clientSearch: (ws: string, q: string) => [ws, 'clients', 'search', q] as const,
  client: (ws: string, id: string) => [ws, 'client', id] as const,
  productSearch: (ws: string, q: string) => [ws, 'products', 'list', { q, form: true }] as const,
};

export const useClientSearch = (q: string) => {
  const ws = useWorkspaceId();
  const term = q.trim();
  return useQuery({
    queryKey: orderFormKeys.clientSearch(ws, searchTerm(term)),
    queryFn: () => orderFormApi.searchClients(term),
    enabled: !!ws && term.length >= 2,
    staleTime: 10_000,
  });
};
export const useArchivedOwnerSearch = (phone: string) => {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...orderFormKeys.clientSearch(ws, searchTerm(phone)), 'archived'] as const,
    queryFn: () => orderFormApi.archivedOwner(phone),
    enabled: !!ws && phone.length >= 9,
    staleTime: 10_000,
  });
};
export const useFormClient = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: orderFormKeys.client(ws, id ?? ''),
    queryFn: () => orderFormApi.client(id!),
    enabled: !!ws && !!id,
  });
};
export const useProductSearch = (q: string, enabled: boolean) => {
  const ws = useWorkspaceId();
  const term = q.trim();
  return useQuery({
    queryKey: orderFormKeys.productSearch(ws, term),
    queryFn: () => orderFormApi.searchProducts(term),
    enabled: !!ws && enabled,
    staleTime: 10_000,
  });
};

/** After a created order: lists, KPIs, the client card and the home dashboard are refetched. */
export function useOrderCreatedRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [ws, 'orders'] }),
        qc.invalidateQueries({ queryKey: [ws, 'clients'] }),
        qc.invalidateQueries({ queryKey: [ws, 'client'] }),
        qc.invalidateQueries({ queryKey: [ws, 'dashboard'] }),
        qc.invalidateQueries({ queryKey: [ws, 'products'] }),
        qc.invalidateQueries({ queryKey: [ws, 'stock'] }),
      ]),
    [ws, qc],
  );
}
