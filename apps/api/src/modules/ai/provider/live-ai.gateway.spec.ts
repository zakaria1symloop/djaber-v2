// Contract tests of the live AI adapter (04-ai-pipeline §6, §9): exact hosts, paths, headers and bodies the Vercel AI
// SDK produces, and the mapping of the provider answers and failures. NO network: `globalThis.fetch` is replaced by a
// stub that replays scripted provider JSON and refuses any host other than the one the test expects.
import { AiProviderError, type AiGenerateRequest, type AiToolDef } from './ai.gateway';
import { LiveAiGateway } from './live-ai.gateway';

type Call = { method: string; url: string; host: string; path: string; headers: Record<string, string>; json: any; form: FormData | null };
type Reply = { status?: number; json?: unknown; throws?: Error; hang?: true };

const KEY = 'test-key';
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

/** A `fetch` that never leaves the process: one expected host, scripted replies, every request recorded. */
const stubFetch = (expectedHost: string) => {
  const calls: Call[] = [];
  const refused: string[] = [];
  const queue: Reply[] = [];
  const impl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const { hostname, pathname } = new URL(url);
    if (hostname !== expectedHost) {
      refused.push(hostname);
      throw new Error(`TEST FAILURE: unexpected host ${hostname}`);
    }
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: init?.method ?? 'GET', url, host: hostname, path: pathname, headers, json: typeof init?.body === 'string' ? JSON.parse(init.body) : null, form: init?.body instanceof FormData ? init.body : null });
    const signal = init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal); // every call carries the timeout
    const r = queue.shift();
    if (!r) throw new Error(`TEST FAILURE: unexpected call ${init?.method ?? 'GET'} ${url}`);
    if (r.throws) throw r.throws;
    if (r.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal!.reason);
        if (signal!.aborted) abort();
        else signal!.addEventListener('abort', abort, { once: true });
      });
    }
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { impl, calls, refused, reply: (...r: Reply[]) => queue.push(...r), pending: () => queue.length };
};

let net: ReturnType<typeof stubFetch>;
const gateway = new LiveAiGateway();
const expectHost = (host: string) => {
  net = stubFetch(host);
  globalThis.fetch = net.impl as unknown as typeof fetch;
  return net;
};

beforeEach(() => {
  expectHost('no-host-expected.invalid');
  // the SDK waits 2 s then 4 s between retries: keep the order, drop the wait
  jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => realSetTimeout(fn, Math.min(ms ?? 0, 5), ...args)) as unknown as typeof setTimeout);
});
afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = realFetch;
  expect(net.pending()).toBe(0); // every scripted reply was consumed
  expect(net.refused).toEqual([]); // and no request went to another host
});

const SYSTEM = 'Tu es l’assistant de la boutique Yasmine.';
const QUESTION = 'Salam, chhal la robe rouge ?';
const SEARCH_TOOL: AiToolDef = {
  name: 'search_products',
  description: 'Search the shop catalogue',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'], additionalProperties: false },
};
const request = (provider: AiGenerateRequest['model']['provider'], modelId: string, over: Partial<AiGenerateRequest> = {}): AiGenerateRequest => ({
  model: { provider, modelId, apiKey: KEY },
  purpose: 'reply',
  system: SYSTEM,
  messages: [{ role: 'user', content: QUESTION }],
  temperature: 0.3,
  maxTokens: 500,
  timeoutMs: 5_000,
  ...over,
});
const failure = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
};

const openaiText = (content: string) => ({
  id: 'chatcmpl-fixture-1',
  object: 'chat.completion',
  created: 1_760_000_000,
  model: 'gpt-4o-mini-2024-07-18',
  choices: [{ index: 0, message: { role: 'assistant', content }, logprobs: null, finish_reason: 'stop' }],
  usage: { prompt_tokens: 42, completion_tokens: 9, total_tokens: 51 },
});
const openaiToolCall = {
  id: 'chatcmpl-fixture-2',
  object: 'chat.completion',
  created: 1_760_000_001,
  model: 'gpt-4o-mini-2024-07-18',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc123', type: 'function', function: { name: 'search_products', arguments: '{"query":"robe rouge","limit":5}' } }] },
      logprobs: null,
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 60, completion_tokens: 18, total_tokens: 78 },
};
const openaiError = (message: string, type: string) => ({ error: { message, type, param: null, code: null } });

