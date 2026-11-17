// Journey retest R12 (17/11, docs/audit/journeys-2026-11-16/journeys/R12-ai-orders.md): a wilaya in Arabic script before « ، » refused
// as « never written by the customer » when the commune came in Latin script (R12-1); a request to confirm without « ? » and an
// order claim (« سجلتلك الطلب ») with no recap (R12-2); `lookup_order` after the order, two searches for one product (R12-3);
// wording (R12-4). Transcripts: .local/qa/journeys/R12/out/transcripts/ (N21, N18, F6, F3, N4, F9, N18, N9, N3).
import { prisma } from '@djaber/db';
import { AiRunService, CONFIRM_WITHOUT_RECAP_NOTE, searchAnswered, YES_WITHOUT_ORDER_NOTE, type TurnRequest } from './ai-run.service';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { withArabicCurrency, withArabiziWords } from './reply-fixes';
import { buildGuardFacts, checkReply, enforceReply, guardInstruction, splitSentences } from './reply-guard';
import type { RoutedModel } from './routing.service';
import type { OrderCallHistory } from './tools/order-confirmation';
import { confirmRequest, orderClaim, orderRecapText, pendingRecap, withoutPlaceSegments } from './tools/order-confirmation-text';
import { buildPlaceIndex, placeOnlyMessage, resetPlaceIndex, wilayaIn } from './tools/place-index';
import { matchWilaya, placeFold, placeWritten, samePlace, TOOL_DEFS, ToolRegistry, wilayaNamed, type ToolRunContext } from './tools/tool-registry';
import { articleless, fold, foldText } from './tools/wilaya-aliases';

/** The wilayas and communes of the table (official names, both scripts). */
const PLACES = [
  { id: 9, nameFr: 'Blida', nameAr: 'البليدة', communes: [{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }, { nameFr: 'Ouled Yaich', nameAr: 'أولاد يعيش' }] },
  { id: 25, nameFr: 'Constantine', nameAr: 'قسنطينة', communes: [{ nameFr: 'El Khroub', nameAr: 'الخروب' }, { nameFr: 'Ain Smara', nameAr: 'عين سمارة' }] },
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', communes: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }, { nameFr: 'El Harrach', nameAr: 'الحراش' }] },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }, { nameFr: 'Es Senia', nameAr: 'السانية' }] },
  { id: 19, nameFr: 'Sétif', nameAr: 'سطيف', communes: [{ nameFr: 'El Eulma', nameAr: 'العلمة' }, { nameFr: 'Ain Arnat', nameAr: 'عين أرنات' }] },
  { id: 15, nameFr: 'Tizi Ouzou', nameAr: 'تيزي وزو', communes: [{ nameFr: 'Azazga', nameAr: 'عزازقة' }] },
  { id: 6, nameFr: 'Béjaïa', nameAr: 'بجاية', communes: [{ nameFr: 'Akbou', nameAr: 'أقبو' }] },
  { id: 13, nameFr: 'Tlemcen', nameAr: 'تلمسان', communes: [{ nameFr: 'Maghnia', nameAr: 'مغنية' }] },
  { id: 23, nameFr: 'Annaba', nameAr: 'عنابة', communes: [{ nameFr: 'El Bouni', nameAr: 'البوني' }] },
  { id: 26, nameFr: 'Médéa', nameAr: 'المدية', communes: [{ nameFr: 'Berrouaghia', nameAr: 'البرواقية' }] },
  { id: 2, nameFr: 'Chlef', nameAr: 'الشلف', communes: [{ nameFr: 'Ténès', nameAr: 'تنس' }] },
  { id: 30, nameFr: 'Ouargla', nameAr: 'ورقلة', communes: [{ nameFr: 'Hassi Messaoud', nameAr: 'حاسي مسعود' }] },
];
const WILAYAS = PLACES.map((p) => ({ id: p.id, code: String(p.id).padStart(2, '0'), nameFr: p.nameFr, nameAr: p.nameAr }));
const COMMUNES = PLACES.flatMap((p) => p.communes.map((c) => ({ wilayaId: p.id, ...c })));
/** Every separator a customer puts between the wilaya, the commune and the street (any script). */
const MARKS = ['،', '؛', ',', ';', '‚', '，', ' -', ' /', '.', ' ', '،،'];

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
const AGENT = { humanHandoffRules: '', handoffKeywords: [], orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never;
const turnReq = (customerText: string, history: string[], o: Partial<TurnRequest> & { orderHistory?: OrderCallHistory } = {}): TurnRequest => {
  const { orderHistory, ...rest } = o;
  return {
    runId: 'r',
    prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] },
    toolCtx: { workspaceId: 'w', agent: AGENT, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: [...history, customerText].join('\n'), ...(orderHistory ? { orderHistory } : {}) },
    temperature: 0.5,
    maxTokens: 500,
    deadline: Date.now() + 30_000,
    persist: false,
    ...rest,
  };
};
const facts = (customerText: string, o: Partial<Parameters<typeof buildGuardFacts>[0]> = {}) =>
  buildGuardFacts({ lang: 'ar', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: true, freshStart: false, ...o });
