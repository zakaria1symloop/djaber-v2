// List state ↔ URL codec (02-next-route-map §8: every filter, tab, sort, page, density and open sheet id is URL state;
// api-contract §1.6: the URL carries the same parameter names as the API). Pure functions; the hook is `useListState`.
export type FilterKind = 'text' | 'list' | 'bool' | 'int' | 'date';
export type FilterValue = string | string[] | boolean | number;
export type Density = 'compact' | 'comfortable';
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type ListSpec = {
  /** filter name → kind. Names are the API query names (`categoryIds`, `minPrice`, `createdFrom`…). */
  filters: Record<string, FilterKind>;
  /** whitelisted sort fields (api-contract §4) */
  sorts: readonly string[];
  /** e.g. `name` or `-createdAt` */
  defaultSort: string;
  /** status tabs: the tab is a filter preset chosen by the page (`?tab=pending`) */
  tabs?: readonly string[];
  layouts?: readonly string[];
  /**
   * URL namespace of a second list on the same page (`dd.` ⇒ `?dd.status=pending&dd.page=2`): every parameter of this
   * list is read and written with the prefix, so two lists never share `page` / `status` (ADM-16: account deletions and
   * customer data deletions). The API query keeps the plain names.
   */
  prefix?: string;
};

export type ListState = {
  q: string;
  filters: Record<string, FilterValue>;
  sort: string;
  page: number;
  pageSize: PageSize;
  /** null = the user preference (`User.prefs.listDensity`) */
  density: Density | null;
  tab: string | null;
  /** id of the row whose side sheet is open */
  sheet: string | null;
  layout: string | null;
  /** hidden column keys */
  hide: string[];
};

const RESERVED = ['q', 'sort', 'page', 'pageSize', 'density', 'tab', 'sheet', 'layout', 'hide'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseSort = (sort: string): { key: string; dir: 'asc' | 'desc' } => (sort.startsWith('-') ? { key: sort.slice(1), dir: 'desc' } : { key: sort, dir: 'asc' });
export const formatSort = (s: { key: string; dir: 'asc' | 'desc' }): string => `${s.dir === 'desc' ? '-' : ''}${s.key}`;

const list = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const parseFilter = (kind: FilterKind, raw: string): FilterValue | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  switch (kind) {
    case 'text':
      return v;
    case 'list': {
      const items = [...new Set(list(v))];
      return items.length ? items : undefined;
    }
    case 'bool':
      return v === '1' || v === 'true' ? true : undefined;
    case 'int':
      return /^-?\d{1,12}$/.test(v) ? Number(v) : undefined;
    case 'date':
      return DATE.test(v) ? v : undefined;
  }
};

type Params = { get(name: string): string | null };

/** URL name of a list parameter (`page` ⇒ `dd.page` for a prefixed list). */
export const urlParam = (spec: Pick<ListSpec, 'prefix'>, name: string): string => `${spec.prefix ?? ''}${name}`;

/**
 * A `from` / `to` (or `xFrom` / `xTo`) pair typed or shared inverted in the URL is read in the right order (journeys 16/11
 * J06-7: `?from=2026-11-16&to=2026-11-01` broke Caisse and Ventes with « Impossible de charger »). The date picker never
 * applies an inverted range; only the URL can carry one.
 */
export function swapInvertedRanges(filters: Record<string, FilterValue>) {
  for (const name of Object.keys(filters)) {
    const to = name === 'from' ? 'to' : name.endsWith('From') ? `${name.slice(0, -4)}To` : null;
    if (!to) continue;
    const a = filters[name];
    const b = filters[to];
    if (typeof a === 'string' && typeof b === 'string' && DATE.test(a) && DATE.test(b) && a > b) {
      filters[name] = b;
      filters[to] = a;
    }
  }
}

/** Reads the state from the query string; unknown or malformed values fall back to the defaults (never throws). */
export function parseListState(spec: ListSpec, all: Params): ListState {
  const params: Params = spec.prefix ? { get: (name) => all.get(urlParam(spec, name)) } : all;
  const filters: Record<string, FilterValue> = {};
  for (const [name, kind] of Object.entries(spec.filters)) {
    const raw = params.get(name);
    if (raw === null) continue;
    const value = parseFilter(kind, raw);
    if (value !== undefined) filters[name] = value;
  }
  swapInvertedRanges(filters);
  const sortRaw = params.get('sort') ?? '';
  const sort = spec.sorts.includes(parseSort(sortRaw).key) ? sortRaw : spec.defaultSort;
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  const density = params.get('density');
  const tab = params.get('tab');
  const layout = params.get('layout');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    filters,
    sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? (size as PageSize) : 25,
    density: density === 'compact' || density === 'comfortable' ? density : null,
    tab: tab && spec.tabs?.includes(tab) ? tab : null,
    sheet: params.get('sheet') || null,
    layout: layout && spec.layouts?.includes(layout) ? layout : null,
    hide: list(params.get('hide') ?? ''),
  };
}

const encodeFilter = (value: FilterValue): string | null => {
  if (Array.isArray(value)) return value.length ? value.join(',') : null;
  if (typeof value === 'boolean') return value ? '1' : null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  return value.trim() ? value.trim() : null;
};

