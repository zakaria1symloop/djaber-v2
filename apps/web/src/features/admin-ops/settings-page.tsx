'use client';
// /admin/settings — Figma "ADM-13 — Platform admin — platform settings (flags, app versions, legal, Meta, providers)"
// (975:39323), D39 / D58, PFS-01…07: mobile app versions + force update (2FA), feature flags, maintenance & incident
// banner, legal documents (acceptance %) + account-deletion URL / DPO e-mail, Meta app permissions, technical providers
// health + "Tester", limits & defaults. Header: "Historique" (settings versions) and "Enregistrer" (limits + legal
// contacts form). Reads `admin.settings.read`; edits `admin.settings.write`; maintenance / incident banner
// `admin.health.write` (both super_admin only, 01 §3.2).
import {
  formatDate,
  formatNumber,
  PLATFORM_LIMITS_DEFAULTS,
  type AdminSettingsDto,
  type AppVersionDto,
  type FeatureFlagDto,
  type LegalDocumentDto,
  type MetaPermissionDto,
  type ModerationPolicy,
  type PlatformLimits,
  type PlatformProviderDto,
  type ProviderTestResultDto,
} from '@djaber/shared';
import { ActionsMenu, Button, ConfirmDialog, DataTable, Dialog, EmailInput, Field, Input, Ltr, NumberInput, OpsPanel, Skeleton, StatePill, Switch, toast, UrlInput, type Column, type OpsState } from '@djaber/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { OfflineBanner } from '@/components/global-states';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { ADMIN_KEY } from '@/features/admin/platform';
import { billingApi } from '@/features/billing/api';
import { useRouter } from '@/i18n/navigation';
import { errorMessage, useLeaveGuard } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { opsApi, opsKeys, useAdminSettings, useMetaApp } from './api';
import { useLocalized, useWrite } from './common';
import { flagOn, flagTarget } from './logic';
import { AppVersionDialog, FlagDialog, FlagEvaluateDialog, IncidentBannerDialog, MaintenanceDialog, MetaAppDialog, MetaPermissionDialog, ProviderDialog, SettingsHistoryDialog } from './settings-dialogs';

const LIMIT_FIELDS = ['apiRatePerMin', 'webhookRetries', 'trialDays', 'trialCredits', 'deletionGraceDays', 'impersonationMinutes'] as const;
type LimitsForm = Record<(typeof LIMIT_FIELDS)[number], string>;
type ContactsForm = { accountDeletionUrl: string; dpoEmail: string };

const settingValue = <T,>(data: AdminSettingsDto, key: string): T | null => (data.settings.find((s) => s.key === key)?.value as T | undefined) ?? null;

