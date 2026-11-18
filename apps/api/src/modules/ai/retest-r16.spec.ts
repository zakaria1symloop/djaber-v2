// Journey retest R16 (18/11, docs/audit/journeys-2026-11-16/journeys/R16-ai-orders.md): a fee the customer asked for lost when the guard
// stripped a sentence, and the F9 closing back (R16-1, F9); the model's own hand-off keeping its refusal (R16-2, W1); redundant lookups
// across turns (R16-3, PF1 T2, N1 T2, N14 T1, N5 T2, F9 T1); wording (R16-4, N21 T1, N18 T1, F1 T1, F1b T2, F5b / P2 / PF2 T1, C2).
// Transcripts: .local/qa/journeys/R16/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, catalogueAvailability, earlierQuoteAnswered, earlierSearchAnswered, knownQuotesNote, RECAP_COMPUTES_RESULT, strayDeliverySearch, validEarlierQuotes, type TurnRequest } from './ai-run.service';
import { moroccanIn, wrongDarijaIn } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { handoffReply, teamOnlyKind, withArabiziWords, withAskedFacts, withOneStopdeskOffer, withoutBookingOffer, withoutRefusals, withSingleSpaces, withSpacedAmounts } from './reply-fixes';
import { buildGuardFacts, checkReply, earlierLookups, enforceReply, guardInstruction, missingQuotes, owedQuotes, quoteFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, type ToolRegistry } from './tools/tool-registry';

const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
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
type FactsInput = Parameters<typeof buildGuardFacts>[0];
const HIJAB = { id: '01a1e51f-450a', name: 'Hijab soie', sku: 'PRD-HIJ', price: 1500, oldPrice: 2000, hasVariants: false, also: [], description: 'Hijab en soie douce, 180 x 70 cm.', stock: 20, sellOutOfStock: false, imageUrl: null, variants: [] };
const OUD = { id: 'oud', name: 'Parfum Oud 50 ml', sku: 'PRD-OUD', price: 3200, oldPrice: null, hasVariants: false, also: [], description: 'Parfum oriental.', stock: 0, sellOutOfStock: false, imageUrl: null, variants: [] };
const SAC = { id: 'sac', name: 'Sac à main cuir', sku: 'PRD-SAC', price: 6900, oldPrice: null, hasVariants: true, also: [], description: 'Sac en cuir.', stock: 7, sellOutOfStock: false, imageUrl: null, variants: [{ id: 'v-noir', name: 'Noir', price: 6900, stock: 0 }, { id: 'v-marron', name: 'Marron', price: 6900, stock: 7 }] };
const RETOUCHE = { id: 'ret', name: 'Retouche couture', sku: 'PRD-RET', price: 800, oldPrice: null, hasVariants: false, also: [], description: 'Service de retouche.', stock: null, sellOutOfStock: false, imageUrl: null, variants: [] };
const facts = (customerText: string, o: Partial<FactsInput> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [HIJAB, OUD, SAC, RETOUCHE] as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: false, freshStart: false, ...o });
/** The server's fee sentences write the amount with a thin space (« 650 DA »): compared with plain spaces. */
const plain = (s: string) => s.replace(/[\u00a0\u202f\u2009]/gu, ' ');
const service = (gateway: FakeAiGateway, tools: Partial<Record<keyof ToolRegistry, unknown>>) => new AiRunService(gateway, routing as never, { forcedHandoff: () => null, ...tools } as unknown as ToolRegistry, {} as never, {} as never, {} as never);
const SETIF = { ok: true, wilayaId: 19, wilayaName: 'Sétif', wilayaNameAr: 'سطيف', isStopdesk: false, fee: 650, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 350, etaDays: '2–5' };
const ORAN_SD = { ok: true, wilayaId: 31, wilayaName: 'Oran', wilayaNameAr: 'وهران', isStopdesk: true, fee: 400, free: false, freeFrom: 20000, freeFor: 'home', stopdeskAvailable: true, stopdeskFee: 400, etaDays: '2–5' };
const ILLIZI = { ok: false, error: { code: 'WILAYA_NOT_SERVED', wilayaId: 33, wilayaName: 'Illizi', stopdeskAvailable: false } };
const BLIDA = { ok: true, wilayaId: 9, wilayaName: 'Blida', wilayaNameAr: 'البليدة', isStopdesk: false, fee: 450, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 300, etaDays: '2–5' };

