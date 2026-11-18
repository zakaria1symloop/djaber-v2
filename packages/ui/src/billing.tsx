'use client';
// M9 — billing pieces: Figma "BIL-01 — Settings — Plan & billing" (plan cards, usage tiles), "BIL-04 / BIL-03 — Credits
// page (ledger) · Invoices · Checkout return" (return page states, packs), "DLG — Settings & billing" (Changer de plan,
// Calculateur de crédits). All copy comes in through props; amounts are formatted by the caller.
import { Check, CheckCircle2, Clock, HelpCircle, Loader2, TimerOff, XCircle } from 'lucide-react';
import * as React from 'react';
import { Card, cn } from './primitives';
import { onRadioGroupKeyDown } from './radio-keys';

/* ---------- Plan card (BIL-01 "PLANS") ---------- */
export function PlanCard({
  name,
  price,
  unit,
  description,
  features,
  badge,
  current,
  action,
  note,
  className,
  ...rest
}: {
  name: string;
  /** "4 900" — big numeral, always LTR */
  price: string;
  /** "DA / MOIS · ANNUEL" */
  unit: string;
  description?: string;
  /** one line per limit / feature, each with a check mark */
  features: string[];
  /** "VOTRE PLAN" / "POPULAIRE" */
  badge?: string;
  /** the workspace's plan: lit border */
  current?: boolean;
  action?: React.ReactNode;
  /** small line under the action (cancel at period end, archived plan…) */
  note?: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div
      className={cn('flex flex-col gap-4 rounded-card border bg-ink-surface p-4', current ? 'border-line-lit' : 'border-line-edge', className)}
      data-current={current ? 'true' : undefined}
      {...rest}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-medium">{name}</h3>
        {badge ? <span className="rounded-full border border-line-edge px-2 py-0.5 ts-label-micro text-text-secondary">{badge}</span> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <bdi dir="ltr" className="ts-display-m tabular-nums">
          {price}
        </bdi>
        <span className="ts-label-micro text-text-muted">{unit}</span>
      </div>
      {description ? <p className="text-[13px] text-text-muted">{description}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[13px] text-text-secondary">
            <Check className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2">
        {action}
        {note ? <p className="ts-label-meta text-text-muted">{note}</p> : null}
      </div>
    </div>
  );
}

/** Skeleton of the three plan cards (same grid). */
export function PlanCardsSkeleton({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex h-[300px] flex-col gap-3 rounded-card border border-line-edge bg-ink-surface p-4">
          <div className="h-4 w-20 animate-pulse rounded-[4px] bg-ink-raised" />
          <div className="h-8 w-32 animate-pulse rounded-[4px] bg-ink-raised" />
          {[0, 1, 2, 3, 4].map((r) => (
            <div key={r} className="h-3 w-3/4 animate-pulse rounded-[4px] bg-ink-raised" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- Usage tile (BIL-01 "UTILISATION DU PLAN") ---------- */
export type UsageLevel = 'ok' | 'full' | 'over' | 'unlimited';
/** `ok` below the limit, `full` at the limit (amber), `over` above it (red, after a downgrade), `unlimited` (-1). */
export const usageLevel = (used: number, limit: number): UsageLevel => (limit < 0 ? 'unlimited' : used > limit ? 'over' : limit > 0 && used >= limit ? 'full' : 'ok');
const USAGE_BAR: Record<UsageLevel, string> = { ok: 'bg-signal-live', full: 'bg-accent-starred', over: 'bg-accent-alert', unlimited: 'bg-signal-live' };
const USAGE_TEXT: Record<UsageLevel, string> = { ok: '', full: 'text-accent-starred', over: 'text-accent-alert', unlimited: '' };
export function UsageTile({ label, used, limit, valueLabel, className, ...rest }: { label: string; used: number; limit: number; valueLabel: string; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  const level = usageLevel(used, limit);
  const pct = level === 'unlimited' ? 0 : limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : used > 0 ? 100 : 0;
  return (
    <div className={cn('flex flex-col gap-2 rounded-card border border-line-edge bg-ink-surface px-3 py-2.5', className)} data-level={level} {...rest}>
      <span className="ts-label-micro text-text-muted">{label}</span>
      <bdi dir="ltr" className={cn('text-[15px] font-medium tabular-nums', USAGE_TEXT[level])}>
        {valueLabel}
      </bdi>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit < 0 ? undefined : limit} aria-valuenow={used} aria-valuetext={valueLabel} className="h-1 w-full overflow-hidden rounded-full bg-ink-raised-high">
        <div className={cn('h-full rounded-full', USAGE_BAR[level])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------- Checkout return (BIL-04 "Retour de paiement", full page) ---------- */
export type CheckoutReturnState = 'verifying' | 'success' | 'pending' | 'failed' | 'expired' | 'unknown';
const STATE_ICON: Record<Exclude<CheckoutReturnState, 'verifying'>, { icon: React.ReactNode; tone: string }> = {
  success: { icon: <CheckCircle2 className="size-8" aria-hidden />, tone: 'text-accent-money' },
  pending: { icon: <Clock className="size-8" aria-hidden />, tone: 'text-accent-starred' },
  failed: { icon: <XCircle className="size-8" aria-hidden />, tone: 'text-accent-alert' },
  expired: { icon: <TimerOff className="size-8" aria-hidden />, tone: 'text-accent-alert' },
  unknown: { icon: <HelpCircle className="size-8" aria-hidden />, tone: 'text-text-secondary' },
};
export function CheckoutStatus({
  state,
  label,
  title,
  description,
  meta,
  actions,
  className,
}: {
  state: CheckoutReturnState;
  /** small mono line above the title: "VÉRIFICATION…", "SUCCÈS", "EN ATTENTE", "ÉCHEC", "EXPIRÉ" */
  label: string;
  title: string;
  description?: React.ReactNode;
  /** invoice number, attempts "3 / 12"… */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const visual = state === 'verifying' ? null : STATE_ICON[state];
  return (
    <Card className={cn('mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-6 py-10 text-center', className)} data-testid="checkout-status" data-state={state}>
      <div className={cn('flex h-10 items-center', visual?.tone)}>{visual ? visual.icon : <Loader2 className="size-8 animate-spin text-text-secondary" aria-hidden />}</div>
      <div className={cn('ts-label-micro', visual?.tone ?? 'text-text-muted')}>{label}</div>
      <h1 className="ts-display-s">{title}</h1>
      {description ? <p className="max-w-md text-[13px] text-text-secondary">{description}</p> : null}
      {meta ? <div className="ts-label-meta text-text-muted">{meta}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </Card>
  );
}

/* ---------- Credit pack (DLG "Acheter un pack") ---------- */
export function PackCard({
  name,
  credits,
  price,
  perCredit,
  badge,
  selected,
  onSelect,
  disabled,
  className,
  ...rest
}: {
  name: string;
  /** "500 crédits" — omitted when the pack name already says it */
  credits?: string;
  /** "450 DA" */
  price: string;
  /** "0,90 DA / crédit" */
  perCredit?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onSelect'>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      // journey re-run J14r-4: the arrows move between the cards of the group and choose
      onKeyDown={(e) => onRadioGroupKeyDown(e)}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-2 rounded-card border bg-ink-surface p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected ? 'border-white' : 'border-line-edge hover:border-line-lit',
        className,
      )}
      {...rest}
    >
      <span className="flex w-full items-center gap-2">
        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full border', selected ? 'border-white bg-white' : 'border-text-muted')} />
        <span className="min-w-0 flex-1 text-[14px] font-medium">{name}</span>
        {badge ? <span className="rounded-full border border-line-edge px-2 py-0.5 ts-label-micro text-text-secondary">{badge}</span> : null}
      </span>
      {credits ? (
        <bdi dir="ltr" className="text-[15px] font-medium tabular-nums">
          {credits}
        </bdi>
      ) : null}
      <span className="flex w-full flex-wrap items-baseline justify-between gap-2">
        <bdi dir="ltr" className="text-[13px] tabular-nums text-text-primary">
          {price}
        </bdi>
        {perCredit ? (
          <bdi dir="ltr" className="ts-label-meta text-text-muted">
            {perCredit}
          </bdi>
        ) : null}
      </span>
    </button>
  );
}

/* ---------- Estimate line (calculator, change-plan preview) ---------- */
export function EstimateBox({ children, tone, className, ...rest }: { children: React.ReactNode; tone?: 'warning' | 'danger'; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div
      className={cn(
        'rounded-card border bg-ink-raised px-3 py-2.5 ts-label-meta text-text-secondary',
        tone === 'warning' ? 'border-accent-starred/50' : tone === 'danger' ? 'border-accent-alert/50' : 'border-line-hairline',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
