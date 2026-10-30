-- Mobile feedback and error reports. Placeholder timestamp: the orchestrator
-- assigns the final one at merge.
-- feedback gains a category, a private screenshot path and the diagnostics the
-- person chose to include. error_report holds crashes the app recorded and the
-- person chose to send to their own server; admins read them with the global
-- connection, a person only inserts and reads their own.

ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "screenshotPath" TEXT;
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "diagnostics" JSONB;

CREATE TABLE IF NOT EXISTS "error_report" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "screen" TEXT,
    "appVersion" TEXT,
    "build" TEXT,
    "os" TEXT,
    "device" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "error_report_userId_idx" ON "error_report"("userId");
CREATE INDEX IF NOT EXISTS "error_report_createdAt_idx" ON "error_report"("createdAt");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'error_report_userId_fkey') THEN ALTER TABLE "error_report" ADD CONSTRAINT "error_report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

ALTER TABLE "error_report" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON "error_report" TO retrospend_app;

DROP POLICY IF EXISTS "error_report_insert_own" ON "error_report";
CREATE POLICY "error_report_insert_own" ON "error_report"
    FOR INSERT
    TO retrospend_app
    WITH CHECK ("userId" = current_setting('app.current_user_id', true));

DROP POLICY IF EXISTS "error_report_select_own" ON "error_report";
CREATE POLICY "error_report_select_own" ON "error_report"
    FOR SELECT
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));

DROP POLICY IF EXISTS "error_report_delete_own" ON "error_report";
CREATE POLICY "error_report_delete_own" ON "error_report"
    FOR DELETE
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));
