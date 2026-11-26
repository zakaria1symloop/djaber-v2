// Owner 26/11: « try to force the AI to talk Algerian or let the choice to the client » — the agent's « Langues » list is binding.
import { allowedReplyLanguage } from './language';

describe('allowedReplyLanguage', () => {
  it('a language the shop ticked is the customer choice: followed', () => {
    const all = ['darija', 'arabizi', 'fr', 'ar'];
    expect(allowedReplyLanguage('fr', all, 'darija')).toEqual({ lang: 'fr', forced: false });
    expect(allowedReplyLanguage('arabizi', all, 'darija')).toEqual({ lang: 'arabizi', forced: false });
    expect(allowedReplyLanguage('ar', all, 'darija')).toEqual({ lang: 'ar', forced: false });
    expect(allowedReplyLanguage('mixed', all, 'darija')).toEqual({ lang: 'mixed', forced: false });
  });

  it('only « Darija » and « Arabizi » ticked: always Algerian — Latin letters in arabizi, the rest in Arabic script', () => {
    const algerian = ['darija', 'arabizi'];
    expect(allowedReplyLanguage('fr', algerian, 'darija')).toEqual({ lang: 'arabizi', forced: true });
    expect(allowedReplyLanguage('en', algerian, 'darija')).toEqual({ lang: 'arabizi', forced: true });
    expect(allowedReplyLanguage('mixed', algerian, 'darija')).toEqual({ lang: 'arabizi', forced: true });
    expect(allowedReplyLanguage('ar', algerian, 'darija')).toEqual({ lang: 'ar', forced: false });
    expect(allowedReplyLanguage('arabizi', algerian, 'darija')).toEqual({ lang: 'arabizi', forced: false });
  });

  it('only « Darija » ticked: every reply in Arabic-script darija', () => {
    expect(allowedReplyLanguage('fr', ['darija'], 'darija')).toEqual({ lang: 'ar', forced: true });
    expect(allowedReplyLanguage('arabizi', ['darija'], 'darija')).toEqual({ lang: 'ar', forced: true });
    expect(allowedReplyLanguage('en', ['darija'], null)).toEqual({ lang: 'ar', forced: true });
  });

  it('a French-only shop answers an Arabic-script customer in French (the default, then the first ticked)', () => {
    expect(allowedReplyLanguage('ar', ['fr'], 'fr')).toEqual({ lang: 'fr', forced: true });
    expect(allowedReplyLanguage('arabizi', ['fr', 'en'], null)).toEqual({ lang: 'fr', forced: true });
  });

  it('an empty list (agents made before the setting mattered) and Kabyle alone keep following the customer', () => {
    expect(allowedReplyLanguage('fr', [], 'darija')).toEqual({ lang: 'fr', forced: false });
    expect(allowedReplyLanguage('en', null, null)).toEqual({ lang: 'en', forced: false });
    expect(allowedReplyLanguage('fr', ['kabyle'], 'kabyle')).toEqual({ lang: 'fr', forced: false });
  });
});
