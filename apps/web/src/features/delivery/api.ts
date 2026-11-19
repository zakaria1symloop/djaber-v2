// Delivery calls (06 §2 "Delivery"): geo, fee grid, quote, stop-desks (M5); couriers, rates, overview, shipments,
// sending, tracking sync, labels and the public tracking page (M6) + TanStack Query hooks and the WS bridge
// (`shipment.updated`, 03-events §2).
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { BulkItemResult, BulkResponse } from '@/features/orders/contracts';
import { api, apiRaw, type Meta } from '@/lib/api';
import type { JobRef } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import type { CancelReason } from '@/features/orders/contracts';
import { invalidateFigures } from '@/lib/figures';
import type {
  Commune,
  CopyRatesDiff,
  CopyRatesInput,
  CourierAccount,
  CourierInput,
  CourierPatch,
  CourierProviderInfo,
  CourierRates,
  CourierTestResult,
  DeliveryOverview,
  DeliveryRow,
  FailureReason,
  FeeGridMeta,
  FeeQuote,
  FeeRule,
  FeeRuleInput,
  LabelFile,
  LabelFormat,
  LabelsInput,
  MarkDeliveredInput,
  MarkReturnedInput,
  ProductLabelsInput,
  SendInput,
  Shipment,
  ShipmentUpdatedEvent,
  ShipmentsPage,
  Stopdesk,
  TrackingPublic,
  TrackingReportInput,
  Wilaya,
} from './contracts';

/** `GET /delivery/fees` and `POST /delivery/fees/seed` answer the whole grid (69 rows) + its counters. */
export type FeeGrid = { rows: FeeRule[]; meta: FeeGridMeta & { written?: number } };
const grid = async (p: Promise<{ data: FeeRule[]; meta: unknown }>): Promise<FeeGrid> => {
  const r = await p;
  const m = (r.meta ?? {}) as Partial<FeeGrid['meta']>;
  return { rows: r.data ?? [], meta: { freeDeliveryThreshold: m.freeDeliveryThreshold ?? null, custom: m.custom ?? 0, inactive: m.inactive ?? 0, missing: m.missing ?? 0, written: m.written } };
};

