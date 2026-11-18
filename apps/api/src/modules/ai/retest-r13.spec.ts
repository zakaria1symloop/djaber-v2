// Journey retest R13 (18/11, docs/audit/journeys-2026-11-16/journeys/R13-ai-orders.md): a hand-off « off_catalogue » for a product the
// shop sells (R13-1); the wilaya and commune glued to the street with no separator (R13-2); the customer's Arabic street translated
// into French (R13-3); probe / redundant tool calls (R13-4); a substitute's recap with no word of the change (R13-5); wording (R13-6).
// Transcripts: .local/qa/journeys/R13/out/transcripts/ (F1, A3, N18b, F1b, F3, F6, N5, F9, N18, A2, A4, N9).
import { prisma } from '@djaber/db';
import { AiRunService, noAddressYet, recapAnswered, type TurnRequest } from './ai-run.service';
import { handoffRefusedInstruction, judgeHandoff, messageHandoffReasons } from './handoff-judge';
import { productNamedIn, productWanted } from './product-named';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { substitutionLine, withArabicWords, withArabiziWords, withBothFees } from './reply-fixes';
import { buildGuardFacts, quoteFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import type { OrderCallHistory } from './tools/order-confirmation';
import { orderRecapText, pendingRecap, withoutPlaceSegments } from './tools/order-confirmation-text';
import { buildPlaceIndex, resetPlaceIndex, wilayaIn } from './tools/place-index';
import { customerOwnStreet, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }, { nameFr: 'Ain Smara', nameAr: 'عين سمارة' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
  // « El Main » (Bordj Bou Arreridj): its bare « main » was found in « sac à main » (R13-4)
  { id: 34, nameFr: 'Bordj Bou Arreridj', nameAr: 'برج بوعريريج', communes: [{ nameFr: 'El Main', nameAr: 'الماين' }] },
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

/** The J03 / J04 catalogues of the transcripts (ids of F1 / N5). */
const SAC = { id: '01a1e54f-a0b9-7ae5-8971-96c0cc39d155', name: 'Sac à main cuir', keywords: [] as string[] };
const TAPIS = { id: '01a1e54f-a31d-7828-899f-644c5988a750', name: 'Tapis de prière', keywords: [] as string[] };
const DJELLABA = { id: '01a1e51f-djellaba', name: 'Djellaba homme', keywords: ['جلابة'] };
const HIJAB = { id: '01a1e51f-hijab', name: 'Hijab soie', keywords: ['حجاب'] };
const OUD = { id: '01a1e51f-4533-77e7-80dc-89bcd5528c00', name: 'Parfum Oud 50 ml', keywords: [] as string[] };
const COFFRET = { id: '01a1e51f-48c7-7916-8119-8895e76e3400', name: 'Coffret cadeau Aïd', keywords: [] as string[] };
const SHOP = [SAC, TAPIS, DJELLABA, HIJAB, OUD, COFFRET];

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> & { orderHistory?: OrderCallHistory } = {}): TurnRequest => {
  const { orderHistory, ...rest } = o;
  return {
    runId: 'r',
    prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
    toolCtx: { workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), ...(orderHistory ? { orderHistory } : {}) },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    ...rest,
  };
};
type FactsProduct = Parameters<typeof buildGuardFacts>[0]['products'][number];
const product = (p: { id: string; name: string }, price: number, stock: number): FactsProduct => ({ id: p.id, name: p.name, sku: p.id.slice(-4), price, oldPrice: null, hasVariants: false, variants: [], also: [], description: null, stock, sellOutOfStock: false, imageUrl: null });
const facts = (customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: false, freshStart: false, ...o });
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);
/** The catalogue of the shop, as the tools read it (search, ids, the R13-1 catalogue check). */
const catalogueStub = () => ({
  search: async () => [{ ...SAC, sku: 'PRD-6WNTCKD9', price: 6900, oldPrice: null, hasVariants: true, variants: [{ id: 'noir', name: 'Noir', price: 6900, stock: 3 }, { id: 'marron', name: 'Marron', price: 6900, stock: 2 }], stock: 5, sellOutOfStock: false, imageUrl: null, category: 'Mode J03', description: null, also: [] }],
  productNamed: async (_a: unknown, text: string) => productNamedIn(text, SHOP),
});
const registryWith = (catalogue: Record<string, unknown>) => new ToolRegistry(catalogue as never, {} as never, { enabledFor: async () => false } as never, {} as never, {} as never);

