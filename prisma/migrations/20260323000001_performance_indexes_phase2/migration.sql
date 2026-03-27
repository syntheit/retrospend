-- Performance: additional composite indexes

-- SharedTransaction: project transaction listings with date sort
-- Replaces standalone @@index([date]) which is a prefix of this
CREATE INDEX IF NOT EXISTS "shared_transaction_projectId_date_idx" ON "shared_transaction" ("projectId", "date");

-- Remove redundant standalone date index (covered by projectId+date and billingPeriodId+date)
DROP INDEX IF EXISTS "shared_transaction_date_idx";

-- AssetSnapshot: wealth history date range queries
CREATE INDEX IF NOT EXISTS "asset_snapshot_userId_date_idx" ON "asset_snapshot" ("userId", "date");
