import { reportMethod } from './definitions';

const COD = '§stored.cash.orderCod|number=CMD-1001';
describe('UX-052 payment method of the payments / cash journal reports', () => {
  it('« COD » only for cash collected on an order at delivery; cash at the counter or on a purchase stays « Espèces »', () => {
    expect(reportMethod('cash', 'order', COD)).toBe('cod');
    expect(reportMethod('cash', 'sale', null)).toBe('cash');
    expect(reportMethod('cash', 'purchase', null)).toBe('cash');
    expect(reportMethod('cash', null, null)).toBe('cash');
    expect(reportMethod('ccp', 'order', COD)).toBe('ccp');
  });
  it('journeys 16/11 J05-6: a cash deposit before delivery is « Espèces » (the order page says so)', () => {
    expect(reportMethod('cash', 'order', '§stored.cash.orderPayment|number=CMD-1027')).toBe('cash');
    expect(reportMethod('cash', 'order', '§stored.cash.orderDeposit|number=CMD-1027')).toBe('cash');
  });
});

describe('journeys 16/11 J11-7 (f): an expense of an order is never « COD »', () => {
  it('the return fee keeps « Espèces »', () => {
    expect(reportMethod('cash', 'order', '§stored.cash.orderReturnFee|number=CMD-1027')).toBe('cash');
    expect(reportMethod('cash', 'order', null)).toBe('cash'); // expense rows pass no description
  });
});
