'use client';
// One message of the thread → kit bubble (Figma "DLG — Inbox & queue": types de messages). Authorship is explicit:
// customer / AI (agent name + IA) / human (member name) / system event (INB-02 — V1 labelled humans as AI).
import { formatMoney } from '@djaber/shared';
import {
  ActionsMenu,
  AudioPlayer,
  BubbleText,
  DeliveryFailure,
  DeliveryMark,
  FileAttachment,
  HandoffNote,
  ImageAttachment,
  LocationAttachment,
  MessageBubble,
  PostbackBubble,
  ProductCards,
  StickerAttachment,
  StoryContext,
  SystemEvent,
  VideoAttachment,
  type BubbleAuthor,
  type DeliveryLabels,
} from '@djaber/ui';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useLocaleCode, useT, type TFunction } from '@/lib/i18n';
import type { Attachment, Message } from './contracts';
import { clockOf, durationOf, fileSize, isOptimistic } from './logic';
import { shortUserName } from './ui';

const param = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Text of a system event (`payload.system.kind`): order created, AI paused / resumed, resolved, skipped window… */
export const systemText = (m: Message, t: TFunction): { text: string; handoff: boolean; warning: boolean } => {
  const sys = m.payload?.system;
  const time = clockOf(m.sentAt);
  if (!sys) return { text: m.text ? `${m.text} · ${time}` : time, handoff: false, warning: false };
  const key = `inbox.system.${sys.kind}`;
  const params = Object.fromEntries(Object.entries(sys.params ?? {}).map(([k, v]) => [k, param(v)]));
  const base = { name: '', number: '', reason: '', rule: '', agent: '', ...params, time };
  const text = t.has(key) ? t(key, base) : m.text ? `${m.text} · ${time}` : `${sys.kind} · ${time}`;
  return { text, handoff: sys.kind === 'handoff', warning: sys.kind === 'skipped_window' };
};

const mapsHref = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

function Media({ m, a, onOpenImage }: { m: Message; a: Attachment; onOpenImage: (url: string) => void }) {
  const t = useT();
  const locale = useLocaleCode();
  if (a.error) return <span className="ts-label-meta text-text-muted">{t('inbox.media.unavailable')}</span>;
  const kind = a.type || m.type;
  if (kind === 'image') return <ImageAttachment src={a.url} alt={a.caption ?? t('inbox.media.image')} openLabel={t('inbox.media.openImage')} onOpen={() => onOpenImage(a.url)} />;
  if (kind === 'sticker') return <StickerAttachment src={a.url} alt={t('inbox.media.sticker')} />;
  if (kind === 'video') return <VideoAttachment src={a.url} label={t('inbox.media.video')} />;
  if (kind === 'audio') {
    return (
      <AudioPlayer src={a.url} duration={durationOf(a.durationSec)} playLabel={t('inbox.media.play')} pauseLabel={t('inbox.media.pause')}>
        {m.transcriptStatus === 'pending' ? (
          <span role="status">{t('inbox.transcript.pending')}</span>
        ) : m.transcriptStatus === 'failed' ? (
          t('inbox.transcript.failed')
        ) : m.transcriptStatus === 'too_long' ? (
          t('inbox.transcript.tooLong')
        ) : m.transcript ? (
          <span dir="auto">{t('inbox.transcript.done', { text: m.transcript })}</span>
        ) : null}
      </AudioPlayer>
    );
  }
  if (kind === 'location' && a.lat !== undefined && a.lng !== undefined) {
    return <LocationAttachment href={mapsHref(a.lat, a.lng)} label={a.caption ?? t('inbox.media.location')} openLabel={t('inbox.media.openMap')} />;
  }
  const size = a.size ? fileSize(a.size, locale) : null;
  return <FileAttachment href={a.url} name={a.name ?? a.caption ?? t('inbox.media.file')} size={size ? t(`inbox.size.${size.unit}`, { value: size.value }) : undefined} downloadLabel={t('action.download')} />;
}

export type MessageViewProps = {
  message: Message;
  grouped: boolean;
  /** last inbound message not read yet by the team ("NON LU") */
  unread?: boolean;
  onOpenImage: (url: string) => void;
  onRetry?: (m: Message) => void;
  onCancel?: (m: Message) => void;
  onReport?: (m: Message) => void;
  /** opens the detail of the AI turn (`GET /messages/:id/ai-run`); offered on AI messages that carry `aiRunId` */
  onInspect?: (m: Message) => void;
  retrying?: boolean;
};

