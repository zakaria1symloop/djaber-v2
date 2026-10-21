'use client';
// /suppliers — Figma "GDS-06 — Suppliers — list + detail sheet" + DLG GDS "Nouveau fournisseur", "Enregistrer un
// paiement fournisseur" (03 GDS-05, 12 §21 "Suppliers"). List with search + Solde dû / Dernier achat / Actif chips
// (URL), rows with `Actions ⌄` from the server descriptors, side sheet `?sheet=<id>` (KPIs, contact, terms, notes,
// last purchases, "+ Achat chez ce fournisseur", payment, Désactiver); delete refused while purchases exist
// (`SUPPLIER_HAS_PURCHASES` → Désactiver).
import { formatDate, formatMoney, formatNumber, formatPhoneDz, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  ActiveFilters,
  Banner,
  Button,
  buttonClass,
  Card,
  cn,
  CodeInput,
  ConfirmDialog,
  DataTable,
  DetailRows,
  Dialog,
  EmailInput,
  Field,
  FilterChips,
  FilterDropdown,
  FormAlert,
  Input,
  KpiTile,
  Ltr,
  MoneyInput,
  NumberInput,
  PhoneInput,
  Pill,
  SearchInput,
  Select,
  SheetSection,
  SideSheet,
  Skeleton,
  Textarea,
  toast,
  type Column,
  type MenuAction,
} from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListFilteredEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { ListPagination } from '@/features/catalog/ui';
import { DialogFooter, refusal, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { toMenuActions } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterText, type ListSpec } from '@/lib/list-state';
import { digitsToInt, moneyDigits } from '@/lib/money';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useListState } from '@/lib/use-list-state';
import { gdsApi, useGdsRefresh, useSupplier, useSuppliers } from './api';
import { PAYMENT_METHODS, type CashMethod, type Supplier, type SupplierRow } from './contracts';
import { AdvancedOnly, PaymentPill, PurchaseStatusPill, useDayLabel } from './ui';
import { emailError, emailOrNull } from '@/lib/email';
import { fieldError } from '@/lib/forms';
import { formatPhoneOnBlur, phoneError, phonePreviewLine } from '@/lib/phone';

export const SUPPLIERS_SPEC: ListSpec = {
  filters: { hasBalance: 'bool', lastPurchase: 'text', isActive: 'text' },
  sorts: ['name', 'balance', 'lastPurchaseAt', 'totalSpent', 'createdAt'],
  defaultSort: 'name',
};
const LAST_PURCHASE = ['30d', '90d', 'year'] as const;

export function SuppliersPage() {
  const t = useT();
  return (
    <AdvancedOnly title={t('nav.suppliers')}>
      <SuppliersList />
    </AdvancedOnly>
  );
}

/** Supplier dialogs of a screen (edit, payment, delete / deactivate) driven by one state. */
const withInactiveReason = (s: Pick<SupplierRow, 'isActive'>, reason: string, items: MenuAction[]): MenuAction[] =>
  s.isActive ? items : items.map((a) => (a.key === 'new_purchase' && !a.disabledReason ? { ...a, onSelect: undefined, disabledReason: reason } : a));

