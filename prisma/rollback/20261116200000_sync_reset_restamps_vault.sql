-- Rollback for migration 20261116200000_sync_reset_restamps_vault. Not a
-- migration: Prisma never runs this file. Migrations run on container start, so
-- an image rollback cannot undo that migration; run this by hand, as the role
-- that owns the function (the one that ran the migrations), before starting the
-- older image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261116200000_sync_reset_restamps_vault.sql
--
-- It puts back the sync_reset() of 20261114100000_sync_change (no restamp of
-- vault_record) and deletes the migration's row from "_prisma_migrations", so
-- that starting this release again applies the migration again. Checked by
-- src/server/services/vault/vault-reset.pg.test.ts.
-- Idempotent: running it twice changes nothing more.

CREATE OR REPLACE FUNCTION sync_reset(lock_wait text DEFAULT '30s') RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  previous text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout', lock_wait, true);
  LOCK TABLE "sync_change" IN EXCLUSIVE MODE;
  PERFORM set_config('lock_timeout', previous, true);
  DELETE FROM "sync_change";
  UPDATE "sync_state"
    SET "epoch" = gen_random_uuid()::text,
        "floorTxid" = '0'::xid8,
        "stateOid" = '"sync_state"'::regclass::oid::bigint,
        "databaseOid" = (SELECT "oid"::bigint FROM pg_database WHERE "datname" = current_database())
    WHERE "id" = 1;
  RETURN sync_backfill();
END;
$$;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116200000_sync_reset_restamps_vault';
