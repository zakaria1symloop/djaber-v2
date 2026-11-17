// Journey retest R10-1 (17/11): three playground answers reached the page 65–213 s after the server had sent them (the job
// finished and nginx logged the whole response within the same second) — the time was lost on that one connection while the
// page's other requests went through. A turn still unanswered after a while is asked again on a new connection with the same
// `turnKey`: the API joins the same job (never a second run, never counted twice) and answers at once when it is done.

/** When the same turn is asked again (ms after the previous attempt), then the last attempt waits until `GIVE_UP_MS`. */
export const RESEND_AFTER_MS = [20_000, 15_000, 15_000, 15_000] as const;
/** No answer at all after this (the API itself answers within 45 s or fails): the turn is given up. */
export const GIVE_UP_MS = 90_000;

/** No attempt of the turn got an answer in `GIVE_UP_MS` (shown as « the AI did not answer this message »). */
export class TurnStalledError extends Error {
  constructor() {
    super('turn_stalled');
    this.name = 'TurnStalledError';
  }
}

const STALLED = Symbol('stalled');

/**
 * Runs `call` and, while no answer came, aborts it and runs it again with a new signal (same arguments, so the same
 * `turnKey`). An answer or an error of the API ends it at once; only silence leads to a resend.
 */
export async function resendWhileStalled<T>(call: (signal: AbortSignal) => Promise<T>, o: { after?: readonly number[]; giveUpMs?: number; now?: () => number } = {}): Promise<T> {
  const after = o.after ?? RESEND_AFTER_MS;
  const giveUp = o.giveUpMs ?? GIVE_UP_MS;
  const now = o.now ?? Date.now;
  const started = now();
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const wait = attempt < after.length ? after[attempt]! : Math.max(0, giveUp - (now() - started));
    const pending = call(ctrl.signal);
    // the aborted attempt rejects with an AbortError nobody waits for any more
    pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<typeof STALLED>((resolve) => {
      timer = setTimeout(() => resolve(STALLED), wait);
    });
    try {
      const r = await Promise.race([pending, stalled]);
      if (r !== STALLED) return r as T;
    } finally {
      clearTimeout(timer);
    }
    ctrl.abort();
    if (attempt >= after.length || now() - started >= giveUp) throw new TurnStalledError();
  }
}
