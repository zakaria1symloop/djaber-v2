// Journey retest R9 (17/11, docs/audit/journeys-2026-11-16/journeys/R9-ai-orders.md): a Latin name in an Arabic-script
// conversation made the server recap French (R9-1), probe calls left (R9-2), odd wording (R9-3).
// Transcripts: .local/qa/journeys/R9/out/transcripts/ (N18, N8, N16, N17, N11, N9, F3).
import { prisma } from '@djaber/db';
import { AiRunService, placeSearchResult, sameCallKey, toolCallId, type TurnRequest } from './ai-run.service';
import { CatalogueService } from './catalogue.service';
import { conversationLanguage, detectLanguage, fixMoroccan, frenchSentenceIn, latinValuesOnly, serverTextLanguage, systemLocale, turnLanguage, wrongDarijaIn } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withOneNowWord, withOrderStatusWording, withoutStrayYes } from './reply-fixes';
import { buildGuardFacts, checkReply, enforceReply, feeSentence } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { asksSomething, blockedOrderText, orderConfirmationText, orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import { resetPlaceIndex } from './tools/place-index';
import { TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const WILAYAS = [
  { id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة' },
  { id: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر' },
  { id: 25, code: '25', nameFr: 'Constantine', nameAr: 'قسنطينة' },
  { id: 33, code: '33', nameFr: 'Illizi', nameAr: 'إليزي' },
];
const COMMUNES = [
  { wilayaId: 25, nameFr: 'El Khroub', nameAr: 'الخروب' },
  { wilayaId: 9, nameFr: 'Boufarik', nameAr: 'بوفاريك' },
];
const places = () => {
  resetPlaceIndex();
  jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue(WILAYAS as never);
  jest.spyOn(prisma.commune, 'findMany').mockResolvedValue(COMMUNES as never);
};
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> = {}): TurnRequest => ({
  runId: 'r',
  prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
  toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n') },
  temperature: 0.5,
  maxTokens: 500,
  deadline: Date.now() + 30_000,
  persist: false,
  ...o,
});
const facts = (lang: Parameters<typeof buildGuardFacts>[0]['lang'], customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang, products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: true, freshStart: false, ...o });

// --- R9-1 ------------------------------------------------------------------------------------------------------------------------
describe('R9-1 (Major) — N18: a Latin name in an Arabic-script conversation keeps the Arabic recap', () => {
  const T1 = 'السلام عليكم، نحب نشري جلابة رجالي';
  const T2 = 'Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5';
  const T2_CALL = { clientName: 'Samir Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'الخروب', address: 'حي 1000 مسكن عمارة 5', isStopdesk: false, items: [{ productId: '01a1e54f-9b89-7737-8919-ce1e2299efdc', quantity: 1 }], customerConfirmed: true };
  const T2_RESULT = {
    ok: false,
    error: { code: 'CONFIRMATION_REQUIRED', draft: '125d541ac378dd792de141ed', core: '64b2049fe6ff11d1483e9107' },
    recap: { items: [{ name: 'Djellaba homme', variant: null, quantity: 1, unitPrice: 7500 }], subtotal: 7500, deliveryFee: 700, total: 8200, clientName: 'Samir Benali', clientPhone: '0661234567', wilaya: 'Constantine', communeName: 'الخروب', address: 'حي 1000 مسكن عمارة 5', isStopdesk: false, wilayaAr: 'قسنطينة', communeAr: 'الخروب' },
    recapToShow: true,
  };
  const T3_RESULT = { ok: true, orderId: null, number: 'TEST-8849', simulated: true, subtotal: 7500, deliveryFee: 700, total: 8200, items: [{ name: 'Djellaba homme', variant: null, quantity: 1, unitPrice: 7500 }], duplicateOf: null, paymentOptions: ['cod'], draft: '125d541ac378dd792de141ed', core: '64b2049fe6ff11d1483e9107', etaDays: '2–5' };
  const ARABIC_RECAP = [
    'هذا ملخص الطلبية:',
    '- 1 × Djellaba homme : 7 500 دج',
    '- التوصيل للدار (الخروب، قسنطينة): 700 دج',
    'المجموع: 8 200 دج، الدفع عند الاستلام.',
    'الاسم: Samir Benali',
    'الهاتف: 0661234567',
    'العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة',
    'جاوبني بـ « إيه » باش نأكدو الطلبية، ولا قولي واش نبدلو.',
  ].join('\n');

  it('the cause: T2 read alone is `mixed` (26 Arabic letters, 11 Latin); in the conversation it is Arabic', () => {
    expect(detectLanguage(T2)).toBe('mixed');
    const previous = conversationLanguage([T1]);
    expect(previous).toBe('ar');
    expect(latinValuesOnly(T2)).toBe(true);
    expect(detectLanguage(T2, 'ar')).toBe('ar');
    expect(turnLanguage(T2, previous)).toBe('ar');
    expect(conversationLanguage([T1, T2, 'ايه'])).toBe('ar');
  });
  it('the recap of that turn is the Arabic one, the name kept as written', () => {
    const recap = pendingRecap([{ name: 'create_order', result: T2_RESULT }])!;
    expect(orderRecapText(recap, turnLanguage(T2, 'ar'))).toBe(ARABIC_RECAP);
    // T3 « ايه »: the confirmation in the same language
    expect(orderConfirmationText([{ name: 'create_order', result: T3_RESULT }], turnLanguage('ايه', 'ar'))!.split('\n')[0]).toBe('تم تسجيل طلبيتك TEST-8849 ✅');
  });
  it('the turn — N18 T2: create_order ⇒ the server recap in Arabic, nothing French', async () => {
    places();
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: T2_CALL }] }, { reply: 'Merci Samir !', intent: 'SALE' });
    const execute = jest.fn(async () => T2_RESULT);
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const lang = turnLanguage(T2, conversationLanguage([T1]));
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(T2, [T1], { guard: facts(lang, T2, { shopLocale: 'fr' }) }));
    expect(execute).toHaveBeenCalledTimes(1);
    const reply = r.ok ? r.output.reply : '';
    expect(reply.endsWith(ARABIC_RECAP)).toBe(true);
    expect(reply).not.toMatch(/Voici|Répondez|Livraison/);
  });
  it('the guard reads the message alone as no Latin message (not `mixed`); a French reply to « نحب Djellaba homme » is a switch', () => {
    expect(facts('ar', T2).messageLang).toBeUndefined();
    const f = facts('ar', 'نحب Djellaba homme عافاك');
    expect(f.messageLang).toBe('ar');
    expect(checkReply('La Djellaba homme est disponible à 7500 DA, voulez-vous la commander ?', f).map((v) => v.rule)).toContain('language_switch');
  });
  it('a Latin value never switches the language; real words still do', () => {
    // a product name, a place, a name next to Arabic script
    expect(turnLanguage('نحب Djellaba homme', 'ar')).toBe('ar');
    expect(turnLanguage('ساكن في Bab Ezzouar، حي 5', 'ar')).toBe('ar');
    expect(turnLanguage('اسمي Karim Haddad', 'ar')).toBe('ar');
    // R4-2 / N4 / F3 unchanged: an Arabic-script value in a Latin conversation
    expect(turnLanguage('سمير بن علي', 'fr')).toBe('fr');
    expect(turnLanguage('smiti وليد بوزيد', 'arabizi')).toBe('arabizi');
    expect(turnLanguage('Samir Benali 0661234567, Constantine, El Khroub', 'fr')).toBe('fr');
    // a real switch
    expect(turnLanguage('Bonjour, je veux la robe kabyle svp', 'ar')).toBe('fr');
    expect(turnLanguage('واش عندكم روب ساتان', 'fr')).toBe('ar');
    // French words next to Arabic ones are no value: not stripped (the message stays `mixed`, then the conversation's language)
    expect(latinValuesOnly('السلام عليكم، je veux la robe kabyle brodée')).toBe(false);
  });
  it('the `mixed` band falls back to the conversation’s language, a first message to the other script’s, else stays mixed', () => {
    const both = 'السلام عليكم، نحب نشري la robe kabyle brodée';
    expect(detectLanguage(both, 'fr')).toBe('mixed');
    expect(turnLanguage(both, 'fr')).toBe('fr');
    expect(turnLanguage(both, 'ar')).toBe('ar');
    expect(turnLanguage(both, 'arabizi')).toBe('arabizi');
    expect(turnLanguage(T2, undefined)).toBe('ar');
    expect(turnLanguage('bonjour نحب نشري robe satin من فضلك', undefined)).toBe('mixed');
  });
  it('every server text uses the same decision: a `mixed` turn takes the shop’s locale, never French by default', () => {
    expect(serverTextLanguage('ar')).toBe('ar');
    expect(serverTextLanguage('arabizi', 'fr')).toBe('arabizi');
    expect(serverTextLanguage('mixed', 'ar')).toBe('ar');
    expect(serverTextLanguage('mixed', 'en')).toBe('en');
    expect(serverTextLanguage('mixed')).toBe('fr');
    expect(systemLocale('mixed', 'fr', 'darija')).toBe('ar');
    expect(systemLocale('mixed', 'ar', null)).toBe('ar');
    expect(systemLocale('mixed', 'fr', 'fr')).toBe('fr');
    const f = facts('mixed', 'x', { shopLocale: 'ar' });
    expect(feeSentence({ wilaya: 'قسنطينة', isStopdesk: false, fee: 700, free: false, stopdeskFee: 450 }, f.lang, f.shopLocale).replace(/\s/g, ' ')).toBe('التوصيل لـقسنطينة: 700 دج للدار، 450 دج في نقطة الاستلام.');
    expect(enforceReply('Problème technique.', [{ rule: 'invented_problem', sentence: 0 }], { ...f, missingField: 'communeName' }, { hasCards: false }).reply).toMatch(/[؀-ۿ]/);
    expect(blockedOrderText([{ name: 'create_order', result: { ok: false, error: { code: 'CUSTOMER_BLOCKED' } } }], serverTextLanguage('mixed', 'ar'))).toBe('ما نقدرش نأكد هذي الطلبية هنا، الفريق تاع المحل راح يتكفل بيها.');
  });
});

