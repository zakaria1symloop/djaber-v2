// Journey re-run J03r-1 (18/11, Major, docs/audit/journeys-2026-11-18/journeys/J03.md): an order above the agent's « Quantité max par
// commande » is handed to the team, never cut to the maximum and recapped. Pure.
//   LIM T1 « Je veux 6 tapis de prière, … » (max 5): `create_order {6}` ⇒ `hint: order_limit`, then a second `create_order {5}` in the same
//   turn ⇒ the server recap « 5 × Tapis de prière » — the hand-off was left to the model, which « fixed » the quantity instead.
//   CQ « Je veux commander 500 pièces de votre premier produit »: no name / phone, so no create_order — the model offered « jusqu'à 5 ».
import { foldBase } from './tools/wilaya-aliases';

/** Words that count pieces (folded: accents dropped, lower case), every script: « 500 pièces », « 6 unités », « 8 حبات », « 7 hbat ». */
const UNIT_WORDS = new Set(
  [
    'piece', 'pieces', 'pce', 'pces', 'pc', 'pcs', 'unite', 'unites', 'article', 'articles', 'exemplaire', 'exemplaires', 'paire', 'paires', 'lot', 'lots', 'boite', 'boites', 'carton', 'cartons',
    'unit', 'units', 'item', 'items', 'pair', 'pairs', 'boxes', 'box',
    'hba', 'hbat', '7ba', '7bat', 'habba', 'habbat', '7abba', '7abbat', 'hbeb', '7beb', 'tasdira', 'qta3', 'kta3',
    'حبه', 'حبات', 'حبتين', 'قطعه', 'قطع', 'وحده', 'وحدات', 'زوج', 'ازواج', 'علبه', 'علب', 'كرطونه',
  ].map((w) => foldBase(w)),
);
/** A word right before the number that makes it no quantity: an address, a size, a code (« n 5 », « bloc 12 », « pointure 41 », « رقم 5 »). */
const NOT_QUANTITY_BEFORE = new Set(
  [
    'n', 'no', 'num', 'numero', 'nr', 'rue', 'bloc', 'bt', 'bat', 'batiment', 'immeuble', 'imm', 'cite', 'villa', 'appartement', 'appt', 'app', 'apt', 'etage', 'porte', 'route', 'lotissement', 'logements', 'logts', 'local',
    'taille', 'pointure', 'size', 't', 'code', 'ref', 'reference', 'wilaya', 'cmd', 'test', 'tel', 'telephone', 'phone', 'km',
    'رقم', 'عماره', 'حي', 'بلوك', 'شقه', 'طابق', 'مقاس', 'نمره', 'ولايه', 'طلبيه', 'الطلبيه',
  ].map((w) => foldBase(w)),
);
/** Words after the number that are skipped before the counted word (« 6 de vos tapis », « 3 x robes »). */
const SKIPPED_AFTER = new Set(['de', 'd', 'des', 'du', 'x', 'fois', 'of', 'the', 'men', 'mn', 'من'].map((w) => foldBase(w)));

/** A number the customer asks for and the words right after it (folded, up to the next punctuation; 3 words at most). */
export type QuantityAsk = { quantity: number; unit: boolean; next: string };

/**
 * The quantities a customer message asks for: a number of 1–6 digits standing alone (never inside a phone, a price written « 12500 », an
 * arabizi word « 7bat », a decimal or a date), not right after an address / size / code word, followed by a word: `unit` when that word
 * counts pieces (« 500 pièces »), else `next` holds the words that may name the product (« tapis de priere ») — the caller checks them
 * against the catalogue. A price (« 12500 DA ») or a measure (« 50 ml ») names no product: the caller's check refuses it.
 */
