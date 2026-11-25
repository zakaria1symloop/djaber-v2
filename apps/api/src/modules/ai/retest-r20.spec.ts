// Journey retest R20 (18/11, docs/audit/journeys-2026-11-16/journeys/R20-ai-orders.md): « ih ndirha » left to the model, N5 T1 two get_product after
// the search, PG2 T2 a call to a made-up tool name (R20-1); a delivery question answered with no fee, a server quote lost after a guard rewrite
// (R20-2, N3 / F5r); « oui » to an either / or question looping (R20-3, N5); « je note », amounts without the thousands space, N16's repeated
// clause, « Merci Yacine. » before the question (R20-4). Transcripts: .local/qa/journeys/R20/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, offeredInQuestion, placeholderCall, takesSubstituteNote, type TurnRequest } from './ai-run.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { choiceQuestion, withoutNotedOpening, withoutNotedSteps, withoutRepeatedNotServed, withSpacedAmounts, withThanksFirst } from './reply-fixes';
import { buildGuardFacts, FIELD_QUESTIONS } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { deliveryAnswer, orderConfirmationText, orderRecapText, pendingRecap, recapReply } from './tools/order-confirmation-text';
import { bareYes, recapYesArgs, type OrderCallHistory } from './tools/order-confirmation';
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
const routing = {
  call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
  route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
};
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const HIJAB: Product = { id: '01a1e51f-450a-7000-8000-00000000450a', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
const DJELLABA: Product = { id: '01a1e54f-efdc-7000-8000-00000000efdc', name: 'Djellaba homme', price: 7500, hasVariants: false, variants: [], stock: 10, sellOutOfStock: false };
const TAPIS: Product = { id: '01a1e54f-a750-7000-8000-00000000a750', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 15, sellOutOfStock: false };
const OUD: Product = { id: '01a1e51f-8c00-7000-8000-000000008c00', name: 'Parfum Oud 50 ml', price: 3200, hasVariants: false, variants: [], stock: 0, sellOutOfStock: false };
const COFFRET: Product = { id: '01a1e51f-c0ff-7000-8000-00000000c0ff', name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 4, sellOutOfStock: false };
const ROBE: Product = {
  id: '01a1e51f-419b-7000-8000-0000000048ee',
  name: 'Robe kabyle brodée',
  price: 4900,
  hasVariants: true,
  variants: [
    { id: 'v-s', name: 'S', price: 4900, stock: 5 },
    { id: 'v-m', name: 'M', price: 4900, stock: 5 },
    { id: 'v-l', name: 'L', price: 4900, stock: 0 },
    { id: 'v-xl', name: 'XL', price: 5200, stock: 2 },
  ],
  stock: null,
  sellOutOfStock: false,
};
const J04 = [HIJAB, DJELLABA, OUD, ROBE];
const J03 = [TAPIS, DJELLABA, OUD, COFFRET];

const ctxOf = (customerText: string, history: string[], orderHistory: OrderCallHistory = []): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory, ordering: orderHistory.length > 0 });
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', products: Product[]) =>
  buildGuardFacts({ lang, products: products.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false });
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');

/** A turn over a stub registry: quote_delivery answers from the shop's settings, search_products / create_order with what is given. */
const turnOf = async (
  said: string,
  lang: 'fr' | 'ar' | 'arabizi' | 'en',
  answers: Parameters<FakeAiGateway['script']>[1][],
  o: { history?: string[]; assistant?: string[]; orderHistory?: OrderCallHistory; order?: unknown; search?: unknown; products?: Product[]; defs?: (keyof typeof TOOL_DEFS)[]; sold?: string } = {},
) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const execute = jest.fn(async (name: string, args: Record<string, unknown>) => (name === 'quote_delivery' ? quoteOf(args) : name === 'create_order' ? (o.order ?? {}) : name === 'search_products' ? (o.search ?? { products: [] }) : {}));
  const defs = (o.defs ?? ['quote_delivery', 'search_products', 'create_order', 'handoff_to_human']).map((d) => TOOL_DEFS[d]);
  const tools = { defsFor: async () => defs, execute, forcedHandoff: () => null, soldProductNamed: async () => o.sold ?? null } as unknown as ToolRegistry;
  const history = o.history ?? [];
  const messages = [...history.flatMap((h, i) => [{ role: 'user', content: h }, ...(o.assistant?.[i] ? [{ role: 'assistant', content: o.assistant[i] }] : [])]), { role: 'user', content: said }];
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages } as never, toolCtx: ctxOf(said, history, o.orderHistory ?? []), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, lang, o.products ?? J04) };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return { r, execute, gateway };
};
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);
const ran = (execute: jest.Mock, name: string) => execute.mock.calls.filter((c) => c[0] === name);

