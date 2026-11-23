// 04-ai-pipeline §3.6 — language of a customer text. Stored in `Conversation.context.lastLanguage` and used to pick the
// locale of the workspace system messages. Pure.
import type { AppLocale } from '@djaber/shared';

export type AiLanguage = 'ar' | 'arabizi' | 'fr' | 'en' | 'mixed';

const ARABIZI_WORDS = ['wach', 'wesh', 'rani', 'bghit', 'kayen', 'kayn', 'chhal', 'ch7al', 'bch7al', 'salam', 'slm', 'sahit', 'sa7it', 'nheb', 'n7eb', 'habit', '7abit', 'khoya', 'kho', 'chwiya', 'bezaf', 'bzaf', 'ndir', 'tawsil', 'win', 'wino', 'kifach', 'kifech', '3andkom', '3andi', 'machi', 'wela', 'wlh', 'saha', 'mlih', 'n3am', 'ih', 'makach', 'kach', 'nchri', 'ncommandi', 'dzair',
  // journey retest R1-3 (17/11): « nheb nechri 2 tapis de prière » read as French (« de », « prière »), the arabizi customer then answered in French
  'nechri', 'nachri', 'nechriw', 'zoudj', 'zouj', 'jouj', 'wahed', 'wahda', 'tlata', 'tleta', 'smiti', 'smitek', 'goulili', 'goulli', 'gouli', 'rahi', 'raho', 'wla', 'iyeh', 'lkamla', 'dork', 'dorka', 'bessah', 'labas', 'nchallah', 'inchallah', 'khlas', 'sahbi', 'nta', 'nti', 'ghir', 'nchouf', 'bach', 'bech', 'mazal', 'mazel', 'kayna', 'makanch', 'mkach',
  // journey retest R3-1 (17/11): « khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5 » after two
  // French messages stayed French (one clue only: the « kh » of « khouya »), so the server recap was French, the confirmation arabizi
  'khouya', 'khouia', 'khoui', 'khti', 'ana', 'ntouma', 'ntaya', 'ntiya', 'twasslou', 'twaslou', 'twasslo', 'twassli', 'nwasslou', 'nwaslou', 'twasselna', 'ywasel', 'ywasslou', 'twasel', 'n7ebb', 't7ebb', 'theb', 'chwia', 'ya3tik', 'kima',
  // journey retest R14-1 (18/11): the other darija yes words
  'wah', 'ayh', 'ayeh', 'aywa', 'aywah', 'iyyeh'];
/** journey retest R3-1: the one-letter darija prepositions (« l Constantine », « f El Khroub ») — half a clue each. */
const ARABIZI_PARTICLES = new Set(['l', 'f', 'fi']);
// journey 16/11 J04-2: « Bonsoir » (and the short forms « bsr », « bjr », « slt ») had no French word, so it was read as English
const FRENCH_WORDS = ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'je', 'vous', 'nous', 'est', 'et', 'pour', 'avec', 'bonjour', 'bonsoir', 'bsr', 'bjr', 'slt', 'coucou', 'salut', 'merci', 'stp', 'votre', 'vos', 'mes', 'il', 'elle', "c'est", "j'ai", 'aimerais', "d'accord", 'quand', 'comment', 'pourquoi', 'aussi', 'bien', 'bonne', 'madame', 'monsieur', 'livrer', 'peux', 'pouvez', 'voulez', 'prix', 'combien', 'livraison', 'commande', 'commander', 'oui', 'non', 'svp', 'avez', 'voudrais', 'veux', 'quel', 'quelle', 'où', 'ou', 'ma', 'mon', 'ça', 'cette', 'ce', 'en', 'au', 'sur', 'pas', 'que', 'qui', 'dispo', 'disponible', 'taille', 'couleur', 'acheter', 'annuler', 'remboursement'];
const ENGLISH_WORDS = ['the', 'is', 'are', 'you', 'do', 'have', 'how', 'much', 'price', 'hello', 'hi', 'hey', 'good', 'evening', 'morning', 'please', 'thanks', 'thank', 'order', 'delivery', 'want', 'need', 'what', 'where', 'my', 'your', 'this', 'that', 'and', 'for', 'with', 'to', 'of', 'it', 'i', "i'm", 'am', 'would', 'like', 'can', 'yes', 'no', 'buy', 'size', 'color', 'available', 'refund', 'cancel'];
/**
 * journey 16/11 J04-2: words of an address or a place that say nothing of the language (« cité 1000 logements », « Sétif »,
 * « numéro ») — an English customer typing their address got a French recap.
 */
const NEUTRAL_WORDS = new Set([
  // journey retest R3-1: place names whose « kh » / « ch » read as darija (« El Khroub », « Khenchela », « Ksar El Boukhari »)
  'khroub', 'khenchela', 'khemis', 'boukhari', 'kherrata', 'mechria', 'cherchell', 'chlef', 'chelghoum', 'bouchegouf', 'ouled',
  'cité', 'cite', 'logements', 'logement', 'lgts', 'bloc', 'villa', 'rue', 'lotissement', 'lot', 'résidence', 'residence', 'bâtiment', 'batiment', 'bt', 'quartier', 'hay', 'numéro', 'numero', 'centre', 'ville', 'wilaya', 'commune', 'daira', 'stop', 'desk', 'stopdesk', 'route', 'avenue', 'bd', 'boulevard', 'el', 'ben', 'bir', 'ain', 'aïn', 'sidi', 'oued', 'bab', 'août', 'aout', 'sétif', 'médéa', 'béjaïa', 'béjaia', 'tébessa', 'saïda', 'béchar', 'témouchent', 'réghaïa', 'chéraga', 'défla']);

