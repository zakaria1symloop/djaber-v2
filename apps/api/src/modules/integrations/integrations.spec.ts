// M11 unit rules: webhook signature / URL rules / delivery labels, Sheets row (GSH-03), filters (GSH-06), row lookup (GSH-04).
import { SHEETS_COLUMNS, WEBHOOK_MAX_ATTEMPTS } from '@djaber/shared';
import { deliverySummary, eventIdOf, maxAttemptsOf } from './webhook-dispatch.service';
import { isLocalHost, newWebhookSecret, secretHint, signWebhook, verifyWebhookSignature, webhookUrlAllowed } from './webhook-signing';
import { algiersStamp, matchesFilters, rowOf, sheetsRowOf, type SheetsOrder } from './sheets/sheets-row';

describe('webhook signature (03-events §6)', () => {
  const secret = newWebhookSecret(Buffer.alloc(24, 7));
  const body = JSON.stringify({ id: 'evt_1', event: 'order.created' });
  it('t=<unix>,v1=<hex hmac_sha256(secret, "t.body")> verifies; wrong secret, altered body, or |now − t| > 300 s fail', () => {
    const t = 1_760_000_000;
    const header = signWebhook(secret, body, t);
    expect(header).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, header, t + 299)).toBe(true);
    expect(verifyWebhookSignature(secret, body, header, t + 301)).toBe(false);
    expect(verifyWebhookSignature(`${secret}x`, body, header, t)).toBe(false);
    expect(verifyWebhookSignature(secret, `${body} `, header, t)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'garbage', t)).toBe(false);
    expect(verifyWebhookSignature(secret, body, null, t)).toBe(false);
  });
  it('secret format and hint', () => {
    expect(secret).toMatch(/^whsec_/);
    expect(secretHint(secret)).toBe(`whsec_…${secret.slice(-4)}`);
  });
  it('local hosts (dev receivers) and the URL rules of production', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.2', '192.168.100.36', '172.20.1.1', '::1', 'box.local']) expect([h, isLocalHost(h)]).toEqual([h, true]);
    for (const h of ['hooks.zapier.com', '8.8.8.8', '172.32.0.1']) expect([h, isLocalHost(h)]).toEqual([h, false]);
    expect(webhookUrlAllowed('https://erp.example.dz/h', true)).toBe(true);
    expect(webhookUrlAllowed('http://erp.example.dz/h', true)).toBe(false);
    expect(webhookUrlAllowed('https://10.0.0.2/h', true)).toBe(false);
    expect(webhookUrlAllowed('nope', false)).toBe(false);
  });
  it('attempts, event id, log label', () => {
    expect(maxAttemptsOf('ping')).toBe(1);
    expect(maxAttemptsOf('order.created')).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(7);
    expect(eventIdOf('order.created:1:1')).toBe(eventIdOf('order.created:1:1'));
    expect(eventIdOf('order.created:1:1')).not.toBe(eventIdOf('order.created:1:2'));
    expect(deliverySummary('order.created', { data: { number: 'CMD-1042' } })).toBe('#CMD-1042');
    expect(deliverySummary('order.status_changed', { data: { order: { number: 'CMD-7' } } })).toBe('#CMD-7');
    expect(deliverySummary('stock.low', { data: { name: 'Parfum Oud', sku: 'P1' } })).toBe('Parfum Oud');
    expect(deliverySummary('customer.new', { data: { client: { name: 'Amel' } } })).toBe('Amel');
    expect(deliverySummary('ping', { data: { endpointId: 'x' } })).toBeNull();
  });
});

describe('Google Sheets row (GSH-03 / GSH-04 / GSH-06)', () => {
  const order: SheetsOrder = {
    id: 'o-1',
    number: 'CMD-1001',
    orderedAt: new Date('2026-10-06T22:58:00Z'),
    source: 'ai',
    status: 'confirmed',
    paymentMethod: 'cash',
    channelId: 'c-1',
    channel: { name: 'Boutique Amel', platform: 'instagram' },
    clientName: 'Yacine',
    clientPhone: '0555123456',
    wilaya: { nameFr: 'Alger' },
    commune: null,
    communeText: 'Bab Ezzouar',
    address: 'Cité 200',
    isStopdesk: false,
    stopdeskName: null,
    items: [
      { productName: 'Robe', variantName: 'M', quantity: 2 },
      { productName: 'Sac', variantName: null, quantity: 1 },
    ],
    subtotal: 9000,
    deliveryFee: 600,
    total: 9600,
    shipment: { provider: 'yalidine', trackingNumber: 'YAL-1' },
  };
  const label = (kind: string, v: string) => `${kind}:${v}`;
  it('18 cells A…R in the fixed order, date in Africa/Algiers, phone as text, items joined, djaber_id last', () => {
    const row = sheetsRowOf(order, label);
    expect(row).toHaveLength(SHEETS_COLUMNS.length);
    expect(row).toEqual(['CMD-1001', '2026-10-06 23:58', 'Boutique Amel (IG)', 'Yacine', "'0555123456", 'Alger', 'Bab Ezzouar', 'Cité 200', 'Robe M ×2; Sac ×1', 9000, 600, 9600, 'method:cash', 'status:confirmed', 'courier:yalidine', 'YAL-1', 'source:ai', 'o-1']);
    expect(sheetsRowOf({ ...order, channel: null, shipment: null, isStopdesk: true, stopdeskName: 'Agence Hydra' }, label).slice(0, 16)).toEqual(expect.arrayContaining(['—', 'Bureau Agence Hydra', '']));
    expect(algiersStamp(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01 00:30');
  });
  it('filters: empty = all; channels and sources narrow', () => {
    expect(matchesFilters(order, {})).toBe(true);
    expect(matchesFilters(order, { channelIds: ['c-1'], sources: ['ai'] })).toBe(true);
    expect(matchesFilters(order, { channelIds: ['c-2'] })).toBe(false);
    expect(matchesFilters({ ...order, channelId: null }, { channelIds: ['c-1'] })).toBe(false);
    expect(matchesFilters(order, { sources: ['manual', 'api'] })).toBe(false);
  });
  it('row lookup by djaber_id (row 1 = header never matches)', () => {
    expect(rowOf(['djaber_id', 'a', 'b'], 'b')).toBe(3);
    expect(rowOf(['djaber_id', 'a'], 'z')).toBeNull();
    expect(rowOf(['a'], 'a')).toBeNull();
  });
});
