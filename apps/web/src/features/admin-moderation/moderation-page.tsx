'use client';
// /admin/moderation — Figma "ADM-10 — Platform admin — moderation queue (products) + review panel" (03 MOD-06…09,
// 12 §26 Moderation): 5 KPI tiles, tabs À vérifier / Urgents / Appels du marchand / Auto-approuvés (échantillon) /
// Rejetés / Agents IA (prompts), filters in the URL (search, Motif IA, Score, Confiance marchand, Catégorie, Attente;
// sort urgency then age), queue rows with ✓ / ✕ / ⋯, bulk Approuver / Rejeter (motif commun) / Assigner, the review panel
// of the item in `?sheet=` (first row by default), the legend blocks. Writes need `admin.moderation.write`.
import { formatNumber, MODERATION_AI_FLAGS, TrustLevelValues, type ModerationItemDto, type ModerationStatsDto } from '@djaber/shared';
import {
  ActiveFilters,
  Button,
  buttonClass,
  Card,
  Checkbox,
  cn,
  FilterCheckList,
  FilterChips,
  FilterDropdown,
  LegendNote,
  ListSkeleton,
  OpsKpiStrip,
  OpsKpiTile,
  PillTabs,
  SearchInput,
  Skeleton,
  toast,
  type MenuAction,
} from '@djaber/ui';
import { Check, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ListEmpty, ListFilteredEmpty, OfflineBanner } from '@/components/global-states';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { usePlatform } from '@/features/admin/platform';
import { ListPagination } from '@/features/catalog/ui';
import { useOffline } from '@/features/orders/offline';
import { Link, useRouter as useAppRouter } from '@/i18n/navigation';
import { reasonText } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { filterList, filterText } from '@/lib/list-state';
import { useListState } from '@/lib/use-list-state';
import { modApi, useAppeals, useModerationCategories, useModerationEvents, useModerationItems, useModerationRefresh, useModerationSample, useModerationStats } from './api';
import { AppealPanel, AppealRow } from './appeal-panel';
import { AssignDialog, BulkRejectDialog } from './dialogs';
import { decisionState, formatDelay, MOD_SPEC, SCORE_BUCKETS, scoreBucketOf, tabCount, tabOf, tabQuery, WAITING_PRESETS, type ModTab } from './logic';
import { ReviewPanel } from './review-panel';
import { RulesSheet } from './rules-sheet';
import { ItemRow, itemTitle, trustLabel } from './ui';

