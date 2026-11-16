'use client';
// Read-only impersonation (D21-bis, api-contract §1.2): `POST /admin/impersonation/sessions` returns `{ sessionId, token,
// expiresAt }`; while the session is active every request carries `Authorization: Bearer <token>` +
// `X-Impersonation-Session: <sessionId>` and the target workspace id. The token lives in memory only (like the access
// token): a reload ends the view on this tab (the server session expires by itself after 30 min).
import { useSyncExternalStore } from 'react';

export type Impersonation = { sessionId: string; token: string; expiresAt: string; workspaceId: string; workspaceName: string };
export type ImpersonationEvent = 'changed' | 'expired' | 'forbidden';

let current: Impersonation | null = null;
let expired = false;
const listeners = new Set<(e: ImpersonationEvent) => void>();
const emit = (e: ImpersonationEvent) => listeners.forEach((l) => l(e));

/**
 * Full-test 15/11 ADMIN-15 (12 §26 Workspaces « expired session state … back to admin »): a reload drops the in-memory
 * token, so the tab would silently show the admin's own shop on the same URL. A marker WITHOUT the token (session id +
 * workspace) is kept in this tab's sessionStorage while a session runs; after a reload it says « session terminée » and
 * « Retour à l'admin » ends the server session with the admin's own token.
 */
export type EndedImpersonation = Pick<Impersonation, 'sessionId' | 'workspaceId' | 'workspaceName'>;
const MARK = 'djaber.impersonation.tab';
const store = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
const writeMark = (v: EndedImpersonation | null) => {
  try {
    if (v) store()?.setItem(MARK, JSON.stringify(v));
    else store()?.removeItem(MARK);
  } catch {
    // storage blocked: the reload then simply ends the view (previous behaviour)
  }
};
const readMark = (): EndedImpersonation | null => {
  try {
    const raw = store()?.getItem(MARK);
    const v = raw ? (JSON.parse(raw) as Partial<EndedImpersonation>) : null;
    return v && typeof v.sessionId === 'string' && typeof v.workspaceId === 'string' ? { sessionId: v.sessionId, workspaceId: v.workspaceId, workspaceName: String(v.workspaceName ?? '') } : null;
  } catch {
    return null;
  }
};
/** the session this tab had before a reload (read once when the module loads) */
let ended: EndedImpersonation | null = readMark();

export const impersonation = {
  get: () => current,
  /** the session a reload of this tab ended (ADMIN-15), until the admin goes back to the admin */
  ended: () => ended,
  /** true once the server answered `401 ADMIN_IMPERSONATION_EXPIRED` (or the clock passed `expiresAt`) */
  isExpired: () => expired,
  start(s: Impersonation) {
    current = s;
    expired = false;
    ended = null;
    writeMark({ sessionId: s.sessionId, workspaceId: s.workspaceId, workspaceName: s.workspaceName });
    emit('changed');
  },
  /** drops the session locally (the caller ends it on the server with the admin's own token) */
  clear() {
    current = null;
    expired = false;
    ended = null;
    writeMark(null);
    emit('changed');
  },
  markExpired() {
    if (!current || expired) return;
    expired = true;
    emit('expired');
    emit('changed');
  },
  forbidden: () => emit('forbidden'),
  on(fn: (e: ImpersonationEvent) => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

const subscribe = (cb: () => void) => impersonation.on((e) => e === 'changed' && cb());
type Snapshot = { session: Impersonation | null; expired: boolean; ended: EndedImpersonation | null };
let snap: Snapshot = { session: null, expired: false, ended: null };
const read = (): Snapshot => {
  if (snap.session !== current || snap.expired !== expired || snap.ended !== ended) snap = { session: current, expired, ended };
  return snap;
};
const SERVER: Snapshot = { session: null, expired: false, ended: null };

/** Current impersonation session of this tab (re-renders on start / stop / expiry). */
export const useImpersonation = (): Snapshot => useSyncExternalStore(subscribe, read, () => SERVER);

/** Whole minutes left before `expiresAt` (never negative). */
export const minutesLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
