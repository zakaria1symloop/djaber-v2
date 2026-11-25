// Journey retest R19 (18/11, docs/audit/journeys-2026-11-16/journeys/R19-ai-orders.md): extra model calls — a tool not offered answered
// « unavailable » then a new model call (27 calls in 26 turns), a plain « oui » to the recap costing 2–3 calls, N5 T2 17.1 s, N11 two lookups
// (R19-1); `handoff_to_human {off_catalogue}` called on a message naming no product (R19-2, N3 T2 / F1b T4); wording (R19-3: « c'est noté : »,
// the substitute question, the fee line between two questions, the price after the fees, « 20000 DA », « Merci Samir »).
// Transcripts: .local/qa/journeys/R19/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, orderLookupAnswered, takesUnavailableNote, type TurnRequest } from './ai-run.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { parseReplyOutput, repairJson } from './structured-output';
import { amountText, withCustomerScriptName, withModeFees, withoutNotedSteps, withoutOrderStepAsk, withPlaceFacts } from './reply-fixes';
import { buildGuardFacts, quoteFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { deliveryAnswer, orderConfirmationText, pendingRecap, recapReply } from './tools/order-confirmation-text';
import type { OrderCallHistory } from './tools/order-confirmation';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] },
];
const WILAYAS = PLACES.map((p) => ({ id: p.id, code: String(p.id).padStart(2, '0'), nameFr: p.nameFr, nameAr: p.nameAr }));
const COMMUNES = PLACES.flatMap((p) => p.communes.map((c) => ({ wilayaId: p.id, ...c })));
beforeEach(() => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue(WILAYAS as never);
  jest.spyOn(prisma.commune, 'findMany').mockResolvedValue(COMMUNES as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  resetPlaceIndex();
});

// the shops' delivery settings of the round (DeliveryFeeRule)
const RULES: Record<number, { home: number; stop: number; freeAbove?: number }> = { 9: { home: 450, stop: 300 }, 16: { home: 400, stop: 250 }, 19: { home: 650, stop: 350 }, 25: { home: 700, stop: 450 }, 31: { home: 600, stop: 400, freeAbove: 20_000 } };
const quoteOf = (args: Record<string, unknown>) => {
  const id = Number(args.wilayaId);
  const w = PLACES.find((p) => p.id === id)!;
  const r = RULES[id]!;
  return { ok: true, wilayaId: id, wilayaName: w.nameFr, wilayaNameAr: w.nameAr, isStopdesk: false, fee: r.home, free: false, freeFrom: r.freeAbove ?? null, stopdeskAvailable: true, stopdeskFee: r.stop, etaDays: '2–5' };
};

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, label: 'Haiku', ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
/** The routing of the app: `route` names the model a turn answered by the server alone is recorded with. */
const routing = {
  call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
  route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
};
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;
/** J03 has shop rules: `other` is an allowed reason. */
const AGENT_RULES = { id: 'a', humanHandoffRules: '- Les demandes de prix de gros vont à l’équipe.', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const HIJAB: Product = { id: '01a1e51f-450a-7000-8000-00000000450a', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
const DJELLABA: Product = { id: '01a1e54f-efdc-7000-8000-00000000efdc', name: 'Djellaba homme', price: 7500, hasVariants: false, variants: [], stock: 10, sellOutOfStock: false };
const TAPIS: Product = { id: '01a1e54f-a750-7000-8000-00000000a750', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 15, sellOutOfStock: false };
const OUD: Product = { id: '01a1e51f-8c00-7000-8000-000000008c00', name: 'Parfum Oud 50 ml', price: 3200, hasVariants: false, variants: [], stock: 0, sellOutOfStock: false };
const CATALOGUE = [HIJAB, DJELLABA, TAPIS, OUD];

const ctxOf = (customerText: string, history: string[], orderHistory: OrderCallHistory = [], agent: never = AGENT): ToolRunContext => ({ workspaceId: 'w', agent, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory, ordering: orderHistory.length > 0 });
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang, products: CATALOGUE.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: true, freshStart: false, ...o });
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');

