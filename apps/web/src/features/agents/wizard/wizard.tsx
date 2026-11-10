'use client';
// /agents/new, /agents/new/[step] — Figma "AGT-02 — Agent wizard — step 1…5" (D54: Identité → Connaissances →
// Comportement → Canaux → Test & activation). Step 1 starts from one of the 4 presets or "De zéro"; the draft is
// created at the first save (`POST /agents`, status draft — drafts never count toward `maxAgents`) and auto-saved after
// every change ("Brouillon enregistré il y a 12 s"); it resumes from the list (`?draft=<id>`). Back is always allowed.
// Before the draft exists the form is kept in sessionStorage (session-expired recovery, 02-next-route-map §6).
// Inside the onboarding tunnel (step 4 "Partir de zéro", `?start=scratch`) only steps 1–3 run: channels and activation
// need the page of step 5, so finishing step 3 moves the tunnel on to the page step; cancel / save & quit go back to it.
import { Button, FormAlert, OptionCard, Skeleton, SummaryRail, toast, ValidationSummary, WizardFrame, type WizardStep } from '@djaber/ui';
import { formatNumber, PLAYGROUND_TURNS_PER_HOUR } from '@djaber/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppPage } from '@/components/app-page';
import { channelsApi, useChannels, useChannelsRefresh } from '@/features/channels/api';
import { ConflictDialog, QueryError } from '@/components/global-states';
import { useOnboardingStep } from '@/features/workspace/api';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { conflictOf } from '@/lib/conflict';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { needsOnboarding, onboardingPath, onboardingWrite, stepNumber, TUNNEL_WIZARD_STEPS } from '@/lib/guards';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { agentKeys, agentsApi, useAgent, useAgentsRefresh, usePresets } from '../api';
import type { Agent, WizardStepKey } from '../contracts';
import { WIZARD_STEPS } from '../contracts';
import { BehaviourFields } from '../fields/behaviour';
import { ChannelsFields } from '../fields/channels';
import { IdentityFields } from '../fields/identity';
import { KnowledgeFields } from '../fields/knowledge';
import {
  canOpenStep,
  creditsPerConversation,
  defaultDraft,
  dirtySections,
  draftFromAgent,
  draftFromPreset,
  enabledCapabilities,
  enabledRuleCount,
  issueMap,
  issueSummary,
  mergeBySection,
  monthlyCreditEstimate,
  nextStep,
  policyCount,
  previousStep,
  sectionsPatch,
  serverIssues,
  stepIndex,
  stepState,
  validateStep,
  type AgentDraft,
  type Issue,
  type SectionKey,
} from '../logic';
import { channelLabel } from '../ui';
import { ActivateStep, ActivationRail, useActivation, type ActivationOutcome } from './activate';