export function ModerationPage() {
  const t = useT();
  const { can } = usePlatform();
  const canWrite = can('admin.moderation.write');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const panel = params.get('panel');
  const setPanel = (v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set('panel', v);
    else p.delete('panel');
    router.replace(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  useModerationEvents();
  return (
    <AdminPage
      title={t('adminMod.title')}
      description={t('adminMod.subtitle')}
      permission="admin.moderation.read"
      actions={
        <>
          <Link href="/admin/cms?tab=legal" className={buttonClass({ variant: 'ghost' })} data-testid="mod-link-rules">
            {t('adminMod.header.rules')}
          </Link>
          <Button variant="ghost" onClick={() => setPanel('rules')} data-testid="mod-link-lists">
            {t('adminMod.header.lists')}
          </Button>
        </>
      }
    >
      <Queue canWrite={canWrite} />
      <Legend />
      <RulesSheet open={panel === 'rules'} onClose={() => setPanel(null)} canWrite={canWrite} />
    </AdminPage>
  );
}

function Kpis({ stats, t, locale }: { stats: ModerationStatsDto | undefined; t: TFunction; locale: string }) {
  if (!stats) {
    return (
      <OpsKpiStrip label={t('adminMod.kpi.label')}>
        {[0, 1, 2, 3, 4].map((i) => (
          // same height as a loaded tile (context line + numeral): the tabs and the queue do not move when stats arrive
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </OpsKpiStrip>
    );
  }
  const reasons = stats.rejectedByReason
    .slice(0, 3)
    .map((r) => `${t(`adminMod.kpi.reason.${r.decision}`)} ${formatNumber(r.count)}`)
    .join(' · ');
  return (
    <OpsKpiStrip label={t('adminMod.kpi.label')}>
      <OpsKpiTile data-kpi="pending" context={t('adminMod.kpi.pendingContext', { over: stats.overSla, urgent: stats.urgent })} value={formatNumber(stats.pending)} unit={t('adminMod.kpi.pending')} tone={stats.overSla ? 'danger' : undefined} />
      <OpsKpiTile data-kpi="auto" context={t('adminMod.kpi.autoContext')} value={formatNumber(stats.autoApproved7d)} unit={t('adminMod.kpi.auto')} />
      <OpsKpiTile data-kpi="rejected" context={reasons || undefined} value={formatNumber(stats.rejected7d)} unit={t('adminMod.kpi.rejected')} />
      <OpsKpiTile data-kpi="rate" value={`${locale === 'en' ? stats.rejectionRatePct : String(stats.rejectionRatePct).replace('.', ',')} %`} unit={t('adminMod.kpi.rate')} />
      <OpsKpiTile data-kpi="delay" context={t('adminMod.kpi.delayContext')} value={formatDelay(stats.medianDelayMinutes)} unit={t('adminMod.kpi.delay')} />
    </OpsKpiStrip>
  );
}

function Queue({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const list = useListState(MOD_SPEC);
  const appRouter = useAppRouter();
  const s = list.state;
  const tab = tabOf(s.tab);
  const stats = useModerationStats();
  const offline = useOffline();
  const refresh = useModerationRefresh();
  const query = useMemo(() => ({ ...list.apiQuery(), ...tabQuery(tab) }), [list, tab]);
  const items = useModerationItems(query, tab !== 'appeals' && tab !== 'sample');
  const sample = useModerationSample({ page: s.page, pageSize: s.pageSize }, tab === 'sample');
  const appeals = useAppeals({ ...tabQuery('appeals'), page: s.page, pageSize: s.pageSize }, tab === 'appeals');
  const source = tab === 'appeals' ? appeals : tab === 'sample' ? sample : items;
  const rows = useMemo(() => (tab === 'appeals' ? [] : ((source.data?.rows ?? []) as ModerationItemDto[])), [source.data, tab]);
  const appealRows = useMemo(() => (tab === 'appeals' ? (appeals.data?.rows ?? []) : []), [appeals.data, tab]);
  const total = source.data?.total ?? null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | 'reject' | 'assign'>(null);
  // the ✕ of a row rejects that item directly (reason + message dialog), « Ouvrir la revue » stays the full review
  const [rejectOne, setRejectOne] = useState<{ id: string; name: string } | null>(null);
  const [assignOne, setAssignOne] = useState<ModerationItemDto | null>(null);
  useEffect(() => setSelected(new Set()), [tab, s.page]);

  const activeId = s.sheet ?? (tab === 'appeals' ? appealRows[0]?.id : rows[0]?.id) ?? null;
  const activeRow = rows.find((r) => r.id === activeId);
  const activeAppeal = appealRows.find((a) => a.id === activeId);
  const open = (id: string) => list.openSheet(id);

  const approveOne = async (item: ModerationItemDto) => {
    try {
      await modApi.decide(item.id, 'approve', {});
      toast({ tone: 'success', message: t('adminMod.toast.approve', { name: itemTitle(t, item) }) });
      void refresh();
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
      void refresh();
    }
  };
  const bulkApprove = async () => {
    try {
      const res = await modApi.bulk('approve', { ids: [...selected] });
      const ko = res.filter((r) => !r.ok);
      toast({ tone: ko.length ? 'warning' : 'success', message: t('adminMod.bulk.result', { ok: res.length - ko.length, ko: ko.length }) });
      setSelected(new Set(ko.map((r) => r.id)));
      void refresh();
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const menu = (item: ModerationItemDto): MenuAction[] => {
    const assign = decisionState(item, 'assign', canWrite);
    const changes = decisionState(item, 'request-changes', canWrite);
    return [
      { key: 'open', label: t('adminMod.action.open'), onSelect: () => open(item.id), primary: true },
      ...(canWrite
        ? [
            { key: 'assign', label: t('adminMod.action.assign'), onSelect: assign.enabled ? () => setAssignOne(item) : undefined, disabledReason: assign.enabled ? undefined : reasonText(t, assign.reasonCode) },
            { key: 'changes', label: t('adminMod.action.requestChanges'), onSelect: changes.enabled ? () => open(item.id) : undefined, disabledReason: changes.enabled ? undefined : reasonText(t, changes.reasonCode) },
          ]
        : []),
      { key: 'workspace', label: t('adminMod.action.workspace'), onSelect: () => appRouter.push(`/admin/workspaces?sheet=${item.workspace.id}`), separated: true, hint: t('adminMod.hint.page') },
    ];
  };

  const flags = filterList(s, 'aiFlag');
  const trust = filterList(s, 'trustLevel');
  const bucket = scoreBucketOf(filterText(s, 'scoreMin'), filterText(s, 'scoreMax'));
  const waiting = typeof s.filters.waitingOver === 'number' ? s.filters.waitingOver : null;
  const categoryId = filterText(s, 'categoryId');
  const categories = useModerationCategories();
  const chips = [
    ...(flags.length ? [{ key: 'aiFlag', label: `${t('adminMod.filter.flag')} : ${flags.map((f) => t(`adminMod.flag.${f}`)).join(', ')}`, onRemove: () => list.setFilter('aiFlag', null) }] : []),
    ...(bucket ? [{ key: 'score', label: `${t('adminMod.filter.score')} : ${t(`adminMod.filter.score.${bucket}`)}`, onRemove: () => list.setFilters({ scoreMin: null, scoreMax: null }) }] : []),
    ...(trust.length ? [{ key: 'trustLevel', label: `${t('adminMod.filter.trust')} : ${trust.map((v) => trustLabel(t, v)).join(', ')}`, onRemove: () => list.setFilter('trustLevel', null) }] : []),
    ...(categoryId ? [{ key: 'categoryId', label: `${t('adminMod.filter.category')} : ${categories.data?.find((c) => c.id === categoryId)?.name ?? '…'}`, onRemove: () => list.setFilter('categoryId', null) }] : []),
    ...(waiting ? [{ key: 'waitingOver', label: `${t('adminMod.filter.waiting')} : ${t('adminMod.filter.waitingOver', { time: formatDelay(waiting) })}`, onRemove: () => list.setFilter('waitingOver', null) }] : []),
  ];
  const filtersDisabled = tab === 'appeals' || tab === 'sample';
  const selectable = canWrite && tab !== 'appeals' && tab !== 'rejected';
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const named = (ids: Iterable<string>) => [...ids].map((id) => ({ id, name: itemTitle(t, rows.find((r) => r.id === id) ?? ({ type: 'product', product: null, agent: null, category: null } as never)) }));
  const since = source.dataUpdatedAt ? new Date(source.dataUpdatedAt).toLocaleTimeString(locale === 'ar' ? 'ar-u-nu-latn' : locale) : '—';

  return (
    <>
      {offline ? <OfflineBanner since={since} onRetry={() => void source.refetch()} /> : null}
      <Kpis stats={stats.data} t={t} locale={locale} />
      <PillTabs
        label={t('adminMod.tab.label')}
        value={tab}
        onChange={(k) => list.set({ tab: k === 'todo' ? null : k, sheet: null })}
        tabs={(['todo', 'urgent', 'appeals', 'sample', 'rejected', 'prompts'] as ModTab[]).map((k) => ({ key: k, label: t(`adminMod.tab.${k}`), count: tabCount(k, stats.data) }))}
      />
      {filtersDisabled ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={s.q} onChange={(v) => list.set({ q: v })} label={t('action.search')} placeholder={t('adminMod.search')} clearLabel={t('list.clearSearch')} className="min-w-64 flex-1 sm:max-w-72" />
            <FilterDropdown label={t('adminMod.filter.flag')} count={flags.length}>
              <FilterChips label={t('adminMod.filter.flag')} multiple options={MODERATION_AI_FLAGS.map((f) => ({ value: f, label: t(`adminMod.flag.${f}`) }))} value={flags} onChange={(v) => list.setFilter('aiFlag', v)} />
            </FilterDropdown>
            <FilterDropdown label={t('adminMod.filter.score')} count={bucket ? 1 : 0}>
              <FilterChips
                label={t('adminMod.filter.score')}
                options={SCORE_BUCKETS.map((b) => ({ value: b.key, label: t(`adminMod.filter.score.${b.key}`) }))}
                value={bucket ? [bucket] : []}
                onChange={(v) => {
                  const b = SCORE_BUCKETS.find((x) => x.key === v[0]);
                  list.setFilters({ scoreMin: b?.min ?? null, scoreMax: b?.max ?? null });
                }}
              />
            </FilterDropdown>
            <FilterDropdown label={t('adminMod.filter.trust')} count={trust.length}>
              <FilterChips label={t('adminMod.filter.trust')} multiple options={TrustLevelValues.map((v) => ({ value: v, label: trustLabel(t, v) }))} value={trust} onChange={(v) => list.setFilter('trustLevel', v)} />
            </FilterDropdown>
            <FilterDropdown label={t('adminMod.filter.category')} count={categoryId ? 1 : 0}>
              <CategoryFilter value={categoryId} onChange={(v) => list.setFilter('categoryId', v || null)} t={t} />
            </FilterDropdown>
            <FilterDropdown label={t('adminMod.filter.waiting')} count={waiting ? 1 : 0}>
              <FilterChips
                label={t('adminMod.filter.waiting')}
                options={WAITING_PRESETS.map((m) => ({ value: String(m), label: t('adminMod.filter.waitingOver', { time: formatDelay(m) }) }))}
                value={waiting ? [String(waiting)] : []}
                onChange={(v) => list.setFilter('waitingOver', v[0] ? Number(v[0]) : null)}
              />
            </FilterDropdown>
            <span className="ms-auto ts-label-micro text-text-muted">{t('adminMod.sortNote')}</span>
          </div>
          <ActiveFilters items={chips} label={t('list.activeFilters')} clearLabel={t('action.clearAll')} onClear={chips.length > 1 ? list.clear : undefined} removeLabel={(label) => t('list.removeFilter', { label })} />
        </>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="min-w-0">
          {source.isPending ? (
            // reserves the queue's usual height so the legend under it does not jump up then down while loading
            <Card className="min-h-[70dvh]">
              <ListSkeleton rows={8} columns={4} label={t('common.loading')} />
            </Card>
          ) : source.isError && !source.data ? (
            <AdminQueryError error={source.error} onRetry={() => void source.refetch()} />
          ) : (tab === 'appeals' ? appealRows.length : rows.length) === 0 ? (
            list.filtered && !filtersDisabled && (s.q.trim() || chips.length) ? (
              <ListFilteredEmpty entity={t('adminMod.entity')} filters={[s.q.trim(), ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={() => list.set({ q: '', filters: { aiFlag: null, scoreMin: null, scoreMax: null, trustLevel: null, categoryId: null, waitingOver: null } })} />
            ) : (
              <ListEmpty title={t(`adminMod.empty.${tab}.title`)} description={t(`adminMod.empty.${tab}.description`)} />
            )
          ) : (
            <Card className={cn('overflow-hidden', source.isPlaceholderData && 'opacity-60')} data-testid="mod-list">
              {tab === 'appeals' ? (
                appealRows.map((a) => <AppealRow key={a.id} appeal={a} active={a.id === activeId} onOpen={() => open(a.id)} />)
              ) : (
                <>
                  {selectable ? (
                    <div className="flex flex-wrap items-center gap-2 border-b border-line-hairline px-3 py-2" role="region" aria-label={t('adminMod.bulk.label')}>
                      <Checkbox aria-label={t('adminMod.bulk.all')} checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
                      <span className="me-2 text-[14px] font-medium" aria-live="polite" data-testid="mod-selected">
                        {selected.size ? t('adminMod.bulk.selected', { count: selected.size }) : t('adminMod.bulk.count', { count: total ?? rows.length })}
                      </span>
                      {selected.size ? (
                        <>
                          <Button size="sm" onClick={() => void bulkApprove()} data-testid="mod-bulk-approve">
                            <Check className="size-3.5 text-accent-money" aria-hidden />
                            {t('adminMod.action.approve')}
                          </Button>
                          <Button size="sm" onClick={() => setBulk('reject')} data-testid="mod-bulk-reject-open">
                            <X className="size-3.5 text-accent-alert" aria-hidden />
                            {t('adminMod.bulk.reject')}
                          </Button>
                          <Button size="sm" onClick={() => setBulk('assign')}>
                            {t('adminMod.action.assign')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {rows.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      active={item.id === activeId}
                      selected={selected.has(item.id)}
                      onToggle={selectable ? () => toggle(item.id) : undefined}
                      onOpen={() => open(item.id)}
                      onApprove={() => void approveOne(item)}
                      onReject={() => setRejectOne(named([item.id])[0]!)}
                      menu={menu(item)}
                      canWrite={canWrite}
                    />
                  ))}
                </>
              )}
              <ListPagination page={s.page} pageSize={s.pageSize} total={total ?? rows.length} onChange={(p) => list.set(p)} />
            </Card>
          )}
        </div>
        {/* the review panel stays in view next to a long queue and scrolls on its own when taller than the screen,
            so its decision buttons are always reachable (M11 layout pass) */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-card">
          {tab === 'appeals' ? (
            activeAppeal ? <AppealPanel key={activeAppeal.id} appeal={activeAppeal} canWrite={canWrite} /> : null
          ) : activeId ? (
            <ReviewPanel id={activeId} fallback={activeRow} canWrite={canWrite} onDecided={() => list.openSheet(null)} />
          ) : null}
        </div>
      </div>

      <BulkRejectDialog open={bulk === 'reject'} onClose={() => setBulk(null)} items={named(selected)} onDone={(failed) => setSelected(new Set(failed))} />
      <BulkRejectDialog single open={!!rejectOne} onClose={() => setRejectOne(null)} items={rejectOne ? [rejectOne] : []} onDone={() => undefined} />
      <AssignDialog open={bulk === 'assign' || !!assignOne} onClose={() => (setBulk(null), setAssignOne(null))} items={assignOne ? [{ id: assignOne.id, name: itemTitle(t, assignOne) }] : named(selected)} onDone={() => setSelected(new Set())} />
    </>
  );
}

/** "Catégorie ⌄": the categories present in the pending queue (`GET /admin/moderation/categories`). */
function CategoryFilter({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: TFunction }) {
  const q = useModerationCategories();
  return (
    <div className="w-72">
      <FilterCheckList
        options={(q.data ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.workspaceName}`, count: c.pending }))}
        value={value ? [value] : []}
        onChange={(v) => onChange(v.find((x) => x !== value) ?? '')}
        searchPlaceholder={t('adminMod.filter.categorySearch')}
        emptyLabel={q.isPending ? t('common.loading') : t('adminMod.filter.categoryEmpty')}
      />
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <section aria-label={t('adminMod.legend.label')} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {(['auto', 'human', 'waiting', 'sla', 'appeal'] as const).map((k) => (
        <LegendNote key={k} title={t(`adminMod.legend.${k}.title`)}>
          {t(`adminMod.legend.${k}.text`)}
        </LegendNote>
      ))}
    </section>
  );
}
