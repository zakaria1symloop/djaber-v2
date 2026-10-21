'use client';
// Session layer: boot (refresh cookie → GET /me → GET /workspace), current workspace, permissions, logout, switch.
// The access token lives in memory only (`apiSession`); nothing sensitive is written to web storage.
import { memberCan, type MemberRole, type MerchantPermission } from '@djaber/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, apiSession, refreshSession } from './api';
import type { AuthTokens, MeDto, Membership, WorkspaceDto } from './contracts';
import type { SessionStatus } from './guards';
import { useImpersonation } from './impersonation';
import { pickWorkspaceId } from './workspace-pick';

const WS_KEY = 'djaber.workspaceId';
const readStoredWorkspace = () => {
  try {
    return window.localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
};
const storeWorkspace = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(WS_KEY, id);
    else window.localStorage.removeItem(WS_KEY);
  } catch {}
};

export type SessionValue = {
  status: SessionStatus;
  me: MeDto | null;
  membership: Membership | null;
  workspaceId: string | null;
  workspace: WorkspaceDto | null;
  workspaceLoading: boolean;
  workspaceError: unknown;
  role: MemberRole | null;
  readOnly: boolean;
  /** read-only impersonation session of a platform admin on this tab (D21-bis) */
  impersonating: boolean;
  /** UI mirror of the API permission table; the API still enforces every key. */
  can: (key: MerchantPermission) => boolean;
  /** stores the tokens returned by login / register / 2FA verify / reset / invitation accept */
  signIn: (tokens: AuthTokens) => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  refetchMe: () => Promise<unknown>;
  refetchWorkspace: () => Promise<unknown>;
  bootError: unknown;
};

const Ctx = createContext<SessionValue | null>(null);

export const meKey = ['me'] as const;
export const workspaceKey = (ws: string | null) => [ws, 'workspace'] as const;
const bootKey = ['session', 'boot'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [expired, setExpired] = useState(false);
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => setStored(readStoredWorkspace()), []);

  const boot = useQuery({
    queryKey: bootKey,
    queryFn: async () => (apiSession.get().accessToken ? true : refreshSession()),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const meQ = useQuery({ queryKey: meKey, queryFn: () => api<MeDto>('/me'), enabled: boot.data === true, staleTime: 60_000 });
  const me = boot.data === true ? (meQ.data ?? null) : null;

  const imp = useImpersonation().session;
  const ownWorkspaceId = useMemo(() => pickWorkspaceId(me, stored), [me, stored]);
  // an impersonation session shows the target workspace; the API sends it with the impersonation headers
  const workspaceId = imp ? imp.workspaceId : ownWorkspaceId;
  // the header must be in place before any child query runs
  if (apiSession.get().workspaceId !== ownWorkspaceId) apiSession.set({ workspaceId: ownWorkspaceId });

  const wsQ = useQuery({
    queryKey: workspaceKey(workspaceId),
    queryFn: () => api<WorkspaceDto>('/workspace'),
    enabled: !!me && !!workspaceId,
    staleTime: 30_000,
  });

  useEffect(
    () =>
      apiSession.on((e) => {
        if (e === 'session-expired') setExpired(true);
      }),
    [],
  );

  // impersonation = a read-only Admin view of the workspace (every write key off; the API answers 403 to any non-GET)
  const membership = useMemo<Membership | null>(
    () => (imp ? { workspaceId: imp.workspaceId, name: imp.workspaceName, logoUrl: null, role: 'admin', readOnly: true } : (me?.memberships.find((m) => m.workspaceId === workspaceId) ?? null)),
    [me, workspaceId, imp],
  );
  const role = membership?.role ?? null;
  const readOnly = membership?.readOnly ?? false;
  const hiddenSections = membership?.hiddenSections;

  const status: SessionStatus = expired
    ? 'expired'
    : boot.isPending
      ? 'loading'
      : boot.data !== true
        ? 'anonymous'
        : meQ.isPending
          ? 'loading'
          : meQ.isError
            ? meQ.error instanceof ApiError && meQ.error.status === 401
              ? 'anonymous'
              : 'error'
            : 'authenticated';

  const clear = useCallback(() => {
    apiSession.set({ accessToken: null, workspaceId: null });
    setExpired(false);
    qc.clear();
    qc.setQueryData(bootKey, false);
  }, [qc]);

  const signIn = useCallback(
    (tokens: AuthTokens) => {
      apiSession.set({ accessToken: tokens.accessToken });
      setExpired(false);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
      qc.setQueryData(meKey, tokens.user);
      qc.setQueryData(bootKey, true);
    },
    [qc],
  );

  const logoutWith = useCallback(
    async (all: boolean) => {
      try {
        await api('/auth/logout', { method: 'POST', query: all ? { all: true } : undefined, noRefresh: true });
      } catch {
        // the local session is dropped even when the server cannot be reached
      }
      clear();
    },
    [clear],
  );
  const logout = useCallback(() => logoutWith(false), [logoutWith]);
  const logoutAll = useCallback(() => logoutWith(true), [logoutWith]);

  const switchWorkspace = useCallback(
    (id: string) => {
      storeWorkspace(id);
      apiSession.set({ workspaceId: id });
      setStored(id);
      // every workspace-scoped query is keyed by the workspace id: drop the others
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'me' && q.queryKey[0] !== id });
    },
    [qc],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      membership,
      workspaceId,
      workspace: wsQ.data ?? null,
      workspaceLoading: !!workspaceId && wsQ.isPending,
      workspaceError: wsQ.error,
      role,
      readOnly,
      impersonating: !!imp,
      can: (key) => memberCan({ role, readOnly, hiddenSections }, key),
      signIn,
      logout,
      logoutAll,
      switchWorkspace,
      refetchMe: () => meQ.refetch(),
      refetchWorkspace: () => wsQ.refetch(),
      bootError: meQ.error,
    }),
    [status, me, membership, workspaceId, wsQ, role, readOnly, hiddenSections, imp, signIn, logout, logoutAll, switchWorkspace, meQ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = (): SessionValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
};

/** `useCan('workspace.settings')` — hides or disables controls; the API still returns 403. */
export const useCan = (key: MerchantPermission) => useSession().can(key);
/** Workspace id for query keys (`[ws, 'quick-replies']`). */
export const useWorkspaceId = () => useSession().workspaceId ?? '';
