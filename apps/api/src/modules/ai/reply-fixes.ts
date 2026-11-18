// Journey retest R7 (17/11, docs/audit/journeys-2026-11-16/journeys/R7-ai-orders.md): the server's last word on the reply text
// for two cases the model kept missing — a photo request for a product that has none (R7-2), a « ? » / « ... » answered with
// « Oui, je suis là ! » / « Vous êtes toujours là ? » (R7-3). Pure.
import { formatMoney } from '@djaber/shared';
import { serverTextLanguage, type AiLanguage } from './language';
import { productNamedIn, productWanted } from './product-named';
import { FIELD_QUESTIONS, foldGuard, numbersIn, PHOTO_WORD, splitSentences, type CataloguePrice, type QuoteFact } from './reply-guard';
import { customerOwnName } from './tools/tool-registry';

const PHOTO = new RegExp(String.raw`(?<![\p{L}])${PHOTO_WORD}(?![\p{L}])`, 'u');
/**
 * The customer sends / refers to a photo of their own (« je vous envoie la photo », « comme sur la photo », « like in your
 * post's picture », « kima f tswira ») — not a request for the shop's photos.
 */
const OWN_PHOTO = new RegExp(
  [
    String.raw`je\s+vous\s+(?:envoie|ai\s+envoye)`, String.raw`j'?ai\s+envoye`, String.raw`voici\s+(?:la|une|ma|mon)\s`, String.raw`ci[- ]joint`, String.raw`i\s+(?:sent|am\s+sending|'?m\s+sending)`, String.raw`here\s+is\s+(?:a|the|my)\s`,
    String.raw`(?<![\p{L}])(?:b3att(?:lek|elkom)?|ba3att?lek|rani\s+ba3[e]?tlek)(?![\p{L}])`, 'بعثتلك', 'بعتتلك', String.raw`راني\s+باعثلك`,
    String.raw`(?<![\p{L}])(?:comme|sur|dans|like|kima|kif|f|fi|in)\s+${PHOTO_WORD}`,
  ].join('|'),
  'u',
);
/** journey retest R7-2: the customer's message asks for a photo / pictures of a product (« ab3athli tswira », « envoyez-moi une photo », « عندكم تصاور ؟ »). */
export const photoAsked = (text: string): boolean => {
  const f = foldGuard(text);
  return (PHOTO.test(f) || PHOTO.test(text.toLowerCase())) && !OWN_PHOTO.test(f);
};
/** The reply says there is no photo (« ma 3andnach tsawer », « pas encore de photo », « no picture », « ما عندناش تصاور »). */
const NO_PHOTO_SAID = new RegExp(
  String.raw`(?:(?<![\p{L}])(?:pas|aucune?|sans|no|not|ma\s*3and(?:na|i|ek)?(?:ch|ech|ich)?|makach|makanch|mkach|ماعندناش|ما\s*عندناش|ماعنديش|ماكانش|ما\s*كانش|ماكاش|مكانش|ماكانوش|لا\s+توجد|لا\s+يوجد|ليس|ليست)(?![\p{L}])|n't)[^.!?؟\n]{0,40}?${PHOTO_WORD}`,
  'u',
);
export const noPhotoSaid = (reply: string): boolean => NO_PHOTO_SAID.test(foldGuard(reply)) || NO_PHOTO_SAID.test(reply.toLowerCase());

type Loc = 'fr' | 'ar' | 'arabizi' | 'en';
// journey retest R9-1: the one language decision of the server texts (`serverTextLanguage`)
const locOf = (lang: AiLanguage | string | undefined): Loc => serverTextLanguage(lang);
/**
 * journey retest R19-3 (18/11): every amount the server writes, as `formatMoney` writes it (rule 11: « 20 000 DA », a no-break space between
 * the thousands and before the currency; « دج » in Arabic script) — PG1 « batel men 20000 DA », N5 « gratuite dès 20000 DA », PF1 « Sac à main
 * cuir (Marron) : 6900 DA » were written by the server without the thousands space (the recaps write « 6 900 DA »).
 */
export const amountText = (n: number, lang: AiLanguage | string | undefined): string => (locOf(lang) === 'ar' ? formatMoney(n).replace(/DA$/u, 'دج') : formatMoney(n));
const NO_PHOTO: Record<Loc, { one: string; many: string; offer: string }> = {
  fr: { one: "Nous n'avons pas encore de photo de ce produit", many: "Nous n'avons pas encore de photo de ces produits", offer: ', mais je peux vous donner tous les détails' },
  ar: { one: 'ما عندناش تصاور تاعو درك', many: 'ما عندناش تصاور تاعهم درك', offer: '، بصح نقدر نقولك كامل التفاصيل' },
  arabizi: { one: 'Ma 3andnach tsawer ta3ou f had lwaqt', many: 'Ma 3andnach tsawer ta3hom f had lwaqt', offer: ', bessah nqder n9ollek ga3 les détails' },
  en: { one: "We don't have a photo of this product yet", many: "We don't have photos of these products yet", offer: ', but I can give you all the details' },
};
/**
 * journey retest R7-2 (17/11): the reply to a photo request when no photo is sent and the products concerned are known to have
 * none (N9: « ab3athli tswira ta3 la robe kabyle brodée … » got the details and the card without a word on the photo — the
 * reply guard's rewrite had dropped that sentence). The server says it first, in the customer's language; when the reply
 * gives no detail itself, it offers them. The caller decides when (no photo sent, every product concerned without a photo).
 */
export const noPhotoReply = (reply: string, products: number, lang: AiLanguage | string | undefined): string => {
  const t = NO_PHOTO[locOf(lang)];
  const text = reply.trim();
  // a number of its own (a price, a size), not the digit of an arabizi word (« t7ebb »)
  const detailed = /(?<![\p{L}])\d+(?![\p{L}])/u.test(text) || (text.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 8;
  const lead = `${products > 1 ? t.many : t.one}${detailed ? '' : t.offer}.`;
  return text ? `${lead} ${text}` : lead;
};

/** journey retest R7-3: a message that is only punctuation or emoji (« ? », « ... », « … », « 👀 »). */
export const fillerMessage = (text: string | undefined): boolean => {
  const t = (text ?? '').trim();
  return !!t && t.length <= 12 && !/[\p{L}\p{N}]/u.test(t);
};
/** « Oui, je suis là ! », « Vous êtes toujours là ? », « I'm here », « Rani hna » (folded). */
const PRESENCE =
  /je\s+suis\s+(?:toujours\s+|bien\s+)?(?:la|ici)(?![\p{L}])|(?:vous\s+etes|tu\s+es|t'?es|etes[- ]vous|es[- ]tu)\s+(?:toujours\s+|encore\s+)?(?:la|ici)(?![\p{L}])|(?<![\p{L}])(?:toujours|encore)\s+la\s*(?:[?!.,]|$)|i'?m\s+(?:still\s+)?here|i\s+am\s+(?:still\s+)?here|(?:are\s+you\s+)?still\s+there|(?<![\p{L}])(?:rani|rak|raki|mazal(?:ek|ak|ni)?)\s+(?:hna|houna|m3ak|m3aya)(?![\p{L}])|(?:راني|راك|راكي|مازالك|مازالني)\s+(?:هنا|معاك|معايا)/u;
/**
 * journey retest R7-3 (17/11): the answer to a filler message keeps only the pending question — a short sentence about being
 * there / the customer still being there is dropped (N12: « ? » → « Oui, je suis là ! Pour commander … quel est votre nom ? »,
 * « ... » → « Vous êtes toujours là, Nadia ? Dans quelle wilaya … ? »). Nothing is dropped when nothing else would be left.
 */
export const withoutPresenceTalk = (reply: string): string => {
  const parts = splitSentences(reply);
  const kept = parts.filter((s) => !(PRESENCE.test(foldGuard(s)) && (s.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 8));
  if (kept.length === parts.length || !kept.join('').trim()) return reply;
  const text = kept.join('').trim();
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
};

// --- journey retest R9-3 (17/11): narrow wording fixes of the server, on every answer that is no recap / confirmation --------
/** « في الدرب » / « في الطريق » / « f trig » / « en route » — the order said to be on its way. */
const ON_ITS_WAY_AR = /(?:(?<![\p{L}])(?:و?مازالت|و?مازال|و?راهي|و?راه)\s+)?(?<![\p{L}])في\s+(?:ال)?(?:درب|طريق)(?![\p{L}])\s*[،,]?\s*/gu;
const ON_ITS_WAY_LATIN = /(?:(?<![\p{L}])(?:rahi|raha|mazal(?:et|t)?|mazel(?:et|t)?)\s+)?(?<![\p{L}])f\s*(?:e?ttri[gq9]|tri[gq9]|e?ddreb|derb)(?![\p{L}])\s*,?\s*|(?<![\p{L}])(?:est\s+)?(?:en\s+route|en\s+chemin|en\s+cours\s+de\s+livraison)(?![\p{L}])|(?<![\p{L}])(?:is\s+)?on\s+(?:its|the)\s+way(?![\p{L}])/giu;
/** The reply already says the order has not left the shop (« ما خرجتش », « راهي تتحضر », « ma khrjetch », « en préparation »). */
const NOT_SENT_SAID = /ما\s*خرجتش|ماخرجتش|ما\s*تبعثتش|تتحضر|تتوجد|ma\s*khr[e]?jet(?:ch|ech)|tet7adder|tet7adar|en\s+pr[ée]paration|pas\s+encore\s+(?:exp[ée]di|partie|envoy)|not\s+(?:yet\s+)?(?:been\s+)?(?:sent|shipped)|being\s+prepared/iu;
const NOT_SENT: Record<Loc, string> = { ar: 'مازالت ما خرجتش', arabizi: 'mazal ma khrjetch', fr: 'en préparation', en: 'being prepared' };
/**
 * journey retest R9-3 (17/11): the order wording follows the status lookup_order gave this turn — an order not sent yet
 * (`deliveryStatus: not_sent`) is never « في الدرب » (« on its way », N11 T3 next to « ما خرجتش »). When the reply already says it
 * has not left, the « on its way » words are dropped; otherwise they become the not-sent wording of the reply's script.
 */
export const withOrderStatusWording = (reply: string, lookups: unknown[]): string => {
  const orders = lookups.flatMap((r) => ((r as { orders?: unknown } | null)?.orders && Array.isArray((r as { orders: unknown[] }).orders) ? (r as { orders: { deliveryStatus?: unknown }[] }).orders : []));
  if (!orders.length || !orders.every((o) => o.deliveryStatus === 'not_sent')) return reply;
  const said = NOT_SENT_SAID.test(reply);
  const out = reply
    .replace(ON_ITS_WAY_AR, (m) => (said ? '' : `${NOT_SENT.ar}${/[،,]\s*$/u.test(m) ? '، ' : ' '}`))
    .replace(ON_ITS_WAY_LATIN, (m) => {
      if (said) return '';
      const tail = /,\s*$/.test(m) ? ', ' : /\s$/.test(m) ? ' ' : '';
      if (/^(?:rahi|raha|mazal|mazel|f\s*(?:e?ttri|tri|e?ddreb|derb))/iu.test(m)) return `${NOT_SENT.arabizi}${tail}`;
      if (/^(?:is\s+)?on\s/iu.test(m)) return `${/^is/iu.test(m) ? 'is ' : ''}${NOT_SENT.en}${tail}`;
      return `${/^est/iu.test(m) ? 'est ' : ''}${NOT_SENT.fr}${tail}`;
    });
  // journey retest R11-6 (17/11): « درك عند الشركة » for an order not sent yet (N11 T3) — the shop has it: « عندنا »
  const shop = out.replace(/(?<![\p{L}])عند\s+الشركة(?![\p{L}])/gu, 'عندنا');
  return shop === reply ? reply : shop.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,،!?؟])/gu, '$1').trim();
};
/**
 * journey retest R9-3: « درك » and « دروك » in one reply (N11 T3) — one word, the prompt's « درك ».
 * Journey retest R11-6 (17/11): and « درك » once — « طلبيتك … درك عند الشركة … ما عندهاش رقم تتبع درك » (two sentences): the later ones
 * are dropped.
 */
