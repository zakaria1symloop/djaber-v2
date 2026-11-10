'use client';
// M4 kit — agents, playground, credits (Figma "AGT-02 — Agent wizard — step 1…5", "AGT-03", "AGT-04", "AGT-07",
// "AGT-08", "BIL-04 / BIL-03 — Credits page"). Wizard frame, live preview, tag input, range slider, schedule editor,
// key/value list (FAQ), tool-call chip, inspector panel, version timeline, insight row, credits meter and pill.
// All copy comes in through props; logical CSS only.
import { Check, ChevronDown, Lock, Pencil, X, Zap } from 'lucide-react';
import * as React from 'react';
import { Button, Card, Checkbox, cn, Input, Switch, type Tone } from './primitives';

/* ---------- Wizard frame: numbered step chips, title, body + right rail, sticky footer ---------- */
export type WizardStep = { key: string; label: string; state: 'done' | 'active' | 'upcoming'; onSelect?: () => void };

/** "✓ 1 · Identité" chips: done steps (and any step given `onSelect`) are links back. */
export function WizardSteps({ steps, label, className }: { steps: WizardStep[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {steps.map((s, i) => {
        const cls = cn(
          'inline-flex h-8 items-center gap-1.5 rounded-card border px-3 text-[13px] transition-colors',
          s.state === 'active' ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary',
          s.onSelect && s.state !== 'active' && 'hover:border-line-lit hover:text-text-primary',
        );
        const body = (
          <>
            {s.state === 'done' ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
            <bdi dir="ltr">{i + 1}</bdi>
            <span aria-hidden>·</span>
            <span>{s.label}</span>
          </>
        );
        return (
          <li key={s.key} data-step={s.key} data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
            {s.onSelect && s.state !== 'active' ? (
              <button type="button" onClick={s.onSelect} className={cls}>
                {body}
              </button>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Validation summary of a step: "Validation : 2 erreurs — …" with the list of messages. */
export function ValidationSummary({ title, items, className }: { title: string; items: string[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div role="alert" data-testid="validation-summary" className={cn('rounded-card border border-accent-alert/60 bg-ink-surface px-3.5 py-3 text-[13px] text-accent-alert', className)}>
      <div className="font-medium">{title}</div>
      <ul className="mt-1 list-inside list-disc text-accent-alert/90">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export function WizardFrame({
  breadcrumb,
  steps,
  stepsLabel,
  title,
  description,
  children,
  rail,
  footer,
  className,
}: {
  breadcrumb?: React.ReactNode;
  steps: WizardStep[];
  stepsLabel: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** right rail: live summary, credit estimate, activation buttons */
  rail?: React.ReactNode;
  footer: { back?: React.ReactNode; status?: React.ReactNode; secondary?: React.ReactNode; primary?: React.ReactNode };
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {breadcrumb}
      <WizardSteps steps={steps} label={stepsLabel} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <header>
            <h1 className="ts-display-m">{title}</h1>
            {description ? <p className="ts-body mt-2 text-text-secondary">{description}</p> : null}
          </header>
          {children}
        </div>
        {rail ? <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-4">{rail}</aside> : null}
      </div>
      {/* `-bottom-6 -mb-6`: the shell's <main> has a 24 px bottom padding that sticky positioning keeps free — the bar
          would float 24 px above the edge with content scrolling under it; this pins it flush to the bottom edge */}
      <footer data-testid="wizard-footer" className="sticky -bottom-6 z-10 -mx-4 -mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-hairline bg-ink-base/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-center gap-2">{footer.back}</div>
        <div className="min-w-0 flex-1 text-end ts-label-meta text-text-muted max-sm:order-first max-sm:basis-full max-sm:truncate max-sm:text-start" role="status" data-testid="wizard-status">
          {footer.status}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {footer.secondary}
          {footer.primary}
        </div>
      </footer>
    </div>
  );
}

/** Card of a wizard / configuration section: title, lead sentence, optional badge on the end side (MODIFIÉ). */
export function FormSection({ title, description, badge, children, className, ...rest }: { title: string; description?: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-card border border-line-edge bg-ink-surface p-4 md:p-5', className)} {...rest}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="ts-title">{title}</h2>
        {badge}
      </div>
      {description ? <p className="mt-2 text-[13px] text-text-secondary">{description}</p> : null}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Summary rail (RÉCAPITULATIF): mono label over the value, "—" while empty. */
export function SummaryRail({ title, rows, children, className }: { title: string; rows: { label: string; value: React.ReactNode }[]; children?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)} data-testid="summary-rail">
      <div className="ts-label-micro text-text-muted">{title}</div>
      <dl className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label} data-row={r.label}>
            <dt className="ts-label-micro text-text-muted">{r.label}</dt>
            <dd className="mt-1 text-[13px]">{r.value || <span className="text-text-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      {children}
    </Card>
  );
}

/* ---------- Switch + text (capabilities, catalogue options) ---------- */
export function ToggleRow({ checked, onChange, title, description, disabled, name }: { checked: boolean; onChange: (v: boolean) => void; title: string; description?: React.ReactNode; disabled?: boolean; name?: string }) {
  return (
    <div className="flex items-start gap-3" data-toggle={name}>
      <Switch checked={checked} onCheckedChange={onChange} label={title} disabled={disabled} />
      <div className="min-w-0 flex-1">
        <div className={cn('text-[14px]', disabled && 'text-text-secondary')}>{title}</div>
        {description ? <div className="ts-label-meta mt-1 text-text-muted">{description}</div> : null}
      </div>
    </div>
  );
}

/** Checkbox drawn as a chip (languages, order fields); `locked` = always on, with a padlock. */
export function CheckChip({ checked, onChange, children, locked, lockedLabel, disabled, name }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; locked?: boolean; lockedLabel?: string; disabled?: boolean; name?: string }) {
  const off = disabled || locked;
  return (
    <label
      data-chip={name}
      title={locked ? lockedLabel : undefined}
      className={cn(
        'inline-flex h-9 cursor-pointer items-center gap-2 rounded-card border px-3 text-[13px] transition-colors',
        checked ? 'border-line-lit bg-ink-raised text-text-primary' : 'border-line-edge bg-ink-surface text-text-secondary',
        off && 'cursor-not-allowed',
        disabled && 'opacity-60',
      )}
    >
      <Checkbox checked={checked} disabled={off} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
      {locked ? <Lock className="size-3 text-accent-starred" aria-label={lockedLabel} /> : null}
    </label>
  );
}

/* ---------- Live preview: what the customer would read with the current tone ---------- */
export type PreviewMessage = { author: 'customer' | 'ai'; text: string };
export function PreviewPanel({ label, messages, note, className }: { label: string; messages: PreviewMessage[]; note?: React.ReactNode; className?: string }) {
  return (
    <div data-testid="preview-panel" className={cn('rounded-card border border-line-hairline bg-ink-base p-3', className)}>
      <div className="ts-label-micro text-text-muted">{label}</div>
      <div className="mt-2 flex flex-col gap-2" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.author === 'ai' ? 'justify-end' : 'justify-start')}>
            <p dir="auto" data-preview={m.author} className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-[13px] leading-snug', m.author === 'ai' ? 'border border-line-edge bg-ink-surface' : 'bg-ink-raised')}>
              {m.text}
            </p>
          </div>
        ))}
      </div>
      {note ? <div className="ts-label-meta mt-2 text-text-muted">{note}</div> : null}
    </div>
  );
}

/* ---------- Tag / chip input (handoff keywords): Enter or comma adds, Backspace removes the last ---------- */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  label,
  removeLabel,
  max,
  maxLength = 40,
  disabled,
  invalid,
  suggestions,
  suggestionsLabel,
  onDraftChange,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  label: string;
  removeLabel: (tag: string) => string;
  max?: number;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** known tags offered under the field (client tags `GET /clients/tags?q=`); the ones already chosen are hidden */
  suggestions?: { tag: string; count?: number }[];
  /** accessible name of the suggestion list */
  suggestionsLabel?: string;
  /** the text being typed (to fetch matching suggestions) */
  onDraftChange?: (draft: string) => void;
}) {
  const [draft, setDraftState] = React.useState('');
  const setDraft = (v: string) => {
    setDraftState(v);
    onDraftChange?.(v);
  };
  const full = max !== undefined && value.length >= max;
  const chosen = new Set(value.map((v) => v.toLowerCase()));
  const offered = (suggestions ?? []).filter((s) => !chosen.has(s.tag.toLowerCase())).slice(0, 12);
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n;]/)
      .map((s) => s.trim().slice(0, maxLength))
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) {
      if (max !== undefined && next.length >= max) break;
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const field = (
    <div
      data-testid="tag-input"
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-card border border-line-edge bg-ink-surface px-2 py-1.5 focus-within:border-line-lit focus-within:ring-1 focus-within:ring-accent-inbound',
        'aria-[invalid=true]:border-accent-alert',
        disabled && 'opacity-60',
      )}
    >
      {value.map((tag) => (
        <span key={tag} data-tag={tag} className="inline-flex h-6 items-center gap-1 rounded-[4px] border border-line-edge bg-ink-raised ps-2 pe-1 text-[12px]">
          <bdi>{tag}</bdi>
          {disabled ? null : (
            <button type="button" aria-label={removeLabel(tag)} onClick={() => onChange(value.filter((v) => v !== tag))} className="flex size-4 items-center justify-center text-text-muted hover:text-text-primary">
              <X className="size-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        disabled={disabled || full}
        value={draft}
        placeholder={full ? undefined : placeholder}
        onChange={(e) => (/[,\n;]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        className="h-6 min-w-24 flex-1 bg-transparent text-[13px] placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
  if (!suggestions) return field;
  return (
    <div className="flex flex-col gap-1.5">
      {field}
      {offered.length && !disabled && !full ? (
        <div role="group" aria-label={suggestionsLabel ?? label} data-testid="tag-suggestions" className="flex flex-wrap gap-1.5">
          {offered.map((s) => (
            <button
              key={s.tag}
              type="button"
              data-suggestion={s.tag}
              // mousedown keeps the focus in the field: its blur would otherwise add the half-typed draft first
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const next = max !== undefined && value.length >= max ? value : [...value, s.tag];
                onChange(next);
                setDraft('');
              }}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-[4px] border border-dashed border-line-edge px-2 text-[12px] text-text-secondary hover:border-line-lit hover:text-text-primary"
            >
              <span aria-hidden>+</span>
              <bdi className="truncate">{s.tag}</bdi>
              {s.count !== undefined ? <span className="ts-label-meta text-text-muted">{s.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Range slider with its value (response delay 0–10 s) ---------- */
export function RangeSlider({ id, value, onChange, min, max, step = 1, label, format, disabled, className }: { id?: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; format: (v: number) => string; disabled?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <input
        id={id}
        type="range"
        dir="ltr"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        // recette 09/11 (Badro): the dark track and white thumb were hard to see — the chosen part is filled in blue
        style={{ background: `linear-gradient(to right, var(--accent-inbound) ${max > min ? ((value - min) / (max - min)) * 100 : 0}%, var(--line-edge) 0)` }}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full accent-accent-inbound disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-accent-inbound [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-accent-inbound"
      />
      <output htmlFor={id} className="w-24 shrink-0 text-end text-[13px] font-medium tabular-nums text-accent-inbound">
        <bdi dir="ltr">{format(value)}</bdi>
      </output>
    </div>
  );
}

/* ---------- Schedule editor: business hours (days + from / to) ---------- */
export type ScheduleValue = { days: number[]; from: string; to: string };
export function ScheduleEditor({
  value,
  onChange,
  dayLabels,
  labels,
  disabled,
  error,
}: {
  /** null = no business hours (the agent answers at any time) */
  value: ScheduleValue | null;
  onChange: (next: ScheduleValue | null) => void;
  /** 7 short labels, index 0 = Sunday (JS `getDay`) */
  dayLabels: string[];
  labels: { enabled: string; enabledHint?: string; days: string; from: string; to: string };
  disabled?: boolean;
  error?: string;
}) {
  const v = value ?? { days: [0, 1, 2, 3, 4, 6], from: '09:00', to: '20:00' };
  // the Algerian week starts on Saturday
  const order = [6, 0, 1, 2, 3, 4, 5];
  const time = 'h-9 w-28 rounded-card border border-line-edge bg-ink-surface px-2 text-[13px] tabular-nums focus:border-line-lit focus:outline-none disabled:opacity-50';
  return (
    <div data-testid="schedule-editor" className="flex flex-col gap-3">
      <ToggleRow name="businessHours" checked={value !== null} onChange={(on) => onChange(on ? v : null)} title={labels.enabled} description={labels.enabledHint} disabled={disabled} />
      {value ? (
        <div className="flex flex-col gap-3 ps-[52px]">
          <div role="group" aria-label={labels.days} className="flex flex-wrap gap-1.5">
            {order.map((d) => {
              const on = value.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  data-day={d}
                  disabled={disabled}
                  onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) })}
                  className={cn('h-8 min-w-10 rounded-card border px-2 text-[12px] transition-colors disabled:opacity-50', on ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary')}
                >
                  {dayLabels[d]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3" dir="ltr">
            <label className="flex items-center gap-2 ts-label-meta uppercase text-text-muted">
              {labels.from}
              <input type="time" value={value.from} disabled={disabled} onChange={(e) => onChange({ ...value, from: e.target.value })} className={time} />
            </label>
            <label className="flex items-center gap-2 ts-label-meta uppercase text-text-muted">
              {labels.to}
              <input type="time" value={value.to} disabled={disabled} onChange={(e) => onChange({ ...value, to: e.target.value })} className={time} />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-[12px] text-accent-alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Key / value list (FAQ question → answer) with a source tag and row actions ---------- */
export type KeyValueItem = { id: string; key: string; value: string; tag?: React.ReactNode };
export function KeyValueList({ items, onEdit, onRemove, labels, empty, disabled, className }: { items: KeyValueItem[]; onEdit?: (id: string) => void; onRemove?: (id: string) => void; labels: { edit: (key: string) => string; remove: (key: string) => string; list: string }; empty: React.ReactNode; disabled?: boolean; className?: string }) {
  if (!items.length) return <div className={cn('rounded-card border border-dashed border-line-edge px-4 py-6 text-center text-[13px] text-text-muted', className)}>{empty}</div>;
  return (
    <ul aria-label={labels.list} className={cn('divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge', className)}>
      {items.map((it) => (
        <li key={it.id} data-item={it.id} className="flex items-center gap-3 bg-ink-surface px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div dir="auto" className="truncate text-[13px]">
              {it.key}
            </div>
            <div dir="auto" className="ts-label-meta mt-1 truncate text-text-muted">
              {it.value}
            </div>
          </div>
          {it.tag}
          {disabled ? null : (
            <span className="flex shrink-0 items-center">
              {onEdit ? (
                <button type="button" aria-label={labels.edit(it.key)} title={labels.edit(it.key)} onClick={() => onEdit(it.id)} className="flex size-7 items-center justify-center text-text-muted hover:text-text-primary">
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              ) : null}
              {onRemove ? (
                <button type="button" aria-label={labels.remove(it.key)} title={labels.remove(it.key)} onClick={() => onRemove(it.id)} className="flex size-7 items-center justify-center text-text-muted hover:text-accent-alert">
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Tool-call chip (playground, AI run): OUTIL name · args · → result; amber when simulated ---------- */
export function ToolCallChip({
  name,
  toolLabel,
  simulatedLabel,
  args,
  result,
  simulated,
  failed,
  defaultOpen = true,
  toggleLabel,
  className,
}: {
  name: string;
  toolLabel: string;
  /** "(simulé)" — the tool ran in dry-run: nothing was written */
  simulatedLabel?: string;
  args: string;
  result: string;
  simulated?: boolean;
  failed?: boolean;
  defaultOpen?: boolean;
  toggleLabel: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div
      data-tool={name}
      data-simulated={simulated || undefined}
      className={cn('ms-auto w-full max-w-[min(34rem,85%)] rounded-card border bg-ink-base px-3 py-2', failed ? 'border-accent-alert/70' : simulated ? 'border-accent-starred/70' : 'border-signal-live/60', className)}
    >
      <button type="button" aria-expanded={open} aria-label={`${toggleLabel} ${name}`} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-start">
        <span className={cn('inline-flex h-5 items-center rounded-[4px] border px-1.5 ts-label-micro', failed ? 'border-accent-alert/50 text-accent-alert' : simulated ? 'border-accent-starred/50 text-accent-starred' : 'border-signal-live/50 text-signal-live')}>{toolLabel}</span>
        <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">
          {name}
          {simulated && simulatedLabel ? ` ${simulatedLabel}` : ''}
        </bdi>
        <ChevronDown className={cn('size-3 shrink-0 text-text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1 font-mono text-[11px] leading-relaxed" dir="ltr">
          <pre className="whitespace-pre-wrap break-words text-text-secondary">{args}</pre>
          <pre className="whitespace-pre-wrap break-words text-text-muted">→ {result}</pre>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Inspector panel (last playground turn, AI run of a message): label / value rows ---------- */
export type InspectorRow = { key: string; label: string; value: React.ReactNode; tone?: Tone };
const VALUE_TONE: Partial<Record<Tone, string>> = { success: 'text-accent-money', danger: 'text-accent-alert', warning: 'text-accent-starred', info: 'text-accent-inbound' };
export function InspectorPanel({ title, rows, children, className }: { title?: string; rows: InspectorRow[]; children?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2', className)} data-testid="inspector">
      {title ? <h2 className="ts-label-section text-text-muted">{title}</h2> : null}
      <dl className="divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge bg-ink-surface">
        {rows.map((r) => (
          <div key={r.key} data-row={r.key} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 px-3 py-2.5">
            <dt className="ts-label-micro pt-0.5 text-text-muted">{r.label}</dt>
            <dd className={cn('min-w-0 break-words text-[13px]', r.tone && VALUE_TONE[r.tone])}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

/* ---------- Version timeline (AGT-03): vN · ACTUELLE, meta, note, Restaurer / Diff ---------- */
export type VersionItem = { version: number; current?: boolean; currentLabel?: string; meta: React.ReactNode; note?: React.ReactNode; actions?: React.ReactNode; detail?: React.ReactNode };
export function VersionTimeline({ items, label, className }: { items: VersionItem[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('divide-y divide-line-hairline', className)}>
      {items.map((v) => (
        <li key={v.version} data-version={v.version} data-current={v.current || undefined} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <bdi dir="ltr" className="text-[14px] font-medium">
                  v{v.version}
                </bdi>
                {v.current && v.currentLabel ? <span className="inline-flex h-5 items-center rounded-[4px] border border-accent-money/40 px-1.5 ts-label-micro text-accent-money">{v.currentLabel}</span> : null}
              </div>
              <div className="ts-label-micro mt-1 text-text-muted">{v.meta}</div>
              {v.note ? <div className="ts-label-meta mt-1 text-text-secondary">{v.note}</div> : null}
            </div>
            {v.actions ? <div className="flex shrink-0 items-center gap-1">{v.actions}</div> : null}
          </div>
          {v.detail}
        </li>
      ))}
    </ol>
  );
}

/** Before → after rows of a version diff. */
export function DiffList({ rows, empty, className }: { rows: { key: string; label: string; before: React.ReactNode; after: React.ReactNode }[]; empty: string; className?: string }) {
  if (!rows.length) return <p className={cn('ts-label-meta text-text-muted', className)}>{empty}</p>;
  return (
    <dl data-testid="diff-list" className={cn('flex flex-col gap-2 rounded-card border border-line-hairline bg-ink-base p-3', className)}>
      {rows.map((r) => (
        <div key={r.key} data-diff={r.key}>
          <dt className="ts-label-micro text-text-muted">{r.label}</dt>
          <dd className="mt-0.5 text-[12px]">
            <span dir="auto" className="text-accent-alert line-through decoration-accent-alert/50">
              {r.before}
            </span>
            <span aria-hidden className="mx-1.5 text-text-muted">
              →
            </span>
            <span dir="auto" className="text-accent-money">
              {r.after}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Insight row (AGT-08): pill · n ×, client / IA / cause, actions on the end side ---------- */
export function InsightRow({ pill, count, customer, ai, cause, actions, children, className, ...rest }: { pill: React.ReactNode; count?: React.ReactNode; customer: React.ReactNode; ai?: React.ReactNode; cause?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <article className={cn('flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5', className)} {...rest}>
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex items-center gap-2">
          {pill}
          {count ? <span className="ts-label-micro text-text-muted">{count}</span> : null}
        </div>
        <p className="mt-2 text-[13px]">
          <bdi>{customer}</bdi>
        </p>
        {ai ? <p className="ts-label-meta mt-1.5 text-text-secondary">{ai}</p> : null}
        {cause ? <p className="ts-label-meta mt-1 text-text-muted">{cause}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </article>
  );
}

/* ---------- KPI tile (AGT-03, credits page): small mono line, big numeral, caption ---------- */
export function KpiTile({ value, label, meta, tone, className, ...rest }: { value: React.ReactNode; label: string; meta?: React.ReactNode; tone?: 'danger' | 'warning'; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-card border border-line-edge bg-ink-surface px-3 py-2.5', className)} {...rest}>
      <div className="ts-label-micro min-h-3 text-text-muted">{meta}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <bdi dir="ltr" className={cn('ts-numeral-l', tone === 'danger' && 'text-accent-alert', tone === 'warning' && 'text-accent-starred')}>
          {value}
        </bdi>
        <span className="ts-label-micro text-text-muted">{label}</span>
      </div>
    </div>
  );
}

/** Loading twin of `KpiTile`: the same box and line heights (invisible numeral), so a row of tiles keeps its height when
 * the figures arrive and the page under it does not jump. */
export function KpiTileSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('rounded-card border border-line-edge bg-ink-surface px-3 py-2.5', className)} data-kpi-skeleton="">
      <div className="ts-label-micro relative min-h-3">
        <span className="invisible">0</span>
        <span className="absolute inset-y-0 start-0 my-auto h-2 w-24 animate-pulse rounded-[4px] bg-ink-raised" />
      </div>
      <div className="mt-1 flex items-center gap-x-2">
        <span className="ts-numeral-l invisible">0</span>
        <span className="h-2.5 w-16 animate-pulse rounded-[4px] bg-ink-raised" />
      </div>
    </div>
  );
}

/* ---------- Credits: meter (used / limit) and the header pill ---------- */
export type CreditsLevel = 'ok' | 'warning' | 'exhausted';
const LEVEL_BAR: Record<CreditsLevel, string> = { ok: 'bg-signal-live', warning: 'bg-accent-starred', exhausted: 'bg-accent-alert' };
export function CreditsMeter({ used, limit, level, label, valueLabel, className }: { used: number; limit: number; level: CreditsLevel; label: string; valueLabel: string; className?: string }) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : 0;
  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid="credits-meter" data-level={level}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="ts-label-micro text-text-muted">{label}</span>
        <bdi dir="ltr" className="ts-label-meta tabular-nums text-text-secondary">
          {valueLabel}
        </bdi>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-valuetext={valueLabel} className="h-1.5 w-full overflow-hidden rounded-full bg-ink-raised-high">
        <div className={cn('h-full rounded-full transition-[width]', LEVEL_BAR[level])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Header pill "⚡ 3 760 / 5 000": amber from 80 %, red when exhausted. Render it inside a link to the credits page. */
export function CreditsPill({ text, level, title, className }: { text: string; level: CreditsLevel; title: string; className?: string }) {
  return (
    <span
      data-testid="credits-pill"
      data-level={level}
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full border px-2 ts-label-meta tabular-nums',
        level === 'exhausted' ? 'border-accent-alert/60 text-accent-alert' : level === 'warning' ? 'border-accent-starred/50 text-accent-starred' : 'border-line-edge text-text-secondary',
        className,
      )}
    >
      <Zap className="size-3" aria-hidden />
      <bdi dir="ltr">{text}</bdi>
    </span>
  );
}

/* ---------- Small pieces ---------- */
/** Round avatar with initials or a picture (agent header, wizard identity). */
export function AgentAvatar({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name
    .split(/[\s—–-]+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.3)) }} className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-edge bg-ink-raised font-semibold text-text-primary', className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials || '·'}
    </span>
  );
}

/** Square mono chip (model badge, SIMULATION, channel chips of a card). */
export function MonoChip({ tone = 'neutral', children, className, title }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: React.ReactNode; className?: string; title?: string }) {
  const c = { neutral: 'border-line-edge text-text-secondary', success: 'border-accent-money/40 text-accent-money', warning: 'border-accent-starred/50 text-accent-starred', danger: 'border-accent-alert/50 text-accent-alert', info: 'border-accent-inbound/40 text-accent-inbound' }[tone];
  return (
    <span title={title} className={cn('inline-flex h-5 max-w-full items-center rounded-[4px] border px-1.5 ts-label-micro', c, className)}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** One line of a readiness checklist: ✓ / ⚠ / ✕, text, optional link on the end side. */
export function ReadinessRow({ state, children, action, name }: { state: 'ok' | 'warning' | 'missing'; children: React.ReactNode; action?: React.ReactNode; name?: string }) {
  return (
    <li data-check={name} data-state={state} className="flex items-center gap-3 py-2.5">
      <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center text-[13px]', state === 'ok' ? 'text-accent-money' : state === 'warning' ? 'text-accent-starred' : 'text-accent-alert')}>
        {state === 'ok' ? <Check className="size-4" /> : state === 'warning' ? '⚠' : <X className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 text-[13px]">{children}</span>
      {action}
    </li>
  );
}

/** Inline field of a review grid / compact form: mono label above a control. */
export function MiniField({ label, htmlFor, error, children, className }: { label: string; htmlFor?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="ts-label-micro text-text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] text-accent-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Text input + "add" button on one line (FAQ quick add, keyword). */
export function InlineAdd({ value, onChange, onAdd, placeholder, label, addLabel, disabled }: { value: string; onChange: (v: string) => void; onAdd: () => void; placeholder?: string; label: string; addLabel: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={label} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onAdd())} />
      <Button onClick={onAdd} disabled={disabled || !value.trim()}>
        {addLabel}
      </Button>
    </div>
  );
}
