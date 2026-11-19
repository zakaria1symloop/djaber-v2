'use client';
// Dialogs of ADM-12 support (HELP-05): new ticket (support-created, e-mail / chat channel), link to an incident,
// escalate to engineering, canned reply create / edit. Pattern of "DLG — Platform admin — dialogs catalogue".
import { TicketCategoryValues, TicketPriorityValues, type AdminTicketDto, type AdminWorkspaceMemberDto, type AdminWorkspaceRowDto, type CannedReplyDto, type OpsLocalizedText } from '@djaber/shared';
import { Dialog, Field, FormAlert, Input, SearchInput, Select, Textarea, toast } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCloseGuard, useTypedFlag } from '@/components/close-guard';
import { adminKey, adminList } from '@/features/admin/api';
import { DialogFooter, RadioList, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { opsApi, opsKeys, useIncidents } from './api';
import { cleanLocalized, EMPTY_LOCALIZED, LocalizedFields, useLocalized } from './common';
import { docRef } from '@/lib/format-message';

/* ---------- + Nouveau ticket ---------- */
export function NewTicketDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: AdminTicketDto) => void }) {
  const typed = useTypedFlag(open);
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [ws, setWs] = useState<Pick<AdminWorkspaceRowDto, 'id' | 'name'> | null>(null);
  const [userId, setUserId] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<AdminTicketDto['category']>('other');
  const [priority, setPriority] = useState<AdminTicketDto['priority']>('normal');
  const [channel, setChannel] = useState<'email' | 'chat'>('email');
  const [message, setMessage] = useState('');
  const search = useQuery({
    queryKey: adminKey('/admin/workspaces', { q, pageSize: 25 }),
    queryFn: () => adminList<AdminWorkspaceRowDto>('/admin/workspaces', { q, pageSize: 25 }),
    enabled: open && !ws && q.trim().length >= 2,
  });
  const members = useQuery({
    queryKey: adminKey(`/admin/workspaces/${ws?.id}/members`),
    queryFn: () => api<AdminWorkspaceMemberDto[]>(`/admin/workspaces/${ws!.id}/members`),
    enabled: open && !!ws,
  });
  useOnOpen(open, () => {
    setQ('');
    setWs(null);
    setUserId('');
    setSubject('');
    setCategory('other');
    setPriority('normal');
    setChannel('email');
    setMessage('');
    s.setError(null);
  });
  const s = useDialogSubmit(() =>
    opsApi.createTicket({ workspaceId: ws!.id, userId, subject: subject.trim(), category, priority, channel, ...(message.trim() ? { message: message.trim() } : {}) }),
  );
  const submit = async () => {
    const r = await s.submit();
    if (!r) return;
    toast({ tone: 'success', message: t('adminSupport.new.created', { number: r.number }) });
    await Promise.all([qc.invalidateQueries({ queryKey: opsKeys.ticketsRoot }), qc.invalidateQueries({ queryKey: opsKeys.supportStats })]);
    onClose();
    onCreated(r);
  };
  const missing = !ws ? t('adminSupport.new.pickWorkspace') : !userId ? t('adminSupport.new.pickUser') : subject.trim().length < 3 ? t('adminSupport.new.subjectShort') : undefined;
  const guard = useCloseGuard(typed.dirty, t('adminSupport.new.title'), onClose);
  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => !o && guard.requestClose()}
      title={t('adminSupport.new.title')}
      description={t('adminSupport.new.sub')}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={guard.requestClose} busy={s.busy} onSubmit={() => void submit()} label={t('adminSupport.new.submit')} disabledReason={missing} />}
    >
      <div onChange={typed.onChange} className="flex flex-col gap-4" data-testid="new-ticket-form">
        {ws ? (
          <div className="flex items-center justify-between gap-3 rounded-card border border-line-edge px-3 py-2.5 text-[13px]">
            <span>{ws.name}</span>
            <button type="button" className="ts-label-meta text-accent-inbound" onClick={() => (setWs(null), setUserId(''))}>
              {t('action.edit')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <SearchInput value={q} onChange={setQ} label={t('adminSupport.new.workspace')} placeholder={t('adminSupport.new.workspace.placeholder')} clearLabel={t('list.clearSearch')} />
            {search.data?.rows.length ? (
              <ul className="max-h-48 divide-y divide-line-hairline overflow-auto rounded-card border border-line-edge">
                {search.data.rows.map((w) => (
                  <li key={w.id}>
                    <button type="button" className="w-full px-3 py-2 text-start text-[13px] hover:bg-ink-raised" onClick={() => setWs({ id: w.id, name: w.name })}>
                      {w.name} <span className="ts-label-meta text-text-muted">· {w.plan.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : q.trim().length >= 2 && search.data ? (
              <p className="ts-label-meta text-text-muted">{t('adminSupport.new.noWorkspace')}</p>
            ) : null}
          </div>
        )}
        {ws ? (
          <Field label={t('adminSupport.new.user')} htmlFor="nt-user" required error={s.fieldError('userId')}>
            <Select id="nt-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">—</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.firstName} {m.lastName} · {m.email}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('adminSupport.new.subject')} htmlFor="nt-subject" required error={s.fieldError('subject')}>
          <Input id="nt-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('adminSupport.col.category')} htmlFor="nt-category">
            <Select id="nt-category" value={category} onChange={(e) => setCategory(e.target.value as AdminTicketDto['category'])}>
              {TicketCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {t(`adminSupport.category.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('adminSupport.col.priority')} htmlFor="nt-priority">
            <Select id="nt-priority" value={priority} onChange={(e) => setPriority(e.target.value as AdminTicketDto['priority'])}>
              {TicketPriorityValues.map((p) => (
                <option key={p} value={p}>
                  {t(`adminSupport.priority.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('adminSupport.col.channel')} htmlFor="nt-channel">
            <Select id="nt-channel" value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'chat')}>
              <option value="email">{t('adminSupport.channel.email')}</option>
              <option value="chat">{t('adminSupport.channel.chat')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('adminSupport.new.message')} htmlFor="nt-message">
          <Textarea id="nt-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}

/* ---------- Lier à l'incident ---------- */
export function LinkIncidentDialog({ ticket, onClose, onDone }: { ticket: AdminTicketDto | null; onClose: () => void; onDone: (t: AdminTicketDto) => void }) {
  const t = useT();
  const pick = useLocalized();
  const incidents = useIncidents();
  const [incidentId, setIncidentId] = useState<string>('');
  useOnOpen(!!ticket, () => {
    setIncidentId(ticket?.incident?.id ?? '');
    s.setError(null);
  });
  const s = useDialogSubmit(() => opsApi.linkIncident(ticket!.id, incidentId || null));
  const submit = async () => {
    const r = await s.submit();
    if (r) {
      toast({ tone: 'success', message: t(incidentId ? 'adminSupport.incident.linked' : 'adminSupport.incident.unlinked') });
      onDone(r);
      onClose();
    }
  };
  const rows = incidents.data?.rows ?? [];
  return (
    <Dialog
      open={!!ticket}
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSupport.incident.title')}
      description={ticket ? `${docRef(t, ticket.number)} · ${ticket.subject}` : undefined}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-3" data-testid="link-incident-form">
        {incidents.isPending ? (
          <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
        ) : (
          <RadioList
            label={t('adminSupport.incident.title')}
            value={incidentId}
            onChange={setIncidentId}
            options={[{ value: '', label: t('adminSupport.incident.none') }, ...rows.map((i) => ({ value: i.id, label: pick(i.title), description: t(`adminHealth.incidentStatus.${i.status}`) }))]}
          />
        )}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Escalader (ingénierie) ---------- */
export function EscalateDialog({ ticket, onClose, onDone }: { ticket: AdminTicketDto | null; onClose: () => void; onDone: (t: AdminTicketDto) => void }) {
  const typed = useTypedFlag(!!ticket);
  const t = useT();
  const [note, setNote] = useState('');
  useOnOpen(!!ticket, () => {
    setNote('');
    s.setError(null);
  });
  const s = useDialogSubmit(() => opsApi.escalate(ticket!.id, note.trim()));
  const submit = async () => {
    const r = await s.submit();
    if (r) {
      toast({ tone: 'success', message: t('adminSupport.escalate.done') });
      onDone(r);
      onClose();
    }
  };
  const guard = useCloseGuard(typed.dirty, t('adminSupport.escalate.title'), onClose);
  return (
    <>
    <Dialog
      open={!!ticket}
      onOpenChange={(o) => !o && guard.requestClose()}
      title={t('adminSupport.escalate.title')}
      description={ticket ? `${docRef(t, ticket.number)} · ${ticket.subject}` : undefined}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={guard.requestClose} busy={s.busy} onSubmit={() => void submit()} label={t('adminSupport.escalate.submit')} disabledReason={note.trim() ? undefined : t('adminSupport.escalate.noteRequired')} />}
    >
      <div onChange={typed.onChange} className="flex flex-col gap-3">
        <Field label={t('adminSupport.escalate.note')} htmlFor="esc-note" required error={s.fieldError('note')}>
          <Textarea id="esc-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}

/* ---------- Réponse type ---------- */
export function CannedDialog({ open, reply, onClose }: { open: boolean; reply: CannedReplyDto | null; onClose: () => void }) {
  const typed = useTypedFlag(open);
  const t = useT();
  const qc = useQueryClient();
  const [key, setKey] = useState('/');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('');
  const [body, setBody] = useState<OpsLocalizedText>(EMPTY_LOCALIZED);
  useOnOpen(open, () => {
    setKey(reply?.key ?? '/');
    setTitle(reply?.title ?? '');
    setCategory(reply?.category ?? '');
    setBody(reply ? { fr: reply.body.fr, ar: reply.body.ar ?? '', en: reply.body.en ?? '' } : EMPTY_LOCALIZED);
    s.setError(null);
  });
  const s = useDialogSubmit(() => {
    const cat = (category || null) as CannedReplyDto['category'] as (typeof TicketCategoryValues)[number] | null;
    return reply
      ? opsApi.updateCanned(reply.id, { title: title.trim(), body: cleanLocalized(body), category: cat })
      : opsApi.createCanned({ key: key.trim(), title: title.trim(), body: cleanLocalized(body), category: cat });
  });
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSupport.canned.saved') });
      await qc.invalidateQueries({ queryKey: opsKeys.canned });
      onClose();
    }
  };
  const guard = useCloseGuard(typed.dirty, reply ? t('adminSupport.canned.edit', { key: reply.key }) : t('adminSupport.canned.new'), onClose);
  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => !o && guard.requestClose()}
      title={reply ? t('adminSupport.canned.edit', { key: reply.key }) : t('adminSupport.canned.new')}
      description={t('adminSupport.canned.sub')}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={guard.requestClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} disabledReason={!title.trim() || !body.fr.trim() ? t('adminSupport.canned.required') : undefined} />}
    >
      <div onChange={typed.onChange} className="flex flex-col gap-4" data-testid="canned-form">
        {!reply ? (
          <Field label={t('adminSupport.canned.col.key')} htmlFor="cr-key" required error={s.fieldError('key')} hint={t('adminSupport.canned.key.hint')}>
            <Input id="cr-key" dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t('adminSupport.canned.col.title')} htmlFor="cr-title" required error={s.fieldError('title')}>
          <Input id="cr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('adminSupport.col.category')} htmlFor="cr-cat">
          <Select id="cr-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('adminSupport.canned.anyCategory')}</option>
            {TicketCategoryValues.map((c) => (
              <option key={c} value={c}>
                {t(`adminSupport.category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <LocalizedFields idPrefix="cr-body" label={t('adminSupport.canned.col.body')} value={body} onChange={setBody} multiline required error={s.fieldError('body.fr')} />
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
    {guard.element}
    </>
  );
}
