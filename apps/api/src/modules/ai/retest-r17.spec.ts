// Journey retest R17 (18/11, docs/audit/journeys-2026-11-16/journeys/R17-ai-orders.md): a model hand-off `off_catalogue` accepted on a
// place-only message (R17-1, PF1 T1 — Major), a « oui » to a substitute's server recap answered with a new confirm question and no order
// (R17-2, N5 T3 — Major), a product at stock 0 offered as an alternative (R17-3, N7), an order claimed registered and booking-like
// questions in Arabic script (R17-4, A3 / N21 / A1 / F1b), wording (R17-5, F9 / N16 / P2), lookups (R17-6, N5 T2 / PF1 T2).
// Transcripts: .local/qa/journeys/R17/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, digitsBeyondPhones, takesOutOfStock, type TurnRequest } from './ai-run.service';
import { judgeHandoff, messageHandoffReasons, placeCandidate } from './handoff-judge';
import { offCatalogueWords } from './product-named';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabiziWords, withoutBookingOffer, withoutBookingSaid, withoutUnrelatedOffer } from './reply-fixes';
import { buildGuardFacts, checkReply } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderClaim, orderConfirmationText, pendingRecap, recapReply, serverRecapAsked } from './tools/order-confirmation-text';
import { recapYesArgs, type OrderCallHistory } from './tools/order-confirmation';
import { buildPlaceIndex, offCatalogueWordsOf, placeOnlyMessage, resetPlaceIndex, withoutPlaceNames } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

const PLACES = [
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] },
  { id: 33, nameFr: 'Illizi', nameAr: 'إليزي', communes: [] as { nameFr: string; nameAr: string }[] },
];
const WILAYAS = PLACES.map((p) => ({ id: p.id, code: String(p.id).padStart(2, '0'), nameFr: p.nameFr, nameAr: p.nameAr }));
const COMMUNES = PLACES.flatMap((p) => p.communes.map((c) => ({ wilayaId: p.id, ...c })));
const FEES: Record<number, number> = { 16: 400, 19: 650, 25: 700, 31: 0 };
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

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const COFFRET: Product = { id: '01a1e51f-48c7-7916-8119-8895e76e3400', name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 4, sellOutOfStock: false };
const MARRON = '01a1e54f-a0e1-7b60-8974-d647387f0eda';
const SAC: Product = { id: '01a1e54f-a0b9-7ae5-8971-96c0cc39d155', name: 'Sac à main cuir', price: 6900, hasVariants: true, variants: [{ id: '01a1e54f-a0cd-746a-8972-de0bf0d05b35', name: 'Noir', price: 6900, stock: 3 }, { id: MARRON, name: 'Marron', price: 6900, stock: 3 }], stock: 6, sellOutOfStock: false };
/** A registry over these products (no database): place, wilaya check and quote are the transcripts' values (R8 helper). */
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
  jest.spyOn(r, 'quote').mockImplementation(async (a) => ({ ok: true, wilayaId: a.wilayaId, wilayaName: PLACES.find((x) => x.id === a.wilayaId)?.nameFr, fee: FEES[a.wilayaId] ?? 0, free: !FEES[a.wilayaId] }));
  return reg;
};
const ctxOf = (customerText: string, history: string[], orderHistory: OrderCallHistory = []): ToolRunContext => ({ workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory, ordering: true });
const shownBefore = (result: unknown): OrderCallHistory => [{ name: 'create_order', result, at: new Date(Date.now() - 60_000) }];
const guardOf = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' | 'en', products: Product[] = [COFFRET, SAC], o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang, products: products.map((p) => ({ ...p, sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null })) as never, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false, ...o });
/** The service over the real registry: every tool runs through it (create_order validated, the playground's TEST-n). */
const serviceOver = (gateway: FakeAiGateway, reg: ToolRegistry, defs = [TOOL_DEFS.create_order, TOOL_DEFS.search_products]) => {
  const execute = jest.fn((name: string, args: Record<string, unknown>, ctx: ToolRunContext) => reg.execute(name, args, ctx));
  const tools = { defsFor: async () => defs, execute, forcedHandoff: (n: string, a: Record<string, unknown>, r: unknown) => reg.forcedHandoff(n, a, r), soldProductNamed: async () => null } as unknown as ToolRegistry;
  return { svc: new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never), execute };
};

