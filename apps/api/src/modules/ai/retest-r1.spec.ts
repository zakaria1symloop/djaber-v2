// Journey retest R1 (17/11/2026, live e8acdbb) — the AI order-taking rules fixed after the retest: provider errors that
// were not the provider's (R1-1), the quantity loop (R1-2), arabizi kept (R1-3), Moroccan words (R1-4), create_order /
// handoff probes (R1-5), the server recap (R1-6 / R1-7). Pure rules; the model loop is in stray-tool-turn.spec.ts.
import { BREAKER_MIN_CALLS, BREAKER_MIN_ERRORS } from './ai.constants';
import { providerErrorLabel } from './ai-run.service';
import { fieldOnlyMessage } from './handoff-judge';
import { conversationLanguage, detectLanguage, fixMoroccan, MOROCCAN_WORDS, turnLanguage } from './language';
import { unansweredFrom } from './playground.service';
import { AiProviderError } from './provider/ai.gateway';
import { sdkErrorDetail } from './provider/live-ai.gateway';
import { breakerTrips } from './routing.service';
import { checkReply, enforceReply, buildGuardFacts } from './reply-guard';
import { orderRecapText, pendingRecap, recapComplete, recapReply } from './tools/order-confirmation-text';
import { absentFields } from './tools/tool-registry';

const recapResult = (over: Record<string, unknown> = {}) => ({
  ok: false,
  error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' },
  recapToShow: true,
  recap: { items: [{ name: 'Djellaba homme', variant: null, quantity: 1, unitPrice: 7500 }], subtotal: 7500, deliveryFee: 700, total: 8200, clientName: 'Samir Ben Ali', clientPhone: '0661234567', wilaya: 'Constantine', communeName: 'El Khroub', address: 'Cité 1000 logements bloc 5', isStopdesk: false, ...over },
});

describe('R1-1 — provider errors say why; the breaker needs volume', () => {
  it('an SDK error that is not an HTTP answer is named (never a bare provider_error) and marked local', () => {
    expect(sdkErrorDetail({ name: 'AI_NoSuchToolError' })).toBe('sdk:no_such_tool');
    expect(sdkErrorDetail({ name: 'AI_InvalidPromptError' })).toBe('sdk:invalid_prompt');
    expect(sdkErrorDetail({ name: 'AI_SomethingNew' })).toBe('sdk:SomethingNew');
    expect(sdkErrorDetail(new Error('x'))).toBe('sdk:Error');
    const local = new AiProviderError('provider_error', 'anthropic', 'anthropic provider_error', undefined, 'sdk:no_such_tool', true);
    expect(providerErrorLabel(local)).toBe('provider_error:sdk:no_such_tool');
    expect(local.local).toBe(true);
    expect(providerErrorLabel(new AiProviderError('provider_error', 'anthropic', 'anthropic 529', 529, 'overloaded_error'))).toBe('provider_error:529 overloaded_error');
    expect(new AiProviderError('provider_error', 'anthropic', 'x').local).toBe(false);
  });

  it('2 errors in 15 calls (the live log) never open the breaker; a real outage still does', () => {
    expect(BREAKER_MIN_CALLS).toBeGreaterThanOrEqual(20);
    expect(BREAKER_MIN_ERRORS).toBeGreaterThanOrEqual(5);
    expect(breakerTrips(15, 2, 2)).toBe(false);
    expect(breakerTrips(55, 2, 2)).toBe(false);
    expect(breakerTrips(55, 4, 2)).toBe(false);
    expect(breakerTrips(5, 5, 2)).toBe(false); // too few calls to read a rate
    expect(breakerTrips(20, 5, 2)).toBe(true);
    expect(breakerTrips(200, 5, 2)).toBe(true); // 2.5 % > 2 %
    expect(breakerTrips(400, 5, 2)).toBe(false); // 1.25 %
  });

  it('the playground answers the unanswered messages with the current one (a « oui » of a failed turn is not lost)', () => {
    expect(unansweredFrom([{ role: 'user' }])).toBe(0);
    expect(unansweredFrom([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }])).toBe(2);
    // the « oui » got a 503 and stays in the thread: the next message is answered with it
    expect(unansweredFrom([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'user' }])).toBe(2);
    expect(unansweredFrom([{ role: 'user' }, { role: 'user' }, { role: 'user' }])).toBe(0);
  });
});

