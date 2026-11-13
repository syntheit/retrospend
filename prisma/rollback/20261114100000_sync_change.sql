-- Rollback for migration 20261114100000_sync_change. Not a migration: Prisma
-- never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261114100000_sync_change.sql
--
-- It drops the nine tables' triggers, the five functions, the two tables
-- (their policies and the app role's SELECT go with them) and the sequence,
-- and deletes the migration's row from "_prisma_migrations", so that starting
-- this release again applies the migration again (a roll forward) and
-- sync_backfill() rebuilds the log. Nothing else reads these objects in the
-- older image. Checked by src/server/services/sync/sync-migration.pg.test.ts
-- and, through `prisma migrate deploy`, by src/test/migrations/owner-upgrade.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense', 'category', 'recurring_template', 'asset_account', 'asset_snapshot',
    'asset_history', 'account_leg', 'transfer', 'asset_rate_type'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_ins', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_upd', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_del', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS sync_note_xmax();
DROP FUNCTION IF EXISTS sync_restore_reason();
DROP FUNCTION IF EXISTS sync_reset(text);
DROP FUNCTION IF EXISTS sync_backfill();
DROP FUNCTION IF EXISTS sync_stamp_rows();
DROP TABLE IF EXISTS "sync_change";
DROP TABLE IF EXISTS "sync_state";
DROP SEQUENCE IF EXISTS "sync_change_seq";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114100000_sync_change';
