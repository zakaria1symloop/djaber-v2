'use client';
// Inputs added in M2 (Figma CAT-01, CAT-08 filter panel, GDS-01 adjust dialog): <Ltr>, number / money fields,
// quantity stepper, search field, combobox, radio cards, progress bar. All copy comes in through props.
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Minus, Plus, Search, X } from 'lucide-react';
import * as React from 'react';
import { parseIntegerInput } from './number-parse';
import { onRadioGroupKeyDown, radioTabIndex } from './radio-keys';
import { cn, Input } from './primitives';

/* ---------- <Ltr>: numbers, phones, SKUs, amounts keep their reading order in Arabic ---------- */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('inline-block', className)}>
      {children}
    </bdi>
  );
}

/**
 * Writes a value into an input as if it had been typed, so the React `onChange` sees it (controlled state as well as
 * react-hook-form `register`). Used to format a field when it loses focus.
 */
export function commitInputValue(el: HTMLInputElement, value: string) {
  if (el.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- Date field: typing the year does not reset it ---------- */
/**
 * A value a date field may hand over: empty (cleared) or a whole date with a 4-digit year from 1900 — while the year is
 * typed the browser reports `0002-10-21`, `0020-10-21`, `0202-10-21` before `2026-10-21`.
 */
export const isCommittableDate = (v: string) => v === '' || /^(19|20)\d{2}-\d{2}-\d{2}$/.test(v);

export type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void };

/**
 * `<input type="date">` whose value lives in the URL (filters) or any store that answers later: it keeps what is being
 * typed and hands over whole dates only (tester report 2026-10-20: every date filter reset when the year was typed —
 * the half-typed year was refused, the field went back to its old value and lost the typing).
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput({ value, onValueChange, onBlur, className, ...rest }, ref) {
  const [draft, setDraft] = React.useState(value);
  const committed = React.useRef(value);
  React.useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft(value);
  }, [value]);
  return (
    <Input
      ref={ref}
      type="date"
      value={draft}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (!isCommittableDate(v) || v === committed.current) return;
        committed.current = v;
        onValueChange(v);
      }}
      onBlur={(e) => {
        // a year left half-typed goes back to the last whole date
        if (!isCommittableDate(draft)) setDraft(committed.current);
        onBlur?.(e);
      }}
      className={cn('[color-scheme:dark]', className)}
      {...rest}
    />
  );
});

/* ---------- Email field: email keyboard + autocomplete, LTR, trimmed and lower-cased on blur ---------- */
export type EmailInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;
/** `type="email"`, `inputMode="email"`, `autoComplete="email"` (overridable), left-to-right, no spell check or
 * auto-capitalisation; the value is trimmed and lower-cased when the field loses focus (as the API stores it). */
export const EmailInput = React.forwardRef<HTMLInputElement, EmailInputProps>(function EmailInput({ onBlur, ...rest }, ref) {
  return (
    <Input
      ref={ref}
      type="email"
      inputMode="email"
      autoComplete="email"
      dir="ltr"
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      maxLength={254}
      {...rest}
      onBlur={(e) => {
        if (!e.currentTarget.readOnly && !e.currentTarget.disabled) commitInputValue(e.currentTarget, e.currentTarget.value.trim().toLowerCase());
        onBlur?.(e);
      }}
    />
  );
});

/* ---------- Code field (SKU, reference, invoice / tracking number, shortcut): LTR, no autofill / spell check ---------- */
export const CodeInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function CodeInput(props, ref) {
  return <Input ref={ref} dir="ltr" autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off" {...props} />;
});

/* ---------- URL field: url keyboard, LTR, trimmed on blur ---------- */
export const UrlInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(function UrlInput({ onBlur, ...rest }, ref) {
  return (
    <Input
      ref={ref}
      type="url"
      inputMode="url"
      autoComplete="url"
      dir="ltr"
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      {...rest}
      onBlur={(e) => {
        if (!e.currentTarget.readOnly && !e.currentTarget.disabled) commitInputValue(e.currentTarget, e.currentTarget.value.trim());
        onBlur?.(e);
      }}
    />
  );
});

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/*
 * ---------- Integer field: grouped by thousands while typing, optional suffix (DA, %, unités) ----------
 * Full-test 15/11 (ORDERS-01, PRODUCTS-01, DELIVERY-01, STOCK-02, SETTINGS-09, SALES-CASH-07): what is typed is read by
 * `parseIntegerInput` — « 2 500,00 » is 2500 (the decimal part shows while typing and goes when the field loses focus, never
 * glued to the integer); a minus sign, a letter or one digit too many is refused (the field keeps its value) instead of being
 * stripped. `allowNegative`: a leading « - » is accepted (value « -12 »).
 */
