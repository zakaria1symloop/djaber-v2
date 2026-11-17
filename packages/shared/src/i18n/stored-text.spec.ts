// UX-056 leftovers (14/11): texts the server stores are keys + values, read in the reader's language.
import { describe, expect, it } from 'vitest';
import { getMessages } from './messages';
import { parseStoredText, renderStoredText, renderStoredTextIn, storedText, textIn } from './stored-text';

describe('stored text tokens', () => {
  it('round trip: key + values; empty values left out; `|` and line breaks never break the token', () => {
    const v = storedText('stored.cash.orderCodPartial', { number: 'CMD-1008', amount: '445 900 DA', note: 'reste | demain\nok', empty: '' });
    expect(v).toBe('§stored.cash.orderCodPartial|number=CMD-1008|amount=445 900 DA|note=reste / demain ok');
    expect(parseStoredText(v)).toEqual({ key: 'stored.cash.orderCodPartial', params: { number: 'CMD-1008', amount: '445 900 DA', note: 'reste / demain ok' } });
    expect(parseStoredText('Commande #CMD-1008 (paiement)')).toBeNull();
    expect(parseStoredText(null)).toBeNull();
  });

  it('the AI cancel note of #CMD-1009 reads in the viewer’s language (was « IA : demande du client » in Arabic)', () => {
    const note = storedText('stored.order.aiCustomerRequest');
    expect(renderStoredTextIn(note, 'fr')).toBe('à la demande du client (IA)');
    expect(renderStoredTextIn(note, 'ar')).toBe('بطلب من العميل (الذكاء الاصطناعي)');
    expect(renderStoredTextIn(note, 'en')).toBe("at the customer's request (AI)");
  });

  it('history « reason · note » mixes a code the screen names and a token: each part on its own; typed text untouched', () => {
    const reason = ['changed_mind', storedText('stored.order.replacedBy', { number: 'CMD-1010' })].join(' · ');
    expect(renderStoredTextIn(reason, 'en')).toBe('changed_mind · replaced by #CMD-1010');
    expect(renderStoredTextIn('a changé d’avis · rappelle demain', 'ar')).toBe('a changé d’avis · rappelle demain');
    expect(renderStoredTextIn(null, 'fr')).toBeNull();
  });

  it('cash rows: same key, three languages, the order number as a value', () => {
    const v = storedText('stored.cash.orderCod', { number: 'CMD-1008' });
    expect(renderStoredTextIn(v, 'fr')).toBe('Commande #CMD-1008 livrée (COD)');
    expect(renderStoredTextIn(v, 'en')).toBe('Order #CMD-1008 delivered (COD)');
    // journey J14-7: the reference is isolated in Arabic, its « # » stays before it (never « CMD-1008# »)
    const iso = (s: string) => `${String.fromCharCode(0x2068)}${s}${String.fromCharCode(0x2069)}`;
    expect(renderStoredTextIn(v, 'ar')).toContain(iso('#CMD-1008'));
    expect(renderStoredTextIn(v, 'ar')).not.toMatch(/Commande|livrée/);
    expect(renderStoredTextIn(storedText('stored.cash.sale', { number: 'VNT-1002' }), 'ar')).toBe(`البيع ${iso('#VNT-1002')}`);
  });

  it('an unknown key is left out, never shown raw', () => {
    expect(renderStoredText('§nope.key|x=1', () => null)).toBe('');
    expect(renderStoredTextIn(`changed_mind · §nope.key`, 'fr')).toBe('changed_mind');
    expect(textIn('nope.key', 'fr')).toBeNull();
  });

  it('every stored.* / actor.label.* key exists in fr, ar and en, with the same placeholders', () => {
    const fr = getMessages('fr');
    const keys = Object.keys(fr).filter((k) => k.startsWith('stored.') || k.startsWith('actor.label.'));
    expect(keys.length).toBeGreaterThan(20);
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const l of ['ar', 'en'] as const) {
      const m = getMessages(l);
      for (const k of keys) {
        expect(m[k]).toBeTruthy();
        expect(slots(m[k]!)).toEqual(slots(fr[k]!));
      }
    }
  });
  it('full-test 15/11 SALES-CASH-14: a value that is a token (a reason picked in a list) is read in the reader language', () => {
    const v = storedText('stored.cash.saleRefund', { number: 'VNT-1013', reason: storedText('sales.cancel.reason.entry_error') });
    expect(renderStoredTextIn(v, 'en')).toContain(getMessages('en')['sales.cancel.reason.entry_error']!);
    expect(renderStoredTextIn(v, 'ar')).toContain(getMessages('ar')['sales.cancel.reason.entry_error']!);
    expect(renderStoredTextIn(storedText('sales.cancel.reason.entry_error'), 'en')).toBe(getMessages('en')['sales.cancel.reason.entry_error']);
  });
});

describe('full-test 15/11 ANALYTICS-10: cash rows written before the stored-text format', () => {
  it('an exact French sentence of a stored.cash key is read in the reader language; other text stays as typed', () => {
    expect(renderStoredTextIn('Achat #ACH-1002 (paiement fournisseur)', 'en')).toBe(textIn('stored.cash.purchaseSupplierPayment', 'en', { number: 'ACH-1002' }));
    expect(renderStoredTextIn('Commande #CMD-1003 livrée (COD)', 'ar')).toBe(textIn('stored.cash.orderCod', 'ar', { number: 'CMD-1003' }));
    expect(renderStoredTextIn('Loyer de novembre', 'en')).toBe('Loyer de novembre');
  });
});
