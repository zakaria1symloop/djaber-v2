'use client';
// M5 clients kit (Figma CLI-03 — Clients — list with detail sheet, filter panel + row menu; DLG Fusionner / Tags):
// metric tiles of the sheet, merge cards (kept vs merged), tag chips, selectable tag chips of the bulk dialog.
// All copy comes in through props; logical CSS only (RTL safe).
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from './primitives';
import { onRadioGroupKeyDown } from './radio-keys';

/* ---------- Metric tile of the client sheet: "COMMANDES 3", "DA DÉPENSÉS 14 700", "RETOURS 0 %" ---------- */
export function MetricTile({ label, value, tone, className, ...rest }: { label: string; value: React.ReactNode; tone?: 'danger' | 'warning' | 'success'; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 rounded-card border border-line-edge bg-ink-surface px-3 py-2.5', className)} {...rest}>
      <span className="ts-label-micro truncate text-text-muted">{label}</span>
      <bdi dir="ltr" className={cn('ts-numeral-l truncate text-start', tone === 'danger' && 'text-accent-alert', tone === 'warning' && 'text-accent-starred', tone === 'success' && 'text-accent-money')}>
        {value}
      </bdi>
    </div>
  );
}

/* ---------- Tag chips of a client row / sheet ("FIDÈLE", "VIP") ---------- */
export function TagChips({ tags, max = 3, moreLabel, className }: { tags: readonly string[]; max?: number; moreLabel?: (n: number) => string; className?: string }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const more = tags.length - shown.length;
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((tag) => (
        // a block box so the long tag ends with « … » (a flex box cuts it without an ellipsis — full-test CLIENTS-17)
        <span key={tag} title={tag} className="inline-block max-w-40 truncate rounded-[4px] border border-accent-clients/40 px-1.5 py-0.5 align-middle ts-label-meta uppercase text-accent-clients">
          {tag}
        </span>
      ))}
      {more > 0 ? <span className="ts-label-meta text-text-muted">{moreLabel ? moreLabel(more) : `+${more}`}</span> : null}
    </span>
  );
}

/* ---------- Tri-state tag chip of the bulk "Tags" dialog: unchanged / add / remove ---------- */
export type TagToggleState = 'unchanged' | 'add' | 'remove';
export function TagToggle({ tag, state, onChange, labels }: { tag: string; state: TagToggleState; onChange: (next: TagToggleState) => void; labels: Record<TagToggleState, string> }) {
  const next: Record<TagToggleState, TagToggleState> = { unchanged: 'add', add: 'remove', remove: 'unchanged' };
  return (
    <button
      type="button"
      data-tag={tag}
      data-state={state}
      aria-label={`${tag} · ${labels[state]}`}
      onClick={() => onChange(next[state])}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2.5 ts-label-meta transition-colors',
        state === 'add' && 'border-white bg-white text-black',
        state === 'remove' && 'border-accent-alert/60 text-accent-alert line-through',
        state === 'unchanged' && 'border-line-edge text-text-secondary hover:text-text-primary',
      )}
    >
      <span aria-hidden className={cn('flex size-3.5 items-center justify-center rounded-[3px] border', state === 'add' ? 'border-black' : 'border-current')}>
        {state === 'add' ? <Check className="size-3" /> : null}
      </span>
      {tag}
    </button>
  );
}

/* ---------- Merge card: "Amina Belkacem · 3 commandes · 2 conversations · fiable · CONSERVÉ" ---------- */
export function MergeCard({ name, meta, badge, kept, onSelect, selectLabel }: { name: string; meta: React.ReactNode; badge: string; kept: boolean; onSelect?: () => void; selectLabel?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={kept}
      aria-label={selectLabel ? `${selectLabel} · ${name}` : name}
      // journey re-run J14r-4: the arrows move between the two cards and choose
      onKeyDown={(e) => onRadioGroupKeyDown(e)}
      onClick={onSelect}
      disabled={!onSelect}
      className={cn('flex min-w-0 flex-1 flex-col gap-1.5 rounded-card border bg-ink-surface px-3 py-2.5 text-start transition-colors', kept ? 'border-accent-money' : 'border-line-edge hover:border-line-lit', !onSelect && 'cursor-default')}
    >
      <span className="truncate text-[14px] font-medium">{name}</span>
      <span className="ts-label-meta text-text-muted">{meta}</span>
      <span className={cn('w-fit rounded-[4px] border px-1.5 py-0.5 ts-label-meta uppercase', kept ? 'border-accent-money/40 text-accent-money' : 'border-line-edge text-text-muted')}>{badge}</span>
    </button>
  );
}
