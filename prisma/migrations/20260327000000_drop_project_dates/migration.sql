-- Drop unused startDate and endDate columns from project table
ALTER TABLE "project" DROP COLUMN IF EXISTS "startDate";
ALTER TABLE "project" DROP COLUMN IF EXISTS "endDate";
