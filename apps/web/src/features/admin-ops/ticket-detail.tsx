'use client';
// Ticket detail of ADM-12 (HELP-05): thread (merchant messages, auto-context system message, support replies, internal
// notes), composer with canned replies ("/sheets-reconnect" …), "Envoyer & attendre le client" (⇒ pending_customer),
// "Note interne", "Résoudre" / "Rouvrir"; context column (workspace, user, integration, previous tickets, linked
// incident) with "Ouvrir l'espace (admin)", "Se connecter en tant que (lecture seule)", "Lier à l'incident",
// "Escalader (ingénierie)". Shown under the list (`?sheet=<id>`) and as the full page `/admin/support/[id]`.
import { formatDateTime, type AdminTicketDto, type CannedReplyDto } from '@djaber/shared';
import { Button, cn, ContextRows, OpsPanel, Skeleton, Textarea, toast } from '@djaber/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { AdminQueryError } from '@/features/admin/admin-page';
import { usePlatform } from '@/features/admin/platform';
import { ImpersonateDialog } from '@/features/admin/workspaces/dialogs';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useStickToBottom } from '@/lib/stick-to-bottom';
import { opsApi, opsKeys, useCannedReplies, useTicket } from './api';
import { userName, useWrite } from './common';
import { cannedQuery, insertCanned } from './logic';
import { uploadWithProgress } from '@/lib/upload';

const ATTACHMENTS_MAX = 5;
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
import { EscalateDialog, LinkIncidentDialog } from './support-dialogs';

/**
 * `fill` (full page `/admin/support/[id]`): on wide screens the thread panel takes the height left in the content area,
 * its messages scroll inside it and the composer stays pinned under them. Otherwise (under the list, phones) the
 * messages scroll inside a box of at most 60 % of the viewport. Either way the thread opens on the latest message.
 */
export function TicketDetail({ id, backHref, fill }: { id: string; backHref?: string; fill?: boolean }) {
  const t = useT();
  const q = useTicket(id);
  if (q.isPending) return <Skeleton className={fill ? 'h-96 xl:min-h-0 xl:flex-1' : 'h-96'} />;
  if (!q.data) return <AdminQueryError error={q.error} onRetry={() => void q.refetch()} backHref={backHref} />;
  return <TicketView ticket={q.data} key={q.data.id} label={t('adminSupport.detail.label')} fill={fill} />;
}

