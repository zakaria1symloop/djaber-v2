// Figures of the analytics tabs and reports (CLAUDE.md rule 11: integer DZD `12 500 DA`, Latin digits; one decimal
// with the locale separator for rates and durations). Pure, unit-tested.
import { formatNumber } from '@djaber/shared';
import { rangeArrow } from '@/lib/format-message';

export type Unit = 'count' | 'money' | 'pct' | 'seconds' | 'minutes' | 'days' | 'ratio' | 'credits' | 'usd';
const NBSP = String.fromCharCode(160);

/** `4,2` (fr / ar) · `4.2` (en); integers stay integers (`68`). */
export function decimal(n: number, locale: string, digits = 1): string {
  const r = (Math.sign(n) * Math.round(Math.abs(n) * 10 ** digits)) / 10 ** digits;
  if (Number.isInteger(r)) return formatNumber(r);
  const [int, frac] = Math.abs(r).toFixed(digits).replace(/0+$/, '').split('.');
  return `${r < 0 ? '-' : ''}${formatNumber(Number(int))}${locale === 'en' ? '.' : ','}${frac}`;
}

/** Value of a KPI without its unit label (the tile shows the label next to it): `412 300`, `68 %`, `1,9 s`. */
export function formatValue(value: number | null | undefined, unit: Unit, locale: string, units: { s: string; min: string; d: string; h?: string }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'money':
    case 'count':
    case 'credits':
      // full-test STOCK-14 / J07-11: a negative amount reads with the true minus sign « −37 400 », never « -37 400 »
      return value < 0 ? `−${formatNumber(-value)}` : formatNumber(value);
    case 'pct':
      return `${decimal(value, locale)}${NBSP}%`;
    case 'seconds':
      return `${decimal(value, locale)}${NBSP}${units.s}`;
    case 'minutes':
      // ANALYTICS-08: two hours and more read in hours (« 48 h », not « 2 880 min »)
      return value >= 120 && units.h ? `${decimal(value / 60, locale)}${NBSP}${units.h}` : `${decimal(value, locale, 0)}${NBSP}${units.min}`;
    case 'days':
      return `${decimal(value, locale)}${NBSP}${units.d}`;
    case 'ratio':
      return decimal(value, locale);
    case 'usd':
      // ANALYTICS-09: « 3,77 $ » in French / Arabic, « $3.77 » in English
      return locale === 'en' ? `$${(Math.round(value * 100) / 100).toFixed(2)}` : `${(Math.round(value * 100) / 100).toFixed(2).replace('.', ',')}${NBSP}$`;
  }
}

/** Delta to show next to a KPI: points for rates, percent otherwise; `null` when there is no comparison. */
export function kpiDelta(k: { unit: Unit; deltaPct?: number | null; deltaPts?: number | null } | null | undefined): { value: number; unit: '%' | 'pts' } | null {
  if (!k) return null;
  if (k.unit === 'pct') return k.deltaPts === null || k.deltaPts === undefined ? null : { value: k.deltaPts, unit: 'pts' };
  return k.deltaPct === null || k.deltaPct === undefined ? null : { value: k.deltaPct, unit: '%' };
}

/** KPIs whose increase is bad (red when up). */
export const INVERTED_KPIS = new Set(['cancelledPct', 'returnedPct', 'errorRate', 'aiResponseTime', 'humanResponseTime', 'avgDays', 'openFailures', 'abandoned', 'deadStock', 'courierFees', 'costUsd', 'costPerReplyUsd', 'insightsPending']);

/** `05 sept.` from a `YYYY-MM-DD` day (Africa/Algiers date, read at noon UTC so it never shifts). */
export function dayLabel(day: string, locale: string, withYear = false): string {
  const tag = locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR';
  return new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * « 14 nov. 2024 → 15 nov. 2026 »: the start year is written when it differs from the end year (or from this year for a
 * label without the end year), so a 2-year range never reads like 2 days (full-test 15/11 ANALYTICS-04).
 */
export function rangeLabel(from: string, to: string, locale: string, o: { endYear?: boolean; currentYear?: string } = {}): string {
  const thisYear = o.currentYear ?? new Date().toISOString().slice(0, 4);
  const startYear = from.slice(0, 4) !== to.slice(0, 4);
  const endYear = o.endYear || startYear || to.slice(0, 4) !== thisYear;
  return `${dayLabel(from, locale, startYear)} ${rangeArrow(locale)} ${dayLabel(to, locale, endYear)}`;
}

/** Largest value of a series point list (best day) — `null` when everything is 0. */
export function bestPoint<K extends string>(points: { day: string; values: Record<K, number> }[], key: K): { day: string; value: number } | null {
  let best: { day: string; value: number } | null = null;
  for (const p of points) {
    const v = p.values[key] ?? 0;
    if (v > 0 && (!best || v > best.value)) best = { day: p.day, value: v };
  }
  return best;
}
