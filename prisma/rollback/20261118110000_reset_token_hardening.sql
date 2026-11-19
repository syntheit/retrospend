-- Rollback for migration 20261118110000_reset_token_hardening. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261118110000_reset_token_hardening.sql
--
-- It deletes every pending reset link (the older code looks a link up by its raw
-- value, so none of these would open, and an hour is all they live), drops the
-- columns the migration added, puts NOT NULL back on "identifier" and deletes
-- the migration's row from "_prisma_migrations", so that starting this release
-- again applies the migration again. A person who asked for a link asks again.
-- Checked by src/server/services/auth/reset-tokens-migration.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'password_reset_token' AND column_name = 'userId'
  ) THEN
    DELETE FROM "password_reset_token";
  END IF;
END $$;

DROP INDEX IF EXISTS "password_reset_token_userId_idx";
ALTER TABLE "password_reset_token" DROP CONSTRAINT IF EXISTS "password_reset_token_origin_check";
ALTER TABLE "password_reset_token" DROP CONSTRAINT IF EXISTS "password_reset_token_userId_fkey";
ALTER TABLE "password_reset_token" DROP COLUMN IF EXISTS "origin";
ALTER TABLE "password_reset_token" DROP COLUMN IF EXISTS "userId";
ALTER TABLE "password_reset_token" ALTER COLUMN "identifier" SET NOT NULL;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261118110000_reset_token_hardening';
