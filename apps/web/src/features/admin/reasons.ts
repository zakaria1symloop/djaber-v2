// Disabled reasons on the platform admin screens (full-test 15/11 ADMIN-05, 12 §16 « Disabled reasons »). The shared error
// catalogue speaks to the merchant (« Supprimez votre espace d'abord. », « Compte bloqué, contactez le support. »); on an
// admin menu the same code is about the account / shop the admin looks at, so a code with an admin sentence
// (`admin.reason.<CODE>`) uses it, every other code keeps the shared reason (lib/actions `descriptorReason`).
import type { ActionDescriptor } from '@djaber/shared';
import type { MenuAction } from '@djaber/ui';
import { descriptorReason, type ReasonParams } from '@/lib/actions';
import type { TFunction } from '@/lib/i18n';

type Descriptor = Pick<ActionDescriptor, 'key' | 'reasonCode' | 'reasonParams'>;

/** The reason of a greyed admin descriptor, in words addressed to the admin. */
export function adminReason(t: TFunction, d: Omit<Descriptor, 'key'> | undefined, params: ReasonParams = {}): string {
  const code = d?.reasonCode;
  const key = `admin.reason.${code}`;
  if (code && t.has(key)) return t(key, { ...d?.reasonParams, ...params } as ReasonParams).replace(/\s+/g, ' ').trim();
  return descriptorReason(t, d, { params });
}

/** Menu items from `toMenuActions` with their greyed reasons rewritten for the admin (`params` fill the admin sentences). */
export function withAdminReasons(items: MenuAction[], descriptors: readonly Descriptor[] | undefined, t: TFunction, params: ReasonParams = {}): MenuAction[] {
  return items.map((i) => {
    if (!i.disabledReason) return i;
    const d = descriptors?.find((x) => x.key === i.key);
    return d?.reasonCode && t.has(`admin.reason.${d.reasonCode}`) ? { ...i, disabledReason: adminReason(t, d, params) } : i;
  });
}
