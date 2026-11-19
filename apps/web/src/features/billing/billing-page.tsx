'use client';
// /settings/billing — Figma "BIL-01 — Settings — Plan & billing" (+ "BIL-04 / BIL-03 — … Invoices", "DLG — Settings &
// billing" Changer de plan / promo, "GLOBAL — Plan expired — free limits applied"). 02-next-route-map §3.4:
// `billing.read` (Owner + Admin; Operators get the 403 state); plan change / cancel / billing info `billing.plan` (Owner,
// Admin sees them greyed with the reason); pay invoice `billing.write`. Cycle (`?cycle=`), the change dialog
// (`?change=<planSlug>`) and the invoice filters / page live in the URL.
import { formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import { Banner, Button, CreditsPill, PlanCard, PlanCardsSkeleton, SectionLabel, SegmentedControl, Skeleton, toast, UsageTile, type CreditsLevel } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { useCredits } from '@/features/credits/api';
import { levelOf } from '@/features/credits/logic';
import { CalculatorDialog } from '@/features/credits/calculator-dialog';
import { SettingsPage } from '@/features/settings/common';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { usePlans, useSubscription } from './api';
import { CancelDialog, ChangePlanDialog, UndoCancelButton } from './billing-dialogs';
import type { Cycle, Plan, Subscription } from './contracts';
import { InvoicesCard, usePayInvoice } from './invoices';
import { bestYearlyDiscount, cyclePrice, daysLeft, deepLinkAction, defaultCycle, isFreePlan, isPaidSubscription, monthlyEquivalent, parseCycle, planBanner, planCta, type PlanCta } from './logic';
import { RecentLedger } from './recent-ledger';

export function BillingPage() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const sub = useSubscription();
  const s = sub.data;
  return (
    <SettingsPage title={t('nav.settings.billing')} description={s ? describe(s, t, locale) : undefined} permission="billing.read">
      {sub.isPending ? (
        <BillingSkeleton />
      ) : sub.isError ? (
        <QueryError error={sub.error} onRetry={() => sub.refetch()} />
      ) : (
        <BillingBody sub={s!} />
      )}
    </SettingsPage>
  );
}
/** "Plan Pro · renouvellement le 12 nov. 2026 · paiement via Chargily (Edahabia, CIB)" and its variants. */
export function describe(s: Subscription, t: TFunction, locale: AppLocale): string {
  const date = formatDate(s.currentPeriodEnd, locale);
  if (s.status === 'trial') return t('billing.description.trial', { plan: s.plan.name, date: formatDate(s.trialEndsAt ?? s.currentPeriodEnd, locale) });
  if (s.status === 'expired' || isFreePlan(s.plan)) return t('billing.description.free', { credits: formatNumber(s.plan.limits.monthlyCredits), creditsN: s.plan.limits.monthlyCredits });
  if (s.cancelAtPeriodEnd) return t('billing.description.cancelling', { plan: s.plan.name, date });
  return t(s.provider === 'manual' ? 'billing.description.manual' : 'billing.description.paid', { plan: s.plan.name, date });
}

function BillingSkeleton() {
  const t = useT();
  return (
    <div className="flex flex-col gap-5" role="status" aria-label={t('common.loading')}>
      <PlanCardsSkeleton label={t('common.loading')} />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[74px]" />
        ))}
      </div>
    </div>
  );
}

