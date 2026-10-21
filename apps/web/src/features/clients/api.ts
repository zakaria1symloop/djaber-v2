// Clients calls (06 §2 "Clients", §8.3, §8.5; api-contract §3.6) + TanStack Query hooks and cache keys.
import { formatNumber } from '@djaber/shared';
import { toast } from '@djaber/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, ApiError, apiRaw, type Meta } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { downloadUrl, jobFileName, type JobRef, trackJob } from '@/lib/jobs';
import type { ApiQuery } from '@/lib/list-state';
import { useWorkspaceId } from '@/lib/session';
import type { BulkClientTagsInput, Client, ClientListItem, CreateClientInput, MergeClientsInput, UpdateClientInput } from './contracts';

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; meta: Meta };
export type BulkItemResult = { id: string; ok: boolean; error?: { code: string; message: string; params?: Record<string, unknown> } };
export type BulkResponse = { results: BulkItemResult[]; ok: number; failed: number };
export type ClientTagCount = { tag: string; count: number };

const page = async <T>(path: string, query: ApiQuery): Promise<Page<T>> => {
  const r = await apiRaw<T[]>(path, { query });
  return { rows: r.data, total: r.meta?.total ?? r.data.length, page: r.meta?.page ?? 1, pageSize: r.meta?.pageSize ?? 25, meta: r.meta ?? {} };
};
const bulk = async (path: string, body: unknown): Promise<BulkResponse> => {
  const r = await apiRaw<{ results: BulkItemResult[] }>(path, { method: 'POST', body });
  const results = r.data?.results ?? [];
  const m = r.meta as Meta & { ok?: number; failed?: number };
  return { results, ok: m?.ok ?? results.filter((x) => x.ok).length, failed: m?.failed ?? results.filter((x) => !x.ok).length };
};

export const clientsApi = {
  clients: (q: ApiQuery) => page<ClientListItem>('/clients', q),
  client: (id: string) => api<Client>(`/clients/${id}`),
  create: (b: CreateClientInput) => api<Client>('/clients', { method: 'POST', body: b }),
  update: (id: string, b: UpdateClientInput) => api<Client>(`/clients/${id}`, { method: 'PATCH', body: b }),
  /** soft delete; a client with orders ⇒ `409 CUSTOMER_HAS_ORDERS {count}` unless `archive=true` */
  remove: (id: string, o: { archive?: boolean } = {}) => api<null>(`/clients/${id}`, { method: 'DELETE', query: { archive: o.archive || undefined } }),
  risk: (id: string, riskLevel: 'normal' | 'high') => api<Client>(`/clients/${id}/risk`, { method: 'POST', body: { riskLevel } }),
  /** without `confirm` ⇒ `409 CUSTOMER_MERGE_IRREVERSIBLE` with the preview in `details` */
  merge: (b: MergeClientsInput) => api<Client>('/clients/merge', { method: 'POST', body: b }),
  bulkTags: (b: BulkClientTagsInput) => bulk('/clients/bulk/tags', b),
  /** M11 — tags used by the workspace's clients, count desc (≤ 100); `q` filters by substring */
  tags: (q?: string) => api<ClientTagCount[]>('/clients/tags', { query: { q: q?.trim() || undefined } }),
  bulkDelete: (ids: string[]) => bulk('/clients/bulk/delete', { ids }),
  bulkExport: (ids: string[]) => api<JobRef>('/clients/bulk/export', { method: 'POST', body: { ids } }),
  /** export of the current filter → 202 job */
  export: (q: ApiQuery) => api<JobRef>('/clients/export', { query: q }),
};

/* ---------- cache keys: every key starts with the workspace id ---------- */
export const clientKeys = {
  clients: (ws: string, q?: ApiQuery) => (q ? ([ws, 'clients', 'list', q] as const) : ([ws, 'clients'] as const)),
  client: (ws: string, id: string) => [ws, 'client', id] as const,
  tags: (ws: string, q: string) => [ws, 'clients', 'tags', q] as const,
};

/** Tag suggestions (`GET /clients/tags?q=`): the typed text is debounced by the caller; kept while typing. */
export const useClientTags = (q = '', enabled = true) => {
  const ws = useWorkspaceId();
  const term = q.trim();
  return useQuery({ queryKey: clientKeys.tags(ws, term), queryFn: () => clientsApi.tags(term), enabled: !!ws && enabled, staleTime: 60_000, placeholderData: keepPreviousData });
};

export const useClients = (q: ApiQuery, enabled = true) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: clientKeys.clients(ws, q), queryFn: () => clientsApi.clients(q), enabled: !!ws && enabled, placeholderData: keepPreviousData });
};
export const useClient = (id: string | null | undefined) => {
  const ws = useWorkspaceId();
  return useQuery({ queryKey: clientKeys.client(ws, id ?? ''), queryFn: () => clientsApi.client(id!), enabled: !!ws && !!id, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
};

/** Invalidation after a client write: lists, the client, orders (names / risk shown on rows) and the home dashboard. */
export function useClientsRefresh() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useCallback(
    (o: { clientId?: string } = {}) => {
      const jobs = [qc.invalidateQueries({ queryKey: clientKeys.clients(ws) }), qc.invalidateQueries({ queryKey: [ws, 'orders'] }), qc.invalidateQueries({ queryKey: [ws, 'dashboard'] })];
      if (o.clientId) jobs.push(qc.invalidateQueries({ queryKey: clientKeys.client(ws, o.clientId) }));
      return Promise.all(jobs);
    },
    [ws, qc],
  );
}

/** Progress toast of a clients export job (header "Exporter", bulk "Exporter", row "Exporter la fiche"). */
export function useClientsExport() {
  const t = useT();
  return async (start: () => Promise<{ jobId: string }>) => {
    try {
      const { jobId } = await start();
      const entity = t('clients.export.entity');
      trackJob({
        jobId,
        download: true,
        started: t('toast.jobStarted'),
        progress: (job) => t('toast.export.progress', { entity, pct: job.progress, rows: formatNumber(job.total ?? 0) }),
        done: (job) => ({
          message: t('toast.export.done', { file: t('clients.export.file') }),
          action: job.resultUrl ? { label: t('action.download'), onClick: () => downloadUrl(job.resultUrl!, jobFileName(job)) } : undefined,
        }),
        failed: (job, error) => (job?.error ? `${job.error.message} (${job.error.code})` : errorMessage(error, t)),
      });
    } catch (e) {
      toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
    }
  };
}
