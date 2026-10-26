// Pure rules of the AI pipeline (04-ai-pipeline): language detection, structured output, tool-call ids, credit periods,
// the adapter factory guard and the scriptable fake adapter.
import { parseFaqText } from '../agents/knowledge.service';
import { creditPeriod } from '../credits/credit.service';
import { canonicalJson, costUsd, toolCallId } from './ai-run.service';
import { plannedCost } from './ai.constants';
import { detectLanguage, systemLocale } from './language';
import { createAiGateway } from './provider/ai-gateway.factory';
import { AiProviderError, readInput, withInput, type AiGenerateRequest } from './provider/ai.gateway';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { LiveAiGateway } from './provider/live-ai.gateway';
import { extractJson, parseReplyOutput, salvageReply } from './structured-output';
import { RUN_TOOLS, TOOL_DEFS, canonicalTool } from './tools/tool-registry';
import { fold, WILAYA_ALIASES } from './tools/wilaya-aliases';

describe('detectLanguage (§3.6)', () => {
  it.each([
    ['بشحال هذا المنتوج؟', 'ar'],
    ['واش عندكم روب ساتان', 'ar'],
    ['salam, chhal robe satin ?', 'arabizi'],
    ['3andkom tawsil l wahran ?', 'arabizi'],
    ['wach kayen had lproduit', 'arabizi'],
    ['n7eb nechri hada', 'arabizi'],
    ['chhal la robe ?', 'arabizi'],
    ['Bonjour, quel est le prix de la robe ?', 'fr'],
    ["c'est combien la livraison", 'fr'],
    ['je veux commander', 'fr'],
    ['Hello, how much is the dress?', 'en'],
    ['do you have this in size M', 'en'],
    ['bonjour نحب نشري robe satin من فضلك', 'mixed'],
  ])('%s ⇒ %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it('an empty or symbol-only text keeps the previous language; the system locale follows the script', () => {
    expect(detectLanguage('', 'ar')).toBe('ar');
    expect(detectLanguage('??', 'arabizi')).toBe('arabizi');
    expect(detectLanguage('👍')).toBeUndefined();
    expect(detectLanguage(null, 'fr')).toBe('fr');
    expect([systemLocale('ar'), systemLocale('arabizi'), systemLocale('mixed'), systemLocale('fr'), systemLocale('en'), systemLocale(undefined, 'ar')]).toEqual(['ar', 'fr', 'fr', 'fr', 'en', 'ar']);
  });
});

