-- Houssem live 24/11 UX-084 (client list L51): an order of services only is not delivered — it has no address and is confirmed without one
ALTER TABLE "Order" ADD COLUMN "noDelivery" BOOLEAN NOT NULL DEFAULT false;
-- the AI orders of services placed before this column (no wilaya, source ai, no delivery fee)
UPDATE "Order" SET "noDelivery" = true WHERE "source" = 'ai' AND "wilayaId" IS NULL AND "deliveryFee" = 0 AND "address" IS NULL;
