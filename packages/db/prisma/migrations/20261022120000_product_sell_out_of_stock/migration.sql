-- Per-product option: accept orders when the stock is zero (meeting PV 22/10, PV7).
ALTER TABLE "Product" ADD COLUMN "sellOutOfStock" BOOLEAN NOT NULL DEFAULT false;