// --- R17-2 -------------------------------------------------------------------------------------------------------------------------
describe('R17-2 (Major) — a plain yes to the server recap shown places exactly that recap, whatever the model does', () => {
  // N5 (J04): T1 « Bonjour, le parfum oud c'est combien ? » (out of stock, the Coffret offered) → T2 the order message → the substitute's
  // server recap → T3 « oui » ⇒ the model asked to confirm again, no create_order
  const N5 = ["Bonjour, le parfum oud c'est combien ?", 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'];
  const T2_CALL = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', items: [{ productId: COFFRET.id, quantity: 1 }], customerConfirmed: true };
  const T3_REPLY = 'Merci Karim. Le Parfum Oud 50 ml étant en rupture, je veux être sûre : confirmez-vous la commande du Coffret cadeau Aïd (24990 DA) ? Si oui, je vous envoie le récapitulatif officiel à valider.';
  const recapOf = async (reg: ToolRegistry, call: Record<string, unknown>, said: string, history: string[]) => ((await reg.prepareOrder(call, ctxOf(said, history))) as { result: Record<string, unknown> }).result;
  const yesTurn = (said: string, history: string[], orderHistory: OrderCallHistory, lastAi: string, lang: 'fr' | 'ar' | 'arabizi' | 'en'): TurnRequest => ({
    runId: 'r3',
    prompt: { system: 'S', messages: [{ role: 'user', content: history.join('\n') }, { role: 'assistant', content: lastAi }, { role: 'user', content: said }] } as never,
    toolCtx: { ...ctxOf(said, history, orderHistory), runId: 'r3' },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    guard: guardOf(said, lang),
  });
  const placed = (execute: jest.Mock) => execute.mock.results.filter((r, i) => execute.mock.calls[i]![0] === 'create_order').length;

  it('N5 T3 reproduction: « oui » to the substitute recap, the model asks to confirm again with no tool ⇒ the server places the recap, its confirmation replaces the text', async () => {
    const reg = registry([COFFRET]);
    const t2 = await recapOf(reg, T2_CALL, N5[1]!, N5.slice(0, 1));
    const recapText = `Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd.\n\n${recapReply('', pendingRecap([{ name: 'create_order', result: t2 }])!, 'fr').text}`;
    expect(serverRecapAsked(recapText)).toBe(true);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: T3_REPLY, intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg);
    const r = await svc.turn(yesTurn('oui', N5, shownBefore(t2), recapText, 'fr'));
    if (!r.ok) throw new Error('turn failed');
    expect(gateway.calls).toHaveLength(1);
    expect(placed(execute)).toBe(1);
    const done = r.tools.filter((t) => t.name === 'create_order');
    expect(done).toHaveLength(1);
    expect(done[0]!.result).toMatchObject({ ok: true, simulated: true, total: 24_990 });
    expect(done[0]!.args).toMatchObject({ clientName: 'Karim Haddad', wilayaId: 31, communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', items: [{ productId: COFFRET.id, quantity: 1 }] });
    expect(r.output.reply).toBe(orderConfirmationText([{ name: 'create_order', result: done[0]!.result }], 'fr'));
    expect(r.output.reply).not.toMatch(/confirmez|officiel/u);
    expect(r.output.status).toBe('OK');
  });

  it.each([
    ['fr', 'oui', 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4', 'Pour confirmer : vous voulez bien le Coffret cadeau Aïd ?'],
    ['fr', '👍', 'Je prends le coffret cadeau. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4', 'Parfait, je vous envoie le récapitulatif.'],
    ['ar', 'ايه', 'نحب الكوفري، كريم حداد 0770112233، وهران، بئر الجير، حي 1000 مسكن عمارة 4', 'واش تأكد الطلبية ؟'],
    ['arabizi', 'ih', 'nheb le coffret, smiti Karim Haddad 0770112233, Oran Bir El Djir cite 1000 logements bloc 4', 'Wach tconfirmi la commande ?'],
    ['en', 'yes', 'I want the gift box. Karim Haddad 0770112233, Oran, Bir El Djir, cite 1000 logements bloc 4', 'Do you confirm the order?'],
  ] as const)('invariant (%s, « %s »): recap → a plain yes, the model calls no tool ⇒ exactly one order, the recap’s', async (lang, yes, orderMessage, modelReply) => {
    const reg = registry([COFFRET]);
    const call = { ...T2_CALL, address: lang === 'ar' ? 'حي 1000 مسكن عمارة 4' : 'cite 1000 logements bloc 4' };
    const t2 = await recapOf(reg, call, orderMessage, []);
    expect(t2).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true });
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t2 }])!, lang).text;
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: modelReply, intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg);
    const r = await svc.turn(yesTurn(yes, [orderMessage], shownBefore(t2), recapText, lang));
    if (!r.ok) throw new Error('turn failed');
    expect(placed(execute)).toBe(1);
    const ok = r.tools.filter((t) => t.name === 'create_order' && (t.result as { ok?: unknown }).ok === true);
    expect(ok).toHaveLength(1);
    expect((ok[0]!.result as { draft?: unknown }).draft).toBe((t2.error as { draft: string }).draft);
    expect(r.output.reply).toBe(orderConfirmationText([{ name: 'create_order', result: ok[0]!.result }], lang));
  });

  it('the model’s own create_order on that yes carries the stored order (a wrong variant / a dropped field cannot make a new recap)', async () => {
    const reg = registry([SAC]);
    const msg = 'Je voudrais le sac à main cuir marron. Karim Haddad 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12';
    const t2 = await recapOf(reg, { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, communeName: 'El Eulma', address: 'Cité 500 logements bloc 12', items: [{ productId: SAC.id, variantId: MARRON, quantity: 1 }], customerConfirmed: true }, msg, []);
    const gateway = new FakeAiGateway();
    // the confirming call of the model: the Noir variant and no address
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, items: [{ productId: SAC.id, variantId: SAC.variants[0]!.id, quantity: 1 }], customerConfirmed: true } }] }, { reply: 'Merci !', intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg);
    const r = await svc.turn(yesTurn('oui', [msg], shownBefore(t2), recapReply('', pendingRecap([{ name: 'create_order', result: t2 }])!, 'fr').text, 'fr'));
    if (!r.ok) throw new Error('turn failed');
    expect(placed(execute)).toBe(1);
    expect(r.tools[0]!.result).toMatchObject({ ok: true, items: [{ name: 'Sac à main cuir', variant: 'Marron', quantity: 1 }] });
  });

  it('not a plain yes to the recap shown ⇒ nothing is placed by the server (a change, a question, another last message, a recap already placed)', async () => {
    const reg = registry([COFFRET]);
    const t2 = await recapOf(reg, T2_CALL, N5[1]!, N5.slice(0, 1));
    const recapText = recapReply('', pendingRecap([{ name: 'create_order', result: t2 }])!, 'fr').text;
    expect(recapYesArgs(shownBefore(t2), 'oui', true)).toMatchObject({ wilayaId: 31, customerConfirmed: true });
    expect(recapYesArgs(shownBefore(t2), 'oui mais livrez à la villa 5', true)).toBeNull();
    expect(recapYesArgs(shownBefore(t2), 'oui ? c’est livré quand ?', true)).toBeNull();
    expect(recapYesArgs(shownBefore(t2), 'non', true)).toBeNull();
    expect(recapYesArgs(shownBefore(t2), 'oui', false)).toBeNull();
    const done = [...shownBefore(t2), { name: 'create_order', result: { ok: true, number: 'TEST-3157', draft: (t2.error as { draft: string }).draft, core: (t2.error as { core: string }).core }, at: new Date() }];
    expect(recapYesArgs(done, 'oui', true)).toBeNull();
    // the AI's last message was another question (« Voulez-vous la M à la place ? »): the model answers, the server places nothing
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Très bien, je note.', intent: 'SALE' });
    const { svc, execute } = serviceOver(gateway, reg);
    await svc.turn(yesTurn('oui', N5, shownBefore(t2), 'Voulez-vous plutôt le Coffret en taille XL ?', 'fr'));
    expect(execute).not.toHaveBeenCalled();
    expect(serverRecapAsked(recapText)).toBe(true);
  });

  it('the cause (R16-3 RECAP_READY_NOTE): no « call create_order directly » note when the product the customer takes is out of stock', async () => {
    const OUD = { id: 'oud', name: 'Parfum Oud 50 ml', price: 3200, hasVariants: false, variants: [], stock: 0, sellOutOfStock: false };
    const prices = [{ id: 'oud', name: 'Parfum Oud 50 ml', price: 3200, variants: [] }, { id: COFFRET.id, name: COFFRET.name, price: COFFRET.price, variants: [] }];
    expect(takesOutOfStock(N5.join('\n'), prices, ['Parfum Oud 50 ml'])).toBe(true);
    expect(takesOutOfStock([N5[0], 'ok je prends le coffret cadeau', 'Karim 0770112233'].join('\n'), prices, ['Parfum Oud 50 ml'])).toBe(false);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Le Parfum Oud est en rupture. Voulez-vous le Coffret cadeau Aïd à la place ?', intent: 'SALE' });
    const reg = registry([COFFRET]);
    const { svc } = serviceOver(gateway, reg);
    const req: TurnRequest = { runId: 'r2', prompt: { system: 'S', messages: [{ role: 'user', content: N5[1]! }] } as never, toolCtx: { ...ctxOf(N5[1]!, N5.slice(0, 1)), runId: 'r2' }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(N5[1]!, 'fr', [COFFRET, OUD as Product]) };
    await svc.turn(req);
    expect(gateway.calls[0]!.system).not.toContain('EVERY ORDER FIELD SEEMS GIVEN');
  });
});

