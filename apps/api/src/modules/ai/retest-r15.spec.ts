// Journey retest R15 (18/11, docs/audit/journeys-2026-11-16/journeys/R15-ai-orders.md): a place given with no quote yet ⇒ the street asked with
// no price, no fee, no stop-desk (R15-1, F5 T1 on the shared link); hand-off turns with an empty / generic AI text and « très vite » next to
// « équipe absente » (R15-2, H1 / H2 / C1 / C2); redundant lookups (R15-3, F1b T2, N16 T1, N4 T1); wording (R15-4, N5 T1, F5 T3, F3 T4, P2 T1,
// F5 T1, F3 T1). Transcripts: .local/qa/journeys/R15/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, lookupAnswered, quoteAnswered, type TurnRequest } from './ai-run.service';
import { bareYes, moroccanIn, turnLanguage, wrongDarijaIn } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { handoffKind, handoffReply, handoffSystemLineShown, priceAsked, withArabiziWords, withAskedPrice, withoutQuickReply, withPlaceFacts } from './reply-fixes';
import { buildGuardFacts, quoteFacts, quotedWilayasIn } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { resetPlaceIndex } from './tools/place-index';
import { customerOwnStreet, TOOL_DEFS, type ToolRegistry } from './tools/tool-registry';

const PLACES = [
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
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

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> = {}, agent: unknown = AGENT): TurnRequest => ({
  runId: 'r',
  prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
  toolCtx: { workspaceId: 'w', agent: agent as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n') },
  temperature: 0.5,
  maxTokens: 500,
  deadline: Date.now() + 30_000,
  persist: false,
  ...o,
});
type FactsInput = Parameters<typeof buildGuardFacts>[0];
const ROBE = { id: '01a1e51f-419b-7c1c-8091-4d764e9a48ee', name: 'Robe kabyle brodée', sku: 'PRD-GHF3V2NC', price: 4900, oldPrice: null, hasVariants: true, also: [], description: 'Robe kabyle brodée à la main, tissu léger.', stock: 14, sellOutOfStock: false, imageUrl: null, variants: [{ id: 'v-s', name: 'S', price: 4900, stock: 5 }, { id: 'v-m', name: 'M', price: 4900, stock: 5 }, { id: 'v-l', name: 'L', price: 4900, stock: 0 }, { id: 'v-xl', name: 'XL', price: 5200, stock: 4 }] };
const OUD = { id: 'oud', name: 'Parfum Oud 50 ml', sku: 'PRD-OUD', price: 3200, oldPrice: null, hasVariants: false, also: [], description: 'Parfum oriental.', stock: 0, sellOutOfStock: false, imageUrl: null, variants: [] };
const COFFRET = { id: 'coffret', name: 'Coffret cadeau Aïd', sku: 'PRD-CAD', price: 24990, oldPrice: null, hasVariants: false, also: [], description: 'Parfum, chocolat et carte personnalisée.', stock: 6, sellOutOfStock: false, imageUrl: null, variants: [] };
const TAPIS = { id: '01a1e54f-a31d-7828-899f-644c5988a750', name: 'Tapis de prière', sku: 'PRD-P79ZN7AT', price: 2800, oldPrice: null, hasVariants: false, also: [], description: 'Tapis de prière molletonné, 120 x 70 cm.', stock: 30, sellOutOfStock: false, imageUrl: null, variants: [] };
const facts = (customerText: string, o: Partial<FactsInput> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [ROBE, OUD, COFFRET, TAPIS] as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: false, freshStart: false, ...o });
const service = (gateway: FakeAiGateway, tools: Partial<Record<keyof ToolRegistry, unknown>>) => new AiRunService(gateway, routing as never, { forcedHandoff: () => null, ...tools } as unknown as ToolRegistry, {} as never, {} as never, {} as never);
const ALGER = { ok: true, wilayaId: 16, wilayaName: 'Alger', wilayaNameAr: 'الجزائر', isStopdesk: false, fee: 400, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 250, etaDays: '2–5' };
const SETIF = { ok: true, wilayaId: 19, wilayaName: 'Sétif', wilayaNameAr: 'سطيف', isStopdesk: false, fee: 650, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 350, etaDays: '2–5' };
const ILLIZI = { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: 33, wilayaName: 'Illizi', stopdeskAvailable: false } };

