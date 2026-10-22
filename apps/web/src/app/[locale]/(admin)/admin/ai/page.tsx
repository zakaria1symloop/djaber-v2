'use client';
// /admin/ai — Figma "ADM-06 — Platform admin — AI providers, routing & pricing calculator" + DLG "Clé fournisseur IA",
// "Modèle IA". Provider cards (ACTIF · PRINCIPAL / SECOURS / DÉSACTIVÉ, key tested, health with threshold ⚠, bascule),
// routing per capability (OK / BASCULE ACTIVE), credit pricing calculator (simulate) + new pricing version.
import type { AiModelAdminDto, AiPricingDto, AiPricingSimulateInput, AiPricingSimulationDto, AiProviderAdminDto, AiProviderTestDto, AiRouteDto } from '@djaber/shared';
import { ActionsMenu, AdminCard, Button, Card, DataTable, Field, FrameNote, Input, ListSkeleton, MonoChip, OpsKpiTile, OpsPanel, Skeleton, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { ModelDialog, PricingVersionDialog, ProviderKeyDialog, RouteDialog, testFailureOf } from '@/features/admin/ai/dialogs';
import { adminWrite, useAdminGet, useAdminInvalidate } from '@/features/admin/api';
import { usePlatform } from '@/features/admin/platform';
import { useFormats } from '@/features/admin/ui';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';

// as many provider cards per row as fit (≥ 260 px each): 3 or 4 providers sit on one row from 1280 px, no orphan card
const PROVIDER_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]';