function BillingBody({ sub }: { sub: Subscription }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { can } = useSession();
  const plans = usePlans();
  const yearlyPct = bestYearlyDiscount(plans.data ?? []);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cycle: Cycle = parseCycle(params.get('cycle')) ?? defaultCycle(sub);
  const changeSlug = params.get('change');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const owner = can('billing.plan');
  const pay = usePayInvoice();

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const linked = useMemo(() => (changeSlug ? (plans.data ?? []).find((p) => p.slug === changeSlug) ?? null : null), [changeSlug, plans.data]);
  // journey J12r-1: the deep link follows the card — a greyed card opens nothing and says its reason; the free card of a paid
  // plan opens the cancel dialog; only a real change opens the change-plan dialog (it opened « Payer 0 DA » for the free plan)
  const linkedCta = linked ? planCta(linked, sub, cycle) : null;
  const linkAction = linkedCta ? deepLinkAction(linkedCta) : null;
  const target = linkAction === 'dialog' ? linked : null;
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!changeSlug) handledLink.current = null;
    if (!linked || !linkedCta || linkAction === 'dialog' || handledLink.current === changeSlug) return;
    handledLink.current = changeSlug;
    setParams({ change: null });
    if (linkAction === 'cancel') setCancelOpen(true);
    // a reason, not a success: neutral tone, read for 8 s (the page is still loading around it)
    else toast({ tone: 'info', message: ctaReason(t, linkedCta, linked, sub, locale), durationMs: 8_000 });
  }, [changeSlug, linked, linkedCta, linkAction, setParams, sub, t, locale]);

  const banner = planBanner({
    status: sub.status,
    periodEnd: sub.currentPeriodEnd,
    trialEndsAt: sub.trialEndsAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    dunningStage: sub.dunningStage,
    expired: sub.expiredFrom ? { at: sub.expiredFrom.at, planName: sub.expiredFrom.planName } : null,
    free: isFreePlan(sub.plan) && sub.status !== 'trial',
  });
  const scrollToPlans = () => document.getElementById('billing-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const renew = () => setParams({ change: sub.plan.slug, cycle: sub.billingCycle === 'yearly' ? 'yearly' : 'monthly' });
  const free = (plans.data ?? []).find((p) => isFreePlan(p));
  const pausedChannels = sub.pausedResources.filter((r) => r.type === 'channel').length;
  const pausedAgents = sub.pausedResources.filter((r) => r.type === 'agent').length;

  return (
    <>
      {banner === 'planExpired' ? (
        <Banner tone="warning" action={{ label: t('action.choosePlan'), onClick: scrollToPlans }}>
          <span data-testid="billing-banner" data-banner="planExpired">
            {t('banner.planExpired', { date: formatDate(sub.expiredFrom?.at ?? sub.currentPeriodEnd, locale), pages: free?.limits.maxPages ?? sub.plan.limits.maxPages, agents: free?.limits.maxAgents ?? sub.plan.limits.maxAgents })}
            {pausedChannels || pausedAgents ? ` ${t('billing.paused.summary', { pages: pausedChannels, agents: pausedAgents })}` : ''}
          </span>
        </Banner>
      ) : banner === 'dunning' ? (
        <Banner
          tone="danger"
          action={
            sub.unpaidInvoice && can('billing.write')
              ? { label: t('billing.invoices.payNow'), onClick: () => void pay.run(sub.unpaidInvoice!.id), disabled: !!pay.pending }
              : { label: t('billing.invoices.see'), onClick: () => document.getElementById('billing-invoices')?.scrollIntoView({ behavior: 'smooth' }) }
          }
        >
          <span data-testid="billing-banner" data-banner="dunning" data-stage={sub.dunningStage ?? ''}>
            {t('billing.banner.dunning', {
              number: sub.unpaidInvoice?.number ?? '—',
              amount: formatNumber(sub.unpaidInvoice?.remaining ?? sub.unpaidInvoice?.amount ?? 0),
              plan: sub.plan.name,
              date: formatDate(new Date(Date.parse(sub.currentPeriodEnd) + 7 * 86_400_000).toISOString(), locale),
            })}
          </span>
        </Banner>
      ) : banner === 'planExpiring' ? (
        <Banner tone="warning" action={owner ? (sub.status === 'trial' ? { label: t('action.choosePlan'), onClick: scrollToPlans } : { label: t('action.renew'), onClick: renew }) : undefined}>
          <span data-testid="billing-banner" data-banner="planExpiring">
            {t('banner.planExpiring', {
              plan: sub.plan.name,
              days: daysLeft(sub.status === 'trial' ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : sub.currentPeriodEnd),
              date: formatDate(sub.status === 'trial' ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : sub.currentPeriodEnd, locale),
              pages: sub.usage.pages,
              agents: sub.usage.agents,
            })}
          </span>
        </Banner>
      ) : null}

      {/* PLANS */}
      <section id="billing-plans" aria-labelledby="billing-plans-title" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel id="billing-plans-title">{t('billing.plans.title')}</SectionLabel>
          <SegmentedControl<Cycle>
            label={t('billing.cycle.label')}
            value={cycle}
            onChange={(v) => setParams({ cycle: v === defaultCycle(sub) ? null : v })}
            options={[
              { value: 'monthly', label: t('billing.cycle.monthly') },
              { value: 'yearly', label: yearlyPct > 0 ? t('billing.cycle.yearlyDiscount', { pct: yearlyPct }) : t('billing.cycle.yearly') },
            ]}
          />
        </div>
        {plans.isPending ? (
          <PlanCardsSkeleton label={t('common.loading')} />
        ) : plans.isError ? (
          <QueryError error={plans.error} onRetry={() => plans.refetch()} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3" data-testid="plan-cards">
            {plans.data.map((p) => (
              <PlanCardFor
                key={p.id}
                plan={p}
                sub={sub}
                cycle={cycle}
                owner={owner}
                onChange={() => setParams({ change: p.slug, cycle: cycle === defaultCycle(sub) ? null : cycle })}
                onCancel={() => setCancelOpen(true)}
              />
            ))}
          </div>
        )}
      </section>

      {/* UTILISATION DU PLAN */}
      <section aria-labelledby="billing-usage-title" className="flex flex-col gap-3">
        <SectionLabel id="billing-usage-title">{t('billing.usage.title', { plan: sub.plan.name })}</SectionLabel>
        <Usage sub={sub} />
        {sub.pausedResources.length ? <Paused sub={sub} /> : null}
      </section>

      {/* CRÉDITS */}
      <CreditsStrip onCalculator={() => setCalculator(true)} />

      {/* FACTURES */}
      <InvoicesCard owner={owner} />

      {/* Résilier */}
      {isPaidSubscription(sub) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-hairline pt-4" data-testid="billing-cancel">
          {sub.cancelAtPeriodEnd || sub.nextPlan ? (
            <>
              <p className="text-[13px] text-text-secondary">
                {sub.nextPlan && !sub.cancelAtPeriodEnd
                  ? t('billing.plan.note.scheduled', { plan: sub.nextPlan.name, date: formatDate(sub.nextPlan.at, locale) })
                  : t('billing.cancel.scheduled', { plan: sub.plan.name, date: formatDate(sub.currentPeriodEnd, locale) })}
              </p>
              <UndoCancelButton owner={owner} />
            </>
          ) : (
            <>
              <p className="text-[13px] text-text-secondary">{t('billing.cancel.footer', { plan: sub.plan.name, date: formatDate(sub.currentPeriodEnd, locale) })}</p>
              <Button className="border-accent-alert/60 text-accent-alert hover:border-accent-alert" onClick={() => setCancelOpen(true)} disabled={!owner} disabledReason={owner ? undefined : t('billing.ownerOnly')} data-testid="open-cancel">
                {t('billing.cancel.action')}
              </Button>
            </>
          )}
        </div>
      ) : null}

      <ChangePlanDialog open={!!target} plan={target} cycle={cycle} sub={sub} onClose={() => setParams({ change: null })} onCancelInstead={() => { setParams({ change: null }); setCancelOpen(true); }} />
      <CancelDialog open={cancelOpen} sub={sub} onClose={() => setCancelOpen(false)} />
      <CalculatorDialog open={calculator} onClose={() => setCalculator(false)} />
    </>
  );
}

