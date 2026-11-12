'use client';
// Shared blocks of the three Integrations cards: card frame (title, description, status, header action), plan gate
// banner (feature missing from the plan ⇒ "Comparer les plans"), card skeleton.
import { Banner, Card, cn, Skeleton } from '@djaber/ui';
import type { ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';

export function IntegrationCard({ title, description, status, action, children, testId, state }: { title: string; description: string; status?: ReactNode; action?: ReactNode; children: ReactNode; testId: string; state?: string }) {
  return (
    <Card className="flex min-w-0 flex-col gap-4 p-5" data-testid={testId} data-state={state}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="ts-display-s">{title}</h2>
          <p className="ts-body mt-1 text-text-secondary">{description}</p>
        </div>
        {status || action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status}
            {action}
          </div>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

/** The plan has no `api_keys` / `webhooks` / `google_sheets` feature (PLAN_FEATURE_REQUIRED): explain + compare plans. */
export function PlanGate({ feature }: { feature: 'api_keys' | 'webhooks' | 'google_sheets' }) {
  const t = useT();
  const router = useRouter();
  return (
    <Banner tone="warning" action={{ label: t('action.comparePlans'), onClick: () => router.push('/settings/billing') }}>
      <span data-testid="plan-gate" data-feature={feature}>
        {t(`settings.integrations.planGate.${feature}`)}
      </span>
    </Banner>
  );
}

/** Skeleton matching a card: header + n rows. */
export function CardSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy aria-label={label}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className={cn('flex flex-col gap-2')}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </Card>
  );
}
