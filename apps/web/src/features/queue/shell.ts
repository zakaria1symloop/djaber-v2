'use client';
// Sidebar badge of "File d'attente" (12 §4: badge = needs-human conversations + pending insights), kept fresh by the
// conversation events. Mount once, in the shell.
import { roleCan } from '@djaber/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession, useWorkspaceId } from '@/lib/session';
import { useWsEvent } from '@/lib/ws';
import { queueApi, queueKeys } from './api';

/** Conversation events that can move a thread in or out of the queue: the queue queries are refetched. */
export function useQueueEvents() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queueKeys.counts(ws) });
    void qc.invalidateQueries({ queryKey: queueKeys.conversations(ws) });
  };
  useWsEvent('conversation.updated', refresh);
  useWsEvent('conversation.deleted', refresh);
  useWsEvent('message.created', refresh);
  useWsEvent('agent.updated', () => void qc.invalidateQueries({ queryKey: queueKeys.insights(ws) }));
}

export function useQueueCounts() {
  const ws = useWorkspaceId();
  const { role } = useSession();
  const enabled = !!ws && roleCan(role, 'inbox.read');
  const counts = useQuery({ queryKey: queueKeys.counts(ws), queryFn: queueApi.counts, enabled, staleTime: 30_000 });
  const insights = useQuery({ queryKey: queueKeys.insights(ws), queryFn: () => queueApi.insights(), enabled, staleTime: 60_000, retry: false });
  return { needsHuman: counts.data?.needs_human ?? 0, insights: insights.data?.total ?? 0 };
}

export function useQueueCount(): number {
  useQueueEvents();
  const c = useQueueCounts();
  return c.needsHuman + c.insights;
}
