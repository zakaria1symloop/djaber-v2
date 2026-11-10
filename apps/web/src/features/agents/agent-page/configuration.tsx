'use client';
// /agents/[id]/configuration — Figma "AGT-04 — Agent page — Configuration tab (edit as tabs, dirty, saving, conflict)":
// the wizard steps as sections edited in place. Dirty dot per section, "Enregistrer (n sections modifiées)",
// "Annuler les modifications", leave guard; saving locks the fields and ends with "Version vN créée"; a 409 opens
// "Modifié par quelqu'un d'autre" (Recharger = merge by section, Écraser = resubmit on the fresh version).
// Operator: read-only (fields greyed, no save button). A dirty form is never rebased by a WS refresh.
import { Banner, Button, cn, FormAlert, Ltr, MonoChip, toast, ValidationSummary } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConflictDialog } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { conflictOf } from '@/lib/conflict';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { agentKeys, agentsApi, useAgentsRefresh } from '../api';
import type { Agent } from '../contracts';
import { BehaviourFields } from '../fields/behaviour';
import { ChannelsFields } from '../fields/channels';
import { IdentityFields } from '../fields/identity';
import { KnowledgeFields } from '../fields/knowledge';
import { dirtySections, draftFromAgent, issueMap, issueSummary, mergeBySection, SECTIONS, sectionOfField, sectionsPatch, serverIssues, validateSection, type AgentDraft, type Issue, type SectionKey } from '../logic';
import { useAgentPage } from './agent-shell';

const TABS = ['identity', 'knowledge', 'behaviour', 'channels'] as const;
type Tab = (typeof TABS)[number];

