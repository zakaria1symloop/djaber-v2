// A1 (tester report 2026-10-20: analysing a page again duplicated its products): two names of one product are matched.
import { sameProductName } from './page.service';

describe('page analysis — the same product under two names', () => {
  it.each([
    ['Robe kabyle brodée', 'robe KABYLE brodee'],
    ['Robe kabyle brodée', 'Robe kabyle brodée main'],
    ['Huile d’argan 100 ml', 'Huile argan 100 ml bio'],
  ])('%s ≈ %s', (a, b) => expect(sameProductName(a, b)).toBe(true));
  it.each([
    ['Robe kabyle', 'Robe chaoui'],
    ['Sac', 'Sac à dos cuir noir'],
    ['Montre homme', 'Montre femme'],
  ])('%s ≠ %s', (a, b) => expect(sameProductName(a, b)).toBe(false));
});
