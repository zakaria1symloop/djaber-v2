// Orders calls (06 §2 "Orders", api-contract §3.7, §1.7 idempotency) + TanStack Query hooks, cache keys and the
// WS → cache bridge (`order.created | updated | deleted`, 03-events §2). Polling fallback is the WsProvider's.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiRaw, type Meta } from '@/lib/api';
import type { JobRef } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import { ORDER_EVENTS } from './action-keys';
import type { Client } from '@/features/clients/contracts';
import { orderRemaining, type CreatePaymentLinkInput, type OrderPaymentLinkDto, type OrderRefundInput } from '@djaber/shared';
import { invalidateFigures } from '@/lib/figures';
import type {
  BulkItemResult,
  BulkOrderAssignInput,
  BulkOrderPrintInput,
  BulkOrderStatusInput,
  BulkResponse,
  CallLogInput,
  CancelOrderInput,
  DeliverOrderInput,
  Order,
  OrderAddressInput,
  OrderAssignInput,
  OrderCallbackInput,
  OrderCreatedEvent,
  OrderDeletedEvent,
  OrderListItem,
  OrderNote,
  OrderStats,
  OrderStatusChangeInput,
  OrderSummary,
  OrderUpdatedEvent,
  PaymentEntry,
  RecordPaymentInput,
  ReturnOrderInput,
  Shipment,
  ShipManualInput,
  UpdateOrderInput,
} from './contracts';

export type OrdersPage = { rows: OrderListItem[]; total: number; page: number; pageSize: number; meta: Meta };

const bulk = async (path: string, body: unknown, key: string): Promise<BulkResponse> => {
  const r = await apiRaw<{ results: BulkItemResult[] }>(path, { method: 'POST', body, idempotent: key });
  const results = r.data?.results ?? [];
  const m = r.meta as Meta & { ok?: number; failed?: number };
  return { results, ok: m?.ok ?? results.filter((x) => x.ok).length, failed: m?.failed ?? results.filter((x) => !x.ok).length };
};

export const ordersApi = {
  list: async (q: ApiQuery): Promise<OrdersPage> => {
    const r = await apiRaw<OrderListItem[]>('/orders', { query: q });
    return { rows: r.data ?? [], total: r.meta?.total ?? r.data?.length ?? 0, page: r.meta?.page ?? 1, pageSize: r.meta?.pageSize ?? 25, meta: r.meta ?? {} };
  },
  stats: (q: ApiQuery) => api<OrderStats>('/orders/stats', { query: q }),
  order: (id: string) => api<Order>(`/orders/${id}`),
  /** versioned PATCH (contact, items, notes…): `409 CONFLICT` carries `details.current` */
  update: (id: string, b: UpdateOrderInput) => api<Order>(`/orders/${id}`, { method: 'PATCH', body: b }),
  /** Idempotency-Key required: the key is created when the dialog opens and reused on retry */
  status: (id: string, b: OrderStatusChangeInput, key: string) => api<Order>(`/orders/${id}/status`, { method: 'POST', body: b, idempotent: key }),
  cancel: (id: string, b: CancelOrderInput) => api<Order>(`/orders/${id}/cancel`, { method: 'POST', body: b }),
  deliver: (id: string, b: DeliverOrderInput) => api<Order>(`/orders/${id}/deliver`, { method: 'POST', body: b }),
  returnOrder: (id: string, b: ReturnOrderInput) => api<Order>(`/orders/${id}/return`, { method: 'POST', body: b }),
  shipManual: (id: string, b: ShipManualInput) => api<Order>(`/orders/${id}/ship-manual`, { method: 'POST', body: b }),
  logCall: (id: string, b: CallLogInput) => api<Order>(`/orders/${id}/calls`, { method: 'POST', body: b }),
  addNote: (id: string, body: string) => api<OrderNote>(`/orders/${id}/notes`, { method: 'POST', body: { body } }),
  recordPayment: (id: string, b: RecordPaymentInput, key: string) => api<PaymentEntry | Order>(`/orders/${id}/payments`, { method: 'POST', body: b, idempotent: key }),
  setCallback: (id: string, b: OrderCallbackInput) => api<Order>(`/orders/${id}/callback`, { method: 'POST', body: b }),
  clearCallback: (id: string) => api<Order | null>(`/orders/${id}/callback`, { method: 'DELETE' }),
  assign: (id: string, b: OrderAssignInput) => api<Order>(`/orders/${id}/assign`, { method: 'POST', body: b }),
  /** PAY-02 (P2, M9): online payment link — the worker creates the Chargily checkout (`creating` → `pending` + url) */
  createPaymentLink: (id: string, b: CreatePaymentLinkInput) => api<OrderPaymentLinkDto>(`/orders/${id}/payment-link`, { method: 'POST', body: b }),
  paymentLink: (id: string) => api<OrderPaymentLinkDto | null>(`/orders/${id}/payment-link`),
  /** PAY-03 (P2, M9): recorded refund → the order detail */
  refund: (id: string, b: OrderRefundInput) => api<Order>(`/orders/${id}/refunds`, { method: 'POST', body: b }),
  address: (id: string, b: OrderAddressInput) => api<Order>(`/orders/${id}/address`, { method: 'POST', body: b }),
  /** `DELETE /orders/:id?confirmNumber=` — the typed number must match exactly */
  remove: (id: string, confirmNumber: string) => api<null>(`/orders/${id}`, { method: 'DELETE', query: { confirmNumber } }),
  /** A5 slip PDF → `{ url }` (signed) */
  printUrl: (id: string, q: { withPrices: boolean; twoPerPage: boolean; lang: string }) => api<{ url: string }>(`/orders/${id}/print`, { query: q }),
  /** courier parcel from the order address (Idempotency-Key required, `delivery.send`) */
  createShipment: (id: string, b: { wilayaId: number; communeId?: number | null; communeText?: string | null; address?: string | null; isStopdesk: boolean; stopdeskId?: string | null }, key: string) =>
    api<Shipment>(`/orders/${id}/shipments`, { method: 'POST', body: b, idempotent: key }),

  /* bulk (per-item results, never all-or-nothing) */
  bulkStatus: (b: BulkOrderStatusInput, key: string) => bulk('/orders/bulk/status', b, key),
  bulkAssign: (b: BulkOrderAssignInput, key: string) => bulk('/orders/bulk/assign', b, key),
  bulkPrint: (b: BulkOrderPrintInput, key: string) => api<JobRef>('/orders/bulk/print', { method: 'POST', body: b, idempotent: key }),
  /** export of a selection / the current filter / everything → 202 job */
  exportOrders: (q: ApiQuery) => api<JobRef>('/orders/export', { query: q }),

  /** client of a deep-link chip (`/orders?clientId=`), same cache entry as the client sheet */
  client: (id: string) => api<Client>(`/clients/${id}`),
};

