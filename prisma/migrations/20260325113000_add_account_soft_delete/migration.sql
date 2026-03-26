ALTER TABLE "User"
ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN "deletionScheduledFor" TIMESTAMP(3);

CREATE INDEX "User_deletionScheduledFor_idx" ON "User"("deletionScheduledFor");
