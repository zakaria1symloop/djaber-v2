'use client';
// DLG "Webhook sortant" (Intégrations › Webhooks): URL (HTTPS in production, WEBHOOK_URL_INVALID inline), events,
// signing secret (shown once after creation; on an existing endpoint only its hint + Régénérer), Tester, Enregistrer.
// Errors stay inline, content preserved.
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateWebhookSchema, type WebhookCreatedDto, type WebhookEndpointDto, type WebhookEvent } from '@djaber/shared';
import { Button, CheckChip, Dialog, Field, FormAlert, Input, UrlInput } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { actionState } from '@/lib/actions';
import { applyServerErrors, fieldError, useLeaveGuard } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { integrationsApi } from './api';

type FormValues = { url: string; events: WebhookEvent[] };

export function WebhookDialog({
  target,
  events,
  onClose,
  onSaved,
  onRotate,
  onTest,
}: {
  target: WebhookEndpointDto | 'new' | null;
  events: readonly WebhookEvent[];
  onClose: () => void;
  /** `created` = the new endpoint with its secret (shown once by the caller) */
  onSaved: (created: WebhookCreatedDto | null) => void;
  onRotate: (e: WebhookEndpointDto) => void;
  onTest: (e: WebhookEndpointDto) => void;
}) {
  const t = useT();
  const initial = target && target !== 'new' ? target : null;
  const open = target !== null;
  const form = useForm<FormValues>({ resolver: zodResolver(CreateWebhookSchema) as never, defaultValues: { url: '', events: [] } });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (v: FormValues): Promise<WebhookCreatedDto | null> => {
      if (initial) {
        await integrationsApi.updateWebhook(initial.id, v);
        return null;
      }
      return integrationsApi.createWebhook(v);
    },
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset(initial ? { url: initial.url, events: [...initial.events] } : { url: '', events: [] });
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seeded when the dialog opens on another endpoint
  }, [open, initial?.id, reset]);
  const { guard } = useLeaveGuard(open && form.formState.isDirty, initial?.url ?? t('dialog.webhook.title'));

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      onSaved(await save.mutateAsync(v));
    } catch (e) {
      setFormError(applyServerErrors(form, e, t, { fields: ['url', 'events'], codeToField: { WEBHOOK_URL_INVALID: 'url', WEBHOOK_URL_PRIVATE: 'url' } }));
    }
  });
  const busy = save.isPending;
  const errors = form.formState.errors;
  const test = initial ? actionState(initial.actions, 'test', t) : null;
  const rotate = initial ? actionState(initial.actions, 'rotate_secret', t) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('dialog.webhook.title')}
      description={t('settings.integrations.webhooks.dialog.context')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          {initial && test?.present ? (
            <Button onClick={() => onTest(initial)} disabled={busy || form.formState.isDirty} disabledReason={test.reason ?? (form.formState.isDirty ? t('settings.integrations.webhooks.dialog.saveFirst') : undefined)} data-testid="webhook-test">
              {t('action.test')}
            </Button>
          ) : null}
          <Button variant="primary" type="submit" form="webhook-form" loading={busy} data-testid="webhook-submit">
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy} data-testid="webhook-dialog">
        <Field
          label={t('settings.integrations.webhooks.dialog.url')}
          htmlFor="webhook-url"
          required
          error={fieldError(t, errors.url?.message, { max: '2 048' })}
          hint={t('settings.integrations.webhooks.dialog.urlHint')}
        >
          <UrlInput id="webhook-url" autoComplete="off" placeholder="https://erp.example.dz/hooks/djaber" disabled={busy} aria-invalid={!!errors.url} data-testid="webhook-url" {...form.register('url')} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="ts-label-meta mb-1.5 uppercase text-text-secondary">
            {t('settings.integrations.webhooks.dialog.events')}
            <span className="text-accent-alert"> *</span>
          </legend>
          <Controller
            control={form.control}
            name="events"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2" data-testid="webhook-events">
                {events.map((ev) => (
                  <CheckChip key={ev} name={ev} checked={field.value.includes(ev)} disabled={busy} onChange={(on) => field.onChange(events.filter((x) => (x === ev ? on : field.value.includes(x))))}>
                    <span dir="ltr" className="font-mono text-[12px]">
                      {ev}
                    </span>
                  </CheckChip>
                ))}
              </div>
            )}
          />
          {errors.events ? (
            <p role="alert" className="text-[12px] text-accent-alert">
              {t('settings.integrations.webhooks.dialog.eventsRequired')}
            </p>
          ) : null}
        </fieldset>
        <Field label={t('settings.integrations.webhooks.dialog.secret')} htmlFor="webhook-secret-hint">
          <div className="flex flex-wrap items-center gap-2">
            <Input id="webhook-secret-hint" dir="ltr" readOnly value={initial ? t('settings.integrations.webhooks.dialog.secretHint', { hint: initial.secretHint }) : t('settings.integrations.webhooks.dialog.secretNew')} className="min-w-0 flex-1 basis-56 text-text-secondary" />
            {initial && rotate?.present ? (
              <Button size="sm" onClick={() => onRotate(initial)} disabledReason={rotate.reason} disabled={busy} data-testid="webhook-rotate">
                {t('settings.integrations.webhooks.action.rotate')}
              </Button>
            ) : null}
          </div>
        </Field>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
      </form>
      {guard}
    </Dialog>
  );
}
