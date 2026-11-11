-- Owner request 11/11: an agent's name and display name (what customers read) are approved by a moderator first.
CREATE TYPE "AgentNameStatus" AS ENUM ('pending', 'approved', 'rejected');
ALTER TYPE "ModerationItemType" ADD VALUE 'agent_name';
ALTER TYPE "NotificationType" ADD VALUE 'agent_name_approved';
ALTER TYPE "NotificationType" ADD VALUE 'agent_name_rejected';
ALTER TABLE "Agent" ADD COLUMN "approvedName" TEXT,
ADD COLUMN "approvedDisplayName" TEXT,
ADD COLUMN "nameStatus" "AgentNameStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "nameRejectReason" TEXT;