const fmtDec =(n: number, locale: string, digits = 2) => n.toLocaleString(locale === 'en' ? 'en-US' : 'fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/\s/g, ' ');

export default function AdminAiPage() {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const write = can('admin.ai.write');
  const providers = useAdminGet<AiProviderAdminDto[]>('/admin/ai-providers');
  const routes = useAdminGet<AiRouteDto[]>('/admin/ai-routes');
  const models = useAdminGet<AiModelAdminDto[]>('/admin/ai-models');
  const pricing = useAdminGet<AiPricingDto>('/admin/ai-pricing');
  const invalidate = useAdminInvalidate();
  const [keyDlg, setKeyDlg] = useState<{ provider: AiProviderAdminDto | null } | null>(null);
  const [modelDlg, setModelDlg] = useState<{ model: AiModelAdminDto | null } | null>(null);
  const [routeDlg, setRouteDlg] = useState<AiRouteDto | null>(null);
  const confirm = useConfirmAction();
  const patch = useMutation({ mutationFn: (b: { key: string; body: unknown }) => adminWrite(`/admin/ai-providers/${b.key}`, 'PATCH', b.body) });
  const testOne = useMutation({ mutationFn: (key: string) => adminWrite<AiProviderTestDto>(`/admin/ai-providers/${key}/test`, 'POST', {}) });
  const putRoute = useMutation({ mutationFn: (b: { cap: string; body: unknown }) => adminWrite(`/admin/ai-routes/${b.cap}`, 'PUT', b.body) });

  const toggle = async (p: AiProviderAdminDto) => {
    try {
      await patch.mutateAsync({ key: p.key, body: { isActive: !p.isActive } });
      void invalidate('/admin/ai-providers', '/admin/ai-routes');
      toast(p.isActive ? t('admin.ai.provider.disabled', { name: p.displayName }) : t('admin.ai.provider.enabled', { name: p.displayName }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const testAll = async () => {
    const list = (providers.data ?? []).filter((p) => p.keyHint);
    for (const p of list) {
      try {
        const r = await testOne.mutateAsync(p.key);
        toast(r.missingModels?.length ? { tone: 'warning', message: `${t('admin.ai.provider.testOk', { name: p.displayName, ms: r.latencyMs })} ${t('admin.ai.key.missingModels', { models: r.missingModels.join(', ') })}` } : t('admin.ai.provider.testOk', { name: p.displayName, ms: r.latencyMs }));
      } catch (e) {
        // the reason (timeout, network, endpoint, quota, provider down…) rather than the code alone (UX-013)
        const f = testFailureOf(e);
        const why = f.reason && t.has(`admin.ai.key.reason.${f.reason}`) ? t(`admin.ai.key.reason.${f.reason}`, { status: f.status ?? '' }) : null;
        toast({ tone: 'danger', message: `${p.displayName} · ${errorMessage(e, t)}${why ? ` — ${why}` : ''}` });
      }
    }
    void invalidate('/admin/ai-providers');
  };
  const failover = async (r: AiRouteDto, on: boolean) => {
    const idOf = (m: string | undefined) => (models.data ?? []).find((x) => x.modelId === m)?.id;
    const primaryModelId = idOf(r.primary.modelId);
    if (!primaryModelId) return;
    try {
      await putRoute.mutateAsync({ cap: r.capability, body: { primaryModelId, fallbackModelId: idOf(r.fallback?.modelId) ?? null, creditCost: r.credits, timeoutSec: r.timeoutSec, errorThresholdPct: r.errorThresholdPct, failoverActive: on } });
      void invalidate('/admin/ai-routes', '/admin/ai-providers');
      toast(on ? t('admin.ai.route.failoverOn') : t('admin.ai.route.failoverOff'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const pill = (p: AiProviderAdminDto) =>
    p.state === 'disabled' ? <MonoChip>{t('admin.ai.state.disabled')}</MonoChip> : <MonoChip tone={p.state === 'primary' ? 'success' : 'info'}>{t(`admin.ai.state.${p.state}`)}</MonoChip>;
  const health = (p: AiProviderAdminDto) => {
    const h = p.health;
    if (!p.isActive || h.errorRatePct === null) return { value: '—' };
    const over = h.errorRatePct > h.thresholdPct;
    return {
      value: over ? t('admin.ai.health.over', { pct: fmtDec(h.errorRatePct, f.locale, 1), threshold: h.thresholdPct, failover: h.failoverActive ? t('admin.ai.health.failover') : '' }).trim() : t('admin.ai.health.ok', { pct: fmtDec(h.errorRatePct, f.locale, 1) }),
      tone: over ? ('warning' as const) : undefined,
    };
  };
  const routeColumns: Column<AiRouteDto>[] = [
    { key: 'cap', header: t('admin.ai.col.capability'), hideable: false, cell: (r) => t(`admin.ai.capLong.${r.capability}`) },
    { key: 'primary', header: t('admin.ai.col.primary'), cell: (r) => `${r.primary.provider} · ${r.primary.label}` },
    { key: 'fallback', header: t('admin.ai.col.fallback', { sec: r0(routes.data)?.timeoutSec ?? 20 }), cell: (r) => (r.fallback ? `${r.fallback.provider} · ${r.fallback.label}` : t('admin.ai.noFallback')) },
    { key: 'cost', header: t('admin.ai.col.cost'), hideBelow: 'lg', cell: (r) => <span dir="ltr">{fmtDec(r.realCostUsdPer1k, 'en', 5)} $</span> },
    { key: 'credits', header: t('admin.ai.col.credits'), cell: (r) => (r.credits ? t(`admin.ai.creditsUnit.${r.capability}`, { count: r.credits }) : t('admin.ai.included')) },
    { key: 'margin', header: t('admin.ai.col.margin'), hideBelow: 'lg', cell: (r) => (r.marginPct === null ? '—' : `${r.marginPct} %`) },
    { key: 'state', header: t('admin.ai.col.state'), cell: (r) => (r.state === 'failover' ? <MonoChip tone="warning">{t('admin.ai.route.failoverState', { since: r.failoverSince ? f.ago(r.failoverSince) : '' })}</MonoChip> : r.state === 'degraded' ? <MonoChip tone="warning">{t('admin.ai.route.degraded')}</MonoChip> : <MonoChip tone="success">OK</MonoChip>) },
  ];
  const routeMenu = (r: AiRouteDto) =>
    write ? (
      <ActionsMenu
        label={t('action.actions')}
        heading={t(`admin.ai.capLong.${r.capability}`)}
        actions={[
          { key: 'edit', label: t('admin.ai.route.edit'), onSelect: () => setRouteDlg(r) },
          r.state === 'failover' ? { key: 'clear', label: t('admin.ai.route.clear'), onSelect: () => void failover(r, false) } : { key: 'force', label: t('admin.ai.route.force'), onSelect: () => void failover(r, true), disabledReason: r.fallback ? undefined : t('admin.ai.noFallback') },
        ]}
      />
    ) : null;

  return (
    <AdminPage
      permission="admin.ai.read"
      title={t('admin.ai.title')}
      description={t('admin.ai.description')}
      actions={
        write ? (
          <>
            <Button onClick={() => void testAll()} loading={testOne.isPending} data-testid="test-keys">
              {t('admin.ai.testKeys')}
            </Button>
            <Button variant="primary" onClick={() => setKeyDlg({ provider: null })}>
              {t('admin.ai.addProvider')}
            </Button>
          </>
        ) : null
      }
    >
      {providers.isPending ? (
        // card-shaped placeholders of the provider cards' height: the routing table below does not jump on load
        <div role="status" aria-label={t('common.loading')} className={PROVIDER_GRID}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[296px] rounded-card" />
          ))}
        </div>
      ) : providers.isError ? (
        <AdminQueryError error={providers.error} onRetry={() => void providers.refetch()} />
      ) : (
        <div className={PROVIDER_GRID} data-testid="provider-cards">
          {providers.data.map((p) => {
            const h = health(p);
            return (
              <AdminCard
                key={p.key}
                data-provider={p.key}
                title={p.displayName}
                muted={!p.isActive}
                pills={pill(p)}
                rows={[
                  { label: t('admin.ai.card.key'), value: p.keyHint ? [p.keyHint, p.keyAddedAt ? t('admin.ai.card.added', { date: f.short(p.keyAddedAt) }) : null, p.lastTestedAt ? `${t('admin.ai.card.tested', { ago: f.ago(p.lastTestedAt) })} ${p.lastTestOk ? '✓' : '✗'}` : null].filter(Boolean).join(' · ') : t('admin.ai.card.noKey') },
                  {
                    label: t('admin.ai.card.models'),
                    value: p.models.length ? (
                      <span className="flex flex-wrap gap-x-1">
                        {p.models.map((m, i) => (
                          <button key={m.id} type="button" disabled={!write} className="text-start hover:underline disabled:no-underline" onClick={() => setModelDlg({ model: (models.data ?? []).find((x) => x.id === m.id) ?? null })}>
                            {m.displayName} ({m.capabilities.map((c) => t(`admin.ai.cap.${c}`)).join(', ')}){i < p.models.length - 1 ? ' ·' : ''}
                          </button>
                        ))}
                      </span>
                    ) : (
                      '—'
                    ),
                  },
                  { label: t('admin.ai.card.health'), value: h.value, tone: h.tone },
                ]}
                actions={
                  write ? (
                    <>
                      <Button size="sm" onClick={() => setKeyDlg({ provider: p })}>
                        {t('admin.ai.card.replaceKey')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        // disabling a provider moves every route using it to its fallback: confirmed first
                        onClick={() => (p.isActive ? confirm.ask({ title: t('admin.ai.disableConfirm.title', { name: p.displayName }), description: t('admin.ai.disableConfirm.description'), confirmLabel: t('admin.ai.card.disable'), destructive: true, run: () => toggle(p) }) : void toggle(p))}
                        disabled={patch.isPending}
                      >
                        {p.isActive ? t('admin.ai.card.disable') : t('admin.ai.card.enable')}
                      </Button>
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="ts-label-micro uppercase text-text-muted">{t('admin.ai.routing.label')}</div>
        {write ? (
          <Button size="sm" variant="ghost" onClick={() => setModelDlg({ model: null })}>
            {t('admin.ai.model.add')}
          </Button>
        ) : null}
      </div>
      {routes.isPending ? (
        <Card><ListSkeleton rows={4} columns={6} label={t('common.loading')} /></Card>
      ) : routes.isError ? (
        <AdminQueryError error={routes.error} onRetry={() => void routes.refetch()} />
      ) : (
        <DataTable<AiRouteDto> label={t('admin.ai.routing.label')} columns={routeColumns} rows={routes.data} rowKey={(r) => r.capability} actionsLabel={t('action.actions')} rowActions={write ? routeMenu : undefined} />
      )}
      <Calculator pricing={pricing} canWrite={write} />
      <ProviderKeyDialog providers={providers.data ?? []} initial={keyDlg?.provider ?? null} open={!!keyDlg} onClose={() => setKeyDlg(null)} />
      <ModelDialog model={modelDlg?.model ?? null} providers={providers.data ?? []} open={!!modelDlg} onClose={() => setModelDlg(null)} />
      <RouteDialog route={routeDlg} models={models.data ?? []} open={!!routeDlg} onClose={() => setRouteDlg(null)} />
      {confirm.element}
    </AdminPage>
  );
}

const r0 = (rows: AiRouteDto[] | undefined) => rows?.[0];

function Calculator({ pricing, canWrite }: { pricing: ReturnType<typeof useAdminGet<AiPricingDto>>; canWrite: boolean }) {
  const t = useT();
  const f = useFormats();
  const [form, setForm] = useState({ usdToDzd: '', creditPriceDzd: '', avgTokensPerMessage: '', targetMarginPct: '' });
  const [sim, setSim] = useState<AiPricingSimulationDto | null>(null);
  const [version, setVersion] = useState(false);
  const simulate = useMutation({ mutationFn: (b: AiPricingSimulateInput) => adminWrite<AiPricingSimulationDto>('/admin/ai-pricing/simulate', 'POST', b) });
  const base = pricing.data?.simulation;
  useEffect(() => {
    if (!base) return;
    setForm({ usdToDzd: String(base.input.usdToDzd), creditPriceDzd: String(base.input.creditPriceDzd).replace('.', ','), avgTokensPerMessage: String(base.input.avgTokensPerMessage), targetMarginPct: String(base.input.targetMarginPct) });
    setSim(base);
  }, [base]);
  const dec = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));
  const input = (): AiPricingSimulateInput => ({ usdToDzd: dec(form.usdToDzd), creditPriceDzd: dec(form.creditPriceDzd), avgTokensPerMessage: Math.trunc(dec(form.avgTokensPerMessage)), targetMarginPct: Math.trunc(dec(form.targetMarginPct)), ...(sim ? { costs: sim.input.costs } : {}) });
  const run = async () => {
    try {
      setSim(await simulate.mutateAsync(input()));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.,\s]/g, '') }));
  const text = sim?.rows.find((r) => r.capability === 'text');
  const tile = (cap: 'text' | 'vision' | 'transcription') => {
    const r = sim?.rows.find((x) => x.capability === cap);
    if (!r) return <OpsKpiTile value="—" />;
    return (
      <OpsKpiTile
        data-sim={cap}
        context={t(`admin.ai.calc.ctx.${cap}`, { credits: r.credits, revenue: fmtDec(r.revenueDzd, f.locale), margin: r.marginPct, warn: r.belowTarget ? t('admin.ai.calc.below') : '' })}
        value={`${fmtDec(r.realCostDzd, f.locale)} DA`}
        unit={t(`admin.ai.calc.unit.${cap}`)}
        tone={r.belowTarget ? 'warning' : undefined}
      />
    );
  };
  return (
    <OpsPanel title={t('admin.ai.calc.title')} data-testid="pricing-calculator">
      {pricing.isPending ? (
        <ListSkeleton rows={2} columns={4} label={t('common.loading')} />
      ) : pricing.isError ? (
        <AdminQueryError error={pricing.error} onRetry={() => void pricing.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t('admin.ai.calc.rate')} htmlFor="c-rate">
              <Input id="c-rate" inputMode="decimal" dir="ltr" value={form.usdToDzd} onChange={set('usdToDzd')} />
            </Field>
            <Field label={t('admin.ai.calc.price')} htmlFor="c-price" hint={typeof sim?.impliedCreditPriceDzd === 'number' ? t('admin.ai.calc.implied', { price: fmtDec(sim.impliedCreditPriceDzd, f.locale) }) : undefined}>
              <Input id="c-price" inputMode="decimal" dir="ltr" value={form.creditPriceDzd} onChange={set('creditPriceDzd')} />
            </Field>
            <Field label={t('admin.ai.calc.tokens')} htmlFor="c-tokens">
              <Input id="c-tokens" inputMode="numeric" dir="ltr" value={form.avgTokensPerMessage} onChange={set('avgTokensPerMessage')} />
            </Field>
            <Field label={t('admin.ai.calc.margin')} htmlFor="c-margin">
              <Input id="c-margin" inputMode="numeric" dir="ltr" value={form.targetMarginPct} onChange={set('targetMarginPct')} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {tile('text')}
            {tile('vision')}
            {tile('transcription')}
            <OpsKpiTile data-sim="recommendation" context={sim ? t('admin.ai.calc.ctx.reco', { price: fmtDec(sim.creditPriceForTargetDzd, f.locale), margin: form.targetMarginPct }) : undefined} value={text ? t('admin.ai.calc.recoValue', { count: text.recommendedCredits }) : '—'} unit={t('admin.ai.calc.unit.reco')} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FrameNote className="min-w-0 flex-1">{t('admin.ai.calc.note')}</FrameNote>
            <Button onClick={() => void run()} loading={simulate.isPending} data-testid="simulate">
              {t('admin.ai.calc.simulate')}
            </Button>
            {canWrite && sim ? (
              <Button variant="primary" onClick={() => setVersion(true)}>
                {t('admin.ai.pricing.versionCta')}
              </Button>
            ) : null}
          </div>
          {sim ? <PricingVersionDialog input={{ ...input(), costs: sim.input.costs }} open={version} onClose={() => setVersion(false)} /> : null}
        </div>
      )}
    </OpsPanel>
  );
}
