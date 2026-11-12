'use client';
// /agents/generate — Figma "DLG — Agents & channels" (Générer un agent depuis ma page, AGT-03): 1 CHOISIR the page and
// the period → 2 ANALYSE… (job, cancellable) → 3 REVUE (summary, languages, frequent questions, proposed instructions)
// → 4 APPLIQUER to a new agent, or to the agent already linked to the page after confirmation (creates a version;
// other agents are never touched). Free, rate-limited (`ANALYSIS_RATE_LIMITED`); reading the page needs its permission
// (`PAGE_ANALYSIS_PERMISSION_REQUIRED` → reconnect). The job id lives in the URL: a reload resumes the flow.
import { Button, buttonClass, Card, ConfirmDialog, Field, FormAlert, Ltr, MonoChip, ProgressBar, Select, Steps, toast } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { usePathname, useRouter as useNextRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { useChannels } from '@/features/channels/api';
import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { isJobRunning, useJob } from '@/lib/jobs';
import { agentsApi, useAgentsRefresh } from './api';
import type { GenerationResult } from './contracts';
import { ReviewEditor, reviewOverride, type Review } from './generate-review';
import { resumePath } from './logic';

const DAYS = [7, 30, 90] as const;
type Phase = 'choose' | 'running' | 'review' | 'failed';

export function GenerateAgent() {
  const t = useT();
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useAgentsRefresh();
  const channels = useChannels();
  const jobId = params.get('job');
  const job = useJob<GenerationResult>(jobId);
  const pages = (channels.data?.rows ?? []).filter((c) => c.status !== 'disconnected');
  const [channelId, setChannelId] = useState(params.get('channel') ?? '');
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [applying, setApplying] = useState<'new' | 'update' | null>(null);
  const [confirm, setConfirm] = useState(false);
  // leaving the review drops an analysis that counted in the daily limit: asked first
  const [discard, setDiscard] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => setReview(null), [jobId]);
  useEffect(() => {
    if (!channelId && pages[0]) setChannelId(pages[0].id);
  }, [channelId, pages]);

  const setJob = (id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set('job', id);
    else p.delete('job');
    nextRouter.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  const result = job.data?.status === 'done' ? job.data.result : null;
  const phase: Phase = !jobId ? 'choose' : job.isError || job.data?.status === 'failed' || job.data?.status === 'cancelled' ? 'failed' : result ? 'review' : 'running';
  const page = pages.find((c) => c.id === (result?.channelId ?? channelId)) ?? null;
  const linked = result?.linkedAgent ?? null;

  const start = async () => {
    if (!channelId) return;
    setStarting(true);
    setError(null);
    try {
      setJob((await agentsApi.generate({ channelId, days })).jobId);
    } catch (e) {
      setError({ message: errorMessage(e, t), code: e instanceof ApiError ? e.code : null });
    } finally {
      setStarting(false);
    }
  };
  const cancel = async () => {
    if (jobId && isJobRunning(job.data)) await api(`/jobs/${jobId}/cancel`, { method: 'POST', body: {} }).catch(() => null);
    setError(null);
    setDiscard(false);
    setJob(null);
  };
  /** "Réessayer" after a failure: the same page and period are analysed again (a failed analysis does not count). */
  const retry = async () => {
    setError(null);
    if (!channelId) return setJob(null);
    setStarting(true);
    try {
      setJob((await agentsApi.generate({ channelId, days })).jobId);
    } catch (e) {
      // refused (rate limit, permission): back to the choice with the reason
      setError({ message: errorMessage(e, t), code: e instanceof ApiError ? e.code : null });
      setJob(null);
    } finally {
      setStarting(false);
    }
  };
  const apply = async (update: boolean) => {
    if (!jobId) return;
    // M11: the review edited by the merchant is sent as `override` (an untouched review sends nothing: the proposal applies)
    const override = review && result ? reviewOverride(result, review) : undefined;
    if (override === null) {
      setError({ message: t('carry.generate.faq.incomplete'), code: null });
      setConfirm(false);
      return;
    }
    setApplying(update ? 'update' : 'new');
    setError(null);
    try {
      const agent = await agentsApi.applyGeneration(jobId, { ...(update && linked ? { agentId: linked.id, confirm: true } : {}), ...(override ? { override } : {}) });
      await refresh(agent.id);
      toast(update ? t('agents.generate.toast.updated', { name: agent.name, version: agent.currentVersion }) : t('agents.generate.toast.created', { name: agent.name }));
      router.push(agent.status === 'draft' ? resumePath(agent) : `/agents/${agent.id}`);
    } catch (e) {
      setError({ message: errorMessage(e, t), code: e instanceof ApiError ? e.code : null });
      setConfirm(false);
    } finally {
      setApplying(null);
    }
  };

  const order: Phase[] = ['choose', 'running', 'review'];
  const at = phase === 'failed' ? 1 : order.indexOf(phase);
  const stepItems = (['choose', 'running', 'review', 'apply'] as const).map((k, i) => ({ key: k, label: `${i + 1} · ${t(`agents.generate.step.${k}`)}`, state: i < at ? ('done' as const) : i === at ? ('active' as const) : ('upcoming' as const) }));
  const permission = error?.code === 'PAGE_ANALYSIS_PERMISSION_REQUIRED' || job.data?.error?.code === 'PAGE_ANALYSIS_PERMISSION_REQUIRED';
  const jobError = job.data?.error ?? null;

  return (
    <AppPage permission={['agents.read', 'agents.manage']} back={{ href: '/agents', label: t('nav.agents') }} title={t('dialog.generateAgent.title')} description={t('agents.generate.description')}>
      <Card className="flex w-full flex-col gap-5 p-5" data-testid="generate-agent" data-phase={phase}>
        <Steps label={t('agents.generate.steps')} items={stepItems} />

        {phase === 'choose' ? (
          channels.isError ? (
            <QueryError error={channels.error} onRetry={() => channels.refetch()} />
          ) : pages.length === 0 && !channels.isPending ? (
            <FormAlert tone="info">
              {t('agents.generate.noPage')}{' '}
              <Link href="/channels" className="underline">
                {t('nav.channels')}
              </Link>
            </FormAlert>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('agents.generate.channel')} htmlFor="generate-channel">
                  <Select id="generate-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={starting}>
                    {pages.map((c) => (
                      <option key={c.id} value={c.id}>
                        {t('agents.generate.channelOption', { name: c.name, platform: t(`channels.platform.${c.platform}`), count: formatNumber(c.counts.conversations) })}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('agents.generate.period')} htmlFor="generate-days">
                  <Select id="generate-days" value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof DAYS)[number])} disabled={starting}>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {t('agents.overview.days', { count: d })}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="ts-label-meta text-text-muted">{t('agents.generate.note')}</p>
            </>
          )
        ) : null}

        {phase === 'running' ? (
          <div className="flex flex-col gap-3" data-testid="generate-running">
            <p className="text-[13px]">
              <Ltr>{t('agents.generate.running', { pct: Math.round(job.data?.progress ?? 0) })}</Ltr>
            </p>
            <ProgressBar value={job.data ? job.data.progress : null} label={t('agents.generate.step.running')} />
            <p className="ts-label-meta text-text-muted">{t('agents.generate.runningNote')}</p>
          </div>
        ) : null}

        {phase === 'failed' ? (
          <FormAlert>
            <span data-testid="generate-failed">
              {job.isError ? errorMessage(job.error, t) : (jobError?.message ?? t('agents.generate.failed'))}
            </span>
            <span className="mt-1 block text-text-secondary">{t('agents.generate.failedNote')}</span>
          </FormAlert>
        ) : null}

        {phase === 'review' && result ? (
          <div className="flex flex-col gap-4" data-testid="generate-review">
            <div className="flex flex-wrap items-center gap-2 ts-label-meta text-text-muted">
              <MonoChip tone="info">{t('agents.generate.step.review')}</MonoChip>
              <Ltr>{t('agents.generate.read', { page: page?.name ?? '—', conversations: formatNumber(result.conversations), messages: formatNumber(result.messages) })}</Ltr>
            </div>
            <ReviewBlock label={t('agents.generate.summary')}>{result.summary}</ReviewBlock>
            <ReviewBlock label={t('agents.generate.languages')}>
              <Ltr>{result.languages.map((l) => `${t.has(`agents.language.tag.${l.code}`) ? t(`agents.language.tag.${l.code}`) : l.code} ${Math.round(l.pct)} %`).join(' · ') || '—'}</Ltr>
              {result.tone ? ` · ${t('agents.generate.tone', { tone: result.tone })}` : ''}
            </ReviewBlock>
            <ReviewBlock label={t('agents.generate.questions')}>
              <ul className="flex flex-col gap-1" data-testid="generate-questions">
                {result.topQuestions.map((q) => (
                  <li key={q.question} dir="auto">
                    {q.question} <Ltr className="text-text-muted">({formatNumber(q.count)})</Ltr>
                  </li>
                ))}
                {result.topQuestions.length === 0 ? <li className="text-text-muted">—</li> : null}
              </ul>
            </ReviewBlock>
            <ReviewEditor key={jobId ?? ''} result={result} value={review} onChange={setReview} disabled={applying !== null} />
            <p className="ts-label-meta text-text-muted">{t('agents.generate.reviewNote', { faq: review?.faq.filter((r) => r.q.trim() || r.a.trim()).length ?? result.proposedFaq.length })}</p>
          </div>
        ) : null}

        {error && phase !== 'failed' ? (
          <FormAlert tone={error.code === 'ANALYSIS_RATE_LIMITED' ? 'warning' : 'danger'}>
            <span data-testid="generate-error" data-code={error.code ?? ''}>
              {error.message}
            </span>
          </FormAlert>
        ) : null}
        {permission && channelId ? (
          <Link href={`/channels/${channelId}`} className={buttonClass({ className: 'w-fit' })} data-testid="generate-reconnect">
            {t('agents.generate.reconnect')}
          </Link>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {phase === 'choose' ? (
            <>
              <Link href="/agents" className={buttonClass({ variant: 'ghost' })}>
                {t('action.cancel')}
              </Link>
              <Button variant="primary" onClick={start} loading={starting} disabled={!channelId} disabledReason={channelId || channels.isPending ? undefined : pages.length ? t('gaps.agents.generate.pickPage') : t('agents.generate.noPage')} data-testid="generate-start">
                {t('action.analyze')}
              </Button>
            </>
          ) : phase === 'running' ? (
            <Button variant="ghost" onClick={() => void cancel()} data-testid="generate-cancel">
              {t('action.cancel')}
            </Button>
          ) : phase === 'failed' ? (
            <>
              <Link href="/agents" className={buttonClass({ variant: 'ghost' })}>
                {t('action.cancel')}
              </Link>
              <Button variant="primary" onClick={() => void retry()} loading={starting} data-testid="generate-retry">
                {t('action.retry')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDiscard(true)} disabled={applying !== null} data-testid="generate-discard">
                {t('action.cancel')}
              </Button>
              <Button variant={linked ? 'secondary' : 'primary'} onClick={() => void apply(false)} loading={applying === 'new'} disabled={applying === 'update'} data-testid="generate-apply-new">
                {t('agents.generate.applyNew')}
              </Button>
              {linked ? (
                <Button variant="primary" onClick={() => setConfirm(true)} disabled={applying !== null} data-testid="generate-apply-update">
                  {t('agents.generate.applyUpdate', { name: linked.name })}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !o && applying === null && setConfirm(false)}
        title={t('agents.generate.confirm.title', { name: linked?.name ?? '' })}
        description={t('agents.generate.confirm.description')}
        confirmLabel={t('agents.generate.confirm.submit')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void apply(true)}
        loading={applying === 'update'}
        closeLabel={t('action.close')}
      />
      <ConfirmDialog
        open={discard}
        onOpenChange={(o) => !o && setDiscard(false)}
        title={t('gaps.agents.generate.discard.title')}
        description={t('gaps.agents.generate.discard.description')}
        confirmLabel={t('gaps.agents.generate.discard.confirm')}
        cancelLabel={t('gaps.agents.generate.discard.keep')}
        destructive
        onConfirm={() => void cancel()}
        closeLabel={t('action.close')}
      />
    </AppPage>
  );
}

function ReviewBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="ts-label-micro text-text-muted">{label}</div>
      <div className="mt-1.5 rounded-card border border-line-hairline bg-ink-base px-3 py-2.5 text-[13px] text-text-secondary">{children}</div>
    </div>
  );
}
