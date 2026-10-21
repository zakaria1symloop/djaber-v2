// GDS-09 / EXP-02 — true cost and margin of a product.
// true cost = weighted average cost (updated at purchase receipt only) + per-unit expenses
//             + fixed expenses of the period / units sold in the period;  margin % = (price − true cost) / price.
import { roundHalfUp } from '@djaber/shared';

export const MARGIN_PERIOD_DAYS = 30;
/** Orders whose units count as sold for the fixed-expense share (not cancelled / returned). */
export const MARGIN_SOLD_STATUSES = ['new', 'confirmed', 'preparing', 'shipped', 'delivered'] as const;

export type MarginInput = {
  price: number;
  /** `Product.costPrice` (null when the merchant never entered a cost) */
  weightedCost: number | null;
  /** per-unit expenses: all of them; fixed expenses: those dated inside the period */
  expenses: { amount: number; isPerUnit: boolean }[];
  /** units sold in the period (orders not cancelled / returned + completed counter sales) */
  unitsSold: number;
};
export type Margins = {
  weightedCost: number | null;
  expensesPerUnit: number;
  trueCost: number | null;
  marginDzd: number | null;
  marginPct: number | null;
};

export const computeMargins = (i: MarginInput): Margins => {
  const perUnit = i.expenses.filter((e) => e.isPerUnit).reduce((s, e) => s + e.amount, 0);
  const fixed = i.expenses.filter((e) => !e.isPerUnit).reduce((s, e) => s + e.amount, 0);
  // nothing sold yet: the fixed amount weighs on one unit (V1 behaviour, avoids a division by zero)
  const expensesPerUnit = perUnit + roundHalfUp(fixed / Math.max(i.unitsSold, 1));
  if (i.weightedCost === null) return { weightedCost: null, expensesPerUnit, trueCost: null, marginDzd: null, marginPct: null };
  const trueCost = i.weightedCost + expensesPerUnit;
  const marginDzd = i.price - trueCost;
  return {
    weightedCost: i.weightedCost,
    expensesPerUnit,
    trueCost,
    marginDzd,
    marginPct: i.price > 0 ? Math.round((marginDzd * 1000) / i.price) / 10 : null,
  };
};
