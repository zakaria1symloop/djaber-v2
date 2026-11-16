// Agents calls (06 "Agents & AI", §8.7) + TanStack Query hooks and cache keys. The web never calls an AI provider:
// the playground, the scenarios, the generation and the analysis all run on the API (deterministic fake locally).
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, API_URL, ApiError, apiRaw, type Envelope, type Meta } from '@/lib/api';
import type { JobRef } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useSession, useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import type {
  Agent,
  AgentFaq,
  AgentInsight,
  AgentPeriodMetrics,
  AgentPreset,
  AgentReadiness,
  AgentsList,
  AgentVersion,
  AgentVersionDiff,
  AiRoute,
  AiRun,
  CreateAgentBody,
  InsightCounts,
  InsightStatus,
  PlanLimit,
  PlaygroundBody,
  PlaygroundTurn,
  ResolveInsightBody,
  ScenarioRun,
  SharedReply,
  SharedTest,
  TestLink,
  UpdateAgentBody,
  WsAgentUpdated,
  WsAgentVersion,
} from './contracts';
import { SCENARIO_KEYS } from './contracts';

export type GenerationOverride = { instructions?: string; faq?: { q: string; a: string }[]; policies?: Record<string, string> };
export type BulkResult ={ id: string; ok: boolean; error?: { code: string; message: string } };
export type BulkOutcome = { results: BulkResult[] };
export type InsightsPage = { rows: AgentInsight[]; total: number; counts: InsightCounts | null };

/** `GET /agents/:id/test-scenarios`: the last run of each of the 8 scenarios, in the order of the frame (never run ⇒ status null). */
const scenarioRuns = (raw: ScenarioRun[] | null): ScenarioRun[] => {
  const byKey = new Map((raw ?? []).map((r) => [r.scenarioKey, r]));
  return SCENARIO_KEYS.map((scenarioKey) => byKey.get(scenarioKey) ?? { scenarioKey, status: null, summary: null, at: null, agentVersion: null });
};

