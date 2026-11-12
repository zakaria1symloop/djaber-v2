'use client';
// Shared pieces of the order dialogs (Figma "DLG — Orders & delivery", "DLG — Orders, delivery & clients II"): the
// submit hook (server error inline inside the open dialog, content preserved, 409 → conflict), the footer, the
// vertical radio list and the context line "#CMD-1042 · Nouvelle · Amina B. · 9 400 DA".
import { formatMoney } from '@djaber/shared';
import { Button, cn } from '@djaber/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { conflictOf } from '@/lib/conflict';
import { errorMessage } from '@/lib/forms';
import { useT, type TFunction } from '@/lib/i18n';
import { uuid } from '@/lib/uuid';
import type { Order } from '../contracts';

export type DialogBaseProps = { order: Order; onClose: () => void; onDone: (order?: Order | null) => void | Promise<void> };

/** Message of a refused write: the localized server message + its code ("… (ORDER_PAYMENT_LOCKED)"). */
export const refusal = (e: unknown, t: TFunction): string => errorMessage(e, t);

/**
 * One submit of a dialog: busy flag, inline error, field errors of the envelope, conflict (409 CONFLICT) and the
 * Idempotency-Key created when the dialog opened (kept across retries, renewed after a success).
 */
export function useDialogSubmit<T>(run: (key: string) => Promise<T>) {
  const t = useT();
  const key = useRef(uuid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<ReturnType<typeof conflictOf<Order>>>(null);
  const submit = async (): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await run(key.current);
      key.current = uuid();
      return r;
    } catch (e) {
      const c = conflictOf<Order>(e);
      if (c) setConflict(c);
      else {
        setError(refusal(e, t));
        if (e instanceof ApiError) setFields(e.body.fields ?? {});
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const fieldError = (name: string) => (fields[name] ? (t.has(fields[name]!) ? t(fields[name]!, { max: '', min: '' }) : fields[name]) : undefined);
  return { submit, busy, error, setError, fieldError, conflict, clearConflict: () => setConflict(null) };
}

/** Resets a dialog's local state each time it opens on an order. */
export function useOnOpen(open: boolean, reset: () => void) {
  const ref = useRef(reset);
  ref.current = reset;
  useEffect(() => {
    if (open) ref.current();
  }, [open]);
}

export function DialogFooter({ onClose, busy, onSubmit, label, danger, disabled, disabledReason, closeLabel, note }: { onClose: () => void; busy: boolean; onSubmit: () => void; label: string; danger?: boolean; disabled?: boolean; disabledReason?: string; closeLabel?: string; note?: React.ReactNode }) {
  const t = useT();
  return (
    <>
      {note ? <p className="me-auto max-w-[55%] ts-label-micro !normal-case text-text-muted">{note}</p> : null}
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        {closeLabel ?? t('action.cancel')}
      </Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={onSubmit} loading={busy} disabled={disabled} disabledReason={disabledReason} data-testid="dialog-submit">
        {label}
      </Button>
    </>
  );
}

/** Vertical radio list of the dialogs ("○ Client injoignable (3 appels)" + grey sub line). */
export function RadioList<V extends string>({ label, value, onChange, options, disabled }: { label: string; value: V | null; onChange: (v: V) => void; options: { value: V; label: string; description?: string; tone?: 'danger' }[]; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className="flex items-start gap-2.5 rounded-[6px] px-1.5 py-1.5 text-start hover:bg-ink-raised disabled:opacity-50"
          >
            <span aria-hidden className={cn('mt-1 size-3 shrink-0 rounded-full border', on ? 'border-white bg-white' : 'border-text-muted')} />
            <span className="min-w-0">
              <span className={cn('block text-[13px]', o.tone === 'danger' && 'text-accent-alert')}>{o.label}</span>
              {o.description ? <span className="block ts-label-micro !normal-case text-text-muted">{o.description}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "#CMD-1042 · Nouvelle · Amina B. · 9 400 DA" */
export const orderContext = (t: TFunction, o: Pick<Order, 'number' | 'status' | 'clientName' | 'total'>): string =>
  [`#${o.number}`, t(`enum.Order.status.${o.status}`), o.clientName, formatMoney(o.total)].join(' · ');
