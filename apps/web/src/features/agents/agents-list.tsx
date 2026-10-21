'use client';
// /agents — Figma "AGT-01 — Agents — list (active, paused, insights)", "MECH — Agents filters + row menu".
// Cards (one per agent) with their state, direct actions (Tester · Modifier · Actif) and `Actions ⌄`; filters, search
// and sort in the URL; multi-select with per-item results; plan line (drafts never count toward `maxAgents`);
// pending insights of the workspace on the end side.
import { ActionsMenu, ActiveFilters, BulkBar, Button, buttonClass, Card, Checkbox, cn, ConfirmDialog, EmptyState, FilterChips, FilterDropdown, InsightCard, Ltr, MonoChip, Pill, SearchInput, Select, Skeleton, Switch, toast, type ActiveFilter } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { Bot } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { insightDetail } from './insight-detail';
import { ListFilteredEmpty, QueryError } from '@/components/global-states';
import { useProduct } from '@/features/catalog/api';
import { useChannels } from '@/features/channels/api';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { filterList, filterText, type ListSpec } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useListState } from '@/lib/use-list-state';
import { agentsApi, useAgents, useAgentsRefresh, useInsights, usePresets } from './api';
import type { Agent, AgentInsight } from './contracts';
import { LANGUAGES } from './contracts';
import { isAlreadyResolved, ignoreInsight, ResolveInsightDialog } from './insights/resolve-dialog';
import { cardState, limitReached, stepSlug } from './logic';
import { AgentStatusPill, ChannelChips, InsightTypePill, ModelBadge } from './ui';
import { useAgentActions, type AgentActions } from './use-agent-actions';

/** `GET /agents` parameters (06 §10 "Agents", api-contract §4 `AgentsQuery`). */
export const AGENTS_SPEC: ListSpec = {
  // `productId` (M11): "Agents qui le vendent" of the product page — no dropdown, an active chip only
  filters: { status: 'list', channelId: 'list', capabilities: 'list', presetKey: 'list', activeDays: 'text', defaultLanguage: 'text', hasPendingInsights: 'bool', productId: 'text' },
  sorts: ['lastActiveAt', 'name'],
  defaultSort: '-lastActiveAt',
};
const STATUSES = ['active', 'paused', 'draft'] as const;
const CAPABILITIES = ['voice', 'image', 'orders'] as const;
type Bulk = 'pause' | 'resume' | 'delete';

