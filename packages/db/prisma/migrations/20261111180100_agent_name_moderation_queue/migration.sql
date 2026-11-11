-- Owner request 11/11 (« everything confirmed from the admin »): the agents that exist already wait for a moderator too —
-- one pending ModerationItem(type agent_name) each (separate migration: the new enum value must be committed first).
INSERT INTO "ModerationItem" ("workspaceId", "type", "agentId", "snapshot", "status", "aiFlags", "priority", "slaDueAt", "submittedAt", "source")
SELECT a."workspaceId", 'agent_name', a."id",
       jsonb_build_object('name', a."name", 'displayName', a."displayName", 'approvedName', NULL, 'approvedDisplayName', NULL),
       'pending', '[]'::jsonb, 'normal', now() + interval '24 hours', now(), 'create'
FROM "Agent" a
WHERE a."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ModerationItem" m WHERE m."agentId" = a."id" AND m."type" = 'agent_name' AND m."status" = 'pending');
