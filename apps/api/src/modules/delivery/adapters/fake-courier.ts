// The `fake` courier driver (default everywhere; tests always use it). Deterministic and scriptable, never leaves the
// process. Each provider keeps its real capabilities (ZR Procolis: no label / cancel; ZR new platform: label, cancel,
// stop-desks; EcoTrack: label + cancel + retry; Yalidine: label, stop-desks, webhook, cancel before pickup) and speaks its
// own raw statuses, so the mapping tables run.
//
// Built-in behaviour:
//  - credentials containing `invalid` ⇒ COURIER_CREDENTIALS_INVALID; containing `down` ⇒ COURIER_UNAVAILABLE;
//  - a commune named `Inconnue…` / `Invalid…` ⇒ validation error on the `commune` field (AT-DLV-02);
//  - tracking numbers `<ZR|ECO|YAL>-<n>` (n = per-process counter; the same `shipmentId` always gets the same number);
//  - a new parcel reads the provider's "created" raw status until scripted (`setStatus`, `sequence`);
//  - rates: home = 400 + (wilaya % 10) × 50, stop-desk = home − 150; stop-desks: two per wilaya (Yalidine).
// Scripting: `failNext(op, kind, n)` (e.g. 503 = `unavailable`), `setStatus`, `sequence`, `unavailable(provider, on)`.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { CourierError, PROVIDER_CAPABILITIES, type AdapterCapabilities, type AnyCredentials, type CourierAdapter, type CourierErrorKind, type CourierField, type CreateShipmentInput, type Stopdesk, type TestResult, type TrackResult } from './courier-adapter';
import { normalizeRaw, mapCourierStatus } from './status-maps';
import { parseYalidineWebhook } from './yalidine.adapter';

type Provider = 'zrexpress' | 'ecotrack' | 'yalidine';
export type FakeOp = 'test' | 'create' | 'track' | 'cancel' | 'label' | 'rates' | 'retry' | 'stopdesks';
type Parcel = { provider: Provider; account: string; tracking: string; raw: string; at: string; script: string[]; shipmentId: string };
export type FakeCall = { provider: Provider; op: FakeOp; account: string; at: number; count: number };

const CREATED_RAW: Record<Provider, string> = { zrexpress: 'En préparation', ecotrack: 'Créé', yalidine: 'En préparation' };
const PREFIX: Record<Provider, string> = { zrexpress: 'ZR', ecotrack: 'ECO', yalidine: 'YAL' };
const CANCEL_RAW: Record<Provider, string> = { zrexpress: 'Annulé', ecotrack: 'Supprimé', yalidine: 'Supprimé' };

export class FakeCourierBackend {
  readonly calls: FakeCall[] = [];
  /** What `createShipment` received (wilaya code sent to the courier, commune…), in call order. */
  readonly created: (CreateShipmentInput & { provider: Provider })[] = [];
  private readonly parcels = new Map<string, Parcel>();
  private readonly byShipment = new Map<string, string>();
  private failures: { provider?: Provider; op: FakeOp; kind: CourierErrorKind; field: CourierField | null; message: string; times: number }[] = [];
  private readonly down = new Set<Provider>();
  private seq = 0;

  accountOf(c: AnyCredentials) {
    return String(c.token ?? c.apiKey ?? c.apiId ?? c.baseUrl ?? 'acct');
  }

  record(provider: Provider, op: FakeOp, c: AnyCredentials, count = 1) {
    this.calls.push({ provider, op, account: this.accountOf(c), at: Date.now(), count });
    if (this.down.has(provider)) throw new CourierError('unavailable', 'HTTP 503');
    const i = this.failures.findIndex((f) => f.op === op && (!f.provider || f.provider === provider));
    if (i >= 0) {
      const f = this.failures[i]!;
      if (--f.times <= 0) this.failures.splice(i, 1);
      throw new CourierError(f.kind, f.message, f.field);
    }
  }

