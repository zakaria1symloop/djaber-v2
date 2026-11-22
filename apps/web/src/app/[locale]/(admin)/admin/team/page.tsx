'use client';
// /admin/team — Figma "ADM-16 — Platform admin — admin roles & account deletion requests" + DLG "Changer le rôle
// plateforme" / "Inviter un membre plateforme". Role matrix (computed from PLATFORM_PERMISSIONS, the same table as the
// API), members (2FA NON ⚠ accès bloqué → Forcer la 2FA), pending invitations, account deletion requests (EN GRÂCE /
// BLOQUÉE ACCOUNT_OWNS_WORKSPACE + WORKSPACE_HAS_DEBT / ANONYMISÉ) with Voir · Annuler · Résoudre · Traiter maintenant,
// then the end customers' data deletions (MSG-08: Meta callback + e-mail requests, « Nouvelle demande », URL keys `dd.*`).
import { PLATFORM_PERMISSIONS, type AdminDeletionCounts, type DeletionRequestAdminDto, type PlatformMemberDto, type PlatformPermission, type PlatformTeamDto } from '@djaber/shared';
import { ActionsMenu, Button, DataTable, FrameNote, ListSkeleton, MonoChip, OpsPanel, RoleMatrix, toast, type Column } from '@djaber/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirmAction } from '@/components/confirm-action';
import { ListPagination } from '@/features/catalog/ui';
import { AdminPage, AdminQueryError } from '@/features/admin/admin-page';
import { adminWrite, useAdminGet, useAdminInvalidate, useAdminList } from '@/features/admin/api';
import { AdminDialog, NO_ERRORS, ReasonField, reasonOk, toServerErrors, useOnOpen, type ServerErrors } from '@/features/admin/dialog-kit';
import { usePlatform } from '@/features/admin/platform';
import { DELETION_LIST } from '@/features/admin/specs';
import { DataDeletionSection } from '@/features/admin/team/data-deletion';
import { ChangeRoleDialog, InviteMemberDialog } from '@/features/admin/team/dialogs';
import { AdminPill, fullName, useFormats } from '@/features/admin/ui';
import { useRouter } from '@/i18n/navigation';
import { toMenuActions } from '@/lib/actions';
import { errorMessage } from '@/lib/forms';
import { useT } from '@/lib/i18n';
import { useListState } from '@/lib/use-list-state';

const ROLES = ['super_admin', 'support', 'moderator', 'finance', 'read'] as const;
const MATRIX: { key: string; perm: PlatformPermission }[] = [
  { key: 'view', perm: 'admin.workspaces.read' },
  { key: 'impersonate', perm: 'admin.workspaces.impersonate' },
  { key: 'suspend', perm: 'admin.workspaces.write' },
  { key: 'moderation', perm: 'admin.moderation.write' },
  { key: 'support', perm: 'admin.support.write' },
  { key: 'billing', perm: 'admin.billing.write' },
  { key: 'creditsSmall', perm: 'admin.workspaces.credits' },
  { key: 'creditsLarge', perm: 'admin.billing.write' },
  { key: 'providers', perm: 'admin.settings.write' },
  { key: 'cms', perm: 'admin.cms.write' },
  { key: 'audit', perm: 'admin.audit.read' },
  { key: 'roles', perm: 'admin.team.write' },
];
type DelAction = 'cancel' | 'resolve' | 'process_now';

