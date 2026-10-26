'use client';
// /settings/danger — Figma "SET — Settings — … Danger zone" + DLG "Supprimer l'espace" (FL-14): typed confirmation ·
// blocked (WORKSPACE_HAS_DEBT, already scheduled — shown only when the API answers it, tester report 25/10) · scheduled
// state with cancel. Owner only (`workspace.delete`).
import { formatDate, type AppLocale } from '@djaber/shared';
import { Button, Dialog, Field, FormAlert, Input, PasswordInput, Pill, Skeleton, toast } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DeleteAccountSection } from '@/features/settings/account-dialogs';
import { Section, SettingsPage } from '@/features/settings/common';
import { useWorkspaceCache, workspaceApi } from '@/features/workspace/api';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';

export default function DangerZonePage() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const qc = useQueryClient();
  const { workspace, can } = useSession();
  const write = useWorkspaceCache();
  const [open, setOpen] = useState(false);
  const cancel = useMutation({ mutationFn: workspaceApi.cancelDeletion });
  const allowed = can('workspace.delete');

  const onCancel = async () => {
    try {
      const res = await cancel.mutateAsync();
      write({ status: res.status, deletionScheduledAt: res.deletionScheduledAt });
      void qc.invalidateQueries({ queryKey: meKey });
      toast(t('settings.danger.cancelled'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const scheduled = workspace?.status === 'deletion_scheduled';
  const plan = workspace?.plan;
  return (
    <SettingsPage title={t('nav.settings.danger')} permission="workspace.delete">
      <Section tone="danger" title={t('settings.danger.workspace.title')}>
        {!workspace ? (
          <Skeleton className="h-16" />
        ) : scheduled ? (
          <div className="flex flex-wrap items-center gap-3" data-state="scheduled">
            <div className="min-w-0 flex-1">
              <Pill tone="danger">{t('enum.Workspace.status.deletion_scheduled')}</Pill>
              <p className="mt-2 text-[13px] text-text-secondary">
                {t('settings.danger.scheduled', { name: workspace.name, date: workspace.deletionScheduledAt ? formatDate(workspace.deletionScheduledAt, locale) : '—' })}
              </p>
            </div>
            <Button variant="primary" onClick={onCancel} loading={cancel.isPending} disabledReason={allowed ? undefined : t('error.READ_ONLY_MEMBER')}>
              {t('settings.danger.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-text-secondary">
              {t('settings.danger.description', { name: workspace.name })}{' '}
              {plan && plan.slug !== 'free' ? t('settings.danger.planNote', { plan: plan.name, date: formatDate(plan.periodEnd, locale) }) : null}
            </p>
            <Button variant="danger" onClick={() => setOpen(true)} disabledReason={allowed ? undefined : t('error.READ_ONLY_MEMBER')}>
              {t('settings.danger.open')}
            </Button>
          </div>
        )}
      </Section>
      <DeleteAccountSection />
      {workspace ? <DeleteWorkspaceDialog open={open} name={workspace.name} onClose={() => setOpen(false)} /> : null}
    </SettingsPage>
  );
}

function DeleteWorkspaceDialog({ open, name, onClose }: { open: boolean; name: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const write = useWorkspaceCache();
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field?: 'password' | 'name'; message: string } | null>(null);
  const remove = useMutation({ mutationFn: workspaceApi.remove });
  useEffect(() => {
    if (open) {
      setTyped('');
      setPassword('');
      setError(null);
    }
  }, [open]);

  // must match exactly (case and spaces included, apart from the surrounding ones)
  const matches = typed.trim() === name.trim();
  const submit = async () => {
    setError(null);
    try {
      const res = await remove.mutateAsync({ password, confirmName: typed.trim() });
      write({ status: res.status, deletionScheduledAt: res.deletionScheduledAt });
      void qc.invalidateQueries({ queryKey: meKey });
      toast({ tone: 'warning', message: t('settings.danger.done') });
      onClose();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const fields = e instanceof ApiError ? e.body.fields : {};
      setError({
        field: code === 'AUTH_INVALID_CREDENTIALS' || code === 'AUTH_CURRENT_PASSWORD_INCORRECT' || fields.password ? 'password' : fields.confirmName ? 'name' : undefined,
        message: errorMessage(e, t),
      });
    }
  };
  const busy = remove.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.deleteWorkspace.title', { name })}
      description={t('settings.danger.dialog.context')}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="delete-workspace"
            loading={busy}
            disabledReason={!matches ? t('settings.danger.dialog.needName', { name }) : !password ? t('settings.danger.dialog.needPassword') : undefined}
          >
            {t('settings.danger.dialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="delete-workspace"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && password) void submit();
        }}
      >
        <div>
          <Pill tone="danger">{t('common.destructive')}</Pill>
        </div>
        <FormAlert>{t('settings.danger.dialog.warning')}</FormAlert>
        <Field label={t('settings.danger.dialog.typeName')} htmlFor="confirm-name" hint={t('settings.danger.dialog.nameHint', { name })} error={error?.field === 'name' ? error.message : undefined}>
          <Input id="confirm-name" autoComplete="off" placeholder={name} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} aria-invalid={error?.field === 'name'} />
        </Field>
        <Field label={t('common.password')} htmlFor="delete-ws-password" error={error?.field === 'password' ? error.message : undefined}>
          <PasswordInput
            id="delete-ws-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={error?.field === 'password'}
            showLabel={t('auth.password.show')}
            hideLabel={t('auth.password.hide')}
          />
        </Field>
        {error && !error.field ? <FormAlert>{error.message}</FormAlert> : null}
      </form>
    </Dialog>
  );
}
