import { AI_ERROR_RETRY_AFTER_MS, ConversationService, HANDOFF_IDLE_RESUME_MS } from './conversation.service';

// retest 12/11 (Badro: « after a handoff the bot never recovers; even a "hello" meant as a new conversation goes to a member »)
describe('ConversationService.resumableAfterHandoff', () => {
  const svc = Object.create(ConversationService.prototype) as ConversationService;
  const now = new Date('2026-11-12T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const can = (handoffReason: string | null, handoffAgoMs: number, text: string | null, extra: Record<string, unknown> = {}) => svc.resumableAfterHandoff({ handoffReason, handoffAt: ago(handoffAgoMs), ...extra }, text, now);

  it('an AI handoff: a greeting gives it back at once, any message after the idle delay', () => {
    for (const reason of ['off_catalogue', 'unclear_streak', 'blocked_word', 'other', 'outside_window', 'orders_unavailable']) {
      expect([reason, can(reason, 60_000, 'Salam alikoum')]).toEqual([reason, true]);
      expect([reason, can(reason, 60_000, 'allo ?')]).toEqual([reason, false]);
      expect([reason, can(reason, HANDOFF_IDLE_RESUME_MS, 'allo ?')]).toEqual([reason, true]);
      expect([reason, can(reason, HANDOFF_IDLE_RESUME_MS, null)]).toEqual([reason, true]); // a photo after the delay
    }
  });
  it('the customer asked for the team: only the idle delay', () => {
    for (const reason of ['customer_request', 'refund', 'complaint', 'angry', 'keyword', 'order_limits']) {
      expect([reason, can(reason, 60_000, 'bonjour')]).toEqual([reason, false]);
      expect([reason, can(reason, HANDOFF_IDLE_RESUME_MS + 1, 'toujours là ?')]).toEqual([reason, true]);
    }
  });
  it('kept handoffs never come back on their own; an AI failure after 2 min (A3)', () => {
    for (const reason of ['manual', 'abuse_guard', 'credits_exhausted', 'quota_exceeded', 'risky_client']) expect([reason, can(reason, 24 * 3_600_000, 'salam')]).toEqual([reason, false]);
    expect(can('ai_error', AI_ERROR_RETRY_AFTER_MS - 1, 'salam')).toBe(false);
    expect(can('ai_error', AI_ERROR_RETRY_AFTER_MS, 'prix ?')).toBe(true);
  });
  it('a member paused the AI, or the handoff has no date / reason ⇒ never', () => {
    expect(can('off_catalogue', HANDOFF_IDLE_RESUME_MS, 'salam', { aiPausedById: 'u1' })).toBe(false);
    expect(svc.resumableAfterHandoff({ handoffReason: 'other', handoffAt: null }, 'salam', now)).toBe(false);
    expect(can(null, HANDOFF_IDLE_RESUME_MS, 'salam')).toBe(false);
  });
});
