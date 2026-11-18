'use client';
// Playground conversation (Figma "AGT-07 — Agent playground — dry run with tool calls"): the simulated customer on the
// start side, tool-call chips, the agent reply with its status line (OK · SALE · 0,97) and real product cards.
// One hook, two transports: the merchant playground (`POST /agents/:id/test`, full turn with tools and inspector data)
// and the public shared link (`POST /agent-test/:token/messages`, reply + cards only). Nothing is ever sent to a
// customer and no order is written (tools run in dry-run on the API).
import { BubbleText, Button, cn, FormAlert, IconButton, Ltr, MessageBubble, ProductCards, SystemEvent, ToolCallChip, TypingChip } from '@djaber/ui';
import { formatMoney, PLAYGROUND_TURNS_PER_HOUR, type TestScenarioKey } from '@djaber/shared';
import { Camera, Mic, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { formatClock, retryAfterSeconds, useCountdown } from '@/lib/countdown';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { agentsApi } from '../api';
import type { PlaygroundMessage } from '../contracts';
import { cardPriceText, confidenceLabel, SYSTEM_BEFORE_REPLY, turnIntentLabel, turnStatusLabel, type TurnView } from '../logic';
import { uuid } from '@/lib/uuid';
import { resendWhileStalled, TurnStalledError } from './resend';

export type Attachment = { kind: 'image' | 'audio'; uploadId: string; name: string; url?: string };
export type ChatInput = { text: string; attachment?: Attachment | null; scenario?: TestScenarioKey };
export type ChatEntry =
  | { id: number; role: 'user'; text: string; at: number; attachment?: Attachment | null; scenario?: TestScenarioKey }
  | { id: number; role: 'ai'; at: number; turn: TurnView }
  | { id: number; role: 'error'; at: number; message: string; code: string | null; input: ChatInput };
/**
 * `history` = the earlier user / assistant texts; `input` = the new customer message (or a scenario key); `turn` = the key of this
 * turn (the same on a resend, journey retest R10-1) and the signal that aborts a stalled attempt.
 */
export type ChatTransport = (history: PlaygroundMessage[], input: ChatInput, sessionId: string, turn: { turnKey: string; signal: AbortSignal }) => Promise<TurnView>;

const newSession = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? uuid() : String(Date.now()));

/**
 * AI-CHAT-11 retest (journey J03): the workspace's turns this hour as the server last counted them in this tab — a dialog
 * opened again started at « 0 tour cette heure » while 14 turns were used (the count is the workspace's, not the dialog's).
 */
let lastHourly: { used: number; at: number } | null = null;
const knownHourly = (): number | null => (lastHourly && Date.now() - lastHourly.at < 3_600_000 ? lastHourly.used : null);
const rememberHourly = (used: number) => {
  lastHourly = { used, at: Date.now() };
};

/** journey re-run J04r-6 / AI-CHAT-11: reads the workspace's test turns of the hour when the playground opens (`GET /agents/:id/test/usage`). */
export type UsageReader = () => Promise<{ used: number; retryAfter: number | null }>;

