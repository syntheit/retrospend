-- Rollback for migration 20261114100000_sync_change. Not a migration: Prisma
-- never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261114100000_sync_change.sql
--
-- It drops the nine tables' triggers, the four functions, the two tables
-- (their policies and the app role's SELECT go with them) and the sequence.
-- Nothing else reads them in the older image, and the log is rebuilt by
-- sync_backfill() when the migration runs again. Checked by
-- src/server/services/sync/sync-migration.pg.test.ts.
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

DROP FUNCTION IF EXISTS sync_restore_reason();
DROP FUNCTION IF EXISTS sync_reset();
DROP FUNCTION IF EXISTS sync_backfill();
DROP FUNCTION IF EXISTS sync_stamp_rows();
DROP TABLE IF EXISTS "sync_change";
DROP TABLE IF EXISTS "sync_state";
DROP SEQUENCE IF EXISTS "sync_change_seq";
