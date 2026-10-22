'use client';
// Clients list — filter bar, active chips and the "Filtres" panel. Figma "CLI-03 — Clients — list with detail sheet"
// (bar: search · Source ⌄ · Étiquettes ⌄ · Période · Filtres) and "CLI-03 — Clients — filter panel + row menu (model:
// Client)". Every value lives in the URL (`useListState`).
import { formatDate, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import { ActiveFilters, Button, FilterCheckList, InlineAdd, FilterChips, FilterDateRange, FilterDropdown, FilterGroup, FilterPanel, FilterRange, SearchInput, type FilterOption } from '@djaber/ui';
import { CalendarDays, PhoneCall, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useChannels } from '@/features/channels/api';
import { useGeoWilayas } from '@/features/delivery/api';
import { wilayaLabel } from '@/features/delivery/geo';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterBool, filterList, filterText, formatSort, parseSort } from '@/lib/list-state';
import type { ListController } from '@/lib/use-list-state';
import { CLIENT_SORTS } from './contracts';
import { activeChips, CLIENT_DATE_PRESETS, CLIENT_SOURCES, LAST_ORDER_FILTERS, matchPreset, ORDER_CHIPS, orderChipsPatch, orderChipsValue, presetRange, QUALITY_FILTERS, withoutValue } from './spec';

const NO_CONVERSATION = '__none';

const useOpts = () => {
  const t = useT();
  return (values: readonly string[], prefix: string): FilterOption[] => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));
};

function DateBody({ list }: { list: ListController }) {
  const t = useT();
  const s = list.state;
  const from = filterText(s, 'createdFrom');
  const to = filterText(s, 'createdTo');
  const set = (r: { from: string; to: string }) => list.setFilters({ createdFrom: r.from || null, createdTo: r.to || null });
  return (
    <FilterDateRange
      from={from}
      to={to}
      onChange={set}
      presets={[...CLIENT_DATE_PRESETS.map((p) => ({ value: p, label: t(`common.period.${p}`) })), { value: 'custom', label: t('common.period.custom') }]}
      activePreset={matchPreset(from, to)}
      onPreset={(p) => (p === 'custom' ? undefined : set(presetRange(p as (typeof CLIENT_DATE_PRESETS)[number])))}
      labels={{ from: t('common.from'), to: t('common.to'), presets: t('clients.filter.created') }}
    />
  );
}

/**
 * Tags of the loaded rows + the picked ones, and a free entry: no endpoint lists every tag of the workspace, so a tag
 * carried only by clients of other pages is typed (exact tag, as stored).
 */
function TagsFilterBody({ tags, picked, onChange }: { tags: string[]; picked: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const options = [...new Set([...tags, ...picked])].map((x) => ({ value: x, label: x }));
  const add = () => {
    const tag = typed.trim();
    if (!tag) return;
    if (!picked.includes(tag)) onChange([...picked, tag]);
    setTyped('');
  };
  return (
    <div className="flex flex-col gap-2">
      <FilterCheckList options={options} value={picked} onChange={onChange} emptyLabel={t('clients.filter.noTags')} searchPlaceholder={options.length > 8 ? t('clients.filter.tagSearch') : undefined} />
      <InlineAdd value={typed} onChange={setTyped} onAdd={add} placeholder={t('clients.filter.tagSearch')} label={t('clients.filter.tags')} addLabel={t('action.add')} />
    </div>
  );
}

/* ---------- bar: search · Source ⌄ · Étiquettes ⌄ · Période · Filtres (n) ---------- */
export function ClientsFilterBar({ list, tags, onOpenPanel }: { list: ListController; tags: string[]; onOpenPanel: () => void }) {
  const t = useT();
  const opts = useOpts();
  const s = list.state;
  const sources = filterList(s, 'source');
  const picked = filterList(s, 'tags');
  const dates = filterText(s, 'createdFrom') || filterText(s, 'createdTo') ? 1 : 0;
  const unconfirmed = filterBool(s, 'unconfirmed');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={s.q} onChange={(q) => list.set({ q })} label={t('action.search')} placeholder={t('clients.list.search')} clearLabel={t('list.clearSearch')} className="min-w-52" />
      <FilterDropdown label={t('clients.filter.source')} count={sources.length || undefined}>
        <FilterChips label={t('clients.filter.source')} multiple options={opts(CLIENT_SOURCES, 'clients.source')} value={sources} onChange={(v) => list.setFilter('source', v)} />
      </FilterDropdown>
      <FilterDropdown label={t('clients.filter.tags')} count={picked.length || undefined}>
        <TagsFilterBody tags={tags} picked={picked} onChange={(v) => list.setFilter('tags', v)} />
      </FilterDropdown>
      <FilterDropdown label={t('clients.filter.period')} count={dates || undefined}>
        <div className="flex items-center gap-2 pb-2 ts-label-section text-text-muted">
          <CalendarDays className="size-3.5" aria-hidden />
          {t('clients.filter.created')}
        </div>
        <DateBody list={list} />
      </FilterDropdown>
      {/* PV 22/10: the customers to call back, one click away */}
      <Button variant={unconfirmed ? 'primary' : 'secondary'} aria-pressed={unconfirmed} title={t('clients.filter.unconfirmedHint')} onClick={() => list.setFilters({ unconfirmed: unconfirmed ? null : true })} data-testid="filter-unconfirmed">
        <PhoneCall className="size-4" aria-hidden />
        {t('clients.filter.unconfirmed')}
      </Button>
      <Button onClick={onOpenPanel} data-testid="open-filters">
        <SlidersHorizontal className="size-4" aria-hidden />
        {list.activeCount ? t('action.filtersCount', { count: list.activeCount }) : t('action.filters')}
      </Button>
    </div>
  );
}

