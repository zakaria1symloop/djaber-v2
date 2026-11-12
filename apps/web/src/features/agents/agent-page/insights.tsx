'use client';
// /agents/[id]/insights — Figma "AGT-08 — Agent page — Insights queue tab": what the agent could not do. Tabs
// En attente / Résolus / Ignorés, filters type · canal · période and "Regrouper par sujet" in the URL, grouped cards
// (n ×, client / IA / cause), actions Voir la conversation · Résoudre (dialog) · Ignorer. A row already handled by a
// colleague (`INSIGHT_ALREADY_RESOLVED`) shows a toast and leaves the list.
import { Button, buttonClass, Card, ConfirmDialog, EmptyState, FilterChips, FilterDropdown, FilterToggle, InsightRow, Ltr, SegmentedControl, Skeleton, toast } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { PartyPopper } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ListFilteredEmpty, QueryError } from '@/components/global-states';
import { insightDetail } from '../insight-detail';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import type { ApiQuery } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { agentsApi, insightStatusQuery, useAgentsRefresh, useInsights } from '../api';
import type { AgentInsight, InsightStatus, InsightType } from '../contracts';
import { ignoreInsight, isAlreadyResolved, ResolveInsightDialog } from '../insights/resolve-dialog';
import { InsightTypePill } from '../ui';
import { useAgentPage } from './agent-shell';
import { lastDays } from './overview';

const STATUSES: InsightStatus[] = ['pending', 'resolved', 'dismissed'];
const TYPES: InsightType[] = ['unknown_topic', 'unclear', 'handoff', 'error'];
const PERIODS = ['7', '30', '90'] as const;

