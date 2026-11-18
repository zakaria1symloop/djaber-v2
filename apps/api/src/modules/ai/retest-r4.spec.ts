// Journey retest R4 (17/11, docs/audit/journeys-2026-11-16/journeys/R4-ai-orders.md): an order placed with no recap (R4-3), a
// server handoff reason chosen by the model (R4-1), a name typed in Arabic script switching the language (R4-2), a confirm
// request kept before the server recap (R4-4), Moroccan « tanqdar » (R4-5), the second phone dropped (R4-6), the blocked
// customer's wording (R4-8).
import { prisma } from '@djaber/db';
import { AiRunService, type TurnRequest } from './ai-run.service';
import { allowedHandoffReasons, establishedReasons, judgeHandoff } from './handoff-judge';
import { conversationLanguage, fixMoroccan, moroccanIn, turnLanguage, wrongDarijaIn } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { blockedOrderText, orderRecapText, pendingRecap, recapReply, withoutRecapClaims } from './tools/order-confirmation-text';
import * as confirmation from './tools/order-confirmation';
import { otherPhoneGiven, TOOL_DEFS, ToolRegistry, type ToolRunContext } from './tools/tool-registry';

afterEach(() => jest.restoreAllMocks());

const model = { id: 'm1', providerId: 'p1', supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };

