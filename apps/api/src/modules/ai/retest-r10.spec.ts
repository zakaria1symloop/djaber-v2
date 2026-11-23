// Journey retest R10 (17/11, docs/audit/journeys-2026-11-16/journeys/R10-ai-orders.md): playground answers stuck 65–213 s on
// their way to the page (R10-1), a request to confirm without a recap after a stock refusal (R10-2), probe calls in new forms
// (R10-3), odd wording (R10-4). Transcripts: .local/qa/journeys/R10/out/transcripts/ (N1, F1, F6, N5, N11, N4, F1, N12, N18, N21, N9).
import { TenantContext } from '@djaber/db';
import { AiRunService, CONFIRM_WITHOUT_RECAP_NOTE, noLookupFor, searchAnswered, type TurnRequest } from './ai-run.service';
import { fixMoroccan, wrongDarijaIn } from './language';
import { PlaygroundService, REPLAY_TTL_S, serverTiming } from './playground.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabiziWords, withoutNameInPriceSlot, withSpacedAmounts } from './reply-fixes';
import { buildGuardFacts, checkReply, guardInstruction } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { cancelAsked, recapPending, type OrderCallHistory } from './tools/order-confirmation';
import { confirmRequest, notedClaim } from './tools/order-confirmation-text';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry } from './tools/tool-registry';
import { prisma } from '@djaber/db';

afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> & { orderHistory?: OrderCallHistory } = {}): TurnRequest => {
  const { orderHistory, ...rest } = o;
  return {
    runId: 'r',
    prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
    toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), ...(orderHistory ? { orderHistory, ordering: true } : {}) },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    ...rest,
  };
};
const facts = (customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false, ...o });
/** The two catalogue products of the N5 / N21 turns (their prices are known facts). */
const CATALOGUE = [
  { id: 'coffret', sku: 'PRD-COFFRET', name: 'Coffret cadeau Aïd', price: 24990, oldPrice: null, hasVariants: false, variants: [], also: [], stock: 3, sellOutOfStock: false, imageUrl: null },
  { id: 'hijab', sku: 'PRD-HIJAB', name: 'Hijab soie', price: 1500, oldPrice: 2000, hasVariants: false, variants: [], also: [], stock: 5, sellOutOfStock: false, imageUrl: null },
] as unknown as Parameters<typeof buildGuardFacts>[0]['products'];
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);

