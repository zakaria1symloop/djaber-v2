'use client';
// Agent playground (Figma "AGT-07 — Agent playground — dry run with tool calls"): simulation banner, conversation with
// tool-call chips and real product cards, scenario chips, photo / voice inputs, inspector of the last turn (status,
// intent + confidence, model, tokens, latency, tools, credits in production, cards, language, system prompt preview)
// and the quick fixes "Ajouter une instruction depuis ce tour" / "Signaler une mauvaise réponse (eval)".
// 60 turns / h / workspace (`PLAYGROUND_RATE_LIMITED`); a test never consumes credits.
import { Button, buttonClass, Dialog, Field, FormAlert, InspectorPanel, Ltr, MonoChip, Textarea, toast, type InspectorRow } from '@djaber/ui';
import { formatNumber, PLAYGROUND_TURNS_PER_HOUR, type TestScenarioKey } from '@djaber/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { agentsApi, useAgentsRefresh, useReadiness } from '../api';
import type { Agent } from '../contracts';
import { SCENARIO_KEYS } from '../contracts';
import { INSTRUCTION_MAX } from '../insights/resolve-dialog';
import { confidenceLabel, pendingCatalogue, secondsLabel, statusTone, turnIntentLabel, turnStatusLabel, turnView, type TurnView } from '../logic';
import { ModelBadge } from '../ui';
import { downloadJson } from '../use-agent-actions';
import { PlaygroundComposer, PlaygroundThread, usePlayground, type ChatTransport, type Playground as Pg } from './chat';

/** Transport of the merchant playground: the whole conversation is sent at every turn (the API is stateless). */
export const agentTransport =
  (agentId: string): ChatTransport =>
  async (history, input, sessionId, { turnKey, signal }) => {
    // full-test 15/11 AGENTS-03: a chip clicked later in the thread sends the history + the scenario (the server adds its message)
    if (input.scenario && !input.text) return turnView(await agentsApi.test(agentId, { sessionId, turnKey, messages: history, scenario: input.scenario }, { signal }));
    const message = { role: 'user' as const, text: input.text, ...(input.attachment?.kind === 'image' ? { imageUploadId: input.attachment.uploadId } : {}), ...(input.attachment?.kind === 'audio' ? { audioUploadId: input.attachment.uploadId } : {}) };
    return turnView(await agentsApi.test(agentId, { sessionId, turnKey, messages: [...history, message] }, { signal }));
  };

export function inspectorRows(t: ReturnType<typeof useT>, locale: string, turn: TurnView): InspectorRow[] {
  return [
    { key: 'status', label: t('agents.inspector.status'), value: turnStatusLabel(t, turn.status), tone: statusTone(turn.status) },
    { key: 'intent', label: t('agents.inspector.intent'), value: t('agents.inspector.intentValue', { intent: turnIntentLabel(t, turn.intent), confidence: confidenceLabel(turn.confidence, locale) }) },
    { key: 'model', label: t('agents.inspector.model'), value: turn.model ? <Ltr>{turn.model}</Ltr> : t('agents.model.readOnly') },
    { key: 'tokens', label: t('agents.inspector.tokens'), value: <Ltr>{t('agents.inspector.tokensValue', { input: formatNumber(turn.tokens.input), output: formatNumber(turn.tokens.output) })}</Ltr> },
    { key: 'latency', label: t('agents.inspector.latency'), value: <Ltr>{secondsLabel(turn.latencyMs, locale)}</Ltr> },
    { key: 'tools', label: t('agents.inspector.tools'), value: <Ltr>{t('agents.inspector.toolsValue', { count: turn.tools.length, simulated: turn.simulatedTools })}</Ltr> },
    { key: 'credits', label: t('agents.inspector.credits'), value: <Ltr>{t('agents.inspector.creditsValue', { count: turn.creditsInProd })}</Ltr> },
    { key: 'cards', label: t('agents.inspector.cards'), value: <Ltr>{t('agents.inspector.cardsValue', { count: turn.cards.length })}</Ltr> },
    { key: 'language', label: t('agents.inspector.language'), value: turn.language || '—', tone: 'success' },
  ];
}

