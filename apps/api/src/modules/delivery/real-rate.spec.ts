// Live ZR price list 25/11: four far-south wilayas priced « home 0 DA, pickup 10 DA » — copied, the delivery became free.
import { realRate } from './rates.service';

describe('realRate', () => {
  it('a home price of 0 means the wilaya is not served: nothing of the row is a price', () => {
    expect(realRate({ wilayaId: 33, home: 0, stopdesk: 10 })).toEqual({ wilayaId: 33, home: null, stopdesk: null });
  });
  it('a 0 or negative pickup price alone is dropped, the home price is kept', () => {
    expect(realRate({ home: 750, stopdesk: 0 })).toEqual({ home: 750, stopdesk: null });
    expect(realRate({ home: 750, stopdesk: -1 })).toEqual({ home: 750, stopdesk: null });
  });
  it('real prices and a courier that only gives one of the two are left as they are', () => {
    expect(realRate({ home: 750, stopdesk: 580 })).toEqual({ home: 750, stopdesk: 580 });
    expect(realRate({ home: null, stopdesk: 580 })).toEqual({ home: null, stopdesk: 580 });
  });
});
