'use client';
// ADM-11 "Traitement — {type} signalé(e) par {auteur}" (03 SAFE-08): read-only masked extract, one decision
// (confirmer le blocage · liste noire plateforme · signaler à Meta · rejeter), an audited note (≥ 10 chars,
// ADMIN_REASON_REQUIRED), "Clore & notifier {auteur}" / "Demander plus d'infos" (`POST /admin/reports/:id/decide`).
// Errors stay in the panel; the note is guarded on leave.
import { formatDateTime, type AppLocale, type ReportAdminDto } from '@djaber/shared';
import { Button, FormAlert, NotFoundState, Pill, ReportExcerpt, Skeleton, Textarea, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminQueryError } from '@/features/admin/admin-page';
import { ApiError } from '@/lib/api';
import { reasonText } from '@/lib/actions';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import { safetyApi, useReport, useSafetyRefresh } from './api';
import { decisionOffered, excerptTime, isOpenReport, PANEL_DECISIONS, type PanelDecision } from './logic';

export const reporterName = (t: TFunction, r: Pick<ReportAdminDto, 'reporter' | 'reporterKind'>) =>
  r.reporter ? `${r.reporter.firstName} ${r.reporter.lastName}`.trim() : t(`adminSafety.reporter.${r.reporterKind}`);

export function TreatmentPanel({ id, fallback, canWrite }: { id: string; fallback?: ReportAdminDto; canWrite: boolean }) {
  const t = useT();
  const q = useReport(id);
  const frame = (children: React.ReactNode) => (
    <section data-testid="report-panel" className="rounded-card border border-line-edge bg-ink-surface p-4 md:p-5">
      {children}
    </section>
  );
  if (q.isPending && !fallback) return frame(<Skeleton className="h-40 w-full" />);
  if (q.isError && !q.data) {
    return frame(
      q.error instanceof ApiError && q.error.status === 404 ? <NotFoundState title={t('state.detail.notFound.title')} description={t('adminSafety.panel.notFound')} /> : <AdminQueryError error={q.error} onRetry={() => void q.refetch()} />,
    );
  }
  const r = (q.data ?? fallback)!;
  return frame(<Body key={`${r.id}:${r.status}`} report={r} canWrite={canWrite} refetch={() => void q.refetch()} />);
}

function Body({ report: r, canWrite, refetch }: { report: ReportAdminDto; canWrite: boolean; refetch: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const refresh = useSafetyRefresh();
  const [decision, setDecision] = useState<PanelDecision | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const open = isOpenReport(r);
  const who = reporterName(t, r);
  const { guard } = useLeaveGuard(open && note.trim().length > 0, t('adminSafety.panel.title', { type: t(`adminSafety.type.${r.type}`), reporter: who }));
  const send = useMutation({ mutationFn: (d: PanelDecision) => safetyApi.decide(r.id, { decision: d, note: note.trim(), notifyReporter: d !== 'more_info' }) });
  const run = async (d: PanelDecision | null) => {
    setError(null);
    if (!d) return setError(t('adminSafety.panel.choose'));
    try {
      await send.mutateAsync(d);
      toast({ tone: 'success', message: t(`adminSafety.toast.${d}`) });
      setNote('');
      void refresh();
    } catch (e) {
      setError(errorMessage(e, t));
      if (e instanceof ApiError && e.status === 409) {
        void refresh();
        refetch();
      }
    }
  };
  // full-test 15/11 ADMIN-19.5: authors and signals in words, never `system : « » ` lines nor `MERCHANT_REPORTS_30D:1`
  const lines = r.excerpt.filter((l) => l.text.trim()).map((l) => ({ author: t.has(`adminSafety.author.${l.author}`) ? t(`adminSafety.author.${l.author}`) : l.author, text: l.text, time: excerptTime(l.at), reported: l.reported }));
  const signals = r.signals.map((sig) => signalText(t, sig)).filter((x): x is string => !!x);
  const workspace = r.workspace ? ` (${r.workspace.name})` : '';
  return (
    <div data-report={r.id} data-status={r.status}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[15px] font-medium">{`${t('adminSafety.panel.title', { type: t(`adminSafety.type.${r.type}`), reporter: who })}${workspace}`}</h2>
        {open ? null : <Pill tone={r.status === 'actioned' ? 'success' : 'neutral'}>{t(`adminSafety.status.${r.status}`)}</Pill>}
      </header>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <ReportExcerpt title={t('adminSafety.panel.excerpt', { count: lines.length })} lines={lines} emptyLabel={r.details ?? t('adminSafety.panel.noExcerpt')} />
          {r.details && lines.length ? <p className="ts-label-meta text-text-muted">{r.details}</p> : null}
          {signals.length ? <p className="ts-label-micro text-accent-starred">{signals.join(' · ')}</p> : null}
        </div>
        <div>
          <div className="ts-label-micro uppercase text-text-muted">{t('adminSafety.panel.decision')}</div>
          {open ? (
            <>
              <div role="radiogroup" aria-label={t('adminSafety.panel.decision')} className="mt-2 flex flex-col gap-2" data-testid="report-decision">
                {PANEL_DECISIONS.map((d) => {
                  const o = decisionOffered(r, d);
                  if (!o.offered) return null;
                  const off = !canWrite || !o.enabled;
                  return (
                    <label key={d} className="flex cursor-pointer items-start gap-2 text-[14px]" title={o.enabled ? undefined : reasonText(t, o.reasonCode)}>
                      <input type="radio" name={`report-${r.id}`} value={d} checked={decision === d} disabled={off} onChange={() => setDecision(d)} className="mt-1 size-3.5 shrink-0 accent-white" data-decision={d} />
                      <span className={off ? 'text-text-muted' : undefined}>{t(`adminSafety.decision.${d}`, { reporter: who })}</span>
                    </label>
                  );
                })}
              </div>
              <Textarea className="mt-3 min-h-16 py-2" aria-label={t('adminSafety.panel.note')} placeholder={t('adminSafety.panel.note')} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} maxLength={500} data-testid="report-note" />
              {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
              {canWrite ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => void run(decision)} loading={send.isPending && send.variables !== 'more_info'} data-testid="report-close">
                    {r.reporterKind === 'system' ? t('adminSafety.panel.close') : t('adminSafety.panel.closeNotify', { reporter: who })}
                  </Button>
                  <Button variant="ghost" onClick={() => void run('more_info')} loading={send.isPending && send.variables === 'more_info'} data-testid="report-more-info">
                    {t('adminSafety.panel.moreInfo')}
                  </Button>
                </div>
              ) : (
                <p className="mt-3 ts-label-meta text-text-muted">{t('adminSafety.panel.readOnly')}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[13px] text-text-secondary" data-testid="report-decided">
              {[r.decision ? t(`adminSafety.decision.${r.decision}`, { reporter: who }) : null, r.resolvedAt ? formatDateTime(r.resolvedAt, locale) : null].filter(Boolean).join(' · ')}
              {r.decisionNote ? <span className="mt-1 block">« {r.decisionNote} »</span> : null}
            </p>
          )}
        </div>
      </div>
      {guard}
    </div>
  );
}

/** `merchant_reports_30d:3` ⇒ « 3 signalements sur cette boutique en 30 j »; an unknown signal is left out (UX-059). */
export function signalText(t: TFunction, signal: string): string | null {
  const [code, n] = signal.split(':');
  const key = `adminSafety.signal.${code}`;
  if (!code || !t.has(key)) return null;
  return t(key, { count: n !== undefined && /^\d+$/.test(n) ? Number(n) : 0 });
}
