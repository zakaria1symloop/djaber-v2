// §3.8 Image rule · §3.9 Cross-sell · §3.10 Product card template · §3.11 Closing · §3.12 Handoff rules.
import { UNCLEAR_STREAK_HANDOFF, VISION_CONFIDENCE_MIN } from '../../ai.constants';
import { systemLocale } from '../../language';
import type { PromptContext } from '../prompt.types';

export const imageRuleSection = (c: PromptContext): string =>
  c.agent.imageRecognition
    ? [
        'IMAGES',
        'A customer photo is analysed before you answer and arrives as a note "IMAGE RESULT: {productId, confidence}", "IMAGE RESULT: unsure", "multiple", "blurry" or "unavailable".',
        `confidence < ${VISION_CONFIDENCE_MIN} or unsure ⇒ ask the customer for confirmation; never state a price for an unconfirmed match.`,
        'multiple ⇒ ask which product; blurry ⇒ ask for a new photo; unavailable ⇒ ask the customer to describe the product.',
      ].join('\n')
    : '';

/** REC-01: never more than 3 suggestions in one reply (the `recommendations` output is capped to 3 as well). */
export const RECOMMENDATIONS_PER_TURN_MAX = 3;
/** Pairs listed in the section (the catalogue keeps ≤ 2 active rules per product); beyond that the model reads ALSO lines. */
const RECOMMENDATION_PAIRS_MAX = 30;

/**
 * §3.9 Cross-sell — the dedicated recommendations section (M11, REC-01): the 04-ai rule, the source → recommended pairs
 * of the products in the catalogue section (active rules, in the agent's scope), and how to report what was suggested
 * (`recommendations` = REC-03 impressions).
 */
export const crossSellSection = (c: PromptContext): string => {
  if (c.agent.capabilities.crossSell === false) return '';
  const pairs = c.catalogue.products.flatMap((p) => p.also.map((a) => `- [ID:${p.id}] ${p.name} → [ID:${a.id}] ${a.name} ${a.price} DA — ${a.reason?.trim() || 'often bought together'}`)).slice(0, RECOMMENDATION_PAIRS_MAX);
  return [
    'CROSS-SELL (RECOMMENDATIONS)',
    'Suggest at most 1 complementary product per conversation, only from ALSO lines, only after the customer chose a product.',
    pairs.length ? `RECOMMENDATION PAIRS (source → recommended):\n${pairs.join('\n')}` : 'RECOMMENDATION PAIRS: only the ALSO lines returned by search_products / get_product.',
    `Never more than ${RECOMMENDATIONS_PER_TURN_MAX} suggestions in one reply. Never suggest a product that is out of stock or that the customer already chose.`,
    'List every product you suggest in "recommendations" as { "sourceId", "recommendedId" } taken from these pairs; an empty list when you suggest nothing.',
  ].join('\n');
};

export const cardTemplateSection = (c: PromptContext): string =>
  `PRODUCT CARD\nWhen presenting a product use this template: ${c.agent.productCardTemplate?.trim() || '{name} — {price} DA'} (inside a natural sentence; one line per product when you list several${(c.agent.productCardTemplate ?? '').includes('{stock}') ? '; {stock} = « in stock » / « out of stock » in the customer language, never a number' : ''})\nList the ids of the products you present in productCards (at most 5); the cards (photo, name, price) are sent right after your text, so do not describe them again. Only present the products the customer is interested in, not the whole catalogue.
Each card has a « Commander » button (and « Plus de photos » when the product has several photos): a customer message « Commander · <product> » means they tapped it — start the order for that product.
When the customer asks to see more or other photos of a product (or taps « Plus de photos »), put its id in productPhotos: all its photos are sent after your text; just say so in a few words.`;

export const closingSection = (c: PromptContext): string => {
  const text = (c.agent.closingInstructions ?? '').trim();
  return text ? `CLOSING\n${text}` : '';
};

