// Delivery — pure helpers of the overview, tracking panel, couriers page, send dialog, labels and the public page
// (unit tested in logic.spec.ts). The UI never decides a shipment transition: the server `actions` do.
import { isOrderSendClosed, parcelStatusKey, type ActionDescriptor, type OrderSendClosedStatus } from '@djaber/shared';
import type { Tone } from '@djaber/ui';
import { algiersTime } from '@/features/orders/logic';
import type { BulkSendRow, ShipmentStatus } from './contracts';

export const algiersClock = algiersTime;

/**
 * journey 16/11 J05-3: the geo pickers search without accents, case, hyphens or Arabic vowel marks — « Sétif » finds the
 * commune spelled « Setif », « bejaia » finds « Béjaïa », « bordj bou » finds « Bordj-Bou-Arreridj ».
 */
export const foldGeo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .toLowerCase()
    .replace(/[-'’ʼ`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** journey J14-5: `keywords` = the other-language name (« Boufarik » finds « بوفاريك » in the Arabic UI) */
export const geoFilter = <T extends { label: string; hint?: string; keywords?: string }>(options: T[], q: string): T[] => {
  const needle = foldGeo(q);
  return needle ? options.filter((o) => foldGeo(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`).includes(needle)) : options;
};

/* ---------- parcel timeline order (journey 16/11 J05-17) ---------- */
const STAGE: Record<string, number> = { pending: 0, sent: 1, picked_up: 2, in_transit: 3, out_for_delivery: 4, stale: 4, failed: 5, delivered: 6, returned: 7, cancelled: 8 };
/**
 * Newest first. Events of the same minute follow the parcel's life (a « Livré » dated with the minute picked in the dialog
 * came after « Expédition créée » of the same minute, never before it): later stage first, then the exact time.
 */
export const timelineOrder = <T extends { at: string; mappedStatus?: string | null }>(events: readonly T[]): T[] =>
  [...events].sort((a, b) => {
    const ma = Math.floor(Date.parse(a.at) / 60_000);
    const mb = Math.floor(Date.parse(b.at) / 60_000);
    if (ma !== mb) return mb - ma;
    const sa = STAGE[a.mappedStatus ?? ''] ?? -1;
    const sb = STAGE[b.mappedStatus ?? ''] ?? -1;
    return sa !== sb ? sb - sa : Date.parse(b.at) - Date.parse(a.at);
  });

/* ---------- LIVRAISON block of the order page (UX-064) ---------- */
/**
 * What the order's LIVRAISON block shows for its current parcel. `handled` (server `failureHandled`): the order was
 * delivered / cancelled / returned while the parcel had failed — no open failure, no « Corriger et renvoyer ».
 * `showSend`: the send / self-delivery buttons, never on a delivered / cancelled / returned order (same shared rule as
 * the server, which greys `send_courier` / `ship_manual` with `DELIVERY_ORDER_<STATUS>` in the menus).
 */
export function deliveryBlockState(
  orderStatus: string,
  parcel: { status: ShipmentStatus; trackingNumber: string | null; provider?: string | null; failureHandled?: OrderSendClosedStatus | null } | null,
): { handled: OrderSendClosedStatus | null; openFailure: boolean; fixable: boolean; showSend: boolean } {
  const handled = parcel?.status === 'failed' ? (parcel.failureHandled ?? null) : null;
  const openFailure = parcel?.status === 'failed' && !handled;
  // journey J08-4: a self-delivered parcel without a tracking number that failed is a failed delivery attempt (the parcel
  // exists, the order is shipped) — only a courier parcel without tracking is a failed send (« rien n'a été créé »)
  const fixable = openFailure && !parcel?.trackingNumber && parcel?.provider !== 'manual';
  return { handled, openFailure, fixable, showSend: !isOrderSendClosed(orderStatus) && (!parcel || fixable) };
}

/**
 * i18n key of a parcel status pill. A self-delivered parcel (`provider=manual`, 04 §1.2) that is `sent` is on its way
 * with the merchant — « ENVOYÉE », not the courier wording « CRÉÉE » (parcel created, waiting for pickup; full-test ORDERS-23).
 */
export const shipmentStatusKey = (s: { status: ShipmentStatus; provider?: string | null }): string => parcelStatusKey(s.status, s.provider); // journey J08v-1: the shared mapping

/**
 * 12 §20 « Send dialog without courier » (full-test DELIVERY-04): a member who manages the couriers (`delivery.manage`)
 * opens « Envoyer au transporteur » even without an active courier — the dialog offers « Configurer un transporteur » there.
 * Every other refusal (and every other member) keeps the greyed item with its reason.
 */
export function withCourierSetup(actions: readonly ActionDescriptor[], canManage: boolean): ActionDescriptor[] {
  if (!canManage) return [...actions];
  return actions.map((a) => {
    if (a.key !== 'send_courier' || a.reasonCode !== 'DELIVERY_NO_COURIER') return a;
    const { reasonCode: _c, reasonParams: _r, ...rest } = a;
    return { ...rest, enabled: true };
  });
}

/* ---------- public page steps: Créée → Ramassée → En transit → En livraison → Livrée ---------- */
const FLOW = ['sent', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const;
export type FlowKey = (typeof FLOW)[number] | 'failed' | 'returned' | 'cancelled';
export function parcelSteps(status: ShipmentStatus, o: { selfDelivery?: boolean } = {}): { key: FlowKey; state: 'done' | 'current' | 'upcoming' | 'failed' }[] {
  // journey J08-12 #9: a parcel the merchant delivers himself is never « Ramassée » by a courier
  const flow: readonly (typeof FLOW)[number][] = o.selfDelivery ? FLOW.filter((k) => k !== 'picked_up') : FLOW;
  if (status === 'failed' || status === 'returned' || status === 'cancelled') {
    // the last step of the bar becomes the end of the parcel; the steps before stay done
    return [...flow.slice(0, flow.length - 1).map((key) => ({ key, state: 'done' as const })), { key: status, state: 'failed' as const }];
  }
  const at = status === 'pending' ? -1 : status === 'stale' ? flow.indexOf('in_transit') : status === 'picked_up' && o.selfDelivery ? flow.indexOf('in_transit') : flow.indexOf(status as (typeof FLOW)[number]);
  return flow.map((key, i) => ({ key, state: i < at || (status === 'delivered' && i === at) ? 'done' : i === at ? 'current' : 'upcoming' }));
}
/** Dot / tone of a mapped status (timeline). */
export function shipmentTone(status: ShipmentStatus | null | undefined): Tone | undefined {
  switch (status) {
    case 'delivered':
      return 'success';
    case 'failed':
    case 'returned':
      return 'danger';
    case 'stale':
    case 'pending':
      return 'warning';
    case 'sent':
    case 'picked_up':
    case 'in_transit':
    case 'out_for_delivery':
      return 'info';
    default:
      return undefined;
  }
}

/* ---------- "Actualiser" (1 / 5 min / shipment, api-contract §1.9) ---------- */
/** Seconds before the next manual sync is allowed (0 = now). */
export function syncWait(syncAvailableAt: string | null | undefined, now = Date.now()): number {
  if (!syncAvailableAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(syncAvailableAt) - now) / 1000));
}
/**
 * UX-056 leftovers (14/11): the « Actualiser » item of a parcel menu at this instant — greyed with the live wait
 * (`TRACKING_SYNC_RATE_LIMITED {retryAfter}`) while the 5-minute wait lasts, offered again once it is over. Only the wait is
 * applied here: any other refusal of the server (permission, parcel not created…) stays as it is.
 */
export function withSyncWait(actions: readonly ActionDescriptor[], wait: number): ActionDescriptor[] {
  return actions.map((a) => {
    if (a.key !== 'sync') return a;
    const limited = a.reasonCode === 'TRACKING_SYNC_RATE_LIMITED';
    if (wait > 0 && (a.enabled || limited)) {
      const { primary: _p, ...rest } = a;
      return { ...rest, enabled: false, reasonCode: 'TRACKING_SYNC_RATE_LIMITED', reasonParams: { retryAfter: wait } };
    }
    if (wait <= 0 && limited) {
      const { reasonCode: _c, reasonParams: _r, ...rest } = a;
      return { ...rest, enabled: true };
    }
    return a;
  });
}
/** End of the wait (epoch ms) from what the server said and what this tab learnt since (a refresh, a 429); null = none. */
export function syncUntil(serverIso: string | null | undefined, local: number | null | undefined): number | null {
  const server = serverIso ? Date.parse(serverIso) : NaN;
  const until = Math.max(Number.isNaN(server) ? 0 : server, local ?? 0);
  return until > 0 ? until : null;
}
/** "4 min" / "45 s" (shared with every disabled reason that carries a wait — lib/time). */
export { waitLabel } from '@/lib/time';

/** Days since an ISO instant (whole days, floor). */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}

/* ---------- couriers: per-provider credential fields (`GET /delivery/couriers/providers`, 05-integrations §2.1) ---------- */
export type CredentialField = { name: string; secret: boolean; url?: boolean };
/** `https://<instance>.ecotrack.dz` (HTTPS URL; the exact instance is validated by the API and the connection test). */
export const isHttpsUrl = (v: string): boolean => {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
};
/**
 * Missing / invalid credential fields of the add / edit form. On edit, empty fields keep the stored credentials:
 * only a partially filled set is refused (the API replaces all the fields of a provider at once).
 */
export function credentialErrors(fields: CredentialField[], values: Record<string, string>, editing: boolean): Record<string, 'validation.required' | 'validation.url'> {
  const out: Record<string, 'validation.required' | 'validation.url'> = {};
  const filled = fields.filter((f) => (values[f.name] ?? '').trim() !== '');
  const keep = editing && filled.length === 0;
  for (const f of fields) {
    const v = (values[f.name] ?? '').trim();
    if (!v && !keep) out[f.name] = 'validation.required';
    else if (v && f.url && !isHttpsUrl(v)) out[f.name] = 'validation.url';
  }
  return out;
}

/* ---------- send dialog ---------- */
/** Field of the dialog that a `COURIER_VALIDATION { field }` error points at (05-integrations §2.1 CourierError.field). */
export function courierErrorField(field: unknown): 'commune' | 'address' | 'wilaya' | 'phone' | 'weight' | 'cod' | 'stopdesk' | null {
  const f = typeof field === 'string' ? field : '';
  if (f === 'stopdeskId' || f === 'stopdesk') return 'stopdesk';
  if (f === 'communeId' || f === 'communeText' || f === 'commune') return 'commune';
  if (f === 'wilayaId' || f === 'wilaya') return 'wilaya';
  if (f === 'phone' || f === 'address' || f === 'weight' || f === 'cod') return f;
  if (f === 'weightKg') return 'weight';
  if (f === 'codAmount') return 'cod';
  return null;
}
/** "0,8" / "0.8" → 0.8; '' → undefined; anything else → NaN (validation). */
export function parseWeight(v: string): number | undefined {
  const s = v.trim().replace(',', '.');
  if (!s) return undefined;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s);
}
/** `3.8` days → "3,8 j" (fr/ar) / "3.8 d" (en). */
export function daysLabel(days: number | null | undefined, unit: string, locale: string): string | null {
  if (days === null || days === undefined) return null;
  const n = Math.round(days * 10) / 10;
  return `${locale === 'en' ? String(n) : String(n).replace('.', ',')} ${unit}`;
}

/* ---------- bulk send results (MECH): OK · queued (courier down, retries) · ignored (already sent) · failed ---------- */
export type BulkRowState = 'ok' | 'queued' | 'ignored' | 'failed';
export const bulkRowState = (r: Pick<BulkSendRow, 'ok' | 'data' | 'error'>): BulkRowState =>
  r.ok ? (r.data?.status === 'pending' ? 'queued' : 'ok') : r.error?.code === 'DELIVERY_ORDER_ALREADY_SENT' ? 'ignored' : r.error?.code === 'COURIER_UNAVAILABLE' ? 'queued' : 'failed';