/** Thread + scenario chips + composer: also embedded in step 5 of the wizard ("Tester moi-même", scenario "Ouvrir ›"). */
export function PlaygroundPane({ pg, agent, scenarios = true, className }: { pg: Pg; agent: Pick<Agent, 'id' | 'name'>; scenarios?: boolean; className?: string }) {
  const t = useT();
  // journey 16/11 J04-1: none of the agent's products is validated by Djaber yet — say why it answers that nothing is online
  const waiting = pendingCatalogue(useReadiness(agent.id).data?.checks);
  return (
    <div className={className ?? 'flex min-h-[28rem] min-w-0 flex-col'}>
      <div role="status" data-testid="playground-banner" className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-card border border-line-hairline bg-ink-surface px-3 py-2 ts-label-meta text-text-muted">
        <MonoChip tone="warning">{t('agents.playground.simulation')}</MonoChip>
        {/* basis: on a phone the turn counter goes under the sentence instead of squeezing it into a narrow column;
            full-test 15/11 AI-CHAT-15: below 640 px the sentence is hidden once the conversation started (the thread needs the height) */}
        <span className={pg.entries.length ? 'hidden min-w-0 flex-1 basis-48 sm:inline' : 'min-w-0 flex-1 basis-48'}>{t('agents.playground.banner')}</span>
        {/* AI-CHAT-11: the turns of the workspace this hour (the limit is per workspace), not of this window */}
        <span data-testid="playground-turns">
          <Ltr>{t('agents.playground.turns', { used: pg.hourly, limit: PLAYGROUND_TURNS_PER_HOUR })}</Ltr>
        </span>
      </div>
      {waiting ? (
        <FormAlert tone="warning" className="mx-4 mb-2">
          <span data-testid="playground-pending-products">
            {t('agents.playground.pendingProducts', { count: formatNumber(waiting) })}{' '}
            <Link href="/products?moderationStatus=pending" className="underline">
              {t('action.view')}
            </Link>
          </span>
        </FormAlert>
      ) : null}
      <PlaygroundThread pg={pg} agentName={agent.name} empty={t('agents.playground.empty')} />
      <div className="flex flex-col gap-2 border-t border-line-hairline px-4 pt-3">
        {scenarios ? (
          // full-test 15/11 AI-CHAT-15: one scrolling row on a phone (the 8 chips took ~40 % of the dialog's height)
          <div role="group" aria-label={t('agents.playground.scenarios')} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {SCENARIO_KEYS.map((k) => (
              <button key={k} type="button" data-scenario={k} disabled={pg.typing || pg.wait > 0} onClick={() => void pg.send({ text: '', scenario: k })} className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-[4px] border border-line-edge px-2 ts-label-meta text-text-secondary hover:border-line-lit hover:text-text-primary disabled:opacity-50">
                {t(`agents.scenario.${k}`)}
              </button>
            ))}
          </div>
        ) : null}
        <PlaygroundComposer pg={pg} media placeholder={t('agents.playground.placeholder')} shortPlaceholder={t('agents.playground.placeholderShort')} />
      </div>
    </div>
  );
}

