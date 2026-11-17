// Journey retest R8 (17/11, docs/audit/journeys-2026-11-16/journeys/R8-ai-orders.md): a « oui » to a correct server recap lost
// and an invented « problème technique » (R8-1), an Arabic-script name re-written in Latin and refused (R8-2), the wrong variant in
// the recap (R8-3), probe calls (R8-4), odd darija words (R8-5). Transcripts: .local/qa/journeys/R8/out/transcripts/.
import { prisma } from '@djaber/db';
import { AiRunService, refusedOrder, unavailableTool, type TurnRequest } from './ai-run.service';
import { fixMoroccan, wrongDarijaIn } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply, enforceReply, inventedProblem } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { recapClaim } from './tools/order-confirmation-text';
import { bareYes, latestRecap, type OrderCallHistory } from './tools/order-confirmation';
import { buildPlaceIndex, placeOnlyMessage } from './tools/place-index';
import { customerOwnName, namedVariant, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };

type Product = { id: string; name: string; price: number; hasVariants: boolean; variants: { id: string; name: string; price: number; stock: number }[]; stock: number | null; sellOutOfStock: boolean };
const COFFRET: Product = { id: '01a1e51f-48c7-7916-8119-8895e76e3400', name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false };
const TAPIS: Product = { id: '01a1e54f-a31d-7828-899f-644c5988a750', name: 'Tapis de prière', price: 2800, hasVariants: false, variants: [], stock: 20, sellOutOfStock: false };
const NOIR = '01a1e54f-a0cd-746a-8972-de0bf0d05b35';
const MARRON = '01a1e54f-a0e1-7b60-8974-d647387f0eda';
const ROUGE = '01a1e54f-a0f6-76ac-8976-2399893e2504';
const SAC: Product = { id: '01a1e54f-a0b9-7ae5-8971-96c0cc39d155', name: 'Sac à main cuir', price: 6900, hasVariants: true, variants: [{ id: NOIR, name: 'Noir', price: 6900, stock: 4 }, { id: MARRON, name: 'Marron', price: 6900, stock: 4 }, { id: ROUGE, name: 'Rouge', price: 6900, stock: 0 }], stock: 8, sellOutOfStock: false };
const PLACES: Record<number, { id: number; code: string; nameFr: string; nameAr: string; communes: { nameFr: string; nameAr: string }[]; fee: number }> = {
  9: { id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }], fee: 450 },
  31: { id: 31, code: '31', nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }], fee: 0 },
};
/** A registry over these products (no database): place, wilaya check and quote are the transcripts' values. */
const registry = (products: Product[], extra: Record<string, unknown> = {}) => {
  const catalogue = { byIds: async (_a: unknown, ids: string[]) => products.filter((p) => ids.includes(p.id)), ...extra };
  const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
  jest.spyOn(prisma.wilaya, 'findUnique').mockImplementation((async (q: { where: { id: number } }) => PLACES[q.where.id] ?? null) as never);
  jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
  const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: (a: { wilayaId: number }) => Promise<Record<string, unknown>> };
  jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
  jest.spyOn(r, 'quote').mockImplementation(async (a) => ({ ok: true, wilayaId: a.wilayaId, wilayaName: PLACES[a.wilayaId]?.nameFr, fee: PLACES[a.wilayaId]?.fee ?? 0, free: !PLACES[a.wilayaId]?.fee }));
  return reg;
};
const ctx = (customerText: string, history: string[], orderHistory: OrderCallHistory = []): ToolRunContext => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), orderHistory, ordering: true });
const shownBefore = (result: unknown): OrderCallHistory => [{ name: 'create_order', result, at: new Date(Date.now() - 60_000) }];
type Prepared = { ok: boolean; result?: Record<string, unknown> & { recap?: Record<string, unknown> }; request?: Record<string, unknown> & { items: { variantId: string | null; variant: string | null }[] } };