// --- R17-1 -------------------------------------------------------------------------------------------------------------------------
describe('R17-1 (Major) — off_catalogue needs product words the catalogue has no product for; a place message never hands off', () => {
  const PF1_T1 = "Bonjour, j'habite à Sétif, El Eulma";
  const SETIF = { ok: true, wilayaId: 19, wilayaName: 'Sétif', wilayaNameAr: 'سطيف', isStopdesk: false, fee: 650, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 350, etaDays: '2–5' };
  const idx = buildPlaceIndex(WILAYAS, COMMUNES);

  it('the words: a greeting, « j’habite », a place, a name, a field name no product; product words stay', () => {
    expect(offCatalogueWords(PF1_T1, (t) => withoutPlaceNames(idx, t))).toEqual([]);
    expect(offCatalogueWords('slm, ana f Bab Ezzouar', (t) => withoutPlaceNames(idx, t))).toEqual([]);
    expect(offCatalogueWords('السلام عليكم، انا ساكن في سطيف', (t) => withoutPlaceNames(idx, t))).toEqual([]);
    expect(offCatalogueWords('Bonjour, je suis Karim Haddad')).toEqual([]);
    expect(offCatalogueWords('Vous réparez les téléphones portables ?')).toContain('portable');
    expect(placeOnlyMessage(idx, PF1_T1)).toBe(true);
    expect(placeCandidate(PF1_T1)).toBe(true);
    expect(placeCandidate('السلام عليكم، انا من سطيف')).toBe(true);
  });

  it('PF1 T1 judge (tool and status paths): the transcript’s `handoff_to_human {off_catalogue, evidence «j’habite à Sétif, El Eulma»}` ⇒ refused no_product; wholesale and a real off-catalogue request stay accepted', async () => {
    const productWordsLeft = await offCatalogueWordsOf(PF1_T1);
    expect(productWordsLeft).toEqual([]);
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: "j'habite à Sétif, El Eulma", customerText: PF1_T1, ...(productWordsLeft ? { productWordsLeft } : {}) })).toEqual({ ok: false, reason: 'off_catalogue', why: 'no_product' });
    for (const t of ['Bonjour', 'Karim Haddad', '0770112233', 'oui']) expect(judgeHandoff({ reason: 'off_catalogue', evidence: t, customerText: t }).ok).toBe(false);
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'prix de gros pour 50 pièces', customerText: 'Bonjour, prix de gros pour 50 pièces du hijab soie ?' })).toEqual({ ok: true, reason: 'off_catalogue' });
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'réparez les téléphones portables', customerText: 'Vous réparez les téléphones portables ?' }).ok).toBe(true);
    // the tool path (the registry's own handoff, the catalogue check finding nothing)
    const reg = new ToolRegistry({ productNamed: async () => null } as never, {} as never, {} as never, {} as never, {} as never);
    const res = await reg.execute('handoff_to_human', { reason: 'off_catalogue', evidence: "j'habite à Sétif, El Eulma" }, ctxOf(PF1_T1, []));
    expect(res).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', why: 'no_product' } });
  });

  it('PF1 T1 turn: the hand-off tool is not offered on the place message; the stray call is not run; the fees are said', async () => {
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Sétif' } }, { name: 'handoff_to_human', args: { reason: 'off_catalogue', evidence: "j'habite à Sétif, El Eulma" } }] },
      { reply: 'Merci ! Nous livrons à El Eulma (Sétif) : 650 DA à domicile, ou 350 DA en stop-desk. Quel article vous intéresse ?', intent: 'INFO' },
    );
    const execute = jest.fn(async (name: string) => (name === 'quote_delivery' ? SETIF : { ok: true }));
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.handoff_to_human, TOOL_DEFS.create_order], execute, forcedHandoff: (n: string) => (n === 'handoff_to_human' ? 'off_catalogue' : null), soldProductNamed: async () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: PF1_T1 }] } as never, toolCtx: { ...ctxOf(PF1_T1, []), ordering: false }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(PF1_T1, 'fr', [SAC], { answeredBefore: false, outOfHours: true }) };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('handoff_to_human');
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['quote_delivery']);
    expect(r.output.status).toBe('OK');
    expect(r.forcedHandoff).toBeNull();
    expect(r.output.reply).toMatch(/650 DA/u);
    expect(r.output.reply).toMatch(/350 DA/u);
    // the reasons of such a message: no off_catalogue, with or without the place lists
    expect(messageHandoffReasons(['off_catalogue', 'customer_request'], PF1_T1, () => false, [], (t) => withoutPlaceNames(idx, t))).toEqual([]);
    expect(messageHandoffReasons(['off_catalogue'], 'Bonjour', () => false)).toEqual([]);
    expect(messageHandoffReasons(['off_catalogue'], 'Vous réparez les téléphones portables ?', () => false)).toEqual(['off_catalogue']);
  });

  it('a real hand-off on a turn that quoted the wilaya the customer named keeps its fee', async () => {
    const said = 'je veux parler à quelqu’un, vous livrez à Sétif ?';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Sétif' } }] }, { reply: '', status: 'HANDOFF', statusDetail: 'customer_request', evidence: 'parler à quelqu’un', intent: 'OTHER' });
    const execute = jest.fn(async () => SETIF);
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery], execute, forcedHandoff: () => null, soldProductNamed: async () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: ctxOf(said, []), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, 'fr', [SAC]) };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    expect(r.output.status).toBe('HANDOFF');
    expect(r.output.reply.replace(/[\u00a0\u202f\u2009]/gu, ' ')).toMatch(/^Livraison à Sétif : 650 DA à domicile, 350 DA en stop-desk\. /u);
  });

  it('PF1 T2: no create_order on a message that cannot hold an address yet (no address word, no digit beyond the phone); the price goes before the mode question', async () => {
    const T2 = 'Je voudrais le sac à main cuir marron. Karim Haddad 0770112233';
    expect(digitsBeyondPhones(T2)).toBe(false);
    expect(digitsBeyondPhones('Karim 0770112233, Les Pins 12')).toBe(true);
    expect(digitsBeyondPhones('٠٥٥٠١٢٣٤٥٦')).toBe(false);
    expect(digitsBeyondPhones('2 tapis, 0661234567')).toBe(true);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Parfait Karim. Souhaitez-vous une livraison à domicile à El Eulma (650 DA) ou en stop-desk (350 DA) ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.quote_delivery], execute: jest.fn(), forcedHandoff: () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: T2 }] } as never, toolCtx: ctxOf(T2, [PF1_T1]), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(T2, 'fr', [SAC], { earlierToolResults: [SETIF] }) };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('create_order');
    expect(r.output.reply).toBe('Parfait Karim. Sac à main cuir (Marron) : 6\u00a0900\u00a0DA. Souhaitez-vous une livraison à domicile à El Eulma (650 DA) ou en stop-desk (350 DA) ?');
  });

  it('PF1 T2: a create_order sent anyway without an address is answered VALIDATION address and not run', async () => {
    const T2 = 'Je voudrais le sac à main cuir marron 2. Karim Haddad 0770112233';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, communeName: 'El Eulma', items: [{ productId: SAC.id, variantId: MARRON, quantity: 1 }], customerConfirmed: true } }] }, { reply: 'Quelle est votre adresse à El Eulma ?', intent: 'SALE' });
    const execute = jest.fn();
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], execute, forcedHandoff: () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: T2 }] } as never, toolCtx: ctxOf(T2, [PF1_T1]), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(T2, 'fr', [SAC]) };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    if (!r.ok) throw new Error('turn failed');
    expect(execute.mock.calls.map((c) => c[0])).not.toContain('create_order');
    expect((gateway.calls[1]!.messages.at(-1) as { result?: unknown }).result).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'address' } });
    expect(r.tools.map((t) => t.name)).not.toContain('create_order');
  });
});

