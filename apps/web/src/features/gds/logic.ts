// Pure helpers of the GDS operations screens (no React): totals of the new purchase form and of the new sale sheet,
// the receive dialog summary, the inventory variance rule (04 §19), the expense margin preview (EXP-01/02), the cash
// period selection (09 §4: pills, table and KPIs read the same parameters) and small labels.
import { inventoryNeedsNote, inventoryVariancePct, roundHalfUp } from '@djaber/shared';
import { addDays, algiersDay } from '@/features/catalog/stock/logic';
import { algiersInstant } from '@/features/orders/logic';
import type { GdsPeriodKey } from './contracts';

/* ---------- money ---------- */
export const int = (s: string | number | null | undefined): number => {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.trunc(s) : 0;
  const n = Number(String(s ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/* ---------- new purchase (GDS-06b) ---------- */
export type PurchaseLineDraft = { quantity: number; unitCost: string; trackStock: boolean };
export function purchaseTotals(lines: readonly PurchaseLineDraft[], o: { tax: string; shipping: string; paid: string }) {
  const subtotal = lines.filter((l) => l.trackStock).reduce((s, l) => s + Math.max(0, l.quantity) * int(l.unitCost), 0);
  const total = subtotal + int(o.tax) + int(o.shipping);
  const paid = int(o.paid);
  return { subtotal, total, paid, remaining: Math.max(0, total - paid), overpaid: paid > total };
}

/* ---------- new sale (GDS-08) ---------- */
export type SaleLineDraft = { quantity: number; unitPrice: string; catalogPrice: number };
export type DiscountMode = 'amount' | 'percent';
export function saleTotals(lines: readonly SaleLineDraft[], o: { discount: string; discountMode: DiscountMode; received: string }) {
  const subtotal = lines.reduce((s, l) => s + Math.max(0, l.quantity) * int(l.unitPrice), 0);
  const raw = int(o.discount);
  const discount = Math.min(subtotal, o.discountMode === 'percent' ? roundHalfUp((subtotal * Math.min(raw, 100)) / 100) : raw);
  const total = subtotal - discount;
  const received = int(o.received);
  // amount received above the total is clamped by the API: the difference is the change given back ("RENDU")
  const paid = Math.min(received, total);
  const change = Math.max(0, received - total);
  const remaining = Math.max(0, total - paid);
  return { subtotal, discount, total, received, paid, change, remaining, partial: remaining > 0 && total > 0 };
}
/** "PRIX MODIFIÉ (4 500 → 4 200)" when the line price differs from the catalogue price. */
export const priceEdited = (l: SaleLineDraft): boolean => int(l.unitPrice) !== l.catalogPrice;

/**
 * Client part of the sale body (`POST /sales` and `PATCH /sales/:id` alike): the picked client, else the new client typed
 * in the sheet (found by phone or created by the API) — finishing a draft must not drop it (SALE_PARTIAL_REQUIRES_CUSTOMER).
 */
export function saleClientBody(picked: { id: string } | null, typed: { open: boolean; name: string; phone: string }): { clientId: string | null; client: { name: string; phone: string } | null } {
  if (picked) return { clientId: picked.id, client: null };
  if (typed.open && typed.name.trim()) return { clientId: null, client: { name: typed.name.trim(), phone: typed.phone.trim() } };
  return { clientId: null, client: null };
}

/** Comparable snapshot of the "Nouvelle vente" sheet: the sheet asks before closing when it differs from the opening one. */
export function saleSheetSnapshot(s: {
  lines: readonly { productId: string; variantId: string | null; quantity: number; unitPrice: string }[];
  discount: string;
  discountMode: DiscountMode;
  clientId: string | null;
  newClient: { open: boolean; name: string; phone: string };
  method: string;
  received: string | null;
}): string {
  return JSON.stringify([
    s.lines.map((l) => [l.productId, l.variantId, l.quantity, int(l.unitPrice)]),
    int(s.discount),
    s.discountMode,
    s.clientId,
    s.newClient.open ? [s.newClient.name.trim(), s.newClient.phone.trim()] : null,
    s.method,
    s.received === null ? null : int(s.received),
  ]);
}

/**
 * Variants offered on a purchase / draft-sale line being edited: the product's active variants once loaded, plus the
 * line's current variant when it is no longer listed (inactive), so the select never loses the saved value.
 */
export function lineVariants<V extends { id: string }>(current: readonly V[], loaded: readonly V[] | undefined): V[] {
  if (!loaded) return [...current];
  return [...loaded, ...current.filter((c) => !loaded.some((l) => l.id === c.id))];
}

/* ---------- receive dialog (GDS-07) ---------- */
export type ReceiveLineDraft = { ordered: number; alreadyReceived: number; now: number; added?: boolean };
export function receiveSummary(lines: readonly ReceiveLineDraft[]) {
  const units = lines.reduce((s, l) => s + Math.max(0, l.now), 0);
  const movements = lines.filter((l) => l.now > 0).length;
  const over = lines.filter((l) => !l.added && l.alreadyReceived + l.now > l.ordered);
  const remainingBefore = lines.filter((l) => !l.added).reduce((s, l) => s + Math.max(0, l.ordered - l.alreadyReceived), 0);
  const orderedTotal = lines.filter((l) => !l.added).reduce((s, l) => s + l.ordered, 0);
  return { units, movements, over, remainingBefore, orderedTotal };
}
/** Default of "REÇU AUJOURD'HUI": what is still due on the line. */
export const defaultReceiveQty = (ordered: number, received: number) => Math.max(0, ordered - received);

/* ---------- inventory (INV-02, 04 §19) ---------- */
export function variance(expected: number, counted: number | null) {
  if (counted === null) return { difference: 0, pct: 0, noteRequired: false, counted: false };
  const pct = inventoryVariancePct(expected, counted);
  return { difference: counted - expected, pct, noteRequired: inventoryNeedsNote(expected, counted), counted: true };
}
export function inventoryTotals(lines: readonly { expected: number; counted: number | null; cost: number | null }[]) {
  let counted = 0;
  let discrepancies = 0;
  let value = 0;
  let flagged = 0;
  for (const l of lines) {
    if (l.counted === null) continue;
    counted++;
    const v = variance(l.expected, l.counted);
    if (v.difference !== 0) {
      discrepancies++;
      value += v.difference * (l.cost ?? 0);
    }
    if (v.noteRequired) flagged++;
  }
  return { counted, discrepancies, value, flagged, progressPct: lines.length ? Math.round((counted * 100) / lines.length) : 0 };
}

/* ---------- product expense margin preview (EXP-01: "Nouvelle marge estimée 46,7 % → 44,0 %") ---------- */
export function marginPreview(o: { price: number; weightedCost: number | null; expensesPerUnit: number; unitsSold: number; amount: number; isPerUnit: boolean }) {
  const pct = (perUnit: number) => (o.weightedCost === null || o.price <= 0 ? null : Math.round(((o.price - (o.weightedCost + perUnit)) * 1000) / o.price) / 10);
  const added = o.isPerUnit ? o.amount : roundHalfUp(o.amount / Math.max(o.unitsSold, 1));
  return { before: pct(o.expensesPerUnit), after: pct(o.expensesPerUnit + added), trueCostBefore: o.weightedCost === null ? null : o.weightedCost + o.expensesPerUnit, trueCostAfter: o.weightedCost === null ? null : o.weightedCost + o.expensesPerUnit + added };
}

/* ---------- periods (purchases, sales, cash) ---------- */
/** API `period` key → from / to days (Africa/Algiers), for labels and for the custom range picker. */
export function periodDays(p: GdsPeriodKey, today: string = algiersDay()): { from: string; to: string } {
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last_month': {
      const first = `${today.slice(0, 8)}01`;
      const lastDay = addDays(first, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/**
 * Cash register selection (09 §4 regression: the pills, the table and the KPIs use the same parameters):
 * a single `day` (default today), a `period` key or a custom `from`/`to`. Returns the query sent to `GET /cash` and
 * `GET /cash/stats`, and which pill is lit.
 */
export type CashSelection = { kind: 'day'; day: string } | { kind: 'period'; period: GdsPeriodKey } | { kind: 'range'; from: string; to: string };
export function cashSelection(s: { day?: string; period?: string; from?: string; to?: string }, today: string = algiersDay()): CashSelection {
  if (s.from || s.to) return { kind: 'range', from: s.from || s.to!, to: s.to || s.from! };
  if (s.period && s.period !== 'today' && (['7d', '30d', 'month', 'last_month', '90d', 'year'] as string[]).includes(s.period)) return { kind: 'period', period: s.period as GdsPeriodKey };
  return { kind: 'day', day: s.day && /^\d{4}-\d{2}-\d{2}$/.test(s.day) ? s.day : today };
}
export const cashSelectionQuery = (sel: CashSelection): Record<string, string> => (sel.kind === 'day' ? { day: sel.day } : sel.kind === 'period' ? { period: sel.period } : { from: sel.from, to: sel.to });
/** the single day of a selection (close / reopen act on one day), else null */
export const selectionDay = (sel: CashSelection): string | null => (sel.kind === 'day' ? sel.day : sel.kind === 'range' && sel.from === sel.to ? sel.from : null);

/** "02, 03, 04 oct." from `['2026-10-02', …]` with the month label of the caller's locale. */
export function daysList(days: readonly string[], monthLabel: (day: string) => string, max = 4): string {
  if (!days.length) return '';
  const shown = days.slice(0, max);
  const sameMonth = shown.every((d) => d.slice(0, 7) === shown[0]!.slice(0, 7));
  const text = sameMonth ? `${shown.map((d) => d.slice(8, 10)).join(', ')} ${monthLabel(shown[0]!)}` : shown.map((d) => `${d.slice(8, 10)} ${monthLabel(d)}`).join(', ');
  return days.length > max ? `${text} …` : text;
}

/** Days since an instant (sale cancel window, cash edit window): whole days, floor. */
export const daysSinceIso = (iso: string, now = Date.now()) => Math.floor((now - Date.parse(iso)) / 86_400_000);

/** "PARTIEL 8/12": units received / ordered of a purchase. */
export const unitsLabel = (u: { ordered: number; received: number }) => `${u.received}/${u.ordered}`;

/** Theoretical vs counted: the gap of the close dialog (counted − theoretical); a note is required when ≠ 0. */
export const closingGap = (theoretical: number, counted: string) => (counted.trim() === '' ? null : int(counted) * (counted.trim().startsWith('-') ? -1 : 1) - theoretical);

/* ---------- cash row date (manual / correction dialog) ---------- */
/**
 * Instant of the row: the day and the time of the dialog, both Africa/Algiers (the time column of the ledger shows that
 * time — tester report 2026-10-20: an edited row kept a time nobody could see or change). An empty time means noon.
 */
export const cashDateIso = (day: string, time: string) => algiersInstant(day, /^\d{2}:\d{2}$/.test(time) ? time : '12:00').toISOString();
