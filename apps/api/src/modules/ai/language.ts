// 04-ai-pipeline §3.6 — language of a customer text. Stored in `Conversation.context.lastLanguage` and used to pick the
// locale of the workspace system messages. Pure.
import type { AppLocale } from '@djaber/shared';

export type AiLanguage = 'ar' | 'arabizi' | 'fr' | 'en' | 'mixed';

const ARABIZI_WORDS = ['wach', 'wesh', 'rani', 'bghit', 'kayen', 'kayn', 'chhal', 'ch7al', 'bch7al', 'salam', 'slm', 'sahit', 'sa7it', 'nheb', 'n7eb', 'habit', '7abit', 'khoya', 'kho', 'chwiya', 'bezaf', 'bzaf', 'ndir', 'tawsil', 'win', 'wino', 'kifach', 'kifech', '3andkom', '3andi', 'machi', 'wela', 'wlh', 'saha', 'mlih', 'n3am', 'ih', 'makach', 'kach', 'nchri', 'ncommandi', 'dzair',
  // journey retest R1-3 (17/11): « nheb nechri 2 tapis de prière » read as French (« de », « prière »), the arabizi customer then answered in French
  'nechri', 'nachri', 'nechriw', 'zoudj', 'zouj', 'jouj', 'wahed', 'wahda', 'tlata', 'tleta', 'smiti', 'smitek', 'goulili', 'goulli', 'gouli', 'rahi', 'raho', 'wla', 'iyeh', 'lkamla', 'dork', 'dorka', 'bessah', 'labas', 'nchallah', 'inchallah', 'khlas', 'sahbi', 'nta', 'nti', 'ghir', 'nchouf', 'bach', 'bech', 'mazal', 'mazel', 'kayna', 'makanch', 'mkach'];
// journey 16/11 J04-2: « Bonsoir » (and the short forms « bsr », « bjr », « slt ») had no French word, so it was read as English
const FRENCH_WORDS = ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'je', 'vous', 'nous', 'est', 'et', 'pour', 'avec', 'bonjour', 'bonsoir', 'bsr', 'bjr', 'slt', 'coucou', 'salut', 'merci', 'stp', 'votre', 'vos', 'mes', 'il', 'elle', "c'est", "j'ai", 'aimerais', "d'accord", 'quand', 'comment', 'pourquoi', 'aussi', 'bien', 'bonne', 'madame', 'monsieur', 'livrer', 'peux', 'pouvez', 'voulez', 'prix', 'combien', 'livraison', 'commande', 'commander', 'oui', 'non', 'svp', 'avez', 'voudrais', 'veux', 'quel', 'quelle', 'où', 'ou', 'ma', 'mon', 'ça', 'cette', 'ce', 'en', 'au', 'sur', 'pas', 'que', 'qui', 'dispo', 'disponible', 'taille', 'couleur', 'acheter', 'annuler', 'remboursement'];
const ENGLISH_WORDS = ['the', 'is', 'are', 'you', 'do', 'have', 'how', 'much', 'price', 'hello', 'hi', 'hey', 'good', 'evening', 'morning', 'please', 'thanks', 'thank', 'order', 'delivery', 'want', 'need', 'what', 'where', 'my', 'your', 'this', 'that', 'and', 'for', 'with', 'to', 'of', 'it', 'i', "i'm", 'am', 'would', 'like', 'can', 'yes', 'no', 'buy', 'size', 'color', 'available', 'refund', 'cancel'];
/**
 * journey 16/11 J04-2: words of an address or a place that say nothing of the language (« cité 1000 logements », « Sétif »,
 * « numéro ») — an English customer typing their address got a French recap.
 */
const NEUTRAL_WORDS = new Set(['cité', 'cite', 'logements', 'logement', 'lgts', 'bloc', 'villa', 'rue', 'lotissement', 'lot', 'résidence', 'residence', 'bâtiment', 'batiment', 'bt', 'quartier', 'hay', 'numéro', 'numero', 'centre', 'ville', 'wilaya', 'commune', 'daira', 'stop', 'desk', 'stopdesk', 'route', 'avenue', 'bd', 'boulevard', 'el', 'ben', 'bir', 'ain', 'aïn', 'sidi', 'oued', 'bab', 'août', 'aout', 'sétif', 'médéa', 'béjaïa', 'béjaia', 'tébessa', 'saïda', 'béchar', 'témouchent', 'réghaïa', 'chéraga', 'défla']);

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
    if (NEUTRAL_WORDS.has(x)) continue;
    if (/[a-z][379]|[379][a-z]/.test(x)) arabizi += 1;
    if (ARABIZI_WORDS.includes(x)) arabizi += 1;
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
 * journey 16/11 J05-8: the language of a customer turn. A text with no clue (a phone number, a name, « ok ») keeps the
 * conversation's language whatever it is — also Arabic script (the old fallback gave English to an Arabic-script customer
 * typing their name, then every phone-only turn after it stayed English). A first message with no clue takes the shop's
 * language (`shopLanguage`, journey 16/11 J04-2).
 */
