// Client stand-in of `@djaber/shared`'s `i18n/messages` module (full-test 15/11 PUBLIC-04), swapped in by next.config.ts for
// the browser bundles only. The shared package is CommonJS, so its barrel cannot be tree-shaken: without this, every page
// that imports anything from `@djaber/shared` downloaded the whole catalogue of the three languages (≈ 2.3 MB of JS).
// Client components read their texts with `useT()` (catalogue sent by the layouts, lib/server-messages.tsx); the two
// screens that need another language's catalogue import `@djaber/shared/messages` directly (not replaced).
// A client call of the barrel's `getMessages` / `systemUnitText` / `textIn` is refused by src/i18n/client-catalogue.spec.ts.
import type { AppLocale } from '@djaber/shared';

type Flat = Record<string, string>;
const EMPTY: Flat = Object.freeze({}) as Flat;

export const MESSAGES: Record<AppLocale, Flat> = { fr: EMPTY, ar: EMPTY, en: EMPTY };
export const getMessages = (_locale: AppLocale): Flat => EMPTY;
export const systemUnitText = (_abbreviation: string, _locale: AppLocale): { name: string; abbreviation: string } | null => null;