export function SettingsPage() {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const qc = useQueryClient();
  const settings = useAdminSettings();
  const write = useWrite('admin.settings.write');
  const [history, setHistory] = useState(false);
  const [limits, setLimits] = useState<LimitsForm | null>(null);
  const [contacts, setContacts] = useState<ContactsForm | null>(null);
  const [manualReview, setManualReview] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');

  // the form starts from the server values (and follows them until the admin types)
  const base = useMemo(() => {
    if (!settings.data) return null;
    const l = { ...PLATFORM_LIMITS_DEFAULTS, ...(settingValue<Partial<PlatformLimits>>(settings.data, 'limits') ?? {}) };
    const c = settingValue<Partial<ContactsForm>>(settings.data, 'legal_contacts') ?? {};
    return {
      limitsValue: l,
      limits: Object.fromEntries(LIMIT_FIELDS.map((f) => [f, String(l[f])])) as LimitsForm,
      contacts: { accountDeletionUrl: c.accountDeletionUrl ?? '', dpoEmail: c.dpoEmail ?? '' },
      manualReview: settingValue<Partial<ModerationPolicy>>(settings.data, 'moderation_policy')?.manualReviewAll === true,
    };
  }, [settings.data]);
  const formLimits = limits ?? base?.limits ?? null;
  const formContacts = contacts ?? base?.contacts ?? null;
  const limitsDirty = !!limits && !!base && LIMIT_FIELDS.some((f) => limits[f] !== base.limits[f]);
  const contactsDirty = !!contacts && !!base && (contacts.accountDeletionUrl !== base.contacts.accountDeletionUrl || contacts.dpoEmail !== base.contacts.dpoEmail);
  const formManualReview = manualReview ?? base?.manualReview ?? false;
  const policyDirty = manualReview !== null && !!base && manualReview !== base.manualReview;
  const dirty = limitsDirty || contactsDirty || policyDirty;
  const { guard } = useLeaveGuard(dirty, t('nav.admin.settings'));

  const save = async (why: string) => {
    if (!base || !formLimits || !formContacts) return;
    setSaving(true);
    setErrors({});
    const next: Record<string, string> = {};
    // each section is its own setting: a saved one leaves the dirty state even when the other one is refused
    const ok = { limits: false, contacts: false, policy: false };
    try {
      if (limitsDirty) {
        const value = { ...base.limitsValue, ...Object.fromEntries(LIMIT_FIELDS.map((f) => [f, Number(formLimits[f] || 0)])) };
        try {
          await opsApi.putSetting('limits', value, why);
          ok.limits = true;
        } catch (e) {
          next.limits = errorMessage(e, t);
        }
      }
      if (contactsDirty) {
        try {
          await opsApi.putSetting('legal_contacts', { accountDeletionUrl: formContacts.accountDeletionUrl.trim(), dpoEmail: formContacts.dpoEmail.trim().toLowerCase() }, why);
          ok.contacts = true;
        } catch (e) {
          next.contacts = errorMessage(e, t);
        }
      }
      if (policyDirty) {
        try {
          await opsApi.putSetting('moderation_policy', { manualReviewAll: formManualReview }, why);
          ok.policy = true;
        } catch (e) {
          next.policy = errorMessage(e, t);
        }
      }
      setErrors(next);
      if (ok.limits || ok.contacts || ok.policy) await qc.invalidateQueries({ queryKey: opsKeys.settings });
      if (ok.limits) setLimits(null);
      if (ok.contacts) setContacts(null);
      if (ok.policy) setManualReview(null);
      if (!next.limits && !next.contacts && !next.policy) toast({ tone: 'success', message: t('adminSettings.saved') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPage
      permission="admin.settings.read"
      title={t('nav.admin.settings')}
      description={t('adminSettings.description')}
      actions={
        <>
          <Button variant="ghost" onClick={() => setHistory(true)} data-testid="settings-history-open">
            {t('adminSettings.history')}
          </Button>
          {write.allowed ? (
            <Button variant="primary" onClick={() => (setReason(''), setReasonOpen(true))} loading={saving} disabledReason={write.disabledReason ?? (dirty ? undefined : t('adminSettings.noChanges'))} data-testid="settings-save">
              {t('action.save')}
            </Button>
          ) : null}
        </>
      }
    >
      {write.offline && settings.data ? <OfflineBanner since={formatDate(new Date(settings.dataUpdatedAt), locale)} onRetry={() => void settings.refetch()} /> : null}
      {settings.isPending ? (
        <div aria-busy="true" aria-label={t('common.loading')} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : settings.isError && !settings.data ? (
        <AdminQueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data && formLimits && formContacts ? (
        // grid-cols-1 / min-w-0: the panels' tables scroll inside their card instead of widening the page on phones
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-5">
            <AppVersionsPanel versions={settings.data.appVersions} />
            <FlagsPanel flags={settings.data.flags} />
            <MaintenancePanel data={settings.data} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <ModerationPolicyPanel value={formManualReview} onChange={setManualReview} error={errors.policy} />
            <LegalPanel docs={settings.data.legal} contacts={formContacts} onContacts={(c) => setContacts(c)} error={errors.contacts} />
            <MetaPanel permissions={settings.data.metaPermissions} />
            <ProvidersPanel providers={settings.data.providers} />
            <LimitsPanel value={formLimits} onChange={(l) => setLimits(l)} error={errors.limits} />
          </div>
        </div>
      ) : null}
      <SettingsHistoryDialog open={history} onClose={() => setHistory(false)} />
      <Dialog
        open={reasonOpen}
        onOpenChange={(o) => !o && !saving && setReasonOpen(false)}
        title={t('adminSettings.save.title')}
        description={t('adminSettings.save.sub')}
        closeLabel={t('action.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReasonOpen(false)} disabled={saving}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabledReason={reason.trim().length < 10 ? t('error.ADMIN_REASON_REQUIRED') : undefined}
              onClick={() => void save(reason.trim()).then(() => setReasonOpen(false))}
              data-testid="settings-save-confirm"
            >
              {t('action.save')}
            </Button>
          </>
        }
      >
        <Field label={t('adminOps.reason')} htmlFor="settings-reason" required hint={t('adminOps.reason.min')}>
          <Input id="settings-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Dialog>
      {guard}
    </AdminPage>
  );
}

/* ---------- Mobile app versions ---------- */
function storeLabel(t: ReturnType<typeof useT>, v: AppVersionDto) {
  return t(`adminSettings.store.${v.storeStatus}`, { pct: v.rolloutPct ?? 100 });
}
const STORE_STATE: Record<AppVersionDto['storeStatus'], OpsState> = { published: 'ok', rollout: 'ok', in_review: 'warning', rejected: 'incident' };

function AppVersionsPanel({ versions }: { versions: AppVersionDto[] }) {
  const t = useT();
  const pick = useLocalized();
  const write = useWrite('admin.settings.write');
  const [edit, setEdit] = useState<AppVersionDto | null>(null);
  const impact = versions.reduce((n, v) => n + v.devicesBelowMin.count, 0);
  const pct = versions.length ? Math.round(versions.reduce((n, v) => n + v.devicesBelowMin.pct, 0) / versions.length) : 0;
  const mins = [...new Set(versions.map((v) => v.minVersion))].join(' / ');
  const columns: Column<AppVersionDto>[] = [
    { key: 'platform', header: t('adminSettings.app.col.platform'), cell: (v) => t(`adminSettings.platform.${v.platform}`), hideable: false },
    { key: 'latest', header: t('adminSettings.app.col.latestPublished'), cell: (v) => `${v.latestVersion}${v.latestBuild !== null ? ` (${v.latestBuild})` : ''}`, ltr: true },
    { key: 'min', header: t('adminSettings.app.col.min'), cell: (v) => v.minVersion, ltr: true },
    { key: 'rec', header: t('adminSettings.app.col.recommended'), cell: (v) => v.recommendedVersion, ltr: true },
    { key: 'store', header: t('adminSettings.app.col.store'), cell: (v) => <StatePill state={STORE_STATE[v.storeStatus]}>{storeLabel(t, v)}</StatePill> },
  ];
  return (
    <OpsPanel title={t('adminSettings.app.title')} sub={t('adminSettings.app.sub')} data-testid="app-versions">
      {versions.length ? (
        <DataTable
          label={t('adminSettings.app.title')}
          columns={columns}
          rows={versions}
          rowKey={(v) => v.platform}
          density="compact"
          actionsLabel={t('action.actions')}
          rowActions={write.allowed ? (v) => <ActionsMenu iconOnly label={t('action.actions')} heading={t(`adminSettings.platform.${v.platform}`)} actions={[{ key: 'edit', label: t('action.edit'), onSelect: write.offline ? undefined : () => setEdit(v), disabledReason: write.disabledReason }]} /> : undefined}
        />
      ) : (
        <p className="text-[13px] text-text-muted">{t('adminSettings.app.empty')}</p>
      )}
      {versions[0] ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 ts-label-micro uppercase text-text-muted">{t('adminSettings.app.message')}</div>
            <p className="rounded-card border border-line-edge px-3 py-2.5 text-[13px] text-text-secondary">{pick(versions[0].updateMessage)}</p>
          </div>
          <div>
            <div className="mb-1.5 ts-label-micro uppercase text-text-muted">{t('adminSettings.app.stores')}</div>
            <p className="truncate rounded-card border border-line-edge px-3 py-2.5 text-[13px] text-text-secondary" dir="ltr">
              {versions.map((v) => v.storeUrl.replace(/^https:\/\//, '')).join(' · ')}
            </p>
          </div>
        </div>
      ) : null}
      <p className="mt-3 ts-label-micro !normal-case text-accent-starred" data-testid="force-update-note">
        {t('adminSettings.app.forceNote', { count: formatNumber(impact), min: mins || '—', pct })}
      </p>
      <AppVersionDialog version={edit} onClose={() => setEdit(null)} />
    </OpsPanel>
  );
}

/* ---------- Feature flags ---------- */
function FlagsPanel({ flags }: { flags: FeatureFlagDto[] }) {
  const t = useT();
  const qc = useQueryClient();
  const write = useWrite('admin.settings.write');
  const plans = useQuery({ queryKey: [ADMIN_KEY, 'plans-public'], queryFn: billingApi.plans, staleTime: 300_000 });
  const [dialog, setDialog] = useState<{ flag: FeatureFlagDto | null } | null>(null);
  const [evaluate, setEvaluate] = useState<FeatureFlagDto | null>(null);
  const [remove, setRemove] = useState<FeatureFlagDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const planName = (slug: string) => plans.data?.find((p) => p.slug === slug)?.name ?? slug;
  // switching a platform back on: its kept percentage, else the other platform's rollout; never a silent 100 %
  const [fullOn, setFullOn] = useState<{ flag: FeatureFlagDto; field: 'webPct' | 'mobilePct' } | null>(null);
  const onPct = (f: FeatureFlagDto, field: 'webPct' | 'mobilePct') => (f[field] > 0 ? f[field] : f[field === 'webPct' ? 'mobilePct' : 'webPct']);
  const toggle = async (f: FeatureFlagDto, field: 'webPct' | 'mobilePct', on: boolean, pct?: number) => {
    if (on && !pct && onPct(f, field) <= 0) return setFullOn({ flag: f, field });
    setBusy(`${f.key}:${field}`);
    try {
      await opsApi.patchFlag(f.key, { [field]: on ? (pct ?? onPct(f, field)) : 0, ...(on && !f.isActive ? { isActive: true } : {}) });
      await qc.invalidateQueries({ queryKey: opsKeys.settings });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };
  const doRemove = async () => {
    if (!remove) return;
    setBusy(`${remove.key}:delete`);
    try {
      await opsApi.deleteFlag(remove.key);
      toast({ tone: 'success', message: t('adminSettings.flag.deleted', { key: remove.key }) });
      setRemove(null);
      await qc.invalidateQueries({ queryKey: opsKeys.settings });
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  };
  const target = (f: FeatureFlagDto) => {
    const x = flagTarget(f);
    if (!f.isActive) return t('adminSettings.flag.target.inactive');
    if (x.workspaces) return t('adminSettings.flag.target.list', { count: x.workspaces });
    const parts = [`${x.pct} %`];
    if (x.plans.length) parts.push(x.plans.map(planName).join(', '));
    if (x.abTest) parts.push(t('adminSettings.flag.target.ab'));
    return parts.join(' · ');
  };
  const sw = (f: FeatureFlagDto, field: 'webPct' | 'mobilePct') => (
    <Switch
      checked={flagOn(f, f[field])}
      onCheckedChange={(v) => void toggle(f, field, v)}
      label={t(field === 'webPct' ? 'adminSettings.flag.toggleWeb' : 'adminSettings.flag.toggleMobile', { key: f.key })}
      disabled={!write.allowed || write.offline || busy !== null}
    />
  );
  const columns: Column<FeatureFlagDto>[] = [
    { key: 'key', header: t('adminSettings.flags.col.flag'), cell: (f) => <span className="font-mono text-[13px]">{f.key}</span>, hideable: false },
    { key: 'web', header: t('adminSettings.flags.col.web'), cell: (f) => sw(f, 'webPct') },
    { key: 'mobile', header: t('adminSettings.flags.col.mobile'), cell: (f) => sw(f, 'mobilePct') },
    { key: 'target', header: t('adminSettings.flags.col.target'), cell: (f) => <span className="text-text-secondary">{target(f)}</span> },
  ];
  return (
    <OpsPanel
      title={t('adminSettings.flags.title')}
      sub={t('adminSettings.flags.sub')}
      data-testid="flags"
      end={
        write.allowed ? (
          <Button size="sm" variant="ghost" onClick={() => setDialog({ flag: null })} disabledReason={write.disabledReason} data-testid="flag-new">
            {t('adminSettings.flag.new')}
          </Button>
        ) : null
      }
    >
      {flags.length ? (
        <DataTable
          label={t('adminSettings.flags.title')}
          columns={columns}
          rows={flags}
          rowKey={(f) => f.key}
          density="compact"
          actionsLabel={t('action.actions')}
          rowActions={(f) => (
            <ActionsMenu
              iconOnly
              label={t('action.actions')}
              heading={f.key}
              actions={[
                ...(write.allowed ? [{ key: 'edit', label: t('action.edit'), onSelect: write.offline ? undefined : () => setDialog({ flag: f }), disabledReason: write.disabledReason }] : []),
                { key: 'evaluate', label: t('adminSettings.flag.evaluate'), onSelect: () => setEvaluate(f) },
                ...(write.allowed ? [{ key: 'delete', label: t('action.delete'), destructive: true, separated: true, onSelect: write.offline ? undefined : () => setRemove(f), disabledReason: write.disabledReason }] : []),
              ]}
            />
          )}
        />
      ) : (
        <p className="text-[13px] text-text-muted">{t('adminSettings.flags.empty')}</p>
      )}
      <FlagDialog open={!!dialog} flag={dialog?.flag ?? null} plans={(plans.data ?? []).map((p) => ({ slug: p.slug, name: p.name }))} onClose={() => setDialog(null)} />
      <FlagEvaluateDialog flag={evaluate} onClose={() => setEvaluate(null)} />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title={t('adminSettings.flag.delete.title', { key: remove?.key ?? '' })}
        description={t('adminSettings.flag.delete.description')}
        confirmLabel={t('action.delete')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={busy === `${remove?.key}:delete`}
        onConfirm={() => void doRemove()}
      />
      <ConfirmDialog
        open={!!fullOn}
        onOpenChange={(o) => !o && setFullOn(null)}
        title={t('adminSettings.flag.fullOn.title', { key: fullOn?.flag.key ?? '' })}
        description={t('adminSettings.flag.fullOn.description')}
        confirmLabel={t('adminSettings.flag.fullOn.confirm')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        onConfirm={() => {
          const x = fullOn;
          setFullOn(null);
          if (x) void toggle(x.flag, x.field, true, 100);
        }}
      />
    </OpsPanel>
  );
}

/* ---------- Maintenance & incident banner ---------- */
function MaintenancePanel({ data }: { data: AdminSettingsDto }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const pick = useLocalized();
  const write = useWrite('admin.health.write');
  const [dialog, setDialog] = useState<'maintenance' | 'enable' | 'banner' | null>(null);
  const m = data.maintenance;
  const b = data.incidentBanner;
  const range = `${m.scheduledFrom ? formatDate(m.scheduledFrom, locale) + ' ' + new Date(m.scheduledFrom).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Algiers' }) : '—'} → ${m.scheduledTo ? new Date(m.scheduledTo).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Algiers' }) : '—'}`;
  const mode = m.active ? t('adminSettings.maintenance.state.active', { to: m.scheduledTo ? formatDate(m.scheduledTo, locale) : '—' }) : m.enabled && m.scheduledFrom ? t('adminSettings.maintenance.state.scheduled', { range }) : t('adminSettings.maintenance.state.off');
  const box = (label: string, value: string, onClick: () => void, testId: string) => (
    <div className="min-w-0">
      <div className="mb-1.5 ts-label-micro uppercase text-text-muted">{label}</div>
      <button
        type="button"
        onClick={onClick}
        disabled={!write.allowed || write.offline}
        data-testid={testId}
        title={!write.allowed ? undefined : write.disabledReason}
        className="w-full rounded-card border border-line-edge px-3 py-2.5 text-start text-[13px] text-text-secondary enabled:hover:border-line-lit disabled:cursor-default"
      >
        {value}
      </button>
    </div>
  );
  return (
    <OpsPanel
      title={t('adminSettings.maintenance.title')}
      data-testid="maintenance"
      data-active={m.active}
      end={<Switch checked={m.enabled} onCheckedChange={(v) => setDialog(v ? 'enable' : 'maintenance')} label={t('adminSettings.maintenance.field.enabled')} disabled={!write.allowed || write.offline} />}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {box(t('adminSettings.maintenance.mode'), mode, () => setDialog('maintenance'), 'maintenance-mode')}
        {box(t('adminSettings.maintenance.scope'), t(`adminSettings.maintenance.scope.${m.scope}.long`), () => setDialog('maintenance'), 'maintenance-scope')}
        {box(
          t('adminSettings.banner.title'),
          t(b.visible ? 'adminSettings.banner.state.on' : 'adminSettings.banner.state.off', { text: pick(b.text) || t('adminSettings.banner.noText') }),
          () => setDialog('banner'),
          'incident-banner-open',
        )}
      </div>
      <MaintenanceDialog open={dialog === 'maintenance' || dialog === 'enable'} enable={dialog === 'enable' ? true : undefined} current={m} onClose={() => setDialog(null)} />
      <IncidentBannerDialog open={dialog === 'banner'} current={b} onClose={() => setDialog(null)} />
    </OpsPanel>
  );
}

/* ---------- Legal documents ---------- */
function LegalPanel({ docs, contacts, onContacts, error }: { docs: LegalDocumentDto[]; contacts: ContactsForm; onContacts: (c: ContactsForm) => void; error?: string }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const router = useRouter();
  const write = useWrite('admin.settings.write');
  const columns: Column<LegalDocumentDto>[] = [
    { key: 'doc', header: t('adminSettings.legal.col.document'), cell: (d) => t(`legal.doc.${d.key}`), hideable: false },
    { key: 'version', header: t('adminSettings.legal.col.version'), cell: (d) => `v${d.version}`, ltr: true },
    { key: 'published', header: t('adminSettings.legal.col.published'), cell: (d) => formatDate(d.publishedAt, locale) },
    {
      key: 'acceptance',
      header: t('adminSettings.legal.col.acceptance'),
      cell: (d) =>
        d.requiresReacceptance || d.acceptance.required > 0 ? (
          <span data-testid={`acceptance-${d.key}`}>
            {t('adminSettings.legal.acceptance', { pct: d.acceptance.pct, pending: formatNumber(Math.max(0, d.acceptance.required - d.acceptance.accepted)) })}
          </span>
        ) : (
          '—'
        ),
    },
  ];
  return (
    <OpsPanel title={t('adminSettings.legal.title')} sub={t('adminSettings.legal.sub')} data-testid="legal">
      {docs.length ? (
        <DataTable
          label={t('adminSettings.legal.title')}
          columns={columns}
          rows={docs}
          rowKey={(d) => d.id}
          density="compact"
          actionsLabel={t('action.actions')}
          rowActions={() => <ActionsMenu iconOnly label={t('action.actions')} actions={[{ key: 'cms', label: t('adminSettings.legal.openCms'), onSelect: () => router.push('/admin/cms?tab=legal') }]} />}
        />
      ) : (
        <p className="text-[13px] text-text-muted">{t('adminSettings.legal.empty')}</p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={t('adminSettings.legal.deletionUrl')} htmlFor="legal-url">
          <UrlInput id="legal-url" autoComplete="off" value={contacts.accountDeletionUrl} readOnly={!write.allowed} onChange={(e) => onContacts({ ...contacts, accountDeletionUrl: e.target.value })} />
        </Field>
        <Field label={t('adminSettings.legal.dpo')} htmlFor="legal-dpo">
          <EmailInput id="legal-dpo" autoComplete="off" value={contacts.dpoEmail} readOnly={!write.allowed} onChange={(e) => onContacts({ ...contacts, dpoEmail: e.target.value })} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-accent-alert">
          {error}
        </p>
      ) : null}
    </OpsPanel>
  );
}

/* ---------- Meta app ---------- */
const META_STATE: Record<MetaPermissionDto['status'], OpsState> = { approved: 'ok', in_review: 'warning', not_requested: 'neutral', rejected: 'incident' };
function MetaPanel({ permissions }: { permissions: MetaPermissionDto[] }) {
  const t = useT();
  const locale = useLocaleCode() as 'fr' | 'ar' | 'en';
  const write = useWrite('admin.settings.write');
  const app = useMetaApp();
  const [edit, setEdit] = useState<MetaPermissionDto | null>(null);
  const [appDialog, setAppDialog] = useState(false);
  // `/admin/settings#meta` (overview alert "Instagram en revue Meta"): the panel renders after the data, so it is
  // brought into view once mounted
  useEffect(() => {
    if (window.location.hash === '#meta') document.getElementById('meta')?.scrollIntoView({ block: 'start' });
  }, []);
  const columns: Column<MetaPermissionDto>[] = [
    { key: 'scope', header: t('adminSettings.meta.col.permission'), cell: (p) => <span className="font-mono text-[13px]">{p.scope}</span>, hideable: false },
    {
      key: 'status',
      header: t('adminSettings.meta.col.status'),
      cell: (p) => (
        <StatePill state={META_STATE[p.status]}>
          {t(`adminSettings.meta.status.${p.status}`, { days: p.daysInReview ?? 0, date: p.decidedAt ? ` · ${formatDate(p.decidedAt, locale)}` : '' })}
        </StatePill>
      ),
    },
    { key: 'feature', header: t('adminSettings.meta.col.feature'), cell: (p) => p.feature || '—' },
  ];
  const a = app.data;
  const field = (label: string, value: ReactNode, onClick?: () => void) => (
    <div className="min-w-0">
      <div className="mb-1.5 ts-label-micro uppercase text-text-muted">{label}</div>
      {onClick && write.allowed ? (
        <button type="button" onClick={onClick} disabled={write.offline} className="w-full rounded-card border border-line-edge px-3 py-2.5 text-start text-[13px] text-text-secondary enabled:hover:border-line-lit">
          {value}
        </button>
      ) : (
        <div className="rounded-card border border-line-edge px-3 py-2.5 text-[13px] text-text-secondary">{value}</div>
      )}
    </div>
  );
  return (
    <OpsPanel id="meta" title={t('adminSettings.meta.title')} sub={t('adminSettings.meta.sub')} className="scroll-mt-4" data-testid="meta">
      {permissions.length ? (
        <DataTable
          label={t('adminSettings.meta.title')}
          columns={columns}
          rows={permissions}
          rowKey={(p) => p.scope}
          density="compact"
          actionsLabel={t('action.actions')}
          rowActions={write.allowed ? (p) => <ActionsMenu iconOnly label={t('action.actions')} heading={p.scope} actions={[{ key: 'status', label: t('adminSettings.meta.changeStatus'), onSelect: write.offline ? undefined : () => setEdit(p), disabledReason: write.disabledReason }]} /> : undefined}
        />
      ) : (
        <p className="text-[13px] text-text-muted">{t('adminSettings.meta.empty')}</p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {app.isPending ? (
          <Skeleton className="h-14 sm:col-span-2 xl:col-span-4" />
        ) : !a ? (
          <p className="text-[13px] text-accent-alert sm:col-span-2 xl:col-span-4">{errorMessage(app.error, t)}</p>
        ) : (
          <>
            {field(t('adminSettings.meta.field.appId'), <Ltr>{a.appId ?? '—'}</Ltr>, () => setAppDialog(true))}
            {field(t('adminSettings.meta.field.secret'), a.secretSet ? t('adminSettings.meta.secret.set') : t('adminSettings.meta.secret.unset'), () => setAppDialog(true))}
            {field(
              t('adminSettings.meta.field.webhook'),
              <span className="break-all">
                <Ltr>{a.webhookUrl}</Ltr>
                {a.verifyTokenSet ? ` · ${t('adminSettings.meta.webhook.verified')}` : ''}
                {a.ackRate24hPct !== null ? ` · ${a.ackRate24hPct.toLocaleString('fr-FR')} %` : ''}
              </span>,
            )}
            {field(t('adminSettings.meta.field.mode'), t(`adminSettings.meta.mode.${a.mode}`, { count: a.pendingInstagramChannels }))}
          </>
        )}
      </div>
      <MetaPermissionDialog permission={edit} onClose={() => setEdit(null)} />
      <MetaAppDialog open={appDialog} appId={a?.appId ?? null} onClose={() => setAppDialog(false)} />
    </OpsPanel>
  );
}

/* ---------- Technical providers ---------- */
const PROVIDER_STATE: Record<PlatformProviderDto['status'], OpsState> = { ok: 'ok', warning: 'warning', error: 'incident', disabled: 'neutral' };
type TestState = { state: 'testing' } | { state: 'done'; result: ProviderTestResultDto } | { state: 'error'; message: string };

function ProvidersPanel({ providers }: { providers: PlatformProviderDto[] }) {
  const t = useT();
  const qc = useQueryClient();
  const write = useWrite('admin.settings.write');
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [edit, setEdit] = useState<PlatformProviderDto | null>(null);
  const test = async (p: PlatformProviderDto) => {
    setTests((c) => ({ ...c, [p.key]: { state: 'testing' } }));
    try {
      const result = await opsApi.testProvider(p.key);
      setTests((c) => ({ ...c, [p.key]: { state: 'done', result } }));
      void qc.invalidateQueries({ queryKey: opsKeys.settings });
    } catch (e) {
      setTests((c) => ({ ...c, [p.key]: { state: 'error', message: errorMessage(e, t) } }));
    }
  };
  const account = (p: PlatformProviderDto) => {
    const c = p.config;
    const label = ['account', 'label', 'merchant', 'domain', 'sender', 'clientId', 'mode'].map((k) => c[k]).filter((v) => typeof v === 'string' && v).join(' · ');
    return [label, p.secretSet ? t('adminSettings.provider.key.set') : t('adminSettings.provider.key.unset')].filter(Boolean).join(' · ');
  };
  const health = (p: PlatformProviderDto) => {
    const ts = tests[p.key];
    if (ts?.state === 'testing') return <StatePill state="info">{t('adminSettings.provider.test.testing')}</StatePill>;
    if (ts?.state === 'error') return <span className="text-[12px] text-accent-alert">{ts.message}</span>;
    if (ts?.state === 'done') {
      const r = ts.result;
      return (
        <span data-testid={`provider-test-${p.key}`} data-state={r.state}>
          <StatePill state={r.state === 'ok' ? 'ok' : 'incident'}>
            {t(`adminSettings.provider.test.${r.state}`, { ms: r.latencyMs })}
          </StatePill>
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatePill state={PROVIDER_STATE[p.status]}>
          {t(`adminSettings.provider.status.${p.status}`)}
          {p.lastError ? ` · ${p.lastError}` : ''}
        </StatePill>
        {p.warnings.map((w) => (
          <span key={w} className="ts-label-micro !normal-case text-accent-starred">
            {t.has(`adminSettings.provider.warning.${w}`) ? t(`adminSettings.provider.warning.${w}`) : w}
          </span>
        ))}
      </span>
    );
  };
  const columns: Column<PlatformProviderDto>[] = [
    { key: 'service', header: t('adminSettings.provider.col.service'), cell: (p) => t(`adminSettings.provider.${p.key}`), hideable: false },
    { key: 'account', header: t('adminSettings.provider.col.account'), cell: (p) => <span className="text-text-secondary">{account(p)}</span>, hideBelow: 'lg' },
    { key: 'health', header: t('adminSettings.provider.col.health'), cell: health },
  ];
  return (
    <OpsPanel title={t('adminSettings.provider.title')} sub={t('adminSettings.provider.sub')} data-testid="providers">
      <DataTable
        label={t('adminSettings.provider.title')}
        columns={columns}
        rows={providers}
        rowKey={(p) => p.key}
        density="compact"
        actionsLabel={t('action.actions')}
        rowActions={
          write.allowed
            ? (p) => (
                <ActionsMenu
                  iconOnly
                  label={t('action.actions')}
                  heading={t(`adminSettings.provider.${p.key}`)}
                  actions={[
                    { key: 'test', label: t('action.test'), onSelect: write.offline || tests[p.key]?.state === 'testing' ? undefined : () => void test(p), disabledReason: write.disabledReason },
                    { key: 'configure', label: t('action.configure'), onSelect: write.offline ? undefined : () => setEdit(p), disabledReason: write.disabledReason },
                  ].map((a) => (a.disabledReason ? { ...a, onSelect: undefined } : a))}
                />
              )
            : undefined
        }
      />
      <ProviderDialog provider={edit} onClose={() => setEdit(null)} />
    </OpsPanel>
  );
}

/* ---------- Limits & defaults ---------- */
function LimitsPanel({ value, onChange, error }: { value: LimitsForm; onChange: (v: LimitsForm) => void; error?: string }) {
  const t = useT();
  const write = useWrite('admin.settings.write');
  return (
    <OpsPanel title={t('adminSettings.limits.title')} data-testid="limits">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {LIMIT_FIELDS.map((f) => (
          <Field key={f} label={t(`adminSettings.limits.${f}`)} htmlFor={`limit-${f}`}>
            <NumberInput id={`limit-${f}`} value={value[f]} onValueChange={(v) => onChange({ ...value, [f]: v })} readOnly={!write.allowed} />
          </Field>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-accent-alert">
          {error}
        </p>
      ) : null}
    </OpsPanel>
  );
}

/* ---------- Product moderation policy (PV 22/10 PV2) ---------- */
function ModerationPolicyPanel({ value, onChange, error }: { value: boolean; onChange: (v: boolean) => void; error?: string }) {
  const t = useT();
  const write = useWrite('admin.settings.write');
  return (
    <OpsPanel title={t('adminSettings.moderation.title')} sub={t('adminSettings.moderation.sub')} data-testid="moderation-policy">
      <div className="flex items-start justify-between gap-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[14px]">{t('adminSettings.moderation.manualReviewAll')}</span>
          <span className="text-[12px] text-text-muted">{t('adminSettings.moderation.manualReviewAllHint')}</span>
        </span>
        <Switch checked={value} onCheckedChange={onChange} disabled={!write.allowed} label={t('adminSettings.moderation.manualReviewAll')} />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-accent-alert">
          {error}
        </p>
      ) : null}
    </OpsPanel>
  );
}