/** A turn over a stub registry: quote_delivery answers from the shop's settings, create_order with `order`, lookup_order with `lookup`. */
const turnOf = async (
  said: string,
  lang: 'fr' | 'ar' | 'arabizi' | 'en',
  answers: Parameters<FakeAiGateway['script']>[1][],
  o: { history?: string[]; assistant?: string[]; orderHistory?: OrderCallHistory; order?: unknown; lookup?: unknown; agent?: never; defs?: (keyof typeof TOOL_DEFS)[] } = {},
) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const execute = jest.fn(async (name: string, args: Record<string, unknown>) => (name === 'quote_delivery' ? quoteOf(args) : name === 'create_order' ? (o.order ?? {}) : name === 'lookup_order' ? (o.lookup ?? { orders: [] }) : {}));
  const defs = (o.defs ?? ['quote_delivery', 'search_products', 'create_order', 'handoff_to_human']).map((d) => TOOL_DEFS[d]);
  const tools = { defsFor: async () => defs, execute, forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
  const history = o.history ?? [];
  const messages = [...history.flatMap((h, i) => [{ role: 'user', content: h }, ...(o.assistant?.[i] ? [{ role: 'assistant', content: o.assistant[i] }] : [])]), { role: 'user', content: said }];
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages } as never, toolCtx: ctxOf(said, history, o.orderHistory ?? [], o.agent ?? AGENT), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, lang) };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return { r, execute, gateway };
};
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);

// --- the real registry, as in R17 (create_order validated, the playground's TEST-n) --------------------------------------------------
const registry = (products: Product[]) => {
  const catalogue = { byIds: async (_a: unknown, ids: string[]) => products.filter((p) => ids.includes(p.id)) };
  const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
  jest.spyOn(prisma.wilaya, 'findUnique').mockImplementation((async (q: { where: { id: number } }) => {
    const p = PLACES.find((x) => x.id === q.where.id);
    return p ? { id: p.id, code: String(p.id), nameFr: p.nameFr, nameAr: p.nameAr, communes: p.communes } : null;
  }) as never);
  jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
  const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: (a: { wilayaId: number }) => Promise<Record<string, unknown>> };
  jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
  jest.spyOn(r, 'quote').mockImplementation(async (a) => ({ ...quoteOf(a) }));
  return reg;
};
const serviceOver = (gateway: FakeAiGateway, reg: ToolRegistry, route = true) => {
  const execute = jest.fn((name: string, args: Record<string, unknown>, ctx: ToolRunContext) => reg.execute(name, args, ctx));
  const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.search_products, TOOL_DEFS.lookup_order], execute, forcedHandoff: (n: string, a: Record<string, unknown>, r: unknown) => reg.forcedHandoff(n, a, r), soldProductNamed: async () => null } as unknown as ToolRegistry;
  return { svc: new AiRunService(gateway, (route ? routing : { call: routing.call }) as never, tools, {} as never, {} as never, {} as never), execute };
};
const shownBefore = (result: unknown): OrderCallHistory => [{ name: 'create_order', result, at: new Date(Date.now() - 60_000) }];
const placedCount = (execute: jest.Mock) => execute.mock.calls.filter((c) => c[0] === 'create_order').length;