/* ---------- chips under the bar ---------- */
export function ClientsActiveFilters({ list }: { list: ListController }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const channels = useChannels(filterList(list.state, 'channelId').length > 0);
  const wilayas = useGeoWilayas();
  const chips = activeChips(list.state, {
    search: (q) => t('clients.chip.search', { q }),
    source: Object.fromEntries(CLIENT_SOURCES.map((v) => [v, t('clients.chip.source', { source: t(`clients.source.${v}`) })])),
    quality: Object.fromEntries(QUALITY_FILTERS.map((v) => [v, t(`clients.filter.quality.${v}`)])),
    tags: (names) => t('clients.chip.tags', { names }),
    risk: t('clients.filter.risk.high'),
    channel: (names) => t('clients.chip.channel', { names }),
    channelName: (id) => channels.data?.rows.find((c) => c.id === id)?.name ?? '…',
    noConversation: t('clients.filter.noConversation'),
    orders: (range) => t('clients.chip.orders', { range }),
    neverOrdered: t('clients.filter.orders.neverOrdered'),
    unconfirmed: t('clients.filter.unconfirmed'),
    returned: t('clients.filter.orders.returned'),
    spent: (range) => t('clients.chip.spent', { range }),
    lastOrder: Object.fromEntries(LAST_ORDER_FILTERS.map((v) => [v, t('clients.chip.lastOrder', { label: t(`clients.filter.lastOrder.${v}`) })])),
    wilaya: (names) => t('clients.chip.wilaya', { names }),
    wilayaName: (id) => {
      const w = wilayas.data?.find((x) => String(x.id) === id);
      return w ? (locale === 'ar' ? w.nameAr : w.nameFr) : id;
    },
    created: (range) => t('clients.chip.created', { range }),
    blocked: t('enum.Client.blocked'),
    date: (day) => formatDate(`${day}T12:00:00Z`, locale),
    money: formatMoney,
    number: formatNumber,
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
export function ClientsFilterPanel({ open, onClose, list, tags, total }: { open: boolean; onClose: () => void; list: ListController; tags: string[]; total: number | null }) {
  const t = useT();
  const locale = useLocaleCode();
  const opts = useOpts();
  const s = list.state;
  const channels = useChannels(open);
  const wilayas = useGeoWilayas();
  const wilayaOptions = useMemo(() => (wilayas.data ?? []).map((w) => ({ value: String(w.id), label: wilayaLabel(w, locale) })), [wilayas.data, locale]);
  const rangeOf = (min: string, max: string) => ({
    min: filterText(s, min),
    max: filterText(s, max),
    onChange: (r: { min: string; max: string }) => list.setFilters({ [min]: r.min === '' ? null : Number(r.min), [max]: r.max === '' ? null : Number(r.max) }),
    labels: { min: t('clients.filter.min'), max: t('clients.filter.max') },
  });
  const channelValue = [...filterList(s, 'channelId'), ...(filterBool(s, 'noConversation') ? [NO_CONVERSATION] : [])];
  const orderChips = orderChipsValue(s);
  const sort = parseSort(s.sort);
  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('action.filters')}
      summary={total === null ? t('clients.filter.summaryLoading', { count: list.activeCount }) : t('clients.filter.summary', { count: list.activeCount, results: formatNumber(total) })}
      resetLabel={t('clients.filter.reset')}
      onReset={list.clear}
      applyLabel={total === null ? t('action.apply') : t('clients.filter.show', { count: total })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('clients.filter.source')} source="Client.source">
        <FilterChips label={t('clients.filter.source')} multiple allLabel={t('common.allM')} options={CLIENT_SOURCES.map((v) => ({ value: v, label: t(`clients.filter.sourceChip.${v}`) }))} value={filterList(s, 'source')} onChange={(v) => list.setFilter('source', v)} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.quality')} source="isPlaceholder · phone · addresses">
        <FilterCheckList options={opts(QUALITY_FILTERS, 'clients.filter.quality')} value={filterList(s, 'quality')} onChange={(v) => list.setFilter('quality', v)} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.tags')} source="Client.tags[]">
        {tags.length ? <FilterChips label={t('clients.filter.tags')} multiple options={tags.map((x) => ({ value: x, label: x }))} value={filterList(s, 'tags')} onChange={(v) => list.setFilter('tags', v)} /> : <p className="ts-label-meta text-text-muted">{t('clients.filter.noTags')}</p>}
      </FilterGroup>
      <FilterGroup label={t('common.risk')} source="Client.riskLevel">
        <FilterChips label={t('common.risk')} allLabel={t('common.allM')} options={[{ value: 'high', label: t('clients.filter.risk.highLong') }]} value={filterText(s, 'riskLevel') ? [filterText(s, 'riskLevel')] : []} onChange={(v) => list.setFilter('riskLevel', v[0] ?? null)} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.channel')} source="ClientIdentity.channelId">
        <FilterCheckList
          options={[...(channels.data?.rows ?? []).map((c) => ({ value: c.id, label: `${c.name} (${t(`enum.Channel.platform.${c.platform}`)})` })), { value: NO_CONVERSATION, label: t('clients.filter.noConversation') }]}
          value={channelValue}
          onChange={(v) => list.setFilters({ channelId: v.filter((x) => x !== NO_CONVERSATION), noConversation: v.includes(NO_CONVERSATION) || null })}
        />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.orders')} source="Client.orderCount">
        <FilterRange {...rangeOf('minOrders', 'maxOrders')} unit={t('clients.filter.ordersUnit')} />
        <FilterChips label={t('clients.filter.orders')} multiple options={ORDER_CHIPS.map((v) => ({ value: v, label: t(`clients.filter.orders.${v}`) }))} value={orderChips} onChange={(v) => list.setFilters(orderChipsPatch(v as typeof orderChips, orderChips))} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.spent')} source="Client.totalSpent (livré)">
        <FilterRange {...rangeOf('minSpent', 'maxSpent')} unit={t('common.currency')} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.lastOrder')} source="Client.lastOrderAt">
        <FilterChips label={t('clients.filter.lastOrder')} options={opts(LAST_ORDER_FILTERS, 'clients.filter.lastOrder')} value={filterText(s, 'lastOrder') ? [filterText(s, 'lastOrder')] : []} onChange={(v) => list.setFilter('lastOrder', v[0] ?? null)} />
      </FilterGroup>
      <FilterGroup label={t('common.wilaya')} source="ClientAddress.wilayaId">
        <FilterCheckList options={wilayaOptions} value={filterList(s, 'wilayaId')} onChange={(v) => list.setFilter('wilayaId', v)} searchPlaceholder={t('clients.filter.wilayaSearch')} emptyLabel={t('geo.empty')} maxHeight={160} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.created')} source="Client.createdAt">
        <DateBody list={list} />
      </FilterGroup>
      <FilterGroup label={t('clients.filter.sort')} source="sort">
        <div role="radiogroup" aria-label={t('clients.filter.sort')} className="flex flex-wrap gap-1.5">
          {CLIENT_SORTS.map((k) => {
            const on = sort.key === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => list.set({ sort: formatSort({ key: k, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' }) })}
                className={`inline-flex h-7 items-center gap-1 rounded-[6px] border px-2.5 ts-label-meta ${on ? 'border-line-lit bg-ink-raised-high text-text-primary' : 'border-line-edge text-text-secondary hover:text-text-primary'}`}
              >
                {t(`clients.sort.${k}`)}
                {on ? <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
              </button>
            );
          })}
        </div>
      </FilterGroup>
    </FilterPanel>
  );
}
