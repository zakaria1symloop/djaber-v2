// 04-ai-pipeline §4.3 — the reply guard (weak-points audit 12/11, pattern 1). Positive AND negative examples in French,
// Arabic script (darija), arabizi and English: a false positive costs a corrective model turn, so the negatives matter.
import { amountAllowed, buildGuardFacts, checkReply, enforceReply, feeSentence, fixScriptMix, quoteFacts, foldGuard, greetingAt, guardInstruction, moneyAmounts, SAFE_SENTENCES, splitSentences, stockCounts, stripGreeting, withToolResults, type GuardFacts, type GuardFactsInput } from './reply-guard';

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
    // these tables check the amounts (the language of a French conversation is checked by its own tests below)
    expect(rules(reply, facts({ customerText: 'faites-la moi à 3500 DA' })).filter((r) => r !== 'language_switch')).toEqual([]);
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
    const v = checkReply(reply, facts()).filter((x) => x.rule !== 'language_switch');
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

describe('full-test 15/11 — language, dialect and script (AI-CHAT-04, proposal 5)', () => {
  it.each([
    ['arabizi answered in French', 'arabizi', 'Salam 👋 Livraison à Oran : 600 DA à domicile, le délai est de 2 à 5 jours.'],
    ['arabizi answered in English', 'arabizi', 'The Nike Air basket is available, which size do you want please?'],
    ['French answered in English', 'fr', 'Delivery to Tamanrasset is 1400 DA to your home, or 900 DA to a stop-desk.'],
    ['Arabic script answered in French', 'ar', 'Bonjour, la montre connectée est disponible, voulez-vous la commander ?'],
  ] as const)('flagged: %s', (_what, lang, reply) => {
    expect(rules(reply, facts({ lang, customerText: 'x' }, []))).toContain('language_switch');
  });
  it.each([
    ['arabizi answered in arabizi with French words', 'arabizi', 'Ih kayen, taille M disponible, t7ebb nsajjel lek la commande wela la ?'],
    ['French answered in French', 'fr', 'La livraison à Oran coûte 600 DA, le délai est de 2 à 5 jours.'],
    ['a reply too short to tell', 'arabizi', 'Ok 👍'],
    ['a price alone', 'fr', '4500 DA.'],
    ['a mixed customer', 'mixed', 'The watch is available, do you want it?'],
    ['Arabic script answered in Arabic script', 'ar', 'إيه كاينة، تحب نسجلك الطلبية؟'],
  ] as const)('not flagged: %s', (_what, lang, reply) => {
    expect(rules(reply, facts({ lang, customerText: 'x' }, []))).not.toContain('language_switch');
  });
  it('Moroccan words in an arabizi / Arabic-script reply; never in French', () => {
    expect(rules('Chno t7eb tchouf ? 3andna bezzaf dyal les modèles.', facts({ lang: 'arabizi', customerText: 'x' }, []))).toContain('moroccan_darija');
    expect(rules('شنو بغيتي؟', facts({ lang: 'ar', customerText: 'x' }, []))).toContain('moroccan_darija');
    expect(rules('Wach t7ebb tchouf ? 3andna bezzaf les modèles.', facts({ lang: 'arabizi', customerText: 'x' }, []))).not.toContain('moroccan_darija');
  });
  it('a Latin letter inside an Arabic word is fixed by the server, without a model turn', () => {
    expect(rules('مرحبا، كيفاش وnعاونك؟', facts({ lang: 'ar', customerText: 'x' }, []))).toContain('script_mix');
    expect(fixScriptMix('كيفاش وnعاونك؟')).toBe('كيفاش وعاونك؟');
    expect(rules('التوصيل لـ Oran بـ 600 دج', facts({ lang: 'ar', customerText: 'x' }, [{ ok: true, fee: 600 }]))).not.toContain('script_mix');
    const e = enforceReply('مرحبا، كيفاش وnعاونك اليوم؟', [{ rule: 'script_mix', sentence: 0 }], facts({ lang: 'ar' }), { hasCards: false });
    expect(e.reply).toBe('مرحبا، كيفاش وعاونك اليوم؟');
  });
  it('a language slip the corrective turn did not fix is sent as it is (kept)', () => {
    const reply = 'Delivery to Tamanrasset is 1400 DA to your home.';
    expect(enforceReply(reply, [{ rule: 'language_switch', sentence: 0 }], facts(), { hasCards: false })).toEqual({ reply, action: 'kept' });
    expect(guardInstruction([{ rule: 'language_switch', sentence: 0 }], facts())).toContain('the customer writes French');
  });
});