const offered = (gateway: FakeAiGateway, step = 0) => (gateway.calls[step]!.tools ?? []).map((t) => t.name);

// --- R12-1 -------------------------------------------------------------------------------------------------------------------------
describe('R12-1 (Major) — a place the customer wrote is never « never written by the customer », whatever the script or the punctuation', () => {
  it('the folds drop the punctuation of every script, the tatweel, the full-width forms; Arabic-Indic digits become Latin', () => {
    expect(fold('البليدة، بوفاريك، حي الورود رقم 12')).toBe('بليده بوفاريك حي الورود رقم 12');
    expect(foldText('بوف\u0640اريك؛ «الخروب»؟')).toBe('بوفاريك الخروب');
    expect(foldText('Ｂｌｉｄａ， Boufarik‚ cité')).toBe('blida boufarik cite');
    expect(foldText('حي ١٠٠٠ مسكن ۵')).toBe('حي 1000 مسكن 5');
    expect(placeFold('Samir Benali 0661234567، قسنطينة، الخروب')).toBe('samir benali 0661234567 قسنطينه الخروب');
    expect(fold('«البليدة»')).toBe('بليده');
    expect(articleless(foldText('ana f el Oued, والبليدة، الخروب'))).toBe('ana f oued بليده خروب');
  });

  it('table: every wilaya in either script, followed by each mark, is found in the customer text (also mid-text, with its article)', () => {
    for (const p of PLACES)
      for (const c of p.communes)
        for (const m of MARKS) {
          for (const text of [`${p.nameAr}${m} ${c.nameAr}${m} حي الورود رقم 12`, `Samir Benali 0661234567${m} ${p.nameAr}${m} ${c.nameAr}${m} حي 1000 مسكن عمارة 5`, `${c.nameFr}${m} ${p.nameFr}${m} cité 20 août villa 3`, `ana f ${c.nameFr}${m} wilaya ${p.nameFr}`])
            expect([text, matchWilaya(WILAYAS, text)?.id]).toEqual([text, p.id]);
        }
  });

  it('table: the call’s commune in the other script than the customer’s (« Boufarik » for « بوفاريك », « الخروب » for « El Khroub ») names the wilaya', () => {
    for (const p of PLACES)
      for (const c of p.communes)
        for (const m of MARKS) {
          // the customer wrote only the commune and the street: the wilaya is named through the commune, in either script
          for (const [written, sent] of [[c.nameAr, c.nameFr], [c.nameFr, c.nameAr], [c.nameAr, c.nameAr.replace(/^ال/, '')]] as const) {
            const history = `سلام، نحب حجاب حرير\nنادية قاسي\n0661234568\n${written}${m} حي الورود رقم 12`;
            expect([history, sent, wilayaNamed(WILAYAS, p.id, history, { given: sent, ofWilaya: p.communes })]).toEqual([history, sent, true]);
          }
        }
  });

  it('…and a place the customer did not write is still refused', () => {
    const blida = PLACES[0]!;
    expect(wilayaNamed(WILAYAS, 9, 'سلام، نحب حجاب حرير\n0661234568\nقسنطينة، الخروب، حي 1000 مسكن', { given: 'Boufarik', ofWilaya: blida.communes })).toBe(false);
    expect(wilayaNamed(WILAYAS, 9, 'Je veux le hijab\n0661234568', { given: 'Boufarik', ofWilaya: blida.communes })).toBe(false);
    // a commune of another wilaya, written by the customer, does not name this one
    expect(wilayaNamed(WILAYAS, 9, '0661234568\nالخروب، حي 1000 مسكن', { given: 'El Khroub', ofWilaya: blida.communes })).toBe(false);
    expect(samePlace('El Khroub', 'Khroub')).toBe(true);
    expect(samePlace('Boufarik', 'بوفاريك')).toBe(false);
    expect(placeWritten('… ، الخروب، حي 1000', 'El Khroub')).toBe(false);
    expect(placeWritten('… ، الخروب، حي 1000', 'خروب')).toBe(true);
  });

  it('the place index reads the same texts (commune with or without article, any mark)', () => {
    const idx = buildPlaceIndex(WILAYAS, COMMUNES);
    for (const m of MARKS) {
      expect(wilayaIn(idx, `خروب${m} حي 1000 مسكن`)?.id).toBe(25);
      expect(wilayaIn(idx, `Khroub${m} cité 1000`)?.id).toBe(25);
      expect(placeOnlyMessage(idx, `البليدة${m} بوفاريك`)).toBe(true);
    }
    expect(placeOnlyMessage(idx, 'البليدة، بوفاريك، حي الورود رقم 12')).toBe(false);
  });

  it('withoutPlaceSegments: any separator of a list of places (« ؛ », a spaced dash)', () => {
    expect(withoutPlaceSegments('البليدة؛ بوفاريك؛ حي الورود رقم 12', ['Blida', 'البليدة', 'Boufarik', 'بوفاريك'])).toBe('حي الورود رقم 12');
    expect(withoutPlaceSegments('حي الورود رقم 12 - بوفاريك - البليدة', ['Blida', 'البليدة', 'Boufarik', 'بوفاريك'])).toBe('حي الورود رقم 12');
    expect(withoutPlaceSegments('Cité 1000 logements - bloc 5', ['El Khroub', 'Constantine'])).toBe('Cité 1000 logements - bloc 5');
  });

  // the transcripts: N21 T4 (J04) and N18 T2 (J03) — the calls refused with `VALIDATION wilayaId notGivenByCustomer`
  const registry = (place: (typeof PLACES)[number], product: { id: string; name: string; price: number }, fee: number) => {
    const catalogue = { byIds: async () => [{ ...product, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false }] };
    const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: place.id, code: String(place.id).padStart(2, '0'), nameFr: place.nameFr, nameAr: place.nameAr, communes: place.communes } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(reg as unknown as { quote: () => Promise<Record<string, unknown>> }, 'quote').mockResolvedValue({ ok: true, wilayaId: place.id, wilayaName: place.nameFr, fee, free: false });
    return reg;
  };
  const ctx = (history: string[]): Omit<ToolRunContext, 'callId'> & { callId: string } => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: null, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: history.at(-1)!, customerHistory: history.join('\n'), orderHistory: [], ordering: true });

  it('N21 T4 « البليدة، بوفاريك، حي الورود رقم 12 » + `communeName « Boufarik »` ⇒ the server recap (was VALIDATION wilayaId)', async () => {
    const N21 = ['سلام، نحب حجاب حرير', 'نادية قاسي', '0661234568', 'البليدة، بوفاريك، حي الورود رقم 12'];
    const args = { clientName: 'نادية قاسي', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'حي الورود رقم 12، بوفاريك، البليدة', items: [{ productId: 'hijab', quantity: 1 }], customerConfirmed: true };
    const r = await registry(PLACES[0]!, { id: 'hijab', name: 'Hijab soie', price: 1500 }, 450).prepareOrder(args, ctx(N21));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { total: 1950, address: 'حي الورود رقم 12', communeAr: 'بوفاريك' } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'ar')).toContain('العنوان: حي الورود رقم 12، بوفاريك، البليدة');
  });

  it('N18 T2 « Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5 » + `communeName « El Khroub »` ⇒ the server recap', async () => {
    const N18 = ['السلام عليكم، نحب نشري جلابة رجالي', 'Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5'];
    const args = { clientName: 'Samir Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'El Khroub', address: 'حي 1000 مسكن عمارة 5', items: [{ productId: 'djellaba', quantity: 1 }], customerConfirmed: true };
    const r = await registry(PLACES[1]!, { id: 'djellaba', name: 'Djellaba homme', price: 7500 }, 700).prepareOrder(args, ctx(N18));
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' }, recap: { total: 8200, clientName: 'Samir Benali', communeAr: 'الخروب' } });
    expect(orderRecapText(pendingRecap([{ name: 'create_order', result }])!, 'ar')).toContain('العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة');
  });

  it('a wilaya the customer never wrote is still refused (the R2-4 rule holds)', async () => {
    const history = ['سلام، نحب حجاب حرير', 'نادية قاسي', '0661234568', 'حي الورود رقم 12'];
    const args = { clientName: 'نادية قاسي', clientPhone: '0661234568', wilayaId: 9, communeName: 'Boufarik', address: 'حي الورود رقم 12', items: [{ productId: 'hijab', quantity: 1 }], customerConfirmed: true };
    const r = await registry(PLACES[0]!, { id: 'hijab', name: 'Hijab soie', price: 1500 }, 450).prepareOrder(args, ctx(history));
    expect((r as { result: Record<string, unknown> }).result).toMatchObject({ error: { code: 'VALIDATION', notGivenByCustomer: ['wilayaId'] } });
  });
});