describe('structured output (§4.1)', () => {
  const valid = { reply: 'La robe est à 4500 DA.', status: 'OK', intent: 'SALE', productCards: ['p1'], recommendations: [], confidence: 0.9 };
  it('accepts the contract, also inside a code fence or a sentence, and null optional fields', () => {
    expect(parseReplyOutput(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
    expect(parseReplyOutput('```json\n' + JSON.stringify({ ...valid, statusDetail: null, language: 'fr' }) + '\n```')).toEqual({ ok: true, value: { ...valid, language: 'fr' } });
    expect(parseReplyOutput(`Here you go: ${JSON.stringify({ ...valid, reply: 'accolade } dans "le" texte {' })} thanks`).ok).toBe(true);
    expect(extractJson('no object here')).toBeNull();
    expect(extractJson('{"a":{"b":"}"}} trailing')).toBe('{"a":{"b":"}"}}');
  });
  it.each([
    ['plain text', 'Sure! It costs 4500.', 'no_json'],
    ['broken JSON', '{"reply": "x", ', 'no_json'],
    ['invalid JSON', '{reply: x}', 'invalid_json'],
    ['no reply', JSON.stringify({ ...valid, reply: undefined, answer: 'x' }), 'schema:reply'],
    ['reply not a text', JSON.stringify({ ...valid, reply: ['x'] }), 'schema:reply'],
  ])('malformed: %s', (_name, text, reason) => {
    expect(parseReplyOutput(text)).toEqual({ ok: false, reason });
  });

  it('tester report 26/10: an object right in substance is read as it is (missing / extra keys, case, numbers as text, too many cards, too long)', () => {
    const neutral = { status: 'OK', intent: 'OTHER', productCards: [], recommendations: [], confidence: 0.5 };
    expect(parseReplyOutput(JSON.stringify({ reply: 'x' }))).toEqual({ ok: true, value: { reply: 'x', ...neutral } });
    expect(parseReplyOutput(JSON.stringify({ ...valid, status: 'DONE', intent: 'BUY' }))).toEqual({ ok: true, value: { ...valid, status: 'OK', intent: 'OTHER' } });
    expect(parseReplyOutput(JSON.stringify({ ...valid, status: 'handoff', statusDetail: ' customer_request ', intent: 'complaint' }))).toEqual({ ok: true, value: { ...valid, status: 'HANDOFF', statusDetail: 'customer_request', intent: 'COMPLAINT' } });
    expect(parseReplyOutput(JSON.stringify({ ...valid, price: 4500 }))).toEqual({ ok: true, value: valid });
    expect((parseReplyOutput(JSON.stringify({ ...valid, productCards: ['1', '2', '3', '4', '5', '6'] })) as { value: { productCards: string[] } }).value.productCards).toEqual(['1', '2', '3', '4', '5']);
    expect((parseReplyOutput(JSON.stringify({ ...valid, confidence: '0.8' })) as { value: { confidence: number } }).value.confidence).toBe(0.8);
    expect((parseReplyOutput(JSON.stringify({ ...valid, confidence: 85 })) as { value: { confidence: number } }).value.confidence).toBe(0.85);
    expect((parseReplyOutput(JSON.stringify({ ...valid, confidence: 1.4 })) as { value: { confidence: number } }).value.confidence).toBe(1);
    expect((parseReplyOutput(JSON.stringify({ ...valid, reply: 'x'.repeat(2001) })) as { value: { reply: string } }).value.reply).toHaveLength(2000);
    expect((parseReplyOutput(JSON.stringify({ ...valid, language: 'FR', customer: { name: ' Amel ', phone: 550123456, city: 'Oran' } })) as { value: unknown }).value).toMatchObject({ language: 'fr', customer: { name: 'Amel', phone: '550123456' } });
  });

  it('salvageReply: a prose answer or a cut object whose reply is complete; never an empty text or half a reply', () => {
    expect(salvageReply('La robe est à 4500 DA.')).toEqual({ reply: 'La robe est à 4500 DA.', status: 'OK', intent: 'OTHER', productCards: [], recommendations: [], confidence: 0.5 });
    expect(salvageReply('{"reply": "Elle est à \\"4500\\" DA.", "status": "OK", "intent"')?.reply).toBe('Elle est à "4500" DA.');
    expect(salvageReply('{"reply": "Elle est à 45')).toBeNull();
    expect(salvageReply('{"answer": "x"}')).toBeNull();
    expect(salvageReply('   ')).toBeNull();
  });
});

describe('tools (§4.2) and runs (§5)', () => {
  it('tool names are final; aliases resolve; every offered tool has a JSON Schema', () => {
    expect(RUN_TOOLS).toEqual(['search_products', 'get_product', 'quote_delivery', 'lookup_order', 'add_faq_candidate', 'handoff_to_human', 'create_order', 'cancel_order']);
    expect([canonicalTool('get_shipping_fee'), canonicalTool('get_order_status'), canonicalTool('search_products')]).toEqual(['quote_delivery', 'lookup_order', 'search_products']);
    for (const name of RUN_TOOLS) expect(TOOL_DEFS[name]).toMatchObject({ name, parameters: { type: 'object' } });
    expect((TOOL_DEFS.create_order.parameters as any).required).toEqual(['clientName', 'clientPhone', 'wilayaId', 'items', 'customerConfirmed']);
    expect((TOOL_DEFS.create_order.parameters as any).properties.customerConfirmed).toEqual({ const: true });
    expect((TOOL_DEFS.handoff_to_human.parameters as any).properties.reason.enum).toContain('order_limits');
  });

  it('the persisted tool-call id depends on the call, not on the provider id: same name + args ⇒ same id, whatever the key order', () => {
    const a = toolCallId('create_order', { items: [{ productId: 'p', quantity: 1 }], clientName: 'A' }, 0);
    expect(toolCallId('create_order', { clientName: 'A', items: [{ quantity: 1, productId: 'p' }] }, 0)).toBe(a);
    expect(toolCallId('create_order', { clientName: 'B', items: [{ productId: 'p', quantity: 1 }] }, 0)).not.toBe(a);
    expect(toolCallId('create_order', { items: [{ productId: 'p', quantity: 1 }], clientName: 'A' }, 1)).not.toBe(a); // the same call asked twice in a run
    expect(toolCallId('get_shipping_fee', { wilayaId: 16 }, 0)).toBe(toolCallId('quote_delivery', { wilayaId: 16 }, 0));
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }] })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
  });

  it('cost = tokens × price per million; per-turn credits = the highest of text 1 / voice 3 / image 5', () => {
    expect(costUsd({ inputPricePerM: 0.15, outputPricePerM: 0.6 }, { inputTokens: 2000, outputTokens: 500 })).toBe(0.0006);
    expect([plannedCost({ hasAudio: false, hasImage: false }), plannedCost({ hasAudio: true, hasImage: false }), plannedCost({ hasAudio: false, hasImage: true }), plannedCost({ hasAudio: true, hasImage: true })]).toEqual([1, 3, 5, 5]);
  });

  it('wilaya names are folded (accents, articles, Arabic variants) and common spellings are known', () => {
    expect([fold('Sétif'), fold('El Oued'), fold('wilaya Béjaïa'), fold('الجزائر'), fold('  ORAN ')]).toEqual(['setif', 'oued', 'bejaia', 'جزاير', 'oran']);
    expect([WILAYA_ALIASES.wahran, WILAYA_ALIASES.dzair, WILAYA_ALIASES.stif, WILAYA_ALIASES[fold('قسنطينة')]]).toEqual([31, 16, 19, 25]);
  });
});

