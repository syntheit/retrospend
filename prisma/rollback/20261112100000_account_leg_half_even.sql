-- Rollback for migration 20261112100000_account_leg_half_even. Not a
-- migration: Prisma never runs this file. Migrations run on container start,
-- so an image rollback cannot undo that migration; run this by hand, as the
-- role that owns the functions (the one that ran the migrations):
--
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f prisma/rollback/20261112100000_account_leg_half_even.sql
--
-- It puts back account_leg_apply as 20261024300000_accounts_legs_transfers
-- wrote it (one UPDATE, ROUND half away from zero) and drops round_half_even,
-- checked by src/server/services/accounts/account-leg-half-even.pg.test.ts.
-- CREATE OR REPLACE keeps account_leg_apply's grants. Balances the new trigger
-- moved stay as they are: a tie it rounded to even is not rounded again.
-- Idempotent: running it twice changes nothing more.

CREATE OR REPLACE FUNCTION account_leg_apply(leg "account_leg", direction INTEGER, moves_money BOOLEAN)
RETURNS void AS $$
DECLARE
  effect DECIMAL;
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
    UPDATE "asset_snapshot" s SET
      "balanceInUSD" = CASE
        WHEN COALESCE(s."currency", a."currency") = 'USD' THEN s."balance" + effect
        WHEN s."balance" <> 0 THEN ROUND(s."balanceInUSD" * (s."balance" + effect) / s."balance", 2)
        ELSE COALESCE(ROUND(effect * account_usd_per_unit(s."accountId", s."id"), 2), s."balanceInUSD")
      END,
      "balance" = s."balance" + effect
    FROM "asset_account" a
    WHERE a."id" = s."accountId"
      AND s."accountId" = leg."accountId"
      AND s."date" >= leg."date"
      AND s."recordedAt" >= leg."createdAt";
  END IF;
  IF leg."countedUnits" > 0 THEN
    UPDATE "asset_account"
      SET "countedUnits" = GREATEST(0, "countedUnits" + direction * leg."countedUnits")
      WHERE "id" = leg."accountId";
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS round_half_even(NUMERIC, INTEGER);
