// full-test 15/11 HELP-01 — the help search matches word by word, without accents.
import { foldText, rankSearch, searchWords } from './help.service';

const guides = [
  { key: 'pages', text: 'Connecter une page Facebook ou Instagram' },
  { key: 'credits', text: 'Crédits : coût par action et packs' },
  { key: 'delivery', text: 'Commandes & livraison : envoyer un colis avec ZR Express' },
];
const keys = (q: string) => rankSearch(guides, (g) => g.text, q).map((g) => g.key);

describe('help search', () => {
  it('folds accents and Arabic short vowels', () => {
    expect(foldText('Crédits Édition')).toBe('credits edition');
    expect(foldText('مُرْتَجَع')).toBe('مرتجع');
  });
  it('splits the words, keeps « 2FA », drops one-letter words', () => {
    expect(searchWords('connecter  Instagram, a 2FA')).toEqual(['connecter', 'instagram', '2fa']);
  });
  it('finds a guide holding every word, in any order and case', () => {
    expect(keys('connecter Instagram')).toEqual(['pages']);
    expect(keys('instagram CONNECTER')).toEqual(['pages']);
    expect(keys('credits')).toEqual(['credits']);
    expect(keys('livraison')).toEqual(['delivery']);
  });
  it('falls back to the guides with the most words when none has them all', () => {
    expect(keys('bordereau ZR Express')).toEqual(['delivery']);
    expect(keys('zzzz')).toEqual([]);
    expect(keys('   ')).toEqual(['pages', 'credits', 'delivery']);
  });
});
