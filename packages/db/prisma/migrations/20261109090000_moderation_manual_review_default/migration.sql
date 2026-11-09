-- PV 09/11 « les produits sont directement validés sans aucune modération et ne s'affichent pas dans le dashboard super
-- admin »: every product waits for a super admin's decision (moderation_policy.manualReviewAll = true). The platform can
-- switch auto-approval back on in Paramètres plateforme › Modération. The row is kept (versioned setting) when it exists.
UPDATE "PlatformSetting" SET "value" = jsonb_set("value"::jsonb, '{manualReviewAll}', 'true'::jsonb), "version" = "version" + 1, "updatedAt" = now()
WHERE "key" = 'moderation_policy' AND COALESCE(("value"::jsonb ->> 'manualReviewAll')::boolean, false) = false;
-- no row yet: written in the name of the first super admin (a database being created has none yet: the code default,
-- manual review, applies)
INSERT INTO "PlatformSetting" ("id", "key", "value", "version", "updatedById", "updatedAt")
SELECT uuid_generate_v7(), 'moderation_policy', '{"manualReviewAll": true}'::jsonb, 1, u."id", now()
FROM "User" u
WHERE u."platformRole" = 'super_admin' AND NOT EXISTS (SELECT 1 FROM "PlatformSetting" WHERE "key" = 'moderation_policy')
ORDER BY u."createdAt"
LIMIT 1;
