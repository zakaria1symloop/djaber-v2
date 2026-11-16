'use client';
// ADM-03 row menu (Figma "ADM-03 — Platform admin — users"): Ouvrir la fiche · Renvoyer l'e-mail de vérification
// (cooldown 10 min) · Réinitialiser le mot de passe · Désactiver la 2FA · Déconnecter toutes les sessions · Promouvoir
// support / super admin (2FA) · Bloquer / Débloquer (AUTH_USER_BLOCKED) · Programmer la suppression (RGPD,
// ACCOUNT_OWNS_WORKSPACE). Items from the server descriptors; reason dialog for each write.
import type { AdminUserRowDto } from '@djaber/shared';
import { toast, type MenuAction } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toMenuActions } from '@/lib/actions';
import { useT } from '@/lib/i18n';
import { adminWrite, useAdminInvalidate } from '../api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '../dialog-kit';
import { usePlatform } from '../platform';
import { withAdminReasons } from '../reasons';
import { ChangeRoleDialog } from '../team/dialogs';
import { fullName } from '../ui';

export type UserAction = 'resend_verification' | 'reset_password' | 'disable_2fa' | 'revoke_sessions' | 'block' | 'unblock' | 'schedule_deletion';
const PATH: Record<UserAction, { path: string; method: 'POST' | 'DELETE' }> = {
  resend_verification: { path: 'resend-verification', method: 'POST' },
  reset_password: { path: 'reset-password', method: 'POST' },
  disable_2fa: { path: 'disable-2fa', method: 'POST' },
  revoke_sessions: { path: 'revoke-sessions', method: 'POST' },
  block: { path: 'block', method: 'POST' },
  unblock: { path: 'unblock', method: 'POST' },
  schedule_deletion: { path: '', method: 'DELETE' },
};
const DESTRUCTIVE: UserAction[] = ['block', 'schedule_deletion'];

function UserActionDialog({ user, action, onClose }: { user: AdminUserRowDto | null; action: UserAction | null; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: ({ id, a, body }: { id: string; a: UserAction; body: unknown }) => adminWrite(`/admin/users/${id}${PATH[a].path ? `/${PATH[a].path}` : ''}`, PATH[a].method, body) });
  useOnOpen(!!action, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  if (!user || !action) return null;
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ id: user.id, a: action, body: { reason: reason.trim() } });
      void invalidate('/admin/users', '/admin/deletion-requests', '/admin/audit-logs');
      toast(t(`admin.users.${action}.done`));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog
      open
      onClose={onClose}
      testId={`dlg-user-${action}`}
      size="sm"
      title={t(`admin.users.action.${action}`)}
      context={`${fullName(user)} · ${user.email}`}
      note={t(`admin.users.${action}.note`)}
      destructive={DESTRUCTIVE.includes(action)}
      submitLabel={t(`admin.users.${action}.submit`)}
      disabled={!reasonOk(reason)}
      pending={m.isPending}
      error={errors.form}
      onSubmit={() => void submit()}
    >
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

export function useUserActions({ openSheet }: { openSheet: (id: string) => void }) {
  const t = useT();
  const { can } = usePlatform();
  const [state, setState] = useState<{ action: UserAction; user: AdminUserRowDto } | null>(null);
  const [promote, setPromote] = useState<AdminUserRowDto | null>(null);
  const write = can('admin.users.write');
  const on = (action: UserAction, user: AdminUserRowDto) => () => setState({ action, user });
  const menu = (u: AdminUserRowDto, o: { sheet?: boolean } = {}): MenuAction[] =>
    withAdminReasons(toMenuActions(
      u.actions,
      {
        open: { label: t('admin.users.action.open'), onSelect: () => openSheet(u.id), hidden: o.sheet, local: true },
        resend_verification: { label: t('admin.users.action.resend_verification'), onSelect: on('resend_verification', u), hidden: !write },
        reset_password: { label: t('admin.users.action.reset_password'), onSelect: on('reset_password', u), hidden: !write },
        disable_2fa: { label: t('admin.users.action.disable_2fa'), onSelect: on('disable_2fa', u), hidden: !write },
        revoke_sessions: { label: t('admin.users.action.revoke_sessions'), onSelect: on('revoke_sessions', u), hidden: !write },
        promote: { label: t('admin.users.action.promote'), onSelect: () => setPromote(u), hidden: !can('admin.team.write') },
        block: { label: t('admin.users.action.block'), onSelect: on('block', u), destructive: true, hidden: !write, separated: true },
        unblock: { label: t('admin.users.action.unblock'), onSelect: on('unblock', u), hidden: !write, separated: true },
        schedule_deletion: { label: t('admin.users.action.schedule_deletion'), onSelect: on('schedule_deletion', u), destructive: true, hidden: !write },
      },
      t,
    ), u.actions, t, { workspace: u.workspaces.find((w) => w.role === 'owner')?.name ?? u.workspaces[0]?.name });
  const dialogs = (
    <>
      <UserActionDialog user={state?.user ?? null} action={state?.action ?? null} onClose={() => setState(null)} />
      <ChangeRoleDialog user={promote ? { id: promote.id, name: fullName(promote), platformRole: promote.platformRole } : null} open={!!promote} onClose={() => setPromote(null)} />
    </>
  );
  return { menu, open: (action: UserAction, user: AdminUserRowDto) => setState({ action, user }), dialogs };
}
