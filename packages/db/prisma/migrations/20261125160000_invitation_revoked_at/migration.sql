-- UX-103: a revoked invitation is kept (its link answers 410 « revoked ») instead of being deleted
ALTER TABLE "Invitation" ADD COLUMN "revokedAt" TIMESTAMP(3);
