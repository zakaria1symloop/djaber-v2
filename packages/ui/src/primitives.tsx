'use client';
// Djaber design system primitives (Figma "REF — Component sheet"). Dark only, logical CSS properties only (RTL safe).
import { clsx, type ClassValue } from 'clsx';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

export const cn = (...v: ClassValue[]) => clsx(v);

/* ---------- Button ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** shown as `title` and sets aria-disabled when the action is unavailable (disabled reason, CLAUDE.md rule 7) */
  disabledReason?: string;
};
const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-white text-black hover:bg-white/90 border border-white',
  secondary: 'bg-ink-surface text-text-primary border border-line-edge hover:border-line-lit hover:bg-ink-raised',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-ink-raised border border-transparent',
  danger: 'bg-accent-alert text-black hover:bg-accent-alert/90 border border-accent-alert',
};
// Phones (< 640): a button never gets wider than its container — a long label ("Remplir depuis la photo (nom,
// description, catégorie)") wraps on two lines instead of pushing the page sideways; one-line buttons keep their height.
const BUTTON_BASE =
  'inline-flex max-w-full items-center justify-center gap-2 rounded-card font-medium whitespace-nowrap transition-colors [&>svg]:shrink-0 ' +
  'max-sm:whitespace-normal max-sm:text-center ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-inbound ' +
  'disabled:opacity-45 disabled:cursor-not-allowed';
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] max-sm:h-auto max-sm:min-h-8 max-sm:py-1',
  md: 'h-10 px-4 text-[14px] max-sm:h-auto max-sm:min-h-10 max-sm:py-2',
};
/** Button look for a link (`<Link className={buttonClass({ variant: 'primary' })}>`): never nest a button inside an anchor. */
export const buttonClass = ({ variant = 'secondary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) =>
  cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON[variant], className);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, disabledReason, className, children, type = 'button', ...rest },
  ref,
) {
  const off = disabled || loading || !!disabledReason;
  return (
    <button
      ref={ref}
      type={type}
      disabled={off}
      aria-disabled={off || undefined}
      aria-busy={loading || undefined}
      title={disabledReason ?? rest.title}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, children, ...rest },
  ref,
) {
  return (
    <Button ref={ref} aria-label={label} title={label} className={cn('!px-0 w-10', rest.size === 'sm' && 'w-8', className)} {...rest}>
      {children}
    </Button>
  );
});

/* ---------- Form controls ---------- */
const CONTROL =
  'w-full rounded-card bg-ink-surface border border-line-edge px-3 text-[14px] text-text-primary placeholder:text-text-muted ' +
  'focus:outline-none focus:border-line-lit focus:ring-1 focus:ring-accent-inbound disabled:opacity-50 aria-[invalid=true]:border-accent-alert';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...rest} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL, 'min-h-24 py-2', className)} {...rest} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-10 pe-8 appearance-none bg-no-repeat', className)} {...rest}>
      {children}
    </select>
  );
});

export function Label({ className, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('ts-label-meta uppercase text-text-secondary', className)} {...rest} />;
}

/** Label + control + inline error / hint. `error` is already translated. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  // full-test 15/11 MOBILE-A11Y-11 (WCAG 1.3.1 / 3.3.1): the control named by `htmlFor` is tied to its message
  // (`aria-describedby`) and says it is required (`aria-required`) — the asterisk was the only sign
  const msgId = htmlFor ? `${htmlFor}-msg` : undefined;
  const message = error || hint;
  React.useEffect(() => {
    if (!htmlFor || !msgId) return;
    const el = document.getElementById(htmlFor);
    if (!el) return;
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== msgId);
    if (message) ids.push(msgId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
    if (required) el.setAttribute('aria-required', 'true');
  }, [htmlFor, msgId, message, required]);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden className="text-accent-alert"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={msgId} role="alert" className="text-[12px] text-accent-alert">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-[12px] text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function Checkbox({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn('size-4 rounded-[4px] border border-line-lit bg-ink-surface accent-white', className)}
        {...rest}
      />
    );
  },
);

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-6 w-10 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'bg-signal-live border-signal-live' : 'bg-ink-raised border-line-edge',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-[18px] rounded-full bg-white transition-all',
          checked ? 'start-[18px]' : 'start-0.5',
        )}
      />
    </button>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line-edge bg-ink-surface', className)} {...rest} />;
}
export function SectionLabel({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ts-label-section text-text-muted', className)} {...rest} />;
}

/* ---------- Pill (status chips) ---------- */
export type Tone = 'neutral' | 'success' | 'danger' | 'info' | 'warning' | 'orange' | 'violet';
const TONE: Record<Tone, string> = {
  neutral: 'text-text-secondary border-line-edge',
  success: 'text-accent-money border-accent-money/40',
  danger: 'text-accent-alert border-accent-alert/40',
  info: 'text-accent-inbound border-accent-inbound/40',
  warning: 'text-accent-starred border-accent-starred/40',
  orange: 'text-accent-orders border-accent-orders/40',
  violet: 'text-accent-clients border-accent-clients/40',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-text-muted',
  success: 'bg-accent-money',
  danger: 'bg-accent-alert',
  info: 'bg-accent-inbound',
  warning: 'bg-accent-starred',
  orange: 'bg-accent-orders',
  violet: 'bg-accent-clients',
};
export function Pill({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ts-label-meta uppercase', TONE[tone], className)}>
      {dot ? <span className={cn('size-1.5 rounded-full', DOT[tone])} /> : null}
      {children}
    </span>
  );
}
export const toneDot = DOT;

/* ---------- Skeleton ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-[4px] bg-ink-raised', className)} />;
}
/** List skeleton: same grid as the data, never a full-screen spinner (GLOBAL frame). Rows are 44 px like the list rows
 * (compact table row, list card row) so the content under the list moves as little as possible when the data arrives. */
export function ListSkeleton({ rows = 5, columns = 4, label }: { rows?: number; columns?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col px-3 py-1.5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid h-11 items-center gap-2" style={{ gridTemplateColumns: `2fr repeat(${columns - 1}, 1fr)` }}>
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}
