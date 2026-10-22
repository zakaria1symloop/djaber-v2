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
import { APICallError, RetryError, experimental_transcribe as transcribeAudio, generateText, jsonSchema, tool, type CoreMessage, type LanguageModel, type ToolSet } from 'ai';
import {
  AiProviderError,
  type AiGateway,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiMessage,
  type AiModelRef,
  type AiProviderName,
  type AiToolDef,
  type AiTranscribeRequest,
  type AiTranscribeResult,
} from './ai.gateway';

export type LiveAiGatewayOptions = {
  /** Tests only. Default: the global `fetch`, looked up at call time. */
  fetch?: typeof fetch;
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
/** a 400 whose reason names the `temperature` parameter */
const rejectsTemperature = (error: unknown): boolean => {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(last) && last.statusCode === 400 && /temperature/i.test(`${last.message} ${last.responseBody ?? ''}`);
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
    const detail = [typeof type === 'string' ? type.slice(0, 40) : null, params.length ? `params: ${params.join(', ')}` : null].filter(Boolean).join(' · ') || undefined;
    return new AiProviderError('provider_error', provider, `${provider} ${status ?? 'provider_error'}`, status, detail);
  }
  return new AiProviderError('provider_error', provider, `${provider} provider_error`);
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

export class LiveAiGateway implements AiGateway {
  readonly driver = 'live' as const;
  constructor(private readonly options: LiveAiGatewayOptions = {}) {}
  /** `provider:modelId` of the models that refused `temperature` once: later calls go without it straight away */
  private readonly noTemperature = new Set<string>();

  /** Resolved at call time, so that replacing `globalThis.fetch` (tests) is honoured. */
  private readonly fetch: typeof fetch = (input, init) => (this.options.fetch ?? globalThis.fetch)(input, init);

  private languageModel(model: AiModelRef, apiKey: string, dropTemperature = false): LanguageModel {
    // the SDK always sends a temperature (0 when none is given): a model that refuses it gets the body without one
    const fetch: typeof globalThis.fetch = dropTemperature ? (input, init) => this.fetch(input, withoutTemperature(init)) : this.fetch;
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
    try {
      const tools = toTools(req.tools);
      const run = (dropTemperature: boolean) =>
        generateText({
          model: this.languageModel(req.model, apiKey, dropTemperature),
          system: req.system,
          messages: toMessages(req.messages),
          ...(tools ? { tools } : {}),
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
      return {
        text: res.text,
        toolCalls: res.toolCalls.map((c) => ({ id: c.toolCallId, name: c.toolName, args: (c.args ?? {}) as Record<string, unknown> })),
        usage: { inputTokens: count(res.usage.promptTokens), outputTokens: count(res.usage.completionTokens) },
        finishReason: res.finishReason,
      };
    } catch (e) {
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
      const fetch = this.transcriptionFetch(req.mime);
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
  private transcriptionFetch(mime: string): typeof fetch {
    const type = mime.split(';')[0]!.trim().toLowerCase();
    const extension = AUDIO_EXTENSIONS[type];
    return (input, init) => {
      const body = init?.body;
      if (body instanceof FormData) {
        const file = body.get('file');
        if (extension && typeof file !== 'string' && file !== null) body.set('file', new File([file], `audio.${extension}`, { type }));
        if (!body.has('response_format')) body.set('response_format', 'verbose_json');
      }
      return this.fetch(input, init);
    };
  }
}
