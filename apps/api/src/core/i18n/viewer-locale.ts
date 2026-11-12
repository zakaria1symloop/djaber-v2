// 07-architecture §4 "Language source" — screens are rendered in the viewer's language, never in the shop's by default.
import { TenantContext } from '@djaber/db';
import type { AppLocale } from '@djaber/shared';

/**
 * Language of the SCREEN being served: the page's language (`?lang` / `Accept-Language`), else the signed-in user's
 * account language, else the workspace language, else French. Carried through `runSystem` / `runAs` scopes and, inside a
 * worker job, restored from the job (`JobService.run`: the page language of the request that queued it, else its creator's).
 *
 * Not for texts that leave the app for someone else: customer documents and messages (slips, labels, tracking page,
 * Messenger, AI replies, payment page) use the shop's / customer's language; e-mails and notifications the recipient's.
 */
export const viewerLocale = (): AppLocale => {
  const t = TenantContext.maybe();
  return t?.requestLocale ?? t?.userLocale ?? t?.locale ?? 'fr';
};
