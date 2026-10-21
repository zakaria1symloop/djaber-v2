'use client';
// /products/import — Figma "CAT-06 — Import wizard — preview with row errors" + DLG GDS I "Correspondance des colonnes".
// FL-12: upload → analysis job → (column mapping) → preview with row errors → commit job → report. The job id lives
// in the URL (`?job=<id>`, `&step=import` once the commit is requested) so a refresh resumes at the same step.
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, type ImportPreviewResult } from '@djaber/shared';
import { Banner, Button, buttonClass, Card, FormAlert, ProgressBar, Skeleton, Steps, type StepItem } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, FileUp } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl, jobKey, useJob, type JobDto } from '@/lib/jobs';
import { useSession, useWorkspaceId } from '@/lib/session';
import { catalogApi, catalogKeys, useCatalogRefresh, useCategories, useModerationSummary } from '../api';
import { flattenCategories } from '../contracts';
import { Num } from '../ui';
import { buildErrorsCsv, checkImportFile, IMPORT_ACCEPT, IMPORT_TABS, importableCount, importPhase, type ImportTab, importTemplateCsv, invalidRows, stepOfPhase } from './logic';
import { MappingDialog } from './mapping-dialog';
import { describeRowError, FileCard, PreviewRows, PreviewTiles } from './preview';
import { uuid } from '@/lib/uuid';