describe('full-test 15/11 — false confession about a placed order (AI-CHAT-02, proposal 3)', () => {
  it.each([
    ["j'ai utilisé des coordonnées inventées", "Je dois corriger : j'ai utilisé des coordonnées inventées pour la commande CMD-1042."],
    ['enregistrée par erreur', 'Une commande a été enregistrée par erreur de notre côté.'],
    ["la commande n'existe pas", "La commande CMD-1042 n'existe pas, rien n'a été créé."],
    ["je n'ai pas récupéré vos informations", "Je n'ai pas récupéré vos informations (nom, téléphone)."],
    ['nothing was ordered', 'Sorry, nothing was ordered yet.'],
  ])('flagged once an order was placed: %s', (_what, reply) => {
    const f = facts({}, [ORDER]);
    expect(f.ordersPlaced).toEqual(['CMD-1042']);
    expect(rules(reply, f)).toContain('false_confession');
    expect(guardInstruction(checkReply(reply, f), f)).toContain('order CMD-1042 was placed');
  });
  it('not flagged when no order was placed, nor for a plain confirmation', () => {
    expect(rules("Rien n'a été commandé pour le moment : voulez-vous que je prépare le récapitulatif ?", facts())).not.toContain('false_confession');
    expect(rules('Votre commande CMD-1042 est bien enregistrée.', facts({}, [ORDER]))).not.toContain('false_confession');
  });
  it('the sentence is dropped when the corrective turn still says it', () => {
    const reply = "Votre commande CMD-1042 est enregistrée. J'ai utilisé des coordonnées inventées, désolé.";
    const f = facts({}, [ORDER]);
    expect(enforceReply(reply, checkReply(reply, f), f, { hasCards: false }).reply).toBe('Votre commande CMD-1042 est enregistrée.');
  });
});

describe('journey 16/11 J04-2 / J04-3 — language and darija of the J04 transcripts', () => {
  it('an English customer typing an address still gets English; a French recap breaks the rule (O04 T3)', () => {
    const f = facts({ lang: 'en', customerText: 'John Benali, 0555987654, Oran, Bir El Djir, cité 1000 logements' }, []);
    expect(f.messageLang).toBeUndefined();
    expect(rules('Merci John, voici le récapitulatif de votre commande. Répondez oui pour valider.', f)).toContain('language_switch');
  });
  it('a reply in the language of the message itself is not a switch (« Price? » in an Arabic-script conversation)', () => {
    const f = facts({ lang: 'ar', customerText: 'Bonsoir, et la livraison ?' }, []);
    expect(rules('Bonsoir, la livraison à Oran coûte 600 DA, le délai est de 2 à 5 jours.', f)).not.toContain('language_switch');
  });
  it.each([
    ['P14 T4', 'arabizi', 'Ma nqderch nconfirmi daba, ma 3andnach l3ibaya f catalogue.'],
    ['P14 T5', 'arabizi', 'Sa7a bik khouya 😊 Ila bghiti chi 7aja, ana hna.'],
    ['P14 T3', 'arabizi', 'Ki tewsel l colis, tkhallsou cash m3a livreur, ma kaynch paiement 9bal.'],
    ['O02 T2', 'arabizi', "Mzyan, rah nsajjel lek wahda 👍 Ch7al smitek (ism) l'commande ?"],
    ['O02 T3, a French-looking arabizi reply', 'arabizi', 'Merci Walid 😊 Ch7al numéro dyal téléphone (exemple : 0555123456) ?'],
    ['P08 T1', 'ar', 'مرحبًا بيك! الدفع عندنا يكون عند الاستلام فقط، بالفلوس ملي يوصلك الطرد.'],
    ['P08 T2', 'ar', 'الإرجاع ما يكونش بفلوس (ما فماش استرجاع نقدي)، التبديل فقط.'],
  ] as const)('non-Algerian darija flagged: %s', (_what, lang, reply) => {
    expect(rules(reply, facts({ lang, customerText: 'x' }, []))).toContain('moroccan_darija');
  });
  it('Algerian replies and French replies are not flagged', () => {
    expect(rules('Ih kayen M, t7ebb nsajjel lek la commande ? Makach walou problème.', facts({ lang: 'arabizi', customerText: 'x' }, []))).not.toContain('moroccan_darija');
    expect(rules('Le chiffre est correct, merci pour votre message.', facts({ lang: 'fr', customerText: 'x' }, []))).not.toContain('moroccan_darija');
  });
});

