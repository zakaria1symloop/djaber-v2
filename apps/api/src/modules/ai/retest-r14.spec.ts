// Journey retest R14 (18/11, docs/audit/journeys-2026-11-16/journeys/R14-ai-orders.md): an arabizi conversation answered in French after
// a field message with French address words (R14-1); « home or stop-desk? » with no fee (R14-2); probe hand-offs and repeated product
// lookups (R14-3); wording (R14-4). Transcripts: .local/qa/journeys/R14/out/transcripts/ (P2, F1b, N9, N11, N5, F1d, N25, W1, F9, N21,
// A3, A3b, N3).
import { prisma } from '@djaber/db';
import { AiRunService, lookupAnswered, type TurnRequest } from './ai-run.service';
import { angerIn, complaintIn, judgeHandoff, messageHandoffReasons, orderStatusAsk } from './handoff-judge';
import { bareYes, conversationLanguage, detectLanguage, turnLanguage, withoutFieldWords } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { handoffLine, modeQuestionAt, substitutionLine, withArabicWords, withArabiziWords, withModeFees } from './reply-fixes';
import { buildGuardFacts, checkReply, enforceReply, quoteFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderConfirmationText, orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, type ToolRegistry } from './tools/tool-registry';

const PLACES = [
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }] },
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

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> = {}): TurnRequest => ({
  runId: 'r',
  prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
  toolCtx: { workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n') },
  temperature: 0.5,
  maxTokens: 500,
  deadline: Date.now() + 30_000,
  persist: false,
  ...o,
});
type FactsProduct = Parameters<typeof buildGuardFacts>[0]['products'][number];
const product = (p: { id: string; name: string }, price: number, stock: number, description: string | null = null): FactsProduct => ({ id: p.id, name: p.name, sku: p.id.slice(-4), price, oldPrice: null, hasVariants: false, variants: [], also: [], description, stock, sellOutOfStock: false, imageUrl: null });
const facts = (customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false, ...o });
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);
const service = (gateway: FakeAiGateway, tools: Partial<Record<keyof ToolRegistry, unknown>>) => new AiRunService(gateway, routing as never, { forcedHandoff: () => null, ...tools } as unknown as ToolRegistry, {} as never, {} as never, {} as never);

