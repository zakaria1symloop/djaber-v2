'use client';
// Playground conversation (Figma "AGT-07 — Agent playground — dry run with tool calls"): the simulated customer on the
// start side, tool-call chips, the agent reply with its status line (OK · SALE · 0,97) and real product cards.
// One hook, two transports: the merchant playground (`POST /agents/:id/test`, full turn with tools and inspector data)
// and the public shared link (`POST /agent-test/:token/messages`, reply + cards only). Nothing is ever sent to a
// customer and no order is written (tools run in dry-run on the API).
import { BubbleText, Button, cn, FormAlert, IconButton, Ltr, MessageBubble, ProductCards, SystemEvent, ToolCallChip, TypingChip } from '@djaber/ui';
import { formatMoney, type TestScenarioKey } from '@djaber/shared';
import { Camera, Mic, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { formatClock, retryAfterSeconds, useCountdown } from '@/lib/countdown';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { agentsApi } from '../api';
import type { PlaygroundMessage } from '../contracts';
import { confidenceLabel, type TurnView } from '../logic';
import { uuid } from '@/lib/uuid';

export type Attachment = { kind: 'image' | 'audio'; uploadId: string; name: string; url?: string };
export type ChatInput = { text: string; attachment?: Attachment | null; scenario?: TestScenarioKey };
export type ChatEntry =
  | { id: number; role: 'user'; text: string; at: number; attachment?: Attachment | null; scenario?: TestScenarioKey }
  | { id: number; role: 'ai'; at: number; turn: TurnView }
  | { id: number; role: 'error'; at: number; message: string; code: string | null; input: ChatInput };
/** `history` = the earlier user / assistant texts; `input` = the new customer message (or a scenario key). */
export type ChatTransport = (history: PlaygroundMessage[], input: ChatInput, sessionId: string) => Promise<TurnView>;

const newSession = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? uuid() : String(Date.now()));

export function usePlayground(transport: ChatTransport) {
  const t = useT();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [typing, setTyping] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState(newSession);
  const seq = useRef(0);
  const sending = useRef(false);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const wait = useCountdown(blockedUntil);

  const send = useCallback(
    async (input: ChatInput) => {
      // the ref closes the window before `typing` re-renders (double click, the effect of `?scenario=` run twice in dev)
      if (typing || sending.current) return;
      sending.current = true;
      // a retry replaces the failed attempt: its customer bubble is neither stacked nor sent twice in the history
      const failedBefore = entriesRef.current.at(-1)?.role === 'error';
      const settled = entriesRef.current.filter((e) => e.role !== 'error');
      const kept = failedBefore ? settled.slice(0, -1) : settled;
      const history: PlaygroundMessage[] = kept.flatMap((e): PlaygroundMessage[] => (e.role === 'user' ? [{ role: 'user', text: e.text }] : e.role === 'ai' ? [{ role: 'assistant', text: e.turn.reply }] : []));
      const now = Date.now();
      setEntries([...kept, { id: ++seq.current, role: 'user' as const, text: input.text, at: now, attachment: input.attachment, scenario: input.scenario }]);
      setTyping(true);
      try {
        const turn = await transportRef.current(history, input, sessionId);
        setEntries((old) => [...old, { id: ++seq.current, role: 'ai', at: Date.now(), turn }]);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : null;
        if (code === 'PLAYGROUND_RATE_LIMITED' || (e instanceof ApiError && e.status === 429)) setBlockedUntil(Date.now() + retryAfterSeconds(e, 60) * 1000);
        setEntries((old) => [...old, { id: ++seq.current, role: 'error', at: Date.now(), message: errorMessage(e, t), code, input }]);
      } finally {
        sending.current = false;
        setTyping(false);
      }
    },
    [typing, sessionId, t],
  );
  const reset = useCallback(() => {
    setEntries([]);
    setSessionId(newSession());
  }, []);
  const last = [...entries].reverse().find((e): e is Extract<ChatEntry, { role: 'ai' }> => e.role === 'ai')?.turn ?? null;
  const failed = entries.at(-1)?.role === 'error' ? (entries.at(-1) as Extract<ChatEntry, { role: 'error' }>) : null;
  return {
    entries,
    typing,
    send,
    reset,
    last,
    sessionId,
    /** AI turns of this session */
    turns: entries.filter((e) => e.role === 'ai').length,
    /** seconds until the rate limit lifts (0 = free) */
    wait,
    retry: failed ? () => void send(failed.input) : null,
  };
}
export type Playground = ReturnType<typeof usePlayground>;