describe('journey 16/11 J03-2 — the fee quote_delivery returned this turn is in the reply (fee_missing)', () => {
  // P03 T2 « ch7al tawsil l setif ? »: quote_delivery Sétif 650 / 350, then a reply with no fee
  const SETIF = { ok: true, wilayaId: 19, wilayaName: 'Sétif', isStopdesk: false, fee: 650, free: false, freeFrom: null, stopdeskAvailable: true, stopdeskFee: 350, etaDays: '2–5' };
  const quotes = quoteFacts([{ name: 'quote_delivery', result: SETIF }, { name: 'search_products', result: { products: [] } }]);
  const withQuote = (lang: 'arabizi' | 'fr' | 'ar' | 'en' = 'arabizi') => ({ ...facts({ lang, customerText: 'ch7al tawsil l setif ?' }, [SETIF]), quotes });
  it('AI-CHAT-04 retest: French sentences inside an arabizi greeting / tail are a language switch; an arabizi reply with French nouns is not', () => {
    const f = facts({ lang: 'arabizi', customerText: 'w stop desk ?' }, [SETIF]);
    // P03 T3 and the « Arabizi : livraison » chip of the J03 run
    expect(rules('Livraison à Sétif : 650 DA à domicile, et 350 DA en stop-desk. Le délai est de 2 à 5 jours. Ila t7ebb tchouf produit, goulli-li wach t7ebb nchouf.', f)).toContain('language_switch');
    expect(rules('Wa 3likoum salam 😊 Livraison à domicile vers Oran : 600 DA, et en stop-desk : 400 DA. Délai : 2 à 5 jours.', facts({ lang: 'arabizi', customerText: 'salam, chhal tawsil l Oran ?' }, []))).toContain('language_switch');
    expect(rules('Wa 3likoum salam 😊 Tawsil l Oran b 600 DA l dar w 400 DA f stop-desk. Délai 2 l 5 ayyam.', facts({ lang: 'arabizi', customerText: 'salam, chhal tawsil l Oran ?' }, []))).not.toContain('language_switch');
    expect(rules('Ih kayen la robe en taille M, t7ebb nsajjel lek la commande ? Tawsil l Sétif b 650 DA.', f)).not.toContain('language_switch');
  });
  it('quoteFacts keeps the successful quote_delivery answers only', () => {
    expect(quotes).toEqual([{ wilaya: 'Sétif', isStopdesk: false, fee: 650, free: false, stopdeskFee: 350 }]);
    expect(quoteFacts([{ name: 'quote_delivery', result: { ok: false, error: { code: 'WILAYA_NOT_SERVED' } } }])).toEqual([]);
  });
  it('P03 T2 « Merci 3la sbr ! … » is flagged; a reply with the home or the stop-desk fee is not', () => {
    expect(rules('Merci 3la sbr ! Ila t7ebb tssa2el 3la 7aja, goulli-li ach ta3ref w n3awnek.', withQuote())).toContain('fee_missing');
    expect(rules('Tawsil l Sétif 650 DA l dar, 350 DA f stop-desk, 2 l 5 ayyam.', withQuote())).not.toContain('fee_missing');
    expect(rules('التوصيل لسطيف بـ ٦٥٠ دج للدار.', withQuote('ar'))).not.toContain('fee_missing');
    expect(rules('Livraison à Sétif : 350 DA en stop-desk.', withQuote('fr'))).not.toContain('fee_missing');
  });
  it('a free delivery said in words counts; no quote this turn ⇒ nothing is checked', () => {
    const free = { ...withQuote('fr'), quotes: quoteFacts([{ name: 'quote_delivery', result: { ...SETIF, wilayaName: 'Oran', fee: 0, free: true } }]) };
    expect(rules('La livraison à domicile vers Oran est gratuite pour cette commande.', free)).not.toContain('fee_missing');
    expect(rules('Merci pour votre message, que cherchez-vous ?', facts({ lang: 'fr' }, [SETIF]))).not.toContain('fee_missing');
  });
  it('the corrective instruction names the fees; still missing after it ⇒ the server adds the fee sentence in the customer language', () => {
    const f = withQuote();
    const reply = 'Merci 3la sbr ! Ila t7ebb tssa2el 3la 7aja, goulli-li ach ta3ref w n3awnek.';
    const v = checkReply(reply, f);
    expect(guardInstruction(v, f)).toContain('DELIVERY FEE: quote_delivery answered Sétif: home 650 DA, stop-desk 350 DA');
    // journey retest R2-1: « ach » (Moroccan « what ») is flagged too and replaced by « wach »
    expect(v.map((x) => x.rule)).toContain('moroccan_darija');
    const out = enforceReply(reply, v, f, { hasCards: false });
    expect(out.reply.replace(/\u202f|\u2009|\u00a0/g, ' ')).toBe('Tawsil l Sétif: 650 DA l dar, 350 DA f stop-desk. Merci 3la sbr ! Ila t7ebb tssa2el 3la 7aja, goulli-li wach ta3ref w n3awnek.');
    expect(out.action).toBe('stripped');
    expect(feeSentence(quotes[0]!, 'fr').replace(/\u202f|\u2009|\u00a0/g, ' ')).toBe('Livraison à Sétif : 650 DA à domicile, 350 DA en stop-desk.');
    expect(feeSentence({ wilaya: 'Oran', isStopdesk: false, fee: 0, free: true, stopdeskFee: 400 }, 'en').replace(/\u202f|\u2009|\u00a0/g, ' ')).toBe('Delivery to Oran: free to your door, 400 DA at a stop-desk.');
  });
});