export function PlaygroundInspector({ pg, agent, children }: { pg: Pg; agent: Agent; children?: ReactNode }) {
  const t = useT();
  const locale = useLocaleCode();
  const { can } = useSession();
  const refresh = useAgentsRefresh();
  const turn = pg.last;
  const [dialog, setDialog] = useState<'instruction' | 'flag' | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText('');
    setError(null);
  }, [dialog]);

  const submit = async () => {
    if (!dialog || !turn) return;
    if (dialog === 'instruction' && !text.trim()) return setError(t('validation.required'));
    setPending(true);
    setError(null);
    try {
      if (dialog === 'instruction') {
        const fresh = await agentsApi.get(agent.id);
        const line = `- ${text.trim()}`;
        await agentsApi.update(agent.id, { customInstructions: fresh.customInstructions.trim() ? `${fresh.customInstructions.trim()}\n${line}` : line, version: fresh.version, note: t('agents.inspector.instructionNote') });
        await refresh(agent.id);
        toast(t('agents.inspector.instructionAdded'));
      } else {
        await agentsApi.flagTurn(agent.id, { turnId: turn.turnId ?? '', ...(text.trim() ? { note: text.trim() } : {}) });
        toast(t('agents.inspector.flagged'));
      }
      setDialog(null);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label={t('agents.inspector.title')}>
      {turn ? (
        <>
          <InspectorPanel title={t('agents.inspector.title')} rows={inspectorRows(t, locale, turn)} />
          <section className="flex flex-col gap-2">
            <h2 className="ts-label-section text-text-muted">{t('agents.inspector.prompt')}</h2>
            <ul className="flex flex-col gap-1 rounded-card border border-line-edge bg-ink-surface p-3 text-[13px] text-text-secondary [overflow-wrap:anywhere]" data-testid="prompt-preview">
              {turn.prompt.length ? (
                turn.prompt.map((line) => (
                  <li key={line} dir="auto">
                    • {line}
                  </li>
                ))
              ) : (
                <li className="text-text-muted">—</li>
              )}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="ts-label-section text-text-muted">{t('agents.inspector.fix')}</h2>
            {can('agents.manage') ? (
              <Button onClick={() => setDialog('instruction')} data-testid="turn-add-instruction">
                {t('agents.inspector.addInstruction')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setDialog('flag')} disabledReason={turn.turnId ? undefined : t('agents.inspector.flagUnavailable')} data-testid="turn-flag">
              {t('agents.inspector.flag')}
            </Button>
          </section>
        </>
      ) : (
        <InspectorPanel title={t('agents.inspector.title')} rows={[{ key: 'empty', label: t('agents.inspector.status'), value: <span className="text-text-muted">{t('agents.inspector.empty')}</span> }]} />
      )}
      {children}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && !pending && setDialog(null)}
        title={dialog === 'flag' ? t('agents.inspector.flag') : t('agents.inspector.addInstruction')}
        description={dialog === 'flag' ? t('agents.inspector.flag.description') : t('agents.inspector.addInstruction.description')}
        closeLabel={t('action.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} loading={pending} data-testid="turn-dialog-submit">
              {dialog === 'flag' ? t('action.report') : t('action.add')}
            </Button>
          </>
        }
      >
        <Field label={dialog === 'flag' ? t('common.noteOptional') : t('agents.insights.resolve.instruction.label')} htmlFor="turn-dialog-text">
          <Textarea id="turn-dialog-text" dir="auto" maxLength={INSTRUCTION_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={dialog === 'instruction' ? t('agents.insights.resolve.instruction.placeholder') : undefined} />
        </Field>
        {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
      </Dialog>
    </aside>
  );
}

/** /agents/[id]/playground */
export function AgentPlayground({ agent, initialScenario }: { agent: Agent; initialScenario?: TestScenarioKey | null }) {
  const t = useT();
  const { can } = useSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transport = useCallback(agentTransport(agent.id), [agent.id]);
  const pg = usePlayground(transport, { usage: () => agentsApi.testUsage(agent.id) });
  const [exporting, setExporting] = useState(false);
  const { send } = pg;
  useEffect(() => {
    if (initialScenario) void send({ text: '', scenario: initialScenario });
    // the scenario of the link runs once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const exportConversation = async () => {
    setExporting(true);
    try {
      downloadJson(await agentsApi.exportTest(agent.id, pg.sessionId), `playground-${pg.sessionId.slice(0, 8)}.json`);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setExporting(false);
    }
  };
  return (
    // ≥ 1280 the page frame has the height of the content area (AppPage `fill`): the chat takes what is left and
    // scrolls inside, the composer stays on screen; below, the stacked layout keeps a fixed chat height
    <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1" data-testid="agent-playground">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ts-title">{t('agents.playground.title', { name: agent.name })}</h2>
        <ModelBadge label={agent.model?.label ?? ''} />
        <span className="flex-1" />
        <Button variant="ghost" onClick={pg.reset} disabled={pg.entries.length === 0 || pg.typing} data-testid="playground-reset">
          {t('agents.playground.reset')}
        </Button>
        {can('agents.manage') ? (
          <Link href={`/agents/${agent.id}/configuration`} className={buttonClass()}>
            {t('agents.playground.editAgent')}
          </Link>
        ) : null}
        <Button variant="ghost" onClick={exportConversation} loading={exporting} disabled={pg.turns === 0} data-testid="playground-export">
          {t('agents.playground.export')}
        </Button>
      </div>
      <p className="-mt-2 text-[13px] text-text-secondary">{t('agents.playground.description')}</p>
      <div className="grid items-start gap-5 xl:min-h-88 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)] xl:items-stretch">
        <div className="flex min-w-0 flex-col rounded-card border border-line-edge bg-ink-base py-4">
          <PlaygroundPane pg={pg} agent={agent} className="flex h-[min(70vh,44rem)] min-h-[28rem] min-w-0 flex-col xl:h-auto xl:min-h-0 xl:flex-1" />
        </div>
        <div className="min-w-0 xl:min-h-0 xl:overflow-y-auto">
          <PlaygroundInspector pg={pg} agent={agent} />
        </div>
      </div>
    </div>
  );
}