describe('R1-3 — an arabizi conversation stays arabizi', () => {
  it('« nheb nechri 2 tapis de prière » is arabizi (French nouns inside darija), alone and in the conversation', () => {
    expect(detectLanguage('nheb nechri 2 tapis de prière')).toBe('arabizi');
    expect(detectLanguage('nheb nechri zoudj tapis de prière')).toBe('arabizi');
    expect(conversationLanguage(['slm', 'nheb nechri 2 tapis de prière', 'smiti Walid Bouzid', '0770112244', 'Blida', 'Boufarik'])).toBe('arabizi');
    expect(turnLanguage('cite 20 aout villa 3', 'arabizi')).toBe('arabizi');
    expect(turnLanguage('Pardon, c’est 0555987654', 'fr')).toBe('fr');
  });
  it('a darija word keeps arabizi whatever the French words; a French sentence without one still switches', () => {
    expect(detectLanguage('wla stop desk, c’est mieux pour la livraison', 'arabizi')).toBe('arabizi');
    expect(detectLanguage('je préfère la livraison à domicile svp', 'arabizi')).toBe('fr');
  });
});

describe('R1-4 — Moroccan words of the transcripts', () => {
  it.each(['Wach t7ebb ta3raf 3la chi hadja 3andna ?', 'Malheureusement, ma kaynach livraison l Illizi lwa9t.', 'makaynach had taille'])('flagged: « %s »', (t) => expect(MOROCCAN_WORDS.test(t)).toBe(true));
  it('the server replaces them by the Algerian words when the corrective turn kept them', () => {
    expect(fixMoroccan('Wach t7ebb ta3raf 3la chi hadja 3andna ?')).toBe('Wach t7ebb ta3raf 3la hadja 3andna ?');
    expect(fixMoroccan('Ma kaynach livraison l Illizi.')).toBe('Makach livraison l Illizi.');
    expect(fixMoroccan('numéro dyalek ?')).toBe('numéro ta3ek ?');
    expect(fixMoroccan('شنو بغيت ؟')).toBe('واش حبيت ؟');
    expect(MOROCCAN_WORDS.test(fixMoroccan('Wach t7ebb chi hadja, daba ma kaynach.'))).toBe(false);
  });
  it('enforcement: a reply still Moroccan after the corrective turn is sent with the Algerian words', () => {
    const facts = buildGuardFacts({ lang: 'arabizi', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'B', customerText: 'slm', answeredBefore: false, freshStart: false });
    const reply = 'Wa 3likoum salam ! Wach t7ebb ta3raf 3la chi hadja 3andna ?';
    const v = checkReply(reply, facts);
    expect(v.map((x) => x.rule)).toContain('moroccan_darija');
    expect(enforceReply(reply, v, facts, { hasCards: false }).reply).toBe('Wa 3likoum salam ! Wach t7ebb ta3raf 3la hadja 3andna ?');
  });
});

