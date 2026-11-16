'use client';
// Filters of the movements journal — Figma "GDS-05 — Movements — list + filter panel" (06 §10 "Mouvements"):
// quick dropdown chips (Type, Motif, Période, Par), the "Filtres (n)" panel with the model-source label of each group,
// and the active chips. Every value lives in the URL under the API parameter name (`useListState`).
import { formatDate, formatNumber } from '@djaber/shared';
import { Combobox, FilterChips, FilterDateRange, FilterDropdown, FilterGroup, FilterPanel, FilterRange, Select, type ActiveFilter, type ComboOption, type FilterOption } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useMembers } from '@/features/workspace/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, filterText, type ListSpec } from '@/lib/list-state';
import { useSession, useWorkspaceId } from '@/lib/session';
import type { ListController } from '@/lib/use-list-state';
import { catalogApi, useCategories, useProduct } from '../api';
import { flattenCategories, MOVEMENT_REASONS, MOVEMENT_REF_TYPES, MOVEMENT_TYPES } from '../contracts';
import { activePeriod, PERIOD_PRESETS, periodRange, withoutYear, type PeriodPreset } from './logic';

/** `GET /stock/movements` parameters (06 §10). */
export const MOVEMENTS_SPEC: ListSpec = {
  filters: { type: 'list', reason: 'list', refType: 'list', refId: 'text', productId: 'text', variantId: 'text', createdById: 'text', from: 'date', to: 'date', minQty: 'int', maxQty: 'int', categoryId: 'text' },
  sorts: ['createdAt'],
  defaultSort: '-createdAt',
};

/** Model sources drawn next to each group of the panel (identifiers of the data model, not translated). */
const SOURCE = {
  type: 'StockMovement.type',
  product: 'productId → Product · variantId',
  reason: 'StockMovement.reason',
  reference: 'StockMovement.referenceType',
  period: 'StockMovement.createdAt',
  by: 'StockMovement.createdById → User',
  quantity: 'StockMovement.quantity (abs)',
  category: 'Product.categoryId → Category',
} as const;

/** Options, current values and chips shared by the bar and the panel. */
export function useMovementFilters(list: ListController, fallbackProductName?: string, refLabel?: string | null) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const { can } = useSession();
  const s = list.state;
  const productId = filterText(s, 'productId');
  const variantId = filterText(s, 'variantId');
  const createdById = filterText(s, 'createdById');
  const categoryId = filterText(s, 'categoryId');
  const from = filterText(s, 'from');
  const to = filterText(s, 'to');
  const minQty = filterText(s, 'minQty');
  const maxQty = filterText(s, 'maxQty');
  const types = filterList(s, 'type');
  const reasons = filterList(s, 'reason');
  const refTypes = filterList(s, 'refType');

  const product = useProduct(productId || null);
  const members = useMembers(can('members.read'));
  const categories = useCategories();

  const typeOptions: FilterOption[] = MOVEMENT_TYPES.map((v) => ({ value: v, label: t(`enum.StockMovement.type.${v}`) }));
  const reasonOptions: FilterOption[] = MOVEMENT_REASONS.map((v) => ({ value: v, label: t(`enum.StockMovement.reason.${v}`) }));
  const refTypeOptions: FilterOption[] = MOVEMENT_REF_TYPES.map((v) => ({ value: v, label: t(`movements.refType.${v}`) }));
  const periodOptions: FilterOption[] = PERIOD_PRESETS.map((v) => ({ value: v, label: t(`common.period.${v}`) }));
  const memberOptions: FilterOption[] = useMemo(
    () => [{ value: 'system', label: t('movements.system') }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email }))],
    [members.data, t],
  );
  const categoryOptions = useMemo(() => flattenCategories(categories.data ?? []), [categories.data]);

  const period = activePeriod(from, to);
  const day = (d: string) => withoutYear(formatDate(`${d}T12:00:00Z`, locale));
  const periodLabel = period === null ? null : period === 'custom' ? `${from ? day(from) : '…'} → ${to ? day(to) : '…'}` : t(`common.period.${period}`);
  const productName = product.data?.name ?? fallbackProductName ?? '…';
  const variantName = product.data?.variants?.find((v) => v.id === variantId)?.name ?? '…';
  const labels = (values: string[], options: FilterOption[]) => values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');

  const chips: ActiveFilter[] = [];
  const chip = (key: string, group: string, value: string, clear: Record<string, null>) => chips.push({ key, label: `${group} : ${value}`, onRemove: () => list.setFilters(clear) });
  if (types.length) chip('type', t('movements.filter.type'), labels(types, typeOptions), { type: null });
  if (productId) chip('productId', t('movements.filter.product'), productName, { productId: null, variantId: null });
  if (variantId) chip('variantId', t('movements.filter.variant'), variantName, { variantId: null });
  if (reasons.length) chip('reason', t('movements.filter.reason'), labels(reasons, reasonOptions), { reason: null });
  if (refTypes.length) chip('refType', t('movements.filter.reference'), labels(refTypes, refTypeOptions), { refType: null, refId: null });
  if (filterText(s, 'refId')) chip('refId', t('movements.filter.reference'), refLabel ? `#${refLabel}` : t('movements.filter.oneDocument'), { refId: null }); // J07-11: « #ACH-1001 »
  if (periodLabel) chip('period', t('movements.filter.period'), periodLabel, { from: null, to: null });
  if (createdById) chip('createdById', t('movements.filter.by'), labels([createdById], memberOptions), { createdById: null });
  if (minQty || maxQty) chip('qty', t('movements.filter.quantity'), `${minQty ? formatNumber(Number(minQty)) : '…'} – ${maxQty ? formatNumber(Number(maxQty)) : '…'}`, { minQty: null, maxQty: null });
  if (categoryId) chip('categoryId', t('movements.filter.category'), categoryOptions.find((c) => c.id === categoryId)?.label ?? '…', { categoryId: null });

  return {
    values: { productId, variantId, createdById, categoryId, from, to, minQty, maxQty, types, reasons, refTypes },
    options: { typeOptions, reasonOptions, refTypeOptions, periodOptions, memberOptions, categoryOptions },
    product: product.data ?? null,
    productName,
    period,
    periodLabel,
    chips,
    setPeriod: (p: string) => list.setFilters(periodRange(p as PeriodPreset)),
  };
}
export type MovementFilters = ReturnType<typeof useMovementFilters>;

