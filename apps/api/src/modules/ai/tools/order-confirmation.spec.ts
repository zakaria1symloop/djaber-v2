// Full-test 15/11 AI-CHAT-01 / -03: the server-side order confirmation (recap of an earlier turn + the customer's yes).
import { asksCancel, confirmation, coreKey, draftKey, hasDraft, latestRecap, wordingChangedNow, isPlaceholderName, lastAiText, nextChosen, orderedBefore, phoneCheckAsked, phonesIn, placedNumbers, placedThisTurn, recapShown, simulatedOrders, wantsCancel } from './order-confirmation';

const base = { clientName: 'Yacine Mansouri', clientPhone: '0555987654', secondPhone: null, wilayaId: 9, communeName: 'Boufarik', address: 'cité 20 août villa 3', isStopdesk: false, stopdeskId: null, items: [{ productId: 'p1', variantId: null, quantity: 1 }, { productId: 'p2', variantId: 'v1', quantity: 2 }], replaces: null };

describe('confirmation of the recap (customer message of the turn)', () => {
  it.each(['oui', 'Oui je confirme', 'ok', "d'accord", 'wah', 'ih', 'safi', 'mrigl', 'nconfirmi', 'نعم', 'ايه', 'أكد', 'تمام', 'yes', '👍', 'pas de souci', "c'est bon merci"])('« %s » ⇒ yes', (t) => expect(confirmation(t)).toBe('yes'));
  it.each(['non', 'Non merci', 'attendez je veux changer la taille', 'machi hadi', 'لا', 'je ne confirme pas', 'annuler'])('« %s » ⇒ no', (t) => expect(confirmation(t)).toBe('no'));
  it.each(['Yacine Mansouri, 0555987654, Blida, Boufarik', 'c’est quand la livraison ?', 'la robe rouge', 'Blida', ''])('« %s » ⇒ unclear (nothing is created)', (t) => expect(confirmation(t)).toBe('unclear'));
  it('cancel words', () => {
    expect(wantsCancel('je veux annuler ma commande')).toBe(true);
    expect(wantsCancel('nbatel la commande')).toBe(true);
    expect(wantsCancel('oui')).toBe(true);
    expect(wantsCancel('je confirme ma commande')).toBe(true);
    expect(wantsCancel('Blida, Boufarik')).toBe(false);
  });
});

describe('draft of an order', () => {
  it('same content ⇒ same key (case, spaces, punctuation, item order); another quantity, phone or address ⇒ another key', () => {
    const k = draftKey(base);
    expect(draftKey({ ...base, clientName: '  yacine   MANSOURI ', address: 'Cité 20 Août, villa 3', items: [...base.items].reverse() })).toBe(k);
    expect(draftKey({ ...base, items: [{ ...base.items[0]!, quantity: 2 }, base.items[1]!] })).not.toBe(k);
    expect(draftKey({ ...base, clientPhone: '0555987655' })).not.toBe(k);
    expect(draftKey({ ...base, address: 'cité 21 août villa 3' })).not.toBe(k);
  });
  it('a recap shown by an earlier turn counts for 2 hours; a phone check only for that phone', () => {
    const k = draftKey(base);
    const now = Date.now();
    const shown = [{ result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: k } }, at: new Date(now - 60_000) }];
    expect(hasDraft(shown, k, now)).toBe(true);
    expect(hasDraft(shown, 'other', now)).toBe(false);
    expect(hasDraft([{ ...shown[0]!, at: new Date(now - 3 * 3_600_000) }], k, now)).toBe(false);
    expect(hasDraft(undefined, k, now)).toBe(false);
    const asked = [{ result: { ok: false, error: { code: 'PHONE_CONFIRMATION_REQUIRED', phone: '0555987654' } }, at: new Date(now) }];
    expect(phoneCheckAsked(asked, '0555987654', now)).toBe(true);
    expect(phoneCheckAsked(asked, '0661000000', now)).toBe(false);
    expect(phoneCheckAsked([], '0555987654', now)).toBe(false);
  });
});