// --- R20-2 ------------------------------------------------------------------------------------------------------------------------------
describe('R20-2 (Minor) — a quote run in a turn reaches the reply; a delivery question gets both fees', () => {
  const N3_T1 = 'Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567';
  const N3_T2 = 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5';
  const N3_CALL = { clientName: 'Samira Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'El Khroub', address: 'El Khroub, cité 1000 logements bloc 5', items: [{ productId: TAPIS.id, quantity: 2 }], customerConfirmed: true };
  const N3_RECAP = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'a21b41', core: '9816bc' }, recapToShow: true, recap: { items: [{ name: 'Tapis de prière', variant: null, quantity: 2, unitPrice: 2800 }], subtotal: 5600, deliveryFee: 700, total: 6300, clientName: 'Samira Benali', clientPhone: '0661234567', wilaya: 'Constantine', wilayaAr: 'قسنطينة', communeName: 'El Khroub', communeAr: 'الخروب', address: 'El Khroub, cité 1000 logements bloc 5', isStopdesk: false } };
  const T1_REPLY = "Merci Samira, 2 tapis de prière molletonnés (120 x 70 cm) à 2800 DA l'unité. Dans quelle wilaya souhaitez-vous être livrée ?";

  it('N3 T2 reproduction: the model quoted Constantine (twice) then sent the recap call ⇒ the server answer gives the delay and both fees before the recap, no model call after it', async () => {
    const { r, gateway, execute } = await turnOf(N3_T2, 'arabizi', [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaId: 25 } }, { name: 'quote_delivery', args: { wilayaId: 25 } }] }, { toolCalls: [{ name: 'create_order', args: N3_CALL }] }, { reply: 'Ih !', intent: 'SALE' }], { history: [N3_T1], assistant: [T1_REPLY], order: N3_RECAP, products: J03 });
    expect(gateway.calls).toHaveLength(2);
    expect(ran(execute, 'quote_delivery')).toHaveLength(1);
    const recap = orderRecapText(pendingRecap([{ name: 'create_order', result: N3_RECAP }])!, 'arabizi');
    expect(r.output.reply).toBe(`Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700\u00a0DA, f l bureau: 450\u00a0DA.\n\n${recap}`);
    // R19's answer: « Ih, nwasslou l Constantine, f 2 l 5 ayam. » — the stop-desk fee never said
    expect(plain(r.output.reply)).toContain('f l bureau: 450 DA');
  });

  it('the model made no quote: the server quotes the recap’s wilaya (no model call) and the answer still carries both fees', async () => {
    const { r, gateway, execute } = await turnOf(N3_T2, 'arabizi', [{ toolCalls: [{ name: 'create_order', args: N3_CALL }] }, { reply: 'Ih !', intent: 'SALE' }], { history: [N3_T1], assistant: [T1_REPLY], order: N3_RECAP, products: J03 });
    expect(gateway.calls).toHaveLength(1);
    expect(ran(execute, 'quote_delivery').map((c) => c[1])).toEqual([{ wilayaId: 25 }]);
    expect(r.output.reply.startsWith('Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700\u00a0DA, f l bureau: 450\u00a0DA.\n\nHada récap')).toBe(true);
  });

  it('deliveryAnswer in every script; a stop-desk recap gives the home fee from the quote; no delivery question ⇒ nothing', () => {
    const quote = { name: 'quote_delivery', result: quoteOf({ wilayaId: 25 }) };
    const call = { name: 'create_order', result: N3_RECAP };
    expect(deliveryAnswer([quote, call], 'Vous livrez à Constantine ? cité 1000 logements bloc 5', 'fr')).toBe('Oui, on livre à Constantine, en 2 à 5 jours. À domicile : 700\u00a0DA, au bureau : 450\u00a0DA.');
    expect(deliveryAnswer([quote, call], 'واش توصلو لقسنطينة ؟', 'ar')).toBe('إيه، نوصلو ل\u0640قسنطينة، من 2 إلى 5 أيام. للدار: 700\u00a0دج، للمكتب: 450\u00a0دج.');
    expect(deliveryAnswer([quote, call], 'Do you deliver to Constantine?', 'en')).toBe('Yes, we deliver to Constantine in 2 to 5 days. Home delivery: 700\u00a0DA, to the office: 450\u00a0DA.');
    const stop = { name: 'create_order', result: { ...N3_RECAP, recap: { ...N3_RECAP.recap, isStopdesk: true, deliveryFee: 450, address: null } } };
    expect(deliveryAnswer([quote, stop], N3_T2, 'arabizi')).toBe('Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700\u00a0DA, f l bureau: 450\u00a0DA.');
    // a quote of another wilaya gives nothing of its own: the recap's fee only
    expect(deliveryAnswer([{ name: 'quote_delivery', result: quoteOf({ wilayaId: 9 }) }, call], N3_T2, 'arabizi')).toBe('Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700\u00a0DA.');
    expect(deliveryAnswer([quote, call], 'El Khroub, cité 1000 logements bloc 5', 'arabizi')).toBeNull();
  });

  const F5_T1 = 'Salam, je veux la robe kabyle taille M, smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar';
  const F5R_REWRITE = "Merci Amina ! Robe kabyle brodée taille M disponible, 4900 DA. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib) ? Wela t7ebb stop-desk ?";
  it('F5r T1 reproduction: the server’s quote of the first draft’s « … wela t7ebb stop-desk ? » survives the guard’s rewrite that split the question', async () => {
    const draft = "Ahlan Amina ! Robe kabyle brodée taille M kayna daba b 4900 DA. A3tini l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro), wela t7ebb stop-desk ?";
    const { r, gateway, execute } = await turnOf(F5_T1, 'arabizi', [{ reply: draft, intent: 'SALE' }, { reply: F5R_REWRITE, intent: 'SALE' }]);
    expect(gateway.calls).toHaveLength(2);
    expect(ran(execute, 'quote_delivery').map((c) => (c[1] as { wilayaId: number }).wilayaId)).toEqual([16]);
    expect(r.guard?.retried).toBe(true);
    expect(r.output.reply).toBe("Merci Amina ! Robe kabyle brodée taille M disponible, 4\u00a0900\u00a0DA. L dar: 400\u00a0DA, f l bureau: 250\u00a0DA. Wach l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib) ? Wela t7ebb stop-desk ?");
  });

  it('F5 T1 (the same message, the rewrite keeps one question): the fees once, as in R20', async () => {
    const draft = "Ahlan Amina ! Robe kabyle brodée taille M kayna daba b 4900 DA. A3tini l'adresse ta3ek f Bab Ezzouar (rue, cité, numéro), wela t7ebb stop-desk ?";
    const rewrite = "Ahlan Amina ! Robe kabyle brodée taille M rahi kayna b 4900 DA. Bach nwasslouha lik, a3tini l'adresse ta3ek (rue, cité, numéro ta3 dar wela blassa ma3roufa 9rib), wela t7ebb stop-desk ?";
    const { r } = await turnOf(F5_T1, 'arabizi', [{ reply: draft, intent: 'SALE' }, { reply: rewrite, intent: 'SALE' }]);
    expect((plain(r.output.reply).match(/400 DA/gu) ?? []).length).toBe(1);
    expect((plain(r.output.reply).match(/250 DA/gu) ?? []).length).toBe(1);
  });

  it('a reply that states the quoted fees gets nothing added', async () => {
    const said = 'Bonjour, vous livrez à Sétif ?';
    const { r } = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaId: 19 } }] }, { reply: 'Oui : 650 DA à domicile, 350 DA en stop-desk. Que souhaitez-vous commander ?', intent: 'SALE' }]);
    expect(plain(r.output.reply)).toBe('Oui : 650 DA à domicile, 350 DA en stop-desk. Que souhaitez-vous commander ?');
  });
});

