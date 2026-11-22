'use client';
// ADM-16 — « Demandes de suppression des données clients » (MSG-08): the end customers' data deletions of
// `GET /admin/data-deletion-requests` (Meta callback + e-mail requests), second list of `/admin/team`. Filters live in the
// URL under `dd.` (`?dd.status=pending&dd.source=admin`) so they never mix with the account-deletion list of the same page.
// « Nouvelle demande » (`POST /admin/data-deletion-requests`, `admin.deletion.write`) runs the same job as the callback and
// shows the status URL to send back to the requester.
import type { AdminDataDeletionRequestDto } from '@djaber/shared';
import { ActionsMenu, Button, Dialog, Field, FrameNote, Input, Ltr, MonoChip, PhoneInput, SegmentedControl, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { fieldError } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { formatPhoneOnBlur, phonePreviewLine } from '@/lib/phone';
import { useListState } from '@/lib/use-list-state';
import { adminWrite, useAdminInvalidate, useAdminList } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '../list-kit';
import { WorkspacePicker } from '../pickers';
import { DATA_DELETION_LIST } from '../specs';
import { AdminPill, useFormats } from '../ui';
import {
  canSubmitDataDeletion,
  DATA_DELETION_FIELDS,
  DATA_DELETION_SOURCES,
  DATA_DELETION_STATUSES,
  dataDeletionBody,
  dataDeletionFieldErrors,
  dataDeletionRowActions,
  dataDeletionSummaryParts,
  EMPTY_DATA_DELETION_FORM,
  type DataDeletionForm,
} from './data-deletion-logic';

const PATH = '/admin/data-deletion-requests';

async function copyText(text: string, t: ReturnType<typeof useT>) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copied'));
  } catch {
    // no clipboard (plain HTTP, denied permission): the value is shown so it can be selected by hand
    toast({ tone: 'warning', message: text });
  }
}

