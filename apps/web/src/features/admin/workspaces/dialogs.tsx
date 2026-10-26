'use client';
// ADM-02 dialogs — "DLG — Platform admin — dialogs catalogue": Suspendre « … », Ajouter des crédits, Libérer la page « … »,
// Créer un espace pour un client, Programmer la suppression de « … »; route map §3.5 (same pattern, not drawn as frames):
// Réactiver, Prolonger l'essai, Changer le plan, Niveau de confiance, Annuler la suppression, Se connecter en tant que.
// Every write carries the reason (≥ 10 chars → AuditLog.reason); server errors stay inline, content preserved.
import { PLATFORM_LIMITS_DEFAULTS, type AdminChannelRowDto, type AdminWorkspaceDetailDto, type AdminWorkspaceRowDto, type ImpersonationStartDto, type PlanAdminDto } from '@djaber/shared';
import { Checkbox, EmailInput, Field, Input, MonoChip, NumberInput, Select, toast } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { impersonation } from '@/lib/impersonation';
import { useT } from '@/lib/i18n';
import { useAdminSettings } from '../../admin-ops/api';
import { adminWrite, useAdminGet, useAdminInvalidate } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { useFormats } from '../ui';

type Ws = Pick<AdminWorkspaceRowDto, 'id' | 'name' | 'plan' | 'credits' | 'subscriptionStatus' | 'trustLevel'>;

/** Shared submit plumbing: pending flag, inline errors, invalidation of the workspace queries, success toast. */
function useAdminSubmit(onDone: () => void) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const run = async (fn: () => Promise<unknown>, known: readonly string[], success: string, codeToField?: Record<string, string>) => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync(fn);
      void invalidate('/admin/workspaces', '/admin/channels', '/admin/subscriptions', '/admin/audit-logs', '/admin/analytics');
      toast(success);
      onDone();
    } catch (e) {
      setErrors(toServerErrors(e, t, known, codeToField));
    }
  };
  return { run, errors, setErrors, pending: m.isPending };
}

const SUSPEND_REASONS = ['fraud', 'unpaid', 'content', 'owner_request', 'other'] as const;