// --- R20-3 ------------------------------------------------------------------------------------------------------------------------------
describe('R20-3 (Minor) — « oui » to an either / or question: one short « which one? », the one substitute offered is taken', () => {
  const N5_T1 = 'Bonjour, le parfum oud c’est combien ?';
  const N5_T2 = 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
  const N5_A1 = "Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible pour le moment. Si vous cherchez autre chose, nous avons en stock la Robe kabyle brodée à partir de 4900 DA ou le Hijab soie à 1500 DA. Lequel vous intéresse ?";
  const N5_A2 = 'Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Vos coordonnées sont bien notées : voulez-vous plutôt le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ?';

  it.each([
    ['fr', 'oui', 'Lequel préférez-vous : Hijab soie ou Robe kabyle brodée ?'],
    ['fr', 'oui oui', 'Lequel préférez-vous : Hijab soie ou Robe kabyle brodée ?'],
    ['arabizi', 'ih', 'Wach men wa7ed t7ebb: Hijab soie wela Robe kabyle brodée ?'],
    ['ar', 'ايه', 'واش من واحد تحب: Hijab soie ولا Robe kabyle brodée ؟'],
    ['en', 'yes', 'Which one would you like: Hijab soie or Robe kabyle brodée?'],
  ] as const)('N5 T3 reproduction (%s « %s »): no model call, the short question, no out-of-stock sentence again', async (lang, yes, want) => {
    const { r, gateway, execute } = await turnOf(yes, lang, [{ reply: "Je comprends. Le Parfum Oud 50 ml est en rupture pour le moment, donc je ne peux pas le commander. Vous préférez le Hijab soie à 1500 DA ou la Robe kabyle brodée (à partir de 4900 DA) ?", intent: 'SALE' }], { history: [N5_T1, N5_T2], assistant: [N5_A1, N5_A2] });
    expect(gateway.calls).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
    expect(r.output.reply).toBe(want);
    expect(r.output.reply).not.toMatch(/rupture|Parfum/u);
    expect(r.steps).toEqual([]);
  });

  it('N5 T4: a second « oui » to that question gets it again (no model call, no « noop » call)', async () => {
    const { r, gateway } = await turnOf('oui', 'fr', [], { history: [N5_T1, N5_T2, 'oui'], assistant: [N5_A1, N5_A2, 'Lequel préférez-vous : Hijab soie ou Robe kabyle brodée ?'] });
    expect(gateway.calls).toHaveLength(0);
    expect(r.output.reply).toBe('Lequel préférez-vous : Hijab soie ou Robe kabyle brodée ?');
  });

  it('N5b: « oui » to the one in-stock product offered instead ⇒ it is taken — the model is told so and the recap goes out', async () => {
    const A2 = 'Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Livraison à domicile : 600 DA (gratuite dès 20 000 DA). Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA ?';
    const call = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', items: [{ productId: COFFRET.id, quantity: 1 }], customerConfirmed: true };
    const recap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd5', core: 'c5' }, recapToShow: true, recap: { items: [{ name: 'Coffret cadeau Aïd', variant: null, quantity: 1, unitPrice: 24_990 }], subtotal: 24_990, deliveryFee: 0, total: 24_990, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Oran', wilayaAr: 'وهران', communeName: 'Bir El Djir', communeAr: 'بئر الجير', address: 'cité 1000 logements bloc 4', isStopdesk: false } };
    const { r, gateway } = await turnOf('oui', 'fr', [{ toolCalls: [{ name: 'create_order', args: call }] }, { reply: 'Parfait !', intent: 'SALE' }], { history: [N5_T1, N5_T2], assistant: ['Parfum Oud 50 ml est à 3 200 DA, mais ce produit n’est pas disponible pour le moment. Notre Coffret cadeau Aïd est disponible à 24990 DA.', A2], order: recap, products: J03 });
    expect(gateway.calls[0]!.system).toContain(takesSubstituteNote('Coffret cadeau Aïd'));
    expect(offered(gateway)).toContain('create_order');
    expect(r.output.reply).toContain(orderRecapText(pendingRecap([{ name: 'create_order', result: recap }])!, 'fr'));
  });

  it('the negatives: a yes with a change, a question, one product of a taken product in stock, no « ou », a recap ⇒ the model', async () => {
    for (const [said, last] of [
      ['oui le hijab', 'Voulez-vous le Hijab soie à 1500 DA ou la Robe kabyle brodée ?'],
      ['oui ?', 'Voulez-vous le Hijab soie à 1500 DA ou la Robe kabyle brodée ?'],
      ['oui', 'Le Hijab soie et la Robe kabyle brodée sont disponibles. Voulez-vous passer commande ?'],
      ['oui', 'Voulez-vous le Hijab soie à 1500 DA ?'],
    ] as const) {
      const { gateway } = await turnOf(said, 'fr', [{ reply: 'Très bien.', intent: 'SALE' }], { history: ['Bonjour, je cherche un hijab'], assistant: [last] });
      expect(gateway.calls.length).toBeGreaterThan(0);
      expect(gateway.calls[0]!.system).not.toContain('THE CUSTOMER ACCEPTS');
    }
  });

  it('offeredInQuestion: the closing question’s in-stock products in order; « Lequel vous intéresse ? » reads the sentence before', () => {
    const prices = J04.map((p) => ({ id: p.id, name: p.name, price: p.price, variants: p.variants.map((v) => ({ id: v.id, name: v.name, price: v.price })) }));
    expect(offeredInQuestion(N5_A2, prices, ['Parfum Oud 50 ml']).map((p) => p.name)).toEqual(['Hijab soie', 'Robe kabyle brodée']);
    expect(offeredInQuestion(N5_A1, prices, ['Parfum Oud 50 ml']).map((p) => p.name)).toEqual(['Robe kabyle brodée', 'Hijab soie']);
    expect(offeredInQuestion('Tu veux la Robe kabyle brodée en S ou en M ?', prices, []).map((p) => p.name)).toEqual(['Robe kabyle brodée']);
    expect(offeredInQuestion('Le Hijab soie est à 1500 DA. Merci !', prices, [])).toEqual([]);
    expect(offeredInQuestion('Voulez-vous le Parfum Oud 50 ml ou le Hijab soie ?', prices, ['Parfum Oud 50 ml']).map((p) => p.name)).toEqual(['Hijab soie']);
    expect(choiceQuestion(['Sac à main cuir', 'Basket Runner', 'Tapis de prière'], 'fr')).toBe('Lequel préférez-vous : Sac à main cuir, Basket Runner ou Tapis de prière ?');
  });
});

