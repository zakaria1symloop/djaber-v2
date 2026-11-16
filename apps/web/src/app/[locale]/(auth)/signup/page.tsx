'use client';
// /signup — Figma "AUTH — Sign up — field errors" (AUTH-01, FL-04).
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterSchema, type RegisterInput } from '@djaber/shared';
import { Button, EmailInput, Field, FormAlert, Input, PasswordInput } from '@djaber/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard, AuthLink } from '@/components/auth/auth-card';
import { authApi } from '@/features/auth/api';
import { billingApi } from '@/features/billing/api';
import { planIntentOf } from '@/features/public/logic';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { formatClock, retryAfterSeconds, useCooldown } from '@/lib/countdown';
import { applyServerErrors, fieldError } from '@/lib/forms';
import { authHref } from '@/lib/guards';
import { useLocaleCode, useT } from '@/lib/i18n';
import { savePlanIntent } from '@/lib/plan-intent';
import { useSession } from '@/lib/session';

const FIELDS = ['firstName', 'lastName', 'email', 'password'] as const;
/** Every sign-up starts with the Pro trial (D60). */
const TRIAL_PLAN = 'pro';

export default function SignupPage() {
  const t = useT();
  const locale = useLocaleCode();
  const { signIn } = useSession();
  const form = useForm<RegisterInput>({ resolver: zodResolver(RegisterSchema), defaultValues: { firstName: '', lastName: '', email: '', password: '' } });
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [lockedFor, lock] = useCooldown();
  const register = useMutation({ mutationFn: authApi.register });
  const search = useSearchParams();
  const returnTo = search.get('returnTo');
  // pricing CTA `/signup?plan=&cycle=`: the trial is always Pro (D60); the chosen plan is offered afterwards
  const asked = planIntentOf(search.get('plan'), search.get('cycle'));
  // full-test 15/11 PUBLIC-10: the note names the plan, and a slug that is no public plan carries nothing
  const plans = useQuery({ queryKey: ['public', 'plans', locale], queryFn: billingApi.plans, enabled: !!asked, staleTime: 300_000, retry: false });
  const plan = asked ? plans.data?.find((p) => p.slug === asked.plan) : undefined;
  const intent = asked && (plan || plans.isError) ? asked : null;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setEmailTaken(false);
    try {
      // the owned workspace starts at onboarding step 1: the (app) layout redirects to /onboarding/welcome
      const session = await register.mutateAsync({ ...values, locale });
      savePlanIntent(intent);
      signIn(session);
    } catch (e) {
      const wait = retryAfterSeconds(e);
      if (wait > 0) return lock(wait);
      if (e instanceof ApiError && e.code === 'AUTH_EMAIL_TAKEN') return setEmailTaken(true);
      setFormError(applyServerErrors(form, e, t, { fields: FIELDS, codeToField: { AUTH_PASSWORD_WEAK: 'password' } }));
    }
  });

  const busy = register.isPending;
  const errors = form.formState.errors;
  const password = form.watch('password');
  return (
    <AuthCard
      title={t('auth.signup.title')}
      description={t('auth.signup.description')}
      footer={
        <>
          <p>
            {t('auth.signup.legal.before')} <AuthLink href="/legal/terms">{t('auth.signup.legal.terms')}</AuthLink> {t('auth.signup.legal.and')}{' '}
            <AuthLink href="/legal/privacy">{t('auth.signup.legal.privacy')}</AuthLink>.
          </p>
          <p className="mt-4">
            {t('auth.signup.haveAccount')} <AuthLink href={authHref('/login', { returnTo })}>{t('action.login')}</AuthLink>
          </p>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        {intent ? (
          <FormAlert tone="info">
            <span data-testid="signup-plan-intent">
              {t(intent.plan === TRIAL_PLAN ? 'auth.signup.planIntent.trialPlan' : 'auth.signup.planIntent.named', { plan: plan?.name ?? intent.plan, cycle: t(`auth.signup.planIntent.${intent.cycle}`) })}
            </span>
          </FormAlert>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('auth.field.firstName')} htmlFor="firstName" required error={fieldError(t, errors.firstName?.message, { max: 80 })}>
            <Input id="firstName" autoComplete="given-name" disabled={busy} aria-invalid={!!errors.firstName} {...form.register('firstName')} />
          </Field>
          <Field label={t('auth.field.lastName')} htmlFor="lastName" required error={fieldError(t, errors.lastName?.message, { max: 80 })}>
            <Input id="lastName" autoComplete="family-name" disabled={busy} aria-invalid={!!errors.lastName} {...form.register('lastName')} />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <Field label={t('common.email')} htmlFor="email" required error={fieldError(t, errors.email?.message)}>
            <EmailInput
              id="email"
              placeholder={t('auth.placeholder.email')}
              disabled={busy}
              aria-invalid={!!errors.email || emailTaken}
              {...form.register('email', { onChange: () => setEmailTaken(false) })}
            />
          </Field>
          {emailTaken ? (
            <p role="alert" className="ts-label-meta text-accent-alert">
              {t('auth.signup.emailTaken')} —{' '}
              <Link href={authHref('/login', { returnTo })} className="underline underline-offset-2">
                {t('action.login')}
              </Link>
              {' · '}
              <Link href={authHref('/forgot-password', { email: form.getValues('email') })} className="underline underline-offset-2">
                {t('auth.login.forgot')}
              </Link>
            </p>
          ) : null}
        </div>
        <Field
          label={t('common.password')}
          htmlFor="password"
          required
          error={errors.password ? t('auth.signup.passwordRule', { count: password.length }) : undefined}
          hint={t('validation.password')}
        >
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
        {lockedFor > 0 ? <FormAlert>{t('auth.login.rateLimited', { time: formatClock(lockedFor) })}</FormAlert> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={lockedFor > 0} className="w-full">
          {busy ? t('auth.signup.submitting') : t('auth.signup.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
