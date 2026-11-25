// Client (Boutique de Lalla) 25/11: the AI stayed paused on her conversations for 9 days — a pause the team puts ends 24 h after
// the team's last sign of life in the conversation.
import { MEMBER_PAUSE_IDLE_MS, memberPauseSince } from './conversation.service';

describe('memberPauseSince', () => {
  const d = (iso: string) => new Date(iso);

  it('counts from the latest of the pause, the hand-off, the last team message and the last AI message', () => {
    expect(memberPauseSince({ aiPausedAt: '2026-11-25T10:00:00.000Z' }, d('2026-11-20T08:00:00Z'), d('2026-11-16T07:51:00Z'))).toBe(Date.parse('2026-11-25T10:00:00.000Z'));
    expect(memberPauseSince({ handoffAt: '2026-11-20T16:28:00.000Z' }, null, d('2026-11-16T07:51:00Z'))).toBe(Date.parse('2026-11-20T16:28:00.000Z'));
    expect(memberPauseSince({}, d('2026-11-24T09:00:00Z'), d('2026-11-16T07:51:00Z'))).toBe(Date.parse('2026-11-24T09:00:00Z'));
  });

  it('her conversation: paused before the date was kept, last AI message 16/11 ⇒ long over on 25/11', () => {
    const since = memberPauseSince({ aiPausedById: 'u1' }, null, d('2026-11-16T07:51:10Z'));
    expect(Date.parse('2026-11-25T12:44:00Z') - since).toBeGreaterThan(MEMBER_PAUSE_IDLE_MS);
  });

  it('nothing to count from ⇒ 0 (the pause is kept)', () => {
    expect(memberPauseSince({}, null, null)).toBe(0);
  });
});
