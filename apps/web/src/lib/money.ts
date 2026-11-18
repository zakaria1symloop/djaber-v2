// Integer DZD helpers for forms (CLAUDE.md rule 11: integer DZD, Latin digits, `12 500 DA`).
import { formatMoney, formatNumber } from '@djaber/shared';

const ARABIC_ZERO = 0x0660;

/** `"12 500 DA"`, `"12500"`, Arabic-Indic digits → 12500 · `""` → null · anything else (decimals, signs, text) → NaN. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const latin = Array.from(input, (ch) => {
    const code = ch.charCodeAt(0);
    return code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9 ? String(code - ARABIC_ZERO) : ch;
  }).join('');
  // `\s` covers the thin, narrow and no-break spaces used as thousands separators
  const cleaned = latin.replace(/\s/g, '').replace(/(DA|دج)$/i, '');
  if (cleaned === '') return null;
  if (!/^\d{1,12}$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Digits of a stored amount for a `MoneyInput` (`null` → `''`). */
export const moneyDigits = (n: number | null | undefined): string => (n === null || n === undefined ? '' : String(Math.trunc(n)));

/** Number sent to the API from the digits of an input (`''` → null). */
// a NumberInput value: digits, maybe a leading « - » (kept so a negative amount is refused by validation, never turned positive)
export const digitsToInt = (digits: string): number | null => (digits === '' || digits === '-' || !/^-?\d+$/.test(digits) ? null : Number(digits));

/**
 * Margin in percent of the selling price, one decimal half-up (the server's `marginPct`, so the quick-edit sheet, the
 * list and the product page print the same « 55,6 % » — full-test 15/11 PRODUCTS-07), null when it cannot be computed
 * (04 §2: (price − cost) / price).
 */
export function marginPct(price: number | null, cost: number | null): number | null {
  if (price === null || cost === null || price <= 0) return null;
  const x = ((price - cost) * 1000) / price;
  return (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5)) / 10;
}

/** `−8 000` / `12 500` — a negative number with the true minus « − », never the hyphen (full-test 15/11 STOCK-14). */
export const signedNumber = (n: number): string => `${n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`;
/** `−8 000 DA` / `12 500 DA` */
export const signedMoney = (n: number): string => `${n < 0 ? '−' : ''}${formatMoney(Math.abs(n))}`;

/**
 * The selling price a product shows everywhere (table, grid, phone card, pickers): its variants' range « 1 500 DA – 1 900 DA »
 * when it has variants (the base price is never sold on its own — PRODUCTS-03, journey J02-3 / J02-4), else its price.
 */
export const priceRangeOf = (p: { price: number; hasVariants?: boolean; priceRange?: { min: number; max: number } | null; variants?: { price: number; isActive?: boolean }[] }): { min: number; max: number } => {
  if (p.priceRange) return p.priceRange;
  const prices = p.hasVariants ? (p.variants ?? []).filter((v) => v.isActive !== false).map((v) => v.price) : [];
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: p.price, max: p.price };
};
export const priceText = (p: Parameters<typeof priceRangeOf>[0]): string => {
  const r = priceRangeOf(p);
  // journey J02r-4: the range is one left-to-right island (LRI … PDI) — in Arabic it read « 4 800 DA – 4 500 DA »
  return r.min === r.max ? formatMoney(r.min) : `\u2066${formatMoney(r.min)} – ${formatMoney(r.max)}\u2069`;
};

/** `55,6 %` / `−6,1 %` (true minus, decimal comma). */
export const pctText = (value: number): string => `${value < 0 ? '−' : ''}${String(Math.abs(Math.round(value * 10) / 10)).replace('.', ',')} %`;

/** `1 240 000` → `1,24 M` (fr / ar) or `1.24 M` (en) for KPI tiles; under one million the plain grouped number. */
export function compactAmount(n: number, locale: string): string {
  if (Math.abs(n) < 1_000_000) return formatNumber(n);
  const v = Math.round(n / 10_000) / 100;
  const [whole, dec] = Math.abs(v).toFixed(2).replace(/0$/, '').split('.');
  // journey J02-2: « 1 000,97 M », the whole part grouped like every other figure (it read « 1000,97 M »)
  return `${v < 0 ? '-' : ''}${formatNumber(Number(whole))}${dec ? `${locale === 'en' ? '.' : ','}${dec}` : ''} M`;
}
