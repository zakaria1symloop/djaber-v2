// 05-integrations §2.3 — EcoTrack live driver: one API for every courier running on the EcoTrack platform (DHD,
// Conexlog, MSM Go, World Express … — `https://<courier>.ecotrack.dz`, `platform.dhd-dz.com`, `app.conexlog-dz.com`),
// `/api/v1`, `Authorization: Bearer <token>`. Checked on 26/10 against two maintained reference clients (dz-delivery,
// CourierDZ — built from EcoTrack's Postman notes; tester request « intégrer EcoTrack »):
// - single-order calls take QUERY parameters, never a JSON body;
// - `create/order`: `type` is required (1 = livraison), `weight` (not `poids`), `code_wilaya` 1–58, the commune in the
//   tenant's own spelling (`get/communes?wilaya_id=`), a stop-desk is `stop_desk=1` + the desk's `code_postal`;
//   `montant` is what the recipient pays (delivery included);
// - business failures come back as HTTP 200 `{ success:false, error: 1000x, message }`, validation as 422
//   `{ errors: { field: [..] } }`; the tracking may be nested (`data.tracking`, `order.tracking`);
// - an order stays « prête à expédier » until `valid/order?tracking=` hands it to the courier: done right after the
//   creation (a failed validation never fails the send — the parcel exists; `raw.validated=false` and the merchant can
//   validate it on the courier's dashboard);
// - tracking `get/tracking/info?tracking=`: the entry of THIS tracking only, `activity[].status` keys (`livred`,
//   `picked`, `return_received` …, `notification_on_order` is a remark, not a status) or French labels;
// - fees `get/fees`: `livraison[]` rows `{ wilaya_id, tarif, tarif_stopdesk }` (0 = not offered);
// - cancel `DELETE delete/order?tracking=`, refused once validated (10001); label `get/order/label?tracking=` (PDF).
import { normalizePhoneDz } from '@djaber/shared';
import { courierDate, checkStatus, num, str, type CourierTransport, type HttpResponse } from './http';
import { CourierError, PROVIDER_CAPABILITIES, type AnyCredentials, type CourierAdapter, type CourierField, type CreateShipmentInput, type Stopdesk, type TestResult, type TrackResult } from './courier-adapter';
import { mapCourierStatus, normalizeRaw } from './status-maps';

const FIELD: Record<string, CourierField> = { telephone: 'phone', telephone_2: 'phone', commune: 'commune', code_postal: 'stopdesk', adresse: 'address', code_wilaya: 'wilaya', montant: 'cod', weight: 'weight', nom_client: 'other' };
/** `{ success:false, error }` business codes (dz-delivery BUSINESS_ERRORS). */
const BUSINESS: Record<number, { field: CourierField | null; message: string }> = {
  10001: { field: null, message: 'Commande déjà validée : elle ne peut plus être modifiée' },
  10002: { field: 'wilaya', message: 'Pas de livraison vers cette wilaya' },
  10003: { field: null, message: 'Retour impossible pour cette commande' },
};
const ORDER_TYPE_DELIVERY = 1;
const NOTIFICATION = 'notification_on_order';
const TRACKING_KEYS = ['tracking', 'tracking_number', 'tracking_id', 'numero_tracking', 'n_tracking', 'track'];
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
/** Values of a list or of an index-keyed object (`{ "0": {...}, "1": {...} }`). */
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Row) : []).filter((x): x is Row => !!x && typeof x === 'object');
const qs = (params: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(params).flatMap(([k, v]): [string, string][] => (v === null || v === undefined || v === '' ? [] : [[k, String(v)]]))).toString();
/** Local form `0XXXXXXXXX` (EcoTrack wants 9–10 digits). */
const localPhone = (raw: string | null | undefined) => (raw ? normalizePhoneDz(raw) : '');

