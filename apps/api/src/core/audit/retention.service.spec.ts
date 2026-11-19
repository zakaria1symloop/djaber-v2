// 07-non-functional §4 retention periods: the cut-off arithmetic and the « purged stub is not a workspace » rule.
import { liveWorkspaceStatus } from '../tenancy/tenant.resolver';
import { AI_RUN_RETENTION_MONTHS, AI_TOOL_ARGS_MASK_MONTHS, AUDIT_RETENTION_MONTHS, JOB_RETENTION_DAYS, monthsAgo, SAFETY_RETENTION_MONTHS } from './retention.service';
import { INBOUND_EVENT_RETENTION_DAYS, PAYMENT_EVENT_PROVIDERS, PAYMENT_EVENT_RETENTION_DAYS } from '../../modules/messaging/data-lifecycle.service';

describe('retention periods (07-non-functional §4, 04 §9, 04 §13)', () => {
  it('match the retention table', () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
    expect(SAFETY_RETENTION_MONTHS).toBe(24); // reports and blocks kept 2 years
    expect(AI_TOOL_ARGS_MASK_MONTHS).toBe(12);
    expect(AI_RUN_RETENTION_MONTHS).toBe(24);
    expect(JOB_RETENTION_DAYS).toBe(90);
    expect(INBOUND_EVENT_RETENTION_DAYS).toBe(7);
    expect(PAYMENT_EVENT_RETENTION_DAYS).toBe(5 * 365);
    expect([...PAYMENT_EVENT_PROVIDERS].sort()).toEqual(['app_store', 'chargily', 'google_play']);
  });

  it('monthsAgo counts calendar months in UTC and never mutates its input', () => {
    const now = new Date('2026-11-19T01:00:00Z');
    expect(monthsAgo(now, 24).toISOString()).toBe('2024-11-19T01:00:00.000Z');
    expect(monthsAgo(now, 12).toISOString()).toBe('2025-11-19T01:00:00.000Z');
    expect(monthsAgo(new Date('2026-03-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z'); // no JS month overflow
    expect(monthsAgo(new Date('2028-02-29T10:00:00Z'), 24).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(now.toISOString()).toBe('2026-11-19T01:00:00.000Z');
  });

  it('a purged stub is not a workspace (404), the live statuses pass through', () => {
    for (const s of ['active', 'suspended', 'deletion_scheduled'] as const) expect(liveWorkspaceStatus(s)).toBe(s);
    expect(() => liveWorkspaceStatus('purged')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
