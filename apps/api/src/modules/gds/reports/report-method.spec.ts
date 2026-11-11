import { reportMethod } from './definitions';

describe('UX-052 payment method of the payments / cash journal reports', () => {
  it('« COD » only for cash collected on an order; cash at the counter or on a purchase stays « Espèces »', () => {
    expect(reportMethod('cash', 'order')).toBe('cod');
    expect(reportMethod('cash', 'sale')).toBe('cash');
    expect(reportMethod('cash', 'purchase')).toBe('cash');
    expect(reportMethod('cash', null)).toBe('cash');
    expect(reportMethod('ccp', 'order')).toBe('ccp');
  });
});
