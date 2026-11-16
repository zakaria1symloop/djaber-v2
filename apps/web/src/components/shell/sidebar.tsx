'use client';
// Sidebar: 240 px ≥ 1280, icon rail 64 px at 1024–1279, drawer < 1024 (Figma RESP frame).
import { cn } from '@djaber/ui';
import { X } from 'lucide-react';
import * as React from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useT } from '@/lib/i18n';
import type { NavGroup, NavItem } from './nav';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
        <circle cx="15" cy="15" r="13.5" stroke="white" strokeWidth="1.6" />
        <circle cx="15" cy="10" r="2" fill="white" />
        <circle cx="10.5" cy="18.5" r="2" fill="white" />
        <circle cx="19.5" cy="18.5" r="2" fill="white" />
        <path d="M15 10 10.5 18.5h9L15 10Z" stroke="white" strokeWidth="1.2" />
      </svg>
      {compact ? null : (
        <span className="ts-display-s text-[19px]">
          Djaber<span className="text-text-secondary">.ai</span>
        </span>
      )}
    </span>
  );
}

function Item({ item, active, badge, rail, onNavigate }: { item: NavItem; active: boolean; badge?: number; rail: boolean; onNavigate?: () => void }) {
  const t = useT();
  const Icon = item.icon;
  const label = t(item.key);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={rail ? label : undefined}
      className={cn(
        'flex h-11 items-center gap-3 rounded-card px-3 text-[14px] font-medium text-text-primary hover:bg-ink-raised',
        active && 'bg-ink-raised',
        rail && 'xl:justify-start lg:max-xl:justify-center lg:max-xl:px-0',
      )}
    >
      <Icon className="size-[18px] shrink-0 text-text-secondary" aria-hidden />
      <span className={cn('min-w-0 flex-1 truncate', rail && 'lg:max-xl:hidden')}>{label}</span>
      {badge ? (
        <span className={cn('ts-label-meta tabular-nums text-text-muted', rail && 'lg:max-xl:hidden')} aria-label={String(badge)}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  groups,
  footer,
  counters,
  header,
  open,
  onClose,
  homeHref = '/home',
}: {
  groups: NavGroup[];
  footer: NavItem[];
  counters?: Partial<Record<string, number>>;
  header?: React.ReactNode;
  open: boolean;
  onClose: () => void;
  homeHref?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (href !== homeHref && pathname.startsWith(`${href}/`));
  // the longest matching href wins (`/stock` vs `/stock/movements`)
  const all = [...groups.flatMap((g) => g.items), ...footer];
  const best = all.filter((i) => isActive(i.href)).sort((a, b) => b.href.length - a.href.length)[0];

  // full-test 15/11 MOBILE-A11Y-01: below 1024 px the sidebar is a drawer — closed, it is out of the Tab order (`inert`);
  // open, it is a modal dialog: focus moves in, Tab stays inside, Esc closes (focus goes back to « Menu », AppShell)
  const asideRef = React.useRef<HTMLElement>(null);
  const [drawer, setDrawer] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const sync = () => setDrawer(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const modal = drawer && open;
  React.useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    if (drawer && !open) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [drawer, open]);
  React.useEffect(() => {
    if (!modal) return;
    const el = asideRef.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, onClose]);

  return (
    <>
      {open ? <div className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={onClose} aria-hidden /> : null}
      <aside
        ref={asideRef}
        id="app-drawer"
        role={modal ? 'dialog' : undefined}
        aria-modal={modal || undefined}
        aria-label={modal ? t('nav.menu') : undefined}
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-60 flex-col border-e border-line-hairline bg-ink-surface transition-transform',
          'lg:static lg:z-auto lg:w-16 lg:translate-x-0 xl:w-60',
          open ? 'translate-x-0' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5 lg:max-xl:justify-center lg:max-xl:px-0">
          <Link href={homeHref} aria-label="Djaber.ai">
            <span className="lg:max-xl:hidden">
              <Logo />
            </span>
            <span className="hidden lg:max-xl:inline">
              <Logo compact />
            </span>
          </Link>
          {/* MOBILE-A11Y-09: a finger-sized target (40 px), the icon stays 20 px */}
          <button type="button" className="-me-2.5 flex size-10 items-center justify-center rounded-card text-text-muted hover:text-text-primary lg:hidden" onClick={onClose} aria-label={t('action.close')}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {header ? <div className="px-5 pb-2 lg:max-xl:hidden">{header}</div> : null}
        {/* the groups scroll; the footer links (help, settings, back to my space) stay pinned at the bottom */}
        <nav className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
            {groups.map((g, gi) =>
              g.items.length ? (
                <div key={g.key ?? gi} className="flex flex-col gap-1">
                  {g.key ? <div className="ts-label-meta px-5 pb-1 pt-3 uppercase text-text-muted lg:max-xl:hidden">{t(g.key)}</div> : null}
                  {g.items.map((item) => (
                    <Item key={item.href} item={item} active={best?.href === item.href} badge={item.badge ? counters?.[item.badge] : undefined} rail onNavigate={onClose} />
                  ))}
                </div>
              ) : null,
            )}
          </div>
          {footer.length ? (
            <div className="flex shrink-0 flex-col gap-1 border-t border-line-hairline px-3 py-3">
              {footer.map((item) => (
                <Item key={item.href} item={item} active={best?.href === item.href} badge={item.badge ? counters?.[item.badge] : undefined} rail onNavigate={onClose} />
              ))}
            </div>
          ) : null}
        </nav>
      </aside>
    </>
  );
}
