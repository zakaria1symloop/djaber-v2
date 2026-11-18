// 04-ai-pipeline §4.2 — the tools of a reply turn: JSON Schemas given to the model (names are final) and their
// execution. A tool never throws for a bad argument: it returns `{ ok:false, error:{ code, field, example } }` so the
// model re-asks the customer. Result codes (PRODUCT_NOT_AVAILABLE, WILAYA_NOT_SERVED, VARIANT_REQUIRED, …) are internal
// to the run: never returned by the API, not in the error catalogue. Every read is scoped to the agent's catalogue.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HANDOFF_REASONS, isPhoneDz, normalizePhoneDz, WILAYA_COUNT } from '@djaber/shared';
import { prisma, TenantContext, type Agent, type Prisma } from '@djaber/db';
import { FAQ_CANDIDATE_INSIGHT_AT } from '../ai.constants';
import { CatalogueService, nearestId, type CatalogueProduct } from '../catalogue.service';
import { stockWord } from '../prompt/sections/catalogue';
import type { AiToolDef } from '../provider/ai.gateway';
import { customerBlockedResult, ORDER_TOOLS, PAYMENT_LINK_TOOL, type CancellableOrder, type CreateOrderRequest, type OrderTools, type PaymentLinkTool, type ToolResult } from './order-tools';
import { ConfigService } from '../../../core/config/config.service';
import { aiDateTime } from '../../../core/time/algiers';
import { contextOf } from '../../messaging/messaging.presenter';
import { FlagsService } from '../../../core/flags/flags.service';
import { articleless, fold, foldText, WILAYA_ALIASES } from './wilaya-aliases';
import { handoffReason, handoffRefusedInstruction, judgeHandoff } from '../handoff-judge';
import { asksCancel, bareYes, cancelWordsIn, confirmation, coreKey, draftKey, latestRecap, wantsCancel, wordingChangedNow, hasDraft, isPlaceholderName, orderedBefore, phoneCheckAsked, phonesIn, placedNumbers, simulatedOrders, type DraftOrder, type OrderCallHistory } from './order-confirmation';
import { asksSomething, withoutPlaceSegments } from './order-confirmation-text';

export type ToolName = 'search_products' | 'get_product' | 'check_availability' | 'quote_delivery' | 'create_order' | 'cancel_order' | 'lookup_order' | 'handoff_to_human' | 'add_faq_candidate' | 'create_payment_link';
export type ToolRunContext = {
  workspaceId: string;
  agent: Agent;
  conversationId: string | null;
  clientId: string | null;
  channelId: string | null;
  runId: string;
  callId: string;
  dryRun: boolean;
  /** retest 12/11: the customer's words of the message(s) being answered — a handoff is checked against them (handoff-judge) */
  customerText?: string;
  /** unclear turns in a row before this one */
  unclearStreak?: number;
  /** full-test 15/11 AI-CHAT-01: the `create_order` results of the EARLIER runs of this conversation / playground session (recaps shown) */
  orderHistory?: OrderCallHistory;
  /** full-test 15/11 AI-CHAT-01: every customer message of the conversation (the phone of an order must be one of theirs) */
  customerHistory?: string;
  /** full-test 15/11 proposal 9: an order is being taken (the customer chose a product, `context.chosen`) */
  ordering?: boolean;
  /** journey retest R4-1: the server reasons the earlier tool results of this turn established (handoff-judge `establishedReasons`) */
  established?: string[];
};

/** journey 16/11 J04-7: an FAQ suggestion that carries a customer's phone, address or « Cliente X » (a note about one customer). */
export const personalNote = (question: string): boolean =>
  phonesIn(question).size > 0 ||
  /(?<!\p{L})(cit[eé]|logements?|bloc|lotissement|r[eé]sidence|villa|b[aâ]timent)(?!\p{L})|حي |عمارة/iu.test(question) ||
  // « Cliente Samira Benali … » (a name right after the word, not « le client demande si… »)
  /(?<!\p{L})(?:[Cc]liente?|[Cc]ustomer)\s+\p{Lu}\p{Ll}+/u.test(question);

/** Plain status words the model may relay (04-ai-pipeline §4.2) — never the courier's raw status code. */
const SHIPMENT_STATUS_FOR_AI: Record<string, string> = {
  pending: 'being handed to the courier',
  sent: 'registered with the courier, waiting for pick-up',
  picked_up: 'picked up by the courier',
  in_transit: 'in transit',
  out_for_delivery: 'out for delivery',
  delivered: 'delivered',
  failed: 'delivery attempt failed',
  returned: 'returned to the shop',
  cancelled: 'shipment cancelled',
  stale: 'no recent update from the courier',
};

/**
 * `lookup_order` `lastEvent.label`: the courier's own sentence when a courier event carries one that is not its status
 * code, else the plain words of the mapped status, else null. Staff notes (manual / system events) and raw courier codes
 * never reach the model, so never a customer.
 */
export const shipmentEventLabel = (e: { rawStatus: string; mappedStatus: string | null; description: string | null; source: string }): string | null => {
  const courierText = (e.source === 'webhook' || e.source === 'poll') && e.description?.trim() && e.description.trim() !== e.rawStatus.trim() ? e.description.trim() : null;
  return courierText ?? (e.mappedStatus ? (SHIPMENT_STATUS_FOR_AI[e.mappedStatus] ?? null) : null);
};

export const TOOL_ALIASES: Record<string, ToolName> = { get_shipping_fee: 'quote_delivery', get_order_status: 'lookup_order' };
export const canonicalTool = (name: string): string => TOOL_ALIASES[name] ?? name;

export const TOOL_DEFS: Record<ToolName, AiToolDef> = {
  search_products: {
    name: 'search_products',
    description: 'Find products in the shop catalogue by free text (name, keywords, category, colour, size).',
    parameters: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 } } },
  },
  get_product: {
    name: 'get_product',
    description: 'Full details of one catalogue product (description, variants with stock, recommendations).',
    parameters: { type: 'object', required: ['productId'], additionalProperties: false, properties: { productId: { type: 'string' } } },
  },
  // full-test 15/11 proposal 2 (C05 T1, C07 T4, C02 T5): a real stock / quantity check, so create_order is never a probe
  check_availability: {
    name: 'check_availability',
    description: 'Can this quantity of a product (or of one of its variants) be ordered now? Use it for any stock or quantity question. It never gives a stock count unless the quantity is short; never call create_order to check.',
    parameters: { type: 'object', required: ['productId'], additionalProperties: false, properties: { productId: { type: 'string' }, variantId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, default: 1 } } },
  },
  quote_delivery: {
    name: 'quote_delivery',
    description: "Delivery fee for a wilaya from the merchant's grid (home or stop-desk). Apply free-delivery threshold. Give wilayaId or wilayaName.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { wilayaId: { type: 'integer', minimum: 1, maximum: WILAYA_COUNT }, wilayaName: { type: 'string' }, isStopdesk: { type: 'boolean', default: false }, subtotal: { type: 'integer', minimum: 0 } },
      // no top-level anyOf (Anthropic refuses it): `quote` answers INVALID_ARGS when both are missing
    },
  },
  create_order: {
    name: 'create_order',
    description: 'Cash-on-delivery order. Call it only once the customer wrote their name, phone number and (home delivery) address in the conversation — never a placeholder or a guessed value (0000000000, 0500000000, « Client », a wilaya they did not name): ask for what is missing instead; never call it to test a phone number or to find out which field is missing (read the conversation: the product, name, phone and wilaya must each be in the customer\'s own messages or KNOWN CUSTOMER before the first call). First call: returns CONFIRMATION_REQUIRED with the recap to show — nothing is ordered; every recap (a change of a placed order too, with replacesOrder) comes from this first call. Call again with the same values only after the customer answered yes in a later message.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['clientName', 'clientPhone', 'wilayaId', 'items', 'customerConfirmed'],
      properties: {
        clientName: { type: 'string', minLength: 3, maxLength: 80, description: 'the name exactly as the customer wrote it, in the script they used (« وليد بوزيد » stays in Arabic letters, never « Walid Bouzid ») — never « Client », « Customer » or another placeholder' },
        clientPhone: { type: 'string', pattern: '^(\\+213|00213|0)?[5-7][0-9]{8}$' },
        secondPhone: { type: 'string', description: 'the other number when the customer gave two (« 0661… ou 0770… »): keep both, never ask which one to keep' },
        wilayaId: { type: 'integer', minimum: 1, maximum: WILAYA_COUNT },
        communeName: { type: 'string', maxLength: 100 },
        address: { type: 'string', maxLength: 500, description: 'home delivery: the street, cité / building or landmark the customer wrote — never only the commune or wilaya name' },
        isStopdesk: { type: 'boolean', default: false },
        stopdeskId: { type: 'string' },
        items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', required: ['productId', 'quantity'], properties: { productId: { type: 'string' }, variantId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } } } },
        notes: { type: 'string', maxLength: 500 },
        customerConfirmed: { const: true },
        phoneConfirmed: { type: 'boolean', description: 'true once the customer re-confirmed the phone number when a tool asked for it' },
        replacesOrder: { type: 'string', maxLength: 30, description: "number of THIS customer's order that the new one replaces (other product, size, quantity or address): the new order is created first, then that one is cancelled" },
      },
    },
  },
  cancel_order: {
    name: 'cancel_order',
    description: "Cancel one of THIS customer's orders that the shop has NOT confirmed yet. Never creates an order; to change an order use create_order with replacesOrder.",
    parameters: { type: 'object', additionalProperties: false, properties: { orderNumber: { type: 'string' }, reason: { type: 'string', maxLength: 200 }, customerConfirmed: { type: 'boolean' } } },
  },
  lookup_order: {
    name: 'lookup_order',
    description:
      "Where are the customer's orders: order status, delivery status, courier, tracking number, tracking link (trackingUrl) and last courier event. Without arguments: the orders of this customer (this conversation, or the phone they ordered with). An order placed by phone or from another account: give the phone number used for it, or the parcel's tracking number.",
    parameters: { type: 'object', additionalProperties: false, properties: { orderNumber: { type: 'string' }, phone: { type: 'string', description: 'phone number the order was placed with (05/06/07…)' }, trackingNumber: { type: 'string' } } },
  },
  handoff_to_human: {
    name: 'handoff_to_human',
    description: "Escalate to the merchant team, only when the customer's CURRENT message matches one of the HANDOFF rules (reason = that rule id; reason=other only for a « Shop rules » item). evidence = the customer's exact words from that message. Never for a greeting, a photo, an earlier message, a question you cannot answer (status=UNKNOWN) or a stock problem (offer what is available); never called without a reason and the evidence, nor to find out whether a handoff applies.",
    parameters: { type: 'object', required: ['reason', 'evidence'], additionalProperties: false, properties: { reason: { enum: [...HANDOFF_REASONS] }, evidence: { type: 'string', maxLength: 300, description: "the customer's exact words, from their current message, that match the rule" }, detail: { type: 'string', maxLength: 200 } } },
  },
  add_faq_candidate: {
    name: 'add_faq_candidate',
    description: "Record a general customer question the shop has no answer for, so the merchant can add it to the FAQ (« Quelle est l'adresse de la boutique ? »). Never the customer's name, phone or address, never an order or a call-back note: it records nothing for this customer.",
    parameters: { type: 'object', required: ['question'], additionalProperties: false, properties: { question: { type: 'string', maxLength: 300 }, topic: { type: 'string', maxLength: 80 } } },
  },
  /** enabledWhen: workspace.onlinePaymentEnabled && flag `online_payment` (P2 — offered since M9). */
  create_payment_link: {
    name: 'create_payment_link',
    description: 'Create an online payment link (Chargily: CIB / Edahabia card, valid 15 minutes) for an order of THIS customer, only when the customer asks to pay online. Give the returned url to the customer; cash on delivery stays possible.',
    parameters: { type: 'object', required: ['orderId'], additionalProperties: false, properties: { orderId: { type: 'string', description: 'order id or order number (CMD-1001)' } } },
  },
};
/** §4.2 "Tool availability per run": order-taking is always on (D23); the payment link is conditional. */
export const RUN_TOOLS: ToolName[] = ['search_products', 'get_product', 'check_availability', 'quote_delivery', 'lookup_order', 'add_faq_candidate', 'handoff_to_human', 'create_order', 'cancel_order'];

