// Stock dashboard / movements logic (GDS-01, GDS-05): Algiers days, time label, signed quantity, period presets, references.
import { describe, expect, it } from 'vitest';
import { activePeriod, actorName, addDays, algiersDay, formatSigned, movementTimeLabel, noteBeyondReference, periodRange, quantityTone, referenceHref, referenceKind, signedQuantity, withoutYear } from './logic';

describe('Algiers days', () => {
  it('uses Africa/Algiers (UTC+1), not UTC', () => {
    expect(algiersDay('2026-10-05T22:30:00.000Z')).toBe('2026-10-05');
    expect(algiersDay('2026-10-05T23:30:00.000Z')).toBe('2026-10-06');
  });
  it('adds days across months and years', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('movementTimeLabel', () => {
  const now = new Date('2026-10-05T11:00:00.000Z'); // 12:00 in Algiers
  it('shows the time for today', () => {
    expect(movementTimeLabel('2026-10-05T09:58:00.000Z', now)).toEqual({ kind: 'time', value: '10:58' });
    // 00:10 in Algiers is today, although still the 4th in UTC
    expect(movementTimeLabel('2026-10-04T23:10:00.000Z', now)).toEqual({ kind: 'time', value: '00:10' });
  });
  it('shows HIER for yesterday', () => {
    expect(movementTimeLabel('2026-10-04T16:40:00.000Z', now)).toEqual({ kind: 'yesterday' });
    expect(movementTimeLabel('2026-10-03T23:30:00.000Z', now)).toEqual({ kind: 'yesterday' });
  });
  it('shows the date before that', () => {
    expect(movementTimeLabel('2026-10-03T10:00:00.000Z', now)).toEqual({ kind: 'date' });
  });
  it('drops the year of a formatted date', () => {
    expect(withoutYear('05 oct. 2026 10:58')).toBe('05 oct. 10:58');
    expect(withoutYear('05 oct. 2026')).toBe('05 oct.');
  });
});

describe('signed quantity', () => {
  it('prefers after − before', () => {
    expect(signedQuantity({ quantity: 2, before: 14, after: 12 })).toBe(-2);
    expect(signedQuantity({ quantity: -2, before: 14, after: 12 })).toBe(-2);
    expect(signedQuantity({ quantity: 24, before: -10, after: 14 })).toBe(24);
  });
  it('falls back to the quantity when the stock did not move', () => {
    expect(signedQuantity({ quantity: -3, before: 5, after: 5 })).toBe(-3);
    expect(signedQuantity({ quantity: 0, before: 5, after: 5 })).toBe(0);
  });
  it('formats with a true minus sign and gives the colour', () => {
    expect(formatSigned(24)).toBe('+24');
    expect(formatSigned(-2)).toBe('−2');
    expect(formatSigned(0)).toBe('0');
    expect([quantityTone(1), quantityTone(-1), quantityTone(0)]).toEqual(['in', 'out', 'none']);
  });
});

describe('period presets', () => {
  it('computes inclusive ranges ending today', () => {
    expect(periodRange('7d', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(periodRange('30d', '2026-10-11')).toEqual({ from: '2026-09-12', to: '2026-10-11' });
    expect(periodRange('month', '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-11' });
  });
  it('recognises the active preset', () => {
    expect(activePeriod('', '', '2026-10-11')).toBeNull();
    expect(activePeriod('2026-10-05', '2026-10-11', '2026-10-11')).toBe('7d');
    expect(activePeriod('2026-09-12', '2026-10-11', '2026-10-11')).toBe('30d');
    expect(activePeriod('2026-10-01', '2026-10-11', '2026-10-11')).toBe('month');
    expect(activePeriod('2026-09-05', '2026-10-05', '2026-10-11')).toBe('custom');
    expect(activePeriod('2026-10-01', '', '2026-10-11')).toBe('custom');
    // on the 7th, "7 j" and "ce mois" are the same range
    expect(activePeriod('2026-10-01', '2026-10-07', '2026-10-07')).toBe('7d');
  });
});

describe('references and actors', () => {
  const product = { id: 'p1' } as never;
  it('links the product, the order, the sale, the purchase and the count (M7 carry-over)', () => {
    expect(referenceHref({ reference: { type: 'variant', id: 'v1', label: 'Noir · M' }, product })).toBe('/products/p1');
    expect(referenceHref({ reference: { type: 'order', id: 'o1', label: 'CMD-1042' }, product })).toBe('/orders/o1');
    expect(referenceHref({ reference: { type: 'sale', id: 's1', label: 'VNT-1001' }, product })).toBe('/sales/s1');
    expect(referenceHref({ reference: { type: 'purchase', id: 'a1', label: 'ACH-1001' }, product })).toBe('/purchases/a1');
    expect(referenceHref({ reference: { type: 'inventory', id: 'i1', label: 'INV-1' }, product })).toBe('/inventory/i1');
    expect(referenceHref({ reference: { type: 'manual', id: 'm', label: '' }, product })).toBeNull();
    expect(referenceHref({ reference: null, product })).toBeNull();
  });
  it('classifies reference labels', () => {
    expect(['order', 'sale', 'purchase', 'inventory'].map(referenceKind)).toEqual(['number', 'number', 'number', 'number']);
    expect(referenceKind('variant')).toBe('name');
    // journey J07r-5: « Inventaire · #INV-1 · INV-1 · 2 pulls M abîmés » — the reference is said once
    expect(noteBeyondReference('INV-1 · 2 pulls M abîmés', 'INV-1')).toBe('2 pulls M abîmés');
    expect(noteBeyondReference('#CMD-1024', 'CMD-1024')).toBeNull();
    expect(noteBeyondReference('INV-1', 'INV-1')).toBeNull();
    expect(noteBeyondReference('Casse', 'INV-1')).toBe('Casse');
    expect(noteBeyondReference('Casse', null)).toBe('Casse');
    expect(['manual', 'import', undefined].map(referenceKind)).toEqual(['type', 'type', 'type']);
  });
  it('names the actor, null for the system', () => {
    expect(actorName({ id: 'u', firstName: 'Nadia', lastName: 'F.', avatarUrl: null })).toBe('Nadia F.');
    expect(actorName(null)).toBeNull();
  });
});
