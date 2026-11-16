'use client';
// /login — Figma "AUTH — Login — default", "AUTH — Login — 2FA step", "AUTH — States catalogue" (Connexion, Double authentification).
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, type LoginInput } from '@djaber/shared';
import { Button, EmailInput, Field, FormAlert, Input, OtpInput, PasswordInput } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard, AuthLink, MetaLink } from '@/components/auth/auth-card';
import { authApi } from '@/features/auth/api';
import { ApiError } from '@/lib/api';
import { isMfaChallenge } from '@/lib/contracts';
import { formatClock, retryAfterSeconds, useCooldown, useCountdown } from '@/lib/countdown';
import { errorMessage, fieldError } from '@/lib/forms';
import { authHref } from '@/lib/guards';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const MFA_TTL_S = 5 * 60;

export default function LoginPage() {
  const [mfa, setMfa] = useState<{ token: string; expiresAt: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return mfa ? (
    <TwoFactorStep
      mfa={mfa}
      onBack={(message) => {
        setMfa(null);
        setNotice(message ?? null);
      }}
    />
  ) : (
    <CredentialsStep notice={notice} onMfa={(token) => setMfa({ token, expiresAt: Date.now() + MFA_TTL_S * 1000 })} />
  );
}

function CredentialsStep({ notice, onMfa }: { notice: string | null; onMfa: (token: string) => void }) {
  const t = useT();
  const { signIn, status } = useSession();
  const search = useSearchParams();
  const form = useForm<LoginInput>({ resolver: zodResolver(LoginSchema), defaultValues: { email: '', password: '' } });
  const [formError, setFormError] = useState<string | null>(null);
  const [lockedFor, lock] = useCooldown();
  const login = useMutation({ mutationFn: authApi.login });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await login.mutateAsync(values);
      if (isMfaChallenge(res)) onMfa(res.mfaToken);
      else signIn(res); // the (auth) guard then redirects to returnTo / Home (onboarding resume happens in the (app) layout)
    } catch (e) {
      const wait = retryAfterSeconds(e, 15 * 60);
      if (wait > 0) lock(wait);
      // AUTH_INVALID_CREDENTIALS is shown at form level, never per field (no account enumeration)
      else setFormError(errorMessage(e, t));
    }
  });

  const busy = login.isPending;
  const errors = form.formState.errors;
  const expired = status === 'expired' || search.get('reason') === 'expired';
  // "Créer un compte" keeps the destination (an invitation…), "Mot de passe oublié" the e-mail already typed
  const returnTo = search.get('returnTo');
  const typedEmail = form.watch('email');
  return (
    <AuthCard
      title={t('auth.login.title')}
      description={t('auth.login.description')}
      footer={
        <>
          <p>
            {t('auth.login.noAccount')} <AuthLink href={authHref('/signup', { returnTo })}>{t('auth.login.createAccount')}</AuthLink>
          </p>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        {expired && !formError && !notice ? <FormAlert tone="info">{t('auth.login.sessionExpired')}</FormAlert> : null}
        {notice ? <FormAlert tone="warning">{notice}</FormAlert> : null}
        <Field label={t('common.email')} htmlFor="email" error={fieldError(t, errors.email?.message)}>
          <EmailInput
            id="email"
            autoComplete="username"
            placeholder={t('auth.placeholder.email')}
            disabled={busy}
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label={t('common.password')} htmlFor="password" error={fieldError(t, errors.password?.message)}>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              disabled={busy}
              aria-invalid={!!errors.password}
              showLabel={t('auth.password.show')}
              hideLabel={t('auth.password.hide')}
              {...form.register('password')}
            />
          </Field>
          <MetaLink href={authHref('/forgot-password', { email: typedEmail })}>{t('auth.login.forgot')}</MetaLink>
        </div>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {lockedFor > 0 ? <FormAlert>{t('auth.login.rateLimited', { time: formatClock(lockedFor) })}</FormAlert> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={lockedFor > 0} className="w-full">
          {busy ? t('common.connecting') : t('action.login')}
        </Button>
      </form>
    </AuthCard>
  );
}

function TwoFactorStep({ mfa, onBack }: { mfa: { token: string; expiresAt: number }; onBack: (message?: string) => void }) {
  const t = useT();
  const { signIn } = useSession();
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, lock] = useCooldown();
  const left = useCountdown(mfa.expiresAt);
  const verify = useMutation({ mutationFn: authApi.verify2fa });
  const expired = left <= 0;

  const send = async (value: string) => {
    setError(null);
    try {
      signIn(await verify.mutateAsync(mode === 'code' ? { mfaToken: mfa.token, code: value } : { mfaToken: mfa.token, recoveryCode: value.trim() }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUTH_MFA_TOKEN_EXPIRED') return onBack(t('auth.twofa.expired'));
      const wait = retryAfterSeconds(e, 15 * 60);
      if (wait > 0) return lock(wait);
      // the API reports the remaining attempts when it knows them (`params.remaining`)
      const remaining = e instanceof ApiError && e.body.params.remaining !== undefined ? Number(e.body.params.remaining) : NaN;
      setError(e instanceof ApiError && e.code === 'AUTH_2FA_INVALID' && Number.isFinite(remaining) ? t('auth.twofa.invalidLeft', { count: remaining }) : errorMessage(e, t));
      setCode('');
    }
  };

  const busy = verify.isPending;
  const value = mode === 'code' ? code : recovery;
  const ready = mode === 'code' ? code.length === 6 : recovery.trim().length >= 6;
  return (
    <AuthCard
      title={t('auth.twofa.title')}
      description={mode === 'code' ? t('auth.twofa.description', { time: formatClock(left) }) : t('auth.twofa.recoveryDescription')}
      footer={
        <p>
          <button type="button" className="hover:text-text-primary hover:underline" onClick={() => (setError(null), setMode(mode === 'code' ? 'recovery' : 'code'))}>
            {mode === 'code' ? t('auth.twofa.useRecovery') : t('auth.twofa.useCode')}
          </button>
          {' · '}
          <button type="button" className="hover:text-text-primary hover:underline" onClick={() => onBack()}>
            {t('action.back')}
          </button>
        </p>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        aria-busy={busy}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !expired && lockedFor <= 0) void send(value);
        }}
      >
        {mode === 'code' ? (
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void send(v)} invalid={!!error} disabled={busy || expired} autoFocus label={t('auth.twofa.codeLabel')} />
        ) : (
          <Field label={t('auth.twofa.recoveryLabel')} htmlFor="recovery" hint={t('auth.twofa.recoveryHint')}>
            <Input id="recovery" dir="ltr" autoComplete="off" autoFocus value={recovery} onChange={(e) => setRecovery(e.target.value)} disabled={busy || expired} aria-invalid={!!error} />
          </Field>
        )}
        {error ? (
          <p role="alert" className="ts-label-meta text-accent-alert">
            {error}
          </p>
        ) : null}
        {expired ? <FormAlert>{t('auth.twofa.expired')}</FormAlert> : null}
        {lockedFor > 0 ? <FormAlert>{t('auth.twofa.blocked', { time: formatClock(lockedFor) })}</FormAlert> : null}
        {expired ? (
          <Button variant="primary" className="w-full" onClick={() => onBack()}>
            {t('auth.twofa.restart')}
          </Button>
        ) : (
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!ready || lockedFor > 0}>
            {busy ? t('common.verifying') : t('auth.twofa.verify')}
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
