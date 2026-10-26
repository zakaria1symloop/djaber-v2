'use client';
// /admin — Figma "ADM-01 — Platform admin — overview": period picker (`?period=7d|30d|90d`), 5 KPI tiles with sub-lines,
// signups / activations / churn per day, platform alerts (code → `admin.alert.<code>`), top workspaces (credits),
// AI cost per provider / model, trials expiring within 7 days.
import { ADMIN_PERIODS, type AdminAlertDto, type AdminOverviewDto, type AdminPeriod } from '@djaber/shared';
import { AdminAlertRow, BarChart, Card, ChartPanel, LegendChip, ListSkeleton, Menu, MenuItem, OpsKpiStrip, OpsKpiTile, RankPanel, Button, Skeleton } from '@djaber/ui';
import { ChevronDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { useAdminGet } from '@/features/admin/api';
import { useFormats } from '@/features/admin/ui';
import { Link } from '@/i18n/navigation';
import { compactAmount } from '@/lib/money';
import { useT } from '@/lib/i18n';

const linkCls = 'ts-label-micro text-accent-inbound hover:underline';

export default function AdminOverviewPage() {
  const t = useT();
  const f = useFormats();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('period');
  const period: AdminPeriod = (ADMIN_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as AdminPeriod) : '30d';
  const data = useAdminGet<AdminOverviewDto>('/admin/analytics', { period });
  const alerts = useAdminGet<AdminAlertDto[]>('/admin/alerts');
  const setPeriod = (p: AdminPeriod) => router.replace(p === '30d' ? pathname : `${pathname}?period=${p}`, { scroll: false });
  const d = data.data;
  const k = d?.kpis;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const renderLink = (href: string, children: React.ReactNode, className: string) => (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
  return (
    <AdminPage
      permission="admin.overview.read"
      title={t('admin.overview.title')}
      description={t('admin.overview.description', { days })}
      actions={
        <Menu
          trigger={
            <Button aria-label={t('admin.overview.period')} data-testid="period-picker">
              {t(`admin.overview.periodOpt.${period}`)}
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          }
        >
          {ADMIN_PERIODS.map((p) => (
            <MenuItem key={p} onSelect={() => setPeriod(p)} data-current={p === period}>
              {t(`admin.overview.periodOpt.${p}`)}
            </MenuItem>
          ))}
        </Menu>
      }
    >
      {data.isError && !d ? (
        <AdminQueryError error={data.error} onRetry={() => void data.refetch()} />
      ) : (
        <>
          <OpsKpiStrip label={t('admin.overview.kpis')}>
            <OpsKpiTile data-kpi="workspaces" context={k ? t('admin.overview.kpi.workspacesCtx', { count: k.workspaces.newInPeriod, suspended: k.workspaces.suspended }) : undefined} value={k ? f.num(k.workspaces.active) : '—'} unit={t('admin.overview.kpi.workspaces')} />
            <OpsKpiTile
              data-kpi="mrr"
              context={k ? [k.mrr.deltaPct !== null ? `${k.mrr.deltaPct > 0 ? '+' : ''}${k.mrr.deltaPct} %` : null, ...k.mrr.byPlan.map((p) => `${p.count} ${p.name}`), t('admin.overview.kpi.free', { count: k.mrr.free })].filter(Boolean).join(' · ') : undefined}
              value={k ? f.num(k.mrr.amount) : '—'}
              unit={t('admin.overview.kpi.mrr')}
            />
            <OpsKpiTile data-kpi="credits" context={k ? t('admin.overview.kpi.creditsCtx', { cost: f.num(Math.round(k.credits.aiCostUsd)), margin: k.credits.marginPct ?? '—' }) : undefined} value={k ? compactAmount(k.credits.consumed, f.locale) : '—'} unit={t('admin.overview.kpi.credits', { days })} />
            <OpsKpiTile data-kpi="conversations" context={k?.conversations.peak ? t('admin.overview.kpi.peak', { count: f.num(k.conversations.peak.count), date: f.short(k.conversations.peak.day) }) : undefined} value={k ? f.num(k.conversations.perDayAvg) : '—'} unit={t('admin.overview.kpi.conversations')} />
            <OpsKpiTile data-kpi="webhooks" context={k ? t('admin.overview.kpi.webhooksCtx', { minutes: k.webhooks.incidentMinutes, delays: k.webhooks.queueDelays }) : undefined} value={typeof k?.webhooks.availabilityPct === 'number' ? `${String(k.webhooks.availabilityPct).replace('.', f.locale === 'en' ? '.' : ',')} %` : '—'} unit={t('admin.overview.kpi.webhooks')} />
          </OpsKpiStrip>
          {/* minmax(0, …) columns: an implicit / fr column grew to its longest line and pushed the panels past the screen */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <ChartPanel
              title={t('admin.overview.chart.title')}
              end={
                <>
                  <LegendChip tone="inbound">{t('admin.overview.chart.signups')}</LegendChip>
                  <LegendChip tone="money">{t('admin.overview.chart.activations')}</LegendChip>
                  <LegendChip tone="alert">{t('admin.overview.chart.churned')}</LegendChip>
                </>
              }
              data-testid="overview-chart"
            >
              {d ? (
                <>
                  {/* tester report 22/10 UX-007: the period totals and the activation rate, dates and a scale, the three series
                      side by side (an activation is often a shop that signed up earlier: stacked, it read as more new shops) */}
                  <p className="mb-2 ts-label-meta text-text-secondary" data-testid="overview-chart-totals">
                    {t('admin.overview.chart.totals', {
                      signups: f.num(d.series.reduce((n, s) => n + s.signups, 0)),
                      activations: f.num(d.series.reduce((n, s) => n + s.activations, 0)),
                      churned: f.num(d.series.reduce((n, s) => n + s.churned, 0)),
                      rate: d.cohort?.created ? `${Math.round((d.cohort.activated / d.cohort.created) * 100)} %` : '—',
                    })}
                  </p>
                  <BarChart
                    layout="grouped"
                    axis
                    label={t('admin.overview.chart.title')}
                    buckets={d.series.map((s) => ({ key: s.day, label: f.short(s.day), values: [s.signups, s.activations, s.churned] }))}
                    series={[
                      { key: 'signups', label: t('admin.overview.chart.signups'), tone: 'inbound' },
                      { key: 'activations', label: t('admin.overview.chart.activations'), tone: 'money' },
                      { key: 'churned', label: t('admin.overview.chart.churned'), tone: 'alert' },
                    ]}
                    format={f.num}
                    empty={t('admin.overview.chart.empty')}
                  />
                </>
              ) : (
                // same height as the chart (BarChart default 180 px) instead of four text lines
                <div role="status" aria-label={t('common.loading')}>
                  <Skeleton className="h-[180px] w-full" />
                </div>
              )}
            </ChartPanel>
            <section className="flex min-w-0 flex-col rounded-card border border-line-edge bg-ink-surface" data-testid="overview-alerts">
              <header className="border-b border-line-hairline px-4 py-3">
                <h2 className="ts-title">{t('admin.overview.alerts.title')}</h2>
              </header>
              {alerts.isPending ? (
                <ListSkeleton rows={4} columns={1} label={t('common.loading')} />
              ) : alerts.isError ? (
                <div className="p-4"><AdminQueryError error={alerts.error} onRetry={() => void alerts.refetch()} /></div>
              ) : alerts.data.length === 0 ? (
                <p className="px-4 py-8 text-center ts-label-meta text-text-muted">{t('admin.overview.alerts.empty')}</p>
              ) : (
                <ul className="divide-y divide-line-hairline">
                  {alerts.data.map((a, i) => (
                    <AdminAlertRow
                      key={`${a.code}-${i}`}
                      data-alert={a.code}
                      tone={a.severity === 'critical' ? 'danger' : 'warning'}
                      title={t.has(`admin.alert.${a.code}`) ? t(`admin.alert.${a.code}`, a.params) : a.code}
                      meta={[a.since ? t('admin.overview.alerts.since', { ago: f.ago(a.since) }) : null, t.has(`admin.alert.${a.code}.hint`) ? t(`admin.alert.${a.code}.hint`, a.params) : null].filter(Boolean).join(' · ')}
                      action={<Link href={a.link} className="hover:underline">{t(`admin.overview.alerts.link.${a.code}`)}</Link>}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <RankPanel
              title={t('admin.overview.top.title', { days })}
              link={<Link href="/admin/workspaces" className={linkCls}>{t('admin.overview.top.link')}</Link>}
              rows={(d?.topWorkspaces ?? []).map((w) => ({ key: w.id, label: w.name, value: f.num(w.credits), delta: <span className="ts-label-micro text-text-muted">{w.planName}</span>, href: `/admin/workspaces?sheet=${w.id}` }))}
              renderLink={renderLink}
              empty={d ? t('admin.overview.top.empty') : t('common.loading')}
            />
            <RankPanel
              title={t('admin.overview.ai.title')}
              link={<Link href="/admin/ai" className={linkCls}>{t('admin.overview.ai.link')}</Link>}
              rows={(d?.aiCostByModel ?? []).map((m) => ({ key: `${m.provider}:${m.model}:${m.capability}`, label: `${m.provider} · ${m.model}`, value: `${f.num(Math.round(m.costUsd))} $`, delta: <span className="whitespace-nowrap ts-label-micro text-text-muted">{t(`admin.overview.ai.unit.${m.unit}`, { count: compactAmount(m.units, f.locale) })}</span> }))}
              empty={d ? t('admin.overview.ai.empty') : t('common.loading')}
            />
            <Card className="flex min-w-0 flex-col p-0" data-testid="trials-expiring">
              <header className="flex items-center justify-between gap-2 border-b border-line-hairline px-4 py-3">
                <h2 className="ts-title">{t('admin.overview.trials.title')}</h2>
                <Link href="/admin/subscriptions?status=trial" className={linkCls}>{t('admin.overview.trials.link')}</Link>
              </header>
              {(d?.trialsExpiring ?? []).length ? (
                <ul className="divide-y divide-line-hairline">
                  {d!.trialsExpiring.map((w) => (
                    <li key={w.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <Link href={`/admin/workspaces?sheet=${w.id}`} className="min-w-0 flex-1 truncate hover:underline">{w.name}</Link>
                      <span className="whitespace-nowrap">{t('admin.overview.trials.expires', { date: f.short(w.trialEndsAt) })}</span>
                      <span className="whitespace-nowrap ts-label-micro text-text-muted">{w.orders ? t('admin.overview.trials.orders', { count: w.orders }) : w.pagesConnected === 0 ? t('admin.overview.trials.noPage') : t('admin.overview.trials.conversations', { count: w.conversations })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center ts-label-meta text-text-muted">{d ? t('admin.overview.trials.empty') : t('common.loading')}</p>
              )}
            </Card>
          </div>
        </>
      )}
    </AdminPage>
  );
}