// --- R13-1 -------------------------------------------------------------------------------------------------------------------------
describe('R13-1 (Major) — off_catalogue only when the shop sells nothing the message names; never under a reply that sells', () => {
  /** The same wish for a sold product in every phrasing and language a customer uses. */
  const WANTS: [string, string, (typeof SHOP)[number]][] = [
    ['fr', 'Je voudrais le sac à main cuir marron', SAC],
    ['fr', 'je veux le sac à main cuir', SAC],
    ['fr', "J'aimerais un tapis de prière svp", TAPIS],
    ['fr', 'Je prends 2 tapis de prière', TAPIS],
    ['fr', 'Vous avez le sac à main en cuir ?', SAC],
    ['fr', 'Je cherche un sac à main cuir marron', SAC],
    ['fr', 'Donnez-moi le coffret cadeau', COFFRET],
    ['en', 'I want the leather bag… the sac à main cuir', SAC],
    ["en", "I'd like a djellaba homme", DJELLABA],
    ['arabizi', 'nheb sac a main cuir marron', SAC],
    ['arabizi', 'n7eb zoudj tapis de prière', TAPIS],
    ['arabizi', 'bghit djellaba homme', DJELLABA],
    ['arabizi', '3andkom hijab soie ?', HIJAB],
    ['ar', 'نحب حجاب حرير', HIJAB],
    ['ar', 'بغيت جلابة رجالي', DJELLABA],
    ['ar', 'السلام عليكم، حاب نشري جلابة', DJELLABA],
    ['ar', 'عندكم حجاب ؟', HIJAB],
  ];

  it('productWanted: every phrasing of a wish, any punctuation — and the messages that are none', () => {
    for (const [lang, text] of WANTS.filter(([, t]) => !/vous avez|3andkom|عندكم|je cherche/iu.test(t))) expect([lang, text, productWanted(text)]).toEqual([lang, text, true]);
    for (const text of ['Sétif, El Eulma', 'oui', 'Karim Haddad 0770112233', 'où est ma commande ?', 'وين راهي الطلبية تاعي؟', 'Cité 500 logements bloc 12', 'merci beaucoup']) expect([text, productWanted(text)]).toEqual([text, false]);
  });

  it('productNamedIn: the catalogue product each message names (first word, two words, an Arabic keyword) — and none for what the shop does not sell', () => {
    for (const [lang, text, p] of WANTS) expect([lang, text, productNamedIn(text, SHOP)?.name]).toEqual([lang, text, p.name]);
    for (const text of ['vous avez des lunettes de soleil ?', 'un porte-monnaie en cuir', 'Sétif, El Eulma', 'Karim Haddad 0770112233', 'oui', 'je veux parler à un conseiller', 'نحب نظارات شمسية']) expect([text, productNamedIn(text, SHOP)]).toEqual([text, null]);
    expect(productNamedIn('des sacs en cuir', SHOP)?.name).toBe('Sac à main cuir');
  });

  it('table: off_catalogue on a message naming a sold product is refused (in_catalogue) in every phrasing × language; a wish for a product not sold is not_sold', () => {
    for (const [lang, text, p] of WANTS) {
      const v = judgeHandoff({ reason: 'off_catalogue', evidence: text, customerText: text, soldNamed: p.name });
      expect([lang, text, v]).toEqual([lang, text, { ok: false, reason: 'off_catalogue', why: 'in_catalogue' }]);
    }
    for (const text of ['Je voudrais des lunettes de soleil', 'nheb lunettes', 'بغيت نظارات', 'I want sunglasses']) expect([text, judgeHandoff({ reason: 'off_catalogue', evidence: text, customerText: text })]).toEqual([text, { ok: false, reason: 'off_catalogue', why: 'not_sold' }]);
    // what only the team can quote stays a handoff, a product of the shop or not
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'prix de gros pour 50 sacs', customerText: 'Vous avez des prix de gros pour 50 sacs ?', soldNamed: 'Sac à main cuir' })).toEqual({ ok: true, reason: 'off_catalogue' });
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'une robe sur mesure', customerText: 'Je voudrais une robe sur mesure pour un mariage' })).toEqual({ ok: true, reason: 'off_catalogue' });
    // other reasons are not touched by the catalogue check
    expect(judgeHandoff({ reason: 'customer_request', evidence: 'parler à un conseiller', customerText: 'Je veux le sac, mais je veux parler à un conseiller', soldNamed: 'Sac à main cuir' })).toEqual({ ok: true, reason: 'customer_request' });
    expect(handoffRefusedInstruction('in_catalogue', 'Sac à main cuir')).toContain('« Sac à main cuir »');
  });

  it('messageHandoffReasons: off_catalogue is not offered on a wish nor on a message naming a CATALOGUE product', () => {
    const all = ['customer_request', 'refund', 'complaint', 'angry', 'off_catalogue'];
    const names = SHOP.map((p) => p.name.toLowerCase());
    const phone = () => false;
    for (const [, text] of WANTS) expect([text, messageHandoffReasons(all, text, phone, names)]).not.toContainEqual([text, expect.arrayContaining(['off_catalogue'])]);
    expect(messageHandoffReasons(all, 'le sac à main cuir marron', phone, names)).not.toContain('off_catalogue');
    expect(messageHandoffReasons(all, 'Vous faites des prix pour les revendeurs ?', phone, names)).toContain('off_catalogue');
  });

  it('F1 T1: the tool `handoff_to_human { off_catalogue, evidence « Je voudrais le sac à main cuir marron » }` is refused by the catalogue check', async () => {
    const reg = registryWith(catalogueStub());
    const ctx: ToolRunContext = { workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: 'Je voudrais le sac à main cuir marron' };
    const args = { reason: 'off_catalogue', evidence: 'Je voudrais le sac à main cuir marron' };
    const r = (await reg.execute('handoff_to_human', args, ctx)) as { ok: boolean; error?: { code: string; why: string }; instruction?: string };
    expect(r).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', why: 'in_catalogue' } });
    expect(r.instruction).toContain('Sac à main cuir');
    expect(reg.forcedHandoff('handoff_to_human', args, r)).toBeNull();
    // the catalogue cannot be read: the phrasing rule still refuses it
    const blind = registryWith({ productNamed: async () => Promise.reject(new Error('db')) });
    expect(await blind.execute('handoff_to_human', args, ctx)).toMatchObject({ ok: false, error: { why: 'not_sold' } });
  });

  it('F1 T1 turn (search_products + handoff_to_human off_catalogue, then the sale): no handoff, status OK; off_catalogue not even offered', async () => {
    const text = 'Je voudrais le sac à main cuir marron';
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      { toolCalls: [{ name: 'search_products', args: { query: 'Sac à main cuir', limit: 1 } }, { name: 'handoff_to_human', args: { reason: 'off_catalogue', evidence: text } }] },
      { reply: 'Parfait ! Le Sac à main cuir en couleur Marron est disponible à 6900 DA. Voulez-vous le commander ?', intent: 'SALE', productCards: [SAC.id] },
    );
    const r = await new AiRunService(gateway, routing as never, registryWith(catalogueStub()), {} as never, {} as never, {} as never).turn(turnReq(text, [], { guard: facts(text, { products: [product(SAC, 6900, 5)] }) }));
    if (!r.ok) throw new Error('turn failed');
    expect(r.forcedHandoff).toBeNull();
    expect(r.output.status).toBe('OK');
    expect(r.tools.find((t) => t.name === 'handoff_to_human')?.result).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', why: 'in_catalogue' } });
    const def = gateway.calls[0]!.tools!.find((t) => t.name === 'handoff_to_human');
    expect(JSON.stringify(def?.parameters ?? {})).not.toContain('off_catalogue');
  });

  it('the last word: a judged handoff (off_catalogue / unclear_streak) under a reply that sells — cards or a product found this turn — is dropped; a customer request is not', async () => {
    const text = 'le sac à main cuir marron svp';
    const run = async (step: Record<string, unknown>, catalogue = { ...catalogueStub(), productNamed: async () => null }) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Sac à main cuir' } }, { name: 'handoff_to_human', args: step.handoff as Record<string, unknown> }] }, step.answer as never);
      const r = await new AiRunService(gateway, routing as never, registryWith(catalogue), {} as never, {} as never, {} as never).turn(turnReq(text, [], { guard: facts(text) }));
      if (!r.ok) throw new Error('turn failed');
      return r;
    };
    // the catalogue check could not name it (no row matched) and the judge accepted: the sale still keeps the conversation
    const sold = await run({ handoff: { reason: 'off_catalogue', evidence: text }, answer: { reply: 'Le Sac à main cuir Marron est disponible à 6900 DA.', intent: 'SALE' } });
    expect(sold.forcedHandoff).toBeNull();
    const asked = await run({ handoff: { reason: 'customer_request', evidence: 'un conseiller' }, answer: { reply: 'Le Sac à main cuir est à 6900 DA, je vous passe un conseiller.', intent: 'SALE', productCards: [SAC.id] } });
    expect(asked.forcedHandoff).toBeNull(); // « le sac … svp » asks for no person: the judge refuses customer_request
    // status = HANDOFF { off_catalogue } with the product card ⇒ OK
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Le Sac à main cuir est à 6900 DA.', status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: text, intent: 'SALE', productCards: [SAC.id] }, { reply: 'Le Sac à main cuir est à 6900 DA.', status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: text, intent: 'SALE', productCards: [SAC.id] });
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], forcedHandoff: () => null, execute: jest.fn(), soldProductNamed: async () => null } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, [], { guard: facts(text) }));
    if (!r.ok) throw new Error('turn failed');
    expect(r.output.status).toBe('OK');
  });
});