export function DataDeletionSection({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const f = useFormats();
  const router = useRouter();
  const list = useListState(DATA_DELETION_LIST);
  const query = useAdminList<AdminDataDeletionRequestDto>(PATH, list.apiQuery());
  const [creating, setCreating] = useState(false);
  const quick: AdminFilter[] = useMemo(
    () => [
      { kind: 'multi', key: 'status', label: t('admin.team.dd.filter.status'), options: DATA_DELETION_STATUSES.map((s) => ({ value: s, label: t(`admin.team.dd.status.${s}`) })) },
      { kind: 'single', key: 'source', label: t('admin.team.dd.filter.source'), options: DATA_DELETION_SOURCES.map((s) => ({ value: s, label: t(`admin.team.dd.source.${s}`) })) },
    ],
    [t],
  );
  const result = (r: AdminDataDeletionRequestDto) => {
    if (r.status === 'pending') return <span className="text-text-muted">{t('admin.team.dd.summary.waiting')}</span>;
    const parts = dataDeletionSummaryParts(r);
    const resolution = r.resolution === 'failed' || r.resolution === 'none' ? t(`admin.team.dd.resolution.${r.resolution}`) : null;
    return (
      <span className="flex flex-col">
        <span>{parts.length ? parts.map((p) => t(`admin.team.dd.summary.${p.key}`, { count: p.count })).join(' · ') : t('admin.team.dd.summary.nothing')}</span>
        {resolution ? <span className="ts-label-micro text-accent-alert">{resolution}</span> : null}
      </span>
    );
  };
  const columns: Column<AdminDataDeletionRequestDto>[] = [
    { key: 'at', header: t('admin.team.dd.col.requested'), hideable: false, cell: (r) => <span className="whitespace-nowrap">{f.short(r.requestedAt)}</span> },
    { key: 'code', header: t('admin.team.dd.col.code'), cell: (r) => <Ltr className="font-mono text-[12px]">{r.code}</Ltr> },
    { key: 'source', header: t('admin.team.dd.col.source'), cell: (r) => <MonoChip tone={r.source === 'admin' ? 'info' : 'neutral'}>{t(`admin.team.dd.source.${r.source}`)}</MonoChip> },
    { key: 'target', header: t('admin.team.dd.col.target'), cell: (r) => (r.target ? <Ltr className="tabular-nums">{r.target}</Ltr> : <span className="text-text-muted">{t('admin.team.dd.target.erased')}</span>) },
    { key: 'ws', header: t('admin.team.dd.col.workspace'), hideBelow: 'lg', cell: (r) => (r.workspaceId ? <Ltr className="font-mono text-[12px]">{`${r.workspaceId.slice(0, 8)}…`}</Ltr> : t('admin.team.dd.allWorkspaces')) },
    { key: 'result', header: t('admin.team.dd.col.result'), hideBelow: 'lg', className: 'max-w-[320px]', cell: result },
    {
      key: 'state',
      header: t('admin.team.dd.col.state'),
      cell: (r) => (
        <AdminPill group="DataDeletion.status" value={r.status}>
          {`${t(`admin.team.dd.status.${r.status}`)}${r.completedAt ? ` · ${f.short(r.completedAt)}` : ''}`}
        </AdminPill>
      ),
    },
  ];
  const menu = (r: AdminDataDeletionRequestDto) => {
    const offered = new Set(dataDeletionRowActions(r));
    return (
      <ActionsMenu
        label={t('action.actions')}
        heading={r.code}
        actions={toMenuActions(
          [],
          {
            copy_link: { label: t('admin.team.dd.action.copy_link'), onSelect: () => void copyText(r.statusUrl, t), local: true },
            copy_code: { label: t('admin.team.dd.action.copy_code'), onSelect: () => void copyText(r.code, t), local: true },
            open_status: { label: t('admin.team.dd.action.open_status'), onSelect: () => window.open(r.statusUrl, '_blank', 'noopener'), local: true },
            open_workspace: { label: t('admin.team.dd.action.open_workspace'), onSelect: () => router.push(`/admin/workspaces?sheet=${r.workspaceId}`), local: true, hidden: !offered.has('open_workspace'), separated: true },
          },
          t,
        )}
      />
    );
  };
  return (
    <>
      <div className="flex flex-col gap-3" data-testid="data-deletion-requests">
        <AdminFilterBar
          list={list}
          quick={quick}
          end={
            canWrite ? (
              <Button variant="primary" className="ms-auto" onClick={() => setCreating(true)} data-testid="data-deletion-new">
                {t('admin.team.dd.new')}
              </Button>
            ) : null
          }
        />
        <AdminListBody
          testId="data-deletion-list"
          filters={quick}
          query={query}
          list={list}
          columns={columns}
          rowKey={(r) => r.id}
          label={t('admin.team.dd.title')}
          entity={t('admin.team.dd.entity')}
          empty={{ title: t('admin.team.dd.empty'), action: canWrite ? { label: t('admin.team.dd.new'), onClick: () => setCreating(true) } : undefined }}
          rowActions={menu}
        />
        <FrameNote>{t('admin.team.dd.note')}</FrameNote>
      </div>
      {canWrite ? <NewDataDeletionDialog open={creating} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

export function NewDataDeletionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [form, setForm] = useState<DataDeletionForm>(EMPTY_DATA_DELETION_FORM);
  const [wsLabel, setWsLabel] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const [created, setCreated] = useState<AdminDataDeletionRequestDto | null>(null);
  const m = useMutation({ mutationFn: (body: unknown) => adminWrite<AdminDataDeletionRequestDto>(PATH, 'POST', body, true) });
  useOnOpen(open, () => {
    setForm(EMPTY_DATA_DELETION_FORM);
    setWsLabel(undefined);
    setErrors(NO_ERRORS);
    setCreated(null);
  });
  const set = (patch: Partial<DataDeletionForm>) => setForm((x) => ({ ...x, ...patch }));
  const local = dataDeletionFieldErrors(form);
  const fieldMsg = (name: 'phone' | 'externalSenderId' | 'ticketId' | 'workspaceId') => errors.fields[name] ?? (local[name as keyof typeof local] ? fieldError(t, local[name as keyof typeof local]) : undefined);
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const row = await m.mutateAsync(dataDeletionBody(form));
      void invalidate(PATH, '/admin/audit-logs');
      toast(t('admin.team.dd.created.toast'));
      setCreated(row);
    } catch (e) {
      // the form keeps what was typed; field errors next to their input, the rest in the dialog
      setErrors(toServerErrors(e, t, DATA_DELETION_FIELDS, { ADMIN_REASON_REQUIRED: 'reason', NOT_FOUND: 'workspaceId' }));
    }
  };
  if (!open) return null;
  if (created)
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('admin.team.dd.created.title')}
        description={t('admin.team.dd.created.body', { code: created.code })}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('action.close')}
            </Button>
            <Button variant="primary" onClick={() => void copyText(created.statusUrl, t)} data-testid="dlg-data-deletion-copy">
              {t('admin.team.dd.created.copy')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2" data-testid="dlg-data-deletion-created">
          <Field label={t('admin.team.dd.created.link')} htmlFor="f-dd-url">
            <Input id="f-dd-url" readOnly dir="ltr" value={created.statusUrl} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="flex items-center gap-2">
            <AdminPill group="DataDeletion.status" value={created.status}>
              {t(`admin.team.dd.status.${created.status}`)}
            </AdminPill>
            <Ltr className="font-mono text-[12px] text-text-muted">{created.code}</Ltr>
          </div>
        </div>
      </Dialog>
    );
  return (
    <AdminDialog
      open
      onClose={onClose}
      testId="dlg-data-deletion"
      size="md"
      title={t('admin.team.dd.dialog.title')}
      context={t('admin.team.dd.dialog.context')}
      note={t('admin.team.dd.dialog.note')}
      destructive
      submitLabel={t('admin.team.dd.dialog.submit')}
      disabled={!canSubmitDataDeletion(form)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      <Field label={t('admin.team.dd.dialog.by')}>
        <SegmentedControl
          label={t('admin.team.dd.dialog.by')}
          value={form.by}
          onChange={(by) => set({ by })}
          options={[
            { value: 'phone', label: t('admin.team.dd.dialog.by.phone') },
            { value: 'sender', label: t('admin.team.dd.dialog.by.sender') },
          ]}
        />
      </Field>
      {form.by === 'phone' ? (
        <Field label={t('admin.team.dd.dialog.phone')} required htmlFor="f-dd-phone" error={fieldMsg('phone')}>
          <PhoneInput id="f-dd-phone" name="phone" placeholder="0550 12 34 56" autoComplete="off" maxLength={32} value={form.phone} format={formatPhoneOnBlur} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!fieldMsg('phone')} preview={fieldMsg('phone') ? null : phonePreviewLine(t, form.phone)} />
        </Field>
      ) : (
        <Field label={t('admin.team.dd.dialog.sender')} required htmlFor="f-dd-sender" hint={fieldMsg('externalSenderId') ? undefined : t('admin.team.dd.dialog.senderHint')} error={fieldMsg('externalSenderId')}>
          <Input id="f-dd-sender" name="externalSenderId" dir="ltr" inputMode="numeric" autoComplete="off" maxLength={32} className="font-mono" value={form.senderId} onChange={(e) => set({ senderId: e.target.value.replace(/\s/g, '') })} aria-invalid={!!fieldMsg('externalSenderId')} />
        </Field>
      )}
      <Field label={t('admin.team.dd.dialog.workspace')} htmlFor="f-dd-ws" hint={fieldMsg('workspaceId') ? undefined : t('admin.team.dd.dialog.workspaceHint')} error={fieldMsg('workspaceId')}>
        <WorkspacePicker
          id="f-dd-ws"
          value={form.workspaceId}
          initialLabel={wsLabel}
          invalid={!!fieldMsg('workspaceId')}
          onChange={(id, ws) => {
            setWsLabel(ws?.name);
            set({ workspaceId: id });
          }}
        />
      </Field>
      <ReasonField value={form.reason} onChange={(reason) => set({ reason })} error={errors.fields.reason} multiline />
      <Field label={t('admin.team.dd.dialog.ticket')} htmlFor="f-dd-ticket" hint={fieldMsg('ticketId') ? undefined : t('admin.team.dd.dialog.ticketHint')} error={fieldMsg('ticketId')}>
        <Input id="f-dd-ticket" name="ticketId" dir="ltr" autoComplete="off" maxLength={36} className="font-mono" value={form.ticketId} onChange={(e) => set({ ticketId: e.target.value.trim() })} aria-invalid={!!fieldMsg('ticketId')} />
      </Field>
    </AdminDialog>
  );
}
