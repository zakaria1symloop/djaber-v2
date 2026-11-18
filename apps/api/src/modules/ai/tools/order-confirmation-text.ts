// Full-test 15/11 (AI improvement proposal 4): the customer's order confirmation is written by the server from the
// `create_order` result — number, items, delivery fee, total, delay, cash on delivery — in the customer's language, so
// the model can no longer confirm with wrong figures, « correct » itself (« commande enregistrée par erreur »,
// « coordonnées inventées ») or deny the order it just placed (AI-CHAT-02). Pure.
import { formatMoney } from '@djaber/shared';
import { serverTextLanguage, type AiLanguage } from '../language';
import { withMsaWording } from '../msa';
import { articleless, foldText } from './wilaya-aliases';

type Line = { name?: unknown; variant?: unknown; quantity?: unknown; unitPrice?: unknown };
type Placed = { number: string; items: Line[]; deliveryFee: number; total: number; duplicate: boolean; replaced: string | null; beyondStock: boolean; eta: string };

/** « 12500 » → « 12 500 » (CLAUDE.md rule 11: Latin digits, space as thousands separator). */
export const money = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The last `create_order` of the turn that placed an order (a dry run's TEST-n included), else null. */
export const placedOrder = (calls: { name: string; result: unknown }[]): Placed | null => {
  for (const c of [...calls].reverse()) {
    if (c.name !== 'create_order') continue;
    const r = c.result as Record<string, unknown> | null;
    if (!r || r.ok !== true || typeof r.number !== 'string' || !Array.isArray(r.items)) continue;
    const replaced = r.replaced && typeof r.replaced === 'object' ? (r.replaced as { number?: unknown }).number : r.replaced;
    const eta = typeof r.etaDays === 'string' && /^\d+\s*[–-]\s*\d+$/.test(r.etaDays) ? r.etaDays : '2–5';
    return {
      number: r.number,
      items: r.items as Line[],
      deliveryFee: Number(r.deliveryFee ?? 0) || 0,
      total: Number(r.total ?? 0) || 0,
      duplicate: !!r.duplicateOf,
      replaced: typeof replaced === 'string' && replaced ? replaced : null,
      beyondStock: Array.isArray(r.beyondStock) && r.beyondStock.length > 0,
      eta,
    };
  }
  return null;
};

type Loc = 'fr' | 'ar' | 'arabizi' | 'en';
const T: Record<Loc, { head: (n: string) => string; again: (n: string) => string; fee: (v: string) => string; free: string; total: (v: string) => string; eta: (a: string, b: string) => string; beyond: string; replaced: (n: string) => string; thanks: string; cur: string }> = {
  fr: {
    head: (n) => `Votre commande ${n} est bien enregistrée ✅`,
    again: (n) => `Votre commande ${n} est déjà enregistrée ✅`,
    fee: (v) => `Livraison : ${v}`,
    free: 'Livraison : gratuite',
    total: (v) => `Total : ${v}, à payer à la livraison.`,
    eta: (a, b) => `Délai de livraison : ${a} à ${b} jours.`,
    beyond: 'Une partie de la commande peut prendre un peu plus de temps à être livrée.',
    replaced: (n) => `Elle remplace la commande ${n}, qui est annulée.`,
    thanks: 'Merci pour votre confiance !',
    cur: 'DA',
  },
  ar: {
    head: (n) => `تم تسجيل طلبيتك ${n} ✅`,
    again: (n) => `طلبيتك ${n} مسجلة من قبل ✅`,
    fee: (v) => `التوصيل: ${v}`,
    free: 'التوصيل: مجاني',
    total: (v) => `المجموع: ${v}، الدفع عند الاستلام.`,
    eta: (a, b) => `مدة التوصيل: من ${a} إلى ${b} أيام.`,
    beyond: 'جزء من الطلبية يمكن يتعطل شوية في التوصيل.',
    replaced: (n) => `هذي الطلبية تعوض الطلبية ${n}، اللي تلغات.`,
    thanks: 'شكرا على ثقتك!',
    cur: 'دج',
  },
  arabizi: {
    head: (n) => `Commande ta3ek ${n} tsajlet ✅`,
    again: (n) => `Commande ta3ek ${n} déjà msajla ✅`,
    fee: (v) => `Livraison: ${v}`,
    free: 'Livraison: batel',
    total: (v) => `Total: ${v}, tkhalles ki tewsel.`,
    eta: (a, b) => `Tawsil f ${a} l ${b} ayam.`,
    beyond: 'Juz2 men la commande ymken yt3atel chwiya f tawsil.',
    replaced: (n) => `Hadi t3awed la commande ${n}, lli tlghat.`,
    thanks: 'Saha, merci 3la thiqa ta3ek!',
    cur: 'DA',
  },
  en: {
    head: (n) => `Your order ${n} is confirmed ✅`,
    again: (n) => `Your order ${n} is already registered ✅`,
    fee: (v) => `Delivery: ${v}`,
    free: 'Delivery: free',
    total: (v) => `Total: ${v}, cash on delivery.`,
    eta: (a, b) => `Delivery in ${a} to ${b} days.`,
    beyond: 'Part of the order may take a little longer to be delivered.',
    replaced: (n) => `It replaces order ${n}, which is cancelled.`,
    thanks: 'Thank you for your trust!',
    cur: 'DA',
  },
};
// journey retest R9-1: the one language decision of the server texts (`serverTextLanguage`: a `mixed` turn is resolved by the caller)
const locOf = (lang: AiLanguage | string | undefined): Loc => serverTextLanguage(lang);

// --- the recap (journey retest R1-6 / R1-7, 17/11) ---------------------------------------------------------------------------
type Recap = { items: Line[]; deliveryFee: number; total: number; clientName: string; clientPhone: string; secondPhone: string | null; wilaya: string; communeName: string | null; address: string | null; isStopdesk: boolean; replaces: string | null; /** journey retest R2-7 */ wilayaAr?: string | null; communeAr?: string | null; /** journey retest R6-3: part of it is sold beyond the stock */ beyondStock?: boolean };
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/**
 * The recap a `create_order` of this turn returned for the customer to confirm (`CONFIRMATION_REQUIRED` of a first recap,
 * `recapToShow`), the latest one; null when there is none or an order was placed this turn.
 */
export const pendingRecap = (calls: { name: string; result: unknown }[]): Recap | null => {
  if (placedOrder(calls)) return null;
  for (const c of [...calls].reverse()) {
    if (c.name !== 'create_order') continue;
    const r = c.result as { error?: { code?: unknown }; recap?: Record<string, unknown>; recapToShow?: unknown } | null;
    if (r?.error?.code !== 'CONFIRMATION_REQUIRED' || r.recapToShow !== true || !r.recap || !Array.isArray(r.recap.items)) continue;
    const p = r.recap;
    return {
      items: p.items as Line[],
      deliveryFee: Number(p.deliveryFee ?? 0) || 0,
      total: Number(p.total ?? 0) || 0,
      clientName: s(p.clientName),
      clientPhone: s(p.clientPhone),
      secondPhone: s(p.secondPhone) || null,
      wilaya: s(p.wilaya),
      communeName: s(p.communeName) || null,
      address: s(p.address) || null,
      isStopdesk: p.isStopdesk === true,
      replaces: s(p.replaces) || null,
      wilayaAr: s(p.wilayaAr) || null,
      communeAr: s(p.communeAr) || null,
      beyondStock: Array.isArray(p.beyondStock) && p.beyondStock.length > 0,
    };
  }
  return null;
};

const R: Record<Loc, { comma: string; head: string; home: (place: string) => string; stop: (place: string) => string; free: string; total: (v: string) => string; name: string; phone: string; phone2: string; address: string; replaces: (n: string) => string; beyond: string; ask: string; cur: string; sep: string }> = {
  fr: { comma: ', ', head: 'Voici le récapitulatif de votre commande :', home: (p) => `Livraison à domicile${p ? ` (${p})` : ''}`, stop: (p) => `Livraison en stop-desk${p ? ` (${p})` : ''}`, free: 'gratuite', total: (v) => `Total : ${v}, à payer à la livraison.`, name: 'Nom', phone: 'Téléphone', phone2: 'Deuxième téléphone', address: 'Adresse', replaces: (n) => `Elle remplacera la commande ${n}.`, beyond: T.fr.beyond, ask: 'Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer.', cur: 'DA', sep: ' : ' },
  ar: { comma: '، ', head: 'هذا ملخص الطلبية:', home: (p) => `التوصيل للدار${p ? ` (${p})` : ''}`, stop: (p) => `التوصيل لنقطة الاستلام${p ? ` (${p})` : ''}`, free: 'مجاني', total: (v) => `المجموع: ${v}، الدفع عند الاستلام.`, name: 'الاسم', phone: 'الهاتف', phone2: 'الهاتف الثاني', address: 'العنوان', replaces: (n) => `هذي الطلبية تعوض الطلبية ${n}.`, beyond: T.ar.beyond, ask: 'جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو.', cur: 'دج', sep: ': ' },
  arabizi: { comma: ', ', head: 'Hada récap ta3 la commande:', home: (p) => `Tawsil l dar${p ? ` (${p})` : ''}`, stop: (p) => `Tawsil l stop-desk${p ? ` (${p})` : ''}`, free: 'batel', total: (v) => `Total: ${v}, tkhalles ki tewsel.`, name: 'Smitek', phone: 'Numéro', phone2: 'Numéro lokhra', address: 'Adresse', replaces: (n) => `Hadi t3awed la commande ${n}.`, beyond: T.arabizi.beyond, ask: 'Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou.', cur: 'DA', sep: ': ' },
  en: { comma: ', ', head: 'Here is your order summary:', home: (p) => `Home delivery${p ? ` (${p})` : ''}`, stop: (p) => `Stop-desk delivery${p ? ` (${p})` : ''}`, free: 'free', total: (v) => `Total: ${v}, cash on delivery.`, name: 'Name', phone: 'Phone', phone2: 'Second phone', address: 'Address', replaces: (n) => `It will replace order ${n}.`, beyond: T.en.beyond, ask: 'Reply « yes » to confirm the order, or tell me what to change.', cur: 'DA', sep: ': ' },
};
/**
 * journey retest R17-2 (18/11): the text holds the server recap's request to answer yes (« Répondez « oui » pour confirmer la commande, … »,
 * « Ktebli « ih » … », « جاوبني « إيه » … », « Reply « yes » … ») — the AI's message was a server recap.
 */
// journey retest R22-2 (18/11): and its Modern Standard Arabic wording (`withMsaWording`, J04r-4) — C4 T6 « نعم، أؤكد الطلب » to the MSA recap
// « … أجبني بـ « نعم » لتأكيد الطلب، أو أخبرني بما يجب تغييره. » was not seen as a yes to a server recap and went to the model
export const serverRecapAsked = (text: string | null | undefined): boolean => !!text && [...Object.values(R).map((r) => r.ask), withMsaWording(R.ar.ask)].some((ask) => text.includes(ask));
// journey retest R12-1: compatibility forms (full-width, presentation forms) decomposed and the tatweel dropped too (punctuation kept)
const folded = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f\u0640]/g, '').toLowerCase();
/** « Cité 20 Août, villa 3 » + « Boufarik » + « Blida »: the commune / wilaya are added when the address does not name them. */
const placeOf = (comma: string, base: string | null, ...more: (string | null | undefined)[][]) => {
  const parts = base ? [base] : [];
  // each place comes with its other spellings (Latin / Arabic): added once, in the first spelling given, when none is written yet
  for (const names of more) {
    const [m] = names.filter((x): x is string => !!x);
    if (m && !parts.some((p) => names.some((n) => !!n && folded(p).includes(folded(n))))) parts.push(m);
  }
  return parts.join(comma);
};
/**
 * journey retest R6-4 (17/11): the commune / wilaya the address ends with, after a comma, are taken off so that they come back
 * in the recap's order (« Cité 20 août villa 3, Blida » + Boufarik ⇒ « …, Boufarik, Blida », not « …, Blida, Boufarik »). A
 * name not after a comma (« Rue de Boufarik ») and the first segment are never taken off.
 */
