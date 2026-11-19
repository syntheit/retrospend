-- Rollback for migration 20261118100000_recovery_proof. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261118100000_recovery_proof.sql
--
-- It gives retrospend_app back what a release from before that migration
-- needs: table-level SELECT and INSERT on "protection_key_set" (and no column
-- SELECT list), column UPDATE on its kdfSalt, kdfMemoryKiB, kdfPasses, version
-- and updatedAt, and INSERT and DELETE on "protection_key_wrap". It does not
-- drop the column or the CHECK: "recoveryHash" holds the proof of every key
-- set made since, and dropping it would make those recovery keys unusable. An
-- older release ignores the column. It deletes the migration's row from
-- "_prisma_migrations", so that starting the newer release again applies the
-- migration again (it is idempotent and keeps the column).
--
-- To go back past 20261115200000_protection_keys as well, run this file first
-- and that migration's rollback after it. Run prisma/grants/app-role.sql
-- afterwards only from a release that matches the database; the newer file
-- takes the grants away again.
-- Checked by src/server/services/protection-keys/recovery-proof-migration.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$ BEGIN
  IF to_regclass('public.protection_key_set') IS NOT NULL THEN
    REVOKE SELECT (
      "userId", "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "version",
      "createdAt", "updatedAt"
    ) ON "protection_key_set" FROM retrospend_app;
    GRANT SELECT, INSERT ON "protection_key_set" TO retrospend_app;
    GRANT UPDATE ("kdfSalt", "kdfMemoryKiB", "kdfPasses", "version", "updatedAt")
      ON "protection_key_set" TO retrospend_app;
  END IF;
  IF to_regclass('public.protection_key_wrap') IS NOT NULL THEN
    GRANT INSERT, DELETE ON "protection_key_wrap" TO retrospend_app;
  END IF;
END $$;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118100000_recovery_proof';
