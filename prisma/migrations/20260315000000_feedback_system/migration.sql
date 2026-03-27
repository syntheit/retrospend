-- CreateTable
CREATE TABLE IF NOT EXISTS "feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "userAgent" TEXT,
    "viewportSize" TEXT,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_userId_idx" ON "feedback"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_status_idx" ON "feedback"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedback_createdAt_idx" ON "feedback"("createdAt");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_userId_fkey') THEN ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- Enable RLS
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "feedback" TO retrospend_app;

-- Users can insert their own feedback
DROP POLICY IF EXISTS "feedback_insert_own" ON "feedback";
CREATE POLICY "feedback_insert_own" ON "feedback"
    FOR INSERT
    TO retrospend_app
    WITH CHECK ("userId" = current_setting('app.current_user_id', true));

-- Users can read their own feedback (not strictly needed but harmless)
DROP POLICY IF EXISTS "feedback_select_own" ON "feedback";
CREATE POLICY "feedback_select_own" ON "feedback"
    FOR SELECT
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));
