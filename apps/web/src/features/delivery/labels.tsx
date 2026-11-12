'use client';
// Labels (DLV-06): Figma "DLV-06 / ORD-09 — Labels viewer (single · merged job · Djaber fallback)", DLG "Imprimer les
// bordereaux" (Orders & delivery) and DLG II "Bordereau indisponible".
// - `LabelViewer`: one parcel — loading PDF → courier label, or the Djaber A6 label when the courier gives none
//   (`LABEL_UNAVAILABLE` warning: "Réessayer de récupérer le bordereau transporteur" / Djaber label);
// - `PrintLabelsDialog`: many orders → one merged PDF job (`POST /shipments/labels`), unsent orders listed as ignored
//   (`SHIPMENT_NOT_CREATED`, announced before and listed by the job result), format A6 / thermal 100 × 150 / A5,
//   "Marquer « bordereau imprimé »", "Un PDF par commande" (ZIP) and "Inclure le récapitulatif interne" (M11);
// - `LabelJobViewer`: the job EN COURS n / m → PRÊT (Ouvrir · Télécharger) / PARTIEL (skipped rows) / ÉCHEC (Réessayer).
import { formatNumber } from '@djaber/shared';
import { Button, Checkbox, Dialog, FormAlert, LabelJobRow, Skeleton } from '@djaber/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RadioList, refusal, useOnOpen } from '@/features/orders/dialogs/common';
import { downloadUrl, isJobRunning, useJob } from '@/lib/jobs';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { uuid } from '@/lib/uuid';
import { deliveryApi } from './api';
import { LABEL_FORMAT_LIST, type LabelFormat, type LabelsResult } from './contracts';

/**
 * The PDF itself: embedded viewer + a plain link. The file is read once and shown from a `blob:` URL — signed storage
 * URLs may refuse to be framed by another origin (X-Frame-Options); the link opens the signed URL as is.
 */
function PdfFrame({ url, title }: { url: string; title: string }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setSrc(null);
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        made = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'application/pdf' }));
        if (alive) setSrc(made);
      })
      .catch(() => alive && setSrc(url));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return (
    <div className="flex flex-col gap-2">
      {src ? <iframe src={src} title={title} className="h-[50vh] w-full rounded-card border border-line-edge bg-white" data-testid="label-frame" /> : <Skeleton className="h-[50vh] w-full" />}
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-start ts-label-meta text-accent-inbound hover:underline">
        <ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden />
        {t('labels.openTab')}
      </a>
    </div>
  );
}

