'use client';
// Small display pieces shared by the agents screens: status pill (colours from the `StatusPill` map, labels from
// `enum.Agent.*`), insight type pill, model badge, channel chips.
import { cn, Ltr, MonoChip, Pill, StatusPill } from '@djaber/ui';
import { Link } from '@/i18n/navigation';
import { useT, type TFunction } from '@/lib/i18n';
import type { Agent, ChannelRef, InsightType } from './contracts';
import { autonomyView, cardState, knowledgeHref, type AgentCardState } from './logic';

/** ACTIF · EN PAUSE · PAUSE (PLAN) · BROUILLON */
export const agentStateLabel = (t: TFunction, state: AgentCardState): string => (state === 'paused_plan' ? t('enum.Agent.pausedReason.plan') : t(`enum.Agent.status.${state}`));

export function AgentStatusPill({ agent, className }: { agent: Pick<Agent, 'status' | 'pausedReason'>; className?: string }) {
  const t = useT();
  const state = cardState(agent);
  return (
    <span data-testid="agent-status" data-state={state} className="inline-flex">
      <StatusPill enumKey="Agent.status" value={agent.status} className={cn('!rounded-[4px]', className)}>
        {agentStateLabel(t, state)}
      </StatusPill>
    </span>
  );
}

/**
 * Owner decision 26/11 — « Autonomie de l'IA · 92 % » with « 46 conversations sur 30 jours, 4 passées à l'équipe » (« — » and
 * « Pas encore de conversation » while the agent had none), then the link to the team's replies that wait for a review
 * (Agent › Connaissances). On each card of the agents list and at the top of the agent page.
 */
export function AgentAutonomy({ agent, className }: { agent: Pick<Agent, 'id' | 'autonomy' | 'learningPending'>; className?: string }) {
  const t = useT();
  const v = autonomyView(agent.autonomy);
  if (!v) return null;
  const pending = agent.learningPending ?? 0;
  return (
    <div data-testid="agent-autonomy" data-tone={v.tone} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]', className)}>
      <span className="inline-flex items-center gap-2" title={t('agents.autonomy.hint', { days: v.params.days })}>
        <span className="ts-label-meta uppercase text-text-muted">{t('agents.autonomy.label')}</span>
        <MonoChip tone={v.tone}>
          <span data-testid="agent-autonomy-pct">
            <Ltr>{v.value}</Ltr>
          </span>
        </MonoChip>
      </span>
      <span className="text-text-secondary" data-testid="agent-autonomy-detail">
        {t(v.detailKey, v.params)}
      </span>
      {pending > 0 ? (
        <Link href={knowledgeHref(agent.id)} data-testid="agent-learning-link" className="text-accent-inbound hover:underline">
          {t('agents.learning.pending', { count: pending })}
        </Link>
      ) : null}
    </div>
  );
}

export function InsightTypePill({ type }: { type: InsightType }) {
  const t = useT();
  return (
    <StatusPill enumKey="AgentInsight.type" value={type} className="!rounded-[4px]">
      {t(`enum.AgentInsight.type.${type}`)}
    </StatusPill>
  );
}

/** Read-only model badge: the platform routing assigns the model, the merchant never picks one (D54). */
export function ModelBadge({ label, className }: { label: string; className?: string }) {
  const t = useT();
  return (
    <MonoChip title={t('agents.model.readOnly')} className={className}>
      <bdi dir="ltr" data-testid="model-badge">
        {label || '—'}
      </bdi>
    </MonoChip>
  );
}

const PLATFORM_SHORT: Record<ChannelRef['platform'], string> = { facebook: 'FB', instagram: 'IG' };
/** "Boutique Amel (FB)" */
export const channelLabel = (c: Pick<ChannelRef, 'name' | 'platform'>): string => `${c.name} (${PLATFORM_SHORT[c.platform]})`;

export function ChannelChips({ channels, empty }: { channels: ChannelRef[]; empty?: string }) {
  if (!channels.length)
    return empty ? (
      <Pill tone="warning" className="!rounded-[4px]">
        {empty}
      </Pill>
    ) : null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {channels.map((c) => (
        <li key={c.id}>
          <MonoChip tone={c.status === 'needs_reconnect' ? 'danger' : 'neutral'}>{c.name}</MonoChip>
        </li>
      ))}
    </ul>
  );
}
