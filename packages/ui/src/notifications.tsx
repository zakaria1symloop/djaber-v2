'use client';
// Notification centre & queue pieces — Figma "NTF-01 — Notifications — list", "QUEUE — File d'attente — items".
// Presentational only: copy, links and actions come in through props.
import * as React from 'react';
import { cn, Skeleton } from './primitives';

/* ---------- Row of the notification list: unread dot · family pill · title / body / slug · age · "Ouvrir ›" ---------- */
export function NotificationRow({
  unread,
  unreadLabel,
  pill,
  title,
  body,
  slug,
  age,
  action,
  className,
  ...rest
}: {
  unread: boolean;
  /** accessible name of the dot ("Non lue") */
  unreadLabel: string;
  pill: React.ReactNode;
  title: string;
  body?: string | null;
  /** the notification type in words (« Rupture de stock ») — UX-059: never the dotted key */
  slug: string;
  age: string;
  /** "Ouvrir ›" link or button */
  action?: React.ReactNode;
  className?: string;
} & Omit<React.LiHTMLAttributes<HTMLLIElement>, 'title'>) {
  return (
    <li data-unread={unread} className={cn('flex items-center gap-4 border-b border-line-hairline px-4 py-3.5 last:border-b-0', unread && 'bg-ink-raised/60', className)} {...rest}>
      <span className="flex w-2 shrink-0 justify-center">{unread ? <span role="img" aria-label={unreadLabel} className="size-2 rounded-full bg-signal-live" /> : null}</span>
      <span className="shrink-0 max-sm:hidden">{pill}</span>
      <div className="min-w-0 flex-1">
        <span className="mb-1 hidden max-sm:block">{pill}</span>
        <div className={cn('truncate text-[14px] text-text-primary', unread && 'font-medium')}>
          <bdi>{title}</bdi>
        </div>
        {body ? (
          <div className="mt-0.5 line-clamp-2 text-[13px] text-text-secondary">
            <bdi>{body}</bdi>
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 ts-label-micro normal-case text-text-muted">
          <bdi>{slug}</bdi>
          <span className="uppercase sm:hidden">{age}</span>
        </div>
      </div>
      <span className="shrink-0 whitespace-nowrap ts-label-meta uppercase text-text-muted max-sm:hidden">{age}</span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </li>
  );
}

/** Skeleton of the notification list: 5 rows on the same grid (GLOBAL list states). */
export function NotificationListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <ul role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 border-b border-line-hairline px-4 py-4 last:border-b-0">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-5 w-24" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-3 w-10" />
        </li>
      ))}
    </ul>
  );
}

/* ---------- Queue card: label line + age, title, preview, then the attached action bar ---------- */
export function QueueCard({
  label,
  age,
  title,
  preview,
  meta,
  actions,
  className,
  ...rest
}: {
  /** mono line ("TRANSFERT · REMBOURSEMENT") */
  label: React.ReactNode;
  age: string;
  title: React.ReactNode;
  /** last customer message (any script: isolated with `<bdi>`, aligned with the page) */
  preview?: string | null;
  /** start side of the action bar ("ASSIGNÉE : SARA K.") */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <article className={cn('flex flex-col', className)} {...rest}>
      <div className="rounded-card border border-line-edge bg-ink-surface px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate ts-label-meta uppercase text-text-secondary">{label}</span>
          <span className="shrink-0 whitespace-nowrap ts-label-meta uppercase text-text-muted">{age}</span>
        </div>
        <div className="mt-1.5 truncate text-[14px] font-medium">{title}</div>
        {preview ? (
          <p className="mt-1 line-clamp-2 text-[13px] text-text-secondary">
            <bdi>{preview}</bdi>
          </p>
        ) : null}
      </div>
      {meta || actions ? (
        <div className="flex flex-wrap items-center gap-2 rounded-b-card bg-ink-raised px-3 py-2">
          {/* basis: on a phone the buttons wrap under the assignee line instead of cutting it to one letter */}
          <span className="min-w-0 flex-1 basis-32 truncate ts-label-meta uppercase text-text-muted">{meta}</span>
          {actions}
        </div>
      ) : null}
    </article>
  );
}

/** Insight card of the queue ("PROBLÈMES SIGNALÉS"): pill · who · age, quoted customer message, what the agent did, actions. */
export function InsightCard({
  pill,
  who,
  age,
  quote,
  detail,
  actions,
  className,
  ...rest
}: {
  pill: React.ReactNode;
  who?: React.ReactNode;
  age: string;
  quote: string;
  detail?: string | null;
  actions?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <article className={cn('rounded-card border border-line-edge bg-ink-surface px-3.5 py-3.5', className)} {...rest}>
      <div className="flex items-center gap-3">
        {pill}
        <span className="min-w-0 flex-1 truncate ts-label-meta text-text-muted">{who}</span>
        <span className="shrink-0 whitespace-nowrap ts-label-meta uppercase text-text-muted">{age}</span>
      </div>
      <p className="mt-2.5 text-[13px]">
        <bdi>{quote}</bdi>
      </p>
      {detail ? <p className="mt-1.5 text-[13px] text-text-secondary">{detail}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </article>
  );
}

/** Column header of the queue: mono label + count on the end side. */
export function CountHeading({ children, count, className }: { children: React.ReactNode; count: number; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-5 pb-1', className)}>
      <h2 className="ts-label-section text-text-muted">{children}</h2>
      <span className="ts-label-meta tabular-nums text-text-primary">{count}</span>
    </div>
  );
}