export type NumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** the integer as text: digits, with a leading « - » only when `allowNegative` ('' = empty) */
  value: string;
  onValueChange: (digits: string) => void;
  suffix?: string;
  maxDigits?: number;
  allowNegative?: boolean;
};
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, suffix, maxDigits = 9, allowNegative = false, className, onBlur, ...rest },
  ref,
) {
  const inner = React.useRef<HTMLInputElement | null>(null);
  // number of digits before the caret after the last keystroke: the caret is put back there once the value is regrouped
  const caret = React.useRef<number | null>(null);
  // the decimal part being typed (« ,5 »): shown, never part of the value, dropped on blur
  const [fraction, setFraction] = React.useState('');
  const shown = group(value) + fraction;
  // journey J07 / J05: a refused key (minus, letter, one digit too many) or a dropped decimal part is shown by a short red
  // ring (it was silent); the caret of a refused key is put back in the same render (a requestAnimationFrame could land
  // after the next key when typing fast)
  const [refused, setRefused] = React.useState(0);
  const [flash, setFlash] = React.useState(false);
  const back = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!refused) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(id);
  }, [refused]);
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (el && back.current !== null && document.activeElement === el) el.setSelectionRange(back.current, back.current);
    back.current = null;
  }, [refused]);
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let pos = 0;
    // journey J01-1: a caret in the decimal part (« 12,| ») goes to the end — it was put back before the comma, so the next
    // digit landed in the integer part (« 12,5 » typed key by key became 125)
    if (caret.current === Number.POSITIVE_INFINITY) pos = shown.length;
    else for (let digits = 0; pos < shown.length && digits < caret.current; pos++) if (/\d/.test(shown[pos]!)) digits++;
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [shown]);
  return (
    <div className="relative" dir="ltr">
      <Input
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        inputMode={allowNegative ? 'text' : 'numeric'}
        autoComplete="off"
        value={shown}
        onChange={(e) => {
          const raw = e.target.value;
          const at = e.target.selectionStart ?? raw.length;
          // journeys J05 / J07 / J08: a minus is kept even where negatives are not allowed — refusing only the « - » key let
          // « -100 » become +100 (a −5 DA free-delivery threshold saved as 5). The field shows it as invalid and the form /
          // the server refuse the negative amount with their own message
          const r = parseIntegerInput(raw, { allowNegative: true, maxDigits, caret: at });
          if (!r.ok) {
            // refused keystroke: the value stays, the caret goes back where it was, the field flashes
            back.current = Math.max(0, at - (raw.length - shown.length));
            setRefused((n) => n + 1);
            return;
          }
          // the caret is in (or right after) the decimal part when it is past the separator of the typed text
          const sep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
          caret.current = r.fraction && sep >= 0 && at > sep ? Number.POSITIVE_INFINITY : r.caretDigits;
          setFraction(r.fraction);
          if (r.value !== value) onValueChange(r.value);
        }}
        onBlur={(e) => {
          // a decimal part with a non-zero digit is dropped: the merchant sees it happen
          if (/[1-9]/.test(fraction)) setRefused((n) => n + 1);
          setFraction('');
          if (value === '-') onValueChange('');
          onBlur?.(e);
        }}
        data-refused={flash || undefined}
        {...rest}
        aria-invalid={(!allowNegative && value.startsWith('-')) || rest['aria-invalid'] || undefined}
        className={cn('tabular-nums transition-shadow', suffix && 'pe-12', (flash || (!allowNegative && value.startsWith('-'))) && 'ring-2 ring-accent-alert', className)}
      />
      {suffix ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center ts-label-micro text-text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

/** Integer DZD amount (`12 500 DA`). */
export const MoneyInput = React.forwardRef<HTMLInputElement, Omit<NumberInputProps, 'suffix'> & { currency?: string }>(function MoneyInput(
  { currency = 'DA', ...rest },
  ref,
) {
  return <NumberInput ref={ref} suffix={currency} {...rest} />;
});

/* ---------- Quantity stepper (− n +): quick-edit sheet, adjust dialogs ---------- */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 9_999_999,
  disabled,
  disabledReason,
  labels,
  tone,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  disabledReason?: string;
  labels: { decrease: string; increase: string; value: string };
  tone?: 'warning' | 'danger';
  className?: string;
}) {
  const off = disabled || !!disabledReason;
  // full-test 15/11 STOCK-01 / SALES-CASH-07 / STOCK-02: while the field has focus it shows what is typed (an erased field
  // stays empty, « 2.5 » shows « 2.5 » but counts 2, never 25; « -3 » is refused); the value is clamped to min / max at
  // once for the totals, and the field shows it when it loses focus — « erase then type 5 » is 5, not 15
  const [draft, setDraft] = React.useState<string | null>(null);
  const btn = 'flex size-7 items-center justify-center text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div dir="ltr" title={disabledReason} className={cn('inline-flex h-8 items-center rounded-card border border-line-edge bg-ink-surface', className)}>
      <button type="button" aria-label={labels.decrease} className={btn} disabled={off || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="size-3.5" aria-hidden />
      </button>
      <input
        aria-label={labels.value}
        inputMode="numeric"
        disabled={off}
        value={draft ?? String(value)}
        onChange={(e) => {
          const r = parseIntegerInput(e.target.value, { allowNegative: min < 0, maxDigits: String(Math.abs(max)).length });
          if (!r.ok) return;
          setDraft(r.value + r.fraction);
          const n = r.value === '' || r.value === '-' ? min : Number(r.value);
          const next = Math.min(max, Math.max(min, n));
          if (next !== value) onChange(next);
        }}
        onBlur={() => setDraft(null)}
        className={cn(
          'h-full w-10 bg-transparent text-center text-[13px] font-semibold tabular-nums focus:outline-none disabled:opacity-60',
          tone === 'warning' && 'text-accent-starred',
          tone === 'danger' && 'text-accent-alert',
        )}
      />
      <button type="button" aria-label={labels.increase} className={btn} disabled={off || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/* ---------- Search field of a list (Ctrl+K focuses it: `data-list-search`), debounced ---------- */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  debounceMs = 300,
  className,
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
  debounceMs?: number;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const last = React.useRef(value);
  // an outside change (chip removed, "clear all", back navigation) replaces the draft
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setDraft(value);
    }
  }, [value]);
  React.useEffect(() => {
    if (draft === last.current) return;
    const id = window.setTimeout(() => {
      last.current = draft;
      onChange(draft);
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [draft, debounceMs, onChange]);
  return (
    <div role="search" className={cn('relative min-w-0 flex-1', className)}>
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      <Input data-list-search type="search" aria-label={label} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} className="ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden" />
      {draft ? (
        <button type="button" aria-label={clearLabel} onClick={() => setDraft('')} className="absolute end-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-text-muted hover:text-text-primary">
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Combobox: searchable single select (category, unit, product, agent…) ---------- */
/** `keywords`: more text the search matches (journey J14-5: the other-language name of a commune), never shown */
export type ComboOption = { value: string; label: string; hint?: string; keywords?: string; disabled?: boolean };

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Focus the next (1) or previous (-1) Tab stop of the page after `from`, as the Tab key would. */
const focusAfter = (from: HTMLElement | null, dir: 1 | -1) => {
  if (!from) return;
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((x) => x.getClientRects().length > 0 && !x.closest('[inert], [aria-hidden="true"]'));
  const i = all.indexOf(from);
  (all[i + dir] ?? from).focus();
};
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  onSearch,
  loading,
  disabled,
  invalid,
  footer,
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null, option: ComboOption | null) => void;
  options: ComboOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  /** when set, a first row clears the value */
  clearLabel?: string;
  /** server-side search: called with the typed text (the caller debounces and passes new `options`) */
  onSearch?: (q: string) => void;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** extra row under the list (e.g. "+ Unité personnalisée") */
  footer?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const tabOut = React.useRef<0 | 1 | -1>(0);
  const selected = options.find((o) => o.value === value) ?? null;
  const shown = React.useMemo(() => {
    if (onSearch || !q.trim()) return options;
    const needle = q.trim().toLowerCase();
    return options.filter((o) => `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(needle));
  }, [options, q, onSearch]);
  const rows: (ComboOption | null)[] = clearLabel ? [null, ...shown] : shown;
  const pick = (o: ComboOption | null) => {
    if (o?.disabled) return;
    onChange(o ? o.value : null, o);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQ('');
          setActive(0);
          onSearch?.('');
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-card border border-line-edge bg-ink-surface px-3 text-start text-[14px]',
            'focus:border-line-lit focus:outline-none focus:ring-1 focus:ring-accent-inbound disabled:opacity-50 aria-[invalid=true]:border-accent-alert',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-text-muted')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={(e) => {
            if (!tabOut.current) return;
            e.preventDefault();
            focusAfter(trigger.current, tabOut.current);
            tabOut.current = 0;
          }}
          className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-56 rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl"
        >
          {/* journey J14-5: Tab past the last control (Shift+Tab before the first) closes the list and goes on to the next
              field, as from the closed picker (the popover looped the focus on its search: 20 Tabs stayed in it) */}
          <div
            onKeyDownCapture={(e) => {
              if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter((x) => x.getClientRects().length > 0);
              if (document.activeElement !== (e.shiftKey ? items[0] : items[items.length - 1])) return;
              e.preventDefault();
              e.stopPropagation();
              tabOut.current = e.shiftKey ? -1 : 1;
              setOpen(false);
            }}
          >
          <input
            autoFocus
            aria-label={searchPlaceholder}
            aria-controls={listId}
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              onSearch?.(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (rows.length) pick(rows[active] ?? null);
              }
            }}
            className="mb-1 h-9 w-full rounded-[6px] border border-line-hairline bg-ink-surface px-2.5 text-[13px] placeholder:text-text-muted focus:border-line-lit focus:outline-none"
          />
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto">
            {rows.length === 0 ? <li className="px-2.5 py-2 text-[13px] text-text-muted">{loading ? '…' : emptyLabel}</li> : null}
            {rows.map((o, i) => (
              <li
                key={o ? o.value : '__clear'}
                role="option"
                aria-selected={(o?.value ?? null) === value}
                aria-disabled={o?.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-2 text-[13px]',
                  i === active && 'bg-ink-raised-high',
                  o?.disabled && 'cursor-not-allowed opacity-45',
                  !o && 'text-text-secondary',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o ? o.label : clearLabel}</span>
                {o?.hint ? <span className="ts-label-meta shrink-0 text-text-muted">{o.hint}</span> : null}
                {o && o.value === value ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
              </li>
            ))}
          </ul>
          {footer ? <div className="mt-1 border-t border-line-hairline pt-1">{footer}</div> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------- Radio cards (Entrée / Sortie / Définir, Archiver / Supprimer définitivement) ---------- */
export function RadioCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = 3,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string; disabledReason?: string }[];
  label: string;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            // journey J14-8 c: one Tab stop for the group, the arrow keys move and choose (WAI-ARIA radio group)
            tabIndex={radioTabIndex(i, options.findIndex((x) => x.value === value))}
            onKeyDown={(e) => onRadioGroupKeyDown(e)}
            disabled={!!o.disabledReason}
            title={o.disabledReason}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-col gap-1 rounded-card border bg-ink-surface px-3 py-2.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'border-signal-live' : 'border-line-edge hover:border-line-lit',
            )}
          >
            <span className="flex items-center gap-2 text-[14px] font-medium">
              <span aria-hidden className={cn('size-2.5 rounded-full border', on ? 'border-white bg-white' : 'border-text-muted')} />
              {o.label}
            </span>
            {o.description || o.disabledReason ? <span className="ts-label-meta text-text-muted">{o.disabledReason ?? o.description}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Progress bar (import analysis, job toasts, uploads) ---------- */
export function ProgressBar({ value, label, className, tone = 'live' }: { value: number | null; label: string; className?: string; tone?: 'live' | 'danger' }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-ink-raised-high', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', tone === 'danger' ? 'bg-accent-alert' : 'bg-signal-live', pct === null && 'w-1/3 animate-pulse')}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
