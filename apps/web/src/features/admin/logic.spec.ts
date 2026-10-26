// M10 web-a — pure helpers of the admin shell: guard decision, impersonation clock, platform permission mirror,
// audit diff lines, reason rule, plan form rules.
import { algiersDayOf, platformCan } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import { decideAdmin } from '@/lib/guards';
import { impersonation, minutesLeft } from '@/lib/impersonation';
import { reasonOk } from './dialog-kit';
import { EMPTY_PLAN, hasOneLimit, yearlyDiscount } from './plans/form';
import { workspacePill } from './workspaces/status';

describe('decideAdmin (02 §2.3)', () => {
  const base = { pathname: '/admin/plans', search: '' };
  it('waits while loading, shows the expired / error states', () => {
    expect(decideAdmin({ ...base, status: 'loading', platformRole: null })).toEqual({ kind: 'wait' });
    expect(decideAdmin({ ...base, status: 'expired', platformRole: 'super_admin' })).toEqual({ kind: 'state', state: 'session-expired' });
    expect(decideAdmin({ ...base, status: 'error', platformRole: null })).toEqual({ kind: 'state', state: 'error' });
  });
  it('sends anonymous visitors to the login with the return path', () => {
    expect(decideAdmin({ ...base, status: 'anonymous', platformRole: null })).toEqual({ kind: 'redirect', to: '/login?returnTo=%2Fadmin%2Fplans' });
  });
  it('403 without a platform role, renders for every platform role (no workspace needed)', () => {
    expect(decideAdmin({ ...base, status: 'authenticated', platformRole: 'none' })).toEqual({ kind: 'state', state: 'forbidden' });
    for (const r of ['super_admin', 'support', 'moderator', 'finance', 'read']) expect(decideAdmin({ ...base, status: 'authenticated', platformRole: r })).toEqual({ kind: 'render' });
  });
});

describe('platform permission mirror (01 §3.2)', () => {
  it('every role reads every area; impersonation only super admin + support; credits support/finance', () => {
    for (const r of ['super_admin', 'support', 'moderator', 'finance', 'read']) expect(platformCan(r, 'admin.audit.read')).toBe(true);
    expect(platformCan('support', 'admin.workspaces.impersonate')).toBe(true);
    expect(platformCan('moderator', 'admin.workspaces.impersonate')).toBe(false);
    expect(platformCan('finance', 'admin.workspaces.credits')).toBe(true);
    expect(platformCan('read', 'admin.billing.write')).toBe(false);
    expect(platformCan('none', 'admin.overview.read')).toBe(false);
    expect(platformCan(null, 'admin.overview.read')).toBe(false);
  });
});

describe('read-only impersonation store (D21-bis)', () => {
  it('counts whole minutes left, never negative', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    expect(minutesLeft('2026-10-13T10:30:00Z', now)).toBe(30);
    expect(minutesLeft('2026-10-13T10:00:30Z', now)).toBe(1);
    expect(minutesLeft('2026-10-13T09:59:00Z', now)).toBe(0);
  });
  it('start → expired → clear; expiry only marks an active session', () => {
    const events: string[] = [];
    const off = impersonation.on((e) => events.push(e));
    impersonation.markExpired();
    expect(impersonation.isExpired()).toBe(false);
    impersonation.start({ sessionId: 's', token: 't', expiresAt: '2026-10-13T10:30:00Z', workspaceId: 'w', workspaceName: 'Boutique' });
    expect(impersonation.get()?.workspaceName).toBe('Boutique');
    impersonation.markExpired();
    expect(impersonation.isExpired()).toBe(true);
    impersonation.clear();
    expect(impersonation.get()).toBeNull();
    expect(impersonation.isExpired()).toBe(false);
    expect(events).toEqual(['changed', 'expired', 'changed', 'changed']);
    off();
  });
});

describe('admin form rules', () => {
  it('reason ≥ 10 characters (ADMIN_REASON_REQUIRED)', () => {
    expect(reasonOk('court')).toBe(false);
    expect(reasonOk('   123456789  ')).toBe(false);
    expect(reasonOk('Ticket #4821 vérifié')).toBe(true);
  });
  it('plan: at least one limit ≠ 0 (−1 = illimité), yearly discount shown', () => {
    expect(hasOneLimit({ ...EMPTY_PLAN, maxPages: '0', maxAgents: '0' })).toBe(false);
    expect(hasOneLimit({ ...EMPTY_PLAN, maxProducts: '-1' })).toBe(true);
    expect(yearlyDiscount({ ...EMPTY_PLAN, priceMonthly: '9900', priceYearly: '99000' })).toBe(17);
    expect(yearlyDiscount({ ...EMPTY_PLAN, priceMonthly: '', priceYearly: '99000' })).toBeNull();
  });
  it('workspace pill: SUSPENDU / SUPPRESSION win over the subscription state', () => {
    expect(workspacePill({ status: 'suspended', subscriptionStatus: 'active' }).key).toBe('enum.Workspace.status.suspended');
    expect(workspacePill({ status: 'active', subscriptionStatus: 'expired' }).key).toBe('enum.Subscription.status.expired');
  });
});

describe('promo code validity in the edit dialog (tester report 22/10 UX-028)', () => {
  it('a bound stored as Algiers midnight in UTC is shown as its Algiers day, never the day before', () => {
    expect(algiersDayOf('2026-10-21T23:00:00.000Z')).toBe('2026-10-22');
    expect(algiersDayOf('2026-10-29T22:59:59.000Z')).toBe('2026-10-29');
  });
});
