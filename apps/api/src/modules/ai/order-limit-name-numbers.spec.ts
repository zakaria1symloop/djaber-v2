// Houssem live 23/11: the voice note « شحال le prix تاع le produit QnA 2311 و ابعثلي photo » (product « QA 23/11 photos », limit 10)
// was handed to the team as « more than 10 pieces » — the number of a product name is never a quantity.
import { nameNumbersOf, quantityAbove } from './order-limit';

describe('numbers written in a product name are not quantities', () => {
  it('reads each digit group of a name and the groups joined', () => {
    expect(nameNumbersOf(['QA 23/11 photos', 'Montre X200', 'Robe kabyle']).sort((a, b) => a - b)).toEqual([11, 23, 200, 2311]);
  });

  const names = async (words: string) => /photo|montre/i.test(words);
  const ctx = { selling: true, lastAi: null, productWords: ['photos', 'montre'], notQuantities: [], nameNumbers: nameNumbersOf(['QA 23/11 photos', 'Montre X200']) };

  it('the price question naming « QnA 2311 » is no order of 2311 pieces; a real quantity above the limit still is', async () => {
    expect(await quantityAbove('شحال le prix تاع le produit QnA 2311 و ابعثلي photo', 10, names, ctx)).toBeNull();
    expect(await quantityAbove('je veux la montre 200', 10, names, ctx)).toBeNull();
    expect(await quantityAbove('je veux 50 photos', 10, names, ctx)).toBe(50);
    expect(await quantityAbove('je veux 50', 10, names, ctx)).toBe(50);
  });
});
