'use client';
// /settings/workspace — Figma "SET — Settings — Profile · Workspace · Security" (Espace de travail) + the auto-pause /
// handoff-reminder line of "SET — … System messages", the free-delivery rule and the online payment toggle (03 §20,
// PAY-02 P2 — saved at once, like the stock mode).
import { zodResolver } from '@hookform/resolvers/zod';
import { normalizePhoneDz, WorkspaceProfileSchema, type WorkspaceProfileInput } from '@djaber/shared';
import { Avatar, Button, Field, FormAlert, Input, MoneyInput, NumberInput, PhoneInput, Select, Skeleton, Switch, toast } from '@djaber/ui';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ConflictDialog } from '@/components/global-states';
import { LOCALE_NAMES } from '@/components/shell/merchant-shell';
import { Section, SettingsPage, useImageUpload } from '@/features/settings/common';
import { conflictOf, useOnboardingStep, usePatchWorkspace, useWilayas, useWorkspaceCache, type WorkspacePatch } from '@/features/workspace/api';
import { useRouter } from '@/i18n/navigation';
import { ONBOARDING_SKIPPED, onboardingPath } from '@/lib/guards';
import { routing } from '@/i18n/routing';
import type { WorkspaceDto } from '@/lib/contracts';
import { applyServerErrors, errorMessage, fieldError, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { formatPhoneOnBlur, phonePreviewLine } from '@/lib/phone';

const toForm = (w: WorkspaceDto): WorkspaceProfileInput => ({
  name: w.name,
  phone: w.phone ?? '',
  address: w.address ?? '',
  senderWilayaId: w.senderWilayaId ? String(w.senderWilayaId) : '',
  locale: w.locale,
  autoPauseOnManualReply: w.autoPauseOnManualReply,
  handoffReminderMin: String(w.handoffReminderMin),
  freeDeliveryThreshold: w.freeDeliveryThreshold === null ? '' : String(w.freeDeliveryThreshold),
});
const toPatch = (v: WorkspaceProfileInput): WorkspacePatch => ({
  name: v.name,
  phone: v.phone ? normalizePhoneDz(v.phone) : null,
  address: v.address || null,
  senderWilayaId: v.senderWilayaId ? Number(v.senderWilayaId) : null,
  locale: v.locale,
  autoPauseOnManualReply: v.autoPauseOnManualReply,
  handoffReminderMin: Number(v.handoffReminderMin),
  freeDeliveryThreshold: v.freeDeliveryThreshold === '' ? null : Number(v.freeDeliveryThreshold),
});
const FIELDS = ['name', 'phone', 'address', 'senderWilayaId', 'locale', 'autoPauseOnManualReply', 'handoffReminderMin', 'freeDeliveryThreshold'] as const;

export default function WorkspaceSettingsPage() {
  const t = useT();
  return (
    <SettingsPage title={t('settings.workspace.title')} description={t('settings.workspace.description')} permission="workspace.settings">
      <WorkspaceForm />
      <ResumeSetup />
    </SettingsPage>
  );
}

/**
 * full-test 15/11 ONBOARDING-10: « Passer la configuration » is not final — the owner can reopen the guided setup here
 * (step 1: the resume rule then leads through the tunnel again; « Passer » stays available).
 */
function ResumeSetup() {
  const t = useT();
  const { workspace, role } = useSession();
  const step = useOnboardingStep();
  const router = useRouter();
  if (role !== 'owner' || workspace?.onboardingStep !== ONBOARDING_SKIPPED) return null;
  const resume = async () => {
    try {
      await step.mutateAsync(1);
      router.push(onboardingPath(1));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <Section title={t('settings.workspace.setup.title')} description={t('settings.workspace.setup.hint')}>
      <Button onClick={() => void resume()} loading={step.isPending} data-testid="resume-onboarding">
        {t('settings.workspace.setup.resume')}
      </Button>
    </Section>
  );
}

function WorkspaceForm() {
  const t = useT();
  const locale = useLocaleCode();
  const { workspace, can, refetchWorkspace } = useSession();
  const editable = can('workspace.settings');
  const readOnlyReason = editable ? undefined : t('error.READ_ONLY_MEMBER');
  const wilayas = useWilayas();
  const patch = usePatchWorkspace();
  const write = useWorkspaceCache();
  const form = useForm<WorkspaceProfileInput>({ resolver: zodResolver(WorkspaceProfileSchema), defaultValues: workspace ? toForm(workspace) : undefined });
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: WorkspaceDto | null; changedBy: string; changedAt: string | null } | null>(null);
  const { reset } = form;
  const version = workspace?.version;
  // a fresh server version re-seeds the form unless the user is editing (the draft is kept on conflict)
  useEffect(() => {
    if (workspace && !form.formState.isDirty) reset(toForm(workspace));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the version only
  }, [version, reset]);

  const logo = useImageUpload('logo', async (logoUploadId) => write(await patch.mutateAsync({ logoUploadId })));
  const { guard } = useLeaveGuard(form.formState.isDirty, workspace?.name ?? t('nav.settings.workspace'));

  const send = async (values: WorkspaceProfileInput, v: number | undefined) => {
    setFormError(null);
    try {
      const next = await patch.mutateAsync({ ...toPatch(values), version: v });
      reset(toForm(next));
      toast(t('toast.saved'));
    } catch (e) {
      const c = conflictOf<WorkspaceDto>(e);
      if (c) return setConflict(c);
      setFormError(applyServerErrors(form, e, t, { fields: FIELDS }));
    }
  };
  const submit = form.handleSubmit((values) => send(values, workspace?.version));

  if (!workspace) return <Skeleton className="h-96" />;
  const busy = patch.isPending;
  const locked = busy || !editable;
  const errors = form.formState.errors;
  return (
    <>
      <Section title={t('settings.workspace.identity')} description={t('settings.workspace.identityHint')}>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={workspace.name} src={workspace.logoUrl} size={64} square />
          {logo.input}
          <Button onClick={logo.open} loading={logo.uploading} disabledReason={readOnlyReason}>
            {logo.uploading ? t('settings.upload.uploading') : t('settings.workspace.changeLogo')}
          </Button>
          {workspace.logoUrl && editable ? (
            <Button variant="ghost" onClick={() => patch.mutate({ logoUploadId: null }, { onError: (e) => toast({ tone: 'danger', message: errorMessage(e, t) }) })} disabled={busy}>
              {t('action.remove')}
            </Button>
          ) : null}
          <span className="ts-label-meta text-text-muted">{t('settings.workspace.logoHint')}</span>
        </div>
        {logo.error ? <FormAlert className="mt-3">{logo.error}</FormAlert> : null}

        <form id="workspace-form" onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4" aria-busy={busy}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('settings.workspace.name')} htmlFor="name" required error={fieldError(t, errors.name?.message, { max: 80 })}>
              <Input id="name" disabled={locked} aria-invalid={!!errors.name} {...form.register('name')} />
            </Field>
            <Field label={t('common.phone')} htmlFor="phone" error={fieldError(t, errors.phone?.message)}>
              <PhoneInput id="phone" format={formatPhoneOnBlur} disabled={locked} aria-invalid={!!errors.phone} preview={phonePreviewLine(t, form.watch('phone'))} {...form.register('phone')} />
            </Field>
            <Field label={t('settings.workspace.locale')} htmlFor="ws-locale">
              <Select id="ws-locale" disabled={locked} {...form.register('locale')}>
                {routing.locales.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.address')} htmlFor="address" error={fieldError(t, errors.address?.message, { max: 500 })}>
              <Input id="address" disabled={locked} aria-invalid={!!errors.address} {...form.register('address')} />
            </Field>
            <Field label={t('settings.workspace.senderWilaya')} htmlFor="senderWilayaId" hint={t('settings.workspace.senderWilayaHint')} error={fieldError(t, errors.senderWilayaId?.message)}>
              {/* journey J12-7: a controlled select — registered (uncontrolled), it fell back to « Aucun » when the wilaya list
                  arrived after the form value (the option it pointed at was replaced), while the form still held 19 */}
              <Controller
                control={form.control}
                name="senderWilayaId"
                render={({ field }) => (
                  <Select id="senderWilayaId" disabled={locked || wilayas.isPending} ref={field.ref} name={field.name} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                    <option value="">{t('common.none')}</option>
                    {/* keeps the saved value selectable while the list loads */}
                    {!wilayas.data && field.value ? <option value={field.value}>{field.value}</option> : null}
                    {(wilayas.data ?? []).map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.code} · {locale === 'ar' ? w.nameAr : w.nameFr}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>
          </div>
        </form>
      </Section>

      <Section title={t('settings.workspace.inbox')}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Controller
              control={form.control}
              name="autoPauseOnManualReply"
              render={({ field }) => <Switch checked={!!field.value} onCheckedChange={field.onChange} label={t('settings.workspace.autoPause')} disabled={locked} />}
            />
            <span className="text-[13px]">{t('settings.workspace.autoPause')}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('settings.workspace.handoffReminder')}
              htmlFor="handoffReminderMin"
              hint={t('settings.workspace.handoffReminderHint')}
              error={fieldError(t, errors.handoffReminderMin?.message, { min: 0, max: 1440 })}
            >
              <Controller
                control={form.control}
                name="handoffReminderMin"
                render={({ field }) => (
                  <NumberInput id="handoffReminderMin" form="workspace-form" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} maxDigits={4} disabled={locked} aria-invalid={!!errors.handoffReminderMin} />
                )}
              />
            </Field>
            <Field
              label={t('settings.workspace.freeDelivery')}
              htmlFor="freeDeliveryThreshold"
              hint={t('settings.workspace.freeDeliveryHint')}
              error={errors.freeDeliveryThreshold ? t('settings.workspace.freeDeliveryInvalid') : undefined}
            >
              <Controller
                control={form.control}
                name="freeDeliveryThreshold"
                render={({ field }) => (
                  <MoneyInput id="freeDeliveryThreshold" form="workspace-form" ref={field.ref} value={field.value} onValueChange={field.onChange} onBlur={field.onBlur} disabled={locked} aria-invalid={!!errors.freeDeliveryThreshold} />
                )}
              />
            </Field>
          </div>
        </div>
      </Section>

      <OnlinePayment workspace={workspace} locked={locked} />

      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <div className="flex justify-end">
        <Button type="submit" form="workspace-form" variant="primary" loading={busy} disabled={!form.formState.isDirty} disabledReason={readOnlyReason}>
          {busy ? t('common.saving') : t('action.save')}
        </Button>
      </div>

      <ConflictDialog
        open={!!conflict}
        name={conflict?.changedBy || t('settings.workspace.conflictSomeone')}
        ago={relativeTime(conflict?.changedAt, locale)}
        onClose={() => setConflict(null)}
        onReload={() => {
          // "Recharger": take the server version, drop the draft
          if (conflict?.current) {
            write(conflict.current);
            reset(toForm(conflict.current));
          } else
            void refetchWorkspace().then((r) => {
              // the refetched version, not the defaults the form was created with
              const fresh = (r as { data?: WorkspaceDto } | undefined)?.data;
              if (fresh) reset(toForm(fresh));
            });
          setConflict(null);
        }}
        onOverwrite={() => {
          // "Écraser": resubmit the draft on top of the current version
          const current = conflict?.current;
          setConflict(null);
          if (current) write(current);
          void send(form.getValues(), current?.version);
        }}
      />
      {guard}
    </>
  );
}

/** "Paiement en ligne" (PAY-02): orders get "Lien de paiement" (Chargily checkout, 15 min) once it is on. */
function OnlinePayment({ workspace, locked }: { workspace: WorkspaceDto; locked: boolean }) {
  const t = useT();
  const patch = usePatchWorkspace();
  const write = useWorkspaceCache();
  const [error, setError] = useState<string | null>(null);
  const toggle = async (on: boolean) => {
    setError(null);
    try {
      write(await patch.mutateAsync({ onlinePaymentEnabled: on, version: workspace.version }));
      toast(on ? t('settings.workspace.onlinePayment.on') : t('settings.workspace.onlinePayment.off'));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  return (
    <Section title={t('settings.workspace.onlinePayment.title')} description={t('settings.workspace.onlinePayment.hint')}>
      <div className="flex items-center gap-3" data-testid="online-payment">
        <Switch checked={workspace.onlinePaymentEnabled} onCheckedChange={(v) => void toggle(v)} label={t('settings.workspace.onlinePayment.label')} disabled={locked || patch.isPending} />
        <span className="text-[13px]">{t('settings.workspace.onlinePayment.label')}</span>
      </div>
      {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
    </Section>
  );
}
