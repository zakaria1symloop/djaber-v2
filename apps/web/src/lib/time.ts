// Relative times ("il y a 2 j", "dans 5 j") — 02-next-route-map §7, Latin digits in every locale.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** `relativeTime('2026-10-09T10:00:00Z', 'fr', now)` → `il y a 2 j`. Under one minute ⇒ the "now" form. */
export const relativeTime = (iso: string | Date | null | undefined, locale: string, now = Date.now()): string => {
  if (!iso) return '—';
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.round((t - now) / 1000);
  const tag = locale === 'ar' ? 'ar-u-nu-latn' : locale;
  // always numeric ("il y a 2 j", never "avant-hier"), except the "now" form
  // French narrow gives "-2 j": the short form is the readable one ("il y a 2 j")
  const fmt = new Intl.RelativeTimeFormat(tag, { numeric: 'always', style: locale === 'fr' ? 'short' : 'narrow' });
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diff) >= seconds) return fmt.format(Math.trunc(diff / seconds), unit);
  }
  return new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'narrow' }).format(0, 'second');
};

/** Whole days until an instant (0 when past). */
export const daysUntil = (iso: string, now = Date.now()): number => Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000));

/** "4 min" / "45 s" — the wait before an action is possible again (rate limits, cooldowns). */
export const waitLabel = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};
