// Live adapter of the AI provider port (04-ai-pipeline §6, §9) — Vercel AI SDK v4 over OpenAI / Anthropic / Google /
// Groq. SAFETY RULE: this class is NEVER instantiated on a developer machine or in tests unless `AI_ALLOW_LIVE=true`;
// the gateway factory (not this file) refuses the `live` driver in development / test otherwise, and the contract
// tests of this adapter (live-ai.gateway.spec.ts) stub `fetch`. One call = one model step (`maxSteps: 1`, tools
// without `execute`): the pipeline owns the tool loop. Prompts, customer text and API keys are never logged and never
// copied into an error message.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, InvalidToolArgumentsError, NoSuchToolError, RetryError, experimental_transcribe as transcribeAudio, generateText, jsonSchema, tool, type CoreMessage, type LanguageModel, type ToolSet } from 'ai';
import {
  AiProviderError,
  type AiGateway,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiMessage,
  type AiModelRef,
  type AiProviderName,
  type AiPurpose,
  type AiToolDef,
  type AiTranscribeRequest,
  type AiTranscribeResult,
} from './ai.gateway';

export type LiveAiGatewayOptions = {
  /** Tests only. Default: the global `fetch`, looked up at call time. */
  fetch?: typeof fetch;
  /** `AI_REPLY_THINKING`: `off` = chat steps (purpose `reply`) of Claude 5 models without thinking */
  replyThinking?: 'low' | 'off';
  /**
   * `AI_STABLE_TOOLS`: `on` = Anthropic calls carry the whole tool list of the turn on every step (measured live 23–24/11: the prompt
   * cache was re-read on 10 of 60 first steps and ~7 000 tokens re-written on the others, because the tool list — the first part of
   * the cached prefix — changes with what each message may use)
   */
  stableTools?: boolean;
};

/** SDK retries on retryable API errors (429, 5xx, connection): 2 for a model step (04 §6), 1 for a transcription. */
const GENERATE_MAX_RETRIES = 2;
const TRANSCRIBE_MAX_RETRIES = 1;

/** File extension the transcription endpoints recognise, per audio mime (the SDK names the part `audio`, no extension). */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/flac': 'flac',
};

const requireKey = (model: AiModelRef): string => {
  const key = model.apiKey?.trim();
  if (!key) throw new AiProviderError('no_key', model.provider, `${model.provider} no_key`);
  return key;
};

/**
 * A step offered no tools (the last step of the loop, or after a handoff) still carries the tool calls of the earlier
 * steps: they go as plain text, because Anthropic refuses `tool_use` / `tool_result` blocks in a request without tool
 * definitions (400 — the AI then looked "unavailable" right after a `handoff_to_human` call, tester report 26/10).
 */
const flattenTools = (messages: AiMessage[]): AiMessage[] =>
  messages.map((m): AiMessage => {
    if (m.role === 'tool') return { role: 'user', content: `[tool result ${m.name}] ${JSON.stringify(m.result ?? null)}` };
    if (m.role === 'assistant' && m.toolCalls?.length) return { role: 'assistant', content: [m.content, ...m.toolCalls.map((c) => `[tool call ${c.name} ${JSON.stringify(c.args ?? {})}]`)].filter(Boolean).join('\n') };
    return m;
  });

const toMessages = (messages: AiMessage[]): CoreMessage[] =>
  messages.map((m): CoreMessage => {
    if (m.role === 'user') {
      if (typeof m.content === 'string') return { role: 'user', content: m.content };
      return {
        role: 'user',
        content: m.content.map((p) => (p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image' as const, image: p.image, mimeType: p.mime })),
      };
    }
    if (m.role === 'assistant') {
      if (!m.toolCalls?.length) return { role: 'assistant', content: m.content };
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((c) => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.name, args: c.args })),
        ],
      };
    }
    return { role: 'tool', content: [{ type: 'tool-result', toolCallId: m.toolCallId, toolName: m.name, result: m.result }] };
  });

