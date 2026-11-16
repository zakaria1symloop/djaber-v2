'use client';
// Frame of a platform admin page (02 §2.3): title, description, header actions and the platform permission gate
// (a role without the key gets the 403 state naming the role; the API refuses too). Used by every `(admin)` route.
import type { PlatformPermission } from '@djaber/shared';
import { ErrorState, ForbiddenState, NotFoundState, PageHeader, SystemPage } from '@djaber/ui';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/document-title';
import { useLocaleCode, useT } from '@/lib/i18n';
import { usePlatform } from './platform';

export function AdminPage({
  title,
  description,
  actions,
  permission,
  badges,
  fill,
  children,
}: {
  /**
   * the page takes the full height of the content area on wide screens (xl): one panel inside (a ticket thread) grows
   * and scrolls on its own while its composer stays on screen. Below xl the page scrolls as usual.
   */
  fill?: boolean;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  permission: PlatformPermission;
  /** pills on the end side of the title (ADM-17 "LECTURE SEULE · JOURNALISÉ") */
  badges?: ReactNode;
  children: ReactNode;
}) {
  const { can, role } = usePlatform();
  useDocumentTitle(title);
  if (!can(permission)) return <AdminForbidden role={role} />;
  return (
    <div className={fill ? 'flex flex-col gap-5 xl:h-full xl:min-h-[34rem]' : 'flex flex-col gap-5'}>
      {badges ? (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="ts-display-m">{title}</h1>
            {description ? <p className="ts-body mt-2 text-text-secondary">{description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {badges}
            {actions}
          </div>
        </header>
      ) : (
        <PageHeader title={title} description={typeof description === 'string' ? description : undefined} actions={actions} />
      )}
      {!badges && description && typeof description !== 'string' ? <div className="ts-body -mt-3 text-text-secondary">{description}</div> : null}
      {children}
    </div>
  );
}

export function AdminForbidden({ role }: { role: string | null }) {
  const t = useT();
  const locale = useLocaleCode();
  return (
    <SystemPage>
      <ForbiddenState
        code={t('state.page.403.title')}
        title={t('state.detail.forbidden.title')}
        // full-test ROLES-09: a shop member (no platform role) reads a plain sentence and goes back to the shop
        description={role ? t('admin.state.forbidden', { role: t(`admin.shell.role.${role}`) }) : t('admin.state.notPlatform')}
        action={{ label: t('action.backHome'), href: role ? `/${locale}/admin` : `/${locale}/home` }}
      />
    </SystemPage>
  );
}

/**
 * Query error of an admin screen: 403 ⇒ the role explanation (or the 2FA requirement of platform roles,
 * `TWO_FA_REQUIRED_FOR_ROLE`), 404 ⇒ not found with back link, otherwise message + ref + Réessayer.
 */
export function AdminQueryError({ error, onRetry, backHref }: { error: unknown; onRetry?: () => void; backHref?: string }) {
  const t = useT();
  const { role } = usePlatform();
  const locale = useLocaleCode();
  if (error instanceof ApiError && error.code === 'TWO_FA_REQUIRED_FOR_ROLE') {
    return <ForbiddenState title={t('admin.state.twoFa.title')} description={t('error.TWO_FA_REQUIRED_FOR_ROLE')} action={{ label: t('admin.state.twoFa.action'), href: `/${locale}/settings/security` }} />;
  }
  if (error instanceof ApiError && error.status === 403) {
    return <ForbiddenState title={t('state.detail.forbidden.title')} description={role ? t('admin.state.forbidden', { role: t(`admin.shell.role.${role}`) }) : t('admin.state.notPlatform')} action={backHref ? { label: t('action.back'), href: backHref } : undefined} />;
  }
  if (error instanceof ApiError && error.status === 404) {
    return <NotFoundState title={t('state.detail.notFound.title')} description={t('admin.state.notFound')} action={backHref ? { label: t('action.back'), href: backHref } : undefined} />;
  }
  const ref = error instanceof ApiError ? error.body.ref : '—';
  return (
    <ErrorState
      title={t('state.list.error.title')}
      description={error instanceof ApiError && error.status < 500 && error.status !== 0 ? `${error.message} (ref. ${ref})` : t('state.list.error.description', { ref })}
      action={onRetry ? { label: t('action.retry'), onClick: onRetry } : undefined}
    />
  );
}
