-- AlterEnum
ALTER TYPE "DataDeletionStatus" ADD VALUE 'no_data';

-- AlterEnum
ALTER TYPE "WorkspaceStatus" ADD VALUE 'purged';

-- AlterTable
ALTER TABLE "DataDeletionRequest" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestedById" UUID,
ADD COLUMN     "result" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'callback',
ADD COLUMN     "targetPhone" TEXT,
ADD COLUMN     "workspaceId" UUID,
ALTER COLUMN "externalUserId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "DataDeletionRequest_provider_externalUserId_status_idx" ON "DataDeletionRequest"("provider", "externalUserId", "status");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_source_requestedAt_idx" ON "DataDeletionRequest"("source", "requestedAt");
