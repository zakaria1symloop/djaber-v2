// Journey retest R11 (17/11, docs/audit/journeys-2026-11-16/journeys/R11-ai-orders.md): a malformed `items` refused « not given
// yet », then « Pouvez-vous confirmer pour que je passe la commande ? » with no recap (R11-1); a handoff accepted for a product the
// shop does not sell (R11-2); probes on field messages (R11-3); the recap address wilaya first (R11-4); a reply failing the schema
// ⇒ 503 (R11-5); wording (R11-6). Transcripts: .local/qa/journeys/R11/out/transcripts/ (F1b, N7, F8, N21, N3, N11, N9).
import { prisma } from '@djaber/db';
import { AiRunService, catalogueAnswered, FIELD_ONLY_NOTE, orderClosedBy, PLAIN_TEXT_REMINDER, refusedOrder, type TurnRequest } from './ai-run.service';
import { allowedHandoffReasons, fieldOnlyMessage, judgeHandoff, messageHandoffReasons, nameOnlyMessage, placeCandidate, productAsk } from './handoff-judge';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabiziWords, withOneNowWord, withOrderStatusWording } from './reply-fixes';
import { buildGuardFacts, checkReply, guardInstruction } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { parseReplyOutput } from './structured-output';
import type { OrderCallHistory } from './tools/order-confirmation';
import { confirmRequest, orderRecapText, pendingRecap, withoutPlaceSegments } from './tools/order-confirmation-text';
import { resetPlaceIndex } from './tools/place-index';
import { itemsFromArg, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

beforeEach(() => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue([
    { id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة' },
    { id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف' },
  ] as never);
  jest.spyOn(prisma.commune, 'findMany').mockResolvedValue([
    { wilayaId: 9, nameFr: 'Boufarik', nameAr: 'بوفاريك' },
    { wilayaId: 19, nameFr: 'El Eulma', nameAr: 'العلمة' },
  ] as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  resetPlaceIndex();
});

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const J03_AGENT = { humanHandoffRules: 'Transférer toute demande de devis.', handoffKeywords: ['grossiste'], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never;
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> & { orderHistory?: OrderCallHistory; ordering?: boolean } = {}): TurnRequest => {
  const { orderHistory, ordering, ...rest } = o;
  return {
    runId: 'r',
    prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
    toolCtx: { workspaceId: 'w', agent: J03_AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), ...(orderHistory ? { orderHistory } : {}), ...(ordering !== undefined ? { ordering } : {}) },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    ...rest,
  };
};
const facts = (customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: true, freshStart: false, ...o });
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);

