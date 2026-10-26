// 05-integrations §2.2b — ZR Express new platform (api.zrexpress.app, public API v1) live driver. Auth: `X-Api-Key` +
// `X-Tenant` headers (credentials `apiKey` + `tenantId`); the host is fixed here, never taken from the account.
// - addresses: ZR wants territory ids, not names. The territories are searched once and kept 24 h per tenant; the wilaya
//   is the territory with the courier code (58 historical codes, `courierWilayaId`), the commune its child matched by
//   folded name (a commune carved into a wilaya 59–69 is looked up there too);
// - stop-desks are the pickup-point hubs (`hubId`, delivery type `pickup-point`), also kept 24 h per tenant;
// - status = `state.name` (+ `situation.name`, the reason inside the state), mapped with the ZR table;
// - label = individual A6 PDF (`labels/individual/pdf` gives a file URL, fetched; the API key is only sent to ZR's host);
// - cancel = DELETE of the parcel, refused by ZR once the parcel left the merchant (⇒ COURIER_CANCEL_NOT_ALLOWED);
// - rates = `delivery-pricing/rates` from the sender wilaya (home / pickup-point, TTC when given).
import { randomUUID } from 'node:crypto';
import { courierWilayaId, normalizePhoneDz, WILAYA_COUNT, ZR_APP_BASE_URL } from '@djaber/shared';
import { checkStatus, courierDate, fieldOfMessage, num, str, type CourierTransport, type HttpResponse } from './http';
import { CourierError, ZR_APP_CAPABILITIES, type AnyCredentials, type CourierAdapter, type CourierField, type CreateShipmentInput, type Stopdesk, type TestResult, type TrackResult } from './courier-adapter';
import { mapCourierStatus, normalizeRaw } from './status-maps';

const API = `${ZR_APP_BASE_URL}/api/v1`;
/** ZR refuses a cash-on-delivery amount above 150 000 DA. */
export const ZR_MAX_AMOUNT = 150_000;
/** ZR wants the international form: 0550 12 34 56 ⇒ +213550123456. */
export const zrPhone = (raw: string) => {
  const p = normalizePhoneDz(raw);
  return /^0\d{8,9}$/.test(p) ? `+213${p.slice(1)}` : p;
};
const CACHE_MS = 24 * 3_600_000;
const PAGE = 1000;

type Territory = { id: string; code: number; name: string; nameAr: string; parentId: string | null; level: string };
type Geo = { byId: Map<string, Territory>; wilayaByCode: Map<number, Territory>; districtsOf: Map<string, Territory[]> };
type Hub = { id: string; name: string; street: string; cityId: string; districtId: string; district: string };
type Row = Record<string, unknown>;

/** Accent-, case-, space- and punctuation-insensitive form of a place name ("Aïn Témouchent" = "ain temouchent" = "AinTemouchent"). */
export const foldPlace = (s: string) => normalizeRaw(s).replace(/ /g, '');
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});

/** Territory list → wilayas (parents of the communes) and communes. A level name is only a fallback when the list is flat. */
export const buildGeo = (rows: Territory[]): Geo => {
  const byId = new Map(rows.map((t) => [t.id, t]));
  const parents = new Set(rows.map((t) => t.parentId).filter((x): x is string => !!x));
  const districts = rows.filter((t) => t.parentId && !parents.has(t.id) && byId.has(t.parentId));
  const wilayaIds = new Set(districts.map((d) => d.parentId!));
  const wilayaByCode = new Map<number, Territory>();
  for (const t of rows) {
    const isWilaya = wilayaIds.size ? wilayaIds.has(t.id) : /wilaya|city|province|state/i.test(t.level);
    if (isWilaya && t.code >= 1 && t.code <= WILAYA_COUNT) wilayaByCode.set(t.code, t);
  }
  const districtsOf = new Map<string, Territory[]>();
  for (const d of districts) districtsOf.set(d.parentId!, [...(districtsOf.get(d.parentId!) ?? []), d]);
  return { byId, wilayaByCode, districtsOf };
};

/** ProblemDetails / validation answer → message + dialog field (`errors: { "DeliveryAddress.DistrictTerritoryId": ["…"] }`). */
const refusal = (res: HttpResponse): { message: string; field: CourierField } => {
  const j = obj(res.json);
  const errors = obj(j.errors);
  const [key, msgs] = Object.entries(errors)[0] ?? ['', null];
  const message = (Array.isArray(msgs) ? str(msgs[0]) : str(msgs)) || str(j.detail) || str(j.title) || str(j.message) || `HTTP ${res.status}`;
  const k = key.toLowerCase();
  const field: CourierField = k.includes('phone')
    ? 'phone'
    : k.includes('district')
      ? 'commune'
      : k.includes('city')
        ? 'wilaya'
        : k.includes('hub')
          ? 'stopdesk'
          : k.includes('street')
            ? 'address'
            : k.includes('amount')
              ? 'cod'
              : k.includes('weight')
                ? 'weight'
                : fieldOfMessage(`${key} ${message}`);
  return { message, field };
};