export const agentsApi = {
  list: async (q: ApiQuery = {}): Promise<AgentsList> => {
    const r = await apiRaw<Agent[]>('/agents', { query: q });
    return { rows: r.data ?? [], planLimit: (r.meta as Meta & { planLimit?: PlanLimit })?.planLimit ?? null };
  },
  get: (id: string) => api<Agent>(`/agents/${id}`),
  presets: () => api<AgentPreset[]>('/agents/presets'),
  create: (b: CreateAgentBody) => api<Agent>('/agents', { method: 'POST', body: b }),
  update: (id: string, b: UpdateAgentBody) => api<Agent>(`/agents/${id}`, { method: 'PATCH', body: b }),
  remove: (id: string) => api<null>(`/agents/${id}`, { method: 'DELETE' }),
  /**
   * `confirm` acknowledges AGENT_PAUSED_WITH_OPEN_THREADS (the dialog already showed the count); `sendOutOfHours` sends the
   * workspace `out_of_hours` system message once to every open thread (AGV-07, M11)
   */
  pause: (id: string, b: { confirm?: boolean; sendOutOfHours?: boolean } = {}) => api<Agent>(`/agents/${id}/pause`, { method: 'POST', body: b }),
  resume: (id: string) => api<Agent>(`/agents/${id}/resume`, { method: 'POST', body: {} }),
  duplicate: (id: string) => api<Agent>(`/agents/${id}/duplicate`, { method: 'POST', body: {} }),
  activate: (id: string, b: { at?: string } = {}) => api<Agent>(`/agents/${id}/activate`, { method: 'POST', body: b }),
  /** cancels a scheduled activation (`scheduledActivateAt` → null; the draft stays a draft) */
  unschedule: (id: string) => api<Agent>(`/agents/${id}/activate`, { method: 'DELETE' }),
  bulk: (action: 'pause' | 'resume' | 'delete', ids: string[]) => api<BulkOutcome>(`/agents/bulk/${action}`, { method: 'POST', body: { ids } }),
  exportConfig: (id: string) => api<Record<string, unknown>>(`/agents/${id}/export`),
  metrics: (id: string, q: ApiQuery) => api<AgentPeriodMetrics>(`/agents/${id}/metrics`, { query: q }),
  versions: (id: string) => api<AgentVersion[]>(`/agents/${id}/versions`),
  versionDiff: (id: string, v: number, against?: number) => api<AgentVersionDiff>(`/agents/${id}/versions/${v}/diff`, { query: { against } }),
  restoreVersion: (id: string, v: number) => api<Agent>(`/agents/${id}/versions/${v}/restore`, { method: 'POST', body: {} }),
  applyPresetUpdate: (id: string, presetVersion: number) => api<Agent>(`/agents/${id}/apply-preset-update`, { method: 'POST', body: { presetVersion } }),
  readiness: (id: string) => api<AgentReadiness>(`/agents/${id}/readiness`),
  scenarios: async (id: string) => scenarioRuns(await api<ScenarioRun[] | null>(`/agents/${id}/test-scenarios`)),
  runScenarios: (id: string) => api<JobRef>(`/agents/${id}/test-scenarios`, { method: 'POST', body: {} }),
  faq: (id: string) => api<AgentFaq[]>(`/agents/${id}/faq`),
  addFaq: (id: string, b: { question: string; answer: string }) => api<AgentFaq>(`/agents/${id}/faq`, { method: 'POST', body: b }),
  updateFaq: (id: string, fid: string, b: { question: string; answer: string }) => api<AgentFaq>(`/agents/${id}/faq/${fid}`, { method: 'PATCH', body: b }),
  removeFaq: (id: string, fid: string) => api<null>(`/agents/${id}/faq/${fid}`, { method: 'DELETE' }),
  extractFaq: (id: string, channelId: string) => api<JobRef>(`/agents/${id}/faq/extract`, { method: 'POST', body: { channelId } }),
  /** `POST /agents/:id/faq/import` (TXT / MD / CSV / DOCX ≤ 5 MB, M11) → `{ created, skipped }` answered at once (no job) */
  importFaq: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ created: AgentFaq[]; skipped: number }>(`/agents/${id}/faq/import`, { method: 'POST', formData: fd });
  },
  test: (id: string, b: PlaygroundBody) => api<PlaygroundTurn>(`/agents/${id}/test`, { method: 'POST', body: b }),
  flagTurn: (id: string, b: { turnId: string; note?: string }) => api<null>(`/agents/${id}/test/flag`, { method: 'POST', body: b }),
  exportTest: (id: string, sessionId: string) => api<Record<string, unknown>>(`/agents/${id}/test/export`, { query: { sessionId } }),
  testLink: (id: string) => api<TestLink>(`/agents/${id}/test-links`, { method: 'POST', body: { expiresInHours: 24 } }),
  routes: () => api<AiRoute[]>('/ai/routes'),
  /** `POST /uploads` for the agent avatar and the photo / voice note of a playground turn */
  upload: (file: File, kind: 'avatar' | 'reply') => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('kind', kind);
    return api<{ id: string; url: string; mime: string; size: number }>('/uploads', { method: 'POST', formData: fd });
  },
  generate: (b: { channelId: string; days: number }) => api<JobRef>('/agents/generate', { method: 'POST', body: b }),
  /** `override` = the review edited before applying (M11): absent fields keep the proposal of the job */
  applyGeneration: (jobId: string, b: { agentId?: string; confirm?: boolean; override?: GenerationOverride }) => api<Agent>(`/agents/generate/${jobId}/apply`, { method: 'POST', body: b }),
  insights: async (q: ApiQuery): Promise<InsightsPage> => {
    const r = await apiRaw<AgentInsight[]>('/agent-insights', { query: q });
    const rows = Array.isArray(r.data) ? r.data : [];
    return { rows, total: r.meta?.total ?? rows.length, counts: (r.meta as Meta & { counts?: InsightCounts })?.counts ?? null };
  },
  resolveInsight: (id: string, b: ResolveInsightBody) => api<AgentInsight>(`/agent-insights/${id}/resolve`, { method: 'POST', body: b }),
  dismissInsights: (ids: string[]) => api<BulkOutcome>('/agent-insights/bulk/dismiss', { method: 'POST', body: { ids } }),
  aiRun: (messageId: string) => api<AiRun>(`/messages/${messageId}/ai-run`),
  /** products of the catalogue added to the scope of an agent (carry-over M2: "Ajouter à un agent") */
  addProducts: (ids: string[], agentId: string) => api<BulkOutcome>('/products/bulk/agent', { method: 'POST', body: { ids, agentId } }),
};

