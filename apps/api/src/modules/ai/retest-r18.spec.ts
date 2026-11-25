// Journey retest R18 (18/11, docs/audit/journeys-2026-11-16/journeys/R18-ai-orders.md): a place-only first message got no fee 3 times in 4
// (R18-1, PF1 / PG1 / PG2 T1), the product's price missing before the field questions (R18-2, PG2 T2 / N3 T1), server turns ≥ 10 s and a
// redundant lookup (R18-3, N7 T1 / F1b T2 / N11 T3), wording (R18-4, « tsajjel » lines, N4 name script, N16 offer, P2 « ideale »).
// Transcripts: .local/qa/journeys/R18/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, lookupByNumber, placeQuoteMessage, type TurnRequest } from './ai-run.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabiziWords, withCustomerScriptName, withNotServed, withoutNotedSteps, withoutUnrelatedOffer } from './reply-fixes';
import { buildGuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] },
  { id: 33, nameFr: 'Illizi', nameAr: 'إليزي', communes: [] as { nameFr: string; nameAr: string }[] },
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

// the shops' delivery settings of the round (DeliveryFeeRule, identical on both shops)
const RULES: Record<number, { home: number; stop: number; freeAbove?: number } | null> = { 9: { home: 450, stop: 300 }, 16: { home: 400, stop: 250 }, 19: { home: 650, stop: 350 }, 25: { home: 700, stop: 450 }, 31: { home: 600, stop: 400, freeAbove: 20_000 }, 33: null };
const quoteOf = (args: Record<string, unknown>) => {
  const id = Number(args.wilayaId);
  const w = PLACES.find((p) => p.id === id)!;
  const r = RULES[id];
  if (!r) return { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: id, wilayaName: w.nameFr, stopdeskAvailable: false } };
  const subtotal = typeof args.subtotal === 'number' ? args.subtotal : undefined;
  const free = r.freeAbove !== undefined && subtotal !== undefined && subtotal >= r.freeAbove;
  return { ok: true, wilayaId: id, wilayaName: w.nameFr, wilayaNameAr: w.nameAr, isStopdesk: false, fee: free ? 0 : r.home, free, freeFrom: r.freeAbove ?? null, freeFor: r.freeAbove ? 'home' : null, stopdeskAvailable: true, stopdeskFee: r.stop, etaDays: '2–5' };
};

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const HIJAB: Product = { id: '01a1e51f-450a-7000-8000-00000000450a', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
const DJELLABA: Product = { id: '01a1e54f-efdc-7000-8000-00000000efdc', name: 'Djellaba homme', price: 7500, hasVariants: false, variants: [], stock: 10, sellOutOfStock: false };
const TAPIS: Product = { id: '01a1e54f-a750-7000-8000-00000000a750', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 15, sellOutOfStock: false };
const OUD: Product = { id: '01a1e51f-oud0-7000-8000-000000000oud', name: 'Parfum Oud 50 ml', price: 3200, hasVariants: false, variants: [], stock: 0, sellOutOfStock: false };
const CATALOGUE = [HIJAB, DJELLABA, TAPIS, OUD];

const ctxOf = (customerText: string, history: string[]): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory: [], ordering: false });
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang, products: CATALOGUE.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: false, freshStart: true, ...o });
/** One turn: the model's scripted answers, every tool call answered from the shop's settings above (quote) or `{}`. */
const turnOf = async (said: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', answers: Parameters<FakeAiGateway['script']>[1][], o: { history?: string[]; assistant?: string[]; guard?: Partial<Parameters<typeof buildGuardFacts>[0]>; defs?: (keyof typeof TOOL_DEFS)[] } = {}) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const execute = jest.fn(async (name: string, args: Record<string, unknown>) => (name === 'quote_delivery' ? quoteOf(args) : {}));
  const defs = (o.defs ?? ['quote_delivery', 'search_products', 'create_order']).map((d) => TOOL_DEFS[d]);
  const tools = { defsFor: async () => defs, execute, forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
  const history = o.history ?? [];
  const messages = [...history.flatMap((h, i) => [{ role: 'user', content: h }, ...(o.assistant?.[i] ? [{ role: 'assistant', content: o.assistant[i] }] : [])]), { role: 'user', content: said }];
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages } as never, toolCtx: ctxOf(said, history), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, lang, o.guard) };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return { r, execute, gateway };
};
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');

