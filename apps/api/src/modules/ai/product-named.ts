// Journey retest R13 (18/11, docs/audit/journeys-2026-11-16/journeys/R13-ai-orders.md): does a customer text name a product of the
// shop's catalogue, or ask for / want a product at all, whatever the phrasing and the script. Pure.
//   R13-1 « Je voudrais le sac à main cuir marron » (a product the shop sells) was handed to the team as `off_catalogue`: the judge
//         knew only « vous avez / je cherche … » phrases and never looked at the catalogue.
//   R13-4 `lookup_order {}` on « nheb nechri zoudj tapis de prière » (a first product message).
//   R13-5 the out-of-stock product the customer asked for, the in-stock one the recap holds.
import { articleless, foldText } from './tools/wilaya-aliases';

/**
 * Words that want / ask for a product — fr, en, darija in Arabic script, arabizi — on a `foldText` text (punctuation of every
 * script is a space: « j'aimerais » ⇒ « j aimerais »). « je voudrais / je veux / j'aimerais / je prends / je commande / donnez-moi »,
 * « I want / I'd like / I need / give me », « nheb / n7eb / bghit / nechri », « نحب / بغيت / حاب / نشري / عطيني ».
 */
const PRODUCT_WANT =
  /(?<![\p{L}\p{N}])(?:je\s+(?:voudrais|veux|voulais|souhaite|souhaiterais|desire|desirerais|prends|prendrai|prendrais|commande|commanderais|cherche|recherche)|j\s?aimerais|j\s?aurais\s+voulu|donnez\s+moi|donne\s+moi|envoyez\s+moi|il\s+me\s+faut|i\s+(?:want|need|would\s+like|d\s+like|m\s+looking|am\s+looking|wanna)|i\s?d\s+like|can\s+i\s+(?:get|have|order|buy)|give\s+me|n(?:h|7)(?:e|a)bb?|nebghi|nbghi|bghit|habba|habbit|7abba|7abbit|nechri|nachri|nchri|n9der\s+nechri|ab3athli|ab3thli|و?(?:نحب|نبغي|بغيت|حاب|حابه|حابة|نشري|ابغي|أبغي|اريد|أريد|عطيني|ابعثلي|بعثلي))(?![\p{L}\p{N}])/u;
/** …unless the customer asks for what only the team can quote: wholesale, a quote, a custom order, a partnership. */
const TEAM_ONLY = /(?<![\p{L}])(?:gros|grossiste|revendeu\w*|wholesale|reseller|jumla|jomla|جمله|بالجمله|devis|quotation|sur\s+mesure|personnalis\w*|custom\w*|partenariat|partner\w*|collaboration)(?![\p{L}])/u;

/** journey retest R13-1: the message asks for a quote only the team can give (wholesale, a quote, a custom order, a partnership). */
export const teamOnlyRequest = (text: string): boolean => TEAM_ONLY.test(foldText(text));
/** journey retest R13-1 / R13-4: the message wants a product (« je voudrais … », « nheb … », « بغيت … », « I want … »), any punctuation. */
export const productWanted = (text: string): boolean => PRODUCT_WANT.test(foldText(text));

