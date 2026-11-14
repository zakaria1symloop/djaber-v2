// 04 §22 "Actualiser" — 1 manual refresh per 5 min per parcel. The wait lives in Redis (`trk:manual:<shipmentId>`, TTL);
// every screen that offers « Actualiser » (tracking panel, order page, delivery list rows) reads it from here so the item is
// greyed with the same live countdown everywhere (UX-056 leftovers, 14/11: the list still offered it during the wait).
import type { RedisService } from '../../core/redis/redis.provider';

export const syncCooldownKey = (shipmentId: string) => `trk:manual:${shipmentId}`;

/** Seconds left (Redis TTL) → the instant the next refresh is allowed; null when there is no wait. */
export const syncAvailableFromTtl = (ttl: unknown, now = Date.now()): string | null => {
  const s = Number(ttl);
  return Number.isFinite(s) && s > 0 ? new Date(now + s * 1000).toISOString() : null;
};

/** Parcel id → end of its wait (ISO), for the parcels that have one — one Redis round trip for a whole list page. */
export async function syncAvailability(redis: Pick<RedisService, 'client'>, ids: readonly string[], now = Date.now()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const pipe = redis.client.pipeline();
  for (const id of unique) pipe.ttl(syncCooldownKey(id));
  const res = (await pipe.exec()) ?? [];
  unique.forEach((id, i) => {
    const at = syncAvailableFromTtl(res[i]?.[1], now);
    if (at) out.set(id, at);
  });
  return out;
}