describe('credit period (02 §6)', () => {
  it('is the month containing now, anchored on the subscription day (clamped at month ends)', () => {
    const p = (anchor: string, now: string) => {
      const r = creditPeriod(new Date(anchor), new Date(now));
      return [r.start.toISOString(), r.end.toISOString()];
    };
    expect(p('2026-01-15T10:00:00.000Z', '2026-01-20T00:00:00Z')).toEqual(['2026-01-15T10:00:00.000Z', '2026-02-15T10:00:00.000Z']);
    expect(p('2026-01-15T10:00:00.000Z', '2026-03-15T09:59:59Z')).toEqual(['2026-02-15T10:00:00.000Z', '2026-03-15T10:00:00.000Z']);
    expect(p('2026-01-15T10:00:00.000Z', '2026-03-15T10:00:00Z')).toEqual(['2026-03-15T10:00:00.000Z', '2026-04-15T10:00:00.000Z']);
    expect(p('2026-01-31T00:00:00.000Z', '2026-02-28T12:00:00Z')).toEqual(['2026-02-28T00:00:00.000Z', '2026-03-31T00:00:00.000Z']);
    expect(p('2025-10-11T08:00:00.000Z', '2026-10-11T07:00:00Z')).toEqual(['2025-09-11T08:00:00.000Z', '2025-10-11T08:00:00.000Z'].map((_, i) => ['2026-09-11T08:00:00.000Z', '2026-10-11T08:00:00.000Z'][i]));
    expect(p('2026-06-01T00:00:00.000Z', '2026-05-01T00:00:00Z')).toEqual(['2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z']); // an anchor in the future
  });
});

