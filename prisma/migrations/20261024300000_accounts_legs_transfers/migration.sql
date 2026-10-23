-- M4 accounts_legs_transfers (2D.1, MONEY-MOVES §2 with the owner's middle
-- option N75: normal expenses never touch accounts; only deliberate money
-- moves with a picked account do).
--
-- 1. "transfer": one money move between two of your own places (TRANSFER,
--    EXCHANGE, CARD_PAYMENT, WITHDRAWAL, DEBT_PAYMENT), with both amounts
--    exactly as typed (I21). A null side is Not tracked.
-- 2. "account_leg": each place a move changes, signed in what you have
--    (+ = more money). A null account is Not tracked. The booked home value
--    is stored with the leg (I20), so exchange results never drift.
-- 3. "asset_rate_type": dated rate type switches per account (D3). Earlier
--    days keep the type they had.
-- 4. asset_account: "inBudget" (null = the default for its kind and
--    currency), "countedUnits" (D4), "interestRate" DECIMAL(9,6),
--    "minimumPayment" DECIMAL(19,8).
-- 5. asset_snapshot."recordedAt": orders a balance update against legs of
--    the same day. Existing snapshots get the start of their own day, so
--    each one still comes after the days before it.
-- 6. expense."keepInWealth" and "movedInAt" (kept income, Move in);
--    user."defaultAccounts" ({currency: accountId}).
-- 7. A trigger that moves an account's balance, the balance updates that
--    already include a leg, and its counted units with its legs.
--
-- Additive and idempotent. No account has a leg yet, so every balance and
-- every history point stays what it is today. The only backfill is
-- recordedAt (point 5); the only rewrite is the interestRate type change,
-- which keeps every value with |rate| < 1000 to 6 decimals (deploy
-- pre-check in the 2D.1 report).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransferKind') THEN
    CREATE TYPE "TransferKind" AS ENUM ('TRANSFER', 'EXCHANGE', 'CARD_PAYMENT', 'WITHDRAWAL', 'DEBT_PAYMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountLegSource') THEN
    CREATE TYPE "AccountLegSource" AS ENUM ('INCOME', 'TRANSFER', 'FEE', 'BALANCE_UPDATE');
  END IF;
END $$;

ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "inBudget" BOOLEAN;
ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "countedUnits" DECIMAL(19,8) NOT NULL DEFAULT 0;
ALTER TABLE "asset_account" ALTER COLUMN "interestRate" TYPE DECIMAL(9,6) USING "interestRate"::DECIMAL(9,6);
ALTER TABLE "asset_account" ALTER COLUMN "minimumPayment" TYPE DECIMAL(19,8);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_account_counted_units_check') THEN
    ALTER TABLE "asset_account"
      ADD CONSTRAINT "asset_account_counted_units_check" CHECK ("countedUnits" >= 0);
  END IF;
END $$;

-- Backfilled before the default applies: a migration-time recordedAt would
-- put every old balance update after all the others, and Wealth would read
-- each one as Not logged from zero.
ALTER TABLE "asset_snapshot" ADD COLUMN IF NOT EXISTS "recordedAt" TIMESTAMP(3);
UPDATE "asset_snapshot" SET "recordedAt" = "date" WHERE "recordedAt" IS NULL;
ALTER TABLE "asset_snapshot" ALTER COLUMN "recordedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "asset_snapshot" ALTER COLUMN "recordedAt" SET NOT NULL;

ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "keepInWealth" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "movedInAt" TIMESTAMP(3);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "defaultAccounts" JSONB;

