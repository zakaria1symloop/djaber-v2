// UX-049 (10/11): an order keeps the relay point picked in Djaber as `CourierStopdesk.id` (older rows and shipments may
// hold the courier's own desk id). Every screen and document shows its name (and address), never the id.
import { prisma } from '@djaber/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StopdeskLabel = { name: string; address: string | null };

/** id or courier desk id → name + address (unknown ids are absent from the map). */
export const stopdeskLabels = async (ids: readonly (string | null | undefined)[]): Promise<Map<string, StopdeskLabel>> => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const uuids = list.filter((x) => UUID.test(x));
  const rows = await prisma.courierStopdesk.findMany({
    where: { OR: [...(uuids.length ? [{ id: { in: uuids } }] : []), { externalId: { in: list } }] },
    select: { id: true, externalId: true, name: true, address: true },
  });
  const out = new Map<string, StopdeskLabel>();
  for (const r of rows) out.set(r.id, { name: r.name, address: r.address });
  // a courier desk id only when no Djaber row id matched (the row id wins)
  for (const r of rows) if (!out.has(r.externalId)) out.set(r.externalId, { name: r.name, address: r.address });
  return out;
};

/** "Yalidine Sétif Centre — Cité 1000 logements" (name only when the address is unknown). */
export const stopdeskText = (l: StopdeskLabel | undefined): string | null => (l ? (l.address ? `${l.name} — ${l.address}` : l.name) : null);
