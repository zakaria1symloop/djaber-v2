import { isGreetingOnly } from './greeting';

describe('isGreetingOnly (retest 12/11: a greeting after a handoff opens a new conversation)', () => {
  it('greetings in French, English, darija (Latin and Arabic script) and Arabic', () => {
    for (const t of ['Bonjour', 'bonsoir madame', 'Salut ça va ?', 'hello 👋', 'Hi there', 'good morning', 'salam', 'Salaaam alikoum', 'slm khouya', 'sbah el khir', 'wesh', 'cc', 'السلام عليكم ورحمة الله وبركاته', 'أهلا', 'صباح الخير', 'مساء الخير', 'سلام خويا'])
      expect([t, isGreetingOnly(t)]).toEqual([t, true]);
  });
  it('anything else is not a greeting', () => {
    for (const t of ['allo ?', 'Bonjour, je veux la robe rouge', 'salam, c’est combien ?', 'madame', 'merci', '0555123456', 'Cité 200 logements, Bab Ezzouar', '', '   ', 'hello hello hello hello hello hello hello hello hello', 'je veux parler à un conseiller'])
      expect([t, isGreetingOnly(t)]).toEqual([t, false]);
    expect(isGreetingOnly(null)).toBe(false);
  });
});