// --- R18-1 -------------------------------------------------------------------------------------------------------------------------
describe('R18-1 (Minor) — a message naming a served wilaya no turn quoted gets its home and stop-desk fees, whatever the reply asks', () => {
  it.each([
    // the three transcripts' first turns: 0 tool call, intent greeting, the model asked which product
    ['PF1 T1', "Bonjour, j'habite à Sétif, El Eulma", 'fr', "Merci pour l'info, on a bien noté Sétif, El Eulma. Qu'est-ce qui vous intéresse aujourd'hui ? Dites-moi ce que vous cherchez et je vous montre les articles disponibles. 😊", 19, ['650 DA', '350 DA']],
    ['PG1 T1', 'slm, ana f Oran, Bir El Djir', 'arabizi', 'Salam, marhba bik! Ahlan bik f Oran. Wach men produit t7ebb tchri lyoum ?', 31, ['600 DA', '400 DA']],
    ['PG2 T1', 'السلام عليكم، أنا من البليدة بوفاريك', 'ar', 'وعليكم السلام ورحمة الله، مرحبًا بيك في بلدية بوفاريك! واش تحب تلقى عندنا اليوم؟', 9, ['450 دج', '300 دج']],
  ] as const)('%s reproduction « %s »: the server quotes the wilaya, the reply gives both fees before its question; one model call', async (_id, said, lang, modelReply, wilayaId, fees) => {
    const { r, execute, gateway } = await turnOf(said, lang, [{ reply: modelReply, intent: 'GREETING' }]);
    expect(execute.mock.calls.map((c) => [c[0], c[1]])).toEqual([['quote_delivery', { wilayaId }]]);
    expect(gateway.calls).toHaveLength(1);
    for (const fee of fees) expect(plain(r.output.reply)).toContain(fee);
    expect(r.output.status).toBe('OK');
    expect(r.tools.map((t) => t.name)).toEqual(['quote_delivery']);
    // the fees go before the question the model asked
    const q = /[^.!؟?]*[?؟]/u.exec(modelReply)![0].trim();
    expect(plain(r.output.reply).indexOf(fees[1]!)).toBeLessThan(r.output.reply.indexOf(q));
  });

  it('PG1 T1 exact text: the arabizi fees with the free threshold of Oran (600 DA under 20 000 DA)', async () => {
    const { r } = await turnOf('slm, ana f Oran, Bir El Djir', 'arabizi', [{ reply: 'Salam, marhba bik! Ahlan bik f Oran. Wach men produit t7ebb tchri lyoum ?', intent: 'GREETING' }]);
    expect(r.output.reply).toBe('Salam, marhba bik! Ahlan bik f Oran. Tawsil: 600\u00a0DA (batel men 20\u00a0000\u00a0DA) l dar, wela 400\u00a0DA f l bureau ila t7ebb. Wach men produit t7ebb tchri lyoum ?');
  });

  it('PF1 T1 exact text (fr)', async () => {
    const { r } = await turnOf("Bonjour, j'habite à Sétif, El Eulma", 'fr', [{ reply: "Bonjour ! Qu'est-ce qui vous intéresse aujourd'hui ?", intent: 'GREETING' }]);
    expect(r.output.reply).toBe("Bonjour ! Livraison : 650\u00a0DA à domicile, ou 350\u00a0DA au bureau du transporteur si vous préférez. Qu'est-ce qui vous intéresse aujourd'hui ?");
  });

  it('a wilaya that is not served ⇒ « we don’t deliver there », in the customer’s script; already said ⇒ not twice', async () => {
    const a = await turnOf('slm, ana f Illizi', 'arabizi', [{ reply: 'Salam, marhba bik! Wach men produit t7ebb ?', intent: 'GREETING' }]);
    expect(a.execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 33 }, expect.anything());
    expect(a.r.output.reply).toBe('Salam, marhba bik! Ma nwasslouch l Illizi f had lwaqt. Wach men produit t7ebb ?');
    const b = await turnOf('السلام عليكم، أنا من إليزي', 'ar', [{ reply: 'وعليكم السلام! واش تحب ؟', intent: 'GREETING' }]);
    expect(b.r.output.reply).toBe('وعليكم السلام! ما نوصلوش ل\u0640إليزي درك. واش تحب ؟');
    const c = await turnOf("Bonjour, j'habite à Illizi", 'fr', [{ reply: 'Bonjour ! Désolé, nous ne livrons pas à Illizi pour le moment.', intent: 'GREETING' }]);
    expect(c.r.output.reply).toBe('Bonjour ! Désolé, nous ne livrons pas à Illizi pour le moment.');
    expect(withNotServed('Bienvenue à Illizi ! Que cherchez-vous ?', { fr: 'Illizi' }, 'fr')).toBe('Bienvenue à Illizi ! Nous ne livrons pas à Illizi pour le moment. Que cherchez-vous ?');
  });

  it('a field answer naming the place, the reply asking another field ⇒ quoted (F1-like « Sétif, El Eulma »)', async () => {
    const { r, execute } = await turnOf('Sétif, El Eulma', 'fr', [{ reply: 'Merci ! Quel est votre nom ?', intent: 'SALE' }], { history: ['Je voudrais le hijab soie'] });
    expect(execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 19 }, expect.anything());
    expect(r.output.reply).toBe('Merci ! Livraison : 650\u00a0DA à domicile, ou 350\u00a0DA au bureau du transporteur si vous préférez. Quel est votre nom ?');
  });

  it('a street given already ⇒ the home fee alone (no stop-desk offered after an address)', async () => {
    const said = 'Blida, Boufarik, cité 20 août villa 3';
    const { r } = await turnOf(said, 'fr', [{ reply: 'Merci ! Quel est votre numéro de téléphone ?', intent: 'SALE' }], { history: ['Je voudrais le hijab soie, Nadia Kaci'] });
    expect(plain(r.output.reply)).toBe('Merci ! Livraison à domicile : 450 DA. Quel est votre numéro de téléphone ?');
  });

  it('nothing is quoted: a wilaya quoted in an earlier turn, a tracking / cancel / complaint message, a wish for a product not sold, a message naming no place', async () => {
    const quoted = await turnOf("Bonjour, j'habite à Sétif, El Eulma", 'fr', [{ reply: 'Que cherchez-vous ?', intent: 'GREETING' }], { guard: { earlierToolResults: [quoteOf({ wilayaId: 19 })] } });
    expect(quoted.execute).not.toHaveBeenCalled();
    for (const said of ['où est ma commande ? je suis à Sétif', 'je veux annuler, livrez plus à Oran', "le colis n'est jamais arrivé à Blida !", 'Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik', 'Bonjour']) {
      const t = await turnOf(said, 'fr', [{ reply: 'Je regarde ça.', intent: 'OTHER' }]);
      expect([said, t.execute.mock.calls.map((c) => c[0])]).toEqual([said, []]);
    }
    expect(placeQuoteMessage('slm, ana f Oran, Bir El Djir')).toBe(true);
    expect(placeQuoteMessage('win rahi la commande ta3i ? ana f Oran')).toBe(false);
  });
});

