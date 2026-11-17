// Journey retest R10-1: a playground answer stuck on its way is asked again with the same turn key (resendWhileStalled).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resendWhileStalled, TurnStalledError } from './resend';

/** A call whose attempts answer as scripted: a value after `ms`, or never (the answer stuck on the way). */
const scripted = (plan: ({ ms: number; value: string } | { ms: number; error: Error } | 'never')[]) => {
  const signals: AbortSignal[] = [];
  const call = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    const step = plan[signals.length - 1] ?? 'never';
    return new Promise<string>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      if (step === 'never') return;
      setTimeout(() => ('value' in step ? resolve(step.value) : reject(step.error)), step.ms);
    });
  });
  return { call, signals };
};

describe('resendWhileStalled (journey retest R10-1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('an answer in time is returned at once, with no second request', async () => {
    const { call } = scripted([{ ms: 6_000, value: 'recap' }]);
    const p = resendWhileStalled(call);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(p).resolves.toBe('recap');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('N1 T2: the first answer never arrives — the stalled attempt is aborted and the turn asked again, which answers', async () => {
    const { call, signals } = scripted(['never', { ms: 300, value: 'recap (Marron)' }]);
    const p = resendWhileStalled(call);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(call).toHaveBeenCalledTimes(2);
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    await expect(p).resolves.toBe('recap (Marron)');
  });

  it('a slow but live attempt that answers before the next resend wins', async () => {
    const { call } = scripted(['never', { ms: 14_000, value: 'late but fine' }]);
    const p = resendWhileStalled(call);
    await vi.advanceTimersByTimeAsync(34_000);
    await expect(p).resolves.toBe('late but fine');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('an error of the API ends the turn at once (no resend: 429, 503, a validation error)', async () => {
    const boom = Object.assign(new Error('AI_PROVIDER_ERROR'), { status: 503 });
    const { call } = scripted([{ ms: 2_000, error: boom }]);
    const p = resendWhileStalled(call);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await caught).toBe(boom);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('no answer at all: five attempts, then TurnStalledError after 90 s', async () => {
    const { call } = scripted([]);
    const p = resendWhileStalled(call);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(call).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await caught).toBeInstanceOf(TurnStalledError);
    expect(call).toHaveBeenCalledTimes(5);
  });
});
