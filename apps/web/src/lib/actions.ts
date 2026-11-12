// Row / detail `Actions ⌄` built from the server `actions: ActionDescriptor[]` (api-contract §1.12): the UI never
// computes a business transition. A descriptor without a handler on this screen is skipped; a disabled one stays
// visible, greyed, with its reason in the menu footer (D42; the error code is not shown — retest 11/11 UX-056).
import type { ActionDescriptor } from '@djaber/shared';
import type { MenuAction } from '@djaber/ui';
import type { TFunction } from './i18n';

export type ActionHandler = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  /** where the action leads, shown on the end side (PAGE PRODUIT, DIALOGUE…) */
  hint?: string;
  separated?: boolean;
  /** hidden for this member (permission): never rendered */
  hidden?: boolean;
  /** navigation / read-only item added by the screen (quick edit, movements of this product, card preview): shown without a server descriptor */
  local?: boolean;
};

/**
 * "Ce produit n'a pas de stock (service)." — retest 11/11 UX-056: the reason only, never the code (it stays on the
 * descriptor's `reasonCode`).
 */
export const reasonText = (t: TFunction, code: string | undefined): string => {
  if (!code) return t('error.FORBIDDEN');
  const key = `error.${code}`;
  if (!t.has(key)) return code;
  // counts and limits are not known for a greyed item: placeholders are left empty
  const text = t(key, { count: '', available: '', resource: '', current: '', limit: '' }).replace(/\s+/g, ' ').trim();
  return text;
};

/**
 * Maps the descriptors onto menu items, in the order of `handlers` (the Figma menu order), the primary one first.
 * `enabled: false` ⇒ `disabledReason`; the shortcut is shown when the screen gives no destination hint.
 */
export function toMenuActions(descriptors: readonly ActionDescriptor[] | undefined, handlers: Record<string, ActionHandler>, t: TFunction): MenuAction[] {
  const byKey = new Map((descriptors ?? []).map((d) => [d.key, d]));
  const out: MenuAction[] = [];
  for (const [key, h] of Object.entries(handlers)) {
    const d = byKey.get(key);
    if (h.hidden || (!d && !h.local)) continue;
    const enabled = d ? d.enabled : true;
    out.push({
      key,
      label: h.label,
      onSelect: enabled ? h.onSelect : undefined,
      primary: d?.primary,
      destructive: h.destructive,
      hint: h.hint ?? d?.shortcut,
      separated: h.separated,
      disabledReason: enabled ? undefined : reasonText(t, d?.reasonCode),
    });
  }
  const primary = out.findIndex((a) => a.primary);
  if (primary > 0) out.unshift(...out.splice(primary, 1));
  return out;
}

/** State of one action for a button outside the menu (header buttons, bulk bar). */
export function actionState(descriptors: readonly ActionDescriptor[] | undefined, key: string, t: TFunction): { present: boolean; enabled: boolean; reason?: string } {
  const d = descriptors?.find((x) => x.key === key);
  if (!d) return { present: false, enabled: false };
  return { present: true, enabled: d.enabled, reason: d.enabled ? undefined : reasonText(t, d.reasonCode) };
}

/**
 * Offline (banner "Hors ligne"): every write item of a menu is greyed with the offline reason; `readKeys` (open, print,
 * receipt…) stay usable. Items already greyed keep their own reason.
 */
export function offlineMenu(items: MenuAction[], reason: string | undefined, readKeys: readonly string[]): MenuAction[] {
  if (!reason) return items;
  return items.map((a) => (readKeys.includes(a.key) || a.disabledReason ? a : { ...a, onSelect: undefined, disabledReason: reason }));
}