// --- R14-1 -------------------------------------------------------------------------------------------------------------------------
describe('R14-1 (Minor) — address words and field labels carry no language; a bare yes is the conversation’s language', () => {
  const P2 = ['salam, nheb la robe kabyle brodée', 'taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5', 'ih'] as const;

  it('P2: T1 arabizi, T2 (field message in French address words) stays arabizi, T3 « ih » stays arabizi — every turn, as the playground reads them', () => {
    expect(turnLanguage(P2[0], undefined)).toBe('arabizi');
    expect(turnLanguage(P2[1], conversationLanguage(P2.slice(0, 1)))).toBe('arabizi');
    expect(turnLanguage(P2[2], conversationLanguage(P2.slice(0, 2)))).toBe('arabizi');
    // the live path: the stored language of the turn before (inbound reads the same way)
    expect(detectLanguage(P2[1], 'arabizi', { neutral: 'previous' })).toBe('arabizi');
    // the cause: the T2 words read alone are French
    expect(detectLanguage(P2[1])).toBe('fr');
    expect(withoutFieldWords(P2[1])).not.toMatch(/taille|des|frères/u);
  });

  it('P2 T2 / T3 server texts: the recap and the confirmation in arabizi (one language decision)', () => {
    const recap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Robe kabyle brodée', variant: 'S', quantity: 1, unitPrice: 4900 }], deliveryFee: 400, total: 5300, clientName: 'Amina Saadi', clientPhone: '0698765432', wilaya: 'Alger', communeName: 'Bab Ezzouar', address: 'rue des frères Bouadou n 5', isStopdesk: false } };
    const lang = turnLanguage(P2[1], conversationLanguage(P2.slice(0, 1)));
    const text = orderRecapText(pendingRecap([{ name: 'create_order', result: recap }])!, lang);
    expect(text).toContain('Hada récap ta3 la commande');
    expect(text).toContain('Adresse: rue des frères Bouadou n 5, Bab Ezzouar, Alger');
    const placed = { ok: true, number: 'TEST-1158', items: [{ name: 'Robe kabyle brodée', variant: 'S', quantity: 1, unitPrice: 4900 }], deliveryFee: 400, total: 5300, etaDays: '2–5' };
    expect(orderConfirmationText([{ name: 'create_order', result: placed }], turnLanguage(P2[2], conversationLanguage(P2.slice(0, 2))))).not.toMatch(/Votre commande|enregistrée/u);
  });

  it('P2 T2 guard: a French model reply to that field message is a language switch (the message itself has no language)', () => {
    const f = facts(P2[1], { lang: 'arabizi' });
    expect(f.messageLang).toBeUndefined();
    expect(checkReply('Merci Amina, je note votre adresse. Je vous prépare le récapitulatif de la commande tout de suite.', f).map((v) => v.rule)).toContain('language_switch');
  });

  it('table: field messages keep every conversation language; a real sentence still switches; a first message is read as before', () => {
    const keep: [string, 'arabizi' | 'en' | 'fr' | 'ar'][] = [
      ['taille S, Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5', 'arabizi'],
      ['Cité des 200 logements, bâtiment 4, Bab Ezzouar', 'arabizi'],
      ['rue de la Liberté n° 12, El Eulma', 'arabizi'],
      ['couleur noire, taille M', 'arabizi'],
      ['résidence les Pins, bloc C, appartement 12', 'en'],
      ['rue des frères Bouadou n 5, Alger', 'en'],
      ['cite 20 aout wla stop desk ?', 'arabizi'],
      ['cité 500 logements bloc 12', 'fr'],
    ];
    for (const [text, lang] of keep) expect([text, turnLanguage(text, lang)]).toEqual([text, lang]);
    const switches: [string, string, string][] = [
      ['Je voudrais changer la couleur, je préfère la noire', 'arabizi', 'fr'],
      ['rue des frères Bouadou n 5, je préfère être livrée au stop-desk svp', 'arabizi', 'fr'],
      ['Could you deliver it to my office instead, please?', 'fr', 'en'],
      ['واش توصلو لسطيف؟', 'fr', 'ar'],
    ];
    for (const [text, prev, lang] of switches) expect([text, turnLanguage(text, prev as never)]).toEqual([text, lang]);
    // a first message is not stripped
    expect(turnLanguage('Bonjour, je voudrais la robe taille S', undefined)).toBe('fr');
  });

  it('a bare yes in any script counts as the conversation’s language', () => {
    for (const yes of ['ih', 'Ih', 'wah', 'ayh', 'iyeh', 'oui', 'ok', 'yes', 'ايه', 'إيه', 'واه', 'ih ih', 'oui oui', 'ايه 👍'])
      for (const prev of ['arabizi', 'fr', 'en', 'ar'] as const) expect([yes, prev, turnLanguage(yes, prev)]).toEqual([yes, prev, prev]);
    expect(bareYes('ih saha')).toBe(false);
    expect(bareYes('oui mais livrez à Alger')).toBe(false);
    // « ih bessah … » with words is read as before (a change in arabizi)
    expect(turnLanguage('ih bessah wasslouha l Oran', 'fr')).toBe('arabizi');
  });
});

