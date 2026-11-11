'use client';
// Account dialogs of "DLG — Settings & billing — dialogs catalogue": Changer l'e-mail, Supprimer mon compte.
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangeEmailSchema, formatDate, type AppLocale, type ChangeEmailInput } from '@djaber/shared';
import { Button, buttonClass, Dialog, EmailInput, Field, FormAlert, Input, PasswordInput, Pill, toast } from '@djaber/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { authApi } from '@/features/auth/api';
import { Link, usePathname } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { applyServerErrors, errorMessage, fieldError } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';
import { Section } from './common';

/** "Changer l'e-mail": the old address stays active until the link (24 h) sent to the new one is opened. */
export function ChangeEmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { me } = useSession();
  const form = useForm<ChangeEmailInput>({ resolver: zodResolver(ChangeEmailSchema), defaultValues: { newEmail: '', password: '' } });
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const change = useMutation({ mutationFn: authApi.changeEmail });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset();
      setFormError(null);
      setSentTo(null);
    }
  }, [open, reset]);

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const res = await change.mutateAsync({ email: v.newEmail, password: v.password });
      setSentTo(res.pendingEmail);
    } catch (e) {
      setFormError(
        applyServerErrors(form, e, t, {
          fields: ['password'],
          codeToField: { AUTH_EMAIL_TAKEN: 'newEmail', AUTH_CURRENT_PASSWORD_INCORRECT: 'password', AUTH_INVALID_CREDENTIALS: 'password' },
        }),
      );
      // the API names the field `email`
      if (e instanceof ApiError && e.body.fields.email) form.setError('newEmail', { type: 'server', message: e.body.fields.email });
    }
  });
  const busy = change.isPending;
  const errors = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.changeEmail.title')}
      description={t('settings.email.context', { email: me?.email ?? '' })}
      closeLabel={t('action.close')}
      footer={
        sentTo ? (
          <Button variant="primary" onClick={onClose}>
            {t('action.ok')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" type="submit" form="change-email" loading={busy}>
              {t('settings.email.submit')}
            </Button>
          </>
        )
      }
    >
      {sentTo ? (
        <FormAlert tone="success">{t('settings.email.sent', { email: sentTo })}</FormAlert>
      ) : (
        <form id="change-email" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={t('settings.email.new')} htmlFor="newEmail" error={fieldError(t, errors.newEmail?.message)}>
            <EmailInput id="newEmail" disabled={busy} aria-invalid={!!errors.newEmail} {...form.register('newEmail')} />
          </Field>
          <Field label={t('common.password')} htmlFor="email-password" error={fieldError(t, errors.password?.message)}>
            <PasswordInput
              id="email-password"
              autoComplete="current-password"
              disabled={busy}
              aria-invalid={!!errors.password}
              showLabel={t('auth.password.show')}
              hideLabel={t('auth.password.hide')}
              {...form.register('password')}
            />
          </Field>
          <p className="ts-label-meta text-text-muted">{t('settings.email.note')}</p>
          {formError ? <FormAlert>{formError}</FormAlert> : null}
        </form>
      )}
    </Dialog>
  );
}

/** Account deletion entry (AUTH-07, DEL-01): blocked while the user owns a workspace, else 30-day grace with cancel. */
export function DeleteAccountSection() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const qc = useQueryClient();
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const key = ['session', 'deletion-request', me?.id] as const;
  const current = useQuery({ queryKey: key, queryFn: authApi.deletionRequest, enabled: !!me });
  const cancel = useMutation({ mutationFn: authApi.cancelDeletion });
  const scheduledAt = current.data?.status === 'grace' ? current.data.scheduledAt : me?.deletionScheduledAt;

  const onCancel = async () => {
    try {
      await cancel.mutateAsync();
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: meKey })]);
      toast(t('settings.deleteAccount.cancelled'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <Section title={t('dialog.deleteAccount.title')} tone="danger">
      {scheduledAt ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-text-secondary">{t('settings.deleteAccount.scheduled', { date: formatDate(scheduledAt, locale) })}</p>
          <Button onClick={onCancel} loading={cancel.isPending}>
            {t('settings.deleteAccount.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-text-secondary">{t('settings.deleteAccount.description')}</p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t('settings.deleteAccount.open')}
          </Button>
        </div>
      )}
      <DeleteAccountDialog
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: key });
          void qc.invalidateQueries({ queryKey: meKey });
        }}
      />
    </Section>
  );
}

export function DeleteAccountDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const { me, membership } = useSession();
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const request = useMutation({ mutationFn: authApi.requestDeletion });
  useEffect(() => {
    if (open) {
      setPassword('');
      setTotp('');
      setError(null);
    }
  }, [open]);

  const owns = !!me?.ownedWorkspaceId;
  const ownedName = me?.memberships.find((m) => m.workspaceId === me.ownedWorkspaceId)?.name ?? membership?.name ?? '';
  const blocked = owns || error?.code === 'ACCOUNT_OWNS_WORKSPACE';
  const submit = async () => {
    setError(null);
    try {
      await request.mutateAsync({ password, ...(me?.totpEnabled ? { totpCode: totp.trim() } : {}) });
      toast(t('settings.deleteAccount.requested'));
      onDone();
      onClose();
    } catch (e) {
      setError({ code: e instanceof ApiError ? e.code : null, message: errorMessage(e, t) });
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.deleteAccount.title')}
      closeLabel={t('action.close')}
      footer={
        <>
          {/* the section is also on the danger zone itself: there, the link would only close the dialog */}
          {blocked && pathname !== '/settings/danger' ? (
            <Link href="/settings/danger" onClick={onClose} className={buttonClass({ variant: 'ghost' })}>
              {t('settings.deleteAccount.goDanger')}
            </Link>
          ) : (
            <Button variant="ghost" onClick={onClose} disabled={request.isPending}>
              {t('action.cancel')}
            </Button>
          )}
          <Button
            variant="danger"
            onClick={submit}
            loading={request.isPending}
            disabled={!password || (me?.totpEnabled && totp.trim().length < 6)}
            disabledReason={owns ? t('error.ACCOUNT_OWNS_WORKSPACE') : undefined}
          >
            {t('action.delete')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Pill tone="danger">{t('common.destructive')}</Pill>
        </div>
        {owns ? <FormAlert>{t('settings.deleteAccount.owns', { workspace: ownedName })}</FormAlert> : null}
        <Field label={t('common.password')} htmlFor="delete-password">
          <PasswordInput
            id="delete-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={owns || request.isPending}
            showLabel={t('auth.password.show')}
            hideLabel={t('auth.password.hide')}
          />
        </Field>
        {me?.totpEnabled ? (
          <Field label={t('settings.twofa.code')} htmlFor="delete-totp">
            <Input id="delete-totp" inputMode="numeric" dir="ltr" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} disabled={owns || request.isPending} />
          </Field>
        ) : null}
        <p className="ts-label-meta text-text-muted">{t('settings.deleteAccount.note')}</p>
        {error && !(owns && error.code === 'ACCOUNT_OWNS_WORKSPACE') ? <FormAlert>{error.message}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