// --- R17-3 -------------------------------------------------------------------------------------------------------------------------
describe('R17-3 (Minor) — a product at stock 0 (sold beyond it) is never offered as an alternative', () => {
  const MONTRE = { id: 'mon', name: 'Montre connectée', price: 15_900, hasVariants: false, variants: [], stock: 0, sellOutOfStock: true };
  const ROBE = { id: 'rob', name: 'Robe kabyle brodée', price: 4900, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false };
  const N7_T1 = 'Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3';
  it('N7 T1 / T2 replies are flagged; asked for, it is answered', () => {
    const f = guardOf(N7_T1, 'fr', [MONTRE as Product, SAC, ROBE as Product]);
    expect(checkReply('Désolé, nous n’avons pas de lunettes de soleil pour le moment. Nous avons une Montre connectée, un Sac à main en cuir ou encore une Robe kabyle brodée.', f).map((v) => v.rule)).toContain('unavailable_offer');
    expect(checkReply('Parfait Yacine. Quel article souhaitez-vous commander : la Montre connectée, le Sac à main en cuir ou la Robe kabyle brodée ?', { ...guardOf('oui', 'fr', [MONTRE as Product, SAC, ROBE as Product]), customerHistory: N7_T1 }).map((v) => v.rule)).toContain('unavailable_offer');
    expect(checkReply('La Montre connectée est à 15900 DA.', guardOf('la montre connectée c’est combien ?', 'fr', [MONTRE as Product])).map((v) => v.rule)).not.toContain('unavailable_offer');
    expect(checkReply('Nous avons le Sac à main cuir et la Robe kabyle brodée.', f).map((v) => v.rule)).not.toContain('unavailable_offer');
  });
});

