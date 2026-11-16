-- Full-test 15/11 SALES-CASH-01 / -02: a draft sale keeps the amount the seller typed as received (the cash only moves
-- when the sale is validated, from the sheet or from the row menu).
ALTER TABLE "Sale" ADD COLUMN "draftAmountReceived" INTEGER;