export const withoutTrailingPlaces = (address: string, names: (string | null | undefined)[]): string => withoutPlaceSegments(address, names);
/** A place name as compared: `foldText` (journey retest R12-1: accents / Arabic marks / tatweel removed, hamza / tā' marbūṭa folded, the punctuation of every script ⇒ space). */
const placeKey = (t: string) => foldText(t);
const withoutArticle = (k: string) => k.replace(/^(?:el|al|ال)\s*/u, '');
/**
 * journey retest R11-4 (17/11): the address without the commune / wilaya segments it starts OR ends with (between commas), so
 * the recap and the stored order always read « street, commune, wilaya » — N21 T4 `address « البليدة، بوفاريك، حي الورود رقم 12 »`
 * (wilaya first) was shown and stored as is. A name inside a segment (« Rue de Boufarik ») is kept, and one segment always stays.
 */
export const withoutPlaceSegments = (address: string, names: (string | null | undefined)[]): string => {
  const keys = new Set(names.filter((n): n is string => !!n && n.trim().length >= 2).flatMap((n) => [placeKey(n), withoutArticle(placeKey(n))]).filter((k) => k.length >= 2));
  // segments at the even indexes, their separators at the odd ones
  // journey retest R12-1: any separator of a list of places — « , ، ; ؛ » and a spaced dash or slash (« حي الورود - بوفاريك - البليدة »)
  const parts = address.trim().split(/(\s*[,،;؛]\s*|\s+[-–—/]\s+)/u);
  const isPlace = (seg: string) => {
    const k = placeKey(seg);
    return !k || keys.has(k) || keys.has(withoutArticle(k));
  };
  let a = 0;
  let b = parts.length - 1;
  while (b - 2 >= a && isPlace(parts[b]!)) b -= 2;
  while (a + 2 <= b && isPlace(parts[a]!)) a += 2;
  const street = parts.slice(a, b + 1).join('').trim();
  // journey retest R13-2 (18/11): and the names wherever they stand in it — « حي 1000 مسكن عمارة 5، قسنطينة الخروب » (wilaya and commune
  // in one segment, no separator between them) was shown and stored as the street
  return withoutPlaceWords(street, keys) || street;
};
/** Words of a street name a place name may follow (« Rue de Boufarik », « شارع الجزائر », « Cité El Khroub »): the name is kept there. */
const STREET_NAME_WORDS = new Set(['rue', 'avenue', 'av', 'boulevard', 'bd', 'route', 'rte', 'chemin', 'impasse', 'allee', 'place', 'cite', 'quartier', 'hay', 'hai', 'residence', 'lotissement', 'street', 'road', 'شارع', 'نهج', 'طريق', 'حي', 'زنقه', 'درب', 'اقامه', 'ساحه', 'تجزئه']);
/** Small words that go with a place name (« wilaya de », « commune de », « à », « في », « ولاية »): dropped with the name. */
const PLACE_LEAD_WORDS = new Set(['wilaya', 'commune', 'daira', 'de', 'du', 'd', 'a', 'au', 'en', 'f', 'fi', 'in', 'at', 'ولايه', 'بلديه', 'دائره', 'في', 'ب']);
const CONNECTORS = new Set(['de', 'du', 'des', 'd']);
/**
 * journey J09r-5 (18/11): words that make a place name part of a neighbourhood name when they follow it (« Blida centre », « Sétif
 * ville », « Oran est ») — the name is kept there: it is the customer's street words.
 */
const NEIGHBOURHOOD_WORDS = new Set(['centre', 'center', 'centreville', 'ville', 'nord', 'sud', 'est', 'ouest', 'gare', 'port', 'plage', 'vieille', 'nouvelle', 'وسط', 'مركز', 'المركز', 'سنتر', 'الوسط', 'المدينه', 'مدينه', 'الجديده', 'القديمه', 'شرق', 'غرب', 'الشرقي', 'الغربي']);
/**
 * journey retest R13-2 (18/11): the street without the commune / wilaya names (`keys`: folded, with and without their article) it starts
 * or ends with — with the small words that lead them (« wilaya de », « à », « في ») and with no separator between them and the street
 * (« ولاية قسنطينة الخروب حي 1000 مسكن », « … bloc 12 à El Eulma »). Journey J09r-5 (18/11): only those runs at the two ends — never a
 * name between the street's words — and never a name followed by a neighbourhood word (« Blida centre, rue des orangers 16 » stays
 * whole: the recap read « centre, rue des orangers 16 »); a name that is part of a street name stays (« Rue de Boufarik »,
 * « شارع الجزائر »). A street left with no letter is not returned ('').
 */
