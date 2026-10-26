// 05-integrations §2.1 — the `CourierAdapter` port (DLV-10). One adapter per provider; each has a `live` driver (HTTP,
// refused in development / test unless COURIER_ALLOW_LIVE=true) and a `fake` driver (default, deterministic, scriptable).
// Every provider error leaves the adapter as a `CourierError` (05 §2.1 last paragraph).
// ZR Express runs two platforms under the one provider: Procolis (token + key) and the new api.zrexpress.app (API key +
// tenant id); the account's `baseUrl` tells them apart (`ZR_APP_BASE_URL` = new platform) — see `capabilitiesOf`.
import { ZR_APP_BASE_URL, type CourierCapabilities, type FailureReasonCode, type ShipmentStatusName, type ZrPlatform } from '@djaber/shared';

export type CourierProvider = 'zrexpress' | 'ecotrack' | 'yalidine' | 'manual';
export type CourierCredentials = {
  zrexpress: { token: string; key: string } | { apiKey: string; tenantId: string };
  ecotrack: { baseUrl: string; token: string };
  yalidine: { apiId: string; apiToken: string };
  manual: Record<string, never>;
};
export type AnyCredentials = Partial<CourierCredentials[keyof CourierCredentials]> & Record<string, string | undefined>;

export type CreateShipmentInput = {
  shipmentId: string;
  /** external reference = order number */
  orderNumber: string;
  recipient: { name: string; phone: string; phone2?: string | null };
  wilayaId: number;
  wilayaName: string;
  communeName: string;
  /** `CourierCommuneMap.externalCode` */
  communeCode?: string | null;
  address: string;
  isStopdesk: boolean;
  stopdeskId?: string | null;
  codAmount: number;
  weightGrams?: number | null;
  productSummary: string;
  note?: string | null;
  declaredValue?: number | null;
  sender: { name: string; phone: string; wilayaId: number; wilayaName: string; address: string };
  /** manual provider: tracking typed by the merchant */
  trackingNumber?: string | null;
};
export type CreateShipmentResult = { trackingNumber: string; externalId?: string | null; labelUrl?: string | null; rawStatus?: string | null; raw: unknown };
export type TrackResult = { trackingNumber: string; rawStatus: string; mapped: ShipmentStatusName | null; location?: string | null; at?: string | null; failureReason?: FailureReasonCode | null; description?: string | null; raw: unknown };
export type Stopdesk = { id: string; name: string; wilayaId: number; communeName: string; address?: string | null };
export type TestResult = { ok: true; latencyMs: number; accountName?: string | null; wilayasServed?: number | null } | { ok: false; code: 'COURIER_CREDENTIALS_INVALID' | 'COURIER_UNAVAILABLE'; message: string; latencyMs?: number | null };
export type WebhookEvent = { trackingNumber: string; rawStatus: string; at?: string | null };
export type AdapterCapabilities = { cancel: boolean; label: boolean; batchTrack: boolean; webhook: boolean; rates: boolean; stopdesks: boolean; retry: boolean };

export type CourierErrorKind = 'validation' | 'auth' | 'unavailable' | 'not_found' | 'cancel_not_allowed' | 'label_unavailable';
export type CourierField = 'phone' | 'commune' | 'address' | 'wilaya' | 'weight' | 'cod' | 'stopdesk' | 'other';

/** The one error type adapters throw (05 §2.1): validation → 422 COURIER_VALIDATION, auth → 401, unavailable → 503 (queued retry)… */
export class CourierError extends Error {
  constructor(
    readonly kind: CourierErrorKind,
    message: string,
    readonly field: CourierField | null = null,
  ) {
    super(message);
    this.name = 'CourierError';
  }
  /** Error code of 11 §6 for this kind. */
  get code() {
    return COURIER_ERROR_CODE[this.kind];
  }
}
export const COURIER_ERROR_CODE: Record<CourierErrorKind, string> = {
  validation: 'COURIER_VALIDATION',
  auth: 'COURIER_CREDENTIALS_INVALID',
  unavailable: 'COURIER_UNAVAILABLE',
  not_found: 'TRACKING_NOT_FOUND',
  cancel_not_allowed: 'COURIER_CANCEL_NOT_ALLOWED',
  label_unavailable: 'LABEL_UNAVAILABLE',
};
export const isCourierError = (e: unknown): e is CourierError => e instanceof CourierError;

