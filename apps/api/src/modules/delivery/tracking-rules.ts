// DLV-04 / 04 §1.5 / §22 / 05-integrations §2.6 — pure rules of the tracking sync (no database): which courier status
// may replace which, the attempt counter, the polling cadence, and the order's `deliveryStatus` that follows.
import { DELIVERY_STATUS_OF_SHIPMENT, SHIPMENT_PROGRESS, SHIPMENT_STALE_STATUS_AFTER_DAYS, TRACKING_CADENCE, type ShipmentStatusName } from '@djaber/shared';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type StatusDecision = { change: boolean; reason: 'unknown' | 'same' | 'terminal' | 'backwards' | 'forward' | 'failure' | 'return' | 'cancel' | 're_attempt' };

/**
 * May the courier's `mapped` status replace `current`? Never backwards along pending → … → delivered; `failed`,
 * `returned`, `cancelled` from any non-terminal state; a failed parcel may move forward again (re-attempt);
 * `delivered` only gives way to `returned` (a return after delivery, AT-DLV-06); `returned`, `cancelled`, `stale` are final.
 */
export const decideStatus = (current: ShipmentStatusName, mapped: ShipmentStatusName | null): StatusDecision => {
  if (!mapped || mapped === 'pending' || mapped === 'stale') return { change: false, reason: 'unknown' };
  if (mapped === current) return { change: false, reason: 'same' };
  if (current === 'returned' || current === 'cancelled' || current === 'stale') return { change: false, reason: 'terminal' };
  if (current === 'delivered') return mapped === 'returned' ? { change: true, reason: 'return' } : { change: false, reason: 'terminal' };
  if (mapped === 'failed') return { change: true, reason: 'failure' };
  if (mapped === 'returned') return { change: true, reason: 'return' };
  if (mapped === 'cancelled') return { change: true, reason: 'cancel' };
  if (current === 'failed') return { change: true, reason: 're_attempt' };
  return SHIPMENT_PROGRESS.indexOf(mapped) > SHIPMENT_PROGRESS.indexOf(current) ? { change: true, reason: 'forward' } : { change: false, reason: 'backwards' };
};

/**
 * Delivery attempts started (`attempt n/3`): entering `out_for_delivery` starts one; a failure reported without a
 * prior "out for delivery" counts as one; "Relancer" (retry-delivery) counts one and moves the parcel out again.
 */
export const attemptsAfter = (current: ShipmentStatusName, next: ShipmentStatusName, attempts: number): number => {
  if (next === 'out_for_delivery' && current !== 'out_for_delivery') return attempts + 1;
  if (next === 'failed' && current !== 'out_for_delivery' && current !== 'failed') return attempts + 1;
  return attempts;
};

/** DLV-04: every 2 h during the first 3 days after sending, then every 12 h. */
export const nextSyncAt = (createdAt: Date, now: Date = new Date()): Date => {
  const early = now.getTime() - createdAt.getTime() < TRACKING_CADENCE.earlyDays * DAY;
  return new Date(now.getTime() + (early ? TRACKING_CADENCE.earlyEveryHours : TRACKING_CADENCE.lateEveryHours) * HOUR);
};

/** DLV-04: no courier event for 30 d ⇒ `stale`. */
export const isStaleAt = (lastEventAt: Date, now: Date = new Date()) => now.getTime() - lastEventAt.getTime() > SHIPMENT_STALE_STATUS_AFTER_DAYS * DAY;

const DELIVERY_RANK: Record<string, number> = { not_sent: 0, pending: 1, sent: 2, in_transit: 3, out_for_delivery: 4, delivered: 5 };

/**
 * `Order.deliveryStatus` after a courier status (04 §1.5): `picked_up` reads `in_transit`; `cancelled` / `stale` leave
 * it unchanged; never backwards except after a failure (a re-attempt) — `failed` / `returned` always apply.
 */
export const orderDeliveryStatusAfter = (current: string, shipment: ShipmentStatusName): string | null => {
  const target = DELIVERY_STATUS_OF_SHIPMENT[shipment];
  if (!target || target === current) return null;
  if (target === 'failed' || target === 'returned') return target;
  if (current === 'failed') return target;
  if (current === 'returned') return null;
  return (DELIVERY_RANK[target] ?? 0) > (DELIVERY_RANK[current] ?? 0) ? target : null;
};

/** A line of a parcel's timeline as the rules read it (`ShipmentEvent`). */
export type TimelineEvent = { rawStatus: string; mappedStatus: string | null; at: Date; source?: string };
const SAME_INSTANT_MS = 1000;

/**
 * Is this courier report already on the parcel's timeline? (05-integrations §2.6 "events are idempotent" — UX-056 remark
 * 12/11: « each Refresh adds another "Shipment created" line ».) Identity of a courier event = raw status + courier time
 * (±1 s), checked against EVERY stored event, not only the newest one (the courier's own creation time is older than
 * Djaber's « sent » line, so the newest-only check let the same courier line in again on every refresh). Without a courier
 * time, a raw status equal to the one the parcel already holds (`Shipment.rawStatus`) or to its newest line is the same
 * report. The creation (`sent`) is one line whatever the courier calls its pre-pickup states.
 */
export const isKnownCourierEvent = (events: readonly TimelineEvent[], u: { rawStatus: string; mapped: string | null; at?: Date | null }, currentRaw: string | null = null): boolean => {
  if (u.mapped === 'sent' && events.some((e) => e.mappedStatus === 'sent')) return true;
  const at = u.at;
  if (at) return events.some((e) => e.rawStatus === u.rawStatus && Math.abs(e.at.getTime() - at.getTime()) <= SAME_INSTANT_MS);
  if (currentRaw !== null && u.rawStatus === currentRaw) return true;
  const newest = events.reduce<TimelineEvent | null>((n, e) => (!n || e.at > n.at ? e : n), null);
  return !!newest && newest.rawStatus === u.rawStatus;
};

/**
 * The timeline shown on the screens (tracking panel, order page): the courier lines stored twice before the rule above
 * (refreshes of 12/11) are dropped — Djaber's own lines (manual marks, system) are always kept. Same order as given.
 */
export const dedupeTimeline = <E extends TimelineEvent>(events: readonly E[]): E[] => {
  const isCourier = (e: E) => e.source === 'poll' || e.source === 'webhook';
  const oldestFirst = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  // Djaber's lines are always kept, so they count from the start (its « sent » line is written after the courier's time)
  const kept: E[] = oldestFirst.filter((e) => !isCourier(e));
  const drop = new Set<E>();
  for (const e of oldestFirst.filter(isCourier)) {
    if (isKnownCourierEvent(kept, { rawStatus: e.rawStatus, mapped: e.mappedStatus, at: e.at })) drop.add(e);
    else kept.push(e);
  }
  return events.filter((e) => !drop.has(e));
};

/** 03-events §3 `courier.create-parcel` retry delays after `COURIER_UNAVAILABLE` (FL-08 F-3): 6 retries. */
export const CREATE_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000] as const;
/** 1 attempt + 6 retries. */
export const CREATE_MAX_ATTEMPTS = CREATE_RETRY_DELAYS_MS.length + 1;
