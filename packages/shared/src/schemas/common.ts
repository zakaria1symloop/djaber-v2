import { z } from 'zod';

/** api-contract §1.6: pageSize ∈ {25, 50, 100}, default 25. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .refine((n) => n === 25 || n === 50 || n === 100, 'validation.range')
    .default(25),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z]+$/)
    .optional(),
  view: z.string().uuid().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Cursor lists (inbox, messages, notifications): limit ≤ 50, default 50. */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

/** api-contract: one entry per row/detail action; the UI builds the `Actions ⌄` menu from it. */
export type ActionDescriptor = {
  key: string;
  enabled: boolean;
  reasonCode?: string;
  /** values of the reason's placeholders (`{retryAfter}` in seconds, `{from}` / `{to}` status values…) — UX-060 */
  reasonParams?: Record<string, string | number>;
  primary?: boolean;
  shortcut?: string;
};

/**
 * 12 GLOBAL "Disabled reasons" (UX-060, retest 12/11): an action the state machine does not allow in the current state is
 * not offered at all — the descriptor is left out of `actions` (API) and skipped by the menus (web, mobile). Greyed items
 * are kept for the refusals the member can act on or should know (permission, plan, missing data, rate limit…).
 */
// UX-064: on a delivered / cancelled / returned order the send items are not offered either
export const NOT_OFFERED_REASONS: readonly string[] = ['ORDER_INVALID_TRANSITION', 'DELIVERY_ORDER_DELIVERED', 'DELIVERY_ORDER_CANCELLED', 'DELIVERY_ORDER_RETURNED'];
export const isNotOffered = (d: Pick<ActionDescriptor, 'enabled' | 'reasonCode'>): boolean => !d.enabled && !!d.reasonCode && NOT_OFFERED_REASONS.includes(d.reasonCode);
