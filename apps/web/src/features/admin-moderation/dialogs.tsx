'use client';
// ADM-10 dialogs (pattern of "DLG — Platform admin — dialogs catalogue"): bulk "Rejeter (motif commun)" (reason chip +
// message to the merchants, per-item results — never all or nothing) and "Assigner" (one item or the selection).
import { MODERATION_REASON_TEMPLATES, type BulkItemResult, type ModerationDecision } from '@djaber/shared';
import { DecisionChip, Field, FormAlert, Select, Textarea, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminDialog, useOnOpen } from '@/features/admin/dialog-kit';
import { usePlatform } from '@/features/admin/platform';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { modApi, useAssignees, useModerationRefresh } from './api';

type Named = { id: string; name: string };
const failures = (rows: BulkItemResult[], names: Named[]) =>
  rows.filter((r) => !r.ok).map((r) => `${names.find((n) => n.id === r.id)?.name ?? r.id.slice(0, 8)} : ${r.error?.message ?? r.error?.code ?? ''}`);

/** Reject with a common reason — the selection, or one row (its ✕ button, tester report 25/10 UX-005: `single`). */
export function BulkRejectDialog({ open, onClose, items, onDone, single }: { open: boolean; onClose: () => void; items: Named[]; onDone: (failedIds: string[]) => void; single?: boolean }) {
  const t = useT();
  const refresh = useModerationRefresh();
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  useOnOpen(open, () => {
    setDecision(null);
    setMessage('');
    setError(null);
    setFailed([]);
  });
  const send = useMutation({ mutationFn: () => modApi.bulk('reject', { ids: items.map((i) => i.id), decision: decision ?? undefined, reasonTemplateKey: decision ?? undefined, merchantMessage: message.trim() || undefined }) });
  const submit = async () => {
    setError(null);
    try {
      const rows = await send.mutateAsync();
      const ko = failures(rows, items);
      const ok = rows.filter((r) => r.ok).length;
      void refresh();
      toast({ tone: ko.length ? 'warning' : 'success', message: t('adminMod.bulk.result', { ok, ko: ko.length }) });
      if (ko.length) {
        setFailed(ko);
        onDone(rows.filter((r) => !r.ok).map((r) => r.id));
      } else {
        onDone([]);
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={single && items[0] ? t('adminMod.reject.titleOne', { name: items[0].name }) : t('adminMod.bulk.rejectTitle')}
      context={single ? undefined : t('adminMod.bulk.context', { count: items.length })}
      submitLabel={t('adminMod.action.reject')}
      onSubmit={() => void submit()}
      destructive
      pending={send.isPending}
      error={error}
      note={t('adminMod.bulk.note')}
      testId={single ? 'mod-reject' : 'mod-bulk-reject'}
    >
      <div role="radiogroup" aria-label={t('adminMod.panel.decision')} className="flex flex-wrap gap-2">
        {MODERATION_REASON_TEMPLATES.map((r) => (
          <DecisionChip key={r} name="bulk-decision" value={r} checked={decision === r} onChange={() => setDecision(r)}>
            {t(`adminMod.reason.${r}`)}
          </DecisionChip>
        ))}
      </div>
      <Field label={t('adminMod.panel.message')} required htmlFor="bulk-message">
        <Textarea id="bulk-message" rows={4} value={message} placeholder={t('adminMod.panel.messagePlaceholder')} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
      </Field>
      {failed.length ? (
        <FormAlert tone="warning">
          <ul data-testid="mod-bulk-failures">
            {failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </FormAlert>
      ) : null}
    </AdminDialog>
  );
}

/** "Assigner" — to me, to another moderator, or nobody; one item (`POST …/:id/assign`) or the selection (bulk). */
export function AssignDialog({ open, onClose, items, onDone }: { open: boolean; onClose: () => void; items: Named[]; onDone: () => void }) {
  const t = useT();
  const { userId } = usePlatform();
  const refresh = useModerationRefresh();
  const members = useAssignees(open);
  const [value, setValue] = useState<string>('me');
  const [error, setError] = useState<string | null>(null);
  useOnOpen(open, () => {
    setValue('me');
    setError(null);
  });
  const target = value === 'me' ? userId : value === 'none' ? null : value;
  const send = useMutation({
    mutationFn: async () => {
      if (items.length === 1) {
        await modApi.assign(items[0]!.id, { assigneeId: target });
        return [] as BulkItemResult[];
      }
      return modApi.bulk('assign', { ids: items.map((i) => i.id), assigneeId: target });
    },
  });
  const submit = async () => {
    setError(null);
    try {
      const rows = await send.mutateAsync();
      const ko = failures(rows, items);
      void refresh();
      if (ko.length) return setError(ko.join(' · '));
      toast({ tone: 'success', message: t('adminMod.assign.done', { count: items.length }) });
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={t('adminMod.assign.title')}
      context={items.length === 1 ? items[0]!.name : t('adminMod.bulk.context', { count: items.length })}
      submitLabel={t('adminMod.action.assign')}
      onSubmit={() => void submit()}
      pending={send.isPending}
      error={error}
      note={t('adminMod.assign.note')}
      testId="mod-assign"
    >
      <Field label={t('adminMod.assign.to')} htmlFor="assign-to">
        <Select id="assign-to" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="me">{t('adminMod.assign.me')}</option>
          {(members.data ?? [])
            .filter((m) => m.id !== userId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.name} · ${t(`admin.shell.role.${m.role}`)}`}
              </option>
            ))}
          <option value="none">{t('adminMod.assign.nobody')}</option>
        </Select>
      </Field>
    </AdminDialog>
  );
}
