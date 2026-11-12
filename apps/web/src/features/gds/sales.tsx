'use client';
// /sales and /sales/new — Figma "GDS-08 — Sales (counter) — list + new sale with partial payment" (03 GDS-07, 12 §21
// "New sale"). KPIs following the filters (`GET /sales/stats`), search + Paiement / Vendeur / Client / Période chips
// (URL), rows with the walk-in "Passage", the items, payment pills, `Actions ⌄` from the server descriptors; the
// "Nouvelle vente" side sheet (`/sales/new`, drafts `?draft=<id>`): product search, lines with stock and edited price,
// discount, optional client (created when unknown), payment method, amount received / change, remaining ⇒ PARTIELLE
// (blocked without a client: `SALE_PARTIAL_REQUIRES_CUSTOMER`), Brouillon / Valider la vente.
import { formatDateTime, formatMoney, formatNumber, isPhoneDz, normalizePhoneDz, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  ActiveFilters,
  Button,
  buttonClass,
  Card,
  cn,
  DataTable,
  Field,
  FilterChips,
  FilterDropdown,
  FormAlert,
  Input,
  KpiTile,
  Ltr,
  MoneyInput,
  PhoneInput,
  QtyStepper,
  SearchInput,
  SegmentedControl,
  Select,
  SideSheet,
  toast,
  TotalsBlock,
  type Column,
} from '@djaber/ui';
import { X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { LeaveGuardDialog, ListEmpty, ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import type { ClientListItem } from '@/features/clients/contracts';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { useMembers } from '@/features/workspace/api';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, filterText, type ListSpec } from '@/lib/list-state';
import { moneyDigits } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { uuid } from '@/lib/uuid';
import { gdsApi, useGdsRefresh, useSale, useSales, useSaleStats } from './api';
import { GDS_PAYMENT_STATUSES, type CashMethod, type Sale, type SaleRow } from './contracts';
import { int, lineVariants, priceEdited, saleClientBody, saleSheetSnapshot, saleTotals, type DiscountMode } from './logic';
import { ProductPicker, useProductVariants, type PickedProduct } from './product-picker';
import { ClientPicker, useSaleActions } from './sale-dialogs';
import { ListExportMenu } from './export-menu';
import { AdvancedOnly, KpiSkeleton, PeriodDropdown, SaleStatusPill, shortName } from './ui';
import { withoutYear } from '@/features/catalog/stock/logic';
import { formatPhoneOnBlur, phoneError, phonePreviewLine } from '@/lib/phone';

export const SALES_SPEC: ListSpec = {
  filters: { paymentStatus: 'list', status: 'list', createdById: 'list', clientId: 'text', productId: 'text', hasRemaining: 'bool', period: 'text', from: 'date', to: 'date' },
  sorts: ['soldAt', 'total', 'number'],
  defaultSort: '-soldAt',
};
const SALE_METHODS = ['cash', 'ccp', 'card'] as const satisfies readonly CashMethod[];

export function SalesPage({ creating }: { creating?: boolean }) {
  const t = useT();
  return (
    <AdvancedOnly title={t('nav.sales')}>
      <SalesList creating={creating} />
    </AdvancedOnly>
  );
}

function SalesList({ creating }: { creating?: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const list = useListState(SALES_SPEC);
  const s = list.state;
  const q = useSales(list.apiQuery());
  const stats = useSaleStats(list.filterQuery());
  const members = useMembers(can('members.read'));
  const offline = useOffline();
  const actions = useSaleActions({ onEditDraft: (id) => router.push(`/sales/new?draft=${id}`) });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? null;
  const k = stats.data;
  const canWrite = can('gds.write');
  const [clientFilter, setClientFilter] = useState<ClientListItem | null>(null);

  const payments = filterList(s, 'paymentStatus');
  const sellers = filterList(s, 'createdById');
  const clientId = filterText(s, 'clientId');
  const memberOptions = (members.data ?? []).map((m) => ({ value: m.user.id, label: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email }));
  const chips = [
    ...(payments.length ? [{ key: 'paymentStatus', label: `${t('sales.filter.payment')} : ${payments.map((v) => t(`enum.Sale.paymentStatus.${v}`)).join(', ')}`, onRemove: () => list.setFilter('paymentStatus', null) }] : []),
    ...(sellers.length ? [{ key: 'createdById', label: `${t('sales.filter.seller')} : ${sellers.map((v) => memberOptions.find((m) => m.value === v)?.label ?? '…').join(', ')}`, onRemove: () => list.setFilter('createdById', null) }] : []),
    ...(clientId ? [{ key: 'clientId', label: `${t('sales.filter.client')} : ${clientFilter?.name ?? rows.find((r) => r.client?.id === clientId)?.client?.name ?? '…'}`, onRemove: () => list.setFilter('clientId', null) }] : []),
    ...(s.filters.hasRemaining ? [{ key: 'hasRemaining', label: t('sales.filter.hasRemaining'), onRemove: () => list.setFilter('hasRemaining', null) }] : []),
  ];

  const columns: Column<SaleRow>[] = [
    { key: 'number', header: t('sales.col.number'), sortKey: 'number', hideable: false, cell: (r) => <Ltr className="whitespace-nowrap font-medium">{`#${r.number}`}</Ltr> },
    { key: 'date', header: t('common.date'), sortKey: 'soldAt', className: 'whitespace-nowrap', cell: (r) => withoutYear(formatDateTime(r.soldAt, locale)) },
    { key: 'client', header: t('common.client'), cell: (r) => r.client?.name ?? <span className="text-text-secondary">{r.customerName ?? t('sales.walkIn')}</span> },
    {
      key: 'items',
      header: t('common.items'),
      hideBelow: 'lg',
      className: 'max-w-[240px]',
      cell: (r) => <span className="block truncate">{r.items.map((i) => `${i.name}${i.variant ? ` ${i.variant}` : ''} ×${i.qty}`).join(' · ')}</span>,
    },
    { key: 'total', header: t('common.total'), sortKey: 'total', align: 'end', cell: (r) => <Ltr className="whitespace-nowrap tabular-nums">{formatMoney(r.total)}</Ltr> },
    { key: 'paid', header: t('sales.col.paid'), align: 'end', hideBelow: 'lg', cell: (r) => (r.status === 'cancelled' ? <span className="text-text-muted">—</span> : <Ltr className="whitespace-nowrap tabular-nums">{formatMoney(r.amountPaid)}</Ltr>) },
    { key: 'status', header: t('common.status'), cell: (r) => <SaleStatusPill status={r.status} paymentStatus={r.paymentStatus} /> },
    { key: 'seller', header: t('sales.col.seller'), hideBelow: 'xl', cell: (r) => shortName(r.seller) ?? '—' },
  ];

  const since = q.dataUpdatedAt ? withoutYear(formatDateTime(new Date(q.dataUpdatedAt).toISOString(), locale)) : '—';
  const closeSheet = () => router.push(`/sales${params.toString() ? `?${new URLSearchParams([...params.entries()].filter(([key]) => key !== 'draft')).toString()}` : ''}`);
  return (
    <AppPage
      wide
      title={t('sales.title')}
      description={t('sales.subtitle')}
      permission="gds.read"
      actions={
        <>
          <ListExportMenu path="/sales/export" filters={list.filterQuery()} entity={t('sales.export.entity')} file={t('sales.export.file')} disabledReason={offline ? t('banner.offline') : undefined} />
          {canWrite ? (
            offline ? (
              <Button variant="primary" disabled disabledReason={t('banner.offline')} data-testid="sale-new">
                {t('sales.new')}
              </Button>
            ) : (
              <Link href="/sales/new" className={buttonClass({ variant: 'primary' })} data-testid="sale-new">
                {t('sales.new')}
              </Link>
            )
          ) : null}
        </>
      }
    >
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('sales.kpi.label')} data-testid="sale-kpis">
        {k ? (
          <>
            <KpiTile value={formatNumber(k.revenue)} label={t('sales.kpi.revenue')} meta={t('sales.kpi.count', { count: k.count })} data-kpi="revenue" />
            <button type="button" className="text-start" onClick={() => list.setFilter('hasRemaining', !s.filters.hasRemaining)} aria-pressed={!!s.filters.hasRemaining}>
              <KpiTile value={formatNumber(k.remaining)} label={t('sales.kpi.remaining')} meta={t('sales.kpi.partial', { count: k.partialCount })} tone={k.remaining ? 'warning' : undefined} data-kpi="remaining" />
            </button>
            <KpiTile value={formatNumber(k.averageBasket)} label={t('sales.kpi.basket')} meta={k.averageBasketDeltaPct === null ? t('purchases.kpi.noPrevious') : `${k.averageBasketDeltaPct > 0 ? '+' : ''}${k.averageBasketDeltaPct} %`} data-kpi="basket" />
          </>
        ) : stats.isError ? null : (
          <KpiSkeleton count={3} />
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('sales.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-80" />
        <FilterDropdown label={t('sales.filter.payment')} count={payments.length}>
          <FilterChips label={t('sales.filter.payment')} multiple options={GDS_PAYMENT_STATUSES.map((v) => ({ value: v, label: t(`enum.Sale.paymentStatus.${v}`) }))} value={payments} onChange={(v) => list.setFilter('paymentStatus', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('sales.filter.seller')} count={sellers.length}>
          <FilterChips label={t('sales.filter.seller')} multiple options={memberOptions} value={sellers} onChange={(v) => list.setFilter('createdById', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('sales.filter.client')} count={clientId ? 1 : 0}>
          <ClientPicker
            id="sales-client-filter"
            value={clientId ? (clientFilter ?? null) : null}
            onPick={(c) => {
              setClientFilter(c);
              list.setFilter('clientId', c?.id ?? null);
            }}
          />
        </FilterDropdown>
        <PeriodDropdown list={list} defaultKey="30d" />
        {total !== null ? (
          <span className="ms-auto ts-label-meta text-text-muted" data-testid="sales-count">
            {t('sales.count', { count: total })}
          </span>
        ) : null}
      </div>
      <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? list.clear : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />

      {q.isPending ? (
        <Card>
          <ListLoading rows={5} columns={7} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        list.filtered ? (
          <ListFilteredEmpty entity={t('sales.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={list.clear} />
        ) : (
          <ListEmpty title={t('sales.empty.title')} description={t('sales.empty.description')} action={canWrite && !offline ? { label: t('sales.new'), onClick: () => router.push('/sales/new') } : undefined} />
        )
      ) : (
        <DataTable<SaleRow>
          label={t('sales.title')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          onRowClick={(r) => (r.status === 'draft' ? router.push(`/sales/new?draft=${r.id}`) : router.push(`/sales/${r.id}`))}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={`#${r.number}`} actions={actions.menu(r)} />}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/sales/${r.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Ltr className="text-[14px] font-medium">{`#${r.number}`}</Ltr>
                  <span className="truncate text-[13px]">{r.client?.name ?? r.customerName ?? t('sales.walkIn')}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <SaleStatusPill status={r.status} paymentStatus={r.paymentStatus} />
                  <Ltr className="ts-label-micro text-text-muted">{formatMoney(r.total)}</Ltr>
                </div>
              </Link>
              <ActionsMenu label={t('action.actions')} actions={actions.menu(r)} />
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total ?? rows.length} onChange={(p) => list.set(p)} note={t('sales.menuNote')} />}
        />
      )}
      {creating ? <NewSaleSheet draftId={params.get('draft')} onClose={closeSheet} /> : null}
      {actions.element}
    </AppPage>
  );
}

/* ---------- Nouvelle vente (side sheet) ---------- */
type Line = { key: string; productId: string; name: string; hasVariants: boolean; variants: PickedProduct['variants']; variantId: string | null; trackStock: boolean; stock: number | null; quantity: number; unitPrice: string; catalogPrice: number };
const lineOf = (p: PickedProduct): Line => {
  const v = p.variants.length === 1 ? p.variants[0]! : null;
  return { key: uuid(), productId: p.id, name: p.name, hasVariants: p.hasVariants, variants: p.variants, variantId: v?.id ?? null, trackStock: p.trackStock, stock: v ? v.stock : p.stock, quantity: 1, unitPrice: moneyDigits(v?.price ?? p.price), catalogPrice: v?.price ?? p.price };
};
const lineFromSale = (s: Sale): Line[] =>
  s.items.map((i) => ({
    key: i.id,
    productId: i.product.id,
    name: i.productName,
    hasVariants: i.product.hasVariants,
    variants: i.variantId ? [{ id: i.variantId, name: i.variantName ?? '', sku: null, price: i.catalogPrice ?? i.unitPrice, costPrice: null, stock: 0 }] : [],
    variantId: i.variantId,
    trackStock: i.product.trackStock,
    stock: null,
    quantity: i.quantity,
    unitPrice: moneyDigits(i.unitPrice),
    catalogPrice: i.catalogPrice ?? i.unitPrice,
  }));

function NewSaleSheet({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const refresh = useGdsRefresh();
  const offline = useOffline();
  const { can } = useSession();
  const draft = useSale(draftId);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [client, setClient] = useState<ClientListItem | null>(null);
  const [newClient, setNewClient] = useState<{ open: boolean; name: string; phone: string }>({ open: false, name: '', phone: '' });
  const [method, setMethod] = useState<CashMethod>('cash');
  const [received, setReceived] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'completed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(uuid());
  const loaded = useRef<string | null>(null);
  // the sheet is "ready" once the draft (if any) is loaded; its state then is the baseline of the leave guard
  const [ready, setReady] = useState(!draftId);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    const d = draft.data;
    if (!d || loaded.current === d.id) return;
    loaded.current = d.id;
    setLines(lineFromSale(d));
    setDiscount(d.discount ? moneyDigits(d.discount) : '');
    setMethod(d.paymentMethod);
    setReceived(d.amountPaid ? moneyDigits(d.amountPaid) : null);
    if (d.client) setClient({ ...d.client } as ClientListItem);
    setReady(true);
  }, [draft.data]);
  const snapshot = saleSheetSnapshot({ lines, discount, discountMode, clientId: client?.id ?? null, newClient, method, received });
  useEffect(() => {
    if (ready && baseline === null) setBaseline(snapshot);
  }, [ready, baseline, snapshot]);
  const dirty = baseline !== null && snapshot !== baseline;
  const sheetName = draft.data ? t('sales.form.draftTitle', { number: draft.data.number }) : t('sales.form.title');
  const { guard } = useLeaveGuard(dirty && busy === null, sheetName);
  const close = () => (busy ? undefined : dirty ? setConfirmClose(true) : onClose());
  // a draft line only carries its saved variant: the product's other variants are read to offer them again
  const loadedVariants = useProductVariants(lines.filter((l) => l.hasVariants).map((l) => l.productId));

  // "MONTANT REÇU" follows the total until the seller types an amount
  const receivedValue = received ?? moneyDigits(saleTotals(lines, { discount, discountMode, received: '0' }).total);
  const live = saleTotals(lines, { discount, discountMode, received: receivedValue });
  const hasClient = !!client || (newClient.open && newClient.name.trim().length >= 2 && isPhoneDz(normalizePhoneDz(newClient.phone.trim())));
  const partialBlocked = live.partial && !hasClient;
  const missingVariant = lines.some((l) => l.hasVariants && !l.variantId);
  const patch = (i: number, p: Partial<Line>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const lineErr = (i: number) => {
    const k = [`items.${i}.quantity`, `items.${i}.variantId`, `items.${i}.productId`].find((x) => fields[x]);
    return k ? (t.has(fields[k]!) ? t(fields[k]!, { max: '', min: '' }) : fields[k]) : null;
  };

  const save = async (status: 'draft' | 'completed') => {
    setError(null);
    setFields({});
    if (!lines.length || missingVariant || (status === 'completed' && partialBlocked)) {
      setError(partialBlocked && status === 'completed' ? t('error.SALE_PARTIAL_REQUIRES_CUSTOMER') : missingVariant ? t('error.VARIANT_REQUIRED') : t('sales.form.noLines'));
      return;
    }
    setBusy(status);
    const who = saleClientBody(client, newClient);
    const body = {
      ...who,
      items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, ...(int(l.unitPrice) !== l.catalogPrice ? { unitPrice: int(l.unitPrice) } : {}) })),
      discount: live.discount || undefined,
      paymentMethod: method,
      amountPaid: live.received,
      status,
    };
    try {
      let sale: Sale;
      if (draft.data) {
        sale = await gdsApi.updateSale(draft.data.id, { ...(who.client ? { client: who.client } : { clientId: who.clientId }), items: body.items, discount: body.discount ?? 0, paymentMethod: method, amountPaid: live.paid, ...(status === 'completed' ? { status: 'completed' as const } : {}) });
      } else {
        sale = await gdsApi.createSale(body, key.current);
        key.current = uuid();
      }
      setBaseline(null);
      await refresh();
      toast(status === 'completed' ? t('sales.form.validated', { number: sale.number, amount: formatMoney(sale.total) }) : t('sales.form.drafted', { number: sale.number }));
      if (status === 'completed') router.push(`/sales/${sale.id}`);
      else onClose();
    } catch (e) {
      setError(refusal(e, t));
      if (e instanceof ApiError) setFields(e.body.fields ?? {});
    } finally {
      setBusy(null);
    }
  };
  const blocked = !can('gds.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  return (
    <>
    <SideSheet
      open
      onClose={close}
      title={sheetName}
      closeLabel={t('action.close')}
      width={460}
      footer={
        <div className="flex w-full items-center gap-2">
          <Button variant="ghost" onClick={() => void save('draft')} loading={busy === 'draft'} disabled={busy !== null} disabledReason={blocked} data-testid="sale-save-draft">
            {t('purchases.form.draft')}
          </Button>
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => void save('completed')}
            loading={busy === 'completed'}
            disabled={busy !== null}
            disabledReason={blocked ?? (partialBlocked ? t('error.SALE_PARTIAL_REQUIRES_CUSTOMER') : undefined)}
            data-testid="sale-validate"
          >
            {t('sales.form.validate', { amount: formatMoney(live.total) })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="new-sale-sheet">
        <ProductPicker id="sale-product" onPick={(p) => setLines((x) => (!p.hasVariants && x.some((l) => l.productId === p.id) ? x.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...x, lineOf(p)]))} placeholder={t('sales.form.search')} />
        {lines.length ? (
          <ul className="divide-y divide-line-hairline rounded-card border border-line-edge" data-testid="sale-lines">
            {lines.map((l, i) => {
              const variants = lineVariants(l.variants, loadedVariants[l.productId]);
              const v = l.variantId ? variants.find((x) => x.id === l.variantId) : null;
              const stock = v ? v.stock : l.stock;
              const err = lineErr(i);
              return (
                <li key={l.key} className="flex flex-col gap-1 px-3 py-2.5" data-line={l.productId}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{l.name}</div>
                      <div className="ts-label-micro text-text-muted">
                        {[v?.name, l.trackStock && stock !== null ? t('sales.form.stock', { count: stock }) : null, priceEdited(l) ? t('sales.form.priceEdited', { from: formatNumber(l.catalogPrice), to: formatNumber(int(l.unitPrice)) }) : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <QtyStepper value={l.quantity} onChange={(q) => patch(i, { quantity: q })} min={1} max={100000} labels={{ decrease: t('gds.qty.decrease'), increase: t('gds.qty.increase'), value: t('common.quantity') }} tone={l.trackStock && stock !== null && l.quantity > stock ? 'danger' : undefined} />
                    <MoneyInput aria-label={t('sales.form.priceFor', { name: l.name })} value={l.unitPrice} onValueChange={(x) => patch(i, { unitPrice: x })} className="!h-8 w-28 text-end" currency="" />
                    <button type="button" aria-label={t('orderForm.items.remove', { name: l.name })} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-text-primary">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  {l.hasVariants && variants.length > 1 ? (
                    <Select aria-label={t('orderForm.items.variant', { name: l.name })} value={l.variantId ?? ''} onChange={(e) => { const nv = variants.find((x) => x.id === e.target.value); patch(i, { variantId: e.target.value || null, unitPrice: nv ? moneyDigits(nv.price) : l.unitPrice, catalogPrice: nv?.price ?? l.catalogPrice }); }} className="!h-7 w-auto text-[12px]" aria-invalid={!l.variantId || undefined}>
                      <option value="">{t('orderForm.items.pickVariant')}</option>
                      {variants.map((x) => (
                        <option key={x.id} value={x.id}>
                          {`${x.name} (${t('sales.form.stock', { count: x.stock })})`}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {err ? <p role="alert" className="text-[12px] text-accent-alert">{err}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ts-label-meta text-text-muted">{t('sales.form.empty')}</p>
        )}

        <div className="flex items-end gap-2">
          <Field label={t('common.discount')} htmlFor="sale-discount" className="flex-1">
            <MoneyInput id="sale-discount" value={discount} onValueChange={setDiscount} currency={discountMode === 'percent' ? '%' : 'DA'} />
          </Field>
          <SegmentedControl<DiscountMode>
            label={t('common.discount')}
            value={discountMode}
            onChange={setDiscountMode}
            options={[
              { value: 'amount', label: 'DA' },
              { value: 'percent', label: '%' },
            ]}
          />
        </div>
        <TotalsBlock
          rows={[
            { key: 'subtotal', label: t('common.subtotal'), value: formatMoney(live.subtotal) },
            ...(live.discount ? [{ key: 'discount', label: t('common.discount'), value: `−${formatMoney(live.discount)}` }] : []),
            { key: 'total', label: t('sales.form.total'), value: formatMoney(live.total), strong: true },
          ]}
        />

        <Field label={t('sales.form.client')} htmlFor="sale-client">
          {newClient.open && !client ? (
            <div className="grid grid-cols-2 gap-2" data-testid="sale-new-client">
              <Input aria-label={t('common.name')} placeholder={t('common.name')} value={newClient.name} onChange={(e) => setNewClient((x) => ({ ...x, name: e.target.value }))} />
              <PhoneInput
                aria-label={t('common.phone')}
                placeholder="0555 12 34 56"
                autoComplete="off"
                value={newClient.phone}
                format={formatPhoneOnBlur}
                onChange={(e) => setNewClient((x) => ({ ...x, phone: e.target.value }))}
                aria-invalid={!!phoneError(newClient.phone) || undefined}
                preview={phonePreviewLine(t, newClient.phone)}
              />
            </div>
          ) : (
            <ClientPicker id="sale-client" value={client} onPick={setClient} />
          )}
        </Field>
        {!client ? (
          <button type="button" className="-mt-2 w-fit ts-label-micro text-text-muted hover:text-text-primary" onClick={() => setNewClient((x) => ({ ...x, open: !x.open }))}>
            {newClient.open ? t('sales.form.pickExisting') : t('sales.form.newClientHint')}
          </button>
        ) : null}

        <Field label={t('sales.form.payment')}>
          <SegmentedControl<CashMethod> label={t('sales.form.payment')} value={method} onChange={setMethod} options={SALE_METHODS.map((m) => ({ value: m, label: t(`sales.method.${m}`) }))} className="w-full [&>button]:flex-1" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('sales.form.received')} htmlFor="sale-received" hint={live.remaining > 0 ? t('sales.form.remainingHint', { amount: formatMoney(live.remaining) }) : undefined}>
            <MoneyInput id="sale-received" value={receivedValue} onValueChange={(v) => setReceived(v)} />
          </Field>
          <Field label={t('sales.form.change')} htmlFor="sale-change">
            <Input id="sale-change" readOnly value={formatMoney(live.change)} dir="ltr" />
          </Field>
        </div>
        {live.partial ? (
          <p className={cn('ts-label-micro !normal-case', partialBlocked ? 'text-accent-starred' : 'text-text-muted')} data-testid="sale-partial-note">
            {t('sales.form.partialNote')}
          </p>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <p className="ts-label-micro !normal-case text-text-muted">{t('sales.form.footnote', { count: lines.length })}</p>
      </div>
    </SideSheet>
    {guard}
    <LeaveGuardDialog
      open={confirmClose}
      name={sheetName}
      onStay={() => setConfirmClose(false)}
      onLeave={() => {
        setConfirmClose(false);
        onClose();
      }}
    />
    </>
  );
}
