// Clients list — URL state definition (06 §10 "Clients [CLI-03 filter panel]", api-contract §4 `ClientsQuery`), date
// presets, active filter chips, list pill. Pure functions (unit tested); the page wires them to `useListState`.
import type { PillEnum } from '@djaber/ui';
import { matchPreset, presetRange, type DatePreset } from '@/features/catalog/products-list/spec';
import type { ApiQuery, ListSpec, ListState } from '@/lib/list-state';
import { filterBool, filterList, filterText } from '@/lib/list-state';
import { searchTerm } from '@/lib/phone';
import { CLIENT_SORTS, type ClientListItem, type ClientPill } from './contracts';

export const CLIENTS_LIST: ListSpec = {
  filters: {
    source: 'list',
    quality: 'list',
    tags: 'list',
    riskLevel: 'text',
    channelId: 'list',
    noConversation: 'bool',
    minOrders: 'int',
    maxOrders: 'int',
    neverOrdered: 'bool',
    unconfirmed: 'bool',
    returned: 'bool',
    minSpent: 'int',
    maxSpent: 'int',
    lastOrder: 'text',
    wilayaId: 'list',
    createdFrom: 'date',
    createdTo: 'date',
    blocked: 'bool',
  },
  sorts: CLIENT_SORTS,
  defaultSort: '-lastOrderAt',
};

export const CLIENT_SOURCES = ['ai', 'manual', 'import', 'api'] as const;
export const QUALITY_FILTERS = ['placeholder', 'no_phone', 'no_address', 'duplicates'] as const;
export const LAST_ORDER_FILTERS = ['lt30', '30_90', 'gt90', 'never'] as const;
export const CLIENT_DATE_PRESETS = ['7d', '30d'] as const satisfies readonly DatePreset[];
export { matchPreset, presetRange };

/**
 * Query of `GET /clients`: a search that looks like a phone fragment ("0555 12", "+213 555") is sent normalised so it
 * matches the stored national form (AT-CLI-04 "search by phone fragment").
 */
export function clientsQuery(base: ApiQuery): ApiQuery {
  const q = { ...base };
  if (typeof q.q === 'string') q.q = searchTerm(q.q);
  return q;
}

/* ---------- list pill: blocked > risk > placeholder > reliable > unknown (server `pill`, recomputed when absent) ---------- */
export function clientPill(c: Pick<ClientListItem, 'blocked' | 'riskLevel' | 'isPlaceholder' | 'orderCount'> & { pill?: ClientPill | null; deliveredCount?: number; returnCount?: number }): ClientPill | null {
  if (c.pill !== undefined) return c.pill;
  if (c.blocked) return 'blocked';
  if (c.riskLevel === 'high') return 'risk';
  if (c.isPlaceholder) return 'placeholder';
  if ((c.deliveredCount ?? 0) > 0 && (c.returnCount ?? 0) === 0) return 'reliable';
  if (c.orderCount === 0) return 'unknown';
  return null;
}
/** Label key and colour (the `StatusPill` maps of REF — Component sheet: FIABLE · INCONNU · RISQUE · BLOQUÉ · PLACEHOLDER). */
export const CLIENT_PILL_VIEW: Record<ClientPill, { key: string; enumKey: PillEnum; value: string }> = {
  reliable: { key: 'enum.Client.riskLevel.normal', enumKey: 'Client.pill', value: 'reliable' },
  unknown: { key: 'common.risk.unknown', enumKey: 'Client.pill', value: 'unknown' },
  risk: { key: 'enum.Client.riskLevel.high', enumKey: 'Client.pill', value: 'risk' },
  blocked: { key: 'enum.Client.blocked', enumKey: 'Client.pill', value: 'blocked' },
  placeholder: { key: 'clients.pill.toComplete', enumKey: 'Client.pill', value: 'placeholder' },
};

/** "Amina Belkacem" → "Amina" (CTA "Nouvelle commande pour Amina"); placeholder names are kept whole. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/* ---------- active chips ---------- */
export type ChipLabels = {
  search: (q: string) => string;
  source: Record<string, string>;
  quality: Record<string, string>;
  tags: (names: string) => string;
  risk: string;
  channel: (names: string) => string;
  channelName: (id: string) => string;
  noConversation: string;
  orders: (range: string) => string;
  neverOrdered: string;
  unconfirmed: string;
  returned: string;
  spent: (range: string) => string;
  lastOrder: Record<string, string>;
  wilaya: (names: string) => string;
  wilayaName: (id: string) => string;
  created: (range: string) => string;
  blocked: string;
  date: (day: string) => string;
  money: (n: number) => string;
  number: (n: number) => string;
};
export type Chip = { key: string; label: string; clear: Record<string, null> | 'q' };

const range = (min: string, max: string, fmt: (n: number) => string): string | null => {
  if (!min && !max) return null;
  if (min && max) return `${fmt(Number(min))} – ${fmt(Number(max))}`;
  return min ? `≥ ${fmt(Number(min))}` : `≤ ${fmt(Number(max))}`;
};

