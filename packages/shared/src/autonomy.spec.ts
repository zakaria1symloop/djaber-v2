import { describe, expect, it } from 'vitest';
import { agentAutonomy, autonomyPct, autonomyTone } from './autonomy';

describe('« Autonomie de l\'IA » (owner decision 26/11)', () => {
  it('round(100 × (conversations − hand-offs of the AI) / conversations)', () => {
    expect(autonomyPct(46, 4)).toBe(91);
    expect(autonomyPct(50, 4)).toBe(92);
    expect(autonomyPct(3, 1)).toBe(67);
    expect(autonomyPct(2, 1)).toBe(50);
    expect(autonomyPct(10, 0)).toBe(100);
    expect(autonomyPct(10, 10)).toBe(0);
  });

  it('null when the agent had no conversation', () => {
    expect(autonomyPct(0, 0)).toBeNull();
    expect(autonomyPct(0, 3)).toBeNull();
    expect(autonomyPct(Number.NaN, 0)).toBeNull();
  });

  it('never leaves 0–100: more hand-offs than conversations, a negative count', () => {
    expect(autonomyPct(4, 9)).toBe(0);
    expect(autonomyPct(4, -2)).toBe(100);
  });

  it('one decimal for the screens that already showed one (same formula)', () => {
    expect(autonomyPct(3, 1, 1)).toBe(66.7);
    expect(autonomyPct(2, 1, 1)).toBe(50);
    expect(autonomyPct(0, 0, 1)).toBeNull();
  });

  it('the block of the agent DTO', () => {
    expect(agentAutonomy(46, 4)).toEqual({ pct: 91, conversations: 46, handoffs: 4, days: 30 });
    expect(agentAutonomy(0, 0)).toEqual({ pct: null, conversations: 0, handoffs: 0, days: 30 });
  });

  it('tone: ≥ 90 success, 70–89 warning, < 70 danger, nothing yet neutral', () => {
    expect(autonomyTone(100)).toBe('success');
    expect(autonomyTone(90)).toBe('success');
    expect(autonomyTone(89)).toBe('warning');
    expect(autonomyTone(70)).toBe('warning');
    expect(autonomyTone(69)).toBe('danger');
    expect(autonomyTone(0)).toBe('danger');
    expect(autonomyTone(null)).toBe('neutral');
  });
});