// --- R10-1 -------------------------------------------------------------------------------------------------------------------------
describe('R10-1 (Major) — a playground answer stuck on its way is asked again with the same turn key: one run, one count', () => {
  /** The Redis commands the playground uses (counter + replay marker). */
  const fakeRedis = () => {
    const kv = new Map<string, string>();
    const client = {
      incr: async (k: string) => {
        const n = Number(kv.get(k) ?? 0) + 1;
        kv.set(k, String(n));
        return n;
      },
      decr: async (k: string) => {
        const n = Number(kv.get(k) ?? 0) - 1;
        kv.set(k, String(n));
        return n;
      },
      expire: async () => 1,
      ttl: async () => 3000,
      get: async (k: string) => kv.get(k) ?? null,
      del: async (k: string) => Number(kv.delete(k)),
      set: async (k: string, v: string, ...args: unknown[]) => {
        if (args.includes('NX') && kv.has(k)) return null;
        kv.set(k, v);
        return 'OK';
      },
    };
    return { kv, client };
  };
  const turn = (sessionId: string) => ({ turnId: 'run-1', sessionId, reply: 'Voici le récapitulatif …', latencyMs: 9367 });
  const service = (isTest: boolean, queue?: unknown) => {
    const redis = fakeRedis();
    const pg = new PlaygroundService({} as never, { isTest, get: () => 'redis://127.0.0.1:63799' } as never, (queue ?? {}) as never, { client: redis.client } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.agent, 'findFirst').mockResolvedValue({ id: 'agent-1' } as never);
    return { pg, redis };
  };
  const ws = <T>(fn: () => Promise<T>) => TenantContext.runAs('ws-1', fn, { userId: 'u1' });
  const input = (turnKey?: string) => ({ sessionId: 'sess-1', messages: [{ role: 'user' as const, text: 'Finalement je préfère le sac à main cuir marron' }], ...(turnKey ? { turnKey } : {}) });

  it('N1 T2: the same key sent again while the turn runs joins it — the AI runs once, the hour counts one turn', async () => {
    const { pg, redis } = service(true);
    let release!: () => void;
    const process = jest
      .spyOn(pg, 'process')
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true, turn: turn('sess-1') as never }))))
      .mockResolvedValue({ ok: true, turn: turn('sess-1') as never });
    const key = '6c1f0e1a-4d4b-4f8e-9b3c-0a1b2c3d4e5f';
    const first = ws(() => pg.requestTurn('agent-1', input(key)));
    await new Promise((r) => setImmediate(r));
    const again = ws(() => pg.requestTurn('agent-1', input(key)));
    await new Promise((r) => setImmediate(r));
    release();
    const [a, b] = await Promise.all([first, again]);
    expect(process).toHaveBeenCalledTimes(1);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(a.turn.reply).toBe(b.turn.reply);
    expect(redis.kv.get('rl:playground:ws-1')).toBe('1');
    expect(a.turn.hourlyUsed).toBe(1);
    expect(b.turn.hourlyUsed).toBe(1);
    // a new turn (another key, or none) is a new run and is counted
    const next = await ws(() => pg.requestTurn('agent-1', input('0b9f7c4e-1111-4a2b-8c3d-9e8f7a6b5c4d')));
    expect(next.replayed).toBe(false);
    expect(process).toHaveBeenCalledTimes(2);
    await ws(() => pg.requestTurn('agent-1', input()));
    expect(redis.kv.get('rl:playground:ws-1')).toBe('3');
  });

  it('a failed turn is given back to the hour once — by the request that counted it, not by its replay', async () => {
    const { pg, redis } = service(true);
    jest.spyOn(pg, 'process').mockResolvedValue({ ok: false, code: 'AI_PROVIDER_ERROR' });
    const key = '7d2e1f0a-2222-4b3c-9d4e-1a2b3c4d5e6f';
    await expect(ws(() => pg.requestTurn('agent-1', input(key)))).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    await expect(ws(() => pg.requestTurn('agent-1', input(key)))).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(redis.kv.get('rl:playground:ws-1')).toBe('0');
  });

  it('with the queue: the job id carries the workspace, the agent, the session and the key — a replay adds the same id', async () => {
    const add = jest.fn(async () => ({ waitUntilFinished: async () => ({ ok: true, turn: turn('sess-1') }) }));
    const { pg } = service(false, { add });
    // the shared QueueEvents is never really opened here
    (pg as unknown as { events: unknown }).events = {};
    const key = '8e3f2a1b-3333-4c4d-8e5f-2b3c4d5e6f7a';
    const a = await ws(() => pg.requestTurn('agent-1', input(key)));
    const b = await ws(() => pg.requestTurn('agent-1', input(key)));
    const ids = add.mock.calls.map((c) => (c as unknown as unknown[])[3]);
    expect(ids[0]).toBe(`pg:ws-1:agent-1:sess-1:${key}`);
    expect(ids[1]).toBe(ids[0]);
    expect((add.mock.calls[0] as unknown as unknown[])[4]).toMatchObject({ attempts: 1, removeOnComplete: { age: REPLAY_TTL_S } });
    expect([a.replayed, b.replayed]).toEqual([false, true]);
    expect(serverTiming(b)).toMatch(/^queue;dur=\d+, total;dur=\d+, replay$/);
    expect(serverTiming(a)).not.toContain('replay');
  });
});

