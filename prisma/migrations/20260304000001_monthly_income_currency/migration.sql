ALTER TABLE "user" ADD COLUMN "monthlyIncomeCurrency" VARCHAR(10) NOT NULL DEFAULT 'USD';
-- Backfill: existing users' income was implicitly in their home currency
UPDATE "user" SET "monthlyIncomeCurrency" = "homeCurrency";