export const turnLanguage = (text: string | null | undefined, previous: AiLanguage | undefined, fallback?: ShopLanguage): AiLanguage =>
  previous ? (detectLanguage(text, previous, { neutral: 'previous' }) ?? previous) : (detectLanguage(text, undefined, { neutral: 'previous' }) ?? shopLanguage(text, fallback));

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
  /(?<![\p{L}\p{N}_])(chno|chnou|chnu|chnowa|chnoua|dyal|dyalek|dyali|dyalna|dyalo|dyalha|walakin|nqdar|ndirolek|daba|bghiti|bghit|bghina|tbghi|nbghi|kanbghi|chi|kaynch|makaynch|kaynach|makaynach|kaynash|makaynash|wakha|barcha|barsha|famma|mafamach|mafamech|tawwa|sifet|sifetli|nsifet|nsifetlek|شنو|شنوة|ديال|ديالك|ديالي|دابا|والاكين|بغيت|بغيتي|تبغي|نبغي|كنبغي|ملي|فماش|برشا|واخا|توة|شي حاجة|صيفط|صيفطلي|صيفطلك|نصيفط|نصيفطلك|نصيفطو)(?![\p{L}\p{N}_])/iu;
/**
 * journey 16/11 J04-3: « chhal / ch7al / شحال » means « how much / how many » — never « what » (« Ch7al smitek ? » = « how
 * much is your name? », « Ch7al numéro », « Ch7al wilaya »).
 */
export const WRONG_DARIJA = /(?<![\p{L}\p{N}_])(?:b?ch7al|b?chhal|chehal|chahal|شحال|بشحال)\s+(?:smitek|smiytek|smiyetek|esmek|ismek|ism|numéro|numero|num|wilaya|adresse|l'adresse|ladresse|اسمك|رقم|الرقم|الولاية|ولاية|العنوان)(?![\p{L}\p{N}_])/iu;
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
    ['nsifetlek', 'nab3atlek'], ['sifetli', 'ab3atli'], ['nsifet', 'nab3at'], ['sifet', 'ab3at'],
    ['شي حاجة', 'حاجة'], ['شنوة', 'واش'], ['شنو', 'واش'], ['ديالك', 'تاعك'], ['ديالي', 'تاعي'], ['ديال', 'تاع'], ['دابا', 'درك'], ['والاكين', 'بصح'],
    ['بغيتي', 'تحب'], ['بغيت', 'حبيت'], ['تبغي', 'تحب'], ['كنبغي', 'نحب'], ['نبغي', 'نحب'], ['ملي', 'كي'], ['فماش', 'ماكانش'], ['برشا', 'بزاف'], ['واخا', 'مليح'], ['توة', 'درك'],
    ['نصيفطلك', 'نبعثلك'], ['نصيفطو', 'نبعثو'], ['نصيفط', 'نبعث'], ['صيفطلي', 'ابعثلي'], ['صيفطلك', 'نبعثلك'], ['صيفط', 'ابعث'],
  ] as [string, string][]
  // a word with no Algerian equivalent (« chi ») is dropped with the space after it
).map(([from, to]) => [new RegExp(`(?<![\\p{L}\\p{N}_])${from}(?![\\p{L}\\p{N}_])${to ? '' : '[ \\t]*'}`, 'giu'), to]);
export const fixMoroccan = (text: string): string => {
  let out = text;
  for (const [re, to] of ALGERIAN_FOR) out = out.replace(re, (m) => (to && /^\p{Lu}/u.test(m) ? to.charAt(0).toUpperCase() + to.slice(1) : to));
  return out;
};
/** A Latin letter glued inside an Arabic word (« وnعاونك », rule 16 « one script per sentence »). */
export const SCRIPT_GLUE = /(?<=[؀-ۿ])[A-Za-z]{1,3}(?=[؀-ۿ])/gu;

/** Locale of the workspace system messages: `ar` for Arabic script, `en` for English, French otherwise. */
export const systemLocale = (lang: string | undefined, fallback: AppLocale = 'fr'): AppLocale => (lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : lang === 'fr' || lang === 'arabizi' || lang === 'mixed' ? 'fr' : fallback);
