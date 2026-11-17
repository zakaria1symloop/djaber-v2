// full-test 15/11 ORDERS-21: the « Import terminé » screen offers the error report of the skipped / refused rows.
import { describe, expect, it } from 'vitest';
import { orderImportErrorsCsv } from './order-import';

const row = (n: number, ok: boolean, errors: { field: null | 'phone'; code: string }[] = []) => ({
  row: n,
  ok,
  values: { clientName: `Client ${n}`, phone: '0550111222', wilayaId: 16, wilaya: 'Alger', commune: null, communeId: null, address: null, note: null, items: [{ sku: 'RB-1', quantity: 2, productId: null, variantId: null, name: null, unitPrice: null }] },
  total: null,
  client: null,
  errors,
});
const headers = { row: 'Ligne', client: 'Client', phone: 'Téléphone', wilaya: 'Wilaya', items: 'Articles', errors: 'Erreur', code: 'Code (support)' };

describe('order import error report', () => {
  it('lists the preview errors and the rows refused at the commit, with the support code', () => {
    const csv = orderImportErrorsCsv(
      { rows: [row(2, true), row(3, false, [{ field: 'phone', code: 'VALIDATION_ERROR' }]), row(4, true)], report: { created: 1, skipped: 1, failed: [{ row: 4, code: 'ORDER_INSUFFICIENT_STOCK' }], orderIds: [] } },
      { headers, describe: (e) => `msg:${e.code}` },
    );
    const lines = csv.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Ligne;Client;Téléphone;Wilaya;Articles;Erreur;Code (support)');
    expect(lines[1]).toBe('3;Client 3;0550111222;Alger;RB-1 × 2;msg:VALIDATION_ERROR;VALIDATION_ERROR');
    expect(lines[2]).toBe('4;Client 4;0550111222;Alger;RB-1 × 2;msg:ORDER_INSUFFICIENT_STOCK;ORDER_INSUFFICIENT_STOCK');
  });
});
