-- Rollback for migration 20261116200000_sync_reset_restamps_vault. Not a
-- migration: Prisma never runs this file. Migrations run on container start, so
-- an image rollback cannot undo that migration; run this by hand, as the role
-- that owns the function (the one that ran the migrations), before starting the
-- older image:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261116200000_sync_reset_restamps_vault.sql
--
-- It puts back sync_reset() and sync_restore_reason() of
-- 20261114100000_sync_change (no restamp or check of vault_record) and
-- deletes the migration's row from "_prisma_migrations", so that starting
-- this release again applies the migration again. Checked by
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

CREATE OR REPLACE FUNCTION sync_restore_reason() RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st RECORD;
BEGIN
  SELECT * INTO st FROM "sync_state" WHERE "id" = 1;
  IF NOT FOUND THEN
    RETURN 'state';
  END IF;
  IF st."databaseOid" <> (SELECT "oid"::bigint FROM pg_database WHERE "datname" = current_database()) THEN
    RETURN 'database';
  END IF;
  IF st."stateOid" <> '"sync_state"'::regclass::oid::bigint THEN
    RETURN 'table';
  END IF;
  -- The running transaction's own stamps (a reset just made) can sit at or
  -- above its snapshot's xmax; they are not from another cluster.
  IF EXISTS (
    SELECT 1 FROM "sync_change"
    WHERE "txid" >= pg_snapshot_xmax(pg_current_snapshot())
      AND "txid" IS DISTINCT FROM pg_current_xact_id_if_assigned()
  ) THEN
    RETURN 'txid';
  END IF;
  RETURN NULL;
END;
$$;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261116200000_sync_reset_restamps_vault';
