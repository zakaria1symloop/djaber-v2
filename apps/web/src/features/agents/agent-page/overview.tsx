'use client';
// /agents/[id] — Figma "AGT-03 — Agent page — overview (tabs, versions, rollback)": KPI tiles for a period, the
// configuration summary with "Modifier (étape n) ›", and the versions list (ACTUELLE, Diff, Restaurer) with the preset
// update notice. Every save of the agent creates an `AgentVersion`; a restore creates a new one.
import { Button, Card, ConfirmDialog, DiffList, FormAlert, KpiTile, Ltr, SegmentedControl, Skeleton, toast, VersionTimeline } from '@djaber/ui';
import { formatDateTime, formatMoney, formatNumber, TIMEZONE, type AppLocale } from '@djaber/shared';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { QueryError } from '@/components/global-states';
import { versionNote } from '../version-note';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { agentKeys, agentsApi, useAgentMetrics, useAgentsRefresh, useAgentVersions } from '../api';
import type { Agent, AgentVersion } from '../contracts';
import { creditsPerConv, draftFromAgent, enabledCapabilities, enabledRuleCount, handledPct, policyCount, secondsLabel, type AgentDraft } from '../logic';
import { channelLabel } from '../ui';
import { diffFieldLabel, diffValue } from '../version-diff';
import { useAgentPage } from './agent-shell';

const PERIODS = ['7', '30', '90'] as const;
type PeriodDays = (typeof PERIODS)[number];
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** `from` / `to` (inclusive days of Africa/Algiers) of the last n days. */
export const lastDays = (days: number, now = new Date()): { from: string; to: string } => ({ from: dayOf(new Date(now.getTime() - (days - 1) * 86_400_000)), to: dayOf(now) });

/** One line per section of the configuration, as written in the summary card. */
export const summaryLines = (t: TFunction, a: Agent, d: AgentDraft): { identity: string; knowledge: string; behaviour: string; channels: string } => ({
  identity: [d.displayName.trim() || a.name, d.tone ? t(`agents.tone.${d.tone}`) : null, d.emojiLevel ? t(`agents.emoji.${d.emojiLevel}`) : null].filter(Boolean).join(' · '),
  knowledge: [
    d.catalogScope === 'all' ? t('agents.summary.catalogAll', { count: a.productCount }) : t('agents.summary.catalogCategories', { count: d.scopeCategoryIds.length }),
    t('agents.summary.rules', { count: policyCount(d) }),
    t('agents.summary.faq', { count: a.wizard?.faqCount ?? 0 }),
  ].join(' · '),
  behaviour: [
    enabledCapabilities(d)
      .map((c) => t(`agents.capability.short.${c}`))
      .join(' · '),
    d.maxQtyPerOrder || d.maxAmountPerOrder ? t('agents.summary.limits', { qty: d.maxQtyPerOrder ?? '∞', amount: d.maxAmountPerOrder ? formatMoney(d.maxAmountPerOrder) : '∞' }) : null,
    t('agents.summary.handoffRules', { count: enabledRuleCount(d) }),
  ]
    .filter(Boolean)
    .join(' · '),
  channels: a.channels.map(channelLabel).join(' · '),
});

