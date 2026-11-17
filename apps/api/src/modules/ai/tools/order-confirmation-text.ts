// Full-test 15/11 (AI improvement proposal 4): the customer's order confirmation is written by the server from the
// `create_order` result — number, items, delivery fee, total, delay, cash on delivery — in the customer's language, so
// the model can no longer confirm with wrong figures, « correct » itself (« commande enregistrée par erreur »,
// « coordonnées inventées ») or deny the order it just placed (AI-CHAT-02). Pure.
import type { AiLanguage } from '../language';

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
const locOf = (lang: AiLanguage | string | undefined): Loc => (lang === 'ar' ? 'ar' : lang === 'arabizi' ? 'arabizi' : lang === 'en' ? 'en' : 'fr');

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
const folded = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
export const withoutTrailingPlaces = (address: string, names: (string | null | undefined)[]): string => {
  const keys = names.filter((n): n is string => !!n && n.trim().length >= 2).map((n) => folded(n).replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  let out = address.trim();
  for (let guard = 0; guard < 4; guard++) {
    const cut = Math.max(out.lastIndexOf(','), out.lastIndexOf('،'));
    if (cut <= 0) break;
    const tail = folded(out.slice(cut + 1)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!tail || !keys.includes(tail) || !out.slice(0, cut).trim()) break;
    out = out.slice(0, cut).trim();
  }
  return out;
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
const aboutRecap = (x: string) => [folded(x), x.toLowerCase()].some((v) => CONFIRM_ASK.test(v) || RECAP_TALK.test(v));
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
 * answer in words — the fee is on the recap's delivery line, the delay from this turn's quote_delivery when it gave one.
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
  const place = loc === 'ar' ? recap.wilayaAr || recap.wilaya : recap.wilaya;
  return place ? ANSWER[loc](place, m ? [m[1]!, m[2]!] : null) : null;
};