export function usePlayground(transport: ChatTransport, o: { usage?: UsageReader } = {}) {
  const t = useT();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [typing, setTyping] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  /** playground turns of the workspace this hour, as the server counted them (null until the first answer) */
  const [hourly, setHourly] = useState<number | null>(knownHourly);
  const [sessionId, setSessionId] = useState(newSession);
  const seq = useRef(0);
  const sending = useRef(false);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const wait = useCountdown(blockedUntil);
  // journey re-run J04r-6 / AI-CHAT-11 (18/11): the header said « 0 tour cette heure » on every opening (57 / 60 used) until the first
  // answer — the server's count is read once on opening; at the limit the composer waits for the rest of the hour at once
  const usageRef = useRef(o.usage);
  usageRef.current = o.usage;
  useEffect(() => {
    let live = true;
    usageRef
      .current?.()
      .then((u) => {
        if (!live) return;
        setHourly((h) => (h === null || u.used > h ? u.used : h));
        rememberHourly(u.used);
        if (u.retryAfter && u.retryAfter > 0) setBlockedUntil(Date.now() + u.retryAfter * 1000);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const send = useCallback(
    async (input: ChatInput, opts: { retry?: boolean } = {}) => {
      // the ref closes the window before `typing` re-renders (double click, the effect of `?scenario=` run twice in dev)
      if (typing || sending.current) return;
      sending.current = true;
      // « Réessayer » replaces the failed attempt: its customer bubble is neither stacked nor sent twice in the history.
      // journey 16/11 J05-16: a new message after a failed turn keeps the failed one (bubble + error line) — the customer did
      // write it, and the next turns are sent with it (the phone number typed in the failed turn was lost and the agent
      // asked for it again)
      const all = entriesRef.current;
      const lastUser = all.map((e) => e.role).lastIndexOf('user');
      const kept = opts.retry && all.at(-1)?.role === 'error' && lastUser >= 0 ? all.slice(0, lastUser) : all;
      const history: PlaygroundMessage[] = kept.flatMap((e): PlaygroundMessage[] => (e.role === 'user' ? (e.text ? [{ role: 'user', text: e.text }] : []) : e.role === 'ai' ? [{ role: 'assistant', text: e.turn.reply }] : []));
      const now = Date.now();
      setEntries([...kept, { id: ++seq.current, role: 'user' as const, text: input.text, at: now, attachment: input.attachment, scenario: input.scenario }]);
      setTyping(true);
      try {
        // journey retest R10-1: an answer stuck on its way is asked again with the same key (the same turn on the server)
        const turnKey = uuid();
        const turn = await resendWhileStalled((signal) => transportRef.current(history, input, sessionId, { turnKey, signal }));
        if (typeof turn.hourlyUsed === 'number') {
          setHourly(turn.hourlyUsed);
          rememberHourly(turn.hourlyUsed);
        }
        // a scenario chip: the customer bubble takes the message the server sent (shown, and part of the next turns' history)
        const said = (turn as { customerText?: string }).customerText;
        setEntries((old) => [...old.map((e) => (said && e.role === 'user' && e.at === now && !e.text ? { ...e, text: said } : e)), { id: ++seq.current, role: 'ai', at: Date.now(), turn }]);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : null;
        // full-test 15/11 AI-CHAT-11: the wait is the rest of the hour the server gives (retryAfter), not one minute
        if (code === 'PLAYGROUND_RATE_LIMITED' || (e instanceof ApiError && e.status === 429)) {
          setBlockedUntil(Date.now() + retryAfterSeconds(e, 3600) * 1000);
          setHourly(PLAYGROUND_TURNS_PER_HOUR);
          rememberHourly(PLAYGROUND_TURNS_PER_HOUR);
        }
        // AI-CHAT-14 / AGENTS-03: nothing is queued in a simulation — the playground says so in its own words
        const message = code === 'AI_PROVIDER_ERROR' || e instanceof TurnStalledError ? t('agents.playground.providerError') : errorMessage(e, t);
        setEntries((old) => [...old, { id: ++seq.current, role: 'error', at: Date.now(), message, code, input }]);
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
    /** turns of the workspace this hour (the server's count; this session's turns until it answered once) */
    hourly: hourly ?? entries.filter((e) => e.role === 'ai').length,
    /** seconds until the rate limit lifts (0 = free) */
    wait,
    retry: failed ? () => void send(failed.input, { retry: true }) : null,
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
                {/* the limit and its wait are shown once, above the composer (AI-CHAT-11: the limit text was printed twice) */}
                {e.code === 'PLAYGROUND_RATE_LIMITED' ? t('agents.playground.notSent') : e.message}
              </FormAlert>
              {pg.retry && pg.wait === 0 ? (
                <Button size="sm" className="mt-2" onClick={pg.retry} data-testid="playground-retry">
                  {t('action.retry')}
                </Button>
              ) : null}
            </div>
          );
        const turn = e.turn;
        // full-test 15/11 AGENTS-20: welcome / out-of-hours go out before the reply on Messenger, the handoff text after it
        const system = (before: boolean) =>
          turn.systemMessages
            .filter((m) => SYSTEM_BEFORE_REPLY.includes(m.key) === before)
            .map((m) => <SystemEvent key={m.key}>{t('agents.playground.systemMessage', { key: t(`agents.playground.systemKey.${m.key}`), text: m.text })}</SystemEvent>);
        return (
          <div key={e.id} data-testid="playground-turn" data-status={turn.status} className="flex flex-col">
            {system(true)}
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
                    <>
                      {agentName} · {turnStatusLabel(t, turn.status)} · {turnIntentLabel(t, turn.intent)} · <Ltr>{confidenceLabel(turn.confidence, locale)}</Ltr>
                    </>
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
                <ProductCards label={t('agents.playground.cards')} cards={turn.cards.map((c) => ({ id: c.id, name: c.name, price: cardPriceText(c, formatMoney), imageUrl: c.imageUrl, variants: [c.variants, showTools ? t('agents.playground.realCard') : null].filter(Boolean).join(' · ') || null }))} />
              </div>
            ) : null}
            {system(false)}
          </div>
        );
      })}
      {pg.typing ? <TypingChip className="mt-3 self-end" label={t('agents.playground.typing', { name: agentName })} /> : null}
    </div>
  );
}

/** Text field + Envoyer, with the 📷 / 🎤 inputs of the merchant playground (uploads go through `POST /uploads`). */
export function PlaygroundComposer({ pg, placeholder, shortPlaceholder, media, disabledReason }: { pg: Playground; placeholder: string; /** journey 16/11 J04-8: below 640 px (the long hint wrapped and only « français) » showed) */ shortPlaceholder?: string; media?: boolean; disabledReason?: string }) {
  const t = useT();
  const [narrow, setNarrow] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // journey 16/11 J03 (AI-CHAT-15 retest): the field's own width decides — in the step-5 dialog at 1440 px the long hint was
  // cut too (« … (darija, arabizi, »); the short one is used when the long one does not fit on one line
  useEffect(() => {
    const el = fieldRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const canvas = document.createElement('canvas').getContext('2d');
    const sync = () => {
      const style = window.getComputedStyle(el);
      if (canvas) canvas.font = `${style.fontSize} ${style.fontFamily}`;
      const needed = canvas ? canvas.measureText(placeholder).width : placeholder.length * 7.5;
      setNarrow(el.clientWidth - 8 < needed);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [placeholder]);
  const hint = narrow && shortPlaceholder ? shortPlaceholder : placeholder;
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
      {/* journey J14-8 g: the field keeps 10 rem (85 px at 390 px, its hint cut to « Écrire »); « Envoyer » wraps under it */}
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-line-edge bg-ink-surface p-2">
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
          ref={fieldRef}
          dir="auto"
          rows={1}
          aria-label={placeholder}
          placeholder={disabledReason ?? hint}
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
          className="max-h-32 min-h-8 min-w-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] placeholder:text-text-muted focus:outline-none disabled:opacity-50"
        />
        <Button variant="primary" size="sm" className="ms-auto" onClick={submit} disabled={off || (!text.trim() && !attachment)} loading={pg.typing} data-testid="playground-send">
          {t('action.send')}
        </Button>
      </div>
    </div>
  );
}
