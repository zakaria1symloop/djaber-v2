'use client';
// /inventory and /inventory/[id] — DLG GDS "Lancer un inventaire" / "Valider l'inventaire #INV-…" (03 INV-01…03, 04 §19,
// 12 §21; mobile "V2 — Stock — Inventaire (comptage)" for the counting layout). One open count per workspace
// (`INVENTORY_IN_PROGRESS`); counting saves each line on the server (`PUT /inventories/:id/lines`, Operators too);
// validation shows the variances (before → after, %) and needs a note on each line above 10 %
// (`INVENTORY_VARIANCE_NOTE_REQUIRED`); "Reprendre le comptage" / "Valider (n mouvements)" ⇒ one INVENTAIRE movement per
// variance; cancel ⇒ `cancelled`. Printable count sheet.
import { formatDateTime, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  Banner,
  Button,
  Card,
  Checkbox,
  cn,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  FormAlert,
  Input,
  KpiTile,
  Ltr,
  NumberInput,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  toast,
  VarianceValue,
  type Column,
} from '@djaber/ui';
import { ClipboardList } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useCloseGuard, useTypedFlag } from '@/components/close-guard';
import { AppPage } from '@/components/app-page';
import { ListEmpty, ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { useCategories } from '@/features/catalog/api';
import { flattenCategories } from '@/features/catalog/contracts';
import { ListPagination } from '@/features/catalog/ui';
import { DialogFooter, refusal, RadioList, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState, offlineMenu, toMenuActions } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl } from '@/lib/jobs';
import { type ListSpec } from '@/lib/list-state';
import { useSession, useWorkspaceId } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { useQueryClient } from '@tanstack/react-query';
import { gdsApi, gdsKeys, useGdsRefresh, useInventories, useInventory, useInventoryScope } from './api';
import type { Inventory, InventoryLine, InventoryRow, InventoryScope } from './contracts';
import { inventoryTotals, variance } from './logic';
import { AdvancedOnly, shortName, useDayLabel } from './ui';

export const INVENTORIES_SPEC: ListSpec = { filters: { status: 'list' }, sorts: ['startedAt', 'number'], defaultSort: '-startedAt' };
const lineKey = (l: Pick<InventoryLine, 'productId' | 'variantId'>) => `${l.productId}:${l.variantId ?? ''}`;