type Job = JobDto<ImportPreviewResult>;
const sizeKey = (jobId: string) => `djaber.import.size.${jobId}`;
const readSize = (jobId: string | null): number | null => {
  if (!jobId || typeof window === 'undefined') return null;
  try {
    const n = Number(window.sessionStorage.getItem(sizeKey(jobId)));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

export function ImportWizard() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { workspace, refetchWorkspace } = useSession();
  const refresh = useCatalogRefresh();

  const jobId = params.get('job');
  const committing = params.get('step') === 'import';
  /** the preview job when the commit runs as another job */
  const previewJobId = params.get('from') ?? jobId;
  const rawTab = params.get('tab');
  const tab: ImportTab = (IMPORT_TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as ImportTab) : 'errors';
  const setUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const job = useJob<ImportPreviewResult>(jobId);
  const phase = importPhase(jobId, job.data, committing);
  const result = job.data?.result ?? null;
  const [mappingOpen, setMappingOpen] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const categories = useCategories(phase === 'preview');
  const existingCategories = useMemo(() => flattenCategories(categories.data ?? []).map((c) => c.category.name), [categories.data]);

  /** The job starts again on the server (new mapping, commit on the same job): show it as queued until the next read. */
  const restartJob = useCallback(
    (id: string) => {
      qc.setQueryData<Job>(jobKey(ws, id), (old) => (old ? { ...old, status: 'queued', progress: 0, error: null } : old));
      void qc.invalidateQueries({ queryKey: jobKey(ws, id) });
    },
    [qc, ws],
  );

  // the mapping dialog opens by itself when the analysis asks for it (stage `mapping` or required columns missing)
  const mappingFor = useRef<string | null>(null);
  useEffect(() => {
    const stamp = phase === 'mapping' ? `${jobId}:${job.data?.updatedAt ?? ''}` : null;
    if (stamp && mappingFor.current !== stamp) setMappingOpen(true);
    mappingFor.current = stamp;
  }, [phase, jobId, job.data?.updatedAt]);

  // after the import: lists, KPIs, categories and the plan usage are stale
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'done' || !jobId || refreshedFor.current === jobId) return;
    refreshedFor.current = jobId;
    void refresh({ taxonomies: true });
    void qc.invalidateQueries({ queryKey: catalogKeys.moderationSummary(ws) });
    void refetchWorkspace();
  }, [phase, jobId, refresh, qc, ws, refetchWorkspace]);

  /* ---------- commit: one Idempotency-Key per attempt, reused when the request itself failed ---------- */
  const attempt = useRef<{ jobId: string; key: string } | null>(null);
  const commit = useMutation({
    mutationFn: (id: string) => {
      if (attempt.current?.jobId !== id) attempt.current = { jobId: id, key: uuid() };
      return catalogApi.importCommit(id, attempt.current.key);
    },
  });
  const onCommit = async () => {
    if (!previewJobId) return;
    setCommitError(null);
    try {
      const ref = await commit.mutateAsync(previewJobId);
      attempt.current = null;
      const next = ref?.jobId ?? previewJobId;
      if (next === previewJobId) restartJob(next);
      setUrl({ job: next, step: 'import', from: next === previewJobId ? null : previewJobId, tab: null });
    } catch (e) {
      // a refused request (4xx) will be corrected: new key; a lost answer (network, 5xx) is retried with the same key
      if (e instanceof ApiError && e.status < 500) attempt.current = null;
      setCommitError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };

  const startOver = () => {
    setCommitError(null);
    setMappingOpen(false);
    setUrl({ job: null, step: null, from: null, tab: null });
  };

  const describe = useCallback((e: Parameters<typeof describeRowError>[1]) => describeRowError(t, e), [t]);
  const downloadErrors = (j: Job | undefined) => {
    if (j?.resultUrl && j.result?.stage === 'committed') return downloadUrl(j.resultUrl);
    if (!j?.result) return;
    const csv = buildErrorsCsv(j.result.rows, {
      fields: IMPORT_FIELDS.filter((f) => !!j.result!.mapping?.[f]),
      headers: { row: t('import.col.row'), errors: t('import.col.error'), field: (f) => t(`import.field.${f}`) },
      describe,
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    downloadUrl(url, t('import.errors.fileName', { name: j.result.fileName.replace(/\.[^.]+$/, '') }));
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const step = stepOfPhase(phase);
  const steps: StepItem[] = (['file', 'preview', 'run'] as const).map((k, i) => ({
    key: k,
    label: t(`import.step.${k}`),
    state: i + 1 < step || (phase === 'done' && i === 2) ? 'done' : i + 1 === step ? 'active' : 'upcoming',
  }));
  const plan = workspace?.plan ? { name: workspace.plan.name, current: workspace.plan.usage.products, limit: workspace.plan.limits.maxProducts } : null;
  const size = readSize(previewJobId);
  const usable = result ? importableCount(result.totals) : 0;

  return (
    <AppPage back={{ href: '/products', label: t('nav.products') }} title={t('import.title')} description={t('import.subtitle', { rows: IMPORT_MAX_ROWS })} permission="catalog.write">
      <Steps items={steps} label={t('import.steps.label')} />

      {job.isError && jobId ? (
        <div className="flex flex-col items-center gap-3">
          <QueryError error={job.error} onRetry={() => job.refetch()} />
          <Button onClick={startOver}>{t('import.another')}</Button>
        </div>
      ) : phase === 'upload' || phase === 'analysisFailed' ? (
        <UploadStep
          failure={phase === 'analysisFailed' ? (job.data?.error ?? { code: 'INTERNAL', message: '' }) : null}
          onUploaded={(id, file) => {
            try {
              window.sessionStorage.setItem(sizeKey(id), String(file.size));
            } catch {}
            setUrl({ job: id, step: null, from: null, tab: null });
          }}
        />
      ) : phase === 'analysing' ? (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="import-analysing">
          <div className="ts-label-section uppercase text-text-muted">{t('import.analysing.title')}</div>
          <ProgressBar value={job.data?.progress ? job.data.progress : null} label={t('import.analysing.title')} />
          <p className="text-[13px] text-text-secondary">{t('import.analysing.description')}</p>
          <div>
            <Button variant="ghost" onClick={startOver}>
              {t('import.file.change')}
            </Button>
          </div>
        </Card>
      ) : phase === 'mapping' && result ? (
        <>
          <FileCard result={result} size={size} onChangeFile={startOver} />
          <Card className="flex flex-col gap-3 px-5 py-5" data-testid="import-mapping-state">
            {result.missingColumns?.length ? (
              <FormAlert>{`${t('error.IMPORT_COLUMNS_MISSING', { columns: result.missingColumns.map((f) => t(`import.field.${f}`)).join(', ') })} (IMPORT_COLUMNS_MISSING)`}</FormAlert>
            ) : null}
            <p className="text-[13px] text-text-secondary">{t('import.mapping.needed')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setMappingOpen(true)}>
                {t('import.mapping.open')}
              </Button>
              <Button onClick={startOver}>{t('import.file.change')}</Button>
            </div>
          </Card>
        </>
      ) : phase === 'preview' && result ? (
        <>
          <FileCard result={result} size={size} onChangeFile={startOver} onEditMapping={() => setMappingOpen(true)} busy={commit.isPending} />
          <PreviewTiles totals={result.totals} plan={plan} />
          <PreviewRows result={result} tab={tab} onTabChange={(k) => setUrl({ tab: k === 'errors' ? null : k })} existingCategories={existingCategories} />
          {commitError ? <FormAlert>{commitError}</FormAlert> : null}
          <div className="sticky -bottom-6 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-end gap-x-2 gap-y-2 border-t border-line-hairline bg-ink-base px-4 py-3 md:-mx-8 md:px-8" data-testid="import-footer">
            <p className="ts-label-meta me-auto min-w-0 basis-72 uppercase text-text-muted">{t('import.footer.note', { count: result.totals.invalid })}</p>
            <Button variant="ghost" onClick={() => downloadErrors(job.data)} disabledReason={invalidRows(result.rows).length ? undefined : t('import.errors.none')}>
              {t('import.errors.download')}
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={commit.isPending}>
              {t('action.back')}
            </Button>
            <Button variant="primary" onClick={onCommit} loading={commit.isPending} disabledReason={usable === 0 ? t('import.commit.none') : undefined} data-testid="import-commit">
              {t('import.commit', { count: usable })}
            </Button>
          </div>
        </>
      ) : phase === 'importing' ? (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="import-running">
          <div className="ts-label-section uppercase text-text-muted">{t('import.running.title')}</div>
          <ProgressBar value={job.data?.progress ? job.data.progress : null} label={t('import.running.title')} />
          <p className="text-[13px] text-text-secondary">{t('dialog.jobRunning.description', { label: t('import.running.label'), pct: job.data?.progress ?? 0 })}</p>
          <div>
            <Link href="/products" className={buttonClass({ variant: 'ghost' })}>
              {t('import.done.seeProducts')}
            </Link>
          </div>
        </Card>
      ) : phase === 'done' ? (
        <DoneStep job={job.data} onDownload={() => downloadErrors(job.data)} onAnother={startOver} />
      ) : phase === 'importFailed' ? (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="import-failed">
          <div className="ts-title">{t('import.failed.title')}</div>
          <FormAlert>{job.data?.error ? `${job.data.error.message || t(`error.${job.data.error.code}`, job.data.error.params)} (${job.data.error.code})` : t('state.list.error.title')}</FormAlert>
          <p className="text-[13px] text-text-secondary">{t('import.failed.description')}</p>
          {commitError ? <FormAlert>{commitError}</FormAlert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={onCommit} loading={commit.isPending}>
              {t('action.retry')}
            </Button>
            <Button onClick={() => setUrl({ job: previewJobId, step: null, from: null })} disabled={commit.isPending}>
              {t('import.failed.backToPreview')}
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={commit.isPending}>
              {t('import.another')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 px-5 py-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-1 w-full" />
        </Card>
      )}

      {result && previewJobId && (phase === 'mapping' || phase === 'preview') ? (
        <MappingDialog
          open={mappingOpen}
          onClose={() => setMappingOpen(false)}
          jobId={previewJobId}
          result={result}
          onSaved={(next) => {
            setMappingOpen(false);
            setCommitError(null);
            attempt.current = null;
            if (next === jobId) restartJob(next);
            else setUrl({ job: next, step: null, from: null });
          }}
        />
      ) : null}
    </AppPage>
  );
}

/* ---------- step 1: dropzone, client checks, upload progress ---------- */
function UploadStep({ failure, onUploaded }: { failure: { code: string; message: string; params?: Record<string, string | number> } | null; onUploaded: (jobId: string, file: File) => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [over, setOver] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async (file: File | undefined) => {
    if (!file || upload) return;
    const refused = checkImportFile(file);
    if (refused) return setError({ code: refused, message: t(`error.${refused}`) });
    setError(null);
    setUpload({ name: file.name, pct: 0 });
    abort.current = new AbortController();
    try {
      const ref = await catalogApi.importUpload(file, { onProgress: (pct) => setUpload({ name: file.name, pct }), signal: abort.current.signal });
      onUploaded(ref.jobId, file);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? { code: e.code, message: errorMessage(e, t) } : { code: '', message: errorMessage(e, t) });
      setUpload(null);
    }
  };

  const shown = error ?? (failure ? { code: failure.code, message: failure.message || (t.has(`error.${failure.code}`) ? t(`error.${failure.code}`, { columns: '', ref: '', ...failure.params }) : t('state.list.error.title')) } : null);
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="import-dropzone"
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void start(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center gap-3 rounded-card border border-dashed px-6 py-12 text-center transition-colors ${over ? 'border-signal-live bg-ink-raised' : 'border-line-lit bg-ink-surface'}`}
      >
        <FileUp className="size-6 text-text-secondary" aria-hidden />
        {upload ? (
          <>
            <div className="ts-title">
              <bdi>{upload.name}</bdi>
            </div>
            <ProgressBar value={upload.pct} label={t('import.upload.progress', { pct: upload.pct })} className="max-w-sm" />
            <p className="ts-label-meta uppercase text-text-muted" aria-live="polite">
              {t('import.upload.progress', { pct: upload.pct })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
              {t('action.cancel')}
            </Button>
          </>
        ) : (
          <>
            <div className="ts-title">{t('import.upload.title')}</div>
            <p className="ts-label-meta max-w-md uppercase text-text-muted">{t('import.upload.limits', { rows: IMPORT_MAX_ROWS })}</p>
            <Button variant="primary" onClick={() => input.current?.click()}>
              {t('import.upload.choose')}
            </Button>
          </>
        )}
        <input ref={input} type="file" accept={IMPORT_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t('import.upload.choose')} data-testid="import-file-input" onChange={(e) => (void start(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      {shown ? (
        <div data-testid="import-error" data-code={shown.code}>
          <FormAlert>{shown.code ? `${shown.message} (${shown.code})` : shown.message}</FormAlert>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="ts-label-meta text-text-muted">{t('import.upload.note')}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([importTemplateCsv(locale)], { type: 'text/csv;charset=utf-8' }));
            void downloadUrl(url, t('import.template.fileName')).finally(() => window.setTimeout(() => URL.revokeObjectURL(url), 10_000));
          }}
          data-testid="import-template"
        >
          {t('import.template.download')}
        </Button>
      </div>
    </div>
  );
}

/* ---------- step 3, finished: report, error file, moderation notice ---------- */
function DoneStep({ job, onDownload, onAnother }: { job: Job | undefined; onDownload: () => void; onAnother: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const moderation = useModerationSummary();
  const report = job?.result?.report ?? null;
  const hasErrors = !!job?.resultUrl || (job?.result ? invalidRows(job.result.rows).length > 0 : false);
  const pending = moderation.data?.pending ?? 0;
  return (
    <Card className="flex flex-col gap-4 px-5 py-6" data-testid="import-done" data-status={job?.status}>
      <div className="flex items-center gap-2">
        <CircleCheck className="size-5 text-accent-money" aria-hidden />
        <h2 className="ts-title">{t('import.done.title')}</h2>
      </div>
      {report ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          {(['created', 'updated', 'skipped'] as const).map((k) => (
            <div key={k} className="rounded-card border border-line-edge px-4 py-3" data-testid={`report-${k}`}>
              <dd className={`ts-numeral-l ${k === 'created' ? 'text-accent-money' : k === 'skipped' && report.skipped ? 'text-accent-alert' : ''}`}>
                <Num value={report[k] ?? 0} />
              </dd>
              <dt className="ts-label-micro mt-1.5 uppercase text-text-muted">{t(`import.done.${k}`)}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      {report?.categoriesCreated ? <p className="text-[13px] text-text-secondary">{t('import.done.categories', { count: report.categoriesCreated })}</p> : null}
      {pending > 0 ? (
        <Banner tone="warning" action={{ label: t('action.view'), href: `/${locale}/products?tab=pending` }}>
          {t('import.done.moderation', { count: pending })}
        </Banner>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href="/products" className={buttonClass({ variant: 'primary' })}>
          {t('import.done.seeProducts')}
        </Link>
        <Button onClick={onAnother}>{t('import.another')}</Button>
        {hasErrors ? (
          <Button variant="ghost" onClick={onDownload}>
            {t('import.errors.download')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
