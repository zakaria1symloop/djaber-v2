// Client list L4 / L27 (Houssem live 24/11): « répond après 7 s alors que l'agent est réglé sur 3 s » — the wait was counted from the
// reception of the message; Facebook's delivery time (1.5–2 s measured) came on top.
import { MIN_WINDOW_MS, replyWaitMs } from './batching.service';

describe('replyWaitMs', () => {
  const now = Date.UTC(2026, 10, 24, 14, 4, 21, 593);
  const sent = (msAgo: number) => new Date(now - msAgo);

  it('takes the time the message spent in transit off the agent delay', () => {
    expect(replyWaitMs(3, sent(1551), now)).toBe(1449); // Houssem's « salam »: sent 14:04:20.042, received 14:04:21.593
    expect(replyWaitMs(3, sent(0), now)).toBe(3000);
    expect(replyWaitMs(10, sent(2000), now)).toBe(8000);
  });

  it('always leaves a short window for a second message sent right behind', () => {
    expect(replyWaitMs(3, sent(2600), now)).toBe(MIN_WINDOW_MS);
    expect(replyWaitMs(3, sent(60_000), now)).toBe(MIN_WINDOW_MS); // a webhook delivered late
  });

  it('never waits longer than the delay, nor adds a window to an agent set to answer at once', () => {
    expect(replyWaitMs(3, sent(-5000), now)).toBe(3000); // a clock ahead of ours
    expect(replyWaitMs(0, sent(1500), now)).toBe(0);
    expect(replyWaitMs(0.5, sent(1500), now)).toBe(500);
    expect(replyWaitMs(3, null, now)).toBe(3000);
    expect(replyWaitMs(3, undefined, now)).toBe(3000);
  });
});