export function quantitiesAsked(text: string): QuantityAsk[] {
  const f = foldBase(text ?? '');
  const out: QuantityAsk[] = [];
  const re = /(?<![\p{L}\p{N}.,:/#°'-])(\d{1,6})(?:\s*[x×])?(?![\p{L}\p{N}]|[.,:/]\d)/gu;
  for (const m of f.matchAll(re)) {
    const quantity = Number(m[1]);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    // (only the word right before it, with spaces between: « bloc 12 » — never a word behind a comma, « … 200 logements, 12 pièces »)
    const before = /([\p{L}\p{N}]+)\s*$/u.exec(f.slice(0, m.index))?.[1] ?? '';
    if (NOT_QUANTITY_BEFORE.has(before)) continue;
    const rest = f.slice(m.index + m[0].length).split(/[,;.!?؟،\n:()«»"]/u)[0] ?? '';
    const words: string[] = [];
    for (const w of rest.split(/\s+/u).filter(Boolean)) {
      if (/^\d+$/u.test(w)) break;
      if (!words.length && SKIPPED_AFTER.has(w)) continue;
      words.push(w);
      if (words.length >= 3) break;
    }
    if (!words.length) continue;
    out.push({ quantity, unit: UNIT_WORDS.has(words[0]!), next: words.join(' ') });
  }
  return out;
}

// --- journey retest R22-1 (18/11, Major): a quantity said with no product after it, while a product is being sold ----------------------
//   Q3 / Q3c « slm, ch7al djellaba homme ? » ⇒ « Djellaba homme b 7 500 DA … T7ebb nsajjel lek wahda ? », then « nheb 7 » (max 5) ⇒ the model's
//   « Saha, nsajjel lek 7 djellaba homme » / « T7ebb tkhalli 5, wela tdir commande okhra ? » — `quantitiesAsked` kept a number only when a
//   word followed it, so « nheb 7 » never reached the limit check.
const folded = (words: readonly string[]) => words.map((w) => foldBase(w)).sort((a, b) => b.length - a.length);
const escaped = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** Words that may open a quantity message (greetings, a yes, « bon / alors », « ana », a name of the agent's « khouya »). */
const LEAD = [
  'salam', 'slm', 'bonjour', 'bjr', 'bonsoir', 'salut', 'hello', 'hi', 'hey', 'ok', 'okay', 'oui', 'ouais', 'yes', 'yeah', 'ih', 'iyeh', 'wah', 'saha', 'sahit', 'bon', 'alors', 'donc', 'eh', 'euh', 'well', 'so', 'then', 'ana', 'moi', 'khouya', 'khoya', 'khti', 'non', 'plutot', 'finalement', 'enfin', 'mais', 'but', 'actually', 'bessah', 'bessa7', 'lla', 'la', 'w', 'et', 'and',
  'السلام', 'سلام', 'عليكم', 'مرحبا', 'ايه', 'نعم', 'واه', 'طيب', 'صحيت', 'انا', 'خويا', 'اختي', 'بصح', 'لا', 'و',
];
/** « I want / I take / give me » before the number — fr, en, arabizi, Arabic script (darija and MSA), as `foldBase` writes them. */
const QTY_VERBS = [
  'je veux', 'je voudrais', 'je voulais', 'je prends', 'je prendrai', 'je prendrais', 'je commande', 'je souhaite', 'je desire', 'j en veux', 'j en voudrais', 'j en prends', 'j en prendrai', 'il me faut', 'il m en faut', 'j ai besoin de', 'donnez moi', 'donne moi', 'envoyez moi', 'envoie moi', 'mettez moi', 'mets moi', 'mettez en', 'mets en', 'mettez', 'mets', 'plutot', 'ca sera', 'ce sera',
  'i want', 'i d like', 'i would like', 'i ll take', 'i will take', 'i take', 'i need', 'give me', 'send me', 'make it', 'i wanna',
  'nheb', 'nhebb', 'n7eb', 'n7ebb', 'nhab', 'n7ab', 'nebghi', 'nbghi', 'bghit', 'habit', 'habbit', '7abit', 'a3tini', '3tini', 'aatini', 'atini', 'ab3athli', 'ab3thli', 'b3athli', 'dirli', 'dirlna', 'ndir', 'nakhod', 'nakhou', 'nechri', 'nachri', 'nchri',
  'نحب', 'نبغي', 'بغيت', 'حاب', 'حابه', 'عطيني', 'اعطيني', 'ابعثلي', 'بعثلي', 'ديرلي', 'نشري', 'ناخذ', 'ناخد', 'اريد', 'نريد', 'احتاج', 'نحتاج', 'اعطني', 'ابغي', 'بدي',
];
/** A word naming the number as a quantity right before it (« x7 », « qty 7 », « الكمية 7 »). */
const QTY_PREFIX = ['x', 'qty', 'qte', 'quantite', 'quantity', 'nombre', 'الكميه', 'كميه', 'العدد'];
/** Words that may close it (politeness, « of them », « only »). */
const TAIL = [
  'x', 'svp', 'stp', 's', 'il', 'vous', 'plait', 'te', 'please', 'pls', 'plz', 'merci', 'thanks', 'thank', 'you', 'en', 'of', 'them', 'it', 'only', 'seulement', 'tout', 'au', 'total', 'min', 'fadlek', 'fadlak', 'brk', 'bark', 'barka', 'barak', 'menha', 'mnha', 'menhom', 'mnhom', 'menou', 'mennou', 'khouya', 'khoya', 'khti', 'ya', 'saha', 'aussi',
  'من', 'فضلك', 'عافاك', 'برك', 'بركا', 'منها', 'منهم', 'منو', 'منه', 'خويا', 'اختي', 'يا', 'شكرا', 'فقط',
];
const ALTS = folded([...LEAD, ...QTY_VERBS, ...QTY_PREFIX]).map(escaped).join('|');
const BEFORE_RE = new RegExp(`^(?:(?:${ALTS})(?: |$))*$`, 'u');
const TAIL_WORDS = new Set(folded(TAIL));

/**
 * journey retest R22-1: the quantity of a message that is only a quantity — a bare number (« 7 », « 7 svp », « x7 »), a number after a
 * quantity verb (« nheb 7 », « bghit 7 », « je veux 7 », « je prends 7 », « I want 7 », « عطيني 7 », « نحب 7 »), or with « x / × / qty » or a
 * counted word (« 7 حبات », « 7 pièces »); words after the number only politeness, a counted word or a word of `productWords` (« nheb 7
 * djellabat »). Never a phone, a price written with a sign, an order number (« TEST-1234 », « #1234 »), a date (« 12/05 »), a decimal, a
 * number with a leading 0, a message with a second number or another word. Null otherwise. The caller says whether a product is being
 * sold (`quantityAbove`'s `context`).
 */
export function bareQuantity(text: string, productWords: readonly string[] = []): number | null {
  if (!text?.trim() || /[#/:+°@_=\\%&*$€-]/u.test(text)) return null;
  const tokens = foldBase(text)
    .replace(/×/gu, ' x ')
    .replace(/(\d)x(?![\p{L}])/gu, '$1 x ')
    .replace(/(?<![\p{L}\p{N}])x(?=\d)/gu, ' x ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const at = tokens.findIndex((t) => /^\d+$/u.test(t));
  if (at < 0 || tokens.some((t, k) => k !== at && /\d/u.test(t))) return null;
  const n = tokens[at]!;
  if (n.length > 6 || n.startsWith('0')) return null;
  if (!BEFORE_RE.test(tokens.slice(0, at).join(' '))) return null;
  const stems = productWords.map((w) => foldBase(w)).filter((w) => w.length >= 4);
  const productLike = (w: string) => w.length >= 4 && stems.some((s) => w.startsWith(s) || s.startsWith(w));
  if (!tokens.slice(at + 1).every((w) => TAIL_WORDS.has(w) || UNIT_WORDS.has(w) || productLike(w))) return null;
  return Number(n);
}

/** A question of the AI's last message asking another field than a quantity — a size, a colour, the wilaya, the phone, a day, an order number. */
const OTHER_FIELD = /(?<![\p{L}])(?:taille|tailles|pointure|pointures|size|sizes|couleur|couleurs|colou?rs?|wilaya|wilayas|commune|ville|adresse|address|numero|telephone|phone|tel|nom|name|smitek|smiytek|esmek|jour|date|day|heure|hour|time|creneau|wa9tach|waqtach|code|reference|ref|stop\s*desk|domicile|home|مقاس|المقاس|قياس|نمره|لون|اللون|ولايه|الولايه|بلديه|البلديه|عنوان|العنوان|رقم|هاتف|الهاتف|تيليفون|سميتك|اسمك|نهار|يوم|وقت|وقتاش|ساعه)(?![\p{L}])/u;
export const otherFieldAsked = (lastAi: string | null | undefined): boolean =>
  !!lastAi && lastAi.split(/(?<=[.!?؟\n])/u).some((s) => /[?؟]/u.test(s) && OTHER_FIELD.test(foldBase(s).replace(/[^\p{L}\p{N}]+/gu, ' ')));

/**
 * journey retest R22-1: what makes a bare quantity count — a product is being sold (the AI's last message names or prices a product of
 * the catalogue, the customer chose one, or a customer message named one), that last message asks no other field (« Quelle pointure ? »
 * ⇒ « 42 » is a size), and the numbers that are no quantity there (the prices of that message and of the catalogue, numeric variant
 * names such as « 42 »).
 */
export type QuantityContext = {
  selling: boolean;
  lastAi?: string | null;
  productWords?: readonly string[];
  notQuantities?: readonly number[];
  /**
   * Houssem live 23/11 (voice note « شحال le prix تاع le produit QnA 2311 و ابعثلي photo », product « QA 23/11 photos »): the numbers
   * written in the product names (each group and the groups joined: 23, 11, 2311) are a name, never a quantity — the price question was
   * handed to the team as « more than 10 pieces ».
   */
  nameNumbers?: readonly number[];
};
/** The numbers a product name carries: each digit group, and the groups joined (« QA 23/11 photos » ⇒ 23, 11, 2311; « X200 » ⇒ 200). */
export const nameNumbersOf = (names: readonly string[]): number[] => [
  ...new Set(
    names.flatMap((name) => {
      const groups = name.match(/\d+/gu) ?? [];
      return [...groups.map(Number), ...(groups.length > 1 ? [Number(groups.join(''))] : [])].filter((n) => Number.isSafeInteger(n));
    }),
  ),
];

/**
 * The quantity above `max` the message asks for, or null: a counted word (« 500 pièces ») or a word naming a product of the shop
 * (`namesProduct`, the catalogue's own check on the words right after the number); journey retest R22-1: with `context` (a product being
 * sold), also a bare quantity (`bareQuantity`: « nheb 7 », « 7 », « je prends 7 »). A quantity at or under the limit is never returned.
 */
export async function quantityAbove(text: string | undefined, max: number | null | undefined, namesProduct: (words: string) => boolean | Promise<boolean>, context?: QuantityContext): Promise<number | null> {
  if (!text || max === null || max === undefined || !Number.isInteger(max) || max <= 0) return null;
  const named = context?.nameNumbers ?? [];
  for (const q of quantitiesAsked(text)) {
    if (q.quantity <= max || named.includes(q.quantity)) continue;
    if (q.unit || (await namesProduct(q.next))) return q.quantity;
  }
  if (!context?.selling || otherFieldAsked(context.lastAi)) return null;
  const bare = bareQuantity(text, context.productWords ?? []);
  return bare !== null && bare > max && !(context.notQuantities ?? []).includes(bare) && !named.includes(bare) ? bare : null;
}

/** The limit a `create_order` answer reports (`hint: 'order_limit'`): the quantity limit or the amount limit, and its value. */
export type OrderLimit = { kind: 'quantity' | 'amount'; value: number };
export const orderLimitOf = (result: unknown): OrderLimit | null => {
  const r = result as { hint?: unknown; limit?: unknown; maxQty?: unknown; maxAmount?: unknown; quantity?: unknown; total?: unknown } | null;
  if (r?.hint !== 'order_limit') return null;
  const maxQty = typeof r.maxQty === 'number' ? r.maxQty : null;
  const maxAmount = typeof r.maxAmount === 'number' ? r.maxAmount : null;
  const kind = r.limit === 'quantity' || r.limit === 'amount' ? r.limit : maxQty !== null && typeof r.quantity === 'number' && r.quantity > maxQty ? 'quantity' : maxAmount !== null ? 'amount' : 'quantity';
  const value = kind === 'quantity' ? maxQty : maxAmount;
  return value === null ? null : { kind, value };
};
