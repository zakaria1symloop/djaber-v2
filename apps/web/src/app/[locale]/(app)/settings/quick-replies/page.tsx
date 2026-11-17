'use client';
// /settings/quick-replies — Figma "SET — Settings — Quick replies …" + DLG "Réponse rapide" (AT-SET-01):
// list · empty · add / edit dialog (title unique, text ≤ 1 000, shortcut) · delete confirm · drag reorder.
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateQuickReplySchema, QUICK_REPLY_ACCEPTED, QUICK_REPLY_VARIABLES, unknownVariables, variablesLabel, type CreateQuickReply } from '@djaber/shared';
import { ActionsMenu, Button, Card, cn, CodeInput, ConfirmDialog, Dialog, Field, FormAlert, Input, Pill, Select, Textarea, toast, type MenuAction } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCloseGuard } from '@/components/close-guard';
import { useForm } from 'react-hook-form';
import { ListEmpty, ListLoading, QueryError } from '@/components/global-states';
import { LOCALE_NAMES } from '@/components/shell/merchant-shell';
import { Section, SettingsPage } from '@/features/settings/common';
import { moveBy, moveTo } from '@/features/settings/reorder';
import { quickRepliesKey, useQuickReplies, workspaceApi } from '@/features/workspace/api';
import { routing } from '@/i18n/routing';
import type { QuickReplyView } from '@/lib/contracts';
import { applyServerErrors, errorMessage, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';

export default function QuickRepliesPage() {
  const t = useT();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can } = useSession();
  const canEdit = can('workspace.settings');
  const list = useQuickReplies();
  const [editing, setEditing] = useState<QuickReplyView | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<QuickReplyView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const del = useMutation({ mutationFn: workspaceApi.deleteQuickReply });
  const reorder = useMutation({ mutationFn: workspaceApi.reorderQuickReplies });

  const rows = list.data ?? [];
  const ids = rows.map((r) => r.id);
  const applyOrder = async (next: string[]) => {
    if (next.join() === ids.join()) return;
    const previous = rows;
    // optimistic: the list shows the new order at once, and rolls back on error
    qc.setQueryData<QuickReplyView[]>(
      quickRepliesKey(ws),
      next.map((id) => rows.find((r) => r.id === id)!),
    );
    try {
      const saved = await reorder.mutateAsync(next);
      if (saved) qc.setQueryData(quickRepliesKey(ws), saved);
    } catch (e) {
      qc.setQueryData(quickRepliesKey(ws), previous);
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const actionsOf = (r: QuickReplyView, i: number): MenuAction[] =>
    canEdit
      ? [
          { key: 'edit', label: t('action.edit'), primary: true, onSelect: () => setEditing(r) },
          { key: 'up', label: t('settings.quickReplies.moveUp'), onSelect: () => void applyOrder(moveBy(ids, r.id, -1)), disabledReason: i === 0 ? t('settings.quickReplies.first') : undefined },
          { key: 'down', label: t('settings.quickReplies.moveDown'), onSelect: () => void applyOrder(moveBy(ids, r.id, 1)), disabledReason: i === rows.length - 1 ? t('settings.quickReplies.last') : undefined },
          { key: 'delete', label: t('action.delete'), destructive: true, onSelect: () => (setDeleteError(null), setToDelete(r)) },
        ]
      : [];

  return (
    <SettingsPage title={t('settings.quickReplies.title')} permission="workspace.settings">
      <Section description={t('settings.quickReplies.description')}>
        {list.isPending ? (
          <Card>
            <ListLoading rows={4} columns={3} />
          </Card>
        ) : list.isError ? (
          <QueryError error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <ListEmpty title={t('settings.quickReplies.empty')} action={canEdit ? { label: t('settings.quickReplies.add'), onClick: () => setEditing('new') } : undefined} />
        ) : (
          <Card>
            <ul className="divide-y divide-line-hairline" data-testid="quick-replies">
              {rows.map((r, i) => (
                <li
                  key={r.id}
                  data-title={r.title}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    setDragging(r.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (dragging && dragging !== r.id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) void applyOrder(moveTo(ids, dragging, r.id));
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn('flex items-center gap-3 px-3 py-2.5', dragging === r.id && 'opacity-40')}
                >
                  {canEdit ? <GripVertical className="size-4 shrink-0 cursor-grab text-text-muted" aria-hidden /> : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]" dir="auto">
                      {r.title}
                    </div>
                    <div className="ts-label-meta truncate text-text-muted" dir="auto">
                      {r.shortcut ? <bdi dir="ltr">{r.shortcut} · </bdi> : null}
                      {r.body}
                    </div>
                  </div>
                  <Pill>{r.locale}</Pill>
                  <ActionsMenu label={t('action.actions')} actions={actionsOf(r, i)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {canEdit && rows.length > 0 ? (
          <Button className="mt-3" onClick={() => setEditing('new')}>
            {t('settings.quickReplies.add')}
          </Button>
        ) : null}
        {!canEdit ? <p className="ts-label-meta mt-3 text-text-muted">{t('error.READ_ONLY_MEMBER')}</p> : null}
      </Section>

      <QuickReplyDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: quickRepliesKey(ws) });
          setEditing(null);
          toast(t('toast.saved'));
        }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('settings.quickReplies.delete.title', { title: toDelete?.title ?? '' })}
        description={t('settings.quickReplies.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={del.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          setDeleteError(null);
          try {
            await del.mutateAsync(toDelete.id);
            await qc.invalidateQueries({ queryKey: quickRepliesKey(ws) });
            setToDelete(null);
            toast(t('settings.quickReplies.deleted'));
          } catch (e) {
            setDeleteError(errorMessage(e, t));
          }
        }}
      >
        {deleteError ? <FormAlert>{deleteError}</FormAlert> : null}
      </ConfirmDialog>
    </SettingsPage>
  );
}

function QuickReplyDialog({ target, onClose, onSaved }: { target: QuickReplyView | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const uiLocale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const initial = target && target !== 'new' ? target : null;
  const form = useForm<CreateQuickReply>({ resolver: zodResolver(CreateQuickReplySchema), defaultValues: { title: '', body: '', shortcut: '', locale: uiLocale } });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: CreateQuickReply) => (initial ? workspaceApi.updateQuickReply(initial.id, v) : workspaceApi.createQuickReply(v)),
  });
  const { reset } = form;
  const open = target !== null;
  useEffect(() => {
    if (open) {
      reset(initial ? { title: initial.title, body: initial.body, shortcut: initial.shortcut ?? '', locale: initial.locale } : { title: '', body: '', shortcut: '', locale: uiLocale });
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seeded when the dialog opens on another row
  }, [open, initial?.id, reset]);
  const { guard } = useLeaveGuard(open && form.formState.isDirty, initial?.title ?? t('dialog.quickReply.title'));

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync({ ...values, shortcut: values.shortcut ? values.shortcut : null });
      onSaved();
    } catch (e) {
      // QUICK_REPLY_TITLE_TAKEN → inline under the title, content preserved
      setFormError(applyServerErrors(form, e, t, { fields: ['body', 'shortcut', 'locale'], codeToField: { QUICK_REPLY_TITLE_TAKEN: 'title', QUICK_REPLY_SHORTCUT_TAKEN: 'shortcut' } }));
    }
  });
  const busy = save.isPending;
  const errors = form.formState.errors;
  const body = form.watch('body') ?? '';
  // Esc / ✕ / Annuler with typed text: "Quitter sans enregistrer ?"
  const closeGuard = useCloseGuard(open && form.formState.isDirty, initial?.title ?? t('dialog.quickReply.title'), onClose);
  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && closeGuard.requestClose()}
      title={t('dialog.quickReply.title')}
      description={t('settings.quickReplies.dialog.context')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeGuard.requestClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="quick-reply-form" loading={busy}>
            {busy ? t('common.saving') : t('action.save')}
          </Button>
        </>
      }
    >
      <form
        id="quick-reply-form"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-busy={busy}
      >
        <Field label={t('settings.quickReplies.field.title')} htmlFor="qr-title" required error={fieldError(t, errors.title?.message, { max: 80 })} hint={t('settings.quickReplies.field.titleHint')}>
          <Input id="qr-title" maxLength={80} dir="auto" disabled={busy} aria-invalid={!!errors.title} {...form.register('title')} />
        </Field>
        <Field
          label={t('settings.quickReplies.field.body')}
          htmlFor="qr-body"
          required
          error={fieldError(t, errors.body?.message, { max: '1 000', names: unknownVariables(body, QUICK_REPLY_ACCEPTED).join(', '), allowed: variablesLabel(QUICK_REPLY_VARIABLES) })}
          hint={t('settings.quickReplies.field.bodyHint', { count: body.length })}
        >
          <Textarea id="qr-body" rows={4} maxLength={1000} dir="auto" disabled={busy} aria-invalid={!!errors.body} {...form.register('body')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.quickReplies.field.shortcut')} htmlFor="qr-shortcut" error={fieldError(t, errors.shortcut?.message)}>
            <CodeInput id="qr-shortcut" placeholder="/livr" disabled={busy} aria-invalid={!!errors.shortcut} {...form.register('shortcut')} />
          </Field>
          <Field label={t('settings.quickReplies.field.locale')} htmlFor="qr-locale">
            <Select id="qr-locale" disabled={busy} {...form.register('locale')}>
              {routing.locales.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
      </form>
      {guard}
    </Dialog>
    {closeGuard.element}
    </>
  );
}
