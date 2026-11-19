// journey J08v (19/11) — J08v-2: a first message naming two products gets every named product's price before the first field question
// (the server's R18-2 / R22-3 price line gave one of them). Transcripts: .local/qa/journeys/J08v/s08b.log, s08c.log.
import { prisma } from '@djaber/db';
import { AiRunService, type TurnRequest } from './ai-run.service';
import { productNamedIn, productsNamedIn } from './product-named';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Alger centre', nameAr: 'الجزائر الوسطى' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] },
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

const RULES: Record<number, { home: number; stop: number }> = { 16: { home: 500, stop: 350 }, 31: { home: 700, stop: 400 } };
const quoteOf = (args: Record<string, unknown>) => {
  const w = PLACES.find((p) => p.nameFr === args.wilayaName)!;
  const stop = args.isStopdesk === true;
  return { ok: true, wilayaId: w.id, wilayaName: w.nameFr, wilayaNameAr: w.nameAr, isStopdesk: stop, fee: stop ? RULES[w.id]!.stop : RULES[w.id]!.home, free: false, freeFrom: 10_000, freeFor: 'home', stopdeskAvailable: true, stopdeskFee: RULES[w.id]!.stop, etaDays: '2–5' };
};

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, label: 'Haiku', ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = {
  call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }),
  route: async () => ({ capability: 'text', primary: model, fallback: null, failoverActive: false }),
};
const AGENT = { id: 'a', humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, sellAllProducts: true } as never;

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const p = (id: string, name: string, price: number): Product => ({ id, name, price, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false });
// the journey shop, in the order of its catalogue (the porte-clés before the tapis)
const COUSSIN = p('01a1f33b-0000-7000-8000-000000000001', 'QA J08v Coussin brodé', 2400);
const PORTE = p('01a1f33b-0000-7000-8000-000000000002', 'QA J08v Porte-clés', 600);
const TAPIS = p('01a1f33b-0000-7000-8000-000000000003', 'QA J08v Tapis berbère', 9800);
const LAMPE = p('01a1f33b-0000-7000-8000-000000000004', 'QA J08v Lampe en cuivre', 4600);
const FOULARD = p('01a1f33b-0000-7000-8000-000000000005', 'QA J08v Foulard soie', 1200);
const SHOP = [COUSSIN, FOULARD, PORTE, TAPIS, LAMPE];
const found = (x: Product) => ({ products: [{ id: x.id, name: x.name, sku: 'S', price: x.price, oldPrice: null, stock: 'in stock', hasVariants: false, variants: [], imageUrl: null, category: null }] });

