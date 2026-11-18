// Journey retest R7 (17/11, docs/audit/journeys-2026-11-16/journeys/R7-ai-orders.md): « quand même » read as a question and a
// recap line said twice (R7-1), a photo request on a product without a photo left unanswered (R7-2), odd wording and filler
// answers (R7-3), tool probes (R7-4), « Vous livrez à Blida ? » without the fee (R7-5).
import { prisma } from '@djaber/db';
import { AiRunService, NO_PLACE_NOTE, NO_STREET_NOTE, ORDER_DETAILS_NOTE, RECAP_READY_NOTE, unavailableTool, type TurnRequest } from './ai-run.service';
import { nearestId } from './catalogue.service';
import { orderDetailsMessage } from './handoff-judge';
import { fixMoroccan, wrongDarijaIn } from './language';
import { deliverySection } from './prompt/sections/orders';
import { identitySection } from './prompt/sections/identity';
import { languageSection } from './prompt/sections/contract';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { fillerMessage, noPhotoReply, noPhotoSaid, photoAsked, withoutPresenceTalk } from './reply-fixes';
import { buildGuardFacts, checkReply, enforceReply, quoteFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderRecapText, pendingRecap, recapLeadIn, recapReply, repeatsRecapLine } from './tools/order-confirmation-text';
import { buildPlaceIndex, placeNamedIn, resetPlaceIndex, wilayaIn } from './tools/place-index';
import { ToolRegistry, TOOL_DEFS } from './tools/tool-registry';

// journey retest R15-1: a turn naming a catalogue product reads the place lists (the server's quote of a place) — unreadable here
// (no database: nothing is withheld or quoted on their account), unless a test gives them
beforeEach(() => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockRejectedValue(new Error('no database in unit tests'));
  jest.spyOn(prisma.commune, 'findMany').mockRejectedValue(new Error('no database in unit tests'));
});
afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const WILAYAS = [
  { id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة' },
  { id: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر' },
  { id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف' },
  { id: 25, code: '25', nameFr: 'Constantine', nameAr: 'قسنطينة' },
  { id: 31, code: '31', nameFr: 'Oran', nameAr: 'وهران' },
];
const COMMUNES = [
  { wilayaId: 19, nameFr: 'El Eulma', nameAr: 'العلمة' },
  { wilayaId: 16, nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' },
  { wilayaId: 9, nameFr: 'Boufarik', nameAr: 'بوفاريك' },
  { wilayaId: 31, nameFr: 'Bir El Djir', nameAr: 'بئر الجير' },
];
/** The reference lists of the place index, from the fixtures (no database in unit tests). */
const places = () => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue(WILAYAS as never);
  jest.spyOn(prisma.commune, 'findMany').mockResolvedValue(COMMUNES as never);
};
const turnReq = (customerText: string, history: string, o: Partial<TurnRequest> = {}): TurnRequest => ({
  runId: 'r',
  prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
  toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: history },
  temperature: 0.5,
  maxTokens: 500,
  deadline: Date.now() + 30_000,
  persist: false,
  ...o,
});

describe('R7-1 — « quand même » is no question; a line of the server recap is not said twice', () => {
  const N10_C = "Bon d'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12";
  const recap = pendingRecap([
    {
      name: 'create_order',
      result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Montre connectée', quantity: 1, unitPrice: 15_900 }], deliveryFee: 650, total: 16_550, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Sétif', communeName: 'El Eulma', address: 'Cité 500 logements bloc 12', isStopdesk: false, beyondStock: [{ name: 'Montre connectée', quantity: 1 }] } },
    },
  ])!;
  it('N10 T3: « Merci Karim ! » stays, « La montre peut prendre un peu plus de temps à être livrée. » is dropped (the recap says it)', () => {
    const server = orderRecapText(recap, 'fr');
    expect(server).toContain('Une partie de la commande peut prendre un peu plus de temps à être livrée.');
    expect(recapReply('Merci Karim ! La montre peut prendre un peu plus de temps à être livrée.', recap, 'fr', N10_C).text).toBe(`Merci Karim !\n\n${server}`);
  });
  it('« quand même » asks nothing: an answer-like sentence is dropped; a real question keeps its answer', () => {
    expect(recapLeadIn('Oui, on livre à Sétif.', recap, N10_C)).toEqual([]);
    expect(recapLeadIn('Oui, on livre à Sétif.', recap, 'Vous livrez quand même à Sétif ?')).toEqual(['Oui, on livre à Sétif.']);
    expect(recapLeadIn('Oui, on livre à Sétif.', recap, 'Quand est-ce que vous livrez à Sétif')).toEqual(['Oui, on livre à Sétif.']);
  });
  it('the beyond-stock delay in other words and languages, and the replaced order, are recap lines too', () => {
    expect(repeatsRecapLine('La livraison de la montre sera un peu plus longue.', recap)).toBe(true);
    expect(repeatsRecapLine('It may take longer to arrive.', recap)).toBe(true);
    expect(repeatsRecapLine('Lmontre ymken tt3attel chwiya.', recap)).toBe(false);
    expect(repeatsRecapLine('Juz2 men la commande ymken yt3atel chwiya f tawsil.', recap)).toBe(true);
    expect(repeatsRecapLine('Oui, on livre à Sétif.', recap)).toBe(false);
    expect(repeatsRecapLine('هذي تعوض TEST-6619.', { replaces: 'TEST-6619' })).toBe(true);
    expect(repeatsRecapLine('Oui, on livre à Blida.', { replaces: 'TEST-6619' })).toBe(false);
    // without beyond-stock items nothing about a delay is a recap line
    expect(repeatsRecapLine('La livraison peut prendre un peu plus de temps.', { replaces: null, beyondStock: undefined } as never)).toBe(false);
  });
});