// --- R18-2 -------------------------------------------------------------------------------------------------------------------------
describe('R18-2 (Minor) — the price of the product being sold, not told yet in the conversation, is in the reply', () => {
  it('PG2 T2 reproduction: « نحب جلابة رجالي، سمير بن علي 0661234567 » (the place quoted at T1), the model gives both fees and the mode question, no price ⇒ the Djellaba’s 7500 دج is added', async () => {
    const T1 = 'السلام عليكم، أنا من البليدة بوفاريك';
    const T2 = 'نحب جلابة رجالي، سمير بن علي 0661234567';
    const reply = 'صحيت، سميتك سمير بن علي ورقمك 0661234567 وبلديتك بوفاريك، ولاية البليدة. للدار: 450 دج، لنقطة الاستلام (stop-desk): 300 دج. تحب نوصلوها للدار ولا في ستوب ديسك؟';
    const { r } = await turnOf(T2, 'ar', [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaId: 9 } }] }, { reply, intent: 'SALE', productCards: [DJELLABA.id] }], { history: [T1], assistant: ['وعليكم السلام! التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش تحب تلقى عندنا اليوم؟'] });
    expect(r.output.reply).toContain('Djellaba homme ب\u0640 7\u00a0500\u00a0دج.');
    expect(r.output.reply.indexOf('7500')).toBeLessThan(r.output.reply.indexOf('تحب نوصلوها'));
  });

  it('N3 T1 reproduction: « je voudrais 2 tapis de prière … », the model asks the wilaya with no price ⇒ « Tapis de prière : 2800 DA. » before the question (and no « c’est noté »)', async () => {
    const said = 'Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567';
    const { r } = await turnOf(said, 'fr', [{ reply: "Parfait Samira, 2 tapis de prière molletonnés 120 x 70 cm, c'est noté ! Dans quelle wilaya êtes-vous ?", intent: 'SALE', productCards: [TAPIS.id] }]);
    expect(r.output.reply).toBe('Parfait Samira, 2 tapis de prière molletonnés 120 x 70 cm ! Tapis de prière : 2\u00a0800\u00a0DA. Dans quelle wilaya êtes-vous ?');
  });

  it('nothing added: the price told in an earlier AI message or in this reply, an out-of-stock product, a reply about another product', async () => {
    const said = 'Je prends le hijab soie, Nadia Kaci';
    const told = await turnOf(said, 'fr', [{ reply: 'Merci Nadia ! Votre numéro de téléphone ?', intent: 'SALE' }], { history: ['le hijab soie c’est combien ?'], assistant: ['Le Hijab soie est à 1500 DA.'] });
    expect(told.r.output.reply).toBe('Merci Nadia ! Votre numéro de téléphone ?');
    const here = await turnOf(said, 'fr', [{ reply: 'Merci Nadia ! Le hijab soie est à 1 500 DA. Votre numéro ?', intent: 'SALE' }]);
    expect(here.r.output.reply).toBe('Merci Nadia ! Le hijab soie est à 1 500 DA. Votre numéro ?');
    const gone = await turnOf('je veux le parfum oud', 'fr', [{ reply: 'Le Parfum Oud n’est pas disponible pour le moment. Voulez-vous voir le Hijab soie (1500 DA) ?', intent: 'SALE' }]);
    expect(gone.r.output.reply).not.toMatch(/3200/u);
    const fresh = await turnOf(said, 'fr', [{ reply: 'Merci Nadia ! Votre numéro de téléphone ?', intent: 'SALE' }]);
    expect(fresh.r.output.reply).toBe('Merci Nadia ! Hijab soie : 1\u00a0500\u00a0DA. Votre numéro de téléphone ?');
  });
});

