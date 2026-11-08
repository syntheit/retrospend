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
--   3. gives the owner CREATE on the database until the first migration has
--      finished (the first migration says CREATE SCHEMA IF NOT EXISTS), and
--      takes it back after;
--   4. creates the unaccent extension (needs CREATE on the database);
--   5. creates the keystore schema for the owner (same reason);
--   6. keeps PUBLIC from creating objects in public.
-- The ownership handover (owner-handover.sql) is the second half.
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

-- The first migration says CREATE SCHEMA IF NOT EXISTS "public", and Postgres
-- checks CREATE on the database before it looks whether the schema exists.
-- The owner needs that privilege until one migration has finished, and not
-- after: it would let the owner create schemas, which nothing in a normal
-- start needs. (A new schema or extension for a later migration is added to
-- this file, not given to the owner.)
DO $database$
DECLARE
  migrated boolean := false;
  can_create boolean;
BEGIN
  IF pg_catalog.to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NOT NULL)'
      INTO migrated;
  END IF;
  can_create := pg_catalog.has_database_privilege(
    'retrospend_owner', pg_catalog.current_database(), 'CREATE');
  IF NOT migrated AND NOT can_create THEN
    EXECUTE pg_catalog.format('GRANT CREATE ON DATABASE %I TO retrospend_owner',
      pg_catalog.current_database());
  ELSIF migrated AND can_create THEN
    EXECUTE pg_catalog.format('REVOKE CREATE ON DATABASE %I FROM retrospend_owner',
      pg_catalog.current_database());
  END IF;
END
$database$;

-- Where an older migration already put the extension (any schema), keep it.
-- Its members stay with the superuser; the handover skips them.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- The keystore migration says CREATE SCHEMA IF NOT EXISTS, so it keeps this one.
CREATE SCHEMA IF NOT EXISTS keystore AUTHORIZATION retrospend_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

COMMIT;
