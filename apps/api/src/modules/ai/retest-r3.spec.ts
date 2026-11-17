// Journey retest R3 (17/11, docs/audit/journeys-2026-11-16/journeys/R3-ai-orders.md): the switch from French to darija mid-order
// (R3-1), Tunisian / Middle-Eastern forms and « ch7al men wilaya » (R3-2), an invented name and the handoff reasons offered
// (R3-3), the model's sentence kept before the server recap (R3-4), made-up arabizi for the address question (R3-5).
import { AiRunService, handoffDefWith, type TurnRequest } from './ai-run.service';
import { allowedHandoffReasons } from './handoff-judge';
import { conversationLanguage, fixMoroccan, moroccanIn, turnLanguage, wrongDarijaIn } from './language';
import { languageSection } from './prompt/sections/contract';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply, enforceReply } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { isPlaceholderName } from './tools/order-confirmation';
import { orderConfirmationText, orderRecapText, pendingRecap, recapReply } from './tools/order-confirmation-text';
import { nameGiven, TOOL_DEFS, ToolRegistry } from './tools/tool-registry';

const recapResult = (over: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' },
  recapToShow: true,
  recap: { items: [{ name: 'Tapis de prière', variant: null, quantity: 2, unitPrice: 2800 }], subtotal: 5600, deliveryFee: 700, total: 6300, clientName: 'Samira Benali', clientPhone: '0661234567', wilaya: 'Constantine', communeName: 'El Khroub', address: 'Cité 1000 logements bloc 5', isStopdesk: false, ...over },
});
const recapOf = (over: Record<string, unknown> = {}) => pendingRecap([{ name: 'create_order', result: recapResult(over) }])!;

