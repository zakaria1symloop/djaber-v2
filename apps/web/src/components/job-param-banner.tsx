'use client';
// `?job=<id>` on /delivery and /reports (notifications `job_finished` / `job_failed`, Home queue "task" cards): the
// progress of the job, then its outcome — done (with its file), partial, failed (message + code), cancelled, or gone
// (expired / not readable). Closing the banner removes `job` from the URL and keeps the rest of it.
import { Banner, ProgressBar } from '@djaber/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { JOB_BANNER_TONE, jobBannerState, withoutJobParam } from '@/lib/job-banner';
import { downloadUrl, jobFileName, useJob } from '@/lib/jobs';

export function JobParamBanner({ className }: { className?: string }) {
  const params = useSearchParams();
  const jobId = params.get('job');
  return jobId ? <JobBanner key={jobId} jobId={jobId} className={className} /> : null;
}

function JobBanner({ jobId, className }: { jobId: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = useJob(jobId);
  const job = q.data;
  const state = jobBannerState(job, q.isError);
  const kindKey = job ? `gaps.job.kind.${job.kind}` : '';
  const kind = job ? (t.has(kindKey) ? t(kindKey) : job.kind) : '';
  const close = () =>
    router.replace(withoutJobParam(pathname, params.toString()), { scroll: false });
  const failure = job?.error
    ? `${job.error.message || errorMessage(q.error, t)}${job.error.code ? ` (${job.error.code})` : ''}`
    : '';
  return (
    <Banner
      tone={JOB_BANNER_TONE[state]}
      className={className}
      onDismiss={state === 'loading' ? undefined : close}
      dismissLabel={t('action.close')}
      action={
        job?.resultUrl && (state === 'done' || state === 'partial')
          ? { label: t('gaps.job.download'), onClick: () => void downloadUrl(job.resultUrl!, jobFileName(job)) }
          : undefined
      }
    >
      <div
        data-testid="job-banner"
        data-job={jobId}
        data-state={state}
        className="flex flex-col gap-2"
      >
        <span>
          {state === 'missing'
            ? t('gaps.job.missing')
            : state === 'loading'
              ? t('gaps.job.loading')
              : state === 'failed'
                ? t('gaps.job.failed', { kind, message: failure || t('gaps.job.failedUnknown') })
                : t(`gaps.job.${state}`, { kind, pct: Math.round(job?.progress ?? 0) })}
        </span>
        {state === 'running' ? (
          <ProgressBar value={job?.progress ?? null} label={t('gaps.job.progress', { kind })} />
        ) : null}
      </div>
    </Banner>
  );
}
