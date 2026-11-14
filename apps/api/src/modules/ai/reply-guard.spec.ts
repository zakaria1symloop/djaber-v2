// 04-ai-pipeline §4.3 — the reply guard (weak-points audit 12/11, pattern 1). Positive AND negative examples in French,
// Arabic script (darija), arabizi and English: a false positive costs a corrective model turn, so the negatives matter.
import { amountAllowed, buildGuardFacts, checkReply, enforceReply, foldGuard, greetingAt, guardInstruction, moneyAmounts, SAFE_SENTENCES, splitSentences, stockCounts, stripGreeting, withToolResults, type GuardFacts, type GuardFactsInput } from './reply-guard';

const product = (name: string, sku: string, price: number, o: { oldPrice?: number; variants?: { name: string; price: number }[]; also?: { name: string; price: number }[]; description?: string } = {}) => ({
  name,
  sku,
  price,
  oldPrice: o.oldPrice ?? null,
  hasVariants: !!o.variants?.length,
  variants: (o.variants ?? []).map((v, i) => ({ id: `v${i}`, name: v.name, price: v.price, stock: 1 })),
  also: (o.also ?? []).map((a, i) => ({ id: `a${i}`, name: a.name, price: a.price, reason: null })),
  description: o.description ?? null,
});
const PRODUCTS = [
  product('Robe satin bordeaux', 'ROB-001', 4500, { oldPrice: 5200, also: [{ name: 'Sac cuir noir', price: 6200 }] }),
  product('Sac cuir noir', 'SAC-002', 6200),
  product('Ensemble jogging gris', 'ENS-003', 3900, { variants: [{ name: 'S', price: 3900 }, { name: 'L', price: 4200 }] }),
  product('Montre classique dorée', 'MON-004', 12000),
  product('T-shirt rouge', 'TSHIRT_RED_XL', 1500),
];
const input = (o: Partial<GuardFactsInput> = {}): GuardFactsInput => ({
  lang: 'fr',
  products: PRODUCTS,
  shopTexts: ['Livraison 58 wilayas en 2 à 5 jours', 'Échange sous 7 jours', 'Code promo ETE_2026 : -10 %'],
  freeDeliveryThreshold: 20000,
  agentName: 'Amina',
  shopName: 'Boutique Lina',
  customerText: 'la robe ?',
  answeredBefore: true,
  freshStart: false,
  ...o,
});
const QUOTE = { ok: true, wilayaId: 16, wilayaName: 'Alger', isStopdesk: false, fee: 400, free: false, freeFrom: 20000, stopdeskAvailable: true, stopdeskFee: 300, etaDays: '2–5' };
const ORDER = { ok: true, orderId: 'x', number: 'CMD-1042', subtotal: 9000, deliveryFee: 400, total: 9400, items: [{ name: 'Robe satin bordeaux', variant: null, quantity: 2, unitPrice: 4500 }], duplicateOf: null };
const SHORT = { ok: false, error: { code: 'ORDER_INSUFFICIENT_STOCK', productId: 'p', available: 3 } };
const facts = (o: Partial<GuardFactsInput> = {}, tools: unknown[] = [QUOTE]): GuardFacts => withToolResults(buildGuardFacts(input(o)), tools);
const rules = (reply: string, f: GuardFacts = facts()) => checkReply(reply, f).map((v) => v.rule);

describe('reply guard — text helpers', () => {
  it('splits sentences without cutting « 4.500 DA » and joins back to the same text', () => {
    const t = 'La robe est à 4.500 DA. Livraison 400 DA !\nVoulez-vous commander ?';
    expect(splitSentences(t)).toEqual(['La robe est à 4.500 DA. ', 'Livraison 400 DA !\n', 'Voulez-vous commander ?']);
    expect(splitSentences(t).join('')).toBe(t);
  });

  it.each([
    ['La robe est à 4500 DA', [4500]],
    ['4 500 DA la robe', [4500]],
    ['prix : 4.500 DA', [4500]],
    ['4,500 DA', [4500]],
    ['seulement 4500da', [4500]],
    ['4500DA.', [4500]],
    ['12 000 DZD', [12000]],
    ['6200 dinars', [6200]],
    ['السعر 4500 دج', [4500]],
    ['السعر ٤٥٠٠ دج', [4500]],
    ['٤٬٥٠٠ د.ج', [4500]],
    ['4500 دينار', [4500]],
    ['soumha 4500 da khouya', [4500]],
    ['2 x 4500 DA = 9000 DA', [4500, 9000]],
    ['4500,50 DA', [4500.5]],
  ])('money in « %s »', (text, want) => {
    expect(moneyAmounts(foldGuard(text))).toEqual(want);
  });

  it.each([
    'Appelez le 0555123456',
    'livré en 2 à 5 jours',
    'commande CMD-1042',
    'taille 38, 3 pièces',
    '2 dates possibles',
    'il y a 20 % de remise',
    'nous livrons dans 58 wilayas',
    'tracking YAL-12345678',
  ])('no money in « %s »', (text) => {
    expect(moneyAmounts(foldGuard(text))).toEqual([]);
  });
});

