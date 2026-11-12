-- The account leg trigger rounds half to even and moves snapshots oldest first
-- (docs/roadmap/money-decimal.md, PR 4a).
--
-- 1. Half to even. Postgres ROUND on numeric, and the cast into the
--    numeric(12,2) balanceInUSD column, round half away from zero; every other
--    money write in the app rounds half to even (packages/domain
--    money-dec.ts). round_half_even does it in SQL, and account_leg_apply uses
--    it at its three USD sites, so a cast never has a tie left to round.
--
-- 2. Date order. A zero-balance snapshot is valued from the nearest other
--    snapshot that holds something, and one this leg already moved counts at
--    its new value, so the order snapshots are moved in shows in the result.
--    One UPDATE visited them in whatever order its plan read them: by date
--    through the (accountId, date) index, or in heap order on a sequential
--    scan. Each is now moved by its own statement, oldest first.
--
-- account_leg_apply is copied from 20261024300000_accounts_legs_transfers,
-- whose body no later migration changed (20261109500000_definer_hygiene only
-- set its grants, which CREATE OR REPLACE keeps). account_leg_moves_balance has
-- no rounding and is untouched. Mirror: packages/domain/src/accounts/apply-legs.ts.
-- Rollback: prisma/rollback/20261112100000_account_leg_half_even.sql.
-- Idempotent: running it again changes nothing.

-- `value` at `places` decimals (places >= 0), ties to the even neighbor:
-- 0.125 gives 0.12, 0.135 gives 0.14, -0.125 gives -0.12. Sign symmetric,
-- and a numeric zero has no sign, so -0.005 gives 0.00.
CREATE OR REPLACE FUNCTION round_half_even(value NUMERIC, places INTEGER)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN abs(value - trunc(value, places)) * power(10::numeric, places) = 0.5
         AND mod(trunc(value * power(10::numeric, places)), 2) = 0
      THEN trunc(value, places)
    ELSE round(value, places)
  END
$$;

REVOKE ALL ON FUNCTION round_half_even(NUMERIC, INTEGER) FROM PUBLIC;
-- account_leg_moves_balance is SECURITY INVOKER: it runs as retrospend_app.
GRANT EXECUTE ON FUNCTION round_half_even(NUMERIC, INTEGER) TO retrospend_app;

CREATE OR REPLACE FUNCTION account_leg_apply(leg "account_leg", direction INTEGER, moves_money BOOLEAN)
RETURNS void AS $$
DECLARE
  effect DECIMAL;
  snap RECORD;
BEGIN
  IF leg."accountId" IS NULL THEN
    RETURN;
  END IF;
  IF moves_money AND leg."source" <> 'BALANCE_UPDATE' THEN
    SELECT direction * CASE WHEN "type"::text LIKE 'LIABILITY_%' THEN -leg."amount" ELSE leg."amount" END
      INTO effect FROM "asset_account" WHERE "id" = leg."accountId";
    -- The account itself is being deleted (a cascade): nothing to move.
    IF effect IS NULL THEN
      RETURN;
    END IF;
    UPDATE "asset_account" SET "balance" = "balance" + effect WHERE "id" = leg."accountId";
    -- Oldest first, one statement each, whatever plan reads the snapshots.
    -- An account has one snapshot a day (unique accountId, date).
    FOR snap IN
      SELECT s."id" FROM "asset_snapshot" s
      WHERE s."accountId" = leg."accountId"
        AND s."date" >= leg."date"
        AND s."recordedAt" >= leg."createdAt"
      ORDER BY s."date"
    LOOP
      UPDATE "asset_snapshot" s SET
        "balanceInUSD" = CASE
          WHEN COALESCE(s."currency", a."currency") = 'USD' THEN round_half_even(s."balance" + effect, 2)
          WHEN s."balance" <> 0 THEN round_half_even(s."balanceInUSD" * (s."balance" + effect) / s."balance", 2)
          ELSE COALESCE(round_half_even(effect * account_usd_per_unit(s."accountId", s."id"), 2), s."balanceInUSD")
        END,
        "balance" = s."balance" + effect
      FROM "asset_account" a
      WHERE a."id" = s."accountId"
        AND s."id" = snap."id";
    END LOOP;
  END IF;
  IF leg."countedUnits" > 0 THEN
    UPDATE "asset_account"
      SET "countedUnits" = GREATEST(0, "countedUnits" + direction * leg."countedUnits")
      WHERE "id" = leg."accountId";
  END IF;
END;
$$ LANGUAGE plpgsql;
