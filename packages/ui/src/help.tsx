// M10 — merchant help center & public status pieces (Figma "HELP — Help & support (merchant)", "PUB — Public status page"):
// category card, ticket row, ticket message, satisfaction stars, service status row, status component row, incident entry.
import { Paperclip, Star } from 'lucide-react';
import * as React from 'react';
import { UptimeBars, type UptimeDay } from './admin-ops';
import { Card, cn, Pill, type Tone } from './primitives';
import { onRadioKeyDown, radioTabIndex } from './radio-keys';

/* ---------- "Démarrer · 6 guides · Connecter une page · premier agent · premier produit" ---------- */
export function HelpCategoryCard({ title, count, description, onSelect, active, className }: { title: string; count: string; description: string; onSelect?: () => void; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'flex min-h-[70px] w-full flex-col gap-1.5 rounded-card border bg-ink-surface px-4 py-3 text-start transition-colors hover:border-line-lit',
        active ? 'border-line-lit bg-ink-raised' : 'border-line-edge',
        className,
      )}
    >
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-text-primary">{title}</span>
        <span className="shrink-0 ts-label-micro text-text-muted">{count}</span>
      </span>
      <span className="line-clamp-2 ts-label-micro text-text-muted">{description}</span>
    </button>
  );
}

/* ---------- "#T-4821 · Google Sheets ne se met plus à jour · ouvert il y a 1 h 20 · RÉPONSE REÇUE" ---------- */
export function TicketRow({
  number,
  subject,
  meta,
  pill,
  tone,
  href,
  linkAs,
  className,
}: {
  number: string;
  subject: string;
  meta: React.ReactNode;
  pill: string;
  tone: Tone;
  href: string;
  /** framework link component (next-intl Link) */
  linkAs?: React.ElementType;
  className?: string;
}) {
  const L = linkAs ?? 'a';
  return (
    <L href={href} data-testid="ticket-row" className={cn('flex items-start gap-3 px-3 py-3 hover:bg-ink-raised', className)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-text-primary">
          <bdi dir="ltr">{number}</bdi> · {subject}
        </span>
        <span className="mt-1 block ts-label-micro text-text-muted">{meta}</span>
      </span>
      <Pill tone={tone} className="shrink-0">
        {pill}
      </Pill>
    </L>
  );
}

/* ---------- Thread message: mono author line, body, attachments; system (auto-context) and internal variants ---------- */
export function TicketMessage({
  author,
  at,
  body,
  kind,
  attachments = [],
  className,
}: {
  author: string;
  at: string;
  body: React.ReactNode;
  kind: 'user' | 'support' | 'system' | 'internal';
  attachments?: { name: string; url: string; size?: string }[];
  className?: string;
}) {
  return (
    <article
      data-author={kind}
      className={cn(
        'rounded-card border px-3 py-2.5',
        kind === 'internal' ? 'border-accent-starred/40 bg-accent-starred/5' : kind === 'system' ? 'border-line-hairline bg-ink-base' : 'border-line-edge bg-ink-surface',
        className,
      )}
    >
      <header className="ts-label-micro text-text-muted">
        {author} · {at}
      </header>
      {/* full-test 15/11 HELP-04: user text in its own direction, line by line (« .Deuxième ligne » in the Arabic UI) */}
      <div dir="auto" className="mt-1.5 whitespace-pre-wrap text-start text-[14px] text-text-primary [unicode-bidi:plaintext]">
        {body}
      </div>
      {attachments.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line-edge px-2 py-0.5 ts-label-meta text-accent-inbound hover:border-line-lit">
                <Paperclip className="size-3" aria-hidden />
                <bdi>{a.name}</bdi>
                {a.size ? <span className="text-text-muted">{a.size}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/* ---------- Satisfaction note 1–5 ---------- */
export function RatingStars({ value, onChange, label, starLabel, disabled }: { value: number | null; onChange?: (v: number) => void; label: string; starLabel: (n: number) => string; disabled?: boolean }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={starLabel(n)}
          tabIndex={radioTabIndex(n - 1, (value ?? 0) - 1)}
          onKeyDown={(e) => onRadioKeyDown(e, n - 1, 5, (i) => onChange?.(i + 1))}
          disabled={disabled || !onChange}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onChange?.(n)}
          className="rounded p-0.5 text-accent-starred disabled:cursor-default"
        >
          <Star className={cn('size-5', n <= shown ? 'fill-current' : 'opacity-40')} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/* ---------- Help widget row: "Google Sheets · INCIDENT · reprise 12:00" ---------- */
export function ServiceStatusRow({ name, pill, tone, className }: { name: string; pill: string; tone: Tone; className?: string }) {
  return (
    <div data-testid="service-row" className={cn('flex items-center justify-between gap-3 px-3 py-2.5', className)}>
      <span className="min-w-0 truncate text-[14px] text-text-primary">{name}</span>
      <Pill tone={tone} className="shrink-0">
        {pill}
      </Pill>
    </div>
  );
}

/* ---------- Public status page component row: dot, name, 90-day bars, %, state pill ---------- */
export function StatusComponentRow({
  name,
  state,
  pill,
  uptime,
  days,
  barsLabel,
  className,
}: {
  name: string;
  state: 'operational' | 'degraded' | 'incident';
  pill: string;
  uptime: string;
  days: UptimeDay[] | null;
  barsLabel: string;
  className?: string;
}) {
  const tone: Tone = state === 'operational' ? 'success' : state === 'degraded' ? 'warning' : 'danger';
  return (
    <div data-testid="status-component" data-state={state} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', className)}>
      <span className={cn('size-2 shrink-0 rounded-full', state === 'operational' ? 'bg-accent-money' : state === 'degraded' ? 'bg-accent-starred' : 'bg-accent-alert')} aria-hidden />
      <span className="min-w-[10rem] flex-1 text-[14px] text-text-primary">{name}</span>
      {days ? <UptimeBars days={days} label={barsLabel} className="max-md:hidden" /> : null}
      {/* fixed widths for the end cluster: the 90-day bars of every row line up */}
      <span dir="ltr" className="w-28 shrink-0 text-end ts-label-micro text-text-muted">
        {uptime}
      </span>
      <span className="flex w-32 shrink-0 justify-end">
        <Pill tone={tone} className="shrink-0">
          {pill}
        </Pill>
      </span>
    </div>
  );
}

/* ---------- Incident history entry: "06 OCT. 11:20 — EN COURS" / title / updates ---------- */
export function IncidentEntry({ meta, title, details, open, className }: { meta: string; title: string; details?: React.ReactNode; open: boolean; className?: string }) {
  return (
    <article data-testid="incident" data-open={open} className={cn('px-4 py-3', className)}>
      <p className={cn('ts-label-micro', open ? 'text-accent-alert' : 'text-text-muted')}>{meta}</p>
      <h3 className="mt-1 text-[15px] font-medium text-text-primary">{title}</h3>
      {details ? <div className="mt-1 ts-label-micro text-text-muted">{details}</div> : null}
    </article>
  );
}

/* ---------- List card: titled card with divided rows ("Mes demandes", "État du service") ---------- */
export function HelpCard({ title, sub, end, children, className, ...rest }: { title: string; sub?: React.ReactNode; end?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)} {...rest}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium text-text-primary">{title}</h2>
          {sub ? <p className="mt-1 ts-label-micro text-text-muted">{sub}</p> : null}
        </div>
        {end}
      </header>
      {children}
    </Card>
  );
}
