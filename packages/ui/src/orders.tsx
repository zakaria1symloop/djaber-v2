'use client';
// M5 orders kit (Figma ORD-05 v2, ORD-06, ORD-07, ORD-02, DLV-06 / ORD-09): phone input with normalisation preview,
// order number, source tag, section block, label/value rows, totals, timeline, step chips of the confirm dialog and
// the A5 order slip. All copy comes in through props; logical CSS only (RTL safe).
import * as React from 'react';
import { commitInputValue, Ltr } from './inputs';
import { cn, Input, type Tone } from './primitives';

/* ---------- Phone input + "Normalisé : 0555123456 · mobile DZ valide" ---------- */
export type PhoneInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** translated preview line under the field; `tone: 'danger'` when the number is not a valid DZ phone */
  preview?: { text: string; tone?: 'muted' | 'danger' | 'success' } | null;
  /** formatting applied when the field loses focus (the web passes the shared DZ normalisation: `+213 555…` ⇒ `0555…`) */
  format?: (raw: string) => string;
};
export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput({ preview, format, className, id, onBlur, ...rest }, ref) {
  const previewId = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <div dir="ltr">
        <Input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          aria-describedby={preview ? previewId : undefined}
          className={cn('tabular-nums', className)}
          {...rest}
          onBlur={(e) => {
            if (format && !e.currentTarget.readOnly && !e.currentTarget.disabled) commitInputValue(e.currentTarget, format(e.currentTarget.value));
            onBlur?.(e);
          }}
        />
      </div>
      {preview ? (
        <p id={previewId} className={cn('ts-label-micro', preview.tone === 'danger' ? 'text-accent-alert' : preview.tone === 'success' ? 'text-accent-money' : 'text-text-muted')}>
          {preview.text}
        </p>
      ) : null}
    </div>
  );
});

/* ---------- Order number "#CMD-1042" (always LTR) ---------- */
export function OrderNumber({ number, className }: { number: string; className?: string }) {
  return <Ltr className={cn('whitespace-nowrap', className)}>#{number.replace(/^#/, '')}</Ltr>;
}

/* ---------- SOURCE cell: "✦ IA" coloured tag + mono detail line (agent · canal, member, key, file) ---------- */
const SOURCE_TONE: Record<string, string> = {
  ai: 'text-accent-money',
  manual: 'text-accent-clients',
  mobile: 'text-accent-inbound',
  api: 'text-accent-starred',
  import: 'text-text-secondary',
};
export function SourceTag({ source, label, detail, className }: { source: string; label: string; detail?: string; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 flex-col', className)} data-source={source}>
      <span className={cn('ts-label-micro whitespace-nowrap', SOURCE_TONE[source] ?? 'text-text-secondary')}>{label}</span>
      {detail ? <span className="ts-label-micro truncate !normal-case text-text-muted">{detail}</span> : null}
    </span>
  );
}

