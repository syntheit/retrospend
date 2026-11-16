-- sync_reset() also restamps the sealed record store (E2EE F7a follow-up).
-- After a restore into a new cluster, vault_record rows keep the txids of the
-- old cluster, far above the new transaction counter, and the reader only
-- shows rows below the oldest open transaction: they would stay hidden until
-- the counter caught up. The runbook step that makes every device pull again
-- (sync_reset(), run by a start that finds a restore) therefore has to give
-- these rows a txid of this cluster too. A no-op UPDATE fires the
-- vault_record_stamp trigger (txid, seq and updatedAt), and changes nothing a
-- device reads: the record, its version and its bytes stay as they were.
--
-- This replaces the function of 20261114100000_sync_change (never edited) with
-- the same signature, owner and rules, and keeps everything it did. The table
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