describe('values the customer gave', () => {
  it('phones written with spaces, dots, +213 or Arabic digits', () => {
    expect([...phonesIn('mon num 0555 98 76 54 et +213 661.12.34.56, ٠٧٧٠١٢٣٤٥٦')].sort()).toEqual(['0555987654', '0661123456', '0770123456']);
    expect(phonesIn('Blida Boufarik').size).toBe(0);
  });
  it('placeholder names are not names', () => {
    for (const n of ['Client', 'client', 'Customer', 'TEST', 'زبون', 'x']) expect(isPlaceholderName(n)).toBe(true);
    for (const n of ['Yacine Mansouri', 'Clientèle Amine', 'Amine']) expect(isPlaceholderName(n)).toBe(false);
  });
});

describe('full-test 15/11 — one order per recap, the playground TEST-n orders, explicit cancel, the chosen product', () => {
  const now = Date.now();
  const placed = (number: string, draft: string, extra: Record<string, unknown> = {}) => ({ name: 'create_order', result: { ok: true, number, draft, total: 4900, items: [], ...extra }, at: new Date(now - 60_000) });
  it('orderedBefore: the same content already placed by an earlier turn (C06 TEST-2998 then TEST-2283)', () => {
    expect(orderedBefore([placed('TEST-2998', 'k1')], 'k1')).toBe('TEST-2998');
    expect(orderedBefore([placed('TEST-2998', 'k1')], 'k2')).toBeNull();
    expect(orderedBefore([{ ...placed('TEST-2998', 'k1'), at: new Date(now - 3 * 3_600_000) }], 'k1')).toBeNull();
    expect(placedNumbers([placed('CMD-1', 'k1'), { name: 'create_order', result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } }, at: new Date() }])).toEqual(['CMD-1']);
  });
  it('simulatedOrders: the dry-run orders of the session minus the cancelled / replaced ones', () => {
    const h = [placed('TEST-1', 'a', { simulated: true }), placed('TEST-2', 'b', { simulated: true, replaced: { number: 'TEST-1' } }), placed('TEST-3', 'c', { simulated: true }), { name: 'cancel_order', result: { ok: true, cancelled: 'TEST-3', simulated: true }, at: new Date() }, placed('CMD-9', 'd')];
    expect(simulatedOrders(h).map((o) => o.number)).toEqual(['TEST-2']);
  });
  it('asksCancel needs the customer\'s own cancel words (« oui » is not one)', () => {
    expect(asksCancel('annule tout')).toBe(true);
    expect(asksCancel('nbatel la commande')).toBe(true);
    expect(asksCancel('ألغي الطلب')).toBe(true);
    expect(asksCancel('oui merci')).toBe(false);
  });
  it('nextChosen: the reported cart wins, an empty one never erases, a placed order clears it', () => {
    const prev = [{ productId: 'p1', variantId: 'v1', quantity: 2 }];
    expect(nextChosen(prev, { items: [] }, false)).toEqual(prev);
    expect(nextChosen(prev, undefined, false)).toEqual(prev);
    expect(nextChosen(prev, { items: [{ productId: 'p2', variantId: null, quantity: '3' }] }, false)).toEqual([{ productId: 'p2', variantId: null, quantity: 3 }]);
    expect(nextChosen(prev, { items: [{ productId: 'p2', quantity: 0 }] }, false)).toEqual([{ productId: 'p2', variantId: null, quantity: null }]);
    expect(nextChosen(prev, { items: [{ productId: 'p2' }] }, true)).toBeNull();
    expect(placedThisTurn([{ name: 'create_order', result: { ok: true, number: 'X' } }])).toBe(true);
    expect(placedThisTurn([{ name: 'create_order', result: { ok: false } }])).toBe(false);
  });
});

