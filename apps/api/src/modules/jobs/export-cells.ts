// UX-058 (12/11) — one writing rule for every merchant export file (06 §7 "Dates and labels"):
// - an instant is written in Africa/Algiers wall-clock time, « 11/11/2026 15:38 », the same minute as the screen (stored
//   values are UTC, 04 §8); a date-only value « 11/11/2026 ». In XLSX it is a real date cell (number format
//   `dd/mm/yyyy hh:mm` / `dd/mm/yyyy`), in CSV / PDF the same text. Same digits whatever the export language.
// - an enumerated value (type, mode, status, source…) is the label the screen shows, in the export language
//   (« COD livré », « COD », « Espèces »), never the stored code (« order », « cod »); an unknown value stays as stored.
import { formatMessage, getMessages, isAppLocale, type AppLocale } from '@djaber/shared';
import { ALGIERS_OFFSET_MS, isDay } from '../../core/time/algiers';
import type { DateCell } from './xlsx';

const DAY_MS = 86_400_000;
/** Excel serial 0 = 1899-12-30 (the 1900 leap-year bug included). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const pad = (n: number) => String(n).padStart(2, '0');

const instant = (at: Date | string | null | undefined): Date | null => {
  if (at === null || at === undefined || at === '') return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Wall-clock milliseconds (Algiers) of an instant, cut to the minute like the screens. */
const wallClock = (d: Date) => Math.floor((d.getTime() + ALGIERS_OFFSET_MS) / 60_000) * 60_000;

const cell = (localMs: number, format: DateCell['format']): DateCell => {
  const l = new Date(localMs);
  const day = `${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}`;
  return { date: (localMs - EXCEL_EPOCH_MS) / DAY_MS, format, text: format === 'date' ? day : `${day} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}` };
};

/** An instant (Date or ISO text) ⇒ « dd/mm/yyyy hh:mm » in Africa/Algiers; `null` when absent. */
export const exportDateTime = (at: Date | string | null | undefined): DateCell | null => {
  const d = instant(at);
  return d ? cell(wallClock(d), 'datetime') : null;
};

/** A day ⇒ « dd/mm/yyyy »: a `YYYY-MM-DD` value as written, an instant as its Algiers day; `null` when absent. */
export const exportDate = (at: Date | string | null | undefined): DateCell | null => {
  if (isDay(at)) return cell(Date.parse(`${at}T00:00:00Z`), 'date');
  const d = instant(at);
  if (!d) return null;
  const local = wallClock(d);
  return cell(local - (local % DAY_MS), 'date');
};

/**
 * The screen label of an enumerated value in the export language: the first of `prefixes` whose `<prefix>.<value>` key
 * exists (French catalogue as fallback), formatted with `params`; decorations of the pills are dropped (the leading
 * glyph of the source pills « ✦ IA », the « ✓ » of « LIVRÉE ✓ », an empty placeholder). Unknown value ⇒ the value itself.
 */
export const exportLabel = (locale: string, prefixes: string | string[], value: string | null | undefined, params: Record<string, string | number> = {}): string => {
  if (value === null || value === undefined || value === '') return '';
  const l: AppLocale = isAppLocale(locale) ? locale : 'fr';
  for (const prefix of Array.isArray(prefixes) ? prefixes : [prefixes]) {
    const key = `${prefix}.${value}`;
    const template = getMessages(l)[key] ?? getMessages('fr')[key];
    if (template === undefined) continue;
    return formatMessage(template, params)
      .replace(/\{\w+\}/g, '')
      .replace(/^[^\p{L}\p{N}]+(?=\p{L})/u, '')
      .replace(/\s*✓$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return value;
};