const clock = (at: number, locale: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Algiers' }).format(at);

export function PlaygroundThread({ pg, agentName, empty, showTools = true, className }: { pg: Playground; agentName: string; empty: React.ReactNode; /** the shared public page shows neither tools nor the status line */ showTools?: boolean; className?: string }) {
  const t = useT();
  const locale = useLocaleCode();
  const box = useRef<HTMLDivElement>(null);
  // follow new messages inside the thread only (scrollIntoView also scrolled the page around it); a reader who
  // scrolled up to read an older turn is left where they are
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [pg.entries.length, pg.typing]);
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4', className)}
      data-testid="playground-thread"
      aria-live="polite"
    >
      {pg.entries.length === 0 && !pg.typing ? <div className="m-auto max-w-md py-10 text-center text-[13px] text-text-muted">{empty}</div> : null}
      {pg.entries.map((e) => {
        if (e.role === 'user')
          return (
            <MessageBubble key={e.id} author="customer" meta={`${t('agents.playground.you')} · ${clock(e.at, locale)}`}>
              {e.attachment?.kind === 'image' && e.attachment.url ? <img src={e.attachment.url} alt={e.attachment.name} className="mb-1.5 max-h-40 rounded-[6px]" /> : null}
              {e.attachment?.kind === 'audio' ? <div className="ts-label-meta mb-1 text-text-muted">{t('agents.playground.voiceNote', { name: e.attachment.name })}</div> : null}
              <BubbleText>{e.text || (e.scenario ? t(`agents.scenario.${e.scenario}`) : e.attachment ? '' : '—')}</BubbleText>
            </MessageBubble>
          );
        if (e.role === 'error')
          return (
            <div key={e.id} className="mt-3" data-testid="playground-error" data-code={e.code ?? ''}>
              <FormAlert tone={e.code === 'PLAYGROUND_RATE_LIMITED' ? 'warning' : 'danger'}>
                {e.message}
                {e.code === 'PLAYGROUND_RATE_LIMITED' && pg.wait > 0 ? <> · {t('agents.playground.retryIn', { time: formatClock(pg.wait) })}</> : null}
              </FormAlert>
              {pg.retry && pg.wait === 0 ? (
                <Button size="sm" className="mt-2" onClick={pg.retry} data-testid="playground-retry">
                  {t('action.retry')}
                </Button>
              ) : null}
            </div>
          );
        const turn = e.turn;
        return (
          <div key={e.id} data-testid="playground-turn" data-status={turn.status} className="flex flex-col">
            {showTools
              ? turn.tools.map((tool, i) => (
                  <ToolCallChip key={i} className="mt-3" name={tool.name} toolLabel={t('agents.playground.tool')} simulatedLabel={t('agents.playground.simulated')} toggleLabel={t('agents.playground.toolToggle')} args={tool.args} result={tool.result} simulated={tool.simulated} failed={tool.failed} />
                ))
              : null}
            {turn.reply ? (
              <MessageBubble
                author="ai"
                meta={
                  showTools ? (
                    <Ltr>
                      {agentName} · {turn.status} · {turn.intent} · {confidenceLabel(turn.confidence, locale)}
                    </Ltr>
                  ) : (
                    `${agentName} · ${clock(e.at, locale)}`
                  )
                }
              >
                <BubbleText>{turn.reply}</BubbleText>
              </MessageBubble>
            ) : null}
            {turn.cards.length ? (
              <div className="mt-2">
                <ProductCards label={t('agents.playground.cards')} cards={turn.cards.map((c) => ({ id: c.id, name: c.name, price: formatMoney(c.price), imageUrl: c.imageUrl, variants: [c.variants, showTools ? t('agents.playground.realCard') : null].filter(Boolean).join(' · ') || null }))} />
              </div>
            ) : null}
            {turn.systemMessages.map((m) => (
              <SystemEvent key={m.key}>{t('agents.playground.systemMessage', { key: m.key, text: m.text })}</SystemEvent>
            ))}
          </div>
        );
      })}
      {pg.typing ? <TypingChip className="mt-3 self-end" label={t('agents.playground.typing', { name: agentName })} /> : null}
    </div>
  );
}

