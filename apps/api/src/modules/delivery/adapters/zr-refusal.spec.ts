// Houssem live 23/11 (H-07 CMD-1018): ZR refused a parcel and the reason shown was « [object Object] ».
import { refusalKey, refusalText } from './zrexpress-app.adapter';

describe('ZR Express refusal reasons are always a sentence', () => {
  it('reads strings, lists of strings and lists of objects', () => {
    expect(refusalText('Le numéro est invalide')).toBe('Le numéro est invalide');
    expect(refusalText(['Le numéro est invalide', 'Trop court'])).toBe('Le numéro est invalide · Trop court');
    expect(refusalText([{ propertyName: 'Customer.Phone.Number1', errorMessage: 'Numéro invalide' }])).toBe('Numéro invalide');
    expect(refusalText({ message: 'Hub introuvable' })).toBe('Hub introuvable');
    // CMD-1018, second try: ZR's own unfilled template is dropped
    expect(refusalText(['Phone_Number1 must be a valid international phone number. [Index: {CollectionIndex}]'])).toBe('Phone_Number1 must be a valid international phone number.');
    expect(refusalText({ foo: 1 })).toBe('{"foo":1}');
    expect(refusalText([{ a: 1 }])).not.toContain('[object Object]');
  });
  it('names the refused field when the answer gives it', () => {
    expect(refusalKey([{ propertyName: 'Customer.Phone.Number1', errorMessage: 'x' }])).toBe('Customer.Phone.Number1');
    expect(refusalKey({ field: 'amount' })).toBe('amount');
    expect(refusalKey('text')).toBe('');
  });
});
