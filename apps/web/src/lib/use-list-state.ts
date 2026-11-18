'use client';
// `useListState(spec)` — the one hook that keeps a list in the URL: search, filters, status tab, sort, page, page size,
// density, layout, hidden columns and the open side sheet (`?sheet=<id>`). Shareable links, back navigation and
// refresh restore the same view. Used by every L6 list (products, movements, services; orders / clients / delivery later).
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ApiError } from './api';
import { useT } from './i18n';
import {
  clearListFilters,
  countActiveFilters,
  filtersApiQuery,
  formatSort,
  hasActiveFilters,
  listApiQuery,
  listQueryString,
  parseListState,
  parseSort,
  patchListState,
  type ApiQuery,
  type Density,
  type FilterValue,
  type ListSpec,
  type ListState,
  rejectedUrlFilters,
} from './list-state';
import { useSession } from './session';

export type ListPatch = Parameters<typeof patchListState>[1];
/** errors whose refused URL filters were already dropped (J10r-2) */
const HANDLED = new WeakSet<object>();

export function useListState(spec: ListSpec) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me } = useSession();
  const state = useMemo(() => parseListState(spec, params), [spec, params]);

  const write = useCallback(
    (next: ListState, mode: 'replace' | 'push' = 'replace') => {
      const qs = listQueryString(spec, next, params.entries());
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (mode === 'push') router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [spec, params, pathname, router],
  );

  // journeys 18/11 J10r-2: a filter of the address the API refuses (`?action=pack` → 422 `fields.action`, an old link or a
  // hand-typed value) is dropped with a word, instead of an error state whose « Réessayer » sent the same request again.
  // Any list / stats / export query of the page that fails on one of this list's URL filters counts.
  const qc = useQueryClient();
  const t = useT();
  const latest = useRef({ state, write });
  latest.current = { state, write };
  useEffect(
    () =>
      qc.getQueryCache().subscribe((ev) => {
        if (ev.type !== 'updated' || ev.action.type !== 'error') return;
        const err = ev.action.error;
        if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 422)) return;
        const { state: now, write: put } = latest.current;
        const bad = rejectedUrlFilters(spec, now, Object.keys(err.body.fields ?? {}), JSON.stringify(ev.query.queryKey));
        // one answer, one fix: two lists of the page on the same URL (list + saved views) see the same error object
        if (!bad.length || HANDLED.has(err)) return;
        HANDLED.add(err);
        put(patchListState(now, { filters: Object.fromEntries(bad.filter((k) => k !== 'sort').map((k) => [k, null])), ...(bad.includes('sort') ? { sort: spec.defaultSort } : {}) }));
        toast({ tone: 'warning', message: t('list.urlFilterDropped', { count: bad.length }) });
      }),
    [qc, spec, t],
  );

  const set = useCallback((patch: ListPatch) => write(patchListState(state, patch)), [state, write]);
  const setFilter = useCallback((name: string, value: FilterValue | null | undefined) => write(patchListState(state, { filters: { [name]: value } })), [state, write]);
  const setFilters = useCallback((filters: Record<string, FilterValue | null | undefined>) => write(patchListState(state, { filters })), [state, write]);
  const clear = useCallback(() => write(clearListFilters(state)), [state, write]);
  /** opening a sheet is a history entry: Back closes it */
  const openSheet = useCallback((id: string | null) => write({ ...state, sheet: id }, id && !state.sheet ? 'push' : 'replace'), [state, write]);

  const density: Density = state.density ?? me?.prefs?.listDensity ?? 'comfortable';
  return {
    state,
    set,
    setFilter,
    setFilters,
    clear,
    openSheet,
    density,
    sort: parseSort(state.sort),
    setSort: (s: { key: string; dir: 'asc' | 'desc' }) => set({ sort: formatSort(s) }),
    activeCount: countActiveFilters(state),
    filtered: hasActiveFilters(state),
    /** parameters of `GET <list>` */
    apiQuery: (extra?: ApiQuery) => listApiQuery(state, extra),
    /** parameters of `GET <list>/stats` and of exports */
    filterQuery: (extra?: ApiQuery) => filtersApiQuery(state, extra),
  };
}
export type ListController = ReturnType<typeof useListState>;
