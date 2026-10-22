-- UI overhaul rollout flags (M13). Each mode is OFF, ADMINS (admin role
-- only) or ALL, and is read through src/server/flags.ts.
-- 1. app_settings."uiV2Mode": the new shell and every v2 page.
-- 2. app_settings."apiV1Mode": /api/v1 and the API keys UI.
-- envelopeBudgetMode arrives with the envelope books migration (M6) and
-- reuses the FeatureFlagMode type created here.
-- app_settings is a global singleton without RLS. retrospend_app keeps its
-- existing SELECT-only grant (20260303000002_rls_hardening), which covers
-- the new columns, so only the admin path can change a flag.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FeatureFlagMode') THEN
    CREATE TYPE "FeatureFlagMode" AS ENUM ('OFF', 'ADMINS', 'ALL');
  END IF;
END $$;

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "uiV2Mode"  "FeatureFlagMode" NOT NULL DEFAULT 'OFF';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "apiV1Mode" "FeatureFlagMode" NOT NULL DEFAULT 'OFF';
