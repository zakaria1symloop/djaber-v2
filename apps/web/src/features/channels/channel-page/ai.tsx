'use client';
// /channels/[id]/ai — Figma "CHN-07b — … IA & agent": the agent that answers on this page with "Changer ⌄" /
// "Détacher" (or none: "Rattacher un agent" / "Créer un agent"), the icebreaker of the page, and the welcome message
// sent before the first AI reply (workspace system message `welcome`, edited in Settings › Messages système).
// `PUT /channels/:id/agent` (move confirmation in `link-agent.tsx`), `PUT /channels/:id/icebreaker`.
import { Button, buttonClass, Card, ConfirmDialog, FormAlert, Ltr, StatusPill, Textarea, toast } from '@djaber/ui';
import type { AppLocale } from '@djaber/shared';
import { Bot, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { channelsApi, useChannelsRefresh } from '../api';
import { useChannelPage } from './channel-shell';

export const ICEBREAKER_MAX = 300;

export function ChannelAi() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const { channel: c, actions } = useChannelPage();
  const { workspace, can } = useSession();
  const manage = actions.manage;
  const link = actions.link;
  const busy = link.busy === c.id;
  // `{shop}` is the workspace name in the message the customer receives
  const welcome = (workspace?.systemMessages?.welcome?.[locale]?.trim() || workspace?.systemMessages?.welcome?.fr?.trim() || '').replaceAll('{shop}', workspace?.name ?? '');
  const live = c.status === 'active' && c.agent?.status === 'active';
  const gone = c.status === 'disconnected';
  const lockedReason = gone ? t('channels.ai.disconnected') : undefined;
  // "Détacher" stops the AI on this page for the new conversations: asked first, locked like "Changer"
  const [detach, setDetach] = useState(false);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Card className="flex flex-col gap-4 p-4" data-testid="channel-ai">
          <h2 className="ts-title">{t('channels.page.tab.ai')}</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-line-edge bg-ink-raised px-3.5 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-card border border-line-edge bg-ink-surface text-text-secondary">
              <Bot className="size-4" aria-hidden />
            </span>
            {c.agent ? (
              <>
                <div className="min-w-0 flex-1" data-testid="channel-ai-agent" data-agent={c.agent.id}>
                  <Link href={`/agents/${c.agent.id}`} className="block truncate text-[14px] font-medium hover:underline">
                    {c.agent.name}
                  </Link>
                  <div className="ts-label-meta mt-0.5 text-text-muted">
                    <Ltr>{t('channels.overview.agentProducts', { count: c.counts.productsInScope })}</Ltr>
                  </div>
                </div>
                <StatusPill enumKey="Agent.status" value={c.agent.status} className="!rounded-[4px]">
                  {t(`enum.Agent.status.${c.agent.status}`)}
                </StatusPill>
              </>
            ) : (
              <p className="min-w-0 flex-1 text-[13px] text-text-secondary" data-testid="channel-ai-none">
                {t('channels.ai.noneDescription')}
              </p>
            )}
          </div>
          {manage ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="channel-ai-actions">
              {c.agent ? (
                <>
                  <Button size="sm" onClick={() => link.pick(c)} disabled={busy} disabledReason={lockedReason} data-testid="agent-change">
                    {t('channels.ai.change')}
                    <ChevronDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetach(true)} loading={busy} disabledReason={lockedReason} data-testid="agent-detach">
                    {t('channels.ai.detach')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="primary" onClick={() => link.pick(c)} disabled={busy} disabledReason={lockedReason} data-testid="agent-attach">
                    {t('channels.ai.attach')}
                  </Button>
                  {can('agents.manage') ? (
                    <Link href={`/agents/new?channel=${c.id}`} className={buttonClass({ size: 'sm' })} data-testid="agent-create">
                      {t('channels.ai.createAgent')}
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <p className="ts-label-meta text-text-muted" data-testid="channel-ai-readonly">
              {t('channels.ai.readOnly')}
            </p>
          )}
          <p className="text-[13px]" data-testid="channel-ai-live">
            <span className={live ? 'text-signal-live' : 'text-text-muted'}>{t(live ? 'channels.ai.liveOn' : 'channels.ai.liveOff')}</span>
          </p>
          <FormAlert tone="info">
            {t('error.AGENT_CHANNEL_SWITCH_NEXT_THREAD')}
          </FormAlert>
        </Card>
        <IcebreakerCard key={c.id} channelId={c.id} pageName={c.name} value={c.icebreaker ?? ''} manage={manage} lockedReason={lockedReason} />
      </div>
      <ConfirmDialog
        open={detach}
        onOpenChange={(o) => !o && !busy && setDetach(false)}
        title={t('gaps.channels.detach.title', { agent: c.agent?.name ?? '' })}
        description={t('gaps.channels.detach.description', { page: c.name })}
        confirmLabel={t('channels.ai.detach')}
        cancelLabel={t('action.cancel')}
        destructive
        loading={busy}
        closeLabel={t('action.close')}
        onConfirm={() => void link.link(c, null).then(() => setDetach(false))}
      />

      <Card className="flex flex-col gap-3 p-4" data-testid="channel-welcome">
        <h2 className="ts-title">{t('channels.ai.welcome.title')}</h2>
        {welcome ? (
          <blockquote dir="auto" className="rounded-card border border-line-edge bg-ink-raised px-3.5 py-3 text-[13px]">
            {welcome}
          </blockquote>
        ) : (
          <p className="text-[13px] text-text-muted">{t('channels.ai.welcome.empty')}</p>
        )}
        <p className="ts-label-meta text-text-muted">{t('channels.ai.welcome.note')}</p>
        {can('workspace.settings') ? (
          <Link href="/settings/system-messages" className={buttonClass({ size: 'sm', className: 'w-fit' })}>
            {t('channels.ai.welcome.edit')}
          </Link>
        ) : null}
      </Card>
    </div>
  );
}

/** Icebreaker of the page: the opening line Messenger / Instagram shows before the first message (≤ 300, empty = none). */
function IcebreakerCard({ channelId, pageName, value, manage, lockedReason }: { channelId: string; pageName: string; value: string; manage: boolean; lockedReason?: string }) {
  const t = useT();
  const refresh = useChannelsRefresh();
  const [text, setText] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => setText(value), [value]);
  const dirty = text.trim() !== value.trim();
  // an unsaved icebreaker is not lost by leaving the page
  const { guard } = useLeaveGuard(manage && dirty && !pending, pageName);
  const tooLong = text.trim().length > ICEBREAKER_MAX;
  const save = async (next: string) => {
    setPending(true);
    setError(null);
    try {
      await channelsApi.setIcebreaker(channelId, next.trim());
      await refresh(channelId);
      toast(next.trim() ? t('channels.icebreaker.saved') : t('channels.icebreaker.cleared'));
      setClearing(false);
    } catch (e) {
      setError(errorMessage(e, t));
      setClearing(false);
    } finally {
      setPending(false);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="channel-icebreaker">
      <h2 className="ts-title">{t('channels.icebreaker.title')}</h2>
      <p className="text-[13px] text-text-secondary">{t('channels.icebreaker.description')}</p>
      {manage ? (
        <>
          <Textarea
            dir="auto"
            aria-label={t('channels.icebreaker.title')}
            aria-invalid={tooLong || undefined}
            value={text}
            disabled={pending || !!lockedReason}
            title={lockedReason}
            placeholder={t('channels.icebreaker.placeholder')}
            onChange={(e) => setText(e.target.value)}
            className="min-h-20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className={`ts-label-meta tabular-nums ${tooLong ? 'text-accent-alert' : 'text-text-muted'}`} data-testid="icebreaker-count">
              <Ltr>
                {text.trim().length} / {ICEBREAKER_MAX}
              </Ltr>
            </span>
            <span className="flex-1" />
            {dirty ? (
              <Button size="sm" variant="ghost" onClick={() => (setText(value), setError(null))} disabled={pending} data-testid="icebreaker-cancel">
                {t('action.cancel')}
              </Button>
            ) : null}
            {value ? (
              <Button size="sm" variant="ghost" onClick={() => setClearing(true)} disabled={pending} disabledReason={lockedReason} data-testid="icebreaker-clear">
                {t('channels.icebreaker.clear')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save(text)}
              loading={pending}
              disabled={!dirty}
              disabledReason={lockedReason ?? (tooLong ? t('validation.length', { max: ICEBREAKER_MAX }) : undefined)}
              data-testid="icebreaker-save"
            >
              {t('action.save')}
            </Button>
          </div>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <ConfirmDialog
            open={clearing}
            onOpenChange={(o) => !o && !pending && setClearing(false)}
            title={t('gaps.channels.icebreaker.clear.title')}
            description={t('gaps.channels.icebreaker.clear.description')}
            confirmLabel={t('channels.icebreaker.clear')}
            cancelLabel={t('action.cancel')}
            destructive
            loading={pending}
            closeLabel={t('action.close')}
            onConfirm={() => void save('')}
          />
          {guard}
        </>
      ) : value ? (
        <blockquote dir="auto" className="rounded-card border border-line-edge bg-ink-raised px-3.5 py-3 text-[13px]">
          {value}
        </blockquote>
      ) : (
        <p className="text-[13px] text-text-muted">{t('channels.icebreaker.empty')}</p>
      )}
    </Card>
  );
}
