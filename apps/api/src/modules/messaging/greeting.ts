// Retest 12/11 (Badro: « after a handoff the bot never recovers: even a "hello" meant as a new conversation goes to a team
// member »): a customer message that only greets — « salam », « bonjour », « hello », « السلام عليكم », « slm khouya » —
// opens a new conversation. Used by `ConversationService.resumeAfterHandoff` to give a handed-off thread back to the AI.
// Darija in Latin letters (arabizi) and Arabic script included; emojis, punctuation and stretched letters (« salaaam ») ignored.

/** Words that greet on their own. */
const GREETINGS = new Set([
  // French
  'bonjour', 'bjr', 'bonsoir', 'bsr', 'salut', 'slt', 'coucou', 'cc', 'cava', 'sava', 'va',
  // English
  'hello', 'helo', 'hi', 'hey', 'morning', 'evening', 'afternoon',
  // darija / arabizi
  'salam', 'salaam', 'slam', 'slm', 'salem', 'salamou', 'salamo', 'assalam', 'assalamou', 'assalamu', 'essalam', 'esalam', 'asalam', 'salamalikoum', 'salamalaykoum',
  'ahla', 'ahlan', 'ahlen', 'ahlin', 'marhba', 'marhaba', 'mar7ba', 'sbah', 'sba7', 'sabah', 'saba7', 'msa', 'masa', 'labas', 'labes', 'wesh', 'wech', 'kirak', 'kiraki', 'kirakom',
  // Arabic script (folded: ة → ه, hamza forms → ا)
  'السلام', 'سلام', 'سلامو', 'مرحبا', 'مرحبه', 'اهلا', 'اهلين', 'هلا', 'صباح', 'مساء', 'لاباس', 'واش', 'كيراك',
]);
/** Words that only go with a greeting (« salam alikoum », « bonjour madame », « sbah el khir », « how are you »). */
const WITH_GREETING = new Set([
  'ca', 'cv', 'bonne', 'journee', 'soiree', 'madame', 'monsieur', 'mr', 'mme', 'good', 'how', 'are', 'you', 'u', 'there', 'everyone',
  'alikoum', 'alikom', 'alaykoum', 'alaikoum', 'alaykom', 'aleykoum', 'alaykum', 'alaikum', 'aleikum', 'alikum', '3likoum', '3likom', '3alaykoum', '3alikoum',
  'wa', 'w', 'rahmatou', 'rahmatullah', 'allah', 'wabarakatouh', 'el', 'al', 'lkhir', 'khir', 'nour', 'enour', 'khouya', 'khoya', 'khti', 'okhti', 'sahbi', 'sa7bi', 'frero',
  'عليكم', 'وعليكم', 'ورحمه', 'الله', 'وبركاته', 'الخير', 'النور', 'خويا', 'اختي',
]);
const MAX_WORDS = 8;

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    // « salaaam », « heyyy », « bonjoooour »: a letter stretched 3 times or more counts once
    .replace(/(\p{L})\1{2,}/gu, '$1');

/**
 * True when the message only greets: at most 8 words, every one a greeting word or a word that goes with one, and at least
 * one greeting word. A message with anything else (« bonjour, la robe rouge ? », « allo ? ») is not a greeting.
 */
export function isGreetingOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  const words = fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return false;
  return words.every((w) => GREETINGS.has(w) || WITH_GREETING.has(w)) && words.some((w) => GREETINGS.has(w));
}
