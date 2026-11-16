// Fee grid logic (DLV-01/02, 12 §6 "Fees", §20 "Grille des frais — actions"). Pure functions, unit tested.
import type { FeeRule, FeeRuleInput } from './contracts';

export type FeeField = 'homePrice' | 'stopdeskPrice' | 'returnPrice';
export const FEE_FIELDS: readonly FeeField[] = ['homePrice', 'stopdeskPrice', 'returnPrice'];

/**
 * Body of `PUT /delivery/fees/:wilayaId` after one change: the schema wants both prices on every write, so the full row
 * is sent with the edited value. `freeAbove` is sent only when the row has its own threshold.
 */
export function rowBody(row: FeeRule, patch: Partial<Pick<FeeRule, FeeField | 'isActive' | 'freeAbove'>>): FeeRuleInput {
  const next = { ...row, ...patch };
  const body: FeeRuleInput = { homePrice: next.homePrice, stopdeskPrice: next.stopdeskPrice, returnPrice: next.returnPrice, isActive: next.isActive };
  if (next.freeAbove !== null && next.freeAbove !== undefined) body.freeAbove = next.freeAbove;
  else if ('freeAbove' in patch) body.freeAbove = null;
  return body;
}

/** A change worth a write: the value differs from the stored one. */
export const isChange = (row: FeeRule, field: FeeField, value: number): boolean => Number.isInteger(value) && value >= 0 && row[field] !== value;

/** ↺ is offered only on custom rows (`DELETE` answers `422 FEE_RULE_NOT_FOUND` on a default row). */
export const canReset = (row: Pick<FeeRule, 'source'>): boolean => row.source === 'custom';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Search "Rechercher une wilaya…": code ("19", "09"), French or Arabic name, accent-insensitive. */
export function filterRows<T extends Pick<FeeRule, 'code' | 'nameFr' | 'nameAr' | 'wilayaId'>>(rows: readonly T[], q: string): T[] {
  const needle = fold(q);
  if (!needle) return [...rows];
  return rows.filter((r) => r.code === needle || String(r.wilayaId) === needle.replace(/^0+/, '') || fold(r.nameFr).includes(needle) || r.nameAr.includes(q.trim()));
}

/** Free-delivery rule of the workspace (`Workspace.freeDeliveryThreshold`): off when null. */
export const freeRule = (threshold: number | null | undefined): { enabled: boolean; amount: number | null } => ({ enabled: threshold !== null && threshold !== undefined && threshold > 0, amount: threshold ?? null });

/** Placeholder of the amount field when the rule is switched on without a previous value (Figma DLV-01: 5 000 DA). */
export const DEFAULT_FREE_THRESHOLD = 5_000;
/**
 * What flipping the switch saves: off ⇒ `null` (rule removed); on ⇒ the last amount, or nothing yet (`undefined`) — the
 * rule applies once the merchant typed his amount, never a 5 000 DA he did not choose (full-test DELIVERY-10).
 */
export const thresholdOnToggle = (enabled: boolean, last: number | null): number | null | undefined => (enabled ? (last && last > 0 ? last : undefined) : null);

/** Rows written by a seed ("12 wilayas complétées"): the answer's `written`, else the custom / missing difference. */
export function seedCount(before: { missing: number; custom: number }, after: { missing: number; custom: number; written?: number }, overwrite: boolean): number {
  if (typeof after.written === 'number') return after.written;
  return overwrite ? before.custom + before.missing : Math.max(0, before.missing - after.missing);
}