describe('R8-1 (Major) — a « oui » to the pending server recap places exactly that recap', () => {
  // N5 (J04): « Bonjour, le parfum oud c'est combien ? » → the Coffret offered → T2 the order message → server recap → T3 « oui »
  const N5 = ["Bonjour, le parfum oud c'est combien ?", 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4'];
  const T2_CALL = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', items: [{ productId: COFFRET.id, quantity: 1 }], customerConfirmed: true };
  // T3: the confirming call of the transcript — no commune, no address, customerConfirmed false
  const T3_CALL = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, items: [{ productId: COFFRET.id, quantity: 1 }], customerConfirmed: false };
  const recapTurn = async () => (await registry([COFFRET]).prepareOrder(T2_CALL, ctx(N5[1]!, N5.slice(0, 1)))) as Prepared;

  it('the recap result carries the order the server built for it', async () => {
    const t2 = await recapTurn();
    expect(t2.result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, draftOrder: { clientName: 'Karim Haddad', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', items: [{ productId: COFFRET.id, variantId: null, quantity: 1 }] } });
    expect(latestRecap(shownBefore(t2.result))?.order?.address).toBe('Cité 1000 logements bloc 4');
  });
  it('N5 T3: « oui » + a call without commune / address ⇒ the order of the recap (same draft), never « not given yet »', async () => {
    const t2 = await recapTurn();
    const t3 = (await registry([COFFRET]).prepareOrder(T3_CALL, ctx('oui', N5, shownBefore(t2.result)))) as Prepared;
    expect(t3.ok).toBe(true);
    expect(t3.request).toMatchObject({ clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', total: 24_990 });
  });
  it('the same call with a change or no yes in the message, or once that recap was placed ⇒ judged as it is (refused)', async () => {
    const t2 = await recapTurn();
    for (const said of ['oui mais livrez à la villa 5', 'vous livrez quand ?', 'non']) {
      const r = (await registry([COFFRET]).prepareOrder(T3_CALL, ctx(said, N5, shownBefore(t2.result)))) as Prepared;
      expect(r.result).toMatchObject({ error: { code: 'VALIDATION', fields: ['communeName', 'address'] } });
    }
    const placed = [...shownBefore(t2.result), { name: 'create_order', result: { ok: true, number: 'TEST-1709', items: [], draft: (t2.result!.error as { draft: string }).draft, core: 'x' }, at: new Date() }];
    const again = (await registry([COFFRET]).prepareOrder(T3_CALL, ctx('oui', N5, placed))) as Prepared;
    expect(again.ok).toBe(false);
  });
  it('a bare yes: yes words and the recap’s own words only', () => {
    const shown = 'Karim Haddad 0770112233 Sétif El Eulma Cité 500 logements bloc 12 Sac à main cuir Marron';
    for (const t of ['oui', 'ih saha', 'Oui c’est bon', 'yes', '👍', "oui, c'est bien la cité 500 logements bloc 12 à El Eulma, Sétif", 'ايه']) expect(bareYes(t, shown)).toBe(true);
    for (const t of ['oui mais livrez à la villa 4', 'oui, en noir plutôt', 'non', 'c’est combien la livraison ?', 'oui 0661234567']) expect(bareYes(t, shown)).toBe(false);
  });
  it('N5 T3 reply: the invented technical problem and the « répondez oui une nouvelle fois » are flagged and, kept, dropped for the field question', () => {
    const reply = "Désolé Karim, la commande n'est pas encore enregistrée à cause d'un problème technique de notre côté. Pouvez-vous répondre « oui » une nouvelle fois pour que je la renvoie ?";
    const facts = { ...buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText: 'oui', answeredBefore: true, freshStart: false }), orderRefused: true, missingField: 'communeName' };
    const v = checkReply(reply, facts);
    // both sentences: « … pas encore enregistrée … problème technique » (an order said not registered + the problem), then « oui » again
    expect([...new Set(v.map((x) => x.rule))].sort()).toEqual(['confirm_without_recap', 'invented_problem']);
    expect(enforceReply(reply, v, facts, { hasCards: false })).toEqual({ reply: 'Dans quelle commune êtes-vous ?', action: 'safe_sentence' });
    // a tool that really failed may be told
    expect(checkReply(reply, { ...facts, systemFailure: true, orderRefused: false }).map((x) => x.rule)).toEqual([]);
  });
  it.each(["un problème technique de notre côté", 'un petit souci technique', 'une erreur du système', 'There was a technical issue', 'kayen mochkil techni', 'كاين مشكل تقني'])('« %s » is an invented problem', (t) => expect(inventedProblem(t)).toBe(true));
  it.each(['Pas de souci, je vous la réserve.', 'Aucun problème !', 'Le problème de taille est réglé : nous avons la M.', 'ma kayen hta mochkil'])('« %s » is not', (t) => expect(inventedProblem(t)).toBe(false));
  it('the turn: a refused create_order + an invented problem ⇒ one corrective turn told both rules', async () => {
    const gateway = new FakeAiGateway();
    const bad = "Désolé Karim, la commande n'est pas encore enregistrée à cause d'un problème technique de notre côté. Pouvez-vous répondre « oui » une nouvelle fois pour que je la renvoie ?";
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: T3_CALL }] }, { reply: bad, intent: 'SALE' }, { reply: 'Dans quelle commune de Oran êtes-vous, Karim ?', intent: 'SALE' });
    const execute = jest.fn(async () => ({ ok: false, error: { code: 'VALIDATION', field: 'communeName', missing: true, fields: ['communeName', 'address'] } }));
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const guard = buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'B', customerText: 'oui', answeredBefore: true, freshStart: false });
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: 'oui' }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: 'oui', customerHistory: [...N5, 'oui'].join('\n') }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard };
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
    const instruction = String((gateway.calls[2]!.messages.at(-1) as { content: unknown }).content);
    expect(instruction).toContain('NO TECHNICAL PROBLEM');
    expect(instruction).toContain('NO RECAP WAS SHOWN');
    expect(instruction).toContain('Ask for their commune');
    expect(r.ok && r.output.reply).toBe('Dans quelle commune de Oran êtes-vous, Karim ?');
    expect(refusedOrder([{ name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } } }])).toBeNull();
  });
});

