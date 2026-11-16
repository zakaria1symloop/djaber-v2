// Notification centre calls (06 §2 "Notifications", api-contract §3.12) + cache keys.
import type { DataDeletionStatusView, NotificationView } from '@djaber/shared';
import { api, apiRaw } from '@/lib/api';

export type NotificationPage = { rows: NotificationView[]; nextCursor: string | null; hasMore: boolean };
export const NOTIFICATIONS_PAGE = 20;

/** `GET /notifications/unread-count` → `{ count }` (a bare number or `{ unreadCount }` is read too). */
export const readCount = (data: unknown): number => {
  if (typeof data === 'number') return Math.max(0, data);
  const o = (data ?? {}) as { count?: unknown; unreadCount?: unknown; unread?: unknown };
  const n = Number(o.count ?? o.unreadCount ?? o.unread ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export const notificationsApi = {
  list: async (q: { types?: string[]; group?: string; unread?: boolean; cursor?: string | null }): Promise<NotificationPage> => {
    const r = await apiRaw<NotificationView[]>('/notifications', { query: { ...q, limit: NOTIFICATIONS_PAGE } });
    return { rows: r.data ?? [], nextCursor: r.meta?.nextCursor ?? null, hasMore: r.meta?.hasMore ?? false };
  },
  unreadCount: async () => readCount(await api<unknown>('/notifications/unread-count')),
  /** full-test 15/11 HOME-05: unread per family (`byGroup` of the same call) for the chip counts */
  unreadByGroup: async (): Promise<Record<string, number>> => ((await api<{ byGroup?: Record<string, number> }>('/notifications/unread-count')).byGroup ?? {}),
  read: (id: string) => api<unknown>(`/notifications/${id}/read`, { method: 'POST', body: {} }),
  readAll: () => api<unknown>('/notifications/read-all', { method: 'POST', body: {} }),
  /** public: no session needed */
  dataDeletion: (code: string) => api<DataDeletionStatusView>(`/data-deletion/${encodeURIComponent(code)}`, { noRefresh: true }),
};

/** Notifications belong to the user in a workspace: every key starts with the workspace id. */
export const notificationKeys = {
  all: (ws: string) => [ws, 'notifications'] as const,
  list: (ws: string, q: unknown) => [ws, 'notifications', 'list', q] as const,
  lists: (ws: string) => [ws, 'notifications', 'list'] as const,
  unread: (ws: string) => [ws, 'notifications', 'unread-count'] as const,
  unreadGroups: (ws: string) => [ws, 'notifications', 'unread-groups'] as const,
};
