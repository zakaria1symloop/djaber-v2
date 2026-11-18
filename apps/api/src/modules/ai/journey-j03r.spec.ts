// Journey re-run J03r (18/11, docs/audit/journeys-2026-11-18/journeys/J03.md): an order above « Quantité max par commande » cut to the
// maximum and recapped (J03r-1, Major), the step-5 « Grosse quantité » row passing with no hand-off (J03r-2). Transcripts:
// .local/qa/journeys/J03r/out/transcripts/LIM.json, LIM2.json, CQ-*.json.
import { prisma } from '@djaber/db';
import { AiRunService, orderClosedBy, type TurnRequest } from './ai-run.service';
import { orderLimitOf, quantitiesAsked, quantityAbove } from './order-limit';
import { PlaygroundService } from './playground.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { limitHandoffReply } from './reply-fixes';
import { buildGuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
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

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, label: 'Haiku', ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = {
  call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
  route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
};
// the J03r agent: max 5 per order / 50 000 DA
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: 5, maxAmountPerOrder: 50_000, sellAllProducts: true } as never;
const TAPIS = { id: '01a1ef35-9ae4-7287-910c-d1b2a2096b3a', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 15, sellOutOfStock: false };
const COFFRET = { id: '01a1ef35-99e9-7f95-90f7-109d2fb56b36', name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 4, sellOutOfStock: false };
const PRODUCTS = [TAPIS, COFFRET];
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en') =>
  buildGuardFacts({ lang, products: PRODUCTS.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Sofiane', customerText, answeredBefore: true, freshStart: false });
const ctxOf = (customerText: string, history: string[]): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory: [], ordering: false });

const LIMIT_QTY = { ok: false, hint: 'order_limit', limit: 'quantity', maxQty: 5, maxAmount: 50_000, quantity: 6, total: 17_200 };
const RECAP_5 = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd5', core: 'c5' }, recapToShow: true, recap: { items: [{ name: 'Tapis de prière', variant: null, quantity: 5, unitPrice: 2800 }], subtotal: 14_000, deliveryFee: 400, total: 14_400, clientName: 'Amine Kaci', clientPhone: '0698765432', wilaya: 'Alger', wilayaAr: 'الجزائر', communeName: 'Bab Ezzouar', communeAr: 'باب الزوار', address: 'rue des frères Bouadou n 5', isStopdesk: false } };

const turnOf = async (said: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', answers: Parameters<FakeAiGateway['script']>[1][], o: { history?: string[]; orders?: unknown[]; sold?: string | null; outOfHours?: boolean } = {}) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const orders = [...(o.orders ?? [])];
  const execute = jest.fn(async (name: string) => (name === 'create_order' ? (orders.shift() ?? {}) : name === 'quote_delivery' ? { ok: true, wilayaId: 16, wilayaName: 'Alger', fee: 400, stopdeskFee: 250, etaDays: '2–5' } : {}));
  const defs = (['quote_delivery', 'search_products', 'create_order', 'handoff_to_human'] as const).map((d) => TOOL_DEFS[d]);
  const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
  const tools = { defsFor: async () => defs, execute, forcedHandoff: (n: string, a: Record<string, unknown>, r: unknown) => registry.forcedHandoff(n, a, r), soldProductNamed: async () => o.sold ?? null } as unknown as ToolRegistry;
  const history = o.history ?? [];
  const messages = [...history.map((h) => ({ role: 'user', content: h })), { role: 'user', content: said }];
  const guard = { ...guardOf(said, lang), ...(o.outOfHours ? { outOfHours: true } : {}) };
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages } as never, toolCtx: ctxOf(said, history), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return { r, execute, gateway };
};
const ran = (execute: jest.Mock, name: string) => execute.mock.calls.filter((c) => c[0] === name);
const plain = (s: string) => s.replace(/[^\S\n]/gu, ' ');