// --- R12-2 -------------------------------------------------------------------------------------------------------------------------
describe('R12-2 (Major) — a request to confirm without « ? » and a claim that the order is registered, with no recap', () => {
  const N21_T4 = 'صحيت، تسجل. التوصيل للدار في بوفاريك، ولاية البليدة، ب\u0640 450 دج، ولا في ستوب ديسك ب\u0640 300 دج، والوصول في 2 إلى 5 أيام. عطيني من فضلك كي تحب تأكد الطلبية.';
  const N18_T2 = 'ممتاز، سجلتلك الطلب. التوصيل لقسنطينة: 700 دج للدار، أو 450 دج في ستوب ديسك، ويوصل في 2 إلى 5 أيام. واش هي الولاية تاعك؟ (مثال: قسنطينة)';

  it('confirmRequest: the family needs no question mark, in any language — and the sentences that are none', () => {
    for (const s of [
      'عطيني من فضلك كي تحب تأكد الطلبية.',
      'قولي كي تحب تأكد.',
      'أكدلي من فضلك.',
      'إذا حبيت نأكدو الطلبية، قولي.',
      'Dites-moi quand vous voulez confirmer la commande.',
      'Si vous êtes d’accord, vous pouvez confirmer.',
      'Vous pouvez confirmer la commande.',
      'Il suffit de valider la commande.',
      'Let me know when you want to confirm the order.',
      'You can confirm the order now.',
      'Goulli ki t7ebb tconfirmi la commande.',
      'Ila t7ebb, nconfirmi la commande.',
      'T2akked la commande w nab3atha.',
      'Pouvez-vous confirmer pour que je passe la commande ?',
    ])
      expect([s, confirmRequest(s)]).toEqual([s, true]);
    for (const s of [
      'Notre équipe vous appellera pour confirmer la commande.',
      'Pour confirmer la commande, j’ai besoin de votre adresse.',
      'عطيني العنوان تاعك باش نأكد الطلبية.',
      'تأكدت، المنتوج متوفر.',
      'كي تخرج الطلبية نعيطولك بالتلفون.',
      'Je vous confirme que la livraison est gratuite.',
      'Vous confirmez l’annulation de la commande TEST-3146 ?',
      'Wach men wilaya ?',
      'صحيت، تسجل.',
      'Dans quelle wilaya habitez-vous ?',
      "Désolé, je n'arrive pas à valider votre commande pour le moment.",
    ])
      expect([s, confirmRequest(s)]).toEqual([s, false]);
  });

  it('orderClaim: the « registered / placed / noted » family in fr / ar / arabizi / en — never a negation, a future, a question, a real order', () => {
    for (const s of [
      'ممتاز، سجلتلك الطلب.',
      'سجلت الطلبية تاعك.',
      'طلبيتك تسجلت.',
      'تم تسجيل طلبيتك.',
      'الطلبية تاعك راهي مسجلة.',
      'Votre commande est bien enregistrée.',
      'Commande validée ✅',
      "J'ai bien enregistré votre commande.",
      'Je valide votre commande.',
      'Commande ta3ek tsajlet ✅',
      'Sajjeltlek la commande.',
      'Your order has been placed.',
      "I've placed your order.",
    ])
      expect([s, orderClaim(s)]).toEqual([s, true]);
    for (const s of [
      "Votre commande n'est pas encore enregistrée.",
      'La commande sera enregistrée dès votre réponse.',
      'Votre commande est-elle bien enregistrée ?',
      'Commande ta3ek mazal ma tsajletch.',
      'الطلبية ما تسجلتش.',
      'باش نسجل الطلبية عطيني العنوان تاعك.',
      'Merci pour votre confiance !',
      'C’est noté !',
      'Merci Karim, c’est noté : Sétif, El Eulma.',
      'صحيت، تسجل الرقم.',
    ])
      expect([s, orderClaim(s)]).toEqual([s, false]);
    expect(orderClaim('La commande TEST-6293 est bien enregistrée.', { placed: ['TEST-6293'] })).toBe(false);
    // a bare « c'est noté » / « tsajlet » answering the customer's yes is a claim (not a field note)
    for (const s of ['C’est noté !', 'Saha, tsajlet !', 'Bien noté ✅', 'سجلتها.']) expect([s, orderClaim(s, { customerYes: true })]).toEqual([s, true]);
    expect(orderClaim('صحيت، تسجل الرقم.', { customerYes: true })).toBe(false);
    expect(orderClaim("Merci Yacine, j'ai bien noté vos coordonnées.", { customerYes: true })).toBe(false);
  });

  it('the guard on N21 T4 / N18 T2 (create_order refused): the request to confirm and the order claim are flagged, then dropped', () => {
    const n21 = { ...facts('البليدة، بوفاريك، حي الورود رقم 12'), orderRefused: true, missingField: 'wilayaId' };
    const v21 = checkReply(N21_T4, n21);
    expect(v21.filter((v) => v.rule === 'confirm_without_recap').map((v) => v.sentence)).toEqual([2]);
    expect(v21.some((v) => v.rule === 'order_claim')).toBe(false);
    const n18 = { ...facts('Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5'), orderRefused: true, missingField: 'wilayaId' };
    const v18 = checkReply(N18_T2, n18);
    expect(v18.filter((v) => v.rule === 'order_claim').map((v) => v.sentence)).toEqual([0]);
    expect(guardInstruction(v18, n18)).toContain('NO ORDER WAS CREATED');
    const out = enforceReply(N18_T2, v18, n18, { hasCards: false });
    expect(out.reply).not.toContain('سجلتلك');
    expect(out.reply).toContain('واش هي الولاية تاعك؟');
    expect(enforceReply(N21_T4, v21, n21, { hasCards: false }).reply).not.toContain('تأكد الطلبية');
  });

  it('the guard on a turn with no tool at all: « Votre commande est bien enregistrée. » is an order claim; an order of the conversation named by its number is not', () => {
    const f = facts('Cité 500 logements bloc 12', { lang: 'fr' });
    expect(checkReply('Merci Karim ! Votre commande est bien enregistrée.', f).map((v) => v.rule)).toContain('order_claim');
    const placed = { ...f, ordersPlaced: ['TEST-6293'] };
    expect(checkReply('Votre commande TEST-6293 est bien enregistrée et part demain.', placed).some((v) => v.rule === 'order_claim')).toBe(false);
    // after the order of an earlier turn (« merci ! »): it is true; a new recap waiting for its « oui »: it is not
    expect(checkReply('Merci à vous ! Votre commande est bien enregistrée.', placed).some((v) => v.rule === 'order_claim')).toBe(false);
    expect(checkReply('Merci à vous ! Votre commande est bien enregistrée.', { ...placed, recapWaiting: true }).some((v) => v.rule === 'order_claim')).toBe(true);
    expect(checkReply('Votre commande est en préparation.', { ...f, orderLookedUp: true }).some((v) => v.rule === 'order_claim')).toBe(false);
  });

  it('N18 T2 turn: a refused create_order, then « ممتاز، سجلتلك الطلب … » ⇒ corrected; the claim never reaches the customer', async () => {
    const N18 = ['السلام عليكم، نحب نشري جلابة رجالي'];
    const text = 'Samir Benali 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5';
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Samir Benali', wilayaId: 25 } }] }, { reply: N18_T2, intent: 'SALE' }, { reply: N18_T2, intent: 'SALE' });
    const refused = { ok: false, error: { code: 'VALIDATION', field: 'wilayaId', missing: true, fields: ['wilayaId'], notGivenByCustomer: ['wilayaId'] } };
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn(async () => refused) } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, N18, { guard: facts(text) }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[2]!.messages.at(-1))).toContain('NO ORDER WAS CREATED');
    expect(r.output.reply).not.toContain('سجلتلك');
    expect(r.guard?.remaining.map((v) => v.rule)).toContain('order_claim');
  });

  it('a no-recap answer claiming the order ⇒ sent back once with create_order offered ⇒ the server recap', async () => {
    const history = ['Je voudrais la djellaba. Karim Haddad 0770112233', 'Sétif, El Eulma'];
    const text = 'Cité 500 logements bloc 12';
    const recap = { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' }, recapToShow: true, recap: { items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 650, total: 8150, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Sétif', communeName: 'El Eulma', address: 'Cité 500 logements bloc 12', isStopdesk: false } };
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Merci Karim ! Votre commande est bien enregistrée.', intent: 'SALE' }, { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad' } }] }, { reply: '', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn(async () => recap) } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, history, { guard: facts(text, { lang: 'fr' }) }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[1]!.messages.at(-1))).toContain(CONFIRM_WITHOUT_RECAP_NOTE.slice(0, 60));
    expect(r.output.reply).toContain('Voici le récapitulatif de votre commande');
    expect(r.output.reply).not.toContain('enregistrée');
  });

  it('a « oui » to the recap answered « c’est noté » with no create_order ⇒ create_order is asked for ⇒ the server confirmation', async () => {
    const shown: OrderCallHistory = [{ name: 'create_order', at: new Date(Date.now() - 60_000), result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' }, recap: { clientName: 'Karim Haddad' } } }];
    const placed = { ok: true, number: 'TEST-6293', items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 650, total: 8150, simulated: true };
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'C’est noté ✅ Merci Karim !', intent: 'SALE' }, { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad', customerConfirmed: true } }] }, { reply: '', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.lookup_order], forcedHandoff: () => null, execute: jest.fn(async () => placed) } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('oui', ['Je voudrais la djellaba. Karim Haddad 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12'], { guard: facts('oui', { lang: 'fr' }), orderHistory: shown }));
    if (!r.ok) throw new Error('turn failed');
    expect(JSON.stringify(gateway.calls[1]!.messages.at(-1))).toContain(YES_WITHOUT_ORDER_NOTE.slice(0, 50));
    expect(r.output.reply).toContain('TEST-6293');
  });
});