export function SuspendDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<(typeof SUSPEND_REASONS)[number]>('fraud');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setReason('fraud');
    setNote('');
    setNotify(true);
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-suspend"
      title={t('admin.ws.suspend.title', { name: ws.name })}
      destructive
      submitLabel={t('admin.ws.action.suspend')}
      disabled={!reasonOk(note)}
      pending={s.pending}
      error={s.errors.form}
      note={t('admin.ws.suspend.note')}
      onSubmit={() => void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/suspend`, 'POST', { reason, note: note.trim(), notifyOwner: notify }), ['note', 'reason'], t('admin.ws.suspend.done'), { ADMIN_REASON_REQUIRED: 'note' })}
    >
      <MonoChip tone="danger" className="w-fit">{t('admin.common.destructive')}</MonoChip>
      <div role="radiogroup" aria-label={t('admin.ws.suspend.reasonLabel')} className="flex flex-col gap-2.5">
        {SUSPEND_REASONS.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="suspendReason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-white" />
            {t(`admin.ws.suspend.reason.${r}`)}
          </label>
        ))}
      </div>
      <ReasonField name="note" label={t('admin.ws.suspend.detail')} value={note} onChange={setNote} error={s.errors.fields.note ?? s.errors.fields.reason} placeholder={t('admin.ws.suspend.detailPlaceholder')} />
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {t('admin.ws.suspend.notify')}
      </label>
    </AdminDialog>
  );
}

/** Reason-only confirmations: Réactiver · Annuler la suppression. */
export function ReasonOnlyDialog({ ws, open, onClose, kind }: { ws: Ws | null; open: boolean; onClose: () => void; kind: 'reactivate' | 'cancel_deletion' }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const call = kind === 'reactivate' ? () => adminWrite(`/admin/workspaces/${ws.id}/reactivate`, 'POST', { reason: reason.trim() }) : () => adminWrite(`/admin/workspaces/${ws.id}/schedule-deletion`, 'DELETE', { reason: reason.trim() });
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId={`dlg-${kind}`}
      size="sm"
      title={t(`admin.ws.${kind}.title`, { name: ws.name })}
      context={t(`admin.ws.${kind}.context`)}
      submitLabel={t(`admin.ws.action.${kind}`)}
      disabled={!reasonOk(reason)}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(call, ['reason'], t(`admin.ws.${kind}.done`), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason} />
    </AdminDialog>
  );
}

const GRANT_TYPES = ['commercial', 'incident', 'manual_purchase'] as const;

export function CreditsDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const [credits, setCredits] = useState('');
  const [type, setType] = useState<(typeof GRANT_TYPES)[number]>('commercial');
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setCredits('');
    setType('commercial');
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const context = `${ws.name} · ${f.num(ws.credits.used)} / ${f.num(ws.credits.limit)}${ws.credits.exhausted ? ` (${t('admin.ws.credits.exhausted')})` : ''}`;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-credits"
      size="sm"
      title={t('admin.ws.credits.title')}
      context={context}
      submitLabel={t('admin.ws.credits.submit')}
      disabled={!Number(credits) || !reasonOk(reason)}
      pending={s.pending}
      error={s.errors.form}
      note={t('admin.ws.credits.note')}
      onSubmit={() =>
        void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/credits`, 'POST', { credits: Number(credits), type, reason: reason.trim() }, true), ['credits', 'reason'], t('admin.ws.credits.done', { count: Number(credits) }), { ADMIN_CREDIT_GRANT_LIMIT: 'credits', ADMIN_REASON_REQUIRED: 'reason' })
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('admin.ws.credits.amount')} required htmlFor="f-credits" error={s.errors.fields.credits}>
          <NumberInput id="f-credits" value={credits} onValueChange={setCredits} />
        </Field>
        <Field label={t('admin.ws.credits.type')} htmlFor="f-type">
          <Select id="f-type" value={type} onChange={(e) => setType(e.target.value as (typeof GRANT_TYPES)[number])}>
            {GRANT_TYPES.map((g) => (
              <option key={g} value={g}>
                {t(`admin.ws.credits.typeOpt.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ReasonField label={t('admin.ws.credits.reason')} value={reason} onChange={setReason} error={s.errors.fields.reason} />
    </AdminDialog>
  );
}

/** Tester report 22/10 UX-019: takes back plan credits granted by mistake (finance / super admin, reason, audited). */
export function RemoveCreditsDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFormats();
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setCredits('');
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const left = ws.credits.limit < 0 ? null : Math.max(0, ws.credits.limit - ws.credits.used);
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-credits-remove"
      size="sm"
      title={t('admin.ws.creditsRemove.title')}
      context={`${ws.name} · ${f.num(ws.credits.used)} / ${f.num(ws.credits.limit)}`}
      submitLabel={t('admin.ws.creditsRemove.submit')}
      disabled={!Number(credits) || !reasonOk(reason)}
      pending={s.pending}
      error={s.errors.form}
      note={t('admin.ws.creditsRemove.note')}
      onSubmit={() =>
        void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/credits/remove`, 'POST', { credits: Number(credits), reason: reason.trim() }, true), ['credits', 'reason'], t('admin.ws.creditsRemove.done', { count: Number(credits) }), { ADMIN_REASON_REQUIRED: 'reason' })
      }
    >
      <Field label={t('admin.ws.credits.amount')} required htmlFor="f-credits-remove" hint={left === null ? undefined : t('admin.ws.creditsRemove.available', { count: f.num(left) })} error={s.errors.fields.credits}>
        <NumberInput id="f-credits-remove" value={credits} onValueChange={setCredits} />
      </Field>
      <ReasonField label={t('admin.ws.credits.reason')} value={reason} onChange={setReason} error={s.errors.fields.reason} />
    </AdminDialog>
  );
}