describe('J03r-1 (Major) — an order above « Quantité max par commande » is handed to the team, never cut to the maximum', () => {
  const LIM_T1 = 'Je veux 6 tapis de prière, livraison à domicile à Alger, Bab Ezzouar, rue des frères Bouadou n 5, Amine Kaci 0698765432';

  it('LIM T1 reproduction: « 6 tapis » with max 5 ⇒ hand-off before any model call, the sentence names the limit, no create_order', async () => {
    const { r, gateway, execute } = await turnOf(LIM_T1, 'fr', [{ toolCalls: [{ name: 'create_order', args: { items: [{ productId: TAPIS.id, quantity: 6 }] } }] }]);
    expect(gateway.calls).toHaveLength(0);
    expect(ran(execute, 'create_order')).toHaveLength(0);
    expect(r.forcedHandoff).toBe('order_limits');
    expect(r.output.status).toBe('HANDOFF');
    expect(r.output.reply).toBe("Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre.");
    expect(r.output.reply).not.toMatch(/récapitulatif|Répondez « oui »/u);
  });

  it('LIM2 / the playground chip: « 8 tapis », « 500 pièces de votre premier produit » ⇒ the same hand-off', async () => {
    for (const said of ['Je voudrais 8 tapis de prière, livraison en stop-desk à Blida, Walid Bouzid 0555123456', 'Je veux commander 500 pièces de votre premier produit']) {
      const { r, gateway } = await turnOf(said, 'fr', [{ reply: 'Nous ne pouvons pas prendre plus de 5 pièces par commande. Combien en voulez-vous, jusqu’à 5 ?', intent: 'SALE' }]);
      expect(gateway.calls).toHaveLength(0);
      expect(r.forcedHandoff).toBe('order_limits');
      expect(r.output.reply).toContain('ne peut pas dépasser 5 pièces');
    }
  });

  it('fr / ar / arabizi / en: the limit sentence in the customer’s script', async () => {
    const cases: [string, 'ar' | 'arabizi' | 'en', string][] = [
      ['نحب 6 حبات من سجادة الصلاة', 'ar', 'الطلبية الوحدة ما تفوتش 5 حبات، راني نبعث طلبك لفريق المحل وراح يجاوبك.'],
      ['salam nheb 6 tapis de prière l Alger', 'arabizi', "La commande wa7da ma tfoutch 5 pièces, rani nba3at talab ta3ek l l'équipe ta3 lboutique w rah tjawbek."],
      ['Hi, I want 8 pieces of the tapis de prière please', 'en', "One order can't go above 5 pieces: I'm passing your request to the shop's team, who will answer you."],
    ];
    for (const [said, lang, reply] of cases) {
      const { r, gateway } = await turnOf(said, lang, [{ reply: '…', intent: 'SALE' }], { sold: 'Tapis de prière' });
      expect(gateway.calls).toHaveLength(0);
      expect(r.output.reply).toBe(reply);
    }
  });

  it('the quantity said earlier: create_order {6} ⇒ order_limit, the model’s second create_order {5} of the same step is not run ⇒ hand-off, 1 model call', async () => {
    const said = 'Amine Kaci 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5';
    const call = { clientName: 'Amine Kaci', clientPhone: '0698765432', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'rue des frères Bouadou n 5', isStopdesk: false };
    const { r, gateway, execute } = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'create_order', args: { ...call, items: [{ productId: TAPIS.id, quantity: 6 }] } }, { name: 'create_order', args: { ...call, items: [{ productId: TAPIS.id, quantity: 5 }], customerConfirmed: false } }] }, { reply: 'Voici le récapitulatif …', intent: 'SALE' }], { history: ['Je veux des tapis de prière, il m’en faut six'], orders: [LIMIT_QTY, RECAP_5] });
    expect(gateway.calls).toHaveLength(1);
    expect(ran(execute, 'create_order')).toHaveLength(1);
    expect(r.forcedHandoff).toBe('order_limits');
    expect(r.output.reply).toBe("Une commande ne peut pas dépasser 5 pièces : je transmets votre demande à l'équipe de la boutique, qui va vous répondre.");
  });

  it('LIM T2: the amount limit (3 coffrets, 74 970 DA) ⇒ the sentence names the amount; out of hours it says the opening', async () => {
    const said = 'Bon alors 3 coffrets cadeau Aïd à la place';
    const limit = { ok: false, hint: 'order_limit', limit: 'amount', maxQty: 5, maxAmount: 50_000, quantity: 3, total: 75_370 };
    const { r } = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'create_order', args: { items: [{ productId: COFFRET.id, quantity: 3 }] } }] }], { orders: [limit], history: ['Je veux 2 tapis, Amine Kaci 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5'] });
    expect(r.forcedHandoff).toBe('order_limits');
    expect(plain(r.output.reply)).toBe("Une commande ne peut pas dépasser 50 000 DA : je transmets votre demande à l'équipe de la boutique, qui va vous répondre.");
    const ooh = await turnOf(said, 'fr', [{ toolCalls: [{ name: 'create_order', args: { items: [{ productId: COFFRET.id, quantity: 3 }] } }] }], { orders: [limit], history: ['Je veux 2 tapis, Amine Kaci 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5'], outOfHours: true });
    expect(ooh.r.output.reply).toContain("absente pour le moment, qui vous répondra dès l'ouverture");
  });

  it('a wholesale request (« prix de gros pour 50 pièces ») is not the limit: it goes to the model and keeps its wholesale sentence', async () => {
    const { gateway, r } = await turnOf('Bonjour, prix de gros pour 50 pièces du hijab soie ?', 'fr', [{ reply: 'Je transmets.', intent: 'SALE' }]);
    expect(gateway.calls).toHaveLength(1);
    expect(r.forcedHandoff).not.toBe('order_limits');
  });

  it('within the limit nothing changes: « 2 tapis », « 5 tapis » go to the model', async () => {
    for (const said of ['Je veux 2 tapis de prière', 'Je veux 5 tapis de prière']) {
      const { r, gateway } = await turnOf(said, 'fr', [{ reply: 'Très bien ! Dans quelle wilaya souhaitez-vous être livré ?', intent: 'SALE' }]);
      expect(gateway.calls).toHaveLength(1);
      expect(r.forcedHandoff).toBeNull();
    }
  });

  it('quantitiesAsked / quantityAbove: a number that counts pieces or names a product — never an address, a size, a phone, a price', async () => {
    const product = (w: string) => /(?:^| )(?:tapis|coffret)/u.test(w);
    expect(quantitiesAsked('Je veux commander 500 pièces de votre premier produit')).toEqual([{ quantity: 500, unit: true, next: 'pieces de votre' }]);
    expect(quantitiesAsked('bghit 7 7bat')).toEqual([{ quantity: 7, unit: true, next: '7bat' }]);
    expect(quantitiesAsked('٨ حبات')).toEqual([{ quantity: 8, unit: true, next: 'حبات' }]);
    expect(await quantityAbove('Je veux 6 tapis de prière', 5, product)).toBe(6);
    expect(await quantityAbove('6x tapis', 5, product)).toBe(6);
    expect(await quantityAbove('je prends 10 de vos tapis', 5, product)).toBe(10);
    expect(await quantityAbove('Amine Benali, 0555 12 34 56, Bab Ezzouar, Cité des 200 logements, 12 pièces', 5, product)).toBe(12);
    for (const said of [
      'Cité 500 logements bloc 12, El Eulma',
      'rue des frères Bouadou n 6 tapis',
      'pointure 41 svp',
      'mon numéro 0698765432',
      'le coffret à 24990 DA ?',
      'Parfum Oud 50 ml',
      'il me faut 6',
      'Je veux 2 tapis de prière',
      'commande TEST-7532',
      'ch7al tawsil l setif ?',
      'taille 42',
    ])
      expect(await quantityAbove(said, 5, product)).toBeNull();
    expect(await quantityAbove('Je veux 6 tapis', null, product)).toBeNull();
  });

  it('the tool answer names the limit; the server hands off on it and create_order is closed for the turn', () => {
    expect(orderLimitOf(LIMIT_QTY)).toEqual({ kind: 'quantity', value: 5 });
    expect(orderLimitOf({ ok: false, hint: 'order_limit', maxQty: 5, maxAmount: 50_000, quantity: 3 })).toEqual({ kind: 'amount', value: 50_000 });
    expect(orderLimitOf({ ok: false, hint: 'order_limit', maxQty: 5, maxAmount: null })).toEqual({ kind: 'quantity', value: 5 });
    expect(orderLimitOf(RECAP_5)).toBeNull();
    const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
    expect(registry.forcedHandoff('create_order', {}, LIMIT_QTY)).toBe('order_limits');
    expect(orderClosedBy('create_order', LIMIT_QTY)).toBe(true);
    expect(limitHandoffReply({ kind: 'quantity', value: 1 }, 'fr')).toContain('1 pièce :');
    expect(limitHandoffReply({ kind: 'quantity', value: 12 }, 'ar')).toContain('12 حبة');
  });
});

