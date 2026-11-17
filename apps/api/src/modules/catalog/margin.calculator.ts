// GDS-09 / EXP-02 — true cost and margin of a product.
// true cost = weighted average cost (updated at purchase receipt only) + per-unit expenses
//             + fixed expenses of the period / units sold in the period;  margin % = (price − true cost) / price.
import { roundHalfUp } from '@djaber/shared';
import { periodRange } from '../../core/time/period';

export const MARGIN_PERIOD_DAYS = 30;
/**
 * journey 16/11 J14-10 — « sold » is the named figure of 04 §4 (Ventes par produit, Statistiques › Top produits): delivered
 * orders (by `deliveredAt`) + completed counter sales (by `soldAt`), over the reports' « 30 j » period (today and the 29
 * days before, Africa/Algiers). An order not delivered yet holds reserved stock; it is never counted as sold.
 */
export const MARGIN_SOLD_ORDER_STATUS = 'delivered' as const;
/** First instant of the 30-day period of the product page and the margins (the reports' `30d` preset). */
export const marginSince = (now: Date = new Date()): Date => periodRange({ period: '30d' }, now).gte!;

export type MarginInput = {
  price: number;
  /** `Product.costPrice` (null when the merchant never entered a cost) */
  weightedCost: number | null;
  /** per-unit expenses: all of them; fixed expenses: those dated inside the period */
  expenses: { amount: number; isPerUnit: boolean }[];
  /** units sold in the period (delivered orders + completed counter sales, 04 §4) */
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