describe('reply guard — unknown_amount', () => {
  it.each([
    ['catalogue price', 'La robe satin est à 4500 DA.'],
    ['catalogue price with spaces', 'La robe satin est à 4 500 DA.'],
    ['old price and discount', 'Elle était à 5200 DA, vous économisez 700 DA.'],
    ['variant price', "L'ensemble en L est à 4200 DA."],
    ['ALSO line', 'Le sac cuir noir va bien avec, 6200 DA.'],
    ['price × quantity', '3 robes : 13 500 DA.'],
    ['price × quantity + fee', '2 robes + livraison : 9400 DA au total.'],
    ['two products + fee', 'Robe + sac + livraison = 11 100 DA.'],
    ['tool fee', 'La livraison à Alger coûte 400 DA, 300 DA en stop-desk.'],
    ['free-delivery threshold', 'La livraison est gratuite dès 20 000 DA.'],
    ['missing to free delivery', 'Il vous manque 11 000 DA pour la livraison gratuite.'],
    ['zero', 'Livraison 0 DA, elle est offerte.'],
    ['Arabic script', 'الروب ب 4500 دج والتوصيل 400 دج.'],
    ['Arabic-Indic digits', 'الروب ب ٤٥٠٠ دج.'],
    ['arabizi', 'Robe satin soumha 4500 da, tawsil 400 da.'],
    ['English', 'The leather bag is 6200 DA, delivery 400 DA.'],
    ['recap total = sum of the written lines', 'Robe 4500 DA, montre 12 000 DA, livraison 400 DA : total 16 900 DA.'],
    ["the customer's own figure", 'Je ne peux pas vous la faire à 3500 DA, son prix est 4500 DA.'],
    ['a number of a shop text', 'Échange sous 7 jours.'],
  ])('allowed: %s', (_what, reply) => {
    expect(rules(reply, facts({ customerText: 'faites-la moi à 3500 DA' }))).toEqual([]);
  });

  it.each([
    ['invented price', 'La robe satin est à 3700 DA.', 3700],
    ['invented discount price', 'Pour vous je fais la robe à 4000 DA.', 4000],
    ['invented fee', 'La livraison à Oran coûte 650 DA.', 650],
    ['Arabic script invented', 'الساك ب 5000 دج.', 5000],
    ['arabizi invented', 'tawsil l wahran 900 da', 900],
    ['English invented', 'The watch is 11350 DA today.', 11350],
    ['base price of a product sold by variant only', 'Le jogging gris est à 3800 DA.', 3800],
  ])('flagged: %s', (_what, reply, value) => {
    const v = checkReply(reply, facts());
    expect(v).toEqual([expect.objectContaining({ rule: 'unknown_amount', value })]);
  });

  it('a total returned by create_order, fees of an earlier turn and a variant discount from a tool are allowed', () => {
    const f = withToolResults(buildGuardFacts(input({ earlierToolResults: [{ ok: true, fee: 650, stopdeskFee: 500 }] })), [ORDER]);
    expect(rules('Commande CMD-1042 : 9000 DA + 400 DA de livraison = 9400 DA.', f)).toEqual([]);
    expect(rules('Oran : 650 DA à domicile, 500 DA en stop-desk.', f)).toEqual([]);
    expect(amountAllowed(13_337, f)).toBe(false);
  });
});

