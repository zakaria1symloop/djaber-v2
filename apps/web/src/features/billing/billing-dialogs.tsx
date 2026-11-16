'use client';
// Billing dialogs — Figma "DLG — Settings & billing — dialogs catalogue": "Changer de plan" (cycle, amount now / next,
// RÉTROGRADER warning with the resources that will pause, code promo with its `PROMO_*` errors, Payer n DA (CIB /
// Edahabia) → Chargily checkout), "Résilier" (at period end, optional reason) and the undo of a scheduled cancel.
// Errors stay inside the open dialog (CLAUDE.md rule 8); the form keeps what was typed.
import { formatDate, formatNumber, PROMO_CODE_MAX, type AppLocale } from '@djaber/shared';
import { Button, Dialog, EstimateBox, Field, FormAlert, Input, RadioCards, Skeleton, Textarea, toast } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { errorCode, errorMessage } from '@/lib/forms';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { billingApi, goToCheckout, useBillingRefresh } from './api';
import type { CheckoutPreview, Cycle, Plan, PromoValidation, Subscription } from './contracts';
import { cyclePrice, planCta, yearlyDiscountPct } from './logic';

const PROMO_CODES = ['PROMO_INVALID', 'PROMO_EXPIRED', 'PROMO_ALREADY_USED', 'PROMO_PLAN_MISMATCH', 'PROMO_NOT_STACKABLE', 'PROMO_LIMIT_REACHED', 'PROMO_MOBILE_SUBSCRIPTION_FORBIDDEN'];
export const isPromoError = (e: unknown): boolean => PROMO_CODES.includes(errorCode(e) ?? '');

/** "−30 % · 3 mois" / "−500 DA" / "+300 crédits" / "+7 jours d’essai" */
export function promoLabel(p: Pick<PromoValidation, 'kind' | 'value' | 'periods'>, t: TFunction): string {
  const base =
    p.kind === 'percent_discount'
      ? t('billing.promo.percent', { value: p.value })
      : p.kind === 'fixed_discount'
        ? t('billing.promo.fixed', { value: formatNumber(p.value) })
        : p.kind === 'credits'
          ? t('billing.promo.credits', { value: formatNumber(p.value) })
          : t('billing.promo.trial', { value: p.value });
  return p.periods ? `${base} · ${t('billing.promo.periods', { count: p.periods })}` : base;
}

