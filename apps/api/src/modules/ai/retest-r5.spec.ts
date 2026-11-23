// Journey retest R5 (17/11, docs/audit/journeys-2026-11-16/journeys/R5-ai-orders.md): an out-of-stock product offered as the
// alternative (R5-1), Tunisian « taw » / « متاعك » (R5-2), odd darija wording (R5-3), « home or stop-desk? » after a street
// address (R5-4), a delivery question answered only by the recap (R5-5), create_order probes before any phone (R5-6).
import { prisma } from '@djaber/db';
import { AiRunService, NO_PHONE_NOTE, ORDER_DETAILS_NOTE, RECAP_READY_NOTE, unavailableTool, type TurnRequest } from './ai-run.service';
import { fixMoroccan, moroccanIn, wrongDarijaIn } from './language';
import { languageSection } from './prompt/sections/contract';
import { catalogueSection } from './prompt/sections/catalogue';
import { orderRulesSection } from './prompt/sections/orders';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply, enforceReply, guardInstruction } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { asksDelivery, blockedOrderText, deliveryAnswer, orderConfirmationText, orderRecapText, pendingRecap } from './tools/order-confirmation-text';
import { TOOL_DEFS, type ToolRegistry } from './tools/tool-registry';
import { resetPlaceIndex } from './tools/place-index';

afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
const bad = (t: string) => moroccanIn(t) || wrongDarijaIn(t);

