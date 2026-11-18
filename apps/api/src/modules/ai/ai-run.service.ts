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
import { canonicalTool, ToolRegistry, type ToolRunContext } from './tools/tool-registry';
import { allowedHandoffReasons, establishedReasons, fieldOnlyMessage, handoffReason, handoffRefusedInstruction, judgeHandoff, messageHandoffReasons, orderDetailsMessage, placeCandidate, type HandoffRefusal } from './handoff-judge';
import { productNamedIn, productWanted, productWords } from './product-named';
import { AUTO_FIX_RULES, checkReply, enforceReply, guardInstruction, orderClaimsIn, quoteFacts, stripMarkdown, withToolResults, type GuardFacts, type GuardOutcome, type GuardViolation } from './reply-guard';
import { asksDelivery, asksSomething, blockedOrderText, confirmRequest, deliveryAnswer, orderConfirmationText, pendingRecap, recapReply, withoutRecapClaims } from './tools/order-confirmation-text';
import { cancelAsked, confirmation, phonesIn, recapPending } from './tools/order-confirmation';
import { matchWilaya, namedVariant } from './tools/tool-registry';
import { placeIndex, placeNamedIn, placeOnlyMessage, wilayaIn, type PlaceIndex } from './tools/place-index';
import { contextOf } from '../messaging/messaging.presenter';
import { asksAddress, fillerMessage, handoffKind, handoffReply, handoffSystemLineShown, modeQuestionAt, noPhotoReply, noPhotoSaid, openingSaid, photoAsked, substitutionLine, withArabicCurrency, withArabicWords, withArabiziWords, withAskedPrice, withBothFees, withModeFees, withOneNowWord, withOrderStatusWording, withoutNameInPriceSlot, withoutPresenceTalk, withoutQuickReply, withoutStrayYes, withPlaceFacts, type PlaceProduct } from './reply-fixes';
import { serverTextLanguage, systemLocale } from './language';
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
  'NO RECAP YET: your reply asks the customer to confirm, or says the order is registered / noted, but no recap was shown and no order was created — the customer only ever confirms the recap create_order returns. If the customer has accepted a product and every order field is known (name, phone, wilaya, address or stop-desk), call create_order now: the server shows the recap. Otherwise ask the one missing field, or ask whether they want the product (« Voulez-vous le … ? »). Never ask « pour confirmer … ? », « tu confirmes ? » or for a « oui » yourself.';
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
/** journey retest R1-1: the result given back for a call to a tool this step did not offer (it is not run). */
export const unavailableTool = (name: string, fieldOnly: boolean, noPhone = false, noPlace = false, noStreet = false) => ({
  ok: false,
  error: { code: 'TOOL_NOT_AVAILABLE', tool: name },
  instruction: `${name} cannot be used now${fieldOnly && canonicalTool(name) === 'handoff_to_human' ? ': the customer only gave an order field (or a yes) — record it, keep the conversation and ask the next missing field (or show the recap)' : canonicalTool(name) === 'create_order' && noPhone ? ': the customer has not given a phone number yet — ask for the next missing field (never a recap)' : canonicalTool(name) === 'create_order' && noPlace ? ': the customer has not named their wilaya yet — ask for it (never a default wilaya, never a recap)' : canonicalTool(name) === 'create_order' && noStreet ? ': the customer named only the wilaya / commune — ask for the street address (rue, cité, building, landmark) or offer the stop-desk (never a recap)' : canonicalTool(name) === 'create_order' ? ': it already answered in this turn — follow that answer (ask the missing field, or let the recap / confirmation go)' : canonicalTool(name) === 'cancel_order' ? ': the customer did not ask to cancel anything — answer their message (lookup_order answers a question about an order; take the order otherwise)' : canonicalTool(name) === 'lookup_order' ? ': the customer only gave a name, a place or a yes to the recap — record it and ask the next missing field (or let the recap / confirmation go)' : canonicalTool(name) === 'add_faq_candidate' ? ': the customer asked no question in this message — never file a note or a question they did not ask' : ''}. Answer the customer now with the JSON object.`,
});
/**
 * journey retest R2-4: a `create_order` answer after which the tool is not offered again in the same turn — the recap was
 * returned, the order placed (or refused: blocked, already placed, not confirmed), or a field must be asked to the customer
 * (VALIDATION missing=true). The same call was sent 2–3 times in a turn (10.1 s), and probes followed each other.
 */
