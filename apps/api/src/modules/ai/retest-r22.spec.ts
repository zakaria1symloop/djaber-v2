// Journey retest R22 (18/11, docs/audit/journeys-2026-11-16/journeys/R22-ai-orders.md): « nheb 7 » after the price taken by the model (R22-1,
// Major); the MSA yes through the model, a lookup on an order message, a second quote with no wilaya (R22-2); the first field question
// without the product or its price (R22-3, A3 / PH4); a price line in a cancel question, « نقطة الاستلام (نقطة الاستلام) », the delay before
// the product, « أيه » (R22-4). Transcripts: .local/qa/journeys/R22/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, knownProductIds, type TurnRequest } from './ai-run.service';
import { withMsaWording } from './msa';
import { bareQuantity, otherFieldAsked, quantityAbove } from './order-limit';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabicWords, withPlaceFacts } from './reply-fixes';
import { buildGuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { serverRecapAsked } from './tools/order-confirmation-text';
import { bareYes, confirmation, recapYesArgs, type OrderCallHistory } from './tools/order-confirmation';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }] },
];
beforeEach(() => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue(PLACES.map((p) => ({ id: p.id, code: String(p.id).padStart(2, '0'), nameFr: p.nameFr, nameAr: p.nameAr })) as never);
  jest.spyOn(prisma.commune, 'findMany').mockResolvedValue(PLACES.flatMap((p) => p.communes.map((c) => ({ wilayaId: p.id, ...c }))) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  resetPlaceIndex();
});

const RULES: Record<number, { home: number; stop: number }> = { 9: { home: 450, stop: 300 }, 16: { home: 400, stop: 250 }, 25: { home: 700, stop: 450 } };
const NO_WILAYA = { ok: false, error: { code: 'VALIDATION', field: 'wilayaName', missing: true, example: 'Alger' }, say: 'No wilaya given: the customer has not named one yet. Ask which wilaya (one question) — never say you did not understand it.' };
const quoteOf = (args: Record<string, unknown>) => {
  const id = Number(args.wilayaId) || PLACES.find((p) => p.nameFr === args.wilayaName)?.id;
  const w = PLACES.find((p) => p.id === id);
  if (!w) return NO_WILAYA;
  return { ok: true, wilayaId: w.id, wilayaName: w.nameFr, wilayaNameAr: w.nameAr, isStopdesk: false, fee: RULES[w.id]!.home, free: false, freeFrom: null, stopdeskAvailable: true, stopdeskFee: RULES[w.id]!.stop, etaDays: '2–5' };
};

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, label: 'Haiku', ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = {
  call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
  route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
};
// both shops of the round: « Quantité max par commande » 5
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: 5, maxAmountPerOrder: null, sellAllProducts: true } as never;

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const HIJAB: Product = { id: '01a1ef58-ef1a-7b99-94b4-dbbd38830845', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
const DJELLABA: Product = { id: '01a1ef58-de3f-7c2d-945c-1bc7d49bc0ba', name: 'Djellaba homme', price: 7500, hasVariants: false, variants: [], stock: 10, sellOutOfStock: false };
const TAPIS: Product = { id: '01a1ef35-9ae4-7287-910c-d1b2a2096b3a', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 15, sellOutOfStock: false };
const SAC: Product = { id: '01a1ef35-5ac0-7000-8000-00000000e807', name: 'Sac à main cuir', price: 6900, hasVariants: true, variants: [{ id: 'v-noir', name: 'Noir', price: 6900, stock: 3 }, { id: 'v-marron', name: 'Marron', price: 6900, stock: 3 }], stock: null, sellOutOfStock: false };
const BASKET: Product = { id: '01a1ef35-ba5e-7000-8000-00000000ba5e', name: 'Basket Runner', price: 12_500, hasVariants: true, variants: ['40', '41', '42', '43'].map((n) => ({ id: `v-${n}`, name: n, price: 12_500, stock: n === '41' ? 0 : 3 })), stock: null, sellOutOfStock: false };
const COFFRET: Product = { id: '01a1ef35-99e9-7f95-90f7-109d2fb56b36', name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 4, sellOutOfStock: false };
const J04R = [HIJAB, DJELLABA, COFFRET];
const J03R = [TAPIS, SAC, BASKET, COFFRET, DJELLABA];

const ctxOf = (customerText: string, history: string[], orderHistory: OrderCallHistory): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory, ordering: orderHistory.length > 0 });
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', products: Product[]) =>
  buildGuardFacts({ lang, products: products.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false });
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');