describe('R5-1 — an out-of-stock product is never offered as an alternative', () => {
  // the J03 shop « Boutique de Nassim »: Parfum Oud 50 ml at stock 0 (not sold beyond stock), the others in stock
  const product = (name: string, price: number, stock: number | null, sellOutOfStock = false) => ({ name, sku: name.slice(0, 4).toUpperCase(), price, oldPrice: null, hasVariants: false, variants: [], also: [], description: null, stock, sellOutOfStock });
  const products = [product('Sac à main cuir', 6900, 4), product('Montre connectée', 15_900, 3), product('Parfum Oud 50 ml', 8900, 0), product('Coffret cadeau Aïd', 24_990, 5), product('Retouche couture', 800, null)];
  const facts = (customerText: string, list = products) => buildGuardFacts({ lang: 'fr', products: list, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText, answeredBefore: false, freshStart: true });
  const N7_C = 'Bonjour, vous avez des lunettes de soleil ? Je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3';
  const N7_AI = "Désolé, nous n'avons pas de lunettes de soleil pour le moment. Je peux vous proposer notre sac à main en cuir (6900 DA), notre montre connectée (15900 DA) ou notre parfum Oud 50 ml, si l'un d'eux vous intéresse. Merci pour vos coordonnées, Yacine, je les ai bien notées.";

  it('N7 T1: the offer naming the Parfum Oud is flagged (one corrective turn), with the product named in the instruction', () => {
    const f = facts(N7_C);
    const v = checkReply(N7_AI, f).filter((x) => x.rule === 'unavailable_offer');
    expect(v).toEqual([{ rule: 'unavailable_offer', sentence: 1 }]);
    expect(guardInstruction(v, f)).toContain('Parfum Oud 50 ml is out of stock: never offer, suggest or list it');
  });
  it('N7: the corrective turn kept it ⇒ that sentence is dropped, the rest is sent', () => {
    const f = facts(N7_C);
    const e = enforceReply(N7_AI, checkReply(N7_AI, f), f, { hasCards: false });
    expect(e.reply).not.toMatch(/parfum/i);
    expect(e.reply).toContain('lunettes de soleil');
  });
  it('N5 / N5c T1: the out-of-stock product the customer asked about, said out of stock, then an in-stock alternative ⇒ clean', () => {
    expect(checkReply('Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment. Si vous voulez un cadeau avec du parfum, notre Coffret cadeau Aïd (parfum, chocolat et carte personnalisée) est à 24990 DA. Ça vous intéresse ?', facts("Bonjour, le parfum oud c'est combien ?")).map((x) => x.rule)).not.toContain('unavailable_offer');
    // not asked, but said out of stock (in the sentence or the one before)
    for (const r of ['Le Parfum Oud 50 ml est épuisé, mais je peux vous proposer le Coffret cadeau Aïd (24990 DA).', 'Malheureusement il est en rupture. Le parfum Oud 50 ml reviendra bientôt.', 'Parfum Oud 50 ml ماكانش درك.', 'Sorry, Parfum Oud 50 ml is out of stock.'])
      expect(checkReply(r, facts('vous avez des parfums ?')).map((x) => x.rule)).not.toContain('unavailable_offer');
  });
  it('a catalogue list naming it (« ach kayen ? ») is flagged; a list without it is clean', () => {
    expect(checkReply('3andna sac à main cuir, montre connectée, parfum Oud w coffret cadeau Aïd. Wach men wahed t7ebb tchouf ?', facts('slm, ach kayen ?')).map((x) => x.rule)).toContain('unavailable_offer');
    expect(checkReply('3andna sac à main cuir, montre connectée, coffret cadeau Aïd w retouche couture. Wach men wahed t7ebb tchouf ?', facts('slm, ach kayen ?')).map((x) => x.rule)).not.toContain('unavailable_offer');
  });
  it('a service or an in-stock name sharing a word is never flagged; a product at stock 0 sold beyond it only when the customer asked for it (R17-3)', () => {
    const list = [product('Montre', 9000, 0), product('Montre connectée', 15_900, 3), product('Tapis de prière', 2800, 0, true), product('Retouche', 800, null)];
    expect(checkReply('Je peux vous proposer notre montre connectée (15900 DA) ou une retouche (800 DA).', facts('vous avez des lunettes ?', list)).map((x) => x.rule)).not.toContain('unavailable_offer');
    // journey retest R17-3 (18/11): stock 0, sold beyond it — no alternative; asked for (now or earlier) — answered
    expect(checkReply('Je peux vous proposer notre montre connectée (15900 DA) ou le tapis de prière (2800 DA).', facts('vous avez des lunettes ?', list)).map((x) => x.rule)).toContain('unavailable_offer');
    expect(checkReply('Le tapis de prière est à 2800 DA.', facts('le tapis de prière c’est combien ?', list)).map((x) => x.rule)).not.toContain('unavailable_offer');
    expect(checkReply('Le tapis de prière est à 2800 DA.', { ...facts('Karim 0770112233', list), customerHistory: 'je veux le tapis de prière' }).map((x) => x.rule)).not.toContain('unavailable_offer');
    // no stock field at all (older callers): nothing is checked
    expect(buildGuardFacts({ lang: 'fr', products: [{ name: 'Parfum Oud 50 ml', sku: 'P', price: 1, oldPrice: null, hasVariants: false, variants: [], also: [], description: null }], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'S', customerText: 'x', answeredBefore: false, freshStart: true }).unavailable).toBeUndefined();
  });
  it('the prompt: alternatives come from in-stock products only', () => {
    const s = catalogueSection({ catalogue: { full: true, count: 0, products: [], awaitingReview: false }, workspace: { systemMessages: {} }, agent: { outOfStockBehavior: 'suggest_alternative', showMissingVariants: false }, lang: 'fr', locale: 'fr', descriptionMax: 200 } as never);
    expect(s).toContain('ALTERNATIVES_IN_STOCK: every product you offer or suggest on your own');
    expect(s).toContain('suggest an alternative from the same category that is in stock');
    expect(s).toContain('offer what is listed and in stock');
  });
});

