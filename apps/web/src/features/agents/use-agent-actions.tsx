'use client';
// `Actions ⌄` of one agent with its dialogs, shared by the cards of `/agents` and the header of `/agents/[id]`
// (Figma "MECH — Agents filters + row menu", "AGT-03" actions menu, "DLG — Agents & channels": Supprimer l'agent,
// Mettre en pause, Lien de test, limite du plan). Items come from the server `actions` descriptors: a forbidden one
// stays visible, greyed, with its reason; navigation items are local.
import { Button, buttonClass, Checkbox, Dialog, Field, FormAlert, Input, Ltr, Pill, toast, type MenuAction } from '@djaber/ui';
import { formatDateTime, type ActionDescriptor, type AppLocale } from '@djaber/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { downloadUrl } from '@/lib/jobs';
import { useSession } from '@/lib/session';
import { agentsApi, useAgentsRefresh } from './api';
import type { Agent, PlanLimit, TestLink } from './contracts';
import { resumePath } from './logic';
import { agentStateLabel } from './ui';
import { cardState } from './logic';

type Open = { kind: 'delete' | 'pause' | 'link'; agent: Agent } | { kind: 'limit'; agent: Agent | null; limit: PlanLimit | null };

export const isPlanLimit = (e: unknown) => e instanceof ApiError && e.code === 'PLAN_LIMIT';

/**
 * Descriptors of an agent. The API sends them on every row; a row without any (older cache entry) falls back to what
 * the status allows for a member who manages agents — the API still refuses what it must.
 */
export const agentDescriptors = (a: Agent, manage: boolean, canTest: boolean): ActionDescriptor[] => {
  if (a.actions?.length) return a.actions;
  const out: ActionDescriptor[] = [];
  if (canTest) out.push({ key: 'test', enabled: true });
  if (manage) {
    out.push({ key: 'edit', enabled: true, primary: true });
    if (a.status === 'active') out.push({ key: 'pause', enabled: true });
    if (a.status === 'paused') out.push({ key: 'resume', enabled: a.pausedReason !== 'plan', reasonCode: a.pausedReason === 'plan' ? 'PLAN_LIMIT' : undefined });
    out.push({ key: 'duplicate', enabled: true }, { key: 'export', enabled: true }, { key: 'testLink', enabled: true });
    out.push({ key: 'delete', enabled: a.channels.length === 0, reasonCode: a.channels.length ? 'AGENT_HAS_CHANNELS' : undefined });
  }
  return out;
};

/** Downloads a JSON document built in the page (configuration export, playground export). */
export function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  downloadUrl(url, fileName);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40) || 'agent';

