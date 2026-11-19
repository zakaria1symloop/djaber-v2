import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_WILAYA_IDS, communeDisplayName, communeNameOf, COURIER_WILAYA_COUNT, courierWilayaId, isWilayaId, isWilayaSeat, WILAYA_COUNT, WILAYA_PARENT, wilayasOfCourierCode } from './geo';
import { FeeQuoteQuerySchema } from './schemas/delivery';
import { wilayaCode } from './validators';

describe('wilayas (loi 26-06: 69 wilayas)', () => {
  it('69 ids, the 11 new ones (59–69) each carved out of one of the 58 historical wilayas', () => {
    expect(WILAYA_COUNT).toBe(69);
    expect(ALL_WILAYA_IDS).toHaveLength(69);
    expect(Object.keys(WILAYA_PARENT).map(Number)).toEqual([59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69]);
    for (const p of Object.values(WILAYA_PARENT)) expect(p).toBeLessThanOrEqual(COURIER_WILAYA_COUNT);
  });
  it('isWilayaId: 1…69 integers only', () => {
    expect([1, 16, 58, 59, 69].every(isWilayaId)).toBe(true);
    expect([0, 70, 16.5, '16', null].some(isWilayaId)).toBe(false);
  });
  it('couriers get the parent code for a new wilaya, the id itself otherwise', () => {
    expect(courierWilayaId(16)).toBe(16);
    expect(courierWilayaId(58)).toBe(58);
    expect(courierWilayaId(59)).toBe(3);
    expect(courierWilayaId(65)).toBe(17);
    expect(courierWilayaId(66)).toBe(17);
    expect(courierWilayaId(68)).toBe(28);
    expect(courierWilayaId(69)).toBe(32);
  });
  it('a courier code covers itself and the wilayas carved out of it', () => {
    expect(wilayasOfCourierCode(17)).toEqual([17, 65, 66]);
    expect(wilayasOfCourierCode(16)).toEqual([16]);
    expect(ALL_WILAYA_IDS.filter((w) => w <= COURIER_WILAYA_COUNT).flatMap(wilayasOfCourierCode).sort((a, b) => a - b)).toEqual([...ALL_WILAYA_IDS]);
  });
  it('the zod validators accept the new wilayas', () => {
    expect(FeeQuoteQuerySchema.safeParse({ wilayaId: '68' }).success).toBe(true);
    expect(FeeQuoteQuerySchema.safeParse({ wilayaId: '70' }).success).toBe(false);
    expect(wilayaCode.safeParse(69).success).toBe(true);
    expect(wilayaCode.safeParse(70).success).toBe(false);
  });
});

describe('journey J05v-3 — commune display names (stored names untouched)', () => {
  // the seeded list itself: one display name per commune, no hyphen, no double space, each seat in its wilaya's spelling
  const seed = <T>(file: string): T => JSON.parse(readFileSync(resolve(__dirname, '../../db/seeds/data', file), 'utf8')) as T;
  const communes = seed<{ id: number; wilayaId: number; nameFr: string; nameAr: string }[]>('communes.json');
  const wilayas = seed<{ id: number; nameFr: string; nameAr: string }[]>('wilayas.json');
  const byId = new Map(wilayas.map((w) => [w.id, w]));
  it('hyphens read as spaces, spaces collapsed, the seat takes the wilaya spelling', () => {
    expect(communeDisplayName('Ain-Sebt')).toBe('Ain Sebt');
    expect(communeDisplayName('Bir-El-Arch')).toBe('Bir El Arch');
    expect(communeDisplayName('Ain- Adden')).toBe('Ain Adden');
    expect(communeDisplayName('Beni  Bouattab')).toBe('Beni Bouattab');
    expect(communeDisplayName("Tizi N'bechar")).toBe("Tizi N'bechar");
    expect(communeDisplayName('Setif', byId.get(19))).toBe('Sétif');
    expect(communeDisplayName('Tizi-Ouzou', byId.get(15))).toBe('Tizi Ouzou');
    expect(communeDisplayName('El Eulma', byId.get(19))).toBe('El Eulma');
    expect(communeDisplayName('سطيف', byId.get(19))).toBe('سطيف');
    expect(communeDisplayName('  ')).toBeNull();
    expect(communeDisplayName(null)).toBeNull();
  });
  it('over the full seeded list: no hyphen / double space shown, and the display name folds to the stored name (every matcher still finds it)', () => {
    const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const c of communes) {
      const shown = communeDisplayName(c.nameFr, byId.get(c.wilayaId))!;
      expect(shown).not.toMatch(/-|\s{2}/);
      expect(fold(shown)).toBe(fold(c.nameFr));
      const w = byId.get(c.wilayaId)!;
      // Arabic: unchanged, or the wilaya's own spelling for its seat (« أفلو » in the wilaya « آفلو »)
      expect([c.nameAr.replace(/\s+/g, ' ').trim(), w.nameAr]).toContain(communeDisplayName(c.nameAr, w));
    }
    // the 19 seats spelled without their accents in the data (« Setif », « Bejaia », « Ghardaia »…)
    const seats = communes.filter((c) => isWilayaSeat(c.nameFr, byId.get(c.wilayaId)?.nameFr));
    expect(seats.length).toBeGreaterThanOrEqual(19);
    for (const c of seats) expect(communeDisplayName(c.nameFr, byId.get(c.wilayaId))).toBe(byId.get(c.wilayaId)!.nameFr);
  });
  it('communeNameOf: typed text first, the reader’s language; isWilayaSeat ignores accents, hyphens and spaces', () => {
    const sétif = byId.get(19)!;
    expect(communeNameOf({ communeText: null, commune: { nameFr: 'Ain-Sebt', nameAr: 'عين السبت' }, wilaya: sétif }, 'fr')).toBe('Ain Sebt');
    expect(communeNameOf({ communeText: null, commune: { nameFr: 'Ain-Sebt', nameAr: 'عين السبت' }, wilaya: sétif }, 'ar')).toBe('عين السبت');
    expect(communeNameOf({ communeText: 'setif', commune: null, wilaya: sétif }, 'fr')).toBe('Sétif');
    expect(communeNameOf({ communeText: null, commune: null, wilaya: sétif }, 'fr')).toBeNull();
    expect(isWilayaSeat('Setif', 'Sétif')).toBe(true);
    expect(isWilayaSeat('Tizi-Ouzou', 'Tizi Ouzou')).toBe(true);
    expect(isWilayaSeat('El Eulma', 'Sétif')).toBe(false);
    expect(isWilayaSeat(null, 'Sétif')).toBe(false);
  });
});
