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
export type IntegerParse = { ok: false } | { ok: true; value: string; fraction: string; caretDigits: number };

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
  if (/[^\d.,-]/.test(text)) return { ok: false };
  let negative = false;
  if (text.includes('-')) {
    if (!opts.allowNegative || !/^-[^-]*$/.test(text)) return { ok: false };
    negative = true;
    text = text.slice(1);
  }
  // the last separator followed by 0–2 digits at the end is the decimal mark; every other one groups thousands
  let fraction = '';
  const dec = /[.,](\d{0,2})$/.exec(text);
  let intPart = text;
  if (dec && !/^[.,]\d{3}/.test(text.slice(dec.index))) {
    fraction = dec[0];
    intPart = text.slice(0, dec.index);
  }
  // thousands groups: every separator left must be followed by exactly 3 digits
  if (/[.,](?!\d{3}(?:[.,]|$))/.test(intPart)) return { ok: false };
  const digits = intPart.replace(/[.,]/g, '');
  if (!digits && !fraction) return negative ? { ok: true, value: '-', fraction: '', caretDigits: 0 } : { ok: true, value: '', fraction: '', caretDigits: 0 };
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed.length > maxDigits) return { ok: false };
  const before = head.replace(/\D/g, '').length - (digits.length - trimmed.length);
  return { ok: true, value: `${negative ? '-' : ''}${trimmed || (fraction ? '0' : '')}`, fraction, caretDigits: Math.max(0, Math.min(before, trimmed.length)) };
}

/** The integer of a parsed value (`''` and `'-'` ⇒ null). */
export const integerOf = (value: string): number | null => (/^-?\d+$/.test(value) ? Number(value) : null);
