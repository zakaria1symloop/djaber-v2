// 04-ai-pipeline §5 — idempotent runs.
//   start     one `AiRun` per (conversationId, batchKey): a retried job reuses the `running` run, a finished run is final
//   turn      the model loop (≤ 3 tool rounds + the answer). Every tool call is stored in `AiToolCall` BEFORE it runs
//             (`executedAt = null`), then its result; a retried job is re-prompted, asks for the same call and gets the
//             stored result back — the tool does not run twice (AT-AI-05)
//   finish    status, tokens, latency, model, cost, metrics (§13)
//   reaper    `sched-ai-run-reaper`: runs `running` for more than 5 min ⇒ `error('reaped')`, credits released
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { prisma, Prisma, TenantContext, type AiIntent, type AiRun, type AiRunKind, type AiRunStatus, type Tx } from '@djaber/db';
import { MetricsService } from '../../core/metrics/metrics.service';
import { ProcessorRegistry } from '../../core/queue/processor.registry';
import { TenantResolver } from '../../core/tenancy/tenant.resolver';
import { CreditService } from '../credits/credit.service';
import { GUARD_RETRY_MIN_MS, MAX_STEPS, RUN_REAP_AFTER_MS } from './ai.constants';
import type { BuiltPrompt } from './prompt/prompt-builder';
import { AI_GATEWAY, AiProviderError, type AiGateway, type AiMessage, type AiToolCallRequest, type AiToolDef, type AiUsage } from './provider/ai.gateway';
import { RoutingService, type RoutedModel } from './routing.service';
import { FORMAT_REMINDER, parseReplyOutput, salvageReply, type AiReplyOutput } from './structured-output';
import { absentFields, canonicalTool, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';
import { allowedHandoffReasons, complaintIn, establishedReasons, HANDOFF_REFUSED_MARK, productAsk, fieldOnlyMessage, handoffReason, handoffRefusedInstruction, judgeHandoff, messageHandoffReasons, orderDetailsMessage, orderStatusAsk, placeCandidate, type HandoffRefusal, asksTeam } from './handoff-judge';
import { offCatalogueWords, productNamedIn, productsNamedIn, productWanted, productWords } from './product-named';
import { AUTO_FIX_RULES, checkReply, enforceReply, feeSentence, FIELD_QUESTIONS, greetingOnly, guardInstruction, priceQuestionOnly, numbersIn, orderClaimsIn, owedQuotes, quoteFacts, stripMarkdown, withToolResults, type CataloguePrice, type CatalogueStock, type GuardFacts, type GuardOutcome, type GuardViolation } from './reply-guard';
import { asksDelivery, asksSomething, blockedOrderText, confirmRequest, deliveryAnswer, orderConfirmationText, pendingRecap, recapReply, serverRecapAsked, withoutRecapClaims } from './tools/order-confirmation-text';
import { asksCancel, cancelAsked, cancelledAsked, cancelledNumber, confirmation, lastCancelled, phonesIn, placedNumbers, recapPending, recapYesArgs } from './tools/order-confirmation';
import { matchWilaya, namedVariant } from './tools/tool-registry';
import { offCatalogueWordsOf, placeIndex, placeNamedIn, placeOnlyMessage, wilayaIn, withoutPlaceNames, type PlaceIndex } from './tools/place-index';
import { contextOf } from '../messaging/messaging.presenter';
import { asksAddress, fillerMessage, handoffKind, handoffReply, handoffSystemLineShown, limitHandoffReply, cancelledReply, cancelClaimed, cancelQuestion, modeQuestionAt, noPhotoReply, noPhotoSaid, openingSaid, photoAsked, substitutionLine, withArabicCurrency, withArabicWords, withArabiziWords, withAskedPrice, withBothFees, withModeFees, withOneNowWord, withOrderStatusWording, withoutNameInPriceSlot, withoutPresenceTalk, withoutQuickReply, withoutStrayYes, withPlaceFacts, withAskedFacts, withoutBookingOffer, withOneStopdeskOffer, withoutRefusals, withSingleSpaces, withoutUnrelatedOffer, teamSaid, teamOnlyKind, withNotServed, withoutNotedSteps, withoutOrderStepAsk, withCustomerScriptName, choiceQuestion, withSpacedAmounts, withoutNotedOpening, withoutFalseApology, withPendingProductWording, withThanksFirst, withoutRepeatedNotServed, type PlaceProduct } from './reply-fixes';
import { bareYes as bareYesWords, serverTextLanguage, systemLocale } from './language';
import { orderLimitOf, quantityAbove, type OrderLimit, type QuantityContext, nameNumbersOf } from './order-limit';
import { msaRegister, MSA_NOTE, withMsaWording } from './msa';
import { foldText } from './tools/wilaya-aliases';
import { foldGuard, splitSentences } from './reply-guard';

/**
 * journey retest R11-5 (17/11): asked once when the answer and its format retry both failed the reply schema and nothing could be
 * salvaged — the message to the customer as plain text, which the server sends like a salvaged answer (status OK).
 */
export const PLAIN_TEXT_REMINDER =
  'Your last two answers could not be read. Write ONLY your message to the customer now, as plain text in their language: no JSON, no braces, no code, no field names, nothing before or after it.';
/** journey retest R1-1: told to the model on a message that only gives an order field (handoff_to_human is not offered). */
export const FIELD_ONLY_NOTE =
  'THIS MESSAGE only gives an order field (a name, a phone number, a place, an address) or answers yes: record it and answer — ask the next missing field, or call create_order for the recap when every field is known. handoff_to_human is not available for this message.';
/**
 * journey retest R5-6 (17/11): told to the model when the customer has given no phone number in the conversation (and the client
 * record has none): create_order is not offered — it was still called as a probe (`create_order {}`, `{ clientName: "---",
 * clientPhone: "0500000000", wilayaId: 1 }`) to learn the missing fields.
 */
export const NO_PHONE_NOTE =
  'NO PHONE NUMBER YET: the customer has not given a phone number in this conversation, so create_order is not available in this turn. Answer the customer and ask the next missing order field (the phone once the product and the name are known) — never a recap.';
/**
 * journey retest R6-5 (17/11): told to the model when the customer's messages name no street address and no stop-desk yet (and
 * no recap was shown): create_order stays offered — an address without any of these words still goes through — but it was
 * called on « Sétif, El Eulma » with no address, as a probe (refused, VALIDATION address).
 */
export const NO_ADDRESS_NOTE =
  "NO ADDRESS YET: the customer's messages give no street address (rue, cité, bloc, building, landmark) and no stop-desk choice so far. Unless THIS message or KNOWN CUSTOMER gives it, do not call create_order: ask for the address in one short question (or offer the stop-desk).";
/**
 * journey retest R7-4 (17/11): told to the model when no wilaya (nor a commune of one) and no street address was given yet:
 * create_order is not offered — it was called on « Je voudrais le sac …, 1 seul. Karim Haddad 0770112233 » with `wilayaId 1`
 * (Adrar, never named), refused as `notGivenByCustomer`: without a wilaya the call can only be refused.
 */
/**
 * Houssem live 23/11 (H-07 13:42 « salut » ⇒ the recap of an order left open 20 minutes earlier, no greeting; UX-079 « slt » ⇒ an offer to
 * reserve): on a message that is only a greeting, create_order is not offered — the model called it again for the earlier cart.
 */
/** Houssem live 25/11 UX-095: told to the model on a message that only asks a price (create_order is not offered). */
export const PRICE_QUESTION_NOTE =
  "PRICE QUESTION: the customer's message only asks how much something costs, so create_order is not available in this turn. Give the price (and whether it is available) from the CATALOGUE, then ask in one short question whether they want to order — no recap, no order, even when their name, phone and address are already known.";
export const GREETING_ONLY_NOTE =
  "GREETING ONLY: the customer's message is only a greeting, so create_order is not available in this turn. Greet back in a few words and ask what they are looking for — no product, no price, no recap, no offer to order or reserve.";
/**
 * Houssem live 23/11 UX-082 (client list L51): told to the model when the product the customer takes is a service — its order is not
 * delivered, so the notes about a missing wilaya / address do not apply and create_order stays offered.
 */
export const SERVICE_ORDER_NOTE =
  'SERVICE ORDER: the product the customer takes is a service — it is not delivered. Its order needs only their name and phone: never ask a wilaya, a commune, an address or a delivery mode, never give a delivery fee or delay. Once the name and the phone are known, call create_order with them and the item (no wilayaId): the platform sends the recap.';
/** UX-082: the product the customer takes (the latest CATALOGUE product their messages name) is a service (no stock tracking). */
export const takesService = (history: string, catalogue: readonly CataloguePrice[], stock: readonly CatalogueStock[] | undefined, takenIds: readonly string[] = []): boolean => {
  const service = (id: string | undefined) => !!id && stock?.find((x) => x.id === id)?.stock === null;
  const name = takenName(history, catalogue);
  if (name) return service(catalogue.find((p) => p.name === name)?.id);
  // client list L51, live 25/11: « je veux votre service de création de site web » names no product of the CATALOGUE — after the name and
  // the phone the agent asked « Dans quelle wilaya êtes-vous ? ». The product chosen earlier (or the last one shown) decides; a shop
  // that sells only services never delivers
  const taken = takenIds.find((id) => catalogue.some((p) => p.id === id));
  if (taken) return service(taken);
  return catalogue.length > 0 && catalogue.every((p) => service(p.id));
};
export const NO_PLACE_NOTE =
  'NO WILAYA YET: the customer has not named their wilaya (nor a commune or an address) in this conversation, so create_order is not available in this turn. Answer the customer and ask the next missing order field (the wilaya once the product, the name and the phone are known) — never a recap, never a default wilaya.';
/**
 * journey retest R8-4 (17/11): told to the model on a message that only names the wilaya / commune while no street address was
 * given yet: create_order is not offered — F1b T2 « Sétif, El Eulma » ⇒ `create_order { items: [] }` without commune or address.
 */
export const NO_STREET_NOTE =
  'NO STREET ADDRESS YET: this message only names the wilaya / commune, and no street address (rue, cité, building, landmark) nor stop-desk was given, so create_order is not available in this turn. Ask for the street address in one short question, or offer the stop-desk — never a recap.';
/** journey retest R7-4: told to the model on a message that gives the order's details (handoff_to_human is not offered). */
export const ORDER_DETAILS_NOTE =
  "THIS MESSAGE gives the order's details (product, name, phone, place) and asks nothing of the team: take the order — ask the next missing field, or call create_order for the recap when every field is known. handoff_to_human is not available for this message.";
/** Words of a street address or of a stop-desk choice (accents removed, lower case), in any language. */
const ADDRESS_HINT =
  /(?<![\p{L}])(?:rue|cite|bloc|blk|bt|bat|batiment|villa|logements?|lgts?|logts?|n°|quartier|qrt|hay|hai|residence|lotissement|lot|route|rte|avenue|av|boulevard|bd|impasse|allee|douar|village|cooperative|coop|immeuble|imm|appartement|appt|apt|etage|pres|cote|derriere|face|mairie|poste|mosquee|jami3|djama3|ecole|lycee|marche|souk|9rib|qrib|janb|street|st|road|building|near|apartment|flat|floor|stop|stopdesk|desk|bureau|agence|relais|zan9a|zenqa|derb|حي|شارع|نهج|عمارة|عماره|بلوك|فيلا|مسكن|سكن|طريق|قرب|قريب|جنب|مقابل|حذا|بجانب|المسجد|الجامع|البلدية|البريد|المدرسة|السوق|زنقة|درب|دوار|قرية|اقامة|إقامة|الطابق|ستوب|مكتب|وكالة)(?![\p{L}])/u;
/**
 * journey retest R6-5: no street address / stop-desk word in the customer's messages, and no create_order answer before that showed a
 * recap or placed an order. Journey retest R13-4 (18/11): a refused call (VALIDATION, a field missing) says nothing of an address — F1b
 * T1's refused probe made T2 « Sétif, El Eulma » look like an address was known, and `create_order { items: [] }` was offered and sent.
 */
export const noAddressYet = (ctx: Pick<ToolRunContext, 'customerHistory' | 'orderHistory'>): boolean =>
  ctx.customerHistory !== undefined &&
  !(ctx.orderHistory ?? []).some((h) => {
    const r = h.result as { ok?: unknown; error?: { code?: unknown } } | null;
    return (h.name ?? 'create_order') === 'create_order' && (r?.ok === true || r?.error?.code === 'CONFIRMATION_REQUIRED');
  }) &&
  !ADDRESS_HINT.test(ctx.customerHistory.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase());
/**
 * journey retest R17-6 (18/11): a digit is left in the message once its phone numbers (10 digits, 8-digit numbers typed short, +213, Arabic
 * digits) are taken out — a street number, a building, « 2 tapis ». Without one (and with no address word, `noAddressYet`), the message
 * cannot hold a street address: create_order is not offered (PF1 T2 « Je voudrais le sac à main cuir marron. Karim Haddad 0770112233 »).
 */
export const digitsBeyondPhones = (text: string): boolean =>
  /\d/u.test(
    text
      .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
      // journey re-run J04r-1: a number never runs across a line break (the messages of a batch are joined with « \n »)
      .replace(/(?<!\d)(?:(?:\+|00)213[ \t]*)?0?[5-7](?:[ \t.-]?\d){6,8}(?!\d)/gu, ' '),
  );
/**
 * journey retest R17-2 (18/11): the latest customer message naming a product of the CATALOGUE names one that is out of stock — the product
 * the customer « takes » (N5 T2 « Bon finalement je le prends » after T1 « le parfum oud c'est combien ? ») is not orderable: every order
 * field may be given, the substitute was never accepted, so no « call create_order directly » note.
 */
export const takesOutOfStock = (history: string, catalogue: readonly CataloguePrice[], unavailableNames: readonly string[]): boolean => {
  if (!catalogue.length || !unavailableNames.length) return false;
  for (const line of history.split(/\n+/).map((l) => l.trim()).filter(Boolean).reverse()) {
    const p = productNamedIn(line, catalogue);
    if (p) return unavailableNames.includes(p.name);
  }
  return false;
};
/**
 * journey retest R19-1: the call's customer name is one the customer wrote (its first word is in their messages, any script as written) — the
 * server asks the next field only once the name is known (else the model asks it).
 */
export const nameWritten = (name: unknown, history: string): boolean => {
  const first = typeof name === 'string' ? foldGuard(name).split(/[^\p{L}]+/u).find((w) => w.length >= 2) : undefined;
  return !!first && foldGuard(history).split(/[^\p{L}]+/u).includes(first);
};
/** journey retest R19-1: the name of that product (the latest CATALOGUE product the customer's messages name), null when none. */
export const takenName = (history: string, catalogue: readonly CataloguePrice[]): string | null => {
  for (const line of history.split(/\n+/).map((l) => l.trim()).filter(Boolean).reverse()) {
    const p = productNamedIn(line, catalogue);
    if (p) return p.name;
  }
  return null;
};
/**
 * journey retest R19-1 (18/11): told to the model when the message gives the order's details but the product the customer takes is out of
 * stock (create_order is not offered): N5 T2 asked get_product, search_products and a create_order for it (VALIDATION) — 4 model calls.
 * The wording asks for the in-stock product, never as an order step (R19-3: « je vous confirme : c'est bien … ? »).
 */
export const takesUnavailableNote = (name: string): string =>
  `THE PRODUCT THE CUSTOMER TAKES IS OUT OF STOCK: « ${name} » cannot be ordered, so create_order is not available in this turn and no tool is needed (the CATALOGUE gives the stock and the prices). Say in one short sentence that it is not available, then ask whether they want the in-stock product you offered (or one in stock from the CATALOGUE) instead — « Voulez-vous le … à la place ? » — never « je vous confirme », never offer to reserve or book it. Their details are kept for the recap.`;
/** journey retest R20-1: the tools that only read the catalogue (a product, its stock). */
const INFO_TOOLS = new Set(['search_products', 'get_product', 'check_availability']);
/** journey retest R20-1 (18/11): a search whose query is a placeholder, no words of a customer (A3 T1 `search_products {«noop», limit 1}`, run). */
const PLACEHOLDER_QUERY = /^(?:no[\s_-]?op|dummy|test|none|null|nil|nothing|placeholder|n\/?a|x+|[.\-_*?]+)$/iu;
export const placeholderCall = (call: Pick<AiToolCallRequest, 'name' | 'args'>): boolean =>
  canonicalTool(call.name) === 'search_products' && (typeof call.args?.query !== 'string' || PLACEHOLDER_QUERY.test(call.args.query.trim()));
/** journey retest R20-3: the words of a question asking which one (« lequel / laquelle », « wach men », « واش من », « which »), folded. */
const WHICH_ONE = /(?<![\p{L}])(?:lequel|laquelle|lesquels|lesquelles|quel\s+produit|wach\s+men|wachmen|achmen|which|واش\s+من|اشمن|أي\s+واحد)(?![\p{L}])/u;
const EITHER_OR = /(?<![\p{L}])(?:ou|or|wela|wla|walla|wala|ولا|او|أو|والا)(?![\p{L}])/u;
/**
 * journey retest R20-3 (18/11): the in-stock CATALOGUE products the AI's last message offers in its closing question, in the order it names them —
 * N5 T2 « … voulez-vous plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ? » ⇒ [Hijab soie, Robe kabyle brodée];
 * N5b « Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA ? » ⇒ [Coffret cadeau Aïd]. Two or more need « ou / wela / ولا / or » in that question;
 * a « Lequel vous intéresse ? » naming none reads the sentence before it (N7 T1). Empty when the question offers no product.
 */
export const offeredInQuestion = (lastAi: string | null | undefined, catalogue: readonly CataloguePrice[], unavailable: readonly string[]): CataloguePrice[] => {
  if (!lastAi?.trim()) return [];
  const parts = splitSentences(lastAi);
  const k = parts.map((p) => /[?؟]/u.test(p)).lastIndexOf(true);
  if (k < 0 || k < parts.length - 1) return [];
  const gone = new Set(unavailable);
  const named = (text: string) => {
    const said = productWords(text);
    return catalogue
      .filter((p) => !gone.has(p.name) && !!productNamedIn(text, [p]))
      .map((p) => ({ p, at: said.indexOf(productWords(p.name)[0] ?? '') }))
      .sort((a, b) => (a.at < 0 ? 1e9 : a.at) - (b.at < 0 ? 1e9 : b.at))
      .map((x) => x.p);
  };
  const question = parts[k]!;
  let found = named(question);
  let alt = EITHER_OR.test(foldGuard(question));
  if (!found.length && WHICH_ONE.test(foldGuard(question)) && k > 0) {
    const before = parts.slice(Math.max(0, k - 2), k).join(' ');
    found = named(before);
    alt = found.length >= 2;
  }
  return found.length >= 2 && !alt ? [] : found.length > 4 ? [] : found;
};
/**
 * journey retest R20-3 (18/11): the customer said yes to the one in-stock product the AI offered instead of the out-of-stock one they took (N5b T2
 * « Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA ? » ⇒ « oui »): that product is the order's now.
 */
export const takesSubstituteNote = (name: string): string =>
  `THE CUSTOMER ACCEPTS « ${name} »: their « yes » answers your last question, which offered it instead of the out-of-stock product — it is the product of the order now. Call create_order with it and the fields the customer already gave (the platform shows the recap), or ask the one field still missing. Never ask again which product, never repeat that the other one is out of stock.`;
/** journey retest R7-2: the product ids of a search_products / get_product result. */
const productIdsOf = (result: unknown): string[] => {
  const r = result as { products?: { id?: unknown }[]; id?: unknown } | null;
  if (Array.isArray(r?.products)) return r.products.map((p) => p?.id).filter((id): id is string => typeof id === 'string');
  return typeof r?.id === 'string' ? [r.id] : [];
};
/** journey retest R8-1: tool answers that are a real failure of the platform (the only ones that may be told as a problem). */
const SYSTEM_FAILURES = new Set(['ORDERS_UNAVAILABLE', 'PAYMENT_LINK_UNAVAILABLE', 'UNKNOWN_TOOL']);
/** journey retest R8-1 / R8-2: create_order answers after which no recap is shown and nothing is ordered (a field to ask, a product to change). */
const REFUSED_ORDER = new Set(['VALIDATION', 'VARIANT_REQUIRED', 'PRODUCT_NOT_AVAILABLE', 'ORDER_INSUFFICIENT_STOCK', 'CONFIRMATION_REFUSED', 'WILAYA_NOT_SERVED', 'ORDER_NOT_REPLACEABLE']);
/**
 * journey retest R8-1 / R8-2: the last create_order of the turn was refused (no recap, no order) — with the first field it asked
 * for; null when it returned a recap, placed the order, or was not called.
 */
export const refusedOrder = (executed: Pick<ExecutedTool, 'name' | 'result'>[]): { field: string | null; code: string; argsOnly: boolean } | null => {
  const last = [...executed].reverse().find((t) => canonicalTool(t.name) === 'create_order');
  const r = last?.result as { ok?: unknown; error?: { code?: unknown; field?: unknown; missing?: unknown; malformed?: unknown } } | null | undefined;
  if (!r || r.ok === true || !REFUSED_ORDER.has(String(r.error?.code ?? ''))) return null;
  // journey retest R11-1: a malformed value (`items` sent as a string / code) asks the customer nothing — no field to ask
  const malformed = r.error?.malformed === true;
  return { field: r.error?.code === 'VALIDATION' && typeof r.error.field === 'string' && !malformed ? r.error.field : null, code: String(r.error?.code), argsOnly: r.error?.code === 'VALIDATION' && r.error.missing !== true };
};
/** journey retest R19-1: the handoff reasons a customer's message carries itself (a recap of the turn does not end the turn without the model). */
const TEAM_REASONS = new Set(['customer_request', 'refund', 'complaint', 'angry', 'keyword']);
/** journey retest R13-1: the handoff reasons of the model's own judgement that a reply selling a product cancels (never a customer's request). */
const SELLING_KEEPS_AI = new Set(['off_catalogue', 'unclear_streak']);
/** journey retest R10-2: refusals of the product itself (nothing of it can be ordered) — « noté » after one is a false claim. */
const PRODUCT_REFUSALS = new Set(['ORDER_INSUFFICIENT_STOCK', 'PRODUCT_NOT_AVAILABLE']);
/**
 * journey retest R10-2 (17/11): told to the model when its answer asks the customer to confirm while no server recap is waiting
 * (N5 T3 « Pour confirmer : vous voulez bien le Coffret cadeau Aïd à 24990 DA à la place du Parfum Oud … ? » after a stock
 * refusal) — the tools are still offered: the customer confirms the server's recap, which create_order returns.
 */
/**
 * journey retest R12-2 (17/11): told to the model when the customer said yes to the recap that waits and its answer says the order is
 * registered without calling create_order — the server creates it (from the stored recap) and writes the confirmation.
 */
export const YES_WITHOUT_ORDER_NOTE =
  'THE ORDER IS NOT CREATED YET: the customer said yes to the recap shown earlier, but create_order was not called — call create_order now with the details of that recap and customerConfirmed true; the server creates the order and sends the confirmation. Never say the order is registered, placed or noted yourself.';
export const CONFIRM_WITHOUT_RECAP_NOTE =
  'NO RECAP YET: your reply asks the customer to confirm, or says the order is registered / noted, but no recap was shown and no order was created — the customer only ever confirms the recap create_order returns. If the customer has accepted a product and every order field is known (name, phone, wilaya, address or stop-desk), call create_order now: the server shows the recap. Otherwise ask the one missing field (when the customer already wants the product: the next field, their name first — never offer to book, reserve or register it for them), or ask whether they want the product (« Voulez-vous le … ? »). Never ask « pour confirmer … ? », « tu confirmes ? » or for a « oui » yourself.';
/** Words of a message about an order of the customer (a status, a tracking number): lookup_order stays offered on it. */
const ORDER_WORD = /command|order|colis|livraison|tracking|suivi|طلبي|الطلب|كوموند|komand|كولي|coli|wsel|wslat|wselt|وصلت|وين/u;
/** journey retest R12-3: words of a question about an order already made (its status, its parcel) — a yes with them may look it up. */
const ORDER_WORD_ASK = /tracking|suivi|colis|statut|status|كولي|coli|wsel|wslat|wselt|وصلت|وين|(?<![\p{L}])(?:CMD|TEST)-?\d/iu;
/**
 * journey retest R10-3 (17/11): a message that only gives a name or a place (no digit, no yes, no word about an order) needs no
 * lookup_order (N4 T2 « سمير بن علي » ⇒ `lookup_order {}`, 0 order) — a phone stays able to look an order up.
 */
export const noLookupFor = (customerText: string | undefined, fieldOnly: boolean): boolean => {
  const t = (customerText ?? '').trim();
  return fieldOnly && !!t && !/\d/.test(t) && confirmation(t) !== 'yes' && !ORDER_WORD.test(foldGuard(t));
};
/**
 * journey retest R18-1 (18/11): a message whose place the server quotes when no turn quoted it yet (`placeQuote`) — any message but one
 * about an order already made (its status, a cancellation, a complaint): PF1 / PG1 / PG2 T1 « Bonjour, j'habite à Sétif, El Eulma »,
 * « slm, ana f Oran, Bir El Djir », « السلام عليكم، أنا من البليدة بوفاريك » got no fee 3 times in 4 (the R15-1 quote needed a product named or
 * an address question).
 */
export const placeQuoteMessage = (text: string | undefined): boolean => !!text?.trim() && /\p{L}/u.test(text) && !orderStatusAsk(text) && !complaintIn(text) && !asksCancel(text);
/**
 * journey retest R18-3 (18/11): a lookup_order by a phone the customer gave in this conversation, while the conversation placed an order —
 * N11 T3 `lookup_order {phone 0661234567}` → no order (the playground's orders are simulated), then `{orderNumber TEST-4074}`: the call
 * looks up the conversation's latest order by its number instead (one lookup). The call itself when it names an order / tracking number,
 * a phone the customer did not write, or no order was placed.
 */
export const lookupByNumber = (call: AiToolCallRequest, orderHistory: ToolRunContext['orderHistory'], customerHistory: string | undefined): AiToolCallRequest => {
  if (canonicalTool(call.name) !== 'lookup_order' || !customerHistory) return call;
  const a = call.args ?? {};
  const text = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  const phone = text('phone');
  if (!phone || text('orderNumber') || text('trackingNumber')) return call;
  const asked = [...phonesIn(phone)];
  const own = phonesIn(customerHistory);
  const placed = placedNumbers(orderHistory);
  if (asked.length !== 1 || !own.has(asked[0]!) || !placed.length) return call;
  return { ...call, args: { orderNumber: placed[placed.length - 1]! } };
};
/**
 * journey retest R19-1 (18/11): a lookup_order by an order number that a lookup_order of this turn already returned — N11 T3 `lookup_order {}`
 * (→ TEST-4074, new, not sent, no tracking number) then `{orderNumber TEST-4074}`, the same row: answered from the first one, not run (one
 * lookup). Null for any other call (a phone, a tracking number, a number no lookup of this turn returned).
 */
export const orderLookupAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, executed: Pick<ExecutedTool, 'name' | 'result'>[]): Record<string, unknown> | null => {
  if (canonicalTool(call.name) !== 'lookup_order') return null;
  const a = call.args ?? {};
  const number = typeof a.orderNumber === 'string' ? a.orderNumber.trim().toLowerCase() : '';
  if (!number || (typeof a.phone === 'string' && a.phone.trim()) || (typeof a.trackingNumber === 'string' && a.trackingNumber.trim())) return null;
  for (const t of [...executed].reverse()) {
    if (canonicalTool(t.name) !== 'lookup_order') continue;
    const orders = (t.result as { orders?: { number?: unknown }[] } | null)?.orders;
    const hit = Array.isArray(orders) ? orders.find((o) => typeof o?.number === 'string' && o.number.toLowerCase() === number) : undefined;
    if (hit) return { orders: [hit], repeated: true, instruction: 'This order was already looked up in this turn (above): its status is this one — answer the customer now.' };
  }
  return null;
};
/** journey retest R18-1: the wilaya a quote_delivery answer gives as not served at all (home nor stop-desk), else null. */
export const notServedOf = (result: unknown): { id: number; name: string } | null => {
  const e = (result as { error?: { code?: unknown; wilayaId?: unknown; wilayaName?: unknown; homeAvailable?: unknown } } | null)?.error;
  return e?.code === 'WILAYA_NOT_SERVED' && e.homeAvailable !== true && typeof e.wilayaId === 'number' && typeof e.wilayaName === 'string' ? { id: e.wilayaId, name: e.wilayaName } : null;
};
/**
 * journey retest R15-1 / R18-2: the price of a catalogue product for the reply — the variant the customer's text names (else the answer's
 * `cart`, when it holds that one product), or the one price of all its variants; null when its variants' prices differ and none is named.
 */