export function useAgentActions(o: { planLimit?: PlanLimit | null; /** the page already shows the agent: no "Ouvrir" item */ hideOpen?: boolean; onDeleted?: (a: Agent) => void } = {}) {
  const t = useT();
  const router = useRouter();
  const refresh = useAgentsRefresh();
  const { can } = useSession();
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => setOpen(null);
  const manage = can('agents.manage');
  const canTest = can('agents.test');

  const run = async (a: Agent, key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(`${key}:${a.id}`);
    try {
      const result = await fn();
      await refresh(a.id);
      toast(done);
      return result;
    } catch (e) {
      if (isPlanLimit(e)) setOpen({ kind: 'limit', agent: a, limit: o.planLimit ?? null });
      else toast({ tone: 'danger', message: errorMessage(e, t) });
      void refresh(a.id);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const resume = (a: Agent) => run(a, 'resume', () => agentsApi.resume(a.id), t('agents.toast.resumed', { name: a.name }));
  const duplicate = async (a: Agent) => {
    const copy = (await run(a, 'duplicate', () => agentsApi.duplicate(a.id), t('agents.toast.duplicated', { name: a.name }))) as Agent | null;
    if (copy?.id) router.push(resumePath(copy));
  };
  const exportConfig = async (a: Agent) => {
    setBusy(`export:${a.id}`);
    try {
      downloadJson(await agentsApi.exportConfig(a.id), `agent-${slug(a.name)}-v${a.currentVersion}.json`);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };
  const editHref = (a: Agent) => (a.status === 'draft' ? resumePath(a) : `/agents/${a.id}/configuration`);

  /** Items in the order of the MECH frame. Keys = the server descriptor keys. */
  const menu = (a: Agent): MenuAction[] =>
    toMenuActions(
      agentDescriptors(a, manage, canTest),
      {
        open: { label: t('agents.action.open'), onSelect: () => router.push(`/agents/${a.id}`), local: true, hidden: o.hideOpen || a.status === 'draft' },
        test: { label: t('agents.action.test'), onSelect: () => router.push(`/agents/${a.id}/playground`), hidden: !canTest },
        edit: { label: a.status === 'draft' ? t('agents.action.resumeDraft') : t('agents.action.edit'), onSelect: () => router.push(editHref(a)), hidden: !manage },
        activate: { label: t('agents.action.activate'), onSelect: () => router.push(`/agents/new/activate?draft=${a.id}`), hidden: !manage || a.status !== 'draft' },
        pause: { label: t('action.pause'), onSelect: () => setOpen({ kind: 'pause', agent: a }), hidden: !manage || a.status !== 'active' },
        resume: { label: t('action.resume'), onSelect: () => void resume(a), hidden: !manage || a.status !== 'paused' },
        duplicate: { label: t('action.duplicate'), onSelect: () => void duplicate(a), hidden: !manage },
        conversations: { label: t('agents.action.conversations'), onSelect: () => router.push(`/inbox?agentId=${a.id}`), local: true, hidden: a.status === 'draft' || !can('inbox.read') },
        orders: { label: t('agents.action.orders'), onSelect: () => router.push(`/orders?source=ai&agentId=${a.id}`), local: true, hidden: a.status === 'draft' || !can('orders.read') },
        insights: { label: t('agents.action.insights', { count: a.pendingInsights }), onSelect: () => router.push(`/agents/${a.id}/insights`), local: true, hidden: a.status === 'draft' || !can('insights.manage') },
        // no server descriptor for these two: always possible for a member who manages agents (the API checks the key)
        export: { label: t('agents.action.export'), onSelect: () => void exportConfig(a), hidden: !manage, local: true },
        testLink: { label: t('agents.action.testLink'), onSelect: () => setOpen({ kind: 'link', agent: a }), hidden: !manage || a.status === 'draft', local: true },
        delete: { label: t('action.delete'), onSelect: () => setOpen({ kind: 'delete', agent: a }), destructive: true, separated: true, hidden: !manage },
      },
      t,
    );

  const dialogs: ReactNode = (
    <>
      <DeleteAgentDialog
        agent={open?.kind === 'delete' ? open.agent : null}
        onClose={close}
        onDone={async (a) => {
          close();
          await refresh(a.id);
          toast(t('agents.toast.deleted', { name: a.name }));
          o.onDeleted?.(a);
        }}
      />
      <PauseAgentDialog
        agent={open?.kind === 'pause' ? open.agent : null}
        onClose={close}
        onDone={async (a) => {
          close();
          await refresh(a.id);
          toast(t('agents.toast.paused', { name: a.name }));
        }}
      />
      <TestLinkDialog agent={open?.kind === 'link' ? open.agent : null} onClose={close} />
      <PlanLimitDialog open={open?.kind === 'limit'} limit={open?.kind === 'limit' ? open.limit : null} canDraft={open?.kind === 'limit' && open.agent === null} onClose={close} />
    </>
  );

  return {
    menu,
    dialogs,
    manage,
    canTest,
    busy,
    resume,
    editHref,
    pause: (a: Agent) => setOpen({ kind: 'pause', agent: a }),
    remove: (a: Agent) => setOpen({ kind: 'delete', agent: a }),
    testLink: (a: Agent) => setOpen({ kind: 'link', agent: a }),
    /** plan dialog: on "+ Nouvel agent" at the limit (a draft stays possible) or after a refused activation */
    limit: (agent: Agent | null = null) => setOpen({ kind: 'limit', agent, limit: o.planLimit ?? null }),
    heading: (a: Agent) => `${a.name} · ${agentStateLabel(t, cardState(a))}`,
  };
}
export type AgentActions = ReturnType<typeof useAgentActions>;

/** DLG "Supprimer l'agent « … » ?": typed name; with pages attached the server answers AGENT_HAS_CHANNELS. */
function DeleteAgentDialog({ agent, onClose, onDone }: { agent: Agent | null; onClose: () => void; onDone: (a: Agent) => void }) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; channels: boolean } | null>(null);
  useEffect(() => {
    setTyped('');
    setError(null);
  }, [agent?.id]);
  const matches = !!agent && typed.trim() === agent.name.trim();
  const submit = async () => {
    if (!agent || !matches) return;
    setPending(true);
    setError(null);
    try {
      await agentsApi.remove(agent.id);
      onDone(agent);
    } catch (e) {
      setError({ message: errorMessage(e, t), channels: e instanceof ApiError && e.code === 'AGENT_HAS_CHANNELS' });
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('dialog.deleteAgent.title', { name: agent?.name ?? '' })}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={!matches} data-testid="delete-agent-confirm">
            {t('action.delete')}
          </Button>
        </>
      }
    >
      {agent ? (
        <div className="flex flex-col gap-4" data-testid="delete-agent">
          <div className="flex flex-wrap items-center gap-2 ts-label-meta text-text-muted">
            <Pill tone="danger" className="!rounded-[4px]">
              {t('common.destructive')}
            </Pill>
            <span>
              {agentStateLabel(t, cardState(agent))} · <Ltr>{t('agents.delete.channels', { count: agent.channels.length })}</Ltr>
            </span>
          </div>
          <p className="text-[13px] text-text-secondary">{t('agents.delete.description', { count: agent.pendingInsights })}</p>
          <Field label={t('common.typeNameToConfirm')} htmlFor="delete-agent-name" hint={t('common.mustMatch')}>
            <Input id="delete-agent-name" dir="auto" autoComplete="off" value={typed} placeholder={agent.name} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          </Field>
          {error ? (
            <FormAlert>
              {error.message}
              {error.channels ? (
                <>
                  {' '}
                  <Link href={`/agents/${agent.id}/configuration?section=channels`} className="underline">
                    {t('agents.action.changeChannels')}
                  </Link>
                </>
              ) : null}
            </FormAlert>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * DLG "Mettre en pause « … »": the first call is sent without `confirm`; when conversations await a reply the server
 * answers `409 AGENT_PAUSED_WITH_OPEN_THREADS {count}` (a confirmation flag, not an error): the dialog shows the count
 * and the second click confirms.
 */
function PauseAgentDialog({ agent, onClose, onDone }: { agent: Agent | null; onClose: () => void; onDone: (a: Agent) => void }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [openThreads, setOpenThreads] = useState<number | null>(null);
  const [sendOutOfHours, setSendOutOfHours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpenThreads(null);
    setSendOutOfHours(false);
    setError(null);
  }, [agent?.id]);
  const submit = async () => {
    if (!agent) return;
    setPending(true);
    setError(null);
    try {
      // `sendOutOfHours` only when ticked (the default is false on the API side)
      const extra = sendOutOfHours ? { sendOutOfHours: true } : {};
      await agentsApi.pause(agent.id, openThreads !== null ? { confirm: true, ...extra } : extra);
      onDone(agent);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AGENT_PAUSED_WITH_OPEN_THREADS') setOpenThreads(Number(e.body.params.count ?? 0));
      else setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('dialog.pauseAgent.title', { name: agent?.name ?? '' })}
      description={agent ? t('agents.pause.context', { channels: agent.channels.length }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} data-testid="pause-agent-confirm">
            {openThreads !== null ? t('agents.pause.confirm') : t('action.pause')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="pause-agent">
        <p className="text-[13px] text-text-secondary">{t('agents.pause.description')}</p>
        {openThreads !== null ? (
          <FormAlert tone="warning">
            <span data-testid="pause-open-threads">{t('error.AGENT_PAUSED_WITH_OPEN_THREADS', { count: openThreads })}</span>
          </FormAlert>
        ) : null}
        {/* AGV-07: the workspace `out_of_hours` system message is sent once to every open thread moved to « À traiter » */}
        <label className="flex items-start gap-2 text-[13px]">
          <Checkbox className="mt-0.5 shrink-0" checked={sendOutOfHours} disabled={pending} onChange={(e) => setSendOutOfHours(e.target.checked)} data-testid="pause-send-out-of-hours" />
          <span>
            {t('carry.agents.pause.sendOutOfHours')}
            <span className="ts-label-meta block text-text-muted">{t('carry.agents.pause.sendOutOfHoursHint')}</span>
          </span>
        </label>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/** DLG "Lien de test": a public page valid 24 h (`/agent-test/[token]`), created when the dialog opens. */
export function TestLinkDialog({ agent, onClose }: { agent: Pick<Agent, 'id' | 'name'> | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const [link, setLink] = useState<TestLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = agent?.id ?? null;
  useEffect(() => {
    setLink(null);
    setError(null);
  }, [id]);
  const create = async () => {
    if (!id) return;
    setPending(true);
    setError(null);
    try {
      setLink(await agentsApi.testLink(id));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(t('toast.copied'));
    } catch {
      toast({ tone: 'danger', message: t('agents.testLink.copyFailed') });
    }
  };
  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('agents.testLink.title')}
      description={agent ? t('agents.testLink.context', { name: agent.name }) : undefined}
      closeLabel={t('action.close')}
      footer={
        link ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('action.close')}
            </Button>
            <Button variant="primary" onClick={copy} data-testid="test-link-copy">
              {t('action.copy')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={create} loading={pending} data-testid="test-link-create">
              {t('agents.testLink.create')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3" data-testid="test-link">
        <p className="text-[13px] text-text-secondary">{t('agents.testLink.description')}</p>
        {link ? (
          <>
            <Field label={t('agents.testLink.url')} htmlFor="test-link-url">
              <Input id="test-link-url" readOnly dir="ltr" value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <p className="ts-label-meta text-text-muted">{t('agents.testLink.expires', { date: formatDateTime(link.expiresAt, locale) })}</p>
          </>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/** Plan limit on agents (`PLAN_LIMIT {resource: agents}`): drafts never count, activation does. */
export function PlanLimitDialog({ open, limit, canDraft, onClose }: { open: boolean; limit: PlanLimit | null; canDraft?: boolean; onClose: () => void }) {
  const t = useT();
  const { can } = useSession();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('agents.limit.title')}
      description={limit ? t('agents.limit.ratio', { current: limit.current, limit: limit.limit }) : undefined}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          {canDraft ? (
            <Link href="/agents/new" className={buttonClass({ variant: 'ghost' })} onClick={onClose} data-testid="limit-create-draft">
              {t('agents.limit.createDraft')}
            </Link>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {t('action.close')}
            </Button>
          )}
          {can('billing.read') ? (
            <Link href="/settings/billing" className={buttonClass({ variant: 'primary' })} onClick={onClose}>
              {t('action.comparePlans')}
            </Link>
          ) : null}
        </>
      }
    >
      <p className="text-[13px] text-text-secondary" data-testid="agents-limit-dialog">
        {t('agents.limit.description')}
      </p>
    </Dialog>
  );
}