export default function AdminTeamPage() {
  const t = useT();
  const confirm = useConfirmAction();
  const f = useFormats();
  const router = useRouter();
  const { can, userId } = usePlatform();
  const team = useAdminGet<PlatformTeamDto>('/admin/platform-members');
  const list = useListState(DELETION_LIST);
  const deletions = useAdminList<DeletionRequestAdminDto, { counts?: AdminDeletionCounts }>('/admin/deletion-requests', list.apiQuery(), { enabled: can('admin.deletion.read') });
  const invalidate = useAdminInvalidate();
  const [invite, setInvite] = useState(false);
  const [role, setRole] = useState<PlatformMemberDto | null>(null);
  const [del, setDel] = useState<{ req: DeletionRequestAdminDto; action: DelAction } | null>(null);
  const [force2fa, setForce2fa] = useState<PlatformMemberDto | null>(null);
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn() });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await m.mutateAsync(fn);
      void invalidate('/admin/platform-members', '/admin/invitations');
      toast(done);
    } catch (e) {
      toast({ tone: 'danger', message: errorMessage(e, t) });
    }
  };
  const write = can('admin.team.write');
  const memberColumns: Column<PlatformMemberDto>[] = [
    { key: 'name', header: t('admin.team.col.member'), hideable: false, cell: (mb) => `${fullName(mb)}${mb.userId === userId ? ` (${t('admin.team.you')})` : ''}` },
    { key: 'email', header: t('admin.team.col.email'), cell: (mb) => <span dir="ltr">{mb.email}</span> },
    { key: 'role', header: t('admin.team.col.role'), cell: (mb) => <MonoChip tone={mb.platformRole === 'super_admin' ? 'danger' : 'neutral'}>{t(`admin.shell.role.${mb.platformRole}`)}</MonoChip> },
    // ADMIN-12: « accès bloqué » only when the rule is enforced (server `accessBlocked`); during the owner's dated pause the day
    // it applies from, for a test exemption « exempté »
    {
      key: '2fa',
      header: '2FA',
      cell: (mb) =>
        mb.totpEnabled ? (
          t('admin.common.yes')
        ) : (
          <span className="text-accent-alert">{mb.accessBlocked ? t('admin.team.noTwoFa') : mb.twoFaRequiredFrom ? t('admin.team.noTwoFaFrom', { date: f.date(mb.twoFaRequiredFrom) }) : t('admin.team.noTwoFaExempt')}</span>
        ),
    },
    { key: 'last', header: t('admin.team.col.lastAction'), hideBelow: 'lg', cell: (mb) => (mb.lastAction ? `${f.ago(mb.lastAction.at)} · ${mb.lastAction.action}` : '—') },
  ];
  const memberMenu = (mb: PlatformMemberDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={fullName(mb)}
      actions={toMenuActions(
        mb.actions,
        {
          edit: { label: t('admin.team.action.change_role'), onSelect: () => setRole(mb), hidden: !write },
          // full-test 15/11 ADMIN-03: a confirmation with a reason, never one click
          force_2fa: { label: t('admin.team.action.force_2fa'), onSelect: () => setForce2fa(mb), destructive: true, hidden: !write },
        },
        t,
      )}
    />
  );
  const delState = (r: DeletionRequestAdminDto) => {
    const extra = r.status === 'grace' ? (r.exportSentAt ? t('admin.team.del.exportSent') : r.membershipsRemoved ? t('admin.team.del.removed') : '') : r.status === 'blocked' ? (r.blockedReasons.length ? r.blockedReasons : [r.blockedReason]).filter(Boolean).join(' + ') : '';
    return <AdminPill group="Deletion.status" value={r.status}>{`${t(`admin.deletion.status.${r.status}`)}${extra ? ` · ${extra}` : ''}`}</AdminPill>;
  };
  const delColumns: Column<DeletionRequestAdminDto>[] = [
    { key: 'at', header: t('admin.team.del.col.requested'), sortKey: 'requestedAt', hideable: false, cell: (r) => f.short(r.requestedAt) },
    { key: 'user', header: t('admin.team.del.col.user'), cell: (r) => <span>{fullName(r.user) || t('admin.team.del.anonymous')} · <span dir="ltr">{r.user.email}</span></span> },
    { key: 'ws', header: t('admin.team.del.col.workspaces'), hideBelow: 'lg', cell: (r) => (r.workspaces.length ? r.workspaces.map((w) => `${w.name} (${t(`enum.Membership.role.${w.role}`).toLowerCase()})`).join(' · ') : '—') },
    { key: 'due', header: t('admin.team.del.col.due'), cell: (r) => (r.status === 'anonymised' ? `${f.short(r.processedAt)} ✓` : r.scheduledAt ? f.short(r.scheduledAt) : '—') },
    { key: 'state', header: t('admin.team.del.col.state'), cell: delState },
  ];
  const delMenu = (r: DeletionRequestAdminDto) => (
    <ActionsMenu
      label={t('action.actions')}
      heading={r.user.email}
      actions={toMenuActions(
        r.actions,
        {
          view: { label: t('admin.team.del.action.view'), onSelect: () => router.push(`/admin/users?sheet=${r.user.id}`), local: true },
          cancel: { label: t('admin.team.del.action.cancel'), onSelect: () => setDel({ req: r, action: 'cancel' }), hidden: !can('admin.deletion.write') },
          resolve: { label: t('admin.team.del.action.resolve'), onSelect: () => setDel({ req: r, action: 'resolve' }), hidden: !can('admin.deletion.write') },
          process_now: { label: t('admin.team.del.action.process_now'), onSelect: () => setDel({ req: r, action: 'process_now' }), destructive: true, hidden: !can('admin.deletion.write') },
        },
        t,
      )}
    />
  );
  const counts = deletions.data?.meta?.counts;
  return (
    <AdminPage
      permission="admin.team.read"
      title={t('admin.team.title')}
      description={t('admin.team.description')}
      actions={
        write ? (
          <Button variant="primary" onClick={() => setInvite(true)} data-testid="invite-member">
            {t('admin.team.invite.cta')}
          </Button>
        ) : null
      }
    >
      <OpsPanel title={t('admin.team.matrix.title')} data-testid="role-matrix">
        <RoleMatrix
          label={t('admin.team.matrix.title')}
          capabilityLabel={t('admin.team.matrix.capability')}
          roles={ROLES.map((r) => ({ key: r, label: t(`admin.team.matrix.role.${r}`) }))}
          rows={MATRIX.map((row) => ({ key: row.key, label: t(`admin.team.matrix.row.${row.key}`), allowed: [...PLATFORM_PERMISSIONS[row.perm]] }))}
        />
      </OpsPanel>
      <OpsPanel title={t('admin.team.members.title')} data-testid="platform-members">
        {team.isPending ? (
          <ListSkeleton rows={4} columns={5} label={t('common.loading')} />
        ) : team.isError ? (
          <AdminQueryError error={team.error} onRetry={() => void team.refetch()} />
        ) : (
          <>
            <DataTable<PlatformMemberDto> label={t('admin.team.members.title')} columns={memberColumns} rows={team.data.members} rowKey={(mb) => mb.userId} actionsLabel={t('action.actions')} rowActions={memberMenu} />
            {team.data.invitations.filter((i) => !i.acceptedAt).length ? (
              <ul className="mt-3 flex flex-col divide-y divide-line-hairline rounded-card border border-line-hairline" data-testid="invitations">
                {team.data.invitations
                  .filter((i) => !i.acceptedAt)
                  .map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                      <span dir="ltr" className="flex-1">{i.email}</span>
                      <MonoChip>{t(`admin.shell.role.${i.platformRole}`)}</MonoChip>
                      <span className="ts-label-micro text-text-muted">{t('admin.team.invitation.expires', { date: f.short(i.expiresAt) })}</span>
                      {write ? (
                        <Button size="sm" variant="ghost" onClick={() => confirm.ask({ title: t('admin.team.invitation.revokeConfirm', { email: i.email }), confirmLabel: t('admin.team.invitation.revoke'), destructive: true, run: () => act(() => adminWrite(`/admin/platform-members/invitations/${i.id}`, 'DELETE'), t('admin.team.invitation.revoked')) })}>
                          {t('admin.team.invitation.revoke')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </OpsPanel>
      {can('admin.deletion.read') ? (
        <OpsPanel
          title={t('admin.team.del.title')}
          sub={t('admin.team.del.sub')}
          end={counts ? <MonoChip tone="warning">{t('admin.team.del.counts', { toProcess: counts.toProcess, blocked: counts.blocked })}</MonoChip> : undefined}
          data-testid="deletion-requests"
        >
          {deletions.isPending ? (
            <ListSkeleton rows={4} columns={5} label={t('common.loading')} />
          ) : deletions.isError ? (
            <AdminQueryError error={deletions.error} onRetry={() => void deletions.refetch()} />
          ) : deletions.data.rows.length === 0 ? (
            <p className="py-6 text-center ts-label-meta text-text-muted">{t('admin.team.del.empty')}</p>
          ) : (
            <DataTable<DeletionRequestAdminDto>
              label={t('admin.team.del.title')}
              columns={delColumns}
              rows={deletions.data.rows}
              rowKey={(r) => r.id}
              sort={list.sort}
              onSortChange={list.setSort}
              actionsLabel={t('action.actions')}
              rowActions={delMenu}
              footer={<ListPagination page={list.state.page} pageSize={list.state.pageSize} total={deletions.data.total} onChange={(p) => list.set(p)} />}
            />
          )}
          <FrameNote className="mt-3">{t('admin.team.del.note')}</FrameNote>
        </OpsPanel>
      ) : null}
      {can('admin.deletion.read') ? (
        <OpsPanel title={t('admin.team.dd.title')} sub={t('admin.team.dd.sub')} data-testid="customer-data-deletion">
          <DataDeletionSection canWrite={can('admin.deletion.write')} />
        </OpsPanel>
      ) : null}
      <InviteMemberDialog open={invite} onClose={() => setInvite(false)} />
      <ChangeRoleDialog user={role ? { id: role.userId, name: fullName(role), platformRole: role.platformRole } : null} open={!!role} onClose={() => setRole(null)} />
      <DeletionDialog req={del?.req ?? null} action={del?.action ?? null} onClose={() => setDel(null)} />
      <Force2faDialog member={force2fa} onClose={() => setForce2fa(null)} />
      {confirm.element}
    </AdminPage>
  );
}

function Force2faDialog({ member, onClose }: { member: PlatformMemberDto | null; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: { userId: string; reason: string }) => adminWrite(`/admin/platform-members/${b.userId}/force-2fa`, 'POST', { reason: b.reason }) });
  useOnOpen(!!member, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  if (!member) return null;
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ userId: member.userId, reason: reason.trim() });
      void invalidate('/admin/platform-members');
      toast(t('admin.team.forced2fa'));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog open onClose={onClose} testId="dlg-force-2fa" size="sm" title={t('admin.team.action.force_2fa')} context={`${fullName(member)} · ${member.email}`} note={t('admin.team.force2fa.note')} destructive submitLabel={t('admin.team.action.force_2fa')} disabled={!reasonOk(reason)} pending={m.isPending} error={errors.form} onSubmit={() => void submit()}>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}

function DeletionDialog({ req, action, onClose }: { req: DeletionRequestAdminDto | null; action: DelAction | null; onClose: () => void }) {
  const t = useT();
  const invalidate = useAdminInvalidate();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ServerErrors>(NO_ERRORS);
  const m = useMutation({ mutationFn: (b: { id: string; a: DelAction; reason: string }) => adminWrite(`/admin/deletion-requests/${b.id}/${b.a.replace('_', '-')}`, 'POST', { reason: b.reason }) });
  useOnOpen(!!action, () => {
    setReason('');
    setErrors(NO_ERRORS);
  });
  if (!req || !action) return null;
  const submit = async () => {
    setErrors(NO_ERRORS);
    try {
      await m.mutateAsync({ id: req.id, a: action, reason: reason.trim() });
      void invalidate('/admin/deletion-requests', '/admin/users');
      toast(t(`admin.team.del.${action}.done`));
      onClose();
    } catch (e) {
      setErrors(toServerErrors(e, t, ['reason'], { ADMIN_REASON_REQUIRED: 'reason' }));
    }
  };
  return (
    <AdminDialog open onClose={onClose} testId={`dlg-deletion-${action}`} size="sm" title={t(`admin.team.del.action.${action}`)} context={`${fullName(req.user)} · ${req.user.email}`} note={t(`admin.team.del.${action}.note`)} destructive={action === 'process_now'} submitLabel={t(`admin.team.del.action.${action}`)} disabled={!reasonOk(reason)} pending={m.isPending} error={errors.form} onSubmit={() => void submit()}>
      <ReasonField value={reason} onChange={setReason} error={errors.fields.reason} />
    </AdminDialog>
  );
}
