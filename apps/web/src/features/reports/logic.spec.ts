import { REPORT_DEFINITIONS, SIMPLE_MODE_REPORTS } from '@djaber/shared';
import { describe, expect, it } from 'vitest';
import type { JobDto } from '@/lib/jobs';
import { cellText, chartForm, columnHeader, daysLeft, jobView, rowHref, visibleColumns } from './logic';

const t = Object.assign((key: string, p?: Record<string, string | number>) => (p ? `${key}(${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(',')})` : key), { has: (k: string) => k.startsWith('enum.') || k.startsWith('report.') });
const NOW = Date.parse('2026-10-05T10:00:00Z');
const job = (o: Partial<JobDto>): JobDto => ({ id: 'j1', kind: 'export', status: 'running', progress: 64, total: 12480, result: null, resultUrl: null, error: null, createdAt: '2026-10-05T09:00:00Z', updatedAt: '2026-10-05T09:00:00Z', expiresAt: null, ...o });

describe('Exports récents rows (12 §24, AT-RPT-01)', () => {
  const result = { kind: 'report', reportKey: 'inventory_variances', from: '2026-09-01', to: '2026-10-05', format: 'xlsx', rows: 12480 };
  it('EN COURS n % with the report, the period and the format', () => {
    const v = jobView(job({ result }), t, 'fr', NOW);
    expect(v.state).toBe('running');
    expect(v.pill).toBe('reports.jobs.running(pct=64)');
    expect(v.title).toMatch(/^report\.inventory_variances\.title · 01 sept\.? → 05 oct\.? · XLSX$/);
    expect(v.meta).toBe('reports.jobs.rows(count=12480)');
  });
  it('PRÊT · expire dans n j, then EXPIRÉ', () => {
    expect(jobView(job({ status: 'done', result, expiresAt: '2026-10-11T09:00:00Z', resultUrl: 'u' }), t, 'fr', NOW).pill).toBe('reports.jobs.ready(days=6)');
    expect(jobView(job({ status: 'done', result, expiresAt: '2026-10-04T09:00:00Z' }), t, 'fr', NOW).state).toBe('expired');
    expect(daysLeft('2026-10-06T09:00:00Z', NOW)).toBe(1);
  });
  it('ÉCHEC with the error code; ANNULÉ; generic exports', () => {
    expect(jobView(job({ status: 'failed', error: { code: 'REPORT_EXPORT_FAILED', message: 'x', ref: 'r' } as JobDto['error'] }), t, 'fr', NOW).pill).toBe('reports.jobs.failed(code=REPORT_EXPORT_FAILED)');
    expect(jobView(job({ status: 'cancelled' }), t, 'fr', NOW).state).toBe('cancelled');
    const g = jobView(job({ status: 'done', total: null }), t, 'fr', NOW);
    expect(g.title).toMatch(/^reports\.jobs\.generic/);
    expect(g.meta).toBeNull();
    // snapshot report: no period
    expect(jobView(job({ result: { ...result, from: null, to: null } }), t, 'fr', NOW).title).toContain('reports.jobs.snapshot');
  });
});

describe('report template cells', () => {
  const def = REPORT_DEFINITIONS.sales_by_product;
  it('hides cost / margin columns in simple stock mode', () => {
    expect(visibleColumns(def, 'simple').map((c) => c.key)).not.toContain('margin');
    expect(visibleColumns(def, 'advanced').map((c) => c.key)).toContain('margin');
  });
  it('formats each column type and links rows', () => {
    const col = (key: string) => def.columns.find((c) => c.key === key)!;
    expect(cellText(col('revenue'), 96000, t, 'fr')).toBe('96 000');
    expect(cellText(col('marginPct'), 46.7, t, 'fr')).toBe('46,7 %');
    expect(cellText(col('product'), null, t, 'fr')).toBe('—');
    const pay = REPORT_DEFINITIONS.payments.columns.find((c) => c.key === 'method')!;
    // UX-052: « Espèces » for cash at the counter, « COD » for cash collected on an order
    expect(cellText(pay, 'cash', t, 'fr')).toBe('report.paymentMethod.cash');
    expect(cellText(pay, 'cod', t, 'fr')).toBe('report.paymentMethod.cod');
    expect(columnHeader(col('revenue'), t)).toBe('report.col.revenue (DA)');
    expect(rowHref({ _ref: { type: 'product', id: 'p1' } })).toBe('/products/p1');
    expect(rowHref({ _ref: { type: 'supplier', id: 's1' } })).toBe('/suppliers?sheet=s1');
    expect(rowHref({})).toBeNull();
  });
  it('picks the chart form of a report', () => {
    expect(chartForm(REPORT_DEFINITIONS.sales_by_period)).toBe('time');
    expect(chartForm(REPORT_DEFINITIONS.sales_by_category)).toBe('donut');
    expect(chartForm(REPORT_DEFINITIONS.sales_by_product)).toBe('ranking');
    expect(chartForm(REPORT_DEFINITIONS.cash_register)).toBeNull();
    expect(SIMPLE_MODE_REPORTS).toHaveLength(9);
  });
});