export class ZrExpressAppAdapter implements CourierAdapter {
  readonly provider = 'zrexpress' as const;
  readonly driver = 'live' as const;
  readonly capabilities = ZR_APP_CAPABILITIES;
  private readonly geo = new Map<string, { at: number; value: Promise<Geo> }>();
  private readonly hubs = new Map<string, { at: number; value: Promise<Hub[]> }>();
  constructor(private readonly http: CourierTransport) {}

  private headers(c: AnyCredentials) {
    return { 'X-Api-Key': str(c.apiKey), 'X-Tenant': str(c.tenantId), Accept: 'application/json' };
  }
  private call(c: AnyCredentials, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return this.http({ method, url: `${API}${path}`, headers: this.headers(c), ...(body !== undefined ? { body } : {}) });
  }

  /** One value per tenant, kept 24 h; a failed load is forgotten so that the next call retries. */
  private cached<T>(store: Map<string, { at: number; value: Promise<T> }>, c: AnyCredentials, load: () => Promise<T>): Promise<T> {
    const key = str(c.tenantId);
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = load();
    store.set(key, { at: Date.now(), value });
    value.catch(() => store.delete(key));
    return value;
  }

  private territories(c: AnyCredentials): Promise<Geo> {
    return this.cached(this.geo, c, async () => {
      const rows: Territory[] = [];
      for (let page = 1; page <= 10; page++) {
        const res = checkStatus(await this.call(c, 'POST', '/territories/search', { pageNumber: page, pageSize: PAGE, includeUnavailable: true }));
        if (res.status >= 400) throw new CourierError('unavailable', `territories: HTTP ${res.status}`);
        const j = obj(res.json);
        const items = (Array.isArray(j.items) ? j.items : []) as Row[];
        for (const t of items) rows.push({ id: str(t.id), code: num(t.code) ?? 0, name: str(t.name), nameAr: str(t.nameArabic), parentId: str(t.parentId) || null, level: str(t.level) });
        if (!j.hasNext || !items.length) break;
      }
      return buildGeo(rows);
    });
  }

  private hubList(c: AnyCredentials): Promise<Hub[]> {
    return this.cached(this.hubs, c, async () => {
      const out: Hub[] = [];
      for (let page = 1; page <= 10; page++) {
        const res = checkStatus(await this.call(c, 'POST', '/hubs/search', { pageNumber: page, pageSize: PAGE }));
        if (res.status >= 400) throw new CourierError('unavailable', `hubs: HTTP ${res.status}`);
        const j = obj(res.json);
        const items = (Array.isArray(j.items) ? j.items : []) as Row[];
        for (const h of items) {
          if (h.isPickupPoint !== true || h.isVisible === false) continue;
          const a = obj(h.address);
          out.push({ id: str(h.id), name: str(h.name), street: str(a.street), cityId: str(a.cityTerritoryId), districtId: str(a.districtTerritoryId), district: str(a.district) });
        }
        if (!j.hasNext || !items.length) break;
      }
      return out;
    });
  }

  /** Wilaya + commune territories of an address; the commune may sit in a wilaya carved out of the courier code (59–69). */
  private resolve(geo: Geo, wilayaId: number, names: string[]): { city: Territory; district: Territory } | null {
    const wanted = new Set(names.map(foldPlace).filter(Boolean));
    const match = (list: Territory[] | undefined) => list?.find((d) => wanted.has(foldPlace(d.name)));
    const city = geo.wilayaByCode.get(wilayaId);
    const local = city ? match(geo.districtsOf.get(city.id)) : undefined;
    if (city && local) return { city, district: local };
    for (const w of geo.wilayaByCode.values()) {
      if (w.code === wilayaId || courierWilayaId(w.code) !== wilayaId) continue;
      const d = match(geo.districtsOf.get(w.id));
      if (d) return { city: w, district: d };
    }
    return null;
  }

