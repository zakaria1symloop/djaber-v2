// Home dashboard (`GET /dashboard/home`, `analytics.read`) + live refresh: the dashboard is derived by the server, so
// every relevant WS event refetches it (orders, conversations, notifications, pages, credits, stock).
import type { HomeView } from '@djaber/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';

export const homeApi = { home: () => api<HomeView>('/dashboard/home') };
export const homeKeys = {
  all: (ws: string) => [ws, 'dashboard'] as const,
  home: (ws: string) => [ws, 'dashboard', 'home'] as const,
};

export const useHome = (enabled = true) => {
  const ws = useWorkspaceId();
  // journeys J02r-3 / J07r-3: every visit reads the server again (the cached figures show meanwhile) — a stock, sale or
  // order write made while the Home was not mounted never leaves it 30 s behind the other screens
  return useQuery({ queryKey: homeKeys.home(ws), queryFn: homeApi.home, enabled: !!ws && enabled, staleTime: 30_000, refetchOnMount: 'always' });
};

/** WS events that change a figure of the home page. */
export const HOME_EVENTS = ['order.created', 'order.updated', 'order.deleted', 'conversation.updated', 'notification.created', 'channel.updated', 'credits.updated', 'product.updated', 'agent.updated', 'cash.updated', 'inventory.updated'] as const;

/** Mounted by the home page: one refetch of the dashboard per burst of events. */
export function useHomeEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: homeKeys.home(ws) });
  useWsEvent(HOME_EVENTS[0], refresh);
  useWsEvent(HOME_EVENTS[1], refresh);
  useWsEvent(HOME_EVENTS[2], refresh);
  useWsEvent(HOME_EVENTS[3], refresh);
  useWsEvent(HOME_EVENTS[4], refresh);
  useWsEvent(HOME_EVENTS[5], refresh);
  useWsEvent(HOME_EVENTS[6], refresh);
  useWsEvent(HOME_EVENTS[7], refresh);
  useWsEvent(HOME_EVENTS[8], refresh);
  useWsEvent(HOME_EVENTS[9], refresh);
  useWsEvent(HOME_EVENTS[10], refresh);
}
