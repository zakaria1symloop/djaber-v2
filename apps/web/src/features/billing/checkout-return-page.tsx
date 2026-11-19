'use client';
// /settings/billing/return?ref= — Figma "BIL-04 / BIL-03 — … Checkout return" + DLG "Retour de paiement (page)" (FL-28):
// VÉRIFICATION… (`GET /billing/checkout/return?ref`, every 5 s × 12) → SUCCÈS (invoice n°, plan until / credits added) ·
// EN ATTENTE (bank not confirmed yet; a slow poll keeps going so a late webhook still shows SUCCÈS) · ÉCHEC
// `PAYMENT_FAILED` (Réessayer / Autre moyen) · EXPIRÉ `PAYMENT_EXPIRED` (Recommencer) · unknown ref (404). Plans, packs
// and unpaid invoices share this page (`kind`). `billing.read`.
import { CHECKOUT_RETURN_POLLS, formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import { buttonClass, CheckoutStatus } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { SettingsPage } from '@/features/settings/common';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { billingApi, billingKeys, useBillingRefresh } from './api';
import type { CheckoutReturn } from './contracts';
import { pollDelay, returnView, type ReturnView } from './logic';

export function CheckoutReturnPage() {
  const t = useT();
  return (
    <SettingsPage title={t('checkout.title')} permission="billing.read">
      <ReturnBody />
    </SettingsPage>
  );
}

function ReturnBody() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const ref = (useSearchParams().get('ref') ?? '').trim();
  const refresh = useBillingRefresh();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: billingKeys.checkoutReturn(ws, ref),
    queryFn: () => billingApi.checkoutReturn(ref),
    enabled: !!ws && !!ref,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    refetchInterval: (query) => {
      const err = query.state.error;
      const notFound = err instanceof ApiError && err.status === 404;
      return pollDelay(returnView(query.state.data?.status, query.state.dataUpdateCount, notFound));
    },
    refetchIntervalInBackground: true,
  });
  // number of answers received so far. Reading `dataUpdatedAt` subscribes the page to every answer (an identical
  // "verifying" answer would otherwise not re-render it, and the counter would never reach 12)
  const answeredAt = q.dataUpdatedAt;
  const attempts = answeredAt ? (qc.getQueryState(billingKeys.checkoutReturn(ws, ref))?.dataUpdateCount ?? 0) : 0;
  const notFound = !ref || (q.error instanceof ApiError && q.error.status === 404);
  const view: ReturnView = returnView(q.data?.status, attempts, notFound);

  // a confirmed payment changes the plan / credits / invoices: the cached screens are refreshed once
  const refreshed = useRef(false);
  useEffect(() => {
    if (view === 'success' && !refreshed.current) {
      refreshed.current = true;
      void refresh();
    }
  }, [view, refresh]);

  if (q.isError && !notFound) {
    // a transport / server error: the page keeps the verifying look with a retry (nothing was decided)
    return (
      <CheckoutStatus
        state="pending"
        label={t('checkout.label.pending')}
        title={t('checkout.error.title')}
        description={t('checkout.error.body')}
        meta={t('state.list.error.description', { ref: q.error instanceof ApiError && q.error.body.ref ? q.error.body.ref : '—' })}
        actions={
          <button type="button" className={buttonClass({ variant: 'primary' })} onClick={() => q.refetch()}>
            {t('action.retry')}
          </button>
        }
      />
    );
  }
  return <ReturnState view={view} data={q.data} attempts={attempts} locale={locale} />;
}

function ReturnState({ view, data, attempts, locale }: { view: ReturnView; data: CheckoutReturn | undefined; attempts: number; locale: AppLocale }) {
  const t = useT();
  const pack = data?.kind === 'pack';
  const home = pack ? '/settings/credits' : '/settings/billing';
  const back = (
    <Link href={home} className={buttonClass({ variant: 'primary' })} data-testid="return-back">
      {t('checkout.back')}
    </Link>
  );
  switch (view) {
    case 'verifying':
      return <CheckoutStatus state="verifying" label={t('checkout.label.verifying')} title={t('checkout.verifying.title')} meta={t('checkout.verifying.meta', { attempt: Math.min(attempts + 1, CHECKOUT_RETURN_POLLS), max: CHECKOUT_RETURN_POLLS })} />;
    case 'success':
      return (
        <CheckoutStatus
          state="success"
          label={t('checkout.label.success')}
          title={t('checkout.success.title')}
          description={
            pack
              ? t('checkout.success.pack', { credits: formatNumber(data?.credits ?? 0), creditsN: data?.credits ?? 0 })
              : data?.planName && data.planUntil
                ? t('checkout.success.plan', { plan: data.planName, date: formatDate(data.planUntil, locale) })
                : t('checkout.success.invoice')
          }
          meta={data?.invoiceNumber ? t('checkout.success.number', { number: data.invoiceNumber }) : undefined}
          actions={back}
        />
      );
    case 'pending':
      return <CheckoutStatus state="pending" label={t('checkout.label.pending')} title={t('checkout.pending.title')} description={t('checkout.pending.body')} actions={back} />;
    case 'failed':
      return (
        <CheckoutStatus
          state="failed"
          label={t('checkout.label.failed')}
          title={t('error.PAYMENT_FAILED')}
          description={data?.failureReason ? t('checkout.failed.reason', { reason: data.failureReason }) : t('checkout.failed.body')}
          actions={
            <>
              <Link href="/help/contact" className={buttonClass({ variant: 'secondary' })} data-testid="return-manual">
                {t('checkout.otherMethod')}
              </Link>
              <Link href={pack ? '/settings/credits?buy=1' : '/settings/billing'} className={buttonClass({ variant: 'primary' })} data-testid="return-retry">
                {t('action.retry')}
              </Link>
            </>
          }
        />
      );
    case 'expired':
      return (
        <CheckoutStatus
          state="expired"
          label={t('checkout.label.expired')}
          title={t('error.PAYMENT_EXPIRED')}
          description={t('checkout.expired.body')}
          actions={
            <Link href={pack ? '/settings/credits?buy=1' : '/settings/billing'} className={buttonClass({ variant: 'primary' })} data-testid="return-restart">
              {t('checkout.restart')}
            </Link>
          }
        />
      );
    case 'unknown':
      return (
        <CheckoutStatus
          state="unknown"
          label={t('checkout.label.unknown')}
          title={t('checkout.unknown.title')}
          description={t('checkout.unknown.body')}
          actions={
            <Link href="/settings/billing" className={buttonClass({ variant: 'primary' })}>
              {t('checkout.toBilling')}
            </Link>
          }
        />
      );
  }
}
