// Contract tests of the three live courier drivers (00-build-order M6 exit criteria): recorded request / response pairs
// (test/fixtures/couriers/*.json, written from 05-integrations §2) replayed through a fake transport — no network.
// Each test checks the request the adapter builds (method, URL, auth headers, body) and how the answer is mapped.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { capabilitiesOf, CourierError, ZR_APP_CAPABILITIES, type CreateShipmentInput } from './courier-adapter';
import { createCourierAdapters } from './courier-registry';
import { EcotrackAdapter } from './ecotrack.adapter';
import type { CourierTransport, HttpRequest } from './http';
import { parseYalidineWebhook, YalidineAdapter } from './yalidine.adapter';
import { ZrExpressAppAdapter } from './zrexpress-app.adapter';
import { ZrExpressAdapter } from './zrexpress.adapter';

type Interaction = { request: { method: string; url: string; body?: unknown }; response: { status: number; json?: unknown; pdf?: boolean } };
type Fixture = { credentials: Record<string, string>; interactions: Record<string, Interaction> & { webhook?: { headers: Record<string, string>; body: unknown } } };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(resolve(__dirname, '../../../../test/fixtures/couriers', `${name}.json`), 'utf8')) as Fixture;

let pdfBytes: Buffer;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([297, 420]);
  pdfBytes = Buffer.from(await doc.save());
});

/** Replays the named interactions in order and records the requests. */
const replay = (f: Fixture, ...names: string[]) => {
  const seen: HttpRequest[] = [];
  const queue = [...names];
  const transport: CourierTransport = async (req) => {
    seen.push(req);
    const name = queue.shift();
    if (!name) throw new Error(`unexpected request ${req.method} ${req.url}`);
    const it = f.interactions[name] as Interaction;
    expect(req.method).toBe(it.request.method);
    expect(req.url).toBe(it.request.url);
    if (it.request.body !== undefined) expect(req.body).toEqual(it.request.body);
    const bytes = it.response.pdf ? pdfBytes : Buffer.from(JSON.stringify(it.response.json ?? null));
    return { status: it.response.status, json: it.response.pdf ? null : (it.response.json ?? null), bytes, contentType: it.response.pdf ? 'application/pdf' : 'application/json' };
  };
  return { transport, seen, done: () => expect(queue).toEqual([]) };
};

const input = (over: Partial<CreateShipmentInput> = {}): CreateShipmentInput => ({
  shipmentId: 'shp-1',
  orderNumber: 'CMD-1042',
  recipient: { name: 'Amine Benali', phone: '0555123456', phone2: null },
  wilayaId: 16,
  wilayaName: 'Alger',
  communeName: 'Bab Ezzouar',
  communeCode: 'Bab Ezzouar',
  address: 'Cité 200 logements, Bt 4',
  isStopdesk: false,
  stopdeskId: null,
  codAmount: 4900,
  weightGrams: null,
  productSummary: 'Robe kabyle ×1',
  note: null,
  declaredValue: 4500,
  sender: { name: 'Boutique', phone: '0555000000', wilayaId: 16, wilayaName: 'Alger', address: 'Alger centre' },
  ...over,
});

