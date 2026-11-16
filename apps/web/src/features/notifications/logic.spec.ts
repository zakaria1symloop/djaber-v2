// Notification centre rules: deep-link mapping (REF — Deep-link map, 03-events §5.1), family ↔ types, filter ↔ URL.
import { NOTIFICATION_GROUPS, NotificationTypeValues } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, FAMILY_CHIPS, filterApiQuery, filterQueryString, groupOfType, isFiltered, notificationHref, parseFilter, toggleType, TYPE_GROUP, typeSlug, typesOfGroup, withGroup } from './logic';

const params = (qs: string) => new URLSearchParams(qs);

describe('notificationHref — deep link of a notification', () => {
  // one row per target of 03-events §5.1 (web target relative to /{locale})
  const TARGETS = [
    '/orders/0192f0a1-0000-7000-8000-000000000001',
    '/orders/0192f0a1-0000-7000-8000-000000000001#calls',
    '/orders/0192f0a1-0000-7000-8000-000000000001#delivery',
    '/orders/0192f0a1-0000-7000-8000-000000000001#payment',
    '/inbox/0192f0a1-0000-7000-8000-000000000002',
    '/agents/0192f0a1-0000-7000-8000-000000000003/insights',
    '/agents/0192f0a1-0000-7000-8000-000000000003',
    '/queue',
    '/products?lowStock=1',
    '/products?moderationStatus=approved',
    '/products/0192f0a1-0000-7000-8000-000000000004',
    '/delivery?tab=all&ids=0192f0a1-0000-7000-8000-000000000001&sheet=0192f0a1-0000-7000-8000-000000000006',
    '/delivery?job=abc',
    '/channels/0192f0a1-0000-7000-8000-000000000005',
    '/channels/0192f0a1-0000-7000-8000-000000000005/analysis',
    '/settings/billing',
    '/settings/credits',
    '/settings/members',
    '/settings/security',
    '/settings/danger',
    '/settings/integrations/sheets',
    '/settings/integrations/webhooks',
    '/products/import?job=abc',
    '/orders/import?job=abc',
    '/reports?job=abc',
    '/help/tickets/42',
    '/legal/terms',
    '/home',
    '/notifications',
  ];
  it.each(TARGETS)('keeps the in-app target %s (path, query and hash)', (web) => {
    expect(notificationHref(web)).toBe(web);
    expect(notificationHref(web, 'ar')).toBe(`/ar${web}`);
  });

  it('strips a locale prefix sent by the server', () => {
    expect(notificationHref('/fr/orders/1#calls')).toBe('/orders/1#calls');
    expect(notificationHref('/ar/inbox/2', 'en')).toBe('/en/inbox/2');
    expect(notificationHref('/en')).toBe('/');
    expect(notificationHref('/french/x')).toBe('/french/x');
  });

  const UNSAFE: (string | null | undefined)[] = [null, undefined, '', 'https://evil.example/orders/1', '//evil.example', 'javascript:alert(1)', 'djaber://orders/1', 'orders/1', '/\\evil.example', '/orders/1 2', '/fr//evil.example'];
  it.each(UNSAFE)('falls back to the list for %j', (web) => {
    expect(notificationHref(web)).toBe('/notifications');
  });
});

describe('families (filter chips of NTF-01)', () => {
  it('every in-app type has exactly one family, and only known families are used', () => {
    for (const [type, group] of Object.entries(TYPE_GROUP)) {
      expect(NotificationTypeValues).toContain(type);
      expect(NOTIFICATION_GROUPS).toContain(group);
    }
    // e-mail / push only types (03 §15: no in-app row) stay out of the filter
    for (const type of ['account_verify_reminder', 'workspace_deleted', 'account_deletion_confirmed', 'app_update_required', 'app_update_recommended']) expect(groupOfType(type)).toBeNull();
    expect(Object.keys(TYPE_GROUP)).toHaveLength(NotificationTypeValues.length - 5);
  });

  it('the 11 chips of the frame, in order', () => {
    expect(FAMILY_CHIPS.map((c) => c.group)).toEqual(['orders', 'queue', 'ai', 'stock', 'parcels', 'payments', 'pages', 'credits_plan', 'members', 'integrations', 'jobs', 'moderation']);
  });

  it('family → types, in enum order', () => {
    expect(typesOfGroup('stock')).toEqual(['stock_low', 'stock_out']);
    expect(typesOfGroup('queue')).toEqual(['conversation_handoff', 'conversation_needs_human_message', 'conversation_handoff_unattended', 'conversation_assigned']);
    expect(typesOfGroup('pages')).toEqual(['channel_needs_reconnect', 'channel_paused_by_plan', 'channel_approved']);
    expect(typesOfGroup('jobs')).toEqual(['job_finished', 'job_failed']);
    expect(typesOfGroup(null)).toHaveLength(Object.keys(TYPE_GROUP).length);
  });

  it('type → family and slug', () => {
    expect(groupOfType('order_ai_created')).toBe('orders');
    expect(groupOfType('credits_80')).toBe('credits_plan');
    expect(groupOfType('invoice_unpaid')).toBe('credits_plan');
    expect(groupOfType('nope')).toBeNull();
    expect(typeSlug('order_ai_created')).toBe('order.ai_created');
    expect(typeSlug('conversation_needs_human_message')).toBe('conversation.needs_human_message');
    expect(typeSlug('credits_80')).toBe('credits.80');
  });
});

describe('filter ↔ URL', () => {
  it('parses family, unread and types; unknown values are dropped', () => {
    expect(parseFilter(params(''))).toEqual(EMPTY_FILTER);
    expect(parseFilter(params('group=stock&unread=1&types=stock_low,stock_low,nope'))).toEqual({ group: 'stock', unread: true, types: ['stock_low'] });
    expect(parseFilter(params('group=zzz&unread=0'))).toEqual(EMPTY_FILTER);
    // a type of another family does not survive the family chip
    expect(parseFilter(params('group=stock&types=job_failed'))).toEqual({ group: 'stock', unread: false, types: [] });
    // e-mail only types cannot be filtered
    expect(parseFilter(params('types=workspace_deleted,job_failed')).types).toEqual(['job_failed']);
  });

  it('round-trips through the query string', () => {
    const f = { group: 'parcels' as const, unread: true, types: ['shipment_failed' as const, 'shipment_returned' as const] };
    expect(filterQueryString(f)).toBe('group=parcels&unread=1&types=shipment_failed%2Cshipment_returned');
    expect(parseFilter(params(filterQueryString(f)))).toEqual(f);
    expect(filterQueryString(EMPTY_FILTER)).toBe('');
  });

  it('API query: explicit types win over the family', () => {
    expect(filterApiQuery(EMPTY_FILTER)).toEqual({ types: undefined, group: undefined, unread: undefined });
    expect(filterApiQuery({ group: 'stock', unread: true, types: [] })).toEqual({ types: undefined, group: 'stock', unread: true });
    expect(filterApiQuery({ group: 'stock', unread: false, types: ['stock_out'] })).toEqual({ types: ['stock_out'], group: undefined, unread: undefined });
  });

  it('changing the family clears the type selection; types toggle', () => {
    const f = { group: 'stock' as const, unread: true, types: ['stock_low' as const] };
    expect(withGroup(f, 'jobs')).toEqual({ group: 'jobs', unread: true, types: [] });
    expect(toggleType(f, 'stock_out').types).toEqual(['stock_low', 'stock_out']);
    expect(toggleType(f, 'stock_low').types).toEqual([]);
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, unread: true })).toBe(true);
  });
});