describe('R5-2 — Tunisian forms in Arabic script and arabizi', () => {
  it('F3b T2 « taw » flagged and replaced by « dork » (word boundaries: « tawsil » stays)', () => {
    const t = 'Hak hadha tapis de prière : molletonné, 120 x 70 cm, b 2800 DA. Rah yetsawar m3a l carte taw, w ila t7ebb nekmlou l commande, goulili.';
    expect(bad(t)).toBe(true);
    const f = fixMoroccan(t);
    expect(f).toContain('m3a l carte dork');
    expect(bad(f)).toBe(false);
    expect(fixMoroccan('Tawsil l Sétif: 650 DA. Tawassoul')).toBe('Tawsil l Sétif: 650 DA. Tawassoul');
  });
  it('F2 T2 / T3 « متاعك » flagged and replaced by « تاعك »', () => {
    expect(moroccanIn('تشرفنا يا سمير 😊 تسجلت الاسم والرقم. واش الولاية متاعك باش نكملو الطلب؟')).toBe(true);
    expect(fixMoroccan('واش الولاية متاعك باش نكملو الطلب؟')).toBe('واش الولاية تاعك باش نكملو الطلب؟');
    expect(fixMoroccan('أعطيني رقم الهاتف متاعك (مثلا: 0555123456).')).toBe('أعطيني رقم الهاتف تاعك (مثلا: 0555123456).');
    expect(fixMoroccan('عطيني الشارع أو الإقامة متاعك.')).toBe('عطيني الشارع أو الإقامة تاعك.');
  });
  it.each([
    ['mta3ek', 'متاعك'], ['mta3', 'متاع'], ['mta3i', 'متاعي'], ['mta3na', 'متاعنا'], ['tawa', 'توا'], ['taw', 'تو'], ['mouch', 'موش'], ['chniya', 'شنية'],
    ['dyalna', 'ديالنا'], ['mezyan', 'مزيان'], ['ach', 'آش'], ['kanqdar', 'كنقدر'], ['tandir', 'تندير'], ['kan3ref', 'كنعرف'], ['tanchouf', 'تنشوف'], ['katbghi', 'كاتبغي'], ['3anjad', 'عنجد'], ['famma', 'فماش'],
  ])('the Latin « %s » and its Arabic-script twin « %s » are both flagged and replaced', (latin, arabic) => {
    expect(moroccanIn(`hadi ${latin} ok`)).toBe(true);
    expect(moroccanIn(`هذي ${arabic} برك`)).toBe(true);
    expect(moroccanIn(fixMoroccan(`هذي ${arabic} برك`))).toBe(false);
  });
  it.each(['واش الولاية تاعك ؟', 'رقم الهاتف نتاعك', 'التوصيل للدار', 'ستوب ديسك', 'توصيل', 'Tawsil l dar', 'numéro ta3ek', 'Saha, tsajjel.', 'dork nab3atlek'])('Algerian, not flagged: « %s »', (t) => expect(bad(t)).toBe(false));
  it('the server texts carry none of them', () => {
    const recap = pendingRecap([{ name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 700, total: 8200, clientName: 'سمير بن علي', clientPhone: '0661234567', wilaya: 'Constantine', wilayaAr: 'قسنطينة', communeName: 'الخروب', address: 'حي 1000 مسكن عمارة 5', isStopdesk: false } } }])!;
    const placed = [{ name: 'create_order', result: { ok: true, number: 'TEST-4074', items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 700, total: 8200 } }];
    for (const l of ['ar', 'arabizi']) {
      expect(bad(orderRecapText(recap, l))).toBe(false);
      expect(bad(orderConfirmationText(placed, l)!)).toBe(false);
      expect(bad(blockedOrderText([{ name: 'create_order', result: { ok: false, error: { code: 'CUSTOMER_BLOCKED' } } }], l)!)).toBe(false);
    }
  });
});