// --- R19-1 (b) --------------------------------------------------------------------------------------------------------------------------
describe('R19-1 (Minor) — a plain yes to the recap shown is placed by the server with no model call at all', () => {
  const N17 = 'Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3';
  const CALL = { clientName: 'Nadia Kaci', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'cité 20 août villa 3', items: [{ productId: HIJAB.id, quantity: 1 }], customerConfirmed: true };
  const yesTurn = (said: string, history: string[], orderHistory: OrderCallHistory, lastAi: string, lang: 'fr' | 'ar' | 'arabizi' | 'en'): TurnRequest => ({
    runId: 'r2',
    prompt: { system: 'S', messages: [{ role: 'user', content: history.join('\n') }, { role: 'assistant', content: lastAi }, { role: 'user', content: said }] } as never,
    toolCtx: { ...ctxOf(said, history, orderHistory), runId: 'r2' },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    guard: guardOf(said, lang),
  });
  const recapOf = async (reg: ToolRegistry, said: string, history: string[]) => ((await reg.prepareOrder(CALL, ctxOf(said, history))) as { result: Record<string, unknown> }).result;

  it.each([
    ['fr', 'oui'],
    ['fr', 'oui c’est bon'],
    ['fr', '👍'],
    ['ar', 'ايه'],
    ['arabizi', 'ih'],
    ['en', 'yes'],
  ] as const)('(%s « %s ») zero model call, exactly one order with the recap’s draft, the server confirmation, no model step recorded', async (lang, yes) => {
    const reg = registry([HIJAB]);
    const t1 = await recapOf(reg, N17, []);
    expect(t1).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true });
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t1 }])!, lang).text;
    const gateway = new FakeAiGateway();
    // whatever the model would answer (R19 N17 T3: create_order, a tool not offered, then the answer — 3 calls)
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: CALL }] }, { toolCalls: [{ name: 'lookup_order', args: {} }] }, { reply: 'Votre commande est enregistrée.', intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg);
    const r = await svc.turn(yesTurn(yes, [N17], shownBefore(t1), recapText, lang));
    if (!r.ok) throw new Error('turn failed');
    expect(gateway.calls).toHaveLength(0);
    expect(placedCount(execute)).toBe(1);
    const done = r.tools.filter((t) => t.name === 'create_order');
    expect(done).toHaveLength(1);
    expect(done[0]!.result).toMatchObject({ ok: true, simulated: true, total: 1950 });
    expect((done[0]!.result as { draft?: unknown }).draft).toBe((t1.error as { draft: string }).draft);
    expect(r.output.reply).toBe(orderConfirmationText([{ name: 'create_order', result: done[0]!.result }], lang));
    expect(r.output.status).toBe('OK');
    expect(r.model).toBe(model);
    expect(r.steps).toEqual([]);
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('a yes with a change, a question, or no recap shown still goes to the model (no order from the server)', async () => {
    const reg = registry([HIJAB]);
    const t1 = await recapOf(reg, N17, []);
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t1 }])!, 'fr').text;
    for (const [said, last] of [
      ['oui mais livrez à Alger, Bab Ezzouar, rue des frères Bouadou n 5', recapText],
      ['oui, et elle arrive quand ?', recapText],
      ['oui', 'Voulez-vous le Hijab soie à la place ?'],
    ] as const) {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Très bien.', intent: 'SALE' });
      const { svc, execute } = serviceOver(gateway, reg);
      const r = await svc.turn(yesTurn(said, [N17], shownBefore(t1), last, 'fr'));
      if (!r.ok) throw new Error('turn failed');
      expect(gateway.calls.length).toBeGreaterThan(0);
      expect(execute.mock.calls.filter((c) => c[0] === 'create_order' && (c[1] as { customerConfirmed?: unknown }).customerConfirmed === true)).toHaveLength(0);
    }
  });

  it('no route to name the model ⇒ the model loop as before (the R17-2 placement on the model’s answer)', async () => {
    const reg = registry([HIJAB]);
    const t1 = await recapOf(reg, N17, []);
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t1 }])!, 'fr').text;
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Je vous confirme la commande ?', intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg, false);
    const r = await svc.turn(yesTurn('oui', [N17], shownBefore(t1), recapText, 'fr'));
    if (!r.ok) throw new Error('turn failed');
    expect(gateway.calls).toHaveLength(1);
    expect(placedCount(execute)).toBe(1);
    expect(r.output.reply.split('\n')[0]).toMatch(/^Votre commande TEST-\d+ est bien enregistrée/u);
  });
});

