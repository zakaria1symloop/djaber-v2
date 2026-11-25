// Houssem live 25/11 UX-098: a voice note transcribed correctly got no reply — create_order {} was refused for its missing fields and the
// model's reply came out empty. A turn never ends in silence.
import { silentTurnText } from './reply.processor';

const refused = (fields: string[]) => [{ name: 'create_order', result: { ok: false, error: { code: 'VALIDATION', field: fields[0], fields, missing: true } } }];
const ALL = ['items', 'clientName', 'clientPhone', 'wilayaId', 'communeName', 'address'];

describe('silentTurnText', () => {
  it('asks the first order field the refused create_order lacked and the conversation does not know', () => {
    expect(silentTurnText(refused(ALL), undefined, 'fr')).toBe('Quel est votre nom ?');
    expect(silentTurnText(refused(ALL), { name: 'QA R1' }, 'fr')).toContain('numéro de téléphone');
    expect(silentTurnText(refused(ALL), { name: 'QA R1', phone: '0698765432' }, 'ar')).toBe('واش من ولاية ؟');
    expect(silentTurnText(refused(['communeName', 'address']), { name: 'A', phone: '0550000000', wilaya: 'Oran' }, 'arabizi')).toContain('commune');
  });

  it('everything known, or no refused order: asks what the customer wants, in their language', () => {
    const known = { name: 'QA R1', phone: '0698765432', wilaya: 'Alger', commune: 'Bab Ezzouar', address: 'cité 500 logements' };
    expect(silentTurnText(refused(ALL), known, 'fr')).toContain('wilaya');
    expect(silentTurnText([], undefined, 'en')).toMatch(/which product/i);
    expect(silentTurnText([{ name: 'quote_delivery', result: { ok: true } }], undefined, 'mixed')).toContain('préciser');
  });
});
