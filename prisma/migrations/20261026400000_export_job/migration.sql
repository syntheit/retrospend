-- API v1 exports (G5). Placeholder timestamp: the orchestrator assigns the
-- final one at merge.
-- export_job: one asynchronous export request and its file. `params` holds
-- ids only; the file sits in the upload store (`storagePath`) until
-- `expiresAt`, when the next export request for that user deletes both.
-- Written and read through the user-scoped db, so RLS holds. Additive and
-- idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExportJobStatus') THEN
    CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "export_job" (
  "id"          TEXT              NOT NULL,
  "userId"      TEXT              NOT NULL,
  "kind"        VARCHAR(40)       NOT NULL,
  "params"      JSONB             NOT NULL,
  "timeZone"    VARCHAR(64)       NOT NULL,
  "status"      "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "fileName"    VARCHAR(255),
  "contentType" VARCHAR(100),
  "sizeBytes"   INTEGER,
  "storagePath" VARCHAR(512),
  "error"       VARCHAR(500),
  "createdAt"   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt"   TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "export_job_userId_createdAt_idx" ON "export_job"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "export_job_expiresAt_idx" ON "export_job"("expiresAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_job_userId_fkey') THEN
    ALTER TABLE "export_job"
      ADD CONSTRAINT "export_job_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ENABLE without FORCE: system code reads through the owner connection.
ALTER TABLE "export_job" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS export_job_isolation ON "export_job";
CREATE POLICY export_job_isolation ON "export_job"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "export_job" TO retrospend_app;