// --- R16-1 -------------------------------------------------------------------------------------------------------------------------
describe('R16-1 (Minor) — asked facts survive the guard: every quoted wilaya keeps its fee; the F9 closing family', () => {
  const F9 = 'slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ?';
  const quoteOf = (args: { wilayaName?: string; wilayaId?: number }) => (/s[ée]tif/iu.test(args.wilayaName ?? '') || args.wilayaId === 19 ? SETIF : /oran/iu.test(args.wilayaName ?? '') || args.wilayaId === 31 ? ORAN_SD : ILLIZI);

  it('F9 T1 reproduction: Moroccan form + Oran left out, the corrective turn drops every fee ⇒ Sétif AND Oran come back, Illizi kept, the closing reworded, no stray search', async () => {
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      {
        toolCalls: [
          { name: 'quote_delivery', args: { wilayaName: 'Sétif', isStopdesk: false } },
          { name: 'quote_delivery', args: { wilayaName: 'Oran', isStopdesk: true } },
          { name: 'quote_delivery', args: { wilayaName: 'Illizi', isStopdesk: false } },
          { name: 'search_products', args: { query: 'Retouche couture', limit: 1 } },
        ],
      },
      // the first answer: a Moroccan form, and no word on Oran
      { reply: 'Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk. Illizi, tawsil dyal Illizi makach f had lwaqt. T7ebb nwarrik produit men les produits li 3andna ?', intent: 'INFO' },
      // the corrective answer: still Moroccan, and every fee dropped (as the live run's `remaining`)
      { reply: 'Illizi, ma nwasslouch l Illizi f had lwaqt, wallah. Wach bghiti chi haja okhra ? T7ebb nwarrik produit men les produits li 3andna ?', intent: 'INFO' },
    );
    const execute = jest.fn(async (name: string, args: { wilayaName?: string; wilayaId?: number }) => (name === 'quote_delivery' ? quoteOf(args) : { products: [{ id: RETOUCHE.id, name: RETOUCHE.name, price: 800, stock: 'service', variants: [] }] }));
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.search_products], execute }).turn(turnReq(F9, [], { guard: facts(F9, { lang: 'arabizi' }) }));
    if (!r.ok) throw new Error('turn failed');
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['quote_delivery', 'quote_delivery', 'quote_delivery']);
    expect(r.guard).toMatchObject({ retried: true, action: 'stripped' });
    expect(plain(r.output.reply)).toContain('Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk.');
    expect(plain(r.output.reply)).toContain('Tawsil l Oran: 400 DA f stop-desk.');
    expect(r.output.reply).toMatch(/Illizi/u);
    // journey retest R17-5: a delivery-only question gets no closing offer of the products (« T7ebb nwarrik wach kayen 3andna ? » goes)
    expect(r.output.reply).not.toMatch(/nwarrik|kayen 3andna/u);
    expect(r.output.reply).not.toMatch(/wallah|produit|dyal|bghiti/u);
    expect(moroccanIn(r.output.reply) || wrongDarijaIn(r.output.reply)).toBe(false);
  });

  it('fee_missing is per wilaya: one quoted wilaya left out is a violation; every fee given is none', () => {
    const quotes = quoteFacts([SETIF, ORAN_SD].map((result) => ({ name: 'quote_delivery', result })));
    const f = { ...facts(F9, { lang: 'arabizi' }), quotes };
    expect(checkReply('Tawsil l Sétif: 650 DA l dar.', f).map((v) => v.rule)).toContain('fee_missing');
    expect(checkReply('Tawsil l Sétif: 650 DA l dar, l Oran 400 DA f stop-desk.', f).map((v) => v.rule)).not.toContain('fee_missing');
    expect(missingQuotes('Sétif 350 DA.', quotes).map((q) => q.wilaya)).toEqual(['Oran']);
    // R1 / R4 F9 T2 « w l Oran stop desk ch7al ? »: Sétif re-quoted by the model on its own — only the wilaya asked owes its fee
    const t2 = { ...facts('w l Oran stop desk ch7al ?', { lang: 'arabizi' }), quotes };
    expect(checkReply('Tawsil l Oran f stop-desk: 400 DA.', t2).map((v) => v.rule)).not.toContain('fee_missing');
    // a message naming no wilaya: one fee of any quote (J03-2); the Arabic names count as named
    expect(owedQuotes('Oran 400 DA.', quotes, 'ch7al tawsil ?')).toEqual([]);
    expect(owedQuotes('سطيف: 650 دج.', quotes, 'شحال التوصيل لسطيف ووهران ؟').map((q) => q.wilaya)).toEqual(['Oran']);
    // a home and a stop-desk quote of the same wilaya are one fact
    expect(missingQuotes('Sétif: 650 DA.', quoteFacts([SETIF, { ...SETIF, isStopdesk: true, fee: 350 }].map((result) => ({ name: 'quote_delivery', result }))))).toEqual([]);
  });

  it('a sentence dropped for a content rule takes its fee with it ⇒ the fee comes back (whatever the rule)', () => {
    const quotes = quoteFacts([{ name: 'quote_delivery', result: BLIDA }]);
    const f = { ...facts('vous livrez à Blida ?'), quotes };
    const e = enforceReply('Livraison à Blida 450 DA (quote_delivery). Autre chose ?', [{ rule: 'technical_leak', sentence: 0, kind: 'tool' }], f, { hasCards: false });
    expect(plain(e.reply)).toBe('Livraison à Blida : 450 DA à domicile, 300 DA en stop-desk. Autre chose ?');
  });

  it('withAskedFacts: an asked price / stock answer / not-served wilaya the rewrite dropped comes back; nothing when the text keeps it', () => {
    const f = { customerText: 'le hijab soie c’est combien ? vous livrez à Illizi ?', cataloguePrices: facts('x').cataloguePrices, unavailableNames: ['Parfum Oud 50 ml'], notServed: ['Illizi'] };
    expect(withAskedFacts('Autre chose ?', 'Le Hijab soie est à 1500 DA. Nous ne livrons pas à Illizi, désolé. Autre chose ?', f, 'fr')).toBe('Hijab soie : 1\u00a0500\u00a0DA. Nous ne livrons pas à Illizi pour le moment. Autre chose ?');
    expect(withAskedFacts('Le Hijab soie est à 1500 DA, pas de livraison à Illizi.', 'x', f, 'fr')).toBe('Le Hijab soie est à 1500 DA, pas de livraison à Illizi.');
    // out of stock: the price with « not available »
    expect(withAskedFacts('Wach t7ebb ?', 'Parfum Oud 50 ml b 3200 DA, makach dork. Wach t7ebb ?', { ...f, customerText: 'ch7al parfum oud ?', notServed: [] }, 'arabizi')).toBe('Parfum Oud 50 ml b 3\u00a0200\u00a0DA, bessah makach dork. Wach t7ebb ?');
    // a stock question: « is it there? » kept
    expect(withAskedFacts('Wach smitek ?', 'Hijab soie kayen. Wach smitek ?', { ...f, customerText: 'hijab soie kayen ?', notServed: [] }, 'arabizi')).toBe('Hijab soie kayen. Wach smitek ?');
    // the price was never given by the model: nothing invented by this step
    expect(withAskedFacts('Autre chose ?', 'Autre chose ?', { ...f, notServed: [] }, 'fr')).toBe('Autre chose ?');
  });

  it('the closing family (« T7ebb nwarrik produit … ? ») and the trailing oath, arabizi only', () => {
    for (const s of ['T7ebb nwarrik produit men les produits li 3andna ?', 'T7ebb nwarrik produit ?', 't7eb nwarik chi produit men 3andna ?', 'T7ebb nchouflek les produits li kaynin ?', 'T7ebb nwarrik lproduits jdad ?']) expect([s, withArabiziWords(s, 'arabizi')]).toEqual([s, s[0] === 'T' ? 'T7ebb nwarrik wach kayen 3andna ?' : 't7ebb nwarrik wach kayen 3andna ?']);
    expect(withArabiziWords('T7ebb nwarrik les tailles ?', 'arabizi')).toBe('T7ebb nwarrik les tailles ?');
    expect(withArabiziWords('Ma nwasslouch l Illizi f had lwaqt, wallah.', 'arabizi')).toBe('Ma nwasslouch l Illizi f had lwaqt.');
    expect(withArabiziWords('T7ebb nwarrik produit ?', 'fr')).toBe('T7ebb nwarrik produit ?');
  });
});

