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
-- Checked by src/server/services/protection-keys/protection-keys-migration.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
DECLARE
  t TEXT;
  used BOOLEAN;
BEGIN
  -- Dynamic SQL: a table the first run already dropped is skipped, not an error.
  FOREACH t IN ARRAY ARRAY['protection_key_set', 'protection_key_wrap'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO used;
      IF used THEN
        RAISE EXCEPTION '% has rows: rolling back would delete the wrapped keys of a protected account', t;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS "protection_key_wrap";
DROP TABLE IF EXISTS "protection_key_set";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261115200000_protection_keys';
