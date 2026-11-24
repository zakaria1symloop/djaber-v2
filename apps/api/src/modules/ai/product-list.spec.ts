// Houssem live 23/11 UX-080 (client list L55 / L93): « quels produits vous avez » (H-07, 16:20) ⇒ 7 products named and 3 left out —
// the service « Website Development », « Recette H-22 produit B » (stock 0, sold beyond its stock) and « Recette H-26 à refuser »
// (20 in stock). The list the customer asks for names every product that can be ordered; the server adds the ones left out.
import { alsoSentence, buildGuardFacts, checkReply, enforceReply, listAsked, unavailableOffers, splitSentences } from './reply-guard';
import type { AiLanguage } from './language';

type P = { id: string; name: string; price: number; stock: number | null; sellOutOfStock?: boolean; hasVariants?: boolean; variants?: { id: string; name: string; price: number; stock: number }[] };
const CATALOGUE: P[] = [
  { id: 'p1', name: 'QA 23/11 photos', price: 5000, stock: 9 },
  { id: 'p2', name: 'Recette H-22 produit B', price: 2000, stock: 0, sellOutOfStock: true },
  { id: 'p3', name: 'Recette H-22 produit C', price: 2500, stock: 0 },
  { id: 'p4', name: 'Recette H-26 à refuser', price: 1000, stock: 20 },
  { id: 'p5', name: 'Satin dress', price: 2000, stock: 20, hasVariants: true, variants: [{ id: 'v1', name: 'rouge', price: 2000, stock: 10 }, { id: 'v2', name: 'vert', price: 2400, stock: 10 }] },
  { id: 'p6', name: 'Website Development', price: 30000, stock: null },
];
const facts = (customerText: string, lang: AiLanguage = 'fr', o: { catalogueFull?: boolean; products?: P[] } = {}) =>
  buildGuardFacts({
    lang,
    products: (o.products ?? CATALOGUE).map((p) => ({ sku: 'S', oldPrice: null, also: [], description: null, imageUrl: null, hasVariants: false, variants: [], sellOutOfStock: false, ...p })) as never,
    shopTexts: [],
    freeDeliveryThreshold: null,
    agentName: null,
    shopName: 'test shop',
    customerText,
    answeredBefore: true,
    freshStart: false,
    catalogueFull: o.catalogueFull ?? true,
  });

describe('UX-080 the product list the customer asks for', () => {
  it('reads the question in the four languages, and nothing else as a list request', () => {
    for (const q of ['quels produits vous avez', 'Quels sont vos produits ?', 'vous vendez quoi', 'c’est quoi vos articles', 'montrez-moi vos produits', 'wach 3andkom', 'wach 3andkom men produits', 'واش عندكم', 'واش هي المنتجات لي عندكم', 'what do you sell?', 'which products do you have', 'show me your products']) expect([q, listAsked(q)]).toEqual([q, true]);
    for (const q of ['je veux le pantalon gris foncé', 'ch7al soum ta3 satin dress', 'slt', 'où est ma commande', 'quel est le prix de ce produit', 'wach 3andkom livraison l Oran', 'this product is nice']) expect([q, listAsked(q)]).toEqual([q, false]);
  });

  it('every orderable product is listable (in stock, service, sold beyond its stock); the out-of-stock one is not', () => {
    const f = facts('quels produits vous avez');
    expect(f.listable?.map((p) => p.name)).toEqual(['QA 23/11 photos', 'Recette H-22 produit B', 'Recette H-26 à refuser', 'Satin dress', 'Website Development']);
    expect(f.listable?.find((p) => p.name === 'Satin dress')).toMatchObject({ price: 2000, from: true });
  });

  it('a list that leaves products out is completed by the server, before its closing question — no corrective model turn', () => {
    const f = facts('quels produits vous avez');
    const reply = 'On a en stock : QA 23/11 photos à 5 000 DA et Satin dress à 2 000 DA (rouge ou vert). Lequel te plaît ?';
    const violations = checkReply(reply, f);
    expect(violations.map((v) => v.rule)).toEqual(['list_incomplete']);
    const fixed = enforceReply(reply, violations, f, { hasCards: false }).reply;
    expect(fixed).toBe('On a en stock : QA 23/11 photos à 5 000 DA et Satin dress à 2 000 DA (rouge ou vert). On a aussi : Recette H-22 produit B à 2 000 DA, Recette H-26 à refuser à 1 000 DA et Website Development à 30 000 DA. Lequel te plaît ?');
    // the completed list passes
    expect(checkReply(fixed, f)).toEqual([]);
  });

  it('the product sold beyond its stock is no forbidden offer in the list the customer asks for; it still is as an alternative', () => {
    const sentence = ['On a Recette H-22 produit B à 2 000 DA.'];
    expect(unavailableOffers(sentence, facts('quels produits vous avez'))).toEqual([]);
    expect(unavailableOffers(sentence, facts('vous avez des lunettes de soleil ?'))).toEqual([0]);
    // an out-of-stock product stays out of the list
    expect(unavailableOffers(['On a Recette H-22 produit C à 2 500 DA.'], facts('quels produits vous avez'))).toEqual([0]);
  });

  it('nothing is added when the customer did not ask for the list, when the reply names one product only, or for a long / partial catalogue', () => {
    const two = 'On a QA 23/11 photos à 5 000 DA et Satin dress à 2 000 DA.';
    expect(checkReply(two, facts('je cherche une robe'))).toEqual([]);
    expect(checkReply('On a Satin dress à 2 000 DA. Tu la veux en rouge ou en vert ?', facts('quels produits vous avez'))).toEqual([]);
    expect(checkReply(two, facts('quels produits vous avez', 'fr', { catalogueFull: false }))).toEqual([]);
    const many = Array.from({ length: 16 }, (_, i) => ({ id: `m${i}`, name: `Article numero ${i + 1}`, price: 1000 + i, stock: 5 }));
    expect(facts('quels produits vous avez', 'fr', { products: many }).listable).toBeUndefined();
  });

  it('the added sentence follows the language of the reply', () => {
    const left = facts('واش عندكم').listable!.filter((p) => ['Recette H-26 à refuser', 'Satin dress'].includes(p.name));
    expect(alsoSentence(left, 'ar')).toBe('وعندنا ثاني: Recette H-26 à refuser بـ 1 000 دج و Satin dress ابتداء من 2 000 دج.');
    expect(alsoSentence(left, 'arabizi')).toBe('3andna tani: Recette H-26 à refuser b 1 000 DA w Satin dress men 2 000 DA.');
    expect(alsoSentence(left, 'en')).toBe('We also have: Recette H-26 à refuser at 1 000 DA and Satin dress from 2 000 DA.');
    expect(splitSentences(alsoSentence(left, 'fr'))).toHaveLength(1);
  });
});