/* ---------- Changer de plan ---------- */
export function ChangePlanDialog({ open, plan, cycle: initialCycle, sub, onClose, onCancelInstead }: { open: boolean; plan: Plan | null; cycle: Cycle; sub: Subscription; onClose: () => void; onCancelInstead: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const { can } = useSession();
  const owner = can('billing.plan');
  const refresh = useBillingRefresh();
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [promoText, setPromoText] = useState('');
  const [promo, setPromo] = useState<PromoValidation | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(uuid);

  useEffect(() => {
    if (!open) return;
    setCycle(initialCycle);
    setPromoText('');
    setPromo(null);
    setPromoError(null);
    setError(null);
    setKey(uuid());
  }, [open, initialCycle, plan?.id]);

  const discount = promo && (promo.kind === 'percent_discount' || promo.kind === 'fixed_discount') ? promo.code : null;
  const body = useMemo(() => (plan ? { planId: plan.id, cycle, ...(discount ? { promoCode: discount } : {}) } : null), [plan, cycle, discount]);
  // a new body is a new submit: a fresh Idempotency-Key, reused only when the same body is retried
  useEffect(() => setKey(uuid()), [body]);
  const preview = useQuery({
    queryKey: [ws, 'billing', 'preview', body],
    queryFn: () => billingApi.preview(body!),
    // full-test 15/11 SETTINGS-04: the current plan + cycle before J−7 is not renewable (same rule as « Renouveler »)
    enabled: open && !!body && owner && !(plan && planCta(plan, sub, cycle).kind === 'renew_later'),
    retry: false,
    staleTime: 30_000,
  });
  const validate = useMutation({ mutationFn: billingApi.validatePromo });
  const checkout = useMutation({ mutationFn: () => billingApi.checkout(body!, key) });
  const redeem = useMutation({ mutationFn: billingApi.redeemPromo });

  if (!plan) return null;
  const direction = planCta(plan, sub, cycle);
  const tooEarly = direction.kind === 'renew_later' ? t('billing.plan.renewLater', { date: formatDate(direction.from, locale) }) : null;
  const p: CheckoutPreview | undefined = preview.data;
  const downgrade = p ? p.mode === 'downgrade' : direction.kind === 'change' && direction.direction === 'downgrade';
  // credits / trial-extension codes do not discount a plan: they are redeemed on their own (`POST /billing/promo/redeem`)
  const redeemable = !!promo && (promo.kind === 'credits' || promo.kind === 'trial_extension');
  const from = sub.status === 'trial' ? `${sub.plan.name} (${t('billing.plan.badge.trial').toLowerCase()})` : `${sub.plan.name} ${sub.billingCycle === 'yearly' ? t('billing.cycle.short.yearly') : sub.billingCycle === 'monthly' ? t('billing.cycle.short.monthly') : ''}`.trim();

  const applyPromo = async () => {
    const code = promoText.trim().toUpperCase();
    if (!code) return;
    setPromoError(null);
    try {
      const v = await validate.mutateAsync({ code, planId: plan.id });
      setPromo({ ...v, code: v.code || code });
    } catch (e) {
      setPromo(null);
      setPromoError(errorMessage(e, t));
    }
  };

  const submit = async () => {
    setError(null);
    try {
      const r = await checkout.mutateAsync();
      if (r.checkoutUrl) {
        toast({ tone: 'info', message: t('billing.change.redirecting') });
        goToCheckout(r.checkoutUrl);
        return;
      }
      await refresh();
      toast({ tone: 'success', message: r.preview.mode === 'downgrade' ? t('billing.change.scheduled', { plan: plan.name, date: formatDate(r.preview.effectiveAt, locale) }) : t('billing.change.done', { plan: plan.name }) });
      onClose();
    } catch (e) {
      if (isPromoError(e)) {
        setPromo(null);
        setPromoError(errorMessage(e, t));
      } else setError(errorMessage(e, t));
      setKey(uuid());
    }
  };

  const redeemNow = async () => {
    if (!promo) return;
    setPromoError(null);
    try {
      const r = await redeem.mutateAsync({ code: promo.code });
      await refresh();
      toast({ tone: 'success', message: r.creditsAdded > 0 ? t('billing.promo.redeemed.credits', { count: formatNumber(r.creditsAdded) }) : t('billing.promo.redeemed.trial', { date: r.trialEndsAt ? formatDate(r.trialEndsAt, locale) : '—' }) });
      setPromo(null);
      setPromoText('');
    } catch (e) {
      setPromoError(errorMessage(e, t));
    }
  };

  const amount = p ? formatNumber(p.amountNow) : '…';
  const cta = downgrade ? t('billing.change.schedule') : p && p.amountNow <= 0 ? t('billing.change.confirm') : t('billing.change.pay', { amount });
  const pct = yearlyDiscountPct(plan);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !checkout.isPending && onClose()}
      title={t('dialog.changePlan.title')}
      description={t('billing.change.context', { from, to: plan.name })}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={checkout.isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={checkout.isPending} disabled={!owner || !!tooEarly || !p || preview.isFetching} disabledReason={owner ? (tooEarly ?? undefined) : t('billing.ownerOnly')} data-testid="change-submit">
            {cta}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="change-plan-dialog" data-plan={plan.slug}>
        <RadioCards<Cycle>
          columns={2}
          label={t('billing.cycle.label')}
          value={cycle}
          onChange={setCycle}
          options={[
            { value: 'monthly', label: t('billing.change.cycle.monthly', { amount: formatNumber(cyclePrice(plan, 'monthly')) }) },
            { value: 'yearly', label: pct > 0 ? t('billing.change.cycle.yearly', { amount: formatNumber(cyclePrice(plan, 'yearly')), pct }) : t('billing.change.cycle.yearlyPlain', { amount: formatNumber(cyclePrice(plan, 'yearly')) }) },
          ]}
        />

        {tooEarly ? (
          <EstimateBox tone="warning" data-testid="change-too-early">
            {tooEarly}
          </EstimateBox>
        ) : preview.isPending && owner ? (
          <Skeleton className="h-12" />
        ) : preview.isError ? (
          <FormAlert>{errorMessage(preview.error, t)}</FormAlert>
        ) : p ? (
          downgrade ? (
            <EstimateBox tone="warning" data-testid="change-downgrade">
              <span className="me-2 rounded-[4px] border border-accent-starred/60 px-1.5 py-0.5 ts-label-micro text-accent-starred">{t('billing.change.downgrade.label')}</span>
              {t('billing.change.downgrade.text', { from: sub.plan.name, to: plan.name, date: formatDate(p.effectiveAt, locale) })}{' '}
              {p.pausedResources.length
                ? t('billing.change.downgrade.paused', { list: p.pausedResources.map((r) => r.name).join(', '), plan: plan.name })
                : t('billing.change.downgrade.none', { plan: plan.name })}
            </EstimateBox>
          ) : (
            <EstimateBox data-testid="change-preview" data-mode={p.mode}>
              {p.promo && p.amountBeforePromo > p.amountNow ? (
                <span className="me-1 text-text-muted line-through" data-testid="change-before-promo">
                  {t('billing.change.beforePromo', { amount: formatNumber(p.amountBeforePromo) })}
                </span>
              ) : null}
              {p.mode === 'renewal'
                ? t('billing.change.preview.renewal', { now: formatNumber(p.amountNow), date: formatDate(p.nextAt, locale) })
                : p.prorataDays
                ? t('billing.change.preview.prorata', { now: formatNumber(p.amountNow), days: p.prorataDays, next: formatNumber(p.nextAmount), date: formatDate(p.nextAt, locale), credits: formatNumber(p.creditsNow) })
                : t('billing.change.preview.now', { now: formatNumber(p.amountNow), next: formatNumber(p.nextAmount), date: formatDate(p.nextAt, locale), credits: formatNumber(p.creditsNow) })}
              {p.pausedResources.length ? ` ${t('billing.change.downgrade.paused', { list: p.pausedResources.map((r) => r.name).join(', '), plan: plan.name })}` : ''}
            </EstimateBox>
          )
        ) : null}

        {!downgrade ? (
          <Field label={t('billing.change.promo.label')} htmlFor="promo-code" error={promoError ?? undefined} hint={promo ? `✓ ${promoLabel(promo, t)}${redeemable ? ` · ${t('billing.promo.redeemHint')}` : ''}` : t('billing.change.promo.hint')}>
            <div className="flex gap-2">
              <Input
                id="promo-code"
                value={promoText}
                onChange={(e) => {
                  setPromoText(e.target.value);
                  setPromoError(null);
                  if (promo) setPromo(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void applyPromo();
                  }
                }}
                placeholder={t('billing.change.promo.placeholder')}
                autoComplete="off"
                dir="ltr"
                maxLength={PROMO_CODE_MAX}
                className="uppercase"
                disabled={!owner}
                data-testid="promo-input"
              />
              {redeemable ? (
                <Button onClick={redeemNow} loading={redeem.isPending} data-testid="promo-redeem">
                  {t('billing.promo.redeem')}
                </Button>
              ) : (
                <Button onClick={applyPromo} loading={validate.isPending} disabled={!owner || !promoText.trim()} data-testid="promo-apply">
                  {t('action.apply')}
                </Button>
              )}
            </div>
          </Field>
        ) : null}

        {sub.status !== 'trial' && sub.billingCycle !== 'none' && !sub.cancelAtPeriodEnd ? (
          <p className="ts-label-meta text-text-muted">
            {t('billing.change.cancelHint')}{' '}
            <button type="button" className="text-accent-alert hover:underline" onClick={onCancelInstead} disabled={!owner}>
              {t('billing.cancel.action')}
            </button>
          </p>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Résilier (at period end) ---------- */
export function CancelDialog({ open, sub, onClose }: { open: boolean; sub: Subscription; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const refresh = useBillingRefresh();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({ mutationFn: billingApi.cancel });
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const date = formatDate(sub.currentPeriodEnd, locale);
  const submit = async () => {
    setError(null);
    try {
      await cancel.mutateAsync(reason.trim() ? { reason: reason.trim() } : {});
      await refresh();
      toast({ tone: 'success', message: t('billing.cancel.done', { date }) });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !cancel.isPending && onClose()}
      title={t('billing.cancel.title')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            {t('action.keep')}
          </Button>
          <Button variant="danger" onClick={submit} loading={cancel.isPending} data-testid="cancel-confirm">
            {t('billing.cancel.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="cancel-dialog">
        <EstimateBox tone="warning">{t('billing.cancel.body', { plan: sub.plan.name, date })}</EstimateBox>
        <Field label={t('billing.cancel.reason')} htmlFor="cancel-reason">
          <Textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/** "Annuler la résiliation" — undoes a cancel / downgrade scheduled for the period end. */
export function UndoCancelButton({ owner, className, testid = 'undo-cancel' }: { owner: boolean; className?: string; testid?: string }) {
  const t = useT();
  const refresh = useBillingRefresh();
  const undo = useMutation({ mutationFn: billingApi.undoCancel });
  const run = async () => {
    try {
      await undo.mutateAsync();
      await refresh();
      toast({ tone: 'success', message: t('billing.cancel.undone') });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <Button className={className} onClick={run} loading={undo.isPending} disabled={!owner} disabledReason={owner ? undefined : t('billing.ownerOnly')} data-testid={testid} data-cta="resume">
      {t('billing.cancel.undo')}
    </Button>
  );
}
