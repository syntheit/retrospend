-- Rollback for migration 20261127100000_account_version. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261127100000_account_version.sql
--
-- It drops the trigger, its function and the "version" column, and deletes only
-- this migration's row from "_prisma_migrations", so that starting this release
-- again applies the migration again (a roll forward; versions restart at 0).
-- The older image never reads the column. It touches nothing of
-- 20261126100000_stamps_always_move. Checked by
-- src/test/migrations/account-version.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DROP TRIGGER IF EXISTS "asset_account_version_moves" ON "asset_account";
DROP FUNCTION IF EXISTS asset_account_version_moves();
ALTER TABLE "asset_account" DROP COLUMN IF EXISTS "version";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127100000_account_version';