export function ChangePlanDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const plans = useAdminGet<PlanAdminDto[]>(open ? '/admin/plans' : null);
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [when, setWhen] = useState<'now' | 'next_period'>('now');
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setPlanId('');
    setCycle('monthly');
    setWhen('now');
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const options = (plans.data ?? []).filter((p) => !p.archivedAt && p.slug !== ws.plan.slug);
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-plan"
      title={t('admin.ws.plan.title')}
      context={`${ws.name} · ${ws.plan.name}`}
      submitLabel={t('action.save')}
      disabled={!planId || !reasonOk(reason)}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/plan`, 'POST', { planId, cycle, when, reason: reason.trim() }), ['planId', 'reason'], t('admin.ws.plan.done'), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('admin.common.plan')} required htmlFor="f-plan" error={s.errors.fields.planId}>
          <Select id="f-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">—</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.common.cycle')} htmlFor="f-cycle">
          <Select id="f-cycle" value={cycle} onChange={(e) => setCycle(e.target.value as 'monthly' | 'yearly')}>
            <option value="monthly">{t('admin.common.cycleOpt.monthly')}</option>
            <option value="yearly">{t('admin.common.cycleOpt.yearly')}</option>
          </Select>
        </Field>
      </div>
      <div role="radiogroup" aria-label={t('admin.ws.plan.when')} className="flex flex-col gap-2.5">
        {(['now', 'next_period'] as const).map((w) => (
          <label key={w} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="when" checked={when === w} onChange={() => setWhen(w)} className="size-4 accent-white" />
            {t(`admin.ws.plan.whenOpt.${w}`)}
          </label>
        ))}
      </div>
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason} />
    </AdminDialog>
  );
}

export function ExtendDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [days, setDays] = useState<'7' | '30' | 'date'>('7');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setDays('7');
    setUntil('');
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const body = days === 'date' ? { until, reason: reason.trim() } : { days: Number(days), reason: reason.trim() };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-extend"
      size="sm"
      title={t('admin.ws.extend.title')}
      context={`${ws.name} · ${t(`enum.Subscription.status.${ws.subscriptionStatus}`)}`}
      submitLabel={t('admin.ws.extend.submit')}
      disabled={!reasonOk(reason) || (days === 'date' && !until)}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/extend`, 'POST', body), ['days', 'until', 'reason'], t('admin.ws.extend.done'), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <div role="radiogroup" aria-label={t('admin.ws.extend.title')} className="flex flex-col gap-2.5">
        {(['7', '30', 'date'] as const).map((d) => (
          <label key={d} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="extend" checked={days === d} onChange={() => setDays(d)} className="size-4 accent-white" />
            {t(`admin.ws.extend.opt.${d}`)}
          </label>
        ))}
      </div>
      {days === 'date' ? (
        <Field label={t('admin.ws.extend.until')} required htmlFor="f-until" error={s.errors.fields.until}>
          <Input id="f-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="[color-scheme:dark]" />
        </Field>
      ) : null}
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason ?? s.errors.fields.days} />
    </AdminDialog>
  );
}