describe('R7-2 — a photo request for a product without a photo is answered « no photo »', () => {
  const N9_C = 'Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ?';
  it.each([N9_C, 'Envoyez-moi une photo svp', 'vous avez des photos de la djellaba ?', 'عندكم تصاور تاع الجلابة ؟', 'sifetli tsawer ta3 tapis de prière', 'Can I see a picture?'])('« %s » asks for a photo', (t) => expect(photoAsked(t)).toBe(true));
  it.each(['Je veux la robe comme sur la photo', 'Je vous envoie la photo du modèle', 'Bonjour, je veux la robe kabyle', 'kima f tswira'])('« %s » does not', (t) => expect(photoAsked(t)).toBe(false));
  it.each(['Ma 3andnach tsawer ta3ou f had lwaqt.', "Nous n'avons pas encore de photo de ce produit.", "We don't have a photo of it yet.", 'ما عندناش تصاور تاعو درك.', 'Pas de photo pour le moment.'])('« %s » says there is none', (t) => expect(noPhotoSaid(t)).toBe(true));
  it.each(['Hak tsawer ta3 la robe.', 'Robe kabyle brodée bil yed, b qmach khfif.'])('« %s » does not', (t) => expect(noPhotoSaid(t)).toBe(false));
  it('the sentence in the customer’s language, first; the details offered when the reply gives none', () => {
    expect(noPhotoReply('Robe kabyle brodée bil yed, b qmach khfif. Kayen f taille S w M b 4900 DA.', 1, 'arabizi')).toBe('Ma 3andnach tsawer ta3ou f had lwaqt. Robe kabyle brodée bil yed, b qmach khfif. Kayen f taille S w M b 4900 DA.');
    expect(noPhotoReply('Wach men taille t7ebb ?', 1, 'arabizi')).toBe('Ma 3andnach tsawer ta3ou f had lwaqt, bessah nqder n9ollek ga3 les détails. Wach men taille t7ebb ?');
    expect(noPhotoReply('', 2, 'fr')).toBe("Nous n'avons pas encore de photo de ces produits, mais je peux vous donner tous les détails.");
    expect(noPhotoReply('Elle est en soie.', 1, 'ar')).toBe('ما عندناش تصاور تاعو درك، بصح نقدر نقولك كامل التفاصيل. Elle est en soie.');
    expect(noPhotoReply('It is silk, 180 x 70 cm.', 1, 'en')).toBe("We don't have a photo of this product yet. It is silk, 180 x 70 cm.");
  });
  const product = (id: string, name: string, imageUrl: string | null) => ({ id, name, sku: id.toUpperCase(), price: 4900, oldPrice: null, hasVariants: false, variants: [], also: [], description: null, stock: 5, sellOutOfStock: false, imageUrl });
  const facts = (customerText: string) => buildGuardFacts({ lang: 'arabizi', products: [product('robe', 'Robe kabyle brodée', null), product('sac', 'Sac à main cuir', 'https://cdn/sac.webp')], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: false, freshStart: true });
  const run = async (customerText: string, cards: string[], ...replies: string[]) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', ...replies.map((reply) => ({ reply, intent: 'INFO', productCards: cards })));
    const tools = { defsFor: async () => [TOOL_DEFS.get_product], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const r = await svc.turn(turnReq(customerText, customerText, { guard: facts(customerText) }));
    return { reply: r.ok ? r.output.reply : '', calls: gateway.calls.length };
  };
  it('the turn — N9 T1: the guard rewrote the draft (« nwarrik ») and the rewrite says nothing of the photo ⇒ the server says it first', async () => {
    const draft = 'Robe kabyle brodée bil yed, b qmach khfif. Kayen f taille S w M b 4900 DA. T7ebb nwarrik wach men taille ?';
    const rewrite = 'Robe kabyle brodée bil yed, b qmach khfif. Kayen f taille S w M b 4900 DA. Wach men taille t7ebb ?';
    const a = await run(N9_C, ['robe'], draft, rewrite);
    expect(a.calls).toBe(2);
    expect(a.reply).toBe(`Ma 3andnach tsawer ta3ou f had lwaqt. ${rewrite}`);
  });
  it('the turn: the reply says it already, a product with a photo is sent, or no photo was asked ⇒ nothing added', async () => {
    const said = 'Ma 3andnach tsawer ta3ha f had lwaqt. Robe brodée bil yed, b qmach khfif.';
    expect((await run(N9_C, ['robe'], said)).reply).toBe(said);
    expect((await run('ab3athli tswira ta3 sac', ['sac'], 'Sac à main cuir, kayen f noir w marron.')).reply).toBe('Sac à main cuir, kayen f noir w marron.');
    expect((await run('Salam, 9olli 3la la robe kabyle brodée', ['robe'], 'Robe kabyle brodée bil yed, b qmach khfif.')).reply).toBe('Robe kabyle brodée bil yed, b qmach khfif.');
    // no card and no product of a tool: the server cannot tell which product — nothing is added
    expect((await run(N9_C, [], 'Wach men robe t7ebb ?')).reply).toBe('Wach men robe t7ebb ?');
  });
});