function TicketView({ ticket, label, fill }: { ticket: AdminTicketDto; label: string; fill?: boolean }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = usePlatform();
  const write = useWrite('admin.support.write');
  const canned = useCannedReplies(write.allowed);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState<'wait' | 'note' | 'resolve' | 'reopen' | 'assign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'impersonate' | 'incident' | 'escalate' | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const thread = useStickToBottom<HTMLOListElement>(ticket.messages.length);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const attach = async (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (fileInput.current) fileInput.current.value = '';
    setError(null);
    for (const f of picked) {
      if (files.length >= ATTACHMENTS_MAX) break;
      if (f.size > ATTACHMENT_MAX_BYTES) {
        setError(t('adminSupport.composer.tooLarge', { name: f.name }));
        continue;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('kind', 'ticket_attachment');
        const r = await uploadWithProgress<{ id: string }>('/uploads', fd, { platform: true });
        setFiles((c) => [...c, { id: r.data.id, name: f.name }]);
      } catch (e) {
        setError(e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
      } finally {
        setUploading(false);
      }
    }
  };
  const { guard } = useLeaveGuard(text.trim().length > 0, `#${ticket.number}`);

  const closed = ticket.status === 'closed';
  const resolved = ticket.status === 'resolved';
  const ticketLocale = (ticket.context.locale as 'fr' | 'ar' | 'en' | undefined) ?? 'fr';
  const partial = cannedQuery(text, caret);
  const suggestions = useMemo<CannedReplyDto[]>(() => (partial ? (canned.data ?? []).filter((c) => c.key.startsWith(partial)).slice(0, 6) : []), [partial, canned.data]);
  const placeholderKeys = (canned.data ?? []).slice(0, 3).map((c) => c.key).join(', ');

  const apply = (r: AdminTicketDto) => {
    qc.setQueryData(opsKeys.ticket(r.id), r);
    void qc.invalidateQueries({ queryKey: opsKeys.ticketsRoot });
    void qc.invalidateQueries({ queryKey: opsKeys.supportStats });
  };
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<AdminTicketDto>, okKey: string) => {
    setBusy(kind);
    setError(null);
    try {
      const r = await fn();
      apply(r);
      toast({ tone: 'success', message: t(okKey, { number: ticket.number }) });
      return r;
    } catch (e) {
      // a refused attachment says so (it was the generic « Vérifiez les champs », UX-012)
      setError(e instanceof ApiError && e.body.fields?.attachments ? t('adminSupport.composer.attachmentRefused') : e instanceof ApiError ? `${errorMessage(e, t)} (${e.code})` : errorMessage(e, t));
      if (e instanceof ApiError && (e.code === 'TICKET_CLOSED' || e.status === 409)) void qc.invalidateQueries({ queryKey: opsKeys.ticket(ticket.id) });
      return null;
    } finally {
      setBusy(null);
    }
  };
  const send = async (internal: boolean) => {
    const body = text.trim();
    if (!body) return;
    const key = /^\/[a-z0-9-]+$/.test(body.split(/\s/)[0] ?? '') ? body.split(/\s/)[0] : undefined;
    thread.follow();
    const r = await run(internal ? 'note' : 'wait', () => opsApi.reply(ticket.id, { body, isInternal: internal, attachments: files.map((f) => f.id), ...(internal ? {} : { waitCustomer: true }), ...(key ? { cannedReplyKey: key } : {}) }), internal ? 'adminSupport.toast.note' : 'adminSupport.toast.sent');
    if (r) {
      setText('');
      setFiles([]);
    }
  };
  const resolve = async () => {
    if (text.trim()) {
      const sent = await run('resolve', () => opsApi.reply(ticket.id, { body: text.trim(), isInternal: false, attachments: files.map((f) => f.id) }), 'adminSupport.toast.sent');
      if (!sent) return;
      setText('');
      setFiles([]);
    }
    await run('resolve', () => opsApi.ticketAction(ticket.id, 'resolve'), 'adminSupport.toast.resolved');
  };
  const pickCanned = (c: CannedReplyDto) => {
    const body = c.body[ticketLocale] || c.body.fr;
    const next = insertCanned(text, caret, body);
    setText(next);
    requestAnimationFrame(() => {
      area.current?.focus();
      const pos = next.length - (text.length - caret);
      area.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const authorLine = (m: AdminTicketDto['messages'][number]) => {
    const who = m.authorKind === 'system' ? t('adminSupport.author.system') : m.authorKind === 'support' ? t('adminSupport.author.support', { name: userName(m.author) }) : userName(m.author);
    return [who, formatDateTime(m.at, locale), m.authorKind === 'user' ? t(`adminSupport.channel.${ticket.channel}`) : null, m.isInternal ? t('adminSupport.internal') : null].filter(Boolean).join(' · ');
  };
  const workspace = ticket.workspace;
  const disabledReason = write.disabledReason ?? (closed ? `${t('error.TICKET_CLOSED')} (TICKET_CLOSED)` : undefined);

  return (
    <div
      className={cn('grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]', fill && 'xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)] xl:items-stretch')}
      data-testid="ticket-detail"
      data-status={ticket.status}
      aria-label={label}
    >
      <OpsPanel title={`#${ticket.number} — ${ticket.subject}`} data-testid="ticket-thread" className={cn(fill && 'xl:flex xl:min-h-0 xl:flex-col')} bodyClassName={cn(fill && 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col')}>
        <ol ref={thread.ref} onScroll={thread.onScroll} className={cn('-mx-1 flex max-h-[60dvh] flex-col gap-3 overflow-y-auto overscroll-contain px-1', fill && 'xl:max-h-none xl:min-h-0 xl:flex-1')} data-testid="ticket-messages">
          {ticket.messages.map((m) => (
            <li
              key={m.id}
              data-author={m.authorKind}
              data-internal={m.isInternal || undefined}
              className={m.isInternal ? 'rounded-card border border-accent-starred/40 px-3 py-2.5' : 'rounded-card border border-line-edge px-3 py-2.5'}
            >
              <div className="ts-label-micro text-text-muted">{authorLine(m)}</div>
              <p className="mt-1 whitespace-pre-wrap text-[14px] text-text-primary">{m.body}</p>
              {m.attachments.length ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <li key={a.url}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="ts-label-meta text-accent-inbound hover:underline">
                        {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
        {ticket.satisfaction !== null ? (
          <p className="mt-3 ts-label-meta text-text-muted" data-testid="ticket-satisfaction">
            {t('adminSupport.satisfaction', { note: ticket.satisfaction })}
            {ticket.satisfactionNote ? ` · « ${ticket.satisfactionNote} »` : ''}
          </p>
        ) : null}
        {write.allowed ? (
          <div className="mt-4 flex shrink-0 flex-col gap-3">
            <div className="relative">
              <Textarea
                ref={area}
                rows={3}
                aria-label={t('adminSupport.composer.label')}
                placeholder={t('adminSupport.composer.placeholder', { keys: placeholderKeys || '/…' })}
                value={text}
                disabled={closed || !!busy}
                onChange={(e) => {
                  setText(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                data-testid="ticket-composer"
              />
              {suggestions.length ? (
                <ul role="listbox" aria-label={t('adminSupport.canned.title')} className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-56 overflow-auto rounded-card border border-line-edge bg-ink-raised p-1 shadow-xl" data-testid="canned-suggestions">
                  {suggestions.map((c) => (
                    <li key={c.id} role="option" aria-selected={false}>
                      <button type="button" onClick={() => pickCanned(c)} className="flex w-full flex-col rounded-[6px] px-2.5 py-1.5 text-start hover:bg-ink-raised-high">
                        <span className="font-mono text-[12px]" dir="ltr">
                          {c.key}
                        </span>
                        <span className="truncate text-[12px] text-text-muted">{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {files.length ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('adminSupport.composer.attach')}>
                {files.map((f) => (
                  <li key={f.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-edge px-2.5 py-1 text-[12px]">
                    {f.name}
                    <button type="button" aria-label={t('adminSupport.composer.removeFile', { name: f.name })} className="text-text-muted hover:text-text-primary" onClick={() => setFiles((c) => c.filter((x) => x.id !== f.id))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] text-accent-alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void send(false)} loading={busy === 'wait'} disabledReason={disabledReason ?? (text.trim() ? undefined : t('adminSupport.composer.empty'))} data-testid="ticket-send">
                {t('adminSupport.composer.sendWait')}
              </Button>
              <Button variant="ghost" onClick={() => fileInput.current?.click()} loading={uploading} disabledReason={disabledReason ?? (files.length >= ATTACHMENTS_MAX ? t('adminSupport.composer.maxFiles', { max: ATTACHMENTS_MAX }) : undefined)} data-testid="ticket-attach">
                {t('adminSupport.composer.attach')}
              </Button>
              <input ref={fileInput} type="file" hidden multiple accept="image/*,application/pdf,text/csv" onChange={(e) => void attach(e.target.files)} />
              <Button variant="ghost" onClick={() => void send(true)} loading={busy === 'note'} disabledReason={disabledReason ?? (text.trim() ? undefined : t('adminSupport.composer.empty'))} data-testid="ticket-note">
                {t('adminSupport.composer.note')}
              </Button>
              {resolved || closed ? (
                <Button variant="ghost" onClick={() => void run('reopen', () => opsApi.ticketAction(ticket.id, 'reopen'), 'adminSupport.toast.reopened')} loading={busy === 'reopen'} disabledReason={write.disabledReason} data-testid="ticket-reopen">
                  {t('adminSupport.action.reopen')}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void resolve()} loading={busy === 'resolve'} disabledReason={write.disabledReason} data-testid="ticket-resolve">
                  {t('adminSupport.action.resolve')}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </OpsPanel>

      <OpsPanel title={t('adminSupport.context.title')} data-testid="ticket-context" className={cn(fill && 'xl:max-h-full xl:self-start xl:overflow-y-auto')}>
        <ContextRows
          rows={[
            { label: t('adminSupport.context.workspace'), value: workspace ? [workspace.name, workspace.plan, t(`adminSupport.workspaceStatus.${workspace.status}`)].join(' · ') : '—', testId: 'ctx-workspace' },
            { label: t('adminSupport.context.user'), value: [`${ticket.user.firstName} ${ticket.user.lastName}`.trim(), ticket.user.role ? t(`enum.Membership.role.${ticket.user.role}`) : null, ticket.user.platform].filter(Boolean).join(' · ') },
            ...(ticket.context.integration ? [{ label: t('adminSupport.context.integration'), value: ticket.context.integration }] : []),
            {
              label: t('adminSupport.context.previous'),
              value: ticket.previousTickets.count
                ? t('adminSupport.context.previousValue', { count: ticket.previousTickets.count, note: ticket.previousTickets.avgSatisfaction !== null ? (Math.round(ticket.previousTickets.avgSatisfaction * 10) / 10).toLocaleString('fr-FR') : '—' })
                : t('adminSupport.context.previousNone'),
            },
            { label: t('adminSupport.context.incident'), value: ticket.incident ? ticket.incident.title : '—', testId: 'ctx-incident' },
            ...(ticket.escalatedAt ? [{ label: t('adminSupport.context.escalated'), value: `${formatDateTime(ticket.escalatedAt, locale)}${ticket.escalationNote ? ` · ${ticket.escalationNote}` : ''}` }] : []),
          ]}
        />
        <div className="mt-5 flex flex-col gap-2">
          {workspace ? (
            <Button className="justify-start" onClick={() => router.push(`/admin/workspaces?sheet=${workspace.id}`)} data-testid="ticket-open-workspace">
              {t('adminSupport.context.openWorkspace')}
            </Button>
          ) : null}
          {workspace && can('admin.workspaces.impersonate') ? (
            <Button className="justify-start" onClick={() => setDialog('impersonate')} disabledReason={write.offline ? t('banner.offline') : undefined} data-testid="ticket-impersonate">
              {t('adminSupport.context.impersonate')}
            </Button>
          ) : null}
          {write.allowed ? (
            <>
              <Button variant="ghost" className="justify-start" onClick={() => setDialog('incident')} disabledReason={write.disabledReason} data-testid="ticket-link-incident">
                {t('adminSupport.context.linkIncident')}
              </Button>
              <Button variant="ghost" className="justify-start" onClick={() => setDialog('escalate')} disabledReason={write.disabledReason} data-testid="ticket-escalate">
                {t('adminSupport.context.escalate')}
              </Button>
            </>
          ) : null}
        </div>
      </OpsPanel>
      {workspace ? <ImpersonateDialog ws={{ id: workspace.id, name: workspace.name }} open={dialog === 'impersonate'} onClose={() => setDialog(null)} ticketId={ticket.id} /> : null}
      <LinkIncidentDialog ticket={dialog === 'incident' ? ticket : null} onClose={() => setDialog(null)} onDone={apply} />
      <EscalateDialog ticket={dialog === 'escalate' ? ticket : null} onClose={() => setDialog(null)} onDone={apply} />
      {guard}
    </div>
  );
}
