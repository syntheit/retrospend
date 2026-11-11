-- Rollback for migration 20261111100000_instance_text_key. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that
-- owns the keystore schema (the one that ran the migrations), against the
-- database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261111100000_instance_text_key.sql
--
-- It takes away what the migration added, checked by
-- src/server/services/keys/instance-key.service.pg.test.ts:
--   * the functions keystore.instance_text_keys, keystore.create_first_instance_key
--     and keystore.require_instance_actor, with retrospend_app's EXECUTE on the
--     first two (dropping a function drops its grants);
--   * the table keystore.instance_text_key;
--   * the columns app_settings."instanceKeySince" and "masterKeyCanary".
-- The user data key functions, table and marker are not touched.
--
-- DESTRUCTIVE once anything is sealed with the instance key: dropping the
-- table destroys the key, and everything sealed with it can no longer be read.
-- Nothing seals with it before the D11 seal release, so before that release
-- this loses nothing. After it, restore from a keystore dump instead of
-- running this. Back up the keystore schema first either way.
-- Idempotent: running it twice changes nothing more.

DROP FUNCTION IF EXISTS keystore."create_first_instance_key"(text, bigint);
DROP FUNCTION IF EXISTS keystore."instance_text_keys"();
DROP FUNCTION IF EXISTS keystore."require_instance_actor"();
DROP TABLE IF EXISTS keystore."instance_text_key";
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "instanceKeySince";
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "masterKeyCanary";