/** Menu of a count (list row, count page header). */
function useInventoryActions() {
  const t = useT();
  const offline = useOffline();
  const router = useRouter();
  const locale = useLocaleCode();
  const refresh = useGdsRefresh();
  const [cancel, setCancel] = useState<InventoryRow | null>(null);
  const [validate, setValidate] = useState<string | null>(null);
  const sheet = async (id: string) => {
    try {
      const f = await gdsApi.inventorySheet(id, locale);
      downloadUrl(f.url, f.fileName);
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const menu = (r: InventoryRow) =>
    offlineMenu(toMenuActions(
      r.actions,
      {
        validate: { label: t('inventory.action.validate'), hint: t('gds.hint.dialog'), onSelect: () => setValidate(r.id) },
        count: { label: t('inventory.action.count'), hint: t('gds.hint.page'), onSelect: () => router.push(`/inventory/${r.id}`) },
        open: { label: t('action.open'), hint: t('gds.hint.page'), onSelect: () => router.push(`/inventory/${r.id}`) },
        sheet: { label: t('inventory.action.sheet'), onSelect: () => void sheet(r.id) },
        cancel: { label: t('inventory.action.cancel'), separated: true, destructive: true, onSelect: () => setCancel(r) },
      },
      t,
    ), offline ? t('banner.offline') : undefined, ['count', 'open', 'sheet']);
  const element = (
    <>
      <ValidateInventoryDialog inventoryId={validate} onClose={() => setValidate(null)} />
      <ConfirmDialog
        open={!!cancel}
        onOpenChange={(o) => !o && setCancel(null)}
        title={t('inventory.cancel.title', { number: cancel?.number ?? '' })}
        description={t('inventory.cancel.description')}
        confirmLabel={t('inventory.action.cancel')}
        cancelLabel={t('action.keep')}
        destructive
        closeLabel={t('action.close')}
        onConfirm={() =>
          void (async () => {
            if (!cancel) return;
            try {
              await gdsApi.cancelInventory(cancel.id);
              await refresh();
              toast(t('inventory.cancelled', { number: cancel.number }));
            } catch (e) {
              toast({ tone: 'danger', message: refusal(e, t) });
            } finally {
              setCancel(null);
            }
          })()
        }
      />
    </>
  );
  return { menu, element, sheet, validate: setValidate };
}

/* ======================================== list ======================================== */
export function InventoriesPage() {
  const t = useT();
  return (
    <AdvancedOnly title={t('inventory.title')}>
      <InventoriesList />
    </AdvancedOnly>
  );
}

function InventoriesList() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const { can } = useSession();
  const list = useListState(INVENTORIES_SPEC);
  const q = useInventories(list.apiQuery());
  const offline = useOffline();
  const actions = useInventoryActions();
  const day = useDayLabel();
  const [start, setStart] = useState(false);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const open = rows.find((r) => r.status === 'draft' || r.status === 'counting');
  const canStart = can('stock.adjust');

  const columns: Column<InventoryRow>[] = [
    { key: 'number', header: t('inventory.col.number'), sortKey: 'number', hideable: false, cell: (r) => <Ltr className="font-medium">{`#${r.number}`}</Ltr> },
    { key: 'scope', header: t('inventory.col.scope'), cell: (r) => (r.scope === 'category' ? `${t('inventory.scope.category')} · ${r.categoryName ?? '—'}` : t(`inventory.scope.${r.scope}`)) },
    {
      key: 'status',
      header: t('common.status'),
      cell: (r) => (
        <StatusPill enumKey="Inventory.status" value={r.status} className="!rounded-[4px]">
          {t(`enum.Inventory.status.${r.status}`)}
        </StatusPill>
      ),
    },
    { key: 'lines', header: t('inventory.col.counted'), align: 'end', cell: (r) => <Ltr className="tabular-nums">{`${formatNumber(r.summary.counted)} / ${formatNumber(r.summary.lines)}`}</Ltr> },
    { key: 'gaps', header: t('inventory.col.gaps'), align: 'end', hideBelow: 'lg', cell: (r) => <Ltr className="tabular-nums">{formatNumber(r.summary.discrepancies)}</Ltr> },
    { key: 'value', header: t('inventory.col.value'), align: 'end', hideBelow: 'lg', cell: (r) => <Ltr className={cn('tabular-nums', r.summary.value < 0 && 'text-accent-alert')}>{formatMoney(r.summary.value)}</Ltr> },
    { key: 'started', header: t('inventory.col.started'), sortKey: 'startedAt', hideBelow: 'xl', cell: (r) => `${day(r.startedAt.slice(0, 10))} · ${shortName(r.startedBy) ?? '—'}` },
  ];

  return (
    <AppPage
      wide
      eyebrow={t('nav.group.stock')}
      title={t('inventory.title')}
      description={t('inventory.subtitle')}
      permission="stock.count"
      actions={
        <Button variant="primary" onClick={() => setStart(true)} disabledReason={!canStart ? t('toast.forbidden') : offline ? t('banner.offline') : open ? t('error.INVENTORY_IN_PROGRESS', { number: open.number }) : undefined} data-testid="inventory-start">
          {t('inventory.start.action')}
        </Button>
      }
    >
      {offline ? <OfflineBanner since={q.dataUpdatedAt ? formatDateTime(new Date(q.dataUpdatedAt).toISOString(), locale) : '—'} onRetry={() => void q.refetch()} /> : null}
      {open ? (
        <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-center" data-testid="inventory-open">
          <ClipboardList className="size-5 shrink-0 text-text-secondary" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="ts-title">{t('inventory.openCard.title', { number: open.number })}</div>
            <div className="ts-label-meta mt-1 text-text-muted">{t('inventory.openCard.progress', { counted: formatNumber(open.summary.counted), lines: formatNumber(open.summary.lines) })}</div>
            <ProgressBar className="mt-2" value={open.summary.lines ? Math.round((open.summary.counted * 100) / open.summary.lines) : 0} label={t('inventory.openCard.progressLabel')} />
          </div>
          <Link href={`/inventory/${open.id}`} className="inline-flex h-9 items-center rounded-card bg-white px-3 text-[13px] font-medium text-black" data-testid="inventory-continue">
            {t('inventory.openCard.continue')}
          </Link>
        </Card>
      ) : null}
      {q.isPending ? (
        <Card>
          <ListLoading rows={4} columns={6} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty title={t('inventory.empty.title')} description={t('inventory.empty.description')} action={canStart && !offline ? { label: t('inventory.start.action'), onClick: () => setStart(true) } : undefined} />
      ) : (
        <DataTable<InventoryRow>
          label={t('inventory.title')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          density={list.density}
          onRowClick={(r) => router.push(`/inventory/${r.id}`)}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={`#${r.number}`} actions={actions.menu(r)} />}
          card={(r) => (
            <div className="flex items-center gap-3 px-3 py-3">
              <Link href={`/inventory/${r.id}`} className="min-w-0 flex-1">
                <Ltr className="font-medium">{`#${r.number}`}</Ltr>
                <div className="ts-label-micro text-text-muted">{`${t(`enum.Inventory.status.${r.status}`)} · ${formatNumber(r.summary.counted)} / ${formatNumber(r.summary.lines)}`}</div>
              </Link>
              <ActionsMenu label={t('action.actions')} actions={actions.menu(r)} />
            </div>
          )}
          footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={q.data?.total ?? rows.length} onChange={(p) => list.set(p)} />}
        />
      )}
      <StartInventoryDialog open={start} onClose={() => setStart(false)} />
      {actions.element}
    </AppPage>
  );
}