describe('LiveAiGateway.generate — OpenAI chat completions', () => {
  it('text answer: host, path, bearer, body and the mapped result', async () => {
    expectHost('api.openai.com').reply({ json: openaiText('La robe rouge est à 2 500 DA.') });
    const res = await gateway.generate(request('openai', 'gpt-4o-mini', { tools: [SEARCH_TOOL] }));
    expect(res).toEqual({ text: 'La robe rouge est à 2 500 DA.', toolCalls: [], usage: { inputTokens: 42, outputTokens: 9 }, finishReason: 'stop' });

    expect(net.calls).toHaveLength(1);
    const call = net.calls[0]!;
    expect([call.method, call.host, call.path]).toEqual(['POST', 'api.openai.com', '/v1/chat/completions']);
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.json).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: QUESTION },
      ],
      tools: [{ type: 'function', function: { name: 'search_products', description: 'Search the shop catalogue', parameters: SEARCH_TOOL.parameters } }],
    });
    expect(call.json.stream).toBeUndefined(); // one blocking model step
  });

  it('no tools given ⇒ no `tools` in the body; missing usage is reported as 0', async () => {
    expectHost('api.openai.com').reply({ json: { ...openaiText('ok'), usage: undefined } });
    const res = await gateway.generate(request('openai', 'gpt-4o-mini', { temperature: undefined, maxTokens: undefined }));
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(net.calls[0]!.json.tools).toBeUndefined();
    expect(net.calls[0]!.json.max_tokens).toBeUndefined();
  });

  it('tool call answer ⇒ { id, name, args }; the follow-up carries the assistant tool call and the tool result', async () => {
    expectHost('api.openai.com').reply({ json: openaiToolCall }, { json: openaiText('Oui, elle est disponible.') });
    const first = await gateway.generate(request('openai', 'gpt-4o-mini', { tools: [SEARCH_TOOL] }));
    expect(first.toolCalls).toEqual([{ id: 'call_abc123', name: 'search_products', args: { query: 'robe rouge', limit: 5 } }]);
    expect(first.text).toBe('');
    expect(first.finishReason).toBe('tool-calls');
    expect(first.usage).toEqual({ inputTokens: 60, outputTokens: 18 });
    expect(net.calls).toHaveLength(1); // the tool is NOT executed by the SDK: one step, one request

    const toolResult = { items: [{ id: 'p1', name: 'Robe rouge', price: 2500 }] };
    const second = await gateway.generate(
      request('openai', 'gpt-4o-mini', {
        tools: [SEARCH_TOOL],
        messages: [
          { role: 'user', content: QUESTION },
          { role: 'assistant', content: '', toolCalls: first.toolCalls },
          { role: 'tool', toolCallId: 'call_abc123', name: 'search_products', result: toolResult },
        ],
      }),
    );
    expect(second.text).toBe('Oui, elle est disponible.');
    const messages = net.calls[1]!.json.messages as any[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(messages[2].tool_calls).toEqual([{ id: 'call_abc123', type: 'function', function: { name: 'search_products', arguments: JSON.stringify({ query: 'robe rouge', limit: 5 }) } }]);
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_abc123', content: JSON.stringify(toolResult) });
  });

  it('an image part is sent as a base64 `image_url` data URL', async () => {
    expectHost('api.openai.com').reply({ json: openaiText('{"category":"robe"}') });
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    await gateway.generate(
      request('openai', 'gpt-4o-mini', {
        purpose: 'vision_describe',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the product in this photo' }, { type: 'image', image, mime: 'image/jpeg' }] }],
      }),
    );
    const user = (net.calls[0]!.json.messages as any[])[1];
    expect(user.role).toBe('user');
    expect(user.content).toEqual([
      { type: 'text', text: 'Describe the product in this photo' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
    ]);
  });
});

