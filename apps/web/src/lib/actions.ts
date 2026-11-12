// Row / detail `Actions ⌄` built from the server `actions: ActionDescriptor[]` (api-contract §1.12): the UI never
// computes a business transition. A descriptor without a handler on this screen is skipped; a disabled one stays
// visible, greyed, with its reason in the menu footer (D42; the error code is not shown — retest 11/11 UX-056).
// UX-060 (retest 12/11): an action the state machine does not allow (`isNotOffered`) is not offered at all, and a reason
// is always a finished sentence — its values filled (statuses in words, waits as « 54 s », dates, amounts), never `{…}`.
import { formatDate, formatMoney, isNotOffered, type ActionDescriptor, type AppLocale } from '@djaber/shared';
import type { MenuAction } from '@djaber/ui';
import type { TFunction } from './i18n';
import { waitLabel } from './time';

type ReasonValue = string | number | null | undefined;
export type ReasonParams = Record<string, ReasonValue>;
export type ReasonOptions = {
  /** i18n prefix of the status values the screen shows (`enum.Order.status` by default; `enum.Shipment.status` on parcels) */
  statusEnum?: string;
  /** values the screen knows better than the descriptor (a live countdown…): they win over `reasonParams` */
  params?: ReasonParams;
};

/** Params that are waits in seconds, statuses, dates, amounts. */
const WAIT_PARAMS = new Set(['retryAfter', 'wait', 'seconds']);
const STATUS_PARAMS = new Set(['from', 'to', 'status']);
const DATE_PARAMS = new Set(['date', 'at', 'scheduledAt', 'until', 'deadline']);
const MONEY_PARAMS = new Set(['amount', 'total', 'remaining']);

/** « CONFIRMÉE » (a pill label) inside a sentence reads « Confirmée ». */
const inSentence = (label: string): string => (label && label === label.toUpperCase() && label !== label.toLowerCase() ? label.charAt(0) + label.slice(1).toLowerCase() : label);

/** One value of a reason, as the merchant reads it. */
export const reasonValue = (t: TFunction, name: string, value: ReasonValue, o: Pick<ReasonOptions, 'statusEnum'> = {}): string => {
  if (value === null || value === undefined || value === '') return '';
  if (WAIT_PARAMS.has(name)) return typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value)) ? waitLabel(Number(value)) : String(value);
  if (STATUS_PARAMS.has(name)) {
    const key = `${o.statusEnum ?? 'enum.Order.status'}.${value}`;
    return t.has(key) ? inSentence(t(key)) : String(value);
  }
  if (DATE_PARAMS.has(name) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value, (t.locale ?? 'fr') as AppLocale);
  if (MONEY_PARAMS.has(name) && typeof value === 'number') return formatMoney(value);
  return String(value);
};

/**
 * "Ce produit n'a pas de stock (service)." — the reason only, never the code (it stays on the descriptor's
 * `reasonCode`, retest 11/11 UX-056), with every value it is given filled in (UX-060). A slot nobody filled is dropped by
 * the formatter (lib/format-message `stripPlaceholders`): the sentence never shows `{from}` / `{retryAfter}`.
 */
export const reasonText = (t: TFunction, code: string | undefined, params?: ReasonParams, o: ReasonOptions = {}): string => {
  if (!code) return t('error.FORBIDDEN');
  const key = `error.${code}`;
  // UX-059: an unknown code is never shown as such
  if (!t.has(key)) return t('actions.reason.unavailable');
  const all: ReasonParams = { ...params, ...o.params };
  const values = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, reasonValue(t, k, v, o)]));
  return t(key, values).replace(/\s+/g, ' ').trim();
};

/** The reason of a greyed descriptor (its own `reasonParams` + what the screen knows). */
export const descriptorReason = (t: TFunction, d: Pick<ActionDescriptor, 'reasonCode' | 'reasonParams'> | undefined, o: ReasonOptions = {}): string => reasonText(t, d?.reasonCode, d?.reasonParams, o);

/**
 * Maps the descriptors onto menu items, in the order of `handlers` (the Figma menu order), the primary one first.
 * `enabled: false` ⇒ `disabledReason`; the shortcut is shown when the screen gives no destination hint. A descriptor the
 * state machine refuses (`isNotOffered`) is left out — the API already omits it, this keeps older payloads clean.
 */
export function toMenuActions(descriptors: readonly ActionDescriptor[] | undefined, handlers: Record<string, ActionHandler>, t: TFunction, o: ReasonOptions = {}): MenuAction[] {
  const byKey = new Map((descriptors ?? []).filter((d) => !isNotOffered(d)).map((d) => [d.key, d]));
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
      disabledReason: enabled ? undefined : descriptorReason(t, d, o),
    });
  }
  const primary = out.findIndex((a) => a.primary);
  if (primary > 0) out.unshift(...out.splice(primary, 1));
  return out;
}

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

/** State of one action for a button outside the menu (header buttons, bulk bar). A refused transition is absent. */
export function actionState(descriptors: readonly ActionDescriptor[] | undefined, key: string, t: TFunction, o: ReasonOptions = {}): { present: boolean; enabled: boolean; reason?: string } {
  const d = descriptors?.find((x) => x.key === key);
  if (!d || isNotOffered(d)) return { present: false, enabled: false };
  return { present: true, enabled: d.enabled, reason: d.enabled ? undefined : descriptorReason(t, d, o) };
}

/**
 * Offline (banner "Hors ligne"): every write item of a menu is greyed with the offline reason; `readKeys` (open, print,
 * receipt…) stay usable. Items already greyed keep their own reason.
 */
export function offlineMenu(items: MenuAction[], reason: string | undefined, readKeys: readonly string[]): MenuAction[] {
  if (!reason) return items;
  return items.map((a) => (readKeys.includes(a.key) || a.disabledReason ? a : { ...a, onSelect: undefined, disabledReason: reason }));
}
