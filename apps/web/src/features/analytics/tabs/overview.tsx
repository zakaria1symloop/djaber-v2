'use client';
// /analytics — Figma "ANA-02 — Analytics — overview tab + period picker": 5 tiles (Revenus · Commandes · Taux de
// livraison · Conversations · Crédits utilisés), the named money figures of 04 §4 (Revenus nets · Pipeline ·
// Encaissé · Revenus IA, each labelled with the figure it shows — ANA-03), "Revenus par jour" (bars, measure switch
// REVENUS / COMMANDES, previous period dashed, best day), "Entonnoir conversation → livraison", Top produits (revenus),
// Top wilayas (commandes livrées), Par canal · agent — every row opens the filtered list of the period.
import { formatNumber, type AnalyticsOverviewView } from '@djaber/shared';
import { BarChart, ChartPanel, DeltaBadge, FunnelBars, LegendChip, RankPanel } from '@djaber/ui';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useAnalytics, usePeriod } from '../api';
import { bestPoint, dayLabel } from '../format';
import { periodHref } from '../period';
import { axis, hintNum, Kpi, KpiRow, RevenueDefinition, TabFrame, toBuckets, useFigure } from '../parts';
import { useReportRange } from '../shell';
import { listRange } from './links';

export function OverviewTab() {
  const { period } = usePeriod();
  const q = useAnalytics('overview', period);
  useReportRange(q.data?.range);
  return <TabFrame q={q}>{(d) => <Overview d={d} />}</TabFrame>;
}