describe('R1-5 — no handoff tool on a yes; create_order refused at once without the fields', () => {
  it.each(['oui', 'ih', 'yes', 'ايه', "oui c'est bon", 'ok'])('a bare yes is an order answer, ordering or not: « %s »', (t) => expect(fieldOnlyMessage(t, false)).toBe(true));
  it.each(['oui mais je veux parler à un humain', 'oui ?'])('not with a request or a question: « %s »', (t) => expect(fieldOnlyMessage(t, true)).toBe(false));
  it('every absent required field, in the asking order; invalid values are left to the other checks', () => {
    const agent = { orderFields: [] } as never;
    expect(absentFields({}, agent)).toEqual(['items', 'clientName', 'clientPhone', 'wilayaId', 'communeName', 'address']);
    expect(absentFields({ clientName: 'Samira Benali', clientPhone: '0661234567', wilayaId: 25, items: [{ productId: 'p', quantity: 2 }], customerConfirmed: false }, agent)).toEqual(['communeName', 'address']);
    expect(absentFields({ clientName: 'Samira Benali', clientPhone: '0661234567', wilayaId: 25, items: [{ productId: 'p', quantity: 2 }], isStopdesk: true }, agent)).toEqual([]);
    expect(absentFields({ clientName: 'Samira Benali', clientPhone: '12345', wilayaId: 25, communeName: 'El Khroub', address: 'court', items: [{ productId: 'p', quantity: 2 }] }, agent)).toEqual([]);
    // commune optional for this agent
    expect(absentFields({ clientName: 'A B', clientPhone: '0661234567', wilayaId: 25, address: 'Cité 1000 logements', items: [{ productId: 'p', quantity: 1 }] }, { orderFields: [{ key: 'commune', required: false }] } as never)).toEqual([]);
  });
});

describe('R1-6 / R1-7 — the server recap is the recap', () => {
  const calls = (r = recapResult()) => [{ name: 'create_order', result: r }];
  it('the pending recap of the turn (a first recap only; none once an order is placed)', () => {
    expect(pendingRecap(calls())).toMatchObject({ total: 8200, clientName: 'Samir Ben Ali', isStopdesk: false });
    expect(pendingRecap([{ name: 'create_order', result: { ...recapResult(), recapToShow: undefined } }])).toBeNull();
    expect(pendingRecap([...calls(), { name: 'create_order', result: { ok: true, number: 'TEST-1', items: [], total: 8200 } }])).toBeNull();
    expect(pendingRecap([{ name: 'quote_delivery', result: { ok: true } }])).toBeNull();
  });
  it('fr / ar / arabizi / en: catalogue names as written, delivery mode and fee, total, name, phone, address', () => {
    const r = pendingRecap(calls())!;
    expect(orderRecapText(r, 'fr')).toBe(
      ['Voici le récapitulatif de votre commande :', '- 1 × Djellaba homme : 7 500 DA', '- Livraison à domicile (El Khroub, Constantine) : 700 DA', 'Total : 8 200 DA, à payer à la livraison.', 'Nom : Samir Ben Ali', 'Téléphone : 0661234567', 'Adresse : Cité 1000 logements bloc 5, El Khroub, Constantine', 'Répondez « oui » pour confirmer la commande, ou dites-moi ce qu’il faut changer.'].join('\n'),
    );
    const ar = orderRecapText(r, 'ar');
    expect(ar).toContain('- 1 × Djellaba homme : 7 500 دج');
    expect(ar).toContain('التوصيل للدار (El Khroub، Constantine): 700 دج');
    expect(ar).not.toContain('جلابة');
    const arabizi = orderRecapText(r, 'arabizi');
    expect(arabizi.split('\n')[0]).toBe('Hada récap ta3 la commande:');
    expect(arabizi).toContain('Ktebli « ih » bach nconfirmi la commande');
    expect(orderRecapText(pendingRecap(calls(recapResult({ isStopdesk: true, deliveryFee: 450, total: 7950, address: null }) as never))!, 'en')).toContain('- Stop-desk delivery (Constantine): 450 DA');
    expect(orderRecapText(pendingRecap(calls(recapResult({ replaces: 'TEST-6619' }) as never))!, 'fr')).toContain('Elle remplacera la commande TEST-6619.');
  });
  it('a model recap missing lines, the name or the phone, or with a translated name, is replaced; a whole one is kept', () => {
    const r = pendingRecap(calls())!;
    // F6 T7: one sentence, no line, no name, no phone
    expect(recapComplete('Votre commande de 1 djellaba (total 8200 DA, livraison incluse) attend votre confirmation : répondez oui.', r)).toBe(false);
    // F2 T6: « جلابة رجالي » for « Djellaba homme »
    expect(recapComplete('ملخص الطلب: جلابة رجالي × 1: 7500 دج، التوصيل 700 دج، المجموع 8200 دج. الاسم: Samir Ben Ali الهاتف: 0661234567', r)).toBe(false);
    expect(recapComplete('Djellaba homme x1 : 7500 DA, livraison 700 DA, total 8 200 DA. Nom : Samir Ben Ali, téléphone 0661234567.', r)).toBe(true);
    expect(recapReply('Votre commande de 1 djellaba (total 8200 DA) attend votre confirmation.', r, 'fr')).toEqual({ text: orderRecapText(r, 'fr'), kept: 'server' });
    expect(recapReply('', r, 'arabizi')).toEqual({ text: orderRecapText(r, 'arabizi'), kept: 'server' });
    // another answer of the same message is kept before the recap
    expect(recapReply('Oui, on livre aussi le vendredi.', r, 'fr')).toEqual({ text: `Oui, on livre aussi le vendredi.\n\n${orderRecapText(r, 'fr')}`, kept: 'prefix' });
  });
});

