-- The delta log of personal data (E2EE lane P, PR P14a; plan
-- docs/roadmap/e2ee-p14-p15.md). A device that pulls changes needs to know
-- which rows changed and which are gone, whatever changed them: a service, a
-- cascade, an FK SET NULL, the balance trigger, an import, the sidecar, an
-- admin script. "updatedAt" cannot say so (the Prisma client sets it, and
-- cascades, SET NULL and triggers never touch it), so a trigger stamps.
--
-- 1. "sync_change": one row per (entity, id, owner): the last change to it.
--    No text and no amounts, only ids. op U means the row exists or may
--    (a reader loads it by id and calls it deleted if it is not there), D
--    means it was deleted or left that owner. (txid, seq) is the commit-order
--    cursor, the events feed's method (api_event, 20261026300000): txid is
--    the writing transaction, seq a global sequence, and a reader only sees
--    stamps whose txid is below the oldest open transaction, so a late commit
--    never lands behind a cursor a client holds.
-- 2. "sync_state": one row. The epoch changes on sync_reset(); floorTxid is
--    the highest txid the tombstone sweep removed (a cursor at or below it
--    may have missed a deletion); stateOid and databaseOid tell a restore
--    from a normal start (sync_restore_reason).
-- 3. sync_stamp_rows(): one statement-level SECURITY DEFINER trigger function
--    on nine tables, a set-based upsert per statement (an import of 10,000
--    rows is one statement). It joins "user", so the cascade of a user
--    deletion writes nothing (the same guard as budget_dirty_add) and the
--    FK on "userId" removes the rest. An UPDATE that changes the owner stamps
--    D for the old owner and U for the new one.
-- 4. sync_backfill(), sync_reset(), sync_restore_reason(): owner only, plain
--    functions (they need nothing the owner lacks). The backfill stamps every
--    existing row once; the reset is the restore runbook step.
--
-- The app role may only read its own stamps and the state row. Writes come
-- from the definer trigger. Additive and idempotent.

CREATE SEQUENCE IF NOT EXISTS "sync_change_seq";

CREATE TABLE IF NOT EXISTS "sync_change" (
  "entity"    VARCHAR(32)  NOT NULL,
  "entityId"  TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "op"        CHAR(1)      NOT NULL,
  "txid"      xid8         NOT NULL DEFAULT pg_current_xact_id(),
  "seq"       BIGINT       NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_change_pkey" PRIMARY KEY ("entity", "entityId", "userId"),
  CONSTRAINT "sync_change_op_check" CHECK ("op" IN ('U', 'D'))
);

CREATE INDEX IF NOT EXISTS "sync_change_userId_entity_txid_seq_idx"
  ON "sync_change"("userId", "entity", "txid", "seq");
-- The restore check asks for a stamp at or above the next transaction id.
CREATE INDEX IF NOT EXISTS "sync_change_txid_idx" ON "sync_change"("txid");
-- The sweep's queue: tombstones only, oldest first.
CREATE INDEX IF NOT EXISTS "sync_change_tombstone_idx"
  ON "sync_change"("changedAt") WHERE "op" = 'D';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_change_userId_fkey') THEN
    ALTER TABLE "sync_change"
      ADD CONSTRAINT "sync_change_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sync_state" (
  "id"          INTEGER NOT NULL,
  "epoch"       TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "floorTxid"   xid8    NOT NULL DEFAULT '0'::xid8,
  "stateOid"    BIGINT  NOT NULL,
  "databaseOid" BIGINT  NOT NULL,
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_state_single_row" CHECK ("id" = 1)
);

INSERT INTO "sync_state" ("id", "stateOid", "databaseOid")
VALUES (
  1,
  '"sync_state"'::regclass::oid::bigint,
  (SELECT "oid"::bigint FROM pg_database WHERE "datname" = current_database())
)
ON CONFLICT ("id") DO NOTHING;

