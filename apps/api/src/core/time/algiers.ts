// 04 §8 — "today", periods and date-only inputs are read in Africa/Algiers (UTC+1, no DST since 1981); stored values are UTC.
const OFFSET_MS = 3600_000;

/** `YYYY-MM-DD` of an instant in Africa/Algiers. */
export const algiersDay = (at: Date = new Date()): string => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** First instant of a local day, as UTC. */
export const algiersDayStart = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS);

/** First instant after a local day (date-only `to` is inclusive: use `< algiersDayEnd(to)`). */
export const algiersDayEnd = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS + 24 * 3600_000);

/** `HH:mm` of an instant in Africa/Algiers. */
export const algiersTime = (at: Date): string => new Date(at.getTime() + OFFSET_MS).toISOString().slice(11, 16);

/** Hour (0–23) and weekday (0 = Sunday) of an instant in Africa/Algiers. */
export const algiersClock = (at: Date) => {
  const local = new Date(at.getTime() + OFFSET_MS);
  return { weekday: local.getUTCDay(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), day: local.toISOString().slice(0, 10) };
};
