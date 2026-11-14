// UX-056 leftovers (UX/UI test log 12/11 remarks, 14/11): the note of an order the AI cancelled is stored as a key and
// read in the viewer's language (« IA : demande du client » was French in the Arabic order history).
import { renderStoredTextIn, storedText } from '@djaber/shared';
import { aiCancelNote } from './order-rules';

describe('aiCancelNote', () => {
  it('no reason from the model ⇒ the « at the customer’s request » key, rendered per viewer', () => {
    const note = aiCancelNote(null);
    expect(note).toBe('§stored.order.aiCustomerRequest');
    expect(renderStoredTextIn(note, 'ar')).toBe('بطلب من العميل (الذكاء الاصطناعي)');
    expect(renderStoredTextIn(note, 'fr')).toBe('à la demande du client (IA)');
    expect(aiCancelNote('   ')).toBe(note);
  });

  it('the model’s words travel as a value (the « IA : » prefix is localized, the words are not translated)', () => {
    const note = aiCancelNote('a trouvé moins cher');
    expect(renderStoredTextIn(note, 'en')).toBe('AI: a trouvé moins cher');
    expect(renderStoredTextIn(note, 'ar')).toBe('الذكاء الاصطناعي: a trouvé moins cher');
  });

  it('a note already stored as a key (A9 « remplacée par #CMD-1010 ») is kept as it is', () => {
    const replaced = storedText('stored.order.replacedBy', { number: 'CMD-1010' });
    expect(aiCancelNote(replaced)).toBe(replaced);
    expect(renderStoredTextIn(['changed_mind', aiCancelNote(replaced)].join(' · '), 'ar')).toBe('changed_mind · استُبدل بالطلب #CMD-1010');
  });
});
