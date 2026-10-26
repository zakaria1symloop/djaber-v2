'use client';
// Filter building blocks (Figma "CAT-08 — Products — filter panel open", "GDS-05 — Movements — list + filter panel",
// REF — Filters matrix): chip groups, check lists with counts, min–max ranges, date ranges, active chips, the
// "Filtres (n)" side panel and the inline dropdown chips of the filter bar. State lives in the URL (page side).
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, X } from 'lucide-react';
import * as React from 'react';
import { DateInput, NumberInput } from './inputs';
import { Button, Checkbox, cn, Input } from './primitives';
import { SideSheet } from './sheet';

export type FilterOption = { value: string; label: string; count?: number };

const chipClass = (on: boolean) =>
  cn(
    'inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2.5 ts-label-meta transition-colors',
    on ? 'border-line-lit bg-ink-raised-high text-text-primary' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
  );

/* ---------- Group frame: mono label (the model source note stays a data attribute) ---------- */
/**
 * `source` is the Figma annotation of the field a group filters on (`Shipment.status · null = non envoyée`): a note for
 * developers, never shown to merchants — it is kept only as `data-source` on the group.
 */
export function FilterGroup({ label, source, children, className }: { label: string; source?: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} data-source={source} className={cn('flex flex-col gap-2', className)}>
      <span id={id} className="ts-label-section text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/* ---------- Chips: single (radio, optional "all" chip) or multi (checkbox) ---------- */
export function FilterChips({
  options,
  value,
  onChange,
  multiple,
  allLabel,
  label,
}: {
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  /** single mode: a first chip that clears the filter ("Tous") */
  allLabel?: string;
  label: string;
}) {
  const toggle = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    else onChange(value.includes(v) ? [] : [v]);
  };
  const role = multiple ? 'checkbox' : 'radio';
  return (
    <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap gap-1.5">
      {allLabel ? (
        <button type="button" role={role} aria-checked={value.length === 0} onClick={() => onChange([])} className={chipClass(value.length === 0)}>
          {allLabel}
        </button>
      ) : null}
      {options.map((o) => (
        <button key={o.value} type="button" role={role} aria-checked={value.includes(o.value)} onClick={() => toggle(o.value)} className={chipClass(value.includes(o.value))}>
          {o.label}
          {o.count !== undefined ? <span className="tabular-nums text-text-muted">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- Check list with counts and an optional search (categories, agents…) ---------- */
export function FilterCheckList({
  options,
  value,
  onChange,
  searchPlaceholder,
  emptyLabel,
  maxHeight = 200,
}: {
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** renders the search field when set */
  searchPlaceholder?: string;
  emptyLabel?: string;
  maxHeight?: number;
}) {
  const [q, setQ] = React.useState('');
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight }}>
        {shown.map((o) => {
          const on = value.includes(o.value);
          return (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-1 py-1 text-[13px] hover:bg-ink-raised">
                <Checkbox checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined ? <span className="ts-label-meta tabular-nums text-text-muted">{o.count}</span> : null}
              </label>
            </li>
          );
        })}
        {shown.length === 0 && emptyLabel ? <li className="px-1 py-1 text-[13px] text-text-muted">{emptyLabel}</li> : null}
      </ul>
      {searchPlaceholder ? <Input aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} className="!h-9 text-[13px]" /> : null}
    </div>
  );
}

/* ---------- Range: min — max (integers), committed on blur / Enter ---------- */
export function FilterRange({
  min,
  max,
  onChange,
  unit,
  labels,
}: {
  min: string;
  max: string;
  onChange: (next: { min: string; max: string }) => void;
  unit?: string;
  labels: { min: string; max: string };
}) {
  const [draft, setDraft] = React.useState({ min, max });
  // each bound follows its own prop: committing "min" (blur) must not wipe a "max" already being typed
  React.useEffect(() => setDraft((d) => ({ ...d, min })), [min]);
  React.useEffect(() => setDraft((d) => ({ ...d, max })), [max]);
  const commit = () => {
    if (draft.min !== min || draft.max !== max) onChange(draft);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
  };
  return (
    <div className="flex items-center gap-2" dir="ltr">
      <NumberInput aria-label={labels.min} placeholder={labels.min} value={draft.min} onValueChange={(v) => setDraft((d) => ({ ...d, min: v }))} onBlur={commit} onKeyDown={onKey} className="!h-9 text-[13px]" />
      <span aria-hidden className="text-text-muted">
        —
      </span>
      <NumberInput aria-label={labels.max} placeholder={labels.max} value={draft.max} onValueChange={(v) => setDraft((d) => ({ ...d, max: v }))} onBlur={commit} onKeyDown={onKey} className="!h-9 text-[13px]" />
      {unit ? <span className="ts-label-micro w-8 shrink-0 text-text-muted">{unit}</span> : null}
    </div>
  );
}

/* ---------- Date range: preset chips + two native date inputs (YYYY-MM-DD, Africa/Algiers on the server) ---------- */
export function FilterDateRange({
  from,
  to,
  onChange,
  presets,
  activePreset,
  onPreset,
  labels,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  presets?: FilterOption[];
  activePreset?: string | null;
  onPreset?: (value: string) => void;
  labels: { from: string; to: string; presets: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      {presets?.length ? (
        <div role="radiogroup" aria-label={labels.presets} className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={activePreset === p.value} onClick={() => onPreset?.(p.value)} className={chipClass(activePreset === p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* one field under the other (tester report 25/10, PV 26/10 F2): side by side they did not fit the 16 rem popover and
          the « au » date was cut behind a horizontal scroll bar */}
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5" data-testid="filter-date-range">
        <span aria-hidden className="ts-label-micro text-text-muted">
          {labels.from}
        </span>
        <DateInput aria-label={labels.from} value={from} max={to || undefined} onValueChange={(v) => onChange({ from: v, to })} className="!h-9 w-full min-w-0 text-[13px]" />
        <span aria-hidden className="ts-label-micro text-text-muted">
          {labels.to}
        </span>
        <DateInput aria-label={labels.to} value={to} min={from || undefined} onValueChange={(v) => onChange({ from, to: v })} className="!h-9 w-full min-w-0 text-[13px]" />
      </div>
    </div>
  );
}

/* ---------- Active filter chips under the bar: "PRIX 1 000 – 20 000 DA ×" … "EFFACER TOUT" ---------- */
export type ActiveFilter = { key: string; label: string; onRemove?: () => void };
export function ActiveFilters({ items, clearLabel, onClear, removeLabel, label }: { items: ActiveFilter[]; clearLabel: string; onClear?: () => void; removeLabel: (label: string) => string; label: string }) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {items.map((f) => (
        <li key={f.key} className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line-edge bg-ink-surface px-2 ts-label-meta uppercase text-text-primary">
          <span>{f.label}</span>
          {f.onRemove ? (
            <button type="button" aria-label={removeLabel(f.label)} onClick={f.onRemove} className="text-text-muted hover:text-text-primary">
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
      {onClear ? (
        <li>
          <button type="button" onClick={onClear} className="inline-flex h-6 items-center rounded-[4px] border border-accent-alert/40 px-2 ts-label-meta uppercase text-accent-alert hover:border-accent-alert">
            {clearLabel}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/* ---------- Inline dropdown chip of the filter bar ("Catégorie ⌄", "Type ⌄"): popover with any filter body ---------- */
export function FilterDropdown({ label, count, children, align = 'start' }: { label: string; count?: number; children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button className={cn(count ? 'border-line-lit' : '')}>
          {label}
          {count ? <span className="ts-label-meta tabular-nums text-text-secondary">{count}</span> : null}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          // long option lists scroll inside the room left on screen instead of running under the bottom edge
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-card border border-line-edge bg-ink-raised p-3 shadow-xl"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------- Toggle chip of the filter bar ("⚠ Stock faible · 2") ---------- */
export function FilterToggle({ pressed, onPressedChange, children, tone }: { pressed: boolean; onPressedChange: (v: boolean) => void; children: React.ReactNode; tone?: 'warning' }) {
  return (
    <Button aria-pressed={pressed} onClick={() => onPressedChange(!pressed)} className={cn(pressed && (tone === 'warning' ? 'border-accent-starred/60 text-accent-starred' : 'border-line-lit bg-ink-raised'))}>
      {children}
    </Button>
  );
}

/* ---------- The "Filtres" side panel ---------- */
export function FilterPanel({
  open,
  onClose,
  title,
  summary,
  children,
  resetLabel,
  onReset,
  applyLabel,
  closeLabel,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "3 ACTIFS · 24 RÉSULTATS · ÉTAT DANS L'URL" */
  summary?: string;
  children: React.ReactNode;
  resetLabel: string;
  onReset: () => void;
  /** "Afficher 24 produits" — filters apply live, the button closes the panel */
  applyLabel: string;
  closeLabel: string;
  /** row above the footer (saved view switch, sort chips…) */
  extra?: React.ReactNode;
}) {
  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={summary}
      width={420}
      closeLabel={closeLabel}
      footer={
        <>
          <Button variant="ghost" onClick={onReset}>
            {resetLabel}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {applyLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {children}
        {extra}
      </div>
    </SideSheet>
  );
}
