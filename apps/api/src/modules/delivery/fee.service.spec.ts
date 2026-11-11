// AT-ORD-09 fee quote (04 §4, DLV-01/02) and AT-DAT-01 periods in Africa/Algiers (04 §8).
import { periodRange } from '../../core/time/period';
import { algiersDay } from '../../core/time/algiers';
import { feeExplanation, quoteFee } from './fee.service';

const alger = { homePrice: 400, stopdeskPrice: 250, isActive: true, freeAbove: null };

describe('AT-ORD-09 delivery fee quote', () => {
  it('home 400, stop-desk 250 from the grid', () => {
    expect(quoteFee(alger, { wilayaId: 16, isStopdesk: false, subtotal: 3000, threshold: null })).toMatchObject({ fee: 400, base: 400, free: false, reason: 'grid', wilayaServed: true });
    expect(quoteFee(alger, { wilayaId: 16, isStopdesk: true, subtotal: 3000, threshold: null })).toMatchObject({ fee: 250, reason: 'grid' });
  });
  it('threshold 5000 and subtotal 6000 ⇒ 0 (home delivery only)', () => {
    expect(quoteFee(alger, { wilayaId: 16, isStopdesk: false, subtotal: 6000, threshold: 5000 })).toMatchObject({ fee: 0, base: 400, free: true, reason: 'free_threshold', freeFrom: 5000 });
    expect(quoteFee(alger, { wilayaId: 16, isStopdesk: true, subtotal: 6000, threshold: 5000 })).toMatchObject({ fee: 250, free: false });
    // the rule's own threshold wins over the workspace one
    expect(quoteFee({ ...alger, freeAbove: 7000 }, { wilayaId: 16, isStopdesk: false, subtotal: 6000, threshold: 5000 })).toMatchObject({ fee: 400, freeFrom: 7000 });
  });
  it('inactive or missing wilaya ⇒ not served; no stop-desk price ⇒ stop-desk unavailable', () => {
    expect(quoteFee({ ...alger, isActive: false }, { wilayaId: 16, isStopdesk: false, threshold: null })).toMatchObject({ wilayaServed: false, reason: 'not_served' });
    expect(quoteFee(null, { wilayaId: 16, isStopdesk: false, threshold: null })).toMatchObject({ wilayaServed: false });
    expect(quoteFee({ ...alger, stopdeskPrice: 0 }, { wilayaId: 16, isStopdesk: true, threshold: null })).toMatchObject({ reason: 'stopdesk_unavailable', stopdeskAvailable: false });
  });
  it('Admin override wins and is explained', () => {
    const q = quoteFee(alger, { wilayaId: 19, isStopdesk: false, subtotal: 6000, threshold: 5000, override: 300 });
    expect(q).toMatchObject({ fee: 300, reason: 'override' });
    expect(feeExplanation(q, 'Sétif')).toBe('GRILLE SÉTIF · DOMICILE 400 → 300 (MODIFIÉ)');
    expect(feeExplanation(quoteFee(alger, { wilayaId: 19, isStopdesk: false, subtotal: 6000, threshold: 5000 }), 'Sétif')).toBe('GRILLE SÉTIF · DOMICILE 400 → OFFERTE');
 
  });
  it('UX-046: the fee note follows the app language, wilaya name included', () => {
    const relay = quoteFee(alger, { wilayaId: 19, isStopdesk: true, threshold: null });
    const setif = { nameFr: 'Sétif', nameAr: 'سطيف' };
    expect(feeExplanation(relay, setif, 'fr')).toBe(`GRILLE SÉTIF · POINT RELAIS ${relay.base}`);
    expect(feeExplanation(relay, setif, 'en')).toBe(`SÉTIF FEE GRID · PICKUP POINT ${relay.base}`);
    expect(feeExplanation(relay, setif, 'ar')).toBe(`شبكة رسوم سطيف · نقطة استلام ${relay.base}`);
    expect(feeExplanation(quoteFee(alger, { wilayaId: 19, isStopdesk: false, subtotal: 6000, threshold: 5000 }), setif, 'ar')).toBe('شبكة رسوم سطيف · توصيل للمنزل 400 ← مجاني');
  });
});

describe('AT-DAT-01 periods use Africa/Algiers', () => {
  it('"today" at 23:30 UTC is already the next local day', () => {
    const now = new Date('2026-10-11T23:30:00Z'); // 00:30 on 12 Oct in Algiers
    expect(algiersDay(now)).toBe('2026-10-12');
    expect(periodRange({ period: 'today' }, now)).toEqual({ gte: new Date('2026-10-11T23:00:00Z'), lt: new Date('2026-10-12T23:00:00Z') });
  });
  it('a date-only `to` is the inclusive end of the local day', () => {
    expect(periodRange({ from: '2026-10-01', to: '2026-10-12' })).toEqual({ gte: new Date('2026-09-30T23:00:00Z'), lt: new Date('2026-10-12T23:00:00Z') });
  });
  it('last month and the 732-day limit', () => {
    expect(periodRange({ period: 'last_month' }, new Date('2026-01-15T12:00:00Z'))).toEqual({ gte: new Date('2025-11-30T23:00:00Z'), lt: new Date('2025-12-31T23:00:00Z') });
    expect(() => periodRange({ from: '2023-01-01', to: '2026-01-01' })).toThrow();
  });
});