// journey retest R3-1: a typographic apostrophe (« l’adresse ») is a straight one — a lone « l » is a darija particle
const words = (text: string) => text.toLowerCase().replace(/[’‘`]/g, "'").split(/[^a-z0-9à-ÿ']+/i).filter(Boolean);

/**
 * Arabic script ratio > 0.4 ⇒ `ar`; Latin text with ≥ 2 arabizi markers (digits 3/7/9 inside words, `kh`, `ch`, darija
 * words) ⇒ `arabizi`; French stop-words ⇒ `fr`; else `en`; both scripts in comparable amounts ⇒ `mixed`.
 * An empty / symbol-only text keeps `previous`.
 */
export const detectLanguage = (text: string | null | undefined, previous?: AiLanguage, o: { neutral?: 'en' | 'previous' } = {}): AiLanguage | undefined => {
  if (!text) return previous;
  // journey retest R4-2: inside a conversation, Arabic-script words that are only a value (« سمير بن علي », « smiti وليد بوزيد »)
  // say nothing of the language — the Latin rest (or nothing) decides
  if (previous && previous !== 'ar' && previous !== 'mixed') text = withoutArabicValues(text);
  // journey retest R9-1: and Latin words that are only a value (« Samir Benali 0661234567، قسنطينة، الخروب … », a product name)
  // next to Arabic-script words say nothing of it either — the Arabic rest decides
  if (previous) text = withoutLatinValues(text);
  // journey retest R14-1 (18/11): and the words of an address or a field label (« rue des frères Bouadou n 5 », « taille S ») carry
  // no language either — a bare yes (« ih », « wah », « oui », « ايه ») counts as the conversation's language
  if (previous) {
    if (bareYes(text)) return previous;
    text = withoutFieldWords(text);
  }
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
    if (NEUTRAL_WORDS.has(x)) continue;
    if (/[a-z][379]|[379][a-z]/.test(x)) arabizi += 1;
    if (ARABIZI_WORDS.includes(x)) arabizi += 1;
    else if (ARABIZI_PARTICLES.has(x)) arabizi += 0.5;
    else if (/^(kh|gh)[a-z]{2,}|[a-z]{2,}(kh|ch)$/.test(x) && !FRENCH_WORDS.includes(x) && !ENGLISH_WORDS.includes(x)) arabizi += 0.5;
    if (FRENCH_WORDS.includes(x) || /[àâçéèêëîïôùûü]/.test(x)) fr += 1;
    if (ENGLISH_WORDS.includes(x)) en += 1;
  }
  // journey retest R1-3: in an arabizi conversation, a message with a darija word stays arabizi whatever French nouns it
  // carries (« nheb nechri 2 tapis de prière », « cite 20 aout wla stop desk ? »)
  if (previous === 'arabizi' && arabizi >= 1) return 'arabizi';
  // one clear darija word carries a short sentence ("chhal la robe ?"): Algerian customers mix French nouns into darija
  const verdict: AiLanguage | null = arabizi >= 2 || (arabizi >= 1 && arabizi >= fr && arabizi >= en) ? 'arabizi' : fr > en ? 'fr' : en > fr ? 'en' : fr > 0 ? 'fr' : null;
  if (verdict) {
    // journey 16/11 J04-2: inside a conversation, a Latin message switches the language only with 2 clues or more — one
    // word (« oui », « merci », « thanks », « Bonsoir ») keeps the conversation's language
    const score = verdict === 'arabizi' ? arabizi : verdict === 'fr' ? fr : en;
    return previous && previous !== verdict && score < 2 ? previous : verdict;
  }
  // no clue in the text ("ok", "spam 0", a name): the turn keeps the previous language, else English (`neutral: 'previous'`:
  // the previous one whatever it is, else none — the inbound side then lets the workspace locale apply)
  if (o.neutral === 'previous') return previous;
  return previous && previous !== 'ar' ? previous : 'en';
};

/**
 * Houssem L28 (23/11): « حبيت نشوف الصور » was taken for a name (no word of this list): the Arabic reply was « corrected » into
 * French — « want / see / photos / products » words added.
 * journey retest R4-2 (17/11): Arabic-script words that say the customer writes Arabic — greetings, thanks, yes / no, « اسمي »,
 * question and request words (the darija / MSA markers below are added at use).
 */
const ARABIC_COMMON = /(?<!\p{L})[وفب]?(?:ال)?(?:عليكم|شكرا|شكراً|مرسي|صحيت|صحا|بارك|نعم|ايه|إيه|أيه|ايوه|لا|ممكن|فضلك|اسمي|إسمي|سميتي|انا|أنا|عندي|عندكم|عندك|حاجة|مرحبا|صباح|مساء|هذا|هذه|اريد|أريد|ابغي|عطيني|اعطيني|أعطيني|ابعث|ابعثلي|سعر|ثمن|توصيل|طلبية|طلب|نطلب|نشري|شري|كيف|بلاصة|نتا|نتي|انتم|كم|حبيت|حبيتي|تحب|تحبي|نشوف|شوف|نشوفو|وريني|صور|صورة|صوره|تصاور|تصويرة|فيديو|منتجات|منتوج|منتوجات)(?!\p{L})|(?<!عبد\s*)(?<!\p{L})[وفب]?(?:ال)?سلام(?!\p{L})/u;
/** Arabic-script words of an address or a name that are no clue either (« حي 1000 مسكن عمارة 5 », « بن »). */
const ARABIC_VALUE_WORDS = new Set(['حي', 'مسكن', 'مساكن', 'عمارة', 'عماره', 'رقم', 'شارع', 'نهج', 'طريق', 'بلدية', 'بلديه', 'ولاية', 'ولايه', 'دائرة', 'فيلا', 'قرب', 'بجانب', 'مقابل', 'في', 'و', 'بن', 'ابن', 'بنت', 'عبد', 'ستوب', 'ديسك']);
/**
 * journey retest R4-2: a message whose Arabic-script words are only a value — a name typed in Arabic script (« سمير بن علي »,
 * « smiti وليد بوزيد »), a place, an address: at most 4 such words, none a word of the language. The French customer of N4 and
 * the arabizi one of F3 got every later reply, the recap and the confirmation in Arabic script.
 */
export const arabicValuesOnly = (text: string): boolean => {
  const tokens = text.match(/[؀-ۿ]+/g) ?? [];
  if (!tokens.length || ARABIC_COMMON.test(text) || MSA_MARKERS.test(text) || DARIJA_MARKERS.test(text)) return false;
  return tokens.filter((t) => !ARABIC_VALUE_WORDS.has(t)).length <= 4;
};
/** The text without its Arabic-script value words (unchanged when they say something of the language). */
export const withoutArabicValues = (text: string): string => (arabicValuesOnly(text) ? text.replace(/[؀-ۿ]+/g, ' ') : text);

/** A Latin word that says the customer writes a Latin language: a French / English / arabizi word, a darija digit, an accent. */
const latinClue = (w: string): boolean =>
  FRENCH_WORDS.includes(w) || ENGLISH_WORDS.includes(w) || ARABIZI_WORDS.includes(w) || ARABIZI_PARTICLES.has(w) || /[a-z][379]|[379][a-z]/.test(w) || (/[àâçéèêëîïôùûü]/.test(w) && !NEUTRAL_WORDS.has(w));
/**
 * journey retest R9-1 (17/11): the twin of `arabicValuesOnly` — a message with Arabic-script words whose Latin words are only a
 * value: a name (« Samir Benali »), a product name (« Djellaba homme »), a place (« Bab Ezzouar »): at most 4 such words besides
 * address words, none a word of a Latin language. N18: « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » in an
 * Arabic-script conversation read as `mixed`, and the server recap came out in French.
 */
export const latinValuesOnly = (text: string): boolean => {
  if (!/[؀-ۿ]/.test(text)) return false;
  const tokens = words(text.replace(/[؀-ۿ]+/g, ' ')).filter((w) => /[a-zà-ÿ]/.test(w));
  if (!tokens.length || tokens.some(latinClue)) return false;
  return tokens.filter((w) => !NEUTRAL_WORDS.has(w)).length <= 4;
};
/** The text without its Latin value words (unchanged when they say something of the language, or with no Arabic script). */
export const withoutLatinValues = (text: string): string => (latinValuesOnly(text) ? text.replace(/[A-Za-zÀ-ÿ]+/g, ' ') : text);

/** journey retest R14-1 (18/11): the yes words of every language the customers write (one or two of them make a bare yes). */
const YES_WORDS = new Set(['ih', 'iyeh', 'iyyeh', 'ayh', 'ayeh', 'aywa', 'aywah', 'wah', 'eh', 'oui', 'ouii', 'ouais', 'yes', 'yeah', 'yep', 'ok', 'okay', 'ايه', 'إيه', 'أيه', 'ايوه', 'ايوا', 'واه', 'نعم']);
/**
 * journey retest R15-4 (18/11): the French / English words that only confirm next to a yes (« oui c'est bon », « ok d'accord », « yes
 * fine ») — F5 T3 « oui c'est bon » after an arabizi recap was read as French and confirmed in French. Arabizi customers write these
 * French words in every message; darija words (« ih saha ») are no such filler: in a French conversation they still say arabizi.
 */
const CONFIRM_FILLERS = new Set(['c', "c'est", 'cest', 'bon', 'cbon', "d'accord", 'daccord', 'dacc', 'parfait', 'super', 'nickel', 'merci', 'bien', 'tout', 'ça', 'ca', 'marche', 'vas', 'allez', 'y', 'go', 'je', 'confirme', 'valide', 'thanks', 'fine', 'good', 'sure']);
/**
 * A message that is only a yes (« ih », « wah », « ayh », « oui oui », « ايه 👍 »), or a yes with words that only confirm (« oui c'est
 * bon », « ok merci ») — it says nothing of the language.
 */
export const bareYes = (text: string): boolean => {
  const tokens = text.toLowerCase().replace(/[’‘`]/g, "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  if (tokens.length > 0 && tokens.length <= 2 && tokens.every((t) => YES_WORDS.has(t))) return true;
  return tokens.length <= 5 && tokens.some((t) => YES_WORDS.has(t)) && tokens.every((t) => YES_WORDS.has(t) || CONFIRM_FILLERS.has(t));
};
/** Words that open a street address (accents as typed or not). */
const ADDRESS_OPENERS = new Set(['cité', 'cite', 'rue', 'bloc', 'bâtiment', 'batiment', 'bat', 'bt', 'villa', 'lotissement', 'lot', 'résidence', 'residence', 'quartier', 'qrt', 'avenue', 'av', 'boulevard', 'bd', 'route', 'rte', 'impasse', 'chemin', 'allée', 'allee', 'immeuble', 'imm', 'appartement', 'appt', 'apt', 'logements', 'logement', 'lgts', 'hay', 'numéro', 'numero', 'étage', 'etage', 'coopérative', 'cooperative', 'coop', 'douar', 'street', 'road', 'building', 'apartment']);
/** Labels of an order field followed by its value (« taille S », « pointure 38 », « couleur noire », « size M »). */
const FIELD_LABELS = new Set(['taille', 'pointure', 'couleur', 'size', 'color', 'colour', 'quantité', 'quantite', 'qté', 'qte']);
/** Words that start a sentence of the customer's own, ending an address (« cité 5 je préfère le stop desk »). */
const SENTENCE_STARTERS = new Set(['je', "j'ai", "j'", 'vous', 'nous', 'tu', 'il', 'elle', "c'est", 'merci', 'svp', 'stp', 'pour', 'mais', 'est', 'please', 'thanks', 'thank', 'i', "i'm", 'you', 'can', 'my']);
/**
 * journey retest R14-1 (18/11): the customer's text without the words of a street address (from an address word to the end of its
 * segment, the darija words kept) and without an order field label and its value — P2 T2 « taille S, Amina Saadi 0698765432, Alger,
 * Bab Ezzouar, rue des frères Bouadou n 5 » in an arabizi conversation read as French (« taille », « des », « frères »), and the recap
 * and the confirmation of the « ih » after it came out in French. Like the R4-2 / R9-1 values, these words say nothing of the language.
 */
