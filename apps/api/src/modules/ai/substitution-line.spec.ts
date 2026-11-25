// Houssem live 25/11 UX-096 (voice notes, H-07): « شحال السوم تاع Recette Sac en cuir » then an order of « Satin dress » ⇒ the recap
// opened with « Le produit Recette H-22 produit B n'est pas disponible pour le moment : à la place… » — a product nobody asked for.
import { substitutionLine } from './reply-fixes';

const catalogue = ['Recette Sac en cuir', 'Recette H-22 produit A', 'Recette H-22 produit B', 'Satin dress', 'Parfum Oud 50 ml', 'Coffret cadeau Aïd'];
const recap = [{ name: 'Satin dress' }];

describe('substitutionLine', () => {
  it('an available product named earlier is no out-of-stock product asked for', () => {
    const history = ['شحال السوم تاع Recette Sac en cuir', 'بغيت نكوموندي 1 روج', 'Brice, commande 1, Satan, dresse rouge.'].join('\n');
    expect(substitutionLine(recap, history, ['Recette H-22 produit B'], 'Voici le récapitulatif', 'fr', catalogue)).toBeNull();
  });

  it('the out-of-stock product the customer really named is still said (R13-5)', () => {
    const history = ['le parfum oud c\'est combien ?', 'Bon finalement je le prends'].join('\n');
    expect(substitutionLine([{ name: 'Coffret cadeau Aïd' }], history, ['Parfum Oud 50 ml'], '', 'fr', catalogue)).toBe("Le produit Parfum Oud 50 ml n'est pas disponible pour le moment : à la place, ce récapitulatif est pour le produit Coffret cadeau Aïd.");
    // named by two of its words among products that share the first one
    expect(substitutionLine(recap, 'je veux la robe kabyle brodée', ['Robe kabyle brodée'], '', 'fr', [...catalogue, 'Robe kabyle brodée', 'Robe lin'])).toContain('Robe kabyle brodée');
    // two products the words of the message cannot tell apart (« produit A » / « produit B »): nothing is claimed
    expect(substitutionLine(recap, 'je veux le recette h-22 produit B', ['Recette H-22 produit B'], '', 'fr', catalogue)).toBeNull();
  });

  it('without the catalogue names it behaves as before', () => {
    expect(substitutionLine([{ name: 'Coffret cadeau Aïd' }], 'le parfum oud c\'est combien ?', ['Parfum Oud 50 ml'], '', 'fr')).toContain('Parfum Oud 50 ml');
  });
});