describe('R5-3 — odd darija wording replaced by the natural Algerian words', () => {
  it('F2 T3 « (نهار، حي، رقم الدار …) » ⇒ « الشارع » (and « متاعك » ⇒ « تاعك »)', () => {
    const t = 'تمام يا سمير، التوصيل لقسنطينة (الخروب) راه 700 دج لدار، ولا 450 دج في ستوب ديسك. واش هو العنوان متاعك في الخروب؟ (نهار، حي، رقم الدار ولا نقطة قريبة منك)';
    expect(bad(t)).toBe(true);
    expect(fixMoroccan(t)).toBe('تمام يا سمير، التوصيل لقسنطينة (الخروب) راه 700 دج لدار، ولا 450 دج في ستوب ديسك. واش هو العنوان تاعك في الخروب؟ (الشارع، حي، رقم الدار ولا نقطة قريبة منك)');
    expect(fixMoroccan('عطيني اسم النهار ورقم الدار')).toBe('عطيني الشارع ورقم الدار');
    expect(fixMoroccan('a3tini l\'adresse (nhar, cité, numéro ta3 dar)')).toBe('a3tini l\'adresse (rue, cité, numéro ta3 dar)');
  });
  it('F9 T1 / T2: « t7ebb nchouf ? » ⇒ « t7ebb nwarrik ? »; the meaningless wilaya question ⇒ another wilaya', () => {
    expect(wrongDarijaIn('Wach men produit t7ebb nchouf ?')).toBe(true);
    expect(fixMoroccan('Wach men produit t7ebb nchouf ?')).toBe('Wach men produit t7ebb nwarrik ?');
    const t = 'Ma nwasslouch l Illizi f had lwaqt, la livraison makach l had wilaya. Wach wahda men les wilayat li nwasslou ? Ila t7ebb, goulli dork wach men produit t7ebb nchouf.';
    expect(fixMoroccan(t)).toBe('Ma nwasslouch l Illizi f had lwaqt, la livraison makach l had wilaya. T7ebb nwasslouha l wilaya okhra ? Ila t7ebb, goulli dork wach men produit t7ebb nwarrik.');
  });
  it('F3 T1 « zouj ydjiw disponibles », F3b T2 « yetsawar », F7 T1 « حجاب سوي », R3 « لين الدار »', () => {
    expect(fixMoroccan('2800 DA l\'unité, et zouj ydjiw disponibles.')).toBe('2800 DA l\'unité, et zouj kaynin.');
    expect(fixMoroccan('Rah yetsawar m3a l carte.')).toBe('Rahom tsawer ta3ou m3a l carte.');
    expect(fixMoroccan('حجاب سوي ناعم، 180 x 70 سم')).toBe('حجاب حرير ناعم، 180 x 70 سم');
    expect(fixMoroccan('التوصيل لقسنطينة: 700 دج لين الدار')).toBe('التوصيل لقسنطينة: 700 دج للدار');
    for (const t of ['zouj ydjiw disponibles', 'yetsawar', 'حجاب سوي', 'لين الدار']) expect(wrongDarijaIn(t)).toBe(true);
  });
  it.each(['نهار الخميس', 'في نهار السبت', 'nhar el khmis', 'T7ebb nchouf lik la disponibilité ?', 'نسوي لك الطلب', 'ywasel f 2 l 5 ayam'])('kept as written: « %s »', (t) => {
    expect(wrongDarijaIn(t)).toBe(false);
    expect(fixMoroccan(t)).toBe(t);
  });
  it('the prompt gives the field questions in Arabic script too, with « تاعك » and « الشارع »', () => {
    const s = languageSection({ lang: 'ar' } as never);
    expect(s).toContain('عطيني العنوان تاعك (الشارع، الحي، رقم الدار ولا بلاصة معروفة قريبة)');
    expect(s).toContain('« تاعك » (never « متاعك »), « الشارع » (never « نهار »');
    expect(s).toContain('taw / tawa / tawwa, mta3 / mta3ek');
  });
});

describe('R5-4 — a street address means home delivery', () => {
  it('the prompt: no « home or stop-desk? » after a street address; a bare yes to it chooses neither', () => {
    const s = orderRulesSection({ agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, riskyClientBehavior: null }, catalogue: { products: [] }, chosen: null, customer: null } as never);
    expect(s).toContain('A street address the customer gave (street, cité, building, villa, bloc, landmark) means HOME delivery: never ask « home or stop-desk? » then');
    expect(s).toContain('a bare yes (« oui », « ih ») to « home or stop-desk? » chooses neither');
    expect(languageSection({ lang: 'arabizi' } as never)).toContain('« T7ebb nwasslouha l dar wela f stop-desk ? » (only when no street address was given)');
  });
});

