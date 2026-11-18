-- Journey J06r-5b (J06-10g): a validated counter sale keeps the amount the seller typed as received, so the ticket prints
-- « Montant reçu » and « Rendu » (the change given back); `amountPaid` stays capped at the total.
ALTER TABLE "Sale" ADD COLUMN "amountReceived" INTEGER;
