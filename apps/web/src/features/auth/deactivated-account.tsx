'use client';
// 04 §16 / FL-22 step 4 / AT-DEL-02 — logging in during the 30-day deletion grace: « Compte désactivé — suppression le … »
// with « Annuler la suppression » and « Exporter mes données » (UX-047, 10/11/2026). Shown on /workspaces/new, the page
// every account without a shop lands on (the guards send a deletion-scheduled account there first), before the form.
// Retest 11/11 UX-057: a ready export reads « Télécharger mes données » + « Fichier prêt · … » (the same « Exporter » label
// looked like nothing happened); the cancel confirmation is handed to the page, which keeps it until it is closed.
import { formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import { Button, buttonClass, FormAlert, ProgressBar } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { authApi } from '@/features/auth/api';
import { canStartExport, exportPollMs } from '@/features/public/logic';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function DeactivatedAccount({ scheduledAt, onLogout, onCancelled }: { scheduledAt: string; onLogout: () => void; onCancelled: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { refetchMe } = useSession();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({ mutationFn: authApi.cancelDeletion });
  const start = useMutation({ mutationFn: authApi.startDataExport, onSuccess: (r) => setJobId(r.jobId), onError: (e) => setError(errorMessage(e, t)) });
  const exp = useQuery({
    queryKey: ['session', 'data-export', jobId],
    queryFn: () => authApi.dataExport(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => exportPollMs(q.state.data?.status),
  });
  const x = exp.data ?? null;

  const onCancel = async () => {
    setError(null);
    try {
      await cancel.mutateAsync();
      onCancelled();
      await refetchMe();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  return (
    <AuthCard
      title={t('public.deletion.grace.title')}
      badge={{ label: t('auth.deactivated.badge'), tone: 'danger' }}
      description={t('auth.deactivated.text', { date: formatDate(scheduledAt, locale) })}
      footer={
        <button type="button" className="hover:text-text-primary hover:underline" onClick={onLogout}>
          {t('userMenu.logout')}
        </button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="account-deactivated">
        <Button variant="primary" className="w-full" loading={cancel.isPending} onClick={onCancel} data-testid="deactivated-cancel">
          {t('settings.deleteAccount.cancel')}
        </Button>
        {x && x.status === 'done' && x.url ? (
          <div className="flex flex-col gap-1">
            <a href={x.url} className={buttonClass({ className: 'w-full' })} data-testid="deactivated-export-link">
              {t('public.deletion.export.ready')}
            </a>
            <span className="ts-label-meta text-center text-accent-money" data-testid="deactivated-export-ready">
              {x.expiresAt ? t('public.deletion.export.readyNote', { date: formatDate(x.expiresAt, locale) }) : t('public.deletion.export.readyShort')}
            </span>
          </div>
        ) : jobId && (!x || x.status === 'queued' || x.status === 'running') ? (
          <ProgressBar value={x?.progress ?? 0} label={t('public.deletion.export.running', { progress: formatNumber(x?.progress ?? 0) })} />
        ) : (
          <Button className="w-full" loading={start.isPending} disabled={!canStartExport(x) && !!x} onClick={() => (setError(null), start.mutate())} data-testid="deactivated-export">
            {t('public.deletion.export.download')}
          </Button>
        )}
        {x && (x.status === 'failed' || x.status === 'cancelled') ? <p className="text-[13px] text-accent-alert">{t('public.deletion.export.failed')}</p> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <p className="ts-label-meta text-text-muted">{t('auth.deactivated.note')}</p>
      </div>
    </AuthCard>
  );
}