/** Writes the state as query pairs in a stable order; defaults are omitted so that a pristine list has a clean URL. */
export function serializeListState(spec: ListSpec, s: ListState): [string, string][] {
  const out: [string, string][] = [];
  const done = () => (spec.prefix ? out.map(([k, v]): [string, string] => [urlParam(spec, k), v]) : out);
  if (s.tab) out.push(['tab', s.tab]);
  if (s.q.trim()) out.push(['q', s.q.trim()]);
  for (const name of Object.keys(spec.filters)) {
    const value = s.filters[name];
    if (value === undefined) continue;
    const encoded = encodeFilter(value);
    if (encoded !== null) out.push([name, encoded]);
  }
  if (s.sort && s.sort !== spec.defaultSort) out.push(['sort', s.sort]);
  if (s.page > 1) out.push(['page', String(s.page)]);
  if (s.pageSize !== 25) out.push(['pageSize', String(s.pageSize)]);
  if (s.density) out.push(['density', s.density]);
  if (s.layout) out.push(['layout', s.layout]);
  if (s.hide.length) out.push(['hide', s.hide.join(',')]);
  if (s.sheet) out.push(['sheet', s.sheet]);
  return done();
}

/** Query string (without `?`), keeping the parameters of the page that are not part of the list state. */
export function listQueryString(spec: ListSpec, s: ListState, current?: Iterable<[string, string]>): string {
  const p = new URLSearchParams();
  const own = new Set([...RESERVED, ...Object.keys(spec.filters)].map((k) => urlParam(spec, k)));
  for (const [k, v] of current ?? []) if (!own.has(k)) p.append(k, v);
  for (const [k, v] of serializeListState(spec, s)) p.set(k, v);
  return p.toString();
}

export type ApiQuery = Record<string, string | number | boolean | string[]>;
/** Parameters of the list request: search (min 2 chars, §1.6), filters, sort, page, pageSize. */
export function listApiQuery(s: ListState, extra: ApiQuery = {}): ApiQuery {
  const q: ApiQuery = { ...extra };
  if (s.q.trim().length >= 2) q.q = s.q.trim();
  for (const [name, value] of Object.entries(s.filters)) q[name] = value;
  q.sort = s.sort;
  q.page = s.page;
  q.pageSize = s.pageSize;
  return q;
}

/** Same filters without paging and sorting: KPIs follow the filters (`GET …/stats`), exports use the current filter. */
export function filtersApiQuery(s: ListState, extra: ApiQuery = {}): ApiQuery {
  const { sort: _sort, page: _page, pageSize: _pageSize, ...rest } = listApiQuery(s, extra);
  return rest;
}

/** Number of active filters for "Filtres (n)": a min/max or from/to pair counts once; the search does not count. */
export function countActiveFilters(s: ListState): number {
  const groups = new Set<string>();
  for (const name of Object.keys(s.filters)) groups.add(name.replace(/^(min|max)(?=[A-Z])/, 'range:').replace(/(From|To)$/, ':dates').replace(/^(from|to)$/, ':dates'));
  return groups.size;
}

export const hasActiveFilters = (s: ListState) => s.q.trim().length > 0 || Object.keys(s.filters).length > 0 || s.tab !== null;

/** Applies a patch; any change other than the page / sheet / density / layout / hidden columns goes back to page 1. */
export function patchListState(s: ListState, patch: Partial<Omit<ListState, 'filters'>> & { filters?: Record<string, FilterValue | undefined | null> }): ListState {
  const filters = { ...s.filters };
  for (const [name, value] of Object.entries(patch.filters ?? {})) {
    if (value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0)) delete filters[name];
    else filters[name] = value;
  }
  const next: ListState = { ...s, ...patch, filters };
  const resets = patch.filters !== undefined || 'q' in patch || 'sort' in patch || 'tab' in patch || 'pageSize' in patch;
  if (resets && !('page' in patch)) next.page = 1;
  return next;
}

export const clearListFilters = (s: ListState): ListState => ({ ...s, q: '', filters: {}, tab: null, page: 1 });

/** Typed readers for the pages. */
export const filterList = (s: ListState, name: string): string[] => {
  const v = s.filters[name];
  return Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
};
export const filterText = (s: ListState, name: string): string => {
  const v = s.filters[name];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};
export const filterBool = (s: ListState, name: string): boolean => s.filters[name] === true;

/**
 * Journeys 18/11 J10r-2: the URL filters of this list that a failed request refused. `fields` = the field names of the 400 /
 * 422 answer (`action`, `action.0`), `queryKey` = the JSON of the failed query's key — the filter must be part of that
 * request, so a refusal of another form on the page never drops a filter. `sort` counts when the answer names it.
 */
export function rejectedUrlFilters(spec: ListSpec, s: ListState, fields: string[], queryKey: string): string[] {
  const names = new Set(fields.map((f) => f.split(/[.[]/)[0]!).filter(Boolean));
  const out: string[] = [];
  for (const name of names) {
    if (name === 'sort' && s.sort !== spec.defaultSort && queryKey.includes(`"sort":${JSON.stringify(s.sort)}`)) out.push('sort');
    else if (name in spec.filters && s.filters[name] !== undefined && queryKey.includes(`"${name}":`)) out.push(name);
  }
  return out;
}
