// Contract tests of the three live courier drivers (00-build-order M6 exit criteria): recorded request / response pairs
// (test/fixtures/couriers/*.json, written from 05-integrations §2) replayed through a fake transport — no network.
// Each test checks the request the adapter builds (method, URL, auth headers, body) and how the answer is mapped.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { capabilitiesOf, ZR_APP_CAPABILITIES, type CreateShipmentInput } from './courier-adapter';
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
    // tester report 25/10 UX-009 (checked against ZR's public contract): no catalogue stock, a description, international phone, a customer id
    expect(r.seen[2]!.body).toEqual({
      customer: { customerId: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Amine Benali', phone: { number1: '+213555123456' } },
      deliveryAddress: { cityTerritoryId: 'w-16', districtTerritoryId: 'c-16-1', street: 'Cité 200 logements, Bt 4' },
      orderedProducts: [{ productName: 'Robe kabyle ×1', quantity: 1, unitPrice: 4500, stockType: 'none' }],
      deliveryType: 'home',
      description: 'Robe kabyle ×1',
      amount: 4900,
      weight: { weight: 1 },
      externalId: 'CMD-1042',
    });
    await expect(zr.createShipment(f.credentials, input())).rejects.toMatchObject({ kind: 'validation', field: 'phone', message: 'Le numéro de téléphone est invalide.' });
    await expect(zr.createShipment(f.credentials, input({ communeName: 'Inconnue', communeCode: null }))).rejects.toMatchObject({ kind: 'validation', field: 'commune' });
    // a commune of a 2026 wilaya (68 Bou Saâda) shipped under its parent code 28: found in the new wilaya
    await zr.createShipment(f.credentials, input({ wilayaId: 28, wilayaName: "M'Sila", communeName: 'Bou Saada', communeCode: null }));
    expect(r.seen[4]!.body).toMatchObject({ deliveryAddress: { cityTerritoryId: 'w-68', districtTerritoryId: 'c-68-1' } });
    r.done();
  });
  it('createShipment answered with the parcel id only: the tracking number is read back (no retry, no second parcel); > 150 000 DA refused without a call', async () => {
    const r = replay(f, 'territories', 'territories_p2', 'create_id_only', 'parcel_by_id');
    const zr = new ZrExpressAppAdapter(r.transport);
    expect(await zr.createShipment(f.credentials, input({ orderNumber: 'CMD-1043' }))).toMatchObject({ trackingNumber: 'ZR-APP-7790', externalId: 'p-7790' });
    await expect(zr.createShipment(f.credentials, input({ codAmount: 150_001 }))).rejects.toMatchObject({ kind: 'validation', field: 'cod' });
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

describe('EcoTrack (05-integrations §2.3; checked 26/10 against the reference clients)', () => {
  const creds = { baseUrl: 'https://boutique.ecotrack.dz/api/v1/', token: 'eco-token-987654' };
  /** Scripted answers by `METHOD path` (query ignored); every request recorded with its query parameters. */
  const script = (answers: Record<string, { status?: number; json?: unknown; pdf?: boolean }[]>) => {
    const seen: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown }[] = [];
    const transport: CourierTransport = async (req) => {
      const u = new URL(req.url);
      seen.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body: req.body });
      expect(u.origin).toBe('https://boutique.ecotrack.dz');
      const a = answers[`${req.method} ${u.pathname}`]?.shift();
      if (!a) throw new Error(`unexpected ${req.method} ${req.url}`);
      const bytes = a.pdf ? pdfBytes : Buffer.from(JSON.stringify(a.json ?? null));
      return { status: a.status ?? 200, json: a.pdf ? null : (a.json ?? null), bytes, contentType: a.pdf ? 'application/pdf' : 'application/json' };
    };
    return { transport, seen };
  };
  const communes = { '0': { nom: 'Bab Ezzouar', wilaya_id: 16, code_postal: '16027', has_stop_desk: 1 }, '1': { nom: 'Hydra', wilaya_id: 16, code_postal: '16012', has_stop_desk: 0 } };

  it('testCredentials: Bearer token on the instance (a pasted /api/v1 is stripped); list or object answer; 403 / http ⇒ COURIER_CREDENTIALS_INVALID', async () => {
    const r = script({ 'GET /api/v1/get/wilayas': [{ json: [{ wilaya_id: 1 }, { wilaya_id: 16 }] }, { json: { data: { '0': { wilaya_id: 16 } } } }, { status: 403, json: { message: 'Forbidden' } }] });
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.testCredentials(creds)).toMatchObject({ ok: true, wilayasServed: 2 });
    expect(r.seen[0]!.headers.Authorization).toBe('Bearer eco-token-987654');
    expect(await eco.testCredentials(creds)).toMatchObject({ ok: true });
    expect(await eco.testCredentials(creds)).toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
    await expect(eco.testCredentials({ baseUrl: 'http://insecure.ecotrack.dz', token: 'x' })).resolves.toMatchObject({ ok: false, code: 'COURIER_CREDENTIALS_INVALID' });
  });

  it('createShipment: query parameters (no JSON body), type=1, weight, local phones, the tenant spelling of the commune; then valid/order hands it to the courier', async () => {
    const r = script({ 'GET /api/v1/get/communes': [{ json: communes }], 'POST /api/v1/create/order': [{ json: { success: true, data: { tracking: 'ECO-5531209' } } }], 'POST /api/v1/valid/order': [{ json: { success: true } }] });
    const eco = new EcotrackAdapter(r.transport);
    const res = await eco.createShipment(creds, input({ recipient: { name: 'Amine Benali', phone: '+213 555 12 34 56', phone2: '0661223344' }, communeName: 'BAB-EZZOUAR', communeCode: null, weightGrams: 1200 }));
    expect(res).toMatchObject({ trackingNumber: 'ECO-5531209', rawStatus: 'Validée' });
    const create = r.seen.find((x) => x.path === '/api/v1/create/order')!;
    expect(create.body).toBeUndefined();
    expect(create.query).toEqual({ reference: 'CMD-1042', nom_client: 'Amine Benali', telephone: '0555123456', telephone_2: '0661223344', adresse: 'Cité 200 logements, Bt 4', code_wilaya: '16', commune: 'Bab Ezzouar', montant: '4900', produit: 'Robe kabyle ×1', type: '1', stop_desk: '0', weight: '2' });
    expect(r.seen.find((x) => x.path === '/api/v1/valid/order')!.query).toEqual({ tracking: 'ECO-5531209' });
  });

  it('stop-desk: stop_desk=1 + the desk code_postal; refusals: 422 errors{field}, 200 success:false with a business code; a failed validation keeps the parcel', async () => {
    const r = script({
      'GET /api/v1/get/communes': [{ json: communes }],
      'POST /api/v1/create/order': [{ json: { success: true, tracking: 'ECO-DESK' } }, { status: 422, json: { message: 'The given data was invalid.', errors: { telephone: ['Le numéro de téléphone est invalide.'] } } }, { json: { success: false, error: 10002 } }],
      'POST /api/v1/valid/order': [{ json: { success: false, error: 10001 } }],
    });
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.createShipment(creds, input({ isStopdesk: true, stopdeskId: '16027' }))).toMatchObject({ trackingNumber: 'ECO-DESK', rawStatus: 'Prête à expédier', raw: { validated: false } });
    expect(r.seen.find((x) => x.path === '/api/v1/create/order')!.query).toMatchObject({ stop_desk: '1', code_postal: '16027' });
    await expect(eco.createShipment(creds, input())).rejects.toMatchObject({ kind: 'validation', field: 'phone', message: 'Le numéro de téléphone est invalide.' });
    await expect(eco.createShipment(creds, input())).rejects.toMatchObject({ kind: 'validation', field: 'wilaya', message: 'Pas de livraison vers cette wilaya' });
  });

  it('track: the activity of exactly this tracking, API keys mapped (livred, attempt_delivery), notification_on_order skipped; unknown ⇒ TRACKING_NOT_FOUND', async () => {
    const r = script({
      'GET /api/v1/get/tracking/info': [
        { json: { tracking: 'ECO-1', activity: [{ status: 'order_information_received_by_carrier', date: '2026-10-11', time: '10:00:00' }, { status: 'attempt_delivery', date: '2026-10-12', time: '09:00:00', reason: 'Client injoignable' }, { status: 'notification_on_order', date: '2026-10-12', time: '10:00:00' }] } },
        { json: { data: [{ tracking: 'ECO-9', activity: [{ status: 'livred' }] }, { tracking: 'ECO-2', activity: [{ status: 'livred', date: '2026-10-13 15:00:00' }] }] } },
        { json: { data: [{ tracking: 'ECO-9', activity: [{ status: 'livred' }] }] } },
        { status: 422, json: { errors: { tracking: ['Le tracking est invalide'] } } },
      ],
    });
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.track(creds, 'ECO-1')).toMatchObject({ mapped: 'failed', failureReason: 'unreachable', rawStatus: 'attempt_delivery', description: 'Client injoignable', at: '2026-10-12T08:00:00.000Z' });
    expect(await eco.track(creds, 'ECO-2')).toMatchObject({ mapped: 'delivered', trackingNumber: 'ECO-2' });
    await expect(eco.track(creds, 'ECO-3')).rejects.toMatchObject({ kind: 'not_found', code: 'TRACKING_NOT_FOUND' });
    await expect(eco.track(creds, 'ECO-0')).rejects.toMatchObject({ kind: 'not_found' });
    expect(eco.capabilities).toMatchObject({ batchTrack: false, rates: true, stopdesks: true });
  });

  it('fees from get/fees (0 = not offered), stop-desks = communes with a desk, label PDF, cancel = DELETE refused once validated (10001), retry asked', async () => {
    const r = script({
      'GET /api/v1/get/fees': [{ json: { livraison: [{ wilaya_id: 16, tarif: '400', tarif_stopdesk: '250' }, { wilaya_id: 31, tarif: 650, tarif_stopdesk: 0 }] } }],
      'GET /api/v1/get/communes': [{ json: communes }],
      'GET /api/v1/get/order/label': [{ pdf: true }],
      'DELETE /api/v1/delete/order': [{ json: { success: false, error: 10001 } }, { json: { success: true } }],
      'POST /api/v1/ask/retry': [{ json: { success: true } }],
    });
    const eco = new EcotrackAdapter(r.transport);
    expect(await eco.getRates(creds, 16, 31)).toEqual({ home: 650, stopdesk: null });
    expect(await eco.listStopdesks(creds, 16)).toEqual([{ id: '16027', name: 'Stop-desk Bab Ezzouar', wilayaId: 16, communeName: 'Bab Ezzouar', address: null }]);
    expect((await eco.getLabel(creds, 'ECO-1')).pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(eco.cancel(creds, 'ECO-1')).rejects.toMatchObject({ kind: 'cancel_not_allowed', code: 'COURIER_CANCEL_NOT_ALLOWED' });
    expect(await eco.cancel(creds, 'ECO-1')).toEqual({ ok: true, rawStatus: 'Supprimé' });
    expect(r.seen.filter((x) => x.method === 'DELETE').map((x) => x.query)).toEqual([{ tracking: 'ECO-1' }, { tracking: 'ECO-1' }]);
    expect(await eco.retryDelivery(creds, 'ECO-1')).toEqual({ ok: true });
  });
});

