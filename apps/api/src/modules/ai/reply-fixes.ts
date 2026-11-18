// Journey retest R7 (17/11, docs/audit/journeys-2026-11-16/journeys/R7-ai-orders.md): the server's last word on the reply text
// for two cases the model kept missing — a photo request for a product that has none (R7-2), a « ? » / « ... » answered with
// « Oui, je suis là ! » / « Vous êtes toujours là ? » (R7-3). Pure.
import { serverTextLanguage, type AiLanguage } from './language';
import { productNamedIn } from './product-named';
import { foldGuard, numbersIn, PHOTO_WORD, splitSentences, type QuoteFact } from './reply-guard';

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
  fr: (f) => `La livraison à domicile est à ${f} DA.`,
  ar: (f) => `التوصيل للدار ب\u0640 ${f} دج.`,
  arabizi: (f) => `Tawsil l dar b ${f} DA.`,
  en: (f) => `Home delivery is ${f} DA.`,
};
const STOP_FEE: Record<Loc, (fee: string) => string> = {
  fr: (f) => `En stop-desk, c'est ${f} DA.`,
  ar: (f) => `ولا لنقطة الاستلام (stop-desk) ب\u0640 ${f} دج.`,
  arabizi: (f) => `Wela f stop-desk b ${f} DA.`,
  en: (f) => `Stop-desk delivery is ${f} DA.`,
};
/**
 * journey retest R13-6 (18/11): an answer that gives one delivery fee of a wilaya while this turn's quote_delivery gave both (home
 * and stop-desk, different) gets the other one, in the reply's language — F1b T2 « … Sinon, on peut aussi la livrer en stop-desk à
 * 350 DA. » (home 650 DA, quoted the same turn, not said). The home fee goes before the stop-desk sentence, the stop-desk fee after
 * the home one. A quote asked for the stop-desk only (its home fee unknown) adds nothing.
 */
export const withBothFees = (reply: string, quotes: readonly QuoteFact[], lang: AiLanguage | string | undefined): string => {
  let parts = splitSentences(reply);
  const loc = locOf(lang);
  const has = (n: number) => numbersIn(foldGuard(parts.join(''))).includes(n);
  const at = (n: number) => parts.findIndex((p) => numbersIn(foldGuard(p)).includes(n));
  const sep = (p: string) => (/\s$/u.test(p) ? '' : ' ');
  for (const q of quotes) {
    if (q.isStopdesk || q.free || !(q.fee > 0) || q.stopdeskFee === null || !(q.stopdeskFee > 0) || q.stopdeskFee === q.fee) continue;
    if (has(q.stopdeskFee) && !has(q.fee)) {
      const i = at(q.stopdeskFee);
      parts = [...parts.slice(0, i), `${HOME_FEE[loc](String(q.fee))} `, ...parts.slice(i)];
    } else if (has(q.fee) && !has(q.stopdeskFee)) {
      const i = at(q.fee);
      parts = [...parts.slice(0, i + 1).map((p, k) => (k === i ? `${p}${sep(p)}` : p)), `${STOP_FEE[loc](String(q.stopdeskFee))}${i + 1 < parts.length ? ' ' : ''}`, ...parts.slice(i + 1)];
    }
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').trim();
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
  const cur = loc === 'ar' ? 'دج' : 'DA';
  const home = q.free || q.fee === 0 ? FREE_HOME[loc] : `${q.fee} ${cur}`;
  const parts = splitSentences(reply);
  const line = MODE_FEES[loc](home, q.stopdeskFee !== null && q.stopdeskFee > 0 ? `${q.stopdeskFee} ${cur}` : null);
  return [...parts.slice(0, i).map((p, k) => (k === i - 1 && !/\s$/u.test(p) ? `${p} ` : p)), `${line} `, ...parts.slice(i)].join('').replace(/[ \t]+\n/g, '\n').trim();
};

const HANDOFF_LINE: Record<Loc, string> = {
  fr: "Merci pour votre message : l'équipe de la boutique va vous répondre.",
  ar: 'شكرا على رسالتك، فريق المحل راح يجاوبك.',
  arabizi: "Saha 3la la question, l'équipe ta3 lboutique rah tjawbek.",
  en: "Thanks for your message: the shop's team will answer you.",
};
/**
 * journey retest R14-4 (18/11): the AI's sentence of a turn handed to the team when the model wrote none — W1 « prix de gros pour 50
 * pièces du hijab soie ? » got only the system line. One short sentence in the customer's language: the team will answer.
 */
export const handoffLine = (lang: AiLanguage | string | undefined): string => HANDOFF_LINE[locOf(lang)];

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