CREATE TABLE IF NOT EXISTS "transfer" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "kind"              "TransferKind" NOT NULL,
  "date"              TIMESTAMP(3) NOT NULL,
  "fromAccountId"     TEXT,
  "fromAmount"        DECIMAL(19,8) NOT NULL,
  "fromCurrency"      TEXT NOT NULL,
  "toAccountId"       TEXT,
  "toAmount"          DECIMAL(19,8) NOT NULL,
  "toCurrency"        TEXT NOT NULL,
  "referenceRateType" VARCHAR(32),
  "feeExpenseId"      TEXT,
  "countedFromUnits"  DECIMAL(19,8) NOT NULL DEFAULT 0,
  "countedToUnits"    DECIMAL(19,8) NOT NULL DEFAULT 0,
  "note"              VARCHAR(500),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transfer_amounts_check" CHECK ("fromAmount" > 0 AND "toAmount" > 0),
  CONSTRAINT "transfer_counted_check" CHECK ("countedFromUnits" >= 0 AND "countedToUnits" >= 0),
  CONSTRAINT "transfer_exchange_check" CHECK (("kind" = 'EXCHANGE') = ("fromCurrency" <> "toCurrency"))
);

CREATE UNIQUE INDEX IF NOT EXISTS "transfer_feeExpenseId_key" ON "transfer" ("feeExpenseId");
CREATE INDEX IF NOT EXISTS "transfer_userId_date_idx" ON "transfer" ("userId", "date");
CREATE INDEX IF NOT EXISTS "transfer_fromAccountId_idx" ON "transfer" ("fromAccountId");
CREATE INDEX IF NOT EXISTS "transfer_toAccountId_idx" ON "transfer" ("toAccountId");

CREATE TABLE IF NOT EXISTS "account_leg" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "accountId"    TEXT,
  "currency"     TEXT NOT NULL,
  "amount"       DECIMAL(19,8) NOT NULL,
  "homeAmount"   DECIMAL(19,8),
  "homeCurrency" TEXT,
  "date"         TIMESTAMP(3) NOT NULL,
  "source"       "AccountLegSource" NOT NULL,
  "transferId"   TEXT,
  "expenseId"    TEXT,
  -- Units of this leg the budget already counts (D4): an income kept in
  -- Wealth and moved in, or one into an account outside the budget.
  "countedUnits" DECIMAL(19,8) NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_leg_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_leg_counted_check" CHECK ("countedUnits" >= 0),
  -- Every leg names what wrote it; a balance update and an income always land in an account.
  CONSTRAINT "account_leg_source_check" CHECK (
    ("source" = 'TRANSFER' AND "transferId" IS NOT NULL AND "expenseId" IS NULL)
    OR ("source" = 'FEE' AND "transferId" IS NOT NULL AND "expenseId" IS NOT NULL)
    OR ("source" = 'INCOME' AND "expenseId" IS NOT NULL AND "transferId" IS NULL AND "accountId" IS NOT NULL)
    OR ("source" = 'BALANCE_UPDATE' AND "accountId" IS NOT NULL AND "transferId" IS NULL AND "expenseId" IS NULL)
  ),
  CONSTRAINT "account_leg_home_check" CHECK (("homeAmount" IS NULL) = ("homeCurrency" IS NULL))
);

CREATE INDEX IF NOT EXISTS "account_leg_userId_date_idx" ON "account_leg" ("userId", "date");
CREATE INDEX IF NOT EXISTS "account_leg_accountId_date_idx" ON "account_leg" ("accountId", "date");
CREATE INDEX IF NOT EXISTS "account_leg_transferId_idx" ON "account_leg" ("transferId");
CREATE INDEX IF NOT EXISTS "account_leg_expenseId_idx" ON "account_leg" ("expenseId");

CREATE TABLE IF NOT EXISTS "asset_rate_type" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "from"      TIMESTAMP(3) NOT NULL,
  "type"      VARCHAR(32),
  -- The account's type before this switch, so undoing it restores that type.
  "previousType" VARCHAR(32),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_rate_type_pkey" PRIMARY KEY ("id")
);

