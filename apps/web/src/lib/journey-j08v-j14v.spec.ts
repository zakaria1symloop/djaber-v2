// journeys 19/11 J08v / J14v — Arabic unit counts (J14v-2), order numbers isolated in Arabic sentences built by code (J14v-1),
// the shared « reste à encaisser » of a WS-patched orders row (J08v-4).
import { describe, expect, it } from 'vitest';
import { getMessages } from '@djaber/shared';
import { orderContext } from '@/features/orders/dialogs/common';
import { patchRowFromSummary } from '@/features/orders/api';
import { docRef, makeT } from './format-message';

const FSI = '\u2068';
const PDI = '\u2069';

describe('J14v-2: unit counts take the Arabic number agreement', () => {
  const ar = makeT('ar', getMessages('ar'));
  const fr = makeT('fr', getMessages('fr'));
  it('products, purchases, sales', () => {
    expect(ar('products.page.units', { count: 2, n: '2' })).toBe('وحدتان');
    expect(ar('products.page.units', { count: 5, n: '5' })).toBe('5 وحدات');
    expect(ar('products.page.units', { count: 13, n: '13' })).toBe('13 وحدةً');
    expect(ar('products.page.units', { count: 1200, n: '1 200' })).toBe('1 200 وحدة');
    expect(ar('gds.units', { count: 3, n: '3' })).toBe('3 وحدات');
    expect(ar('purchases.form.totals', { total: 'T', remaining: 'R', unitsN: 2, units: '2' })).toBe('المجموع T · المتبقي R · وحدتان');
    expect(ar('purchases.receive.submit', { count: 7, n: '7' })).toBe('تأكيد الاستلام (7 وحدات)');
    expect(fr('products.page.units', { count: 5, n: '5' })).toBe('5 u');
    expect(fr('purchases.receive.done', { number: 'ACH-1002', count: 3, n: '3' })).toBe('#ACH-1002 : 3 u reçues');
  });
});

describe('J14v-1: an order number in an Arabic sentence is an isolate', () => {
  it('docRef / orderContext', () => {
    const ar = makeT('ar', getMessages('ar'));
    const fr = makeT('fr', getMessages('fr'));
    expect(docRef(ar, 'CMD-1003')).toBe(`${FSI}#CMD-1003${PDI}`);
    expect(docRef(ar, '#CMD-1003')).toBe(`${FSI}#CMD-1003${PDI}`);
    expect(docRef(fr, 'CMD-1003')).toBe('#CMD-1003');
    const o = { number: 'CMD-1003', status: 'confirmed', clientName: 'QA J14v Sara Meziane', total: 1500 } as never;
    expect(orderContext(ar, o).startsWith(`${FSI}#CMD-1003${PDI} · `)).toBe(true);
    expect(orderContext(fr, o)).toMatch(/^#CMD-1003 · .+ · QA J14v Sara Meziane · 1\s500\sDA$/u);
  });
});

describe('J08v-4: a WS summary keeps the shared « reste à encaisser »', () => {
  it('0 once the order is returned, the balance after a payment', () => {
    const row = { id: 'o1', status: 'shipped', total: 1900, amountPaid: 0, remaining: 1900 } as never;
    expect(patchRowFromSummary(row, { id: 'o1', status: 'returned' } as never).remaining).toBe(0);
    expect(patchRowFromSummary(row, { id: 'o1', amountPaid: 900 } as never).remaining).toBe(1000);
  });
});
