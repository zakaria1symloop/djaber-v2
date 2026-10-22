// 04-ai-pipeline §3 — every prompt section is a pure function with a snapshot; the builder keeps their order and the
// token budget. A change of wording shows up here as a snapshot diff (and triggers the evals in CI).
import { PromptBuilder, SECTION_ORDER, isOutOfHours, estimateTokens, type HistoryMessage } from './prompt-builder';
import type { PromptContext } from './prompt.types';
import { cardTemplateSection, closingSection, crossSellSection, handoffSection, imageRuleSection } from './sections/behaviour';
import { catalogueSection, productBlock } from './sections/catalogue';
import { languageSection, outputContractSection } from './sections/contract';
import { identitySection } from './sections/identity';
import { customInstructionsSection, faqSection, policiesSection } from './sections/knowledge';
import { deliverySection, orderRulesSection } from './sections/orders';

const P1 = '11111111-1111-7111-8111-111111111111';
const P2 = '22222222-2222-7222-8222-222222222222';
const V1 = '33333333-3333-7333-8333-333333333333';
const V2 = '44444444-4444-7444-8444-444444444444';

const ctx = (over: Partial<PromptContext> = {}, agent: Partial<PromptContext['agent']> = {}): PromptContext => ({
  agent: {
    name: 'Vendeur Pro',
    displayName: 'Lina',
    personality: 'friendly',
    customInstructions: '- Toujours proposer la livraison stop-desk.',
    productCardTemplate: null,
    closingInstructions: null,
    humanHandoffRules: null,
    imageRecognition: true,
    policies: {},
    capabilities: {},
    orderFields: [],
    maxQtyPerOrder: null,
    maxAmountPerOrder: null,
    riskyClientBehavior: null,
    recapMode: null,
    handoffRules: [],
    handoffKeywords: [],
    businessHours: null,
    outOfStockBehavior: 'suggest_alternative',
    showMissingVariants: true,
    ...agent,
  },
  workspace: { name: 'Boutique Yasmine', freeDeliveryThreshold: 8000, senderWilaya: 'Alger', systemMessages: { out_of_stock: { fr: 'Désolé, {product} est en rupture de stock pour le moment.', ar: 'عذرًا، {product} غير متوفر حاليًا.', en: 'Sorry, {product} is out of stock right now.' } } },
  faqs: [
    { question: 'Livrez-vous le vendredi ?', answer: 'Non, du samedi au jeudi.' },
    { question: 'Peut-on échanger ?', answer: 'Oui, sous 7 jours.' },
  ],
  catalogue: {
    count: 2,
    full: true,
    products: [
      { id: P1, name: 'Robe satin bordeaux', sku: 'ROB-001', price: 4500, oldPrice: 5200, stock: 7, description: 'Robe longue en satin,\n  coupe droite.', hasVariants: true, variants: [{ id: V1, name: 'S', price: 4500, stock: 4 }, { id: V2, name: 'M', price: 4500, stock: 3 }], imageUrl: null, imageKey: null, sellOutOfStock: false, category: 'Robes', also: [{ id: P2, name: 'Ceinture dorée', price: 900, reason: 'assortie à la robe' }] },
      { id: P2, name: 'Ceinture dorée', sku: 'CEI-002', price: 900, oldPrice: null, stock: null, description: null, hasVariants: false, variants: [], imageUrl: null, imageKey: null, sellOutOfStock: false, category: null, also: [] },
    ],
  },
  lang: 'fr',
  locale: 'fr',
  now: new Date('2026-10-12T10:00:00Z'),
  outOfHours: false,
  unclearStreak: 0,
  descriptionMax: 300,
  ...over,
});

