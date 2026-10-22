// UX-008 (tester report 2026-10-21) — a preset used in Arabic / English: a blank translation of the instructions falls back
// to the French prompt instead of leaving the agent with the generated tone line only.
import { compileInstructions, merchantInstructions, presetInstructions } from './agent.presenter';

describe('preset instructions per locale', () => {
  const locales = { fr: { systemPrompt: 'Présente la livraison 58 wilayas.' }, ar: { systemPrompt: '   ' }, en: { systemPrompt: '' } };
  it('the requested locale when filled, else French, else any filled one', () => {
    expect(presetInstructions(locales, 'fr')).toBe('Présente la livraison 58 wilayas.');
    expect(presetInstructions(locales, 'ar')).toBe('Présente la livraison 58 wilayas.');
    expect(presetInstructions(locales, 'en')).toBe('Présente la livraison 58 wilayas.');
    expect(presetInstructions({ ...locales, en: { systemPrompt: 'Mention delivery to 58 wilayas.' } }, 'en')).toBe('Mention delivery to 58 wilayas.');
    expect(presetInstructions({ en: { systemPrompt: 'Only English.' } }, 'ar')).toBe('Only English.');
    expect(presetInstructions({}, 'fr')).toBe('');
  });
  it('an agent created in English now carries the preset text after its style block', () => {
    const style = { languages: [], defaultLanguage: null, tone: 'warm', formality: null, emojiLevel: null };
    const stored = compileInstructions(style as never, presetInstructions(locales, 'en'));
    expect(merchantInstructions(stored)).toBe('Présente la livraison 58 wilayas.');
  });
});
