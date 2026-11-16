-- Rollback for migration 20261115200000_protection_keys. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261115200000_protection_keys.sql
--
-- It drops the two tables (their policies, constraints and the app role's
-- grants go with them) and deletes the migration's row from
-- "_prisma_migrations", so that starting this release again applies the
-- migration again. Nothing else reads these tables.
--
-- The wraps are the only way back into a protected account, so it refuses to
-- run while any key set exists: dropping them would lock that user out of
-- their sealed data for good. Turn protection off first (or restore the rows
-- afterwards from a backup), then run this.
-- Checked by src/server/services/protection-keys/protection-keys-migration.pg.test.ts
-- and, through `prisma migrate deploy`, by src/test/migrations/owner-upgrade.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
BEGIN
  IF to_regclass('public.protection_key_set') IS NOT NULL
     AND EXISTS (SELECT 1 FROM "protection_key_set") THEN
    RAISE EXCEPTION 'protection_key_set has rows: rolling back would delete the wrapped keys of a protected account';
  END IF;
  IF to_regclass('public.protection_key_wrap') IS NOT NULL
     AND EXISTS (SELECT 1 FROM "protection_key_wrap") THEN
    RAISE EXCEPTION 'protection_key_wrap has rows: rolling back would delete the wrapped keys of a protected account';
  END IF;
END $$;

DROP TABLE IF EXISTS "protection_key_wrap";
DROP TABLE IF EXISTS "protection_key_set";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115200000_protection_keys';