const STORE_KEY = 'djaber.agent-wizard.new';
const AUTOSAVE_MS = 1_500;
const SCRATCH = '__scratch';
const readStored = (): AgentDraft | null => {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw ? { ...defaultDraft(), ...(JSON.parse(raw) as Partial<AgentDraft>) } : null;
  } catch {
    return null;
  }
};
const store = (d: AgentDraft | null) => {
  try {
    if (d) window.sessionStorage.setItem(STORE_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch {}
};
const sectionOf = (step: WizardStepKey): SectionKey | null => (step === 'identity' || step === 'knowledge' || step === 'behaviour' ? step : null);
const TUNNEL_STEP = stepNumber('agent');
const TUNNEL_PATH = onboardingPath(TUNNEL_STEP);
const inTunnelSteps = (k: WizardStepKey) => (TUNNEL_WIZARD_STEPS as readonly string[]).includes(k);

export function AgentWizard({ step }: { step: WizardStepKey }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const params = useSearchParams();
  const draftId = params.get('draft');
  const { workspace, role } = useSession();
  const inTunnel = needsOnboarding(workspace, role);
  const exitTo = inTunnel ? TUNNEL_PATH : '/agents';
  const initialStart = !draftId && params.get('start') === 'scratch' ? SCRATCH : null;
  const q = useAgent(draftId);
  const agent = q.data ?? null;
  // status the agent had when this step opened: a draft activated from step 5 leaves through the activation itself
  // (→ `/agents/[id]`), it must not also be sent to its Configuration tab
  const openedAs = useRef<Agent['status'] | null>(null);
  if (agent && openedAs.current === null) openedAs.current = agent.status;
  const notDraft = agent && agent.status !== 'draft' && openedAs.current !== 'draft' ? agent : null;
  useEffect(() => {
    // an activated agent is edited in its Configuration tab
    if (notDraft) router.replace(`/agents/${notDraft.id}/configuration`);
    // a step cannot be opened before the draft exists
    else if (!draftId && step !== 'identity') router.replace('/agents/new');
  }, [notDraft, draftId, step, router]);

  const crumb = (
    <nav aria-label={t('agents.wizard.breadcrumb')} className="ts-label-meta text-text-muted">
      <Link href={exitTo} className="text-accent-inbound underline underline-offset-2">
        {inTunnel ? t('onboarding.stepsLabel') : t('nav.agents')}
      </Link>{' '}
      / {agent?.name || t('agents.wizard.new')}
    </nav>
  );
  if ((draftId && !agent) || notDraft || (!draftId && step !== 'identity')) {
    return (
      <AppPage wide permission={['agents.read', 'agents.manage']} title={t('agents.wizard.new')} breadcrumb={crumb}>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => q.refetch()} backHref={`/${locale}${exitTo}`} />
        ) : (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-64" />
          </div>
        )}
      </AppPage>
    );
  }
  return <WizardBody key={agent?.id ?? 'new'} step={step} agent={agent} crumb={crumb} inTunnel={inTunnel} exitTo={exitTo} initialStart={initialStart} />;
}

