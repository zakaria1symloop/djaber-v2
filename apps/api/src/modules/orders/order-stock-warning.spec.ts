import { lineStockWarning } from './order.presenter';

describe('lineStockWarning (journey J02-6: the stock note of an order line)', () => {
  it('a new order only reserves: the note reads the stock left once its units are taken', () => {
    expect(lineStockWarning('new', 12, 2, false)).toBeNull();
    expect(lineStockWarning('new', 1, 1, false)).toBe('last_unit');
    expect(lineStockWarning('new', 1, 2, false)).toBe('insufficient');
  });
  it('a product sold at zero stock is a backorder, never « last unit »', () => {
    expect(lineStockWarning('new', 0, 1, true)).toBe('backorder');
    expect(lineStockWarning('confirmed', -1, 1, true)).toBe('backorder');
  });
  it('confirmed / preparing orders already took their units', () => {
    expect(lineStockWarning('confirmed', 0, 1, false)).toBe('last_unit');
    expect(lineStockWarning('preparing', -2, 1, false)).toBe('insufficient');
    expect(lineStockWarning('confirmed', 3, 1, false)).toBeNull();
  });
  it('no note on a closed order or a service', () => {
    expect(lineStockWarning('delivered', 0, 1, false)).toBeNull();
    expect(lineStockWarning('new', null, 1, false)).toBeNull();
  });
});
