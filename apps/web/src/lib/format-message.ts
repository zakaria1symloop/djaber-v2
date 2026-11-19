// ICU formatting of a flat catalogue key — shared by the client hook `useT()` (lib/i18n.tsx) and server code
// (public pages metadata, lib/server-i18n.ts). No React, no 'use client'.
import { isolateRefs } from '@djaber/shared';
import { IntlMessageFormat } from 'intl-messageformat';

export type Flat = Record<string, string>;
export type Params = Record<string, string | number | Date | null | undefined>;
/**
 * Journeys 18/11 J11r-6 (b): the arrow of a date range points the way the page reads — « 01 جانفي ← 18 نوفمبر » in Arabic
 * (the J11-7 (i) rule of « عرض الكل ← »), « 01 janv. → 18 nov. » in French and English.
 */
export const rangeArrow = (locale: string | undefined): string => (locale === 'ar' ? '←' : '→');

export type TFunction = ((key: string, params?: Params) => string) & { has: (key: string) => boolean; /** locale of the catalogue (dates / numbers in reasons) */ locale?: string };

const cache = new Map<string, IntlMessageFormat>();

/**
 * A value put inside a translated sentence, isolated from the words around it (Unicode FSI … PDI): in Arabic « #ACH-1008 »,
 * « 2 000 DA », « 100 % » or « Karim P. » keep their own order instead of becoming « ACH-1008# », « DA 2 000 », « % 100 »,
 * « .Karim P » (full-test 15/11 STOCK-07 / SALES-CASH-23). Invisible in every language.
 */
export const iso = (value: string | number): string => `\u2068${value}\u2069`;
/** A left-to-right island (LRI \u2026 PDI): numbers, ranges \u00ab 4 500 DA \u2013 4 800 DA \u00bb, \u00ab \u00d72 \u00bb keep their order in Arabic. */
export const ltr = (value: string | number): string => `\u2066${value}\u2069`;
/**
 * journey J14v-1 (19/11): \u00ab #CMD-1003 \u00bb / \u00ab #VNT-1004 \u00bb / \u00ab #ACH-1002 \u00bb written by code into a sentence (a dialog's context line, a
 * menu heading, a label \u00ab #CMD-1003 \u00b7 Amina \u00bb) \u2014 isolated in Arabic (the \u00ab # \u00bb stayed at the other end: \u00ab CMD-1003# \u00b7 \u0645\u0624\u0643\u064e\u0651\u062f \u00b7 \u2026 \u00bb), as
 * the catalogue's `#{number}` (`isolateRefs`). A leading \u00ab # \u00bb of the value is not doubled.
 */
export const docRef = (t: { locale?: string }, number: string | number): string => {
  const ref = `#${String(number).replace(/^#/, '')}`;
  return t.locale === 'ar' ? iso(ref) : ref;
};
/**
 * \u00ab name \u00d7qty \u00bb of a document line (journeys J06-9 / J06r-4): the name and the quantity are two isolates, so a mixed
 * Latin / Arabic name (\u00ab QA J06r \u0639\u0637\u0631 \u0645\u0633\u0643 \u00bb) never swallows \u00ab \u00d72 \u00bb into its Arabic run (\u00ab 2\u00d7 \u0639\u0637\u0631 \u0645\u0633\u0643 \u00bb), and the quantity
 * follows the name in the reading direction of the page (on its right in French, on its left in Arabic).
 */
export const qtyLabel = (name: string, qty: number): string => `${iso(name)} ${ltr(`\u00d7${qty}`)}`;

/** Marks the place of a value nobody gave (removed by `stripPlaceholders`). */
const SLOT = String.fromCharCode(0x2063); // INVISIBLE SEPARATOR

/**
 * UX-060 (retest 12/11): a sentence never reaches the screen with a raw `{retryAfter}` / `{from} → {to}`. Every slot left
 * unfilled is dropped (ICU plural / select blocks included), then the sentence is tidied: an arrow between two missing
 * values goes with them, brackets / quotes left with no word inside and doubled spaces disappear.
 */
export const stripPlaceholders = (text: string): string => {
  let s = text;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\{[^{}]*\}/g, SLOT);
  }
  if (!s.includes(SLOT)) return text;
  return s
    .replace(new RegExp(`${SLOT}\\s*[→←]\\s*${SLOT}`, 'g'), '')
    .replace(new RegExp(`\\s*[→←]\\s*${SLOT}|${SLOT}\\s*[→←]\\s*`, 'g'), ' ')
    .replace(new RegExp(SLOT, 'g'), '')
    .replace(/\([\s/·:,.\-–—]*\)|«\s*»|“\s*”|"\s*"/g, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/[^\S\r\n]+([.,)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
};

/** The template with the simple `{name}` values that were given, every other slot dropped (fallback of a failed format). */
const fillWhatIsKnown = (template: string, params?: Params): string =>
  stripPlaceholders(
    template.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = params?.[k];
      return v === undefined || v === null ? m : v instanceof Date ? v.toISOString() : String(v);
    }),
  );

/**
 * A value that ends with its own full stop (« 21 oct. », « Amina T. ») at the end of a sentence gives « oct.. »: the
 * sentence's stop is dropped (an ellipsis « … » / « ... » is kept) — full-test 15/11 STOCK-14.
 */
export const tidyStops = (text: string): string => (text.includes('.') ? text.replace(/(^|[^.])\.([\u2066-\u2069]*)\.(?![.\u2066-\u2069])/g, '$1.$2') : text);

export const formatMessage = (locale: string, messages: Flat, key: string, params?: Params): string => {
  const template = messages[key];
  if (template === undefined) return key; // visible in the UI and caught by `pnpm i18n:check`
  if (!params && !template.includes('{')) return template;
  const id = `${locale}:${key}`;
  let fmt = cache.get(id);
  if (!fmt) {
    try {
      // journey J14-7: « #{number} » isolated in Arabic (« CMD-1001# » / « VNT-1002# » otherwise), as the stored texts
      fmt = new IntlMessageFormat(locale === 'ar' ? isolateRefs(template) : template, locale, undefined, { ignoreTag: true });
    } catch {
      return fillWhatIsKnown(template, params);
    }
    cache.set(id, fmt);
  }
  try {
    return tidyStops(String(fmt.format(params as Record<string, string | number>)));
  } catch {
    // a value the caller did not pass (IntlMessageFormat throws): never the raw `{name}` on screen
    return fillWhatIsKnown(template, params);
  }
};

/** A `t()` bound to one locale + catalogue (same contract as `useT()`). */
export const makeT = (locale: string, messages: Flat): TFunction =>
  Object.assign((key: string, params?: Params) => formatMessage(locale, messages, key, params), { has: (key: string) => messages[key] !== undefined, locale });