export const withoutFieldWords = (text: string): string =>
  text
    .split(/([,،;.!?؟\n]+)/u)
    .map((segment, k) => {
      if (k % 2) return segment;
      const kept: string[] = [];
      let address = false;
      let label = false;
      for (const token of segment.split(/\s+/u).filter(Boolean)) {
        const w = words(token)[0] ?? '';
        if (label) {
          label = false;
          continue;
        }
        if (FIELD_LABELS.has(w)) {
          label = true;
          continue;
        }
        if (address && SENTENCE_STARTERS.has(w)) address = false;
        if (!address && ADDRESS_OPENERS.has(w)) address = true;
        // inside an address only a darija word still speaks (« cite 20 aout wla stop desk »)
        if (address && !(ARABIZI_WORDS.includes(w) || /[a-z][379]|[379][a-z]/.test(w) || /[؀-ۿ]/.test(token))) continue;
        kept.push(token);
      }
      return kept.join(' ');
    })
    .join('');

/**
 * journey 16/11 J05-8: the language of a customer turn. A text with no clue (a phone number, a name, « ok ») keeps the
 * conversation's language whatever it is — also Arabic script (the old fallback gave English to an Arabic-script customer
 * typing their name, then every phone-only turn after it stayed English). A first message with no clue takes the shop's
 * language (`shopLanguage`, journey 16/11 J04-2).
 */
export const turnLanguage = (text: string | null | undefined, previous: AiLanguage | undefined, fallback?: ShopLanguage): AiLanguage => {
  if (previous) {
    const lang = detectLanguage(text, previous, { neutral: 'previous' }) ?? previous;
    // journey retest R9-1 (17/11): a message of both scripts keeps the conversation's language — `mixed` gave every server text
    // (recap, confirmation, fee sentence, questions) in French in the middle of an Arabic-script conversation
    return lang === 'mixed' && previous !== 'mixed' ? previous : lang;
  }
  const first = detectLanguage(text, undefined, { neutral: 'previous' });
  if (first !== 'mixed' || !text) return first ?? shopLanguage(text, fallback);
  // R9-1: a first message whose words of one script are only values (a name, a phone, a place, a product) takes the other script's language
  const arabic = detectLanguage(withoutLatinValues(text));
  if (arabic === 'ar') return 'ar';
  const latin = detectLanguage(withoutArabicValues(text), undefined, { neutral: 'previous' });
  return latin && latin !== 'mixed' ? latin : 'mixed';
};

/** The conversation's language after these customer texts (oldest first), each turn read with the one before (J05-8). */
export const conversationLanguage = (texts: ReadonlyArray<string | null | undefined>, fallback?: ShopLanguage): AiLanguage | undefined =>
  texts.reduce<AiLanguage | undefined>((prev, t) => (t && t.trim() ? turnLanguage(t, prev, fallback) : prev), undefined);

/** The shop's language: the agent's default language (`Agent.defaultLanguage`), else the workspace language. */
export type ShopLanguage = { agentDefault?: string | null; workspaceLocale?: string | null };
/**
 * journey 16/11 J04-2 (04-ai-pipeline §3.6, AI-01): a first message with no clue (« Samira », « 0661… », « 👍 ») is answered
 * in the shop's language — no longer in English for any Latin text. A darija / Arabic shop answers Latin letters in arabizi
 * and a text with no letter in Arabic script; kabyle (not detected) and no default fall back on the workspace language.
 */