-- Several switches can share a day; createdAt orders them.
CREATE INDEX IF NOT EXISTS "asset_rate_type_accountId_from_idx" ON "asset_rate_type" ("accountId", "from");
CREATE INDEX IF NOT EXISTS "asset_rate_type_userId_idx" ON "asset_rate_type" ("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_userId_fkey') THEN
    ALTER TABLE "transfer" ADD CONSTRAINT "transfer_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_fromAccountId_fkey') THEN
    ALTER TABLE "transfer" ADD CONSTRAINT "transfer_fromAccountId_fkey"
      FOREIGN KEY ("fromAccountId") REFERENCES "asset_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_toAccountId_fkey') THEN
    ALTER TABLE "transfer" ADD CONSTRAINT "transfer_toAccountId_fkey"
      FOREIGN KEY ("toAccountId") REFERENCES "asset_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfer_feeExpenseId_fkey') THEN
    ALTER TABLE "transfer" ADD CONSTRAINT "transfer_feeExpenseId_fkey"
      FOREIGN KEY ("feeExpenseId") REFERENCES "expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_leg_userId_fkey') THEN
    ALTER TABLE "account_leg" ADD CONSTRAINT "account_leg_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_leg_accountId_fkey') THEN
    ALTER TABLE "account_leg" ADD CONSTRAINT "account_leg_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_leg_transferId_fkey') THEN
    ALTER TABLE "account_leg" ADD CONSTRAINT "account_leg_transferId_fkey"
      FOREIGN KEY ("transferId") REFERENCES "transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_leg_expenseId_fkey') THEN
    ALTER TABLE "account_leg" ADD CONSTRAINT "account_leg_expenseId_fkey"
      FOREIGN KEY ("expenseId") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_rate_type_userId_fkey') THEN
    ALTER TABLE "asset_rate_type" ADD CONSTRAINT "asset_rate_type_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_rate_type_accountId_fkey') THEN
    ALTER TABLE "asset_rate_type" ADD CONSTRAINT "asset_rate_type_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "asset_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS: each row belongs to one user, like asset_account (20260303000001).
ALTER TABLE "transfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_leg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_leg" FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_rate_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_rate_type" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfer_isolation ON "transfer";
CREATE POLICY transfer_isolation ON "transfer"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS account_leg_isolation ON "account_leg";
CREATE POLICY account_leg_isolation ON "account_leg"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

DROP POLICY IF EXISTS asset_rate_type_isolation ON "asset_rate_type";
CREATE POLICY asset_rate_type_isolation ON "asset_rate_type"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT, UPDATE, DELETE ON "transfer" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_leg" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_rate_type" TO retrospend_app;

-- An account's stored balance moves with its legs, whatever writes or
-- removes them: a transfer, an income deleted from Activity, an expense
-- cascade. A leg is signed in what you have, so on a liability (which
-- stores what you owe) it moves the balance the other way. A balance
-- update's own leg is the record of its Not logged difference; the update
-- sets the balance itself, so that leg never moves it.
--
-- A balance update written after a leg, dated on the leg's day or later,
-- already includes it (accounts/series.ts, includedIn). It moves with the
-- leg too, so the balance, the history and the net worth change always
-- agree: deleting an income that a later update counted takes it out of
-- both. Its USD value scales with it (that value is only read when a rate
-- is missing).
--
-- The leg's counted units (D4) are counted on its account; when the leg
-- goes they go too, never below zero (they may have left the account).
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
        ELSE s."balanceInUSD"
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

CREATE OR REPLACE FUNCTION account_leg_moves_balance() RETURNS trigger AS $$
DECLARE
  moves_money BOOLEAN := TRUE;
BEGIN
  -- An update that keeps where, when and how much (a Move in marking units
  -- counted) moves no money, only counted units.
  IF TG_OP = 'UPDATE' THEN
    moves_money := (OLD."accountId", OLD."amount", OLD."date", OLD."createdAt", OLD."source")
      IS DISTINCT FROM (NEW."accountId", NEW."amount", NEW."date", NEW."createdAt", NEW."source");
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM account_leg_apply(OLD, -1, moves_money);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM account_leg_apply(NEW, 1, moves_money);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "account_leg_moves_balance" ON "account_leg";
CREATE TRIGGER "account_leg_moves_balance"
  AFTER INSERT OR UPDATE OR DELETE ON "account_leg"
  FOR EACH ROW EXECUTE FUNCTION account_leg_moves_balance();
