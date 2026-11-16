'use client';
// Ready-to-use GLOBAL states with their copy (Figma 996:42199). Pages pass only what is specific to them.
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  ForbiddenState,
  ListSkeleton,
  NotFoundState,
  OfflineNotice,
  SessionExpiredState,
  SuspendedState,
  SystemPage,
  type StateAction,
} from '@djaber/ui';
import { roleCan, type MerchantPermission } from '@djaber/shared';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function ListLoading({ rows, columns }: { rows?: number; columns?: number }) {
  const t = useT();
  return <ListSkeleton rows={rows} columns={columns} label={t('common.loading')} />;
}

export function ListEmpty({ title, description, action }: { title: string; description?: string; action?: StateAction }) {
  return <EmptyState title={title} description={description} action={action} />;
}

/** `filters` = what the member typed / picked (search term, chip labels). Empty ⇒ « … with the current filters » — never a
 *  placeholder quoted as if it were the search, never « Aucun(e) » (full-test 15/11 ORDERS-18 / DELIVERY-13 / CLIENTS-07). */
export function ListFilteredEmpty({ entity, filters, onClear }: { entity: string; filters: string; onClear: () => void }) {
  const t = useT();
  const term = filters.trim();
  return (
    <FilteredEmptyState
      title={t('state.list.filteredEmpty.title')}
      description={term ? t('state.list.filteredEmpty.description', { entity, filters: term }) : t('state.list.filteredEmpty.descriptionNoTerm', { entity })}
      action={{ label: t('action.clearFilters'), onClick: onClear }}
    />
  );
}

/** Maps a query error to the right state: 403 → forbidden, 404 → not found, otherwise error with retry + ref. */
export function QueryError({ error, onRetry, backHref }: { error: unknown; onRetry?: () => void; backHref?: string }) {
  const t = useT();
  if (error instanceof ApiError && error.status === 403) {
    return <ForbiddenState title={t('state.detail.forbidden.title')} description={error.message} action={backHref ? { label: t('action.back'), href: backHref } : undefined} />;
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <NotFoundState
        title={t('state.detail.notFound.title')}
        description={t('state.detail.notFound.description')}
        action={backHref ? { label: t('action.back'), href: backHref } : undefined}
      />
    );
  }
  const ref = error instanceof ApiError ? error.body.ref : '—';
  return (
    <ErrorState
      title={t('state.list.error.title')}
      description={error instanceof ApiError && error.status < 500 ? error.message : t('state.list.error.description', { ref })}
      action={onRetry ? { label: t('action.retry'), onClick: onRetry } : undefined}
    />
  );
}

export function OfflineBanner({ since, onRetry }: { since: string; onRetry?: () => void }) {
  const t = useT();
  return <OfflineNotice action={onRetry ? { label: t('action.retry'), onClick: onRetry } : undefined}>{t('state.offline.banner', { date: since })}</OfflineNotice>;
}

/** The lowest role that holds every key of the page: the 403 text names who may open it (full-test ROLES-03). */
export const requiredRole = (permissions: readonly MerchantPermission[] | undefined): 'operator' | 'admin' | 'owner' | null => {
  if (!permissions?.length) return null;
  return (['operator', 'admin', 'owner'] as const).find((r) => permissions.every((k) => roleCan(r, k))) ?? null;
};

export function Page403({ role, homeHref, permissions }: { role: string; homeHref: string; permissions?: readonly MerchantPermission[] }) {
  const t = useT();
  const needed = requiredRole(permissions);
  return (
    <SystemPage>
      <ForbiddenState
        code={t('state.page.403.title')}
        title={t('state.detail.forbidden.title')}
        description={needed ? t(`state.page.403.for.${needed}`, { role }) : t('state.page.403.description', { role })}
        action={{ label: t('action.backHome'), href: homeHref }}
      />
    </SystemPage>
  );
}

export function Page404({ homeHref }: { homeHref: string }) {
  const t = useT();
  return (
    <SystemPage>
      <NotFoundState title={t('state.page.404.title')} description={t('state.detail.notFound.description')} action={{ label: t('action.backHome'), href: homeHref }} />
    </SystemPage>
  );
}

export function PageSuspended({ reason, supportHref }: { reason: string; supportHref: string }) {
  const t = useT();
  return (
    <SystemPage>
      <SuspendedState
        title={t('state.page.suspended.title')}
        description={t('state.page.suspended.description', { reason })}
        action={{ label: t('action.contactSupport'), href: supportHref }}
      />
    </SystemPage>
  );
}

export function PageSessionExpired({ path, loginHref }: { path: string; loginHref: string }) {
  const t = useT();
  return (
    <SystemPage>
      <SessionExpiredState
        title={t('state.page.sessionExpired.title')}
        description={t('state.page.sessionExpired.description', { path })}
        action={{ label: t('action.login'), href: loginHref }}
      />
    </SystemPage>
  );
}

/** "Quitter sans enregistrer ?" */
export function LeaveGuardDialog({ open, name, onStay, onLeave }: { open: boolean; name: string; onStay: () => void; onLeave: () => void }) {
  const t = useT();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && onStay()}
      title={t('state.form.leave.title')}
      description={t('state.form.leave.description', { name })}
      confirmLabel={t('action.leave')}
      cancelLabel={t('action.stay')}
      onConfirm={onLeave}
      destructive
      closeLabel={t('action.close')}
    />
  );
}

/** 409 CONFLICT: "Modifié par quelqu'un d'autre" — Écraser / Recharger. */
export function ConflictDialog({
  open,
  name,
  ago,
  onOverwrite,
  onReload,
  onClose,
}: {
  open: boolean;
  name: string;
  ago: string;
  onOverwrite?: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('state.form.conflict.title')}
      description={t('state.form.conflict.description', { name, ago })}
      closeLabel={t('action.close')}
      size="sm"
      footer={
        <>
          {onOverwrite ? (
            <Button variant="ghost" onClick={onOverwrite}>
              {t('action.overwrite')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={onReload}>
            {t('action.reload')}
          </Button>
        </>
      }
    />
  );
}
