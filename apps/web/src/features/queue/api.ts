// Queue calls (02-next-route-map `/queue`): needs-human conversations (06 "Conversations") and pending agent insights
// (06 §8.7; a role or a deployment without the endpoint answers 403 / 404: the column stays empty).
import type { ConversationCounts, ConversationListItemView, ConversationView, UpdateConversationInput } from '@djaber/shared';
import { api, ApiError, apiRaw } from '@/lib/api';
import type { AgentInsight } from '@/features/inbox/contracts';

export type InsightsResult = { available: boolean; rows: AgentInsight[]; total: number };

export const queueApi = {
  needsHuman: async (): Promise<ConversationListItemView[]> => (await apiRaw<ConversationListItemView[]>('/conversations', { query: { status: 'needs_human', sort: 'oldestWaiting', limit: 50 } })).data ?? [],
  counts: () => api<ConversationCounts>('/conversations/counts'),
  conversation: (id: string) => api<ConversationView>(`/conversations/${id}`),
  patch: (id: string, body: UpdateConversationInput) => api<ConversationView>(`/conversations/${id}`, { method: 'PATCH', body }),
  /** full-test 15/11 HOME-07: « Charger plus » asks 50 then 100 (the page sizes the API serves) */
  insights: async (pageSize: 25 | 50 | 100 = 25): Promise<InsightsResult> => {
    try {
      const r = await apiRaw<AgentInsight[]>('/agent-insights', { query: { status: 'pending', pageSize } });
      const rows = Array.isArray(r.data) ? r.data : [];
      return { available: true, rows, total: r.meta?.total ?? rows.length };
    } catch (e) {
      // not readable by this role (403) or not served (404): the queue keeps working without the column
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return { available: false, rows: [], total: 0 };
      throw e;
    }
  },
};

export const queueKeys = {
  all: (ws: string) => [ws, 'queue'] as const,
  conversations: (ws: string) => [ws, 'queue', 'conversations'] as const,
  counts: (ws: string) => [ws, 'queue', 'counts'] as const,
  insights: (ws: string) => [ws, 'queue', 'insights'] as const,
};
