'use client';
// L6 list frame shared by the admin core lists (02 §4): filter bar (search · quick dropdown filters · Filtres (n) panel ·
// count on the end side), active chips, then exactly one of skeleton / error / empty / filtered-empty / table, the
// offline banner over stale data, pagination 25/50/100. Every value lives in the URL (`useListState`).
import { formatDateTime, type AppLocale } from '@djaber/shared';
import { ActiveFilters, Button, Card, cn, DataTable, EmptyState, FilterChips, FilterDateRange, FilterDropdown, FilterGroup, FilterPanel, FilterRange, SearchInput, type Column, type FilterOption } from '@djaber/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ListFilteredEmpty, ListLoading, OfflineBanner } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { apiSession } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, filterText } from '@/lib/list-state';
import type { ListController } from '@/lib/use-list-state';
import { AdminQueryError } from './admin-page';
import type { AdminList } from './api';

export type AdminFilter =
  /** `chipLabel`: name used on the active chip when `label` already shows the value (« Période : 7 j » — J13-9) */
  | { kind: 'multi' | 'single'; key: string; label: string; chipLabel?: string; options: FilterOption[] }
  | { kind: 'range'; key: string; label: string; min: string; max: string; unit?: string }
  | { kind: 'date'; key: string; label: string; from: string; to: string }
  | { kind: 'toggle'; key: string; label: string }
  /** free body (entity pickers); `active` = number shown on the chip, `chip` = label of the active chip */
  | { kind: 'custom'; key: string; label: string; render: () => ReactNode; active: number; chip?: string; clear: () => void };

/** True while the browser (or the API client) reports no connection. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const off = apiSession.on((e) => {
      if (e === 'offline') setOnline(false);
      if (e === 'online') setOnline(true);
    });
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      off();
    };
  }, []);
  return online;
}

function FilterBody({ f, list }: { f: AdminFilter; list: ListController }) {
  const t = useT();
  const s = list.state;
  if (f.kind === 'custom') return <>{f.render()}</>;
  if (f.kind === 'multi' || f.kind === 'single')
    return <FilterChips label={f.label} multiple={f.kind === 'multi'} options={f.options} value={filterList(s, f.key)} onChange={(v) => list.setFilter(f.key, f.kind === 'multi' ? v : (v[0] ?? null))} />;
  if (f.kind === 'range')
    return (
      <FilterRange
        min={filterText(s, f.min)}
        max={filterText(s, f.max)}
        unit={f.unit}
        onChange={(r) => list.setFilters({ [f.min]: r.min === '' ? null : Number(r.min), [f.max]: r.max === '' ? null : Number(r.max) })}
        labels={{ min: t('clients.filter.min'), max: t('clients.filter.max') }}
      />
    );
  if (f.kind === 'date')
    return (
      <FilterDateRange
        from={filterText(s, f.from)}
        to={filterText(s, f.to)}
        onChange={(r) => list.setFilters({ [f.from]: r.from || null, [f.to]: r.to || null })}
        presets={[]}
        activePreset={undefined}
        onPreset={() => undefined}
        labels={{ from: t('common.from'), to: t('common.to'), presets: f.label }}
      />
    );
  return <FilterChips label={f.label} options={[{ value: '1', label: f.label }]} value={s.filters[f.key] === true ? ['1'] : []} onChange={(v) => list.setFilter(f.key, v.length ? true : null)} />;
}

const activeOf = (f: AdminFilter, list: ListController): number => {
  const s = list.state;
  if (f.kind === 'custom') return f.active;
  if (f.kind === 'multi' || f.kind === 'single') return filterList(s, f.key).length;
  if (f.kind === 'range') return filterText(s, f.min) || filterText(s, f.max) ? 1 : 0;
  if (f.kind === 'date') return filterText(s, f.from) || filterText(s, f.to) ? 1 : 0;
  return s.filters[f.key] === true ? 1 : 0;
};

/** search · quick dropdowns · Filtres (n) · count on the end side; no `search` = a list whose API has no `q` (no search box) */
export function AdminFilterBar({ list, search, quick, panel = [], count, end }: { list: ListController; search?: string; quick: AdminFilter[]; panel?: AdminFilter[]; count?: string; end?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {search !== undefined ? <SearchInput value={list.state.q} onChange={(q) => list.set({ q })} label={t('action.search')} placeholder={search} clearLabel={t('list.clearSearch')} className="min-w-56 flex-1 md:max-w-80" /> : null}
        {quick.map((f) => (
          <FilterDropdown key={f.key} label={f.label} count={activeOf(f, list) || undefined}>
            <FilterBody f={f} list={list} />
          </FilterDropdown>
        ))}
        {panel.length ? (
          <Button onClick={() => setOpen(true)} data-testid="open-filters">
            <SlidersHorizontal className="size-4" aria-hidden />
            {list.activeCount ? t('action.filtersCount', { count: list.activeCount }) : t('action.filters')}
          </Button>
        ) : null}
        {end}
        {count ? <span className="ms-auto ts-label-micro text-text-muted" data-testid="list-count">{count}</span> : null}
      </div>
      <AdminActiveChips list={list} filters={[...quick, ...panel]} />
      {panel.length ? (
        <FilterPanel open={open} onClose={() => setOpen(false)} title={t('action.filters')} resetLabel={t('action.clearAll')} onReset={() => clearFilters(list)} applyLabel={t('action.apply')} closeLabel={t('action.close')}>
          {panel.map((f) => (
            <FilterGroup key={f.key} label={f.label}>
              <FilterBody f={f} list={list} />
            </FilterGroup>
          ))}
        </FilterPanel>
      ) : null}
    </div>
  );
}

