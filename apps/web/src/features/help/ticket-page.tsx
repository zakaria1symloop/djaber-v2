'use client';
// `/help/tickets/[id]` — ticket thread, merchant side (HELP-04; rows / pills as in the HELP frame, thread layout as the
// ADM-12 thread: mono author line + body, auto-context system message). `GET /support/tickets/:id`,
// `POST /support/tickets/:id/messages`, `POST /support/tickets/:id/rate { score 1–5, note? }`, `POST /support/tickets/:id/close`;
// WS `ticket.updated` refreshes the thread.
// States: skeleton · thread · answered (RÉPONSE REÇUE) · pending customer · resolved + satisfaction prompt · rated ·
// closed (reply disabled, `TICKET_CLOSED`) · 404 · error (Réessayer) · reply errors inline, text kept.
import { formatDateTime, TicketReplySchema, type AppLocale } from '@djaber/shared';
import { Banner, Button, Card, ConfirmDialog, FormAlert, RatingStars, Skeleton, Textarea, TicketMessage, toast } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppPage } from '@/components/app-page';
import { QueryError } from '@/components/global-states';
import { ApiError } from '@/lib/api';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/session';
import { useStickToBottom } from '@/lib/stick-to-bottom';
import { useWsEvent } from '@/lib/ws';
import { useTicketAttachments } from './attachments';
import { helpApi, helpKeys, useTicket, type Ticket } from './api';
import { canRate, canReply } from './logic';
import { TicketPill } from './shared';

export function TicketPage({ id }: { id: string }) {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const q = useTicket(id);
  useWsEvent<{ id: string }>('ticket.updated', (p) => {
    if (p?.id === id) void qc.invalidateQueries({ queryKey: helpKeys.ticket(ws, id) });
  });
  const setTicket = (tk: Ticket) => {
    qc.setQueryData(helpKeys.ticket(ws, id), tk);
    void qc.invalidateQueries({ predicate: (x) => x.queryKey[1] === 'support-tickets' });
  };
  const tk = q.data;
  // the thread scrolls inside its own box (sized to the viewport) so the reply form stays on screen (M11 layout pass)
  const thread = useStickToBottom<HTMLDivElement>(tk ? `${tk.id}:${tk.messages.length}` : null);
  return (
    <AppPage title={tk ? `#${tk.number.replace(/^#/, '')} — ${tk.subject}` : t('help.ticket.title')} permission="support.write" back={{ href: '/help/tickets', label: t('help.tickets.title') }} badges={tk ? <TicketPill ticket={tk} /> : undefined}>
      {q.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : q.isError || !tk ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} backHref="/help/tickets" />
      ) : (
        <div className="flex flex-col gap-4" data-testid="ticket-thread" data-status={tk.status}>
          <p className="ts-label-micro text-text-muted">
            {t(`enum.Ticket.category.${tk.category}`)} · {t(`enum.Ticket.priority.${tk.priority}`)} · {formatDateTime(tk.createdAt, locale)}
          </p>
          <div ref={thread.ref} onScroll={thread.onScroll} className="-mx-1 flex max-h-[max(16rem,calc(100dvh-30rem))] flex-col gap-2 overflow-y-auto overscroll-contain px-1" data-testid="ticket-messages">
            {tk.messages.map((m) => (
              <TicketMessage
                key={m.id}
                kind={m.authorKind}
                author={m.authorKind === 'system' ? t('help.ticket.author.system') : m.author ? `${m.author.firstName} ${m.author.lastName.slice(0, 1)}.${m.authorKind === 'support' ? ` (${t('help.ticket.author.support')})` : ''}` : t('help.ticket.author.support')}
                at={formatDateTime(m.at, locale)}
                body={m.body}
                attachments={m.attachments.map((a) => ({ name: a.name, url: a.url }))}
              />
            ))}
          </div>
          {canRate(tk) ? <RatePanel ticket={tk} onDone={setTicket} /> : tk.satisfaction !== null ? <RatedNote score={tk.satisfaction} /> : null}
          {canReply(tk) ? (
            <ReplyForm
              ticket={tk}
              onDone={(next) => {
                thread.follow();
                setTicket(next);
              }}
            />
          ) : (
            <Banner tone="neutral" action={{ label: t('help.tickets.new'), href: `/${locale}/help/contact` }}>
              <span data-testid="ticket-closed">{t('error.TICKET_CLOSED')}</span>
            </Banner>
          )}
        </div>
      )}
    </AppPage>
  );
}