export const shopLanguage = (text: string | null | undefined, s: ShopLanguage = {}): AiLanguage => {
  const latin = /[A-Za-zÀ-ÿ]/.test(text ?? '');
  const d = s.agentDefault && s.agentDefault !== 'kabyle' ? s.agentDefault : null;
  const base = d ?? (s.workspaceLocale === 'ar' ? 'darija' : s.workspaceLocale === 'en' ? 'en' : 'fr');
  if (base === 'fr' || base === 'en' || base === 'arabizi') return base;
  return latin ? 'arabizi' : 'ar';
};

/**
 * journey 16/11 J04-3: an Arabic-script message in formal Arabic (MSA: « ما هي طرق الدفع ؟ », « هل يمكنني … ») and not in
 * darija — the prompt then asks for simple formal Arabic instead of darija (rule 14: never « correct » the customer).
 */
const MSA_MARKERS = /(?<!\p{L})[وف]?(?:هل|ماذا|لماذا|كم|أريد|اريد|أود|يمكنني|يمكن|يمكنكم|لديكم|لديك|هناك|متى|أين|الذي|التي|سوف|ليس|إلى|هي|هو)(?!\p{L})/u;
const DARIJA_MARKERS = /(?<!\p{L})[وف]?(?:واش|شحال|بشحال|قداش|نحب|حاب|حابة|كاش|راني|راك|راكي|راه|راهي|تاع|نتاع|ديال|كاين|كاينة|وين|كيفاش|بزاف|درك|دروك|برك|مازال|هاذ|هادي|هذي|علاش|وقتاش|ماكانش|ماكاش|نشري|بغيت|خويا|ختي|يعطيك|صحيت|بصح|زوج|جوج|عطيني|قولي|شكون)(?!\p{L})/u;
export const formalArabic = (text: string | null | undefined): boolean => {
  const t = text ?? '';
  return detectLanguage(t) === 'ar' && MSA_MARKERS.test(t) && !DARIJA_MARKERS.test(t);
};

/**
 * full-test 15/11 AI-CHAT-04 (proposal 5): the language of an AI reply, only when it is clear — a reply too short to
 * tell, or with no clue (« 12 500 DA ? »), gives undefined. Used by the reply guard (`language_switch`) and the step-5
 * scenarios (`language_respected`).
 */
