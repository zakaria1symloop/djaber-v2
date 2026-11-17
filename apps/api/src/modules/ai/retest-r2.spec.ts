// Journey retest R2 (17/11, docs/audit/journeys-2026-11-16/journeys/R2-ai-orders.md): Moroccan forms (R2-1), an address that
// is only the commune (R2-2), replies contradicting the customer (R2-3), create_order probes and repeated calls (R2-4), the
// arabizi welcome (R2-5), the model's own call to action and Markdown before the server recap (R2-6), the Arabic recap (R2-7).
import { AiRunService, orderClosedBy, type TurnRequest } from './ai-run.service';
import { fieldOnlyMessage } from './handoff-judge';
import { fixMoroccan, moroccanIn, systemLang, systemLocale } from './language';
import { FakeAiGateway } from './provider/fake-ai.gateway';
import { buildGuardFacts, checkReply, enforceReply, fieldClaims, givenFields, stripMarkdown, type GuardFacts } from './reply-guard';
import type { RoutedModel } from './routing.service';
import { orderRecapText, pendingRecap, recapReply } from './tools/order-confirmation-text';
import { communeAr, matchWilaya, placeOnlyAddress, wilayaNamed, type ToolRegistry } from './tools/tool-registry';

const WILAYAS = [
  { id: 1, code: '01', nameFr: 'Adrar', nameAr: 'أدرار' },
  { id: 9, code: '09', nameFr: 'Blida', nameAr: 'البليدة' },
  { id: 16, code: '16', nameFr: 'Alger', nameAr: 'الجزائر' },
  { id: 19, code: '19', nameFr: 'Sétif', nameAr: 'سطيف' },
  { id: 25, code: '25', nameFr: 'Constantine', nameAr: 'قسنطينة' },
];

