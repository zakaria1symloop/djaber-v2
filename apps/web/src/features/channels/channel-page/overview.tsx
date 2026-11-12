'use client';
// /channels/[id] — Figma "CHN-07 — Channel page — overview": Djaber counters, Meta insights (or the
// `INBOX_INSIGHTS_UNAVAILABLE` state: the counters stay visible — AT-CHN-09), connection health, linked agent,
// recent activity, linked Instagram accounts, danger zone.
import { Button, buttonClass, Card, Ltr, SectionLabel, Skeleton, StatTile, StatusPill } from '@djaber/ui';
import { formatDateTime, formatNumber, type AppLocale } from '@djaber/shared';
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession, useWorkspaceId } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { isInsightsUnavailable, useChannelEventsList, useChannelInsights, useChannelSummary } from '../api';
import { permissionList } from '../logic';
import { ChannelStatusPill, PlatformMark } from '../ui';
import { useChannelPage } from './channel-shell';

const RECENT = { limit: 4 };

/**
 * "COMMANDES IA (30 J)" (carry-over M3 → M5): AI orders of this page over 30 days, from `GET /orders/stats` with the
 * list filters (the same figure as the orders list opened by the tile). Hidden for a role without `orders.read`.
 */
function AiOrdersTile({ channelId }: { channelId: string }) {
  const t = useT();
  const ws = useWorkspaceId();
  const { can } = useSession();
  const query = { channelId, source: 'ai', period: '30d' };
  const q = useQuery({ queryKey: [ws, 'orders', 'stats', query], queryFn: () => api<{ total: number }>('/orders/stats', { query }), enabled: !!ws && can('orders.read'), staleTime: 60_000 });
  if (!can('orders.read')) return null;
  return (
    <Link href={`/orders?channelId=${channelId}&source=ai&period=30d`} className="block rounded-card" data-testid="channel-ai-orders">
      <StatTile label={t('channels.overview.aiOrders')} value={q.data ? <Ltr>{formatNumber(q.data.total)}</Ltr> : q.isError ? '—' : <Skeleton className="h-6 w-10" />} hint={t('channels.overview.aiOrdersHint')} />
    </Link>
  );
}
/** tiles drawn even when Meta returns nothing (the frame shows three) */
const DEFAULT_METRICS = ['page_fans', 'page_impressions', 'page_post_engagements'];

