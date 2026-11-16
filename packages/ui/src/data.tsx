'use client';
// Data display: table, pagination, page header, stat tile.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Button, Card, cn, Select } from './primitives';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 md:flex-nowrap md:items-start">
      <div className="min-w-0 md:flex-1">
        {eyebrow ? <div className="ts-label-meta mb-2 uppercase text-text-muted">{eyebrow}</div> : null}
        <h1 className="ts-display-m [overflow-wrap:anywhere] md:truncate" title={title}>
          {title}
        </h1>
        {description ? <p className="ts-body mt-2 text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">{actions}</div> : null}
    </header>
  );
}

export function StatTile({ label, value, unit, hint }: { label: string; value: React.ReactNode; unit?: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="ts-label-micro text-text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="ts-numeral-l">{value}</span>
        {unit ? <span className="ts-label-micro text-text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="ts-label-meta mt-1.5 text-text-muted">{hint}</div> : null}
    </Card>
  );
}

/* ---------- Table ---------- */
export function Table({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...rest} />
    </div>
  );
}
export function Th({ className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('ts-label-micro whitespace-nowrap border-b border-line-hairline px-3 py-2.5 text-start text-text-muted', className)} {...rest} />;
}
export function Td({ className, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-line-hairline px-3 py-2.5 align-middle', className)} {...rest} />;
}
export function Tr({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-ink-raised/60', className)} {...rest} />;
}

/* ---------- Pagination (25 / 50 / 100, state lives in the URL) ---------- */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  labels,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  labels: { previous: string; next: string; perPage: (n: number) => string; range: (from: number, to: number, total: number) => string };
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <span className="ts-label-meta text-text-muted">{labels.range(from, to, total)}</span>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <Select
            aria-label={labels.perPage(pageSize)}
            className="!h-8 w-auto text-[12px]"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {labels.perPage(n)}
              </option>
            ))}
          </Select>
        ) : null}
        <Button size="sm" aria-label={labels.previous} title={labels.previous} disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="!px-2">
          <ChevronLeft className="size-4 rtl:-scale-x-100" />
        </Button>
        <span className="whitespace-nowrap ts-label-meta tabular-nums text-text-secondary">
          {page} / {pages}
        </span>
        <Button size="sm" aria-label={labels.next} title={labels.next} disabled={page >= pages} onClick={() => onPageChange(page + 1)} className="!px-2">
          <ChevronRight className="size-4 rtl:-scale-x-100" />
        </Button>
      </div>
    </nav>
  );
}
