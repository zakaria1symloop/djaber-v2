'use client';
// Products list — filter bar, active chips and the "Filtres" panel. Figma "CAT-08 — Products — list (advanced)" and
// "CAT-08 — Products — filter panel open (model: Product)". Every value lives in the URL (`useListState`).
import { formatDate, formatNumber, PRODUCT_SORTS, type AppLocale } from '@djaber/shared';
import {
  ActiveFilters,
  Button,
  FilterCheckList,
  FilterChips,
  FilterDateRange,
  FilterDropdown,
  FilterGroup,
  FilterPanel,
  FilterRange,
  FilterToggle,
  SearchInput,
  SegmentedControl,
  type FilterOption,
} from '@djaber/ui';
import { LayoutGrid, List, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAgents } from '@/features/agents/api';
import { useSupplier } from '@/features/gds/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterBool, filterList, filterText, formatSort, parseSort } from '@/lib/list-state';
import type { ListController } from '@/lib/use-list-state';
import { flattenCategories, type Category } from '../contracts';
import { activeChips, agentFilterOptions, agentFilterPatch, DATE_PRESETS, NO_AGENT, matchPreset, presetRange, withoutValue, type DatePreset } from './spec';

const STATUSES = ['active', 'inactive', 'archived'] as const;
const TYPES = ['stock', 'service', 'variants', 'no_variants'] as const;
const STOCK_STATES = ['low', 'out', 'in_stock'] as const;

export function useCategoryOptions(categories: readonly Category[] | undefined): FilterOption[] {
  return useMemo(() => flattenCategories(categories ?? []).map((c) => ({ value: c.id, label: c.label, count: c.category.productCount })), [categories]);
}

/* ---------- bar: search · Catégorie ⌄ · ⚠ Stock faible · n · Filtres (n) · Grille ---------- */
export function ProductsFilterBar({ list, categories, lowStockCount, onOpenPanel }: { list: ListController; categories: FilterOption[]; lowStockCount: number | null; onOpenPanel: () => void }) {
  const t = useT();
  const s = list.state;
  const cats = filterList(s, 'categoryIds');
  const grid = s.layout === 'grid';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={s.q} onChange={(q) => list.set({ q })} label={t('action.search')} placeholder={t('products.list.search')} clearLabel={t('list.clearSearch')} className="min-w-52" />
      <FilterDropdown label={t('products.list.category')} count={cats.length || undefined}>
        <FilterCheckList options={categories} value={cats} onChange={(v) => list.setFilter('categoryIds', v)} searchPlaceholder={categories.length > 8 ? t('products.filter.categorySearch') : undefined} emptyLabel={t('products.filter.noCategory')} />
      </FilterDropdown>
      <FilterToggle pressed={filterBool(s, 'lowStock')} onPressedChange={(v) => list.setFilters({ lowStock: v || null, stockState: null })} tone="warning">
        <TriangleAlert className="size-4 text-accent-starred" aria-hidden />
        {lowStockCount === null ? t('products.list.lowStock') : t('products.list.lowStockCount', { count: formatNumber(lowStockCount) })}
      </FilterToggle>
      <Button onClick={onOpenPanel} data-testid="open-filters">
        <SlidersHorizontal className="size-4" aria-hidden />
        {list.activeCount ? t('action.filtersCount', { count: list.activeCount }) : t('action.filters')}
      </Button>
      <Button variant="ghost" aria-pressed={grid} onClick={() => list.set({ layout: grid ? null : 'grid' })} className="max-md:hidden">
        {grid ? <List className="size-4" aria-hidden /> : <LayoutGrid className="size-4" aria-hidden />}
        {grid ? t('products.list.layout.table') : t('products.list.layout.grid')}
      </Button>
    </div>
  );
}

