// Journey retest R6 (17/11, docs/audit/journeys-2026-11-16/journeys/R6-ai-orders.md): a model sentence asking to confirm in
// front of the server recap, in new wordings (R6-1 — now an allow-list), photos announced that are not sent (R6-2), odd
// wording (R6-3), the recap address « …, Blida, Boufarik » (R6-4), tool probes (R6-5).
import { prisma } from '@djaber/db';
import { resetPlaceIndex } from './tools/place-index';
import { AiRunService, NO_ADDRESS_NOTE, noAddressYet, type TurnRequest } from './ai-run.service';
import { allowedHandoffReasons, judgeHandoff } from './handoff-judge';
import { fixMoroccan, wrongDarijaIn } from './language';
import { productBlock, catalogueSection } from './prompt/sections/catalogue';
import { languageSection } from './prompt/sections/contract';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply, enforceReply, guardInstruction, photoClaim, withToolResults } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderRecapText, pendingRecap, recapLeadIn, recapReply, withoutRecapClaims, withoutTrailingPlaces } from './tools/order-confirmation-text';
import { TOOL_DEFS, type ToolRegistry } from './tools/tool-registry';

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
const recapResult = (p: Record<string, unknown> = {}) => ({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd', core: 'c' }, recapToShow: true, recap: { items: [{ name: 'Djellaba homme', quantity: 1, unitPrice: 7500 }], deliveryFee: 450, total: 7950, clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilaya: 'Blida', wilayaAr: 'البليدة', communeName: 'Boufarik', communeAr: 'بوفاريك', address: 'Cité 20 août villa 3', isStopdesk: false, ...p } });
const recapOf = (p: Record<string, unknown> = {}) => pendingRecap([{ name: 'create_order', result: recapResult(p) }])!;

describe('R6-1 — before the server recap only a thank-you lead-in or an answer to the customer’s question stays', () => {
  // [flow, customer message, the model's text before the recap, what must stay ('' = the server recap alone), recap overrides, lang]
  const CASES: [string, string, string, string, Record<string, unknown>, string][] = [
    // R6 — the four failures
    ['R6 F5 T3', 'rue des frères Bouadou n 5', 'Merci Amina, j\'ai bien noté votre adresse. Pouvez-vous confirmer la commande en répondant oui ?', '', { clientName: 'Amina Saadi', address: 'rue des frères Bouadou n 5' }, 'fr'],
    ['R6 F8b T3', 'Pardon, c\'est 0555987654, Blida, Boufarik, cité 20 août villa 3', 'Merci Yacine, c\'est bien noté ! Pouvez-vous me confirmer la commande ci-dessus en répondant oui ?', '', {}, 'fr'],
    ['R6 F14 T1', 'slm, nheb djellaba homme wahda, smiti Karim Haddad 0770112233, Setif El Eulma cite 500 logements bloc 12', 'Ktb "oui" bach nkammlou la commande.', '', { clientName: 'Karim Haddad' }, 'arabizi'],
    ['R6 N9 T2', '3jbatni, nedi taille M. Amina Saadi 0698765432, Alger, Bab Ezzouar, rue des frères Bouadou n 5', 'Saha Amina, la commande t7adret.', '', { clientName: 'Amina Saadi' }, 'arabizi'],
    // R6 — the lead-ins that passed (they stay), N10's internal « au-delà du stock » (now said by the server recap)
    ['R6 N3 T3', 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5', 'Ih, nwasslou l Constantine. Tawsil l dar: 700 DA.', 'Ih, nwasslou l Constantine. Tawsil l dar: 700 DA.', { clientName: 'Samira Benali', total: 6300, deliveryFee: 700, items: [{ name: 'Tapis de prière', quantity: 2, unitPrice: 2800 }] }, 'arabizi'],
    ['R6 F11 T2', 'Lamia Touati, 0550123456, Alger, Bab Ezzouar, rue des frères Bouadou n 5', 'Merci Lamia !', 'Merci Lamia !', { clientName: 'Lamia Touati' }, 'fr'],
    ['R6 F1b T3', 'Cité 500 logements bloc 12', 'Merci Karim !', 'Merci Karim !', { clientName: 'Karim Haddad' }, 'fr'],
    ['R6 F4 T2', '2 please, John Benali 0555987654, Oran, Bir El Djir, cité 1000 logements', 'Thanks John!', 'Thanks John!', { clientName: 'John Benali' }, 'en'],
    ['R6 N4 T3', '0661234567, Blida, Boufarik, cité 20 août villa 3', 'Merci Samir !', 'Merci Samir !', { clientName: 'سمير بن علي' }, 'fr'],
    ['R6 N5 T4', 'Bon finalement je le prends. Karim Haddad 0770112233, Oran, Bir El Djir, cité 1000 logements bloc 4', 'Merci Karim !', 'Merci Karim !', { clientName: 'Karim Haddad' }, 'fr'],
    ['R6 N10 T3', 'Bon d\'accord, je la prends quand même. Karim Haddad 0770112233, Sétif, El Eulma, cité 500 logements bloc 12', 'Petite précision : la montre peut prendre un peu plus de temps à livrer, car elle est commandée au-delà du stock.', '', { clientName: 'Karim Haddad' }, 'fr'],
    // R5
    ['R5 F8 T4', 'Pardon, c\'est 0555987654, Blida, Boufarik, cité 20 août villa 3', 'Parfait Yacine, merci !', 'Parfait Yacine, merci !', {}, 'fr'],
    ['R5 N4 T3', '0661234567, Blida, Boufarik, cité 20 août villa 3', 'Parfait, merci Samir !', 'Parfait, merci Samir !', { clientName: 'سمير بن علي' }, 'fr'],
    // R4
    ['R4 F3b T7', 'cite 20 aout villa 3', 'Wach t7ebb nakked l commande ? (yes / le)', '', { clientName: 'Walid Bouzid' }, 'arabizi'],
    ['R4 N3 T3', 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5', 'Iyeh, nwasslouhom l Constantine (El Khroub), livraison 700 DA l dar, ywasslou f 2 l 5 ayam.', 'Iyeh, nwasslouhom l Constantine (El Khroub), livraison 700 DA l dar, ywasslou f 2 l 5 ayam.', { clientName: 'Samira Benali', total: 6300, deliveryFee: 700, items: [{ name: 'Tapis de prière', quantity: 2, unitPrice: 2800 }] }, 'arabizi'],
    // R3 / R2 (the deny-list cases stay covered)
    ['R3 F11 T3', 'Alger, Bab Ezzouar, rue des frères Bouadou n 5', 'Merci Lamia ! Votre commande est prête à être confirmée, le récapitulatif va vous être envoyé.', 'Merci Lamia !', { clientName: 'Lamia Touati' }, 'fr'],
    ['R3 F4 T6', 'cité 1000 logements', 'Thanks John, I have everything for your order.', '', { clientName: 'John Benali' }, 'en'],
    ['R3 F7 T6', 'لا غير زيدلي واحد، ديرهم جوج', 'تمام يا نادية، بدلنا الطلبية لـ 2 حجاب سوا. استني تأكيدك بـ « إيه » باش نسجلوها.', '', { clientName: 'نادية قاسي' }, 'ar'],
    ['R3 N3p T2', 'ana f Constantine El Khroub, cité 1000 logements bloc 5, ch7al tawsil khouya ?', 'Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam. Recap ydhher dork, t7ebb nkamlouh b confirmation ?', 'Tawsil l Constantine (El Khroub) l dar: 700 DA, wela 450 DA f stop-desk, ywasel f 2 l 5 ayam.', { total: 6300, deliveryFee: 700 }, 'arabizi'],
    ['R2 F5 T6', 'rue des frères Bouadou n 5', 'Merci Amina, j\'ai bien noté l\'adresse : rue des frères Bouadou n 5, Bab Ezzouar. Répondez « oui » pour confirmer la commande.', '', { clientName: 'Amina Saadi', address: 'rue des frères Bouadou n 5' }, 'fr'],
    ['R2 F7 T6', 'لا غير زيدلي واحد، ديرهم جوج', 'تمام، زدنا حجاب واحد، ولّى المجموع 2 حجاب. الطلبية الجديدة تحل محل TEST-6619، وبعد ما تأكدها نلغي القديمة.', '', {}, 'ar'],
    ['R2 F8 T7', 'cité 20 août villa 3', 'Merci Yacine, votre adresse est bien notée. Répondez oui pour confirmer la commande.', '', {}, 'fr'],
  ];
  it.each(CASES)('%s', (_id, customer, lead, stays, p, lang) => {
    const recap = recapOf(p);
    const server = orderRecapText(recap, lang);
    expect(recapReply(lead, recap, lang, customer).text).toBe(stays ? `${stays}\n\n${server}` : server);
    // the model's own recap after its lead-in changes nothing
    expect(recapReply(`${lead}\n\n${server}`, recap, lang, customer).text).toBe(stays ? `${stays}\n\n${server}` : server);
  });
  it.each([
    'Pouvez-vous confirmer en répondant oui ?', 'Can you confirm by replying yes?', 'Vérifiez le récapitulatif ci-dessous.', 'Confirmez-moi svp.', 'Écrivez oui pour valider.', 'Type yes and we ship it.', 'Ktbli ih ila kolchi mli7.', 'Goulli ih w nkemlou.',
    'جاوب بـ نعم.', 'اكتبلي إيه باش نكملو.', 'C\'est bon pour vous ?', 'Tout est bon ?', 'Is everything correct?', 'Voilà, c\'est prêt !', 'Rani wajedtelek kolchi.', 'Saha, kolchi wajed.', 'J\'ai tout noté.', 'Noted!', 'Dites « oui » et c\'est parti.', 'Ih wela la ?',
  ])('« %s » never stays (whatever the customer asked)', (lead) => {
    expect(recapLeadIn(lead, recapOf(), 'Vous livrez à Blida ? c\'est combien la livraison ?')).toEqual([]);
  });
  it('an answer stays only when the customer asked something, carries content and repeats nothing of the recap', () => {
    const asked = 'Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3. Elle est en quelle matière ? vous livrez quand ?';
    expect(recapLeadIn('Elle est en laine fine. La livraison prend 2 à 5 jours.', recapOf(), asked)).toEqual(['Elle est en laine fine.', 'La livraison prend 2 à 5 jours.']);
    expect(recapLeadIn('Oui, on livre à Blida, en 2 à 5 jours.', recapOf(), 'vous livrez à Blida ?')).toEqual(['Oui, on livre à Blida, en 2 à 5 jours.']);
    expect(recapLeadIn('إيه، نوصلو للبليدة.', recapOf(), 'واش توصلو للبليدة ؟')).toEqual(['إيه، نوصلو للبليدة.']);
    // no question in the message ⇒ no « answer »
    expect(recapLeadIn('Elle est en laine fine.', recapOf(), 'Yacine Mansouri 0555987654, Blida, Boufarik, cité 20 août villa 3')).toEqual([]);
    // the model's recap lines: the total, an item amount, the phone, the address, a bullet
    for (const line of ['Total : 7 950 DA.', 'La djellaba est à 7500 DA.', 'Votre numéro : 0555987654.', 'Livraison à Cité 20 août villa 3, Boufarik.', '- 1 × Djellaba homme']) expect(recapLeadIn(line, recapOf(), asked)).toEqual([]);
  });
  it('a thank-you before a request keeps only the thank-you', () => expect(recapLeadIn('Merci ! Vérifiez le récapitulatif ci-dessous.', recapOf(), 'Vous livrez à Blida ?')).toEqual(['Merci !']));
  it('a lead-in is short: more than 2 sentences kept ⇒ the server recap alone', () => {
    const r = recapReply('Merci Yacine ! Elle est en laine fine. La livraison prend 2 à 5 jours.', recapOf(), 'fr', 'Yacine Mansouri, Blida, Boufarik, cité 20 août villa 3. Matière ? Délai ?');
    expect(r).toEqual({ text: orderRecapText(recapOf(), 'fr'), kept: 'server' });
  });
  it('the turn: the R6 F5 reply goes out as the server recap alone; N3’s delivery line stays', async () => {
    const run = async (customerText: string, reply: string, p: Record<string, unknown> = {}) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', { toolCalls: [{ name: 'create_order', args: { clientName: 'Amina Saadi' } }] }, { reply, intent: 'SALE' });
      const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn(async () => recapResult(p)) } as unknown as ToolRegistry;
      const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
      const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: customerText }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText, customerHistory: `smiti Amina Saadi 0698765432, wilaya Alger, Bab Ezzouar\n${customerText}` }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
      const r = await svc.turn(req);
      return r.ok ? r.output.reply : '';
    };
    const f5 = { clientName: 'Amina Saadi', address: 'rue des frères Bouadou n 5', wilaya: 'Alger', communeName: 'Bab Ezzouar' };
    expect(await run('rue des frères Bouadou n 5', 'Merci Amina, j\'ai bien noté votre adresse. Pouvez-vous confirmer la commande en répondant oui ?', f5)).toBe(orderRecapText(recapOf(f5), 'fr'));
    expect(await run('vous livrez à Bab Ezzouar ? rue des frères Bouadou n 5', 'Oui, on livre à Bab Ezzouar. Pouvez-vous confirmer la commande en répondant oui ?', f5)).toBe(`Oui, on livre à Bab Ezzouar.\n\n${orderRecapText(recapOf(f5), 'fr')}`);
  });
  it('a handoff answer drops the R6 wordings too', () => {
    expect(withoutRecapClaims('Un conseiller vous répond. Pouvez-vous confirmer la commande en répondant oui ?')).toBe('Un conseiller vous répond.');
    expect(withoutRecapClaims('Ktb "oui" bach nkammlou. L’équipe tjawbek.')).toBe('L’équipe tjawbek.');
    expect(withoutRecapClaims('Saha, la commande t7adret. L’équipe tjawbek.')).toBe('L’équipe tjawbek.');
  });
});

