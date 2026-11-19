'use client';
// Public status of a Meta data-deletion request — `GET /data-deletion/:code` (api-contract §3.14):
// EN COURS (received, handled within 30 days) · TERMINÉ (data deleted) · AUCUNE DONNÉE (processed, nothing matched: the
// page says so and gives the e-mail path, MSG-08) · INTROUVABLE (unknown code, 404).
import { useDocumentTitle } from '@/lib/document-title';
import type { DataDeletionStatusView } from '@djaber/shared';
import { formatDate, type AppLocale } from '@djaber/shared';
import { Card, ErrorState, Ltr, Skeleton, StatusPill } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { LocaleSwitch } from '@/components/auth/auth-card';
import { Logo } from '@/components/shell/sidebar';
import { ApiError } from '@/lib/api';
import { SUPPORT_EMAIL } from '@/features/public/logic';
import { useLocaleCode, useT } from '@/lib/i18n';
import { notificationsApi } from './api';

type Status = DataDeletionStatusView['status'];

export function DataDeletionStatus({ code }: { code: string }) {
  useDocumentTitle(useT()('dataDeletion.title'));
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const q = useQuery({
    queryKey: ['public', 'data-deletion', code],
    queryFn: async (): Promise<DataDeletionStatusView> => {
      try {
        return await notificationsApi.dataDeletion(code);
      } catch (e) {
        // an unknown code answers 404: it is a state of the page, not an error
        if (e instanceof ApiError && e.status === 404) return { code, status: 'not_found', requestedAt: null, completedAt: null };
        throw e;
      }
    },
    retry: 1,
  });

  const status: Status | null = q.data?.status ?? null;
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, locale) : '—');
  return (
    <div className="flex w-full max-w-[480px] flex-col gap-6">
      <Card className="w-full p-8" data-testid="data-deletion" data-status={status ?? (q.isError ? 'error' : 'loading')}>
        <div className="flex items-center gap-2.5">
          <Logo compact />
          <div className="ts-display-s text-[19px] leading-none">
            Djaber<span className="text-text-secondary">.ai</span>
          </div>
        </div>
        <h1 className="ts-display-s mt-6 break-words text-[19px]">
          {t('dataDeletion.title')} <Ltr className="break-all">{code}</Ltr>
        </h1>
        {q.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="mt-5 flex flex-col gap-2.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : q.isError || !status ? (
          <ErrorState
            className="mt-5 border-0 !p-0"
            title={t('state.list.error.title')}
            description={t('state.list.error.description', { ref: q.error instanceof ApiError ? q.error.body.ref || '—' : '—' })}
            action={{ label: t('action.retry'), onClick: () => void q.refetch() }}
          />
        ) : (
          <>
            <div className="mt-5">
              <StatusPill enumKey="DataDeletion.status" value={status}>
                {t(`dataDeletion.status.${status}`)}
              </StatusPill>
            </div>
            <p className="ts-body mt-4 text-text-secondary" data-testid="data-deletion-text">
              {status === 'pending'
                ? t('dataDeletion.pending', { date: date(q.data?.requestedAt) })
                : status === 'done'
                  ? t('dataDeletion.done', { date: date(q.data?.completedAt) })
                  : status === 'no_data'
                    ? t('dataDeletion.noData', { date: date(q.data?.completedAt), email: SUPPORT_EMAIL })
                    : t('dataDeletion.notFound')}
            </p>
            {status === 'not_found' || status === 'no_data' ? null : <p className="ts-label-meta mt-4 text-text-muted">{t('dataDeletion.legalNote')}</p>}
          </>
        )}
      </Card>
      <LocaleSwitch />
    </div>
  );
}