// --- R14-2 -------------------------------------------------------------------------------------------------------------------------
describe('R14-2 (Minor) — « home or stop-desk? » always carries both fees', () => {
  const SETIF = { ok: true, wilayaId: 19, wilayaName: 'Sétif', isStopdesk: false, fee: 650, free: false, stopdeskAvailable: true, stopdeskFee: 350, etaDays: '2–5' };
  const F1B_T2 = "Merci Karim, c'est noté : Sétif, El Eulma. Pour la livraison, préférez-vous être livré à domicile (il me faut alors votre rue ou votre cité) ou au stop-desk ?";

  it('modeQuestionAt / withModeFees: the fee sentence goes before the question, in each language; one fee given or no mode asked ⇒ unchanged', () => {
    const q = quoteFacts([{ name: 'quote_delivery', result: SETIF }]);
    expect(modeQuestionAt(F1B_T2)).toBe(1);
    expect(withModeFees(F1B_T2, q, 'fr')).toBe("Merci Karim, c'est noté : Sétif, El Eulma. À domicile : 650 DA, en stop-desk : 350 DA. Pour la livraison, préférez-vous être livré à domicile (il me faut alors votre rue ou votre cité) ou au stop-desk ?");
    expect(withModeFees('Saha Karim. T7ebb nwasslouha l dar wela f stop-desk ?', q, 'arabizi')).toBe('Saha Karim. L dar: 650 DA, f stop-desk: 350 DA. T7ebb nwasslouha l dar wela f stop-desk ?');
    expect(withModeFees('صحيت. تحب التوصيل للدار ولا لنقطة الاستلام ؟', q, 'ar')).toBe('صحيت. للدار: 650 دج، لنقطة الاستلام (stop-desk): 350 دج. تحب التوصيل للدار ولا لنقطة الاستلام ؟');
    expect(withModeFees('Would you like home delivery or a stop-desk?', q, 'en')).toBe('Home delivery: 650 DA, stop-desk: 350 DA. Would you like home delivery or a stop-desk?');
    expect(withModeFees('À domicile 650 DA ou en stop-desk ?', q, 'fr')).toBe('À domicile 650 DA ou en stop-desk ?');
    expect(withModeFees('Quelle est votre adresse ?', q, 'fr')).toBe('Quelle est votre adresse ?');
    expect(withModeFees(F1B_T2, [], 'fr')).toBe(F1B_T2);
    // the server's own address question (create_order refused for the address) offers the stop-desk too
    expect(withModeFees('Quelle est votre adresse (rue, cité, numéro), ou préférez-vous le stop-desk ?', q, 'fr')).toBe('À domicile : 650 DA, en stop-desk : 350 DA. Quelle est votre adresse (rue, cité, numéro), ou préférez-vous le stop-desk ?');
    expect(withModeFees("A3tini l'adresse ta3ek (rue, cité, numéro ta3 dar), wela t7ebb stop-desk ?", q, 'arabizi')).toBe("L dar: 650 DA, f stop-desk: 350 DA. A3tini l'adresse ta3ek (rue, cité, numéro ta3 dar), wela t7ebb stop-desk ?");
  });

  it('F1b T2 turn « Sétif, El Eulma »: no quote_delivery by the model ⇒ the server quotes Sétif, the reply gives both fees, no corrective turn', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: F1B_T2, intent: 'SALE' });
    const execute = jest.fn(async (name: string) => (name === 'quote_delivery' ? SETIF : null));
    const svc = service(gateway, { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.quote_delivery], execute });
    const r = await svc.turn(turnReq('Sétif, El Eulma', ['Je cherche le sac à main cuir marron, 1 seul. Karim Haddad 0770112233'], { guard: facts('Sétif, El Eulma') }));
    if (!r.ok) throw new Error('turn failed');
    expect(execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 19 }, expect.anything());
    expect(r.output.reply).toContain('À domicile : 650 DA, en stop-desk : 350 DA. Pour la livraison, préférez-vous');
    expect(gateway.calls).toHaveLength(1);
    expect(r.guard).toBeUndefined();
  });

  it('the wilaya named earlier is quoted (commune-only message); no wilaya named ⇒ nothing is quoted; a reply asking no mode ⇒ nothing is quoted', async () => {
    const run = async (text: string, history: string[], reply: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply, intent: 'SALE' });
      const execute = jest.fn(async () => SETIF);
      const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.quote_delivery], execute }).turn(turnReq(text, history, { guard: facts(text, { lang: 'arabizi' }) }));
      if (!r.ok) throw new Error('turn failed');
      return { r, execute };
    };
    const a = await run('El Eulma', ['nheb sac a main cuir, Karim 0770112233', 'Sétif'], 'Saha. T7ebb nwasslouha l dar wela f stop-desk ?');
    expect(a.execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 19 }, expect.anything());
    expect(a.r.output.reply).toContain('L dar: 650 DA, f stop-desk: 350 DA.');
    const none = await run('Karim Haddad', ['nheb sac a main cuir'], 'Saha Karim. T7ebb l dar wela f stop-desk ?');
    expect(none.execute).not.toHaveBeenCalled();
    // journey retest R15-1 (18/11): the address question after a place with no quote of it yet is quoted too (both fees, stop-desk offered)
    const ask = await run('Sétif, El Eulma', ['nheb sac a main cuir, Karim 0770112233'], "A3tini l'adresse ta3ek (rue, cité) ?");
    expect(ask.execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 19 }, expect.anything());
    expect(ask.r.output.reply).toBe("Tawsil: 650 DA l dar, wela 350 DA f stop-desk ila t7ebb. A3tini l'adresse ta3ek (rue, cité) ?");
    // a reply asking no mode and no address, about no product ⇒ nothing is quoted
    const other = await run('Sétif, El Eulma', ['nheb sac a main cuir, Karim 0770112233'], 'Saha Karim, wach smitek kamla ?');
    expect(other.execute).not.toHaveBeenCalled();
  });
});