describe('R3-1 — the customer switches from French to darija mid-order', () => {
  const N3 = ['Bonjour, je voudrais 2 tapis de prière', 'Samira Benali, 0661234567', 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5'];
  it('the switch moves the conversation language: the recap turn and the confirmation turn are arabizi', () => {
    expect(conversationLanguage(N3.slice(0, 2))).toBe('fr');
    expect(turnLanguage(N3[2], 'fr')).toBe('arabizi');
    expect(conversationLanguage(N3)).toBe('arabizi');
    // the next turn (« ih saha », or a bare « oui ») keeps it
    expect(turnLanguage('ih saha', conversationLanguage(N3))).toBe('arabizi');
    expect(turnLanguage('oui', conversationLanguage(N3))).toBe('arabizi');
    // N3p: the message with more darija
    expect(turnLanguage('ana f Constantine El Khroub, cité 1000 logements bloc 5, ch7al tawsil khouya ?', 'fr')).toBe('arabizi');
  });
  it('the server recap and the confirmation of the same conversation are both arabizi', () => {
    const lang = conversationLanguage(N3);
    expect(orderRecapText(recapOf(), lang).startsWith('Hada récap ta3 la commande:')).toBe(true);
    const placed = { ok: true, number: 'TEST-8515', items: [{ name: 'Tapis de prière', quantity: 2, unitPrice: 2800 }], deliveryFee: 700, total: 6300 };
    expect(orderConfirmationText([{ name: 'create_order', result: placed }], turnLanguage('ih saha', lang))!.startsWith('Commande ta3ek TEST-8515 tsajlet')).toBe(true);
  });
  it('French customers stay French: a place name with « kh », one darija word, a typographic apostrophe', () => {
    expect(conversationLanguage(['Bonjour, je voudrais 2 tapis de prière', 'Samira Benali, 0661234567', 'Constantine, El Khroub, cité 1000 logements bloc 5'])).toBe('fr');
    expect(conversationLanguage(['Bonjour, je voudrais 2 tapis de prière', 'Khenchela, cité 500 logements'])).toBe('fr');
    expect(conversationLanguage(['Bonjour khouya, je voudrais le sac à main cuir'])).toBe('fr');
    expect(conversationLanguage(['Bonjour, je voudrais 2 tapis', 'merci khouya'])).toBe('fr');
    expect(conversationLanguage(['Je voudrais l’article en noir', 'l’adresse : rue des frères Bouadou n 5'])).toBe('fr');
    expect(conversationLanguage(['Hi, I’d like to buy the silk hijab', 'cité 1000 logements, Bir El Djir'])).toBe('en');
  });
});

describe('R3-2 — Tunisian / Middle-Eastern forms and « ch7al » for « which »', () => {
  it.each(['Rani nab3atlek les photos tawa.', 'commande mta3ek', 'hala2 nab3atlek', 'ktir mlih', 'baddak tchouf ?', 'توا نبعثلك', 'شو بدك ؟'])('flagged as non-Algerian: « %s »', (t) => expect(moroccanIn(t)).toBe(true));
  it.each(['Ch7al men wilaya nta ?', 'Chhal men wilaya ?', 'ch7al men numéro ta3ek ?', 'Ch7al wilaya t7ebb ?', 'شحال من ولاية ؟'])('« how much » used for « which »: « %s »', (t) => expect(wrongDarijaIn(t)).toBe(true));
  it.each(['Wach men wilaya ?', 'Rani nab3atlek les photos dork.', 'Ch7al men produit t7ebb ?', 'Chhal l Oran ?', 'ch7al tawsil l Constantine ?', 'Tawsil f 2 l 5 ayam.', 'Ma nwasslouch l Illizi f had lwaqt.', 'Kayen bezzaf : basket de sport…', 'Hada tapis de prière, 120 x 70 cm', 'nheb nechri jouj', 'Tawassoul', 'جزء من الطلبية يمكن يتعطل شوية', 'واش من ولاية ؟', 'شحال التوصيل لوهران؟', 'Mlih, Boufarik f wilaya Blida.'])('Algerian, not flagged: « %s »', (t) => expect(moroccanIn(t) || wrongDarijaIn(t)).toBe(false));
  it('the server texts in arabizi / Arabic are never flagged', () => {
    for (const lang of ['arabizi', 'ar']) {
      const text = orderRecapText(recapOf(), lang);
      expect(moroccanIn(text) || wrongDarijaIn(text)).toBe(false);
    }
  });
  it('replaced by the Algerian forms (word boundaries kept)', () => {
    expect(fixMoroccan('Rani nab3atlek les photos tawa.')).toBe('Rani nab3atlek les photos dork.');
    expect(fixMoroccan('Merci Walid, numéro bien noté. Ch7al men wilaya nta ?')).toBe('Merci Walid, numéro bien noté. Wach men wilaya nta ?');
    expect(fixMoroccan('Ch7al smitek ?')).toBe('Wach smitek ?');
    expect(fixMoroccan('Ch7al wilaya t7ebb ?')).toBe('Wach men wilaya t7ebb ?');
    expect(fixMoroccan('شحال من ولاية ؟')).toBe('واش من ولاية ؟');
    expect(fixMoroccan('Ch7al men produit t7ebb ? Tawassoul')).toBe('Ch7al men produit t7ebb ? Tawassoul');
  });
  it('the reply guard flags the F3b replies and the server fixes what the corrective turn kept', () => {
    const f = buildGuardFacts({ lang: 'arabizi', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText: '0770112244', answeredBefore: true, freshStart: false });
    const reply = 'Merci Walid, numéro bien noté. Ch7al men wilaya nta ?';
    const v = checkReply(reply, f);
    expect(v.map((x) => x.rule)).toContain('moroccan_darija');
    expect(enforceReply(reply, v, f, { hasCards: false }).reply).toBe('Merci Walid, numéro bien noté. Wach men wilaya nta ?');
    expect(checkReply('Hada tapis de prière molletonné, 120 x 70 cm, b 2800 DA. Rani nab3atlek les photos tawa.', f).map((x) => x.rule)).toContain('moroccan_darija');
  });
});

describe('R3-3 — an invented name, the handoff reasons offered', () => {
  it.each(['Client', 'Client Messenger', 'client facebook', 'Customer 1', 'زبون', 'زبون فيسبوك', 'Utilisateur Messenger', 'Facebook User'])('placeholder: « %s »', (n) => expect(isPlaceholderName(n)).toBe(true));
  it.each(['Amine Benali', 'Clientèle Amine', 'Messenger', 'Nadia Kaci'])('a name: « %s »', (n) => expect(isPlaceholderName(n)).toBe(false));
  it('a name is the customer’s when one of its words is in their messages (any case), never a placeholder', () => {
    expect(nameGiven('Client', 'Bonjour, je prends le tapis de prière, 2 pièces')).toBe(false);
    expect(nameGiven('Client', 'Client')).toBe(false);
    expect(nameGiven('Karim Haddad', 'Bonjour, je veux 1 djellaba homme')).toBe(false);
    expect(nameGiven('Samira Benali', 'Bonjour\nSamira Benali, 0661234567')).toBe(true);
    expect(nameGiven('Amine BENALI', 'amine benali 0555 12 34 56')).toBe(true);
    expect(nameGiven('سمير بن علي', 'اسمي سمير بن علي')).toBe(true);
    // a script the customer never wrote in cannot be compared: accepted
    expect(nameGiven('Samir Ben Ali', 'اسمي سمير بن علي')).toBe(true);
  });
  const registry = () => new ToolRegistry({} as never, {} as never, {} as never, {} as never, {} as never);
  const ctx = (customerHistory: string) => ({ workspaceId: 'w', agent: { orderFields: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: customerHistory.split('\n').at(-1), customerHistory });
  it('F6 T1: create_order { « Client », 0500000000 } before the customer gave them is refused with both named', async () => {
    const r = await registry().prepareOrder({ clientName: 'Client', clientPhone: '0500000000', items: [{ productId: 'p', quantity: 2 }], customerConfirmed: true }, ctx('Bonjour, je prends le tapis de prière, 2 pièces'));
    expect(r.ok).toBe(false);
    const err = (r as unknown as { result: { error: { fields: string[]; notGivenByCustomer: string[]; field: string } } }).result.error;
    expect(err).toMatchObject({ code: 'VALIDATION', missing: true, field: 'clientName', notGivenByCustomer: ['clientName', 'clientPhone'] });
    expect(err.fields).toEqual(['clientName', 'clientPhone', 'wilayaId', 'communeName', 'address']);
    expect((r as unknown as { result: { say: string } }).result.say).toContain('name « Client »');
  });
  it('F8 T3: the 8-digit phone the customer typed is named invalid with the missing fields', async () => {
    const r = await registry().prepareOrder({ clientName: 'Yacine Mansouri', clientPhone: '05559876', items: [{ productId: 'p', quantity: 1 }], customerConfirmed: true }, ctx('Bonjour, je veux la djellaba\nYacine Mansouri\n05559876'));
    const res = (r as unknown as { result: { error: Record<string, unknown>; say: string } }).result;
    expect(res.error).toMatchObject({ code: 'VALIDATION', field: 'clientPhone', invalid: ['clientPhone'], fields: ['clientPhone', 'wilayaId', 'communeName', 'address'] });
    expect(res.error.notGivenByCustomer).toBeUndefined();
    expect(res.say).toContain('not a valid number');
  });
  it('the handoff reasons follow the agent’s rules: no `other` without shop rules, no `keyword` without keywords', () => {
    const none = allowedHandoffReasons({ humanHandoffRules: null, handoffKeywords: [] });
    expect(none).not.toContain('other');
    expect(none).not.toContain('keyword');
    expect(none).not.toContain('unclear_streak');
    expect(none).toEqual(expect.arrayContaining(['customer_request', 'refund', 'complaint', 'angry', 'off_catalogue', 'order_limits', 'risky_client']));
    expect(allowedHandoffReasons({ humanHandoffRules: 'Transférer les devis', handoffKeywords: ['facture'] }, 2)).toEqual(expect.arrayContaining(['other', 'keyword', 'unclear_streak']));
    expect(allowedHandoffReasons({ handoffRules: [{ kind: 'anger', enabled: false }, { kind: 'refund', enabled: true }] })).not.toContain('angry');
    const def = handoffDefWith(TOOL_DEFS.handoff_to_human, none);
    expect((def.parameters as { properties: { reason: { enum: string[] } } }).properties.reason.enum).toEqual(none);
    expect(def.description).not.toContain('reason=other');
    expect((def.parameters as { required: string[] }).required).toEqual(['reason', 'evidence']);
  });
  it('the turn offers handoff_to_human with the allowed reasons only', async () => {
    const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
    const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Très bon choix ! Quel est votre nom complet ?', intent: 'SALE' });
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: 'Bonjour, je veux 1 hijab soie' }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: 'Bonjour, je veux 1 hijab soie' }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
    await svc.turn(req);
    const offered = gateway.calls[0]!.tools!.find((d) => d.name === 'handoff_to_human')!;
    expect((offered.parameters as { properties: { reason: { enum: string[] } } }).properties.reason.enum).not.toContain('other');
  });
});

