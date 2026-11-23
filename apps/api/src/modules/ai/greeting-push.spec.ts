// Houssem live 23/11 UX-079 (H-07): « slt » (16:06) ⇒ « Je peux te réserver 1 QA 23/11 photos à 5 000 DA, livraison à Alger possible.
// Tu veux que je la réserve ? »; « hello » (16:09) ⇒ « Hello! What can I do for you? If you'd like, I can reserve 1 QA 23/11 photos at
// 5 000 DA for you, with delivery to Alger. » — a message that is only a greeting gets a greeting back, nothing offered.
import { buildGuardFacts, checkReply, enforceReply, greetingOnly } from './reply-guard';
import type { AiLanguage } from './language';

const facts = (customerText: string, lang: AiLanguage = 'fr') =>
  buildGuardFacts({
    lang,
    products: [{ id: 'p1', name: 'QA 23/11 photos', sku: 'S', price: 5000, oldPrice: 5500, hasVariants: false, variants: [], also: [], description: null, imageUrl: null, stock: 9, sellOutOfStock: false }] as never,
    shopTexts: [],
    freeDeliveryThreshold: null,
    agentName: null,
    shopName: 'test shop',
    customerText,
    answeredBefore: true,
    freshStart: false,
  });
const fixed = (reply: string, customerText: string, lang: AiLanguage = 'fr') => {
  const f = facts(customerText, lang);
  const v = checkReply(reply, f);
  return { rules: [...new Set(v.map((x) => x.rule))], reply: v.length ? enforceReply(reply, v, f, { hasCards: false }).reply : reply };
};

describe('UX-079 nothing is pushed on a plain greeting', () => {
  it('reads a message that is only a greeting', () => {
    for (const t of ['slt', 'Slt !', 'cc', 'hello', 'Hello 👋', 'salam', 'salam khouya', 'bonjour ça va ?', 'السلام عليكم', 'bjr', 'salam alikoum wa rahmatou allah']) expect([t, greetingOnly(t)]).toEqual([t, true]);
    for (const t of ['salam sh7ale', 'slt je veux la robe', 'bonjour vous livrez à Oran ?', 'hello what do you sell', 'oui', 'ça va', '']) expect([t, greetingOnly(t)]).toEqual([t, false]);
  });

  it('« slt »: the offer is dropped, a short greeting is left (the customer’s language)', () => {
    expect(fixed('Je peux te réserver 1 QA 23/11 photos à 5 000 DA, livraison à Alger possible. Tu veux que je la réserve ?', 'slt')).toEqual({ rules: ['greeting_push'], reply: 'Bonjour ! Comment puis-je vous aider ?' });
    expect(fixed("Hello! What can I do for you? If you'd like, I can reserve 1 QA 23/11 photos at 5 000 DA for you, with delivery to Alger.", 'hello', 'en')).toEqual({ rules: ['greeting_push'], reply: 'Hello! What can I do for you?' });
  });

  it('a greeting answered with a greeting passes; a real question keeps its offer', () => {
    expect(fixed('Salut ! Comment je peux t’aider ?', 'slt')).toEqual({ rules: [], reply: 'Salut ! Comment je peux t’aider ?' });
    const answer = 'QA 23/11 photos est à 5 000 DA. Tu veux que je te la réserve ?';
    expect(fixed(answer, 'slt c’est combien QA 23/11 photos')).toEqual({ rules: [], reply: answer });
  });
});
