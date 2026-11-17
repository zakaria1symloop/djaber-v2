// 04-ai-pipeline §4.1 — the output contract of a reply turn (replaces the V1 `[STATUS:…]` tags). The JSON Schema is
// part of the prompt; whatever the model returns is validated here. Malformed ⇒ one "format reminder" retry, then the
// first answer is salvaged when it is a plain message (salvageReply), F-6 only when nothing can be sent.
import { z } from 'zod';
import { AI_LANGUAGES, AI_REPLY_INTENTS, AI_REPLY_STATUSES } from '@djaber/shared';

export const AiReplyOutputSchema = z
  .object({
    reply: z.string().max(2000),
    status: z.enum(AI_REPLY_STATUSES),
    statusDetail: z.string().max(200).optional(),
    /** retest 12/11: status=HANDOFF — the customer's own words, from the message being answered, that match the rule (checked by the server) */
    evidence: z.string().max(300).optional(),
    intent: z.enum(AI_REPLY_INTENTS),
    productCards: z.array(z.string()).max(5),
    /** PV 09/11: products whose every picture is sent (a gallery) — when the customer asks for more / other photos */
    productPhotos: z.array(z.string()).max(2).optional(),
    recommendations: z.array(z.object({ sourceId: z.string(), recommendedId: z.string() })).max(3),
    confidence: z.number().min(0).max(1),
    language: z.enum(AI_LANGUAGES).optional(),
    /** A4: the order details the customer gave so far — kept on the conversation, never asked again */
    customer: z
      .object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional(), phone2: z.string().max(30).optional(), wilaya: z.string().max(60).optional(), commune: z.string().max(100).optional(), address: z.string().max(500).optional() })
      .strict()
      .optional(),
    /** full-test 15/11 AI-CHAT-05: the product(s) the customer chose for the order being taken — printed as CURRENT ORDER next turn */
    cart: z
      .object({ items: z.array(z.object({ productId: z.string().max(80), variantId: z.string().max(80).nullish(), quantity: z.union([z.number(), z.string().max(10)]).nullish() }).passthrough()).max(20).optional() })
      .passthrough()
      .nullish(),
  })
  .strict();
export type AiReplyOutput = z.infer<typeof AiReplyOutputSchema>;

export const AI_REPLY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'status', 'intent', 'productCards', 'recommendations', 'confidence'],
  properties: {
    reply: { type: 'string', maxLength: 2000 },
    status: { enum: [...AI_REPLY_STATUSES] },
    statusDetail: { type: 'string', maxLength: 200 },
    evidence: { type: 'string', maxLength: 300, description: "status=HANDOFF only: the customer's exact words, from their current message, that match the handoff rule" },
    intent: { enum: [...AI_REPLY_INTENTS] },
    productCards: { type: 'array', maxItems: 5, items: { type: 'string', description: 'productId' } },
    productPhotos: { type: 'array', maxItems: 2, items: { type: 'string', description: 'productId whose every photo is sent' } },
    recommendations: { type: 'array', maxItems: 3, items: { type: 'object', required: ['sourceId', 'recommendedId'], properties: { sourceId: { type: 'string' }, recommendedId: { type: 'string' } } } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    language: { enum: [...AI_LANGUAGES] },
    customer: {
      type: 'object',
      additionalProperties: false,
      description: 'order details the customer has given so far in this conversation (only what they actually said)',
      properties: { name: { type: 'string' }, phone: { type: 'string' }, phone2: { type: 'string' }, wilaya: { type: 'string' }, commune: { type: 'string' }, address: { type: 'string' } },
    },
    cart: {
      type: 'object',
      additionalProperties: false,
      description: 'the product(s), variant and quantity the customer chose for the order being taken (ids from the catalogue); omit when no product is chosen',
      properties: { items: { type: 'array', maxItems: 20, items: { type: 'object', required: ['productId'], properties: { productId: { type: 'string' }, variantId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } } } } },
    },
  },
} as const;

export const FORMAT_REMINDER = 'Format reminder: answer with the one JSON object of the OUTPUT section only (your answer above goes in "reply", with the same meaning — do not correct it, do not mention this reminder), no text around it.';

/** The first balanced `{…}` of a text (models sometimes wrap the object in a code fence or a sentence). */
export const extractJson = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

export const parseJsonObject = <S extends z.ZodTypeAny>(text: string, schema: S, prepare?: (parsed: Record<string, unknown>) => Record<string, unknown>): { ok: true; value: z.output<S> } | { ok: false; reason: string } => {
  const raw = extractJson(text);
  if (!raw) return { ok: false, reason: 'no_json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  // providers emit `null` for an absent optional field
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) if (v === null) delete (parsed as Record<string, unknown>)[k];
    if (prepare) parsed = prepare(parsed as Record<string, unknown>);
  }
  const r = schema.safeParse(parsed);
  return r.success ? { ok: true, value: r.data as z.output<S> } : { ok: false, reason: `schema:${r.error.issues[0]?.path.join('.') ?? ''}` };
};

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const upper = <T extends readonly string[]>(v: unknown, list: T): T[number] | undefined => {
  const s = str(v)?.trim().toUpperCase();
  return s && (list as readonly string[]).includes(s) ? (s as T[number]) : undefined;
};