// --- R11-1 -------------------------------------------------------------------------------------------------------------------------
describe('R11-1 (Major) — `items` sent as a string; a request to confirm on a refused turn', () => {
  // F1b (J03 shop): T1 « Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233 », T2 « Sétif, El Eulma », T3 the street
  const INVENTED = '01a1e54f-9efa-72b8-8949-a68fb6dca3f6';
  const SAC = '01a1e54f-a0b9-7ae5-8971-96c0cc39d155';
  const MARRON = '01a1e54f-a0e1-7b60-8974-d647387f0eda';
  const F1B = ['Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233', 'Sétif, El Eulma', 'Cité 500 logements bloc 12'];
  const F1B_ITEMS = `[{"productId": "${INVENTED}".replace("${INVENTED}","${SAC}"), "variantId": "${MARRON}", "quantity": 1}]`;
  const F1B_T3 = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, communeName: 'El Eulma', address: 'Cité 500 logements bloc 12', isStopdesk: false, items: F1B_ITEMS, customerConfirmed: true };
  const F1B_T3_REPLY = "Parfait Karim, j'ai noté : Sac à main cuir Marron, 1 pièce, livraison à domicile à Cité 500 logements bloc 12, El Eulma (650 DA). Pouvez-vous confirmer pour que je passe la commande ?";
  const sac = { id: SAC, name: 'Sac à main cuir', price: 6900, hasVariants: true, variants: [{ id: '01a1e54f-a0cd-746a-8972-de0bf0d05b35', name: 'Noir', price: 6900, stock: 4 }, { id: MARRON, name: 'Marron', price: 6900, stock: 3 }], stock: 7, sellOutOfStock: false };
  const registry = () => {
    const catalogue = { byIds: async (_a: unknown, ids: string[]) => (ids.includes(SAC) ? [sac] : []) };
    const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }] } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: () => Promise<Record<string, unknown>> };
    jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
    jest.spyOn(r, 'quote').mockResolvedValue({ ok: true, wilayaId: 19, wilayaName: 'Sétif', fee: 650, free: false });
    return reg;
  };
  const ctx = (customerText: string, history: string[]): Omit<ToolRunContext, 'callId'> & { callId: string } => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: history.join('\n'), orderHistory: [], ordering: true });

  it('itemsFromArg: the F1b code string, a JSON string, one object, an array of JSON strings — and what cannot be read', () => {
    expect(itemsFromArg(F1B_ITEMS)).toEqual({ normalized: true, items: [{ productId: INVENTED, variantId: MARRON, quantity: 1, candidates: [INVENTED, SAC] }] });
    expect(itemsFromArg(JSON.stringify([{ productId: SAC, variantId: MARRON, quantity: 2 }]))).toEqual({ normalized: true, items: [{ productId: SAC, variantId: MARRON, quantity: 2, candidates: [SAC] }] });
    expect(itemsFromArg({ productId: SAC, quantity: 1 })).toMatchObject({ normalized: true, items: [{ productId: SAC, quantity: 1 }] });
    expect(itemsFromArg([JSON.stringify({ productId: SAC, quantity: 1 })])).toMatchObject({ normalized: true, items: [{ productId: SAC }] });
    expect(itemsFromArg([{ productId: SAC, quantity: 1 }])).toEqual({ normalized: false, items: [{ productId: SAC, quantity: 1 }] });
    expect(itemsFromArg('le sac marron')).toBeNull();
    expect(itemsFromArg(42)).toBeNull();
  });

  it('F1b T3: the code string is read into the Sac à main cuir (Marron) ⇒ the server recap, never « not given yet »', async () => {
    const r = await registry().prepareOrder(F1B_T3, ctx(F1B[2]!, F1B));
    expect(r.ok).toBe(false);
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { total: 7550, items: [{ name: 'Sac à main cuir', variant: 'Marron', quantity: 1 }] } });
    const text = orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'fr');
    expect(text).toContain('- 1 × Sac à main cuir (Marron) : 6 900 DA');
    expect(text).toContain('Adresse : Cité 500 logements bloc 12, El Eulma, Sétif');
  });

  it('an `items` that cannot be read ⇒ a precise refusal naming the shape, which does not close create_order nor asks the customer', async () => {
    const r = await registry().prepareOrder({ ...F1B_T3, items: 'le sac marron, 1' }, ctx(F1B[2]!, F1B));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION', field: 'items', malformed: true } });
    expect(String(result.say)).toContain('JSON array of objects');
    expect(String(result.say)).not.toContain('has not given');
    expect(orderClosedBy('create_order', result)).toBe(false);
    expect(refusedOrder([{ name: 'create_order', result }])).toEqual({ field: null, code: 'VALIDATION', argsOnly: true });
  });

  it('confirmRequest: the « confirm it yourself » family, and the sentences that are none', () => {
    for (const s of [
      'Pouvez-vous confirmer pour que je passe la commande ?',
      'Pouvez-vous me confirmer la commande ?',
      'Voulez-vous confirmer ?',
      'Confirmez-moi et je lance la commande.',
      'Merci de confirmer.',
      'Dès votre confirmation, je passe la commande.',
      'Une fois confirmé, la commande part demain.',
      'Je passe la commande ?',
      'On valide votre commande ?',
      'Je vous confirme la commande ?',
      'Could you confirm, please?',
      'Nconfirmilek la commande ?',
      'T2akked ?',
      'Nsajjel la commande ?',
      'نأكدلك الطلبية ؟',
      'نسجلك الطلبية ؟',
    ])
      expect([s, confirmRequest(s)]).toEqual([s, true]);
    for (const s of [
      'Donnez-moi votre adresse (rue, cité) pour que je passe la commande.',
      'Pouvez-vous me confirmer votre numéro de téléphone ?',
      "Pouvez-vous me confirmer de quel produit il s'agit ?",
      'Pouvez-vous confirmer la taille ?',
      'Vous confirmez l’annulation de la commande TEST-3146 ?',
      'Voulez-vous le Coffret cadeau Aïd à la place ?',
      'Dans quelle wilaya habitez-vous ?',
      'Wach men wilaya ?',
      'Je vous confirme que la livraison est gratuite.',
    ])
      expect([s, confirmRequest(s)]).toEqual([s, false]);
  });

  it('the guard: on a turn whose create_order was refused, « Pouvez-vous confirmer pour que je passe la commande ? » is flagged', () => {
    const f = { ...facts(F1B[2]!), orderRefused: true };
    expect(checkReply(F1B_T3_REPLY, f).filter((v) => v.rule === 'confirm_without_recap').map((v) => v.sentence)).toEqual([1]);
    const instruction = guardInstruction([{ rule: 'confirm_without_recap', sentence: 1 }], f);
    expect(instruction).toContain('NO RECAP WAS SHOWN');
    expect(instruction).not.toContain('what create_order answered');
  });

  it('F1b T3 turn: a malformed items refused, then a request to confirm ⇒ sent back with create_order ⇒ the server recap', async () => {
    const recap = await registry().prepareOrder(F1B_T3, ctx(F1B[2]!, F1B));
    const gateway = new FakeAiGateway();
    const proper = { ...F1B_T3, items: [{ productId: SAC, variantId: MARRON, quantity: 1 }] };
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { ...F1B_T3, items: 'le sac marron' } }] }, { reply: F1B_T3_REPLY, intent: 'SALE' }, { toolCalls: [{ name: 'create_order', args: proper }] }, { reply: '', intent: 'SALE' });
    const malformed = { ok: false, error: { code: 'VALIDATION', field: 'items', malformed: true } };
    const execute = jest.fn(async (_n: string, args: Record<string, unknown>) => (typeof args.items === 'string' ? malformed : (recap as { result: unknown }).result));
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(F1B[2]!, F1B.slice(0, 2), { guard: facts(F1B[2]!) }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain('NO RECAP YET');
    expect(offered(gateway, 2)).toContain('create_order');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(r.output.reply).toContain('Voici le récapitulatif de votre commande');
    expect(r.output.reply).not.toContain('Pouvez-vous confirmer');
  });
});

