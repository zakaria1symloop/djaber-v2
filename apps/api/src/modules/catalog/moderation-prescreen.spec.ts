// 04 §12 pre-screen scoring and auto-approval (AT-MOD-03, unit).
import { DEFAULT_SENSITIVE_KEYWORDS, ModerationPrescreenService, foldText } from './moderation-prescreen.service';

const svc = new ModerationPrescreenService();
const rules = { brands: ['Louis Vuitton'], prohibited: ['arme'], words: ['arnaque'], sensitive: DEFAULT_SENSITIVE_KEYWORDS, priceRefs: [] };
const base = { workspaceId: 'w', name: 'Sac en cuir', description: 'Fait main', price: 4000, categoryId: null, categoryName: null, imageCount: 3, imageFlags: [] };

describe('moderation pre-screen', () => {
  it('a clean product with several photos scores 1, with one photo 0.95 (auto-approvable)', () => {
    expect(svc.score(base, rules, null)).toMatchObject({ aiScore: 1, aiFlags: [], sensitive: false });
    const one = svc.score({ ...base, imageCount: 1 }, rules, null);
    expect(one.aiScore).toBe(0.95);
    expect(one.aiFlags.map((f) => f.code)).toEqual(['single_image']);
  });

  it('flags protected brands, counterfeit wording, health claims, prohibited categories and blocked words (accent / case insensitive)', () => {
    const r = svc.score({ ...base, name: 'Sac LOUIS VUITTON copie qualité AAA', description: 'guérit le stress' }, rules, null);
    expect(r.aiFlags.map((f) => f.code).sort()).toEqual(['counterfeit_wording', 'health_claim', 'protected_brand']);
    expect(r.aiFlags.find((f) => f.code === 'protected_brand')?.field).toBe('name');
    expect(r.aiScore).toBe(0);
    expect(svc.score({ ...base, categoryName: 'Armes blanches' }, rules, null).aiFlags[0]).toMatchObject({ code: 'prohibited_category', field: 'categoryId' });
    expect(svc.score({ ...base, description: 'pas une ARNAQUE' }, rules, null).aiFlags[0]).toMatchObject({ code: 'blocked_word', field: 'description' });
  });

  it('PV1: the keyword lists also scan variant names, search keywords and image captions (held for review)', () => {
    const variant = svc.score({ ...base, variantNames: ['Rouge', 'Modèle Arnaque'] }, rules, null);
    expect(variant.aiFlags[0]).toMatchObject({ code: 'blocked_word', message: 'arnaque', field: 'variants' });
    expect(ModerationPrescreenService.autoApprove(variant, 'trusted')).toBe(false);
    expect(svc.score({ ...base, keywords: ['sac', 'louis vuitton'] }, rules, null).aiFlags[0]).toMatchObject({ code: 'protected_brand', field: 'keywords' });
    expect(svc.score({ ...base, keywords: ['first copy'] }, rules, null).aiFlags[0]).toMatchObject({ code: 'counterfeit_wording', field: 'keywords' });
    expect(svc.score({ ...base, imageTexts: ['un sac Louis Vuitton marron', ''] }, rules, null).aiFlags[0]).toMatchObject({ code: 'protected_brand', field: 'images' });
    // the name still wins the attribution when the word is in both
    expect(svc.score({ ...base, name: 'Arnaque', keywords: ['arnaque'] }, rules, null).aiFlags[0]?.field).toBe('name');
    expect(svc.score({ ...base, variantNames: ['Noir'], keywords: ['cuir'], imageTexts: ['sac noir'] }, rules, null).aiFlags).toEqual([]);
  });

  it('misleading price vs the market reference (−87 %), logo in image, missing warranty for electronics', () => {
    const cheap = svc.score({ ...base, price: 500 }, rules, 4000);
    expect(cheap).toMatchObject({ marketReference: 4000 });
    expect(cheap.aiFlags[0]).toMatchObject({ code: 'misleading_price', field: 'price', message: '-87 %' });
    expect(svc.score({ ...base, imageFlags: ['logo'] }, rules, null).aiFlags[0]?.code).toBe('logo_in_image');
    const phone = svc.score({ ...base, categoryName: 'Téléphones & électronique', description: 'neuf' }, rules, null);
    expect(phone.sensitive).toBe(true);
    expect(phone.aiFlags.map((f) => f.code)).toContain('missing_warranty');
  });

  it('AT-MOD-03 auto-approval needs score ≥ 0.9, trust standard / trusted and a non-sensitive category', () => {
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.95, sensitive: false }, 'standard')).toBe(true);
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.95, sensitive: false }, 'trusted')).toBe(true);
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.95, sensitive: false }, 'new')).toBe(false);
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.99, sensitive: false }, 'watch')).toBe(false);
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.99, sensitive: true }, 'trusted')).toBe(false);
    expect(ModerationPrescreenService.autoApprove({ aiScore: 0.89, sensitive: false }, 'trusted')).toBe(false);
  });

  it('UX-034: a whole word of the platform lists is a banned hit (rejected at once); inside another word it only flags', () => {
    const variant = svc.score({ ...base, variantNames: ['Rouge', 'Modèle Arnaque'] }, rules, null);
    expect(variant.banned).toEqual({ code: 'blocked_word', word: 'arnaque', field: 'variants' });
    expect(ModerationPrescreenService.autoApprove(variant, 'trusted')).toBe(false);
    expect(svc.score({ ...base, description: 'pas une ARNAQUE !' }, rules, null).banned).toMatchObject({ field: 'description' });
    expect(svc.score({ ...base, categoryName: 'Arme' }, rules, null).banned).toEqual({ code: 'prohibited_category', word: 'arme', field: 'categoryId' });
    // a real compound (« arnaqueur », « armement ») contains the word but is another word: flagged for a moderator only
    const compound = svc.score({ ...base, name: 'Le guide de l’arnaqueur' }, rules, null);
    expect(compound.aiFlags[0]).toMatchObject({ code: 'blocked_word' });
    expect(compound.banned).toBeUndefined();
    expect(svc.score({ ...base, categoryName: 'Armement ancien' }, rules, null).banned).toBeUndefined();
    expect(svc.score(base, rules, null).banned).toBeUndefined();
    // Arabic words are matched whole too
    const ar = { ...rules, words: ['مخدرات'] };
    expect(svc.score({ ...base, description: 'بيع مخدرات هنا' }, ar, null).banned).toMatchObject({ word: 'مخدرات', field: 'description' });
  });

  it('recette 09/11 UX-043: French / English plural and feminine endings are rejected like the word (« armes », « drugs »)', () => {
    const fr = { ...rules, words: ['arme', 'drug', 'interdit'] };
    expect(svc.score({ ...base, name: 'Recette H-19 armes' }, fr, null).banned).toMatchObject({ code: 'blocked_word', word: 'arme', field: 'name' });
    expect(svc.score({ ...base, name: 'Recette H-19 drugs' }, fr, null).banned).toMatchObject({ word: 'drug' });
    expect(svc.score({ ...base, name: 'Vente interdite' }, fr, null).banned).toMatchObject({ word: 'interdit' });
    expect(svc.score({ ...base, categoryName: 'Armes blanches' }, rules, null).banned).toEqual({ code: 'prohibited_category', word: 'arme', field: 'categoryId' });
    // « armée » is not « arme » + « e » (a word ending in e only takes s); compounds only flag
    expect(svc.score({ ...base, name: 'Surplus armée' }, fr, null).banned).toBeUndefined();
    expect(svc.score({ ...base, name: 'Drugstore kit' }, fr, null).banned).toBeUndefined();
    expect(svc.score({ ...base, name: 'Drugstore kit' }, fr, null).aiFlags[0]).toMatchObject({ code: 'blocked_word' });
  });

  it('recette 09/11 (Badro): an agent name with an insult or a banned word is refused; ordinary words are not', async () => {
    const r = { ...rules, words: ['arnaque'], prohibited: ['arme'] };
    expect(await svc.bannedInName('Connard', r)).toBe('connard');
    expect(await svc.bannedInName('SuperConnard du 16', r)).toBe('connard');
    expect(await svc.bannedInName('Sara la pute', r)).toBe('pute');
    expect(await svc.bannedInName('زبي', r)).toBe('زبي');
    expect(await svc.bannedInName('9a7ba shop', r)).toBe('9a7ba');
    expect(await svc.bannedInName('Agent arnaques', r)).toBe('arnaque');
    expect(await svc.bannedInName('Vendeur d’armes', r)).toBe('arme');
    for (const ok of ['Sara', 'Agent technique', 'Salopette Store', 'Assistant unique', 'Amina — Boutique Dar El Kendil', 'Conseiller', null, '']) expect(await svc.bannedInName(ok, r)).toBeNull();
  });

  it('folds Arabic diacritics and tatweel', () => {
    expect(foldText('تَقْلِيـــد')).toBe('تقليد');
    expect(svc.isSensitive('مستحضرات التجميل', rules)).toBe(true);
  });
  it('PV 09/11: an Arabic banned word is found with its article, particles and endings, whatever the hamza / ta marbuta spelling', () => {
    const ar = { ...rules, words: ['خمر', 'أسلحة', 'arnaque'] };
    expect(foldText('أسلحة')).toBe(foldText('اسلحه'));
    expect(svc.score({ ...base, name: 'بيع الخمر الأصلي' }, ar, null).banned).toMatchObject({ code: 'blocked_word', word: 'خمر', field: 'name' });
    expect(svc.score({ ...base, description: 'توصيل بالخمر لكل الولايات' }, ar, null).banned).toMatchObject({ word: 'خمر', field: 'description' });
    expect(svc.score({ ...base, name: 'اسلحه للبيع' }, ar, null).banned).toMatchObject({ word: 'أسلحة' });
    expect(svc.score({ ...base, name: 'والأسلحة' }, ar, null).banned).toMatchObject({ word: 'أسلحة' });
    // a longer word that merely contains it is not a hit
    expect(svc.score({ ...base, name: 'خمرية اللون' }, ar, null).banned).toBeUndefined();
    // French / English: the word with its plural ending too (recette 09/11 UX-043), not a longer word
    expect(svc.score({ ...base, name: 'Arnaques' }, ar, null).banned).toMatchObject({ word: 'arnaque' });
    expect(svc.score({ ...base, name: 'Arnaqueurs' }, ar, null).banned).toBeUndefined();
  });
});