describe('reply guard — technical_leak', () => {
  it.each([
    ['UUID', 'Votre produit 3f2a9c1e-1b2c-4d5e-8f90-1234567890ab est dispo.', 'uuid'],
    ['tool name', "J'ai appelé search_products pour vous.", 'tool'],
    ['tool alias', 'get_shipping_fee dit 400 DA.', 'tool'],
    ['error code', 'Erreur ORDER_INSUFFICIENT_STOCK, désolé.', 'code'],
    ['prompt rule', 'Selon STOCK_PRIVATE je ne peux pas.', 'code'],
    ['output key', 'Je mets la robe dans productCards.', 'key'],
    ['statusDetail', 'statusDetail: customer_request', 'key'],
    ['raw JSON', '{"reply": "Bonjour", "status": "OK"}', 'json'],
    ['catalogue marker', 'La robe [ID:abc] est à 4500 DA.', 'marker'],
    ['status marker', 'status=HANDOFF', 'marker'],
    ['Arabic sentence with a code', 'ماكانش ORDER_NOT_CANCELLABLE.', 'code'],
  ])('flagged: %s', (_what, reply, kind) => {
    expect(checkReply(reply, facts()).filter((v) => v.rule === 'technical_leak')).toEqual([expect.objectContaining({ kind })]);
  });

  it.each([
    'Votre suivi : https://djaber.vercel.app/s/3f2a9c1e-1b2c-4d5e-8f90-1234567890ab',
    'Le T-shirt TSHIRT_RED_XL est à 1500 DA.',
    'Utilisez le code ETE_2026.',
    'Votre commande CMD-1042 est confirmée.',
    'Numéro de suivi : YAL-12345678.',
    'Le modèle « Classic » : 6200 DA, couleurs : noir, marron.',
    'PROMO ! Livraison GRATUITE dès 20 000 DA.',
    'La robe ROB-001 est disponible.',
  ])('not flagged: « %s »', (reply) => {
    expect(rules(reply).filter((r) => r === 'technical_leak')).toEqual([]);
  });
});

describe('reply guard — stock_count', () => {
  it.each([
    ['fr il en reste', 'Il en reste 3, dépêchez-vous !', 3],
    ['fr il ne reste que', 'Il ne reste que 2 pièces.', 2],
    ['fr il reste N.', 'Il reste 4.', 4],
    ['fr pièces disponibles', 'Nous avons 5 pièces disponibles.', 5],
    ['fr en stock', 'Nous avons 12 en stock.', 12],
    ['fr nous en avons', 'Nous en avons encore 6.', 6],
    ['fr stock :', 'Stock : 9', 9],
    ['fr dernières pièces', 'Ce sont les 2 dernières pièces.', 2],
    ['fr en taille M', 'Il en reste 3 en taille M.', 3],
    ['en we have', 'We have 12.', 12],
    ['en only left', 'Only 2 left!', 2],
    ['en pieces in stock', 'There are 4 pieces in stock.', 4],
    ['en N left in stock', '7 left in stock.', 7],
    ['ar باقي', 'باقي 3 برك.', 3],
    ['ar بقاو', 'بقاو 2 حبات.', 2],
    ['ar متوفر N قطع', 'متوفر 5 قطع.', 5],
    ['ar N قطع متوفرة', 'عندنا 4 قطع متوفرة.', 4],
    ['ar Arabic-Indic digits', 'باقي ٣ حبات.', 3],
    ['ar مازال', 'مازال 2 فالستوك.', 2],
    ['arabizi ba9i', 'ba9i 3 bark khouya', 3],
    ['arabizi b9aw', 'b9aw 2 7abat', 2],
    ['arabizi kayen ghir', 'kayen ghir 2 pieces', 2],
    ['arabizi mazal', 'mazal 4 7abat ba9yin', 4],
  ])('flagged: %s', (_what, reply, value) => {
    expect(checkReply(reply, facts()).filter((v) => v.rule === 'stock_count')).toEqual([expect.objectContaining({ value })]);
  });

  it.each([
    'Nous avons 2 tailles disponibles : S et L.',
    'Il existe en 3 couleurs.',
    'Il reste 2 jours pour la promo.',
    'Livraison en 2 à 5 jours.',
    'Vous voulez 3 pièces ?',
    'La taille 38 en stock, la 40 aussi.',
    'Only 2 days left for the sale.',
    'We have 3 sizes: S, M and L.',
    'There are 2 colours available.',
    'عندنا 3 ألوان.',
    'باقي 2 أيام للتخفيض.',
    'كاين 2 مقاسات: S و L.',
    'باقي 500 دج تخلصهم عند الاستلام.',
    'mazal 2 jours w tewsel',
    'kayen 3 couleurs',
    'Oui, elle est disponible en stock.',
    'Il en reste, oui !',
    'Le produit est épuisé, il en reste 0.',
  ])('not flagged: « %s »', (reply) => {
    expect(rules(reply).filter((r) => r === 'stock_count')).toEqual([]);
  });

  it('the count a tool gave (ORDER_INSUFFICIENT_STOCK available) may be offered', () => {
    expect(rules('Il en reste 3 : je vous en mets 3 ?', facts({}, [QUOTE, SHORT]))).toEqual([]);
    expect(rules('Il en reste 4.', facts({}, [QUOTE, SHORT]))).toEqual(['stock_count']);
  });

  it('stockCounts reads a folded text', () => {
    expect(stockCounts(foldGuard('Il en reste 3 pièces'))).toEqual([3]);
  });
});