// --- R15-1 -------------------------------------------------------------------------------------------------------------------------
describe('R15-1 (Minor) — a place given with no quote yet: the reply carries the product’s price and both fees, the stop-desk offered', () => {
  const F5_T1 = 'Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar';
  const F5_T1_REPLY = "Salam Amina, rani ndir lek la robe kabyle brodée taille M. Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ?";
  const run = async (text: string, history: string[], reply: string, f: Partial<FactsInput> = {}, cart?: unknown) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', cart ? { object: { reply, status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 0.9, cart } } : { reply, intent: 'SALE' });
    const execute = jest.fn(async (name: string, args: { wilayaId?: number }) => (name === 'quote_delivery' ? (args.wilayaId === 19 ? SETIF : args.wilayaId === 33 ? ILLIZI : ALGER) : null));
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.quote_delivery, TOOL_DEFS.search_products], execute }).turn(turnReq(text, history, { guard: facts(text, { lang: 'arabizi', ...f }) }));
    if (!r.ok) throw new Error('turn failed');
    return { r, execute, gateway };
  };

  it('F5 T1 (shared link): no quote_delivery by the model ⇒ the server quotes Alger; price, both fees and the stop-desk come before the street question', async () => {
    const { r, execute, gateway } = await run(F5_T1, [], F5_T1_REPLY);
    expect(execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 16 }, expect.anything());
    expect(r.output.reply).toBe("Salam Amina, 3andna la robe kabyle brodée taille M. Robe kabyle brodée (M) b 4900 DA. Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité, bâtiment wela blassa ma3roufa 9rib) ?");
    // the server's quote is no delivery question: no corrective model turn for a fee
    expect(gateway.calls).toHaveLength(1);
    expect(r.guard).toBeUndefined();
    expect(moroccanIn(r.output.reply) || wrongDarijaIn(r.output.reply)).toBe(false);
  });

  it('the variant the message names gives the price; a product whose variants differ in price and none named gives none', async () => {
    const xl = await run('je veux la robe kabyle en XL, Alger, Bab Ezzouar', [], 'Wach howa l’adresse ta3ek ?');
    expect(xl.r.output.reply).toContain('Robe kabyle brodée (XL) b 5200 DA.');
    const none = await run('je veux la robe kabyle, Alger, Bab Ezzouar', [], 'Wach howa l’adresse ta3ek ?');
    expect(none.r.output.reply).toBe('Tawsil: 400 DA l dar, wela 250 DA f stop-desk ila t7ebb. Wach howa l’adresse ta3ek ?');
  });

  it('the wilaya already quoted in an earlier turn, no place in the message, a fee already given, a not-served wilaya ⇒ nothing added', async () => {
    const before = await run(F5_T1, [], F5_T1_REPLY, { earlierToolResults: [ALGER] });
    expect(before.execute).not.toHaveBeenCalled();
    // journey retest R17-1: no fee added (quoted earlier), the product the message names still gets its price before the address question
    expect(before.r.output.reply).not.toMatch(/400 DA/u);
    expect(before.r.output.reply).toContain('Robe kabyle brodée (M) b 4900 DA. Wach howa');
    const noPlace = await run('Amina Saadi', ['nheb la robe kabyle taille M'], 'Saha Amina, a3tini numéro ta3ek ?');
    expect(noPlace.execute).not.toHaveBeenCalled();
    const given = await run(F5_T1, [], 'Robe kabyle brodée (M) b 4900 DA, tawsil l Bab Ezzouar 400 DA. Wach howa l’adresse ta3ek ?');
    expect(given.r.output.reply).toBe('Robe kabyle brodée (M) b 4900 DA, tawsil l Bab Ezzouar 400 DA. Wela f stop-desk b 250 DA. Wach howa l’adresse ta3ek ?');
    const illizi = await run('slm, nheb la robe kabyle taille M, ana f Illizi', [], 'Wach howa l’adresse ta3ek ?');
    expect(illizi.execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 33 }, expect.anything());
    expect(illizi.r.output.reply).toBe('Wach howa l’adresse ta3ek ?');
  });

  it('withPlaceFacts in each language; free home delivery; no stop-desk; no question ⇒ at the end; « home or stop-desk? » is left to withModeFees', () => {
    const q = quoteFacts([{ name: 'quote_delivery', result: ALGER }]);
    const robe = { name: 'Robe kabyle brodée', variant: 'M', price: 4900 };
    expect(withPlaceFacts('Merci Amina. Quelle est votre adresse (rue, cité) ?', q, robe, 'fr')).toBe('Merci Amina. Robe kabyle brodée (M) : 4900 DA. Livraison : 400 DA à domicile, ou 250 DA en stop-desk si vous préférez. Quelle est votre adresse (rue, cité) ?');
    expect(withPlaceFacts('شكرا. واش هو العنوان تاعك ؟', q, robe, 'ar')).toBe('شكرا. Robe kabyle brodée (M) ب\u0640 4900 دج. التوصيل: 400 دج للدار، ولا 250 دج لنقطة الاستلام (stop-desk) إذا تحب. واش هو العنوان تاعك ؟');
    expect(withPlaceFacts('Thanks. What is your address?', q, null, 'en')).toBe('Thanks. Delivery: 400 DA to your door, or 250 DA at a stop-desk if you prefer. What is your address?');
    expect(withPlaceFacts('Merci Amina.', q, null, 'fr')).toBe('Merci Amina. Livraison : 400 DA à domicile, ou 250 DA en stop-desk si vous préférez.');
    const free = quoteFacts([{ name: 'quote_delivery', result: { ...ALGER, fee: 0, free: true, stopdeskAvailable: false, stopdeskFee: null } }]);
    expect(withPlaceFacts('Quelle est votre adresse ?', free, null, 'fr')).toBe('Livraison à domicile : gratuite. Quelle est votre adresse ?');
    // R12 F5 T1: the address question and its stop-desk alternative stay together, the fees before them; a street word quoted back asks nothing
    // (journey retest R16-4: the reply offers the stop-desk itself ⇒ the fees only, the stop-desk offered once)
    expect(withPlaceFacts("Salam Amina ! Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité) ? Wela t7ebb nwasslouha f stop-desk ?", q, null, 'arabizi')).toBe("Salam Amina ! L dar: 400 DA, f stop-desk: 250 DA. Wach howa l'adresse ta3ek f Bab Ezzouar (rue, cité) ? Wela t7ebb nwasslouha f stop-desk ?");
    const mode = 'Vous préférez être livré à domicile ou en stop-desk ?';
    expect(withPlaceFacts(mode, q, null, 'fr')).toBe(mode);
    expect(withPlaceFacts('Le prix est de 4900 DA, livraison 400 DA. Votre adresse ?', q, robe, 'fr')).toBe('Le prix est de 4900 DA, livraison 400 DA. Votre adresse ?');
  });

  it('quotedWilayasIn: a served quote, a not-served refusal; a recap or a search is no quote', () => {
    expect(quotedWilayasIn([ALGER, ILLIZI, { products: [] }, { ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recap: { wilayaId: 19 } }])).toEqual([16, 33]);
    expect(facts('x', { earlierToolResults: [SETIF] }).quotedWilayas).toEqual([19]);
    expect(facts('x').quotedWilayas).toBeUndefined();
  });
});