// --- R9-2 ------------------------------------------------------------------------------------------------------------------------
describe('R9-2 — fewer probe calls', () => {
  const COFFRET = { id: '01a1e51f-48c7-7916-8119-8895e76e3400', name: 'Coffret cadeau Aïd' };
  const SEARCH_RESULT = { products: [{ id: COFFRET.id, name: COFFRET.name, sku: 'PRD-4XEV9P5Y', price: 24_990, oldPrice: null, stock: 'in stock', hasVariants: false, variants: [], imageUrl: null, category: 'Mode J04' }] };
  it('two searches for the same query (limit, case, accents aside) are one call', () => {
    expect(sameCallKey('search_products', { query: 'Coffret cadeau Aïd', limit: 1 })).toBe(sameCallKey('search_products', { query: 'coffret  cadeau aid' }));
    expect(sameCallKey('search_products', { query: 'Coffret cadeau Aïd' })).not.toBe(sameCallKey('search_products', { query: 'Hijab soie' }));
    expect(sameCallKey('quote_delivery', { wilayaId: 31 })).toBe(toolCallId('quote_delivery', { wilayaId: 31 }, 0));
  });
  it('the turn — N8 T1: « Coffret cadeau Aïd » with `limit 1`, then without ⇒ searched once, the second gets the first answer', async () => {
    places();
    const gateway = new FakeAiGateway();
    const text = 'Bonjour, le coffret cadeau Aïd est disponible ? Je suis Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4';
    gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query: 'Coffret cadeau Aïd', limit: 1 } }, { name: 'search_products', args: { query: 'Coffret cadeau Aïd' } }] }, { reply: 'Oui, il est disponible.', intent: 'INFO' });
    const execute = jest.fn(async () => SEARCH_RESULT);
    const tools = { defsFor: async () => [TOOL_DEFS.search_products], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, []));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.tools.map((t) => t.name)).toEqual(['search_products']);
    const second = gateway.calls[1]!.messages.filter((m) => m.role === 'tool').at(-1) as { result: { repeated?: boolean } };
    expect(second.result.repeated).toBe(true);
  });
  it('the turn — N16 T1: a search for a wilaya name (« Illizi ») is not run; a catalogue word or a product query still is', async () => {
    const go = async (query: string, tokens: string[] = []) => {
      places();
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'search_products', args: { query } }] }, { reply: 'Smahli, ma nwasslouch l Illizi f had lwaqt.', intent: 'INFO' });
      const execute = jest.fn(async (name: string) => (name === 'quote_delivery' ? { ok: false, error: { code: 'WILAYA_NOT_SERVED' } } : { products: [] }));
      const tools = { defsFor: async () => [TOOL_DEFS.search_products, TOOL_DEFS.quote_delivery], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
      const guard = { ...facts('arabizi', 'slm, tawsil l Illizi ?'), tokens };
      const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('slm, tawsil l Illizi ?', [], { guard }));
      // (the server's own quote_delivery of a delivery question runs too, R7-5)
      return { runs: execute.mock.calls.filter((c) => c[0] === 'search_products').length, tools: r.tools.filter((t) => t.name === 'search_products').length, answer: (gateway.calls[1]!.messages.filter((m) => m.role === 'tool').at(-1) as { result: unknown }).result };
    };
    const illizi = await go('Illizi');
    expect(illizi).toMatchObject({ runs: 0, tools: 0, answer: placeSearchResult('Illizi') });
    expect((await go('El Khroub')).runs).toBe(0);
    expect((await go('robe kabyle')).runs).toBe(1);
    // a product of the shop named like a place is searched
    expect((await go('Illizi', ['parfum illizi'])).runs).toBe(1);
  });
  describe('N17 T1 — an invented product id stands for the one product the customer named', () => {
    const HIJAB = { id: '01a1e51f-4737-7bdb-8104-25ba3e09450a', name: 'Hijab soie', description: null, price: 1500, moderationStatus: 'approved', approvedSnapshot: null };
    const MONTRE = { id: '01a1e51f-0000-7000-8000-00000000a001', name: 'Montre', description: null, price: 9000, moderationStatus: 'approved', approvedSnapshot: null };
    const CONNECTEE = { id: '01a1e51f-0000-7000-8000-00000000a002', name: 'Montre connectée', description: null, price: 15_900, moderationStatus: 'approved', approvedSnapshot: null };
    const ROBE = { id: '01a1e51f-0000-7000-8000-00000000a003', name: 'Robe kabyle brodée', description: null, price: 4900, moderationStatus: 'approved', approvedSnapshot: null };
    const INVENTED = '01a1e51f-450e-7c2d-8103-6bb5b0d8f0f2';
    const agent = { id: 'a', sellAllProducts: true, catalogScope: 'all', scopeCategoryIds: [] } as never;
    const named = async (text: string, rows: unknown[], o: { exists?: boolean; exclude?: string[] } = {}) => {
      jest.spyOn(prisma.product, 'findFirst').mockResolvedValue((o.exists ? { id: INVENTED } : null) as never);
      jest.spyOn(prisma.product, 'findMany').mockResolvedValue(rows as never);
      return new CatalogueService().namedInScope(agent, INVENTED, text, o.exclude);
    };
    it('the name as whole words in the customer’s messages, exactly one product', async () => {
      expect(await named('Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3', [HIJAB, ROBE])).toBe(HIJAB.id);
      // « la montre connectée » names the longer product only
      expect(await named('je veux la montre connectée', [MONTRE, CONNECTEE])).toBe(CONNECTEE.id);
      // two products named, none named, the id is a real product of the shop, the product is already in the order
      expect(await named('je veux le hijab soie et la robe kabyle brodée', [HIJAB, ROBE])).toBeNull();
      expect(await named('je veux un foulard', [HIJAB, ROBE])).toBeNull();
      expect(await named('je veux 1 hijab soie', [HIJAB], { exists: true })).toBeNull();
      expect(await named('je veux 1 hijab soie', [HIJAB], { exclude: [HIJAB.id] })).toBeNull();
    });
    it('create_order with that id ⇒ the recap of the named product, no PRODUCT_NOT_AVAILABLE', async () => {
      const product = { id: HIJAB.id, name: 'Hijab soie', price: 1500, hasVariants: false, variants: [], stock: 10, sellOutOfStock: false };
      const catalogue = { byIds: async (_a: unknown, ids: string[]) => [product].filter((p) => ids.includes(p.id)), namedInScope: jest.fn(async () => HIJAB.id) };
      const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
      jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }] } as never);
      jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
      const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: () => Promise<Record<string, unknown>> };
      jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
      jest.spyOn(r, 'quote').mockResolvedValue({ ok: true, wilayaId: 9, wilayaName: 'Blida', fee: 450, free: false });
      const text = 'Bonjour, je veux 1 hijab soie. Nadia Kaci 0661234568, Blida, Boufarik, cité 20 août villa 3';
      const ctx: ToolRunContext = { workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: text, customerHistory: text, orderHistory: [], ordering: true };
      const call = { clientName: 'Nadia Kaci', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'Cité 20 août, villa 3', items: [{ productId: INVENTED, quantity: 1 }], customerConfirmed: true };
      const out = (await reg.prepareOrder(call, ctx)) as { result?: Record<string, unknown> };
      expect(out.result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { items: [{ name: 'Hijab soie', quantity: 1 }], total: 1950 } });
      expect(catalogue.namedInScope).toHaveBeenCalledWith(expect.anything(), INVENTED, text, []);
    });
  });
});