// --- R12-3 -------------------------------------------------------------------------------------------------------------------------
describe('R12-3 (Minor) — no lookup_order on the « oui » turn, one search for one product', () => {
  const shown: OrderCallHistory = [{ name: 'create_order', at: new Date(Date.now() - 60_000), result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' }, recap: { clientName: 'Karim Haddad' } } }];
  const history = ['Je voudrais 2 tapis de prière. Karim Haddad 0770112233, Sétif, El Eulma, Cité 500 logements bloc 12'];

  it('F6 T3 « oui » to the recap: lookup_order is not offered; a question about an order keeps it', async () => {
    const run = async (text: string) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { reply: 'Merci !', intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.lookup_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq(text, history, { orderHistory: shown }));
      return offered(gateway);
    };
    expect(await run('oui')).toEqual(['create_order']);
    expect(await run('ih')).toEqual(['create_order']);
    expect(await run('oui, et elle arrive quand ?')).toEqual(['create_order', 'lookup_order']);
  });

  it('once create_order placed the order in the turn, lookup_order is withdrawn from the next steps', async () => {
    const placed = { ok: true, number: 'TEST-2340', items: [{ name: 'Tapis de prière', quantity: 3, unitPrice: 2800 }], deliveryFee: 700, total: 9100, simulated: true };
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Karim Haddad' } }] }, { reply: '', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.lookup_order], forcedHandoff: () => null, execute: jest.fn(async () => placed) } as unknown as ToolRegistry;
    const r = await new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never).turn(turnReq('oui, et elle arrive quand ?', history, { orderHistory: shown }));
    if (!r.ok) throw new Error('turn failed');
    expect(offered(gateway, 0)).toEqual(['create_order', 'lookup_order']);
    expect(offered(gateway, 1)).toEqual([]);
    expect(r.output.reply).toContain('TEST-2340');
  });

  it('N4 T1: « tapis de prière » found the product, « tapis de prière molletonné » is the same product (no second search)', () => {
    const tapis = { id: 'tapis', name: 'Tapis de prière', variants: [] };
    const first = [{ name: 'search_products', args: { query: 'tapis de prière', limit: 3 }, result: { products: [tapis, { id: 'retouche', name: 'Retouche couture', variants: [] }] } }];
    const catalogue = ['tapis de priere', 'retouche couture', 'basket runner 40 41 42 43', 'robe kabyle brodee s m l'];
    expect(searchAnswered('tapis de prière molletonné', first, catalogue)).toMatchObject({ products: [tapis], repeated: true });
    // a word that names another product of the catalogue: searched
    const robe = [{ name: 'search_products', args: { query: 'robe' }, result: { products: [{ id: 'soiree', name: 'Robe soirée', variants: [] }] } }];
    expect(searchAnswered('robe kabyle', robe, catalogue)).toBeNull();
    // without the catalogue names nothing is assumed
    expect(searchAnswered('tapis de prière molletonné', first)).toBeNull();
  });
});