/* ---------- chips under the bar ---------- */
export function ProductsActiveFilters({ list, categories }: { list: ListController; categories: FilterOption[] }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const agents = useAgents(undefined, filterList(list.state, 'agentId').length > 0);
  // `?supplierId=` comes from the supplier sheet "Voir les produits (n)" (M11): the chip shows the supplier's name
  const supplier = useSupplier(filterText(list.state, 'supplierId') || null);
  const chips = activeChips(list.state, {
    supplier: (name) => t('carry.products.chip.supplier', { name }),
    supplierName: (id) => (supplier.data?.id === id ? supplier.data.name : '…'),
    search: (q) => t('products.chip.search', { q }),
    category: (names) => t('products.chip.category', { names }),
    categoryName: (id) => categories.find((c) => c.value === id)?.label ?? '…',
    status: Object.fromEntries(STATUSES.map((v) => [v, t(`products.filter.status.${v}`)])),
    type: Object.fromEntries(TYPES.map((v) => [v, t(`products.filter.type.${v}`)])),
    stockState: Object.fromEntries(STOCK_STATES.map((v) => [v, t(`products.filter.stock.${v}`)])),
    lowStock: t('products.filter.stock.low'),
    noAgent: t('products.filter.noAgent'),
    agent: (names) => t('products.chip.agent', { names }),
    agentName: (id) => agents.data?.rows.find((a) => a.id === id)?.name ?? '…',
    moderation: Object.fromEntries(['not_required', 'pending', 'approved', 'rejected', 'appealed'].map((v) => [v, t(`products.filter.moderation.${v}`)])),
    qty: (range) => t('products.chip.qty', { range }),
    price: (range) => t('products.chip.price', { range }),
    cost: (range) => t('products.chip.cost', { range }),
    margin: (range) => t('products.chip.margin', { range }),
    created: (range) => t('products.chip.created', { range }),
    updated: (range) => t('products.chip.updated', { range }),
    date: (day) => formatDate(`${day}T12:00:00Z`, locale),
  });
  return (
    <ActiveFilters
      label={t('list.activeFilters')}
      items={chips.map((c) => ({
        key: c.key,
        label: c.label,
        onRemove: () => {
          if (c.clear === 'q') return list.set({ q: '' });
          const [name, value] = c.key.split(':');
          // one value of a multi filter: the others stay
          if (value && name) return list.setFilter(name, withoutValue(list.state, name, value));
          list.setFilters(c.clear);
        },
      }))}
      clearLabel={t('action.clearAll')}
      onClear={chips.length > 1 ? list.clear : undefined}
      removeLabel={(label) => t('list.removeFilter', { label })}
    />
  );
}