/* ---------- cache keys: every key starts with the workspace id ---------- */
export const ordersKeys = {
  all: (ws: string) => [ws, 'orders'] as const,
  list: (ws: string, q?: ApiQuery) => (q ? ([ws, 'orders', 'list', q] as const) : ([ws, 'orders', 'list'] as const)),
  stats: (ws: string, q?: ApiQuery) => (q ? ([ws, 'orders', 'stats', q] as const) : ([ws, 'orders', 'stats'] as const)),
  order: (ws: string, id: string) => [ws, 'order', id] as const,
  client: (ws: string, id: string) => [ws, 'client', id] as const,
};

export const useOrders = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  // the previous page stays on screen while the next one loads (no skeleton flash on filter changes)
  return useQuery({ queryKey: ordersKeys.list(ws, q), queryFn: () => ordersApi.list(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useOrderStats = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: ordersKeys.stats(ws, q), queryFn: () => ordersApi.stats(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useOrder = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: ordersKeys.order(ws, id ?? ''), queryFn: () => ordersApi.order(id!), enabled: !!ws && !!id, retry: (n, e) => n < 2 && !(e as { status?: number })?.status });
};
export const useOrderClient = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: ordersKeys.client(ws, id ?? ''), queryFn: () => ordersApi.client(id!), enabled: !!ws && !!id, staleTime: 60_000, retry: false });
};

/** Invalidation after an order write: lists, KPIs, the order, the home dashboard and the clients (aggregates). */
export function useOrdersRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    (o: { orderId?: string; order?: Order | null } = {}) => {
      if (o.order) qc.setQueryData(ordersKeys.order(ws, o.order.id), o.order);
      const jobs = [
        qc.invalidateQueries({ queryKey: ordersKeys.all(ws) }),
        invalidateFigures(qc, ws),
        qc.invalidateQueries({ queryKey: [ws, 'clients'] }),
        qc.invalidateQueries({ queryKey: [ws, 'client'] }),
      ];
      const id = o.orderId ?? o.order?.id;
      if (id) jobs.push(qc.invalidateQueries({ queryKey: ordersKeys.order(ws, id) }));
      return Promise.all(jobs);
    },
    [ws, qc],
  );
}

