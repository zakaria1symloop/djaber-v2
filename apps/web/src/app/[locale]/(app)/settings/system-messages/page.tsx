'use client';
// /settings/system-messages — Figma "SET — Settings — … System messages" + DLG "Message système — réinitialiser" (AT-SET-01, 11 §9):
// 4 editable keys × 3 locales, preview, reset to default, and the 3 fixed platform texts shown read-only.
import { getMessages, SYSTEM_MESSAGE_KEYS, type AppLocale, type SystemMessageKey } from '@djaber/shared';
import { Button, Card, ConfirmDialog, FormAlert, SegmentedControl, Skeleton, Textarea, toast } from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { QueryError } from '@/components/global-states';
import { LOCALE_NAMES } from '@/components/shell/merchant-shell';
import { Section, SettingsPage } from '@/features/settings/common';
import { systemMessagesKey, useSystemMessages, workspaceApi } from '@/features/workspace/api';
import { routing } from '@/i18n/routing';
import type { SystemMessages } from '@/lib/contracts';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession, useWorkspaceId } from '@/lib/session';

const MAX = 1000;
const FIXED = ['unavailable', 'unsupportedMedia', 'voiceFailed'] as const;

/** Preview of what the customer receives: `{shop}` and `{product}` replaced by sample values. */
export default function SystemMessagesPage() {
  const t = useT();
  const uiLocale = useLocaleCode() as AppLocale;
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { can, workspace } = useSession();
  const canEdit = can('workspace.settings');
  const query = useSystemMessages();
  const [locale, setLocale] = useState<AppLocale>(uiLocale);
  const [draft, setDraft] = useState<SystemMessages | null>(null);
  /** the version the draft started from: dirty = draft ≠ base (not ≠ the live server value) */
  const [base, setBase] = useState<SystemMessages | null>(null);
  const [resetKey, setResetKey] = useState<SystemMessageKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: workspaceApi.saveSystemMessages });
  const reset = useMutation({ mutationFn: workspaceApi.resetSystemMessage });

  const server = query.data;
  // a fresh server version (first load, someone else saved) is taken while the draft is untouched only
  const clean = !draft || !base || JSON.stringify(draft) === JSON.stringify(base);
  useEffect(() => {
    if (!server || !clean) return;
    setDraft(structuredClone(server));
    setBase(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the server value
  }, [server]);

  const dirty = useMemo(() => !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);
  const { guard } = useLeaveGuard(dirty, t('nav.settings.systemMessages'));
  const tooLong = !!draft && SYSTEM_MESSAGE_KEYS.some((k) => routing.locales.some((l) => (draft[k][l] ?? '').length > MAX));

  // full-test 15/11 SETTINGS-13: the sample product is in the tab's language (« عذرًا، La Robe satin … » in the Arabic tab)
  const preview = (text: string, lang: AppLocale = locale) =>
    text.replaceAll('{shop}', workspace?.name ?? '').replaceAll('{product}', getMessages(lang)['settings.systemMessages.sampleProduct'] ?? t('settings.systemMessages.sampleProduct'));
  const onSave = async () => {
    if (!draft) return;
    setError(null);
    try {
      const next = await save.mutateAsync(draft);
      qc.setQueryData(systemMessagesKey(ws), next);
      setDraft(structuredClone(next));
      setBase(next);
      toast(t('toast.saved'));
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };
  const onReset = async () => {
    if (!resetKey) return;
    setResetError(null);
    try {
      const next = await reset.mutateAsync(resetKey);
      qc.setQueryData(systemMessagesKey(ws), next);
      // only the reset key is replaced: unsaved edits of the other keys stay in the draft
      setDraft((d) => (d ? { ...d, [resetKey]: { ...next[resetKey] } } : structuredClone(next)));
      setBase((b) => (b ? { ...b, [resetKey]: { ...next[resetKey] } } : next));
      setResetKey(null);
      toast(t('settings.systemMessages.resetDone'));
    } catch (e) {
      setResetError(errorMessage(e, t));
    }
  };

  return (
    <SettingsPage title={t('settings.systemMessages.title')} permission="workspace.settings">
      <Section description={t('settings.systemMessages.description')}>
        <SegmentedControl
          label={t('settings.systemMessages.locale')}
          value={locale}
          onChange={setLocale}
          options={routing.locales.map((l) => ({ value: l, label: LOCALE_NAMES[l], dir: l === 'ar' ? ('rtl' as const) : ('ltr' as const) }))}
        />
        <div className="mt-4 flex flex-col gap-3">
          {query.isPending || (!draft && !query.isError) ? (
            SYSTEM_MESSAGE_KEYS.map((k) => <Skeleton key={k} className="h-28" />)
          ) : query.isError || !draft ? (
            <QueryError error={query.error} onRetry={() => query.refetch()} />
          ) : (
            SYSTEM_MESSAGE_KEYS.map((k) => {
              const value = draft[k][locale] ?? '';
              return (
                <Card key={k} className="bg-ink-raised p-3.5" data-message={k}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor={`sm-${k}`} className="ts-label-meta uppercase text-text-primary">
                      {t(`settings.systemMessages.${k}.label`)}
                    </label>
                    <span className="ts-label-micro me-auto text-text-muted">{t(`settings.systemMessages.${k}.when`)}</span>
                    {canEdit ? (
                      <Button variant="ghost" size="sm" onClick={() => (setResetError(null), setResetKey(k))}>
                        {t('settings.systemMessages.reset')}
                      </Button>
                    ) : null}
                  </div>
                  <Textarea
                    id={`sm-${k}`}
                    className="mt-2 !min-h-16"
                    dir={locale === 'ar' ? 'rtl' : 'ltr'}
                    lang={locale}
                    value={value}
                    maxLength={MAX}
                    disabled={!canEdit || save.isPending}
                    aria-invalid={value.length > MAX}
                    placeholder={k === 'welcome' ? t('settings.systemMessages.welcomeEmpty') : undefined}
                    onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], [locale]: e.target.value } })}
                  />
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <span className="ts-label-micro mt-1 text-text-muted">{t('settings.systemMessages.preview')}</span>
                    {value ? (
                      <span dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} className="max-w-full rounded-card border border-line-edge bg-ink-surface px-2.5 py-1.5 text-[13px]" data-preview={k}>
                        {preview(value)}
                      </span>
                    ) : (
                      <span className="ts-label-meta mt-0.5 text-text-muted">{k === 'welcome' ? t('settings.systemMessages.welcomeEmpty') : t('settings.systemMessages.emptyFallback')}</span>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
        {error ? <FormAlert className="mt-3">{error}</FormAlert> : null}
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty || tooLong}>
              {save.isPending ? t('common.saving') : t('action.save')}
            </Button>
          </div>
        ) : (
          <p className="ts-label-meta mt-3 text-text-muted">{t('error.READ_ONLY_MEMBER')}</p>
        )}
      </Section>

      <Section title={t('settings.systemMessages.fixed.title')} description={t('settings.systemMessages.fixed.description')}>
        <div className="flex flex-col gap-3">
          {FIXED.map((k) => (
            <Card key={k} className="bg-ink-raised p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="ts-label-meta uppercase text-text-secondary">{t(`settings.systemMessages.fixed.${k}`)}</span>
                <span className="ts-label-micro text-text-muted">{t('settings.systemMessages.fixed.note')}</span>
              </div>
              <p dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale} className="mt-2 rounded-card border border-line-hairline bg-ink-surface px-2.5 py-2 text-[13px] text-text-secondary">
                {getMessages(locale)[`customer.${k}`]}
              </p>
            </Card>
          ))}
        </div>
      </Section>

      <ConfirmDialog
        open={!!resetKey}
        onOpenChange={(o) => !o && setResetKey(null)}
        title={t('dialog.resetSystemMessage.title')}
        description={resetKey ? t('settings.systemMessages.resetContext', { name: t(`settings.systemMessages.${resetKey}.label`) }) : undefined}
        confirmLabel={t('settings.systemMessages.reset')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        loading={reset.isPending}
        onConfirm={onReset}
      >
        {resetKey ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-card border border-line-edge bg-ink-raised px-2.5 py-2 text-[13px]" dir={uiLocale === 'ar' ? 'rtl' : 'ltr'}>
              {preview(getMessages(uiLocale)[`customer.${resetKey}`] ?? '', uiLocale)}
            </p>
            <p className="ts-label-meta text-text-muted">{t('settings.systemMessages.resetNote')}</p>
            {resetError ? <FormAlert>{resetError}</FormAlert> : null}
          </div>
        ) : null}
      </ConfirmDialog>
      {guard}
    </SettingsPage>
  );
}
