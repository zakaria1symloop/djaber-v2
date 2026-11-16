// /delivery — URL state definition (api-contract §4 `ShipmentsQuery`, 06 §10 "Livraison & suivi [MECH Delivery]").
// The tab IS a filter preset (`DELIVERY_TABS` of the shared schema): `?tab=no_movement` ⇒ `lastEvent=gt5d_stale`.
// Pure functions (unit tested); the page wires them to `useListState`.
import type { ApiQuery, ListSpec, ListState } from '@/lib/list-state';
import { filterList, filterText } from '@/lib/list-state';
import type { DeliveryTab } from './contracts';

export const DELIVERY_TAB_LIST = ['failed', 'no_movement', 'to_send', 'in_transit', 'returns', 'all'] as const satisfies readonly DeliveryTab[];
/** Same presets as `DELIVERY_TABS` (packages/shared/src/schemas/delivery.ts). */
export const TAB_PRESETS: Record<DeliveryTab, ApiQuery> = {
  failed: { shipmentStatus: ['failed'] },
  no_movement: { lastEvent: 'gt5d_stale' },
  to_send: { shipmentStatus: ['not_sent'] },
  in_transit: { shipmentStatus: ['pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery'] },
  returns: { shipmentStatus: ['returned'] },
  all: {},
};
export const SHIPMENT_FILTER_STATUSES = ['not_sent', 'pending', 'sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled', 'stale'] as const;
export const LAST_EVENTS = ['lt24h', '2_5d', 'gt5d_stale'] as const;
export const LAST_ERRORS = ['COURIER_VALIDATION', 'COURIER_CREDENTIALS_INVALID', 'COURIER_UNAVAILABLE', 'TRACKING_NOT_FOUND'] as const;
export const DELIVERY_SORTS = ['lastEventAt', 'lastSyncedAt', 'createdAt', 'orderNumber'] as const;

export const DELIVERY_LIST: ListSpec = {
  filters: {
    shipmentStatus: 'list',
    provider: 'list',
    courierAccountId: 'list',
    deliveryType: 'text',
    wilayaId: 'list',
    orderStatus: 'list',
    lastEvent: 'text',
    failureReason: 'list',
    lastError: 'list',
    from: 'date',
    to: 'date',
    ids: 'list',
  },
  sorts: DELIVERY_SORTS,
  // full-test DELIVERY-11: « Dernier événement ↓ » (lastSyncedAt is null for manual / never-synced parcels)
  defaultSort: '-lastEventAt',
  tabs: DELIVERY_TAB_LIST,
};

/** No tab in the URL = "Échecs" (first tab of DLV-08). */
export const currentTab = (s: Pick<ListState, 'tab'>): DeliveryTab => ((DELIVERY_TAB_LIST as readonly string[]).includes(s.tab ?? '') ? (s.tab as DeliveryTab) : 'failed');

/** Query of `GET /shipments`: the tab preset replaces the same keys of the panel filters. */
export function shipmentsQuery(base: ApiQuery, tab: DeliveryTab): ApiQuery {
  const q: ApiQuery = { ...base, ...TAB_PRESETS[tab] };
  if (q.deliveryType !== undefined && q.deliveryType !== 'home' && q.deliveryType !== 'stopdesk') delete q.deliveryType;
  if (q.lastEvent !== undefined && !(LAST_EVENTS as readonly string[]).includes(String(q.lastEvent))) delete q.lastEvent;
  return q;
}

/* ---------- active chips ---------- */
export type DeliveryChipLabels = {
  search: (q: string) => string;
  status: Record<string, string>;
  provider: Record<string, string>;
  courier: (id: string) => string;
  deliveryType: Record<string, string>;
  wilaya: (names: string) => string;
  wilayaName: (id: string) => string;
  orderStatus: Record<string, string>;
  lastEvent: Record<string, string>;
  failureReason: Record<string, string>;
  lastError: (code: string) => string;
  range: (from: string, to: string) => string;
  ids: (n: number) => string;
};
export type Chip = { key: string; label: string; clear: Record<string, null> | 'q' };

export function deliveryChips(s: ListState, l: DeliveryChipLabels): Chip[] {
  const chips: Chip[] = [];
  if (s.q.trim()) chips.push({ key: 'q', label: l.search(s.q.trim()), clear: 'q' });
  for (const v of filterList(s, 'shipmentStatus')) chips.push({ key: `shipmentStatus:${v}`, label: l.status[v] ?? v, clear: { shipmentStatus: null } });
  for (const v of filterList(s, 'provider')) chips.push({ key: `provider:${v}`, label: l.provider[v] ?? v, clear: { provider: null } });
  for (const v of filterList(s, 'courierAccountId')) chips.push({ key: `courierAccountId:${v}`, label: l.courier(v), clear: { courierAccountId: null } });
  const type = filterText(s, 'deliveryType');
  if (type === 'home' || type === 'stopdesk') chips.push({ key: 'deliveryType', label: l.deliveryType[type] ?? type, clear: { deliveryType: null } });
  const wilayas = filterList(s, 'wilayaId');
  if (wilayas.length) chips.push({ key: 'wilayaId', label: l.wilaya(wilayas.map(l.wilayaName).join(', ')), clear: { wilayaId: null } });
  for (const v of filterList(s, 'orderStatus')) chips.push({ key: `orderStatus:${v}`, label: l.orderStatus[v] ?? v, clear: { orderStatus: null } });
  const ev = filterText(s, 'lastEvent');
  if (ev) chips.push({ key: 'lastEvent', label: l.lastEvent[ev] ?? ev, clear: { lastEvent: null } });
  for (const v of filterList(s, 'failureReason')) chips.push({ key: `failureReason:${v}`, label: l.failureReason[v] ?? v, clear: { failureReason: null } });
  for (const v of filterList(s, 'lastError')) chips.push({ key: `lastError:${v}`, label: l.lastError(v), clear: { lastError: null } });
  const from = filterText(s, 'from');
  const to = filterText(s, 'to');
  if (from || to) chips.push({ key: 'from', label: l.range(from, to), clear: { from: null, to: null } });
  const ids = filterList(s, 'ids');
  if (ids.length) chips.push({ key: 'ids', label: l.ids(ids.length), clear: { ids: null } });
  return chips;
}

/** Number of filters set in the panel (the tab is not one: it always exists on this screen). */
export const panelFilterCount = (s: ListState): number => Object.keys(s.filters).length + (s.q.trim() ? 1 : 0);
