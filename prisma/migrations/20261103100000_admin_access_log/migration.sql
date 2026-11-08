-- Admin access log. One row each time an admin acts on a person's account, so
-- the person can see it in Settings. The admin writes with the global
-- connection; the app role can only read its own rows, never add, change or
-- delete one. Placeholder timestamp: the orchestrator assigns the final one at
-- merge.

CREATE TABLE IF NOT EXISTS "admin_access_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_access_log_userId_createdAt_idx" ON "admin_access_log"("userId", "createdAt");

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_access_log_userId_fkey') THEN ALTER TABLE "admin_access_log" ADD CONSTRAINT "admin_access_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

ALTER TABLE "admin_access_log" ENABLE ROW LEVEL SECURITY;

-- Default privileges grant full CRUD on new tables; take the writes back.
REVOKE INSERT, UPDATE, DELETE ON "admin_access_log" FROM retrospend_app;
GRANT SELECT ON "admin_access_log" TO retrospend_app;

DROP POLICY IF EXISTS "admin_access_log_select_own" ON "admin_access_log";
CREATE POLICY "admin_access_log_select_own" ON "admin_access_log"
    FOR SELECT
    TO retrospend_app
    USING ("userId" = current_setting('app.current_user_id', true));