describe('R4-3 (Critical) — « oui » to a product the AI suggested is never an order without the server recap', () => {
  // N5 (J04 shop): the Parfum Oud is out of stock, the AI proposes the Coffret cadeau Aïd (24 990 DA, home delivery free from
  // 20 000 DA — so total = price) after repeating the customer's details; the customer answers « oui »
  const COFFRET = '01a1e54f-0000-7000-8000-000000003400';
  const N5 = [
    'Bonjour, le parfum oud c\'est combien ?',
    'ok merci',
    'Vous livrez à Oran ?',
    'Et ça prend combien de jours ?',
    'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4',
    'oui',
  ];
  const T5_AI = 'Désolé, Parfum Oud 50 ml est en rupture de stock pour le moment, je ne peux donc pas le commander. J\'ai bien noté Karim Haddad, 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4. Voulez-vous plutôt le Coffret cadeau Aïd à 24990 DA, qui contient un parfum, du chocolat et une carte personnalisée ?';
  const args = { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 31, communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', items: [{ productId: COFFRET, quantity: 1 }], customerConfirmed: true };
  const registry = () => {
    const catalogue = { byIds: async () => [{ id: COFFRET, name: 'Coffret cadeau Aïd', price: 24_990, hasVariants: false, variants: [], stock: 5, sellOutOfStock: false }] };
    const reg = new ToolRegistry(catalogue as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(prisma.wilaya, 'findUnique').mockResolvedValue({ id: 31, code: '31', nameFr: 'Oran', nameAr: 'وهران', communes: [{ nameFr: 'Bir El Djir', nameAr: 'بئر الجير' }] } as never);
    jest.spyOn(prisma.aiToolCall, 'findMany').mockResolvedValue([] as never);
    const r = reg as unknown as { wilayaGiven: () => Promise<boolean>; quote: () => Promise<Record<string, unknown>> };
    jest.spyOn(r, 'wilayaGiven').mockResolvedValue(true);
    jest.spyOn(r, 'quote').mockResolvedValue({ ok: true, wilayaId: 31, wilayaName: 'Oran', fee: 0, free: true });
    return reg;
  };
  const ctx = (history: confirmation.OrderCallHistory): Omit<ToolRunContext, 'callId'> & { callId: string } => ({ workspaceId: 'w', agent: { orderFields: [], maxQtyPerOrder: 5, maxAmountPerOrder: null } as never, conversationId: null, clientId: null, channelId: null, runId: 'r6', callId: 'c', dryRun: true, customerText: 'oui', customerHistory: N5.join('\n'), orderHistory: history, ordering: true });

  it('N5 T6: no earlier recap ⇒ CONFIRMATION_REQUIRED with the server recap (free delivery shown), nothing ordered', async () => {
    const r = await registry().prepareOrder(args, ctx([]));
    expect(r.ok).toBe(false);
    const result = (r as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { total: 24_990, deliveryFee: 0 } });
    const recap = pendingRecap([{ name: 'create_order', result }])!;
    const text = recapReply(T5_AI, recap, 'fr').text;
    expect(text).toBe(orderRecapText(recap, 'fr'));
    expect(text).toContain('- 1 × Coffret cadeau Aïd : 24 990 DA');
    expect(text).toContain('Livraison à domicile (Bir El Djir, Oran) : gratuite');
    expect(text).toContain('Répondez « oui » pour confirmer');
  });
  it('a model sentence saying the order is placed is never kept before the server recap', () => {
    const recap = pendingRecap([{ name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Coffret cadeau Aïd', quantity: 1, unitPrice: 24990 }], subtotal: 24990, deliveryFee: 0, total: 24990, clientName: 'Karim Haddad', clientPhone: '0770112233', wilaya: 'Oran', communeName: 'Bir El Djir', address: 'cité 1000 logements bloc 4', isStopdesk: false } } }])!;
    for (const [reply, lang] of [['Votre commande est enregistrée ✅', 'fr'], ['Your order is confirmed!', 'en'], ['تم تسجيل طلبيتك', 'ar'], ['Commande ta3ek tsajlet', 'arabizi']]) expect(recapReply(reply!, recap, lang)).toEqual({ text: orderRecapText(recap, lang), kept: 'server' });
    expect(withoutRecapClaims('Votre commande est bien enregistrée. Un conseiller vous répond.')).toBe('Un conseiller vous répond.');
  });
  it('the model-recap path is gone: the AI message before the « oui » is never read as a recap', () => {
    expect((confirmation as Record<string, unknown>).recapShown).toBeUndefined();
    expect((confirmation as Record<string, unknown>).lastAiText).toBeUndefined();
    expect(Object.keys(TOOL_DEFS.create_order.parameters as object)).not.toContain('lastAiText');
  });
  it('the « oui » to that SERVER recap, in the next turn, places the order (J03-10 core match kept)', async () => {
    const first = await registry().prepareOrder(args, ctx([]));
    const shown = { name: 'create_order', result: (first as { result: unknown }).result, at: new Date(Date.now() - 60_000) };
    // the confirming call rewords the address — same core, the recap's wording is kept
    const r = await registry().prepareOrder({ ...args, address: 'Cité 1000 logements bloc 4, Bir El Djir, Oran' }, ctx([shown]));
    expect(r.ok).toBe(true);
    expect((r as { request: { address: string; total: number } }).request).toMatchObject({ address: 'cité 1000 logements bloc 4', total: 24_990 });
  });
});

describe('R4-1 — server handoff reasons are tool outcomes, never the model’s choice', () => {
  it('the tool offers only the reasons a customer message can trigger', () => {
    const reasons = allowedHandoffReasons({ humanHandoffRules: null, handoffKeywords: [] });
    expect(reasons).toEqual(['customer_request', 'refund', 'complaint', 'angry', 'off_catalogue']);
    expect(allowedHandoffReasons({ humanHandoffRules: 'Les devis ⇒ équipe', handoffKeywords: ['arnaque'] }, 2)).toEqual(['customer_request', 'refund', 'complaint', 'angry', 'unclear_streak', 'off_catalogue', 'keyword', 'other']);
  });
  it('F1 T1 / F6 T3: order_limits on an order message is refused; accepted once create_order reported it this turn', () => {
    expect(judgeHandoff({ reason: 'order_limits', evidence: 'Je voudrais le sac à main cuir marron', customerText: 'Je voudrais le sac à main cuir marron' })).toEqual({ ok: false, reason: 'order_limits', why: 'server_reason' });
    expect(judgeHandoff({ reason: 'order_limits', evidence: 'placeholder', customerText: 'Constantine, El Khroub, cité 1000 logements bloc 5' })).toMatchObject({ ok: false, why: 'server_reason' });
    expect(judgeHandoff({ reason: 'risky_client', evidence: 'x', customerText: 'oui' })).toMatchObject({ ok: false, why: 'server_reason' });
    const established = establishedReasons([{ ok: false, hint: 'order_limit', maxQty: 5, maxAmount: null }]);
    expect(established).toEqual(['order_limits']);
    expect(judgeHandoff({ reason: 'order_limits', customerText: '12 pièces', established })).toEqual({ ok: true, reason: 'order_limits' });
    expect(establishedReasons([{ ok: false, error: { code: 'CUSTOMER_BLOCKED' }, hint: 'handoff' }])).toEqual(['risky_client']);
  });
  it('the tool: handoff_to_human { order_limits, evidence « placeholder » } ⇒ HANDOFF_NOT_NEEDED, no handoff', async () => {
    const reg = Object.create(ToolRegistry.prototype) as ToolRegistry;
    const c = { workspaceId: 'w', agent: { humanHandoffRules: null, handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', callId: 'c', dryRun: true, customerText: 'Constantine, El Khroub, cité 1000 logements bloc 5' };
    const refused = await reg.execute('handoff_to_human', { reason: 'order_limits', evidence: 'placeholder' }, c);
    expect(refused).toMatchObject({ ok: false, error: { code: 'HANDOFF_NOT_NEEDED', why: 'server_reason' } });
    expect(reg.forcedHandoff('handoff_to_human', { reason: 'order_limits' }, refused)).toBeNull();
    expect(await reg.execute('handoff_to_human', { reason: 'order_limits', evidence: '12' }, { ...c, established: ['order_limits'] })).toEqual({ ok: true });
  });
  it('status=HANDOFF statusDetail=order_limits with no limit hit ⇒ refused, the model answers in the same turn', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Je transmets.', status: 'HANDOFF', statusDetail: 'order_limits', evidence: 'Je voudrais le sac à main cuir marron', intent: 'SALE' }, { reply: 'Très bon choix ! Quel est votre nom ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order, TOOL_DEFS.handoff_to_human], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: 'Je voudrais le sac à main cuir marron' }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [], maxQtyPerOrder: 5 } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: 'Je voudrais le sac à main cuir marron' }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
    const r = await svc.turn(req);
    expect(r.ok && r.handoffRefused).toBe('server_reason');
    expect(r.ok && r.output).toMatchObject({ status: 'OK', reply: 'Très bon choix ! Quel est votre nom ?' });
    // journey retest R14-3: no reason fits « Je voudrais le sac à main cuir marron » any more (no complaint / anger word) ⇒ the tool is not offered
    expect(gateway.calls[0]!.tools!.find((d) => d.name === 'handoff_to_human')).toBeUndefined();
  });
  it('F6 T3: a handoff answer never claims a recap that was not shown', () => {
    expect(withoutRecapClaims('Merci Samira, votre commande est bien récapitulée ci-dessus (2 tapis de prière, total 6300 DA livraison comprise). Répondez oui pour la confirmer.')).toBe('');
    expect(withoutRecapClaims('Bien sûr, un conseiller va vous répondre. Votre récapitulatif est prêt, répondez oui.')).toBe('Bien sûr, un conseiller va vous répondre.');
    expect(withoutRecapClaims('Un membre de l’équipe vous répond très vite.')).toBe('Un membre de l’équipe vous répond très vite.');
  });
});

describe('R4-2 — a name typed in Arabic script is a value, not a language', () => {
  it('N4: the French customer stays French (name, then phone + address, then « oui »)', () => {
    const N4 = ['Bonjour, je veux le tapis de prière', 'سمير بن علي', '0661234567, Blida, Boufarik, cité 20 août villa 3', 'oui'];
    for (let i = 1; i <= N4.length; i++) expect(conversationLanguage(N4.slice(0, i))).toBe('fr');
    expect(turnLanguage('سمير بن علي', 'fr')).toBe('fr');
  });
  it('F3: the arabizi customer stays arabizi (« smiti وليد بوزيد », the phone, the places, « ih »)', () => {
    const F3 = ['nheb nechri zoudj tapis de prière', 'smiti وليد بوزيد', '0770112244', 'Blida, Boufarik', 'cite 20 aout villa 3', 'ih'];
    for (let i = 1; i <= F3.length; i++) expect(conversationLanguage(F3.slice(0, i))).toBe('arabizi');
  });
  it('controls F2 / F7: an Arabic-script customer stays Arabic; a real Arabic message still switches', () => {
    expect(conversationLanguage(['السلام عليكم، نحب نشري جلابة رجالي', 'اسمي سمير بن علي', '0661234567', 'قسنطينة، الخروب', 'حي 1000 مسكن عمارة 5'])).toBe('ar');
    expect(conversationLanguage(['سلام، نحب حجاب حرير واحد', 'نادية قاسي 0661234568', 'البليدة، بوفاريك، حي الورود رقم 12', 'ايه'])).toBe('ar');
    expect(turnLanguage('السلام عليكم، نحب نشري جلابة', 'fr')).toBe('ar');
    expect(turnLanguage('شكرا', 'fr')).toBe('ar');
    expect(turnLanguage('اسمي سمير بن علي', 'fr')).toBe('ar');
    // places / an address in Arabic script carry no clue either; « عبد السلام » is a name, not « السلام »
    expect(turnLanguage('قسنطينة، الخروب', 'fr')).toBe('fr');
    expect(turnLanguage('عبد السلام بوزيد', 'fr')).toBe('fr');
  });
  it('the reply guard: an Arabic reply to « سمير بن علي » in a French conversation is a language switch', () => {
    const f = buildGuardFacts({ lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText: 'سمير بن علي', answeredBefore: true, freshStart: false });
    expect(f.messageLang).toBeUndefined();
    expect(checkReply('تسجّل الاسم، شكرا سمير. أعطيني رقم الهاتف متاعك (مثلا: 0555123456).', f).map((v) => v.rule)).toContain('language_switch');
    expect(checkReply('Merci Samir ! Quel est votre numéro de téléphone ? (ex : 0555123456)', f).map((v) => v.rule)).not.toContain('language_switch');
  });
});

describe('R4-4 — no model request to confirm before the server recap', () => {
  const recap = pendingRecap([{ name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Tapis de prière', quantity: 2, unitPrice: 2800 }], subtotal: 5600, deliveryFee: 450, total: 6050, clientName: 'Walid Bouzid', clientPhone: '0770112244', wilaya: 'Blida', communeName: 'Boufarik', address: 'cite 20 aout villa 3', isStopdesk: false } } }])!;
  it.each(['Wach t7ebb nakked l commande ? (yes / le)', 'N2akked lek la commande ?', 'Nakkdou la commande ?', 'T7ebb ta2kid ? (ih / la)'])('F3b T7 « %s » ⇒ the server recap alone', (reply) => expect(recapReply(reply, recap, 'arabizi')).toEqual({ text: orderRecapText(recap, 'arabizi'), kept: 'server' }));
  it('a lead-in that is not a request to confirm stays', () => expect(recapReply('Saha Walid !', recap, 'arabizi').kept).toBe('prefix'));
});

describe('R4-5 — Moroccan durative forms and odd arabizi', () => {
  it('F9 T3 « tanqdar » flagged and replaced', () => {
    const t = 'Ma nwasslouch l Illizi f had lwaqt, désolé. T7ebb nchouf wach men wilaya o9rib tanqdar towsal fiha ?';
    expect(moroccanIn(t)).toBe(true);
    expect(fixMoroccan(t)).toContain('nqder');
    expect(moroccanIn(fixMoroccan(t))).toBe(false);
    for (const m of ['kanqdar', 'tandir lek', 'kan3ref', 'katbghi']) expect(moroccanIn(m)).toBe(true);
  });
  it('F3b T1 « taf3il » for « tafasil »', () => {
    const t = 'T7ebb nwarrik wahd menhom b taman w taf3il ?';
    expect(wrongDarijaIn(t)).toBe(true);
    expect(fixMoroccan(t)).toBe('T7ebb nwarrik wahd menhom b taman w tafasil ?');
  });
  it.each(['nqder nwasslek', 'kanet 3andi', 'kayen', 'ndir lek la commande', 'tafasil ta3 produit'])('Algerian, not flagged: « %s »', (t) => expect(moroccanIn(t) || wrongDarijaIn(t)).toBe(false));
});

describe('R4-6 — two phone numbers: both kept', () => {
  it('N2 « 0661234568 ou 0770998877 » ⇒ the other one is the second phone', () => {
    const h = 'Bonjour, je veux 1 hijab soie. Nadia Kaci, 0661234568 ou 0770998877\nBlida, Boufarik, cité 20 août villa 3\noui';
    expect(otherPhoneGiven(h, '0661234568')).toBe('0770998877');
    expect(otherPhoneGiven(h, '0770998877')).toBe('0661234568');
    expect(otherPhoneGiven('0661 23 45 68 / 0770 99 88 77', '0661234568')).toBe('0770998877');
  });
  it('a correction or a later choice keeps one number only', () => {
    expect(otherPhoneGiven('0661234568 non pardon 0770998877', '0770998877')).toBeNull();
    expect(otherPhoneGiven('0661234568 ou plutôt 0770998877', '0770998877')).toBeNull();
    expect(otherPhoneGiven('0661234568 ou 0770998877\ngardez le 0661234568', '0661234568')).toBeNull();
    expect(otherPhoneGiven('Karim Haddad 0770112233', '0770112233')).toBeNull();
  });
});

describe('R4-8 — the blocked customer is told the team takes over', () => {
  it('CUSTOMER_BLOCKED ⇒ the server sentence, never « réessayer plus tard »', () => {
    const calls = [{ name: 'create_order', result: { ok: false, error: { code: 'CUSTOMER_BLOCKED' }, hint: 'handoff' } }];
    expect(blockedOrderText(calls, 'fr')).toBe('Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper.');
    for (const l of ['ar', 'arabizi', 'en']) expect(blockedOrderText(calls, l)).toBeTruthy();
    expect(moroccanIn(blockedOrderText(calls, 'arabizi')!) || moroccanIn(blockedOrderText(calls, 'ar')!)).toBe(false);
    expect(blockedOrderText([{ name: 'create_order', result: { ok: true } }], 'fr')).toBeNull();
  });
  it('the turn sends it in place of the model’s wording (status HANDOFF)', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Lamia Touati' } }] }, { reply: 'Désolé, je n’arrive pas à valider votre commande pour le moment. Vous pouvez réessayer un peu plus tard.', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => 'risky_client', execute: async () => ({ ok: false, error: { code: 'CUSTOMER_BLOCKED' }, hint: 'handoff' }) } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: 'oui' }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: 'oui' }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
    const r = await svc.turn(req);
    expect(r.ok && r.forcedHandoff).toBe('risky_client');
    expect(r.ok && r.output.reply).toBe('Je ne peux pas valider cette commande ici : l’équipe de la boutique va s’en occuper.');
  });
});