/** Text field + Envoyer, with the 📷 / 🎤 inputs of the merchant playground (uploads go through `POST /uploads`). */
export function PlaygroundComposer({ pg, placeholder, media, disabledReason }: { pg: Playground; placeholder: string; media?: boolean; disabledReason?: string }) {
  const t = useT();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const blocked = pg.wait > 0;
  const off = pg.typing || blocked || uploading || !!disabledReason;

  const submit = () => {
    const value = text.trim();
    if (off || (!value && !attachment)) return;
    void pg.send({ text: value, attachment });
    setText('');
    setAttachment(null);
    setError(null);
  };
  const pick = async (kind: 'image' | 'audio', file: File | undefined, input: HTMLInputElement | null) => {
    if (input) input.value = '';
    if (!file) return;
    setError(null);
    const max = kind === 'image' ? 5 : 25;
    if (file.size > max * 1024 * 1024) return setError(t('error.UPLOAD_TOO_LARGE', { max: `${max} MB` }));
    setUploading(true);
    try {
      const up = await agentsApi.upload(file, 'reply');
      setAttachment({ kind, uploadId: up.id, name: file.name, url: kind === 'image' ? up.url : undefined });
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="playground-composer">
      {error ? <FormAlert>{error}</FormAlert> : null}
      {blocked ? (
        <FormAlert tone="warning">
          <span data-testid="playground-rate-limited">
            {t('error.PLAYGROUND_RATE_LIMITED')} · {t('agents.playground.retryIn', { time: formatClock(pg.wait) })}
          </span>
        </FormAlert>
      ) : null}
      {attachment ? (
        <div className="flex w-fit items-center gap-2 rounded-card border border-line-edge bg-ink-raised px-2 py-1 text-[12px]" data-testid="playground-attachment">
          {attachment.kind === 'image' ? <Camera className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
          <span className="max-w-48 truncate">{attachment.name}</span>
          <button type="button" aria-label={t('agents.playground.removeAttachment')} onClick={() => setAttachment(null)} className="text-text-muted hover:text-text-primary">
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-card border border-line-edge bg-ink-surface p-2">
        {media ? (
          <>
            <IconButton size="sm" variant="ghost" label={t('agents.playground.photo')} disabled={off} onClick={() => imageRef.current?.click()}>
              <Camera className="size-4" aria-hidden />
            </IconButton>
            <IconButton size="sm" variant="ghost" label={t('agents.playground.voice')} disabled={off} onClick={() => audioRef.current?.click()}>
              <Mic className="size-4" aria-hidden />
            </IconButton>
            <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label={t('agents.playground.photo')} onChange={(e) => void pick('image', e.target.files?.[0], e.currentTarget)} />
            <input ref={audioRef} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-label={t('agents.playground.voice')} onChange={(e) => void pick('audio', e.target.files?.[0], e.currentTarget)} />
          </>
        ) : null}
        <textarea
          dir="auto"
          rows={1}
          aria-label={placeholder}
          placeholder={disabledReason ?? placeholder}
          value={text}
          maxLength={2000}
          disabled={blocked || !!disabledReason}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] placeholder:text-text-muted focus:outline-none disabled:opacity-50"
        />
        <Button variant="primary" size="sm" onClick={submit} disabled={off || (!text.trim() && !attachment)} loading={pg.typing} data-testid="playground-send">
          {t('action.send')}
        </Button>
      </div>
    </div>
  );
}
