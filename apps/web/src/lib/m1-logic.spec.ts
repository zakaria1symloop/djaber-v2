// Pure logic of the M1 screens: permissions, countdowns, session workspace, checklist, relative time, reorder, nav filtering.
import { memberCan, MERCHANT_PERMISSIONS, passwordStrength, roleCan, sectionOf, type MerchantPermission } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { filterNav, FOOTER_NAV, MAIN_NAV } from '@/components/shell/nav';
import { greetingKey } from '@/features/home/greeting';
import { checkImage, IMAGE_MAX_BYTES } from '@/features/settings/image';
import { moveBy, moveTo } from '@/features/settings/reorder';
import { SETTINGS_NAV, visibleSettingsNav } from '@/features/settings/nav';
import { describeUserAgent } from '@/features/settings/user-agent';
import { ApiError } from './api';
import { conflictOf } from './conflict';
import { checklistOf } from './contracts';
import { formatClock, retryAfterSeconds, secondsLeft, secondsUntilIso } from './countdown';
import { pickWorkspaceId } from './workspace-pick';
import { daysUntil, relativeTime } from './time';

const err = (status: number, code: string, extra: Partial<ApiError['body']> = {}) =>
  new ApiError(status, { code, message: code, params: {}, fields: {}, details: null, ref: 'r', ...extra });

describe('permissions (01-nest-module-map §3.2 mirror)', () => {
  it('follows the role matrix', () => {
    expect(roleCan('owner', 'members.write')).toBe(true);
    expect(roleCan('admin', 'members.write')).toBe(false);
    expect(roleCan('admin', 'workspace.settings')).toBe(true);
    expect(roleCan('operator', 'workspace.settings')).toBe(false);
    expect(roleCan('operator', 'members.read')).toBe(true);
    expect(roleCan('operator', 'orders.money')).toBe(false);
    expect(roleCan('admin', 'workspace.delete')).toBe(false);
    expect(roleCan(null, 'inbox.read')).toBe(false);
  });
  it('keeps only the read keys for a read-only member (READ_ONLY_MEMBER)', () => {
    expect(memberCan({ role: 'admin', readOnly: true }, 'workspace.settings')).toBe(false);
    expect(memberCan({ role: 'admin', readOnly: true }, 'workspace.read')).toBe(true);
    expect(memberCan({ role: 'operator', readOnly: true }, 'orders.write')).toBe(false);
    expect(memberCan({ role: 'operator', readOnly: true }, 'orders.read')).toBe(true);
    expect(memberCan({ role: 'owner', readOnly: false }, 'workspace.delete')).toBe(true);
  });
  it('refuses the sections the Owner hid from the member (owner decision 2026-10-21)', () => {
    expect(memberCan({ role: 'operator', hiddenSections: ['orders'] }, 'orders.read')).toBe(false);
    expect(memberCan({ role: 'operator', hiddenSections: ['orders'] }, 'orders.write')).toBe(false);
    expect(memberCan({ role: 'operator', hiddenSections: ['orders'] }, 'clients.read')).toBe(true);
    expect(memberCan({ role: 'admin', hiddenSections: ['agents'] }, 'insights.manage')).toBe(false);
    expect(memberCan({ role: 'admin', hiddenSections: ['orders'] }, 'members.read')).toBe(true);
    expect(sectionOf('gds.write')).toBe('gds');
    expect(sectionOf('workspace.settings')).toBeNull();
  });
  it('has the same keys as the API table', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../../api/src/core/rbac/permission-matrix.ts', import.meta.url), 'utf8'));
    const block = src.slice(src.indexOf('MERCHANT_PERMISSIONS = {'), src.indexOf('} as const satisfies Record<string, readonly MembershipRole[]>'));
    const api = Object.fromEntries([...block.matchAll(/'([a-z_.]+)': (ALL|ADMIN_UP|OWNER)/g)].map((m) => [m[1], m[2]]));
    const group = (roles: readonly string[]) => (roles.length === 3 ? 'ALL' : roles.length === 2 ? 'ADMIN_UP' : 'OWNER');
    const web = Object.fromEntries(Object.entries(MERCHANT_PERMISSIONS).map(([k, v]) => [k, group(v)]));
    expect(web).toEqual(api);
  });
});