// --- R11-2 -------------------------------------------------------------------------------------------------------------------------
describe('R11-2 (Major) — a product the shop does not sell is answered, never handed off', () => {
  const N7 = 'Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3';
  const N7_REPLY = "Désolé, nous n'avons pas de lunettes de soleil pour le moment. Par contre, nous avons un sac à main en cuir véritable (noir ou marron). Qu'est-ce qui vous intéresse ?";

  it('the judge: off_catalogue on « vous avez des lunettes de soleil ? » ⇒ not_sold; wholesale / custom requests still pass', () => {
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'vous avez des lunettes de soleil ?', customerText: N7, shopRules: 'x' })).toEqual({ ok: false, reason: 'off_catalogue', why: 'not_sold' });
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: '3andkom les lunettes ?', customerText: 'salam 3andkom les lunettes ?' })).toMatchObject({ ok: false, why: 'not_sold' });
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'prix de gros pour 50 sacs', customerText: 'Vous avez des prix de gros pour 50 sacs ?' })).toEqual({ ok: true, reason: 'off_catalogue' });
    expect(judgeHandoff({ reason: 'off_catalogue', evidence: 'une robe sur mesure', customerText: 'Je voudrais une robe sur mesure pour un mariage' })).toEqual({ ok: true, reason: 'off_catalogue' });
    expect(productAsk('lunettes de soleil', 'Do you sell sunglasses?')).toBe(true);
    expect(productAsk('partenariat', 'Vous avez un programme de partenariat ?')).toBe(false);
  });

  it('the reasons this message can carry: none on N7 (order details + a product question); a real request keeps its reason', () => {
    const phone = (t: string) => /0[5-7]\d{8}/.test(t.replace(/\s/g, ''));
    const all = allowedHandoffReasons(J03_AGENT, 0, N7);
    expect(all).toEqual(expect.arrayContaining(['customer_request', 'off_catalogue', 'complaint', 'other']));
    expect(messageHandoffReasons(all, N7, phone)).toEqual([]);
    expect(messageHandoffReasons(all, 'Je veux parler à un conseiller', phone)).toContain('customer_request');
    expect(messageHandoffReasons(all, 'Remboursez-moi, le sac est arrivé cassé', phone)).toEqual(expect.arrayContaining(['refund', 'complaint']));
    expect(messageHandoffReasons(all, 'Sétif, El Eulma', phone)).not.toContain('customer_request');
  });

  it('N7 T1 turn: handoff_to_human is not offered; a stray call is not run; status=HANDOFF off_catalogue is refused and answered', async () => {
    const gateway = new FakeAiGateway();
    gateway.script(
      'reply',
      { toolCalls: [{ name: 'search_products', args: { query: 'lunettes de soleil', limit: 5 } }, { name: 'handoff_to_human', args: { reason: 'off_catalogue', evidence: 'vous avez des lunettes de soleil ?' } }] },
      { reply: N7_REPLY, status: 'HANDOFF', statusDetail: 'off_catalogue', evidence: 'vous avez des lunettes de soleil ?', intent: 'INFO' },
      { reply: N7_REPLY, intent: 'INFO' },
    );
    const execute = jest.fn(async () => ({ products: [{ id: 'sac', name: 'Sac à main cuir', price: 6900, variants: [] }] }));
    const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.handoff_to_human, TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(N7, [], { guard: facts(N7) }));
    if (!r.ok) throw new Error('turn failed');
    expect(offered(gateway)).not.toContain('handoff_to_human');
    expect(execute.mock.calls.map((c) => (c as unknown as unknown[])[0])).toEqual(['search_products']);
    expect(r.handoffRefused).toBe('not_sold');
    expect(r.output.status).toBe('OK');
    expect(r.forcedHandoff).toBeNull();
    expect(r.output.reply).toBe(N7_REPLY);
  });
});