/**
 * Tester report 26/10 ("the AI stops after one or two answers"): an object that is right in substance but not to the
 * letter — an extra key, `"status":"ok"`, `"confidence":"0.8"`, six product cards, a 2 100-character reply — no longer
 * counts as malformed (it ended the conversation with the team). Only `reply` must be there; what cannot be read takes
 * the neutral value (status OK, intent OTHER, confidence 0.5).
 */
/** journey retest R11-5: a reply written in another shape — an array of lines, an object holding the text. */
const replyText = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() ? v : undefined;
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return (v as string[]).join('\n').trim() || undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    return [r.reply, r.text, r.message, r.content].find((x): x is string => typeof x === 'string' && !!x.trim());
  }
  return undefined;
};
export const normalizeReplyObject = (input: Record<string, unknown>): Record<string, unknown> => {
  // journey retest R11-5 (17/11): `reply` not a string (`malformed_output:schema:reply`, F8 T1 ⇒ 503) — the text it holds in another
  // shape, or the message under another key (message / text / answer / response), is the reply
  let o = input;
  if (typeof o.reply !== 'string') {
    const alt = replyText(o.reply) ?? [o.message, o.text, o.answer, o.response].map(replyText).find((x) => !!x);
    if (!alt) return o;
    o = { ...o, reply: alt };
  }
  if (typeof o.reply !== 'string') return o;
  const conf = typeof o.confidence === 'number' ? o.confidence : Number.parseFloat(str(o.confidence) ?? '');
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s?.trim()) : []);
  const customer = o.customer && typeof o.customer === 'object' && !Array.isArray(o.customer) ? (o.customer as Record<string, unknown>) : null;
  const CUSTOMER_MAX = { name: 80, phone: 30, phone2: 30, wilaya: 60, commune: 100, address: 500 } as const;
  const kept = customer ? Object.fromEntries(Object.entries(CUSTOMER_MAX).flatMap(([k, max]) => (str(customer[k])?.trim() ? [[k, str(customer[k])!.trim().slice(0, max)]] : []))) : {};
  const language = str(o.language)?.trim().toLowerCase();
  const detail = str(o.statusDetail)?.trim();
  const evidence = str(o.evidence)?.trim();
  return {
    reply: o.reply.slice(0, 2000),
    status: upper(o.status, AI_REPLY_STATUSES) ?? 'OK',
    ...(detail ? { statusDetail: detail.slice(0, 200) } : {}),
    ...(evidence ? { evidence: evidence.slice(0, 300) } : {}),
    intent: upper(o.intent, AI_REPLY_INTENTS) ?? 'OTHER',
    productCards: ids(o.productCards).slice(0, 5),
    ...(ids(o.productPhotos).length ? { productPhotos: ids(o.productPhotos).slice(0, 2) } : {}),
    recommendations: (Array.isArray(o.recommendations) ? o.recommendations : [])
      .flatMap((r) => {
        const s = r && typeof r === 'object' ? str((r as Record<string, unknown>).sourceId) : undefined;
        const d = r && typeof r === 'object' ? str((r as Record<string, unknown>).recommendedId) : undefined;
        return s && d ? [{ sourceId: s, recommendedId: d }] : [];
      })
      .slice(0, 3),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf >= 2 && conf <= 100 ? conf / 100 : conf)) : 0.5,
    ...(language && (AI_LANGUAGES as readonly string[]).includes(language) ? { language } : {}),
    ...(Object.keys(kept).length ? { customer: kept } : {}),
  };
};

/**
 * The reply object of a model answer. Journey retest R11-5: when the first `{…}` of the text is not it (a note, a tool-call-like
 * object before the answer), the next objects of the text are tried (3 at most).
 */
export const parseReplyOutput = (text: string) => {
  const first = parseJsonObject(text, AiReplyOutputSchema, normalizeReplyObject);
  if (first.ok) return first;
  let rest = text;
  for (let i = 0; i < 3; i++) {
    const raw = extractJson(rest);
    if (!raw) break;
    rest = rest.slice(rest.indexOf(raw) + raw.length);
    const next = parseJsonObject(rest, AiReplyOutputSchema, normalizeReplyObject);
    if (next.ok) return next;
  }
  return first;
};

/**
 * Last resort after the format reminder (tester report 26/10): the model's first answer, when it is a plain message to
 * the customer (no JSON object at all — it wrote prose) or a JSON object cut off whose `reply` can still be read, is sent
 * as the reply with the neutral status. Null when there is nothing safe to send (empty, or JSON without a readable reply).
 */
export const salvageReply = (text: string): AiReplyOutput | null => {
  const t = text.trim();
  if (!t) return null;
  let reply: string | null = null;
  if (!t.includes('{')) reply = t.replace(/^```\w*\s*|\s*```$/g, '').trim();
  else {
    // a complete `reply` string only (closing quote): never half a sentence of an answer cut by the token limit
    const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
    if (m) {
      try {
        reply = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        reply = null;
      }
    }
  }
  if (!reply?.trim()) return null;
  return { reply: reply.trim().slice(0, 2000), status: 'OK', intent: 'OTHER', productCards: [], recommendations: [], confidence: 0.5 };
};