describe('journey 16/11 J04-4 — a recap the AI wrote itself in its previous message', () => {
  const o09 = 'Bien sûr ! Voici la nouvelle commande qui remplacera TEST-1813 :\n- 2 × Hijab soie : 3 000 DA\nLivraison à Alger : 400 DA\nTotal : 3 400 DA, à payer à la livraison.\n\nNom : Karim Haddad\nTéléphone : 0770112233\nAdresse : rue des frères Bouadou n 5, Bab Ezzouar, Alger\n\nVous confirmez ? Répondez oui pour la valider.';
  const order = { clientPhone: '0770112233', total: 3400, items: [{ name: 'Hijab soie' }], replaces: { number: 'TEST-1813' } };
  it('the same phone, total, products and replaced order count as shown', () => {
    expect(recapShown(o09, order)).toBe(true);
    const o01 = 'Votre commande actuelle serait remplacée par une nouvelle commande de 2 robes :\n- Robe kabyle brodée, taille M, 2 pièces : 9800 DA\n- Total : 10450 DA\nTéléphone : 0661234567\nJe confirme le remplacement de la commande TEST-2337 par celle-ci ?';
    expect(recapShown(o01, { clientPhone: '0661234567', total: 10450, items: [{ name: 'Robe kabyle brodée' }], replaces: { number: 'TEST-2337' } })).toBe(true);
  });
  it('another total, phone, product or replaced order — or no message — does not', () => {
    expect(recapShown(o09, { ...order, total: 1900 })).toBe(false);
    expect(recapShown(o09, { ...order, clientPhone: '0661234567' })).toBe(false);
    expect(recapShown(o09, { ...order, items: [{ name: 'Robe kabyle brodée' }] })).toBe(false);
    expect(recapShown(o09, { ...order, replaces: { number: 'TEST-9999' } })).toBe(false);
    expect(recapShown('', order)).toBe(false);
    expect(recapShown(null, order)).toBe(false);
  });
  it('lastAiText: the AI messages after the last customer message', () => {
    expect(lastAiText([{ author: 'customer', text: 'a' }, { author: 'ai', text: 'b' }, { author: 'ai', text: 'c' }])).toBe('b\nc');
    expect(lastAiText([{ author: 'ai', text: 'b' }, { author: 'customer', text: 'a' }])).toBe('');
    expect(lastAiText([{ author: 'customer', text: 'a' }, { author: 'human', text: 'h' }])).toBe('');
  });
});

