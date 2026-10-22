// 04-ai-pipeline §4.1 — the output contract of a reply turn (replaces the V1 `[STATUS:…]` tags). The JSON Schema is
// part of the prompt; whatever the model returns is validated here. Malformed ⇒ one "format reminder" retry, then F-6.
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

export const parseJsonObject = <S extends z.ZodTypeAny>(text: string, schema: S): { ok: true; value: z.output<S> } | { ok: false; reason: string } => {
  const raw = extractJson(text);
  if (!raw) return { ok: false, reason: 'no_json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  // providers emit `null` for an absent optional field
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const [k, v] of Object.entries(parsed)) if (v === null) delete (parsed as Record<string, unknown>)[k];
  const r = schema.safeParse(parsed);
  return r.success ? { ok: true, value: r.data as z.output<S> } : { ok: false, reason: `schema:${r.error.issues[0]?.path.join('.') ?? ''}` };
};

export const parseReplyOutput = (text: string) => parseJsonObject(text, AiReplyOutputSchema);