export const deliveryApi = {
  /* geo (public, cached 24 h by the API) */
  wilayas: () => api<Wilaya[]>('/geo/wilayas'),
  communes: (wilayaId: number) => api<Commune[]>(`/geo/wilayas/${wilayaId}/communes`),
  stopdesks: (q: { communeId: number; provider?: string }) => api<Stopdesk[]>('/delivery/stopdesks', { query: q }),

  /* fee grid (DLV-01/02) */
  fees: () => grid(apiRaw<FeeRule[]>('/delivery/fees')),
  saveFee: (wilayaId: number, b: FeeRuleInput) => api<FeeRule>(`/delivery/fees/${wilayaId}`, { method: 'PUT', body: b }),
  /** back to the default prices; `422 FEE_RULE_NOT_FOUND` when the row is not custom */
  resetFee: (wilayaId: number) => api<FeeRule>(`/delivery/fees/${wilayaId}`, { method: 'DELETE' }),
  /** `overwrite: false` = "Compléter les manquants", `true` = "Tout réinitialiser" */
  seedFees: (overwrite: boolean) => grid(apiRaw<FeeRule[]>('/delivery/fees/seed', { method: 'POST', body: { overwrite } })),
  quote: (q: { wilayaId: number; stopdesk: boolean; subtotal: number }) => api<FeeQuote>('/delivery/fees/quote', { query: q }),

  /* couriers (DLV-03) */
  providers: () => api<CourierProviderInfo[]>('/delivery/couriers/providers'),
  couriers: () => api<CourierAccount[]>('/delivery/couriers'),
  createCourier: (b: CourierInput) => api<CourierAccount>('/delivery/couriers', { method: 'POST', body: b }),
  updateCourier: (id: string, b: CourierPatch) => api<CourierAccount>(`/delivery/couriers/${id}`, { method: 'PATCH', body: b }),
  /** `409 COURIER_HAS_ACTIVE_SHIPMENTS {count}` while parcels are on the way ⇒ "Désactiver" */
  deleteCourier: (id: string) => api<null>(`/delivery/couriers/${id}`, { method: 'DELETE' }),
  /** the provider is called (≤ 10 s); a refused / unreachable courier answers 200 with `ok: false` + `error` */
  testCourier: (id: string) => api<CourierTestResult>(`/delivery/couriers/${id}/test`, { method: 'POST', body: {} }),
  rates: (q: { courierAccountId: string; wilayaId?: number; stopdesk?: boolean }) => api<CourierRates>('/delivery/rates', { query: q }),
  copyFromCourier: (b: CopyRatesInput) => api<CopyRatesDiff>('/delivery/fees/copy-from-courier', { method: 'POST', body: b }),

  /* overview + shipments (DLV-04/05/08) */
  overview: () => api<DeliveryOverview>('/delivery/overview'),
  shipments: async (q: ApiQuery): Promise<ShipmentsPage> => {
    const r = await apiRaw<DeliveryRow[]>('/shipments', { query: q });
    return { rows: r.data ?? [], total: r.meta?.total ?? r.data?.length ?? 0, meta: r.meta ?? {} };
  },
  shipment: (id: string) => api<Shipment>(`/shipments/${id}`),
  /** M6 carry-over → M8: "Exporter CSV" of the selection / current filter → 202 job (kind `export`) */
  exportShipments: (q: ApiQuery) => api<JobRef>('/delivery/export', { query: q }),
  orderShipments: (orderId: string) => api<Shipment[]>(`/orders/${orderId}/shipments`),
  /** one parcel from the order (Idempotency-Key required) → 202 ShipmentView `pending` ("sending…" until WS `shipment.updated`) */
  send: (orderId: string, b: SendInput, key: string) => api<Shipment>(`/orders/${orderId}/shipments`, { method: 'POST', body: b, idempotent: key }),
  /** many orders, one courier (Idempotency-Key required) → 202 job, `result` = BulkSendResult */
  sendBulk: (b: { orderIds: string[]; courierAccountId?: string | null }, key: string) => api<JobRef>('/shipments/bulk', { method: 'POST', body: b, idempotent: key }),
  /** `429 TRACKING_SYNC_RATE_LIMITED {retryAfter}` within 5 min */
  sync: (id: string) => api<Shipment>(`/shipments/${id}/sync`, { method: 'POST' }),
  syncBulk: (ids: string[]) => api<JobRef>('/shipments/bulk/sync', { method: 'POST', body: { ids } }),
  retry: (id: string) => api<Shipment>(`/shipments/${id}/retry`, { method: 'POST' }),
  retryDelivery: (id: string, note?: string | null) => api<Shipment>(`/shipments/${id}/retry-delivery`, { method: 'POST', body: { note: note ?? null } }),
  changeCourier: (id: string, courierAccountId: string) => api<Shipment>(`/shipments/${id}/change-courier`, { method: 'POST', body: { courierAccountId } }),
  cancel: (id: string, b: { then: 'confirmed' | 'cancelled'; reason?: CancelReason; note?: string | null }) => api<Shipment>(`/shipments/${id}/cancel`, { method: 'POST', body: b }),
  markFailed: (id: string, b: { reason: FailureReason; note?: string | null }) => api<Shipment>(`/shipments/${id}/mark-failed`, { method: 'POST', body: b }),
  markDelivered: (id: string, b: MarkDeliveredInput) => api<Shipment>(`/shipments/${id}/mark-delivered`, { method: 'POST', body: b }),
  markReturned: (id: string, b: Partial<MarkReturnedInput>) => api<Shipment>(`/shipments/${id}/mark-returned`, { method: 'POST', body: b }),
  shipManualBulk: (ids: string[], key: string) => bulk('/shipments/bulk/ship-manual', { ids }, key),

  /* labels (DLV-06) */
  /** courier PDF, or the Djaber label with `warnings: [LABEL_UNAVAILABLE]` when the courier gives none */
  label: async (id: string, q: { format?: LabelFormat; source?: 'auto' | 'djaber'; lang?: string } = {}): Promise<{ file: LabelFile; unavailable: boolean }> => {
    const r = await apiRaw<LabelFile>(`/shipments/${id}/label`, { query: q });
    return { file: r.data, unavailable: (r.meta?.warnings ?? []).some((w) => w.code === 'LABEL_UNAVAILABLE') || (q.source !== 'djaber' && r.data?.source === 'djaber') };
  },
  /** merged PDF of many orders → 202 job (`result` = LabelsJobResult; unsent orders skipped `SHIPMENT_NOT_CREATED`) */
  labels: (b: LabelsInput, key: string) => api<JobRef>('/shipments/labels', { method: 'POST', body: b, idempotent: key }),
  productLabels: (b: ProductLabelsInput, key: string) => api<JobRef>('/products/bulk/labels', { method: 'POST', body: b, idempotent: key }),

  /* public (no session) */
  publicTracking: (code: string) => api<TrackingPublic>(`/track/${encodeURIComponent(code)}`),
  reportMerchant: (code: string, b: TrackingReportInput) => api<{ id: string; status: string }>(`/track/${encodeURIComponent(code)}/report`, { method: 'POST', body: b }),
};

