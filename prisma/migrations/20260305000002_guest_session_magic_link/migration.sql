-- ============================================================
-- Guest Session: add magicLinkId, projectId, lastActiveAt
-- ============================================================

ALTER TABLE "guest_session" ADD COLUMN IF NOT EXISTS "magicLinkId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "guest_session" ADD COLUMN IF NOT EXISTS "projectId"   TEXT NOT NULL DEFAULT '';
ALTER TABLE "guest_session" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "guest_session_projectId_idx" ON "guest_session"("projectId");
