'use client';
// Frame of a merchant page: optional back link, eyebrow (STOCK), title, description, header actions and the permission
// gate (a role without the key gets the 403 page; the API refuses too). Used by every (app) route outside Settings.
import { roleCan, type MerchantPermission } from '@djaber/shared';
import { cn, PageHeader } from '@djaber/ui';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page403 } from '@/components/global-states';
import { Link } from '@/i18n/navigation';
import { useDocumentTitle } from '@/lib/document-title';
import { useLocaleCode, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function AppPage({
  eyebrow,
  title,
  description,
  actions,
  permission,
  back,
  breadcrumb,
  badges,
  children,
  bare,
  fill,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** every key must be held */
  permission?: MerchantPermission | MerchantPermission[];
  back?: { href: string; label: string };
  /** trail above the title of a detail page (Produits / Parfums / Parfum Oud) */
  breadcrumb?: ReactNode;
  /** pills next to the title */
  badges?: ReactNode;
  children: ReactNode;
  /** @deprecated every page is full width (owner request 2026-10-13); kept so existing callers compile */
  wide?: boolean;
  /** the page draws its own heading (wizard frame): only the document title, the gate and the trail are kept */
  bare?: boolean;
  /** ≥ 1280 the page takes exactly the height of the content area so a chat pane (`flex-1`) fills what is left
   * under the header and keeps its composer on screen instead of growing the page (agent playground) */
  fill?: boolean;
}) {
  const t = useT();
  const locale = useLocaleCode();
  const { role } = useSession();
  useDocumentTitle(title);
  const keys = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (keys.some((k) => !roleCan(role, k))) return <Page403 role={role ? t(`enum.Membership.role.${role}`) : '—'} homeHref={`/${locale}/home`} permissions={keys} />;
  return (
    <div className={cn('flex w-full flex-col gap-5', fill && 'xl:h-full')}>
      {back ? (
        <Link href={back.href} className="inline-flex w-fit items-center gap-1.5 ts-label-meta uppercase text-text-muted hover:text-text-primary">
          <ArrowLeft className="size-3 rtl:-scale-x-100" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      {breadcrumb}
      {bare ? null : badges ? (
        <header className="flex flex-wrap items-end justify-between gap-4 md:flex-nowrap md:items-start">
          <div className="min-w-0 md:flex-1">
            {eyebrow ? <div className="ts-label-meta mb-2 uppercase text-text-muted">{eyebrow}</div> : null}
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="ts-display-m min-w-0 [overflow-wrap:anywhere] md:truncate" title={title}>
                {title}
              </h1>
              {badges}
            </div>
            {description ? <p className="ts-body mt-2 text-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">{actions}</div> : null}
        </header>
      ) : (
        <PageHeader eyebrow={eyebrow} title={title} description={typeof description === 'string' ? description : undefined} actions={actions} />
      )}
      {!bare && !badges && description && typeof description !== 'string' ? <div className="ts-body -mt-3 text-text-secondary">{description}</div> : null}
      {children}
    </div>
  );
}