// --- R9-3 ------------------------------------------------------------------------------------------------------------------------
describe('R9-3 — odd wording', () => {
  it('N16 T1 « Lmoute, … t7ebb tswayyab fiha? » ⇒ « Smahli, … t7ebb nwasslou liha? » (flagged like the other wrong words)', () => {
    const n16 = 'Lmoute, ma nwasslouch l Illizi f had lwaqt, ma 3andnach livraison l hadi wilaya. Wach wilaya okhra t7ebb tswayyab fiha?';
    expect(wrongDarijaIn(n16)).toBe(true);
    expect(fixMoroccan(n16)).toBe('Smahli, ma nwasslouch l Illizi f had lwaqt, ma 3andnach livraison l hadi wilaya. Wach wilaya okhra t7ebb nwasslou liha?');
    expect(fixMoroccan('Lmoute ta3na fiha GPS.')).toBe('La montre ta3na fiha GPS.');
    expect(wrongDarijaIn('Ma nwasslouch l Illizi, smahli.')).toBe(false);
  });
  describe('N11 T3 — the order wording follows lookup_order’s status', () => {
    const N11 = 'طلبيتك رقم TEST-4074 مازالت في الدرب، درك راهي تتحضر ومازالت ما خرجتش. ما عندناش رقم تتبع دروك، وكي تخرج الطلبية نعطيوك المعلومات. التوصيل يكون من 2 إلى 5 أيام.';
    const lookup = (deliveryStatus: string) => [{ orders: [{ number: 'TEST-4074', status: 'new', deliveryStatus, courier: null, trackingNumber: null }] }];
    it('not sent + « ما خرجتش » already said ⇒ « في الدرب » dropped; one « درك »', () => {
      expect(withOneNowWord(withOrderStatusWording(N11, lookup('not_sent')))).toBe('طلبيتك رقم TEST-4074 درك راهي تتحضر ومازالت ما خرجتش. ما عندناش رقم تتبع درك، وكي تخرج الطلبية نعطيوك المعلومات. التوصيل يكون من 2 إلى 5 أيام.');
    });
    it('not sent and nothing else said ⇒ the not-sent wording; a shipped order or no lookup ⇒ unchanged', () => {
      expect(withOrderStatusWording('طلبيتك TEST-4074 مازالت في الدرب، التوصيل من 2 إلى 5 أيام.', lookup('not_sent'))).toBe('طلبيتك TEST-4074 مازالت ما خرجتش، التوصيل من 2 إلى 5 أيام.');
      expect(withOrderStatusWording('Votre commande TEST-4074 est en route.', lookup('not_sent'))).toBe('Votre commande TEST-4074 est en préparation.');
      expect(withOrderStatusWording('Commande ta3ek TEST-4074 rahi f trig.', lookup('not_sent'))).toBe('Commande ta3ek TEST-4074 mazal ma khrjetch.');
      expect(withOrderStatusWording('Your order TEST-4074 is on its way.', lookup('not_sent'))).toBe('Your order TEST-4074 is being prepared.');
      expect(withOrderStatusWording(N11, lookup('in_transit'))).toBe(N11);
      expect(withOrderStatusWording(N11, [])).toBe(N11);
      expect(withOneNowWord('ما عندناش رقم تتبع دروك.')).toBe('ما عندناش رقم تتبع دروك.');
    });
  });
  describe('N9 T1 — a French sentence inside an arabizi reply', () => {
    const N9_C = 'Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ?';
    const N9 = 'Salam ! Ma 3andnach tsawer ta3 had robe f had lwaqt, bessah hia Robe kabyle brodée à la main, b tissu léger, zina bezzaf l les fêtes. Les tailles disponibles : S et M à 4900 DA, et XL à 5200 DA. Taille L ma 3andnach f had lwaqt. Wach men taille t7ebb ?';
    const robe = { id: 'robe', name: 'Robe kabyle brodée', sku: 'PRD-ROBE', price: 4900, oldPrice: null, hasVariants: true, variants: ['S', 'M', 'L', 'XL'].map((v) => ({ id: v, name: v, price: v === 'XL' ? 5200 : 4900, stock: v === 'L' ? 0 : 3 })), also: [], description: null, stock: 9, sellOutOfStock: false, imageUrl: null };
    const f = buildGuardFacts({ lang: 'arabizi', products: [robe], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText: N9_C, answeredBefore: false, freshStart: true });
    it('is flagged `language_switch` (one corrective turn told to write every sentence in arabizi)', () => {
      expect(frenchSentenceIn(N9, f.tokens)).toBe(true);
      expect(checkReply(N9, f).map((v) => v.rule)).toContain('language_switch');
    });
    it('a product name with French words, a short French noun phrase, a French customer message: not flagged', () => {
      expect(frenchSentenceIn('Robe kabyle brodée à la main, b tissu léger, kayna f S w M b 4900 DA. Wach men taille t7ebb ?', f.tokens)).toBe(false);
      expect(frenchSentenceIn('Livraison à domicile : 400 DA.', f.tokens)).toBe(false);
      expect(checkReply(N9, { ...f, messageLang: 'fr' }).map((v) => v.rule)).not.toContain('language_switch');
    });
  });
  describe('F3 T1 — an opening « Ih » that answers no question', () => {
    const F3_C = 'nheb nechri zoudj tapis de prière';
    const F3 = 'Ih, tapis de prière disponible, zoudj b 2800 DA l wa7ed (molletonné, 120 x 70 cm). Wach smitek ?';
    it('is dropped when the customer asked nothing and said no yes / no', () => {
      expect(withoutStrayYes(F3, F3_C, asksSomething)).toBe('Tapis de prière disponible, zoudj b 2800 DA l wa7ed (molletonné, 120 x 70 cm). Wach smitek ?');
      expect(withoutStrayYes('Oui, le sac est disponible à 6900 DA.', 'Je voudrais le sac à main cuir marron', asksSomething)).toBe('Le sac est disponible à 6900 DA.');
    });
    it('kept for a question, a « kayen / disponible » question, a yes / no of the customer', () => {
      expect(withoutStrayYes('Ih, nwasslou l Constantine.', 'khouya twasslou l Constantine ?', asksSomething)).toBe('Ih, nwasslou l Constantine.');
      expect(withoutStrayYes('Ih, kayen.', 'kayen tapis de prière', asksSomething)).toBe('Ih, kayen.');
      expect(withoutStrayYes('Oui, il est disponible.', 'le coffret est disponible', asksSomething)).toBe('Oui, il est disponible.');
      expect(withoutStrayYes('Ih, mlih.', 'ih', asksSomething)).toBe('Ih, mlih.');
      expect(withoutStrayYes('Ih', F3_C, asksSomething)).toBe('Ih');
    });
    it('the turn: the reply goes out without it', async () => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: F3, intent: 'SALE' });
      const tools = { defsFor: async () => [], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(F3_C, []));
      expect(r.ok && r.output.reply).toBe('Tapis de prière disponible, zoudj b 2800 DA l wa7ed (molletonné, 120 x 70 cm). Wach smitek ?');
    });
  });
});