describe('AI adapter factory (safety)', () => {
  it('fake by default; `live` is refused in development / test unless AI_ALLOW_LIVE=true', () => {
    expect(createAiGateway({ NODE_ENV: 'test', AI_DRIVER: 'fake', AI_ALLOW_LIVE: false })).toBeInstanceOf(FakeAiGateway);
    expect(createAiGateway({ NODE_ENV: 'production', AI_DRIVER: 'fake', AI_ALLOW_LIVE: false })).toBeInstanceOf(FakeAiGateway);
    expect(() => createAiGateway({ NODE_ENV: 'development', AI_DRIVER: 'live', AI_ALLOW_LIVE: false })).toThrow(/refused in development/);
    expect(() => createAiGateway({ NODE_ENV: 'test', AI_DRIVER: 'live', AI_ALLOW_LIVE: false })).toThrow(/AI_ALLOW_LIVE/);
    expect(createAiGateway({ NODE_ENV: 'development', AI_DRIVER: 'live', AI_ALLOW_LIVE: true })).toBeInstanceOf(LiveAiGateway);
    expect(createAiGateway({ NODE_ENV: 'production', AI_DRIVER: 'live', AI_ALLOW_LIVE: false })).toBeInstanceOf(LiveAiGateway);
    expect(createAiGateway({ NODE_ENV: 'staging', AI_DRIVER: 'live', AI_ALLOW_LIVE: false }).driver).toBe('live');
  });
});