/** The instance URL as typed by the merchant (`https://x.ecotrack.dz`, with or without `/api/v1`). */
export const ecotrackOrigin = (baseUrl: string | undefined | null): string => {
  let url: URL;
  try {
    url = new URL(str(baseUrl).trim());
  } catch {
    throw new CourierError('auth', 'invalid instance URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new CourierError('auth', 'invalid instance URL');
  return url.origin + url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
};

const trackingOf = (body: unknown): string => {
  const from = (node: unknown) => {
    const n = obj(node);
    for (const k of TRACKING_KEYS) if (str(n[k]).trim()) return str(n[k]).trim();
    return '';
  };
  const b = obj(body);
  return from(b) || from(b.data) || from(obj(b.data).order) || from(b.order);
};

export class EcotrackAdapter implements CourierAdapter {
  readonly provider = 'ecotrack' as const;
  readonly driver = 'live' as const;
  readonly capabilities = PROVIDER_CAPABILITIES.ecotrack;
  private readonly communes = new Map<string, { at: number; value: Promise<{ name: string; code: string; desk: boolean }[]> }>();
  constructor(private readonly http: CourierTransport) {}

  private api(c: AnyCredentials, path: string, params?: Record<string, string | number | null | undefined>) {
    const q = params ? qs(params) : '';
    return `${ecotrackOrigin(c.baseUrl)}/api/v1/${path}${q ? `?${q}` : ''}`;
  }
  private headers(c: AnyCredentials) {
    return { Authorization: `Bearer ${str(c.token)}`, Accept: 'application/json' };
  }
  private call(c: AnyCredentials, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string | number | null | undefined>) {
    return this.http({ method, url: this.api(c, path, params), headers: this.headers(c) });
  }

  /** 422 `errors{field}` or 200 `{ success:false, error }` ⇒ the courier's refusal (message + dialog field), else null. */
  private refusal(res: HttpResponse): { message: string; field: CourierField | null } | null {
    const j = obj(res.json);
    const errors = obj(j.errors);
    const [key, msgs] = Object.entries(errors)[0] ?? ['', null];
    if (res.status === 422 || key) {
      const message = (Array.isArray(msgs) ? str(msgs[0]) : str(msgs)) || str(j.message) || `HTTP ${res.status}`;
      return { message, field: FIELD[key] ?? 'other' };
    }
    if (j.success === false || str(j.status) === 'error') {
      const code = Number(j.error);
      const known = Number.isFinite(code) ? BUSINESS[code] : undefined;
      return { message: str(j.message) || known?.message || (typeof j.error === 'string' ? j.error : '') || 'refused', field: known?.field ?? 'other' };
    }
    return null;
  }

  async testCredentials(c: AnyCredentials): Promise<TestResult> {
    const t0 = Date.now();
    try {
      const res = checkStatus(await this.call(c, 'GET', 'get/wilayas'));
      const j = res.json;
      const list = Array.isArray(j) ? j : rows(obj(j).data ?? j);
      if (res.status === 200 && (Array.isArray(j) || (j && typeof j === 'object'))) return { ok: true, latencyMs: Date.now() - t0, wilayasServed: list.length || null };
      return { ok: false, code: 'COURIER_CREDENTIALS_INVALID', message: `HTTP ${res.status}`, latencyMs: Date.now() - t0 };
    } catch (e) {
      if (e instanceof CourierError) return { ok: false, code: e.kind === 'auth' ? 'COURIER_CREDENTIALS_INVALID' : 'COURIER_UNAVAILABLE', message: e.message, latencyMs: Date.now() - t0 };
      throw e;
    }
  }

  /** The tenant's communes of a wilaya (spelling, `code_postal`, stop-desk flag), kept 24 h per instance + wilaya. */
  private communesOf(c: AnyCredentials, wilayaId: number) {
    const key = `${ecotrackOrigin(c.baseUrl)}:${wilayaId}`;
    const hit = this.communes.get(key);
    if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.value;
    const value = (async () => {
      const res = checkStatus(await this.call(c, 'GET', 'get/communes', { wilaya_id: wilayaId }));
      if (res.status >= 400) throw new CourierError('unavailable', `communes: HTTP ${res.status}`);
      return rows(obj(res.json).data ?? res.json)
        .filter((r) => str(r.nom).trim() && (r.wilaya_id === undefined || Number(r.wilaya_id) === wilayaId))
        .map((r) => ({ name: str(r.nom).trim(), code: str(r.code_postal).trim(), desk: Number(r.has_stop_desk) === 1 }));
    })();
    this.communes.set(key, { at: Date.now(), value });
    value.catch(() => this.communes.delete(key));
    return value;
  }

  async createShipment(c: AnyCredentials, input: CreateShipmentInput) {
    // the commune in the tenant's spelling (the list is a hint: when it cannot be read, our own name is sent)
    const wanted = new Set([input.communeCode ?? '', input.communeName].map((n) => normalizeRaw(n).replace(/ /g, '')).filter(Boolean));
    const list = await this.communesOf(c, input.wilayaId).catch(() => [] as { name: string; code: string; desk: boolean }[]);
    const commune = list.find((x) => wanted.has(normalizeRaw(x.name).replace(/ /g, '')) || (!!x.code && x.code === input.stopdeskId));
    if (input.isStopdesk && !input.stopdeskId && !commune?.desk) throw new CourierError('validation', 'Pas de stop-desk pour cette commune', 'stopdesk');
    const params = {
      reference: input.orderNumber,
      nom_client: input.recipient.name,
      telephone: localPhone(input.recipient.phone),
      telephone_2: localPhone(input.recipient.phone2),
      adresse: input.address,
      code_wilaya: input.wilayaId,
      commune: commune?.name ?? input.communeName,
      montant: Math.round(input.codAmount),
      remarque: input.note ?? '',
      produit: input.productSummary.slice(0, 255),
      type: ORDER_TYPE_DELIVERY,
      stop_desk: input.isStopdesk ? 1 : 0,
      ...(input.isStopdesk ? { code_postal: input.stopdeskId || commune?.code || '' } : {}),
      ...(input.weightGrams ? { weight: Math.max(1, Math.ceil(input.weightGrams / 1000)) } : {}),
    };
    const res = checkStatus(await this.call(c, 'POST', 'create/order', params));
    const refused = this.refusal(res);
    if (refused) throw new CourierError('validation', refused.message, refused.field);
    const tracking = trackingOf(res.json);
    if (!tracking) throw new CourierError(res.status >= 400 ? 'validation' : 'unavailable', str(obj(res.json).message) || `HTTP ${res.status}`, res.status >= 400 ? 'other' : null);
    // hand the order to the courier (« Expédier »); the parcel exists whatever happens here — never a retry of the create
    let validated = false;
    try {
      const v = checkStatus(await this.call(c, 'POST', 'valid/order', { tracking }));
      validated = v.status < 400 && !this.refusal(v);
    } catch {
      validated = false;
    }
    return { trackingNumber: tracking, externalId: tracking, labelUrl: null, rawStatus: validated ? 'Validée' : 'Prête à expédier', raw: { ...obj(res.json), validated } };
  }

  /** The info of exactly `tracking` (list-style and keyed answers tolerated; never « the first row »). */
  private infoOf(body: unknown, tracking: string): Row | null {
    const b = obj(body);
    const root = b.data !== undefined && b.activity === undefined ? b.data : body;
    if (Array.isArray(root)) return rows(root).find((r) => str(r.tracking).trim() === tracking) ?? null;
    const r = obj(root);
    if (r.activity === undefined && r[tracking] && typeof r[tracking] === 'object') return r[tracking] as Row;
    if (r.activity === undefined) return null;
    if (str(r.tracking).trim() && str(r.tracking).trim() !== tracking) return null;
    return r;
  }

  private toTrack(tracking: string, info: Row | null): TrackResult | null {
    if (!info) return null;
    const events = rows(info.activity)
      .filter((a) => !str(a.tracking).trim() || str(a.tracking).trim() === tracking)
      .map((a, i) => {
        const date = str(a.date).trim();
        const time = str(a.time).trim();
        return { a, i, at: courierDate(date && !/[T ]\d/.test(date) ? `${date} ${time || '00:00:00'}` : date || a.created_at) };
      })
      .filter((e) => str(e.a.status ?? e.a.event).trim() && str(e.a.status).trim() !== NOTIFICATION)
      .sort((x, y) => (x.at ?? '').localeCompare(y.at ?? '') || x.i - y.i);
    const last = events[events.length - 1];
    const rawStatus = str(last?.a.status ?? last?.a.event ?? info.status).trim();
    if (!rawStatus) return null;
    const m = mapCourierStatus('ecotrack', rawStatus);
    return { trackingNumber: tracking, rawStatus, mapped: m?.mapped ?? null, failureReason: m?.failureReason ?? null, at: last?.at ?? null, location: str(last?.a.wilaya ?? last?.a.location) || null, description: str(last?.a.reason ?? last?.a.remarque ?? last?.a.causes) || null, raw: info };
  }

  async track(c: AnyCredentials, trackingNumber: string): Promise<TrackResult> {
    const res = checkStatus(await this.call(c, 'GET', 'get/tracking/info', { tracking: trackingNumber }), { notFound: true });
    if (res.status === 404 || (res.status === 422 && Object.keys(obj(obj(res.json).errors)).every((k) => k === 'tracking'))) throw new CourierError('not_found', 'unknown tracking');
    const r = this.toTrack(trackingNumber, this.infoOf(res.json, trackingNumber));
    if (!r) throw new CourierError('not_found', 'no activity');
    return r;
  }

  async getAllRates(c: AnyCredentials) {
    const res = checkStatus(await this.call(c, 'GET', 'get/fees'));
    if (res.status >= 400) throw new CourierError('unavailable', `fees: HTTP ${res.status}`);
    const positive = (v: unknown) => {
      const n = num(v);
      return n !== null && n > 0 ? n : null;
    };
    return rows(obj(res.json).livraison).flatMap((r) => {
      const wilayaId = Number(r.wilaya_id);
      return Number.isInteger(wilayaId) && wilayaId >= 1 ? [{ wilayaId, home: positive(r.tarif), stopdesk: positive(r.tarif_stopdesk) }] : [];
    });
  }

  async getRates(c: AnyCredentials, _fromWilayaId: number, toWilayaId: number) {
    const row = (await this.getAllRates(c)).find((r) => r.wilayaId === toWilayaId);
    return row ? { home: row.home, stopdesk: row.stopdesk } : null;
  }

  /** Stop-desks = the tenant's communes flagged `has_stop_desk`; the desk id sent back is the commune's `code_postal`. */
  async listStopdesks(c: AnyCredentials, wilayaId: number): Promise<Stopdesk[]> {
    return (await this.communesOf(c, wilayaId)).filter((x) => x.desk && x.code).map((x) => ({ id: x.code, name: `Stop-desk ${x.name}`, wilayaId, communeName: x.name, address: null }));
  }

  async getLabel(c: AnyCredentials, trackingNumber: string) {
    const res = checkStatus(await this.http({ method: 'GET', url: this.api(c, 'get/order/label', { tracking: trackingNumber }), headers: { ...this.headers(c), Accept: 'application/pdf' } }), { notFound: true });
    if (res.status !== 200 || res.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new CourierError('label_unavailable', `HTTP ${res.status}`);
    return { pdf: res.bytes };
  }

  async cancel(c: AnyCredentials, trackingNumber: string) {
    const res = checkStatus(await this.call(c, 'DELETE', 'delete/order', { tracking: trackingNumber }), { notFound: true });
    const j = obj(res.json);
    const refused = this.refusal(res);
    if (res.status >= 400 || refused || j.delete === 'fail') throw new CourierError('cancel_not_allowed', refused?.message || str(j.message) || `HTTP ${res.status}`);
    return { ok: true, rawStatus: 'Supprimé' };
  }

  async retryDelivery(c: AnyCredentials, trackingNumber: string) {
    const res = checkStatus(await this.call(c, 'POST', 'ask/retry', { tracking: trackingNumber }));
    return { ok: res.status < 400 && !this.refusal(res) };
  }

  portalUrl(c: AnyCredentials, trackingNumber: string) {
    try {
      return `${ecotrackOrigin(c.baseUrl)}/suivi/${encodeURIComponent(trackingNumber)}`;
    } catch {
      return null;
    }
  }
}
