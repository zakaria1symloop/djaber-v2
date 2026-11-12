import { describe, expect, it } from 'vitest';
import { aiExclusion } from './ui';

// Report 12/11 (« casque »: IA « EXCLU » + « CONTESTATION » after « Ajouter à un agent »): the screens say why the AI does not offer it
describe('aiExclusion', () => {
  const p = (over: Record<string, unknown>) => ({ aiState: 'excluded', archived: false, isActive: true, moderation: { status: 'approved' }, ...over });
  it('gives the reason of an excluded product', () => {
    expect(aiExclusion(p({ moderation: { status: 'appealed' } }))).toBe('appealed');
    expect(aiExclusion(p({ moderation: { status: 'pending' } }))).toBe('pending');
    expect(aiExclusion(p({ moderation: { status: 'rejected' } }))).toBe('rejected');
    expect(aiExclusion(p({ isActive: false, moderation: { status: 'pending' } }))).toBe('inactive');
    expect(aiExclusion(p({ archived: true, isActive: false }))).toBe('archived');
  });
  it('nothing for a proposed product, or without a known cause', () => {
    expect(aiExclusion(p({ aiState: 'proposed' }))).toBeNull();
    expect(aiExclusion(p({ moderation: null }))).toBeNull();
    expect(aiExclusion({ aiState: 'excluded' })).toBeNull();
  });
});
