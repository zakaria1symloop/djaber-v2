'use client';
// /orders/import — the CAT-06 import wizard applied to orders (ORD-05 v2 "Importer", P2 D69, M5 carry-over; route map
// `/orders/import`): upload (CSV / XLSX ≤ 5 MB, ≤ 1 000 rows) → analysis job → column mapping when required columns are
// missing (DLG GDS "Correspondance des colonnes") → preview with per-row errors (phone, wilaya, unknown SKU, stock) →
// commit job (Idempotency-Key) → report (created / skipped / failed). The job id is URL state (`?job=`, `&step=import`).
import { formatNumber, ORDER_IMPORT_FIELDS, ORDER_IMPORT_MAX_ROWS, ORDER_IMPORT_REQUIRED_FIELDS, type OrderImportField, type OrderImportPreviewResult, type OrderImportPreviewRow } from '@djaber/shared';
import { Button, buttonClass, Card, cn, FormAlert, KpiTile, Ltr, ProgressBar, SegmentedControl, Select, Steps, type StepItem } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, FileUp } from 'lucide-react';
import { usePathname, useRouter as useNextRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { checkImportFile, IMPORT_ACCEPT } from '@/features/catalog/import/logic';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT, type TFunction } from '@/lib/i18n';
import { isJobRunning, jobKey, useJob, type JobDto, type JobRef } from '@/lib/jobs';
import { useWorkspaceId } from '@/lib/session';
import { uploadWithProgress } from '@/lib/upload';
import { uuid } from '@/lib/uuid';

type Job = JobDto<OrderImportPreviewResult>;
export type OrderImportPhase = 'upload' | 'analysing' | 'analysisFailed' | 'mapping' | 'preview' | 'importing' | 'done' | 'importFailed' | 'loading';

/** Wizard phase from the job and the URL (`step=import` once the commit was requested). */
export function orderImportPhase(jobId: string | null, job: Pick<Job, 'status' | 'result'> | undefined, committing: boolean): OrderImportPhase {
  if (!jobId) return 'upload';
  if (!job) return 'loading';
  const running = isJobRunning(job);
  if (committing) {
    if (running) return 'importing';
    if (job.status === 'done' || job.status === 'partial') return 'done';
    return 'importFailed';
  }
  if (running) return 'analysing';
  if (job.status === 'failed' || job.status === 'cancelled' || !job.result) return 'analysisFailed';
  if (job.result.stage === 'committed') return 'done';
  return job.result.stage === 'mapping' || job.result.missingColumns.length ? 'mapping' : 'preview';
}

/** "Téléphone invalide", "SKU inconnu : PO-50", "Stock insuffisant (2)" … */
export const describeOrderRowError = (t: TFunction, e: OrderImportPreviewRow['errors'][number]): string => {
  const field = e.field ? t(`orderImport.field.${e.field}`) : null;
  if (e.code === 'NOT_FOUND' && e.field === 'items') return t('orderImport.error.skuUnknown', { sku: String(e.params?.sku ?? '') });
  if (e.code === 'VALIDATION_ERROR') return field ? t('orderImport.error.invalid', { field }) : t('error.VALIDATION_ERROR');
  const key = `error.${e.code}`;
  const text = t.has(key) ? t(key, { product: '', available: '', ...e.params }) : e.code;
  return field ? `${field} : ${text}` : text;
};

const api_ = {
  upload: (file: File, o: { onProgress?: (pct: number) => void; signal?: AbortSignal }) => {
    const fd = new FormData();
    fd.set('file', file);
    return uploadWithProgress<JobRef>('/orders/import', fd, o).then((r) => r.data);
  },
  mapping: (jobId: string, mapping: Partial<Record<OrderImportField, string | null>>) => api<JobRef | null>('/orders/import/mapping', { method: 'POST', body: { jobId, mapping } }),
  commit: (jobId: string, key: string) => api<JobRef>(`/orders/import/${jobId}/commit`, { method: 'POST', body: {}, idempotent: key }),
};

