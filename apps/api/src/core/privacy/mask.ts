// PII masking (07-non-functional: customer name / phone masked in admin viewers and logs). Shared by the admin viewers
// (ADM-17) and the merchant inbox read through a read-only impersonation session (recette 11/11, Badro).
import { TenantContext } from '@djaber/db';

/** PII masking of admin viewers and lists (07-non-functional: masked in admin viewers and logs). `0661987654` ⇒ `06•• •• •• 54`. */
export const maskPhone = (p: string | null | undefined): string | null => {
  if (!p) return null;
  const d = p.replace(/\s+/g, '');
  if (d.length < 5) return '••••';
  return `${d.slice(0, 2)}•• •• •• ${d.slice(-2)}`;
};
/** "Mehdi Hadj" ⇒ "Mehdi H." */
export const maskName = (n: string | null | undefined): string => {
  const parts = (n ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts[parts.length - 1]![0]}.`;
};
/** Phone-like digit runs inside a text (≥ 8 digits) are masked too. */
export const maskText = (t: string | null | undefined): string | null => (t ? t.replace(/(\+?\d[\d .-]{7,}\d)/g, (m) => maskPhone(m.replace(/[ .-]/g, '')) ?? m) : t ?? null);

/** The request is a platform admin looking at a workspace through « Se connecter en tant que » (read-only session). */
export const impersonating = (): boolean => !!TenantContext.maybe()?.impersonation;

/**
 * J13r-1 — the user whose per-user rows a screen shows: the signed-in user, or during a read-only impersonation the shop
 * owner (the admin sees the shop as the merchant does: notifications, notification preferences, saved views, sessions,
 * « mine » filters). Writes stay refused by the tenant guard; audit rows keep the admin as actor.
 */
export const viewerUserId = (): string | undefined => {
  const t = TenantContext.maybe();
  return t?.impersonation?.ownerUserId ?? t?.userId;
};

/** IPv4 `154.246.12.34` ⇒ `154.246.x.x` (admin screens and impersonation). */
export const maskIp = (ip: string | null | undefined): string | null => (ip ? ip.replace(/\.\d+\.\d+$/, '.x.x') : null);
