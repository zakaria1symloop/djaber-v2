// Journey retest R7 (17/11): the wilayas and communes (reference data, the same for every workspace), read once per process,
// to tell whether a customer text names a place — R7-4 (create_order is not offered while no wilaya and no address was
// given: `create_order { wilayaId: 1 }` was sent as a probe) and R7-5 (« Vous livrez à Blida ? » gets the fee).
import { prisma } from '@djaber/db';
import { matchWilaya, placeFold } from './tool-registry';
import { articleless, foldText } from './wilaya-aliases';
import { offCatalogueWords, productWanted, teamOnlyRequest } from '../product-named';

export type PlaceWilaya = { id: number; code: string; nameFr: string; nameAr: string };
export type PlaceCommune = { wilayaId: number; nameFr: string; nameAr: string };
export type PlaceIndex = { wilayas: PlaceWilaya[]; communes: { wilayaId: number; key: string; bare: string }[] };

let cache: Promise<PlaceIndex> | null = null;
/** The reference lists, cached for the process (a failed read is retried next time). */
export const placeIndex = (): Promise<PlaceIndex> => {
  cache ??= Promise.all([prisma.wilaya.findMany({ select: { id: true, code: true, nameFr: true, nameAr: true } }), prisma.commune.findMany({ select: { wilayaId: true, nameFr: true, nameAr: true } })])
    .then(([wilayas, communes]) => buildPlaceIndex(wilayas, communes))
    .catch((e: unknown) => {
      cache = null;
      throw e;
    });
  return cache;
};
/** Tests: forget the cached lists. */
export const resetPlaceIndex = (): void => {
  cache = null;
};
/**
 * journey retest R13-4 (18/11): bare commune names (the Latin article « El / Al » dropped) that are everyday words or first names /
 * surnames — « Je voudrais le sac à main cuir marron » named « El Main » (Bordj Bou Arreridj), so create_order was offered with no
 * wilaya given and sent as a probe (`wilayaId 1`, refused). They match only with their article.
 */
const COMMON_BARE = new Set(['main', 'maine', 'bordj', 'oued', 'hassi', 'khemis', 'marsa', 'achour', 'hamel', 'hachem', 'kerma', 'hadjar', 'hamma', 'alia', 'amra', 'amria', 'omaria', 'karimia', 'djazia', 'azizia', 'milia', 'tarf', 'kala', 'euch', 'achir', 'biar', 'ogla', 'ancor', 'ancer', 'aioun', 'biodh', 'attaf', 'messaid', 'mokrani']);
/** Pure: the index of these lists (commune names folded, 4 letters or more, longest first). */
export const buildPlaceIndex = (wilayas: PlaceWilaya[], communes: PlaceCommune[]): PlaceIndex => ({
  wilayas,
  communes: communes
    .flatMap((c) => [c.nameFr, c.nameAr].map((n) => ({ wilayaId: c.wilayaId, key: placeFold(n), bare: COMMON_BARE.has(articleless(placeFold(n))) ? placeFold(n) : articleless(placeFold(n)) })))
    .filter((c) => c.key.replace(/\s/g, '').length >= 4)
    .sort((a, b) => b.key.length - a.key.length),
});
/** The wilaya a text names — its name or a known spelling (`matchWilaya`), else the wilaya of a commune it names. */
export const wilayaIn = (idx: PlaceIndex, text: string): PlaceWilaya | null => {
  if (!/\p{L}/u.test(text)) return null;
  const w = matchWilaya(idx.wilayas, text);
  if (w) return w;
  const padded = ` ${placeFold(text)} `;
  // journey retest R12-1 (17/11): with or without the article (« Khroub », « … ، الخروب »)
  const bare = ` ${articleless(placeFold(text))} `;
  const c = idx.communes.find((x) => padded.includes(` ${x.key} `)) ?? idx.communes.find((x) => x.bare.replace(/\s/g, '').length >= 4 && bare.includes(` ${x.bare} `));
  return c ? (idx.wilayas.find((x) => x.id === c.wilayaId) ?? null) : null;
};
/** Words that go with a place name and name no street (« wilaya de », « commune », « centre », « ana f », « je suis à »). */
// journey retest R17-1 (18/11): and a greeting with it (« Bonjour, j'habite à Sétif, El Eulma », « slm, ana f Bab Ezzouar », « السلام عليكم، انا من سطيف »)
const PLACE_ONLY_FILLERS = new Set(['wilaya', 'commune', 'daira', 'baladiya', 'de', 'du', 'des', 'd', 'la', 'le', 'l', 'a', 'au', 'en', 'w', 'f', 'fi', 'el', 'al', 'centre', 'center', 'ville', 'city', 'et', 'and', 'ana', 'je', 'suis', 'j', 'habite', 'nseken', 'saken', 'sakna', 'men', 'mn', 'from', 'in', 'i', 'live', 'at', 'chez', 'moi', 'pour', 'svp', 'stp', 'please', 'merci', 'ولايه', 'بلديه', 'في', 'ب', 'و', 'من', 'انا', 'نسكن', 'ساكن', 'ساكنه', 'وسط', 'مدينه', 'المدينه', 'bonjour', 'bonsoir', 'salut', 'salam', 'slm', 'salem', 'hello', 'hi', 'cc', 'coucou', 'السلام', 'عليكم', 'سلام', 'مرحبا', 'اهلا'].map((w) => foldText(w)));
/**
 * journey retest R17-1 (18/11): the text without the wilaya / commune names it holds (folded, `placeFold`) — what is left may name a
 * product (`offCatalogueWords`): « Bonjour, j'habite à Sétif, El Eulma » ⇒ « bonjour j habite a » (no product word).
 */
