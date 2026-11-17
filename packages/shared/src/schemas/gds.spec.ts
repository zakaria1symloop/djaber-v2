import { describe, expect, it } from 'vitest';
import { CashQuerySchema, cashDisplayMethod } from './gds';

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