// --- R12-4 -------------------------------------------------------------------------------------------------------------------------
describe('R12-4 (Cosmetic) — narrow wording fixes', () => {
  it('F9 T1, N9 T1, N3 T2: arabizi', () => {
    expect(withArabiziWords('Illizi: ma nwasslouch l Illizi f had lwaqt. T7ebb nchouf wach men produit t7ebbou ?', 'arabizi')).toBe('Illizi: ma nwasslouch l Illizi f had lwaqt. Wach men produit t7ebb ?');
    expect(withArabiziWords('Tailles disponibles: S w M (4900 DA).', 'arabizi')).toBe('Tailles li kaynin: S w M (4900 DA).');
    expect(withArabiziWords('Ih, nwasslou l Constantine. Livraison à domicile: 700 DA, wela 450 DA f stop-desk.', 'arabizi')).toBe('Ih, nwasslou l Constantine. Tawsil l dar: 700 DA, wela 450 DA f stop-desk.');
    expect(withArabiziWords('Livraison à domicile : 700 DA.', 'fr')).toBe('Livraison à domicile : 700 DA.');
  });
  it('N18 T1: « DA » in an Arabic-script sentence ⇒ « دج »; a Latin sentence keeps « DA »', () => {
    expect(withArabicCurrency('عندنا Djellaba homme بثمن 7500 DA (كانت 9000 DA)، من صوف رقيق بلون بيج. تحب نسجلولك؟')).toBe('عندنا Djellaba homme بثمن 7500 دج (كانت 9000 دج)، من صوف رقيق بلون بيج. تحب نسجلولك؟');
    expect(withArabicCurrency('La Djellaba homme est à 7500 DA. عندنا واحدة.')).toBe('La Djellaba homme est à 7500 DA. عندنا واحدة.');
    expect(splitSentences(withArabicCurrency('Hijab soie 1500 DA')).join('')).toBe('Hijab soie 1500 DA');
  });
});
