import { describe, expect, it } from 'vitest';
import { CreateQuickReplySchema } from './quick-reply';
import { QUICK_REPLY_ACCEPTED, SYSTEM_MESSAGE_VARIABLES, unknownVariables, variablesLabel } from './template-variables';

describe('journeys 16/11 J09-11 / J09-12 — template variables', () => {
  it('system messages: case and spaces do not matter, any other {…} is unknown (once each)', () => {
    expect(unknownVariables('Désolé, {PRODUCT} est épuisé. { product } {inconnu} {shop} {inconnu}', SYSTEM_MESSAGE_VARIABLES.out_of_stock)).toEqual(['{inconnu}']);
    expect(unknownVariables('Bienvenue chez {shop}, {product}', SYSTEM_MESSAGE_VARIABLES.welcome)).toEqual(['{product}']);
    expect(variablesLabel(SYSTEM_MESSAGE_VARIABLES.out_of_stock)).toBe('{product}, {shop}');
  });
  it('quick replies: {prénom} {boutique} {total} (and the aliases the composer fills) only', () => {
    expect(unknownVariables('Bonjour {prénom}, votre commande de {total} chez {boutique} est prête. {inconnu} {PRODUCT}', QUICK_REPLY_ACCEPTED)).toEqual(['{inconnu}', '{PRODUCT}']);
    expect(unknownVariables('Merci {Prenom} — {shop}', QUICK_REPLY_ACCEPTED)).toEqual([]);
    const bad = CreateQuickReplySchema.safeParse({ title: 'Relance', body: 'Bonjour {inconnu}', locale: 'fr' });
    expect(bad.success ? null : bad.error.issues[0]?.message).toBe('validation.unknownVariable');
    expect(CreateQuickReplySchema.safeParse({ title: 'Relance', body: 'Bonjour {prénom}', locale: 'fr' }).success).toBe(true);
  });
});
