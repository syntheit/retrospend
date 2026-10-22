-- UI overhaul rollout flags (M13). Each mode is OFF, ADMINS (admin role
-- only) or ALL, and is read through src/server/flags.ts.
-- 1. app_settings."uiV2Mode": the new shell and every v2 page.
-- 2. app_settings."apiV1Mode": /api/v1 and the API keys UI.
-- envelopeBudgetMode arrives with the envelope books migration (M6) and
-- reuses the FeatureFlagMode type created here.
-- app_settings is a global singleton without RLS, so the only guard on the
-- flags is the table grant: retrospend_app may read them, and only the
-- owner connection (settings service, admin procedures) may change them.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeatureFlagMode') THEN
    CREATE TYPE "FeatureFlagMode" AS ENUM ('OFF', 'ADMINS', 'ALL');
  END IF;
END $$;

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "uiV2Mode"  "FeatureFlagMode" NOT NULL DEFAULT 'OFF';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "apiV1Mode" "FeatureFlagMode" NOT NULL DEFAULT 'OFF';

-- 20260303000002_rls_hardening revoked these writes, but the blanket
-- re-grant in 20260309000000_fix_retrospend_app_schema_usage handed them
-- back. Revoke again so user-scoped queries cannot flip a flag.
GRANT SELECT ON "app_settings" TO retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "app_settings" FROM retrospend_app;
