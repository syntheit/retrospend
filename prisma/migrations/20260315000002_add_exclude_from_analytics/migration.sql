-- AlterTable
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "excludeFromAnalytics" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "excludeByDefault" BOOLEAN NOT NULL DEFAULT false;
