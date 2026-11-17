'use client';
// /analytics/[tab] — Figma "ANA-02b — Analytics — tabs Conversations · IA · Agents · Canaux · Produits · Commandes ·
// Livraison" (+ the route-map tabs Réponses IA / Consommation split from "Réponses & conso IA"). Each tab = KPI tiles ·
// one chart (stacked series of one unit, or a measure switch when the values are rates / durations — one axis per
// chart) · one table whose rows open the filtered list of the period. Orders adds the funnel, the wilaya choropleth,
// cancel reasons and payment mix donuts; Products the "demandé mais absent" topics; Consumption the burn projection.
import { formatNumber, type AnalyticsKpi, type AnalyticsTab } from '@djaber/shared';
import { BarChart, ChartPanel, DonutChart, FunnelBars, LegendChip, Ltr, WilayaMap, type ChartSeries, type ChartTone } from '@djaber/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useAnalytics, usePeriod } from '../api';
import { dayLabel, type Unit } from '../format';
import { axis, ChartAndTable, DeltaCell, hintNum, Kpi, KpiRow, Num, TabFrame, TabNote, TabTable, toBuckets, useFigure } from '../parts';
import { useReportRange } from '../shell';
import { listRange } from './links';

const TONES: ChartTone[] = ['inbound', 'orders', 'money', 'clients', 'starred'];

/**
 * Line under « Marge moyenne » (journeys 16/11 J11-2 / J11-3): the formula of the figure — gross sales with a known cost
 * price, like the report Ventes par produit — and the amount sold without a cost price that it leaves out.
 */
function marginMeta(k: AnalyticsKpi, t: ReturnType<typeof useT>): string {
  if (hintNum(k, 'advanced') === 0) return t('analytics.products.advancedOnly');
  const unknown = hintNum(k, 'unknownCost') ?? 0;
  return unknown > 0 ? t('analytics.products.marginUnknown', { value: formatNumber(unknown) }) : t('analytics.products.marginHelp');
}
const tr = (t: ReturnType<typeof useT>, key: string, raw: string) => (t.has(key) ? t(key) : raw);

