-- ============================================================
-- RLS Hardening: additional tables, grant restrictions, FORCE RLS
-- ============================================================

-- ── Part A: Enable RLS on auth-adjacent tables ──────────────────────

ALTER TABLE "session"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "twoFactor" ENABLE ROW LEVEL SECURITY;
-- invite_code is NOT given RLS: application-layer filters (createdById)
-- are already in place in all protected procedures, and adding RLS here
-- would break the invite-code uniqueness check in generateUserCode (which
-- can't see other users' codes when running as retrospend_app).

-- Per-user isolation policies for session, account, two_factor
CREATE POLICY session_isolation ON "session"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY account_isolation ON "account"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

CREATE POLICY two_factor_isolation ON "twoFactor"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

-- ── Part B: Revoke write on sensitive tables from retrospend_app ────
-- password_reset_token: only written by publicProcedures (requestPasswordReset,
--   resetPassword) and adminProcedure (generatePasswordResetLink), all of which
--   use the global superuser db — never through ctx.db / retrospend_app role.
-- app_settings: only written via the settings service which imports global db.
-- NOTE: "verification" is intentionally NOT revoked here because resendVerificationEmail
--   is a protectedProcedure that writes to this table via retrospend_app.
REVOKE INSERT, UPDATE, DELETE ON "password_reset_token" FROM retrospend_app;
REVOKE INSERT, UPDATE, DELETE ON "app_settings" FROM retrospend_app;

-- exchange_rate is read-only for the app (populated by worker/admin)
REVOKE INSERT, UPDATE, DELETE ON "exchange_rate" FROM retrospend_app;

-- ── Part C: FORCE ROW LEVEL SECURITY on all RLS-enabled tables ──────
-- This ensures even the table owner cannot bypass RLS when SET ROLE is active.

-- Original 11 tables from previous migration
ALTER TABLE "expense"                       FORCE ROW LEVEL SECURITY;
ALTER TABLE "category"                      FORCE ROW LEVEL SECURITY;
ALTER TABLE "recurring_template"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget"                        FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_account"                 FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_snapshot"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_history"                FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rate_favorite"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_page_setting"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "analytics_category_preference" FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_job"                    FORCE ROW LEVEL SECURITY;

-- New tables from this migration
ALTER TABLE "session"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "account"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "twoFactor"  FORCE ROW LEVEL SECURITY;
