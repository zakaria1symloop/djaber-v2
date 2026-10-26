'use client';
// M8 — Analytics & reports pieces (Figma "ANA-02 — Analytics — overview tab + period picker", "ANA-02b — … tabs",
// "ANA-03 — Reports — hub", "ANA-04 — Report — template"). Charts are hand-made (HTML bars + a thin SVG layer, no chart
// library): bars mirror with the writing direction (time flows from the start edge), one axis per chart, hover + arrow
// keys show the bucket tooltip, a legend whenever there are ≥ 2 series, text always in text tokens. All copy via props.
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import * as React from 'react';
import { DateInput } from './inputs';
import { Button, Card, cn } from './primitives';
import { choroplethStep, wilayaGeometry } from './wilaya-geo';

/* ---------- tones of the series (design tokens; validated CVD-safe pairs, see assumptions-log M8 web) ---------- */
export type ChartTone = 'inbound' | 'orders' | 'money' | 'clients' | 'starred' | 'alert' | 'muted';
const BG: Record<ChartTone, string> = {
  inbound: 'bg-accent-inbound',
  orders: 'bg-accent-orders',
  money: 'bg-accent-money',
  clients: 'bg-accent-clients',
  starred: 'bg-accent-starred',
  alert: 'bg-accent-alert',
  muted: 'bg-text-muted',
};
const STROKE: Record<ChartTone, string> = {
  inbound: 'var(--accent-inbound)',
  orders: 'var(--accent-orders)',
  money: 'var(--accent-money)',
  clients: 'var(--accent-clients)',
  starred: 'var(--accent-starred)',
  alert: 'var(--accent-alert)',
  muted: 'var(--text-muted)',
};
const LEGEND: Record<ChartTone, string> = {
  inbound: 'border-accent-inbound/50 text-accent-inbound',
  orders: 'border-accent-orders/50 text-accent-orders',
  money: 'border-accent-money/50 text-accent-money',
  clients: 'border-accent-clients/50 text-accent-clients',
  starred: 'border-accent-starred/50 text-accent-starred',
  alert: 'border-accent-alert/50 text-accent-alert',
  muted: 'border-line-edge text-text-muted',
};

/* ---------- delta vs the previous period: "+18 %" / "−3 pts" (hidden when no comparison) ---------- */
export function DeltaBadge({
  value,
  unit = '%',
  invert,
  newLabel,
  className,
}: {
  value: number | null | undefined;
  unit?: '%' | 'pts';
  invert?: boolean;
  newLabel?: string;
  className?: string;
}) {
  if (value === null || value === undefined) {
    return newLabel ? (
      <span className={cn('ts-label-micro text-text-muted', className)}>{newLabel}</span>
    ) : null;
  }
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
  return (
    <bdi
      dir="ltr"
      data-delta={value}
      className={cn(
        'ts-label-micro whitespace-nowrap !normal-case',
        good ? 'text-accent-money' : bad ? 'text-accent-alert' : 'text-text-muted',
        className,
      )}
    >
      {`${sign}${n} ${unit}`}
    </bdi>
  );
}

/* ---------- KPI tile: meta line (delta · context), big figure + unit, sub line ---------- */
export function AnaKpiTile({
  value,
  unit,
  meta,
  sub,
  delta,
  title,
  onClick,
  className,
  ...rest
}: {
  value: React.ReactNode;
  unit: string;
  meta?: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  /** definition of the figure (04 §4 named figures), shown on hover */
  title?: string;
  onClick?: () => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick' | 'title'>) {
  const body = (
    <>
      <div className="flex min-h-3 items-center gap-1.5 truncate ts-label-micro !normal-case text-text-muted">
        {delta}
        {delta && meta ? <span aria-hidden>·</span> : null}
        {meta ? <span className="truncate">{meta}</span> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
        <bdi dir="ltr" className="ts-numeral-l tabular-nums">
          {value}
        </bdi>
        <span className="ts-label-micro text-text-muted">{unit}</span>
      </div>
      {sub ? (
        <div className="mt-1 truncate ts-label-micro !normal-case text-text-muted">{sub}</div>
      ) : null}
    </>
  );
  const cls = cn(
    'block w-full rounded-card border border-line-edge bg-ink-surface px-3 py-2.5 text-start',
    onClick && 'transition-colors hover:border-line-lit',
    className,
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cls}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {body}
      </button>
    );
  }
  return (
    <div title={title} className={cls} {...rest}>
      {body}
    </div>
  );
}