/* ---------- panel ---------- */
export function ProductsFilterPanel({ open, onClose, list, categories, total, advanced }: { open: boolean; onClose: () => void; list: ListController; categories: FilterOption[]; total: number | null; advanced: boolean }) {
  const t = useT();
  const s = list.state;
  const [dateField, setDateField] = useState<'created' | 'updated'>(filterText(s, 'updatedFrom') || filterText(s, 'updatedTo') ? 'updated' : 'created');
  const from = filterText(s, `${dateField}From`);
  const to = filterText(s, `${dateField}To`);
  const setDates = (r: { from: string; to: string }) => list.setFilters({ createdFrom: null, createdTo: null, updatedFrom: null, updatedTo: null, [`${dateField}From`]: r.from || null, [`${dateField}To`]: r.to || null });
  const stock = filterBool(s, 'lowStock') ? ['low'] : filterList(s, 'stockState');
  const rangeOf = (min: string, max: string) => ({
    min: filterText(s, min),
    max: filterText(s, max),
    onChange: (r: { min: string; max: string }) => list.setFilters({ [min]: r.min === '' ? null : Number(r.min), [max]: r.max === '' ? null : Number(r.max) }),
    labels: { min: t('products.filter.min'), max: t('products.filter.max') },
  });
  const opts = (values: readonly string[], prefix: string): FilterOption[] => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));
  const sort = parseSort(s.sort);
  const preset = matchPreset(from, to);
  const agents = useAgents(undefined, open);
  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('action.filters')}
      summary={total === null ? t('products.filter.summaryLoading', { count: list.activeCount }) : t('products.filter.summary', { count: list.activeCount, results: formatNumber(total) })}
      resetLabel={t('products.filter.reset')}
      onReset={list.clear}
      applyLabel={total === null ? t('action.apply') : t('products.filter.show', { count: total })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('products.filter.categories')} source="Product.categoryId ∈ []">
        <FilterCheckList options={categories} value={filterList(s, 'categoryIds')} onChange={(v) => list.setFilter('categoryIds', v)} searchPlaceholder={t('products.filter.categorySearch')} emptyLabel={t('products.filter.noCategory')} />
      </FilterGroup>
      <FilterGroup label={t('common.status')} source="Product.isActive · deletedAt">
        <FilterChips label={t('common.status')} multiple options={opts(STATUSES, 'products.filter.status')} value={filterList(s, 'status')} onChange={(v) => list.setFilter('status', v)} />
      </FilterGroup>
      <FilterGroup label={t('products.filter.type')} source="Product.trackStock · hasVariants">
        <FilterChips label={t('products.filter.type')} multiple options={opts(TYPES, 'products.filter.type')} value={filterList(s, 'type')} onChange={(v) => list.setFilter('type', v)} />
      </FilterGroup>
      <FilterGroup label={t('products.filter.stockState')} source="stock vs minStock">
        <FilterChips label={t('products.filter.stockState')} multiple allLabel={t('common.allM')} options={opts(STOCK_STATES, 'products.filter.stock')} value={stock} onChange={(v) => list.setFilters({ lowStock: null, stockState: v })} />
      </FilterGroup>
      <FilterGroup label={t('products.filter.qty')} source="Product.stock · Σ variantes">
        <FilterRange {...rangeOf('minQty', 'maxQty')} unit={t('products.filter.units')} />
      </FilterGroup>
      <FilterGroup label={t('products.filter.price')} source="Product.price">
        <FilterRange {...rangeOf('minPrice', 'maxPrice')} unit={t('common.currency')} />
      </FilterGroup>
      {advanced ? (
        <>
          <FilterGroup label={t('products.filter.cost')} source="Product.costPrice">
            <FilterRange {...rangeOf('minCost', 'maxCost')} unit={t('common.currency')} />
          </FilterGroup>
          <FilterGroup label={t('products.filter.margin')} source="(price − true cost) / price · EXP-02">
            <FilterRange {...rangeOf('minMargin', 'maxMargin')} unit="%" />
          </FilterGroup>
        </>
      ) : null}
      <FilterGroup label={t('products.filter.agent')} source="AgentProduct">
        {/* "Aucun agent" and the agents exclude each other: a product sold by nobody is sold by no one of them */}
        <FilterChips
          label={t('products.filter.agent')}
          multiple
          allLabel={t('common.allM')}
          options={agentFilterOptions(agents.data?.rows ?? [], t('products.filter.noAgent'))}
          value={filterBool(s, 'noAgent') ? [NO_AGENT] : filterList(s, 'agentId')}
          onChange={(v) => list.setFilters(agentFilterPatch(v, filterBool(s, 'noAgent')))}
        />
      </FilterGroup>
      <FilterGroup label={t('products.filter.moderation')} source="Product.moderationStatus">
        <FilterChips label={t('products.filter.moderation')} multiple options={opts(['pending', 'approved', 'rejected', 'appealed'], 'products.filter.moderation')} value={filterList(s, 'moderationStatus')} onChange={(v) => list.setFilter('moderationStatus', v)} />
      </FilterGroup>
      <FilterGroup label={t('products.filter.dates')} source="createdAt · updatedAt">
        <SegmentedControl<'created' | 'updated'>
          label={t('products.filter.dates')}
          value={dateField}
          onChange={(v) => {
            setDateField(v);
            if (from || to) list.setFilters({ createdFrom: null, createdTo: null, updatedFrom: null, updatedTo: null, [`${v}From`]: from || null, [`${v}To`]: to || null });
          }}
          options={[
            { value: 'created', label: t('products.filter.dates.created') },
            { value: 'updated', label: t('products.filter.dates.updated') },
          ]}
        />
        <FilterDateRange
          from={from}
          to={to}
          onChange={setDates}
          presets={[...DATE_PRESETS.map((p) => ({ value: p, label: t(`common.period.${p}`) })), { value: 'custom', label: t('common.period.custom') }]}
          activePreset={preset}
          onPreset={(p) => (p === 'custom' ? undefined : setDates(presetRange(p as DatePreset)))}
          labels={{ from: t('common.from'), to: t('common.to'), presets: t('products.filter.dates') }}
        />
      </FilterGroup>
      <FilterGroup label={t('products.filter.sort')} source="sort=…">
        <div role="radiogroup" aria-label={t('products.filter.sort')} className="flex flex-wrap gap-1.5">
          {PRODUCT_SORTS.filter((k) => advanced || k !== 'cost').map((k) => {
            const on = sort.key === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => list.set({ sort: formatSort({ key: k, dir: on && sort.dir === 'asc' ? 'desc' : 'asc' }) })}
                className={`inline-flex h-7 items-center gap-1 rounded-[6px] border px-2.5 ts-label-meta ${on ? 'border-line-lit bg-ink-raised-high text-text-primary' : 'border-line-edge text-text-secondary hover:text-text-primary'}`}
              >
                {t(`products.sort.${k}`)}
                {on ? <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
              </button>
            );
          })}
        </div>
      </FilterGroup>
    </FilterPanel>
  );
}
