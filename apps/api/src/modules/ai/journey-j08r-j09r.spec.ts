// Journeys J08r / J09r (18/11, docs/audit/journeys-2026-11-18/journeys/J08.md, J09.md): the AI's fee sentences and the street of the
// order recap.
import { homeFreeClaim, withBothFees } from './reply-fixes';
import { quoteFacts } from './reply-guard';
import { withoutPlaceSegments } from './tools/order-confirmation-text';

describe('journey J08r-7 #5 — a reply that says home delivery is free gets no « home delivery is 750 DA »', () => {
  // quote_delivery called without the cart: base fees, free from 10 000 DA at home
  const setif = quoteFacts([{ name: 'quote_delivery', result: { ok: true, wilayaName: 'Sétif', isStopdesk: false, fee: 750, free: false, stopdeskAvailable: true, stopdeskFee: 400, freeFrom: 10000 } }]);

  it('the 12 000 DA cart: the free claim stays alone, no contradicting home fee', () => {
    const reply = "Oui, avec une commande de 12 000 DA, la livraison à domicile à Sétif est gratuite. Le gratuit ne s'applique pas au stop-desk, qui reste à 400 DA.";
    expect(withBothFees(reply, setif, 'fr')).toBe(reply);
  });

  it('a threshold sentence is not a free claim: the home fee is still added', () => {
    const reply = 'La livraison à domicile devient gratuite dès 10 000 DA. En stop-desk, c’est 400 DA.';
    expect(withBothFees(reply, setif, 'fr')).toBe('La livraison à domicile devient gratuite dès 10 000 DA. La livraison à domicile est à 750 DA. En stop-desk, c’est 400 DA.');
  });

  it('homeFreeClaim: free + home word, no stop-desk word, no threshold', () => {
    expect(homeFreeClaim('la livraison à domicile à Sétif est gratuite.', { freeFrom: 10000 })).toBe(true);
    expect(homeFreeClaim("Home delivery is free for your order.", {})).toBe(true);
    expect(homeFreeClaim("Le gratuit ne s'applique pas au stop-desk.", { freeFrom: 10000 })).toBe(false);
    expect(homeFreeClaim('La livraison à domicile est gratuite à partir de 10 000 DA.', { freeFrom: 10000 })).toBe(false);
    expect(homeFreeClaim('La livraison à domicile est à 750 DA.', { freeFrom: 10000 })).toBe(false);
  });
});

describe('journey J09r-5 — the street keeps its own words: only a leading / trailing commune or wilaya is taken off', () => {
  const BLIDA = ['Blida', 'البليدة'];

  it('« Blida centre, rue des orangers 16 » stays whole (the recap read « centre, rue des orangers 16 »)', () => {
    expect(withoutPlaceSegments('Blida centre, rue des orangers 16', BLIDA)).toBe('Blida centre, rue des orangers 16');
    expect(withoutPlaceSegments('Blida centre, rue des orangers 14', BLIDA)).toBe('Blida centre, rue des orangers 14');
    expect(withoutPlaceSegments('rue des orangers 16, Blida centre', BLIDA)).toBe('rue des orangers 16, Blida centre');
    expect(withoutPlaceSegments('وسط البليدة، شارع البرتقال 16', BLIDA)).toBe('وسط البليدة، شارع البرتقال 16');
  });

  it('a name between the street words stays; the leading / trailing names still go', () => {
    expect(withoutPlaceSegments('cité 500 logements Blida bloc 12', BLIDA)).toBe('cité 500 logements Blida bloc 12');
    expect(withoutPlaceSegments('Blida, rue des orangers 16', BLIDA)).toBe('rue des orangers 16');
    expect(withoutPlaceSegments('rue des orangers 16, Blida', BLIDA)).toBe('rue des orangers 16');
    expect(withoutPlaceSegments('wilaya de Blida rue des orangers 16', BLIDA)).toBe('rue des orangers 16');
    expect(withoutPlaceSegments('rue des orangers 16 à Blida', BLIDA)).toBe('rue des orangers 16');
  });
});