// --- R14-3 -------------------------------------------------------------------------------------------------------------------------
describe('R14-3 (Minor) — no probe hand-offs; no lookup the search already answered', () => {
  const REASONS = ['customer_request', 'refund', 'complaint', 'angry', 'off_catalogue'];
  const phone = (t: string) => /0[567]\d{8}/.test(t);
  const N9 = 'Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ?';
  const N11 = 'صحيت. وين راهي الطلبية تاعي؟ وقتاش توصلني وكاش رقم باش نتبعها؟';

  it('table: probe messages carry no reason; real complaints, anger and person requests keep theirs (offered and accepted)', () => {
    for (const text of [N9, N11, 'Bonjour, je veux 1 hijab soie', 'vous avez la robe en M ?', 'où est ma commande ?', 'win rahi la commande ta3i ?'])
      expect([text, messageHandoffReasons(REASONS, text, phone)]).toEqual([text, []]);
    const real: [string, string, string][] = [
      ['complaint', "Le colis n'est jamais arrivé, ça fait 3 semaines !", "Le colis n'est jamais arrivé"],
      ['complaint', "J'ai reçu la robe déchirée", 'la robe déchirée'],
      ['complaint', 'la montre ne marche pas', 'ne marche pas'],
      ['complaint', 'ma wseltnich la commande, hadi 10 ayam', 'ma wseltnich la commande'],
      ['complaint', 'الطلبية ماوصلتنيش، هادي 15 يوم', 'الطلبية ماوصلتنيش'],
      ['complaint', 'the bag arrived broken', 'arrived broken'],
      ['complaint', "c'est une arnaque votre boutique", "c'est une arnaque"],
      ['angry', 'vous êtes des voleurs', 'vous êtes des voleurs'],
      ['angry', "C'EST INADMISSIBLE, VOUS ÊTES OÙ ???", 'INADMISSIBLE'],
      ['angry', 'wesh had lkhedma, ma wsletch!!', 'ma wsletch'],
      ['angry', 'نصابين، ما وصلتني والو', 'نصابين'],
      ['customer_request', 'je veux parler à un conseiller', 'parler à un conseiller'],
      ['customer_request', 'bghit nhder m3a bnadem', 'nhder m3a bnadem'],
      ['customer_request', 'عيطولي من فضلكم', 'عيطولي'],
      ['customer_request', 'please call me', 'call me'],
    ];
    for (const [reason, text, evidence] of real) {
      expect([text, messageHandoffReasons(REASONS, text, phone)]).toEqual([text, expect.arrayContaining([reason])]);
      expect([text, judgeHandoff({ reason, evidence, customerText: text })]).toEqual([text, { ok: true, reason }]);
    }
    expect(complaintIn('Merci, tout est parfait')).toBe(false);
    expect(angerIn('Merci beaucoup !')).toBe(false);
    expect(angerIn('Commande CMD-1001 TEST-4074')).toBe(false);
    expect(orderStatusAsk(N11)).toBe(true);
  });

  it('the judge refuses complaint / angry without their words (N9 T1 evidence « unused » or the message quoted)', () => {
    expect(judgeHandoff({ reason: 'complaint', evidence: 'le tissu, les tailles', customerText: N9 })).toEqual({ ok: false, reason: 'complaint', why: 'reason_mismatch' });
    expect(judgeHandoff({ reason: 'angry', evidence: 'وين راهي الطلبية تاعي', customerText: N11 })).toEqual({ ok: false, reason: 'angry', why: 'reason_mismatch' });
    expect(judgeHandoff({ reason: 'customer_request', evidence: N11, customerText: N11 })).toMatchObject({ ok: false, why: 'reason_mismatch' });
  });

  const ROBE = { id: '01a1e51f-419b-7c1c-8091-4d764e9a48ee', name: 'Robe kabyle brodée' };
  const ROBE_FOUND = { products: [{ ...ROBE, sku: 'PRD-GHF3V2NC', price: 4900, stock: 'in stock', hasVariants: true, variants: [{ id: 'v-s', name: 'S', price: 4900, stock: 'in stock' }, { id: 'v-l', name: 'L', price: 4900, stock: 'out of stock' }], imageUrl: null }] };

  it('N9 T1 turn: search_products then get_product of the same robe (listed in the CATALOGUE) ⇒ get_product is not run; handoff_to_human is not offered', async () => {
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      { toolCalls: [{ name: 'search_products', args: { query: 'Robe kabyle brodée', limit: 1 } }, { name: 'get_product', args: { productId: ROBE.id } }] },
      { reply: 'Ma 3andnach tsawer ta3 had la robe f had lwaqt. Lmqasat li kaynin: S w M b 4900 DA. Wach men taille t7ebb ?', intent: 'SALE' },
    );
    const execute = jest.fn(async (name: string) => (name === 'search_products' ? ROBE_FOUND : { ok: true }));
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.get_product, TOOL_DEFS.handoff_to_human], execute }).turn(
      turnReq(N9, [], { guard: facts(N9, { lang: 'arabizi', products: [product(ROBE, 4900, 5, 'Robe kabyle brodée à la main, tissu léger.')] }) }),
    );
    if (!r.ok) throw new Error('turn failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.tools.map((t) => t.name)).toEqual(['search_products']);
    expect(offered(gateway)).not.toContain('handoff_to_human');
  });

  it('N11 T3 turn: a tracking question ⇒ lookup_order offered, handoff_to_human not', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'طلبيتك TEST-4074 مازالت ما خرجتش.', intent: 'TRACKING' });
    await service(gateway, { defsFor: async () => [TOOL_DEFS.lookup_order, TOOL_DEFS.handoff_to_human], execute: jest.fn() }).turn(turnReq(N11, ['السلام، نحب جلابة رجالي، سمير بن علي 0661234567', 'ايه']));
    expect(offered(gateway)).toContain('lookup_order');
    expect(offered(gateway)).not.toContain('handoff_to_human');
  });

  it('lookupAnswered: get_product after a search (listed / not listed), check_availability of 1 unit, next to create_order; other calls still run', () => {
    const searched = [{ name: 'search_products', result: ROBE_FOUND }];
    expect(lookupAnswered({ name: 'get_product', args: { productId: ROBE.id } }, searched, [ROBE.id])).toMatchObject({ id: ROBE.id, repeated: true });
    expect(lookupAnswered({ name: 'get_product', args: { productId: ROBE.id } }, searched, [])).toBeNull();
    expect(lookupAnswered({ name: 'get_product', args: { productId: ROBE.id } }, [{ name: 'get_product', result: { id: ROBE.id, name: ROBE.name, description: 'x' } }], [])).toMatchObject({ repeated: true, description: 'x' });
    expect(lookupAnswered({ name: 'get_product', args: { productId: 'other' } }, searched, [ROBE.id])).toBeNull();
    // F1d T1: Marron « in stock » in the search ⇒ no check for 1 unit; 2 units or an out-of-stock read still decide on the tool
    expect(lookupAnswered({ name: 'check_availability', args: { productId: ROBE.id, variantId: 'v-s', quantity: 1 } }, searched)).toMatchObject({ available: true, fromSearch: true });
    expect(lookupAnswered({ name: 'check_availability', args: { productId: ROBE.id, variantId: 'v-l', quantity: 1 } }, searched)).toMatchObject({ available: false });
    expect(lookupAnswered({ name: 'check_availability', args: { productId: ROBE.id, variantId: 'v-s', quantity: 2 } }, searched)).toBeNull();
    expect(lookupAnswered({ name: 'check_availability', args: { productId: ROBE.id, quantity: 1 } }, searched)).toBeNull();
    // A3 T1: no search this turn ⇒ the check runs
    expect(lookupAnswered({ name: 'check_availability', args: { productId: ROBE.id, quantity: 2 } }, [])).toBeNull();
    // N25 T2: create_order of the same step checks the stock itself
    const step = [{ name: 'check_availability', args: { productId: 'hijab', quantity: 2 } }, { name: 'create_order', args: { items: [{ productId: 'hijab', quantity: 2 }] } }];
    expect(lookupAnswered(step[0]!, [], [], step)).toMatchObject({ inOrder: true });
    expect(lookupAnswered({ name: 'search_products', args: { query: 'robe' } }, searched, [ROBE.id])).toBeNull();
  });

  it('N25 T2 turn: check_availability + create_order in one step ⇒ only create_order runs', async () => {
    const gateway = new FakeAiGateway();
    const create = { clientName: 'نادية قاسي', items: [{ productId: 'hijab', quantity: 2 }] };
    gateway.script('reply', { toolCalls: [{ name: 'check_availability', args: { productId: 'hijab', quantity: 2 } }, { name: 'create_order', args: create }] }, { reply: '', intent: 'SALE' });
    const execute = jest.fn(async () => ({ ok: false, error: { code: 'VALIDATION', field: 'clientPhone', missing: true } }));
    await service(gateway, { defsFor: async () => [TOOL_DEFS.check_availability, TOOL_DEFS.create_order], execute }).turn(turnReq('ايه بصح ديرلي جوج ماشي واحد', ['نادية قاسي 0661234568، البليدة، بوفاريك، حي الورود رقم 12']));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('create_order', create, expect.anything());
  });
});

