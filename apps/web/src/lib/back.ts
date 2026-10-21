'use client';
// "Retour" of a detail page opened from another screen (tester report 2026-10-19: a sale opened from the cash register
// went back to the sales list): the opening screen adds `?back=<its path and filters>`, the detail page goes back there,
// else to its own list. Internal paths only (no scheme, no `//`), so the parameter cannot send anyone off the site.
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';
import { useT } from './i18n';

/** Label of the back link by first path segment (`/cash?day=…` → "Caisse"). */
const LABELS: Record<string, string> = {
  cash: 'nav.cash',
  movements: 'nav.movements',
  reports: 'nav.reports',
  clients: 'nav.clients',
  orders: 'nav.orders',
  sales: 'nav.sales',
  purchases: 'nav.purchases',
  inbox: 'nav.inbox',
};

export const safeBack = (raw: string | null | undefined): string | null => (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : null);

/** `href` + `back=` (the screen the user is on now). */
export const withBack = (href: string, back: string): string => `${href}${href.includes('?') ? '&' : '?'}back=${encodeURIComponent(back)}`;

/** Label key of a back path, null when the screen has no name of its own. */
export const backLabelKey = (back: string): string | null => LABELS[back.split(/[/?#]/)[1] ?? ''] ?? null;

/** Back link of a detail page: `?back=` when present and internal, else `fallback`. */
export function useBack(fallback: { href: string; label: string }): { href: string; label: string } {
  const t = useT();
  const back = safeBack(useSearchParams().get('back'));
  if (!back) return fallback;
  const key = backLabelKey(back);
  return { href: back, label: key ? t(key) : fallback.label };
}

/** The current screen with its filters, as a `back=` value (`/cash?day=2026-10-19`). */
export function useHere(): string {
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