// --- R15-2 -------------------------------------------------------------------------------------------------------------------------
describe('R15-2 (Cosmetic) — one hand-off sentence per reason, in the customer’s language and script; out of hours, the opening-hours wording', () => {
  const H1 = "Bonjour, je veux parler à quelqu'un";
  const H2 = 'السلام، نحب نهدر مع واحد من الفريق تاعكم';
  const C1 = "Bonjour, j'ai reçu ma commande cassée, je veux un remboursement";
  const C2 = 'salam, wsaltni la commande mkassra, nheb tredouli drahmi';
  const W1 = 'Bonjour, prix de gros pour 50 pièces du hijab soie ?';
  const handed = async (text: string, out: { reply: string; statusDetail: string; evidence: string }, f: Partial<FactsInput>, agent: unknown = AGENT) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { intent: 'OTHER', status: 'HANDOFF', ...out });
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.handoff_to_human], execute: jest.fn() }).turn(turnReq(text, [], { guard: facts(text, f) }, agent));
    if (!r.ok) throw new Error('turn failed');
    return r.output.reply;
  };

  it('H1 (fr, in hours): a request for a person ⇒ the server’s sentence, never an empty text — the model’s own « je vous passe » is not sent', async () => {
    expect(await handed(H1, { reply: '', statusDetail: 'customer_request', evidence: "parler à quelqu'un" }, { lang: 'fr' })).toBe("Bien sûr, je vous mets en relation avec l'équipe de la boutique.");
    expect(await handed(H1, { reply: 'Je vous passe un conseiller tout de suite.', statusDetail: 'customer_request', evidence: "parler à quelqu'un" }, { lang: 'fr' })).toBe("Bien sûr, je vous mets en relation avec l'équipe de la boutique.");
  });

  it('H2 (Arabic script, out of hours): the opening-hours sentence in darija, no « قريبا »', async () => {
    const reply = await handed(H2, { reply: '', statusDetail: 'customer_request', evidence: 'نحب نهدر مع واحد من الفريق' }, { lang: 'ar', outOfHours: true });
    expect(reply).toBe('أكيد، فريق المحل ماهوش متوفر درك، راح يجاوبك كي نفتحو.');
    expect(reply).not.toMatch(/قريب/u);
  });

  it('C1 (fr, out of hours, refund): the refund sentence at the opening, never « très vite »; the model’s « très vite » sentence is dropped', async () => {
    expect(await handed(C1, { reply: '', statusDetail: 'refund', evidence: 'je veux un remboursement' }, { lang: 'fr', outOfHours: true })).toBe("Désolé pour ce problème : l'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture.");
    expect(await handed(C1, { reply: "Je suis désolé pour votre commande cassée. L'équipe vous répondra très vite.", statusDetail: 'refund', evidence: 'je veux un remboursement' }, { lang: 'fr', outOfHours: true })).toBe(
      "Je suis désolé pour votre commande cassée. L'équipe de la boutique est absente pour le moment, elle verra le remboursement avec vous dès l'ouverture.",
    );
    // in hours the model's sentence is kept as it is (the shop's line follows)
    expect(await handed(C1, { reply: 'Je suis désolé pour votre commande cassée.', statusDetail: 'refund', evidence: 'je veux un remboursement' }, { lang: 'fr' })).toBe('Je suis désolé pour votre commande cassée.');
  });

  it('C2 (arabizi, darija shop): the shop’s line would be in Arabic script ⇒ not shown, the model’s arabizi sentence is followed by the arabizi one', async () => {
    const darija = { ...(AGENT as object), defaultLanguage: 'darija' };
    const reply = await handed(C2, { reply: 'Wa 3alaykom salam, sme7li 3la had lmochkil.', statusDetail: 'refund', evidence: 'nheb tredouli drahmi' }, { lang: 'arabizi' }, darija);
    expect(reply).toBe("Wa 3alaykom salam, sme7li 3la had lmochkil. L'équipe ta3 lboutique rah tchouf m3ak le remboursement.");
    expect(reply).not.toMatch(/[\u0600-\u06ff]/u);
    expect(await handed(C2, { reply: '', statusDetail: 'refund', evidence: 'nheb tredouli drahmi' }, { lang: 'arabizi' }, darija)).toBe("Sme7li 3la had lmochkil, l'équipe ta3 lboutique rah tchouf m3ak le remboursement.");
    expect(handoffSystemLineShown('arabizi', false, 'ar')).toBe(false);
    expect(handoffSystemLineShown('arabizi', false, 'fr')).toBe(true);
    expect(handoffSystemLineShown('fr', true, 'fr')).toBe(false);
    expect(handoffSystemLineShown('fr', false, 'fr')).toBe(true);
  });

  it('W1 (wholesale) gets the wholesale sentence (R16-2), any other team request the R14 one; every reason × language × hours is one short sentence, arabizi in Latin letters, no Moroccan form', async () => {
    expect(await handed(W1, { reply: '', statusDetail: 'off_catalogue', evidence: 'prix de gros' }, { lang: 'fr' })).toBe("Pour le prix de gros, l'équipe de la boutique va vous répondre.");
    expect(handoffReply('other', 'fr')).toBe("Merci pour votre message : l'équipe de la boutique va vous répondre.");
    for (const reason of ['customer_request', 'keyword', 'refund', 'complaint', 'angry', 'off_catalogue', 'other', 'order_limits'])
      for (const lang of ['fr', 'ar', 'arabizi', 'en'] as const)
        for (const outOfHours of [false, true]) {
          const s = handoffReply(reason, lang, { outOfHours });
          expect([reason, lang, outOfHours, s.split(/[.!?؟]\s/u).length]).toEqual([reason, lang, outOfHours, 1]);
          if (lang === 'arabizi') expect([s, /[\u0600-\u06ff]/u.test(s) || moroccanIn(s) || wrongDarijaIn(s)]).toEqual([s, false]);
          if (lang === 'ar') expect([s, moroccanIn(s) || wrongDarijaIn(s)]).toEqual([s, false]);
          if (outOfHours) expect([s, /vite|shortly|right away|(?<!as )soon(?! as)|قريب/u.test(s)]).toEqual([s, false]);
        }
    expect(['customer_request', 'keyword', 'refund', 'complaint', 'angry', 'off_catalogue', 'other'].map((r) => handoffKind(r))).toEqual(['person', 'person', 'refund', 'complaint', 'complaint', 'team', 'team']);
    expect(withoutQuickReply('Désolé. Un conseiller vous répondra très vite.')).toBe('Désolé.');
  });
});