describe('R6-2 — photos are announced only when they are sent', () => {
  const product = (id: string, name: string, imageUrl: string | null) => ({ id, name, sku: id.toUpperCase(), price: 4900, oldPrice: null, hasVariants: false, variants: [], also: [], description: null, stock: 5, sellOutOfStock: false, imageUrl });
  const products = [product('robe', 'Robe kabyle brodée', null), product('tapis', 'Tapis de prière', null), product('sac', 'Sac à main cuir', 'https://cdn/sac.webp')];
  const facts = (customerText: string, photoSent?: boolean) => ({ ...buildGuardFacts({ lang: 'arabizi', products, shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Karima', customerText, answeredBefore: false, freshStart: true }), ...(photoSent !== undefined ? { photoSent } : {}) });
  const N9_C = 'Salam, ab3athli tswira ta3 la robe kabyle brodée w 9olli ktar 3liha : le tissu, les tailles ?';
  const N9_AI = 'Hak tsawer ta3 la robe kabyle brodée. Robe brodée bil yed f tissu khfif (léger), mliha lel fêtes. Tailles kayen: S, M w XL. T7ebb tkhtar wahda menhom ?';

  it.each(['Hak tsawer ta3 la robe kabyle brodée.', 'Hak tsawer ta3 tapis de prière.', 'Voici les photos du sac.', 'Je vous envoie la photo tout de suite.', 'Les photos sont ci-dessous.', 'Here are the pictures!', "I'm sending you the photos.", 'هاهي التصاور تاع الروبة.', 'راني نبعثلك الصور.', 'Rani nab3atlek tsawer.'])('« %s » announces photos', (s) => expect(photoClaim(s)).toBe(true));
  it.each(['Ma 3andnach tsawer ta3ha f had lwaqt.', 'Nous n’avons pas encore de photo de ce produit.', 'Envoyez-moi la photo du modèle.', 'ما عندناش تصاور تاعو درك.', 'La photo est sur la fiche du produit.', 'No photos yet, sorry.'])('« %s » does not', (s) => expect(photoClaim(s)).toBe(false));
  it('the catalogue facts know which products have no photo; a tool result adds or removes one', () => {
    expect(facts(N9_C).noPhoto).toEqual(['robe', 'tapis']);
    const f = withToolResults(facts(N9_C), [{ products: [{ id: 'montre', name: 'Montre connectée', imageUrl: null }, { id: 'robe', name: 'Robe kabyle brodée', imageUrl: 'https://cdn/robe.webp' }] }]);
    expect(f.noPhoto).toEqual(['tapis', 'montre']);
  });
  it('N9 T1 / F3b T2: flagged when nothing with a photo is sent, with the instruction; clean when the photo is sent; unchecked without the answer', () => {
    const v = checkReply(N9_AI, facts(N9_C, false)).filter((x) => x.rule === 'photo_claim');
    expect(v).toEqual([{ rule: 'photo_claim', sentence: 0 }]);
    expect(guardInstruction(v, facts(N9_C, false))).toContain('NO PHOTO IS SENT with this answer');
    expect(checkReply(N9_AI, facts(N9_C, true)).map((x) => x.rule)).not.toContain('photo_claim');
    expect(checkReply(N9_AI, facts(N9_C)).map((x) => x.rule)).not.toContain('photo_claim');
  });
  it('the corrective turn kept it ⇒ the sentence is dropped, the details stay', () => {
    const f = facts(N9_C, false);
    const e = enforceReply(N9_AI, checkReply(N9_AI, f), f, { hasCards: true });
    expect(e.reply).not.toMatch(/hak tsawer/i);
    expect(e.reply).toContain('tissu khfif');
  });
  it('the turn: a card of a product without photo ⇒ one corrective turn; a card of a product with a photo ⇒ none', async () => {
    const run = async (cards: string[], ...replies: string[]) => runWith(cards, {}, ...replies);
    const runWith = async (cards: string[], extra: Record<string, unknown>, ...replies: string[]) => {
      const gateway = new FakeAiGateway();
      gateway.script('reply', ...replies.map((reply) => ({ reply, intent: 'INFO', productCards: cards })));
      const tools = { defsFor: async () => [TOOL_DEFS.get_product], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
      const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
      const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: N9_C }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: N9_C, customerHistory: N9_C }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false, guard: { ...facts(N9_C), ...extra } };
      const r = await svc.turn(req);
      return { reply: r.ok ? r.output.reply : '', calls: gateway.calls.length, guard: r.ok ? r.guard : undefined };
    };
    const fixed = 'Ma 3andnach tsawer ta3ha f had lwaqt. Robe brodée bil yed f tissu khfif (léger). Tailles kayen: S, M w XL.';
    const a = await run(['robe'], N9_AI, fixed);
    expect(a.calls).toBe(2);
    // (journey retest R18-2: the price of the product the card shows, never told yet, is added)
    expect(a.reply).toBe(`${fixed} Robe kabyle brodée b 4\u00a0900\u00a0DA.`);
    const b = await run(['sac'], 'Hak tsawer ta3 sac à main cuir. Kayen f noir w marron.');
    expect(b.calls).toBe(1);
    expect(b.guard).toBeUndefined();
    // « Plus de photos » tapped (pipeline PV 09/11): the gallery goes out whatever the answer — « Hahom tsawer » is true
    const c = await runWith([], { galleries: ['sac'] }, 'Hahom tsawer ta3 sac à main cuir.');
    expect(c.calls).toBe(1);
    expect(c.reply).toBe('Hahom tsawer ta3 sac à main cuir. Sac à main cuir b 4\u00a0900\u00a0DA.');
  });
  it('the prompt: PHOTO:none on the product line, the PHOTOS rule, the arabizi wording only when photos are sent', () => {
    const p = { ...products[0]!, imageKey: null, category: null } as never;
    expect(productBlock(p, 1, 200).split('\n')[0]).toMatch(/STOCK:in stock PHOTO:none$/);
    expect(productBlock({ ...products[2]!, imageKey: 'k', category: null } as never, 1, 200)).not.toContain('PHOTO:none');
    const section = catalogueSection({ catalogue: { full: true, count: 1, products: [p] }, workspace: { systemMessages: {} }, agent: { outOfStockBehavior: 'say', showMissingVariants: false }, lang: 'fr', locale: 'fr', descriptionMax: 200 } as never);
    expect(section).toContain('PHOTOS: a product has photos only when its line has no PHOTO:none');
    expect(languageSection({ lang: 'arabizi', agent: { language: 'fr' } } as never)).toContain('photos « Hak tsawer ta3ou » (only when its photos are sent; PHOTO:none ⇒ « Ma 3andnach tsawer ta3ou f had lwaqt »)');
  });
});

describe('R6-3 — odd wording', () => {
  it('F3b T1 « Wach t7ebb nchouf wahed mennhom ? » ⇒ « nwarrik »; « nchouflek » (I check for you) stays', () => {
    expect(wrongDarijaIn('Wach t7ebb nchouf wahed mennhom ?')).toBe(true);
    expect(fixMoroccan('Wach t7ebb nchouf wahed mennhom ?')).toBe('Wach t7ebb nwarrik wahed mennhom ?');
    expect(wrongDarijaIn('T7ebb nchouflek m3a l’équipe ?')).toBe(false);
  });
  it('F2 T1 « فالصوف الفاين » ⇒ « فالصوف الرقيق »; F3b T2 « nwasslouk l\'commande » ⇒ « nwassloulek la commande »', () => {
    expect(fixMoroccan('عندنا Djellaba homme فالصوف الفاين، لونها بيج')).toBe('عندنا Djellaba homme فالصوف الرقيق، لونها بيج');
    expect(fixMoroccan('Wach men wilaya t7ebb nwasslouk l\'commande ?')).toBe('Wach men wilaya t7ebb nwassloulek la commande ?');
    expect(wrongDarijaIn('صوف رقيق، مقاس واحد')).toBe(false);
  });
  it('N10 T3: the server recap says the beyond-stock delay in plain words; the prompt forbids « au-delà du stock »', () => {
    const r = recapOf({ items: [{ name: 'Montre connectée', quantity: 1, unitPrice: 15900 }], total: 16550, deliveryFee: 650, beyondStock: [{ name: 'Montre connectée', quantity: 1 }] });
    const fr = orderRecapText(r, 'fr').split('\n');
    expect(fr.at(-2)).toBe('Une partie de la commande peut prendre un peu plus de temps à être livrée.');
    expect(orderRecapText(r, 'arabizi')).toContain('Juz2 men la commande ymken yt3atel chwiya f tawsil.');
    expect(orderRecapText(recapOf(), 'fr')).not.toContain('plus de temps');
    expect(productBlock({ id: 'm', name: 'Montre connectée', sku: 'M', price: 15900, oldPrice: null, stock: 0, sellOutOfStock: true, description: null, hasVariants: false, variants: [], imageUrl: 'u', imageKey: 'k', category: null, also: [] }, 1, 100)).toContain('never « au-delà du stock »');
  });
});

describe('R6-4 — the recap address keeps « commune, wilaya » in that order', () => {
  it('N4 T3: « Cité 20 août villa 3, Blida » + Boufarik ⇒ « Cité 20 août villa 3, Boufarik, Blida »', () => {
    expect(orderRecapText(recapOf({ address: 'Cité 20 août villa 3, Blida' }), 'fr')).toContain('Adresse : Cité 20 août villa 3, Boufarik, Blida');
    expect(orderRecapText(recapOf({ address: 'Cité 20 août villa 3, Blida, Boufarik' }), 'fr')).toContain('Adresse : Cité 20 août villa 3, Boufarik, Blida');
    // as every other recap of R6
    expect(orderRecapText(recapOf({ address: 'Cité 20 août villa 3' }), 'fr')).toContain('Adresse : Cité 20 août villa 3, Boufarik, Blida');
    expect(orderRecapText(recapOf({ address: 'Cité 20 août villa 3, Boufarik' }), 'fr')).toContain('Adresse : Cité 20 août villa 3, Boufarik, Blida');
    expect(orderRecapText(recapOf({ address: 'حي الورود رقم 12، بوفاريك، البليدة' }), 'ar')).toContain('العنوان: حي الورود رقم 12، بوفاريك، البليدة');
  });
  it('a place name not after a comma, and the first segment, are kept', () => {
    expect(withoutTrailingPlaces('Rue de Boufarik', ['Boufarik', 'Blida'])).toBe('Rue de Boufarik');
    expect(withoutTrailingPlaces('Blida', ['Blida'])).toBe('Blida');
    expect(withoutTrailingPlaces('Cité 500 logements bloc 12, El Eulma, Setif', ['El Eulma', 'Sétif'])).toBe('Cité 500 logements bloc 12');
  });
});

describe('R6-5 — no probe calls', () => {
  it('N3 T3: the keyword reason is offered only when a keyword is in the customer’s message', () => {
    const agent = { humanHandoffRules: null, handoffKeywords: ['remboursement', 'arnaque'] };
    expect(allowedHandoffReasons(agent, 0, 'khouya twasslou l Constantine ? ana f El Khroub, cité 1000 logements bloc 5')).not.toContain('keyword');
    expect(allowedHandoffReasons(agent, 0, 'c\'est une arnaque !')).toContain('keyword');
    // without the message (older callers) the agent's keywords decide, as before
    expect(allowedHandoffReasons(agent)).toContain('keyword');
    // the judge agrees with the offer
    expect(judgeHandoff({ reason: 'keyword', customerText: 'c\'est une arnaque !', keywords: agent.handoffKeywords }).ok).toBe(true);
  });
  it('F1b T2: no street address / stop-desk word yet ⇒ the note; a cité, a stop-desk, a recap already shown ⇒ none', () => {
    const f1b = 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233\nSétif, El Eulma';
    expect(noAddressYet({ customerHistory: f1b })).toBe(true);
    expect(noAddressYet({ customerHistory: `${f1b}\nCité 500 logements bloc 12` })).toBe(false);
    expect(noAddressYet({ customerHistory: `${f1b}\nf stop desk` })).toBe(false);
    expect(noAddressYet({ customerHistory: 'السلام، نحب جلابة رجالي، سمير بن علي 0661234567، قسنطينة، الخروب، حي 1000 مسكن عمارة 5' })).toBe(false);
    expect(noAddressYet({ customerHistory: f1b, orderHistory: [{ name: 'create_order', result: recapResult(), at: new Date() }] })).toBe(false);
    expect(noAddressYet({})).toBe(false);
  });
  it('the turn: the note after the phone when no address is given; create_order stays offered', async () => {
    const gateway = new FakeAiGateway();
    gateway.script('reply', { reply: 'Quelle est votre adresse à El Eulma ?', intent: 'SALE' });
    const tools = { defsFor: async () => [TOOL_DEFS.create_order], forcedHandoff: () => null, execute: jest.fn() } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    // journey retest R8-4: a message that only names the place gets no create_order at all (NO_STREET_NOTE); this one says more
    const history = 'Je voudrais le sac à main cuir marron, 1 seul. Karim Haddad 0770112233\nSétif, El Eulma, Les Pins 12';
    const req: TurnRequest = { runId: 'r', prompt: { system: 'S', messages: [{ role: 'user', content: 'Sétif, El Eulma, Les Pins 12' }] }, toolCtx: { workspaceId: 'w', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r', dryRun: true, customerText: 'Sétif, El Eulma, Les Pins 12', customerHistory: history }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
    await svc.turn(req);
    expect(gateway.calls[0]!.system).toContain(NO_ADDRESS_NOTE);
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
  });
});
