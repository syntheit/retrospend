-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "enableFeedback" BOOLEAN NOT NULL DEFAULT false;
