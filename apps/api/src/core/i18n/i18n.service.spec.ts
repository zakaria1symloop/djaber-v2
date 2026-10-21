// Localized JSON columns (`{ fr, ar, en }`): tester report 2026-10-19 UX-002 — /en/agents « Origin preset » showed empty
// options because the presets had an empty English name.
import { I18nService } from './i18n.service';

describe('I18nService.pick', () => {
  const i18n = new I18nService();
  it('picks the locale, else French, else the first filled value', () => {
    expect(i18n.pick({ fr: 'Vendeur Pro', ar: 'البائع المحترف', en: 'Pro Seller' }, 'en')).toBe('Pro Seller');
    expect(i18n.pick({ fr: 'Vendeur Pro' }, 'en')).toBe('Vendeur Pro');
    expect(i18n.pick({ ar: 'البائع المحترف' }, 'en')).toBe('البائع المحترف');
  });
  it('a blank translation counts as missing', () => {
    expect(i18n.pick({ fr: 'Vendeur Pro', ar: '', en: '' }, 'en')).toBe('Vendeur Pro');
    expect(i18n.pick({ fr: '  ', ar: 'البائع المحترف', en: ' ' }, 'en')).toBe('البائع المحترف');
    expect(i18n.pick({ fr: '', en: '' }, 'en')).toBe('');
  });
  it('plain strings and empty values', () => {
    expect(i18n.pick('Vendeur', 'en')).toBe('Vendeur');
    expect(i18n.pick(null, 'en')).toBe('');
  });
});
