// 07-architecture §4 "Language source" — texts the server STORES to be shown later (cash rows, order history notes,
// stock movement notes, block notes, parcel timeline lines…) are never a sentence in one language: they are a key of the
// shared copy deck + its values, rendered in the reader's language when a screen / export shows them (UX-056 leftovers,
// 14/11: « IA : demande du client » stayed French in the Arabic order history). Typed text (a member's note, a supplier
// name, a reason typed in a dialog) is stored as typed and travels as a value.
//
// Format: `§<key>` followed by `|name=value` pairs, e.g. `§stored.cash.orderPayment|number=CMD-1008`. A value never holds
// `|` or a line break (replaced by `/` and a space). Values joined with « · » (history reason + note) may mix tokens and
// typed text: every part is rendered on its own.
import { formatMessage } from '../errors';
import { isAppLocale, type AppLocale } from './index';
import { getMessages } from './messages';

export const STORED_TEXT_MARK = '§';
type Value = string | number | null | undefined;

/** The stored form of `key` with its values (empty values are left out: the sentence drops their slot). */
export const storedText = (key: string, params: Record<string, Value> = {}): string =>
  STORED_TEXT_MARK +
  [key, ...Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ')}`)].join('|');

/** `{ key, params }` of a stored token; null for typed text. */
export const parseStoredText = (value: string | null | undefined): { key: string; params: Record<string, string> } | null => {
  if (!value || !value.startsWith(STORED_TEXT_MARK)) return null;
  const [key, ...pairs] = value.slice(STORED_TEXT_MARK.length).split('|');
  if (!key || !/^[\w.-]+$/.test(key)) return null;
  const params: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i > 0) params[p.slice(0, i)] = p.slice(i + 1);
  }
  return { key, params };
};

const PART_SEPARATOR = ' · ';
/**
 * The value as the reader reads it: each « · » part that is a stored token becomes the sentence of its key (with its
 * values), typed text stays as typed. A token whose key the deck does not know is left out (never shown raw).
 */
export const renderStoredText = (value: string | null | undefined, t: (key: string, params: Record<string, string>) => string | null): string | null => {
  if (value === null || value === undefined) return null;
  if (!value.includes(STORED_TEXT_MARK)) return value;
  return value
    .split(PART_SEPARATOR)
    .map((part) => {
      const token = parseStoredText(part.trim());
      return token ? t(token.key, token.params) : part;
    })
    .filter((x): x is string => !!x && x.trim() !== '')
    .join(PART_SEPARATOR);
};

/**
 * journey 16/11 J14-7 (SALES-CASH-23): in an Arabic sentence « #{number} » is isolated (FSI … PDI) so that the « # » stays
 * before the reference — « البيع VNT-1002# » / « الطلب CMD-1005# (دفعة) » in the cash rows. Invisible in every viewer.
 */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
export const isolateRefs = (template: string): string => template.replace(/#\{(\w+)\}/g, `${FSI}#{$1}${PDI}`);

/** One sentence of the shared catalogue in `locale` (French when the key has no translation there); null = unknown key. */
export const textIn = (key: string, locale: string, params: Record<string, string | number> = {}): string | null => {
  const l: AppLocale = isAppLocale(locale) ? locale : 'fr';
  const raw = getMessages(l)[key] ?? getMessages('fr')[key];
  if (raw === undefined) return null;
  const template = l === 'ar' ? isolateRefs(raw) : raw;
  // full-test 15/11 SALES-CASH-14: a value that is itself a token without values (`§sales.cancel.reason.entry_error`, a
  // reason picked from a list) is read in the reader's language too — typed text stays as typed
  const shown = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' && v.startsWith(STORED_TEXT_MARK) && !v.includes('|') ? (textIn(v.slice(STORED_TEXT_MARK.length), l) ?? '') : v]));
  return formatMessage(template, shown);
};

/**
 * full-test 15/11 ANALYTICS-10: cash rows written before UX-056 hold the French sentence of a `stored.cash.*` key
 * (« Achat #ACH-1002 (paiement fournisseur) »). A text that is exactly one of those sentences is read as that key, so it is
 * shown in the reader's language too (no data migration); any other text stays as typed.
 */
let legacyPatterns: { key: string; re: RegExp; names: string[] }[] | null = null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const legacyStoredText = (text: string): string | null => {
  legacyPatterns ??= Object.entries(getMessages('fr'))
    .filter(([key]) => key.startsWith('stored.cash.'))
    .map(([key, template]) => {
      const names: string[] = [];
      const body = template
        .split(/(\{\w+\})/)
        .map((part) => {
          const slot = /^\{(\w+)\}$/.exec(part);
          if (!slot) return escapeRe(part);
          names.push(slot[1]!);
          return '(.+?)';
        })
        .join('');
      return { key, re: new RegExp(`^${body}$`), names };
    });
  const value = text.trim();
  for (const p of legacyPatterns) {
    const m = p.re.exec(value);
    if (m) return storedText(p.key, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
  }
  return null;
};

/** `renderStoredText` with the shared catalogue, in `locale` (French when the key has no translation there). */
export const renderStoredTextIn = (value: string | null | undefined, locale: string): string | null =>
  renderStoredText(value && !value.includes(STORED_TEXT_MARK) ? (legacyStoredText(value) ?? value) : value, (key, params) => textIn(key, locale, params));
