// 04 §8 — "today", periods and date-only inputs are read in Africa/Algiers (UTC+1, no DST since 1981); stored values are UTC.
export const ALGIERS_OFFSET_MS = 3600_000;
const OFFSET_MS = ALGIERS_OFFSET_MS;

/** `YYYY-MM-DD` of an instant in Africa/Algiers. */
export const algiersDay = (at: Date = new Date()): string => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** First instant of a local day, as UTC. */
export const algiersDayStart = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS);

/** First instant after a local day (date-only `to` is inclusive: use `< algiersDayEnd(to)`). */
export const algiersDayEnd = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS + 24 * 3600_000);

/** `HH:mm` of an instant in Africa/Algiers. */
export const algiersTime = (at: Date): string => new Date(at.getTime() + OFFSET_MS).toISOString().slice(11, 16);

/** `YYYY-MM-DD HH:mm` wall clock of an instant in Africa/Algiers. */
export const algiersStamp = (at: Date): string => `${algiersDay(at)} ${algiersTime(at)}`;

/**
 * A date as the AI model receives it in tool results (04-ai-pipeline §4.2): Algiers wall clock, labelled, never UTC ISO — a
 * UTC value let the model tell a customer an hour off, or the wrong day between 00:00 and 01:00.
 */
export const aiDateTime = (at: Date): string => `${algiersStamp(at)} (Algeria time)`;

/** Hour (0–23) and weekday (0 = Sunday) of an instant in Africa/Algiers. */
export const algiersClock = (at: Date) => {
  const local = new Date(at.getTime() + OFFSET_MS);
  return { weekday: local.getUTCDay(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), day: local.toISOString().slice(0, 10) };
};
