// Row / sheet `Actions ⌄` of a client (Figma "CLI-03 — Clients — filter panel + row menu", D42), in the Figma menu
// order. Built from the server descriptors (`actions`); while the server sends no descriptor for an item, the item is
// shown from the member's permissions (navigation items and writes the API still checks).
import type { MenuAction } from '@djaber/ui';
import { toMenuActions } from '@/lib/actions';
import type { TFunction } from '@/lib/i18n';
import { CLIENT_ACTIONS as K } from './action-keys';
import type { ClientListItem } from './contracts';

export type ClientHandlers = {
  open: () => void;
  edit: () => void;
  complete: () => void;
  merge: () => void;
  openConversation?: () => void;
  newOrder: () => void;
  orders: () => void;
  tags: () => void;
  export: () => void;
  risk: () => void;
  /** UX-015: block / unblock from the list and the sheet (server descriptors `block` / `unblock`) */
  block?: () => void;
  unblock?: () => void;
  delete: () => void;
};
export type ClientPerms = { write: boolean; remove: boolean; orders: boolean; ordersWrite: boolean; inbox: boolean };

export function clientMenuActions(c: Pick<ClientListItem, 'actions' | 'riskLevel' | 'isPlaceholder' | 'orderCount' | 'name'> & { conversationId?: string | null }, h: ClientHandlers, p: ClientPerms, t: TFunction, o: { sheet?: boolean } = {}): MenuAction[] {
  return toMenuActions(
    c.actions,
    {
      [K.open]: { label: t('clients.action.open'), onSelect: h.open, hint: t('clients.hint.sheet'), hidden: o.sheet, local: true },
      [K.complete]: { label: t('clients.action.complete'), onSelect: h.complete, hint: t('clients.hint.complete'), hidden: !p.write || !c.isPlaceholder, local: true },
      [K.edit]: { label: t('action.edit'), onSelect: h.edit, hint: t('clients.hint.dialog'), hidden: !p.write || c.isPlaceholder, local: true },
      [K.merge]: { label: t('clients.action.merge'), onSelect: h.merge, hint: t('clients.hint.merge'), hidden: !p.remove, local: true },
      [K.openConversation]: { label: t('clients.action.openConversation'), onSelect: h.openConversation ?? (() => undefined), hint: t('clients.hint.inbox'), hidden: !p.inbox || !h.openConversation, separated: true, local: true },
      [K.newOrder]: { label: t('clients.action.newOrder'), onSelect: h.newOrder, hint: t('clients.hint.newOrder'), hidden: !p.ordersWrite, local: true },
      [K.orders]: { label: t('clients.action.orders', { count: c.orderCount }), onSelect: h.orders, hint: t('clients.hint.orders'), hidden: !p.orders, local: true },
      [K.tags]: { label: t('clients.action.tags'), onSelect: h.tags, hint: t('clients.hint.tags'), hidden: !p.write, separated: true, local: true },
      [K.export]: { label: t('clients.action.export'), onSelect: h.export, hint: t('clients.hint.export'), hidden: !p.remove, local: true },
      [c.riskLevel === 'high' ? K.unmarkRisk : K.markRisk]: { label: c.riskLevel === 'high' ? t('clients.action.markReliable') : t('clients.action.markRisk'), onSelect: h.risk, hidden: !p.write, local: true },
      [K.block]: { label: t('clients.action.block'), onSelect: h.block ?? (() => undefined), hint: t('clients.hint.confirm'), destructive: true, separated: true, hidden: !h.block },
      [K.unblock]: { label: t('clients.action.unblock'), onSelect: h.unblock ?? (() => undefined), hint: t('clients.hint.confirm'), separated: true, hidden: !h.unblock },
      [c.orderCount > 0 ? K.archive : K.delete]: { label: t('clients.action.delete'), onSelect: h.delete, hint: t('clients.hint.confirm'), destructive: true, separated: true, hidden: !p.remove, local: true },
    },
    t,
  );
}
