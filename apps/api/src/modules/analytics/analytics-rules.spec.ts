// M8 unit rules: period resolution (04 §8 / 11 §7), mergeable daily figures (never incremented: rows are summed only at
// read time), histogram percentiles, report metadata consistency (23 reports, 9 in simple mode, every label an i18n key).
import { getMessages, REPORT_DEFINITIONS, REPORT_KEYS, SIMPLE_MODE_REPORTS, PNL_LINES } from '@djaber/shared';
import { AppException } from '../../core/errors/app.exception';
import { previousMonth } from '../gds/reports/report-schedule.service';
import { bucketOf, emptyDay, mergeInto, METRICS_VERSION, percentile, sumDays } from './day-metrics';
import { addDays, daysBetween, deltaPct, eachDay, pct, resolveRange } from './range';

const NOW = new Date('2026-10-13T08:00:00Z'); // 09:00 in Algiers
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppException ? e.code : String(e);
  }
  return null;
};

describe('resolveRange', () => {
  it('presets in Africa/Algiers days, previous = same length ending the day before', () => {
    expect(resolveRange({}, NOW)).toMatchObject({ period: '30d', from: '2026-09-14', to: '2026-10-13', days: 30, previous: { from: '2026-08-15', to: '2026-09-13' } });
    expect(resolveRange({ period: 'today' }, NOW)).toMatchObject({ from: '2026-10-13', to: '2026-10-13', days: 1, previous: { from: '2026-10-12', to: '2026-10-12' } });
    expect(resolveRange({ period: 'month' }, NOW)).toMatchObject({ from: '2026-10-01', to: '2026-10-13', days: 13 });
    expect(resolveRange({ period: 'last_month' }, NOW)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', days: 30 });
    expect(resolveRange({ period: 'year' }, NOW)).toMatchObject({ from: '2026-01-01', to: '2026-10-13' });
    expect(resolveRange({ period: '90d', compare: 'none' }, NOW)).toMatchObject({ days: 90, previous: null, compare: 'none' });
    // 23:30 UTC on the 12th is already the 13th in Algiers
    expect(resolveRange({ period: 'today' }, new Date('2026-10-12T23:30:00Z')).from).toBe('2026-10-13');
    expect(resolveRange({ period: 'last_month' }, new Date('2026-01-05T10:00:00Z'))).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('custom ranges: both dates, end ≥ start, ≤ 732 days; date-only `to` is inclusive', () => {
    const r = resolveRange({ from: '2026-01-01', to: '2026-01-31' }, NOW);
    expect(r).toMatchObject({ period: 'custom', days: 31 });
    expect(r.gte.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(codeOf(() => resolveRange({ period: 'custom' }, NOW))).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    expect(codeOf(() => resolveRange({ to: '2026-01-01' }, NOW))).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    expect(codeOf(() => resolveRange({ from: '2026-02-01', to: '2026-01-01' }, NOW))).toBe('INVALID_DATE_RANGE');
    expect(codeOf(() => resolveRange({ from: '2024-10-11', to: '2026-10-13' }, NOW))).toBe('REPORT_RANGE_TOO_LONG'); // 733 days
    expect(resolveRange({ from: '2024-10-12', to: '2026-10-12' }, NOW).days).toBe(731);
    expect(resolveRange({ from: '2024-10-13', to: '2026-10-14' }, NOW).days).toBe(732);
  });

  it('day helpers and deltas', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
    expect(eachDay('2026-10-11', '2026-10-13')).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(0, 1500)).toBe(-100);
    expect(deltaPct(5, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
    expect(previousMonth('2026-10-05')).toEqual({ month: '2026-09', from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonth('2026-03-01')).toEqual({ month: '2026-02', from: '2026-02-01', to: '2026-02-28' });
    expect(previousMonth('2026-01-10')).toEqual({ month: '2025-12', from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('daily figures', () => {
  it('merge sums numbers, arrays and nested maps without touching the inputs', () => {
    const a = emptyDay();
    a.orders.created = 2;
    a.revenue.sales = 1000;
    a.wilayas['16'] = { orders: 2, delivered: 1, returned: 0, revenue: 2000 };
    a.aiLatency[1] = 3;
    const b = emptyDay();
    b.orders.created = 3;
    b.wilayas['16'] = { orders: 1, delivered: 1, returned: 1, revenue: 500 };
    b.wilayas['31'] = { orders: 4, delivered: 0, returned: 0, revenue: 0 };
    b.aiLatency[1] = 2;
    const s = sumDays([a, b]);
    expect(s.orders.created).toBe(5);
    expect(s.revenue.sales).toBe(1000);
    expect(s.wilayas).toEqual({ '16': { orders: 3, delivered: 2, returned: 1, revenue: 2500 }, '31': { orders: 4, delivered: 0, returned: 0, revenue: 0 } });
    expect(s.aiLatency[1]).toBe(5);
    expect(s.v).toBe(METRICS_VERSION);
    expect(a.orders.created).toBe(2);
    expect(mergeInto(emptyDay(), null).orders.created).toBe(0);
  });

  it('histogram buckets and percentiles (upper edge of the bucket)', () => {
    expect(bucketOf('aiLatency', 0.4)).toBe(0);
    expect(bucketOf('aiLatency', 1.5)).toBe(1);
    expect(bucketOf('aiLatency', 500)).toBe(9);
    const h = emptyDay().aiLatency;
    h[1] = 6; // ≤ 2 s
    h[3] = 3; // ≤ 5 s
    h[9] = 1; // > 60 s
    expect(percentile('aiLatency', h, 0.5)).toBe(2);
    expect(percentile('aiLatency', h, 0.9)).toBe(5);
    expect(percentile('aiLatency', h, 0.95)).toBe(120);
    expect(percentile('aiLatency', emptyDay().aiLatency, 0.5)).toBeNull();
  });
});

describe('report definitions (GDS-10, D62)', () => {
  const fr = getMessages('fr');
  it('23 reports, 9 listed in simple mode, unique column keys, sortable default sort, every label translated', () => {
    expect(REPORT_KEYS).toHaveLength(23);
    expect(SIMPLE_MODE_REPORTS).toHaveLength(9);
    for (const key of REPORT_KEYS) {
      const d = REPORT_DEFINITIONS[key];
      expect(d.key).toBe(key);
      const cols = d.columns.map((c) => c.key);
      expect(new Set(cols).size).toBe(cols.length);
      expect(cols).toContain(d.defaultSort.replace(/^-/, ''));
      expect(fr[`report.${key}.title`]).toBeTruthy();
      expect(fr[`report.${key}.description`]).toBeTruthy();
      expect(fr[`report.group.${d.group}`]).toBeTruthy();
      for (const c of cols) expect(fr[`report.col.${c}`]).toBeTruthy();
      for (const k of d.kpis) expect(fr[`report.kpi.${k.key}`]).toBeTruthy();
      if (d.chart) for (const y of [d.chart.x, ...d.chart.y]) expect(cols).toContain(y);
      // simple mode never lists margins, purchases, cash or inventory reports
      if (d.simple) expect(['purchases_cash']).not.toContain(d.group);
    }
    for (const line of PNL_LINES) expect(fr[`report.line.${line}`]).toBeTruthy();
  });
});
