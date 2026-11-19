// journey J05v-3 / J05r-10 — commune names are normalised for DISPLAY only (shared `communeDisplayName`: « Ain-Sebt » ⇒
// « Ain Sebt », the seat « Setif » ⇒ « Sétif »). The stored `Commune.nameFr` stays the key of the courier commune maps
// (`CourierCommuneMap.externalCode`, sent as is to ZR Express / Yalidine), the stop-desk sync, the order import, the AI
// place index and the AI order tool. This proves, over the full seeded list, that a displayed name that comes back (typed
// by a merchant, copied from a screen or an export, repeated by the AI) still matches the same commune in every matcher.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { communeDisplayName, communeNameOf } from '@djaber/shared';
import { fold } from '../ai/tools/wilaya-aliases';
import { placeFold, samePlace } from '../ai/tools/tool-registry';
import { normalizeRaw } from './adapters/status-maps';
import { foldPlace } from './adapters/zrexpress-app.adapter';

const seed = <T>(file: string): T => JSON.parse(readFileSync(resolve(__dirname, '../../../../../packages/db/seeds/data', file), 'utf8')) as T;
const communes = seed<{ id: number; wilayaId: number; nameFr: string; nameAr: string }[]>('communes.json');
const wilayas = new Map(seed<{ id: number; nameFr: string; nameAr: string }[]>('wilayas.json').map((w) => [w.id, w]));

describe('commune display names keep every matcher working (full seeded list)', () => {
  const shown = communes.map((c) => ({ c, fr: communeDisplayName(c.nameFr, wilayas.get(c.wilayaId))!, ar: communeDisplayName(c.nameAr, wilayas.get(c.wilayaId))! }));

  it('order import / AI create_order (`fold`), AI place index (`placeFold` / `samePlace`), stop-desk sync (`normalizeRaw`), ZR Express / EcoTrack (`foldPlace`)', () => {
    for (const { c, fr, ar } of shown) {
      expect(fold(fr)).toBe(fold(c.nameFr));
      expect(fold(ar)).toBe(fold(c.nameAr));
      expect(placeFold(fr)).toBe(placeFold(c.nameFr));
      expect(samePlace(fr, c.nameFr)).toBe(true);
      expect(samePlace(ar, c.nameAr)).toBe(true);
      expect(normalizeRaw(fr)).toBe(normalizeRaw(c.nameFr));
      expect(foldPlace(fr)).toBe(foldPlace(c.nameFr));
    }
  });

  it('the display name still finds ONE commune of its wilaya (no two communes collapse into one shown name)', () => {
    const seen = new Map<string, number>();
    for (const { c, fr } of shown) {
      const k = `${c.wilayaId}:${fold(fr)}`;
      expect(seen.get(k) ?? c.id).toBe(c.id);
      seen.set(k, c.id);
    }
  });

  it('the courier payload keeps the stored name (communeNameOf is display only)', () => {
    const setif = communes.find((c) => c.wilayaId === 19 && c.nameFr === 'Setif')!;
    expect(communeNameOf({ commune: setif, wilaya: wilayas.get(19)!, communeText: null }, 'fr')).toBe('Sétif');
    expect(setif.nameFr).toBe('Setif');
  });
});