export const MessageView = memo(function MessageView({ message: m, grouped, unread, onOpenImage, onRetry, onCancel, onReport, onInspect, retrying }: MessageViewProps) {
  const t = useT();
  if (m.type === 'system' || m.author === 'system') {
    const s = systemText(m, t);
    return (
      <div className="mt-3 flex justify-center" data-message-id={m.id}>
        {s.handoff ? <HandoffNote>{s.text}</HandoffNote> : <SystemEvent tone={s.warning ? 'warning' : undefined}>{s.text}</SystemEvent>}
      </div>
    );
  }

  const author: BubbleAuthor = m.author === 'customer' ? 'customer' : m.author === 'ai' ? 'ai' : 'human';
  const time = clockOf(m.sentAt);
  const pending = isOptimistic(m) && m.deliveryStatus === 'pending';
  const labels: DeliveryLabels = {
    pending: t('inbox.delivery.pending'),
    sent: t('inbox.delivery.sent'),
    failed: t('inbox.delivery.failed'),
    skipped_window: t('customer.outsideWindowSkipped'),
    retry: t('action.retry'),
  };

  const inspect = author === 'ai' && !!onInspect && !!m.aiRunId && !isOptimistic(m);
  const parts: string[] = [];
  if (author === 'customer') parts.push(time, t('inbox.meta.customer'));
  else if (author === 'ai') parts.push(time, ...(m.agent?.name ? [m.agent.name] : []), ...(inspect ? [] : [t('enum.Conversation.author.ai')]));
  else parts.push(shortUserName(m.authorUser) || t('inbox.meta.team'), time);
  if (m.payload?.templateKey) parts.push(t('inbox.meta.template'));
  if (m.payload?.external) parts.push(t('inbox.meta.external'));
  if (unread) parts.push(t('inbox.meta.unread'));
  const meta: ReactNode = (
    <span className={m.deliveryStatus === 'failed' || m.deliveryStatus === 'skipped_window' ? 'text-accent-alert' : undefined}>
      <span dir="auto">{parts.join(' · ')}</span>
      {inspect ? (
        <>
          {' · '}
          <button type="button" onClick={() => onInspect!(m)} title={t('inbox.aiRun.open')} aria-label={t('inbox.aiRun.open')} data-testid="ai-run-open" className="uppercase tracking-[inherit] text-signal-live underline decoration-dotted underline-offset-2 hover:decoration-solid">
            {t('enum.Conversation.author.ai')}
          </button>
        </>
      ) : null}
      {m.direction === 'out' ? (
        <>
          {' '}
          <DeliveryMark status={m.deliveryStatus} labels={labels} />
        </>
      ) : null}
      {m.customerReaction === 'like' ? <ThumbsUp aria-label={t('inbox.reaction.like')} className="ms-1 inline size-3" /> : m.customerReaction === 'dislike' ? <ThumbsDown aria-label={t('inbox.reaction.dislike')} className="ms-1 inline size-3" /> : null}
    </span>
  );

  let footer: ReactNode = null;
  if (pending && onCancel) {
    footer = (
      <button type="button" onClick={() => onCancel(m)} className="ts-label-meta text-accent-inbound hover:underline">
        {t('action.cancel')}
      </button>
    );
  } else if (m.deliveryStatus === 'skipped_window') {
    footer = <DeliveryFailure>{t('customer.outsideWindowSkipped')}</DeliveryFailure>;
  } else if (m.deliveryStatus === 'failed') {
    const code = m.error ?? '';
    const reason = code && t.has(`error.${code}`) ? t(`error.${code}`, { max: 2000 }) : t('inbox.delivery.failed');
    footer = (
      <DeliveryFailure retryLabel={onRetry ? t('action.retry') : undefined} onRetry={onRetry ? () => onRetry(m) : undefined} retrying={retrying}>
        {code === 'REPLY_OUTSIDE_WINDOW' ? t('customer.outsideWindowSkipped') : t('inbox.delivery.failedReason', { reason })}
        {code ? <span className="sr-only"> ({code})</span> : null}
      </DeliveryFailure>
    );
  }

  const cards = m.payload?.cards ?? [];
  const location = m.payload?.location;
  const hasText = !!m.text?.trim();
  const mediaOnly = !hasText && m.type !== 'postback' && (m.attachments.length > 0 || cards.length > 0) && m.type !== 'audio' && m.type !== 'file' && m.type !== 'location';
  const menuItems = [
    ...(inspect ? [{ key: 'aiRun', label: t('inbox.aiRun.open'), onSelect: () => onInspect!(m) }] : []),
    ...(author === 'ai' && onReport && !isOptimistic(m) ? [{ key: 'report', label: t('inbox.message.reportAi'), onSelect: () => onReport(m) }] : []),
  ];
  const menu = menuItems.length ? <ActionsMenu iconOnly variant="ghost" label={t('inbox.message.menu')} actions={menuItems} /> : null;

  return (
    <MessageBubble id={m.id} author={author} grouped={grouped} bare={mediaOnly} pending={pending} flagged={m.containsBlockedWord || m.flags?.includes('blocked_word')} meta={meta} footer={footer} menu={menu}>
      <div className="flex flex-col gap-2">
        {m.payload?.story ? <StoryContext label={t(`inbox.story.${m.payload.story.kind}`)} thumbnailUrl={m.payload.story.url} /> : null}
        {cards.length ? (
          <ProductCards
            label={t('inbox.cards.label')}
            cards={cards.map((c) => ({ id: c.productId, name: c.name, price: c.priceMax && c.priceMax !== c.price ? `${formatMoney(c.price)} – ${formatMoney(c.priceMax)}` : formatMoney(c.price), imageUrl: c.imageUrl, variants: c.variants }))}
          />
        ) : null}
        {m.attachments.map((a, i) => (
          <Media key={`${a.url}:${i}`} m={m} a={a} onOpenImage={onOpenImage} />
        ))}
        {m.type === 'location' && location && !m.attachments.length ? (
          <LocationAttachment href={mapsHref(location.lat, location.lng)} label={location.label ?? t('inbox.media.location')} openLabel={t('inbox.media.openMap')} />
        ) : null}
        {m.type === 'postback' ? (
          <PostbackBubble label={t('inbox.postback')} value={m.payload?.postback ?? m.payload?.quickReply ?? m.text ?? ''} />
        ) : hasText ? (
          <BubbleText>{m.text}</BubbleText>
        ) : m.payload?.unsupported ? (
          <span className="ts-label-meta text-text-muted">{t('inbox.media.unsupported')}</span>
        ) : null}
        {m.containsBlockedWord || m.flags?.includes('blocked_word') ? <span className="ts-label-micro text-accent-alert">{t('inbox.message.blockedWord')}</span> : null}
      </div>
    </MessageBubble>
  );
});