const turnOf = async (
  said: string,
  lang: 'fr' | 'ar' | 'arabizi' | 'en',
  answers: Parameters<FakeAiGateway['script']>[1][],
  o: { history?: string[]; assistant?: string[]; orderHistory?: OrderCallHistory; products?: Product[]; search?: unknown; defs?: (keyof typeof TOOL_DEFS)[]; guard?: Record<string, unknown> } = {},
) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const execute = jest.fn(async (name: string, args: Record<string, unknown>) => (name === 'quote_delivery' ? quoteOf(args) : name === 'search_products' ? (o.search ?? { products: [] }) : {}));
  const defs = (o.defs ?? ['quote_delivery', 'search_products', 'create_order', 'lookup_order', 'handoff_to_human']).map((d) => TOOL_DEFS[d]);
  const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
  const tools = { defsFor: async () => defs, execute, forcedHandoff: (n: string, a: Record<string, unknown>, r: unknown) => registry.forcedHandoff(n, a, r), soldProductNamed: async () => null } as unknown as ToolRegistry;
  const history = o.history ?? [];
  const messages = [...history.flatMap((h, i) => [{ role: 'user', content: h }, ...(o.assistant?.[i] ? [{ role: 'assistant', content: o.assistant[i] }] : [])]), { role: 'user', content: said }];
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages } as never, toolCtx: ctxOf(said, history, o.orderHistory ?? []), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: { ...guardOf(said, lang, o.products ?? J04R), ...(o.guard ?? {}) } };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return { r, execute, gateway };
};
const ran = (execute: jest.Mock, name: string) => execute.mock.calls.filter((c) => c[0] === name);
const offered = (gateway: FakeAiGateway, step: number) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);

