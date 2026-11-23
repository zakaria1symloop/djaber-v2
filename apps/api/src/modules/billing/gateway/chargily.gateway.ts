// 05-integrations §4.2 — `ChargilyGateway` [V1 chargily.service.ts], Chargily Pay API v2.
//   createCheckout: POST {base}/checkouts { amount, currency:'dzd', success_url, failure_url, webhook_endpoint, description, locale, metadata }
//   verify:         GET  {base}/checkouts/{id}  (status pending|processing|paid|failed|canceled|expired; canceled ⇒ failed)
//   parseWebhook:   header `signature` = hex HMAC-SHA256(secret, rawBody), constant-time compare; body { id, type, data: checkout }
// The transport is the only network seam: the live one is `fetch` (10 s timeout, 03-events §7), the dev / test one is the
// simulated Chargily API (fake-chargily.ts). Never called from tests or checks with the live transport.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderError, type CheckoutCreated, type CheckoutInput, type CheckoutStatus, type CheckoutVerified, type PaymentGateway, type WebhookEvent } from './payment-gateway';

export type PayRequest = { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: unknown };
export type PayResponse = { status: number; json: unknown };
export type PayTransport = (req: PayRequest) => Promise<PayResponse>;

export const fetchPayTransport =
  (timeoutMs = 10_000): PayTransport =>
  async (req) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(req.url, { method: req.method, headers: { Accept: 'application/json', ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...req.headers }, body: req.body === undefined ? undefined : JSON.stringify(req.body), signal: ctrl.signal });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      throw new PaymentProviderError('unavailable', e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network error');
    } finally {
      clearTimeout(timer);
    }
  };

export const chargilySignature = (secret: string, rawBody: Buffer | string) => createHmac('sha256', secret).update(rawBody).digest('hex');

const STATUS: Record<string, CheckoutStatus> = { paid: 'paid', pending: 'pending', processing: 'pending', failed: 'failed', canceled: 'failed', cancelled: 'failed', expired: 'expired' };
const method = (v: unknown): 'cib' | 'edahabia' | null => (v === 'cib' || v === 'edahabia' ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export class ChargilyGateway implements PaymentGateway {
  readonly provider = 'chargily' as const;
  constructor(
    readonly driver: 'fake' | 'chargily',
    private readonly transport: PayTransport,
    private readonly o: { apiBase: string; secret: string; webhookUrl: string },
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.o.secret}` };
  }

  private check(res: PayResponse, what: string) {
    if (res.status === 429 || res.status >= 500) throw new PaymentProviderError('unavailable', `${what}: HTTP ${res.status}`);
    if (res.status >= 400) throw new PaymentProviderError('rejected', `${what}: HTTP ${res.status}`);
    return (res.json ?? {}) as Record<string, unknown>;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutCreated> {
    const res = await this.transport({
      method: 'POST',
      url: `${this.o.apiBase}/checkouts`,
      headers: this.headers(),
      body: {
        amount: input.amount,
        currency: 'dzd',
        success_url: input.returnUrl,
        failure_url: input.failUrl,
        webhook_endpoint: this.o.webhookUrl,
        description: input.description.slice(0, 250),
        locale: input.locale,
        metadata: { ...input.metadata, ref: input.orderRef },
      },
    });
    const j = this.check(res, 'createCheckout');
    const id = str(j.id);
    const url = str(j.checkout_url);
    if (!id || !url) throw new PaymentProviderError('rejected', 'createCheckout: malformed answer');
    return { checkoutId: id, url, expiresAt: new Date(Date.now() + input.expiresInMin * 60_000) };
  }

  async verify(checkoutId: string): Promise<CheckoutVerified> {
    const res = await this.transport({ method: 'GET', url: `${this.o.apiBase}/checkouts/${encodeURIComponent(checkoutId)}`, headers: this.headers() });
    const j = this.check(res, 'verify');
    const status = STATUS[str(j.status)] ?? 'pending';
    return { status, amount: Number(j.amount ?? 0), providerRef: str(j.id) || checkoutId, method: method(j.payment_method), raw: j, ...(status === 'failed' ? { failureReason: str((j as { failure_reason?: unknown }).failure_reason) || str(j.status) } : {}) };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null {
    const sig = headers.signature ?? headers.Signature;
    const given = Array.isArray(sig) ? sig[0] : sig;
    if (!given || !rawBody?.length) return null;
    const expected = chargilySignature(this.o.secret, rawBody);
    const a = Buffer.from(given.trim(), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    const type = str(body.type);
    const status: CheckoutStatus = type === 'checkout.paid' ? 'paid' : type === 'checkout.expired' ? 'expired' : type === 'checkout.failed' || type === 'checkout.canceled' ? 'failed' : (STATUS[str(data.status)] ?? 'pending');
    const metadata = Object.fromEntries(Object.entries((data.metadata ?? {}) as Record<string, unknown>).map(([k, v]) => [k, str(v)]));
    const eventId = str(body.id);
    const checkoutId = str(data.id);
    if (!eventId || !checkoutId) return null;
    // Houssem live 23/11 UX-078: a payment the merchant cancelled on Chargily's page came back as « declined by the bank »
    const cancelled = type === 'checkout.canceled' || /^cancell?ed$/.test(str(data.status));
    const failureReason = str((data as { failure_reason?: unknown }).failure_reason) || (cancelled ? 'canceled' : '');
    return { eventId, checkoutId, status, amount: Number(data.amount ?? 0), method: method(data.payment_method), metadata, raw: body, ...(status === 'failed' && failureReason ? { failureReason } : {}) };
  }
}
