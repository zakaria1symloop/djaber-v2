'use client';
// Client panel of the inbox (third pane) — Figma "INB — Inbox — thread with handoff" (CLIENTE · COMMANDES · NOTES
// INTERNES) + "DLG — Inbox & queue" (panneau client — états: PLACEHOLDER · FUSIONNÉ · AUCUN CLIENT · RISQUE; notes
// internes with Ctrl+Entrée). Since M5: order cards open the order page, "Nouvelle commande pour …" opens the order form
// prefilled with this client and conversation, "Fiche client" / "Compléter la fiche" open the client sheet.
import { formatDate, formatMoney, NOTE_MAX_CHARS } from '@djaber/shared';
import { Button, buttonClass, Card, InternalNote, Ltr, OrderCard, Pill, SectionLabel, Skeleton, StatusPill, Textarea } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { Link } from '@/i18n/navigation';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';
import { inboxApi, inboxKeys, useConversation, useNotes } from './api';
import type { Conversation, Note } from './contracts';
import { isolate, Phone, shortUserName, useLocale } from './ui';

export function ClientPanel({ id, noteRef, onClose }: { id: string; noteRef: RefObject<HTMLTextAreaElement | null>; onClose: () => void }) {
  const t = useT();
  const q = useConversation(id);
  const c = q.data;
  return (
    <div className="flex min-h-full flex-col gap-6 p-5" data-testid="client-panel">
      <div className="flex items-center justify-between xl:hidden">
        <SectionLabel>{t('inbox.panel.title')}</SectionLabel>
        <button type="button" onClick={onClose} aria-label={t('action.close')} className="text-text-muted hover:text-text-primary">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {!c ? (
        <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <>
          <ClientCard c={c} />
          <Orders c={c} />
          <Notes id={c.id} noteRef={noteRef} />
        </>
      )}
    </div>
  );
}