export const orderClosedBy = (name: string, result: unknown): boolean => {
  if (canonicalTool(name) !== 'create_order') return false;
  const r = result as { ok?: unknown; error?: { code?: unknown; missing?: unknown } } | null;
  if (r?.ok === true) return true;
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
type TurnBase = { tools: ExecutedTool[]; usage: AiUsage; model: RoutedModel | null; usedFallback: boolean };
export type TurnResult =
  | (TurnBase & { ok: true; output: AiReplyOutput; model: RoutedModel; forcedHandoff: string | null; repaired: boolean; salvaged?: boolean; /** retest 12/11: a handoff of the model was refused by the server this turn (handoff-judge) */ handoffRefused?: HandoffRefusal; /** §4.3: the reply guard found something (and what was done) */ guard?: GuardOutcome })
  | (TurnBase & { ok: false; kind: 'provider' | 'format'; error: string });
export type RunMeta = { language?: string; toolNames?: string[]; cardsSent?: number; handoff?: boolean; costUsd?: number; plannedCost?: number; vision?: Record<string, unknown>; sessionId?: string; turn?: unknown; evalFlag?: unknown; scenario?: string; /** §4.3 reply guard (rules, amounts / leak kinds, action — never message text) */ guard?: GuardOutcome };
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
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
    const messages: AiMessage[] = [...req.prompt.messages];
    // full-test 15/11 AI-CHAT-07: no handoff tool on a message that is only an order field (refused every time, 5–10 s each)
    // journey retest R11-3 (17/11): an order is being taken as soon as the customer gave a phone number — `ordering` (a product in
    // the model's `cart`, or a recap) was empty after a first answer with no tool, so « Sétif, El Eulma » was no field message and
    // got `handoff_to_human` probes (F1b T2 in 3 runs out of 3); a message that only names the wilaya / commune is a field too
    const phoneSoFar = req.toolCtx.customerHistory !== undefined && phonesIn(req.toolCtx.customerHistory).size > 0;
    let fieldOnly = fieldOnlyMessage(req.toolCtx.customerText, !!req.toolCtx.ordering || phoneSoFar);
    const short = (req.toolCtx.customerText ?? '').trim();
    if (!fieldOnly && placeCandidate(short)) {
      const idx = await placeIndex().catch(() => null);
      fieldOnly = !!idx && placeOnlyMessage(idx, short);
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
    const reasons = messageHandoffReasons(allowedHandoffReasons(req.toolCtx.agent, req.toolCtx.unclearStreak ?? 0, req.toolCtx.customerText), req.toolCtx.customerText, (t) => phonesIn(t).size > 0, req.guard?.catalogueNames);
    // journey retest R5-6: no create_order while the customer has given no phone number (every such call is refused) — the
    // probes `create_order {}` / placeholder values came on such turns; a complete order message carries its phone and keeps it
    const noPhone = !(await this.phoneGiven(req.toolCtx));
    // journey retest R6-5: with a phone create_order stays offered, but with no street address / stop-desk word in the
    // customer's messages (and no recap yet) the model is told to ask for the address rather than call it (F1b: « Sétif, El
    // Eulma » ⇒ `create_order` without an address, refused)
    const noAddress = !noPhone && noAddressYet(req.toolCtx);
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
    const noLookup = noLookupFor(said, fieldOnly) || (said !== undefined && (orderDetailsMessage(said, (t) => phonesIn(t).size > 0, true) || productWanted(said)) && !ORDER_WORD.test(foldGuard(said)));
    const noFaq = said !== undefined && !asksSomething(said);
    // journey retest R10-2: a server recap of an earlier turn waits for the customer's « oui » (a request to confirm points at it)
    const pendingBefore = recapPending(req.toolCtx.orderHistory);
    // journey retest R12-3 (17/11): nor on a « oui » to that recap (F6 T3, F3 T4: `create_order` ⇒ TEST-n, then `lookup_order {}` ⇒
    // no order) — the yes places the order, nothing is to be looked up; a question or a change in the message keeps it
    const confirmingYes = pendingBefore && said !== undefined && confirmation(said) === 'yes' && !asksSomething(said) && !ORDER_WORD_ASK.test(foldGuard(said));
    const withheld = (name: string) =>
      (name === 'handoff_to_human' && (noHandoff || !reasons.length)) || (name === 'create_order' && (noPhone || noPlace || noStreet)) || (name === 'cancel_order' && noCancel) || (name === 'lookup_order' && (noLookup || confirmingYes)) || (name === 'add_faq_candidate' && noFaq);
    const defs = (await this.tools.defsFor(req.toolCtx.workspaceId)).filter((d) => !withheld(d.name)).map((d) => (d.name === 'handoff_to_human' ? handoffDefWith(d, reasons) : d));
    // journey retest R1-1: the model still called the withheld tool (the prompt describes it) and the SDK refused the whole
    // step — 5 of 59 turns of a shop with handoff rules ended in 503. The note says it is not available for this message
    // (after the cached start of the system prompt, so the cache is kept).
    // journey retest R5-6: and, without a phone, that create_order is not available (same place: the cache prefix is kept)
    const executed: ExecutedTool[] = [];
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
    const seen = new Map<string, number>();
    const answered = new Map<string, unknown>();
    const system = [req.prompt.system, ...(fieldOnly ? [FIELD_ONLY_NOTE] : []), ...(orderDetails ? [ORDER_DETAILS_NOTE] : []), ...(noPhone ? [NO_PHONE_NOTE] : []), ...(noPlace ? [NO_PLACE_NOTE] : noStreet ? [NO_STREET_NOTE] : noAddress ? [NO_ADDRESS_NOTE] : [])].join('\n\n');
    // journey retest R7-5: run once, when the answer to a delivery question comes without any quote_delivery of the turn
    let serverQuoted = false;
    // journey retest R14-2: the server's quote for the fees of a « home or stop-desk? » question (not a delivery question)
    let modeQuote: ExecutedTool | null = null;
    // journey retest R15-1: the server's quote of a place the customer named with no quote of it yet in the conversation, and the
    // product (its price) the message names
    let placeQuote: ExecutedTool | null = null;
    let placeProduct: PlaceProduct | null = null;
    let model = null as RoutedModel | null;
    let usedFallback = false;
    let repaired = false;
    let firstAnswer = '';
    let forcedHandoff: string | null = null;
    let toolRounds = 0;
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
    const confirmed = (output: AiReplyOutput): AiReplyOutput => {
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
        const person = handoffKind(reason) === 'person' && executed.every((t) => canonicalTool(t.name) === 'handoff_to_human');
        let said = person ? '' : withoutRecapClaims(plain.reply).trim();
        if (ooh) said = withoutQuickReply(said);
        if (!said) return { ...plain, reply: handoffReply(reason, textLang, { outOfHours: ooh }) };
        const shown = handoffSystemLineShown(textLang, ooh, systemLocale(textLang, req.guard?.shopLocale ?? 'fr', (req.toolCtx.agent as { defaultLanguage?: string | null } | undefined)?.defaultLanguage ?? null));
        return { ...plain, reply: shown || (ooh && openingSaid(said)) ? said : `${said} ${handoffReply(reason, textLang, { outOfHours: ooh, tail: true })}` };
      }
      const recap = recapNow();
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
        text = withArabicWords(withModeFees(withBothFees(text, quoteFacts(calls), textLang), quoteFacts(calls), textLang), textLang);
        // journey retest R15-1 (18/11): a place given with no quote of it yet ⇒ the product's price and both fees (the server's quote)
        if (placeQuote) text = withPlaceFacts(text, quoteFacts([{ name: 'quote_delivery', result: placeQuote.result }]), placeProduct, textLang);
        // journey retest R15-4 (18/11): the asked price of an out-of-stock product is given with « pas disponible » (N5 T1)
        const gone = new Set(req.guard?.unavailableNames ?? []);
        text = withAskedPrice(text, req.toolCtx.customerText, (req.guard?.cataloguePrices ?? []).filter((p) => gone.has(p.name)), textLang);
        return { ...plain, reply: withPhotoAnswer(output, text) };
      }
      // journey retest R12-4: the lead-in kept before the server recap gets the same narrow wording fixes (N3 T2 « Livraison à domicile »)
      const r = recapReply(withArabicCurrency(withArabiziWords(plain.reply, textLang)), recap, textLang, req.toolCtx.customerText);
      // journey retest R5-5: « twasslou l Constantine ? » is answered in words when no sentence of the model goes before the recap
      const answer = r.kept === 'server' ? deliveryAnswer(calls, req.toolCtx.customerText ?? '', textLang) : null;
      // journey retest R13-5 (18/11): a recap of another product than the out-of-stock one the customer asked for says so first (N5 T2
      // « je le prends » ⇒ the Coffret's recap, the Parfum Oud out of stock)
      const swap = substitutionLine(recap.items, req.toolCtx.customerHistory ?? req.toolCtx.customerText ?? '', req.guard?.unavailableNames ?? [], r.text, textLang);
      return { ...plain, reply: withPhotoAnswer(output, [swap, answer, r.text].filter(Boolean).join('\n\n')) };
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
      const quotes = answer?.status === 'HANDOFF' || forcedHandoff ? [] : quoteFacts(executed.filter((t) => t !== modeQuote).map((t) => ({ name: canonicalTool(t.name), result: t.result })));
      // journey retest R2-3: the fields the answer reports as given — the guard checks the reply does not deny them
      const c = answer?.customer;
      const fields = c ? { ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.wilaya ? { wilaya: c.wilaya } : {}), ...(c.commune ? { commune: c.commune } : {}), ...(c.address ? { address: c.address } : {}) } : undefined;
      // journey retest R6-2: whether this answer sends a photo — a card or a gallery of a product not known to have none
      const sent = answer ? [...(answer.productCards ?? []), ...(answer.productPhotos ?? []), ...(f.galleries ?? [])] : null;
      const photoSent = sent ? sent.some((id) => !(f.noPhoto ?? []).includes(id)) : undefined;
      // journey retest R8-1 / R8-2: a tool that really failed; a create_order refused this turn (no recap shown) and the field it asked
      const refusal = refusedOrder(executed);
      const systemFailure = executed.some((t) => SYSTEM_FAILURES.has(String((t.result as { error?: { code?: unknown } } | null)?.error?.code ?? '')));
      // journey retest R10-2: no recap waiting at all (none this turn, none of an earlier turn still open, no order placed now) — a
      // request to confirm confirms nothing; after a refusal of the product itself, « noté » is a false claim
      const noRecapPending = !refusal && !pendingBefore && !recapNow() && !confirmationNow();
      // journey retest R12-2 (17/11): a recap waits (a bare « c'est noté » to the « oui » is an order claim); the customer's orders
      // were looked up this turn (their status may be told)
      const orderLookedUp = executed.some((t) => canonicalTool(t.name) === 'lookup_order' && ((t.result as { orders?: unknown[] } | null)?.orders?.length ?? 0) > 0);
      return { ...f, ...(pendingBefore ? { recapWaiting: true } : {}), ...(orderLookedUp ? { orderLookedUp: true } : {}), ...(quotes.length ? { quotes } : {}), ...(fields ? { customerFields: fields } : {}), ...(photoSent !== undefined ? { photoSent } : {}), ...(systemFailure ? { systemFailure } : {}), ...(refusal ? { orderRefused: true, ...(refusal.field ? { missingField: refusal.field } : {}), ...(PRODUCT_REFUSALS.has(refusal.code) ? { productRefused: true } : {}) } : {}), ...(noRecapPending ? { noRecapPending } : {}) };
    };
    /** The guard's last word: offending sentences dropped / greeting stripped / the safe sentence (never a handoff). */
    const enforce = (base: AiReplyOutput, text: string, violations: GuardViolation[], first: GuardViolation[], retried: boolean, extra: { salvaged?: boolean }): TurnResult => {
      const e = enforceReply(text, violations, factsNow(base), { hasCards: base.productCards.length > 0 });
      return ok({ ...base, reply: e.reply }, { ...extra, guard: { violations: slim(first), retried, remaining: slim(violations), action: e.action } });
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
    // journey retest R11-5: one more step than the loop's own when the plain-text step is asked
    for (let step = 0; step < MAX_STEPS + 1 + (plainAsked ? 1 : 0); step++) {
      const left = req.deadline - Date.now();
      if (left <= 0) return guardFallback() ?? { ok: false, kind: 'provider', error: 'timeout', tools: executed, usage, model, usedFallback };
      // the corrective turn of the guard is offered no tool: an order or a cancellation is never done twice
      // full-test 15/11 AI-CHAT-02: nor the format retry — it only re-writes the answer (it cancelled the order it had just created)
      // full-test 15/11 proposal 13: a message that is only an order field gets 2 tool rounds at most (10–21 s turns)
      const offerTools = toolRounds < (fieldOnly ? 2 : MAX_STEPS - 1) && !forcedHandoff && !guardFirst && !repaired;
      // journey retest R12-3 (17/11): once create_order placed the order in this turn, lookup_order is not offered either (F6 T3, F3 T4
      // looked up the order they had just placed: `{orders: []}`)
      const placedNow = orderClosed && !!confirmationNow();
      const stepDefs = orderClosed ? defs.filter((d) => d.name !== 'create_order' && !(placedNow && d.name === 'lookup_order')) : defs;
      let res;
      try {
        res = await this.routing.call(
          'text',
          (m, timeoutMs) => this.gateway.generate({ model: m.ref, purpose: 'reply', system, ...(req.prompt.cachePrefix ? { systemCachePrefix: req.prompt.cachePrefix } : {}), messages, tools: offerTools ? stepDefs : undefined, temperature: req.temperature, maxTokens: req.maxTokens, timeoutMs: Math.max(1000, Math.min(timeoutMs, left)) }),
          { only: (m) => m.supportsTools, prefer: model?.id },
        );
      } catch (e) {
        if (e instanceof AiProviderError) return guardFallback() ?? { ok: false, kind: 'provider', error: providerErrorLabel(e), tools: executed, usage, model, usedFallback };
        throw e;
      }
      model = res.model;
      usedFallback ||= res.usedFallback;
      usage.inputTokens += res.value.usage.inputTokens;
      usage.outputTokens += res.value.usage.outputTokens;

      // journey retest R1-1: a call to a tool this step did not offer is never run — the model is told and answers
      const offered = new Set(stepDefs.map((d) => d.name));
      const stray = offerTools ? [...(res.value.rejectedToolCalls ?? []), ...res.value.toolCalls.filter((c) => !offered.has(canonicalTool(c.name)))] : [];
      if (stray.length) {
        toolRounds++;
        const runnable = res.value.toolCalls.filter((c) => offered.has(canonicalTool(c.name)));
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
          const known = (canonicalTool(call.name) === 'search_products' ? (searchAnswered(call.args?.query, executed, req.guard?.catalogueNames) ?? (fieldOnly ? catalogueAnswered(call.args?.query, req.guard?.catalogueNames) : null)) : null) ?? recapAnswered(call, executed) ?? lookupAnswered(call, executed, req.guard?.catalogueIds, runnable, catalogueLookup) ?? quoteAnswered(call, executed);
          if (known) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: known });
            continue;
          }
          const place = await placeSearch(call);
          if (place) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: placeSearchResult(place) });
            continue;
          }
          const ordinal = seen.get(hash) ?? 0;
          seen.set(hash, ordinal + 1);
          const done = await this.toolCall(req, call, ordinal, executed);
          executed.push(done);
          answered.set(key, done.result);
          orderClosed ||= orderClosedBy(call.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
        }
        messages.push({ role: 'user', content: stray.map((c) => `[tool result ${c.name}] ${JSON.stringify(unavailableTool(c.name, noHandoff, noPhone, noPlace, noStreet))}`).join('\n') });
        continue;
      }
      if (res.value.toolCalls.length && offerTools) {
        toolRounds++;
        const calls = res.value.toolCalls;
        messages.push({ role: 'assistant', content: res.value.text ?? '', toolCalls: calls });
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
          const known = (canonicalTool(call.name) === 'search_products' ? (searchAnswered(call.args?.query, executed, req.guard?.catalogueNames) ?? (fieldOnly ? catalogueAnswered(call.args?.query, req.guard?.catalogueNames) : null)) : null) ?? recapAnswered(call, executed) ?? lookupAnswered(call, executed, req.guard?.catalogueIds, calls, catalogueLookup) ?? quoteAnswered(call, executed);
          if (known) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: known });
            continue;
          }
          const place = await placeSearch(call);
          if (place) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: placeSearchResult(place) });
            continue;
          }
          const ordinal = seen.get(hash) ?? 0;
          seen.set(hash, ordinal + 1);
          const done = await this.toolCall(req, call, ordinal, executed);
          executed.push(done);
          answered.set(key, done.result);
          orderClosed ||= orderClosedBy(call.name, done.result);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, result: done.result });
          forcedHandoff ??= this.tools.forcedHandoff(call.name, call.args, done.result);
        }
        continue;
      }
      const parsed = parseReplyOutput(res.value.text);
      if (guardFirst) {
        // the corrective answer: only its text is taken — status, cards, handoff and every other field stay the first answer's
        const { output: first, extra, violations } = guardFirst;
        const rewritten = (parsed.ok ? parsed.value.reply : (salvageReply(res.value.text)?.reply ?? '')).trim();
        if (!rewritten) return enforce(first, first.reply, violations, violations, true, extra);
        const again = checkReply(rewritten, factsNow(first));
        if (!again.length) return ok({ ...first, reply: rewritten }, { ...extra, guard: { violations: slim(violations), retried: true, remaining: [], action: 'rewritten' } });
        return enforce(first, rewritten, again, violations, true, extra);
      }
      const retryOrDone = (r: TurnResult | 'retry'): TurnResult | null => {
        if (r !== 'retry') return r;
        messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: guardInstruction(guardFirst!.violations, factsNow(guardFirst!.output)) });
        return null;
      };
      if (parsed.ok) {
        // journey retest R7-5 (17/11): « Vous livrez à Blida ? » answered from the delivery policy text alone (« Oui, on livre à
        // Blida … en 2 à 5 jours ») — the server runs quote_delivery for the wilaya the question names, so the guard's fee_missing
        // rule applies to this answer (one corrective turn, then the fee sentence) as when the model called it
        if (!serverQuoted && parsed.value.status !== 'HANDOFF' && !forcedHandoff && !recapNow() && !confirmationNow()) {
          serverQuoted = true;
          await this.deliveryQuote(req, executed, seen, answered);
          // journey retest R14-2 (18/11): the question « home or stop-desk? » (the model's, or the server's address question after a
          // create_order refused for the address) carries both fees — F1b T2 « Sétif, El Eulma » ⇒ « … à domicile … ou au stop-desk ? »
          // with no fee and no quote_delivery: the server quotes the wilaya the customer named (that quote is no delivery question:
          // it is kept out of the guard's fee rule) and `withModeFees` writes the fees before the question
          if (!executed.some((t) => canonicalTool(t.name) === 'quote_delivery') && (modeQuestionAt(parsed.value.reply) >= 0 || refusedOrder(executed)?.field === 'address')) {
            modeQuote = await this.modeQuote(req, executed, seen, answered);
            if (modeQuote) parsed.value.reply = withModeFees(parsed.value.reply, quoteFacts([{ name: 'quote_delivery', result: modeQuote.result }]), textLang);
          }
          // journey retest R15-1 (18/11): the customer named a place this message (F5 T1 « …, wilaya Alger, Bab Ezzouar ») and no quote of
          // it exists yet in the conversation — the model asked the street with no price, no fee and no stop-desk: the server quotes that
          // wilaya (kept out of the guard's fee rule, as R14-2's) and the reply carries the product's price and both fees. Only when the
          // reply asks the address or the message names a catalogue product (an order is being taken), never on a not-served wilaya.
          if (!executed.some((t) => canonicalTool(t.name) === 'quote_delivery')) {
            const product = this.placeProductOf(req, parsed.value);
            const quoted = product || asksAddress(parsed.value.reply) ? await this.placeQuote(req, executed, seen, answered) : null;
            if (quoted && (quoted.result as { ok?: unknown } | null)?.ok === true) {
              modeQuote = placeQuote = quoted;
              placeProduct = product;
              parsed.value.reply = withPlaceFacts(parsed.value.reply, quoteFacts([{ name: 'quote_delivery', result: quoted.result }]), product, textLang);
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
        if (canAskAgain && !pendingBefore && (refusedOrder(executed)?.argsOnly ?? true) && (claims || splitSentences(parsed.value.reply).some(confirmRequest))) {
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
        const verdict = judged ? judgeHandoff({ reason: out.statusDetail, evidence: out.evidence, customerText: ctx.customerText!, shopRules: ctx.agent.humanHandoffRules, keywords: ctx.agent.handoffKeywords, unclearStreak: ctx.unclearStreak, established: establishedReasons(executed.map((t) => t.result)), soldNamed }) : null;
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
        const done = retryOrDone(guarded(out, {}, step < MAX_STEPS));
        if (done) return done;
        continue;
      }
      if (repaired) {
        // tester report 26/10: the first answer, when it is a plain message to the customer, is sent rather than the
        // conversation handed to the team in silence (F-6 only when there is nothing to send)
        const salvaged = salvageReply(firstAnswer) ?? salvageReply(res.value.text);
        // §4.3: no corrective turn after a format retry — the guard's last word applies at once
        if (salvaged) return guarded(salvaged, { salvaged: true }, false) as TurnResult;
        // journey retest R11-5 (17/11): still nothing to send (F8 T1 `malformed_output:schema:reply` ⇒ 503 « L'IA n'a pas répondu »)
        // ⇒ one last step asking for the message as plain text (no tool: nothing runs twice), sent like a salvaged answer
        if (!plainAsked && req.deadline - Date.now() > 1000) {
          plainAsked = true;
          messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: PLAIN_TEXT_REMINDER });
          continue;
        }
        return { ok: false, kind: 'format', error: `malformed_output:${parsed.reason}`, tools: executed, usage, model, usedFallback };
      }
      firstAnswer = res.value.text;
      // §4.1: one retry with the format reminder. It leaves the older conversation out (tester report 22/10: in a long
      // thread the model copies the plain-text style of its past replies and stays malformed after the reminder) but keeps
      // the last FORMAT_RETRY_HISTORY messages: without any of them (full-test 15/11 AI-CHAT-02) the model saw this turn's
      // tool calls full of a name / phone / address it had never read, concluded it had invented them and said so.
      repaired = true;
      messages.splice(0, Math.max(0, req.prompt.messages.length - 1 - FORMAT_RETRY_HISTORY));
      messages.push({ role: 'assistant', content: res.value.text || '(no answer)' }, { role: 'user', content: FORMAT_REMINDER });
    }
    return { ok: false, kind: 'format', error: 'malformed_output:steps', tools: executed, usage, model, usedFallback };
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
  private async deliveryQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>): Promise<void> {
    const text = req.toolCtx.customerText ?? '';
    if (!req.guard || !asksDelivery(text) || executed.some((t) => canonicalTool(t.name) === 'quote_delivery')) return;
    let wilaya: { id: number } | null = null;
    try {
      wilaya = matchWilaya((await placeIndex()).wilayas, text);
    } catch {
      return;
    }
    if (!wilaya) return;
    const call: AiToolCallRequest = { id: 'server-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id } };
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
  private async modeQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>): Promise<ExecutedTool | null> {
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
  private async placeQuote(req: TurnRequest, executed: ExecutedTool[], seen: Map<string, number>, answered: Map<string, unknown>): Promise<ExecutedTool | null> {
    const text = (req.toolCtx.customerText ?? '').trim();
    if (!req.guard || !text) return null;
    let wilaya: { id: number } | null = null;
    try {
      wilaya = wilayaIn(await placeIndex(), text);
    } catch {
      return null;
    }
    if (!wilaya || (req.guard.quotedWilayas ?? []).includes(wilaya.id)) return null;
    const call: AiToolCallRequest = { id: 'server-place-quote', name: 'quote_delivery', args: { wilayaId: wilaya.id } };
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
    const items = output.cart?.items ?? [];
    const fromCart = items.length === 1 && items[0]!.productId === p.id && items[0]!.variantId ? p.variants.find((v) => v.id === items[0]!.variantId) : undefined;
    const v = (p.variants.length ? namedVariant(p.variants.filter((x) => x.id), text) : null) ?? fromCart;
    if (v) return { name: p.name, variant: v.name, price: v.price };
    if (!p.variants.length) return { name: p.name, price: p.price };
    const one = [...new Set(p.variants.map((x) => x.price))];
    return one.length === 1 ? { name: p.name, price: one[0]! } : null;
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
    p: { status: Exclude<AiRunStatus, 'running'>; turn?: Pick<TurnBase, 'usage' | 'model' | 'usedFallback' | 'tools'>; intent?: AiIntent | null; confidence?: number | null; error?: string | null; startedAt: Date; flags?: string[]; meta?: RunMeta },
    tx?: Tx,
  ): Promise<boolean> {
    const db = tx ?? prisma;
    const usage = p.turn?.usage ?? { inputTokens: 0, outputTokens: 0 };
    const model = p.turn?.model ?? null;
    const current = await db.aiRun.findUnique({ where: { id: runId }, select: { meta: true } });
    const meta: RunMeta = { ...((current?.meta as RunMeta | null) ?? {}), ...(p.meta ?? {}), ...(p.turn ? { toolNames: p.turn.tools.map((t) => canonicalTool(t.name)) } : {}), ...(model ? { costUsd: costUsd(model, usage) } : {}) };
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