describe('ZR Express (05-integrations §2.2)', () => {
  const f = fixture('zrexpress');
  it('testCredentials: token + key headers, `Accès activé` ⇒ ok; other answer / 401 ⇒ COURIER_CREDENTIALS_INVALID', async () => {
    const r = replay(f, 'test_ok', 'test_refused', 'test_401');
    const zr = new ZrExpressAdapter(r.transport);
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: true });
    expect(r.seen[0]!.headers).toMatchObject({ token: 'zr-token-123456', key: 'zr-key-abcdef' });
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
    r.done();
  });
  it('createShipment: `add_colis` body, `Good` ⇒ tracking; message mapped to the field (Commune / Mobile); 503 ⇒ unavailable', async () => {
    const r = replay(f, 'create_ok', 'create_bad_commune', 'create_bad_phone', 'create_503');
    const zr = new ZrExpressAdapter(r.transport);
    expect(await zr.createShipment(f.credentials, input())).toMatchObject({ trackingNumber: 'ZR-16-778899' });
    await expect(zr.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'validation', field: 'commune' });
    await expect(zr.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'validation', field: 'phone' });
    await expect(zr.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'unavailable', code: 'COURIER_UNAVAILABLE' });
    r.done();
  });
  it('trackMany: `lire` with ≤ 50 trackings; Situation mapped (out for delivery, failed unreachable, unknown ⇒ null); dates Algiers → UTC', async () => {
    const r = replay(f, 'track_many');
    const res = await new ZrExpressAdapter(r.transport).trackMany(f.credentials, ['ZR-16-778899', 'ZR-16-778900', 'ZR-16-778901']);
    expect(res).toEqual([
      expect.objectContaining({ trackingNumber: 'ZR-16-778899', mapped: 'out_for_delivery', at: '2026-10-12T08:30:00.000Z', location: 'Alger' }),
      expect.objectContaining({ trackingNumber: 'ZR-16-778900', mapped: 'failed', failureReason: 'unreachable' }),
      expect.objectContaining({ trackingNumber: 'ZR-16-778901', mapped: null, rawStatus: 'Statut inconnu du transporteur' }),
    ]);
  });
  it('rates from `tarification` (Domicile / Stopdesk or TarifLivraison / TarifStopdesk), unknown wilayas dropped; no cancel / label', async () => {
    const r = replay(f, 'rates');
    const zr = new ZrExpressAdapter(r.transport);
    expect(await zr.getAllRates(f.credentials, 16)).toEqual([
      { wilayaId: 16, home: 400, stopdesk: 300 },
      { wilayaId: 31, home: 650, stopdesk: 450 },
    ]);
    expect(zr.capabilities).toMatchObject({ cancel: false, label: false, batchTrack: true });
    expect((zr as { cancel?: unknown }).cancel).toBeUndefined();
    expect((zr as { getLabel?: unknown }).getLabel).toBeUndefined();
  });
});

