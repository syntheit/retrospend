-- Rollback for migration 20261124100000_reset_code. Not a migration: Prisma
-- never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that owns
-- the tables (the one that ran the migrations), before starting the older
-- image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261124100000_reset_code.sql
--
-- It deletes every code row and every 'phone' token (the older code does not
-- know those origins, and a code lives 15 minutes), drops the added column
-- and the code check, puts the origin check back to 'email' and 'admin', and
-- deletes the migration's row from "_prisma_migrations", so that starting this
-- release again applies the migration again. A person who asked for a code
-- asks again. Roll this back before 20261118110000_reset_token_hardening.
-- Checked by src/server/services/auth/reset-tokens-migration.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

DELETE FROM "password_reset_token" WHERE "origin" IN ('code', 'phone');

ALTER TABLE "password_reset_token" DROP CONSTRAINT IF EXISTS "password_reset_token_code_check";
ALTER TABLE "password_reset_token" DROP CONSTRAINT IF EXISTS "password_reset_token_origin_check";
ALTER TABLE "password_reset_token"
  ADD CONSTRAINT "password_reset_token_origin_check"
  CHECK ("origin" IN ('email', 'admin'));
ALTER TABLE "password_reset_token" DROP COLUMN IF EXISTS "codeHash";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124100000_reset_code';