export function AnaKpiSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          data-skeleton="kpi"
          className="h-[78px] animate-pulse rounded-card border border-line-edge bg-ink-surface"
        />
      ))}
    </>
  );
}

/* ---------- panel: title, legend / link on the end side, body ---------- */
export function ChartPanel({
  title,
  end,
  children,
  footer,
  className,
  bodyClassName,
  ...rest
}: {
  title: string;
  end?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-card border border-line-edge bg-ink-surface',
        className,
      )}
      {...rest}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="ts-title">{title}</h2>
        {end ? <div className="flex flex-wrap items-center gap-1.5">{end}</div> : null}
      </header>
      <div className={cn('min-w-0 flex-1 px-4 pb-4', bodyClassName)}>{children}</div>
      {footer ? <div className="border-t border-line-hairline px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}

/** Legend chip ("REVENUS", "PÉRIODE PRÉC. (POINTILLÉS)"); with `onToggle` it picks the plotted measure. */
export function LegendChip({
  tone,
  children,
  pressed,
  onToggle,
  dashed,
}: {
  tone: ChartTone;
  children: React.ReactNode;
  pressed?: boolean;
  onToggle?: () => void;
  dashed?: boolean;
}) {
  const cls = cn(
    'inline-flex h-5 items-center gap-1.5 rounded-[4px] border px-1.5 ts-label-micro',
    LEGEND[tone],
    onToggle && pressed === false && 'opacity-45',
  );
  const mark = dashed ? (
    <span aria-hidden className="w-3 border-t border-dashed border-current" />
  ) : null;
  if (onToggle) {
    return (
      <button type="button" aria-pressed={pressed} onClick={onToggle} className={cls}>
        {mark}
        {children}
      </button>
    );
  }
  return (
    <span className={cls}>
      {mark}
      {children}
    </span>
  );
}

/* ---------- bar chart: one bucket per day / week / month, stacked (or grouped) series, previous period dashed ---------- */
export type ChartSeries = { key: string; label: string; tone: ChartTone };
export type ChartBucket = { key: string; label: string; values: number[] };

/** 1 / 2 / 5 × 10ⁿ at or above `v`: the top of a readable scale (12 ⇒ 20, 48 ⇒ 50, 130 ⇒ 200). */
export const niceCeil = (v: number) => {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

export function BarChart({
  buckets,
  series,
  previous,
  format,
  emphasis = 'all',
  height = 180,
  label,
  previousLabel,
  empty,
  startLabel,
  endLabel,
  caption,
  layout = 'stacked',
  axis = false,
  className,
}: {
  buckets: ChartBucket[];
  series: ChartSeries[];
  /** totals of the previous period, aligned on the buckets (dashed line) */
  previous?: (number | null)[] | null;
  format: (n: number) => string;
  /** `top`: only the 4 best buckets carry the colour (single series, Figma "Revenus par jour") */
  emphasis?: 'all' | 'top';
  height?: number;
  /** accessible name of the chart */
  label: string;
  previousLabel?: string;
  empty?: string;
  startLabel?: string;
  endLabel?: string;
  caption?: React.ReactNode;
  /** `grouped`: the series side by side in each bucket (values that are not parts of one total, e.g. sign-ups and activations) */
  layout?: 'stacked' | 'grouped';
  /** a scale (top and half values) and dates under the bars, every few buckets (tester report 22/10 UX-007) */
  axis?: boolean;
  className?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const totals = buckets.map((b) => b.values.reduce((s, v) => s + (v || 0), 0));
  const prev = previous ?? null;
  const peak = Math.max(
    1,
    ...(layout === 'grouped' ? buckets.flatMap((b) => b.values.map((v) => v || 0)) : totals),
    ...(prev ?? []).map((v) => v ?? 0),
  );
  const max = axis ? niceCeil(peak) : peak;
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 7));
  const isEmpty = totals.every((v) => !v) && !(prev ?? []).some((v) => v);
  const top = React.useMemo(() => {
    if (emphasis !== 'top') return null;
    return new Set(
      totals
        .map((v, i) => [v, i] as const)
        .filter(([v]) => v > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 4)
        .map(([, i]) => i),
    );
  }, [emphasis, totals]);
  const n = buckets.length;
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    const rtl = (e.currentTarget as HTMLElement).closest('[dir="rtl"]') !== null;
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) setActive((a) => (a === null ? 0 : Math.min(n - 1, a + 1)));
    else if (e.key === back) setActive((a) => (a === null ? n - 1 : Math.max(0, a - 1)));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };
  const tip = active !== null ? buckets[active] : null;
  return (
    <div className={cn('flex flex-col gap-2', axis && 'pt-3', className)} data-testid="bar-chart">
      <div
        role="img"
        aria-label={label}
        tabIndex={isEmpty ? -1 : 0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="relative w-full rounded-[4px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound"
        style={{ height }}
      >
        {isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-[4px] border border-dashed border-line-edge ts-label-meta text-text-muted">
            {empty}
          </div>
        ) : (
          <>
            {/* recessive grid: half and full height */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 border-t border-line-hairline"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line-hairline"
            />
            {axis ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute start-0 top-0 z-[1] -translate-y-full pb-0.5 ts-label-micro tabular-nums text-text-muted"
                  data-testid="chart-scale-max"
                >
                  {format(max)}
                </span>
                {Number.isInteger(max / 2) ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute start-0 top-1/2 z-[1] -translate-y-full pb-0.5 ts-label-micro tabular-nums text-text-muted"
                  >
                    {format(max / 2)}
                  </span>
                ) : null}
              </>
            ) : null}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {buckets.map((b, i) => {
                const total = totals[i]!;
                const h = (total / max) * 100;
                const on = active === i;
                return (
                  <div
                    key={b.key}
                    className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
                    onMouseEnter={() => setActive(i)}
                    data-bucket={b.key}
                    data-value={total}
                  >
                    {layout === 'grouped' ? (
                      <div
                        className={cn(
                          'mx-auto flex h-full w-[84%] max-w-12 items-end gap-px',
                          on && 'brightness-125',
                        )}
                      >
                        {series.map((s, si) => {
                          const v = b.values[si] ?? 0;
                          return (
                            <div
                              key={s.key}
                              className={cn('min-w-0 flex-1 rounded-t-[2px]', BG[s.tone])}
                              style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                              data-series={s.key}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'mx-auto flex w-[72%] max-w-10 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[3px]',
                          on && 'brightness-125',
                        )}
                        style={{ height: `${h}%`, minHeight: total > 0 ? 2 : 0 }}
                      >
                        {series.map((s, si) => {
                          const v = b.values[si] ?? 0;
                          if (!v) return null;
                          const muted = top !== null && !top.has(i);
                          return (
                            <div
                              key={s.key}
                              className={cn('w-full', muted ? 'bg-ink-raised-high' : BG[s.tone])}
                              style={{ flexGrow: v, flexBasis: 0 }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {prev && prev.some((v) => v !== null) ? (
              <svg
                aria-hidden
                viewBox={`0 0 ${n} 100`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full rtl:-scale-x-100"
              >
                <polyline
                  fill="none"
                  stroke="var(--text-secondary)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  points={prev
                    .map((v, i) =>
                      v === null ? null : `${i + 0.5},${100 - ((v ?? 0) / max) * 100}`,
                    )
                    .filter(Boolean)
                    .join(' ')}
                />
              </svg>
            ) : null}
            {tip ? (
              <div
                role="status"
                className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-[6px] border border-line-edge bg-ink-raised-high px-2.5 py-2 text-[12px] shadow-xl"
                style={{
                  insetInlineStart: `min(calc(${((active! + 0.5) / n) * 100}% + 8px), calc(100% - 9.5rem))`,
                }}
                data-testid="chart-tooltip"
              >
                <div className="ts-label-micro text-text-muted">{tip.label}</div>
                {series.map((s, si) => (
                  <div key={s.key} className="mt-1 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary">
                      <span aria-hidden className={cn('size-2 rounded-[2px]', BG[s.tone])} />
                      {s.label}
                    </span>
                    <bdi dir="ltr" className="tabular-nums">
                      {format(tip.values[si] ?? 0)}
                    </bdi>
                  </div>
                ))}
                {prev && prev[active!] !== null && prev[active!] !== undefined ? (
                  <div className="mt-1 flex items-center justify-between gap-3 border-t border-line-hairline pt-1 text-text-muted">
                    <span>{previousLabel}</span>
                    <bdi dir="ltr" className="tabular-nums">
                      {format(prev[active!] ?? 0)}
                    </bdi>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      {axis && !isEmpty ? (
        <div
          aria-hidden
          className="flex gap-[2px] ts-label-micro !normal-case text-text-muted"
          data-testid="chart-dates"
        >
          {buckets.map((b, i) => (
            <span
              key={b.key}
              className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"
            >
              {i % tickEvery === 0 ? b.label : ''}
            </span>
          ))}
        </div>
      ) : null}
      {startLabel || endLabel || caption ? (
        <div className="flex items-center justify-between gap-3 ts-label-micro !normal-case text-text-muted">
          <span>{startLabel}</span>
          {caption ? <span className="truncate text-center">{caption}</span> : null}
          <span>{endLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- horizontal funnel / share bars ("Entonnoir conversation → livraison") ---------- */
export type FunnelRow = {
  key: string;
  label: string;
  value: number;
  formatted: string;
  tone: ChartTone;
  hint?: string;
};
export function FunnelBars({
  rows,
  max,
  className,
}: {
  rows: FunnelRow[];
  max?: number;
  className?: string;
}) {
  const top = Math.max(1, max ?? Math.max(0, ...rows.map((r) => r.value)));
  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {rows.map((r) => (
        <li key={r.key} data-row={r.key} title={r.hint}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-text-secondary">{r.label}</span>
            <bdi dir="ltr" className="tabular-nums">
              {r.formatted}
            </bdi>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-ink-raised-high">
            <div
              className={cn('h-full rounded-full', BG[r.tone])}
              style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- ranked list panel ("Top produits (revenus)" · "Tout voir →") ---------- */
export type RankRow = {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  href?: string;
};
export function RankPanel({
  title,
  link,
  rows,
  empty,
  renderLink,
  className,
  ...rest
}: {
  title: string;
  link?: React.ReactNode;
  rows: RankRow[];
  empty?: string;
  renderLink?: (href: string, children: React.ReactNode, className: string) => React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-card border border-line-edge bg-ink-surface',
        className,
      )}
      {...rest}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line-hairline px-4 py-3">
        <h2 className="ts-title">{title}</h2>
        {link}
      </header>
      {rows.length ? (
        <ul className="divide-y divide-line-hairline">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <bdi dir="ltr" className="whitespace-nowrap tabular-nums">
                  {r.value}
                </bdi>
                <span className="min-w-12 shrink-0 whitespace-nowrap text-end">{r.delta}</span>
              </>
            );
            const cls = 'flex items-center gap-3 px-4 py-2.5 text-[13px]';
            return (
              <li key={r.key} data-row={r.key}>
                {r.href && renderLink ? (
                  renderLink(r.href, inner, cn(cls, 'hover:bg-ink-raised/60'))
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center ts-label-meta text-text-muted">{empty}</p>
      )}
    </section>
  );
}

/* ---------- donut (part of a whole, ≤ 6 slices + legend with values) ---------- */
export type DonutSlice = { key: string; label: string; value: number; tone: ChartTone };
export function DonutChart({
  slices,
  center,
  format,
  label,
  empty,
  className,
}: {
  slices: DonutSlice[];
  center?: React.ReactNode;
  format: (n: number) => string;
  label: string;
  empty?: string;
  className?: string;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = 15.9155; // circumference 100
  let offset = 0;
  return (
    <div className={cn('flex items-center gap-4', className)} data-testid="donut">
      <div className="relative size-28 shrink-0">
        <svg viewBox="0 0 42 42" role="img" aria-label={label} className="size-full -rotate-90">
          <circle
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke="var(--ink-raised-high)"
            strokeWidth="5"
          />
          {total > 0
            ? slices.map((s) => {
                const pct = (Math.max(0, s.value) / total) * 100;
                const gap = slices.length > 1 && pct > 1 ? 0.8 : 0;
                const el = (
                  <circle
                    key={s.key}
                    cx="21"
                    cy="21"
                    r={R}
                    fill="none"
                    stroke={STROKE[s.tone]}
                    strokeWidth="5"
                    strokeDasharray={`${Math.max(0, pct - gap)} ${100 - Math.max(0, pct - gap)}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += pct;
                return el;
              })
            : null}
        </svg>
        {center ? (
          <div className="absolute inset-0 flex items-center justify-center text-center ts-label-meta">
            {center}
          </div>
        ) : null}
      </div>
      {total > 0 ? (
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[12px]" data-slice={s.key}>
              <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', BG[s.tone])} />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{s.label}</span>
              <bdi dir="ltr" className="tabular-nums">
                {format(s.value)}
              </bdi>
              <bdi
                dir="ltr"
                className="w-10 text-end tabular-nums text-text-muted"
              >{`${Math.round((s.value / total) * 100)} %`}</bdi>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ts-label-meta text-text-muted">{empty}</p>
      )}
    </div>
  );
}

/* ---------- wilaya choropleth (sequential, one hue, light → dark; 0 = no data) ---------- */
const STEP_OPACITY = [0, 0.18, 0.34, 0.52, 0.72, 0.95];
export function WilayaMap({
  values,
  names,
  format,
  onSelect,
  selected,
  tone = 'orders',
  labels,
  className,
}: {
  /** wilaya code (1–69) → value */
  values: Record<number, number>;
  names: Record<number, string>;
  format: (n: number) => string;
  onSelect?: (code: number) => void;
  selected?: number | null;
  tone?: ChartTone;
  labels: { title: string; low: string; high: string; noData: string };
  className?: string;
}) {
  const geo = React.useMemo(() => wilayaGeometry(), []);
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(0, ...Object.values(values));
  const shown = hover ?? selected ?? null;
  return (
    <figure className={cn('flex flex-col gap-2', className)} data-testid="wilaya-map">
      <svg
        viewBox={`-1 -1 ${geo.width} ${geo.height}`}
        role="group"
        aria-label={labels.title}
        className="h-auto w-full"
        onMouseLeave={() => setHover(null)}
      >
        {geo.shapes.map((s) => {
          const v = values[s.code] ?? 0;
          const step = choroplethStep(v, max);
          const name = names[s.code] ?? String(s.code);
          const text = `${String(s.code).padStart(2, '0')} ${name} · ${v ? format(v) : labels.noData}`;
          return (
            <path
              key={s.code}
              d={s.path}
              data-wilaya={s.code}
              data-step={step}
              role={onSelect ? 'button' : 'img'}
              tabIndex={onSelect ? 0 : -1}
              aria-label={text}
              onMouseEnter={() => setHover(s.code)}
              onFocus={() => setHover(s.code)}
              onBlur={() => setHover(null)}
              onClick={onSelect ? () => onSelect(s.code) : undefined}
              onKeyDown={
                onSelect
                  ? (e) =>
                      (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(s.code))
                  : undefined
              }
              fill={step ? STROKE[tone] : 'var(--ink-raised)'}
              fillOpacity={step ? STEP_OPACITY[step] : 1}
              stroke={shown === s.code ? 'var(--text-primary)' : 'var(--ink-base)'}
              strokeWidth={shown === s.code ? 1.2 : 0.6}
              className={cn('outline-none', onSelect && 'cursor-pointer')}
            >
              <title>{text}</title>
            </path>
          );
        })}
      </svg>
      <figcaption className="flex items-center justify-between gap-3 ts-label-micro !normal-case text-text-muted">
        <span className="truncate" data-testid="wilaya-map-focus">
          {shown
            ? `${String(shown).padStart(2, '0')} ${names[shown] ?? ''} · ${values[shown] ? format(values[shown]!) : labels.noData}`
            : labels.title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {labels.low}
          {[1, 2, 3, 4, 5].map((st) => (
            <span
              key={st}
              aria-hidden
              className="h-2 w-3 rounded-[1px]"
              style={{ background: STROKE[tone], opacity: STEP_OPACITY[st] }}
            />
          ))}
          {labels.high}
        </span>
      </figcaption>
    </figure>
  );
}

/* ---------- period picker: presets row + custom range form ---------- */
export type PresetOption = { value: string; label: string };
const presetClass = (on: boolean) =>
  cn(
    'flex h-9 items-center rounded-card border px-3.5 text-[14px] transition-colors',
    on
      ? 'border-white bg-white font-medium text-black'
      : 'border-line-edge bg-ink-surface text-text-primary hover:border-line-lit',
  );

export function PeriodPresets({
  options,
  value,
  onChange,
  label,
  className,
  custom,
}: {
  options: PresetOption[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  className?: string;
  /** "Personnalisé ⌄": a preset that opens the range form */
  custom?: {
    value: string;
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    content: React.ReactNode;
  };
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid="period-presets">
      <div role="radiogroup" aria-label={label} className="contents">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-preset={o.value}
              onClick={() => onChange(o.value)}
              className={presetClass(on)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {custom ? (
        <Popover.Root open={custom.open} onOpenChange={custom.onOpenChange}>
          <Popover.Trigger asChild>
            {/* a popover trigger (aria-expanded): a pressed button next to the radio group, not a radio */}
            <button
              type="button"
              aria-pressed={custom.value === value}
              data-preset={custom.value}
              className={cn(presetClass(custom.value === value), 'gap-1.5')}
            >
              {custom.label}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-50 w-80 rounded-card border border-line-edge bg-ink-raised p-3 shadow-xl"
            >
              {custom.content}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}

/** "Personnalisé": empty dates → start chosen (hint) → applied; the error (code) is shown under the fields. */
export function DateRangeForm({
  from,
  to,
  onChange,
  onApply,
  onCancel,
  error,
  hint,
  labels,
  max,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  onApply: () => void;
  onCancel?: () => void;
  error?: string | null;
  hint?: string | null;
  labels: { from: string; to: string; apply: string; cancel?: string };
  /** last selectable day (today, Africa/Algiers) */
  max?: string;
}) {
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="custom-range"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="ts-label-micro text-text-muted">{labels.from}</span>
          <DateInput
            name="from"
            value={from}
            max={max}
            onValueChange={(v) => onChange({ from: v, to })}
            className="!h-9 text-[13px]"
            aria-invalid={!!error || undefined}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ts-label-micro text-text-muted">{labels.to}</span>
          <DateInput
            name="to"
            value={to}
            max={max}
            onValueChange={(v) => onChange({ from, to: v })}
            className="!h-9 text-[13px]"
            aria-invalid={!!error || undefined}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-accent-alert" data-testid="range-error">
          {error}
        </p>
      ) : hint ? (
        <p className="ts-label-micro !normal-case text-text-muted">{hint}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel && labels.cancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {labels.cancel}
          </Button>
        ) : null}
        <Button size="sm" variant="primary" type="submit" data-testid="range-apply">
          {labels.apply}
        </Button>
      </div>
    </form>
  );
}

/* ---------- reports hub: group card + row with the favourite star ---------- */
export function ReportGroup({
  title,
  count,
  children,
  className,
  ...rest
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-line-edge bg-ink-surface',
        className,
      )}
      {...rest}
    >
      <h2 className="border-b border-line-hairline px-4 py-2.5 ts-label-meta uppercase tracking-[0.2em] text-text-muted">{`${title} · ${count}`}</h2>
      <ul className="divide-y divide-line-hairline">{children}</ul>
    </section>
  );
}

export function ReportRow({
  name,
  description,
  favorite,
  onToggleFavorite,
  favoriteLabel,
  renderLink,
  badge,
  ...rest
}: {
  name: string;
  description?: string;
  favorite: boolean;
  onToggleFavorite?: () => void;
  favoriteLabel: string;
  /** the row link (Next `Link`) */
  renderLink: (children: React.ReactNode, className: string) => React.ReactNode;
  badge?: React.ReactNode;
} & React.HTMLAttributes<HTMLLIElement>) {
  return (
    <li className="flex items-center gap-1 pe-2 hover:bg-ink-raised/60" {...rest}>
      {renderLink(
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px]">{name}</span>
            {description ? (
              <span className="block truncate ts-label-micro !normal-case text-text-muted">
                {description}
              </span>
            ) : null}
          </span>
          {badge}
        </>,
        'flex min-w-0 flex-1 items-center gap-2 py-2.5 ps-4',
      )}
      {onToggleFavorite ? (
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={favoriteLabel}
          title={favoriteLabel}
          onClick={onToggleFavorite}
          className={cn(
            'p-1.5',
            favorite ? 'text-accent-starred' : 'text-text-muted hover:text-text-primary',
          )}
          data-testid="report-favorite"
        >
          <Star className="size-3.5" fill={favorite ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ) : null}
      <ChevronRight aria-hidden className="size-3.5 text-text-muted rtl:-scale-x-100" />
    </li>
  );
}

/* ---------- "Exports récents" row: title, meta line, state pill, one explicit button (D42 exception) ---------- */
export type ExportJobState = 'running' | 'ready' | 'failed' | 'cancelled' | 'expired';
const JOB_PILL: Record<ExportJobState, string> = {
  running: 'border-accent-starred/50 text-accent-starred',
  ready: 'border-accent-money/40 text-accent-money',
  failed: 'border-accent-alert/50 text-accent-alert',
  cancelled: 'border-line-edge text-text-muted',
  expired: 'border-line-edge text-text-muted',
};
export function ExportJobRow({
  title,
  meta,
  state,
  pill,
  action,
  progress,
  ...rest
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  state: ExportJobState;
  pill: string;
  action?: React.ReactNode;
  progress?: number;
} & React.HTMLAttributes<HTMLLIElement>) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-state={state} {...rest}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">{title}</div>
        <div className="mt-0.5 truncate ts-label-micro !normal-case text-text-muted">
          {meta ?? '—'}
        </div>
        {state === 'running' && progress !== undefined ? (
          <div className="mt-1.5 h-1 w-40 max-w-full rounded-full bg-ink-raised-high" aria-hidden>
            <div
              className="h-full rounded-full bg-accent-starred"
              style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
            />
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          'inline-flex h-5 max-w-full items-center rounded-[4px] border px-1.5 ts-label-micro',
          JOB_PILL[state],
        )}
        data-testid="job-pill"
      >
        <span className="truncate">{pill}</span>
      </span>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/** Rounded card listing rows (export jobs). */
export function ListCard({
  children,
  className,
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <ul className="divide-y divide-line-hairline" {...rest}>
        {children}
      </ul>
    </Card>
  );
}