describe('ZR Express new platform (05-integrations §2.2b)', () => {
  const f = fixture('zrexpress-app');
  it('testCredentials: X-Api-Key + X-Tenant headers on the fixed host; 401 / unknown tenant ⇒ COURIER_CREDENTIALS_INVALID', async () => {
    const r = replay(f, 'test_ok', 'test_401', 'test_tenant');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: true });
    expect(r.seen[0]!.headers).toMatchObject({ 'X-Api-Key': 'zr-app-key-123456', 'X-Tenant': 'tenant-0001' });
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
    expect(await zr.testCredentials(f.credentials)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID', message: 'Tenant introuvable' });
    r.done();
  });
  it('createShipment: wilaya / commune → territory ids (all pages, searched once), externalId = order number; field errors mapped; unknown commune refused without a call', async () => {
    const r = replay(f, 'territories', 'territories_p2', 'create_ok', 'create_bad_phone', 'create_new_wilaya');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.createShipment(f.credentials, input())).toMatchObject({ trackingNumber: 'ZR-APP-778899', externalId: 'p-778899' });
    await expect(zr.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'validation', field: 'phone', message: 'Le numéro de téléphone est invalide.' });
    await expect(zr.createShipment(f.credentials, input({ communeName: 'Inconnue', communeCode: null }))).rejects.toMatchObject({ kind: 'validation', field: 'commune' });
    // a commune of a 2026 wilaya (68 Bou Saâda) shipped under its parent code 28: found in the new wilaya
    await zr.createShipment(f.credentials, input({ wilayaId: 28, wilayaName: "M'Sila", communeName: 'Bou Saada', communeCode: null }));
    expect(r.seen[4]!.body).toMatchObject({ deliveryAddress: { cityTerritoryId: 'w-68', districtTerritoryId: 'c-68-1' } });
    r.done();
  });
  it('stop-desk parcel: hubId + pickup-point; stop-desks = visible pickup-point hubs per courier wilaya', async () => {
    const r = replay(f, 'territories', 'territories_p2', 'hubs', 'create_desk');
    const zr = new ZrExpressAppAdapter(r.transport);
    await expect(zr.createShipment(f.credentials, input({ isStopdesk: true, stopdeskId: null }))).rejects.toMatchObject({ kind: 'validation', field: 'stopdesk' });
    await zr.createShipment(f.credentials, input({ isStopdesk: true, stopdeskId: 'hub-16-a' }));
    expect(r.seen[3]!.body).toMatchObject({ hubId: 'hub-16-a', deliveryType: 'pickup-point', deliveryAddress: { cityTerritoryId: 'w-16', districtTerritoryId: 'c-16-1' } });
    expect(await zr.listStopdesks(f.credentials, 16)).toEqual([{ id: 'hub-16-a', name: 'ZR Bab Ezzouar', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité 5 Juillet' }]);
    expect(await zr.listStopdesks(f.credentials, 28)).toEqual([{ id: 'hub-68-a', name: 'ZR Bou Saâda', wilayaId: 28, communeName: 'Bou Saâda', address: 'Route de Biskra' }]);
    r.done();
  });
  it('track: state mapped, situation = failure reason + description; 404 ⇒ TRACKING_NOT_FOUND', async () => {
    const r = replay(f, 'track_out', 'track_failed', 'track_404');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.track(f.credentials, 'ZR-APP-778899')).toMatchObject({ mapped: 'out_for_delivery', rawStatus: 'En livraison', at: '2026-10-12T08:30:00.000Z' });
    expect(await zr.track(f.credentials, 'ZR-APP-778900')).toMatchObject({ mapped: 'failed', failureReason: 'unreachable', rawStatus: 'Échec de livraison · Client injoignable', description: 'Client injoignable' });
    await expect(zr.track(f.credentials, 'ZR-APP-0')).rejects.toMatchObject({ kind: 'not_found', code: 'TRACKING_NOT_FOUND' });
    r.done();
  });
  it('cancel = DELETE of the parcel while not picked up, else COURIER_CANCEL_NOT_ALLOWED (no DELETE); label PDF fetched without the API key off ZR', async () => {
    const r = replay(f, 'cancel_get', 'cancel_delete', 'cancel_get_picked', 'label', 'label_file');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.cancel(f.credentials, 'ZR-APP-778899')).toEqual({ ok: true, rawStatus: 'Annulé' });
    await expect(zr.cancel(f.credentials, 'ZR-APP-778899')).rejects.toMatchObject({ kind: 'cancel_not_allowed' });
    const label = await zr.getLabel(f.credentials, 'ZR-APP-778899');
    expect(label.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.seen[4]!.headers['X-Api-Key']).toBeUndefined();
    expect(zr.capabilities).toMatchObject({ cancel: true, label: true, stopdesks: true, rates: true, batchTrack: false });
    r.done();
  });
  it('rates from the sender wilaya, default price list when the origin has none; commune rows dropped; TTC / discount preferred', async () => {
    const r = replay(f, 'territories', 'territories_p2', 'rates_origin_404', 'rates');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.getAllRates(f.credentials, 16)).toEqual([
      { wilayaId: 16, home: 400, stopdesk: 250 },
      { wilayaId: 31, home: 650, stopdesk: null },
    ]);
    r.done();
  });
  it('registry: a ZR account on api.zrexpress.app gets the new-platform adapter (fake driver too, with its capabilities)', () => {
    const live = createCourierAdapters({ NODE_ENV: 'production', COURIER_DRIVER: 'live', COURIER_ALLOW_LIVE: false }, async () => {
      throw new Error('no network in unit tests');
    });
    expect(live.zrApp).toBeInstanceOf(ZrExpressAppAdapter);
    const fake = createCourierAdapters({ NODE_ENV: 'test', COURIER_DRIVER: 'fake', COURIER_ALLOW_LIVE: false });
    expect(fake.zrApp.capabilities).toMatchObject({ cancel: true, label: true, stopdesks: true });
    expect(fake.adapters.zrexpress.capabilities).toMatchObject({ cancel: false, label: false, stopdesks: false });
    expect(capabilitiesOf('zrexpress', 'https://api.zrexpress.app')).toBe(ZR_APP_CAPABILITIES);
    expect(capabilitiesOf('zrexpress', '')).toMatchObject({ label: false });
  });
});