// --- R16-2 -------------------------------------------------------------------------------------------------------------------------
describe('R16-2 (Cosmetic) — the model’s own handoff_to_human gets the per-reason sentence; its refusal is dropped', () => {
  const W1 = 'Bonjour, prix de gros pour 50 pièces du hijab soie ?';
  const byTool = async (text: string, reply: string, reason: string, f: Partial<FactsInput> = {}) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'handoff_to_human', args: { reason, evidence: text } }] }, { reply, intent: 'OTHER' });
    const execute = jest.fn(async () => ({ ok: true }));
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.handoff_to_human], execute, forcedHandoff: (name: string, args: { reason?: string }) => (name === 'handoff_to_human' ? (args.reason ?? null) : null) }).turn(turnReq(text, [], { guard: facts(text, f) }));
    if (!r.ok) throw new Error('turn failed');
    return { r, execute };
  };

  it('W1 reproduction (fr, in hours): the refusal goes, the « pour info » price stays, the wholesale sentence follows', async () => {
    const { r, execute } = await byTool(W1, "Je ne peux pas vous donner de prix de gros ici. Pour info, le hijab soie est à 1500 DA l'unité (au lieu de 2000 DA).", 'off_catalogue');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.forcedHandoff).toBe('off_catalogue');
    expect(r.output.reply).toBe("Pour info, le hijab soie est à 1\u00a0500\u00a0DA l'unité (au lieu de 2\u00a0000\u00a0DA). Pour le prix de gros, l'équipe de la boutique va vous répondre.");
  });

  it('only a refusal ⇒ the wholesale sentence alone; arabizi / Arabic script / out of hours; a model text naming the team is kept', async () => {
    expect((await byTool(W1, 'Je ne peux pas vous donner de prix de gros ici.', 'off_catalogue')).r.output.reply).toBe("Pour le prix de gros, l'équipe de la boutique va vous répondre.");
    expect((await byTool('slm, ch7al soum jomla ta3 50 hijab ?', 'Sme7li, ma nqderch na3tik soum jomla hna.', 'off_catalogue', { lang: 'arabizi' })).r.output.reply).toBe("3la soum ta3 jomla, l'équipe ta3 lboutique rah tjawbek.");
    expect((await byTool('السلام، بشحال الجملة تاع 50 حجاب ؟', 'ما نقدرش نعطيك سومة الجملة هنا.', 'off_catalogue', { lang: 'ar' })).r.output.reply).toBe('على سومة الجملة، فريق المحل راح يجاوبك.');
    expect((await byTool(W1, '', 'off_catalogue', { outOfHours: true })).r.output.reply).toBe("Pour le prix de gros, l'équipe de la boutique est absente pour le moment, elle vous répondra dès l'ouverture.");
    expect((await byTool(W1, "L'équipe de la boutique vous contactera pour le prix de gros.", 'off_catalogue')).r.output.reply).toBe("L'équipe de la boutique vous contactera pour le prix de gros.");
    // a refund by the model's own call (C1 shape): its apology kept, then the refund sentence
    expect((await byTool("Bonjour, j'ai reçu ma commande cassée, je veux un remboursement", 'Je suis désolé pour votre commande cassée.', 'refund')).r.output.reply).toBe("Je suis désolé pour votre commande cassée. L'équipe de la boutique va voir le remboursement avec vous.");
  });

  it('a status hand-off of a wholesale request (no tool) also carries the sentence; other status hand-offs in hours are unchanged (R15-2)', async () => {
    const handed = async (text: string, reply: string, statusDetail: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { intent: 'OTHER', status: 'HANDOFF', reply, statusDetail, evidence: text });
      const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.handoff_to_human], execute: jest.fn() }).turn(turnReq(text, [], { guard: facts(text) }));
      if (!r.ok) throw new Error('turn failed');
      return r.output.reply;
    };
    expect(await handed(W1, 'Merci pour votre demande.', 'off_catalogue')).toBe("Merci pour votre demande. Pour le prix de gros, l'équipe de la boutique va vous répondre.");
    expect(await handed("Bonjour, j'ai reçu ma commande cassée, je veux un remboursement", 'Je suis désolé pour votre commande cassée.', 'refund')).toBe('Je suis désolé pour votre commande cassée.');
  });

  it('teamOnlyKind, withoutRefusals; every new sentence is one sentence, Latin arabizi, no Moroccan form, no quick promise out of hours', () => {
    expect(['prix de gros pour 50 pièces', 'un devis svp', 'commande sur mesure', 'partenariat avec votre boutique', 'je veux 1 hijab'].map(teamOnlyKind)).toEqual(['wholesale', 'wholesale', 'custom', 'partner', null]);
    expect(withoutRefusals("Je ne peux pas vous donner de prix de gros ici. Pour info, c'est 1500 DA.")).toBe("Pour info, c'est 1500 DA.");
    expect(withoutRefusals("I can't give a wholesale price here. The hijab is 1500 DA.")).toBe('The hijab is 1500 DA.');
    expect(withoutRefusals('Merci pour votre message.')).toBe('Merci pour votre message.');
    for (const text of ['prix de gros', 'sur mesure', 'partenariat'])
      for (const lang of ['fr', 'ar', 'arabizi', 'en'] as const)
        for (const outOfHours of [false, true]) {
          const s = handoffReply('off_catalogue', lang, { outOfHours, customerText: text });
          expect([text, lang, s.split(/[.!?؟]\s/u).length]).toEqual([text, lang, 1]);
          if (lang === 'arabizi') expect([s, /[؀-ۿ]/u.test(s) || moroccanIn(s) || wrongDarijaIn(s)]).toEqual([s, false]);
          if (lang === 'ar') expect([s, moroccanIn(s) || wrongDarijaIn(s)]).toEqual([s, false]);
          if (outOfHours) expect([s, /vite|shortly|right away|(?<!as )soon(?! as)|قريب/u.test(s)]).toEqual([s, false]);
        }
  });
});

