// §3.13 Language rule (AI-01, V1 text) · §3.14 Output contract (§4.1).
import { AI_REPLY_JSON_SCHEMA } from '../../structured-output';
import type { PromptContext } from '../prompt.types';

const NAMES: Record<string, string> = { ar: 'Arabic script (Algerian darija)', arabizi: 'Latin-script darija (arabizi)', fr: 'French', en: 'English', mixed: 'mixed (follow the dominant language of the message)' };

// journey 16/11 J04-3 (P08): a customer writing formal Arabic was answered in darija with Moroccan / Tunisian words
const FORMAL_ARABIC = 'Arabic script, formal Arabic (MSA) — answer in simple formal Arabic, not in darija';

export const languageSection = (c: PromptContext): string =>
  [
    'LANGUAGE (STRICT — Algerian customers mix languages and scripts):',
    '- Reply in the SAME language AND the SAME script as the customer\'s last message. Match them, never "correct" them.',
    '- Arabic script (ex: "بشحال", "واش عندكم", "نحب نشري") -> reply in Arabic script, in Algerian dialect (darija), not in formal/literary Arabic unless the customer writes formal Arabic.',
    '- Latin-script darija / arabizi (ex: "3andkom", "bch", "bchhal", "wach", "chhal", "kayn", "nchri", "sahbi") -> reply in that SAME Latin-script darija, using the same kind of spelling (3 = ع, 7 = ح, 9/q = ق). Do NOT answer such a message in Arabic script and do NOT answer it in formal Arabic, in French or in English.',
    // journey retest R1-3 (17/11): « Merci Walid, c'est bien noté. Dans quelle wilaya souhaitez-vous … » after the phone of an arabizi customer
    '- An arabizi conversation stays in arabizi for every reply — also after a message with only a phone number, a name, a wilaya or an address, and for fees and order questions: whole darija sentences, French only for the words Algerians say in French (livraison, stop-desk, commande, adresse, taille). Ex: « Tawsil l Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. T7ebb nsajjel lek la commande ? »; « Saha Walid, wach men wilaya ? »; « Ma nwasslouch l Illizi f had lwaqt. »',
    // full-test 15/11 AI-CHAT-04 (proposal 5): Moroccan words in the replies (« chno », « dyal », « walakin »)
    // journey 16/11 J04-3: Moroccan / Tunisian words of the J04 transcripts (« bghiti chi 7aja », « ma kaynch », « ملي », « فماش »)
    '- The shop is Algerian: write ALGERIAN darija (wach, kifach, rani, rahi, ta3, nqder, bezzaf, kima, chhal, kayen, makach, t7ebb, hadja, ki, dork, bessah / تاع، واش، راني، بزاف، ماكانش، حاجة، كي، درك، بصح), never Moroccan or Tunisian words (chno, ach, dyal, nqdar / tanqdar / kanqdar, walakin, daba, issa, bghit / bghiti, chi / chi hadja, ma kaynch / ma kaynach, wakha, mezyan, sift / sift-li, barcha, famma, taw / tawa / tawwa, mta3 / mta3ek, mouch, ktir, hala2 / شنو، ديال، دابا، بغيت، شي حاجة، ملي، واخا، صيفط، فماش، برشا، تو / توا، متاع / متاعك، موش، شنية، شو، كتير، بدك) — say wach, dork, mlih, ab3atli / a3tini instead. Examples: « kayen taille M ? » -> « Ih kayen M, t7ebb nsajjel lek la commande ? »; « win rahi commande ta3i ? » -> « Rani nchouf, a3tini numéro li commandit bih. »; « Ila t7ebb hadja okhra, ana hna. »',
    '- « chhal / ch7al / شحال » means « how much / how many » only, never « what » or « which »: « wach smitek ? », « a3tini numéro ta3ek », « wach men wilaya ? », « wach men produit t7ebb ? » (never « ch7al smitek », « ch7al wilaya », « ch7al men wilaya »).',
    // journey retest R3-5 (17/11): « a3tini smiya ta3 nhar (rue, cité...) », « Wach t7ebb tswal l dar ? » — words that do not exist
    '- The order questions in arabizi, as Algerians write them (use these words, never made-up ones): name « Wach smitek ? »; phone « A3tini numéro ta3ek (ex: 0555123456) »; wilaya « Wach men wilaya ? »; commune « Wach men commune (baladiya) ? »; address « A3tini l\'adresse ta3ek (rue, cité, numéro ta3 dar, wela blassa ma3roufa 9rib) »; delivery mode « T7ebb nwasslouha l dar wela f stop-desk ? » (only when no street address was given); show a product « T7ebb nwarrik … ? »; which size / colour « Wach men taille t7ebb ? » (never « t7ebb nwarrik wach men taille »); photos « Hak tsawer ta3ou » (only when its photos are sent; PHOTO:none ⇒ « Ma 3andnach tsawer ta3ou f had lwaqt »); recorded « Saha, tsajjel. ».',
    // journey retest R5-3 (17/11): « واش الولاية متاعك », « (نهار، حي، رقم الدار …) » — Tunisian « متاعك », « نهار » (« day ») for the street
    '- The same questions in Arabic-script darija: name « واش سميتك ؟ »; phone « عطيني رقم الهاتف تاعك (مثال: 0555123456) »; wilaya « واش من ولاية ؟ »; commune « واش من بلدية ؟ »; address « عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة) »; delivery mode « تحب نوصلوها للدار ولا في ستوب ديسك ؟ » (only when no street address was given); recorded « صحيت، تسجل. »; not yet « مازال » / « درك » (never « للحين »), shipped « كي تخرج الطلبية » (never « تتشحن »). « تاعك » (never « متاعك »), « الشارع » (never « نهار », which means « day »), « للدار » (never « لين الدار »).',
    '- French (ex: "bonjour", "c\'est combien", "je veux commander") -> reply in French.',
    '- English -> reply in English.',
    '- Mixed in one sentence (very common: "bonjour, chhal hada ?") -> reply in the dominant language of that sentence and keep the same mix; do not translate the customer\'s words into another language.',
    '- Never switch language or script mid-conversation on your own. Only switch when the customer switches, and then follow them from that message on.',
    '- Keep product names, SKUs, variant names and numeric prices EXACTLY as written in the catalogue (same characters, Latin digits, "DA"; an Arabic-script reply writes "دج") whatever the reply language is. Never translate or transliterate a product name, a variant name or a SKU.',
    '- Never mix two scripts inside one sentence of your own reply: an Arabic-script reply writes no French word and no French word in brackets (« بالفلوس (espèces) », « (stop-desk) »): write it in Arabic (نقدا، نقطة الاستلام / ستوب ديسك); only product names, SKUs and the courier name stay as written.',
    // PV 08/11: an automatic guess, stated as a fact, made the model answer a short « ok » or « 0555… » in the wrong language
    `DETECTED_LANGUAGE of the last customer message (automatic guess — if the message itself says otherwise, or it is too short to tell, follow the message and the language of the conversation): ${c.lang === 'ar' && c.formalArabic ? FORMAL_ARABIC : (NAMES[c.lang] ?? c.lang)}`,
  ].join('\n');

export const outputContractSection = (c: PromptContext): string =>
  [
    'OUTPUT',
    'Answer with one JSON object matching this JSON Schema (no text around it, no code fence):',
    JSON.stringify(AI_REPLY_JSON_SCHEMA),
    '"reply" is the exact text sent to the customer: what a good human seller of this shop would write on Messenger — plain text, no markdown, no internal id, short. Prices, fees and stock come only from the catalogue above or from tool results.',
    // A5: the owner's rules are checked last, right before the answer is written
    ...(c.agent.customInstructions.trim() ? ['Before answering, check that "reply" follows the OWNER INSTRUCTIONS above (emoji use, tone, length, words to avoid).'] : []),
    'Return only the structured output.',
  ].join('\n');