describe('R7-3 — odd wording; a filler message gets the pending question only', () => {
  it('N11 T3 « للحين », « تتشحن » ⇒ « درك », « تخرج » (flagged like the other wrong darija words)', () => {
    const n11 = 'ما عندناش رقم تتبع للحين، وبمجرد ما تتشحن راح نعطيك الرقم.';
    expect(wrongDarijaIn(n11)).toBe(true);
    expect(fixMoroccan(n11)).toBe('ما عندناش رقم تتبع درك، وبمجرد ما تخرج راح نعطيك الرقم.');
    expect(checkReply(n11, buildGuardFacts({ lang: 'ar', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'B', customerText: 'وين راهي الطلبية تاعي؟', answeredBefore: true, freshStart: false })).map((v) => v.rule)).toContain('moroccan_darija');
  });
  it('N9 T1 « T7ebb nwarrik wach men taille ? » ⇒ « Wach men taille t7ebb ? »; « T7ebb nwarrik la robe ? » (show a product) stays', () => {
    expect(fixMoroccan('Kayen S w M. T7ebb nwarrik wach men taille ?')).toBe('Kayen S w M. Wach men taille t7ebb ?');
    expect(fixMoroccan('t7ebb nwarrik wach men couleur ?')).toBe('wach men couleur t7ebb ?');
    expect(wrongDarijaIn('T7ebb nwarrik la robe ?')).toBe(false);
    expect(fixMoroccan('T7ebb nwarrik la robe ?')).toBe('T7ebb nwarrik la robe ?');
  });
  it.each(['?', '...', '…', '👍', '??', '😅'])('« %s » is a filler message', (t) => expect(fillerMessage(t)).toBe(true));
  it.each(['ok', '? merci', 'Nadia', '0661234568', ''])('« %s » is not', (t) => expect(fillerMessage(t)).toBe(false));
  it('N12 T2 / T4: « je suis là » / « toujours là ? » dropped, the pending question kept; nothing else left ⇒ kept as is', () => {
    expect(withoutPresenceTalk('Oui, je suis là ! Pour commander votre Hijab soie à 1500 DA, quel est votre nom ?')).toBe('Pour commander votre Hijab soie à 1500 DA, quel est votre nom ?');
    expect(withoutPresenceTalk('Vous êtes toujours là, Nadia ? Dans quelle wilaya habitez-vous pour que je calcule la livraison de votre Hijab soie ?')).toBe('Dans quelle wilaya habitez-vous pour que je calcule la livraison de votre Hijab soie ?');
    expect(withoutPresenceTalk("I'm here! What is your name?")).toBe('What is your name?');
    expect(withoutPresenceTalk('Rani hna. Wach men wilaya ?')).toBe('Wach men wilaya ?');
    expect(withoutPresenceTalk('Je suis là !')).toBe('Je suis là !');
    expect(withoutPresenceTalk("C'est toujours la même taille ? Quel est votre nom ?")).toBe("C'est toujours la même taille ? Quel est votre nom ?");
  });
  it('the turn: « ? » ⇒ the presence sentence is dropped; on another message it stays', async () => {
    const reply = 'Oui, je suis là ! Pour commander votre Hijab soie à 1500 DA, quel est votre nom ?';
    const go = async (customerText: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply, intent: 'SALE' });
      const tools = { defsFor: async () => [], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(customerText, `Bonjour, je veux 1 hijab soie\n${customerText}`));
      return r.ok ? r.output.reply : '';
    };
    expect(await go('?')).toBe('Pour commander votre Hijab soie à 1500 DA, quel est votre nom ?');
    expect(await go('vous êtes là ?')).toBe(reply);
  });
  it('the prompt: filler rule, « Wach men taille t7ebb ? », « درك » / « كي تخرج الطلبية »', () => {
    expect(identitySection({ agent: { displayName: null, name: 'A', personality: 'friendly' }, workspace: { name: 'B', systemMessages: {} }, lang: 'fr', locale: 'fr', firstReply: false } as never)).toContain('A message with only « ? », « ... », « … » or an emoji while you wait for an answer is a nudge');
    const lang = languageSection({ lang: 'arabizi', agent: { language: 'fr' } } as never);
    expect(lang).toContain('which size / colour « Wach men taille t7ebb ? »');
    expect(lang).toContain('(never « للحين »), shipped « كي تخرج الطلبية » (never « تتشحن »)');
  });
});

