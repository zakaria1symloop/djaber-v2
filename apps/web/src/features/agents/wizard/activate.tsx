'use client';
// Wizard step 5 — Figma "AGT-02 — Agent wizard — step 5 test & activate": readiness checklist (✓ / ⚠ with links),
// the 8 automatic scenarios (each opens the playground), "Tester moi-même", the 24 h test link, and the activation
// (now · keep as draft · at a date). Activation is checked by the server: `AGENT_DRAFT_INCOMPLETE {missing[]}` lists
// what to complete, `AGENT_NO_CHANNEL`, `PLAN_LIMIT {resource: agents}` (drafts never count) and
// `AUTH_EMAIL_UNVERIFIED` block it. While a readiness row is blocking (✕) "Activer maintenant" / "Activer à une date"
// are greyed with the list of what to fix; a scheduled activation can be cancelled (`DELETE /agents/:id/activate`).
// Tests are free and never touch customers or orders.
import { Button, buttonClass, Dialog, Field, FormAlert, FormSection, Input, Ltr, ReadinessRow, Skeleton, toast } from '@djaber/ui';
import { formatDateTime, type AppLocale, type TestScenarioKey } from '@djaber/shared';
import { useCallback, useEffect, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { isJobRunning, useJob } from '@/lib/jobs';
import { agentsApi, useAgentsRefresh, useReadiness, useScenarios } from '../api';
import type { Agent, ScenarioRun } from '../contracts';
import { blockingChecks, localDateTimeInput, missingKeys } from '../logic';
import { PlaygroundInspector, PlaygroundPane, agentTransport } from '../playground/playground';
import { usePlayground } from '../playground/chat';
import { isPlanLimit, PlanLimitDialog, TestLinkDialog } from '../use-agent-actions';

export type ActivationOutcome = { kind: 'activated' | 'scheduled'; agent: Agent };

export function useActivation(agent: Agent, onDone: (o: ActivationOutcome) => void) {
  const t = useT();
  const refresh = useAgentsRefresh();
  const readiness = useReadiness(agent.id);
  const [pending, setPending] = useState<'now' | 'at' | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null; missing: string[] } | null>(null);
  const [limit, setLimit] = useState(false);

  const activate = async (at?: string) => {
    setPending(at ? 'at' : 'now');
    setError(null);
    try {
      const next = await agentsApi.activate(agent.id, at ? { at } : {});
      await refresh(agent.id);
      onDone({ kind: at && next.status === 'draft' ? 'scheduled' : 'activated', agent: next });
      return true;
    } catch (e) {
      if (isPlanLimit(e)) setLimit(true);
      const code = e instanceof ApiError ? e.code : null;
      setError({ message: errorMessage(e, t), code, missing: e instanceof ApiError && code === 'AGENT_DRAFT_INCOMPLETE' ? missingKeys(e.body.params, e.body.details) : [] });
      void readiness.refetch();
      return false;
    } finally {
      setPending(null);
    }
  };
  return { activate, pending, error, readiness, limit, closeLimit: () => setLimit(false) };
}
export type Activation = ReturnType<typeof useActivation>;

const SCENARIO_STATE: Record<string, 'ok' | 'warning' | 'missing'> = { pass: 'ok', fail: 'missing', error: 'warning' };