// --- R15-3 -------------------------------------------------------------------------------------------------------------------------
describe('R15-3 (Minor) — no second quote of a wilaya quoted in the turn; no get_product of a CATALOGUE product', () => {
  it('quoteAnswered: F1b T2 stop-desk after the home quote, N16 T1 a second quote of a wilaya not served; other calls run', () => {
    const sHome = [{ name: 'quote_delivery', result: SETIF }];
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 19, isStopdesk: true } }, sHome)).toMatchObject({ ok: true, isStopdesk: true, fee: 350, repeated: true });
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaName: 'Sétif', isStopdesk: true } }, sHome)).toMatchObject({ fee: 350, repeated: true });
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 33, isStopdesk: true } }, [{ name: 'quote_delivery', result: ILLIZI }])).toMatchObject({ error: { code: 'WILAYA_NOT_SERVED' }, repeated: true });
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 19, isStopdesk: true } }, [{ name: 'quote_delivery', result: { ...SETIF, stopdeskAvailable: false, stopdeskFee: null } }])).toMatchObject({ error: { code: 'WILAYA_NOT_SERVED', homeAvailable: true } });
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 16 } }, sHome)).toBeNull();
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 19, subtotal: 9000 } }, sHome)).toBeNull();
    expect(quoteAnswered({ name: 'quote_delivery', args: { wilayaId: 19 } }, [{ name: 'quote_delivery', result: { ...SETIF, isStopdesk: true, fee: 350 } }])).toBeNull();
  });

  it('F1b T2 / N16 T1 turns: the second quote_delivery is answered from the first, it runs once', async () => {
    for (const [text, id, result] of [['Sétif, El Eulma', 19, SETIF], ['slm, tawsil l Illizi ?', 33, ILLIZI]] as const) {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaId: id } }] }, { toolCalls: [{ name: 'quote_delivery', args: { wilayaId: id, isStopdesk: true } }] }, { reply: id === 19 ? '650 DA à domicile ou 350 DA en stop-desk. Vous préférez ?' : 'Ma nwasslouch l Illizi, sme7li.', intent: 'INFO' });
      const execute = jest.fn(async () => result);
      const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.quote_delivery], execute }).turn(turnReq(text, ['Je cherche le sac, Karim 0770112233'], { guard: facts(text) }));
      if (!r.ok) throw new Error('turn failed');
      expect([text, execute.mock.calls.length]).toEqual([text, 1]);
    }
  });

  it('N4 T1: get_product of the tapis listed in the CATALOGUE, with no search this turn ⇒ not run; a photo request or a product not listed still runs it', () => {
    expect(lookupAnswered({ name: 'get_product', args: { productId: TAPIS.id } }, [], [TAPIS.id], [], true)).toMatchObject({ id: TAPIS.id, inCatalogue: true });
    expect(lookupAnswered({ name: 'get_product', args: { productId: TAPIS.id } }, [], [TAPIS.id], [], false)).toBeNull();
    expect(lookupAnswered({ name: 'get_product', args: { productId: 'other' } }, [], [TAPIS.id], [], true)).toBeNull();
  });
});

