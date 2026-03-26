CREATE TYPE "UserReportReason" AS ENUM (
  'SPAM',
  'ABUSE',
  'HARASSMENT',
  'SCAM',
  'IMPERSONATION',
  'OTHER'
);

CREATE TYPE "UserReportStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
  'DISMISSED'
);

CREATE TABLE "UserReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "groupId" TEXT,
  "messageId" TEXT,
  "reason" "UserReportReason" NOT NULL,
  "details" TEXT,
  "status" "UserReportStatus" NOT NULL DEFAULT 'OPEN',
  "adminNote" TEXT,
  "handledById" TEXT,
  "handledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserReport_status_createdAt_idx" ON "UserReport"("status", "createdAt");
CREATE INDEX "UserReport_reporterId_createdAt_idx" ON "UserReport"("reporterId", "createdAt");
CREATE INDEX "UserReport_targetUserId_status_idx" ON "UserReport"("targetUserId", "status");
CREATE INDEX "UserReport_groupId_status_idx" ON "UserReport"("groupId", "status");

ALTER TABLE "UserReport"
ADD CONSTRAINT "UserReport_reporterId_fkey"
FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserReport"
ADD CONSTRAINT "UserReport_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserReport"
ADD CONSTRAINT "UserReport_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserReport"
ADD CONSTRAINT "UserReport_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserReport"
ADD CONSTRAINT "UserReport_handledById_fkey"
FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