/** Generic stacked chart of one unit. */
function StackChart({ title, series, data, format, height = 200, end }: { title: string; series: ChartSeries[]; data: { points: { day: string; values: Record<string, number>; previous: Record<string, number> | null; previousDay: string | null }[]; keys: string[] }; format: (n: number) => string; height?: number; end?: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const { buckets, previous } = toBuckets(data, series.map((s) => s.key), locale);
  return (
    <ChartPanel
      title={title}
      end={
        <>
          {series.length > 1
            ? series.map((s) => (
                <LegendChip key={s.key} tone={s.tone}>
                  {s.label}
                </LegendChip>
              ))
            : null}
          {previous ? (
            <LegendChip tone="muted" dashed>
              {t('analytics.legend.previousShort')}
            </LegendChip>
          ) : null}
          {end}
        </>
      }
    >
      <BarChart label={title} buckets={buckets} series={series} previous={previous} previousLabel={t('analytics.legend.previousShort')} format={format} empty={t('analytics.empty.title')} height={height} {...axis(data, locale)} />
    </ChartPanel>
  );
}

/** Chart of one measure picked among several (rates / durations: never stacked). */
function SwitchChart({ title, series, data, format }: { title: string; series: ChartSeries[]; data: Parameters<typeof StackChart>[0]['data']; format: (n: number) => string }) {
  const [pick, setPick] = useState<string | null>(null);
  const t = useT();
  const locale = useLocaleCode();
  const active = series.find((s) => s.key === pick) ?? series[0];
  const { buckets, previous } = toBuckets(data, active ? [active.key] : [], locale);
  return (
    <ChartPanel
      title={title}
      end={series.map((s) => (
        <LegendChip key={s.key} tone={s.tone} pressed={s.key === active?.key} onToggle={() => setPick(s.key)}>
          {s.label}
        </LegendChip>
      ))}
    >
      <BarChart label={title} buckets={buckets} series={active ? [active] : []} previous={previous} previousLabel={t('analytics.legend.previousShort')} format={format} empty={t('analytics.empty.title')} height={200} {...axis(data, locale)} />
    </ChartPanel>
  );
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatNumber(v));

/* ---------- Conversations ---------- */
function ConversationsTab() {
  const t = useT();
  const fig = useFigure();
  // p95 of a histogram KPI: « > 50 » when it sits in the open last bucket (ANALYTICS-08); otherwise it is the upper edge of
  // its bucket, an upper bound — « ≤ 1 j » (J11-7 c: « p95 1 j » next to « 0 j » for parcels delivered within a minute)
  const p95 = (k: AnalyticsKpi | undefined, unit: Unit) => `${hintNum(k, 'p95Above') === 1 ? '> ' : '≤ '}${fig(hintNum(k, 'p95'), unit)}`;
  const { period } = usePeriod();
  const q = useAnalytics('conversations', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q}>
      {(d) => {
        const k = d.kpis;
        const langs = d.languages.map((l) => `${tr(t, `analytics.language.${l.language}`, l.language)} ${fig(l.pct, 'pct')}`).join(' · ');
        return (
          <>
            {langs || d.peakHours ? <TabNote>{[langs ? t('analytics.conversations.languages', { list: langs }) : null, d.peakHours ? t('analytics.conversations.peak', { from: d.peakHours.from, to: d.peakHours.to }) : null].filter(Boolean).join(' · ')}</TabNote> : null}
            <KpiRow>
              <Kpi k={k.conversations} name="conversations" label={t('analytics.unit.conversations')} />
              <Kpi k={k.aiHandledPct} name="aiHandledPct" label={t('analytics.unit.aiHandled')} meta={t('analytics.conversations.handoffs', { count: n(hintNum(k.aiHandledPct, 'handoffs')) })} />
              <Kpi k={k.messagesPerConversation} name="messagesPerConversation" label={t('analytics.unit.messagesPerConversation')} meta={t('analytics.median')} sub={hintNum(k.messagesPerConversation, 'p95') !== null ? t('analytics.p95', { value: p95(k.messagesPerConversation, 'ratio') }) : undefined} />
              <Kpi k={k.aiResponseTime} name="aiResponseTime" label={t('analytics.unit.aiResponseTime')} meta={t('analytics.p95', { value: p95(k.aiResponseTime, 'seconds') })} />
              <Kpi k={k.humanResponseTime} name="humanResponseTime" label={t('analytics.unit.humanResponseTime')} meta={t('analytics.p95', { value: p95(k.humanResponseTime, 'minutes') })} />
            </KpiRow>
            <ChartAndTable>
              <StackChart
                title={t('analytics.conversations.chart')}
                data={d.series}
                format={formatNumber}
                series={[
                  { key: 'new', label: t('analytics.legend.new'), tone: 'inbound' },
                  { key: 'transferred', label: t('analytics.legend.transferred'), tone: 'alert' },
                ]}
              />
              <TabTable
                title={t('analytics.table.byChannel')}
                testId="tab-table"
                rows={d.byChannel}
                rowKey={(r) => r.channelId}
                href={(r) => `/inbox?channel=${r.channelId}`}
                columns={[
                  { key: 'name', header: t('analytics.col.channel'), cell: (r) => `${r.name} (${r.platform === 'facebook' ? 'FB' : 'IG'})` },
                  { key: 'conv', header: t('analytics.col.conversations'), align: 'end', cell: (r) => <Num>{n(r.conversations)}</Num> },
                  { key: 'ai', header: t('analytics.col.aiPct'), align: 'end', cell: (r) => <Num>{fig(r.aiPct, 'pct')}</Num> },
                  { key: 'handoffs', header: t('analytics.col.handoffs'), align: 'end', cell: (r) => <Num>{n(r.handoffs)}</Num> },
                  { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pct={r.deltaPct} /> },
                ]}
              />
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Réponses IA ---------- */
function ResponsesTab() {
  const t = useT();
  const fig = useFigure();
  const { period } = usePeriod();
  const q = useAnalytics('responses', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q}>
      {(d) => {
        const k = d.kpis;
        const total = d.byIntent.reduce((s, x) => s + x.runs, 0);
        return (
          <>
            <KpiRow>
              <Kpi k={k.aiReplies} name="aiReplies" label={t('analytics.unit.aiReplies')} meta={t('analytics.overview.creditsSplit', { text: n(hintNum(k.aiReplies, 'text')), image: n(hintNum(k.aiReplies, 'image')), voice: n(hintNum(k.aiReplies, 'voice')) })} />
              <Kpi k={k.creditsUsed} name="creditsUsed" label={t('analytics.unit.creditsUsed')} meta={t('analytics.responses.monthPct', { pct: fig(hintNum(k.creditsUsed, 'monthPct'), 'pct') })} />
              <Kpi k={k.creditsPerReply} name="creditsPerReply" label={t('analytics.unit.creditsPerReply')} meta={t('analytics.averageShort')} />
              <Kpi k={k.errorRate} name="errorRate" label={t('analytics.unit.errorRate')} meta={t('analytics.responses.fallbacks', { count: n(hintNum(k.errorRate, 'fallbacks')) })} />
              <Kpi k={k.reactions} name="reactions" label={t('analytics.unit.reactions')} meta={hintNum(k.reactions, 'score') !== null ? t('analytics.responses.score', { score: fig(hintNum(k.reactions, 'score'), 'ratio') }) : undefined} sub={t('analytics.responses.likes', { likes: n(hintNum(k.reactions, 'likes')), dislikes: n(hintNum(k.reactions, 'dislikes')) })} />
            </KpiRow>
            <ChartAndTable>
              <SwitchChart
                title={t('analytics.responses.chart')}
                data={d.series}
                format={formatNumber}
                series={[
                  { key: 'replies', label: t('analytics.legend.replies'), tone: 'inbound' },
                  { key: 'handoffs', label: t('analytics.legend.handoffs'), tone: 'orders' },
                  { key: 'errors', label: t('analytics.legend.errors'), tone: 'alert' },
                ]}
              />
              <TabTable
                title={t('analytics.table.byIntent')}
                testId="tab-table"
                rows={d.byIntent}
                rowKey={(r) => r.intent}
                href={(r) => `/inbox?intent=${encodeURIComponent(r.intent)}`}
                columns={[
                  { key: 'intent', header: t('analytics.col.intent'), cell: (r) => tr(t, `analytics.intent.${r.intent}`, r.intent) },
                  { key: 'runs', header: t('analytics.col.runs'), align: 'end', cell: (r) => <Num>{n(r.runs)}</Num> },
                  { key: 'pct', header: '%', align: 'end', cell: (r) => <Num>{fig(r.pct ?? (total ? (r.runs / total) * 100 : null), 'pct')}</Num> },
                ]}
              />
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Consommation (crédits & coût IA) ---------- */
function ConsumptionTab() {
  const t = useT();
  const fig = useFigure();
  const locale = useLocaleCode();
  const { period } = usePeriod();
  const q = useAnalytics('consumption', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q} tiles={4}>
      {(d) => {
        const k = d.kpis;
        const p = d.projection;
        return (
          <>
            <TabNote>
              <span data-testid="projection">
                {p.unlimited
                  ? t('analytics.consumption.unlimited')
                  : p.exhaustsOn
                    ? t('analytics.consumption.projection', { date: dayLabel(p.exhaustsOn, locale), burn: fig(p.dailyBurn, 'ratio'), burnN: p.dailyBurn })
                    : t('analytics.consumption.noProjection', { burn: fig(p.dailyBurn, 'ratio'), burnN: p.dailyBurn })}{' '}
                {/* the credits page of the route map (packs are bought there); `projection.packsPath` is informative */}
                <Link href="/settings/credits" className="text-accent-inbound hover:underline" data-testid="packs-link">
                  {t('analytics.consumption.packs')}
                </Link>
              </span>
            </TabNote>
            <KpiRow count={4}>
              <Kpi k={k.creditsUsed} name="creditsUsed" label={t('analytics.unit.creditsUsed')} />
              <Kpi k={k.costUsd} name="costUsd" label={t('analytics.unit.costUsd')} title={t('analytics.consumption.costHelp')} />
              <Kpi k={k.costPerReplyUsd} name="costPerReplyUsd" label={t('analytics.unit.costPerReply')} />
              <Kpi k={k.tokens} name="tokens" label={t('analytics.unit.tokens')} meta={t('analytics.consumption.tokens', { input: n(hintNum(k.tokens, 'input')), output: n(hintNum(k.tokens, 'output')) })} />
            </KpiRow>
            <ChartAndTable>
              <StackChart
                title={t('analytics.consumption.chart')}
                data={d.series}
                format={formatNumber}
                series={[
                  { key: 'text', label: t('analytics.legend.text'), tone: 'inbound' },
                  { key: 'image', label: t('analytics.legend.image'), tone: 'orders' },
                  { key: 'voice', label: t('analytics.legend.voice'), tone: 'clients' },
                ]}
              />
              <div className="flex flex-col gap-4">
                <TabTable
                  title={t('analytics.table.byType')}
                  testId="tab-table"
                  rows={d.byType}
                  rowKey={(r) => r.type}
                  href={() => '/settings/credits'}
                  columns={[
                    { key: 'type', header: t('analytics.col.type'), cell: (r) => t(`analytics.creditType.${r.type}`) },
                    { key: 'volume', header: t('analytics.col.volume'), align: 'end', cell: (r) => <Num>{n(r.volume)}</Num> },
                    { key: 'credits', header: t('analytics.col.credits'), align: 'end', cell: (r) => <Num>{n(r.credits)}</Num> },
                    { key: 'unit', header: t('analytics.col.unitCost'), align: 'end', cell: (r) => <Num>{n(r.unitCost)}</Num> },
                    { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pct={r.deltaPct} /> },
                  ]}
                />
                <TabTable
                  title={t('analytics.table.byModel')}
                  rows={d.byModel}
                  rowKey={(r) => r.modelId}
                  columns={[
                    { key: 'model', header: t('analytics.col.model'), cell: (r) => `${r.name} · ${r.provider}` },
                    { key: 'runs', header: t('analytics.col.runs'), align: 'end', cell: (r) => <Num>{n(r.runs)}</Num> },
                    { key: 'tokens', header: t('analytics.col.tokens'), align: 'end', cell: (r) => <Num>{`${n(r.inputTokens)} / ${n(r.outputTokens)}`}</Num> },
                    { key: 'cost', header: t('analytics.col.costUsd'), align: 'end', cell: (r) => <Num>{fig(r.costUsd, 'usd')}</Num> },
                  ]}
                />
              </div>
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Agents ---------- */
function AgentsTab() {
  const t = useT();
  const fig = useFigure();
  const { period } = usePeriod();
  const q = useAnalytics('agents', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q} tiles={4}>
      {(d) => {
        const k = d.kpis;
        const names = d.agents.map((a) => `${a.name} ${fig(a.autonomyPct, 'pct')}`).join(' · ');
        return (
          <>
            <KpiRow count={4}>
              <Kpi k={k.activeAgents} name="activeAgents" label={t('analytics.unit.activeAgents')} meta={t('analytics.agents.paused', { count: n(hintNum(k.activeAgents, 'paused')) })} />
              <Kpi k={k.autonomy} name="autonomy" label={t('analytics.unit.autonomy')} meta={names || undefined} />
              <Kpi k={k.ordersCreated} name="ordersCreated" label={t('analytics.unit.aiOrdersCreated')} meta={t('analytics.overview.confirmedPct', { pct: fig(hintNum(k.ordersCreated, 'confirmedPct'), 'pct') })} />
              <Kpi k={k.insightsPending} name="insightsPending" label={t('analytics.unit.insightsPending')} meta={t('analytics.agents.resolved', { count: n(hintNum(k.insightsPending, 'resolved')) })} />
            </KpiRow>
            <ChartAndTable>
              <SwitchChart title={t('analytics.agents.chart')} data={d.series} format={(v) => fig(v, 'pct')} series={d.agents.slice(0, 5).map((a, i) => ({ key: a.agentId, label: a.name.toUpperCase(), tone: TONES[i % TONES.length]! }))} />
              <TabTable
                title={t('analytics.table.agents')}
                testId="tab-table"
                rows={d.agents}
                rowKey={(r) => r.agentId}
                href={(r) => `/agents/${r.agentId}`}
                columns={[
                  { key: 'name', header: t('analytics.col.agent'), cell: (r) => r.name },
                  { key: 'conv', header: t('analytics.col.conversations'), align: 'end', cell: (r) => <Num>{n(r.conversations)}</Num> },
                  { key: 'autonomy', header: t('analytics.col.autonomy'), align: 'end', cell: (r) => <Num>{fig(r.autonomyPct, 'pct')}</Num> },
                  { key: 'orders', header: t('analytics.col.orders'), align: 'end', cell: (r) => <Num>{n(r.orders)}</Num> },
                  { key: 'aiRevenue', header: t('analytics.col.aiRevenue'), align: 'end', cell: (r) => <Num>{n(r.aiRevenue)}</Num> },
                  { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pct={r.deltaPct} /> },
                ]}
              />
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Canaux ---------- */
function ChannelsTab() {
  const t = useT();
  const fig = useFigure();
  const { period } = usePeriod();
  const q = useAnalytics('channels', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q}>
      {(d) => {
        const k = d.kpis;
        return (
          <>
            <TabNote>{t('analytics.channels.note', { count: n(hintNum(k.inboundMessages, 'skippedWindow')) })}</TabNote>
            <KpiRow>
              <Kpi k={k.activePages} name="activePages" label={t('analytics.unit.activePages')} meta={t('analytics.channels.pending', { count: n(hintNum(k.activePages, 'pendingMeta')) })} />
              <Kpi k={k.followers} name="followers" label={t('analytics.unit.followers')} meta={t('analytics.snapshot')} />
              <Kpi k={k.conversationsFacebook} name="conversationsFacebook" label={t('analytics.unit.conversationsFb')} meta={t('analytics.channels.aiPct', { pct: fig(hintNum(k.conversationsFacebook, 'aiPct'), 'pct') })} />
              <Kpi k={k.conversationsInstagram} name="conversationsInstagram" label={t('analytics.unit.conversationsIg')} meta={t('analytics.channels.aiPct', { pct: fig(hintNum(k.conversationsInstagram, 'aiPct'), 'pct') })} />
              <Kpi k={k.inboundMessages} name="inboundMessages" label={t('analytics.unit.inboundMessages')} meta={t('analytics.channels.skipped', { count: n(hintNum(k.inboundMessages, 'skippedWindow')) })} />
            </KpiRow>
            <ChartAndTable>
              <StackChart title={t('analytics.channels.chart')} data={d.series} format={formatNumber} series={d.channels.slice(0, 5).map((c, i) => ({ key: c.channelId, label: `${c.name} (${c.platform === 'facebook' ? 'FB' : 'IG'})`, tone: c.platform === 'instagram' ? 'clients' : TONES[i % TONES.length]! }))} />
              <TabTable
                title={t('analytics.table.channels')}
                testId="tab-table"
                rows={d.channels}
                rowKey={(r) => r.channelId}
                href={(r) => `/channels/${r.channelId}`}
                columns={[
                  { key: 'name', header: t('analytics.col.channel'), cell: (r) => `${r.name} (${r.platform === 'facebook' ? 'FB' : 'IG'})` },
                  { key: 'in', header: t('analytics.col.inbound'), align: 'end', cell: (r) => <Num>{n(r.inbound)}</Num> },
                  { key: 'out', header: t('analytics.col.outbound'), align: 'end', cell: (r) => <Num>{n(r.outbound)}</Num> },
                  { key: 'orders', header: t('analytics.col.orders'), align: 'end', cell: (r) => <Num>{n(r.orders)}</Num> },
                  { key: 'aiRevenue', header: t('analytics.col.aiRevenue'), align: 'end', cell: (r) => <Num>{n(r.aiRevenue)}</Num> },
                  { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pct={r.deltaPct} /> },
                ]}
              />
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Produits ---------- */
function ProductsTab() {
  const t = useT();
  const { period } = usePeriod();
  const q = useAnalytics('products', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q}>
      {(d) => {
        const k = d.kpis;
        const top = k.topProduct.hint?.name;
        return (
          <>
            <KpiRow>
              <Kpi k={k.activeProducts} name="activeProducts" label={t('analytics.unit.activeProducts')} meta={t('analytics.products.lowStock', { count: n(hintNum(k.activeProducts, 'lowStock')) })} />
              <Kpi k={k.unitsSold} name="unitsSold" label={t('analytics.unit.unitsSold')} meta={t('analytics.products.distinct', { count: n(hintNum(k.unitsSold, 'distinct')) })} />
              <Kpi k={k.topProduct} name="topProduct" label={t('analytics.unit.topProduct')} meta={typeof top === 'string' ? top : undefined} />
              <Kpi k={k.avgMarginPct} name="avgMarginPct" label={t('analytics.unit.avgMargin')} meta={marginMeta(k.avgMarginPct, t)} />
              <Kpi k={k.deadStock} name="deadStock" label={t('analytics.unit.deadStock', { days: hintNum(k.deadStock, 'days') ?? 60 })} meta={t('analytics.products.immobilised', { value: n(hintNum(k.deadStock, 'valueAtCost')) })} />
            </KpiRow>
            <ChartAndTable>
              <StackChart title={t('analytics.products.chart')} data={d.series} format={(v) => `${formatNumber(v)} DA`} series={d.categories.map((c, i) => ({ key: c.key, label: (c.name ?? t('analytics.products.otherCategories')).toUpperCase(), tone: c.key === 'other' ? 'muted' : TONES[i % TONES.length]! }))} />
              <div className="flex flex-col gap-4">
                <TabTable
                  title={t('analytics.table.products')}
                  testId="tab-table"
                  rows={d.products}
                  rowKey={(r) => r.productId}
                  href={(r) => `/products/${r.productId}`}
                  columns={[
                    { key: 'name', header: t('analytics.col.product'), cell: (r) => r.name },
                    { key: 'requested', header: t('analytics.col.requested'), align: 'end', cell: (r) => <Num>{n(r.requested)}</Num> },
                    { key: 'sold', header: t('analytics.col.sold'), align: 'end', cell: (r) => <Num>{r.sold ? n(r.sold) : '—'}</Num> },
                    { key: 'revenue', header: t('analytics.col.revenue'), align: 'end', cell: (r) => <Num>{r.revenue ? n(r.revenue) : '—'}</Num> },
                    { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pct={r.deltaPct} isNew={r.isNew} /> },
                  ]}
                />
                {d.requestedAbsent.length ? (
                  <ChartPanel title={t('analytics.products.absent')} data-testid="requested-absent" end={<Link href="/recommendations" className="ts-label-micro !normal-case text-accent-inbound hover:underline">{t('analytics.products.toRecommendations')}</Link>}>
                    <ul className="flex flex-wrap gap-2">
                      {d.requestedAbsent.map((a) => (
                        <li key={a.topic} className="rounded-[4px] border border-line-edge px-2 py-1 text-[12px]">
                          {a.topic} <Ltr className="text-text-muted">{`×${a.count}`}</Ltr>
                        </li>
                      ))}
                    </ul>
                  </ChartPanel>
                ) : null}
              </div>
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

/* ---------- Commandes ---------- */
function OrdersTab() {
  const t = useT();
  const fig = useFigure();
  const locale = useLocaleCode();
  const router = useRouter();
  const { period } = usePeriod();
  const q = useAnalytics('orders', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q} tiles={6}>
      {(d) => {
        const k = d.kpis;
        const range = listRange(d.range);
        return (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="analytics-kpis">
              <Kpi k={k.orders} name="orders" label={t('analytics.unit.orders')} meta={t('analytics.orders.split', { ai: n(hintNum(k.orders, 'ai')), human: n(hintNum(k.orders, 'human')) })} onClick={() => router.push(`/orders?${range}`)} />
              <Kpi k={k.confirmationRate} name="confirmationRate" label={t('analytics.unit.confirmationRate')} meta={t('analytics.orders.calls', { value: fig(hintNum(k.confirmationRate, 'callsPerOrder'), 'ratio') })} />
              <Kpi k={k.delivered} name="delivered" label={t('analytics.unit.delivered')} meta={t('analytics.orders.deliveredMeta', { rate: fig(hintNum(k.delivered, 'deliveryRate'), 'pct'), cod: fig(hintNum(k.delivered, 'codPct'), 'pct') })} onClick={() => router.push(`/orders?tab=delivered&${range}`)} />
              <Kpi k={k.cancelledPct} name="cancelledPct" label={t('analytics.unit.cancelled')} meta={t('analytics.orders.wrongNumber', { pct: fig(hintNum(k.cancelledPct, 'wrongNumberPct'), 'pct') })} onClick={() => router.push(`/orders?tab=cancelled&${range}`)} />
              <Kpi k={k.returnedPct} name="returnedPct" label={t('analytics.unit.returned')} meta={t('analytics.orders.returns', { count: hintNum(k.returnedPct, 'returned') ?? 0 })} onClick={() => router.push(`/orders?tab=returned&${range}`)} />
              <Kpi k={k.abandoned} name="abandoned" label={t('analytics.unit.abandoned')} meta={hintNum(k.abandoned, 'pct') !== null ? fig(hintNum(k.abandoned, 'pct'), 'pct') : undefined} />
            </section>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label={t('analytics.figures.title')} data-testid="money-figures">
              {(['revenue', 'netRevenue', 'pipeline', 'cashCollected', 'aiRevenue'] as const).map((key) => {
                const fk = k[key] as AnalyticsKpi;
                const fname = fk.figure ?? ({ revenue: 'revenue', netRevenue: 'net_revenue', pipeline: 'pipeline', cashCollected: 'cash_collected', aiRevenue: 'ai_revenue' } as const)[key];
                return <Kpi key={key} k={fk} name={key} label={t(`analytics.figure.${fname}`)} title={t(`analytics.figureHelp.${fname}`)} meta={key === 'pipeline' ? t('analytics.snapshot') : undefined} />;
              })}
            </section>
            <ChartAndTable>
              <StackChart
                title={t('analytics.orders.chart')}
                data={d.series}
                format={formatNumber}
                series={(['ai', 'manual', 'mobile', 'api', 'import'] as const).filter((s) => d.series.points.some((p) => (p.values[s] ?? 0) > 0) || s === 'ai' || s === 'manual').map((s, i) => ({ key: s, label: t(`analytics.source.${s}`), tone: TONES[i % TONES.length]! }))}
              />
              <ChartPanel title={t('analytics.orders.funnel')} data-testid="funnel">
                <FunnelBars
                  rows={[
                    { key: 'created', label: t('analytics.funnel.ordersCreated'), value: d.funnel.created, formatted: n(d.funnel.created), tone: 'orders' },
                    { key: 'confirmed', label: t('analytics.funnel.confirmed'), value: d.funnel.confirmed, formatted: n(d.funnel.confirmed), tone: 'orders' },
                    { key: 'shipped', label: t('analytics.funnel.shipped'), value: d.funnel.shipped, formatted: n(d.funnel.shipped), tone: 'inbound' },
                    { key: 'delivered', label: t('analytics.funnel.delivered'), value: d.funnel.delivered, formatted: n(d.funnel.delivered), tone: 'money' },
                  ]}
                />
                {d.bySource.length ? (
                  <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-line-hairline pt-3 text-[12px]" data-testid="by-source">
                    {d.bySource.map((s) => (
                      <li key={s.source} className="flex justify-between gap-2">
                        <Link href={`/orders?source=${s.source}&${range}`} className="text-text-secondary hover:text-text-primary">
                          {tr(t, `analytics.source.${s.source}`, s.source)}
                        </Link>
                        <Num>{`${n(s.orders)} · ${n(s.revenue)} DA`}</Num>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </ChartPanel>
            </ChartAndTable>
            <ChartAndTable>
              <TabTable
                title={t('analytics.table.wilayas')}
                testId="tab-table"
                rows={d.wilayas.slice(0, 12)}
                rowKey={(r) => String(r.wilayaId)}
                href={(r) => `/orders?wilayaId=${r.wilayaId}&${range}`}
                columns={[
                  { key: 'wilaya', header: t('analytics.col.wilaya'), cell: (r) => `${r.code} ${locale === 'ar' ? r.nameAr : r.name}` },
                  { key: 'orders', header: t('analytics.col.ordersShort'), align: 'end', cell: (r) => <Num>{n(r.orders)}</Num> },
                  { key: 'delivered', header: t('analytics.col.deliveredPct'), align: 'end', cell: (r) => <Num>{fig(r.deliveredPct, 'pct')}</Num> },
                  { key: 'returned', header: t('analytics.col.returned'), align: 'end', cell: (r) => <Num>{n(r.returned)}</Num> },
                  { key: 'delta', header: 'Δ', align: 'end', cell: (r) => <DeltaCell pts={r.deltaPts} /> },
                ]}
              />
              <WilayaPanel rows={d.wilayas} range={range} />
            </ChartAndTable>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <ChartPanel title={t('analytics.orders.cancelReasons')} data-testid="cancel-reasons">
                <DonutChart label={t('analytics.orders.cancelReasons')} format={formatNumber} empty={t('analytics.empty.title')} slices={d.cancelReasons.slice(0, 6).map((r, i) => ({ key: r.reason, label: tr(t, `enum.Order.cancelReason.${r.reason}`, r.reason), value: r.count, tone: r.reason === 'other' ? 'muted' : TONES[i % TONES.length]! }))} />
              </ChartPanel>
              <ChartPanel title={t('analytics.orders.paymentMix')} data-testid="payment-mix">
                <DonutChart label={t('analytics.orders.paymentMix')} format={formatNumber} empty={t('analytics.empty.title')} slices={d.paymentMix.slice(0, 6).map((r, i) => ({ key: r.method, label: tr(t, `enum.Order.paymentMethod.${r.method}`, r.method), value: r.count, tone: r.method === 'other' ? 'muted' : TONES[i % TONES.length]! }))} />
              </ChartPanel>
            </div>
          </>
        );
      }}
    </TabFrame>
  );
}

function WilayaPanel({ rows, range }: { rows: { wilayaId: number; name: string; nameAr: string; orders: number }[]; range: string }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const values = useMemo(() => Object.fromEntries(rows.map((r) => [r.wilayaId, r.orders])), [rows]);
  const names = useMemo(() => Object.fromEntries(rows.map((r) => [r.wilayaId, locale === 'ar' ? r.nameAr : r.name])), [rows, locale]);
  return (
    <ChartPanel title={t('analytics.orders.map')}>
      <div className="mx-auto max-w-[420px]">
        <WilayaMap values={values} names={names} format={(v) => t('analytics.orders.mapValue', { count: formatNumber(v) })} onSelect={(code) => router.push(`/orders?wilayaId=${code}&${range}`)} labels={{ title: t('analytics.orders.map'), low: t('analytics.map.low'), high: t('analytics.map.high'), noData: t('analytics.map.none') }} />
      </div>
    </ChartPanel>
  );
}

/* ---------- Livraison (DLV-11) ---------- */
function DeliveryTab() {
  const t = useT();
  const router = useRouter();
  const fig = useFigure();
  const { period } = usePeriod();
  const q = useAnalytics('delivery', period);
  useReportRange(q.data?.range);
  return (
    <TabFrame q={q}>
      {(d) => {
        const k = d.kpis;
        const range = listRange(d.range);
        const couriers = Object.entries(k.shipped.hint ?? {})
          .map(([name, v]) => `${name} ${v ?? 0}`)
          .join(' · ');
        return (
          <>
            <KpiRow>
              <Kpi k={k.shipped} name="shipped" label={t('analytics.unit.shipped')} meta={couriers || undefined} />
              <Kpi k={k.avgDays} name="avgDays" label={t('analytics.unit.avgDays')} meta={hintNum(k.avgDays, 'p95') === null ? undefined : t('analytics.p95', { value: `${hintNum(k.avgDays, 'p95Above') === 1 ? '> ' : '≤ '}${fig(hintNum(k.avgDays, 'p95'), 'days')}` })} />
              <Kpi k={k.firstAttemptPct} name="firstAttemptPct" label={t('analytics.unit.firstAttempt')} meta={t('analytics.delivery.secondAttempt', { pct: fig(hintNum(k.firstAttemptPct, 'secondAttemptPct'), 'pct') })} />
              <Kpi k={k.openFailures} name="openFailures" label={t('analytics.unit.openFailures')} meta={t('analytics.delivery.over48h', { count: n(hintNum(k.openFailures, 'over48h')) })} onClick={() => router.push('/delivery?tab=failed')} />
              <Kpi k={k.courierFees} name="courierFees" label={t('analytics.unit.courierFees')} meta={t('analytics.delivery.customerFees', { value: n(hintNum(k.courierFees, 'customerFees')) })} />
            </KpiRow>
            <ChartAndTable>
              <SwitchChart title={t('analytics.delivery.chart')} data={d.series} format={(v) => fig(v, 'days')} series={d.couriers.slice(0, 5).map((c, i) => ({ key: c.key, label: c.name.toUpperCase(), tone: TONES[i % TONES.length]! }))} />
              <TabTable
                title={t('analytics.table.couriers')}
                testId="tab-table"
                rows={d.couriers}
                rowKey={(r) => r.key}
                href={(r) => `/delivery?tab=all&provider=${r.provider}${r.courierAccountId ? `&courierAccountId=${r.courierAccountId}` : ''}&${range}`}
                columns={[
                  { key: 'name', header: t('analytics.col.courier'), cell: (r) => r.name },
                  { key: 'parcels', header: t('analytics.col.parcels'), align: 'end', cell: (r) => <Num>{n(r.parcels)}</Num> },
                  { key: 'delivered', header: t('analytics.col.deliveredPct'), align: 'end', cell: (r) => <Num>{fig(r.deliveredPct, 'pct')}</Num> },
                  { key: 'returned', header: t('analytics.col.returnedPct'), align: 'end', cell: (r) => <Num>{fig(r.returnedPct, 'pct')}</Num> },
                  { key: 'days', header: t('analytics.col.avgDays'), align: 'end', cell: (r) => <Num>{fig(r.avgDays, 'days')}</Num> },
                  { key: 'cod', header: t('analytics.col.cod'), align: 'end', cell: (r) => <Num>{n(r.codCollected)}</Num> },
                ]}
              />
            </ChartAndTable>
          </>
        );
      }}
    </TabFrame>
  );
}

export const DETAIL_TABS: Record<Exclude<AnalyticsTab, 'overview'>, () => ReactNode> = {
  conversations: ConversationsTab,
  responses: ResponsesTab,
  consumption: ConsumptionTab,
  agents: AgentsTab,
  channels: ChannelsTab,
  products: ProductsTab,
  orders: OrdersTab,
  delivery: DeliveryTab,
};
