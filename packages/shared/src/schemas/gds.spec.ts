import { describe, expect, it } from 'vitest';
import { CashQuerySchema, cashDisplayMethod } from './gds';

describe('retest 11/11 UX-055 — mode of a cash row', () => {
  it('cash collected on a delivered order reads « COD »; the counter, purchases and the till stay « Espèces »', () => {
    expect(cashDisplayMethod('order', 'cash')).toBe('cod');
    expect(cashDisplayMethod('sale', 'cash')).toBe('cash');
    expect(cashDisplayMethod('deposit', 'cash')).toBe('cash');
    expect(cashDisplayMethod('order', 'ccp')).toBe('ccp');
  });
  it('the journal filter accepts « cod » next to the stored methods', () => {
    expect(CashQuerySchema.parse({ method: 'cod,cash' }).method).toEqual(['cod', 'cash']);
    expect(CashQuerySchema.safeParse({ method: 'cheque' }).success).toBe(false);
  });
});