export const productPrice = (p: CataloguePrice, said: string, output: Pick<AiReplyOutput, 'cart'>): PlaceProduct | null => {
  const items = output.cart?.items ?? [];
  const fromCart = items.length === 1 && items[0]!.productId === p.id && items[0]!.variantId ? p.variants.find((v) => v.id === items[0]!.variantId) : undefined;
  const v = (p.variants.length ? namedVariant(p.variants.filter((x) => x.id), said) : null) ?? fromCart;
  if (v) return { name: p.name, variant: v.name, price: v.price };
  if (!p.variants.length) return { name: p.name, price: p.price };
  const one = [...new Set(p.variants.map((x) => x.price))];
  return one.length === 1 ? { name: p.name, price: one[0]! } : null;
};
/** journey retest R18-2: the text names this product by its whole name (every word of it, in order: « 2 tapis de prière molletonnés »). */
export const namedWhole = (text: string, name: string): boolean => {
  const n = productWords(name);
  if (!n.length) return false;
  return ` ${productWords(text).join(' ')} `.includes(` ${n.join(' ')} `);
};
/** Words of no weight in a product search (folded). */
const SEARCH_FILLERS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'en', 'et', 'au', 'aux', 'pour', 'avec', 'the', 'of', 'and', 'for', 'with', 'ta3', 'el', 'al', 'dyal']);
/**
 * journey retest R10-3 (17/11): a `search_products` whose words all name a product this turn already returned (by search_products
 * or get_product) — F1 T1 « Sac à main cuir marron » then « Sac à main cuir », N12 T1 get_product then « hijab soie ». The earlier
 * results are given back (`repeated: true`), nothing runs; null when the query asks for something else.
 */
export const searchAnswered = (query: unknown, executed: (Pick<ExecutedTool, 'name' | 'result'> & { args?: Record<string, unknown> })[], catalogueNames?: readonly string[]): Record<string, unknown> | null => {
  if (typeof query !== 'string') return null;
  const wordsOf = (q: string) => foldGuard(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !SEARCH_FILLERS.has(w));
  const words = wordsOf(query);
  if (!words.length) return null;
  type Found = { id?: unknown; name?: unknown; variants?: { name?: unknown }[] };
  const nameWords = (p: Found) => new Set(foldGuard([p.name, ...(Array.isArray(p.variants) ? p.variants.map((v) => v?.name) : [])].filter((x) => typeof x === 'string').join(' ')).split(/[^\p{L}\p{N}]+/u));
  const found: Found[] = [];
  // journey retest R12-3 (17/11): an earlier search of this turn whose words are all in this query and that found the product its
  // words name — « tapis de prière » found « Tapis de prière », then « tapis de prière molletonné » (a word of the description) is
  // the same product (N4 T1: two searches) — only when the added words name no product of the CATALOGUE (« robe » then « robe
  // kabyle » still searches)
  const named = new Set((catalogueNames ?? []).flatMap((n) => n.split(/[^\p{L}\p{N}]+/u)));
  const refined: Found[] = [];
  for (const t of executed) {
    const name = canonicalTool(t.name);
    const r = t.result as { products?: Found[] } & Found;
    if (name === 'search_products' && Array.isArray(r?.products)) {
      found.push(...r.products);
      const before = typeof t.args?.query === 'string' ? wordsOf(t.args.query) : [];
      if (catalogueNames?.length && before.length && before.every((w) => words.includes(w)) && words.every((w) => before.includes(w) || !named.has(w))) refined.push(...r.products.filter((p) => before.every((w) => nameWords(p).has(w))));
    } else if (name === 'get_product' && typeof r?.id === 'string' && typeof r.name === 'string') found.push(r);
  }
  const unique = (xs: Found[]) => xs.filter((p, i) => typeof p?.id === 'string' && xs.findIndex((q) => q?.id === p.id) === i);
  const hits = unique(found).filter((p) => words.every((w) => nameWords(p).has(w)));
  const same = hits.length ? hits : unique(refined);
  return same.length ? { products: same, repeated: true, instruction: 'These products were already found in this turn (above): no new search is needed — answer the customer now.' } : null;
};
/**
 * journey retest R11-3 (17/11): on a message that only gives an order field (a name, a phone, a place, a yes), a `search_products`
 * whose words all name one product the prompt's CATALOGUE lists (with its ids) is not run — N21 T2 / T3 `search_products {«Hijab
 * soie»}` on « نادية قاسي » and « 0661234568 », F1b2 T2 on « Sétif, El Eulma ». Null when the query asks for something else.
 */
/** journey retest R22-4 (18/11): the unit prices of the items of the recaps and orders an earlier turn of the conversation showed. */
const shownUnitPrices = (history: TurnRequest['toolCtx']['orderHistory']): number[] =>
  (history ?? []).flatMap((h) => {
    const r = h.result as { recap?: { items?: { unitPrice?: unknown }[] }; items?: { unitPrice?: unknown }[] } | null;
    return [...(r?.recap?.items ?? []), ...(r?.items ?? [])].map((i) => Number(i?.unitPrice)).filter((n) => Number.isInteger(n) && n > 0);
  });
/** journey retest R22-4 (18/11): a message about cancelling an order (« je veux annuler ? », « cancel it », « nbatlou », « ألغيلي الطلبية »), folded. */
const CANCEL_MESSAGE = /(?<![\p{L}])(?:annul\p{L}*|cancel\p{L}*|nbatl\p{L}*|nbatel\p{L}*|batlou\p{L}*|batliha|batlha|الغي|الغيلي|الغيها|الغيو|الغيوها|نلغي|نلغيو|نلغيها|تلغي|تلغات|لغيها|لغيتها|الغاء|بالغاء|بطلوها|بطليها|نبطلو)(?![\p{L}])/u;
/**
 * journey retest R22-3 (18/11): the catalogue products a search / get_product answered without running names — the ids of its answer,
 * else (a search the CATALOGUE answers: `inCatalogue`, no product list) the one catalogue product whose name holds every word of the query.
 */
export const knownProductIds = (call: Pick<AiToolCallRequest, 'args'>, known: unknown, prices: readonly CataloguePrice[]): string[] => {
  const ids = productIdsOf(known);
  if (ids.length) return ids;
  const query = call.args?.query;
  if ((known as { inCatalogue?: unknown } | null)?.inCatalogue !== true || typeof query !== 'string') return [];
  const words = foldGuard(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !SEARCH_FILLERS.has(w));
  if (!words.length) return [];
  const hits = prices.filter((p) => {
    const names = new Set(foldGuard([p.name, ...p.variants.map((v) => v.name)].join(' ')).split(/[^\p{L}\p{N}]+/u));
    return words.every((w) => names.has(w));
  });
  return hits.length === 1 ? [hits[0]!.id] : [];
};
export const catalogueAnswered = (query: unknown, catalogueNames: readonly string[] | undefined): Record<string, unknown> | null => {
  if (typeof query !== 'string' || !catalogueNames?.length) return null;
  const words = foldGuard(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !SEARCH_FILLERS.has(w));
  if (!words.length) return null;
  const hits = catalogueNames.filter((n) => {
    const names = new Set(n.split(/[^\p{L}\p{N}]+/u));
    return words.every((w) => names.has(w));
  });
  return hits.length === 1 ? { products: [], inCatalogue: true, instruction: `« ${query} » is listed in the CATALOGUE above with its [ID] (and [VID] of each variant): no search is needed on a message that only gives an order field — answer the customer now (ask the next missing field, or call create_order with those ids when every field is known).` } : null;
};
/**
 * journey retest R13-4 (18/11): a `search_products` / `get_product` / `check_availability` for a product the recap (or the order)
 * create_order returned earlier in this turn already holds — F6 T1, N4 T3, N12 T5, N14 T1, A3 T2 searched « Tapis de prière » right
 * after the recap call. It is not run: the recap is what the customer gets. Null when the call asks about anything else.
 */
export const recapAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, executed: Pick<ExecutedTool, 'name' | 'args' | 'result'>[]): Record<string, unknown> | null => {
  const tool = canonicalTool(call.name);
  if (tool !== 'search_products' && tool !== 'get_product' && tool !== 'check_availability') return null;
  type Line = { productId?: unknown; name?: unknown; variant?: unknown };
  const last = [...executed].reverse().find((t) => {
    const r = t.result as { ok?: unknown; error?: { code?: unknown } } | null;
    return canonicalTool(t.name) === 'create_order' && (r?.ok === true || r?.error?.code === 'CONFIRMATION_REQUIRED');
  });
  if (!last) return null;
  const r = last.result as { recap?: { items?: Line[] }; items?: Line[]; draftOrder?: { items?: Line[] } } | null;
  const lines = [...(r?.recap?.items ?? []), ...(r?.items ?? [])];
  const ids = new Set([...(r?.draftOrder?.items ?? []), ...(Array.isArray(last.args?.items) ? (last.args.items as Line[]) : [])].map((i) => i?.productId).filter((x): x is string => typeof x === 'string'));
  let hit = false;
  if (tool === 'search_products') {
    const words = typeof call.args?.query === 'string' ? productWords(call.args.query) : [];
    const named = new Set(lines.flatMap((l) => productWords([l?.name, l?.variant].filter((x) => typeof x === 'string').join(' '))));
    hit = words.length > 0 && words.every((w) => named.has(w));
  } else hit = typeof call.args?.productId === 'string' && ids.has(call.args.productId);
  return hit ? { ...(tool === 'search_products' ? { products: [] } : { ok: true }), inRecap: true, instruction: 'This product is already in the recap (or the order) create_order returned above in this turn: nothing more to look up — answer the customer now, with no recap of your own.' } : null;
};
/**
 * journey retest R14-3 (18/11): a `get_product` / `check_availability` that this turn's search already answers — N9 T1 search then
 * get_product of the same robe (15.7 s), N5 T1 search « parfum » then get_product of the Parfum Oud, F1d T1 search then
 * check_availability of the Marron (quantity 1, « in stock » in the search), N25 T2 check_availability next to the create_order that
 * checks the stock itself. Answered without running:
 *   - get_product of a product a get_product of this turn returned, or one a search returned that the prompt's CATALOGUE lists
 *     (`listed`: its description is there);
 *   - check_availability of 1 unit of a product / variant a search or get_product of this turn gave as « in stock » / « out of stock »;
 *   - check_availability of a product a create_order of the same step orders (create_order checks the stock).
 * Null when the call asks anything else (another product, a quantity above 1 with no create_order, a product not listed).
 */
export const lookupAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, executed: Pick<ExecutedTool, 'name' | 'result'>[], listed: readonly string[] = [], stepCalls: readonly Pick<AiToolCallRequest, 'name' | 'args'>[] = [], fromCatalogue = false): Record<string, unknown> | null => {
  const tool = canonicalTool(call.name);
  const id = call.args?.productId;
  if ((tool !== 'get_product' && tool !== 'check_availability') || typeof id !== 'string') return null;
  type Found = { id?: unknown; stock?: unknown; variants?: { id?: unknown; stock?: unknown }[] };
  const found: { p: Found; get: boolean }[] = [];
  for (const t of executed) {
    const r = t.result as ({ products?: Found[] } & Found) | null;
    if (canonicalTool(t.name) === 'search_products' && Array.isArray(r?.products)) found.push(...r.products.map((p) => ({ p, get: false })));
    else if (canonicalTool(t.name) === 'get_product' && typeof r?.id === 'string') found.push({ p: r, get: true });
  }
  const hit = found.find((f) => f.get && f.p.id === id) ?? found.find((f) => f.p.id === id);
  if (tool === 'get_product') {
    // journey retest R15-3 (18/11): nor, with no lookup of it this turn, a product the prompt's CATALOGUE lists (its description, price,
    // variants and stock are there) — N4 T1 « Bonjour, je veux le tapis de prière » ⇒ `get_product` (`fromCatalogue`: no photo asked)
    if (!hit && fromCatalogue && listed.includes(id)) return { id, inCatalogue: true, repeated: true, instruction: 'This product is listed in the CATALOGUE above with its description, price, variants and stock: nothing to look up — answer the customer now.' };
    if (!hit || (!hit.get && !listed.includes(id))) return null;
    return { ...hit.p, repeated: true, instruction: hit.get ? 'get_product already answered for this product in this turn (above): answer the customer now.' : 'search_products already returned this product in this turn (above), and its description is in the CATALOGUE: nothing more to look up — answer the customer now.' };
  }
  const ordered = stepCalls.some((c) => {
    const items = c.args?.items;
    return canonicalTool(c.name) === 'create_order' && Array.isArray(items) && items.some((i) => (i as { productId?: unknown } | null)?.productId === id);
  });
  if (ordered) return { ok: true, productId: id, inOrder: true, instruction: 'create_order (called with this product in this step) checks the stock itself: no availability check is needed — follow its answer.' };
  const qty = call.args?.quantity === undefined ? 1 : Number(call.args.quantity);
  if (!hit || !(qty <= 1)) return null;
  const vid = call.args?.variantId;
  const variants = Array.isArray(hit.p.variants) ? hit.p.variants : [];
  const stock = typeof vid === 'string' ? variants.find((v) => v?.id === vid)?.stock : variants.length ? undefined : hit.p.stock;
  if (stock !== 'in stock' && stock !== 'out of stock') return null;
  return { ok: true, productId: id, ...(typeof vid === 'string' ? { variantId: vid } : {}), quantity: 1, available: stock === 'in stock', fromSearch: true, instruction: 'The stock of this product was already given by the search in this turn (above): answer the customer now.' };
};
/**
 * journey retest R15-3 (18/11): a second quote_delivery for a wilaya this turn already quoted — F1b T2 `quote_delivery {Sétif}` ⇒ `fee 650,
 * stopdeskFee 350`, then `quote_delivery {Sétif, isStopdesk true}` ⇒ the same 350; N16 T1 `{Illizi}` ⇒ WILAYA_NOT_SERVED, then `{Illizi,
 * stop-desk}` ⇒ the same refusal. Answered from the first result without running: a stop-desk quote from a home quote's `stopdeskFee`
 * (or its `stopdeskAvailable false`), any quote of a wilaya not served at all. Null when the call asks anything else (another wilaya, a
 * home quote after a stop-desk one, a home quote with another subtotal).
 */
export const quoteAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, executed: Pick<ExecutedTool, 'name' | 'result'>[]): Record<string, unknown> | null => {
  if (canonicalTool(call.name) !== 'quote_delivery') return null;
  const id = call.args?.wilayaId === undefined || call.args.wilayaId === null || call.args.wilayaId === '' ? null : Number(call.args.wilayaId);
  const name = typeof call.args?.wilayaName === 'string' && call.args.wilayaName.trim() ? foldText(call.args.wilayaName) : null;
  if (id === null && !name) return null;
  const stopdesk = call.args?.isStopdesk === true || call.args?.isStopdesk === 'true';
  for (const t of executed) {
    if (canonicalTool(t.name) !== 'quote_delivery') continue;
    const r = t.result as { ok?: unknown; wilayaId?: unknown; wilayaName?: unknown; wilayaNameAr?: unknown; isStopdesk?: unknown; stopdeskAvailable?: unknown; stopdeskFee?: unknown; error?: { code?: unknown; wilayaId?: unknown; wilayaName?: unknown; homeAvailable?: unknown } } | null;
    const wid = r?.ok === true ? r.wilayaId : r?.error?.wilayaId;
    const names = [r?.ok === true ? r.wilayaName : r?.error?.wilayaName, r?.wilayaNameAr].filter((x): x is string => typeof x === 'string').map(foldText);
    if (!((id !== null && Number.isFinite(id) && wid === id) || (name && names.includes(name)))) continue;
    if (r?.error?.code === 'WILAYA_NOT_SERVED' && r.error.homeAvailable !== true) return { ...r, repeated: true, instruction: 'quote_delivery already answered for this wilaya in this turn (above): it is not served, neither home delivery nor stop-desk — answer the customer now.' };
    if (r?.ok === true && r.isStopdesk === false && stopdesk) {
      if (r.stopdeskAvailable === true && typeof r.stopdeskFee === 'number') return { ...r, isStopdesk: true, fee: r.stopdeskFee, free: false, repeated: true, instruction: 'The quote above already gives the stop-desk fee (stopdeskFee): no new quote is needed — answer the customer now.' };
      return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: r.wilayaId, wilayaName: r.wilayaName, stopdeskAvailable: false, homeAvailable: true }, repeated: true, instruction: 'The quote above already says the stop-desk is not available for this wilaya (home delivery only) — answer the customer now.' };
    }
  }
  return null;
};
/** The wilaya id (served or not) of a quote_delivery answer; null when it is no quote. */
const quoteWilaya = (result: unknown): number | null => {
  const r = result as { ok?: unknown; wilayaId?: unknown; error?: { code?: unknown; wilayaId?: unknown } } | null;
  const id = r?.ok === true ? r.wilayaId : r?.error?.code === 'WILAYA_NOT_SERVED' ? r.error.wilayaId : null;
  return typeof id === 'number' ? id : null;
};
/**
 * journey retest R16-3 (18/11): a quote_delivery for a wilaya an EARLIER turn of the conversation already quoted, while the shop's delivery
 * settings have not changed since (`known`: those answers, latest first, already checked by `validEarlierQuotes`) — PF1 T2 `quote_delivery
 * {wilayaId 19}` one message after T1's `quote_delivery {Sétif}` (same 650 / 350). Answered from it without running: a home quote from an
 * earlier home quote (the free threshold applied to this call's subtotal), a stop-desk quote from a quote's stop-desk fee, any quote of a
 * wilaya not served. Null when the call asks anything else (another wilaya, a home fee only a free quote knew).
 */