describe('LiveAiGateway.generate — Anthropic, Google, Groq', () => {
  it('Anthropic messages API: x-api-key, system, tools; text + tool_use mapped', async () => {
    expectHost('api.anthropic.com').reply({
      json: {
        id: 'msg_fixture_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-haiku-20241022',
        content: [
          { type: 'text', text: 'Je vérifie le catalogue.' },
          { type: 'tool_use', id: 'toolu_01A', name: 'search_products', input: { query: 'robe rouge' } },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 77, output_tokens: 21 },
      },
    });
    const res = await gateway.generate(request('anthropic', 'claude-3-5-haiku-20241022', { tools: [SEARCH_TOOL] }));
    expect(res).toEqual({
      text: 'Je vérifie le catalogue.',
      toolCalls: [{ id: 'toolu_01A', name: 'search_products', args: { query: 'robe rouge' } }],
      usage: { inputTokens: 77, outputTokens: 21 },
      finishReason: 'tool-calls',
    });
    const call = net.calls[0]!;
    expect([call.method, call.host, call.path]).toEqual(['POST', 'api.anthropic.com', '/v1/messages']);
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers.authorization).toBeUndefined();
    expect(call.json).toMatchObject({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM }],
      messages: [{ role: 'user', content: [{ type: 'text', text: QUESTION }] }],
      tools: [{ name: 'search_products', description: 'Search the shop catalogue', input_schema: SEARCH_TOOL.parameters }],
    });
  });

  it('Anthropic: assistant tool call + tool result are serialised as tool_use / tool_result blocks', async () => {
    expectHost('api.anthropic.com').reply({ json: { id: 'msg_fixture_2', type: 'message', role: 'assistant', model: 'claude-3-5-haiku-20241022', content: [{ type: 'text', text: 'Disponible.' }], stop_reason: 'end_turn', usage: { input_tokens: 90, output_tokens: 4 } } });
    const res = await gateway.generate(
      request('anthropic', 'claude-3-5-haiku-20241022', {
        tools: [SEARCH_TOOL],
        messages: [
          { role: 'user', content: QUESTION },
          { role: 'assistant', content: 'Je vérifie.', toolCalls: [{ id: 'toolu_01A', name: 'search_products', args: { query: 'robe rouge' } }] },
          { role: 'tool', toolCallId: 'toolu_01A', name: 'search_products', result: { items: [] } },
        ],
      }),
    );
    expect(res).toMatchObject({ text: 'Disponible.', toolCalls: [], finishReason: 'stop' });
    const messages = net.calls[0]!.json.messages as any[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'Je vérifie.' },
      { type: 'tool_use', id: 'toolu_01A', name: 'search_products', input: { query: 'robe rouge' } },
    ]);
    expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_01A', content: JSON.stringify({ items: [] }) });
  });

  it('a step without tools (after handoff_to_human, last step) sends the earlier tool calls as text: no tool_use block without tool definitions (tester report 26/10)', async () => {
    expectHost('api.anthropic.com').reply({ json: { id: 'msg_fixture_3', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: '{"reply":"ok"}' }], stop_reason: 'end_turn', usage: { input_tokens: 90, output_tokens: 4 } } });
    await gateway.generate(
      request('anthropic', 'claude-haiku-4-5', {
        messages: [
          { role: 'user', content: QUESTION },
          { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_01B', name: 'handoff_to_human', args: { reason: 'customer_request' } }] },
          { role: 'tool', toolCallId: 'toolu_01B', name: 'handoff_to_human', result: { ok: true } },
        ],
      }),
    );
    const body = net.calls[0]!.json;
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).not.toMatch(/tool_use|tool_result/);
    expect((body.messages as any[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[1].content).toEqual([{ type: 'text', text: '[tool call handoff_to_human {"reason":"customer_request"}]' }]);
    expect(body.messages[2].content).toEqual([{ type: 'text', text: '[tool result handoff_to_human] {"ok":true}' }]);
  });

  it('Google generative language API: key in x-goog-api-key, generateContent, text answer', async () => {
    expectHost('generativelanguage.googleapis.com').reply({
      json: {
        candidates: [{ content: { role: 'model', parts: [{ text: 'Marhba, la robe est à 2 500 DA.' }] }, finishReason: 'STOP', index: 0 }],
        usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 12, totalTokenCount: 45 },
        modelVersion: 'gemini-2.0-flash',
      },
    });
    const res = await gateway.generate(request('google', 'gemini-2.0-flash'));
    expect(res).toEqual({ text: 'Marhba, la robe est à 2 500 DA.', toolCalls: [], usage: { inputTokens: 33, outputTokens: 12 }, finishReason: 'stop' });
    const call = net.calls[0]!;
    expect([call.method, call.host, call.path]).toEqual(['POST', 'generativelanguage.googleapis.com', '/v1beta/models/gemini-2.0-flash:generateContent']);
    expect(call.headers['x-goog-api-key']).toBe(KEY);
    expect(call.url).not.toContain(KEY); // the key travels in the header, never in the query string
    expect(call.json).toMatchObject({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: QUESTION }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
    });
  });

  it('Groq chat completions (OpenAI-compatible)', async () => {
    expectHost('api.groq.com').reply({ json: { ...openaiText('Salam !'), model: 'llama-3.3-70b-versatile' } });
    const res = await gateway.generate(request('groq', 'llama-3.3-70b-versatile'));
    expect(res).toEqual({ text: 'Salam !', toolCalls: [], usage: { inputTokens: 42, outputTokens: 9 }, finishReason: 'stop' });
    const call = net.calls[0]!;
    expect([call.host, call.path]).toEqual(['api.groq.com', '/openai/v1/chat/completions']);
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.json.model).toBe('llama-3.3-70b-versatile');
  });
});