// --- R16-3 -------------------------------------------------------------------------------------------------------------------------
describe('R16-3 (Minor) — no lookup whose answer the conversation already has', () => {
  const at = '2026-11-18T02:39:10.000Z';
  const rule = (wilayaId: number, o: Partial<{ updatedAt: Date; freeAbove: number | null; isActive: boolean }> = {}) => ({ wilayaId, updatedAt: new Date('2026-11-01T00:00:00Z'), freeAbove: null, isActive: true, ...o });

  it('earlierQuoteAnswered: home from home (free threshold on this subtotal), stop-desk from the home quote, not served; other wilayas run', () => {
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 19 } }, [SETIF])).toMatchObject({ fee: 650, fromEarlierTurn: true });
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaName: 'Setif', isStopdesk: true } }, [SETIF])).toMatchObject({ isStopdesk: true, fee: 350 });
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 33, isStopdesk: true } }, [ILLIZI])).toMatchObject({ error: { code: 'WILAYA_NOT_SERVED' } });
    const oranHome = { ...ORAN_SD, isStopdesk: false, fee: 600 };
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 31, subtotal: 25000 } }, [oranHome])).toMatchObject({ fee: 0, free: true });
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 31, subtotal: 2000 } }, [oranHome])).toMatchObject({ fee: 600, free: false });
    // only the stop-desk fee is known: a home quote runs
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 31 } }, [ORAN_SD])).toBeNull();
    expect(earlierQuoteAnswered({ name: 'quote_delivery', args: { wilayaId: 16 } }, [SETIF])).toBeNull();
  });

  it('validEarlierQuotes: a rule changed after the quote, another threshold, a not-served wilaya served since ⇒ not reused', () => {
    const earlier = [{ result: SETIF, at }, { result: ILLIZI, at }];
    expect(validEarlierQuotes(earlier, [rule(19)], null)).toEqual([SETIF, ILLIZI]);
    expect(validEarlierQuotes(earlier, [rule(19, { updatedAt: new Date('2026-11-18T03:00:00Z') })], null)).toEqual([ILLIZI]);
    expect(validEarlierQuotes(earlier, [rule(19)], 10000)).toEqual([ILLIZI]);
    expect(validEarlierQuotes(earlier, [rule(19), rule(33)], null)).toEqual([SETIF]);
    expect(validEarlierQuotes([{ result: SETIF, at: null }], [rule(19)], null)).toEqual([]);
    expect(knownQuotesNote([SETIF, ILLIZI])).toBe("DELIVERY ALREADY QUOTED in this conversation (the shop's delivery settings have not changed — no new quote_delivery is needed for these wilayas): Sétif: home 650 DA, stop-desk 350 DA; Illizi: not served.");
    expect(earlierLookups([{ name: 'quote_delivery', args: {}, result: SETIF, at: new Date(at) }, { name: 'search_products', args: { query: 'parfum' }, result: { products: [{ id: 'oud', name: 'Parfum Oud 50 ml', price: 3200 }] } }])).toEqual({ quotes: [{ result: SETIF, at }], searches: [{ args: { query: 'parfum' }, products: [{ id: 'oud', name: 'Parfum Oud 50 ml' }] }] });
  });

  it('PF1 T2 reproduction: T1 quoted Sétif ⇒ T2’s quote_delivery {19} is answered from it (not run); a delivery question still gets the fee', async () => {
    jest.spyOn(prisma.deliveryFeeRule, 'findMany').mockResolvedValue([rule(19)] as never);
    const run = async (text: string, reply: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaId: 19 } }] }, { reply, intent: 'SALE' }, { reply, intent: 'SALE' });
      const execute = jest.fn(async () => SETIF);
      const guard = facts(text, { earlierToolResults: [SETIF], earlierToolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Sétif' }, result: SETIF, at }] });
      const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.create_order], execute }).turn(turnReq(text, ["Bonjour, j'habite à Sétif, El Eulma"], { guard }));
      if (!r.ok) throw new Error('turn failed');
      return { r, execute, gateway };
    };
    const reply = 'Merci Karim ! Le sac à main cuir Marron est disponible, à 6900 DA. Quelle est votre adresse à El Eulma ?';
    const pf1 = await run('Je voudrais le sac à main cuir marron. Karim Haddad 0770112233', reply);
    expect(pf1.execute).not.toHaveBeenCalled();
    expect(pf1.gateway.calls[0]!.system).toContain('DELIVERY ALREADY QUOTED in this conversation');
    // the customer asked nothing about delivery: the model's own re-quote owes no fee (no corrective turn)
    expect(pf1.gateway.calls).toHaveLength(2);
    // (journey retest R20-4: every amount as formatMoney writes it)
    expect(pf1.r.output.reply).toBe(withSpacedAmounts(reply));
    // « ch7al tawsil l Setif ? » again: the reused quote is this turn's answer — its fee is owed
    const asked = await run('w ch7al tawsil l Setif ?', 'Saha, ana hna.');
    expect(asked.execute).not.toHaveBeenCalled();
    expect(plain(asked.r.output.reply)).toMatch(/650 DA/u);
  });

  it('N5 T2: the same search as T1 (listed products) is not run; F9: a product search on a delivery-only question is not run', () => {
    const earlier = [{ args: { query: 'parfum' }, products: [{ id: 'oud', name: 'Parfum Oud 50 ml' }] }];
    expect(earlierSearchAnswered({ name: 'search_products', args: { query: 'Parfum', limit: 3 } }, earlier, ['oud'])).toMatchObject({ fromEarlierTurn: true, products: [{ id: 'oud' }] });
    expect(earlierSearchAnswered({ name: 'search_products', args: { query: 'parfum oud' } }, earlier, ['oud'])).toBeNull();
    expect(earlierSearchAnswered({ name: 'search_products', args: { query: 'parfum' } }, earlier, ['other'])).toBeNull();
    const F9 = 'slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ?';
    const cat = facts('x').cataloguePrices;
    expect(strayDeliverySearch({ name: 'search_products', args: { query: 'Retouche couture' } }, F9, F9, cat)).toMatchObject({ notAsked: true });
    expect(strayDeliverySearch({ name: 'search_products', args: { query: 'hijab' } }, 'vous livrez le hijab à Oran ?', 'vous livrez le hijab à Oran ?', cat)).toBeNull();
    expect(strayDeliverySearch({ name: 'search_products', args: { query: 'robe' } }, 'je veux une robe, vous livrez à Oran ?', 'je veux une robe, vous livrez à Oran ?', cat)).toBeNull();
    expect(strayDeliverySearch({ name: 'search_products', args: { query: 'parfum' } }, 'et le parfum ?', 'vous livrez à Oran ?\net le parfum ?', cat)).toBeNull();
  });

  it('N1 T2: check_availability of the Marron bag (1) is answered from the CATALOGUE; a short stock, an unknown variant or product still runs', () => {
    const stock = facts('x').catalogueStock;
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'sac', variantId: 'v-marron', quantity: 1 } }, stock)).toMatchObject({ available: true, fromCatalogue: true });
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'sac', variantId: 'v-noir', quantity: 1 } }, stock)).toBeNull();
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'sac', variantId: 'v-marron', quantity: 9 } }, stock)).toBeNull();
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'sac' } }, stock)).toBeNull();
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'ret', quantity: 4 } }, stock)).toMatchObject({ available: true });
    expect(catalogueAvailability({ name: 'check_availability', args: { productId: 'oud' } }, stock)).toBeNull();
  });

  it('N14 T1 reproduction: every field in the message ⇒ the quote before the recap call is not run, the note says create_order computes it', async () => {
    const text = 'Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Blida' } }] }, { reply: 'Quelle taille ?', intent: 'SALE' });
    const execute = jest.fn(async () => BLIDA);
    const r = await service(gateway, { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.create_order], execute }).turn(turnReq(text, [], { guard: facts(text) }));
    if (!r.ok) throw new Error('turn failed');
    expect(execute).not.toHaveBeenCalled();
    expect((gateway.calls[1]!.messages.filter((m) => m.role === 'tool').at(-1) as { result: unknown }).result).toEqual(RECAP_COMPUTES_RESULT);
    expect(gateway.calls[0]!.system).toContain('EVERY ORDER FIELD SEEMS GIVEN');
    // a delivery question in the same message still runs the quote
    const asked = new FakeAiGateway();
    asked.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Blida' } }] }, { reply: 'Livraison 450 DA.', intent: 'SALE' });
    const run = jest.fn(async () => BLIDA);
    const q = `${text}, c'est combien la livraison ?`;
    await service(asked, { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.create_order], execute: run }).turn(turnReq(q, [], { guard: facts(q) }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// --- R16-4 -------------------------------------------------------------------------------------------------------------------------
describe('R16-4 (Cosmetic) — narrow wording fixes', () => {
  it('booking-like offers before any recap ⇒ the next missing field (N21 T1, N18 T1, F1 T1); a substitute offered or no wish ⇒ unchanged', () => {
    expect(withoutBookingOffer('عندنا Hijab soie بسعر 1500 دج بدل 2000 دج، وهو متوفر. حرير ناعم.\nتحب نحجزلك واحد؟', 'سلام، نحب حجاب حرير', false, 'ar')).toBe('عندنا Hijab soie بسعر 1500 دج بدل 2000 دج، وهو متوفر. حرير ناعم. واش سميتك ؟');
    expect(withoutBookingOffer('عندنا Djellaba homme بلون بيج، والسعر 7500 دج بدل 9000 دج. واش تحب نسجلو لك؟ وواش سميتك؟', 'السلام عليكم، نحب نشري جلابة رجالي', false, 'ar')).toBe('عندنا Djellaba homme بلون بيج، والسعر 7500 دج بدل 9000 دج. واش سميتك؟');
    expect(withoutBookingOffer('Bonne nouvelle, le sac est disponible 😊 Il coûte 6900 DA. Souhaitez-vous le commander ? Si oui, dites-moi votre nom pour commencer.', 'Je voudrais le sac à main cuir marron', false, 'fr')).toBe('Bonne nouvelle, le sac est disponible 😊 Il coûte 6900 DA. Dites-moi votre nom pour commencer.');
    expect(withoutBookingOffer('Hijab soie b 1500 DA. N7ajzlek wa7ed ?', 'nheb hijab soie', false, 'arabizi')).toBe('Hijab soie b 1500 DA. Wach smitek ?');
    // a phone given (the details are being taken), a quantity question, a substitute for a product out of stock ⇒ unchanged
    expect(withoutBookingOffer('Hijab soie b 1500 DA. N7ajzlek wa7ed ?', 'nheb hijab soie, 0661234568', true, 'arabizi')).toBe('Hijab soie b 1500 DA. N7ajzlek wa7ed ?');
    const many = 'Excellent choix ! Le Sac à main cuir Marron est disponible à 6900 DA. Combien de sacs souhaitez-vous commander ?';
    expect(withoutBookingOffer(many, 'Je voudrais le sac à main cuir marron', false, 'fr')).toBe(many);
    const instead = 'Désolé, Parfum Oud 50 ml est en rupture de stock. Notre Coffret cadeau Aïd est disponible. Voulez-vous que je vous le réserve ?';
    expect(withoutBookingOffer(instead, 'Bonjour, je veux le parfum oud', false, 'fr')).toBe(instead);
    const substitute = 'Le Hijab soie est disponible à 1500 DA. Voulez-vous le prendre ?';
    expect(withoutBookingOffer(substitute, 'Bon finalement je le prends.', false, 'fr')).toBe(substitute);
    const browse = 'Le sac est à 6900 DA. Souhaitez-vous le commander ?';
    expect(withoutBookingOffer(browse, 'Bonjour, il coûte combien le sac ?', false, 'fr')).toBe(browse);
    // the guard's corrective instruction asks the next field when the customer wants the product, never a booking offer
    const want = { ...facts('سلام، نحب حجاب حرير', { lang: 'ar' }), noRecapPending: true };
    expect(guardInstruction([{ rule: 'confirm_without_recap', sentence: 0 }], want)).toContain('never offer to book, reserve or register it');
    expect(guardInstruction([{ rule: 'confirm_without_recap', sentence: 0 }], { ...facts('il coûte combien le sac ?'), noRecapPending: true })).toContain('« Voulez-vous le … ? »');
  });

  it('French in arabizi: « est disponible », « Rahi disponible en S », « disponible b », « makach disponible »', () => {
    expect(withArabiziWords('Merci Amina, tsajjel! La robe kabyle brodée taille M est disponible b 4900 DA.', 'arabizi')).toBe('Merci Amina, tsajjel! La robe kabyle brodée taille M kayna b 4900 DA.');
    expect(withArabiziWords('Rahi disponible en S w M b 4900 DA, w en XL b 5200 DA (L makach disponible).', 'arabizi')).toBe('Rahi kayna f S w M b 4900 DA, w f XL b 5200 DA (L makach).');
    expect(withArabiziWords('Hijab soie 180 x 70 cm, disponible b 1500 DA (kan 2000 DA).', 'arabizi')).toBe('Hijab soie 180 x 70 cm, kayen b 1500 DA (kan 2000 DA).');
    expect(withArabiziWords('Le sac est disponible en Marron.', 'arabizi')).toBe('Le sac kayen en Marron.');
    expect(withArabiziWords('La robe est disponible en M.', 'fr')).toBe('La robe est disponible en M.');
  });

  it('the stop-desk offered once (F1b T2); one space between words (C2)', () => {
    expect(withOneStopdeskOffer('Parfait, Sétif, El Eulma c’est noté. Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Quelle est votre adresse de livraison (rue, cité) ? Si vous préférez, on peut aussi vous livrer en stop-desk.')).toBe(
      'Parfait, Sétif, El Eulma c’est noté. Livraison : 650 DA à domicile, ou 350 DA en stop-desk si vous préférez. Quelle est votre adresse de livraison (rue, cité) ?',
    );
    const one = 'À domicile : 650 DA, en stop-desk : 350 DA. Quelle est votre adresse, ou préférez-vous le stop-desk ?';
    expect(withOneStopdeskOffer(one)).toBe(one);
    expect(withOneStopdeskOffer('On peut aussi vous livrer en stop-desk.')).toBe('On peut aussi vous livrer en stop-desk.');
    expect(withSingleSpaces("Salam, smahli 3lik  3la had lmochkil. L'équipe ta3 lboutique rah tchouf m3ak le remboursement.")).toBe("Salam, smahli 3lik 3la had lmochkil. L'équipe ta3 lboutique rah tchouf m3ak le remboursement.");
    expect(withSingleSpaces('Total : 7 550 DA\n- 1 × Sac')).toBe('Total : 7 550 DA\n- 1 × Sac');
  });
});