// --- R18-3 -------------------------------------------------------------------------------------------------------------------------
describe('R18-3 (Minor) — fewer model steps: no corrective turn for a missing fee, one lookup by the order number, the steps kept', () => {
  it('F1b T2-like: the model quoted Sétif and gave no fee ⇒ the server writes the fee sentence, no corrective model turn', async () => {
    const { r, gateway } = await turnOf('c’est combien la livraison à Sétif ?', 'fr', [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaId: 19 } }] }, { reply: 'Bien sûr ! Vous préférez quel article ?', intent: 'INFO' }]);
    expect(gateway.calls).toHaveLength(2);
    expect(plain(r.output.reply)).toBe('Livraison à Sétif : 650 DA à domicile, 350 DA au bureau. Bien sûr ! Vous préférez quel article ?');
    expect(r.guard).toMatchObject({ violations: [{ rule: 'fee_missing' }], retried: false });
    // the model calls of the turn are kept (time, tools, why another call followed)
    expect(r.steps?.map((s) => [s.calls ?? [], s.next ?? null])).toEqual([[['quote_delivery'], 'tools'], [[], null]]);
    expect(r.steps?.every((s) => typeof s.ms === 'number' && s.ms >= 0)).toBe(true);
  });

  it('N11 T3: lookup_order by the customer’s own phone after an order of this conversation ⇒ looked up by its number (one lookup)', () => {
    const history = 'السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5\nايه\nصحيت. وين راهي الطلبية تاعي؟';
    const placed = [{ name: 'create_order', result: { ok: true, number: 'TEST-4074', simulated: true, total: 8200 }, at: new Date() }];
    const call = { id: 'c1', name: 'lookup_order', args: { phone: '0661234567' } };
    expect(lookupByNumber(call, placed, history).args).toEqual({ orderNumber: 'TEST-4074' });
    // another phone, an order number given, no order placed: the call as sent
    expect(lookupByNumber({ ...call, args: { phone: '0770112233' } }, placed, history)).toEqual({ ...call, args: { phone: '0770112233' } });
    expect(lookupByNumber({ ...call, args: { orderNumber: 'TEST-1' } }, placed, history).args).toEqual({ orderNumber: 'TEST-1' });
    expect(lookupByNumber(call, [], history)).toBe(call);
  });

  it('a search that finds nothing tells the model not to search again (N7 T1 « lunettes de soleil » then « lunettes »)', async () => {
    const reg = new ToolRegistry({ search: async () => [] } as never, {} as never, {} as never, {} as never, {} as never);
    const res = (await reg.execute('search_products', { query: 'lunettes de soleil' }, ctxOf('vous avez des lunettes de soleil ?', []))) as { products: unknown[]; say?: string };
    expect(res.products).toEqual([]);
    expect(res.say).toMatch(/do not search again/u);
  });
});

