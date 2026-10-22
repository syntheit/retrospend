-- Closing wealth accounts instead of deleting them.
-- 1. asset_account."closedAt": set when the account is closed. A closed
--    account counts 0 from that day on but keeps its snapshots, so past net
--    worth no longer changes when an account goes away. NULL means open.
-- 2. asset_snapshot."currency", "type", "exchangeRateType": what the account
--    was when the snapshot was taken. History values each snapshot with its
--    own currency and rate type, so editing an account's currency, type or
--    rate type no longer revalues its old balances. Existing rows are
--    backfilled from their account (the best record there is).
-- All columns are nullable, so adding them does not rewrite the tables.
-- Grants and RLS policies are per table, so the new columns need nothing.

ALTER TABLE "asset_account" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "asset_account_userId_closedAt_idx"
  ON "asset_account" ("userId", "closedAt");

ALTER TABLE "asset_snapshot" ADD COLUMN IF NOT EXISTS "currency" TEXT;
ALTER TABLE "asset_snapshot" ADD COLUMN IF NOT EXISTS "type" "AssetType";
ALTER TABLE "asset_snapshot" ADD COLUMN IF NOT EXISTS "exchangeRateType" VARCHAR(32);

UPDATE "asset_snapshot" s
SET "currency"         = a."currency",
    "type"             = a."type",
    "exchangeRateType" = a."exchangeRateType"
FROM "asset_account" a
WHERE s."accountId" = a.id
  AND s."currency" IS NULL;
