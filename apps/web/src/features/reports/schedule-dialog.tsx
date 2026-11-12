'use client';
// "Planifier (e-mail mensuel)" of a report (Figma ANA-04, 12 §24, 06 §8.6): `POST /reports/:key/schedule { email,
// dayOfMonth 1–28 }`, the monthly e-mails of this report with "Ne plus envoyer" (`DELETE`), and the upgrade state when
// the plan has no `scheduled_reports` (or the API answers `403 PLAN_FEATURE_REQUIRED`): explanation + "Comparer les
// plans". Errors stay inside the dialog, the typed e-mail is kept.
import { ReportScheduleSchema, type ReportKey, type ReportScheduleView } from '@djaber/shared';
import { Button, buttonClass, Dialog, EmailInput, Field, FormAlert, Ltr, Select, toast } from '@djaber/ui';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { refusal } from '@/features/orders/dialogs/common';
import { useOffline } from '@/features/orders/offline';
import { dayLabel } from '@/features/analytics/format';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { reportsApi, useReportsRefresh } from './api';

export function ScheduleDialog({ open, reportKey, planFeature, schedules, onClose }: { open: boolean; reportKey: ReportKey; planFeature: boolean; schedules: ReportScheduleView[]; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const { me, can } = useSession();
  const offline = useOffline();
  const refresh = useReportsRefresh();
  const [email, setEmail] = useState('');
  const [day, setDay] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [gated, setGated] = useState(!planFeature);
  useEffect(() => {
    if (!open) return;
    setEmail(me?.email ?? '');
    setDay(1);
    setError(null);
    setFieldErr({});
    setGated(!planFeature);
  }, [open, me?.email, planFeature]);

  const submit = async () => {
    setError(null);
    setFieldErr({});
    const parsed = ReportScheduleSchema.safeParse({ email: email.trim(), dayOfMonth: day });
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] = t.has(i.message) ? t(i.message, { min: 1, max: 28 }) : i.message;
      setFieldErr(f);
      return;
    }
    setBusy('save');
    try {
      const s = await reportsApi.schedule(reportKey, parsed.data);
      await refresh();
      toast({ tone: 'success', message: t('reports.schedule.saved', { day: s.dayOfMonth, email: s.email }) });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PLAN_FEATURE_REQUIRED') setGated(true);
      else {
        setError(refusal(e, t));
        if (e instanceof ApiError && e.body.fields) setFieldErr(Object.fromEntries(Object.entries(e.body.fields).map(([k, v]) => [k, t.has(v) ? t(v, { min: 1, max: 28 }) : v])));
      }
    } finally {
      setBusy(null);
    }
  };
  const stop = async (s: ReportScheduleView) => {
    setBusy(s.id);
    setError(null);
    try {
      await reportsApi.unschedule(reportKey, s.email);
      await refresh();
      toast(t('reports.schedule.stopped', { email: s.email }));
    } catch (e) {
      setError(refusal(e, t));
    } finally {
      setBusy(null);
    }
  };
  const blocked = offline ? t('banner.offline') : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('reports.schedule.title')}
      description={t('reports.schedule.description', { report: t(`report.${reportKey}.title`) })}
      closeLabel={t('action.close')}
      size="md"
      footer={
        gated ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('action.close')}
            </Button>
            {can('billing.read') ? (
              <Link href="/settings/billing" className={buttonClass({ variant: 'primary' })} onClick={onClose} data-testid="schedule-upgrade">
                {t('action.comparePlans')}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy === 'save'} disabled={busy !== null} disabledReason={blocked} data-testid="schedule-submit">
              {t('reports.schedule.submit')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4" data-testid="schedule-dialog">
        {gated ? (
          <div className="flex items-start gap-3 rounded-card border border-accent-starred/40 bg-ink-raised p-3" data-testid="schedule-gated">
            <Lock className="mt-0.5 size-4 shrink-0 text-accent-starred" aria-hidden />
            <div className="text-[13px]">
              <div className="font-medium">{t('reports.schedule.gatedTitle')}</div>
              <p className="mt-1 text-text-secondary">
                {t('reports.schedule.gatedBody')}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label={t('reports.schedule.email')} htmlFor="schedule-email" error={fieldErr.email}>
              <EmailInput id="schedule-email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErr.email || undefined} />
            </Field>
            <Field label={t('reports.schedule.day')} htmlFor="schedule-day" error={fieldErr.dayOfMonth}>
              <Select id="schedule-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t('reports.schedule.dayOption', { day: d })}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="ts-label-micro !normal-case text-text-muted sm:col-span-2">{t('reports.schedule.note')}</p>
          </div>
        )}
        {schedules.length ? (
          <div className="flex flex-col gap-2">
            <div className="ts-label-micro text-text-muted">{t('reports.schedule.current')}</div>
            <ul className="divide-y divide-line-hairline rounded-card border border-line-edge" data-testid="schedule-list">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]" data-schedule={s.email}>
                  <span className="min-w-0 flex-1 truncate">
                    <Ltr>{s.email}</Ltr>
                    <span className="ts-label-micro !normal-case text-text-muted">{` · ${t('reports.schedule.everyMonth', { day: s.dayOfMonth })} · ${t('reports.schedule.next', { date: dayLabel(s.nextRunOn, locale, true) })}`}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void stop(s)} loading={busy === s.id} disabled={busy !== null && busy !== s.id} disabledReason={blocked} data-testid="schedule-stop">
                    {t('reports.schedule.stop')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