function ReplyForm({ ticket, onDone }: { ticket: Ticket; onDone: (t: Ticket) => void }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const attachments = useTicketAttachments();
  const reply = useMutation({ mutationFn: (b: string) => helpApi.reply(ticket.id, TicketReplySchema.parse({ body: b, attachments: attachments.ids })) });
  const close = useMutation({ mutationFn: () => helpApi.close(ticket.id) });
  const { guard } = useLeaveGuard(body.trim().length > 0 || attachments.files.length > 0, t('help.ticket.reply.entity'));
  const send = async () => {
    setError(null);
    if (!body.trim()) {
      setError(t('validation.required'));
      return;
    }
    try {
      onDone(await reply.mutateAsync(body));
      setBody('');
      attachments.clear();
      toast({ tone: 'success', message: t('help.ticket.reply.sent') });
    } catch (e) {
      setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
    }
  };
  const doClose = async () => {
    try {
      onDone(await close.mutateAsync());
      setClosing(false);
      toast({ tone: 'success', message: t('help.ticket.close.done') });
    } catch (e) {
      setClosing(false);
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="ticket-reply">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={t('help.ticket.reply.placeholder')} aria-label={t('help.ticket.reply.label')} maxLength={5000} data-testid="ticket-reply-body" />
      {attachments.picker}
      {error || attachments.error ? <FormAlert>{error ?? attachments.error}</FormAlert> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {ticket.status !== 'resolved' ? (
          <Button variant="ghost" size="sm" onClick={() => setClosing(true)} data-testid="ticket-close">
            {t('help.ticket.close')}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={() => void send()} loading={reply.isPending} disabled={attachments.uploading} data-testid="ticket-reply-send">
          {t('action.send')}
        </Button>
      </div>
      <ConfirmDialog
        open={closing}
        onOpenChange={(o) => !o && setClosing(false)}
        title={t('help.ticket.close.title')}
        description={t('help.ticket.close.description')}
        confirmLabel={t('help.ticket.close')}
        cancelLabel={t('action.cancel')}
        onConfirm={() => void doClose()}
        closeLabel={t('action.close')}
      />
      {guard}
    </Card>
  );
}

function RatePanel({ ticket, onDone }: { ticket: Ticket; onDone: (t: Ticket) => void }) {
  const t = useT();
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rate = useMutation({ mutationFn: () => helpApi.rate(ticket.id, { score: score as number, note: note.trim() || undefined }) });
  const send = async () => {
    setError(null);
    try {
      onDone(await rate.mutateAsync());
      toast({ tone: 'success', message: t('help.ticket.rate.thanks') });
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="ticket-rate">
      <div>
        <h2 className="text-[15px] font-medium">{t('help.ticket.rate.title')}</h2>
        <p className="mt-1 ts-label-micro text-text-muted">{t('help.ticket.rate.sub')}</p>
      </div>
      <RatingStars value={score} onChange={setScore} label={t('help.ticket.rate.title')} starLabel={(n) => t('help.ticket.rate.star', { count: n })} />
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder={t('help.ticket.rate.note')} aria-label={t('help.ticket.rate.note')} />
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void send()} disabled={score === null} loading={rate.isPending} data-testid="ticket-rate-send">
          {t('help.ticket.rate.send')}
        </Button>
      </div>
    </Card>
  );
}

function RatedNote({ score }: { score: number }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2" data-testid="ticket-rated">
      <RatingStars value={score} label={t('help.ticket.rate.title')} starLabel={(n) => t('help.ticket.rate.star', { count: n })} disabled />
      <span className="ts-label-meta text-text-muted">{t('help.ticket.meta.rating', { score })}</span>
    </div>
  );
}