// --- R10-2 -------------------------------------------------------------------------------------------------------------------------
describe('R10-2 (Minor) — N5: no request to confirm without a server recap, no « noté » after a stock refusal', () => {
  const N5_T3 = 'Merci pour vos coordonnées, Karim. Pour confirmer : vous voulez bien le Coffret cadeau Aïd à 24990 DA à la place du Parfum Oud, qui est en rupture ?';
  const N5_T2 = 'Je vous ai bien noté, je reste à votre disposition si le Parfum Oud 50 ml revient en stock. En attendant, le Coffret cadeau Aïd est disponible à 24990 DA si vous voulez autre chose.';
  const RECAP_RESULT = {
    ok: false,
    error: { code: 'CONFIRMATION_REQUIRED', draft: 'faad11aa', core: '1fbb33bb' },
    recap: { items: [{ name: 'Coffret cadeau Aïd', variant: null, quantity: 1, unitPrice: 24990 }], subtotal: 24990, deliveryFee: 0, total: 24990, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Oran', communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', isStopdesk: false },
    recapToShow: true,
  };
  const stockRefusal: OrderCallHistory = [{ name: 'create_order', result: { ok: false, error: { code: 'ORDER_INSUFFICIENT_STOCK', productId: 'oud', available: 0 } }, at: new Date(Date.now() - 60_000) }];

  it('confirmRequest: the requests to confirm, and the sentences that are none', () => {
    for (const s of [N5_T3, 'Tu confirmes la commande ?', 'Pouvez-vous confirmer la commande ?', 'Répondez « oui » pour valider.', 'Ktebli « ih » bach nconfirmi la commande.', 'جاوبني بـ « إيه » باش نأكدو الطلبية.', 'Do you confirm?'])
      expect([s, confirmRequest(s)]).toEqual([s, true]);
    for (const s of ['Voulez-vous le Coffret cadeau Aïd à la place ?', 'Elle vous intéresse ?', 'Vous confirmez l’annulation de la commande TEST-3146 ?', 'Pouvez-vous confirmer votre numéro de téléphone ?', 'Merci Karim !', 'Wach smitek ?', "Pouvez-vous me confirmer de quel produit il s'agit ?", 'Vous confirmez quelle taille ?'])
      expect([s, confirmRequest(s)]).toEqual([s, false]);
  });

  it('recapPending: a fresh recap with no order after it; a stock refusal is none', () => {
    const now = Date.now();
    const recap: OrderCallHistory = [{ name: 'create_order', result: RECAP_RESULT, at: new Date(now - 30_000) }];
    expect(recapPending(recap, now)).toBe(true);
    expect(recapPending([...recap, { name: 'create_order', result: { ok: true, number: 'TEST-3157' }, at: new Date(now - 10_000) }], now)).toBe(false);
    expect(recapPending(stockRefusal, now)).toBe(false);
    expect(recapPending(undefined, now)).toBe(false);
  });

  it('the guard: N5 T3 flagged when no recap waits; N20 T4 (a recap waits) and an offer question are not', () => {
    const f = { ...facts('oui'), noRecapPending: true };
    expect(checkReply(N5_T3, f).filter((v) => v.rule === 'confirm_without_recap')).toHaveLength(1);
    expect(checkReply('Tawsil ta3 la commande ywasel f 2 l 5 ayam. Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou.', { ...facts('ch7al ywasel ?'), lang: 'arabizi' }).filter((v) => v.rule === 'confirm_without_recap')).toHaveLength(0);
    expect(checkReply('Désolé, le Parfum Oud 50 ml est en rupture de stock. Voulez-vous le Coffret cadeau Aïd à la place ?', f).filter((v) => v.rule === 'confirm_without_recap')).toHaveLength(0);
    expect(guardInstruction([{ rule: 'confirm_without_recap', sentence: 1 }], f)).toContain('NO RECAP HAS BEEN SHOWN for this order');
  });

  it('the guard: N5 T2 « Je vous ai bien noté » after the stock refusal is flagged; « c’est noté » after a missing field is not', () => {
    expect(notedClaim('Je vous ai bien noté, je reste à votre disposition.')).toBe(true);
    const refused = { ...facts('Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'), orderRefused: true, productRefused: true };
    const v = checkReply(N5_T2, refused).filter((x) => x.rule === 'confirm_without_recap');
    expect(v.map((x) => x.sentence)).toEqual([0]);
    expect(guardInstruction(v, refused)).toContain('NOTHING IS ORDERED OR NOTED');
    const field = { ...facts('Karim Haddad'), orderRefused: true, missingField: 'clientPhone' };
    expect(checkReply('Merci Karim, c’est noté. Quel est votre numéro de téléphone ?', field).filter((x) => x.rule === 'confirm_without_recap')).toHaveLength(0);
  });

  it('N5 T3 turn: « Pour confirmer … ? » with no recap waiting ⇒ sent back with the tools ⇒ create_order ⇒ the server recap', async () => {
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      { toolCalls: [{ name: 'get_product', args: { productId: 'coffret' } }] },
      { reply: N5_T3, intent: 'SALE' },
      { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', items: [{ productId: 'coffret', quantity: 1 }], customerConfirmed: true } }] },
      { reply: 'Parfait !', intent: 'SALE' },
    );
    const execute = jest.fn(async (name: string) => (name === 'get_product' ? { id: 'coffret', name: 'Coffret cadeau Aïd', price: 24990, stock: 'in_stock', variants: [] } : RECAP_RESULT));
    const tools = { defsFor: async () => [TOOL_DEFS.get_product, TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const history = ['Bonjour, le parfum oud c’est combien ?', 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'];
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('oui', history, { orderHistory: stockRefusal, guard: facts('oui') }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain('NO RECAP YET');
    expect(offered(gateway, 2)).toContain('create_order');
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['get_product', 'create_order']);
    expect(r.output.reply).toContain('Voici le récapitulatif de votre commande');
    expect(r.output.reply).not.toContain('Pour confirmer');
    expect(CONFIRM_WITHOUT_RECAP_NOTE).toContain('call create_order now');
  });

  it('N5 T2 turn: « Je vous ai bien noté … » after ORDER_INSUFFICIENT_STOCK ⇒ one corrective turn told to say it cannot be ordered and ask', async () => {
    const gateway = new FakeAiGateway();
    const fixed = 'Désolé, le Parfum Oud 50 ml ne peut pas être commandé pour le moment : il est en rupture de stock. Voulez-vous le Coffret cadeau Aïd à 24990 DA à la place ?';
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', items: [{ productId: 'oud', quantity: 1 }], customerConfirmed: true } }] }, { reply: N5_T2, intent: 'SALE' }, { reply: fixed, intent: 'SALE' });
    const execute = jest.fn(async () => stockRefusal[0]!.result);
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const text = 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, ['Bonjour, le parfum oud c’est combien ?'], { guard: facts(text, { products: CATALOGUE }) }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain('NOTHING IS ORDERED OR NOTED');
    expect(r.output.reply).toBe(withSpacedAmounts(fixed)); // (journey retest R20-4: every amount as formatMoney writes it)
  });

  it('N20 T4 turn: a question after a recap still waiting ⇒ the « ktebli ih » pointing at it goes out, no second model round', async () => {
    const gateway = new FakeAiGateway();
    const reply = 'Tawsil ta3 la commande ywasel f 2 l 5 ayam. Ktebli « ih » bach nconfirmi la commande, wela goulli wach nbeddlou.';
    gateway.script('reply', { reply, intent: 'INFO' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const orderHistory: OrderCallHistory = [{ name: 'create_order', result: RECAP_RESULT, at: new Date(Date.now() - 20_000) }];
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('ch7al ywasel ?', ['… 0770112233, Setif El Eulma cite 500 logements bloc 12'], { orderHistory, guard: { ...facts('ch7al ywasel ?'), lang: 'arabizi' } }));
    if (!r.ok) throw new Error('turn failed');
    expect(gateway.calls).toHaveLength(1);
    expect(r.output.reply).toBe(reply);
  });
});

// --- R10-3 -------------------------------------------------------------------------------------------------------------------------
describe('R10-3 (Minor) — probes: cancel_order only on a cancellation, no lookup / FAQ note on a name, one search per product', () => {
  const N11_T3 = 'صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟';

  it('cancelAsked: a tracking question is none; cancel words (this message or the two before) or an order number are', () => {
    expect(cancelAsked(N11_T3, ['السلام، نحب جلابة رجالي …', 'ايه', N11_T3].join('\n'))).toBe(false);
    expect(cancelAsked('non annule', 'oui\nnon annule')).toBe(true);
    expect(cancelAsked('oui', 'je veux annuler ma commande\noui')).toBe(true);
    expect(cancelAsked('Où en est TEST-4074 ?')).toBe(true);
    expect(cancelAsked('Bon finalement je le prends. Karim Haddad 0770112233')).toBe(false);
  });

  it('N11 T3 turn: cancel_order is not offered; a call anyway is not run', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'lookup_order', args: {} }, { name: 'cancel_order', args: {} }] }, { reply: 'الطلبية تاعك رقمها TEST-4074 وما خرجتش للتوصيل بعد.', intent: 'TRACKING' });
    const execute = jest.fn(async () => ({ orders: [{ number: 'TEST-4074', status: 'new', deliveryStatus: 'not_sent', trackingNumber: null }] }));
    const tools = { defsFor: async () => [TOOL_DEFS.lookup_order, TOOL_DEFS.cancel_order, TOOL_DEFS.add_faq_candidate], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(N11_T3, ['السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5', 'ايه']));
    expect(offered(gateway)).toEqual(['lookup_order', 'add_faq_candidate']);
    expect(execute.mock.calls.map((c) => (c as unknown as unknown[])[0])).toEqual(['lookup_order']);
    expect(JSON.stringify(gateway.calls[1]!.messages)).toContain('TOOL_NOT_AVAILABLE');
  });

  it('cancel_order {} while the customer asked no cancellation ⇒ a precise refusal (the registry, playground or live)', async () => {
    const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
    const ctx = { workspaceId: 'w', agent: {} as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: N11_T3, customerHistory: `ايه\n${N11_T3}`, orderHistory: [] };
    expect(await reg.execute('cancel_order', {}, ctx)).toMatchObject({ ok: false, error: { code: 'CANCEL_NOT_ASKED' } });
  });

  it('N4 T2 « سمير بن علي »: no lookup_order, no add_faq_candidate offered; a phone or a yes keeps lookup_order', async () => {
    expect(noLookupFor('سمير بن علي', true)).toBe(true);
    expect(noLookupFor('0661234567', true)).toBe(false);
    expect(noLookupFor('oui', true)).toBe(false);
    expect(noLookupFor('et ma commande ?', false)).toBe(false);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Merci Samir, c’est noté. Quel est votre numéro de téléphone (ex: 0555123456) ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.lookup_order, TOOL_DEFS.add_faq_candidate], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn({ ...turnReq('سمير بن علي', ['Bonjour, je veux le tapis de prière']), toolCtx: { ...turnReq('سمير بن علي', ['Bonjour, je veux le tapis de prière']).toolCtx, ordering: true } });
    expect(offered(gateway)).toEqual(['search_products']);
  });

  it('add_faq_candidate: an internal note or a question nobody asked is refused; a real question is recorded', async () => {
    const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
    const ctx = (customerText: string) => ({ workspaceId: 'w', agent: { id: 'a' } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText });
    expect(await reg.execute('add_faq_candidate', { question: 'Le client a commandé le tapis de prière (quantité 1) ; prochaine étape : numéro de téléphone.', topic: 'commande' }, ctx('سمير بن علي'))).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'question' } });
    expect(await reg.execute('add_faq_candidate', { question: 'Quand le Parfum Oud 50 ml sera-t-il de nouveau disponible ?', topic: 'stock' }, ctx('Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'))).toMatchObject({ ok: false });
    expect(await reg.execute('add_faq_candidate', { question: 'Livrez-vous à Tamanrasset ?', topic: 'livraison' }, ctx('vous livrez à Tamanrasset ?'))).toEqual({ ok: true, simulated: true });
  });

  it('searchAnswered: F1 T1 « Sac à main cuir » after « Sac à main cuir marron »; N12 T1 « hijab soie » after get_product', () => {
    const sac = { id: 'sac', name: 'Sac à main cuir', variants: [{ id: 'noir', name: 'Noir' }, { id: 'marron', name: 'Marron' }] };
    const first = [{ name: 'search_products', result: { products: [sac] } }];
    expect(searchAnswered('Sac à main cuir', first)).toMatchObject({ products: [sac], repeated: true });
    expect(searchAnswered('sac a main cuir marron', first)).toMatchObject({ repeated: true });
    expect(searchAnswered('Djellaba homme', first)).toBeNull();
    expect(searchAnswered('Hijab soie', [{ name: 'get_product', result: { id: 'h', name: 'Hijab soie', variants: [] } }])).toMatchObject({ products: [{ id: 'h' }], repeated: true });
    expect(searchAnswered('', first)).toBeNull();
  });

  it('F1 T1 turn: the second, folded search of the same product is not run', async () => {
    resetPlaceIndex();
    jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue([{ id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف' }] as never);
    jest.spyOn(prisma.commune, 'findMany').mockResolvedValue([] as never);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Sac à main cuir marron' } }] }, { toolCalls: [{ name: 'search_products', args: { query: 'Sac à main cuir' } }] }, { reply: 'Très bon choix, le sac à main cuir en marron est disponible à 6900 DA. Quel est votre nom ?', intent: 'SALE' });
    const execute = jest.fn(async () => ({ products: [{ id: 'sac', name: 'Sac à main cuir', price: 6900, variants: [{ id: 'marron', name: 'Marron', price: 6900 }] }] }));
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Je voudrais le sac à main cuir marron', []));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain('"repeated":true');
  });
});

// --- R10-4 -------------------------------------------------------------------------------------------------------------------------
describe('R10-4 (Cosmetic) — catalogue words in their own script, no name in the price slot, Algerian words in arabizi', () => {
  it('N18 T1 « في لاين فين، من الصوف الرقيق » ⇒ flagged and fixed; « الصوف الرقيق » stays', () => {
    const t = 'عندنا جلابة رجالي في لاين فين، من الصوف الرقيق بلون بيج.';
    expect(wrongDarijaIn(t)).toBe(true);
    expect(fixMoroccan(t)).toBe('عندنا جلابة رجالي من الصوف الرقيق بلون بيج.');
    expect(fixMoroccan('جلابة لاين فين بلون بيج')).toBe('جلابة الصوف الرقيق بلون بيج');
    expect(wrongDarijaIn('جلابة من الصوف الرقيق بلون بيج')).toBe(false);
  });

  it('N21 T1 « بسعر Hijab soie — 1500 دج » ⇒ « بسعر 1500 دج »; a real price sentence is unchanged', () => {
    expect(withoutNameInPriceSlot('عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر Hijab soie — 1500 دج (بدل 2000 دج).')).toBe('عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر 1500 دج (بدل 2000 دج).');
    expect(withoutNameInPriceSlot('Hijab soie بسعر 1500 دج.')).toBe('Hijab soie بسعر 1500 دج.');
  });

  it('the turn applies them to an answer that is no recap (arabizi N9, Arabic N21)', async () => {
    const run = async (reply: string, lang: 'arabizi' | 'ar') => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply, intent: 'INFO' });
      const tools = { defsFor: async () => [], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('ok', [], { guard: { ...facts('ok', { products: CATALOGUE }), lang } }));
      return r.ok ? r.output.reply : null;
    };
    expect(await run('Hiya robe kabyle brodée bil yed, mais b tissu khfif. Wach men taille t7ebb ?', 'arabizi')).toBe('Hiya robe kabyle brodée bil yed, bessah b tissu khfif. Wach men taille t7ebb ?');
    expect(await run('عندنا حجاب حرير ناعم، بسعر Hijab soie — 1500 دج. تحب نسجلولك واحد منه؟', 'ar')).toBe('عندنا حجاب حرير ناعم، بسعر 1\u00a0500\u00a0دج. تحب نسجلولك واحد منه؟');
  });

  it('N9 T1 arabizi: « mais » ⇒ « bessah », « Les tailles disponibles » ⇒ « Les tailles li kaynin »; French replies untouched', () => {
    const n9 = 'Ma 3andnach tsawer ta3 had la robe f had lwaqt, mais hiya robe kabyle brodée bil yed. Les tailles disponibles: S, M w XL.';
    expect(withArabiziWords(n9, 'arabizi')).toBe('Ma 3andnach tsawer ta3 had la robe f had lwaqt, bessah hiya robe kabyle brodée bil yed. Lmqasat li kaynin: S, M w XL.'); // R13-6: « tailles li kaynin » ⇒ « Lmqasat li kaynin »
    expect(withArabiziWords('Elle est belle, mais les tailles disponibles sont S et M.', 'fr')).toBe('Elle est belle, mais les tailles disponibles sont S et M.');
    expect(withArabiziWords('jamais', 'arabizi')).toBe('jamais');
  });
});
