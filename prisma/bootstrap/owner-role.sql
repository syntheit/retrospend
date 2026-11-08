-- Run by the database superuser, and by nobody else, at the start of every
-- container start (scripts/db-owner). It is the only SQL that ever needs more
-- than the table owner's rights; everything after it (the migrations, the
-- grants file, the app) runs as retrospend_owner, which is not a superuser.
--
-- It does exactly what the owner cannot do for itself:
--   1. creates retrospend_app (the role row-level security targets) and the
--      login role retrospend_owner (no superuser, no CREATEDB, no CREATEROLE;
--      BYPASSRLS because four tables are FORCE ROW LEVEL SECURITY and the
--      app's global client and pg_dump must keep seeing every row);
--   2. lets the owner grant retrospend_app (WITH ADMIN OPTION), which an old
--      migration does with GRANT retrospend_app TO CURRENT_USER;
--   3. takes CREATE on the database away from the owner if it somehow holds it.
--      The owner never holds it. scripts/db-owner gives it only to a one-shot
--      migration role on a brand-new, empty install, while `prisma migrate
--      deploy` runs (the first migration says CREATE SCHEMA IF NOT EXISTS, which
--      Postgres checks against CREATE before it looks whether the schema
--      exists), and drops that role in a `finally`. An upgrade gets no CREATE for
--      anyone, so no pending migration may need it
--      (src/test/migrations/database-create.test.ts): anything that does goes in
--      this file. With CREATE the owner could CREATE EXTENSION a trusted
--      extension into a schema it controls, whose install script then runs as
--      the superuser, or drop and recreate public;
--   4. creates the unaccent extension (needs CREATE on the database);
--   5. creates the keystore schema for the owner (same reason);
--   6. keeps PUBLIC from creating objects in public.
-- The ownership handover (owner-handover.sql) is the second half.
--
-- THE RULE for everything in prisma/bootstrap: this SQL runs as the superuser,
-- and the owner owns every table, function, type and view in public and
-- keystore and can create new ones, so the superuser here never reads, writes
-- or calls an object the owner owns or could create. Only pg_catalog, fixed DDL
-- on roles, databases and schemas, and ALTER ... OWNER (which runs no owner
-- code). A SELECT from a table in public would let the owner swap it for a view
-- that calls a function, and that function would run as the superuser (granting
-- itself pg_execute_server_program, say). scripts/db-owner checks the result
-- from the catalogs afterwards (owner-verify.sql) and refuses to start.
--
-- Safe to repeat: every statement checks first, so a normal start writes
-- nothing. The password is not set here (it is a derived secret that never
-- belongs in a file); scripts/db-owner sets it only when a login fails.
--
-- The script runs this with search_path = pg_catalog, pg_temp, so nothing a
-- schema owner defines can shadow a function this file calls as a superuser.
-- Migrations never name retrospend_owner (AGENTS.md 6.3): the role is made
-- here, once.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '10s';
-- One bootstrap at a time per database. Roles are cluster-wide, so the script
-- also retries when two databases create the same role at the same moment.
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('retrospend_owner bootstrap'));

DO $role$
DECLARE
  r pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_app') THEN
    CREATE ROLE retrospend_app;
  END IF;

  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_owner';
  IF NOT FOUND THEN
    CREATE ROLE retrospend_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION BYPASSRLS INHERIT;
  ELSIF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
        OR NOT r.rolbypassrls OR NOT r.rolcanlogin OR NOT r.rolinherit THEN
    ALTER ROLE retrospend_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION BYPASSRLS INHERIT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE roleid = 'retrospend_app'::pg_catalog.regrole
       AND member = 'retrospend_owner'::pg_catalog.regrole
       AND admin_option
  ) THEN
    GRANT retrospend_app TO retrospend_owner WITH ADMIN OPTION;
  END IF;
END
$role$;

-- No CREATE on the database here: see item 3 in the header. A catalog check, no
-- table of the owner's is read. This also repairs a crash between the grant and
-- the revoke around the migrations of a new install.
DO $database$
BEGIN
  IF pg_catalog.has_database_privilege(
       'retrospend_owner', pg_catalog.current_database(), 'CREATE') THEN
    EXECUTE pg_catalog.format('REVOKE CREATE ON DATABASE %I FROM retrospend_owner',
      pg_catalog.current_database());
  END IF;
END
$database$;

-- Where an older migration already put the extension (any schema), nothing
-- happens and nothing of the owner's runs. On a new install this is the first
-- thing created in public, before the handover (the step after this file) gives
-- the owner the schema, so no object of the owner's can be in the extension
-- script's way. Once the owner owns public it is not done here at all: the
-- extension script would run as the superuser inside a schema the owner
-- controls. (Every install that ever ran the search migration has it; a new
-- install gets it here before the handover.) Its members stay with the
-- superuser; the handover skips them.
DO $extension$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'unaccent')
     AND (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'public')
         <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_owner') THEN
    CREATE EXTENSION unaccent WITH SCHEMA public;
  END IF;
END
$extension$;

-- The keystore migration says CREATE SCHEMA IF NOT EXISTS, so it keeps this one.
CREATE SCHEMA IF NOT EXISTS keystore AUTHORIZATION retrospend_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- What the owner creates is granted to nobody by default: tables, sequences and
-- functions made by the owner reach retrospend_app only by a grant of their own,
-- and functions are not executable by PUBLIC. The statements are those of the
-- grants file (prisma/grants/app-role.sql, section "Default privileges") for this
-- role. They are here too because a brand-new install is migrated by a one-shot
-- role whose own default privileges are dropped with it, and the owner has none
-- of its own until the grants file runs. Nothing is read from the owner's objects.
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner IN SCHEMA public REVOKE ALL ON TABLES FROM retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner REVOKE ALL ON TABLES FROM retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner REVOKE ALL ON SEQUENCES FROM retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner REVOKE ALL ON FUNCTIONS FROM PUBLIC, retrospend_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE retrospend_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;

COMMIT;