describe('Yalidine (05-integrations §2.4)', () => {
  const f = fixture('yalidine');
  it('testCredentials with X-API-ID / X-API-TOKEN; createShipment (stop-desk) ⇒ tracking + label URL; refusal message mapped to commune', async () => {
    const r = replay(f, 'test_ok', 'centers_create', 'create_ok', 'create_bad');
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
  it('label: the URL of the parcel is fetched and returned as PDF bytes; stop-desks; rates = lowest per-commune price of `fees`; cancel, refused when deleted: false', async () => {
    const r = replay(f, 'track_one', 'label_file', 'centers', 'fees', 'cancel_ok', 'cancel_refused');
    const yal = new YalidineAdapter(r.transport);
    expect((await yal.getLabel(f.credentials, 'yal-8CX2QK')).pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await yal.listStopdesks(f.credentials, 16)).toEqual([{ id: '16201', name: 'Agence Bab Ezzouar', wilayaId: 16, communeName: 'Bab Ezzouar', address: 'Cité 5 Juillet' }]);
    expect(await yal.getRates(f.credentials, 16, 31)).toEqual({ home: 600, stopdesk: 400 });
    expect(await yal.cancel(f.credentials, 'yal-8CX2QK')).toMatchObject({ ok: true });
    await expect(yal.cancel(f.credentials, 'yal-8CX2QK')).rejects.toMatchObject({ kind: 'cancel_not_allowed' });
    await expect(yal.createShipment(f.credentials, input({ codAmount: 150_001 }))).rejects.toMatchObject({ kind: 'validation', field: 'cod' });
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
