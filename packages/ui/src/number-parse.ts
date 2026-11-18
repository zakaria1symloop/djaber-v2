// Full-test 15/11 (ORDERS-01, PRODUCTS-01, DELIVERY-01, STOCK-02, SETTINGS-09, SALES-CASH-07 / -13): the integer fields used
// to keep only the digits of what was typed, so « 2500,00 » became 250 000 DA, « 1.5 » 15 and « -100 » +100. This is the one
// reading of a typed / pasted integer (money in DA, quantities, days, thresholds) used by NumberInput, MoneyInput and QtyStepper.
//
//   « 2 500 », « 2.500 », « 2,500 », « 2500 DA »        → 2500   (a separator followed by 3 digits groups thousands)
//   « 2500,00 », « 2500.5 », « 1999. »                  → 2500 / 2500 / 1999 + the decimal part kept on screen while typing
//                                                          (`fraction`), dropped when the field loses focus — never ×10 / ×100
//   « -100 »                                            → -100 when the field allows negatives, else the keystroke is ignored
//   letters (« 1e3 », « abc »), a second minus,  more digits than `maxDigits`  → ignored (the field keeps its value)
//   Arabic-Indic digits (٠١٢…, ۰۱۲…)                     → Latin digits
/** why a keystroke was refused (journey J07r-4 / J02r-5: the field says it under itself, it was a silent flash) */
export type IntegerRefusal = 'minus' | 'digits' | 'char';
export type IntegerParse = { ok: false; reason: IntegerRefusal } | { ok: true; value: string; fraction: string; caretDigits: number };

const DIGIT_MAP: Record<string, string> = Object.fromEntries([...'٠١٢٣٤٥٦٧٨٩'].map((d, i) => [d, String(i)]).concat([...'۰۱۲۳۴۵۶۷۸۹'].map((d, i) => [d, String(i)])));
const latin = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
const SPACES = /[\s\u00a0\u202f']/g;
/** a currency word pasted with the amount (« 2 500 DA », « 2500 دج ») */
const CURRENCY = /\s*(da|dzd|dinars?|دج|د\.ج)\s*$/i;

/**
 * `raw`: the whole text of the field after the keystroke; `caret`: the caret position in `raw` (selectionStart).
 * `caretDigits`: the number of digits before the caret in the result, to put the caret back after regrouping.
 */
export function parseIntegerInput(raw: string, opts: { allowNegative?: boolean; maxDigits?: number; caret?: number } = {}): IntegerParse {
  const maxDigits = opts.maxDigits ?? 9;
  const caret = opts.caret ?? raw.length;
  let text = latin(raw).replace(CURRENCY, '');
  const head = latin(raw.slice(0, caret)).replace(SPACES, '');
  text = text.replace(SPACES, '');
  if (!text) return { ok: true, value: '', fraction: '', caretDigits: 0 };
  // only digits, separators and one leading minus
  if (/[^\d.,-]/.test(text)) return { ok: false, reason: 'char' };
  let negative = false;
  if (text.includes('-')) {
    if (!opts.allowNegative || !/^-[^-]*$/.test(text)) return { ok: false, reason: 'minus' };
    negative = true;
    text = text.slice(1);
  }
  // The last separator is the decimal mark when it is followed by 0–2 digits, or by 3+ digits after a badly grouped integer
  // (« 2500,005 » — journey J05: a 3rd decimal digit turned the comma into a thousands separator, 2 500 005); it groups
  // thousands only after a well-formed group run (« 2.500 », « 12.500.000 »)
  let fraction = '';
  const last = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
  let intPart = text;
  if (last >= 0) {
    const after = text.slice(last + 1);
    const head = text.slice(0, last);
    const grouped = /^\d{1,3}(?:[.,]\d{3})*$/.test(head) && after.length === 3;
    if (/^\d*$/.test(after) && !grouped) {
      fraction = text.slice(last);
      intPart = head;
    }
  }
  // thousands groups: every separator left must be followed by exactly 3 digits
  if (/[.,](?!\d{3}(?:[.,]|$))/.test(intPart)) return { ok: false, reason: 'char' };
  const digits = intPart.replace(/[.,]/g, '');
  if (!digits && !fraction) return negative ? { ok: true, value: '-', fraction: '', caretDigits: 0 } : { ok: true, value: '', fraction: '', caretDigits: 0 };
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed.length > maxDigits) return { ok: false, reason: 'digits' };
  const before = head.replace(/\D/g, '').length - (digits.length - trimmed.length);
  return { ok: true, value: `${negative ? '-' : ''}${trimmed || (fraction ? '0' : '')}`, fraction, caretDigits: Math.max(0, Math.min(before, trimmed.length)) };
}

/** The integer of a parsed value (`''` and `'-'` ⇒ null). */
export const integerOf = (value: string): number | null => (/^-?\d+$/.test(value) ? Number(value) : null);

/**
 * Journey J05r-1: what an integer field shows while it has focus. A field the merchant empties stays empty until it loses
 * focus, even when the screen keeps a number (`'' → 0`): it used to show « 0 » at once with the caret before it, so typing
 * 500 gave « 5 000 ». `blank` is set by a keystroke that leaves nothing (no digit, no decimal part) and cleared by the next
 * digit, by the blur, or when the value is changed from outside the field.
 */
export type IntegerDraft = { fraction: string; blank: boolean };
export const integerDraftAfter = (r: { value: string; fraction: string }): IntegerDraft => ({ fraction: r.fraction, blank: r.value === '' && r.fraction === '' });
export const integerFieldText = (grouped: string, draft: IntegerDraft): string => (draft.blank ? '' : grouped + draft.fraction);

/**
 * Journey J08r-1: an accepted edit that removed text (Backspace, Delete, a cut, typing over a selection): the merchant
 * correcting a refused key, so the entry is clean again for `NumberInput.onRefusedEntry`. `shown` is the field's text before
 * the edit, `raw` after it — a plain keystroke adds one character.
 */
export const integerEntryErased = (shown: string, raw: string): boolean => raw.length <= shown.length;
