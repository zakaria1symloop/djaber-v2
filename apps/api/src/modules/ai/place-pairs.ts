// UX-104 reopened (tester 26/11 15:16): the agent's own question read « واش نوصلوها لوهران (Bab Ezzouar) ولا لبلاصة أخرى؟ » — a
// commune of Alger written in brackets after Oran. The order itself is protected (`create_order` refuses the pair); this removes
// the wrong pair from the text sent to the customer. Pure.
import { samePlace } from './tools/tool-registry';

export type PlaceRow = { nameFr: string; nameAr: string; wilayaId: number };
export type WilayaRow = { id: number; nameFr: string; nameAr: string };

/** « لوهران », « f Oran », « l'Oran »: the place name without the Arabic / arabizi prepositions glued to it. */
const bare = (w: string) => w.replace(/^(?:ل|ب|و|ف)(?=\p{Script=Arabic}{2,})/u, '').replace(/^(?:l'|d'|f|l)\s*/i, '');

// the name as written, then without a glued preposition (« باب » starts with ب and is not « ب + اب »)
const forms = (word: string) => [...new Set([word.trim(), bare(word.trim())])];
const wilayaOf = (wilayas: readonly WilayaRow[], word: string): WilayaRow | null =>
  forms(word).map((w) => wilayas.find((x) => samePlace(x.nameFr, w) || samePlace(x.nameAr, w))).find(Boolean) ?? null;
const communeWilayas = (communes: readonly PlaceRow[], name: string): number[] =>
  forms(name).map((n) => communes.filter((c) => samePlace(c.nameFr, n) || samePlace(c.nameAr, n)).map((c) => c.wilayaId)).find((ids) => ids.length) ?? [];

/**
 * « <wilaya> (<commune of another wilaya>) » and « <commune> (<wilaya it is not in>) »: the bracket is removed. A commune that also
 * exists in that wilaya (same name in two wilayas) is kept; a name of no list is kept (the customer's own word).
 */
export const dropWrongPlacePairs = (text: string, communes: readonly PlaceRow[], wilayas: readonly WilayaRow[]): string => {
  if (!text || !text.includes('(')) return text;
  return text.replace(/([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})\s*\(([^()]{2,40})\)/gu, (whole, before: string, inside: string) => {
    const words = before.trim().split(/\s+/);
    // the place right before the bracket: its last one, two or three words
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      const outer = words.slice(-n).join(' ');
      const w = wilayaOf(wilayas, outer);
      if (w) {
        const of = communeWilayas(communes, inside.trim());
        return of.length && !of.includes(w.id) ? before : whole;
      }
      const ofOuter = communeWilayas(communes, outer);
      if (ofOuter.length) {
        const inner = wilayaOf(wilayas, inside);
        return inner && !ofOuter.includes(inner.id) ? before : whole;
      }
    }
    return whole;
  });
};