export function OrderImportWizard() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useNextRouter();
  const pathname = usePathname();
  const jobId = params.get('job');
  const committing = params.get('step') === 'import';
  const previewJobId = params.get('from') ?? jobId;
  const tab = params.get('tab') === 'valid' ? 'valid' : 'errors';
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
  const job = useJob<OrderImportPreviewResult>(jobId);
  const phase = orderImportPhase(jobId, job.data, committing);
  const result = job.data?.result ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ jobId: string; key: string } | null>(null);

  const restart = (id: string) => {
    qc.setQueryData<Job>(jobKey(ws, id), (old) => (old ? { ...old, status: 'queued', progress: 0, error: null } : old));
    void qc.invalidateQueries({ queryKey: jobKey(ws, id) });
  };
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'done' || !jobId || refreshed.current === jobId) return;
    refreshed.current = jobId;
    void qc.invalidateQueries({ queryKey: [ws, 'orders'] });
    void qc.invalidateQueries({ queryKey: [ws, 'clients'] });
    void qc.invalidateQueries({ queryKey: [ws, 'dashboard'] });
  }, [phase, jobId, qc, ws]);

  const commit = async () => {
    if (!previewJobId) return;
    setBusy(true);
    setError(null);
    try {
      if (attempt.current?.jobId !== previewJobId) attempt.current = { jobId: previewJobId, key: uuid() };
      const ref = await api_.commit(previewJobId, attempt.current.key);
      attempt.current = null;
      const next = ref?.jobId ?? previewJobId;
      if (next === previewJobId) restart(next);
      setUrl({ job: next, step: 'import', from: next === previewJobId ? null : previewJobId, tab: null });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) attempt.current = null;
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  const startOver = () => {
    setError(null);
    setUrl({ job: null, step: null, from: null, tab: null });
  };

  const step = phase === 'upload' || phase === 'analysing' || phase === 'analysisFailed' || phase === 'loading' ? 1 : phase === 'mapping' || phase === 'preview' ? 2 : 3;
  const steps: StepItem[] = (['file', 'preview', 'run'] as const).map((k, i) => ({ key: k, label: t(`import.step.${k}`), state: i + 1 < step || (phase === 'done' && i === 2) ? 'done' : i + 1 === step ? 'active' : 'upcoming' }));

  return (
    <AppPage back={{ href: '/orders', label: t('nav.orders') }} title={t('orderImport.title')} description={t('orderImport.subtitle', { rows: ORDER_IMPORT_MAX_ROWS })} permission="orders.import">
      <Steps items={steps} label={t('import.steps.label')} />
      {job.isError && jobId ? (
        <div className="flex flex-col items-center gap-3">
          <QueryError error={job.error} onRetry={() => job.refetch()} />
          <Button onClick={startOver}>{t('import.another')}</Button>
        </div>
      ) : phase === 'upload' || phase === 'analysisFailed' ? (
        <UploadStep failure={phase === 'analysisFailed' ? (job.data?.error ?? { code: 'INTERNAL', message: '' }) : null} onUploaded={(id) => setUrl({ job: id, step: null, from: null, tab: null })} />
      ) : phase === 'analysing' || phase === 'loading' ? (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="order-import-analysing">
          <div className="ts-label-section uppercase text-text-muted">{t('import.analysing.title')}</div>
          <ProgressBar value={job.data?.progress ? job.data.progress : null} label={t('import.analysing.title')} />
          <div>
            <Button variant="ghost" onClick={startOver}>
              {t('import.file.change')}
            </Button>
          </div>
        </Card>
      ) : phase === 'mapping' && result && previewJobId ? (
        <MappingStep
          result={result}
          onBack={startOver}
          onSaved={(next) => {
            attempt.current = null;
            if (next === jobId) restart(next);
            else setUrl({ job: next, step: null, from: null });
          }}
          jobId={previewJobId}
        />
      ) : phase === 'preview' && result ? (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="order-import-tiles">
            <KpiTile value={formatNumber(result.totals.rows)} label={t('orderImport.tile.rows')} meta={result.fileName} />
            <KpiTile value={formatNumber(result.totals.valid)} label={t('orderImport.tile.valid')} meta={t('orderImport.tile.units', { count: result.totals.units })} />
            <KpiTile value={formatNumber(result.totals.invalid)} label={t('orderImport.tile.invalid')} meta={t('orderImport.tile.invalidMeta')} tone={result.totals.invalid ? 'danger' : undefined} />
            <KpiTile value={formatNumber(result.totals.newClients)} label={t('orderImport.tile.newClients')} meta={t('orderImport.tile.newClientsMeta')} />
          </section>
          <SegmentedControl<'errors' | 'valid'>
            label={t('orderImport.tabs')}
            value={tab}
            onChange={(v) => setUrl({ tab: v === 'errors' ? null : v })}
            options={[
              { value: 'errors', label: t('orderImport.tab.errors', { count: result.totals.invalid }) },
              { value: 'valid', label: t('orderImport.tab.valid', { count: result.totals.valid }) },
            ]}
          />
          <PreviewTable rows={result.rows.filter((r) => (tab === 'valid' ? r.ok : !r.ok))} />
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="sticky -bottom-6 z-10 -mx-4 -mb-6 flex flex-wrap items-center justify-end gap-2 border-t border-line-hairline bg-ink-base px-4 py-3 md:-mx-8 md:px-8" data-testid="order-import-footer">
            <p className="ts-label-meta me-auto uppercase text-text-muted">{t('orderImport.footer', { count: result.totals.invalid })}</p>
            <Button variant="ghost" onClick={startOver} disabled={busy}>
              {t('action.back')}
            </Button>
            <Button variant="primary" onClick={() => void commit()} loading={busy} disabledReason={result.totals.valid === 0 ? t('orderImport.none') : undefined} data-testid="order-import-commit">
              {t('orderImport.commit', { count: result.totals.valid })}
            </Button>
          </div>
        </>
      ) : phase === 'importing' ? (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="order-import-running">
          <div className="ts-label-section uppercase text-text-muted">{t('import.running.title')}</div>
          <ProgressBar value={job.data?.progress ? job.data.progress : null} label={t('import.running.title')} />
        </Card>
      ) : phase === 'done' ? (
        <Card className="flex flex-col gap-4 px-5 py-6" data-testid="order-import-done" data-status={job.data?.status}>
          <div className="flex items-center gap-2">
            <CircleCheck className="size-5 text-accent-money" aria-hidden />
            <h2 className="ts-title">{t('orderImport.done.title')}</h2>
          </div>
          {result?.report ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              {(['created', 'skipped'] as const).map((k) => (
                <div key={k} className="rounded-card border border-line-edge px-4 py-3" data-testid={`order-report-${k}`}>
                  <dd className={cn('ts-numeral-l', k === 'created' && 'text-accent-money')}>
                    <Ltr>{formatNumber(result.report![k])}</Ltr>
                  </dd>
                  <dt className="ts-label-micro mt-1.5 uppercase text-text-muted">{t(`orderImport.done.${k}`)}</dt>
                </div>
              ))}
              <div className="rounded-card border border-line-edge px-4 py-3" data-testid="order-report-failed">
                <dd className={cn('ts-numeral-l', result.report.failed.length && 'text-accent-alert')}>
                  <Ltr>{formatNumber(result.report.failed.length)}</Ltr>
                </dd>
                <dt className="ts-label-micro mt-1.5 uppercase text-text-muted">{t('orderImport.done.failed')}</dt>
              </div>
            </dl>
          ) : null}
          {result?.report?.failed.length ? (
            <ul className="flex flex-col gap-1 text-[13px] text-text-secondary">
              {result.report.failed.slice(0, 20).map((f) => (
                <li key={f.row}>{t('orderImport.done.failedRow', { row: f.row, error: describeOrderRowError(t, { field: null, code: f.code, params: f.params }) })}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link href="/orders?source=import" className={buttonClass({ variant: 'primary' })}>
              {t('orderImport.done.see')}
            </Link>
            <Button onClick={startOver}>{t('import.another')}</Button>
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 px-5 py-6" data-testid="order-import-failed">
          <FormAlert>{job.data?.error ? job.data.error.message : t('state.list.error.title')}</FormAlert>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void commit()} loading={busy}>
              {t('action.retry')}
            </Button>
            <Button variant="ghost" onClick={startOver}>
              {t('import.another')}
            </Button>
          </div>
        </Card>
      )}
    </AppPage>
  );
}

function UploadStep({ failure, onUploaded }: { failure: { code: string; message: string } | null; onUploaded: (jobId: string) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
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
      const ref = await api_.upload(file, { onProgress: (pct) => setUpload({ name: file.name, pct }), signal: abort.current.signal });
      onUploaded(ref.jobId);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? { code: e.code, message: errorMessage(e, t) } : { code: '', message: errorMessage(e, t) });
      setUpload(null);
    }
  };
  const shown = error ?? (failure ? { code: failure.code, message: failure.message || t('state.list.error.title') } : null);
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="order-import-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void start(e.dataTransfer.files[0]);
        }}
        className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-lit bg-ink-surface px-6 py-12 text-center"
      >
        <FileUp className="size-6 text-text-secondary" aria-hidden />
        {upload ? (
          <>
            <div className="ts-title">
              <bdi>{upload.name}</bdi>
            </div>
            <ProgressBar value={upload.pct} label={t('import.upload.progress', { pct: upload.pct })} className="max-w-sm" />
          </>
        ) : (
          <>
            <div className="ts-title">{t('orderImport.upload.title')}</div>
            <p className="ts-label-meta max-w-md uppercase text-text-muted">{t('orderImport.upload.columns')}</p>
            <Button variant="primary" onClick={() => input.current?.click()}>
              {t('import.upload.choose')}
            </Button>
          </>
        )}
        <input ref={input} type="file" accept={IMPORT_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t('import.upload.choose')} data-testid="order-import-file" onChange={(e) => (void start(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      {shown ? (
        <div data-testid="order-import-error" data-code={shown.code}>
          <FormAlert>{shown.message}</FormAlert>
        </div>
      ) : null}
    </div>
  );
}

function MappingStep({ result, jobId, onSaved, onBack }: { result: OrderImportPreviewResult; jobId: string; onSaved: (jobId: string) => void; onBack: () => void }) {
  const t = useT();
  const [map, setMap] = useState<Partial<Record<OrderImportField, string | null>>>(() => ({ ...result.mapping }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = ORDER_IMPORT_REQUIRED_FIELDS.filter((f) => !map[f]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api_.mapping(jobId, map);
      onSaved(r?.jobId ?? jobId);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="order-import-mapping">
      <div>
        <h2 className="ts-title">{t('import.mapping.title')}</h2>
        <p className="ts-label-meta mt-1 text-text-muted">{t('orderImport.mapping.context', { file: result.fileName, rows: result.totals.rows })}</p>
      </div>
      {result.missingColumns.length ? <FormAlert>{`${t('error.IMPORT_COLUMNS_MISSING', { columns: result.missingColumns.map((f) => t(`orderImport.field.${f}`)).join(', ') })}`}</FormAlert> : null}
      <ul className="divide-y divide-line-hairline rounded-card border border-line-edge">
        {ORDER_IMPORT_FIELDS.map((f) => (
          <li key={f} className="flex items-center gap-3 px-3 py-2 text-[13px]">
            <span className="w-40 shrink-0">
              {t(`orderImport.field.${f}`)}
              {ORDER_IMPORT_REQUIRED_FIELDS.includes(f) ? <span className="text-accent-alert"> *</span> : null}
            </span>
            <span aria-hidden className="text-text-muted">
              ←
            </span>
            <Select aria-label={t(`orderImport.field.${f}`)} value={map[f] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f]: e.target.value || null }))} className="!h-8 flex-1 text-[13px]">
              <option value="">{t('orderImport.mapping.ignore')}</option>
              {result.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {t('action.back')}
        </Button>
        <Button variant="primary" onClick={() => void save()} loading={busy} disabledReason={missing.length ? t('orderImport.mapping.missing', { fields: missing.map((f) => t(`orderImport.field.${f}`)).join(', ') }) : undefined} data-testid="order-import-mapping-save">
          {t('import.mapping.submit')}
        </Button>
      </div>
    </Card>
  );
}

function PreviewTable({ rows }: { rows: OrderImportPreviewRow[] }) {
  const t = useT();
  if (!rows.length) return <p className="ts-label-meta text-text-muted">{t('orderImport.noRow')}</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]" data-testid="order-import-rows">
        <thead>
          <tr className="ts-label-micro text-text-muted">
            <th className="px-3 py-2 text-start font-normal">{t('import.col.row')}</th>
            <th className="px-3 py-2 text-start font-normal">{t('orderImport.field.clientName')}</th>
            <th className="px-3 py-2 text-start font-normal">{t('orderImport.field.phone')}</th>
            <th className="px-3 py-2 text-start font-normal">{t('orderImport.field.wilaya')}</th>
            <th className="px-3 py-2 text-start font-normal">{t('orderImport.field.items')}</th>
            <th className="px-3 py-2 text-start font-normal">{t('import.col.error')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-hairline">
          {rows.slice(0, 200).map((r) => (
            <tr key={r.row} data-row-number={r.row} data-ok={r.ok || undefined}>
              <td className="px-3 py-2">
                <Ltr className="tabular-nums">{r.row}</Ltr>
              </td>
              <td className="px-3 py-2">{r.values.clientName ?? '—'}</td>
              <td className="px-3 py-2">
                <Ltr>{r.values.phone ?? '—'}</Ltr>
              </td>
              <td className="px-3 py-2">{r.values.wilaya ?? '—'}</td>
              <td className="px-3 py-2">
                <Ltr>{r.values.items.map((i) => `${i.sku}×${i.quantity}`).join('; ') || '—'}</Ltr>
              </td>
              <td className="px-3 py-2 text-accent-alert">{r.errors.map((e) => describeOrderRowError(t, e)).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
