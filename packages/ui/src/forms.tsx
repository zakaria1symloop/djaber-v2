'use client';
// Form & navigation primitives added in M1 (Figma AUTH, ONB-01, SET frames): password field, OTP boxes, step pills,
// avatar, segmented control, settings sub-nav, option card, strength bar, inline form alert. All copy comes in through props.
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn, Input } from './primitives';
import { onRadioGroupKeyDown } from './radio-keys';

/* ---------- Spinner ---------- */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex items-center gap-2 text-text-secondary', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="ts-label-meta">{label}</span>
    </span>
  );
}

/* ---------- Password input with show / hide ---------- */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { showLabel: string; hideLabel: string }
>(function PasswordInput({ showLabel, hideLabel, className, ...rest }, ref) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pe-10', className)} {...rest} />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        title={visible ? hideLabel : showLabel}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-text-muted hover:text-text-primary"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});

/* ---------- OTP input: n boxes, digits only, paste, arrows / backspace ---------- */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  invalid,
  disabled,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** accessible name of the group; each box is announced as `${label} n` */
  label: string;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const set = (next: string, focus?: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (focus !== undefined) refs.current[Math.max(0, Math.min(length - 1, focus))]?.focus();
    if (clean.length === length && clean !== value) onComplete?.(clean);
  };
  return (
    // digits always read left to right, also in Arabic
    <div role="group" aria-label={label} dir="ltr" className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${label} ${i + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          value={d}
          maxLength={length}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return set(value.slice(0, i) + value.slice(i + 1), i);
            // a paste or autofill delivers several digits at once
            if (typed.length > 1) return set(value.slice(0, i) + typed, i + typed.length);
            set(value.slice(0, i) + typed + value.slice(i + 1), i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              e.preventDefault();
              set(value.slice(0, i - 1) + value.slice(i), i - 1);
            } else if (e.key === 'ArrowLeft') refs.current[Math.max(0, i - 1)]?.focus();
            else if (e.key === 'ArrowRight') refs.current[Math.min(length - 1, i + 1)]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
            set(pasted, pasted.length);
          }}
          className={cn(
            'h-14 min-w-0 flex-1 rounded-card border border-line-edge bg-ink-raised text-center text-[22px] font-medium text-text-primary',
            'focus:border-line-lit focus:outline-none focus:ring-1 focus:ring-accent-inbound disabled:opacity-50 aria-[invalid=true]:border-accent-alert',
          )}
        />
      ))}
    </div>
  );
}

