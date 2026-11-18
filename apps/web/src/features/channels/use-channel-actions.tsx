'use client';
// `Actions ⌄` of one page with its dialogs, shared by the cards of `/channels` and the header of `/channels/[id]`
// (Figma "MECH — … Channels row actions", "DLG — Agents & channels": Déconnecter, Réactiver et échanger).
// The items come from the server `actions` descriptors: a forbidden one stays visible, greyed, with its reason.
import { Button, buttonClass, Dialog, FormAlert, Ltr, Pill, toast, type MenuAction } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { useState, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { actionState, toMenuActions } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { retryAfterSeconds } from '@/lib/countdown';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { channelsApi, useAppReviewStatus, useChannels, useChannelsRefresh } from './api';
import type { ConnectFlow } from './connect';
import type { Channel } from './contracts';
import { useLinkAgent } from './link-agent';
import { cardState, limitReached, swapCandidates } from './logic';

type Open = { kind: 'disconnect' | 'swap' | 'approval'; channel: Channel };

const isLimit = (e: unknown) => e instanceof ApiError && (e.code === 'PLAN_LIMIT' || e.code === 'CHANNEL_PAUSED_BY_PLAN');

export function useChannelActions(o: { connect: ConnectFlow; /** the page already shows the channel: no "Ouvrir la page" item */ hideOpen?: boolean; onDisconnected?: (c: Channel) => void }) {
  const t = useT();
  const router = useRouter();
  const refresh = useChannelsRefresh();
  const { can } = useSession();
  const list = useChannels();
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => setOpen(null);
  const manage = can('channels.manage');
  // "Changer d'agent" / "Rattacher un agent": picker + move confirmation (AGT-05)
  const linkAgent = useLinkAgent();

  const call = async (c: Channel, key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(`${key}:${c.id}`);
    try {
      await fn();
      await refresh(c.id);
      toast(done);
    } catch (e) {
      const wait = retryAfterSeconds(e, 0);
      toast({ tone: 'danger', message: wait > 0 ? t('channels.toast.syncInfoWait', { minutes: Math.ceil(wait / 60) }) : errorMessage(e, t) });
      void refresh(c.id);
    } finally {
      setBusy(null);
    }
  };

  /** the server greys "resume" with PLAN_LIMIT when no page slot is free: the swap dialog is the way through */
  const needsSwap = (c: Channel) => {
    const d = c.actions?.find((a) => a.key === 'resume');
    return (!!d && !d.enabled && d.reasonCode === 'PLAN_LIMIT') || (c.pausedReason === 'plan' && limitReached(list.data?.planLimit));
  };
  /** Resume (manual pause) or re-enable (disabled); at the plan limit the swap dialog asks which page to pause. */
  const resume = async (c: Channel) => {
    if (needsSwap(c)) return setOpen({ kind: 'swap', channel: c });
    setBusy(`resume:${c.id}`);
    try {
      await (c.status === 'disabled' ? channelsApi.enable(c.id) : channelsApi.setStatus(c.id, { status: 'active' }));
      await refresh(c.id);
      toast(t('channels.toast.resumed', { name: c.name }));
    } catch (e) {
      if (isLimit(e)) setOpen({ kind: 'swap', channel: c });
      else toast({ tone: 'danger', message: errorMessage(e, t) });
      void refresh(c.id);
    } finally {
      setBusy(null);
    }
  };
  const pause = (c: Channel) => call(c, 'pause', () => channelsApi.setStatus(c.id, { status: 'paused' }), t('channels.toast.paused', { name: c.name }));
  const syncInfo = (c: Channel) => call(c, 'syncInfo', () => channelsApi.syncInfo(c.id), t('channels.toast.infoSynced', { name: c.name }));

  /** Items in the order of the MECH frame. Keys = the server descriptor keys (`ChannelView.actions`). */
  const menu = (c: Channel): MenuAction[] =>
    toMenuActions(
      // "Reprendre" at the plan limit stays selectable: it opens "Réactiver et échanger"
      c.actions?.map((a) => (a.key === 'resume' && manage && needsSwap(c) ? { ...a, enabled: true } : a)),
      {
        open: { label: t('channels.action.open'), onSelect: () => router.push(`/channels/${c.id}`), local: true, hidden: o.hideOpen },
        // the API sends no descriptor for these two: shown to members who manage pages, the API checks the write
        changeAgent: { label: t(c.agent ? 'channels.action.changeAgent' : 'channels.action.linkAgent'), onSelect: () => linkAgent.pick(c), local: true, hidden: !manage || c.status === 'disconnected' },
        reconnect: { label: t('channels.action.reconnect'), onSelect: () => void o.connect.reconnect(c) },
        syncInfo: { label: t('channels.action.syncInfo'), onSelect: () => void syncInfo(c) },
        analysis: { label: t('channels.action.analysis'), onSelect: () => router.push(`/channels/${c.id}/analysis`), local: true, hidden: !manage || c.status === 'disconnected' },
        // state-aware items: pause on an active page, resume / re-enable on a paused or disabled one
        pause: { label: t('action.pause'), onSelect: () => void pause(c), hidden: c.status !== 'active' },
        resume: { label: c.status === 'disabled' ? t('action.enable') : t('action.resume'), onSelect: () => void resume(c), hidden: c.status !== 'paused' && c.status !== 'disabled' },
        approval: { label: t('channels.action.approvalStatus'), onSelect: () => setOpen({ kind: 'approval', channel: c }), local: true, hidden: c.status !== 'pending_review' },
        conversations: { label: t('channels.action.conversations'), onSelect: () => router.push(`/inbox?channel=${c.id}`), local: true },
        disconnect: { label: t('channels.action.disconnect'), onSelect: () => setOpen({ kind: 'disconnect', channel: c }), destructive: true, separated: true },
      },
      t,
    );

  /** The one explicit button of the state strip (Reconnecter / Reprendre / Réactiver), for members who manage pages. */
  const strip = (c: Channel) => {
    if (!manage) return undefined;
    const state = cardState(c);
    const key = state === 'needs_reconnect' || state === 'disconnected' ? 'reconnect' : state === 'paused_plan' || state === 'paused' || state === 'disabled' ? 'resume' : null;
    if (!key) return undefined;
    const d = actionState(c.actions, key, t);
    return {
      label: key === 'reconnect' ? t('action.reconnect') : state === 'disabled' ? t('action.enable') : t('action.resume'),
      onClick: () => void (key === 'reconnect' ? o.connect.reconnect(c) : resume(c)),
      loading: busy === `resume:${c.id}`,
      disabledReason: d.present && !d.enabled && !(key === 'resume' && needsSwap(c)) ? d.reason : undefined,
      primary: state === 'needs_reconnect',
    };
  };

  const dialogs: ReactNode = (
    <>
      <DisconnectDialog
        channel={open?.kind === 'disconnect' ? open.channel : null}
        onClose={close}
        onDone={async (c) => {
          close();
          await refresh(c.id);
          toast(t('channels.toast.disconnected', { name: c.name }));
          o.onDisconnected?.(c);
        }}
      />
      <SwapDialog
        channel={open?.kind === 'swap' ? open.channel : null}
        channels={list.data?.rows ?? []}
        planLimit={list.data?.planLimit ?? null}
        onClose={close}
        onDone={async (c) => {
          close();
          await refresh(c.id);
          toast(t('channels.toast.resumed', { name: c.name }));
        }}
      />
      <ApprovalDialog channel={open?.kind === 'approval' ? open.channel : null} onClose={close} />
      {linkAgent.dialogs}
    </>
  );

  return {
    menu,
    strip,
    dialogs,
    manage,
    busy,
    /** agent linking of a page: `link.pick(channel)` opens the picker, `link.link(channel, agentId | null)` writes */
    link: linkAgent,
    resume,
    pause,
    syncInfo,
    disconnect: (c: Channel) => setOpen({ kind: 'disconnect', channel: c }),
    approval: (c: Channel) => setOpen({ kind: 'approval', channel: c }),
    /** descriptor of one action for a button outside the menu */
    descriptor: (c: Channel, key: string) => c.actions?.find((a) => a.key === key),
  };
}
export type ChannelActions = ReturnType<typeof useChannelActions>;

/** DLG "Déconnecter « … » ?": the three consequences, destructive button on the end side. */
function DisconnectDialog({ channel, onClose, onDone }: { channel: Channel | null; onClose: () => void; onDone: (c: Channel) => void }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!channel) return;
    setPending(true);
    setError(null);
    try {
      await channelsApi.disconnect(channel.id);
      onDone(channel);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setError(null);
          onClose();
        }
      }}
      title={t('dialog.disconnectChannel.title', { name: channel?.name ?? '' })}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} data-testid="disconnect-confirm">
            {t('action.disconnect')}
          </Button>
        </>
      }
    >
      {channel ? (
        <>
          <div className="flex flex-wrap items-center gap-2 ts-label-meta text-text-muted">
            <Pill tone="danger" className="!rounded-[4px]">
              {t('common.destructive')}
            </Pill>
            <span>
              {t(`channels.platform.${channel.platform}`)} ·{' '}
              {channel.agent ? t('channels.disconnect.agent', { name: channel.agent.name }) : t('channels.agent.none')} ·{' '}
              <Ltr>{t('channels.disconnect.conversations', { count: channel.counts.conversations, n: formatNumber(channel.counts.conversations) })}</Ltr>
            </span>
          </div>
          <ul className="mt-4 flex list-disc flex-col gap-3 ps-4 text-[13px] text-text-secondary">
            {[1, 2, 3].map((n) => (
              <li key={n}>{t(`channels.disconnect.consequence${n}`)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <FormAlert className="mt-4">{error}</FormAlert> : null}
    </Dialog>
  );
}

/** DLG "Réactiver « … »" at the plan limit: choose the active page to pause instead, or compare the plans. */
function SwapDialog({ channel, channels, planLimit, onClose, onDone }: { channel: Channel | null; channels: Channel[]; planLimit: { limit: number; current: number } | null; onClose: () => void; onDone: (c: Channel) => void }) {
  const t = useT();
  const { workspace } = useSession();
  const candidates = channel ? swapCandidates(channels, channel.id) : [];
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swapId = picked && candidates.some((c) => c.id === picked) ? picked : (candidates[0]?.id ?? null);
  const submit = async () => {
    if (!channel || !swapId) return;
    setPending(true);
    setError(null);
    try {
      await (channel.status === 'disabled' ? channelsApi.enable(channel.id, { swapWithChannelId: swapId }) : channelsApi.setStatus(channel.id, { status: 'active', swapWithChannelId: swapId }));
      setPicked(null);
      onDone(channel);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setError(null);
          setPicked(null);
          onClose();
        }
      }}
      title={t('dialog.resumeSwap.title', { name: channel?.name ?? '' })}
      description={planLimit ? t('channels.swap.plan', { plan: workspace?.plan?.name ?? '—', current: planLimit.current, limit: planLimit.limit }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          <Link href="/settings/billing" className={buttonClass({ variant: 'ghost' })}>
            {t('action.comparePlans')}
          </Link>
          <Button variant="primary" onClick={submit} loading={pending} disabledReason={swapId ? undefined : t('channels.swap.none')} data-testid="swap-confirm">
            {t('channels.swap.submit')}
          </Button>
        </>
      }
    >
      <FormAlert tone="warning">{t('channels.swap.warning')}</FormAlert>
      <div role="radiogroup" aria-label={t('channels.swap.choose')} className="mt-4 flex flex-col gap-1">
        {candidates.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-card px-2 py-2 text-[13px] hover:bg-ink-raised">
            <input type="radio" name="swap" value={c.id} checked={swapId === c.id} onChange={() => setPicked(c.id)} className="size-4 accent-white" />
            <span className="min-w-0 flex-1">
              {t('channels.swap.option', { name: c.name })}{' '}
              <Ltr className="text-text-muted">{t('channels.swap.optionCounts', { conversations: formatNumber(c.counts.conversations), messages: formatNumber(c.counts.messages7d) })}</Ltr>
            </span>
          </label>
        ))}
        {candidates.length === 0 ? <p className="text-[13px] text-text-muted">{t('channels.swap.none')}</p> : null}
      </div>
      {error ? <FormAlert className="mt-4">{error}</FormAlert> : null}
    </Dialog>
  );
}

