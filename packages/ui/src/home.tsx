'use client';
// M5 home kit (Figma ANA-01 — Home — default / new workspace + banners, ANA-01b states catalogue): queue item card,
// KPI tile, quick action card, page card, dashed empty card, skeleton grid. All copy comes in through props; logical
// CSS only (RTL safe).
import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Ltr } from './inputs';
import { Card, cn, Pill, Skeleton, type Tone } from './primitives';

/* ---------- Section heading: "À TRAITER ······ 4" ---------- */
export function HomeSection({ label, count, end, children, className, ...rest }: { label: string; count?: React.ReactNode; end?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, 'children'>) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-3', className)} {...rest}>
      <div className="flex items-baseline justify-between gap-3 px-5">
        <h2 id={id} className="ts-label-section text-text-muted">
          {label}
        </h2>
        {count !== undefined ? <Ltr className="ts-label-meta tabular-nums text-text-primary">{count}</Ltr> : end}
      </div>
      {children}
    </section>
  );
}

/* ---------- "À traiter" card: kind pill · age, title, subtitle; handled = greyed with "fait par …" ---------- */
export function HomeQueueCard({
  kind,
  kindLabel,
  tone,
  age,
  title,
  subtitle,
  handledLabel,
  className,
  ...rest
}: {
  kind: string;
  kindLabel: string;
  tone: Tone;
  age: string;
  title: React.ReactNode;
  /** mono detail line (last customer message, "Client absent (2/3) — Relancer", "4 restants (seuil 5)") */
  subtitle?: React.ReactNode;
  /** Handled card (greyed 24 h): "fait par Nadia F." */
  handledLabel?: string;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <article data-kind={kind} data-handled={handledLabel ? true : undefined} className={cn('rounded-card border border-line-edge bg-ink-surface px-3 py-3 transition-colors hover:border-line-lit', handledLabel && 'opacity-50', className)} {...rest}>
      <div className="flex items-center justify-between gap-3">
        <Pill tone={tone} className="!rounded-[4px] !px-1.5 !py-px">
          {kindLabel}
        </Pill>
        <span className="shrink-0 whitespace-nowrap ts-label-meta uppercase text-text-muted">{age}</span>
      </div>
      <div className="mt-1.5 truncate text-[14px] font-medium">{title}</div>
      {subtitle ? (
        <p className="mt-0.5 line-clamp-2 text-[13px] text-text-secondary">
          <bdi>{subtitle}</bdi>
        </p>
      ) : null}
      {handledLabel ? <p className="mt-1 ts-label-micro text-text-muted">{handledLabel}</p> : null}
    </article>
  );
}

