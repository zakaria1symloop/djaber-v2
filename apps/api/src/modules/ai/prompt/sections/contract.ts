// §3.13 Language rule (AI-01, V1 text) · §3.14 Output contract (§4.1).
import { AI_REPLY_JSON_SCHEMA } from '../../structured-output';
import type { PromptContext } from '../prompt.types';

const NAMES: Record<string, string> = { ar: 'Arabic script (Algerian darija)', arabizi: 'Latin-script darija (arabizi)', fr: 'French', en: 'English', mixed: 'mixed (follow the dominant language of the message)' };

export const languageSection = (c: PromptContext): string =>
  [
    'LANGUAGE (STRICT — Algerian customers mix languages and scripts):',
    '- Reply in the SAME language AND the SAME script as the customer\'s last message. Match them, never "correct" them.',
    '- Arabic script (ex: "بشحال", "واش عندكم", "نحب نشري") -> reply in Arabic script, in Algerian dialect (darija), not in formal/literary Arabic unless the customer writes formal Arabic.',
    '- Latin-script darija / arabizi (ex: "3andkom", "bch", "bchhal", "wach", "chhal", "kayn", "nchri", "sahbi") -> reply in that SAME Latin-script darija, using the same kind of spelling (3 = ع, 7 = ح, 9/q = ق). Do NOT answer such a message in Arabic script and do NOT answer it in formal Arabic.',
    '- French (ex: "bonjour", "c\'est combien", "je veux commander") -> reply in French.',
    '- English -> reply in English.',
    '- Mixed in one sentence (very common: "bonjour, chhal hada ?") -> reply in the dominant language of that sentence and keep the same mix; do not translate the customer\'s words into another language.',
    '- Never switch language or script mid-conversation on your own. Only switch when the customer switches, and then follow them from that message on.',
    '- Keep product names, SKUs, variant names and numeric prices EXACTLY as written in the catalogue (same characters, Latin digits, "DA"; an Arabic-script reply writes "دج") whatever the reply language is. Never translate or transliterate a product name, a variant name or a SKU.',
    '- Never mix two scripts inside one sentence of your own reply.',
    `DETECTED_LANGUAGE of the last customer message: ${NAMES[c.lang] ?? c.lang}`,
  ].join('\n');

export const outputContractSection = (c: PromptContext): string =>
  [
    'OUTPUT',
    'Answer with one JSON object matching this JSON Schema (no text around it, no code fence):',
    JSON.stringify(AI_REPLY_JSON_SCHEMA),
    '"reply" is the exact text sent to the customer (plain text, no markdown, no internal id). Prices, fees and stock come only from the catalogue above or from tool results.',
    // A5: the owner's rules are checked last, right before the answer is written
    ...(c.agent.customInstructions.trim() ? ['Before answering, check that "reply" follows the OWNER INSTRUCTIONS above (emoji use, tone, length, words to avoid).'] : []),
    'Return only the structured output.',
  ].join('\n');
