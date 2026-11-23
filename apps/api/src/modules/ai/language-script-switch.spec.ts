// Houssem live 23/11 (H-07 11:56): a French order message after Arabic-script messages got its recap and confirmation in Arabic.
import { detectLanguage } from './language';

describe('a Latin sentence after Arabic script switches the conversation language', () => {
  it('French order details after Arabic messages ⇒ French; one word of politeness keeps Arabic', () => {
    expect(detectLanguage('nouvelle commande : 2 qa/11 photos , a domicile, wiliya 16 , commune bab ezzouar, cité 1000 logments bâtiment 5', 'ar')).toBe('fr');
    expect(detectLanguage('ok merci beaucoup', 'ar')).toBe('fr');
    for (const t of ['merci', 'oui', 'Bonsoir', 'ok']) expect([t, detectLanguage(t, 'ar')]).toEqual([t, 'ar']);
  });
});
