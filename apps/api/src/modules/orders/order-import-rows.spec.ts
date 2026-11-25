// 03 §37 ORD "Import orders" — column auto-mapping, "SKU×qty;SKU×qty" parsing and per-row validation.
import { autoMapOrders, buildOrderRow, missingOrderColumns, parseItems, parseOrderDate, resolveWilaya, type ImportCatalog, type ImportItem } from './order-import-rows';

const ROBE: ImportItem = { productId: 'p1', variantId: null, name: 'Robe', hasVariants: false, trackStock: true, available: 3, price: 4500 };
const KAB: ImportItem = { productId: 'p2', variantId: null, name: 'Kabyle', hasVariants: true, trackStock: true, available: null, price: 5000 };
const KAB_M: ImportItem = { productId: 'p2', variantId: 'v1', name: 'Kabyle · M', hasVariants: true, trackStock: true, available: 5, price: 5000 };
const cat = (): ImportCatalog => ({
  skus: new Map([
    ['ROBE-01', ROBE],
    ['KAB', KAB],
    ['KAB-M', KAB_M],
  ]),
  names: new Map([
    ['robe', ROBE],
    ['kabyle', KAB],
    ['kabyle m', KAB_M],
  ]),
  wilayas: new Map([
    [16, { id: 16, nameFr: 'Alger', nameAr: 'الجزائر', served: true, homePrice: 400 }],
    [19, { id: 19, nameFr: 'Sétif', served: false, homePrice: 600 }],
  ]),
  communes: new Map([[16, new Map([['bab ezzouar', 1601]])]]),
  existingPhones: new Set(['0555123456']),
});
const mapping = autoMapOrders(['Nom', 'Téléphone', 'Wilaya', 'Commune', 'Adresse', 'Articles', 'Note']);
const raw = (over: Record<string, string> = {}) => ({ Nom: 'Amine Benali', Téléphone: '0555 12 34 56', Wilaya: '16', Commune: 'Bab Ezzouar', Adresse: 'Cité 200 logements Bt 4', Articles: 'ROBE-01×2', Note: '', ...over });