/** Quick chips of the bar: Type ⌄ · Motif ⌄ · Période ⌄ · Par ⌄. */
export function MovementQuickFilters({ list, f }: { list: ListController; f: MovementFilters }) {
  const t = useT();
  const { values: v, options: o } = f;
  return (
    <>
      <FilterDropdown label={t('movements.filter.type')} count={v.types.length}>
        <FilterChips label={t('movements.filter.type')} multiple options={o.typeOptions} value={v.types} onChange={(next) => list.setFilter('type', next)} />
      </FilterDropdown>
      <FilterDropdown label={t('movements.filter.reason')} count={v.reasons.length}>
        <FilterChips label={t('movements.filter.reason')} multiple options={o.reasonOptions} value={v.reasons} onChange={(next) => list.setFilter('reason', next)} />
      </FilterDropdown>
      <FilterDropdown label={f.periodLabel ? t('common.period', { label: f.periodLabel }) : t('movements.filter.period')}>
        <PeriodFilter list={list} f={f} />
      </FilterDropdown>
      <FilterDropdown label={t('movements.filter.by')} count={v.createdById ? 1 : 0} align="end">
        <FilterChips label={t('movements.filter.by')} allLabel={t('movements.filter.allMembers')} options={o.memberOptions} value={v.createdById ? [v.createdById] : []} onChange={(next) => list.setFilter('createdById', next[0] ?? null)} />
      </FilterDropdown>
    </>
  );
}

function PeriodFilter({ list, f }: { list: ListController; f: MovementFilters }) {
  const t = useT();
  return (
    <FilterDateRange
      from={f.values.from}
      to={f.values.to}
      onChange={(next) => list.setFilters({ from: next.from || null, to: next.to || null })}
      presets={f.options.periodOptions}
      activePreset={f.period}
      onPreset={f.setPeriod}
      labels={{ from: t('common.from'), to: t('common.to'), presets: t('movements.filter.period'), invalid: t('error.INVALID_DATE_RANGE') }}
    />
  );
}

