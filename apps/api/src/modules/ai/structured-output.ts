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
    intent: z.enum(AI_REPLY_INTENTS),
    productCards: z.array(z.string()).max(5),
    recommendations: z.array(z.object({ sourceId: z.string(), recommendedId: z.string() })).max(3),
    confidence: z.number().min(0).max(1),
    language: z.enum(AI_LANGUAGES).optional(),
    /** A4: the order details the customer gave so far — kept on the conversation, never asked again */
    customer: z
      .object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional(), phone2: z.string().max(30).optional(), wilaya: z.string().max(60).optional(), commune: z.string().max(100).optional(), address: z.string().max(500).optional() })
      .strict()
      .optional(),
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
    intent: { enum: [...AI_REPLY_INTENTS] },
    productCards: { type: 'array', maxItems: 5, items: { type: 'string', description: 'productId' } },
    recommendations: { type: 'array', maxItems: 3, items: { type: 'object', required: ['sourceId', 'recommendedId'], properties: { sourceId: { type: 'string' }, recommendedId: { type: 'string' } } } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    language: { enum: [...AI_LANGUAGES] },
    customer: {
      type: 'object',
      additionalProperties: false,
      description: 'order details the customer has given so far in this conversation (only what they actually said)',
      properties: { name: { type: 'string' }, phone: { type: 'string' }, phone2: { type: 'string' }, wilaya: { type: 'string' }, commune: { type: 'string' }, address: { type: 'string' } },
    },
  },
} as const;

export const FORMAT_REMINDER = 'Format reminder: answer with the one JSON object of the OUTPUT section only (your answer above goes in "reply"), no text around it.';

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
export const normalizeReplyObject = (o: Record<string, unknown>): Record<string, unknown> => {
  if (typeof o.reply !== 'string') return o;
  const conf = typeof o.confidence === 'number' ? o.confidence : Number.parseFloat(str(o.confidence) ?? '');
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s?.trim()) : []);
  const customer = o.customer && typeof o.customer === 'object' && !Array.isArray(o.customer) ? (o.customer as Record<string, unknown>) : null;
  const CUSTOMER_MAX = { name: 80, phone: 30, phone2: 30, wilaya: 60, commune: 100, address: 500 } as const;
  const kept = customer ? Object.fromEntries(Object.entries(CUSTOMER_MAX).flatMap(([k, max]) => (str(customer[k])?.trim() ? [[k, str(customer[k])!.trim().slice(0, max)]] : []))) : {};
  const language = str(o.language)?.trim().toLowerCase();
  const detail = str(o.statusDetail)?.trim();
  return {
    reply: o.reply.slice(0, 2000),
    status: upper(o.status, AI_REPLY_STATUSES) ?? 'OK',
    ...(detail ? { statusDetail: detail.slice(0, 200) } : {}),
    intent: upper(o.intent, AI_REPLY_INTENTS) ?? 'OTHER',
    productCards: ids(o.productCards).slice(0, 5),
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

export const parseReplyOutput = (text: string) => parseJsonObject(text, AiReplyOutputSchema, normalizeReplyObject);

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
