// Message catalogue shared by web, API (error messages, notification titles, exports) and mobile (copied at build).
// deck.*  = keys extracted from docs/implementation/06-i18n-copy-deck.md (tools/gen-copy.mjs)
// app.*   = page-specific keys added milestone after milestone (FR copied verbatim from the Figma frames)
// admin-core = keys of the platform admin shell + core screens (M10 web-a; separate file so parallel teams edit different files)
// api-agents = server-rendered texts of the agents module (`agent.api.*`: default names, readiness checklist — M11)
// api-integrations = M11 integrations / public forms server texts (`validation.captcha`, …)
// web-integrations = M11 Settings › Intégrations screens (web-integrations); web-carryovers = M11 web carry-over closures
// web-gaps = fixes of the 2026-10-15 audit (agents, channels, inbox, orders, home, notifications) — fix/gaps-agents-inbox-orders
// web-public = M11 public site (landing, pricing, help centre, legal, account deletion, captcha) — web-public
// error.* = generated from docs/specs/11-error-catalogue.md (tools/gen-errors.mjs)
import errAr from '../errors/messages.ar.json';
import errEn from '../errors/messages.en.json';
import errFr from '../errors/messages.fr.json';
import appAr from './messages/app.ar.json';
import appEn from './messages/app.en.json';
import appFr from './messages/app.fr.json';
import admAr from './messages/admin-core.ar.json';
import admEn from './messages/admin-core.en.json';
import admFr from './messages/admin-core.fr.json';
import agtAr from './messages/api-agents.ar.json';
import agtEn from './messages/api-agents.en.json';
import agtFr from './messages/api-agents.fr.json';
import intAr from './messages/api-integrations.ar.json';
import intEn from './messages/api-integrations.en.json';
import intFr from './messages/api-integrations.fr.json';
import wintAr from './messages/web-integrations.ar.json';
import wintEn from './messages/web-integrations.en.json';
import wintFr from './messages/web-integrations.fr.json';
import wcoAr from './messages/web-carryovers.ar.json';
import wcoEn from './messages/web-carryovers.en.json';
import wcoFr from './messages/web-carryovers.fr.json';
import wgapAr from './messages/web-gaps.ar.json';
import wgapEn from './messages/web-gaps.en.json';
import wgapFr from './messages/web-gaps.fr.json';
import wpubAr from './messages/web-public.ar.json';
import wpubEn from './messages/web-public.en.json';
import wpubFr from './messages/web-public.fr.json';
import deckAr from './messages/deck.ar.json';
import deckEn from './messages/deck.en.json';
import deckFr from './messages/deck.fr.json';
import type { AppLocale } from './index';

type Flat = Record<string, string>;
const withErrors = (base: Flat, app: Flat, errors: Flat, admin: Flat = {}): Flat => {
  const out: Flat = { ...base, ...app, ...admin };
  for (const [code, text] of Object.entries(errors)) out[`error.${code}`] = text;
  return out;
};

export const MESSAGES: Record<AppLocale, Flat> = {
  fr: withErrors(deckFr, appFr, errFr, { ...admFr, ...agtFr, ...intFr, ...wintFr, ...wcoFr, ...wpubFr, ...wgapFr }),
  ar: withErrors(deckAr, appAr, errAr, { ...admAr, ...agtAr, ...intAr, ...wintAr, ...wcoAr, ...wpubAr, ...wgapAr }),
  en: withErrors(deckEn, appEn, errEn, { ...admEn, ...agtEn, ...intEn, ...wintEn, ...wcoEn, ...wpubEn, ...wgapEn }),
};

/** Flat `key -> ICU message` map of a locale. */
export const getMessages = (locale: AppLocale): Flat => MESSAGES[locale] ?? MESSAGES.fr;

/**
 * PV 08/11 « l'unité de produit n'est pas traduite »: the system units (seeded once for every shop: Pièce, Kilogramme…)
 * are stored in French; their name and abbreviation in a language (keys `unit.system.<abbreviation>.name|abbr`).
 * null for a unit the shop created (its own words).
 */
export const systemUnitText = (abbreviation: string, locale: AppLocale): { name: string; abbreviation: string } | null => {
  const m = getMessages(locale);
  const name = m[`unit.system.${abbreviation}.name`];
  return name ? { name, abbreviation: m[`unit.system.${abbreviation}.abbr`] ?? abbreviation } : null;
};
