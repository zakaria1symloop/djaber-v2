// Server action keys of a client row / client sheet (`actions: ActionDescriptor[]` of `GET /clients` and
// `GET /clients/:id`, api-contract §1.12) — aligned with `apps/api/src/modules/clients/client.service.ts` `actions()`.
// The ONE place where these strings live. `complete` and `export` have no server descriptor (local items).
export const CLIENT_ACTIONS = {
  open: 'open',
  edit: 'edit',
  complete: 'complete',
  merge: 'merge',
  openConversation: 'open_conversation',
  newOrder: 'new_order',
  orders: 'open_orders',
  tags: 'tags',
  markRisk: 'mark_risk',
  unmarkRisk: 'unmark_risk',
  block: 'block',
  unblock: 'unblock',
  export: 'export',
  delete: 'delete',
  /** a client with orders: the server sends `archive` in place of `delete` (soft delete after confirmation) */
  archive: 'archive',
  /** an archived card (full-test CLIENTS-03, `POST /clients/:id/restore`) */
  restore: 'restore',
} as const;
export type ClientActionKey = (typeof CLIENT_ACTIONS)[keyof typeof CLIENT_ACTIONS];

/** Fee grid row (`GET /delivery/fees` rows carry `actions`). */
export const FEE_ACTIONS = { edit: 'edit', reset: 'reset' } as const;
