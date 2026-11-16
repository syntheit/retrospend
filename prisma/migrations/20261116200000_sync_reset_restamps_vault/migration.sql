-- sync_reset() also restamps the sealed record store (E2EE F7a follow-up).
-- After a restore into a new cluster, vault_record rows keep the txids of the
-- old cluster, far above the new transaction counter, and the reader only
-- shows rows below the oldest open transaction: they would stay hidden until
-- the counter caught up. The restore check run at every start
-- (sync_restore_reason(), sync/restore.ts) only looked at sync_change, so a
-- restore whose only high txids are in vault_record was not seen: it now
-- reports 'vault_txid' for a vault row at or above the snapshot's xmax, and
-- the start runs sync_reset(). The runbook step that makes every device pull again
-- (sync_reset(), run by a start that finds a restore) therefore has to give
-- these rows a txid of this cluster too. A no-op UPDATE fires the
-- vault_record_stamp trigger (txid, seq and updatedAt), and changes nothing a
-- device reads: the record, its version and its bytes stay as they were.
--
-- This replaces the two functions of 20261114100000_sync_change (never edited)
-- with the same signatures, owner and rules, and keeps everything they did. The table
-- is looked up by name so a database where the vault table is rolled back
-- first still resets. Additive and idempotent.

CREATE OR REPLACE FUNCTION sync_reset(lock_wait text DEFAULT '30s') RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  previous text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout', lock_wait, true);
  LOCK TABLE "sync_change" IN EXCLUSIVE MODE;
  -- The restamp below updates every vault row, so it waits behind any open
  -- transaction that wrote one: lock the table here, under the same wait, or
  -- the promise that a start fails after lock_wait would not hold.
  IF to_regclass('public.vault_record') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE "vault_record" IN EXCLUSIVE MODE';
  END IF;
  PERFORM set_config('lock_timeout', previous, true);
  DELETE FROM "sync_change";
  UPDATE "sync_state"
    SET "epoch" = gen_random_uuid()::text,
        "floorTxid" = '0'::xid8,
        "stateOid" = '"sync_state"'::regclass::oid::bigint,
        "databaseOid" = (SELECT "oid"::bigint FROM pg_database WHERE "datname" = current_database())
    WHERE "id" = 1;
  IF to_regclass('public.vault_record') IS NOT NULL THEN
    EXECUTE 'UPDATE "vault_record" SET "version" = "version"';
  END IF;
  RETURN sync_backfill();
END;
$$;

CREATE OR REPLACE FUNCTION sync_restore_reason() RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st RECORD;
  vault_high boolean := false;
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
  -- The same for the sealed records, which carry their own txids.
  IF to_regclass('public.vault_record') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM "vault_record"
      WHERE "txid" >= pg_snapshot_xmax(pg_current_snapshot())
        AND "txid" IS DISTINCT FROM pg_current_xact_id_if_assigned()
    )' INTO vault_high;
    IF vault_high THEN
      RETURN 'vault_txid';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
