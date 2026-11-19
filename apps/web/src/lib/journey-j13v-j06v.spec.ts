// journeys 19/11 J06v-1 / J13v — figure screens refreshed after a write; Arabic overview plurals in the web catalogue.
import { describe, expect, it, vi } from 'vitest';
import { getMessages } from '@djaber/shared';
import { FIGURE_KEYS, invalidateFigures } from './figures';
import { makeT } from './format-message';

describe('J06v-1: a write marks every figure screen stale', () => {
  it('covers Home, the reports and the statistics of the workspace', async () => {
    expect([...FIGURE_KEYS]).toEqual(['dashboard', 'reports', 'analytics']);
    const qc = { invalidateQueries: vi.fn(async () => undefined) };
    await invalidateFigures(qc as never, 'ws1');
    expect(qc.invalidateQueries.mock.calls.map((c) => (c as unknown as [{ queryKey: unknown[] }])[0].queryKey)).toEqual([
      ['ws1', 'dashboard'],
      ['ws1', 'reports'],
      ['ws1', 'analytics'],
    ]);
  });
});

describe('J13v-4: admin overview counts in Arabic', () => {
  const t = makeT('ar', getMessages('ar'));
  it('reads the dual, few and many forms', () => {
    expect(t('admin.overview.ai.unit.credits', { count: 528, n: '528' })).toBe('528 رصيدًا');
    expect(t('admin.overview.ai.unit.credits', { count: 2, n: '2' })).toBe('رصيدان');
    expect(t('adminMod.bulk.count', { count: 79 })).toBe('79 عنصرًا');
    expect(t('admin.overview.kpi.webhooksCtx', { minutes: 8, delays: 0 })).toBe('8 دقائق حوادث · لا تأخير في الطابور');
  });
});