export const earlierQuoteAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, known: readonly unknown[]): Record<string, unknown> | null => {
  if (canonicalTool(call.name) !== 'quote_delivery' || !known.length) return null;
  const id = call.args?.wilayaId === undefined || call.args.wilayaId === null || call.args.wilayaId === '' ? null : Number(call.args.wilayaId);
  const name = typeof call.args?.wilayaName === 'string' && call.args.wilayaName.trim() ? foldText(call.args.wilayaName) : null;
  if (id === null && !name) return null;
  const stopdesk = call.args?.isStopdesk === true || call.args?.isStopdesk === 'true';
  const subtotal = call.args?.subtotal === undefined || call.args.subtotal === null ? undefined : Number(call.args.subtotal);
  const note = { repeated: true, fromEarlierTurn: true, instruction: "quote_delivery already answered for this wilaya earlier in this conversation and the shop's delivery settings have not changed: this is its answer — use it." };
  for (const v of known) {
    const r = v as { ok?: unknown; wilayaId?: unknown; wilayaName?: unknown; wilayaNameAr?: unknown; isStopdesk?: unknown; fee?: unknown; free?: unknown; freeFrom?: unknown; stopdeskAvailable?: unknown; stopdeskFee?: unknown; error?: { code?: unknown; wilayaName?: unknown; homeAvailable?: unknown } } | null;
    const wid = quoteWilaya(r);
    const names = [r?.ok === true ? r.wilayaName : r?.error?.wilayaName, r?.wilayaNameAr].filter((x): x is string => typeof x === 'string').map(foldText);
    if (wid === null || !((id !== null && Number.isFinite(id) && wid === id) || (name && names.includes(name)))) continue;
    if (r?.ok !== true) {
      if (r?.error?.homeAvailable !== true || stopdesk) return { ...(r as object), ...note };
      continue;
    }
    if (stopdesk) {
      if (r.isStopdesk === true && typeof r.fee === 'number') return { ...(r as object), ...note };
      if (r.stopdeskAvailable === true && typeof r.stopdeskFee === 'number') return { ...(r as object), isStopdesk: true, fee: r.stopdeskFee, free: false, ...note };
      if (r.stopdeskAvailable === false) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: wid, wilayaName: r.wilayaName, stopdeskAvailable: false, homeAvailable: true }, ...note };
      continue;
    }
    if (r.isStopdesk === true || r.free === true || typeof r.fee !== 'number') continue;
    const freeFrom = typeof r.freeFrom === 'number' ? r.freeFrom : null;
    const free = freeFrom !== null && subtotal !== undefined && Number.isFinite(subtotal) && subtotal >= freeFrom;
    return { ...(r as object), isStopdesk: false, fee: free ? 0 : r.fee, free, ...note };
  }
  return null;
};
/** journey retest R16-3: the quotes of earlier turns that stay valid, given the shop's delivery rules now (its rows for those wilayas). */
export const validEarlierQuotes = (
  earlier: readonly { result: unknown; at: string | null }[],
  rules: readonly { wilayaId: number; updatedAt: Date; freeAbove: number | null; isActive: boolean }[],
  shopFreeThreshold: number | null,
): unknown[] =>
  earlier
    .filter((e) => {
      const at = e.at ? Date.parse(e.at) : NaN;
      const id = quoteWilaya(e.result);
      if (!Number.isFinite(at) || id === null) return false;
      const rule = rules.find((x) => x.wilayaId === id);
      const r = e.result as { ok?: unknown; freeFrom?: unknown; error?: { homeAvailable?: unknown } } | null;
      // a rule changed after the quote (fee, stop-desk, threshold, served or not) ⇒ the quote is not reused
      if (rule && rule.updatedAt.getTime() > at) return false;
      if (r?.ok === true) return !!rule && rule.isActive && (typeof r.freeFrom === 'number' ? r.freeFrom : null) === (rule.freeAbove ?? shopFreeThreshold ?? null);
      // not served at all: still no active rule; home only: the rule is still there
      return r?.error?.homeAvailable === true ? !!rule && rule.isActive : !rule || !rule.isActive;
    })
    .map((e) => e.result);
/** journey retest R16-3: the system note listing the delivery quotes of earlier turns that stay valid (no new quote_delivery for them). */
export const knownQuotesNote = (known: readonly unknown[]): string | null => {
  const seen = new Set<number>();
  const lines: string[] = [];
  for (const v of known) {
    const id = quoteWilaya(v);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const r = v as { ok?: unknown; wilayaName?: unknown; isStopdesk?: unknown; fee?: unknown; free?: unknown; stopdeskAvailable?: unknown; stopdeskFee?: unknown; error?: { wilayaName?: unknown; homeAvailable?: unknown } };
    const name = String((r.ok === true ? r.wilayaName : r.error?.wilayaName) ?? id);
    if (r.ok !== true) lines.push(`${name}: ${r.error?.homeAvailable === true ? 'home delivery only (no stop-desk)' : 'not served'}`);
    else if (r.isStopdesk === true) lines.push(`${name}: stop-desk ${r.fee} DA`);
    else if (r.free !== true) lines.push(`${name}: home ${r.fee} DA${r.stopdeskAvailable === true && typeof r.stopdeskFee === 'number' ? `, stop-desk ${r.stopdeskFee} DA` : ', no stop-desk'}`);
    if (lines.length >= 4) break;
  }
  return lines.length ? `DELIVERY ALREADY QUOTED in this conversation (the shop's delivery settings have not changed — no new quote_delivery is needed for these wilayas): ${lines.join('; ')}.` : null;
};
/**
 * journey retest R16-3 (18/11): a search_products that an EARLIER turn of the conversation already made (same query, whatever its
 * limit / case / accents) and whose products the prompt's CATALOGUE lists — N5 T2 `search_products {parfum}` again after T1's. Not run:
 * the CATALOGUE gives their current price, variants and stock. Null when the earlier search found nothing or a product is no longer
 * listed (it runs).
 */
export const earlierSearchAnswered = (call: Pick<AiToolCallRequest, 'name' | 'args'>, earlier: readonly { args: Record<string, unknown>; products: { id: string; name: string }[] }[] | undefined, listed: readonly string[] | undefined): Record<string, unknown> | null => {
  if (canonicalTool(call.name) !== 'search_products' || !earlier?.length || !listed?.length) return null;
  const key = sameCallKey(call.name, call.args);
  const hit = earlier.find((e) => sameCallKey('search_products', e.args) === key);
  if (!hit?.products.length || !hit.products.every((p) => listed.includes(p.id))) return null;
  return { products: hit.products, repeated: true, fromEarlierTurn: true, instruction: 'The same search was made earlier in this conversation: these products are listed in the CATALOGUE above with their current price, variants and stock — answer from it, no new search.' };
};
/**
 * journey retest R16-3 (18/11): a search_products on a message that only asks about delivery, for words no customer message of the
 * conversation holds — F9 « ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ? » ⇒ `search_products {«Retouche couture»}` (a service
 * nobody asked about, which fed the « T7ebb nwarrik produit … ? » closing). Not run. Null when the message wants or names a product.
 */
export const strayDeliverySearch = (call: Pick<AiToolCallRequest, 'name' | 'args'>, customerText: string | undefined, customerHistory: string | undefined, catalogue?: readonly CataloguePrice[]): Record<string, unknown> | null => {
  const query = call.args?.query;
  if (canonicalTool(call.name) !== 'search_products' || typeof query !== 'string' || !customerText || !asksDelivery(customerText) || productWanted(customerText)) return null;
  if (catalogue?.length && productNamedIn(customerText, catalogue)) return null;
  const words = productWords(query);
  const said = new Set(productWords(customerHistory ?? customerText));
  if (!words.length || words.some((w) => said.has(w))) return null;
  return { products: [], notAsked: true, instruction: 'The customer asked only about delivery: no product search is needed — answer their delivery question (with quote_delivery), nothing else.' };
};
/**
 * journey retest R16-3 (18/11): a check_availability the prompt's CATALOGUE already answers — the free stock of the product (or of the
 * variant named) covers the quantity, the product is not tracked, or it is sold beyond its stock (N1 T2 `check_availability {qty 1}` of the
 * Marron bag before the recap call: create_order checks the stock itself). Not run. Null when the stock is short (the tool says how) or
 * the product / variant is not listed.
 */
export const catalogueAvailability = (call: Pick<AiToolCallRequest, 'name' | 'args'>, stock: readonly CatalogueStock[] | undefined): Record<string, unknown> | null => {
  if (canonicalTool(call.name) !== 'check_availability' || !stock?.length) return null;
  const id = call.args?.productId;
  const p = typeof id === 'string' ? stock.find((x) => x.id === id) : undefined;
  if (!p) return null;
  const qty = call.args?.quantity === undefined || call.args.quantity === null ? 1 : Number(call.args.quantity);
  if (!Number.isInteger(qty) || qty < 1) return null;
  const vid = typeof call.args?.variantId === 'string' && call.args.variantId ? call.args.variantId : null;
  const v = vid ? p.variants.find((x) => x.id === vid) : undefined;
  if (vid ? !v : p.variants.length > 0) return null;
  const free = p.stock === null ? null : v ? v.stock : p.stock;
  if (free !== null && !p.sell && qty > free) return null;
  return { ok: true, productId: id, ...(vid ? { variantId: vid } : {}), quantity: qty, available: true, fromCatalogue: true, instruction: 'In stock, as the CATALOGUE above says: no availability check is needed — answer the customer now (create_order checks the stock again when it is called).' };
};
/**
 * journey retest R16-3 (18/11): a quote_delivery made while every order field is known (`recapReady`: the message gives the order's
 * details, or changes a recap that waits) and the customer asks nothing about delivery — N14 T1 `quote_delivery {Blida}` before the recap
 * call, N1 T2 `quote_delivery {Oran}`: create_order computes the fee (home or stop-desk, free threshold) and the recap shows it. Not run.
 */
export const RECAP_COMPUTES_RESULT = { ok: true, deferred: true, instruction: 'Every order field is known: call create_order now — it computes the delivery fee (home or stop-desk, free threshold) and checks the stock itself, and the recap shows them. No quote is needed.' };
/** journey retest R16-3: told to the model when every order field is known (create_order computes the fee and checks the stock). */
export const RECAP_READY_NOTE =
  'EVERY ORDER FIELD SEEMS GIVEN: create_order computes the delivery fee and checks the stock itself — call it directly for the recap, with no quote_delivery or check_availability before it (unless the customer asks about delivery).';
/** journey retest R1-1: the result given back for a call to a tool this step did not offer (it is not run). */
export const unavailableTool = (name: string, fieldOnly: boolean, noPhone = false, noPlace = false, noStreet = false, noAddress = false, gone: string | null = null) => ({
  ok: false,
  error: { code: 'TOOL_NOT_AVAILABLE', tool: name },
  instruction: `${name} cannot be used now${INFO_TOOLS.has(canonicalTool(name)) ? ': everything about these products (description, price, variants, stock) is in the CATALOGUE and in the results above — answer the customer now, with no tool' : fieldOnly && canonicalTool(name) === 'handoff_to_human' ? ': the customer only gave an order field (or a yes) — record it, keep the conversation and ask the next missing field (or show the recap)' : canonicalTool(name) === 'create_order' && gone ? `: « ${gone} » is out of stock — say so and ask whether they want the in-stock product instead (never a recap)` : canonicalTool(name) === 'create_order' && noPhone ? ': the customer has not given a phone number yet — ask for the next missing field (never a recap)' : canonicalTool(name) === 'create_order' && noPlace ? ': the customer has not named their wilaya yet — ask for it (never a default wilaya, never a recap)' : canonicalTool(name) === 'create_order' && noStreet ? ': the customer named only the wilaya / commune — ask for the street address (rue, cité, building, landmark) or offer the stop-desk (never a recap)' : canonicalTool(name) === 'create_order' && noAddress ? ': the customer has not given the street address (rue, cité, building, landmark) nor chosen the stop-desk yet — ask for it in one short question (never a recap)' : canonicalTool(name) === 'create_order' ? ': it already answered in this turn — follow that answer (ask the missing field, or let the recap / confirmation go)' : canonicalTool(name) === 'cancel_order' ? ': the customer did not ask to cancel anything — answer their message (lookup_order answers a question about an order; take the order otherwise)' : canonicalTool(name) === 'lookup_order' ? ': the customer only gave a name, a place or a yes to the recap — record it and ask the next missing field (or let the recap / confirmation go)' : canonicalTool(name) === 'add_faq_candidate' ? ': the customer asked no question in this message — never file a note or a question they did not ask' : ''}. Answer the customer now with the JSON object.`,
});
/**
 * journey retest R2-4: a `create_order` answer after which the tool is not offered again in the same turn — the recap was
 * returned, the order placed (or refused: blocked, already placed, not confirmed), or a field must be asked to the customer
 * (VALIDATION missing=true). The same call was sent 2–3 times in a turn (10.1 s), and probes followed each other.
 */
export const orderClosedBy = (name: string, result: unknown): boolean => {
  if (canonicalTool(name) !== 'create_order') return false;
  const r = result as { ok?: unknown; hint?: unknown; error?: { code?: unknown; missing?: unknown } } | null;
  // journey re-run J03r-1 (18/11): nor after the order limit — no second call with a lower quantity (LIM T1 « 6 » ⇒ `{5}` ⇒ a recap of 5)
  if (r?.ok === true || r?.hint === 'order_limit') return true;
  const code = r?.error?.code;
  return code === 'CONFIRMATION_REQUIRED' || code === 'ORDER_ALREADY_PLACED' || code === 'CONFIRMATION_REFUSED' || code === 'CUSTOMER_BLOCKED' || (code === 'VALIDATION' && r?.error?.missing === true);
};
/**
 * journey retest R3-3: the `handoff_to_human` definition with only the allowed reasons; without « Shop rules » the description
 * no longer mentions `other` (the model chose it on « je veux 1 hijab soie », « Nadia Kaci, 0661234568 ou 0770998877 »).
 */
export const handoffDefWith = (def: AiToolDef, reasons: string[]): AiToolDef => {
  const p = def.parameters as { properties?: Record<string, unknown> };
  const description = reasons.includes('other') ? def.description : def.description.replace(/\s*\(reason = that rule id; reason=other only for a « Shop rules » item\)/, ' (reason = that rule id)');
  return { ...def, description, parameters: { ...def.parameters, properties: { ...p.properties, reason: { enum: reasons } } } };
};
/** journey retest R2-4: the result given back for a call identical to one already answered in this turn (not run again). */
export const repeatedCall = (result: unknown) => ({ ...(result && typeof result === 'object' && !Array.isArray(result) ? (result as object) : { result }), repeated: true, instruction: 'The same call was already answered in this turn (above): do not send it again — answer the customer now.' });

/**
 * journey retest R9-2 (17/11): the key two calls of one turn share when they ask the same thing — `search_products` with the same
 * query whatever its `limit` / case / accents (N8 T1: « Coffret cadeau Aïd » with `limit 1`, then without), else the call itself.
 * The second gets the first one's answer (`repeatedCall`) and does not run.
 */
export const sameCallKey = (name: string, args: unknown): string => {
  if (canonicalTool(name) !== 'search_products' || !args || typeof args !== 'object' || Array.isArray(args)) return toolCallId(name, args, 0);
  const { limit: _limit, query, ...rest } = args as Record<string, unknown>;
  return toolCallId('search_products', { ...rest, query: typeof query === 'string' ? foldGuard(query).replace(/\s+/g, ' ').trim() : query }, 0);
};
/**
 * journey retest R9-2: the answer to a `search_products` whose query is only a wilaya / commune name (N16 T1 « Illizi » after
 * quote_delivery said WILAYA_NOT_SERVED) — no product search is run.
 */
export const placeSearchResult = (query: string) => ({ products: [], notAProduct: true, instruction: `« ${query} » is a wilaya / commune, not a product: no product search is needed. A delivery question is answered with quote_delivery — answer the customer now.` });

/** The tools whose turn always needs the structured answer (an order placed, replaced or cancelled): never a plain-text shortcut. */
const ORDER_TOOL_NAMES: ReadonlySet<string> = new Set(['create_order', 'cancel_order', 'update_order']);
export type ExecutedTool = { callId: string; name: string; args: Record<string, unknown>; result: unknown; simulated: boolean; replayed: boolean };
export type TurnRequest = {
  runId: string;
  prompt: Pick<BuiltPrompt, 'system' | 'messages'> & { cachePrefix?: string };
  toolCtx: Omit<ToolRunContext, 'callId'>;
  temperature: number;
  maxTokens: number;
  /** epoch ms: the whole-run budget (45 s) */
  deadline: number;
  /** false: tool calls are executed but not persisted (never used by reply runs) */
  persist?: boolean;
  /** §4.3 reply guard: what the server knows this turn (this turn's tool results are added as they come) */
  guard?: GuardFacts;
};
/**
 * journey retest R18-3 (18/11): one model call of a turn — its time, the tools it called, and why another call followed (`tools`: their
 * results; `stray`: a tool not offered; `guard`: the reply guard's corrective turn; `confirm_note` / `yes_note` / `handoff_refused`: a
 * send-back; `format` / `plain`: the format retries). Kept on `AiRun.meta.steps` (no message text): N5 T2 took 9.7 s with no tool call and
 * nothing told how many model calls it made.
 */
// journey retest R19-1 (18/11): `stray` — the tools it asked that the step did not offer (R19 counted 27 such calls and could not tell which
// tools); an empty `steps` list is a turn the server answered with no model call (a plain yes to the recap shown)
export type TurnStep = { ms: number; calls?: string[]; stray?: string[]; next?: string; cacheRead?: number; cacheWrite?: number; outTok?: number; bad?: string };
type TurnBase = { tools: ExecutedTool[]; usage: AiUsage; model: RoutedModel | null; usedFallback: boolean; steps?: TurnStep[] };
export type TurnResult =
  | (TurnBase & { ok: true; output: AiReplyOutput; model: RoutedModel; forcedHandoff: string | null; repaired: boolean; salvaged?: boolean; /** retest 12/11: a handoff of the model was refused by the server this turn (handoff-judge) */ handoffRefused?: HandoffRefusal; /** §4.3: the reply guard found something (and what was done) */ guard?: GuardOutcome })
  | (TurnBase & { ok: false; kind: 'provider' | 'format'; error: string });
export type RunMeta = { steps?: TurnStep[]; language?: string; toolNames?: string[]; cardsSent?: number; handoff?: boolean; costUsd?: number; plannedCost?: number; vision?: Record<string, unknown>; sessionId?: string; turn?: unknown; evalFlag?: unknown; scenario?: string; /** §4.3 reply guard (rules, amounts / leak kinds, action — never message text) */ guard?: GuardOutcome };
/** §4.3: the run flags of a guard outcome (`guard_rewritten`: the corrective turn passed; `guard_enforced`: sentences dropped or the safe sentence sent). */
export const guardFlags = (g?: GuardOutcome): string[] => (!g ? [] : g.action === 'rewritten' ? ['guard_rewritten'] : g.action === 'kept' ? ['guard_kept'] : ['guard_enforced']);
/** §4.1 format retry: the earlier messages kept (the rest of the thread is left out). */
const FORMAT_RETRY_HISTORY = 8;
const slim = (v: GuardViolation[]) => v.map(({ rule, value, kind }) => ({ rule, ...(value !== undefined ? { value } : {}), ...(kind ? { kind } : {}) }));

/** Stable JSON (sorted keys) for the tool-call hash. */
export const canonicalJson = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
};
/**
 * Provider tool-call ids change when the model is re-prompted on a retry, so the persisted id is derived from the call
 * itself: `sha256(name + canonicalJson(args))` + its ordinal among identical calls of the run.
 */
export const toolCallId = (name: string, args: unknown, ordinal: number) => `${createHash('sha256').update(`${canonicalTool(name)}\n${canonicalJson(args)}`).digest('hex').slice(0, 32)}:${ordinal}`;
export const costUsd = (m: Pick<RoutedModel, 'inputPricePerM' | 'outputPricePerM'>, u: AiUsage) => Math.round(((u.inputTokens * m.inputPricePerM) / 1e6 + (u.outputTokens * m.outputPricePerM) / 1e6) * 1e6) / 1e6;
/**
 * `AiRun.error` of a provider failure: the §6 class, then the HTTP status and the provider's error type when known
 * (`provider_error:400 invalid_request_error`) — the bare class did not tell an overload from a refused request
 * (tester report 26/10). Never the provider's free text.
 */
export const providerErrorLabel = (e: AiProviderError) => [e.kind, [e.status, e.detail].filter(Boolean).join(' ')].filter(Boolean).join(':').slice(0, 120);
const INTENTS: Record<string, AiIntent> ={ SALE: 'sale', INFO: 'info', TRACKING: 'tracking', COMPLAINT: 'complaint', GREETING: 'greeting', OTHER: 'other' };
export const intentOf = (i: string): AiIntent => INTENTS[i] ?? 'other';

@Injectable()
export class AiRunService implements OnModuleInit {
  private readonly log = new Logger(AiRunService.name);
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly routing: RoutingService,
    private readonly tools: ToolRegistry,
    private readonly credits: CreditService,
    private readonly registry: ProcessorRegistry,
    private readonly tenants: TenantResolver,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit() {
    this.registry.cron('sched-ai-run-reaper', '* * * * *', () => this.reap());
  }

