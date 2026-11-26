// UX-104 (tester live 26/11): the recap read « Bab Ezzouar, Oran » — a commune of Alger under the wilaya of a price question.
import { communeOfOtherWilaya } from './tools/tool-registry';

const COMMUNES = [
  { nameFr: 'Bab Ezzouar', nameAr: 'باب الزوار', wilayaId: 16 },
  { nameFr: 'Es Senia', nameAr: 'السانية', wilayaId: 31 },
  { nameFr: 'Aïn Beïda', nameAr: 'عين البيضاء', wilayaId: 4 },
  { nameFr: 'Aïn Beïda', nameAr: 'عين البيضاء', wilayaId: 31 },
];

describe('communeOfOtherWilaya', () => {
  it('a commune of another wilaya is named with its own wilaya, in any spelling', () => {
    expect(communeOfOtherWilaya(COMMUNES, 31, 'Bab Ezzouar')).toBe(16);
    expect(communeOfOtherWilaya(COMMUNES, 31, 'bab ezzouar')).toBe(16);
    expect(communeOfOtherWilaya(COMMUNES, 31, 'باب الزوار')).toBe(16);
  });
  it('a commune of the order wilaya is fine, also when another wilaya has one of the same name', () => {
    expect(communeOfOtherWilaya(COMMUNES, 16, 'Bab Ezzouar')).toBeNull();
    expect(communeOfOtherWilaya(COMMUNES, 31, 'Ain Beida')).toBeNull();
    expect(communeOfOtherWilaya(COMMUNES, 4, 'عين البيضاء')).toBeNull();
  });
  it('a locality of no list is the customer own word: kept', () => {
    expect(communeOfOtherWilaya(COMMUNES, 31, 'Hai Sabah')).toBeNull();
    expect(communeOfOtherWilaya(COMMUNES, 31, '')).toBeNull();
    expect(communeOfOtherWilaya(COMMUNES, 31, null)).toBeNull();
  });
});
