'use client';
// Inbox kit (Figma "INB — Inbox — thread with handoff", "INB — Inbox — AR (RTL)", "DLG — Inbox & queue — popovers,
// message types, banners, composer states"): three-pane layout, conversation row, message bubbles for every
// `Message.type`, day separators, system / handoff / internal notes, delivery status, thread banner, composer with the
// `/` quick-reply popover and its disabled states. All copy comes in through props; logical CSS only (RTL safe).
import { AlertTriangle, ArrowUpRight, Check, Clock, Download, FileText, Flag, MapPin, Paperclip, Pause, Play, X } from 'lucide-react';
import * as React from 'react';
import { Avatar } from './forms';
import { isolateNumbers } from './bidi';
import { Button, cn, type Tone } from './primitives';

/* ---------- Three panes: list · thread · panel (≥ 1280), list · thread (1024–1279, panel as a drawer), one pane below ---------- */
export function ThreePane({
  list,
  thread,
  panel,
  view,
  panelOpen,
  onPanelClose,
  panelLabel,
  className,
}: {
  list: React.ReactNode;
  thread: React.ReactNode;
  panel?: React.ReactNode;
  /** which pane is shown when only one fits (< 1024) */
  view: 'list' | 'thread';
  /** below 1280 the panel is a drawer on the end side */
  panelOpen?: boolean;
  onPanelClose?: () => void;
  panelLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative flex h-full min-h-0 w-full overflow-hidden', className)} data-view={view}>
      <section data-pane="list" className={cn('min-h-0 w-full flex-col border-e border-line-hairline lg:flex lg:w-[340px] lg:shrink-0', view === 'list' ? 'flex' : 'hidden')}>
        {list}
      </section>
      <section data-pane="thread" className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex', view === 'thread' ? 'flex' : 'hidden')}>
        {thread}
      </section>
      {panel ? (
        <>
          {panelOpen ? <div className="absolute inset-0 z-10 bg-black/60 xl:hidden" onClick={onPanelClose} aria-hidden /> : null}
          <aside
            data-pane="panel"
            aria-label={panelLabel}
            className={cn(
              'min-h-0 w-[min(300px,100%)] shrink-0 flex-col overflow-y-auto border-s border-line-hairline bg-ink-base xl:static xl:flex',
              panelOpen ? 'absolute inset-y-0 end-0 z-20 flex' : 'hidden',
            )}
          >
            {panel}
          </aside>
        </>
      ) : null}
    </div>
  );
}

/* ---------- Small chips ---------- */
export function UnreadBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span aria-label={label} className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold tabular-nums text-black', className)}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
/** Mono tag under a row / next to a title: IA EN PAUSE, TERMINÉ, À TRAITER… */
const TAG: Record<Tone, string> = {
  neutral: 'text-text-muted',
  success: 'text-accent-money',
  danger: 'text-accent-alert',
  info: 'text-accent-inbound',
  warning: 'text-accent-starred',
  orange: 'text-accent-orders',
  violet: 'text-accent-clients',
};
export function MonoTag({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn('ts-label-micro', TAG[tone], className)}>{children}</span>;
}
export function AiBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-4 items-center rounded-[3px] border border-signal-live/40 px-1 ts-label-micro text-signal-live', className)}>{children}</span>;
}
export function AssigneeChip({ name, src, label, className }: { name: string; src?: string | null; label: string; className?: string }) {
  return (
    <span title={label} aria-label={label} className={cn('inline-flex items-center gap-1.5 ts-label-micro text-text-secondary', className)}>
      <Avatar name={name} src={src} size={16} />
      <span className="truncate">{name}</span>
    </span>
  );
}
export function TypingChip({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 ts-label-micro text-text-muted', className)}>
      <span aria-hidden className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1 animate-pulse rounded-full bg-text-muted" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
      {label}
    </span>
  );
}