// --- R11-3 -------------------------------------------------------------------------------------------------------------------------
describe('R11-3 (Minor) — no handoff / lookup probe on field messages, no search for a product the catalogue lists', () => {
  it('field messages: an 8-digit phone, a bare name (Arabic / Latin), a place once a phone was given', () => {
    expect(fieldOnlyMessage('05559876', false)).toBe(true);
    expect(fieldOnlyMessage('نادية قاسي', false)).toBe(true);
    expect(fieldOnlyMessage('Nadia Kaci', false)).toBe(true);
    expect(nameOnlyMessage('وقتاش توصل')).toBe(false);
    expect(nameOnlyMessage('Merci Beaucoup')).toBe(false);
    expect(nameOnlyMessage('نحب حجاب حرير')).toBe(false);
    expect(fieldOnlyMessage('je veux annuler', true)).toBe(false);
    expect(placeCandidate('Sétif, El Eulma')).toBe(true);
    expect(placeCandidate('البليدة، بوفاريك')).toBe(true);
    expect(placeCandidate('je veux la djellaba')).toBe(false);
  });

  it('F1b T2 « Sétif, El Eulma » after a phone (no product in the cart): no handoff_to_human, the field note', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'On livre à El Eulma : 650 DA à domicile ou 350 DA en stop-desk. Domicile ou stop-desk ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.handoff_to_human, TOOL_DEFS.lookup_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Sétif, El Eulma', ['Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233']));
    expect(offered(gateway)).toEqual(['quote_delivery']);
    expect(gateway.calls[0]!.system).toContain(FIELD_ONLY_NOTE);
  });

  it('a place-only message with no phone yet is a field too (the wilaya / commune lists)', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Merci ! Quel est votre nom ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Sétif, El Eulma', ['Je voudrais le sac à main cuir marron']));
    expect(offered(gateway)).toEqual(['quote_delivery']);
  });

  it('F8 T3 « 05559876 » and N21 T2 « نادية قاسي »: no handoff_to_human', async () => {
    for (const [text, history] of [['05559876', ['Bonjour, je veux la djellaba. Yacine Mansouri']], ['نادية قاسي', ['سلام، نحب حجاب حرير']]] as const) {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Merci.', intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, [...history]));
      expect([text, offered(gateway)]).toEqual([text, ['search_products']]);
    }
  });

  it('N3 T1 « Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567 »: no lookup_order; « où est ma commande ? » keeps it', async () => {
    const run = async (text: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Merci Samira. Dans quelle wilaya ?', intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.lookup_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, []));
      return offered(gateway);
    };
    expect(await run('Bonjour, je voudrais 2 tapis de prière. Samira Benali, 0661234567')).toEqual(['search_products']);
    expect(await run('Bonjour, où est ma commande ? 0661234567')).toEqual(['search_products', 'lookup_order']);
  });

  it('N21 T3 « 0661234568 »: the search for « Hijab soie » (listed in the CATALOGUE) is not run on a field message', async () => {
    const hijab = { id: 'hijab', sku: 'PRD-HIJAB', name: 'Hijab soie', price: 1500, oldPrice: 2000, hasVariants: false, variants: [], also: [], stock: 5, sellOutOfStock: false, imageUrl: null };
    const guard = facts('0661234568', { lang: 'ar', products: [hijab] as never });
    expect(catalogueAnswered('Hijab soie', guard.catalogueNames)).toMatchObject({ inCatalogue: true });
    expect(catalogueAnswered('Djellaba homme', guard.catalogueNames)).toBeNull();
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Hijab soie', limit: 1 } }] }, { reply: 'صحيت، واش من ولاية ؟', intent: 'SALE' });
    const execute = jest.fn();
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('0661234568', ['سلام، نحب حجاب حرير', 'نادية قاسي'], { guard }));
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(gateway.calls[1]!.messages)).toContain('is listed in the CATALOGUE above');
  });
});