/* ---------- Step pills (ONB-01: BIENVENUE · STOCK · …): done = green, active = white, upcoming = muted ---------- */
export type StepItem = { key: string; label: string; state: 'done' | 'active' | 'upcoming'; onSelect?: () => void };
export function Steps({ items, label, className }: { items: StepItem[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map((s) => {
        const cls = cn(
          'inline-flex h-5 items-center rounded-[4px] border px-2 ts-label-meta uppercase',
          s.state === 'done' && 'border-accent-money/40 text-accent-money',
          s.state === 'active' && 'border-line-lit bg-ink-raised text-text-primary',
          s.state === 'upcoming' && 'border-line-edge text-text-muted',
        );
        return (
          <li key={s.key} aria-current={s.state === 'active' ? 'step' : undefined} data-state={s.state}>
            {s.onSelect && s.state === 'done' ? (
              <button type="button" onClick={s.onSelect} className={cn(cls, 'hover:border-accent-money')}>
                {s.label}
              </button>
            ) : (
              <span className={cls}>{s.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Avatar ---------- */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
export function Avatar({ src, name, size = 32, square, className }: { src?: string | null; name: string; size?: number; square?: boolean; className?: string }) {
  return (
    <span
      aria-hidden={src ? undefined : true}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-line-edge bg-ink-raised font-medium text-text-secondary',
        square ? 'rounded-card' : 'rounded-full',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/* ---------- Segmented control (locale tabs, cycle toggles) ---------- */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  disabled,
}: {
  options: { value: T; label: string; dir?: 'ltr' | 'rtl' }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          dir={o.dir}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-card border px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            o.value === value ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Settings sub-navigation (SettingsShell §2.2) ---------- */
export function SubNav({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  // full-test 15/11 SETTINGS-16: on a phone the sub-nav is one horizontal strip — the active entry is scrolled into view
  // (« Notifications » was hidden to the right); only the strip scrolls, never the page
  const strip = React.useRef<HTMLDivElement>(null);
  const shown = React.useRef<Element | null>(null);
  React.useEffect(() => {
    const box = strip.current;
    const el = box?.querySelector('[aria-current="page"]') as HTMLElement | null;
    if (!box || !el || el === shown.current) return;
    shown.current = el;
    if (box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
  });
  return (
    <nav aria-label={title} className={cn('flex flex-col gap-0.5', className)}>
      <div className="ts-label-meta px-1 pb-2 uppercase text-text-muted max-lg:hidden">{title}</div>
      <div ref={strip} className="flex gap-0.5 max-lg:overflow-x-auto lg:flex-col">{children}</div>
    </nav>
  );
}
/** Class of one sub-nav link: apply it to the router `Link` of the app. */
export const subNavLinkClass = (active: boolean) =>
  cn(
    'flex h-10 shrink-0 items-center gap-3 whitespace-nowrap rounded-card px-3 text-[13px] text-text-secondary hover:bg-ink-raised hover:text-text-primary',
    active && 'bg-ink-raised text-text-primary',
  );

/* ---------- Option card (stock mode, connect platform): a radio rendered as a card ---------- */
export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  badge,
  icon,
  disabled,
  name,
  className,
  arrowSelects = true,
  tabIndex,
}: {
  selected: boolean;
  onSelect: () => void;
  /** the arrow keys also choose (default); false when choosing saves at once — then Space / Enter choose */
  arrowSelects?: boolean;
  title: string;
  description: string;
  /** small label on the end side (e.g. ACTIF) shown when selected */
  badge?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
  /** roving Tab stop of the group: `radioTabIndex(index, selectedIndex)` — one Tab stop per group (ONBOARDING-13) */
  tabIndex?: 0 | -1;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      data-name={name}
      disabled={disabled}
      onClick={onSelect}
      // full-test 15/11 ONBOARDING-05 / -13: a visible selection (lit border + radio dot, Figma ONB-01) and the arrow keys
      // of a radio group
      onKeyDown={(e) => onRadioGroupKeyDown(e, { select: arrowSelects })}
      className={cn(
        'flex w-full flex-col gap-2 rounded-card border bg-ink-surface p-4 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-accent-money bg-ink-raised' : 'border-line-hairline hover:border-line-edge',
        className,
      )}
    >
      <span className="flex w-full items-center gap-3">
        <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent-money' : 'border-line-lit')}>
          {selected ? <span className="size-2 rounded-full bg-accent-money" /> : null}
        </span>
        {icon ? <span className="text-text-secondary">{icon}</span> : null}
        <span className="min-w-0 flex-1 text-[14px] font-medium text-text-primary">{title}</span>
        {selected && badge ? <span className="ts-label-micro text-text-primary">{badge}</span> : null}
      </span>
      <span className="text-[13px] text-text-secondary">{description}</span>
    </button>
  );
}

/* ---------- Password strength bar ---------- */
export function StrengthBar({ score, label }: { score: 0 | 1 | 2 | 3 | 4; label: string }) {
  const tone = score <= 1 ? 'bg-accent-alert' : score === 2 ? 'bg-accent-starred' : 'bg-accent-money';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} className="flex gap-1">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('h-1 flex-1 rounded-full', i <= score ? tone : 'bg-ink-raised-high')} />
      ))}
    </div>
  );
}

/* ---------- Inline form-level alert (AUTH_INVALID_CREDENTIALS, done notices…) ---------- */
type AlertTone = 'danger' | 'success' | 'warning' | 'info';
const ALERT: Record<AlertTone, string> = {
  danger: 'border-accent-alert/60 text-accent-alert',
  success: 'border-accent-money/60 text-accent-money',
  warning: 'border-accent-starred/60 text-accent-starred',
  info: 'border-line-edge text-text-secondary',
};
export function FormAlert({ tone = 'danger', children, className }: { tone?: AlertTone; children: React.ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-card border bg-ink-surface px-3 py-2.5 ts-label-meta', ALERT[tone], className)}>
      {children}
    </div>
  );
}

/* ---------- Checklist row (Get Started, onboarding summary) ---------- */
export function ChecklistRow({
  done,
  index,
  title,
  description,
  action,
  className,
}: {
  done: boolean;
  /** 1-based number shown while not done */
  index?: number;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-done={done} className={cn('flex items-start gap-3 py-3', className)}>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ts-label-micro',
          done ? 'border-accent-money bg-accent-money/15 text-accent-money' : 'border-line-edge text-text-muted',
        )}
      >
        {done ? <Check className="size-3" /> : (index ?? '')}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14px] font-medium', done ? 'text-text-secondary' : 'text-text-primary')}>{title}</span>
        {description ? <span className="block text-[13px] text-text-secondary">{description}</span> : null}
      </span>
      {action}
    </div>
  );
}
