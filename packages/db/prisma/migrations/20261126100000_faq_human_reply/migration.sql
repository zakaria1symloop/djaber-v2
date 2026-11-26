-- owner decision 26/11 (« let the AI learn from human intervention »): an FAQ entry learnt from a team member's reply after a
-- hand-off of the AI. It is a suggestion (`isActive = false`) until the shop approves it; `sourceConversationId` is the conversation
-- it comes from (« Voir la conversation »), set to NULL when that conversation is deleted.
-- The new enum value is only added here: nothing in this migration uses it (Postgres refuses a value used in the transaction that adds it).
ALTER TYPE "FaqSource" ADD VALUE IF NOT EXISTS 'human_reply';

ALTER TABLE "AgentFaq" ADD COLUMN "sourceConversationId" UUID;
ALTER TABLE "AgentFaq" ADD CONSTRAINT "AgentFaq_sourceConversationId_fkey" FOREIGN KEY ("sourceConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AgentFaq_sourceConversationId_idx" ON "AgentFaq"("sourceConversationId");
