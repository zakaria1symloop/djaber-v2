import { describe, expect, it } from 'vitest';
import { toAssignees } from './api';
import { decisionState, flaggedFields, formatDelay, formatScore, formatWaiting, normaliseField, priceGapPct, refusableFields, rejectReady, scoreBucketOf, scoreTone, tabCount, tabOf, tabQuery } from './logic';
import { ruleKey } from './rules-logic';

const stats = { pending: 23, overSla: 6, urgent: 2, appealsPending: 3, autoApproved7d: 412, rejected7d: 31, rejectedByReason: [], rejectionRatePct: 4.2, medianDelayMinutes: 38, agentPrompts: 1, suspensionProposed: [] };

describe('ADM-10 tabs', () => {
  it('maps the URL tab, todo being the default', () => {
    expect(tabOf(null)).toBe('todo');
    expect(tabOf('urgent')).toBe('urgent');
    expect(tabOf('nope')).toBe('todo');
  });
  it('gives each tab its API preset', () => {
    expect(tabQuery('todo')).toEqual({ status: ['pending'] });
    expect(tabQuery('urgent')).toMatchObject({ status: ['pending'], priority: 'urgent' });
    expect(tabQuery('prompts')).toEqual({ type: ['agent_prompt'] });
    expect(tabQuery('rejected')).toMatchObject({ status: ['rejected', 'appeal_rejected'], sort: '-submittedAt' });
  });
  it('reads the tab counts from the KPIs (« Auto-approuvés » = the 7-day KPI, PV 09/11)', () => {
    expect(tabCount('todo', stats)).toBe(23);
    expect(tabCount('appeals', stats)).toBe(3);
    expect(tabCount('rejected', stats)).toBe(31);
    expect(tabCount('sample', stats)).toBe(stats.autoApproved7d);
    expect(tabCount('todo', undefined)).toBeNull();
  });
});

describe('ADM-10 formatting', () => {
  it('formats the AI score with the locale decimal mark', () => {
    expect(formatScore(0.31, 'fr')).toBe('0,31');
    expect(formatScore(0.88, 'en')).toBe('0.88');
    expect(formatScore(null, 'fr')).toBe('—');
  });
  it('draws scores under 0.9 red, the others green', () => {
    expect(scoreTone(0.88)).toBe('danger');
    expect(scoreTone(0.9)).toBe('success');
    expect(scoreTone(null)).toBeUndefined();
  });
  it('formats waiting times and median delays', () => {
    expect(formatWaiting(160)).toBe('2 h 40');
    expect(formatWaiting(20)).toBe('0 h 20');
    expect(formatDelay(38)).toBe('38 min');
    expect(formatDelay(65)).toBe('1 h 05');
    expect(formatDelay(null)).toBe('—');
  });
  it('computes the gap with the market reference', () => {
    expect(priceGapPct(1800, 14000)).toBe(-87);
    expect(priceGapPct(1800, null)).toBeNull();
  });
  it('recognises a score bucket from the URL bounds', () => {
    expect(scoreBucketOf('0', '0.3')).toBe('low');
    expect(scoreBucketOf('0.9', '1')).toBe('auto');
    expect(scoreBucketOf('', '')).toBeNull();
  });
});

describe('ADM-10 decisions', () => {
  const pending = { status: 'pending' as const, actions: [] };
  it('follows the server descriptor when there is one', () => {
    expect(decisionState({ status: 'pending', actions: [{ key: 'approve', enabled: false, reasonCode: 'MODERATION_ITEM_ALREADY_DECIDED' }] as never }, 'approve', true)).toEqual({ enabled: false, reasonCode: 'MODERATION_ITEM_ALREADY_DECIDED' });
    expect(decisionState({ status: 'pending', actions: [{ key: 'request_changes', enabled: true }] as never }, 'request-changes', true)).toEqual({ enabled: true, reasonCode: undefined });
  });
  it('falls back on the role and the status', () => {
    expect(decisionState(pending, 'approve', false)).toEqual({ enabled: false, reasonCode: 'FORBIDDEN' });
    expect(decisionState(pending, 'reject', true)).toEqual({ enabled: true });
    expect(decisionState({ status: 'approved', actions: [] }, 'reject', true)).toEqual({ enabled: false, reasonCode: 'MODERATION_ITEM_ALREADY_DECIDED' });
  });
  it('uses the merchant vocabulary for refused fields', () => {
    expect(normaliseField('title')).toBe('name');
    expect(normaliseField('images.0')).toBe('image:1');
    expect(normaliseField('image:2')).toBe('image:2');
    expect(normaliseField('categoryId')).toBe('category');
    const item = { product: { images: [{ url: 'a', flag: 'LOGO' }, { url: 'b', flag: null }] } as never, aiFlags: [{ code: 'protected_brand', field: 'title', message: 'm' }, { code: 'misleading_price', field: 'price', message: 'm' }] };
    expect(flaggedFields(item)).toEqual(['name', 'price', 'image:1']);
    expect(refusableFields(item)).toEqual(['name', 'description', 'price', 'category', 'image:1', 'image:2']);
    expect(refusableFields({ product: null })).toEqual([]);
  });
  it('pre-ticks no picture for a flag on the images as a whole (single_image)', () => {
    const item = { product: { images: [{ url: 'a', flag: null }, { url: 'b', flag: null }] } as never, aiFlags: [{ code: 'counterfeit_wording', field: 'name', message: 'm' }, { code: 'single_image', field: 'images', message: '1' }] };
    expect(flaggedFields(item)).toEqual(['name']);
  });
  it('needs a reason and a message before a reject', () => {
    expect(rejectReady({ decision: 'counterfeit', message: 'Marque protégée', fields: [] })).toBe(true);
    expect(rejectReady({ decision: null, message: 'x', fields: [] })).toBe(false);
    expect(rejectReady({ decision: 'other', message: '  ', fields: [] })).toBe(false);
  });
});

describe('ADM-10 helpers', () => {
  it('keeps only the members who may decide', () => {
    expect(
      toAssignees([
        { userId: 'u1', firstName: 'Sofiane', lastName: 'B.', platformRole: 'moderator' },
        { id: 'u2', name: 'Lina', role: 'finance' },
        { user: { id: 'u3', firstName: 'Ali', lastName: 'K.' }, platformRole: 'super_admin' },
      ]),
    ).toEqual([
      { id: 'u1', name: 'Sofiane B.', role: 'moderator' },
      { id: 'u3', name: 'Ali K.', role: 'super_admin' },
    ]);
    expect(toAssignees({ members: [] })).toEqual([]);
    expect(toAssignees(null)).toEqual([]);
  });
  it('builds a rule key in the allowed alphabet', () => {
    expect(ruleKey('protected_brand', 'Dior Sauvage')).toBe('protected_brand.dior-sauvage');
    expect(ruleKey('blocked_word', 'arnaque !')).toBe('blocked_word.arnaque');
    expect(ruleKey('blocked_word', 'éàç')).toBe('blocked_word.eac');
  });
});