/** Why a card offers no change (its greyed button, and a `?change=` deep link to it — journey J12r-1). */
function ctaReason(t: TFunction, cta: PlanCta, plan: Plan, sub: Subscription, locale: AppLocale): string {
  const free = isFreePlan(plan);
  if (cta.kind === 'renew_later') return t('billing.plan.renewLater', { date: formatDate(cta.from, locale) });
  if (cta.kind === 'resume') return t('billing.plan.note.cancelling', { date: formatDate(sub.currentPeriodEnd, locale) });
  if (sub.status === 'trial' && free) return t('billing.plan.freeAfterTrial', { date: formatDate(sub.trialEndsAt ?? sub.currentPeriodEnd, locale) });
  if (sub.cancelAtPeriodEnd && free) return t('billing.plan.note.cancelling', { date: formatDate(sub.currentPeriodEnd, locale) });
  return t('billing.plan.isCurrent');
}

/* ---------- one plan card ---------- */
function PlanCardFor({ plan, sub, cycle, owner, onChange, onCancel }: { plan: Plan; sub: Subscription; cycle: Cycle; owner: boolean; onChange: () => void; onCancel: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const cta = planCta(plan, sub, cycle);
  const current = sub.plan.id === plan.id && sub.status !== 'expired';
  const free = isFreePlan(plan);
  const badge = current ? (sub.status === 'trial' ? t('billing.plan.badge.trial') : t('billing.plan.badge.current')) : plan.isFeatured ? t('billing.plan.badge.featured') : undefined;
  const unit = free ? t('billing.plan.unit.monthly') : cycle === 'yearly' ? t('billing.plan.unit.yearly') : t('billing.plan.unit.monthly');
  const trialEnd = formatDate(sub.trialEndsAt ?? sub.currentPeriodEnd, locale);
  // journey J10-4: the greyed button of the free card says why (12 rule 7)
  const currentReason = cta.kind !== 'current' ? undefined : ctaReason(t, cta, plan, sub, locale);
  const note =
    free && !current && sub.status === 'trial'
      ? t('billing.plan.freeAfterTrial', { date: trialEnd })
      : current && sub.status === 'trial'
      ? t('billing.plan.note.trial', { date: trialEnd })
      : current && sub.cancelAtPeriodEnd
        ? t('billing.plan.note.cancelling', { date: formatDate(sub.currentPeriodEnd, locale) })
        : sub.nextPlan && sub.nextPlan.id === plan.id
          ? t('billing.plan.note.scheduled', { plan: plan.name, date: formatDate(sub.nextPlan.at, locale) })
          : !free && cycle === 'yearly'
            ? t('billing.plan.billedYearly', { amount: formatNumber(cyclePrice(plan, 'yearly')) })
            : undefined;
  return (
    <PlanCard
      data-testid="plan-card"
      data-plan={plan.slug}
      name={plan.name}
      price={formatNumber(monthlyEquivalent(plan, cycle))}
      unit={unit}
      description={plan.description || undefined}
      features={planFeatures(plan, t)}
      badge={badge}
      current={current}
      note={note}
      action={<PlanAction cta={cta} plan={plan} owner={owner} onChange={onChange} onCancel={onCancel} currentReason={currentReason} switchCycle={current && isPaidSubscription(sub) && sub.billingCycle !== cycle ? cycle : null} />}
    />
  );
}

function PlanAction({ cta, plan, owner, onChange, onCancel, switchCycle, currentReason }: { cta: PlanCta; plan: Plan; owner: boolean; onChange: () => void; onCancel: () => void; switchCycle?: Cycle | null; currentReason?: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ownerReason = owner ? undefined : t('billing.ownerOnly');
  const testid = `plan-cta-${plan.slug}`;
  switch (cta.kind) {
    case 'current':
      return (
        <Button className="w-full" disabled disabledReason={currentReason} data-testid={testid} data-cta="current">
          {isFreePlan(plan) ? t('billing.plan.cta.free') : t('billing.plan.cta.current')}
        </Button>
      );
    case 'cancel':
      return (
        <Button className="w-full" variant="primary" onClick={onCancel} disabled={!owner} disabledReason={ownerReason} data-testid={testid} data-cta="cancel">
          {t('billing.plan.cta.free')}
        </Button>
      );
    case 'renew':
      return (
        <Button className="w-full" onClick={onChange} disabled={!owner} disabledReason={ownerReason} data-testid={testid} data-cta="renew">
          {t('action.renew')}
        </Button>
      );
    case 'renew_later':
      return (
        <Button className="w-full" disabled disabledReason={ownerReason ?? t('billing.plan.renewLater', { date: formatDate(cta.from, locale) })} data-testid={testid} data-cta="renew_later">
          {t('action.renew')}
        </Button>
      );
    case 'resume':
      return <UndoCancelButton owner={owner} className="w-full" testid={testid} />;
    case 'change':
      return (
        <Button className="w-full" variant={cta.direction === 'downgrade' ? 'secondary' : 'primary'} onClick={onChange} disabled={!owner} disabledReason={ownerReason} data-testid={testid} data-cta={cta.direction}>
          {/* full-test 15/11 SETTINGS-15: the current plan in the other cycle reads « Passer à l'annuel / au mensuel » */}
          {switchCycle ? t(switchCycle === 'yearly' ? 'billing.plan.cta.toYearly' : 'billing.plan.cta.toMonthly') : t('action.upgrade', { plan: plan.name })}
        </Button>
      );
  }
}

/** "3 pages · 3 agents · 1 000 produits · 2 000 conversations / mois · 5 000 crédits / mois · 3 membres" (Figma order). */
export function planFeatures(p: Plan, t: TFunction): string[] {
  const l = p.limits;
  const line = (n: number, key: string) => (n < 0 ? t(`billing.plan.feature.${key}.unlimited`) : t(`billing.plan.feature.${key}`, { count: n, value: formatNumber(n) }));
  return [line(l.maxPages, 'pages'), line(l.maxAgents, 'agents'), line(l.maxProducts, 'products'), line(l.maxConversationsPerMonth, 'conversations'), line(l.monthlyCredits, 'credits'), line(l.maxMembers, 'members')];
}

/* ---------- usage ---------- */
function Usage({ sub }: { sub: Subscription }) {
  const t = useT();
  const l = sub.plan.limits;
  const u = sub.usage;
  const v = (used: number, limit: number) => (limit < 0 ? t('billing.usage.unlimited', { used: formatNumber(used) }) : t('billing.usage.value', { used: formatNumber(used), limit: formatNumber(limit) }));
  const tiles = [
    { key: 'pages', used: u.pages, limit: l.maxPages },
    { key: 'agents', used: u.agents, limit: l.maxAgents },
    { key: 'products', used: u.products, limit: l.maxProducts },
    { key: 'conversations', used: u.conversationsThisMonth, limit: l.maxConversationsPerMonth },
    { key: 'members', used: u.members, limit: l.maxMembers },
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5" data-testid="usage-tiles">
      {tiles.map((x) => (
        <UsageTile key={x.key} data-testid={`usage-${x.key}`} label={t(`billing.usage.${x.key}`)} used={x.used} limit={x.limit} valueLabel={v(x.used, x.limit)} />
      ))}
    </div>
  );
}

function Paused({ sub }: { sub: Subscription }) {
  const t = useT();
  const href = (r: Subscription['pausedResources'][number]) => (r.type === 'channel' ? `/channels/${r.id}` : r.type === 'agent' ? `/agents/${r.id}` : '/settings/members');
  return (
    <div className="flex flex-col gap-2 rounded-card border border-accent-starred/40 bg-ink-surface p-3" data-testid="paused-resources">
      <span className="ts-label-micro text-accent-starred">{t('billing.paused.title')}</span>
      <ul className="flex flex-wrap gap-2">
        {sub.pausedResources.map((r) => (
          <li key={`${r.type}-${r.id}`}>
            <Link href={href(r)} className="inline-flex items-center gap-1.5 rounded-full border border-line-edge px-2 py-0.5 text-[12px] text-text-secondary hover:text-text-primary">
              <span dir="auto">{r.name}</span>
              <span className="ts-label-micro text-text-muted">{t(`billing.paused.type.${r.type}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="ts-label-meta text-text-muted">{t('billing.paused.note')}</p>
    </div>
  );
}

/* ---------- credits strip (BIL-01 "CRÉDITS · PÉRIODE DU … AU …") ---------- */
function CreditsStrip({ onCalculator }: { onCalculator: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useCredits();
  const c = q.data;
  const level: CreditsLevel = c ? levelOf(c) : 'ok';
  return (
    <section aria-labelledby="billing-credits-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel id="billing-credits-title">{c ? t('billing.credits.title', { from: formatDate(c.plan.periodStart, locale), to: formatDate(c.plan.periodEnd, locale) }) : t('nav.settings.credits')}</SectionLabel>
        <div className="flex items-center gap-3">
          {c && c.plan.limit >= 0 ? <CreditsPill text={t('topbar.credits', { used: formatNumber(c.plan.used), limit: formatNumber(c.plan.limit) })} level={level} title={t('credits.pill.title')} /> : null}
          <Button variant="ghost" size="sm" onClick={onCalculator} data-testid="open-calculator">
            {t('dialog.creditCalculator.title')}
          </Button>
        </div>
      </div>
      <RecentLedger />
    </section>
  );
}
