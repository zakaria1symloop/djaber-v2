// Houssem live 25/11 (UX-095 / UX-096): products that share their first word. « Recette Sac en cuir » was read as « Recette H-22 produit B ».
import { productNamedIn } from './product-named';
import { withAskedPrice } from './reply-fixes';

const p = (id: string, name: string, price = 1000) => ({ id, name, price, variants: [] });
const shop = [p('b', 'Recette H-22 produit B', 2000), p('tee', 'Recette H-15 T-shirt'), p('sac', 'Recette Sac en cuir', 4000), p('lin', 'Robe lin'), p('satin', 'Robe satin bordeaux')];

describe('productNamedIn — the product named by the most words', () => {
  it('a full name wins over a product that only shares its first word, whatever the order of the list', () => {
    expect(productNamedIn('شحال السوم تاع Recette Sac en cuir', shop)?.id).toBe('sac');
    expect(productNamedIn('je veux la robe satin bordeaux', shop)?.id).toBe('satin');
    expect(productNamedIn('la robe en lin svp', shop)?.id).toBe('lin');
    expect(productNamedIn('recette sac en cuir', [...shop].reverse())?.id).toBe('sac');
  });

  it('the first word alone still names a product (the first of the list when several share it)', () => {
    expect(productNamedIn('vous avez une robe ?', shop)?.id).toBe('lin');
    expect(productNamedIn('le parfum', [p('oud', 'Parfum Oud 50 ml')])?.id).toBe('oud');
    expect(productNamedIn('bonjour', shop)).toBeNull();
  });
});

describe('withAskedPrice', () => {
  it('says nothing about an out-of-stock product when the customer named one that is on sale', () => {
    const reply = 'Recette Sac en cuir بـ 4 000 دج، متوفر.';
    expect(withAskedPrice(reply, 'شحال السوم تاع Recette Sac en cuir', [shop[0]!], 'ar', shop)).toBe(reply);
  });

  it('still gives the price of the out-of-stock product that was asked', () => {
    expect(withAskedPrice('Désolé, ce produit est en rupture.', 'c est combien le recette h-22 produit B ?', [shop[0]!], 'fr', shop)).toMatch(/^Recette H-22 produit B est à 2.000.DA, mais ce produit n.est pas disponible/);
  });
});
