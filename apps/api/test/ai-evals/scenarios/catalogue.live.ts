// Live chatbot scenarios — catalogue, prices, variants, moderation, delivery fees, policies, FAQ, languages.
import { cardsOf, closeShop, never, noOrder, openShop, play, said, usedTool, writeSummary, type Scenario, type Shop } from './harness';

let s: Shop;
beforeAll(async () => {
  s = await openShop();
});
afterAll(async () => {
  writeSummary('catalogue');
  if (s) await closeShop(s);
});

const SCENARIOS: Scenario[] = [
  { id: 'C01', title: 'FR — salutation puis prix de la robe', lang: 'latin', steps: ['Bonjour', "C'est combien la robe satin ?"], check: (r) => [...said(r, /4\s?500/, 'the price 4500 DA'), ...noOrder(r)] },
  { id: 'C02', title: 'Darija (arabe) — prix de la robe', lang: 'ar', steps: ['السلام عليكم، بشحال الروب ساتان؟'], check: (r) => said(r, /4\s?500/, 'the price 4500') },
  { id: 'C03', title: 'Arabizi — baskets et prix (la pointure 44 en modération ne doit pas sortir)', lang: 'latin', steps: ['salam, 3andkom basket? bchhal?'], check: (r) => [...said(r, /7\s?500/, 'the price 7500'), ...never(r, /\b44\b/, 'the size 44 (pending moderation)')] },
  { id: 'C04', title: 'Anglais — sac en cuir', lang: 'latin', steps: ['Hi! Do you sell leather bags? How much?'], check: (r) => said(r, /6\s?200/, 'the price 6200') },
  { id: 'C05', title: 'Variante en rupture (jogging M) → propose les tailles disponibles', lang: 'latin', steps: ["Bonsoir, l'ensemble jogging en taille M est disponible ?"], check: (r) => said(r, /\bS\b|\bL\b|\bXL\b/, 'another available size'), review: () => ['vérifier que M est bien annoncé indisponible'] },
  {
    id: 'C06',
    title: 'Variante en attente de modération (basket 44) — jamais proposée ni commandée',
    lang: 'latin',
    steps: ['Vous avez la Basket Runner en pointure 44 ?', "Elle était sur votre page, je prends la 44 alors, c'est bon je confirme"],
    check: (r) => [...noOrder(r), ...(r.orders.some((o) => o.items.some((i) => i.variantName === '44')) ? ['order with the size 44'] : [])],
    review: () => ['la réponse doit dire que la 44 n’est pas disponible, sans la confirmer'],
  },
  { id: 'C07', title: 'Produit en attente de modération (parfum) — invisible', lang: 'latin', steps: ['Bonjour vous avez le parfum Oud Royal ?', 'Il était sur votre page hier, je le veux'], check: (r) => [...noOrder(r), ...(cardsOf(r).some((c) => /parfum/i.test(c)) ? ['card of the pending perfume'] : [])] },
  { id: 'C08', title: 'Produit désactivé (robe fleurie) — invisible', lang: 'latin', steps: ['La robe fleurie été est encore dispo ?'], check: (r) => (cardsOf(r).some((c) => /fleurie/i.test(c)) ? ['card of the inactive dress'] : []) },
  { id: 'C09', title: 'Produit refusé par la modération (couteau) — invisible', lang: 'latin', steps: ['Vous vendez des couteaux de chasse ?'], check: (r) => (cardsOf(r).some((c) => /couteau/i.test(c)) ? ['card of the rejected knife'] : []) },
  { id: 'C10', title: 'Produit hors catalogue (iPhone)', lang: 'latin', steps: ['Vous vendez des iPhone 15 ? à quel prix ?'], check: (r) => noOrder(r) },
  { id: 'C11', title: 'Produit en rupture (écharpe) → phrase de rupture + alternative', lang: 'latin', steps: ["Je veux commander l'écharpe en laine grise"], check: (r) => noOrder(r), review: () => ['doit dire rupture de stock et proposer une alternative de la même catégorie (Accessoires)'] },
  { id: 'C12', title: 'Produit commandable à stock 0 (hijab soie)', lang: 'latin', steps: ['Le hijab soie est disponible ?'], review: () => ['doit accepter la commande (délai un peu plus long), pas « rupture »'] },
  { id: 'C13', title: 'Frais de livraison vers Oran', lang: 'latin', steps: ['Combien la livraison pour Oran ?'], check: (r) => [...usedTool(r, 'quote_delivery'), ...said(r, /700|450/, 'the Oran fee')] },
  { id: 'C14', title: 'Wilaya non desservie (Tamanrasset)', lang: 'latin', steps: ['Vous livrez à Tamanrasset ? combien ?'], check: (r) => usedTool(r, 'quote_delivery'), review: () => ['doit dire que Tamanrasset n’est pas desservie, sans inventer de frais'] },
  { id: 'C15', title: 'FAQ — livraison le vendredi', lang: 'latin', steps: ['Vous livrez le vendredi ?'], check: (r) => said(r, /samedi|jeudi/i, 'the FAQ answer (samedi au jeudi)') },
  { id: 'C16', title: 'Politique — échange', lang: 'latin', steps: ['Si la taille ne me va pas je peux échanger ?'], check: (r) => said(r, /7\s*jours/i, 'the 7-day exchange') },
  { id: 'C17', title: 'Livraison gratuite dès 20 000 DA (5 robes vers Alger)', lang: 'latin', steps: ['Si je prends 5 robes satin, la livraison vers Alger est gratuite ?'], check: (r) => said(r, /gratuit/i, 'free delivery') },
  { id: 'C18', title: 'Marchandage — 3500 au lieu de 4500', lang: 'latin', steps: ["La robe satin à 4500 c'est trop cher, faites-la moi à 3500 et je la prends tout de suite"], check: (r) => noOrder(r), review: () => ['ne doit pas accepter 3500 DA ni inventer une remise'] },
  { id: 'C19', title: 'Ancien prix / promotion', lang: 'latin', steps: ["La robe satin c'est en promo ? elle était à combien avant ?"], check: (r) => said(r, /5\s?200/, 'the old price 5200') },
  { id: 'C20', title: 'Mélange français + arabizi', lang: 'latin', steps: ["bonjour, chhal l'ensemble jogging ?"], check: (r) => said(r, /3\s?900|4\s?200/, 'the jogging price') },
  {
    id: 'C21',
    title: 'Changement de langue FR → darija arabe',
    steps: ['Bonjour, vous avez des montres ?', 'واش كاين لون فضي؟'],
    check: (r) => {
      const last = r.turns.at(-1)!.bot.filter((b) => b.author === 'ai' && b.type === 'text').map((b) => b.text).join(' ');
      return /[؀-ۿ]/.test(last) ? [] : ['the reply to the Arabic message is not in Arabic script'];
    },
    review: () => ['« فضي » (argenté) n’existe pas : ne doit pas l’inventer'],
  },
  { id: 'C22', title: 'Arabizi — livraison « wahran »', lang: 'latin', steps: ['chhal livraison l wahran?'], check: (r) => said(r, /700|450/, 'the Oran fee') },
  { id: 'C23', title: 'Darija arabe — livraison Constantine à domicile', lang: 'ar', steps: ['شحال التوصيل لقسنطينة للدار؟'], check: (r) => said(r, /600/, 'the Constantine home fee 600') },
  { id: 'C24', title: 'Tailles de la robe', lang: 'latin', steps: ['La robe satin existe en quelles tailles ?'], review: () => ['doit reprendre la description (S à XL, ajustable), sans inventer de stock par taille'] },
  { id: 'C25', title: 'Vente croisée — quelque chose avec la robe', lang: 'latin', steps: ['Je veux la robe satin, vous avez quelque chose qui va avec ?'], check: (r) => said(r, /sac/i, 'the bag (ALSO line)') },
  { id: 'C26', title: 'Paiement par carte', lang: 'latin', steps: ['Je peux payer par carte CIB ou Edahabia ?'], check: (r) => said(r, /livraison/i, 'cash on delivery') },
  { id: 'C27', title: 'Horaires — ouverts le vendredi ?', lang: 'latin', steps: ['Vous êtes ouverts le vendredi ? à quelle heure ?'], check: (r) => said(r, /samedi|jeudi|9\s?h/i, 'the opening hours') },
  { id: 'C28', title: 'Plusieurs questions dans un message', lang: 'latin', steps: ['Bonjour ! 1) prix de la montre 2) livraison à Blida 3) vous livrez le vendredi ? 4) il y a une garantie ?'], check: (r) => [...said(r, /12\s?000/, 'the watch price'), ...said(r, /500|350/, 'the Blida fee'), ...said(r, /6\s*mois/i, 'the 6-month warranty')] },
  { id: 'C29', title: 'Darija arabe — basket disponible ? (pas la 44)', lang: 'ar', steps: ['عندكم سبادري؟ واش من مقاسات كاين؟'], check: (r) => never(r, /\b44\b|٤٤/, 'the size 44 (pending moderation)') },
  { id: 'C30', title: 'Stock restant', lang: 'latin', steps: ['Il vous reste combien de montres dorées ?'], review: () => ['réponse cohérente avec le stock (10), sans inventer'] },
  { id: 'C31', title: 'Fautes et abréviations', lang: 'latin', steps: ['slt cv, c cmb la rob satin ? elle é dispo ?'], check: (r) => said(r, /4s?500/, 'the price 4500') },
  { id: 'C32', title: 'Wilaya donnée par son numéro (25)', lang: 'latin', steps: ['La livraison wilaya 25 à domicile c combien ?'], check: (r) => said(r, /600/, 'the Constantine home fee 600') },
  { id: 'C33', title: 'Suivi alors que le client n’a aucune commande', lang: 'latin', steps: ['Bonjour, où en est ma commande ?'], check: (r) => [...usedTool(r, 'lookup_order'), ...noOrder(r)], review: () => ['doit dire qu’aucune commande n’est trouvée, sans inventer de statut'] },
  { id: 'C34', title: 'Annulation alors qu’il n’y a aucune commande', lang: 'latin', steps: ['Annulez ma commande svp'], check: (r) => noOrder(r), review: () => ['doit dire qu’il n’y a pas de commande à annuler (ou passer la main), sans prétendre avoir annulé'] },
  { id: 'C35', title: 'Kabyle (azul)', steps: ['Azul, tesεiḍ tiqendyar ? acḥal ?'], review: () => ['réponse polie, compréhensible ; ne doit pas inventer de produit'] },
  { id: 'C36', title: 'Darija arabe — taille de jogging dispo (M rupture)', lang: 'ar', steps: ['كاين ensemble jogging مقاس M ؟'], review: () => ['doit dire que M n’est pas dispo et proposer S / L / XL, en arabe'] },
];

describe('live scenarios — catalogue', () => {
  it.each(SCENARIOS.map((x) => [x.id, x] as const))('%s', async (_id, sc) => {
    const { failures } = await play('catalogue', s, sc);
    expect(failures).toEqual([]);
  });
});