describe('prompt sections (04-ai-pipeline §3)', () => {
  it('§3.1 identity & personality', () => {
    expect(identitySection(ctx())).toMatchSnapshot();
    expect(identitySection(ctx({}, { displayName: null, personality: 'technical' }))).toContain('You are "Vendeur Pro", the sales assistant of "Boutique Yasmine". Personality: technical');
  });

  it('§3.2 shop policies (empty ⇒ omitted; out of hours appended)', () => {
    expect(policiesSection(ctx())).toBe('');
    expect(policiesSection(ctx({ outOfHours: true }, { policies: { delivery: 'Livraison 58 wilayas, 2 à 5 jours', payment: 'Paiement à la livraison', returns: '  ', hours: 'Sam–Jeu 9h–18h' } }))).toMatchSnapshot();
    expect(policiesSection(ctx({}, { policies: { delivery: 'x'.repeat(600) } }))).toHaveLength('SHOP POLICIES\nDELIVERY: '.length + 500);
  });

  it('§3.3 custom instructions', () => {
    expect(customInstructionsSection(ctx())).toMatchSnapshot();
    expect(customInstructionsSection(ctx({}, { customInstructions: '  ' }))).toBe('');
  });

  it('§3.4 FAQ (≤ 50 entries, truncated to the budget)', () => {
    expect(faqSection(ctx())).toMatchSnapshot();
    expect(faqSection(ctx({ faqs: [] }))).toBe('');
    expect(faqSection(ctx(), 60)).toBe('FAQ\nQ: Livrez-vous le vendredi ?\nA: Non, du samedi au jeudi.');
    expect(faqSection(ctx({ faqs: Array.from({ length: 80 }, (_, i) => ({ question: `Q${i}`, answer: 'A' })) })).match(/^Q: /gm)).toHaveLength(50);
  });

  it('§3.5 catalogue: product block, full list, retrieval mode, out-of-stock rules', () => {
    expect(productBlock(ctx().catalogue.products[0]!, 1, 300)).toMatchSnapshot();
    expect(catalogueSection(ctx())).toMatchSnapshot();
    const retrieval = catalogueSection(ctx({ catalogue: { count: 214, full: false, products: [ctx().catalogue.products[1]!] }, lang: 'ar' }, { outOfStockBehavior: 'say_unavailable', showMissingVariants: false }));
    expect(retrieval).toMatchSnapshot();
    expect(retrieval).toContain('CATALOGUE: 214 products. Use search_products before naming any product.');
    expect(retrieval).toContain('OUT_OF_STOCK_SENTENCE: "عذرًا، {product} غير متوفر حاليًا."');
    expect(catalogueSection(ctx({ catalogue: { count: 0, full: true, products: [] } }))).toContain('(no product available: do not invent any)');
    expect(catalogueSection(ctx({ descriptionMax: 10 }))).toContain('\nRobe longu\n');
  });

  it('§3.6 delivery and §3.7 order-taking rules', () => {
    expect(deliverySection(ctx())).toMatchSnapshot();
    expect(deliverySection(ctx({ workspace: { ...ctx().workspace, freeDeliveryThreshold: null, senderWilaya: null } }))).toBe('DELIVERY FEES: use quote_delivery.\nNever state a delivery fee that did not come from the tool.');
    expect(orderRulesSection(ctx())).toMatchSnapshot();
    const custom = orderRulesSection(ctx({}, { maxQtyPerOrder: 3, maxAmountPerOrder: 20000, riskyClientBehavior: 'handoff', recapMode: 'when_unsure', orderFields: [{ key: 'product', required: true, locked: true }, { key: 'quantity', required: true, locked: true }, { key: 'name', required: true, locked: true }, { key: 'phone', required: true, locked: true }, { key: 'wilaya', required: true, locked: true }, { key: 'commune', required: false, locked: false }, { key: 'address', required: true, locked: false }, { key: 'note', required: false, locked: false }] }));
    expect(custom).toContain('Required fields, in this order: product+variant → quantity → name → phone (10 digits, 05/06/07) → wilaya → address or stop-desk');
    expect(custom).toContain('Optional fields: commune, note');
    expect(custom).toContain('MAX_QTY_PER_ORDER=3\nMAX_AMOUNT=20000 DA');
    expect(custom).toContain('RISKY_CLIENT_POLICY=handoff\nRECAP=when_unsure');
  });

  it('§3.8 image rule, §3.9 cross-sell, §3.10 card template, §3.11 closing', () => {
    expect(imageRuleSection(ctx())).toMatchSnapshot();
    expect(imageRuleSection(ctx({}, { imageRecognition: false }))).toBe('');
    expect(crossSellSection(ctx())).toMatchSnapshot();
    expect(crossSellSection(ctx({}, { capabilities: { crossSell: false } }))).toBe('');
    // M11 dedicated recommendations section (REC-01): the pairs of the catalogue products, the per-turn cap, the output field
    const cs = crossSellSection(ctx());
    expect(cs).toContain('RECOMMENDATION PAIRS (source → recommended):');
    expect(cs).toContain('Never more than 3 suggestions in one reply');
    expect(cs).toContain('"recommendations"');
    expect(crossSellSection(ctx({ catalogue: { count: 214, full: false, products: [] } }))).toContain('only the ALSO lines returned by search_products / get_product');
    expect(cardTemplateSection(ctx())).toMatchSnapshot();
    expect(cardTemplateSection(ctx({}, { productCardTemplate: '⭐ {name} : {price} DA ({stock})' }))).toContain('use this template: ⭐ {name} : {price} DA ({stock})');
    expect(closingSection(ctx())).toBe('');
    expect(closingSection(ctx({}, { closingInstructions: 'Remercier et souhaiter une bonne journée.' }))).toBe('CLOSING\nRemercier et souhaiter une bonne journée.');
  });

  it('§3.12 handoff rules: built-ins, disabled rules, keywords, shop rules, unclear streak', () => {
    expect(handoffSection(ctx())).toMatchSnapshot();
    const custom = handoffSection(ctx({ unclearStreak: 2 }, { handoffRules: [{ kind: 'anger', enabled: false }, { kind: 'refund', enabled: true }], handoffKeywords: ['facture', ' grossiste '], humanHandoffRules: 'Transférer toute demande de devis.' }));
    expect(custom).toMatchSnapshot();
    expect(custom).not.toContain('- angry:');
    expect(custom).toContain('HANDOFF_KEYWORDS: facture, grossiste');
    expect(custom).toContain('UNCLEAR_STREAK=2');
    expect(handoffSection(ctx())).not.toContain('- keyword:'); // no keyword configured
  });

  it('§3.13 language rule (strict) and §3.14 output contract', () => {
    expect(languageSection(ctx({ lang: 'arabizi' }))).toMatchSnapshot();
    expect(languageSection(ctx({ lang: 'ar' }))).toContain('DETECTED_LANGUAGE of the last customer message: Arabic script (Algerian darija)');
    const out = outputContractSection(ctx());
    expect(out).toMatchSnapshot();
    expect(out.endsWith('Return only the structured output.')).toBe(true);
    expect(JSON.parse(out.split('\n')[2]!)).toMatchObject({ required: ['reply', 'status', 'intent', 'productCards', 'recommendations', 'confidence'], additionalProperties: false });
  });
});