/** Tools are declared without `execute`: the model step returns the calls and the pipeline runs them. */
const toTools = (defs: AiToolDef[] | undefined): ToolSet | undefined => {
  if (!defs?.length) return undefined;
  const set: ToolSet = {};
  for (const def of defs) set[def.name] = tool({ description: def.description, parameters: jsonSchema(def.parameters) });
  return set;
};

const count = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

const errorName = (e: unknown) => (typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : '');
const isTimeout = (e: unknown) => {
  const name = errorName(e);
  return name === 'AbortError' || name === 'TimeoutError' || name.includes('Timeout');
};

/**
 * 04 §6 failure classes. The message is `<provider> <status|kind>` and nothing else: the SDK errors carry the request
 * body (prompt, customer text) and the response body, none of which may travel further.
 */
/** the JSON body without its `temperature` field */
const withoutTemperature = (init?: RequestInit): RequestInit | undefined => {
  if (typeof init?.body !== 'string') return init;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (!('temperature' in body)) return init;
    delete body.temperature;
    return { ...init, body: JSON.stringify(body) };
  } catch {
    return init;
  }
};
/**
 * 22/11 (slow replies, R23): the Claude 5 models think before every answer by default (Haiku 5.5: adaptive thinking, effort
 * `medium`) — 500 to 880 output tokens for a three-sentence chat reply, most of the 2.5–4.8 s of a step. A chat turn (and the
 * image description / caption of a customer photo) asks for effort `low`; the other purposes (agent generation, FAQ
 * extraction…) keep the model's default. The SDK in use (ai 4 / @ai-sdk/anthropic 1) has no setting for it: the request body is
 * completed here. Claude 4.x models reject `effort`: only the 5 generation gets it.
 */
const LOW_EFFORT_PURPOSES: ReadonlySet<AiPurpose> = new Set(['reply', 'vision_describe', 'vision_match', 'caption', 'page_post', 'voice_fix']);
export const anthropicEffort = (modelId: string, purpose: AiPurpose): 'low' | null =>
  LOW_EFFORT_PURPOSES.has(purpose) && /^claude-(haiku|sonnet|opus|fable|mythos)-5(\b|[-.])/.test(modelId) ? 'low' : null;
const withEffort = (init: RequestInit | undefined, effort: string, noThinking = false): RequestInit | undefined => {
  if (typeof init?.body !== 'string') return init;
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const config = body.output_config && typeof body.output_config === 'object' ? (body.output_config as Record<string, unknown>) : {};
    return { ...init, body: JSON.stringify({ ...body, output_config: { ...config, effort }, ...(noThinking ? { thinking: { type: 'disabled' } } : {}) }) };
  } catch {
    return init;
  }
};
/** An Anthropic Messages answer read back after the SDK refused it (a call to a tool not offered): text, offered calls, usage. */
export const anthropicStep = (body: unknown, offered: ReadonlySet<string>): Pick<AiGenerateResult, 'text' | 'toolCalls' | 'usage' | 'cache'> | null => {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { content?: unknown }).content)) return null;
  const b = body as { content: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[]; usage?: Record<string, unknown> };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    text: b.content.filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join(''),
    toolCalls: b.content
      .filter((c) => c.type === 'tool_use' && typeof c.name === 'string' && offered.has(c.name) && typeof c.id === 'string')
      .map((c) => ({ id: c.id!, name: c.name!, args: c.input && typeof c.input === 'object' && !Array.isArray(c.input) ? (c.input as Record<string, unknown>) : {} })),
    usage: { inputTokens: n(b.usage?.input_tokens), outputTokens: n(b.usage?.output_tokens) },
    cache: { read: n(b.usage?.cache_read_input_tokens), write: n(b.usage?.cache_creation_input_tokens) },
  };
};
/** a 400 whose reason names the `temperature` parameter */
const rejectsTemperature = (error: unknown): boolean => {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(last) && last.statusCode === 400 && /temperature/i.test(`${last.message} ${last.responseBody ?? ''}`);
};
/**
 * journey retest R1-1 (17/11): what an SDK error that is not an HTTP answer was (« provider_error » alone hid an
 * `AI_NoSuchToolError` — the model called the withheld handoff_to_human — for 5 turns of 59). The SDK's error name only,
 * never its message (it quotes the request).
 */