const ctxOf = (customerText: string): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: customerText, orderHistory: [], ordering: false });
const guardOf = (customerText: string, products: Product[]) =>
  buildGuardFacts({ lang: 'fr', products: products.map((x) => ({ ...x, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: 10_000, agentName: null, shopName: 'Boutique de QA J08v', customerText, answeredBefore: false, freshStart: true });
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');

const turnOf = async (said: string, answers: Parameters<FakeAiGateway['script']>[1][], search: unknown, products: Product[] = SHOP) => {
  const gateway = new FakeAiGateway();
  gateway.script('reply', ...answers);
  const execute = jest.fn(async (name: string, args: Record<string, unknown>) => (name === 'quote_delivery' ? quoteOf(args) : name === 'search_products' ? search : {}));
  const defs = (['quote_delivery', 'search_products', 'create_order', 'lookup_order', 'handoff_to_human'] as const).map((d) => TOOL_DEFS[d]);
  const registry = Object.create(ToolRegistry.prototype) as ToolRegistry;
  const tools = { defsFor: async () => defs, execute, forcedHandoff: (n: string, a: Record<string, unknown>, r: unknown) => registry.forcedHandoff(n, a, r), soldProductNamed: async () => null } as unknown as ToolRegistry;
  const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: ctxOf(said), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, products) };
  const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
  if (!r.ok) throw new Error('turn failed');
  return plain(r.output.reply);
};

describe('J08v-2 (Minor) — every product the first message names gets its price before the first field question', () => {
  it('s08b conversation 1 reproduction: « 1 tapis berbère et 1 porte-clés, en stop-desk à Alger » ⇒ 9 800 DA and 600 DA before « Quel est votre nom complet ? »', async () => {
    const said = 'Bonjour je veux 1 tapis berbère et 1 porte-clés, en stop-desk à Alger';
    const reply = await turnOf(
      said,
      [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Alger', isStopdesk: true, subtotal: 10_400 } }, { name: 'search_products', args: { query: 'tapis berbère', limit: 1 } }] }, { reply: 'Parfait, on note le tapis berbère et le porte-clés pour un retrait en stop-desk à Alger. Quel est votre nom complet ?', intent: 'SALE' }],
      found(TAPIS),
    );
    expect(reply).toContain('QA J08v Tapis berbère : 9 800 DA.');
    expect(reply).toContain('QA J08v Porte-clés : 600 DA.');
    // in the order the customer named them, both before the name question
    expect(reply.indexOf('Tapis berbère : 9 800')).toBeLessThan(reply.indexOf('Porte-clés : 600'));
    expect(reply.indexOf('Porte-clés : 600')).toBeLessThan(reply.indexOf('Quel est votre nom'));
  });

  it('s08c conversation 1 reproduction: « 1 lampe en cuivre et 2 foulards soie, livraison à domicile à Oran » ⇒ 4 600 DA and 1 200 DA before « quel est votre nom ? »', async () => {
    const said = 'Bonjour, je voudrais 1 lampe en cuivre et 2 foulards soie, livraison à domicile à Oran';
    const reply = await turnOf(
      said,
      [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Oran', isStopdesk: false, subtotal: 7000 } }, { name: 'search_products', args: { query: 'Lampe en cuivre', limit: 1 } }] }, { reply: "Parfait, on livre à Oran à domicile pour 700 DA, avec un délai de 2 à 5 jours. En stop-desk, c'est 400 DA. Vous avez choisi 1 Lampe en cuivre et 2 Foulard soie. Pour continuer, quel est votre nom ?", intent: 'SALE' }],
      found(LAMPE),
    );
    expect(reply).toContain('QA J08v Lampe en cuivre : 4 600 DA.');
    expect(reply).toContain('QA J08v Foulard soie : 1 200 DA.');
    expect(reply.indexOf('Foulard soie : 1 200')).toBeLessThan(reply.indexOf('quel est votre nom'));
  });

  it('s08c conversation 0 (the good run): the model gave both prices and the total ⇒ nothing added', async () => {
    const said = 'Bonjour je veux 1 tapis berbère et 1 porte-clés, en stop-desk à Alger';
    const model = 'Très bon choix ! Le QA J08v Tapis berbère (9 800 DA) et le QA J08v Porte-clés (600 DA) sont disponibles. En stop-desk à Alger, la livraison est de 350 DA, soit un total de 10 750 DA. Quel est votre nom complet ?';
    const reply = await turnOf(said, [{ toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Alger', isStopdesk: true, subtotal: 10_400 } }, { name: 'search_products', args: { query: 'tapis berbère', limit: 1 } }] }, { reply: model, intent: 'SALE' }], found(TAPIS));
    expect(reply.match(/9 800 DA/gu)).toHaveLength(1);
    expect(reply.match(/600 DA/gu)).toHaveLength(1);
  });

  it('productsNamedIn: every named product in the text order; a product named only by words of a better-named one is left out; the same words name none', () => {
    const PRIERE = p('x-priere', 'Tapis de prière', 2800);
    const BERBERE = p('x-berbere', 'Tapis berbère', 9800);
    const HIJAB = p('x-hijab', 'Hijab soie', 1500);
    const FOUL = p('x-foulard', 'Foulard soie', 1200);
    expect(productsNamedIn('je veux 1 tapis berbère et 1 porte-clés', SHOP).map((x) => x.name)).toEqual([TAPIS.name, PORTE.name]);
    expect(productsNamedIn('1 lampe en cuivre et 2 foulards soie', SHOP).map((x) => x.name)).toEqual([LAMPE.name, FOULARD.name]);
    // « tapis berbère » is not « Tapis de prière » (first word only) — productNamedIn alone took the first of the catalogue
    expect(productNamedIn('je veux un tapis berbère', [PRIERE, BERBERE])).toBe(PRIERE);
    expect(productsNamedIn('je veux un tapis berbère', [PRIERE, BERBERE])).toEqual([BERBERE]);
    expect(productsNamedIn('un foulard soie', [HIJAB, FOUL])).toEqual([FOUL]);
    // « un tapis » names both the same way: none (the caller keeps its single-product rule)
    expect(productsNamedIn('je veux un tapis', [PRIERE, BERBERE])).toEqual([]);
    expect(productsNamedIn('tapis de prière et tapis berbère', [PRIERE, BERBERE])).toEqual([PRIERE, BERBERE]);
    expect(productsNamedIn('bonjour, livraison à Oran ?', SHOP)).toEqual([]);
  });

  it('a list of four products or more (the catalogue, alternatives) gets no price line for the extra ones', async () => {
    const said = 'vous avez coussin brodé, foulard soie, porte-clés et lampe en cuivre ?';
    const reply = await turnOf(said, [{ reply: 'Oui, nous avons tout cela en stock. Lequel vous intéresse ?', intent: 'SALE' }], { products: [] });
    expect((reply.match(/ DA\b/gu) ?? []).length).toBeLessThanOrEqual(1);
  });
});