describe('R3-4 — the model’s sentence before the server recap', () => {
  it.each([
    ['F7 T6', 'تمام يا نادية، بدلنا الطلبية لـ 2 حجاب سوا. استني تأكيدك بـ « إيه » باش نسجلوها.', 'ar'],
    ['F11 T3', 'Votre commande est prête à être confirmée, le récapitulatif va vous être envoyé.', 'fr'],
    ['F4 T6', 'Thanks John, I have everything for your order.', 'en'],
    ['wait', 'J’attends votre confirmation pour valider.', 'fr'],
  ])('%s: only the server recap', (_id, reply, lang) => expect(recapReply(reply, recapOf(), lang)).toEqual({ text: orderRecapText(recapOf(), lang), kept: 'server' }));
  it('N3p T2 / F11 T3: the answer to another question (the fee) or a short lead-in is kept, the talk about the recap dropped', () => {
    const n3p = recapReply('Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. Recap ydhher dork, t7ebb nkamlouh b confirmation ?', recapOf(), 'arabizi');
    expect(n3p.kept).toBe('prefix');
    expect(n3p.text).toBe(`Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam.\n\n${orderRecapText(recapOf(), 'arabizi')}`);
    const f11 = recapReply('Merci Lamia ! Votre commande est prête à être confirmée, le récapitulatif va vous être envoyé.', recapOf(), 'fr');
    expect(f11.text).toBe(`Merci Lamia !\n\n${orderRecapText(recapOf(), 'fr')}`);
    // one call to action: the recap's own
    expect(f11.text.match(/confirmer/g)).toHaveLength(1);
  });
  it('an answer to another question is still kept (« Oui, on livre à Constantine. »)', () => {
    expect(recapReply('Oui, on livre à Constantine 😊', recapOf(), 'fr').kept).toBe('prefix');
  });
});

