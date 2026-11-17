'use client';
// /settings/security — Figma "SET — Settings — Profile · Workspace · Security" (Sécurité) + DLG "Activer la double
// authentification" (3 steps), "Désactiver la 2FA / Régénérer les codes", "Changer le mot de passe", "Changer l'e-mail".
// + "SAFE — Trust & safety (merchant)": blocked customers and automatic rules (features/safety).
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, passwordStrength, type ChangePasswordInput } from '@djaber/shared';
import { Button, Card, Checkbox, ConfirmDialog, Dialog, Field, FormAlert, OtpInput, PasswordInput, Pill, SectionLabel, Skeleton, Spinner, StrengthBar, toast } from '@djaber/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ListLoading, QueryError } from '@/components/global-states';
import { authApi } from '@/features/auth/api';
import { SafetySections } from '@/features/safety/safety-sections';
import { ChangeEmailDialog } from '@/features/settings/account-dialogs';
import { Section, SettingsPage } from '@/features/settings/common';
import { describeUserAgent } from '@/features/settings/user-agent';
import { ApiError } from '@/lib/api';
import { applyServerErrors, errorMessage, fieldError } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';

export default function SecurityPage() {
  const t = useT();
  const { me } = useSession();
  const [emailOpen, setEmailOpen] = useState(false);
  return (
    <SettingsPage title={t('nav.settings.security')} description={t('settings.security.description')}>
      <Section title={t('dialog.changePassword.title')}>
        <PasswordForm />
      </Section>
      <Section title={t('dialog.changeEmail.title')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <bdi dir="ltr" className="text-[14px]">
              {me?.email}
            </bdi>
            <div className="mt-1">
              {me?.emailVerifiedAt ? <Pill tone="success">{t('settings.security.emailVerified')}</Pill> : <Pill tone="warning">{t('settings.security.emailUnverified')}</Pill>}
            </div>
          </div>
          <Button onClick={() => setEmailOpen(true)}>{t('action.edit')}</Button>
        </div>
      </Section>
      <TwoFactorSection />
      <SessionsSection />
      <SafetySections />
      <ChangeEmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
    </SettingsPage>
  );
}

/* ---------- Password ---------- */
function PasswordForm() {
  const t = useT();
  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(ChangePasswordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const [formError, setFormError] = useState<string | null>(null);
  const change = useMutation({ mutationFn: authApi.changePassword });
  const qc = useQueryClient();
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      form.reset();
      toast(t('settings.password.changed'));
      void qc.invalidateQueries({ queryKey: ['session', 'sessions'] });
    } catch (e) {
      setFormError(
        applyServerErrors(form, e, t, {
          fields: ['currentPassword', 'newPassword'],
          codeToField: { AUTH_CURRENT_PASSWORD_INCORRECT: 'currentPassword', AUTH_INVALID_CREDENTIALS: 'currentPassword', AUTH_PASSWORD_WEAK: 'newPassword' },
        }),
      );
    }
  });
  const busy = change.isPending;
  const errors = form.formState.errors;
  const labels = { showLabel: t('auth.password.show'), hideLabel: t('auth.password.hide') };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('settings.password.current')} htmlFor="currentPassword" error={fieldError(t, errors.currentPassword?.message)}>
          <PasswordInput id="currentPassword" autoComplete="current-password" disabled={busy} aria-invalid={!!errors.currentPassword} {...labels} {...form.register('currentPassword')} />
        </Field>
        <div className="flex flex-col gap-2">
          <Field label={t('settings.password.new')} htmlFor="newPassword" error={fieldError(t, errors.newPassword?.message)}>
            <PasswordInput id="newPassword" autoComplete="new-password" disabled={busy} aria-invalid={!!errors.newPassword} {...labels} {...form.register('newPassword')} />
          </Field>
          <StrengthBar score={passwordStrength(form.watch('newPassword'))} label={t('auth.password.strength')} />
        </div>
        <Field label={t('auth.reset.confirm')} htmlFor="confirm" error={fieldError(t, errors.confirm?.message)}>
          <PasswordInput id="confirm" autoComplete="new-password" disabled={busy} aria-invalid={!!errors.confirm} {...labels} {...form.register('confirm')} />
        </Field>
      </div>
      <p className="ts-label-meta text-text-muted">{t('settings.password.hint')}</p>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          {t('settings.password.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ---------- 2FA ---------- */
function TwoFactorSection() {
  const t = useT();
  const { me } = useSession();
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'regenerate' | null>(null);
  const required = !!me && me.platformRole !== 'none';
  return (
    <Section>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-medium">{t('settings.twofa.title')}</h2>
            {me?.totpEnabled ? <Pill tone="success">{t('settings.twofa.enabled')}</Pill> : <Pill>{t('settings.twofa.disabled')}</Pill>}
          </div>
          <p className="ts-label-meta mt-1 text-text-muted">{t(required ? 'settings.twofa.hintRequired' : 'settings.twofa.hint')}</p>
        </div>
        {me?.totpEnabled ? (
          <>
            <Button onClick={() => setDialog('regenerate')}>{t('settings.twofa.regenerate')}</Button>
            <Button className="border-accent-alert/60 text-accent-alert" onClick={() => setDialog('disable')} disabledReason={required ? t('error.TWO_FA_REQUIRED_FOR_ROLE') : undefined}>
              {t('action.disable')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setDialog('enable')}>
            {t('settings.twofa.enable')}
          </Button>
        )}
      </div>
      <Enable2faDialog open={dialog === 'enable'} onClose={() => setDialog(null)} />
      <PasswordConfirm2faDialog mode={dialog === 'disable' || dialog === 'regenerate' ? dialog : null} onClose={() => setDialog(null)} />
    </Section>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  const download = () => {
    const url = URL.createObjectURL(new Blob([codes.join('\n') + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'djaber-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="ts-label-micro text-text-muted">{t('settings.twofa.recoveryTitle', { count: codes.length })}</div>
      <ul dir="ltr" className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c} className="ts-label-meta rounded-[4px] border border-line-edge bg-ink-raised px-2 py-1.5 text-center text-text-primary">
            {c}
          </li>
        ))}
      </ul>
      <div>
        <Button variant="ghost" size="sm" onClick={download}>
          {t('settings.twofa.download')}
        </Button>
      </div>
    </div>
  );
}

/** Étape 1 QR / clé → étape 2 code → étape 3 codes de récupération (download + checkbox). */
function Enable2faDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [kept, setKept] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  // every opening asks for a fresh secret (the previous unconfirmed one is replaced on the server)
  const setup = useMutation({ mutationFn: authApi.setup2fa });
  const { mutate: startSetup, reset: resetSetup } = setup;
  const enable = useMutation({ mutationFn: authApi.enable2fa });

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      setCodes(null);
      setKept(false);
      resetSetup();
      startSetup();
    }
  }, [open, resetSetup, startSetup]);
  const url = setup.data?.otpauthUrl;
  useEffect(() => {
    let alive = true;
    setQr(null);
    if (url) void QRCode.toDataURL(url, { margin: 1, width: 240 }).then((d) => alive && setQr(d));
    return () => {
      alive = false;
    };
  }, [url]);

  const confirm = async (value: string) => {
    setError(null);
    try {
      const res = await enable.mutateAsync(value);
      setCodes(res.recoveryCodes);
      void qc.invalidateQueries({ queryKey: meKey });
    } catch (e) {
      setError(errorMessage(e, t));
      setCode('');
    }
  };
  const finish = () => {
    void qc.invalidateQueries({ queryKey: meKey });
    onClose();
  };
  const step = codes ? 3 : 1;
  return (
    <Dialog
      open={open}
      // the recovery codes are shown once: closing needs the confirmation checkbox
      onOpenChange={(o) => !o && (!codes || kept) && finish()}
      hideClose={!!codes && !kept}
      title={t('dialog.enable2fa.title')}
      description={t('settings.twofa.step', { step, total: 3 })}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        codes ? (
          <Button variant="primary" onClick={finish} disabled={!kept}>
            {t('settings.twofa.finish')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={enable.isPending}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void confirm(code)} loading={enable.isPending} disabled={code.length !== 6}>
              {t('settings.twofa.activate')}
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <div className="flex flex-col gap-4">
          <FormAlert tone="success">{t('settings.twofa.activated')}</FormAlert>
          <RecoveryCodes codes={codes} />
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <Checkbox checked={kept} onChange={(e) => setKept(e.target.checked)} />
            {t('settings.twofa.kept')}
          </label>
        </div>
      ) : setup.isError ? (
        <QueryError error={setup.error} onRetry={() => startSetup()} />
      ) : !setup.data ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex size-[136px] items-center justify-center rounded-card bg-white p-2">
            {qr ? (
              // a data: URL generated in the browser from the otpauth URL (the secret never leaves the page)
              <img src={qr} alt={t('settings.twofa.qrAlt')} className="size-full" />
            ) : (
              <Skeleton className="size-full" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="ts-label-meta text-text-muted">{t('settings.twofa.scan')}</p>
            <bdi dir="ltr" className="ts-label-meta select-all break-all text-text-primary" data-testid="totp-secret">
              {setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}
            </bdi>
            <div className="ts-label-meta mt-1 uppercase text-text-secondary">{t('auth.twofa.codeLabel')}</div>
            <OtpInput value={code} onChange={setCode} onComplete={(v) => void confirm(v)} invalid={!!error} disabled={enable.isPending} label={t('auth.twofa.codeLabel')} />
            {error ? (
              <p role="alert" className="ts-label-meta text-accent-alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** "Désactiver la 2FA / Régénérer les codes": password required (AUTH_CURRENT_PASSWORD_INCORRECT inline). */
function PasswordConfirm2faDialog({ mode, onClose }: { mode: 'disable' | 'regenerate' | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field: boolean; message: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const disable = useMutation({ mutationFn: authApi.disable2fa });
  const regenerate = useMutation({ mutationFn: authApi.regenerateRecoveryCodes });
  const open = mode !== null;
  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
      setCodes(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'disable') {
        await disable.mutateAsync(password);
        await qc.invalidateQueries({ queryKey: meKey });
        toast(t('settings.twofa.disabledToast'));
        onClose();
      } else {
        setCodes((await regenerate.mutateAsync(password)).recoveryCodes);
      }
    } catch (e) {
      const field = e instanceof ApiError && (e.code === 'AUTH_CURRENT_PASSWORD_INCORRECT' || e.code === 'AUTH_INVALID_CREDENTIALS');
      setError({ field, message: errorMessage(e, t) });
    }
  };
  const busy = disable.isPending || regenerate.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.disable2fa.title')}
      description={t('settings.twofa.passwordRequired')}
      closeLabel={t('action.close')}
      size={codes ? 'lg' : 'md'}
      footer={
        codes ? (
          <Button variant="primary" onClick={onClose}>
            {t('action.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant={mode === 'disable' ? 'danger' : 'primary'} type="submit" form="twofa-password" loading={busy} disabled={!password}>
              {mode === 'disable' ? t('action.disable') : t('action.regenerate')}
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} />
      ) : (
        <form
          id="twofa-password"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void submit();
          }}
        >
          <Field label={t('common.password')} htmlFor="twofa-pw" error={error?.field ? error.message : undefined}>
            <PasswordInput
              id="twofa-pw"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={!!error?.field}
              showLabel={t('auth.password.show')}
              hideLabel={t('auth.password.hide')}
            />
          </Field>
          <p className="ts-label-meta text-text-muted">{t(mode === 'disable' ? 'settings.twofa.disableNote' : 'settings.twofa.regenerateNote')}</p>
          {error && !error.field ? <FormAlert>{error.message}</FormAlert> : null}
        </form>
      )}
    </Dialog>
  );
}

/* ---------- Sessions ---------- */
const SESSIONS_SHOWN = 5;
function SessionsSection() {
  const t = useT();
  const locale = useLocaleCode();
  const qc = useQueryClient();
  const key = ['session', 'sessions'] as const;
  const sessions = useQuery({ queryKey: key, queryFn: authApi.sessions });
  const revoke = useMutation({ mutationFn: authApi.revokeSession });
  const [all, setAll] = useState(false);

  const onRevoke = async (id: string) => {
    try {
      await revoke.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: key });
      toast(t('settings.sessions.revoked'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const others = (sessions.data ?? []).filter((s) => !s.current);
  // full-test 15/11 SETTINGS-08: this device first, then the most recent ones; the first SESSIONS_SHOWN rows, « Voir tout »
  // for the rest (177 rows pushed the safety sections thousands of px down); one device is signed out after a confirm
  const [showAll, setShowAll] = useState(false);
  const [confirmOne, setConfirmOne] = useState<string | null>(null);
  const ordered = [...(sessions.data ?? []).filter((s) => s.current), ...others];
  const shown = showAll ? ordered : ordered.slice(0, SESSIONS_SHOWN);
  const oneLabel = (() => {
    const s = ordered.find((x) => x.id === confirmOne);
    return s ? describeUserAgent(s.userAgent) ?? t('settings.sessions.unknownDevice') : '';
  })();
  // signs out every other device at once: confirmed first
  const [confirmAll, setConfirmAll] = useState(false);
  const revokeOthers = async () => {
    setConfirmAll(false);
    setAll(true);
    try {
      // every other device, one by one: the current session stays signed in
      for (const s of others) await authApi.revokeSession(s.id);
      toast(t('settings.sessions.allRevoked'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setAll(false);
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  return (
    <Section>
      <SectionLabel>{t('settings.sessions.title')}</SectionLabel>
      <div className="mt-3">
        {sessions.isPending ? (
          <Card>
            <ListLoading rows={2} columns={3} />
          </Card>
        ) : sessions.isError ? (
          <QueryError error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : (
          <Card>
            <ul className="divide-y divide-line-hairline" data-testid="sessions">
              {shown.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-current={s.current}>
                  <div className="min-w-0 flex-1">
                    {/* journey J12-9 (same family): a Latin device name is cut at its end in Arabic too */}
                    <div dir="auto" className="truncate text-[13px] rtl:text-right">
                      {describeUserAgent(s.userAgent) ?? t('settings.sessions.unknownDevice')}
                    </div>
                    {s.ip ? (
                      <bdi dir="ltr" className="ts-label-meta text-text-muted">
                        {s.ip}
                      </bdi>
                    ) : null}
                  </div>
                  <span className="ts-label-meta uppercase text-text-muted">{s.current ? t('settings.sessions.now') : relativeTime(s.lastUsedAt ?? s.createdAt, locale)}</span>
                  {s.current ? (
                    <Pill tone="success">{t('settings.sessions.current')}</Pill>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmOne(s.id)} disabled={revoke.isPending || all}>
                      {t('action.disconnect')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {ordered.length > SESSIONS_SHOWN ? (
              <div className="border-t border-line-hairline px-3 py-2">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} data-testid="sessions-toggle">
                  {showAll ? t('settings.sessions.showLess') : t('settings.sessions.showAll', { count: ordered.length })}
                </Button>
              </div>
            ) : null}
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={confirmOne !== null}
        onOpenChange={(o) => !o && setConfirmOne(null)}
        title={t('settings.sessions.revokeConfirm.title')}
        description={t('settings.sessions.revokeConfirm.description', { device: oneLabel })}
        confirmLabel={t('action.disconnect')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        onConfirm={() => {
          const id = confirmOne;
          setConfirmOne(null);
          if (id) void onRevoke(id);
        }}
      />
      {others.length > 0 ? (
        <Button className="mt-3 border-accent-alert/60 text-accent-alert" onClick={() => setConfirmAll(true)} loading={all}>
          {t('settings.sessions.revokeOthers')}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('settings.sessions.revokeOthersConfirm.title', { count: others.length })}
        description={t('settings.sessions.revokeOthersConfirm.description')}
        confirmLabel={t('settings.sessions.revokeOthers')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        onConfirm={() => void revokeOthers()}
      />
    </Section>
  );
}
