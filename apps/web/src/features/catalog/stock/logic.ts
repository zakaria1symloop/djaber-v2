// Pure helpers of the stock dashboard (GDS-01) and the movements journal (GDS-05): days in Africa/Algiers, time
// labels, signed quantities, period presets, reference links.
import { TIMEZONE } from '@djaber/shared';
import type { StockMovement } from '../contracts';

/** `YYYY-MM-DD` of an instant in Africa/Algiers (the day used by `from` / `to` and by `GET /stock/snapshot?date`). */
export const algiersDay = (d: Date | string | number = Date.now()): string => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const algiersClock = (d: Date | string | number): string => new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

/** Calendar arithmetic on a `YYYY-MM-DD` day (no time zone involved). */
export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Dashboard "DERNIERS MOUVEMENTS": `10:58` today, HIER yesterday, the date before that. */
export function movementTimeLabel(iso: string, now: Date | number = Date.now()): { kind: 'time'; value: string } | { kind: 'yesterday' } | { kind: 'date' } {
  const day = algiersDay(iso);
  const today = algiersDay(now);
  if (day === today) return { kind: 'time', value: algiersClock(iso) };
  if (day === addDays(today, -1)) return { kind: 'yesterday' };
  return { kind: 'date' };
}

/** `05 oct. 10:58` from the shared `05 oct. 2026 10:58` (the journal shows the year only in the tooltip). */
export const withoutYear = (formatted: string): string => formatted.replace(/\s\d{4}(?=\s|$)/, '');

/**
 * Signed delta of a movement. `quantity` is a signed delta in the journal; `after − before` is preferred when it is
 * known so that an unsigned quantity is never shown with the wrong sign.
 */
export const signedQuantity = (m: Pick<StockMovement, 'quantity' | 'before' | 'after'>): number => {
  const delta = m.after - m.before;
  return Number.isFinite(delta) && delta !== 0 ? delta : m.quantity;
};
/** `+24`, `−2`, `0` (true minus sign, Latin digits; thousands are grouped by the caller when needed). */
export const formatSigned = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
export const quantityTone = (n: number): 'in' | 'out' | 'none' => (n > 0 ? 'in' : n < 0 ? 'out' : 'none');

/* ---------- period presets of the journal ---------- */
export const PERIOD_PRESETS = ['7d', '30d', 'month'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export function periodRange(preset: PeriodPreset, today: string = algiersDay()): { from: string; to: string } {
  if (preset === '7d') return { from: addDays(today, -6), to: today };
  if (preset === '30d') return { from: addDays(today, -29), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Which chip is lit for a `from` / `to` pair: a preset, `custom`, or null when no period is set. */
export function activePeriod(from: string, to: string, today: string = algiersDay()): PeriodPreset | 'custom' | null {
  if (!from && !to) return null;
  // 7 d and "this month" are the same range on the 7th: the first preset in the list wins
  for (const p of PERIOD_PRESETS) {
    const r = periodRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return 'custom';
}

/* ---------- reference ---------- */
/** Route of a movement reference: the order, the counter sale, the purchase, the inventory count (M7) or the product. */
export function referenceHref(m: Pick<StockMovement, 'reference' | 'product'>): string | null {
  const r = m.reference;
  if (!r) return null;
  if (r.type === 'variant') return `/products/${m.product.id}`;
  if (r.type === 'order') return `/orders/${r.id}`;
  if (r.type === 'sale') return `/sales/${r.id}`;
  if (r.type === 'purchase') return `/purchases/${r.id}`;
  if (r.type === 'inventory') return `/inventory/${r.id}`;
  return null;
}
/** How a reference reads: document numbers get a `#`, a variant its name, manual / import only their type label. */
export function referenceKind(type: string | undefined): 'number' | 'name' | 'type' {
  if (type === 'order' || type === 'sale' || type === 'purchase' || type === 'inventory') return 'number';
  return type === 'variant' ? 'name' : 'type';
}

/**
 * The note of a movement once its reference is shown next to it (full-test 15/11 STOCK-14, journey J07r-5): a note that only
 * repeats the reference (« CMD-1024 ») is dropped, and an inventory note « INV-1 · 2 pulls M abîmés » loses its leading
 * « INV-1 · » (the line read « Inventaire · #INV-1 · INV-1 · … »).
 */
export function noteBeyondReference(note: string | null | undefined, label: string | null | undefined): string | null {
  if (!note) return null;
  if (!label) return note;
  const bare = note.replace(/^#/, '').trim();
  if (bare === label) return null;
  for (const sep of [' · ', ' — ', ' - ', ': ']) if (bare.startsWith(`${label}${sep}`)) return bare.slice(label.length + sep.length).trim() || null;
  return note;
}

export const actorName = (a: StockMovement['actor']): string | null => (a ? `${a.firstName} ${a.lastName}`.trim() || null : null);