/** Words that name no product: articles, prepositions, want / ask words, greetings, politeness (folded, every script). */
const NAME_FILLERS = new Set(
  [
    'les', 'des', 'une', 'pour', 'avec', 'sans', 'dans', 'sur', 'par', 'est', 'son', 'ses', 'mon', 'mes', 'ton', 'tes', 'votre', 'vos', 'notre', 'nos', 'qui', 'que', 'quoi', 'combien', 'prix',
    'voudrais', 'veux', 'voulais', 'souhaite', 'souhaiterais', 'aimerais', 'prends', 'prendre', 'commande', 'commander', 'cherche', 'recherche', 'avez', 'vous', 'vendez', 'faites', 'donnez', 'envoyez', 'moi', 'bonjour', 'bonsoir', 'salut', 'merci', 'svp', 'stp', 'oui', 'non',
    'the', 'and', 'for', 'with', 'you', 'want', 'need', 'would', 'like', 'have', 'sell', 'give', 'please', 'hello', 'thanks', 'how', 'much',
    'ta3', 'dyal', 'men', 'fih', 'fiha', 'nheb', 'nhab', 'n7eb', 'n7ab', 'bghit', 'nebghi', 'nechri', 'nachri', 'nchri', 'kayen', 'kayn', 'kayna', '3andkom', 'salam', 'slm', 'wach', 'ch7al', 'chhal', 'bach', 'wahed', 'wahda', 'zoudj', 'zouj',
    'السلام', 'عليكم', 'سلام', 'نحب', 'بغيت', 'حاب', 'حابه', 'نشري', 'عطيني', 'عندكم', 'كاين', 'كاينه', 'واش', 'قداش', 'شحال', 'تاع', 'نتاع', 'واحد', 'وحده', 'زوج', 'جوج', 'من', 'في', 'على', 'مع',
  ].map((w) => foldText(w)),
);
/** « sacs » = « sac », « tapis » = « tapis »: a final s / x of a word of 4 letters or more is not compared. */
const stem = (w: string) => (w.length >= 4 ? w.replace(/[sx]$/u, '') : w);
/** The words of a text that may name a product (3 letters or more, no number, no filler), articles dropped, stemmed. */
export const productWords = (text: string): string[] =>
  articleless(foldText(text))
    .split(' ')
    .filter((w) => w.length >= 3 && !/^\d+$/u.test(w) && !NAME_FILLERS.has(w))
    .map(stem);

/**
 * Words that name no product the shop could lack: greetings, « I live in / I am », a name intro, delivery / address / order-field words
 * (folded, every script) — with NAME_FILLERS and the place names, what `offCatalogueWords` leaves out.
 */
const NOT_PRODUCT = new Set(
  [
    'bonjour', 'bjr', 'bonsoir', 'bsr', 'salut', 'slt', 'coucou', 'hello', 'hey', 'salem', 'salamou', 'assalam', 'alikoum', 'alaykoum', 'ahla', 'ahlan', 'marhba', 'marhaba', 'sbah', 'khir', 'lkhir', 'labas', 'khouya', 'khoya', 'khti', 'madame', 'monsieur',
    'habite', 'habitons', 'habitez', 'suis', 'sommes', 'reside', 'vis', 'live', 'living', 'from', 'ana', 'nseken', 'nskon', 'saken', 'sakna', 'sakin', 'appelle', 'nom', 'name', 'smiti', 'smitek', 'ismi', 'esmi',
    'livrer', 'livrez', 'livraison', 'livre', 'livrees', 'deliver', 'delivery', 'tawsil', 'twasslou', 'nwasslou', 'domicile', 'stop', 'desk', 'adresse', 'address', 'cite', 'rue', 'bloc', 'quartier', 'logements', 'villa', 'wilaya', 'commune', 'centre', 'ville',
    'telephone', 'numero', 'phone', 'tel', 'merci', 'thanks', 'ok', 'daccord', 'parfait', 'super', 'bien', 'aussi', 'chez', 'ici', 'vers', 'region',
    'مرحبا', 'اهلا', 'اهلين', 'صباح', 'مساء', 'الخير', 'انا', 'ساكن', 'ساكنه', 'نسكن', 'اسمي', 'سميتي', 'التوصيل', 'توصلو', 'ولايه', 'بلديه', 'حي', 'شارع', 'العنوان', 'رقم', 'الهاتف', 'شكرا', 'صحيت', 'خويا', 'اختي',
  ].map((w) => stem(articleless(foldText(w)))),
);
/**
 * journey retest R17-1 (18/11, Major): the words of a customer text that may name a product (`productWords`) once the place names
 * (`placeOut`: the wilaya / commune names taken out, see place-index), greetings, « j'habite / je suis / ana f », the customer's name
 * after its intro and the delivery / address / field words are left out. Empty ⇒ the text names no product the shop could lack: it is
 * never an `off_catalogue` hand-off — PF1 T1 « Bonjour, j'habite à Sétif, El Eulma » was handed to the team as off_catalogue.
 */
