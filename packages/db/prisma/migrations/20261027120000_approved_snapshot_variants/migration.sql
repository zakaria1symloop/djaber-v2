-- Tester log 26/10 UX-038: the approved snapshots written before 2026-10-26 (moderation of variants, UX-006 of 25/10)
-- carry no `variants`, so the AI showed every live variant of such a product, a variant still waiting for review
-- included. Data only, written once:
--  - a product not waiting for a decision keeps selling what it sells now: its current variants become the approved list;
--  - a product waiting for a decision keeps the variants that existed before variants were reviewed (created before
--    2026-10-26 09:20 UTC — Prisma stores UTC without a zone); a newer one waits for the moderator like any change.
UPDATE "Product" p
SET "approvedSnapshot" = p."approvedSnapshot" || jsonb_build_object('variants', COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', v."id", 'name', v."name", 'price', v."price") ORDER BY v."createdAt", v."id")
  FROM "ProductVariant" v
  WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive"
    AND (p."moderationStatus" <> 'pending' OR v."createdAt" < TIMESTAMP '2026-10-26 09:20:00')
), '[]'::jsonb))
WHERE p."approvedSnapshot" IS NOT NULL AND jsonb_typeof(p."approvedSnapshot") = 'object' AND NOT (p."approvedSnapshot" ? 'variants');

-- the open requests of that time: the moderator approves the product as it is now, variants included
UPDATE "ModerationItem" m
SET "snapshot" = m."snapshot" || jsonb_build_object('variants', COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', v."id", 'name', v."name", 'price', v."price") ORDER BY v."createdAt", v."id")
  FROM "ProductVariant" v
  WHERE v."productId" = m."productId" AND v."deletedAt" IS NULL AND v."isActive"
), '[]'::jsonb))
WHERE m."status" = 'pending' AND m."type" = 'product' AND m."productId" IS NOT NULL
  AND jsonb_typeof(m."snapshot") = 'object' AND NOT (m."snapshot" ? 'variants');