  async testCredentials(c: AnyCredentials): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const res = checkStatus(await this.call(c, 'POST', '/territories/search', { pageNumber: 1, pageSize: 1 }));
      if (res.status === 200 && Array.isArray(obj(res.json).items)) return { ok: true, latencyMs: Date.now() - t0 };
      return { ok: false, code: 'COURIER_CREDENTIALS_INVALID', message: refusal(res).message, latencyMs: Date.now() - t0 };
    } catch (e) {
      if (e instanceof CourierError) return { ok: false, code: e.kind === 'auth' ? 'COURIER_CREDENTIALS_INVALID' : 'COURIER_UNAVAILABLE', message: e.message, latencyMs: Date.now() - t0 };
      throw e;
    }
  }

  async createShipment(c: AnyCredentials, input: CreateShipmentInput) {
    const geo = await this.territories(c);
    let place = this.resolve(geo, input.wilayaId, [input.communeCode ?? '', input.communeName]);
    let hubId: string | null = null;
    if (input.isStopdesk) {
      if (!input.stopdeskId) throw new CourierError('validation', 'hubId requis', 'stopdesk');
      hubId = input.stopdeskId;
      const hub = (await this.hubList(c)).find((h) => h.id === hubId);
      const city = hub ? geo.byId.get(hub.cityId) : undefined;
      const district = hub ? geo.byId.get(hub.districtId) : undefined;
      if (!place && city && district) place = { city, district };
    }
    if (!geo.wilayaByCode.has(input.wilayaId) && !place) throw new CourierError('validation', `Wilaya ${input.wilayaId} inconnue de ZR Express`, 'wilaya');
    if (!place) throw new CourierError('validation', `Commune « ${input.communeName} » introuvable chez ZR Express (wilaya ${input.wilayaId})`, 'commune');
    if (input.codAmount > ZR_MAX_AMOUNT) throw new CourierError('validation', `Montant supérieur à ${ZR_MAX_AMOUNT} DA (limite ZR Express)`, 'cod');
    // checked against ZR's public contract and a reference client (tester report 25/10 UX-009: no order reached ZR):
    // `stockType: none` (local / warehouse need a ZR product id + SKU), a description of ≥ 2 characters, phones in the
    // international form, a customer id
    const summary = input.productSummary.trim() || input.orderNumber;
    const body = {
      customer: { customerId: randomUUID(), name: input.recipient.name, phone: { number1: zrPhone(input.recipient.phone), ...(input.recipient.phone2 ? { number2: zrPhone(input.recipient.phone2) } : {}) } },
      deliveryAddress: { cityTerritoryId: place.city.id, districtTerritoryId: place.district.id, street: input.address },
      ...(hubId ? { hubId } : {}),
      orderedProducts: [{ productName: summary.slice(0, 250), quantity: 1, unitPrice: input.declaredValue ?? input.codAmount, stockType: 'none' }],
      deliveryType: input.isStopdesk ? 'pickup-point' : 'home',
      description: [summary, input.note?.trim()].filter(Boolean).join(' — ').slice(0, 250),
      amount: input.codAmount,
      weight: { weight: Math.max(1, Math.ceil((input.weightGrams ?? 500) / 1000)) },
      externalId: input.orderNumber,
    };
    const res = checkStatus(await this.call(c, 'POST', '/parcels', body));
    if (res.status >= 400) {
      const r = refusal(res);
      throw new CourierError('validation', r.message, r.field);
    }
    const j = obj(res.json);
    const id = str(j.id);
    // the creation may answer the parcel id only: the tracking number is read back from the parcel (never a retry, which
    // would create a second parcel)
    let trackingNumber = str(j.trackingNumber);
    if (!trackingNumber && id) trackingNumber = str((await this.parcel(c, id).catch(() => ({}) as Row)).trackingNumber);
    if (!trackingNumber && !id) throw new CourierError('unavailable', 'no tracking returned');
    return { trackingNumber: trackingNumber || id, externalId: id || trackingNumber, labelUrl: null, rawStatus: 'Commande reçue', raw: j };
  }

  private async parcel(c: AnyCredentials, trackingNumber: string): Promise<Row> {
    const res = checkStatus(await this.call(c, 'GET', `/parcels/${encodeURIComponent(trackingNumber)}`), { notFound: true });
    if (res.status >= 400) throw new CourierError('not_found', refusal(res).message);
    return obj(res.json);
  }

  /** `state.name` gives the status, `situation.name` the reason inside it (failure reason, description). */
  private toTrack(trackingNumber: string, p: Row): TrackResult | null {
    const state = str(obj(p.state).name);
    const situation = str(obj(p.situation).name) || str(obj(p.situation).slug);
    const rawStatus = situation && normalizeRaw(situation) !== normalizeRaw(state) ? `${state} · ${situation}` : state;
    if (!rawStatus) return null;
    const ms = mapCourierStatus('zrexpress', state);
    const mi = situation ? mapCourierStatus('zrexpress', situation) : null;
    const mapped = ms?.mapped ?? mi?.mapped ?? null;
    const failureReason = mapped === 'failed' ? (mi?.failureReason ?? ms?.failureReason ?? 'other') : null;
    return {
      trackingNumber: str(p.trackingNumber) || trackingNumber,
      rawStatus,
      mapped,
      failureReason,
      at: courierDate(p.lastSituationUpdateAt ?? p.lastStateUpdateAt ?? p.lastStateHistoryAt),
      location: null,
      description: situation || null,
      raw: { state: p.state, situation: p.situation, lastStateUpdateAt: p.lastStateUpdateAt, deliveredAt: p.deliveredAt, returnedAt: p.returnedAt },
    };
  }

  async track(c: AnyCredentials, trackingNumber: string): Promise<TrackResult> {
    const r = this.toTrack(trackingNumber, await this.parcel(c, trackingNumber));
    if (!r) throw new CourierError('not_found', 'no state');
    return r;
  }

  async cancel(c: AnyCredentials, trackingNumber: string) {
    const p = await this.parcel(c, trackingNumber);
    const now = this.toTrack(trackingNumber, p);
    if (now?.mapped && now.mapped !== 'sent') throw new CourierError('cancel_not_allowed', now.rawStatus);
    const res = checkStatus(await this.call(c, 'DELETE', `/parcels/${encodeURIComponent(str(p.id))}`), { notFound: true });
    if (res.status >= 400) throw new CourierError('cancel_not_allowed', refusal(res).message);
    return { ok: true, rawStatus: 'Annulé' };
  }

  async getLabel(c: AnyCredentials, trackingNumber: string) {
    const res = checkStatus(await this.call(c, 'POST', '/parcels/labels/individual/pdf', { trackingNumbers: [trackingNumber], format: 'A6', isPreview: false }));
    const files = (obj(res.json).parcelLabelFiles ?? []) as Row[];
    const url = str(files.find((f) => str(f.trackingNumber) === trackingNumber)?.fileUrl ?? files[0]?.fileUrl);
    if (res.status >= 400 || !/^https:\/\//i.test(url)) throw new CourierError('label_unavailable', `HTTP ${res.status}`);
    // the file usually sits on a storage host: the API key only goes to ZR's own host
    const own = new URL(url).origin === new URL(ZR_APP_BASE_URL).origin;
    const file = checkStatus(await this.http({ method: 'GET', url, headers: own ? { ...this.headers(c), Accept: 'application/pdf' } : { Accept: 'application/pdf' } }), { notFound: true });
    if (file.status !== 200 || file.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new CourierError('label_unavailable', `HTTP ${file.status}`);
    return { pdf: file.bytes };
  }

  async listStopdesks(c: AnyCredentials, wilayaId: number): Promise<Stopdesk[]> {
    const [geo, hubs] = await Promise.all([this.territories(c), this.hubList(c)]);
    return hubs.flatMap((h) => {
      const city = geo.byId.get(h.cityId);
      if (!city || courierWilayaId(city.code) !== wilayaId) return [];
      return [{ id: h.id, name: h.name, wilayaId, communeName: geo.byId.get(h.districtId)?.name || h.district, address: h.street || null }];
    });
  }

  async getAllRates(c: AnyCredentials, fromWilayaId: number) {
    const geo = await this.territories(c);
    const from = geo.wilayaByCode.get(fromWilayaId);
    let res = checkStatus(await this.call(c, 'GET', `/delivery-pricing/rates${from ? `?fromTerritoryId=${encodeURIComponent(from.id)}` : ''}`));
    // no price list assigned to that origin ⇒ the tenant's default one
    if (res.status === 404 && from) res = checkStatus(await this.call(c, 'GET', '/delivery-pricing/rates'));
    if (res.status >= 400) throw new CourierError('unavailable', `rates: HTTP ${res.status}`);
    const rows = (obj(res.json).rates ?? []) as Row[];
    const price = (list: Row[], type: string) => {
      const p = list.find((x) => normalizeRaw(str(x.deliveryType)) === type);
      return p ? num(p.discountedPriceTtc ?? p.priceTtc ?? p.discountedPrice ?? p.price) : null;
    };
    return rows.flatMap((r) => {
      // communes may be priced too: only the wilaya rows are kept (by territory id, else by level name)
      const t = geo.byId.get(str(r.toTerritoryId));
      const wilayaId = t ? (geo.wilayaByCode.get(t.code)?.id === t.id ? t.code : 0) : /commune|district/i.test(str(r.toTerritoryLevel)) ? 0 : (num(r.toTerritoryCode) ?? 0);
      if (wilayaId < 1 || wilayaId > WILAYA_COUNT) return [];
      const list = (Array.isArray(r.deliveryPrices) ? r.deliveryPrices : []) as Row[];
      return [{ wilayaId, home: price(list, 'home'), stopdesk: price(list, 'pickup point') }];
    });
  }

  async getRates(c: AnyCredentials, fromWilayaId: number, toWilayaId: number) {
    const row = (await this.getAllRates(c, fromWilayaId)).find((r) => r.wilayaId === toWilayaId);
    return row ? { home: row.home, stopdesk: row.stopdesk } : null;
  }
}
