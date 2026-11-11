-- Rollback for migration 20261111300000_field_encryption_epoch. Not a
-- migration: Prisma never runs this file. Migrations run on container start,
-- so an image rollback cannot undo that migration; run this by hand, as the
-- role that owns app_settings (the one that ran the migrations):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261111300000_field_encryption_epoch.sql
--
-- It drops app_settings."fieldEncryptionSince", checked by
-- src/server/services/keys/field-encryption-start.pg.test.ts.
--
-- Do not run it once the epoch is set: text sealed since then stays sealed,
-- and without the epoch the servers would filter and search it in SQL and
-- quietly miss those rows. Until sealing is released (no production server
-- can set the epoch before then) this loses nothing.
-- Idempotent: running it twice changes nothing more.

ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "fieldEncryptionSince";