export const withoutPlaceWords = (street: string, keys: ReadonlySet<string>): string => {
  const raw = street.split(/\s+/u).filter(Boolean);
  const folded = raw.map((w) => placeKey(w));
  const drop = new Array<boolean>(raw.length).fill(false);
  const isKey = (k: string) => !!k && (keys.has(k) || keys.has(withoutArticle(k)) || keys.has(articleless(k)));
  /** the end (exclusive, ≤ `max`) of the longest place name that starts at word `i`, -1 when none */
  const nameAt = (i: number, max = raw.length) => {
    for (let j = Math.min(max, i + 5); j > i; j--) if (isKey(folded.slice(i, j).join(' ').trim())) return j;
    return -1;
  };
  const isLead = (k: number) => PLACE_LEAD_WORDS.has(folded[k]!) && !/[,،;؛]$/u.test(raw[k]!);
  // from the start: [lead words] name, again — up to the first street word, or a neighbourhood word right after the name
  let first = 0;
  for (;;) {
    let k = first;
    while (k < raw.length && isLead(k)) k++;
    const end = k < raw.length ? nameAt(k) : -1;
    if (end < 0 || end >= raw.length || NEIGHBOURHOOD_WORDS.has(folded[end]!)) break;
    for (let x = first; x < end; x++) drop[x] = true;
    first = end;
  }
  // from the end: name, with the lead words before it — a name after a street-name word (« Rue de Boufarik ») stays
  let stop = raw.length;
  while (stop > first) {
    let start = -1;
    for (let s = Math.max(first, stop - 5); s < stop; s++) {
      if (nameAt(s, stop) === stop) {
        start = s;
        break;
      }
    }
    if (start <= first) break;
    const prev = folded[start - 1] ?? '';
    const prev2 = folded[start - 2] ?? '';
    if (STREET_NAME_WORDS.has(prev) || (CONNECTORS.has(prev) && STREET_NAME_WORDS.has(prev2))) break;
    let lead = start;
    while (lead - 1 > first && isLead(lead - 1)) lead--;
    for (let x = lead; x < stop; x++) drop[x] = true;
    stop = lead;
  }
  if (!drop.some(Boolean)) return street;
  const kept = raw.filter((_, k) => !drop[k]).join(' ');
  const out = kept.replace(/\s+([,،;؛])/gu, '$1').replace(/([,،;؛])(?:\s*[,،;؛])+/gu, '$1').replace(/^[\s,،;؛\-–—/.]+|[\s,،;؛\-–—/]+$/gu, '').trim();
  return /\p{L}/u.test(out) ? out : '';
};
const itemLine = (i: Line, amount: (n: number) => string) => {
  const qty = Number(i.quantity ?? 1) || 1;
  const unit = Number(i.unitPrice ?? 0) || 0;
  const name = [s(i.name), s(i.variant) ? `(${s(i.variant)})` : ''].filter(Boolean).join(' ');
  return `- ${qty} × ${name}${unit ? ` : ${amount(unit * qty)}` : ''}`;
};

/**
 * journey retest R1-6 / R1-7: the recap the customer confirms, written by the server from the `CONFIRMATION_REQUIRED`
 * result in their language — every item with the catalogue name as written (never translated), the delivery mode and
 * its fee, the total, the name, the phone(s), the address, the replaced order. Pure.
 */
export const orderRecapText = (recap: Recap, lang: AiLanguage | string | undefined): string => {
  const loc = locOf(lang);
  const t = R[loc];
  const amount = (n: number) => `${money(n)} ${t.cur}`;
  // journey retest R2-7: an Arabic recap names the wilaya (and a commune of the list) in Arabic script, with « ، »
  const wilaya = loc === 'ar' ? [recap.wilayaAr, recap.wilaya] : [recap.wilaya, recap.wilayaAr];
  const commune = loc === 'ar' ? [recap.communeAr, recap.communeName] : [recap.communeName, recap.communeAr];
  const place = recap.isStopdesk ? (wilaya.find(Boolean) ?? '') : placeOf(t.comma, null, commune, wilaya);
  const fee = recap.deliveryFee > 0 ? amount(recap.deliveryFee) : t.free;
  return [
    t.head,
    ...recap.items.map((i) => itemLine(i, amount)),
    `- ${recap.isStopdesk ? t.stop(place) : t.home(place)}${t.sep}${fee}`,
    t.total(amount(recap.total)),
    ...(recap.clientName ? [`${t.name}${t.sep}${recap.clientName}`] : []),
    ...(recap.clientPhone ? [`${t.phone}${t.sep}${recap.clientPhone}`] : []),
    ...(recap.secondPhone ? [`${t.phone2}${t.sep}${recap.secondPhone}`] : []),
    ...(!recap.isStopdesk && recap.address ? [`${t.address}${t.sep}${placeOf(t.comma, withoutTrailingPlaces(recap.address, [...commune, ...wilaya]), commune, wilaya)}`] : []),
    ...(recap.replaces ? [t.replaces(recap.replaces)] : []),
    // journey retest R6-3: the model said it as « commandée au-delà du stock » (the internal idea); the server says it plainly
    ...(recap.beyondStock ? [t.beyond] : []),
    t.ask,
  ].join('\n');
};

