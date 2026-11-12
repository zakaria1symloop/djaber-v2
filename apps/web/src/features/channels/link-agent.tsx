'use client';
// Linking a page to an agent (AGT-05, `PUT /channels/:id/agent { agentId | null, move? }`): one page has at most one
// agent, so choosing another one asks first ("Déplacer « page » vers « agent » ?", Figma "AGT-02 — step 4 channels
// (move dialog state)"). A `409 AGENT_PAGE_ALREADY_ASSIGNED` answered without `move` opens the same confirmation.
// Shared by the channel page ("Changer ⌄" / "Détacher" / "Rattacher un agent"), the cards of `/channels`, the connect
// report and the agent wizard (step 4).
import { Button, buttonClass, Dialog, FormAlert, StatusPill, toast } from '@djaber/ui';
import { useState, type ReactNode } from 'react';
import { useAgents, useAgentsRefresh } from '@/features/agents/api';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { channelsApi, useChannelsRefresh } from './api';
import type { Channel } from './contracts';

export type LinkChannel = Pick<Channel, 'id' | 'name' | 'agent'>;
type Move = { channel: LinkChannel; agentId: string; agentName: string; currentName: string };

const isAssigned = (e: unknown): e is ApiError => e instanceof ApiError && e.code === 'AGENT_PAGE_ALREADY_ASSIGNED';

export function useLinkAgent(o: { onDone?: (channel: LinkChannel, agentId: string | null) => void } = {}) {
  const t = useT();
  const refreshChannels = useChannelsRefresh();
  const refreshAgents = useAgentsRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [picking, setPicking] = useState<LinkChannel | null>(null);

  const done = async (channel: LinkChannel, agentId: string | null, agentName: string) => {
    await Promise.all([refreshChannels(channel.id), refreshAgents(agentId ?? undefined), channel.agent ? refreshAgents(channel.agent.id) : null]);
    toast(agentId ? t('channels.link.toast.linked', { page: channel.name, agent: agentName }) : t('channels.link.toast.detached', { page: channel.name }));
    o.onDone?.(channel, agentId);
  };

  /** Sends the write; returns the error instead of throwing so that each caller shows it where it belongs. */
  const put = async (channel: LinkChannel, agentId: string | null, agentName: string, confirmed: boolean): Promise<unknown | null> => {
    setBusy(channel.id);
    try {
      await channelsApi.setAgent(channel.id, confirmed ? { agentId, move: true } : { agentId });
      await done(channel, agentId, agentName);
      return null;
    } catch (e) {
      return e;
    } finally {
      setBusy(null);
    }
  };

  /**
   * Links `agentId` to the page (null = detach). When the page already answers with another agent the move
   * confirmation is shown first; the write happens on "Déplacer la page".
   */
  const link = async (channel: LinkChannel, agentId: string | null, opts: { agentName?: string } = {}) => {
    const agentName = opts.agentName ?? '';
    if (agentId && channel.agent?.id === agentId) return;
    if (agentId && channel.agent && channel.agent.id !== agentId) {
      setMoveError(null);
      return setMove({ channel, agentId, agentName, currentName: channel.agent.name });
    }
    const e = await put(channel, agentId, agentName, false);
    if (!e) return;
    if (agentId && isAssigned(e)) {
      setMoveError(null);
      return setMove({ channel, agentId, agentName, currentName: String(e.body.params.agentName ?? '') });
    }
    toast({ tone: 'danger', message: errorMessage(e, t) });
    void refreshChannels(channel.id);
  };

  const confirmMove = async () => {
    if (!move) return;
    setMoveError(null);
    const e = await put(move.channel, move.agentId, move.agentName, true);
    if (e) setMoveError(errorMessage(e, t));
    else setMove(null);
  };

  const dialogs: ReactNode = (
    <>
      <AgentPickerDialog
        channel={picking}
        onClose={() => setPicking(null)}
        onPick={(agent) => {
          const channel = picking;
          setPicking(null);
          if (channel) void link(channel, agent.id, { agentName: agent.name });
        }}
      />
      <Dialog
        open={move !== null}
        onOpenChange={(open) => !open && busy === null && setMove(null)}
        title={move ? t('channels.link.move.title', { page: move.channel.name, agent: move.agentName }) : ''}
        closeLabel={t('action.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMove(null)} disabled={busy !== null}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={confirmMove} loading={busy !== null} data-testid="move-confirm">
              {t('channels.link.move.submit')}
            </Button>
          </>
        }
      >
        {move ? (
          <div data-testid="move-dialog" className="flex flex-col gap-3">
            <p className="text-[13px] text-text-secondary">{t('channels.link.move.description', { current: move.currentName || '—' })}</p>
            <FormAlert tone="info">
              {t('error.AGENT_CHANNEL_SWITCH_NEXT_THREAD')}
            </FormAlert>
            {moveError ? <FormAlert>{moveError}</FormAlert> : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );

  return {
    link,
    /** opens the agent picker for this page ("Changer ⌄", "Rattacher un agent", "Changer d'agent") */
    pick: (channel: LinkChannel) => setPicking(channel),
    dialogs,
    /** id of the page being written, or null */
    busy,
  };
}
export type LinkAgent = ReturnType<typeof useLinkAgent>;

/** "Changer d'agent": the agents of the workspace as a radio list; the current one is marked. */
export function AgentPickerDialog({ channel, onClose, onPick }: { channel: LinkChannel | null; onClose: () => void; onPick: (agent: { id: string; name: string }) => void }) {
  const t = useT();
  const q = useAgents(undefined, channel !== null);
  const [picked, setPicked] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  const current = channel?.agent?.id ?? null;
  const value = picked && rows.some((a) => a.id === picked) ? picked : null;
  const chosen = rows.find((a) => a.id === value) ?? null;
  const close = () => {
    setPicked(null);
    onClose();
  };
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(open) => !open && close()}
      title={t('channels.link.picker.title')}
      description={channel ? t('channels.link.picker.description', { page: channel.name }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="agent-picker-submit"
            disabledReason={chosen ? undefined : t('channels.link.picker.choose')}
            onClick={() => {
              if (!chosen) return;
              setPicked(null);
              onPick({ id: chosen.id, name: chosen.name });
            }}
          >
            {t('channels.link.picker.submit')}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{errorMessage(q.error, t)}</FormAlert>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3" data-testid="agent-picker-empty">
          <p className="text-[13px] text-text-secondary">{t('channels.link.picker.empty')}</p>
          <Link href="/agents/new" className={buttonClass({ size: 'sm' })}>
            {t('channels.ai.createAgent')}
          </Link>
        </div>
      ) : (
        <div role="radiogroup" aria-label={t('channels.link.picker.title')} data-testid="agent-picker" className="flex flex-col gap-1">
          {rows.map((a) => {
            const isCurrent = a.id === current;
            return (
              <label key={a.id} data-agent={a.id} className="flex cursor-pointer items-center gap-3 rounded-card px-2 py-2 text-[13px] hover:bg-ink-raised aria-disabled:cursor-not-allowed aria-disabled:opacity-60" aria-disabled={isCurrent || undefined}>
                <input type="radio" name="agent" value={a.id} disabled={isCurrent} checked={value === a.id} onChange={() => setPicked(a.id)} className="size-4 accent-white" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {isCurrent ? <span className="ts-label-micro text-text-muted">{t('channels.link.picker.current')}</span> : null}
                <StatusPill enumKey="Agent.status" value={a.status} className="!rounded-[4px]">
                  {t(`enum.Agent.status.${a.status}`)}
                </StatusPill>
              </label>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