/** Fields of a list row the WS summary can patch in place (03-events §2 `OrderSummary`). */
export const patchRowFromSummary = (row: OrderListItem, s: Partial<OrderSummary> & { id: string }): OrderListItem => {
  if (row.id !== s.id) return row;
  const next = { ...row };
  if (s.status) next.status = s.status;
  if (s.confirmationStatus) next.confirmationStatus = s.confirmationStatus;
  if (s.paymentStatus) next.paymentStatus = s.paymentStatus;
  if (s.deliveryStatus) next.deliveryStatus = s.deliveryStatus;
  if (typeof s.total === 'number') next.total = s.total;
  if (typeof s.amountPaid === 'number') next.amountPaid = s.amountPaid;
  // journey J08v-4: the shared « reste à encaisser » (0 once cancelled / returned), whatever field the summary changed
  if (typeof s.amountPaid === 'number' || s.status || typeof s.total === 'number') next.remaining = orderRemaining(next);
  if (s.callbackAt !== undefined) next.callbackAt = s.callbackAt;
  if (s.riskLevel) next.riskLevel = s.riskLevel;
  if (typeof s.version === 'number') next.version = s.version;
  return next;
};

/**
 * WS bridge, mounted once in the shell. `order.created` refetches the visible lists (a new AI order appears live);
 * `order.updated` patches the cached rows in place and re-reads the order page — the page itself never rebases a dirty
 * draft (it keeps the edited fields and only offers "Recharger" on a 409); `order.deleted` drops the row.
 */
export function useOrderEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const derived = () => {
    void qc.invalidateQueries({ queryKey: ordersKeys.stats(ws) });
    void invalidateFigures(qc, ws);
  };
  useWsEvent<OrderCreatedEvent>(ORDER_EVENTS.created, (p) => {
    if (!p?.order?.id) return;
    void qc.invalidateQueries({ queryKey: ordersKeys.list(ws) });
    derived();
  });
  useWsEvent<OrderUpdatedEvent>(ORDER_EVENTS.updated, (p) => {
    const s = p?.order;
    if (!s?.id) return;
    qc.setQueriesData<OrdersPage>({ queryKey: ordersKeys.list(ws) }, (old) => (old ? { ...old, rows: old.rows.map((r) => patchRowFromSummary(r, s)) } : old));
    const known = qc.getQueryData<Order>(ordersKeys.order(ws, s.id));
    // the page reads the full order again (history, calls, payments) unless it already holds this version
    if (known && known.version !== s.version) void qc.invalidateQueries({ queryKey: ordersKeys.order(ws, s.id), exact: true });
    // the row set of a filtered list may change (tab, confirmation…): the visible lists are refetched
    void qc.invalidateQueries({ queryKey: ordersKeys.list(ws) });
    derived();
  });
  // reconnect (M11): the server answers `resync { orders }` with the orders changed while the socket was down
  useWsEvent<{ orders?: OrderUpdatedEvent['order'][] }>('resync', (p) => {
    const rows = (p?.orders ?? []).filter((s) => s?.id);
    if (!rows.length) return;
    const byId = new Map(rows.map((s) => [s.id, s]));
    qc.setQueriesData<OrdersPage>({ queryKey: ordersKeys.list(ws) }, (old) => (old ? { ...old, rows: old.rows.map((r) => (byId.has(r.id) ? patchRowFromSummary(r, byId.get(r.id)!) : r)) } : old));
    for (const s of rows) {
      const known = qc.getQueryData<Order>(ordersKeys.order(ws, s.id));
      if (known && known.version !== s.version) void qc.invalidateQueries({ queryKey: ordersKeys.order(ws, s.id), exact: true });
    }
    void qc.invalidateQueries({ queryKey: ordersKeys.list(ws) });
    derived();
  });
  useWsEvent<OrderDeletedEvent>(ORDER_EVENTS.deleted, (p) => {
    if (!p?.id) return;
    qc.setQueriesData<OrdersPage>({ queryKey: ordersKeys.list(ws) }, (old) => (old ? { ...old, rows: old.rows.filter((r) => r.id !== p.id), total: Math.max(0, old.total - 1) } : old));
    void qc.invalidateQueries({ queryKey: ordersKeys.order(ws, p.id), exact: true });
    derived();
  });
}
