import { describe, expect, it } from 'vitest';
import { CashQuerySchema, cashDisplayMethod, purchaseTotalAfterReceipt, receiptLinePlan } from './gds';

describe('retest 11/11 UX-055 — mode of a cash row', () => {
  it('cash collected on a delivered order reads « COD »; the counter, purchases and the till stay « Espèces »', () => {
    expect(cashDisplayMethod('order', 'cash', '§stored.cash.orderCod|number=CMD-1001')).toBe('cod');
    expect(cashDisplayMethod('order', 'cash', '§stored.cash.orderCodPartial|number=CMD-1001|amount=2 000 DA')).toBe('cod');
    expect(cashDisplayMethod('order', 'cash', 'Commande #CMD-1001 livrée (COD)')).toBe('cod'); // a row written before the keys
    expect(cashDisplayMethod('sale', 'cash', null)).toBe('cash');
    expect(cashDisplayMethod('deposit', 'cash', null)).toBe('cash');
    expect(cashDisplayMethod('order', 'ccp', '§stored.cash.orderCod|number=CMD-1001')).toBe('ccp');
  });
  it('journeys 16/11 J05-6: a cash deposit before delivery stays « Espèces », as on the order page', () => {
    expect(cashDisplayMethod('order', 'cash', '§stored.cash.orderPayment|number=CMD-1027')).toBe('cash');
    expect(cashDisplayMethod('order', 'cash', '§stored.cash.orderDeposit|number=CMD-1027')).toBe('cash');
  });
  it('the journal filter accepts « cod » next to the stored methods', () => {
    expect(CashQuerySchema.parse({ method: 'cod,cash' }).method).toEqual(['cod', 'cash']);
    expect(CashQuerySchema.safeParse({ method: 'cheque' }).success).toBe(false);
  });
});

describe('journey J07r-1 — what the purchase costs once the receipt is written', () => {
  const line = (id: string, quantity: number, receivedQty: number, unitCost: number) => ({ id, quantity, receivedQty, unitCost, total: quantity * unitCost });
  it('a cost typed at the receipt re-prices a line with nothing received yet (#ACH-1005: 1 × 1 000 received at 1 500 ⇒ 1 500)', () => {
    expect(purchaseTotalAfterReceipt({ items: [line('a', 1, 0, 1000)], tax: 0, shippingCost: 0 }, { items: [{ id: 'a', receivedQty: 1, unitCost: 1500 }] })).toBe(1500);
  });
  it('a 2nd receipt at a new cost splits the line; an over-receipt raises the quantity; tax + shipping and added lines count', () => {
    // Tapis 5 × 4 000 with 3 received, 2 now at 4 200 ⇒ 12 000 + 8 400; Pull 3 × 1 300, 4 received ⇒ 5 200; + new line 2 × 500
    const p = { items: [{ ...line('t', 5, 3, 4000) }, line('p', 3, 0, 1300), line('c', 2, 0, 900)], tax: 100, shippingCost: 50 };
    const total = purchaseTotalAfterReceipt(p, { items: [{ id: 't', receivedQty: 2, unitCost: 4200 }, { id: 'p', receivedQty: 4, unitCost: 1300 }, { id: 'c', receivedQty: 0, unitCost: 2000 }], newItems: [{ receivedQty: 2, unitCost: 500 }] });
    expect(total).toBe(12000 + 8400 + 5200 + 1800 + 1000 + 150);
    expect(receiptLinePlan({ quantity: 5, receivedQty: 3, unitCost: 4000 }, 2, 4200)).toEqual({ line: { quantity: 3, receivedQty: 3, unitCost: 4000, total: 12000 }, split: { quantity: 2, receivedQty: 2, unitCost: 4200, total: 8400 } });
    expect(receiptLinePlan({ quantity: 3, receivedQty: 0, unitCost: 1300 }, 4, 1300)).toEqual({ line: { quantity: 4, receivedQty: 4, unitCost: 1300, total: 5200 }, split: null });
  });
});