// --- R20-1 ------------------------------------------------------------------------------------------------------------------------------
describe('R20-1 (Minor) — « ih ndirha » placed by the server; no lookup asked twice; a made-up tool name answered in the same step', () => {
  const N17 = 'Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3';
  const CALL = { clientName: 'Nadia Kaci', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'cité 20 août villa 3', items: [{ productId: HIJAB.id, quantity: 1 }], customerConfirmed: true };
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

  it.each([
    ['arabizi', 'ih ndirha'],
    ['arabizi', 'wah ndirha'],
    ['arabizi', 'ok ndirha'],
    ['ar', 'ايه نديرها'],
    ['fr', 'oui je prends'],
    ['fr', 'oui je la prends'],
    ['en', 'yes I take it'],
  ] as const)('F3 T5 (%s « %s ») to the recap shown: zero model call, exactly one order with the recap’s draft', async (lang, yes) => {
    const reg = registry([HIJAB]);
    const t1 = ((await reg.prepareOrder(CALL, ctxOf(N17, []))) as { result: Record<string, unknown> }).result;
    const shown: OrderCallHistory = [{ name: 'create_order', result: t1, at: new Date(Date.now() - 60_000) }];
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t1 }])!, lang).text;
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: CALL }] }, { reply: 'Saha !', intent: 'SALE' });
    const execute = jest.fn((name: string, args: Record<string, unknown>, ctx: ToolRunContext) => reg.execute(name, args, ctx));
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.search_products], execute, forcedHandoff: (n: string, a: Record<string, unknown>, res: unknown) => reg.forcedHandoff(n, a, res), soldProductNamed: async () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r2', prompt: { system: 'S', messages: [{ role: 'user', content: N17 }, { role: 'assistant', content: recapText }, { role: 'user', content: yes }] } as never, toolCtx: { ...ctxOf(yes, [N17], shown), runId: 'r2' }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(yes, lang, [HIJAB]) };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    expect(gateway.calls).toHaveLength(0);
    const done = r.tools.filter((t) => t.name === 'create_order');
    expect(done).toHaveLength(1);
    expect((done[0]!.result as { draft?: unknown }).draft).toBe((t1.error as { draft: string }).draft);
    expect(r.output.reply).toBe(orderConfirmationText([{ name: 'create_order', result: done[0]!.result }], lang));
    expect(r.steps).toEqual([]);
  });

  it('a « I take it » with a number or another product is a change, not a plain yes', () => {
    const shown = 'Nadia Kaci 0661234568 Blida Boufarik cité 20 août villa 3 Hijab soie';
    expect(bareYes('ih ndirha', shown)).toBe(true);
    expect(bareYes('oui je prends', shown)).toBe(true);
    expect(bareYes('oui je prends 2', shown)).toBe(false);
    expect(bareYes('oui je prends 3 villa', shown)).toBe(false);
    expect(bareYes('ih ndirha zoudj', shown)).toBe(false);
    expect(bareYes('oui je prends la robe', shown)).toBe(false);
    expect(recapYesArgs([], 'ih ndirha', true)).toBeNull();
  });

  it('N5 T1 reproduction: once the search returned the listed product, get_product is not offered; a lookup answered from what the turn has ⇒ no lookup tool after it', async () => {
    const found = { products: [{ id: OUD.id, sku: 'S', name: OUD.name, price: 3200, stock: 'out of stock', variants: [], hasVariants: false }] };
    const said = 'Bonjour, le parfum oud c’est combien ?';
    const reply = "Parfum Oud 50 ml est à 3 200 DA, mais ce produit n'est pas disponible pour le moment. Nous avons en stock le Hijab soie à 1500 DA. Ça vous intéresse ?";
    const a = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'search_products', args: { query: 'Parfum Oud 50 ml', limit: 3 } }] }, { reply, intent: 'SALE' }], { search: found, defs: ['search_products', 'get_product', 'check_availability', 'quote_delivery'] });
    expect(offered(a.gateway, 0)).toContain('get_product');
    expect(offered(a.gateway, 1)).not.toContain('get_product');
    expect(offered(a.gateway, 1)).toContain('search_products');
    expect(a.gateway.calls).toHaveLength(2);
    // A3 T1: `check_availability` of a listed product (answered, not run) ⇒ the next step offers no lookup tool at all
    const b = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'get_product', args: { productId: OUD.id } }] }, { reply, intent: 'SALE' }], { defs: ['search_products', 'get_product', 'check_availability', 'quote_delivery'] });
    expect(b.execute).not.toHaveBeenCalled();
    expect(offered(b.gateway, 1)).toEqual(['quote_delivery']);
    // a photo request still gets get_product (its pictures come with it)
    const c = await turnOf('vous avez une photo du parfum oud ?', 'fr', [{ toolCalls: [{ name: 'search_products', args: { query: 'Parfum Oud 50 ml' } }] }, { reply, intent: 'SALE' }], { search: found, defs: ['search_products', 'get_product', 'check_availability'] });
    expect(offered(c.gateway, 1)).toContain('get_product');
  });

  it('PG2 T2 reproduction: a call to « dummy » is answered by the server in the same step — the address question with the card and the price, no 2nd call, no guard retry', async () => {
    const T1 = 'السلام عليكم، أنا من البليدة بوفاريك';
    const A1 = 'وعليكم السلام، مرحبا بيك! التوصيل: 450 دج للدار، ولا 300 دج لنقطة الاستلام (stop-desk) إذا تحب. واش راك تقلب عليه اليوم؟';
    const said = 'نحب جلابة رجالي، سمير بن علي 0661234567';
    const { r, gateway, execute } = await turnOf(said, 'ar', [{ toolCalls: [{ name: 'dummy', args: {} }] }, { reply: 'صحيت سمير! الجلابة الرجالي عندنا ب\u0640 7500 دج. دابا عطيني العنوان.', intent: 'SALE' }, { reply: 'x', intent: 'SALE' }], { history: [T1], assistant: [A1], sold: 'Djellaba homme' });
    expect(gateway.calls).toHaveLength(1);
    // (the « home or stop-desk? » question carries both fees, R14-2: the server quotes Blida — reused from T1's quote in the live run)
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['quote_delivery']);
    expect(r.output.productCards).toEqual([DJELLABA.id]);
    expect(r.output.reply).toContain(FIELD_QUESTIONS.address!.ar);
    expect(plain(r.output.reply)).toContain('7 500 دج');
    expect(r.steps?.[0]).toMatchObject({ stray: ['dummy'] });
    // the product wanted cannot be told (no keyword of it in the message): the model answers, as before
    const unknown = await turnOf(said, 'ar', [{ toolCalls: [{ name: 'dummy', args: {} }] }, { reply: 'صحيت سمير! الجلابة الرجالي عندنا ب\u0640 7500 دج. عطيني العنوان تاعك ؟', intent: 'SALE' }], { history: [T1], assistant: [A1] });
    expect(unknown.gateway.calls).toHaveLength(2);
    // client list L92 (23/11): the step after a made-up tool is asked without tools — no second made-up call, no third model call
    expect((unknown.gateway.calls[0] as { tools?: unknown[] }).tools?.length).toBeGreaterThan(0);
    expect((unknown.gateway.calls[1] as { tools?: unknown[] }).tools).toBeUndefined();
  });

  it('N21 T3 (phone alone) ⇒ the wilaya question; A3 T1 `search_products {«noop»}` is not run; a message with a question still goes to the model', async () => {
    const n21 = await turnOf('0661234568', 'ar', [{ toolCalls: [{ name: 'dummy', args: {} }] }, { reply: 'x', intent: 'SALE' }], { history: ['سلام، نحب حجاب حرير', 'نادية قاسي'], assistant: ['عندنا Hijab soie بسعر 1500 دج. واش سميتك ؟', 'صحيت يا نادية. عطيني رقم الهاتف تاعك (مثال: 0555123456).'] });
    expect(n21.gateway.calls).toHaveLength(1);
    expect(n21.r.output.reply).toBe(FIELD_QUESTIONS.wilayaId!.ar);
    const a3 = await turnOf('السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦', 'ar', [{ toolCalls: [{ name: 'search_products', args: { query: 'noop', limit: 1 } }] }, { reply: 'x', intent: 'SALE' }], { products: J03, sold: 'Tapis de prière' });
    expect(ran(a3.execute, 'search_products')).toHaveLength(0);
    expect(a3.gateway.calls).toHaveLength(1);
    expect(a3.r.output.reply).toContain(FIELD_QUESTIONS.wilayaId!.ar);
    expect(a3.r.output.productCards).toEqual([TAPIS.id]);
    expect(placeholderCall({ name: 'search_products', args: { query: 'noop' } })).toBe(true);
    expect(placeholderCall({ name: 'search_products', args: { query: 'tapis de prière' } })).toBe(false);
    const asks = await turnOf('0661234568, vous livrez à Blida ?', 'fr', [{ toolCalls: [{ name: 'dummy', args: {} }] }, { reply: 'Oui, nous livrons à Blida. Quelle est votre commune ?', intent: 'SALE' }], { history: ['Bonjour, je veux un hijab soie', 'Nadia Kaci'] });
    expect(asks.gateway.calls).toHaveLength(2);
  });
});

