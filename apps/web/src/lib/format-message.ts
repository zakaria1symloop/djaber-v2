// ICU formatting of a flat catalogue key — shared by the client hook `useT()` (lib/i18n.tsx) and server code
// (public pages metadata, lib/server-i18n.ts). No React, no 'use client'.
import { IntlMessageFormat } from 'intl-messageformat';

export type Flat = Record<string, string>;
export type Params = Record<string, string | number | Date | null | undefined>;
export type TFunction = ((key: string, params?: Params) => string) & { has: (key: string) => boolean; /** locale of the catalogue (dates / numbers in reasons) */ locale?: string };

const cache = new Map<string, IntlMessageFormat>();

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

export const formatMessage = (locale: string, messages: Flat, key: string, params?: Params): string => {
  const template = messages[key];
  if (template === undefined) return key; // visible in the UI and caught by `pnpm i18n:check`
  if (!params && !template.includes('{')) return template;
  const id = `${locale}:${key}`;
  let fmt = cache.get(id);
  if (!fmt) {
    try {
      fmt = new IntlMessageFormat(template, locale, undefined, { ignoreTag: true });
    } catch {
      return fillWhatIsKnown(template, params);
    }
    cache.set(id, fmt);
  }
  try {
    return String(fmt.format(params as Record<string, string | number>));
  } catch {
    // a value the caller did not pass (IntlMessageFormat throws): never the raw `{name}` on screen
    return fillWhatIsKnown(template, params);
  }
};

/** A `t()` bound to one locale + catalogue (same contract as `useT()`). */
export const makeT = (locale: string, messages: Flat): TFunction =>
  Object.assign((key: string, params?: Params) => formatMessage(locale, messages, key, params), { has: (key: string) => messages[key] !== undefined, locale });