/* ---------- public shared playground (`/agent-test/[token]`): no session, the token of the link is the credential ---------- */
async function publicCall<T>(path: string, locale: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Accept-Language': locale, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as (Envelope<T> & { error?: ApiError['body'] }) | null;
  if (!res.ok || !json || json.error) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const params = { ...json?.error?.params };
    if (res.status === 429 && params.retryAfter === undefined && retryAfter > 0) params.retryAfter = retryAfter;
    throw new ApiError(res.status, { code: 'INTERNAL', message: res.statusText, details: null, ref: res.headers.get('x-request-id') ?? '', ...json?.error, params, fields: { ...json?.error?.fields } });
  }
  return json.data;
}
export const sharedTestApi = {
  get: (token: string, locale: string) => publicCall<SharedTest>(`/agent-test/${encodeURIComponent(token)}`, locale),
  send: (token: string, locale: string, b: { text: string; history?: { role: 'user' | 'assistant'; text: string }[]; sessionId?: string }) => publicCall<SharedReply>(`/agent-test/${encodeURIComponent(token)}/messages`, locale, { method: 'POST', body: b }),
};

/* ---------- cache keys: every key starts with the workspace id ---------- */
export const agentKeys = {
  all: (ws: string) => [ws, 'agents'] as const,
  list: (ws: string, q?: ApiQuery) => (q ? ([ws, 'agents', 'list', q] as const) : ([ws, 'agents', 'list'] as const)),
  presets: (ws: string) => [ws, 'agents', 'presets'] as const,
  routes: (ws: string) => [ws, 'agents', 'routes'] as const,
  one: (ws: string, id: string) => [ws, 'agent', id] as const,
  sub: (ws: string, id: string, what: string, q?: unknown) => (q === undefined ? ([ws, 'agent', id, what] as const) : ([ws, 'agent', id, what, q] as const)),
  insights: (ws: string, q?: ApiQuery) => (q ? ([ws, 'insights', q] as const) : ([ws, 'insights'] as const)),
  aiRun: (ws: string, messageId: string) => [ws, 'ai-run', messageId] as const,
};

const NO_FILTER: ApiQuery = {};
export const useAgents = (q: ApiQuery = NO_FILTER, enabled = true) => {
  const ws = useWorkspaceId();
  const { can } = useSession();
  return useQuery({ queryKey: agentKeys.list(ws, q), queryFn: () => agentsApi.list(q), enabled: !!ws && enabled && can('agents.read'), placeholderData: keepPreviousData });
};
export const useAgent = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.one(ws, id ?? ''), queryFn: () => agentsApi.get(id!), enabled: !!ws && !!id });
};
export const usePresets = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.presets(ws), queryFn: agentsApi.presets, enabled: !!ws && enabled, staleTime: 10 * 60_000 });
};
export const useAiRoutes = (enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.routes(ws), queryFn: agentsApi.routes, enabled: !!ws && enabled, staleTime: 5 * 60_000, retry: false });
};
export const useAgentFaq = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.sub(ws, id ?? '', 'faq'), queryFn: () => agentsApi.faq(id!), enabled: !!ws && !!id });
};
export const useAgentVersions = (id: string) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.sub(ws, id, 'versions'), queryFn: () => agentsApi.versions(id), enabled: !!ws && !!id });
};
export const useAgentMetrics = (id: string, q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.sub(ws, id, 'metrics', q), queryFn: () => agentsApi.metrics(id, q), enabled: !!ws && !!id && enabled, placeholderData: keepPreviousData });
};
export const useReadiness = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.sub(ws, id ?? '', 'readiness'), queryFn: () => agentsApi.readiness(id!), enabled: !!ws && !!id, staleTime: 0 });
};
export const useScenarios = (id: string | null | undefined, polling = false) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.sub(ws, id ?? '', 'scenarios'), queryFn: () => agentsApi.scenarios(id!), enabled: !!ws && !!id, refetchInterval: polling ? 2_000 : false });
};
export const useInsights = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.insights(ws, q), queryFn: () => agentsApi.insights(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useAiRun = (messageId: string | null) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: agentKeys.aiRun(ws, messageId ?? ''), queryFn: () => agentsApi.aiRun(messageId!), enabled: !!ws && !!messageId, retry: false, staleTime: 60_000 });
};
export const insightStatusQuery = (agentId: string | null, status: InsightStatus, extra: ApiQuery = {}): ApiQuery => ({ ...(agentId ? { agentId } : {}), status, pageSize: 50, ...extra });