export function AgentInsights() {
  const t = useT();
  const locale = useLocaleCode();
  const { agent } = useAgentPage();
  const { can } = useSession();
  const allowed = can('insights.manage');
  const refresh = useAgentsRefresh();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const write = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const status: InsightStatus = (STATUSES as string[]).includes(params.get('status') ?? '') ? (params.get('status') as InsightStatus) : 'pending';
  const types = (params.get('type') ?? '').split(',').filter((v): v is InsightType => (TYPES as string[]).includes(v));
  const channelId = agent.channels.some((c) => c.id === params.get('channelId')) ? params.get('channelId')! : '';
  const period = (PERIODS as readonly string[]).includes(params.get('period') ?? '') ? params.get('period')! : '';
  // grouped by default (frame "Regrouper par sujet ✓"); `?group=0` lists every occurrence
  const grouped = params.get('group') !== '0';
  const filtered = types.length > 0 || !!channelId || !!period;

  const extra: ApiQuery = { groupByTopic: grouped };
  if (types.length) extra.type = types;
  if (channelId) extra.channelId = channelId;
  if (period) Object.assign(extra, lastDays(Number(period)));
  const q = useInsights(insightStatusQuery(agent.id, status, extra), allowed);
  const rows = q.data?.rows ?? [];
  const counts = q.data?.counts ?? null;
  const count = (s: InsightStatus): number | null => counts?.[s] ?? (s === status && q.data ? q.data.total : s === 'pending' ? agent.pendingInsights : null);

  const [resolving, setResolving] = useState<AgentInsight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissAll, setDismissAll] = useState(false);
  const after = async () => {
    setResolving(null);
    await Promise.all([q.refetch(), refresh(agent.id)]);
  };
  const ignore = async (i: AgentInsight) => {
    setBusy(i.id);
    try {
      await ignoreInsight(i);
      toast(t('agents.insights.toast.ignored'));
    } catch (e) {
      toast({ tone: isAlreadyResolved(e) ? 'info' : 'danger', message: isAlreadyResolved(e) ? t('error.INSIGHT_ALREADY_RESOLVED') : errorMessage(e, t) });
    } finally {
      setBusy(null);
      void after();
    }
  };
  const ignoreAll = async () => {
    setBusy('all');
    try {
      const r = await agentsApi.dismissInsights(rows.map((i) => i.id));
      const failed = r.results.filter((x) => !x.ok).length;
      toast(failed ? { tone: 'warning', message: t('agents.insights.toast.ignoredPartial', { ok: r.results.length - failed, failed }) } : t('agents.insights.toast.ignoredAll', { count: r.results.length }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
      setDismissAll(false);
      void after();
    }
  };

  if (!allowed) return <QueryError error={null} />;
  const typeOptions = TYPES.map((v) => ({ value: v, label: t(`agents.insights.type.${v}`) }));
  const channelOptions = agent.channels.map((c) => ({ value: c.id, label: c.name }));
  const periodOptions = PERIODS.map((v) => ({ value: v, label: t('agents.overview.days', { count: Number(v) }) }));

  return (
    <div className="flex flex-col gap-4" data-testid="agent-insights" data-status={status}>
      <p className="text-[13px] text-text-secondary">{t('agents.insights.description')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={t('agents.insights.status')}
          value={status}
          onChange={(v) => write({ status: v === 'pending' ? null : v })}
          options={STATUSES.map((s) => ({ value: s, label: `${t(`agents.insights.tab.${s}`)}${count(s) === null ? '' : ` ${formatNumber(count(s)!)}`}` }))}
        />
        <span aria-hidden className="text-text-muted">
          ·
        </span>
        <FilterDropdown label={types.length ? t('agents.insights.filter.type') : t('agents.insights.filter.typeAll')} count={types.length}>
          <FilterChips multiple label={t('agents.insights.filter.type')} options={typeOptions} value={types} onChange={(v) => write({ type: v.join(',') })} />
        </FilterDropdown>
        {channelOptions.length > 1 ? (
          <FilterDropdown label={t('agents.filter.channel')} count={channelId ? 1 : 0}>
            <FilterChips label={t('agents.filter.channel')} allLabel={t('common.allM')} options={channelOptions} value={channelId ? [channelId] : []} onChange={(v) => write({ channelId: v[0] ?? null })} />
          </FilterDropdown>
        ) : null}
        <FilterDropdown label={period ? t('common.period', { label: t('agents.overview.days', { count: Number(period) }) }) : t('agents.insights.filter.period')} count={period ? 1 : 0}>
          <FilterChips label={t('agents.insights.filter.period')} allLabel={t('common.all')} options={periodOptions} value={period ? [period] : []} onChange={(v) => write({ period: v[0] ?? null })} />
        </FilterDropdown>
        <FilterToggle pressed={grouped} onPressedChange={(on) => write({ group: on ? null : '0' })}>
          <span data-testid="insights-group">{t('agents.insights.group')}</span>
        </FilterToggle>
        <span className="flex-1" />
        {status === 'pending' && rows.length > 1 ? (
          <Button variant="ghost" onClick={() => setDismissAll(true)} data-testid="insights-dismiss-all">
            {t('agents.insights.dismissAll', { count: rows.length })}
          </Button>
        ) : null}
      </div>

      {q.isPending ? (
        <Card role="status" aria-label={t('common.loading')} className="flex flex-col gap-3 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </Card>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 && filtered ? (
        <ListFilteredEmpty entity={t('agents.insights.entity')} filters={[...types.map((x) => t(`agents.insights.type.${x}`)), channelId ? (channelOptions.find((c) => c.value === channelId)?.label ?? '') : '', period ? t('agents.overview.days', { count: Number(period) }) : ''].filter(Boolean).join(' · ')} onClear={() => write({ type: null, channelId: null, period: null })} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="size-5" />}
          title={status === 'pending' ? t('agents.insights.empty.pending') : t(`agents.insights.empty.${status}`)}
          description={status === 'pending' ? t('agents.insights.empty.pending.description') : undefined}
          action={status === 'pending' ? { label: t('agents.insights.tab.resolved'), onClick: () => write({ status: 'resolved' }), variant: 'secondary' } : undefined}
        />
      ) : (
        <Card className="divide-y divide-line-hairline" data-testid="insights-list">
          {rows.map((i) => (
            <InsightRow
              key={i.id}
              data-insight={i.id}
              data-type={i.type}
              pill={<InsightTypePill type={i.type} />}
              count={grouped && i.occurrences > 1 ? <Ltr>{t('agents.insights.occurrences', { count: i.occurrences })}</Ltr> : relativeTime(i.createdAt, locale)}
              customer={t('agents.insights.customer', { message: i.customerMessage })}
              ai={i.aiResponse ? t('agents.insights.ai', { message: i.aiResponse }) : t('agents.insights.aiNone')}
              cause={insightDetail(t, i.detail) ? t('agents.insights.cause', { detail: insightDetail(t, i.detail)! }) : undefined}
              actions={
                <>
                  <Link href={`/inbox/${i.conversationId}`} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
                    {t('agents.insights.seeConversation')}
                  </Link>
                  {status === 'pending' ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => setResolving(i)} data-testid="insight-resolve">
                        {t('action.resolve')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void ignore(i)} loading={busy === i.id} data-testid="insight-ignore">
                        {t('action.dismiss')}
                      </Button>
                    </>
                  ) : i.resolution ? (
                    <span className="ts-label-meta text-text-muted">{t(`agents.insights.resolution.${i.resolution}`)}</span>
                  ) : null}
                </>
              }
            />
          ))}
        </Card>
      )}
      <p className="ts-label-meta text-text-muted">{t('agents.insights.queueNote')}</p>

      <ResolveInsightDialog insight={resolving} onClose={() => setResolving(null)} onDone={(_i, o) => (o.already ? void after() : (toast(t(`agents.insights.toast.${o.action}`)), void after()))} />
      <ConfirmDialog open={dismissAll} onOpenChange={(o) => !o && busy !== 'all' && setDismissAll(false)} title={t('agents.insights.dismissAll.title', { count: rows.length })} description={t('agents.insights.resolve.ignored_30d.hint')} confirmLabel={t('action.dismiss')} cancelLabel={t('action.cancel')} onConfirm={ignoreAll} loading={busy === 'all'} closeLabel={t('action.close')} />
    </div>
  );
}