describe('PromptBuilder', () => {
  const { descriptionMax: _d, ...base } = ctx();
  const history: HistoryMessage[] = [
    { author: 'customer', text: 'Salam' },
    { author: 'ai', text: 'Bonjour ! Comment puis-je vous aider ?' },
    { author: 'human', text: 'Je reprends la main.', humanName: 'Nadia' },
    { author: 'customer', text: 'merci' },
    { author: 'customer', text: 'une question' },
  ];

  it('keeps the 14 sections in order (empty ones are omitted) and maps the conversation to roles', () => {
    const p = PromptBuilder.build(base, history, 'la robe est dispo en M ?\n[image]\nIMAGE RESULT: unsure', { contextTokens: 128_000, maxTokens: 1200 });
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(SECTION_ORDER.filter((k) => keys.includes(k)));
    expect(keys).toEqual(['identity', 'custom_instructions', 'faq', 'catalogue', 'delivery', 'order_rules', 'image_rule', 'cross_sell', 'card_template', 'handoff', 'language', 'output_contract']);
    expect(p.system).toBe(p.sections.map((s) => s.text).join('\n\n'));
    expect(p.system).toMatchSnapshot();
    // human replies are prefixed, neighbours of the same role are merged, the batch is the final user message
    expect(p.messages).toEqual([
      { role: 'user', content: 'Salam' },
      { role: 'assistant', content: 'Bonjour ! Comment puis-je vous aider ?\n[human: Nadia] Je reprends la main.' },
      { role: 'user', content: 'merci\nune question\nla robe est dispo en M ?\n[image]\nIMAGE RESULT: unsure' },
    ]);
    expect(p.dropped).toEqual({ history: 0, faqChars: 0, descriptions: false });
    expect(p.estimatedTokens).toBe(estimateTokens(p.system) + p.messages.reduce((n, m) => n + estimateTokens((m as { content: string }).content), 0));
  });

  it('only the last 30 messages are kept; over budget: oldest history first, then the FAQ, then descriptions cut to 100 characters', () => {
    const long: HistoryMessage[] = Array.from({ length: 45 }, (_, i) => ({ author: i % 2 ? 'ai' : 'customer', text: `message ${i} ${'x'.repeat(400)}` }));
    const roomy = PromptBuilder.build(base, long, 'fin', { contextTokens: 128_000, maxTokens: 1200 });
    expect(roomy.messages).toHaveLength(30); // 30 history messages; the batch joins the last customer message
    expect((roomy.messages.at(-1) as { content: string }).content.endsWith(`${'x'.repeat(400)}\nfin`)).toBe(true);
    expect((roomy.messages[0] as { content: string }).content.startsWith('message 15 ')).toBe(true);

    const big = { ...base, faqs: Array.from({ length: 40 }, (_, i) => ({ question: `Question ${i} ?`, answer: 'r'.repeat(300) })), catalogue: { ...base.catalogue, products: base.catalogue.products.map((p) => ({ ...p, description: 'd'.repeat(300) })) } };
    const tight = PromptBuilder.build(big, long, 'fin', { contextTokens: 2400, maxTokens: 500 });
    expect(tight.dropped.history).toBe(30);
    expect(tight.messages).toEqual([{ role: 'user', content: 'fin' }]);
    expect(tight.dropped.faqChars).toBeGreaterThan(0);
    expect(tight.dropped.descriptions).toBe(true);
    expect(tight.system).toContain(`\n${'d'.repeat(100)}\n`);
    expect(tight.system).not.toContain('d'.repeat(101));
    // the identity, the catalogue and the output contract are never dropped
    expect(tight.sections.map((s) => s.key)).toEqual(expect.arrayContaining(['identity', 'catalogue', 'language', 'output_contract']));
  });

  it('business hours are evaluated in Africa/Algiers (UTC+1), overnight ranges included', () => {
    const hours = { from: '09:00', to: '18:00', days: [0, 1, 2, 3, 4] }; // Sunday → Thursday
    expect(isOutOfHours(null, new Date())).toBe(false);
    expect(isOutOfHours(hours, new Date('2026-10-12T08:30:00Z'))).toBe(false); // Monday 09:30 local
    expect(isOutOfHours(hours, new Date('2026-10-12T07:59:00Z'))).toBe(true); // Monday 08:59 local
    expect(isOutOfHours(hours, new Date('2026-10-12T17:00:00Z'))).toBe(true); // Monday 18:00 local
    expect(isOutOfHours(hours, new Date('2026-10-16T10:00:00Z'))).toBe(true); // Friday
    const night = { from: '20:00', to: '02:00', days: [1] }; // Monday evening → Tuesday 02:00
    expect(isOutOfHours(night, new Date('2026-10-12T20:00:00Z'))).toBe(false); // Monday 21:00
    expect(isOutOfHours(night, new Date('2026-10-13T00:30:00Z'))).toBe(false); // Tuesday 01:30
    expect(isOutOfHours(night, new Date('2026-10-13T02:00:00Z'))).toBe(true); // Tuesday 03:00
  });
});

describe('product sold at zero stock (PV 22/10)', () => {
  const base = { id: 'p-x', name: 'Coffret parfum', sku: 'COF-1', price: 3000, oldPrice: null, description: null, hasVariants: false, variants: [], imageUrl: null, imageKey: null, category: null, also: [] };
  it('at STOCK 0 the block tells the model to take the order; in stock or switch off ⇒ no line', () => {
    expect(productBlock({ ...base, stock: 0, sellOutOfStock: true }, 1, 200)).toContain('ORDERABLE AT ZERO STOCK');
    expect(productBlock({ ...base, stock: 4, sellOutOfStock: true }, 1, 200)).not.toContain('ORDERABLE AT ZERO STOCK');
    expect(productBlock({ ...base, stock: 0, sellOutOfStock: false }, 1, 200)).not.toContain('ORDERABLE AT ZERO STOCK');
  });
});