export function AgentOverview() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { agent: a, actions } = useAgentPage();
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const period: PeriodDays = (PERIODS as readonly string[]).includes(params.get('period') ?? '') ? (params.get('period') as PeriodDays) : '30';
  const setPeriod = (p: PeriodDays) => {
    const next = new URLSearchParams(params.toString());
    if (p === '30') next.delete('period');
    else next.set('period', p);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  const metricsQ = useAgentMetrics(a.id, lastDays(Number(period)), period !== '30');
  const m = period === '30' ? a.metrics30d : metricsQ.data;
  const extra = period === '30' ? null : (metricsQ.data ?? null);
  const draft = draftFromAgent(a);
  const lines = summaryLines(t, a, draft);
  const base = `/agents/${a.id}/configuration`;
  const pct = m ? handledPct(m) : null;
  const perConv = m ? creditsPerConv(m) : null;

  const rows: { key: string; label: string; value: string; href: string; link: string; external?: boolean }[] = [
    { key: 'identity', label: t('agents.wizard.step.identity'), value: lines.identity, href: `${base}?section=identity`, link: t('agents.overview.editStep', { step: 1 }) },
    { key: 'knowledge', label: t('agents.wizard.step.knowledge'), value: lines.knowledge, href: `${base}?section=knowledge`, link: t('agents.overview.editStep', { step: 2 }) },
    { key: 'behaviour', label: t('agents.wizard.step.behaviour'), value: lines.behaviour, href: `${base}?section=behaviour`, link: t('agents.overview.editStep', { step: 3 }) },
    { key: 'channels', label: t('agents.wizard.step.channels'), value: lines.channels || t('agents.card.noChannel.label'), href: `${base}?section=channels`, link: t('agents.overview.editStep', { step: 4 }) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl label={t('agents.overview.period')} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t('agents.overview.days', { count: Number(p) }) }))} />
        {a.lastActiveAt ? <span className="ts-label-meta text-text-muted">{t('agents.overview.lastActive', { date: formatDateTime(a.lastActiveAt, locale) })}</span> : null}
      </div>
      {metricsQ.isError && period !== '30' ? (
        <QueryError error={metricsQ.error} onRetry={() => metricsQ.refetch()} />
      ) : !m ? (
        <div role="status" aria-label={t('common.loading')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="agent-kpis">
          <KpiTile data-kpi="conversations" value={formatNumber(m.conversations)} label={t('agents.kpi.conversations', { days: Number(period) })} meta={extra ? t('agents.kpi.aiMessages', { count: formatNumber(extra.aiMessages) }) : undefined} />
          <KpiTile data-kpi="handled" value={pct === null ? '—' : `${pct} %`} label={t('agents.kpi.handled')} meta={extra ? t('agents.kpi.handoffs', { count: formatNumber(extra.handoffs) }) : t('agents.kpi.handledCount', { count: formatNumber(m.handledWithoutHuman) })} />
          <KpiTile data-kpi="orders" value={formatNumber(m.orders)} label={t('agents.kpi.orders')} meta={t('agents.kpi.ordersMeta', { confirmed: m.confirmedPct, delivered: formatNumber(m.delivered) })} />
          <KpiTile data-kpi="latency" value={secondsLabel(m.avgLatencyMs, locale)} label={t('agents.kpi.latency')} meta={t('agents.kpi.p95', { value: secondsLabel(m.p95LatencyMs, locale) })} />
          <KpiTile data-kpi="credits" value={formatNumber(m.credits)} label={t('agents.kpi.credits')} meta={perConv === null ? undefined : t('agents.kpi.perConv', { value: locale === 'en' ? String(perConv) : String(perConv).replace('.', ',') })} />
          {m.satisfaction ? <KpiTile data-kpi="satisfaction" value={`${Math.round(m.satisfaction.score * 100)} %`} label={t('agents.kpi.satisfaction')} meta={t('agents.kpi.votes', { count: m.satisfaction.votes })} /> : null}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card data-testid="agent-summary">
          <h2 className="ts-title border-b border-line-hairline px-4 py-3">{t('agents.overview.config')}</h2>
          <dl className="divide-y divide-line-hairline">
            {rows.map((r) => (
              <div key={r.key} data-row={r.key} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
                <dt className="ts-label-meta text-text-muted">{r.label}</dt>
                <dd className="min-w-0 text-[13px]">{r.value}</dd>
                {/* a <dl> group holds only <dt> / <dd> (axe definition-list): the link is a second <dd> */}
                <dd>
                  {actions.manage ? (
                    <Link href={r.href} className="ts-label-meta text-accent-inbound hover:underline">
                      {r.link}
                    </Link>
                  ) : null}
                </dd>
              </div>
            ))}
            <div data-row="system" className="grid items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
              <dt className="ts-label-meta text-text-muted">{t('agents.overview.system')}</dt>
              <dd className="min-w-0 text-[13px]">{t('agents.overview.systemValue')}</dd>
              <dd>
                {can('workspace.settings') ? (
                  <Link href="/settings/system-messages" className="ts-label-meta text-accent-inbound hover:underline">
                    {t('action.openArrow')}
                  </Link>
                ) : null}
              </dd>
            </div>
          </dl>
        </Card>
        <Versions agent={a} />
      </div>
    </div>
  );
}


function Versions({ agent: a }: { agent: Agent }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const { can } = useSession();
  const manage = can('agents.manage');
  const q = useAgentVersions(a.id);
  const refresh = useAgentsRefresh();
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const [restore, setRestore] = useState<AgentVersion | null>(null);
  const [preset, setPreset] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diff = useQuery({
    queryKey: agentKeys.sub(ws, a.id, 'diff', [diffOf, a.currentVersion]),
    queryFn: () => agentsApi.versionDiff(a.id, diffOf!, diffOf === a.currentVersion ? Math.max(1, a.currentVersion - 1) : a.currentVersion),
    enabled: !!ws && diffOf !== null,
    retry: false,
  });

  const run = async (fn: () => Promise<Agent>, done: (next: Agent) => string) => {
    setPending(true);
    setError(null);
    try {
      const next = await fn();
      await refresh(a.id);
      toast(done(next));
      setRestore(null);
      setPreset(false);
      setDiffOf(null);
    } catch (e) {
      setError(errorMessage(e, t));
      if ((e as { code?: string }).code === 'AGENT_VERSION_NOT_FOUND') void q.refetch();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card data-testid="agent-versions">
      <h2 className="ts-title border-b border-line-hairline px-4 py-3">{t('agents.versions.title')}</h2>
      {q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      ) : q.isError ? (
        <div className="p-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-text-muted">{t('agents.versions.empty')}</p>
      ) : (
        <VersionTimeline
          label={t('agents.versions.title')}
          items={q.data.map((v) => ({
            version: v.version,
            current: v.isCurrent,
            currentLabel: t('agents.versions.current'),
            meta: `${formatDateTime(v.createdAt, locale)} · ${v.createdBy ? `${v.createdBy.firstName} ${v.createdBy.lastName.slice(0, 1)}.` : '—'}`,
            note: versionNote(t, v, a.preset),
            actions: (
              <>
                {manage && !v.isCurrent ? (
                  <Button size="sm" variant="ghost" onClick={() => (setError(null), setRestore(v))} data-testid="version-restore">
                    {t('action.restore')}
                  </Button>
                ) : null}
                {v.version > 1 || !v.isCurrent ? (
                  <Button size="sm" variant="ghost" aria-expanded={diffOf === v.version} onClick={() => setDiffOf((cur) => (cur === v.version ? null : v.version))} data-testid="version-diff">
                    {t('agents.versions.diff')}
                  </Button>
                ) : null}
              </>
            ),
            detail:
              diffOf === v.version ? (
                <div className="mt-3">
                  {diff.isPending ? (
                    <Skeleton className="h-10" />
                  ) : diff.isError ? (
                    <FormAlert>{errorMessage(diff.error, t)}</FormAlert>
                  ) : (
                    <>
                      <p className="ts-label-micro mb-2 text-text-muted">
                        <Ltr>{t('agents.versions.compare', { version: diff.data.version, against: diff.data.against })}</Ltr>
                      </p>
                      <DiffList empty={t('agents.versions.noChange')} rows={diff.data.changes.map((c) => ({ key: c.field, label: diffFieldLabel(t, c.field), before: diffValue(t, c.field, c.before), after: diffValue(t, c.field, c.after) }))} />
                    </>
                  )}
                </div>
              ) : null,
          }))}
        />
      )}
      {a.preset?.updateAvailable ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-hairline px-4 py-3 ts-label-meta text-accent-starred" data-testid="preset-update">
          <span className="min-w-0 flex-1">
            <Ltr>{t('agents.preset.update', { name: a.preset.name, version: a.preset.updateAvailable })}</Ltr>
          </span>
          {manage ? (
            <Button size="sm" onClick={() => (setError(null), setPreset(true))}>
              {t('agents.preset.apply', { version: a.currentVersion + 1 })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={restore !== null}
        onOpenChange={(o) => !o && !pending && setRestore(null)}
        title={t('agents.versions.restore.title', { version: restore?.version ?? 0 })}
        description={t('agents.versions.restore.description', { next: a.currentVersion + 1 })}
        confirmLabel={t('action.restore')}
        cancelLabel={t('action.cancel')}
        loading={pending}
        closeLabel={t('action.close')}
        onConfirm={() => restore && void run(() => agentsApi.restoreVersion(a.id, restore.version), (next) => t('agents.versions.restored', { version: next.currentVersion }))}
      >
        {error ? <FormAlert>{error}</FormAlert> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={preset}
        onOpenChange={(o) => !o && !pending && setPreset(false)}
        title={t('agents.preset.confirm.title', { name: a.preset?.name ?? '' })}
        description={t('agents.preset.confirm.description', { next: a.currentVersion + 1 })}
        confirmLabel={t('action.apply')}
        cancelLabel={t('action.cancel')}
        loading={pending}
        closeLabel={t('action.close')}
        onConfirm={() => a.preset?.updateAvailable && void run(() => agentsApi.applyPresetUpdate(a.id, a.preset!.updateAvailable!), (next) => t('agents.versions.created', { version: next.currentVersion }))}
      >
        {error ? <FormAlert>{error}</FormAlert> : null}
      </ConfirmDialog>
    </Card>
  );
}