describe('order import rows', () => {
  it('auto-maps French headers; required columns', () => {
    expect(mapping).toEqual({ clientName: 'Nom', phone: 'Téléphone', wilaya: 'Wilaya', commune: 'Commune', address: 'Adresse', items: 'Articles', note: 'Note' });
    expect(missingOrderColumns({ clientName: 'Nom' })).toEqual(['phone', 'wilaya', 'address', 'items']);
  });
  it('parses SKU×qty lists', () => {
    expect(parseItems('ROBE-01×2;KAB-M x 1;SAC')).toEqual([
      { sku: 'ROBE-01', quantity: 2, raw: 'ROBE-01×2' },
      { sku: 'KAB-M', quantity: 1, raw: 'KAB-M x 1' },
      { sku: 'SAC', quantity: 1, raw: 'SAC' },
    ]);
    // the Djaber export: « name · variant × quantity × unit price » ; ZR Express: « name variant x2, name x1 »
    expect(parseItems('Kabyle · M × 2 × 5000 ; Robe × 1 × 4500')).toEqual([
      { sku: 'Kabyle · M', quantity: 2, raw: 'Kabyle · M × 2 × 5000' },
      { sku: 'Robe', quantity: 1, raw: 'Robe × 1 × 4500' },
    ]);
    expect(parseItems('Kabyle M x2, Robe x1')!.map((i) => [i.sku, i.quantity])).toEqual([['Kabyle M', 2], ['Robe', 1]]);
    expect(parseItems('')).toBeNull();
  });
  it('wilaya by code, "16 - Alger" or name', () => {
    const w = cat().wilayas;
    expect(resolveWilaya('16', w)).toBe(16);
    expect(resolveWilaya('16 - Alger', w)).toBe(16);
    expect(resolveWilaya('alger', w)).toBe(16);
    expect(resolveWilaya('الجزائر', w)).toBe(16); // an export viewed in Arabic
  });
  it('PV 08/11: a file exported by Djaber is read back — standard and ZR Express columns, articles by name, Arabic wilaya', () => {
    expect(autoMapOrders(['Client', 'Tel 1', 'Tel 2', 'Wilaya', 'Commune', 'Adresse', 'Produit', 'Total', 'Stop desk', 'Référence'])).toEqual({ clientName: 'Client', phone: 'Tel 1', wilaya: 'Wilaya', commune: 'Commune', address: 'Adresse', items: 'Produit' });
    expect(autoMapOrders(['N°', 'Date', 'Client', 'Téléphone', 'Wilaya', 'Commune', 'Adresse', 'Articles', 'Total'])).toMatchObject({ clientName: 'Client', phone: 'Téléphone', items: 'Articles' });
    const exported = buildOrderRow(2, raw({ Articles: 'Kabyle · M × 2 × 5000 ; Robe × 1 × 4500', Wilaya: 'الجزائر' }), mapping, cat(), new Map());
    expect(exported).toMatchObject({ ok: true, values: { wilayaId: 16, items: [{ productId: 'p2', variantId: 'v1', quantity: 2 }, { productId: 'p1', variantId: null, quantity: 1 }] } });
    const zr = buildOrderRow(3, raw({ Articles: 'Kabyle M x1, Robe x1' }), mapping, cat(), new Map());
    expect(zr.values.items.map((i) => [i.variantId ?? i.productId, i.quantity])).toEqual([['v1', 1], ['p1', 1]]);
    expect(zr.ok).toBe(true);
  });
  it('a valid row: existing client, commune resolved, informative total', () => {
    const r = buildOrderRow(2, raw(), mapping, cat(), new Map());
    expect(r).toMatchObject({ ok: true, client: 'existing', values: { phone: '0555123456', wilayaId: 16, communeId: 1601 }, total: 9400 });
  });
  it('errors: phone, unknown SKU, variant required, wilaya not served, stock taken by the rows above', () => {
    const c = cat();
    const taken = new Map<string, number>();
    expect(buildOrderRow(2, raw({ Téléphone: '123' }), mapping, c, taken).errors).toEqual([{ field: 'phone', code: 'VALIDATION_ERROR', params: { rule: 'validation.phone' } }]);
    expect(buildOrderRow(3, raw({ Articles: 'NOPE×1' }), mapping, c, taken).errors).toEqual([{ field: 'items', code: 'NOT_FOUND', params: { sku: 'NOPE' } }]);
    expect(buildOrderRow(4, raw({ Articles: 'KAB×1' }), mapping, c, taken).errors[0]).toMatchObject({ code: 'VARIANT_REQUIRED' });
    expect(buildOrderRow(5, raw({ Wilaya: 'Sétif' }), mapping, c, taken).errors[0]).toMatchObject({ code: 'WILAYA_NOT_SERVED' });
    expect(buildOrderRow(6, raw({ Articles: 'ROBE-01×2' }), mapping, c, taken).ok).toBe(true);
    expect(buildOrderRow(7, raw({ Articles: 'ROBE-01×2' }), mapping, c, taken).errors[0]).toEqual({ field: 'items', code: 'ORDER_INSUFFICIENT_STOCK', params: { product: 'Robe', available: 1 } });
  });

  describe('L80 (client list 22/11): the order date comes from the file', () => {
    const iso = (s: string) => parseOrderDate(s)?.toISOString() ?? null;
    it('auto-maps the « Date » column of our export (fr / ar / en) and the usual names', () => {
      expect(autoMapOrders(['N°', 'Date', 'Heure', 'Client', 'Téléphone', 'Wilaya', 'Adresse / stop-desk', 'Articles (nom × qté × prix)'])).toMatchObject({ orderedAt: 'Date', clientName: 'Client', address: 'Adresse / stop-desk' });
      // owner decision 25/11: the export header is now « Adresse / bureau » (« Address / office », « العنوان / المكتب »); older files keep importing
      expect(autoMapOrders(['N°', 'Date', 'Client', 'Téléphone', 'Wilaya', 'Adresse / bureau', 'Articles (nom × qté × prix)'])).toMatchObject({ clientName: 'Client', address: 'Adresse / bureau' });
      expect(autoMapOrders(['No.', 'Date', 'Client', 'Phone', 'Wilaya', 'Address / office'])).toMatchObject({ address: 'Address / office' });
      expect(autoMapOrders(['التاريخ', 'العميل', 'الهاتف', 'العنوان / المكتب'])).toMatchObject({ address: 'العنوان / المكتب' });
      expect(autoMapOrders(['التاريخ', 'العميل', 'الهاتف'])).toMatchObject({ orderedAt: 'التاريخ', clientName: 'العميل', phone: 'الهاتف' });
      expect(autoMapOrders(['Order date', 'Client'])).toMatchObject({ orderedAt: 'Order date' });
      expect(autoMapOrders(['Date de commande'])).toEqual({ orderedAt: 'Date de commande' });
      // a delivery date is not the order date
      expect(autoMapOrders(['Date livraison'])).toEqual({});
    });
    it('reads Algiers wall time (UTC+1) and stores UTC: dd/mm/yyyy [hh:mm], yyyy-mm-dd [hh:mm], Excel serial, ISO instant', () => {
      expect(iso('20/11/2026 15:38')).toBe('2026-11-20T14:38:00.000Z');
      expect(iso('20/11/2026')).toBe('2026-11-19T23:00:00.000Z');
      expect(iso('5/3/2026 9:05')).toBe('2026-03-05T08:05:00.000Z');
      expect(iso('20-11-2026 15h38')).toBe('2026-11-20T14:38:00.000Z');
      expect(iso('20.11.26')).toBe('2026-11-19T23:00:00.000Z');
      expect(iso('2026-11-20 15:38:20')).toBe('2026-11-20T14:38:20.000Z');
      expect(iso('2026-11-20T15:38')).toBe('2026-11-20T14:38:00.000Z');
      expect(iso('2026-11-20')).toBe('2026-11-19T23:00:00.000Z');
      expect(iso('2026-11-20T14:38:00.000Z')).toBe('2026-11-20T14:38:00.000Z');
      expect(iso('2026-11-20T15:38:00+01:00')).toBe('2026-11-20T14:38:00.000Z');
      // the XLSX date cell of our export (« 20/11/2026 15:38 » = serial 46346 + 15:38 / 24 h), float noise rounded to the minute
      expect(iso(String(46346 + (15 * 60 + 38) / 1440))).toBe('2026-11-20T14:38:00.000Z');
      expect(iso('46346')).toBe('2026-11-19T23:00:00.000Z');
    });
    it('unreadable: impossible days, text, bare numbers that are no date cell', () => {
      for (const bad of ['31/02/2026', '13/13/2026', '2026-13-01', '20/11/2026 25:00', 'hier', '12', '0555123456', '20/11']) expect([bad, iso(bad)]).toEqual([bad, null]);
    });
    it('row: date kept as an ISO instant; empty ⇒ null (dated at the import); unreadable / future ⇒ VALIDATION_ERROR on orderedAt', () => {
      const m = autoMapOrders(['Nom', 'Téléphone', 'Wilaya', 'Commune', 'Adresse', 'Articles', 'Note', 'Date']);
      const now = new Date('2026-11-23T10:00:00Z');
      const row = (Date: string) => buildOrderRow(2, { ...raw(), Date }, m, cat(), new Map(), now);
      expect(row('20/11/2026 15:38')).toMatchObject({ ok: true, values: { orderedAt: '2026-11-20T14:38:00.000Z' } });
      expect(row('')).toMatchObject({ ok: true, values: { orderedAt: null } });
      expect(row('31/02/2026').errors).toEqual([{ field: 'orderedAt', code: 'VALIDATION_ERROR', params: { rule: 'validation.date', reason: 'format', value: '31/02/2026' } }]);
      expect(row('24/11/2026').errors).toEqual([{ field: 'orderedAt', code: 'VALIDATION_ERROR', params: { rule: 'validation.date', reason: 'future', value: '24/11/2026' } }]);
      // later today (Algiers 11:00 = 10:00 UTC … 12:00 is still to come) is refused too; the minute of now is accepted
      expect(row('23/11/2026 12:00').ok).toBe(false);
      expect(row('23/11/2026 11:00').ok).toBe(true);
    });
  });
});
