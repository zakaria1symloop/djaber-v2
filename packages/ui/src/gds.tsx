// M7 — GDS operations pieces: Figma "GDS-09 — Cash register — ledger with locked automatic rows" (AUTO 🔒 / MANUEL
// source badge, closed-day banner), "GDS-10 — Recommendations — list + generate job + stats" (job banner with progress,
// recommendation card with its type / priority pills, suggestion, actions, rule label and APPLIQUÉE state),
// "GDS-08 — new sale" (totals block with the remaining amount) and DLG "Valider l'inventaire"
// (variance "21 → 18 −3 ⚠ 66 %"). Copy comes from the caller (i18n keys); numbers are wrapped LTR.
import { Lock } from 'lucide-react';
import * as React from 'react';
import { cn, Pill, type Tone } from './primitives';

/* ---------- AUTO 🔒 / MANUEL ---------- */
export function SourceBadge({ automatic, autoLabel, manualLabel, reason, className }: { automatic: boolean; autoLabel: string; manualLabel: string; reason?: string; className?: string }) {
  return (
    <span title={reason} data-source={automatic ? 'auto' : 'manual'} className={cn('inline-flex', className)}>
      <Pill tone={automatic ? 'neutral' : 'info'} className="!rounded-[4px]">
        {automatic ? autoLabel : manualLabel}
        {automatic ? <Lock className="size-3" aria-hidden /> : null}
      </Pill>
    </span>
  );
}

/* ---------- Job banner: "Génération en cours (… 142 produits analysés sur 142)…" + EN COURS · 100 % ---------- */
export type JobBannerState = 'running' | 'done' | 'failed' | 'limited';
const JOB_TONE: Record<JobBannerState, { bar: string; pill: Tone }> = {
  running: { bar: 'border-s-accent-starred', pill: 'warning' },
  done: { bar: 'border-s-accent-money', pill: 'success' },
  failed: { bar: 'border-s-accent-alert', pill: 'danger' },
  limited: { bar: 'border-s-line-lit', pill: 'neutral' },
};
export function JobBanner({ state, children, pill, progress, action, className }: { state: JobBannerState; children: React.ReactNode; pill: string; progress?: number | null; action?: React.ReactNode; className?: string }) {
  const tone = JOB_TONE[state];
  const pct = progress === null || progress === undefined ? null : Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div role="status" data-state={state} className={cn('flex flex-col gap-2 rounded-card border border-line-edge border-s-2 bg-ink-surface px-4 py-3', tone.bar, className)}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px]">{children}</p>
        <Pill tone={tone.pill} className="!rounded-[4px] whitespace-nowrap">
          {pill}
        </Pill>
        {action}
      </div>
      {state === 'running' && pct !== null ? (
        <div className="h-1 overflow-hidden rounded-full bg-ink-raised" aria-hidden>
          <div className="h-full bg-accent-starred transition-[width]" style={{ inlineSize: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Recommendation card ---------- */
export function RecommendationCard({
  pills,
  menu,
  title,
  onTitle,
  body,
  suggestion,
  actions,
  rule,
  applied,
  className,
  ...rest
}: {
  pills: React.ReactNode;
  menu?: React.ReactNode;
  title: string;
  onTitle?: () => void;
  body: React.ReactNode;
  suggestion?: React.ReactNode;
  actions?: React.ReactNode;
  rule?: string;
  /** APPLIQUÉE: the card is greyed for 24 h with a link to what was created */
  applied?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <article className={cn('flex h-full flex-col gap-3 rounded-card border border-line-edge bg-ink-surface p-4', applied && 'opacity-60', className)} {...rest}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{pills}</div>
        {menu}
      </div>
      {onTitle ? (
        <button type="button" onClick={onTitle} className="text-start text-[15px] text-accent-inbound hover:underline">
          {title}
        </button>
      ) : (
        <h3 className="text-[15px] text-accent-inbound">{title}</h3>
      )}
      <p className="text-[13px] text-text-secondary">{body}</p>
      {suggestion ? <div className="rounded-[6px] bg-ink-raised px-3 py-2 text-[13px]">→ {suggestion}</div> : null}
      <div className="mt-auto flex flex-col gap-3">
        {applied ? <div className="ts-label-meta text-accent-money">{applied}</div> : actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        {rule ? <div className="ts-label-micro truncate text-text-muted">{rule}</div> : null}
      </div>
    </article>
  );
}

/* ---------- Totals: Sous-total · Remise · Total (sale sheet, purchase form) ---------- */
export type SummaryRow = { key: string; label: string; value: string; strong?: boolean; tone?: 'danger' | 'success' | 'warning' };
export function TotalsBlock({ rows, className }: { rows: SummaryRow[]; className?: string }) {
  return (
    <dl className={cn('flex flex-col gap-1', className)}>
      {rows.map((r) => (
        <div key={r.key} className={cn('flex items-baseline justify-between gap-3', r.strong ? 'text-[15px] font-semibold' : 'text-[14px] text-text-secondary')} data-total={r.key}>
          <dt>{r.label}</dt>
          <dd>
            <bdi dir="ltr" className={cn('tabular-nums', r.tone === 'danger' && 'text-accent-alert', r.tone === 'success' && 'text-accent-money', r.tone === 'warning' && 'text-accent-starred')}>
              {r.value}
            </bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Inventory variance: "21 → 18  −3" · "3 → 1  −2 ⚠ 66 %" ---------- */
export function VarianceValue({ expected, counted, pct, flagged, className }: { expected: number; counted: number | null; pct?: number | null; flagged?: boolean; className?: string }) {
  if (counted === null) return <span className={cn('text-text-muted', className)}>—</span>;
  const diff = counted - expected;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  return (
    <span className={cn('inline-flex items-baseline gap-2 whitespace-nowrap', className)} data-diff={diff}>
      <bdi dir="ltr" className="tabular-nums text-text-secondary">{`${expected} → ${counted}`}</bdi>
      {diff === 0 ? (
        <span className="text-text-muted">✓</span>
      ) : (
        <bdi dir="ltr" className={cn('tabular-nums font-medium', diff > 0 ? 'text-accent-money' : 'text-accent-alert')}>
          {`${sign}${Math.abs(diff)}`}
          {/* journeys 16/11 J07-6: 2 / 19 = 10,5 % is flagged but its whole percent reads « 10 % » — say « > 10 % » then */}
          {flagged ? (Math.round(Math.abs(pct ?? 0)) <= 10 ? ' ⚠ > 10\u00a0%' : ` ⚠ ${Math.round(Math.abs(pct ?? 0))}\u00a0%`) : ''}
        </bdi>
      )}
    </span>
  );
}

/* ---------- Signed amount of the cash ledger: +4 500 (money) / −1 550 (alert) ---------- */
export function SignedAmount({ value, formatted, className }: { value: number; formatted: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('tabular-nums font-medium', value > 0 ? 'text-accent-money' : value < 0 ? 'text-accent-alert' : 'text-text-secondary', className)}>
      {`${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`}
    </bdi>
  );
}
