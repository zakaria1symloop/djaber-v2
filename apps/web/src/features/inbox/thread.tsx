'use client';
// Thread pane — Figma "INB — Inbox — thread with handoff" + "DLG — Inbox & queue" (bandeaux, composer — états).
// Header (status pills, Assigner, Note, Résoudre, Actions ⌄), one banner by priority, messages with upward cursor
// pagination and scroll anchoring, composer with optimistic send (cancellable 2 s) reconciled on the HTTP answer and
// on WS `message.created` / `message.updated`. The conversation is marked read when it is opened.
import { REPLY_MAX_CHARS } from '@djaber/shared';
import { ActionsMenu, Button, Composer, DaySeparator, Dialog, EmptyState, FormAlert, IconButton, Lightbox, Menu, MenuItem, MenuLabel, MenuSeparator, Pill, Skeleton, StatusPill, ThreadBanner, Tooltip, toast, TypingChip } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, MessageSquare, PanelRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { useConnectFlow } from '@/features/channels/connect';
import { useMembers, useQuickReplies } from '@/features/workspace/api';
import { Link } from '@/i18n/navigation';
import { actionState } from '@/lib/actions';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { inboxApi, inboxKeys, useConversation, useInboxRefresh, useMessages, writeConversation, writeMessages } from './api';
import { TEMPLATE_KEYS, type Conversation, type Message, type TemplateKey } from './contracts';
import {
  buildThread,
  checkDraft,
  composerState,
  dropOptimistic,
  fillQuickReply,
  filterQuickReplies,
  firstNameOf,
  imageError,
  IMAGE_TYPES,
  isOptimistic,
  markSendFailed,
  optimisticMessage,
  reconcileSent,
  slashQuery,
  threadBanner,
  TMP_PREFIX,
} from './logic';
import { MessageView } from './message-view';
import { dayLabel, handoffLabel, isolate, shortUserName, useLocale, useNow, userName } from './ui';
import { useTyping, useTypingSignal } from './typing';
import type { ConversationActions } from './use-conversation-actions';
import { uuid } from '@/lib/uuid';

/** Sends refused by a rule keep the text in the composer with the reason inline; other failures keep the bubble with "Réessayer". */
const INLINE_CODES = ['REPLY_OUTSIDE_WINDOW', 'REPLY_TOO_LONG', 'REPLY_CHANNEL_INACTIVE', 'CUSTOMER_BLOCKED', 'VALIDATION_ERROR', 'IMAGE_TOO_LARGE', 'IMAGE_TYPE_INVALID', 'UPLOAD_TOO_LARGE', 'UPLOAD_TYPE_INVALID', 'READ_ONLY_MEMBER', 'FORBIDDEN'];
const UNDO_MS = 2_000;
/** header buttons are one size smaller below 1024 so that the thread keeps its height */
const COMPACT = 'max-lg:h-8 max-lg:px-3 max-lg:text-[13px]';
type Outgoing = { text: string; file: File | null; previewUrl: string | null; uploadId?: string; timer?: number };

export function Thread({ id, backHref, actions, onTogglePanel, onFocusNote }: { id: string; backHref: string; actions: ConversationActions; onTogglePanel: () => void; onFocusNote: () => void }) {
  const t = useT();
  const q = useConversation(id);
  const c = q.data;

  if (q.isPending) return <ThreadSkeleton />;
  if (q.isError || !c) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-6">
        <QueryError error={q.error} onRetry={() => q.refetch()} backHref={undefined} />
        <Link href={backHref} className="mx-auto mt-4 ts-label-meta uppercase text-text-muted hover:text-text-primary">
          {t('inbox.backToList')}
        </Link>
      </div>
    );
  }
  if (c.deletedAt) return <DeletedThread c={c} backHref={backHref} actions={actions} />;
  return <LiveThread key={c.id} c={c} backHref={backHref} actions={actions} onTogglePanel={onTogglePanel} onFocusNote={onFocusNote} />;
}

function ThreadSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-label={t('common.loading')} className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-3 w-64" />
      <div className="mt-6 flex flex-col gap-4">
        <Skeleton className="h-10 w-2/5" />
        <Skeleton className="ms-auto h-14 w-1/2" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="ms-auto h-10 w-2/5" />
        <Skeleton className="h-10 w-1/2" />
      </div>
    </div>
  );
}

function DeletedThread({ c, backHref, actions }: { c: Conversation; backHref: string; actions: ConversationActions }) {
  const t = useT();
  const locale = useLocale();
  const { can } = useSession();
  const now = useNow();
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center p-6" data-testid="thread-deleted">
      <EmptyState
        title={t('inbox.deleted.title')}
        description={t('inbox.deleted.description', { date: dayLabel(c.deletedAt!.slice(0, 10), t, locale, now) })}
        action={can('inbox.delete') ? { label: t('action.restore'), onClick: () => void actions.restore(c) } : undefined}
        secondaryAction={{ label: t('inbox.backToList'), href: `/${locale}${backHref}` }}
      />
    </div>
  );
}

function LiveThread({ c, backHref, actions, onTogglePanel, onFocusNote }: { c: Conversation; backHref: string; actions: ConversationActions; onTogglePanel: () => void; onFocusNote: () => void }) {
  const t = useT();
  const locale = useLocale();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { me, can, readOnly, workspace } = useSession();
  const refresh = useInboxRefresh();
  const now = useNow();
  const mq = useMessages(c.id);
  const members = useMembers(true);
  const replies = useQuickReplies();
  const name = c.client?.name || c.clientPanel?.identity.displayName || t('inbox.client.unknown');

  /* ---------- messages: order, separators, upward pagination with anchoring ---------- */
  const messages = useMemo(() => mq.data?.pages.flatMap((p) => p.rows) ?? [], [mq.data]);
  const items = useMemo(() => buildThread(messages), [messages]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const pageCount = mq.data?.pages.length ?? 0;
  const lastId = messages.length ? items[items.length - 1]?.key : null;

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && mq.hasNextPage && !mq.isFetchingNextPage) {
      anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      void mq.fetchNextPage();
    }
  };
  // older page prepended: keep the message the reader was looking at in place
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !anchor.current) return;
    el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
    anchor.current = null;
  }, [pageCount]);
  // first render and new messages: stay at the bottom unless the reader scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId, mq.isSuccess]);

  /* ---------- mark read on open and when a message arrives while the thread is visible ---------- */
  const marking = useRef(false);
  useEffect(() => {
    if (c.unreadCount <= 0 || marking.current || document.visibilityState !== 'visible') return;
    marking.current = true;
    inboxApi
      .read(c.id)
      .then(() => {
        writeConversation(qc, ws, { id: c.id, unreadCount: 0 });
        void qc.invalidateQueries({ queryKey: inboxKeys.countsAll(ws) });
      })
      .catch(() => undefined)
      .finally(() => {
        marking.current = false;
      });
  }, [c.id, c.unreadCount, c.lastMessageAt, qc, ws]);

  /* ---------- composer ---------- */
  const state = composerState(c, { readOnly, now });
  const banner = threadBanner(c, { now });
  // "Reprendre l'IA" of the banners: greyed with its reason when the server refuses it (no agent on the page)
  const resume = actionState(c.actions, 'resumeAi', t);
  const resumeReason = resume.present && !resume.enabled ? resume.reason : undefined;
  // "Reconnecter" of the banner starts the Meta flow for this page at once (same flow as the channel page)
  const connect = useConnectFlow();
  // a read-only member sees the header actions greyed with the reason (same text as the bulk bar)
  const readOnlyReason = readOnly ? `${t('error.READ_ONLY_MEMBER')} (READ_ONLY_MEMBER)` : undefined;
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const outbox = useRef(new Map<string, Outgoing>());
  const check = checkDraft(draft, !!file && !fileError);
  const signalTyping = useTypingSignal(c.id);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const deliver = useCallback(
    async (key: string) => {
      const o = outbox.current.get(key);
      if (!o) return;
      o.timer = undefined;
      try {
        if (o.file && !o.uploadId) o.uploadId = (await inboxApi.upload(o.file)).id;
        const sent = await inboxApi.send(c.id, { text: o.text.trim() ? o.text : undefined, uploadId: o.uploadId }, key);
        outbox.current.delete(key);
        if (sent) writeMessages(qc, ws, c.id, (list) => reconcileSent(list, key, sent));
        // auto-pause, first-reply assignment, counters
        void refresh({ id: c.id });
      } catch (e) {
        const code = e instanceof ApiError ? e.code : '';
        if (INLINE_CODES.includes(code)) {
          // refused by a rule: the bubble goes away, the text comes back with the reason (AT-INB-03)
          outbox.current.delete(key);
          writeMessages(qc, ws, c.id, (list) => dropOptimistic(list, key));
          setDraft((d) => d || o.text);
          setInlineError(`${errorMessage(e, t)} (${code})`);
          if (code === 'REPLY_OUTSIDE_WINDOW' || code === 'REPLY_CHANNEL_INACTIVE' || code === 'CUSTOMER_BLOCKED') void refresh({ id: c.id });
        } else {
          writeMessages(qc, ws, c.id, (list) => markSendFailed(list, key, code || 'META_UNAVAILABLE'));
        }
      }
    },
    [c.id, qc, ws, refresh, t],
  );
  // pending sends leave with the page: nothing typed and confirmed is lost on navigation
  useEffect(() => {
    const box = outbox.current;
    return () => {
      for (const [key, o] of box) {
        if (o.timer !== undefined) {
          window.clearTimeout(o.timer);
          void deliver(key);
        }
      }
    };
  }, [deliver]);

  const submit = () => {
    if (!check.ok || state.mode !== 'ready') return;
    const key = uuid();
    const o: Outgoing = { text: draft, file: fileError ? null : file, previewUrl: fileError ? null : preview };
    outbox.current.set(key, o);
    stick.current = true;
    const base = { pages: [{ rows: [] as Message[], nextCursor: null, hasMore: false }], pageParams: [null] };
    qc.setQueryData(inboxKeys.messages(ws, c.id), (old: unknown) => old ?? base);
    writeMessages(qc, ws, c.id, (list) => [...list, optimisticMessage({ key, conversationId: c.id, text: draft.trim() || null, imageUrl: o.previewUrl, author: me ? { id: me.id, firstName: me.firstName, lastName: me.lastName, avatarUrl: me.avatarUrl } : null })]);
    o.timer = window.setTimeout(() => void deliver(key), UNDO_MS);
    setDraft('');
    setFile(null);
    setPreview(null);
    setFileError(null);
    setInlineError(null);
    input.current?.focus();
  };
  const keyOf = (m: Message) => m.id.slice(TMP_PREFIX.length);
  const cancel = (m: Message) => {
    const key = keyOf(m);
    const o = outbox.current.get(key);
    if (!o || o.timer === undefined) return;
    window.clearTimeout(o.timer);
    outbox.current.delete(key);
    writeMessages(qc, ws, c.id, (list) => dropOptimistic(list, key));
    setDraft((d) => d || o.text);
    input.current?.focus();
  };
  const retry = async (m: Message) => {
    setRetrying(m.id);
    try {
      if (isOptimistic(m) && outbox.current.has(keyOf(m))) {
        writeMessages(qc, ws, c.id, (list) => list.map((x) => (x.id === m.id ? { ...x, deliveryStatus: 'pending' as const, error: null } : x)));
        await deliver(keyOf(m));
      } else {
        // a stored message that failed at Meta: the same content is sent again under a new key
        const key = uuid();
        const sent = await inboxApi.send(c.id, { text: m.text ?? undefined }, key);
        if (sent) writeMessages(qc, ws, c.id, (list) => [...list, sent]);
        void refresh({ id: c.id });
      }
    } catch (e) {
      toast({ tone: 'danger', message: e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t) });
    } finally {
      setRetrying(null);
    }
  };

  const onAttach = (f: File) => {
    const code = imageError(f);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setFileError(code ? `${t(`error.${code}`)} (${code})` : null);
    setInlineError(null);
  };

  const list = useMemo(() => replies.data ?? [], [replies.data]);
  // the replies in the customer's language first (`c.language`, now detected like the AI does — tester notes 25/10: English
  // was taken for French), then the others, each labelled with its language in the « / » list
  const replyLocale = c.language === 'ar' || c.language === 'en' ? c.language : c.language ? 'fr' : locale;
  const localized = useMemo(() => {
    const own = list.filter((r) => r.locale === replyLocale);
    return [...own, ...list.filter((r) => r.locale !== replyLocale)];
  }, [list, replyLocale]);
  const multiLocale = new Set(list.map((r) => r.locale)).size > 1;
  const slash = slashQuery(draft);
  const pickReply = (rid: string) => {
    const r = list.find((x) => x.id === rid);
    if (!r) return;
    setDraft(fillQuickReply(r.body, { firstName: firstNameOf(c.client?.isPlaceholder ? '' : c.client?.name), shop: workspace?.name, total: c.clientPanel?.orders?.[0]?.total ?? null }));
    setInlineError(null);
    input.current?.focus();
  };

  /* ---------- keyboard: `/` focuses the composer, Échap leaves the thread on small screens ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable], [role=dialog], [role=menu]')) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && input.current) {
        e.preventDefault();
        input.current.focus();
        setDraft((d) => d || '/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closed = c.status === 'resolved' || c.status === 'archived';
  const busy = actions.busy === c.id;
  const assignable = (members.data ?? []).filter((m) => !m.readOnly);
  const firstUnreadInbound = c.unreadCount > 0 ? [...messages].reverse().find((m) => m.direction === 'in')?.id : null;
  const firstReply = !messages.some((m) => m.author === 'human') && !c.aiPaused && !!c.agent && (workspace?.autoPauseOnManualReply ?? true);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="thread" data-conversation={c.id}>
      {/* header */}
      <header className="flex flex-col gap-3 px-5 pb-4 pt-5 max-lg:gap-2 max-lg:px-4 max-lg:pb-3 max-lg:pt-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-start gap-2">
            <Link href={backHref} aria-label={t('inbox.backToList')} title={t('inbox.backToList')} className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-card text-text-secondary hover:bg-ink-raised lg:hidden">
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <div className="min-w-0">
              <h1 className="ts-display-s truncate text-[19px]" dir="auto">
                {name}
              </h1>
              <p className="mt-1 flex flex-wrap gap-x-1.5 ts-label-micro text-text-muted">
                {[t(`enum.Channel.platform.${c.channel.platform}`), c.channel.name, c.agent?.name, c.client && !c.client.isPlaceholder ? t('common.ordersCount', { count: c.client.orderCount }) : null]
                  .filter((x): x is string => !!x)
                  .map((part, i) => (
                    <bdi key={i}>
                      {i > 0 ? <span aria-hidden>· </span> : null}
                      {part}
                    </bdi>
                  ))}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.blocked ? <Pill tone="danger">{t('enum.Client.blocked')}</Pill> : null}
            {c.status !== 'active' ? (
              <StatusPill enumKey="Conversation.status" value={c.status}>
                {t(`enum.Conversation.status.${c.status}`)}
              </StatusPill>
            ) : null}
            {c.aiPaused ? <Pill>{t('enum.Conversation.aiPaused')}</Pill> : null}
            {c.assignee ? <Pill tone="info">{shortUserName(c.assignee)}</Pill> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Menu
            trigger={
              <Button disabled={busy} disabledReason={readOnlyReason} data-testid="assign" className={COMPACT}>
                {t('action.assign')}
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            }
          >
            <MenuLabel>{t('inbox.assign.heading')}</MenuLabel>
            {me ? (
              <MenuItem onSelect={() => void actions.assign(c, me.id)} data-assignee="me">
                <span className="min-w-0 flex-1">{t('action.assignMe')}</span>
                {c.assignee?.id === me.id ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
              </MenuItem>
            ) : null}
            {assignable
              .filter((m) => m.user.id !== me?.id)
              .map((m) => (
                <MenuItem key={m.id} onSelect={() => void actions.assign(c, m.user.id)} data-assignee={m.user.id}>
                  <span className="min-w-0 flex-1 truncate">{userName(m.user)}</span>
                  {c.assignee?.id === m.user.id ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
                </MenuItem>
              ))}
            <MenuSeparator />
            <MenuItem onSelect={() => void actions.assign(c, null)} data-assignee="none">
              <span className="min-w-0 flex-1">{t('inbox.assign.nobody')}</span>
              {!c.assignee ? <Check className="size-3.5 text-accent-money" aria-hidden /> : null}
            </MenuItem>
          </Menu>
          <Button onClick={onFocusNote} data-testid="note" className={COMPACT}>
            {t('inbox.note')}
          </Button>
          {closed ? (
            <Button variant="primary" onClick={() => void actions.reopen(c)} loading={busy} disabledReason={readOnlyReason} data-testid="reopen" className={COMPACT}>
              {t('inbox.menu.reopen')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void actions.resolve(c)} loading={busy} disabledReason={readOnlyReason} data-testid="resolve" className={COMPACT}>
              {t('action.resolve')}
            </Button>
          )}
          {readOnly ? null : <ActionsMenu label={t('action.actions')} actions={actions.menu(c, { inThread: true })} heading={name} />}
          <IconButton label={t('inbox.panel.open')} variant="ghost" className="xl:hidden" onClick={onTogglePanel}>
            <PanelRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </IconButton>
        </div>
      </header>

      {/* one banner, by priority */}
      {banner === 'aiPaused' ? (
        <ThreadBanner
          kind={banner}
          title={c.aiPausedBy ? t('inbox.banner.aiPaused.by', { name: isolate(shortUserName(c.aiPausedBy)) }) : t('inbox.banner.aiPaused.title')}
          description={t('inbox.banner.aiPaused.description')}
          actions={
            readOnly ? null : (
              <Button onClick={() => void actions.resumeAi(c)} disabled={busy} disabledReason={resumeReason} data-testid="resume-ai">
                {t('action.resumeAi')}
              </Button>
            )
          }
        />
      ) : banner === 'needsHuman' ? (
        <ThreadBanner
          kind={banner}
          title={c.handoffReason ? t('inbox.banner.needsHuman.reason', { reason: isolate(handoffLabel(t, c.handoffReason)) }) : t('inbox.banner.needsHuman.title')}
          description={t('inbox.banner.needsHuman.description')}
          actions={
            readOnly ? null : (
              <Button onClick={() => void actions.resumeAi(c)} disabled={busy} disabledReason={resumeReason} data-testid="resume-ai">
                {t('action.resumeAi')}
              </Button>
            )
          }
        />
      ) : banner === 'reconnect' ? (
        <ThreadBanner
          kind={banner}
          tone="danger"
          title={t('inbox.banner.reconnect.title', { page: isolate(c.channel.name) })}
          description={t('inbox.banner.reconnect.description')}
          actions={
            can('channels.manage') ? (
              <button type="button" onClick={() => void connect.reconnect(c.channel)} disabled={connect.busy} className="ts-label-meta uppercase text-accent-inbound hover:underline disabled:opacity-50" data-testid="thread-reconnect">
                {t('action.reconnect')}
              </button>
            ) : null
          }
        />
      ) : banner === 'credits' ? (
        <ThreadBanner
          kind={banner}
          tone="danger"
          title={t('inbox.banner.credits.title')}
          description={t('inbox.banner.credits.description')}
          actions={
            can('billing.read_credits') ? (
              <Link href={can('billing.write') ? '/settings/credits?buy=1' : '/settings/credits'} className="inline-flex h-8 items-center rounded-card border border-line-edge bg-ink-surface px-3 text-[13px] font-medium hover:border-line-lit hover:bg-ink-raised" data-testid="thread-renew-credits">
                {t('action.renew')}
              </Link>
            ) : null
          }
        />
      ) : banner === 'pausedByPlan' ? (
        <ThreadBanner kind={banner} title={t('inbox.banner.pausedByPlan.title')} description={t('inbox.banner.pausedByPlan.description')} />
      ) : banner === 'aiUnavailable' ? (
        <ThreadBanner kind={banner} tone="danger" title={t('inbox.banner.aiUnavailable.title')} description={t('inbox.banner.aiUnavailable.description')} />
      ) : banner === 'blocked' ? (
        <ThreadBanner
          kind={banner}
          tone="neutral"
          title={c.blockedAt ? t('inbox.banner.blocked.by', { date: dayLabel(c.blockedAt.slice(0, 10), t, locale, now), name: shortUserName(c.blockedBy) || t('inbox.banner.blocked.system') }) : t('inbox.banner.blocked.title')}
          description={t('inbox.banner.blocked.description')}
          actions={
            can('safety.manage') ? (
              c.blockSource === 'platform' ? (
                <Tooltip content={`${t('error.CUSTOMER_BLOCKED_BY_PLATFORM')} (CUSTOMER_BLOCKED_BY_PLATFORM)`}>
                  <span tabIndex={0} className="ts-label-meta uppercase text-text-muted">
                    {t('inbox.banner.blocked.platform')}
                  </span>
                </Tooltip>
              ) : (
                <Button onClick={() => void actions.unblock(c)} disabled={busy} data-testid="unblock">
                  {t('action.unblock')}
                </Button>
              )
            ) : null
          }
        />
      ) : banner === 'outsideWindow' ? (
        <ThreadBanner
          kind={banner}
          title={t('enum.Conversation.outsideWindow')}
          description={c.channel.platform === 'facebook' ? t('inbox.banner.outsideWindow.facebook') : t('inbox.banner.outsideWindow.instagram')}
        />
      ) : null}

      {/* messages */}
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4" data-testid="messages" tabIndex={0} role="log" aria-label={t('inbox.thread.label', { name })}>
        {mq.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-4 pt-4">
            <Skeleton className="h-10 w-2/5" />
            <Skeleton className="ms-auto h-14 w-1/2" />
            <Skeleton className="h-10 w-1/3" />
          </div>
        ) : mq.isError ? (
          <div className="pt-6">
            <QueryError error={mq.error} onRetry={() => mq.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center" data-testid="thread-empty">
            <MessageSquare className="size-5 text-text-secondary" aria-hidden />
            <p className="ts-title">{t('state.thread.empty')}</p>
            <p className="ts-label-meta text-text-muted">{t('inbox.thread.emptyHint')}</p>
          </div>
        ) : (
          <div className="flex flex-col pb-2">
            {mq.isFetchingNextPage ? (
              <div role="status" className="py-3 text-center ts-label-meta text-text-muted">
                {t('inbox.thread.loadingOlder')}
              </div>
            ) : mq.hasNextPage ? (
              <button type="button" onClick={() => void mq.fetchNextPage()} className="mx-auto py-3 ts-label-meta uppercase text-text-muted hover:text-text-primary">
                {t('inbox.thread.loadOlder')}
              </button>
            ) : null}
            {items.map((it) =>
              it.kind === 'day' ? (
                <DaySeparator key={it.key}>{dayLabel(it.day, t, locale, now)}</DaySeparator>
              ) : (
                <MessageView
                  key={it.key}
                  message={it.message}
                  grouped={it.grouped}
                  unread={it.message.id === firstUnreadInbound}
                  onOpenImage={setLightbox}
                  onRetry={readOnly ? undefined : retry}
                  onCancel={cancel}
                  onReport={can('safety.block') ? (m) => actions.askReport({ target: { type: 'ai_message', messageId: m.id, conversationId: c.id }, name: m.agent?.name ?? t('enum.Conversation.author.ai') }) : undefined}
                  onInspect={can('agents.read') ? (m) => actions.askAiRun({ messageId: m.id, agentName: m.agent?.name ?? null }) : undefined}
                  retrying={retrying === it.message.id}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* M11: "IA répond…" (AI reply job running) / "Sara écrit…" (another member in this thread) */}
      <TypingLine conversationId={c.id} agentName={c.agent?.name ?? null} members={members.data ?? []} />

      {/* composer */}
      {state.mode === 'hidden' ? (
        <div className="border-t border-line-hairline px-5 py-3 ts-label-meta text-text-muted" data-composer="hidden">
          {t('inbox.composer.readOnly')}
        </div>
      ) : state.mode === 'disabled' ? (
        <Composer
          value=""
          onChange={() => undefined}
          onSend={() => undefined}
          placeholder=""
          label={t('inbox.composer.label')}
          sendLabel={t('action.send')}
          canSend={false}
          disabled={
            state.reason === 'channelInactive'
              ? {
                  tone: 'danger',
                  tag: t('inbox.composer.inactive.tag'),
                  reason: `${t('error.REPLY_CHANNEL_INACTIVE')} (REPLY_CHANNEL_INACTIVE)`,
                  action: can('channels.manage') ? (
                    <Link href={`/channels/${c.channel.id}`} className="ts-label-meta uppercase text-accent-inbound hover:underline" data-testid="composer-reconnect">
                      {state.reconnect ? t('action.reconnect') : t('inbox.composer.inactive.open')}
                    </Link>
                  ) : undefined,
                }
              : state.reason === 'blocked'
                ? { tone: 'neutral', tag: t('enum.Client.blocked'), reason: t('inbox.composer.blocked') }
                : {
                    tag: t('enum.Conversation.outsideWindow'),
                    reason: `${t('error.REPLY_OUTSIDE_WINDOW')} (REPLY_OUTSIDE_WINDOW)${state.template ? '' : ` — ${t('inbox.composer.outside.instagram')}`}`,
                    action: state.template ? (
                      <Button size="sm" onClick={() => setTemplateOpen(true)} data-testid="send-template">
                        {t('inbox.composer.template')}
                      </Button>
                    ) : undefined,
                  }
          }
        />
      ) : (
        <Composer
          textareaRef={input}
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (v.trim()) signalTyping();
            if (inlineError) setInlineError(null);
          }}
          onSend={submit}
          placeholder={t('inbox.composer.placeholder')}
          label={t('inbox.composer.label')}
          sendLabel={t('action.send')}
          canSend={check.ok && slash === null}
          counter={check.length > REPLY_MAX_CHARS - 200 ? t('inbox.composer.counter', { count: check.length, max: REPLY_MAX_CHARS }) : undefined}
          tooLong={check.tooLong}
          error={check.tooLong ? `${t('error.REPLY_TOO_LONG', { max: REPLY_MAX_CHARS })} (REPLY_TOO_LONG)` : inlineError}
          attachLabel={t('inbox.composer.attach')}
          accept={IMAGE_TYPES.join(',')}
          onAttach={onAttach}
          attachment={
            file && preview
              ? {
                  previewUrl: preview,
                  name: file.name,
                  error: fileError ?? undefined,
                  removeLabel: t('inbox.composer.removeImage'),
                  onRemove: () => {
                    setFile(null);
                    setPreview(null);
                    setFileError(null);
                  },
                }
              : null
          }
          chips={slash === null && !draft ? localized.filter((r) => r.locale === replyLocale).slice(0, 4).map((r) => ({ id: r.id, label: r.title })) : undefined}
          slash={
            slash !== null
              ? {
                  heading: t('inbox.quickReplies.heading'),
                  emptyLabel: list.length ? t('inbox.quickReplies.noMatch') : t('inbox.quickReplies.empty'),
                  items: filterQuickReplies(localized, slash).map((r) => ({ id: r.id, title: multiLocale ? `${r.title} · ${r.locale.toUpperCase()}` : r.title, preview: r.body, shortcut: r.shortcut })),
                }
              : null
          }
          onPickReply={pickReply}
          footnote={
            state.tagged ? (
              <>
                {t('inbox.composer.tagged')}{' '}
                <button type="button" onClick={() => setTemplateOpen(true)} className="text-accent-inbound hover:underline" data-testid="send-template">
                  {t('inbox.composer.template')}
                </button>
              </>
            ) : firstReply ? (
              t('inbox.composer.firstReply')
            ) : (
              t('inbox.composer.hint')
            )
          }
        />
      )}

      <Lightbox src={lightbox} alt={t('inbox.media.image')} onClose={() => setLightbox(null)} closeLabel={t('action.close')} />
      <TemplateDialog open={templateOpen} onClose={() => setTemplateOpen(false)} conversation={c} />
      {connect.element}
    </div>
  );
}

/** Who is replying in this thread right now (`conversation.typing`); nothing is rendered when nobody is. */
function TypingLine({ conversationId, agentName, members }: { conversationId: string; agentName: string | null; members: { user: { id: string; firstName: string; lastName: string } }[] }) {
  const t = useT();
  const typing = useTyping(conversationId);
  const names = typing.userIds.map((id) => {
    const m = members.find((x) => x.user.id === id);
    return m ? shortUserName(m.user) : t('carry.inbox.typing.someone');
  });
  if (!typing.ai && !names.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-2" data-testid="thread-typing">
      {typing.ai ? <TypingChip label={agentName ? t('agents.playground.typing', { name: agentName }) : t('carry.inbox.typing.ai')} /> : null}
      {names.length ? <TypingChip label={names.length === 1 ? t('carry.inbox.typing.member', { name: names[0]! }) : t('carry.inbox.typing.members', { count: names.length })} /> : null}
    </div>
  );
}

/** "Envoyer un message modèle" (Messenger, outside the 24 h window): `POST /conversations/:id/messages { templateKey }`. */
function TemplateDialog({ open, onClose, conversation: c }: { open: boolean; onClose: () => void; conversation: Conversation }) {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = useInboxRefresh();
  const [key, setKey] = useState<TemplateKey>(TEMPLATE_KEYS[0]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState(() => uuid());
  useEffect(() => {
    if (open) {
      setError(null);
      setIdem(uuid());
    }
  }, [open]);
  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const sent = await inboxApi.send(c.id, { templateKey: key }, idem);
      if (sent) writeMessages(qc, ws, c.id, (list) => (list.some((m) => m.id === sent.id) ? list : [...list, sent]));
      void refresh({ id: c.id });
      toast(t('inbox.template.sent'));
      onClose();
    } catch (e) {
      // inside the dialog, choice preserved
      setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !sending && onClose()}
      title={t('inbox.template.title')}
      description={t('inbox.template.description')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={sending}>
            {t('action.send')}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('inbox.template.title')} className="flex flex-col gap-1">
        {TEMPLATE_KEYS.map((k) => (
          <label key={k} className="flex cursor-pointer items-start gap-3 rounded-card px-2 py-2 hover:bg-ink-raised">
            <input type="radio" name="templateKey" value={k} checked={key === k} onChange={() => setKey(k)} className="mt-1 size-4 accent-white" />
            <span className="min-w-0">
              <span className="block text-[14px]">{t(`inbox.template.${k}`)}</span>
              <span className="block ts-label-meta text-text-muted" dir="auto">
                {t(`customer.${k}`, { number: '…', tracking: '…', courier: '…', reason: '…', time: '…' })}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Dialog>
  );
}