describe('FakeAiGateway', () => {
  const model = { provider: 'openai' as const, modelId: 'gpt-4o-mini', apiKey: null };
  const req = (over: Partial<AiGenerateRequest> = {}): AiGenerateRequest => ({ model, purpose: 'reply', system: '', messages: [{ role: 'user', content: 'Bonjour' }], timeoutMs: 1000, ...over });

  it('is deterministic: the same request gives the same answer', async () => {
    const fake = new FakeAiGateway();
    const a = await fake.generate(req());
    const b = await fake.generate(req());
    expect(a).toEqual(b);
    expect(JSON.parse(a.text)).toMatchObject({ status: 'OK', intent: 'GREETING', language: 'fr' });
    expect(a.usage.inputTokens).toBeGreaterThan(0);
  });

  it('scripts: reply, structured object, raw text, tool calls, error classes, timeouts, a failing model, transcripts', async () => {
    const fake = new FakeAiGateway();
    fake.script('reply', { reply: 'ok', intent: 'INFO' }, { object: { a: 1 } }, { text: 'raw' }, { toolCalls: [{ name: 'search_products', args: { query: 'robe' } }] }, { error: 'provider_rejected' }, { delayMs: 5000, then: { reply: 'late' } }, (r) => ({ reply: `echo ${r.messages.length}` }));
    expect(JSON.parse((await fake.generate(req())).text)).toMatchObject({ reply: 'ok', status: 'OK', intent: 'INFO', productCards: [], confidence: 0.9 });
    expect((await fake.generate(req())).text).toBe('{"a":1}');
    expect((await fake.generate(req())).text).toBe('raw');
    expect(await fake.generate(req())).toMatchObject({ text: '', finishReason: 'tool-calls', toolCalls: [{ name: 'search_products', args: { query: 'robe' }, id: expect.any(String) }] });
    await expect(fake.generate(req())).rejects.toMatchObject({ kind: 'provider_rejected', status: 401 });
    await expect(fake.generate(req())).rejects.toMatchObject({ kind: 'timeout' });
    expect(JSON.parse((await fake.generate(req())).text).reply).toBe('echo 1');
    expect(fake.callsOf('reply')).toHaveLength(7);
    fake.failModel('gpt-4o-mini', 'provider_error', 1);
    await expect(fake.generate(req())).rejects.toBeInstanceOf(AiProviderError);
    await expect(fake.generate(req())).resolves.toBeDefined();
    fake.transcript('bonjour', { error: 'provider_error' });
    expect(await fake.transcribe({ model, audio: Buffer.from('x'), mime: 'audio/mpeg', timeoutMs: 1000 })).toMatchObject({ text: 'bonjour', language: 'fr' });
    await expect(fake.transcribe({ model, audio: Buffer.from('x'), mime: 'audio/mpeg', timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'provider_error' });
    fake.reset();
    expect(fake.calls).toHaveLength(0);
  });

  it('default brain: keywords decide the tool call; tool results become the structured answer', async () => {
    const fake = new FakeAiGateway();
    const tools = RUN_TOOLS.map((n) => TOOL_DEFS[n]);
    const ask = async (text: string) => fake.generate(req({ tools, messages: [{ role: 'user', content: text }] }));
    expect((await ask('combien la robe satin ?')).toolCalls[0]).toMatchObject({ name: 'search_products', args: { query: 'robe satin', limit: 5 } });
    expect((await ask('chhal tawsil l wahran ?')).toolCalls[0]).toMatchObject({ name: 'quote_delivery', args: { wilayaName: 'wahran' } });
    expect((await ask('win rahi la commande ?')).toolCalls[0]).toMatchObject({ name: 'lookup_order' });
    expect((await ask('je veux annuler ma commande')).toolCalls[0]).toMatchObject({ name: 'cancel_order', args: { customerConfirmed: false } });
    expect(JSON.parse((await ask('je veux parler à un humain')).text)).toMatchObject({ status: 'HANDOFF', statusDetail: 'customer_request' });
    expect(JSON.parse((await ask('??')).text)).toMatchObject({ status: 'UNCLEAR' });
    const afterSearch = await fake.generate(req({ tools, messages: [{ role: 'user', content: 'بشحال الروب؟' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_products', args: {} }] }, { role: 'tool', toolCallId: 'c1', name: 'search_products', result: { products: [{ id: 'p1', name: 'Robe', price: 4500, stock: 2 }] } }] }));
    expect(JSON.parse(afterSearch.text)).toMatchObject({ status: 'OK', intent: 'SALE', productCards: ['p1'], language: 'ar' });
    expect(JSON.parse(afterSearch.text).reply).toMatch(/[؀-ۿ]/);
  });

  it('non-reply calls carry their input after INPUT_JSON and the fake answers from it', async () => {
    const fake = new FakeAiGateway();
    const r = req({ purpose: 'page_post', messages: [{ role: 'user', content: withInput('Analyse this post.', { caption: 'Robe satin bordeaux - 4 500 DA' }) }] });
    expect(readInput(r)).toEqual({ caption: 'Robe satin bordeaux - 4 500 DA' });
    expect(JSON.parse((await fake.generate(r)).text)).toMatchObject({ isProduct: true, name: 'Robe satin bordeaux', price: 4500 });
    const caption = await fake.generate(req({ purpose: 'caption', messages: [{ role: 'user', content: withInput('Caption', { productName: 'Sac cuir' }) }] }));
    expect(caption.text).toBe('Photo du produit Sac cuir');
  });
});

describe('FAQ text import', () => {
  it('reads "Q: / A:" pairs and question lines followed by their answer', () => {
    expect(parseFaqText('Q: Horaires ?\nR: 9h–18h\n\nس: التوصيل؟\nج: نعم لكل الولايات\n\nPeut-on payer par CCP ?\nOui, avant expédition.\nMerci.\n\nligne orpheline')).toEqual([
      { question: 'Horaires ?', answer: '9h–18h' },
      { question: 'التوصيل؟', answer: 'نعم لكل الولايات' },
      { question: 'Peut-on payer par CCP ?', answer: 'Oui, avant expédition.\nMerci.\nligne orpheline' },
    ]);
    expect(parseFaqText('rien à lire')).toEqual([]);
  });
});