describe('R1-1 — a turn the AI did not answer is not counted in the 60 / h', () => {
  it('uncountTurn gives the turn back (never below 0, the hour window kept)', async () => {
    const store = new Map<string, number>();
    const client = {
      incr: async (k: string) => (store.set(k, (store.get(k) ?? 0) + 1), store.get(k)!),
      decr: async (k: string) => (store.set(k, (store.get(k) ?? 0) - 1), store.get(k)!),
      set: jest.fn(async (k: string, v: string) => (store.set(k, Number(v)), 'OK')),
      expire: async () => 1,
      ttl: async () => 3600,
    };
    const { PlaygroundService } = await import('./playground.service');
    const pg = new PlaygroundService({} as never, {} as never, {} as never, { client } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await pg.countTurn('w1')).toBe(1);
    expect(await pg.countTurn('w1')).toBe(2);
    expect(await pg.uncountTurn('w1')).toBe(1);
    expect(await pg.countTurn('w1')).toBe(2);
    store.set('rl:playground:w2', 0);
    expect(await pg.uncountTurn('w2')).toBe(0);
    expect(client.set).toHaveBeenCalledWith('rl:playground:w2', '0', 'KEEPTTL');
  });
});

describe('R1-6 — the complete server recap of an earlier turn is not a « recap the AI showed » for another address or name', () => {
  it('recapShown needs the address and the name of the call in the shown text', async () => {
    const { recapShown } = await import('./tools/order-confirmation');
    const shown = 'Voici le récapitulatif de votre commande :\n- 1 × Robe satin bordeaux : 4 500 DA\n- Livraison à domicile (Bab Ezzouar, Alger) : 400 DA\nTotal : 4 900 DA, à payer à la livraison.\nNom : Amine Benali\nTéléphone : 0555123456\nAdresse : Cité des 200 logements, Bt 4, Bab Ezzouar, Alger';
    const base = { clientPhone: '0555123456', total: 4900, items: [{ name: 'Robe satin bordeaux' }] };
    expect(recapShown(shown, { ...base, address: 'Cité des 200 logements, Bt 4, Bab Ezzouar', clientName: 'Amine Benali' })).toBe(true);
    // « oui mais c'est le Bt 9 »
    expect(recapShown(shown, { ...base, address: 'Cité des 200 logements, Bt 9, Bab Ezzouar', clientName: 'Amine Benali' })).toBe(false);
    expect(recapShown(shown, { ...base, address: 'Cité des 200 logements, Bt 4, Bab Ezzouar', clientName: 'Sarah Benali' })).toBe(false);
  });
});

describe('R1-6 — amounts written with no-break spaces', () => {
  it('« 8 200 DA » with U+00A0 / U+202F reads as 8200', () => {
    const r = pendingRecap([{ name: 'create_order', result: recapResult() }])!;
    expect(recapComplete('Djellaba homme ×1 : 7\u00a0500 DA, livraison 700 DA, total 8\u202f200 DA. Samir Ben Ali, 0661234567.', r)).toBe(true);
  });
});
