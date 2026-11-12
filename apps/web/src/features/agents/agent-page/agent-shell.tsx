'use client';
// /agents/[id] — frame of the agent page (Figma "AGT-03 — Agent page — overview (tabs, versions, rollback)"): avatar,
// name, status + version pills, channels · languages · capabilities, "Actif" switch, Tester, Modifier, actions menu,
// tabs Vue d'ensemble · Configuration · Insights n · Bac à essai (02-next-route-map §1 `AgentTabs`). The tab routes
// render inside it and read the agent from the context. A draft has no page: it resumes in the wizard.
import { ActionsMenu, AgentAvatar, Banner, buttonClass, cn, Ltr, MonoChip, Skeleton, Switch } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { useAgent } from '../api';
import type { Agent } from '../contracts';
import { cardState, enabledCapabilities, draftFromAgent, resumePath } from '../logic';
import { AgentStatusPill, channelLabel } from '../ui';
import { useAgentActions, type AgentActions } from '../use-agent-actions';

type Ctx = { agent: Agent; actions: AgentActions };
const AgentCtx = createContext<Ctx | null>(null);
export const useAgentPage = (): Ctx => {
  const v = useContext(AgentCtx);
  if (!v) throw new Error('useAgentPage must be used inside <AgentShell>');
  return v;
};

export const AGENT_TABS = [
  { key: 'overview', path: '', permission: 'agents.read' },
  { key: 'configuration', path: '/configuration', permission: 'agents.read' },
  { key: 'insights', path: '/insights', permission: 'insights.manage' },
  { key: 'playground', path: '/playground', permission: 'agents.test' },
] as const;

export function AgentShell({ id, children }: { id: string; children: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useSession();
  const q = useAgent(id);
  const actions = useAgentActions({ hideOpen: true, onDeleted: () => router.push('/agents') });
  const back = { href: '/agents', label: t('nav.agents') };
  const a = q.data;
  const draftTo = a?.status === 'draft' ? resumePath(a) : null;
  useEffect(() => {
    if (draftTo) router.replace(draftTo);
  }, [draftTo, router]);

  if (!a || draftTo) {
    return (
      <AppPage wide permission="agents.read" back={back} title={t('nav.agents')}>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}/agents`} />
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

  const base = `/agents/${a.id}`;
  const state = cardState(a);
  const draft = draftFromAgent(a);
  const facts = [...a.channels.map(channelLabel), ...draft.languages.map((l) => t(`agents.language.tag.${l}`)), ...enabledCapabilities(draft).map((c) => t(`agents.capability.tag.${c}`))];
  const tabs = AGENT_TABS.filter((tab) => can(tab.permission));

  return (
    <AgentCtx.Provider value={{ agent: a, actions }}>
      <AppPage
        wide
        // the playground chat fills the height left under the header (composer always on screen)
        fill={pathname === `${base}/playground`}
        permission="agents.read"
        back={back}
        title={a.name}
        badges={
          <>
            <AgentStatusPill agent={a} />
            <MonoChip>
              <span data-testid="agent-version">
                <Ltr>V{a.currentVersion}</Ltr>
                {a.updatedAt ? ` · ${t('agents.page.modified', { ago: relativeTime(a.updatedAt, locale) })}` : ''}
              </span>
            </MonoChip>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="agent-facts">
            <AgentAvatar name={draft.displayName || a.name} src={a.wizard?.avatarMode === 'upload' ? a.wizard.avatarUrl : null} size={24} />
            {facts.length ? facts.join(' · ') : t('agents.card.noChannel.label')}
          </span>
        }
        actions={
          <>
            {actions.manage && a.pausedReason !== 'plan' ? (
              <span className="flex items-center gap-2 ts-label-meta text-text-muted">
                {t('agents.card.active')}
                <Switch checked={a.status === 'active'} label={t('agents.card.activeToggle', { name: a.name })} disabled={actions.busy === `resume:${a.id}`} onCheckedChange={(on) => (on ? void actions.resume(a) : actions.pause(a))} />
              </span>
            ) : null}
            {actions.canTest ? (
              <Link href={`${base}/playground`} className={buttonClass()}>
                {t('action.test')}
              </Link>
            ) : null}
            {actions.manage ? (
              <Link href={`${base}/configuration`} className={buttonClass({ variant: 'primary' })}>
                {t('action.edit')}
              </Link>
            ) : null}
            <ActionsMenu label={t('action.actions')} actions={actions.menu(a)} heading={actions.heading(a)} size="md" />
          </>
        }
      >
        {state === 'paused' ? (
          <Banner tone="warning" action={actions.manage ? { label: t('action.resume'), onClick: () => void actions.resume(a) } : undefined}>
            <span data-testid="agent-paused-banner">{t('agents.page.paused')}</span>
          </Banner>
        ) : state === 'paused_plan' ? (
          <Banner tone="warning" action={can('billing.read') ? { label: t('action.comparePlans'), href: `/${locale}/settings/billing` } : undefined}>
            <span data-testid="agent-paused-banner">{t('agents.card.pausedPlan')}</span>
          </Banner>
        ) : a.channels.length === 0 ? (
          <Banner tone="warning" action={actions.manage ? { label: t('agents.card.noChannel.link'), href: `/${locale}${base}/configuration?section=channels` } : undefined}>
            {t('error.AGENT_NO_CHANNEL')}
          </Banner>
        ) : null}
        <nav aria-label={t('agents.page.tabs')} className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => {
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
                {t(`agents.page.tab.${tab.key}`)}
                {tab.key === 'insights' ? <Ltr className="ms-1.5 tabular-nums">{formatNumber(a.pendingInsights)}</Ltr> : null}
              </Link>
            );
          })}
          {/* AGT-03 tabs Conversations / Commandes: views of the inbox and of the orders list filtered by this agent */}
          {can('inbox.read') ? (
            <Link href={`/inbox?agentId=${a.id}`} data-testid="agent-tab-conversations" className="flex h-8 items-center gap-1 rounded-card border border-line-edge bg-ink-surface px-3 text-[13px] text-text-secondary transition-colors hover:text-text-primary">
              {t('agents.page.tab.conversations')}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
          {can('orders.read') ? (
            <Link href={`/orders?source=ai&agentId=${a.id}`} data-testid="agent-tab-orders" className="flex h-8 items-center gap-1 rounded-card border border-line-edge bg-ink-surface px-3 text-[13px] text-text-secondary transition-colors hover:text-text-primary">
              {t('agents.page.tab.orders')}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </nav>
        {children}
        {actions.dialogs}
      </AppPage>
    </AgentCtx.Provider>
  );
}
