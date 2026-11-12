// Orders — pure helpers of the list, the order page and the dialogs (unit tested in logic.spec.ts).
// The UI never decides a status transition (04 §1: the server `actions` do); these helpers only format and derive.
import { TIMEZONE } from '@djaber/shared';
import type { BulkResponse, ConfirmationStatus, DeliveryStatus, Order, OrderHistoryRow, OrderListItem, OrderStats, OrderStatus, ShipmentStatus, SourceBadge } from './contracts';
import { ORDER_READ_ONLY_STATUSES } from './contracts';

/* ---------- time (Africa/Algiers, UTC+1 all year) ---------- */
const ALGIERS_OFFSET = '+01:00';
/** `YYYY-MM-DD` of an instant in Africa/Algiers. */
export const algiersDay = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** `16:00` in Africa/Algiers. */
export const algiersTime = (iso: string | Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(typeof iso === 'string' ? new Date(iso) : iso);
const shiftDay = (day: string, delta: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
/** Instant of a wall-clock time in Algiers (`2026-10-12`, `16:00`). */
export const algiersInstant = (day: string, time: string): Date => new Date(`${day}T${time}:00${ALGIERS_OFFSET}`);
/** Value of an `<input type="datetime-local">` read as Algiers time → ISO with offset; '' → null. */
export const localInputToIso = (value: string): string | null => (value ? new Date(`${value}:00${ALGIERS_OFFSET}`).toISOString() : null);
/** ISO → `YYYY-MM-DDTHH:mm` (Algiers) for a datetime-local input. */
export const isoToLocalInput = (iso: string | Date): string => {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${algiersDay(d)}T${algiersTime(d)}`;
};

/* ---------- callback presets (DLG "Programmer un rappel": Dans 1 h · Cet après-midi 16:00 · Demain 10:00 · choisir) ---------- */
export type CallbackPreset = { key: 'in1h' | 'today16' | 'tomorrow10'; at: Date };
export function callbackPresets(now = new Date()): CallbackPreset[] {
  const today = algiersDay(now);
  const inOneHour = new Date(now.getTime() + 3_600_000);
  inOneHour.setSeconds(0, 0);
  const out: CallbackPreset[] = [{ key: 'in1h', at: inOneHour }];
  // "cet après-midi 16:00" only while 16:00 is still more than 30 min away
  if (algiersInstant(today, '16:00').getTime() - now.getTime() > 30 * 60_000) out.push({ key: 'today16', at: algiersInstant(today, '16:00') });
  out.push({ key: 'tomorrow10', at: algiersInstant(shiftDay(today, 1), '10:00') });
  return out;
}

/* ---------- pills ---------- */
/** "RAPPEL 16:00" (another day: "RAPPEL 13/10 10:00"), "SANS RÉPONSE 2/3", the plain label otherwise. */
export function confirmationPillParams(row: Pick<OrderListItem, 'confirmationStatus' | 'callAttempts' | 'callbackAt'>, now = new Date()): { key: string; params: Record<string, string | number> } {
  const key = `enum.Order.confirmationStatus.${row.confirmationStatus}`;
  if (row.confirmationStatus === 'callback' && row.callbackAt) {
    const at = new Date(row.callbackAt);
    const sameDay = algiersDay(at) === algiersDay(now);
    const day = algiersDay(at);
    return { key, params: { time: sameDay ? algiersTime(at) : `${day.slice(8, 10)}/${day.slice(5, 7)} ${algiersTime(at)}` } };
  }
  if (row.confirmationStatus === 'no_answer') return { key, params: { attempts: Math.max(1, row.callAttempts) } };
  return { key, params: {} };
}

/**
 * LIVRAISON column: the parcel status when a shipment exists (`ShipmentStatus`, provider suffix "EN TRANSIT · ZR"),
 * else the order delivery status (NON ENVOYÉE / À ENVOYER …). `stale` parcels read "SANS MOUVEMENT".
 */
export function deliveryPill(row: Pick<OrderListItem, 'deliveryStatus' | 'shipment' | 'status'>): { enumKey: 'Shipment.status' | 'Order.deliveryStatus'; value: string; labelKey: string; provider: string | null } {
  if (row.shipment) {
    const value: ShipmentStatus = row.shipment.stale ? 'stale' : row.shipment.status;
    const provider = row.shipment.provider && row.shipment.provider !== 'manual' && (value === 'in_transit' || value === 'out_for_delivery') ? row.shipment.provider : null;
    return { enumKey: 'Shipment.status', value, labelKey: `enum.Shipment.status.${value}`, provider };
  }
  const value: DeliveryStatus = row.deliveryStatus;
  const labelKey = value === 'not_sent' || value === 'pending' ? `enum.Order.deliveryStatus.${value}` : `enum.Shipment.status.${value === 'sent' ? 'sent' : value}`;
  return { enumKey: 'Order.deliveryStatus', value, labelKey, provider: null };
}

/** Short courier name of the pill suffix: `zrexpress` → `ZR`. */
export const courierShort = (provider: string): string => ({ zrexpress: 'ZR', ecotrack: 'ECOTRACK', yalidine: 'YALIDINE', manual: '' })[provider] ?? provider.toUpperCase();

/** Second line of the SOURCE cell: agent · canal (IA), member (manual / mobile), key name (API), file (import). */
export function sourceDetail(s: SourceBadge, o: { member: (u: { firstName: string; lastName: string }) => string; platform: (p: string) => string; date: (iso: string) => string }): string {
  switch (s.source) {
    case 'ai':
      return [s.agent?.name, s.channel ? o.platform(s.channel.platform) : null].filter(Boolean).join(' · ');
    case 'manual':
    case 'mobile':
      return s.user ? o.member(s.user) : '';
    case 'api':
      return s.apiKeyName ?? '';
    case 'import':
      return [s.importFileName, s.importedAt ? o.date(s.importedAt) : null].filter(Boolean).join(' · ');
    default:
      return '';
  }
}

/** "Sara K." */
export const shortName = (u: { firstName: string; lastName: string } | null | undefined): string => (u ? `${u.firstName}${u.lastName ? ` ${u.lastName.slice(0, 1)}.` : ''}` : '');

/** "Parfum Oud ×2" + "+ 1 article" */
export function itemsSummary(items: OrderListItem['items'], itemCount: number): { first: string; more: number } {
  const first = items[0];
  if (!first) return { first: '', more: 0 };
  const label = `${first.name}${first.variant ? ` ${first.variant}` : ''}${first.qty > 1 ? ` ×${first.qty}` : ''}`;
  return { first: label, more: Math.max(0, itemCount - 1) };
}

/* ---------- order page ---------- */
export const isReadOnly = (status: OrderStatus): boolean => ORDER_READ_ONLY_STATUSES.includes(status);

/** 04 §1.6: confirming needs the wilaya, the commune and an address (or a stop-desk). */
export function addressMissing(o: Pick<Order, 'address'>): boolean {
  const a = o.address;
  if (!a || !a.wilayaId) return true;
  if (!a.communeId && !a.communeText) return true;
  if (a.isStopdesk) return false;
  return (a.address ?? '').trim().length < 10;
}
export type AddressCheck = { address: boolean; wilaya: boolean; phone: boolean };
export function confirmChecks(o: Pick<Order, 'address' | 'clientPhone'>): AddressCheck {
  return { address: !addressMissing(o), wilaya: !!o.address?.wilayaId, phone: /^0\d{8,9}$/.test(o.clientPhone ?? '') };
}

/** Calls without answer before this one (confirm dialog "2 appels précédents sans réponse"). */
export const unansweredCalls = (o: Pick<Order, 'calls'>): number => o.calls.filter((c) => c.result === 'no_answer' || c.result === 'busy' || c.result === 'voicemail').length;

/** Value labels of a history row: status-like fields read through the enum catalogue. */
const ENUM_FIELDS: Record<string, string> = {
  status: 'enum.Order.status',
  confirmationStatus: 'enum.Order.confirmationStatus',
  paymentStatus: 'enum.Order.paymentStatus',
  deliveryStatus: 'enum.Order.deliveryStatus',
  paymentMethod: 'enum.Order.paymentMethod',
  cancelReason: 'enum.Order.cancelReason',
};
export function historyValue(field: string, value: string | null, has: (key: string) => boolean): { key: string | null; raw: string | null } {
  if (value === null || value === '') return { key: null, raw: null };
  const prefix = ENUM_FIELDS[field];
  if (prefix) {
    const key = `${prefix}.${value}`;
    if (has(key)) return { key, raw: null };
    if (field === 'deliveryStatus' && has(`enum.Shipment.status.${value}`)) return { key: `enum.Shipment.status.${value}`, raw: null };
  }
  return { key: null, raw: value };
}
/**
 * UX-059 (retest 12/11): the reason of a history line in words — « changed_mind » → « Le client a changé d'avis »,
 * « COURIER_VALIDATION » → « Refusée par le transporteur (données) », « parcel_cancelled » → « colis annulé ». A member's
 * note stays as typed; a code nobody can name is left out. The server joins reason and note with « · ».
 */
const REASON_KEYS = ['enum.Order.cancelReason', 'enum.Order.returnReason', 'orders.history.reason'];
export function historyReason(reason: string | null | undefined, t: { (key: string): string; has: (key: string) => boolean }): string {
  return (reason ?? '')
    .split(' · ')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(part)) {
        const key = [`delivery.lastError.${part}`, `error.${part}`].find((k) => t.has(k));
        return key ? t(key) : null;
      }
      if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(part)) {
        const key = REASON_KEYS.map((p) => `${p}.${part}`).find((k) => t.has(k));
        // a single lowercase word may be a name (a courier account): kept; a snake_case code is not
        return key ? t(key) : part.includes('_') ? null : part;
      }
      return part;
    })
    .filter((x): x is string => !!x)
    .join(' · ');
}

/** IA / Système / member (history actor types of ORD-06). */
export const actorKind = (h: Pick<OrderHistoryRow, 'actor'>): 'ai' | 'system' | 'user' => (h.actor.type === 'ai' || h.actor.type === 'agent' ? 'ai' : h.actor.type === 'system' || h.actor.type === 'courier' ? 'system' : 'user');

/** Newest first (history, calls, notes). */
export const newestFirst = <T>(rows: readonly T[], at: (r: T) => string): T[] => [...rows].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));

/* ---------- KPIs (ORD-05 v2 strip) ---------- */
export function sourceSplit(stats: Pick<OrderStats, 'sourceMix'>): { aiPct: number; manualPct: number } {
  const m = stats.sourceMix;
  const all = Object.values(m).reduce((a, b) => a + b, 0);
  if (!all) return { aiPct: 0, manualPct: 0 };
  const aiPct = Math.round((m.ai * 100) / all);
  return { aiPct, manualPct: 100 - aiPct };
}

/* ---------- bulk ---------- */
/** Rows of a retry merged into the first answer: rows that were OK stay OK. */
export function mergeRetry(first: BulkResponse, retry: BulkResponse): BulkResponse {
  const byId = new Map(retry.results.map((r) => [r.id, r]));
  const results = first.results.map((r) => byId.get(r.id) ?? r);
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

/** Amount check of the payment dialog: integer > 0 and ≤ remaining. */
export function paymentError(amount: number | null, remaining: number): 'validation.required' | 'validation.price' | 'orders.payment.overRemaining' | null {
  if (amount === null) return 'validation.required';
  if (!Number.isInteger(amount) || amount <= 0) return 'validation.price';
  if (amount > remaining) return 'orders.payment.overRemaining';
  return null;
}

/** Effective date of the status dialog: not in the future, at most 7 days back (04 §21). */
export function effectiveDateError(iso: string | null, now = new Date(), maxDays = 7): 'validation.date' | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'validation.date';
  if (t > now.getTime() + 60_000) return 'validation.date';
  if (now.getTime() - t > maxDays * 86_400_000) return 'validation.date';
  return null;
}

/**
 * An inline edit of the order page (contact, items) counts as a change only once its draft differs from the values
 * it was opened with: "Modifier" alone arms no leave guard.
 */
export const draftChanged = <T>(draft: T | null, base: T | null | undefined): boolean => draft !== null && (base === null || base === undefined || JSON.stringify(draft) !== JSON.stringify(base));

/** Blocks of the order page reachable from a link (`/orders/:id#delivery`, notifications and the Home queue). */
export const ORDER_PAGE_ANCHORS = ['delivery', 'payment', 'calls'] as const;
export const orderAnchor = (hash: string): (typeof ORDER_PAGE_ANCHORS)[number] | null => {
  const id = hash.replace(/^#/, '');
  return (ORDER_PAGE_ANCHORS as readonly string[]).includes(id) ? (id as (typeof ORDER_PAGE_ANCHORS)[number]) : null;
};

export type { ConfirmationStatus };