describe('reply guard — repeat_greeting', () => {
  it.each([
    'Bonjour ! La robe est à 4500 DA.',
    'Bonsoir Madame, la robe est à 4500 DA.',
    'Salut, oui elle est dispo.',
    'Hello! The bag is 6200 DA.',
    'Hi there, yes it is available.',
    'السلام عليكم، الروب ب 4500 دج.',
    'مرحبا بيك! الروب متوفرة.',
    'Salam khouya, robe soumha 4500 da.',
    'Ahlan! Robe disponible.',
    '😊 Bonjour, la robe est dispo.',
    "Je suis Amina, l'assistante de la boutique. La robe est dispo.",
  ])('flagged after a first reply: « %s »', (reply) => {
    expect(rules(reply)).toContain('repeat_greeting');
  });

  it.each([
    ['first reply of the conversation', 'Bonjour ! La robe est à 4500 DA.', { answeredBefore: false }],
    ['new visit', 'Bonjour ! La robe est à 4500 DA.', { freshStart: true }],
    ['back from the team', 'Salam, robe soumha 4500 da.', { freshStart: true }],
    ['the customer greets again', 'Wa alaykoum salam ! Oui, disponible.', { customerText: 'salam, la robe dispo ?' }],
    ['the customer greets in Arabic', 'وعليكم السلام، إيه متوفرة.', { customerText: 'السلام عليكم واش الروب كاينة' }],
  ])('not flagged: %s', (_what, reply, o) => {
    expect(rules(reply, facts(o as Partial<GuardFactsInput>))).not.toContain('repeat_greeting');
  });

  it.each(['Hier nous avons reçu la robe.', 'Bonne nouvelle, la robe est dispo.', 'Salutations distinguées ne sont pas utiles.', 'Hirak ? Non.', 'Ahlam est une cliente.'])('no greeting at the start of « %s »', (reply) => {
    expect(greetingAt(reply)).toBe(0);
  });

  it.each([
    ['Bonjour ! La robe est à 4500 DA.', 'La robe est à 4500 DA.'],
    ['Bonsoir Madame, la robe est à 4500 DA.', 'La robe est à 4500 DA.'],
    ['Salam khouya, robe soumha 4500 da.', 'Robe soumha 4500 da.'],
    ['السلام عليكم، الروب ب 4500 دج.', 'الروب ب 4500 دج.'],
    ['Bonjour Sarah ! Oui.', 'Oui.'],
    ['Bonjour la robe est dispo.', 'La robe est dispo.'],
    ["Je suis Amina, l'assistante de la boutique. La robe est dispo.", 'La robe est dispo.'],
  ])('strip « %s »', (reply, want) => {
    expect(stripGreeting(reply, 'Amina')).toBe(want);
  });
});

