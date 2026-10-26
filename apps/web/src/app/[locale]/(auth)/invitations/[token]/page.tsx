'use client';
// /invitations/[token] — Figma "AUTH — Accept invitation — logged out" + States catalogue (Invitation):
// logged-out (sign-up with the fixed e-mail) · connecté bon e-mail (Accepter) · connecté autre e-mail · expirée · déjà membre · limite du plan.
import { zodResolver } from '@hookform/resolvers/zod';
import { AcceptInvitationSchema, formatDate, type AcceptInvitationInput } from '@djaber/shared';
import { Button, Field, FormAlert, Input, PasswordInput, Spinner, toast } from '@djaber/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard, AuthLink } from '@/components/auth/auth-card';
import { authApi } from '@/features/auth/api';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { applyServerErrors, errorMessage, fieldError } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

export default function InvitationPage() {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { status, me, signIn, logout, switchWorkspace } = useSession();
  const inv = useQuery({
    queryKey: ['session', 'invitation', token, status === 'authenticated' ? me?.id : 'anonymous'],
    queryFn: () => authApi.invitation(token),
    enabled: status !== 'loading',
    retry: false,
  });
  const form = useForm<AcceptInvitationInput>({ resolver: zodResolver(AcceptInvitationSchema), defaultValues: { firstName: '', lastName: '', password: '' } });
  const [formError, setFormError] = useState<string | null>(null);
  const accept = useMutation({ mutationFn: () => authApi.acceptInvitation(token) });
  // a visitor signs up with the invited e-mail: the account joins the inviter's workspace and owns none (D30)
  const join = useMutation({ mutationFn: (b: AcceptInvitationInput) => authApi.register({ ...b, email: inv.data?.email ?? '', locale, invitationToken: token }) });

  const welcome = (readOnly: boolean) => {
    // plan at the member limit: the membership is created read-only (READ_ONLY_MEMBER)
    toast(readOnly ? { tone: 'warning', message: t('auth.invitation.acceptedReadOnly') } : t('auth.invitation.accepted'));
    router.replace('/home');
  };
  const onAccept = async () => {
    setFormError(null);
    try {
      const res = await accept.mutateAsync();
      await qc.invalidateQueries({ queryKey: meKey });
      switchWorkspace(res.workspaceId);
      welcome(res.readOnly);
    } catch (e) {
      onError(e);
    }
  };
  const [existing, setExisting] = useState(false);
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'MEMBER_ALREADY_EXISTS') {
      toast(t('auth.invitation.alreadyMember'));
      return router.replace('/home');
    }
    // the e-mail got an account meanwhile: sign in instead of signing up
    if (e instanceof ApiError && e.code === 'AUTH_EMAIL_TAKEN') return setExisting(true);
    setFormError(applyServerErrors(form, e, t, { fields: ['firstName', 'lastName', 'password'], codeToField: { AUTH_PASSWORD_WEAK: 'password' } }));
  };

  if (inv.isPending || status === 'loading') {
    return (
      <AuthCard title={t('auth.invitation.loading')}>
        <Spinner label={t('common.loading')} />
      </AuthCard>
    );
  }

  if (inv.isError) {
    const e = inv.error;
    if (e instanceof ApiError && e.code === 'INVITATION_EMAIL_MISMATCH') {
      const email = String(e.body.params.email ?? '');
      return (
        <AuthCard title={t('auth.invitation.mismatch.title')} description={t('auth.invitation.mismatch.description', { email, current: me?.email ?? '' })}>
          <Button variant="primary" className="w-full" onClick={() => void logout().then(() => inv.refetch())}>
            {t('userMenu.logout')}
          </Button>
        </AuthCard>
      );
    }
    if (e instanceof ApiError && e.code === 'MEMBER_ALREADY_EXISTS') {
      return (
        <AuthCard title={t('auth.invitation.alreadyMember')} footer={<AuthLink href="/home">{t('action.backHome')}</AuthLink>} />
      );
    }
    const expired = e instanceof ApiError && (e.code === 'INVITATION_EXPIRED' || e.status === 404 || e.status === 410);
    return (
      <AuthCard
        title={expired ? t('auth.invitation.expired.title') : t('state.list.error.title')}
        description={expired ? t('auth.invitation.expired.description') : errorMessage(e, t)}
        footer={<AuthLink href={status === 'authenticated' ? '/home' : '/login'}>{status === 'authenticated' ? t('action.backHome') : t('auth.backToLogin')}</AuthLink>}
      >
        {expired ? null : <Button onClick={() => inv.refetch()}>{t('action.retry')}</Button>}
      </AuthCard>
    );
  }

  const i = inv.data;
  const role = t(`enum.Membership.role.${i.role}`);
  const badge = { label: t('auth.invitation.badge', { role }), tone: 'violet' as const };
  const title = t('auth.invitation.title', { workspace: i.workspaceName });
  const description = t('auth.invitation.description', { inviter: i.inviterName, role, roleDescription: t(`auth.invitation.role.${i.role}`), days: daysLeft(i.expiresAt), date: formatDate(i.expiresAt, locale) });
  const busy = accept.isPending || join.isPending;

  if (status === 'authenticated' && me) {
    if (me.email.toLowerCase() !== i.email.toLowerCase()) {
      return (
        <AuthCard badge={badge} title={title} description={t('auth.invitation.mismatch.description', { email: i.email, current: me.email })}>
          <Button variant="primary" className="w-full" onClick={() => void logout().then(() => inv.refetch())}>
            {t('userMenu.logout')}
          </Button>
        </AuthCard>
      );
    }
    return (
      <AuthCard badge={badge} title={title} description={description} footer={<AuthLink href="/home">{t('action.later')}</AuthLink>}>
        <div className="flex flex-col gap-4">
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <Button variant="primary" className="w-full" loading={busy} onClick={onAccept}>
            {t('auth.invitation.accept')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  const loginHref = `/login?returnTo=${encodeURIComponent(`/invitations/${token}`)}`;
  // tester report 25/10: an owner of another shop invited as admin already has an account — no sign-up form for that e-mail
  if (i.accountExists || existing) {
    return (
      <AuthCard badge={badge} title={title} description={description}>
        <div className="flex flex-col gap-4" data-testid="invitation-existing">
          <FormAlert tone="info">{t('auth.invitation.existing', { email: i.email })}</FormAlert>
          <Button variant="primary" className="w-full" onClick={() => router.push(loginHref)}>
            {t('auth.invitation.loginWith', { email: i.email })}
          </Button>
        </div>
      </AuthCard>
    );
  }

  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const tokens = await join.mutateAsync(values);
      signIn(tokens);
      welcome(tokens.user.memberships.some((m) => m.readOnly));
    } catch (e) {
      onError(e);
    }
  });
  return (
    <AuthCard
      wide
      badge={badge}
      title={title}
      description={description}
      footer={
        <p>
          {t('auth.invitation.noWorkspace')}{' '}
          <AuthLink href={`/login?returnTo=${encodeURIComponent(`/invitations/${token}`)}`}>{t('auth.invitation.loginWith', { email: i.email })}</AuthLink>
        </p>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field label={t('auth.invitation.emailFixed')} htmlFor="email">
          <Input id="email" type="email" dir="ltr" value={i.email} readOnly disabled />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('auth.field.firstName')} htmlFor="firstName" required error={fieldError(t, errors.firstName?.message, { max: 80 })}>
            <Input id="firstName" autoComplete="given-name" disabled={busy} aria-invalid={!!errors.firstName} {...form.register('firstName')} />
          </Field>
          <Field label={t('auth.field.lastName')} htmlFor="lastName" required error={fieldError(t, errors.lastName?.message, { max: 80 })}>
            <Input id="lastName" autoComplete="family-name" disabled={busy} aria-invalid={!!errors.lastName} {...form.register('lastName')} />
          </Field>
        </div>
        <Field label={t('common.password')} htmlFor="password" required error={fieldError(t, errors.password?.message)} hint={t('validation.password')}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            disabled={busy}
            aria-invalid={!!errors.password}
            showLabel={t('auth.password.show')}
            hideLabel={t('auth.password.hide')}
            {...form.register('password')}
          />
        </Field>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {t('auth.invitation.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