// --- R11-4 -------------------------------------------------------------------------------------------------------------------------
describe('R11-4 (Cosmetic) — the recap and the stored address read « street, commune, wilaya »', () => {
  const N21 = ['سلام، نحب حجاب حرير', 'نادية قاسي', '0661234568', 'البليدة، بوفاريك، حي الورود رقم 12'];
  const args = { clientName: 'نادية قاسي', clientPhone: '0661234568', wilayaId: 9, communeName: 'بوفاريك', address: 'البليدة، بوفاريك، حي الورود رقم 12', items: [{ productId: 'hijab', quantity: 1 }], customerConfirmed: true };
  const registry = () => {
    const catalogue = { byIds: async () => [{ id: 'hijab', name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false }] };
    const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: () => Promise<Record<string, unknown>> };
    jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
    jest.spyOn(r, 'quote').mockResolvedValue({ ok: true, wilayaId: 9, wilayaName: 'Blida', fee: 450, free: false });
    return reg;
  };
  const ctx = (customerText: string, history: string[], orderHistory: OrderCallHistory): Omit<ToolRunContext, 'callId'> & { callId: string } => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText, customerHistory: history.join('\n'), orderHistory, ordering: true });

  it('withoutPlaceSegments: leading and trailing commune / wilaya segments go; a name inside a segment and the last segment stay', () => {
    expect(withoutPlaceSegments('البليدة، بوفاريك، حي الورود رقم 12', ['بوفاريك', 'Boufarik', 'البليدة', 'Blida'])).toBe('حي الورود رقم 12');
    expect(withoutPlaceSegments('Blida, Boufarik, cité 20 août villa 3', ['Boufarik', 'Blida'])).toBe('cité 20 août villa 3');
    expect(withoutPlaceSegments('Cité 20 août, villa 3, Blida', ['Boufarik', 'Blida'])).toBe('Cité 20 août, villa 3');
    expect(withoutPlaceSegments('Rue de Boufarik', ['Boufarik', 'Blida'])).toBe('Rue de Boufarik');
    expect(withoutPlaceSegments('Boufarik, Blida', ['Boufarik', 'Blida'])).toBe('Boufarik');
  });

  it('N21 T4: the recap reads « حي الورود رقم 12، بوفاريك، البليدة » and the draft stores the street; T5 « 👍 » places it', async () => {
    const first = await registry().prepareOrder(args, ctx(N21[3]!, N21, []));
    const result = (first as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { address: 'حي الورود رقم 12' }, draftOrder: { address: 'حي الورود رقم 12' } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'ar')).toContain('العنوان: حي الورود رقم 12، بوفاريك، البليدة');
    const shown = { name: 'create_order', result, at: new Date(Date.now() - 30_000) };
    const placed = await registry().prepareOrder({ ...args, address: 'حي الورود رقم 12' }, ctx('👍', [...N21, '👍'], [shown]));
    expect(placed.ok).toBe(true);
    expect((placed as { request: { address: string; total: number } }).request).toMatchObject({ address: 'حي الورود رقم 12', total: 1950 });
  });

  it('a recap stored wilaya first (before this fix) is shown « street, commune, wilaya » too', () => {
    const recap = { items: [{ name: 'Hijab soie', quantity: 1, unitPrice: 1500 }], deliveryFee: 450, total: 1950, clientName: 'نادية قاسي', clientPhone: '0661234568', secondPhone: null, wilaya: 'Blida', wilayaAr: 'البليدة', communeName: 'بوفاريك', communeAr: 'بوفاريك', address: 'البليدة، بوفاريك، حي الورود رقم 12', isStopdesk: false, replaces: null, beyondStock: false };
    expect(orderRecapText(recap, 'ar')).toContain('العنوان: حي الورود رقم 12، بوفاريك، البليدة');
  });
});