// --- R20-4 ------------------------------------------------------------------------------------------------------------------------------
describe('R20-4 (Cosmetic) — wording', () => {
  it('every amount with the thousands space (model or server); phone numbers, order numbers, streets, dates and spaced amounts untouched', () => {
    expect(withSpacedAmounts('Merci Karim, le sac (1 pièce, 6900 DA) pour El Eulma.')).toBe('Merci Karim, le sac (1 pièce, 6\u00a0900\u00a0DA) pour El Eulma.');
    expect(withSpacedAmounts('الجلابة ب\u0640 7500 دج (كانت 9000 دج)')).toBe('الجلابة ب\u0640 7\u00a0500\u00a0دج (كانت 9\u00a0000\u00a0دج)');
    expect(withSpacedAmounts('Coffret cadeau Aïd à 24990DA, Basket Runner (12500 DA)')).toBe('Coffret cadeau Aïd à 24\u00a0990\u00a0DA, Basket Runner (12\u00a0500\u00a0DA)');
    for (const t of ['Votre commande TEST-6293 est bien enregistrée ✅', 'Téléphone : 0770112233', 'Adresse : Cité 1000 logements bloc 4, Bir El Djir, Oran', 'le 18/11/2026 à 09:00', 'Total : 7 550 DA', 'Livraison : 650 DA', 'TEST-1500 DA', '1.500 DA', 'حي 1000 مسكن عمارة 5']) expect(withSpacedAmounts(t)).toBe(t);
  });

  it('« je note … » (PF1 T2) and « Vos coordonnées sont bien notées : » (N5 T2) go; « je note que … » stays', () => {
    expect(withoutNotedSteps('Merci Karim, je note le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma. Quelle est votre adresse exacte (rue, cité, numéro), ou préférez-vous le stop-desk à 350 DA ?', 'Je voudrais le sac à main cuir marron. Karim Haddad 0770112233')).toBe('Merci Karim, le sac à main cuir Marron (1 pièce, 6900 DA) pour El Eulma. Quelle est votre adresse exacte (rue, cité, numéro), ou préférez-vous le stop-desk à 350 DA ?');
    expect(withoutNotedOpening('Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Vos coordonnées sont bien notées : voulez-vous plutôt le Hijab soie à 1500 DA ?')).toBe('Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Voulez-vous plutôt le Hijab soie à 1500 DA ?');
    expect(withoutNotedSteps('Je note que vous préférez le stop-desk.', 'stop desk')).toBe('Je note que vous préférez le stop-desk.');
    expect(withoutNotedOpening('C’est noté, Karim ! Quelle est votre adresse ?')).toBe('C’est noté, Karim ! Quelle est votre adresse ?');
    expect(withoutNotedOpening('Vos coordonnées sont bien notées.')).toBe('Vos coordonnées sont bien notées.');
  });

  it('the thanks first, the question last (N7 T1); a thanks already first, or not before the question, stays', () => {
    expect(withThanksFirst('Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Nous avons par contre un sac à main en cuir véritable (noir ou marron, 6900 DA) et une Basket Runner (12500 DA). Merci Yacine. Lequel vous intéresse ?')).toBe('Merci Yacine. Désolé, nous ne vendons pas de lunettes de soleil pour le moment. Nous avons par contre un sac à main en cuir véritable (noir ou marron, 6900 DA) et une Basket Runner (12500 DA). Lequel vous intéresse ?');
    expect(withThanksFirst('Bonjour ! Le hijab est à 1500 DA. Merci Nadia. Quelle wilaya ?')).toBe('Bonjour ! Merci Nadia. Le hijab est à 1500 DA. Quelle wilaya ?');
    for (const t of ['Merci Yacine. Lequel vous intéresse ?', 'Le hijab est à 1500 DA. Merci beaucoup pour votre confiance et à bientôt. Quelle wilaya ?', 'Le hijab est à 1500 DA. Merci Nadia.']) expect(withThanksFirst(t)).toBe(t);
  });

  it('N16: one « we don’t deliver there » per sentence', () => {
    expect(withoutRepeatedNotServed('Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma kanch wasl l had wilaya, ma l dar wala f stop-desk.')).toBe('Lmes7a, ma nwasslouch l Illizi f had lwaqt, ma l dar wala f stop-desk.');
    expect(withoutRepeatedNotServed('Ma nwasslouch l Illizi f had lwaqt, wallah makach livraison lhom. T7ebb nchouf wahed men les produits ta3na f wilaya okhra ?')).toBe('Ma nwasslouch l Illizi f had lwaqt. T7ebb nchouf wahed men les produits ta3na f wilaya okhra ?');
    for (const t of ['Ma nwasslouch l Illizi f had lwaqt.', 'Nous ne livrons pas à Illizi pour le moment. Nous livrons à Oran.', 'Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk.']) expect(withoutRepeatedNotServed(t)).toBe(t);
  });
});

describe('Houssem live 23/11 (UX-066) — a plain-text answer is sent as it is, no format retry', () => {
  it('a plain message (no JSON) of a turn with no order tool: one model call, the sentence is the reply', async () => {
    const { r, gateway } = await turnOf('je veux la robe', 'fr', [{ text: 'Bien sûr, je vous écoute. Quelle taille voulez-vous ?' }, { reply: 'x', intent: 'SALE' }]);
    expect(gateway.calls).toHaveLength(1);
    expect(r.output.reply).toBe('Bien sûr, je vous écoute. Quelle taille voulez-vous ?');
    expect(r.steps?.[0]?.bad).toMatch(/^plain_used: /);
  });
  it('half a JSON object (cut by the token limit) still gets the format retry', async () => {
    const { gateway } = await turnOf('je veux la robe', 'fr', [{ text: '{"reply": "Voici les pho' }, { reply: 'Bien sûr, quelle taille voulez-vous ?', intent: 'SALE' }]);
    expect(gateway.calls).toHaveLength(2);
  });
});
