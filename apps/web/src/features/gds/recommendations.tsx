'use client';
// /recommendations — Figma "GDS-10 — Recommendations — list + generate job + stats" + DLG GDS II "Règle de
// recommandation" (03 GDS-10, REC-01…03, D18, 12 §21 "Recommendations"). Three views in the URL (`?view=`):
// cards (default: job banner with progress, KPIs, type tabs with counts, Priorité / Catégorie / Statut filters, cards
// with their RULE label and actions — Créer l'achat · Ignorer · Rappeler dans 7 j · …, APPLIQUÉE greyed with its link,
// ⋯ menu Ouvrir le produit · Voir les ventes · Régler le seuil · Désactiver cette règle), history (applied / dismissed /
// expired) and cross-sell rules (stats, table, manual rule dialog, generate job). Regenerate = 1 / 10 min
// (`RECO_RATE_LIMITED`).
import { formatDateTime, formatMoney, formatNumber, type AppLocale } from '@djaber/shared';
import {
  ActionsMenu,
  Button,
  Card,
  cn,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterChips,
  FilterDropdown,
  FormAlert,
  Input,
  JobBanner,
  KpiTile,
  KpiTileSkeleton,
  Ltr,
  NumberInput,
  Pill,
  RecommendationCard,
  Select,
  StatusPill,
  Switch,
  toast,
  type Column,
} from '@djaber/ui';
import { Lightbulb } from 'lucide-react';
import { usePathname, useRouter as useNextRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useCloseGuard, useTypedFlag } from '@/components/close-guard';
import { AppPage } from '@/components/app-page';
import { ListLoading, OfflineBanner, QueryError } from '@/components/global-states';
import { useCategories } from '@/features/catalog/api';
import { flattenCategories } from '@/features/catalog/contracts';
import { ListPagination } from '@/features/catalog/ui';
import { DialogFooter, RadioList, refusal, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { toMenuActions } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { isJobRunning, useJob } from '@/lib/jobs';
import { filterList, filterText, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useListState } from '@/lib/use-list-state';
import { gdsApi, useCrossSell, useCrossSellStats, useGdsRefresh, useStockRecoHistory, useStockRecos, useStockRecoStats } from './api';
import { RECO_PRIORITIES, STOCK_RECO_TYPES, type CrossSellRule, type RecoJobResult, type StockReco } from './contracts';
import { ProductPicker, type PickedProduct } from './product-picker';
import { useDayLabel } from './ui';

export const RECOS_SPEC: ListSpec = { filters: { type: 'text', priority: 'list', categoryId: 'text', status: 'text', view: 'text', job: 'text' }, sorts: ['score', 'impressions', 'conversions', 'revenue', 'createdAt'], defaultSort: '-score' };
const STATUSES = ['active', 'snoozed', 'applied', 'dismissed'] as const;

export function RecommendationsPage() {
  const t = useT();
  const { can, workspace } = useSession();
  const list = useListState(RECOS_SPEC);
  const view = filterText(list.state, 'view') || 'cards';
  const offline = useOffline();
  const writeReason = !can('catalog.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  const simple = workspace?.stockMode !== 'advanced';
  const tabs = [
    { key: 'cards', label: t('recos.view.cards') },
    { key: 'history', label: t('recos.view.history') },
    ...(simple ? [] : [{ key: 'cross', label: t('recos.view.cross') }]),
  ];
  return (
    <AppPage wide eyebrow={t('nav.group.stock')} title={t('nav.recommendations')} description={t('recos.subtitle')} permission="catalog.read" actions={view === 'cards' ? <RegenerateButton list={list} reason={writeReason} /> : view === 'cross' ? <CrossSellActions reason={writeReason} /> : undefined}>
      {offline ? <OfflineBanner since="—" /> : null}
      <nav aria-label={t('recos.view.label')} className="flex flex-wrap gap-1.5">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-current={view === x.key ? 'page' : undefined}
            data-view={x.key}
            onClick={() => list.set({ filters: { view: x.key === 'cards' ? null : x.key, type: null, priority: null, status: null, categoryId: null, job: null } })}
            className={cn('flex h-8 items-center rounded-card border px-3 text-[13px]', view === x.key ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary')}
          >
            {x.label}
          </button>
        ))}
      </nav>
      {view === 'history' ? <History list={list} /> : view === 'cross' && !simple ? <CrossSell list={list} offline={offline} /> : <Cards list={list} offline={offline} simple={simple} />}
    </AppPage>
  );
}

/* ---------- Régénérer maintenant (1 / 10 min) + job id in the URL ---------- */
function RegenerateButton({ list, reason }: { list: ReturnType<typeof useListState>; reason?: string }) {
  const t = useT();
  const stats = useStockRecoStats();
  const [busy, setBusy] = useState(false);
  const wait = stats.data?.regenerateAvailableIn ?? 0;
  const run = async () => {
    setBusy(true);
    try {
      const { jobId } = await gdsApi.generateStockRecos();
      list.setFilter('job', jobId);
    } catch (e) {
      toast({ tone: e instanceof ApiError && e.status === 429 ? 'warning' : 'danger', message: refusal(e, t) });
      void stats.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="primary"
      onClick={() => void run()}
      loading={busy}
      disabledReason={reason ?? (wait > 0 ? `${t('error.RECO_RATE_LIMITED', { retryAfter: `${Math.ceil(wait / 60)} min` })} (RECO_RATE_LIMITED)` : undefined)}
      data-testid="reco-generate"
    >
      {t('recos.generate')}
    </Button>
  );
}

function GenerationBanner({ jobId, lastRunAt, onDone }: { jobId: string | null; lastRunAt: string | null; onDone: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const job = useJob<RecoJobResult>(jobId);
  const j = job.data;
  const finished = !!j && !isJobRunning(j);
  useEffect(() => {
    if (finished) onDone();
  }, [finished, onDone]);
  if (!jobId) return null;
  const since = lastRunAt ? formatDateTime(lastRunAt, locale) : '—';
  if (!j || isJobRunning(j))
    return (
      <JobBanner state="running" pill={t('recos.job.running', { pct: j?.progress ?? 0 })} progress={j?.progress ?? 0}>
        <span data-testid="reco-job">{t('recos.job.runningText', { analyzed: formatNumber(Math.round(((j?.progress ?? 0) * (j?.total ?? 0)) / 100)), total: formatNumber(j?.total ?? 0), since })}</span>
      </JobBanner>
    );
  if (j.status === 'done' || j.status === 'partial')
    return (
      <JobBanner state="done" pill={t('recos.job.done')}>
        <span data-testid="reco-job">{t('recos.job.doneText', { created: j.result?.created ?? 0, removed: j.result?.removed ?? 0 })}</span>
      </JobBanner>
    );
  return (
    <JobBanner state="failed" pill={t('recos.job.failed')}>
      <span data-testid="reco-job">{j.error ? `${j.error.message} (${j.error.code})` : t('recos.job.failedText')}</span>
    </JobBanner>
  );
}

/* ---------- cards ---------- */
function Cards({ list, offline, simple }: { list: ReturnType<typeof useListState>; offline: boolean; simple: boolean }) {
  const t = useT();
  const router = useRouter();
  const day = useDayLabel();
  const { can } = useSession();
  const refresh = useGdsRefresh();
  const s = list.state;
  const type = filterText(s, 'type');
  const priorities = filterList(s, 'priority');
  const categoryId = filterText(s, 'categoryId');
  const status = filterText(s, 'status') || 'active';
  const query = { ...(type ? { type: [type] } : {}), ...(priorities.length ? { priority: priorities } : {}), ...(categoryId ? { categoryId } : {}), status };
  const q = useStockRecos(query);
  const stats = useStockRecoStats();
  const categories = useCategories();
  const cats = flattenCategories(categories.data ?? []);
  const k = stats.data;
  const rows = q.data ?? [];
  const writeReason = !can('catalog.write') ? t('toast.forbidden') : offline ? t('banner.offline') : undefined;
  const jobId = filterText(s, 'job') || null;
  // "Désactiver cette règle pour ce produit" cannot be undone from the screen: confirmed first
  const [mute, setMute] = useState<StockReco | null>(null);

  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      await refresh();
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const apply = async (r: StockReco) => {
    const a = r.suggestedAction;
    const p = (a.params ?? {}) as Record<string, string | number | null | undefined>;
    if (a.kind === 'create_purchase') {
      const qs = new URLSearchParams(Object.entries({ productId: p.productId ?? r.product?.id, variantId: p.variantId ?? r.product?.variant?.id, quantity: p.quantity, supplierId: p.supplierId ?? r.supplier?.id, unitCost: p.unitCost, reco: r.id }).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k2, v]) => [k2, String(v)]));
      router.push(`/purchases/new?${qs.toString()}`);
      return;
    }
    // a price or promo change is applied by the product form once a price is really saved (tester report 2026-10-20:
    // the card turned APPLIQUÉE and left the list as soon as the form opened, saved or not)
    if ((a.kind === 'update_price' || a.kind === 'create_promo') && r.product) {
      router.push(`/products/${r.product.id}/edit?reco=${r.id}&recoRef=${a.kind === 'create_promo' ? 'promo' : 'product'}`);
      return;
    }
    const target =
      a.kind === 'open_supplier' && r.supplier
        ? { href: `/suppliers?sheet=${r.supplier.id}`, refType: 'supplier', refId: r.supplier.id }
        : a.kind === 'open_insights' && r.agent
          ? { href: `/agents/${r.agent.id}/insights`, refType: 'insight', refId: null }
          : r.product
            ? { href: a.kind === 'open_product' ? `/products/${r.product.id}` : `/products/${r.product.id}/edit`, refType: a.kind === 'create_promo' ? 'promo' : 'product', refId: r.product.id }
            : null;
    try {
      await gdsApi.applyStockReco(r.id, target ? { refType: target.refType, refId: target.refId } : {});
      await refresh();
      if (target) router.push(target.href);
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const menu = (r: StockReco) =>
    toMenuActions(
      r.actions,
      {
        open_product: { label: t('recos.action.openProduct'), onSelect: () => r.product && router.push(`/products/${r.product.id}`) },
        open_sales: { label: t('recos.action.openSales'), onSelect: () => r.product && router.push(`/sales?productId=${r.product.id}`) },
        set_threshold: { label: t('recos.action.threshold'), onSelect: () => r.product && router.push(`/products/${r.product.id}/edit`) },
        mute: { label: t('recos.action.mute'), separated: true, hint: t('gds.hint.dialog'), onSelect: () => r.product && setMute(r) },
      },
      t,
    );
  const appliedHref = (r: StockReco) => (r.applied?.refType === 'purchase' && r.applied.refId ? `/purchases/${r.applied.refId}` : r.applied?.refType === 'supplier' && r.applied.refId ? `/suppliers?sheet=${r.applied.refId}` : r.product ? `/products/${r.product.id}` : null);

  const tabs = [{ key: '', count: k?.active }, ...STOCK_RECO_TYPES.filter((x) => !simple || x === 'restock' || x === 'stockout_imminent' || x === 'agent').map((x) => ({ key: x, count: k?.byType[x] }))];
  return (
    <>
      <GenerationBanner jobId={jobId} lastRunAt={k?.lastRun.at ?? null} onDone={() => void refresh()} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t('recos.kpi.label')} data-testid="reco-kpis">
        {k ? (
          <>
            <KpiTile value={formatNumber(k.active)} label={t('recos.kpi.active')} meta={t('recos.kpi.high', { count: k.highPriority })} data-kpi="active" />
            <KpiTile value={formatNumber(k.restock.count)} label={t('recos.kpi.restock')} meta={t('recos.kpi.value', { amount: formatMoney(k.restock.estimatedValue) })} data-kpi="restock" />
            <KpiTile value={formatNumber(k.promote.count)} label={t('recos.kpi.promote')} meta={t('recos.kpi.dormant')} data-kpi="promote" />
            <KpiTile value={k.last30d.applicationRatePct === null ? '—' : `${k.last30d.applicationRatePct} %`} label={t('recos.kpi.rate')} meta={t('recos.kpi.rateMeta', { applied: k.last30d.applied, dismissed: k.last30d.dismissed, expired: k.last30d.expired })} data-kpi="rate" />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} />)
        )}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t('recos.tabs')} className="flex flex-1 flex-wrap gap-1.5">
          {tabs.map((x) => (
            <button
              key={x.key || 'all'}
              type="button"
              aria-current={type === x.key ? 'page' : undefined}
              data-tab={x.key || 'all'}
              onClick={() => list.setFilter('type', x.key || null)}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-card border px-3 text-[13px]', type === x.key ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary')}
            >
              {x.key ? t(`enum.StockReco.type.${x.key}`) : t('common.all')}
              {x.count !== undefined ? <Ltr className="tabular-nums">{formatNumber(x.count)}</Ltr> : null}
            </button>
          ))}
        </nav>
        <FilterDropdown label={t('recos.filter.priority')} count={priorities.length}>
          <FilterChips label={t('recos.filter.priority')} multiple options={RECO_PRIORITIES.map((p) => ({ value: p, label: t(`enum.StockReco.priority.${p}`) }))} value={priorities} onChange={(v) => list.setFilter('priority', v)} />
        </FilterDropdown>
        <FilterDropdown label={t('recos.filter.category')} count={categoryId ? 1 : 0}>
          <FilterChips label={t('recos.filter.category')} allLabel={t('common.all')} options={cats.map((c) => ({ value: c.id, label: c.label }))} value={categoryId ? [categoryId] : []} onChange={(v) => list.setFilter('categoryId', v[0] ?? null)} />
        </FilterDropdown>
        <FilterDropdown label={t('recos.filter.status', { status: t(`enum.StockReco.status.${status}`).toLowerCase() })} align="end">
          <FilterChips label={t('common.status')} options={STATUSES.map((x) => ({ value: x, label: t(`enum.StockReco.status.${x}`) }))} value={[status]} onChange={(v) => list.setFilter('status', v[0] && v[0] !== 'active' ? v[0] : null)} />
        </FilterDropdown>
      </div>
      {simple ? <p className="ts-label-micro !normal-case text-text-muted">{t('recos.simpleNote')}</p> : null}

      {q.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-card border border-line-edge bg-ink-surface" />
          ))}
        </div>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="size-5" />}
          title={t('recos.empty.title')}
          description={k?.lastRun.at ? t('recos.empty.lastRun', { date: day(k.lastRun.at.slice(0, 10)) }) : t('recos.empty.description')}
          action={type || priorities.length || categoryId || status !== 'active' ? { label: t('action.clearFilters'), onClick: () => list.setFilters({ type: null, priority: null, categoryId: null, status: null }) } : undefined}
        />
      ) : (
        <div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-3', q.isPlaceholderData && 'opacity-60')} data-testid="reco-cards">
          {rows.map((r) => {
            const applyAction = r.actions.find((a) => a.key === 'apply');
            const href = appliedHref(r);
            return (
              <RecommendationCard
                key={r.id}
                data-reco={r.id}
                data-type={r.type}
                pills={
                  <>
                    <StatusPill enumKey="Recommendation.type" value={r.type} className="!rounded-[4px]">
                      {t(`enum.StockReco.type.${r.type}`)}
                    </StatusPill>
                    <StatusPill enumKey="Recommendation.priority" value={r.priority} className="!rounded-[4px]">
                      {t(`enum.StockReco.priority.${r.priority}`)}
                    </StatusPill>
                    {r.status === 'snoozed' && r.snoozedUntil ? <Pill className="!rounded-[4px]">{t('recos.snoozedUntil', { date: day(r.snoozedUntil.slice(0, 10)) })}</Pill> : null}
                  </>
                }
                menu={<ActionsMenu label={t('action.actions')} heading={r.title} actions={menu(r)} iconOnly variant="ghost" />}
                title={r.title}
                onTitle={r.product ? () => router.push(`/products/${r.product!.id}`) : r.supplier ? () => router.push(`/suppliers?sheet=${r.supplier!.id}`) : undefined}
                body={r.body}
                suggestion={r.suggestedAction.label}
                rule={t('recos.rule', { rule: r.ruleLabel })}
                applied={
                  r.status === 'applied' ? (
                    href ? (
                      <button type="button" className="hover:underline" onClick={() => router.push(href)}>
                        {t('recos.applied', { date: r.appliedAt ? day(r.appliedAt.slice(0, 10)) : '' })} ↗
                      </button>
                    ) : (
                      t('recos.applied', { date: r.appliedAt ? day(r.appliedAt.slice(0, 10)) : '' })
                    )
                  ) : undefined
                }
                actions={
                  r.status === 'active' || r.status === 'snoozed' ? (
                    <>
                      {applyAction ? (
                        <Button size="sm" variant="primary" onClick={() => void apply(r)} disabledReason={writeReason ?? (applyAction.enabled ? undefined : `${t(`error.${applyAction.reasonCode ?? 'FORBIDDEN'}`)} (${applyAction.reasonCode})`)} data-testid="reco-apply">
                          {t(`recos.apply.${r.suggestedAction.kind}`)}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => void act(() => gdsApi.dismissStockReco(r.id), t('recos.dismissed'))} disabledReason={writeReason} data-testid="reco-dismiss">
                        {t('action.dismiss')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void act(() => gdsApi.snoozeStockReco(r.id, 7), t('recos.snoozed'))} disabledReason={writeReason} data-testid="reco-snooze">
                        {t('recos.snooze')}
                      </Button>
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
      <p className="ts-label-micro !normal-case text-text-muted">{t('recos.footnote')}</p>
      <ConfirmDialog
        open={!!mute}
        onOpenChange={(o) => !o && setMute(null)}
        title={t('recos.muteConfirm.title', { product: mute?.product?.name ?? '' })}
        description={t('recos.muteConfirm.description')}
        confirmLabel={t('recos.action.mute')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        onConfirm={() => {
          const r = mute;
          setMute(null);
          if (r?.product) void act(() => gdsApi.muteStockReco(r.product!.id, r.type), t('recos.muted'));
        }}
      />
    </>
  );
}

/* ---------- history ---------- */
function History({ list }: { list: ReturnType<typeof useListState> }) {
  const t = useT();
  const day = useDayLabel();
  const q = useStockRecoHistory({ page: list.state.page, pageSize: list.state.pageSize });
  const rows = q.data?.rows ?? [];
  const columns: Column<StockReco>[] = [
    { key: 'title', header: t('recos.col.title'), hideable: false, cell: (r) => <span className="font-medium">{r.title}</span> },
    {
      key: 'type',
      header: t('recos.col.type'),
      cell: (r) => (
        <StatusPill enumKey="Recommendation.type" value={r.type} className="!rounded-[4px]">
          {t(`enum.StockReco.type.${r.type}`)}
        </StatusPill>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (r) => (
        <StatusPill enumKey="Recommendation.status" value={r.status} className="!rounded-[4px]">
          {t(`enum.StockReco.status.${r.status}`)}
        </StatusPill>
      ),
    },
    { key: 'rule', header: t('recos.col.rule'), hideBelow: 'lg', cell: (r) => <span className="ts-label-micro text-text-muted">{r.ruleLabel}</span> },
    { key: 'date', header: t('common.date'), cell: (r) => day((r.appliedAt ?? r.dismissedAt ?? r.generatedAt).slice(0, 10)) },
  ];
  if (q.isPending)
    return (
      <Card>
        <ListLoading rows={5} columns={5} />
      </Card>
    );
  if (q.isError) return <QueryError error={q.error} onRetry={() => q.refetch()} />;
  if (!rows.length) return <EmptyState icon={<Lightbulb className="size-5" />} title={t('recos.history.empty')} />;
  return <DataTable<StockReco> label={t('recos.view.history')} columns={columns} rows={rows} rowKey={(r) => r.id} footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={q.data?.total ?? rows.length} onChange={(p) => list.set(p)} />} />;
}

/* ---------- cross-sell rules (REC-01…03) ---------- */
function CrossSellActions({ reason }: { reason?: string }) {
  const t = useT();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useNextRouter();
  const [busy, setBusy] = useState(false);
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v === null) p.delete(k);
    else p.set(k, v);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const generate = async () => {
    setBusy(true);
    try {
      const { jobId } = await gdsApi.generateCrossSell();
      setParam('job', jobId);
    } catch (e) {
      toast({ tone: e instanceof ApiError && e.status === 429 ? 'warning' : 'danger', message: refusal(e, t) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => void generate()} loading={busy} disabledReason={reason} data-testid="cross-generate">
        {t('recos.cross.generate')}
      </Button>
      <Button variant="primary" onClick={() => setParam('rule', 'new')} disabledReason={reason} data-testid="cross-new">
        {t('recos.cross.new')}
      </Button>
    </>
  );
}

function CrossSell({ list, offline }: { list: ReturnType<typeof useListState>; offline: boolean }) {
  const t = useT();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useNextRouter();
  const day = useDayLabel();
  const { can } = useSession();
  const refresh = useGdsRefresh();
  const q = useCrossSell({ page: list.state.page, pageSize: list.state.pageSize, sort: list.state.sort });
  const stats = useCrossSellStats();
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const k = stats.data;
  const ruleParam = params.get('rule');
  const editing = ruleParam === 'new' ? 'new' : (rows.find((r) => r.id === ruleParam) ?? null);
  const [del, setDel] = useState<CrossSellRule | null>(null);
  const canWrite = can('catalog.write') && !offline;
  const closeRule = () => {
    const p = new URLSearchParams(params.toString());
    p.delete('rule');
    router.replace(`${pathname}${p.toString() ? `?${p.toString()}` : ''}`, { scroll: false });
  };
  const openRule = (id: string) => {
    const p = new URLSearchParams(params.toString());
    p.set('rule', id);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const toggle = async (r: CrossSellRule, isActive: boolean) => {
    try {
      await gdsApi.updateCrossSell(r.id, { isActive });
      await refresh();
    } catch (e) {
      toast({ tone: 'danger', message: refusal(e, t) });
    }
  };
  const menu = (r: CrossSellRule) =>
    toMenuActions(
      r.actions,
      {
        edit: { label: t('action.edit'), hint: t('gds.hint.dialog'), onSelect: () => openRule(r.id) },
        activate: { label: t('action.enable'), onSelect: () => void toggle(r, true) },
        deactivate: { label: t('action.disable'), onSelect: () => void toggle(r, false) },
        delete: { label: t('action.delete'), separated: true, destructive: true, onSelect: () => setDel(r) },
      },
      t,
    );
  const columns: Column<CrossSellRule>[] = [
    {
      key: 'pair',
      header: t('recos.cross.col.pair'),
      hideable: false,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{r.product.name}</span>
          <span className="text-text-muted">→</span>
          <span className="truncate font-medium">{r.recommended.name}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: t('recos.col.type'),
      cell: (r) => (
        <StatusPill enumKey="Recommendation.kind" value={r.type} className="!rounded-[4px]">
          {t(`enum.Recommendation.type.${r.type}`)}
        </StatusPill>
      ),
    },
    { key: 'score', header: t('recos.cross.col.score'), sortKey: 'score', align: 'end', cell: (r) => <Ltr className="tabular-nums">{r.score}</Ltr> },
    { key: 'source', header: t('common.source'), hideBelow: 'lg', cell: (r) => t(`enum.Recommendation.source.${r.source}`) },
    { key: 'impressions', header: t('recos.cross.col.impressions'), sortKey: 'impressions', align: 'end', hideBelow: 'lg', cell: (r) => <Ltr className="tabular-nums">{formatNumber(r.impressions)}</Ltr> },
    { key: 'conversions', header: t('recos.cross.col.conversions'), sortKey: 'conversions', align: 'end', cell: (r) => <Ltr className="tabular-nums">{`${formatNumber(r.conversions)}${r.conversionRatePct !== null ? ` · ${r.conversionRatePct} %` : ''}`}</Ltr> },
    { key: 'revenue', header: t('recos.cross.col.revenue'), sortKey: 'revenue', align: 'end', hideBelow: 'xl', cell: (r) => <Ltr className="tabular-nums">{formatMoney(r.revenue)}</Ltr> },
    { key: 'active', header: t('recos.cross.col.active'), cell: (r) => <Switch checked={r.isActive} onCheckedChange={(v) => void toggle(r, v)} disabled={!canWrite} label={t('recos.cross.col.active')} /> },
  ];
  const jobId = filterText(list.state, 'job') || null;
  return (
    <>
      <CrossJobBanner jobId={jobId} onDone={() => void refresh()} />
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="cross-kpis">
        {k ? (
          <>
            <KpiTile value={formatNumber(k.active)} label={t('recos.cross.kpi.active')} meta={t('recos.cross.kpi.rules', { count: k.rules, manual: k.manual, generated: k.generated })} />
            <KpiTile value={formatNumber(k.impressions30d)} label={t('recos.cross.kpi.impressions')} meta={t('recos.cross.kpi.period')} />
            <KpiTile value={formatNumber(k.conversions30d)} label={t('recos.cross.kpi.conversions')} meta={k.conversionRatePct30d === null ? '—' : `${k.conversionRatePct30d} %`} />
            <KpiTile value={formatNumber(k.revenue30d)} label={t('recos.cross.kpi.revenue')} meta={k.lastRun.at ? t('recos.cross.kpi.lastRun', { date: day(k.lastRun.at.slice(0, 10)) }) : t('recos.cross.kpi.neverRun')} />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} />)
        )}
      </section>
      {q.isPending ? (
        <Card>
          <ListLoading rows={5} columns={6} />
        </Card>
      ) : q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Lightbulb className="size-5" />} title={t('recos.cross.empty.title')} description={t('recos.cross.empty.description')} action={canWrite ? { label: t('recos.cross.new'), onClick: () => openRule('new') } : undefined} />
      ) : (
        <DataTable<CrossSellRule>
          label={t('recos.view.cross')}
          className={cn(q.isPlaceholderData && 'opacity-60')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSortChange={list.setSort}
          sortLabel={(header) => t('list.sortBy', { column: header })}
          actionsLabel={t('action.actions')}
          rowActions={(r) => <ActionsMenu label={t('action.actions')} heading={`${r.product.name} → ${r.recommended.name}`} actions={menu(r)} />}
          footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={q.data?.total ?? rows.length} onChange={(p) => list.set(p)} note={t('recos.cross.note')} />}
        />
      )}
      <RuleDialog rule={editing} onClose={closeRule} />
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={t('recos.cross.delete.title')}
        description={del ? `${del.product.name} → ${del.recommended.name}` : undefined}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        destructive
        closeLabel={t('action.close')}
        onConfirm={() =>
          void (async () => {
            if (!del) return;
            try {
              await gdsApi.deleteCrossSell(del.id);
              await refresh();
              toast(t('recos.cross.deleted'));
            } catch (e) {
              toast({ tone: 'danger', message: refusal(e, t) });
            } finally {
              setDel(null);
            }
          })()
        }
      />
    </>
  );
}

function CrossJobBanner({ jobId, onDone }: { jobId: string | null; onDone: () => void }) {
  const t = useT();
  const job = useJob<RecoJobResult>(jobId);
  const j = job.data;
  const finished = !!j && !isJobRunning(j);
  useEffect(() => {
    if (finished) onDone();
  }, [finished, onDone]);
  if (!jobId) return null;
  if (!j || isJobRunning(j))
    return (
      <JobBanner state="running" pill={t('recos.job.running', { pct: j?.progress ?? 0 })} progress={j?.progress ?? 0}>
        <span data-testid="cross-job">{t('recos.cross.job.running')}</span>
      </JobBanner>
    );
  return (
    <JobBanner state={j.status === 'failed' ? 'failed' : 'done'} pill={j.status === 'failed' ? t('recos.job.failed') : t('recos.job.done')}>
      <span data-testid="cross-job">{j.status === 'failed' ? (j.error ? `${j.error.message} (${j.error.code})` : t('recos.job.failedText')) : t('recos.job.doneText', { created: j.result?.created ?? 0, removed: j.result?.removed ?? 0 })}</span>
    </JobBanner>
  );
}

/* ---------- Règle de recommandation ---------- */
type Pick1 = { id: string; name: string } | null;
export function RuleDialog({ rule, onClose }: { rule: CrossSellRule | 'new' | null; onClose: () => void }) {
  const t = useT();
  const refresh = useGdsRefresh();
  const editing = rule && rule !== 'new' ? rule : null;
  const typed = useTypedFlag(!!rule);
  const [product, setProduct] = useState<Pick1>(null);
  const [recommended, setRecommended] = useState<Pick1>(null);
  const [type, setType] = useState<'cross_sell' | 'up_sell'>('cross_sell');
  const [score, setScore] = useState('80');
  const [active, setActive] = useState('1');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useOnOpen(!!rule, () => {
    setProduct(editing ? { id: editing.product.id, name: editing.product.name } : null);
    setRecommended(editing ? { id: editing.recommended.id, name: editing.recommended.name } : null);
    setType(editing?.type ?? 'cross_sell');
    setScore(String(editing?.score ?? 80));
    setActive(editing && !editing.isActive ? '0' : '1');
    setReason(editing?.reason ?? '');
    setTouched(false);
  });
  const same = !!product && !!recommended && product.id === recommended.id;
  const s = useDialogSubmit(() =>
    editing
      ? gdsApi.updateCrossSell(editing.id, { type, score: Number(score) || 0, reason: reason.trim() || null, isActive: active === '1' })
      : gdsApi.createCrossSell({ productId: product!.id, recommendedId: recommended!.id, type, score: Math.min(100, Number(score) || 0), reason: reason.trim() || null, isActive: active === '1' }),
  );
  const submit = async () => {
    setTouched(true);
    if (!product || !recommended || same) return;
    const r = await s.submit();
    if (!r) return;
    toast(t(editing ? 'recos.cross.saved' : 'recos.cross.created'));
    await refresh();
    onClose();
  };
  const picked = (p: Pick1, set: (v: Pick1) => void, id: string, disabled: boolean) =>
    p ? (
      <div className="flex items-center gap-2 rounded-card border border-line-edge px-3 py-2 text-[13px]" data-testid={`${id}-picked`}>
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {!disabled ? (
          <button type="button" className="ts-label-meta text-text-muted hover:text-text-primary" onClick={() => set(null)}>
            {t('action.remove')}
          </button>
        ) : null}
      </div>
    ) : (
      <ProductPicker id={id} onPick={(x: PickedProduct) => set({ id: x.id, name: x.name })} placeholder={t('recos.rule.search')} />
    );
  const guard = useCloseGuard(typed.dirty || (!editing && (!!product || !!recommended)), t('recos.rule.title'), onClose);
  return (
    <>
    <Dialog
      open={!!rule}
      onOpenChange={(o) => !o && !s.busy && guard.requestClose()}
      title={t('recos.rule.title')}
      description={t('recos.rule.breadcrumb')}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={guard.requestClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} note={t('recos.rule.note')} />}
    >
      <div className="flex flex-col gap-4" data-testid="rule-dialog" onChange={typed.onChange}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('recos.rule.product')} required error={touched && !product ? t('validation.required') : s.fieldError('productId')}>
            {picked(product, setProduct, 'rule-product', !!editing)}
          </Field>
          <Field label={t('recos.rule.recommended')} required error={touched && !recommended ? t('validation.required') : touched && same ? t('recos.rule.same') : s.fieldError('recommendedId')}>
            {picked(recommended, setRecommended, 'rule-recommended', !!editing)}
          </Field>
        </div>
        <RadioList<'cross_sell' | 'up_sell'>
          label={t('recos.col.type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'cross_sell', label: t('recos.rule.cross'), description: t('recos.rule.crossHint') },
            { value: 'up_sell', label: t('recos.rule.up'), description: t('recos.rule.upHint') },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('recos.rule.score')} htmlFor="rule-score" error={s.fieldError('score')}>
            <NumberInput id="rule-score" value={score} onValueChange={(v) => setScore(String(Math.min(100, Number(v) || 0)))} maxDigits={3} />
          </Field>
          <Field label={t('recos.rule.active')} htmlFor="rule-active">
            <Select id="rule-active" value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="1">{t('common.yes')}</option>
              <option value="0">{t('common.no')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('recos.rule.reason')} htmlFor="rule-reason" error={s.fieldError('reason')}>
          <Input id="rule-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={t('recos.rule.reasonPlaceholder')} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}
