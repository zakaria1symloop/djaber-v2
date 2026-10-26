// 05-integrations §1.4 — Graph API error mapping (`error.code` / `error.error_subcode`).
export type MetaErrorKind =
  | 'token' // 190, OAuthException + 102 ⇒ channel needs_reconnect
  | 'window' // 10 / 2018278 ⇒ outside the 24 h window · 100 / 2018276 ⇒ HUMAN_AGENT tag refused (app not approved)
  | 'permission' // 10 / 2018065, 2018108 · 200 ⇒ channel needs_reconnect
  | 'rate_limit' // 4, 17, 32, 613 ⇒ retry with backoff
  | 'user_unavailable' // 551 / 1545041 ⇒ failed, no retry
  | 'invalid_attachment' // 100 / 2534014, 2534015 ⇒ failed, no retry
  | 'unavailable' // 1, 2, 368 ⇒ retry (network class)
  | 'network' // timeout / connection ⇒ retry
  | 'unknown'; // anything else ⇒ retry 3×, then failed

export type MetaErrorBody = { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };

export class MetaError extends Error {
  readonly kind: MetaErrorKind;
  constructor(
    kind: MetaErrorKind,
    message: string,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'MetaError';
    this.kind = kind;
  }
  /** Worth another attempt (the `meta-send` backoff applies). */
  get retryable() {
    return this.kind === 'rate_limit' || this.kind === 'unavailable' || this.kind === 'network' || this.kind === 'unknown';
  }
  /** The channel can no longer talk to Meta until the merchant reconnects it. */
  get needsReconnect() {
    return this.kind === 'token' || this.kind === 'permission';
  }
}

const RATE_LIMIT = new Set([4, 17, 32, 613]);
const UNAVAILABLE = new Set([1, 2, 368]);

export const classifyMetaError = (e: MetaErrorBody | undefined, httpStatus: number | null = null): MetaError => {
  const code = typeof e?.code === 'number' ? e.code : null;
  const sub = typeof e?.error_subcode === 'number' ? e.error_subcode : null;
  const message = e?.message ?? `Meta error${httpStatus ? ` (HTTP ${httpStatus})` : ''}`;
  let kind: MetaErrorKind = 'unknown';
  if (code === 190 || (e?.type === 'OAuthException' && code === 102)) kind = 'token';
  else if ((code === 10 && sub === 2018278) || (code === 100 && sub === 2018276)) kind = 'window';
  else if ((code === 10 && (sub === 2018065 || sub === 2018108)) || code === 200) kind = 'permission';
  else if (code !== null && RATE_LIMIT.has(code)) kind = 'rate_limit';
  else if (code === 551) kind = 'user_unavailable';
  else if (code === 100 && (sub === 2534014 || sub === 2534015)) kind = 'invalid_attachment';
  else if (code !== null && UNAVAILABLE.has(code)) kind = 'unavailable';
  else if (code === null && httpStatus !== null && httpStatus >= 500) kind = 'unavailable';
  return new MetaError(kind, message, code, sub, httpStatus);
};

export const networkError = (cause: unknown) => new MetaError('network', cause instanceof Error ? cause.message : 'network error');

/** Error-catalogue code stored on `Message.error` / reported by jobs for a Meta failure (11 §3). */
export const metaErrorCode = (e: MetaError): string => {
  switch (e.kind) {
    case 'token':
    case 'permission':
      return 'PAGE_TOKEN_EXPIRED';
    case 'window':
      return 'REPLY_OUTSIDE_WINDOW';
    case 'rate_limit':
    case 'unavailable':
    case 'network':
      return 'META_UNAVAILABLE';
    default:
      return 'PROVIDER_UNAVAILABLE';
  }
};
