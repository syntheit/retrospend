-- ============================================================
-- RLS Hardening: additional tables, grant restrictions, FORCE RLS
-- ============================================================

-- ── Part A: Enable RLS on auth-adjacent tables ──────────────────────

ALTER TABLE "session"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "twoFactor"  ENABLE ROW LEVEL SECURITY;

-- Per-user isolation policies for session, account, twoFactor
DROP POLICY IF EXISTS session_isolation ON "session";
CREATE POLICY session_isolation ON "session"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS account_isolation ON "account";
CREATE POLICY account_isolation ON "account"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS two_factor_isolation ON "twoFactor";
CREATE POLICY two_factor_isolation ON "twoFactor"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

-- ── Part B: Revoke write on sensitive tables from retrospend_app ────
REVOKE INSERT, UPDATE, DELETE ON "password_reset_token" FROM retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "app_settings" FROM retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "exchange_rate" FROM retrospend_app;

-- ── Part C: FORCE ROW LEVEL SECURITY on all RLS-enabled tables ──────

-- Original 11 tables from previous migration
ALTER TABLE "expense"                       FORCE ROW LEVEL SECURITY;
ALTER TABLE "category"                      FORCE ROW LEVEL SECURITY;
ALTER TABLE "recurring_template"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget"                        FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_account"                 FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_snapshot"                FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_history"                 FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rate_favorite"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_page_setting"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "analytics_category_preference" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_job"                    FORCE ROW LEVEL SECURITY;

-- New tables from this migration
ALTER TABLE "session"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "account"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "twoFactor"  FORCE ROW LEVEL SECURITY;