/** "Voir l'état de l'approbation": Meta App Review status of the permissions the page waits for (CHN-11). */
export function ApprovalDialog({ channel, open, onClose }: { channel?: Channel | null; open?: boolean; onClose: () => void }) {
  const t = useT();
  const shown = open ?? !!channel;
  const q = useAppReviewStatus(shown);
  return (
    <Dialog
      open={shown}
      onOpenChange={(o) => !o && onClose()}
      title={t('channels.approval.title')}
      description={channel ? t('banner.approvalPending', { account: channel.name }) : t('channels.approval.description')}
      closeLabel={t('action.close')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('action.ok')}
        </Button>
      }
    >
      {q.isPending ? (
        <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <FormAlert>{errorMessage(q.error, t)}</FormAlert>
      ) : (
        <ul data-testid="approval-permissions" className="flex flex-col gap-3">
          {q.data.permissions.map((p) => (
            <li key={p.scope} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">{p.feature}</div>
                <div className="ts-label-meta mt-0.5 text-text-muted">
                  <Ltr>{p.scope}</Ltr>
                </div>
              </div>
              <Pill tone={p.status === 'approved' ? 'success' : p.status === 'rejected' ? 'danger' : p.status === 'in_review' ? 'warning' : 'neutral'} className="!rounded-[4px]">
                {t(`channels.approval.status.${p.status}`)}
              </Pill>
            </li>
          ))}
          {q.data.permissions.length === 0 ? <li className="text-[13px] text-text-muted">{t(q.data.approved ? 'channels.approval.allApproved' : 'channels.approval.description')}</li> : null}
        </ul>
      )}
    </Dialog>
  );
}
