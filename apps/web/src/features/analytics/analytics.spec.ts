import { describe, expect, it } from 'vitest';
import { choroplethStep, wilayaGeometry, WILAYA_SEATS } from '../../../../../packages/ui/src/wilaya-geo';
import { bestPoint, dayLabel, decimal, formatValue, kpiDelta, rangeLabel } from './format';
import { customRangeError, parsePeriod, periodHref, periodQuery, periodSearch, rangeDays } from './period';

const params = (qs: string) => new URLSearchParams(qs);
const units = { s: 's', min: 'min', d: 'j' };

describe('analytics period (04 §8, 11 §7, 12 §24)', () => {
  it('defaults to 30 d with comparison and a clean URL', () => {
    const p = parsePeriod(params(''));
    expect(p).toEqual({ period: '30d', from: '', to: '', compare: true });
    expect(periodSearch(p)).toEqual([]);
    expect(periodQuery(p)).toEqual({ period: '30d', compare: 'previous' });
  });
  it('reads presets, custom ranges and "comparaison : aucune"', () => {
    expect(parsePeriod(params('period=90d&compare=none'))).toEqual({ period: '90d', from: '', to: '', compare: false });
    expect(periodQuery(parsePeriod(params('period=90d&compare=none')))).toEqual({ period: '90d', compare: 'none' });
    const c = parsePeriod(params('from=2026-09-05&to=2026-10-05'));
    expect(c.period).toBe('custom');
    expect(periodQuery(c)).toEqual({ from: '2026-09-05', to: '2026-10-05', compare: 'previous' });
    expect(periodSearch(c)).toEqual([
      ['period', 'custom'],
      ['from', '2026-09-05'],
      ['to', '2026-10-05'],
    ]);
    // an unknown preset falls back to the default; malformed dates are dropped
    expect(parsePeriod(params('period=decade')).period).toBe('30d');
    expect(parsePeriod(params('period=custom&from=05/09/2026')).from).toBe('');
  });
  it('checks a custom range like the API (AT-ANA-02)', () => {
    expect(customRangeError('', '')).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    expect(customRangeError('2026-09-05', '')).toBe('REPORT_CUSTOM_RANGE_REQUIRED');
    expect(customRangeError('2026-10-05', '2026-09-05')).toBe('INVALID_DATE_RANGE');
    expect(rangeDays('2024-10-05', '2026-10-05')).toBe(731);
    // 732 days is the maximum, 733 is refused
    expect(customRangeError('2024-10-04', '2026-10-05')).toBeNull();
    expect(customRangeError('2024-10-03', '2026-10-05')).toBe('REPORT_RANGE_TOO_LONG');
    expect(customRangeError('2026-10-05', '2026-10-05')).toBeNull();
  });
  it('builds tab links that keep the period', () => {
    expect(periodHref('/analytics/orders', parsePeriod(params('period=7d')))).toBe('/analytics/orders?period=7d');
    expect(periodHref('/analytics', parsePeriod(params('')), [['channelId', 'x']])).toBe('/analytics?channelId=x');
  });
});

describe('analytics figures (rule 11)', () => {
  it('formats money, rates and durations with Latin digits', () => {
    expect(formatValue(412300, 'money', 'fr', units)).toBe('412 300');
    expect(formatValue(68.4, 'pct', 'fr', units)).toBe('68,4 %');
    expect(formatValue(68, 'pct', 'ar', units)).toBe('68 %');
    expect(formatValue(1.9, 'seconds', 'en', units)).toBe('1.9 s');
    expect(formatValue(18.4, 'minutes', 'fr', units)).toBe('18 min');
    expect(formatValue(3.25, 'days', 'fr', units)).toBe('3,3 j');
    // full-test 15/11 ANALYTICS-08 / -09: the French decimal comma for dollars too; two hours and more in hours
    expect(formatValue(12.4, 'usd', 'fr', units).replace(/\s/g, ' ')).toBe('12,40 $');
    expect(formatValue(12.4, 'usd', 'en', units)).toBe('$12.40');
    expect(formatValue(2880, 'minutes', 'fr', { ...units, h: 'h' }).replace(/\s/g, ' ')).toBe('48 h');
    expect(formatValue(null, 'count', 'fr', units)).toBe('—');
    expect(decimal(-4.25, 'fr')).toBe('-4,3');
  });
  it('shows points for rates and percent otherwise; nothing without comparison', () => {
    expect(kpiDelta({ unit: 'pct', deltaPts: -3, deltaPct: 12 })).toEqual({ value: -3, unit: 'pts' });
    expect(kpiDelta({ unit: 'money', deltaPct: 18 })).toEqual({ value: 18, unit: '%' });
    expect(kpiDelta({ unit: 'count' })).toBeNull();
    expect(kpiDelta({ unit: 'pct', deltaPts: null })).toBeNull();
  });
  it('full-test 15/11 ANALYTICS-04: a range across years names both years', () => {
    expect(rangeLabel('2024-11-14', '2026-11-15', 'fr', { currentYear: '2026' })).toMatch(/^14 nov\.? 2024 → 15 nov\.? 2026$/);
    expect(rangeLabel('2026-10-14', '2026-11-15', 'fr', { currentYear: '2026' })).toMatch(/^14 oct\.? → 15 nov\.?$/);
    expect(rangeLabel('2026-10-14', '2026-11-15', 'fr', { currentYear: '2026', endYear: true })).toMatch(/^14 oct\.? → 15 nov\.? 2026$/);
  });
  it('labels days and finds the best day', () => {
    expect(dayLabel('2026-10-05', 'fr')).toMatch(/^05 oct/);
    expect(dayLabel('2026-10-05', 'ar')).toMatch(/05/);
    const pts = [
      { day: '2026-10-01', values: { revenue: 1000 } },
      { day: '2026-10-02', values: { revenue: 28400 } },
      { day: '2026-10-03', values: { revenue: 0 } },
    ];
    expect(bestPoint(pts, 'revenue')).toEqual({ day: '2026-10-02', value: 28400 });
    expect(bestPoint([{ day: '2026-10-01', values: { revenue: 0 } }], 'revenue')).toBeNull();
  });
});

describe('wilaya choropleth geometry', () => {
  it('draws one non-empty cell per wilaya (69)', () => {
    const g = wilayaGeometry();
    expect(Object.keys(WILAYA_SEATS)).toHaveLength(69);
    expect(g.shapes).toHaveLength(69);
    expect(g.shapes.every((s) => s.path.startsWith('M') && s.path.endsWith('Z'))).toBe(true);
    // the north is stretched: Alger sits above Tamanrasset and the map is taller than wide
    const seat = (code: number) => g.shapes.find((s) => s.code === code)!.seat;
    expect(seat(16)[1]).toBeLessThan(seat(11)[1]);
    expect(g.height).toBeGreaterThan(g.width);
  });
  it('buckets values on 5 sequential steps', () => {
    expect(choroplethStep(0, 10)).toBe(0);
    expect(choroplethStep(1, 10)).toBe(1);
    expect(choroplethStep(5, 10)).toBe(3);
    expect(choroplethStep(10, 10)).toBe(5);
    expect(choroplethStep(3, 0)).toBe(0);
  });
});
