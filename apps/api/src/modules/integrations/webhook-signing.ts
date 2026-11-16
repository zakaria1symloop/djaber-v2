// 03-events §6 — outbound webhook signature and URL rules (pure functions, unit-tested).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_SIGNATURE_TOLERANCE_S } from '@djaber/shared';

/** `X-Djaber-Signature: t=<unixSeconds>,v1=<hex hmac_sha256(secret, `${t}.${rawBody}`)>` */
export const signWebhook = (secret: string, rawBody: string, t: number = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;

/** Receiver-side check (documented for merchants, used by the dev receiver and the tests). */
export const verifyWebhookSignature = (secret: string, rawBody: string, header: string | undefined | null, now = Math.floor(Date.now() / 1000)): boolean => {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now - t) > WEBHOOK_SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./];
/** Loopback / private / link-local hosts (LAN test receivers in development; refused in production). */
export const isLocalHost = (hostname: string) => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || PRIVATE_V4.some((re) => re.test(h));
};

/** 422 WEBHOOK_URL_INVALID rules: production = `https://` + public host; development / test also accept `http://` and local hosts. */
export const webhookUrlAllowed = (raw: string, production: boolean): boolean => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (production) return u.protocol === 'https:' && !isLocalHost(u.hostname);
  return u.protocol === 'https:' || u.protocol === 'http:';
};

/** An `https://` URL whose host is loopback / private / link-local (refused in production as WEBHOOK_URL_PRIVATE). */
export const isPrivateHttps = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && isLocalHost(u.hostname);
  } catch {
    return false;
  }
};

export const newWebhookSecret = (bytes: Buffer) => `whsec_${bytes.toString('base64url')}`;
export const secretHint = (secret: string) => `whsec_…${secret.slice(-4)}`;
