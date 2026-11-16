// 04 §20 (journeys 16/11 J07-5) — which purchases count in the money figures (supplier balance and totals, purchase KPIs,
// stock dashboard « dû aux fournisseurs », purchase reports): an ordered / received purchase, and a purchase cancelled
// after a partial receipt — its received units stay bought and owed (« reverses only unpaid amounts »). A draft and a
// purchase cancelled before any receipt do not count.
import { Prisma } from '@djaber/db';

/** Prisma filter of the purchases that count. */
export const COUNTED_PURCHASE: Prisma.PurchaseWhereInput = {
  OR: [{ status: { in: ['pending', 'partial', 'received'] } }, { status: 'cancelled', items: { some: { receivedQty: { gt: 0 } } } }],
};

/** Same filter in raw SQL, `alias` = the alias of the "Purchase" table in the query (a trusted identifier, never input). */
export const countedPurchaseSql = (alias = '"Purchase"') => {
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}."status" IN ('pending', 'partial', 'received') OR (${a}."status" = 'cancelled' AND EXISTS (SELECT 1 FROM "PurchaseItem" ci WHERE ci."purchaseId" = ${a}."id" AND ci."receivedQty" > 0)))`;
};

/** A cancelled purchase with received units keeps what is still owed for them (04 §20). */
export const receivedAny = (items: { receivedQty: number }[] | undefined) => !!items?.some((i) => i.receivedQty > 0);