/** Invalidation after an agent write: lists, the agent, the pages (their `agent` ref), the Get Started checklist. */
export function useAgentsRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    (id?: string) => {
      const jobs = [
        qc.invalidateQueries({ queryKey: agentKeys.all(ws) }),
        qc.invalidateQueries({ queryKey: [ws, 'channels'] }),
        qc.invalidateQueries({ queryKey: [ws, 'onboarding'] }),
        qc.invalidateQueries({ queryKey: [ws, 'workspace'] }),
      ];
      if (id) jobs.push(qc.invalidateQueries({ queryKey: agentKeys.one(ws, id) }));
      return Promise.all(jobs);
    },
    [ws, qc],
  );
}

/**
 * WS `agent.updated { agent: { id, status, pausedReason, pendingInsights, version } }`: the status, the pause reason
 * and the insights badge are patched in place; `actions`, metrics and versions are refetched. `version` is NOT written
 * into the cached agent: the Configuration tab compares it with the version it loaded to detect a foreign save
 * (a dirty form is never rebased by an event).
 */
export function useAgentEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  useWsEvent<WsAgentUpdated>('agent.updated', (p) => {
    const u = p?.agent;
    if (!u?.id) return;
    if (u.deleted) {
      qc.setQueriesData<AgentsList>({ queryKey: agentKeys.list(ws) }, (old) => (old ? { ...old, rows: old.rows.filter((a) => a.id !== u.id) } : old));
      void qc.invalidateQueries({ queryKey: agentKeys.all(ws) });
      return;
    }
    const patch = <T extends Agent>(a: T): T =>
      a.id === u.id ? { ...a, status: u.status ?? a.status, pausedReason: u.pausedReason === undefined ? a.pausedReason : u.pausedReason, pendingInsights: u.pendingInsights ?? a.pendingInsights } : a;
    qc.setQueriesData<AgentsList>({ queryKey: agentKeys.list(ws) }, (old) => (old ? { ...old, rows: old.rows.map(patch) } : old));
    qc.setQueryData<Agent>(agentKeys.one(ws, u.id), (old) => (old ? patch(old) : old));
    void qc.invalidateQueries({ queryKey: agentKeys.all(ws) });
    void qc.invalidateQueries({ queryKey: agentKeys.one(ws, u.id) });
    void qc.invalidateQueries({ queryKey: agentKeys.insights(ws) });
    void qc.invalidateQueries({ queryKey: [ws, 'queue'] });
  });
  useWsEvent<WsAgentVersion>('agent.version_created', (p) => {
    if (!p?.agentId) return;
    void qc.invalidateQueries({ queryKey: agentKeys.sub(ws, p.agentId, 'versions') });
    void qc.invalidateQueries({ queryKey: agentKeys.one(ws, p.agentId) });
  });
}

export const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;