// --- R19-1 (a) --------------------------------------------------------------------------------------------------------------------------
describe('R19-1 (Minor) — a tool not offered costs no extra model call when the server can answer', () => {
  const recap = {
    ok: false,
    error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' },
    recapToShow: true,
    recap: { items: [{ name: 'Hijab soie', variant: null, quantity: 1, unitPrice: 1500 }], subtotal: 1500, deliveryFee: 450, total: 1950, clientName: 'Nadia Kaci', clientPhone: '0661234568', wilaya: 'Blida', wilayaAr: 'البليدة', communeName: 'Boufarik', communeAr: 'بوفاريك', address: 'cité 20 août villa 3', isStopdesk: false },
  };
  const N17 = 'Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3';
  const CALL = { name: 'create_order', args: { clientName: 'Nadia Kaci', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'cité 20 août villa 3', items: [{ productId: HIJAB.id, quantity: 1 }], customerConfirmed: true } };

  it('N17 T1: the recap create_order of a message that asks nothing ends the turn — no second call (R19: a tool not offered, then a 3rd call)', async () => {
    const { r, gateway } = await turnOf(N17, 'fr', [{ toolCalls: [CALL] }, { toolCalls: [{ name: 'lookup_order', args: {} }] }, { reply: 'Voici votre récapitulatif.', intent: 'SALE' }], { order: recap });
    expect(gateway.calls).toHaveLength(1);
    expect(r.output.reply).toBe(recapReply('', pendingRecap([{ name: 'create_order', result: recap }])!, 'fr').text);
    expect(r.output).toMatchObject({ status: 'OK', intent: 'SALE', customer: { name: 'Nadia Kaci', phone: '0661234568', commune: 'Boufarik', address: 'cité 20 août villa 3' }, cart: { items: [{ productId: HIJAB.id, quantity: 1 }] } });
    expect(r.steps?.map((s) => s.calls ?? [])).toEqual([['create_order']]);
  });

  it('a tool not offered asked in the same step as the recap call: answered by the server, no further call; its name is kept on the step', async () => {
    const { r, gateway } = await turnOf(N17, 'fr', [{ toolCalls: [CALL, { name: 'lookup_order', args: {} }] }, { reply: 'Voici.', intent: 'SALE' }], { order: recap });
    expect(gateway.calls).toHaveLength(1);
    expect(r.output.reply).toContain('Total : 1 950 DA');
    expect(r.steps?.[0]).toMatchObject({ stray: ['lookup_order'] });
  });

  it('a delivery question to the recap’s place is answered by the server before the recap (N3 T2: no lead-in call)', async () => {
    const said = 'twasslou l Blida ? Nadia Kaci 0661234568, Boufarik, cité 20 août villa 3, 1 hijab soie';
    const { r, gateway } = await turnOf(said, 'arabizi', [{ toolCalls: [CALL] }, { reply: 'Ih !', intent: 'SALE' }], { order: recap });
    expect(gateway.calls).toHaveLength(1);
    // (journey retest R20-2: with both fees — the server quotes the recap's wilaya, no model call)
    expect(r.output.reply.startsWith('Ih, nwasslou l Blida, f 2 l 5 ayam. L dar: 450\u00a0DA, f l bureau: 300\u00a0DA.\n\nHada récap')).toBe(true);
    expect(deliveryAnswer([{ name: 'create_order', result: recap }], 'vous livrez à Boufarik ?', 'fr')).toBe('Oui, on livre à Boufarik. À domicile : 450\u00a0DA.');
  });

  it('a recap while the message asks something else (or asks for a person) still gets the model’s answer', async () => {
    const asks = await turnOf(`${N17}. Elle est en quelle matière ?`, 'fr', [{ toolCalls: [CALL] }, { reply: 'Elle est en soie.', intent: 'SALE' }], { order: recap });
    expect(asks.gateway.calls).toHaveLength(2);
    expect(asks.r.output.reply.startsWith('Elle est en soie.')).toBe(true);
    const person = await turnOf(`${N17}. Je veux parler à quelqu'un`, 'fr', [{ toolCalls: [CALL] }, { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: "parler à quelqu'un", intent: 'OTHER' }], { order: recap });
    expect(person.gateway.calls).toHaveLength(2);
  });

  it('PG2 T2: a create_order this message cannot make (no street) asked though not offered ⇒ the server’s address question with the price and both fees, one model call', async () => {
    const T1 = 'السلام عليكم، أنا من البليدة بوفاريك';
    const T2 = 'نحب جلابة رجالي، سمير بن علي 0661234567';
    const { r, gateway, execute } = await turnOf(T2, 'ar', [{ toolCalls: [{ name: 'create_order', args: { clientName: 'سمير بن علي', clientPhone: '0661234567', wilayaId: 9, items: [{ productId: DJELLABA.id, quantity: 1 }] } }] }, { reply: 'صحيت يا سمير.', intent: 'SALE' }], { history: [T1], assistant: ['وعليكم السلام! واش تحب تشري؟'] });
    expect(gateway.calls).toHaveLength(1);
    expect(offered(gateway)).not.toContain('create_order');
    expect(r.steps?.[0]).toMatchObject({ stray: ['create_order'] });
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['quote_delivery']);
    const text = plain(r.output.reply);
    // the price, then both fees, then the one address question (the facts before the question)
    expect(text).toBe('Djellaba homme بـ 7 500 دج. للدار: 450 دج، للمكتب: 300 دج. عطيني العنوان تاعك (الشارع، الحي، رقم الدار)، ولا تحب التوصيل للمكتب ؟');
    expect(r.output.productCards).toEqual([DJELLABA.id]);
  });

  it('PG1b T2 (arabizi) and N4 T3 (the wilaya missing): the field the message lacks is asked by the server', async () => {
    const pg1b = await turnOf('nheb tapis de prière wahed, smiti Nadia Kaci 0661234568', 'arabizi', [{ toolCalls: [{ name: 'create_order', args: { clientName: 'Nadia Kaci', clientPhone: '0661234568', wilayaId: 31, items: [{ productId: TAPIS.id, quantity: 1 }] } }] }, { reply: 'Saha.', intent: 'SALE' }], { history: ['slm, ana f Oran, Bir El Djir'], assistant: ['Ahlan bik !'] });
    expect(pg1b.gateway.calls).toHaveLength(1);
    expect(plain(pg1b.r.output.reply)).toBe("Tapis de prière b 2 800 DA. L dar: 600 DA, f l bureau: 400 DA. A3tini l'adresse ta3ek (rue, cité, numéro ta3 dar), wela t7ebb tawsil l bureau ?");
    const n4 = await turnOf('0661234567', 'fr', [{ toolCalls: [{ name: 'create_order', args: { clientName: 'سمير بن علي', clientPhone: '0661234567' } }] }, { reply: 'Merci.', intent: 'SALE' }], { history: ['Bonjour, je veux le tapis de prière', 'سمير بن علي'], assistant: ['Le Tapis de prière — 2800 DA. Quel est votre nom ?', 'Merci سمير. Votre numéro ?'] });
    expect(n4.gateway.calls).toHaveLength(1);
    expect(n4.r.output.reply).toBe('Dans quelle wilaya êtes-vous ?');
  });

  it('the step’s own readable answer next to the stray call is used; a stray call on a message that asks something gets the model’s answer', async () => {
    // (the live gateway can return the answer's text with a call the SDK refused)
    const said = 'nheb tapis de prière wahed, smiti Nadia Kaci 0661234568';
    const seen: unknown[] = [];
    const answers = [
      { text: JSON.stringify({ reply: 'Saha Nadia. Wach men wilaya ?', status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 0.9 }), toolCalls: [], rejectedToolCalls: [{ id: 't1', name: 'create_order', args: {} }], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'tool-calls' },
      { text: JSON.stringify({ reply: 'X', status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 0.9 }), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' },
    ];
    const gateway = { driver: 'fake', generate: async (q: unknown) => (seen.push(q), answers.shift()!), transcribe: async () => ({ text: '', language: null, durationSec: null }) };
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.quote_delivery], execute: jest.fn(async () => ({})), forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: ctxOf(said, []), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, 'arabizi') };
    const own = await new AiRunService(gateway as never, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    expect(seen).toHaveLength(1);
    expect(own.ok && own.output.reply).toContain('Wach men wilaya ?');
    // no name written by the customer in the call (or none at all): the model is asked, as before
    const noName = await turnOf('0661234568', 'fr', [{ toolCalls: [{ name: 'create_order', args: { clientPhone: '0661234568' } }] }, { reply: 'Quel est votre nom ?', intent: 'SALE' }], { history: ['Je voudrais le tapis de prière', 'Blida, Boufarik'] });
    expect(noName.gateway.calls).toHaveLength(2);
    expect(noName.r.output.reply).toBe('Quel est votre nom ?');
    const asks = await turnOf('nheb tapis de prière wahed, smiti Nadia Kaci 0661234568, kayen f lkhdar ?', 'arabizi', [{ toolCalls: [{ name: 'create_order', args: {} }] }, { reply: 'Kayen ghir f lbni.', intent: 'SALE' }], { history: ['slm, ana f Oran, Bir El Djir'] });
    expect(asks.gateway.calls).toHaveLength(2);
  });

  it('N11 T3: a lookup by the number the turn’s first lookup returned is answered from it — one lookup', async () => {
    const order = { number: 'TEST-4074', status: 'new', deliveryStatus: 'not_sent', courier: null, trackingNumber: null, simulated: true };
    expect(orderLookupAnswered({ name: 'lookup_order', args: { orderNumber: 'test-4074' } }, [{ name: 'lookup_order', result: { orders: [order] } }])).toMatchObject({ orders: [order], repeated: true });
    expect(orderLookupAnswered({ name: 'lookup_order', args: { orderNumber: 'TEST-9999' } }, [{ name: 'lookup_order', result: { orders: [order] } }])).toBeNull();
    expect(orderLookupAnswered({ name: 'lookup_order', args: { orderNumber: 'TEST-4074', phone: '0661234567' } }, [{ name: 'lookup_order', result: { orders: [order] } }])).toBeNull();
    const placed: OrderCallHistory = [{ name: 'create_order', result: { ok: true, number: 'TEST-4074', total: 8200, simulated: true }, at: new Date(Date.now() - 30_000) }];
    const said = 'صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟';
    const { execute, gateway } = await turnOf(said, 'ar', [{ toolCalls: [{ name: 'lookup_order', args: {} }] }, { toolCalls: [{ name: 'lookup_order', args: { orderNumber: 'TEST-4074' } }] }, { reply: 'الطلبية تاعك TEST-4074 قيد التحضير.', intent: 'TRACKING' }], { history: ['السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5', 'ايه'], orderHistory: placed, lookup: { orders: [order] }, defs: ['lookup_order', 'create_order'] });
    expect(execute.mock.calls.filter((c) => c[0] === 'lookup_order')).toHaveLength(1);
    expect(gateway.calls).toHaveLength(3);
  });

  it('N5 T2: the details while the product taken is out of stock — no create_order offered, the model told to ask about the in-stock product', async () => {
    const T1 = "Bonjour, le parfum oud c'est combien ?";
    const T2 = 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
    const { r, gateway, execute } = await turnOf(T2, 'fr', [{ reply: 'Le Parfum Oud est en rupture. Voulez-vous le Hijab soie à 1500 DA à la place ?', intent: 'SALE' }], { history: [T1], assistant: ['Parfum Oud 50 ml est à 3200 DA, mais il n’est pas disponible. Notre Hijab soie est en stock à 1500 DA.'] });
    expect(offered(gateway)).not.toContain('create_order');
    expect(gateway.calls[0]!.system).toContain(takesUnavailableNote('Parfum Oud 50 ml'));
    expect(gateway.calls).toHaveLength(1);
    expect(execute.mock.calls.filter((c) => c[0] === 'create_order')).toHaveLength(0);
    expect(r.output.reply).toContain('Voulez-vous le Hijab soie');
    // T3 « oui » to that question: create_order is offered again (the substitute's recap)
    const t3 = await turnOf('oui', 'fr', [{ reply: 'Très bien.', intent: 'SALE' }], { history: [T1, T2], assistant: ['…', 'Voulez-vous le Hijab soie à la place ?'] });
    expect(offered(t3.gateway)).toContain('create_order');
  });
});