-- The stamp. TG_ARGV[0] is the entity name (the table name). The transition
-- tables are new_rows (INSERT, UPDATE) and old_rows (UPDATE, DELETE). A stamp
-- already written by this transaction with the same op is left alone, so a
-- hot row written many times in one transaction is not rewritten. Rows are
-- stamped in id order, so two statements over the same rows take the stamp
-- locks in one order.
CREATE OR REPLACE FUNCTION sync_stamp_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT TG_ARGV[0], s."id", s."userId", s."op", pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT n."id", n."userId", 'U' AS "op"
      FROM new_rows n JOIN "user" u ON u."id" = n."userId"
      ORDER BY n."id"
    ) s
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."txid" <> EXCLUDED."txid" OR "sync_change"."op" <> EXCLUDED."op";
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT TG_ARGV[0], s."id", s."userId", s."op", pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT o."id", o."userId", 'D' AS "op"
      FROM old_rows o JOIN "user" u ON u."id" = o."userId"
      ORDER BY o."id"
    ) s
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."txid" <> EXCLUDED."txid" OR "sync_change"."op" <> EXCLUDED."op";
  ELSE
    -- U for every new row; D for an old row that left its owner (a changed
    -- "userId") or whose id changed. The two sets never share a key.
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT TG_ARGV[0], s."id", s."userId", s."op", pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT n."id", n."userId", 'U' AS "op"
      FROM new_rows n JOIN "user" u ON u."id" = n."userId"
      UNION ALL
      SELECT o."id", o."userId", 'D' AS "op"
      FROM old_rows o JOIN "user" u ON u."id" = o."userId"
      WHERE NOT EXISTS (
        SELECT 1 FROM new_rows n WHERE n."id" = o."id" AND n."userId" = o."userId"
      )
      ORDER BY 1, 2
    ) s
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."txid" <> EXCLUDED."txid" OR "sync_change"."op" <> EXCLUDED."op";
  END IF;
  RETURN NULL;
END;
$$;

-- The nine synced tables: src/server/services/sync/entities.ts names the same
-- list, and a pg test fails when a table lacks one of its three triggers.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense', 'category', 'recurring_template', 'asset_account', 'asset_snapshot',
    'asset_history', 'account_leg', 'transfer', 'asset_rate_type'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_ins', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_rows(%L)',
      'sync_' || t || '_ins', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_upd', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_rows(%L)',
      'sync_' || t || '_upd', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t || '_del', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_rows(%L)',
      'sync_' || t || '_del', t, t);
  END LOOP;
END $$;

-- Stamps every existing row of the nine tables with U, once. A row that has a
-- stamp keeps it. Returns the number of stamps written. Owner only; the
-- restore runbook reuses it through sync_reset().
CREATE OR REPLACE FUNCTION sync_backfill() RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  t TEXT;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense', 'category', 'recurring_template', 'asset_account', 'asset_snapshot',
    'asset_history', 'account_leg', 'transfer', 'asset_rate_type'
  ] LOOP
    EXECUTE format(
      'INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
       SELECT %L, s."id", s."userId", ''U'', pg_current_xact_id(), nextval(%L), CURRENT_TIMESTAMP
       FROM (SELECT r."id", r."userId" FROM %I r JOIN "user" u ON u."id" = r."userId" ORDER BY r."id") s
       ON CONFLICT ("entity", "entityId", "userId") DO NOTHING',
      t, 'sync_change_seq', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RETURN total;
END;
$$;

-- A new epoch (every cursor out there is refused with 410, which is also why
-- the floor goes back to 0: a floor at the next transaction id could sit above
-- the txid of the reset's own stamps and refuse the cursors of the rebuilt
-- log for good) and a fresh log: stamps from before may carry txids this
-- cluster has not reached. The lock holds every writer of a synced table at
-- its trigger until the reset commits, so no stamp is lost between the delete
-- and the backfill. Returns the number of stamps the backfill wrote. The lock
-- waits at most `lock_wait` (30 s unless told otherwise) and then fails with
-- lock_not_available (55P03), so a start that finds a restore never hangs
-- behind a connection that holds the log; the setting is put back after.
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

-- Why this database looks restored, or NULL when it does not. A restore into
-- another database changes the database oid; a restore of the table brings
-- the old oids back as data; a new cluster's counter restarts below the
-- stamps (committed stamps are always below any later snapshot's xmax). A
-- filesystem, volume or point-in-time restore of the same cluster moves none
-- of these and is not detected: the runbook runs sync_reset() by hand.
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

ALTER TABLE "sync_change" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_change_select_own ON "sync_change";
CREATE POLICY sync_change_select_own ON "sync_change"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE));

ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_state_select ON "sync_state";
CREATE POLICY sync_state_select ON "sync_state"
  AS PERMISSIVE FOR SELECT TO retrospend_app
  USING (true);

GRANT SELECT ON "sync_change" TO retrospend_app;
GRANT SELECT ON "sync_state" TO retrospend_app;

-- Stamp what exists. After the triggers exist, and a row that already has a
-- stamp keeps it.
SELECT sync_backfill();