describe('journey 16/11 J03-10 (Blocker) — « oui » to the recap when the confirming call rewords the name / commune / address', () => {
  // the exact `create_order` argument pairs of the J03 transcripts (.local/qa/journeys/J03/out/transcripts): recap ⇒ confirmation
  const SAC = '01a1e54f-a0b9-7ae5-8971-96c0cc39d155';
  const NOIR = '01a1e54f-a0cd-746a-8972-de0bf0d05b35';
  const MARRON = '01a1e54f-a0e1-7b60-8974-d647387f0eda';
  const DJELLABA = '01a1e54f-9b89-7737-8919-ce1e2299efdc';
  const COFFRET = '01a1e54f-a19a-7ced-898a-9e6ee6196172';
  const TAPIS = '01a1e54f-a31d-7828-899f-644c5988a750';
  type Args = { clientName: string; clientPhone: string; wilayaId: number; communeName?: string; address?: string; isStopdesk?: boolean; items: { productId: string; variantId?: string; quantity: number }[] };
  /** What `prepareOrder` builds from the arguments (defaults of the zod schema). */
  const req = (a: Args) => ({ clientName: a.clientName, clientPhone: a.clientPhone, secondPhone: null, wilayaId: a.wilayaId, communeName: a.communeName || null, address: a.address || null, isStopdesk: a.isStopdesk ?? false, stopdeskId: null, items: a.items.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity })), replaces: null as { number: string } | null });
  const wilayas: Record<number, string> = { 9: 'Blida', 19: 'Sétif', 25: 'Constantine', 31: 'Oran' };
  /** The CONFIRMATION_REQUIRED row an earlier turn stored for these arguments. */
  const shown = (a: Args, at: Date) => {
    const r = req(a);
    return { name: 'create_order', at, result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: draftKey(r), core: coreKey(r) as string | undefined }, recap: { items: [], clientName: r.clientName, clientPhone: r.clientPhone, wilaya: wilayas[r.wilayaId], communeName: r.communeName, address: r.address, isStopdesk: r.isStopdesk } } };
  };
  /** The server's verdict on the confirming call (tool-registry `prepareOrder`): the recap it confirms (its draft), or null (⇒ a new recap). */
  const confirms = (history: ReturnType<typeof shown>[], a: Args, customerText: string): string | null => {
    const r = req(a);
    if (hasDraft(history, draftKey(r))) return draftKey(r);
    const latest = latestRecap(history);
    return latest?.core === coreKey(r) && latest.wording && !wordingChangedNow(latest.wording, r, customerText) ? latest.draft : null;
  };
  const t0 = new Date(Date.now() - 120_000);
  const t1 = new Date(Date.now() - 60_000);
  const cases: [string, Args, Args, string][] = [
    [
      'PR2 T7 → T8 « …, El Eulma, Sétif »',
      { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, communeName: 'El Eulma', address: 'Cité 500 logements bloc 12', items: [{ productId: SAC, variantId: NOIR, quantity: 1 }], isStopdesk: false },
      { clientName: 'Karim Haddad', clientPhone: '0770112233', wilayaId: 19, communeName: 'El Eulma', address: 'Cité 500 logements bloc 12, El Eulma, Sétif', isStopdesk: false, items: [{ productId: SAC, variantId: NOIR, quantity: 1 }] },
      'oui',
    ],
    [
      'PR3 T1 → T2 « …, Boufarik »',
      { clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilayaId: 9, communeName: 'Boufarik', address: 'Cité 20 août, villa 3', items: [{ productId: DJELLABA, quantity: 1 }] },
      { clientName: 'Yacine Mansouri', clientPhone: '0555987654', wilayaId: 9, communeName: 'Boufarik', address: 'Cité 20 août, villa 3, Boufarik', items: [{ productId: DJELLABA, quantity: 1 }], isStopdesk: false },
      'oui',
    ],
    [
      'PR5 T6 → T7 « Cité 1000 logements, Bir El Djir, Oran »',
      { clientName: 'Nadia Kaci', clientPhone: '0661234567', wilayaId: 31, communeName: 'Bir El Djir', address: 'cité 1000 logements', items: [{ productId: COFFRET, quantity: 1 }, { productId: TAPIS, quantity: 2 }] },
      { clientName: 'Nadia Kaci', clientPhone: '0661234567', wilayaId: 31, communeName: 'Bir El Djir', address: 'Cité 1000 logements, Bir El Djir, Oran', items: [{ productId: COFFRET, quantity: 1 }, { productId: TAPIS, quantity: 2 }] },
      'ok',
    ],
    [
      'PR7 T4 → T5 « …, El Khroub »',
      { clientName: 'Samira Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'El Khroub', address: 'Cité 1000 logements bloc 5', items: [{ productId: TAPIS, quantity: 2 }], isStopdesk: false },
      { clientName: 'Samira Benali', clientPhone: '0661234567', wilayaId: 25, communeName: 'El Khroub', address: 'Cité 1000 logements bloc 5, El Khroub', items: [{ productId: TAPIS, quantity: 2 }], isStopdesk: false },
      'oui',
    ],
  ];
  it.each(cases)('%s: another content key, the same core ⇒ the recap shown is the one confirmed', (_label, recapArgs, confirmArgs, said) => {
    expect(draftKey(req(confirmArgs))).not.toBe(draftKey(req(recapArgs))); // the old check: CONFIRMATION_REQUIRED again, in a loop
    expect(coreKey(req(confirmArgs))).toBe(coreKey(req(recapArgs)));
    expect(confirms([shown(recapArgs, t0)], confirmArgs, said)).toBe(draftKey(req(recapArgs)));
  });
  it('the name reworded (« KARIM »), the commune dropped, the address abbreviated: still the same order', () => {
    const [, recapArgs] = cases[0]!;
    expect(confirms([shown(recapArgs, t0)], { ...recapArgs, clientName: 'KARIM', communeName: undefined, address: 'cite 500 lgts bloc 12' }, 'wah')).toBe(draftKey(req(recapArgs)));
  });
  it('a real change of the core gets a new recap: PR2 T10 marron instead of noir, a quantity, a phone, a wilaya, stop-desk, a replaced order', () => {
    const [, recapArgs, confirmArgs] = cases[0]!;
    const h = [shown(recapArgs, t0), shown(confirmArgs, t1)];
    expect(confirms(h, { ...confirmArgs, items: [{ productId: SAC, variantId: MARRON, quantity: 1 }] }, 'oui')).toBeNull();
    expect(confirms(h, { ...confirmArgs, items: [{ productId: SAC, variantId: NOIR, quantity: 2 }] }, 'oui')).toBeNull();
    expect(confirms(h, { ...confirmArgs, clientPhone: '0661234567' }, 'oui')).toBeNull();
    expect(confirms(h, { ...confirmArgs, wilayaId: 16 }, 'oui')).toBeNull();
    expect(confirms(h, { ...confirmArgs, isStopdesk: true }, 'oui')).toBeNull();
    const base = req(confirmArgs);
    expect(coreKey({ ...base, replaces: { number: 'TEST-1' } })).not.toBe(coreKey(base));
    expect(coreKey({ ...base, isStopdesk: true, stopdeskId: 'sd1' })).not.toBe(coreKey({ ...base, isStopdesk: true, stopdeskId: 'sd2' }));
  });
  it('the yes message itself brings a new address word (« oui mais villa 4 ») ⇒ a new recap; words of the recap or the wilaya do not', () => {
    const [, recapArgs] = cases[1]!;
    const h = [shown(recapArgs, t0)];
    expect(confirms(h, { ...recapArgs, address: 'Cité 20 août, villa 4' }, 'oui mais c’est la villa 4')).toBeNull();
    expect(confirms(h, { ...recapArgs, address: 'Cité 20 août, villa 3, Boufarik, Blida' }, 'oui, à Boufarik')).toBe(draftKey(req(recapArgs)));
  });
  it('only the LATEST recap is confirmed by its core; an earlier recap still needs its exact content', () => {
    const [, noir, noirConfirm] = cases[0]!;
    const marron: Args = { ...noirConfirm, items: [{ productId: SAC, variantId: MARRON, quantity: 1 }] };
    const h = [shown(noir, t0), shown(marron, t1)];
    expect(latestRecap(h)?.draft).toBe(draftKey(req(marron)));
    expect(confirms(h, noirConfirm, 'oui')).toBeNull();
    expect(confirms(h, noir, 'oui')).toBe(draftKey(req(noir))); // the exact content shown stays valid (2 h)
    expect(confirms(h, { ...marron, address: 'Cité 500 logements bloc 12' }, 'oui')).toBe(draftKey(req(marron)));
  });
  it('PR2 T9 → T10: the variant change recap the model wrote without create_order is confirmed by « oui » (J04-4 rule, b1f0bb6)', () => {
    const t9 = 'Pas de souci Karim, le sac Marron est bien disponible. Voici le nouveau récapitulatif :\n- Sac à main cuir, Marron x1 : 6900 DA\n- Livraison à domicile (Sétif, El Eulma) : 650 DA\n- Total : 7550 DA (paiement à la livraison)\n\nNom : Karim Haddad\nTéléphone : 0770112233\nAdresse : Cité 500 logements bloc 12, El Eulma, Sétif\n\nJe confirme la commande avec le sac Marron ? Répondez oui pour la valider.';
    expect(confirmation('oui')).toBe('yes');
    expect(recapShown(t9, { clientPhone: '0770112233', total: 7550, items: [{ name: 'Sac à main cuir' }], replaces: null })).toBe(true);
  });
  it('latestRecap: fresh create_order recaps only; old rows without `core` give core null', () => {
    const [, recapArgs] = cases[0]!;
    expect(latestRecap([shown(recapArgs, new Date(Date.now() - 3 * 3_600_000))])).toBeNull();
    expect(latestRecap([{ ...shown(recapArgs, t0), name: 'cancel_order' }])).toBeNull();
    const legacy = shown(recapArgs, t0);
    legacy.result.error.core = undefined;
    expect(latestRecap([legacy])).toMatchObject({ core: null, wording: { clientName: 'Karim Haddad', address: 'Cité 500 logements bloc 12', communeName: 'El Eulma', wilaya: 'Sétif' } });
  });
  it('orderedBefore: an order placed with the same core is not placed again under another address wording', () => {
    const [, recapArgs, confirmArgs] = cases[3]!;
    const placedRow = { name: 'create_order', result: { ok: true, number: 'TEST-1310', draft: draftKey(req(recapArgs)), core: coreKey(req(recapArgs)), items: [] }, at: t1 };
    expect(orderedBefore([placedRow], draftKey(req(confirmArgs)), Date.now(), coreKey(req(confirmArgs)))).toBe('TEST-1310');
    expect(orderedBefore([placedRow], draftKey(req(confirmArgs)))).toBeNull();
    expect(orderedBefore([placedRow], 'x', Date.now(), coreKey(req({ ...confirmArgs, items: [{ productId: TAPIS, quantity: 3 }] })))).toBeNull();
  });
});