  // --- scripting ----------------------------------------------------------------------------------------------------------
  /** The next `times` calls of `op` fail with `kind` (`unavailable` = 503, `validation` = a field error…). */
  failNext(op: FakeOp, kind: CourierErrorKind, o: { times?: number; provider?: Provider; field?: CourierField; message?: string } = {}) {
    this.failures.push({ op, kind, provider: o.provider, field: o.field ?? (kind === 'validation' ? 'other' : null), message: o.message ?? (kind === 'unavailable' ? 'HTTP 503' : kind), times: o.times ?? 1 });
  }
  /** Every call to the provider answers 503 while on. */
  unavailable(provider: Provider, on = true) {
    if (on) this.down.add(provider);
    else this.down.delete(provider);
  }
  /** Current raw status of a parcel (as the courier would report it). */
  setStatus(tracking: string, raw: string, at: Date = new Date()) {
    const p = this.parcels.get(tracking);
    if (!p) throw new Error(`fake courier: unknown tracking ${tracking}`);
    p.raw = raw;
    p.at = at.toISOString();
    p.script = [];
  }
  /** Raw statuses returned one by one by the next track calls (the last one sticks). */
  sequence(tracking: string, raws: string[]) {
    const p = this.parcels.get(tracking);
    if (!p) throw new Error(`fake courier: unknown tracking ${tracking}`);
    p.script = [...raws];
  }
  /** A parcel created outside the flow (load tests). */
  seed(provider: Provider, c: AnyCredentials, tracking: string, raw = CREATED_RAW[provider], at = new Date()) {
    this.parcels.set(tracking, { provider, account: this.accountOf(c), tracking, raw, at: at.toISOString(), script: [], shipmentId: tracking });
  }
  parcel(tracking: string) {
    return this.parcels.get(tracking) ?? null;
  }
  callsOf(op?: FakeOp, provider?: Provider) {
    return this.calls.filter((c) => (!op || c.op === op) && (!provider || c.provider === provider));
  }
  reset() {
    this.calls.length = 0;
    this.created.length = 0;
    this.failures = [];
    this.down.clear();
  }

  // --- behaviour ------------------------------------------------------------------------------------------------------------
  test(provider: Provider, c: AnyCredentials): TestResult {
    const all = Object.values(c).join(' ').toLowerCase();
    if (all.includes('invalid')) return { ok: false, code: 'COURIER_CREDENTIALS_INVALID', message: 'Accès refusé', latencyMs: 42 };
    if (all.includes('down')) return { ok: false, code: 'COURIER_UNAVAILABLE', message: 'HTTP 503', latencyMs: 10_000 };
    this.record(provider, 'test', c);
    return { ok: true, latencyMs: 42, accountName: `Compte ${provider}`, wilayasServed: 58 };
  }

  /** `needsDesk`: the provider routes stop-desk parcels by desk id (Yalidine, ZR Express new platform). */
  create(provider: Provider, c: AnyCredentials, input: CreateShipmentInput, needsDesk = provider === 'yalidine') {
    this.record(provider, 'create', c);
    this.created.push({ ...input, provider });
    const existing = this.byShipment.get(input.shipmentId);
    if (existing) return { trackingNumber: existing, externalId: existing, labelUrl: null, rawStatus: this.parcels.get(existing)!.raw, raw: { replay: true } };
    const commune = normalizeRaw(input.communeCode || input.communeName);
    if (!commune || commune.startsWith('inconnue') || commune.startsWith('invalid')) throw new CourierError('validation', `Commune « ${input.communeName} » inconnue`, 'commune');
    if (input.isStopdesk && needsDesk && !input.stopdeskId) throw new CourierError('validation', 'stopdesk_id requis', 'stopdesk');
    const tracking = `${PREFIX[provider]}-${String(++this.seq).padStart(6, '0')}`;
    this.parcels.set(tracking, { provider, account: this.accountOf(c), tracking, raw: CREATED_RAW[provider], at: new Date().toISOString(), script: [], shipmentId: input.shipmentId });
    this.byShipment.set(input.shipmentId, tracking);
    return { trackingNumber: tracking, externalId: tracking, labelUrl: null, rawStatus: CREATED_RAW[provider], raw: { tracking } };
  }

  track(provider: Provider, tracking: string): TrackResult | null {
    const p = this.parcels.get(tracking);
    if (!p || p.provider !== provider) return null;
    if (p.script.length) {
      p.raw = p.script.shift()!;
      p.at = new Date().toISOString();
    }
    const m = mapCourierStatus(provider, p.raw);
    return { trackingNumber: tracking, rawStatus: p.raw, mapped: m?.mapped ?? null, failureReason: m?.failureReason ?? null, at: p.at, location: null, description: m?.failureReason === 'other' ? p.raw : null, raw: { fake: true } };
  }