const bulk = async (path: string, body: unknown, key: string): Promise<BulkResponse> => {
  const r = await apiRaw<{ results: BulkItemResult[] } | BulkItemResult[]>(path, { method: 'POST', body, idempotent: key });
  const results = (Array.isArray(r.data) ? r.data : r.data?.results) ?? [];
  const m = r.meta as Meta & { ok?: number; failed?: number };
  return { results, ok: m?.ok ?? results.filter((x) => x.ok).length, failed: m?.failed ?? results.filter((x) => !x.ok && !x.skipped).length };
};

export const deliveryKeys = {
  wilayas: () => ['session', 'wilayas'] as const,
  communes: (wilayaId: number) => ['session', 'communes', wilayaId] as const,
  stopdesks: (ws: string, communeId: number, provider?: string) => [ws, 'stopdesks', communeId, provider ?? ''] as const,
  fees: (ws: string) => [ws, 'delivery', 'fees'] as const,
  quote: (ws: string, q: { wilayaId: number; stopdesk: boolean; subtotal: number }) => [ws, 'delivery', 'quote', q] as const,
  couriers: (ws: string) => [ws, 'delivery', 'couriers'] as const,
  providers: () => ['session', 'courier-providers'] as const,
  rates: (ws: string, q: { courierAccountId: string; wilayaId?: number; stopdesk?: boolean }) => [ws, 'delivery', 'rates', q] as const,
  overview: (ws: string) => [ws, 'delivery', 'overview'] as const,
  shipments: (ws: string, q?: ApiQuery) => (q ? ([ws, 'shipments', 'list', q] as const) : ([ws, 'shipments', 'list'] as const)),
  shipment: (ws: string, id: string) => [ws, 'shipments', 'one', id] as const,
  allShipments: (ws: string) => [ws, 'shipments'] as const,
};

export const useCouriers = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.couriers(ws), queryFn: deliveryApi.couriers, enabled: !!ws && enabled, staleTime: 30_000 });
};
export const useCourierProviders = (enabled = true) => useQuery({ queryKey: deliveryKeys.providers(), queryFn: deliveryApi.providers, enabled, staleTime: 3_600_000 });
/**
 * Courier live rates (cached 1 h by the API). A cold cache answers `refreshing: true` (the worker fetches the rates):
 * the query is read again every 4 s until it is filled.
 */
export const useCourierRates = (q: { courierAccountId: string | null; wilayaId?: number | null; stopdesk?: boolean }, enabled = true) => {
  const ws = useWorkspaceId();
  const key = { courierAccountId: q.courierAccountId ?? '', ...(q.wilayaId ? { wilayaId: q.wilayaId } : {}), ...(q.stopdesk !== undefined ? { stopdesk: q.stopdesk } : {}) };
  return useQuery({
    queryKey: deliveryKeys.rates(ws, key),
    queryFn: () => deliveryApi.rates(key),
    enabled: !!ws && enabled && !!q.courierAccountId,
    staleTime: 3_600_000,
    retry: false,
    refetchInterval: (query) => (query.state.data?.refreshing ? 4_000 : false),
  });
};
export const useDeliveryOverview = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.overview(ws), queryFn: deliveryApi.overview, enabled: !!ws && enabled });
};
export const useShipments = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.shipments(ws, q), queryFn: () => deliveryApi.shipments(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useShipment = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.shipment(ws, id ?? ''), queryFn: () => deliveryApi.shipment(id!), enabled: !!ws && !!id, retry: (n, e) => n < 2 && !(e as { status?: number })?.status });
};