// --- R22-1 ------------------------------------------------------------------------------------------------------------------------------
describe('R22-1 (Major) — a bare quantity above the max while a product is being sold is handed off by the server', () => {
  const Q3_T1 = 'slm, ch7al djellaba homme ?';
  const Q3_AI = 'Djellaba homme b 7 500 DA, rahi f promo (kanet 9 000 DA). Hiya beige, f laine fine, taille unique. T7ebb nsajjel lek wahda ?';
  const Q3C_AI = 'Salam ! Djellaba homme b 7 500 DA bedl 9 000 DA, men sof fin, beige, taille wa7da, w kayna. T7ebb tcommandi ?';
  const ARABIZI = "La commande wa7da ma tfoutch 5 pièces, rani nba3at talab ta3ek l l'équipe ta3 lboutique w rah tjawbek.";

  it('Q3 T2 reproduction: « nheb 7 » after the price ⇒ the limit sentence, HANDOFF order_limits, no model call (was « Saha, nsajjel lek 7 djellaba homme »)', async () => {
    const { r, gateway, execute } = await turnOf('nheb 7', 'arabizi', [{ reply: 'Saha, nsajjel lek 7 djellaba homme. Wach smitek ?', intent: 'SALE' }], { history: [Q3_T1], assistant: [Q3_AI] });
    expect(gateway.calls).toHaveLength(0);
    expect(ran(execute, 'create_order')).toHaveLength(0);
    expect(r.forcedHandoff).toBe('order_limits');
    expect(r.output.status).toBe('HANDOFF');
    expect(r.output.statusDetail).toBe('order_limits');
    expect(r.output.reply).toBe(ARABIZI);
    expect(r.output.reply).not.toMatch(/nsajjel|tkhalli 5|commande okhra/u);
  });

  it('Q3c T2 reproduction: « nheb 7 » after « … T7ebb tcommandi ? » ⇒ the same hand-off (was « T7ebb tkhalli 5, wela tdir commande okhra ? »), never a recap of 5', async () => {
    const { r, gateway } = await turnOf('nheb 7', 'arabizi', [{ reply: 'Nqder nsajjel lek djellaba homme, bessah l commande maximum 5 pièces. T7ebb tkhalli 5, wela tdir commande okhra ?', intent: 'SALE' }], { history: [Q3_T1], assistant: [Q3C_AI] });
    expect(gateway.calls).toHaveLength(0);
    expect(r.forcedHandoff).toBe('order_limits');
    expect(r.output.reply).toBe(ARABIZI);
  });

  it('the class: a quantity verb, a bare number, « x7 » / « 7 حبات » after a product named or chosen, in fr / ar / arabizi / en', async () => {
    const cases: [string, 'fr' | 'ar' | 'arabizi' | 'en', string, string][] = [
      ['je prends 7', 'fr', 'Le Hijab soie est à 1 500 DA. Combien en voulez-vous ?', 'ne peut pas dépasser 5 pièces'],
      ['Je veux 8 s’il vous plaît', 'fr', 'Hijab soie : 1 500 DA, en stock. Souhaitez-vous le commander ?', 'ne peut pas dépasser 5 pièces'],
      ['7', 'fr', 'Le Hijab soie est à 1 500 DA. Combien en voulez-vous ?', 'ne peut pas dépasser 5 pièces'],
      ['x10', 'arabizi', 'Hijab soie b 1 500 DA. Ch7al t7ebb ?', 'ma tfoutch 5 pièces'],
      ['bghit 9 djellabat', 'arabizi', Q3_AI, 'ma tfoutch 5 pièces'],
      ['نحب 7', 'ar', 'Djellaba homme ب\u0640 7 500 دج. تحب نسجلك وحدة؟', 'ما تفوتش 5 حبات'],
      ['عطيني 6', 'ar', 'حجاب الحرير ب\u0640 1 500 دج. شحال تحب؟', 'ما تفوتش 5 حبات'],
      ['I want 7', 'en', 'The Hijab soie is 1 500 DA. How many would you like?', "can't go above 5 pieces"],
      ['ok 6 please', 'en', 'The Hijab soie is 1 500 DA. How many would you like?', "can't go above 5 pieces"],
    ];
    // (« عطيني 6 » after « حجاب الحرير … »: the AI named it in the customer's words — the earlier turn's search found it)
    const searched = { earlierSearches: [{ args: { query: 'hijab' }, products: [{ id: HIJAB.id, name: HIJAB.name }] }] };
    for (const [said, lang, ai, sentence] of cases) {
      const { r, gateway } = await turnOf(said, lang, [{ reply: '…', intent: 'SALE' }], { history: ['Bonjour'], assistant: [ai], ...(said === 'عطيني 6' ? { guard: searched } : {}) });
      expect([said, gateway.calls.length]).toEqual([said, 0]);
      expect([said, r.forcedHandoff]).toEqual([said, 'order_limits']);
      expect(plain(r.output.reply)).toContain(sentence);
    }
  });

  it('never a quantity: at the max, no product being sold, a size / wilaya / phone question, a price, a phone, an order number, a date', async () => {
    const cases: [string, string, Product[]?][] = [
      ['nheb 5', Q3_AI],
      ['nheb 7', 'Bonjour 👋 Bienvenue chez Boutique de Karima ! Comment puis-je vous aider ?'],
      ['42', 'La Basket Runner est à 12 500 DA. Quelle pointure vous faut-il ?', J03R],
      ['nheb 43', 'Basket Runner b 12 500 DA, kayen 40, 42 w 43. T7ebb wahda ?', J03R],
      ['16', 'Djellaba homme : 7 500 DA. Dans quelle wilaya êtes-vous ?'],
      ['7500', Q3_AI],
      ['0555123456', Q3_AI],
      ['TEST-1234', Q3_AI],
      ['#1234', Q3_AI],
      ['le 12/05', Q3_AI],
      ['nheb 7 kahla', Q3_AI],
      ['7 jours ?', Q3_AI],
    ];
    for (const [said, ai, products] of cases) {
      const { r, gateway } = await turnOf(said, 'arabizi', [{ reply: 'Saha.', intent: 'SALE' }], { history: ['salam'], assistant: [ai], products: products ?? J04R });
      expect([said, gateway.calls.length]).toEqual([said, 1]);
      expect([said, r.forcedHandoff]).toEqual([said, null]);
    }
  });

  it('bareQuantity / otherFieldAsked / quantityAbove with a context', async () => {
    expect(bareQuantity('nheb 7')).toBe(7);
    expect(bareQuantity('ih nheb nechri 7 svp')).toBe(7);
    expect(bareQuantity('7x')).toBe(7);
    expect(bareQuantity('× 9')).toBe(9);
    expect(bareQuantity('qty 12')).toBe(12);
    expect(bareQuantity('٨')).toBe(8);
    expect(bareQuantity('il m’en faut 6')).toBe(6);
    expect(bareQuantity('nheb 7 djellabat', ['djellaba', 'homme'])).toBe(7);
    for (const s of ['nheb 7 djellabat', '7 et 8', '07', '1234567', 'rue 7', 'n 7', '7,5', '7.5', 'le 7', '12/05', '+7', '7 jours', 'smiti Walid 7'])
      expect([s, bareQuantity(s)]).toEqual([s, null]);
    expect(otherFieldAsked('Quelle pointure vous faut-il ?')).toBe(true);
    expect(otherFieldAsked('واش من ولاية ؟')).toBe(true);
    // owner decision 25/11: the delivery-mode question in the new words
    expect(otherFieldAsked('T7ebb nwasslouha l dar wela l bureau ?')).toBe(true);
    expect(otherFieldAsked('تحب نوصلوها للدار ولا للمكتب ؟')).toBe(true);
    expect(otherFieldAsked(Q3_AI)).toBe(false);
    expect(otherFieldAsked('Voulez-vous passer commande ?')).toBe(false);
    const none = () => false;
    expect(await quantityAbove('nheb 7', 5, none)).toBeNull();
    expect(await quantityAbove('nheb 7', 5, none, { selling: true, lastAi: Q3_AI })).toBe(7);
    expect(await quantityAbove('nheb 7', 5, none, { selling: false, lastAi: Q3_AI })).toBeNull();
    expect(await quantityAbove('nheb 7', 10, none, { selling: true, lastAi: Q3_AI })).toBeNull();
    expect(await quantityAbove('42', 5, none, { selling: true, lastAi: 'Kayen 40, 42 w 43.', notQuantities: [40, 42, 43] })).toBeNull();
  });
});