/* ======================================== Lancer un inventaire ======================================== */
export function StartInventoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const refresh = useGdsRefresh();
  const categories = useCategories(open);
  const cats = flattenCategories(categories.data ?? []);
  const [scope, setScope] = useState<InventoryScope>('all');
  const [categoryId, setCategoryId] = useState('');
  const [block, setBlock] = useState(false);
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setScope('all');
    setCategoryId('');
    setBlock(false);
    setTouched(false);
  });
  const all = useInventoryScope('all', null, open);
  const alerts = useInventoryScope('alerts_only', null, open);
  const cat = useInventoryScope('category', categoryId || null, open && scope === 'category');
  const s = useDialogSubmit(() => gdsApi.startInventory({ scope, categoryId: scope === 'category' ? categoryId : null, blockCounterSales: block }));
  const submit = async () => {
    setTouched(true);
    if (scope === 'category' && !categoryId) return;
    const r = await s.submit();
    if (!r) return;
    toast(t('inventory.started', { number: r.number }));
    await refresh();
    onClose();
    router.push(`/inventory/${r.id}`);
  };
  const size = (p: { products: number; variants: number } | undefined) => (p ? t('inventory.scope.size', { products: p.products, variants: p.variants }) : '…');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !s.busy && onClose()}
      title={t('inventory.start.title')}
      description={t('inventory.start.description')}
      closeLabel={t('action.close')}
      size="md"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('inventory.start.submit')} />}
    >
      <div className="flex flex-col gap-4" data-testid="inventory-start-dialog">
        <RadioList<InventoryScope>
          label={t('inventory.col.scope')}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('inventory.start.all', { size: size(all.data) }) },
            { value: 'category', label: t('inventory.scope.category'), description: scope === 'category' && categoryId ? size(cat.data) : undefined },
            { value: 'alerts_only', label: t('inventory.start.alerts', { count: alerts.data?.lines ?? 0 }) },
          ]}
        />
        {scope === 'category' ? (
          <Field label={t('inventory.start.category')} htmlFor="inv-category" error={touched && !categoryId ? t('validation.required') : s.fieldError('categoryId')}>
            <Select id="inv-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('inventory.start.pickCategory')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={block} onChange={(e) => setBlock(e.target.checked)} />
          {t('inventory.start.block')}
        </label>
        <p className="ts-label-micro !normal-case text-text-muted">{t('inventory.start.note')}</p>
        {s.error ? (
          <FormAlert>
            {s.error}
          </FormAlert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ======================================== counting page ======================================== */
export function InventoryPage({ id }: { id: string }) {
  const t = useT();
  return (
    <AdvancedOnly title={t('inventory.title')}>
      <InventoryCount id={id} />
    </AdvancedOnly>
  );
}

type Draft = { counted: string; note: string };
function InventoryCount({ id }: { id: string }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const offline = useOffline();
  const q = useInventory(id);
  const actions = useInventoryActions();
  const day = useDayLabel();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, 'saving' | 'error'>>({});
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'todo' | 'gaps'>('all');
  const pending = useRef(new Set<string>());
  const inv = q.data;
  const editable = !!inv && (inv.status === 'draft' || inv.status === 'counting') && can('stock.count') && !offline;

  const valueOf = useCallback((l: InventoryLine): number | null => {
    const d = drafts[lineKey(l)];
    if (d) return d.counted.trim() === '' ? null : Number(d.counted);
    return l.countedQty;
  }, [drafts]);
  const save = async (l: InventoryLine) => {
    const k = lineKey(l);
    const d = drafts[k];
    if (!d || !inv) return;
    const counted = d.counted.trim() === '' ? null : Number(d.counted);
    if (counted === l.countedQty && (d.note.trim() || null) === (l.note ?? null)) return;
    pending.current.add(k);
    setSaving((x) => ({ ...x, [k]: 'saving' }));
    try {
      const next = await gdsApi.saveLines(inv.id, { lines: [{ productId: l.productId, variantId: l.variantId, countedQty: counted, note: d.note.trim() || null }] });
      qc.setQueryData(gdsKeys.inventory(ws, inv.id), next);
      setDrafts((x) => {
        const { [k]: _done, ...rest } = x;
        return rest;
      });
      setSaving(({ [k]: _done, ...rest }) => rest);
    } catch (e) {
      setSaving((x) => ({ ...x, [k]: 'error' }));
      toast({ tone: 'danger', message: refusal(e, t) });
    } finally {
      pending.current.delete(k);
    }
  };

  const lines = useMemo(() => inv?.lines ?? [], [inv]);
  const totals = inventoryTotals(lines.map((l) => ({ expected: l.currentExpectedQty, counted: valueOf(l), cost: l.costPrice })));
  const shown = lines.filter((l) => {
    const term = search.trim().toLowerCase();
    if (term && ![l.name, l.variantName, l.sku].filter(Boolean).some((x) => x!.toLowerCase().includes(term))) return false;
    const c = valueOf(l);
    if (show === 'todo') return c === null;
    if (show === 'gaps') return c !== null && c !== l.currentExpectedQty;
    return true;
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError || !inv)
    return (
      <AppPage title={t('inventory.title')} back={{ href: '/inventory', label: t('inventory.title') }} permission="stock.count">
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref="/inventory" />
      </AppPage>
    );
  const validate = actionState(inv.actions, 'validate', t);
  return (
    <AppPage
      title={t('inventory.page.title', { number: inv.number })}
      description={t('inventory.page.subtitle', { counted: formatNumber(totals.counted), lines: formatNumber(lines.length), scope: inv.scope === 'category' ? (inv.categoryName ?? '') : t(`inventory.scope.${inv.scope}`) })}
      back={{ href: '/inventory', label: t('inventory.title') }}
      permission="stock.count"
      badges={
        <StatusPill enumKey="Inventory.status" value={inv.status} className="!rounded-[4px]">
          {t(`enum.Inventory.status.${inv.status}`)}
        </StatusPill>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => void actions.sheet(inv.id)}>
            {t('inventory.action.sheet')}
          </Button>
          {validate.present ? (
            <Button variant="primary" onClick={() => actions.validate(inv.id)} disabledReason={offline ? t('banner.offline') : !validate.enabled ? validate.reason : totals.counted === 0 ? t('inventory.page.nothingCounted') : undefined} data-testid="inventory-validate">
              {t('inventory.action.validate')}
            </Button>
          ) : null}
          <ActionsMenu label={t('action.actions')} heading={`#${inv.number}`} actions={actions.menu(inv)} size="md" />
        </>
      }
    >
      {inv.blockCounterSales && (inv.status === 'draft' || inv.status === 'counting') ? <Banner tone="warning">{t('inventory.page.blocking')}</Banner> : null}
      {inv.status === 'validated' ? <Banner tone="success">{t('inventory.page.validated', { date: inv.validatedAt ? day(inv.validatedAt.slice(0, 10)) : '—', name: shortName(inv.validatedBy) ?? '—' })}</Banner> : null}
      {inv.status === 'cancelled' ? <Banner tone="neutral">{t('inventory.page.cancelledBanner')}</Banner> : null}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="inventory-kpis">
        <KpiTile value={`${formatNumber(totals.counted)} / ${formatNumber(lines.length)}`} label={t('inventory.kpi.counted')} meta={`${totals.progressPct} %`} />
        <KpiTile value={formatNumber(totals.discrepancies)} label={t('inventory.kpi.gaps')} meta={t('inventory.kpi.flagged', { count: totals.flagged })} tone={totals.flagged ? 'warning' : undefined} />
        <KpiTile value={formatNumber(totals.value)} label={t('inventory.kpi.value')} meta={t('inventory.kpi.valueMeta')} tone={totals.value < 0 ? 'danger' : undefined} />
        <KpiTile value={day(inv.startedAt.slice(0, 10))} label={t('inventory.kpi.started')} meta={shortName(inv.startedBy) ?? '—'} />
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} label={t('action.search')} placeholder={t('inventory.page.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-96" />
        <SegmentedControl<'all' | 'todo' | 'gaps'>
          label={t('inventory.page.show')}
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: t('inventory.page.showAll') },
            { value: 'todo', label: t('inventory.page.showTodo') },
            { value: 'gaps', label: t('inventory.page.showGaps') },
          ]}
        />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-[13px]" data-testid="inventory-lines">
          <thead>
            <tr className="ts-label-micro text-text-muted">
              <th className="px-4 py-2 text-start font-normal">{t('purchases.col.productVariant')}</th>
              <th className="px-4 py-2 text-end font-normal">{t('inventory.col.expected')}</th>
              <th className="px-4 py-2 text-end font-normal">{t('inventory.col.countedQty')}</th>
              <th className="px-4 py-2 text-end font-normal">{t('inventory.col.gap')}</th>
              <th className="px-4 py-2 text-start font-normal">{t('common.note')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-hairline">
            {shown.map((l) => {
              const k = lineKey(l);
              const c = valueOf(l);
              const v = variance(l.currentExpectedQty, c);
              const d = drafts[k];
              return (
                <tr key={k} data-line={k} data-state={saving[k] ?? (c === null ? 'todo' : 'counted')}>
                  <td className="px-4 py-2">
                    <div>
                      {l.name}
                      {l.variantName ? <span className="text-text-secondary"> · {l.variantName}</span> : null}
                    </div>
                    {l.sku ? <Ltr className="ts-label-micro text-text-muted">{l.sku}</Ltr> : null}
                  </td>
                  <td className="px-4 py-2 text-end">
                    <Ltr className="tabular-nums text-text-secondary">{formatNumber(l.currentExpectedQty)}</Ltr>
                  </td>
                  <td className="px-4 py-2">
                    {editable ? (
                      <NumberInput
                        aria-label={t('inventory.page.countFor', { name: [l.name, l.variantName].filter(Boolean).join(' · ') })}
                        value={d ? d.counted : l.countedQty === null ? '' : String(l.countedQty)}
                        onValueChange={(x) => setDrafts((all) => ({ ...all, [k]: { counted: x, note: all[k]?.note ?? l.note ?? '' } }))}
                        onBlur={() => void save(l)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                        maxDigits={7}
                        className={cn('!h-8 ms-auto w-24 text-end', saving[k] === 'error' && '!border-accent-alert')}
                      />
                    ) : (
                      <Ltr className="block text-end tabular-nums">{c === null ? '—' : formatNumber(c)}</Ltr>
                    )}
                  </td>
                  <td className="px-4 py-2 text-end">
                    <VarianceValue expected={l.currentExpectedQty} counted={c} pct={v.pct} flagged={v.noteRequired} />
                  </td>
                  <td className="px-4 py-2">
                    {editable && (v.noteRequired || l.note || d?.note) ? (
                      <Input
                        aria-label={t('inventory.page.noteFor', { name: l.name })}
                        value={d ? d.note : (l.note ?? '')}
                        maxLength={500}
                        onChange={(e) => setDrafts((all) => ({ ...all, [k]: { counted: all[k]?.counted ?? (l.countedQty === null ? '' : String(l.countedQty)), note: e.target.value } }))}
                        onBlur={() => void save(l)}
                        placeholder={v.noteRequired ? t('inventory.page.noteRequired') : ''}
                        className={cn('!h-8 min-w-40', v.noteRequired && !(d ? d.note : l.note) && '!border-accent-starred')}
                      />
                    ) : (
                      <span className="text-text-secondary">{l.note ?? ''}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="px-4 py-6 text-center ts-label-meta text-text-muted">{t('inventory.page.noLine')}</p> : null}
      </Card>
      <p className="ts-label-micro !normal-case text-text-muted">{t('inventory.page.footnote')}</p>
      {actions.element}
    </AppPage>
  );
}

/* ======================================== Valider l'inventaire ======================================== */
export function ValidateInventoryDialog({ inventoryId, onClose }: { inventoryId: string | null; onClose: () => void }) {
  const typed = useTypedFlag(!!inventoryId);
  const t = useT();
  const refresh = useGdsRefresh();
  const q = useInventory(inventoryId);
  const inv: Inventory | undefined = q.data;
  const [note, setNote] = useState('');
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  useOnOpen(!!inventoryId, () => {
    setNote('');
    setLineNotes({});
    setMissing([]);
    void q.refetch();
  });
  const counted = (inv?.lines ?? []).filter((l) => l.countedQty !== null);
  const gaps = counted.filter((l) => l.countedQty !== l.currentExpectedQty);
  const totals = inventoryTotals(counted.map((l) => ({ expected: l.currentExpectedQty, counted: l.countedQty, cost: l.costPrice })));
  const s = useDialogSubmit(async (key) => {
    // notes typed here for the lines above 10 % are saved first (validation reads them from the lines)
    const notes = gaps.filter((l) => (lineNotes[lineKey(l)] ?? '').trim() && (lineNotes[lineKey(l)] ?? '').trim() !== (l.note ?? ''));
    if (notes.length) await gdsApi.saveLines(inventoryId!, { lines: notes.map((l) => ({ productId: l.productId, variantId: l.variantId, countedQty: l.countedQty, note: lineNotes[lineKey(l)]!.trim() })) });
    return gdsApi.validateInventory(inventoryId!, note.trim() || null, key);
  });
  const submit = async () => {
    const need = gaps.filter((l) => variance(l.currentExpectedQty, l.countedQty).noteRequired && !(lineNotes[lineKey(l)] ?? l.note ?? '').trim()).map(lineKey);
    setMissing(need);
    if (need.length) return;
    const r = await s.submit();
    if (!r) {
      void q.refetch();
      return;
    }
    toast(t('inventory.validated', { number: r.number, count: gaps.length }));
    await refresh();
    onClose();
  };
  // notes typed in the dialog are lost on close: asked first
  const title = inv ? t('inventory.validate.title', { number: inv.number }) : t('inventory.action.validate');
  const guard = useCloseGuard(typed.dirty, title, onClose);
  return (
    <>
    <Dialog
      open={!!inventoryId}
      onOpenChange={(o) => !o && !s.busy && guard.requestClose()}
      title={title}
      description={inv ? t('inventory.validate.description', { counted: formatNumber(counted.length), gaps: gaps.length, value: formatMoney(totals.value) }) : undefined}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={guard.requestClose} busy={s.busy} onSubmit={() => void submit()} label={t('inventory.validate.submit', { count: gaps.length })} closeLabel={t('inventory.validate.resume')} disabled={!inv} note={t('inventory.validate.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="inventory-validate-dialog" onChange={typed.onChange}>
        {q.isError ? <FormAlert>{refusal(q.error, t)}</FormAlert> : null}
        {gaps.length ? (
          <ul className="max-h-72 divide-y divide-line-hairline overflow-y-auto rounded-card border border-line-edge">
            {gaps.map((l) => {
              const v = variance(l.currentExpectedQty, l.countedQty);
              const k = lineKey(l);
              return (
                <li key={k} className="flex flex-col gap-1.5 px-3 py-2" data-line={k}>
                  <div className="flex items-center gap-3 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{[l.name, l.variantName].filter(Boolean).join(' · ')}</span>
                    <VarianceValue expected={l.currentExpectedQty} counted={l.countedQty} pct={v.pct} flagged={v.noteRequired} />
                  </div>
                  {v.noteRequired ? (
                    <Input
                      aria-label={t('inventory.page.noteFor', { name: l.name })}
                      value={lineNotes[k] ?? l.note ?? ''}
                      onChange={(e) => setLineNotes((x) => ({ ...x, [k]: e.target.value }))}
                      placeholder={t('inventory.page.noteRequired')}
                      aria-invalid={missing.includes(k) || undefined}
                      className={cn('!h-8', missing.includes(k) && '!border-accent-alert')}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-text-secondary">{t('inventory.validate.noGap')}</p>
        )}
        {missing.length ? <FormAlert>{t('error.INVENTORY_VARIANCE_NOTE_REQUIRED')}</FormAlert> : null}
        <Field label={t('inventory.validate.noteLabel')} htmlFor="iv-note">
          <Input id="iv-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t('inventory.validate.notePlaceholder')} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}