// --- R11-5 -------------------------------------------------------------------------------------------------------------------------
describe('R11-5 (Minor) — a reply failing the schema twice gets one plain-text step before the turn fails', () => {
  it('F8 T1: two unreadable answers ⇒ the plain-text step ⇒ its message is sent (no tool offered), not a 503', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { text: '{"note": "client wants djellaba"}' }, { text: '{"status": "OK"}' }, { text: 'Parfait Yacine ! La djellaba homme est disponible. Quel est votre numéro de téléphone ?' });
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Bonjour, je veux la djellaba. Yacine Mansouri', [], { guard: facts('Bonjour, je veux la djellaba. Yacine Mansouri') }));
    if (!r.ok) throw new Error(`turn failed: ${r.error}`);
    expect(r.output.reply).toBe('Parfait Yacine ! La djellaba homme est disponible. Quel est votre numéro de téléphone ?');
    expect(r.output.status).toBe('OK');
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain(PLAIN_TEXT_REMINDER.slice(0, 40));
    expect(gateway.calls[2]!.tools).toBeUndefined();
  });
  it('still nothing after the plain-text step ⇒ the format error, as before', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { text: '{"note": "x"}' }, { text: '{"status": "OK"}' }, { text: '{"status": "OK"}' });
    const tools = { defsFor: async () => [], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('Bonjour', []));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('malformed_output:schema:reply');
    expect(gateway.calls).toHaveLength(3);
  });
  it('the parser reads a reply under another key or after another object', () => {
    const valid = { status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 0.9 };
    expect(parseReplyOutput(JSON.stringify({ ...valid, message: 'Bonjour !' }))).toMatchObject({ ok: true, value: { reply: 'Bonjour !' } });
    expect(parseReplyOutput(`{"tool":"x"} ${JSON.stringify({ ...valid, reply: 'Bonjour !' })}`)).toMatchObject({ ok: true, value: { reply: 'Bonjour !' } });
  });
});

// --- R11-6 -------------------------------------------------------------------------------------------------------------------------
describe('R11-6 (Cosmetic) — narrow wording fixes', () => {
  it('N11 T3: one « درك » in the reply, « عند الشركة » for an order not sent becomes « عندنا »', () => {
    const n11 = 'طلبيتك رقم TEST-4074 درك عند الشركة وما خرجتش للتوصيل بعد، راهي تتجهز. ما عندهاش رقم تتبع درك، وكي تخرج نقدر نعطيك رقم التتبع.';
    const lookup = [{ orders: [{ number: 'TEST-4074', status: 'new', deliveryStatus: 'not_sent', trackingNumber: null }] }];
    expect(withOneNowWord(withOrderStatusWording(n11, lookup))).toBe('طلبيتك رقم TEST-4074 درك عندنا وما خرجتش للتوصيل بعد، راهي تتجهز. ما عندهاش رقم تتبع، وكي تخرج نقدر نعطيك رقم التتبع.');
    expect(withOneNowWord('ما عندناش درك.')).toBe('ما عندناش درك.');
  });
  it('N9 T1: French words in an arabizi reply', () => {
    expect(withArabiziWords('Robe kabyle brodée, brodée b la main w b tissu léger, zina l les fêtes.', 'arabizi')).toBe('Robe kabyle brodée, brodée b lyedd w b qmach khfif, zina l l3rass w lmounasabat.');
    expect(withArabiziWords('Robe brodée à la main, tissu léger.', 'fr')).toBe('Robe brodée à la main, tissu léger.');
  });
});
