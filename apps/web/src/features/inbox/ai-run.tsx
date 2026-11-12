'use client';
// M4 additions of the thread (Figma "REF — Filters, actions & quick-edit matrix": « Clic sur IA → détail du tour »,
// conversation menu « Insights IA de ce fil »): the inspector of one AI turn (`GET /messages/:id/ai-run`) and the
// insights raised on this conversation (`GET /agent-insights?conversationId`), resolvable with `insights.manage`.
import { Button, Dialog, EmptyState, InsightRow, InspectorPanel, Skeleton, toast, ToolCallChip, type InspectorRow } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { QueryError } from '@/components/global-states';
import { insightDetail } from '@/features/agents/insight-detail';
import { agentKeys, useAiRun, useInsights } from '@/features/agents/api';
import type { AgentInsight } from '@/features/agents/contracts';
import { ignoreInsight, isAlreadyResolved, ResolveInsightDialog } from '@/features/agents/insights/resolve-dialog';
import { toolCallView } from '@/features/agents/logic';
import { InsightTypePill } from '@/features/agents/ui';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { aiRunRows } from './ai-run-logic';

/** "Détail du tour IA": status, intent + confidence, model (fallback flagged), tokens, latency, credits, tool calls. */
export function AiRunDialog({ messageId, agentName, onClose }: { messageId: string | null; agentName?: string | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const q = useAiRun(messageId);
  const status = q.error instanceof ApiError ? q.error.status : null;
  const run = q.data;
  const rows: InspectorRow[] = run
    ? aiRunRows(run, locale).map((r) => ({
        key: r.key,
        label: t(`inbox.aiRun.row.${r.key}`),
        tone: r.tone,
        value:
          r.key === 'intent'
            ? r.confidence
              ? t('inbox.aiRun.intent', { intent: r.value, confidence: r.confidence })
              : r.value
            : r.key === 'model'
              ? r.fallback
                ? t('inbox.aiRun.fallback', { model: r.value })
                : r.value
              : r.key === 'tokens'
                ? t('inbox.aiRun.tokens', { input: r.input ?? '0', output: r.output ?? '0' })
                : r.key === 'tools'
                  ? t('inbox.aiRun.tools', { count: r.count ?? 0 })
                  : r.key === 'credits'
                    ? t('inbox.aiRun.credits', { count: r.count ?? 0 })
                    : r.value,
      }))
    : [];
  return (
    <Dialog
      open={messageId !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t('inbox.aiRun.title')}
      description={agentName ? t('inbox.aiRun.context', { agent: agentName }) : undefined}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('action.close')}
        </Button>
      }
    >
      <div data-testid="ai-run" data-state={q.isPending ? 'loading' : run ? 'ready' : status === 404 ? 'none' : status === 403 ? 'forbidden' : 'error'} className="flex flex-col gap-4">
        {q.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : run ? (
          <>
            <InspectorPanel rows={rows} />
            {run.toolCalls?.length ? (
              <section className="flex flex-col gap-2" aria-label={t('inbox.aiRun.toolCalls')}>
                <h3 className="ts-label-section text-text-muted">{t('inbox.aiRun.toolCalls')}</h3>
                {run.toolCalls.map((c, i) => {
                  const v = toolCallView(c);
                  return (
                    <ToolCallChip
                      key={`${c.name}:${i}`}
                      className="!ms-0 !max-w-none"
                      name={v.name}
                      toolLabel={t('inbox.aiRun.tool')}
                      simulatedLabel={t('inbox.aiRun.simulated')}
                      toggleLabel={t('inbox.aiRun.toggle')}
                      args={v.args}
                      result={v.result}
                      simulated={v.simulated}
                      failed={v.failed}
                      defaultOpen={i === 0}
                    />
                  );
                })}
              </section>
            ) : null}
          </>
        ) : status === 404 ? (
          <EmptyState title={t('inbox.aiRun.none.title')} description={t('inbox.aiRun.none.description')} />
        ) : status === 403 ? (
          <EmptyState title={t('state.detail.forbidden.title')} description={t('inbox.aiRun.forbidden')} />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        )}
      </div>
    </Dialog>
  );
}

/** "Insights IA de ce fil": what the agent could not handle in this conversation, newest first. */
export function ThreadInsightsDialog({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const manage = can('insights.manage');
  const q = useInsights({ conversationId: conversationId ?? '', pageSize: 25 }, conversationId !== null);
  const [resolving, setResolving] = useState<AgentInsight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: agentKeys.insights(ws) }), qc.invalidateQueries({ queryKey: [ws, 'queue'] })]);

  const ignore = async (insight: AgentInsight) => {
    setBusy(insight.id);
    try {
      await ignoreInsight(insight);
      toast(t('inbox.insights.ignored'));
    } catch (e) {
      toast(isAlreadyResolved(e) ? { tone: 'info', message: t('error.INSIGHT_ALREADY_RESOLVED') } : { tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <>
      <Dialog open={conversationId !== null && !resolving} onOpenChange={(o) => !o && onClose()} title={t('inbox.insights.title')} description={t('inbox.insights.description')} closeLabel={t('action.close')} size="lg">
        <div data-testid="thread-insights" className="flex flex-col">
          {q.isPending ? (
            <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : q.isError ? (
            q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
              <EmptyState title={t('inbox.insights.empty.title')} description={t('inbox.insights.empty.description')} />
            ) : (
              <QueryError error={q.error} onRetry={() => void q.refetch()} />
            )
          ) : rows.length === 0 ? (
            <EmptyState title={t('inbox.insights.empty.title')} description={t('inbox.insights.empty.description')} />
          ) : (
            <ul className="divide-y divide-line-hairline rounded-card border border-line-edge">
              {rows.map((i) => (
                <li key={i.id}>
                  <InsightRow
                    data-insight={i.id}
                    data-status={i.status}
                    pill={<InsightTypePill type={i.type} />}
                    count={`${t(`inbox.insights.status.${i.status}`)} · ${relativeTime(i.createdAt, locale)}`}
                    customer={t('inbox.insights.customer', { message: i.customerMessage || '—' })}
                    ai={i.aiResponse ? t('inbox.insights.ai', { message: i.aiResponse }) : undefined}
                    cause={insightDetail(t, i.detail) ? t('inbox.insights.cause', { detail: insightDetail(t, i.detail)! }) : undefined}
                    actions={
                      manage && i.status === 'pending' ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => setResolving(i)} disabled={busy === i.id} data-action="resolve">
                            {t('action.resolve')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void ignore(i)} loading={busy === i.id} data-action="ignore">
                            {t('action.dismiss')}
                          </Button>
                        </>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
      <ResolveInsightDialog
        insight={resolving}
        onClose={() => setResolving(null)}
        onDone={(_i, outcome) => {
          setResolving(null);
          if (!outcome.already) toast(t('inbox.insights.resolved'));
          void refresh();
        }}
      />
    </>
  );
}
