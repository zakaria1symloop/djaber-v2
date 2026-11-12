// Small helpers shared by the catalogue services.
import { TenantContext } from '@djaber/db';
import type { ActionDescriptor, StockState } from '@djaber/shared';
import { AppException } from '../../core/errors/app.exception';
import { can, type MerchantPermission } from '../../core/rbac/permission-matrix';

export type Warning = { code: string; params?: Record<string, string | number>; field?: string };
export type WithWarnings<T> = { data: T; warnings: Warning[] };

/** 04 §2 — SKU unique per workspace among live products and variants. */
export const skuTaken = (field = 'sku') => new AppException('PRODUCT_SKU_ALREADY_EXISTS', {}, { [field]: 'validation.sku_taken' });

/** Prisma unique violation (P2002), optionally on a constraint whose name / columns contain `hint`. */
export const isUnique = (e: unknown, hint?: string) => {
  const err = e as { code?: string; meta?: { target?: unknown }; message?: string } | null;
  if (err?.code !== 'P2002') return false;
  if (!hint) return true;
  const target = Array.isArray(err.meta?.target) ? (err.meta!.target as unknown[]).join(',') : String(err.meta?.target ?? '');
  return `${target} ${err.message ?? ''}`.toLowerCase().includes(hint.toLowerCase());
};
export const isForeignKey = (e: unknown) => (e as { code?: string } | null)?.code === 'P2003';

/** One entry of an `Actions ⌄` menu: disabled with `FORBIDDEN` when the role lacks the permission, or with a state code. */
export const action = (key: string, permission: MerchantPermission, o: { reasonCode?: string; primary?: boolean } = {}): ActionDescriptor => {
  const allowed = can(TenantContext.get().role, permission);
  const reasonCode = !allowed ? 'FORBIDDEN' : o.reasonCode;
  return { key, enabled: !reasonCode, ...(reasonCode ? { reasonCode } : {}), ...(o.primary ? { primary: true } : {}) };
};

/** CAT-09: out at 0, low when `quantity ≤ minStock`. */
export const stockStateOf = (stock: number, minStock: number): 'ok' | 'low' | 'out' => (stock <= 0 ? 'out' : stock <= minStock ? 'low' : 'ok');

/**
 * UX-062 — since when a stock line (product without variants, or variant) has been in its alert state, from its stock
 * movements: `outAt` = last movement that brought it from above 0 to ≤ 0, `lowAt` = last movement that brought it from
 * above its threshold to ≤ the threshold (both computed by one grouped query, `StockService.shortageLines`).
 * Out ⇒ `outAt`; low ⇒ `lowAt`; no such movement (created at / under the threshold, or stock written without movement)
 * ⇒ the line's creation date. Never in the future.
 */
export const shortageSince = (
  line: { stock: number; minStock: number; createdAt: Date },
  marks: { outAt: Date | null; lowAt: Date | null },
  now: Date,
): Date => {
  const mark = line.stock <= 0 ? marks.outAt : marks.lowAt;
  const at = mark ?? line.createdAt;
  return at.getTime() > now.getTime() ? now : at;
};

export const productStockState = (p: {
  trackStock: boolean;
  stock: number | null;
  minStock: number;
  variants?: { stock: number; minStock: number; isActive: boolean }[];
}): StockState => {
  if (!p.trackStock) return 'untracked';
  const own = stockStateOf(p.stock ?? 0, p.minStock);
  if (own !== 'ok') return own;
  return (p.variants ?? []).some((v) => v.isActive && v.stock <= v.minStock) ? 'low' : 'ok';
};

/** Margin on the selling price, one decimal: (price − cost) / price. */
export const marginPct = (price: number, cost: number | null | undefined): number | null =>
  cost === null || cost === undefined || price <= 0 ? null : Math.round(((price - cost) * 1000) / price) / 10;

/** `%term%` with the LIKE wildcards of the term escaped. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
