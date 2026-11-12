'use client';
// Knowledge section (wizard step 2 = "Connaissances" of the Configuration tab) — Figma "AGT-02 — Agent wizard — step 2
// knowledge": catalogue scope, out-of-stock behaviour, shop rules (policies) and the FAQ (≤ 50 entries / 20 000
// characters; sources SAISI · EXTRAIT DE LA PAGE FB · SUGGÉRÉ PAR L'IA · FICHIER; extraction from the page is free,
// 3 per day; file import DOCX / TXT / MD / CSV ≤ 5 MB — PDF refused until a text extractor is chosen). FAQ rows are saved one by one (`/agents/:id/faq`).
import { Button, CheckChip, ConfirmDialog, Dialog, Field, FormAlert, FormSection, Input, KeyValueList, Ltr, MonoChip, Select, Textarea, toast, ToggleRow } from '@djaber/ui';
import { formatNumber } from '@djaber/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCategories } from '@/features/catalog/api';
import { flattenCategories } from '@/features/catalog/contracts';
import { useChannels } from '@/features/channels/api';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { trackJob } from '@/lib/jobs';
import { useSession, useWorkspaceId } from '@/lib/session';
import { agentKeys, agentsApi, useAgentFaq } from '../api';
import type { AgentFaq, FaqSource } from '../contracts';
import { FAQ_MAX_CHARS, FAQ_MAX_ENTRIES, POLICY_KEYS } from '../contracts';
import { POLICY_MAX } from '../logic';
import { issueText, type SectionProps } from './identity';

const FAQ_FILE_MAX = 5 * 1024 * 1024;
// M11: Word (.docx) and text files; PDF is refused by the API (no PDF text extractor — carry-over kept open)
const FAQ_FILE_TYPES = /\.(docx|txt|md|csv)$/i;
const SOURCE_TONE: Record<FaqSource, 'neutral' | 'info' | 'success'> = { manual: 'neutral', page_extraction: 'info', ai_suggested: 'success', file_import: 'neutral' };

