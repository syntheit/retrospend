-- Rate type per entry (M2, N73, ADD-EXPENSE-R2 T7). Placeholder timestamp:
-- the orchestrator assigns the final one at merge.
-- 1. expense."rateType": the rate type of the entry's conversion, an
--    exchange_rate type (official, blue, mep, crypto, ...) or 'custom'.
--    expense."homeCurrency", "homeRate", "homeAmount": the home leg, booked
--    once when the entry is saved so it never drifts with later rates.
--    "homeRate" is units of "homeCurrency" per 1 unit of "currency" (a cross
--    rate, not the per-USD convention of "exchangeRate"). All three are set
--    together or not at all (CHECK). Nothing backfills them: rows saved
--    before this migration keep today's totals rule, so no total changes on
--    deploy. All columns are nullable, so the sidecar's INSERTs keep working.
-- 2. user."defaultRateTypes": the user's default rate type per home
--    currency, {"ARS": "blue"}. Empty means the built-in default (ARS: blue,
--    elsewhere the table's own order).
-- 3. Backfill "rateType" from "pricingSource", only where it is still NULL,
--    so a rerun changes nothing:
--    a. 'custom' (any case) is custom;
--    b. a pricingSource naming a type the entry currency has in
--       exchange_rate is that type ('blue', 'official', ...);
--    c. otherwise (MANUAL, IMPORT, IMPORTED, RECURRING, free text) the type
--       whose table rate equals the stored "exchangeRate", nearest date
--       first: the server picked the rate from that row.
--    USD rows stay NULL: their own leg has no type and the home leg was
--    never recorded. Non-USD rows that still match nothing stay NULL; the
--    deploy pre-check counts them (see the 2A.2 report).
--    A temporary index on exchange_rate (currency, rate) keeps step c from
--    scanning a currency's rates once per expense; it is dropped at the end.
-- Locking: Prisma applies this file in one transaction, at container start
-- before the app serves requests; the ACCESS EXCLUSIVE lock on expense is
-- held through the backfill.
-- Grants and RLS policies are per table and every change here is a column
-- on an existing table, so they need nothing new.

ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "rateType"     VARCHAR(32);
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "homeCurrency" VARCHAR(10);
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "homeRate"     DECIMAL(28,12);
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "homeAmount"   DECIMAL(19,8);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "defaultRateTypes" JSONB NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_rate_type_check') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_rate_type_check"
      CHECK ("rateType" IS NULL OR "rateType" ~ '^[a-z0-9_-]{1,32}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_home_leg_check') THEN
    ALTER TABLE "expense" ADD CONSTRAINT "expense_home_leg_check"
      CHECK (
        ("homeCurrency" IS NULL) = ("homeRate" IS NULL)
        AND ("homeRate" IS NULL) = ("homeAmount" IS NULL)
        AND ("homeRate" IS NULL OR "homeRate" > 0)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_default_rate_types_check') THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_default_rate_types_check"
      CHECK (jsonb_typeof("defaultRateTypes") = 'object') NOT VALID;
  END IF;
END $$;

-- 3a
UPDATE "expense"
SET "rateType" = 'custom'
WHERE "rateType" IS NULL
  AND lower(btrim("pricingSource")) = 'custom';

-- 3b
UPDATE "expense" e
SET "rateType" = lower(btrim(e."pricingSource"))
WHERE e."rateType" IS NULL
  AND e."currency" <> 'USD'
  AND lower(btrim(e."pricingSource")) ~ '^[a-z0-9_-]{1,32}$'
  AND EXISTS (
    SELECT 1 FROM "exchange_rate" r
    WHERE r."currency" = e."currency"
      AND r."type" = lower(btrim(e."pricingSource"))
  );

-- 3c
CREATE INDEX IF NOT EXISTS "exchange_rate_m2_backfill_tmp"
  ON "exchange_rate" ("currency", "rate");

UPDATE "expense" e
SET "rateType" = (
  SELECT r."type" FROM "exchange_rate" r
  WHERE r."currency" = e."currency" AND r."rate" = e."exchangeRate"
    AND r."type" ~ '^[a-z0-9_-]{1,32}$'
  ORDER BY abs(extract(epoch FROM r."date" - e."date")), r."type"
  LIMIT 1
)
WHERE e."rateType" IS NULL
  AND e."currency" <> 'USD'
  AND EXISTS (
    SELECT 1 FROM "exchange_rate" r
    WHERE r."currency" = e."currency" AND r."rate" = e."exchangeRate"
      AND r."type" ~ '^[a-z0-9_-]{1,32}$'
  );

DROP INDEX IF EXISTS "exchange_rate_m2_backfill_tmp";

ALTER TABLE "expense" VALIDATE CONSTRAINT "expense_rate_type_check";
ALTER TABLE "expense" VALIDATE CONSTRAINT "expense_home_leg_check";
ALTER TABLE "user" VALIDATE CONSTRAINT "user_default_rate_types_check";
