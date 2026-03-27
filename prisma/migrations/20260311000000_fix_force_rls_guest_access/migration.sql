-- ============================================================
-- Fix: Remove FORCE ROW LEVEL SECURITY from tables accessed
--      by public/guest procedures via the global DB connection
--
-- FORCE ROW LEVEL SECURITY makes even the table owner subject
-- to RLS policies. Since all policies target only retrospend_app,
-- the global connection (used by publicProcedure, guest auth
-- middleware, and better-auth session lookup) cannot read ANY
-- rows when the connection role is not a superuser.
--
-- This breaks:
--   - guest.validateLink (magic_link lookup)
--   - guest.register (guest_session + project_participant creation)
--   - guestOrProtectedProcedure auth (guest_session lookup)
--   - project.detail and all guest project queries
--   - better-auth getSession() (session table lookup)
--
-- Fix: Remove FORCE so the table owner bypasses RLS (standard
-- PostgreSQL behavior). The retrospend_app role still has RLS
-- enforced via ENABLE ROW LEVEL SECURITY + per-table policies.
-- App-level authorization (assertGuestProjectScope, requireProjectRole)
-- handles guest access control.
-- ============================================================

-- Tables from shared_expenses_schema migration
ALTER TABLE "guest_session"       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "shadow_profile"      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "shared_transaction"  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "split_participant"   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "settlement"          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log_entry"     NO FORCE ROW LEVEL SECURITY;

-- Tables from project_schema migration
ALTER TABLE "project"             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "project_participant" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_period"      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "magic_link"          NO FORCE ROW LEVEL SECURITY;

-- Tables from rls_hardening migration (auth tables used by better-auth)
ALTER TABLE "session"             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account"             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "twoFactor"           NO FORCE ROW LEVEL SECURITY;

-- Tables from rls_hardening migration (user-owned tables)
-- These are ONLY accessed via createUserScopedDb (which sets role
-- to retrospend_app), so FORCE is technically safe but unnecessary
-- and inconsistent. Remove for uniformity.
ALTER TABLE "expense"                       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "category"                      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recurring_template"            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "budget"                        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_account"                 NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_snapshot"                NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_history"                 NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rate_favorite"        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_page_setting"             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "analytics_category_preference" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_job"                    NO FORCE ROW LEVEL SECURITY;

-- payment_methods migration
ALTER TABLE "payment_method"      NO FORCE ROW LEVEL SECURITY;

-- ai_provider_support migration
ALTER TABLE "ai_usage"            NO FORCE ROW LEVEL SECURITY;