const SDK_ERRORS: Record<string, string> = {
  AI_NoSuchToolError: 'sdk:no_such_tool',
  AI_InvalidToolArgumentsError: 'sdk:invalid_tool_args',
  AI_ToolCallRepairError: 'sdk:tool_call_repair',
  AI_InvalidPromptError: 'sdk:invalid_prompt',
  AI_UnsupportedFunctionalityError: 'sdk:unsupported',
  AI_InvalidArgumentError: 'sdk:invalid_argument',
  AI_JSONParseError: 'sdk:response_parse',
  AI_TypeValidationError: 'sdk:response_parse',
  AI_InvalidResponseDataError: 'sdk:response_parse',
  AI_NoContentGeneratedError: 'sdk:no_content',
};
export const sdkErrorDetail = (e: unknown): string => {
  const name = errorName(e);
  return SDK_ERRORS[name] ?? `sdk:${(name || 'error').replace(/^AI_/, '').replace(/[^\w]/g, '').slice(0, 40) || 'error'}`;
};

const toProviderError = (provider: AiProviderName, error: unknown, aborted: boolean): AiProviderError => {
  if (error instanceof AiProviderError) return error;
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (aborted || isTimeout(last) || isTimeout(error) || isTimeout((last as { cause?: unknown } | null)?.cause)) return new AiProviderError('timeout', provider, `${provider} timeout`);
  if (APICallError.isInstance(last)) {
    const status = last.statusCode;
    if (status === 401 || status === 403) return new AiProviderError('provider_rejected', provider, `${provider} ${status}`, status);
    // for the logs: the provider's error type and the parameter names it cites (`temperature`), never its free text,
    // which may echo the key, the prompt or a customer message
    const params = [...last.message.matchAll(/`([\w.]{1,40})`/g)].map((m) => m[1]);
    let type: unknown;
    try {
      type = (JSON.parse(last.responseBody ?? '') as { error?: { type?: unknown } }).error?.type;
    } catch {}
    // no HTTP status: the request never got an answer (connection refused / reset, DNS)
    const detail = [typeof type === 'string' ? type.slice(0, 40) : null, params.length ? `params: ${params.join(', ')}` : null, status === undefined ? 'network' : null].filter(Boolean).join(' · ') || undefined;
    return new AiProviderError('provider_error', provider, `${provider} ${status ?? 'provider_error'}`, status, detail);
  }
  // the connection failed before any answer (`fetch failed`, ECONNRESET, DNS): the provider's side
  const code = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? '');
  const cause = (last as { cause?: unknown } | null)?.cause;
  if (last instanceof TypeError || /^(E[A-Z]{3,}|UND_ERR)/.test(code(last)) || /^(E[A-Z]{3,}|UND_ERR)/.test(code(cause))) return new AiProviderError('provider_error', provider, `${provider} provider_error`, undefined, 'network');
  // not an answer of the provider: the SDK refused the request or could not read the step (never the provider's health)
  return new AiProviderError('provider_error', provider, `${provider} provider_error`, undefined, sdkErrorDetail(last), true);
};
const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

