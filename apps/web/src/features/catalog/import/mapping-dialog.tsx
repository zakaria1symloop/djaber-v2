'use client';
// "Correspondance des colonnes" — Figma "DLG — GDS (stock) I — dialogs catalogue" (Correspondance des colonnes).
// One select per target field of `IMPORT_FIELDS` (file headers + "ignorer"), `name` and `price` required,
// `POST /products/import/mapping { jobId, mapping, updateExisting, saveMapping }` re-runs the preview.
import { IMPORT_FIELDS, IMPORT_REQUIRED_FIELDS, type ImportField, type ImportPreviewResult } from '@djaber/shared';
import { Button, Checkbox, Dialog, FormAlert, Select } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { catalogApi } from '../api';
import { autoMapping, duplicateHeaders, fileExtension, mappingPayload, missingRequiredFields } from './logic';

export function MappingDialog({
  open,
  onClose,
  jobId,
  result,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  result: Pick<ImportPreviewResult, 'fileName' | 'headers' | 'mapping' | 'updateExisting' | 'totals'>;
  /** the preview is being recomputed: follow `jobId` (a new id when the server returns one) */
  onSaved: (jobId: string) => void;
}) {
  const t = useT();
  const [mapping, setMapping] = useState<Record<ImportField, string | null>>(() => autoMapping(result.headers, result.mapping));
  const [updateExisting, setUpdateExisting] = useState(!!result.updateExisting);
  const [saveMapping, setSaveMapping] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: catalogApi.importMapping });

  useEffect(() => {
    if (!open) return;
    setMapping(autoMapping(result.headers, result.mapping));
    setUpdateExisting(!!result.updateExisting);
    setSaveMapping(false);
    setTouched(false);
    setError(null);
    // a new analysis (other job) resets the dialog; typing in it does not
  }, [open, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = missingRequiredFields(mapping);
  const duplicates = duplicateHeaders(mapping);
  const busy = save.isPending;
  const submit = async () => {
    setTouched(true);
    setError(null);
    if (missing.length || duplicates.length) return;
    try {
      const ref = await save.mutateAsync({ jobId, mapping: mappingPayload(mapping), updateExisting, saveMapping });
      onSaved(ref?.jobId ?? jobId);
    } catch (e) {
      // shown inside the dialog, the choices stay
      setError(errorMessage(e, t));
    }
  };

  const kind = fileExtension(result.fileName).toUpperCase() || 'CSV';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('import.mapping.title')}
      description={t('import.mapping.context', { type: kind, count: result.totals?.rows ?? 0 })}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <>
          <span className="ts-label-meta me-auto max-w-56 text-text-muted">{t('import.mapping.next')}</span>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.back')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="mapping-submit">
            {t('import.mapping.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="divide-y divide-line-hairline rounded-card border border-line-edge bg-ink-raised" data-testid="mapping-fields">
          {IMPORT_FIELDS.map((f) => {
            const required = IMPORT_REQUIRED_FIELDS.includes(f);
            const value = mapping[f] ?? '';
            const invalid = touched && ((required && !value) || (!!value && duplicates.includes(value)));
            const id = `map-${f}`;
            return (
              <li key={f} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)_1rem] items-center gap-3 px-3 py-1.5" data-field={f}>
                <label htmlFor={id} className="truncate text-[13px]">
                  {t(`import.field.${f}`)}
                  {required ? <span className="text-accent-alert"> *</span> : null}
                </label>
                <ArrowLeft className="size-3.5 text-text-muted rtl:-scale-x-100" aria-hidden />
                <Select id={id} value={value} disabled={busy} aria-invalid={invalid || undefined} className="!h-8 text-[13px]" onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))}>
                  <option value="">{t('import.mapping.ignore')}</option>
                  {result.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
                {value && !invalid ? <Check className="size-3.5 text-accent-money" aria-hidden /> : <span aria-hidden />}
              </li>
            );
          })}
        </ul>

        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <Checkbox checked={updateExisting} disabled={busy} onChange={(e) => setUpdateExisting(e.target.checked)} />
          {t('import.mapping.updateExisting')}
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <Checkbox checked={saveMapping} disabled={busy} onChange={(e) => setSaveMapping(e.target.checked)} />
          {t('import.mapping.save')}
        </label>

        {touched && missing.length ? <FormAlert>{`${t('error.IMPORT_COLUMNS_MISSING', { columns: missing.map((f) => t(`import.field.${f}`)).join(', ') })}`}</FormAlert> : null}
        {touched && duplicates.length ? <FormAlert>{t('import.mapping.duplicate', { columns: duplicates.join(', ') })}</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
