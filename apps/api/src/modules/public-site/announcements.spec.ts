// UX-005 (tester report 2026-10-21) — who an announcement reaches: the admin editor's `scope` and the data model's
// `planSlugs` / `workspaceIds` give one workspace filter, shared by the publication notification and the merchant banner.
import { notificationDeepLink } from '../notifications/notification.catalog';
import { announcementTargetWhere, isForEveryone } from './announcements.service';

describe('announcement target', () => {
  it('no target / scope all ⇒ every workspace (also the public site)', () => {
    for (const t of [null, {}, { scope: 'all' }, { planSlugs: [], workspaceIds: [] }]) {
      expect(announcementTargetWhere(t)).toEqual({});
      expect(isForEveryone(t)).toBe(true);
    }
  });

  it('scope paid / free / trial ⇒ the live subscription decides (it was ignored at publication)', () => {
    expect(announcementTargetWhere({ scope: 'trial' })).toEqual({ AND: [{ subscriptions: { some: { status: 'trial' } } }] });
    expect(announcementTargetWhere({ scope: 'paid' })).toEqual({ AND: [{ subscriptions: { some: { status: { in: ['active', 'dunning'] }, plan: { priceMonthly: { gt: 0 } } } } }] });
    expect(announcementTargetWhere({ scope: 'free' })).toEqual({ AND: [{ subscriptions: { some: { status: { in: ['active', 'dunning'] }, plan: { priceMonthly: 0 } } } }] });
    expect(isForEveryone({ scope: 'paid' })).toBe(false);
  });

  it('plans and workspaces add up with the scope', () => {
    const w = announcementTargetWhere({ scope: 'paid', planSlugs: ['pro'], workspaceIds: ['w1'] }) as { AND: unknown[] };
    expect(w.AND).toHaveLength(3);
    expect(w.AND[0]).toEqual({ id: { in: ['w1'] } });
  });

  it('the notification opens the announcement on the notifications page', () => {
    expect(notificationDeepLink('platform_announcement', { cmsEntryId: 'a1' }).web).toBe('/notifications?announcement=a1');
    expect(notificationDeepLink('platform_announcement', {}).web).toBe('/notifications');
  });
});