  cancel(provider: Provider, c: AnyCredentials, tracking: string) {
    this.record(provider, 'cancel', c);
    const p = this.parcels.get(tracking);
    if (!p) throw new CourierError('not_found', 'unknown tracking');
    const m = mapCourierStatus(provider, p.raw);
    if (m && m.mapped !== 'sent') throw new CourierError('cancel_not_allowed', 'Colis déjà ramassé');
    p.raw = CANCEL_RAW[provider];
    p.at = new Date().toISOString();
    return { ok: true, rawStatus: p.raw };
  }

  rates(wilayaId: number) {
    const home = 400 + (wilayaId % 10) * 50;
    return { home, stopdesk: home - 150 };
  }

  async label(tracking: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([297.64, 419.53]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText(`COURIER LABEL ${tracking}`, { x: 20, y: 380, size: 14, font });
    return Buffer.from(await doc.save());
  }
}

export class FakeCourierAdapter implements CourierAdapter {
  readonly driver = 'fake' as const;
  readonly capabilities: AdapterCapabilities;
  constructor(
    readonly provider: Provider,
    private readonly backend: FakeCourierBackend,
    /** another platform of the provider (ZR Express new platform) */
    capabilities: AdapterCapabilities = PROVIDER_CAPABILITIES[provider],
  ) {
    this.capabilities = capabilities;
    const cap = this.capabilities;
    // optional methods exist only where the provider offers them (callers test their presence, like for the live drivers)
    if (!cap.cancel) (this as Partial<CourierAdapter>).cancel = undefined;
    if (!cap.label) (this as Partial<CourierAdapter>).getLabel = undefined;
    if (!cap.retry) (this as Partial<CourierAdapter>).retryDelivery = undefined;
    if (!cap.stopdesks) (this as Partial<CourierAdapter>).listStopdesks = undefined;
    if (!cap.webhook) (this as Partial<CourierAdapter>).parseWebhook = undefined;
    if (!cap.rates) {
      (this as Partial<CourierAdapter>).getRates = undefined;
      (this as Partial<CourierAdapter>).getAllRates = undefined;
    } else if (provider !== 'zrexpress') (this as Partial<CourierAdapter>).getAllRates = undefined;
  }

  async testCredentials(c: AnyCredentials) {
    return this.backend.test(this.provider, c);
  }
  async createShipment(c: AnyCredentials, input: CreateShipmentInput) {
    return this.backend.create(this.provider, c, input, this.capabilities.stopdesks);
  }
  async track(c: AnyCredentials, trackingNumber: string) {
    this.backend.record(this.provider, 'track', c);
    const r = this.backend.track(this.provider, trackingNumber);
    if (!r) throw new CourierError('not_found', 'unknown tracking');
    return r;
  }
  async trackMany(c: AnyCredentials, trackingNumbers: string[]) {
    this.backend.record(this.provider, 'track', c, trackingNumbers.length);
    return trackingNumbers.map((t) => this.backend.track(this.provider, t)).filter((r): r is TrackResult => !!r);
  }
  async cancel(c: AnyCredentials, trackingNumber: string) {
    return this.backend.cancel(this.provider, c, trackingNumber);
  }
  async getLabel(c: AnyCredentials, trackingNumber: string) {
    this.backend.record(this.provider, 'label', c);
    return { pdf: await this.backend.label(trackingNumber) };
  }
  async retryDelivery(c: AnyCredentials, _trackingNumber: string) {
    this.backend.record(this.provider, 'retry', c);
    return { ok: true };
  }
  async listStopdesks(c: AnyCredentials, wilayaId: number): Promise<Stopdesk[]> {
    this.backend.record(this.provider, 'stopdesks', c);
    return [1, 2].map((n) => ({ id: `${wilayaId}${String(n).padStart(2, '0')}`, name: `Bureau ${wilayaId}-${n}`, wilayaId, communeName: '', address: null }));
  }
  async getRates(c: AnyCredentials, _from: number, to: number) {
    this.backend.record(this.provider, 'rates', c);
    return this.backend.rates(to);
  }
  async getAllRates(c: AnyCredentials, _from: number) {
    this.backend.record(this.provider, 'rates', c);
    return Array.from({ length: 58 }, (_, i) => ({ wilayaId: i + 1, ...this.backend.rates(i + 1) }));
  }
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, secret: string | null) {
    return parseYalidineWebhook(headers, rawBody, secret);
  }
  portalUrl() {
    return null;
  }
}
