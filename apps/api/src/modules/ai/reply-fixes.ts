// Journey retest R7 (17/11, docs/audit/journeys-2026-11-16/journeys/R7-ai-orders.md): the server's last word on the reply text
// for two cases the model kept missing — a photo request for a product that has none (R7-2), a « ? » / « ... » answered with
// « Oui, je suis là ! » / « Vous êtes toujours là ? » (R7-3). Pure.
import type { AiLanguage } from './language';
import { foldGuard, PHOTO_WORD, splitSentences } from './reply-guard';

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
const locOf = (lang: AiLanguage | string | undefined): Loc => (lang === 'ar' ? 'ar' : lang === 'arabizi' ? 'arabizi' : lang === 'en' ? 'en' : 'fr');
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
