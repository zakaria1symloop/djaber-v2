-- client list L78 (Houssem live 24/11): a bulk price change could leave the crossed-out price at or below the price; such a value is
-- shown nowhere (the screens and the AI only show an old price above the price) and made the exported file fail its own import
UPDATE "Product" SET "oldPrice" = NULL WHERE "oldPrice" IS NOT NULL AND "oldPrice" <= "price";
