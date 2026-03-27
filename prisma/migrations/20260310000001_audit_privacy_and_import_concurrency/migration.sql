-- Move AUDIT_PRIVACY_MODE and MAX_CONCURRENT_IMPORT_JOBS from env vars to database settings

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditPrivacyMode') THEN
    CREATE TYPE "AuditPrivacyMode" AS ENUM ('MINIMAL', 'ANONYMIZED', 'FULL');
  END IF;
END $$;

ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "auditPrivacyMode" "AuditPrivacyMode" NOT NULL DEFAULT 'MINIMAL',
  ADD COLUMN IF NOT EXISTS "maxConcurrentImportJobs" INTEGER NOT NULL DEFAULT 3;