describe('EcoTrack (05-integrations §2.3)', () => {
  const f = fixture('ecotrack');
  it('testCredentials on the merchant instance with a Bearer token; 403 ⇒ COURIER_CREDENTIALS_INVALID', async () => {
    const r = replay(f, 'test_ok', 'test_403');
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.testCredentials(f.credentials)).toMatchObject({ ok: true, wilayasServed: 2 });
    expect(r.seen[0]!.headers.Authorization).toBe('Bearer eco-token-987654');
    expect(await eco.testCredentials(f.credentials)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
    await expect(eco.testCredentials({ baseUrl: 'http://insecure.ecotrack.dz', token: 'x' })).resolves.toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
  });
  it('createShipment body (poids in kg, rounded up); 422 errors{field} mapped (telephone → phone)', async () => {
    const r = replay(f, 'create_ok', 'create_422');
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.createShipment(f.credentials, input({ recipient: { name: 'Amine Benali', phone: '0555123456', phone2: '0661223344' }, weightGrams: 1200 }))).toMatchObject({ trackingNumber: 'ECO-5531209' });
    const err = await eco.createShipment(f.credentials, input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CourierError);
    expect(err).toMatchObject({ kind: 'validation', field: 'phone', message: 'Le numéro de téléphone est invalide.' });
  });
  it('track: last activity event mapped (Adresse introuvable ⇒ failed address); 404 ⇒ TRACKING_NOT_FOUND; trackMany keyed by tracking', async () => {
    const r = replay(f, 'track', 'track_404', 'track_many');
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.track(f.credentials, 'ECO-5531209')).toMatchObject({ mapped: 'failed', failureReason: 'address', rawStatus: 'Adresse introuvable', description: 'Bâtiment inexistant', location: 'Alger' });
    await expect(eco.track(f.credentials, 'ECO-0')).rejects.toMatchObject({ kind: 'not_found', code: 'TRACKING_NOT_FOUND' });
    expect((await eco.trackMany(f.credentials, ['ECO-1', 'ECO-2'])).map((t) => [t.trackingNumber, t.mapped])).toEqual([
      ['ECO-1', 'delivered'],
      ['ECO-2', 'returned'],
    ]);
  });
  it('label as PDF bytes; cancel refused ⇒ COURIER_CANCEL_NOT_ALLOWED; retry asked', async () => {
    const r = replay(f, 'label', 'cancel_refused', 'retry');
    const eco = new EcotrackAdapter(r.transport);
    const label = await eco.getLabel(f.credentials, 'ECO-5531209');
    expect(label.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(eco.cancel(f.credentials, 'ECO-5531209')).rejects.toMatchObject({ kind: 'cancel_not_allowed', code: 'COURIER_CANCEL_NOT_ALLOWED' });
    expect(await eco.retryDelivery(f.credentials, 'ECO-5531209')).toEqual({ ok: true });
  });
});

