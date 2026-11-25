// live test chat 25/11: « how much is delivery to Algiers? » ⇒ « product 1: 2 000 DA. Delivery to Algiers is … Which product are you
// looking at? » — the reply's word « product » was read as the product « product 1 ».
import { namedWhole } from './ai-run.service';

describe('namedWhole', () => {
  it('a name with numbers is named only with them', () => {
    expect(namedWhole('Which product are you looking at?', 'product 1')).toBe(false);
    expect(namedWhole('Le product 1 est à 2 000 DA.', 'product 1')).toBe(true);
    expect(namedWhole('On a le pack, il est disponible.', 'Pack 2')).toBe(false);
    expect(namedWhole('QA 23/11 photos : 5 000 DA', 'QA 23/11 photos')).toBe(true);
  });

  it('a name without numbers is named by its words, in order', () => {
    expect(namedWhole('2 tapis de prière molletonnés', 'Tapis de prière')).toBe(true);
    expect(namedWhole('un tapis berbère', 'Tapis de prière')).toBe(false);
  });
});