// --- R17-4 -------------------------------------------------------------------------------------------------------------------------
describe('R17-4 (Minor) — no order claimed and no booking offer before a recap, in every script', () => {
  it('A3 T1 « تسجلت الطلب » is an order claim (a « قبل » of another clause does not hide it); negations / futures / questions are not', () => {
    expect(orderClaim('أهلا سميرة، تسجلت الطلب: زوج Tapis de prière ب\u0640 2800 دج للقطعة، يعني 5600 دج قبل التوصيل.')).toBe(true);
    expect(orderClaim('اتسجلت الطلبية تاعك.')).toBe(true);
    expect(orderClaim('Saha, tsajlet la commande ta3ek.')).toBe(true);
    for (const s of ['الطلبية ما تسجلتش مازال.', 'باش نسجل الطلبية عطيني العنوان.', 'نسجلولك الطلبية ؟', 'Pour enregistrer la commande, quelle est votre adresse ?', 'Votre commande sera enregistrée dès votre « oui ».', 'تسجيل الطلبية يكون بعد ما تأكد.'])
      expect(orderClaim(s)).toBe(false);
  });
  it('booking-like questions (N21 T1, A1 T1, arabizi, French) become the name question when the customer wants the product', () => {
    expect(withoutBookingOffer('أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، ب\u0640 1500 دج بدل 2000 دج. واش تحب نسجلوه ليك؟', 'سلام، نحب حجاب حرير', false, 'ar')).toBe('أهلًا بيك! عندنا حجاب حرير ناعم، مقاس 180 x 70 سم، ب\u0640 1500 دج بدل 2000 دج. واش سميتك ؟');
    expect(withoutBookingOffer('وعليكم السلام 👋 عندنا Hijab soie ب\u0640 1500 دج (بدل 2000 دج)، حرير ناعم وخفيف، مقاسه 180 x 70 سم. تحب نجهزلك واحد ؟', 'السلام عليكم، نحب حجاب حرير واحد', false, 'ar')).toMatch(/مقاسه 180 x 70 سم\. واش سميتك ؟$/u);
    expect(withoutBookingOffer('Hijab soie b 1500 DA. T7ebb nsajjlouh lik ?', 'nheb hijab soie', false, 'arabizi')).not.toMatch(/nsajjl/u);
    expect(withoutBookingOffer('Le hijab soie est à 1500 DA. Voulez-vous que je vous le réserve ?', 'je veux le hijab soie', false, 'fr')).toBe('Le hijab soie est à 1500 DA. Quel est votre nom ?');
    // a substitute for an out-of-stock product, a quantity question: kept
    expect(withoutBookingOffer('Le Parfum Oud est en rupture. Voulez-vous que je vous réserve le Coffret ?', 'je veux le parfum oud', false, 'fr')).toContain('Coffret');
  });
  it('a clause saying it is booked / prepared / noted goes (F1b T1, A1 T2); the rest of the sentence stays', () => {
    expect(withoutBookingSaid('Parfait Karim, le Sac à main cuir en couleur Marron est disponible à 6900 DA, et on le prépare pour vous. Dans quelle wilaya souhaitez-vous être livré ?')).toBe('Parfait Karim, le Sac à main cuir en couleur Marron est disponible à 6900 DA. Dans quelle wilaya souhaitez-vous être livré ?');
    expect(withoutBookingSaid('صحيت أمينة، تسجل عندي حجاب الحرير (Hijab soie) بكمية 1. عطيني رقم الهاتف تاعك (مثال: 0555123456) ؟')).toBe('صحيت أمينة. عطيني رقم الهاتف تاعك (مثال: 0555123456) ؟');
    expect(withoutBookingOffer('صحيت أمينة، تسجل عندي حجاب الحرير (Hijab soie) بكمية 1. عطيني رقم الهاتف تاعك ؟', 'أمينة سعدي', false, 'ar', { history: 'السلام عليكم، نحب حجاب حرير واحد\nأمينة سعدي' })).toBe('صحيت أمينة. عطيني رقم الهاتف تاعك ؟');
    // an order exists already: « on vous la prépare » speaks of it
    expect(withoutBookingOffer('Votre commande TEST-1 est en cours, on vous la prépare.', 'je veux aussi le hijab', true, 'fr', { orderedBefore: true })).toContain('on vous la prépare');
    expect(withoutBookingSaid('Le sac est disponible en Marron.')).toBe('Le sac est disponible en Marron.');
  });
});