export function useSupplierActions() {
  const t = useT();
  const router = useRouter();
  const refresh = useGdsRefresh();
  const { can } = useSession();
  const canWrite = can('gds.write');
  const [edit, setEdit] = useState<Supplier | SupplierRow | 'new' | null>(null);
  const [pay, setPay] = useState<SupplierRow | null>(null);
  const [del, setDel] = useState<SupplierRow | null>(null);
  const toggle = async (s: SupplierRow) => {
    try {
      await gdsApi.setSupplierActive(s.id, !s.isActive);
      await refresh();
      toast(t(s.isActive ? 'suppliers.deactivated' : 'suppliers.activated', { name: s.name }));
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const menu = (s: SupplierRow, o: { onOpen?: () => void } = {}): MenuAction[] =>
    // an inactive supplier is not offered in the purchase form: "Nouvel achat" stays visible, greyed with its reason
    withInactiveReason(s, t('suppliers.inactivePurchaseReason'), toMenuActions(
      s.actions,
      {
        open: { label: t('action.open'), onSelect: () => o.onOpen?.(), hidden: !o.onOpen },
        edit: { label: t('action.edit'), onSelect: () => setEdit(s), hint: t('gds.hint.dialog') },
        new_purchase: { label: t('suppliers.action.newPurchase'), onSelect: () => router.push(`/purchases/new?supplierId=${s.id}`), hint: t('gds.hint.page') },
        record_payment: { label: t('action.recordPayment'), onSelect: () => setPay(s), hint: t('gds.hint.dialog') },
        deactivate: { label: t('action.disable'), onSelect: () => void toggle(s), separated: true },
        activate: { label: t('action.enable'), onSelect: () => void toggle(s), separated: true },
        delete: { label: t('action.delete'), onSelect: () => setDel(s), destructive: true },
      },
      t,
    ));
  const element = (
    <>
      <SupplierDialog open={edit !== null} supplier={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />
      <SupplierPaymentDialog supplier={pay} onClose={() => setPay(null)} />
      <DeleteSupplierDialog supplier={del} onClose={() => setDel(null)} onDeactivate={(s) => void toggle(s)} />
    </>
  );
  return { menu, element, create: () => setEdit('new'), edit: (s: Supplier) => setEdit(s), pay: (s: SupplierRow) => setPay(s), toggle, canWrite };
}

function SuppliersList() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { can } = useSession();
  const list = useListState(SUPPLIERS_SPEC);
  const s = list.state;
  const q = useSuppliers(list.apiQuery());
  const offline = useOffline();
  const actions = useSupplierActions();
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? null;
  const day = useDayLabel();
  const canWrite = can('gds.write') && !offline;

  const isActive = filterText(s, 'isActive');
  const lastPurchase = filterText(s, 'lastPurchase');
  const chips = [
    ...(s.filters.hasBalance ? [{ key: 'hasBalance', label: t('suppliers.filter.hasBalance'), onRemove: () => list.setFilter('hasBalance', null) }] : []),
    ...(lastPurchase ? [{ key: 'lastPurchase', label: `${t('suppliers.filter.lastPurchase')} : ${t(`gds.period.${lastPurchase}`)}`, onRemove: () => list.setFilter('lastPurchase', null) }] : []),
    ...(isActive ? [{ key: 'isActive', label: t(isActive === 'true' ? 'suppliers.filter.active' : 'suppliers.filter.inactive'), onRemove: () => list.setFilter('isActive', null) }] : []),
  ];

  const columns: Column<SupplierRow>[] = [
    {
      key: 'name',
      header: t('suppliers.col.name'),
      sortKey: 'name',
      hideable: false,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          {!r.isActive ? (
            <Pill className="!rounded-[4px]" tone="neutral">
              {t('suppliers.inactive')}
            </Pill>
          ) : null}
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('suppliers.col.contact'),
      hideBelow: 'lg',
      className: 'max-w-[220px]',
      cell: (r) => <span className="block truncate text-text-secondary">{[r.phone ? formatPhoneDz(r.phone) : null, r.email].filter(Boolean).join(' · ') || '—'}</span>,
    },
    {
      key: 'purchases',
      header: t('suppliers.col.purchases12m'),
      sortKey: 'totalSpent',
      cell: (r) => <Ltr className="whitespace-nowrap tabular-nums">{`${formatNumber(r.purchases12m.count)} · ${formatMoney(r.purchases12m.total)}`}</Ltr>,
    },
    {
      key: 'balance',
      header: t('suppliers.col.balance'),
      sortKey: 'balance',
      align: 'end',
      cell: (r) => <Ltr className={cn('whitespace-nowrap tabular-nums', r.balance > 0 && 'text-accent-starred')}>{formatMoney(r.balance)}</Ltr>,
    },
    { key: 'last', header: t('suppliers.col.lastPurchase'), sortKey: 'lastPurchaseAt', hideBelow: 'xl', cell: (r) => (r.lastPurchaseAt ? day(r.lastPurchaseAt.slice(0, 10)) : <span className="text-text-muted">—</span>) },
  ];

  const since = q.dataUpdatedAt ? formatDate(new Date(q.dataUpdatedAt), locale) : '—';
  const ids = rows.map((r) => r.id);
  const pos = s.sheet ? ids.indexOf(s.sheet) : -1;

  return (
    <AppPage
      wide
      title={t('nav.suppliers')}
      description={t('suppliers.subtitle')}
      permission="gds.read"
      actions={
        <Button variant="primary" onClick={actions.create} disabledReason={!can('gds.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined} data-testid="supplier-new">
          {t('suppliers.new')}
        </Button>
      }
    >
      {offline ? <OfflineBanner since={since} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('suppliers.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-80" />
        <FilterDropdown label={t('suppliers.filter.balance')} count={s.filters.hasBalance ? 1 : 0}>
          <FilterChips label={t('suppliers.filter.balance')} allLabel={t('common.allM')} options={[{ value: '1', label: t('suppliers.filter.hasBalance') }]} value={s.filters.hasBalance ? ['1'] : []} onChange={(v) => list.setFilter('hasBalance', v.length > 0)} />
        </FilterDropdown>
        <FilterDropdown label={t('suppliers.filter.lastPurchase')} count={lastPurchase ? 1 : 0}>
          <FilterChips label={t('suppliers.filter.lastPurchase')} allLabel={t('common.allM')} options={LAST_PURCHASE.map((p) => ({ value: p, label: t(`gds.period.${p}`) }))} value={lastPurchase ? [lastPurchase] : []} onChange={(v) => list.setFilter('lastPurchase', v[0] ?? null)} />
        </FilterDropdown>
        <FilterDropdown label={t('suppliers.filter.status')} count={isActive ? 1 : 0}>
          <FilterChips
            label={t('suppliers.filter.status')}
            allLabel={t('common.allM')}
            options={[
              { value: 'true', label: t('suppliers.filter.active') },
              { value: 'false', label: t('suppliers.filter.inactive') },
            ]}
            value={isActive ? [isActive] : []}
            onChange={(v) => list.setFilter('isActive', v[0] ?? null)}
          />
        </FilterDropdown>
        {total !== null ? (
          <span className="ms-auto ts-label-meta text-text-muted" data-testid="suppliers-count">
            {t('suppliers.count', { count: total })}
          </span>
        ) : null}
      </div>
      <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? list.clear : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />

      {q.isPending ? (
        <Card>
          <ListLoading rows={5} columns={5} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        list.filtered ? (
          <ListFilteredEmpty entity={t('suppliers.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={list.clear} />
        ) : (
          <ListEmpty title={t('suppliers.empty.title')} description={t('suppliers.empty.description')} action={canWrite ? { label: t('suppliers.new'), onClick: actions.create } : undefined} />
        )
      ) : (
        <DataTable<SupplierRow>
          label={t('nav.suppliers')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          onRowClick={(r) => list.openSheet(r.id)}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={r.name} actions={actions.menu(r, { onOpen: () => list.openSheet(r.id) })} />}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => list.openSheet(r.id)}>
                <div className="truncate text-[14px] font-medium">{r.name}</div>
                <div className="ts-label-micro text-text-muted">
                  <Ltr>{`${formatNumber(r.purchases12m.count)} · ${formatMoney(r.purchases12m.total)} · ${t('suppliers.col.balance')} ${formatMoney(r.balance)}`}</Ltr>
                </div>
              </button>
              <ActionsMenu label={t('action.actions')} actions={actions.menu(r, { onOpen: () => list.openSheet(r.id) })} />
            </div>
          )}
          footer={<ListPagination page={s.page} pageSize={s.pageSize} total={total ?? rows.length} onChange={(p) => list.set(p)} />}
        />
      )}

      <SupplierSheet
        supplierId={s.sheet}
        onClose={() => list.openSheet(null)}
        actions={actions}
        nav={
          pos >= 0
            ? { onPrev: pos > 0 ? () => list.openSheet(ids[pos - 1]!) : undefined, onNext: pos < ids.length - 1 ? () => list.openSheet(ids[pos + 1]!) : undefined, position: `${pos + 1} / ${ids.length}` }
            : undefined
        }
        offline={offline}
      />
      {actions.element}
    </AppPage>
  );
}

/* ---------- detail sheet ---------- */
function SupplierSheet({
  supplierId,
  onClose,
  actions,
  nav,
  offline,
}: {
  supplierId: string | null;
  onClose: () => void;
  actions: ReturnType<typeof useSupplierActions>;
  nav?: { onPrev?: () => void; onNext?: () => void; position: string };
  offline: boolean;
}) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useSupplier(supplierId);
  const s = q.data;
  const day = useDayLabel();
  const month = (iso: string) => formatDate(iso, locale).split(' ').slice(1).join(' ');
  const writeReason = !actions.canWrite ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  return (
    <SideSheet
      open={!!supplierId}
      onClose={onClose}
      title={s?.name ?? t('nav.suppliers')}
      subtitle={s ? t('suppliers.sheet.subtitle', { since: month(s.createdAt), count: s.purchaseCount }) : undefined}
      headerAction={
        s ? (
          <div className="flex items-center gap-1.5">
            {actions.canWrite ? (
              <Button size="sm" variant="ghost" onClick={() => actions.edit(s)} disabledReason={offline ? t('banner.offline') : undefined} data-testid="supplier-edit">
                {t('action.edit')}
              </Button>
            ) : null}
            <ActionsMenu label={t('action.actions')} heading={s.name} actions={actions.menu(s)} iconOnly />
          </div>
        ) : undefined
      }
      nav={nav ? { ...nav, prevLabel: t('clients.sheet.prev'), nextLabel: t('clients.sheet.next') } : undefined}
      closeLabel={t('action.close')}
      width={460}
    >
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <div className="flex flex-col gap-5" data-testid="supplier-sheet">
          {!s.isActive ? <Banner tone="neutral">{t('suppliers.sheet.inactive')}</Banner> : null}
          <div className="grid grid-cols-3 gap-2">
            <KpiTile value={formatNumber(s.totalSpent)} label={t('suppliers.sheet.kpi.spent')} data-kpi="spent" />
            <KpiTile value={formatNumber(s.balance)} label={t('suppliers.sheet.kpi.due')} tone={s.balance > 0 ? 'warning' : undefined} data-kpi="balance" />
            <KpiTile value={s.avgLeadDays ?? s.leadDaysMeasured ?? '—'} label={t('suppliers.sheet.kpi.lead')} data-kpi="lead" />
          </div>
          <DetailRows
            rows={[
              { key: 'phone', label: t('common.phone'), value: s.phone ? <Ltr>{formatPhoneDz(s.phone)}</Ltr> : '—' },
              { key: 'email', label: t('common.email'), value: s.email ?? '—' },
              { key: 'address', label: t('common.address'), value: s.address ?? '—' },
              {
                key: 'terms',
                label: t('suppliers.sheet.terms'),
                value: [s.paymentTermsDays !== null ? t('suppliers.sheet.paymentDays', { count: s.paymentTermsDays }) : null, s.terms].filter(Boolean).join(' · ') || '—',
              },
              { key: 'notes', label: t('suppliers.dialog.notes'), value: s.notes ? <span className="whitespace-pre-wrap">{s.notes}</span> : '—' },
            ]}
          />
          <SheetSection label={t('suppliers.sheet.lastPurchases')}>
            {s.recentPurchases.length ? (
              <ul className="divide-y divide-line-hairline rounded-card border border-line-edge" data-testid="supplier-purchases">
                {s.recentPurchases.map((p) => (
                  <li key={p.id}>
                    <Link href={`/purchases/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-ink-raised">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-accent-inbound">
                          <Ltr>{`#${p.number} · ${formatMoney(p.total)}`}</Ltr>
                        </span>
                        <span className="ts-label-micro text-text-muted">{`${day(p.purchasedAt.slice(0, 10))} · ${t('gds.units', { count: p.units.ordered })}`}</span>
                      </span>
                      {p.status === 'received' || p.status === 'cancelled' ? (
                        p.status === 'received' && p.remaining > 0 ? (
                          <PaymentPill status={p.paymentStatus} remaining={p.remaining} />
                        ) : (
                          <PurchaseStatusPill status={p.status} />
                        )
                      ) : (
                        <PurchaseStatusPill status={p.status} units={p.units} />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ts-label-meta text-text-muted">{t('suppliers.sheet.noPurchases')}</p>
            )}
          </SheetSection>
          <div className="flex flex-wrap items-center gap-2">
            {actions.canWrite ? (
              writeReason || !s.isActive ? (
                <Button variant="primary" disabled disabledReason={writeReason ?? t('suppliers.inactivePurchaseReason')} data-testid="supplier-new-purchase">
                  {t('suppliers.action.newPurchaseHere')}
                </Button>
              ) : (
                <Link href={`/purchases/new?supplierId=${s.id}`} className={buttonClass({ variant: 'primary' })} data-testid="supplier-new-purchase">
                  {t('suppliers.action.newPurchaseHere')}
                </Link>
              )
            ) : null}
            <Button onClick={() => actions.pay(s)} disabledReason={writeReason ?? (s.balance <= 0 ? t('suppliers.payment.nothingDue') : undefined)} data-testid="supplier-pay">
              {t('action.recordPayment')}
            </Button>
            <Link href={`/purchases?supplierId=${s.id}`} className={buttonClass({ variant: 'ghost' })}>
              {t('suppliers.sheet.allPurchases', { count: s.purchaseCount })}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
            {s.productCount > 0 ? (
              <Link href={`/products?supplierId=${s.id}`} className={buttonClass({ variant: 'ghost' })} data-testid="supplier-products">
                {t('carry.suppliers.allProducts', { count: s.productCount })}
                <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            ) : null}
          </div>
          {actions.canWrite ? (
            <div>
              <Button variant={s.isActive ? 'danger' : 'secondary'} onClick={() => void actions.toggle(s)} disabledReason={offline ? t('banner.offline') : undefined} data-testid="supplier-toggle">
                {s.isActive ? t('action.disable') : t('action.enable')}
              </Button>
              <p className="ts-label-micro mt-2 !normal-case text-text-muted">{t('suppliers.sheet.deleteNote')}</p>
            </div>
          ) : null}
          <p className="ts-label-micro !normal-case text-text-muted">{t('suppliers.sheet.updated', { ago: relativeTime(s.updatedAt, locale) })}</p>
        </div>
      ) : null}
    </SideSheet>
  );
}

/* ---------- Nouveau fournisseur / Modifier ---------- */
type SupplierForm = { name: string; phone: string; email: string; address: string; terms: string; paymentTermsDays: string; avgLeadDays: string; notes: string };
const toForm = (s: Supplier | SupplierRow | null): SupplierForm => ({
  name: s?.name ?? '',
  phone: s?.phone ?? '',
  email: s?.email ?? '',
  address: (s && 'address' in s ? s.address : null) ?? '',
  terms: (s && 'terms' in s ? s.terms : null) ?? '',
  paymentTermsDays: s && 'paymentTermsDays' in s && s.paymentTermsDays !== null ? String(s.paymentTermsDays) : '',
  avgLeadDays: s && 'avgLeadDays' in s && s.avgLeadDays !== null ? String(s.avgLeadDays) : '',
  notes: (s && 'notes' in s ? s.notes : null) ?? '',
});

/** "Pedro · 0550 11 22 33 · pedro@example.com": a supplier told apart from the others of the same name. */
export const supplierLabel = (s: { name: string; phone: string | null; email: string | null }) => [s.name, s.phone ? formatPhoneDz(s.phone) : null, s.email].filter(Boolean).join(' · ');

export function SupplierDialog({ open, supplier, onClose, onCreated }: { open: boolean; supplier: Supplier | SupplierRow | null; onClose: () => void; onCreated?: (s: Supplier) => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const ws = useWorkspaceId();
  // the list row lacks address / notes / terms: the full supplier is read when editing from the list
  const full = useQuery({ queryKey: [ws, 'suppliers', 'one', supplier?.id ?? ''], queryFn: () => gdsApi.supplier(supplier!.id), enabled: open && !!supplier && !('notes' in supplier) });
  const source = supplier && 'notes' in supplier ? supplier : (full.data ?? supplier);
  const [f, setF] = useState<SupplierForm>(toForm(null));
  const [touched, setTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // tester report 2026-10-20 (UX-003): a supplier with the same name is pointed out (allowed: two suppliers may share a
  // name); the same phone or e-mail is refused by the API (SUPPLIER_ALREADY_EXISTS)
  const [nameChecked, setNameChecked] = useState('');
  const twins = useSuppliers({ q: nameChecked, pageSize: 5 }, open && nameChecked.length >= 2);
  const sameName = (twins.data?.rows ?? []).filter((x) => x.id !== supplier?.id && x.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  useOnOpen(open, () => {
    setF(toForm(source));
    setTouched(false);
    setEmailTouched(false);
    setNameChecked('');
    setLoadedFor(source && 'notes' in source ? source.id : null);
  });
  if (open && source && 'notes' in source && loadedFor !== source.id) {
    setLoadedFor(source.id);
    setF(toForm(source));
  }
  const set = (k: keyof SupplierForm) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const nameError = touched && f.name.trim().length < 2 ? t('validation.required') : undefined;
  const body = {
    name: f.name.trim(),
    phone: f.phone.trim() || null,
    email: emailOrNull(f.email),
    address: f.address.trim() || null,
    terms: f.terms.trim() || null,
    paymentTermsDays: f.paymentTermsDays ? Number(f.paymentTermsDays) : null,
    avgLeadDays: f.avgLeadDays ? Number(f.avgLeadDays) : null,
    notes: f.notes.trim() || null,
  };
  const s = useDialogSubmit(() => (supplier ? gdsApi.updateSupplier(supplier.id, body) : gdsApi.createSupplier(body)));
  const submit = async () => {
    setTouched(true);
    // same rules as the API (shared `email` / DZ phone), shown inline before any request
    if (f.name.trim().length < 2 || emailError(f.email) || phoneError(f.phone)) return;
    const r = await s.submit();
    if (!r) return;
    toast(t(supplier ? 'suppliers.saved' : 'suppliers.created', { name: r.name }));
    await refresh();
    onCreated?.(r);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={supplier ? t('suppliers.dialog.editTitle') : t('suppliers.dialog.title')}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={supplier ? t('action.save') : t('action.create')} />}
    >
      <div className="flex flex-col gap-4" data-testid="supplier-dialog">
        <Field label={t('common.name')} htmlFor="sup-name" required error={nameError ?? s.fieldError('name')}>
          <Input id="sup-name" value={f.name} maxLength={120} onChange={(e) => set('name')(e.target.value)} onBlur={() => setNameChecked(f.name.trim())} placeholder="Textile Sétif" />
        </Field>
        {sameName.length ? (
          <Banner tone="warning">
            <span data-testid="supplier-same-name">
              {t('suppliers.dialog.sameName', { list: sameName.map(supplierLabel).join(' ; ') })}{' '}
              <Link href={`/suppliers?sheet=${sameName[0]!.id}`} target="_blank" rel="noopener noreferrer" className="underline">
                {t('suppliers.dialog.seeExisting')}
              </Link>
            </span>
          </Banner>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.phone')} htmlFor="sup-phone" error={s.fieldError('phone')}>
            <PhoneInput
              id="sup-phone"
              autoComplete="off"
              value={f.phone}
              format={formatPhoneOnBlur}
              onChange={(e) => set('phone')(e.target.value)}
              placeholder="0661 98 76 54"
              aria-invalid={(touched && !!phoneError(f.phone)) || !!s.fieldError('phone') || undefined}
              preview={phonePreviewLine(t, f.phone)}
            />
          </Field>
          <Field label={t('common.email')} htmlFor="sup-email" error={(emailTouched || touched) && emailError(f.email) ? fieldError(t, emailError(f.email) ?? undefined) : s.fieldError('email')}>
            <EmailInput
              id="sup-email"
              autoComplete="off"
              value={f.email}
              onChange={(e) => set('email')(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              aria-invalid={((emailTouched || touched) && !!emailError(f.email)) || undefined}
            />
          </Field>
        </div>
        <Field label={t('common.address')} htmlFor="sup-address" error={s.fieldError('address')}>
          <Input id="sup-address" value={f.address} maxLength={500} onChange={(e) => set('address')(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('suppliers.dialog.paymentDays')} htmlFor="sup-pay-days" error={s.fieldError('paymentTermsDays')}>
            <NumberInput id="sup-pay-days" value={f.paymentTermsDays} onValueChange={set('paymentTermsDays')} maxDigits={3} placeholder="30" />
          </Field>
          <Field label={t('suppliers.dialog.leadDays')} htmlFor="sup-lead" error={s.fieldError('avgLeadDays')}>
            <NumberInput id="sup-lead" value={f.avgLeadDays} onValueChange={set('avgLeadDays')} maxDigits={3} placeholder="5" />
          </Field>
        </div>
        <Field label={t('suppliers.sheet.terms')} htmlFor="sup-terms" error={s.fieldError('terms')}>
          <Input id="sup-terms" value={f.terms} maxLength={500} onChange={(e) => set('terms')(e.target.value)} placeholder={t('suppliers.dialog.termsPlaceholder')} />
        </Field>
        <Field label={t('suppliers.dialog.notes')} htmlFor="sup-notes" error={s.fieldError('notes')}>
          <Textarea id="sup-notes" value={f.notes} maxLength={2000} onChange={(e) => set('notes')(e.target.value)} className="min-h-14" />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Enregistrer un paiement fournisseur ---------- */
export function SupplierPaymentDialog({ supplier, onClose, purchaseId }: { supplier: SupplierRow | null; onClose: () => void; purchaseId?: string | null }) {
  const t = useT();
  const ws = useWorkspaceId();
  const refresh = useGdsRefresh();
  const open = !!supplier;
  const due = useQuery({
    queryKey: [ws, 'suppliers', 'due', supplier?.id ?? ''],
    queryFn: () => gdsApi.supplierPurchases(supplier!.id, { paymentStatus: ['unpaid', 'partial'], status: ['pending', 'partial', 'received'], sort: 'purchasedAt', pageSize: 100 }),
    enabled: open,
  });
  const dueRows = (due.data?.rows ?? []).filter((p) => p.remaining > 0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashMethod>('cash');
  const [target, setTarget] = useState<string>('');
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setAmount(moneyDigits(supplier?.balance ?? 0));
    setMethod('cash');
    setTarget(purchaseId ?? '');
    setReference('');
    setTouched(false);
  });
  const max = target ? (dueRows.find((p) => p.id === target)?.remaining ?? supplier?.balance ?? 0) : (supplier?.balance ?? 0);
  const value = digitsToInt(amount);
  const err = !value ? 'validation.required' : value > max ? 'suppliers.payment.overDue' : null;
  const s = useDialogSubmit((key) => gdsApi.supplierPayment(supplier!.id, { amount: value!, method, purchaseId: target || null, reference: reference.trim() || null }, key));
  const submit = async () => {
    setTouched(true);
    if (err) return;
    const r = await s.submit();
    if (!r) return;
    toast(t('suppliers.payment.done', { amount: formatMoney(value!), numbers: r.allocations.map((a) => `#${a.number}`).join(', ') }));
    await refresh();
    onClose();
  };
  const first = target ? dueRows.find((p) => p.id === target) : dueRows[0];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('suppliers.payment.title')}
      description={supplier ? t('suppliers.payment.context', { name: supplier.name, amount: formatMoney(supplier.balance), count: dueRows.length }) : undefined}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="supplier-payment-dialog">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('gds.amount')} htmlFor="sp-amount" required hint={t('suppliers.payment.maxHint')} error={touched && err ? t(err, { amount: formatMoney(max) }) : s.fieldError('amount')}>
            <MoneyInput id="sp-amount" value={amount} onValueChange={setAmount} aria-invalid={(touched && !!err) || undefined} />
          </Field>
          <Field label={t('gds.method')} htmlFor="sp-method">
            <Select id="sp-method" value={method} onChange={(e) => setMethod(e.target.value as CashMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`orders.payment.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('suppliers.payment.allocate')} htmlFor="sp-target" hint={t('suppliers.payment.oldestHint')}>
          <Select id="sp-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('suppliers.payment.oldest')}</option>
            {dueRows.map((p) => (
              <option key={p.id} value={p.id}>
                {`#${p.number} (${formatMoney(p.remaining)})`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('suppliers.payment.reference')} htmlFor="sp-ref">
          <CodeInput id="sp-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <p className="ts-label-micro !normal-case text-text-muted">{t('suppliers.payment.note', { number: first ? `#${first.number}` : '—' })}</p>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Supprimer (refused with purchases → Désactiver) ---------- */
function DeleteSupplierDialog({ supplier, onClose, onDeactivate }: { supplier: SupplierRow | null; onClose: () => void; onDeactivate: (s: SupplierRow) => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  useOnOpen(!!supplier, () => setError(null));
  const run = async () => {
    if (!supplier) return;
    setBusy(true);
    try {
      await gdsApi.deleteSupplier(supplier.id);
      await refresh();
      toast(t('suppliers.deleted', { name: supplier.name }));
      onClose();
    } catch (e) {
      setError({ code: e instanceof ApiError ? e.code : 'INTERNAL', message: refusal(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const blocked = error?.code === 'SUPPLIER_HAS_PURCHASES';
  return (
    <ConfirmDialog
      open={!!supplier}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('suppliers.delete.title', { name: supplier?.name ?? '' })}
      description={t('suppliers.delete.description')}
      confirmLabel={blocked ? t('action.disable') : t('action.delete')}
      cancelLabel={t('action.cancel')}
      destructive
      loading={busy}
      closeLabel={t('action.close')}
      onConfirm={() => {
        if (blocked && supplier) {
          onDeactivate(supplier);
          onClose();
        } else void run();
      }}
    >
      {error ? <FormAlert>{error.message}</FormAlert> : null}
    </ConfirmDialog>
  );
}