describe('R2-1 — Moroccan forms in an arabizi reply', () => {
  it.each(['Ila iyeh, sift-li l’adresse (rue + rqam dar).', "sift'li l'adresse", 'Ach numéro ta3ek bach nkamlou commande ?', 'Mezyan, Boufarik f Blida.', 'Issa, ab3atli l’adresse.', 'nsiftlek la photo', 'achnou t7ebb ?'])('flagged: « %s »', (t) => expect(moroccanIn(t)).toBe(true));
  it.each(['Wach numéro ta3ek ?', 'kifach nkamlou ?', '3lach ?', 'bach nkamlou commande', 'Merci Issa, wach men wilaya ?', 'Saha Issa', 'Karim Meziane', "l'adresse ta3ek", 'stop-desk 300 DA', "c'est noté", 'goulli-li wach t7ebb'])('Algerian / no Moroccan word: « %s »', (t) => expect(moroccanIn(t)).toBe(false));
  it('replaced by the Algerian words (hyphenated forms joined first)', () => {
    expect(fixMoroccan('Mezyan, Boufarik f Blida. Issa, sift-li l’adresse (rue + numéro ta3 dar) bach nkamlou commande.')).toBe('Mlih, Boufarik f Blida. Dork, ab3atli l’adresse (rue + numéro ta3 dar) bach nkamlou commande.');
    expect(fixMoroccan('Ach numéro ta3ek ? Ila iyeh, sift-li l’adresse.')).toBe('Wach numéro ta3ek ? Ila iyeh, ab3atli l’adresse.');
    expect(fixMoroccan("Merci Issa, c'est noté : stop-desk.")).toBe("Merci Issa, c'est noté : stop-desk.");
    expect(moroccanIn(fixMoroccan('Mezyan, Boufarik f Blida. Issa, sift-li l’adresse. Ach numéro ?'))).toBe(false);
  });
  it('the reply guard flags them in an arabizi reply and the server replaces them', () => {
    const f = buildGuardFacts({ lang: 'arabizi', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique de Nassim', customerText: 'Boufarik', answeredBefore: true, freshStart: false });
    const reply = 'Mezyan, Boufarik f Blida. Issa, sift-li l’adresse bach nkamlou commande.';
    const v = checkReply(reply, f);
    expect(v.map((x) => x.rule)).toContain('moroccan_darija');
    expect(enforceReply(reply, v, f, { hasCards: false }).reply).toBe('Mlih, Boufarik f Blida. Dork, ab3atli l’adresse bach nkamlou commande.');
  });
});

describe('R2-2 — a home address that is only the commune / wilaya', () => {
  const alger = ['Alger', 'الجزائر', 'Bab Ezzouar', 'باب الزوار', 'El Harrach', 'الحراش'];
  it.each(['Bab Ezzouar', 'Bab Ezzouar, Alger', 'bab ezzouar 16000', 'El Harrach centre-ville', 'Harrach', 'wilaya d’Alger, commune de Bab Ezzouar'])('only a place: « %s »', (a) => expect(placeOnlyAddress(a, alger, 16)).toBe(true));
  it.each(['rue des frères Bouadou n 5', 'Bab Ezzouar, cité 2000 logements bt 4', 'près de la mairie, Bab Ezzouar', 'حي 1000 مسكن عمارة 5'])('an address: « %s »', (a) => expect(placeOnlyAddress(a, alger, 16)).toBe(false));
  it('Arabic script and the article of the commune', () => {
    expect(placeOnlyAddress('الخروب، قسنطينة', ['Constantine', 'قسنطينة', 'El Khroub', 'الخروب'], 25)).toBe(true);
    expect(placeOnlyAddress('Eulma', ['Sétif', 'سطيف', 'El Eulma', 'العلمة'], 19)).toBe(true);
    expect(placeOnlyAddress('Cité 500 logements bloc 12', ['Sétif', 'سطيف', 'El Eulma', 'العلمة'], 19)).toBe(false);
  });
});

describe('R2-3 — never deny a field the customer just gave', () => {
  const facts = (customerText: string, lang: 'fr' | 'ar' | 'arabizi' = 'fr', customerFields?: GuardFacts['customerFields']): GuardFacts => ({
    ...buildGuardFacts({ lang, products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique', customerText, answeredBefore: true, freshStart: false }),
    ...(customerFields ? { customerFields } : {}),
  });
  it('claims read in fr / ar / arabizi / en', () => {
    expect(fieldClaims('Merci Walid, rani nestanna numéro ta3ek.')).toEqual([{ kind: 'awaiting', field: 'phone' }]);
    expect(fieldClaims('عفوًا سمير، ما فهمتش الولاية.')).toEqual([{ kind: 'not_understood', field: 'wilaya' }]);
    expect(fieldClaims("Désolé, je n'ai pas bien compris votre adresse.")).toEqual([{ kind: 'not_understood', field: 'address' }]);
    expect(fieldClaims("Sorry, I didn't catch your phone number.")).toEqual([{ kind: 'not_understood', field: 'phone' }]);
    expect(fieldClaims('Dans quelle wilaya souhaitez-vous être livré ?')).toEqual([]);
  });
  it('given fields: a valid phone, a wilaya name, the answer’s own values written in the message', () => {
    expect([...givenFields('0770112244')]).toEqual(['phone']);
    expect([...givenFields('قسنطينة')]).toEqual(['wilaya']);
    expect([...givenFields('smiti Walid Bouzid', { name: 'Walid Bouzid' })]).toEqual(['name']);
    expect([...givenFields('05559876')]).toEqual([]);
  });
  it('F3b T4 / F2 T3: the contradicting sentence is flagged, then dropped', () => {
    const f3b = facts('0770112244', 'arabizi');
    const reply = 'Merci Walid, rani nestanna numéro ta3ek. Dork, f ayya wilaya t7ebb nab3atlek l commande ?';
    const v = checkReply(reply, f3b);
    expect(v).toContainEqual({ rule: 'contradicts_customer', sentence: 0 });
    expect(enforceReply(reply, v, f3b, { hasCards: false }).reply).toBe('Dork, f ayya wilaya t7ebb nab3atlek l commande ?');
    const f2 = facts('0661234567', 'ar');
    const ar = 'عفوًا سمير، ما فهمتش الولاية. واش هي الولاية متاعك؟ (مثال: الجزائر)';
    const v2 = checkReply(ar, f2);
    expect(v2.map((x) => x.rule)).toContain('contradicts_customer');
    // journey retest R5-2: the Tunisian « متاعك » of this R2 transcript is flagged too, and becomes « تاعك »
    expect(v2.map((x) => x.rule)).toContain('moroccan_darija');
    expect(enforceReply(ar, v2, f2, { hasCards: false }).reply).toBe('واش هي الولاية تاعك؟ (مثال: الجزائر)');
  });
  it('not flagged: a field really not understood, waiting for another field, a wrong phone', () => {
    expect(checkReply("Je n'ai pas compris la wilaya, pouvez-vous la préciser ?", facts('Bab')).map((x) => x.rule)).not.toContain('contradicts_customer');
    expect(checkReply("Merci Karim ! J'attends votre numéro de téléphone pour continuer.", facts('Karim Haddad', 'fr', { name: 'Karim Haddad' })).map((x) => x.rule)).not.toContain('contradicts_customer');
    expect(checkReply("Le numéro semble incomplet, je n'ai pas compris votre numéro : pouvez-vous le vérifier ?", facts('05559876')).map((x) => x.rule)).not.toContain('contradicts_customer');
  });
});

describe('R2-4 — create_order probes', () => {
  it('a wilaya is named by the customer (official name, Arabic name, spelling, « wilaya 16 », a commune of it), never by default', () => {
    expect(matchWilaya(WILAYAS, 'pour Sétif svp')?.id).toBe(19);
    expect(wilayaNamed(WILAYAS, 1, 'Je voudrais le sac\nKarim Haddad\n0770112233')).toBe(false);
    expect(wilayaNamed(WILAYAS, 19, 'Karim\n0770112233\nSétif')).toBe(true);
    expect(wilayaNamed(WILAYAS, 25, 'اسمي سمير\n0661234567\nقسنطينة')).toBe(true);
    expect(wilayaNamed(WILAYAS, 16, 'wilaya 16 svp')).toBe(true);
    expect(wilayaNamed(WILAYAS, 1, 'Karim\n1\n0770112233')).toBe(false);
    expect(wilayaNamed(WILAYAS, 16, 'Bab Ezzouar, rue 5', { given: 'Bab Ezzouar', ofWilaya: [{ nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار' }] })).toBe(true);
    expect(wilayaNamed(WILAYAS, 1, 'Bab Ezzouar, rue 5', { given: 'Bab Ezzouar', ofWilaya: [{ nameFr: 'Timimoun', nameAr: 'تيميمون' }] })).toBe(false);
  });
  it('create_order is withdrawn for the turn after an answer for good', () => {
    expect(orderClosedBy('create_order', { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } })).toBe(true);
    expect(orderClosedBy('create_order', { ok: false, error: { code: 'VALIDATION', field: 'wilayaId', missing: true } })).toBe(true);
    expect(orderClosedBy('create_order', { ok: true, number: 'TEST-1' })).toBe(true);
    expect(orderClosedBy('create_order', { ok: false, error: { code: 'VARIANT_REQUIRED' } })).toBe(false);
    expect(orderClosedBy('create_order', { ok: false, error: { code: 'VALIDATION', field: 'clientPhone', example: '0555123456' } })).toBe(false);
    expect(orderClosedBy('quote_delivery', { ok: true })).toBe(false);
  });
  it('a name message is field-only (no handoff tool), ordering or not', () => {
    expect(fieldOnlyMessage('اسمي سمير بن علي', false)).toBe(true);
    expect(fieldOnlyMessage('smiti Walid Bouzid', false)).toBe(true);
    expect(fieldOnlyMessage("je m'appelle Karim, je veux parler à un humain", false)).toBe(false);
  });

  const model = { id: 'm1', providerId: 'p1', provider: 'anthropic', modelId: 'claude-haiku-5-5', label: 'Haiku', contextTokens: null, supportsTools: true, inputPricePerM: 1, outputPricePerM: 5, ref: { provider: 'anthropic', modelId: 'claude-haiku-5-5' } } as unknown as RoutedModel;
  const DEFS = ['quote_delivery', 'create_order', 'search_products'].map((name) => ({ name, description: '', parameters: {} }));
  const setup = (gateway: FakeAiGateway, result: (name: string) => unknown) => {
    const routing = { call: async <T>(_c: unknown, fn: (m: RoutedModel, t: number) => Promise<T>) => ({ value: await fn(model, 20_000), model, usedFallback: false }) };
    const execute = jest.fn(async (name: string) => result(name));
    const tools = { defsFor: async () => DEFS, forcedHandoff: () => null, execute } as unknown as ToolRegistry;
    const svc = new AiRunService(gateway, routing as never, tools, {} as never, {} as never, {} as never);
    const req: TurnRequest = { runId: 'r1', prompt: { system: 'SYSTEM', messages: [{ role: 'user', content: 'Oran' }] }, toolCtx: { workspaceId: 'w1', agent: { humanHandoffRules: '', handoffKeywords: [] } as never, conversationId: null, clientId: null, channelId: null, runId: 'r1', dryRun: true, customerText: 'Oran', ordering: true }, temperature: 0.5, maxTokens: 500, deadline: Date.now() + 30_000, persist: false };
    return { svc, req, execute };
  };
  it('the same call twice in a turn runs once; after its refusal create_order is no longer offered', async () => {
    const gateway = new FakeAiGateway();
    const args = { clientName: 'John', clientPhone: '0555987654', wilayaId: 1, items: [{ productId: 'p1', quantity: 2 }], customerConfirmed: true };
    gateway.script('reply', { toolCalls: [{ name: 'create_order', args }, { name: 'create_order', args }] }, { toolCalls: [{ name: 'search_products', args: { query: 'hijab' } }] }, { reply: 'Dans quelle wilaya êtes-vous ?', intent: 'SALE' });
    const { svc, req, execute } = setup(gateway, (n) => (n === 'create_order' ? { ok: false, error: { code: 'VALIDATION', field: 'wilayaId', missing: true, fields: ['wilayaId'] } } : { products: [] }));
    const t = await svc.turn(req);
    expect(t.ok && t.output.reply).toBe('Dans quelle wilaya êtes-vous ?');
    expect(execute.mock.calls.map((c) => c[0])).toEqual(['create_order', 'search_products']);
    expect((gateway.calls[0]!.tools ?? []).map((d) => d.name)).toContain('create_order');
    expect((gateway.calls[1]!.tools ?? []).map((d) => d.name)).toEqual(['quote_delivery', 'search_products']);
  });
});

describe('R2-5 — the system texts of an arabizi customer', () => {
  it('Arabic in a darija shop, French in a French / English shop', () => {
    expect(systemLocale('arabizi', 'fr', 'darija')).toBe('ar');
    expect(systemLocale('arabizi', 'fr', 'arabizi')).toBe('ar');
    expect(systemLocale('arabizi', 'ar', 'fr')).toBe('fr');
    expect(systemLocale('arabizi', 'ar', null)).toBe('ar');
    expect(systemLocale('arabizi', 'fr', 'kabyle')).toBe('fr');
    expect(systemLocale('arabizi', 'en', null)).toBe('fr');
    expect(systemLocale('arabizi')).toBe('fr');
    expect([systemLang('arabizi', 'darija', 'fr'), systemLang('arabizi', 'fr', 'ar'), systemLang('fr', 'darija', 'ar')]).toEqual(['ar', 'fr', 'fr']);
  });
});

describe('R2-6 / R2-7 — the text before the server recap, Markdown, the Arabic recap', () => {
  const recapOf = (p: Record<string, unknown>) =>
    pendingRecap([{ name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED' }, recapToShow: true, recap: { items: [{ name: 'Djellaba homme', variant: null, quantity: 1, unitPrice: 7500 }], deliveryFee: 450, total: 7950, clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilaya: 'Blida', communeName: 'Boufarik', address: 'cité 20 août villa 3', isStopdesk: false, ...p } } }])!;
  it('F8 T7: the model’s « Répondez oui » is dropped, one call to action is left', () => {
    const r = recapReply('Merci Yacine, votre adresse est bien notée. Répondez oui pour confirmer la commande.', recapOf({}), 'fr');
    // journey retest R6-1: « votre adresse est bien notée » is neither a thank-you lead-in nor an answer — the allow-list drops it
    expect(r.kept).toBe('server');
    expect(r.text.startsWith('Voici le récapitulatif')).toBe(true);
    expect(r.text.match(/Répondez/g)).toHaveLength(1);
  });
  it('F5 T6: the address said again before the recap ⇒ the server recap alone', () => {
    const r = recapReply('Merci Amina, j’ai bien noté l’adresse : rue des frères Bouadou n 5, Bab Ezzouar. Répondez « oui » pour confirmer la commande.', recapOf({ address: 'rue des frères Bouadou n 5', communeName: 'Bab Ezzouar', wilaya: 'Alger' }), 'fr');
    expect(r.kept).toBe('server');
  });
  it('a call to action only ⇒ the server recap alone', () => {
    expect(recapReply('ايه، جاوبني بـ « إيه » باش نأكدو الطلبية.', recapOf({}), 'ar').kept).toBe('server');
    expect(recapReply('Ktebli « ih » bach nconfirmi.', recapOf({}), 'arabizi').kept).toBe('server');
  });
  it('Markdown is stripped; a lone star and snake_case stay', () => {
    expect(stripMarkdown('وعليكم السلام 👋 عندنا **Djellaba homme** بيج')).toBe('وعليكم السلام 👋 عندنا Djellaba homme بيج');
    expect(stripMarkdown('## Prix\n* Robe : __4 900 DA__\nVoir [la fiche](https://djaber.app/p/1) et `CODE`')).toBe('Prix\n- Robe : 4 900 DA\nVoir la fiche https://djaber.app/p/1 et CODE');
    expect(stripMarkdown('2 * 3 tapis, code ETE_2026, *promo*')).toBe('2 * 3 tapis, code ETE_2026, promo');
  });
  it('F2 / F7: the Arabic recap writes the wilaya (and a listed commune) in Arabic, with « ، »', () => {
    const f2 = orderRecapText(recapOf({ wilaya: 'Constantine', wilayaAr: 'قسنطينة', communeName: 'الخروب', address: 'حي 1000 مسكن عمارة 5' }), 'ar');
    expect(f2).toContain('- التوصيل للدار (الخروب، قسنطينة): 450 دج');
    expect(f2).toContain('العنوان: حي 1000 مسكن عمارة 5، الخروب، قسنطينة');
    const f7 = orderRecapText(recapOf({ wilayaAr: 'البليدة', communeName: 'Boufarik', communeAr: 'بوفاريك', address: 'حي الورود رقم 12' }), 'ar');
    expect(f7).toContain('(بوفاريك، البليدة)');
    expect(f7).toContain('العنوان: حي الورود رقم 12، بوفاريك، البليدة');
    // the other languages keep the Latin names
    expect(orderRecapText(recapOf({ wilayaAr: 'البليدة', communeAr: 'بوفاريك' }), 'fr')).toContain('Livraison à domicile (Boufarik, Blida) : 450 DA');
    // a name already written (in either script) is not added again — journey retest R6-4: a trailing one after a comma comes
    // back in the recap's order and script
    expect(orderRecapText(recapOf({ wilayaAr: 'البليدة', communeAr: 'بوفاريك', address: 'حي الورود، Boufarik' }), 'ar')).toContain('العنوان: حي الورود، بوفاريك، البليدة');
    expect(orderRecapText(recapOf({ wilayaAr: 'البليدة', communeAr: 'بوفاريك', address: 'حي الورود Boufarik' }), 'ar')).toContain('العنوان: حي الورود Boufarik، البليدة');
    expect(communeAr([{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }], 'boufarik')).toBe('بوفاريك');
    expect(communeAr([{ nameFr: 'Boufarik', nameAr: 'بوفاريك' }], 'Blida')).toBeNull();
  });
});
