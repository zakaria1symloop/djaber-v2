// Journey J02r-6 (18/11, docs/audit/journeys-2026-11-18/journeys/J02.md): every product of a new shop still waits for Djaber's review —
// the playground said « les chaussures sport Atlas ne font pas partie de nos produits pour le moment » about a product the shop sells.
import { catalogueSection } from './prompt/sections/catalogue';
import { buildGuardFacts } from './reply-guard';
import { withPendingProductWording } from './reply-fixes';

describe('journey J02r-6 — a product under review is « pas encore en ligne », not « pas de nos produits »', () => {
  it('the refusal wording becomes « not online yet » (fr singular / plural, en)', () => {
    expect(withPendingProductWording('Désolé, les chaussures sport Atlas ne font pas partie de nos produits pour le moment. La boutique met en ligne ses articles très bientôt.')).toBe(
      'Désolé, les chaussures sport Atlas ne sont pas encore en ligne. La boutique met en ligne ses articles très bientôt.',
    );
    expect(withPendingProductWording('Le tapis berbère ne fait pas partie de nos articles pour le moment.')).toBe("Le tapis berbère n'est pas encore en ligne.");
    expect(withPendingProductWording('Sorry, the Atlas sneakers are not part of our products for now.')).toBe('Sorry, the Atlas sneakers are not online yet.');
    expect(withPendingProductWording('Nos produits seront bientôt en ligne.')).toBe('Nos produits seront bientôt en ligne.');
  });

  it('the guard knows the catalogue awaits review, and the prompt rule forbids the refusal', () => {
    const base = { lang: 'fr', products: [], shopTexts: [], freeDeliveryThreshold: null, agentName: null, shopName: 'Boutique', customerText: 'combien ?', answeredBefore: false, freshStart: true } as never;
    expect(buildGuardFacts({ ...(base as object), awaitingReview: true } as never).awaitingReview).toBe(true);
    expect(buildGuardFacts(base).awaitingReview).toBeUndefined();
    const s = catalogueSection({ catalogue: { full: true, count: 0, products: [], awaitingReview: 3 }, workspace: { systemMessages: {} }, agent: { outOfStockBehavior: 'suggest_alternative', showMissingVariants: false }, lang: 'fr', locale: 'fr', descriptionMax: 200 } as never);
    expect(s).toContain("never say it is not part of the shop's products or not sold — say it is not online yet");
  });
});