// --- R13-2 -------------------------------------------------------------------------------------------------------------------------
describe('R13-2 (Minor) — the street never holds the wilaya / commune names, wherever they stand, any separator or none', () => {
  const C = PLACES[1]!;
  const NAMES = [C.nameFr, C.nameAr, 'الخروب', 'El Khroub', 'الخروب'];

  it('table: wilaya + commune before, after or around the street, in both scripts, with each mark or no separator', () => {
    const streets = ['حي 1000 مسكن عمارة 5', 'cité 1000 logements bloc 5'];
    for (const street of streets)
      for (const m of ['', '،', ',', '؛', ' -', ';'])
        for (const [w, c] of [[C.nameAr, 'الخروب'], [C.nameFr, 'El Khroub'], [C.nameAr, 'El Khroub'], [C.nameFr, 'الخروب']] as const)
          for (const address of [`${street}${m} ${w} ${c}`, `${w} ${c}${m} ${street}`, `${w}${m} ${c}${m} ${street}`, `${street}${m} ${c}${m} ${w}`, `${c} ${street} ${w}`]) expect([address, withoutPlaceSegments(address, NAMES)]).toEqual([address, street]);
  });

  it('the small words that lead a name go with it; a name that is part of a street name stays; nothing is emptied', () => {
    expect(withoutPlaceSegments('Cité 500 logements bloc 12 à El Eulma, Sétif', ['El Eulma', 'Sétif', 'العلمة', 'سطيف'])).toBe('Cité 500 logements bloc 12');
    expect(withoutPlaceSegments('wilaya de Sétif El Eulma cité 500 logements bloc 12', ['El Eulma', 'Sétif'])).toBe('cité 500 logements bloc 12');
    expect(withoutPlaceSegments('ولاية قسنطينة الخروب حي 1000 مسكن', NAMES)).toBe('حي 1000 مسكن');
    expect(withoutPlaceSegments('Rue de Boufarik', ['Boufarik', 'Blida'])).toBe('Rue de Boufarik');
    expect(withoutPlaceSegments('شارع الجزائر رقم 4', ['Alger', 'الجزائر', 'Bab Ezzouar'])).toBe('شارع الجزائر رقم 4');
    expect(withoutPlaceSegments('Boufarik, Blida', ['Boufarik', 'Blida'])).toBe('Boufarik');
    expect(withoutPlaceSegments('Cité 1000 logements - bloc 5', ['El Khroub', 'Constantine'])).toBe('Cité 1000 logements - bloc 5');
  });

  const registry = (place: (typeof PLACES)[number], item: { id: string; name: string; price: number }, fee: number) => {
    const reg = new ToolRegistry({ byIds: async () => [{ ...item, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false }] } as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: place.id, code: String(place.id).padStart(2, '0'), nameFr: place.nameFr, nameAr: place.nameAr, communes: place.communes } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(reg as unknown as { quote: () => Promise<Record<string, unknown>> }, 'quote').mockResolvedValue({ ok: true, wilayaId: place.id, wilayaName: place.nameFr, fee, free: false });
    return reg;
  };
  const ctx = (history: string[], orderHistory: OrderCallHistory = []): ToolRunContext => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: history.at(-1)!, customerHistory: history.join('\n'), orderHistory, ordering: true });
  const A3 = ['السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦', 'قسنطينة الخروب حي 1000 مسكن عمارة 5'];
  const A3_CALL = { clientName: 'سميرة بن علي', clientPhone: '0550123456', wilayaId: 25, communeName: 'الخروب', address: 'حي 1000 مسكن عمارة 5، قسنطينة الخروب', isStopdesk: false, items: [{ productId: TAPIS.id, quantity: 2 }], customerConfirmed: true };

  it('A3 T2 `address « حي 1000 مسكن عمارة 5، قسنطينة الخروب »` ⇒ recap « حي 1000 مسكن عمارة 5، الخروب، قسنطينة »; T3 « ايه » ⇒ the order keeps that street', async () => {
    const reg = registry(C, { id: TAPIS.id, name: TAPIS.name, price: 2800 }, 700);
    const r = await reg.prepareOrder(A3_CALL, ctx(A3));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { total: 6300, address: 'حي 1000 مسكن عمارة 5' } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'ar')).toContain('العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة');
    const shown: OrderCallHistory = [{ name: 'create_order', at: new Date(Date.now() - 60_000), result }];
    const yes = await reg.prepareOrder(A3_CALL, ctx([...A3, 'ايه'], shown));
    expect(yes).toMatchObject({ ok: true, request: { address: 'حي 1000 مسكن عمارة 5', communeName: 'الخروب' } });
  });

  // --- R13-3 ---------------------------------------------------------------------------------------------------------------------
  const N18 = ['السلام عليكم، نحب نشري جلابة رجالي', 'Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5'];
  it('R13-3 customerOwnStreet: the model’s translation is replaced by the customer’s words; the customer’s own street is kept', () => {
    expect(customerOwnStreet('Cité 1000 logements, immeuble 5', N18.join('\n'), NAMES)).toBe('حي 1000 مسكن عمارة 5');
    expect(customerOwnStreet('حي 1000 مسكن عمارة 5', N18.join('\n'), NAMES)).toBeNull();
    expect(customerOwnStreet('Cité 500 logements bloc 12', 'Je voudrais le sac\nKarim Haddad\n0770112233, Sétif, El Eulma, Cité 500 logements bloc 12', ['Sétif', 'El Eulma'])).toBeNull();
    expect(customerOwnStreet('Cité 20 Août, villa 3', 'nheb tapis\n0770112244, Blida, Boufarik, cite 20 aout villa 3', ['Blida', 'Boufarik'])).toBeNull();
    // other numbers: another address, not a translation
    expect(customerOwnStreet('Cité 200 logements, immeuble 9', N18.join('\n'), NAMES)).toBeNull();
    // Latin customer street, Arabic model street; numbers just before the address word
    expect(customerOwnStreet('حي 1000 مسكن عمارة 5', 'Samira 0661234567, Constantine, El Khroub, 1000 logements bloc 5', NAMES)).toBe('1000 logements bloc 5');
  });

  it('R13-3 N18b T2 `address « Cité 1000 logements, immeuble 5 »` ⇒ the recap and the stored order read « حي 1000 مسكن عمارة 5 »', async () => {
    const reg = registry(C, { id: DJELLABA.id, name: DJELLABA.name, price: 7500 }, 700);
    const args = { clientName: 'Samir Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'El Khroub', address: 'Cité 1000 logements, immeuble 5', isStopdesk: false, items: [{ productId: DJELLABA.id, quantity: 1 }], customerConfirmed: true };
    const r = await reg.prepareOrder(args, ctx(N18));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { total: 8200, address: 'حي 1000 مسكن عمارة 5' }, draftOrder: { address: 'حي 1000 مسكن عمارة 5' } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'ar')).toContain('العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة');
  });
});

