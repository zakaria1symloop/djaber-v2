// journey J14v-2 follow-up (19/11): the texts the server renders (invoice lines, stored texts, admin notifications, customer
// messages) read ICU plurals with the reader's plural rules — « حزمة رصيدين », « 5 أرصدة », « 13 رصيدًا », « 1 200 رصيد ».
import { describe, expect, it } from 'vitest';
import { getMessages, renderStoredTextIn, storedText, textIn } from '../index';
import { expandPlurals, formatMessage } from './index';

describe('server formatMessage: ICU plurals (journey J14v-2)', () => {
  const pack = getMessages('ar')['billingDoc.line.pack']!;
  it('picks the Arabic form of the count (dual, 3–10, 11–99, 100+) and groups # by thousands', () => {
    expect(formatMessage(pack, { credits: 1 }, 'ar')).toBe('حزمة رصيد واحد');
    expect(formatMessage(pack, { credits: 2 }, 'ar')).toBe('حزمة رصيدين');
    expect(formatMessage(pack, { credits: 5 }, 'ar')).toBe('حزمة 5 أرصدة');
    expect(formatMessage(pack, { credits: 13 }, 'ar')).toBe('حزمة 13 رصيدًا');
    expect(formatMessage(pack, { credits: 1200 }, 'ar')).toBe('حزمة 1 200 رصيد');
    // a stored value is a string of digits
    expect(formatMessage(pack, { credits: '7' }, 'ar')).toBe('حزمة 7 أرصدة');
  });
  it('an Arabic template reads with the Arabic rules when no locale is given; French / English keep their text', () => {
    expect(formatMessage(pack, { credits: 2 })).toBe('حزمة رصيدين');
    expect(formatMessage(getMessages('fr')['billingDoc.line.pack']!, { credits: 500 }, 'fr')).toBe('Pack de 500 crédits');
    expect(formatMessage('{n, plural, =0 {aucun} one {# crédit} other {# crédits}} #{ref}', { n: 0, ref: 'X' }, 'fr')).toBe('aucun #X');
    expect(formatMessage('{n, plural, one {# crédit} other {# crédits}}', { n: 'abc' }, 'fr')).toBe('abc crédits');
  });
  it('nested blocks and values inside the picked branch', () => {
    expect(expandPlurals('{a, plural, one {un {b, plural, one {x} other {y}}} other {#}}', (k) => ({ a: 1, b: 3 })[k], 'fr')).toBe('un y');
    expect(formatMessage('{nN, plural, one {{n} crédit} other {{n} crédits}}', { n: '1 200', nN: 1200 }, 'fr')).toBe('1 200 crédits');
  });
  it('stored texts and catalogue texts read in Arabic', () => {
    expect(renderStoredTextIn(storedText('stored.tracking.stale', { days: 2 }), 'ar')).toBe('لا حدث من شركة التوصيل منذ يومين');
    expect(renderStoredTextIn(storedText('stored.block.uncollected', { count: 3 }), 'ar')).toBe('3 طرود لم تُستلَم');
    expect(textIn('stored.block.uncollected', 'fr', { count: 3 })).toBe('3 colis non récupérés');
  });
});
