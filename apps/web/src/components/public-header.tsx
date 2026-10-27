'use client';
// PublicLayout header (02-next-route-map §1, PUB-01; Figma "PUB — Legal (CMS) · Landing & help · Meta data-deletion
// status" / "PUB — Pricing page" header row): logo · Fonctionnalités · Tarifs · Aide · Statut · FR · AR · EN · Se connecter ·
// "Essai gratuit 14 j". The current section is lit. Below 1024 px the four links move into a "Menu" dropdown.
// `actions` replaces the two account links (status page: "S'abonner aux incidents" + "Ouvrir Djaber").
import { buttonClass, cn, Menu, MenuItem } from '@djaber/ui';
import { Menu as MenuIcon } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { LocaleSwitch } from '@/components/auth/auth-card';
import { Logo } from '@/components/shell/sidebar';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { PUBLIC_NAV } from '@/features/public/logic';
import { useT } from '@/lib/i18n';

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** `wideActions`: long custom actions (status page) — the inline links then need ≥ 1280 px instead of ≥ 1024 px. */
export function PublicHeader({ actions, wideActions }: { actions?: ReactNode; wideActions?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <header className="border-b border-line-hairline" data-testid="public-header">
      <div className="mx-auto flex h-[88px] max-w-[1344px] items-center gap-4 px-4 md:px-12 lg:gap-[18px]">
        <Link href="/" aria-label="Djaber.ai" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label={t('public.nav.label')} className={cn('flex items-center gap-[18px]', wideActions ? 'max-xl:hidden' : 'max-lg:hidden')}>
          {PUBLIC_NAV.map((n) => {
            const current = isCurrent(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={current ? 'page' : undefined}
                className={cn('whitespace-nowrap text-[13px] transition-colors hover:text-text-primary', current ? 'text-text-primary' : 'text-text-secondary')}
              >
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
        <div className="ms-auto flex min-w-0 items-center gap-3 sm:gap-4 md:gap-[18px]">
          <Suspense>
            <LocaleSwitch className="max-sm:hidden" />
          </Suspense>
          <span className={wideActions ? 'xl:hidden' : 'lg:hidden'}>
            <Menu
              trigger={
                <button type="button" className={buttonClass({ variant: 'ghost', size: 'sm', className: '!px-2' })} aria-label={t('public.nav.menu')} data-testid="public-nav-menu">
                  <MenuIcon className="size-4" aria-hidden />
                </button>
              }
            >
              {PUBLIC_NAV.map((n) => (
                <MenuItem key={n.href} onSelect={() => router.push(n.href)}>
                  {t(n.key)}
                </MenuItem>
              ))}
              <MenuItem className="sm:hidden" onSelect={() => router.push('/login')}>
                {t('public.header.login')}
              </MenuItem>
            </Menu>
          </span>
          {actions ?? (
            <>
              <Link href="/login" className="whitespace-nowrap text-[14px] font-medium text-text-secondary hover:text-text-primary max-sm:hidden">
                {t('public.header.login')}
              </Link>
              <Link href="/signup" className={buttonClass({ variant: 'primary', className: 'shrink-0 !whitespace-nowrap' })}>
                {t('public.header.trial')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
