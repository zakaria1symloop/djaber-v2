'use client';
// Call outcome fields (Figma ORD-07 step 2 "RÉSULTAT DE L'APPEL", DLG "Résultat de l'appel"): one `CallResult` value
// (each answer = one `OrderCall` row, 12 §20), the callback time when "Rappeler plus tard", the note.
import { formatDate, type AppLocale } from '@djaber/shared';
import { cn, Field, Input, onRadioGroupKeyDown, radioTabIndex, RadioCards, Textarea } from '@djaber/ui';
import { useState } from 'react';
import { useLocaleCode, useT } from '@/lib/i18n';
import { CALL_RESULTS, type CallResult } from '../contracts';
import { algiersTime, callbackPresets, isoToLocalInput, localInputToIso } from '../logic';

export type OutcomeValue = { result: CallResult | null; callbackAt: string | null; notes: string };
export const emptyOutcome = (): OutcomeValue => ({ result: null, callbackAt: null, notes: '' });

/** "Cet après-midi 16:00" / "Demain 10:00" / "Dans 1 h" chips + a free date-time ("Choisir"). */
export function CallbackPicker({ value, onChange, invalid, idPrefix = 'cb' }: { value: string | null; onChange: (iso: string | null) => void; invalid?: boolean; idPrefix?: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const [presets] = useState(() => callbackPresets());
  const [custom, setCustom] = useState(false);
  const chosen = presets.find((p) => value && Math.abs(p.at.getTime() - Date.parse(value)) < 60_000)?.key ?? null;
  const chip = (on: boolean) => cn('inline-flex h-9 items-center rounded-card border px-3 text-[13px]', on ? 'border-white bg-white text-black' : 'border-line-edge bg-ink-surface text-text-primary hover:border-line-lit');
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t('orders.callback.when')} className="flex flex-wrap gap-2">
        {presets.map((p, i) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={chosen === p.key && !custom}
            // journey re-run J14r-4: one Tab stop, the arrows move and choose
            tabIndex={radioTabIndex(i, custom || (!!value && !chosen) ? presets.length : presets.findIndex((x) => x.key === chosen))}
            onKeyDown={(e) => onRadioGroupKeyDown(e)}
            data-preset={p.key}
            onClick={() => {
              setCustom(false);
              onChange(p.at.toISOString());
            }}
            className={chip(chosen === p.key && !custom)}
          >
            {t(`orders.callback.preset.${p.key}`, { time: algiersTime(p.at) })}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom || (!!value && !chosen)} tabIndex={radioTabIndex(presets.length, custom || (!!value && !chosen) ? presets.length : presets.findIndex((x) => x.key === chosen))} onKeyDown={(e) => onRadioGroupKeyDown(e)} onClick={() => setCustom(true)} className={chip(custom || (!!value && !chosen))}>
          {t('orders.callback.preset.custom')}
        </button>
      </div>
      {custom || (value && !chosen) ? (
        <Input
          id={`${idPrefix}-at`}
          type="datetime-local"
          aria-label={t('orders.callback.when')}
          aria-invalid={invalid || undefined}
          value={value ? isoToLocalInput(value) : ''}
          onChange={(e) => onChange(localInputToIso(e.target.value))}
          className="[color-scheme:dark]"
        />
      ) : null}
      {value ? <p className="ts-label-micro text-text-muted">{t('orders.callback.at', { date: formatDate(value, locale), time: algiersTime(value) })}</p> : null}
    </div>
  );
}

export function OutcomeFields({ value, onChange, disabled, errors }: { value: OutcomeValue; onChange: (v: OutcomeValue) => void; disabled?: boolean; errors?: { result?: string; callbackAt?: string; notes?: string } }) {
  const t = useT();
  const descriptions: Partial<Record<CallResult, string>> = {
    picked_up: t('orders.call.result.picked_up.hint'),
    no_answer: t('orders.call.result.no_answer.hint'),
    callback: t('orders.call.result.callback.hint'),
    wrong_number: t('orders.call.result.wrong_number.hint'),
    rejected: t('orders.call.result.rejected.hint'),
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="ts-label-section text-text-muted">{t('orders.call.resultLabel')}</span>
        <RadioCards<CallResult>
          label={t('orders.call.resultLabel')}
          value={(value.result ?? '') as CallResult}
          onChange={(result) => onChange({ ...value, result, callbackAt: result === 'callback' ? value.callbackAt : null })}
          options={CALL_RESULTS.map((r) => ({ value: r, label: t(`orders.call.result.${r}.label`), description: descriptions[r], disabledReason: disabled ? ' ' : undefined }))}
        />
        {errors?.result ? (
          <p role="alert" className="text-[12px] text-accent-alert">
            {errors.result}
          </p>
        ) : null}
      </div>
      {value.result === 'callback' ? (
        <Field label={t('orders.callback.when')} error={errors?.callbackAt}>
          <CallbackPicker value={value.callbackAt} onChange={(callbackAt) => onChange({ ...value, callbackAt })} invalid={!!errors?.callbackAt} />
        </Field>
      ) : null}
      <Field label={t('orders.call.note')} htmlFor="call-note" error={errors?.notes}>
        <Textarea id="call-note" value={value.notes} maxLength={1000} disabled={disabled} onChange={(e) => onChange({ ...value, notes: e.target.value })} placeholder={t('orders.call.notePlaceholder')} className="min-h-16" />
      </Field>
    </div>
  );
}

/** Client-side check of an outcome before the call is logged. */
export function outcomeErrors(v: OutcomeValue, now = Date.now()): { result?: string; callbackAt?: string } {
  const e: { result?: string; callbackAt?: string } = {};
  if (!v.result) e.result = 'validation.required';
  if (v.result === 'callback') {
    if (!v.callbackAt) e.callbackAt = 'validation.required';
    else if (Date.parse(v.callbackAt) <= now) e.callbackAt = 'error.ORDER_CALLBACK_IN_PAST';
  }
  return e;
}