export function ScheduleDeletionDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setReason('');
    setName('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-delete"
      title={t('admin.ws.delete.title', { name: ws.name })}
      context={t('admin.ws.delete.context')}
      destructive
      submitLabel={t('admin.ws.delete.submit')}
      disabled={!reasonOk(reason) || name.trim() !== ws.name}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/schedule-deletion`, 'POST', { confirmName: name.trim(), reason: reason.trim() }), ['reason', 'confirmName'], t('admin.ws.delete.done'), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <MonoChip tone="danger" className="w-fit">{t('admin.common.destructive')}</MonoChip>
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason} />
      <Field label={t('admin.ws.delete.typeName')} htmlFor="f-confirm" error={s.errors.fields.confirmName}>
        <Input id="f-confirm" value={name} onChange={(e) => setName(e.target.value)} placeholder={ws.name} autoComplete="off" />
      </Field>
    </AdminDialog>
  );
}

const TRUST = ['new', 'standard', 'trusted', 'watch'] as const;
export function TrustLevelDialog({ ws, open, onClose }: { ws: Ws | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [level, setLevel] = useState<(typeof TRUST)[number]>('standard');
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setLevel((ws?.trustLevel as (typeof TRUST)[number]) ?? 'standard');
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-trust"
      size="sm"
      title={t('admin.ws.trust.title')}
      context={`${ws.name} · ${t(`enum.Workspace.trustLevel.${ws.trustLevel}`)}`}
      submitLabel={t('action.apply')}
      disabled={!reasonOk(reason) || level === ws.trustLevel}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(() => adminWrite(`/admin/workspaces/${ws.id}/trust-level`, 'POST', { trustLevel: level, reason: reason.trim() }), ['trustLevel', 'reason'], t('admin.ws.trust.done'), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <div role="radiogroup" aria-label={t('admin.ws.trust.title')} className="flex flex-col gap-2.5">
        {TRUST.map((l) => (
          <label key={l} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="radio" name="trust" checked={level === l} onChange={() => setLevel(l)} className="size-4 accent-white" />
            {t(`enum.Workspace.trustLevel.${l}`)}
          </label>
        ))}
      </div>
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason} />
    </AdminDialog>
  );
}

/** "Libérer la page « … »" — forces the disconnection of the page in the workspace holding it (CHN-05, AT-CHN-08). */
export function ReleaseDialog({ channel, workspaceName, open, onClose }: { channel: Pick<AdminChannelRowDto, 'id' | 'name'> | null; workspaceName: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const s = useAdminSubmit(onClose);
  useOnOpen(open, () => {
    setReason('');
    s.setErrors(NO_ERRORS);
  });
  if (!channel) return null;
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-release"
      title={t('admin.ws.release.title', { name: channel.name })}
      context={t('admin.ws.release.context', { workspace: workspaceName })}
      destructive
      submitLabel={t('admin.ws.release.submit')}
      disabled={!reasonOk(reason)}
      pending={s.pending}
      error={s.errors.form}
      onSubmit={() => void s.run(() => adminWrite(`/admin/channels/${channel.id}/release`, 'POST', { reason: reason.trim() }), ['reason'], t('admin.ws.release.done'), { ADMIN_REASON_REQUIRED: 'reason' })}
    >
      <p className="ts-label-meta text-text-muted">{t('admin.ws.release.body', { workspace: workspaceName })}</p>
      <ReasonField value={reason} onChange={setReason} error={s.errors.fields.reason} placeholder={t('admin.ws.release.placeholder')} />
    </AdminDialog>
  );
}

/** "Se connecter en tant que" — read-only session of `impersonationMinutes` (platform settings), reason ≥ 10 chars (D21-bis; no mode selector exists). */
export function ImpersonateDialog({ ws, open, onClose, ticketId }: { ws: Pick<AdminWorkspaceRowDto, 'id' | 'name'> | null; open: boolean; onClose: () => void; ticketId?: string }) {
  const t = useT();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (body: unknown) => adminWrite<ImpersonationStartDto>('/admin/impersonation/sessions', 'POST', body) });
  const settings = useAdminSettings();
  const minutes = (settings.data?.settings.find((x) => x.key === 'limits')?.value as { impersonationMinutes?: number } | undefined)?.impersonationMinutes ?? PLATFORM_LIMITS_DEFAULTS.impersonationMinutes;
  useOnOpen(open, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  if (!ws) return null;
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const r = await m.mutateAsync({ workspaceId: ws.id, reason: reason.trim(), ...(ticketId ? { ticketId } : {}) });
      impersonation.start({ sessionId: r.sessionId, token: r.token, expiresAt: r.expiresAt, workspaceId: r.workspace?.id ?? ws.id, workspaceName: r.workspace?.name ?? ws.name });
      onClose();
      router.push('/home');
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-impersonate"
      title={t('admin.ws.impersonate.title', { name: ws.name })}
      context={t('admin.ws.impersonate.context', { minutes })}
      submitLabel={t('admin.ws.impersonate.submit')}
      disabled={!reasonOk(reason)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      <ul className="flex flex-col gap-1 rounded-card border border-accent-alert/40 p-3 text-[13px] text-text-secondary">
        <li>• {t('admin.ws.impersonate.rule.reason')}</li>
        <li>• {t('admin.ws.impersonate.rule.mode')}</li>
        <li>• {t('admin.ws.impersonate.rule.duration', { name: ws.name, minutes })}</li>
        <li>• {t('admin.ws.impersonate.rule.forbidden')}</li>
      </ul>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

export type CreateWorkspaceResult = AdminWorkspaceDetailDto;
const TRIAL_MONTHS = [0, 1, 2, 3, 6, 12] as const;

export function CreateWorkspaceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ws: CreateWorkspaceResult) => void }) {
  const t = useT();
  const plans = useAdminGet<PlanAdminDto[]>(open ? '/admin/plans' : null);
  const invalidate = useAdminInvalidate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [planSlug, setPlanSlug] = useState('');
  const [months, setMonths] = useState(1);
  const [credits, setCredits] = useState('');
  const [invite, setInvite] = useState(true);
  const [assisted, setAssisted] = useState(false);
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (body: unknown) => adminWrite<CreateWorkspaceResult>('/admin/workspaces', 'POST', body, true) });
  useOnOpen(open, () => {
    setName('');
    setEmail('');
    setPlanSlug('');
    setMonths(1);
    setCredits('');
    setInvite(true);
    setAssisted(false);
    setErrors(NO_ERRORS);
  });
  const options = (plans.data ?? []).filter((p) => !p.archivedAt);
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      const ws = await m.mutateAsync({
        name: name.trim(),
        ownerEmail: email.trim(),
        ...(planSlug ? { planSlug } : {}),
        trialMonths: months,
        ...(credits ? { initialCredits: Number(credits) } : {}),
        sendInvite: invite,
        assistedOnboarding: assisted,
        reason: t('admin.ws.create.auditReason'),
      });
      void invalidate('/admin/workspaces', '/admin/users', '/admin/analytics');
      toast(t('admin.ws.create.done', { name: ws.name }));
      onClose();
      onCreated(ws);
    } catch (e) {
      setErrors(toServerErrors(e, t, ['name', 'ownerEmail', 'planSlug', 'trialMonths', 'initialCredits']));
    }
  };
  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      testId="dlg-create-ws"
      title={t('admin.ws.create.title')}
      context={t('admin.ws.create.context')}
      submitLabel={t('admin.ws.create.submit')}
      disabled={!name.trim() || !email.trim()}
      pending={m.isPending}
      error={errors.form}
      note={t('admin.ws.create.note')}
      onSubmit={() => void submit()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.ws.create.name')} required htmlFor="f-wsname" error={errors.fields.name}>
          <Input id="f-wsname" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.ws.create.email')} required htmlFor="f-wsemail" error={errors.fields.ownerEmail}>
          <EmailInput id="f-wsemail" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.common.plan')} htmlFor="f-wsplan" error={errors.fields.planSlug}>
          <Select id="f-wsplan" value={planSlug} onChange={(e) => setPlanSlug(e.target.value)}>
            <option value="">—</option>
            {options.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.ws.create.months')} htmlFor="f-wsmonths" error={errors.fields.trialMonths}>
          <Select id="f-wsmonths" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {TRIAL_MONTHS.map((n) => (
              <option key={n} value={n}>
                {t('admin.ws.create.monthsOpt', { count: n })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.ws.create.credits')} htmlFor="f-wscredits" error={errors.fields.initialCredits}>
          <NumberInput id="f-wscredits" value={credits} onValueChange={setCredits} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <Checkbox checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        {t('admin.ws.create.invite')}
      </label>
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <Checkbox checked={assisted} onChange={(e) => setAssisted(e.target.checked)} />
        {t('admin.ws.create.assisted')}
      </label>
    </AdminDialog>
  );
}
