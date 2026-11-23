// HTTP client for /api/v1 (api-contract §1): envelope { data, meta } / { error }, access token kept in memory,
// refresh through the httpOnly cookie, X-Workspace-Id, Accept-Language, Idempotency-Key on demand.
import { impersonation } from './impersonation';
import { uuid } from './uuid';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4010';

export type ApiErrorBody = {
  code: string;
  message: string;
  params: Record<string, string | number>;
  fields: Record<string, string>;
  details: unknown;
  ref: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get code() {
    return this.body.code;
  }
}

export type Meta = { page?: number; pageSize?: number; total?: number; nextCursor?: string | null; hasMore?: boolean; warnings?: { code: string; params?: Record<string, unknown> }[] };
export type Envelope<T> = { data: T; meta: Meta };

type Session = { accessToken: string | null; workspaceId: string | null; locale: string };
const session: Session = { accessToken: null, workspaceId: null, locale: 'fr' };
export type ApiEvent = 'session-expired' | 'offline' | 'online' | 'legal-required' | 'deletion-scheduled' | 'maintenance' | 'maintenance-read';
/** `until` of the last 503 MAINTENANCE_MODE (end of the window) */
let maintenanceUntil: string | null = null;
export const getMaintenanceUntil = () => maintenanceUntil;
/** Last API error seen by this tab (code, request ref, time, path) — read by the help contact form's auto-context. */
let lastApiError: { code: string; ref: string; at: string; path: string } | null = null;
export const getLastApiError = () => lastApiError;
const listeners = new Set<(event: ApiEvent) => void>();

export const apiSession = {
  set(patch: Partial<Session>) {
    Object.assign(session, patch);
    if (patch.accessToken) refreshAhead(patch.accessToken);
  },
  get: () => session,
  on(fn: (event: ApiEvent) => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};
const emit = (e: ApiEvent) => listeners.forEach((l) => l(e));

/** Auth headers: the admin's token, or the read-only impersonation token + session id + target workspace (D21-bis). */
const authHeaders = (asAdmin?: boolean): Record<string, string> => {
  const headers: Record<string, string> = { 'Accept-Language': session.locale };
  const imp = asAdmin ? null : impersonation.get();
  if (imp) {
    headers.Authorization = `Bearer ${imp.token}`;
    headers['X-Impersonation-Session'] = imp.sessionId;
    headers['X-Workspace-Id'] = imp.workspaceId;
    return headers;
  }
  if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  if (session.workspaceId) headers['X-Workspace-Id'] = session.workspaceId;
  return headers;
};

let lastWriteAt = 0;
/** Called for every non-GET request of this tab (uploads included). */
export const markOwnWrite = () => {
  lastWriteAt = Date.now();
};
/** Milliseconds since this tab last sent a write: a refreshed resource right after it is our own change, not a foreign one. */
export const msSinceOwnWrite = () => Date.now() - lastWriteAt;

let refreshing: Promise<boolean> | null = null;
/**
 * PV 28/10 « fermeture de session »: the tabs of one browser share the refresh cookie, so they take turns (Web Locks) —
 * a tab that waited presents the cookie its neighbour just received instead of the rotated one. The API also accepts a
 * token rotated seconds ago (REFRESH_REUSE_GRACE_S) for browsers without Web Locks and for lost responses.
 */
const oneTabAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request('djaber-auth-refresh', fn) as Promise<T>) : fn();
};
/** Exchanges the refresh cookie for a new access token. Shared by concurrent 401s. */
export const refreshSession = (): Promise<boolean> => {
  refreshing ??= oneTabAtATime(() =>
    fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': session.locale },
      body: '{}',
    }),
  )
    .then(async (r) => {
      lastRefreshStatus = r.status;
      // 204: this browser holds no session (journey J12 PUBLIC-12 — it was a 401 in a visitor's console)
      if (!r.ok || r.status === 204) return false;
      const json = (await r.json()) as Envelope<{ accessToken: string }>;
      if (!json?.data?.accessToken) return false;
      session.accessToken = json.data.accessToken;
      refreshAhead(json.data.accessToken);
      return true;
    })
    .catch(() => {
      lastRefreshStatus = 0;
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};
/**
 * client list L03 (Boutique de Lalla 22/11, « Session expirée » every 5–15 min): the access token (15 min) was only renewed after a
 * 401, and any failed renewal — a network blip, an API restart, a 429 — logged the merchant out. Now the token is renewed one
 * minute before it ends (and when the tab comes back to the front), and only a refusal of the refresh cookie ends the session.
 */
let aheadTimer: ReturnType<typeof setTimeout> | null = null;
const tokenExpiry = (token: string): number | null => {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
};
const refreshAhead = (token: string) => {
  if (typeof window === 'undefined') return;
  const exp = tokenExpiry(token);
  if (aheadTimer) clearTimeout(aheadTimer);
  aheadTimer = null;
  if (!exp) return;
  aheadTimer = setTimeout(() => {
    if (session.accessToken === token) void refreshSession();
  }, Math.max(5_000, exp - Date.now() - 60_000));
};
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !session.accessToken) return;
    const exp = tokenExpiry(session.accessToken);
    if (exp && exp - Date.now() < 90_000) void refreshSession();
  });
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** HTTP status of the last refresh (0 = network failure): only a refusal (401) means « no session in this browser ». */
let lastRefreshStatus = 0;
export const refreshRefused = () => lastRefreshStatus === 204 || lastRefreshStatus === 401 || lastRefreshStatus === 403;

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  /** true ⇒ a random Idempotency-Key is generated; a string is used as the key */
  idempotent?: boolean | string;
  signal?: AbortSignal;
  /** do not try to refresh on 401 (login, refresh itself) */
  noRefresh?: boolean;
  formData?: FormData;
  /** sent with the admin's own token even while an impersonation session is active (ending the session) */
  asAdmin?: boolean;
};