/** "+ 2 autres · colis échoué, rupture de stock" (link to the full queue). */
export function HomeQueueMore({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-card border border-line-edge bg-ink-surface px-3 py-2.5 ts-label-meta text-text-secondary transition-colors hover:border-line-lit', className)}>{children}</div>;
}

/** Dashed card: "Tout est calme" (empty queue), "Aucune page connectée" + "Connecter Facebook". */
export function HomeEmptyCard({ title, description, action, className, ...rest }: { title: string; description?: string; action?: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-card border border-dashed border-line-edge px-6 py-8 text-center', className)} {...rest}>
      <h3 className="text-[15px] font-medium">{title}</h3>
      {description ? <p className="max-w-md text-[13px] text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------- KPI tile: "PAGES CONNECTÉES / 2", "VALEUR DU STOCK / 1,24 M DA", sub line ---------- */
export function HomeKpiTile({ label, value, unit, sub, className, ...rest }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={cn('px-3 py-3', className)} {...rest}>
      <div className="truncate ts-label-micro text-text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5" dir="ltr">
        <span className="ts-numeral-l tabular-nums">{value}</span>
        {unit ? <span className="ts-label-micro text-text-muted">{unit}</span> : null}
      </div>
      {/* journey re-run J14r-7 c: the caption wraps on a phone (« دون احتساب 36 قطعة بلا سـ… » was cut: the reason could not be read) */}
      {sub ? <div className="mt-1 ts-label-micro text-text-muted [overflow-wrap:anywhere]">{sub}</div> : null}
    </Card>
  );
}

/* ---------- Quick action card: icon, title, description, chevron; disabled with its reason ---------- */
export function QuickActionCard({ icon, title, description, disabledReason, className }: { icon: React.ReactNode; title: string; description?: string; disabledReason?: string; className?: string }) {
  return (
    <div
      aria-disabled={disabledReason ? true : undefined}
      title={disabledReason}
      className={cn('flex h-full flex-col gap-3 rounded-card border border-line-edge bg-ink-surface p-4 transition-colors hover:border-line-lit', disabledReason && 'cursor-not-allowed opacity-50 hover:border-line-edge', className)}
    >
      <div className="flex items-center justify-between text-text-secondary">
        {icon}
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </div>
      <div>
        <div className="text-[14px] font-medium">{title}</div>
        {description ? <div className="mt-0.5 text-[13px] text-text-secondary">{description}</div> : null}
        {disabledReason ? <div className="mt-1 ts-label-micro text-text-muted">{disabledReason}</div> : null}
      </div>
    </div>
  );
}

/* ---------- "Vos pages" card ---------- */
export type PageCardTile = { key: string; value: React.ReactNode; label: string; sub?: string };
export function HomePageCard({
  icon,
  name,
  meta,
  badge,
  ai,
  tiles,
  agent,
  actions,
  className,
  ...rest
}: {
  icon: React.ReactNode;
  name: string;
  /** mono line under the name: "FACEBOOK · ACTIVE" */
  meta: React.ReactNode;
  /** status pill (ACTIF / EN ATTENTE META / RECONNEXION REQUISE / EN PAUSE (PLAN)) */
  badge?: React.ReactNode;
  /** "● IA" when an active agent answers on the page */
  ai?: string;
  tiles: PageCardTile[];
  /** agent box: icon, title, mono meta, action */
  agent?: { icon: React.ReactNode; title: string; meta?: string; action?: React.ReactNode };
  /** buttons row (Boîte · Stock · Configurer) */
  actions?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <article className={cn('flex flex-col gap-4 rounded-card border border-line-edge bg-ink-surface p-4', className)} {...rest}>
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line-edge bg-ink-raised text-text-secondary">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate ts-display-s" dir="auto">
            {name}
          </h3>
          <div className="mt-0.5 truncate ts-label-micro text-text-muted">{meta}</div>
          {badge ? <div className="mt-1.5">{badge}</div> : null}
        </div>
        {ai ? (
          <span className="inline-flex shrink-0 items-center gap-1 ts-label-micro text-signal-live">
            <span aria-hidden className="size-1.5 rounded-full bg-signal-live" />
            {ai}
          </span>
        ) : null}
      </header>
      {tiles.length ? (
        <dl className="grid grid-cols-2 gap-3 border-t border-line-hairline pt-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.key} data-tile={tile.key}>
              <dd className="text-[15px] font-semibold tabular-nums" dir="ltr">
                {tile.value}
              </dd>
              <dt className="mt-0.5 ts-label-micro text-text-muted">{tile.label}</dt>
              {tile.sub ? <div className="ts-label-micro text-text-muted">{tile.sub}</div> : null}
            </div>
          ))}
        </dl>
      ) : null}
      {agent ? (
        <div className="flex items-center gap-3 rounded-card border border-line-edge px-3 py-2.5">
          <span className="shrink-0 text-signal-live">{agent.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px]">{agent.title}</div>
            {agent.meta ? <div className="truncate ts-label-micro text-text-muted">{agent.meta}</div> : null}
          </div>
          {agent.action}
        </div>
      ) : null}
      {actions ? <div className="grid grid-cols-3 gap-2">{actions}</div> : null}
    </article>
  );
}

/* ---------- Skeleton: same grid as the page (300 ms delay handled by the caller) ---------- */
export function HomeSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} data-testid="home-skeleton" className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]', className)}>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px]" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
