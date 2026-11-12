// UX-058 (12/11): one writing rule for the dates and enumerated values of every merchant export (06 §7).
import { exportDate, exportDateTime, exportLabel } from './export-cells';

describe('exportDateTime / exportDate (Africa/Algiers wall clock)', () => {
  it('UX-058: 14:38 UTC is « 11/11/2026 15:38 », an Excel serial of the same wall-clock minute', () => {
    const c = exportDateTime('2026-11-11T14:38:00.000Z')!;
    expect(c).toMatchObject({ format: 'datetime', text: '11/11/2026 15:38' });
    // 11/11/2026 = serial 46337; 15:38 = 938 minutes of 1440
    expect(c.date).toBeCloseTo(46337 + 938 / 1440, 9);
    expect(exportDateTime(new Date('2026-11-11T14:38:00.000Z'))).toEqual(c);
  });

  it('a line recorded between midnight and 1 a.m. (Algiers) keeps its own day', () => {
    expect(exportDateTime('2026-11-10T23:30:00.000Z')!.text).toBe('11/11/2026 00:30');
    expect(exportDate('2026-11-10T23:30:00.000Z')).toMatchObject({ format: 'date', text: '11/11/2026', date: 46337 });
  });

  it('seconds are cut like the screens; empty or invalid ⇒ null', () => {
    expect(exportDateTime('2026-01-05T08:07:59.999Z')!.text).toBe('05/01/2026 09:07');
    expect(exportDateTime(null)).toBeNull();
    expect(exportDateTime(undefined)).toBeNull();
    expect(exportDateTime('')).toBeNull();
    expect(exportDateTime('not a date')).toBeNull();
  });

  it('a date-only value is written as is (no time-zone shift)', () => {
    expect(exportDate('2026-11-11')).toEqual({ date: 46337, format: 'date', text: '11/11/2026' });
    expect(exportDate(null)).toBeNull();
  });
});

describe('exportLabel (screen labels in the export language)', () => {
  it('UX-055 remark: Caisse type and mode as on screen, not « order » / « cod »', () => {
    expect(exportLabel('fr', 'enum.Cash.category', 'order')).toBe('COD livré');
    expect(exportLabel('en', 'enum.Cash.category', 'order')).toBe('COD delivered');
    expect(exportLabel('fr', 'orders.payment.method', 'cod')).toBe('COD');
    expect(exportLabel('fr', 'orders.payment.method', 'cash')).toBe('Espèces');
    expect(exportLabel('en', 'orders.payment.method', 'cash')).toBe('Cash');
    expect(exportLabel('ar', 'orders.payment.method', 'cash')).toBe('نقدًا');
  });

  it('pill decorations are dropped; placeholders are filled or removed', () => {
    expect(exportLabel('fr', 'enum.Order.source', 'ai')).toBe('IA');
    expect(exportLabel('fr', 'enum.Order.source', 'api')).toBe('API');
    expect(exportLabel('fr', 'enum.Shipment.status', 'delivered')).toBe('LIVRÉE');
    expect(exportLabel('fr', 'enum.Order.confirmationStatus', 'no_answer', { attempts: 2, time: '' })).toBe('SANS RÉPONSE 2/3');
    expect(exportLabel('fr', 'enum.Order.confirmationStatus', 'callback', { attempts: 0, time: '' })).toBe('RAPPEL');
    expect(exportLabel('fr', 'enum.StockMovement.type', 'adjustment_in')).toBe('AJUST. +');
  });

  it('first prefix that knows the value; unknown value kept as stored; empty ⇒ empty; unknown locale ⇒ French', () => {
    expect(exportLabel('fr', ['enum.Shipment.status', 'enum.Order.deliveryStatus'], 'not_sent')).toBe('NON ENVOYÉE');
    expect(exportLabel('fr', ['sales.method', 'orders.payment.method'], 'transfer')).toBe('Virement');
    expect(exportLabel('fr', 'enum.StockMovement.reason', 'Casse en rayon')).toBe('Casse en rayon');
    expect(exportLabel('fr', 'enum.Cash.category', null)).toBe('');
    expect(exportLabel('de', 'enum.Cash.category', 'sale')).toBe('Vente');
  });
});