describe('failure classes (04 §6)', () => {
  it('401 ⇒ provider_rejected, no retry', async () => {
    expectHost('api.openai.com').reply({ status: 401, json: openaiError(`Incorrect API key provided: ${KEY}`, 'invalid_request_error') });
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error).toMatchObject({ kind: 'provider_rejected', provider: 'openai', status: 401, message: 'openai 401' });
    expect(net.calls).toHaveLength(1);
  });

  it('403 ⇒ provider_rejected (Anthropic)', async () => {
    expectHost('api.anthropic.com').reply({ status: 403, json: { type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission' } } });
    const error = await failure(gateway.generate(request('anthropic', 'claude-3-5-haiku-20241022')));
    expect(error).toMatchObject({ kind: 'provider_rejected', provider: 'anthropic', status: 403, message: 'anthropic 403' });
  });

  it('500 on every attempt ⇒ provider_error after the 2 SDK retries', async () => {
    const reply: Reply = { status: 500, json: openaiError('The server had an error while processing your request', 'server_error') };
    expectHost('api.openai.com').reply(reply, reply, reply);
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error).toMatchObject({ kind: 'provider_error', provider: 'openai', status: 500, message: 'openai 500' });
    expect(net.calls).toHaveLength(3);
  });

  it('429 then a success ⇒ the SDK retry is transparent', async () => {
    expectHost('api.openai.com').reply({ status: 429, json: openaiError('Rate limit reached', 'rate_limit_error') }, { json: openaiText('ok') });
    expect((await gateway.generate(request('openai', 'gpt-4o-mini'))).text).toBe('ok');
    expect(net.calls).toHaveLength(2);
  });

  it('400 ⇒ provider_error with the status, no retry', async () => {
    expectHost('api.openai.com').reply({ status: 400, json: openaiError(`Invalid request near "${QUESTION}"`, 'invalid_request_error') });
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error).toMatchObject({ kind: 'provider_error', status: 400, message: 'openai 400' });
    expect(net.calls).toHaveLength(1);
  });

  it('400 "`temperature` is deprecated for this model" ⇒ asked again once without temperature', async () => {
    const refused = { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' } } };
    const ok = { json: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Salam !' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 9, output_tokens: 3 } } };
    expectHost('api.anthropic.com').reply(refused, ok);
    expect((await gateway.generate(request('anthropic', 'claude-haiku-5-5'))).text).toBe('Salam !');
    expect(net.calls).toHaveLength(2);
    expect(net.calls[0]!.json).toMatchObject({ temperature: 0.3 });
    expect(net.calls[1]!.json).not.toHaveProperty('temperature');
    // remembered: the next call to that model goes without temperature at once
    net.calls.length = 0;
    expectHost('api.anthropic.com').reply(ok);
    expect((await gateway.generate(request('anthropic', 'claude-haiku-5-5'))).text).toBe('Salam !');
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]!.json).not.toHaveProperty('temperature');
  });

  it('another 400 keeps the error type and the cited parameters for the logs, not the free text', async () => {
    expectHost('api.anthropic.com').reply({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: `\`messages.0.content\`: bad content ${QUESTION}` } } });
    const error = await failure(gateway.generate(request('anthropic', 'claude-haiku-5-5')));
    expect(error).toMatchObject({ kind: 'provider_error', status: 400, message: 'anthropic 400' });
    expect(error.detail).toBe('invalid_request_error · params: messages.0.content');
    expect(error.detail).not.toContain(QUESTION);
    expect(net.calls).toHaveLength(1);
  });

  it('network failure (TypeError: fetch failed) ⇒ provider_error', async () => {
    expectHost('api.openai.com').reply({ throws: new TypeError('fetch failed') });
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error).toMatchObject({ kind: 'provider_error', provider: 'openai', message: 'openai provider_error' });
    expect(error.status).toBeUndefined();
  });

  it('an unparsable 200 body ⇒ provider_error', async () => {
    expectHost('api.openai.com').reply({ json: { unexpected: true } });
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error.kind).toBe('provider_error');
  });

  it('no answer before `timeoutMs` ⇒ timeout', async () => {
    expectHost('api.openai.com').reply({ hang: true });
    const started = Date.now();
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini', { timeoutMs: 50 })));
    expect(error).toMatchObject({ kind: 'timeout', provider: 'openai', message: 'openai timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(net.calls).toHaveLength(1); // an aborted call is not retried
  });

  it('error messages never carry the key, the prompt or the customer text', async () => {
    const replies: Reply[] = [
      { status: 401, json: openaiError(`Incorrect API key provided: ${KEY}`, 'invalid_request_error') },
      { status: 400, json: openaiError(`Bad prompt: ${SYSTEM} ${QUESTION}`, 'invalid_request_error') },
      { throws: new TypeError(`fetch failed for ${KEY}`) },
    ];
    for (const reply of replies) {
      expectHost('api.openai.com').reply(reply);
      const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
      const visible = `${error.message} ${JSON.stringify(error)} ${String(error)}`;
      for (const secret of [KEY, SYSTEM, QUESTION]) expect(visible).not.toContain(secret);
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it.each([null, '', '   '])('missing key (%p) ⇒ no_key, fetch never called', async (apiKey) => {
    expectHost('api.openai.com');
    const generate = await failure(gateway.generate({ ...request('openai', 'gpt-4o-mini'), model: { provider: 'openai', modelId: 'gpt-4o-mini', apiKey } }));
    expect(generate).toMatchObject({ kind: 'no_key', provider: 'openai' });
    const transcribe = await failure(gateway.transcribe({ model: { provider: 'groq', modelId: 'whisper-large-v3-turbo', apiKey }, audio: Buffer.from('x'), mime: 'audio/ogg', timeoutMs: 1_000 }));
    expect(transcribe).toMatchObject({ kind: 'no_key', provider: 'groq' });
    expect(net.impl).not.toHaveBeenCalled();
  });
});

describe('LiveAiGateway.transcribe (04 §9 voice)', () => {
  const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 7)]);
  const M4A = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(40, 3)]);

  it('Groq whisper-large-v3-turbo: multipart, verbose_json, text + language + duration', async () => {
    expectHost('api.groq.com').reply({
      json: {
        task: 'transcribe',
        language: 'Arabic',
        duration: 4.37,
        text: ' سلام، شحال الروبة الحمراء؟',
        segments: [{ id: 0, seek: 0, start: 0, end: 4.37, text: ' سلام، شحال الروبة الحمراء؟', tokens: [50365, 1, 2], temperature: 0, avg_logprob: -0.21, compression_ratio: 1.1, no_speech_prob: 0.01 }],
        x_groq: { id: 'req_fixture_1' },
      },
    });
    const res = await gateway.transcribe({ model: { provider: 'groq', modelId: 'whisper-large-v3-turbo', apiKey: KEY }, audio: OGG, mime: 'audio/ogg; codecs=opus', timeoutMs: 5_000 });
    expect(res).toEqual({ text: ' سلام، شحال الروبة الحمراء؟', language: 'Arabic', durationSec: 4.37 });

    const call = net.calls[0]!;
    expect([call.method, call.host, call.path]).toEqual(['POST', 'api.groq.com', '/openai/v1/audio/transcriptions']);
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.headers['content-type']).toBeUndefined(); // multipart: the boundary is set by fetch
    expect(call.form).toBeInstanceOf(FormData);
    expect(call.form!.get('model')).toBe('whisper-large-v3-turbo');
    expect(call.form!.get('response_format')).toBe('verbose_json');
    const file = call.form!.get('file') as File;
    expect([file.name, file.type, file.size]).toEqual(['audio.ogg', 'audio/ogg', OGG.length]);
    expect(Buffer.from(await file.arrayBuffer()).equals(OGG)).toBe(true);
  });

  it('OpenAI whisper-1: same contract on api.openai.com; the language name is mapped to its ISO code', async () => {
    expectHost('api.openai.com').reply({ json: { task: 'transcribe', language: 'arabic', duration: 3.2, text: 'Salam, chhal la robe ?', segments: [] } });
    const res = await gateway.transcribe({ model: { provider: 'openai', modelId: 'whisper-1', apiKey: KEY }, audio: M4A, mime: 'audio/mp4', timeoutMs: 5_000 });
    expect(res).toEqual({ text: 'Salam, chhal la robe ?', language: 'ar', durationSec: 3.2 });
    const call = net.calls[0]!;
    expect([call.method, call.host, call.path]).toEqual(['POST', 'api.openai.com', '/v1/audio/transcriptions']);
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.form!.get('model')).toBe('whisper-1');
    expect(call.form!.get('response_format')).toBe('verbose_json');
    const file = call.form!.get('file') as File;
    expect([file.name, file.type]).toEqual(['audio.m4a', 'audio/mp4']);
  });

  it('a plain `{ text }` answer ⇒ language and duration are null', async () => {
    expectHost('api.openai.com').reply({ json: { text: 'Bonjour' } });
    const res = await gateway.transcribe({ model: { provider: 'openai', modelId: 'whisper-1', apiKey: KEY }, audio: OGG, mime: 'audio/ogg', timeoutMs: 5_000 });
    expect(res).toEqual({ text: 'Bonjour', language: null, durationSec: null });
  });

  it('a provider without transcription ⇒ provider_error, no call', async () => {
    expectHost('api.anthropic.com');
    const error = await failure(gateway.transcribe({ model: { provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022', apiKey: KEY }, audio: OGG, mime: 'audio/ogg', timeoutMs: 5_000 }));
    expect(error).toMatchObject({ kind: 'provider_error', provider: 'anthropic' });
    expect(net.impl).not.toHaveBeenCalled();
  });

  it('failures: 401 ⇒ provider_rejected; 503 twice (1 retry) ⇒ provider_error; no answer ⇒ timeout', async () => {
    const req = { model: { provider: 'groq' as const, modelId: 'whisper-large-v3-turbo', apiKey: KEY }, audio: OGG, mime: 'audio/ogg', timeoutMs: 5_000 };
    expectHost('api.groq.com').reply({ status: 401, json: { error: { message: 'Invalid API Key', type: 'invalid_request_error' } } });
    expect(await failure(gateway.transcribe(req))).toMatchObject({ kind: 'provider_rejected', provider: 'groq', status: 401, message: 'groq 401' });

    const down: Reply = { status: 503, json: { error: { message: 'Service unavailable', type: 'service_unavailable' } } };
    expectHost('api.groq.com').reply(down, down);
    expect(await failure(gateway.transcribe(req))).toMatchObject({ kind: 'provider_error', status: 503 });
    expect(net.calls).toHaveLength(2);

    expectHost('api.groq.com').reply({ hang: true });
    expect(await failure(gateway.transcribe({ ...req, timeoutMs: 50 }))).toMatchObject({ kind: 'timeout', provider: 'groq' });
  });
});

describe('the network guard of this spec', () => {
  it('the stub refuses any host other than the expected one', async () => {
    const guard = stubFetch('api.openai.com');
    await expect(guard.impl('https://api.anthropic.com/v1/messages', { method: 'POST' })).rejects.toThrow('unexpected host api.anthropic.com');
    await expect(guard.impl('https://evil.example/v1/chat/completions')).rejects.toThrow('unexpected host evil.example');
    expect(guard.refused).toEqual(['api.anthropic.com', 'evil.example']);
    expect(guard.calls).toHaveLength(0);
  });

  it('an adapter call to an unexpected host never gets an answer (and would fail the test in afterEach)', async () => {
    expectHost('api.anthropic.com').reply({ json: openaiText('must not be served') });
    const error = await failure(gateway.generate(request('openai', 'gpt-4o-mini')));
    expect(error.kind).toBe('provider_error');
    expect(net.calls).toHaveLength(0);
    expect(net.refused).toEqual(['api.openai.com']);
    expect(net.pending()).toBe(1);
    // acknowledged: reset what afterEach would otherwise (rightly) report
    net.refused.length = 0;
    expectHost('no-host-expected.invalid');
  });

  it('the adapter uses the `fetch` that is global at call time, or the injected one', async () => {
    const injected = stubFetch('api.openai.com');
    injected.reply({ json: openaiText('via injected fetch') });
    expectHost('no-host-expected.invalid');
    const res = await new LiveAiGateway({ fetch: injected.impl as unknown as typeof fetch }).generate(request('openai', 'gpt-4o-mini'));
    expect(res.text).toBe('via injected fetch');
    expect(net.impl).not.toHaveBeenCalled();
  });
});

describe('admin key test — model list (tester report 2026-10-21 UX-013)', () => {
  it('Groq: GET api.groq.com/openai/v1/models with the Bearer key ⇒ model ids', async () => {
    const n = expectHost('api.groq.com');
    n.reply({ json: { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3-turbo' }] } });
    expect(await gateway.checkKey('groq', KEY, 10_000)).toEqual({ models: ['llama-3.3-70b-versatile', 'whisper-large-v3-turbo'] });
    expect(n.calls[0]).toMatchObject({ method: 'GET', path: '/openai/v1/models', headers: { authorization: `Bearer ${KEY}` } });
  });
  it('Anthropic and Google: their own headers, the key never in the URL; Google ids without the `models/` prefix', async () => {
    let n = expectHost('api.anthropic.com');
    n.reply({ json: { data: [{ id: 'claude-x' }] } });
    expect((await gateway.checkKey('anthropic', KEY, 10_000)).models).toEqual(['claude-x']);
    expect(n.calls[0]!.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
    n = expectHost('generativelanguage.googleapis.com');
    n.reply({ json: { models: [{ name: 'models/gemini-2.0-flash' }] } });
    expect((await gateway.checkKey('google', KEY, 10_000)).models).toEqual(['gemini-2.0-flash']);
    expect(n.calls[0]!.headers['x-goog-api-key']).toBe(KEY);
    expect(n.calls[0]!.url).not.toContain(KEY);
  });
  it('401 / Google 400 API_KEY_INVALID ⇒ provider_rejected; 404 / 429 / 503 keep their status; a network failure is said so', async () => {
    let n = expectHost('api.groq.com');
    n.reply({ status: 401, json: { error: { message: 'Invalid API Key' } } }, { status: 404 }, { status: 429 }, { status: 503 }, { throws: new TypeError('fetch failed') });
    await expect(gateway.checkKey('groq', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_rejected', status: 401 });
    await expect(gateway.checkKey('groq', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_error', status: 404 });
    await expect(gateway.checkKey('groq', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_error', status: 429 });
    await expect(gateway.checkKey('groq', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_error', status: 503 });
    await expect(gateway.checkKey('groq', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_error', status: undefined, detail: 'network' });
    n = expectHost('generativelanguage.googleapis.com');
    n.reply({ status: 400, json: { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } });
    await expect(gateway.checkKey('google', KEY, 10_000)).rejects.toMatchObject({ kind: 'provider_rejected', status: 400 });
  });
});