describe('J03r-2 — the step-5 « Grosse quantité » row passes only on the limit hand-off', () => {
  const turn = (o: Partial<{ status: string; statusDetail: string | null; reply: string; toolCalls: unknown[] }>) => ({ reply: 'Le Basket Runner est disponible … Ensuite, je vérifierai si on peut vous fournir 500 pièces.', status: 'OK', statusDetail: null, cards: [], toolCalls: [], ...o }) as never;
  it('max 5: no hand-off ⇒ ✗ limits_respected; the order_limits hand-off ⇒ ✓', () => {
    expect(PlaygroundService.check('qty_limit', turn({}), new Set(), { maxQty: 5 })).toEqual({ pass: false, failed: ['limits_respected'] });
    expect(PlaygroundService.check('qty_limit', turn({ status: 'HANDOFF', statusDetail: 'order_limits', reply: 'Une commande ne peut pas dépasser 5 pièces …' }), new Set(), { maxQty: 5 })).toEqual({ pass: true, failed: [] });
    // another hand-off reason is not the limit
    expect(PlaygroundService.check('qty_limit', turn({ status: 'HANDOFF', statusDetail: 'other' }), new Set(), { maxQty: 5 }).pass).toBe(false);
  });
  it('no quantity limit (or one above 500): no order created is enough, as before', () => {
    expect(PlaygroundService.check('qty_limit', turn({}), new Set(), { maxQty: null }).pass).toBe(true);
    expect(PlaygroundService.check('qty_limit', turn({}), new Set(), { maxQty: 1000 }).pass).toBe(true);
    expect(PlaygroundService.check('qty_limit', turn({ toolCalls: [{ name: 'create_order', result: { ok: true }, simulated: true }] }), new Set(), { maxQty: null }).pass).toBe(false);
  });
});