// --- R15-4 -------------------------------------------------------------------------------------------------------------------------
describe('R15-4 (Cosmetic) — narrow wording fixes', () => {
  const unavailable = [{ id: OUD.id, name: OUD.name, price: OUD.price, variants: [] }];
  it('N5 T1: the asked price of the out-of-stock Parfum Oud is given with « pas disponible »; no price asked or the price given ⇒ unchanged', () => {
    const reply = 'Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous cherchez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA.';
    expect(withAskedPrice(reply, "Bonjour, le parfum oud c'est combien ?", unavailable, 'fr')).toBe(
      "Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est disponible à 24990 DA.",
    );
    expect(withAskedPrice('Ma 3andnach Parfum Oud 50 ml dork.', 'ch7al parfum oud ?', unavailable, 'arabizi')).toBe('Parfum Oud 50 ml b 3200 DA, bessah makach dork.');
    expect(withAskedPrice(reply, 'Bonjour, vous avez le parfum oud ?', unavailable, 'fr')).toBe(reply);
    expect(withAskedPrice('Parfum Oud 50 ml (3200 DA) est en rupture.', 'le parfum oud c’est combien ?', unavailable, 'fr')).toBe('Parfum Oud 50 ml (3200 DA) est en rupture.');
    expect(priceAsked('بشحال العطر ؟')).toBe(true);
    // R11 / R12 N5 T1: the opening greeting of the replaced sentence stays
    expect(withAskedPrice('Bonjour 👋 Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Ça vous intéresse ?', "le parfum oud c'est combien ?", unavailable, 'fr')).toBe("Bonjour 👋 Parfum Oud 50 ml est à 3200 DA, mais ce produit n'est pas disponible pour le moment. Ça vous intéresse ?");
  });

  it('F5 T3: « oui c’est bon » after an arabizi recap keeps arabizi; in a French chat French; darija words still say arabizi', () => {
    expect(turnLanguage("oui c'est bon", 'arabizi')).toBe('arabizi');
    expect(turnLanguage("oui c'est bon", 'fr')).toBe('fr');
    expect(turnLanguage('ok merci', 'arabizi')).toBe('arabizi');
    expect(bareYes("oui c'est bon")).toBe(true);
    expect(bareYes('ih saha')).toBe(false);
    expect(bareYes("c'est bon")).toBe(false);
    expect(turnLanguage('oui mais livrez à Alger svp', 'arabizi')).toBe('fr');
  });

  it('F3 T4: the street kept as the customer typed it (no comma or accent added); a capital letter alone changes nothing', () => {
    expect(customerOwnStreet('Cité 20 Août, villa 3', 'nheb tapis\nsmiti وليد بوزيد\n0770112244\nBlida, Boufarik, cite 20 aout villa 3', ['Blida', 'Boufarik'])).toBe('cite 20 aout villa 3');
    expect(customerOwnStreet('Cité 1000 logements bloc 4', 'Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4', ['Oran', 'Bir El Djir'])).toBeNull();
    expect(customerOwnStreet('Cité 500 logements bloc 12', 'Cité 500 logements bloc 12', [])).toBeNull();
  });

  it('French left in arabizi: P2 T1, F5 T1, F3 T1', () => {
    expect(withArabiziWords('Robe kabyle brodée b lyedd, qmach khfif, parfaite pour l3rass w lmounasabat. Lmqasat li kaynin sont S et M a 4900 DA, et XL a 5200 DA (la L makach dork).', 'arabizi')).toBe(
      'Robe kabyle brodée b lyedd, qmach khfif, mliha l l3rass w lmounasabat. Lmqasat li kaynin homa S w M b 4900 DA, w XL b 5200 DA (la L makach dork).',
    );
    expect(withArabiziWords('Salam Amina, rani ndir lek la robe kabyle brodée taille M.', 'arabizi')).toBe('Salam Amina, 3andna la robe kabyle brodée taille M.');
    expect(withArabiziWords('Rani ndirlek la commande.', 'arabizi')).toBe('Rani ndirlek la commande.');
    expect(withArabiziWords('Wach smitek ? Bach ngoulou commande bsmek.', 'arabizi')).toBe('Wach smitek ? Bach nsajjel la commande b smitek.');
    // French replies are untouched
    expect(withArabiziWords('Elle est parfaite pour les fêtes, à 4900 DA, et M existe.', 'fr')).toBe('Elle est parfaite pour les fêtes, à 4900 DA, et M existe.');
  });
});