function Overview({ d }: { d: AnalyticsOverviewView }) {
  const t = useT();
  const locale = useLocaleCode();
  const fig = useFigure();
  const { period } = usePeriod();
  const [measure, setMeasure] = useState<'revenue' | 'orders'>('revenue');
  const k = d.kpis;
  const range = listRange(d.range);
  const { buckets, previous } = toBuckets(d.series, [measure], locale);
  const best = measure === 'revenue' ? (d.bestDay ? { day: d.bestDay.day, value: d.bestDay.revenue } : null) : bestPoint(d.series.points, 'orders');
  const fmt = (n: number) => (measure === 'revenue' ? `${formatNumber(n)} DA` : formatNumber(n));
  const credits = k.creditsUsed;
  const remaining = credits.hint?.remaining;
  return (
    <>
      <KpiRow>
        <Kpi
          k={k.revenue}
          name="revenue"
          label={t('analytics.figure.revenue')}
          meta={k.revenue.deltaPct !== undefined ? t('analytics.vsPrevious') : undefined}
          sub={t('analytics.overview.revenueSub', { sales: formatNumber(hintNum(k.revenue, 'salesCount') ?? 0), salesN: hintNum(k.revenue, 'salesCount') ?? 0, orders: formatNumber(hintNum(k.revenue, 'deliveredOrders') ?? 0), ordersN: hintNum(k.revenue, 'deliveredOrders') ?? 0 })}
          title={t('analytics.revenueDefinition')}
        />
        <Kpi k={k.orders} name="orders" label={t('analytics.unit.orders')} meta={t('analytics.overview.confirmedPct', { pct: fig(hintNum(k.orders, 'confirmedPct'), 'pct') })} sub={t('analytics.overview.aiOrders', { count: formatNumber(hintNum(k.orders, 'aiOrders') ?? 0) })} />
        <Kpi k={k.deliveryRate} name="deliveryRate" label={t('analytics.unit.deliveryRate')} meta={t('analytics.overview.returns', { count: hintNum(k.deliveryRate, 'returned') ?? 0 })} sub={t('analytics.overview.ofShipped', { count: formatNumber(hintNum(k.deliveryRate, 'shipped') ?? 0) })} />
        <Kpi k={k.conversations} name="conversations" label={t('analytics.unit.conversations')} meta={t('analytics.overview.aiHandled', { pct: fig(hintNum(k.conversations, 'aiHandledPct'), 'pct') })} sub={t('analytics.overview.handoffs', { count: formatNumber(hintNum(k.conversations, 'handoffs') ?? 0) })} />
        <Kpi
          k={credits}
          name="creditsUsed"
          label={t('analytics.unit.creditsUsed')}
          meta={
            remaining === null || remaining === undefined
              ? t('analytics.overview.creditsUnlimited', { pct: fig(hintNum(credits, 'monthPct'), 'pct') })
              : t('analytics.overview.creditsMonth', { pct: fig(hintNum(credits, 'monthPct'), 'pct'), remaining: formatNumber(Number(remaining)) })
          }
          sub={t('analytics.overview.creditsSplit', { text: formatNumber(hintNum(credits, 'text') ?? 0), image: formatNumber(hintNum(credits, 'image') ?? 0), voice: formatNumber(hintNum(credits, 'voice') ?? 0) })}
        />
      </KpiRow>
      <MoneyFigures d={d} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ChartPanel
          title={t('analytics.overview.chart')}
          end={
            <>
              <LegendChip tone="money" pressed={measure === 'revenue'} onToggle={() => setMeasure('revenue')}>
                {t('analytics.legend.revenue')}
              </LegendChip>
              <LegendChip tone="orders" pressed={measure === 'orders'} onToggle={() => setMeasure('orders')}>
                {t('analytics.legend.orders')}
              </LegendChip>
              {previous ? (
                <LegendChip tone="muted" dashed>
                  {t('analytics.legend.previous')}
                </LegendChip>
              ) : null}
            </>
          }
        >
          <BarChart
            label={t('analytics.overview.chart')}
            buckets={buckets}
            series={[{ key: measure, label: t(measure === 'revenue' ? 'analytics.figure.revenueShort' : 'analytics.unit.orders'), tone: measure === 'revenue' ? 'money' : 'orders' }]}
            previous={previous}
            previousLabel={t('analytics.legend.previousShort')}
            emphasis="top"
            format={fmt}
            empty={t('analytics.empty.title')}
            {...axis(d.series, locale)}
            caption={best ? t('analytics.bestDay', { day: dayLabel(best.day, locale), value: fmt(best.value) }) : undefined}
            height={220}
          />
        </ChartPanel>
        <ChartPanel title={t('analytics.overview.funnel')} data-testid="funnel">
          <FunnelBars
            rows={[
              { key: 'conversations', label: t('analytics.funnel.conversations'), value: d.funnel.conversations, formatted: formatNumber(d.funnel.conversations), tone: 'inbound' },
              { key: 'purchaseIntent', label: t('analytics.funnel.purchaseIntent'), value: d.funnel.purchaseIntent, formatted: formatNumber(d.funnel.purchaseIntent), tone: 'inbound' },
              // ANALYTICS-07: AI orders only, from the conversations above (all sources: the Commandes tab)
              { key: 'ordersCreated', label: t('analytics.funnel.aiOrdersCreated'), value: d.funnel.ordersCreated, formatted: formatNumber(d.funnel.ordersCreated), tone: 'orders' },
              { key: 'delivered', label: t('analytics.funnel.aiDelivered'), value: d.funnel.delivered, formatted: formatNumber(d.funnel.delivered), tone: 'money' },
            ]}
          />
        </ChartPanel>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <RankPanel
          title={t('analytics.overview.topProducts')}
          data-testid="top-products"
          link={<SeeAll href={periodHref('/analytics/products', period)} label={t('analytics.seeAll')} />}
          empty={t('analytics.empty.title')}
          renderLink={(href, children, className) => (
            <Link href={href} className={className}>
              {children}
            </Link>
          )}
          rows={d.topProducts.map((p) => ({
            key: p.productId,
            label: p.name,
            value: `${formatNumber(p.revenue)} DA`,
            delta: p.isNew ? <span className="ts-label-micro text-text-muted">{t('analytics.new')}</span> : <DeltaBadge value={p.deltaPct} />,
            href: `/products/${p.productId}`,
          }))}
        />
        <RankPanel
          title={t('analytics.overview.topWilayas')}
          data-testid="top-wilayas"
          link={<SeeAll href={periodHref('/analytics/orders', period)} label={t('analytics.overview.toOrders')} />}
          empty={t('analytics.empty.title')}
          renderLink={(href, children, className) => (
            <Link href={href} className={className}>
              {children}
            </Link>
          )}
          rows={d.topWilayas.map((w) => ({
            key: String(w.wilayaId),
            label: `${w.code} ${locale === 'ar' ? w.nameAr : w.name}`,
            value: `${formatNumber(w.delivered)} · ${fig(w.deliveredPct, 'pct')}`,
            delta: <DeltaBadge value={w.deltaPts} unit="pts" />,
            href: `/orders?wilayaId=${w.wilayaId}&${range}`,
          }))}
        />
        <RankPanel
          title={t('analytics.overview.byChannel')}
          data-testid="by-channel"
          link={<SeeAll href={periodHref('/analytics/channels', period)} label={t('analytics.overview.toChannels')} />}
          empty={t('analytics.empty.title')}
          renderLink={(href, children, className) => (
            <Link href={href} className={className}>
              {children}
            </Link>
          )}
          rows={d.byChannel.map((c) => ({
            key: c.channelId ?? 'manual',
            label: c.channelId ? `${c.name ?? '—'}${c.platform ? ` (${c.platform === 'facebook' ? 'FB' : 'IG'})` : ''}${c.agent ? ` · ${c.agent.name}` : ''}` : t('analytics.overview.noChannel'),
            value: t('analytics.overview.channelLine', { orders: formatNumber(c.orders), conversations: formatNumber(c.conversations) }),
            delta: <DeltaBadge value={c.deltaPct} />,
            // ANALYTICS-07: the row counts every order without a page (manual, import, mobile, API): the link opens the same ones
            href: c.channelId ? `/orders?channelId=${c.channelId}&${range}` : `/orders?source=manual,import,mobile,api&${range}`,
          }))}
        />
      </div>
    </>
  );
}

/** 04 §4 named figures: each tile says which figure it shows (ANA-03). */
function MoneyFigures({ d }: { d: AnalyticsOverviewView }) {
  const t = useT();
  const k = d.kpis;
  return (
    <section className="flex flex-col gap-2" aria-label={t('analytics.figures.title')} data-testid="money-figures">
      <div className="flex items-center justify-between gap-3">
        <h2 className="ts-label-meta uppercase text-text-muted">{t('analytics.figures.title')}</h2>
        <RevenueDefinition />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi k={k.netRevenue} name="netRevenue" label={t('analytics.figure.net_revenue')} title={t('analytics.figureHelp.net_revenue')} />
        <Kpi k={k.pipeline} name="pipeline" label={t('analytics.figure.pipeline')} title={t('analytics.figureHelp.pipeline')} meta={t('analytics.snapshot')} />
        <Kpi k={k.cashCollected} name="cashCollected" label={t('analytics.figure.cash_collected')} title={t('analytics.figureHelp.cash_collected')} />
        <Kpi k={k.aiRevenue} name="aiRevenue" label={t('analytics.figure.ai_revenue')} title={t('analytics.figureHelp.ai_revenue')} />
      </div>
    </section>
  );
}

export function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="ts-label-micro !normal-case text-accent-inbound hover:underline">
      {label} <span className="inline-block rtl:-scale-x-100">→</span>
    </Link>
  );
}