describe('R19-1 (Minor) — an answer the server can mend costs no format retry', () => {
  it('a raw line break / tab inside a string, a trailing comma: read; anything else stays unreadable', () => {
    const broken = '{"reply": "Merci Karim !\nQuelle est votre adresse ?\t", "status": "OK", "intent": "SALE", "productCards": [], "recommendations": [], "confidence": 0.9,}';
    expect(JSON.parse(repairJson(broken))).toMatchObject({ reply: 'Merci Karim !\nQuelle est votre adresse ?\t', status: 'OK' });
    expect(parseReplyOutput(broken)).toMatchObject({ ok: true, value: { reply: 'Merci Karim !\nQuelle est votre adresse ?\t' } });
    expect(parseReplyOutput('{"reply": "Merci "Karim" !", "status": "OK"}')).toMatchObject({ ok: false });
  });
  it('the turn: one model call, no format reminder', async () => {
    const { r, gateway } = await turnOf('Bonjour', 'fr', [{ text: '{"reply": "Bonjour !\nQue cherchez-vous ?", "status": "OK", "intent": "GREETING", "productCards": [], "recommendations": [], "confidence": 0.9}' }, { reply: 'X', intent: 'OTHER' }], { defs: [] });
    expect(gateway.calls).toHaveLength(1);
    expect(r.output.reply).toBe('Bonjour !\nQue cherchez-vous ?');
    expect(r.repaired).toBe(false);
  });
});

