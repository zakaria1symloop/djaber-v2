// CLAUDE.md rule 11 + 08-coder-playbook §6: integer DZD, Latin digits, thin-space thousands, Africa/Algiers.
export const TIMEZONE = 'Africa/Algiers';
// no-break space: U+202F (narrow) collapses to almost nothing in Geist, so amounts read 3900DA — 06 §6 wants 12 500 DA
const THIN = '\u00a0';

export const formatNumber = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

export const formatMoney = (n: number) => `${formatNumber(n)}${THIN}DA`;

export const roundHalfUp = (n: number) => Math.floor(n + 0.5);

/** `0555123456` → `05 55 12 34 56` */
/** 06-i18n §6: mobiles `0555 12 34 56` (4-2-2-2); landlines `021 23 45 67` (3-2-2-2). Stored form is unchanged. */
export const formatPhoneDz = (p: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(p) ?? /^(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(p);
  return m ? m.slice(1).join(' ') : p;
};

const MONTHS: Record<'fr' | 'ar' | 'en', string[]> = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
};

/** `YYYY-MM-DD` of an instant in Africa/Algiers (a date-only field filled from a stored UTC instant). */
export const algiersDayOf = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/** `11 oct. 2026` (Africa/Algiers) */
export const formatDate = (d: Date | string, locale: 'fr' | 'ar' | 'en' = 'fr') => {
  const p = parts(new Date(d));
  return `${p.day} ${MONTHS[locale][Number(p.month) - 1]} ${p.year}`;
};

/** `11 oct. 2026 14:05` (Africa/Algiers) */
export const formatDateTime = (d: Date | string, locale: 'fr' | 'ar' | 'en' = 'fr') => {
  const p = parts(new Date(d));
  return `${formatDate(d, locale)} ${p.hour}:${p.minute}`;
};
