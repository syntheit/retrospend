-- ============================================================
-- Part A: Add userId to asset_snapshot and asset_history
-- ============================================================

ALTER TABLE "asset_snapshot" ADD COLUMN "userId" TEXT;
ALTER TABLE "asset_history"  ADD COLUMN "userId" TEXT;

-- Backfill userId from the parent asset_account row
UPDATE "asset_snapshot" s
SET "userId" = a."userId"
FROM "asset_account" a
WHERE s."accountId" = a.id;

UPDATE "asset_history" h
SET "userId" = a."userId"
FROM "asset_account" a
WHERE h."assetId" = a.id;

-- Make NOT NULL after backfill
ALTER TABLE "asset_snapshot" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "asset_history"  ALTER COLUMN "userId" SET NOT NULL;

-- Foreign key constraints
ALTER TABLE "asset_snapshot"
  ADD CONSTRAINT "asset_snapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_history"
  ADD CONSTRAINT "asset_history_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "asset_snapshot_userId_idx" ON "asset_snapshot"("userId");
CREATE INDEX "asset_history_userId_idx"  ON "asset_history"("userId");

-- ============================================================
-- Part B: Create app role and grant permissions
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retrospend_app') THEN
    CREATE ROLE retrospend_app;
  END IF;
END $$;

-- Allow the superuser to SET ROLE to retrospend_app
GRANT retrospend_app TO CURRENT_USER;

-- Grant CRUD on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO retrospend_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO retrospend_app;

-- Ensure future tables created by subsequent migrations also get these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retrospend_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO retrospend_app;

-- ============================================================
-- Part C: Enable RLS and create per-user isolation policies
-- ============================================================

-- Enable RLS on all user-owned tables
ALTER TABLE "expense"                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_template"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_account"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_snapshot"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_history"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rate_favorite"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_page_setting"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_category_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job"                    ENABLE ROW LEVEL SECURITY;

-- Per-table isolation policies: rows visible only when userId matches the
-- app.current_user_id session variable set by createUserScopedDb.
-- The TRUE second arg to current_setting() prevents errors when the variable
-- is not set — it returns NULL instead, meaning no rows pass the filter.

CREATE POLICY expense_isolation ON "expense"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY category_isolation ON "category"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY recurring_template_isolation ON "recurring_template"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY budget_isolation ON "budget"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY asset_account_isolation ON "asset_account"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY asset_snapshot_isolation ON "asset_snapshot"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY asset_history_isolation ON "asset_history"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY exchange_rate_favorite_isolation ON "exchange_rate_favorite"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY user_page_setting_isolation ON "user_page_setting"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY analytics_category_preference_isolation ON "analytics_category_preference"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY import_job_isolation ON "import_job"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));