export const withOneNowWord = (reply: string): string => {
  const one = /(?<![\p{L}])درك(?![\p{L}])/u.test(reply) ? reply.replace(/(?<![\p{L}])دروك(?![\p{L}])/gu, 'درك') : reply;
  let seen = 0;
  const out = one.replace(/[ \t]*(?<![\p{L}])درك(?![\p{L}])/gu, (m) => (seen++ ? '' : m));
  return out === one ? one : out.replace(/[ \t]+([.,،!?؟])/gu, '$1');
};
/** An opening yes (« Ih, », « Oui, », « Yes, », « إيه، »). */
const OPENING_YES = /^(?:ih|iyeh|iyyeh|oui|ouais|yes|yeah|ايه|إيه|ايوه|نعم|واه)\s*[,،!]\s*/iu;
/** Words that make a message a yes / no question without a question mark (« kayen tapis ? », « 3andkom … », « disponible »), or a yes / no itself. */
const YES_NO_CUSTOMER = /(?<![\p{L}\p{N}])(?:kayen|kayna|kaynin|kayn|3andkom|3andek|disponible|dispo|available|in\s+stock|oui|ouais|non|ih|iyeh|lala|yes|no|ok|okay|d'accord|dakor|كاين|كاينة|عندكم|عندك|متوفر|ايه|إيه|لا|نعم|واه)(?![\p{L}\p{N}])/iu;
/**
 * journey retest R9-3 (17/11): « Ih, tapis de prière disponible, … » (F3 T1) — an opening « yes » that answers nothing: the
 * customer's message asks no question (no « ? », no question word, no « kayen / disponible ») and says no yes / no. It is dropped.
 */
export const withoutStrayYes = (reply: string, customerText: string | undefined, asks: (t: string | undefined) => boolean): string => {
  const m = OPENING_YES.exec(reply.trim());
  if (!m || asks(customerText) || YES_NO_CUSTOMER.test(customerText ?? '')) return reply;
  const rest = reply.trim().slice(m[0].length);
  return rest ? rest.charAt(0).toLocaleUpperCase() + rest.slice(1) : reply;
};

// --- journey retest R10-4 (17/11): narrow wording fixes of the server, on every answer that is no recap / confirmation -------
/**
 * « بسعر Hijab soie — 1500 دج » (N21 T1): the catalogue name pasted where the price goes — the Latin words between « بسعر » and a
 * dash before the amount are dropped (« بسعر 1500 دج »).
 */
const NAME_IN_PRICE_SLOT = /(?<![\p{L}])(بسعر|بثمن|بسومة|ب\s+سومة|سومتو|سومتها|ثمنو|ثمنها)\s+[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’ .]{0,40}?\s*[—–-]\s*(?=\d)/gu;
export const withoutNameInPriceSlot = (reply: string): string => reply.replace(NAME_IN_PRICE_SLOT, '$1 ');
/**
 * French words left in an arabizi reply (N9 T1 « … mais hiya robe kabyle brodée …, Les tailles disponibles: S, M w XL ») — the
 * Algerian words (« bessah », « li kaynin »). Arabizi answers only; product and variant names are no such words.
 */
const ARABIZI_FOR: [RegExp, (m: string, ...g: string[]) => string][] = [
  [/(?<![\p{L}'’])mais(?![\p{L}])/giu, (m) => (m[0] === 'M' ? 'Bessah' : 'bessah')],
  [/(?<![\p{L}])(les\s+(?:tailles|couleurs|pointures|mod[eè]les))\s+disponibles(?![\p{L}])/giu, (_m, what: string) => `${what} li kaynin`],
  // journey retest R11-6 (17/11): N9 T1 « brodée b la main w b tissu léger, zina l les fêtes »
  [/(?<![\p{L}])b\s+la\s+main(?![\p{L}])/giu, () => 'b lyedd'],
  [/(?<![\p{L}])tissu\s+l[ée]ger(?![\p{L}])/giu, () => 'qmach khfif'],
  [/(?<![\p{L}])l\s+les\s+f[êe]tes(?![\p{L}])/giu, () => 'l l3rass w lmounasabat'],
  [/(?<![\p{L}])les\s+f[êe]tes(?![\p{L}])/giu, () => 'l3rass w lmounasabat'],
  // journey retest R12-4 (17/11): N9 T1 « Tailles disponibles: S w M » (no « Les »), N3 T2 « Livraison à domicile: 700 DA, wela 450 DA
  // f stop-desk », F9 T1 « T7ebb nchouf wach men produit t7ebbou ? » (« you want I see which product you like? »)
  [/(?<![\p{L}])(tailles|couleurs|pointures|mod[eè]les)\s+disponibles(?![\p{L}])/giu, (_m, what: string) => `${what} li kaynin`],
  // journey retest R13-6 (18/11): N9 T1 « Tailles li kayn: S w M » — the sizes / colours in darija (« Lmqasat / Lalwan li kaynin »)
  [/(?<![\p{L}])(?:les\s+)?(tailles|pointures|couleurs)\s+li\s+kayn(?:in|ine|a)?(?![\p{L}])/giu, (m, what: string) => `${m[0] === m[0]!.toUpperCase() ? 'L' : 'l'}${/^couleurs$/iu.test(what) ? 'alwan' : 'mqasat'} li kaynin`],
  // journey retest R13-6: F9 T1 closing « T7ebb nwarrik produit m3a l livraison ? » (« you want I show you a product with the delivery? »)
  // journey retest R14-4 (18/11): F9 T1 « T7ebb nwarrik produit ? » (no « m3a l livraison » this time)
  [/(?<![\p{L}])t7ebb?\s+nwarr?ik\s+(?:l\s*)?(?:produit|les\s+produits|lproduit|chi\s+produit)(?:\s+m3a\s+l\s*livraison)?\s*([?؟])/giu, (m, mark: string) => `${m[0] === 'T' ? 'T' : 't'}7ebb nwarrik wach kayen 3andna ${mark}`],
  // journey retest R14-4: French left inside arabizi — N9 T1 « hiya brodée à la main, b qmach khfif, et mnasba bezzaf lel fêtes », N3 T2
  // « Tawsil l dar 700 DA, 2 à 5 jours. »
  // (« brodée » only after a darija pronoun: « Robe kabyle brodée » is a product name and stays)
  [/(?<![\p{L}])(hiya|hia|hya|rahi|raha)\s+brod[ée]e?(?![\p{L}])/giu, (_m, who: string) => `${who} mtarza`],
  [/(?<![\p{L}])[àa]\s+la\s+main(?![\p{L}])/giu, () => 'b lyedd'],
  // « , et » before a darija word (never before a French pronoun or article: a French sentence keeps its « et »)
  [/(?<=[,،]\s*)et(?=\s+(?!(?:nous|vous|tu|je|il|elle|ils|elles|on|le|la|les|un|une|des|du|de|c['’]|j['’]|qu)(?![\p{L}]))\p{Ll})/gu, () => 'w'],
  [/(?<![\p{L}])lel\s+f[êe]tes(?![\p{L}])/giu, () => 'l l3rass w lmounasabat'],
  [/(?<![\p{L}\p{N}])(\d+)\s*(?:à|a|-)\s*(\d+)\s+jours(?![\p{L}])/giu, (_m, a: string, b: string) => `${a} l ${b} ayam`],
  [/(?<![\p{L}])livraison\s+(?:[aà]\s+)?domicile(?![\p{L}])/giu, (m) => (m[0] === 'L' ? 'Tawsil l dar' : 'tawsil l dar')],
  [/(?<![\p{L}])livraison\s+(?:en\s+|f\s+)?stop[- ]?desk(?![\p{L}])/giu, (m) => (m[0] === 'L' ? 'Tawsil l stop-desk' : 'tawsil l stop-desk')],
  [/(?<![\p{L}])t7ebb?\s+n(?:chouf|warrik)\s+wach\s+men\s+([\p{L}'’-]+)\s+t7ebb?(?:ou|i)?\s*([?؟])/giu, (m, what: string, mark: string) => `${m[0] === 'T' ? 'W' : 'w'}ach men ${what} t7ebb ${mark}`],
  // journey retest R15-4 (18/11): French left inside arabizi — P2 T1 « Lmqasat li kaynin sont S et M a 4900 DA, et XL a 5200 DA »,
  // « parfaite pour l3rass »; F5 T1 « rani ndir lek la robe … » (« I am making it for you » for a product not yet ordered); F3 T1 « Bach
  // ngoulou commande bsmek »
  [/(?<![\p{L}])(li\s+kaynin)\s+sont(?![\p{L}])/giu, (_m, li: string) => `${li} homa`],
  [/(?<![\p{L}])et(?=\s+(?:X{0,3}L|X{0,3}S|M|\d{2,3})(?![\p{L}\p{N}]))/gu, () => 'w'],
  [/(?<![\p{L}])[aà]\s+(\d[\d \u00a0\u202f]*\d|\d)\s*(DA|دج)(?![\p{L}])/gu, (_m, n: string, cur: string) => `b ${n} ${cur}`],
  [/(?<![\p{L}])(parfaite?)s?\s+pour\s+(?:les?\s+|la\s+|l['’]\s*)?/giu, (_m, w: string) => (/e$/iu.test(w) ? 'mliha l ' : 'mlih l ')],
  [/(?<![\p{L}])rani\s+ndir\s?(?:lek|lik|lak)(?![\p{L}])(?!\s+(?:la\s+|l\s*['’]?\s*)?(?:commande|récap|recap))/giu, () => '3andna'],
  [/(?<![\p{L}])bach\s+ngoulou\s+(?:la\s+)?commande\s+b\s?sm(?:ek|itek)(?![\p{L}])/giu, (m) => `${m[0] === 'B' ? 'B' : 'b'}ach nsajjel la commande b smitek`],
  // journey retest R16-4 (18/11): the F9 closing came back as « T7ebb nwarrik produit men les produits li 3andna ? » — the family: « t7ebb
  // nwarrik / nchouflek » + any words naming « produit(s) / article(s) / 7aja » up to the question mark, in one sentence
  [/(?<![\p{L}])t7ebb?\s+n(?:warr?ik|chouflek)\s+(?:[^.!?؟\n]{0,60}?(?<![\p{L}]))?(?:l?produits?|articles?|7aja|haja)(?![\p{L}])[^.!?؟\n]{0,60}?\s*([?؟])/giu, (m, mark: string) => `${m[0] === 'T' ? 'T' : 't'}7ebb nwarrik wach kayen 3andna ${mark}`],
  // F9 « ma nwasslouch l Illizi f had lwaqt, wallah. » — no oath closing a sentence
  [/\s*,\s*wallah(?=\s*[.!?؟]|\s*$)/giu, () => ''],
  // French left inside arabizi — F5b T1 « La robe kabyle brodée taille M est disponible b 4900 DA », P2 T1 « Rahi disponible en S w M b 4900
  // DA, w en XL », PF2 T1 « Hijab soie 180 x 70 cm, disponible b 1500 DA », P2 « (L makach disponible) »
  [/(?<![\p{L}])(makach|makanch|ma\s*kanch)\s+disponibles?(?![\p{L}])/giu, (_m, no: string) => no],
  [/(?<![\p{L}])(rahi|raha|rahoum|rahom|rah|rahou)\s+disponibles?(?![\p{L}])/giu, (_m, who: string) => `${who} ${/^rah(?:i|a)$/iu.test(who) ? 'kayna' : /^rah(?:oum|om)$/iu.test(who) ? 'kaynin' : 'kayen'}`],
  [/(?<![\p{L}])(?:est|sont)\s+disponibles?(?![\p{L}])/giu, (m, ...rest: unknown[]) => {
    const at = rest.find((x) => typeof x === 'number') as number;
    const all = rest.find((x) => typeof x === 'string' && (x as string).length >= at) as string;
    const before = all.slice(0, at).split(/[.!?؟\n]/u).pop() ?? '';
    return /^sont/iu.test(m) ? 'kaynin' : /(?:^|[\s(])(?:la|l['’]|hiya|hia|rahi)\s/iu.test(` ${before}`) ? 'kayna' : 'kayen';
  }],
  [/(?<![\p{L}])disponibles?(?=\s+b\s+\d)/giu, () => 'kayen'],
  [/(?<![\p{L}])en(?=\s+(?:X{0,3}L|X{0,3}S|M)(?![\p{L}\p{N}]))/gu, () => 'f'],
  // journey retest R17-5 (18/11): French left inside arabizi — F9 T1 « Sétif : 650 DA à domicile, wela 350 DA f stop-desk », P2 T1 « …,
  // parfaite l l3rass w lmounasabat »
  [/(?<![\p{L}])[àa]\s+domicile(?![\p{L}])/giu, () => 'l dar'],
  [/(?<![\p{L}])(parfaite?)s?(?=\s+l\s)/giu, (m, w: string) => `${m[0] === 'P' ? 'M' : 'm'}${/e$/iu.test(w) ? 'liha' : 'lih'}`],
  // journey retest R18-4 (18/11): P2 T1 « tissu khfif, ideale l l3rass w lmounasabat »
  [/(?<![\p{L}])(id[ée]ale?)s?(?=\s+l\s)/giu, (m, w: string) => `${m[0] === 'I' ? 'M' : 'm'}${/e$/iu.test(w) ? 'liha' : 'lih'}`],
  [/(?<![\p{L}])(id[ée]ale?)s?\s+pour\s+(?:les?\s+|la\s+|l['’]\s*)?/giu, (m, w: string) => `${m[0] === 'I' ? 'M' : 'm'}${/e$/iu.test(w) ? 'liha' : 'lih'} l `],
];
export const withArabiziWords = (reply: string, lang: AiLanguage | string | undefined): string =>
  lang === 'arabizi' ? ARABIZI_FOR.reduce((t, [re, to]) => t.replace(re, to as (m: string, ...g: string[]) => string), reply) : reply;
/**
 * journey retest R12-4 (17/11): « DA » after an amount in a sentence written in Arabic script (N18 T1 « عندنا Djellaba homme بثمن 7500 DA
 * (كانت 9000 DA) … ») — « دج », as the server recap writes it. A sentence mostly in Latin letters keeps « DA ».
 */
export const withArabicCurrency = (reply: string): string =>
  splitSentences(reply)
    .map((s) => {
      if (!/\d\s*DA(?![\p{L}])/u.test(s)) return s;
      const arabic = (s.match(/[\u0600-ۿ]/gu) ?? []).length;
      const latin = (s.replace(/(?<=\d\s*)DA(?![\p{L}])/gu, '').match(/[A-Za-zÀ-ɏ]/gu) ?? []).length;
      return arabic > latin ? s.replace(/(\d)\s*DA(?![\p{L}])/gu, '$1 دج') : s;
    })
    .join('');

// --- journey retest R13 (18/11): server lines and narrow wording fixes ------------------------------------------------------------
/**
 * journey retest R13-6 (18/11): in a sentence written mostly in Arabic script, « taille unique » is « مقاس واحد » (and dropped when the
 * sentence already says « مقاس… واحد », N18 T1 « مقاسها واحد (taille unique) »), the Standard Arabic « نعم » is the darija « إيه » (A2 T1
 * « وعليكم السلام، نعم، … »), « نوصلوها لها » is « نوصلوهالك » (A4 T1). Arabic-script answers (`ar`) only.
 */
export const withArabicWords = (reply: string, lang: AiLanguage | string | undefined): string => {
  if (lang !== 'ar') return reply;
  return splitSentences(reply)
    .map((s) => {
      const arabic = (s.match(/[\u0600-\u06ff]/gu) ?? []).length;
      const latin = (s.replace(/taille\s+unique/giu, '').match(/[A-Za-zÀ-ɏ]/gu) ?? []).length;
      if (arabic <= latin) return s;
      let t = s;
      if (/(?<![\p{L}])مقاس\p{L}*\s+(?:واحد|وحدة|وحده)(?![\p{L}])/u.test(t)) t = t.replace(/\s*\(\s*taille\s+unique\s*\)/giu, '');
      t = t.replace(/(?<![\p{L}])taille\s+unique(?![\p{L}])/giu, 'مقاس واحد');
      t = t.replace(/(?<![\p{L}])نعم(?![\p{L}])/gu, 'إيه');
      // journey retest R22-4 (18/11): the darija yes is written « إيه » (P3 T1 « أيه، الساعة الذكية … »)
      t = t.replace(/(?<![\p{L}])أيه(?![\p{L}])/gu, 'إيه');
      t = t.replace(/(?<![\p{L}])نوصلوها\s+لها(?![\p{L}])/gu, 'نوصلوهالك');
      // journey retest R14-4 (18/11): Standard Arabic / odd forms in darija — A3 T1 « الكمية 2 من Tapis de prière، … والمنتج متوفر », A3b T1
      // « زوج تابيس الصلاة » (« tapis » in Arabic letters)
      t = t.replace(/(?<![\p{L}])الكمية\s+(\d+)\s+من\s+/gu, (_m, n: string) => (n === '2' ? 'زوج ' : `${n} `));
      t = t.replace(/(?<![\p{L}])(و?)(?:ال)?منتو?ج\s+متوفر(?![\p{L}])/gu, (_m, w: string) => `${w}راهو متوفر`);
      t = t.replace(/(?<![\p{L}])(?:ال)?تابيس\s+(?:ال)?صلاة(?![\p{L}])/gu, 'سجادات الصلاة');
      t = t.replace(/(?<![\p{L}])(?:ال)?تابي\s+(?:ال)?صلاة(?![\p{L}])/gu, 'سجادة الصلاة');
      return t;
    })
    .join('');
};

const HOME_FEE: Record<Loc, (fee: string) => string> = {
  fr: (f) => `La livraison à domicile est à ${f}.`,
  ar: (f) => `التوصيل للدار ب\u0640 ${f}.`,
  arabizi: (f) => `Tawsil l dar b ${f}.`,
  en: (f) => `Home delivery is ${f}.`,
};
const STOP_FEE: Record<Loc, (fee: string) => string> = {
  fr: (f) => `En stop-desk, c'est ${f}.`,
  ar: (f) => `ولا لنقطة الاستلام (stop-desk) ب\u0640 ${f}.`,
  arabizi: (f) => `Wela f stop-desk b ${f}.`,
  en: (f) => `Stop-desk delivery is ${f}.`,
};
/**
 * journey retest R13-6 (18/11): an answer that gives one delivery fee of a wilaya while this turn's quote_delivery gave both (home
 * and stop-desk, different) gets the other one, in the reply's language — F1b T2 « … Sinon, on peut aussi la livrer en stop-desk à
 * 350 DA. » (home 650 DA, quoted the same turn, not said). The home fee goes before the stop-desk sentence, the stop-desk fee after
 * the home one. A quote asked for the stop-desk only (its home fee unknown) adds nothing.
 */
export const withBothFees = (reply: string, quotes: readonly QuoteFact[], lang: AiLanguage | string | undefined): string => {
  let parts = splitSentences(reply);
  // journey J08r-7 #5: a reply that says home delivery is free for this cart gets no « La livraison à domicile est à 750 DA. » — the
  // two sentences contradicted each other (« … la livraison à domicile à Sétif est gratuite. La livraison à domicile est à 750 DA. »)
  const homeFree = (q: QuoteFact) => parts.some((p) => homeFreeClaim(p, q));
  const loc = locOf(lang);
  const has = (n: number) => numbersIn(foldGuard(parts.join(''))).includes(n);
  const at = (n: number) => parts.findIndex((p) => numbersIn(foldGuard(p)).includes(n));
  const sep = (p: string) => (/\s$/u.test(p) ? '' : ' ');
  for (const q of quotes) {
    if (q.isStopdesk || q.free || !(q.fee > 0) || q.stopdeskFee === null || !(q.stopdeskFee > 0) || q.stopdeskFee === q.fee) continue;
    if (has(q.stopdeskFee) && !has(q.fee)) {
      if (homeFree(q)) continue;
      const i = at(q.stopdeskFee);
      parts = [...parts.slice(0, i), `${HOME_FEE[loc](amountText(q.fee, loc))} `, ...parts.slice(i)];
    } else if (has(q.fee) && !has(q.stopdeskFee)) {
      const i = at(q.fee);
      parts = [...parts.slice(0, i + 1).map((p, k) => (k === i ? `${p}${sep(p)}` : p)), `${STOP_FEE[loc](amountText(q.stopdeskFee, loc))}${i + 1 < parts.length ? ' ' : ''}`, ...parts.slice(i + 1)];
    }
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
};

const FREE_CLAIM = /(?<![\p{L}])(?:gratuit\p{L}*|offert\p{L}*|free|batel|bla\s*flous|مجان\p{L}*)(?![\p{L}])/u;
const THRESHOLD_WORD = /(?<![\p{L}])(?:(?:des|from|above|men|من|ابتداء\s+من)\s*\d|a\s+partir|starting)/u;
/**
 * journey J08r-7 #5: a sentence that says home delivery is free (a free word + a home word, no stop-desk word), not the threshold
 * rule (« gratuite dès 10 000 DA » names the threshold or a « dès / à partir de / from / men » word).
 */
export const homeFreeClaim = (sentence: string, q: Pick<QuoteFact, 'freeFrom'>): boolean => {
  const f = foldGuard(sentence);
  if (!FREE_CLAIM.test(f) || !HOME_WORD.test(f) || STOP_WORD.test(f) || THRESHOLD_WORD.test(f)) return false;
  return !(q.freeFrom && numbersIn(f).includes(q.freeFrom));
};

/** A word of home delivery / of the stop-desk (folded text). */
const HOME_WORD = /(?<![\p{L}])(?:domicile|adresse|address|[وفب]?(?:ال)?عنوان(?:ك)?|a\s+la\s+maison|chez\s+vous|l\s*dar|ldar|l\s+bit|home|door|(?:[وفب]?(?:لل|ل|ال))(?:دار|بيت|منزل|دوميسيل))(?![\p{L}])/u;
const STOP_WORD = /(?<![\p{L}])(?:stop\s*-?\s*desk|stopdesk|point\s+(?:de\s+)?relais|bureau\s+(?:de\s+)?(?:livraison|la\s+societe)|[وفب]?(?:ل|ال|لل)?(?:نقطه\s+(?:ال)?استلام|ستوب\s*ديسك|مكتب))(?![\p{L}])/u;
/**
 * journey retest R14-2 (18/11): a sentence of the reply that asks the customer to choose home delivery (or their address) or the stop-desk
 * (both named, as a question or with « ou / wela / ولا / or ») — the server's own address question too — F1b T2 « … préférez-vous être livré à domicile (il me faut alors votre rue ou
 * votre cité) ou au stop-desk ? ». The index of that sentence, -1 when none.
 */
export const modeQuestionAt = (reply: string): number =>
  splitSentences(reply).findIndex((s) => {
    const f = foldGuard(s);
    return HOME_WORD.test(f) && STOP_WORD.test(f) && (/[?؟]/.test(s) || /(?<![\p{L}])(?:ou|wela|wla|walla|ولا|او|أو|or)(?![\p{L}])/u.test(f));
  });
const MODE_FEES: Record<Loc, (home: string, stop: string | null) => string> = {
  fr: (h, s) => `À domicile : ${h}${s ? `, en stop-desk : ${s}` : ''}.`,
  ar: (h, s) => `للدار: ${h}${s ? `، لنقطة الاستلام (stop-desk): ${s}` : ''}.`,
  arabizi: (h, s) => `L dar: ${h}${s ? `, f stop-desk: ${s}` : ''}.`,
  en: (h, s) => `Home delivery: ${h}${s ? `, stop-desk: ${s}` : ''}.`,
};
const FREE_HOME: Record<Loc, string> = { fr: 'gratuite', ar: 'مجانية', arabizi: 'batel', en: 'free' };
/**
 * journey retest R14-2 (18/11): the question « home or stop-desk? » always carries both fees — F1b T2 « Sétif, El Eulma » ⇒ « préférez-vous
 * être livré à domicile … ou au stop-desk ? » with no fee at all (no quote_delivery that turn: the server runs it, see ai-run). The fee
 * sentence of this turn's quote goes right before the question when the reply gives neither fee; one fee given is completed by
 * `withBothFees`. No quote, or a reply that asks no mode ⇒ unchanged.
 */
export const withModeFees = (reply: string, quotes: readonly QuoteFact[], lang: AiLanguage | string | undefined): string => {
  const q = quotes.find((x) => !x.isStopdesk);
  const i = modeQuestionAt(reply);
  if (!q || i < 0) return reply;
  const nums = numbersIn(foldGuard(reply));
  if ((q.fee > 0 && nums.includes(q.fee)) || (q.stopdeskFee !== null && nums.includes(q.stopdeskFee))) return reply;
  const loc = locOf(lang);
  const home = q.free || q.fee === 0 ? FREE_HOME[loc] : amountText(q.fee, loc);
  const parts = splitSentences(reply);
  const line = MODE_FEES[loc](home, q.stopdeskFee !== null && q.stopdeskFee > 0 ? amountText(q.stopdeskFee, loc) : null);
  // journey retest R19-3 (18/11): before the reply's questions, never between two of them (PG2 T2 « واش العنوان تاعك في بوفاريك؟ للدار: 450 دج، … عطيني
  // الشارع … ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟ »)
  const at = questionBlockStart(parts, i);
  return [...parts.slice(0, at).map((p, k) => (k === at - 1 && !/\s$/u.test(p) ? `${p} ` : p)), `${line} `, ...parts.slice(at)].join('').replace(/[ \t]+\n/g, '\n').trim();
};
/** journey retest R19-3 (18/11): the first sentence of the run of questions that ends at sentence `at` (server facts go before it). */
const questionBlockStart = (parts: readonly string[], at: number): number => {
  let k = at;
  while (k > 0 && /[?؟]/u.test(parts[k - 1]!)) k--;
  return k;
};
/** journey retest R22-4: a sentence about the delivery (its delay, that it may take longer), folded — the product line goes before it. */
const DELIVERY_REMARK = /(?<![\p{L}])(?:livraison|livrer|livree|delai|delivery|deliver|delivered|tawsil|التوصيل|توصيل)(?![\p{L}])/u;
/** journey retest R19-3: a sentence giving a delivery fee (an amount with its currency and a delivery / home / stop-desk word). */
const feeLine = (s: string): boolean => {
  const f = foldGuard(s);
  return /\d[\d \u00a0\u202f.,]*\s*(?:da|dzd|دج|دينار)(?![\p{L}])/iu.test(s) && (HOME_WORD.test(f) || STOP_WORD.test(f) || /(?<![\p{L}])(?:livraison|livrer|tawsil|delivery|التوصيل|توصيل)(?![\p{L}])/u.test(f));
};

/**
 * journey retest R14-4 (18/11): the AI's sentence of a turn handed to the team when the model wrote none — W1 « prix de gros pour 50
 * pièces du hijab soie ? » got only the system line. One short sentence in the customer's language: the team will answer.
 */
export const handoffLine = (lang: AiLanguage | string | undefined): string => handoffReply('other', lang);

// --- journey retest R15-2 (18/11): one hand-off sentence per reason, in the customer's language and script ------------------------
/** What the customer handed to the team is about: a person asked for, a refund, a complaint (or anger), anything else. */
// journey retest R16-2 (18/11): what only the team can answer gets its own sentence — wholesale (« prix de gros », a quote), a custom order,
// a partnership (W1 « prix de gros pour 50 pièces du hijab soie ? » ⇒ « Pour le prix de gros, l'équipe de la boutique va vous répondre. »)
export type HandoffKind = 'person' | 'refund' | 'complaint' | 'team' | 'wholesale' | 'custom' | 'partner';
const WHOLESALE_WORD = /(?<![\p{L}])(?:gros|grossiste|revendeu\w*|wholesale|reseller|jumla|jomla|(?:ال|بال|ب)?جمله|devis|quotation)(?![\p{L}])/u;
const CUSTOM_WORD = /(?<![\p{L}])(?:sur\s+mesure|personnalis\w*|custom\w*)(?![\p{L}])/u;
const PARTNER_WORD = /(?<![\p{L}])(?:partenariat|partner\w*|collaboration)(?![\p{L}])/u;
/** journey retest R16-2: a request only the team can answer, read from the customer's message (null: none). */
export const teamOnlyKind = (customerText: string | undefined): 'wholesale' | 'custom' | 'partner' | null => {
  const f = foldGuard(customerText ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ');
  return WHOLESALE_WORD.test(f) ? 'wholesale' : CUSTOM_WORD.test(f) ? 'custom' : PARTNER_WORD.test(f) ? 'partner' : null;
};
export const handoffKind = (reason: string | null | undefined, customerText?: string): HandoffKind =>
  reason === 'customer_request' || reason === 'keyword' ? 'person' : reason === 'refund' ? 'refund' : reason === 'complaint' || reason === 'angry' ? 'complaint' : (teamOnlyKind(customerText) ?? 'team');
/** The opening of the sentence (thanks, of course, sorry) and what the team does — in hours, and out of hours (at the opening). */
const HANDOFF_LEAD: Record<Loc, Record<HandoffKind, string>> = {
  fr: { person: 'Bien sûr', refund: 'Désolé pour ce problème', complaint: 'Désolé pour ce problème', team: 'Merci pour votre message', wholesale: '', custom: '', partner: '' },
  ar: { person: 'أكيد', refund: 'سمحلي على هاد المشكل', complaint: 'سمحلي على هاد المشكل', team: 'شكرا على رسالتك', wholesale: '', custom: '', partner: '' },
  arabizi: { person: 'Ih akid', refund: 'Sme7li 3la had lmochkil', complaint: 'Sme7li 3la had lmochkil', team: 'Saha 3la le message', wholesale: '', custom: '', partner: '' },
  en: { person: 'Of course', refund: 'Sorry about this problem', complaint: 'Sorry about this problem', team: 'Thanks for your message', wholesale: '', custom: '', partner: '' },
};
const HANDOFF_TEAM: Record<Loc, Record<HandoffKind, { now: string; later: string }>> = {
  fr: {
    person: { now: "je vous mets en relation avec l'équipe de la boutique", later: "l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture" },
    refund: { now: "l'équipe de la boutique va voir le remboursement avec vous", later: "l'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture" },
    complaint: { now: "l'équipe de la boutique va s'en occuper avec vous", later: "l'équipe de la boutique est absente pour le moment, elle s'en occupera avec vous dès l'ouverture" },
    team: { now: "l'équipe de la boutique va vous répondre", later: "l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture" },
    wholesale: { now: "pour le prix de gros, l'équipe de la boutique va vous répondre", later: "pour le prix de gros, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture" },
    custom: { now: "pour une commande sur mesure, l'équipe de la boutique va vous répondre", later: "pour une commande sur mesure, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture" },
    partner: { now: "pour un partenariat, l'équipe de la boutique va vous répondre", later: "pour un partenariat, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture" },
  },
  ar: {
    person: { now: 'راح نوصلك بواحد من فريق المحل', later: 'فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو' },
    refund: { now: 'فريق المحل راح يشوف معاك ترجيع الدراهم', later: 'فريق المحل ماهوش متوفر درك، راح يشوف معاك ترجيع الدراهم كي نفتحو' },
    complaint: { now: 'فريق المحل راح يتكفل بيها معاك', later: 'فريق المحل ماهوش متوفر درك، راح يتكفل بيها معاك كي نفتحو' },
    team: { now: 'فريق المحل راح يجاوبك', later: 'فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو' },
    wholesale: { now: 'على سومة الجملة، فريق المحل راح يجاوبك', later: 'على سومة الجملة، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو' },
    custom: { now: 'على الطلبية الخاصة، فريق المحل راح يجاوبك', later: 'على الطلبية الخاصة، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو' },
    partner: { now: 'على الشراكة، فريق المحل راح يجاوبك', later: 'على الشراكة، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو' },
  },
  arabizi: {
    person: { now: "rani nwasslek m3a wa7ed men l'équipe ta3 lboutique", later: "l'équipe ta3 lboutique ma kanetch dork, rah tjawbek ki n7ellou" },
    refund: { now: "l'équipe ta3 lboutique rah tchouf m3ak le remboursement", later: "l'équipe ta3 lboutique ma kanetch dork, rah tchouf m3ak le remboursement ki n7ellou" },
    complaint: { now: "l'équipe ta3 lboutique rah tetkeffel biha m3ak", later: "l'équipe ta3 lboutique ma kanetch dork, rah tetkeffel biha m3ak ki n7ellou" },
    team: { now: "l'équipe ta3 lboutique rah tjawbek", later: "l'équipe ta3 lboutique ma kanetch dork, rah tjawbek ki n7ellou" },
    wholesale: { now: "3la soum ta3 jomla, l'équipe ta3 lboutique rah tjawbek", later: "3la soum ta3 jomla, l'équipe ta3 lboutique ma kanetch dork, rah tjawbek ki n7ellou" },
    custom: { now: "3la la commande spéciale, l'équipe ta3 lboutique rah tjawbek", later: "3la la commande spéciale, l'équipe ta3 lboutique ma kanetch dork, rah tjawbek ki n7ellou" },
    partner: { now: "3la le partenariat, l'équipe ta3 lboutique rah tjawbek", later: "3la le partenariat, l'équipe ta3 lboutique ma kanetch dork, rah tjawbek ki n7ellou" },
  },
  en: {
    person: { now: "I'm putting you in touch with the shop's team", later: "the shop's team is away right now and will answer you as soon as the shop opens" },
    refund: { now: "the shop's team will look at the refund with you", later: "the shop's team is away right now and will look at the refund with you as soon as the shop opens" },
    complaint: { now: "the shop's team will take care of it with you", later: "the shop's team is away right now and will take care of it with you as soon as the shop opens" },
    team: { now: "the shop's team will answer you", later: "the shop's team is away right now and will answer you as soon as the shop opens" },
    wholesale: { now: "for the wholesale price, the shop's team will answer you", later: "for the wholesale price, the shop's team is away right now and will answer you as soon as the shop opens" },
    custom: { now: "for a custom order, the shop's team will answer you", later: "for a custom order, the shop's team is away right now and will answer you as soon as the shop opens" },
    partner: { now: "for a partnership, the shop's team will answer you", later: "for a partnership, the shop's team is away right now and will answer you as soon as the shop opens" },
  },
};
const capital = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
/**
 * journey retest R15-2 (18/11): the AI's sentence of a turn handed to the team — one per reason (H1 « je veux parler à quelqu'un » and
 * H2 got an empty text, C1 « commande cassée … remboursement » the generic W1 sentence), in the customer's language and script
 * (arabizi stays arabizi). Out of hours it says the team answers at the opening, never « très vite » (C1 / H2 on the J03 shop showed
 * « Notre équipe est absente … » then « … qui vous répondra très vite »). `tail`: only what the team does, after the model's own sentence.
 */
export const handoffReply = (reason: string | null | undefined, lang: AiLanguage | string | undefined, o: { outOfHours?: boolean; tail?: boolean; customerText?: string } = {}): string => {
  const loc = locOf(lang);
  const kind = handoffKind(reason, o.customerText);
  const team = HANDOFF_TEAM[loc][kind][o.outOfHours ? 'later' : 'now'];
  if (o.tail || !HANDOFF_LEAD[loc][kind]) return `${capital(team)}.`;
  const sep = loc === 'ar' ? '، ' : kind === 'person' && !o.outOfHours ? ', ' : loc === 'fr' ? ' : ' : ', ';
  return `${HANDOFF_LEAD[loc][kind]}${sep}${team}.`;
};
/**
 * journey re-run J03r-1 (18/11, Major): the AI's sentence of a turn handed to the team for the order limit — it says the limit, so the
 * customer knows why (« Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous
 * répondre. »), never an offer of the maximum. Out of hours it says the team answers at the opening. In the customer's language and script.
 */
export const limitHandoffReply = (limit: { kind: 'quantity' | 'amount'; value: number }, lang: AiLanguage | string | undefined, o: { outOfHours?: boolean } = {}): string => {
  const loc = locOf(lang);
  const n = limit.value;
  const what =
    limit.kind === 'amount'
      ? amountText(n, lang)
      : loc === 'fr'
        ? `${n} ${n === 1 ? 'pièce' : 'pièces'}`
        : loc === 'ar'
          ? `${n} ${n >= 3 && n <= 10 ? 'حبات' : 'حبة'}`
          : loc === 'arabizi'
            ? `${n} ${n === 1 ? 'pièce' : 'pièces'}`
            : `${n} ${n === 1 ? 'piece' : 'pieces'}`;
  const ooh = !!o.outOfHours;
  switch (loc) {
    case 'ar':
      return `الطلبية الوحدة ما تفوتش ${what}، راني نبعث طلبك لفريق المحل${ooh ? '، ماهوش متوفر درك وراح يجاوبك كي نفتحو' : ' وراح يجاوبك'}.`;
    case 'arabizi':
      return `La commande wa7da ma tfoutch ${what}, rani nba3at talab ta3ek l l'équipe ta3 lboutique${ooh ? ", ma kanetch dork w rah tjawbek ki n7ellou" : ' w rah tjawbek'}.`;
    case 'en':
      return `One order can't go above ${what}: I'm passing your request to the shop's team${ooh ? ', who is away right now and will answer you as soon as the shop opens' : ', who will answer you'}.`;
    default:
      return `Une commande ne peut pas dépasser ${what} : je transmets votre demande à l'équipe de la boutique${ooh ? ", absente pour le moment, qui vous répondra dès l'ouverture" : ', qui va vous répondre'}.`;
  }
};
/** journey re-run J04r-2 (18/11): the answer to « elle est bien annulée ? » after the cancellation the server made — never a doubt. */
export const cancelledReply = (number: string, lang: AiLanguage | string | undefined): string => {
  switch (locOf(lang)) {
    case 'ar':
      return `إيه، الطلبية ${number} راهي ملغية.`;
    case 'arabizi':
      return `Ih, la commande ${number} rahi mbatla.`;
    case 'en':
      return `Yes, order ${number} is cancelled.`;
    default:
      return `Oui, la commande ${number} est bien annulée.`;
  }
};
/** A sentence saying an order is (or was just) cancelled — « est annulée », « a été annulée », « j'ai annulé », « تلغات », « rahi mbatla ». */
const CANCEL_CLAIM = /(?<![\p{L}])(?:(?:est|a\s+ete|a\s+bien\s+ete|bien|c\s+est|j\s+ai|je\s+l\s+ai|on\s+a|vient\s+d\s+etre|sont)\s+(?:bien\s+)?annule\w*|annulation\s+(?:est\s+)?(?:faite|effectuee|confirmee|enregistree)|(?:is|was|has\s+been|have\s+been|i\s+have|i\s+ve|i)\s+(?:now\s+)?cancell?ed|tbatlet|tbatlat|rahi\s+mbatla|rahi\s+mbatel|تلغات|اتلغات|تلغت|انلغت|راهي\s+ملغيه|راهي\s+ملغاه|الغيتها|لغيتها|تم\s+الغاء|تم\s+إلغاء)(?![\p{L}])/u;
const CLAIM_NEGATION = /(?<![\p{L}])(?:pas|ne|n|jamais|not|never|no|ma|machi|mazal|ماشي|مازال|ما|لم|ليست|غير)(?![\p{L}])/u;
/** journey re-run J04r-2: the reply says an order is cancelled (with no negation in that sentence). */
export const cancelClaimed = (reply: string): boolean => splitSentences(reply).some((s) => {
  const f = foldGuard(s).replace(/[^\p{L}\p{N}]+/gu, ' ');
  return CANCEL_CLAIM.test(f) && !CLAIM_NEGATION.test(f.replace(CANCEL_CLAIM, ' '));
});
/** journey re-run J04r-2: nothing was cancelled this turn — the question that asks which open order to cancel (or to confirm the one). */
export const cancelQuestion = (numbers: readonly string[], lang: AiLanguage | string | undefined): string => {
  const loc = locOf(lang);
  if (!numbers.length) return loc === 'ar' ? 'ما لقيت حتى طلبية مفتوحة باش نلغيها.' : loc === 'arabizi' ? 'Ma lqit hatta commande ma7loula bach nbatlha.' : loc === 'en' ? "I can't find an open order to cancel." : 'Je ne trouve aucune commande en cours à annuler.';
  const one = numbers.length === 1 ? numbers[0]! : null;
  const list = numbers.join(loc === 'ar' ? ' ولا ' : loc === 'arabizi' ? ' wela ' : loc === 'en' ? ' or ' : ' ou ');
  switch (loc) {
    case 'ar':
      return one ? `تحب نلغيو الطلبية ${one} ؟` : `أي طلبية تحب نلغيو: ${list} ؟`;
    case 'arabizi':
      return one ? `T7ebb nbatlou la commande ${one} ?` : `Ama commande t7ebb nbatlou: ${list} ?`;
    case 'en':
      return one ? `Would you like me to cancel order ${one}?` : `Which order would you like to cancel: ${list}?`;
    default:
      return one ? `Voulez-vous que j'annule la commande ${one} ?` : `Quelle commande voulez-vous annuler : ${list} ?`;
  }
};
/** A sentence promising a quick answer (« très vite », « rapidement », « bientôt », « shortly », « قريبا », « dghya »), folded. */
const QUICK_REPLY = /(?<![\p{L}])(?:tres\s+vite|vite|rapidement|au\s+plus\s+vite|bientot|sous\s+peu|tout\s+de\s+suite|immediatement|dans\s+(?:les|quelques)\s+(?:minutes|instants)|shortly|soon|right\s+away|asap|qriban|9riban|dghya|قريبا|حالا|دغيا|فيسع|فالحين)(?![\p{L}])/u;
/** The sentence already tells when the team answers out of hours (« dès l'ouverture », « demain », « ki n7ellou », « كي نفتحو »). */
const OPENING_SAID = /(?<![\p{L}])(?:ouverture|reouverture|horaires?|demain|opening|opens|tomorrow|n7ellou|n7el|tefta7|nefta7|nfat7ou|ghodwa|ghedwa|غدوة|نفتحو|نفتح|يفتح|الفتح|العمل)(?![\p{L}])/u;
/**
 * journey retest R15-2: the model's own sentence of an out-of-hours hand-off, without the sentences promising a quick answer (the team
 * is away: « vous répondra très vite » next to « Notre équipe est absente » contradicts it).
 */
export const withoutQuickReply = (reply: string): string => {
  const parts = splitSentences(reply);
  const kept = parts.filter((s) => !QUICK_REPLY.test(foldGuard(s)));
  return kept.length === parts.length ? reply : kept.join('').trim();
};
export const openingSaid = (reply: string): boolean => OPENING_SAID.test(foldGuard(reply));
/**
 * journey retest R15-2: the shop's hand-off system line is shown with this turn — not out of hours (it promises a quick answer: the
 * AI's sentence says the team answers at the opening instead), nor on an arabizi turn whose system texts would be in Arabic script
 * (C2: the Arabic-script hand-off line shown to an arabizi customer — the arabizi sentence of the AI says it).
 */
export const handoffSystemLineShown = (lang: AiLanguage | string | undefined, outOfHours: boolean | undefined, systemLocale: string): boolean => !outOfHours && !(lang === 'arabizi' && systemLocale === 'ar');

// --- journey retest R15-1 (18/11): a place given with no quote yet — the reply carries the product's price and both fees ---------------
/** A question of the reply asking the street address (« Wach howa l'adresse ta3ek … ? », « Quelle est votre adresse ? », « العنوان ؟ »). */
// (the word of the address itself: « cité 1000 logements » quoted back in a question asks nothing)
const ADDRESS_ASK = /(?<![\p{L}])(?:adresse|address|[وفب]?(?:ال)?عنوان(?:ك)?)(?![\p{L}])/u;
export const asksAddress = (reply: string): boolean => splitSentences(reply).some((s) => /[?؟]/u.test(s) && ADDRESS_ASK.test(foldGuard(s)));
const PLACE_FEES: Record<Loc, (home: string, stop: string | null) => string> = {
  fr: (h, s) => (s ? `Livraison : ${h} à domicile, ou ${s} en stop-desk si vous préférez.` : `Livraison à domicile : ${h}.`),
  ar: (h, s) => (s ? `التوصيل: ${h} للدار، ولا ${s} لنقطة الاستلام (stop-desk) إذا تحب.` : `التوصيل للدار: ${h}.`),
  arabizi: (h, s) => (s ? `Tawsil: ${h} l dar, wela ${s} f stop-desk ila t7ebb.` : `Tawsil l dar: ${h}.`),
  en: (h, s) => (s ? `Delivery: ${h} to your door, or ${s} at a stop-desk if you prefer.` : `Home delivery: ${h}.`),
};
const PRODUCT_PRICE: Record<Loc, (name: string, price: string) => string> = {
  fr: (n, p) => `${n} : ${p}.`,
  ar: (n, p) => `${n} ب\u0640 ${p}.`,
  arabizi: (n, p) => `${n} b ${p}.`,
  en: (n, p) => `${n}: ${p}.`,
};
export type PlaceProduct = { name: string; variant?: string | null; price: number };
const FREE_FROM: Record<Loc, (t: string) => string> = { fr: (t) => ` (gratuite dès ${t})`, ar: (t) => ` (مجاني من ${t})`, arabizi: (t) => ` (batel men ${t})`, en: (t) => ` (free from ${t})` };
/**
 * journey retest R15-1 (18/11): F5 T1 on the shared link « Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya
 * Alger, Bab Ezzouar » ⇒ « … Wach howa l'adresse ta3ek f Bab Ezzouar (…) ? » — no price, no fee, no stop-desk. When the customer named a
 * place with no quote of it yet in the conversation, the server quotes it (ai-run) and this writes, before the reply's last question
 * question (the address question first; else at the end): the product's price when the reply gives none (the product the message names), then both fees with the stop-desk
 * offered. A reply that already gives a fee is left to `withBothFees`; one asking « home or stop-desk? » to `withModeFees`.
 */
// journey retest R18-1 (18/11): `homeOnly` — the customer gave a street address already (home delivery, R5-4): the home fee alone, no
// stop-desk offered
export const withPlaceFacts = (reply: string, quotes: readonly QuoteFact[], product: PlaceProduct | null, lang: AiLanguage | string | undefined, o: { homeOnly?: boolean } = {}): string => {
  const q = quotes.find((x) => !x.isStopdesk);
  const nums = numbersIn(foldGuard(reply));
  const loc = locOf(lang);
  const lines: string[] = [];
  if (product && product.price > 0 && !nums.includes(product.price)) lines.push(PRODUCT_PRICE[loc](product.variant ? `${product.name} (${product.variant})` : product.name, amountText(product.price, loc)));
  if (q && modeQuestionAt(reply) < 0 && !(q.fee > 0 && nums.includes(q.fee)) && !(q.stopdeskFee !== null && nums.includes(q.stopdeskFee))) {
    // journey retest R18-1 (18/11): a quote made with no order amount (a place given before any product) gives the home fee « from » the
    // free threshold — Oran 600 DA, free from 20 000 DA: the Coffret (24 990 DA) is delivered free, so the threshold goes with the fee
    const home = q.free || q.fee === 0 ? FREE_HOME[loc] : `${amountText(q.fee, loc)}${q.freeFrom ? FREE_FROM[loc](amountText(q.freeFrom, loc)) : ''}`;
    const stop = q.stopdeskFee !== null && q.stopdeskFee > 0 && !o.homeOnly ? amountText(q.stopdeskFee, loc) : null;
    // journey retest R16-4 (18/11): the reply offers the stop-desk itself (« … ? Wela t7ebb nwasslouha f stop-desk ? ») — the fees only, the
    // stop-desk offered once
    lines.push(stop && STOP_WORD.test(foldGuard(reply)) ? MODE_FEES[loc](home, stop) : PLACE_FEES[loc](home, stop));
  }
  if (!lines.length) return reply;
  const parts = splitSentences(reply);
  // before the address question (« … ? Wela t7ebb stop-desk ? » stays one block), else the last question, else at the end
  let at = parts.findIndex((p) => /[?؟]/u.test(p) && ADDRESS_ASK.test(foldGuard(p)));
  if (at < 0)
    for (let k = parts.length - 1; k >= 0; k--)
      if (/[?؟]/u.test(parts[k]!)) {
        at = k;
        break;
      }
  // journey retest R19-3 (18/11): before the run of questions it ends (never between two questions), and the price before a fee sentence the
  // reply already has (PF1 T2 « … À domicile : 650 DA, en stop-desk : 350 DA. Sac à main cuir (Marron) : 6900 DA. Quelle est votre adresse … ? »)
  if (at >= 0) at = questionBlockStart(parts, at);
  // journey retest R22-4 (18/11): and before a delivery remark of the reply (M3 T1 « التوصيل ممكن يطول شوية، تقدر تطلبها. Montre connectée ب
  // 15 900 دج. واش سميتك؟ » — the delay said before the product it is about)
  const fee = product && lines[0] && !nums.includes(product.price) ? parts.findIndex((p) => feeLine(p) || DELIVERY_REMARK.test(foldGuard(p))) : -1;
  if (fee >= 0 && (at < 0 || fee < at)) at = fee;
  if (at < 0) return `${reply.trim()} ${lines.join(' ')}`.trim();
  return [...parts.slice(0, at).map((p, k) => (k === at - 1 && !/\s$/u.test(p) ? `${p} ` : p)), `${lines.join(' ')} `, ...parts.slice(at)].join('').replace(/[ \t]+\n/g, '\n').trim();
};

// --- journey retest R15-4 (18/11): the asked price of a product that is out of stock ---------------------------------------------
/** The customer asks a price (« c'est combien ? », « quel prix », « ch7al », « بشحال », « قداش », « how much »), folded. */
const PRICE_ASK = /(?<![\p{L}])(?:combien|prix|tarif|coute|cout|ch7al|chhal|sh7al|bch7al|b9addach|9addach|qaddach|bqaddach|soum|souma|price|cost|costs|much|بشحال|شحال|قداش|بقداش|سعر|ثمن|السومة|سومة|سومتو|سومتها)(?![\p{L}])/u;
export const priceAsked = (text: string): boolean => PRICE_ASK.test(foldGuard(text));
/** A greeting opening a sentence, with what follows it up to the next word (« Bonjour 👋 », « Salam ! », « السلام عليكم، »). */
const OPENING_GREETING = /^\s*(?:bonjour|bonsoir|salut|salam|slm|hello|hi|السلام\s+عليكم|السلام|سلام|مرحبا)(?![\p{L}])[^\p{L}\p{N}]*/iu;
/** A sentence saying a product is out of stock (folded): « en rupture », « pas disponible », « makach », « ماكانش », « out of stock ». */
const OUT_OF_STOCK_SAID = /(?<![\p{L}])(?:rupture|indisponible|epuise|disponible|stock|available|makach|makanch|makaynch|ma\s*3andnach|3andnach|ماكانش|ماكاش|مكانش|ما\s*عندناش|ماعندناش|متوفر|متوفرش|نفد|خلاص)(?![\p{L}])/u;
const UNAVAILABLE_PRICE: Record<Loc, (name: string, price: string) => string> = {
  fr: (n, p) => `${n} est à ${p}, mais ce produit n'est pas disponible pour le moment.`,
  ar: (n, p) => `${n} ب\u0640 ${p}، بصح ماهوش متوفر درك.`,
  arabizi: (n, p) => `${n} b ${p}, bessah makach dork.`,
  en: (n, p) => `${n} is ${p}, but it is not available right now.`,
};
/**
 * journey retest R15-4 (18/11): N5 T1 « Bonjour, le parfum oud c'est combien ? » ⇒ « Désolé, Parfum Oud 50 ml est en rupture de stock …
 * notre Coffret cadeau Aïd … » — the asked price (3 200 DA) was no longer given (R14 « Son prix est de 3200 DA »). When the message asks a
 * price and names an out-of-stock catalogue product whose price the reply does not give, the reply's sentence naming that product
 * (else a new first sentence) says its price and that it is not available.
 */
export const withAskedPrice = (reply: string, customerText: string | undefined, unavailable: readonly { id: string; name: string; price: number; variants: { price: number }[] }[], lang: AiLanguage | string | undefined): string => {
  if (!customerText || !unavailable.length || !priceAsked(customerText)) return reply;
  const p = productNamedIn(customerText, unavailable);
  if (!p) return reply;
  const prices = [...new Set([p.price, ...p.variants.map((v) => v.price)].filter((x) => x > 0))];
  if (prices.length !== 1) return reply;
  const nums = numbersIn(foldGuard(reply));
  if (nums.includes(prices[0]!)) return reply;
  const loc = locOf(lang);
  const line = UNAVAILABLE_PRICE[loc](p.name, amountText(prices[0]!, loc));
  const parts = splitSentences(reply);
  const i = parts.findIndex((s) => !!productNamedIn(s, [p]));
  if (i < 0) return `${line} ${reply.trim()}`.trim();
  // the model's own « out of stock » sentence of that product is replaced; a sentence saying more of it keeps its place after the line
  const end = /\s+$/u.exec(parts[i]!)?.[0] ?? (i < parts.length - 1 ? ' ' : '');
  const replaced = OUT_OF_STOCK_SAID.test(foldGuard(parts[i]!)) && (parts[i]!.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 16;
  // an opening greeting of that sentence stays (« Bonjour 👋 Désolé, Parfum Oud … » ⇒ « Bonjour 👋 Parfum Oud … est à 3200 DA … »)
  const greeting = replaced ? (OPENING_GREETING.exec(parts[i]!)?.[0] ?? '') : '';
  return [...parts.slice(0, i), `${greeting}${line}${replaced ? end : ' '}`, ...(replaced ? [] : [parts[i]!]), ...parts.slice(i + 1)].join('').trim();
};

const SUBSTITUTE: Record<Loc, (gone: string, instead: string, many: boolean) => string> = {
  // journey retest R14-4 (18/11): « ce récapitulatif est pour Coffret cadeau Aïd » had no article — « le produit … » fits every name
  fr: (g, i, many) => `Le produit ${g} n'est pas disponible pour le moment : à la place, ce récapitulatif est pour ${many ? 'les produits' : 'le produit'} ${i}.`,
  ar: (g, i) => `${g} ماهوش متوفر درك، هذا الملخص فيه ${i} في بلاصتو.`,
  arabizi: (g, i) => `${g} makach drok, had récap fih ${i} f blastou.`,
  en: (g, i) => `${g} is not available right now: this summary is for ${i} instead.`,
};
/**
 * journey retest R13-5 (18/11): the server line in front of a recap that holds another product than the out-of-stock one the
 * customer asked for — N5: T1 « le parfum oud c'est combien ? » (out of stock, the Coffret offered), T2 « Bon finalement je le prends …
 * » ⇒ the Coffret's recap with no word of the change. Only when the customer's latest message naming a product named an out-of-stock
 * one (`unavailableNames`) that the recap does not hold, and the reply does not already name it. Null otherwise.
 */
export const substitutionLine = (recapItems: readonly { name?: unknown }[], history: string, unavailableNames: readonly string[], reply: string, lang: AiLanguage | string | undefined): string | null => {
  const items = recapItems.map((i) => (typeof i.name === 'string' ? i.name : '')).filter(Boolean);
  if (!items.length || !unavailableNames.length) return null;
  const inRecap = items.map((name, k) => ({ id: `r${k}`, name }));
  const gone = unavailableNames.map((name, k) => ({ id: `u${k}`, name })).filter((u) => !items.some((n) => foldGuard(n) === foldGuard(u.name)));
  for (const line of history.split(/\n+/).map((l) => l.trim()).filter(Boolean).reverse()) {
    if (productNamedIn(line, inRecap)) return null;
    const asked = productNamedIn(line, gone);
    if (asked) return productNamedIn(reply, [asked]) ? null : SUBSTITUTE[locOf(lang)](asked.name, items.join(', '), items.length > 1);
  }
  return null;
};

// --- journey retest R16 (18/11): asked facts survive the guard, the model's own hand-off, offers that sound like a booking ---------------
/** The customer asks whether a product is there (« kayen ? », « disponible ? », « vous avez … ? », « عندكم ؟ », « in stock ? »), folded. */
const STOCK_ASK = /(?<![\p{L}])(?:kayen|kayna|kaynin|kayn|disponibles?|dispo|en\s+stock|avez|3andkom|3andek|available|in\s+stock|كاين|كاينة|كاينين|عندكم|متوفر|متوفرة)(?![\p{L}])/u;
const AVAILABLE: Record<Loc, (name: string) => string> = { fr: (n) => `${n} est disponible.`, ar: (n) => `${n} متوفر.`, arabizi: (n) => `${n} kayen.`, en: (n) => `${n} is available.` };
const UNAVAILABLE: Record<Loc, (name: string) => string> = { fr: (n) => `${n} n'est pas disponible pour le moment.`, ar: (n) => `${n} ماهوش متوفر درك.`, arabizi: (n) => `${n} makach dork.`, en: (n) => `${n} is not available right now.` };
const NOT_SERVED: Record<Loc, (w: string) => string> = { fr: (w) => `Nous ne livrons pas à ${w} pour le moment.`, ar: (w) => `ما نوصلوش ل\u0640${w} درك.`, arabizi: (w) => `Ma nwasslouch l ${w} f had lwaqt.`, en: (w) => `We don't deliver to ${w} for now.` };
/** Puts server lines before the reply's last question (else at the end). */
const beforeLastQuestion = (reply: string, lines: string[]): string => {
  if (!lines.length) return reply;
  const parts = splitSentences(reply);
  let at = -1;
  for (let k = parts.length - 1; k >= 0; k--)
    if (/[?؟]/u.test(parts[k]!)) {
      at = k;
      break;
    }
  // (journey retest R19-3: before the run of questions that ends the reply)
  if (at >= 0) at = questionBlockStart(parts, at);
  if (at < 0) return `${reply.trim()} ${lines.join(' ')}`.trim();
  return [...parts.slice(0, at).map((p, k) => (k === at - 1 && !/\s$/u.test(p) ? `${p} ` : p)), `${lines.join(' ')} `, ...parts.slice(at)].join('').replace(/[ \t]+\n/g, '\n').trim();
};
/**
 * journey retest R16-1 (18/11): a fact the customer asked for that the reply guard's rewrite or strip took out comes back from what the
 * server knows (F9: the sentence holding the Oran stop-desk fee was dropped with a Moroccan form). The fees of every quoted wilaya are
 * put back by the guard itself (`enforceReply`); this adds, after a rewrite or a strip:
 *   - the price of the product the customer asked the price of, when the model's first answer gave it and the text sent no longer does
 *     (« not available » with it for an out-of-stock product);
 *   - whether it is there, when the customer asked and the first answer said it in a sentence naming it;
 *   - a wilaya of this turn's quotes that is not served, when the customer named it (or the first answer did) and the text no longer does.
 * The server's lines go before the text's last question (else at the end). Nothing is added when the text still carries the fact.
 */
export const withAskedFacts = (
  text: string,
  original: string,
  f: { customerText?: string; cataloguePrices?: readonly CataloguePrice[]; unavailableNames?: readonly string[]; notServed?: readonly string[] },
  lang: AiLanguage | string | undefined,
): string => {
  const said = f.customerText ?? '';
  if (!said.trim() || !text.trim()) return text;
  const loc = locOf(lang);
  const now = foldGuard(text);
  const before = foldGuard(original);
  const nowNums = numbersIn(now);
  const lines: string[] = [];
  const p = f.cataloguePrices?.length ? productNamedIn(said, f.cataloguePrices) : null;
  if (p) {
    const gone = (f.unavailableNames ?? []).includes(p.name);
    const prices = [...new Set([p.price, ...p.variants.map((v) => v.price)].filter((x) => x > 0))];
    const asked = priceAsked(said) ? prices.find((x) => numbersIn(before).includes(x)) : undefined;
    if (asked !== undefined && !prices.some((x) => nowNums.includes(x))) lines.push(gone ? UNAVAILABLE_PRICE[loc](p.name, amountText(asked, loc)) : PRODUCT_PRICE[loc](p.name, amountText(asked, loc)));
    else if (STOCK_ASK.test(foldGuard(said))) {
      const stockSaid = (s: string) => OUT_OF_STOCK_SAID.test(foldGuard(s)) || STOCK_ASK.test(foldGuard(s));
      const stockBefore = splitSentences(original).some((s) => !!productNamedIn(s, [p]) && stockSaid(s));
      const stockNow = splitSentences(text).some(stockSaid);
      if (stockBefore && !stockNow) lines.push((gone ? UNAVAILABLE : AVAILABLE)[loc](p.name));
    }
  }
  const folded = foldGuard(said);
  for (const w of f.notServed ?? []) {
    const k = foldGuard(w);
    if (k && (folded.includes(k) || before.includes(k)) && !now.includes(k)) lines.push(NOT_SERVED[loc](w));
  }
  return beforeLastQuestion(text, lines);
};

/** A sentence refusing something the team will answer (« je ne peux pas vous donner de prix de gros ici », « I can't », « ma nqderch »), folded. */
const REFUSAL = /(?<![\p{L}])(?:je\s+ne\s+(?:peux|pourrai|pourrais|suis\s+pas\s+en\s+mesure)|je\s+n\s?ai\s+pas\s+(?:acces|la\s+possibilite)|(?:il\s+(?:m\s?est|est)\s+)?impossible\s+de|(?:ce\s+n\s?est\s+)?pas\s+possible\s+de|i\s+(?:can\s?t|cannot|can\s+not|am\s+(?:not\s+able|unable)|m\s+(?:not\s+able|unable))|ma\s*n(?:9|q)de?rch|ma\s*n(?:9|q)adch|ma\s*nejjemch|ما\s*نقدرش|مانقدرش|ما\s*نجمش|لا\s*(?:استطيع|يمكنني))(?![\p{L}])/u;
/** journey retest R16-2 (18/11): the model's own hand-off text without its refusal sentences (W1 « Je ne peux pas vous donner de prix de gros ici. »). */
export const withoutRefusals = (reply: string): string => {
  const parts = splitSentences(reply);
  const kept = parts.filter((s) => !REFUSAL.test(foldGuard(s).replace(/['’]/g, ' ')));
  return kept.length === parts.length ? reply : kept.join('').trim();
};
/** The text says the shop's team (a person) takes it over (« l'équipe … », « un conseiller », « فريق المحل », « l'équipe ta3 lboutique »). */
const TEAM_SAID = /(?<![\p{L}])(?:equipe|team|conseill\w*|responsable|vendeu\w*|collegue|colleague|someone|quelqu\s?un|فريق|المسؤول|مسؤول|البائع|wa7ed\s+men)(?![\p{L}])/u;
export const teamSaid = (reply: string): boolean => TEAM_SAID.test(foldGuard(reply).replace(/['’]/g, ' '));

/**
 * A question offering to book / register a product for the customer (« تحب نحجزلك واحد؟ », « واش تحب نسجلو لك؟ », « Souhaitez-vous le
 * commander ? », « je vous le réserve ? », « n7ajzlek wa7ed ? »), folded. « Voulez-vous le prendre ? » (a substitute offered) is no such one.
 */
// journey retest R17-4 (18/11): the family in Arabic script, arabizi and French — « واش تحب نسجلوه ليك؟ » (N21 T1), « تحب نجهزلك واحد ؟ » (A1
// T1): « (واش) تحب / حاب » + a first-person verb of booking / registering / preparing (نحجز, نسجل, نجهز, نوجد, نحضر), or that verb with « لك /
// ليك » attached or after it; arabizi « t7ebb nsajjlouh lik », « nwajdlek wa7ed ? »; French « je vous le prépare ? », « voulez-vous que je
// vous le réserve / prépare ? »
const BOOKING_ASK = /(?<![\p{L}])(?:je\s+vous\s+(?:le|la|les|en)\s+(?:reserve|mets\s+de\s+cote|garde|prepare)|on\s+vous\s+(?:le|la|les)\s+(?:reserve|prepare)|(?:voulez|souhaitez|desirez)\s+vous\s+(?:le|la|les|l|en)\s+(?:commander|reserver)|(?:voulez|souhaitez|desirez)\s+vous\s+que\s+(?:je|j|on)\s+(?:vous\s+)?(?:le|la|les|l|en)\s+(?:reserve|prepare|mette|garde|enregistre|commande)|shall\s+i\s+(?:book|reserve|order|prepare)|(?:should|can)\s+i\s+(?:book|reserve|prepare)|n7a?jz(?:ou)?(?:ha|hou)?l(?:ek|ak|ik)|nsa?jj?l(?:ou|o)?(?:ha|hou)?l(?:ek|ak|ik)|n(?:jahz|jehz|wajd|wejd|wajjed|7add?r|hadd?r)(?:ou|o)?(?:ha|hou)?l(?:ek|ak|ik)|t7ebb?\s+n(?:7a?jz|sa?jj?l|jahz|jehz|waj?jd|7add?r|hadd?r)\S*|نحجز(?:و|ها|هو)?\s*ل(?:ك|كم)|نحجزلك|نحجزلكم|نحجزهالك|نسجلو\s*لك|نسجلولك|نسجلهالك|نسجلهولك|(?:تحب|تحبي|حاب|حابه|بغيت)\s+(?:\S+\s+)?ن(?:حجز|سجل|جهز|وجد|حضر)\S*|ن(?:حجز|سجل|جهز|وجد|حضر)\S*\s+(?:لك|ليك|لكم)|ن(?:حجز|سجل|جهز|وجد|حضر)\S*(?:لك|ليك|لكم))(?![\p{L}])/u;
/**
 * journey retest R17-4 (18/11): a clause saying the product is being booked / prepared / noted for the customer before any recap — F1b T1
 * « …, et on le prépare pour vous. », A1 T2 « صحيت أمينة، تسجل عندي حجاب الحرير (Hijab soie) بكمية 1. » (« it is registered with me »),
 * arabizi « tsajjel 3andi », « sajjeltlek ». Folded text. « … est noté pour vous » (accepted since R13, it carries the price) stays.
 */
const BOOKING_SAID = /(?<![\p{L}])(?:(?:et\s+)?(?:on|je|nous)\s+(?:vous\s+)?(?:le|la|les|l)\s+(?:prepare|preparons|reserve|reservons|mets\s+de\s+cote|garde|gardons|enregistre)(?:\s+(?:pour\s+vous|tout\s+de\s+suite|de\s+suite))?|e?ts[ae]jj?l\S*\s+3andi|sa?jj?elt(?:ou|o)?(?:ha|hou)?l(?:ek|ak|ik)|(?:ا?ت)?سجل\S*\s+عندي|سجلت(?:ه|ها|هو)?(?:لك|ليك)|حجزت(?:ه|ها|هو)?(?:لك|ليك)|جهزت(?:ه|ها|هو)?(?:لك|ليك))(?![\p{L}])/u;
/** The reply says a product is not there (« en rupture », « pas disponible », « makach », « ماكانش », « out of stock »), folded. */
const NOT_THERE = /(?<![\p{L}])(?:rupture|indisponible|epuise|pas\s+(?:encore\s+)?disponible|plus\s+disponible|out\s+of\s+stock|not\s+available|makach|makanch|ma\s*3andnach|ماكانش|ماكاش|ما\s*عندناش|ماعندناش|متوفرش|ماهوش\s+متوفر|نفد)(?![\p{L}])/u;
/** The opening of the sentence after the dropped offer that only made sense after it (« Si oui, », « و », « Ila ih, », « If so, »). */
const IF_SO = /^\s*(?:si\s+oui\s*,?\s*|si\s+c['’]est\s+le\s+cas\s*,?\s*|if\s+so\s*,?\s*|if\s+yes\s*,?\s*|ila\s+ih\s*,?\s*|ila\s+wah\s*,?\s*|إذا\s+(?:ايه|إيه|واه)\s*[،,]?\s*|و(?=واش|عطيني|قولي|اعطيني))/iu;
/**
 * journey retest R16-4 (18/11): the customer already wants the product and no recap is shown — a question that sounds like the order is
 * being booked (N21 T1 « تحب نحجزلك واحد؟ » after the guard's rewrite, N18 T1 « واش تحب نسجلو لك؟ وواش سميتك؟ », F1 T1 « Souhaitez-vous le
 * commander ? Si oui, dites-moi votre nom pour commencer. ») is dropped; the next missing field — the name, no phone being given yet — is
 * asked instead, unless the reply already asks one.
 */
/** An order field asked in the sentence (folded): the name, the phone, the wilaya, the address. */
const FIELD_ASKED = /(?<![\p{L}])(?:سميتك|اسمك|رقم|الهاتف|هاتفك|ولاي[هة]|بلدي[هة]|العنوان|عنوانك|nom|name|smitek|wilaya|adresse|address|telephone|numero|ra9m)(?![\p{L}])/u;
/** journey retest R17-4: the reply without its clauses saying the product is booked / prepared / noted for the customer (`BOOKING_SAID`). */
export const withoutBookingSaid = (reply: string): string => {
  const parts = splitSentences(reply);
  let changed = false;
  const kept = parts.flatMap((s) => {
    if (/[?؟]/u.test(s) || !BOOKING_SAID.test(foldGuard(s).replace(/['’-]/g, ' '))) return [s];
    const end = /([.!…]*\s*)$/u.exec(s)?.[1] ?? '';
    const body = s.slice(0, s.length - end.length);
    const clauses = body.split(/(\s*[,،:;؛]\s*)/u);
    const out: string[] = [];
    for (let k = 0; k < clauses.length; k += 2) if (!BOOKING_SAID.test(foldGuard(clauses[k]!).replace(/['’-]/g, ' '))) out.push(clauses[k]!);
    if (out.length === Math.ceil(clauses.length / 2)) return [s];
    changed = true;
    const text = out.map((c) => c.trim()).filter(Boolean).join(/[،]/u.test(body) ? '، ' : ', ');
    return text ? [`${text}${end.trim() ? end.replace(/^\s*/u, '') : '. '}`] : [];
  });
  return changed ? kept.join('').replace(/[ \t]+\n/g, '\n').trim() : reply;
};
export const withoutBookingOffer = (reply: string, customerText: string | undefined, phoneGiven: boolean, lang: AiLanguage | string | undefined, o: { history?: string; orderedBefore?: boolean } = {}): string => {
  // journey retest R17-4 (18/11): a clause saying the product is booked / prepared / noted for the customer goes too, whatever was given —
  // only while the customer wants a product (this message or an earlier one) and no order of theirs exists (« on vous la prépare » then
  // speaks of a real order); a product out of stock: left alone (a substitute offered)
  const wanted = !!customerText && (productWanted(customerText) || (!!o.history && productWanted(o.history)));
  if (wanted && !o.orderedBefore && !NOT_THERE.test(foldGuard(reply))) reply = withoutBookingSaid(reply);
  // (a phone given already: the order details are being taken, the recap comes next — nothing to replace; a product out of stock: the
  // question offers another product, a real question — R5 / R6 N5c « Voulez-vous que je vous le réserve ? » for the Coffret)
  if (!customerText || phoneGiven || !productWanted(customerText) || NOT_THERE.test(foldGuard(reply))) return reply;
  const parts = splitSentences(reply);
  // (journey retest R17-4: a question that asks a field with its purpose — « واش سميتك باش نسجلوها لك؟ », the R16-4 form — is left alone)
  const at = parts.map((s, i) => (/[?؟]/u.test(s) && BOOKING_ASK.test(foldGuard(s).replace(/['’-]/g, ' ')) && !FIELD_ASKED.test(foldGuard(s)) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return reply;
  let lead = false;
  const kept = parts.flatMap((s, i) => {
    if (at.includes(i)) return [];
    if (at.includes(i - 1) && IF_SO.test(s)) {
      lead = true;
      const rest = s.replace(IF_SO, '');
      return [rest.charAt(0).toLocaleUpperCase() + rest.slice(1)];
    }
    return [s];
  });
  let text = kept.join('').replace(/[ \t]+\n/g, '\n').trim();
  if (!lead && !/[?؟]/u.test(text)) text = `${text} ${FIELD_QUESTIONS.clientName![locOf(lang)]}`.trim();
  return text;
};

/** journey retest R19-3: « je vous confirme : » opening a question (N5 T2 « … je vous confirme : c'est bien le Hijab soie à 1500 DA que vous voulez ? »). */
const I_CONFIRM = /^(\s*)(?:je\s+vous\s+(?:le\s+)?confirme|je\s+(?:le\s+)?confirme)\s*:\s*/iu;
/** journey retest R19-3: the question asking whether the customer wants the product offered instead, in the customer's language. */
const ALT_ASK: Record<Loc, string> = { fr: 'Ça vous intéresse ?', ar: 'تحب تديه ؟', arabizi: 'T7ebb teddih ?', en: 'Would you like it instead?' };
/**
 * journey retest R19-3 (18/11): before any recap, a question about the in-stock product offered for one that is not there is never worded as an
 * order step — N5 T1 « … notre Hijab soie est en stock à 1500 DA … Voulez-vous que je vous le réserve ? » ⇒ « … Ça vous intéresse ? » (R16-4 left the
 * booking question of an alternative alone), N5 T2 « Le Parfum Oud étant en rupture, je vous confirme : c'est bien le Hijab soie … que vous voulez ? »
 * ⇒ « … C'est bien le Hijab soie … que vous voulez ? ». A question asking a field keeps its wording.
 */
export const withoutOrderStepAsk = (reply: string, lang: AiLanguage | string | undefined): string => {
  const parts = splitSentences(reply);
  const away = NOT_THERE.test(foldGuard(reply));
  let changed = false;
  const kept = parts.map((s) => {
    if (!/[?؟]/u.test(s)) return s;
    // (« Le Parfum Oud étant en rupture, je vous confirme : c'est bien … ? » — the words after a comma too)
    const at = s.search(/(?:^|[,،]\s*)(?:je\s+vous\s+(?:le\s+)?confirme|je\s+(?:le\s+)?confirme)\s*:/iu);
    if (at >= 0) {
      changed = true;
      const head = s.slice(0, at);
      const tail = s.slice(at).replace(/^[,،]\s*/u, '').replace(I_CONFIRM, '');
      return head.trim() ? `${head.replace(/\s+$/u, '')}, ${tail}` : `${/^\s*/u.exec(s)?.[0] ?? ''}${tail.charAt(0).toLocaleUpperCase()}${tail.slice(1)}`;
    }
    if (away && BOOKING_ASK.test(foldGuard(s).replace(/['’-]/g, ' ')) && !FIELD_ASKED.test(foldGuard(s))) {
      changed = true;
      const end = /\s*$/u.exec(s)?.[0] ?? '';
      return `${/^\s*/u.exec(s)?.[0] ?? ''}${ALT_ASK[locOf(lang)]}${end}`;
    }
    return s;
  });
  return changed ? kept.join('').replace(/[ \t]+\n/g, '\n').trim() : reply;
};

/**
 * journey retest R16-4 (18/11): the stop-desk offered twice in one reply — F1b T2 « Livraison : 650 DA à domicile, ou 350 DA en stop-desk si
 * vous préférez. Quelle est votre adresse … ? Si vous préférez, on peut aussi vous livrer en stop-desk. ». A sentence that only offers the
 * stop-desk (no amount, no question, no home delivery word) goes when another sentence already gives the stop-desk with its fee.
 */
export const withOneStopdeskOffer = (reply: string): string => {
  const parts = splitSentences(reply);
  const f = parts.map((p) => foldGuard(p));
  if (!f.some((s) => STOP_WORD.test(s) && numbersIn(s).length > 0)) return reply;
  const kept = parts.filter((p, i) => !(STOP_WORD.test(f[i]!) && !numbersIn(f[i]!).length && !/[?؟]/u.test(p) && !HOME_WORD.test(f[i]!) && (p.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 16));
  return kept.length === parts.length ? reply : kept.join('').replace(/[ \t]+\n/g, '\n').trim();
};
/** journey retest R16-4 (18/11): two spaces or more between words (C2 « smahli 3lik  3la had lmochkil ») — one. */
export const withSingleSpaces = (reply: string): string => reply.replace(/(?<=\S)[ \t]{2,}(?=\S)/gu, ' ');

// --- journey retest R17-5 (18/11): offers that do not answer the question -------------------------------------------------------------
/** A closing question offering to show the shop's products (« T7ebb nwarrik wach kayen 3andna ? », « T7ebb nchouf wach men produit ? »,
 * « Souhaitez-vous voir nos produits ? », « تحب نوريلك واش كاين عندنا ؟ », « Would you like to see our products? »), folded. */
const PRODUCT_OFFER_ASK =
  /(?<![\p{L}])(?:t7ebb?\s+n(?:warr?ik|chouf|chouflek)\S*|(?:souhaitez|voulez|aimeriez|desirez)\s+vous\s+(?:que\s+je\s+vous\s+(?:montre|presente|propose)|voir|decouvrir|jeter)|(?:puis|peux)\s+je\s+vous\s+(?:montrer|presenter|proposer)|would\s+you\s+like\s+(?:to\s+see|me\s+to\s+show)|(?:can|shall)\s+i\s+show\s+you|(?:تحب|حاب|حابه)\s+(?:ن?شوف|نوري|نوريلك|تشوف)\S*)(?![\p{L}])/u;
/** What such an offer is about: the products, what the shop has (folded). */
const PRODUCT_OFFER_WHAT = /(?<![\p{L}])(?:l?produits?|articles?|catalogue|collection|kayen|3andna|7aja|haja|hadja|products?|items?|نوريلك|كاين|عندنا|المنتوجات|المنتجات|سلع[هة]|حاج[هة])(?![\p{L}])/u;
/** An offer of something else (« nqder nwarrik hadja okhra li twasslek », « je peux vous proposer autre chose », « نوريلك حاجة أخرى »), folded. */
const ELSE_OFFER = /(?<![\p{L}])(?:nwarr?ik|nchouflek|nqd?er\s+nwarr?ik|propos\S*|montr\S*|present\S*|show|offer|suggest|نوريلك|نقترح|نعرضلك)(?![\p{L}])[^.!?؟\n]*(?<![\p{L}])(?:okhra|okhrin|autre|autres|another|other|else|اخرى|أخرى|اخر|آخر|خلاف)(?![\p{L}])/u;
/**
 * journey retest R18-4 (18/11): an « if you like, I can help you / show you … » offer — N16 « Ila t7ebb, nqder n3awnek f wilaya okhra wela
 * nwarrik produit. » for Illizi (nothing is delivered there), folded.
 */
const IF_YOU_LIKE_OFFER = /(?<![\p{L}])(?:ila\s+t7ebb?\S*|ila\s+bghit\S*|si\s+vous\s+(?:voulez|le\s+souhaitez|souhaitez|preferez)|if\s+you\s+(?:like|want|wish)|(?:اذا|إذا|كان|ايلا)\s+(?:تحب|حبيت|حابب?))(?![\p{L}])[^.!?؟\n]*(?<![\p{L}])(?:n3awn\S*|nwarr?ik\S*|nchouflek|nqd?er\S*|propos\S*|montr\S*|aid\S*|help\S*|show\S*|نعاون\S*|نوري\S*|نقترح\S*|نقدر)(?![\p{L}])/u;
/**
 * journey retest R17-5 (18/11): a delivery-only question (no product wanted or named) gets its fees, not a closing offer of the products
 * — F9 / F9b « … Illizi : ma nwasslouch l Illizi f had lwaqt. T7ebb nchouf wach men produit ? » / « T7ebb nwarrik wach kayen 3andna ? »;
 * and when nothing of this turn's quotes is delivered (every wilaya asked is not served) no « something else that reaches you » — N16 « Ila
 * t7ebb, nqder nwarrik lek hadja okhra li twasslek f wilaya ta3ek. » for Illizi. Such a sentence goes when the reply keeps another one.
 */
export const withoutUnrelatedOffer = (reply: string, customerText: string | undefined, o: { deliveryOnly: boolean; nothingServed: boolean }): string => {
  if (!customerText || (!o.deliveryOnly && !o.nothingServed)) return reply;
  const parts = splitSentences(reply);
  const kept = parts.filter((s) => {
    const f = foldGuard(s).replace(/['’-]/g, ' ');
    if (o.deliveryOnly && /[?؟]/u.test(s) && PRODUCT_OFFER_ASK.test(f) && PRODUCT_OFFER_WHAT.test(f)) return false;
    return !(o.nothingServed && (ELSE_OFFER.test(f) || IF_YOU_LIKE_OFFER.test(f)));
  });
  return kept.length === parts.length || !kept.some((s) => /[\p{L}\p{N}]/u.test(s)) ? reply : kept.join('').replace(/[ \t]+\n/g, '\n').trim();
};

// --- journey retest R18 (18/11): a place that is not served, item / field « noted » lines, the customer's name in their script ---------
/** A negation in a sentence (folded): « pas », « ne … », « ma … ch », « makach », « ما … ش », « not », « don't ». */
const NEGATED = /(?<![\p{L}])(?:pas|ne|n|jamais|makach|makanch|mana|not|don\s?t|doesn\s?t|no|لا|ماشي|مانا|ماكانش)(?![\p{L}])|(?<![\p{L}])ma\s*\p{L}*?(?:ch|ش)(?![\p{L}])|(?<![\p{L}])ما\s*\p{L}+ش(?![\p{L}])|\p{L}+ouch(?![\p{L}])/u;
/**
 * journey retest R18-1 (18/11): the customer named a wilaya that is not served and no turn quoted it yet — the server's quote said so; the
 * reply says « we don't deliver there » (before its last question) unless a sentence naming the wilaya already says it with a negation.
 */
export const withNotServed = (reply: string, wilaya: { fr: string; ar?: string }, lang: AiLanguage | string | undefined): string => {
  const names = [wilaya.fr, wilaya.ar].filter((n): n is string => !!n).map((n) => foldGuard(n)).filter(Boolean);
  if (!names.length) return reply;
  const said = splitSentences(reply).some((x) => {
    const f = foldGuard(x);
    return names.some((n) => f.includes(n)) && NEGATED.test(f);
  });
  if (said) return reply;
  const loc = locOf(lang);
  return beforeLastQuestion(reply, [NOT_SERVED[loc](loc === 'ar' && wilaya.ar ? wilaya.ar : wilaya.fr)]);
};

/**
 * journey retest R18-4 (18/11): a line that « registers » an item or a field before any recap reads like an order step — PG1 T2 « Saha
 * Nadia, tsajjel: hijab soie wahed, 1500 DA. », F5 T1 « Tsajjelt Amina Saadi, 0698765432, Alger, Bab Ezzouar. », A3 T1 « صحيت يا سميرة، سجلت
 * زوج من Tapis de prière (2800 دج للواحد). », N21 T3 « صحيت يا نادية، تسجل رقم الهاتف تاعك. », N3 T1 « …, c'est noté ! » (folded words). The
 * order claims (« tsajlet la commande », « سجلت الطلب ») are the guard's `order_claim`; a question is no such line.
 */
const NOTED_VERB = /^(?:tsajj?el|tsajj?elt|sajj?elt|sajj?elna|tsajj?lou|tsajj?lat|سجلت|سجلنا|تسجل|تسجلت|تسجلو|اتسجل|اتسجلت)(?![\p{L}])\s*:?\s*/u;
const NOTED_FR = /^(?:c\s?est\s+(?:bien\s+)?note(?:e)?|(?:tout\s+est\s+)?bien\s+note(?:e)?|note|c\s?est\s+enregistre(?:e)?)$/u;
// journey J05r-9 (18/11): « l'adresse est bien notée » / « votre numéro est enregistré » — a field said to be kept, before any recap (the
// shop's products still waited for review: nothing was kept anywhere). Folded, as a whole clause, like `NOTED_FR`.
const NOTED_FIELD = /^(?:l|la|le|les|votre|vos|ton|ta|tes|your)\s+(?:adresse|numero(?:\s+de\s+telephone)?|telephone|nom(?:\s+complet)?|prenom|coordonnees|informations|infos|details|wilaya|commune|address|phone(?:\s+number)?|name)\s+(?:est|sont|a\s+ete|ont\s+ete|is|are|has\s+been|have\s+been)\s+(?:bien\s+|well\s+)?(?:notee?s?|enregistree?s?|recue?s?|gardee?s?|noted|saved|recorded|received|kept)$/u;
const ORDER_NOUN = /(?<![\p{L}])(?:commande|order|طلبي[هة]|الطلبي[هة]|الطلب|طلب|lacommande|kommand)(?![\p{L}])/u;
/** Words that name an order field (folded): with the customer's own words, a clause of them only echoes a field. */
/**
 * journey retest R19-3 (18/11): a « noted » phrase opening a clause, followed by what is noted — F5 T1 « C'est noté : robe kabyle brodée taille M b
 * 4900 DA », F1b T2 « c'est noté : Sétif, El Eulma », PF1 T2 « j'ai bien noté votre nom, votre numéro et El Eulma à Sétif », N5 T2 « j'ai bien noté
 * Oran, Bir El Djir, … » (the R18-4 rule read a whole clause « c'est noté » only). As written (accents, apostrophes), case-insensitive.
 */
const NOTED_LEAD = /^(?:je\s+(?:vous\s+)?(?:note|prends\s+note\s+d[eu]s?)(?!\s+(?:que|qu['’]))(?=\s)|c['’]?\s?est\s+(?:bien\s+)?not[ée]e?|(?:tout\s+est\s+)?bien\s+not[ée]e?|j['’]\s?ai\s+(?:bien\s+)?(?:not[ée]|enregistr[ée])|on\s+a\s+(?:bien\s+)?not[ée]|nous\s+avons\s+(?:bien\s+)?not[ée])\s*:?\s*(?=\S)/iu;
// (journey retest R19-3: « votre nom, votre numéro », « vos coordonnées » echo a field too)
// (journey retest R20-4 (18/11): « je note … » — PF1 T2 « Merci Karim, je note le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma. »; « je
// note que … » stays)
const FIELD_WORDS = new Set(['wilaya', 'commune', 'baladiya', 'numero', 'telephone', 'votre', 'vos', 'nom', 'prenom', 'adresse', 'coordonnees', 'informations', 'pour', 'dans', 'chez', 'avec', 'piece', 'pieces', 'smitek', 'ta3ek', 'ولايه', 'بلديه', 'الولايه', 'البلديه', 'الرقم', 'رقم', 'الهاتف', 'الاسم', 'تاعك', 'سميتك'].map((w) => foldGuard(w)));
const THANK_WORD = /(?<![\p{L}])(?:merci|thanks|thank|saha|sahit|choukran|chokran|شكرا|صحيت|يعطيك|تشرفنا|بارك)(?![\p{L}])/u;
/** A price in a clause: an amount with its currency (« 1500 DA », « 2800 دج »). */
const PRICED = /\d[\d \u00a0\u202f.,]*\s*(?:da|dzd|دج|دينار)(?![\p{L}])/iu;
export const withoutNotedSteps = (reply: string, history?: string): string => {
  const parts = splitSentences(reply);
  let changed = false;
  // the customer's own words (folded): a clause made of them (a phone, the place, the name) only echoes a field
  const said = history ? new Set(foldGuard(history).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)) : null;
  // (a short clause — a phone, a place, « بلدية بوفاريك » — is one too, unless it thanks: « شكرا سمير » stays)
  const echo = (c: string) => {
    if (!said) return true;
    const words = foldGuard(c).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/u.test(w) && !FIELD_WORDS.has(w));
    return !THANK_WORD.test(foldGuard(c)) && (words.length <= 2 || words.every((w) => said.has(w)));
  };
  const kept = parts.flatMap((s) => {
    if (/[?؟]/u.test(s) || ORDER_NOUN.test(foldGuard(s))) return [s];
    const end = /([.!…]*\s*)$/u.exec(s)?.[1] ?? '';
    const body = s.slice(0, s.length - end.length);
    const clauses = body.split(/(\s*[,،;؛]\s*)/u);
    const out: string[] = [];
    let mine = false;
    let drop = false;
    for (let k = 0; k < clauses.length; k += 2) {
      const c = clauses[k]!;
      const f = foldGuard(c).replace(/['’]/g, ' ').trim();
      // (after a noted field with no price: the clauses that only echo the customer's fields go with it; a « شكرا سمير » stays)
      if (drop && echo(c)) continue;
      drop = false;
      if (NOTED_FR.test(f) || NOTED_FIELD.test(f)) {
        mine = true;
        // (« C'est noté, Karim ! » ⇒ « Merci, Karim ! »: the sentence's opening is kept as a thank-you)
        if (k === 0 && clauses.length > 1 && /^\p{Lu}/u.test(c.trim())) out.push(c.replace(/\S.*$/u, 'Merci'));
        continue;
      }
      const lead = /^\s*/u.exec(c)?.[0] ?? '';
      // journey retest R19-3: « c'est noté : … » / « j'ai bien noté … » — the phrase goes; what follows stays when the clause (or the rest of the
      // sentence) gives a price, else it only echoes the customer's fields and goes with them
      const noted = NOTED_LEAD.exec(c.trim());
      if (noted) {
        mine = true;
        const rest = c.trim().slice(noted[0].length);
        if (PRICED.test([rest, ...clauses.slice(k + 1)].join(''))) out.push(`${lead}${rest}`);
        else drop = true;
        continue;
      }
      const m = NOTED_VERB.exec(foldGuard(c.trim()).replace(/['’]/g, ' '));
      if (!m) {
        out.push(c);
        continue;
      }
      mine = true;
      // the verb (with « لك / lek », « عندي / 3andi », a colon) goes; the rest stays when it gives a price (« hijab soie wahed, 1500 DA »),
      // else it only echoes the customer's own fields and goes with them
      const rest = c.trim().replace(/^\S+\s*(?:(?:لك|ليك|lek|lik|3andi|عندي)(?![\p{L}])\s*)?:?\s*/u, '');
      const tail = [rest, ...clauses.slice(k + 1)].join('');
      if (PRICED.test(tail)) out.push(`${lead}${rest}`);
      else drop = true;
    }
    if (!mine) return [s];
    changed = true;
    const text = out.map((c) => c.trim()).filter(Boolean).join(/[،]/u.test(body) ? '، ' : ', ');
    if (!text) return [];
    const first = text.charAt(0).toLocaleUpperCase() + text.slice(1);
    // (« … cm, c'est noté ! » ⇒ « … cm ! »: the space before a French « ! » / « ? » stays)
    const gap = /\s$/u.test(body) && /^[!?]/u.test(end.trim()) ? ' ' : '';
    return [`${first}${end.trim() ? `${gap}${end.replace(/^\s*/u, '')}` : '. '}`];
  });
  if (!changed) return reply;
  const text = kept.join('').replace(/[ \t]+\n/g, '\n').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : reply;
};

/** Words naming the customer just before their name in a reply (folded): « nom », « name », « smitek », « Merci », « تشرفنا ». */
const NAME_CUE = /(?<![\p{L}])(?:nom|name|smitek|smiytek|merci|thanks|thank\s+you|bienvenue|welcome|saha|sahit|ya)\s*:?\s*$/u;
/**
 * journey retest R18-4 (18/11): the customer's name as they wrote it — N4 T2 « Très bien, je note le nom : Samir Ben Ali. » for « سمير بن
 * علي » (the recap and the order kept the Arabic script). A run of two to four capitalised Latin words after a name word (« nom : »,
 * « Merci ») that is the customer's Arabic-script name written in Latin letters (`customerOwnName`) becomes the customer's own text.
 */
/** The consonants of an Arabic-script name, as Latin classes (long vowels, ع, ة, hamza dropped). */
const AR_CONSONANT: Record<string, string> = { ب: 'b', ت: 't', ث: 't', ج: 'j', ح: 'h', خ: 'K', د: 'd', ذ: 'd', ر: 'r', ز: 'z', س: 's', ش: 'C', ص: 's', ض: 'd', ط: 't', ظ: 'd', غ: 'G', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h' };
const arabicSkeleton = (w: string): string => [...w.replace(/^ال(?=\S{2})/u, '')].map((ch) => AR_CONSONANT[ch] ?? '').join('').replace(/(.)\1+/gu, '$1');
/** The consonants of a Latin name in the same classes (kh, gh, ch / sh, dj, th, dh, ph; c, q, g read as s, k, j; vowels, w, y dropped). */
const latinSkeleton = (w: string): string =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/kh/gu, 'K')
    .replace(/gh/gu, 'G')
    .replace(/ch|sh/gu, 'C')
    .replace(/dj/gu, 'j')
    .replace(/th/gu, 't')
    .replace(/dh/gu, 'd')
    .replace(/ph/gu, 'f')
    .replace(/c/gu, 's')
    .replace(/q/gu, 'k')
    .replace(/g/gu, 'j')
    .replace(/[^bdfhjklmnprstvzCGK]/gu, '')
    .replace(/(.)\1+/gu, '$1');
/** A Latin word after which a reply names the customer by their first name (« Merci Samir. », « Saha Walid. »). */
const FIRST_NAME_CUE = /(?<![\p{L}])(Merci|Thanks|Thank\s+you|Bienvenue|Welcome|Bonjour|Bonsoir|Parfait|Super|Saha|Sahit|Ahlan|Marhba|Ya)(\s*,?\s+)(\p{Lu}[\p{Ll}'’-]{1,20})(?![\p{L}])(?!\s+\p{Lu}\p{Ll})/gu;
export const withCustomerScriptName = (reply: string, history: string): string => {
  if (!history || !/[\u0600-\u06ff]/u.test(history)) return reply;
  // journey retest R19-3 (18/11): the first name alone after a thank-you — N4 T2 « Merci Samir. » for « سمير بن علي », F3 T2 « Saha Walid. » for
  // « smiti وليد بوزيد » (the R18-4 rule read two words or more): the customer's own first word when the Latin word writes the same consonants
  reply = withCustomerScriptRun(reply, history);
  return reply.replace(FIRST_NAME_CUE, (match: string, cue: string, gap: string, word: string) => {
    const own = customerOwnName(word, history);
    const first = own?.split(/\s+/)[0];
    const skeleton = latinSkeleton(word);
    return first && /^[\u0600-\u06ff]+$/u.test(first) && skeleton.length >= 2 && arabicSkeleton(first) === skeleton ? `${cue}${gap}${first}` : match;
  });
};
/** journey retest R18-4: a run of two to four capitalised Latin words that is the customer's Arabic-script name \u21d2 the customer's own text. */
const withCustomerScriptRun = (reply: string, history: string): string => {
  return reply.replace(/(?<![\p{L}])(\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+){1,4})(?![\p{L}])/gu, (match: string, _g: string, at: number) => {
    // (« Merci Samir Ben Ali » is one capitalised run: its first word is the cue)
    const lead = /^(?:Merci|Thanks|Bienvenue|Welcome|Saha|Sahit)\s+/u.exec(match)?.[0] ?? '';
    const run = match.slice(lead.length);
    if (run.split(/\s+/).length < 2 || (!lead && !NAME_CUE.test(foldGuard(reply.slice(Math.max(0, at - 24), at))))) return match;
    const own = customerOwnName(run, history);
    return own && own.split(/\s+/).length === run.split(/\s+/).length ? `${lead}${own}` : match;
  });
};

// --- journey retest R20 (18/11, docs/audit/journeys-2026-11-16/journeys/R20-ai-orders.md) ---------------------------------------------
const CHOICE_ASK: Record<Loc, (names: string) => string> = {
  fr: (n) => `Lequel préférez-vous : ${n} ?`,
  ar: (n) => `واش من واحد تحب: ${n} ؟`,
  arabizi: (n) => `Wach men wa7ed t7ebb: ${n} ?`,
  en: (n) => `Which one would you like: ${n}?`,
};
const CHOICE_OR: Record<Loc, string> = { fr: 'ou', ar: 'ولا', arabizi: 'wela', en: 'or' };
/**
 * journey retest R20-3 (18/11): a plain « oui » to a question offering two products or more (N5 T2 « … voulez-vous plutôt le Hijab soie à 1500 DA
 * ou la Robe kabyle brodée (à partir de 4900 DA) ? ») chooses none — T3 and T4 « oui » got the same question back with the out-of-stock sentence a
 * 2nd and a 3rd time. The server asks once, short, which one (the catalogue names, in the question's order), and nothing else.
 */
export const choiceQuestion = (names: readonly string[], lang: AiLanguage | string | undefined): string => {
  const loc = locOf(lang);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${CHOICE_OR[loc]} ${names[names.length - 1]}` : (names[0] ?? '');
  return CHOICE_ASK[loc](list);
};

/**
 * journey retest R20-4 (18/11): every amount of the reply as `formatMoney` writes it (rule 11) — the model's « 6900 DA » (PF1 T2, F1 T1, N7 T1),
 * « 4900 DA » (F5, P2, N9, N5), « 24990 DA » (N5b), « 12500 DA » (N7), « 7500 دج » are « 6 900 DA », « 7 500 دج » (the server's amounts were since
 * R19-3). Only a run of 4 to 9 digits written right before its currency (« DA », « DZD », « دج »), never a phone number, an order number
 * (« TEST-6293 »), a street number, a date or an amount already spaced (« 6 900 DA »).
 */
const RAW_AMOUNT = /(?<![\p{L}\p{N}.,\-/\u00a0\u202f])(\d{4,9})[ \t\u00a0\u202f]*(DA|DZD|دج)(?![\p{L}\p{N}])/gu;
export const withSpacedAmounts = (reply: string): string =>
  reply.replace(RAW_AMOUNT, (_m: string, digits: string, cur: string) => formatMoney(Number(digits)).replace(/DA$/u, cur));

/**
 * journey retest R20-4 (18/11): « Vos coordonnées sont bien notées : voulez-vous plutôt … ? » (N5 T2) — the « noted » opening of a sentence goes, the
 * question it opens stays (the R19-3 rule left every sentence with a « ? » alone).
 */
const NOTED_OPENING = /^(\s*)(?:(?:toutes\s+)?(?:vos|votre|tes|ton|les)\s+(?:coordonn[ée]es|informations|infos|d[ée]tails|donn[ée]es)\s+(?:sont|est|ont\s+[ée]t[ée]|a\s+[ée]t[ée])\s+(?:bien\s+)?(?:not[ée]e?s?|enregistr[ée]e?s?|re[çc]ue?s?)|c['’]?\s?est\s+(?:bien\s+)?not[ée]e?|j['’]\s?ai\s+(?:bien\s+)?not[ée]\s+vos\s+coordonn[ée]es)\s*[:,.!]\s*(?=\S)/iu;
export const withoutNotedOpening = (reply: string): string => {
  let changed = false;
  const parts = splitSentences(reply).map((s) => {
    // (a sentence asking nothing is `withoutNotedSteps`' — « C'est noté, Karim ! » ⇒ « Merci, Karim ! »)
    const m = /[?؟]/u.test(s) ? NOTED_OPENING.exec(s) : null;
    if (!m) return s;
    changed = true;
    const rest = s.slice(m[0].length);
    return `${m[1]}${rest.charAt(0).toLocaleUpperCase()}${rest.slice(1)}`;
  });
  return changed ? parts.join('').trim() : reply;
};

/**
 * journey J05r-9 (18/11): « Merci Nadia, je m'excuse pour la confusion. » to a plain « oui c'est bon je confirme » — an apology for a confusion,
 * a misunderstanding or an error nobody made (the R-rounds family of the false « correction »). The apology goes, the rest of its clause and
 * sentence stay; it is kept when the customer's message points at a mistake (« c'est faux », « erreur », « ghalta », « غلط »).
 */
const FALSE_APOLOGY = /(?:je\s+(?:m['’]\s?excuse|vous\s+(?:prie\s+de\s+m['’]\s?excuser|pr[ée]sente\s+(?:toutes\s+)?mes\s+excuses))|(?:toutes\s+)?(?:mes|nos)\s+excuses|excusez[-\s]moi|d[ée]sol[ée]e?s?|pardon|sorry|(?:i\s+|we\s+)?apologi[sz]e|my\s+apologies|نعتذر|أعتذر|اعتذر|آسف|اسف|متأسف|sma7(?:li|lna|ni))\s+(?:pour|de|for|about|على|عن|3la)\s+(?:(?:la|le|ce|cette|toute\s+la|l['’]|the|any|this|that)\s*)?(?:confusion|malentendu|m[ée]prise|erreur|mix-?up|misunderstanding|mistake|الالتباس|اللبس|الخلط|الخطأ|lghalta|ghalta)(?![\p{L}])\s*[:\-–—]?\s*/iu;
const MISTAKE_SAID = /(?<![\p{L}])(?:erreur|errone\p{L}*|faux|fausse|tromp\p{L}*|confus\p{L}*|malentendu|c['’]?\s?est\s+pas|ce\s+n['’]est\s+pas|wrong|mistake|mix-?up|ghalta|ghalat|ghlat|غلط|غلطة|خطأ)(?![\p{L}])/iu;
export const withoutFalseApology = (reply: string, customerText?: string): string => {
  if (customerText && MISTAKE_SAID.test(customerText)) return reply;
  let changed = false;
  const parts = splitSentences(reply).flatMap((s) => {
    if (!FALSE_APOLOGY.test(s)) return [s];
    const end = /([.!?؟…]*\s*)$/u.exec(s)?.[1] ?? '';
    const body = s.slice(0, s.length - end.length);
    const kept = body
      .split(/\s*[,،;؛]\s*/u)
      .map((c) => c.replace(FALSE_APOLOGY, '').trim())
      .filter((c) => /[\p{L}\p{N}]/u.test(c));
    changed = true;
    if (!kept.length) return [];
    const text = kept.join(/[،]/u.test(body) ? '، ' : ', ');
    const first = text.charAt(0).toLocaleUpperCase() + text.slice(1);
    return [`${first}${end.trim() ? end.replace(/^\s*/u, '') : '. '}`];
  });
  if (!changed) return reply;
  const text = parts.join('').replace(/[ \t]+\n/g, '\n').trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : reply;
};

/**
 * journey J02r-6 (18/11): while the shop's products still wait for Djaber's review, a product the customer names may well be one of
 * them — the reply never says it « ne fait pas partie de nos produits » (the shop does sell it): it says it is not online yet
 * (« Désolé, les chaussures sport Atlas ne font pas partie de nos produits pour le moment » ⇒ « … ne sont pas encore en ligne »).
 * Only while the catalogue is awaiting review (ai-run), fr / en wording.
 */
const NOT_OURS_FR = /\b(ne\s+)?(fait|font)\s+pas\s+partie\s+de\s+(?:nos|notre)\s+(?:produits|articles|catalogue|gamme|offre)(?:\s+(?:pour\s+le\s+moment|pour\s+l['’]instant|actuellement))?/giu;
const NOT_OURS_EN = /\b(is|are)\s+not\s+(?:part\s+of|among|in)\s+our\s+(?:products|range|catalog(?:ue)?|items)(?:\s+(?:for\s+now|at\s+the\s+moment|right\s+now))?/giu;
export const withPendingProductWording = (reply: string): string =>
  reply
    .replace(NOT_OURS_FR, (_m, _ne: string | undefined, verb: string) => (verb.toLowerCase() === 'font' ? 'ne sont pas encore en ligne' : "n'est pas encore en ligne"))
    .replace(NOT_OURS_EN, (_m, verb: string) => `${verb} not online yet`);

/**
 * journey retest R20-4 (18/11): a short thank-you sentence placed between the facts and the question (N7 T1 « … et une Basket Runner (12500 DA).
 * Merci Yacine. Lequel vous intéresse ? ») goes first — the thanks before the facts, the question last. Only a sentence of four words at most
 * that opens with the thanks and asks nothing, right before the reply's closing question.
 */
const THANKS_OPENING = /^(?:merci|thanks|thank\s+you|saha|sahit|ya3tik\s+saha|شكرا|صحيت|يعطيك\s+الصحة)(?![\p{L}])/iu;
export const withThanksFirst = (reply: string): string => {
  const parts = splitSentences(reply);
  const i = parts.findIndex((s, k) => k > 0 && k + 1 < parts.length && THANKS_OPENING.test(s.trim()) && !/[?؟]/u.test(s) && (s.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 4 && /[?؟]/u.test(parts[k + 1]!));
  if (i < 0) return reply;
  const thanks = parts[i]!.trim();
  const rest = [...parts.slice(0, i), ...parts.slice(i + 1)];
  // (after an opening greeting of its own: « Bonjour ! Merci Yacine. … »)
  const at = OPENING_GREETING.test(rest[0]!) && (rest[0]!.match(/[\p{L}\p{N}]+/gu) ?? []).length <= 3 ? 1 : 0;
  return [...rest.slice(0, at).map((p) => (/\s$/u.test(p) ? p : `${p} `)), `${thanks} `, ...rest.slice(at)].join('').replace(/[ \t]+\n/g, '\n').trim();
};

/**
 * journey retest R20-4 (18/11): one « we don't deliver there » per sentence — N16 « Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had
 * wilaya, ma l dar wala f stop-desk. » (the second clause repeats the first): a later clause saying it again goes.
 */
const NOT_DELIVERED = /(?<![\p{L}])(?:ma\s*n?wass?lou?(?:ch|ech)|ma\s*kan(?:ch|ech)\s+(?:wasl|tawsil|twasil|livraison)|makach\s+(?:wasl|tawsil|livraison)|ما\s*نوصلوش|ما\s*كانش\s+(?:ال)?توصيل|ne\s+livr\w*\s+pas|pas\s+de\s+livraison|(?:don\s?t|do\s+not)\s+deliver|no\s+delivery)(?![\p{L}])/u;
export const withoutRepeatedNotServed = (reply: string): string => {
  let changed = false;
  const parts = splitSentences(reply).map((s) => {
    // (the sentence's own end — « . », « ! », the space after it — stays when its last clause goes: R3 F9 T3 « …, wallah makach livraison lhom. »)
    const end = /[\s.!…?؟]*$/u.exec(s)?.[0] ?? '';
    const clauses = s.slice(0, s.length - end.length).split(/(\s*[,،]\s*)/u);
    let seen = false;
    const out: string[] = [];
    for (let k = 0; k < clauses.length; k += 2) {
      const hit = NOT_DELIVERED.test(foldGuard(clauses[k]!).replace(/['’]/gu, ' '));
      if (hit && seen) {
        changed = true;
        continue;
      }
      seen ||= hit;
      out.push(...(out.length ? [clauses[k - 1] ?? ', '] : []), clauses[k]!);
    }
    return `${out.join('')}${end}`;
  });
  return changed ? parts.join('').replace(/[ \t]+\n/g, '\n').trim() : reply;
};