/* ---------- one parcel ---------- */
export function LabelViewer({ shipmentId, title, open, onClose, manual }: { shipmentId: string | null; title: string; open: boolean; onClose: () => void; /** self-delivery: the Djaber label IS the label (no fallback notice) */ manual?: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const [source, setSource] = useState<'auto' | 'djaber'>('auto');
  const [choice, setChoice] = useState<'retry' | 'djaber'>('djaber');
  useOnOpen(open, () => {
    setSource(manual ? 'djaber' : 'auto');
    setChoice('djaber');
  });
  const q = useQuery({
    queryKey: [ws, 'shipments', 'label', shipmentId, source],
    queryFn: () => deliveryApi.label(shipmentId!, { source, lang: locale }),
    enabled: open && !!shipmentId,
    staleTime: 60_000,
    retry: false,
  });
  const file = q.data?.file;
  const unavailable = !!q.data?.unavailable;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('labels.viewer.title')}
      description={title}
      closeLabel={t('action.close')}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          <Button variant="primary" disabled={!file} onClick={() => file && downloadUrl(file.url, file.fileName)} data-testid="label-print">
            <Printer className="size-4" aria-hidden />
            {t('action.print')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="label-viewer" data-state={q.isPending ? 'loading' : q.isError ? 'error' : unavailable ? 'fallback' : 'courier'}>
        {unavailable ? (
          <div className="flex flex-col gap-2 rounded-card border border-line-edge bg-ink-raised p-3" data-testid="label-unavailable">
            <p className="text-[14px] font-medium">{t('dialog.labelUnavailable.title')}</p>
            <p className="ts-label-micro !normal-case text-text-muted">{t('error.LABEL_UNAVAILABLE')}</p>
            <RadioList<'retry' | 'djaber'>
              label={t('dialog.labelUnavailable.title')}
              value={choice}
              onChange={(v) => {
                setChoice(v);
                if (v === 'retry') void q.refetch();
              }}
              options={[
                { value: 'retry', label: t('labels.unavailable.retry') },
                { value: 'djaber', label: t('labels.unavailable.djaber') },
              ]}
            />
          </div>
        ) : null}
        {q.isPending || q.isFetching ? (
          <div role="status" aria-label={t('labels.loading')} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-[50vh] w-full" />
          </div>
        ) : q.isError ? (
          <FormAlert>
            {refusal(q.error, t)}{' '}
            <button type="button" className="underline" onClick={() => (setSource('djaber'), void q.refetch())}>
              {t('labels.unavailable.djaber')}
            </button>
          </FormAlert>
        ) : file ? (
          <>
            <p className="ts-label-micro text-text-muted">{t(`labels.source.${file.source}`, { format: t(`labels.format.${file.format}`) })}</p>
            <PdfFrame url={file.url} title={title} />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- merged PDF job ---------- */
export function LabelJobViewer({ jobId, open, onClose, onRetry }: { jobId: string | null; open: boolean; onClose: () => void; onRetry?: () => void }) {
  const t = useT();
  const q = useJob<LabelsResult>(open ? jobId : null);
  const job = q.data;
  const result = job?.result ?? null;
  const running = !job || isJobRunning(job);
  const total = job?.total ?? null;
  const done = total ? Math.round(((job?.progress ?? 0) / 100) * total) : null;
  const state = running ? 'running' : job.status === 'failed' || job.status === 'cancelled' ? 'failed' : (result?.skipped.length ?? 0) > 0 || job.status === 'partial' ? 'partial' : 'ready';
  // "Un PDF par commande" ⇒ the job file is a ZIP (one PDF per order + recap): it is downloaded, never framed
  const zip = !!result && (result.onePdfPerOrder === true || result.fileName.toLowerCase().endsWith('.zip'));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('labels.job.title')}
      description={t('labels.job.description')}
      closeLabel={t('action.close')}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.close')}
          </Button>
          <Button variant="primary" disabled={!job?.resultUrl} onClick={() => job?.resultUrl && downloadUrl(job.resultUrl, result?.fileName)} data-testid="labels-print">
            <Printer className="size-4" aria-hidden />
            {t('action.print')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="labels-job" data-state={state} data-zip={zip || undefined}>
        {running ? (
          <LabelJobRow state="running" label={done !== null && total ? t('labels.job.running', { done, total }) : t('labels.job.runningShort')} text={t('labels.job.keepWorking')} />
        ) : state === 'failed' ? (
          <LabelJobRow
            state="failed"
            label={t('labels.job.failed')}
            text={job?.error ? job.error.message : t('error.REPORT_EXPORT_FAILED', { ref: '—' })}
            actions={
              onRetry ? (
                <Button size="sm" onClick={onRetry} data-testid="labels-retry">
                  {t('action.retry')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <LabelJobRow
              state="ready"
              label={t('labels.job.ready')}
              text={
                result
                  ? zip
                    ? t('carry.labels.zipFile', { file: result.fileName, files: formatNumber(result.files ?? result.count), pages: formatNumber(result.pages) })
                    : t('labels.job.file', { file: result.fileName, pages: formatNumber(result.pages) })
                  : undefined
              }
              actions={
                job?.resultUrl ? (
                  <>
                    {zip ? null : (
                      <Button size="sm" onClick={() => window.open(job.resultUrl!, '_blank', 'noopener')}>
                        {t('action.open')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => downloadUrl(job.resultUrl!, result?.fileName)}>
                      {t('action.download')}
                    </Button>
                  </>
                ) : undefined
              }
            />
            {result && result.djaberLabels > 0 ? <p className="ts-label-micro !normal-case text-text-muted">{t('labels.job.djaber', { count: result.djaberLabels })}</p> : null}
            {result?.skipped.length ? (
              <div className="flex flex-col gap-1.5" data-testid="labels-skipped">
                <LabelJobRow state="partial" label={t('labels.job.partial')} text={t('labels.job.skipped', { count: result.skipped.length })} />
                <ul className="ms-1 flex flex-col gap-0.5">
                  {result.skipped.map((s) => (
                    <li key={s.id} className="ts-label-micro !normal-case text-accent-starred">
                      {`${s.orderNumber ? `#${s.orderNumber}` : s.id} : ${t(`error.${s.code}`)}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {job?.resultUrl && !zip ? <PdfFrame url={job.resultUrl} title={t('labels.job.title')} /> : null}
          </>
        )}
        {q.isError ? <FormAlert>{refusal(q.error, t)}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- "Imprimer les bordereaux": options, ignored rows, then the job viewer ---------- */
export type LabelTarget = { id: string; label: string; sent: boolean };
export function PrintLabelsDialog({ open, orders, courier, onClose }: { open: boolean; orders: LabelTarget[]; courier?: string | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const key = useRef(uuid());
  const [format, setFormat] = useState<LabelFormat>('a6');
  const [markPrinted, setMarkPrinted] = useState(true);
  const [onePdfPerOrder, setOnePdfPerOrder] = useState(false);
  const [includeRecap, setIncludeRecap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  useOnOpen(open, () => {
    key.current = uuid();
    setFormat('a6');
    setMarkPrinted(true);
    setOnePdfPerOrder(false);
    setIncludeRecap(false);
    setError(null);
    setJobId(null);
  });
  const sent = orders.filter((o) => o.sent);
  const ignored = orders.filter((o) => !o.sent);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await deliveryApi.labels({ orderIds: orders.map((o) => o.id), format, markPrinted, onePdfPerOrder, includeRecap, lang: locale as 'fr' | 'ar' | 'en' }, key.current);
      key.current = uuid();
      setJobId(r.jobId);
    } catch (e) {
      setError(refusal(e, t));
    } finally {
      setBusy(false);
    }
  };
  // a new job id replaces this dialog by the job viewer
  const [viewer, setViewer] = useState(false);
  useEffect(() => setViewer(!!jobId), [jobId]);
  return (
    <>
      <Dialog
        open={open && !viewer}
        onOpenChange={(o) => !o && !busy && onClose()}
        title={t('labels.print.title')}
        description={courier ? t('labels.print.contextCourier', { count: sent.length, courier }) : t('labels.print.context', { count: sent.length })}
        closeLabel={t('action.close')}
        size="md"
        footer={
          <>
            {ignored.length ? (
              <p className="me-auto max-w-[55%] ts-label-micro !normal-case text-accent-starred" data-testid="labels-ignored">
                {t('labels.print.ignored', { count: ignored.length })}
              </p>
            ) : null}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void start()} loading={busy} disabled={!sent.length} data-testid="labels-submit">
              {t('action.printCount', { count: sent.length })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4" data-testid="labels-dialog">
          <RadioList<LabelFormat> label={t('labels.print.format')} value={format} onChange={setFormat} options={LABEL_FORMAT_LIST.map((f) => ({ value: f, label: t(`labels.print.format.${f}`, { count: sent.length }) }))} />
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={markPrinted} onChange={(e) => setMarkPrinted(e.target.checked)} />
            {t('labels.print.markPrinted')}
          </label>
          {/* M11: options of the Figma dialog (DLG "Imprimer les bordereaux") */}
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={onePdfPerOrder} onChange={(e) => setOnePdfPerOrder(e.target.checked)} data-testid="labels-one-pdf" />
            {t('carry.labels.onePdfPerOrder')}
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={includeRecap} onChange={(e) => setIncludeRecap(e.target.checked)} data-testid="labels-recap" />
            {t('carry.labels.includeRecap')}
          </label>
          {ignored.length ? (
            <ul className="flex flex-col gap-0.5 rounded-card border border-line-edge p-2.5">
              {ignored.map((o) => (
                <li key={o.id} className="ts-label-micro !normal-case text-text-muted">
                  {`${o.label} · ${t('error.SHIPMENT_NOT_CREATED')}`}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      </Dialog>
      <LabelJobViewer jobId={jobId} open={open && viewer} onClose={onClose} onRetry={() => (setJobId(null), void start())} />
    </>
  );
}
