'use client';
// Mutations of a conversation shared by the thread header, the row menu and the banners: versioned PATCH
// (resolve / reopen / archive / pause / resume / assign) with the 409 dialog, read / unread, delete / restore,
// block / unblock / report. The menu items follow the frame "INB — Inbox — filter sheet + conversation menu".
import { ConfirmDialog, toast, type MenuAction } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ConflictDialog } from '@/components/global-states';
import { useCredits } from '@/features/credits/api';
import { BlockCustomerDialog, ReportCustomerDialog, type ReportTarget } from '@/features/safety/dialogs';
import { useRouter } from '@/i18n/navigation';
import { toMenuActions, type ActionHandler } from '@/lib/actions';
import { api, ApiError } from '@/lib/api';
import { conflictOf } from '@/lib/conflict';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { AiRunDialog, ThreadInsightsDialog } from './ai-run';
import { inboxApi, inboxKeys, useInboxRefresh, writeConversation } from './api';
import type { ActionDescriptor, Conversation, ConversationListItem, ConversationPatchBody } from './contracts';

type Row = ConversationListItem | Conversation;

/** The rule of `ConversationService.actions` for a list row (no descriptors on rows): same keys, same order. */
export const localActions = (row: Pick<ConversationListItem, 'status' | 'aiPaused' | 'unreadCount' | 'blocked'> & Partial<Pick<ConversationListItem, 'pageHasAgent' | 'agent'>>, may: { block: boolean; unblock: boolean; remove: boolean }, creditsOut = false): ActionDescriptor[] => {
  // no agent on the page and none answered the conversation: no AI to pause or resume (`CONVERSATION_NO_AGENT`)
  const hasAgent = row.pageHasAgent !== false || !!row.agent;
  const noAgent = hasAgent ? {} : { reasonCode: 'CONVERSATION_NO_AGENT' };
  return [
    { key: 'resolve', enabled: row.status !== 'resolved' },
    { key: 'reopen', enabled: row.status === 'resolved' || row.status === 'archived' },
    { key: 'archive', enabled: row.status !== 'archived' },
    { key: 'pauseAi', enabled: !row.aiPaused && hasAgent, ...noAgent },
    // recette 11/11 (Badro): no credit left ⇒ « Reprendre l'IA » waits for a top-up (`INSUFFICIENT_CREDITS`, like the API)
    { key: 'resumeAi', enabled: (row.aiPaused || row.status === 'needs_human') && hasAgent && !creditsOut, ...(hasAgent && creditsOut ? { reasonCode: 'INSUFFICIENT_CREDITS' } : noAgent) },
    { key: 'assign', enabled: true },
    { key: 'markUnread', enabled: row.unreadCount === 0 },
    { key: 'block', enabled: !row.blocked && may.block },
    { key: 'unblock', enabled: row.blocked && may.unblock },
    { key: 'report', enabled: may.block },
    { key: 'delete', enabled: may.remove },
  ];
};
type Change = Omit<ConversationPatchBody, 'version'>;
type Conflict = { name: string; ago: string; current: Conversation | null };

