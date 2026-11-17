'use client';
// Generic shell frame (sidebar + top bar + banner stack + content) used by MerchantShell and AdminShell.
import { IconButton } from '@djaber/ui';
import { Menu as MenuIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAutoTitles } from '@/lib/auto-title';
import { useT } from '@/lib/i18n';
import { BannerStack, type ShellBanner } from './banner-stack';
import type { NavGroup, NavItem } from './nav';
import { ShortcutsDialog } from './shortcuts-dialog';
import { Sidebar } from './sidebar';

export function AppShell({
  groups,
  footer,
  counters,
  sidebarHeader,
  topBar,
  banners,
  fixedBar,
  homeHref,
  children,
}: {
  groups: NavGroup[];
  footer: NavItem[];
  counters?: Partial<Record<string, number>>;
  sidebarHeader?: ReactNode;
  topBar?: ReactNode;
  banners?: ShellBanner[];
  /** fixed bar above everything (impersonation) */
  fixedBar?: ReactNode;
  homeHref?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // MOBILE-A11Y-01: closing the drawer gives the focus back to « Menu »
  const closeDrawer = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => menuButton.current?.focus(), 0);
  }, []);
  // truncated names / previews show their full text in a tooltip
  useAutoTitles();
  // journey J14-3: a save that navigates (« Enregistrer la commande », « Valider la vente ») left the focus on `<body>`; the
  // new page's main region takes it (the next Tab is its first control), never when the member already focused something
  const pathname = usePathname();
  const firstPath = useRef(pathname);
  useEffect(() => {
    // a page load keeps the browser's start (the skip link is the first Tab stop)
    if (pathname === firstPath.current) return;
    firstPath.current = '';
    const timer = window.setTimeout(() => {
      const now = document.activeElement;
      if (!now || now === document.body) document.getElementById('main')?.focus({ preventScroll: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K focuses the search of the current list (GLOBAL shortcuts)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const el = document.querySelector<HTMLInputElement>('[data-list-search]');
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      {/* full-test 15/11 MOBILE-A11Y-07 (WCAG 2.4.1): the first Tab stop skips the 25 sidebar links */}
      <a href="#main" className="skip-link fixed start-3 top-3 z-[100] rounded-card bg-white px-3 py-2 text-[13px] font-medium text-black">
        {t('a11y.skipToContent')}
      </a>
      {fixedBar}
      <div className="flex min-h-0 flex-1">
        <Sidebar groups={groups} footer={footer} counters={counters} header={sidebarHeader} open={open} onClose={closeDrawer} homeHref={homeHref} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line-hairline px-4 md:px-8">
            <IconButton ref={menuButton} label={t('nav.menu')} variant="ghost" className="lg:hidden" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="app-drawer">
              <MenuIcon className="size-5" />
            </IconButton>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">{topBar}</div>
          </header>
          <BannerStack banners={banners ?? []} dismissLabel={t('action.close')} />
          <ShortcutsDialog />
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 focus:outline-none md:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
