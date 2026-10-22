'use client';
// Dialogs of ADM-13 "Paramètres plateforme" (D39, D58, PFS-01…07): app version + force update with 2FA (AT-PFS-02),
// feature flag create / edit / evaluate, maintenance window, incident banner, Meta permission status, Meta app id /
// secret, technical provider configuration, settings history. Built on the "DLG — Platform admin" pattern: title,
// mono sub-line, inline server errors, form kept on error.
import {
  formatDateTime,
  StoreStatusValues,
  type AppVersionDto,
  type FeatureFlagDto,
  type FeatureFlagEvaluationDto,
  type MaintenanceDto,
  type IncidentBannerDto,
  type MetaPermissionDto,
  type OpsLocalizedText,
  type PlatformProviderDto,
  type PlatformSettingVersionDto,
  type SettingKey,
} from '@djaber/shared';
import { Checkbox, Dialog, Field, FormAlert, Input, Ltr, NumberInput, Select, Switch, Textarea, toast, UrlInput } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DialogFooter, RadioList, useDialogSubmit, useOnOpen } from '@/features/orders/dialogs/common';
import { useLocaleCode, useT } from '@/lib/i18n';
import { opsApi, opsKeys } from './api';
import { cleanLocalized, EMPTY_LOCALIZED, LocalizedFields, userName } from './common';
import { isForceUpdate, minAboveUnpublished } from './logic';

const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: opsKeys.settings });

