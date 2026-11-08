-- Least privilege for retrospend_app (access hardening, PR 2).
--
-- 20260303000001_security_rls handed the app role SELECT, INSERT, UPDATE and
-- DELETE on every table (and, through default privileges, on every table made
-- after), and 20260309000000 did it again. Later migrations narrowed some
-- tables, but a table made after the first blanket grant kept the default
-- CRUD unless its own migration revoked it. This migration sets each table to
-- what a user-scoped path (protectedProcedure, API v1, userTransaction) really
-- uses, found by reading the live catalog and tracing every call site, and
-- stops new tables, sequences and functions from getting a grant on their own.
--
-- The app role keeps nothing on:
--   _prisma_migrations   migrations run as the owner
--   verification, verification_token, password_reset_token, session, account,
--   "twoFactor"          auth data: better-auth and the auth procedures use
--                        the owner connection (resendVerificationEmail, the
--                        password check in profile.service and the guest
--                        resume link were moved there with this change)
--   username_history     the username change is one owner-side service
--                        (username.service.ts); it edits other users'
--                        reservation rows by design
--   event_log            the audit log is written by audit.service
--   app_settings         read only through the owner connection
--
-- It keeps only what is used on:
--   invite_code          SELECT, INSERT, DELETE on a user's own codes, with
--                        row-level security: createdById is the caller
--   system_status        SELECT: the worker heartbeat shown in the app
--   audit_log_entry      loses UPDATE and DELETE (no policy allowed them)
--   error_report         loses UPDATE (no policy allowed it)
--
-- "user" gets row-level security: every row is readable (shared views show
-- other people's names), only the caller's own row is updatable, and INSERT and
-- DELETE are gone. SELECT is limited by column to everything except
-- pendingEmailToken (a secret) and consentIp (personal data): no scoped read
-- may select them, so every scoped read of "user" names its columns. UPDATE is
-- limited by column, to the profile and settings columns scoped code writes. role, email, emailVerified, isActive,
-- username, lastUsernameChangeAt, the two-factor column and everything else
-- are written only on the owner connection.
--
-- Default privileges: new tables, sequences and functions are not granted to
-- retrospend_app or PUBLIC. A migration that adds one grants what the app role
-- needs itself, in the same file. Defaults are set for the role running this
-- migration and every role that already owns defaults (dev migrates as one
-- role, production as another).
--
-- Idempotent: every statement can run again. prisma/rollback holds the
-- snippet that puts the previous grants back.

-- ---------------------------------------------------------------------------
-- "user": row-level security and column grants
-- ---------------------------------------------------------------------------

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_select_all ON "user";
CREATE POLICY user_select_all ON "user"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING (true);

DROP POLICY IF EXISTS user_update_own ON "user";
CREATE POLICY user_update_own ON "user"
  AS PERMISSIVE FOR UPDATE TO retrospend_app
  USING ("id" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("id" = current_setting('app.current_user_id', TRUE));

-- Revoking on the table also revokes every column privilege on it. A column
-- added later is not readable by the app role until a migration grants it (the
-- privilege ratchet fails first).
REVOKE ALL ON "user" FROM retrospend_app;
GRANT SELECT (
  "id", "name", "username", "email", "emailVerified", "image",
  "homeCurrency", "categoryClickBehavior", "role", "isActive", "createdAt",
  "updatedAt", "defaultCurrency", "currencySymbolStyle", "monthlyIncome",
  "smartCurrencyFormatting", "defaultPrivacyMode", "twoFactorEnabled",
  "monthlyIncomeCurrency", "fiscalMonthStartDay", "defaultExpenseDateBehavior",
  "aiMode", "externalAiAllowed", "avatarPath", "consentedAt", "consentVersion",
  "lastUsernameChangeAt", "pendingEmail", "pendingEmailExpiresAt", "language",
  "autoAcceptSplits", "defaultRateTypes", "defaultAccounts", "timeZone",
  "numberFormat", "aiImportEnabled"
) ON "user" TO retrospend_app;
GRANT UPDATE (
  -- profile: profile.service, avatar.service, the pending email change
  "name",
  "avatarPath",
  "pendingEmail",
  "pendingEmailToken",
  "pendingEmailExpiresAt",
  -- settings: general-settings.service
  "homeCurrency",
  "defaultCurrency",
  "categoryClickBehavior",
  "currencySymbolStyle",
  "numberFormat",
  "monthlyIncome",
  "monthlyIncomeCurrency",
  "smartCurrencyFormatting",
  "defaultPrivacyMode",
  "autoAcceptSplits",
  "fiscalMonthStartDay",
  "defaultExpenseDateBehavior",
  "aiMode",
  "aiImportEnabled",
  "language",
  "timeZone",
  -- other per-user preferences and consent
  "defaultAccounts",
  "defaultRateTypes",
  "consentedAt",
  "consentVersion",
  "consentIp",
  -- Prisma sets it on every update
  "updatedAt"
) ON "user" TO retrospend_app;

-- ---------------------------------------------------------------------------
-- Tables the app role no longer touches
-- ---------------------------------------------------------------------------

REVOKE ALL ON "_prisma_migrations" FROM retrospend_app;
REVOKE ALL ON "verification" FROM retrospend_app;
REVOKE ALL ON "verification_token" FROM retrospend_app;
REVOKE ALL ON "password_reset_token" FROM retrospend_app;
REVOKE ALL ON "session" FROM retrospend_app;
REVOKE ALL ON "account" FROM retrospend_app;
REVOKE ALL ON "twoFactor" FROM retrospend_app;
REVOKE ALL ON "username_history" FROM retrospend_app;
REVOKE ALL ON "event_log" FROM retrospend_app;
REVOKE ALL ON "app_settings" FROM retrospend_app;

-- ---------------------------------------------------------------------------
-- Tables that keep a part
-- ---------------------------------------------------------------------------

REVOKE ALL ON "invite_code" FROM retrospend_app;
GRANT SELECT, INSERT, DELETE ON "invite_code" TO retrospend_app;

-- A user sees, creates and deletes only the codes they made. Public validation,
-- sign-up and the admin list run on the owner connection and bypass this.
ALTER TABLE "invite_code" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invite_code_own ON "invite_code";
CREATE POLICY invite_code_own ON "invite_code"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("createdById" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("createdById" = current_setting('app.current_user_id', TRUE));

REVOKE ALL ON "system_status" FROM retrospend_app;
GRANT SELECT ON "system_status" TO retrospend_app;

REVOKE UPDATE, DELETE ON "audit_log_entry" FROM retrospend_app;
REVOKE UPDATE ON "error_report" FROM retrospend_app;

-- ---------------------------------------------------------------------------
-- Default privileges: nothing is granted to retrospend_app or PUBLIC by
-- default. Each pg_default_acl owner gets the same treatment, plus the role
-- running this migration.
-- ---------------------------------------------------------------------------

DO $migration$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT rolname
      FROM (
        SELECT current_user::text AS rolname
        UNION
        SELECT pg_get_userbyid(defaclrole)::text FROM pg_default_acl
      ) roles
  LOOP
    IF pg_has_role(current_user, r.rolname, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON FUNCTIONS FROM PUBLIC, retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC', r.rolname);
    ELSE
      RAISE NOTICE 'least_privilege: cannot set default privileges for role %', r.rolname;
    END IF;
  END LOOP;
END
$migration$;

-- Nobody but the owner creates objects in public. A no-op on Postgres 15 and
-- later, where PUBLIC no longer has it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