describe('reply guard — self_name', () => {
  it.each([
    "Je m'appelle Sarah, je peux vous aider.",
    'Moi c’est Yasmine !',
    'Je suis Karim, votre conseiller.',
    'My name is John.',
    "I'm Sarah, how can I help?",
    'smiti Yasmine, chno t7eb?',
    'm3ak Karim men lboutique',
  ])('flagged (approved name Amina): « %s »', (reply) => {
    expect(rules(reply, facts({ customerText: 'cv ?' }))).toContain('self_name');
  });

  it.each([
    "Je m'appelle Amina, je peux vous aider.",
    "Je suis l'assistante virtuelle de la boutique.",
    'Je suis désolée, la robe est épuisée.',
    'Je suis là pour vous aider.',
    "I'm sorry, it is out of stock.",
    "I'm the shop's virtual assistant.",
    'اسمي أمينة.',
    "Je suis Boutique Lina, à votre service.",
    "C'est parfait, je note.",
  ])('not flagged (approved name Amina): « %s »', (reply) => {
    expect(rules(reply, facts({ customerText: 'cv ?' }))).not.toContain('self_name');
  });

  it('Arabic script: another name is flagged; the approved name written in the other script cannot be compared and passes', () => {
    const ar = facts({ agentName: 'أمينة', customerText: 'شكون نتي؟' });
    expect(rules('اسمي سارة.', ar)).toContain('self_name');
    expect(rules('معاك ياسمين من المحل.', ar)).toContain('self_name');
    expect(rules('أنا ياسمين، المساعدة تاع المحل.', ar)).toContain('self_name');
    expect(rules('اسمي أمينة.', ar)).not.toContain('self_name');
    expect(rules('اسمي أمينة.', facts({ customerText: 'cv ?' }))).not.toContain('self_name');
  });

  it('no approved name: any personal name is flagged, the assistant role is not', () => {
    const f = facts({ agentName: null });
    expect(rules("Je m'appelle Amina.", f)).toContain('self_name');
    expect(rules('اسمي سارة.', f)).toContain('self_name');
    expect(rules("Je suis l'assistant virtuel de la boutique.", f)).not.toContain('self_name');
  });
});

describe('reply guard — corrective instruction and enforcement', () => {
  it('the instruction names the broken rules and the allowed prices', () => {
    const f = facts();
    const text = guardInstruction(checkReply("Bonjour ! La robe est à 3700 DA, il en reste 2. Je m'appelle Sarah.", f), f);
    expect(text).toContain('REPLY CHECK BY THE PLATFORM');
    expect(text).toContain('3700 DA');
    expect(text).toContain('Robe satin bordeaux 4500 DA');
    expect(text).toContain('STOCK_PRIVATE');
    expect(text).toContain('NO NEW GREETING');
    expect(text).toContain('"Amina"');
  });

  it('drops the offending sentences when the rest still answers', () => {
    const f = facts();
    const reply = 'Bonjour ! Oui, la robe satin est disponible. Il en reste 2. Voulez-vous la commander ?';
    expect(enforceReply(reply, checkReply(reply, f), f, { hasCards: true })).toEqual({ reply: 'Oui, la robe satin est disponible. Voulez-vous la commander ?', action: 'stripped' });
  });

  it('nothing usable left ⇒ one neutral sentence of the customer language, never a handoff promise', () => {
    const f = facts();
    expect(enforceReply('La robe est à 3700 DA.', checkReply('La robe est à 3700 DA.', f), f, { hasCards: true })).toEqual({ reply: SAFE_SENTENCES.price_on_card.fr, action: 'safe_sentence' });
    expect(enforceReply('Il en reste 2.', checkReply('Il en reste 2.', f), f, { hasCards: false })).toEqual({ reply: SAFE_SENTENCES.available.fr, action: 'safe_sentence' });
    const ar = facts({ lang: 'ar' });
    expect(enforceReply('الساك ب 5000 دج.', checkReply('الساك ب 5000 دج.', ar), ar, { hasCards: false }).reply).toBe(SAFE_SENTENCES.which.ar);
    const az = facts({ lang: 'arabizi' });
    expect(enforceReply('tawsil 900 da', checkReply('tawsil 900 da', az), az, { hasCards: false }).reply).toBe(SAFE_SENTENCES.which.arabizi);
    for (const s of Object.values(SAFE_SENTENCES).flatMap((x) => Object.values(x))) expect(s).not.toMatch(/équipe|team|فريق|conseiller|human|humain/i);
  });

  it('a wrong name alone ⇒ the right introduction; a greeting alone ⇒ kept', () => {
    const f = facts({ customerText: 'tu t’appelles comment ?' });
    expect(enforceReply("Je m'appelle Sarah.", checkReply("Je m'appelle Sarah.", f), f, { hasCards: false })).toEqual({ reply: "Je suis Amina, l'assistant virtuel de la boutique.", action: 'safe_sentence' });
    const g = facts();
    expect(enforceReply('Bonjour !', checkReply('Bonjour !', g), g, { hasCards: false })).toEqual({ reply: 'Bonjour !', action: 'kept' });
  });

  it('a clean reply has no violation', () => {
    expect(checkReply('Oui, la robe satin bordeaux est disponible à 4500 DA. Quelle taille souhaitez-vous ?', facts())).toEqual([]);
    expect(checkReply('', facts())).toEqual([]);
  });
});