export function ActivateStep({ agent, activation }: { agent: Agent; activation: Activation }) {
  const t = useT();
  const refresh = useAgentsRefresh();
  const { readiness, error } = activation;
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const running = !!jobId && isJobRunning(job.data) && !job.isError;
  const scenarios = useScenarios(agent.id, running);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [test, setTest] = useState<{ scenario: TestScenarioKey | null } | null>(null);
  const [link, setLink] = useState(false);
  const { refetch } = scenarios;
  useEffect(() => {
    if (jobId && !running) {
      void refetch();
      void readiness.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, running]);

  const run = async () => {
    setStarting(true);
    setRunError(null);
    try {
      setJobId((await agentsApi.runScenarios(agent.id)).jobId);
    } catch (e) {
      setRunError(errorMessage(e, t));
    } finally {
      setStarting(false);
    }
  };
  const checks = readiness.data?.checks ?? [];
  const labelOf = (key: string) => checks.find((c) => c.key === key)?.label ?? (t.has(`agents.missing.${key}`) ? t(`agents.missing.${key}`) : key);

  return (
    <>
      <FormSection title={t('agents.activate.ready.title')} data-section="readiness" data-ready={readiness.data?.ready ?? undefined}>
        {readiness.isPending ? (
          <Skeleton className="h-32" />
        ) : readiness.isError ? (
          <QueryError error={readiness.error} onRetry={() => readiness.refetch()} />
        ) : (
          <ul className="-my-2 divide-y divide-line-hairline" aria-label={t('agents.activate.ready.title')}>
            {checks.map((c) => (
              <ReadinessRow
                key={c.key}
                name={c.key}
                state={c.ok ? 'ok' : c.blocking ? 'missing' : 'warning'}
                action={
                  c.link ? (
                    <Link href={c.link} className={buttonClass({ size: 'sm', variant: 'ghost' })}>
                      {t('action.view')}
                    </Link>
                  ) : undefined
                }
              >
                {c.label}
              </ReadinessRow>
            ))}
          </ul>
        )}
        {error ? (
          <FormAlert>
            <span data-testid="activation-error" data-code={error.code ?? ''}>
              {error.missing.length ? t('agents.activate.incomplete') : error.message}
            </span>
            {error.missing.length ? (
              <ul className="mt-1.5 list-inside list-disc" data-testid="activation-missing">
                {error.missing.map((m) => (
                  <li key={m} data-missing={m}>
                    {labelOf(m)}
                  </li>
                ))}
              </ul>
            ) : null}
          </FormAlert>
        ) : null}
      </FormSection>

      <FormSection title={t('agents.activate.scenarios.title')} description={t('agents.activate.scenarios.description')} data-section="scenarios" data-running={running || undefined}>
        {scenarios.isPending ? (
          <Skeleton className="h-40" />
        ) : scenarios.isError ? (
          <QueryError error={scenarios.error} onRetry={() => scenarios.refetch()} />
        ) : (
          <ul className="divide-y divide-line-hairline overflow-hidden rounded-card border border-line-edge" aria-label={t('agents.activate.scenarios.title')}>
            {scenarios.data.map((s) => (
              <ScenarioRow key={s.scenarioKey} run={s} running={running} onOpen={() => setTest({ scenario: s.scenarioKey })} />
            ))}
          </ul>
        )}
        {runError ? <FormAlert>{runError}</FormAlert> : null}
        {job.data?.status === 'failed' ? <FormAlert>{job.data.error?.message ?? t('agents.activate.scenarios.failed')}</FormAlert> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={run} loading={starting || running} data-testid="scenarios-run">
            {running ? t('agents.activate.scenarios.running', { pct: Math.round(job.data?.progress ?? 0) }) : t('agents.activate.scenarios.run')}
          </Button>
          <Button variant="ghost" onClick={() => setTest({ scenario: null })} data-testid="wizard-test-myself">
            {t('agents.activate.testMyself')}
          </Button>
          <Button variant="ghost" onClick={() => setLink(true)} data-testid="wizard-test-link">
            {t('agents.activate.sendLink')}
          </Button>
        </div>
      </FormSection>

      <EmbeddedPlayground agent={agent} open={test !== null} scenario={test?.scenario ?? null} onClose={() => (setTest(null), void refresh(agent.id))} />
      <TestLinkDialog agent={link ? agent : null} onClose={() => setLink(false)} />
      <PlanLimitDialog open={activation.limit} limit={null} onClose={activation.closeLimit} />
    </>
  );
}

function ScenarioRow({ run, running, onOpen }: { run: ScenarioRun; running: boolean; onOpen: () => void }) {
  const t = useT();
  const state = run.status ? SCENARIO_STATE[run.status] : null;
  return (
    <li data-scenario={run.scenarioKey} data-status={run.status ?? 'none'} className="flex items-center gap-3 bg-ink-surface px-3 py-2.5">
      <span aria-hidden className={state === 'ok' ? 'text-accent-money' : state === 'missing' ? 'text-accent-alert' : state === 'warning' ? 'text-accent-starred' : 'text-text-muted'}>
        {state === 'ok' ? '✓' : state === 'missing' ? '✕' : state === 'warning' ? '⚠' : '·'}
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[13px]">
          {t(`agents.scenario.full.${run.scenarioKey}`)}
        </span>
        <span dir="auto" className="ts-label-meta mt-1 block truncate text-text-muted">
          {run.summary ?? (running ? t('agents.activate.scenarios.pending') : run.status ? t(`agents.activate.scenarios.status.${run.status}`) : t('agents.activate.scenarios.never'))}
        </span>
      </span>
      <button type="button" onClick={onOpen} className="ts-label-meta shrink-0 text-accent-inbound hover:underline" data-testid="scenario-open">
        {t('action.openArrow')}
      </button>
    </li>
  );
}

/** The playground inside a dialog: step 5 never leaves the wizard (the draft keeps its place). */
function EmbeddedPlayground({ agent, open, scenario, onClose }: { agent: Agent; open: boolean; scenario: TestScenarioKey | null; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('agents.playground.title', { name: agent.name })} description={t('agents.playground.description')} closeLabel={t('action.close')} size="xl">
      {open ? <EmbeddedBody agent={agent} scenario={scenario} /> : null}
    </Dialog>
  );
}
function EmbeddedBody({ agent, scenario }: { agent: Agent; scenario: TestScenarioKey | null }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transport = useCallback(agentTransport(agent.id), [agent.id]);
  const pg = usePlayground(transport);
  const { send } = pg;
  useEffect(() => {
    if (scenario) void send({ text: '', scenario });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="embedded-playground">
      <div className="rounded-card border border-line-edge bg-ink-base py-3">
        <PlaygroundPane pg={pg} agent={agent} className="flex h-[min(60vh,34rem)] min-h-[22rem] min-w-0 flex-col" />
      </div>
      <PlaygroundInspector pg={pg} agent={agent} />
    </div>
  );
}

/** Rail of step 5: Activer maintenant · Enregistrer en brouillon · Activer à une date. */
export function ActivationRail({ agent, activation, onSaveDraft }: { agent: Agent; activation: Activation; onSaveDraft: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const refresh = useAgentsRefresh();
  const [schedule, setSchedule] = useState(false);
  const [at, setAt] = useState('');
  const [atError, setAtError] = useState<string | null>(null);
  const [unscheduling, setUnscheduling] = useState(false);
  // blocking readiness rows (✕) first, then the server descriptor of `activate` (role, status, no page)
  const blocking = blockingChecks(activation.readiness.data?.checks);
  const descriptor = actionState(agent.actions, 'activate', t);
  const blockedReason = blocking.length ? t('gaps.agents.activate.blocked', { items: blocking.map((c) => c.label).join(', ') }) : descriptor.present && !descriptor.enabled ? descriptor.reason : undefined;
  const unschedule = async () => {
    setUnscheduling(true);
    try {
      await agentsApi.unschedule(agent.id);
      await refresh(agent.id);
      toast(t('gaps.agents.activate.unscheduled', { name: agent.name }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setUnscheduling(false);
    }
  };
  const submitAt = async () => {
    const date = at ? new Date(at) : null;
    if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return setAtError(t('agents.activate.at.future'));
    setAtError(null);
    if (await activation.activate(date.toISOString())) setSchedule(false);
  };
  return (
    <div className="flex flex-col gap-2" data-testid="activation-rail">
      {agent.scheduledActivateAt ? (
        <FormAlert tone="info">
          <span data-testid="activation-scheduled">{t('agents.activate.scheduled', { date: formatDateTime(agent.scheduledActivateAt, locale) })}</span>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void unschedule()} loading={unscheduling} disabled={activation.pending !== null} data-testid="activation-unschedule">
            {t('gaps.agents.activate.unschedule')}
          </Button>
        </FormAlert>
      ) : null}
      <Button variant="primary" className="w-full !justify-start" onClick={() => void activation.activate()} loading={activation.pending === 'now'} disabled={activation.pending !== null} disabledReason={blockedReason} data-testid="activate-now">
        {t('agents.activate.now')}
      </Button>
      <Button className="w-full !justify-start" onClick={onSaveDraft} disabled={activation.pending !== null} data-testid="activate-save-draft">
        {t('agents.activate.saveDraft')}
      </Button>
      <Button variant="ghost" className="w-full !justify-start" onClick={() => setSchedule(true)} disabled={activation.pending !== null} disabledReason={blockedReason} data-testid="activate-later">
        {t('agents.activate.at')}
      </Button>
      {blockedReason ? (
        <p className="ts-label-meta text-accent-alert" data-testid="activation-blocked">
          {blockedReason}
        </p>
      ) : null}
      <p className="ts-label-meta text-text-muted">
        {t('agents.activate.note')} <Ltr>(AGENT_CHANNEL_SWITCH_NEXT_THREAD)</Ltr>
      </p>
      <Dialog
        open={schedule}
        onOpenChange={(o) => !o && activation.pending === null && setSchedule(false)}
        title={t('agents.activate.at.title')}
        description={t('agents.activate.at.description')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedule(false)} disabled={activation.pending !== null}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={submitAt} loading={activation.pending === 'at'} data-testid="activate-at-submit">
              {t('agents.activate.at.submit')}
            </Button>
          </>
        }
      >
        <Field label={t('agents.activate.at.label')} htmlFor="activate-at" error={atError ?? undefined}>
          <Input id="activate-at" type="datetime-local" dir="ltr" min={localDateTimeInput(new Date())} value={at} onChange={(e) => setAt(e.target.value)} aria-invalid={!!atError || undefined} />
        </Field>
        {activation.error && schedule ? <FormAlert className="mt-3">{activation.error.message}</FormAlert> : null}
      </Dialog>
    </div>
  );
}
