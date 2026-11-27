-- An account carries a version that moves when a device-editable column changes.
--
-- A device that edits an account offline names the version it read; the server
-- refuses the write (409 account_changed) when the account moved since. The
-- stamp "updatedAt" cannot be that version: it is the "Updated" date on screen
-- and moves with a counted move, a checkpoint and every Prisma update (and
-- asset_account is off the stamp trigger's allowlist on purpose, see
-- 20261126100000_stamps_always_move). So the account gets a counter of its own.
--
-- One BEFORE UPDATE row trigger is the one owner of the rule, so every writer
-- is covered without a list to keep. It adds 1 when one of these columns holds
-- a different value than before: type, currency, exchangeRateType, closedAt,
-- inBudget, isLiquid, interestRate, minimumPayment, dueDate. It never reads
-- balance, countedUnits, exchangeRate, the icon, name or updatedAt: a transfer,
-- an income leg, a balance update that keeps the rate type, an icon swap or a
-- re-sealed name must not spoil a pending edit. The list lives in
-- packages/domain/src/accounts/version-columns.ts; the test
-- src/test/migrations/account-version.pg.test.ts reads it back from this
-- function and fails on a difference.
--
-- A plain BEFORE UPDATE, never "UPDATE OF": that fires on a column in the SET
-- list even with the same value, and a checkpoint writes the rate type on every
-- balance update. IS DISTINCT FROM compares values, nulls included. INSERT
-- keeps the version it is given (a restored account keeps its own).
--
-- SECURITY INVOKER: it only reads OLD and writes NEW. It needs no EXECUTE for
-- retrospend_app (Postgres checks EXECUTE on a trigger function when the
-- trigger is created, not when it fires). The table-level grant on
-- "asset_account" already covers the new column (prisma/grants/app-role.sql).
--
-- Rollback: prisma/rollback/20261127100000_account_version.sql.

ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION asset_account_version_moves() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW."type", NEW."currency", NEW."exchangeRateType", NEW."closedAt",
      NEW."inBudget", NEW."isLiquid", NEW."interestRate", NEW."minimumPayment",
      NEW."dueDate")
     IS DISTINCT FROM
     (OLD."type", OLD."currency", OLD."exchangeRateType", OLD."closedAt",
      OLD."inBudget", OLD."isLiquid", OLD."interestRate", OLD."minimumPayment",
      OLD."dueDate")
  THEN
    NEW."version" := OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "asset_account_version_moves" ON "asset_account";
CREATE TRIGGER "asset_account_version_moves" BEFORE UPDATE ON "asset_account"
  FOR EACH ROW EXECUTE FUNCTION asset_account_version_moves();