// --- R13-4 -------------------------------------------------------------------------------------------------------------------------
describe('R13-4 (Minor) — probes withheld: a search after the recap, a lookup on a product message, create_order before the wilaya', () => {
  const recap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Tapis de prière', variant: null, quantity: 2, unitPrice: 2800 }], deliveryFee: 700, total: 6300, clientName: 'سميرة بن علي', clientPhone: '0550123456', wilaya: 'Constantine', wilayaAr: 'قسنطينة', communeName: 'الخروب', communeAr: 'الخروب', address: 'حي 1000 مسكن عمارة 5', isStopdesk: false }, draftOrder: { items: [{ productId: TAPIS.id, variantId: null, quantity: 2 }] } };
  const executed = [{ name: 'create_order', args: { items: [{ productId: TAPIS.id, quantity: 2 }] }, result: recap }];

  it('recapAnswered: search_products / check_availability for the recap’s product are answered without running; another product still runs', () => {
    expect(recapAnswered({ name: 'search_products', args: { query: 'Tapis de prière', limit: 1 } }, executed)).toMatchObject({ products: [], inRecap: true });
    expect(recapAnswered({ name: 'search_products', args: { query: 'tapis' } }, executed)).toMatchObject({ inRecap: true });
    expect(recapAnswered({ name: 'check_availability', args: { productId: TAPIS.id, quantity: 2 } }, executed)).toMatchObject({ inRecap: true });
    expect(recapAnswered({ name: 'search_products', args: { query: 'Djellaba homme' } }, executed)).toBeNull();
    expect(recapAnswered({ name: 'search_products', args: { query: 'Tapis de prière' } }, [])).toBeNull();
    expect(recapAnswered({ name: 'quote_delivery', args: { wilayaId: 25 } }, executed)).toBeNull();
  });

  it('A3 T2 turn: create_order (recap) then search_products in the same step ⇒ only create_order runs', async () => {
    const text = 'قسنطينة الخروب حي 1000 مسكن عمارة 5';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'سميرة بن علي' } }, { name: 'search_products', args: { query: 'Tapis de prière', limit: 1 } }] }, { reply: '', intent: 'SALE' });
    const execute = jest.fn(async () => recap);
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.search_products], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, ['السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦'], { guard: facts(text, { lang: 'ar' }) }));
    if (!r.ok) throw new Error('turn failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.tools.map((t) => t.name)).toEqual(['create_order']);
    expect(r.output.reply).toContain('العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة');
  });

  it('F3 T1 « nheb nechri zoudj tapis de prière »: lookup_order is not offered; a question about an order keeps it', async () => {
    const run = async (text: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Zoudj tapis de prière kayen.', intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.lookup_order, TOOL_DEFS.search_products], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, []));
      return offered(gateway);
    };
    expect(await run('nheb nechri zoudj tapis de prière')).not.toContain('lookup_order');
    expect(await run('Bonjour, je veux le tapis de prière')).not.toContain('lookup_order');
    expect(await run('nheb na3ref win rahi la commande ta3i')).toContain('lookup_order');
    expect(await run('وين راهي الطلبية تاعي؟')).toContain('lookup_order');
  });

  it('F1b T1: « sac à main » names no commune « El Main » any more ⇒ create_order is not offered before a wilaya; « El Main » with its article still is a place', async () => {
    const idx = buildPlaceIndex(WILAYAS, COMMUNES);
    expect(wilayaIn(idx, 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233')).toBeNull();
    expect(wilayaIn(idx, 'ana f El Main, cité 20 logements')?.id).toBe(34);
    expect(wilayaIn(idx, 'Khroub, cité 1000')?.id).toBe(25);
    const text = 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Dans quelle wilaya souhaitez-vous être livré ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.search_products], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, []));
    expect(offered(gateway)).not.toContain('create_order');
  });

  it('F1b T2 « Sétif, El Eulma » after T1’s refused probe: a refused create_order says nothing of an address ⇒ create_order is not offered', async () => {
    const refused: OrderCallHistory = [{ name: 'create_order', at: new Date(Date.now() - 60_000), result: { ok: false, error: { code: 'VALIDATION', field: 'wilayaId', missing: true } } }];
    const shown: OrderCallHistory = [{ name: 'create_order', at: new Date(Date.now() - 60_000), result: recap }];
    expect(noAddressYet({ customerHistory: 'Je voudrais le sac\nSétif, El Eulma', orderHistory: refused })).toBe(true);
    expect(noAddressYet({ customerHistory: 'Je voudrais le sac\nSétif, El Eulma', orderHistory: shown })).toBe(false);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Donnez-moi votre adresse.', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Sétif, El Eulma', ['Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233'], { orderHistory: refused }));
    expect(offered(gateway)).not.toContain('create_order');
  });
});

