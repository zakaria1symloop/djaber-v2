'use client';
// /s/[code] — public parcel tracking (QR of the label; Figma "DLV-06 / ORD-09 — Labels viewer" QR target + the public
// page chrome of "PUB — …"). `GET /track/:publicToken` (api-contract §3.14 `TrackingPublicDto`), no session.
// States: skeleton · in progress (steps + timeline) · delivered · failed / returned / cancelled · not found (404) ·
// error (ref + Réessayer) · "Signaler ce vendeur" (`POST /track/:publicToken/report`) → report sent.
import { formatDate, type AppLocale } from '@djaber/shared';
import { Card, ErrorState, Ltr, NotFoundState, ParcelSteps, Skeleton, StatusPill, TrackingTimeline, type ParcelStep } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';
import { ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/document-title';
import { useLocaleCode, useT } from '@/lib/i18n';
import { deliveryApi } from '../api';
import type { TrackingPublic } from '../contracts';
import { algiersClock, parcelSteps, shipmentTone } from '../logic';
import { ReportMerchantDialog } from './report-dialog';

export function PublicTrackingPage({ code }: { code: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  useDocumentTitle(t('tracking.public.title'));
  const q = useQuery({
    queryKey: ['public', 'track', code],
    queryFn: async (): Promise<TrackingPublic | null> => {
      try {
        return await deliveryApi.publicTracking(code);
      } catch (e) {
        // an unknown code answers 404: a state of the page, not an error
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    retry: 1,
    refetchInterval: 5 * 60_000,
  });
  const d = q.data;
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const steps: ParcelStep[] = d ? parcelSteps(d.status, { selfDelivery: d.selfDelivery }).map((s) => ({ key: s.key, state: s.state, label: t(`tracking.public.step.${s.key}`) })) : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 justify-center px-4 py-10">
        <div className="flex w-full min-w-0 max-w-[560px] flex-col gap-5">
          {q.isPending ? (
            <Card className="p-6" data-testid="tracking-public" data-state="loading">
              <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-2 w-full" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-3/4" />
                ))}
              </div>
            </Card>
          ) : q.isError ? (
            <Card className="p-6" data-testid="tracking-public" data-state="error">
              <ErrorState
                className="border-0 !p-0"
                title={t('state.list.error.title')}
                description={t('state.list.error.description', { ref: q.error instanceof ApiError ? q.error.body.ref || '—' : '—' })}
                action={{ label: t('action.retry'), onClick: () => void q.refetch() }}
              />
            </Card>
          ) : !d ? (
            <Card className="p-6" data-testid="tracking-public" data-state="not_found">
              <NotFoundState className="border-0 !p-0" title={t('tracking.public.notFound.title')} description={t('tracking.public.notFound.description')} />
            </Card>
          ) : (
            <Card className="flex flex-col gap-5 p-6" data-testid="tracking-public" data-state={d.status}>
              <header className="flex flex-col gap-1">
                <p className="ts-label-micro text-text-muted">{d.shopName}</p>
                <h1 className="ts-display-s text-[22px]">
                  {t('tracking.public.order')} <Ltr className="!inline">#{d.orderNumber.replace(/^#/, '')}</Ltr>
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusPill enumKey="Shipment.status" value={d.status} className="!rounded-[4px]">
                    {d.statusLabel || t(`enum.Shipment.status.${d.status}`)}
                  </StatusPill>
                  {/* full-test 15/11 PUBLIC-07: long desk names / references wrap inside the card (the page scrolled sideways at 390 px) */}
                  <span className="min-w-0 max-w-full ts-label-micro text-text-muted [overflow-wrap:anywhere]">
                    {[d.courier, d.wilayaName, d.isStopdesk ? t('common.stopdesk') : null].filter(Boolean).join(' · ')}
                    {d.trackingNumber ? (
                      <>
                        {' · '}
                        <Ltr className="!inline [overflow-wrap:anywhere]">{d.trackingNumber}</Ltr>
                      </>
                    ) : null}
                  </span>
                </div>
              </header>
              <ParcelSteps steps={steps} label={t('tracking.public.steps')} />
              <p className="text-[14px] text-text-secondary" data-testid="tracking-public-summary">
                {t(`tracking.public.summary.${d.status}`)}
              </p>
              <section aria-label={t('tracking.public.history')} className="flex flex-col gap-3 border-t border-line-hairline pt-4">
                <h2 className="ts-label-section text-text-muted">{t('tracking.public.history')}</h2>
                <TrackingTimeline
                  label={t('tracking.public.history')}
                  empty={t('tracking.public.noEvents')}
                  items={d.events.map((e, i) => ({
                    key: `${e.at}-${i}`,
                    title: e.label,
                    tone: i === 0 ? shipmentTone(e.status) : undefined,
                    meta: [`${formatDate(e.at, locale)} ${algiersClock(e.at)}`, e.location].filter(Boolean).join(' · '),
                  }))}
                />
              </section>
            </Card>
          )}
          {d ? (
            reported ? (
              <p role="status" className="self-center ts-label-meta text-accent-money" data-testid="report-sent">
                {t('tracking.report.sent')}
              </p>
            ) : (
              <button type="button" onClick={() => setReporting(true)} className="self-center ts-label-meta text-text-muted underline decoration-line-lit underline-offset-4 hover:text-text-secondary" data-testid="report-merchant">
                {t('tracking.public.report')}
              </button>
            )
          ) : null}
          <p className="text-center ts-label-micro !normal-case text-text-muted">{t('tracking.public.footer')}</p>
          <ReportMerchantDialog code={code} open={reporting} onClose={() => setReporting(false)} onSent={() => (setReporting(false), setReported(true))} />
        </div>
      </main>
      {/* PUBLIC-07: the customer who opens the SMS / QR link can switch the language on a phone too (footer FR · AR · EN) */}
      <PublicFooter />
    </div>
  );
}
