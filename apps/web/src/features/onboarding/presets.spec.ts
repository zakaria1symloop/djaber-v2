// Onboarding step 4: preset cards from the server list, static fallback.
import { describe, expect, it } from 'vitest';
import { presetCards, presetKeyOf, staticOf } from './presets';

describe('onboarding preset cards', () => {
  it('static keys map to the seed keys and back', () => {
    expect(presetKeyOf('vendeurPro')).toBe('vendeur-pro');
    expect(presetKeyOf('reponseExpress')).toBe('reponse-express');
    expect(staticOf('vendeur-pro')).toBe('vendeurPro');
    expect(staticOf('conseiller_produit')).toBe('conseillerProduit');
    expect(staticOf('boutique-mode')).toBeNull();
  });
  it('no server list ⇒ the four static cards, the first recommended', () => {
    const cards = presetCards(null);
    expect(cards.map((c) => c.key)).toEqual(['vendeur-pro', 'service-client', 'conseiller-produit', 'reponse-express']);
    expect(cards.map((c) => c.recommended)).toEqual([true, false, false, false]);
    expect(cards.every((c) => !c.live)).toBe(true);
  });
  it('server presets keep their key, name and badge', () => {
    const cards = presetCards([
      { key: 'service-client', name: 'Service Client', tagline: 'Suivi', badge: null },
      { key: 'vendeur-pro', name: 'Vendeur Pro', tagline: null, badge: 'recommended' },
      { key: 'mode', name: 'Mode', tagline: 'Boutiques de mode', badge: 'popular' },
    ]);
    expect(cards.map((c) => [c.key, c.staticKey, c.recommended])).toEqual([
      // official presets first, in the frame's order (ONBOARDING-01)
      ['vendeur-pro', 'vendeurPro', true],
      ['service-client', 'serviceClient', false],
      ['mode', null, false],
    ]);
    expect(presetCards([{ key: 'a', name: 'A', tagline: null, badge: null }])[0]!.recommended).toBe(true);
  });
  it('full-test 16/11 ONBOARDING-01: the four official presets come first, whatever the server order', () => {
    const p = (key: string) => ({ key, name: key, tagline: null, badge: null });
    const cards = presetCards([p('test'), p('testtest'), p('vendeur-pro'), p('mohamed-b'), p('service-client'), p('conseiller-produit'), p('reponse-express')]);
    expect(cards.map((c) => c.key)).toEqual(['vendeur-pro', 'service-client', 'conseiller-produit', 'reponse-express']);
    expect(presetCards([p('test'), p('vendeur-pro')]).map((c) => c.key)).toEqual(['vendeur-pro', 'test']);
  });
});
