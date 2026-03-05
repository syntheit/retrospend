ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "monthlyIncomeCurrency" VARCHAR(10) NOT NULL DEFAULT 'USD';
-- Backfill: existing users' income was implicitly in their home currency
UPDATE "user" SET "monthlyIncomeCurrency" = "homeCurrency" WHERE "monthlyIncomeCurrency" = 'USD' AND "homeCurrency" != 'USD';