describe('UX-080 live 23/11: a product named without the part of its name in brackets is named', () => {
  const products: P[] = [
    { id: 'a', name: 'QA 23/11 photos', price: 5000, stock: 9 },
    { id: 'b', name: 'Satin dress', price: 2000, stock: 20 },
    { id: 'c', name: 'Website Development (تصميم وتطوير مواقع إلكترونية)', price: 30000, stock: null },
  ];
  it('« Website Development : service …, 30 000 DA » is not added a second time; the Arabic part alone names it too', () => {
    const f = facts('quels produits vous avez', 'fr', { products });
    expect(checkReply('Voici ce qu’on propose :\n- QA 23/11 photos : 5 000 DA\n- Satin dress : 2 000 DA\n- Website Development : service de création de sites web, 30 000 DA\nQuelque chose vous plaît ?', f)).toEqual([]);
    expect(checkReply('عندنا QA 23/11 photos بـ 5 000 دج، Satin dress بـ 2 000 دج وخدمة تصميم وتطوير مواقع إلكترونية بـ 30 000 دج.', facts('واش عندكم', 'ar', { products }))).toEqual([]);
  });
  it('the added sentence takes its own line in a reply written as lines', () => {
    const f = facts('quels produits vous avez', 'fr', { products });
    const reply = 'Voici ce qu’on propose :\n- QA 23/11 photos : 5 000 DA\n- Satin dress : 2 000 DA\nQuelque chose vous plaît ?';
    expect(enforceReply(reply, checkReply(reply, f), f, { hasCards: false }).reply).toBe('Voici ce qu’on propose :\n- QA 23/11 photos : 5 000 DA\n- Satin dress : 2 000 DA\nOn a aussi : Website Development (تصميم وتطوير مواقع إلكترونية) à 30 000 DA.\nQuelque chose vous plaît ?');
  });
});

describe('UX-080 live 24/11: a reply that is itself the list counts as one, whatever the wording of the question', () => {
  it('the question typed backwards: the sold-beyond-stock product stays in the list, and the products left out are added', () => {
    const f = facts('؟ مكدنع يللا تاجتنملا يهام', 'ar');
    const reply = 'هاذي المنتجات اللي عندنا: QA 23/11 photos بـ 5 000 دج، Recette H-22 produit B بـ 2 000 دج، Satin dress بـ 2 000 دج. واش حبيت حاجة منهم؟';
    expect(unavailableOffers(splitSentences(reply), f)).toEqual([]);
    const v = checkReply(reply, f);
    expect(v.map((x) => x.rule)).toEqual(['list_incomplete']);
    const fixed = enforceReply(reply, v, f, { hasCards: false }).reply;
    expect(fixed).toContain('Recette H-26 à refuser');
    expect(fixed).toContain('Website Development');
    expect(checkReply(fixed, f).map((x) => x.rule)).toEqual([]);
  });
  it('two products named for a question that is no list request stay as they are', () => {
    expect(checkReply('On a QA 23/11 photos à 5 000 DA et Satin dress à 2 000 DA.', facts('je cherche un cadeau'))).toEqual([]);
  });
});