describe('sidebar and settings sub-nav', () => {
  const all = [...MAIN_NAV.flatMap((g) => g.items), ...FOOTER_NAV];
  const can = (role: 'owner' | 'admin' | 'operator') => (key: string) => roleCan(role, key as MerchantPermission);
  it('hides the advanced entries in simple mode (AT-ONB-02)', () => {
    const simple = filterNav(all, { stockMode: 'simple', can: can('owner') }).map((i) => i.key);
    expect(simple).toContain('nav.products');
    // "Produits · Services" (08-web-screens sidebar, CAT-11): the services list is in both modes
    expect(simple).toContain('nav.services');
    expect(simple).toContain('nav.categories');
    for (const k of ['nav.movements', 'nav.suppliers', 'nav.purchases', 'nav.sales', 'nav.cash', 'nav.inventory']) expect(simple).not.toContain(k);
    // GDS-10 "MODE SIMPLE": recommendations stay (restock / stock-out / agent subset), 03 LST-05; reports stay with the
    // 9 simple reports (12 §24, AT-RPT-01)
    expect(simple).toContain('nav.recommendations');
    expect(simple).toContain('nav.reports');
    const advanced = filterNav(all, { stockMode: 'advanced', can: can('owner') }).map((i) => i.key);
    expect(advanced).toContain('nav.purchases');
    expect(advanced).toContain('nav.reports');
  });
  it('hides the GDS entries from operators even in advanced mode', () => {
    const op = filterNav(all, { stockMode: 'advanced', can: can('operator') }).map((i) => i.key);
    expect(op).toContain('nav.movements');
    expect(op).not.toContain('nav.suppliers');
    expect(op).not.toContain('nav.reports');
  });
  it('filters the settings sub-nav per role (§2.2)', () => {
    const hrefs = (role: 'owner' | 'admin' | 'operator') => visibleSettingsNav((k) => roleCan(role, k)).map((i) => i.href);
    // Crédits: the balance is visible to every member (billing.read_credits), the ledger to Admin+
    expect(hrefs('operator')).toEqual(['/settings/profile', '/settings/members', '/settings/notifications', '/settings/security', '/settings/credits']);
    expect(hrefs('admin')).not.toContain('/settings/danger');
    expect(hrefs('admin')).toContain('/settings/workspace');
    expect(hrefs('owner')).toHaveLength(SETTINGS_NAV.length);
    // Plan & facturation (M9): Owner + Admin (`billing.read`), never Operators
    expect(hrefs('owner')).toContain('/settings/billing');
    expect(hrefs('admin')).toContain('/settings/billing');
    // Intégrations (M11): Owner + Admin (`integrations.manage`), never Operators
    expect(hrefs('owner')).toContain('/settings/integrations');
    expect(hrefs('admin')).toContain('/settings/integrations');
    expect(hrefs('operator')).not.toContain('/settings/integrations');
    expect(hrefs('owner')).toContain('/settings/credits');
  });
});

describe('countdowns', () => {
  it('formats m:ss', () => {
    expect(formatClock(299)).toBe('4:59');
    expect(formatClock(58)).toBe('0:58');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(900)).toBe('15:00');
  });
  it('reads retryAfter from a 429', () => {
    expect(retryAfterSeconds(err(429, 'RATE_LIMITED', { params: { retryAfter: 42 } }))).toBe(42);
    expect(retryAfterSeconds(err(429, 'RATE_LIMITED'), 60)).toBe(60);
    expect(retryAfterSeconds(err(401, 'AUTH_INVALID_CREDENTIALS'))).toBe(0);
    expect(retryAfterSeconds(new Error('network'))).toBe(0);
  });
  it('computes the seconds left', () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(9_000, 10_000)).toBe(0);
    expect(secondsLeft(null)).toBe(0);
    expect(secondsUntilIso('2026-10-11T10:00:42.000Z', Date.parse('2026-10-11T10:00:00.000Z'))).toBe(42);
    expect(secondsUntilIso('2026-10-11T09:00:00.000Z', Date.parse('2026-10-11T10:00:00.000Z'))).toBe(0);
    expect(secondsUntilIso(undefined)).toBe(0);
  });
});