const invalid = (field: string, example?: string | number): ToolResult => ({ ok: false, error: { code: 'VALIDATION', field, ...(example !== undefined ? { example } : {}) } });
const str = z.string().trim();
const SearchArgs = z.object({ query: str.min(1).max(200), limit: z.coerce.number().int().min(1).max(30).default(10) });
const QuoteArgs = z.object({ wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT).optional(), wilayaName: str.max(120).optional(), isStopdesk: z.boolean().default(false), subtotal: z.coerce.number().int().min(0).optional() });
const OrderArgs = z.object({
  clientName: str.min(3).max(80),
  clientPhone: str.min(1).max(30),
  secondPhone: str.max(30).optional(),
  wilayaId: z.coerce.number().int().min(1).max(WILAYA_COUNT),
  communeName: str.max(100).optional(),
  address: str.max(500).optional(),
  isStopdesk: z.boolean().default(false),
  stopdeskId: str.max(80).optional(),
  items: z.array(z.object({ productId: str.min(1), variantId: str.optional(), quantity: z.coerce.number().int().min(1) })).min(1).max(20),
  notes: str.max(500).optional(),
  customerConfirmed: z.unknown().optional(),
  phoneConfirmed: z.boolean().optional(),
  replacesOrder: str.max(30).optional(),
});
const EXAMPLES: Record<string, string | number> = { clientName: 'Amine Benali', clientPhone: '0555123456', secondPhone: '0661123456', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité 200 logements, Bt 4, Bab Ezzouar', quantity: 1 };
/**
 * journey retest R1-5: the required `create_order` fields absent from the call (not the invalid ones: a wrong phone or a
 * short address keep their own VALIDATION answer with an example), in the order they are asked.
 */
export const absentFields = (args: Record<string, unknown>, agent: Pick<ToolRunContext['agent'], 'orderFields'>): string[] => {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const fields = Array.isArray(agent.orderFields) ? (agent.orderFields as unknown as { key: string; required: boolean }[]) : [];
  const required = new Set(fields.length ? fields.filter((f) => f.required).map((f) => f.key) : ['commune', 'address']);
  const stopdesk = args.isStopdesk === true;
  const out: string[] = [];
  if (!Array.isArray(args.items) || !args.items.length) out.push('items');
  if (!text(args.clientName)) out.push('clientName');
  if (!text(args.clientPhone)) out.push('clientPhone');
  if (!text(args.wilayaId)) out.push('wilayaId');
  if (!stopdesk && required.has('commune') && !text(args.communeName)) out.push('communeName');
  if (!stopdesk && !text(args.address)) out.push('address');
  return out;
};
/** An order line as read from a malformed `items` value: the product id candidates its `productId` held (one, or several). */
export type ItemArg = { productId: string; variantId?: string; quantity: number; candidates: string[] };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** One line object (a parsed object, or the text of one `{…}`) ⇒ an `ItemArg`, null when it holds no product nor variant id. */
const itemOf = (o: unknown): ItemArg | null => {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    const r = o as Record<string, unknown>;
    const pid = typeof r.productId === 'string' ? r.productId.trim() : '';
    const vid = typeof r.variantId === 'string' && r.variantId.trim() ? r.variantId.trim() : undefined;
    const q = Number(r.quantity ?? 1);
    const ids = [...new Set(pid.match(UUID_RE) ?? [])];
    const candidates = ids.length ? ids : pid ? [pid] : [];
    if (!candidates.length && !vid) return null;
    return { productId: candidates.length === 1 ? candidates[0]! : (candidates[0] ?? ''), ...(vid ? { variantId: vid } : {}), quantity: Number.isInteger(q) && q >= 1 ? q : 1, candidates };
  }
  if (typeof o !== 'string') return null;
  // the text of one object that is no JSON (« "productId": "…".replace("…","…"), "variantId": "…", "quantity": 1 »)
  const body = o.replace(/^\s*\{|\}\s*$/g, '');
  const pidText = /["']?productId["']?\s*:\s*([\s\S]*?)\s*(?:,\s*["']?(?:variantId|quantity)["']?\s*:|$)/u.exec(body)?.[1] ?? '';
  const vid = /["']?variantId["']?\s*:\s*["']([^"']+)["']/u.exec(body)?.[1]?.trim();
  const qty = /["']?quantity["']?\s*:\s*["']?(\d{1,3})/u.exec(body)?.[1];
  const ids = [...new Set(pidText.match(UUID_RE) ?? [])];
  const plain = /^["']([^"']+)["']$/u.exec(pidText.trim())?.[1]?.trim();
  const candidates = ids.length ? ids : plain ? [plain] : [];
  if (!candidates.length && !vid) return null;
  return { productId: candidates[0] ?? '', ...(vid ? { variantId: vid } : {}), quantity: qty ? Math.max(1, Number(qty)) : 1, candidates };
};
/**
 * journey retest R11-1 (17/11): `items` sent as something else than an array of objects — a JSON string, one object, an array of
 * JSON strings, or code (F1b T3: `"[{\"productId\": \"…\".replace(\"…\",\"…\"), \"variantId\": \"…\", \"quantity\": 1}]"`, refused
 * « the customer has not given items yet » although the product was named). The lines it can be read into (the product id
 * candidates of each line are settled against the shop's products by `create_order`), else null. An array of objects is returned
 * as it is (`normalized: false`).
 */
export const itemsFromArg = (raw: unknown): { items: unknown[]; normalized: boolean } | null => {
  if (Array.isArray(raw) && raw.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return { items: raw, normalized: false };
  const parse = (t: string): unknown => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  let value: unknown = raw;
  if (typeof value === 'string') {
    const parsed = parse(value.trim());
    if (parsed !== undefined) value = parsed;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) value = [value];
  let lines: ItemArg[] | null = null;
  if (Array.isArray(value)) {
    const read = value.map((x) => (typeof x === 'string' ? (parse(x.trim()) !== undefined ? itemOf(parse(x.trim())) : itemOf(x)) : itemOf(x)));
    lines = read.length && read.every((x): x is ItemArg => !!x) ? read : null;
  } else if (typeof value === 'string') {
    const objects = value.match(/\{[^{}]*\}/g) ?? [];
    const read = objects.map(itemOf);
    lines = read.length && read.every((x): x is ItemArg => !!x) ? read : null;
  }
  return lines ? { items: lines, normalized: true } : null;
};
/** journey retest R11-1: the precise answer to an `items` value that cannot be read (never « not given yet »: the product was named). */
export const malformedItemsResult = (): ToolResult => ({
  ok: false,
  error: { code: 'VALIDATION', field: 'items', malformed: true, example: '[{"productId":"<ID>","variantId":"<VID>","quantity":1}]' },
  say: 'items could not be read: send it as a JSON array of objects { "productId": "<ID of the CATALOGUE>", "variantId": "<VID>" (when the product has variants), "quantity": <number> } — never a string, a code expression or text. Nothing is wrong with the customer\'s details: call create_order again now with the same other values and items as an array. Never ask the customer for the product again and never ask them to confirm.',
});
type WilayaRow = { id: number; code: string; nameFr: string; nameAr: string };
/**
 * The wilaya a customer text names — the official name (fr / ar), the code, a known spelling (`WILAYA_ALIASES`), also inside a
 * longer answer (« pour Oran svp », « wilaya de Sétif »): the longest phrase wins. `quote_delivery` and `create_order` share it.
 */
export const matchWilaya = <W extends WilayaRow>(all: W[], text: string): W | null => {
  const wanted = fold(text);
  if (!wanted) return null;
  const exact = all.find((w) => fold(w.nameFr) === wanted || fold(w.nameAr) === wanted || w.code === wanted || String(w.id) === wanted);
  if (exact) return exact;
  const alias = WILAYA_ALIASES[wanted];
  if (alias) return all.find((w) => w.id === alias) ?? null;
  // journey retest R12-1 (17/11): inside a longer text every word loses its article (« … بوفاريك، البليدة », « ana f el Oued »), on
  // both sides — `fold` only drops it at the very start
  const padded = ` ${articleless(wanted)} `;
  const longest = (pairs: [string, number][]) => pairs.filter(([n]) => n && padded.includes(` ${n} `)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  const id = longest(all.flatMap((w) => [[articleless(fold(w.nameFr)), w.id], [articleless(fold(w.nameAr)), w.id]] as [string, number][])) ?? longest(Object.entries(WILAYA_ALIASES).filter(([a]) => /\p{L}/u.test(a)).map(([a, v]) => [articleless(a), v] as [string, number]));
  return id ? (all.find((w) => w.id === id) ?? null) : null;
};
/**
 * journey retest R2-4: did the customer name this wilaya in the conversation (one of their messages, « wilaya 16 »), or a
 * commune of it (« Bab Ezzouar » ⇒ Alger)? `create_order { wilayaId: 1 }` sent before any wilaya was named (Adrar as a default)
 * is refused like an absent field.
 */
export const wilayaNamed = (all: WilayaRow[], wilayaId: number, history: string, commune?: { given: string | null; ofWilaya: { nameFr: string; nameAr: string }[] }): boolean => {
  // a bare number (« 1 » as a quantity) never names a wilaya: only « wilaya 16 » below
  const lines = history.split(/\n+/).map((l) => l.trim()).filter((l) => /\p{L}/u.test(l));
  if (lines.some((l) => matchWilaya(all, l)?.id === wilayaId)) return true;
  if (new RegExp(`(?<![\\p{L}\\p{N}])(?:wilaya|ولاية)\\s*(?:n°|no|رقم)?\\s*0?${wilayaId}(?!\\p{N})`, 'iu').test(history)) return true;
  // a commune the customer wrote, of this wilaya (or of no known spelling: the model's inference is not an invention)
  // journey retest R12-1 (17/11): written in either script — the call's « Boufarik » / « El Khroub » for the customer's « بوفاريك » /
  // « الخروب » (N21 T4, N18 T2 were refused as « never written by the customer »): the commune's other name of the place index counts
  const given = commune?.given ? placeFold(commune.given) : '';
  if (!given) return false;
  const rows = commune!.ofWilaya.filter((c) => samePlace(c.nameFr, commune!.given!) || samePlace(c.nameAr, commune!.given!));
  const spellings = [commune!.given!, ...rows.flatMap((c) => [c.nameFr, c.nameAr])];
  if (spellings.some((n) => placeWritten(history, n))) return !commune!.ofWilaya.length || rows.length > 0;
  return false;
};
/** journey retest R12-1: two place names are the same once folded, with or without their articles (« El Khroub » = « Khroub »). */
export const samePlace = (a: string, b: string): boolean => {
  const x = placeFold(a);
  const y = placeFold(b);
  return !!x && !!y && (x === y || articleless(x) === articleless(y));
};
/** journey retest R12-1: the customer's text names this place — as whole words, any punctuation of any script, articles or not. */
export const placeWritten = (text: string, name: string): boolean => {
  const n = placeFold(name);
  if (!n) return false;
  const t = placeFold(text);
  if (` ${t} `.includes(` ${n} `)) return true;
  const bare = articleless(n);
  return bare.replace(/\s/g, '').length >= 3 && ` ${articleless(t)} `.includes(` ${bare} `);
};
/**
 * journey retest R3-3 (17/11): is this `clientName` the customer's? Never a placeholder (« Client », « Client Messenger »,
 * « زبون »); otherwise one of its words is in their messages or the client record (`sources`). A name in a script the customer
 * never wrote in (« سمير » sent as « Samir ») cannot be compared and is accepted.
 */
export const nameGiven = (name: string, sources: string): boolean => {
  if (isPlaceholderName(name)) return false;
  const tokens = placeFold(name).split(' ').filter((t) => t.length >= 2);
  if (!tokens.length) return false;
  const hay = ` ${placeFold(sources)} `;
  if (tokens.some((t) => hay.includes(` ${t} `))) return true;
  return !(/[؀-ۿ]/.test(name) ? /[؀-ۿ]/ : /[A-Za-z]/).test(sources);
};
/** journey retest R8-2: the Latin first letters an Arabic-script letter is written with (« و » → w / o / ou / v…). */
const ARABIC_INITIAL: Record<string, string> = {
  ا: 'aeiou3', أ: 'aeiou3', إ: 'aeiou3', آ: 'aeiou3', ع: 'aeiou3', ء: 'aeiou3', ئ: 'aeiouy3', ب: 'bp', ت: 't', ث: 't', ج: 'djg', ح: 'h7', خ: 'kh5', د: 'd', ذ: 'dz', ر: 'r', ز: 'z', س: 'sc', ش: 'cs', ص: 's', ض: 'd', ط: 't', ظ: 'dz', غ: 'gr', ف: 'f', ق: 'kqg9', ك: 'kc', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'wouv', ي: 'yie',
};
const ARABIC_LETTERS = /[؀-ۿ]/;
/**
 * The call's name is the customer's name written in the other script: each of its words starts with a letter the customer's word
 * at the same place may be written with (« Walid Bouzid » / « وليد بوزيد », « Samir » / « سمير بن علي ») — never more words than
 * the customer wrote.
 */
const sameNameAcross = (customer: string, call: string): boolean => {
  const arabicCustomer = ARABIC_LETTERS.test(customer);
  const c = (arabicCustomer ? customer.split(/\s+/) : placeFold(customer).split(' ')).filter(Boolean);
  const k = (arabicCustomer ? placeFold(call).split(' ') : call.trim().split(/\s+/)).filter(Boolean);
  if (!k.length || k.length > c.length) return false;
  const fits = (arabic: string, latin: string) => (ARABIC_INITIAL[arabic.replace(/^ال(?=\S{2})/, '')[0] ?? ''] ?? '').includes(latin[0] ?? '#');
  return k.every((w, i) => (arabicCustomer ? fits(c[i]!, w) : fits(w, c[i]!)));
};
/** « smiti / اسمي / je m'appelle / my name is … »: the words after it in one script, up to a digit, a comma or the other script. */
const NAME_INTRO_AT = /(?<![\p{L}])(?:smiti|esmi|ismi|asmi|smiya\s+ta3i|je\s+m['’]?\s*appelle|moi\s+c['’]?est|mon\s+nom\s+(?:est|c['’]?est)|my\s+name\s+is|اسمي|إسمي|سميتي)\s+/giu;
/** The words that start `rest` in this script (Arabic, or Latin letters), at most 4, up to a digit, a comma or the other script. */
const leadingWords = (rest: string, arabic: boolean): string | null => {
  const words: string[] = [];
  for (const w of rest.trim().split(/\s+/)) {
    // journey retest R12-1: any punctuation of any script around the word (« ؛ », quotes, « ‚ ») ends it like « , »
    const bare = w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    if (!bare || !(arabic ? /^[؀-ۿ]+$/u.test(bare) : /^[A-Za-zÀ-ÿ'’-]+$/u.test(bare))) break;
    words.push(bare);
    if (words.length === 4 || bare !== w) break;
  }
  return words.length ? words.join(' ') : null;
};
/** Arabic-script words that are no name (yes, thanks, greetings, order words) — a line made of one of them is not a name. */
const NOT_A_NAME = /(?<![؀-ۿ])(?:نعم|ايه|إيه|واه|لا|شكرا|صحيت|السلام|عليكم|سلام|مرحبا|نحب|حاب|نشري|بغيت|حي|شارع|عمارة|ولاية|بلدية|قداش|شحال|واش|وين|كيفاش|تمام|صافي|الطلبية|طلبية|التوصيل)(?![؀-ۿ])/u;
/**
 * journey retest R8-2 (17/11): the name the customer wrote in the other script than the call's (« smiti وليد بوزيد » for the call's
 * « Walid Bouzid »): the server keeps the customer's own text. Found after a name intro (« smiti », « اسمي », « je m'appelle ») or,
 * for Arabic script, as a message of one to four Arabic words and nothing else; it must be the same name (`sameNameAcross`).
 */
export const customerOwnName = (callName: string, history: string): string | null => {
  const latinCall = !ARABIC_LETTERS.test(callName) && /[A-Za-z]/.test(callName);
  const arabicCall = ARABIC_LETTERS.test(callName) && !/[A-Za-z]/.test(callName);
  if (!latinCall && !arabicCall) return null;
  const found: string[] = [];
  for (const raw of history.split(/\n+/)) {
    const line = raw.trim();
    for (const m of line.matchAll(NAME_INTRO_AT)) {
      const run = leadingWords(line.slice((m.index ?? 0) + m[0].length), latinCall);
      if (run) found.push(run);
    }
    if (latinCall && /^[\u0600-ۿ]+(?:\s+[\u0600-ۿ]+){0,3}[\s\p{P}\p{S}]*$/u.test(line)) found.push(line.replace(/[\s\p{P}\p{S}]+$/u, ''));
  }
  const same = found.filter((name) => !NOT_A_NAME.test(name) && sameNameAcross(name, callName));
  return same.length ? same[same.length - 1]! : null;
};
/** The numbers of a text (Arabic-Indic digits read as Latin), sorted: « حي 1000 مسكن عمارة 5 » and « Cité 1000 logements, immeuble 5 » give « 1000 5 ». */
const numbersKey = (t: string) => [...placeFold(t).matchAll(/\d+/gu)].map((m) => m[0]).sort().join(' ');
/** A phone number inside a text (05 / 06 / 07, 10 digits, spaced or not; +213). */
const PHONE_IN_TEXT = /(?:\+?213[\s.-]?|0)[5-7](?:[\s.-]?\d){8}/gu;
/**
 * journey retest R13-3 (18/11): the street address as the customer wrote it, when the call's street is a translation of it — N18b T2
 * « Cité 1000 logements, immeuble 5 » for the customer's « حي 1000 مسكن عمارة 5 », kept in the recap and the order. As the name rule
 * (R8-2): no word of the call's street is in the customer's messages, and their latest message with an address (a street / building
 * word: « حي », « cité », « rue », « bloc » …) gives the same numbers (or, with no number, is written in the other script). The
 * customer's text runs from that word (and the numbers just before it) to the end of the message, without the phone and the
 * commune / wilaya names (`placeNames`). Null when the call's street is the customer's own (a word of it was written) or none fits.
 */
export const customerOwnStreet = (callStreet: string, history: string, placeNames: (string | null | undefined)[]): string | null => {
  const words = placeFold(callStreet).split(' ').filter((w) => w.length >= 2 && /\p{L}/u.test(w));
  if (!words.length) return null;
  const hay = ` ${placeFold(history)} `;
  const bare = ` ${articleless(placeFold(history))} `;
  const lines = history.split(/\n+/u).map((l) => l.trim()).filter(Boolean).reverse();
  /** The street of an address message as the customer typed it: from the address word (and the numbers just before it) to the end, without the phone and the place names. */
  const ownStreetOf = (line: string): string | null => {
    const segments = line.split(/\s*[,،;؛]\s*|\s+[-–—]\s+/u);
    const i = segments.findIndex((x) => ADDRESS_WORDS.test(x));
    if (i < 0) return null;
    const first = segments[i]!;
    const m = ADDRESS_WORDS.exec(first)!;
    // « 1000 logements bloc 5 »: the numbers just before the address word belong to it
    const lead = /(?:(?:n°|no|رقم)?\s*\d+\s*)+$/u.exec(first.slice(0, m.index))?.[0] ?? '';
    const tail = [first.slice(m.index - lead.length), ...segments.slice(i + 1)].map((x) => x.replace(PHONE_IN_TEXT, ' ').replace(/\s+/gu, ' ').trim()).filter((x) => /\p{L}|\d/u.test(x));
    return withoutPlaceSegments(tail.join(ARABIC_LETTERS.test(first) ? '، ' : ', '), placeNames).trim();
  };
  if (words.some((w) => hay.includes(` ${w} `) || bare.includes(` ${articleless(w)} `))) {
    // journey retest R15-4 (18/11): the call's street is the customer's own words re-typed — accents or a comma added (F3 T4 « Cité 20
    // Août, villa 3 » for « cite 20 aout villa 3 »): the customer's text is kept as they typed it (a capital letter alone changes nothing)
    for (const line of lines) {
      const own = ownStreetOf(line);
      if (own && /\p{L}/u.test(own) && own.toLocaleLowerCase() !== callStreet.toLocaleLowerCase() && placeFold(own) === placeFold(callStreet)) return own;
    }
    return null;
  }
  const digits = numbersKey(callStreet);
  const arabicCall = ARABIC_LETTERS.test(callStreet);
  for (const line of lines) {
    const own = ownStreetOf(line);
    if (own === null) continue;
    if (!/\p{L}/u.test(own) || numbersKey(own) !== digits) continue;
    if (!digits && ARABIC_LETTERS.test(own) === arabicCall) continue;
    return own;
  }
  return null;
};
/** A word of a size / measure before a short variant name (« taille M », « en 42 », « pointure 40 »). */
const SIZE_CUE = /(?:taille|tailles|pointure|size|ma9as|m9as|mqas|en|t|n°|num|numero|numéro|مقاس|المقاس|قياس|نمرة|رقم)\s*$/iu;
/** Address / phone segments of a message: a colour or size there names no variant (« Cité les Roses », « bloc 42 »). */
const ADDRESS_WORDS = /(?<![\p{L}])(?:rue|cite|cité|bloc|bt|bat|batiment|villa|logements?|lgts?|quartier|hay|hai|residence|lotissement|lot|route|avenue|av|boulevard|bd|impasse|douar|village|immeuble|appartement|etage|street|road|building|apartment|floor|حي|شارع|عمارة|بلوك|فيلا|مسكن|طريق)(?![\p{L}])/iu;
/** The variants of this product a message names (whole words; a short name such as « M » or « 42 » only after a size word). */
const variantsNamedIn = (variants: { id: string; name: string }[], line: string): { id: string; name: string }[] => {
  const segments = line.split(/[,،;؛.!?؟…\n]+/).filter((s) => !ADDRESS_WORDS.test(s) && !/\d{8,}/.test(s.replace(/[\s.-]/g, '')));
  const out: { id: string; name: string }[] = [];
  for (const v of variants) {
    const key = placeFold(v.name);
    if (!key) continue;
    const long = key.replace(/\s/g, '').length >= 3 && /\p{L}/u.test(key);
    const hit = segments.some((seg) => {
      const f = ` ${placeFold(seg)} `;
      if (!f.includes(` ${key} `)) return false;
      if (long) return true;
      // « M », « XL », « 42 »: only right after a size word
      const at = f.indexOf(` ${key} `);
      return SIZE_CUE.test(f.slice(0, at + 1).trimEnd());
    });
    if (hit) out.push(v);
  }
  return out;
};
/**
 * journey retest R8-3 (17/11): the variant of this product the customer named last (« le sac à main cuir marron » ⇒ Marron) —
 * the latest message naming exactly one of its variants; a message naming two (« noir ou marron ? ») leaves it to the call.
 */
export const namedVariant = <V extends { id: string; name: string }>(variants: V[], history: string): V | null => {
  const lines = history.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    const named = variantsNamedIn(variants, line);
    if (named.length === 1) return variants.find((v) => v.id === named[0]!.id) ?? null;
    if (named.length > 1) return null;
  }
  return null;
};
/** Lower case, accents / Arabic marks / tatweel removed, hamza / tā' marbūṭa / alif maqṣūra folded, Arabic-Indic digits ⇒ Latin, anything else than letters and digits (the punctuation of every script) ⇒ space — `foldText` (journey retest R12-1). */
export const placeFold = (t: string) => foldText(t);
/** Words of an address that name no street, building or landmark. */
const PLACE_FILLERS = new Set(['wilaya', 'commune', 'daira', 'de', 'du', 'des', 'd', 'la', 'le', 'l', 'a', 'au', 'en', 'w', 'f', 'fi', 'el', 'al', 'centre', 'center', 'ville', 'city', 'algerie', 'algeria', 'dz', 'ولايه', 'بلديه', 'دائره', 'في', 'ب', 'و', 'وسط', 'مدينه', 'المدينه', 'الجزائر'].map((w) => foldText(w)));
/**
 * journey retest R2-2: a home-delivery address that is only the commune / wilaya name (« Bab Ezzouar », « Bab Ezzouar, Alger »,
 * « Boufarik centre ») — no street, cité, building or landmark. `places`: the names of the wilaya and of its communes.
 */
export const placeOnlyAddress = (address: string, places: string[], wilayaId?: number): boolean => {
  let w = ` ${placeFold(address)} `;
  const names = [...new Set(places.map(placeFold).filter(Boolean).flatMap((p) => [p, p.replace(/^(?:el|al|ال)\s*/, '')]))].filter((p) => p.length >= 2).sort((a, b) => b.length - a.length);
  for (const n of names) while (w.includes(` ${n} `)) w = w.replace(` ${n} `, ' ');
  const rest = w.trim().split(/\s+/).filter((x) => x && !PLACE_FILLERS.has(x) && !/^\d{5}$/.test(x) && x !== String(wilayaId ?? '') && x !== `0${wilayaId ?? ''}`);
  return rest.length === 0;
};
/** A correction between two numbers (« non, plutôt », « pardon », « machi »): the second one replaces the first. */
const PHONE_CORRECTION = /(?<![\p{L}])(?:non|nn|pardon|plutot|erreur|errone|corrig\S*|remplac\S*|chang\S*|nouveau|nouvelle|jdid|jdida|machi|mchi|lala|bedel|beddel|instead|rather|sorry|wrong|ماشي|غالط|بدل|لالا|لا)(?![\p{L}])/u;
/**
 * journey retest R4-6 (17/11): the customer's other phone number, when one message gave two (« 0661234568 ou 0770998877 »)
 * with this one, without a correction between them, and no later message chose one of the two.
 */
export const otherPhoneGiven = (history: string, main: string): string | null => {
  let other: string | null = null;
  for (const line of history.split(/\n+/)) {
    const phones = [...phonesIn(line)].filter((p) => isPhoneDz(p));
    if (phones.length === 2 && phones.includes(main) && !PHONE_CORRECTION.test(fold(line))) other = phones.find((p) => p !== main) ?? null;
    // a later message with only one of the two numbers chose it (« gardez le 0661234568 »)
    else if (other && phones.length === 1 && (phones[0] === main || phones[0] === other)) other = null;
  }
  return other;
};
/** The agent asks for a second phone (default fields, or `phone2` in « Prise de commande »). */
const phone2Field = (agent: ToolRunContext['agent']): boolean => {
  const fields = Array.isArray(agent.orderFields) ? (agent.orderFields as unknown as { key: string }[]) : [];
  return !fields.length || fields.some((f) => f.key === 'phone2');
};
/** journey retest R2-7: the Arabic name of the commune of the order, when it is one of the wilaya's list. */
export const communeAr = (communes: { nameFr: string; nameAr: string }[], name: string | null | undefined): string | null => {
  const n = name ? placeFold(name) : '';
  return (n && communes.find((c) => samePlace(c.nameFr, n) || samePlace(c.nameAr, n))?.nameAr) || null;
};
/** journey retest R7-4: the variant of this product a mistyped variant id stands for (one or two characters off). */
const fixedVariant = (p: CatalogueProduct, variantId: string | null): CatalogueProduct['variants'][number] | null => {
  const near = variantId ? nearestId(variantId, p.variants.map((x) => x.id)) : null;
  return near ? (p.variants.find((x) => x.id === near) ?? null) : null;
};
const normQuestion = (q: string) => fold(q).replace(/\s+/g, ' ').slice(0, 200);
const seqOf = (s: string) => 1000 + ([...s].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 9000);

@Injectable()
export class ToolRegistry {
  constructor(
    private readonly catalogue: CatalogueService,
    @Inject(ORDER_TOOLS) private readonly orders: OrderTools,
    @Inject(PAYMENT_LINK_TOOL) private readonly paymentLinks: PaymentLinkTool,
    private readonly flags: FlagsService,
    private readonly config: ConfigService,
  ) {}

  /** Tools offered to the model for this run. */
  defs(): AiToolDef[] {
    return RUN_TOOLS.map((n) => TOOL_DEFS[n]);
  }

  /** §4.2 "Tool availability per run": + `create_payment_link` when the workspace switched online payment on. */
  async defsFor(workspaceId: string): Promise<AiToolDef[]> {
    const base = this.defs();
    if (!(await this.paymentLinks.enabledFor(workspaceId))) return base;
    if (!(await this.flags.isEnabledOr('online_payment', workspaceId, true))) return base;
    return [...base, TOOL_DEFS.create_payment_link];
  }

  /**
   * A tool result that ends the turn with the team: `handoff_to_human`, or a write tool the platform could not perform.
   * Returns the handoff reason, else null.
   */
  forcedHandoff(name: string, args: Record<string, unknown>, result: unknown): string | null {
    if (canonicalTool(name) === 'handoff_to_human') {
      // retest 11/11: a handoff without a rule was refused by the tool — the model answers instead, the thread stays with it
      if ((result as { error?: { code?: unknown } } | null)?.error?.code === 'HANDOFF_NOT_NEEDED') return null;
      return typeof args.reason === 'string' && (HANDOFF_REASONS as readonly string[]).includes(args.reason) ? args.reason : 'other';
    }
    const r = result as { hint?: unknown; error?: { code?: unknown } } | null;
    // 04 §13 / 04-ai-pipeline §4.2: a blocked customer, or a risky one with RISKY_CLIENT_POLICY=handoff, goes to the team
    if (r?.hint === 'risky_client' || r?.error?.code === 'CUSTOMER_BLOCKED') return 'risky_client';
    if (r?.hint === 'handoff') return r.error?.code === 'ORDERS_UNAVAILABLE' ? 'orders_unavailable' : 'other';
    return null;
  }

  async execute(rawName: string, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const name = canonicalTool(rawName);
    switch (name) {
      case 'search_products':
        return this.search(args, ctx);
      case 'get_product':
        return this.product(args, ctx);
      case 'check_availability':
        return this.availability(args, ctx);
      case 'quote_delivery':
        return this.quote(args);
      case 'lookup_order':
        return this.lookup(args, ctx);
      case 'create_order':
        return this.createOrder(args, ctx);
      case 'cancel_order':
        return this.cancelOrder(args, ctx);
      case 'handoff_to_human':
        return this.handoff(args, ctx);
      case 'add_faq_candidate':
        return this.faqCandidate(args, ctx);
      case 'create_payment_link':
        return this.paymentLinks.forAi({ workspaceId: ctx.workspaceId, clientId: ctx.clientId, dryRun: ctx.dryRun }, typeof args.orderId === 'string' ? args.orderId.trim() : '');
      default:
        return { ok: false, error: { code: 'UNKNOWN_TOOL', name: rawName } };
    }
  }

  /**
   * Retest 11/11 (Badro: « the AI sometimes sends the discussion to a team member for no reason »): a handoff whose reason is
   * no rule (« other », or unknown) is refused when the shop wrote no rule of its own. Retest 12/11 (« even after a hello;
   * once confused it keeps doing it »): with the customer's words of the turn known (`customerText`, every reply run), the
   * handoff is checked by `judgeHandoff` — the evidence must be the customer's words of the current message. Refused ⇒
   * `HANDOFF_NOT_NEEDED` with the instruction: the model answers in the same turn.
   */
  private async handoff(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const reason = typeof args.reason === 'string' ? args.reason : '';
    const refuse = (instruction: string, why?: string) => ({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', ...(why ? { why } : {}) }, instruction }) as ToolResult;
    if (ctx.customerText !== undefined) {
      // journey retest R13-1 (18/11): an off_catalogue handoff is accepted only when the server's own catalogue check finds no product
      // of the shop named in the customer's message (F1 T1 « Je voudrais le sac à main cuir marron » ⇒ handed off, Marron in stock)
      const soldNamed = handoffReason(reason) === 'off_catalogue' ? await this.soldProductNamed(ctx.agent, ctx.customerText) : null;
      const v = judgeHandoff({ reason, evidence: typeof args.evidence === 'string' ? args.evidence : null, customerText: ctx.customerText, shopRules: ctx.agent.humanHandoffRules, keywords: ctx.agent.handoffKeywords, unclearStreak: ctx.unclearStreak, established: ctx.established, soldNamed });
      return v.ok ? { ok: true } : refuse(handoffRefusedInstruction(v.why, soldNamed), v.why);
    }
    const known = (HANDOFF_REASONS as readonly string[]).includes(reason) && reason !== 'other';
    if (known || (ctx.agent.humanHandoffRules ?? '').trim()) return { ok: true };
    return refuse(
      'No handoff rule applies: keep the conversation and answer now. A question you have no answer to ⇒ status=UNKNOWN, call add_faq_candidate and say briefly you will check with the team. A stock problem (ORDER_INSUFFICIENT_STOCK, out of stock) ⇒ offer the quantity available, the other variants or a similar product. Hand off only for a listed rule (customer_request, refund, complaint, angry, unclear_streak, off_catalogue, order_limits, risky_client, keyword).',
    );
  }

  /**
   * journey retest R13-1: the name of the in-scope product the customer's text names (`CatalogueService.productNamed`), else null — a
   * read failure counts as none (the judge's other rules still apply).
   */
  async soldProductNamed(agent: ToolRunContext['agent'], text: string): Promise<string | null> {
    if (typeof this.catalogue.productNamed !== 'function' || !text.trim()) return null;
    try {
      return (await this.catalogue.productNamed(agent, text))?.name ?? null;
    } catch {
      return null;
    }
  }

  private view(p: CatalogueProduct) {
    // a product with variants is quoted at its variants' prices only (VARIANT_REQUIRED at create_order)
    const prices = p.variants.map((v) => v.price);
    const price = p.hasVariants ? (prices.length ? Math.min(...prices) : null) : p.price;
    const extra = p.hasVariants ? { priceMax: prices.length ? Math.max(...prices) : null, variantRequired: true } : { oldPrice: p.oldPrice };
    // recette 09/11 (Badro): no stock count reaches the model, so none reaches the customer (STOCK_PRIVATE)
    return {
      id: p.id, name: p.name, sku: p.sku, price, ...extra,
      stock: stockWord(p.stock, p.sellOutOfStock),
      hasVariants: p.hasVariants,
      variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: stockWord(v.stock, p.sellOutOfStock) })),
      imageUrl: p.imageUrl, category: p.category,
    };
  }

  private async search(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const a = SearchArgs.safeParse(args);
    if (!a.success) return invalid(String(a.error.issues[0]?.path[0] ?? 'query'), 'robe satin');
    const products = await this.catalogue.search(ctx.agent, a.data.query, a.data.limit);
    return { products: products.map((p) => this.view(p)) };
  }

  /**
   * journey retest R7-4 (17/11): the in-scope product a mistyped id stands for (one or two characters off, `nearestId`) — the
   * model copied « 01a1e51f-737c-… » for « 01a1e51f-4737-… » and got PRODUCT_NOT_AVAILABLE, then called again. Ids that
   * are products of the scope come back as they are.
   */
  private async fixedIds(agent: ToolRunContext['agent'], ids: string[]): Promise<Map<string, string>> {
    if (typeof this.catalogue.correctIds !== 'function' || !ids.length) return new Map();
    return this.catalogue.correctIds(agent, ids);
  }
  private async oneProduct(agent: ToolRunContext['agent'], id: string, withAlso: boolean): Promise<CatalogueProduct | undefined> {
    const [p] = id ? await this.catalogue.byIds(agent, [id], withAlso) : [];
    if (p) return p;
    const fixed = (await this.fixedIds(agent, [id])).get(id);
    return fixed ? (await this.catalogue.byIds(agent, [fixed], withAlso))[0] : undefined;
  }

  private async product(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const id = typeof args.productId === 'string' ? args.productId : '';
    const p = await this.oneProduct(ctx.agent, id, true);
    // FL-01 F-9: archived / inactive / not approved / out of scope — the model is told, the customer sees no error
    if (!p) return { ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: id } };
    return { ...this.view(p), description: p.description, recommendations: p.also };
  }

  /**
   * full-test 15/11 proposal 2: `{ available }` for the quantity asked — STOCK_PRIVATE holds: the count
   * (`availableQuantity`) only comes back when the quantity is short, with the other variants that have stock.
   */
  async availability(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const id = typeof args.productId === 'string' ? args.productId.trim() : '';
    const qty = Math.max(1, Math.floor(Number(args.quantity ?? 1)) || 1);
    const p = await this.oneProduct(ctx.agent, id, true);
    if (!p) return { ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: id } };
    const sell = p.sellOutOfStock;
    const variantId = typeof args.variantId === 'string' && args.variantId.trim() ? args.variantId.trim() : null;
    const v = p.hasVariants ? (p.variants.find((x) => x.id === variantId) ?? (variantId && (await this.unknownVariantIds([variantId])).has(variantId) ? fixedVariant(p, variantId) : null)) : null;
    if (p.hasVariants && !v) return { ok: true, productId: p.id, variantRequired: true, variants: p.variants.map((x) => ({ id: x.id, name: x.name, price: x.price, available: sell || x.stock >= qty })), say: 'ask which variant the customer wants (only the available ones)' };
    const stock = v ? v.stock : p.stock;
    const base = { ok: true, productId: p.id, ...(v ? { variantId: v.id, variant: v.name } : {}), quantity: qty };
    if (stock === null) return { ...base, available: true, service: true };
    if (stock >= qty) return { ...base, available: true };
    // the shop takes orders beyond the stock (PV 22/10): orderable, the extra units may take longer
    if (sell) return { ...base, available: true, beyondStock: true, say: 'orderable: say that part of it may take a little longer to deliver' };
    const others = v ? p.variants.filter((x) => x.id !== v.id && x.stock > 0).map((x) => ({ variantId: x.id, name: x.name, price: x.price })) : [];
    return { ...base, available: false, ...(stock > 0 ? { availableQuantity: stock } : {}), ...(others.length ? { otherVariants: others } : {}), say: stock > 0 ? 'offer availableQuantity (and the other variants); never more' : 'say it is out of stock (OUT_OF_STOCK) and offer the other variants or a similar product' };
  }

  private async wilaya(a: { wilayaId?: number; wilayaName?: string }) {
    if (a.wilayaId) return prisma.wilaya.findUnique({ where: { id: a.wilayaId } });
    if (!fold(a.wilayaName ?? '')) return null;
    // the name inside a longer answer ("pour Oran svp", "wilaya de Sétif", "livraison à Ksar El Boukhari"): official
    // names first, then the spellings; the longest phrase wins ("Bir El Ater" over a shorter name inside it)
    return matchWilaya(await prisma.wilaya.findMany(), a.wilayaName ?? '');
  }

  /** Delivery fee of the merchant's grid; `free` when the subtotal reaches the rule's (or the workspace's) threshold. */
  async quote(args: Record<string, unknown>): Promise<ToolResult> {
    const a = QuoteArgs.safeParse(args);
    // journey retest R2-3: a call with no wilaya (« quote_delivery {} ») is no customer error — the model said « ما فهمتش الولاية »
    // to a customer who had only sent their phone
    if (a.success && !a.data.wilayaId && !a.data.wilayaName?.trim()) return { ok: false, error: { code: 'VALIDATION', field: 'wilayaName', missing: true, example: 'Alger' }, say: 'No wilaya given: the customer has not named one yet. Ask which wilaya (one question) — never say you did not understand it.' };
    if (!a.success) return invalid('wilayaName', 'Alger');
    const wilaya = await this.wilaya(a.data);
    if (!wilaya) return invalid('wilayaName', 'Alger');
    const [rule, ws] = await Promise.all([
      prisma.deliveryFeeRule.findFirst({ where: { wilayaId: wilaya.id } }),
      prisma.workspace.findUniqueOrThrow({ where: { id: TenantContext.workspaceId() }, select: { freeDeliveryThreshold: true } }),
    ]);
    const stopdeskAvailable = !!rule && rule.isActive && rule.stopdeskPrice > 0;
    // FL-02 F-2: no rule / inactive rule ⇒ not served
    if (!rule || !rule.isActive) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: wilaya.id, wilayaName: wilaya.nameFr, stopdeskAvailable: false } };
    if (a.data.isStopdesk && !stopdeskAvailable) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: wilaya.id, wilayaName: wilaya.nameFr, stopdeskAvailable: false, homeAvailable: true } };
    const freeFrom = rule.freeAbove ?? ws.freeDeliveryThreshold ?? null;
    const free = !a.data.isStopdesk && freeFrom !== null && a.data.subtotal !== undefined && a.data.subtotal >= freeFrom;
    // journey J08-3: the threshold is for home delivery only — said in the result, so the model can explain a stop-desk fee
    // above the threshold (it answered « le seuil est 10 000 DA, mais … 350 DA » without knowing why)
    const note = freeFrom !== null ? (a.data.isStopdesk ? 'freeFrom applies to home delivery only: a stop-desk order always pays the stop-desk fee.' : 'freeFrom applies to home delivery only, never to stop-desk.') : undefined;
    return { ok: true, wilayaId: wilaya.id, wilayaName: wilaya.nameFr, wilayaNameAr: wilaya.nameAr, isStopdesk: a.data.isStopdesk, fee: free ? 0 : a.data.isStopdesk ? rule.stopdeskPrice : rule.homePrice, free, freeFrom, freeFor: freeFrom !== null ? 'home' : null, stopdeskAvailable, stopdeskFee: stopdeskAvailable ? rule.stopdeskPrice : null, etaDays: '2–5', ...(note ? { note } : {}) };
  }

  /**
   * AI-13: the customer's orders, except closed ones older than 30 days. PV 28/10 (« ajout du tracking via le chatbot »):
   * also the orders placed with the customer's phone (an order taken by phone, or from another Messenger account) and,
   * when the customer gives them, the orders of a phone number or of a parcel tracking number — those are not shown
   * with their amount (anyone may type a number). Each parcel comes with its public tracking page.
   */
  private async lookup(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const text = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : null);
    const number = text('orderNumber');
    const tracking = text('trackingNumber');
    const given = text('phone');
    const phone = given ? normalizePhoneDz(given) : null;
    if (phone && !isPhoneDz(phone)) return invalid('phone', EXAMPLES.clientPhone);
    // the customer's phones: their client record and what they gave in this conversation (A4 `context.customer`)
    const [client, conv] = await Promise.all([
      ctx.clientId ? prisma.client.findUnique({ where: { id: ctx.clientId }, select: { phone: true, phone2: true } }) : null,
      ctx.conversationId ? prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { context: true } }) : null,
    ]);
    const said = conv ? contextOf(conv).customer : undefined;
    const own = [...new Set([client?.phone, client?.phone2, said?.phone, said?.phone2].map((p) => (p ? normalizePhoneDz(p) : null)).filter((p): p is string => !!p && isPhoneDz(p)))];
    const byPhone = (p: string[]): Prisma.OrderWhereInput[] => (p.length ? [{ clientPhone: { in: p } }, { clientPhone2: { in: p } }] : []);
    // a phone / tracking number the customer typed: exactly those orders; otherwise the customer's own orders
    const asked: Prisma.OrderWhereInput[] = [...byPhone(phone ? [phone] : []), ...(tracking ? [{ shipments: { some: { trackingNumber: { equals: tracking, mode: 'insensitive' as const } } } }] : [])];
    const who: Prisma.OrderWhereInput[] = asked.length ? asked : [...(ctx.clientId ? [{ clientId: ctx.clientId }] : []), ...byPhone(own)];
    // full-test 15/11 AI-CHAT-16: the playground sees the TEST-n orders of its session (status new, not shipped)
    const simulated = ctx.dryRun && !phone && !tracking ? simulatedOrders(ctx.orderHistory).filter((o) => !number || o.number.toLowerCase() === number.toLowerCase()).map((o) => ({ number: o.number, status: 'new', deliveryStatus: 'not_sent', courier: null, trackingNumber: null, trackingUrl: null, lastEvent: null, total: o.total, orderedAt: aiDateTime(o.at), simulated: true })) : [];
    if (simulated.length) return { orders: simulated };
    if (!who.length) return { orders: [] };
    const old = new Date(Date.now() - 30 * 86_400_000);
    const rows = await prisma.order.findMany({
      where: { OR: who, ...(number ? { number: { equals: number, mode: 'insensitive' } } : tracking ? {} : { NOT: { status: { in: ['delivered', 'cancelled', 'returned'] }, orderedAt: { lt: old } } }) },
      orderBy: { orderedAt: 'desc' },
      take: 5,
      include: { shipments: { orderBy: { createdAt: 'desc' }, take: 1, include: { events: { orderBy: { at: 'desc' }, take: 1 } } } },
    });
    const web = this.config.get('PUBLIC_WEB_URL').replace(/\/$/, '');
    return {
      orders: rows.map((o) => {
        const s = o.shipments[0];
        const e = s?.events[0];
        const mine = (!!ctx.clientId && o.clientId === ctx.clientId) || own.includes(o.clientPhone) || (!!o.clientPhone2 && own.includes(o.clientPhone2));
        return {
          number: o.number,
          status: o.status,
          deliveryStatus: o.deliveryStatus,
          courier: s ? s.provider : null,
          trackingNumber: s?.trackingNumber ?? null,
          trackingUrl: s?.publicTrackingToken ? `${web}/s/${s.publicTrackingToken}` : null,
          lastEvent: e ? { at: aiDateTime(e.at), label: shipmentEventLabel(e), location: e.location ?? null } : null,
          ...(mine ? { total: o.total } : {}),
          orderedAt: aiDateTime(o.orderedAt),
        };
      }),
    };
  }

  /** Validation, catalogue check and limits of `create_order` (04 §5, FL-02); the write itself is the `OrderTools` port. */
  async prepareOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<{ ok: true; request: CreateOrderRequest; draft: string; core?: string; beyondStock?: { name: string; quantity: number }[] } | { ok: false; result: ToolResult }> {
    const fail = (result: ToolResult) => ({ ok: false as const, result });
    // journey retest R8-1 (17/11): a bare « oui » to the pending server recap confirms THAT recap — the order is the one the
    // server built for it (stored with the recap), whatever the confirming call left out (N5 T3: no commune, no address,
    // `customerConfirmed false` ⇒ « not given yet », no order, and an invented « problème technique »)
    const pending = this.pendingOrder(args, ctx);
    if (pending) args = pending;
    // journey retest R11-1 (17/11): `items` sent as a JSON string or as code (F1b T3) is read into lines when it names the shop's
    // products without doubt — else a precise refusal naming the expected shape (never « the customer has not given items yet »)
    if (!pending && args.items !== undefined && args.items !== null && !(typeof args.items === 'string' && !args.items.trim())) {
      const read = itemsFromArg(args.items);
      if (!read) return fail(malformedItemsResult());
      if (read.normalized) {
        const items = await this.settledItems(read.items as ItemArg[], ctx);
        if (!items) return fail(malformedItemsResult());
        args = { ...args, items };
      }
    }
    // journey retest R1-5 (J04-6): a call made before the customer gave the fields (« create_order {} », no address, no
    // wilaya) is refused at once, before the catalogue reads, with every missing field — the model asks for the first one
    const absent = absentFields(args, ctx.agent);
    // journey retest R2-4: a value the customer never wrote counts as absent — a phone that is in none of their messages
    // (« 0000000000 » before any number), a wilaya they never named (wilayaId 1 = Adrar after the phone) — refused at once
    // with the absent fields, and the model is told not to call create_order again in this turn
    const known = ctx.customerHistory !== undefined ? await this.knownPhones(ctx) : null;
    const typedPhone = typeof args.clientPhone === 'string' && args.clientPhone.trim() ? normalizePhoneDz(args.clientPhone) : null;
    const wilayaArg = Number(args.wilayaId);
    const place = Number.isInteger(wilayaArg) && wilayaArg >= 1 && wilayaArg <= WILAYA_COUNT ? await prisma.wilaya.findUnique({ where: { id: wilayaArg }, include: { communes: { select: { nameFr: true, nameAr: true } } } }) : null;
    const invented: string[] = [];
    // a wrong number the customer did type (« 05559876 ») keeps its own answer (re-asked with an example)
    const typedDigits = typedPhone ? typedPhone.replace(/\D/g, '').slice(-8) : '';
    if (known && typedPhone && !absent.includes('clientPhone') && !known.has(typedPhone) && !(ctx.customerHistory ?? '').replace(/\D/g, '').includes(typedDigits)) invented.push('clientPhone');
    if (place && ctx.customerHistory !== undefined && !absent.includes('wilayaId') && !(await this.wilayaGiven(ctx, place, typeof args.communeName === 'string' ? args.communeName : null))) invented.push('wilayaId');
    // journey retest R3-3: a name the customer never wrote (« Client » with nothing else given) is refused with the rest — a
    // placeholder always, any other name when none of its words is in their messages or in the client record
    let typedName = typeof args.clientName === 'string' ? args.clientName.trim() : '';
    // journey retest R8-2 (17/11): « smiti وليد بوزيد » sent as « Walid Bouzid » — the name the customer wrote in the other
    // script is theirs: the server uses their own text (refused twice in F3, no recap was ever shown)
    if (typedName && !absent.includes('clientName') && !isPlaceholderName(typedName) && ctx.customerHistory !== undefined && !(await this.nameKnown(ctx, typedName))) {
      const own = customerOwnName(typedName, ctx.customerHistory);
      if (own) {
        args = { ...args, clientName: own };
        typedName = own;
      }
    }
    if (typedName && !absent.includes('clientName') && (isPlaceholderName(typedName) || (ctx.customerHistory !== undefined && !(await this.nameKnown(ctx, typedName))))) invented.unshift('clientName');
    // journey retest R3-3: a phone the customer did type but with the wrong length (« 05559876 ») is named in the same answer
    const badPhone = typedPhone && !invented.includes('clientPhone') && !absent.includes('clientPhone') && !isPhoneDz(typedPhone) ? 'clientPhone' : null;
    if (absent.length || invented.length) {
      const order = ['items', 'clientName', 'clientPhone', 'wilayaId', 'communeName', 'address'];
      const fields = order.filter((f) => absent.includes(f) || invented.includes(f) || f === badPhone);
      const shown = invented.map((f) => (f === 'clientPhone' ? `phone ${String(args.clientPhone)}` : f === 'clientName' ? `name « ${typedName} »` : `wilayaId ${wilayaArg}`));
      return fail({
        ok: false,
        error: { code: 'VALIDATION', field: fields[0]!, missing: true, fields, ...(invented.length ? { notGivenByCustomer: invented } : {}), ...(badPhone ? { invalid: [badPhone] } : {}), ...(EXAMPLES[fields[0]!] !== undefined ? { example: EXAMPLES[fields[0]!] } : {}) },
        say: `Not done: the customer has not given ${fields.filter((f) => f !== badPhone).join(', ')} yet${shown.length ? ` (${shown.join(', ')}: never written by the customer — never a default, a placeholder or a guess)` : ''}${badPhone ? `; the phone ${String(args.clientPhone)} they typed is not a valid number (10 digits, 05 / 06 / 07): ask it again with an example (0555123456)` : ''}. Ask for ${fields[0]} in one short question and do not call create_order again in this turn; call it only once the customer gave every required field.`,
      });
    }
    const a = OrderArgs.safeParse(args);
    if (!a.success) {
      const path = a.error.issues[0]?.path ?? [];
      const field = String(path[path.length - 1] ?? path[0] ?? 'items');
      return fail(invalid(path[0] === 'items' && path.length > 1 ? `items.${field}` : field, EXAMPLES[field]));
    }
    const d = a.data;
    // full-test 15/11 AI-CHAT-01: never an invented value (« Client », 0555000000) — ask the customer
    const ask = (field: string) => fail({ ok: false, error: { code: 'VALIDATION', field, missing: true, example: EXAMPLES[field] }, say: 'ask the customer for this value (one question); never invent it' });
    if (isPlaceholderName(d.clientName)) return ask('clientName');
    const phone = normalizePhoneDz(d.clientPhone);
    // journey 16/11 J05-9: a number the customer never wrote (« 0500000000 », « 0000000000 » before any phone was given) is
    // asked for first, before the address and the other checks — the model used to get a format error and guess again
    if (!isPhoneDz(phone)) return fail(known && known.size === 0 ? { ok: false, error: { code: 'VALIDATION', field: 'clientPhone', missing: true, example: EXAMPLES.clientPhone }, say: 'ask the customer for this value (one question); never invent it' } : invalid('clientPhone', EXAMPLES.clientPhone));
    if (known && !known.has(phone)) return ask('clientPhone');
    let phone2 = d.secondPhone ? normalizePhoneDz(d.secondPhone) : null;
    if (phone2 && !isPhoneDz(phone2)) return fail(invalid('secondPhone', EXAMPLES.secondPhone));
    // journey retest R4-6: « Nadia Kaci, 0661234568 ou 0770998877 » — the other number is kept as the second phone (the model
    // asked which one to keep, then dropped 0770998877 without an answer), unless the customer said one replaces the other
    if (!phone2 && ctx.customerHistory !== undefined && phone2Field(ctx.agent)) phone2 = otherPhoneGiven(ctx.customerHistory, phone);
    if (!d.isStopdesk && (d.address ?? '').length < 10) return fail(invalid('address', EXAMPLES.address));
    // journey retest R2-2: « Adresse : Bab Ezzouar, Alger » — a home address that is only the commune / wilaya name
    if (!d.isStopdesk && place && placeOnlyAddress(d.address ?? '', [place.nameFr, place.nameAr, ...place.communes.flatMap((c) => [c.nameFr, c.nameAr]), ...(d.communeName ? [d.communeName] : [])], place.id))
      return fail({ ok: false, error: { code: 'VALIDATION', field: 'address', missing: true, example: EXAMPLES.address }, say: 'The address is only the commune / wilaya name: ask the customer for the street, the cité or building, or a landmark (one short question), or offer the stop-desk. No recap without it; do not call create_order again in this turn.' });
    const missing = this.missingRequired(d, ctx.agent);
    if (missing) return fail({ ok: false, error: { code: 'VALIDATION', field: missing, missing: true, ...(EXAMPLES[missing] !== undefined ? { example: EXAMPLES[missing] } : {}) }, say: 'ask the customer for this field (one question), then show the recap again' });

    // A9: the order it replaces must be this customer's and not confirmed by the shop yet; its units count as free here
    let replaces: CreateOrderRequest['replaces'] = null;
    const freed = new Map<string, number>();
    // full-test 15/11 AI-CHAT-16: in the playground, a TEST-n order of this session can be replaced (nothing is written)
    const simulatedOld = ctx.dryRun && d.replacesOrder ? simulatedOrders(ctx.orderHistory).find((o) => o.number.toLowerCase() === d.replacesOrder!.trim().toLowerCase()) : undefined;
    if (simulatedOld) replaces = { id: 'simulated', number: simulatedOld.number };
    else if (d.replacesOrder) {
      const old = ctx.clientId ? await prisma.order.findFirst({ where: { clientId: ctx.clientId, number: { equals: d.replacesOrder.trim(), mode: 'insensitive' } }, include: { items: true } }) : null;
      if (!old || old.status === 'cancelled' || old.status === 'returned' || old.status === 'delivered' || old.deliveryStatus !== 'not_sent') return fail({ ok: false, error: { code: 'ORDER_NOT_REPLACEABLE', number: d.replacesOrder } });
      if (old.status !== 'new') return fail({ ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: old.number }, hint: 'handoff' });
      replaces = { id: old.id, number: old.number };
      for (const i of old.items) freed.set(`${i.productId}:${i.variantId ?? ''}`, (freed.get(`${i.productId}:${i.variantId ?? ''}`) ?? 0) + i.quantity);
    }

    const products = await this.catalogue.byIds(ctx.agent, d.items.map((i) => i.productId));
    // journey retest R8-4 (17/11): an invented product id (« 01a1e51f-4180-7000-8000-000000000000 ») with the exact id of one of
    // its variants stands for that variant's product (N6 T1: PRODUCT_NOT_AVAILABLE, then the same call with the right id)
    const notFound = d.items.filter((i) => !products.some((p) => p.id === i.productId));
    const owners = notFound.some((i) => i.variantId) && typeof this.catalogue.variantOwners === 'function' ? await this.catalogue.variantOwners(ctx.agent, notFound.map((i) => i.variantId).filter((x): x is string => !!x)) : new Map<string, string>();
    // journey retest R7-4: a mistyped id (one or two characters off) stands for its product — the server recap names it
    const fixed = await this.fixedIds(ctx.agent, notFound.filter((i) => !(i.variantId && owners.has(i.variantId))).map((i) => i.productId));
    for (const i of notFound) if (i.variantId && owners.has(i.variantId)) fixed.set(i.productId, owners.get(i.variantId)!);
    // journey retest R9-2 (17/11): one invented id left (no product of the shop, not one or two characters off a real one) stands for
    // the one in-scope product the customer named (N17 T1 « je veux 1 hijab soie » + an invented id ⇒ PRODUCT_NOT_AVAILABLE, then
    // the same call with the right id) — the server recap names it before anything is ordered
    const left = notFound.filter((i) => !fixed.has(i.productId));
    if (left.length === 1 && ctx.customerHistory !== undefined && typeof this.catalogue.namedInScope === 'function') {
      const named = await this.catalogue.namedInScope(ctx.agent, left[0]!.productId, ctx.customerHistory, products.map((p) => p.id));
      if (named) fixed.set(left[0]!.productId, named);
    }
    if (fixed.size) products.push(...(await this.catalogue.byIds(ctx.agent, [...new Set(fixed.values())].filter((id) => !products.some((p) => p.id === id)))));
    const by = new Map(products.map((p) => [p.id, p]));
    const items: CreateOrderRequest['items'] = [];
    const beyondStock: { name: string; quantity: number }[] = [];
    // journey retest R7-4 / R8-3: a variant id one or two characters off stands for its variant only when it is no variant of the
    // shop at all (an exact id is never moved to a neighbour)
    const unknownVariants = await this.unknownVariantIds(d.items.map((i) => i.variantId).filter((x): x is string => !!x && !products.some((p) => p.variants.some((v) => v.id === x))));
    for (const i of d.items) {
      const p = by.get(i.productId) ?? by.get(fixed.get(i.productId) ?? '');
      // AI-14: an archived / inactive product is dropped with a message, never ordered
      if (!p) return fail({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE', productId: i.productId } });
      let v = p.hasVariants ? (p.variants.find((x) => x.id === i.variantId) ?? (i.variantId && unknownVariants.has(i.variantId) ? fixedVariant(p, i.variantId) : null)) : null;
      // journey retest R8-3 (17/11): the variant the customer named wins (« le sac à main cuir marron » sent with the id of Noir,
      // the product's first variant ⇒ recap « (Noir) »): the latest message naming exactly one variant of this product, when the
      // order has this product once
      if (p.hasVariants && ctx.customerHistory !== undefined && d.items.filter((x) => (by.get(x.productId) ?? by.get(fixed.get(x.productId) ?? ''))?.id === p.id).length === 1) {
        const named = namedVariant(p.variants, ctx.customerHistory);
        if (named && named.id !== v?.id) v = named;
      }
      if (p.hasVariants && !v) return fail({ ok: false, error: { code: 'VARIANT_REQUIRED', productId: p.id, availableVariants: p.variants.filter((x) => p.sellOutOfStock || x.stock > 0).map((x) => ({ id: x.id, name: x.name, price: x.price })) } });
      const stock = v ? v.stock : p.stock !== null && freed.size ? p.stock + (freed.get(`${p.id}:`) ?? 0) : p.stock;
      const free = stock === null ? null : v ? stock + (freed.get(`${p.id}:${v.id}`) ?? 0) : stock;
      // a product sold at zero stock (PV 22/10) is ordered whatever its stock
      if (free !== null && free < i.quantity && !p.sellOutOfStock) {
        // recette 09/11 (Badro): with variants, the answer gave the chosen variant's count only — it now gives the others
        // too and the total, so the model can offer to complete the order with another size / colour
        const others = v ? p.variants.filter((x) => x.id !== v.id && x.stock + (freed.get(`${p.id}:${x.id}`) ?? 0) > 0).map((x) => ({ variantId: x.id, name: x.name, price: x.price, available: x.stock + (freed.get(`${p.id}:${x.id}`) ?? 0) })) : [];
        return fail({
          ok: false,
          error: {
            code: 'ORDER_INSUFFICIENT_STOCK',
            productId: p.id,
            ...(v ? { variantId: v.id, variant: v.name } : {}),
            available: free,
            ...(v ? { otherVariants: others, availableAllVariants: free + others.reduce((n, x) => n + x.available, 0) } : {}),
            // journey retest R7-4: `available` 0 is « out of stock », not a quantity to offer (N5c: create_order on the Parfum Oud)
            // journey retest R10-2 (17/11): « Je vous ai bien noté … le Coffret est disponible si vous voulez autre chose » (no
            // refusal said, no question) — the « oui » that followed had nothing to answer
            say: free <= 0 && !others.length ? `Out of stock: nothing is ordered and nothing is noted. Say plainly in one sentence that ${p.name} cannot be ordered now (out of stock) — never « noté », « enregistré » or a request to confirm — then ask in one question whether they want an in-stock product (or variant) instead, naming it. Never order this one.` : v ? 'offer `available` of this variant; when the customer wants more, offer to complete with otherVariants (their available quantities), never more than availableAllVariants in total' : 'offer `available`',
          },
        });
      }
      if (free !== null && free < i.quantity && p.sellOutOfStock) beyondStock.push({ name: v ? `${p.name} ${v.name}` : p.name, quantity: i.quantity - Math.max(0, free) });
      items.push({ productId: p.id, variantId: v?.id ?? null, quantity: i.quantity, name: p.name, variant: v?.name ?? null, unitPrice: v ? v.price : p.price });
    }
    const subtotal = items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
    const quantity = items.reduce((n, i) => n + i.quantity, 0);
    // PV 28/10: an empty limit is no limit (the agent page shows ∞); it used to mean 10 units / 50 000 DA
    const maxQty = ctx.agent.maxQtyPerOrder ?? null;
    const maxAmount = ctx.agent.maxAmountPerOrder ?? null;
    const quote = await this.quote({ wilayaId: d.wilayaId, isStopdesk: d.isStopdesk, subtotal });
    if (quote.ok === false) return fail(quote);
    const deliveryFee = Number(quote.fee ?? 0);
    // no order, no error code: the model must hand off with statusDetail=order_limits
    if ((maxQty !== null && quantity > maxQty) || (maxAmount !== null && subtotal + deliveryFee > maxAmount)) return fail({ ok: false, hint: 'order_limit', maxQty, maxAmount });
    // journey retest R11-4 (17/11): the address is stored (and shown) without the commune / wilaya it starts or ends with — the recap
    // adds them back as « street, commune, wilaya » (N21 T4 « البليدة، بوفاريك، حي الورود رقم 12 » was shown and stored wilaya first)
    const communeRow = place && d.communeName ? place.communes.find((c) => samePlace(c.nameFr, d.communeName!) || samePlace(c.nameAr, d.communeName!)) : undefined;
    const placeNames = [place?.nameFr, place?.nameAr, d.communeName, communeRow?.nameFr, communeRow?.nameAr];
    let street = d.address ? withoutPlaceSegments(d.address, placeNames) || d.address : null;
    // journey retest R13-3 (18/11): a street the model translated (« Cité 1000 logements, immeuble 5 » for « حي 1000 مسكن عمارة 5 ») is
    // the customer's own words — as the name (R8-2)
    if (street && ctx.customerHistory !== undefined) street = customerOwnStreet(street, ctx.customerHistory, placeNames) ?? street;
    const request: CreateOrderRequest = { clientName: d.clientName, clientPhone: phone, secondPhone: phone2, wilayaId: d.wilayaId, communeName: d.communeName || null, address: street, isStopdesk: d.isStopdesk, stopdeskId: d.stopdeskId || null, notes: d.notes || null, items, subtotal, deliveryFee, total: subtotal + deliveryFee, replaces };
    // full-test 15/11 AI-CHAT-01 (Blocker): the order exists only after the customer said yes, in a later message, to the
    // recap the server sent — the model's `customerConfirmed` is never enough on its own
    let draft = draftKey(request);
    const core = coreKey(request);
    // journey 16/11 J03-10 (Blocker): the confirming call rewrote the address (« …, El Eulma, Sétif »), so the content key
    // differed and the customer's « oui » got the same recap again, in a loop (5 confirmed recaps out of 7 lost). The latest
    // recap of the conversation with the same core is the one being confirmed — whatever the wording of the name / commune /
    // address, unless the customer's own message of this turn brings the new words; the order then keeps the recap's wording.
    const latestAny = latestRecap(ctx.orderHistory);
    const latest = hasDraft(ctx.orderHistory, draft) ? null : latestAny;
    if (latest?.core === core && latest.wording && !wordingChangedNow(latest.wording, request, ctx.customerText)) {
      Object.assign(request, { clientName: latest.wording.clientName, secondPhone: latest.wording.secondPhone, communeName: latest.wording.communeName, address: latest.wording.address });
      draft = latest.draft;
    } else if (!latest && latestAny?.draft === draft && latestAny.wording) {
      // journey retest R11-4: the same draft (the call's wording differs only in case / spacing, or by the commune / wilaya the
      // address started or ended with) keeps the recap's wording, as the customer read it
      Object.assign(request, { clientName: latestAny.wording.clientName, secondPhone: latestAny.wording.secondPhone, communeName: latestAny.wording.communeName, address: latestAny.wording.address });
    }
    // full-test 15/11 proposal 4: one order per confirmed recap — never a second one in the same turn, never the same
    // content again in a later turn (C06: TEST-2998 then TEST-2283 on « oui c'est bon »)
    const placedNow = await this.placedThisRun(ctx);
    if (placedNow) return fail({ ok: false, error: { code: 'ORDER_ALREADY_PLACED', number: placedNow }, say: 'An order was already placed in this turn: confirm that one to the customer, never create another one now.' });
    const before = orderedBefore(ctx.orderHistory, draft, Date.now(), core);
    if (before) return fail({ ok: false, error: { code: 'ORDER_ALREADY_PLACED', number: before }, say: `This order (same phone, wilaya and items) was already placed as ${before}: confirm it to the customer. To change its name or address, call create_order with replacesOrder=${before}. Create another order only when the customer clearly asks for an additional one.` });
    const recap = {
      items: items.map((i) => ({ name: i.name, variant: i.variant, quantity: i.quantity, unitPrice: i.unitPrice })),
      // J03-10: the wording of the request (the confirmed recap's, when the call only reworded it)
      subtotal, deliveryFee, total: subtotal + deliveryFee, clientName: request.clientName, clientPhone: phone, ...(request.secondPhone ? { secondPhone: request.secondPhone } : {}),
      wilaya: String(quote.wilayaName ?? ''), communeName: request.communeName, address: request.address, isStopdesk: d.isStopdesk,
      // journey retest R2-7: the Arabic recap writes the wilaya (and a commune of the list) in Arabic script
      ...(place?.nameAr ? { wilayaAr: place.nameAr } : {}),
      ...(communeAr(place?.communes ?? [], request.communeName) ? { communeAr: communeAr(place?.communes ?? [], request.communeName) } : {}),
      ...(replaces ? { replaces: replaces.number } : {}),
      ...(beyondStock.length ? { beyondStock } : {}),
    };
    // journey retest R4-3 (Critical): only a SERVER recap of an earlier turn (its CONFIRMATION_REQUIRED draft, or the latest
    // recap with the same core, J03-10) can be confirmed. The J04-4 rule « the AI's previous message showed the phone, the total
    // and the products » let a product suggestion that repeated the customer's details (« Voulez-vous plutôt le Coffret cadeau
    // Aïd à 24990 DA ? », free delivery: total = price) count as a recap: « oui » placed TEST-8513 without any recap shown.
    // Since R1-6 every recap is the server's, sent from the first call: this call returns it.
    // journey retest R8-1: the order this recap stands for, as the server built it — a « oui » to it places exactly this
    const draftOrder: DraftOrder = { clientName: request.clientName, clientPhone: request.clientPhone, secondPhone: request.secondPhone ?? null, wilayaId: request.wilayaId, communeName: request.communeName, address: request.address, isStopdesk: request.isStopdesk, stopdeskId: request.stopdeskId, notes: request.notes, items: request.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })), replacesOrder: d.replacesOrder?.trim() || null };
    if (!hasDraft(ctx.orderHistory, draft)) {
      // journey retest R1-6 / R1-7: `recapToShow` — the platform sends this recap to the customer in their language (the
      // reply never replaces it — journey retest R4-3)
      return fail({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft, core }, recap, recapToShow: true, draftOrder, say: 'Nothing is ordered yet. The platform sends this recap to the customer right after your reply, as given (items with their catalogue names, quantities, prices, delivery mode and fee, total, name, phone, address) with the request to answer yes: write no recap of your own — "reply" only answers anything else the customer asked in this message, in one short sentence, or stays empty. Do not call create_order again in this turn: call it with the same values when the customer answers yes in their next message.' });
    }
    const said = confirmation(ctx.customerText ?? '');
    if (said === 'no') return fail({ ok: false, error: { code: 'CONFIRMATION_REFUSED', draft, core }, say: 'The customer did not confirm this recap: nothing is ordered. Ask what they want to change (or whether they still want to order).' });
    if (said === 'unclear') return fail({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft, core }, recap, draftOrder, say: 'The customer has not clearly confirmed this recap yet: nothing is ordered. Answer their message, then ask them to reply « oui » to confirm the order (or say what to change).' });
    // 04 §21: `phoneConfirmed` counts only once the tool asked the customer to re-confirm this number
    if (d.phoneConfirmed && phoneCheckAsked(ctx.orderHistory, phone)) request.phoneConfirmed = true;
    return { ok: true, request, draft, core, ...(beyondStock.length ? { beyondStock } : {}) };
  }

  /**
   * journey retest R8-1: the arguments of the order the pending server recap stands for, when the customer's message only says
   * yes to it (`bareYes`) and the model's confirming call is incomplete (a required field absent) — else null (the call is
   * judged as it is: a complete call keeps the J03-10 core match, a change of the customer gets a new recap). Never once that
   * recap (or an order after it) was placed.
   */
  private pendingOrder(args: Record<string, unknown>, ctx: ToolRunContext): Record<string, unknown> | null {
    if (ctx.customerText === undefined || !absentFields(args, ctx.agent).length) return null;
    const latest = latestRecap(ctx.orderHistory);
    if (!latest?.order || !bareYes(ctx.customerText, latest.shown)) return null;
    if (orderedBefore(ctx.orderHistory, latest.draft, Date.now(), latest.core ?? undefined)) return null;
    if ((ctx.orderHistory ?? []).some((h) => (h.name ?? 'create_order') === 'create_order' && (h.result as { ok?: unknown } | null)?.ok === true && h.at.getTime() > latest.at.getTime())) return null;
    const o = latest.order;
    return {
      clientName: o.clientName,
      clientPhone: o.clientPhone,
      ...(o.secondPhone ? { secondPhone: o.secondPhone } : {}),
      wilayaId: o.wilayaId,
      ...(o.communeName ? { communeName: o.communeName } : {}),
      ...(o.address ? { address: o.address } : {}),
      isStopdesk: o.isStopdesk,
      ...(o.stopdeskId ? { stopdeskId: o.stopdeskId } : {}),
      ...(o.notes ? { notes: o.notes } : {}),
      items: o.items.map((i) => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}), quantity: i.quantity })),
      ...(o.replacesOrder ? { replacesOrder: o.replacesOrder } : {}),
      customerConfirmed: true,
      ...(args.phoneConfirmed === true ? { phoneConfirmed: true } : {}),
    };
  }

  /**
   * journey retest R11-1: the lines of a malformed `items` value with one product id each — a line whose `productId` held several ids
   * (« "A".replace("A","B") ») keeps the one that is a product of the agent's scope, or the one its variant belongs to; none of them a
   * product ⇒ the first (the variant / named-product fallbacks of create_order apply); two products left ⇒ null (not read without doubt).
   */
  private async settledItems(lines: ItemArg[], ctx: ToolRunContext): Promise<{ productId: string; variantId?: string; quantity: number }[] | null> {
    const out: { productId: string; variantId?: string; quantity: number }[] = [];
    for (const l of lines) {
      let productId = l.productId;
      if (l.candidates.length > 1) {
        const found = await this.catalogue.byIds(ctx.agent, l.candidates);
        const owner = l.variantId ? found.filter((p) => p.variants.some((v) => v.id === l.variantId)) : [];
        if (found.length === 1) productId = found[0]!.id;
        else if (owner.length === 1) productId = owner[0]!.id;
        else if (found.length > 1) return null;
      }
      if (!productId && !l.variantId) return null;
      out.push({ productId: productId || l.variantId!, ...(l.variantId ? { variantId: l.variantId } : {}), quantity: l.quantity });
    }
    return out;
  }

  /** journey retest R8-3: the variant ids that are no variant of the shop at all (a fake catalogue in tests: all of them). */
  private async unknownVariantIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    if (typeof this.catalogue.knownVariantIds !== 'function') return new Set(ids);
    const known = await this.catalogue.knownVariantIds(ids);
    return new Set(ids.filter((id) => !known.has(id)));
  }

  /** journey retest R2-4: the customer named this wilaya (or a commune of it) in the conversation, or ordered there before. */
  private async wilayaGiven(ctx: ToolRunContext, place: WilayaRow & { communes: { nameFr: string; nameAr: string }[] }, communeName: string | null): Promise<boolean> {
    const all = await prisma.wilaya.findMany({ select: { id: true, code: true, nameFr: true, nameAr: true } });
    if (wilayaNamed(all, place.id, ctx.customerHistory ?? '', { given: communeName, ofWilaya: place.communes })) return true;
    // the wilaya recorded from an earlier turn of this conversation (A4 `context.customer`)
    const conv = ctx.conversationId ? await prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { context: true } }) : null;
    const said = conv ? contextOf(conv).customer?.wilaya : undefined;
    if (said && matchWilaya(all, said)?.id === place.id) return true;
    // a returning customer: the wilaya of their client record (KNOWN CUSTOMER) or of an earlier order
    if (!ctx.clientId) return false;
    const [address, order] = await Promise.all([prisma.clientAddress.findFirst({ where: { clientId: ctx.clientId, wilayaId: place.id }, select: { id: true } }), prisma.order.findFirst({ where: { clientId: ctx.clientId, wilayaId: place.id }, select: { id: true } })]);
    return !!address || !!order;
  }

  /** The number of the order a `create_order` of this very run already placed, else null. */
  private async placedThisRun(ctx: ToolRunContext): Promise<string | null> {
    const calls = await prisma.aiToolCall.findMany({ where: { aiRunId: ctx.runId, name: 'create_order', executedAt: { not: null } }, select: { result: true } });
    const hit = calls.map((c) => c.result as { ok?: unknown; number?: unknown } | null).find((r) => r?.ok === true && typeof r.number === 'string');
    return hit ? String(hit.number) : null;
  }

  /** The phones this customer typed in the conversation or has on their client record (a returning customer) — never one the model reported. */
  /** journey retest R3-3: the name is in the customer's messages or in their client record (a placeholder record never counts). */
  private async nameKnown(ctx: ToolRunContext, name: string): Promise<boolean> {
    if (nameGiven(name, ctx.customerHistory ?? '')) return true;
    const client = ctx.clientId ? await prisma.client.findUnique({ where: { id: ctx.clientId }, select: { name: true } }) : null;
    return !!client?.name && !isPlaceholderName(client.name) && nameGiven(name, client.name);
  }

  private async knownPhones(ctx: ToolRunContext): Promise<Set<string>> {
    const known = phonesIn(ctx.customerHistory ?? '');
    const client = ctx.clientId ? await prisma.client.findUnique({ where: { id: ctx.clientId }, select: { phone: true, phone2: true } }) : null;
    for (const p of [client?.phone, client?.phone2]) if (p) known.add(normalizePhoneDz(p));
    return known;
  }

  /**
   * recette 09/11 (Badro: « makes orders with missing info he never asks for when it isn't your first order »): the fields
   * the agent's « Prise de commande » marks required are checked here too, so a missing one comes back as VALIDATION and
   * the model asks for it instead of creating the order without it.
   */
  private missingRequired(d: z.infer<typeof OrderArgs>, agent: ToolRunContext['agent']): string | null {
    const fields = Array.isArray(agent.orderFields) ? (agent.orderFields as unknown as { key: string; required: boolean }[]) : [];
    const required = new Set(fields.length ? fields.filter((f) => f.required).map((f) => f.key) : ['commune', 'address']);
    if (!d.isStopdesk && required.has('commune') && !d.communeName?.trim()) return 'communeName';
    if (required.has('phone2') && !d.secondPhone?.trim()) return 'secondPhone';
    if (required.has('note') && !d.notes?.trim()) return 'notes';
    return null;
  }

  private async createOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const prepared = await this.prepareOrder(args, ctx);
    if (!prepared.ok) return prepared.result;
    const r = prepared.request;
    // `draft`: the content key (a later turn never places the same order again); `etaDays`: the server's confirmation text
    const beyond = { ...(prepared.beyondStock ? { beyondStock: prepared.beyondStock } : {}), draft: prepared.draft, ...(prepared.core ? { core: prepared.core } : {}), etaDays: '2–5' };
    // §8 dry run: everything validated, nothing written; a blocked phone is refused like live (journey J09-14, 04 §13)
    if (ctx.dryRun && (await this.orders.isBlocked?.({ conversationId: ctx.conversationId }, r.clientPhone))) return customerBlockedResult();
    if (ctx.dryRun) return { ok: true, orderId: null, number: `TEST-${seqOf(ctx.callId)}`, simulated: true, subtotal: r.subtotal, deliveryFee: r.deliveryFee, total: r.total, items: r.items.map((i) => ({ name: i.name, variant: i.variant, quantity: i.quantity, unitPrice: i.unitPrice })), duplicateOf: null, paymentOptions: ['cod'], ...(r.replaces ? { replaced: { number: r.replaces.number } } : {}), ...beyond };
    const created = await this.orders.createOrder({ workspaceId: ctx.workspaceId, agentId: ctx.agent.id, conversationId: ctx.conversationId, clientId: ctx.clientId, channelId: ctx.channelId, runId: ctx.runId, callId: ctx.callId }, r);
    return created && typeof created === 'object' && (created as { ok?: unknown }).ok !== false ? { ...(created as object), ...beyond } : created;
  }

  /** FL-02 F-5: this client's open orders only; one confirmed ⇒ cancel, several ⇒ ask which, none ⇒ hand off. */
  private async cancelOrder(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const number = typeof args.orderNumber === 'string' && args.orderNumber.trim() ? args.orderNumber.trim().toLowerCase() : null;
    // journey retest R10-3 (17/11): a call without an order number while the customer asked no cancellation is a probe (N11 T3
    // `cancel_order {}` on a tracking question ⇒ « ok, candidates ») — refused precisely, nothing is looked up
    if (!number && ctx.customerText !== undefined && !cancelWordsIn(ctx.customerText, ctx.customerHistory)) return { ok: false, error: { code: 'CANCEL_NOT_ASKED' }, say: 'Nothing is cancelled: the customer did not ask to cancel an order. cancel_order is only for a cancellation they ask for — an order status question is answered with lookup_order. Answer their message now.' };
    // full-test 15/11 AI-CHAT-16: the playground cancels its own TEST-n orders (nothing is written)
    if (ctx.dryRun) {
      const mine = simulatedOrders(ctx.orderHistory);
      if (mine.length) {
        const target = number ? mine.find((o) => o.number.toLowerCase() === number) : mine.length === 1 ? mine[0] : undefined;
        const candidates = mine.map((o) => ({ number: o.number, total: o.total, status: 'new', orderedAt: aiDateTime(o.at) }));
        if (number && !target) return { ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } };
        if (!target || args.customerConfirmed !== true) return { ok: true, candidates, simulated: true };
        if (await this.placedThisRun(ctx)) return { ok: false, error: { code: 'ORDER_JUST_CREATED', number: target.number }, say: "This order was just created at the customer's request: keep it. Cancel only if the customer asks in a later message." };
        if (ctx.customerText !== undefined && !asksCancel(ctx.customerText)) return { ok: true, candidates, simulated: true, say: 'Nothing is cancelled: the customer did not ask to cancel this order in their message. Keep it; to cancel, they must say so (« annuler »).' };
        return { ok: true, cancelled: target.number, simulated: true };
      }
    }
    if (!ctx.clientId) return { ok: false, error: { code: 'NO_OPEN_ORDER' } };
    // A8 (tester report 2026-10-20): only orders the shop has not confirmed yet; a confirmed one is the team's to cancel
    const open = await prisma.order.findMany({ where: { clientId: ctx.clientId, status: 'new', deliveryStatus: 'not_sent' }, orderBy: { orderedAt: 'desc' }, take: 10 });
    const candidates: CancellableOrder[] = open.map((o) => ({ id: o.id, number: o.number, total: o.total, status: o.status, orderedAt: aiDateTime(o.orderedAt) }));
    const publicList = candidates.map(({ id: _id, ...c }) => c);
    const confirmed = await prisma.order.findFirst({ where: { clientId: ctx.clientId, status: { in: ['confirmed', 'preparing'] }, deliveryStatus: 'not_sent', ...(number ? { number: { equals: number, mode: 'insensitive' } } : {}) }, select: { number: true } });
    if (confirmed && (!candidates.length || (number && !candidates.some((c) => c.number.toLowerCase() === number)))) return { ok: false, error: { code: 'ORDER_CONFIRMED_BY_SELLER', number: confirmed.number }, hint: 'handoff' };
    if (!candidates.length) {
      const any = number ? await prisma.order.findFirst({ where: { clientId: ctx.clientId, number: { equals: number, mode: 'insensitive' } }, select: { id: true } }) : await prisma.order.findFirst({ where: { clientId: ctx.clientId, status: { notIn: ['cancelled', 'returned', 'delivered'] } }, select: { id: true } });
      return { ok: false, error: { code: any ? 'ORDER_NOT_CANCELLABLE' : 'NO_OPEN_ORDER' } };
    }
    const target = number ? candidates.find((c) => c.number.toLowerCase() === number) : candidates.length === 1 ? candidates[0] : undefined;
    if (number && !target) return { ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } };
    // never cancels without the customer's confirmation, and never in the playground
    if (!target || args.customerConfirmed !== true || ctx.dryRun) return { ok: true, candidates: publicList, ...(ctx.dryRun ? { simulated: true } : {}) };
    // full-test 15/11 AI-CHAT-02: never the order this very turn created, and only on the customer's own words of this turn
    const createdNow = (await prisma.aiToolCall.findMany({ where: { aiRunId: ctx.runId, name: 'create_order', executedAt: { not: null } }, select: { result: true } })).some((c) => (c.result as { ok?: unknown } | null)?.ok === true);
    if (createdNow) return { ok: false, error: { code: 'ORDER_JUST_CREATED', number: target.number }, say: "This order was just created at the customer's request: keep it. Cancel only if the customer asks in a later message." };
    if (ctx.customerText !== undefined && !wantsCancel(ctx.customerText)) return { ok: true, candidates: publicList, say: 'Nothing is cancelled: ask the customer to confirm the cancellation of this order.' };
    // full-test 15/11 proposal 4: an order the AI placed in this conversation is cancelled only on the customer's own
    // cancel words (« oui » / « merci » right after the confirmation cancelled it — C08 T6, X01)
    if (ctx.customerText !== undefined && placedNumbers(ctx.orderHistory).some((n) => n.toLowerCase() === target.number.toLowerCase()) && !asksCancel(ctx.customerText)) return { ok: true, candidates: publicList, say: 'Nothing is cancelled: this order was just placed and the customer did not ask to cancel it in their message. Keep it; to cancel, they must say so (« annuler »).' };
    return this.orders.cancelOrder({ workspaceId: ctx.workspaceId, agentId: ctx.agent.id, conversationId: ctx.conversationId, clientId: ctx.clientId, channelId: ctx.channelId, runId: ctx.runId, callId: ctx.callId }, target, typeof args.reason === 'string' ? args.reason.slice(0, 200) : null);
  }

  /** `AgentFaq(source = ai_suggested, isActive = false)` counts the customers who asked; ≥ 3 ⇒ insight `unknown_topic`. */
  private async faqCandidate(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    const question = typeof args.question === 'string' ? args.question.trim().slice(0, 300) : '';
    if (!question) return invalid('question');
    // journey 16/11 J04-7: a customer's name / phone / address written as an FAQ « question » (a call-back note) is refused,
    // in the playground too — it would store personal data as an FAQ suggestion and nothing calls the customer back
    if (personalNote(question)) return { ok: false, error: { code: 'VALIDATION', field: 'question' }, say: "Write only the general question (no name, phone or address of the customer). This records nothing for the customer: never say you noted their details or that someone will get back to them." };
    // journey retest R10-3 (17/11): only a question the customer asked — never a note about the order (N4 T2 « Le client a commandé
    // le tapis de prière (quantité 1) ; prochaine étape : numéro de téléphone. » on a name message) nor a question nobody asked (N5
    // T2 « Quand le Parfum Oud sera-t-il de nouveau disponible ? » on « je le prends + details »)
    if (!asksSomething(question) || (ctx.customerText !== undefined && !asksSomething(ctx.customerText))) return { ok: false, error: { code: 'VALIDATION', field: 'question' }, say: 'Nothing was recorded: add_faq_candidate is only for a question the customer asked in this message that you could not answer — never a note about the order or a question they did not ask. Answer the customer now.' };
    if (ctx.dryRun) return { ok: true, simulated: true };
    const key = normQuestion(question);
    const existing = (await prisma.agentFaq.findMany({ where: { agentId: ctx.agent.id, source: 'ai_suggested' }, select: { id: true, question: true, askedCount: true } })).find((f) => normQuestion(f.question) === key);
    const count = (existing?.askedCount ?? 0) + 1;
    if (existing) await prisma.agentFaq.update({ where: { id: existing.id }, data: { askedCount: count } });
    else await prisma.agentFaq.create({ data: { workspaceId: ctx.workspaceId, agentId: ctx.agent.id, question, answer: '', source: 'ai_suggested', askedCount: 1, isActive: false, sortOrder: 1000 } });
    return { ok: true, count, suggestInsight: count === FAQ_CANDIDATE_INSIGHT_AT, topicKey: key.slice(0, 80) };
  }
}