function WizardBody({ step, agent, crumb, inTunnel, exitTo, initialStart }: { step: WizardStepKey; agent: Agent | null; crumb: React.ReactNode; inTunnel: boolean; exitTo: string; initialStart: string | null }) {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useAgentsRefresh();
  const { workspace, can } = useSession();
  const presets = usePresets();
  // "Créer un agent" of a page without agent (`/agents/new?channel=<id>`): the page is linked to the draft at creation
  const channelParam = useSearchParams().get('channel');
  const pages = useChannels(!agent && !!channelParam && can('channels.read'));
  const refreshChannels = useChannelsRefresh();
  const forPage = !agent && channelParam ? ((pages.data?.rows ?? []).find((c) => c.id === channelParam && c.status !== 'disconnected' && !c.agent) ?? null) : null;

  const [base, setBase] = useState<AgentDraft | null>(() => (agent ? draftFromAgent(agent) : null));
  const [draft, setDraft] = useState<AgentDraft>(() => (agent ? draftFromAgent(agent) : defaultDraft()));
  // "Partir de zéro" of the tunnel arrives with the starting point already chosen
  const [start, setStart] = useState<string | null>(initialStart);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState<'auto' | 'next' | 'quit' | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(agent?.updatedAt ? Date.parse(agent.updatedAt) : null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: Agent | null; by: string; at: string | null } | null>(null);
  const [, tick] = useState(0);
  // the version this form last loaded or saved: a save sends it, so a foreign save in between answers 409 (merge by
  // section) instead of being overwritten silently
  const versionRef = useRef(agent?.version ?? 0);
  const savedStep = agent?.wizardStep ?? 0;
  const section = sectionOf(step);

  // recover an unsaved step-1 form (session expired, reload)
  useEffect(() => {
    if (agent) return;
    const stored = readStored();
    if (stored) {
      setDraft(stored);
      setStart(stored.presetKey ?? SCRATCH);
    }
  }, [agent]);
  // "il y a 12 s" keeps moving
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const dirty = useMemo(() => (base ? dirtySections(base, draft).length > 0 : draft.name.trim() !== '' || (start !== null && start !== initialStart)), [base, draft, start, initialStart]);
  // leaving a draft that was never created drops its sessionStorage copy (it would come back on the next "Nouvel agent")
  const { guard, ask } = useLeaveGuard(dirty && saving === null, draft.name || t('agents.wizard.new'), () => {
    if (!agent) store(null);
  });

  // a newer version of the draft arrived (WS refetch after a save made elsewhere): a form without unsaved changes takes
  // the fresh values; a form with changes is never rebased by an event (its next save meets the 409 and merges)
  useEffect(() => {
    if (!agent || agent.version <= versionRef.current || saving !== null || !base || dirtySections(base, draft).length) return;
    versionRef.current = agent.version;
    const fresh = draftFromAgent(agent);
    setBase(fresh);
    setDraft(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.version, saving]);

  const set = (patch: Partial<AgentDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!agent) store(next);
      return next;
    });
    // an error leaves the summary as soon as the form no longer has it (also when another field resolves it)
    if (issues.length) {
      const still = new Set(validateStep(step, { ...draft, ...patch }).map((i) => i.field));
      const edited = (i: Issue) => i.field.split('.')[0]! in patch;
      setIssues((old) => old.filter((i) => (i.field === 'start' ? start === null : i.server ? !edited(i) : still.has(i.field) && !edited(i))));
    }
  };
  const presetTagline = (key: string | null) => (key && key !== SCRATCH ? (presets.data?.find((p) => p.key === key)?.tagline ?? '') : '');
  const choose = (key: string) => {
    setStart(key);
    const preset = key === SCRATCH ? null : (presets.data?.find((p) => p.key === key) ?? null);
    const next = draftFromPreset(preset, { name: draft.name, description: draft.description && draft.description !== presetTagline(start) ? draft.description : '', displayName: draft.displayName });
    // the preset brings its tone, capabilities and delay; what the merchant already chose for the identity stays
    const kept = { ...next, languages: draft.languages, defaultLanguage: draft.defaultLanguage, formality: draft.formality, emojiLevel: draft.emojiLevel, avatarMode: draft.avatarMode, avatarUploadId: draft.avatarUploadId, avatarUrl: draft.avatarUrl };
    setDraft(kept);
    store(kept);
    setIssues((old) => old.filter((i) => i.field !== 'start'));
  };

  const adopt = useCallback(
    (a: Agent, keepDraft?: AgentDraft) => {
      versionRef.current = a.version;
      qc.setQueryData(agentKeys.one(ws, a.id), a);
      // the base is what this form sent (the server accepted it), not its echo: a server-side normalisation
      // (dropped empty keys, reordered lists) must never look like an unsaved change and restart the autosave
      setBase(keepDraft ?? draftFromAgent(a));
      setSavedAt(Date.now());
    },
    [qc, ws],
  );

  /** Writes the current step. Returns the saved agent, or null when nothing could be saved. */
  const save = async (mode: 'auto' | 'next' | 'quit', versionOverride?: number): Promise<Agent | null> => {
    setError(null);
    if (mode !== 'auto') {
      const found = validateStep(step, draft);
      setIssues(found);
      if (found.length) {
        window.requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }));
        return null;
      }
    }
    setSaving(mode);
    try {
      if (!agent) {
        if (start === null) {
          setIssues([{ field: 'start', key: 'agents.validation.startRequired' }]);
          return null;
        }
        const created = await agentsApi.create({ ...(start === SCRATCH ? { fromScratch: true } : { presetKey: start }), ...sectionsPatch(draft, ['identity']) } as Parameters<typeof agentsApi.create>[0]);
        store(null);
        qc.setQueryData(agentKeys.one(ws, created.id), created);
        if (forPage) {
          // a refusal (the page got an agent meanwhile) leaves the draft as it is: step 4 links pages anyway
          await channelsApi
            .setAgent(forPage.id, { agentId: created.id })
            .then(() => (toast(t('channels.link.toast.linked', { page: forPage.name, agent: created.name })), void refreshChannels(forPage.id)))
            .catch((e) => toast({ tone: 'warning', message: errorMessage(e, t) }));
        }
        void refresh(forPage ? created.id : undefined);
        return created;
      }
      const sent = draft;
      const body = section ? sectionsPatch(sent, [section]) : {};
      const saved = await agentsApi.update(agent.id, { ...body, ...(mode === 'next' ? { step: stepIndex(step) } : {}), version: versionOverride ?? versionRef.current });
      adopt(saved, sent);
      return saved;
    } catch (e) {
      const c = conflictOf<Agent>(e);
      // recette 09/11 (Badro): a field the server refused is named and outlined, never just « Vérifiez les champs »
      const refused = e instanceof ApiError && e.code === 'VALIDATION_ERROR' ? serverIssues(e.body.fields) : [];
      if (c) setConflict({ current: c.current, by: c.changedBy, at: c.changedAt });
      else if (refused.length) {
        setIssues(refused);
        window.requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }));
      } else if (mode !== 'auto') setError(errorMessage(e, t));
      return null;
    } finally {
      setSaving(null);
    }
  };

  // autosave: a valid, changed step is written after a pause in typing
  const saveRef = useRef(save);
  saveRef.current = save;
  const changed = !!agent && !!base && !!section && dirtySections(base, draft).includes(section);
  useEffect(() => {
    if (!changed || saving !== null || conflict) return;
    if (validateStep(step, draft).length) return;
    const id = window.setTimeout(() => void saveRef.current('auto'), AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [changed, draft, step, saving, conflict]);

  const go = (to: WizardStepKey, id = agent?.id) => router.push(id ? `/agents/new/${to}?draft=${id}` : '/agents/new');
  /** Back / a step chip: a changed step is saved first (validated: an invalid step stays open with its errors). */
  const leaveTo = async (to: WizardStepKey) => {
    if (changed && !(await save('quit'))) return;
    go(to);
  };
  // the tunnel's last wizard step: the draft is saved, the tunnel moves on to the page step (channels need a page)
  const tunnelLast = inTunnel && step === TUNNEL_WIZARD_STEPS[TUNNEL_WIZARD_STEPS.length - 1];
  const onboarding = useOnboardingStep();
  const [finishing, setFinishing] = useState(false);
  const finishTunnel = async (saved: Agent) => {
    setFinishing(true);
    toast(t('agents.wizard.savedDraft', { name: saved.name }));
    const write = onboardingWrite(workspace?.onboardingStep ?? TUNNEL_STEP, TUNNEL_STEP);
    try {
      if (write !== null) await onboarding.mutateAsync(write);
      router.push(onboardingPath(TUNNEL_STEP + 1));
    } catch (e) {
      // the agent is saved: the tunnel's agent step shows it with "Continuer"
      toast({ tone: 'danger', message: errorMessage(e, t) });
      setFinishing(false);
      router.push(TUNNEL_PATH);
    }
  };
  const proceed = (saved: Agent) => {
    if (tunnelLast) return void finishTunnel(saved);
    const to = nextStep(step);
    if (to) go(to, saved.id);
  };
  const next = async () => {
    const saved = await save('next');
    if (saved) proceed(saved);
  };
  const quit = async () => {
    if (!agent && !draft.name.trim() && (start === null || start === initialStart)) return router.push(exitTo);
    const saved = await save('quit');
    if (!saved) return;
    toast(t('agents.wizard.savedDraft', { name: saved.name }));
    router.push(exitTo);
  };
  const reload = async () => {
    const fresh = conflict?.current ?? (agent ? await agentsApi.get(agent.id).catch(() => null) : null);
    setConflict(null);
    if (!fresh || !base) return;
    const theirs = draftFromAgent(fresh);
    versionRef.current = fresh.version;
    qc.setQueryData(agentKeys.one(ws, fresh.id), fresh);
    setDraft(mergeBySection(draft, base, theirs));
    setBase(theirs);
  };

  const activation = useActivation(agent ?? ({ id: '' } as Agent), (o: ActivationOutcome) => {
    toast(o.kind === 'scheduled' ? t('agents.activate.toast.scheduled', { name: o.agent.name }) : t('agents.activate.toast.activated', { name: o.agent.name }));
    router.push(o.kind === 'scheduled' ? '/agents' : `/agents/${o.agent.id}`);
  });

  /* ---------- frame ---------- */
  const steps: WizardStep[] = WIZARD_STEPS.map((k) => ({
    key: k,
    label: t(`agents.wizard.step.${k}`),
    state: stepState(k, step, savedStep),
    // in the tunnel, channels and activation are not reachable before a page is connected (tunnel step 5)
    onSelect: canOpenStep(k, savedStep, !!agent) && k !== step && (!inTunnel || inTunnelSteps(k)) ? () => void leaveTo(k) : undefined,
  }));
  const errors = issueMap(issues);
  const fields = { draft, set, errors, readOnly: saving === 'next' || saving === 'quit' || finishing, inTunnel };
  const presetName = draft.presetKey ? (presets.data?.find((p) => p.key === draft.presetKey)?.name ?? agent?.preset?.name ?? draft.presetKey) : agent || start === SCRATCH ? t('agents.start.scratch') : '';
  // no conversation this month yet: the monthly estimate is not invented ("—"), only the cost per conversation is shown
  const conversations = workspace?.plan?.usage.conversationsThisMonth ?? 0;
  const perConv = creditsPerConversation(draft);
  const status = saving ? t('common.saving') : !agent ? t('agents.wizard.status.unsaved') : changed ? t('agents.wizard.status.pending') : savedAt ? t('agents.wizard.status.saved', { ago: relativeTime(new Date(savedAt), locale) }) : t('agents.wizard.status.draft');

  const rail = (
    <SummaryRail
      title={t('agents.rail.title')}
      rows={[
        { label: t('agents.rail.preset'), value: presetName },
        { label: t('agents.rail.name'), value: draft.name.trim() },
        { label: t('agents.rail.languages'), value: draft.languages.map((l) => t(`agents.language.short.${l}`)).join(' · ') },
        { label: t('agents.rail.knowledge'), value: savedStep >= 2 || step === 'knowledge' ? [draft.catalogScope === 'all' ? t('agents.rail.catalogAll') : t('agents.summary.catalogCategories', { count: draft.scopeCategoryIds.length }), t('agents.summary.rules', { count: policyCount(draft) }), t('agents.summary.faq', { count: agent?.wizard?.faqCount ?? 0 })].join(' · ') : '' },
        { label: t('agents.rail.capabilities'), value: savedStep >= 3 || step === 'behaviour' ? enabledCapabilities(draft).map((c) => t(`agents.capability.short.${c}`)).join(' · ') : '' },
        { label: t('agents.rail.handoff'), value: savedStep >= 3 || step === 'behaviour' ? t('agents.rail.handoffValue', { rules: enabledRuleCount(draft), keywords: draft.handoffKeywords.length }) : '' },
        { label: t('agents.rail.channels'), value: (agent?.channels ?? []).map(channelLabel).join(' · ') },
      ]}
    >
      <div data-testid="credit-estimate">
        <div className="ts-label-micro text-text-muted">{t('agents.rail.estimate')}</div>
        <p className="ts-label-meta mt-1 text-text-secondary">
          <bdi>
            {conversations > 0
              ? t('agents.rail.estimateValue', {
                  perConv: locale === 'en' ? String(perConv) : String(perConv).replace('.', ','),
                  conversations: formatNumber(conversations),
                  credits: formatNumber(monthlyCreditEstimate(draft, conversations)),
                  limit: formatNumber(workspace?.plan?.limits.monthlyCredits ?? 0),
                })
              : t('gaps.agents.rail.estimateNoUsage', {
                  perConv: locale === 'en' ? String(perConv) : String(perConv).replace('.', ','),
                  limit: formatNumber(workspace?.plan?.limits.monthlyCredits ?? 0),
                })}
          </bdi>
        </p>
      </div>
      {step === 'activate' && agent ? <ActivationRail agent={agent} activation={activation} onSaveDraft={() => void quit()} /> : null}
    </SummaryRail>
  );

  return (
    <AppPage wide bare permission={['agents.read', 'agents.manage']} title={agent?.name || t('agents.wizard.new')} breadcrumb={crumb}>
      <WizardFrame
        steps={steps}
        stepsLabel={t('agents.wizard.steps')}
        title={t(`agents.wizard.title.${step}`)}
        description={t(`agents.wizard.description.${step}`, { limit: PLAYGROUND_TURNS_PER_HOUR })}
        rail={rail}
        footer={{
          back:
            step === 'identity' ? (
              <Button variant="ghost" onClick={() => ask(`/${locale}${exitTo}`)} disabled={saving !== null} data-testid="wizard-cancel">
                {t('action.cancel')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void leaveTo(previousStep(step) ?? 'identity')} disabled={saving !== null} data-testid="wizard-back">
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                {t('agents.wizard.back')}
              </Button>
            ),
          status: step === 'activate' ? t('agents.activate.blockedNote') : tunnelLast ? `${status} · ${t('agents.wizard.tunnelNote')}` : status,
          secondary:
            step === 'activate' ? null : (
              <Button variant="ghost" onClick={() => void quit()} loading={saving === 'quit'} disabled={saving === 'next' || finishing} data-testid="wizard-save-quit">
                {t('action.saveAndQuit')}
              </Button>
            ),
          primary:
            step === 'activate' ? null : (
              <Button variant="primary" onClick={() => void next()} loading={saving === 'next' || finishing} disabled={saving === 'quit'} data-testid="wizard-next">
                {tunnelLast ? t('agents.wizard.tunnelFinish') : t('agents.wizard.next')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Button>
            ),
        }}
      >
        <ValidationSummary title={t('agents.validation.summary', { count: issues.length })} items={issueSummary(t, issues)} />
        {error ? <FormAlert>{error}</FormAlert> : null}

        {step === 'identity' ? (
          <>
            {forPage ? (
              <FormAlert tone="info">
                <span data-testid="wizard-for-page" data-channel={forPage.id}>
                  {t('gaps.agents.wizard.forPage', { page: forPage.name })}
                </span>
              </FormAlert>
            ) : null}
            <section aria-label={t('agents.start.title')} data-testid="starting-point">
              <div className="ts-label-micro mb-2 text-text-muted">{t('agents.start.title')}</div>
              {agent ? (
                <p className="text-[13px] text-text-secondary" data-testid="starting-point-fixed">
                  {t('agents.start.fixed', { name: presetName })}
                </p>
              ) : presets.isError ? (
                <FormAlert>{errorMessage(presets.error, t)}</FormAlert>
              ) : (
                <div role="radiogroup" aria-label={t('agents.start.title')} aria-invalid={!!errors.start || undefined} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {presets.isPending ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />) : null}
                  {(presets.data ?? []).map((p) => (
                    <OptionCard key={p.key} name={p.key} selected={start === p.key} onSelect={() => choose(p.key)} title={p.name} description={p.tagline ?? p.description ?? ''} badge={t('agents.start.selected')} />
                  ))}
                  <OptionCard name="scratch" selected={start === SCRATCH} onSelect={() => choose(SCRATCH)} title={t('agents.start.scratch')} description={t('agents.start.scratch.description')} badge={t('agents.start.selected')} />
                </div>
              )}
            </section>
            <IdentityFields {...fields} />
          </>
        ) : null}
        {step === 'knowledge' ? <KnowledgeFields {...fields} agentId={agent?.id ?? null} productCount={agent && draft.catalogScope === 'all' && agent.sellAllProducts ? agent.productCount : null} /> : null}
        {step === 'behaviour' ? <BehaviourFields {...fields} /> : null}
        {step === 'channels' && agent ? <ChannelsFields agentId={agent.id} agentName={agent.name} /> : null}
        {step === 'activate' && agent ? <ActivateStep agent={agent} activation={activation} /> : null}
      </WizardFrame>
      {guard}
      <ConflictDialog open={conflict !== null} name={conflict?.by || '—'} ago={conflict?.at ? relativeTime(conflict.at, locale) : '—'} onReload={() => void reload()} onOverwrite={conflict?.current ? () => (setConflict(null), void save('next', conflict.current!.version).then((s) => s && proceed(s))) : undefined} onClose={() => setConflict(null)} />
    </AppPage>
  );
}