describe('session workspace', () => {
  const m = (workspaceId: string) => ({ workspaceId, name: workspaceId, logoUrl: null, role: 'operator' as const, readOnly: false });
  it('prefers the stored choice, then the owned workspace, then the first membership', () => {
    const me = { ownedWorkspaceId: 'b', memberships: [m('a'), m('b'), m('c')] };
    expect(pickWorkspaceId(me, 'c')).toBe('c');
    expect(pickWorkspaceId(me, 'gone')).toBe('b');
    expect(pickWorkspaceId({ ownedWorkspaceId: null, memberships: [m('a')] }, null)).toBe('a');
    expect(pickWorkspaceId({ ownedWorkspaceId: null, memberships: [] }, 'a')).toBeNull();
    expect(pickWorkspaceId(null, 'a')).toBeNull();
  });
});

describe('Get Started checklist (ONB-02)', () => {
  it('maps the API keys to the four steps', () => {
    expect(checklistOf({ checklist: { channel: true, product: false, agent: false, order: true } })).toEqual({ channel: true, product: false, agent: false, sale: true });
    expect(checklistOf(undefined)).toEqual({ channel: false, product: false, agent: false, sale: false });
  });
});

describe('relative time', () => {
  const now = Date.parse('2026-10-11T12:00:00.000Z');
  it('uses days, hours and minutes', () => {
    expect(relativeTime('2026-10-09T12:00:00.000Z', 'fr', now)).toMatch(/2\s?j/);
    expect(relativeTime('2026-10-11T09:00:00.000Z', 'en', now)).toMatch(/3\s?hr?/);
    expect(relativeTime(null, 'fr', now)).toBe('—');
    expect(relativeTime('nope', 'fr', now)).toBe('—');
  });
  it('keeps Latin digits in Arabic', () => {
    expect(relativeTime('2026-10-06T12:00:00.000Z', 'ar', now)).toMatch(/5/);
  });
  it('counts the days until an instant', () => {
    expect(daysUntil('2026-10-16T12:00:00.000Z', now)).toBe(5);
    expect(daysUntil('2026-10-01T12:00:00.000Z', now)).toBe(0);
  });
});

describe('quick replies reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves by one position and ignores out-of-range moves', () => {
    expect(moveBy(ids, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveBy(ids, 'a', 1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveBy(ids, 'a', -1)).toBe(ids);
    expect(moveBy(ids, 'd', 1)).toBe(ids);
    expect(moveBy(ids, 'x', 1)).toBe(ids);
  });
  it('drops a row on another one', () => {
    expect(moveTo(ids, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveTo(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(ids, 'a', 'a')).toBe(ids);
  });
});

describe('misc', () => {
  it('extracts the 409 conflict details', () => {
    const c = conflictOf<{ version: number }>(err(409, 'CONFLICT', { details: { current: { version: 4 }, changedBy: { firstName: 'Amel', lastName: 'B.' }, changedAt: '2026-10-11T10:00:00Z' } }));
    expect(c).toEqual({ current: { version: 4 }, changedBy: 'Amel B.', changedAt: '2026-10-11T10:00:00Z' });
    expect(conflictOf(err(409, 'WORKSPACE_DELETION_SCHEDULED'))).toBeNull();
    expect(conflictOf(err(422, 'VALIDATION_ERROR'))).toBeNull();
  });
  it('checks images before the upload', () => {
    expect(checkImage({ type: 'image/png', size: 1000 })).toBeNull();
    expect(checkImage({ type: 'application/pdf', size: 1000 })).toBe('IMAGE_TYPE_INVALID');
    expect(checkImage({ type: 'image/jpeg', size: IMAGE_MAX_BYTES + 1 })).toBe('IMAGE_TOO_LARGE');
  });
  it('describes a session device', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('Safari · macOS');
    expect(describeUserAgent('Djaber/1.2.0 (iOS; iPhone 14)')).toBe('Djaber · iOS · iPhone 14');
    expect(describeUserAgent(null)).toBeNull();
  });
  it('scores password strength', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(2);
    expect(passwordStrength('abcdefghijk1')).toBe(3);
    expect(passwordStrength('Abcdefghijk1!')).toBe(4);
  });
  it('greets by the hour in Africa/Algiers', () => {
    expect(greetingKey(new Date('2026-10-11T08:00:00Z'))).toBe('home.greeting.morning'); // 09:00 in Algiers
    expect(greetingKey(new Date('2026-10-11T19:30:00Z'))).toBe('home.greeting.evening'); // 20:30
    expect(greetingKey(new Date('2026-10-11T03:00:00Z'))).toBe('home.greeting.evening'); // 04:00
  });
});
