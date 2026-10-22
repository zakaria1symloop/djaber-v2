// Link of an announcement (« En savoir plus »): an app path (`/orders`) or an http(s) URL; anything else is ignored.
export const announcementLink = (link: string | null | undefined): { href: string; external: boolean } | null => {
  const l = (link ?? '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(l)) return { href: l, external: true };
  if (l.startsWith('/') && !l.startsWith('//') && !/[\s\\]/.test(l)) return { href: l, external: false };
  return null;
};