/* ---------- App version (force update = 2FA code + impact) ---------- */
export function AppVersionDialog({ version, onClose }: { version: AppVersionDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [minVersion, setMin] = useState('');
  const [recommendedVersion, setRec] = useState('');
  const [latestVersion, setLatest] = useState('');
  const [latestBuild, setBuild] = useState('');
  const [storeStatus, setStore] = useState<AppVersionDto['storeStatus']>('published');
  const [rolloutPct, setRollout] = useState('');
  const [storeUrl, setUrl] = useState('');
  const [message, setMessage] = useState<OpsLocalizedText>(EMPTY_LOCALIZED);
  const [totpCode, setCode] = useState('');
  const [reason, setReason] = useState('');
  useOnOpen(!!version, () => {
    if (!version) return;
    setMin(version.minVersion);
    setRec(version.recommendedVersion);
    setLatest(version.latestVersion);
    setBuild(version.latestBuild === null ? '' : String(version.latestBuild));
    setStore(version.storeStatus);
    setRollout(version.rolloutPct === null ? '' : String(version.rolloutPct));
    setUrl(version.storeUrl);
    setMessage({ fr: version.updateMessage.fr, ar: version.updateMessage.ar ?? '', en: version.updateMessage.en ?? '' });
    setCode('');
    setReason('');
    s.setError(null);
  });
  const force = !!version && isForceUpdate(version, minVersion.trim());
  const blocked = !!version && force && minAboveUnpublished({ ...version, storeStatus, latestVersion: latestVersion.trim() || version.latestVersion }, minVersion.trim());
  const s = useDialogSubmit(() =>
    opsApi.putAppVersion(version!.platform, {
      minVersion: minVersion.trim(),
      recommendedVersion: recommendedVersion.trim(),
      latestVersion: latestVersion.trim(),
      latestBuild: latestBuild === '' ? null : Number(latestBuild),
      storeStatus,
      rolloutPct: rolloutPct === '' ? null : Number(rolloutPct),
      storeUrl: storeUrl.trim(),
      updateMessage: cleanLocalized(message),
      ...(force && totpCode ? { totpCode } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
  );
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t(force ? 'adminSettings.app.forced' : 'adminSettings.saved') });
      await refresh(qc);
      onClose();
    }
  };
  if (!version) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.app.dialog.title', { platform: t(`adminSettings.platform.${version.platform}`) })}
      description={t('adminSettings.app.dialog.sub')}
      closeLabel={t('action.close')}
      size="lg"
      footer={
        <DialogFooter
          onClose={onClose}
          busy={s.busy}
          onSubmit={() => void submit()}
          label={force ? t('adminSettings.app.force.submit') : t('action.save')}
          danger={force}
          disabledReason={blocked ? t('adminSettings.app.force.blocked', { latest: latestVersion || version.latestVersion }) : force && totpCode.length !== 6 ? t('error.TWO_FA_CONFIRMATION_REQUIRED') : undefined}
        />
      }
    >
      <div className="flex flex-col gap-4" data-testid="app-version-form">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('adminSettings.app.col.min')} htmlFor="av-min" error={s.fieldError('minVersion')}>
            <Input id="av-min" dir="ltr" value={minVersion} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label={t('adminSettings.app.col.recommended')} htmlFor="av-rec" error={s.fieldError('recommendedVersion')}>
            <Input id="av-rec" dir="ltr" value={recommendedVersion} onChange={(e) => setRec(e.target.value)} />
          </Field>
          <Field label={t('adminSettings.app.col.latest')} htmlFor="av-latest" error={s.fieldError('latestVersion')}>
            <Input id="av-latest" dir="ltr" value={latestVersion} onChange={(e) => setLatest(e.target.value)} />
          </Field>
          <Field label={t('adminSettings.app.field.build')} htmlFor="av-build">
            <NumberInput id="av-build" value={latestBuild} onValueChange={setBuild} />
          </Field>
          <Field label={t('adminSettings.app.col.store')} htmlFor="av-store">
            <Select id="av-store" value={storeStatus} onChange={(e) => setStore(e.target.value as AppVersionDto['storeStatus'])}>
              {StoreStatusValues.map((v) => (
                <option key={v} value={v}>
                  {t(`adminSettings.store.${v}`, { pct: '' })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('adminSettings.app.field.rollout')} htmlFor="av-rollout">
            <NumberInput id="av-rollout" value={rolloutPct} onValueChange={setRollout} suffix="%" maxDigits={3} />
          </Field>
        </div>
        <Field label={t('adminSettings.app.field.storeUrl')} htmlFor="av-url" error={s.fieldError('storeUrl')}>
          <UrlInput id="av-url" autoComplete="off" value={storeUrl} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!s.fieldError('storeUrl') || undefined} />
        </Field>
        <LocalizedFields idPrefix="av-msg" label={t('adminSettings.app.message')} value={message} onChange={setMessage} multiline required error={s.fieldError('updateMessage.fr')} />
        {force ? (
          <div className="flex flex-col gap-3 rounded-card border border-accent-starred/40 p-3" data-testid="force-update">
            <p className="text-[13px] text-accent-starred">
              {t('adminSettings.app.force.impact', { count: version.devicesBelowMin.count, min: version.minVersion, pct: version.devicesBelowMin.pct })}
            </p>
            {blocked ? (
              <p className="text-[13px] text-accent-alert" role="alert">
                {t('adminSettings.app.force.blocked', { latest: latestVersion || version.latestVersion })}
              </p>
            ) : null}
            <Field label={t('adminSettings.app.force.code')} htmlFor="av-code" required error={s.fieldError('totpCode')}>
              <Input id="av-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label={t('adminOps.reason')} htmlFor="av-reason" hint={t('adminOps.reason.hint')}>
              <Input id="av-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        ) : null}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Feature flag create / edit ---------- */
export function FlagDialog({ open, flag, plans, onClose }: { open: boolean; flag: FeatureFlagDto | null; plans: { slug: string; name: string }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [webPct, setWeb] = useState('0');
  const [mobilePct, setMobile] = useState('0');
  const [planSlugs, setPlans] = useState<string[]>([]);
  const [workspaceIds, setWorkspaces] = useState('');
  const [abTest, setAb] = useState(false);
  const [isActive, setActive] = useState(true);
  useOnOpen(open, () => {
    setKey(flag?.key ?? '');
    setDescription(flag?.description ?? '');
    setWeb(String(flag?.webPct ?? 0));
    setMobile(String(flag?.mobilePct ?? 0));
    setPlans(flag?.targeting.planSlugs ?? []);
    setWorkspaces((flag?.targeting.workspaceIds ?? []).join('\n'));
    setAb(!!flag?.targeting.abTest);
    setActive(flag?.isActive ?? true);
    s.setError(null);
  });
  const targeting = () => {
    const ids = workspaceIds.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    return { ...(planSlugs.length ? { planSlugs } : {}), ...(ids.length ? { workspaceIds: ids } : {}), ...(abTest ? { abTest } : {}) };
  };
  const pct = (v: string) => Math.min(100, Number(v || 0));
  const s = useDialogSubmit(() =>
    flag
      ? opsApi.patchFlag(flag.key, { description: description.trim() || null, webPct: pct(webPct), mobilePct: pct(mobilePct), targeting: targeting(), isActive })
      : opsApi.createFlag({ key: key.trim(), description: description.trim() || null, webPct: pct(webPct), mobilePct: pct(mobilePct), targeting: targeting(), isActive }),
  );
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSettings.saved') });
      await refresh(qc);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={flag ? t('adminSettings.flag.edit', { key: flag.key }) : t('adminSettings.flag.new')}
      description={t('adminSettings.flags.sub')}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={flag ? t('action.save') : t('adminSettings.flag.create')} />}
    >
      <div className="flex flex-col gap-4" data-testid="flag-form">
        {!flag ? (
          <Field label={t('adminSettings.flag.field.key')} htmlFor="flag-key" required error={s.fieldError('key')} hint={t('adminSettings.flag.field.key.hint')}>
            <Input id="flag-key" dir="ltr" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t('adminSettings.flag.field.description')} htmlFor="flag-desc">
          <Input id="flag-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adminSettings.flags.col.web')} htmlFor="flag-web" error={s.fieldError('webPct')}>
            <NumberInput id="flag-web" value={webPct} onValueChange={setWeb} suffix="%" maxDigits={3} />
          </Field>
          <Field label={t('adminSettings.flags.col.mobile')} htmlFor="flag-mobile" error={s.fieldError('mobilePct')}>
            <NumberInput id="flag-mobile" value={mobilePct} onValueChange={setMobile} suffix="%" maxDigits={3} />
          </Field>
        </div>
        {plans.length ? (
          <fieldset>
            <legend className="mb-1.5 ts-label-micro uppercase text-text-muted">{t('adminSettings.flag.field.plans')}</legend>
            <div className="flex flex-wrap gap-2">
              {plans.map((p) => (
                <label key={p.slug} className="inline-flex cursor-pointer items-center gap-2 rounded-card border border-line-edge px-2.5 py-1.5 text-[13px]">
                  <Checkbox checked={planSlugs.includes(p.slug)} onChange={() => setPlans((c) => (c.includes(p.slug) ? c.filter((x) => x !== p.slug) : [...c, p.slug]))} />
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field label={t('adminSettings.flag.field.workspaces')} htmlFor="flag-ws" hint={t('adminSettings.flag.field.workspaces.hint')} error={s.fieldError('targeting.workspaceIds')}>
          <Textarea id="flag-ws" dir="ltr" rows={3} className="font-mono text-[12px]" value={workspaceIds} onChange={(e) => setWorkspaces(e.target.value)} />
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
          <Checkbox checked={abTest} onChange={(e) => setAb(e.target.checked)} />
          {t('adminSettings.flag.field.ab')}
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px]">{t('adminSettings.flag.field.active')}</span>
          <Switch checked={isActive} onCheckedChange={setActive} label={t('adminSettings.flag.field.active')} />
        </div>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

export function FlagEvaluateDialog({ flag, onClose }: { flag: FeatureFlagDto | null; onClose: () => void }) {
  const t = useT();
  const [workspaceId, setWs] = useState('');
  const [platform, setPlatform] = useState<'web' | 'mobile'>('web');
  const [result, setResult] = useState<FeatureFlagEvaluationDto | null>(null);
  const s = useDialogSubmit(() => opsApi.evaluateFlag(flag!.key, workspaceId.trim(), platform));
  useOnOpen(!!flag, () => {
    setWs('');
    setPlatform('web');
    setResult(null);
    s.setError(null);
  });
  if (!flag) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.flag.evaluate.title', { key: flag.key })}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void s.submit().then((r) => r && setResult(r))} label={t('adminSettings.flag.evaluate.submit')} closeLabel={t('action.close')} />}
    >
      <div className="flex flex-col gap-3">
        <Field label={t('adminSettings.flag.evaluate.workspace')} htmlFor="flag-eval-ws" error={s.fieldError('workspaceId')}>
          <Input id="flag-eval-ws" dir="ltr" className="font-mono" value={workspaceId} onChange={(e) => setWs(e.target.value)} />
        </Field>
        <RadioList label={t('adminSettings.flag.evaluate.platform')} value={platform} onChange={setPlatform} options={[{ value: 'web', label: t('adminSettings.flags.col.web') }, { value: 'mobile', label: t('adminSettings.flags.col.mobile') }]} />
        {result ? (
          <p data-testid="flag-eval-result" data-enabled={result.enabled} className={result.enabled ? 'text-[13px] text-accent-money' : 'text-[13px] text-text-secondary'}>
            {t(result.enabled ? 'adminSettings.flag.evaluate.on' : 'adminSettings.flag.evaluate.off')} · {t(`adminSettings.flag.reason.${result.reason}`)} · <Ltr>{t('adminSettings.flag.evaluate.bucket', { bucket: result.bucket, pct: result.pct })}</Ltr>
          </p>
        ) : null}
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Maintenance window (PFS-03) ---------- */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function MaintenanceDialog({ open, current, enable, onClose }: { open: boolean; current: MaintenanceDto; enable?: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'now' | 'scheduled'>('now');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<MaintenanceDto['scope']>('all');
  const [text, setText] = useState<OpsLocalizedText>(EMPTY_LOCALIZED);
  const [reason, setReason] = useState('');
  useOnOpen(open, () => {
    setEnabled(enable ?? current.enabled);
    setMode(current.scheduledFrom ? 'scheduled' : 'now');
    setFrom(toLocalInput(current.scheduledFrom));
    setTo(toLocalInput(current.scheduledTo));
    setScope(current.scope);
    setText(current.text ? { fr: current.text.fr, ar: current.text.ar ?? '', en: current.text.en ?? '' } : EMPTY_LOCALIZED);
    setReason('');
    s.setError(null);
  });
  const s = useDialogSubmit(() =>
    opsApi.putMaintenance({
      enabled,
      scheduledFrom: enabled && mode === 'scheduled' ? fromLocalInput(from) : null,
      scheduledTo: enabled ? fromLocalInput(to) : null,
      scope,
      text: text.fr.trim() ? cleanLocalized(text) : null,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    }),
  );
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t(enabled ? 'adminSettings.maintenance.savedOn' : 'adminSettings.maintenance.savedOff') });
      await refresh(qc);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.maintenance.dialog.title')}
      description={t('adminSettings.maintenance.dialog.sub')}
      closeLabel={t('action.close')}
      size="lg"
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} danger={enabled && mode === 'now'} />}
    >
      <div className="flex flex-col gap-4" data-testid="maintenance-form">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px]">{t('adminSettings.maintenance.field.enabled')}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} label={t('adminSettings.maintenance.field.enabled')} />
        </div>
        {enabled ? (
          <>
            <RadioList
              label={t('adminSettings.maintenance.field.mode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'now', label: t('adminSettings.maintenance.mode.now'), description: t('adminSettings.maintenance.mode.now.sub') },
                { value: 'scheduled', label: t('adminSettings.maintenance.mode.scheduled') },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === 'scheduled' ? (
                <Field label={t('adminSettings.maintenance.field.from')} htmlFor="mt-from" error={s.fieldError('scheduledFrom')}>
                  <Input id="mt-from" type="datetime-local" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
              ) : null}
              <Field label={t('adminSettings.maintenance.field.to')} htmlFor="mt-to" error={s.fieldError('scheduledTo')} hint={t('adminSettings.maintenance.field.to.hint')}>
                <Input id="mt-to" type="datetime-local" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
          </>
        ) : null}
        <Field label={t('adminSettings.maintenance.scope')} htmlFor="mt-scope">
          <Select id="mt-scope" value={scope} onChange={(e) => setScope(e.target.value as MaintenanceDto['scope'])}>
            {(['all', 'web', 'mobile'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`adminSettings.maintenance.scope.${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        <LocalizedFields idPrefix="mt-text" label={t('adminSettings.maintenance.field.text')} value={text} onChange={setText} multiline />
        <Field label={t('adminOps.reason')} htmlFor="mt-reason" hint={t('adminOps.reason.hint')}>
          <Input id="mt-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

export function IncidentBannerDialog({ open, current, onClose }: { open: boolean; current: IncidentBannerDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState<OpsLocalizedText>(EMPTY_LOCALIZED);
  const [textError, setTextError] = useState<string | undefined>();
  useOnOpen(open, () => {
    setVisible(current.visible);
    setText(current.text ? { fr: current.text.fr, ar: current.text.ar ?? '', en: current.text.en ?? '' } : EMPTY_LOCALIZED);
    setTextError(undefined);
    s.setError(null);
  });
  const s = useDialogSubmit(() => opsApi.putIncidentBanner({ visible, text: text.fr.trim() ? cleanLocalized(text) : null }));
  const submit = async () => {
    if (visible && !text.fr.trim()) {
      setTextError(t('validation.required'));
      return;
    }
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSettings.saved') });
      await refresh(qc);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.banner.dialog.title')}
      description={t('adminSettings.banner.dialog.sub')}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="incident-banner-form">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px]">{t('adminSettings.banner.field.visible')}</span>
          <Switch checked={visible} onCheckedChange={setVisible} label={t('adminSettings.banner.field.visible')} />
        </div>
        <LocalizedFields idPrefix="banner-text" label={t('adminSettings.banner.field.text')} value={text} onChange={setText} multiline required={visible} error={textError} />
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Meta permission status / Meta app ---------- */
const META_STATUSES = ['not_requested', 'in_review', 'approved', 'rejected'] as const;
export function MetaPermissionDialog({ permission, onClose }: { permission: MetaPermissionDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [status, setStatus] = useState<MetaPermissionDto['status']>('not_requested');
  const [notes, setNotes] = useState('');
  useOnOpen(!!permission, () => {
    setStatus(permission?.status ?? 'not_requested');
    setNotes(permission?.notes ?? '');
    s.setError(null);
  });
  const s = useDialogSubmit(() => {
    const now = new Date().toISOString();
    return opsApi.patchMetaPermission(permission!.scope, {
      status,
      notes: notes.trim() || null,
      ...(status === 'in_review' && permission!.status !== 'in_review' ? { submittedAt: now } : {}),
      ...((status === 'approved' || status === 'rejected') && permission!.status !== status ? { decidedAt: now } : {}),
    });
  });
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSettings.saved') });
      await refresh(qc);
      onClose();
    }
  };
  if (!permission) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.meta.dialog.title', { scope: permission.scope })}
      description={t('adminSettings.meta.dialog.sub', { feature: permission.feature })}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="meta-permission-form">
        <RadioList label={t('adminSettings.meta.col.status')} value={status} onChange={setStatus} options={META_STATUSES.map((v) => ({ value: v, label: t(`adminSettings.meta.status.${v}`, { days: permission.daysInReview ?? 0, date: '' }) }))} />
        <Field label={t('adminSettings.meta.field.notes')} htmlFor="meta-notes">
          <Textarea id="meta-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

export function MetaAppDialog({ open, appId, onClose }: { open: boolean; appId: string | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  useOnOpen(open, () => {
    setId(appId ?? '');
    setSecret('');
    s.setError(null);
  });
  const s = useDialogSubmit(() => opsApi.putMetaApp({ appId: id.trim(), ...(secret.trim() ? { appSecret: secret.trim() } : {}) }));
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSettings.saved') });
      await qc.invalidateQueries({ queryKey: opsKeys.metaApp });
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.meta.app.title')}
      description={t('adminSettings.meta.app.sub')}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('adminSettings.meta.field.appId')} htmlFor="meta-app-id" error={s.fieldError('appId')}>
          <Input id="meta-app-id" dir="ltr" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={t('adminSettings.meta.field.secret')} htmlFor="meta-app-secret" hint={t('adminSettings.secret.hint')} error={s.fieldError('appSecret')}>
          <Input id="meta-app-secret" dir="ltr" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- Technical provider configuration ---------- */
export function ProviderDialog({ provider, onClose }: { provider: PlatformProviderDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [reason, setReason] = useState('');
  useOnOpen(!!provider, () => {
    const c: Record<string, string> = {};
    for (const [k, v] of Object.entries(provider?.config ?? {})) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) c[k] = v === null ? '' : String(v);
    setConfig(c);
    setSecret('');
    setReason('');
    s.setError(null);
  });
  const s = useDialogSubmit(() => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(config)) {
      const orig = provider!.config[k];
      out[k] = typeof orig === 'number' ? (v === '' ? null : Number(v)) : typeof orig === 'boolean' ? v === 'true' : v === '' ? null : v;
    }
    return opsApi.putProvider(provider!.key, { config: out, ...(secret ? { secret } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) });
  });
  const submit = async () => {
    if (await s.submit()) {
      toast({ tone: 'success', message: t('adminSettings.saved') });
      await refresh(qc);
      onClose();
    }
  };
  if (!provider) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('adminSettings.provider.dialog.title', { name: t(`adminSettings.provider.${provider.key}`) })}
      description={t('adminSettings.provider.dialog.sub')}
      closeLabel={t('action.close')}
      footer={<DialogFooter onClose={onClose} busy={s.busy} onSubmit={() => void submit()} label={t('action.save')} />}
    >
      <div className="flex flex-col gap-4" data-testid="provider-form">
        {Object.keys(config).map((k) => (
          <Field key={k} label={k} htmlFor={`prov-${k}`} error={s.fieldError(`config.${k}`)}>
            <Input id={`prov-${k}`} dir="ltr" value={config[k] ?? ''} onChange={(e) => setConfig((c) => ({ ...c, [k]: e.target.value }))} />
          </Field>
        ))}
        <Field label={provider.secretSet ? t('adminSettings.provider.secret.replace') : t('adminSettings.provider.secret.set')} htmlFor="prov-secret" hint={t('adminSettings.secret.hint')}>
          <Input id="prov-secret" dir="ltr" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <Field label={t('adminOps.reason')} htmlFor="prov-reason" hint={t('adminOps.reason.hint')}>
          <Input id="prov-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {s.error ? <FormAlert>{s.error}</FormAlert> : null}
      </div>
    </Dialog>
  );
}

/* ---------- "Historique" (PFS-07: every change versioned) ---------- */
const HISTORY_KEYS: SettingKey[] = ['limits', 'legal_contacts', 'sensitive_categories', 'moderation_policy'];
export function SettingsHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const [key, setKey] = useState<SettingKey>('limits');
  const q = useQuery({ queryKey: opsKeys.settingVersions(key), queryFn: () => opsApi.settingVersions(key), enabled: open });
  const rows: PlatformSettingVersionDto[] = q.data ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('adminSettings.history.title')} description={t('adminSettings.history.sub')} closeLabel={t('action.close')} size="lg">
      <div className="flex flex-col gap-3" data-testid="settings-history">
        <Select aria-label={t('adminSettings.history.key')} value={key} onChange={(e) => setKey(e.target.value as SettingKey)}>
          {HISTORY_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`adminSettings.history.key.${k}`)}
            </option>
          ))}
        </Select>
        {q.isPending ? (
          <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
        ) : q.isError ? (
          <FormAlert>{t('state.list.error.title')}</FormAlert>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t('adminSettings.history.empty')}</p>
        ) : (
          <ul className="divide-y divide-line-hairline rounded-card border border-line-edge">
            {rows.map((v) => (
              <li key={v.version} className="flex flex-col gap-1 px-3 py-2.5">
                <span className="text-[13px]">
                  v{v.version} · {formatDateTime(v.at, locale)} · {v.changedBy ? userName(v.changedBy) : t('adminOps.system')}
                </span>
                {v.reason ? <span className="ts-label-meta text-text-muted">{v.reason}</span> : null}
                <pre dir="ltr" className="overflow-auto rounded-card bg-ink-raised p-2 text-[11px] text-text-secondary">
                  {JSON.stringify(v.value, null, 1)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