const toQuery = (q: RequestOptions['query']) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function apiRaw<T>(path: string, o: RequestOptions = {}): Promise<Envelope<T>> {
  const headers = authHeaders(o.asAdmin);
  const impersonating = !o.asAdmin && !!impersonation.get();
  if (o.idempotent) headers['Idempotency-Key'] = typeof o.idempotent === 'string' ? o.idempotent : uuid();
  let body: BodyInit | undefined;
  if (o.formData) body = o.formData;
  else if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  const write = (o.method ?? 'GET') !== 'GET';
  const before = lastWriteAt;
  if (write) markOwnWrite();
  const stamp = lastWriteAt;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}${toQuery(o.query)}`, {
      method: o.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: o.signal,
    });
    emit('online');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') emit('offline');
    throw e;
  }
  // an impersonation token is never refreshed: 401 = the 30 min window is over (ADMIN_IMPERSONATION_EXPIRED)
  if (res.status === 401 && impersonating) impersonation.markExpired();
  else if (res.status === 401 && !o.noRefresh) {
    if (await refreshSession()) return apiRaw<T>(path, { ...o, noRefresh: true });
    // client list L03: a refresh that failed without being refused (network, 5xx, 429) is tried again before anything ends
    for (const wait of [1_500, 4_000]) {
      if (refreshRefused() || !session.accessToken) break;
      await pause(wait);
      if (await refreshSession()) return apiRaw<T>(path, { ...o, noRefresh: true });
    }
    // only a session that existed can expire (anonymous 401s are handled by the caller), and only when the refresh is refused
    if (session.accessToken && refreshRefused()) {
      session.accessToken = null;
      emit('session-expired');
    }
  }
  // a refused or failed write changed nothing on the server: it does not count as "our own write", so a foreign change
  // arriving right after a 409 is still seen as foreign (unless another write of this tab started meanwhile)
  if (write) {
    if (res.ok) markOwnWrite();
    else if (lastWriteAt === stamp) lastWriteAt = before;
  }
  if (res.status === 204) return { data: null as T, meta: {} };
  const json = (await res.json().catch(() => null)) as (Envelope<T> & { error?: ApiErrorBody }) | null;
  if (!res.ok || !json || json.error) {
    const body: ApiErrorBody = {
      code: 'INTERNAL',
      message: res.statusText,
      details: null,
      ref: res.headers.get('x-request-id') ?? '',
      ...json?.error,
      params: { ...json?.error?.params },
      fields: { ...json?.error?.fields },
    };
    // 429: the countdown reads `params.retryAfter` (seconds); fall back to the Retry-After header
    const retryAfter = Number(res.headers.get('retry-after'));
    if (res.status === 429 && body.params.retryAfter === undefined && Number.isFinite(retryAfter) && retryAfter > 0) body.params.retryAfter = retryAfter;
    if (body.code === 'LEGAL_REACCEPT_REQUIRED') emit('legal-required');
    if (body.code === 'ADMIN_IMPERSONATION_FORBIDDEN_ACTION') impersonation.forbidden();
    if (body.code === 'WORKSPACE_DELETION_SCHEDULED') emit('deletion-scheduled');
    // 503 MAINTENANCE_MODE (11 §12.1 "banner + disabled actions"): a refused write ⇒ maintenance banner (read-only);
    // a refused read (scope `all`) ⇒ full-page "Maintenance en cours" retried every 60 s (02 §1 layout hooks)
    if (body.code === 'MAINTENANCE_MODE') {
      maintenanceUntil = typeof body.params.until === 'string' ? body.params.until : null;
      emit(write ? 'maintenance' : 'maintenance-read');
    }
    // last error of this tab: the "contexte joint" of a support ticket (HELP-03)
    lastApiError = { code: body.code, ref: body.ref, at: new Date().toISOString(), path };
    throw new ApiError(res.status, body);
  }
  return json;
}

/**
 * A file answered directly by the API (invoice PDF `GET /billing/invoices/:id/pdf`): authenticated fetch → Blob.
 * Errors keep the envelope semantics (`ApiError` with the code of 11).
 */
export async function apiBlob(path: string, retried = false): Promise<Blob> {
  const headers = authHeaders();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, { headers, credentials: 'include' });
    emit('online');
  } catch (e) {
    emit('offline');
    throw e;
  }
  if (res.status === 401 && impersonation.get()) impersonation.markExpired();
  else if (res.status === 401 && !retried && (await refreshSession())) return apiBlob(path, true);
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: Partial<ApiErrorBody> } | null;
    throw new ApiError(res.status, { code: 'INTERNAL', message: res.statusText, details: null, ref: res.headers.get('x-request-id') ?? '', ...json?.error, params: { ...json?.error?.params }, fields: { ...json?.error?.fields } });
  }
  return res.blob();
}

/** Returns `data` only. Use `apiRaw` when `meta` (pagination, warnings) is needed. */
export const api = async <T>(path: string, o: RequestOptions = {}): Promise<T> => (await apiRaw<T>(path, o)).data;
