// UX-104 reopened (tester 26/11 15:16): « واش نوصلوها لوهران (Bab Ezzouar) ولا لبلاصة أخرى؟ »
import { dropWrongPlacePairs } from './place-pairs';

const WILAYAS = [
  { id: 16, nameFr: 'Alger', nameAr: 'الجزائر' },
  { id: 31, nameFr: 'Oran', nameAr: 'وهران' },
  { id: 4, nameFr: 'Oum El Bouaghi', nameAr: 'أم البواقي' },
];
const COMMUNES = [
  { nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار', wilayaId: 16 },
  { nameFr: 'Es Senia', nameAr: 'السانية', wilayaId: 31 },
  { nameFr: 'Aïn Beïda', nameAr: 'عين البيضاء', wilayaId: 4 },
  { nameFr: 'Aïn Beïda', nameAr: 'عين البيضاء', wilayaId: 31 },
];
const fix = (t: string) => dropWrongPlacePairs(t, COMMUNES, WILAYAS);

describe('dropWrongPlacePairs', () => {
  it('the live reply: a commune of Alger in brackets after Oran is removed', () => {
    expect(fix('إيه، Satin dress روج متوفر بـ 2 000 دج. باش نكملو الطلبية، واش نوصلوها لوهران (Bab Ezzouar) ولا لبلاصة أخرى؟')).toBe('إيه، Satin dress روج متوفر بـ 2 000 دج. باش نكملو الطلبية، واش نوصلوها لوهران ولا لبلاصة أخرى؟');
    expect(fix('On livre à Oran (Bab Ezzouar) ?')).toBe('On livre à Oran ?');
    expect(fix('Bab Ezzouar (Oran)')).toBe('Bab Ezzouar');
    expect(fix('باب الزوار (وهران)')).toBe('باب الزوار');
  });
  it('a right pair, a commune that exists in both wilayas, a word of no list, other brackets: unchanged', () => {
    expect(fix('نوصلوها لباب الزوار (الجزائر) ولا لوهران؟')).toBe('نوصلوها لباب الزوار (الجزائر) ولا لوهران؟');
    expect(fix('Bab Ezzouar (Alger)')).toBe('Bab Ezzouar (Alger)');
    expect(fix('Oran (Es Senia)')).toBe('Oran (Es Senia)');
    expect(fix('Oran (Aïn Beïda)')).toBe('Oran (Aïn Beïda)');
    expect(fix('Oran (Hai Sabah)')).toBe('Oran (Hai Sabah)');
    expect(fix('Satin dress (red) : 2 000 DA')).toBe('Satin dress (red) : 2 000 DA');
    expect(fix('')).toBe('');
  });
});