// --- R19-2 ------------------------------------------------------------------------------------------------------------------------------
describe('R19-2 (Minor) — no handoff tool on a message naming no product (a delivery question, an address, a yes)', () => {
  it.each([
    ['N3 T2', 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5', ['Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567']],
    ['F1b T4', "oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif", ['Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233', 'Sétif, El Eulma', 'Cité 500 logements bloc 12']],
    ['delivery question', 'Vous livrez à Oran ?', []],
  ] as const)('%s « %s »: handoff_to_human is not offered (off_catalogue read with the place names out, no shop rule applies)', async (_id, said, history) => {
    const { gateway } = await turnOf(said, 'fr', [{ reply: 'Oui.', intent: 'OTHER' }], { history: [...history], agent: AGENT_RULES });
    expect(offered(gateway)).not.toContain('handoff_to_human');
  });

  it.each([
    ["je veux parler à quelqu'un", 'customer_request'],
    ['salam, wsaltni la commande mkassra, nheb tredouli drahmi', 'refund'],
    ['Bonjour, prix de gros pour 50 pièces du hijab soie ?', 'other'],
  ])('a real request « %s » keeps the tool (%s)', async (said, reason) => {
    const { gateway } = await turnOf(said, 'fr', [{ reply: 'Je transmets.', intent: 'OTHER' }], { agent: AGENT_RULES });
    expect(offered(gateway)).toContain('handoff_to_human');
    const def = gateway.calls[0]!.tools!.find((t) => t.name === 'handoff_to_human')!;
    expect((def.parameters as { properties: { reason: { enum: string[] } } }).properties.reason.enum).toContain(reason);
  });
});

// --- R19-3 ------------------------------------------------------------------------------------------------------------------------------
describe('R19-3 (Cosmetic) — wording', () => {
  it('« c’est noté : … » / « j’ai bien noté … » before any recap: the phrase goes, a price it carries stays, an echo of the fields goes', () => {
    expect(withoutNotedSteps("Merci Amina ! C'est noté : robe kabyle brodée taille M b 4900 DA, 1 pièce. L dar: 400 DA. Quelle est votre adresse ?", 'Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar')).toBe(
      'Merci Amina ! Robe kabyle brodée taille M b 4900 DA, 1 pièce. L dar: 400 DA. Quelle est votre adresse ?',
    );
    expect(withoutNotedSteps("Merci Karim, c'est noté : Sétif, El Eulma. À domicile : 650 DA. Quelle est votre adresse ?", 'Je cherche le sac\nSétif, El Eulma')).toBe('Merci Karim. À domicile : 650 DA. Quelle est votre adresse ?');
    expect(withoutNotedSteps("Excellent choix ! Merci Karim, j'ai bien noté votre nom, votre numéro et El Eulma à Sétif. Quelle est votre adresse ?", "Bonjour, j'habite à Sétif, El Eulma\nJe voudrais le sac à main cuir marron. Karim Haddad 0770112233")).toBe(
      'Excellent choix ! Merci Karim. Quelle est votre adresse ?',
    );
    expect(withoutNotedSteps("Merci Karim, j'ai bien noté Oran, Bir El Djir, cité 1000 logements bloc 4. Livraison à domicile : 600 DA.", 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4')).toBe('Merci Karim. Livraison à domicile : 600 DA.');
    // a question, or a sentence about something the customer did not write, stays
    expect(withoutNotedSteps("C'est noté : vous préférez le stop-desk ?", 'stop desk')).toBe("C'est noté : vous préférez le stop-desk ?");
    expect(withoutNotedSteps("J'ai noté que la livraison prend 2 à 5 jours en général.", 'Bonjour')).toBe("J'ai noté que la livraison prend 2 à 5 jours en général.");
  });

  it('the substitute question is never worded as an order step', () => {
    expect(withoutOrderStepAsk('Parfum Oud 50 ml est à 3200 DA, mais ce produit n’est pas disponible pour le moment. Notre Hijab soie est en stock à 1500 DA. Voulez-vous que je vous le réserve ?', 'fr')).toBe(
      'Parfum Oud 50 ml est à 3200 DA, mais ce produit n’est pas disponible pour le moment. Notre Hijab soie est en stock à 1500 DA. Ça vous intéresse ?',
    );
    expect(withoutOrderStepAsk('Livraison à domicile : 600 DA. Le Parfum Oud étant en rupture, je vous confirme : c’est bien le Hijab soie à 1500 DA que vous voulez ?', 'fr')).toBe(
      'Livraison à domicile : 600 DA. Le Parfum Oud étant en rupture, c’est bien le Hijab soie à 1500 DA que vous voulez ?',
    );
    expect(withoutOrderStepAsk('Je vous confirme : la livraison est à 600 DA ?', 'fr')).toBe('La livraison est à 600 DA ?');
    // no product missing: a booking question is left to the R16-4 rule; a field question keeps its words
    expect(withoutOrderStepAsk('Le Hijab soie est à 1500 DA. Voulez-vous que je vous le réserve ?', 'fr')).toBe('Le Hijab soie est à 1500 DA. Voulez-vous que je vous le réserve ?');
    expect(withoutOrderStepAsk('Le Parfum Oud est en rupture. Quel est votre nom pour que je vous le réserve ?', 'fr')).toBe('Le Parfum Oud est en rupture. Quel est votre nom pour que je vous le réserve ?');
  });

  it('the server’s facts go before the reply’s questions, never between two; the price before the fees', () => {
    const blida = quoteFacts([{ name: 'quote_delivery', result: quoteOf({ wilayaId: 9 }) }]);
    // PG2 T2: « واش العنوان تاعك في بوفاريك؟ » then the mode question
    const pg2 = 'صحيت يا سمير. Djellaba homme — 7500 دج. واش العنوان تاعك في بوفاريك؟ عطيني الشارع والحي ورقم الدار، ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟';
    expect(plain(withModeFees(pg2, blida, 'ar'))).toBe('صحيت يا سمير. Djellaba homme — 7500 دج. للدار: 450 دج، للمكتب: 300 دج. واش العنوان تاعك في بوفاريك؟ عطيني الشارع والحي ورقم الدار، ولا تحب نوصلوها لنقطة الاستلام (stop-desk)؟');
    // PF1 T2: the fees written first, then the price line ⇒ the price goes before them
    const pf1 = 'Merci Karim. À domicile : 650 DA, en stop-desk : 350 DA. Quelle est votre adresse exacte (rue, cité, numéro de bâtiment) pour la livraison à domicile, ou préférez-vous le stop-desk ?';
    expect(plain(withPlaceFacts(pf1, [], { name: 'Sac à main cuir', variant: 'Marron', price: 6900 }, 'fr'))).toBe('Merci Karim. Sac à main cuir (Marron) : 6 900 DA. À domicile : 650 DA, en stop-desk : 350 DA. Quelle est votre adresse exacte (rue, cité, numéro de bâtiment) pour la livraison à domicile, ou préférez-vous le stop-desk ?');
    // one question: unchanged placement
    expect(plain(withPlaceFacts('Merci. Votre adresse ?', blida, null, 'fr'))).toBe('Merci. Livraison : 450 DA à domicile, ou 300 DA au bureau du transporteur si vous préférez. Votre adresse ?');
  });

  it('every server amount as formatMoney writes it (« 20 000 DA »)', () => {
    expect(amountText(20_000, 'fr')).toBe('20\u00a0000\u00a0DA');
    expect(amountText(7500, 'ar')).toBe('7\u00a0500\u00a0دج');
    expect(amountText(650, 'arabizi')).toBe('650\u00a0DA');
    const oran = quoteFacts([{ name: 'quote_delivery', result: quoteOf({ wilayaId: 31 }) }]);
    expect(plain(withPlaceFacts('Saha. Wach men produit t7ebb ?', oran, null, 'arabizi'))).toBe('Saha. Tawsil: 600 DA (batel men 20 000 DA) l dar, wela 400 DA f l bureau ila t7ebb. Wach men produit t7ebb ?');
    expect(plain(withPlaceFacts('Merci. Votre adresse ?', oran, null, 'fr'))).toContain('600 DA (gratuite dès 20 000 DA) à domicile');
  });

  it('the customer’s first name as written after a thank-you (N4 T2, F3 T2); a Latin name or another word stays', () => {
    expect(withCustomerScriptName('Merci Samir. Pouvez-vous me donner votre numéro de téléphone ? (exemple : 0555123456)', 'Bonjour, je veux le tapis de prière\nسمير بن علي')).toBe('Merci سمير. Pouvez-vous me donner votre numéro de téléphone ? (exemple : 0555123456)');
    expect(withCustomerScriptName('Saha Walid. A3tini numéro ta3ek (ex: 0555123456) bach nkamlou la commande.', 'nheb nechri zoudj tapis de prière\nsmiti وليد بوزيد')).toBe('Saha وليد. A3tini numéro ta3ek (ex: 0555123456) bach nkamlou la commande.');
    // R18-4's run of words still works
    expect(withCustomerScriptName('Très bien, je note le nom : Samir Ben Ali.', 'سمير بن علي')).toBe('Très bien, je note le nom : سمير بن علي.');
    // another word after « Merci » / « Saha » (same first letter, other consonants), a Latin customer name, a name the customer did not write
    expect(withCustomerScriptName('Merci Sara. Votre numéro ?', 'سمير بن علي')).toBe('Merci Sara. Votre numéro ?');
    expect(withCustomerScriptName('Saha Karim, wach smitek ?', 'nheb djellaba\nسمير بن علي')).toBe('Saha Karim, wach smitek ?');
    expect(withCustomerScriptName('Merci Samir. Votre numéro ?', 'Samir Benali')).toBe('Merci Samir. Votre numéro ?');
    expect(withCustomerScriptName('Merci Samir Haddad.', 'سمير بن علي')).toBe('Merci Samir Haddad.');
  });
});
