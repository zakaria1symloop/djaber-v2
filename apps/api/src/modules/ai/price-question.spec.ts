// Houssem live 25/11 UX-095: the voice note « شحال السوم تاع Recette Sac en cuir » got a full order recap (the customer's name, phone
// and address were known from an earlier order). A message that only asks a price starts no order.
import { priceQuestionOnly } from './reply-guard';

describe('priceQuestionOnly', () => {
  it('a price question in the four ways customers write', () => {
    for (const t of ['شحال السوم تاع Recette Sac en cuir', 'ch7al le prix', 'ch7al Satin dress ?', 'combien coûte le sac en cuir ?', 'c\'est combien la robe', 'how much is the dress?', 'بشحال هذا', 'le prix svp', 'قداش السعر']) {
      expect([t, priceQuestionOnly(t)]).toEqual([t, true]);
    }
  });

  it('not when the message also orders, confirms, or gives a phone', () => {
    for (const t of ['bghit ncommandi 1 sac, ch7al ?', 'je veux la robe, c\'est combien avec la livraison ?', 'نحب نشري واحد بشحال', 'oui', 'combien ? mon numéro 0550123456', 'salam', 'vous avez le sac en cuir ?', 'oui merci, c’est livré en combien de jours ?', 'combien de temps pour la livraison ?', 'ok combien la livraison ?','']) {
      expect([t, priceQuestionOnly(t)]).toEqual([t, false]);
    }
    expect(priceQuestionOnly(undefined)).toBe(false);
  });
});
