'use client';
// /workspaces/new — Figma "AUTH — States catalogue" (Créer mon espace, utilisateur invité seulement): form · saving · blocked if already owner.
// UX-047 (10/11): an account in its deletion grace sees « Compte désactivé » (cancel / export) first; an account without a
// shop opens « Supprimer mon compte… » from here (Paramètres › Profil needs a shop). UX-045: « Se déconnecter » opens the login.
// UX-057 (retest 11/11): after « Annuler la suppression » the confirmation stays above the form until it is closed.
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateWorkspaceSchema, type CreateWorkspaceInput } from '@djaber/shared';
import { Button, buttonClass, Field, FormAlert, Input, Select } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard, AuthLink } from '@/components/auth/auth-card';
import { DeactivatedAccount } from '@/features/auth/deactivated-account';
import { DeleteAccountDialog } from '@/features/settings/account-dialogs';
import { useWilayas, workspaceApi } from '@/features/workspace/api';
import { Link, useRouter } from '@/i18n/navigation';
import { applyServerErrors, fieldError } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function CreateWorkspacePage() {
  const t = useT();
  const locale = useLocaleCode();
  const router = useRouter();
  const { me, refetchMe, switchWorkspace, logout } = useSession();
  const wilayas = useWilayas();
  const form = useForm<CreateWorkspaceInput>({ resolver: zodResolver(CreateWorkspaceSchema), defaultValues: { name: '', senderWilayaId: '', stockMode: 'simple' } });
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reactivated, setReactivated] = useState(false);
  const create = useMutation({ mutationFn: workspaceApi.create });

  // UX-045: same as the user menu — the session closes and the login page opens at once
  const leave = async () => {
    await logout();
    router.replace('/login');
  };

  if (me?.deletionScheduledAt) return <DeactivatedAccount scheduledAt={me.deletionScheduledAt} onLogout={() => void leave()} onCancelled={() => setReactivated(true)} />;

  if (me?.ownedWorkspaceId) {
    // D30: one owned workspace per user
    return (
      <AuthCard title={t('auth.createWorkspace.title')} description={t('auth.createWorkspace.blocked')}>
        <Link href="/home" className={buttonClass({ variant: 'primary', className: 'w-full' })}>
          {t('action.backHome')}
        </Link>
      </AuthCard>
    );
  }

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const ws = await create.mutateAsync({ name: values.name, senderWilayaId: values.senderWilayaId ? Number(values.senderWilayaId) : null, stockMode: values.stockMode });
      await refetchMe();
      switchWorkspace(ws.id);
      router.replace('/onboarding/welcome');
    } catch (e) {
      setFormError(applyServerErrors(form, e, t, { fields: ['name', 'senderWilayaId', 'stockMode'] }));
    }
  });

  const busy = create.isPending;
  const errors = form.formState.errors;
  return (
    <AuthCard
      title={t('auth.createWorkspace.title')}
      description={t('auth.createWorkspace.description')}
      footer={
        me && me.memberships.length > 0 ? (
          <AuthLink href="/home">{t('action.backHome')}</AuthLink>
        ) : (
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <button type="button" className="hover:text-text-primary hover:underline" onClick={() => void leave()} data-testid="create-ws-logout">
              {t('userMenu.logout')}
            </button>
            <button type="button" className="hover:text-accent-alert hover:underline" onClick={() => setDeleting(true)} data-testid="create-ws-delete-account">
              {t('settings.deleteAccount.open')}
            </button>
          </span>
        )
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        {reactivated ? (
          <FormAlert tone="success">
            <span data-testid="account-reactivated">{t('auth.deactivated.cancelled')}</span>
            <button type="button" className="ms-2 underline underline-offset-2 hover:text-text-primary" onClick={() => setReactivated(false)}>
              {t('action.close')}
            </button>
          </FormAlert>
        ) : null}
        <Field label={t('auth.createWorkspace.name')} htmlFor="name" required error={fieldError(t, errors.name?.message, { max: 80 })}>
          <Input id="name" placeholder={t('auth.createWorkspace.namePlaceholder')} disabled={busy} aria-invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label={t('common.wilaya')} htmlFor="senderWilayaId" error={fieldError(t, errors.senderWilayaId?.message)}>
          <Select id="senderWilayaId" disabled={busy || wilayas.isPending} aria-invalid={!!errors.senderWilayaId} {...form.register('senderWilayaId')}>
            <option value="">{t('common.none')}</option>
            {(wilayas.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {locale === 'ar' ? w.nameAr : w.nameFr}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('auth.createWorkspace.stockMode')} htmlFor="stockMode">
          <Select id="stockMode" disabled={busy} {...form.register('stockMode')}>
            <option value="simple">{t('settings.stockMode.simple.title')}</option>
            <option value="advanced">{t('settings.stockMode.advanced.title')}</option>
          </Select>
        </Field>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {t('auth.createWorkspace.submit')}
        </Button>
        <p className="ts-label-meta text-text-muted">{t('auth.createWorkspace.note')}</p>
      </form>
      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} onDone={() => void refetchMe()} />
    </AuthCard>
  );
}
