'use client';
// "Étiquettes" — product label sheet (Figma "CAT-08 — Products — bulk bar + row actions menu" + product page menu; M2
// carry-over closed in M6): `POST /products/bulk/labels { ids, copies, withPrice, includeVariants }` → 202 job (A4 sheet,
// 3 × 8 labels: name, variant, SKU, price, QR of the SKU) followed by the job toast (Ouvrir when ready).
import { formatNumber } from '@djaber/shared';
import { Checkbox, Dialog, Field, FormAlert, NumberInput, toast } from '@djaber/ui';
import { useRef, useState } from 'react';
import { DialogFooter, refusal, useOnOpen } from '@/features/orders/dialogs/common';
import { deliveryApi } from '@/features/delivery/api';
import { useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, trackJob } from '@/lib/jobs';
import { uuid } from '@/lib/uuid';

export function ProductLabelsDialog({ open, ids, onClose, onStarted }: { open: boolean; ids: string[]; onClose: () => void; onStarted?: () => void }) {
  const t = useT();
  const key = useRef(uuid());
  const [copies, setCopies] = useState('1');
  const [withPrice, setWithPrice] = useState(true);
  const [variants, setVariants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOnOpen(open, () => {
    key.current = uuid();
    setCopies('1');
    setWithPrice(true);
    setVariants(true);
    setError(null);
  });
  const n = Number(copies);
  const invalid = !Number.isInteger(n) || n < 1 || n > 50;
  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await deliveryApi.productLabels({ ids, copies: n, withPrice, includeVariants: variants }, key.current);
      key.current = uuid();
      trackJob({
        jobId,
        started: t('toast.jobStarted'),
        progress: (job) => t('products.labels.progress', { pct: job.progress }),
        done: (job) => ({ message: t('products.labels.done'), action: job.resultUrl ? { label: t('action.open'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined }),
        failed: (job, e) => (job?.error ? `${job.error.message} (${job.error.code})` : refusal(e, t)),
      });
      onStarted?.();
      onClose();
    } catch (e) {
      const msg = refusal(e, t);
      setError(msg);
      toast({ tone: 'danger', message: msg });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('products.labels.title')}
      description={t('products.labels.context', { count: formatNumber(ids.length) })}
      closeLabel={t('action.close')}
      size="sm"
      footer={<DialogFooter onClose={onClose} busy={busy} onSubmit={() => void submit()} label={t('products.labels.submit')} disabled={invalid || !ids.length} />}
    >
      <div className="flex flex-col gap-3" data-testid="product-labels-dialog">
        <Field label={t('products.labels.copies')} htmlFor="lbl-copies" error={invalid ? t('products.labels.copiesRange') : undefined}>
          <NumberInput id="lbl-copies" value={copies} onValueChange={setCopies} maxDigits={2} className="max-w-24" />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={withPrice} onChange={(e) => setWithPrice(e.target.checked)} />
          {t('products.labels.withPrice')}
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={variants} onChange={(e) => setVariants(e.target.checked)} />
          {t('products.labels.variants')}
        </label>
        <p className="ts-label-micro !normal-case text-text-muted">{t('products.labels.note')}</p>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
