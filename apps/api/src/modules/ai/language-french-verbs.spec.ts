// live 24/11 (H-07 test chat): « montre-moi Satin dress » was read as English — no French word of the list in it, and the product name is
// English — and answered in darija. Everyday French verbs and pronouns are French words.
import { detectLanguage } from './language';

describe('French requests that name an English product', () => {
  it('« montre-moi <product> », « envoie-moi … », « donne-moi … » are French, whatever the conversation was before', () => {
    for (const t of ['montre-moi Satin dress', 'montrez-moi le T-Shirt Noir Classique', 'envoie moi Satin dress', 'donne-moi product 1', 'je cherche Satin dress']) {
      expect([t, detectLanguage(t)]).toEqual([t, 'fr']);
      expect([t, detectLanguage(t, 'ar')]).toEqual([t, 'fr']);
    }
  });
  it('English and darija stay what they are', () => {
    expect(detectLanguage('show me the Satin dress please')).toBe('en');
    expect(detectLanguage('ch7al soum ta3 Satin dress')).toBe('arabizi');
  });
});
