// GSH-03 / 05-integrations §3 — the 18 cells (A…R) of an order row, and the GSH-06 filter. Pure: unit-tested.
import { communeDisplayName, SHEETS_COLUMNS, type SheetsFilters } from '@djaber/shared';
import type { SheetCell } from './sheets.gateway';

const OFFSET_MS = 60 * 60_000; // Africa/Algiers = UTC+1, no DST

export type SheetsOrder = {
  id: string;
  number: string;
  orderedAt: Date;
  source: string;
  status: string;
  paymentMethod: string;
  channelId: string | null;
  channel: { name: string; platform: string } | null;
  clientName: string;
  clientPhone: string;
  wilaya: { nameFr: string } | null;
  commune: { nameFr: string } | null;
  communeText: string | null;
  address: string | null;
  isStopdesk: boolean;
  stopdeskName: string | null;
  items: { productName: string; variantName: string | null; quantity: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  shipment: { provider: string; trackingNumber: string | null } | null;
};
export type Labeler = (kind: 'status' | 'method' | 'source' | 'courier', value: string) => string;

/** `yyyy-MM-dd HH:mm` in Africa/Algiers. */
export const algiersStamp = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

export const sheetsRowOf = (o: SheetsOrder, label: Labeler): SheetCell[] => {
  const cells: Record<(typeof SHEETS_COLUMNS)[number], SheetCell> = {
    number: o.number,
    date: algiersStamp(o.orderedAt),
    channel: o.channel ? `${o.channel.name} (${o.channel.platform === 'instagram' ? 'IG' : 'FB'})` : '—',
    client: o.clientName,
    phone: `'${o.clientPhone}`,
    wilaya: o.wilaya?.nameFr ?? '',
    // journey J05v-3: the display form of the screens (the stored name stays the matching key)
    commune: communeDisplayName(o.commune?.nameFr ?? o.communeText, o.wilaya) ?? '',
    address: o.isStopdesk ? `Bureau ${o.stopdeskName ?? ''}`.trim() : (o.address ?? ''),
    items: o.items.map((i) => `${i.productName}${i.variantName ? ` ${i.variantName}` : ''} ×${i.quantity}`).join('; '),
    subtotal: o.subtotal,
    fee: o.deliveryFee,
    total: o.total,
    method: label('method', o.paymentMethod),
    status: label('status', o.status),
    courier: o.shipment ? label('courier', o.shipment.provider) : '—',
    tracking: o.shipment?.trackingNumber ?? '',
    source: label('source', o.source),
    djaber_id: o.id,
  };
  return SHEETS_COLUMNS.map((c) => cells[c]);
};

/** GSH-06: empty lists = every order. */
export const matchesFilters = (o: Pick<SheetsOrder, 'channelId' | 'source'>, f: Partial<SheetsFilters> | null | undefined) => {
  const channels = f?.channelIds ?? [];
  const sources = f?.sources ?? [];
  if (channels.length && (!o.channelId || !channels.includes(o.channelId))) return false;
  if (sources.length && !sources.includes(o.source as never)) return false;
  return true;
};

/** 1-based row of `orderId` in column R (row 1 = header), or null. */
export const rowOf = (ids: string[], orderId: string): number | null => {
  const i = ids.indexOf(orderId);
  return i >= 1 ? i + 1 : null;
};