export const replyLanguage = (text: string): AiLanguage | undefined => {
  const clean = text.replace(/https?:\/\/\S+/g, ' ');
  const arabic = (clean.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (clean.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (arabic + latin < 12) return undefined;
  if (arabic / (arabic + latin) > 0.6) return 'ar';
  if (arabic / (arabic + latin) > 0.1) return 'mixed';
  if (words(clean).filter((w) => /[a-zà-ÿ]/i.test(w)).length < 4) return undefined;
  return detectLanguage(clean, undefined, { neutral: 'previous' });
};

/**
 * Does the reply break the language rule (04-ai-pipeline §4.3 rule 13)? Conservative: only a clear switch counts —
 * arabizi / Arabic script answered in French or English, Arabic script answered in Latin letters, French answered in
 * English or Arabic, English answered in French. Mixed customers and unclear replies always pass.
 */
/**
 * journey 16/11 J03-2 / AI-CHAT-04 retest: an arabizi greeting or tail around French sentences (« Wa 3likoum salam 😊
 * Livraison à domicile vers Oran : 600 DA … Délai : 2 à 5 jours. ») read as arabizi as a whole. The reply's sentences (an
 * emoji ends one too) are read one by one: 2 French ones or more, and more French than arabizi ones, is a French reply.
 */
const GREETING_WORDS = new Set(['wa', 'w', 'salam', 'slm', '3likoum', '3likom', 'alikoum', 'alaykoum', 'marhba', 'mar7ba', 'ahlan', 'bik', 'bikom', 'sahit', 'sa7it', 'khouya', 'khoya', 'khti', 'ukhti']);
const frenchBody = (reply: string): boolean => {
  let fr = 0;
  let arabizi = 0;
  for (const s of reply.split(/[.!?؟…\n]+|\p{Extended_Pictographic}/u)) {
    const w = words(s).filter((x) => /[a-zà-ÿ0-9]{2,}/i.test(x) && !/^\d+$/.test(x));
    // a greeting alone (« Wa 3likoum salam ») says nothing of the language of the answer
    if (w.length < 3 || w.every((x) => GREETING_WORDS.has(x))) continue;
    const l = detectLanguage(s, undefined, { neutral: 'previous' });
    if (l === 'fr') fr++;
    else if (l === 'arabizi') arabizi++;
  }
  return fr > arabizi && (fr >= 2 || arabizi === 0);
};
/**
 * journey retest R9-3 (17/11): a whole French sentence inside an arabizi reply (N9: « … zina bezzaf l les fêtes. Les tailles
 * disponibles : S et M à 4900 DA, et XL à 5200 DA. Taille L ma 3andnach … ») — 4 French clues or more, no darija clue, 5 words or
 * more. The words of the product / variant names (`names`, folded) are no clue: « Robe kabyle brodée à la main » stays.
 */
export const frenchSentenceIn = (reply: string, names: readonly string[] = []): boolean => {
  const fold = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const own = new Set(names.flatMap((n) => fold(n.toLowerCase()).split(/[^\p{L}\p{N}]+/u)).filter(Boolean));
  return reply.split(/[.!?؟…\n]+|\p{Extended_Pictographic}/u).some((s) => {
    const w = words(s).filter((x) => /[a-zà-ÿ]/.test(x) && !own.has(fold(x)));
    if (w.length < 5) return false;
    let fr = 0;
    for (const x of w) {
      if (NEUTRAL_WORDS.has(x)) continue;
      if (ARABIZI_WORDS.includes(x) || ARABIZI_PARTICLES.has(x) || /[a-z][379]|[379][a-z]/.test(x)) return false;
      if (FRENCH_WORDS.includes(x) || /[àâçéèêëîïôùûü]/.test(x)) fr++;
    }
    return fr >= 4;
  });
};
export const languageSwitched = (customer: AiLanguage, reply: string): boolean => {
  const r = replyLanguage(reply);
  if (!r || r === 'mixed' || customer === 'mixed') return false;
  if (customer === 'arabizi') return r === 'fr' || r === 'en' || frenchBody(reply);
  if (customer === 'ar') return r === 'fr' || r === 'en' || r === 'arabizi';
  if (customer === 'fr') return r === 'en' || r === 'ar';
  return r === 'fr';
};

/**
 * Moroccan (and Tunisian) darija words an Algerian shop never writes (« chno », « dyal », « walakin », « daba »…; journey
 * 16/11 J04-3: « bghiti », « chi 7aja », « ma kaynch », « ملي », « فماش », « برشا » from the J04 transcripts; J03 AI-CHAT-04
 * retest: « صيفطلي » / « sifetli », « send me »; retest R1-4 17/11: « chi hadja », « ma kaynach »). « walou » and
 * « kayen » are Algerian too: never flagged.
 */
export const MOROCCAN_WORDS =
  /(?<![\p{L}\p{N}_])(chno|chnou|chnu|chnowa|chnoua|achno|achnou|achnu|ach|dyal|dyalek|dyali|dyalna|dyalo|dyalha|walakin|nqdar|ndirolek|daba|bghiti|bghit|bghina|tbghi|nbghi|kanbghi|chi|kaynch|makaynch|kaynach|makaynach|kaynash|makaynash|wakha|barcha|barsha|famma|mafamach|mafamech|tawwa|tawa|taww|taw|mta3|mte3|mta3ek|mte3ek|mta3k|mte3k|mta3i|mte3i|mta3na|mte3na|mta3kom|mte3kom|mta3kum|mta3ha|mte3ha|mta3o|mta3ou|mte3o|mta3hom|mte3hom|chniya|chnia|chneya|mouch|hala2|halla2|ktir|kteer|baddak|biddak|3anjad|ezzayak|izzayak|mezyan|mzyan|mezyana|mzyana|mezyanin|mzyanin|tanqdar|kanqdar|tanqder|kanqder|tan9dar|kan9dar|katqdar|tatqdar|kat9dar|kayqdar|tayqdar|tandir|kandir|katdir|tatdir|kaydir|taydir|tan3ref|kan3ref|tankhdem|kankhdem|tanchouf|kanchouf|tanbghi|katbghi|tatbghi|n?sifet(?:li|lek|lik|lna)?|[nt]?sift(?:i?li|lek|lik|lna|ilek|ha|o)?|شنو|شنوة|شنية|ديال|ديالك|ديالي|ديالنا|ديالو|ديالها|دابا|والاكين|بغيت|بغيتي|تبغي|نبغي|كنبغي|ملي|فماش|مافماش|برشا|واخا|توة|توا|تو|هلق|هلأ|كتير|بدك|شو|شي حاجة|متاع|متاعك|متاعي|متاعنا|متاعكم|متاعها|متاعو|متاعه|متاعهم|موش|عنجد|ازيك|إزيك|مزيان|مزيانة|آش|اش|كنقدر|تنقدر|كندير|تندير|كاتدير|كنعرف|تنعرف|كنشوف|تنشوف|كاتبغي|صيفط|صيفطلي|صيفطلك|نصيفط|نصيفطلك|نصيفطو)(?![\p{L}\p{N}_])/iu;
/**
 * journey retest R2-1 (17/11): « Issa, sift-li l'adresse » — Moroccan « issa » (« now ») is flagged only at the start of a
 * sentence and before a comma: Issa is also a first name (« Merci Issa », « Saha Issa »).
 */
const MOROCCAN_NOW = /(?:^|(?<=[.!?؟…\n]\s*))issa(?=\s*,)/iu;
/** A hyphen or an apostrophe between two letters (« sift-li », « sift'li »): joined before the Moroccan words are matched. */
const JOINER = /(?<=\p{L})[-‐‑'’](?=\p{L})/gu;
/**
 * journey retest R2-1: a Moroccan / Tunisian word in the text, hyphenated forms included (« sift-li » was not caught). « ach »
 * (Moroccan « what ») only as a word of its own: « wach », « kifach », « 3lach », « bach » are Algerian and never match.
 */
export const moroccanIn = (text: string): boolean => MOROCCAN_WORDS.test(text) || MOROCCAN_NOW.test(text) || MOROCCAN_WORDS.test(text.replace(JOINER, ''));
/**
 * journey 16/11 J04-3: « chhal / ch7al / شحال » means « how much / how many » — never « what » (« Ch7al smitek ? » = « how
 * much is your name? », « Ch7al numéro », « Ch7al wilaya »). Journey retest R3-2 (17/11): also with « men » (« Ch7al men wilaya
 * nta ? » = « how many of wilaya are you? »); « ch7al men produit t7ebb ? » (how many products) and « ch7al l Oran ? » (the fee
 * to Oran) are right and never match.
 */
export const WRONG_DARIJA = /(?<![\p{L}\p{N}_])(b?ch7al|b?chhal|chehal|chahal|شحال|بشحال)\s+(?:(men|mn|من)\s+)?(smitek|smiytek|smiyetek|esmek|ismek|ism|numéro|numero|num|wilaya|commune|baladiya|adresse|l'adresse|ladresse|اسمك|رقم|الرقم|الولاية|ولاية|البلدية|بلدية|العنوان)(?![\p{L}\p{N}_])/iu;
/**
 * journey retest R3-5 (17/11): arabizi the model made up for the address question — « a3tini smiya ta3 nhar » (« the name of
 * the day »), « tswal l dar » (no such verb) — flagged and replaced like the Moroccan words.
 */
const ODD_ARABIZI = /(?<![\p{L}\p{N}_])(?:smiy(?:a|et|at)\s+(?:ta3\s+)?e?nnhar|smiy(?:a|et|at)\s+(?:ta3\s+)?nhar|tswal|taf3il)(?![\p{L}\p{N}_])/iu;
/**
 * journey retest R5-3 (17/11): wrong darija words of the R4 / R5 transcripts, each with the natural Algerian wording — flagged
 * like the Moroccan words and replaced by `fixMoroccan`. Narrow on purpose: « نهار » / « nhar » (« day ») only inside an address
 * question (« (نهار، حي، رقم الدار …) », « اسم النهار »), « سوي » only after a garment (« حجاب سوي » = « soie »), « t7ebb nchouf »
 * (« that I see ») only at the end of a question.
 */
const ODD_FIXES: [RegExp, string | ((m: string, ...groups: string[]) => string)][] = [
  [/(?<![\p{L}\p{N}_])(?:ال)?نهار(?=\s*[،,]\s*(?:ال)?(?:حي|عمارة|رقم|دار|بلوك))/gu, 'الشارع'],
  [/(?<=(?:\(|(?:ال)?حي\s*[،,])\s*)(?:ال)?نهار(?![\p{L}\p{N}_])/gu, 'الشارع'],
  [/(?<![\p{L}\p{N}_])(?:اسم|إسم|سمية|سميه)\s+(?:تاع\s+)?(?:ال)?نهار(?![\p{L}\p{N}_])/gu, 'الشارع'],
  [/(?<![\p{L}\p{N}_])nhar(?=\s*,\s*(?:cit[ée]|rue|bloc|ra9m|num[ée]ro|hay|dar)(?![\p{L}]))/giu, 'rue'],
  [/(?<=\(\s*)nhar(?![\p{L}\p{N}_])/giu, 'rue'],
  // « Rah yetsawar m3a l carte » (« it is being photographed ») for « its photos are on the card »
  [/(?<![\p{L}\p{N}_])rah\s+yetsaw[ae]r(?![\p{L}\p{N}_])/giu, 'rahom tsawer ta3ou'],
  [/(?<![\p{L}\p{N}_])yetsaw[ae]r(?![\p{L}\p{N}_])/giu, 'tsawer ta3ou'],
  // « zouj ydjiw disponibles » for « both are available »
  [/(?<![\p{L}\p{N}_])ydjiw\s+disponibles?(?![\p{L}\p{N}_])/giu, 'kaynin'],
  // « Wach men produit t7ebb nchouf ? » (« that I see ») for « that I show you »
  [/(?<![\p{L}\p{N}_])t7ebb\s+nchouf(?=\s*(?:[?؟.!]|$))/giu, 't7ebb nwarrik'],
  // journey retest R6-3: « Wach t7ebb nchouf wahed mennhom ? » — the same with the product after it (« nchouflek » = « I check for
  // you » stays)
  [/(?<![\p{L}\p{N}_])t7ebb\s+nchouf(?=\s+(?:wa[h7]e?d|wa[h7]da|chi|ay|hada|hadi|hadou|l?produit|l?model|l?modèle|men|mennhom|menhom))(?![\p{L}\p{N}_])/giu, 't7ebb nwarrik'],
  // « wach men wilaya t7ebb nwasslouk l'commande ? » (« deliver you the order ») for « nwassloulek la commande »
  [/(?<![\p{L}\p{N}_])nwasslouk\s+l['’]?\s*commande(?![\p{L}\p{N}_])/giu, 'nwassloulek la commande'],
  // « Djellaba homme فالصوف الفاين » (« laine fine » in Arabic letters) for « الصوف الرقيق »
  [/(?<=(?:ال)?(?:صوف|قطن|حرير|قماش)\s+)الفاين(?![\p{L}\p{N}_])/gu, 'الرقيق'],
  [/(?<=(?:ال)?(?:صوف|قطن|حرير|قماش)\s+)فاين(?![\p{L}\p{N}_])/gu, 'رقيق'],
  // journey retest R10-4 (17/11): « جلابة رجالي في لاين فين، من الصوف الرقيق » (« laine fine » in Arabic letters next to its
  // translation) — dropped before « من الصوف », else « الصوف الرقيق »
  [/(?:(?<![\p{L}])(?:في|ف|ب|من)\s*)?(?<![\p{L}])(?:ال)?لاين\s+(?:ال)?فين\s*[،,]?\s*(?=(?:و\s*)?من\s+(?:ال)?صوف)/gu, ''],
  [/(?<![\p{L}\p{N}_])(?:ال)?لاين\s+(?:ال)?فين(?![\p{L}\p{N}_])/gu, 'الصوف الرقيق'],
  // « Wach wahda men les wilayat li nwasslou ? » (a question with no meaning, after « not served »)
  [/(?<![\p{L}\p{N}_])wach\s+wa[h7]da\s+men\s+(?:les\s+)?wilayat\s+li\s+nwasslou(?:lha|lhom)?\s*[?؟]/giu, 'T7ebb nwasslouha l wilaya okhra ?'],
  // « حجاب سوي » (« soie » in Arabic letters) for « حرير »; « 700 دج لين الدار » (« until », not Algerian) for « للدار »
  [/(?<=(?:ال)?(?:حجاب|شال|فولار|خمار)\s+)سوي(?![\p{L}\p{N}_])/gu, 'حرير'],
  [/(?<![\p{L}\p{N}_])لين\s+(?:ال)?دار(?![\p{L}\p{N}_])/gu, 'للدار'],
  // journey retest R7-3 (17/11): « ما عندناش رقم تتبع للحين » (Gulf « for now ») → « درك »; « بمجرد ما تتشحن » (Mashreq « is
  // shipped ») → « تخرج »; « T7ebb nwarrik wach men taille ? » (« do you want me to show you which size ») → « Wach men taille t7ebb ? »
  [/(?<![\p{L}\p{N}_])للحين(?![\p{L}\p{N}_])/gu, 'درك'],
  [/(?<![\p{L}\p{N}_])(?:تتشحن|تنشحن)(?![\p{L}\p{N}_])/gu, 'تخرج'],
  [/(?<![\p{L}\p{N}_])(?:يتشحن|ينشحن)(?![\p{L}\p{N}_])/gu, 'يخرج'],
  [/(?<![\p{L}\p{N}_])t7ebb\s+nwarrik\s+(wach\s+men\s+[\p{L}'’-]+)\s*([?؟])/giu, (_m, what: string, mark: string) => `${what} t7ebb ${mark}`],
  // journey retest R8-5 (17/11): « Ghir after that nkamlou la commande m3ak » (English inside arabizi) → « Mba3d nkamlou … »;
  // « nchouf ash nqder ndir lik » (Moroccan « ash ») → « nchouflek wach nqder ndirlek »; « Ma 3andnachch » → « Ma 3andnach »;
  // « مازال ما تخرجتش » → « مازال ما خرجتش »
  [/(?<![\p{L}\p{N}_])(?:ghir\s+)?after\s+that(?=\s+n[\p{L}])/giu, 'mba3d'],
  [/(?<![\p{L}\p{N}_])nchouf\s+ash\s+nqder(\s+ndir\s*(?:lik|lek|lak))?(?![\p{L}\p{N}_])/giu, (_m, dir?: string) => `nchouflek wach nqder${dir ? ' ndirlek' : ''}`],
  [/(?<![\p{L}\p{N}_])3andna(?:ch){2,}(?![\p{L}\p{N}_])/giu, '3andnach'],
  [/(?<=ما\s*)تخرجتش(?![\p{L}\p{N}_])/gu, 'خرجتش'],
  // journey retest R9-3 (17/11): « Lmoute, ma nwasslouch l Illizi » (« lmout » = « the death ») — an apology at the start of a
  // sentence (« Smahli, »), else the watch (« la montre »); « Wach wilaya okhra t7ebb tswayyab fiha? » (no such verb) → « t7ebb
  // nwasslou liha »
  [/(?:^|(?<=[.!?؟…\n]\s*))lmoute?(?=\s*,)/giu, 'Smahli'],
  [/(?<![\p{L}\p{N}_])lmoute?(?![\p{L}\p{N}_])/giu, 'la montre'],
  [/(?<![\p{L}\p{N}_])(?:t7ebb\s+)?tswa?yy?ab\s+fiha(?![\p{L}\p{N}_])/giu, 't7ebb nwasslou liha'],
  [/(?<![\p{L}\p{N}_])tswa?yy?ab(?![\p{L}\p{N}_])/giu, 'nwasslou'],
];
const oddIn = (text: string) => ODD_FIXES.some(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(text));
/** journey retest R3-2 / R3-5 / R5-3: « ch7al » used for « what / which », or made-up arabizi / darija — the reply guard flags it with the Moroccan words. */
export const wrongDarijaIn = (text: string): boolean => WRONG_DARIJA.test(text) || ODD_ARABIZI.test(text) || oddIn(text);
/**
 * journey retest R1-4 (17/11): the Algerian word for each Moroccan / Tunisian one — the server's last word when the
 * corrective turn of the reply guard kept them (« Wach t7ebb ta3raf 3la chi hadja ? » was sent as is). Longest forms first.
 */
const ALGERIAN_FOR: [RegExp, string][] = (
  [
    ['ma kaynach', 'makach'], ['ma kaynash', 'makach'], ['ma kaynch', 'makach'], ['makaynach', 'makach'], ['makaynash', 'makach'], ['makaynch', 'makach'], ['kaynach', 'makach'], ['kaynash', 'makach'], ['kaynch', 'makach'],
    ['chi hadja', 'hadja'], ['chi 7aja', 'hadja'], ['chi haja', 'hadja'], ['chi', ''],
    ['chnowa', 'wach'], ['chnoua', 'wach'], ['chnou', 'wach'], ['chnu', 'wach'], ['chno', 'wach'],
    ['dyalek', 'ta3ek'], ['dyali', 'ta3i'], ['dyalna', 'ta3na'], ['dyalo', 'ta3o'], ['dyalha', 'ta3ha'], ['dyal', 'ta3'],
    ['walakin', 'bessah'], ['nqdar', 'nqder'], ['ndirolek', 'ndirlek'], ['daba', 'dork'],
    ['kanbghi', 'nheb'], ['nbghi', 'nheb'], ['tbghi', 't7ebb'], ['bghiti', 't7ebb'], ['bghina', 'n7ebbou'], ['bghit', 'nheb'],
    ['wakha', 'mlih'], ['barcha', 'bezzaf'], ['barsha', 'bezzaf'], ['mafamach', 'makach'], ['mafamech', 'makach'], ['famma', 'kayen'], ['tawwa', 'dork'],
    // journey retest R3-2 (17/11): Tunisian « tawa » (« Rani nab3atlek les photos tawa »), « mta3 », « mouch »; Middle-Eastern « hala2 », « ktir », « baddak »
    ['tawa', 'dork'], ['mta3ek', 'ta3ek'], ['mte3ek', 'ta3ek'], ['mta3', 'ta3'], ['mte3', 'ta3'],
    // journey retest R5-2 (17/11): the short Tunisian « taw » (« Rah … m3a l carte taw »), the other persons of « mta3 », « chniya »
    ['taww', 'dork'], ['taw', 'dork'], ['mta3k', 'ta3ek'], ['mte3k', 'ta3ek'], ['mta3i', 'ta3i'], ['mte3i', 'ta3i'], ['mta3na', 'ta3na'], ['mte3na', 'ta3na'], ['mta3kom', 'ta3kom'], ['mte3kom', 'ta3kom'], ['mta3kum', 'ta3kom'], ['mta3ha', 'ta3ha'], ['mte3ha', 'ta3ha'], ['mta3ou', 'ta3ou'], ['mta3o', 'ta3ou'], ['mte3o', 'ta3ou'], ['mta3hom', 'ta3hom'], ['mte3hom', 'ta3hom'], ['chniya', 'wach'], ['chnia', 'wach'], ['chneya', 'wach'], ['mouch', 'machi'], ['halla2', 'dork'], ['hala2', 'dork'], ['kteer', 'bezzaf'], ['ktir', 'bezzaf'], ['baddak', 't7ebb'], ['biddak', 't7ebb'], ['3anjad', 'bessah'], ['ezzayak', 'kirak'], ['izzayak', 'kirak'],
    // journey retest R3-5: « a3tini smiya ta3 nhar (rue, cité…) », « Wach t7ebb tswal l dar … ? »
    ['smiya ta3 ennhar', "l'adresse"], ['smiyet ta3 ennhar', "l'adresse"], ['smiya ta3 nhar', "l'adresse"], ['smiyet ta3 nhar', "l'adresse"], ['smiyet ennhar', "l'adresse"], ['smiyet nhar', "l'adresse"], ['smiyat nhar', "l'adresse"], ['smiya nhar', "l'adresse"], ['tswal', 'nwasslouha'],
    ['nsifetlek', 'nab3atlek'], ['sifetli', 'ab3atli'], ['nsifet', 'nab3at'], ['sifet', 'ab3at'],
    // journey retest R2-1 (17/11): « sift-li » (joined first, see fixMoroccan), « Ach numéro ta3ek ? », « Mezyan, Boufarik … »
    ['nsiftlek', 'nab3atlek'], ['nsiftlik', 'nab3atlek'], ['nsift', 'nab3at'], ['tsiftli', 'tab3atli'], ['tsift', 'tab3at'], ['siftili', 'ab3atli'], ['siftli', 'ab3atli'], ['siftilek', 'nab3atlek'], ['siftlek', 'nab3atlek'], ['siftlik', 'nab3atlek'], ['siftlna', 'ab3atelna'], ['siftha', 'ab3atha'], ['sifto', 'ab3atou'], ['sift', 'ab3at'],
    ['achnou', 'wach'], ['achno', 'wach'], ['achnu', 'wach'], ['ach', 'wach'],
    // journey retest R4-5 (17/11): the Moroccan durative « ta- / ka- » forms (« o9rib tanqdar towsal fiha ? »)
    ['tanqdar', 'nqder'], ['kanqdar', 'nqder'], ['tanqder', 'nqder'], ['kanqder', 'nqder'], ['tan9dar', 'nqder'], ['kan9dar', 'nqder'], ['katqdar', 'tqder'], ['tatqdar', 'tqder'], ['kat9dar', 'tqder'], ['kayqdar', 'yqder'], ['tayqdar', 'yqder'],
    ['tandir', 'ndir'], ['kandir', 'ndir'], ['katdir', 'tdir'], ['tatdir', 'tdir'], ['kaydir', 'ydir'], ['taydir', 'ydir'], ['tan3ref', 'na3ref'], ['kan3ref', 'na3ref'], ['tankhdem', 'nkhdem'], ['kankhdem', 'nkhdem'], ['tanchouf', 'nchouf'], ['kanchouf', 'nchouf'], ['tanbghi', 'nheb'], ['katbghi', 't7ebb'], ['tatbghi', 't7ebb'],
    // journey retest R4-5: « b taman w taf3il » (« activation ») for « tafasil » (details)
    ['taf3il', 'tafasil'],
    ['mezyanin', 'mlah'], ['mzyanin', 'mlah'], ['mezyana', 'mliha'], ['mzyana', 'mliha'], ['mezyan', 'mlih'], ['mzyan', 'mlih'],
    ['شي حاجة', 'حاجة'], ['شنوة', 'واش'], ['شنو', 'واش'], ['ديالك', 'تاعك'], ['ديالي', 'تاعي'], ['ديال', 'تاع'], ['دابا', 'درك'], ['والاكين', 'بصح'],
    ['بغيتي', 'تحب'], ['بغيت', 'حبيت'], ['تبغي', 'تحب'], ['كنبغي', 'نحب'], ['نبغي', 'نحب'], ['ملي', 'كي'], ['مافماش', 'ماكانش'], ['فماش', 'ماكانش'], ['برشا', 'بزاف'], ['واخا', 'مليح'], ['توة', 'درك'], ['توا', 'درك'], ['هلق', 'درك'], ['هلأ', 'درك'], ['كتير', 'بزاف'], ['بدك', 'تحب'], ['شو', 'واش'],
    // journey retest R5-2 (17/11): the Arabic-script twins of the Latin list — Tunisian « متاعك » (« واش الولاية متاعك »), « تو »,
    // « موش », « شنية »; Moroccan « ديالنا », « مزيان », « آش » and the « ta- / ka- » forms; Middle-Eastern « عنجد », « ازيك »
    ['متاعك', 'تاعك'], ['متاعي', 'تاعي'], ['متاعنا', 'تاعنا'], ['متاعكم', 'تاعكم'], ['متاعها', 'تاعها'], ['متاعو', 'تاعو'], ['متاعه', 'تاعه'], ['متاعهم', 'تاعهم'], ['متاع', 'تاع'], ['موش', 'ماشي'], ['تو', 'درك'], ['شنية', 'واش'],
    ['ديالنا', 'تاعنا'], ['ديالو', 'تاعو'], ['ديالها', 'تاعها'], ['مزيانة', 'مليحة'], ['مزيان', 'مليح'], ['آش', 'واش'], ['اش', 'واش'], ['عنجد', 'بصح'], ['ازيك', 'كيراك'], ['إزيك', 'كيراك'],
    ['كنقدر', 'نقدر'], ['تنقدر', 'نقدر'], ['كندير', 'ندير'], ['تندير', 'ندير'], ['كاتدير', 'تدير'], ['كنعرف', 'نعرف'], ['تنعرف', 'نعرف'], ['كنشوف', 'نشوف'], ['تنشوف', 'نشوف'], ['كاتبغي', 'تحب'],
    ['نصيفطلك', 'نبعثلك'], ['نصيفطو', 'نبعثو'], ['نصيفط', 'نبعث'], ['صيفطلي', 'ابعثلي'], ['صيفطلك', 'نبعثلك'], ['صيفط', 'ابعث'],
  ] as [string, string][]
  // a word with no Algerian equivalent (« chi ») is dropped with the space after it
).map(([from, to]) => [new RegExp(`(?<![\\p{L}\\p{N}_])${from}(?![\\p{L}\\p{N}_])${to ? '' : '[ \\t]*'}`, 'giu'), to]);
const caseOf = (m: string, to: string) => (to && /^\p{Lu}/u.test(m) ? to.charAt(0).toUpperCase() + to.slice(1) : to);
export const fixMoroccan = (text: string): string => {
  // journey retest R2-1: a hyphenated Moroccan word (« sift-li ») is joined first — only when the joined word is Moroccan
  // (« c'est », « l'adresse », « stop-desk » stay as written)
  let out = text.replace(/\p{L}+(?:[-‐‑'’]\p{L}+)+/gu, (tok) => {
    const joined = tok.replace(JOINER, '');
    return joined.match(MOROCCAN_WORDS)?.[0].length === joined.length ? joined : tok;
  });
  out = out.replace(new RegExp(MOROCCAN_NOW.source, 'giu'), (m) => caseOf(m, 'dork'));
  for (const [re, to] of ALGERIAN_FOR) out = out.replace(re, (m) => caseOf(m, to));
  // journey retest R3-2: « Ch7al men wilaya nta ? » → « Wach men wilaya nta ? », « ch7al smitek » → « wach smitek »
  out = out.replace(new RegExp(WRONG_DARIJA.source, 'giu'), (m: string, head: string, _men: string | undefined, what: string) => {
    const ar = /[؀-ۿ]/.test(head);
    const wilaya = /^(?:wilaya|ولاية)$/iu.test(what);
    return caseOf(m, `${ar ? 'واش' : 'wach'} ${wilaya ? `${ar ? 'من' : 'men'} ` : ''}${what}`);
  });
  // journey retest R5-3: the odd wording of the transcripts
  for (const [re, to] of ODD_FIXES) out = out.replace(re, (m: string, ...g: string[]) => caseOf(m, typeof to === 'string' ? to : to(m, ...g)));
  return out;
};
/** A Latin letter glued inside an Arabic word (« وnعاونك », rule 16 « one script per sentence »). */
// R23 (22/11): Arabic LETTERS on both sides only — « للمقاسين S وM، » (و glued to the size, then an Arabic comma) lost its « M »:
// the punctuation of the Arabic block (، ؛ ؟) and its digits are not letters
export const SCRIPT_GLUE = /(?<=[ء-يٮ-ۓ])[A-Za-z]{1,3}(?=[ء-يٮ-ۓ])/gu;

/**
 * Locale of the workspace system messages (welcome, out of hours, handoff, out of stock — fr / ar / en only): `ar` for
 * Arabic script, `en` for English, French otherwise. Journey retest R2-5 (17/11): arabizi has no text of its own; it takes
 * the Arabic one when the shop speaks darija — the agent's default language `darija` / `ar` / `arabizi`, or, with no default
 * (or kabyle), a workspace in Arabic (`fallback = 'ar'`) — and the French one otherwise (a French / English shop).
 */
export const systemLocale = (lang: string | undefined, fallback: AppLocale = 'fr', agentDefault?: string | null): AppLocale => {
  if (lang === 'arabizi') {
    const d = agentDefault && agentDefault !== 'kabyle' ? agentDefault : null;
    return (d ? d === 'darija' || d === 'ar' || d === 'arabizi' : fallback === 'ar') ? 'ar' : 'fr';
  }
  // journey retest R9-1 (17/11): a `mixed` turn (only a first message of both scripts, with no language established yet) takes the
  // shop's language — the agent's default (darija / ar / arabizi ⇒ Arabic: the message has Arabic script), else the workspace's
  if (lang === 'mixed') {
    const d = agentDefault && agentDefault !== 'kabyle' ? agentDefault : null;
    return d ? (d === 'darija' || d === 'ar' || d === 'arabizi' ? 'ar' : d === 'en' ? 'en' : 'fr') : fallback;
  }
  return lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : lang === 'fr' ? 'fr' : fallback;
};
/**
 * journey retest R9-1 (17/11): the one language decision of every server-written text of a turn — the recap, the order
 * confirmation, the blocked-customer sentence, the delivery answer, the fee sentence, the « no photo » sentence, the field
 * questions and safe sentences of the reply guard: the turn's language (`turnLanguage`), and for a `mixed` turn the shop's
 * locale (`systemLocale`), never French by default.
 */
export const serverTextLanguage = (lang: AiLanguage | string | undefined, shopLocale?: AppLocale | string | null): 'fr' | 'ar' | 'arabizi' | 'en' => {
  if (lang === 'ar' || lang === 'arabizi' || lang === 'en' || lang === 'fr') return lang;
  return shopLocale === 'ar' || shopLocale === 'en' ? shopLocale : 'fr';
};
/**
 * journey retest R2-5: the language handed to the messaging module for a system text of an AI turn (`sendSystemText({ lang })`
 * reads only the workspace locale): an arabizi turn becomes the locale `systemLocale` chooses with the agent's default.
 */
export const systemLang = (lang: AiLanguage, agentDefault: string | null | undefined, workspaceLocale: string | null | undefined): string =>
  lang === 'arabizi' ? systemLocale(lang, workspaceLocale === 'ar' || workspaceLocale === 'en' ? workspaceLocale : 'fr', agentDefault) : lang;
