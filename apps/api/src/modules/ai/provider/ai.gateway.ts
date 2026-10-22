// 04-ai-pipeline §6 — the single port to the AI providers (text, vision, transcription). Two adapters: `fake`
// (default; deterministic and scriptable — the only one allowed on a developer machine and in tests) and `live`
// (Vercel AI SDK over OpenAI / Anthropic / Google / Groq). Nothing else in the code base talks to an AI provider.
// One call = one model step: the pipeline owns the tool loop so that every tool call is persisted before it runs.
export const AI_GATEWAY = Symbol('AI_GATEWAY');

export type AiProviderName = 'openai' | 'anthropic' | 'google' | 'groq';
/** A model of the platform routing (`AiModel` + its provider), with the decrypted key of that provider. */
export type AiModelRef = { provider: AiProviderName; modelId: string; apiKey: string | null };

export type AiPart = { type: 'text'; text: string } | { type: 'image'; image: Buffer; mime: string };
export type AiToolCallRequest = { id: string; name: string; args: Record<string, unknown> };
export type AiMessage =
  | { role: 'user'; content: string | AiPart[] }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; result: unknown };
/** `parameters` is a JSON Schema object (04-ai-pipeline §4.2). */
export type AiToolDef = { name: string; description: string; parameters: Record<string, unknown> };

/** What the call is for: routes the fake adapter's default answers and labels metrics; never changes the live request. */
export type AiPurpose = 'reply' | 'vision_describe' | 'vision_match' | 'caption' | 'product_vision' | 'page_post' | 'agent_generation' | 'faq_extract';

export type AiGenerateRequest = {
  model: AiModelRef;
  purpose: AiPurpose;
  system: string;
  messages: AiMessage[];
  tools?: AiToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** per model call (`AiRoute.timeoutSec`) */
  timeoutMs: number;
};
export type AiUsage = { inputTokens: number; outputTokens: number };
export type AiGenerateResult = {
  /** final text of the step (the JSON object of the output contract when the step is the answer) */
  text: string;
  /** tool calls the model asked for; empty when the step is the final answer */
  toolCalls: AiToolCallRequest[];
  usage: AiUsage;
  finishReason: string;
};

export type AiTranscribeRequest = { model: AiModelRef; audio: Buffer; mime: string; timeoutMs: number };
export type AiTranscribeResult = { text: string; language: string | null; durationSec: number | null };

/**
 * Failure classes of 04-ai-pipeline §6: `provider_error` (5xx, network, 429 after the SDK retries), `timeout`,
 * `provider_rejected` (401 / 403: the platform key is wrong), `no_key` (no key configured for the provider).
 */
export type AiErrorKind = 'provider_error' | 'timeout' | 'provider_rejected' | 'no_key';
export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    public readonly provider: AiProviderName,
    message: string,
    public readonly status?: number,
    /** the provider's reason, for the logs only */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiGateway {
  readonly driver: 'fake' | 'live';
  generate(req: AiGenerateRequest): Promise<AiGenerateResult>;
  transcribe(req: AiTranscribeRequest): Promise<AiTranscribeResult>;
  /**
   * Admin key test (ADM-06): lists the provider's models with this key — no model id involved, so a wrong or retired model
   * cannot make a good key look unreachable (tester report 2026-10-21 UX-013). Live driver only.
   */
  checkKey?(provider: AiProviderName, apiKey: string, timeoutMs: number): Promise<{ models: string[] }>;
}

/** Non-reply calls carry their input as one JSON line after this marker (the fake adapter reads it back). */
export const INPUT_MARKER = 'INPUT_JSON: ';
export const withInput = (instruction: string, input: unknown) => `${instruction}\n${INPUT_MARKER}${JSON.stringify(input)}`;
export const readInput = <T>(req: Pick<AiGenerateRequest, 'messages'>): T | null => {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]!;
    if (m.role !== 'user') continue;
    const texts = typeof m.content === 'string' ? [m.content] : m.content.filter((p): p is Extract<AiPart, { type: 'text' }> => p.type === 'text').map((p) => p.text);
    for (const t of texts) {
      const at = t.lastIndexOf(INPUT_MARKER);
      if (at < 0) continue;
      try {
        return JSON.parse(t.slice(at + INPUT_MARKER.length).split('\n')[0]!) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
};
export const imagesOf = (req: Pick<AiGenerateRequest, 'messages'>): Buffer[] =>
  req.messages.flatMap((m) => (m.role === 'user' && typeof m.content !== 'string' ? m.content.filter((p): p is Extract<AiPart, { type: 'image' }> => p.type === 'image').map((p) => p.image) : []));