const BUILT_IN: Record<string, string> = {
  // retest 12/11 (Badro: « blocked after giving the phone number, again after the address »): the number given for the
  // order read as « call me » — order details are never a request for the team
  human_request: 'customer_request: the customer asks for a human, a manager or to be called back by the team (a phone number, an address or a name given for the order is order information, never a call request)',
  // PV 08/11: the rules were so wide that ordinary questions (an exchange, an impatient « alors ? ») handed the thread over
  refund: 'refund: the customer wants their money back (a question about exchanges or returns is answered from the RETURNS policy when there is one)',
  complaint: 'complaint: a problem with an order already placed or received (damaged, wrong item, never arrived after the expected delay) or a complaint about the shop — not a question about a product, and not a question about where an order is or when it arrives (answer that with lookup_order)',
  anger: 'angry: insults, threats or a clearly furious customer (an impatient or short message is not anger: just answer it)',
  '3_unclear': `unclear_streak: ${UNCLEAR_STREAK_HANDOFF} messages in a row that you could not understand`,
  off_topic: 'off_catalogue: a request only the team can handle (wholesale or reseller prices, a custom order, a partnership, a problem the policies do not cover). A simple question you have no answer to is NOT a handoff: use status=UNKNOWN',
  over_limits: 'order_limits: an order above MAX_QTY_PER_ORDER or MAX_AMOUNT',
  risky_client: 'risky_client: a tool reports a blocked or risky customer and RISKY_CLIENT_POLICY=handoff',
  keyword: 'keyword: the message contains one of HANDOFF_KEYWORDS',
};

export const handoffSection = (c: PromptContext): string => {
  const rules = c.agent.handoffRules;
  const enabled = Object.keys(BUILT_IN).filter((k) => !rules.length || rules.find((r) => r.kind === k)?.enabled !== false);
  const keywords = c.agent.handoffKeywords.map((k) => k.trim()).filter(Boolean);
  const lines = enabled.filter((k) => k !== 'keyword' || keywords.length).map((k) => `- ${BUILT_IN[k]}`);
  const custom = (c.agent.humanHandoffRules ?? '').trim();
  // tester notes 25/10: the shop's own handoff text (Paramètres › Messages système) is what tells the customer — the model
  // used to write its own sentence instead; it only announces the handoff when the shop left that text empty
  const handoffText = (c.workspace.systemMessages.handoff?.[systemLocale(c.lang, c.locale)] ?? c.workspace.systemMessages.handoff?.fr ?? '').trim();
  return [
    'HANDOFF TO A HUMAN',
    'Hand the conversation to the team when one of these rules applies:',
    ...lines,
    ...(keywords.length ? [`HANDOFF_KEYWORDS: ${keywords.join(', ')}`] : []),
    ...(custom ? [`Shop rules:\n${custom}`] : []),
    ...(c.unclearStreak >= UNCLEAR_STREAK_HANDOFF - 1 ? [`UNCLEAR_STREAK=${c.unclearStreak}: if this message is unclear too, hand off (unclear_streak).`] : []),
    handoffText
      ? `Instruction: status=HANDOFF with statusDetail=<rule id> (or call handoff_to_human). The shop's HANDOFF_MESSAGE is sent automatically right after your reply: do not announce the handoff yourself (no « je vous passe un conseiller », « a team member will contact you »); "reply" only answers what else the customer asked, or stays empty — when they only asked for a human, "reply" is empty.
HANDOFF_MESSAGE: "${handoffText}"`
      : 'Instruction: status=HANDOFF with statusDetail=<rule id> (or call handoff_to_human). Tell the customer briefly that a team member will follow up; do not promise a delay.',
    'status=UNKNOWN when you have no answer but no rule applies: say briefly that you will check with the team (call add_faq_candidate with the question) and keep helping with the rest — the conversation stays with you. status=UNCLEAR when you did not understand: say so politely in the customer language and ask them to rephrase.',
  ].join('\n');
};
