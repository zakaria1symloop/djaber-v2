'use client';
// M5 delivery kit (Figma DLV-01/03 — Delivery — fee grid): price cell of the editable fee grid (saved on blur, per-cell
// saving / saved / error state) and the free-delivery rule bar. All copy comes in through props; logical CSS only.
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { MoneyInput, NumberInput } from './inputs';
import { cn, Switch } from './primitives';

export type CellState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/* ---------- Price cell: integer DZD, committed on blur / Enter, Escape restores ---------- */
export function FeeCell({
  value,
  onCommit,
  label,
  disabled,
  state = 'idle',
  invalid,
  onRefused,
  className,
}: {
  /** stored amount */
  value: number;
  /** called with the new amount when it differs from `value` */
  onCommit: (next: number) => void;
  label: string;
  disabled?: boolean;
  state?: CellState;
  invalid?: boolean;
  /**
   * journey J08r-1: the entry was not a clean integer (a minus, a letter, a decimal part): nothing is saved, the stored
   * amount comes back and the screen says what is accepted (« 1e3 » typed key by key was saved as 13 DA, « 1.5 » as 1)
   */
  onRefused?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const refused = React.useRef(false);
  const commit = () => {
    if (refused.current) {
      refused.current = false;
      setDraft(String(value));
      return onRefused?.();
    }
    const n = draft === '' ? value : Number(draft);
    if (draft === '') setDraft(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <div className={cn('relative w-24', className)}>
      <NumberInput
        aria-label={label}
        value={draft}
        onValueChange={setDraft}
        onRefusedEntry={() => (refused.current = true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(String(value));
        }}
        disabled={disabled}
        aria-invalid={invalid || state === 'error' || undefined}
        maxDigits={7}
        className={cn('!h-8 text-[13px]', state === 'saved' && 'border-accent-money/60', (state === 'dirty' || state === 'saving') && 'border-accent-money')}
      />
    </div>
  );
}

/** Row status icon at the end of a fee grid row. */
export function RowSaveState({ state, labels }: { state: CellState; labels: Record<'saving' | 'saved' | 'error', string> }) {
  if (state === 'saving') return <Loader2 role="status" aria-label={labels.saving} className="size-3.5 animate-spin text-text-muted" />;
  if (state === 'saved') return <Check role="status" aria-label={labels.saved} className="size-3.5 text-accent-money" />;
  if (state === 'error') return <TriangleAlert role="alert" aria-label={labels.error} className="size-3.5 text-accent-alert" />;
  return null;
}

/* ---------- "● Livraison offerte à partir de [5 000] DA de sous-total · appliqué par l'IA et le formulaire de commande" ---------- */
export function FreeDeliveryBar({
  enabled,
  onEnabledChange,
  amount,
  onAmountCommit,
  label,
  hint,
  switchLabel,
  amountLabel,
  currency = 'DA',
  disabled,
  saving,
  error,
  onAmountRefused,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** current threshold (null when off) */
  amount: number | null;
  onAmountCommit: (n: number) => void;
  label: string;
  hint: string;
  switchLabel: string;
  amountLabel: string;
  currency?: string;
  disabled?: boolean;
  saving?: boolean;
  error?: string | null;
  /**
   * journey J08r-1: the typed threshold is not an integer above 0 (« -5 », « 1e3 », « 1.5 », « 0 »): nothing is saved, the
   * saved amount comes back (the rule stays as it was — « -5 » used to switch it off) and the screen says what is accepted.
   * An emptied field just gets its saved amount back.
   */
  onAmountRefused?: () => void;
}) {
  const [draft, setDraft] = React.useState(amount === null ? '' : String(amount));
  React.useEffect(() => setDraft(amount === null ? '' : String(amount)), [amount]);
  const refused = React.useRef(false);
  const commit = () => {
    const bad = refused.current || (draft !== '' && !(Number(draft) > 0));
    refused.current = false;
    if (bad || draft === '') {
      setDraft(amount === null ? '' : String(amount));
      return bad ? onAmountRefused?.() : undefined;
    }
    if (Number(draft) !== amount) onAmountCommit(Number(draft));
  };
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-edge bg-ink-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} label={switchLabel} disabled={disabled || saving} />
        <span className="text-[14px] font-medium">{label}</span>
        <div className="w-32">
          {/* journey J08-1: the threshold is an integer DZD amount — the money field (a minus sign or a letter is refused) */}
          <MoneyInput
            aria-label={amountLabel}
            value={draft}
            onValueChange={setDraft}
            onRefusedEntry={() => (refused.current = true)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            currency={currency}
            disabled={disabled || saving || !enabled}
            className="!h-9 text-[13px]"
          />
        </div>
        <span className="ts-label-meta text-text-muted">{hint}</span>
        {saving ? <Loader2 className="size-3.5 animate-spin text-text-muted" aria-hidden /> : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-accent-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