describe('R5-5 — a delivery question is answered in words, not only through the recap', () => {
  // (journey retest R19-2: a delivery question reads the place lists for the handoff reasons — mocked, no database)
  beforeEach(() => {
    resetPlaceIndex();
    jest.spyOn(prisma.wilaya, 'findMany').mockResolvedValue([{ id: 25, code: '25', nameFr: 'Constantine', nameAr: 'قسنطينة' }] as never);
    jest.spyOn(prisma.commune, 'findMany').mockResolvedValue([{ wilayaId: 25, nameFr: 'El Khroub', nameAr: 'الخروب' }] as never);
  });
  afterEach(() => resetPlaceIndex());
  const quote = { name: 'quote_delivery', result: { ok: true, wilayaId: 25, wilayaName: 'Constantine', wilayaNameAr: 'قسنطينة', isStopdesk: false, fee: 700, stopdeskFee: 450, etaDays: '2–5' } };
  const recapCall = { name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Tapis de prière', quantity: 2, unitPrice: 2800 }], deliveryFee: 700, total: 6300, clientName: 'Samira Benali', clientPhone: '0661234567', wilaya: 'Constantine', wilayaAr: 'قسنطينة', communeName: 'El Khroub', communeAr: 'الخروب', address: 'El Khroub, cité 1000 logements bloc 5', isStopdesk: false } } };
  const N3_T3 = 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5';
  // (journey retest R20-2: and the home and stop-desk fees — of this turn's quote, else the recap's own fee)
  it('N3 T3: the answer in the turn language, with the delay of this turn’s quote', () => {
    expect(deliveryAnswer([quote, recapCall], N3_T3, 'arabizi')).toBe('Ih, nwasslou l Constantine, f 2 l 5 ayam. L dar: 700\u00a0DA, f stop-desk: 450\u00a0DA.');
    expect(deliveryAnswer([quote, recapCall], 'Vous livrez à Constantine ? Samira Benali, El Khroub, cité 1000 logements bloc 5', 'fr')).toBe('Oui, on livre à Constantine, en 2 à 5 jours. À domicile : 700\u00a0DA, en stop-desk : 450\u00a0DA.');
    expect(deliveryAnswer([quote, recapCall], 'واش توصلو لقسنطينة ؟ الخروب، حي 1000 مسكن', 'ar')).toBe('إيه، نوصلو ل\u0640قسنطينة، من 2 إلى 5 أيام. للدار: 700\u00a0دج، لنقطة الاستلام (stop-desk): 450\u00a0دج.');
    // (journey retest R19-1: the place the customer asked about — the commune here)
    expect(deliveryAnswer([recapCall], 'Do you deliver to El Khroub?', 'en')).toBe('Yes, we deliver to El Khroub. Home delivery: 700\u00a0DA.');
    expect(bad(deliveryAnswer([quote, recapCall], N3_T3, 'arabizi')!)).toBe(false);
  });
  it('no answer when the message asks nothing about delivery, or about another place, or no recap goes out', () => {
    expect(asksDelivery('Constantine, El Khroub, cité 1000 logements bloc 5')).toBe(false);
    expect(deliveryAnswer([quote, recapCall], 'Constantine, El Khroub, cité 1000 logements bloc 5', 'fr')).toBeNull();
    expect(deliveryAnswer([quote, recapCall], 'vous livrez à Oran ?', 'fr')).toBeNull();
    expect(deliveryAnswer([quote], N3_T3, 'arabizi')).toBeNull();
  });
  it('the turn: the recap with no model lead-in gets the answer in front; a model lead-in kept ⇒ nothing added', async () => {
    const run = async (reply: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'quote_delivery', args: { wilayaName: 'Constantine' } }, { name: 'create_order', args: { clientName: 'Samira Benali' } }] }, { reply, intent: 'SALE' });
      const execute = jest.fn(async (name: string) => (name === 'quote_delivery' ? quote.result : recapCall.result));
      const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.create_order], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
      const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
      const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: N3_T3 }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: N3_T3, customerHistory: `Bonjour, je voudrais 2 tapis de prière\nSamira Benali, 0661234567\n${N3_T3}` }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
      const r = await svc.turn(req);
      return r.ok ? r.output.reply : '';
    };
    const server = orderRecapText(pendingRecap([recapCall])!, 'fr');
    expect(await run('')).toBe(`Oui, on livre à Constantine, en 2 à 5 jours. À domicile : 700\u00a0DA, en stop-desk : 450\u00a0DA.\n\n${server}`);
    // journey retest R19-1 (18/11): one delivery question to the recap's place — the server's answer and the recap end the turn, no model
    // step after the recap call (its lead-in is not asked for)
    expect(await run('Oui, on livre bien à Constantine !')).toBe(`Oui, on livre à Constantine, en 2 à 5 jours. À domicile : 700\u00a0DA, en stop-desk : 450\u00a0DA.\n\n${server}`);
  });
});

