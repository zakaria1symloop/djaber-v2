// Journey J05r-9 (18/11, docs/audit/journeys-2026-11-18/journeys/J05.md): bac à essai of a shop whose products still wait for review — the
// address turn said « l'adresse est bien notée » (nothing is kept) and the « oui » turn « je m'excuse pour la confusion » (nobody made one).
import { catalogueSection } from './prompt/sections/catalogue';
import { withoutFalseApology, withoutNotedSteps } from './reply-fixes';

const PENDING = 'Nos produits sont encore en cours de vérification et seront bientôt en ligne.';

describe('journey J05r-9 — nothing « noted », no apology for a confusion nobody made', () => {
  it('a field said to be kept goes, the thanks and the rest stay', () => {
    const history = 'Nadia Ferhat 0770123456 Cité 1014 logements bât 7 n 12, Sétif';
    expect(withoutNotedSteps(`Merci Nadia, l'adresse est bien notée. ${PENDING}`, history)).toBe(`Merci Nadia. ${PENDING}`);
    expect(withoutNotedSteps(`Merci, votre numéro est bien enregistré. ${PENDING}`, history)).toBe(`Merci. ${PENDING}`);
    expect(withoutNotedSteps(`Thanks Nadia, your address is noted. ${PENDING}`, history)).toBe(`Thanks Nadia. ${PENDING}`);
    // a sentence that says something else about the address stays
    expect(withoutNotedSteps(`L'adresse est à Sétif ? ${PENDING}`, history)).toBe(`L'adresse est à Sétif ? ${PENDING}`);
  });

  it('an apology « pour la confusion » goes when the customer pointed at no mistake', () => {
    expect(withoutFalseApology(`Merci Nadia, je m'excuse pour la confusion. ${PENDING}`, 'oui c’est bon je confirme')).toBe(`Merci Nadia. ${PENDING}`);
    expect(withoutFalseApology(`Désolé pour le malentendu : ${PENDING}`, 'oui')).toBe(PENDING);
    expect(withoutFalseApology(`Sorry for the confusion, our products will be online soon.`, 'yes')).toBe('Our products will be online soon.');
    expect(withoutFalseApology(`نعتذر عن الالتباس، منتجاتنا ستكون متاحة قريبًا.`, 'ايه')).toBe('منتجاتنا ستكون متاحة قريبًا.');
  });

  it('kept when the customer said something was wrong, and other apologies are untouched', () => {
    const reply = `Je m'excuse pour l'erreur, la livraison à Sétif coûte 600 DA.`;
    expect(withoutFalseApology(reply, "c'est faux, vous m'avez dit 400 DA")).toBe(reply);
    expect(withoutFalseApology(reply, 'ghalta, 400 DA')).toBe(reply);
    expect(withoutFalseApology('Désolé, ce produit est en rupture.', 'oui')).toBe('Désolé, ce produit est en rupture.');
    expect(withoutFalseApology(PENDING, 'oui')).toBe(PENDING);
  });

  it('the products-pending rule says nothing is kept meanwhile', () => {
    const s = catalogueSection({ catalogue: { full: true, count: 0, products: [], awaitingReview: true }, workspace: { systemMessages: {} }, agent: { outOfStockBehavior: 'suggest_alternative', showMissingVariants: false }, lang: 'fr', locale: 'fr', descriptionMax: 200 } as never);
    expect(s).toContain('never say it is noted or registered');
    expect(s).toContain('never apologise for a confusion nobody made');
  });
});
