'use client';
// Small display pieces shared by the catalogue screens: amounts, thumbnails, the pills of Product / StockMovement
// (colours from the `StatusPill` map, labels from `enum.*`), list pagination with its copy.
import { formatMoney, formatNumber } from '@djaber/shared';
import { cn, ColorPill, Ltr, Pagination, StatusPill } from '@djaber/ui';
import { ImageOff } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { PageSize } from '@/lib/list-state';
import { productState, type ModerationStatus, type MovementType, type ProductListItem, type StockState } from './contracts';

/** `12 500 DA`, always left-to-right; `—` when absent. */
export function Money({ value, className, muted }: { value: number | null | undefined; className?: string; muted?: boolean }) {
  if (value === null || value === undefined) return <span className="text-text-muted">—</span>;
  return <Ltr className={cn('tabular-nums', muted && 'text-text-secondary', className)}>{formatMoney(value)}</Ltr>;
}
export function Num({ value, className, signed }: { value: number | null | undefined; className?: string; signed?: boolean }) {
  if (value === null || value === undefined) return <span className="text-text-muted">—</span>;
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return <Ltr className={cn('tabular-nums', className)}>{`${sign}${formatNumber(Math.abs(value))}`}</Ltr>;
}
/** `47 %` */
export function Pct({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className="text-text-muted">—</span>;
  const text = `${value < 0 ? '−' : ''}${String(Math.abs(Math.round(value * 10) / 10)).replace('.', ',')} %`;
  return <Ltr className={cn('tabular-nums', value < 0 ? 'text-accent-alert' : 'text-accent-money', className)}>{text}</Ltr>;
}

export function ProductThumb({ src, name, size = 40, className }: { src: string | null | undefined; name: string; size?: number; className?: string }) {
  return (
    <span style={{ width: size, height: size }} className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-line-hairline bg-ink-raised text-text-muted', className)}>
      {src ? <img src={src} alt={name} loading="lazy" className="size-full object-cover" /> : <ImageOff className="size-4" aria-hidden />}
    </span>
  );
}

export function CategoryPill({ category }: { category: { name: string; color: string } | null }) {
  if (!category) return <span className="text-text-muted">—</span>;
  return <ColorPill color={category.color}>{category.name}</ColorPill>;
}

/** FAIBLE / RUPTURE / SERVICE next to a quantity; nothing when the stock is fine. */
export function StockPill({ state }: { state: StockState }) {
  const t = useT();
  if (state === 'ok') return null;
  return (
    <StatusPill enumKey="Product.stock" value={state} className="!rounded-[4px]">
      {state === 'untracked' ? t('enum.Product.state.service') : t(`products.stock.${state}`)}
    </StatusPill>
  );
}
export const stockTone = (state: StockState) => (state === 'out' ? 'text-accent-alert' : state === 'low' ? 'text-accent-starred' : undefined);

/** ACTIF / MASQUÉ / ARCHIVÉ */
export function ProductStatePill({ product }: { product: Pick<ProductListItem, 'archived' | 'isActive'> }) {
  const t = useT();
  const s = productState(product);
  return (
    <StatusPill enumKey="Product.state" value={s} className="!rounded-[4px]">
      {t(`enum.Product.state.${s}`)}
    </StatusPill>
  );
}

/** VALIDATION DJABER pill; `not_required` renders nothing. */
export function ModerationPill({ status, long }: { status: ModerationStatus | string | null | undefined; long?: boolean }) {
  const t = useT();
  if (!status || status === 'not_required') return null;
  const key = long ? `products.moderation.pill.${status}` : `enum.Product.moderationStatus.${status}`;
  return (
    <StatusPill enumKey="Product.moderationStatus" value={status} className="!rounded-[4px]">
      {t.has(key) ? t(key) : status}
    </StatusPill>
  );
}

/**
 * Why the AI does not propose a product (04 §12 « Visibility while pending »): archived, switched off, or not validated by
 * Djaber — waiting, refused, contested. Report 12/11 (« casque »: IA « EXCLU » + « CONTESTATION » after « Ajouter à un
 * agent », read as a bug): the screens now say it.
 */
export type AiExclusion = 'archived' | 'inactive' | 'pending' | 'rejected' | 'appealed';
export function aiExclusion(p: { aiState?: string; archived?: boolean; isActive?: boolean; moderation?: { status: string } | null }): AiExclusion | null {
  if (p.aiState !== 'excluded') return null;
  if (p.archived) return 'archived';
  if (p.isActive === false) return 'inactive';
  const s = p.moderation?.status;
  return s === 'pending' || s === 'rejected' || s === 'appealed' ? s : null;
}

/** PROPOSÉ / EXCLU (IA column); an excluded product says why (hover in the lists, written next to it on the product page). */
export function AiPill({ state, long, reason }: { state: 'proposed' | 'excluded' | string; long?: boolean; reason?: AiExclusion | null }) {
  const t = useT();
  const why = reason ? t(`products.ai.excludedWhy.${reason}`) : null;
  const pill = (
    <StatusPill enumKey="Product.ai" value={state} className="!rounded-[4px]">
      {t(long ? `enum.Product.ai.${state}` : `products.ai.${state}`)}
    </StatusPill>
  );
  if (!why) return pill;
  return long ? (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ai-excluded-why">
      {pill}
      <span className="ts-label-meta text-text-muted">{why}</span>
    </span>
  ) : (
    <span className="inline-flex" title={why} data-testid="ai-excluded-why">
      {pill}
      <span className="sr-only">{why}</span>
    </span>
  );
}

export function MovementTypePill({ type }: { type: MovementType | string }) {
  const t = useT();
  const key = `enum.StockMovement.type.${type}`;
  return (
    <StatusPill enumKey="StockMovement.type" value={type} className="!rounded-[4px]">
      {t.has(key) ? t(key) : type}
    </StatusPill>
  );
}

/** Reason of a movement (`MovementReason`), `—` when absent. */
export function useMovementReason() {
  const t = useT();
  return (reason: string | null | undefined) => (reason ? (t.has(`enum.StockMovement.reason.${reason}`) ? t(`enum.StockMovement.reason.${reason}`) : reason) : '—');
}

/** Pagination footer with its copy and an optional note ("tri : nom ↑"). */
export function ListPagination({ page, pageSize, total, onChange, note }: { page: number; pageSize: PageSize; total: number; onChange: (patch: { page?: number; pageSize?: PageSize }) => void; note?: string }) {
  const t = useT();
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={(p) => onChange({ page: p })}
      onPageSizeChange={(n) => onChange({ pageSize: n as PageSize })}
      labels={{
        previous: t('action.previousPage'),
        next: t('action.nextPage'),
        perPage: (n) => t('common.perPage', { count: n }),
        range: (from, to, all) => `${t('common.rangeOf', { from, to, total: formatNumber(all) })}${note ? ` · ${note}` : ''}`,
      }}
    />
  );
}