export interface CourierAdapter {
  readonly provider: CourierProvider;
  readonly driver: 'fake' | 'live';
  readonly capabilities: AdapterCapabilities;
  testCredentials(c: AnyCredentials): Promise<TestResult>;
  createShipment(c: AnyCredentials, input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancel?(c: AnyCredentials, trackingNumber: string): Promise<{ ok: boolean; rawStatus?: string | null }>;
  getLabel?(c: AnyCredentials, trackingNumber: string, labelUrl?: string | null): Promise<{ pdf: Buffer } | { url: string }>;
  track(c: AnyCredentials, trackingNumber: string): Promise<TrackResult>;
  trackMany?(c: AnyCredentials, trackingNumbers: string[]): Promise<TrackResult[]>;
  listStopdesks?(c: AnyCredentials, wilayaId: number): Promise<Stopdesk[]>;
  getRates?(c: AnyCredentials, fromWilayaId: number, toWilayaId: number): Promise<{ home: number | null; stopdesk: number | null } | null>;
  /** all destination wilayas in one call when the provider allows it (ZR `tarification`) */
  getAllRates?(c: AnyCredentials, fromWilayaId: number): Promise<{ wilayaId: number; home: number | null; stopdesk: number | null }[]>;
  retryDelivery?(c: AnyCredentials, trackingNumber: string): Promise<{ ok: boolean }>;
  /** null = invalid signature (401) */
  parseWebhook?(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, secret: string | null): WebhookEvent[] | null;
  /** courier portal page of a parcel, when the provider has one */
  portalUrl?(c: AnyCredentials, trackingNumber: string): string | null;
}

/** Max trackings per batch call (ZR / Yalidine ≤ 50, 05 §2.2 / §2.4). */
export const TRACK_BATCH_MAX = 50;

/** Capabilities in the wire shape of api-contract `CourierAccountDto.capabilities`. */
export const wireCapabilities = (a: AdapterCapabilities): CourierCapabilities => ({
  parcel: true,
  tracking: true,
  label: a.label,
  rates: a.rates,
  stopdesk: a.stopdesks,
  cancel: a.cancel,
  retry: a.retry,
  webhook: a.webhook,
  batchTrack: a.batchTrack,
});

/** Static capabilities per provider (05-integrations §2.2–§2.5) — shared by the live and the fake driver. */
export const PROVIDER_CAPABILITIES: Record<CourierProvider, AdapterCapabilities> = {
  zrexpress: { cancel: false, label: false, batchTrack: true, webhook: false, rates: true, stopdesks: false, retry: false },
  // 26/10: fees (`get/fees`) and stop-desks (communes with `has_stop_desk`) read; no batch tracking endpoint
  ecotrack: { cancel: true, label: true, batchTrack: false, webhook: false, rates: true, stopdesks: true, retry: true },
  yalidine: { cancel: true, label: true, batchTrack: true, webhook: true, rates: true, stopdesks: true, retry: false },
  manual: { cancel: false, label: false, batchTrack: false, webhook: false, rates: false, stopdesks: false, retry: false },
};
/** ZR Express new platform (05-integrations §2.2b): label PDF, cancel (delete before pickup), hubs = stop-desks, rates. */
export const ZR_APP_CAPABILITIES: AdapterCapabilities = { cancel: true, label: true, batchTrack: false, webhook: false, rates: true, stopdesks: true, retry: false };

/** ZR Express platform of an account (null for the other providers). */
export const zrPlatformOf = (provider: string, baseUrl: string | null | undefined): ZrPlatform | null => (provider !== 'zrexpress' ? null : baseUrl === ZR_APP_BASE_URL ? 'app' : 'procolis');
/** Capabilities of an account: per provider, and per platform for ZR Express. */
export const capabilitiesOf = (provider: string, baseUrl?: string | null): AdapterCapabilities =>
  zrPlatformOf(provider, baseUrl) === 'app' ? ZR_APP_CAPABILITIES : PROVIDER_CAPABILITIES[provider as CourierProvider];

export const PROVIDER_NAMES: Record<CourierProvider, string> = { zrexpress: 'ZR Express', ecotrack: 'EcoTrack', yalidine: 'Yalidine', manual: 'Livraison propre' };
