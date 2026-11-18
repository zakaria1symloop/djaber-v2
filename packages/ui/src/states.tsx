'use client';
// GLOBAL — States, toasts, banners & system dialogs catalogue (Figma 996:42199). All copy comes in through props.
import { Ban, FileQuestion, Lock, PauseCircle, SearchX, Square, TriangleAlert, WifiOff, Wrench, X } from 'lucide-react';
import * as React from 'react';
import { Button, buttonClass, Card, cn, type Tone } from './primitives';

export type StateAction = { label: string; onClick?: () => void; href?: string; variant?: 'primary' | 'secondary'; disabled?: boolean; /** shown on a greyed action (journey J07r-2) */ disabledReason?: string };

function ActionButton({ action }: { action: StateAction }) {
  // a link stays a link (styled as a button): no button nested in an anchor
  if (action.href) {
    return (
      <a href={action.href} onClick={action.onClick} className={buttonClass({ variant: action.variant ?? 'primary' })}>
        {action.label}
      </a>
    );
  }
  return (
    <Button variant={action.variant ?? 'primary'} onClick={action.onClick} disabled={action.disabled || !!action.disabledReason} disabledReason={action.disabledReason}>
      {action.label}
    </Button>
  );
}

/** Centered block used by empty / filtered-empty / error / not-found / forbidden states. */
export function StateBlock({
  icon,
  title,
  description,
  action,
  secondaryAction,
  tone,
  className,
  code,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: StateAction;
  secondaryAction?: StateAction;
  tone?: 'danger';
  className?: string;
  /** big code for system pages (403 / 404) */
  code?: string;
}) {
  return (
    <Card className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      {code ? <div className="ts-display-s text-text-secondary">{code}</div> : null}
      {icon ? <div className={cn('text-text-secondary', tone === 'danger' && 'text-accent-alert')}>{icon}</div> : null}
      <h2 className="ts-title">{title}</h2>
      {description ? <p className="ts-label-meta max-w-md text-text-muted">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {secondaryAction ? <ActionButton action={{ variant: 'secondary', ...secondaryAction }} /> : null}
          {action ? <ActionButton action={action} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

type Copy = { title: string; description?: string; action?: StateAction; secondaryAction?: StateAction; className?: string; code?: string };

export const EmptyState = (p: Copy & { icon?: React.ReactNode }) => <StateBlock icon={p.icon ?? <Square className="size-5" />} {...p} />;
export const FilteredEmptyState = (p: Copy) => <StateBlock icon={<SearchX className="size-5" />} {...p} action={p.action && { variant: 'secondary', ...p.action }} />;
export const ErrorState = (p: Copy) => (
  <StateBlock icon={<TriangleAlert className="size-5" />} tone="danger" {...p} action={p.action && { variant: 'secondary', ...p.action }} />
);
export const NotFoundState = (p: Copy) => <StateBlock icon={<FileQuestion className="size-5" />} {...p} />;
export const ForbiddenState = (p: Copy) => <StateBlock icon={<Ban className="size-5" />} tone="danger" {...p} />;
export const SuspendedState = (p: Copy) => <StateBlock icon={<PauseCircle className="size-5" />} {...p} />;
export const SessionExpiredState = (p: Copy) => <StateBlock icon={<Lock className="size-5" />} {...p} />;
export const MaintenanceState = (p: Copy) => <StateBlock icon={<Wrench className="size-5" />} {...p} />;

/** Full-page wrapper for the system pages (403 / 404 / suspended / session expired / maintenance). */
export function SystemPage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col justify-center p-6">{children}</div>;
}

/* ---------- Banner (top of page, one at a time) ---------- */
const BAR: Record<Tone, string> = {
  neutral: 'border-s-text-muted',
  success: 'border-s-accent-money',
  danger: 'border-s-accent-alert',
  info: 'border-s-accent-inbound',
  warning: 'border-s-accent-starred',
  orange: 'border-s-accent-orders',
  violet: 'border-s-accent-clients',
};
export function Banner({
  tone = 'info',
  children,
  action,
  onDismiss,
  dismissLabel,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  action?: StateAction;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[6px] border-s-2 bg-ink-raised px-3 py-2.5 text-[13px]', BAR[tone], className)}
    >
      {/* phones: the action goes under the text instead of squeezing it; long e-mails / URLs break inside the banner */}
      <div className="min-w-0 flex-1 basis-56 [overflow-wrap:anywhere]">{children}</div>
      {action ? <ActionButton action={{ variant: 'secondary', ...action }} /> : null}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="text-text-muted hover:text-text-primary">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** "Hors ligne — données du … Les actions sont désactivées…" */
export function OfflineNotice({ children, action }: { children: React.ReactNode; action?: StateAction }) {
  return (
    <Banner tone="warning" action={action}>
      <span className="inline-flex items-center gap-2">
        <WifiOff className="size-4 shrink-0" aria-hidden />
        {children}
      </span>
    </Banner>
  );
}