describe('R7-4 — fewer probe calls', () => {
  const HIJAB = '01a1e51f-4737-7bdb-8104-25ba3e09450a';
  const SHOP = [HIJAB, '01a1e51f-419b-7c1c-8091-4d764e9a48ee', '01a1e51f-48c7-7916-8119-8895e76e3400', '01a1e51f-42d2-725a-80ac-163a0fd34766'];
  it('F11 T1 / N10 T3: a product id one or two characters off is its product; an exact, far or ambiguous id is not', () => {
    expect(nearestId('01a1e51f-737c-7bdb-8104-25ba3e09450a', SHOP)).toBe(HIJAB);
    expect(nearestId('01a1e54f-9ef5-766e-895d-6890a5f33123', ['01a1e54f-9fb5-766e-895d-6890a5f33123', '01a1e54f-a0b9-7ae5-8971-96c0cc39d155'])).toBe('01a1e54f-9fb5-766e-895d-6890a5f33123');
    expect(nearestId(HIJAB, SHOP)).toBeNull();
    expect(nearestId('01a1e51f-1111-7222-8333-444444444444', SHOP)).toBeNull();
    expect(nearestId('01a1e51f-4737-7bdb-8104-25ba3e09450b', [HIJAB, '01a1e51f-4737-7bdb-8104-25ba3e09450c'])).toBeNull();
  });
  it('get_product / check_availability with a mistyped product or variant id answer for the product (the recap names it)', async () => {
    const p = { id: HIJAB, name: 'Hijab soie', sku: 'PRD-1', price: 1500, oldPrice: 2000, stock: 5, sellOutOfStock: false, description: null, hasVariants: true, variants: [{ id: '01a1e51f-41c7-7618-8094-4937ffea21d1', name: 'M', price: 1500, stock: 5 }, { id: '01a1e51f-41d8-7220-8096-a9dfe335b36c', name: 'L', price: 1500, stock: 0 }], imageUrl: null, imageKey: null, category: null, also: [] };
    const catalogue = { byIds: async (_a: unknown, ids: string[]) => (ids.includes(HIJAB) ? [p] : []), correctIds: async (_a: unknown, ids: string[]) => new Map(ids.filter((id) => nearestId(id, SHOP) === HIJAB).map((id) => [id, HIJAB])) };
    const reg = Object.assign(Object.create(ToolRegistry.prototype) as object, { catalogue }) as unknown as ToolRegistry;
    const ctx = { agent: {} } as never;
    expect(await reg.execute('get_product', { productId: '01a1e51f-737c-7bdb-8104-25ba3e09450a' }, ctx)).toMatchObject({ id: HIJAB, name: 'Hijab soie' });
    expect(await reg.execute('check_availability', { productId: HIJAB, variantId: '01a1e51f-41c7-7618-8094-4937ffea21d2', quantity: 1 }, ctx)).toMatchObject({ ok: true, variant: 'M', available: true });
    expect(await reg.execute('get_product', { productId: '01a1e51f-1111-7222-8333-444444444444' }, ctx)).toMatchObject({ ok: false, error: { code: 'PRODUCT_NOT_AVAILABLE' } });
  });
  it('N5 T2: an order message with a phone that asks nothing of the team; a person, a problem, a cancellation or a question is not', () => {
    const phone = (t: string) => /0[5-7]\d{8}/.test(t.replace(/\s/g, ''));
    expect(orderDetailsMessage('Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4', phone)).toBe(true);
    expect(orderDetailsMessage('السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب', phone)).toBe(true);
    expect(orderDetailsMessage("Je veux parler à quelqu'un, 0661234567", phone)).toBe(false);
    expect(orderDetailsMessage("Ma commande n'est jamais arrivée, 0661234567", phone)).toBe(false);
    expect(orderDetailsMessage('Annulez ma commande svp 0661234567', phone)).toBe(false);
    expect(orderDetailsMessage('Vous livrez à Oran ? 0661234567', phone)).toBe(false);
    expect(orderDetailsMessage('Bon finalement je le prends, Karim Haddad', phone)).toBe(false);
  });
  it('the turn — N5 T2: no handoff tool on the order message, the note says why', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Merci Karim !', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const text = 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, `Bonjour, le parfum oud c'est combien ?\n${text}`));
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toEqual(['create_order']);
    // journey retest R16-3: every field is given — create_order computes the fee and the stock (no quote / check before it)
    expect(gateway.calls[0]!.system).toBe(`S\n\n${ORDER_DETAILS_NOTE}\n\n${RECAP_READY_NOTE}`);
  });
  it('a place is named by a wilaya, a commune of one or « wilaya 16 » (F1b T1 names none)', () => {
    const idx = buildPlaceIndex(WILAYAS, COMMUNES);
    expect(placeNamedIn(idx, 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233')).toBe(false);
    expect(placeNamedIn(idx, 'Je voudrais le sac\nSétif, El Eulma')).toBe(true);
    expect(placeNamedIn(idx, 'je suis à Bab Ezzouar')).toBe(true);
    expect(placeNamedIn(idx, 'wilaya 16 svp')).toBe(true);
    expect(placeNamedIn(idx, 'البليدة')).toBe(true);
    expect(wilayaIn(idx, 'nseken f Bir El Djir')?.id).toBe(31);
  });
  it('the turn — F1b T1: no wilaya and no address yet ⇒ create_order not offered, the note says why; a call anyway is not run', async () => {
    places();
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 1, items: [{ productId: 'p', quantity: 1 }], customerConfirmed: true } }] }, { reply: 'Merci Karim ! Dans quelle wilaya souhaitez-vous être livré ?', intent: 'SALE' });
    const execute = jest.fn();
    const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const f1b = 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233';
    const r = await svc.turn(turnReq(f1b, f1b));
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toEqual(['search_products']);
    expect(gateway.calls[0]!.system).toContain(NO_PLACE_NOTE);
    expect(execute).not.toHaveBeenCalled();
    expect(String((gateway.calls[1]!.messages.at(-1) as { content: unknown }).content)).toContain('has not named their wilaya yet');
    expect(r.ok && r.output.reply).toBe('Merci Karim ! Dans quelle wilaya souhaitez-vous être livré ?');
    // « Sétif, El Eulma » next: the wilaya is named (no NO_PLACE_NOTE) — journey retest R8-4: but the message only names the
    // place and no street was given, so create_order is still not offered (NO_STREET_NOTE); a street next ⇒ offered
    const next = new FakeAiGateway();
    next.script('reply', { reply: 'Quelle est votre adresse à El Eulma ?', intent: 'SALE' });
    await new AiRunService(next, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Sétif, El Eulma', `${f1b}\nSétif, El Eulma`));
    expect((next.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('create_order');
    expect(next.calls[0]!.system).not.toContain(NO_PLACE_NOTE);
    expect(next.calls[0]!.system).toContain(NO_STREET_NOTE);
    const street = new FakeAiGateway();
    street.script('reply', { reply: 'Merci !', intent: 'SALE' });
    await new AiRunService(street, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('El Eulma, Les Pins 12', `${f1b}\nEl Eulma, Les Pins 12`));
    expect((street.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
    expect(unavailableTool('create_order', false, false, true).instruction).toContain('has not named their wilaya yet');
  });
  it('a returning customer (client record / earlier order) keeps create_order offered', async () => {
    places();
    jest.spyOn(prisma.clientAddress, 'findFirst').mockResolvedValue({ id: 'a1' } as never);
    jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null as never);
    jest.spyOn(prisma.client, 'findUnique').mockResolvedValue({ phone: '0770112233', phone2: null } as never);
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Merci !', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const req = turnReq('je veux le sac', 'je veux le sac');
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn({ ...req, toolCtx: { ...req.toolCtx, clientId: 'c1' } });
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
  });
});

describe('R7-5 — « Vous livrez à Blida ? » gives the fee', () => {
  const QUOTE = { ok: true, wilayaId: 9, wilayaName: 'Blida', wilayaNameAr: 'البليدة', isStopdesk: false, fee: 450, free: false, freeFrom: null, freeFor: null, stopdeskAvailable: true, stopdeskFee: 300, etaDays: '2–5' };
  const F12_C = 'Bonsoir, vous livrez à Blida ?';
  const F12_AI = 'Bonsoir ! Oui, on livre à Blida. La livraison se fait avec ZR Express, en 2 à 5 jours. Vous cherchez quelque chose en particulier ?';
  const facts = (customerText: string) => buildGuardFacts({ lang: 'fr', products: [], shopTexts: ['Livraison dans 58 wilayas avec ZR Express, 2 à 5 jours.'], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: false, freshStart: true });
  const setup = (...replies: { reply?: string; toolCalls?: { name: string; args: Record<string, unknown> }[] }[]) => {
    places();
    const gateway = new FakeAiGateway();
    gateway.script('reply', ...(replies.map((r) => (r.toolCalls ? r : { ...r, intent: 'INFO' })) as never[]));
    const execute = jest.fn(async () => QUOTE);
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    return { gateway, execute, svc: new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never) };
  };
  it('F12 T1: answered without quote_delivery ⇒ the server runs it, one corrective turn gives the fee', async () => {
    const fixed = 'Bonsoir ! Oui, on livre à Blida : 450 DA à domicile ou 300 DA en stop-desk, en 2 à 5 jours. Vous cherchez quelque chose en particulier ?';
    const { gateway, execute, svc } = setup({ reply: F12_AI }, { reply: fixed });
    const r = await svc.turn(turnReq(F12_C, F12_C, { guard: facts(F12_C) }));
    expect(execute).toHaveBeenCalledWith('quote_delivery', { wilayaId: 9 }, expect.anything());
    expect(gateway.calls).toHaveLength(2);
    expect(String((gateway.calls[1]!.messages.at(-1) as { content: unknown }).content)).toContain('DELIVERY FEE: quote_delivery answered Blida: home 450 DA, stop-desk 300 DA');
    expect(r.ok && r.output.reply).toBe(fixed);
    expect(r.ok && r.tools.map((t) => t.name)).toEqual(['quote_delivery']);
  });
  it('the corrective turn still gave none ⇒ the fee sentence goes after the greeting', async () => {
    const { svc } = setup({ reply: F12_AI }, { reply: F12_AI });
    const r = await svc.turn(turnReq(F12_C, F12_C, { guard: facts(F12_C) }));
    expect(r.ok && r.output.reply).toMatch(/^Bonsoir ! Livraison à Blida : 450\sDA à domicile, 300\sDA en stop-desk\. Oui, on livre à Blida\./u);
  });
  it('the model called quote_delivery, or the message names no wilaya ⇒ the server runs nothing', async () => {
    const a = setup({ toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Blida' } }] }, { reply: 'Oui, on livre à Blida : 450 DA à domicile, 300 DA en stop-desk.' });
    await a.svc.turn(turnReq(F12_C, F12_C, { guard: facts(F12_C) }));
    expect(a.execute).toHaveBeenCalledTimes(1);
    expect(a.execute).toHaveBeenCalledWith('quote_delivery', { wilayaName: 'Blida' }, expect.anything());
    const b = setup({ reply: 'Oui, on livre partout en Algérie. Dans quelle wilaya êtes-vous ?' });
    await b.svc.turn(turnReq('Vous livrez ?', 'Vous livrez ?', { guard: facts('Vous livrez ?') }));
    expect(b.execute).not.toHaveBeenCalled();
  });
  it('the fee sentence after an opening greeting, or first', () => {
    const f = { ...facts(F12_C), quotes: quoteFacts([{ name: 'quote_delivery', result: QUOTE }]) };
    const v = checkReply(F12_AI, f);
    expect(v.map((x) => x.rule)).toEqual(['fee_missing']);
    expect(enforceReply(F12_AI, v, f, { hasCards: false }).reply).toMatch(/^Bonsoir ! Livraison à Blida : 450\sDA/u);
    expect(enforceReply('Oui, on livre à Blida.', v, f, { hasCards: false }).reply).toMatch(/^Livraison à Blida : 450\sDA à domicile, 300\sDA en stop-desk\. Oui, on livre à Blida\.$/u);
  });
  it('the prompt: a delivery question is answered with quote_delivery (fee and delay)', () => {
    expect(deliverySection({ workspace: { freeDeliveryThreshold: null, senderWilaya: null } } as never)).toContain('A question whether you deliver to a place (« vous livrez à Blida ? »');
  });
});