describe('R8-2 (Major) — the name the customer wrote in Arabic script is kept', () => {
  const F3 = ['nheb nechri zoudj tapis de prière', 'smiti وليد بوزيد'];
  const T3_TEXT = '0770112244, Blida, Boufarik, cite 20 aout villa 3';
  const CALL = { clientName: 'Walid Bouzid', clientPhone: '0770112244', wilayaId: 9, communeName: 'Boufarik', address: 'Cité 20 Août, villa 3, Boufarik', items: [{ productId: TAPIS.id, quantity: 2 }], customerConfirmed: true };
  it('the customer’s own text for the call’s transliteration; never another name', () => {
    expect(customerOwnName('Walid Bouzid', F3.join('\n'))).toBe('وليد بوزيد');
    expect(customerOwnName('Samir', 'Bonjour, je veux le tapis de prière\nسمير بن علي')).toBe('سمير بن علي');
    expect(customerOwnName('كريم حداد', 'slm, nheb djellaba\nsmiti Karim Haddad 0770112233')).toBe('Karim Haddad');
    expect(customerOwnName('Karim Haddad', F3.join('\n'))).toBeNull();
    expect(customerOwnName('Walid Bouzid Ali', F3.join('\n'))).toBeNull();
    expect(customerOwnName('Nadia', 'Bonjour\nنعم')).toBeNull();
  });
  it('F3 T3: the server recap shows « وليد بوزيد » (no refusal); T4 « ih » with the same call ⇒ the order', async () => {
    const t3 = (await registry([TAPIS]).prepareOrder(CALL, ctx(T3_TEXT, F3))) as Prepared;
    expect(t3.result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { clientName: 'وليد بوزيد', total: 6050 } });
    const t4 = (await registry([TAPIS]).prepareOrder(CALL, ctx('ih', [...F3, T3_TEXT], shownBefore(t3.result)))) as Prepared;
    expect(t4.ok).toBe(true);
    expect(t4.request).toMatchObject({ clientName: 'وليد بوزيد', total: 6050 });
  });
  it('a name the customer never wrote in any script is still refused', async () => {
    const r = (await registry([TAPIS]).prepareOrder({ ...CALL, clientName: 'Karim Haddad' }, ctx(T3_TEXT, F3))) as Prepared;
    expect(r.result).toMatchObject({ error: { code: 'VALIDATION', notGivenByCustomer: ['clientName'] } });
  });
  it('F3 T3 / T4 replies on a refused call: « recap coming » and « tu confirmes la commande ? » are flagged', () => {
    const facts = { ...buildGuardFacts({ lang: 'arabizi', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'B', customerText: 'ih', answeredBefore: true, freshStart: false }), orderRefused: true, missingField: 'clientName' };
    const t4 = 'Ih, Walid, tsajjel. Wach mazal ma tsajjelch: tu confirmes la commande ?';
    const v = checkReply(t4, facts).filter((x) => x.rule === 'confirm_without_recap');
    expect(v.map((x) => x.sentence)).toEqual([1]);
    expect(enforceReply(t4, v, facts, { hasCards: false }).reply).toBe('Ih, Walid, tsajjel. Wach smitek ?');
    expect(recapClaim('Le récapitulatif avec les frais de livraison et le total va venir, et tu pourras le confirmer.')).toBe(true);
    expect(recapClaim('Saha Walid, tsajjel: zoudj tapis de prière, Blida, Boufarik.')).toBe(false);
    // no refused create_order this turn (a cancellation asked to be confirmed): nothing is flagged
    expect(checkReply('Vous confirmez l’annulation de la commande TEST-3146 ?', { ...facts, orderRefused: false }).filter((x) => x.rule === 'confirm_without_recap')).toEqual([]);
  });
});