// --- R22-3 ------------------------------------------------------------------------------------------------------------------------------
describe('R22-3 (Minor) — the product being sold and its price before the first field question', () => {
  it('A3 T1 reproduction: the search answered from the CATALOGUE (not run) still names the product ⇒ « Tapis de prière ب\u0640 2 800 دج » before « واش من ولاية … ؟ »', async () => {
    const A3 = 'السلام، نحب زوج سجادات صلاة، سميرة بن علي ٠٥٥٠١٢٣٤٥٦';
    const { r, gateway, execute } = await turnOf(A3, 'ar', [{ toolCalls: [{ name: 'search_products', args: { query: 'Tapis de prière', limit: 1 } }] }, { toolCalls: [{ name: 'quote_delivery', args: {} }] }, { reply: 'تمام يا سميرة. واش من ولاية تحبي نوصلوهم ليها؟', intent: 'SALE' }], { products: J03R });
    // (the search was answered without running — the R22 path)
    expect(ran(execute, 'search_products')).toHaveLength(0);
    const reply = plain(r.output.reply);
    expect(reply).toContain('Tapis de prière ب\u0640 2 800 دج.');
    expect(reply.indexOf('Tapis de prière')).toBeLessThan(reply.indexOf('واش من ولاية'));
    // R22-2: once the quote was refused for naming no wilaya, quote_delivery is not offered again (A3: a 3rd call for the same `{}`)
    expect(gateway.calls).toHaveLength(3);
    expect(offered(gateway, 2)).not.toContain('quote_delivery');
  });

  it('PH4 T1 reproduction: « I want 1 prayer rug … » (no catalogue word, no search) — the model quoted `subtotal 2800` ⇒ « Tapis de prière: 2 800 DA. » before the fees', async () => {
    const PH4 = 'Hi, I want 1 prayer rug delivered at home to Blida, Boufarik, cité 20 août villa 3, John Doe, 077099887';
    const REPLY = 'Thanks, John! The delivery to Boufarik (Blida) is 450 DA at home, and it takes 2 to 5 days. Stop-desk delivery is 300 DA. The phone number you sent, 077099887, is missing a digit. Could you send it again with all 10 digits, for example 0555123456?';
    const { r } = await turnOf(PH4, 'en', [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Blida', subtotal: 2800, isStopdesk: false } }] }, { reply: REPLY, intent: 'SALE' }], { products: J03R });
    const reply = plain(r.output.reply);
    expect(reply).toContain('Tapis de prière: 2 800 DA.');
    expect(reply.indexOf('Tapis de prière')).toBeLessThan(reply.indexOf('The delivery'));
    expect(reply).toContain('missing a digit');
  });

  it('a subtotal two products could make names none; catalogue-answered searches count as found', async () => {
    const prices = guardOf('x', 'fr', J03R).cataloguePrices ?? [];
    expect(knownProductIds({ args: { query: 'Tapis de prière' } }, { products: [], inCatalogue: true }, prices)).toEqual([TAPIS.id]);
    expect(knownProductIds({ args: { query: 'sac' } }, { products: [], inCatalogue: true }, prices)).toEqual([SAC.id]);
    expect(knownProductIds({ args: { query: 'cuir' } }, { products: [{ id: 'p1' }] }, prices)).toEqual(['p1']);
    expect(knownProductIds({ args: { query: 'zzz' } }, { products: [], inCatalogue: true }, prices)).toEqual([]);
  });
});

// --- R22-2 ------------------------------------------------------------------------------------------------------------------------------
describe('R22-2 (Minor) — the MSA yes to the server recap is a yes; no lookup on an order message', () => {
  const ORDER = { clientName: 'فاطمة الزهراء بوعلام', clientPhone: '0555987654', secondPhone: null, wilayaId: 31, communeName: 'بئر الجير', address: 'حي 1000 مسكن رقم 12', isStopdesk: false, stopdeskId: null, notes: null, items: [{ productId: 'abaya', variantId: null, quantity: 1 }], replacesOrder: null };
  const RECAP = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd-c4', core: 'c-c4' }, recapToShow: true, recap: { items: [{ name: 'عباية مطرزة', variant: null, quantity: 1, unitPrice: 6500 }], subtotal: 6500, deliveryFee: 600, total: 7100, clientName: ORDER.clientName, clientPhone: ORDER.clientPhone, wilaya: 'Oran', wilayaAr: 'وهران', communeName: ORDER.communeName, address: ORDER.address, isStopdesk: false }, draftOrder: ORDER };
  const C4_RECAP_TEXT = withMsaWording('هذا ملخص الطلبية:\n- 1 × عباية مطرزة : 6 500 دج\nجاوبني ب\u0640 « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو.');

  it('C4 T6 reproduction: « نعم، أؤكد الطلب » to the MSA recap ⇒ the recap’s stored order (the server places it, no model call)', () => {
    expect(C4_RECAP_TEXT).toContain('أجبني ب\u0640 « نعم » لتأكيد الطلب');
    expect(serverRecapAsked(C4_RECAP_TEXT)).toBe(true);
    const history: OrderCallHistory = [{ name: 'create_order', result: RECAP, at: new Date(Date.now() - 60_000) }];
    for (const yes of ['نعم، أؤكد الطلب', 'نعم أوافق على الطلب', 'حسناً، أؤكد طلبي', 'نعم'])
      expect([yes, recapYesArgs(history, yes, serverRecapAsked(C4_RECAP_TEXT))]).toEqual([yes, expect.objectContaining({ clientPhone: '0555987654', customerConfirmed: true })]);
    // a change or a refusal is no yes
    expect(bareYes('نعم، لكن غيّر العنوان', RECAP.recap.clientName)).toBe(false);
    expect(confirmation('لا، لا أؤكد الطلب')).toBe('no');
  });

  it('PH1 T1: an order message whose only order word is « livraison » gets no lookup_order', async () => {
    const PH1 = 'Je veux 1 hijab soie, livraison Alger Bab Ezzouar rue des frères Bouadou n 5, Amine Kaci 0698765';
    const { gateway } = await turnOf(PH1, 'fr', [{ reply: 'Merci Amine ! Hijab soie : 1 500 DA. Le numéro 0698765 semble incomplet : pouvez-vous me le redonner ?', intent: 'SALE' }]);
    expect(offered(gateway, 0)).not.toContain('lookup_order');
    // a tracking question keeps it
    const track = await turnOf('ma livraison est où ? je veux savoir si le colis est parti', 'fr', [{ reply: 'Je regarde.', intent: 'TRACKING' }]);
    expect(offered(track.gateway, 0)).toContain('lookup_order');
  });
});

// --- R22-4 ------------------------------------------------------------------------------------------------------------------------------
describe('R22-4 (Cosmetic) — wording', () => {
  it('CQ1 T3: « je veux annuler ? » gets no product price line in the cancel question', async () => {
    const T1 = 'Je prends 2 tapis de prière, livraison à domicile, Amine Kaci 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5';
    const placed: OrderCallHistory = [{ name: 'create_order', result: { ok: true, number: 'TEST-4234', simulated: true, total: 6000, items: [{ name: 'Tapis de prière', variant: null, quantity: 2, unitPrice: 2800 }] }, at: new Date(Date.now() - 30_000) }];
    const REPLY = 'Bien sûr. Voulez-vous vraiment annuler la commande TEST-4234 (2 × Tapis de prière) ? Répondez « oui » pour que je l’annule.';
    const { r } = await turnOf('je veux annuler ?', 'fr', [{ reply: REPLY, intent: 'TRACKING' }], { history: [T1, 'oui'], assistant: ['Voici le récapitulatif …', 'Votre commande TEST-4234 est bien enregistrée ✅'], orderHistory: placed, products: J03R, defs: ['lookup_order', 'cancel_order'] });
    expect(plain(r.output.reply)).not.toContain('2 800');
    expect(r.output.reply).toContain('TEST-4234');
  });

  it('C4 T4: « المكتب (المكتب) » ⇒ one term; other brackets stay', () => {
    expect(withMsaWording('التوصيل إلى وهران: 600 دج للتوصيل للمنزل، أو 400 دج إلى المكتب (ستوب ديسك).')).toBe('التوصيل إلى وهران: 600 دج للتوصيل للمنزل، أو 400 دج إلى المكتب.');
    expect(withMsaWording('أو 400 دج إلى نقطة الاستلام (stop-desk).')).toBe('أو 400 دج إلى نقطة الاستلام (stop-desk).');
  });

  it('M3 T1: the product line goes before the delivery remark; P3 « أيه » ⇒ « إيه »', () => {
    const out = plain(withPlaceFacts('التوصيل ممكن يطول شوية، تقدر تطلبها. واش سميتك؟', [], { name: 'Montre connectée', price: 15_900 }, 'ar'));
    expect(out).toBe('Montre connectée ب\u0640 15 900 دج. التوصيل ممكن يطول شوية، تقدر تطلبها. واش سميتك؟');
    expect(withArabicWords('أيه، الساعة الذكية متوفرة للطلب ب\u0640 15 900 دج.', 'ar')).toMatch(/^إيه، /u);
  });
});