describe('Yalidine (05-integrations §2.4)', () => {
  const f = fixture('yalidine');
  it('testCredentials with X-API-ID / X-API-TOKEN; createShipment (stop-desk) ⇒ tracking + label URL; refusal message mapped to commune', async () => {
    const r = replay(f, 'test_ok', 'create_ok', 'create_bad');
    const yal = new YalidineAdapter(r.transport);
    expect(await yal.testCredentials(f.credentials)).toMatchObject({ ok: true, wilayasServed: 1 });
    expect(r.seen[0]!.headers).toMatchObject({ 'X-API-ID': 'yal-id-112233', 'X-API-TOKEN': 'yal-token-445566' });
    expect(await yal.createShipment(f.credentials, input({ isStopdesk: true, stopdeskId: '16201' }))).toMatchObject({ trackingNumber: 'yal-8CX2QK', labelUrl: expect.stringContaining('bordereau') });
    await expect(yal.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'validation', field: 'commune' });
  });
  it('trackMany (comma list ≤ 50): "Pas encore expédié" ⇒ sent (not "Expédié"), "Echèc livraison" ⇒ failed other (reason text kept), "Retour vers centre" ⇒ returned', async () => {
    const r = replay(f, 'track_many');
    const res = await new YalidineAdapter(r.transport).trackMany(f.credentials, ['yal-1', 'yal-2', 'yal-3']);
    expect(res.map((t) => [t.trackingNumber, t.mapped, t.failureReason])).toEqual([
      ['yal-1', 'sent', null],
      ['yal-2', 'failed', 'other'],
      ['yal-3', 'returned', null],
    ]);
    expect(res[1]).toMatchObject({ description: 'Echèc livraison', location: 'Bab Ezzouar' });
  });
  it('label: the URL of the parcel is fetched and returned as PDF bytes; stop-desks; rates = first row of `fees`; cancel', async () => {
    const r = replay(f, 'track_one', 'label_file', 'centers', 'fees', 'cancel_ok');
    const yal = new YalidineAdapter(r.transport);
    expect((await yal.getLabel(f.credentials, 'yal-8CX2QK')).pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await yal.listStopdesks(f.credentials, 16)).toEqual([{ id: '16201', name: 'Agence Bab Ezzouar', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité 5 Juillet' }]);
    expect(await yal.getRates(f.credentials, 16, 31)).toEqual({ home: 600, stopdesk: 400 });
    expect(await yal.cancel(f.credentials, 'yal-8CX2QK')).toMatchObject({ ok: true });
    r.done();
  });
  it('webhook: `X-Yalidine-Secret` equality on the raw body (wrong / missing ⇒ null = 401); events parsed', () => {
    const w = f.interactions.webhook!;
    const raw = Buffer.from(JSON.stringify(w.body));
    expect(parseYalidineWebhook(w.headers, raw, 'whsec-test-0123456789')).toEqual([
      { trackingNumber: 'yal-8CX2QK', rawStatus: 'Sorti en livraison', at: '2026-10-12T10:58:00.000Z' },
      { trackingNumber: 'yal-9', rawStatus: 'Livré', at: null },
    ]);
    expect(parseYalidineWebhook(w.headers, raw, 'another-secret')).toBeNull();
    expect(parseYalidineWebhook({}, raw, 'whsec-test-0123456789')).toBeNull();
    expect(parseYalidineWebhook(w.headers, raw, null)).toBeNull();
    expect(parseYalidineWebhook(w.headers, Buffer.from('not json'), 'whsec-test-0123456789')).toEqual([]);
  });
});

describe('driver selection (safety)', () => {
  it('fake by default; live refused in development / test without COURIER_ALLOW_LIVE', () => {
    expect(createCourierAdapters({ NODE_ENV: 'test', COURIER_DRIVER: 'fake', COURIER_ALLOW_LIVE: false }).driver).toBe('fake');
    expect(() => createCourierAdapters({ NODE_ENV: 'test', COURIER_DRIVER: 'live', COURIER_ALLOW_LIVE: false })).toThrow(/refused/);
    expect(() => createCourierAdapters({ NODE_ENV: 'development', COURIER_DRIVER: 'live', COURIER_ALLOW_LIVE: false })).toThrow(/refused/);
    const transport: CourierTransport = async () => {
      throw new Error('no network in unit tests');
    };
    expect(createCourierAdapters({ NODE_ENV: 'production', COURIER_DRIVER: 'live', COURIER_ALLOW_LIVE: false }, transport).adapters.zrexpress.driver).toBe('live');
  });
});