/** "Filtres (n)" side panel: filters apply live, the primary button closes the panel. */
export function MovementFilterPanel({ open, onClose, list, f, total }: { open: boolean; onClose: () => void; list: ListController; f: MovementFilters; total: number | null }) {
  const t = useT();
  const ws = useWorkspaceId();
  const { values: v, options: o } = f;
  const [search, setSearch] = useState('');
  const candidates = useQuery({
    queryKey: [ws, 'products', 'picker', 'movements', search],
    queryFn: () => catalogApi.products({ q: search.trim().length >= 2 ? search.trim() : '', pageSize: 25, page: 1, sort: 'name' }),
    enabled: open && !!ws,
  });
  const found: ComboOption[] = (candidates.data?.rows ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.sku }));
  const productOptions = v.productId && !found.some((x) => x.value === v.productId) ? [{ value: v.productId, label: f.productName }, ...found] : found;
  const variants = f.product?.hasVariants ? f.product.variants : [];

  return (
    <FilterPanel
      open={open}
      onClose={onClose}
      title={t('movements.panel.title')}
      summary={t('movements.panel.summary', { active: list.activeCount })}
      resetLabel={t('movements.panel.reset')}
      onReset={list.clear}
      applyLabel={total === null ? t('action.apply') : t('action.applyCount', { count: formatNumber(total) })}
      closeLabel={t('action.close')}
    >
      <FilterGroup label={t('movements.filter.type')} source={SOURCE.type}>
        <FilterChips label={t('movements.filter.type')} multiple options={o.typeOptions} value={v.types} onChange={(next) => list.setFilter('type', next)} />
      </FilterGroup>

      <FilterGroup label={t('movements.filter.productVariant')} source={SOURCE.product}>
        <Combobox
          value={v.productId || null}
          onChange={(id) => list.setFilters({ productId: id, variantId: null })}
          options={productOptions}
          onSearch={setSearch}
          loading={candidates.isFetching}
          placeholder={t('movements.filter.anyProduct')}
          searchPlaceholder={t('stock.adjust.productSearch')}
          emptyLabel={t('state.list.filteredEmpty.title')}
          clearLabel={t('movements.filter.anyProduct')}
        />
        {variants.length ? (
          <Select aria-label={t('movements.filter.variant')} value={v.variantId} onChange={(e) => list.setFilter('variantId', e.target.value || null)} className="!h-9 text-[13px]">
            <option value="">{t('movements.filter.anyVariant')}</option>
            {variants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        ) : null}
      </FilterGroup>

      <FilterGroup label={t('movements.filter.reason')} source={SOURCE.reason}>
        <FilterChips label={t('movements.filter.reason')} multiple options={o.reasonOptions} value={v.reasons} onChange={(next) => list.setFilter('reason', next)} />
      </FilterGroup>

      <FilterGroup label={t('movements.filter.reference')} source={SOURCE.reference}>
        <FilterChips label={t('movements.filter.reference')} multiple options={o.refTypeOptions} value={v.refTypes} onChange={(next) => list.setFilter('refType', next)} />
      </FilterGroup>

      <FilterGroup label={t('movements.filter.period')} source={SOURCE.period}>
        <PeriodFilter list={list} f={f} />
      </FilterGroup>

      <FilterGroup label={t('movements.filter.by')} source={SOURCE.by}>
        <Select aria-label={t('movements.filter.by')} value={v.createdById} onChange={(e) => list.setFilter('createdById', e.target.value || null)} className="!h-9 text-[13px]">
          <option value="">{t('movements.filter.allMembers')}</option>
          {o.memberOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </FilterGroup>

      <FilterGroup label={t('movements.filter.quantity')} source={SOURCE.quantity}>
        <FilterRange min={v.minQty} max={v.maxQty} onChange={(next) => list.setFilters({ minQty: next.min ? Number(next.min) : null, maxQty: next.max ? Number(next.max) : null })} labels={{ min: t('movements.filter.min'), max: t('movements.filter.max') }} />
      </FilterGroup>

      <FilterGroup label={t('movements.filter.category')} source={SOURCE.category}>
        <Select aria-label={t('movements.filter.category')} value={v.categoryId} onChange={(e) => list.setFilter('categoryId', e.target.value || null)} className="!h-9 text-[13px]">
          <option value="">{t('common.all')}</option>
          {o.categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </FilterGroup>
    </FilterPanel>
  );
}