export const offCatalogueWords = (text: string, placeOut?: (t: string) => string): string[] => {
  const noName = foldText(text).replace(/(?<![\p{L}])(?:je\s+m\s?appelle|moi\s+c\s?est|mon\s+nom\s+(?:est|c\s?est)|my\s+name\s+is|je\s+suis|smiti|esmi|ismi|اسمي|سميتي)(?:\s+[\p{L}]+){1,3}/gu, ' ');
  return productWords(placeOut ? placeOut(noName) : noName).filter((w) => !NOT_PRODUCT.has(w));
};

export type NamedProduct = { id: string; name: string; keywords?: readonly string[] | null };
/**
 * journey retest R13-1 (18/11): the first of these products the text names — the first word of its name (« sac » of « Sac à main
 * cuir », « parfum » of « Parfum Oud 50 ml »), or two of its name's words, or one of its keywords as written (a keyword in Arabic
 * script finds « حجاب » for « Hijab soie »). Folded with `foldText` (accents, Arabic marks, hamza, tatweel, punctuation of every
 * script), articles dropped, plurals in s / x. Null when none is named.
 */
export function productNamedIn<P extends NamedProduct>(text: string, products: readonly P[]): P | null {
  const said = new Set(productWords(text));
  if (!said.size) return null;
  const padded = ` ${articleless(foldText(text))} `;
  // Houssem live 25/11 UX-096: products that share their first word (« Recette Sac en cuir », « Recette H-22 produit B » — in a real
  // shop « Robe lin », « Robe satin ») — the first of the list was returned for a text naming another one in full. A product named
  // by words that are all among the words another product is named by is left out; the first of those that remain is returned.
  const hits: { p: P; words: Set<string> }[] = [];
  for (const p of products) {
    const words = productWords(p.name);
    const own = new Set(words.filter((w) => said.has(w)));
    if (words.length && (said.has(words[0]!) || own.size >= 2)) {
      hits.push({ p, words: own });
      continue;
    }
    for (const k of p.keywords ?? []) {
      const key = articleless(foldText(k));
      if (key.replace(/\s/g, '').length >= 3 && padded.includes(` ${key} `)) {
        hits.push({ p, words: new Set([`key:${p.id}`]) });
        break;
      }
    }
  }
  if (hits.length < 2) return hits[0]?.p ?? null;
  const fewer = (a: Set<string>, b: Set<string>) => a.size < b.size && [...a].every((w) => b.has(w));
  return (hits.find((h) => !hits.some((o) => o !== h && fewer(h.words, o.words))) ?? hits[0]!).p;
}

/**
 * journey J08v-2 (19/11): EVERY product the text names, in the order of `products` — « je veux 1 tapis berbère et 1 porte-clés » names
 * two, in the order the text names them. A product is named as `productNamedIn` says; one whose named words are all words of another named product that the text names
 * by more of its words is left out (« tapis berbère » names « Tapis berbère », not « Tapis de prière » through « tapis »), and products
 * the text names by the very same words are ambiguous: none of them is kept.
 */
export function productsNamedIn<P extends NamedProduct>(text: string, products: readonly P[]): P[] {
  const list = productWords(text);
  const said = new Set(list);
  if (!said.size) return [];
  const padded = ` ${articleless(foldText(text))} `;
  const hits: { p: P; words: Set<string>; at: number }[] = [];
  for (const p of products) {
    const words = productWords(p.name);
    const own = new Set(words.filter((w) => said.has(w)));
    const byName = words.length > 0 && (said.has(words[0]!) || own.size >= 2);
    const byKey = (p.keywords ?? []).some((k) => {
      const key = articleless(foldText(k));
      return key.replace(/\s/g, '').length >= 3 && padded.includes(` ${key} `);
    });
    if (byName || byKey) hits.push({ p, words: byKey && !byName ? new Set([`key:${p.id}`]) : own, at: byName ? Math.min(...[...own].map((w) => list.indexOf(w))) : list.length });
  }
  const within = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
  // (in the order the text names them)
  return hits.filter((h) => !hits.some((o) => o !== h && within(h.words, o.words))).sort((a, b) => a.at - b.at).map((h) => h.p);
}