/** Clears the search and every filter but keeps the tab — an admin tab is a record kind, not a filter (ADMIN-13). */
const clearFilters = (list: ListController) => list.set({ q: '', filters: Object.fromEntries(Object.keys(list.state.filters).map((k) => [k, null])) });

/** Active filters as chips (search first); `AdminActiveChips` shows them, the filtered-empty state names them (ADMIN-16). */
function activeChips(list: ListController, filters: AdminFilter[]): { key: string; label: string; onRemove: () => void }[] {
  const s = list.state;
  const items: { key: string; label: string; onRemove: () => void }[] = [];
  if (s.q.trim()) items.push({ key: 'q', label: `« ${s.q.trim()} »`, onRemove: () => list.set({ q: '' }) });
  for (const f of filters) {
    if (f.kind === 'custom') {
      if (f.active && f.chip) items.push({ key: f.key, label: `${f.label} : ${f.chip}`, onRemove: f.clear });
    } else if (f.kind === 'multi' || f.kind === 'single') {
      for (const v of filterList(s, f.key)) {
        const o = f.options.find((x) => x.value === v);
        items.push({ key: `${f.key}:${v}`, label: `${f.chipLabel ?? f.label} : ${o?.label ?? v}`, onRemove: () => list.setFilter(f.key, f.kind === 'multi' ? filterList(s, f.key).filter((x) => x !== v) : null) });
      }
    } else if (f.kind === 'range') {
      const a = filterText(s, f.min);
      const b = filterText(s, f.max);
      if (a || b) items.push({ key: f.key, label: `${f.label} : ${a || '…'} – ${b || '…'}`, onRemove: () => list.setFilters({ [f.min]: null, [f.max]: null }) });
    } else if (f.kind === 'date') {
      const a = filterText(s, f.from);
      const b = filterText(s, f.to);
      if (a || b) items.push({ key: f.key, label: `${f.label} : ${a || '…'} → ${b || '…'}`, onRemove: () => list.setFilters({ [f.from]: null, [f.to]: null }) });
    } else if (s.filters[f.key] === true) items.push({ key: f.key, label: f.label, onRemove: () => list.setFilter(f.key, null) });
  }
  return items;
}

export function AdminActiveChips({ list, filters }: { list: ListController; filters: AdminFilter[] }) {
  const t = useT();
  const items = activeChips(list, filters);
  if (!items.length) return null;
  return <ActiveFilters label={t('list.activeFilters')} items={items} clearLabel={t('action.clearAll')} onClear={items.length > 1 ? () => clearFilters(list) : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />;
}

/**
 * The six L6 states around a DataTable. `empty` = unfiltered empty copy (+ optional CTA). A tab of an admin list is the
 * kind of record shown (CMS types, Abonnements / Factures / Paiements…), not a filter: an empty tab is the « Vide » state
 * with its CTA (full-test 15/11 ADMIN-13). `filters` (the bar's dropdowns) let the filtered-empty state name what is
 * active — « Aucun résultat pour « zzzz · Statut : Suspendu » » (ADMIN-16); « Effacer les filtres » keeps the tab.
 */
export function AdminListBody<Row>({
  query,
  list,
  columns,
  rowKey,
  label,
  entity,
  empty,
  rowActions,
  onRowClick,
  card,
  testId,
  filters,
}: {
  query: UseQueryResult<AdminList<Row, unknown>>;
  list: ListController;
  columns: Column<Row>[];
  rowKey: (r: Row) => string;
  label: string;
  /** "espace" — used by the filtered-empty sentence */
  entity: string;
  empty: { title: string; description?: string; action?: { label: string; onClick: () => void } };
  rowActions?: (r: Row) => ReactNode;
  onRowClick?: (r: Row) => void;
  card?: (r: Row) => ReactNode;
  testId?: string;
  filters?: AdminFilter[];
}) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const online = useOnline();
  const s = list.state;
  if (query.isPending) return <Card><ListLoading rows={5} columns={Math.min(columns.length, 6)} /></Card>;
  if (query.isError && !query.data) return <AdminQueryError error={query.error} onRetry={() => void query.refetch()} />;
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  // the tab is not a filter here (ADMIN-13); a screen may narrow `list.filtered` further (support: 2-letter search)
  const filtered = list.filtered && (s.q.trim().length > 0 || Object.keys(s.filters).length > 0);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {!online && query.data ? <OfflineBanner since={formatDateTime(new Date(query.dataUpdatedAt).toISOString(), locale)} onRetry={() => void query.refetch()} /> : null}
      {rows.length === 0 && !filtered ? (
        <Card className="py-6" data-testid="list-empty">
          <EmptyState title={empty.title} description={empty.description} action={empty.action ? { label: empty.action.label, onClick: empty.action.onClick, variant: 'primary' } : undefined} />
        </Card>
      ) : rows.length === 0 ? (
        <ListFilteredEmpty entity={entity} filters={[s.q.trim(), ...activeChips(list, filters ?? []).filter((c) => c.key !== 'q').map((c) => c.label)].filter(Boolean).join(' · ')} onClear={() => clearFilters(list)} />
      ) : (
        <DataTable<Row>
          label={label}
          className={cn(query.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          activeRowKey={s.sheet}
          onRowClick={onRowClick}
          actionsLabel={t('action.actions')}
          rowActions={rowActions}
          card={card}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total} onChange={(p) => list.set(p)} />}
        />
      )}
    </div>
  );
}
