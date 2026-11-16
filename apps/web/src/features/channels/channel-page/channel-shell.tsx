'use client';
// /channels/[id] — frame of the page (Figma "CHN-07 — Channel page — overview", "CHN-07b — … Messages · AI settings ·
// History tabs"): back link, identity, status, header actions, state strip, tabs. The tab routes render inside it and
// read the channel and its actions from the context.
import { ActionsMenu, Button, buttonClass, cn, Ltr, Skeleton } from '@djaber/ui';
import { formatDate, formatNumber, type AppLocale } from '@djaber/shared';
import { createContext, useContext, type ReactNode } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { reasonText } from '@/lib/actions';
import { useLocaleCode, useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/time';
import { useChannel } from '../api';
import { useConnectFlow, type ConnectFlow } from '../connect';
import type { Channel } from '../contracts';
import { cardState, shortExternalId } from '../logic';
import { AiState, ChannelStatusPill, cardStateLabel, PlatformMark, StateStrip } from '../ui';
import { useChannelActions, type ChannelActions } from '../use-channel-actions';

type Ctx = { channel: Channel; actions: ChannelActions; connect: ConnectFlow };
const ChannelCtx = createContext<Ctx | null>(null);
export const useChannelPage = (): Ctx => {
  const v = useContext(ChannelCtx);
  if (!v) throw new Error('useChannelPage must be used inside <ChannelShell>');
  return v;
};

/** Tabs of the page; "Analyse de la page" = CHN-08 (page analysis job + review + import). */
export const CHANNEL_TABS = [
  { key: 'overview', path: '' },
  { key: 'messages', path: '/messages' },
  { key: 'ai', path: '/ai' },
  { key: 'history', path: '/history' },
  { key: 'analysis', path: '/analysis' },
] as const;

export function ChannelShell({ id, children }: { id: string; children: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const q = useChannel(id);
  const connect = useConnectFlow();
  const actions = useChannelActions({ connect, hideOpen: true, onDisconnected: () => router.push('/channels') });
  const back = { href: '/channels', label: t('nav.channels') };
  const c = q.data;

  if (!c) {
    return (
      <AppPage wide permission="channels.read" back={back} title={t('nav.channels')}>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}/channels`} />
        ) : (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4">
            <Skeleton className="h-14 w-1/2" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-40" />
          </div>
        )}
      </AppPage>
    );
  }

  const base = `/channels/${c.id}`;
  const sync = actions.descriptor(c, 'syncInfo');
  const facts = [
    // full-test 15/11 CHANNELS-INBOX-15: « 0 abonnés » next to the Meta block « — » (unknown) is not shown
    c.followersCount ? t('channels.page.followers', { count: formatNumber(c.followersCount) }) : null,
    t('channels.page.connected', { date: formatDate(c.connectedAt, locale), name: c.connectedBy ? c.connectedBy.firstName : '—' }),
    t(c.health?.webhookSubscribed ? 'channels.page.webhooksOk' : 'channels.page.webhooksOff'),
    c.health?.lastInboundAt ? t('channels.page.lastMessage', { ago: relativeTime(c.health.lastInboundAt, locale) }) : null,
  ].filter(Boolean);

  return (
    <ChannelCtx.Provider value={{ channel: c, actions, connect }}>
      <AppPage
        wide
        permission="channels.read"
        back={back}
        title={c.name}
        badges={
          <>
            <ChannelStatusPill channel={c} />
            <AiState channel={c} />
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="channel-facts">
            <PlatformMark platform={c.platform} src={c.avatarUrl} name={c.name} size={24} />
            <span>{t(`channels.platform.${c.platform}`)}</span>
            <span aria-hidden>·</span>
            <Ltr>ID {shortExternalId(c.externalId)}</Ltr>
            {facts.map((f) => (
              <span key={f} className="contents">
                <span aria-hidden>·</span>
                <span>{f}</span>
              </span>
            ))}
          </span>
        }
        actions={
          <>
            {actions.manage && sync ? (
              <Button variant="ghost" onClick={() => void actions.syncInfo(c)} loading={actions.busy === `syncInfo:${c.id}`} disabledReason={sync.enabled ? undefined : reasonText(t, sync.reasonCode)} data-testid="sync-info">
                {t('channels.action.syncInfo')}
              </Button>
            ) : null}
            <Link href={`/inbox?channel=${c.id}`} className={buttonClass({ variant: 'primary' })}>
              {t('channels.page.openInbox')}
            </Link>
            <ActionsMenu label={t('action.actions')} actions={actions.menu(c)} heading={`${c.name} · ${cardStateLabel(t, cardState(c))}`} size="md" />
          </>
        }
      >
        <StateStrip channel={c} action={actions.strip(c)} />
        <nav aria-label={t('channels.page.tabs')} className="flex flex-wrap gap-1.5">
          {CHANNEL_TABS.map((tab) => {
            const href = `${base}${tab.path}`;
            const active = pathname === href;
            return (
              <Link
                key={tab.key}
                href={href}
                prefetch
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center rounded-card border px-3 text-[13px] transition-colors',
                  active ? 'border-white bg-white font-medium text-black' : 'border-line-edge bg-ink-surface text-text-secondary hover:text-text-primary',
                )}
              >
                {t(`channels.page.tab.${tab.key}`)}
                {tab.key === 'messages' ? <Ltr className="ms-1.5 tabular-nums">{formatNumber(c.counts.conversations)}</Ltr> : null}
              </Link>
            );
          })}
        </nav>
        {children}
        {connect.element}
        {actions.dialogs}
      </AppPage>
    </ChannelCtx.Provider>
  );
}