export function AgentsList() {
  const t = useT();
  const locale = useLocaleCode();
  const { can, workspace } = useSession();
  const manage = can('agents.manage');
  const list = useListState(AGENTS_SPEC);
  const s = list.state;
  const q = useAgents(list.apiQuery());
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  // `meta.planLimit` when the list sends it; otherwise the plan of the workspace (`maxAgents` counts active + paused agents)
  const plan = workspace?.plan ?? null;
  const planLimit = q.data?.planLimit ?? (plan && q.data ? { limit: plan.limits.maxAgents, current: Math.max(plan.usage.agents, q.data.rows.filter((a) => a.status !== 'draft').length) } : null);
  const actions = useAgentActions({ planLimit });
  const refresh = useAgentsRefresh();
  const channels = useChannels(can('channels.read'));
  const presets = usePresets(can('agents.read'));
  const atLimit = limitReached(planLimit);

  const statuses = filterList(s, 'status');
  const channelIds = filterList(s, 'channelId');
  const caps = filterList(s, 'capabilities');
  const presetKeys = filterList(s, 'presetKey');
  const activeDays = filterText(s, 'activeDays');
  const language = filterText(s, 'defaultLanguage');
  const productId = filterText(s, 'productId');
  const product = useProduct(productId || null);

  const statusOptions = STATUSES.map((v) => ({ value: v, label: t(`agents.filter.status.${v}`) }));
  const channelOptions = (channels.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name }));
  const capOptions = CAPABILITIES.map((v) => ({ value: v, label: t(`agents.filter.capability.${v}`) }));
  const presetOptions = (presets.data ?? []).map((p) => ({ value: p.key, label: p.name || p.key }));
  const activityOptions = [
    { value: '7', label: t('agents.filter.activity.7') },
    { value: '30', label: t('agents.filter.activity.30') },
  ];
  const languageOptions = LANGUAGES.map((v) => ({ value: v, label: t(`agents.language.${v}`) }));
  const labels = (values: string[], options: { value: string; label: string }[]) => values.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ');

  const chips: ActiveFilter[] = [];
  const chip = (key: string, group: string, value: string) => chips.push({ key, label: `${group} : ${value}`, onRemove: () => list.setFilter(key, null) });
  if (statuses.length) chip('status', t('agents.filter.status'), labels(statuses, statusOptions));
  if (channelIds.length) chip('channelId', t('agents.filter.channel'), labels(channelIds, channelOptions));
  if (caps.length) chip('capabilities', t('agents.filter.capabilities'), labels(caps, capOptions));
  if (presetKeys.length) chip('presetKey', t('agents.filter.preset'), labels(presetKeys, presetOptions));
  if (activeDays) chip('activeDays', t('agents.filter.activity'), labels([activeDays], activityOptions));
  if (language) chip('defaultLanguage', t('agents.filter.language'), labels([language], languageOptions));
  if (productId) chip('productId', t('carry.agents.filter.product'), product.data?.name ?? (product.isError ? '—' : '…'));

  /* ---------- selection ---------- */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const picked = useMemo(() => rows.filter((a) => selected.has(a.id)), [rows, selected]);
  const toggle = (id: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runBulk = async () => {
    if (!bulk || !picked.length) return;
    setBulkPending(true);
    try {
      const r = await agentsApi.bulk(bulk, picked.map((a) => a.id));
      const failed = r.results.filter((x) => !x.ok);
      const ok = r.results.length - failed.length;
      await refresh();
      if (failed.length) {
        const first = failed[0]!;
        const name = rows.find((a) => a.id === first.id)?.name ?? '—';
        toast({ tone: ok ? 'warning' : 'danger', message: t('agents.bulk.partial', { ok, failed: failed.length, name, reason: first.error?.message ?? first.error?.code ?? '—' }), durationMs: 9_000 });
      } else toast(t(`agents.bulk.done.${bulk}`, { count: ok }));
      // refused rows stay selected so the merchant sees which ones
      setSelected(new Set(failed.map((x) => x.id)));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBulkPending(false);
      setBulk(null);
    }
  };

  const newAgent = manage ? (
    atLimit ? (
      <Button variant="primary" onClick={() => actions.limit(null)} data-testid="new-agent">
        {t('action.newAgent')}
      </Button>
    ) : (
      <Link href="/agents/new" className={buttonClass({ variant: 'primary' })} data-testid="new-agent">
        {t('action.newAgent')}
      </Link>
    )
  ) : null;

  const planName = workspace?.plan?.name ?? '';
  const ratio = planLimit && planLimit.limit >= 0 ? t('agents.summary.ratio', { current: planLimit.current, limit: planLimit.limit, plan: planName }) : null;

  return (
    <AppPage
      wide
      permission="agents.read"
      eyebrow={t('nav.group.ai')}
      title={t('nav.agents')}
      description={
        <span data-testid="agents-summary">
          {t('agents.subtitle')}
          {ratio ? (
            <>
              {' · '}
              <Ltr>{ratio}</Ltr>
            </>
          ) : null}
        </span>
      }
      actions={
        manage ? (
          <>
            <Link href="/agents/generate" className={buttonClass()} data-testid="generate-agent">
              {t('agents.generate.cta')}
            </Link>
            {newAgent}
          </>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="agents-filters">
        <SearchInput value={s.q} onChange={(v) => list.set({ q: v, page: 1 })} placeholder={t('agents.search.placeholder')} label={t('action.search')} clearLabel={t('action.clearAll')} className="min-w-56 max-w-sm" />
        <FilterDropdown label={t('agents.filter.status')} count={statuses.length}>
          <FilterChips multiple label={t('agents.filter.status')} options={statusOptions} value={statuses} onChange={(v) => list.setFilter('status', v)} />
        </FilterDropdown>
        {/* shown while the options load too: the bar keeps its final width and the list under it does not jump */}
        {channelOptions.length || channels.isLoading ? (
          <FilterDropdown label={t('agents.filter.channel')} count={channelIds.length}>
            <FilterChips multiple label={t('agents.filter.channel')} options={channelOptions} value={channelIds} onChange={(v) => list.setFilter('channelId', v)} />
          </FilterDropdown>
        ) : null}
        <FilterDropdown label={t('agents.filter.capabilities')} count={caps.length}>
          <FilterChips multiple label={t('agents.filter.capabilities')} options={capOptions} value={caps} onChange={(v) => list.setFilter('capabilities', v)} />
        </FilterDropdown>
        {presetOptions.length || presets.isLoading ? (
          <FilterDropdown label={t('agents.filter.preset')} count={presetKeys.length}>
            <FilterChips multiple label={t('agents.filter.preset')} options={presetOptions} value={presetKeys} onChange={(v) => list.setFilter('presetKey', v)} />
          </FilterDropdown>
        ) : null}
        <FilterDropdown label={t('agents.filter.activity')} count={activeDays ? 1 : 0}>
          <FilterChips label={t('agents.filter.activity')} allLabel={t('common.allM')} options={activityOptions} value={activeDays ? [activeDays] : []} onChange={(v) => list.setFilter('activeDays', v[0] ?? null)} />
        </FilterDropdown>
        <FilterDropdown label={t('agents.filter.language')} count={language ? 1 : 0}>
          <FilterChips label={t('agents.filter.language')} allLabel={t('agents.filter.language.auto')} options={languageOptions} value={language ? [language] : []} onChange={(v) => list.setFilter('defaultLanguage', v[0] ?? null)} />
        </FilterDropdown>
        <span className="flex-1" />
        <Select aria-label={t('agents.sort.label')} className="!h-10 !w-auto" value={s.sort} onChange={(e) => list.set({ sort: e.target.value })}>
          <option value="-lastActiveAt">{t('agents.sort.lastActive')}</option>
          <option value="name">{t('agents.sort.name')}</option>
        </Select>
        {manage && rows.length > 1 ? (
          <Button
            variant={selecting ? 'secondary' : 'ghost'}
            aria-pressed={selecting}
            className="max-md:hidden"
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
            data-testid="agents-select-toggle"
          >
            {t('agents.select')}
          </Button>
        ) : null}
      </div>
      {chips.length ? <ActiveFilters items={chips} label={t('action.filters')} clearLabel={t('action.clearAll')} onClear={list.clear} removeLabel={(l) => t('agents.filter.remove', { label: l })} /> : null}

      {selecting && picked.length ? (
        <BulkBar
          label={t('agents.bulk.label')}
          summary={t('agents.bulk.summary', { count: picked.length })}
          note={t('agents.bulk.note')}
          deselectLabel={t('action.deselect')}
          onDeselect={() => setSelected(new Set())}
          actions={[
            { key: 'pause', label: t('action.pause'), onSelect: () => setBulk('pause') },
            { key: 'resume', label: t('action.resume'), onSelect: () => setBulk('resume') },
            { key: 'delete', label: t('action.delete'), onSelect: () => setBulk('delete'), destructive: true },
          ]}
        />
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-w-0 flex-col gap-4" aria-label={t('agents.list.title')}>
          <div className="flex items-baseline justify-between px-1">
            <h2 className="ts-label-section text-text-muted">{t('agents.list.title')}</h2>
            <span className="ts-label-meta tabular-nums" data-testid="agents-count">
              {q.data ? formatNumber(rows.length) : ''}
            </span>
          </div>
          {q.isPending ? (
            <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Card key={i} className="flex flex-col gap-4 p-4">
                  <Skeleton className="h-10 w-1/2" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-12" />
                </Card>
              ))}
            </div>
          ) : q.isError ? (
            <QueryError error={q.error} onRetry={() => q.refetch()} />
          ) : rows.length === 0 && list.filtered ? (
            <ListFilteredEmpty entity={t('agents.entity')} filters={[s.q, ...chips.map((c) => c.label)].filter(Boolean).join(' · ')} onClear={list.clear} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Bot className="size-5" />}
              title={t('agents.empty.title')}
              description={t('agents.empty.description')}
              action={manage ? { label: t('action.newAgent'), href: `/${locale}/agents/new` } : undefined}
              secondaryAction={manage ? { label: t('agents.generate.cta'), href: `/${locale}/agents/generate` } : undefined}
            />
          ) : (
            rows.map((a) => <AgentCard key={a.id} agent={a} actions={actions} selecting={selecting} selected={selected.has(a.id)} onToggle={() => toggle(a.id)} />)
          )}
          {planLimit && planLimit.limit >= 0 && rows.length ? (
            <Card data-testid="agents-plan-line" data-at-limit={atLimit || undefined} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-text-secondary">
              <span>{atLimit ? t('agents.plan.atLimit', { current: planLimit.current, limit: planLimit.limit, plan: planName }) : t('agents.plan.remaining', { count: planLimit.limit - planLimit.current, plan: planName })}</span>
              {can('billing.read') ? (
                <Link href="/settings/billing" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                  {t('agents.plan.see')}
                </Link>
              ) : null}
            </Card>
          ) : null}
        </section>
        <PendingInsights />
      </div>

      {actions.dialogs}
      <ConfirmDialog
        open={bulk !== null}
        onOpenChange={(o) => !o && !bulkPending && setBulk(null)}
        title={bulk ? t(`agents.bulk.confirm.${bulk}`, { count: picked.length }) : ''}
        description={t('agents.bulk.note')}
        confirmLabel={bulk === 'delete' ? t('action.delete') : bulk === 'pause' ? t('action.pause') : t('action.resume')}
        cancelLabel={t('action.cancel')}
        onConfirm={runBulk}
        destructive={bulk === 'delete'}
        loading={bulkPending}
        closeLabel={t('action.close')}
      />
    </AppPage>
  );
}

