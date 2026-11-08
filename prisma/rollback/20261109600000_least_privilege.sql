-- Rollback for migration 20261109600000_least_privilege. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that
-- owns the tables (the one that ran the migrations), against the database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261109600000_least_privilege.sql
--
-- It puts back what the migration changed on retrospend_app, checked against a
-- catalog diff by src/test/migrations/least-privilege-rollback.pg.test.ts:
--   * "user": row-level security off again, the two policies dropped, the
--     column-level SELECT and UPDATE grants gone, and SELECT, INSERT, UPDATE and DELETE
--     on the whole table back;
--   * SELECT, INSERT, UPDATE and DELETE back on _prisma_migrations,
--     verification, verification_token, session, account, "twoFactor",
--     username_history, event_log, invite_code, system_status, audit_log_entry
--     and error_report;
--   * invite_code: row-level security off again and its policy dropped;
--   * SELECT only back on password_reset_token and app_settings;
--   * the default privileges on tables (SELECT, INSERT, UPDATE, DELETE) and
--     sequences (USAGE, SELECT) for retrospend_app in schema public, for the
--     owner of every table and the role running this file.
-- It does not put back the PUBLIC default for new functions (the definer
-- hygiene rollback owns that) and it does not give CREATE on schema public
-- back to PUBLIC: that was already absent on Postgres 15 and later.
--
-- Rolling back reopens the exposure the migration closed: the app role can
-- again change anyone's role and email and read the auth tables. The code that
-- moved to the owner connection (username change, verification tokens, the
-- password check) works either way. Idempotent: running it twice changes
-- nothing more.

ALTER TABLE "user" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_select_all ON "user";
DROP POLICY IF EXISTS user_update_own ON "user";

-- Revoking on the table also revokes its column privileges.
REVOKE ALL ON "user" FROM retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user" TO retrospend_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "_prisma_migrations" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "verification" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "verification_token" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "twoFactor" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "username_history" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "event_log" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "invite_code" TO retrospend_app;
ALTER TABLE "invite_code" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invite_code_own ON "invite_code";
GRANT SELECT, INSERT, UPDATE, DELETE ON "system_status" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log_entry" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "error_report" TO retrospend_app;

GRANT SELECT ON "password_reset_token" TO retrospend_app;
GRANT SELECT ON "app_settings" TO retrospend_app;

DO $rollback$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT rolname
      FROM (
        SELECT current_user::text AS rolname
        UNION
        SELECT pg_get_userbyid(relowner)::text
          FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        UNION
        SELECT pg_get_userbyid(defaclrole)::text FROM pg_default_acl
      ) roles
  LOOP
    IF pg_has_role(current_user, r.rolname, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO retrospend_app', r.rolname);
    ELSE
      RAISE NOTICE 'least_privilege rollback: cannot set default privileges for role %', r.rolname;
    END IF;
  END LOOP;
END
$rollback$;