  /**
   * `created` — a new run; `replay` — the `running` run of an earlier attempt (its tool calls are replayed);
   * `done` — this batch was already answered (or failed for good): the caller does nothing.
   */
  async start(p: { workspaceId: string; conversationId: string | null; agentId: string | null; kind: AiRunKind; batchKey: string | null; attempt?: number; meta?: RunMeta }): Promise<{ run: AiRun; state: 'created' | 'replay' | 'done' }> {
    const find = () => (p.conversationId && p.batchKey ? prisma.aiRun.findFirst({ where: { conversationId: p.conversationId, batchKey: p.batchKey } }) : Promise.resolve(null));
    const reuse = async (existing: AiRun) => {
      if (existing.status !== 'running') return { run: existing, state: 'done' as const };
      const run = await prisma.aiRun.update({ where: { id: existing.id }, data: { attempt: Math.max(existing.attempt + 1, p.attempt ?? 1) } });
      return { run, state: 'replay' as const };
    };
    const existing = await find();
    if (existing) return reuse(existing);
    const route = await this.routing.route(p.kind === 'vision' || p.kind === 'caption' || p.kind === 'page_analysis' ? 'vision' : 'text');
    const model = route.failoverActive && route.fallback ? route.fallback : route.primary;
    try {
      const run = await prisma.aiRun.create({
        data: { workspaceId: p.workspaceId, agentId: p.agentId, conversationId: p.conversationId, kind: p.kind, modelId: model.id, providerId: model.providerId, batchKey: p.batchKey, attempt: p.attempt ?? 1, meta: (p.meta ?? undefined) as Prisma.InputJsonValue | undefined },
      });
      return { run, state: 'created' };
    } catch (e) {
      // two workers on the same batch: the unique (conversationId, batchKey) keeps one run
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const other = await find();
        if (other) return reuse(other);
      }
      throw e;
    }
  }

  /** Executes one tool call of a run, or returns its stored result (replay). */
  private async toolCall(req: TurnRequest, call: AiToolCallRequest, ordinal: number, before: readonly ExecutedTool[] = []): Promise<ExecutedTool> {
    const callId = toolCallId(call.name, call.args, ordinal);
    // journey retest R4-1: a server handoff reason (order_limits…) is accepted only after a tool of this turn reported it
    const established = establishedReasons(before.map((t) => t.result));
    const ctx: ToolRunContext = { ...req.toolCtx, callId, ...(established.length ? { established } : {}) };
    const simulated = (r: unknown) => req.toolCtx.dryRun && !!(r as { simulated?: unknown } | null)?.simulated;
    if (req.persist === false) {
      const result = await this.tools.execute(call.name, call.args, ctx);
      return { callId, name: call.name, args: call.args, result, simulated: simulated(result), replayed: false };
    }
    const stored = await prisma.aiToolCall.findUnique({ where: { aiRunId_callId: { aiRunId: req.runId, callId } } });
    if (stored?.executedAt) return { callId, name: stored.name, args: call.args, result: stored.result, simulated: simulated(stored.result), replayed: true };
    // persisted BEFORE execution: a crash between the two is visible, and the tool's own idempotency key is `runId:callId`
    if (!stored) await prisma.aiToolCall.create({ data: { aiRunId: req.runId, callId, name: call.name, args: call.args as Prisma.InputJsonValue } });
    const result = await this.tools.execute(call.name, call.args, ctx);
    await prisma.aiToolCall.update({ where: { aiRunId_callId: { aiRunId: req.runId, callId } }, data: { result: result as Prisma.InputJsonValue, executedAt: new Date() } });
    return { callId, name: call.name, args: call.args, result, simulated: simulated(result), replayed: false };
  }

  /**
   * The model loop of one turn. Provider failures are retried once on the route's other model inside `RoutingService`;
   * what comes back here as `ok: false` is final for this attempt (`provider`: both models failed or the 45 s budget is
   * spent; `format`: the output stayed malformed after the format reminder).
   */
  async turn(req: TurnRequest): Promise<TurnResult> {
    const steps: TurnStep[] = [];
    const r = await this.modelLoop(req, steps);
    return { ...r, steps };
  }

  /**
   * journey retest R19-1 (18/11): the model a run is recorded with when the server answers it with no model call (a plain yes placed) — the
   * text route's model the loop would call first. Null when no route can be read: the turn then goes through the model loop as before.
   */
  private async serverModel(): Promise<RoutedModel | null> {
    try {
      const r = await this.routing.route('text');
      const order = r.failoverActive && r.fallback ? [r.fallback, r.primary] : [r.primary, ...(r.fallback ? [r.fallback] : [])];
      return order.find((m) => m.supportsTools) ?? null;
    } catch {
      return null;
    }
  }

  /** journey retest R18-3: why the loop asked the model again — read from the last message it added. */
  private static nextReason(last: AiMessage | undefined): string {
    if (!last) return 'other';
    if (last.role === 'tool') return 'tools';
    const text = typeof last.content === 'string' ? last.content : '';
    if (text === FORMAT_REMINDER) return 'format';
    if (text === PLAIN_TEXT_REMINDER) return 'plain';
    if (text === CONFIRM_WITHOUT_RECAP_NOTE) return 'confirm_note';
    if (text === YES_WITHOUT_ORDER_NOTE) return 'yes_note';
    if (text.startsWith(HANDOFF_REFUSED_MARK)) return 'handoff_refused';
    if (text.startsWith('[tool result')) return 'stray';
    return last.role === 'user' ? 'guard' : 'other';
  }

  private async modelLoop(req: TurnRequest, steps: TurnStep[]): Promise<TurnResult> {
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    const messages: AiMessage[] = [...req.prompt.messages];
    // full-test 15/11 AI-CHAT-07: no handoff tool on a message that is only an order field (refused every time, 5–10 s each)
    // journey retest R11-3 (17/11): an order is being taken as soon as the customer gave a phone number — `ordering` (a product in
    // the model's `cart`, or a recap) was empty after a first answer with no tool, so « Sétif, El Eulma » was no field message and
    // got `handoff_to_human` probes (F1b T2 in 3 runs out of 3); a message that only names the wilaya / commune is a field too
    const phoneSoFar = req.toolCtx.customerHistory !== undefined && phonesIn(req.toolCtx.customerHistory).size > 0;
    let fieldOnly = fieldOnlyMessage(req.toolCtx.customerText, !!req.toolCtx.ordering || phoneSoFar);
    const short = (req.toolCtx.customerText ?? '').trim();
    const said0 = req.toolCtx.customerText;
    // journey retest R17-1 (18/11): a greeting with the place (« Bonjour, j'habite à Sétif, El Eulma ») is a place message too
    let candidatePlaces: PlaceIndex | null = null;
    if (!fieldOnly && placeCandidate(short)) {
      candidatePlaces = await placeIndex().catch(() => null);
      fieldOnly = !!candidatePlaces && placeOnlyMessage(candidatePlaces, short);
    }
    // journey retest R7-4: nor on a message that gives the order's details with a phone and asks nothing of the team (N5 T2
    // `handoff_to_human { off_catalogue, evidence « none » }` next to the recap) — `status = HANDOFF` stays judged
    const orderDetails = !fieldOnly && orderDetailsMessage(req.toolCtx.customerText, (t) => phonesIn(t).size > 0);
    const noHandoff = fieldOnly || orderDetails;
    // journey retest R3-3: the handoff tool carries only the reasons this agent's rules allow now (no `other` without shop rules)
    // journey retest R6-5: and `keyword` only when one of the agent's keywords is in the customer's message
    // journey retest R11-2 / R11-3 (17/11): and only the reasons this message can carry (`off_catalogue` was accepted on « vous avez des
    // lunettes de soleil ? » + full order details; `customer_request` probes on « Sétif, El Eulma », « 05559876 ») — none ⇒ no tool
    // journey retest R13-1 (18/11): nor `off_catalogue` on a message that wants a product or names one of the CATALOGUE
    // journey retest R17-1 (18/11): nor `off_catalogue` on a message with no product word (a greeting, a place, a name, a field)
    const placeOut = candidatePlaces ? (t: string) => withoutPlaceNames(candidatePlaces!, t) : undefined;
    const allowed = allowedHandoffReasons(req.toolCtx.agent, req.toolCtx.unclearStreak ?? 0, req.toolCtx.customerText);
    let reasons = messageHandoffReasons(allowed, req.toolCtx.customerText, (t) => phonesIn(t).size > 0, req.guard?.catalogueNames, placeOut);
    // journey retest R19-2 (18/11): `off_catalogue` is offered only when the judge could accept it — its product words read with the place
    // names taken out, as the judge reads them (`offCatalogueWordsOf`): N3 T2 « khouya twasslou l Constantine ? ana f El Khroub, cité 1000
    // logements bloc 5 » and F1b T4 « oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif » kept `off_catalogue` (no place lists
    // read for a message with a « ? » or a digit) and the model called it — refused `no_product`, one model call each. On such a message (no
    // product word, a delivery question, an address or a yes) no shop rule (`other`) applies either: no handoff tool at all.
    const noRuleMessage = said0 !== undefined && !teamOnlyKind(said0) && !productWanted(said0) && (asksDelivery(said0) || confirmation(said0) === 'yes' || !noAddressYet({ customerHistory: said0, orderHistory: [] }));
    let reasonPlaceOut = placeOut;
    // (the lists are read only for such a message that may get the tool — they are cached; an unreadable list changes nothing)
    if (noRuleMessage && !noHandoff && !placeOut && (reasons.includes('off_catalogue') || reasons.includes('other'))) {
      const places0 = await placeIndex().catch(() => null);
      if (places0) {
        reasonPlaceOut = (t: string) => withoutPlaceNames(places0, t);
        reasons = messageHandoffReasons(allowed, said0!, (t) => phonesIn(t).size > 0, req.guard?.catalogueNames, reasonPlaceOut);
      }
    }
    if (noRuleMessage && reasons.includes('other') && !offCatalogueWords(said0!, reasonPlaceOut).length) reasons = reasons.filter((r) => r !== 'other');
    // journey retest R5-6: no create_order while the customer has given no phone number (every such call is refused) — the
    // probes `create_order {}` / placeholder values came on such turns; a complete order message carries its phone and keeps it
    const noPhone = !(await this.phoneGiven(req.toolCtx));
    // journey retest R6-5: with a phone create_order stays offered, but with no street address / stop-desk word in the
    // customer's messages (and no recap yet) the model is told to ask for the address rather than call it (F1b: « Sétif, El
    // Eulma » ⇒ `create_order` without an address, refused)
    // UX-082: an order of a service has no delivery — nothing about an address or a wilaya is withheld or asked for it
    const serviceTaken = takesService(req.toolCtx.customerHistory ?? req.toolCtx.customerText ?? '', req.guard?.cataloguePrices ?? [], req.guard?.catalogueStock, req.toolCtx.takenIds);
    const noAddress = !noPhone && !serviceTaken && noAddressYet(req.toolCtx);
    // journey retest R7-4: and with no wilaya either (none named, no commune of one, none known of the customer) it is not
    // offered at all — such a call can only be refused (F1b T1 `wilayaId 1`)
    // the wilaya / commune lists, read once for the turn (unreadable ⇒ null: nothing is withheld on their account)
    const places = noAddress && req.toolCtx.customerHistory !== undefined ? await placeIndex().catch(() => null) : null;
    const noPlace = noAddress && !(await this.placeKnown(req.toolCtx, places));
    // journey retest R8-4 (17/11): nor on a message that only names the place (« Sétif, El Eulma ») while no street address was
    // given — F1b T2 `create_order { items: [], no commune, no address }`, refused; the street (or the stop-desk) is asked
    const noStreet = noAddress && !noPlace && this.placeOnly(req.toolCtx.customerText, places);
    // journey retest R8-4: no cancel_order on a message that gives the order's details and asks no cancellation (N5 T2
    // `cancel_order {}` next to the recap, NO_OPEN_ORDER)
    // journey retest R10-3 (17/11): nor without a cancel word in the customer's last messages or an order number in this one (N11 T3
    // `cancel_order {}` on « وين راهي الطلبية تاعي؟ … », a tracking question)
    const said = req.toolCtx.customerText;
    const noCancel = orderDetails || (said !== undefined && !cancelAsked(said, req.toolCtx.customerHistory));
    // journey retest R10-3: no lookup_order on a message that only gives a name / a place, no add_faq_candidate on a message that
    // asks nothing (N4 T2 « سمير بن علي » ⇒ `lookup_order {}` + an internal note as an FAQ candidate; N5 T2 an unasked question)
    // journey retest R11-3 (17/11): nor on a message that gives the order's details and says nothing about an earlier order (N3 T1
    // « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 » ⇒ `lookup_order {}`, 0 order)
    // journey retest R13-4 (18/11): nor on a message that wants a product and says nothing of an order (F3 T1 « nheb nechri zoudj tapis
    // de prière » ⇒ `lookup_order {}`, 0 order)
    // journey retest R22-2 (18/11): « livraison » there is the delivery of the order being given, not a parcel to track (PH1 T1 « Je veux 1 hijab
    // soie, livraison Alger … » ⇒ `lookup_order {}`, 0 order, one more model call)
    const noLookup = noLookupFor(said, fieldOnly) || (said !== undefined && (orderDetailsMessage(said, (t) => phonesIn(t).size > 0, true) || productWanted(said)) && !ORDER_WORD.test(foldGuard(said).replace(/(?<![\p{L}])livraisons?(?![\p{L}])/gu, ' ')));
    const noFaq = said !== undefined && !asksSomething(said);
    // journey retest R10-2: a server recap of an earlier turn waits for the customer's « oui » (a request to confirm points at it)
    const pendingBefore = recapPending(req.toolCtx.orderHistory);
    // journey retest R12-3 (17/11): nor on a « oui » to that recap (F6 T3, F3 T4: `create_order` ⇒ TEST-n, then `lookup_order {}` ⇒
    // no order) — the yes places the order, nothing is to be looked up; a question or a change in the message keeps it
    const confirmingYes = pendingBefore && said !== undefined && confirmation(said) === 'yes' && !asksSomething(said) && !ORDER_WORD_ASK.test(foldGuard(said));
    // journey retest R17-2 (18/11, Major): a plain yes to the server recap the AI's last message showed places exactly that recap's order,
    // server-side, whatever the model does on this turn (N5 T3 « oui » to the substitute's recap ⇒ « … confirmez-vous la commande du Coffret
    // … ? Si oui, je vous envoie le récapitulatif officiel », no create_order): its stored arguments (null when the message is no such yes)
    const lastAi = [...req.prompt.messages].reverse().find((m) => m.role === 'assistant');
    const recapShownLast = serverRecapAsked(typeof lastAi?.content === 'string' ? lastAi.content : null);
    req.toolCtx.recapShownLast = recapShownLast;
    const yesOrder = recapYesArgs(req.toolCtx.orderHistory, said, recapShownLast);
    // journey retest R16-3 (18/11): every order field is known — the message gives the order's details (or changes a recap that waits):
    // create_order computes the fee and checks the stock (N14 T1 / N1 T2 quoted and checked before the recap call)
    // journey retest R17-2 (18/11): not when the product the customer takes is out of stock — N5 T2 « Bon finalement je le prends » after
    // T1's out-of-stock Parfum Oud: told to call create_order directly, the model sent the substitute's recap at once, never asked whether
    // the customer wanted the substitute, and asked that at T3 instead of placing the « oui » (R14–R16: the substitute offered first)
    const takesUnavailable = !!said && !!req.guard?.unavailableNames?.length && takesOutOfStock(req.toolCtx.customerHistory ?? said, req.guard?.cataloguePrices ?? [], req.guard.unavailableNames);
    const recapReady = !noPhone && !noAddress && !takesUnavailable && (orderDetails || (pendingBefore && !confirmingYes && said !== undefined && !asksSomething(said)));
    // journey retest R17-6 (18/11): with no street address / stop-desk word in any customer message yet (and no recap shown), create_order
    // is not offered on a message that cannot hold an address either — no digit left once its phone numbers are taken out (PF1 T2 « Je
    // voudrais le sac à main cuir marron. Karim Haddad 0770112233 » ⇒ `create_order` without an address, VALIDATION address)
    // (a phone typed in the conversation, not one of a client record, and no KNOWN CUSTOMER address in the prompt: a returning customer's
    // address may be on record)
    const noAddressHere = noAddress && phoneSoFar && said !== undefined && !digitsBeyondPhones(said) && !/KNOWN CUSTOMER[^\n]*address=/u.test(req.prompt.system);
    // journey retest R19-1 (18/11): the message gives the order's details while the product the customer takes is out of stock (N5 T2 « Bon
    // finalement je le prends. Karim Haddad 0770112233, Oran, … » after T1's Parfum Oud): no order can be made for it — create_order is not
    // offered (4 model calls, 17.1 s: get_product, search_products, then `create_order` for the Parfum Oud without commune nor address ⇒
    // VALIDATION) and the model is told to ask whether the customer wants the in-stock product instead (its « oui » gives that recap)
    const takesGone = takesUnavailable && orderDetails && !pendingBefore ? takenName(req.toolCtx.customerHistory ?? said ?? '', req.guard?.cataloguePrices ?? []) : null;
    // journey retest R20-3 (18/11): a plain yes (no question, no change) to the AI's last question offering products — two or more ⇒ the server
    // asks which one, with no model call (N5 T3 / T4 « oui » to « … le Hijab soie … ou la Robe kabyle brodée … ? » got that question again, with
    // the out-of-stock sentence a 2nd and a 3rd time); the one in-stock product offered instead of the out-of-stock one taken ⇒ it is taken
    const lastAiText = typeof lastAi?.content === 'string' ? lastAi.content : null;
    const plainYesNow = said !== undefined && !/[?؟]/u.test(said) && confirmation(said) === 'yes' && (bareYesWords(said) || !/[\p{L}\p{N}]/u.test(said));
    const offeredNow = !yesOrder && plainYesNow && !serverRecapAsked(lastAiText) && req.guard ? offeredInQuestion(lastAiText, req.guard.cataloguePrices ?? [], req.guard.unavailableNames ?? []) : [];
    const choiceNames = offeredNow.length >= 2 ? offeredNow.map((p) => p.name) : null;
    const substituteTaken = offeredNow.length === 1 && takesUnavailable ? offeredNow[0]!.name : null;
    // UX-079: a message that is only a greeting starts no order (a « oui » to a waiting recap is no greeting)
    const greetOnly = greetingOnly(said) && !yesOrder;
    // UX-095: a message that only asks a price starts no order either (the customer's saved details made a recap of it)
    const priceOnly = !greetOnly && !yesOrder && priceQuestionOnly(said);
    const withheld = (name: string) =>
      (name === 'handoff_to_human' && (noHandoff || !reasons.length)) || (name === 'create_order' && (noPhone || noPlace || noStreet || noAddressHere || !!takesGone || greetOnly || priceOnly)) || (name === 'cancel_order' && noCancel) || (name === 'lookup_order' && (noLookup || confirmingYes)) || (name === 'add_faq_candidate' && noFaq);
    // every tool of the turn, in its fixed order (AI_STABLE_TOOLS: sent on each step so the cached prefix stays the same)
    const allDefs = await this.tools.defsFor(req.toolCtx.workspaceId);
    const defs = allDefs.filter((d) => !withheld(d.name)).map((d) => (d.name === 'handoff_to_human' ? handoffDefWith(d, reasons) : d));
    // journey retest R1-1: the model still called the withheld tool (the prompt describes it) and the SDK refused the whole
    // step — 5 of 59 turns of a shop with handoff rules ended in 503. The note says it is not available for this message
    // (after the cached start of the system prompt, so the cache is kept).
    // journey retest R5-6: and, without a phone, that create_order is not available (same place: the cache prefix is kept)
    const executed: ExecutedTool[] = [];
    // journey retest R16-3 (18/11): the delivery quotes of earlier turns that stay valid (the shop's delivery rules unchanged since), and
    // the ones of them this turn used instead of a new quote_delivery (they count as this turn's quotes: the reply gives their fee)
    const knownQuotes = await this.knownQuotes(req);
    const reused: ExecutedTool[] = [];
    const knownNote = knownQuotesNote(knownQuotes);
    // journey retest R9-1 (17/11): the one language of every server-written text of this turn (recap, confirmation, blocked
    // sentence, delivery answer, « no photo » sentence) — the turn's, a `mixed` turn taking the shop's locale, never French by default
    const textLang = serverTextLanguage(req.guard?.lang, req.guard?.shopLocale);
    /**
     * journey retest R9-2 (17/11): a search_products whose query is only a wilaya / commune name (and no word of a catalogue
     * name) is not run — its query is returned (N16 T1 `search_products {«Illizi»}` after quote_delivery). Lists unreadable ⇒ run.
     */
    let searchPlaces: PlaceIndex | null | undefined;
    const placeSearch = async (call: AiToolCallRequest): Promise<string | null> => {
      const query = canonicalTool(call.name) === 'search_products' && typeof call.args?.query === 'string' ? call.args.query.trim() : '';
      if (!query || !/\p{L}/u.test(query)) return null;
      const q = foldGuard(query);
      if ((req.guard?.tokens ?? []).some((t) => t.includes(q) || q.split(/\s+/).some((w) => w.length >= 3 && t.split(/\s+/).includes(w)))) return null;
      searchPlaces ??= places ?? (await placeIndex().catch(() => null));
      return searchPlaces && placeOnlyMessage(searchPlaces, query) ? query : null;
    };
    // journey retest R15-3 (18/11): a get_product of a product the prompt's CATALOGUE lists is answered from it — not on a photo request
    // (its pictures come with get_product)
    const catalogueLookup = !photoAsked(req.toolCtx.customerText ?? '');
    /**
     * The answer of a call this turn (or an earlier one) already has — not run. journey retest R10-3 / R11-3 / R13-4 / R14-3 / R15-3 (searches,
     * lookups, quotes of this turn); journey retest R16-3 (18/11): a quote of an earlier turn still valid, a quote while every order field is
     * known, a check_availability the CATALOGUE answers, a search an earlier turn made, a product search on a delivery-only question.
     */
    const knownAnswer = (call: AiToolCallRequest, stepCalls: readonly AiToolCallRequest[]): Record<string, unknown> | null => {
      const known = knownAnswerOf(call, stepCalls);
      if (known && ['search_products', 'get_product'].includes(canonicalTool(call.name))) knownLooked.push(...knownProductIds(call, known, req.guard?.cataloguePrices ?? []));
      return known;
    };
    /**
     * journey retest R22-3 (18/11): the products a search / get_product answered without running names — the price rule of R18-2 counts
     * them as this turn's search results (A3 T1 « نحب زوج سجادات صلاة … » ⇒ `search_products {«Tapis de prière»}` answered from the
     * CATALOGUE, so no product was « found » and « واش من ولاية … ؟ » went out with no product and no price).
     */
    const knownLooked: string[] = [];
    /** journey retest R22-3: the order amounts (`subtotal`) of the model's quote_delivery calls of this turn. */
    const quotedSubtotals = (): number[] => executed.filter((t) => canonicalTool(t.name) === 'quote_delivery').map((t) => Number(t.args?.subtotal)).filter((n) => Number.isInteger(n) && n > 0);
    const knownAnswerOf = (call: AiToolCallRequest, stepCalls: readonly AiToolCallRequest[]): Record<string, unknown> | null => {
      const search = canonicalTool(call.name) === 'search_products';
      // journey retest R17-6 (18/11): nor, on a message giving the order's details, a search for one product the CATALOGUE lists (N5 T2
      // `search_products {«Parfum Oud 50 ml»}` + `{«Coffret cadeau Aïd»}` before the recap call, 10.0 s — both listed with their stock)
      const known = (search ? (searchAnswered(call.args?.query, executed, req.guard?.catalogueNames) ?? (fieldOnly || orderDetails ? catalogueAnswered(call.args?.query, req.guard?.catalogueNames) : null)) : null) ?? recapAnswered(call, executed) ?? lookupAnswered(call, executed, req.guard?.catalogueIds, stepCalls, catalogueLookup) ?? orderLookupAnswered(call, executed) ?? quoteAnswered(call, [...executed, ...reused]);
      if (known) return known;
      const earlier = earlierQuoteAnswered(call, knownQuotes);
      if (earlier) {
        reused.push({ callId: `earlier-quote:${reused.length}`, name: 'quote_delivery', args: call.args, result: earlier, simulated: false, replayed: true });
        return earlier;
      }
      if (recapReady && canonicalTool(call.name) === 'quote_delivery' && !asksDelivery(said ?? '')) return RECAP_COMPUTES_RESULT;
      return catalogueAvailability(call, req.guard?.catalogueStock) ?? (search ? (earlierSearchAnswered(call, req.guard?.earlierSearches, req.guard?.catalogueIds) ?? strayDeliverySearch(call, said, req.toolCtx.customerHistory, req.guard?.cataloguePrices)) : null);
    };
    const seen = new Map<string, number>();
    const answered = new Map<string, unknown>();
    /**
     * journey retest R17-6 (18/11): a create_order sent with no address and no stop-desk while the customer's messages give no address yet
     * (PF1 T2) — answered as the tool would (VALIDATION address), not run; null for any other call.
     */
    let addressRefused = false;
    const addressLess = (call: AiToolCallRequest): Record<string, unknown> | null => {
      if (canonicalTool(call.name) !== 'create_order' || !noAddress || yesOrder) return null;
      const a = call.args ?? {};
      if ((typeof a.address === 'string' && a.address.trim()) || a.isStopdesk === true || a.isStopdesk === 'true') return null;
      // (only when the address is the one field missing in the call: any other absent field goes to the tool, which names them all)
      const absent = absentFields(a, req.toolCtx.agent);
      if (absent.some((f) => f !== 'address' && f !== 'communeName')) return null;
      return { ok: false, error: { code: 'VALIDATION', field: 'address', missing: true, fields: absent.length ? absent : ['address'], example: 'Cité 200 logements, Bt 4, Bab Ezzouar' }, say: 'Not done: the customer has not given the address yet. Ask for the street address (rue, cité, building, landmark) or offer the stop-desk in one short question and do not call create_order again in this turn.' };
    };
    /** journey retest R17-2: the model's create_order on a plain yes to the recap shown carries that recap's stored order. */
    const yesCall = (call: AiToolCallRequest): AiToolCallRequest =>
      yesOrder && canonicalTool(call.name) === 'create_order' ? { ...call, args: { ...yesOrder, ...(call.args?.phoneConfirmed === true ? { phoneConfirmed: true } : {}) } } : call;
    /**
     * journey retest R17-2 (18/11, Major): the model answered a plain yes to the recap shown with no create_order (N5 T3: a new confirm
     * question) — the server places that recap's stored order itself (a tool call of this run, like its own quotes); the confirmation it
     * writes replaces the model's text. Null when there is nothing to place (no such yes, a create_order of this turn already ran, a
     * hand-off forced by a tool).
     */
    const placeYes = async (): Promise<{ call: AiToolCallRequest; done: ExecutedTool } | null> => {
      if (!yesOrder || forcedHandoff || executed.some((t) => canonicalTool(t.name) === 'create_order')) return null;
      const call: AiToolCallRequest = { id: 'server-yes', name: 'create_order', args: yesOrder };
      const hash = toolCallId(call.name, call.args, 0);
      const ordinal = seen.get(hash) ?? 0;
      seen.set(hash, ordinal + 1);
      const done = await this.toolCall(req, call, ordinal, executed);
      executed.push(done);
      answered.set(sameCallKey(call.name, call.args), done.result);
      orderClosed ||= orderClosedBy(call.name, done.result);
      forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
      return { call, done };
    };
    // journey re-run J04r-4 (18/11): the customer writes Modern Standard Arabic (no darija word in their Arabic-script messages)
    const msa = req.guard?.lang === 'ar' && msaRegister(req.toolCtx.customerHistory ?? req.toolCtx.customerText);
    const system = [req.prompt.system, ...(msa ? [MSA_NOTE] : []), ...(fieldOnly ? [FIELD_ONLY_NOTE] : []), ...(orderDetails ? [ORDER_DETAILS_NOTE] : []), ...(noPhone ? [NO_PHONE_NOTE] : []), ...(greetOnly ? [GREETING_ONLY_NOTE] : []), ...(priceOnly ? [PRICE_QUESTION_NOTE] : []), ...(serviceTaken && !greetOnly ? [SERVICE_ORDER_NOTE] : []), ...(noPlace ? [NO_PLACE_NOTE] : noStreet ? [NO_STREET_NOTE] : noAddress ? [NO_ADDRESS_NOTE] : []), ...(knownNote ? [knownNote] : []), ...(recapReady ? [RECAP_READY_NOTE] : []), ...(takesGone ? [takesUnavailableNote(takesGone)] : []), ...(substituteTaken ? [takesSubstituteNote(substituteTaken)] : [])].join('\n\n');
    // journey retest R7-5: run once, when the answer to a delivery question comes without any quote_delivery of the turn
    let serverQuoted = false;
    // journey retest R14-2: the server's quote for the fees of a « home or stop-desk? » question (not a delivery question)
    let modeQuote: ExecutedTool | null = null;
    // journey retest R15-1: the server's quote of a place the customer named with no quote of it yet in the conversation, and the
    // product (its price) the message names
    let placeQuote: ExecutedTool | null = null;
    let placeProduct: PlaceProduct | null = null;
    // journey retest R18-1 (18/11): a street address is in the customer's messages (home delivery: the place's home fee alone, R5-4)
    const streetGiven = req.toolCtx.customerHistory !== undefined && !noAddressYet({ customerHistory: req.toolCtx.customerHistory, orderHistory: [] });
    // journey retest R18-1: the place the customer named is not served (its names, for « we don't deliver there »)
    let placeNotServed: { fr: string; ar?: string } | null = null;
    let model = null as RoutedModel | null;
    let usedFallback = false;
    let repaired = false;
    let firstAnswer = '';
    let forcedHandoff: string | null = null;
    // journey re-run J03r-1 (18/11, Major): the quantity above « Quantité max par commande » the customer's message asks for (handed off
    // before any model call); the limit a create_order of this turn reported comes from its answer (`limitNow`)
    let messageLimit: OrderLimit | null = null;
    let toolRounds = 0;
    // client list L92 (23/11): after a call to a tool that does not exist (« dummy », « noop ») with nothing to run, the next step is asked
    // WITHOUT tools — the model answers instead of making up another call (« ماهي المنتجات اللي عندكم »: dummy, then handoff_to_human, then the
    // answer — 3 model calls, 15 s)
    let noToolsNext = false;
    let handoffAsked = false;
    let confirmAsked = false;
    // journey retest R11-5: the plain-text step after the format reminder was asked (once)
    let plainAsked = false;
    let handoffRefused: HandoffRefusal | undefined;
    // journey retest R2-4: create_order is withdrawn for the rest of the turn once it answered for good (orderClosedBy), and a
    // call identical to one already answered this turn gets that answer back without running again
    let orderClosed = false;
    // §4.3 reply guard: the answer that broke a rule (its status, cards and fields are kept), and what it broke
    let guardFirst = null as { output: AiReplyOutput; extra: { salvaged?: boolean }; violations: GuardViolation[] } | null;
    // full-test 15/11 proposal 4: once create_order placed an order this turn, the customer gets the server's confirmation
    // (number, items, total, delay, payment) in their language — never the model's own wording of it (it « corrected »
    // itself, said the details were invented or that nothing was ordered: AI-CHAT-02)
    const confirmationNow = () => orderConfirmationText(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })), textLang);
    // journey retest R1-6 / R1-7: a recap create_order returned this turn is sent as the server wrote it (catalogue names,
    // delivery mode, name, phone, address) — the model's own recap was cut short or translated the product names
    const recapNow = () => pendingRecap(executed.map((t) => ({ name: canonicalTool(t.name), result: t.result })));
    /**
     * journey retest R17-1 (18/11): a hand-off turn whose quote_delivery answered a place the customer named keeps that fee — PF1 T1 quoted
     * Sétif (650 / 350) and the hand-off text replaced it all. The fee sentence of every owed wilaya the text lacks goes first.
     */
    const withHandoffFees = (text: string): string => {
      const quotes = quoteFacts(executed.filter((t) => t !== modeQuote && t !== placeQuote).map((t) => ({ name: canonicalTool(t.name), result: t.result })));
      const owed = quotes.length ? owedQuotes(text, quotes, req.toolCtx.customerText) : [];
      return owed.length ? `${owed.map((q) => feeSentence(q, textLang, req.guard?.shopLocale)).join(' ')} ${text}`.trim() : text;
    };
    const limitNow = (): OrderLimit | null => {
      for (const t of executed) if (canonicalTool(t.name) === 'create_order') {
        const l = orderLimitOf(t.result);
        if (l) return l;
      }
      return messageLimit;
    };
    const confirmedText = (output: AiReplyOutput): AiReplyOutput => {
      const text = confirmationNow();
      if (text) return { ...output, reply: text };
      // journey retest R2-6: Messenger shows « **Djellaba homme** » as typed — the reply goes out as plain text
      const plain = { ...output, reply: stripMarkdown(output.reply) };
      const calls = executed.map((t) => ({ name: canonicalTool(t.name), result: t.result }));
      // journey retest R4-8: a blocked customer's order gets the server's sentence, in line with the shop's handoff text
      const blockedText = blockedOrderText(calls, textLang);
      if (blockedText) return { ...plain, reply: blockedText };
      // a handoff answer is not a recap to confirm — journey retest R4-1: and it never claims one (« récapitulée ci-dessus »)
      // journey retest R14-4 (18/11): and never empty — the customer gets one short sentence before the system line (W1)
      if (output.status === 'HANDOFF' || forcedHandoff) {
        // journey retest R15-2 (18/11): one sentence per reason in the customer's language and script — a request for a person gets the
        // server's sentence (H1 / H2 had an empty text; the model's own « je vous passe un conseiller » is not sent next to the shop's
        // line, recette 09/11), a refund / complaint its own (C1 got the W1 sentence). Out of hours nothing promises a quick answer and
        // the sentence says the team answers at the opening; when the shop's line is not shown with this turn (out of hours, or an
        // arabizi turn whose system texts are in Arabic script) the model's own sentence is followed by what the team does.
        const reason = forcedHandoff ?? handoffReason(output.statusDetail);
        const ooh = !!req.guard?.outOfHours;
        // journey re-run J03r-1 (18/11, Major): the order limit gets the server's sentence naming the limit — never the model's text, which
        // offered the maximum (« combien de paires souhaitez-vous, jusqu'à 5 ? »)
        const limit = reason === 'order_limits' ? limitNow() : null;
        if (limit) return { ...plain, reply: limitHandoffReply(limit, textLang, { outOfHours: ooh }) };
        const customerText = req.toolCtx.customerText;
        const person = handoffKind(reason) === 'person' && executed.every((t) => canonicalTool(t.name) === 'handoff_to_human');
        // journey retest R16-2 (18/11): a model refusal (« Je ne peux pas vous donner de prix de gros ici. ») is never the hand-off's text
        let said = person ? '' : withoutRefusals(withoutRecapClaims(plain.reply)).trim();
        if (ooh) said = withoutQuickReply(said);
        if (!said) return { ...plain, reply: withHandoffFees(handoffReply(reason, textLang, { outOfHours: ooh, customerText })) };
        const shown = handoffSystemLineShown(textLang, ooh, systemLocale(textLang, req.guard?.shopLocale ?? 'fr', (req.toolCtx.agent as { defaultLanguage?: string | null } | undefined)?.defaultLanguage ?? null));
        // journey retest R16-2: a hand-off the model made with its own handoff_to_human call, or a request only the team can answer (wholesale,
        // a custom order, a partnership), always carries the reason's sentence — W1 got the model's refusal and a « pour info » price, nothing on
        // the team — unless the model's own words already say the team takes it over
        const ownCall = executed.some((t) => canonicalTool(t.name) === 'handoff_to_human');
        const always = (ownCall || !!teamOnlyKind(customerText)) && !teamSaid(said);
        return { ...plain, reply: withHandoffFees((shown && !always) || (ooh && openingSaid(said)) ? said : `${said} ${handoffReply(reason, textLang, { outOfHours: ooh, tail: true, customerText })}`) };
      }
      const recap = recapNow();
      // journey re-run J04r-2 (18/11): a cancellation is said only when the server made it — C1 T13 `cancel_order {}` ⇒ `{ ok, candidates }`
      // (nothing cancelled) and the reply « La commande TEST-1525 … est annulée »: the server's question replaces that text
      const cancelCalls = executed.filter((t) => canonicalTool(t.name) === 'cancel_order');
      if (!recap && cancelCalls.length && !cancelCalls.some((t) => cancelledNumber(t.result) || (t.result as { alreadyCancelled?: unknown } | null)?.alreadyCancelled) && !lastCancelled(req.toolCtx.orderHistory) && cancelClaimed(plain.reply)) {
        const open = cancelCalls.flatMap((t) => ((t.result as { candidates?: { number?: unknown }[] } | null)?.candidates ?? []).map((c) => c?.number)).filter((n): n is string => typeof n === 'string');
        return { ...plain, reply: cancelQuestion([...new Set(open)], textLang) };
      }
      if (!recap) {
        // journey retest R7-3: « ? » / « ... » gets the pending question, not « Oui, je suis là ! » / « Vous êtes toujours là ? »
        let text = fillerMessage(req.toolCtx.customerText) ? withoutPresenceTalk(plain.reply) : plain.reply;
        // journey retest R9-3: the order wording follows lookup_order's status (« في الدرب » for an order not sent), one « درك »,
        // no opening « Ih, » that answers nothing
        text = withoutStrayYes(withOneNowWord(withOrderStatusWording(text, calls.filter((c) => c.name === 'lookup_order').map((c) => c.result))), req.toolCtx.customerText, asksSomething);
        // journey retest R10-4: « بسعر Hijab soie — 1500 دج » (the name in the price slot), French words left in an arabizi reply
        text = withArabiziWords(withoutNameInPriceSlot(text), textLang);
        // journey retest R12-4 (17/11): « 7500 DA » in an Arabic-script sentence ⇒ « 7500 دج »
        text = withArabicCurrency(text);
        // journey retest R13-6 (18/11): a fee answer gives home AND stop-desk when this turn's quote gave both (F1b T2); « taille unique »,
        // « نعم » in an Arabic-script answer (N18 T1, A2 T1)
        // journey retest R14-2 (18/11): and « home or stop-desk? » carries both fees (the server's quote when the model made none)
        // (journey retest R18-1: the server's quote of a place after a street was given writes the home fee alone — no stop-desk added to it)
        const quotesNow = quoteFacts([...executed.filter((t) => !(streetGiven && t === placeQuote)), ...reused].map((t) => ({ name: canonicalTool(t.name), result: t.result })));
        text = withArabicWords(withModeFees(withBothFees(text, quotesNow, textLang), quotesNow, textLang), textLang);
        // journey retest R15-1 (18/11): a place given with no quote of it yet ⇒ the product's price and both fees (the server's quote)
        // journey retest R18-1 (18/11): a place named with no quote of it yet that is not served ⇒ « we don't deliver there »
        if (placeNotServed) text = withNotServed(text, placeNotServed, textLang);
        else if (placeQuote) text = withPlaceFacts(text, quoteFacts([{ name: 'quote_delivery', result: placeQuote.result }]), placeProduct, textLang, { homeOnly: streetGiven });
        // journey retest R20-2 (18/11): a quote run in this turn always reaches the reply unless the reply already states its fees — F5r T1
        // (shared link): the server's R14-2 quote of the first draft's « l'adresse … wela t7ebb stop-desk ? » (400 / 250, written before that
        // question) was lost when the guard's language rewrite split the question in two (« … ? Wela t7ebb stop-desk ? »: no mode question
        // left, no fee rule for a server quote) — « Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse … ? », no fee
        // (a delivery question gets both fees even after a street was given; a quote the model made is owed as the guard owes it — the
        // wilaya the message names, else one fee of any: R1 F9 T2 « w l Oran stop desk ch7al ? » owes nothing of a re-quoted Sétif)
        if (!placeNotServed) {
          const runQuotes = executed.filter((t) => canonicalTool(t.name) === 'quote_delivery' && t !== placeQuote);
          const owed = new Set(owedQuotes(text, quoteFacts(runQuotes.filter((t) => t !== modeQuote).map((t) => ({ name: 'quote_delivery', result: t.result }))), said).map((q) => foldGuard(q.wilaya)));
          for (const t of runQuotes) {
            const q = quoteFacts([{ name: 'quote_delivery', result: t.result }]);
            if (q.length && (t === modeQuote || owed.has(foldGuard(q[0]!.wilaya)))) text = withPlaceFacts(text, q, null, textLang, { homeOnly: streetGiven && !asksDelivery(said ?? '') });
          }
        }
        // journey retest R17-1 (18/11): the place quoted in an earlier turn (no server quote now) — the product this message names still gets
        // its price before the address / « home or stop-desk? » question (PF1 T2 « … à domicile à El Eulma (650 DA) ou en stop-desk (350 DA) ? »,
        // no 6 900 DA)
        // journey retest R18-2 (18/11): whatever the reply asks — every catalogue product being sold (the one the message names, the reply's
        // one product card, a product the reply names by its whole name) whose price the customer was not told yet in the conversation: PG2 T2
        // « … للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. تحب نوصلوها للدار ولا في ستوب ديسك؟ » (Djellaba homme 7 500 دج never said), N3 T1 « Parfait
        // Samira, 2 tapis de prière …, c'est noté ! Dans quelle wilaya êtes-vous ? » (2 800 DA never said)
        if (!placeNotServed && ![...executed, ...reused].some((t) => canonicalTool(t.name) === 'quote_delivery' && (t.result as { error?: { code?: unknown } } | null)?.error?.code === 'WILAYA_NOT_SERVED'))
          // (journey retest R22-3: with the products a search answered without running named, and the product of the model's quote of this turn)
          for (const product of this.saleProductsOf(req, output, text, [...new Set([...executed.filter((t) => ['search_products', 'get_product', 'check_availability'].includes(canonicalTool(t.name))).flatMap((t) => productIdsOf(t.result)), ...knownLooked])], quotedSubtotals())) text = withPlaceFacts(text, [], product, textLang);
        // journey retest R15-4 (18/11): the asked price of an out-of-stock product is given with « pas disponible » (N5 T1)
        const gone = new Set(req.guard?.unavailableNames ?? []);
        text = withAskedPrice(text, req.toolCtx.customerText, (req.guard?.cataloguePrices ?? []).filter((p) => gone.has(p.name)), textLang, req.guard?.cataloguePrices ?? []);
        // journey retest R16-4 (18/11): the stop-desk offered once; no question that sounds like a booking before any recap (« تحب نحجزلك
        // واحد؟ ») — the next missing field instead
        // journey retest R17-4 (18/11): the family in Arabic script / arabizi / French, and a clause saying it is booked / prepared / noted
        text = withoutBookingOffer(withOneStopdeskOffer(text), req.toolCtx.customerText, phoneSoFar, textLang, { history: req.toolCtx.customerHistory, orderedBefore: placedNumbers(req.toolCtx.orderHistory).length > 0 });
        // journey retest R18-4 (18/11): no « tsajjel: … », « Tsajjelt Amina Saadi, … », « سجلت زوج من … », « c'est noté ! » before any recap (it
        // reads like an order step) — while no recap waits and no order was placed in the conversation; the customer's name as they wrote it
        // (N4 T2 « je note le nom : Samir Ben Ali » for « سمير بن علي »)
        // journey retest R19-3 (18/11): nor « c'est noté : … » / « j'ai bien noté … » (F5, F1b, PF1, N5), nor a substitute question worded as an order
        // step (N5 « Voulez-vous que je vous le réserve ? », « je vous confirme : c'est bien … ? »)
        // journey retest R20-4 (18/11): nor « je note … » (PF1 T2), nor « Vos coordonnées sont bien notées : » opening a question (N5 T2)
        if (!pendingBefore && !placedNumbers(req.toolCtx.orderHistory).length) text = withoutNotedOpening(withoutOrderStepAsk(withoutNotedSteps(text, req.toolCtx.customerHistory ?? req.toolCtx.customerText), textLang));
        text = withCustomerScriptName(text, req.toolCtx.customerHistory ?? req.toolCtx.customerText ?? '');
        // journey J05r-9 (18/11): no apology « pour la confusion » when the customer pointed at no mistake (« Merci Nadia, je m'excuse pour la
        // confusion. » to « oui c'est bon je confirme »)
        text = withoutFalseApology(text, req.toolCtx.customerText);
        // journey J02r-6 (18/11): products still under review are « pas encore en ligne », never « ne font pas partie de nos produits »
        if (req.guard?.awaitingReview) text = withPendingProductWording(text);
        // journey retest R20-4 (18/11): the thanks first, the question last (N7 T1 « … (12500 DA). Merci Yacine. Lequel vous intéresse ? »); one « we
        // don't deliver there » per sentence (N16 « …, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had wilaya, … »)
        text = withoutRepeatedNotServed(withThanksFirst(text));
        // journey retest R17-5 (18/11): a delivery-only question gets no closing offer of the products (F9), nothing deliverable no « something
        // else that reaches you » (N16 Illizi)
        const quoteResults = [...executed, ...reused].filter((t) => canonicalTool(t.name) === 'quote_delivery').map((t) => t.result as { ok?: unknown } | null);
        const saidNow = req.toolCtx.customerText ?? '';
        const deliveryOnly = asksDelivery(saidNow) && !productWanted(saidNow) && !productNamedIn(saidNow, req.guard?.cataloguePrices ?? []);
        text = withoutUnrelatedOffer(text, req.toolCtx.customerText, { deliveryOnly, nothingServed: quoteResults.length > 0 && quoteResults.every((r) => r?.ok !== true) });
        return { ...plain, reply: withPhotoAnswer(output, text) };
      }
      // journey retest R12-4: the lead-in kept before the server recap gets the same narrow wording fixes (N3 T2 « Livraison à domicile »)
      const r = recapReply(withArabicCurrency(withArabiziWords(plain.reply, textLang)), recap, textLang, req.toolCtx.customerText);
      // journey retest R5-5: « twasslou l Constantine ? » is answered in words when no sentence of the model goes before the recap
      // journey retest R20-2 (18/11): with the home and stop-desk fees (this turn's quote, or an earlier turn's reused)
      const answer = r.kept === 'server' ? deliveryAnswer([...reused.map((t) => ({ name: canonicalTool(t.name), result: t.result })), ...calls], req.toolCtx.customerText ?? '', textLang) : null;
      // journey retest R13-5 (18/11): a recap of another product than the out-of-stock one the customer asked for says so first (N5 T2
      // « je le prends » ⇒ the Coffret's recap, the Parfum Oud out of stock)
      const swap = substitutionLine(recap.items, req.toolCtx.customerHistory ?? req.toolCtx.customerText ?? '', req.guard?.unavailableNames ?? [], r.text, textLang, (req.guard?.cataloguePrices ?? []).map((p) => p.name));
      return { ...plain, reply: withPhotoAnswer(output, [swap, answer, r.text].filter(Boolean).join('\n\n')) };
    };
    // journey retest R16-4 (18/11): one space between words, whatever wrote the text (C2 « smahli 3lik  3la had lmochkil »)
    // journey retest R20-4 (18/11): and every amount as `formatMoney` writes it, the model's too (« 6900 DA » ⇒ « 6 900 DA »)
    const confirmed = (output: AiReplyOutput): AiReplyOutput => {
      const done = confirmedText(output);
      // journey re-run J04r-4 (18/11): an MSA customer gets MSA wording — the server's sentences and the darija words left in the reply
      const reply = withSpacedAmounts(withSingleSpaces(done.reply));
      return { ...done, reply: msa && textLang === 'ar' ? withMsaWording(reply) : reply };
    };
    /**
     * journey retest R7-2: a photo request answered with no photo sent and no word about it, while every product of the answer
     * (its cards, else this turn's search / get_product results) is known to have none — the server says so first (N9: the
     * guard's rewrite of a `moroccan_darija` draft had dropped « ma 3andnach tsawer »).
     */
    const withPhotoAnswer = (output: AiReplyOutput, text: string): string => {
      if (!req.guard || !photoAsked(req.toolCtx.customerText ?? '') || noPhotoSaid(text)) return text;
      const f = factsNow(output);
      if (f.photoSent !== false) return text;
      const shown = [...new Set([...(output.productCards ?? []), ...(output.productPhotos ?? [])])];
      const found = executed.flatMap((t) => (['search_products', 'get_product'].includes(canonicalTool(t.name)) ? productIdsOf(t.result) : []));
      const concerned = shown.length ? shown : [...new Set(found)];
      if (!concerned.length || !concerned.every((id) => (f.noPhoto ?? []).includes(id))) return text;
      return noPhotoReply(text, concerned.length, textLang);
    };
    /**
     * journey retest R13-1 (18/11): a reply that sells a product — its product cards, the server recap of this turn, or the name of a
     * product this turn's search / get_product found — never goes out with a handoff the model chose by judgement (`off_catalogue`,
     * `unclear_streak`): F1 T1 « Parfait ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA. Voulez-vous le commander ? »
     * came with « Je transmets à un membre de l'équipe … ». The conversation stays with the AI.
     */
    const sells = (output: AiReplyOutput): boolean => {
      if ((output.productCards ?? []).length || recapNow()) return true;
      const reply = ` ${productWords(output.reply).join(' ')} `;
      const found = executed.flatMap((t) => {
        if (!['search_products', 'get_product'].includes(canonicalTool(t.name))) return [];
        const r = t.result as { products?: { name?: unknown }[]; name?: unknown } | null;
        return [...(Array.isArray(r?.products) ? r.products.map((p) => p?.name) : []), r?.name].filter((n): n is string => typeof n === 'string');
      });
      return found.some((n) => {
        const w = productWords(n);
        return w.length > 0 && reply.includes(` ${w.join(' ')} `);
      });
    };
    const ok = (output: AiReplyOutput, extra: { salvaged?: boolean; guard?: GuardOutcome } = {}): TurnResult => {
      if (forcedHandoff && SELLING_KEEPS_AI.has(forcedHandoff) && sells(output)) {
        forcedHandoff = null;
        handoffRefused ??= 'in_catalogue';
      }
      if (output.status === 'HANDOFF' && !forcedHandoff && SELLING_KEEPS_AI.has(handoffReason(output.statusDetail)) && sells(output)) {
        const { statusDetail: _dropped, evidence: _evidence, ...kept } = output;
        output = { ...kept, status: 'OK' };
        handoffRefused ??= 'in_catalogue';
      }
      return { ok: true, output: confirmed(output), tools: executed, usage, model: model!, usedFallback, forcedHandoff, repaired, ...(handoffRefused ? { handoffRefused } : {}), ...extra };
    };
    // journey 16/11 J03-2: this turn's quote_delivery answers — the reply must give the fee (not checked on a handoff answer)
    const factsNow = (answer?: Pick<AiReplyOutput, 'status' | 'customer'> & Partial<Pick<AiReplyOutput, 'productCards' | 'productPhotos'>>) => {
      const f = withToolResults(req.guard!, executed.map((t) => t.result));
      // journey retest R16-3: a quote of an earlier turn reused this turn owes its fee only when the customer asks about delivery (or names
      // that wilaya: `owedQuotes`) — the model re-quoting a wilaya on its own (PF1 T2) asks the reply for nothing new
      const saidFolded = foldGuard(said ?? '');
      const reusedAsked = asksDelivery(said ?? '')
        ? reused
        : reused.filter((t) => {
            const r = t.result as { wilayaName?: unknown; wilayaNameAr?: unknown } | null;
            return [r?.wilayaName, r?.wilayaNameAr].some((w) => typeof w === 'string' && !!w && saidFolded.includes(foldGuard(w)));
          });
      const quotes = answer?.status === 'HANDOFF' || forcedHandoff ? [] : quoteFacts([...executed.filter((t) => t !== modeQuote), ...reusedAsked].map((t) => ({ name: canonicalTool(t.name), result: t.result })));
      // journey retest R16-1 (18/11): the wilayas this turn's quotes gave as not served at all (a dropped « ma nwasslouch l Illizi » comes back)
      const notServed = answer?.status === 'HANDOFF' || forcedHandoff ? [] : [...new Set([...executed, ...reused].flatMap((t) => {
        const e = (t.result as { error?: { code?: unknown; wilayaName?: unknown; homeAvailable?: unknown } } | null)?.error;
        return canonicalTool(t.name) === 'quote_delivery' && e?.code === 'WILAYA_NOT_SERVED' && e.homeAvailable !== true && typeof e.wilayaName === 'string' ? [e.wilayaName] : [];
      }))];
      // journey retest R2-3: the fields the answer reports as given — the guard checks the reply does not deny them
      const c = answer?.customer;
      const fields = c ? { ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.wilaya ? { wilaya: c.wilaya } : {}), ...(c.commune ? { commune: c.commune } : {}), ...(c.address ? { address: c.address } : {}) } : undefined;
      // journey retest R6-2: whether this answer sends a photo — a card or a gallery of a product not known to have none
      const sent = answer ? [...(answer.productCards ?? []), ...(answer.productPhotos ?? []), ...(f.galleries ?? [])] : null;
      const photoSent = sent ? sent.some((id) => !(f.noPhoto ?? []).includes(id)) : undefined;
      // journey retest R8-1 / R8-2: a tool that really failed; a create_order refused this turn (no recap shown) and the field it asked
      const refusal = refusedOrder(executed) ?? (addressRefused ? { field: 'address', code: 'VALIDATION', argsOnly: false } : null);
      const systemFailure = executed.some((t) => SYSTEM_FAILURES.has(String((t.result as { error?: { code?: unknown } } | null)?.error?.code ?? '')));
      // journey retest R10-2: no recap waiting at all (none this turn, none of an earlier turn still open, no order placed now) — a
      // request to confirm confirms nothing; after a refusal of the product itself, « noté » is a false claim
      const noRecapPending = !refusal && !pendingBefore && !recapNow() && !confirmationNow();
      // journey retest R12-2 (17/11): a recap waits (a bare « c'est noté » to the « oui » is an order claim); the customer's orders
      // were looked up this turn (their status may be told)
      const orderLookedUp = executed.some((t) => canonicalTool(t.name) === 'lookup_order' && ((t.result as { orders?: unknown[] } | null)?.orders?.length ?? 0) > 0);
      return { ...f, ...(req.toolCtx.customerHistory ? { customerHistory: req.toolCtx.customerHistory } : {}), ...(notServed.length ? { notServed } : {}), ...(pendingBefore ? { recapWaiting: true } : {}), ...(orderLookedUp ? { orderLookedUp: true } : {}), ...(quotes.length ? { quotes } : {}), ...(fields ? { customerFields: fields } : {}), ...(photoSent !== undefined ? { photoSent } : {}), ...(systemFailure ? { systemFailure } : {}), ...(refusal ? { orderRefused: true, ...(refusal.field ? { missingField: refusal.field } : {}), ...(PRODUCT_REFUSALS.has(refusal.code) ? { productRefused: true } : {}) } : {}), ...(noRecapPending ? { noRecapPending } : {}) };
    };
    /** The guard's last word: offending sentences dropped / greeting stripped / the safe sentence (never a handoff). */
    const enforce = (base: AiReplyOutput, text: string, violations: GuardViolation[], first: GuardViolation[], retried: boolean, extra: { salvaged?: boolean }): TurnResult => {
      const f = factsNow(base);
      const e = enforceReply(text, violations, f, { hasCards: base.productCards.length > 0 });
      // journey retest R16-1 (18/11): a price / stock answer / not-served wilaya the customer asked for, dropped with a sentence, comes back
      const reply = e.action === 'safe_sentence' || base.status === 'HANDOFF' || forcedHandoff ? e.reply : withAskedFacts(e.reply, base.reply, f, textLang);
      return ok({ ...base, reply }, { ...extra, guard: { violations: slim(first), retried, remaining: slim(violations), action: e.action } });
    };
    /** The corrective turn could not run (provider failure, time): the first answer is enforced rather than lost. */
    const guardFallback = () => (guardFirst ? enforce(guardFirst.output, guardFirst.output.reply, guardFirst.violations, guardFirst.violations, true, guardFirst.extra) : null);
    /** Checks an answer about to be returned: clean ⇒ returned; broken ⇒ one corrective turn when there is room, else enforced. */
    const guarded = (output: AiReplyOutput, extra: { salvaged?: boolean }, canRetry: boolean): TurnResult | 'retry' => {
      // the server's order confirmation replaces the text: nothing of the model's to check
      if (!req.guard || !output.reply.trim() || confirmationNow()) return ok(output, extra);
      // journey retest R1-6: a pending recap — the server's text is always sent (R4-3: never the model's recap); the
      // model's sentence kept before it is checked, and dropped (no corrective turn) when it breaks a rule
      const recap = output.status !== 'HANDOFF' && !forcedHandoff ? recapNow() : null;
      if (recap) {
        const r = recapReply(output.reply, recap, textLang, req.toolCtx.customerText);
        const own = r.kept === 'server' ? '' : output.reply;
        if (!own || !checkReply(own, factsNow(output)).length) return ok(output, extra);
        return ok({ ...output, reply: '' }, extra);
      }
      const violations = checkReply(output.reply, factsNow(output));
      if (!violations.length) return ok(output, extra);
      // a slip the server fixes itself (a Latin letter inside an Arabic word) costs no model turn
      if (canRetry && violations.some((v) => !AUTO_FIX_RULES.includes(v.rule)) && req.deadline - Date.now() > GUARD_RETRY_MIN_MS) {
        guardFirst = { output, extra, violations };
        return 'retry';
      }
      return enforce(output, output.reply, violations, violations, false, extra);
    };
    /**
     * journey retest R17-2: the model's output stayed unreadable while the customer said a plain yes to the recap shown — the stored order
     * is still placed and its confirmation sent (status OK). A provider failure or the time running out is left as it was: the job's retry
     * replays the stored tool results (AT-AI-05), and the same yes places the order on that retry.
     */
    const placedOnFailure = async (): Promise<TurnResult | null> => {
      if (!yesOrder || !model) return null;
      if (!confirmationNow()) await placeYes().catch(() => null);
      return confirmationNow() ? ok(serverOutput()) : null;
    };
    /**
     * journey retest R19-1 (18/11): the reply of this turn is now entirely the server's — the order placed (its confirmation), a blocked
     * customer (the R4-8 sentence), or the server recap of this turn while the customer's message asks nothing the server does not answer
     * itself (no question, or one delivery question to the recap's place: `deliveryAnswer`). No further model call: its text would be
     * replaced. 20 of R19's 27 calls to a tool not offered came right after a recap / confirming create_order (a 2nd and a 3rd model call
     * for a « oui »: 3.5–8.4 s), and every format retry after a placing create_order (PF1b T4, N21 T5, F5 T3).
     */
    const serverDone = (): boolean => {
      if (!model) return false;
      const calls = executed.map((t) => ({ name: canonicalTool(t.name), result: t.result }));
      if (confirmationNow() || blockedOrderText(calls, textLang)) return true;
      // (nor when the message carries a request only the team answers — a person, a refund, a complaint, a keyword: the model's answer decides)
      // Houssem live 24/11 (R1 « je veux changer l'adresse de ma commande CMD-1021 : … »: 4 model calls, 6.2 s, 47 000 input tokens — the recap
      // of the replacing order came from the 1st call, then a 2nd create_order (not offered), a lookup_order and a text nobody reads): a
      // change of an order is « customer_request » for the handoff judge, but once the recap of the order that replaces it is there the
      // request is answered — unless the message asks for the team itself
      const recap = recapNow();
      const changeAnswered = !!recap?.replaces && !asksTeam(said ?? '');
      if (forcedHandoff || !recap || reasons.some((r) => TEAM_REASONS.has(r) && !(changeAnswered && r === 'customer_request'))) return false;
      const t = said ?? '';
      if (photoAsked(t)) return false;
      if (!asksSomething(t)) return true;
      return asksDelivery(t) && (t.match(/[?؟]/gu) ?? []).length <= 1 && !!deliveryAnswer(calls, t, textLang);
    };
    /**
     * journey retest R20-2 (18/11): a delivery question answered with this turn's recap gets both fees — when no quote of the recap's wilaya was
     * made (nor one of an earlier turn reused), the server quotes it (no model call; an earlier turn's still valid quote is reused): the recap
     * gives the fee of its own mode only (R6 F5 « vous livrez à Bab Ezzouar ? » ⇒ the stop-desk fee unknown).
     */
    const recapQuote = async (): Promise<void> => {
      if (!recapNow() || said === undefined || !asksDelivery(said)) return;
      const wilayaId = Number([...executed].reverse().find((t) => canonicalTool(t.name) === 'create_order')?.args?.wilayaId);
      if (!Number.isInteger(wilayaId) || wilayaId <= 0) return;
      const quoted = [...executed, ...reused].some((t) => canonicalTool(t.name) === 'quote_delivery' && (t.result as { ok?: unknown } | null)?.ok === true && (Number((t.result as { wilayaId?: unknown }).wilayaId) === wilayaId || Number(t.args?.wilayaId) === wilayaId));
      if (quoted) return;
      const call: AiToolCallRequest = { id: 'server-recap-quote', name: 'quote_delivery', args: { wilayaId } };
      const earlier = earlierQuoteAnswered(call, knownQuotes);
      if (earlier) {
        reused.push({ callId: 'earlier-quote:recap', name: call.name, args: call.args, result: earlier, simulated: false, replayed: true });
        return;
      }
      const hash = toolCallId(call.name, call.args, 0);
      const ordinal = seen.get(hash) ?? 0;
      seen.set(hash, ordinal + 1);
      const done = await this.toolCall(req, call, ordinal, executed).catch(() => null);
      if (!done) return;
      executed.push(done);
      answered.set(sameCallKey(call.name, call.args), done.result);
    };
    /** journey retest R19-1: the answer of a turn the server ends alone — status OK, the order's details from the turn's create_order. */
    const serverOutput = (reply = ''): AiReplyOutput => {
      const a = [...executed].reverse().find((t) => canonicalTool(t.name) === 'create_order')?.args ?? {};
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const customer = Object.fromEntries(Object.entries({ name: str(a.clientName), phone: str(a.clientPhone), commune: str(a.communeName), address: str(a.address) }).filter(([, v]) => !!v)) as AiReplyOutput['customer'];
      const items = (Array.isArray(a.items) ? a.items : []).filter((i): i is { productId: string; variantId?: string; quantity?: number } => !!i && typeof i === 'object' && typeof (i as { productId?: unknown }).productId === 'string');
      return { reply, status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 1, ...(customer && Object.keys(customer).length ? { customer } : {}), ...(items.length ? { cart: { items: items.map((i) => ({ productId: i.productId, ...(typeof i.variantId === 'string' ? { variantId: i.variantId } : {}), ...(i.quantity !== undefined ? { quantity: i.quantity } : {}) })) } } : {}) };
    };
    // journey retest R19-1 (18/11): a plain yes to the server recap the AI's last message showed — the server places that recap's stored order
    // before any model call and its confirmation is the reply: no model call at all (R19: 2–3 calls, 3.5–8.4 s for each « oui »). A refusal
    // of the order (stock, product) is answered by the model in the same turn; no route to name the run's model ⇒ the model loop as before.
    /** journey re-run J03r-1: the answer of a turn handed to the team for the order limit (its text is the server's limit sentence). */
    const limitOutput = (): AiReplyOutput => ({ reply: '', status: 'HANDOFF', statusDetail: 'order_limits', intent: 'SALE', productCards: [], recommendations: [], confidence: 1 });
    // journey re-run J03r-1 (18/11, Major): a message asking for more pieces than « Quantité max par commande » (« Je veux 6 tapis de prière … »,
    // « 500 pièces de votre premier produit ») is handed to the team before any model call, with the sentence naming the limit — the model
    // cut the quantity to the maximum and sent a recap of 5, or asked « jusqu'à 5 ? ». The number must count pieces or be followed by a
    // product of the shop (the catalogue's own check): an address number, a size, a price or a phone never counts.
    const maxQty = req.toolCtx.agent.maxQtyPerOrder ?? null;
    // (not on a request only the team can quote — « prix de gros pour 50 pièces » keeps its wholesale sentence, R16-2)
    // journey retest R22-1 (18/11, Major): and a bare quantity (« nheb 7 », « 7 », « je prends 7 ») while a product is being sold — the AI's
    // last message names / prices it, the customer chose one, or named one (Q3 / Q3c « nheb 7 » after « Djellaba homme b 7 500 DA … T7ebb
    // nsajjel lek wahda ? » ⇒ « Saha, nsajjel lek 7 djellaba homme »)
    const overQty = said !== undefined && maxQty !== null && !teamOnlyKind(said)
      ? await quantityAbove(said, maxQty, async (words) => !!productNamedIn(words, req.guard?.cataloguePrices ?? []) || (typeof this.tools.soldProductNamed === 'function' && !!(await this.tools.soldProductNamed(req.toolCtx.agent, words).catch(() => null))), this.quantityContext(req, lastAiText))
      : null;
    if (overQty !== null && maxQty !== null && !forcedHandoff) {
      forcedHandoff = 'order_limits';
      messageLimit = { kind: 'quantity', value: maxQty };
      const m = await this.serverModel();
      if (m) {
        model = m;
        return ok(limitOutput());
      }
    }
    // journey re-run J04r-2 (18/11, Major): « elle est bien annulée ? » right after the cancellation the server made — its answer, with no model
    // call (C6 T11 / R1 T6: `lookup_order {}` ⇒ nothing, `cancel_order` ⇒ NO_OPEN_ORDER, then « je ne peux pas confirmer … ma réponse
    // précédente était trop rapide … je vais vérifier avec l'équipe »)
    const cancelledNow = said !== undefined && !forcedHandoff && cancelledAsked(said) ? lastCancelled(req.toolCtx.orderHistory) : null;
    if (cancelledNow) {
      const m = await this.serverModel();
      if (m) {
        model = m;
        return ok({ ...serverOutput(cancelledReply(cancelledNow, textLang)), intent: 'TRACKING' });
      }
    }
    if (yesOrder && !forcedHandoff) {
      const m = await this.serverModel();
      if (m) {
        model = m;
        const yes = await placeYes();
        if (yes && serverDone()) return ok(serverOutput());
        if (yes) messages.push({ role: 'assistant', content: '', toolCalls: [yes.call] }, { role: 'tool', toolCallId: yes.call.id, name: yes.call.name, result: yes.done.result });
      }
    }
    // journey retest R20-3 (18/11): a plain yes to a question offering two products or more — one short « which one? », no model call
    if (choiceNames && !forcedHandoff) {
      const m = await this.serverModel();
      if (m) {
        model = m;
        return ok(serverOutput(choiceQuestion(choiceNames, textLang)));
      }
    }
    // journey retest R20-1 (18/11): a round whose calls were all product / stock lookups answered from what the turn already has (nothing ran) —
    // the next steps offer no lookup tool (N5 T1: `search_products` ran, then `get_product` ×2 of the product it returned, a model call each,
    // 11.5 s; A3 T1 `check_availability`, then two searches); and once this turn's searches returned only products the CATALOGUE lists (no photo
    // asked), get_product is not offered (it could only repeat them)
    let infoDone = false;
    const searchedListed = (): boolean => {
      const listed = req.guard?.catalogueIds ?? [];
      if (!catalogueLookup || !listed.length) return false;
      const searches = executed.filter((t) => canonicalTool(t.name) === 'search_products');
      return searches.length > 0 && searches.every((t) => productIdsOf(t.result).every((id) => listed.includes(id)));
    };
    const infoRound = (calls: readonly AiToolCallRequest[], ranBefore: number) => {
      if (executed.length === ranBefore && calls.length > 0 && calls.every((c) => INFO_TOOLS.has(canonicalTool(c.name)))) infoDone = true;
    };
    // journey retest R11-5: one more step than the loop's own when the plain-text step is asked
    for (let step = 0; step < MAX_STEPS + 1 + (plainAsked ? 1 : 0); step++) {
      const left = req.deadline - Date.now();
      if (left <= 0) return guardFallback() ?? { ok: false, kind: 'provider', error: 'timeout', tools: executed, usage, model, usedFallback };
      // the corrective turn of the guard is offered no tool: an order or a cancellation is never done twice
      // full-test 15/11 AI-CHAT-02: nor the format retry — it only re-writes the answer (it cancelled the order it had just created)
      // full-test 15/11 proposal 13: a message that is only an order field gets 2 tool rounds at most (10–21 s turns)
      const offerTools = toolRounds < (fieldOnly ? 2 : MAX_STEPS - 1) && !forcedHandoff && !guardFirst && !repaired && !noToolsNext;
      // journey retest R12-3 (17/11): once create_order placed the order in this turn, lookup_order is not offered either (F6 T3, F3 T4
      // looked up the order they had just placed: `{orders: []}`)
      const placedNow = orderClosed && !!confirmationNow();
      // journey retest R22-2 (18/11): once a quote_delivery of this turn was refused for naming no wilaya, it is not offered again (A3 T1
      // `quote_delivery {}` ⇒ VALIDATION, then the same call again: a 3rd model call, 2.7 s, for nothing)
      const noWilayaQuote = executed.some((t) => canonicalTool(t.name) === 'quote_delivery' && (t.result as { error?: { code?: unknown; field?: unknown } } | null)?.error?.code === 'VALIDATION' && (t.result as { error: { field?: unknown } }).error.field === 'wilayaName');
      const stepDefs = (orderClosed ? defs.filter((d) => d.name !== 'create_order' && !(placedNow && d.name === 'lookup_order')) : defs).filter((d) => !(infoDone && INFO_TOOLS.has(d.name)) && !(d.name === 'get_product' && searchedListed()) && !(noWilayaQuote && d.name === 'quote_delivery'));
      let res;
      if (steps.length) steps[steps.length - 1]!.next = AiRunService.nextReason(messages[messages.length - 1]);
      const stepStart = Date.now();
      try {
        res = await this.routing.call(
          'text',
          (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose: 'reply', system, ...(req.prompt.cachePrefix ? { systemCachePrefix: req.prompt.cachePrefix } : {}), messages, tools: offerTools ? stepDefs : undefined, ...(offerTools ? { allTools: allDefs } : {}), temperature: req.temperature, maxTokens: req.maxTokens, timeoutMs: Math.max(1000, Math.min(timeoutMs, left)) }),
          { only: (m) => m.supportsTools, prefer: model?.id },
        );
      } catch (e) {
        if (e instanceof AiProviderError) return guardFallback() ?? { ok: false, kind: 'provider', error: providerErrorLabel(e), tools: executed, usage, model, usedFallback };
        throw e;
      }
      steps.push({ ms: Date.now() - stepStart, ...(res.value.toolCalls.length ? { calls: res.value.toolCalls.map((c) => canonicalTool(c.name)) } : {}), ...(res.value.cache ? { cacheRead: res.value.cache.read, cacheWrite: res.value.cache.write } : {}), outTok: res.value.usage.outputTokens });
      model = res.model;
      usedFallback ||= res.usedFallback;
      usage.inputTokens += res.value.usage.inputTokens;
      usage.outputTokens += res.value.usage.outputTokens;

      // journey retest R1-1: a call to a tool this step did not offer is never run — the model is told and answers
      const offered = new Set(stepDefs.map((d) => d.name));
      // journey retest R20-1 (18/11): a search for a placeholder (A3 T1 `search_products {«noop»}`, run) is a call to no tool either
      const stray = offerTools ? [...(res.value.rejectedToolCalls ?? []), ...res.value.toolCalls.filter((c) => !offered.has(canonicalTool(c.name)) || placeholderCall(c) || (canonicalTool(c.name) === 'handoff_to_human' && typeof c.args?.reason === 'string' && !reasons.includes(c.args.reason)))] : [];
      if (stray.length) steps[steps.length - 1]!.stray = stray.map((c) => canonicalTool(c.name));
      // journey retest R19-1 (18/11): the reply a stray step answers with itself — its own readable text, else (a create_order this message
      // cannot make yet, a message asking nothing) the server's question for the field that is missing
      let serverReply: AiReplyOutput | null = null;
      let serverWrote = false;
      if (stray.length) {
        toolRounds++;
        const runnable = res.value.toolCalls.filter((c) => offered.has(canonicalTool(c.name)) && !placeholderCall(c));
        const ranBefore = executed.length;
        if (runnable.length) messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: runnable });
        else messages.push({ role: 'assistant', content: [res.value.text, ...stray.map((c) => `[tool call ${c.name} ${JSON.stringify(c.args ?? {})}]`)].filter(Boolean).join('\n') });
        for (const call of runnable) {
          const hash = toolCallId(call.name, call.args, 0);
          const key = sameCallKey(call.name, call.args);
          if (answered.has(key)) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(answered.get(key)) });
            continue;
          }
          // journey retest R10-3: a search for a product this turn already returned is answered with it (F1 T1, N12 T1)
          // journey retest R11-3: on a field message, nor one for a product the CATALOGUE lists (N21 T2 / T3)
          // journey retest R13-4: nor one for a product the recap create_order returned in this turn already holds (A3 T2, F6 T1)
          // journey retest R14-3: nor a get_product / check_availability this turn's search already answers (N9 T1, N5 T1, F1d T1, N25 T2)
          // journey retest R15-3: nor a get_product of a CATALOGUE product (N4 T1), nor a second quote of a wilaya quoted this turn (F1b T2, N16 T1)
          const known = knownAnswer(call, runnable);
          if (known) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: known });
            continue;
          }
          const place = await placeSearch(call);
          if (place) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: placeSearchResult(place) });
            continue;
          }
          // journey re-run J03r-1 (18/11): once the order limit was hit this turn, no create_order runs again (the model re-sent `{5}` for « 6 »)
          if (forcedHandoff === 'order_limits' && canonicalTool(call.name) === 'create_order') {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(executed.find((t) => canonicalTool(t.name) === 'create_order' && orderLimitOf(t.result))?.result ?? { ok: false, hint: 'order_limit' }) });
            continue;
          }
          // journey retest R17-6: a create_order with no address (nor the stop-desk) while the customer gave none is not run
          const noStreetCall = addressLess(call);
          if (noStreetCall) {
            addressRefused = true;
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: noStreetCall });
            continue;
          }
          // journey retest R17-2: on a plain yes to the recap shown, the model's create_order places that recap's stored order
          // journey retest R18-3: a lookup by the customer's own phone after an order of this conversation looks up that order's number
          const run = yesCall(lookupByNumber(call, req.toolCtx.orderHistory, req.toolCtx.customerHistory));
          const runHash = run === call ? hash : toolCallId(run.name, run.args, 0);
          const ordinal = seen.get(runHash) ?? 0;
          seen.set(runHash, ordinal + 1);
          const done = await this.toolCall(req, run, ordinal, executed);
          executed.push(done);
          answered.set(key, done.result);
          // journey retest R19-1: the call that ran (a lookup by the order number) answers the same call sent again
          if (run !== call) answered.set(sameCallKey(run.name, run.args), done.result);
          orderClosed ||= orderClosedBy(run.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(run.name, run.args, done.result);
        }
        // journey retest R19-1 (18/11): a tool not offered is answered by the server in this same step when it can — the turn's text is the
        // server's already (an order placed, a recap with nothing else asked: `serverDone`), or the step's own text is a readable answer, or
        // the call is a create_order this message cannot make yet (a missing wilaya / street) on a message that asks nothing: the field's
        // question, with the price and the fees the server adds (PG2 T2 5.1 s + 4.3 s, PG1b T2, N4 T3 — a second model call for that question)
        infoRound(runnable, ranBefore);
        // journey re-run J03r-1: the order limit was hit — the turn is the team's, with the limit sentence and no further model call
        if (forcedHandoff === 'order_limits') return ok(limitOutput());
        if (serverDone()) {
          await recapQuote();
          return ok(serverOutput());
        }
        const own = runnable.length ? null : parseReplyOutput(res.value.text ?? '');
        // journey retest R20-1 (18/11): a call to a tool that does not exist (« dummy », « noop » — PG2 T2 13.5 s: the call, then the answer, then a
        // guard retry; N21 T3, F1b T2) is answered by the server in this same step like R19's create_order one — the field still missing, once a
        // phone was given (the name is asked before it), on a message asking nothing
        let madeUp = !own?.ok && !runnable.length && stray.every((c) => !(canonicalTool(c.name) in TOOL_DEFS) || placeholderCall(c));
        // (a message wanting a product: only when the server knows which one, in stock — its card and its price go with the question; the
        // catalogue's own check reads the product's keywords, « جلابة » for « Djellaba homme »)
        let wanted: string | null = null;
        if (madeUp && said !== undefined && req.guard) {
          const prices = req.guard.cataloguePrices ?? [];
          wanted = productNamedIn(said, prices)?.id ?? null;
          if (!wanted && productWanted(said) && typeof this.tools.soldProductNamed === 'function') {
            const name = await this.tools.soldProductNamed(req.toolCtx.agent, said).catch(() => null);
            wanted = prices.find((p) => p.name === name)?.id ?? null;
          }
          const gone0 = new Set(req.guard.unavailableNames ?? []);
          if (productWanted(said) && !prices.some((p) => p.id === wanted && !gone0.has(p.name))) madeUp = false;
        }
        if (own?.ok) serverReply = own.value;
        else if (!runnable.length && (madeUp || (stray.every((c) => canonicalTool(c.name) === 'create_order') && stray.some((c) => nameWritten(c.args?.clientName, req.toolCtx.customerHistory ?? said ?? '')))) && !noPhone && !takesGone && (noPlace || noStreet || noAddressHere) && said !== undefined && !asksSomething(said) && !photoAsked(said) && req.guard) {
          // (the product of the call's items, else the one the message names, is shown as its card — the price line follows it)
          const prices = req.guard.cataloguePrices ?? [];
          const gone = new Set(req.guard.unavailableNames ?? []);
          const asked = stray.flatMap((c) => (Array.isArray(c.args?.items) ? (c.args.items as { productId?: unknown }[]).map((i) => i?.productId) : [])).filter((id): id is string => typeof id === 'string');
          const named = wanted ?? productNamedIn(said, prices)?.id;
          const card = [...new Set([...asked, ...(named ? [named] : [])])].filter((id) => prices.some((p) => p.id === id && !gone.has(p.name))).slice(0, 1);
          serverWrote = true;
          serverReply = { reply: FIELD_QUESTIONS[noPlace ? 'wilayaId' : 'address']![textLang], status: 'OK', intent: 'SALE', productCards: card, recommendations: [], confidence: 1 };
        }
        if (!serverReply) {
          messages.push({ role: 'user', content: stray.map((c) => `[tool result ${c.name}] ${JSON.stringify(unavailableTool(c.name, noHandoff, noPhone, noPlace, noStreet, noAddressHere, takesGone))}`).join('\n') });
          if (!runnable.length && stray.every((c) => !(canonicalTool(c.name) in TOOL_DEFS))) noToolsNext = true;
          continue;
        }
      }
      // Houssem live 24/11 (H-07 11:58 « montre-moi le QA 23/11 photos »: 4 model calls, 15 s — the complete answer came WITH the 1st
      // step's get_product, then twice more with the same call): a step that already carries its answer and only asks get_product for
      // products the prompt's CATALOGUE describes gains nothing from running it (name, price, stock word and variants are in the prompt,
      // the photos go out with productCards / productPhotos) — the answer is taken as it is, the calls are not run.
      const answerInHand = ((): boolean => {
        if (serverReply || !offerTools || stray.length || !res.value.toolCalls.length) return false;
        const listed = new Set(req.guard?.catalogueIds ?? []);
        if (!listed.size || !res.value.toolCalls.every((c) => canonicalTool(c.name) === 'get_product' && typeof c.args?.productId === 'string' && listed.has(c.args.productId))) return false;
        const own = parseReplyOutput(res.value.text ?? '');
        return own.ok && own.value.status === 'OK' && own.value.reply.trim().length > 0;
      })();
      if (answerInHand) steps[steps.length - 1]!.next = 'answer_in_hand';
      if (!serverReply && res.value.toolCalls.length && offerTools && !answerInHand) {
        toolRounds++;
        const calls = res.value.toolCalls;
        messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: calls });
        const ranBefore = executed.length;
        for (const call of calls) {
          const hash = toolCallId(call.name, call.args, 0);
          const key = sameCallKey(call.name, call.args);
          if (answered.has(key)) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(answered.get(key)) });
            continue;
          }
          // journey retest R10-3: a search for a product this turn already returned is answered with it (F1 T1, N12 T1)
          // journey retest R11-3: on a field message, nor one for a product the CATALOGUE lists (N21 T2 / T3)
          // journey retest R13-4: nor one for a product the recap create_order returned in this turn already holds (A3 T2, F6 T1)
          // journey retest R14-3: nor a get_product / check_availability this turn's search already answers (N9 T1, N5 T1, F1d T1, N25 T2)
          // journey retest R15-3: nor a get_product of a CATALOGUE product (N4 T1), nor a second quote of a wilaya quoted this turn (F1b T2, N16 T1)
          const known = knownAnswer(call, calls);
          if (known) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: known });
            continue;
          }
          const place = await placeSearch(call);
          if (place) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: placeSearchResult(place) });
            continue;
          }
          // journey re-run J03r-1 (18/11): once the order limit was hit this turn, no create_order runs again (the model re-sent `{5}` for « 6 »)
          if (forcedHandoff === 'order_limits' && canonicalTool(call.name) === 'create_order') {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: repeatedCall(executed.find((t) => canonicalTool(t.name) === 'create_order' && orderLimitOf(t.result))?.result ?? { ok: false, hint: 'order_limit' }) });
            continue;
          }
          // journey retest R17-6: a create_order with no address (nor the stop-desk) while the customer gave none is not run
          const noStreetCall = addressLess(call);
          if (noStreetCall) {
            addressRefused = true;
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: noStreetCall });
            continue;
          }
          // journey retest R17-2: on a plain yes to the recap shown, the model's create_order places that recap's stored order
          // journey retest R18-3: a lookup by the customer's own phone after an order of this conversation looks up that order's number
          const run = yesCall(lookupByNumber(call, req.toolCtx.orderHistory, req.toolCtx.customerHistory));
          const runHash = run === call ? hash : toolCallId(run.name, run.args, 0);
          const ordinal = seen.get(runHash) ?? 0;
          seen.set(runHash, ordinal + 1);
          const done = await this.toolCall(req, run, ordinal, executed);
          executed.push(done);
          answered.set(key, done.result);
          // journey retest R19-1: the call that ran (a lookup by the order number) answers the same call sent again
          if (run !== call) answered.set(sameCallKey(run.name, run.args), done.result);
          orderClosed ||= orderClosedBy(run.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(run.name, run.args, done.result);
        }
        infoRound(calls, ranBefore);
        // journey re-run J03r-1: the order limit was hit — the turn is the team's, with the limit sentence and no further model call
        if (forcedHandoff === 'order_limits') return ok(limitOutput());
        // journey retest R19-1 (18/11): the order placed, or the recap with nothing else asked — the reply is the server's: no model call
        if (serverDone()) {
          await recapQuote();
          return ok(serverOutput());
        }
        continue;
      }
      const parsedRaw: ReturnType<typeof parseReplyOutput> = serverReply ? { ok: true, value: serverReply } : parseReplyOutput(res.value.text);
      // Houssem live 23/11 (UX-066, H-07 Messenger): on a long Messenger thread the model often writes its answer as plain text (no
      // JSON, `steps[].bad` « no_json: … »): the format retry cost a second model call (+1.1–4 s) for the same sentence. A plain
      // message of a turn that touched no order is sent as it is (status OK, no card — the guard still checks it)
      const plainFirst = !parsedRaw.ok && !serverReply && !guardFirst && !repaired && parsedRaw.reason === 'no_json' && !executed.some((e) => ORDER_TOOL_NAMES.has(e.name)) ? salvageReply(res.value.text) : null;
      if (plainFirst) steps[steps.length - 1]!.bad = `plain_used: ${(res.value.text ?? '').slice(0, 80)}`;
      const parsed: ReturnType<typeof parseReplyOutput> = plainFirst ? { ok: true, value: { ...plainFirst, intent: 'OTHER' } } : parsedRaw;
      if (guardFirst) {
        // the corrective answer: only its text is taken — status, cards, handoff and every other field stay the first answer's
        const { output: first, extra, violations } = guardFirst;
        const rewritten = (parsed.ok ? parsed.value.reply : (salvageReply(res.value.text)?.reply ?? '')).trim();
        if (!rewritten) return enforce(first, first.reply, violations, violations, true, extra);
        const again = checkReply(rewritten, factsNow(first));
        if (!again.length) return ok({ ...first, reply: first.status === 'HANDOFF' || forcedHandoff ? rewritten : withAskedFacts(rewritten, first.reply, factsNow(first), textLang) }, { ...extra, guard: { violations: slim(violations), retried: true, remaining: [], action: 'rewritten' } });
        return enforce(first, rewritten, again, violations, true, extra);
      }
      const retryOrDone = (r: TurnResult | 'retry'): TurnResult | null => {
        if (r !== 'retry') return r;
        messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: guardInstruction(guardFirst!.violations, factsNow(guardFirst!.output)) });
        return null;
      };
      if (parsed.ok) {
        // journey retest R20-2: a delivery question answered with this turn's recap gets both fees
        await recapQuote();
        // journey retest R17-2 (18/11, Major): a plain yes to the recap shown, answered with no create_order (N5 T3 « … confirmez-vous la
        // commande du Coffret cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider. ») — the server places that
        // recap's stored order now; its confirmation replaces the model's text. A refusal of the order (stock, product) goes back to the
        // model, which answers it in the same turn; a blocked customer gets the server's sentence.
        const yes = await placeYes();
        if (yes && !confirmationNow() && !forcedHandoff && step < MAX_STEPS) {
          messages.push({ role: 'assistant', content: '', toolCalls: [yes.call] }, { role: 'tool', toolCallId: yes.call.id, name: yes.call.name, result: yes.done.result });
          continue;
        }
        if (confirmationNow() && parsed.value.status === 'HANDOFF' && !forcedHandoff) {
          const { statusDetail: _dropped, evidence: _evidence, ...kept } = parsed.value;
          parsed.value = { ...kept, status: 'OK' };
        }
        // journey retest R7-5 (17/11): « Vous livrez à Blida ? » answered from the delivery policy text alone (« Oui, on livre à
        // Blida … en 2 à 5 jours ») — the server runs quote_delivery for the wilaya the question names, so the guard's fee_missing
        // rule applies to this answer (one corrective turn, then the fee sentence) as when the model called it
        if (!serverQuoted && parsed.value.status !== 'HANDOFF' && !forcedHandoff && !recapNow() && !confirmationNow()) {
          serverQuoted = true;
          await this.deliveryQuote(req, executed, seen, answered, knownQuotes, reused);
          // journey retest R14-2 (18/11): the question « home or stop-desk? » (the model's, or the server's address question after a
          // create_order refused for the address) carries both fees — F1b T2 « Sétif, El Eulma » ⇒ « … à domicile … ou au stop-desk ? »
          // with no fee and no quote_delivery: the server quotes the wilaya the customer named (that quote is no delivery question:
          // it is kept out of the guard's fee rule) and `withModeFees` writes the fees before the question
          if (![...executed, ...reused].some((t) => canonicalTool(t.name) === 'quote_delivery') && (modeQuestionAt(parsed.value.reply) >= 0 || refusedOrder(executed)?.field === 'address' || addressRefused)) {
            modeQuote = await this.modeQuote(req, executed, seen, answered, knownQuotes);
            if (modeQuote) parsed.value.reply = withModeFees(parsed.value.reply, quoteFacts([{ name: 'quote_delivery', result: modeQuote.result }]), textLang);
          }
          // journey retest R15-1 (18/11): the customer named a place this message (F5 T1 « …, wilaya Alger, Bab Ezzouar ») and no quote of
          // it exists yet in the conversation — the model asked the street with no price, no fee and no stop-desk: the server quotes that
          // wilaya (kept out of the guard's fee rule, as R14-2's) and the reply carries the product's price and both fees. Only when the
          // reply asks the address or the message names a catalogue product (an order is being taken), never on a not-served wilaya.
          // journey retest R18-1 (18/11): and on any message naming a place no turn quoted yet — a first message, a greeting with the place,
          // a field answer, whatever the reply asks (PF1 / PG1 / PG2 T1 « Bonjour, j'habite à Sétif, El Eulma » ⇒ « … Qu'est-ce qui vous
          // intéresse aujourd'hui ? », no fee: the R15-1 step needed a product named or an address question) — not on a question about an
          // order already made; a wilaya that is not served gets « not delivered there »
          if (![...executed, ...reused].some((t) => canonicalTool(t.name) === 'quote_delivery')) {
            const product = this.placeProductOf(req, parsed.value);
            // (nor on a wish for a product the CATALOGUE does not name, with no card shown — N7 T1 « vous avez des lunettes de soleil ? Je suis
            // Yacine …, Blida, Boufarik, … »: nothing can be ordered yet)
            const unsoldAsk = !!said && (productWanted(said) || productAsk(said, said)) && !asksDelivery(said) && !productNamedIn(said, req.guard?.cataloguePrices ?? []) && !(parsed.value.productCards ?? []).length;
            const placeHere = placeQuoteMessage(said) && !unsoldAsk && !executed.some((t) => ['lookup_order', 'cancel_order'].includes(canonicalTool(t.name)));
            // (the product's amount, when the message names one, decides the free threshold: the quote is that order's)
            const cartItems = parsed.value.cart?.items ?? [];
            const qty = cartItems.length === 1 ? Math.max(1, Number(cartItems[0]!.quantity) || 1) : 1;
            const quoted = product || asksAddress(parsed.value.reply) || placeHere ? await this.placeQuote(req, executed, seen, answered, product ? product.price * qty : undefined) : null;
            const notServed = quoted ? notServedOf(quoted.result) : null;
            if (quoted && (quoted.result as { ok?: unknown } | null)?.ok === true) {
              modeQuote = placeQuote = quoted;
              placeProduct = product;
              parsed.value.reply = withPlaceFacts(parsed.value.reply, quoteFacts([{ name: 'quote_delivery', result: quoted.result }]), product, textLang, { homeOnly: streetGiven });
            } else if (quoted && notServed) {
              modeQuote = placeQuote = quoted;
              const w = (await placeIndex().catch(() => null))?.wilayas.find((x) => x.id === notServed.id);
              placeNotServed = { fr: notServed.name, ...(w?.nameAr ? { ar: w.nameAr } : {}) };
              parsed.value.reply = withNotServed(parsed.value.reply, placeNotServed, textLang);
            }
          }
        }
        // journey retest R10-2 (17/11): an answer that asks the customer to confirm while no server recap waits (N5 T3 « Pour
        // confirmer : vous voulez bien le Coffret … ? ») is sent back once with the tools still offered — create_order gives the
        // recap the customer confirms (or the missing field is asked); a second such answer goes through the reply guard
        // journey retest R11-1 (17/11): also after a create_order refused for its arguments only (`items` that could not be read,
        // F1b T3) while create_order is still offered — never after a refusal of the product (stock) or a field to ask
        // journey retest R12-2 (17/11): also an answer that says the order is registered while none was created (« ممتاز، سجلتلك الطلب »,
        // N18 T2) — and, when the customer said yes to a recap that waits and create_order was not called, it is called now
        const canAskAgain = !confirmAsked && !!req.guard && parsed.value.status !== 'HANDOFF' && !forcedHandoff && step < MAX_STEPS && !recapNow() && !confirmationNow() && !orderClosed && defs.some((d) => d.name === 'create_order') && toolRounds < (fieldOnly ? 2 : MAX_STEPS - 1);
        const claims = canAskAgain ? orderClaimsIn(splitSentences(parsed.value.reply), factsNow(parsed.value)).length > 0 : false;
        if (canAskAgain && !pendingBefore && (refusedOrder(executed)?.argsOnly ?? !addressRefused) && (claims || splitSentences(parsed.value.reply).some(confirmRequest))) {
          confirmAsked = true;
          messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: CONFIRM_WITHOUT_RECAP_NOTE });
          continue;
        }
        if (canAskAgain && pendingBefore && claims && confirmation(req.toolCtx.customerText ?? '') === 'yes' && !executed.some((t) => canonicalTool(t.name) === 'create_order')) {
          confirmAsked = true;
          messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: YES_WITHOUT_ORDER_NOTE });
          continue;
        }
        // retest 12/11: `status = HANDOFF` is checked like the tool (handoff-judge) — the customer's words of this turn must
        // ask for it. Refused ⇒ the model is told why and answers (once); insisting with a reply ⇒ that reply is sent and the
        // conversation stays with the AI; insisting with nothing to send ⇒ the handoff goes through (silence would be worse)
        const out = parsed.value;
        const ctx = req.toolCtx;
        // journey retest R13-1 (18/11): `off_catalogue` is checked against the shop's catalogue (the server's own check) as on the tool
        const judged = out.status === 'HANDOFF' && !forcedHandoff && ctx.customerText !== undefined;
        const soldNamed = judged && handoffReason(out.statusDetail) === 'off_catalogue' && typeof this.tools.soldProductNamed === 'function' ? await this.tools.soldProductNamed(ctx.agent, ctx.customerText!) : null;
        // journey retest R17-1 (18/11): and only with product words once the place names are taken out (PF1 T1, as on the tool)
        const productWordsLeft = judged && !soldNamed && handoffReason(out.statusDetail) === 'off_catalogue' ? await offCatalogueWordsOf(ctx.customerText!) : undefined;
        const verdict = judged ? judgeHandoff({ reason: out.statusDetail, evidence: out.evidence, customerText: ctx.customerText!, shopRules: ctx.agent.humanHandoffRules, keywords: ctx.agent.handoffKeywords, unclearStreak: ctx.unclearStreak, established: establishedReasons(executed.map((t) => t.result)), soldNamed, ...(productWordsLeft ? { productWordsLeft } : {}) }) : null;
        if (verdict && !verdict.ok) {
          handoffRefused = verdict.why;
          if (!handoffAsked && step < MAX_STEPS) {
            handoffAsked = true;
            messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: handoffRefusedInstruction(verdict.why, soldNamed) });
            continue;
          }
          if (out.reply.trim()) {
            const { statusDetail: _dropped, evidence: _evidence, ...kept } = out;
            const done = retryOrDone(guarded({ ...kept, status: 'OK' }, {}, step < MAX_STEPS));
            if (done) return done;
            continue;
          }
        }
        // §4.3: the text is checked before it leaves (one corrective turn when there is a step left)
        // (the server's own question of a stray step is checked with no corrective turn)
        const done = retryOrDone(guarded(out, {}, step < MAX_STEPS && !serverWrote));
        if (done) return done;
        continue;
      }
      if (repaired) {
        // tester report 26/10: the first answer, when it is a plain message to the customer, is sent rather than the
        // conversation handed to the team in silence (F-6 only when there is nothing to send)
        const salvaged = salvageReply(firstAnswer) ?? salvageReply(res.value.text);
        // §4.3: no corrective turn after a format retry — the guard's last word applies at once
        if (salvaged) {
          // journey retest R17-2: a plain yes to the recap shown places its stored order (the confirmation replaces the text)
          await placeYes();
          return guarded(salvaged, { salvaged: true }, false) as TurnResult;
        }
        // journey retest R11-5 (17/11): still nothing to send (F8 T1 `malformed_output:schema:reply` ⇒ 503 « L'IA n'a pas répondu »)
        // ⇒ one last step asking for the message as plain text (no tool: nothing runs twice), sent like a salvaged answer
        if (!plainAsked && req.deadline - Date.now() > 1000) {
          plainAsked = true;
          messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: PLAIN_TEXT_REMINDER });
          continue;
        }
        return (await placedOnFailure()) ?? { ok: false, kind: 'format', error: `malformed_output:${parsed.reason}`, tools: executed, usage, model, usedFallback };
      }
      firstAnswer = res.value.text;
      // §4.1: one retry with the format reminder. It leaves the older conversation out (tester report 22/10: in a long
      // thread the model copies the plain-text style of its past replies and stays malformed after the reminder) but keeps
      // the last FORMAT_RETRY_HISTORY messages: without any of them (full-test 15/11 AI-CHAT-02) the model saw this turn's
      // tool calls full of a name / phone / address it had never read, concluded it had invented them and said so.
      repaired = true;
      // 23/11 (H-07 live: every reply needed the format retry, +1.1–1.3 s): why the first answer was refused, kept on the step for the logs
      if (steps.length) steps[steps.length - 1]!.bad = `${parsed.reason}: ${(res.value.text ?? '').slice(0, 160)}`;
      messages.splice(0, Math.max(0, req.prompt.messages.length - 1 - FORMAT_RETRY_HISTORY));
      messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: FORMAT_REMINDER });
    }
    return (await placedOnFailure()) ?? { ok: false, kind: 'format', error: 'malformed_output:steps', tools: executed, usage, model, usedFallback };
  }

  /**
   * journey retest R16-3 (18/11): the quote_delivery answers of earlier turns that stay valid — no delivery rule of their wilaya changed
   * since (fee, stop-desk, free threshold, served or not) and the shop's own threshold is the one they used. Unreadable ⇒ none.
   */
  private async knownQuotes(req: TurnRequest): Promise<unknown[]> {
    const earlier = req.guard?.earlierQuotes ?? [];
    if (!earlier.length) return [];
    const ids = [...new Set(earlier.map((e) => quoteWilaya(e.result)).filter((x): x is number => x !== null))];
    try {
      const rules = await prisma.deliveryFeeRule.findMany({ where: { wilayaId: { in: ids } }, select: { wilayaId: true, updatedAt: true, freeAbove: true, isActive: true } });
      return validEarlierQuotes(earlier, rules, req.guard?.shopFreeThreshold ?? null);
    } catch {
      return [];
    }
  }

  /**
   * journey retest R7-4: the customer has named a wilaya (or a commune of one, « wilaya 16 ») in their messages, or one is known
   * of them — the conversation's recorded details, their client record or an earlier order. Unsure (no messages, a read error) ⇒ true.
   */
  private async placeKnown(ctx: TurnRequest['toolCtx'], places: PlaceIndex | null): Promise<boolean> {
    if (ctx.customerHistory === undefined || !places) return true;
    try {
      if (placeNamedIn(places, ctx.customerHistory)) return true;
      const conv = ctx.conversationId ? await prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { context: true } }) : null;
      if (conv && contextOf(conv).customer?.wilaya) return true;
      if (!ctx.clientId) return false;
      const [address, order] = await Promise.all([prisma.clientAddress.findFirst({ where: { clientId: ctx.clientId }, select: { id: true } }), prisma.order.findFirst({ where: { clientId: ctx.clientId }, select: { id: true } })]);
      return !!address || !!order;
    } catch {
      return true;
    }
  }

  /** journey retest R8-4: the customer's message only names a wilaya / commune (the lists cannot be read ⇒ false: nothing withheld). */
  private placeOnly(text: string | undefined, places: PlaceIndex | null): boolean {
    return !!places && !!text?.trim() && placeOnlyMessage(places, text);
  }

  /**
   * journey retest R7-5 (17/11): the answer to a delivery question naming a wilaya (« Bonsoir, vous livrez à Blida ? ») comes
   * with no quote_delivery of this turn ⇒ the server runs it for that wilaya (stored like any tool call of the run). A turn that
   * already called quote_delivery, or a message naming no wilaya, runs nothing.
   */
  private async deliveryQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>, known: readonly unknown[] = [], reused: ExecutedTool[] = []): Promise<void> {
    const text = req.toolCtx.customerText ?? '';
    if (!req.guard || !asksDelivery(text) || [...executed, ...reused].some((t) => canonicalTool(t.name) === 'quote_delivery')) return;
    let wilaya: { id: number } | null = null;
    try {
      wilaya = matchWilaya((await placeIndex()).wilayas, text);
    } catch {
      return;
    }
    if (!wilaya) return;
    const call: AiToolCallRequest = { id: 'server-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id } };
    // journey retest R16-3 (18/11): a quote of an earlier turn still valid answers it (nothing runs)
    const earlier = earlierQuoteAnswered(call, known);
    if (earlier) {
      reused.push({ callId: 'earlier-quote:server', name: call.name, args: call.args, result: earlier, simulated: false, replayed: true });
      return;
    }
    const hash = toolCallId(call.name, call.args, 0);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);
    const done = await this.toolCall(req, call, ordinal, executed);
    executed.push(done);
    answered.set(sameCallKey(call.name, call.args), done.result);
  }

  /**
   * journey retest R14-2 (18/11): quote_delivery run by the server for the wilaya the customer named last (this message, else the
   * latest earlier message naming a wilaya or a commune of one), so that « home or stop-desk? » gives both fees. Null when no wilaya
   * is named or the lists cannot be read.
   */
  private async modeQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>, known: readonly unknown[] = []): Promise<ExecutedTool | null> {
    const lines = [...(req.toolCtx.customerHistory ?? '').split(/\n+/), req.toolCtx.customerText ?? ''].map((l) => l.trim()).filter(Boolean).reverse();
    let wilaya: { id: number } | null = null;
    try {
      const idx = await placeIndex();
      for (const l of lines) if ((wilaya = wilayaIn(idx, l))) break;
    } catch {
      return null;
    }
    if (!wilaya) return null;
    const call: AiToolCallRequest = { id: 'server-mode-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id } };
    // journey retest R16-3 (18/11): a quote of an earlier turn still valid gives the fees (nothing runs)
    const earlier = earlierQuoteAnswered(call, known);
    if (earlier) return { callId: 'earlier-quote:mode', name: call.name, args: call.args, result: earlier, simulated: false, replayed: true };
    const hash = toolCallId(call.name, call.args, 0);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);
    const done = await this.toolCall(req, call, ordinal, executed);
    executed.push(done);
    answered.set(sameCallKey(call.name, call.args), done.result);
    return done;
  }

  /**
   * journey retest R15-1 (18/11): quote_delivery run by the server for the wilaya the customer's message names (or of the commune it
   * names) when no earlier turn of the conversation quoted it (`GuardFacts.quotedWilayas`). Null when the message names no place, the
   * wilaya was quoted before, or the lists cannot be read.
   */
  private async placeQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>, subtotal?: number): Promise<ExecutedTool | null> {
    const text = (req.toolCtx.customerText ?? '').trim();
    if (!req.guard || !text) return null;
    let wilaya: { id: number } | null = null;
    try {
      wilaya = wilayaIn(await placeIndex(), text);
    } catch {
      return null;
    }
    if (!wilaya || (req.guard.quotedWilayas ?? []).includes(wilaya.id)) return null;
    const call: AiToolCallRequest = { id: 'server-place-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id, ...(subtotal && subtotal > 0 ? { subtotal } : {}) } };
    const hash = toolCallId(call.name, call.args, 0);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);
    const done = await this.toolCall(req, call, ordinal, executed);
    executed.push(done);
    answered.set(sameCallKey(call.name, call.args), done.result);
    return done;
  }

  /**
   * journey retest R15-1: the catalogue product the customer's message names, with the variant the message (else the answer's `cart`,
   * when it holds that one product) names — its price for the reply. Null when the message names no product of the
   * prompt's CATALOGUE, the product is out of stock, or its variants' prices differ and none is named.
   */
  private placeProductOf(req: TurnRequest, output: AiReplyOutput): PlaceProduct | null {
    const text = req.toolCtx.customerText ?? '';
    const prices = req.guard?.cataloguePrices ?? [];
    const p = text.trim() && prices.length ? productNamedIn(text, prices) : null;
    if (!p || (req.guard?.unavailableNames ?? []).includes(p.name)) return null;
    return productPrice(p, text, output);
  }

  /**
   * journey retest R18-2 (18/11): the catalogue products this reply sells whose price the customer was not told yet — the product the
   * message names, the reply's one product card, the products the reply names by their whole name (at most 3) — with the price the
   * variant named (or the one price of all variants) gives. Not an out-of-stock product, nor one at stock 0 the customer did not name,
   * nor one whose price this reply or an earlier AI message of the conversation already gives.
   */
  /**
   * journey retest R22-1 (18/11, Major): when a bare quantity of the customer's message counts — a catalogue product is being sold (the AI's
   * last message names it, the customer chose one, or one of their messages names one) — with the words of the catalogue's products (« nheb
   * 7 djellabat ») and the numbers that are no quantity: the prices of that last message and of the catalogue, the numeric variant names
   * (« 42 » of a pointure).
   */
  private quantityContext(req: TurnRequest, lastAi: string | null): QuantityContext {
    const prices = req.guard?.cataloguePrices ?? [];
    // (a search of an earlier turn that found a product counts too: the AI may name it in the customer's words, « حجاب الحرير »)
    const selling = !!prices.length && (!!(lastAi && productNamedIn(lastAi, prices)) || !!req.toolCtx.ordering || !!productNamedIn(req.toolCtx.customerHistory ?? '', prices) || !!req.guard?.earlierSearches?.some((s) => s.products.length > 0));
    const notQuantities = [
      ...(lastAi ? numbersIn(foldGuard(lastAi)).filter((n) => n >= 100) : []),
      ...prices.flatMap((p) => [p.price, ...p.variants.map((v) => v.price)]),
      ...prices.flatMap((p) => p.variants.flatMap((v) => (v.name.match(/\d+/gu) ?? []).map(Number))),
    ];
    return { selling, lastAi, productWords: [...new Set(prices.flatMap((p) => productWords(p.name)))], notQuantities, nameNumbers: nameNumbersOf(prices.map((p) => p.name)) };
  }

  // journey re-run J04r-3 (18/11): `looked` — the products this turn's search / get_product returned. One product of the CATALOGUE found for a
  // message wanting a product is the product being sold, also when the message names it in words the catalogue name lacks (« عندكم الساعة
  // الذكية؟ نحب نطلبها » ⇒ Montre connectée, orderable beyond stock: « التوصيل ممكن يطول شوية. واش سميتك ؟ », no name, no price)
  // journey retest R22-3 (18/11): `subtotals` — the order amounts of this turn's quote_delivery calls (the model prices the cart it quotes)
  private saleProductsOf(req: TurnRequest, output: AiReplyOutput, text: string, looked: readonly string[] = [], subtotals: readonly number[] = []): PlaceProduct[] {
    const prices = req.guard?.cataloguePrices ?? [];
    const said = req.toolCtx.customerText ?? '';
    if (!prices.length || !said.trim() || fillerMessage(said)) return [];
    // journey retest R22-4 (18/11): a cancellation message gets no price line (CQ1 T3 « je veux annuler ? » ⇒ « Bien sûr. Tapis de prière : 2 800
    // DA. Voulez-vous vraiment annuler la commande TEST-4234 … ? »)
    if (CANCEL_MESSAGE.test(foldText(said)) || cancelledAsked(said)) return [];
    const zero = new Set(req.guard?.zeroStockNames ?? []);
    const out = new Set(req.guard?.unavailableNames ?? []);
    const earlier = req.prompt.messages.filter((m) => m.role === 'assistant').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    // (journey retest R22-4: and the unit prices of the recaps / orders the conversation showed — « 2 × Tapis de prière : 5 600 DA » told 2 800)
    const told = new Set([...numbersIn(foldGuard(earlier)), ...numbersIn(foldGuard(text)), ...shownUnitPrices(req.toolCtx.orderHistory)]);
    const cards = [...new Set(output.productCards ?? [])];
    // (the product the message names, unless the reply speaks of others only — its cards show another product, or it names another one,
    // and never this one)
    const wants = productWanted(said) || asksSomething(said);
    const lookedUp = looked.length === 1 && wants ? (prices.find((p) => p.id === looked[0]) ?? null) : null;
    // journey retest R22-3 (18/11): PH4 T1 « Hi, I want 1 prayer rug delivered at home to Blida, … » — no catalogue word, no search, the model
    // quoted `{ wilayaName: Blida, subtotal: 2800 }` and answered with the fees only: the one product of the model's `cart`, else the one
    // catalogue product whose price (× 1–10) is the subtotal it quoted, is the product being sold
    const cartIds = [...new Set((output.cart?.items ?? []).map((i) => i?.productId).filter((id): id is string => typeof id === 'string'))];
    const takes = productWanted(said);
    const fromCart = takes && cartIds.length === 1 ? (prices.find((p) => p.id === cartIds[0]) ?? null) : null;
    const quotedOnes = takes && subtotals.length ? prices.filter((p) => !out.has(p.name) && subtotals.some((s) => [p.price, ...p.variants.map((v) => v.price)].some((u) => u > 0 && s % u === 0 && s / u >= 1 && s / u <= 10))) : [];
    // journey J08v-2 (19/11): every product the message names — « je veux 1 tapis berbère et 1 porte-clés, en stop-desk à Alger » got the
    // porte-clés price only (« … Porte-clés : 600 DA. … Quel est votre nom complet ? », the 9 800 DA of the tapis never said); the product the
    // message names by the most of its words comes first (« tapis berbère » is not « Tapis de prière » through « tapis »)
    const namedAll = productsNamedIn(said, prices);
    const named = namedAll[0] ?? productNamedIn(said, prices) ?? lookedUp ?? fromCart ?? (quotedOnes.length === 1 ? quotedOnes[0]! : null);
    const other = productNamedIn(text, prices.filter((p) => p !== named));
    const asked = named && ((cards.length && !cards.includes(named.id)) || other) && !productNamedIn(text, [named]) ? null : named;
    // (the other products the message names, two at most — as the reply's whole names below, a longer list is the catalogue or alternatives
    // — unless the reply's cards show other products and the reply does not name them)
    const alsoNamed = wants && namedAll.length <= 3 ? namedAll.filter((p) => p !== named && (!cards.length || cards.includes(p.id) || !!productNamedIn(text, [p]))) : [];
    // (a reply naming three products or more lists the catalogue or alternatives — « Kayen bezzaf : basket, djellaba homme, … »: no price
    // line for each)
    const whole = prices.filter((p) => namedWhole(text, p.name));
    const candidates = [asked, ...alsoNamed, cards.length === 1 ? prices.find((p) => p.id === cards[0]) : undefined, ...(whole.length <= 2 ? whole : [])].filter((p): p is CataloguePrice => !!p);
    const found: PlaceProduct[] = [];
    for (const p of candidates) {
      if (found.length >= 3 || found.some((x) => x.name === p.name) || out.has(p.name) || (zero.has(p.name) && p !== asked)) continue;
      const priced = productPrice(p, said, output);
      if (priced && priced.price > 0 && !told.has(priced.price)) found.push(priced);
    }
    return found;
  }

  /**
   * journey retest R5-6: the customer has given a phone number — in one of their messages, or on their client record (a
   * returning customer, KNOWN CUSTOMER). Without the conversation's messages (`customerHistory`) nothing is withheld.
   */
  private async phoneGiven(ctx: TurnRequest['toolCtx']): Promise<boolean> {
    if (ctx.customerHistory === undefined || phonesIn(ctx.customerHistory).size) return true;
    if (!ctx.clientId) return false;
    const client = await prisma.client.findUnique({ where: { id: ctx.clientId }, select: { phone: true, phone2: true } });
    return !!(client?.phone || client?.phone2);
  }

  /** Closes a run (inside the caller's transaction when given). Only a `running` run is closed: returns false otherwise. */
  async finish(
    runId: string,
    p: { status: Exclude<AiRunStatus, 'running'>; turn?: Pick<TurnBase, 'usage' | 'model' | 'usedFallback' | 'tools' | 'steps'>; intent?: AiIntent | null; confidence?: number | null; error?: string | null; startedAt: Date; flags?: string[]; meta?: RunMeta },
    tx?: Tx,
  ): Promise<boolean> {
    const db = tx ?? prisma;
    const usage = p.turn?.usage ?? { inputTokens: 0, outputTokens: 0 };
    const model = p.turn?.model ?? null;
    const current = await db.aiRun.findUnique({ where: { id: runId }, select: { meta: true } });
    const meta: RunMeta = { ...((current?.meta as RunMeta | null) ?? {}), ...(p.meta ?? {}), ...(p.turn ? { toolNames: p.turn.tools.map((t) => canonicalTool(t.name)) } : {}), ...(p.turn?.steps ? { steps: p.turn.steps } : {}), ...(model ? { costUsd: costUsd(model, usage) } : {}) };
    const r = await db.aiRun.updateMany({
      where: { id: runId, status: 'running' },
      data: {
        status: p.status,
        ...(model ? { modelId: model.id, providerId: model.providerId } : {}),
        usedFallback: p.turn?.usedFallback ?? false,
        intent: p.intent ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: Math.max(0, Date.now() - p.startedAt.getTime()),
        confidence: p.confidence ?? null,
        toolCallCount: p.turn?.tools.length ?? 0,
        error: p.error ?? null,
        finishedAt: new Date(),
        ...(p.flags?.length ? { flags: { push: p.flags } } : {}),
        meta: meta as Prisma.InputJsonValue,
      },
    });
    if (r.count === 1) this.metrics?.aiRun(p.status, Math.max(0, Date.now() - p.startedAt.getTime()), model?.provider ?? null);
    return r.count === 1;
  }

  /** `sched-ai-run-reaper` (every minute). A reaped run is not resumed: the next customer message starts a new batch. */
  async reap(now = new Date()): Promise<number> {
    const stale = await TenantContext.runSystem(() => prisma.aiRun.findMany({ where: { status: 'running', startedAt: { lt: new Date(now.getTime() - RUN_REAP_AFTER_MS) } }, select: { id: true, workspaceId: true }, take: 200 }));
    let n = 0;
    for (const run of stale) {
      // the workspace's own plan limits: releasing reads the balance of its credit period
      const tenant = await this.tenants.forWorker(run.workspaceId).catch(() => null);
      if (!tenant) continue;
      await TenantContext.run(tenant, async () => {
        const r = await prisma.aiRun.updateMany({ where: { id: run.id, status: 'running' }, data: { status: 'error', error: 'reaped', finishedAt: now, flags: { push: 'reaped' } } });
        if (!r.count) return;
        await this.credits.release(run);
        n++;
      });
    }
    if (n) this.log.warn({ reaped: n }, 'ai runs reaped');
    return n;
  }
}