function AgentCard({ agent: a, actions, selecting, selected, onToggle }: { agent: Agent; actions: AgentActions; selecting: boolean; selected: boolean; onToggle: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const state = cardState(a);
  const draft = a.status === 'draft';
  const noChannel = !draft && a.channels.length === 0;
  const live = a.status === 'active' && a.channels.some((c) => c.status === 'active');
  const tile = 'min-w-0 rounded-card bg-ink-base px-3 py-2';
  return (
    <div data-testid="agent-card" data-agent={a.id} data-state={state} className="flex min-w-0 flex-col gap-1.5">
      <Card className={cn('flex min-w-0 flex-col gap-4 p-4', selected && 'border-line-lit')}>
        <div className="flex flex-wrap items-start gap-3">
          {selecting ? <Checkbox aria-label={t('agents.select.one', { name: a.name })} checked={selected} onChange={onToggle} className="mt-3" /> : null}
          <span className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line-edge bg-ink-raised text-signal-live">
            <Bot className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Link href={draft ? actions.editHref(a) : `/agents/${a.id}`} className="block truncate ts-display-s hover:underline">
              {a.name}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <AgentStatusPill agent={a} />
              <MonoChip>{t(`agents.personality.${a.personality}`)}</MonoChip>
              {draft ? null : (
                <span className={cn('inline-flex items-center gap-1.5 ts-label-meta uppercase', live ? 'text-signal-live' : 'text-text-muted')}>
                  <span aria-hidden className={cn('size-1.5 rounded-full', live ? 'bg-signal-live' : 'bg-text-muted')} />
                  {t(live ? 'agents.card.live' : 'agents.card.silent')}
                </span>
              )}
              {a.preset?.updateAvailable ? <MonoChip tone="warning">{t('enum.Agent.presetUpdateAvailable')}</MonoChip> : null}
              {a.pendingInsights > 0 ? (
                <Link href={`/agents/${a.id}/insights`} data-testid="agent-insights-badge">
                  <MonoChip tone="warning">{t('agents.card.insights', { count: a.pendingInsights })}</MonoChip>
                </Link>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draft ? (
              actions.manage ? (
                <Link href={actions.editHref(a)} className={buttonClass({ size: 'sm', variant: 'primary' })} data-testid="agent-resume-draft">
                  {t('agents.action.resumeDraft')}
                </Link>
              ) : null
            ) : (
              <>
                {actions.manage && a.pausedReason !== 'plan' ? (
                  <span className="flex items-center gap-2 ts-label-meta text-text-muted">
                    {t('agents.card.active')}
                    <Switch checked={a.status === 'active'} label={t('agents.card.activeToggle', { name: a.name })} disabled={actions.busy === `resume:${a.id}`} onCheckedChange={(on) => (on ? void actions.resume(a) : actions.pause(a))} />
                  </span>
                ) : null}
                {actions.canTest ? (
                  <Link href={`/agents/${a.id}/playground`} className={buttonClass({ size: 'sm' })}>
                    {t('action.test')}
                  </Link>
                ) : null}
              </>
            )}
            <ActionsMenu label={t('action.actions')} actions={actions.menu(a)} heading={actions.heading(a)} />
          </div>
        </div>
        {a.description ? <p className="text-[13px] text-text-secondary">{a.description}</p> : null}
        <div className="grid grid-cols-3 gap-2">
          <div className={tile}>
            <div className="ts-numeral-m">
              <Ltr>{formatNumber(a.channels.length)}</Ltr>
            </div>
            <div className="ts-label-micro mt-1 text-text-muted">{t('agents.card.pages')}</div>
          </div>
          <div className={tile}>
            <div className="ts-numeral-m truncate">{a.wizard?.catalogScope === 'categories' || !a.sellAllProducts ? <Ltr>{formatNumber(a.productCount)}</Ltr> : t('agents.card.allProducts')}</div>
            <div className="ts-label-micro mt-1 text-text-muted">{t('agents.card.products')}</div>
          </div>
          <div className={tile}>
            <div className="truncate">
              <ModelBadge label={a.model?.label ?? ''} />
            </div>
            <div className="ts-label-micro mt-1 text-text-muted">{t('agents.card.model')}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ChannelChips channels={a.channels} />
          <span className="ts-label-meta text-text-muted">
            {draft ? t('agents.card.draftStep', { step: Math.min(5, (a.wizardStep ?? 0) + 1), label: t(`agents.wizard.step.${stepSlug((a.wizardStep ?? 0) + 1)}`) }) : a.lastActiveAt ? t('agents.card.lastActive', { ago: relativeTime(a.lastActiveAt, locale) }) : t('agents.card.neverActive')}
          </span>
        </div>
      </Card>
      {noChannel ? (
        <div role="status" data-testid="agent-no-channel" className="flex flex-wrap items-center gap-3 rounded-card border border-line-edge bg-ink-surface px-3.5 py-2.5 text-[13px]">
          <Pill tone="warning" className="!rounded-[4px]">
            {t('agents.card.noChannel.label')}
          </Pill>
          <span className="min-w-0 flex-1 text-text-secondary">
            {t('error.AGENT_NO_CHANNEL')} <Ltr>(AGENT_NO_CHANNEL)</Ltr>
          </span>
          {actions.manage ? (
            <Link href={`/agents/${a.id}/configuration?section=channels`} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
              {t('agents.card.noChannel.link')}
            </Link>
          ) : null}
        </div>
      ) : state === 'paused_plan' ? (
        <div role="status" data-testid="agent-paused-plan" className="flex flex-wrap items-center gap-3 rounded-card border border-line-edge bg-ink-surface px-3.5 py-2.5 text-[13px]">
          <Pill tone="warning" className="!rounded-[4px]">
            {t('enum.Agent.pausedReason.plan')}
          </Pill>
          <span className="min-w-0 flex-1 text-text-secondary">{t('agents.card.pausedPlan')}</span>
        </div>
      ) : null}
    </div>
  );
}

/** "PROBLÈMES EN ATTENTE": the pending insights of every agent (the same rows as the queue), newest first. */
function PendingInsights() {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const allowed = can('insights.manage');
  const q = useInsights({ status: 'pending', pageSize: 5 }, allowed);
  const refresh = useAgentsRefresh();
  const [resolving, setResolving] = useState<AgentInsight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed) return null;
  const rows = q.data?.rows ?? [];
  const done = async () => {
    setResolving(null);
    await Promise.all([q.refetch(), refresh()]);
  };
  const ignore = async (i: AgentInsight) => {
    setBusy(i.id);
    try {
      await ignoreInsight(i);
      toast(t('agents.insights.toast.ignored'));
    } catch (e) {
      toast({ tone: isAlreadyResolved(e) ? 'info' : 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
      void done();
    }
  };
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={t('agents.pending.title')} data-testid="agents-pending-insights">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="ts-label-section text-text-muted">{t('agents.pending.title')}</h2>
        <span className="ts-label-meta tabular-nums">{q.data ? formatNumber(q.data.total) : ''}</span>
      </div>
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="px-4 py-8 text-center text-[13px] text-text-muted">{t('agents.pending.empty')}</Card>
      ) : (
        rows.map((i) => (
          <InsightCard
            key={i.id}
            data-insight={i.id}
            pill={<InsightTypePill type={i.type} />}
            who={`${i.agent?.name ?? ''}${i.channel ? ` · ${i.channel.name}` : ''}`}
            age={relativeTime(i.createdAt, locale)}
            quote={`« ${i.customerMessage} »`}
            detail={insightDetail(t, i.detail)}
            actions={
              <>
                <Link href={`/inbox/${i.conversationId}`} className={buttonClass({ size: 'sm' })}>
                  {t('agents.insights.openConversation')}
                </Link>
                <Button size="sm" variant="ghost" onClick={() => setResolving(i)}>
                  {t('agents.insights.addInstruction')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void ignore(i)} loading={busy === i.id}>
                  {t('action.dismiss')}
                </Button>
              </>
            }
          />
        ))
      )}
      <ResolveInsightDialog insight={resolving} onClose={() => setResolving(null)} onDone={() => void done()} />
    </section>
  );
}
