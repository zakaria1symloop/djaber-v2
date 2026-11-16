'use client';
// Building blocks of the "DLG — Platform admin — dialogs catalogue": one dialog frame (title, grey context line, fields,
// mono rule note, inline server error, Annuler + primary / destructive action), the mandatory reason field (≥ 10 chars →
// AuditLog.reason, `ADMIN_REASON_REQUIRED`) and the mapping of the error envelope onto the fields (content preserved).
import { Button, Dialog, Field, FormAlert, FrameNote, Input, Textarea } from '@djaber/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';

export const REASON_MIN = 10;
export const reasonOk = (r: string) => r.trim().length >= REASON_MIN;

export type ServerErrors = { form: string | null; fields: Record<string, string> };
export const NO_ERRORS: ServerErrors = { form: null, fields: {} };

/**
 * One field message. `validation.range` names its bounds only when the envelope carries them (`params.min` / `max`); without
 * them it reads « Valeur hors limites. », never « Valeur hors limites (–) » (full-test 15/11 ADMIN-08).
 */
const fieldText = (t: ReturnType<typeof useT>, key: string, params: Record<string, string | number> | undefined): string => {
  if (key === 'validation.range' && (params?.min === undefined || params?.max === undefined)) return t('admin.validation.range');
  return fieldError(t, key, params) ?? key;
};

/** Error envelope → per-field messages (translated) + a form-level message for the rest. */
export function toServerErrors(e: unknown, t: ReturnType<typeof useT>, known: readonly string[], codeToField: Record<string, string> = {}): ServerErrors {
  if (!(e instanceof ApiError)) return { form: errorMessage(e, t), fields: {} };
  const fields: Record<string, string> = {};
  let unknown = false;
  for (const [f, key] of Object.entries(e.body.fields ?? {})) {
    if (known.includes(f)) fields[f] = e.code !== 'VALIDATION_ERROR' && !key.startsWith('validation.') ? errorMessage(e, t) : fieldText(t, key, e.body.params ?? undefined);
    else unknown = true;
  }
  const direct = codeToField[e.code];
  if (direct) return { form: null, fields: { ...fields, [direct]: errorMessage(e, t) } };
  if (Object.keys(fields).length && !unknown) return { form: null, fields };
  return { form: errorMessage(e, t), fields };
}

export function AdminDialog({
  open,
  onClose,
  title,
  context,
  size = 'md',
  children,
  note,
  error,
  submitLabel,
  onSubmit,
  destructive,
  disabled,
  pending,
  extra,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** grey line under the title ("Espace Tech Store Alger · essai") */
  context?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  note?: ReactNode;
  error?: string | null;
  submitLabel: string;
  onSubmit: () => void;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
  /** extra footer button(s) before the primary ("Aperçu carte", "Tester") */
  extra?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={title}
      description={context}
      closeLabel={t('action.close')}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          {extra}
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onSubmit} loading={pending} disabled={disabled} data-testid={testId ? `${testId}-submit` : undefined}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        data-testid={testId}
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !pending) onSubmit();
        }}
      >
        {children}
        {note ? <FrameNote>{note}</FrameNote> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** "RAISON *" — at least 10 characters, written to AuditLog.reason. */
export function ReasonField({ value, onChange, error, label, placeholder, multiline = false, name = 'reason' }: { value: string; onChange: (v: string) => void; error?: string; label?: string; placeholder?: string; multiline?: boolean; name?: string }) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const short = touched && value.trim().length > 0 && !reasonOk(value);
  return (
    <Field label={label ?? t('admin.common.reason')} required htmlFor={`f-${name}`} hint={error || short ? undefined : t('admin.common.reasonHint')} error={error ?? (short ? t('admin.common.reasonShort') : undefined)}>
      {multiline ? (
        <Textarea id={`f-${name}`} name={name} rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)} />
      ) : (
        <Input id={`f-${name}`} name={name} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={() => setTouched(true)} />
      )}
    </Field>
  );
}

/** Resets a dialog's local state each time it opens. */
export function useOnOpen(open: boolean, reset: () => void) {
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