describe('R8-3 (Major) — the variant the customer named wins', () => {
  const N1 = ['Je prends la djellaba homme, Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3', 'Finalement je préfère le sac à main cuir marron à la place, et livrez-moi plutôt à Oran, Bir El Djir, cité 1000 logements bloc 4'];
  const CALL = { clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', isStopdesk: false, items: [{ productId: SAC.id, variantId: NOIR, quantity: 1 }], customerConfirmed: true };
  it('the latest message naming one variant of the product; two named, or only in an address ⇒ none', () => {
    expect(namedVariant(SAC.variants, N1.join('\n'))?.name).toBe('Marron');
    expect(namedVariant(SAC.variants, 'le sac en noir\nfinalement marron svp')?.name).toBe('Marron');
    expect(namedVariant(SAC.variants, 'le sac marron\nnoir ou marron, lequel est mieux ?')).toBeNull();
    expect(namedVariant(SAC.variants, 'je veux le sac, Alger, cité les Rouges bloc 4')).toBeNull();
    const sizes = [{ id: 's', name: 'S' }, { id: 'm', name: 'M' }, { id: '42', name: '42' }];
    expect(namedVariant(sizes, 'la robe en taille M')?.id).toBe('m');
    expect(namedVariant(sizes, 'Je la prends en 42')?.id).toBe('42');
    expect(namedVariant(sizes, 'Oran, cité 1000 logements bloc 42')).toBeNull();
    expect(namedVariant(sizes, 'nheb nechri l robe, ana f Blida')).toBeNull();
  });
  it('N1 T2: the call carries Noir ⇒ the server recap says « Marron »; the « oui » with Noir again ⇒ the Marron order', async () => {
    const t2 = (await registry([SAC]).prepareOrder(CALL, ctx(N1[1]!, N1.slice(0, 1)))) as Prepared;
    expect((t2.result!.recap as { items: unknown[] }).items).toEqual([{ name: 'Sac à main cuir', variant: 'Marron', quantity: 1, unitPrice: 6900 }]);
    const t3 = (await registry([SAC]).prepareOrder(CALL, ctx('oui', N1, shownBefore(t2.result)))) as Prepared;
    expect(t3.ok).toBe(true);
    expect(t3.request!.items[0]).toMatchObject({ variantId: MARRON, variant: 'Marron' });
  });
  it('a variant id one character off is read as its neighbour only when it is no variant of the shop', async () => {
    const typo = `${MARRON.slice(0, -1)}b`;
    const call = { ...CALL, items: [{ productId: SAC.id, variantId: typo, quantity: 1 }] };
    const history = ['Je veux le sac à main cuir, Yacine Mansouri 0555987654, Oran, Bir El Djir, cité 1000 logements bloc 4'];
    const unknown = (await registry([SAC], { knownVariantIds: async () => new Set<string>() }).prepareOrder(call, ctx('ok', history))) as Prepared;
    expect((unknown.result!.recap as { items: { variant: string }[] }).items[0]!.variant).toBe('Marron');
    const known = (await registry([SAC], { knownVariantIds: async (ids: string[]) => new Set(ids) }).prepareOrder(call, ctx('ok', history))) as Prepared;
    expect(known.result).toMatchObject({ error: { code: 'VARIANT_REQUIRED' } });
  });
});

describe('R8-4 — fewer probe calls', () => {
  it('N6 T1: an invented product id with the exact id of its variant ⇒ that product, no PRODUCT_NOT_AVAILABLE', async () => {
    const call = { clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements bloc 4', items: [{ productId: '01a1e51f-4180-7000-8000-000000000000', variantId: MARRON, quantity: 1 }], customerConfirmed: true };
    const r = (await registry([SAC], { variantOwners: async () => new Map([[MARRON, SAC.id]]) }).prepareOrder(call, ctx('Je veux le sac, Yacine Mansouri 0555987654, Oran, Bir El Djir, cité 1000 logements bloc 4', []))) as Prepared;
    expect(r.result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { items: [{ name: 'Sac à main cuir', variant: 'Marron' }] } });
  });
  it('N5 T2: no cancel_order on an order message; a cancellation still gets it', async () => {
    const go = async (text: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Merci !', intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.cancel_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: text }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: text, customerHistory: text }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
      await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(req);
      return (gateway.calls[0]!.tools ?? []).map((d) => d.name);
    };
    expect(await go('Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4')).toEqual(['create_order']);
    expect(await go('Annulez ma commande svp, Karim Haddad 0770112233, cité 1000 logements bloc 4')).toContain('cancel_order');
    expect(unavailableTool('cancel_order', true).instruction).toContain('did not ask to cancel');
    expect(unavailableTool('create_order', false, false, false, true).instruction).toContain('ask for the street address');
  });
  it('F1b T2: a message that only names the wilaya / commune', () => {
    const idx = buildPlaceIndex([{ id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف' }, { id: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر' }], [{ wilayaId: 19, nameFr: 'El Eulma', nameAr: 'العلمة' }, { wilayaId: 16, nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }]);
    for (const t of ['Sétif, El Eulma', 'ana f Bab Ezzouar', 'wilaya de Sétif', 'سطيف، العلمة']) expect(placeOnlyMessage(idx, t)).toBe(true);
    for (const t of ['El Eulma, Les Pins 12', 'Sétif, je préfère le stop-desk', 'Karim Haddad', 'Sétif ? c’est combien la livraison']) expect(placeOnlyMessage(idx, t)).toBe(false);
  });
});

describe('R8-5 — narrow darija fixes', () => {
  it.each([
    ['Wach smitek ? Ghir after that nkamlou la commande m3ak.', 'Wach smitek ? Mba3d nkamlou la commande m3ak.'],
    ["Ila 3andek wilaya okhra, a3tini ism'ha w nchouf ash nqder ndir lik.", "Ila 3andek wilaya okhra, a3tini ism'ha w nchouflek wach nqder ndirlek."],
    ['Ma 3andnachch tsawer ta3 had la robe f had lwaqt', 'Ma 3andnach tsawer ta3 had la robe f had lwaqt'],
    ['ومازال ما تخرجتش للتوصيل، راهي في التحضير.', 'ومازال ما خرجتش للتوصيل، راهي في التحضير.'],
  ])('« %s » is flagged and fixed', (from, to) => {
    expect(wrongDarijaIn(from)).toBe(true);
    expect(fixMoroccan(from)).toBe(to);
  });
  it.each(['After that, we deliver in 2 to 5 days.', 'Ma 3andnach tsawer ta3ou f had lwaqt.', 'ما خرجتش للتوصيل', 'nchouflek wach nqder ndirlek'])('« %s » stays', (t) => {
    expect(wrongDarijaIn(t)).toBe(false);
    expect(fixMoroccan(t)).toBe(t);
  });
});
