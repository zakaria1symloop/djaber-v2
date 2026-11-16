'use client';
// /settings/profile — Figma "SET — Settings — Profile · Workspace · Security" (Profil) + DLG "Changer l'e-mail", "Supprimer mon compte".
import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateProfileSchema, type AppLocale, type UpdateProfileInput } from '@djaber/shared';
import { Avatar, Button, Field, FormAlert, Input, Select, Skeleton, toast } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { LOCALE_NAMES } from '@/components/shell/merchant-shell';
import { authApi } from '@/features/auth/api';
import { ChangeEmailDialog, DeleteAccountSection } from '@/features/settings/account-dialogs';
import { Section, SettingsPage, useImageUpload } from '@/features/settings/common';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { applyServerErrors, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';

export default function ProfilePage() {
  const t = useT();
  const locale = useLocaleCode() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { me } = useSession();
  const [emailOpen, setEmailOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    // full-test 15/11 SETTINGS-01: the language field shows the interface in use (the URL), not a stale stored value — saving a
    // name no longer switches the app to another language
    defaultValues: { firstName: me?.firstName ?? '', lastName: me?.lastName ?? '', locale },
  });
  const { reset } = form;
  // a fresh /me (avatar change, refetch) re-seeds the form only while it is untouched: typed names are never wiped
  useEffect(() => {
    if (me && !form.formState.isDirty) reset({ firstName: me.firstName, lastName: me.lastName, locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the profile fields only
  }, [me?.firstName, me?.lastName, locale, reset]);

  const save = useMutation({ mutationFn: authApi.updateMe });
  const avatar = useImageUpload('avatar', async (avatarUploadId) => qc.setQueryData(meKey, await authApi.updateMe({ avatarUploadId })));
  const removeAvatar = useMutation({ mutationFn: () => authApi.updateMe({ avatarUploadId: null }), onSuccess: (data) => qc.setQueryData(meKey, data) });
  const { guard } = useLeaveGuard(form.formState.isDirty, t('nav.settings.profile'));

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const next = await save.mutateAsync(values);
      qc.setQueryData(meKey, next);
      reset({ firstName: next.firstName, lastName: next.lastName, locale: next.locale });
      setSaved(true);
      toast(t('toast.saved'));
      // the interface follows User.locale
      if (next.locale !== locale) router.replace(pathname, { locale: next.locale });
    } catch (e) {
      setFormError(applyServerErrors(form, e, t, { fields: ['firstName', 'lastName', 'locale'] }));
    }
  });

  if (!me) return <Skeleton className="h-64" />;
  const busy = save.isPending;
  const errors = form.formState.errors;
  const name = `${me.firstName} ${me.lastName}`.trim();
  return (
    <SettingsPage title={t('settings.profile.title')} description={t('settings.profile.description')}>
      <Section>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name} src={me.avatarUrl} size={64} />
          {avatar.input}
          <Button onClick={avatar.open} loading={avatar.uploading}>
            {avatar.uploading ? t('settings.upload.uploading') : t('settings.profile.changePhoto')}
          </Button>
          {me.avatarUrl ? (
            <Button variant="ghost" onClick={() => removeAvatar.mutate()} loading={removeAvatar.isPending}>
              {t('action.remove')}
            </Button>
          ) : null}
          <span className="ts-label-meta text-text-muted">{t('settings.upload.hint')}</span>
        </div>
        {avatar.error ? <FormAlert className="mt-3">{avatar.error}</FormAlert> : null}

        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4" aria-busy={busy}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.field.firstName')} htmlFor="firstName" error={fieldError(t, errors.firstName?.message, { max: 80 })}>
              <Input id="firstName" autoComplete="given-name" disabled={busy} aria-invalid={!!errors.firstName} {...form.register('firstName')} />
            </Field>
            <Field label={t('auth.field.lastName')} htmlFor="lastName" error={fieldError(t, errors.lastName?.message, { max: 80 })}>
              <Input id="lastName" autoComplete="family-name" disabled={busy} aria-invalid={!!errors.lastName} {...form.register('lastName')} />
            </Field>
            <Field label={t('common.email')} htmlFor="email" hint={t('settings.profile.emailHint')}>
              <div className="flex gap-2">
                <Input id="email" type="email" dir="ltr" value={me.email} readOnly disabled className="min-w-0 flex-1" />
                <Button onClick={() => setEmailOpen(true)}>{t('action.edit')}</Button>
              </div>
            </Field>
            <Field label={t('settings.profile.language')} htmlFor="locale">
              <Select id="locale" disabled={busy} {...form.register('locale')}>
                {routing.locales.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <div className="flex items-center justify-end gap-3">
            {saved && !form.formState.isDirty ? (
              <span role="status" className="ts-label-meta inline-flex items-center gap-1.5 text-accent-money">
                <span className="size-1.5 rounded-full bg-accent-money" aria-hidden />
                {t('state.form.saved')}
              </span>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} disabled={!form.formState.isDirty}>
              {busy ? t('common.saving') : t('action.save')}
            </Button>
          </div>
        </form>
      </Section>

      <DeleteAccountSection />
      <ChangeEmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
      {guard}
    </SettingsPage>
  );
}
