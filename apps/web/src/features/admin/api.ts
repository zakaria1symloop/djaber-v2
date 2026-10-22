'use client';
// Data layer of the admin core screens (contract-a): admin routes ignore `X-Workspace-Id`; query keys start with
// `'admin'`. Lists return `{ rows, total, meta }`; writes that touch a merchant carry `reason` (≥ 10 chars).
import type { AdminJobDto } from '@djaber/shared';
import { toast, updateToast } from '@djaber/ui';
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, apiRaw, type Meta, type RequestOptions } from '@/lib/api';
import type { ApiQuery } from '@/lib/list-state';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/forms';
import { ADMIN_KEY } from './platform';

export type AdminList<T, M = Record<string, unknown>> = { rows: T[]; total: number; meta: Meta & M };

export const adminKey = (...parts: unknown[]): QueryKey => [ADMIN_KEY, ...parts];

export async function adminList<T, M = Record<string, unknown>>(path: string, query?: ApiQuery): Promise<AdminList<T, M>> {
  const r = await apiRaw<T[]>(path, { query });
  return { rows: r.data ?? [], total: r.meta?.total ?? (r.data ?? []).length, meta: r.meta as Meta & M };
}

/** `GET <path>` list with the URL query (keeps the previous page while the next loads). */
export function useAdminList<T, M = Record<string, unknown>>(path: string, query?: ApiQuery, o: { enabled?: boolean } = {}) {
  // admin lists are monitoring screens: back on the tab, the counts are read again (tester report 2026-10-21 UX-011 — a
  // redemption made in another tab left « Utilisations (0) » until a reload)
  return useQuery({ queryKey: adminKey(path, query ?? {}), queryFn: () => adminList<T, M>(path, query), placeholderData: keepPreviousData, enabled: o.enabled ?? true, refetchOnWindowFocus: true });
}

export function useAdminGet<T>(path: string | null, query?: ApiQuery) {
  return useQuery({ queryKey: adminKey(path, query ?? {}), queryFn: () => api<T>(path!, { query }), enabled: !!path });
}

/** Admin write; `idempotent` for creations. */
export const adminWrite = <T,>(path: string, method: RequestOptions['method'], body?: unknown, idempotent?: boolean) => api<T>(path, { method, body, idempotent });
export const adminWriteRaw = <T,>(path: string, method: RequestOptions['method'], body?: unknown, idempotent?: boolean) => apiRaw<T>(path, { method, body, idempotent });

/** Invalidates every admin query whose first path segment matches (`/admin/workspaces` → list + details + sub lists). */
export function useAdminInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) =>
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === ADMIN_KEY && typeof q.queryKey[1] === 'string' && prefixes.some((p) => (q.queryKey[1] as string).startsWith(p)),
    });
}

/** Admin export / translation job: `202 { jobId }` → polls `GET /admin/jobs/:id` with a progress toast, then the download link (24 h). */
export function useAdminJobToast() {
  const t = useT();
  return async (start: () => Promise<{ jobId: string }>, labels: { running: string; done: string }) => {
    let id: number | null = null;
    try {
      const { jobId } = await start();
      id = toast({ tone: 'info', message: labels.running, progress: null, durationMs: 0 });
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 800 : 2000));
        const job = await api<AdminJobDto>(`/admin/jobs/${jobId}`);
        if (job.status === 'queued' || job.status === 'running') {
          updateToast(id, { progress: job.progress || null });
          continue;
        }
        if (job.status === 'done' || job.status === 'partial') {
          const url = job.resultUrl;
          updateToast(id, { tone: 'success', message: labels.done, progress: undefined, durationMs: 15_000, action: url ? { label: t('action.download'), onClick: () => window.open(url, '_blank', 'noopener') } : undefined });
        } else updateToast(id, { tone: 'danger', message: t(`error.${job.error?.code ?? 'INTERNAL'}`), progress: undefined, durationMs: 8000 });
        return job;
      }
    } catch (e) {
      if (id !== null) updateToast(id, { tone: 'danger', message: errorMessage(e, t), progress: undefined, durationMs: 8000 });
      else toast({ tone: 'danger', message: errorMessage(e, t) });
    }
    return null;
  };
}
