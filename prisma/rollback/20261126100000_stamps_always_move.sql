-- Rollback for migration 20261126100000_stamps_always_move. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261126100000_stamps_always_move.sql
--
-- It drops every trigger that calls stamp_moves() (found in the catalog, so no
-- list is kept here), then the function, and deletes the migration's row from
-- "_prisma_migrations", so that starting this release again applies the
-- migration again (a roll forward). Nothing else reads these objects in the
-- older image; stamps already stored stay as they are. Checked by
-- src/test/migrations/stamps-trigger.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regprocedure('stamp_moves()') IS NOT NULL THEN
    FOR r IN
      SELECT tgrelid::regclass AS tbl, tgname
      FROM pg_trigger
      WHERE tgfoid = to_regprocedure('stamp_moves()') AND NOT tgisinternal
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', r.tgname, r.tbl);
    END LOOP;
  END IF;
END $$;

DROP FUNCTION IF EXISTS stamp_moves();
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261126100000_stamps_always_move';
