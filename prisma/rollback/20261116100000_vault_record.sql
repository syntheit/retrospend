-- Rollback for migration 20261116100000_vault_record. Not a migration: Prisma
-- never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the table (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261116100000_vault_record.sql
--
-- It drops the table (its policy, trigger, constraints, index, the owned
-- sequence and the app role's grants go with it), the stamping function, and
-- deletes the migration's row from "_prisma_migrations", so that starting this
-- release again applies the migration again. Nothing else reads these objects.
--
-- The records are the only copy of a protected account's data (the server
-- cannot read them and the clients may not hold them all), so it refuses to
-- run while any row exists: dropping them would lose that data for good. Turn
-- protection off and erase the store on purpose first (or restore the rows
-- afterwards from a backup), then run this.
-- Checked by src/server/services/vault/vault-migration.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
DECLARE
  used BOOLEAN;
BEGIN
  -- Dynamic SQL: a table the first run already dropped is skipped, not an error.
  IF to_regclass('public.vault_record') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM "vault_record")' INTO used;
    IF used THEN
      RAISE EXCEPTION 'vault_record has rows: rolling back would delete the sealed records of a protected account';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "vault_record";
DROP FUNCTION IF EXISTS vault_record_stamp();
DROP SEQUENCE IF EXISTS "vault_record_seq";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116100000_vault_record';