export const withoutPlaceNames = (idx: PlaceIndex, text: string): string => {
  let w = ` ${placeFold(text)} `;
  const names = [...new Set([...idx.wilayas.flatMap((x) => [placeFold(x.nameFr), placeFold(x.nameAr)]), ...idx.communes.flatMap((c) => [c.key, c.bare])])].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const n of names) if (w.includes(` ${n} `)) w = w.split(` ${n} `).join(' ');
  return w.trim();
};
/**
 * journey retest R8-4 (17/11): the message only names a wilaya and / or a commune (« Sétif, El Eulma », « ana f Bab Ezzouar »)
 * — no street, building, landmark or other word. On such a message with no address yet, create_order can only be refused.
 */
export const placeOnlyMessage = (idx: PlaceIndex, text: string): boolean => {
  if (!wilayaIn(idx, text)) return false;
  let w = ` ${placeFold(text)} `;
  const names = [...new Set([...idx.wilayas.flatMap((x) => [placeFold(x.nameFr), placeFold(x.nameAr)]), ...idx.communes.map((c) => c.key)])].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const n of names) if (w.includes(` ${n} `)) w = w.split(` ${n} `).join(' ');
  return w.trim().split(/\s+/).filter((x) => x && !PLACE_ONLY_FILLERS.has(x)).length === 0;
};
/**
 * journey retest R17-1 (18/11): the words of the customer's message that may name a product the shop lacks (`offCatalogueWords`), the
 * wilaya / commune names taken out. Undefined when there is nothing to decide (a request only the team can quote, a product wanted or
 * asked for — the judge's other rules answer it — or no word at all) and when the lists cannot be read (the judge then reads the message
 * without them).
 */
export const offCatalogueWordsOf = async (text: string): Promise<string[] | undefined> => {
  if (teamOnlyRequest(text) || productWanted(text)) return undefined;
  const plain = offCatalogueWords(text);
  if (!plain.length) return plain;
  try {
    const idx = await placeIndex();
    return offCatalogueWords(text, (t) => withoutPlaceNames(idx, t));
  } catch {
    return undefined;
  }
};
/**
 * R7-4: one of the customer's messages names a wilaya (or a commune of one), or writes « wilaya 16 » — each message on its own
 * line, as `wilayaNamed` reads them.
 */
export const placeNamedIn = (idx: PlaceIndex, history: string): boolean =>
  /(?<![\p{L}\p{N}])(?:wilaya|ولاية)\s*(?:n°|no|رقم)?\s*\d{1,2}(?!\p{N})/iu.test(history) || history.split(/\n+/).some((l) => !!wilayaIn(idx, l.trim()));
