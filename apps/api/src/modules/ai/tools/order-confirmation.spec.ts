// Full-test 15/11 AI-CHAT-01 / -03: the server-side order confirmation (recap of an earlier turn + the customer's yes).
import { asksCancel, confirmation, draftKey, hasDraft, isPlaceholderName, nextChosen, orderedBefore, phoneCheckAsked, phonesIn, placedNumbers, placedThisTurn, simulatedOrders, wantsCancel } from './order-confirmation';

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
