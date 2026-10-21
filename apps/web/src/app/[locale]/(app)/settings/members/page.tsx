'use client';
// /settings/members — Figma "SET — Settings — Members & invitations" + DLG "Inviter un membre", "Transférer la propriété".
import { zodResolver } from '@hookform/resolvers/zod';
import { InviteMemberSchema, type InviteMemberInput } from '@djaber/shared';
import {
  ActionsMenu,
  Avatar,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmailInput,
  Field,
  FormAlert,
  Input,
  PasswordInput,
  Pill,
  SectionLabel,
  Select,
  toast,
  type MenuAction,
  type Tone,
} from '@djaber/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ListEmpty, ListLoading, QueryError } from '@/components/global-states';
import { SettingsPage } from '@/features/settings/common';
import { Link } from '@/i18n/navigation';
import { invitationsKey, membersKey, useInvitations, useMembers, workspaceApi } from '@/features/workspace/api';
import { SectionAccess } from '@/features/workspace/section-access';
import { ApiError } from '@/lib/api';
import type { InvitationDto, MemberDto } from '@/lib/contracts';
import { formatClock, retryAfterSeconds, secondsUntilIso, useCountdown } from '@/lib/countdown';
import { applyServerErrors, errorMessage, fieldError } from '@/lib/forms';
import { useLocaleCode, useT } from '@/lib/i18n';
import { meKey, useSession, useWorkspaceId, workspaceKey } from '@/lib/session';
import { daysUntil, relativeTime } from '@/lib/time';

