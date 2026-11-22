// 22/11 known issue « the AI forgets the chosen product between replies »: the model's `cart` was dropped by normalizeReplyObject, so
// `context.chosen` (the CURRENT ORDER prompt line) was never filled. The cart is now kept in a strict shape and flows to nextChosen.
import { parseReplyOutput } from './structured-output';
import { nextChosen } from './tools/order-confirmation';

const answer = (cart: unknown) => JSON.stringify({ reply: 'Quelle wilaya ?', status: 'OK', intent: 'SALE', productCards: [], recommendations: [], confidence: 0.9, cart });

describe('the model cart is kept (CURRENT ORDER)', () => {
  it('keeps product, variant and a whole quantity', () => {
    const r = parseReplyOutput(answer({ items: [{ productId: 'p1', variantId: 'v42', quantity: 2 }] }));
    expect(r).toMatchObject({ ok: true, value: { cart: { items: [{ productId: 'p1', variantId: 'v42', quantity: 2 }] } } });
  });

  it('mends what can be read: a quantity as text, an array instead of { items }, a null variant', () => {
    expect(parseReplyOutput(answer({ items: [{ productId: 'p1', variantId: null, quantity: '3' }] }))).toMatchObject({ ok: true, value: { cart: { items: [{ productId: 'p1', quantity: 3 }] } } });
    expect(parseReplyOutput(answer([{ productId: 'p2' }]))).toMatchObject({ ok: true, value: { cart: { items: [{ productId: 'p2' }] } } });
  });

  it('drops what cannot be trusted: no id, a quantity 0 / negative / fractional / huge, an empty cart', () => {
    const r = parseReplyOutput(answer({ items: [{ quantity: 2 }, { productId: 'p1', quantity: 0 }, { productId: 'p2', quantity: -1 }, { productId: 'p3', quantity: 1e9 }] }));
    expect(r.ok && r.value.cart?.items).toEqual([{ productId: 'p1' }, { productId: 'p2' }, { productId: 'p3' }]);
    expect(parseReplyOutput(answer({ items: [] })).ok && (parseReplyOutput(answer({ items: [] })) as { value: { cart?: unknown } }).value.cart).toBeUndefined();
    expect(parseReplyOutput(answer('2 tapis')).ok).toBe(true);
  });

  it('flows into the chosen items: kept on a name-only turn, cleared once an order is placed', () => {
    const t1 = parseReplyOutput(answer({ items: [{ productId: 'p1', variantId: 'v42', quantity: 2 }] }));
    const chosen = nextChosen(null, t1.ok ? t1.value.cart : null, false);
    expect(chosen).toEqual([{ productId: 'p1', variantId: 'v42', quantity: 2 }]);
    // T2 « Karim, Blida » — no cart in the answer: the product stays chosen
    const t2 = parseReplyOutput(answer(undefined));
    expect(nextChosen(chosen, t2.ok ? t2.value.cart : null, false)).toEqual(chosen);
    expect(nextChosen(chosen, null, true)).toBeNull();
  });
});
