// Saved views ↔ list URL state (LST-03, D47; 05 §16 « filters JSON = the list query params »). Pure functions, unit
// tested; the component is `SavedViews` (saved-views.tsx). A view stores the URL parameters of the list — search `q`,
// status `tab` and every filter of the page spec — plus its sort, visible columns and density.
import type { SavedViewDto } from '@djaber/shared';
import { parseListState, serializeListState, type Density, type FilterValue, type ListSpec, type ListState } from '@/lib/list-state';

export type SavedViewContent = { filters: Record<string, string>; sort: string | null; columns: string[]; density: Density | null };
const PRESENTATION = new Set(['sort', 'page', 'pageSize', 'density', 'layout', 'hide', 'sheet']);

/** The filter part of the URL (`q`, `tab`, filters), as the URL encodes it. */
export const filterParams = (spec: ListSpec, s: ListState): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of serializeListState(spec, s)) if (!PRESENTATION.has(k)) out[k] = v;
  return out;
};

/**
 * What « Enregistrer la vue courante… » stores. `columns` = the visible column keys among `columnKeys` (all keys of the
 * table, so it is never empty); none given ⇒ `[]` (the page has no column picker).
 */
export function viewFromState(spec: ListSpec, s: ListState, o: { columnKeys?: readonly string[]; density?: Density | null } = {}): SavedViewContent {
  return {
    filters: filterParams(spec, s),
    sort: s.sort && s.sort !== spec.defaultSort ? s.sort : null,
    columns: o.columnKeys ? o.columnKeys.filter((k) => !s.hide.includes(k)) : [],
    density: o.density ?? s.density ?? null,
  };
}

const asParams = (filters: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters ?? {})) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, Array.isArray(v) ? v.map(String).join(',') : v === true ? '1' : String(v));
  }
  return p;
};

/** The list state a view opens: its filters replace the current ones, page 1, sheet closed. */
export function stateFromView(spec: ListSpec, view: Pick<SavedViewDto, 'filters' | 'sort' | 'columns' | 'density'>, o: { columnKeys?: readonly string[]; current?: ListState } = {}): ListState {
  const p = asParams(view.filters);
  if (view.sort) p.set('sort', view.sort);
  const parsed = parseListState(spec, p);
  const hide = o.columnKeys && view.columns.length ? o.columnKeys.filter((k) => !view.columns.includes(k)) : [];
  return {
    ...parsed,
    density: view.density ?? o.current?.density ?? null,
    layout: o.current?.layout ?? null,
    hide,
    page: 1,
    pageSize: o.current?.pageSize ?? parsed.pageSize,
    sheet: null,
  };
}

/** `useListState().set` patch that replaces every filter (the patch merges filters: the old ones are cleared with null). */
export function patchFor(current: ListState, next: ListState) {
  const filters: Record<string, FilterValue | null> = {};
  for (const k of Object.keys(current.filters)) filters[k] = null;
  Object.assign(filters, next.filters);
  return { q: next.q, tab: next.tab, sort: next.sort, density: next.density, hide: next.hide, page: 1, sheet: null, filters };
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/** The list shows this view: same filters and same sort (density and columns are presentation). */
export function isCurrentView(spec: ListSpec, s: ListState, view: Pick<SavedViewDto, 'filters' | 'sort'>): boolean {
  const target = stateFromView(spec, { ...view, columns: [], density: null });
  return same(filterParams(spec, s), filterParams(spec, target)) && s.sort === target.sort;
}

/** True when the URL carries no list parameter: the list may open on the default view. */
export const isPristine = (spec: ListSpec, params: { has(name: string): boolean }) =>
  !['q', 'tab', 'sort', 'page', 'sheet', ...Object.keys(spec.filters)].some((k) => params.has(k));

/** « À envoyer Sétif (copie) », then « (copie 2) »… — a free name for a duplicate (names are unique per user and page). */
export function copyName(name: string, taken: readonly string[], label: (n: number) => string, max = 60): string {
  const lower = new Set(taken.map((t) => t.trim().toLocaleLowerCase()));
  for (let n = 1; n < 100; n++) {
    const suffix = ` (${label(n)})`;
    const candidate = `${name.slice(0, max - suffix.length)}${suffix}`;
    if (!lower.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return name.slice(0, max);
}