const ROLE_TONE: Record<MemberDto['role'], Tone> = { owner: 'success', admin: 'violet', operator: 'info' };
const fullName = (m: MemberDto) => `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email;

export default function MembersPage() {
  const t = useT();
  const { workspace, can, me } = useSession();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const canWrite = can('members.write');
  const canTransfer = can('workspace.transfer');
  const members = useMembers();
  const invitations = useInvitations(true);
  const [dialog, setDialog] = useState<{ kind: 'invite' } | { kind: 'roles' } | { kind: 'transfer' } | { kind: 'remove'; member: MemberDto } | { kind: 'demote'; member: MemberDto } | null>(null);
  const role = useMutation({ mutationFn: (v: { id: string; role: 'admin' | 'operator' }) => workspaceApi.updateMember(v.id, { role: v.role }) });
  const remove = useMutation({ mutationFn: workspaceApi.removeMember });
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: membersKey(ws) }), qc.invalidateQueries({ queryKey: invitationsKey(ws) }), qc.invalidateQueries({ queryKey: workspaceKey(ws) })]);
  const changeRole = async (m: MemberDto, next: 'admin' | 'operator') => {
    try {
      await role.mutateAsync({ id: m.id, role: next });
      await refresh();
      setDialog(null);
      toast(t('settings.members.roleChanged', { name: fullName(m), role: t(`enum.Membership.role.${next}`) }));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };

  const plan = workspace?.plan;
  const max = plan?.limits.maxMembers ?? -1;
  const count = members.data?.length ?? plan?.usage.members ?? 0;
  const pending = invitations.data?.length ?? 0;
  // inviting at the plan limit is refused (403 PLAN_LIMIT, 02 §plan limits): the buttons say so and lead to the plans
  const atLimit = max !== -1 && count + pending >= max;
  const limitReason = atLimit ? t('settings.members.invite.limitReason', { count: count + pending, max }) : undefined;
  const admins = (members.data ?? []).filter((m) => m.role === 'admin');

  const actionsOf = (m: MemberDto): MenuAction[] => {
    const immutable = t('error.OWNER_IMMUTABLE');
    if (m.role === 'owner') {
      // the owner row: the only possible change is the transfer, by the owner
      return canTransfer && m.user.id === me?.id
        ? [{ key: 'transfer', label: t('dialog.transferOwnership.title'), primary: true, onSelect: () => setDialog({ kind: 'transfer' }), disabledReason: admins.length ? undefined : t('error.OWNERSHIP_TRANSFER_TARGET_INVALID') }]
        : canWrite
          ? [
              { key: 'role', label: t('settings.members.changeRole'), disabledReason: immutable },
              { key: 'remove', label: t('action.remove'), destructive: true, disabledReason: immutable },
            ]
          : [];
    }
    if (!canWrite) return [];
    return [
      m.role === 'operator'
        ? { key: 'admin', label: t('settings.members.makeAdmin'), primary: true, onSelect: () => void changeRole(m, 'admin') }
        : { key: 'operator', label: t('settings.members.makeOperator'), primary: true, onSelect: () => setDialog({ kind: 'demote', member: m }) },
      { key: 'remove', label: t('action.remove'), destructive: true, onSelect: () => (setRemoveError(null), setDialog({ kind: 'remove', member: m })) },
    ];
  };

  return (
    <SettingsPage
      title={t('settings.members.title')}
      description={
        members.data
          ? t('settings.members.summary', { count, max: max === -1 ? '∞' : max, plan: plan?.name ?? '—', pending })
          : undefined
      }
      permission="members.read"
      actions={
        <>
          <Button variant="ghost" onClick={() => setDialog({ kind: 'roles' })}>
            {t('settings.members.seeRoles')}
          </Button>
          {canWrite && atLimit && can('billing.plan') ? (
            <Link href="/settings/billing" className="text-[13px] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline" data-testid="members-change-plan">
              {t('settings.members.invite.changePlan')}
            </Link>
          ) : null}
          {canWrite ? (
            <Button variant="primary" onClick={() => setDialog({ kind: 'invite' })} disabledReason={limitReason} data-testid="members-invite">
              {t('dialog.inviteMember.title')}
            </Button>
          ) : null}
        </>
      }
    >
      <SectionLabel>{t('settings.members.list')}</SectionLabel>
      {members.isPending ? (
        <Card>
          <ListLoading rows={3} columns={3} />
        </Card>
      ) : members.isError ? (
        <QueryError error={members.error} onRetry={() => members.refetch()} />
      ) : members.data.length === 0 ? (
        <ListEmpty title={t('settings.members.empty')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line-hairline" data-testid="members">
            {members.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-member={m.user.email}>
                <Avatar name={fullName(m)} src={m.user.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">
                    {fullName(m)}
                    {m.user.id === me?.id ? ` ${t('settings.members.you')}` : ''}
                  </div>
                  <div className="ts-label-meta truncate text-text-muted">
                    <bdi dir="ltr">{m.user.email}</bdi> · {m.readOnly ? t('settings.members.readOnlyHint') : t(`settings.members.roleHint.${m.role}`)}
                  </div>
                </div>
                {m.readOnly ? <Pill tone="warning">{t('settings.members.readOnlyPill')}</Pill> : null}
                <Pill tone={ROLE_TONE[m.role]}>{t(`enum.Membership.role.${m.role}`)}</Pill>
                <ActionsMenu label={t('action.actions')} actions={actionsOf(m)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {members.data?.length ? <SectionAccess members={members.data} canWrite={canWrite} onSaved={() => Promise.all([refresh(), qc.invalidateQueries({ queryKey: meKey })])} /> : null}

      <SectionLabel className="mt-3">{t('settings.members.pending')}</SectionLabel>
      {invitations.isPending ? (
        <Card>
          <ListLoading rows={1} columns={3} />
        </Card>
      ) : invitations.isError ? (
        <QueryError error={invitations.error} onRetry={() => invitations.refetch()} />
      ) : invitations.data.length === 0 ? (
        <ListEmpty
          title={t('settings.members.noInvitation')}
          action={canWrite && !atLimit ? { label: t('dialog.inviteMember.title'), onClick: () => setDialog({ kind: 'invite' }), variant: 'secondary' } : undefined}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line-hairline" data-testid="invitations">
            {invitations.data.map((i) => (
              <InvitationRow key={i.id} invitation={i} canWrite={canWrite} onChanged={refresh} />
            ))}
          </ul>
        </Card>
      )}

      <InviteDialog open={dialog?.kind === 'invite'} atLimit={atLimit} count={count + pending} max={max} canChangePlan={can('billing.plan')} onClose={() => setDialog(null)} onDone={refresh} />
      <RolesDialog open={dialog?.kind === 'roles'} onClose={() => setDialog(null)} />
      <TransferDialog
        open={dialog?.kind === 'transfer'}
        admins={admins}
        onClose={() => setDialog(null)}
        onDone={async () => {
          await Promise.all([refresh(), qc.invalidateQueries({ queryKey: meKey })]);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'demote'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('settings.members.demote.title', { name: dialog?.kind === 'demote' ? fullName(dialog.member) : '' })}
        description={t('settings.members.roles.operator')}
        confirmLabel={t('settings.members.makeOperator')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        loading={role.isPending}
        onConfirm={() => {
          if (dialog?.kind === 'demote') void changeRole(dialog.member, 'operator');
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('settings.members.remove.title', { name: dialog?.kind === 'remove' ? fullName(dialog.member) : '' })}
        description={t('settings.members.remove.description')}
        confirmLabel={t('action.remove')}
        cancelLabel={t('action.cancel')}
        closeLabel={t('action.close')}
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (dialog?.kind !== 'remove') return;
          setRemoveError(null);
          try {
            await remove.mutateAsync(dialog.member.id);
            await refresh();
            setDialog(null);
            toast(t('settings.members.removed'));
          } catch (e) {
            // shown inside the dialog, which stays open
            setRemoveError(errorMessage(e, t));
          }
        }}
      >
        {removeError ? <FormAlert>{removeError}</FormAlert> : null}
      </ConfirmDialog>
    </SettingsPage>
  );
}

function InvitationRow({ invitation: i, canWrite, onChanged }: { invitation: InvitationDto; canWrite: boolean; onChanged: () => Promise<unknown> }) {
  const t = useT();
  const locale = useLocaleCode();
  const [until, setUntil] = useState<number | null>(() => Date.now() + secondsUntilIso(i.resendAvailableAt) * 1000);
  useEffect(() => setUntil(Date.now() + secondsUntilIso(i.resendAvailableAt) * 1000), [i.resendAvailableAt]);
  const cooldown = useCountdown(until);
  const resend = useMutation({ mutationFn: workspaceApi.resendInvitation });
  const revoke = useMutation({ mutationFn: workspaceApi.revokeInvitation });
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const onResend = async () => {
    try {
      await resend.mutateAsync(i.id);
      toast(t('settings.members.invitationResent', { email: i.email }));
      setUntil(Date.now() + 60_000);
      await onChanged();
    } catch (e) {
      const wait = retryAfterSeconds(e, 60);
      if (wait > 0) setUntil(Date.now() + wait * 1000);
      else toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const onRevoke = async () => {
    try {
      await revoke.mutateAsync(i.id);
      setConfirmRevoke(false);
      await onChanged();
      toast(t('settings.members.invitationRevoked'));
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-invitation={i.email}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">
          <bdi dir="ltr">{i.email}</bdi>
        </div>
        <div className="ts-label-meta uppercase text-text-muted">
          {t(`enum.Membership.role.${i.role}`)} · {t('settings.members.sent', { ago: relativeTime(i.sentAt, locale) })} · {t('settings.members.expiresIn', { days: daysUntil(i.expiresAt) })}
        </div>
      </div>
      {canWrite ? (
        <>
          <Button variant="ghost" onClick={onResend} loading={resend.isPending} disabled={cooldown > 0}>
            {cooldown > 0 ? t('settings.members.resendIn', { time: formatClock(cooldown) }) : t('action.resend')}
          </Button>
          <Button onClick={() => setConfirmRevoke(true)} loading={revoke.isPending} className="border-accent-alert/60 text-accent-alert" data-testid="invitation-revoke">
            {t('action.revoke')}
          </Button>
          <ConfirmDialog
            open={confirmRevoke}
            onOpenChange={setConfirmRevoke}
            title={t('settings.members.revoke.title', { email: i.email })}
            description={t('settings.members.revoke.description')}
            confirmLabel={t('action.revoke')}
            cancelLabel={t('action.cancel')}
            closeLabel={t('action.close')}
            destructive
            loading={revoke.isPending}
            onConfirm={() => void onRevoke()}
          />
        </>
      ) : null}
    </li>
  );
}

function InviteDialog({ open, atLimit, count, max, canChangePlan, onClose, onDone }: { open: boolean; atLimit: boolean; count: number; max: number; canChangePlan: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const t = useT();
  const form = useForm<InviteMemberInput>({ resolver: zodResolver(InviteMemberSchema), defaultValues: { email: '', role: 'operator' } });
  const [formError, setFormError] = useState<string | null>(null);
  const invite = useMutation({ mutationFn: workspaceApi.invite });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset();
      setFormError(null);
    }
  }, [open, reset]);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await invite.mutateAsync(values);
      await onDone();
      toast(t('settings.members.invited', { email: values.email }));
      onClose();
    } catch (e) {
      // MEMBER_ALREADY_EXISTS / INVITATION_PENDING: inline under the e-mail, the dialog keeps its content
      const inline = e instanceof ApiError && (e.code === 'MEMBER_ALREADY_EXISTS' || e.code === 'INVITATION_PENDING');
      setFormError(applyServerErrors(form, e, t, { fields: inline ? [] : ['email', 'role'], codeToField: { MEMBER_ALREADY_EXISTS: 'email', INVITATION_PENDING: 'email' } }));
    }
  });
  const busy = invite.isPending;
  const errors = form.formState.errors;
  const role = form.watch('role');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.inviteMember.title')}
      description={max === -1 ? undefined : t('settings.members.invite.context', { count, max })}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="invite-form" loading={busy} disabledReason={atLimit ? t('settings.members.invite.limitReason', { count, max }) : undefined}>
            {t('settings.members.invite.submit')}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label={t('common.email')} htmlFor="invite-email" required error={fieldError(t, errors.email?.message)}>
          <EmailInput id="invite-email" autoComplete="off" placeholder={t('settings.members.invite.placeholder')} disabled={busy} aria-invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <fieldset className="flex flex-col gap-3" disabled={busy}>
          <legend className="sr-only">{t('settings.members.invite.role')}</legend>
          {(['operator', 'admin'] as const).map((r) => (
            <label key={r} className="flex cursor-pointer items-start gap-3">
              <input type="radio" value={r} checked={role === r} className="mt-1 size-4 accent-white" {...form.register('role')} />
              <span>
                <span className="block text-[14px]">{t(`enum.Membership.role.${r}`)}</span>
                <span className="ts-label-meta block text-text-muted">{t(`settings.members.roleHint.${r}`)}</span>
              </span>
            </label>
          ))}
          <div className="flex items-start gap-3 opacity-50">
            <input type="radio" disabled className="mt-1 size-4" aria-label={t('enum.Membership.role.owner')} />
            <span>
              <span className="block text-[14px]">{t('enum.Membership.role.owner')}</span>
              <span className="ts-label-meta block text-text-muted">{t('settings.members.invite.ownerHint')}</span>
            </span>
          </div>
        </fieldset>
        {atLimit ? (
          <FormAlert tone="warning">
            {t('settings.members.invite.limit', { count, max })}{' '}
            {canChangePlan ? (
              <Link href="/settings/billing" className="underline underline-offset-2">
                {t('settings.members.invite.changePlan')}
              </Link>
            ) : null}
          </FormAlert>
        ) : null}
        <p className="ts-label-meta text-text-muted">{t('settings.members.invite.note')}</p>
        {formError ? <FormAlert>{formError}</FormAlert> : null}
      </form>
    </Dialog>
  );
}

function RolesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('settings.members.roles.title')}
      closeLabel={t('action.close')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('action.close')}
        </Button>
      }
    >
      <dl className="flex flex-col gap-3">
        {(['owner', 'admin', 'operator'] as const).map((r) => (
          <div key={r} className="rounded-card bg-ink-raised px-3 py-2.5">
            <dt className="ts-label-meta uppercase text-text-muted">{t(`enum.Membership.role.${r}`)}</dt>
            <dd className="mt-1 text-[13px] text-text-secondary">{t(`settings.members.roles.${r}`)}</dd>
          </div>
        ))}
      </dl>
      <Banner tone="info" className="mt-4">
        {t('settings.members.roles.single')}
      </Banner>
    </Dialog>
  );
}

function TransferDialog({ open, admins, onClose, onDone }: { open: boolean; admins: MemberDto[]; onClose: () => void; onDone: () => Promise<unknown> }) {
  const t = useT();
  const { me, workspaceId } = useSession();
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [errors, setErrors] = useState<{ target?: string; password?: string; totp?: string; form?: string }>({});
  const transfer = useMutation({ mutationFn: (b: { newOwnerUserId: string; password: string; totpCode?: string }) => workspaceApi.transferOwnership(workspaceId ?? '', b) });
  const first = admins[0]?.user.id ?? '';
  useEffect(() => {
    if (open) {
      setTarget(first);
      setPassword('');
      setTotp('');
      setErrors({});
    }
  }, [open, first]);

  const submit = async () => {
    setErrors({});
    try {
      await transfer.mutateAsync({ newOwnerUserId: target, password, ...(me?.totpEnabled ? { totpCode: totp.trim() } : {}) });
      await onDone();
      toast(t('settings.members.transfer.done'));
      onClose();
    } catch (e) {
      const message = errorMessage(e, t);
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'OWNERSHIP_TRANSFER_TARGET_INVALID') setErrors({ target: message });
      else if (code === 'AUTH_INVALID_CREDENTIALS' || code === 'AUTH_CURRENT_PASSWORD_INCORRECT') setErrors({ password: message });
      else if (code === 'TWO_FA_CONFIRMATION_REQUIRED' || code === 'AUTH_2FA_INVALID') setErrors({ totp: message });
      else setErrors({ form: message });
    }
  };
  const busy = transfer.isPending;
  const targetName = admins.find((a) => a.user.id === target);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('dialog.transferOwnership.title')}
      description={targetName ? t('settings.members.transfer.context', { name: fullName(targetName) }) : undefined}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!target || !password || (me?.totpEnabled && totp.trim().length < 6)}>
            {t('settings.members.transfer.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Pill tone="danger">{t('common.destructive')}</Pill>
        </div>
        <p className="ts-label-meta text-text-muted">{t('settings.members.transfer.note')}</p>
        <Field label={t('settings.members.transfer.target')} htmlFor="transfer-target" error={errors.target}>
          <Select id="transfer-target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy} aria-invalid={!!errors.target}>
            {admins.map((a) => (
              <option key={a.user.id} value={a.user.id}>
                {fullName(a)} — {a.user.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.password')} htmlFor="transfer-password" error={errors.password}>
          <PasswordInput
            id="transfer-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={!!errors.password}
            showLabel={t('auth.password.show')}
            hideLabel={t('auth.password.hide')}
          />
        </Field>
        {me?.totpEnabled ? (
          <Field label={t('settings.twofa.code')} htmlFor="transfer-totp" error={errors.totp}>
            <Input id="transfer-totp" inputMode="numeric" dir="ltr" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} disabled={busy} aria-invalid={!!errors.totp} />
          </Field>
        ) : null}
        {errors.form ? <FormAlert>{errors.form}</FormAlert> : null}
      </div>
    </Dialog>
  );
}