// --- R13-5 -------------------------------------------------------------------------------------------------------------------------
describe('R13-5 (Minor) — the recap of a substitute says first that it replaces the unavailable product', () => {
  const N5 = ["Bonjour, le parfum oud c'est combien ?", 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'];
  const items = [{ name: 'Coffret cadeau Aïd' }];

  it('substitutionLine: in the customer’s language; none when the customer named the substitute, when the reply names the product, or with no stock problem', () => {
    expect(substitutionLine(items, N5.join('\n'), ['Parfum Oud 50 ml'], '', 'fr')).toBe("Parfum Oud 50 ml n'est pas disponible pour le moment : ce récapitulatif est pour Coffret cadeau Aïd à la place.");
    expect(substitutionLine(items, 'salam, ch7al parfum oud ?\nih nakhdou', ['Parfum Oud 50 ml'], '', 'arabizi')).toBe('Parfum Oud 50 ml makach drok, had récap fih Coffret cadeau Aïd f blastou.');
    expect(substitutionLine(items, 'شحال Parfum Oud ؟\nايه نديه', ['Parfum Oud 50 ml'], '', 'ar')).toBe('Parfum Oud 50 ml ماهوش متوفر درك، هذا الملخص فيه Coffret cadeau Aïd في بلاصتو.');
    expect(substitutionLine(items, `${N5[0]}\nOk je prends le coffret cadeau. Karim Haddad 0770112233`, ['Parfum Oud 50 ml'], '', 'fr')).toBeNull();
    expect(substitutionLine(items, N5.join('\n'), ['Parfum Oud 50 ml'], 'Le Parfum Oud est épuisé.', 'fr')).toBeNull();
    expect(substitutionLine(items, N5.join('\n'), [], '', 'fr')).toBeNull();
    expect(substitutionLine([{ name: 'Parfum Oud 50 ml' }], N5.join('\n'), ['Parfum Oud 50 ml'], '', 'fr')).toBeNull();
  });

  it('N5 T2 turn: check_availability (Oud false, Coffret true), create_order (Coffret recap) ⇒ the server line, then the recap', async () => {
    const text = N5[1]!;
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad' } }] }, { reply: '', intent: 'SALE' });
    const coffretRecap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Coffret cadeau Aïd', variant: null, quantity: 1, unitPrice: 24990 }], deliveryFee: 0, total: 24990, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Oran', communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', isStopdesk: false } };
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn(async () => coffretRecap) } as unknown as ToolRegistry;
    const g = facts(text, { products: [product(OUD, 9500, 0), product(COFFRET, 24990, 5)] });
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, [N5[0]!], { guard: g }));
    if (!r.ok) throw new Error('turn failed');
    expect(r.output.reply.startsWith("Parfum Oud 50 ml n'est pas disponible pour le moment : ce récapitulatif est pour Coffret cadeau Aïd à la place.\n\nVoici le récapitulatif de votre commande")).toBe(true);
  });
});