type Row = Record<string, unknown>;
const idsOf = (list: unknown, field: string) => (Array.isArray(list) ? (list as Row[]).map((m) => String(m?.[field] ?? '')).filter(Boolean) : []);
/** Model list endpoint of each provider (key test): the official API hosts, the key in a header (never in the URL). */
const MODEL_LISTS: Record<AiProviderName, { url: string; headers: (key: string) => Record<string, string>; ids: (json: unknown) => string[] }> = {
  openai: { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: `Bearer ${k}` }), ids: (j) => idsOf((j as Row | null)?.data, 'id') },
  groq: { url: 'https://api.groq.com/openai/v1/models', headers: (k) => ({ Authorization: `Bearer ${k}` }), ids: (j) => idsOf((j as Row | null)?.data, 'id') },
  anthropic: { url: 'https://api.anthropic.com/v1/models?limit=1000', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }), ids: (j) => idsOf((j as Row | null)?.data, 'id') },
  google: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: (k) => ({ 'x-goog-api-key': k }), ids: (j) => idsOf((j as Row | null)?.models, 'name').map((n) => n.replace(/^models\//, '')) },
};

/** Below ~1 000 tokens (Anthropic's minimum cacheable prompt) the cache marker is not sent. */
const CACHE_MIN_CHARS = 3_500;

export class LiveAiGateway implements AiGateway {
  readonly driver = 'live' as const;
  constructor(private readonly options: LiveAiGatewayOptions = {}) {}
  /** `provider:modelId` of the models that refused `temperature` once: later calls go without it straight away */
  private readonly noTemperature = new Set<string>();

  /** Resolved at call time, so that replacing `globalThis.fetch` (tests) is honoured. */
  private readonly fetch: typeof fetch = (input, init) => (this.options.fetch ?? globalThis.fetch)(input, init);

  private languageModel(model: AiModelRef, apiKey: string, dropTemperature = false, purpose?: AiPurpose, onAnswer?: (body: unknown) => void): LanguageModel {
    const effort = model.provider === 'anthropic' && purpose ? anthropicEffort(model.modelId, purpose) : null;
    // UX-066: AI_REPLY_THINKING=off — a chat step without thinking (Claude 5 models accept it at effort low)
    const noThinking = effort === 'low' && purpose === 'reply' && this.options.replyThinking === 'off';
    const sent: typeof globalThis.fetch = effort ? (input, init) => this.fetch(input, withEffort(init, effort, noThinking)) : this.fetch;
    // R23 (22/11): the provider's answer is kept for the step — a step that calls a tool not offered (« noop ») is refused whole
    // by the SDK, and the reply the model wrote next to that call was lost (a second model call, 1.6–3.4 s, for the same answer)
    const base: typeof globalThis.fetch = onAnswer
      ? async (input, init) => {
          const res = await sent(input, init);
          if (res.ok) onAnswer(await res.clone().json().catch(() => null));
          return res;
        }
      : sent;
    // the SDK always sends a temperature (0 when none is given): a model that refuses it gets the body without one
    const fetch: typeof globalThis.fetch = dropTemperature ? (input, init) => base(input, withoutTemperature(init)) : base;
    switch (model.provider) {
      case 'openai':
        return createOpenAI({ apiKey, fetch }).chat(model.modelId);
      case 'anthropic':
        return createAnthropic({ apiKey, fetch })(model.modelId);
      case 'google':
        return createGoogleGenerativeAI({ apiKey, fetch })(model.modelId);
      case 'groq':
        return createGroq({ apiKey, fetch })(model.modelId);
      default:
        throw new AiProviderError('provider_error', model.provider, `${String(model.provider)} provider_error`);
    }
  }

  async checkKey(provider: AiProviderName, apiKey: string, timeoutMs: number): Promise<{ models: string[] }> {
    const spec = MODEL_LISTS[provider];
    if (!spec) throw new AiProviderError('provider_error', provider, `${String(provider)} provider_error`, undefined, 'unsupported');
    const key = apiKey.trim();
    if (!key) throw new AiProviderError('no_key', provider, `${provider} no_key`);
    let res: Response;
    try {
      res = await this.fetch(spec.url, { method: 'GET', headers: { Accept: 'application/json', ...spec.headers(key) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (isTimeout(e) || isTimeout((e as { cause?: unknown } | null)?.cause)) throw new AiProviderError('timeout', provider, `${provider} timeout`);
      throw new AiProviderError('provider_error', provider, `${provider} network`, undefined, 'network');
    }
    if (res.status === 401 || res.status === 403) throw new AiProviderError('provider_rejected', provider, `${provider} ${res.status}`, res.status);
    if (!res.ok) {
      // Google answers 400 API_KEY_INVALID to a wrong key
      const text = await res.text().catch(() => '');
      if (provider === 'google' && res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(text)) throw new AiProviderError('provider_rejected', provider, `${provider} 400`, 400);
      throw new AiProviderError('provider_error', provider, `${provider} ${res.status}`, res.status);
    }
    return { models: spec.ids(await res.json().catch(() => null)) };
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
    const provider = req.model.provider;
    const apiKey = requireKey(req.model);
    const signal = AbortSignal.timeout(req.timeoutMs);
    // journey retest R1-1: the calls the SDK cannot accept (a tool this step does not offer, arguments that are not JSON)
    const rejected: AiGenerateResult['rejectedToolCalls'] = [];
    let answer: unknown = null;
    try {
      // AI_STABLE_TOOLS: the whole tool list of the turn, so the cached prefix does not change with the tools this step offers
      const stable = provider === 'anthropic' && this.options.stableTools === true && !!req.tools?.length && !!req.allTools?.length;
      const offered = new Set((req.tools ?? []).map((t) => t.name));
      const tools = toTools(stable ? req.allTools : req.tools);
      // full-test 15/11 proposal 13 (18 255 input tokens for one turn of a 10-product shop): Anthropic caches the stable
      // start of the system prompt (identity → catalogue, ≥ ~1 000 tokens) — the next turns of the conversation re-read it
      // from the cache; the rest of the system prompt (order state, language guess…) follows as a second block
      const prefix = req.systemCachePrefix;
      const cached = provider === 'anthropic' && !!prefix && prefix.length >= CACHE_MIN_CHARS && req.system.startsWith(prefix);
      const systemMessages: CoreMessage[] = cached
        ? [{ role: 'system', content: prefix!, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }, ...(req.system.slice(prefix!.length).trim() ? [{ role: 'system' as const, content: req.system.slice(prefix!.length).trim() }] : [])]
        : [];
      const run = (dropTemperature: boolean) =>
        generateText({
          model: this.languageModel(req.model, apiKey, dropTemperature, req.purpose, provider === 'anthropic' ? (b) => (answer = b) : undefined),
          ...(cached ? {} : { system: req.system }),
          messages: [...systemMessages, ...toMessages(tools ? req.messages : flattenTools(req.messages))],
          ...(tools
            ? {
                tools,
                // nothing is repaired: the call is kept aside (the SDK then throws) and handed back as `rejectedToolCalls`
                experimental_repairToolCall: async ({ toolCall }) => {
                  rejected.push({ id: toolCall.toolCallId, name: toolCall.toolName, args: parseArgs(toolCall.args) });
                  return null;
                },
              }
            : {}),
          ...(req.temperature !== undefined && !dropTemperature ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
          maxSteps: 1,
          maxRetries: GENERATE_MAX_RETRIES,
          abortSignal: signal,
        });
      // newer models refuse the sampling setting (Anthropic: "`temperature` is deprecated for this model"): ask again without it
      const modelKey = `${provider}:${req.model.modelId}`;
      const res = await run(this.noTemperature.has(modelKey)).catch((e: unknown) => {
        if (this.noTemperature.has(modelKey) || !rejectsTemperature(e)) throw e;
        this.noTemperature.add(modelKey);
        return run(true);
      });
      const calls = res.toolCalls.map((c) => ({ id: c.toolCallId, name: c.toolName, args: (c.args ?? {}) as Record<string, unknown> }));
      // a tool sent only to keep the prefix stable is not offered on this step: its call is handed back as rejected, never run
      const notOffered = stable ? calls.filter((c) => !offered.has(c.name)) : [];
      return {
        text: res.text,
        toolCalls: notOffered.length ? calls.filter((c) => offered.has(c.name)) : calls,
        ...(notOffered.length ? { rejectedToolCalls: notOffered } : {}),
        usage: { inputTokens: count(res.usage.promptTokens), outputTokens: count(res.usage.completionTokens) },
        ...cacheOf(res.providerMetadata),
        finishReason: res.finishReason,
      };
    } catch (e) {
      // journey retest R1-1: a step whose only fault is a call to a tool not offered (or unreadable arguments) is not a
      // failure: its calls come back as `rejectedToolCalls` (the step's tokens are unknown here: counted 0)
      if (rejected.length && (NoSuchToolError.isInstance(e) || InvalidToolArgumentsError.isInstance(e))) {
        // R23 (22/11): what the provider answered is read back — the text the model wrote with the call (often the whole JSON
        // reply) and its calls to offered tools; the pipeline answers with that text instead of asking the model again
        const kept = anthropicStep(answer, new Set((req.tools ?? []).map((t) => t.name)));
        return { text: kept?.text ?? '', toolCalls: kept?.toolCalls ?? [], rejectedToolCalls: [...rejected], usage: kept?.usage ?? { inputTokens: 0, outputTokens: 0 }, ...(kept?.cache ? { cache: kept.cache } : {}), finishReason: 'tool-calls' };
      }
      throw toProviderError(provider, e, signal.aborted);
    }
  }

  /**
   * 04 §9 voice: Groq `whisper-large-v3-turbo`, OpenAI `whisper-1` as fallback, both with `response_format=verbose_json`
   * (language + duration). The SDK sends the audio as a part named `audio` typed from a signature sniff, and has no
   * `response_format` option for OpenAI: the multipart body is completed here before it leaves.
   */
  async transcribe(req: AiTranscribeRequest): Promise<AiTranscribeResult> {
    const provider = req.model.provider;
    const apiKey = requireKey(req.model);
    const signal = AbortSignal.timeout(req.timeoutMs);
    try {
      if (provider !== 'groq' && provider !== 'openai') throw new AiProviderError('provider_error', provider, `${provider} provider_error`);
      const fetch = this.transcriptionFetch(req.mime, req.language, req.prompt);
      const res = await transcribeAudio({
        model: provider === 'groq' ? createGroq({ apiKey, fetch }).transcription(req.model.modelId) : createOpenAI({ apiKey, fetch }).transcription(req.model.modelId),
        audio: req.audio,
        ...(provider === 'groq' ? { providerOptions: { groq: { responseFormat: 'verbose_json' } } } : {}),
        maxRetries: TRANSCRIBE_MAX_RETRIES,
        abortSignal: signal,
      });
      return { text: res.text, language: res.language ?? null, durationSec: typeof res.durationInSeconds === 'number' && Number.isFinite(res.durationInSeconds) ? res.durationInSeconds : null };
    } catch (e) {
      throw toProviderError(provider, e, signal.aborted);
    }
  }

  /** Same transport, with the real mime / file extension of the audio and `response_format=verbose_json` on the form. */
  private transcriptionFetch(mime: string, language?: string, prompt?: string): typeof fetch {
    const type = mime.split(';')[0]!.trim().toLowerCase();
    const extension = AUDIO_EXTENSIONS[type];
    return (input, init) => {
      const body = init?.body;
      if (body instanceof FormData) {
        const file = body.get('file');
        if (extension && typeof file !== 'string' && file !== null) body.set('file', new File([file], `audio.${extension}`, { type }));
        if (!body.has('response_format')) body.set('response_format', 'verbose_json');
        if (language) body.set('language', language);
        if (prompt) body.set('prompt', prompt);
      }
      return this.fetch(input, init);
    };
  }
}

/** 22/11 (slow replies): the Anthropic prompt-cache tokens of a step, when the provider reports them. */
const cacheOf = (meta: unknown): { cache?: { read: number; write: number } } => {
  const a = (meta as { anthropic?: { cacheReadInputTokens?: unknown; cacheCreationInputTokens?: unknown } } | undefined)?.anthropic;
  if (!a) return {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { cache: { read: n(a.cacheReadInputTokens), write: n(a.cacheCreationInputTokens) } };
};
