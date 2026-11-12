'use client';
// Channels section (wizard step 4 = "Canaux" of the Configuration tab) — Figma "AGT-02 — Agent wizard — step 4
// channels (move dialog state)": one card per connected page. SÉLECTIONNÉE = linked to this agent; LIÉE À « X » →
// "Déplacer ici" asks before moving (AGT-05, never silently); À RECONNECTER cannot be linked. One page has at most one
// agent; every change is written at once (`PUT /channels/:id/agent`) and applies to new conversations.
import { Button, buttonClass, Card, Checkbox, cn, EmptyState, FormAlert, Ltr, MonoChip, Skeleton } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { Share2 } from 'lucide-react';
import { QueryError } from '@/components/global-states';
import { useChannels } from '@/features/channels/api';
import type { Channel } from '@/features/channels/contracts';
import { useLinkAgent } from '@/features/channels/link-agent';
import { PlatformMark } from '@/features/channels/ui';
import { Link } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useAgentsRefresh } from '../api';

export type ChannelLinkState = 'selected' | 'linked_elsewhere' | 'reconnect' | 'pending' | 'free' | 'unavailable';
/** State of one page for the agent being edited. */
export const channelLinkState = (c: Pick<Channel, 'status' | 'agent'>, agentId: string): ChannelLinkState => {
  if (c.agent?.id === agentId) return 'selected';
  if (c.status === 'needs_reconnect') return 'reconnect';
  if (c.status === 'disconnected' || c.status === 'disabled') return 'unavailable';
  if (c.agent) return 'linked_elsewhere';
  return c.status === 'pending_review' ? 'pending' : 'free';
};

export function ChannelsFields({ agentId, agentName, readOnly, lead }: { agentId: string; agentName: string; readOnly?: boolean; /** the rule sentence above the list (the wizard already shows it under its title) */ lead?: boolean }) {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const q = useChannels(can('channels.read'));
  const refresh = useAgentsRefresh();
  const linker = useLinkAgent({ onDone: () => void refresh(agentId) });
  const rows = (q.data?.rows ?? []).filter((c) => c.status !== 'disconnected');
  const selected = rows.filter((c) => c.agent?.id === agentId).length;
  const locked = readOnly || !can('channels.manage');

  if (!can('channels.read')) return <FormAlert tone="info">{t('agents.channels.forbidden')}</FormAlert>;
  return (
    <section className="flex flex-col gap-3" data-section="channels" data-selected={selected}>
      {lead ? <p className="text-[13px] text-text-secondary">{t('agents.channels.description')}</p> : null}
      {q.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Share2 className="size-5" />} title={t('agents.channels.empty.title')} description={t('agents.channels.empty.description')} action={can('channels.manage') ? { label: t('agents.channels.empty.cta'), href: `/${locale}/channels` } : undefined} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('agents.channels.list')}>
          {rows.map((c) => {
            const state = channelLinkState(c, agentId);
            const busy = linker.busy === c.id;
            const disabled = locked || busy || state === 'reconnect' || state === 'unavailable';
            const toggle = () => void linker.link(c, state === 'selected' ? null : agentId, { agentName });
            return (
              <li key={c.id}>
                <Card data-testid="channel-option" data-channel={c.id} data-state={state} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', state === 'selected' && 'border-signal-live', (state === 'reconnect' || state === 'unavailable') && 'opacity-60')}>
                  <Checkbox aria-label={t('agents.channels.select', { name: c.name })} checked={state === 'selected'} disabled={disabled} onChange={toggle} />
                  <PlatformMark platform={c.platform} src={c.avatarUrl} name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{c.name}</div>
                    <div className="ts-label-micro mt-1 truncate text-text-muted">
                      {t(`enum.Channel.platform.${c.platform}`)} · <Ltr>{t('agents.channels.conversations', { count: formatNumber(c.counts.conversations) })}</Ltr> · {t(`enum.Channel.status.${c.status}`)}
                    </div>
                  </div>
                  {state === 'selected' ? <MonoChip tone="success">{t('agents.channels.state.selected')}</MonoChip> : null}
                  {state === 'pending' ? <MonoChip tone="warning">{t('enum.Channel.status.pending_review')}</MonoChip> : null}
                  {state === 'reconnect' ? (
                    <>
                      <MonoChip tone="danger">{t('agents.channels.state.reconnect')}</MonoChip>
                      {can('channels.manage') ? (
                        <Link href={`/channels/${c.id}`} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
                          {t('action.reconnect')}
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                  {state === 'linked_elsewhere' ? (
                    <>
                      <MonoChip tone="warning">{t('agents.channels.state.linked', { name: c.agent?.name ?? '' })}</MonoChip>
                      {locked ? null : (
                        <Button size="sm" onClick={toggle} loading={busy} data-testid="channel-move">
                          {t('agents.channels.move')}
                        </Button>
                      )}
                    </>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <FormAlert tone="info">
        {t('error.AGENT_CHANNEL_SWITCH_NEXT_THREAD')}
      </FormAlert>
      {linker.dialogs}
    </section>
  );
}