/* ---------- Section block of the order page: mono label, optional pill / link on the end side ---------- */
export function OrderBlock({ label, end, children, className, bodyClassName, ...rest }: { label: string; end?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string } & Omit<React.HTMLAttributes<HTMLElement>, 'children'>) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2.5', className)} {...rest}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 id={id} className="ts-label-section text-text-muted">
          {label}
        </h2>
        {end}
      </div>
      <div className={cn('rounded-card border border-line-edge bg-ink-surface', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- Label / value rows (TRANSPORTEUR · Aucun colis créé, MODE · Espèces à la livraison) ---------- */
export type DetailRow = { key: string; label: string; value: React.ReactNode; tone?: 'warning' | 'danger' | 'success' };
export function DetailRows({ rows, className }: { rows: DetailRow[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2', className)}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <dt className="ts-label-micro self-center text-text-muted">{r.label}</dt>
          <dd className={cn('min-w-0 text-[13px]', r.tone === 'warning' && 'text-accent-starred', r.tone === 'danger' && 'text-accent-alert', r.tone === 'success' && 'text-accent-money')}>{r.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ---------- Totals of the items table: right-aligned mono labels, the total in big numerals ---------- */
export type TotalRow = { key: string; label: string; value: React.ReactNode; strong?: boolean };
export function TotalsRows({ rows, className }: { rows: TotalRow[]; className?: string }) {
  return (
    <dl className={cn('ms-auto grid w-full max-w-md grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1.5', className)}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <dt className="ts-label-micro text-end text-text-muted">{r.label}</dt>
          <dd className={cn('text-end tabular-nums', r.strong ? 'ts-numeral-l' : 'text-[13px]')} data-total={r.key}>
            {r.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ---------- Timeline (history, calls): time on the start side, title + text, newest first ---------- */
export type TimelineItem = { key: string; time: string; title: React.ReactNode; text?: React.ReactNode; meta?: React.ReactNode; tone?: Tone };
const DOT_TONE: Partial<Record<Tone, string>> = { success: 'bg-accent-money', danger: 'bg-accent-alert', warning: 'bg-accent-starred', info: 'bg-accent-inbound', violet: 'bg-accent-clients', orange: 'bg-accent-orders' };
export function OrderTimeline({ items, label, empty, className }: { items: TimelineItem[]; label: string; empty?: string; className?: string }) {
  if (!items.length) return empty ? <p className={cn('px-4 py-4 ts-label-meta text-text-muted', className)}>{empty}</p> : null;
  return (
    <ol aria-label={label} className={cn('divide-y divide-line-hairline', className)}>
      {items.map((i) => (
        <li key={i.key} className="flex gap-4 px-4 py-3" data-timeline={i.key}>
          <span className="flex w-12 shrink-0 items-start gap-1.5 pt-0.5">
            {i.tone ? <span aria-hidden className={cn('mt-1 size-1.5 shrink-0 rounded-full', DOT_TONE[i.tone] ?? 'bg-text-muted')} /> : null}
            <Ltr className="ts-label-micro tabular-nums text-text-muted">{i.time}</Ltr>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">{i.title}</div>
            {i.text ? <div className="mt-0.5 text-[13px] text-text-secondary">{i.text}</div> : null}
            {i.meta ? <div className="mt-1 ts-label-micro text-text-muted">{i.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Step chips of the confirm dialog: "1 · VÉRIFIER  2 · APPEL  3 · RÉSULTAT" ---------- */
export type StepChip = { key: string; label: string; state: 'done' | 'active' | 'upcoming' };
export function StepChips({ steps, label, className }: { steps: StepChip[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.state === 'active' ? 'step' : undefined}
          data-step={s.key}
          data-state={s.state}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-[4px] border px-2 ts-label-micro',
            s.state === 'done' && 'border-accent-money/50 text-accent-money',
            s.state === 'active' && 'border-line-lit text-text-primary',
            s.state === 'upcoming' && 'border-line-edge text-text-muted',
          )}
        >
          <span className="tabular-nums">{i + 1}</span>
          <span aria-hidden>·</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/* ---------- Check list of the confirm dialog: "Adresse complète ✓ · Wilaya ✓ · Téléphone ✓ — …" ---------- */
export function ChecksNote({ items, text, tone = 'success', className }: { items: { label: string; ok: boolean }[]; text?: string; tone?: 'success' | 'warning' | 'danger'; className?: string }) {
  return (
    <div className={cn('rounded-[6px] border-s-2 bg-ink-raised px-3 py-2.5 text-[13px]', tone === 'success' ? 'border-s-accent-money' : tone === 'warning' ? 'border-s-accent-starred' : 'border-s-accent-alert', className)} role="status">
      {items.map((i, n) => (
        <React.Fragment key={i.label}>
          {n > 0 ? <span className="text-text-muted"> · </span> : null}
          <span className={i.ok ? undefined : 'text-accent-alert'}>
            {i.label} {i.ok ? '✓' : '✕'}
          </span>
        </React.Fragment>
      ))}
      {text ? <span className="text-text-secondary"> — {text}</span> : null}
    </div>
  );
}

/* ---------- A5 order slip (DLV-06 / ORD-09): white sheet, printed with `@page { size: A5 }` ---------- */
export type A5Line = { key: string; label: string; amount?: string };
export type A5SlipProps = {
  shop: string;
  /** UX-048: the shop's logo, phone and address from Paramètres › Boutique (same as the PDF) */
  shopLogoUrl?: string | null;
  shopPhone?: string | null;
  shopAddress?: string | null;
  heading: string;
  client: string;
  address: string;
  lines: A5Line[];
  extra?: A5Line[];
  total?: { label: string; amount: string };
  footer?: string[];
  dir?: 'ltr' | 'rtl';
  lang?: string;
  className?: string;
};
export function A5OrderSlip({ shop, shopLogoUrl, shopPhone, shopAddress, heading, client, address, lines, extra = [], total, footer = [], dir = 'ltr', lang, className }: A5SlipProps) {
  const row = (l: A5Line, strong?: boolean) => (
    <div key={l.key} className={cn('flex items-baseline gap-2', strong ? 'text-[15px] font-semibold' : 'text-[13px]')}>
      <span className="shrink-0">{l.label}</span>
      {l.amount !== undefined ? (
        <>
          <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-black/50" />
          <bdi dir="ltr" className="shrink-0 tabular-nums">
            {l.amount}
          </bdi>
        </>
      ) : null}
    </div>
  );
  return (
    <article dir={dir} lang={lang} data-testid="a5-slip" className={cn('a5-slip flex flex-col gap-2 bg-white p-6 text-black', className)}>
      <header className="flex items-start gap-3">
        {shopLogoUrl ? <img src={shopLogoUrl} alt="" className="size-12 shrink-0 object-contain" data-testid="a5-slip-logo" /> : null}
        <div className="flex min-w-0 flex-col">
          <h1 className="text-[16px] font-semibold uppercase">{shop}</h1>
          {shopPhone ? (
            <bdi dir="ltr" className="text-[12px] tabular-nums">
              {shopPhone}
            </bdi>
          ) : null}
          {shopAddress ? <p className="text-[12px]">{shopAddress}</p> : null}
        </div>
      </header>
      <p className="font-mono text-[10px]">{heading}</p>
      <p className="text-[13px]">{client}</p>
      <p className="text-[13px]">{address}</p>
      <hr className="my-1 border-black/70" />
      <div className="flex flex-col gap-1">{lines.map((l) => row(l))}</div>
      {extra.length ? <div className="flex flex-col gap-1">{extra.map((l) => row(l))}</div> : null}
      {total ? row({ key: 'total', label: total.label, amount: total.amount }, true) : null}
      {footer.map((f) => (
        <p key={f} className="font-mono text-[10px]">
          {f}
        </p>
      ))}
    </article>
  );
}
