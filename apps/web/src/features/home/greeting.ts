// Home greeting (Figma ANA-01: "MARDI 7 OCTOBRE" + "Bonsoir, Zakaria"), computed in Africa/Algiers.
import { TIMEZONE } from '@djaber/shared';

/** Hour (0–23) in Africa/Algiers. */
export const algiersHour = (d: Date): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hour12: false }).format(d)) % 24;

/**
 * Morning 05:00–11:59, afternoon 12:00–17:59, evening otherwise — the same parts of the day as `GET /dashboard/home`
 * `partOfDay`. FR says « Bonjour » for both morning and afternoon; EN / AR have their own afternoon words (journey 16/11
 * J01-8: « Good morning » at 17:20).
 */
export const greetingKey = (d: Date): 'home.greeting.morning' | 'home.greeting.afternoon' | 'home.greeting.evening' => {
  const h = algiersHour(d);
  return h >= 5 && h < 12 ? 'home.greeting.morning' : h >= 12 && h < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening';
};

/** "mardi 7 octobre" — weekday + day + month, Latin digits in every locale. */
export const longDate = (d: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(d);

/** "12 août" — page card "connectée le …" (Figma ANA-01 page card meta). */
export const dayMonth = (d: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ-u-nu-latn' : locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: TIMEZONE, day: 'numeric', month: 'long' }).format(d);
