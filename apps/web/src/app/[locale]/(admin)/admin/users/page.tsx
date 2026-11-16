'use client';
// /admin/users — Figma "ADM-03 — Platform admin — users" (+ ADM-17 user detail in the sheet) and DLG "Inviter un membre
// plateforme" / "Changer le rôle plateforme". L6 list; filters, sort, page and the open sheet live in the URL.
import type { AdminUserRowDto } from '@djaber/shared';
import { ActionsMenu, Button, type Column } from '@djaber/ui';
import { useMemo, useState } from 'react';
import { AdminPage } from '@/features/admin/admin-page';
import { useAdminList } from '@/features/admin/api';
import { AdminFilterBar, AdminListBody, type AdminFilter } from '@/features/admin/list-kit';
import { usePlatform } from '@/features/admin/platform';
import { USERS_LIST } from '@/features/admin/specs';
import { InviteMemberDialog } from '@/features/admin/team/dialogs';
import { AdminPill, fullName, useFormats } from '@/features/admin/ui';
import { useUserActions } from '@/features/admin/users/actions';
import { UserSheet } from '@/features/admin/users/sheet';
import { useT } from '@/lib/i18n';
import { useListState } from '@/lib/use-list-state';

const STATUS = ['active', 'blocked', 'unverified', 'deletion_scheduled'] as const;

export default function AdminUsersPage() {
  const t = useT();
  const f = useFormats();
  const { can } = usePlatform();
  const list = useListState(USERS_LIST);
  const query = useAdminList<AdminUserRowDto>('/admin/users', list.apiQuery());
  const actions = useUserActions({ openSheet: (id) => list.openSheet(id) });
  const [invite, setInvite] = useState(false);
  const yesNo = useMemo(() => [{ value: 'true', label: t('admin.common.yes') }, { value: 'false', label: t('admin.common.no') }], [t]);
  const quick: AdminFilter[] = useMemo(
    () => [
      { kind: 'multi', key: 'platformRole', label: t('admin.users.filter.role'), options: (['none', 'read', 'support', 'moderator', 'finance', 'super_admin'] as const).map((r) => ({ value: r, label: r === 'none' ? t('admin.users.role.user') : t(`enum.PlatformRole.${r}`) })) },
      { kind: 'multi', key: 'status', label: t('admin.common.status'), options: STATUS.map((v) => ({ value: v, label: t(`admin.users.status.${v}`) })) },
      { kind: 'single', key: 'emailVerified', label: t('admin.users.filter.verified'), options: yesNo },
      { kind: 'single', key: 'totpEnabled', label: '2FA', options: yesNo },
      { kind: 'single', key: 'lastLogin', label: t('admin.users.filter.lastLogin'), options: (['7d', '30d', '90d', 'over90d', 'never'] as const).map((v) => ({ value: v, label: t(`admin.users.lastLogin.${v}`) })) },
    ],
    [t, yesNo],
  );
  const status = (u: AdminUserRowDto) => (u.status === 'active' && !u.emailVerified ? 'unverified' : u.status);
  const columns: Column<AdminUserRowDto>[] = [
    { key: 'name', header: t('admin.users.col.user'), hideable: false, cell: (u) => <span className="block truncate font-medium" title={fullName(u) || undefined}>{fullName(u) || '—'}</span> },
    { key: 'email', header: t('admin.users.col.email'), sortKey: 'email', cell: (u) => <span dir="ltr" className="whitespace-nowrap">{u.email} {u.emailVerified ? '✓' : '✗'}</span> },
    { key: 'workspaces', header: t('admin.users.col.workspaces'), className: 'max-w-[240px]', cell: (u) => (u.workspaces.length ? u.workspaces.map((w) => `${w.name} (${t(`enum.Membership.role.${w.role}`).toLowerCase()})`).join(' · ') : '—') },
    { key: 'platform', header: t('admin.users.col.platform'), cell: (u) => (u.platformRole === 'none' ? '—' : t(`enum.PlatformRole.${u.platformRole}`)) },
    { key: '2fa', header: '2FA', hideBelow: 'lg', cell: (u) => (u.totpEnabled ? t('admin.common.yes') : t('admin.common.no')) },
    { key: 'status', header: t('admin.common.status'), cell: (u) => <AdminPill group="User.status" value={status(u)}>{t(`admin.users.status.${status(u)}`)}</AdminPill> },
    { key: 'last', header: t('admin.users.col.lastLogin'), sortKey: 'lastLoginAt', hideBelow: 'lg', cell: (u) => <span className="whitespace-nowrap text-text-secondary">{u.lastLoginAt ? `${f.ago(u.lastLoginAt)}${u.lastSeenPlatform ? ` · ${u.lastSeenPlatform}` : ''}` : '—'}</span> },
  ];
  const menu = (u: AdminUserRowDto) => <ActionsMenu label={t('action.actions')} heading={`${fullName(u)} · ${t('admin.users.workspacesCount', { count: u.workspaces.length })}`} actions={actions.menu(u)} />;
  return (
    <AdminPage
      permission="admin.users.read"
      title={t('nav.admin.users')}
      description={t('admin.users.description')}
      actions={
        can('admin.team.write') ? (
          <Button variant="primary" onClick={() => setInvite(true)}>
            {t('admin.users.invite')}
          </Button>
        ) : null
      }
    >
      <AdminFilterBar list={list} search={t('admin.users.search')} quick={quick} count={query.data ? t('admin.users.count', { count: query.data.total }) : undefined} />
      <AdminListBody
        testId="users-list"
        filters={quick}
        query={query}
        list={list}
        columns={columns}
        rowKey={(u) => u.id}
        label={t('nav.admin.users')}
        entity={t('admin.users.entity')}
        empty={{ title: t('admin.users.empty.title') }}
        rowActions={menu}
        onRowClick={(u) => list.openSheet(u.id)}
        card={(u) => (
          <div className="flex items-center gap-3 px-3 py-3">
            <button type="button" onClick={() => list.openSheet(u.id)} className="min-w-0 flex-1 text-start">
              <span className="block truncate font-medium">{fullName(u)}</span>
              <span className="block truncate ts-label-meta text-text-muted" dir="ltr">{u.email}</span>
            </button>
            {menu(u)}
          </div>
        )}
      />
      <UserSheet id={list.state.sheet} onClose={() => list.openSheet(null)} menu={(u) => actions.menu(u, { sheet: true })} onAction={(a, u) => actions.open(a, u)} />
      <InviteMemberDialog open={invite} onClose={() => setInvite(false)} />
      {actions.dialogs}
    </AdminPage>
  );
}