function ClientCard({ c }: { c: Conversation }) {
  const t = useT();
  const locale = useLocale();
  const client = c.clientPanel?.client ?? null;
  const identity = c.clientPanel?.identity;
  if (!client && !c.client) {
    return (
      <section className="flex flex-col gap-2.5" data-client-state="none">
        <SectionLabel>{t('inbox.client.label')}</SectionLabel>
        <Card className="p-4">
          <Pill>{t('inbox.client.none.tag')}</Pill>
          <p className="mt-2 text-[13px] text-text-secondary">{t('inbox.client.none.description')}</p>
        </Card>
      </section>
    );
  }
  const base = client ?? c.client;
  const placeholder = base.isPlaceholder;
  return (
    <section className="flex flex-col gap-2.5" data-client-state={c.mergedInto ? 'merged' : placeholder ? 'placeholder' : base.riskLevel === 'high' ? 'risk' : 'known'}>
      <SectionLabel>{t('inbox.client.label')}</SectionLabel>
      <Card className="p-4">
        <div className="truncate text-[15px] font-medium" dir="auto">
          {base.name || identity?.displayName || t('inbox.client.unknown')}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-1.5 text-[13px] text-text-secondary">
          <Phone value={base.phone} />
          {client?.defaultAddress?.communeText ? (
            <bdi>
              <span aria-hidden>· </span>
              {client.defaultAddress.communeText}
            </bdi>
          ) : null}
        </div>
        {placeholder ? null : (
          <p className="mt-2 flex flex-wrap gap-x-1.5 ts-label-micro text-text-muted">
            <bdi>{t('inbox.client.orders', { count: base.orderCount })}</bdi>
            {client ? (
              <>
                <span aria-hidden>·</span>
                <Ltr>{formatMoney(client.totalSpent)}</Ltr>
                {client.lastOrderAt ? (
                  <bdi>
                    <span aria-hidden>· </span>
                    {t('inbox.client.lastOrder', { date: formatDate(client.lastOrderAt, locale) })}
                  </bdi>
                ) : null}
              </>
            ) : null}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {placeholder ? <Pill tone="warning">{t('enum.Client.placeholder')}</Pill> : null}
          {c.mergedInto ? <Pill>{t('inbox.client.merged.tag')}</Pill> : null}
          {base.blocked || c.blocked ? <Pill tone="danger">{t('enum.Client.blocked')}</Pill> : null}
          {placeholder ? null : (
            <StatusPill enumKey="Client.riskLevel" value={base.riskLevel}>
              {t(`enum.Client.riskLevel.${base.riskLevel}`)}
            </StatusPill>
          )}
          {client?.tags.slice(0, 3).map((tag) => (
            <Pill key={tag}>{tag}</Pill>
          ))}
        </div>
        {placeholder ? <p className="mt-3 text-[13px] text-text-secondary">{t('inbox.client.placeholder.description')}</p> : null}
        {c.mergedInto ? <p className="mt-3 text-[13px] text-text-secondary">{t('inbox.client.merged.description', { name: c.mergedInto.name })}</p> : null}
        {base.riskLevel === 'high' && !placeholder ? <p className="mt-3 text-[13px] text-text-secondary">{t('inbox.client.risk.description')}</p> : null}
        <ClientLinks c={c} clientId={base.id} placeholder={placeholder} />
        {client?.notes ? (
          <p className="mt-3 whitespace-pre-wrap border-t border-line-hairline pt-3 text-[13px] text-text-secondary" dir="auto">
            {client.notes}
          </p>
        ) : null}
      </Card>
    </section>
  );
}

function Orders({ c }: { c: Conversation }) {
  const t = useT();
  const orders = c.clientPanel?.orders ?? [];
  if (!c.client || c.client.isPlaceholder) return null;
  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel>{t('inbox.orders.label')}</SectionLabel>
      {orders.length === 0 ? (
        <p className="ts-label-meta text-text-muted">{t('inbox.orders.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} aria-label={t('inbox.orders.open', { number: o.number })} className="block rounded-card hover:[&>div]:border-line-lit" data-testid="client-panel-order">
              <OrderCard
                number={o.number.startsWith('#') ? o.number : `#${o.number}`}
                total={formatMoney(o.total)}
                status={
                  <StatusPill enumKey="Order.status" value={o.status}>
                    {t.has(`enum.Order.status.${o.status}`) ? t(`enum.Order.status.${o.status}`) : o.status}
                  </StatusPill>
                }
              />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewOrderButton c={c} />
    </section>
  );
}

/** "Fiche client" / "Compléter la fiche" (placeholder) → client sheet; "Commandes de ce client" → orders filtered by client. */
function ClientLinks({ c, clientId, placeholder }: { c: Conversation; clientId: string; placeholder: boolean }) {
  const t = useT();
  const { can } = useSession();
  if (!clientId) return null;
  const link = 'ts-label-meta text-accent-inbound hover:underline';
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1" data-testid="client-panel-links">
      {can('clients.read') ? (
        <Link href={`/clients?sheet=${clientId}`} className={link} data-testid="client-sheet-link">
          {placeholder ? t('inbox.client.complete') : t('inbox.client.sheet')}
        </Link>
      ) : null}
      {can('orders.read') && !placeholder && (c.client?.orderCount ?? 0) > 0 ? (
        <Link href={`/orders?clientId=${clientId}`} className={link} data-testid="client-orders-link">
          {t('inbox.client.ordersLink')}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * "Nouvelle commande pour {name}": the order form prefilled with the client and this conversation (`orders.write`).
 * Same rule as the row menu: a placeholder client ("À compléter") is completed first ("Compléter la fiche" above).
 */
function NewOrderButton({ c }: { c: Conversation }) {
  const t = useT();
  const { can, readOnly } = useSession();
  const client = c.clientPanel?.client ?? c.client;
  if (!client || !client.id || client.isPlaceholder || !can('orders.write') || readOnly) return null;
  const first = (client.name ?? '').trim().split(/\s+/)[0] ?? '';
  return (
    <Link href={`/orders/new?clientId=${client.id}&conversationId=${c.id}`} className={buttonClass({ variant: 'primary', size: 'sm', className: 'w-full' })} data-testid="client-panel-new-order">
      {t('inbox.orders.new', { name: first })}
    </Link>
  );
}

/**
 * full-test 15/11 CHANNELS-INBOX-08: an unsaved internal note is kept per conversation while the tab is open — switching
 * thread no longer throws it away (it comes back when the merchant returns to that conversation).
 */
const NOTE_DRAFTS = new Map<string, string>();

function Notes({ id, noteRef }: { id: string; noteRef: RefObject<HTMLTextAreaElement | null> }) {
  const t = useT();
  const locale = useLocale();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { readOnly } = useSession();
  const q = useNotes(id);
  const [body, setBodyState] = useState(() => NOTE_DRAFTS.get(id) ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBodyState(NOTE_DRAFTS.get(id) ?? '');
    setError(null);
  }, [id]);
  const setBody = (v: string) => {
    setBodyState(v);
    if (v) NOTE_DRAFTS.set(id, v);
    else NOTE_DRAFTS.delete(id);
  };
  const add = useMutation({ mutationFn: (text: string) => inboxApi.addNote(id, text) });
  const notes = q.data ?? [];
  const tooLong = body.length > NOTE_MAX_CHARS;

  const submit = async () => {
    const text = body.trim();
    if (!text || tooLong || add.isPending) return;
    setError(null);
    try {
      const note = await add.mutateAsync(text);
      if (note) qc.setQueryData<Note[]>(inboxKeys.notes(ws, id), (old) => (old?.some((n) => n.id === note.id) ? old : [...(old ?? []), note]));
      else void q.refetch();
      setBody('');
    } catch (e) {
      // inline, the text is kept
      setError(errorMessage(e, t));
    }
  };

  return (
    <section className="flex flex-col gap-2.5" data-testid="notes">
      <div className="flex flex-col gap-1">
        <SectionLabel>{t('inbox.notes.label')}</SectionLabel>
        <span className="ts-label-micro text-text-muted">{t('inbox.notes.hint')}</span>
      </div>
      {q.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : q.isError ? (
        <p role="alert" className="text-[12px] text-accent-alert">
          {errorMessage(q.error, t)}
        </p>
      ) : notes.length === 0 ? (
        <p className="ts-label-meta text-text-muted">{t('inbox.notes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id}>
              <InternalNote author={isolate(shortUserName(n.author))} time={formatDate(n.createdAt, locale)}>
                {n.body}
              </InternalNote>
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="flex flex-col gap-2">
          <Textarea
            ref={noteRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={t('inbox.notes.placeholder')}
            aria-label={t('inbox.notes.new')}
            aria-invalid={tooLong || !!error || undefined}
            dir="auto"
            className="min-h-16 text-[13px]"
            data-testid="note-input"
          />
          {error || tooLong ? (
            <p role="alert" className="text-[12px] text-accent-alert">
              {tooLong ? t('validation.length', { max: NOTE_MAX_CHARS, min: 1 }) : error}
            </p>
          ) : null}
          <Button size="sm" className="self-end" onClick={() => void submit()} loading={add.isPending} disabled={!body.trim() || tooLong} data-testid="note-save">
            {t('inbox.notes.add')}
          </Button>
        </div>
      )}
    </section>
  );
}