export function useConversationActions(o: { onDeleted?: (id: string) => void } = {}) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const router = useRouter();
  const { me, can } = useSession();
  const creditsOut = !!useCredits().data?.exhausted;
  const refresh = useInboxRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toBlock, setToBlock] = useState<Row | null>(null);
  const [toReport, setToReport] = useState<{ target: ReportTarget; name: string } | null>(null);
  const [aiRun, setAiRun] = useState<{ messageId: string; agentName: string | null } | null>(null);
  const [insightsOf, setInsightsOf] = useState<string | null>(null);

  /** Versioned PATCH. The version comes from the freshest copy in the cache (WS keeps it current). */
  const patch = useCallback(
    async (row: Row, change: Change, done?: string): Promise<boolean> => {
      const cached = qc.getQueryData<Conversation>(inboxKeys.detail(ws, row.id));
      const version = Math.max(row.version ?? 1, cached?.version ?? 1);
      setBusy(row.id);
      try {
        const next = await inboxApi.patch(row.id, { ...change, version });
        if (next) writeConversation(qc, ws, next);
        void refresh({ id: row.id });
        if (done) toast(done);
        return true;
      } catch (e) {
        const c = conflictOf<Conversation>(e);
        if (c) {
          setConflict({ name: c.changedBy || t('inbox.conflict.someone'), ago: c.changedAt ? relativeTime(c.changedAt, locale) : '—', current: c.current });
        } else {
          toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [qc, ws, refresh, t, locale],
  );

  const run = useCallback(
    async (id: string, fn: () => Promise<unknown>, done?: string) => {
      setBusy(id);
      try {
        await fn();
        void refresh({ id });
        if (done) toast(done);
      } catch (e) {
        toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const resolve = (row: Row) => patch(row, { status: 'resolved' }, t('inbox.toast.resolved'));
  const reopen = (row: Row) => patch(row, { status: 'active' }, t('inbox.toast.reopened'));
  const archive = (row: Row) => patch(row, { status: 'archived' }, t('inbox.toast.archived'));
  const pauseAi = (row: Row) => patch(row, { aiPaused: true }, t('inbox.toast.aiPaused'));
  /** resuming hands the conversation back to the AI: a needs-human thread becomes active again */
  const resumeAi = (row: Row) => patch(row, row.status === 'needs_human' ? { aiPaused: false, status: 'active' } : { aiPaused: false }, t('inbox.toast.aiResumed'));
  const assign = (row: Row, assigneeId: string | null) => patch(row, { assigneeId }, assigneeId ? t('inbox.toast.assigned') : t('inbox.toast.unassigned'));
  const markUnread = (row: Row) =>
    run(row.id, async () => {
      await inboxApi.unread(row.id);
      writeConversation(qc, ws, { id: row.id, unreadCount: Math.max(1, row.unreadCount) });
    });
  const unblock = (row: Row) => run(row.id, () => inboxApi.unblock(row.id), t('inbox.toast.unblocked'));
  const restore = (row: Row) => run(row.id, () => inboxApi.restore(row.id), t('inbox.toast.restored'));
  /** `POST /clients/:id/risk` (MOB-R13 / SAFE "Marquer « risque »"): the client is flagged manually, the AI and the order list show it */
  const setRisk = (row: Row, riskLevel: 'normal' | 'high') => {
    const clientId = row.client?.id;
    if (!clientId) return;
    return run(
      row.id,
      async () => {
        await api(`/clients/${clientId}/risk`, { method: 'POST', body: { riskLevel } });
        void qc.invalidateQueries({ queryKey: [ws, 'client', clientId] });
        void qc.invalidateQueries({ queryKey: [ws, 'clients'] });
      },
      t(riskLevel === 'high' ? 'inbox.toast.markedRisk' : 'inbox.toast.markedReliable'));
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await inboxApi.remove(toDelete.id);
      const id = toDelete.id;
      setToDelete(null);
      toast(t('inbox.toast.deleted'));
      void refresh({ id });
      o.onDeleted?.(id);
    } catch (e) {
      // shown inside the dialog, which stays open
      setDeleteError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Items of the conversation menu, in the order of the frame. The detail carries the server `actions` (D42: a
   * refused item stays visible, greyed, with its reason); a list row has none, so the same rule is derived from the row
   * and the API still refuses what it must.
   */
  const menu = (row: Row, opts: { inThread?: boolean } = {}): MenuAction[] => {
    if (!can('inbox.read')) return [];
    const mine = row.assignee?.id === me?.id;
    const name = row.client?.name ?? '';
    const descriptors: ActionDescriptor[] = 'actions' in row && row.actions?.length ? row.actions : localActions(row, { block: can('safety.block'), unblock: can('safety.manage'), remove: can('inbox.delete') }, creditsOut);
    // a role that may not delete / unblock does not see the item at all (permission ⇒ hidden, state ⇒ greyed)
    const hidden = (key: string, allowed: boolean) => !allowed || descriptors.some((d) => d.key === key && !d.enabled && d.reasonCode === 'FORBIDDEN');
    const handlers: Record<string, ActionHandler> = {
      open: { label: t('action.open'), onSelect: () => router.push(`/inbox/${row.id}`), hint: t('common.shortcut.enter'), local: true, hidden: !!opts.inThread },
      resumeAi: { label: t('action.resumeAi'), onSelect: () => void resumeAi(row), hidden: !(row.aiPaused || row.status === 'needs_human') },
      pauseAi: { label: t('action.pauseAi'), onSelect: () => void pauseAi(row), hidden: row.aiPaused || row.status === 'needs_human' },
      assign: { label: mine ? t('action.unassign') : t('inbox.menu.assignMe'), onSelect: () => void assign(row, mine ? null : (me?.id ?? null)) },
      resolve: { label: t('inbox.menu.resolve'), onSelect: () => void resolve(row), hidden: row.status === 'resolved' },
      reopen: { label: t('inbox.menu.reopen'), onSelect: () => void reopen(row), hidden: row.status !== 'resolved' && row.status !== 'archived' },
      archive: { label: t('action.archive'), onSelect: () => void archive(row), hidden: row.status === 'archived' },
      markUnread: { label: t('inbox.menu.markUnread'), onSelect: () => void markUnread(row), hidden: row.unreadCount > 0 },
      clientSheet: { label: row.client?.isPlaceholder ? t('inbox.client.complete') : t('inbox.client.sheet'), onSelect: () => router.push(`/clients?sheet=${row.client?.id}`), local: true, separated: true, hidden: !row.client || !can('clients.read') },
      newOrder: { label: t('inbox.orders.new', { name: (row.client?.name ?? '').trim().split(/\s+/)[0] ?? '' }), onSelect: () => router.push(`/orders/new?clientId=${row.client?.id}&conversationId=${row.id}`), local: true, hidden: !row.client || row.client.isPlaceholder || !can('orders.write') },
      clientOrders: { label: t('inbox.client.ordersLink'), onSelect: () => router.push(`/orders?clientId=${row.client?.id}`), local: true, hidden: !row.client || row.client.isPlaceholder || !can('orders.read') },
      markRisk: { label: t('inbox.menu.markRisk'), onSelect: () => void setRisk(row, 'high'), local: true, hidden: !row.client || row.client.isPlaceholder || row.client.riskLevel === 'high' || !can('clients.write') },
      markReliable: { label: t('inbox.menu.markReliable'), onSelect: () => void setRisk(row, 'normal'), local: true, hidden: !row.client || row.client.riskLevel !== 'high' || !can('clients.write') },
      insights: { label: t('inbox.menu.insights'), onSelect: () => setInsightsOf(row.id), local: true, separated: true, hidden: !row.agent || !can('agents.read') },
      block: { label: t('inbox.menu.block'), onSelect: () => setToBlock(row), destructive: true, separated: true, hidden: row.blocked || hidden('block', can('safety.block')) },
      unblock: { label: t('action.unblock'), onSelect: () => void unblock(row), separated: true, hidden: !row.blocked || hidden('unblock', can('safety.manage')) },
      report: { label: t('inbox.menu.report'), onSelect: () => setToReport({ target: { type: 'customer', conversationId: row.id, clientId: row.client?.id }, name }), hidden: hidden('report', can('safety.block')) },
      delete: { label: t('inbox.menu.delete'), onSelect: () => setToDelete(row), destructive: true, separated: true, hint: t('inbox.menu.deleteHint'), hidden: hidden('delete', can('inbox.delete')) },
    };
    return toMenuActions(descriptors, handlers, t).map((a) => (a.key === 'open' ? { ...a, primary: true } : a));
  };

  const dialogs = (
    <>
      <ConflictDialog
        open={!!conflict}
        name={conflict?.name ?? ''}
        ago={conflict?.ago ?? ''}
        onClose={() => setConflict(null)}
        onReload={() => {
          if (conflict?.current) writeConversation(qc, ws, conflict.current);
          void refresh({ id: conflict?.current?.id });
          setConflict(null);
        }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setToDelete(null);
            setDeleteError(null);
          }
        }}
        title={t('dialog.deleteConversation.title')}
        description={t('inbox.delete.context')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        onConfirm={() => void confirmDelete()}
        destructive
        loading={deleting}
      >
        <p className="text-[13px] text-text-secondary">{t('inbox.delete.description')}</p>
        {deleteError ? (
          <p role="alert" className="mt-3 text-[12px] text-accent-alert">
            {deleteError}
          </p>
        ) : null}
      </ConfirmDialog>
      <AiRunDialog messageId={aiRun?.messageId ?? null} agentName={aiRun?.agentName} onClose={() => setAiRun(null)} />
      <ThreadInsightsDialog conversationId={insightsOf} onClose={() => setInsightsOf(null)} />
      <BlockCustomerDialog
        open={!!toBlock}
        onClose={() => setToBlock(null)}
        conversationId={toBlock?.id ?? ''}
        clientName={toBlock?.client?.name ?? ''}
        onDone={() => void refresh({ id: toBlock?.id })}
      />
      <ReportCustomerDialog
        open={!!toReport}
        onClose={() => setToReport(null)}
        target={toReport?.target ?? { type: 'customer' }}
        name={toReport?.name ?? ''}
        onDone={() => void refresh({ id: toReport?.target.conversationId })}
      />
    </>
  );

  return { busy, menu, dialogs, patch, resolve, reopen, archive, pauseAi, resumeAi, assign, markUnread, unblock, restore, askDelete: setToDelete, askBlock: setToBlock, askReport: setToReport, askAiRun: setAiRun, askInsights: setInsightsOf };
}
export type ConversationActions = ReturnType<typeof useConversationActions>;
