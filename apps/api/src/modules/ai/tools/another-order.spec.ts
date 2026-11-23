// Houssem live 23/11 (H-07, CMD-1011): « طلبية جديدة بنفس المنتج » was refused three times as « already placed » — a customer who asks
// for another order gets a new recap, and the « oui » to the recap shown after the first order places the second one.
import { anotherOrderAsked, orderedBefore, type OrderCallHistory } from './order-confirmation';

const at = (min: number) => new Date(Date.UTC(2026, 10, 23, 10, min));
const placed = (min: number): OrderCallHistory[number] => ({ name: 'create_order', at: at(min), result: { ok: true, number: 'CMD-1011', draft: 'd1', core: 'c1' } });
const recap = (min: number): OrderCallHistory[number] => ({ name: 'create_order', at: at(min), result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd1', core: 'c1' } } });
const now = at(45).getTime();

describe('another order of the same content', () => {
  it('reads the customer asking for another / a new order (fr, darija, Arabic script, en)', () => {
    for (const t of ['طلبية جديدة بنفس المنتج', 'بغيت طلبية جديدة : واحد aq 23/11 photos', 'Je veux une nouvelle commande', 'une autre commande svp', 'nheb wa7da okhra', 'commande jdida', 'another order please', 'طلبية اخرى'])
      expect([t, anotherOrderAsked(t)]).toEqual([t, true]);
    for (const t of ['oui', 'oui c\'est bon', 'ih', 'نعم', 'merci', 'la commande est passée ?', 'واش الطلبية تاعي وصلت ؟']) expect([t, anotherOrderAsked(t)]).toEqual([t, false]);
  });

  it('the same content stays « already placed » on a repeated yes (C06), but not when asked again or confirmed on a later recap', () => {
    const history = [recap(30), placed(34)];
    expect(orderedBefore(history, 'd1', now, 'c1')).toBe('CMD-1011');
    expect(orderedBefore(history, 'd1', now, 'c1', { anotherAsked: true })).toBeNull();
    expect(orderedBefore([...history, recap(40)], 'd1', now, 'c1')).toBeNull();
    // a recap of OTHER content after the order changes nothing
    expect(orderedBefore([...history, { name: 'create_order', at: at(40), result: { ok: false, error: { code: 'CONFIRMATION_REQUIRED', draft: 'd2', core: 'c2' } } }], 'd1', now, 'c1')).toBe('CMD-1011');
  });
});
