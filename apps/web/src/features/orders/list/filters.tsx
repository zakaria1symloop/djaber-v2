'use client';
// Orders list — filter bar (search · Source ⌄ · Confirmation ⌄ · Wilaya ⌄ · Période ⌄ · Filtres (n)), active chips and
// the "Filtres" panel. Figma "ORD-05 v2 — Orders — list" and "ORD-05 — Orders — filter panel open (model: Order)".
// Every value lives in the URL (`useListState`); the status group of the panel is the tab (one status filter only).
import { formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import {
  ActiveFilters,
  Button,
  Combobox,
  FilterCheckList,
  FilterChips,
  FilterDateRange,
  FilterDropdown,
  FilterGroup,
  FilterPanel,
  FilterRange,
  SearchInput,
  type FilterOption,
} from '@djaber/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAgents } from '@/features/agents/api';
import { useProduct, useProducts } from '@/features/catalog/api';
import { useChannels } from '@/features/channels/api';
import { useGeoWilayas } from '@/features/delivery/api';
import { wilayaLabel } from '@/features/delivery/geo';
import { useMembers } from '@/features/workspace/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterBool, filterList, filterText, formatSort, parseSort } from '@/lib/list-state';
import type { ListController } from '@/lib/use-list-state';
import { useOrderClient } from '../api';
import { ORDER_SORTS, PAYMENT_METHODS, type OrderStatus } from '../contracts';
import { activeChips, ORDER_TABS, PERIOD_PRESETS, periodOf, withoutValue, type PeriodPreset } from './spec';

const CONFIRMATIONS = ['pending', 'no_answer', 'confirmed', 'rejected', 'wrong_number', 'callback'] as const;
const PAYMENTS = ['unpaid', 'partial', 'paid', 'pending_link', 'refunded'] as const;
const DELIVERIES = ['not_sent', 'pending', 'sent', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned'] as const;
const PROVIDERS = ['zrexpress', 'ecotrack', 'yalidine', 'manual'] as const;
const SOURCES = ['ai', 'manual', 'mobile', 'api', 'import'] as const;

function useLabels() {
  const t = useT();
  const opts = (values: readonly string[], key: (v: string) => string): FilterOption[] => values.map((v) => ({ value: v, label: key(v) }));
  return {
    confirmation: opts(CONFIRMATIONS, (v) => t(`orders.filter.confirmation.${v}`)),
    payment: opts(PAYMENTS, (v) => t(`orders.filter.payment.${v}`)),
    method: opts(PAYMENT_METHODS, (v) => t(`orders.filter.method.${v}`)),
    delivery: opts(DELIVERIES, (v) => t(`orders.filter.delivery.${v}`)),
    provider: opts(PROVIDERS, (v) => t(`enum.Courier.${v}`)),
    source: opts(SOURCES, (v) => t(`orders.filter.source.${v}`)),
    period: opts(PERIOD_PRESETS, (v) => t(`common.period.${v}`)),
  };
}

function useWilayaOptions(enabled: boolean): FilterOption[] {
  const locale = useLocaleCode();
  const w = useGeoWilayas();
  return useMemo(() => (enabled ? (w.data ?? []).map((x) => ({ value: String(x.id), label: wilayaLabel(x, locale) })) : []), [w.data, locale, enabled]);
}

/* ---------- bar ---------- */
export function OrdersFilterBar({ list, onOpenPanel }: { list: ListController; onOpenPanel: () => void }) {
  const t = useT();
  const s = list.state;
  const l = useLabels();
  const wilayas = useWilayaOptions(true);
  const period = periodOf(s);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={s.q} onChange={(q) => list.set({ q })} label={t('action.search')} placeholder={t('orders.list.search')} clearLabel={t('list.clearSearch')} className="min-w-56" />
      <FilterDropdown label={t('orders.filter.sourceChip')} count={filterList(s, 'source').length || undefined}>
        <FilterChips label={t('orders.filter.sourceChip')} multiple options={l.source} value={filterList(s, 'source')} onChange={(v) => list.setFilter('source', v)} />
      </FilterDropdown>
      <FilterDropdown label={t('orders.filter.confirmationChip')} count={filterList(s, 'confirmationStatus').length || undefined}>
        <FilterCheckList options={l.confirmation} value={filterList(s, 'confirmationStatus')} onChange={(v) => list.setFilter('confirmationStatus', v)} />
      </FilterDropdown>
      <FilterDropdown label={t('orders.filter.wilayaChip')} count={filterList(s, 'wilayaId').length || undefined}>
        <FilterCheckList options={wilayas} value={filterList(s, 'wilayaId')} onChange={(v) => list.setFilter('wilayaId', v)} searchPlaceholder={t('orders.filter.wilayaSearch')} emptyLabel={t('geo.empty')} />
      </FilterDropdown>
      <FilterDropdown label={period ? t('common.period', { label: period === 'custom' ? t('common.period.custom') : t(`common.period.${period}`) }) : t('orders.filter.periodChip')} count={period ? 1 : undefined}>
        <FilterChips
          label={t('orders.filter.periodChip')}
          allLabel={t('common.allM')}
          options={l.period}
          value={period && period !== 'custom' ? [period] : []}
          onChange={(v) => list.setFilters({ period: v[0] ?? null, from: null, to: null })}
        />
      </FilterDropdown>
      <Button onClick={onOpenPanel} data-testid="open-filters">
        <SlidersHorizontal className="size-4" aria-hidden />
        {list.activeCount ? t('action.filtersCount', { count: list.activeCount }) : t('action.filters')}
      </Button>
    </div>
  );
}

/* ---------- chips under the bar ---------- */
export function OrdersActiveFilters({ list }: { list: ListController }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const s = list.state;
  const hasWilaya = filterList(s, 'wilayaId').length > 0;
  const wilayas = useWilayaOptions(hasWilaya);
  const channels = useChannels(filterList(s, 'channelId').length > 0);
  const agents = useAgents(undefined, filterList(s, 'agentId').length > 0);
  const assignee = filterText(s, 'assigneeId');
  const members = useMembers(!!assignee && assignee !== 'me' && assignee !== 'none');
  const client = useOrderClient(filterText(s, 'clientId') || null);
  const product = useProduct(filterText(s, 'productId') || null);
  const dict = (values: readonly string[], key: (v: string) => string) => Object.fromEntries(values.map((v) => [v, key(v)]));
  const day = (d: string) => (d ? formatDate(`${d}T12:00:00Z`, locale) : '…');
  const chips = activeChips(s, {
    search: (q) => t('orders.chip.search', { q }),
    confirmation: dict(CONFIRMATIONS, (v) => t(`orders.filter.confirmation.${v}`)),
    minCalls: (n) => t('orders.chip.minCalls', { count: n }),
    neverCalled: t('orders.filter.neverCalled'),
    payment: dict(PAYMENTS, (v) => t(`orders.filter.payment.${v}`)),
    method: dict(PAYMENT_METHODS, (v) => t(`orders.filter.method.${v}`)),
    hasRemaining: t('orders.filter.hasRemaining'),
    delivery: dict(DELIVERIES, (v) => t(`orders.filter.delivery.${v}`)),
    provider: dict(PROVIDERS, (v) => t(`enum.Courier.${v}`)),
    source: dict(SOURCES, (v) => t('orders.chip.source', { source: t(`orders.filter.source.${v}`) })),
    channel: (names) => t('orders.chip.channel', { names }),
    channelName: (id) => channels.data?.rows.find((c) => c.id === id)?.name ?? '…',
    agent: (names) => t('orders.chip.agent', { names }),
    agentName: (id) => agents.data?.rows.find((a) => a.id === id)?.name ?? '…',
    assignee: (name) => t('orders.chip.assignee', { name }),
    assigneeName: (id) => (id === 'me' ? t('orders.filter.assignee.me') : id === 'none' ? t('orders.filter.assignee.none') : (members.data?.find((m) => m.user.id === id)?.user.firstName ?? '…')),
    wilaya: (names) => t('orders.chip.wilaya', { names }),
    wilayaName: (id) => wilayas.find((w) => w.value === id)?.label ?? id,
    stopdesk: { true: t('common.stopdesk'), false: t('common.home') },
    total: (range) => t('orders.chip.total', { range }),
    period: dict(PERIOD_PRESETS, (v) => t(`orders.chip.period.${v}`)),
    range: (from, to) => t('orders.chip.range', { from: day(from), to: day(to) }),
    product: t('orders.chip.product', { name: product.data?.name ?? '…' }),
    client: t('orders.chip.client', { name: client.data?.name ?? '…' }),
    risk: { high: t('orders.filter.risk.high'), normal: t('orders.filter.risk.normal') },
    callbackDue: t('orders.filter.callbackDue'),
    ids: (n) => t('orders.chip.ids', { count: n }),
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
export function OrdersFilterPanel({ open, onClose, list, total }: { open: boolean; onClose: () => void; list: ListController; total: number | null }) {
  const t = useT();
  const s = list.state;
  const l = useLabels();
  const wilayas = useWilayaOptions(open);
  const channels = useChannels(open);
  const agents = useAgents(undefined, open);
  const members = useMembers(open);
  const [productQ, setProductQ] = useState('');
  const products = useProducts({ q: productQ.length >= 2 ? productQ : undefined, pageSize: 25 } as Record<string, string | number>, open);
  const productId = filterText(s, 'productId');
  const productOptions = (products.data?.rows ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.sku }));
  const sort = parseSort(s.sort);
  const period = periodOf(s);
  const rangeOf = (min: string, max: string) => ({
    min: filterText(s, min),
    max: filterText(s, max),
    onChange: (r: { min: string; max: string }) => list.setFilters({ [min]: r.min === '' ? null : Number(r.min), [max]: r.max === '' ? null : Number(r.max) }),
    labels: { min: t('products.filter.min'), max: t('products.filter.max') },
  });
  const assignee = filterText(s, 'assigneeId');
  const assigneeOptions: FilterOption[] = [
    { value: 'me', label: t('orders.filter.assignee.me') },
    ...(members.data ?? []).map((m) => ({ value: m.user.id, label: `${m.user.firstName} ${m.user.lastName.slice(0, 1)}.` })),
    { value: 'none', label: t('orders.filter.assignee.none') },
  ];
  const tabOptions: FilterOption[] = ORDER_TABS.map((k) => ({ value: k ?? 'all', label: k ? t(`orders.tab.${k}`) : t('orders.tab.all') }));
  const callsChips: FilterOption[] = [
    { value: 'min2', label: t('orders.filter.minCalls2') },
    { value: 'never', label: t('orders.filter.neverCalled') },
  ];
  const callsValue = [filterText(s, 'minCalls') === '2' ? 'min2' : null, filterBool(s, 'neverCalled') ? 'never' : null].filter(Boolean) as string[];
  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('action.filters')}
      summary={total === null ? t('orders.filter.summaryLoading', { count: list.activeCount }) : t('orders.filter.summary', { count: list.activeCount, n: total, results: formatNumber(total) })}
      resetLabel={t('products.filter.reset')}
      onReset={list.clear}
      applyLabel={total === null ? t('action.apply') : t('orders.filter.show', { count: total })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('common.status')} source={t('orders.filter.statusSource')}>
        <FilterChips label={t('common.status')} options={tabOptions} value={[s.tab ?? 'all']} onChange={(v) => list.set({ tab: !v[0] || v[0] === 'all' ? null : (v[0] as OrderStatus) })} />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.confirmation')} source="Order.confirmationStatus · callAttempts">
        <FilterCheckList options={l.confirmation} value={filterList(s, 'confirmationStatus')} onChange={(v) => list.setFilter('confirmationStatus', v)} />
        <FilterChips
          label={t('orders.filter.calls')}
          multiple
          options={callsChips}
          value={callsValue}
          onChange={(v) => {
            // "≥ 2 appels" and "Jamais appelée" exclude each other: the chip clicked last wins
            const added = v.find((x) => !callsValue.includes(x));
            const keep = added ? [added] : v;
            list.setFilters({ minCalls: keep.includes('min2') ? 2 : null, neverCalled: keep.includes('never') ? true : null });
          }}
        />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.payment')} source="Order.paymentStatus · paymentMethod">
        <FilterChips label={t('orders.filter.payment')} multiple options={l.payment} value={filterList(s, 'paymentStatus')} onChange={(v) => list.setFilter('paymentStatus', v)} />
        <FilterChips label={t('orders.filter.method')} multiple options={l.method} value={filterList(s, 'paymentMethod')} onChange={(v) => list.setFilter('paymentMethod', v)} />
        <FilterCheckList options={[{ value: 'yes', label: t('orders.filter.hasRemaining') }]} value={filterBool(s, 'hasRemaining') ? ['yes'] : []} onChange={(v) => list.setFilter('hasRemaining', v.length ? true : null)} />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.delivery')} source="Order.deliveryStatus · Shipment.provider">
        <FilterChips label={t('orders.filter.delivery')} multiple options={l.delivery} value={filterList(s, 'deliveryStatus')} onChange={(v) => list.setFilter('deliveryStatus', v)} />
        <FilterChips label={t('orders.filter.provider')} multiple options={l.provider} value={filterList(s, 'shipmentProvider')} onChange={(v) => list.setFilter('shipmentProvider', v)} />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.sourceChannel')} source="Order.source · channelId · agentId">
        <FilterChips label={t('orders.filter.sourceChip')} multiple options={l.source} value={filterList(s, 'source')} onChange={(v) => list.setFilter('source', v)} />
        {channels.data?.rows.length ? <FilterCheckList options={channels.data.rows.map((c) => ({ value: c.id, label: `${c.name} (${c.platform === 'facebook' ? 'FB' : 'IG'})` }))} value={filterList(s, 'channelId')} onChange={(v) => list.setFilter('channelId', v)} /> : null}
        {agents.data?.rows.length ? <FilterChips label={t('orders.filter.agent')} multiple options={agents.data.rows.map((a) => ({ value: a.id, label: a.name }))} value={filterList(s, 'agentId')} onChange={(v) => list.setFilter('agentId', v)} /> : null}
      </FilterGroup>
      <FilterGroup label={t('orders.filter.assignee')} source="Order.assigneeId">
        <FilterChips label={t('orders.filter.assignee')} options={assigneeOptions} value={assignee ? [assignee] : []} onChange={(v) => list.setFilter('assigneeId', v[0] ?? null)} />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.wilayaStopdesk')} source="Order.wilayaId · isStopdesk">
        <FilterCheckList options={wilayas} value={filterList(s, 'wilayaId')} onChange={(v) => list.setFilter('wilayaId', v)} searchPlaceholder={t('orders.filter.wilayaSearch')} emptyLabel={t('geo.empty')} maxHeight={160} />
        <FilterChips
          label={t('orders.filter.deliveryMode')}
          options={[
            { value: 'false', label: t('common.home') },
            { value: 'true', label: t('common.stopdesk') },
          ]}
          value={filterText(s, 'isStopdesk') ? [filterText(s, 'isStopdesk')] : []}
          onChange={(v) => list.setFilter('isStopdesk', v[0] ?? null)}
        />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.total')} source="Order.total">
        <FilterRange {...rangeOf('minTotal', 'maxTotal')} unit={t('common.currency')} />
      </FilterGroup>
      <FilterGroup label={t('common.date')} source={t('orders.filter.dateSource')}>
        <FilterDateRange
          from={filterText(s, 'from')}
          to={filterText(s, 'to')}
          onChange={(r) => list.setFilters({ from: r.from || null, to: r.to || null, period: null })}
          presets={[...PERIOD_PRESETS.map((p) => ({ value: p, label: t(`common.period.${p}`) })), { value: 'custom', label: t('common.period.custom') }]}
          activePreset={period}
          onPreset={(p) => (p === 'custom' ? undefined : list.setFilters({ period: p as PeriodPreset, from: null, to: null }))}
          labels={{ from: t('common.from'), to: t('common.to'), presets: t('common.date') }}
        />
      </FilterGroup>
      <FilterGroup label={t('orders.filter.product')} source="OrderItem.productId">
        <Combobox
          value={productId || null}
          onChange={(v) => list.setFilter('productId', v)}
          options={productOptions.some((o) => o.value === productId) || !productId ? productOptions : [...productOptions, { value: productId, label: t('orders.filter.productCurrent') }]}
          onSearch={setProductQ}
          loading={products.isFetching}
          placeholder={t('orders.filter.productPlaceholder')}
          searchPlaceholder={t('orders.filter.productPlaceholder')}
          emptyLabel={t('geo.empty')}
          clearLabel={t('geo.clear')}
        />
      </FilterGroup>
      <FilterGroup label={t('common.risk')} source="Order.riskLevel">
        <FilterChips
          label={t('common.risk')}
          allLabel={t('common.allM')}
          options={[{ value: 'high', label: t('orders.filter.risk.high') }]}
          value={filterText(s, 'riskLevel') ? [filterText(s, 'riskLevel')] : []}
          onChange={(v) => list.setFilter('riskLevel', v[0] ?? null)}
        />
      </FilterGroup>
      <FilterGroup label={t('products.filter.sort')} source="sort=…">
        <div role="radiogroup" aria-label={t('products.filter.sort')} className="flex flex-wrap gap-1.5">
          {ORDER_SORTS.map((k) => {
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
                {t(`orders.sort.${k}`)}
                {on ? <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
              </button>
            );
          })}
        </div>
      </FilterGroup>
    </FilterPanel>
  );
}