export function ChannelOverview() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { channel: c, actions } = useChannelPage();
  const summary = useChannelSummary(c.id);
  const insights = useChannelInsights(c.id);
  const recent = useChannelEventsList(c.id, RECENT);
  const counts = summary.data?.counts ?? c.counts;
  const health = summary.data?.health ?? c.health;
  const agent = summary.data?.agent ?? (c.agent ? { ...c.agent, productsInScope: c.counts.productsInScope } : null);
  const unavailable = insights.isError;
  const metrics = insights.data?.metrics?.length ? insights.data.metrics : DEFAULT_METRICS.map((key) => ({ key, value: null }));
  const metricLabel = (key: string) => (t.has(`channels.insights.metric.${key}`) ? t(`channels.insights.metric.${key}`) : key.replace(/_/g, ' ').toUpperCase());
  const disconnect = actionState(c.actions, 'disconnect', t);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="channel-counts">
        <StatTile label={t('channels.overview.conversations')} value={<Ltr>{formatNumber(counts.conversations)}</Ltr>} hint={t('channels.overview.conversationsHint', { active: counts.active, needsHuman: counts.needsHuman })} />
        <StatTile label={t('channels.overview.messages7d')} value={<Ltr>{formatNumber(counts.messages7d)}</Ltr>} hint={t('channels.overview.messagesHint', { inbound: counts.inbound7d, outbound: Math.max(0, counts.messages7d - counts.inbound7d) })} />
        <StatTile label={t('channels.overview.unread')} value={<Ltr>{formatNumber(counts.unread)}</Ltr>} />
        <StatTile label={t('channels.overview.products')} value={<Ltr>{formatNumber(counts.productsInScope)}</Ltr>} hint={agent ? agent.name : t('channels.agent.none')} />
        <AiOrdersTile channelId={c.id} />
        {/* "RÉSOLUTION IA" (carry-over M3 → M8): conversations of the page without a handoff ÷ conversations, 30 d */}
        <Link href={`/analytics/conversations?period=30d&channelId=${c.id}`} className="block rounded-card" data-testid="channel-ai-resolution">
          <StatTile
            label={t('channels.overview.aiResolution')}
            value={summary.data ? <Ltr>{summary.data.aiResolutionPct30d === null ? '—' : `${String(summary.data.aiResolutionPct30d).replace('.', locale === 'en' ? '.' : ',')} %`}</Ltr> : summary.isError ? '—' : <Skeleton className="h-6 w-10" />}
            hint={t('channels.overview.aiResolutionHint')}
          />
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3" data-testid="meta-insights" data-state={insights.isPending ? 'loading' : unavailable ? 'unavailable' : 'ready'}>
            <SectionLabel>{t('channels.overview.insights')}</SectionLabel>
            {insights.isPending ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[72px]" />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {metrics.map((m) => (
                  <StatTile key={m.key} label={metricLabel(m.key)} value={unavailable || m.value === null ? '—' : <Ltr>{formatNumber(m.value)}</Ltr>} />
                ))}
              </div>
            )}
            {unavailable ? (
              <p role="status" className="rounded-card bg-ink-raised px-3 py-2.5 ts-label-meta text-text-muted">
                {isInsightsUnavailable(insights.error) ? t('channels.overview.insightsUnavailable') : errorMessage(insights.error, t)}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3" data-testid="channel-agent">
            <SectionLabel>{t('channels.overview.agent')}</SectionLabel>
            <Card className="flex flex-wrap items-center gap-4 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line-edge bg-ink-raised text-text-secondary">
                <Bot className="size-5" aria-hidden />
              </span>
              {agent ? (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="ts-display-s truncate">{agent.name}</div>
                    <div className="ts-label-meta mt-1 text-text-muted">{t('channels.overview.agentProducts', { count: agent.productsInScope })}</div>
                  </div>
                  <StatusPill enumKey="Agent.status" value={agent.status} className="!rounded-[4px]">
                    {t(`enum.Agent.status.${agent.status}`)}
                  </StatusPill>
                </>
              ) : (
                <p className="min-w-0 flex-1 text-[13px] text-text-secondary">{t('channels.ai.noneDescription')}</p>
              )}
              <Link href={`/channels/${c.id}/ai`} className={buttonClass({ size: 'sm' })}>
                {t('channels.page.tab.ai')}
              </Link>
            </Card>
          </section>

          {summary.data?.children?.length ? (
            <section className="flex flex-col gap-3">
              <SectionLabel>{t('channels.overview.children')}</SectionLabel>
              <Card className="divide-y divide-line-hairline">
                {summary.data.children.map((child) => (
                  <Link key={child.id} href={`/channels/${child.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-raised/60">
                    <PlatformMark platform={child.platform} src={child.avatarUrl} name={child.name} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{child.name}</span>
                    <ChannelStatusPill channel={{ status: child.status, pausedReason: null }} />
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3" data-testid="channel-health">
            <SectionLabel>{t('channels.overview.health')}</SectionLabel>
            <Card className="flex flex-col gap-3.5 p-4">
              <HealthRow label={t('channels.health.webhook')} ok={health.webhookSubscribed}>
                {t(health.webhookSubscribed ? 'channels.health.webhookOn' : 'channels.health.webhookOff')}
              </HealthRow>
              <HealthRow label={t('channels.health.token')} ok={health.tokenValid}>
                {t(health.tokenValid ? 'channels.health.tokenValid' : 'channels.health.tokenInvalid')}
                {health.tokenCheckedAt ? ` · ${t('channels.health.checked', { ago: relativeTime(health.tokenCheckedAt, locale) })}` : ''}
              </HealthRow>
              <div>
                <div className="ts-label-micro text-text-muted">{t('channels.health.permissions')}</div>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {permissionList(health).map((p) => (
                    <li key={p.scope}>
                      <StatusPill enumKey="Channel.permission" value={p.state} className="!rounded-[4px] normal-case">
                        {t.has(`channels.health.scope.${p.scope}`) ? t(`channels.health.scope.${p.scope}`) : t('channels.health.scope.other')} · {t(`channels.health.permission.${p.state}`)}
                      </StatusPill>
                    </li>
                  ))}
                  {permissionList(health).length === 0 ? <li className="text-[13px] text-text-muted">—</li> : null}
                </ul>
              </div>
              <HealthRow label={t('channels.health.lastInbound')}>{health.lastInboundAt ? relativeTime(health.lastInboundAt, locale) : '—'}</HealthRow>
              <HealthRow label={t('channels.health.lastSync')}>{health.lastSyncAt ? <Ltr>{formatDateTime(health.lastSyncAt, locale)}</Ltr> : t('channels.health.neverSynced')}</HealthRow>
            </Card>
          </section>

          <section className="flex flex-col gap-3" data-testid="channel-recent">
            <SectionLabel>{t('channels.overview.recent')}</SectionLabel>
            <Card className="divide-y divide-line-hairline">
              {recent.isPending ? (
                <div className="p-4">
                  <Skeleton className="h-4" />
                </div>
              ) : (recent.data?.rows ?? []).length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-text-muted">{t('channels.history.empty')}</p>
              ) : (
                recent.data!.rows.slice(0, 4).map((e) => (
                  <div key={e.id} className="flex items-baseline gap-3 px-4 py-3">
                    <span className="ts-label-meta w-20 shrink-0 text-text-muted">{relativeTime(e.at, locale)}</span>
                    <span className="min-w-0 flex-1 text-[13px]">{e.description || t(`channels.event.${e.kind}`)}</span>
                  </div>
                ))
              )}
            </Card>
          </section>

          {actions.manage && disconnect.present ? (
            <section className="flex flex-col gap-3" data-testid="danger-zone">
              <SectionLabel>{t('channels.overview.danger')}</SectionLabel>
              <Card className="flex flex-col items-start gap-3 border-accent-alert/60 p-4">
                <p className="text-[13px] text-text-secondary">{t('channels.overview.dangerText')}</p>
                <Button className="border-accent-alert/60 text-accent-alert" onClick={() => actions.disconnect(c)} disabledReason={disconnect.reason} data-testid="disconnect-page">
                  {t('channels.action.disconnect')}
                </Button>
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, ok, children }: { label: string; ok?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="ts-label-micro text-text-muted">{label}</div>
      <div className={ok === undefined ? 'mt-1 text-[13px]' : ok ? 'mt-1 text-[13px] text-accent-money' : 'mt-1 text-[13px] text-accent-alert'}>{children}</div>
    </div>
  );
}