// --- R18-4 -------------------------------------------------------------------------------------------------------------------------
describe('R18-4 (Cosmetic) — narrow wording fixes', () => {
  it('« tsajjel »-like lines before any recap: the verb goes, a price stays, a line that only echoes the fields goes', () => {
    expect(withoutNotedSteps('Saha Nadia, tsajjel: hijab soie wahed, 1500 DA. Tawsil l Bir El Djir (Oran): 600 DA l dar. T7ebb nwasslouha l dar wela f stop-desk ?')).toBe('Saha Nadia, hijab soie wahed, 1500 DA. Tawsil l Bir El Djir (Oran): 600 DA l dar. T7ebb nwasslouha l dar wela f stop-desk ?');
    expect(withoutNotedSteps("Tsajjelt Amina Saadi, 0698765432, Alger, Bab Ezzouar. Wach howa l'adresse ta3ek ?")).toBe("Wach howa l'adresse ta3ek ?");
    expect(withoutNotedSteps('صحيت يا سميرة، سجلت زوج من Tapis de prière (2800 دج للواحد). واش من ولاية تحب نوصلوهم ليها؟')).toBe('صحيت يا سميرة، زوج من Tapis de prière (2800 دج للواحد). واش من ولاية تحب نوصلوهم ليها؟');
    expect(withoutNotedSteps('صحيت يا نادية، تسجل رقم الهاتف تاعك. واش من ولاية ؟')).toBe('صحيت يا نادية. واش من ولاية ؟');
    // left alone: a question, an order claim (the guard's), a noted price « … est noté pour vous », a plain reply
    for (const t of ['Wach nsajjel la commande ?', 'tsajlet la commande ta3ek.', 'Le hijab soie à 1500 DA est noté pour vous.', 'Merci Karim ! Quelle est votre adresse ?']) expect(withoutNotedSteps(t)).toBe(t);
  });

  it('N4 T2: the customer’s Arabic-script name written in Latin letters after « nom : » ⇒ the customer’s own text; other words stay', () => {
    const history = 'Bonjour, je veux le tapis de prière\nسمير بن علي';
    expect(withCustomerScriptName('Très bien, je note le nom : Samir Ben Ali. Pouvez-vous me donner votre numéro de téléphone ?', history)).toBe('Très bien, je note le nom : سمير بن علي. Pouvez-vous me donner votre numéro de téléphone ?');
    expect(withCustomerScriptName('Merci Samir Ben Ali !', history)).toBe('Merci سمير بن علي !');
    // no name word before it, another name, a Latin-only history: unchanged
    for (const [t, h] of [['Le Tapis De Prière est à 2800 DA.', history], ['Merci Karim Haddad !', history], ['Merci Samir Ben Ali !', 'Samir Ben Ali']] as const) expect(withCustomerScriptName(t, h)).toBe(t);
  });

  it('N16: nothing delivered ⇒ no « if you like, I can help you with another wilaya or show you a product »', () => {
    expect(withoutUnrelatedOffer('Ma nwasslouch l Illizi f had lwaqt, smah lina. Ila t7ebb, nqder n3awnek f wilaya okhra wela nwarrik produit.', 'slm, tawsil l Illizi ?', { deliveryOnly: true, nothingServed: true })).toBe('Ma nwasslouch l Illizi f had lwaqt, smah lina.');
    expect(withoutUnrelatedOffer('Nous ne livrons pas à Illizi. Si vous voulez, je peux vous proposer une autre adresse de livraison.', 'vous livrez à Illizi ?', { deliveryOnly: true, nothingServed: true })).toBe('Nous ne livrons pas à Illizi.');
    // something is delivered: the offer stays
    const t = 'Tawsil l Oran 600 DA. Ila t7ebb, nqder nwarrik produit.';
    expect(withoutUnrelatedOffer(t, 'slm, nheb hijab, ana f Oran', { deliveryOnly: false, nothingServed: false })).toBe(t);
  });

  it('P2 T1: « ideale l » in arabizi ⇒ « mliha l »; French untouched', () => {
    expect(withArabiziWords('Robe kabyle brodée, tissu khfif, ideale l l3rass w lmounasabat.', 'arabizi')).toBe('Robe kabyle brodée, tissu khfif, mliha l l3rass w lmounasabat.');
    expect(withArabiziWords('Idéale pour les fêtes.', 'fr')).toBe('Idéale pour les fêtes.');
  });
});
