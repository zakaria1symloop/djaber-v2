// UX-099 (Houssem live 25/11): the automatic refusal of « drogue » read in English on the French and the Arabic screens.
import { formatMessage, getMessages } from '@djaber/shared';
import { autoRejectedIn } from './moderation-message';

const KEY = 'products.form.moderation.autoRejected';
const stored = (locale: 'fr' | 'ar' | 'en', word: string, field: string) => formatMessage(getMessages(locale)[KEY]!, { word, field: getMessages(locale)[`products.form.moderation.field.${field}`]! });

describe('autoRejectedIn', () => {
  it('writes the system refusal again in the reader language, the merchant word kept as typed', () => {
    const en = stored('en', 'drogues', 'name');
    expect(en).toContain('drogues');
    expect(autoRejectedIn(en, 'fr')).toBe(stored('fr', 'drogues', 'name'));
    expect(autoRejectedIn(en, 'ar')).toBe(stored('ar', 'drogues', 'name'));
    expect(autoRejectedIn(stored('fr', 'arme', 'description'), 'en')).toBe(stored('en', 'arme', 'description'));
    // same language: unchanged
    expect(autoRejectedIn(en, 'en')).toBe(en);
  });

  it('leaves any other message as it is (a moderator wrote it)', () => {
    expect(autoRejectedIn('Photo floue : merci de la remplacer.', 'en')).toBe('Photo floue : merci de la remplacer.');
    expect(autoRejectedIn(null, 'fr')).toBeNull();
    expect(autoRejectedIn('', 'fr')).toBe('');
  });
});