// --- R17-5 -------------------------------------------------------------------------------------------------------------------------
describe('R17-5 (Cosmetic) — offers that do not answer, French in arabizi', () => {
  const F9 = 'slm, ch7al tawsil l Setif ? w l Oran stop desk ? w Illizi ?';
  it('F9 / F9b: no closing offer of the products after a delivery-only question; N16: nothing else « li twasslek » when nothing is served', () => {
    expect(withoutUnrelatedOffer('Sétif : 650 DA l dar. Illizi : ma nwasslouch l Illizi f had lwaqt. T7ebb nchouf wach men produit ?', F9, { deliveryOnly: true, nothingServed: false })).toBe('Sétif : 650 DA l dar. Illizi : ma nwasslouch l Illizi f had lwaqt.');
    expect(withoutUnrelatedOffer('Ma nwasslouch l Illizi f had lwaqt. T7ebb nwarrik wach kayen 3andna ?', F9, { deliveryOnly: true, nothingServed: false })).toBe('Ma nwasslouch l Illizi f had lwaqt.');
    expect(withoutUnrelatedOffer('Wa 3likoum, smah lina, ma nwasslouch l Illizi f had lwaqt. Ila t7ebb, nqder nwarrik lek hadja okhra li twasslek f wilaya ta3ek.', 'slm, tawsil l Illizi ?', { deliveryOnly: true, nothingServed: true })).toBe('Wa 3likoum, smah lina, ma nwasslouch l Illizi f had lwaqt.');
    // a product question keeps its offer; an offer alone stays (nothing else to send)
    expect(withoutUnrelatedOffer('La robe est à 4900 DA. Voulez-vous voir nos autres produits ?', 'la robe c’est combien ?', { deliveryOnly: false, nothingServed: false })).toContain('autres produits');
    expect(withoutUnrelatedOffer('T7ebb nwarrik wach kayen 3andna ?', F9, { deliveryOnly: true, nothingServed: false })).toBe('T7ebb nwarrik wach kayen 3andna ?');
  });
  it('« 650 DA à domicile », « parfaite l l3rass » in arabizi', () => {
    expect(withArabiziWords('Sétif : 650 DA à domicile, wela 350 DA f stop-desk.', 'arabizi')).toBe('Sétif : 650 DA l dar, wela 350 DA f stop-desk.');
    expect(withArabiziWords('Robe kabyle brodée b lyedd, qmach khfif, parfaite l l3rass w lmounasabat.', 'arabizi')).toBe('Robe kabyle brodée b lyedd, qmach khfif, mliha l l3rass w lmounasabat.');
    expect(withArabiziWords('Livraison à domicile : 650 DA.', 'fr')).toBe('Livraison à domicile : 650 DA.');
  });
});

// --- R17-6 -------------------------------------------------------------------------------------------------------------------------
describe('R17-6 (Minor) — N5 T2: no search for products the CATALOGUE lists on an order-details message', () => {
  it('the two searches of N5 T2 are answered from the CATALOGUE, the recap call runs', async () => {
    const said = 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Coffret cadeau Aïd' } }] }, { reply: 'Voulez-vous le Coffret cadeau Aïd à la place ?', intent: 'SALE' });
    const execute = jest.fn();
    const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.create_order], execute, forcedHandoff: () => null } as unknown as ToolRegistry;
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: said }] } as never, toolCtx: ctxOf(said, ["Bonjour, le parfum oud c'est combien ?"]), temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: guardOf(said, 'fr', [COFFRET]) };
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    // (journey retest R18-1: the place the message names, never quoted yet, is quoted by the server — no search runs)
    expect(execute.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['quote_delivery']);
    expect((gateway.calls[1]!.messages.at(-1) as { result?: unknown }).result).toMatchObject({ inCatalogue: true });
  });
});
