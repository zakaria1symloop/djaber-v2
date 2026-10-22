// A4 (tester report 2026-10-20: the bot asked again for details given before the conversation resumed).
import { mergeCustomer } from './reply.processor';
import { knownCustomer } from './turn-context.service';

describe('known customer', () => {
  it('a turn adds or corrects, an empty value never erases', () => {
    expect(mergeCustomer({ name: 'Amina', phone: '0555123456' }, { phone: ' 0661 22 33 44 ', wilaya: 'Blida', address: '' })).toEqual({ name: 'Amina', phone: '0661 22 33 44', wilaya: 'Blida' });
    expect(mergeCustomer(undefined, {})).toBeUndefined();
  });
  it('client record + what was said (newest wins); the generic placeholder name is left out', () => {
    const client = { name: 'FB User ·123456', phone: null, phone2: null, isPlaceholder: true, addresses: [] };
    expect(knownCustomer(client, { name: 'Amina B.', commune: 'Blida' })).toEqual({ name: 'Amina B.', commune: 'Blida' });
    const known = { name: 'Amina Benali', phone: '0555123456', phone2: null, isPlaceholder: false, addresses: [{ address: 'Cité 200 logts', communeText: null, wilaya: { nameFr: 'Alger' }, commune: { nameFr: 'Bab Ezzouar' } }] };
    expect(knownCustomer(known, { address: 'Cité 300 logts' })).toEqual({ name: 'Amina Benali', phone: '0555123456', wilaya: 'Alger', commune: 'Bab Ezzouar', address: 'Cité 300 logts' });
    expect(knownCustomer(null, undefined)).toBeNull();
  });
});