/** After a delivery write: overview, lists, the parcel, the orders (status / delivery pill) and the home queue. */
export function useDeliveryRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    (o: { shipment?: Shipment | null; orderId?: string } = {}) => {
      if (o.shipment) qc.setQueryData(deliveryKeys.shipment(ws, o.shipment.id), o.shipment);
      const orderId = o.orderId ?? o.shipment?.orderId;
      return Promise.all([
        qc.invalidateQueries({ queryKey: deliveryKeys.allShipments(ws) }),
        qc.invalidateQueries({ queryKey: deliveryKeys.overview(ws) }),
        qc.invalidateQueries({ queryKey: deliveryKeys.couriers(ws) }),
        qc.invalidateQueries({ queryKey: [ws, 'orders'] }),
        invalidateFigures(qc, ws),
        ...(orderId ? [qc.invalidateQueries({ queryKey: [ws, 'order', orderId] })] : []),
      ]);
    },
    [ws, qc],
  );
}

/** WS `shipment.updated { shipment }` (03-events §2): the parcel, the lists, the overview and its order are re-read. */
export function useShipmentEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  useWsEvent<ShipmentUpdatedEvent>('shipment.updated', (p) => {
    const s = p?.shipment;
    if (!s?.id) return;
    void qc.invalidateQueries({ queryKey: deliveryKeys.shipment(ws, s.id) });
    void qc.invalidateQueries({ queryKey: deliveryKeys.shipments(ws) });
    void qc.invalidateQueries({ queryKey: deliveryKeys.overview(ws) });
    if (s.orderId) void qc.invalidateQueries({ queryKey: [ws, 'order', s.orderId] });
    void qc.invalidateQueries({ queryKey: [ws, 'orders'] });
  });
  // api-contract §3.8: `courier.updated { id, reason }` (account created / updated / deleted / rates)
  useWsEvent<{ id?: string }>('courier.updated', () => {
    void qc.invalidateQueries({ queryKey: deliveryKeys.couriers(ws) });
    void qc.invalidateQueries({ queryKey: [ws, 'delivery', 'rates'] });
    void qc.invalidateQueries({ queryKey: deliveryKeys.overview(ws) });
  });
}

const DAY = 24 * 3600 * 1000;
/** Same cache entry as `useWilayas` of the workspace feature (reference data, one fetch per session). */
export const useGeoWilayas = () => useQuery({ queryKey: deliveryKeys.wilayas(), queryFn: deliveryApi.wilayas, staleTime: DAY });
export const useCommunes = (wilayaId: number | null | undefined) =>
  useQuery({ queryKey: deliveryKeys.communes(wilayaId ?? 0), queryFn: () => deliveryApi.communes(wilayaId!), enabled: !!wilayaId, staleTime: DAY });
export const useStopdesks = (communeId: number | null | undefined, provider?: string) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.stopdesks(ws, communeId ?? 0, provider), queryFn: () => deliveryApi.stopdesks({ communeId: communeId!, provider }), enabled: !!ws && !!communeId, staleTime: 3600 * 1000, retry: false });
};
export const useFees = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: deliveryKeys.fees(ws), queryFn: deliveryApi.fees, enabled: !!ws && enabled });
};
/** Fee quote of the order form / address dialog; the previous quote stays on screen while the next one loads. */
export const useFeeQuote = (q: { wilayaId: number | null; stopdesk: boolean; subtotal: number }) => {
  const ws = useWorkspaceId();
  const key = { wilayaId: q.wilayaId ?? 0, stopdesk: q.stopdesk, subtotal: q.subtotal };
  return useQuery({ queryKey: deliveryKeys.quote(ws, key), queryFn: () => deliveryApi.quote(key), enabled: !!ws && !!q.wilayaId, placeholderData: keepPreviousData, staleTime: 30_000 });
};