// --- R14-4 -------------------------------------------------------------------------------------------------------------------------
describe('R14-4 (Cosmetic) — wording', () => {
  it('F9 closing « T7ebb nwarrik produit ? » ⇒ « T7ebb nwarrik wach kayen 3andna ? »', () => {
    expect(withArabiziWords('Illizi : makach tawsil l Illizi f had lwaqt. T7ebb nwarrik produit ?', 'arabizi')).toBe('Illizi : makach tawsil l Illizi f had lwaqt. T7ebb nwarrik wach kayen 3andna ?');
    expect(withArabiziWords('T7ebb nwarrik produit m3a l livraison ?', 'arabizi')).toBe('T7ebb nwarrik wach kayen 3andna ?');
  });

  it('N5 T3: the substitute line names both products with an article', () => {
    expect(substitutionLine([{ name: 'Coffret cadeau Aïd' }], "Bonjour, le parfum oud c'est combien ?\nBon finalement je le prends", ['Parfum Oud 50 ml'], '', 'fr')).toBe(
      "Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd.",
    );
  });

  it('W1 T1 turn: an accepted hand-off with no text ⇒ one short sentence of the server before the system line', async () => {
    const text = 'Bonjour, prix de gros pour 50 pièces du hijab soie ?';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: '', status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: 'prix de gros pour 50 pièces du hijab soie ?', intent: 'OTHER' });
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.handoff_to_human], execute: jest.fn(), soldProductNamed: async () => 'Hijab soie' }).turn(turnReq(text, [], { guard: facts(text) }));
    if (!r.ok) throw new Error('turn failed');
    expect(r.output.status).toBe('HANDOFF');
    expect(r.output.reply).toBe("Merci pour votre message : l'équipe de la boutique va vous répondre.");
    expect(handoffLine('ar')).toBe('شكرا على رسالتك، فريق المحل راح يجاوبك.');
    expect(handoffLine('arabizi')).toContain("l'équipe ta3 lboutique");
  });

  it('N21 T1: the guard stripped the only question ⇒ the pending question is added (the name on a wish, else « do you want it? »)', () => {
    const reply = 'أهل\u064bا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر 1500 دج (بدل 2000 دج). تحب نأكدلك الطلبية ؟';
    const f = { ...facts('سلام، نحب حجاب حرير', { lang: 'ar' }), noRecapPending: true };
    expect(enforceReply(reply, [{ rule: 'confirm_without_recap', sentence: 2 }], f, { hasCards: true }).reply).toBe('أهل\u064bا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، بسعر 1500 دج (بدل 2000 دج). واش سميتك ؟');
    const ask = { ...facts('Vous avez le hijab soie ?'), noRecapPending: true };
    expect(enforceReply('Oui, le Hijab soie est à 1500 DA. Je vous le confirme ?', [{ rule: 'confirm_without_recap', sentence: 1 }], ask, { hasCards: true }).reply).toBe('Oui, le Hijab soie est à 1500 DA. Souhaitez-vous passer commande ?');
    // a question left ⇒ nothing added
    expect(enforceReply('Le Hijab soie est à 1500 DA. Quel est votre nom ? Je vous le confirme ?', [{ rule: 'confirm_without_recap', sentence: 2 }], ask, { hasCards: true }).reply).toBe('Le Hijab soie est à 1500 DA. Quel est votre nom ?');
  });

  it('Standard Arabic / odd forms in darija (A3 T1, A3b T1) and French inside arabizi (N9 T1, N3 T2)', () => {
    expect(withArabicWords('صحيت سميرة، الكمية 2 من Tapis de prière، 2800 دج للواحد، والمنتج متوفر. واش من ولاية تحب نوصلوهم ليها؟', 'ar')).toBe('صحيت سميرة، زوج Tapis de prière، 2800 دج للواحد، وراهو متوفر. واش من ولاية تحب نوصلوهم ليها؟');
    expect(withArabicWords('صحيت يا سميرة، تسجل زوج تابيس الصلاة (2800 دج للقطعة).', 'ar')).toBe('صحيت يا سميرة، تسجل زوج سجادات الصلاة (2800 دج للقطعة).');
    expect(withArabiziWords('Ma 3andnach tsawer, bessah hiya brodée à la main, b qmach khfif, et mnasba bezzaf lel fêtes.', 'arabizi')).toBe('Ma 3andnach tsawer, bessah hiya mtarza b lyedd, b qmach khfif, w mnasba bezzaf l l3rass w lmounasabat.');
    expect(withArabiziWords('Ih, nwasslou l Constantine. Tawsil l dar 700 DA, 2 à 5 jours.', 'arabizi')).toBe('Ih, nwasslou l Constantine. Tawsil l dar 700 DA, 2 l 5 ayam.');
    expect(withArabiziWords('Robe kabyle brodée, 2 à 5 jours.', 'fr')).toBe('Robe kabyle brodée, 2 à 5 jours.');
  });
});