/** One chip per active filter group, in the order of the panel. */
export function activeChips(s: ListState, l: ChipLabels): Chip[] {
  const chips: Chip[] = [];
  if (s.q.trim()) chips.push({ key: 'q', label: l.search(s.q.trim()), clear: 'q' });
  for (const v of filterList(s, 'source')) chips.push({ key: `source:${v}`, label: l.source[v] ?? v, clear: { source: null } });
  for (const v of filterList(s, 'quality')) chips.push({ key: `quality:${v}`, label: l.quality[v] ?? v, clear: { quality: null } });
  const tags = filterList(s, 'tags');
  if (tags.length) chips.push({ key: 'tags', label: l.tags(tags.join(', ')), clear: { tags: null } });
  if (filterText(s, 'riskLevel') === 'high') chips.push({ key: 'riskLevel', label: l.risk, clear: { riskLevel: null } });
  const channels = filterList(s, 'channelId');
  if (channels.length) chips.push({ key: 'channelId', label: l.channel(channels.map(l.channelName).join(', ')), clear: { channelId: null } });
  if (filterBool(s, 'noConversation')) chips.push({ key: 'noConversation', label: l.noConversation, clear: { noConversation: null } });
  const orders = range(filterText(s, 'minOrders'), filterText(s, 'maxOrders'), l.number);
  if (orders) chips.push({ key: 'minOrders', label: l.orders(orders), clear: { minOrders: null, maxOrders: null } });
  if (filterBool(s, 'neverOrdered')) chips.push({ key: 'neverOrdered', label: l.neverOrdered, clear: { neverOrdered: null } });
  if (filterBool(s, 'unconfirmed')) chips.push({ key: 'unconfirmed', label: l.unconfirmed, clear: { unconfirmed: null } });
  if (filterBool(s, 'returned')) chips.push({ key: 'returned', label: l.returned, clear: { returned: null } });
  const spent = range(filterText(s, 'minSpent'), filterText(s, 'maxSpent'), l.money);
  if (spent) chips.push({ key: 'minSpent', label: l.spent(spent), clear: { minSpent: null, maxSpent: null } });
  const last = filterText(s, 'lastOrder');
  if (last) chips.push({ key: 'lastOrder', label: l.lastOrder[last] ?? last, clear: { lastOrder: null } });
  const wilayas = filterList(s, 'wilayaId');
  if (wilayas.length) chips.push({ key: 'wilayaId', label: l.wilaya(wilayas.map(l.wilayaName).join(', ')), clear: { wilayaId: null } });
  const a = filterText(s, 'createdFrom');
  const b = filterText(s, 'createdTo');
  if (a || b) chips.push({ key: 'createdFrom', label: l.created([a ? l.date(a) : '…', b ? l.date(b) : '…'].join(' → ')), clear: { createdFrom: null, createdTo: null } });
  if (filterBool(s, 'blocked')) chips.push({ key: 'blocked', label: l.blocked, clear: { blocked: null } });
  return chips;
}

/** Removing one value of a multi filter keeps the others. */
export const withoutValue = (s: ListState, name: string, value: string): string[] => filterList(s, name).filter((v) => v !== value);

/** "Commandes" quick chips of the panel: Jamais commandé · ≥ 2 commandes · Clients retournés (mutually independent). */
export const ORDER_CHIPS = ['neverOrdered', 'atLeast2', 'returned'] as const;
export type OrderChip = (typeof ORDER_CHIPS)[number];
export const orderChipsValue = (s: ListState): OrderChip[] => {
  const out: OrderChip[] = [];
  if (filterBool(s, 'neverOrdered')) out.push('neverOrdered');
  if (filterText(s, 'minOrders') === '2' && !filterText(s, 'maxOrders')) out.push('atLeast2');
  if (filterBool(s, 'returned')) out.push('returned');
  return out;
};
/** Chips → filters. "Jamais commandé" and "≥ 2 commandes" exclude each other: the one clicked last wins. */
export function orderChipsPatch(next: OrderChip[], prev: OrderChip[]): Record<string, boolean | number | null> {
  let never = next.includes('neverOrdered');
  let two = next.includes('atLeast2');
  if (never && two) {
    if (prev.includes('neverOrdered')) never = false;
    else two = false;
  }
  const patch: Record<string, boolean | number | null> = { neverOrdered: never || null, returned: next.includes('returned') || null };
  // the order-count range is only touched when "≥ 2 commandes" itself changes (a typed range stays otherwise)
  if (two) Object.assign(patch, { minOrders: 2, maxOrders: null });
  else if (prev.includes('atLeast2')) Object.assign(patch, { minOrders: null });
  if (never) Object.assign(patch, { minOrders: null, maxOrders: null });
  return patch;
}

/** Tag options of the filters: the selected ones + the workspace's tags (`GET /clients/tags`, M11) + the tags of the loaded rows. */
export function tagOptions(rows: readonly Pick<ClientListItem, 'tags'>[], selected: readonly string[], workspace: readonly string[] = []): string[] {
  const seen = new Map<string, string>();
  for (const t of [...selected, ...workspace, ...rows.flatMap((r) => r.tags)]) {
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}
