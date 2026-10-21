// Date fields of the filters (tester report 2026-10-20: every date filter reset when the year was typed): only a cleared
// field or a whole date with a real year is handed over; the half-typed years the browser reports stay in the field.
import { isCommittableDate } from '@djaber/ui';
import { describe, expect, it } from 'vitest';

describe('date field typing', () => {
  it('keeps the half-typed years in the field', () => {
    for (const v of ['0002-10-21', '0020-10-21', '0202-10-21', '2-10-21', '20261-10-21']) expect(isCommittableDate(v)).toBe(false);
  });
  it('hands over a whole date or a cleared field', () => {
    expect(isCommittableDate('2026-10-21')).toBe(true);
    expect(isCommittableDate('1999-12-31')).toBe(true);
    expect(isCommittableDate('')).toBe(true);
  });
});
