'use client';
// DLG "Résoudre l'insight" (Figma "DLG — Agents & channels"): add an instruction to the agent · create a FAQ entry ·
// ignore the topic for 30 days. `POST /agent-insights/:id/resolve` is the only resolution endpoint; a colleague who
// was faster answers `INSIGHT_ALREADY_RESOLVED` (toast, the row leaves the list). Used by the Insights tab of an agent,
// the queue ("PROBLÈMES SIGNALÉS") and the thread ("Insights IA de ce fil").
import { Button, Dialog, Field, FormAlert, Input, RadioCards, Textarea, toast } from '@djaber/ui';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage, fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { agentsApi } from '../api';
import type { AgentInsight, InsightResolveAction } from '../contracts';

export const INSTRUCTION_MAX = 500;
const ACTIONS: InsightResolveAction[] = ['instruction', 'faq', 'ignored_30d'];

/** Resolves or ignores without the dialog ("Ignorer" of a row, "Ajouter aux instructions" of the queue uses the dialog). */
export async function ignoreInsight(insight: AgentInsight) {
  return agentsApi.resolveInsight(insight.id, { action: 'ignored_30d' });
}
export const isAlreadyResolved = (e: unknown) => e instanceof ApiError && e.code === 'INSIGHT_ALREADY_RESOLVED';

export function ResolveInsightDialog({
  insight,
  initialAction = 'instruction',
  onClose,
  onDone,
}: {
  insight: AgentInsight | null;
  initialAction?: InsightResolveAction;
  onClose: () => void;
  /** resolved here, or already handled by a colleague (`already`): the row leaves the pending list */
  onDone: (insight: AgentInsight, outcome: { action: InsightResolveAction; already: boolean }) => void;
}) {
  const t = useT();
  const [action, setAction] = useState<InsightResolveAction>(initialAction);
  const [instruction, setInstruction] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!insight) return;
    setAction(initialAction);
    setInstruction('');
    setQuestion(insight.customerMessage.slice(0, 300));
    setAnswer('');
    setFields({});
    setError(null);
  }, [insight, initialAction]);

  const submit = async () => {
    if (!insight) return;
    const missing: Record<string, string> = {};
    if (action === 'instruction' && !instruction.trim()) missing.instruction = 'validation.required';
    if (action === 'faq' && !question.trim()) missing.question = 'validation.required';
    if (action === 'faq' && !answer.trim()) missing.answer = 'validation.required';
    setFields(missing);
    if (Object.keys(missing).length) return;
    setPending(true);
    setError(null);
    try {
      await agentsApi.resolveInsight(insight.id, action === 'instruction' ? { action, instruction: instruction.trim() } : action === 'faq' ? { action, question: question.trim(), answer: answer.trim() } : { action });
      onDone(insight, { action, already: false });
    } catch (e) {
      if (isAlreadyResolved(e)) {
        toast({ tone: 'info', message: t('error.INSIGHT_ALREADY_RESOLVED') });
        onDone(insight, { action, already: true });
      } else if (e instanceof ApiError && Object.keys(e.body.fields).length) setFields(e.body.fields);
      else setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={insight !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t('dialog.resolveInsight.title')}
      description={insight ? t('agents.insights.resolve.context', { type: t(`agents.insights.type.${insight.type}`), count: insight.occurrences }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} data-testid="resolve-insight-submit">
            {action === 'ignored_30d' ? t('action.dismiss') : t('action.resolve')}
          </Button>
        </>
      }
    >
      {insight ? (
        <div className="flex flex-col gap-4" data-testid="resolve-insight">
          <blockquote dir="auto" className="rounded-card border border-line-edge bg-ink-raised px-3 py-2.5 ts-label-meta text-text-secondary">
            {t('agents.insights.resolve.quote', { customer: insight.customerMessage, ai: insight.aiResponse ?? '—' })}
          </blockquote>
          <RadioCards
            label={t('dialog.resolveInsight.title')}
            columns={1}
            value={action}
            onChange={setAction}
            options={ACTIONS.map((a) => ({ value: a, label: t(`agents.insights.resolve.${a}`), description: t(`agents.insights.resolve.${a}.hint`) }))}
          />
          {action === 'instruction' ? (
            <Field label={t('agents.insights.resolve.instruction.label')} htmlFor="insight-instruction" error={fieldError(t, fields.instruction, { max: INSTRUCTION_MAX })} hint={t('agents.insights.resolve.instruction.note')}>
              <Textarea id="insight-instruction" dir="auto" maxLength={INSTRUCTION_MAX} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('agents.insights.resolve.instruction.placeholder')} aria-invalid={!!fields.instruction || undefined} />
            </Field>
          ) : null}
          {action === 'faq' ? (
            <>
              <Field label={t('agents.faq.question')} htmlFor="insight-question" error={fieldError(t, fields.question, { max: 300 })}>
                <Input id="insight-question" dir="auto" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} aria-invalid={!!fields.question || undefined} />
              </Field>
              <Field label={t('agents.faq.answer')} htmlFor="insight-answer" error={fieldError(t, fields.answer, { max: 2000 })}>
                <Textarea id="insight-answer" dir="auto" maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-invalid={!!fields.answer || undefined} />
              </Field>
            </>
          ) : null}
          <p className="ts-label-meta text-text-muted">{t('agents.insights.resolve.alreadyNote')}</p>
          {error ? <FormAlert>{error}</FormAlert> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