export function KnowledgeFields({ draft: d, set, errors, readOnly, badge, inTunnel, agentId, productCount, hasInsights }: SectionProps & { agentId: string | null; productCount?: number | null; hasInsights?: boolean }) {
  const t = useT();
  const categories = useCategories();
  const flat = flattenCategories(categories.data ?? []);
  const toggleCategory = (id: string, on: boolean) => set({ scopeCategoryIds: on ? [...d.scopeCategoryIds, id] : d.scopeCategoryIds.filter((x) => x !== id) });
  const radio = 'mt-0.5 size-4 accent-white';
  // "Catégories" cannot be chosen while the shop has none (it could never pass validation); an agent already scoped on
  // categories keeps the option to fix it
  const noCategory = categories.isSuccess && flat.length === 0 && d.catalogScope !== 'categories';
  return (
    <>
      <FormSection title={t('agents.catalog.title')} description={t('agents.catalog.description')} badge={badge} data-section="catalog">
        <div role="radiogroup" aria-label={t('agents.catalog.title')} className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="catalogScope" className={radio} checked={d.catalogScope === 'all'} disabled={readOnly} onChange={() => set({ catalogScope: 'all' })} />
            <span>
              <span className="block text-[14px]">
                {productCount === null || productCount === undefined ? t('agents.catalog.all') : <Ltr>{t('agents.catalog.allCount', { count: productCount })}</Ltr>}
              </span>
              <span className="ts-label-meta mt-1 block text-text-muted">{t('agents.catalog.all.hint')}</span>
            </span>
          </label>
          <label className={noCategory ? 'flex cursor-not-allowed items-start gap-3 opacity-60' : 'flex cursor-pointer items-start gap-3'} title={noCategory ? t('gaps.agents.catalog.noCategory') : undefined} data-testid="scope-categories-option">
            <input type="radio" name="catalogScope" className={radio} checked={d.catalogScope === 'categories'} disabled={readOnly || noCategory} onChange={() => set({ catalogScope: 'categories' })} />
            <span>
              <span className="block text-[14px]">{t('agents.catalog.categories')}</span>
              <span className="ts-label-meta mt-1 block text-text-muted">{t('agents.catalog.categories.hint')}</span>
              {noCategory && !inTunnel ? (
                <span className="ts-label-meta mt-1 block text-text-muted" data-testid="scope-categories-disabled">
                  {t('gaps.agents.catalog.noCategory')}{' '}
                  <Link href="/categories" className="text-accent-inbound underline underline-offset-2">
                    {t('nav.categories')}
                  </Link>
                </span>
              ) : null}
            </span>
          </label>
        </div>
        {d.catalogScope === 'categories' ? (
          <div className="ps-7" data-testid="scope-categories">
            {flat.length ? (
              <div role="group" aria-label={t('agents.catalog.categories')} className="flex flex-wrap gap-2">
                {flat.map((c) => (
                  <CheckChip key={c.id} name={c.id} checked={d.scopeCategoryIds.includes(c.id)} disabled={readOnly} onChange={(on) => toggleCategory(c.id, on)}>
                    {c.label}
                  </CheckChip>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-text-muted">
                {t('agents.catalog.noCategory')}
                {inTunnel ? null : (
                  <>
                    {' '}
                    <Link href="/categories" className="text-accent-inbound underline underline-offset-2">
                      {t('nav.categories')}
                    </Link>
                  </>
                )}
              </p>
            )}
            {errors.scopeCategoryIds ? (
              <p role="alert" className="mt-2 text-[12px] text-accent-alert">
                {issueText(t, errors.scopeCategoryIds)}
              </p>
            ) : null}
          </div>
        ) : null}
        <ToggleRow name="outOfStock" checked={d.outOfStockBehavior === 'suggest_alternative'} disabled={readOnly} onChange={(on) => set({ outOfStockBehavior: on ? 'suggest_alternative' : 'say_unavailable' })} title={t('agents.catalog.outOfStock')} description={t('agents.catalog.outOfStock.hint')} />
        <ToggleRow name="missingVariants" checked={d.showMissingVariants} disabled={readOnly} onChange={(on) => set({ showMissingVariants: on })} title={t('agents.catalog.missingVariants')} description={t('agents.catalog.missingVariants.hint')} />
      </FormSection>

      <FormSection title={t('agents.policies.title')} description={t('agents.policies.description')} data-section="policies">
        {POLICY_KEYS.map((k) => {
          const issue = errors[`policies.${k}`];
          return (
            <div key={k} className="grid items-start gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
              <label htmlFor={`policy-${k}`} className="ts-label-meta pt-3 uppercase text-text-secondary">
                {t(`agents.policies.${k}`)}
              </label>
              <div>
                <Input id={`policy-${k}`} dir="auto" value={d.policies[k] ?? ''} maxLength={POLICY_MAX + 50} disabled={readOnly} placeholder={t(`agents.policies.${k}.placeholder`)} aria-invalid={!!issue || undefined} onChange={(e) => set({ policies: { ...d.policies, [k]: e.target.value } })} />
                {issue ? (
                  <p role="alert" className="mt-1 text-[12px] text-accent-alert">
                    {issueText(t, issue)}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </FormSection>

      <FaqSection agentId={agentId} readOnly={readOnly} hasInsights={hasInsights} />
    </>
  );
}

/** FAQ & extra knowledge of one agent. Before the draft exists (step 1 not saved) the section explains why it is empty. */
export function FaqSection({ agentId, readOnly, hasInsights }: { agentId: string | null; readOnly?: boolean; hasInsights?: boolean }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useAgentFaq(agentId);
  const channels = useChannels(can('channels.read') && !readOnly);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<AgentFaq | 'new' | null>(null);
  const [extract, setExtract] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // a FAQ row is deleted at once on the server (not part of "Annuler les modifications"): asked first
  const [toRemove, setToRemove] = useState<AgentFaq | null>(null);
  const rows = q.data ?? [];
  const chars = rows.reduce((n, r) => n + r.question.length + r.answer.length, 0);
  const full = rows.length >= FAQ_MAX_ENTRIES || chars >= FAQ_MAX_CHARS;
  // the page is read with its token: only a live page can be read (paused, to reconnect, pending ⇒ not offered)
  const facebook = (channels.data?.rows ?? []).filter((c) => c.platform === 'facebook' && c.status !== 'disconnected');
  const pages = facebook.filter((c) => c.status === 'active');
  const noPageReason = pages.length ? undefined : facebook.length ? t('gaps.agents.faq.extract.noActivePage') : t('agents.faq.extract.noPage');
  const refetch = () => qc.invalidateQueries({ queryKey: agentKeys.sub(ws, agentId ?? '', 'faq') });

  const follow = (jobId: string, kind: 'extract' | 'import') =>
    trackJob({
      jobId,
      started: t(`agents.faq.${kind}.started`),
      progress: (job) => t(`agents.faq.${kind}.progress`, { pct: Math.round(job.progress) }),
      done: (job) => {
        void refetch();
        const added = Number((job.result as { added?: number; created?: number } | null)?.added ?? (job.result as { created?: number } | null)?.created ?? 0);
        return { message: t('agents.faq.job.done', { count: added }) };
      },
      failed: (job, e) => (job?.error?.message ? job.error.message : e ? errorMessage(e, t) : t('agents.faq.job.failed')),
    });

  const remove = async (id: string) => {
    if (!agentId) return;
    setBusy(id);
    setError(null);
    try {
      await agentsApi.removeFaq(agentId, id);
      await refetch();
      setToRemove(null);
    } catch (e) {
      setError(errorMessage(e, t));
      setToRemove(null);
    } finally {
      setBusy(null);
    }
  };
  const startExtract = async (channelId: string) => {
    if (!agentId) return;
    setBusy('extract');
    setError(null);
    try {
      follow((await agentsApi.extractFaq(agentId, channelId)).jobId, 'extract');
      setExtract(false);
    } catch (e) {
      // ANALYSIS_RATE_LIMITED is a toast (11 §4); the rest stays inline
      if (e instanceof ApiError && e.code === 'ANALYSIS_RATE_LIMITED') toast({ tone: 'warning', message: errorMessage(e, t) });
      else setError(errorMessage(e, t));
      setExtract(false);
    } finally {
      setBusy(null);
    }
  };
  const onFile = async (file: File | undefined) => {
    if (!file || !agentId) return;
    setError(null);
    if (!FAQ_FILE_TYPES.test(file.name)) setError(t('error.UPLOAD_TYPE_INVALID'));
    else if (file.size > FAQ_FILE_MAX) setError(t('error.UPLOAD_TOO_LARGE', { max: '5 MB' }));
    else {
      setBusy('import');
      try {
        // the import is answered at once (`{ created, skipped }`): entries already in the FAQ are skipped, not duplicated
        const r = await agentsApi.importFaq(agentId, file);
        await refetch();
        toast({ tone: 'success', message: r.skipped ? t('carry.faq.imported', { count: r.created.length, skipped: r.skipped }) : t('agents.faq.job.done', { count: r.created.length }) });
      } catch (e) {
        setError(errorMessage(e, t));
      } finally {
        setBusy(null);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <FormSection
      title={t('agents.faq.title')}
      description={
        <>
          {t('agents.faq.description', { max: FAQ_MAX_ENTRIES, chars: formatNumber(FAQ_MAX_CHARS) })}{' '}
          <span data-testid="faq-count">
            <Ltr className="ts-label-meta text-text-muted">{t('agents.faq.count', { count: rows.length, max: FAQ_MAX_ENTRIES })}</Ltr>
          </span>
        </>
      }
      data-section="faq"
    >
      {!agentId ? (
        <p className="text-[13px] text-text-muted">{t('agents.faq.needsDraft')}</p>
      ) : q.isError ? (
        <FormAlert>{errorMessage(q.error, t)}</FormAlert>
      ) : (
        <KeyValueList
          items={rows.map((r) => ({
            id: r.id,
            key: r.question,
            value: r.answer,
            tag: <MonoChip tone={SOURCE_TONE[r.source] ?? 'neutral'}>{r.source === 'ai_suggested' && r.askedCount ? t('agents.faq.source.ai_suggested.count', { count: r.askedCount }) : t(`agents.faq.source.${r.source}`)}</MonoChip>,
          }))}
          disabled={readOnly || busy !== null}
          onEdit={(id) => setEditing(rows.find((r) => r.id === id) ?? null)}
          onRemove={(id) => setToRemove(rows.find((r) => r.id === id) ?? null)}
          labels={{ list: t('agents.faq.title'), edit: (k) => t('agents.faq.edit', { question: k }), remove: (k) => t('agents.faq.remove', { question: k }) }}
          empty={q.isPending ? t('common.loading') : t('agents.faq.empty')}
        />
      )}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {full && agentId ? (
        <FormAlert tone="warning">
          {t('error.AGENT_FAQ_LIMIT')} <Ltr>(AGENT_FAQ_LIMIT)</Ltr>
        </FormAlert>
      ) : null}
      {agentId && !readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setEditing('new')} disabledReason={full ? t('error.AGENT_FAQ_LIMIT') : undefined} data-testid="faq-add">
            {t('agents.faq.add')}
          </Button>
          <Button variant="ghost" onClick={() => (pages.length === 1 ? void startExtract(pages[0]!.id) : setExtract(true))} loading={busy === 'extract'} disabledReason={noPageReason ?? (full ? t('error.AGENT_FAQ_LIMIT') : undefined)} data-testid="faq-extract">
            {t('agents.faq.extract')}
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} loading={busy === 'import'} disabledReason={full ? t('error.AGENT_FAQ_LIMIT') : undefined} data-testid="faq-import">
            {t('carry.faq.import')}
          </Button>
          <input ref={fileRef} type="file" accept=".docx,.txt,.md,.csv" data-upload="faq-import" className="sr-only" tabIndex={-1} aria-label={t('carry.faq.import')} onChange={(e) => void onFile(e.target.files?.[0])} />
          {hasInsights ? (
            <Link href={`/agents/${agentId}/insights`} className="ms-auto text-[13px] text-accent-inbound hover:underline">
              {t('agents.faq.unanswered')}
            </Link>
          ) : null}
        </div>
      ) : null}
      <FaqDialog agentId={agentId} entry={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), void refetch())} />
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(o) => !o && busy === null && setToRemove(null)}
        title={t('gaps.agents.faq.remove.title')}
        description={t('gaps.agents.faq.remove.description', { question: toRemove?.question ?? '' })}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        destructive
        loading={toRemove !== null && busy === toRemove.id}
        closeLabel={t('action.close')}
        onConfirm={() => toRemove && void remove(toRemove.id)}
      />
      <ExtractDialog open={extract} pages={pages.map((p) => ({ id: p.id, name: p.name }))} pending={busy === 'extract'} onClose={() => setExtract(false)} onStart={(id) => void startExtract(id)} />
    </FormSection>
  );
}

function FaqDialog({ agentId, entry, onClose, onSaved }: { agentId: string | null; entry: AgentFaq | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!entry) return;
    setQuestion(entry === 'new' ? '' : entry.question);
    setAnswer(entry === 'new' ? '' : entry.answer);
    setFields({});
    setError(null);
  }, [entry]);
  const submit = async () => {
    if (!agentId || !entry) return;
    const missing: Record<string, string> = {};
    if (!question.trim()) missing.question = 'validation.required';
    if (!answer.trim()) missing.answer = 'validation.required';
    setFields(missing);
    if (Object.keys(missing).length) return;
    setPending(true);
    setError(null);
    try {
      const body = { question: question.trim(), answer: answer.trim() };
      if (entry === 'new') await agentsApi.addFaq(agentId, body);
      else await agentsApi.updateFaq(agentId, entry.id, body);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.body.fields).length) setFields(e.body.fields);
      else setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={entry === 'new' ? t('agents.faq.dialog.add') : t('agents.faq.dialog.edit')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} data-testid="faq-save">
            {t('action.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('agents.faq.question')} htmlFor="faq-question" required error={fieldError(t, fields.question, { max: 300 })}>
          <Input id="faq-question" dir="auto" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} aria-invalid={!!fields.question || undefined} />
        </Field>
        <Field label={t('agents.faq.answer')} htmlFor="faq-answer" required error={fieldError(t, fields.answer, { max: 2000 })}>
          <Textarea id="faq-answer" dir="auto" maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-invalid={!!fields.answer || undefined} />
        </Field>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

function ExtractDialog({ open, pages, pending, onClose, onStart }: { open: boolean; pages: { id: string; name: string }[]; pending: boolean; onClose: () => void; onStart: (channelId: string) => void }) {
  const t = useT();
  const [id, setId] = useState('');
  useEffect(() => {
    if (open) setId(pages[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('agents.faq.extract.title')}
      description={t('agents.faq.extract.description')}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => id && onStart(id)} loading={pending} disabled={!id}>
            {t('agents.faq.extract.start')}
          </Button>
        </>
      }
    >
      <Field label={t('agents.faq.extract.page')} htmlFor="faq-extract-page">
        <Select id="faq-extract-page" value={id} onChange={(e) => setId(e.target.value)}>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}