describe('R5-6 — create_order is not offered before the customer gave a phone number', () => {
  const recap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 450, total: 7950, clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilaya: 'Blida', communeName: 'Boufarik', address: 'Cité 20 août villa 3', isStopdesk: false } };
  const setup = (...steps: Parameters<FakeAiGateway['script']>[1][]) => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', ...steps);
    const execute = jest.fn(async () => recap);
    const tools = { defsFor: async () => [TOOL_DEFS.quote_delivery, TOOL_DEFS.create_order, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req = (customerText: string, history: string, clientId: string | null = null): TurnRequest => ({ runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: history }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false });
    return { gateway, execute, svc, req };
  };
  it('N3 T1 / F1 T2: no phone in the conversation ⇒ no create_order offered, the note says why; a call anyway is not run', async () => {
    const { gateway, execute, svc, req } = setup({ toolCalls: [{ name: 'create_order', args: { clientName: '---', clientPhone: '0500000000', wilayaId: 1 } }] }, { reply: 'Parfait, les 2 tapis de prière sont disponibles. Quel est votre nom complet ?', intent: 'SALE' });
    const r = await svc.turn(req('Bonjour, je voudrais 2 tapis de prière', 'Bonjour, je voudrais 2 tapis de prière'));
    expect(r.ok && r.output.reply).toBe('Parfait, les 2 tapis de prière sont disponibles. Quel est votre nom complet ?');
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('create_order');
    expect(gateway.calls[0]!.system).toBe(`S\n\n${NO_PHONE_NOTE}`);
    expect(execute).not.toHaveBeenCalled();
    expect(String((gateway.calls[1]!.messages.at(-1) as { content: unknown }).content)).toContain('has not given a phone number yet');
    // an 8-digit number is no phone either (re-asked by the model, no tool)
    const again = setup({ reply: 'Le numéro semble incomplet : pouvez-vous me le redonner ?', intent: 'SALE' });
    await again.svc.turn(again.req('Yacine Mansouri 05559876', 'Bonjour, je veux 1 djellaba homme\nYacine Mansouri 05559876'));
    expect((again.gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('create_order');
  });
  it('F13 / N8: a complete order in one message ⇒ create_order offered, one call, the server recap goes out', async () => {
    const said = 'Je prends la djellaba homme, je suis Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Oui je confirme direct';
    const { gateway, execute, svc, req } = setup({ toolCalls: [{ name: 'create_order', args: { clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilayaId: 9, communeName: 'Boufarik', address: 'Cité 20 août villa 3', items: [{ productId: 'p', quantity: 1 }], customerConfirmed: true } }] }, { reply: '', intent: 'SALE' });
    const r = await svc.turn(req(said, said));
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
    // journey retest R7-4: an order message with a phone that asks nothing of the team gets no handoff tool (and says so)
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('handoff_to_human');
    // journey retest R16-3: every field is given — create_order computes the fee and the stock (no quote / check before it)
    expect(gateway.calls[0]!.system).toBe(`S\n\n${ORDER_DETAILS_NOTE}\n\n${RECAP_READY_NOTE}`);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.ok && r.output.reply).toBe(orderRecapText(pendingRecap([{ name: 'create_order', result: recap }])!, 'fr'));
  });
  it('a phone on the client record (KNOWN CUSTOMER) keeps create_order offered; a record without one does not', async () => {
    const spy = jest.spyOn(prisma.client, 'findUnique').mockResolvedValueOnce({ phone: '0555987654', phone2: null } as never);
    const a = setup({ reply: 'Quelle wilaya ?', intent: 'SALE' });
    await a.svc.turn(a.req('je veux la djellaba', 'je veux la djellaba', 'c1'));
    expect((a.gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
    spy.mockResolvedValueOnce({ phone: null, phone2: null } as never);
    const b = setup({ reply: 'Quel est votre nom ?', intent: 'SALE' });
    await b.svc.turn(b.req('je veux la djellaba', 'je veux la djellaba', 'c1'));
    expect((b.gateway.calls[0]!.tools ?? []).map((d) => d.name)).not.toContain('create_order');
  });
  it('the « not available » answer names the missing phone only when that is the reason', () => {
    expect(unavailableTool('create_order', false, true).instruction).toContain('has not given a phone number yet');
    expect(unavailableTool('create_order', false).instruction).toContain('it already answered in this turn');
  });
  it('the prompt and the handoff tool: no call to find out what is missing', () => {
    const s = orderRulesSection({ agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null, riskyClientBehavior: null }, catalogue: { products: [] }, chosen: null, customer: null } as never);
    expect(s).toContain('when a required field (the product, the name, the phone, the wilaya, the home address or the stop-desk) is not in the customer\'s messages or KNOWN CUSTOMER yet, do not call create_order');
    expect(TOOL_DEFS.handoff_to_human.description).toContain('never called without a reason and the evidence, nor to find out whether a handoff applies');
  });
});