// --- R13-6 -------------------------------------------------------------------------------------------------------------------------
describe('R13-6 (Cosmetic) — both fees, darija words, arabizi closing', () => {
  const setif = quoteFacts([{ name: 'quote_delivery', result: { ok: true, wilayaName: 'Sétif', isStopdesk: false, fee: 650, free: false, stopdeskAvailable: true, stopdeskFee: 350 } }]);
  const oranDesk = quoteFacts([{ name: 'quote_delivery', result: { ok: true, wilayaName: 'Oran', isStopdesk: true, fee: 400, free: false, stopdeskAvailable: true, stopdeskFee: 400 } }]);

  it('withBothFees: F1b T2 gets the home fee before the stop-desk sentence; a home-only answer gets the stop-desk; both given / stop-desk quote ⇒ unchanged', () => {
    const f1b = 'Parfait Karim, je note le Sac à main cuir Marron (1 pièce). Pour la livraison à domicile à El Eulma, donnez-moi votre adresse (rue, cité ou repère). Sinon, on peut aussi la livrer en stop-desk à 350 DA.';
    expect(withBothFees(f1b, setif, 'fr')).toBe('Parfait Karim, je note le Sac à main cuir Marron (1 pièce). Pour la livraison à domicile à El Eulma, donnez-moi votre adresse (rue, cité ou repère). La livraison à domicile est à 650 DA. Sinon, on peut aussi la livrer en stop-desk à 350 DA.');
    expect(withBothFees('Ih, nwasslou l Sétif: 650 DA l dar. Wach smitek ?', setif, 'arabizi')).toBe('Ih, nwasslou l Sétif: 650 DA l dar. Wela f stop-desk b 350 DA. Wach smitek ?');
    expect(withBothFees('التوصيل لسطيف ب\u0640 650 دج.', setif, 'ar')).toBe('التوصيل لسطيف ب\u0640 650 دج. ولا لنقطة الاستلام (stop-desk) ب\u0640 350 دج.');
    const f9 = 'Sétif: 650 DA l dar, wela 350 DA f stop-desk, ywasel f 2 l 5 ayam. Oran stop-desk: 400 DA, ywasel f 2 l 5 ayam.';
    expect(withBothFees(f9, [...setif, ...oranDesk], 'arabizi')).toBe(f9);
    expect(withBothFees('Merci Karim ! Votre numéro ?', setif, 'fr')).toBe('Merci Karim ! Votre numéro ?');
  });

  it('withArabicWords: « taille unique », « نعم », « نوصلوها لها » in Arabic-script answers only', () => {
    expect(withArabicWords('وعليكم السلام، أهلًا بيك! عندنا جلابة رجالي بيج من صوف رقيق، مقاسها واحد (taille unique)، ثمنها 7500 دج بدل 9000 دج. تحب نسجّلوهالك؟', 'ar')).toBe('وعليكم السلام، أهلًا بيك! عندنا جلابة رجالي بيج من صوف رقيق، مقاسها واحد، ثمنها 7500 دج بدل 9000 دج. تحب نسجّلوهالك؟');
    expect(withArabicWords('صحيت، سجلت لك Djellaba homme وحدة (بيج، taille unique) بسعر 7500 دج. واش من ولاية تحب نوصلوها لها ؟', 'ar')).toBe('صحيت، سجلت لك Djellaba homme وحدة (بيج، مقاس واحد) بسعر 7500 دج. واش من ولاية تحب نوصلوهالك ؟');
    expect(withArabicWords('وعليكم السلام، نعم، Sac à main cuir باللون Marron متوفر ب\u0640 6900 دج.', 'ar')).toBe('وعليكم السلام، إيه، Sac à main cuir باللون Marron متوفر ب\u0640 6900 دج.');
    expect(withArabicWords('Djellaba homme, taille unique.', 'fr')).toBe('Djellaba homme, taille unique.');
    expect(withArabicWords('نعمة', 'ar')).toBe('نعمة');
  });

  it('arabizi: « Tailles li kayn » ⇒ « Lmqasat li kaynin », the F9 closing', () => {
    expect(withArabiziWords('Tailles li kayn: S w M b 4900 DA, w XL b 5200 DA.', 'arabizi')).toBe('Lmqasat li kaynin: S w M b 4900 DA, w XL b 5200 DA.');
    expect(withArabiziWords('Couleurs li kaynin: Noir w Marron.', 'arabizi')).toBe('Lalwan li kaynin: Noir w Marron.');
    expect(withArabiziWords('Illizi: makach tawsil l Illizi f had lwaqt. T7ebb nwarrik produit m3a l livraison ?', 'arabizi')).toBe('Illizi: makach tawsil l Illizi f had lwaqt. T7ebb nwarrik wach kayen 3andna ?');
    expect(withArabiziWords('Tailles li kayn: S', 'fr')).toBe('Tailles li kayn: S');
  });
});