/** Latin digits, thousands separators dropped: the numbers a text writes. */
const numbersOf = (text: string) => new Set([...text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/(?<=\d)[ .,\u00a0\u202f](?=\d{3}(?!\d))/g, '').matchAll(/\d+/g)].map((m) => m[0]));
const wordsOf = (t: string) => ` ${folded(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

// --- journey retest R6-1 (17/11): what of the model's reply may stay before the server recap — an allow-list -----------------
// R2-6 / R3-4 / R4-4 / R4-3 each added the new wording of a request to confirm to a deny-list (CONFIRM_ASK, RECAP_TALK), and R6
// found four more (« Pouvez-vous confirmer la commande en répondant oui ? », « … ci-dessus en répondant oui ? », « Ktb "oui" bach
// nkammlou la commande. », « la commande t7adret »). A sentence now stays only when it is (a) a thank-you / greeting lead-in that
// says nothing else (« Merci Karim ! », « Thanks John! », « Saha Walid ! ») or (b) the answer to a question of the customer's
// message (a fee, a delay, a product detail: « Ih, nwasslou l Constantine. », « Tawsil l dar: 700 DA. ») — and never when it
// mentions the order, the recap, a confirmation, a « oui / ih / yes », writing or answering, in any language.

/** Words of a thank-you / greeting lead-in (folded). */
const LEAD_WORDS = new Set(
  [
    'merci', 'beaucoup', 'parfait', 'super', 'tres', 'bien', 'bon', 'excellent', 'choix', 'top', 'genial', 'avec', 'plaisir', 'bonjour', 'bonsoir', 'salut', 'bienvenue', 'madame', 'monsieur',
    'thanks', 'thank', 'you', 'great', 'perfect', 'nice', 'choice', 'good', 'hello', 'hi', 'welcome', 'very', 'much', 'so',
    'saha', 'sahit', 'sahitek', 'sahitou', 'sa7a', 'sa7it', 'yaatik', 'ya3tik', 'chokran', 'choukran', 'shukran', 'mlih', 'mli7', 'momtaz', 'khouya', 'khoya', 'khti', 'okhti', 'sahbi', 'salam', 'slm', 'marhba', 'ahla', 'ahlan', 'bik', 'baraka', 'allah', 'fik', 'tbarkallah',
    'شكرا', 'بزاف', 'صحيت', 'صحيتو', 'صحا', 'يعطيك', 'الصحة', 'بارك', 'الله', 'فيك', 'مرحبا', 'أهلا', 'اهلا', 'السلام', 'عليكم', 'تمام', 'ممتاز', 'مليح', 'خويا', 'اختي', 'اختيار', 'زين',
  ].map((w) => folded(w)),
);
/** A word of a request / talk about the order, the recap, a confirmation, writing or answering (folded; any language). */
const ORDER_TALK =
  /command|order|طلبي|الطلب|كوموند|komand|recap|r[eé]sum|summary|ملخص|confirm|ta2?kk?id|n?2?akk?[ei]?d(?:ou|o|i)?(?![\p{L}])|تأكيد|تاكيد|نأكد|ناكد|نكد|أكد|اكد|valid|enregistr|tsajl|msajl|sajjel|تسجيل|تسجل|نسجل|ecri|(?<![\p{L}])(?:writ|tape[zr]?|kt[e]?b(?:li)?|ktob|aktob)(?![\p{L}])|اكتب|كتب|r[eé]?pon[ds]|repl[yi]|answer|respond|جاوب|jaw[e]?b|ci[- ]dess|above|below|لتحت|الفوق|lta7t|fou9|(?<![\p{L}])(?:pr[eê]te?|ready|wajd[ae]?)(?![\p{L}])|t7adr|7adr[ea]t|جاهز|واجد|حاضر|(?<![\p{L}])not[ée]e?s?(?![\p{L}])|noted/u;
/** « oui / ih / yes » anywhere but as the first word of an answer (« Oui, on livre à Blida. », « Ih, nwasslou l Constantine. »). */
const YES_WORD = /(?<![\p{L}\p{N}])(?:oui|ouais|ih|iyeh|iyyeh|ey?h|wah|yes|yeah|ايه|إيه|ايوه|نعم|واه)(?![\p{L}\p{N}])/u;
const YES_OPENER = /^[\s\p{P}]*(?:oui|ouais|non|ih|iyeh|iyyeh|ey?h|wah|lala|yes|yeah|no|ايه|إيه|ايوه|نعم|واه|لا)(?![\p{L}\p{N}])[\s,،!.]*/u;
/**
 * The customer's message asks something (a question mark, a question word, « dites-moi / 9olli »). Folded text.
 * Journey retest R7-1 (17/11): « quand même » (« anyway ») is no question — « je la prends quand même » let a sentence through.
 */
const ASKS =
  /[?؟]|(?<![\p{L}\p{N}])(?:combien|quand(?![\s-]+(?:bien\s+)?m[eê]me)|comment|pourquoi|est[- ]ce|quel(?:le)?s?|how|when|what|which|where|why|do you|can you|is it|are they|ch7al|chhal|chal|9adach|qadach|kadach|wach|wa9tach|w9tach|wqtach|imta|kifach|kifech|3lach|win|wayn|9olli|goulli|gouli|dites[- ]moi|tell me|كم|شحال|قداش|وقتاش|واش|علاش|كيفاش|وين|هل|قولي|قوللي)(?![\p{L}\p{N}])/u;
/** journey retest R9-3: the customer's message asks something (a question mark or a question word, both scripts). */
export const asksSomething = (text: string | undefined): boolean => bothForms(text ?? '').some((v) => ASKS.test(v));
/** What an answer gives: a number, delivery, a delay, a price, a size, a colour, a fabric, the stock, the payment (folded). */
const ANSWER_CONTENT =
  /\d|livr|deliver|twass?l|nwass?l|ywass?l|tawsil|توص|نوص|يوص|stop.?desk|jour|day|ayam|ayyam|يوم|ايام|prix|price|taman|thaman|soum|سعر|ثمن|سومة|taille|size|ma9as|مقاس|couleur|colou?r|لون|tissu|fabric|matiere|qmach|9mach|khfif|قماش|coton|cotton|laine|soie|silk|cuir|leather|stock|disponible|available|kayen|kayna|kaynin|makach|متوفر|موجود|كاين|ماكانش|garantie|warranty|paiement|payment|cash|khlas|الدفع|خلاص|gratuit|free|batel|مجان|frais|fee|tarif/u;

/** Folded, and as written in lower case (a folded hamza is decomposed: « إيه » would no longer match). */
const bothForms = (x: string) => [folded(x), x.toLowerCase()];
/** journey retest R7-1: a delay that is longer than usual (« peut prendre un peu plus de temps », « may take longer », « yt3atel »). */
const LATER_TALK = /plus\s+de\s+temps|plus\s+longue?|(?<![\p{L}])retard|d[ée]lai\s+(?:plus|suppl)|longer|(?<![\p{L}])delay|yt3att?el|t3att?al|ta3til|يتعطل|تتعطل|تعطل|تأخير|تاخير|يتأخر|يتاخر|وقت\s+(?:اكثر|أكثر|زايد)|chwiya\s+ktar/u;
/** Words of 3 letters or more, no number (folded): what two sentences say in common. */
const contentWords = (t: string) => [...new Set(folded(t).split(/[^\p{L}]+/u).filter((w) => w.length >= 3))];
/**
 * journey retest R7-1 (17/11): a sentence that says again a line of the server recap that has no amount — the « beyond stock »
 * delay, the replaced order (N10: « La montre peut prendre un peu plus de temps à être livrée. » before a recap ending with « Une
 * partie de la commande peut prendre un peu plus de temps à être livrée. »): 3 words or more of it, 60 % of the sentence.
 */
export const repeatsRecapLine = (sentence: string, recap: Pick<Recap, 'beyondStock' | 'replaces'>): boolean => {
  const lines = [...(recap.beyondStock ? (Object.keys(R) as Loc[]).map((l) => R[l].beyond) : []), ...(recap.replaces ? (Object.keys(R) as Loc[]).map((l) => R[l].replaces(recap.replaces!)) : [])];
  if (!lines.length) return false;
  if (recap.beyondStock && bothForms(sentence).some((v) => LATER_TALK.test(v))) return true;
  const words = contentWords(sentence);
  return lines.some((line) => {
    const said = new Set(contentWords(line));
    const hits = words.filter((w) => said.has(w)).length;
    return hits >= 3 && hits / words.length >= 0.6;
  });
};
/** journey retest R6-1: a sentence that is only a thank-you / greeting (and the customer's name, or one capitalised name). */
const leadOnly = (x: string, names: Set<string>): boolean => {
  const raw = x.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!raw.length || raw.length > 7) return false;
  let lead = 0;
  let other = 0;
  for (const w of raw) {
    const f = folded(w);
    if (LEAD_WORDS.has(f)) lead++;
    else if (names.has(f)) continue;
    // « Merci Samir ! » for « سمير بن علي »: one other capitalised (or Arabic-script) word is the name as the model wrote it
    else if (other === 0 && (/^\p{Lu}/u.test(w) || /[؀-ۿ]/u.test(w))) other++;
    else return false;
  }
  return lead > 0;
};
/**
 * journey retest R6-1: the sentences of the model's reply that may go before the server recap — a thank-you lead-in, or (when
 * the customer's message asks something) an answer that carries content and repeats none of the recap (no total, phone,
 * address, item line). Every other sentence is dropped, whatever its wording.
 */
export const recapLeadIn = (reply: string, recap: Recap, customerText?: string): string[] => {
  const all = reply.trim().split(/(?<=[.!?؟])\s+|\n+/).filter((x) => x.trim());
  const names = new Set(wordsOf(recap.clientName).trim().split(' ').filter((w) => w.length >= 2));
  const asked = bothForms(customerText ?? '').some((v) => ASKS.test(v));
  const address = recap.isStopdesk ? '' : s(recap.address);
  const itemAmounts = recap.items.map((i) => (Number(i.unitPrice ?? 0) || 0) * (Number(i.quantity ?? 1) || 1)).filter((n) => n > 0).map(String);
  return all.filter((x) => {
    if (aboutRecap(x) || bothForms(x).some((v) => ORDER_TALK.test(v))) return false;
    // journey retest R7-1: a line the server recap already says (the « beyond stock » delay, the replaced order)
    if (repeatsRecapLine(x, recap)) return false;
    // a « oui » the sentence asks for (not the « Oui, … » that answers a question)
    if (bothForms(x).some((v) => YES_WORD.test(v.replace(YES_OPENER, '')))) return false;
    if (leadOnly(x, names)) return true;
    if (!asked || !bothForms(x).some((v) => ANSWER_CONTENT.test(v))) return false;
    // a line of the model's own recap (« - 1 × Djellaba homme : 7 500 DA », « Total : 8 200 DA », the phone, the address)
    const nums = numbersOf(x);
    if (/^\s*[-•*]|×/u.test(x) || nums.has(String(recap.total)) || itemAmounts.some((n) => nums.has(n))) return false;
    if (recap.clientPhone && nums.has(recap.clientPhone.replace(/\D/g, ''))) return false;
    return !(address.length >= 6 && wordsOf(x).includes(wordsOf(address)));
  });
};
/**
 * What the customer gets when a recap is pending: the server's recap, after the model's sentences that may stay
 * (`recapLeadIn`: a thank-you lead-in or the answer to a question of the customer's message, at most 2 sentences, 280
 * characters) — any recap or request to confirm of the model is dropped.
 * Journey retest R4-3 (17/11): the model's reply is never kept as the recap, even « complete » (`recapComplete`, R1-6): a
 * product suggestion that repeated the customer's details and the price (free delivery: total = price) passed for one, with
 * no delivery line and no request to confirm.
 */
export const recapReply = (reply: string, recap: Recap, lang: AiLanguage | string | undefined, customerText?: string): { text: string; kept: 'prefix' | 'server' } => {
  const server = orderRecapText(recap, lang);
  const kept = recapLeadIn(reply, recap, customerText);
  const text = kept.join(' ').trim();
  if (text && kept.length <= 2 && text.length <= 280) return { text: `${text}\n\n${server}`, kept: 'prefix' };
  return { text: server, kept: 'server' };
};
/** A request to confirm the order (folded): the server recap already ends with one. */
// journey retest R3-4: also « استني تأكيدك بـ « إيه » », « t7ebb nkamlouh b confirmation ? », « prête à être confirmée »
// journey retest R4-4: the darija verb « nakked / n2akked / nakkdou / ta2kid » and a bracketed « (yes / le) », « (oui / non) »
const CONFIRM_ASK = /(?<![\p{L}\p{N}])(?:[nty](?:2|')?akk?[ei]?d(?:ou|o|i|ha|lek)?|ta2?kk?id|t2akk?id)(?![\p{L}\p{N}])|\(\s*(?:yes|oui|ih|iyeh|ey?h|wah)\s*\/\s*(?:no|non|le|la|lala|lla)\s*\)|r[e]?pond(?:ez|s)?\s+(?:par\s+)?\W{0,3}oui|(?:pour|de)\s+confirmer|confirmez|je\s+confirme\s+(?:la|votre)\s+commande|confirmer\s+(?:la|votre|ma)\s+commande|en\s+r[eé]?pondant|(?<![\p{L}])ktb\s+\W{0,3}(?:oui|ih|iyeh)|confirmation|(?:a|à)\s+[eê]tre\s+confirm|attend(?:s|ons)?\s+votre|en\s+attente\s+de\s+votre|repl(?:y|ies)\s+\W{0,3}yes|(?:say|answer)\s+\W{0,3}yes|to\s+confirm|confirm\s+(?:the|your)\s+order|(?:waiting|wait)\s+for\s+your|ktebli\s+\W{0,3}(?:ih|iyeh|oui)|goulli\s+\W{0,3}(?:ih|iyeh)|bach\s+n?confirm|n?confirmi|nestanna|جاوبني|باش\s+نأكد|باش\s+نكد|لتأكيد|للتأكيد|أكد\s+لي|تأكيد|نستنى|استنى|استني|نستنا/u;
/**
 * journey retest R3-4: a sentence about the recap or the order being ready — the recap that follows says it all. Words of
 * the recap (récap, summary, ملخص), its sending (« va vous être envoyé », « ydhher »), « I have everything », « commande prête »,
 * and a change described (« بدلنا الطلبية », « j'ai modifié la commande », « I've updated your order »).
 */
const RECAP_TALK = /r[eé]?cap|r[ée]sum[ée]|summary|ملخص|voici\s+(?:votre|la)\s+commande|here(?:'s|\s+is)\s+(?:your|the)\s+order|va\s+vous\s+[eê]tre\s+envoy|vous\s+sera\s+envoy|ydh+er|yban|(?:i|we)\s+(?:have|got)\s+everything|(?:j['’]ai|on\s+a|nous\s+avons)\s+(?:bien\s+)?tout|all\s+set|(?:commande|order)\s+(?:est\s+)?(?:pr[eê]te|ready)|(?:modifi|mis\s+a\s+jour|mise\s+a\s+jour|updated|changed|bdelna|beddelna|beddelt|bedelt)\S*\s+(?:\S+\s+)?(?:la\s+|votre\s+|your\s+|the\s+)?(?:commande|order)|(?:بدلنا|بدلت|بدّلنا|عدلنا|عدلت)\s+(?:لك\s+)?(?:الطلبية|الطلب|الكوموند)|(?:commande|order)\S*\s+(?:\S+\s+){0,3}?(?:enregistr|confirm[eé]e|valid[eé]e|pass[eé]e|placed|registered|confirmed|tsajl|msajl)|تم\s+تسجيل|تسجلت\s+(?:ال)?طلبي|(?:commande|order)\S*\s+(?:\S+\s+)?t7adr|ci[- ]dessus/u;
// journey retest R6-1: also « confirmer la commande … en répondant oui », « Ktb "oui" », « la commande t7adret », « ci-dessus »
// journey retest R4-3: also an order said to be placed (« Votre commande est enregistrée ✓ ») on a turn that only shows the
// recap — nothing is ordered yet, the sentence is never kept before the server recap (nor in a handoff answer)

/** A sentence that asks to confirm the order or talks about the recap (both scripts, folded and as written). */
const aboutRecap = (x: string) => [folded(x), x.toLowerCase()].some((v) => CONFIRM_ASK.test(v) || RECAP_TALK.test(v) || CONFIRM_QUESTION.test(v));
/**
 * journey retest R8-1 / R8-2 (17/11): a question asking to confirm the order, or to say « oui » again — « tu confirmes la
 * commande ? », « Pouvez-vous répondre « oui » une nouvelle fois … ? », « confirmez-vous ? », « do you confirm? ».
 */
const CONFIRM_QUESTION = /(?<![\p{L}])(?:tu\s+confirmes?|vous\s+confirmez|confirmez[- ]vous|confirmes[- ]tu|do\s+you\s+confirm|t?confirmi\s*\??$)|r[eé]?pond\S*\s+(?:\S+\s+){0,3}?\W{0,3}(?:oui|ih|yes)\W{0,3}\s+(?:une\s+nouvelle\s+fois|encore|again|[aà]\s+nouveau)|(?:une\s+nouvelle\s+fois|encore\s+une\s+fois|again)\s+\W{0,3}(?:oui|ih|yes)/u;
/** journey retest R8-1 / R8-2: a sentence that asks to confirm the order or talks about a recap (exported for the reply guard). */
export const recapClaim = (sentence: string): boolean => aboutRecap(sentence);

/** A word of confirming (folded / as written; « nconfirmi », « n2akkdou », « تأكيد »). */
const CONFIRM_WORD = /confirm|(?<![\p{L}])[nt]?2?akk?[ei]?d(?:ou|o|i)?(?![\p{L}])|ta2?kk?id|تأكيد|تاكيد|نأكد|ناكد|نكد|أكد|اكد/u;
/** « Répondez « oui » », « reply yes », « ktebli « ih » », « جاوبني بـ « إيه » » — a request to answer yes. */
const REPLY_YES = /(?:r[eé]?pond\S*|repl(?:y|ies)|answer|(?<![\p{L}])say|ktebli|(?<![\p{L}])ktb|(?<![\p{L}])kteb|goulli|9olli|جاوبني|جاوب|اكتبلي|اكتب|قولي)\s+(?:\S+\s+){0,3}?\W{0,3}(?:oui|ih|iyeh|yes|إيه|ايه)(?![\p{L}])/u;
/** A confirmation that is not the order's: a cancellation, the phone number or the address the customer is asked to check. */
const OTHER_CONFIRMATION = /annul|cancel|(?<![\p{L}])b?t?batel|ألغ|الغ|إلغ|nlgh|num[eé]ro|t[eé]l[eé]phone|phone|number|ra9m|رقم|hatif|هاتف|adresse|address|3onwan|عنوان/u;
/** A question that asks which one (« Pouvez-vous me confirmer de quel produit il s'agit ? »): information, not a confirmation. */
const WHICH = /(?<![\p{L}])(?:quel(?:le)?s?|lequel|laquelle|lesquel(?:le)?s|which|wach\s+men|ach\s+men|أي|واش\s+من|شمن)(?![\p{L}])/u;
/** A confirming word about the order within a few words (« confirmer la commande ? », « on valide votre commande ? », « نأكدو الطلبية ؟ »). */
const CONFIRM_ORDER = new RegExp(String.raw`(?:${CONFIRM_WORD.source}|valid)\S*\s+(?:\S+\s+){0,3}?(?:command|order|achat|طلبي|الطلب|كوموند|komand)`, 'u');
/**
 * journey retest R10-2 (17/11): a sentence that asks the customer to confirm the order — « Pour confirmer : vous voulez bien le
 * Coffret cadeau Aïd … ? », « tu confirmes ? », « Répondez « oui » … », « Ktebli « ih » bach nconfirmi » — and not a cancellation,
 * a phone or an address to check. Said when no server recap is waiting (N5 T3), it is a confirmation without a recap.
 */
export const confirmRequest = (sentence: string): boolean =>
  bothForms(sentence).some(
    (v) =>
      !OTHER_CONFIRMATION.test(v) &&
      !WHICH.test(v) &&
      (CONFIRM_QUESTION.test(v) ||
        REPLY_YES.test(v) ||
        /(?:^|[.!?؟]\s+)\W*pour\s+confirmer/u.test(v) ||
        (/[?؟]/.test(v) && (CONFIRM_ORDER.test(v) || (CONFIRM_WORD.test(v) && ORDER_NOUN.test(v)))) ||
        ((!FIELD_WORD.test(v) || ORDER_NOUN.test(v)) && CONFIRM_FAMILY.some((re) => re.test(v))) ||
        (!FIELD_WORD.test(v) && PLACE_ON_YES.some((re) => re.test(v))) ||
        // journey retest R12-2 (17/11): the same request written as a statement, with no question mark (N21 T4 « عطيني من فضلك كي تحب
        // تأكد الطلبية. ») — never a field question, nor the shop's team calling to confirm
        (!FIELD_WORD.test(v) && !TEAM_CONFIRMS.test(v) && !CLAIM_NEGATION.test(v) && CONFIRM_STATEMENT.some((re) => re.test(v)))),
  );
/** The shop's team / the courier confirms by phone (« notre équipe vous appellera pour confirmer la commande »): information, no request. */
const TEAM_CONFIRMS =
  /(?<![\p{L}])(?:[eé]quipe|team|conseill\S*|livreur|courier|service\s+client|appel\S*|rappel\S*|call\S*|contact\S*|t[eé]l[eé]phon\S*|tilifoun\S*|الفريق|فريق|تلفون|تيليفون|بالتلفون|بالتيليفون|نعيطو\S*|يعيطو\S*|نتصلو\S*|يتصل\S*|نكلمو\S*|n3ayt\S*|y3ayt\S*|ncontact\S*)(?![\p{L}])/u;
/**
 * journey retest R12-2 (17/11): the confirm-request family without a question mark, in every language — a cue addressed to the
 * customer (« si vous voulez », « dites-moi quand », « vous pouvez », « let me know », « ila t7ebb », « goulli », « كي تحب », « قولي »,
 * « عطيني ») before a confirming verb, a confirming verb next to the order (« confirmer la commande », « tconfirmi la commande »,
 * « تأكد الطلبية »), « أكدلي ». Folded / lower-case text; the caller leaves out field questions and the team's phone call.
 */
const CONFIRM_STATEMENT: RegExp[] = [
  // French
  /(?<![\p{L}])(?:si|quand|lorsque)\s+(?:vous|tu)\s+(?:\S+\s+){0,3}?(?:confirm|valid)/u,
  /(?<![\p{L}])(?:dites|dis)[- ](?:moi|nous)\s+(?:\S+\s+){0,4}?(?:confirm|valid)/u,
  /(?<![\p{L}])(?:vous|tu)\s+(?:pouvez|peux|pourrez|pourras|devez|dois)\s+(?:maintenant\s+|juste\s+)?(?:me\s+|nous\s+)?(?:le\s+|la\s+|l['’]\s*)?(?:confirm|valid)/u,
  /(?<![\p{L}])(?:confirm|valid)(?:er|ez|e)(?![\p{L}])\s+(?:\S+\s+){0,1}?(?:la|votre|ta|ma)\s+commande/u,
  // English
  /let\s+me\s+know\s+(?:\S+\s+){0,4}?confirm|(?<![\p{L}])(?:if|when)\s+you\s+(?:\S+\s+){0,3}?confirm|you\s+(?:can|may)\s+(?:now\s+)?confirm|(?<![\p{L}])confirm\s+(?:the|your)\s+order/u,
  // arabizi
  /(?<![\p{L}])(?:ila|ida|ki|kif|goulli|gouli|9olli|a3tini|kteb\S*|t7ebb?\S*|t7ebi|bghit|7ab|7aba)\s+(?:\S+\s+){0,3}?(?:t|n)?(?:confirm\S*|(?:2|')?akk?[ei]d\S*)/u,
  /(?<![\p{L}])(?:t|n)?confirm\S*\s+(?:\S+\s+){0,2}?(?:la\s+|l['’]?\s*)?(?:commande|komand)|(?<![\p{L}])(?:t|n)(?:2|')?akk?[ei]?d\S*\s+(?:\S+\s+){0,2}?(?:la\s+|l['’]?\s*)?(?:commande|komand)/u,
  // Arabic script
  /(?:تحب|تحبي|حاب|حابة|حابه|بغيت|كي|اذا|إذا|ايلا|إلا|قولي|قوللي|عطيني|ابعثلي|فضلك)\s+(?:\S+\s+){0,3}?(?:ت|ن)?(?:تأكد|تاكد|أكد|اكد|ا\u0654كد)/u,
  /(?:تأكد|تاكد|أكد|اكد|ا\u0654كد|نأكد|ناكد|نا\u0654كد|نكد|تثبت|نثبت)\S*\s+(?:\S+\s+){0,3}?(?:ال)?(?:طلبي|طلب|كوموند)/u,
  /(?<![\p{L}])(?:أ|ا|ا\u0654|تأ|تا|تا\u0654)كد(?:ي|و|وا)?لي(?![\p{L}])/u,
];
/** The order named (any language), for an order claim. */
const CLAIM_NOUN = String.raw`(?:command\S*|order\S*|komand\S*|cmd|طلبي\S*|الطلب\S*|طلب(?:ك|كم)?|كوموند\S*)`;
/** Said done to the order (participle / passive), any language. */
const CLAIM_DONE = String.raw`(?:enregistr[eé]e?s?|valid[eé]e?s?|confirm[eé]e?s?|pass[eé]e?s?|not[eé]e?s?|prise?s?\s+en\s+compte|bien\s+re[cç]ue?|placed|registered|confirmed|noted|booked|recorded|submitted|tsajl\S*|tsejl\S*|tsjl\S*|msajl\S*|msejl\S*|t2akd\S*|tconfirma\S*|تسجل\S*|اتسجل\S*|مسجل\S*|تأكدت|تاكدت|تا\u0654كدت|مؤكد\S*|موكد\S*|مو\u0654كد\S*|تثبتت)(?![\p{L}])`;
/**
 * journey retest R12-2 (17/11): the family of « the order is registered » claims, whatever their wording — the order then a word
 * saying it is done (« votre commande est bien enregistrée », « order placed », « commande ta3ek tsajlet », « طلبيتك تسجلت »), or a
 * first-person / passive verb then the order (« j'ai enregistré votre commande », « I've placed your order », « sajjeltlek la
 * commande », « سجلتلك الطلب », « تم تسجيل الطلبية »).
 */
const ORDER_CLAIM: RegExp[] = [
  new RegExp(String.raw`(?<![\p{L}])${CLAIM_NOUN}\s+(?:\S+\s+){0,4}?${CLAIM_DONE}`, 'u'),
  /(?<![\p{L}])(?:j['’]?\s*ai|on\s+a|nous\s+avons|je\s+vous\s+ai|je\s+t['’]\s*ai)\s+(?:bien\s+|d[eé]j[aà]\s+)?(?:enregistr|not|pass|valid|confirm|pris|lanc|transmis|envoy)\S*\s+(?:\S+\s+){0,2}?(?:la\s+|votre\s+|ta\s+)?commande/u,
  /(?<![\p{L}])je\s+(?:vous\s+|te\s+)?(?:confirme|valide|enregistre|passe|lance)\s+(?:\S+\s+)?(?:votre|ta|la)\s+commande/u,
  /(?<![\p{L}])(?:i['’]?ve|i\s+have|we['’]?ve|we\s+have)\s+(?:just\s+|already\s+)?(?:placed|registered|noted|booked|recorded|confirmed|submitted)\s+(?:\S+\s+)?order/u,
  // journey retest R17-4 (18/11): the passive before the order too (« tsajlet la commande », « etsajlet la commande »)
  /(?<![\p{L}])(?:sajj?el|sejj?el|sjjel|sajj?alt|sajj?elt|confirmit|e?ts[ae]jj?l)\S*\s+(?:\S+\s+){0,2}?(?:la\s+|l['’]?\s*)?(?:commande|komand)/u,
  // journey retest R17-4 (18/11): « تسجلت الطلب », « اتسجلت الطلبية » (A3 T1, before any recap) — the passive before the order
  /(?:(?<![\p{L}])(?:ا?ت)?سجل\S*|(?<![\p{L}])تم\s+(?:ال)?(?:تسجيل|تأكيد|تاكيد|تا\u0654كيد)|(?<![\p{L}])(?:أ|ا|ا\u0654)كد(?:ت|نا)\S*|(?<![\p{L}])ثبت(?:ت|نا)\S*)\s+(?:\S+\s+){0,2}?(?:ال)?(?:طلب\S*|كوموند\S*)/u,
];
/** « c'est noté », « bien noté », « tsajlet », « noted », « سجلت » with nothing named: an order claim when it answers the customer's yes. */
const BARE_CLAIM =
  /c['’]?\s*est\s+(?:bien\s+)?(?:not[eé]|enregistr[eé]|pris)|(?<![\p{L}])(?:bien|tout\s+est)\s+not[eé]|(?<![\p{L}])(?:tsajl|tsejl|msajl|msejl)\S*|(?<![\p{L}])noted(?![\p{L}])|(?<![\p{L}])سجلت\S*|(?<![\p{L}])سجلنا\S*|(?<![\p{L}])تسجل\S*|(?<![\p{L}])مسجل\S*/u;
/** The customer's details noted (« j'ai bien noté vos coordonnées », R11-6 accepted): about the fields, no order claim. */
const DETAILS_WORD = /coordonn|d[eé]tails?|infos?(?![\p{L}])|informations?|ma3loumat|معلومات|المعلومات/u;
/** A negation: « pas encore enregistrée », « not placed yet », « mazal ma tsajletch », « ما تسجلتش » — no claim. */
const CLAIM_NEGATION = /(?<![\p{L}])(?:pas|jamais|aucune?|not|never|isn['’]?t|hasn['’]?t|haven['’]?t|mazal|mazel|machi|machy|لم|ليس|ليست|مازال\S*|مازالت|ماشي)(?![\p{L}])|(?<![\p{L}])ma\s*\S+c?h(?![\p{L}])|(?<![\p{L}])ما\s*\S+ش(?![\p{L}])|(?<![\p{L}])n['’]\s*(?:est|a|ai|avons)(?![\p{L}])/u;
/** A future / a purpose: « sera enregistrée dès … », « pour enregistrer la commande », « bach nsajjel », « باش نسجل الطلبية » — no claim. */
const CLAIM_LATER =
  /(?<![\p{L}])(?:sera|seront|serait|va\s+[eê]tre|vais|allons|will|would|going\s+to|once|d[eè]s\s+que|d[eè]s\s+(?:votre|ta|r[eé]ception)|une\s+fois|apr[eè]s|avant|pour\s+(?:que|pouvoir|enregistrer|valider|passer|confirmer|finaliser|lancer)|afin|bach|bech|mba3d|rah\s+n\S*|ghadi|غادي|راح|باش|بش|من\s+بعد|بعد\s+ما|قبل|لتسجيل|للتسجيل)(?![\p{L}])/u;
/**
 * journey retest R12-2 (17/11): a sentence that says the order is registered / placed / noted (« ممتاز، سجلتلك الطلب. », N18 T2,
 * with no recap and no order) — only true on the turn whose create_order placed it (the server writes that confirmation itself).
 * `customerYes`: the customer's message is a yes, so a bare « c'est noté » / « tsajlet » answers it as the order. `placed`: the
 * numbers of the orders placed in this conversation — a sentence naming one of them speaks of that real order. Never a question,
 * a negation, a future / purpose, nor (bare) a sentence about an order field (« c'est noté : Sétif »).
 */
export const orderClaim = (sentence: string, o: { customerYes?: boolean; placed?: readonly string[] } = {}): boolean => {
  if (/[?؟]/.test(sentence)) return false;
  const lower = sentence.toLowerCase();
  if ((o.placed ?? []).some((n) => n && lower.includes(n.toLowerCase()))) return false;
  // journey retest R17-4 (18/11): a negation or a future counts in the clause of the claim only — A3 T1 « أهلا سميرة، تسجلت الطلب: زوج … يعني
  // 5600 دج قبل التوصيل. » (« before delivery » in the next clause hid the claim)
  const claimIn = (v: string) => !CLAIM_NEGATION.test(v) && !CLAIM_LATER.test(v) && (ORDER_CLAIM.some((re) => re.test(v)) || (!!o.customerYes && !FIELD_WORD.test(v) && !DETAILS_WORD.test(v) && BARE_CLAIM.test(v)));
  return bothForms(sentence).some((v) => claimIn(v) || v.split(/[،:;؛]/u).some((c) => c.trim() && claimIn(c)));
};
/** A word naming the order (any language). */
const ORDER_NOUN = /command|order|achat|طلبي|الطلب|كوموند|komand/u;
/** An order field asked in the sentence (« donnez-moi votre adresse pour que je passe la commande »): a field question, no confirmation. */
const FIELD_WORD = /adresse|address|t[eé]l[eé]phone|phone|num[eé]ro|number|(?<![\p{L}])nom(?![\p{L}])|name|wilaya|commune|baladiya|quartier|cit[eé]|rue|street|taille|size|couleur|colou?r|pointure|quantit|smitek|ra9m|3onwan|عنوان|رقم|ولاية|بلدية|الاسم|سميتك|مقاس|لون/u;
/**
 * journey retest R11-1 (17/11): the family of « confirm it yourself » requests, whatever their wording — the model asks the customer
 * to confirm, or to say the word that lets it order (F1b T3 « Pouvez-vous confirmer pour que je passe la commande ? », no recap):
 * a modal (« pouvez-vous / voulez-vous / peux-tu (me) confirmer »), an imperative (« confirmez », « merci de confirmer »), a wait
 * for the confirmation (« dès votre confirmation », « une fois confirmé »), arabizi (« nconfirmi ? », « t2akked ? »,
 * « nsajjel la commande ? ») and Arabic (« تأكدلي ؟ », « نأكدلك الطلبية ؟ », « نسجلك الطلبية ؟ »). Folded / lower-case text.
 */
const CONFIRM_FAMILY: RegExp[] = [
  /(?<![\p{L}])(?:pouv|pourri|voul|peu[xt]|pourrai|souhait)\S*[- ](?:vous|tu)\s+(?:me\s+|nous\s+|bien\s+)?(?:le\s+|la\s+|les\s+|l['’]\s*)?confirm/u,
  /(?<![\p{L}])confirmez(?![\p{L}])|(?<![\p{L}])confirme[sz]?-(?:moi|nous)(?![\p{L}])|merci\s+de\s+(?:me\s+|nous\s+)?(?:le\s+|la\s+)?confirmer|il\s+(?:vous\s+|te\s+)?(?:suffit|reste(?:\s+juste)?\s+[aà])\s+(?:de\s+)?(?:me\s+)?confirmer|(?:can|could|would|will)\s+you\s+(?:please\s+)?confirm|please\s+confirm/u,
  /(?:d[eè]s|apr[eè]s|avec)\s+(?:votre|ta)\s+(?:confirmation|accord|feu\s+vert|validation)|d[eè]s\s+que\s+(?:vous|tu)\s+(?:me\s+)?(?:confirm|valid|dites\s+oui|dis\s+oui)|une\s+fois\s+(?:que\s+(?:vous|tu)\s+(?:aurez\s+|auras\s+)?)?(?:confirm|valid)|once\s+you\s+confirm|(?:attend|attends|attendons|j['’]\s*attends)\s+(?:juste\s+|seulement\s+)?(?:votre|ta|your)\s+(?:confirmation|accord|validation|r[eé]ponse)/u,
  /(?<![\p{L}])(?:n|t)?confirm(?:i|ilek|ilk|ilkom|iha|ihalek|ou|iw)(?![\p{L}])[^.!]*[?؟]|(?<![\p{L}])(?:t|n)(?:2|')?akk?[ei]?d(?:li|lek|lna|ou)?(?![\p{L}])[^.!]*[?؟]|(?<![\p{L}])(?:nsajj?el|nsejj?el|nkamm?el|nkemm?el|nfinali\S*|nvalidi|nlanci|nb3?at)\S*\s+(?:\S+\s+){0,2}?(?:la\s+|l['’]\s*)?(?:commande|komand)\S*\s*[?؟]/u,
  /(?:تأكد|تاكد|أكد|اكد|نأكد|ناكد|نكد)\S*(?:\s+\S+){0,3}\s*[?؟]|(?:نسجل|نكمل|نبعث|نأكد|ناكد|نعدي|نثبت)\S*\s+(?:\S+\s+){0,2}?(?:ال)?(?:طلبي|طلب|كوموند)\S*\s*[?؟]/u,
];
/**
 * journey retest R11-1: the order said to be placed on the customer's word (« … pour que je passe la commande », « et je valide votre
 * commande ? », « je lance la commande ? ») — a request to confirm when no recap is shown (never a sentence asking an order field).
 */
const PLACE_ON_YES: RegExp[] = [
  /(?<![\p{L}])(?:pour\s+que|afin\s+que|et|puis)\s+(?:je|j['’]|on|nous)\s*(?:la\s+|vous\s+la\s+|l['’]\s*)?(?:passe|valide|lance|enregistre|finalise|envoie|confirme)\S*\s+(?:\S+\s+){0,2}?(?:la\s+|votre\s+|ta\s+)?commande/u,
  /(?<![\p{L}])(?:je|j['’]|on|nous)\s*(?:la\s+|vous\s+la\s+|l['’]\s*)?(?:passe|valide|lance|enregistre|finalise|confirme)\S*(?:\s+(?:la|votre|ta)\s+commande)?\s*[?؟]/u,
  /(?:shall|should|can)\s+i\s+(?:place|confirm|submit)\s+(?:the|your)\s+order/u,
];
/**
 * journey retest R10-2: « Je vous ai bien noté », « c'est noté », « j'ai enregistré », « tsajjelt », « سجلت » — said after create_order
 * refused the product (out of stock / not available), it reads as « order noted » while nothing was.
 */
const NOTED = /(?<![\p{L}])(?:bien\s+)?not[eé]e?s?(?![\p{L}])|enregistr|c['’]?\s*est\s+pris|(?<![\p{L}])(?:tsajl|tsajjel|sajjelt|sajelt|msajl|msajjel)|سجلت|تسجلت|تسجل|سجلنا|noted|got\s+it\s+down|registered|(?<![\p{L}])i\s+have\s+(?:taken|put)\s+(?:it|you)\s+down/u;
export const notedClaim = (sentence: string): boolean => bothForms(sentence).some((v) => NOTED.test(v));
/**
 * journey retest R4-1 (17/11): a handoff answer never talks about a recap nor asks for a « oui » — no server recap goes with
 * it (F6 T3: « votre commande est bien récapitulée ci-dessus … Répondez oui pour la confirmer » with no recap above). Those
 * sentences are dropped; the rest (an answer to another question) stays.
 */
export const withoutRecapClaims = (reply: string): string => {
  const all = reply.trim().split(/(?<=[.!?؟])\s+|\n+/).filter((x) => x.trim());
  const kept = all.filter((x) => !aboutRecap(x));
  return kept.length === all.length ? reply : kept.join(' ').trim();
};

/**
 * journey retest R4-8 (17/11): the answer to an order of a blocked customer (04 §13: the shop cannot take it, the team takes
 * over, never « you are blocked »). The model wrote « Vous pouvez réessayer un peu plus tard » right above the shop's « Je
 * transmets à un membre de l'équipe … »: the server text agrees with that handoff line.
 */
const BLOCKED: Record<Loc, string> = {
  fr: 'Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper.',
  ar: 'ما نقدرش نأكد هذي الطلبية هنا، الفريق تاع المحل راح يتكفل بيها.',
  arabizi: 'Ma nqderch nconfirmi had la commande hna, l’équipe ta3 l’boutique rah tetkeffel biha.',
  en: 'I can’t confirm this order here: the shop’s team will take care of it.',
};
/** The blocked-customer text when a `create_order` of this turn answered CUSTOMER_BLOCKED, else null. */
export const blockedOrderText = (calls: { name: string; result: unknown }[], lang: AiLanguage | string | undefined): string | null =>
  calls.some((c) => c.name === 'create_order' && (c.result as { error?: { code?: unknown } } | null)?.error?.code === 'CUSTOMER_BLOCKED') ? BLOCKED[locOf(lang)] : null;

/** The confirmation of the order placed this turn, in the customer's language; null when no order was placed. */
export const orderConfirmationText = (calls: { name: string; result: unknown }[], lang: AiLanguage | string | undefined): string | null => {
  const o = placedOrder(calls);
  if (!o) return null;
  const t = T[locOf(lang)];
  const amount = (n: number) => `${money(n)} ${t.cur}`;
  const items = o.items.map((i) => {
    const qty = Number(i.quantity ?? 1) || 1;
    const unit = Number(i.unitPrice ?? 0) || 0;
    const name = [typeof i.name === 'string' ? i.name : '', typeof i.variant === 'string' && i.variant ? `(${i.variant})` : ''].filter(Boolean).join(' ');
    return `- ${qty} × ${name}${unit ? ` : ${amount(unit * qty)}` : ''}`;
  });
  const [a, b] = o.eta.split(/\s*[–-]\s*/);
  return [
    o.duplicate ? t.again(o.number) : t.head(o.number),
    ...items,
    o.deliveryFee > 0 ? t.fee(amount(o.deliveryFee)) : t.free,
    t.total(amount(o.total)),
    t.eta(a ?? '2', b ?? '5'),
    ...(o.beyondStock ? [t.beyond] : []),
    ...(o.replaced ? [t.replaced(o.replaced)] : []),
    t.thanks,
  ].join('\n');
};

/**
 * journey retest R5-5 (17/11): the customer's message asks whether / how the shop delivers there (« khouya twasslou l
 * Constantine ? », « vous livrez à Oran ? », « واش توصلو لقسنطينة ؟ »).
 */
const DELIVERY_WORD = /livr|deliver|twass?l|nwass?l|ywass?l|tawsil|توص|تبعثو|ترسلو/u;
export const asksDelivery = (text: string): boolean => {
  const t = folded(text).trim();
  return DELIVERY_WORD.test(t) && (/[?؟]/.test(t) || /^(?:wach|est[- ]ce|do you|can you|واش|هل)(?![\p{L}])/u.test(t));
};
const ANSWER: Record<Loc, (place: string, eta: [string, string] | null) => string> = {
  fr: (p, e) => `Oui, on livre à ${p}${e ? `, en ${e[0]} à ${e[1]} jours` : ''}.`,
  en: (p, e) => `Yes, we deliver to ${p}${e ? ` in ${e[0]} to ${e[1]} days` : ''}.`,
  arabizi: (p, e) => `Ih, nwasslou l ${p}${e ? `, f ${e[0]} l ${e[1]} ayam` : ''}.`,
  ar: (p, e) => `إيه، نوصلو لـ${p}${e ? `، من ${e[0]} إلى ${e[1]} أيام` : ''}.`,
};
/**
 * journey retest R5-5: when the server recap goes out with no sentence of the model before it and the customer's message asked
 * whether the shop delivers to the recap's wilaya / commune (N3 T3: « twasslou l Constantine ? » got the recap only), the
 * answer in words — the delay from this turn's quote_delivery when it gave one, then (R20-2) the home and stop-desk fees.
 * Null otherwise.
 */
export const deliveryAnswer = (calls: { name: string; result: unknown }[], customerText: string, lang: AiLanguage | string | undefined): string | null => {
  const recap = pendingRecap(calls);
  if (!recap || !asksDelivery(customerText)) return null;
  const said = wordsOf(customerText);
  const names = [recap.wilaya, recap.wilayaAr, recap.communeName, recap.communeAr].filter((n): n is string => !!n && n.trim().length >= 2);
  if (!names.some((n) => said.includes(wordsOf(n)) || (/[؀-ۿ]/.test(n) && said.includes(wordsOf(n).trim())))) return null;
  const loc = locOf(lang);
  const quote = [...calls].reverse().find((c) => c.name === 'quote_delivery' && (c.result as { ok?: unknown } | null)?.ok === true)?.result as { etaDays?: unknown } | undefined;
  const m = typeof quote?.etaDays === 'string' ? /^(\d+)\s*[–-]\s*(\d+)$/.exec(quote.etaDays) : null;
  // journey retest R19-1 (18/11): the place the customer asked about — « vous livrez à Bab Ezzouar ? » is answered for Bab Ezzouar (the
  // commune), « twasslou l Constantine ? » for the wilaya (this answer now often goes out with no model step after the recap)
  const named = (n: string | null | undefined) => !!n && n.trim().length >= 2 && (said.includes(wordsOf(n)) || (/[\u0600-\u06ff]/u.test(n) && said.includes(wordsOf(n).trim())));
  const wilaya = loc === 'ar' ? recap.wilayaAr || recap.wilaya : recap.wilaya;
  const commune = loc === 'ar' ? recap.communeAr || recap.communeName : recap.communeName;
  const place = !named(recap.wilaya) && !named(recap.wilayaAr) && (named(recap.communeName) || named(recap.communeAr)) ? commune : wilaya;
  if (!place) return null;
  // journey retest R20-2 (18/11): the answer carries the fees — home and stop-desk (R3-2 / R5-5 / R7-5 / R14-2): N3 T2 « Ih, nwasslou l Constantine,
  // f 2 l 5 ayam. » + the recap (home 700 DA on its line only, stop-desk 450 DA never said; R19 « … : 700 DA l dar, wela 450 DA f stop-desk. »)
  const fees = feesOf(recap, calls);
  return `${ANSWER[loc](place, m ? [m[1]!, m[2]!] : null)}${fees ? ` ${DELIVERY_FEES[loc](fees.home === 0 ? FREE_HOME_WORD[loc] : fees.home !== null ? amountOf(fees.home, loc) : null, fees.stop !== null ? amountOf(fees.stop, loc) : null)}` : ''}`;
};
/** journey retest R20-2: an amount as `formatMoney` writes it (« 12 500 DA », « دج » in Arabic script). */
const amountOf = (n: number, loc: Loc): string => (loc === 'ar' ? formatMoney(n).replace(/DA$/u, 'دج') : formatMoney(n));
const FREE_HOME_WORD: Record<Loc, string> = { fr: 'gratuite', ar: 'مجانية', arabizi: 'batel', en: 'free' };
const DELIVERY_FEES: Record<Loc, (home: string | null, stop: string | null) => string> = {
  fr: (h, s) => [h ? `À domicile : ${h}` : '', s ? `en stop-desk : ${s}` : ''].filter(Boolean).join(', ').replace(/^e/u, 'E') + '.',
  ar: (h, s) => [h ? `للدار: ${h}` : '', s ? `لنقطة الاستلام (stop-desk): ${s}` : ''].filter(Boolean).join('، ') + '.',
  arabizi: (h, s) => [h ? `L dar: ${h}` : '', s ? `f stop-desk: ${s}` : ''].filter(Boolean).join(', ').replace(/^f/u, 'F') + '.',
  en: (h, s) => [h ? `Home delivery: ${h}` : '', s ? `stop-desk: ${s}` : ''].filter(Boolean).join(', ').replace(/^s/u, 'S') + '.',
};
/**
 * journey retest R20-2: the home and stop-desk fees of the recap's wilaya — this turn's quote_delivery of it (a quote of an earlier turn reused
 * is passed in `calls` too), the recap's own fee for its mode (the free threshold applied). Null when nothing gives a fee.
 */
const feesOf = (recap: Recap, calls: { name: string; result: unknown }[]): { home: number | null; stop: number | null } | null => {
  const same = (n: unknown) => typeof n === 'string' && !!n.trim() && [recap.wilaya, recap.wilayaAr].some((w) => !!w && wordsOf(w) === wordsOf(n));
  type Q = { ok?: unknown; fee?: unknown; free?: unknown; isStopdesk?: unknown; stopdeskFee?: unknown; stopdeskAvailable?: unknown; wilayaName?: unknown; wilayaNameAr?: unknown };
  const quotes = calls.filter((c) => c.name === 'quote_delivery').map((c) => c.result as Q | null).filter((q): q is Q => q?.ok === true && typeof q.fee === 'number' && (same(q.wilayaName) || same(q.wilayaNameAr)));
  const home = quotes.find((q) => q.isStopdesk !== true);
  const stopQuote = quotes.find((q) => q.isStopdesk === true);
  const homeFee = recap.isStopdesk ? (home ? (home.free === true ? 0 : (home.fee as number)) : null) : recap.deliveryFee;
  const stopFee = recap.isStopdesk ? recap.deliveryFee : stopQuote ? (stopQuote.fee as number) : home && typeof home.stopdeskFee === 'number' && home.stopdeskAvailable !== false && home.stopdeskFee > 0 ? home.stopdeskFee : null;
  return homeFee === null && stopFee === null ? null : { home: homeFee, stop: stopFee };
};