/* ---------- Conversation row ---------- */
export type ConversationItemProps = {
  name: string;
  avatarUrl?: string | null;
  /** "2 MIN", "LUN." */
  time: string;
  preview: React.ReactNode;
  /** last message was sent by the shop: ↗ before the preview */
  outbound?: boolean;
  unread?: number;
  unreadLabel?: string;
  /** mono tags under the preview (IA EN PAUSE, TERMINÉ…) */
  tags?: React.ReactNode;
  /** end side of the tag line: channel badge, assignee avatar, risk */
  meta?: React.ReactNode;
  active?: boolean;
  /** wraps the row in the app's link (`<Link href>`): receives the class and the content */
  renderLink?: (p: { className: string; children: React.ReactNode; 'aria-current': 'true' | undefined }) => React.ReactElement;
  onClick?: () => void;
  /** selection checkbox (bulk actions) on the start side */
  leading?: React.ReactNode;
};
export function ConversationItem({ name, avatarUrl, time, preview, outbound, unread = 0, unreadLabel, tags, meta, active, renderLink, onClick, leading }: ConversationItemProps) {
  const className = cn('flex w-full min-w-0 items-start gap-3 px-4 py-3 text-start hover:bg-ink-raised/60 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent-inbound', active && 'bg-ink-raised');
  const children = (
    <>
      <span className="relative mt-0.5 shrink-0">
        <Avatar name={name} src={avatarUrl} size={36} square />
        {unread > 0 ? <span aria-hidden className="absolute -end-1 -top-1 size-2.5 rounded-full border-2 border-ink-base bg-white" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[14px]', unread > 0 ? 'font-semibold text-text-primary' : 'font-medium text-text-primary')} dir="auto">
            {name}
          </span>
          <span className="ts-label-micro shrink-0 text-text-muted">{time}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[13px] text-text-secondary">
          {outbound ? <ArrowUpRight aria-hidden className="size-3 shrink-0 text-text-muted rtl:-scale-x-100" /> : null}
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {preview}
          </span>
          <UnreadBadge count={unread} label={unreadLabel ?? String(unread)} />
        </span>
        {tags || meta ? (
          <span className="mt-1 flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">{tags}</span>
            <span className="flex shrink-0 items-center gap-2">{meta}</span>
          </span>
        ) : null}
      </span>
    </>
  );
  const row = renderLink ? (
    renderLink({ className, children, 'aria-current': active ? 'true' : undefined })
  ) : (
    <button type="button" className={className} onClick={onClick} aria-current={active ? 'true' : undefined}>
      {children}
    </button>
  );
  if (!leading) return row;
  return (
    <div className={cn('flex items-center', active && 'bg-ink-raised')}>
      <span className="ps-3">{leading}</span>
      <div className="min-w-0 flex-1">{row}</div>
    </div>
  );
}

/* ---------- Thread: separators and events ---------- */
export function DaySeparator({ children }: { children: React.ReactNode }) {
  return (
    <div role="separator" className="my-2 flex items-center gap-3">
      <span aria-hidden className="h-px flex-1 bg-line-hairline" />
      <span className="ts-label-micro text-text-muted">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line-hairline" />
    </div>
  );
}
/** "— Commande #CMD-1042 créée par l'IA · 10:58 —" */
export function SystemEvent({ children, tone }: { children: React.ReactNode; tone?: 'warning' }) {
  return (
    <div data-message="system" className={cn('mx-auto max-w-[90%] text-center ts-label-meta', tone === 'warning' ? 'text-accent-starred' : 'text-text-muted')}>
      <span aria-hidden>— </span>
      {children}
      <span aria-hidden> —</span>
    </div>
  );
}
/** "⚑ TRANSMIS À UN HUMAIN · RÈGLE « REMBOURSEMENT » · 10:52" */
export function HandoffNote({ children }: { children: React.ReactNode }) {
  return (
    <div data-message="handoff" className="mx-auto inline-flex max-w-[90%] items-center gap-2 self-center rounded-[4px] border border-accent-starred/40 px-2.5 py-1 ts-label-micro text-accent-starred">
      <Flag aria-hidden className="size-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
/** Internal note (never sent to the customer): notes panel and, when shown in the thread, a dashed card. */
export function InternalNote({ author, time, children, className }: { author: string; time: string; children: React.ReactNode; className?: string }) {
  return (
    <div data-message="note" className={cn('rounded-card border border-line-edge bg-ink-surface px-3 py-2.5', className)}>
      <p className="whitespace-pre-wrap break-words text-[13px] text-text-secondary" dir="auto">
        {children}
      </p>
      <div className="mt-1.5 ts-label-micro text-text-muted">
        {author} · {time}
      </div>
    </div>
  );
}

/* ---------- Delivery status of an outbound message ---------- */
export type DeliveryLabels = { pending: string; sent: string; failed: string; skipped_window: string; retry: string };
export function DeliveryMark({ status, labels }: { status: 'pending' | 'sent' | 'failed' | 'skipped_window'; labels: DeliveryLabels }) {
  if (status === 'pending') return <Clock aria-label={labels.pending} className="inline size-3 text-text-muted" />;
  if (status === 'sent') return <Check aria-label={labels.sent} className="inline size-3 text-text-muted" />;
  return <AlertTriangle aria-label={status === 'failed' ? labels.failed : labels.skipped_window} className="inline size-3 text-accent-alert" />;
}
/** "⚠ Non délivré — hors fenêtre 24 h · Réessayer" under a failed / skipped bubble. */
export function DeliveryFailure({ children, retryLabel, onRetry, retrying }: { children: React.ReactNode; retryLabel?: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-end gap-2 ts-label-meta text-accent-alert">
      <AlertTriangle aria-hidden className="size-3 shrink-0" />
      <span>{children}</span>
      {onRetry && retryLabel ? (
        <button type="button" onClick={onRetry} disabled={retrying} className="text-accent-inbound hover:underline disabled:opacity-50">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Message bubble ---------- */
export type BubbleAuthor = 'customer' | 'ai' | 'human';
export function MessageBubble({
  author,
  children,
  meta,
  footer,
  grouped,
  bare,
  pending,
  flagged,
  menu,
  id,
}: {
  author: BubbleAuthor;
  children: React.ReactNode;
  /** mono line under the bubble: "10:41 · CLIENTE", "10:41 · VENDEUR PRO · IA", "NADIA F. · 10:42" */
  meta?: React.ReactNode;
  /** failure line, transcript states… under the meta */
  footer?: React.ReactNode;
  /** follows a bubble of the same author: tighter spacing */
  grouped?: boolean;
  /** media-only content: no padding, no background */
  bare?: boolean;
  /** optimistic copy still being sent */
  pending?: boolean;
  /** inbound text containing a blocked word */
  flagged?: boolean;
  /** message menu on hover (report an AI answer) */
  menu?: React.ReactNode;
  id?: string;
}) {
  const out = author !== 'customer';
  return (
    <div data-message={author} data-message-id={id} data-pending={pending || undefined} className={cn('group flex flex-col gap-1', out ? 'items-end' : 'items-start', grouped ? 'mt-1' : 'mt-3')}>
      <div className={cn('flex max-w-[min(34rem,85%)] items-center gap-1.5', out && 'flex-row-reverse')}>
        <div
          className={cn(
            'min-w-0 rounded-card text-[14px] leading-snug',
            !bare && 'px-3.5 py-2.5',
            !bare && (out ? 'border border-line-edge bg-ink-surface' : 'bg-ink-raised'),
            pending && 'opacity-60',
            flagged && 'border border-accent-alert/50',
          )}
        >
          {children}
        </div>
        {menu ? <div className="opacity-0 focus-within:opacity-100 group-hover:opacity-100">{menu}</div> : null}
      </div>
      {meta ? <div className={cn('ts-label-micro', out ? 'text-end' : 'text-start', 'text-text-muted')}>{meta}</div> : null}
      {footer}
    </div>
  );
}
/** Text of a bubble: the direction follows the content (darija in Arabic script inside a French UI and the reverse). */
export function BubbleText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p dir="auto" className={cn('whitespace-pre-wrap break-words', className)}>
      {typeof children === 'string' ? isolateNumbers(children) : children}
    </p>
  );
}
/** Context line above a reply ("A répondu à votre story", "Vous a mentionné dans sa story"). */
export function StoryContext({ label, thumbnailUrl }: { label: string; thumbnailUrl?: string | null }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 border-s-2 border-line-lit ps-2 ts-label-meta text-text-muted">
      {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="size-8 rounded-[4px] object-cover" /> : null}
      <span>{label}</span>
    </div>
  );
}

export function ImageAttachment({ src, alt, onOpen, openLabel }: { src: string; alt: string; onOpen?: () => void; openLabel: string }) {
  return (
    <button type="button" onClick={onOpen} aria-label={openLabel} title={openLabel} className="block overflow-hidden rounded-card border border-line-edge bg-ink-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound">
      <img src={src} alt={alt} loading="lazy" className="block max-h-64 max-w-full object-cover" />
    </button>
  );
}
export function StickerAttachment({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} loading="lazy" className="size-20 object-contain" />;
}
export function VideoAttachment({ src, label }: { src: string; label: string }) {
  return (
    <video controls preload="metadata" aria-label={label} className="block max-h-64 max-w-full rounded-card border border-line-edge bg-ink-raised">
      <source src={src} />
    </video>
  );
}
export function FileAttachment({ href, name, size, downloadLabel }: { href: string; name: string; size?: string; downloadLabel: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" download className="flex items-center gap-2.5 rounded-card border border-line-edge bg-ink-surface px-3 py-2 text-[13px] hover:border-line-lit">
      <FileText aria-hidden className="size-4 shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {name}
      </span>
      {size ? <bdi dir="ltr" className="ts-label-micro shrink-0 text-text-muted">{size}</bdi> : null}
      <span className="inline-flex shrink-0 items-center gap-1 ts-label-micro text-accent-inbound">
        <Download aria-hidden className="size-3" />
        {downloadLabel}
      </span>
    </a>
  );
}
export function LocationAttachment({ href, label, openLabel }: { href: string; label: string; openLabel: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-card border border-line-edge bg-ink-surface px-3 py-3 text-[13px] hover:border-line-lit">
      <MapPin aria-hidden className="size-4 shrink-0 text-accent-inbound" />
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {label}
      </span>
      <span className="ts-label-micro shrink-0 text-accent-inbound">{openLabel}</span>
    </a>
  );
}
/** "Postback : « Voir le catalogue »" */
export function PostbackBubble({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-[14px]">
      <span className="text-text-secondary">{label}</span> <span dir="auto">« {value} »</span>
    </p>
  );
}

/** Voice message: play / pause, progress, duration; the transcript line (or its state) goes in `children`. */
export function AudioPlayer({ src, duration, playLabel, pauseLabel, children }: { src: string; duration: string; playLabel: string; pauseLabel: string; children?: React.ReactNode }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  return (
    <div className="flex min-w-56 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={toggle} aria-label={playing ? pauseLabel : playLabel} className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-lit hover:bg-ink-raised-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound">
          {playing ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5 rtl:-scale-x-100" />}
        </button>
        <span aria-hidden dir="ltr" className="h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-line-edge">
          <span className="block h-full bg-text-primary" style={{ width: `${progress}%` }} />
        </span>
        <bdi dir="ltr" className="ts-label-micro shrink-0 tabular-nums text-text-muted">
          {duration}
        </bdi>
        <audio
          ref={ref}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
          }}
          className="hidden"
        />
      </div>
      {children ? <div className="ts-label-meta text-text-secondary">{children}</div> : null}
    </div>
  );
}

export type ProductCardItem = { id: string; name: string; price: string; imageUrl?: string | null; variants?: string | null; href?: string };
/** Product cards sent by the AI (≤ 5 per reply): image, name, price and variants in mono. */
export function ProductCards({ cards, label }: { cards: ProductCardItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap justify-end gap-2">
      {cards.map((c) => (
        <li key={c.id} className="flex w-56 max-w-full items-center gap-3 rounded-card border border-line-edge bg-ink-surface p-2.5">
          {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-[6px] object-cover" /> : <span aria-hidden className="size-12 shrink-0 rounded-[6px] bg-ink-raised" />}
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium" dir="auto">
              {c.name}
            </span>
            <span className="mt-0.5 block truncate ts-label-micro text-accent-money">
              <bdi dir="ltr">{c.price}</bdi>
              {c.variants ? <span dir="auto"> · {c.variants}</span> : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
/** Order created from the conversation: number, total and status pill (the full card arrives with the orders module). */
export function OrderCard({ number, total, status, href, openLabel }: { number: string; total?: string; status?: React.ReactNode; href?: string; openLabel?: string }) {
  const body = (
    <>
      <span className="min-w-0">
        <bdi dir="ltr" className="block truncate text-[14px] font-medium">
          {number}
        </bdi>
        {total ? (
          <bdi dir="ltr" className="mt-0.5 block ts-label-micro text-text-muted">
            {total}
          </bdi>
        ) : null}
      </span>
      {status}
    </>
  );
  const cls = 'flex items-center justify-between gap-3 rounded-card border border-line-edge bg-ink-surface px-3 py-2.5';
  return href ? (
    <a href={href} aria-label={openLabel} className={cn(cls, 'hover:border-line-lit')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ---------- Banner above the thread (one at a time) ---------- */
const BANNER_BAR: Record<'warning' | 'danger' | 'neutral' | 'info', string> = {
  warning: 'border-s-accent-starred',
  danger: 'border-s-accent-alert',
  neutral: 'border-s-text-muted',
  info: 'border-s-accent-inbound',
};
export function ThreadBanner({ tone = 'warning', title, description, actions, kind }: { tone?: 'warning' | 'danger' | 'neutral' | 'info'; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; kind?: string }) {
  return (
    <div role="status" data-banner={kind} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 border-s-[3px] bg-ink-raised px-5 py-3', BANNER_BAR[tone])}>
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-[14px] font-medium">{title}</div>
        {description ? <div className="mt-0.5 text-[13px] text-text-secondary">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------- Composer ---------- */
export type ComposerReply = { id: string; title: string; preview: string; shortcut?: string | null };
export type ComposerAttachment = { previewUrl: string; name: string; error?: string; uploading?: boolean; removeLabel: string; onRemove: () => void };
export type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  label: string;
  sendLabel: string;
  sending?: boolean;
  /** send button state when the draft cannot be sent (empty, too long, image error) */
  canSend: boolean;
  /** "1 980 / 2 000" — red when `tooLong` */
  counter?: string;
  tooLong?: boolean;
  /** inline error under the field (REPLY_OUTSIDE_WINDOW, REPLY_TOO_LONG, upload errors): the text is kept */
  error?: React.ReactNode;
  /** composer replaced by a reason (outside window, page inactive, blocked customer) and an optional action */
  disabled?: { tag: React.ReactNode; reason: React.ReactNode; action?: React.ReactNode; tone?: 'warning' | 'danger' | 'neutral' };
  attachLabel?: string;
  accept?: string;
  onAttach?: (file: File) => void;
  attachment?: ComposerAttachment | null;
  /** chips above the field (first quick replies) */
  chips?: { id: string; label: string }[];
  /** `/` popover: non-null while the draft is a slash query */
  slash?: { items: ComposerReply[]; emptyLabel: string; heading: string } | null;
  onPickReply?: (id: string) => void;
  footnote?: React.ReactNode;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
};
export function Composer(p: ComposerProps) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [active, setActive] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);
  const popId = React.useId();
  const open = !!p.slash && !dismissed;
  const items = p.slash?.items ?? [];
  React.useEffect(() => {
    setActive(0);
    setDismissed(false);
  }, [p.value]);
  // grows with the text up to ~6 lines
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [p.value]);

  const setRef = (el: HTMLTextAreaElement | null) => {
    inner.current = el;
    if (typeof p.textareaRef === 'function') p.textareaRef(el);
    else if (p.textareaRef) (p.textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && items[active]) {
        e.preventDefault();
        p.onPickReply?.(items[active]!.id);
        return;
      }
    }
    // Entrée sends, Maj+Entrée inserts a new line (GLOBAL shortcuts)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (p.canSend && !p.sending) p.onSend();
    }
  };

  if (p.disabled) {
    const tone = p.disabled.tone ?? 'warning';
    return (
      <div data-composer="disabled" className="border-t border-line-hairline px-5 py-4">
        <div className={cn('flex flex-wrap items-center gap-3 rounded-card border bg-ink-surface px-3.5 py-3', tone === 'danger' ? 'border-accent-alert/40' : tone === 'neutral' ? 'border-line-edge' : 'border-accent-starred/40')}>
          <span className={cn('inline-flex h-5 shrink-0 items-center rounded-[4px] border px-2 ts-label-micro', tone === 'danger' ? 'border-accent-alert/40 text-accent-alert' : tone === 'neutral' ? 'border-line-edge text-text-secondary' : 'border-accent-starred/40 text-accent-starred')}>
            {p.disabled.tag}
          </span>
          <span className="min-w-0 flex-1 basis-48 text-[13px] text-text-secondary">{p.disabled.reason}</span>
          {p.disabled.action}
        </div>
        {p.footnote ? <p className="mt-2 ts-label-meta text-text-muted">{p.footnote}</p> : null}
      </div>
    );
  }

  return (
    <div data-composer="ready" className="border-t border-line-hairline px-5 py-4">
      {p.chips?.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {p.chips.map((c) => (
            <button key={c.id} type="button" onClick={() => p.onPickReply?.(c.id)} className="inline-flex h-6 max-w-56 items-center rounded-[4px] border border-line-edge px-2 ts-label-meta text-text-primary hover:border-line-lit hover:bg-ink-raised">
              <span className="truncate" dir="auto">
                {c.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative">
        {open ? (
          <div id={popId} role="listbox" aria-label={p.slash!.heading} className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl">
            <div className="px-2.5 py-1.5 ts-label-micro text-text-muted">{p.slash!.heading}</div>
            {items.length === 0 ? (
              <div className="px-2.5 py-2 ts-label-meta text-text-muted">{p.slash!.emptyLabel}</div>
            ) : (
              items.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => p.onPickReply?.(r.id)}
                  className={cn('flex w-full flex-col items-start gap-0.5 rounded-[6px] px-2.5 py-2 text-start', i === active && 'bg-ink-raised-high')}
                >
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-medium" dir="auto">
                      {r.title}
                    </span>
                    {r.shortcut ? (
                      <bdi dir="ltr" className="ts-label-micro shrink-0 text-text-muted">
                        {r.shortcut}
                      </bdi>
                    ) : null}
                  </span>
                  <span className="w-full truncate ts-label-meta text-text-muted" dir="auto">
                    {r.preview}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
        <div className={cn('rounded-card border bg-ink-surface focus-within:border-line-lit', p.tooLong || p.error ? 'border-accent-alert/60' : 'border-line-edge')}>
          {p.attachment ? (
            <div className="flex items-center gap-3 border-b border-line-hairline px-3 py-2.5">
              <span className="relative shrink-0">
                <img src={p.attachment.previewUrl} alt={p.attachment.name} className={cn('size-12 rounded-[6px] object-cover', p.attachment.uploading && 'opacity-50')} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]" dir="auto">
                  {p.attachment.name}
                </span>
                {p.attachment.error ? (
                  <span role="alert" className="block text-[12px] text-accent-alert">
                    {p.attachment.error}
                  </span>
                ) : null}
              </span>
              <button type="button" onClick={p.attachment.onRemove} aria-label={p.attachment.removeLabel} title={p.attachment.removeLabel} className="flex size-7 items-center justify-center text-text-muted hover:text-text-primary">
                <X aria-hidden className="size-4" />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 p-2">
            {p.onAttach ? (
              <>
                <button type="button" onClick={() => fileRef.current?.click()} aria-label={p.attachLabel} title={p.attachLabel} className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-text-muted hover:bg-ink-raised hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-inbound">
                  <Paperclip aria-hidden className="size-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={p.accept}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  data-composer-file
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) p.onAttach?.(f);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}
            <textarea
              ref={setRef}
              rows={1}
              dir="auto"
              value={p.value}
              onChange={(e) => p.onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={p.placeholder}
              aria-label={p.label}
              aria-invalid={p.tooLong || !!p.error || undefined}
              aria-controls={open ? popId : undefined}
              data-composer-input
              className="max-h-36 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-snug text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <Button variant="primary" size="sm" className="h-9" onClick={p.onSend} disabled={!p.canSend} loading={p.sending}>
              {p.sendLabel}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {p.error ? (
            <p role="alert" className="text-[12px] text-accent-alert">
              {p.error}
            </p>
          ) : p.footnote ? (
            <p className="ts-label-meta text-text-muted">{p.footnote}</p>
          ) : null}
        </div>
        {p.counter ? (
          <bdi dir="ltr" className={cn('ts-label-micro shrink-0 tabular-nums', p.tooLong ? 'text-accent-alert' : 'text-text-muted')}>
            {p.counter}
          </bdi>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Lightbox: image of a message in full screen (Esc / click closes) ---------- */
export function Lightbox({ src, alt, onClose, closeLabel }: { src: string | null; alt: string; onClose: () => void; closeLabel: string }) {
  React.useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-6" onClick={onClose}>
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-card object-contain" />
      <button type="button" autoFocus onClick={onClose} aria-label={closeLabel} className="absolute end-4 top-4 flex size-9 items-center justify-center rounded-full border border-line-lit bg-ink-surface text-text-primary">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
