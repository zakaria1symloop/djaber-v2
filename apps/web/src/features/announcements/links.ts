// Link of an announcement (« En savoir plus »): an http(s) URL or a page that exists (isAnnouncementLink, tester report
// 22/10 UX-026); anything else — e.g. a link saved before that rule — is not shown rather than leading to a 404.
import { isAnnouncementLink } from '@djaber/shared';

export const announcementLink = (link: string | null | undefined): { href: string; external: boolean } | null => {
  const l = (link ?? '').trim();
  if (!l || !isAnnouncementLink(l)) return null;
  return /^https?:\/\//i.test(l) ? { href: l, external: true } : { href: l, external: false };
};