describe('R3-5 — natural arabizi for the order questions', () => {
  it.each(['Ila l dar, a3tini smiya ta3 nhar (rue, cité...).', 'Wach t7ebb tswal l dar wela stop-desk ?', 'Tswal l dar (450 DA) wela f stop-desk (300 DA) ?'])('made-up arabizi flagged: « %s »', (t) => expect(wrongDarijaIn(t)).toBe(true));
  it.each(['3andi swal', 'nhar el khmis', 'Wach smitek ?', "A3tini l'adresse ta3ek"])('Algerian: « %s »', (t) => expect(wrongDarijaIn(t) || moroccanIn(t)).toBe(false));
  it('replaced by the words Algerians write', () => {
    expect(fixMoroccan('Ila l dar, a3tini smiya ta3 nhar (rue, cité...).')).toBe("Ila l dar, a3tini l'adresse (rue, cité...).");
    expect(fixMoroccan('Wach t7ebb tswal l dar wela stop-desk ?')).toBe('Wach t7ebb nwasslouha l dar wela stop-desk ?');
    expect(fixMoroccan('Tswal l dar (450 DA) wela f stop-desk (300 DA) ?')).toBe('Nwasslouha l dar (450 DA) wela f stop-desk (300 DA) ?');
  });
  it('the prompt gives the arabizi field questions', () => {
    const s = languageSection({ lang: 'arabizi' } as never);
    expect(s).toContain('« Wach smitek ? »');
    expect(s).toContain('« Wach men wilaya ? »');
    expect(s).toContain('« T7ebb nwasslouha l dar wela f stop-desk ? »');
    expect(s).toContain('tawa / tawwa');
  });
});
