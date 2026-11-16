// Full-test 15/11 proposal 4: the order confirmation the customer gets is the server's, from the create_order result.
import { money, orderConfirmationText, placedOrder } from './order-confirmation-text';

const ORDER = { ok: true, orderId: 'o1', number: 'CMD-1042', subtotal: 9000, deliveryFee: 400, total: 9400, items: [{ name: 'Robe satin', variant: 'M', quantity: 2, unitPrice: 4500 }], duplicateOf: null, paymentOptions: ['cod'], etaDays: '2–5' };
const call = (result: unknown, name = 'create_order') => ({ name, result });

describe('server-written order confirmation', () => {
  it('money is written with a space as thousands separator', () => {
    expect(money(12500)).toBe('12 500');
    expect(money(400)).toBe('400');
    expect(money(1234567)).toBe('1 234 567');
  });
  it('only a create_order that placed an order counts (the last one of the turn)', () => {
    expect(placedOrder([call({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } })])).toBeNull();
    expect(placedOrder([call({ products: [] }, 'search_products')])).toBeNull();
    expect(placedOrder([call(ORDER)])?.number).toBe('CMD-1042');
    expect(orderConfirmationText([call({ ok: false })], 'fr')).toBeNull();
  });
  it('French: number, items, fee, total, delay, cash on delivery', () => {
    expect(orderConfirmationText([call(ORDER)], 'fr')).toBe(
      ['Votre commande CMD-1042 est bien enregistrée ✅', '- 2 × Robe satin (M) : 9 000 DA', 'Livraison : 400 DA', 'Total : 9 400 DA, à payer à la livraison.', 'Délai de livraison : 2 à 5 jours.', 'Merci pour votre confiance !'].join('\n'),
    );
  });
  it('Arabic script writes دج; arabizi and English have their own text; mixed ⇒ French', () => {
    const ar = orderConfirmationText([call(ORDER)], 'ar')!;
    expect(ar).toContain('CMD-1042');
    expect(ar).toContain('9 400 دج');
    expect(ar).not.toContain('DA');
    expect(orderConfirmationText([call(ORDER)], 'arabizi')).toContain('Commande ta3ek CMD-1042 tsajlet');
    expect(orderConfirmationText([call(ORDER)], 'en')).toContain('Total: 9 400 DA, cash on delivery.');
    expect(orderConfirmationText([call(ORDER)], 'mixed')).toContain('Votre commande CMD-1042');
  });
  it('free delivery, a duplicate, a replaced order and units beyond the stock are said', () => {
    const text = orderConfirmationText([call({ ...ORDER, deliveryFee: 0, total: 9000, duplicateOf: 'CMD-1042', replaced: { number: 'CMD-1040' }, beyondStock: [{ name: 'Robe satin M', quantity: 1 }] })], 'fr')!;
    expect(text).toContain('déjà enregistrée');
    expect(text).toContain('Livraison : gratuite');
    expect(text).toContain('Elle remplace la commande CMD-1040, qui est annulée.');
    expect(text).toContain('peut prendre un peu plus de temps');
  });
});