export function AgentConfiguration() {
  const t = useT();
  const locale = useLocaleCode();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const { agent } = useAgentPage();
  const refresh = useAgentsRefresh();
  const manage = can('agents.manage');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('section') ?? '') ? (params.get('section') as Tab) : 'identity';
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params.toString());
    if (next === 'identity') p.delete('section');
    else p.set('section', next);
    router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };

  /** the saved agent this form was loaded from: its `version` is the optimistic lock */
  const [base, setBase] = useState<{ draft: AgentDraft; version: number; currentVersion: number }>(() => ({ draft: draftFromAgent(agent), version: agent.version, currentVersion: agent.currentVersion }));
  const [draft, setDraft] = useState<AgentDraft>(base.draft);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: Agent | null; by: string; at: string | null } | null>(null);
  const dirty = useMemo(() => dirtySections(base.draft, draft), [base.draft, draft]);
  const dirtyRef = useRef(dirty.length > 0);
  dirtyRef.current = dirty.length > 0;
  const { guard } = useLeaveGuard(dirty.length > 0, agent.name);

  // a refreshed agent (WS, another tab, own channel change) rebases the form only while it has no unsaved edit
  useEffect(() => {
    if (agent.version === base.version || dirtyRef.current || saving) return;
    const next = draftFromAgent(agent);
    setBase({ draft: next, version: agent.version, currentVersion: agent.currentVersion });
    setDraft(next);
  }, [agent, base.version, saving]);
  const foreign = agent.version !== base.version && dirty.length > 0 && !saving;

  const set = (patch: Partial<AgentDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // an error leaves the summary as soon as the form no longer has it (also when another field resolves it)
    if (issues.length) {
      const next = { ...draft, ...patch };
      const still = new Set(SECTIONS.flatMap((s) => validateSection(s, next)).map((i) => i.field));
      setIssues((old) => old.filter((i) => (i.server || still.has(i.field)) && !(i.field.split('.')[0]! in patch)));
    }
  };
  const cancel = () => {
    setDraft(base.draft);
    setIssues([]);
    setError(null);
  };
  const adopt = (a: Agent) => {
    const next = draftFromAgent(a);
    qc.setQueryData(agentKeys.one(ws, a.id), a);
    setBase({ draft: next, version: a.version, currentVersion: a.currentVersion });
    setDraft(next);
  };

  const save = async (version = base.version) => {
    const found = dirty.flatMap((s) => validateSection(s, draft).map((i) => ({ ...i, section: s })));
    setIssues(found);
    setError(null);
    if (found.length) {
      const first = found[0]!.section;
      if (first !== tab) setTab(first);
      window.requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }));
      return;
    }
    setSaving(true);
    try {
      const saved = await agentsApi.update(agent.id, { ...sectionsPatch(draft, dirty), version });
      adopt(saved);
      setConflict(null);
      void refresh(agent.id);
      toast(t('agents.versions.created', { version: saved.currentVersion }));
    } catch (e) {
      const c = conflictOf<Agent>(e);
      // recette 09/11 (Badro): a field the server refused is named, outlined and its section opened
      const refused = e instanceof ApiError && e.code === 'VALIDATION_ERROR' ? serverIssues(e.body.fields) : [];
      if (c) setConflict({ current: c.current, by: c.changedBy, at: c.changedAt });
      else if (refused.length) {
        setIssues(refused);
        const first = sectionOfField(refused[0]!.field);
        if (first && first !== tab) setTab(first);
        window.requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center' }));
      } else setError(errorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };
  /** Recharger: sections edited here keep their values, the others take the fresh ones (merge by section). */
  const reload = async () => {
    const fresh = conflict?.current ?? (await agentsApi.get(agent.id).catch(() => null));
    setConflict(null);
    if (!fresh) return;
    const theirs = draftFromAgent(fresh);
    qc.setQueryData(agentKeys.one(ws, fresh.id), fresh);
    setDraft(mergeBySection(draft, base.draft, theirs));
    setBase({ draft: theirs, version: fresh.version, currentVersion: fresh.currentVersion });
  };

  const readOnly = !manage || saving;
  const errors = issueMap(issues);
  const badge = (s: SectionKey) => (dirty.includes(s) ? <MonoChip tone="warning">{t('agents.config.modified')}</MonoChip> : undefined);
  const section = { draft, set, errors, readOnly };
  const dirtyNames = dirty.map((s) => t(`agents.wizard.step.${s}`)).join(` ${t('agents.config.and')} `);

  return (
    <div className="flex flex-col gap-4" data-testid="agent-configuration" data-dirty={dirty.length || undefined} data-saving={saving || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t('agents.config.sections')} className="flex flex-wrap gap-1.5">
          {TABS.map((k) => {
            const isDirty = (SECTIONS as readonly string[]).includes(k) && dirty.includes(k as SectionKey);
            return (
              <button
                key={k}
                type="button"
                aria-current={tab === k ? 'true' : undefined}
                data-section-tab={k}
                data-dirty={isDirty || undefined}
                onClick={() => setTab(k)}
                className={cn('flex h-9 items-center gap-2 rounded-card border px-3 text-[14px] font-medium transition-colors', tab === k ? 'border-white bg-white text-black' : 'border-line-edge bg-ink-surface text-text-primary hover:border-line-lit')}
              >
                {t(`agents.wizard.step.${k}`)}
                {isDirty ? <span aria-label={t('agents.config.modified')} className={cn('size-2 rounded-full', tab === k ? 'bg-black' : 'bg-white')} /> : null}
              </button>
            );
          })}
          {can('workspace.settings') ? (
            <Link href="/settings/system-messages" className="flex h-9 items-center gap-1.5 rounded-card border border-line-edge bg-ink-surface px-3 text-[14px] font-medium hover:border-line-lit">
              {t('agents.overview.system')}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </nav>
        <span className="flex-1" />
        {manage ? (
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={dirty.length === 0} data-testid="config-save">
            {saving ? t('common.saving') : dirty.length ? t('agents.config.save', { count: dirty.length }) : t('action.save')}
          </Button>
        ) : null}
      </div>

      {!manage ? (
        <FormAlert tone="info">
          <span data-testid="config-readonly">{t('agents.config.readOnly')}</span>
        </FormAlert>
      ) : null}
      {dirty.length ? (
        <Banner tone="warning" action={saving ? undefined : { label: t('agents.config.cancel'), onClick: cancel }}>
          <span className="ts-label-meta" data-testid="config-dirty">
            {t('agents.config.dirty', { sections: dirtyNames })}
          </span>
        </Banner>
      ) : null}
      {foreign ? (
        <FormAlert tone="warning">
          <span data-testid="config-foreign">{t('agents.config.foreign')}</span>
        </FormAlert>
      ) : null}
      <ValidationSummary title={t('agents.validation.summary', { count: issues.length })} items={issueSummary(t, issues)} />
      {error ? <FormAlert>{error}</FormAlert> : null}

      {tab === 'identity' ? <IdentityFields {...section} badge={badge('identity')} /> : null}
      {tab === 'knowledge' ? <KnowledgeFields {...section} badge={badge('knowledge')} agentId={agent.id} productCount={draft.catalogScope === 'all' ? agent.productCount : null} hasInsights={agent.pendingInsights > 0 && can('insights.manage')} /> : null}
      {tab === 'behaviour' ? <BehaviourFields {...section} badge={badge('behaviour')} /> : null}
      {tab === 'channels' ? <ChannelsFields lead agentId={agent.id} agentName={agent.name} readOnly={!manage} /> : null}

      <p className="ts-label-meta text-text-muted">
        <Ltr>{t('agents.config.versionNote', { version: base.currentVersion })}</Ltr>
      </p>
      {guard}
      <ConflictDialog open={conflict !== null} name={conflict?.by || '—'} ago={conflict?.at ? relativeTime(conflict.at, locale) : '—'} onReload={() => void reload()} onOverwrite={conflict?.current ? () => void save(conflict.current!.version) : undefined} onClose={() => setConflict(null)} />
    </div>
  );
}
