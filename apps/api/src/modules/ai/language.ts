// 04-ai-pipeline §3.6 — language of a customer text. Stored in `Conversation.context.lastLanguage` and used to pick the
// locale of the workspace system messages. Pure.
import type { AppLocale } from '@djaber/shared';

export type AiLanguage = 'ar' | 'arabizi' | 'fr' | 'en' | 'mixed';

const ARABIZI_WORDS = ['wach', 'wesh', 'rani', 'bghit', 'kayen', 'kayn', 'chhal', 'ch7al', 'bch7al', 'salam', 'slm', 'sahit', 'sa7it', 'nheb', 'n7eb', 'habit', '7abit', 'khoya', 'kho', 'chwiya', 'bezaf', 'bzaf', 'ndir', 'tawsil', 'win', 'wino', 'kifach', 'kifech', '3andkom', '3andi', 'machi', 'wela', 'wlh', 'saha', 'mlih', 'n3am', 'ih', 'makach', 'kach', 'nchri', 'ncommandi', 'dzair'];
const FRENCH_WORDS = ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'je', 'vous', 'nous', 'est', 'et', 'pour', 'avec', 'bonjour', 'salut', 'merci', 'prix', 'combien', 'livraison', 'commande', 'commander', 'oui', 'non', 'svp', 'avez', 'voudrais', 'veux', 'quel', 'quelle', 'où', 'ou', 'ma', 'mon', 'ça', 'cette', 'ce', 'en', 'au', 'sur', 'pas', 'que', 'qui', 'dispo', 'disponible', 'taille', 'couleur', 'acheter', 'annuler', 'remboursement'];
const ENGLISH_WORDS = ['the', 'is', 'are', 'you', 'do', 'have', 'how', 'much', 'price', 'hello', 'hi', 'please', 'thanks', 'thank', 'order', 'delivery', 'want', 'need', 'what', 'where', 'my', 'this', 'that', 'and', 'for', 'with', 'can', 'yes', 'no', 'buy', 'size', 'color', 'available', 'refund', 'cancel'];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9à-ÿ']+/i).filter(Boolean);

/**
 * Arabic script ratio > 0.4 ⇒ `ar`; Latin text with ≥ 2 arabizi markers (digits 3/7/9 inside words, `kh`, `ch`, darija
 * words) ⇒ `arabizi`; French stop-words ⇒ `fr`; else `en`; both scripts in comparable amounts ⇒ `mixed`.
 * An empty / symbol-only text keeps `previous`.
 */
export const detectLanguage = (text: string | null | undefined, previous?: AiLanguage, o: { neutral?: 'en' | 'previous' } = {}): AiLanguage | undefined => {
  if (!text) return previous;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (arabic + latin === 0) return previous;
  const ratio = arabic / (arabic + latin);
  if (ratio > 0.4 && ratio < 0.75 && latin >= 6) return 'mixed';
  if (ratio > 0.4) return 'ar';
  if (ratio >= 0.15 && arabic >= 3) return 'mixed';
  const w = words(text);
  let arabizi = 0;
  let fr = 0;
  let en = 0;
  for (const x of w) {
    if (/[a-z][379]|[379][a-z]/.test(x)) arabizi += 1;
    if (ARABIZI_WORDS.includes(x)) arabizi += 1;
    else if (/^(kh|gh)[a-z]{2,}|[a-z]{2,}(kh|ch)$/.test(x) && !FRENCH_WORDS.includes(x) && !ENGLISH_WORDS.includes(x)) arabizi += 0.5;
    if (FRENCH_WORDS.includes(x) || /[àâçéèêëîïôùûü]/.test(x)) fr += 1;
    if (ENGLISH_WORDS.includes(x)) en += 1;
  }
  // one clear darija word carries a short sentence ("chhal la robe ?"): Algerian customers mix French nouns into darija
  if (arabizi >= 2 || (arabizi >= 1 && arabizi >= fr && arabizi >= en)) return 'arabizi';
  if (fr > en) return 'fr';
  if (en > fr) return 'en';
  if (fr > 0) return 'fr';
  // no clue in the text ("ok", "spam 0", a name): the turn keeps the previous language, else English (`neutral: 'previous'`:
  // the previous one whatever it is, else none — the inbound side then lets the workspace locale apply)
  if (o.neutral === 'previous') return previous;
  return previous && previous !== 'ar' ? previous : 'en';
};

/** Locale of the workspace system messages: `ar` for Arabic script, `en` for English, French otherwise. */
export const systemLocale = (lang: string | undefined, fallback: AppLocale = 'fr'): AppLocale => (lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : lang === 'fr' || lang === 'arabizi' || lang === 'mixed' ? 'fr' : fallback);
