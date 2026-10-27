// ADM-08 announcement « Lien » (tester log 26/10 UX-036): the pages an announcement may open, by readable name — the
// public site (home, header links, legal pages of the footer) and one entry per menu item of the client app (sidebar,
// then the Paramètres menu). Sub-pages (/products/new, /products/<id>) are not offered; an outside page is the
// « Adresse externe » choice. Every value passes `isAnnouncementLink` (the API rule).
import { FOOTER_NAV, MAIN_NAV } from '@/components/shell/nav';
import { LEGAL_FOOTER_KEYS, PUBLIC_NAV } from '@/features/public/logic';
import { SETTINGS_NAV } from '@/features/settings/nav';

export type LinkOption = { value: string; label: string; hint: string };
type T = (key: string, params?: Record<string, string | number>) => string;

/** Value of the « Adresse externe (https://…) » choice. */
export const EXTERNAL_LINK = '__external';

export function announcementLinkOptions(t: T): LinkOption[] {
  const site = t('admin.cms.link.group.public');
  const app = t('admin.cms.link.group.app');
  const settings = t('nav.settings');
  return [
    { value: '/', label: t('admin.cms.link.home'), hint: `${site} · /` },
    ...PUBLIC_NAV.map((n) => ({ value: n.href, label: t(n.key), hint: `${site} · ${n.href}` })),
    ...LEGAL_FOOTER_KEYS.map((k) => ({ value: `/legal/${k}`, label: t(`public.footer.${k}`), hint: `${site} · /legal/${k}` })),
    ...[...MAIN_NAV.flatMap((g) => g.items), ...FOOTER_NAV].map((n) => ({
      value: n.href,
      label: t(n.key),
      hint: `${app}${n.advancedOnly ? ` (${t('admin.cms.link.advanced')})` : ''} · ${n.href}`,
    })),
    ...SETTINGS_NAV.map((n) => ({ value: n.href, label: `${settings} › ${t(n.key)}`, hint: `${app} · ${n.href}` })),
  ];
}
